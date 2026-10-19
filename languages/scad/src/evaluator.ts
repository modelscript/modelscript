// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview OpenSCAD Language Evaluator & Constructive Solid Geometry (CSG) Engine.
 *
 * Academic Citations:
 * - Requicha, A. A. (1980). Representations for rigid solids: Theory, methods, and systems.
 *   ACM Computing Surveys, 12(4), 437-464. https://doi.org/10.1145/356827.356833
 * - Foley, J. D., Van Dam, A., Feiner, S. K., & Hughes, J. F. (1996). Computer Graphics:
 *   Principles and Practice (2nd ed.). Addison-Wesley. Chapter 12: Constructive Solid Geometry.
 * - Kienzle, M. (2009). OpenSCAD: The Programmers Solid 3D CAD Modeller. https://openscad.org
 *
 * ModelScript Architectural Rationale:
 * Cyber-physical systems (CPS) require tight co-design between 1D lumped-parameter dynamic models
 * (Modelica) and 3D geometric packaging (CAD/CFD). Physical properties such as mass, moments of inertia,
 * thermal dissipation area, and hydraulic flow restrictions depend directly on 3D geometry.
 * The SCAD evaluator executes declarative OpenSCAD models, resolving parametric modules, loops, and
 * mathematical transformations into normalized CSG solid trees (`@modelscript/cad`) for downstream
 * OpenCascade B-Rep evaluation, STEP (ISO 10303) export, and 3D CFD meshing.
 *
 * ModelScript Modifications:
 * - Augments geometric primitives with CFD boundary patch tags (`tagPatch`, `BoundaryPatchType`:
 *   inlet, outlet, wall, symmetry) to directly link 3D geometry with SU2/OpenFOAM CFD boundary conditions.
 * - Injects bidirectional parameter bindings between Modelica simulation parameters and SCAD variables.
 * - Preserves AST source mapping (`SolidSourceMetadata`) on generated solids for interactive visual picking in the 3D IDE.
 */

import {
  box,
  chamfer,
  cylinder,
  fillet,
  intersect,
  linearExtrude,
  mirror,
  polyhedron,
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
  type SolidSourceMetadata,
  type Vec3,
} from "@modelscript/cad";

/**
 * Options for configuring an OpenSCAD evaluation run, such as externally injected variables.
 */
export interface ScadEvaluationOptions {
  /** Optional map of initial variable bindings (e.g., synchronized from Modelica parameters). */
  variables?: Record<string, any> | undefined;
}

/**
 * Standard named color palette mapped to normalized RGBA `[r, g, b, a]` tuples in `[0, 1]`.
 */
const NAMED_COLORS: Record<string, [number, number, number, number]> = {
  red: [0.9, 0.2, 0.2, 1],
  green: [0.2, 0.8, 0.3, 1],
  blue: [0.2, 0.45, 0.95, 1],
  yellow: [0.95, 0.85, 0.2, 1],
  cyan: [0.2, 0.85, 0.9, 1],
  magenta: [0.9, 0.25, 0.85, 1],
  orange: [0.95, 0.55, 0.15, 1],
  white: [0.95, 0.95, 0.95, 1],
  gray: [0.6, 0.63, 0.68, 1],
  grey: [0.6, 0.63, 0.68, 1],
  silver: [0.75, 0.78, 0.82, 1],
  black: [0.15, 0.15, 0.18, 1],
  gold: [0.92, 0.75, 0.2, 1],
  steelblue: [0.27, 0.51, 0.71, 1],
};

/**
 * Parses an OpenSCAD `color()` argument (named color string, hex string, or RGB/RGBA array)
 * into a normalized `[r, g, b, a]` tuple with components clamped to `[0, 1]`.
 */
function parseScadColor(arg0: any, alphaArg?: any): [number, number, number, number] | undefined {
  const alpha = typeof alphaArg === "number" ? Math.max(0, Math.min(1, alphaArg)) : undefined;
  if (typeof arg0 === "string") {
    const key = arg0.toLowerCase().trim();
    const named = NAMED_COLORS[key];
    if (named) {
      return [named[0], named[1], named[2], alpha ?? named[3]];
    }
    if (key.startsWith("#") && (key.length === 7 || key.length === 9)) {
      const r = parseInt(key.slice(1, 3), 16) / 255;
      const g = parseInt(key.slice(3, 5), 16) / 255;
      const b = parseInt(key.slice(5, 7), 16) / 255;
      const a = key.length === 9 ? parseInt(key.slice(7, 9), 16) / 255 : (alpha ?? 1);
      return [r, g, b, a];
    }
  }
  if (Array.isArray(arg0) && arg0.length >= 3) {
    let r = Number(arg0[0] ?? 0.7);
    let g = Number(arg0[1] ?? 0.7);
    let b = Number(arg0[2] ?? 0.7);
    let a = arg0[3] !== undefined ? Number(arg0[3]) : (alpha ?? 1);
    if (r > 1 || g > 1 || b > 1) {
      r /= 255;
      g /= 255;
      b /= 255;
    }
    return [
      Math.max(0, Math.min(1, r)),
      Math.max(0, Math.min(1, g)),
      Math.max(0, Math.min(1, b)),
      Math.max(0, Math.min(1, a)),
    ];
  }
  return undefined;
}

/**
 * Returns a shallow frozen copy of `solid` with an updated RGBA `color` attached to `sourceMetadata`.
 */
function withSolidColor(solid: Solid, color?: [number, number, number, number]): Solid {
  if (!color) return solid;
  return Object.freeze({
    ...solid,
    sourceMetadata: {
      ...(solid.sourceMetadata ?? {}),
      color,
    },
  }) as Solid;
}

/**
 * Hierarchical lexical environment storing OpenSCAD variables, functions, and modules.
 */
class Scope {
  public variables = new Map<string, any>();
  public functions = new Map<
    string,
    { params: string[]; defaults: Map<string, any>; defaultExprs?: Map<string, any>; bodyNode: any; scope: Scope }
  >();
  public modules = new Map<
    string,
    { params: string[]; defaults: Map<string, any>; defaultExprs?: Map<string, any>; bodyNode: any; scope: Scope }
  >();

  constructor(public parent: Scope | null = null) {
    if (!parent) {
      this.initBuiltins();
    }
  }

  /**
   * Initializes OpenSCAD special variables (`$fn`, `$fa`, `$fs`, `$t`) and `PI` in the root scope.
   */
  private initBuiltins(): void {
    this.variables.set("$fn", 32);
    this.variables.set("$fa", 12);
    this.variables.set("$fs", 2);
    this.variables.set("$t", 0);
    this.variables.set("PI", Math.PI);
  }

  /**
   * Resolves a variable value by walking up the lexical scope chain.
   */
  getVar(name: string): any {
    if (this.variables.has(name)) return this.variables.get(name);
    if (this.parent) return this.parent.getVar(name);
    return undefined;
  }

  /**
   * Binds or updates a variable in the current scope.
   */
  setVar(name: string, val: any): void {
    this.variables.set(name, val);
  }

  /**
   * Resolves a user-defined function signature by walking up the scope chain.
   */
  getFunc(
    name: string,
  ):
    | { params: string[]; defaults: Map<string, any>; defaultExprs?: Map<string, any>; bodyNode: any; scope: Scope }
    | undefined {
    if (this.functions.has(name)) return this.functions.get(name);
    if (this.parent) return this.parent.getFunc(name);
    return undefined;
  }

  /**
   * Resolves a user-defined module signature by walking up the scope chain.
   */
  getModule(
    name: string,
  ):
    | { params: string[]; defaults: Map<string, any>; defaultExprs?: Map<string, any>; bodyNode: any; scope: Scope }
    | undefined {
    if (this.modules.has(name)) return this.modules.get(name);
    if (this.parent) return this.parent.getModule(name);
    return undefined;
  }
}

/**
 * Applies OpenSCAD intrinsic XYZ Euler angle rotations (`[rx, ry, rz]` in degrees) sequentially to a solid.
 */
function applyEulerRotation(solid: Solid, rot: Vec3, sourceMeta?: SolidSourceMetadata): Solid {
  let s = solid;
  if (rot[0]) s = rotate(s, [1, 0, 0], rot[0], sourceMeta);
  if (rot[1]) s = rotate(s, [0, 1, 0], rot[1], sourceMeta);
  if (rot[2]) s = rotate(s, [0, 0, 1], rot[2], sourceMeta);
  if (!rot[0] && !rot[1] && !rot[2] && sourceMeta) {
    s = rotate(s, [0, 0, 1], 0, sourceMeta);
  }
  return s;
}

/**
 * Interpreter that evaluates OpenSCAD CST nodes into `@modelscript/cad` CSG `Solid` trees.
 */
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
   * Evaluates a parsed SourceFile CST root node into a list of top-level Solid parts.
   */
  public evaluateParts(rootNode: any): Solid[] {
    const solids: Solid[] = [];
    this.evaluateStatements(rootNode, this.globalScope, solids);
    return solids;
  }

  /**
   * Evaluates a parsed SourceFile CST root node into a combined Solid geometry tree.
   */
  public evaluate(rootNode: any): Solid | null {
    const solids = this.evaluateParts(rootNode);

    if (solids.length === 0) return null;
    if (solids.length === 1) return solids[0]!;

    // Combine multiple top-level solids via union
    let acc = solids[0]!;
    for (let i = 1; i < solids.length; i++) {
      acc = union(acc, solids[i]!);
    }
    return acc;
  }

  /**
   * Evaluates all child statements of a block or root node in order, pre-scanning and hoisting
   * `function` and `module` declarations before evaluating variables and geometry statements.
   */
  private evaluateStatements(containerNode: any, scope: Scope, outSolids: Solid[]): void {
    // Pass 1a: Hoist function declarations so functions and module defaults can call them regardless of order
    for (let i = 0; i < containerNode.childCount; i++) {
      let stmt = containerNode.child(i);
      if (!stmt) continue;
      if (stmt.type === "Statement") stmt = stmt.child(0);
      if (stmt && stmt.type === "FunctionDeclaration") {
        this.registerFunctionDeclaration(stmt, scope);
      }
    }

    // Pass 1b: Hoist module declarations before evaluating geometry statements
    for (let i = 0; i < containerNode.childCount; i++) {
      let stmt = containerNode.child(i);
      if (!stmt) continue;
      if (stmt.type === "Statement") stmt = stmt.child(0);
      if (stmt && stmt.type === "ModuleDeclaration") {
        this.registerModuleDeclaration(stmt, scope);
      }
    }

    // Pass 2: Evaluate variable assignments, control flow, and geometry statements in order
    for (let i = 0; i < containerNode.childCount; i++) {
      const stmt = containerNode.child(i);
      if (!stmt) continue;
      this.evaluateStatement(stmt, scope, outSolids);
    }
  }

  private registerModuleDeclaration(stmtNode: any, scope: Scope): void {
    const nameNode = this.findChildByType(stmtNode, "IDENTIFIER");
    const paramListNode = this.findChildByType(stmtNode, "ParameterList");
    const bodyNode = this.findChildByType(stmtNode, "Statement") ?? this.findChildByType(stmtNode, "BlockStatement");
    if (nameNode && bodyNode) {
      const { params, defaults, defaultExprs } = this.parseParameters(paramListNode, scope);
      scope.modules.set(nameNode.text.trim(), { params, defaults, defaultExprs, bodyNode, scope });
    }
  }

  private registerFunctionDeclaration(stmtNode: any, scope: Scope): void {
    const nameNode = this.findChildByType(stmtNode, "IDENTIFIER");
    const paramListNode = this.findChildByType(stmtNode, "ParameterList");
    const exprNode = this.findChildByType(stmtNode, "Expression");
    if (nameNode && exprNode) {
      const { params, defaults, defaultExprs } = this.parseParameters(paramListNode, scope);
      scope.functions.set(nameNode.text.trim(), { params, defaults, defaultExprs, bodyNode: exprNode, scope });
    }
  }

  /**
   * Dispatches evaluation for a single statement node (declarations, control flow, prefix or chained solids).
   */
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
      this.registerModuleDeclaration(stmtNode, scope);
      return;
    }

    if (type === "FunctionDeclaration") {
      this.registerFunctionDeclaration(stmtNode, scope);
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

  /**
   * Evaluates a fluent method-chained solid expression (`cube(...).translate(...).fillet(...)`),
   * recording source byte ranges on each transformation step for interactive 3D gizmo writeback.
   */
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
      const startOffset = c.startIndex ?? c.startOffset;
      const endOffset = c.endIndex ?? c.endOffset;

      const sourceMeta: SolidSourceMetadata = {
        transformMethod: methodName,
        argIndex: 0,
        startOffset,
        endOffset,
        translateRange: methodName === "translate" ? { startOffset, endOffset, isFluent: true } : undefined,
        rotateRange: methodName === "rotate" ? { startOffset, endOffset, isFluent: true } : undefined,
        scaleRange: methodName === "scale" ? { startOffset, endOffset, isFluent: true } : undefined,
      };

      currentSolid = this.applyMethod(currentSolid, methodName, args, sourceMeta);
    }

    return currentSolid;
  }

  /**
   * Evaluates OpenSCAD `rotate` arguments supporting both Euler vector syntax (`rotate([rx, ry, rz])`)
   * and scalar/axis-angle syntax (`rotate(a)` or `rotate(a = 45, v = [0, 1, 0])`).
   */
  private applyScadRotation(
    target: Solid,
    args: { positional: any[]; named: Map<string, any> },
    sourceMeta?: SolidSourceMetadata,
  ): Solid {
    const aArg = args.positional[0] ?? args.named.get("a");
    const vArg = args.positional[1] ?? args.named.get("v");

    if (typeof aArg === "number") {
      const axis: Vec3 = Array.isArray(vArg)
        ? [Number(vArg[0] ?? 0), Number(vArg[1] ?? 0), Number(vArg[2] ?? 0)]
        : [0, 0, 1];
      const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
      const normAxis: Vec3 = [axis[0] / len, axis[1] / len, axis[2] / len];
      const eulerApprox: Vec3 = [normAxis[0] * aArg, normAxis[1] * aArg, normAxis[2] * aArg];
      const meta = sourceMeta ? { ...sourceMeta, rotation: eulerApprox } : { rotation: eulerApprox };
      return rotate(target, normAxis, aArg, meta);
    }

    const vecSource = Array.isArray(aArg) ? aArg : Array.isArray(vArg) ? vArg : [0, 0, 0];
    const vec: Vec3 = [Number(vecSource[0] ?? 0), Number(vecSource[1] ?? 0), Number(vecSource[2] ?? 0)];
    return applyEulerRotation(target, vec, sourceMeta ? { ...sourceMeta, rotation: vec } : { rotation: vec });
  }

  /**
   * Recursively updates 2D `ExtrusionSolid` leaf nodes inside boolean and transform CSG subtrees
   * with the target `linear_extrude` height, twist, and scale parameters.
   */
  private applyLinearExtrudeToTree(solid: Solid, height: number, twist?: number, scaleVal?: number): Solid {
    switch (solid.kind) {
      case SolidKind.Extrusion:
        return linearExtrude(solid.polygon, height, {
          twist: twist ?? solid.twist,
          scale: scaleVal ?? solid.scale,
          name: solid.name,
          sourceMetadata: solid.sourceMetadata,
        });
      case SolidKind.Union:
        return union(
          this.applyLinearExtrudeToTree(solid.left, height, twist, scaleVal),
          this.applyLinearExtrudeToTree(solid.right, height, twist, scaleVal),
        );
      case SolidKind.Subtract:
        return subtract(
          this.applyLinearExtrudeToTree(solid.left, height, twist, scaleVal),
          this.applyLinearExtrudeToTree(solid.right, height, twist, scaleVal),
        );
      case SolidKind.Intersect:
        return intersect(
          this.applyLinearExtrudeToTree(solid.left, height, twist, scaleVal),
          this.applyLinearExtrudeToTree(solid.right, height, twist, scaleVal),
        );
      case SolidKind.Transform:
        return Object.freeze({
          ...solid,
          child: this.applyLinearExtrudeToTree(solid.child, height, twist, scaleVal),
        }) as Solid;
      case SolidKind.TaggedPatch:
        return tagPatch(this.applyLinearExtrudeToTree(solid.child, height, twist, scaleVal), solid.tag);
      default:
        return solid;
    }
  }

  /**
   * Applies a single fluent CAD transformation or feature operation (`fillet`, `chamfer`, `translate`,
   * `rotate`, `scale`, `mirror`, `color`) to `target`.
   */
  private applyMethod(
    target: Solid,
    method: string,
    args: { positional: any[]; named: Map<string, any> },
    sourceMeta?: SolidSourceMetadata,
  ): Solid {
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
        const v = args.positional[0] ?? args.named.get("v") ?? [0, 0, 0];
        const vec: Vec3 = Array.isArray(v)
          ? [Number(v[0] ?? 0), Number(v[1] ?? 0), Number(v[2] ?? 0)]
          : [Number(v), 0, 0];
        return translate(target, vec, sourceMeta ? { ...sourceMeta, translation: vec } : { translation: vec });
      }
      case "rotate": {
        return this.applyScadRotation(target, args, sourceMeta);
      }
      case "scale": {
        const v = args.positional[0] ?? args.named.get("v") ?? [1, 1, 1];
        const vec: Vec3 = Array.isArray(v)
          ? [Number(v[0] ?? 1), Number(v[1] ?? 1), Number(v[2] ?? 1)]
          : [Number(v), Number(v), Number(v)];
        return scale(target, vec, sourceMeta ? { ...sourceMeta, scale: vec } : { scale: vec });
      }
      case "mirror": {
        const v = args.positional[0] ?? args.named.get("v") ?? [0, 0, 1];
        const vec: Vec3 = Array.isArray(v)
          ? [Number(v[0] ?? 0), Number(v[1] ?? 0), Number(v[2] ?? 1)]
          : [Number(v), 0, 0];
        return mirror(target, vec, sourceMeta);
      }
      case "color": {
        const cArg = args.positional[0] ?? args.named.get("c");
        const alphaArg = args.positional[1] ?? args.named.get("alpha");
        return withSolidColor(target, parseScadColor(cArg, alphaArg));
      }
      default:
        return target;
    }
  }

  /**
   * Unwraps a `PrimarySolid` CST node and evaluates its underlying primitive or module call.
   */
  private evaluatePrimarySolid(primaryNode: any, scope: Scope): Solid | null {
    const inner = primaryNode.child(0);
    if (!inner) return null;
    return this.tryEvaluateSolid(inner, scope);
  }

  /**
   * Evaluates a prefix-style OpenSCAD operation (`linear_extrude`, `tag_port`, `union`, `difference`,
   * `intersection`, `translate`, `rotate`, `scale`, `mirror`, `color`) applied to a child statement or block.
   */
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

    // 0. LinearExtrudeOp: linear_extrude(height, twist, scale, center)
    if (opNode.type === "LinearExtrudeOp" || opText.startsWith("linear_extrude")) {
      const argListNode = this.findChildByType(opNode, "ArgumentList");
      const args = this.evaluateArgumentList(argListNode, scope);
      const height = Number(args.positional[0] ?? args.named.get("height") ?? 10);
      const twist = args.named.has("twist") ? Number(args.named.get("twist")) : undefined;
      const scaleVal = args.named.has("scale") ? Number(args.named.get("scale")) : undefined;
      const center = Boolean(args.named.get("center") ?? false);

      const childSolids: Solid[] = [];
      this.evaluateStatement(childNode, scope, childSolids);
      if (childSolids.length > 0) {
        let combined = childSolids[0]!;
        for (let i = 1; i < childSolids.length; i++) {
          combined = union(combined, childSolids[i]!);
        }
        const extruded = this.applyLinearExtrudeToTree(combined, height, twist, scaleVal);
        return center ? translate(extruded, [0, 0, -height / 2]) : extruded;
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

      let combinedChild = childSolids[0]!;
      for (let i = 1; i < childSolids.length; i++) {
        combinedChild = union(combinedChild, childSolids[i]!);
      }
      return tagPatch(combinedChild, { portName, portType, normal });
    }

    // 2. BooleanOp: union, difference, intersection
    if (opNode.type === "BooleanOp" || /^(union|difference|intersection)/.test(opText)) {
      if (opText.startsWith("union")) {
        let acc = childSolids[0]!;
        for (let i = 1; i < childSolids.length; i++) {
          acc = union(acc, childSolids[i]!);
        }
        return acc;
      }
      if (opText.startsWith("difference")) {
        let acc = childSolids[0]!;
        for (let i = 1; i < childSolids.length; i++) {
          acc = subtract(acc, childSolids[i]!);
        }
        return acc;
      }
      if (opText.startsWith("intersection")) {
        let acc = childSolids[0]!;
        for (let i = 1; i < childSolids.length; i++) {
          acc = intersect(acc, childSolids[i]!);
        }
        return acc;
      }
    }

    // 3. TransformOp: translate, rotate, scale, mirror, color
    const argListNode = this.findChildByType(opNode, "ArgumentList");
    const args = this.evaluateArgumentList(argListNode, scope);

    let combinedChild = childSolids[0]!;
    for (let i = 1; i < childSolids.length; i++) {
      combinedChild = union(combinedChild, childSolids[i]!);
    }

    if (opText.startsWith("color")) {
      const cArg = args.positional[0] ?? args.named.get("c");
      const alphaArg = args.positional[1] ?? args.named.get("alpha");
      return withSolidColor(combinedChild, parseScadColor(cArg, alphaArg));
    }

    const startOffset = opNode.startIndex ?? opNode.startOffset;
    const endOffset = opNode.endIndex ?? opNode.endOffset;
    const transformMethod = opText.startsWith("translate")
      ? "translate"
      : opText.startsWith("rotate")
        ? "rotate"
        : opText.startsWith("scale")
          ? "scale"
          : opText.startsWith("mirror")
            ? "mirror"
            : undefined;

    const sourceMeta: SolidSourceMetadata = {
      transformMethod,
      argIndex: 0,
      startOffset,
      endOffset,
      translateRange: transformMethod === "translate" ? { startOffset, endOffset, isFluent: false } : undefined,
      rotateRange: transformMethod === "rotate" ? { startOffset, endOffset, isFluent: false } : undefined,
      scaleRange: transformMethod === "scale" ? { startOffset, endOffset, isFluent: false } : undefined,
    };

    if (opText.startsWith("translate")) {
      const v = args.positional[0] ?? args.named.get("v") ?? [0, 0, 0];
      const vec: Vec3 = Array.isArray(v)
        ? [Number(v[0] ?? 0), Number(v[1] ?? 0), Number(v[2] ?? 0)]
        : [Number(v), 0, 0];
      return translate(combinedChild, vec, { ...sourceMeta, translation: vec });
    }
    if (opText.startsWith("rotate")) {
      return this.applyScadRotation(combinedChild, args, sourceMeta);
    }
    if (opText.startsWith("scale")) {
      const v = args.positional[0] ?? args.named.get("v") ?? [1, 1, 1];
      const vec: Vec3 = Array.isArray(v)
        ? [Number(v[0] ?? 1), Number(v[1] ?? 1), Number(v[2] ?? 1)]
        : [Number(v), Number(v), Number(v)];
      return scale(combinedChild, vec, { ...sourceMeta, scale: vec });
    }
    if (opText.startsWith("mirror")) {
      const v = args.positional[0] ?? args.named.get("v") ?? [0, 0, 1];
      const vec: Vec3 = Array.isArray(v)
        ? [Number(v[0] ?? 0), Number(v[1] ?? 0), Number(v[2] ?? 1)]
        : [Number(v), 0, 0];
      return mirror(combinedChild, vec, sourceMeta);
    }

    return combinedChild;
  }

  /**
   * Collects all `IDENTIFIER` token texts within a subtree, using fast zero-allocation
   * WASM linear-memory traversal when available.
   */
  private collectIdentifiers(node: any): string[] {
    const list: string[] = [];
    // Fast path: walk WASM linear-memory CST directly without allocating intermediate wrapper nodes
    if (node && typeof node.ptr === "number" && node.ptr > 0 && node.tree?.mem32 && node.tree?.facade?.syntaxNames) {
      const mem32: Uint32Array = node.tree.mem32;
      const syntaxNames: string[] = node.tree.facade.syntaxNames;
      const exports = node.tree.facade.exports;
      const enc = node.tree.facade.getInputEncoding ? node.tree.facade.getInputEncoding() : (node.tree._encoding ?? 1);
      const div = enc === 1 || enc === 2 ? 2 : enc === 3 || enc === 4 ? 4 : 1;

      const ptrStack: number[] = [];
      const offsetStack: number[] = [];
      let curPtr = mem32[(node.ptr + 12) >>> 2]!;
      let curOff = (node._startOffset ?? 0) + (node._cachedPad ?? 0);

      while (true) {
        if (curPtr !== 0) {
          const tf = mem32[curPtr >>> 2]!;
          const tid = tf & 0x03ff;
          const tName = syntaxNames[tid] || "";
          const ehp = mem32[(curPtr + 4) >>> 2]!;
          const rPad = tf >>> 22;
          const isFat = (ehp >>> 23) & 1;
          const pad = isFat
            ? mem32[(curPtr + 28) >>> 2] ||
              (exports?.getFatPaddingPtr ? mem32[exports.getFatPaddingPtr(rPad) >>> 2]! : rPad)
            : rPad;
          const len = ehp & 0x007fffff;
          const isInv = (tf & (1 << 14)) !== 0;

          if (!isInv && tName === "IDENTIFIER" && node.tree.sourceCode) {
            const s = Math.floor((curOff + pad) / div);
            const e = Math.floor((curOff + pad + len) / div);
            list.push(node.tree.sourceCode.substring(s, e).trim());
          }

          const nextPtr = mem32[(curPtr + 16) >>> 2]!;
          const nextOff = curOff + pad + len;
          const grandChildPtr = mem32[(curPtr + 12) >>> 2]!;

          if (grandChildPtr !== 0) {
            if (nextPtr !== 0) {
              ptrStack.push(nextPtr);
              offsetStack.push(nextOff);
            }
            curPtr = grandChildPtr;
            curOff = curOff + pad;
          } else {
            curPtr = nextPtr;
            curOff = nextOff;
          }
        } else {
          if (ptrStack.length === 0) break;
          curPtr = ptrStack.pop()!;
          curOff = offsetStack.pop()!;
        }
      }
      return list;
    }

    const visit = (n: any) => {
      if (!n) return;
      if (n.type === "IDENTIFIER") {
        list.push(n.text.trim());
      }
      for (let i = 0; i < n.childCount; i++) {
        visit(n.child(i));
      }
    };
    visit(node);
    return list;
  }

  /**
   * Evaluates a 3D/2D primitive (`cube`, `cylinder`, `sphere`, `polyhedron`, `polygon`, `square`, `circle`)
   * or user-defined `ModuleInstantiation` into a `Solid` with attached source metadata.
   */
  private tryEvaluateSolid(node: any, scope: Scope): Solid | null {
    const type = node.type;

    if (type === "CubePrimitive") {
      const argListNode = this.findChildByType(node, "ArgumentList");
      const args = this.evaluateArgumentList(argListNode, scope);
      const size = args.positional[0] ?? args.named.get("size") ?? [1, 1, 1];
      const center = args.named.get("center") ?? false;
      const w = Number(Array.isArray(size) ? (size[0] ?? 1) : size);
      const h = Number(Array.isArray(size) ? (size[1] ?? 1) : size);
      const d = Number(Array.isArray(size) ? (size[2] ?? 1) : size);

      let paramName: string | undefined;
      let dimensionParams: [string | undefined, string | undefined, string | undefined] | undefined;
      if (argListNode) {
        const idents = this.collectIdentifiers(argListNode).filter((id) => id !== "size" && id !== "center");
        if (idents.length > 0) {
          paramName = idents[0];
          dimensionParams = [idents[0], idents[1] ?? idents[0], idents[2] ?? idents[0]];
        }
      }

      const startOffset = node.startIndex ?? node.startOffset;
      const endOffset = node.endIndex ?? node.endOffset;
      const sourceMeta: SolidSourceMetadata = {
        parameterName: paramName,
        dimensionParams,
        dimensions: [w, h, d],
        startOffset,
        endOffset,
        primitiveStartOffset: startOffset,
        primitiveEndOffset: endOffset,
      };

      const b = box({ width: w, height: h, depth: d, sourceMetadata: sourceMeta });
      if (center) return b;
      return translate(b, [w / 2, h / 2, d / 2]);
    }

    if (type === "CylinderPrimitive") {
      const argListNode = this.findChildByType(node, "ArgumentList");
      const args = this.evaluateArgumentList(argListNode, scope);
      const h = Number(args.positional[0] ?? args.named.get("h") ?? 1);
      const rDefault = Number(
        args.named.get("r") ?? (args.named.has("d") ? Number(args.named.get("d")) / 2 : (args.positional[1] ?? 1)),
      );
      const hasR1 = args.named.has("r1") || args.named.has("d1");
      const hasR2 = args.named.has("r2") || args.named.has("d2");
      const r1 = hasR1 ? Number(args.named.get("r1") ?? Number(args.named.get("d1")) / 2) : rDefault;
      const r2 = hasR2
        ? Number(args.named.get("r2") ?? Number(args.named.get("d2")) / 2)
        : args.positional[2] !== undefined
          ? Number(args.positional[2])
          : rDefault;
      const rAvg = (r1 + r2) / 2 || rDefault;

      const fn = scope.getVar("$fn") ?? 24;
      const center = args.named.get("center") ?? false;

      let paramName: string | undefined;
      let dimensionParams: [string | undefined, string | undefined, string | undefined] | undefined;
      if (argListNode) {
        const idents = this.collectIdentifiers(argListNode).filter(
          (id) => !["h", "r", "r1", "r2", "d", "d1", "d2", "center", "$fn"].includes(id),
        );
        if (idents.length > 0) {
          paramName = idents[0];
          dimensionParams = [idents[0], idents[1] ?? idents[0], idents[2] ?? idents[0]];
        }
      }

      const startOffset = node.startIndex ?? node.startOffset;
      const endOffset = node.endIndex ?? node.endOffset;
      const sourceMeta: SolidSourceMetadata = {
        parameterName: paramName,
        dimensionParams,
        dimensions: [rAvg, h, rAvg],
        startOffset,
        endOffset,
        primitiveStartOffset: startOffset,
        primitiveEndOffset: endOffset,
      };

      const c = cylinder({
        radius: rAvg,
        radiusBottom: r1,
        radiusTop: r2,
        height: h,
        segments: Math.max(8, Number(fn)),
        sourceMetadata: sourceMeta,
      });
      if (center) return c;
      return translate(c, [0, h / 2, 0]);
    }

    if (type === "SpherePrimitive") {
      const argListNode = this.findChildByType(node, "ArgumentList");
      const args = this.evaluateArgumentList(argListNode, scope);
      const r = Number(
        args.positional[0] ?? args.named.get("r") ?? (args.named.has("d") ? args.named.get("d") / 2 : 1),
      );
      const fn = scope.getVar("$fn") ?? 16;

      let paramName: string | undefined;
      if (argListNode) {
        const idents = this.collectIdentifiers(argListNode).filter((id) => !["r", "d", "$fn"].includes(id));
        if (idents.length > 0) paramName = idents[0];
      }

      const startOffset = node.startIndex ?? node.startOffset;
      const endOffset = node.endIndex ?? node.endOffset;
      const sourceMeta: SolidSourceMetadata = {
        parameterName: paramName,
        dimensionParams: paramName ? [paramName, paramName, paramName] : undefined,
        dimensions: [r, r, r],
        startOffset,
        endOffset,
        primitiveStartOffset: startOffset,
        primitiveEndOffset: endOffset,
      };

      return sphere({
        radius: r,
        widthSegments: Math.max(8, Number(fn)),
        heightSegments: Math.max(6, Math.floor(Number(fn) / 2)),
        sourceMetadata: sourceMeta,
      });
    }

    if (type === "PolyhedronPrimitive") {
      const argListNode = this.findChildByType(node, "ArgumentList");
      const args = this.evaluateArgumentList(argListNode, scope);
      const rawPoints = args.positional[0] ?? args.named.get("points") ?? [];
      const rawFaces = args.positional[1] ?? args.named.get("faces") ?? args.named.get("triangles") ?? [];

      const pts: Vec3[] = [];
      if (Array.isArray(rawPoints)) {
        for (const p of rawPoints) {
          if (Array.isArray(p) && p.length >= 3) {
            pts.push([Number(p[0] ?? 0), Number(p[1] ?? 0), Number(p[2] ?? 0)]);
          }
        }
      }
      const faces: number[][] = [];
      if (Array.isArray(rawFaces)) {
        for (const f of rawFaces) {
          if (Array.isArray(f) && f.length >= 3) {
            faces.push(f.map((idx) => Number(idx)));
          }
        }
      }

      const startOffset = node.startIndex ?? node.startOffset;
      const endOffset = node.endIndex ?? node.endOffset;
      return polyhedron({
        points: pts,
        faces,
        sourceMetadata: {
          startOffset,
          endOffset,
          primitiveStartOffset: startOffset,
          primitiveEndOffset: endOffset,
        },
      });
    }

    if (type === "PolygonPrimitive") {
      const args = this.evaluateArgumentList(this.findChildByType(node, "ArgumentList"), scope);
      const points = args.positional[0] ?? args.named.get("points") ?? [];
      const poly: [number, number][] = [];
      if (Array.isArray(points)) {
        for (const pt of points) {
          if (Array.isArray(pt) && pt.length >= 2) {
            poly.push([Number(pt[0] ?? 0), Number(pt[1] ?? 0)]);
          }
        }
      }
      if (poly.length < 3) {
        return null;
      }
      return linearExtrude(poly, 1.0);
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
        const pName = modDef.params[i]!;
        let val = args.positional[i];
        if (val === undefined && args.named.has(pName)) val = args.named.get(pName);
        if (val === undefined && modDef.defaults.has(pName)) val = modDef.defaults.get(pName);
        if (val === undefined && modDef.defaultExprs?.has(pName)) {
          val = this.evaluateExpression(modDef.defaultExprs.get(pName), modScope);
        }
        modScope.setVar(pName, val);
      }

      const modSolids: Solid[] = [];
      this.evaluateStatement(modDef.bodyNode, modScope, modSolids);
      if (modSolids.length === 0) return null;
      if (modSolids.length === 1) return modSolids[0]!;

      let acc = modSolids[0]!;
      for (let i = 1; i < modSolids.length; i++) {
        acc = union(acc, modSolids[i]!);
      }
      return acc;
    }

    return null;
  }

  // ── Expressions ──────────────────────────────────────────────────────────

  /**
   * Evaluates an OpenSCAD expression CST node (literals, vectors, ranges, arithmetic, conditionals,
   * built-in math/vector/string functions, and user-defined function calls) within `scope`.
   */
  public evaluateExpression(exprNode: any, scope: Scope): any {
    const type = exprNode.type;

    if (type === "Expression" || type === "PrimaryExpression") {
      if (exprNode.childCount === 0) {
        const text = exprNode.text.trim();
        if (/^[+-]?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(text)) {
          return parseFloat(text);
        }
        if (text === "true") return true;
        if (text === "false") return false;
        if (text === "undef") return undefined;
        return scope.getVar(text);
      }
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
          case "ln":
            return Math.log(x);
          case "log":
            return Math.log10(x);
          case "exp":
            return Math.exp(x);
          case "sign":
            return Math.sign(x);
          case "len":
            return Array.isArray(x) || typeof x === "string" ? x.length : 0;
          case "norm":
            return Array.isArray(x) ? Math.hypot(...x.map((v: any) => Number(v) || 0)) : Math.abs(Number(x) || 0);
          case "cross": {
            const b = args.positional[1];
            if (Array.isArray(x) && Array.isArray(b)) {
              if (x.length === 3 && b.length === 3) {
                return [x[1] * b[2] - x[2] * b[1], x[2] * b[0] - x[0] * b[2], x[0] * b[1] - x[1] * b[0]];
              }
              if (x.length === 2 && b.length === 2) {
                return x[0] * b[1] - x[1] * b[0];
              }
            }
            return [0, 0, 0];
          }
          case "concat": {
            const out: any[] = [];
            for (const item of args.positional) {
              if (Array.isArray(item)) out.push(...item);
              else if (item !== undefined) out.push(item);
            }
            return out;
          }
          case "lookup": {
            const key = Number(x);
            const table = args.positional[1];
            if (!Array.isArray(table) || table.length === 0) return 0;
            const sorted = [...table]
              .filter((row) => Array.isArray(row) && row.length >= 2)
              .sort((a, b) => Number(a[0]) - Number(b[0]));
            if (sorted.length === 0) return 0;
            if (key <= Number(sorted[0][0])) return Number(sorted[0][1]);
            if (key >= Number(sorted[sorted.length - 1][0])) return Number(sorted[sorted.length - 1][1]);
            for (let i = 0; i < sorted.length - 1; i++) {
              const x0 = Number(sorted[i][0]);
              const y0 = Number(sorted[i][1]);
              const x1 = Number(sorted[i + 1][0]);
              const y1 = Number(sorted[i + 1][1]);
              if (key >= x0 && key <= x1) {
                if (x1 === x0) return y0;
                return y0 + ((key - x0) / (x1 - x0)) * (y1 - y0);
              }
            }
            return 0;
          }
          case "str":
            return args.positional.map((v) => (v === undefined ? "undef" : String(v))).join("");
          case "chr":
            return args.positional
              .flat()
              .map((code) => String.fromCharCode(Number(code) || 0))
              .join("");
          case "ord":
            return typeof x === "string" && x.length > 0 ? x.charCodeAt(0) : undefined;
          case "search": {
            const matchVal = x;
            const target = args.positional[1];
            if (typeof matchVal === "string" && typeof target === "string") {
              const idx = target.indexOf(matchVal);
              return idx >= 0 ? [idx] : [];
            }
            if (Array.isArray(target)) {
              const indices: number[] = [];
              for (let i = 0; i < target.length; i++) {
                const elem = target[i];
                if (elem === matchVal || (Array.isArray(elem) && elem[0] === matchVal)) {
                  indices.push(i);
                  break;
                }
              }
              return indices;
            }
            return [];
          }
          case "version":
            return [2024, 1, 0];
          case "version_num":
            return 20240100;
          case "is_undef":
            return x === undefined;
          case "is_bool":
            return typeof x === "boolean";
          case "is_num":
            return typeof x === "number" && !Number.isNaN(x);
          case "is_string":
            return typeof x === "string";
          case "is_list":
            return Array.isArray(x);
          case "is_function":
            return typeof x === "function";
          case "rands": {
            const minVal = Number(x) || 0;
            const maxVal = Number(args.positional[1]) || 1;
            const count = Math.max(0, Math.floor(Number(args.positional[2]) || 0));
            let seed = Number(args.positional[3] ?? 12345) || 12345;
            const out: number[] = [];
            for (let i = 0; i < count; i++) {
              seed = (seed * 1664525 + 1013904223) >>> 0;
              const u = seed / 0xffffffff;
              out.push(minVal + u * (maxVal - minVal));
            }
            return out;
          }
        }

        const userFunc = scope.getFunc(funcName);
        if (userFunc) {
          const fnScope = new Scope(userFunc.scope);
          for (let i = 0; i < userFunc.params.length; i++) {
            const p = userFunc.params[i]!;
            let v = args.positional[i];
            if (v === undefined && args.named.has(p)) v = args.named.get(p);
            if (v === undefined && userFunc.defaults.has(p)) v = userFunc.defaults.get(p);
            if (v === undefined && userFunc.defaultExprs?.has(p)) {
              v = this.evaluateExpression(userFunc.defaultExprs.get(p), fnScope);
            }
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

  /**
   * Evaluates an `ArgumentList` CST node into positional values and named `key = value` bindings.
   */
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

  /**
   * Parses a `ParameterList` CST node into ordered parameter names and evaluated default values.
   */
  private parseParameters(
    paramListNode: any,
    scope: Scope,
  ): { params: string[]; defaults: Map<string, any>; defaultExprs: Map<string, any> } {
    const params: string[] = [];
    const defaults = new Map<string, any>();
    const defaultExprs = new Map<string, any>();
    if (!paramListNode) return { params, defaults, defaultExprs };

    for (let i = 0; i < paramListNode.childCount; i++) {
      const p = paramListNode.child(i);
      if (!p || p.type !== "Parameter") continue;

      const nameNode = this.findChildByType(p, "IDENTIFIER");
      const defNode = this.findChildByType(p, "Expression");
      if (nameNode) {
        const name = nameNode.text.trim();
        params.push(name);
        if (defNode) {
          defaultExprs.set(name, defNode);
          const evaluated = this.evaluateExpression(defNode, scope);
          if (evaluated !== undefined) {
            defaults.set(name, evaluated);
          }
        }
      }
    }

    return { params, defaults, defaultExprs };
  }

  /**
   * Finds the first direct child node matching `targetType`, utilizing WASM linear-memory
   * pointer traversal when uncached to avoid allocating sibling CST node wrappers.
   */
  private findChildByType(node: any, targetType: string): any {
    if (!node) return null;
    if (
      typeof node.ptr === "number" &&
      node.ptr > 0 &&
      node.tree?.mem32 &&
      node.tree?.facade?.syntaxNames &&
      !node._cachedChildren
    ) {
      const mem32: Uint32Array = node.tree.mem32;
      const syntaxNames: string[] = node.tree.facade.syntaxNames;
      const exports = node.tree.facade.exports;
      const NodeCtor = node.constructor as any;

      const ptrStack: number[] = [];
      const offsetStack: number[] = [];
      let curPtr = mem32[(node.ptr + 12) >>> 2]!;
      let curOff = (node._startOffset ?? 0) + (node._cachedPad ?? 0);

      while (true) {
        if (curPtr !== 0) {
          const tf = mem32[curPtr >>> 2]!;
          const tid = tf & 0x03ff;
          const tName = syntaxNames[tid] || "";
          const ehp = mem32[(curPtr + 4) >>> 2]!;
          const rPad = tf >>> 22;
          const isFat = (ehp >>> 23) & 1;
          const pad = isFat
            ? mem32[(curPtr + 28) >>> 2] ||
              (exports?.getFatPaddingPtr ? mem32[exports.getFatPaddingPtr(rPad) >>> 2]! : rPad)
            : rPad;
          const len = ehp & 0x007fffff;
          const isInv = (tf & (1 << 14)) !== 0;

          const nextPtr = mem32[(curPtr + 16) >>> 2]!;
          const nextOff = curOff + pad + len;

          if (tName.startsWith("_") || isInv) {
            if (nextPtr !== 0) {
              ptrStack.push(nextPtr);
              offsetStack.push(nextOff);
            }
            curPtr = mem32[(curPtr + 12) >>> 2]!;
            curOff = curOff + pad;
            continue;
          } else if (tName === targetType) {
            return new NodeCtor(node.tree, curPtr, curOff, node, pad, len, tid, -1);
          }

          curOff = nextOff;
          curPtr = nextPtr;
        } else {
          if (ptrStack.length === 0) break;
          curPtr = ptrStack.pop()!;
          curOff = offsetStack.pop()!;
        }
      }
      return null;
    }

    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c && c.type === targetType) return c;
    }
    return null;
  }
}
