// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  box,
  chamfer,
  cylinder,
  fillet,
  intersect,
  linearExtrude,
  mirror,
  rotate,
  scale,
  SolidKind,
  sphere,
  subtract,
  tagPatch,
  translate,
  union,
  type BoundaryPatchType,
  type Solid,
  type Vec3,
} from "@modelscript/cad";

export interface ScadEvaluationOptions {
  variables?: Record<string, any>;
}

class Scope {
  public variables = new Map<string, any>();
  public functions = new Map<string, { params: string[]; defaults: Map<string, any>; bodyNode: any; scope: Scope }>();
  public modules = new Map<string, { params: string[]; defaults: Map<string, any>; bodyNode: any; scope: Scope }>();

  constructor(public parent: Scope | null = null) {
    if (!parent) {
      this.initBuiltins();
    }
  }

  private initBuiltins(): void {
    this.variables.set("$fn", 32);
    this.variables.set("$fa", 12);
    this.variables.set("$fs", 2);
    this.variables.set("$t", 0);
    this.variables.set("PI", Math.PI);
  }

  getVar(name: string): any {
    if (this.variables.has(name)) return this.variables.get(name);
    if (this.parent) return this.parent.getVar(name);
    return undefined;
  }

  setVar(name: string, val: any): void {
    this.variables.set(name, val);
  }

  getFunc(name: string): { params: string[]; defaults: Map<string, any>; bodyNode: any; scope: Scope } | undefined {
    if (this.functions.has(name)) return this.functions.get(name);
    if (this.parent) return this.parent.getFunc(name);
    return undefined;
  }

  getModule(name: string): { params: string[]; defaults: Map<string, any>; bodyNode: any; scope: Scope } | undefined {
    if (this.modules.has(name)) return this.modules.get(name);
    if (this.parent) return this.parent.getModule(name);
    return undefined;
  }
}

function applyEulerRotation(solid: Solid, rot: Vec3): Solid {
  let s = solid;
  if (rot[0]) s = rotate(s, [1, 0, 0], rot[0]);
  if (rot[1]) s = rotate(s, [0, 1, 0], rot[1]);
  if (rot[2]) s = rotate(s, [0, 0, 1], rot[2]);
  return s;
}

export class ScadEvaluator {
  private globalScope: Scope;

  constructor(options?: ScadEvaluationOptions) {
    this.globalScope = new Scope();
    if (options?.variables) {
      for (const [k, v] of Object.entries(options.variables)) {
        this.globalScope.setVar(k, v);
      }
    }
  }

  /**
   * Evaluates a parsed SourceFile CST root node into a combined Solid geometry tree.
   */
  public evaluate(rootNode: any): Solid | null {
    const solids: Solid[] = [];
    this.evaluateStatements(rootNode, this.globalScope, solids);

    if (solids.length === 0) return null;
    if (solids.length === 1) return solids[0];

    // Combine multiple top-level solids via union
    let acc = solids[0];
    for (let i = 1; i < solids.length; i++) {
      acc = union(acc, solids[i]);
    }
    return acc;
  }

  private evaluateStatements(containerNode: any, scope: Scope, outSolids: Solid[]): void {
    for (let i = 0; i < containerNode.childCount; i++) {
      const stmt = containerNode.child(i);
      if (!stmt) continue;
      this.evaluateStatement(stmt, scope, outSolids);
    }
  }

  private evaluateStatement(stmtNode: any, scope: Scope, outSolids: Solid[]): void {
    const type = stmtNode.type;

    if (type === "Statement") {
      const inner = stmtNode.child(0);
      if (inner) this.evaluateStatement(inner, scope, outSolids);
      return;
    }

    if (type === "VariableDeclaration") {
      const nameNode = this.findChildByType(stmtNode, "IDENTIFIER");
      const exprNode = this.findChildByType(stmtNode, "Expression");
      if (nameNode && exprNode) {
        const val = this.evaluateExpression(exprNode, scope);
        scope.setVar(nameNode.text.trim(), val);
      }
      return;
    }

    if (type === "ModuleDeclaration") {
      const nameNode = this.findChildByType(stmtNode, "IDENTIFIER");
      const paramListNode = this.findChildByType(stmtNode, "ParameterList");
      const bodyNode = this.findChildByType(stmtNode, "Statement") ?? this.findChildByType(stmtNode, "BlockStatement");
      if (nameNode && bodyNode) {
        const { params, defaults } = this.parseParameters(paramListNode, scope);
        scope.modules.set(nameNode.text.trim(), { params, defaults, bodyNode, scope });
      }
      return;
    }

    if (type === "FunctionDeclaration") {
      const nameNode = this.findChildByType(stmtNode, "IDENTIFIER");
      const paramListNode = this.findChildByType(stmtNode, "ParameterList");
      const exprNode = this.findChildByType(stmtNode, "Expression");
      if (nameNode && exprNode) {
        const { params, defaults } = this.parseParameters(paramListNode, scope);
        scope.functions.set(nameNode.text.trim(), { params, defaults, bodyNode: exprNode, scope });
      }
      return;
    }

    if (type === "IfStatement") {
      const condNode = this.findChildByType(stmtNode, "Expression");
      const condVal = condNode ? this.evaluateExpression(condNode, scope) : false;
      const children = stmtNode.children ?? [];
      const stmts: any[] = [];
      for (const c of children) {
        if (c.type === "Statement" || c.type === "BlockStatement") stmts.push(c);
      }
      if (condVal && stmts[0]) {
        this.evaluateStatement(stmts[0], scope, outSolids);
      } else if (!condVal && stmts[1]) {
        this.evaluateStatement(stmts[1], scope, outSolids);
      }
      return;
    }

    if (type === "ForStatement") {
      const varNode = this.findChildByType(stmtNode, "IDENTIFIER");
      const exprNode = this.findChildByType(stmtNode, "Expression");
      const bodyNode = this.findChildByType(stmtNode, "Statement") ?? this.findChildByType(stmtNode, "BlockStatement");
      if (varNode && exprNode && bodyNode) {
        const rangeOrList = this.evaluateExpression(exprNode, scope);
        const loopScope = new Scope(scope);
        if (Array.isArray(rangeOrList)) {
          for (const item of rangeOrList) {
            loopScope.setVar(varNode.text.trim(), item);
            this.evaluateStatement(bodyNode, loopScope, outSolids);
          }
        }
      }
      return;
    }

    if (type === "BlockStatement") {
      const blockScope = new Scope(scope);
      this.evaluateStatements(stmtNode, blockScope, outSolids);
      return;
    }

    if (type === "ChainedSolidStatement") {
      const chained = this.findChildByType(stmtNode, "ChainedSolid");
      if (chained) {
        const solid = this.evaluateChainedSolid(chained, scope);
        if (solid) outSolids.push(solid);
      }
      return;
    }

    if (type === "PrefixSolid") {
      const solid = this.evaluatePrefixSolid(stmtNode, scope);
      if (solid) outSolids.push(solid);
      return;
    }

    // Direct primitive or solid
    const solid = this.tryEvaluateSolid(stmtNode, scope);
    if (solid) outSolids.push(solid);
  }

  private evaluateChainedSolid(chainedNode: any, scope: Scope): Solid | null {
    const primaryNode = this.findChildByType(chainedNode, "PrimarySolid");
    if (!primaryNode) return null;

    let currentSolid = this.evaluatePrimarySolid(primaryNode, scope);
    if (!currentSolid) return null;

    // Evaluate method calls in sequence
    for (let i = 0; i < chainedNode.childCount; i++) {
      const c = chainedNode.child(i);
      if (!c || c.type !== "MethodCall") continue;

      const methodNameNode = this.findChildByType(c, "MethodName") ?? this.findChildByType(c, "IDENTIFIER");
      const argListNode = this.findChildByType(c, "ArgumentList");
      const methodName = methodNameNode ? methodNameNode.text.trim() : "";
      const args = this.evaluateArgumentList(argListNode, scope);

      currentSolid = this.applyMethod(currentSolid, methodName, args);
    }

    return currentSolid;
  }

  private applyMethod(target: Solid, method: string, args: { positional: any[]; named: Map<string, any> }): Solid {
    switch (method) {
      case "fillet": {
        const r = typeof args.positional[0] === "number" ? args.positional[0] : (args.named.get("r") ?? 1.0);
        return fillet(target, r);
      }
      case "chamfer": {
        const d = typeof args.positional[0] === "number" ? args.positional[0] : (args.named.get("d") ?? 1.0);
        return chamfer(target, d);
      }
      case "translate": {
        const v = args.positional[0] ?? [0, 0, 0];
        const vec: Vec3 = [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
        return translate(target, vec);
      }
      case "rotate": {
        const v = args.positional[0] ?? [0, 0, 0];
        const vec: Vec3 = [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
        return applyEulerRotation(target, vec);
      }
      case "scale": {
        const v = args.positional[0] ?? [1, 1, 1];
        const vec: Vec3 = [v[0] ?? 1, v[1] ?? 1, v[2] ?? 1];
        return scale(target, vec);
      }
      case "mirror": {
        const v = args.positional[0] ?? [0, 0, 1];
        const vec: Vec3 = [v[0] ?? 0, v[1] ?? 0, v[2] ?? 1];
        return mirror(target, vec);
      }
      default:
        return target;
    }
  }

  private evaluatePrimarySolid(primaryNode: any, scope: Scope): Solid | null {
    const inner = primaryNode.child(0);
    if (!inner) return null;
    return this.tryEvaluateSolid(inner, scope);
  }

  private evaluatePrefixSolid(prefixNode: any, scope: Scope): Solid | null {
    const opNode =
      this.findChildByType(prefixNode, "TransformOp") ??
      this.findChildByType(prefixNode, "LinearExtrudeOp") ??
      this.findChildByType(prefixNode, "BooleanOp") ??
      this.findChildByType(prefixNode, "TagPortOp");
    const childNode =
      this.findChildByType(prefixNode, "Statement") ?? this.findChildByType(prefixNode, "BlockStatement");

    if (!opNode || !childNode) return null;

    const opText = opNode.text.trim();

    // 0. LinearExtrudeOp: linear_extrude(height, twist, scale)
    if (opNode.type === "LinearExtrudeOp" || opText.startsWith("linear_extrude")) {
      const argListNode = this.findChildByType(opNode, "ArgumentList");
      const args = this.evaluateArgumentList(argListNode, scope);
      const height = Number(args.positional[0] ?? args.named.get("height") ?? 10);
      const twist = args.named.has("twist") ? Number(args.named.get("twist")) : undefined;
      const scale = args.named.has("scale") ? Number(args.named.get("scale")) : undefined;

      const childSolids: Solid[] = [];
      this.evaluateStatement(childNode, scope, childSolids);
      if (childSolids.length > 0) {
        const first = childSolids[0];
        if (first.kind === SolidKind.Extrusion) {
          return linearExtrude(first.polygon, height, { twist, scale });
        }
        return first;
      }
      return null;
    }

    // Collect child solids
    const childSolids: Solid[] = [];
    this.evaluateStatement(childNode, scope, childSolids);
    if (childSolids.length === 0) return null;

    // 1. TagPortOp: tag_port("name", "type", normal)
    if (opNode.type === "TagPortOp" || opText.startsWith("tag_port")) {
      const argListNode = this.findChildByType(opNode, "ArgumentList");
      const args = this.evaluateArgumentList(argListNode, scope);
      const portName = String(args.positional[0] ?? args.named.get("name") ?? "port");
      const portType = (args.positional[1] ?? args.named.get("type") ?? "mechanical_flange") as BoundaryPatchType;
      const rawNorm = args.positional[2] ?? args.named.get("normal");
      const normal: Vec3 | undefined = Array.isArray(rawNorm)
        ? [rawNorm[0] ?? 0, rawNorm[1] ?? 0, rawNorm[2] ?? 1]
        : undefined;

      let combinedChild = childSolids[0];
      for (let i = 1; i < childSolids.length; i++) {
        combinedChild = union(combinedChild, childSolids[i]);
      }
      return tagPatch(combinedChild, { portName, portType, normal });
    }

    // 2. BooleanOp: union, difference, intersection
    if (opNode.type === "BooleanOp" || /^(union|difference|intersection)/.test(opText)) {
      if (opText.startsWith("union")) {
        let acc = childSolids[0];
        for (let i = 1; i < childSolids.length; i++) {
          acc = union(acc, childSolids[i]);
        }
        return acc;
      }
      if (opText.startsWith("difference")) {
        let acc = childSolids[0];
        for (let i = 1; i < childSolids.length; i++) {
          acc = subtract(acc, childSolids[i]);
        }
        return acc;
      }
      if (opText.startsWith("intersection")) {
        let acc = childSolids[0];
        for (let i = 1; i < childSolids.length; i++) {
          acc = intersect(acc, childSolids[i]);
        }
        return acc;
      }
    }

    // 3. TransformOp: translate, rotate, scale, mirror
    const argListNode = this.findChildByType(opNode, "ArgumentList");
    const args = this.evaluateArgumentList(argListNode, scope);

    let combinedChild = childSolids[0];
    for (let i = 1; i < childSolids.length; i++) {
      combinedChild = union(combinedChild, childSolids[i]);
    }

    if (opText.startsWith("translate")) {
      const v = args.positional[0] ?? [0, 0, 0];
      const vec: Vec3 = [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
      return translate(combinedChild, vec);
    }
    if (opText.startsWith("rotate")) {
      const v = args.positional[0] ?? [0, 0, 0];
      const vec: Vec3 = [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
      return applyEulerRotation(combinedChild, vec);
    }
    if (opText.startsWith("scale")) {
      const v = args.positional[0] ?? [1, 1, 1];
      const vec: Vec3 = [v[0] ?? 1, v[1] ?? 1, v[2] ?? 1];
      return scale(combinedChild, vec);
    }
    if (opText.startsWith("mirror")) {
      const v = args.positional[0] ?? [0, 0, 1];
      const vec: Vec3 = [v[0] ?? 0, v[1] ?? 0, v[2] ?? 1];
      return mirror(combinedChild, vec);
    }

    return combinedChild;
  }

  private tryEvaluateSolid(node: any, scope: Scope): Solid | null {
    const type = node.type;

    if (type === "CubePrimitive") {
      const args = this.evaluateArgumentList(this.findChildByType(node, "ArgumentList"), scope);
      const size = args.positional[0] ?? args.named.get("size") ?? [1, 1, 1];
      const center = args.named.get("center") ?? false;
      const w = Array.isArray(size) ? (size[0] ?? 1) : Number(size);
      const h = Array.isArray(size) ? (size[1] ?? 1) : Number(size);
      const d = Array.isArray(size) ? (size[2] ?? 1) : Number(size);

      const b = box({ width: w, height: h, depth: d });
      if (center) return b;
      return translate(b, [w / 2, h / 2, d / 2]);
    }

    if (type === "CylinderPrimitive") {
      const args = this.evaluateArgumentList(this.findChildByType(node, "ArgumentList"), scope);
      const h = Number(args.positional[0] ?? args.named.get("h") ?? 1);
      const r = Number(
        args.named.get("r") ?? (args.named.has("d") ? args.named.get("d") / 2 : (args.positional[1] ?? 1)),
      );
      const fn = scope.getVar("$fn") ?? 24;
      const center = args.named.get("center") ?? false;

      const c = cylinder({ radius: r, height: h, segments: Math.max(8, Number(fn)) });
      if (center) return c;
      return translate(c, [0, h / 2, 0]);
    }

    if (type === "SpherePrimitive") {
      const args = this.evaluateArgumentList(this.findChildByType(node, "ArgumentList"), scope);
      const r = Number(
        args.positional[0] ?? args.named.get("r") ?? (args.named.has("d") ? args.named.get("d") / 2 : 1),
      );
      const fn = scope.getVar("$fn") ?? 16;
      return sphere({
        radius: r,
        widthSegments: Math.max(8, Number(fn)),
        heightSegments: Math.max(6, Math.floor(Number(fn) / 2)),
      });
    }

    if (type === "PolygonPrimitive") {
      const args = this.evaluateArgumentList(this.findChildByType(node, "ArgumentList"), scope);
      const points = args.positional[0] ?? args.named.get("points") ?? [];
      const poly: [number, number][] = [];
      if (Array.isArray(points)) {
        for (const pt of points) {
          if (Array.isArray(pt)) {
            poly.push([Number(pt[0] ?? 0), Number(pt[1] ?? 0)]);
          }
        }
      }
      return linearExtrude(
        poly.length >= 3
          ? poly
          : [
              [0, 0],
              [1, 0],
              [0, 1],
            ],
        1.0,
      );
    }

    if (type === "SquarePrimitive") {
      const args = this.evaluateArgumentList(this.findChildByType(node, "ArgumentList"), scope);
      const size = args.positional[0] ?? args.named.get("size") ?? [1, 1];
      const center = args.named.get("center") ?? false;
      const w = Array.isArray(size) ? Number(size[0] ?? 1) : Number(size);
      const h = Array.isArray(size) ? Number(size[1] ?? 1) : Number(size);
      const poly: [number, number][] = center
        ? [
            [-w / 2, -h / 2],
            [w / 2, -h / 2],
            [w / 2, h / 2],
            [-w / 2, h / 2],
          ]
        : [
            [0, 0],
            [w, 0],
            [w, h],
            [0, h],
          ];
      return linearExtrude(poly, 1.0);
    }

    if (type === "CirclePrimitive") {
      const args = this.evaluateArgumentList(this.findChildByType(node, "ArgumentList"), scope);
      const r = Number(
        args.named.get("r") ?? (args.named.has("d") ? args.named.get("d") / 2 : (args.positional[0] ?? 1)),
      );
      const fn = Math.max(8, Number(scope.getVar("$fn") ?? 24));
      const poly: [number, number][] = [];
      for (let i = 0; i < fn; i++) {
        const th = (i / fn) * 2 * Math.PI;
        poly.push([r * Math.cos(th), r * Math.sin(th)]);
      }
      return linearExtrude(poly, 1.0);
    }

    if (type === "ModuleInstantiation") {
      const nameNode = this.findChildByType(node, "IDENTIFIER");
      if (!nameNode) return null;
      const modName = nameNode.text.trim();
      const modDef = scope.getModule(modName);
      if (!modDef) return null;

      const argListNode = this.findChildByType(node, "ArgumentList");
      const args = this.evaluateArgumentList(argListNode, scope);

      const modScope = new Scope(modDef.scope);
      for (let i = 0; i < modDef.params.length; i++) {
        const pName = modDef.params[i];
        let val = args.positional[i];
        if (val === undefined && args.named.has(pName)) val = args.named.get(pName);
        if (val === undefined && modDef.defaults.has(pName)) val = modDef.defaults.get(pName);
        modScope.setVar(pName, val);
      }

      const modSolids: Solid[] = [];
      this.evaluateStatement(modDef.bodyNode, modScope, modSolids);
      if (modSolids.length === 0) return null;
      if (modSolids.length === 1) return modSolids[0];

      let acc = modSolids[0];
      for (let i = 1; i < modSolids.length; i++) {
        acc = union(acc, modSolids[i]);
      }
      return acc;
    }

    return null;
  }

  // ── Expressions ──────────────────────────────────────────────────────────

  public evaluateExpression(exprNode: any, scope: Scope): any {
    const type = exprNode.type;

    if (type === "Expression" || type === "PrimaryExpression") {
      const inner = exprNode.child(0);
      return inner ? this.evaluateExpression(inner, scope) : undefined;
    }

    if (type === "NUMBER") {
      return parseFloat(exprNode.text);
    }

    if (type === "STRING") {
      const raw = exprNode.text;
      return raw.slice(1, -1).replace(/\\"/g, '"');
    }

    if (type === "BOOLEAN") {
      return exprNode.text === "true";
    }

    if (type === "UNDEF") {
      return undefined;
    }

    if (type === "IDENTIFIER") {
      const name = exprNode.text.trim();
      return scope.getVar(name);
    }

    if (type === "VectorLiteral") {
      const elements: any[] = [];
      for (let i = 0; i < exprNode.childCount; i++) {
        const c = exprNode.child(i);
        if (c && (c.type === "Expression" || c.type.endsWith("Expression"))) {
          elements.push(this.evaluateExpression(c, scope));
        }
      }
      return elements;
    }

    if (type === "RangeLiteral") {
      const exprs: any[] = [];
      for (let i = 0; i < exprNode.childCount; i++) {
        const c = exprNode.child(i);
        if (c && (c.type === "Expression" || c.type.endsWith("Expression"))) {
          exprs.push(this.evaluateExpression(c, scope));
        }
      }
      const start = Number(exprs[0] ?? 0);
      let step = 1;
      let end = start;
      if (exprs.length === 2) {
        end = Number(exprs[1]);
      } else if (exprs.length >= 3) {
        step = Number(exprs[1]);
        end = Number(exprs[2]);
      }
      const result: number[] = [];
      if (step > 0) {
        for (let v = start; v <= end; v += step) result.push(v);
      } else if (step < 0) {
        for (let v = start; v >= end; v += step) result.push(v);
      }
      return result;
    }

    if (type === "BinaryExpression") {
      const exprs: any[] = [];
      let op = "";
      for (let i = 0; i < exprNode.childCount; i++) {
        const c = exprNode.child(i);
        if (!c) continue;
        if (c.type === "Expression" || c.type.endsWith("Expression")) {
          exprs.push(this.evaluateExpression(c, scope));
        } else if (/^(\+|-|\*|\/|%|\^|==|!=|<|<=|>|>=|&&|\|\|)$/.test(c.text.trim())) {
          op = c.text.trim();
        }
      }
      const left = exprs[0];
      const right = exprs[1];

      // Vector arithmetic support
      if (Array.isArray(left) && Array.isArray(right) && left.length === right.length) {
        if (op === "+") return left.map((v, i) => v + right[i]);
        if (op === "-") return left.map((v, i) => v - right[i]);
        if (op === "*") return left.map((v, i) => v * right[i]);
        if (op === "/") return left.map((v, i) => v / right[i]);
      }
      if (Array.isArray(left) && typeof right === "number") {
        if (op === "*") return left.map((v) => v * right);
        if (op === "/") return left.map((v) => v / right);
        if (op === "+") return left.map((v) => v + right);
        if (op === "-") return left.map((v) => v - right);
      }

      switch (op) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          return right !== 0 ? left / right : 0;
        case "%":
          return left % right;
        case "^":
          return Math.pow(left, right);
        case "==":
          return left === right;
        case "!=":
          return left !== right;
        case "<":
          return left < right;
        case "<=":
          return left <= right;
        case ">":
          return left > right;
        case ">=":
          return left >= right;
        case "&&":
          return Boolean(left && right);
        case "||":
          return Boolean(left || right);
        default:
          return left;
      }
    }

    if (type === "UnaryExpression") {
      const op = exprNode.child(0)?.text.trim() ?? "";
      const valNode = this.findChildByType(exprNode, "Expression");
      const val = valNode ? this.evaluateExpression(valNode, scope) : 0;
      if (op === "!") return !val;
      if (op === "-") return -val;
      return val;
    }

    if (type === "ConditionalExpression") {
      const exprs: any[] = [];
      for (let i = 0; i < exprNode.childCount; i++) {
        const c = exprNode.child(i);
        if (c && (c.type === "Expression" || c.type.endsWith("Expression"))) {
          exprs.push(c);
        }
      }
      const cond = exprs[0] ? this.evaluateExpression(exprs[0], scope) : false;
      if (cond && exprs[1]) return this.evaluateExpression(exprs[1], scope);
      if (!cond && exprs[2]) return this.evaluateExpression(exprs[2], scope);
      return undefined;
    }

    if (type === "PostfixExpression") {
      const first = exprNode.child(0);
      if (!first) return undefined;
      const target = this.evaluateExpression(first, scope);

      const second = exprNode.child(1);
      if (second?.text === "[") {
        const idxNode = this.findChildByType(exprNode, "Expression");
        const idx = idxNode ? this.evaluateExpression(idxNode, scope) : 0;
        return Array.isArray(target) ? target[idx] : undefined;
      }

      if (second?.text === "(") {
        const funcName = first.text.trim();
        const argListNode = this.findChildByType(exprNode, "ArgumentList");
        const args = this.evaluateArgumentList(argListNode, scope);

        // Built-in math functions (degrees for trig)
        const rad = (d: number) => (d * Math.PI) / 180;
        const deg = (r: number) => (r * 180) / Math.PI;
        const x = args.positional[0];

        switch (funcName) {
          case "sin":
            return Math.sin(rad(x));
          case "cos":
            return Math.cos(rad(x));
          case "tan":
            return Math.tan(rad(x));
          case "asin":
            return deg(Math.asin(x));
          case "acos":
            return deg(Math.acos(x));
          case "atan":
            return deg(Math.atan(x));
          case "atan2":
            return deg(Math.atan2(x, args.positional[1]));
          case "sqrt":
            return Math.sqrt(x);
          case "pow":
            return Math.pow(x, args.positional[1]);
          case "abs":
            return Math.abs(x);
          case "min":
            return Math.min(...args.positional);
          case "max":
            return Math.max(...args.positional);
          case "floor":
            return Math.floor(x);
          case "ceil":
            return Math.ceil(x);
          case "round":
            return Math.round(x);
          case "len":
            return Array.isArray(x) ? x.length : 0;
        }

        const userFunc = scope.getFunc(funcName);
        if (userFunc) {
          const fnScope = new Scope(userFunc.scope);
          for (let i = 0; i < userFunc.params.length; i++) {
            const p = userFunc.params[i];
            let v = args.positional[i];
            if (v === undefined && args.named.has(p)) v = args.named.get(p);
            if (v === undefined && userFunc.defaults.has(p)) v = userFunc.defaults.get(p);
            fnScope.setVar(p, v);
          }
          return this.evaluateExpression(userFunc.bodyNode, fnScope);
        }
      }
    }

    if (type === "ParenthesizedExpression") {
      const inner = this.findChildByType(exprNode, "Expression");
      return inner ? this.evaluateExpression(inner, scope) : undefined;
    }

    return undefined;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private evaluateArgumentList(argListNode: any, scope: Scope): { positional: any[]; named: Map<string, any> } {
    const positional: any[] = [];
    const named = new Map<string, any>();
    if (!argListNode) return { positional, named };

    for (let i = 0; i < argListNode.childCount; i++) {
      const arg = argListNode.child(i);
      if (!arg || arg.type !== "Argument") continue;

      const nameNode = this.findChildByType(arg, "IDENTIFIER");
      const exprNode = this.findChildByType(arg, "Expression") ?? this.findChildByType(arg, "PrimaryExpression");
      if (nameNode && exprNode && arg.childCount >= 3 && arg.child(1)?.text === "=") {
        named.set(nameNode.text.trim(), this.evaluateExpression(exprNode, scope));
      } else if (exprNode) {
        positional.push(this.evaluateExpression(exprNode, scope));
      }
    }

    return { positional, named };
  }

  private parseParameters(paramListNode: any, scope: Scope): { params: string[]; defaults: Map<string, any> } {
    const params: string[] = [];
    const defaults = new Map<string, any>();
    if (!paramListNode) return { params, defaults };

    for (let i = 0; i < paramListNode.childCount; i++) {
      const p = paramListNode.child(i);
      if (!p || p.type !== "Parameter") continue;

      const nameNode = this.findChildByType(p, "IDENTIFIER");
      const defNode = this.findChildByType(p, "Expression");
      if (nameNode) {
        const name = nameNode.text.trim();
        params.push(name);
        if (defNode) {
          defaults.set(name, this.evaluateExpression(defNode, scope));
        }
      }
    }

    return { params, defaults };
  }

  private findChildByType(node: any, targetType: string): any {
    if (!node) return null;
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c && c.type === targetType) return c;
    }
    return null;
  }
}
