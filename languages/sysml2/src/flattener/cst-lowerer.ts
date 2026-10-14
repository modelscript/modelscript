// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — Direct Linear-Memory CST Flattener and Lowerer into DAEBuilder.
 *
 * Compiles SysML v2 / KerML syntax trees directly into `DAEBuilder` integer IDs (ExprId, EqId)
 * without intermediate AST wrapper allocations.
 *
 * Supports:
 *   1. Full expression lowering from GLR CST nodes (relational, arithmetic, boolean, invocations, der()).
 *   2. Class inheritance & specialization (`:>`).
 *   3. Array multiplicities (`part wheels : Wheel[4];`).
 *   4. Conjugated physical ports (`~PortDef`) with flow sign inversion in Kirchhoff balance.
 *   5. Hierarchical component elaboration and parameter overrides.
 */

import { BinOp, Causality, DAEBuilder, EqKind, UnaryOp, VarAttrKind, Variability, VarType } from "@modelscript/runtime";

export interface LoweredSysml2CstResult {
  arena: DAEBuilder;
  rootName: string;
  parameters: string[];
  states: string[];
  derivatives: string[];
  eqCount: number;
}

export interface CstFlattenerOptions {
  arena?: DAEBuilder;
  overrides?: Record<string, number>;
  rootComponentName?: string;
  sourceText?: string;
}

export interface PortMeta {
  name: string;
  potentialAttrs: string[];
  flowAttrs: string[];
}

export interface ActivePortInstance {
  fullName: string;
  portType: string;
  isConjugated: boolean;
  potentialAttrs: string[];
  flowAttrs: string[];
}

/**
 * Helper to recursively search for CST children of a given type.
 */
export function findCstChildren(node: any, type: string, results: any[] = []): any[] {
  if (!node) return results;
  const count = node.childCount ?? node.children?.length ?? 0;
  for (let i = 0; i < count; i++) {
    const child = node.child ? node.child(i) : node.children[i];
    if (!child) continue;
    if (child.type === type) {
      results.push(child);
    }
  }
  return results;
}

/**
 * Helper to recursively search all descendants for nodes of a given type.
 */
export function findCstDescendants(node: any, type: string, results: any[] = []): any[] {
  if (!node) return results;
  if (node.type === type) results.push(node);
  const count = node.childCount ?? node.children?.length ?? 0;
  for (let i = 0; i < count; i++) {
    const child = node.child ? node.child(i) : node.children[i];
    if (child) findCstDescendants(child, type, results);
  }
  return results;
}

/**
 * Finds the first descendant of a given type.
 */
export function findFirstDescendant(node: any, type: string): any | null {
  if (!node) return null;
  if (node.type === type) return node;
  const count = node.childCount ?? node.children?.length ?? 0;
  for (let i = 0; i < count; i++) {
    const child = node.child ? node.child(i) : node.children[i];
    const found = findFirstDescendant(child, type);
    if (found) return found;
  }
  return null;
}

/**
 * Lowers a SysML v2 / KerML CST expression node directly into an integer `ExprId` in `DAEBuilder`.
 */
export function lowerCstExpression(node: any, arena: DAEBuilder, prefix = "", localNames?: Set<string>): number {
  if (!node) return arena.addRealLiteral(0.0);

  // Unwrap wrapper nodes
  while (
    node &&
    (node.type === "OwnedExpression" ||
      node.type === "SequenceExpression" ||
      node.type === "ArgumentValue" ||
      node.type === "ResultExpressionMember" ||
      node.type === "_Expression" ||
      node.type === "_BaseExpression")
  ) {
    const inner =
      node.childForFieldName?.("ownedRelatedElement") ||
      (node.childCount > 0 ? (node.child ? node.child(0) : node.children[0]) : null);
    if (inner && inner !== node) {
      node = inner;
    } else {
      break;
    }
  }

  // Handle parenthesized expressions: ( expr )
  if (node.childCount >= 3) {
    const first = node.child ? node.child(0) : node.children[0];
    const last = node.child ? node.child(node.childCount - 1) : node.children[node.childCount - 1];
    if (first?.text === "(" && last?.text === ")") {
      const inner = node.child ? node.child(1) : node.children[1];
      if (inner && node.childCount === 3) {
        return lowerCstExpression(inner, arena, prefix, localNames);
      }
    }
  }

  const type = node.type;

  // 1. Literals
  if (type === "LiteralReal" || type === "RealValue") {
    const val = parseFloat(node.text.trim());
    return arena.addRealLiteral(isNaN(val) ? 0.0 : val);
  }
  if (type === "LiteralInteger" || type === "DECIMAL_VALUE") {
    const val = parseFloat(node.text.trim());
    return arena.addRealLiteral(isNaN(val) ? 0.0 : val);
  }
  if (type === "LiteralBoolean") {
    return arena.addBoolLiteral(node.text.trim() === "true");
  }

  // 2. Unary Expression: -x, +x, !x, not x
  if (type === "UnaryExpression") {
    const opNode = node.childForFieldName?.("operator") || (node.child ? node.child(0) : node.children[0]);
    const operandNode = node.childForFieldName?.("operand") || (node.child ? node.child(1) : node.children[1]);
    const opText = opNode?.text?.trim() || "-";
    const childId = lowerCstExpression(operandNode, arena, prefix, localNames);

    if (opText === "-") {
      return arena.addUnaryExpr(UnaryOp.Negate, childId);
    }
    if (opText === "!" || opText === "not") {
      return arena.addUnaryExpr(UnaryOp.Not, childId);
    }
    return childId; // Unary + is a no-op
  }

  // 3. Additive Expression: a + b - c
  if (type === "AdditiveExpression") {
    const count = node.childCount ?? node.children?.length ?? 0;
    let left = lowerCstExpression(node.child ? node.child(0) : node.children[0], arena, prefix, localNames);

    for (let i = 1; i < count; i += 2) {
      const opNode = node.child ? node.child(i) : node.children[i];
      const rightNode = node.child ? node.child(i + 1) : node.children[i + 1];
      if (!rightNode) break;

      const right = lowerCstExpression(rightNode, arena, prefix, localNames);
      const op = opNode?.text?.trim() === "-" ? BinOp.Sub : BinOp.Add;
      left = arena.addBinaryExpr(op, left, right);
    }
    return left;
  }

  // 4. Multiplicative Expression: a * b / c % d
  if (type === "MultiplicativeExpression") {
    const count = node.childCount ?? node.children?.length ?? 0;
    let left = lowerCstExpression(node.child ? node.child(0) : node.children[0], arena, prefix, localNames);

    for (let i = 1; i < count; i += 2) {
      const opNode = node.child ? node.child(i) : node.children[i];
      const rightNode = node.child ? node.child(i + 1) : node.children[i + 1];
      if (!rightNode) break;

      const right = lowerCstExpression(rightNode, arena, prefix, localNames);
      const opText = opNode?.text?.trim();
      if (opText === "%") {
        left = arena.addCallExpr("mod", [left, right]);
      } else {
        const op = opText === "/" ? BinOp.Div : BinOp.Mul;
        left = arena.addBinaryExpr(op, left, right);
      }
    }
    return left;
  }

  // 5. Exponentiation Expression: a ** b or a ^ b
  if (type === "ExponentiationExpression") {
    const baseNode = node.childForFieldName?.("base") || (node.child ? node.child(0) : node.children[0]);
    const expNode = node.childForFieldName?.("exponent") || (node.child ? node.child(2) : node.children[2]);
    const baseId = lowerCstExpression(baseNode, arena, prefix, localNames);
    const expId = lowerCstExpression(expNode, arena, prefix, localNames);
    return arena.addBinaryExpr(BinOp.Pow, baseId, expId);
  }

  // 6. Relational Expression: a < b, a <= b, a > b, a >= b
  if (type === "RelationalExpression") {
    const count = node.childCount ?? node.children?.length ?? 0;
    let left = lowerCstExpression(node.child ? node.child(0) : node.children[0], arena, prefix, localNames);

    for (let i = 1; i < count; i += 2) {
      const opNode = node.child ? node.child(i) : node.children[i];
      const rightNode = node.child ? node.child(i + 1) : node.children[i + 1];
      if (!rightNode) break;

      const right = lowerCstExpression(rightNode, arena, prefix, localNames);
      const opText = opNode?.text?.trim();
      let op = BinOp.Lt;
      if (opText === "<=") op = BinOp.Lte;
      else if (opText === ">") op = BinOp.Gt;
      else if (opText === ">=") op = BinOp.Gte;

      left = arena.addBinaryExpr(op, left, right);
    }
    return left;
  }

  // 7. Equality Expression: a == b, a != b
  if (type === "EqualityExpression") {
    const count = node.childCount ?? node.children?.length ?? 0;
    let left = lowerCstExpression(node.child ? node.child(0) : node.children[0], arena, prefix, localNames);

    for (let i = 1; i < count; i += 2) {
      const opNode = node.child ? node.child(i) : node.children[i];
      const rightNode = node.child ? node.child(i + 1) : node.children[i + 1];
      if (!rightNode) break;

      const right = lowerCstExpression(rightNode, arena, prefix, localNames);
      const op = opNode?.text?.trim() === "!=" ? BinOp.Neq : BinOp.Eq;
      left = arena.addBinaryExpr(op, left, right);
    }
    return left;
  }

  // 8. Logical And / Or
  if (type === "AndExpression") {
    const count = node.childCount ?? node.children?.length ?? 0;
    let left = lowerCstExpression(node.child ? node.child(0) : node.children[0], arena, prefix, localNames);
    for (let i = 1; i < count; i += 2) {
      const rightNode = node.child ? node.child(i + 1) : node.children[i + 1];
      if (!rightNode) break;
      const right = lowerCstExpression(rightNode, arena, prefix, localNames);
      left = arena.addBinaryExpr(BinOp.And, left, right);
    }
    return left;
  }
  if (type === "OrExpression") {
    const count = node.childCount ?? node.children?.length ?? 0;
    let left = lowerCstExpression(node.child ? node.child(0) : node.children[0], arena, prefix, localNames);
    for (let i = 1; i < count; i += 2) {
      const rightNode = node.child ? node.child(i + 1) : node.children[i + 1];
      if (!rightNode) break;
      const right = lowerCstExpression(rightNode, arena, prefix, localNames);
      left = arena.addBinaryExpr(BinOp.Or, left, right);
    }
    return left;
  }

  // 9. Invocation Expression: der(x), sin(x), sqrt(x)
  if (type === "InvocationExpression") {
    const fnNameNode = findFirstDescendant(node, "ID") || node.childForFieldName?.("instantiatedType");
    const fnName = fnNameNode?.text?.trim() || "";

    // Check der(variable)
    if (fnName === "der") {
      const argNode = findFirstDescendant(node, "Argument") || findFirstDescendant(node, "FeatureReferenceExpression");
      let varName = argNode?.text?.trim() || "";
      if (prefix && localNames && localNames.has(varName.split(".")[0]!)) {
        varName = prefix + varName;
      }
      const nameId = arena.interner.intern(varName);
      return arena.addDer(nameId);
    }

    // Elementary math functions (sin, cos, exp, log, sqrt, etc.)
    const argsNodes = findCstDescendants(node, "Argument");
    const argExprIds = argsNodes.map((a) => lowerCstExpression(a, arena, prefix, localNames));
    const fnNameId = arena.interner.intern(fnName);
    return arena.addCallExpr(fnNameId, argExprIds);
  }

  // 10. Measurement Expression: 100.0 [km / h]
  if (type === "MeasurementExpression") {
    const valNode = node.childForFieldName?.("value") || (node.child ? node.child(0) : node.children[0]);
    return lowerCstExpression(valNode, arena, prefix, localNames);
  }

  // 11. Feature Reference (Identifier / Variable Name)
  if (type === "FeatureReferenceExpression" || type === "Name" || type === "ID" || type === "QualifiedName") {
    let rawName = node.text.trim();
    if (prefix && localNames) {
      const root = rawName.split(".")[0]!;
      if (localNames.has(root)) {
        rawName = prefix + rawName;
      }
    }
    const nameId = arena.interner.intern(rawName);
    return arena.addName(nameId);
  }

  // Fallback: If node has a numeric or identifier string text
  const rawText = node.text?.trim() || "";
  const numVal = parseFloat(rawText);
  if (!isNaN(numVal) && isFinite(numVal) && /^[0-9.eE+-]+$/.test(rawText)) {
    return arena.addRealLiteral(numVal);
  }

  // Fallback variable reference
  if (/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(rawText)) {
    let name = rawText;
    if (prefix && localNames && localNames.has(name.split(".")[0]!)) {
      name = prefix + name;
    }
    const nameId = arena.interner.intern(name);
    return arena.addName(nameId);
  }

  return arena.addRealLiteral(0.0);
}

/**
 * Compiles a parsed SysML v2 CST tree directly into a `DAEBuilder` arena.
 */
export class SysML2CstFlattener {
  private arena: DAEBuilder;
  private portDefs = new Map<string, PortMeta>();
  private compDefs = new Map<string, any>();
  private activePorts = new Map<string, ActivePortInstance>();
  private parameters: string[] = [];
  private states: string[] = [];
  private derivatives: string[] = [];
  private overrides: Record<string, number>;
  private rootCompName: string;
  private sourceText?: string;

  constructor(options: CstFlattenerOptions = {}) {
    this.arena = options.arena ?? new DAEBuilder();
    this.overrides = options.overrides ?? {};
    this.rootCompName = options.rootComponentName ?? "";
    this.sourceText = options.sourceText;
  }

  /**
   * Main entry point to flatten a parsed SysML v2 root CST node into the DAE arena.
   */
  public flatten(rootNode: any): LoweredSysml2CstResult {
    // 0. Extract experiment configs from root text if present
    const cleanSource = this.sourceText || rootNode.text || "";
    const startMatch = /\bstartTime\s*(?::\s*[A-Za-z0-9_:]+\s*)?=\s*([0-9.eE+-]+)/.exec(cleanSource);
    if (startMatch) this.arena.experiment.startTime = parseFloat(startMatch[1]!);
    const stopMatch = /\bstopTime\s*(?::\s*[A-Za-z0-9_:]+\s*)?=\s*([0-9.eE+-]+)/.exec(cleanSource);
    if (stopMatch) this.arena.experiment.stopTime = parseFloat(stopMatch[1]!);
    const intervalMatch = /\b(?:interval|step)\s*(?::\s*[A-Za-z0-9_:]+\s*)?=\s*([0-9.eE+-]+)/.exec(cleanSource);
    if (intervalMatch) this.arena.experiment.interval = parseFloat(intervalMatch[1]!);
    const tolMatch = /\btolerance\s*(?::\s*[A-Za-z0-9_:]+\s*)?=\s*([0-9.eE+-]+)/.exec(cleanSource);
    if (tolMatch) this.arena.experiment.tolerance = parseFloat(tolMatch[1]!);

    // 1. Ingest port definitions
    this.collectPortDefinitions(rootNode);

    // 2. Ingest all part/constraint definitions
    this.collectComponentDefinitions(rootNode);

    // 3. Determine root component
    if (!this.rootCompName) {
      this.rootCompName = this.determineRootComponent();
    }

    const rootDefNode = this.compDefs.get(this.rootCompName);
    if (rootDefNode) {
      this.elaborateComponent(rootDefNode, "", this.overrides);
    }

    return {
      arena: this.arena,
      rootName: this.rootCompName,
      parameters: this.parameters,
      states: this.states,
      derivatives: this.derivatives,
      eqCount: this.arena.eqCount,
    };
  }

  private collectPortDefinitions(rootNode: any): void {
    const portDefNodes = findCstDescendants(rootNode, "PortDefinition");
    for (const pNode of portDefNodes) {
      const nameNode = findFirstDescendant(pNode, "Name") || findFirstDescendant(pNode, "ID");
      const name = nameNode?.text?.trim();
      if (!name) continue;

      const potentialAttrs: string[] = [];
      const flowAttrs: string[] = [];

      const attrNodes = findCstDescendants(pNode, "AttributeUsage");
      for (const an of attrNodes) {
        const attrNameNode = findFirstDescendant(an, "Name") || findFirstDescendant(an, "ID");
        const attrName = attrNameNode?.text?.trim();
        if (!attrName) continue;

        // Check if marked as flow
        const isFlow = an.text.includes("flow");
        if (isFlow) {
          flowAttrs.push(attrName);
        } else {
          potentialAttrs.push(attrName);
        }
      }

      const flowUsageNodes = findCstDescendants(pNode, "FlowUsage");
      for (const fn of flowUsageNodes) {
        const flowNameNode = findFirstDescendant(fn, "Name") || findFirstDescendant(fn, "ID");
        const flowName = flowNameNode?.text?.trim();
        if (flowName) flowAttrs.push(flowName);
      }

      this.portDefs.set(name, {
        name,
        potentialAttrs: potentialAttrs.length > 0 ? potentialAttrs : ["v"],
        flowAttrs: flowAttrs.length > 0 ? flowAttrs : ["i"],
      });
    }
  }

  private collectComponentDefinitions(rootNode: any): void {
    const partDefNodes = findCstDescendants(rootNode, "PartDefinition");
    const constraintDefNodes = findCstDescendants(rootNode, "ConstraintDefinition");

    for (const node of [...partDefNodes, ...constraintDefNodes]) {
      const nameNode = findFirstDescendant(node, "Name") || findFirstDescendant(node, "ID");
      const name = nameNode?.text?.trim();
      if (name) {
        this.compDefs.set(name, node);
      }
    }
  }

  private determineRootComponent(): string {
    if (this.compDefs.size === 0) return "SysmlModel";
    if (this.compDefs.size === 1) return Array.from(this.compDefs.keys())[0]!;

    // Find component not instantiated as subpart in others
    const instantiatedTypes = new Set<string>();
    const superclasses = new Set<string>();

    for (const compNode of this.compDefs.values()) {
      const partUsages = findCstDescendants(compNode, "PartUsage");
      for (const pu of partUsages) {
        const typeNode = findFirstDescendant(pu, "FeatureTyping");
        const typeName = typeNode?.text?.replace(/^[:\s]+/, "").trim();
        if (typeName) instantiatedTypes.add(typeName);
      }

      const subclassificationNodes = findCstDescendants(compNode, "OwnedSubclassification");
      for (const sc of subclassificationNodes) {
        const superName = sc.text.replace(/^[:>\s]+/, "").trim();
        if (superName) superclasses.add(superName);
      }
    }

    // Prefer components that are neither subparts nor superclasses
    for (const name of this.compDefs.keys()) {
      if (!instantiatedTypes.has(name) && !superclasses.has(name)) {
        return name;
      }
    }

    for (const name of this.compDefs.keys()) {
      if (!instantiatedTypes.has(name)) {
        return name;
      }
    }

    return Array.from(this.compDefs.keys())[0]!;
  }

  /**
   * Elaborates a component definition: attributes, ports, subparts, inheritance, equations.
   */
  private elaborateComponent(compNode: any, prefix: string, overrides: Record<string, number>): void {
    const localNames = new Set<string>();

    // 1. Process Inheritance (:>)
    const subclassificationNodes = findCstChildren(compNode, "OwnedSubclassification");
    for (const sc of subclassificationNodes) {
      const superName = sc.text.replace(/^[:>\s]+/, "").trim();
      const superDefNode = this.compDefs.get(superName);
      if (superDefNode && superDefNode !== compNode) {
        // Inherit members of superclass first
        this.elaborateComponent(superDefNode, prefix, overrides);
      }
    }

    // 2. Process Ports
    const portUsages = findCstDescendants(compNode, "PortUsage");
    for (const pu of portUsages) {
      // Don't process ports of nested subparts here
      if (this.isDescendantOfPartUsage(pu, compNode)) continue;

      const nameNode = findFirstDescendant(pu, "Name") || findFirstDescendant(pu, "ID");
      const portName = nameNode?.text?.trim();
      if (!portName) continue;

      localNames.add(portName);
      const portFullName = prefix + portName;

      const typeNode = findFirstDescendant(pu, "FeatureTyping");
      const rawType = typeNode?.text?.replace(/^[:\s]+/, "").trim() || "";
      const isConjugated = pu.text.includes("~") || rawType.startsWith("~");
      const cleanType = rawType.replace(/^~\s*/, "");

      const pDef = this.portDefs.get(cleanType) ?? {
        name: cleanType,
        potentialAttrs: ["v"],
        flowAttrs: ["i"],
      };

      for (const pot of pDef.potentialAttrs) {
        const varName = `${portFullName}.${pot}`;
        this.arena.addVariable(varName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      }
      for (const fl of pDef.flowAttrs) {
        const varName = `${portFullName}.${fl}`;
        this.arena.addVariable(varName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      }

      this.activePorts.set(portFullName, {
        fullName: portFullName,
        portType: cleanType,
        isConjugated,
        potentialAttrs: pDef.potentialAttrs,
        flowAttrs: pDef.flowAttrs,
      });
    }

    // 3. Process Attributes
    const attrUsages = findCstDescendants(compNode, "AttributeUsage");
    for (const au of attrUsages) {
      if (this.isDescendantOfPartUsage(au, compNode)) continue;

      const nameNode = findFirstDescendant(au, "Name") || findFirstDescendant(au, "ID");
      const attrName = nameNode?.text?.trim();
      if (!attrName) continue;

      localNames.add(attrName);
      const fullName = prefix + attrName;

      // Extract default value
      const valNode = findFirstDescendant(au, "FeatureValue") || findFirstDescendant(au, "OwnedExpression");
      let defaultVal = 0.0;
      if (valNode) {
        const rawVal = valNode.text.replace(/^[=:\s]+/, "").trim();
        const parsed = parseFloat(rawVal);
        if (!isNaN(parsed) && isFinite(parsed)) defaultVal = parsed;
      }
      if (overrides[attrName] !== undefined) {
        defaultVal = overrides[attrName]!;
      }

      const isInput = au.text.includes("in ");
      const isOutput = au.text.includes("out ");
      const causality = isInput ? Causality.Input : isOutput ? Causality.Output : Causality.Local;

      // Check if state variable: der(attrName) referenced in equations
      const isState = new RegExp(`\\bder\\s*\\(\\s*${attrName}\\s*\\)`).test(compNode.text);
      const isParam = !isState && (isInput || valNode !== null || overrides[attrName] !== undefined);
      const variability = isParam ? Variability.Parameter : Variability.Continuous;

      if (isParam) {
        this.parameters.push(fullName);
      } else {
        this.states.push(fullName);
      }

      const varIdx = this.arena.addVariable(fullName, VarType.Real, variability, causality, defaultVal);

      if (isState) {
        const startExpr = this.arena.addRealLiteral(defaultVal);
        this.arena.setVarAttrExpr(varIdx, VarAttrKind.Start, startExpr);
        const fixedExpr = this.arena.addBoolLiteral(true);
        this.arena.setVarAttrExpr(varIdx, VarAttrKind.Fixed, fixedExpr);
        this.arena.setVarFixed(varIdx, true);
        this.derivatives.push(`der(${fullName})`);
      }
    }

    // 4. Process Subparts & Multiplicities
    const partUsages = findCstDescendants(compNode, "PartUsage");
    for (const pu of partUsages) {
      if (this.isDescendantOfPartUsage(pu, compNode)) continue;

      const nameNode = findFirstDescendant(pu, "Name") || findFirstDescendant(pu, "ID");
      const partName = nameNode?.text?.trim();
      if (!partName) continue;

      localNames.add(partName);

      const typeNode = findFirstDescendant(pu, "FeatureTyping");
      const subTypeName = typeNode?.text?.replace(/^[:\s]+/, "").trim() || "";

      // Extract multiplicity: e.g. [4]
      let multiplicity = 1;
      const multNode = findFirstDescendant(pu, "OwnedMultiplicity") || findFirstDescendant(pu, "MultiplicityRange");
      if (multNode) {
        const numMatch = multNode.text.match(/\[\s*(\d+)\s*\]/);
        if (numMatch) {
          multiplicity = parseInt(numMatch[1]!, 10);
        }
      }

      // Extract subpart overrides if any
      const subOverrides: Record<string, number> = {};
      const subCompDef = this.compDefs.get(subTypeName);

      if (subCompDef) {
        if (multiplicity > 1) {
          // Instantiate array elements: wheels[1], wheels[2], ..., wheels[N]
          for (let i = 1; i <= multiplicity; i++) {
            const subPrefix = `${prefix}${partName}[${i}].`;
            this.elaborateComponent(subCompDef, subPrefix, subOverrides);
          }
        } else {
          const subPrefix = `${prefix}${partName}.`;
          this.elaborateComponent(subCompDef, subPrefix, subOverrides);
        }
      }
    }

    // 5. Process Equations & Assert Constraints
    this.elaborateEquations(compNode, prefix, localNames);

    // 6. Process Connections & Port Balancing
    this.elaborateConnections(compNode, prefix);
  }

  private isDescendantOfPartUsage(node: any, currentComp: any): boolean {
    let p = node.parent;
    while (p && p !== currentComp) {
      if (p.type === "PartUsage") return true;
      p = p.parent;
    }
    return false;
  }

  private elaborateEquations(compNode: any, prefix: string, localNames: Set<string>): void {
    const assertUsages = [
      ...findCstDescendants(compNode, "AssertConstraintUsage"),
      ...findCstDescendants(compNode, "ConstraintUsage"),
    ];
    for (const au of assertUsages) {
      if (this.isDescendantOfPartUsage(au, compNode)) continue;

      const resultExpr =
        findFirstDescendant(au, "ResultExpressionMember") || findFirstDescendant(au, "OwnedExpression");
      if (!resultExpr) continue;

      // An equation in assert constraint is typically EqualityExpression (lhs == rhs)
      const eqNode = findFirstDescendant(resultExpr, "EqualityExpression");
      if (eqNode && eqNode.childCount >= 3) {
        const lhsNode = eqNode.child ? eqNode.child(0) : eqNode.children[0];
        const rhsNode = eqNode.child ? eqNode.child(2) : eqNode.children[2];

        const lhsId = lowerCstExpression(lhsNode, this.arena, prefix, localNames);
        const rhsId = lowerCstExpression(rhsNode, this.arena, prefix, localNames);
        this.arena.addEquation(EqKind.Simple, lhsId, rhsId);
      } else {
        // Inequality or boolean expression: expr == true
        const exprId = lowerCstExpression(resultExpr, this.arena, prefix, localNames);
        const trueId = this.arena.addBoolLiteral(true);
        this.arena.addEquation(EqKind.Simple, exprId, trueId);
      }
    }
  }

  private elaborateConnections(compNode: any, prefix: string): void {
    const connUsages = findCstDescendants(compNode, "ConnectionUsage");
    for (const cu of connUsages) {
      if (this.isDescendantOfPartUsage(cu, compNode)) continue;

      // Form: connect p1 to p2; or connect a = b;
      let refNodes = findCstDescendants(cu, "ConnectorEnd");
      if (refNodes.length < 2) {
        refNodes = findCstDescendants(cu, "ConnectorEndMember");
      }
      if (refNodes.length < 2) {
        refNodes = findCstDescendants(cu, "FeatureReferenceExpression");
      }
      if (refNodes.length >= 2) {
        const p1Raw = refNodes[0].text.trim();
        const p2Raw = refNodes[1].text.trim();

        const p1 = prefix + p1Raw;
        const p2 = prefix + p2Raw;

        const port1 = this.activePorts.get(p1);
        const port2 = this.activePorts.get(p2);

        if (port1 && port2) {
          // 1. Potential attributes equal: p1.v == p2.v
          for (const pot of port1.potentialAttrs) {
            const v1Name = this.arena.interner.intern(`${p1}.${pot}`);
            const v2Name = this.arena.interner.intern(`${p2}.${pot}`);
            const v1Expr = this.arena.addName(v1Name);
            const v2Expr = this.arena.addName(v2Name);
            this.arena.addEquation(EqKind.Simple, v1Expr, v2Expr);
          }

          // 2. Flow conservation: sum of currents = 0 (accounting for conjugation)
          for (const fl of port1.flowAttrs) {
            const i1Name = this.arena.interner.intern(`${p1}.${fl}`);
            const i2Name = this.arena.interner.intern(`${p2}.${fl}`);
            const i1Expr = this.arena.addName(i1Name);
            const i2Expr = this.arena.addName(i2Name);

            // If port1 is conjugated, flow direction is inverted
            const signedI1 = port1.isConjugated ? this.arena.addUnaryExpr(UnaryOp.Negate, i1Expr) : i1Expr;
            const signedI2 = port2.isConjugated ? this.arena.addUnaryExpr(UnaryOp.Negate, i2Expr) : i2Expr;

            const sumExpr = this.arena.addBinaryExpr(BinOp.Add, signedI1, signedI2);
            const zeroExpr = this.arena.addRealLiteral(0.0);
            this.arena.addEquation(EqKind.Simple, sumExpr, zeroExpr);
          }
        }
      }
    }
  }
}
