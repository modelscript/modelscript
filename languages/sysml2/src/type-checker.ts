// SPDX-License-Identifier: AGPL-3.0-or-later

import { error, type LintResult } from "@modelscript/dsl";
import type { QueryDB, SymbolEntry } from "@modelscript/runtime";
import { kermlStdlibEntries } from "../src-gen/kerml-snapshot.js";
import { KNOWN_DIMENSIONS } from "./dimensions.js";
import { SysML2ErrorCode } from "./errors.js";
import type { SysmlCstNode } from "./flattener/cst-lowerer.js";

const STDLIB_PACKAGES = new Set<string>([
  "ScalarValues",
  "Base",
  "CoreTypes",
  "Collections",
  "Control",
  "Transfers",
  "Performances",
  "ISQ",
  "ISQBase",
  "ISQSpaceTime",
  "ISQMechanics",
  "ISQThermodynamics",
  "ISQElectromagnetism",
  "ISQLight",
  "ISQChemistryMolecular",
  "ISQAtomicNuclear",
  "SI",
  "SIBaseUnits",
  "SIDerivedUnits",
  "USCustomaryUnits",
  "CauseAndEffect",
  "SpatialFrames",
  "StateMachines",
  "KerML",
  "SysML",
  "Occurrences",
  "Objects",
  "Links",
  "Clocks",
  "Triggers",
  "Parts",
  "Ports",
  "Connections",
  "Interfaces",
  "Items",
  "Allocations",
  "Actions",
  "Calculations",
  "Constraints",
  "Requirements",
  "Cases",
  "AnalysisCases",
  "VerificationCases",
  "UseCases",
  "Views",
  "Metadata",
  "Quantities",
  "MeasurementReferences",
  "UnitsAndScales",
  "VectorCalculations",
  "NumericalFunctions",
  "TrigFunctions",
  "SequenceFunctions",
  "DataFunctions",
  "ControlFunctions",
  "StandardLibrary",
  "Kernel",
]);

const STDLIB_SYMBOLS = new Set<string>([
  "Real",
  "Integer",
  "Boolean",
  "String",
  "Natural",
  "Positive",
  "UnlimitedNatural",
  "Complex",
  "Rational",
  "Anything",
  "Element",
  "Feature",
  "Type",
  "Classifier",
  "DataType",
  "Class",
  "Structure",
  "Behavior",
  "Occurrence",
  "Life",
  "Snapshot",
  "Link",
  "Relationship",
  "Association",
  "Connector",
  "Interface",
  "Metadata",
  "Object",
  "Part",
  "Item",
  "Port",
  "Action",
  "State",
  "Constraint",
  "Calculation",
  "Requirement",
  "Collection",
  "List",
  "Set",
  "Bag",
  "Array",
  "Map",
  "ControlNode",
  "MergeNode",
  "DecisionNode",
  "ForkNode",
  "JoinNode",
  "Transfer",
  "Flow",
  "Message",
  "Performance",
  "Evaluation",
  "Execution",
  ...Object.keys(KNOWN_DIMENSIONS),
]);

const STDLIB_PACKAGE_MEMBERS = new Map<string, Set<string>>();

function addStdlibPkgMember(pkg: string, member: string): void {
  let set = STDLIB_PACKAGE_MEMBERS.get(pkg);
  if (!set) {
    set = new Set<string>();
    STDLIB_PACKAGE_MEMBERS.set(pkg, set);
  }
  set.add(member);
}

const stdlibEntryById = new Map<number, SymbolEntry>();
for (const entry of kermlStdlibEntries) {
  stdlibEntryById.set(entry.id, entry);
}

for (const entry of kermlStdlibEntries) {
  if (entry.name && entry.name !== "<anonymous>") {
    const cleanMember = entry.name.trim();
    STDLIB_SYMBOLS.add(cleanMember);
    // Walk parentId chain to register member under its enclosing stdlib Package(s)
    let currParentId = entry.parentId;
    while (currParentId != null) {
      const parentEntry = stdlibEntryById.get(currParentId);
      if (!parentEntry) break;
      if (parentEntry.name && parentEntry.name !== "<anonymous>") {
        addStdlibPkgMember(parentEntry.name.trim(), cleanMember);
      }
      currParentId = parentEntry.parentId;
    }
  }
}

for (const scalarType of [
  "Real",
  "Integer",
  "Boolean",
  "String",
  "Natural",
  "Positive",
  "UnlimitedNatural",
  "Complex",
  "Rational",
  "NumericalValue",
  "ScalarValue",
  "DataValue",
]) {
  addStdlibPkgMember("ScalarValues", scalarType);
  addStdlibPkgMember("CoreTypes", scalarType);
}

const ISQ_FAMILY_PACKAGES = [
  "ISQ",
  "ISQBase",
  "ISQSpaceTime",
  "ISQMechanics",
  "ISQThermodynamics",
  "ISQElectromagnetism",
  "ISQLight",
  "ISQChemistryMolecular",
  "ISQAtomicNuclear",
  "Quantities",
];
const baseIsqMembers = new Set<string>(["Real"]);
for (const pkg of ISQ_FAMILY_PACKAGES) {
  for (const m of STDLIB_PACKAGE_MEMBERS.get(pkg) ?? []) {
    baseIsqMembers.add(m);
  }
}
for (const dimKey of Object.keys(KNOWN_DIMENSIONS)) {
  baseIsqMembers.add(dimKey);
  baseIsqMembers.add(`${dimKey}Value`);
  STDLIB_SYMBOLS.add(`${dimKey}Value`);
}
for (const pkg of ISQ_FAMILY_PACKAGES) {
  for (const m of baseIsqMembers) {
    addStdlibPkgMember(pkg, m);
  }
}

const SI_FAMILY_PACKAGES = [
  "SI",
  "SIBaseUnits",
  "SIDerivedUnits",
  "USCustomaryUnits",
  "MeasurementReferences",
  "UnitsAndScales",
];
const baseSiMembers = new Set<string>(Object.keys(KNOWN_DIMENSIONS));
for (const pkg of SI_FAMILY_PACKAGES) {
  for (const m of STDLIB_PACKAGE_MEMBERS.get(pkg) ?? []) {
    baseSiMembers.add(m);
  }
}
for (const pkg of SI_FAMILY_PACKAGES) {
  for (const m of baseSiMembers) {
    addStdlibPkgMember(pkg, m);
  }
}

const FUNCTION_FAMILY_PACKAGES = [
  "NumericalFunctions",
  "TrigFunctions",
  "DataFunctions",
  "SequenceFunctions",
  "ControlFunctions",
  "VectorCalculations",
];
const baseFnMembers = new Set<string>([
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "sinh",
  "cosh",
  "tanh",
  "sqrt",
  "exp",
  "log",
  "ln",
  "abs",
  "min",
  "max",
  "sum",
  "product",
  "size",
  "isEmpty",
  "notEmpty",
]);
for (const pkg of FUNCTION_FAMILY_PACKAGES) {
  for (const m of STDLIB_PACKAGE_MEMBERS.get(pkg) ?? []) {
    baseFnMembers.add(m);
  }
}
for (const pkg of FUNCTION_FAMILY_PACKAGES) {
  for (const m of baseFnMembers) {
    addStdlibPkgMember(pkg, m);
    STDLIB_SYMBOLS.add(m);
  }
}

/**
 * Checks whether a symbol or qualified path belongs to the built-in KerML/SysML v2 standard library.
 */
export function isStdlibOrBuiltinSymbol(name: string): boolean {
  if (!name) return true;
  let clean = name.trim().replace(/^~\s*/, "");
  while (clean.endsWith("::*")) clean = clean.slice(0, -3);
  if (!clean || clean === "<anonymous>" || clean === "*") return true;
  if (clean.includes("::")) {
    const parts = clean
      .split("::")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return true;
    // Every namespace prefix segment must be a recognized standard library package
    for (let i = 0; i < parts.length - 1; i++) {
      if (!STDLIB_PACKAGES.has(parts[i]!)) {
        return false;
      }
    }
    const leaf = parts[parts.length - 1]!;
    if (STDLIB_PACKAGES.has(leaf)) return true;
    const parentPkg = parts[parts.length - 2]!;
    const pkgMembers = STDLIB_PACKAGE_MEMBERS.get(parentPkg);
    if (pkgMembers) {
      return pkgMembers.has(leaf);
    }
    return STDLIB_SYMBOLS.has(leaf);
  }
  return STDLIB_PACKAGES.has(clean) || STDLIB_SYMBOLS.has(clean);
}

/**
 * Result of static type inference over a SysML v2 / KerML expression CST node.
 */
export interface TypeInferenceResult {
  /** Resolved canonical type name (e.g. `"Real"`, `"Integer"`, `"Boolean"`), if determinable. */
  typeName?: string | undefined;
  /** Type error details and source byte span if an operator/operand type mismatch occurred. */
  error?:
    | {
        message: string;
        startOffset?: number | undefined;
        endOffset?: number | undefined;
      }
    | undefined;
}

/**
 * Normalizes a type name by stripping namespace prefixes (e.g. ScalarValues::Real -> Real).
 */
export function normalizeTypeName(name: string): string {
  if (!name) return "";
  const clean = name.trim();
  if (clean.includes("::")) {
    return clean.split("::").pop()!;
  }
  return clean;
}

/**
 * Checks whether sourceType is assignable to targetType in SysML v2 / KerML.
 */
export function isTypeAssignable(
  db: QueryDB,
  sourceType: string,
  targetType: string,
  visited = new Set<string>(),
): boolean {
  const normSource = normalizeTypeName(sourceType);
  const normTarget = normalizeTypeName(targetType);

  if (normSource === normTarget) return true;

  // Real accepts Integer, Natural, Positive (widening)
  if (normTarget === "Real") {
    if (["Integer", "Natural", "Positive"].includes(normSource)) {
      return true;
    }
  }

  // Integer accepts Natural, Positive
  if (normTarget === "Integer") {
    if (["Natural", "Positive"].includes(normSource)) {
      return true;
    }
  }

  // Prevent circular inheritance loops
  const key = `${normSource}:>${normTarget}`;
  if (visited.has(key)) return false;
  visited.add(key);

  // Look up source definition to check specialization (:>)
  const candidates = db.byName(normSource);
  for (const cand of candidates) {
    if (cand.kind !== "Definition") continue;

    // Check inherits metadata
    if (Array.isArray(cand.inherits)) {
      for (const sup of cand.inherits) {
        if (isTypeAssignable(db, sup, normTarget, visited)) {
          return true;
        }
      }
    }

    // Check OwnedSubclassification children
    const children = db.childrenOf(cand.id);
    for (const child of children) {
      if (
        child.ruleName === "OwnedSubclassification" ||
        child.ruleName === "Subclassification" ||
        child.kind === "Specialization"
      ) {
        if (child.name && isTypeAssignable(db, child.name, normTarget, visited)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Statically infers the type of an expression AST node.
 */
export function inferExpressionType(
  db: QueryDB,
  node: SysmlCstNode | null | undefined,
  scopeId: number | null,
): TypeInferenceResult {
  if (!node) return {};

  const type = node.type;

  // Literals
  if (type === "LiteralBoolean" || type === "BooleanValue") {
    return { typeName: "Boolean" };
  }
  if (type === "LiteralString" || type === "STRING_VALUE") {
    return { typeName: "String" };
  }
  if (type === "LiteralInteger" || type === "DECIMAL_VALUE") {
    return { typeName: "Integer" };
  }
  if (type === "LiteralReal" || type === "RealValue") {
    return { typeName: "Real" };
  }

  // Measurement expressions: e.g. 5 [kg] or 10.0 [m/s]
  if (type === "MeasurementExpression") {
    const valNode = node.childForFieldName ? node.childForFieldName("value") : node.children?.[0];
    if (valNode) {
      const valRes = inferExpressionType(db, valNode, scopeId);
      if (valRes.error) return valRes;
      return { typeName: valRes.typeName ?? "Real" };
    }
    return { typeName: "Real" };
  }

  // Feature references (variables, ports, parameters)
  if (type === "FeatureReferenceExpression" || type === "FeatureReferenceMember" || type === "FeatureReference") {
    let refName: string | null = null;
    const memberElem = node.childForFieldName ? node.childForFieldName("memberElement") : null;
    if (memberElem) {
      refName = memberElem.text?.trim() ?? null;
    } else if (node.text) {
      refName = node.text.trim();
    }
    if (!refName) return {};

    const resolved = resolvePathInScope(db, scopeId, refName);
    if (resolved) {
      const typeChild = db.childrenOf(resolved.id).find((c) => c.ruleName === "OwnedFeatureTyping");
      if (typeChild?.name) {
        return { typeName: normalizeTypeName(typeChild.name) };
      }
      if (resolved.metadata?.["typeSpecifier"]) {
        return { typeName: normalizeTypeName(String(resolved.metadata["typeSpecifier"])) };
      }
    }
    return {};
  }

  // Additive & Multiplicative Arithmetic
  if (type === "AdditiveExpression" || type === "MultiplicativeExpression" || type === "ExponentiationExpression") {
    const operands: SysmlCstNode[] = node.childrenForFieldName
      ? node.childrenForFieldName("operand")
      : (node.children?.filter((c: SysmlCstNode) => c.type.includes("Expression")) ?? []);

    if (operands.length < 2) {
      const single = operands[0] ?? node.children?.[0];
      return single ? inferExpressionType(db, single, scopeId) : {};
    }

    let isReal = false;
    for (const opNode of operands) {
      const res = inferExpressionType(db, opNode, scopeId);
      if (res.error) return res;
      if (res.typeName) {
        if (res.typeName === "Boolean" || res.typeName === "String") {
          return {
            error: {
              message: `Type error: arithmetic operators require numeric operands, got '${res.typeName}'.`,
              startOffset: opNode.startIndex ?? opNode.startOffset,
              endOffset: opNode.endIndex ?? opNode.endOffset,
            },
          };
        }
        if (res.typeName === "Real" || isTypeAssignable(db, res.typeName, "Real")) {
          isReal = true;
        }
      }
    }
    return { typeName: isReal ? "Real" : "Integer" };
  }

  // Relational (<, <=, >, >=) & Equality (==, !=)
  if (type === "RelationalExpression" || type === "EqualityExpression") {
    return { typeName: "Boolean" };
  }

  // Boolean Logic (and, or, xor, implies)
  if (type === "AndExpression" || type === "OrExpression" || type === "XorExpression" || type === "ImpliesExpression") {
    const operands: SysmlCstNode[] = node.childrenForFieldName
      ? node.childrenForFieldName("operand")
      : (node.children?.filter((c: SysmlCstNode) => c.type.includes("Expression")) ?? []);

    for (const opNode of operands) {
      const res = inferExpressionType(db, opNode, scopeId);
      if (res.error) return res;
      if (res.typeName && res.typeName !== "Boolean") {
        return {
          error: {
            message: `Type error: logical operators require Boolean operands, got '${res.typeName}'.`,
            startOffset: opNode.startIndex ?? opNode.startOffset,
            endOffset: opNode.endIndex ?? opNode.endOffset,
          },
        };
      }
    }
    return { typeName: "Boolean" };
  }

  // Unary Expression (+x, -x, not x)
  if (type === "UnaryExpression") {
    const opNode = node.childForFieldName ? node.childForFieldName("operator") : node.children?.[0];
    const operandNode = node.childForFieldName ? node.childForFieldName("operand") : node.children?.[1];
    const opText = opNode?.text?.trim() ?? "";

    if (operandNode) {
      const res = inferExpressionType(db, operandNode, scopeId);
      if (res.error) return res;
      if (opText === "not") {
        if (res.typeName && res.typeName !== "Boolean") {
          return {
            error: {
              message: `Type error: operator 'not' requires Boolean operand, got '${res.typeName}'.`,
              startOffset: operandNode.startIndex ?? operandNode.startOffset,
              endOffset: operandNode.endIndex ?? operandNode.endOffset,
            },
          };
        }
        return { typeName: "Boolean" };
      }
      return res;
    }
  }

  // Conditional Expression: if cond ? thenExpr else elseExpr
  if (type === "ConditionalExpression") {
    const thenNode = node.childForFieldName ? node.childForFieldName("thenOperand") : node.children?.[3];
    if (thenNode) {
      return inferExpressionType(db, thenNode, scopeId);
    }
  }

  // Transparent wrapper unwrapping
  const count = node.childCount ?? 0;
  if (count === 1) {
    return inferExpressionType(db, node.child ? node.child(0) : node.children?.[0], scopeId);
  }

  for (let i = 0; i < count; i++) {
    const c = node.child ? node.child(i) : node.children?.[i];
    if (c?.type && (c.type.includes("Expression") || c.type.includes("Literal") || c.type.includes("Value"))) {
      const res = inferExpressionType(db, c, scopeId);
      if (res.typeName || res.error) return res;
    }
  }

  return {};
}

function isDeclarationSymbol(c: SymbolEntry): boolean {
  return (
    c.kind !== "Reference" &&
    c.kind !== "Import" &&
    c.kind !== "Specialization" &&
    c.ruleName !== "OwnedFeatureTyping" &&
    c.ruleName !== "ConjugatedPortTyping" &&
    c.ruleName !== "OwnedSubclassification" &&
    c.ruleName !== "Subclassification" &&
    c.ruleName !== "OwnedSubsetting" &&
    c.ruleName !== "OwnedReferenceSubsetting" &&
    c.ruleName !== "OwnedCrossSubsetting" &&
    c.ruleName !== "OwnedRedefinition"
  );
}

function resolveFeatureInScopeLocal(db: QueryDB, scopeId: number | null, name: string): SymbolEntry | null {
  let currId: number | null = scopeId;
  const visited = new Set<number>();
  while (currId != null && !visited.has(currId)) {
    visited.add(currId);
    const children = db.childrenOf(currId);
    const found = children.find((c) => c.name === name && isDeclarationSymbol(c));
    if (found) return found;
    const scopeSym = db.symbol(currId);
    currId = scopeSym?.parentId ?? null;
  }
  const globals = db.byName(name)?.filter(isDeclarationSymbol);
  return globals?.[0] ?? null;
}

/**
 * Resolves a potentially hierarchical or qualified feature path (e.g. "engine.fuelIn", "a.b.c", "Pkg::Member")
 * within an enclosing scope.
 */
export function resolvePathInScope(db: QueryDB, scopeId: number | null, pathStr: string): SymbolEntry | null {
  if (!pathStr) return null;
  const cleanPath = pathStr.trim();

  // 1. If path contains "::", resolve via namespace path
  if (cleanPath.includes("::")) {
    const segments = cleanPath.split("::").map((s) => s.trim());
    const rootName = segments[0]!;
    const rest = segments.slice(1);
    const candidateRoots: SymbolEntry[] = [];
    const localRoot = resolveFeatureInScopeLocal(db, scopeId, rootName);
    if (localRoot) candidateRoots.push(localRoot);
    for (const globalSym of db.byName(rootName)?.filter(isDeclarationSymbol) ?? []) {
      if (!candidateRoots.some((r) => r.id === globalSym.id)) {
        candidateRoots.push(globalSym);
      }
    }
    for (const root of candidateRoots) {
      let curr: SymbolEntry | null = root;
      for (const seg of rest) {
        if (!curr) break;
        const children = db.childrenOf(curr.id);
        curr = children.find((c) => c.name === seg && isDeclarationSymbol(c)) ?? null;
      }
      if (curr) return curr;
    }
    return null;
  }

  // 2. If path contains ".", resolve via dot-notation (subpart -> port/feature)
  if (cleanPath.includes(".")) {
    const segments = cleanPath.split(".");
    const first: SymbolEntry | null = resolveFeatureInScopeLocal(db, scopeId, segments[0]!);
    if (!first) return null;
    let curr: SymbolEntry = first;

    for (let i = 1; i < segments.length; i++) {
      const segName = segments[i]!;

      // Determine the type definition of curr
      let typeDef: SymbolEntry | null = null;
      const typeChild = db.childrenOf(curr.id).find((c) => c.ruleName === "OwnedFeatureTyping" && c.name);
      if (typeChild?.name) {
        const norm = normalizeTypeName(typeChild.name);
        const candidates = db.byName(norm);
        typeDef = candidates.find((c) => c.kind === "Definition") ?? candidates[0] ?? null;
      }
      if (!typeDef && curr.metadata?.["typeSpecifier"]) {
        const norm = normalizeTypeName(String(curr.metadata["typeSpecifier"]));
        const candidates = db.byName(norm);
        typeDef = candidates.find((c) => c.kind === "Definition") ?? candidates[0] ?? null;
      }

      if (typeDef) {
        const member = findMemberInTypeDef(db, typeDef, segName);
        if (member) {
          curr = member;
          continue;
        }
      }

      // Check direct children of curr
      const direct: SymbolEntry | undefined = db.childrenOf(curr.id).find((c) => c.name === segName);
      if (direct) {
        curr = direct;
      } else {
        return null;
      }
    }
    return curr;
  }

  return resolveFeatureInScopeLocal(db, scopeId, cleanPath);
}

/**
 * Searches a type definition (and its inherited specialization hierarchy) for a member by name.
 */
function findMemberInTypeDef(
  db: QueryDB,
  typeDef: SymbolEntry,
  memberName: string,
  visited = new Set<number>(),
): SymbolEntry | null {
  if (visited.has(typeDef.id)) return null;
  visited.add(typeDef.id);

  // 1. Direct child
  const member = db.childrenOf(typeDef.id).find((c) => c.name === memberName);
  if (member) return member;

  // 2. Inherits from SymbolEntry.inherits
  for (const sup of typeDef.inherits || []) {
    const norm = normalizeTypeName(sup);
    const candidates = db.byName(norm);
    const parentDef = candidates.find((c) => c.kind === "Definition") ?? candidates[0];
    if (parentDef) {
      const found = findMemberInTypeDef(db, parentDef, memberName, visited);
      if (found) return found;
    }
  }

  // 3. Subclassification children (:>)
  for (const child of db.childrenOf(typeDef.id)) {
    if (
      child.ruleName === "OwnedSubclassification" ||
      child.ruleName === "Subclassification" ||
      child.kind === "Specialization"
    ) {
      if (child.name) {
        const norm = normalizeTypeName(child.name);
        const candidates = db.byName(norm);
        const parentDef = candidates.find((c) => c.kind === "Definition") ?? candidates[0];
        if (parentDef) {
          const found = findMemberInTypeDef(db, parentDef, memberName, visited);
          if (found) return found;
        }
      }
    }
  }

  return null;
}

/**
 * Statically validates that an attribute or feature binding matches its declared type.
 */
export function checkFeatureAssignmentType(db: QueryDB, self: SymbolEntry): LintResult | null {
  // 1. Resolve declared type of feature
  let declaredTypeName: string | null = null;
  for (const child of db.childrenOf(self.id)) {
    if (child.ruleName === "OwnedFeatureTyping" && child.name) {
      declaredTypeName = child.name;
      break;
    }
  }
  if (!declaredTypeName && self.metadata?.["typeSpecifier"]) {
    declaredTypeName = String(self.metadata["typeSpecifier"]);
  }
  if (!declaredTypeName) return null;

  // 2. Locate expression node in CST
  const cst = db.cstNode(self.id) as SysmlCstNode | null | undefined;
  if (!cst) return null;

  let exprNode: SysmlCstNode | null | undefined = null;
  for (const child of cst.children || []) {
    if (child.type === "OwnedExpression" || child.type === "ResultExpressionMember") {
      exprNode = child.type === "ResultExpressionMember" ? child.childForFieldName?.("ownedRelatedElement") : child;
      break;
    }
    if (child.type === "FeatureValue" || child.type === "_ValuePart" || child.type === "ValuePart") {
      exprNode =
        child.children?.find((c: SysmlCstNode) => c.type === "OwnedExpression") ||
        child.childForFieldName?.("ownedRelatedElement") ||
        child;
      break;
    }
  }
  if (!exprNode) return null;

  // 3. Statically infer the expression type
  const inferRes = inferExpressionType(db, exprNode, self.parentId ?? self.id);
  if (inferRes.error) {
    return error(inferRes.error.message, {
      code: SysML2ErrorCode.TYPE_MISMATCH.code,
      startOffset: inferRes.error.startOffset ?? self.startOffset,
      endOffset: inferRes.error.endOffset ?? self.endOffset,
    });
  }

  if (inferRes.typeName) {
    if (!isTypeAssignable(db, inferRes.typeName, declaredTypeName)) {
      const exprStart = exprNode.startIndex ?? exprNode.startOffset;
      const exprEnd = exprNode.endIndex ?? exprNode.endOffset;
      return error(
        SysML2ErrorCode.TYPE_MISMATCH.message(self.name || "<anonymous>", declaredTypeName, inferRes.typeName),
        {
          code: SysML2ErrorCode.TYPE_MISMATCH.code,
          field: "declaredName",
          ...(typeof exprStart === "number" && typeof exprEnd === "number" && exprEnd > exprStart
            ? { startOffset: exprStart, endOffset: exprEnd }
            : {}),
        },
      );
    }
  }

  return null;
}

/**
 * Statically validates that port and connector endpoints are plug-compatible.
 */
export function checkConnectionTypeCompatibility(db: QueryDB, self: SymbolEntry): LintResult | null {
  const refs = db.childrenOf(self.id).filter((c) => c.kind === "Reference");
  if (refs.length < 2) return null;

  const getEndpointName = (ref: SymbolEntry) => {
    const chainChildren = db.childrenOf(ref.id).filter((c) => c.name && c.name !== "<anonymous>");
    if (chainChildren.length > 0) {
      return chainChildren.map((c) => c.name).join(".");
    }
    if (ref.name && ref.name !== "OwnedReferenceSubsetting") {
      return ref.name.trim();
    }
    return (db.cstText(ref.startOffset, ref.endOffset) || "").trim();
  };

  const getPortType = (entry: SymbolEntry) => {
    const typeChild = db.childrenOf(entry.id).find((c) => c.ruleName === "OwnedFeatureTyping");
    if (typeChild?.name) return normalizeTypeName(typeChild.name);
    if (entry.metadata?.["typeSpecifier"]) return normalizeTypeName(String(entry.metadata["typeSpecifier"]));
    return null;
  };

  for (let r = 0; r < refs.length - 1; r++) {
    const sourceName = getEndpointName(refs[r]!);
    const targetName = getEndpointName(refs[r + 1]!);
    const sourceEntry = resolvePathInScope(db, self.parentId, sourceName);
    const targetEntry = resolvePathInScope(db, self.parentId, targetName);

    if (sourceEntry && targetEntry) {
      const sourceType = getPortType(sourceEntry);
      const targetType = getPortType(targetEntry);

      if (sourceType && targetType && sourceType !== targetType) {
        // Check if one specializes the other
        const compat1 = isTypeAssignable(db, sourceType, targetType);
        const compat2 = isTypeAssignable(db, targetType, sourceType);
        if (!compat1 && !compat2) {
          return error(
            SysML2ErrorCode.INCOMPATIBLE_PORT_CONNECTION.message(sourceName, sourceType, targetName, targetType),
            {
              code: SysML2ErrorCode.INCOMPATIBLE_PORT_CONNECTION.code,
              field: "declaredName",
              startOffset: self.startOffset,
              endOffset: self.endOffset,
            },
          );
        }
      }
    }
  }

  return null;
}

/**
 * Statically validates that type references (: Type) and specialization references (:> Super)
 * resolve in scope or the standard library (Code S2002).
 */
export function checkSymbolResolution(db: QueryDB, self: SymbolEntry): LintResult | null {
  const children = db.childrenOf(self.id);
  for (const child of children) {
    if (
      child.ruleName === "OwnedFeatureTyping" ||
      child.ruleName === "ConjugatedPortTyping" ||
      child.ruleName === "OwnedSubclassification" ||
      child.ruleName === "Subclassification"
    ) {
      const rawName = (child.name || db.cstText(child.startOffset, child.endOffset, child) || "").trim();
      const cleanName = rawName.replace(/^~\s*/, "").trim();
      if (!cleanName || cleanName === "<anonymous>" || isStdlibOrBuiltinSymbol(cleanName)) continue;

      const resolved =
        resolvePathInScope(db, self.parentId ?? self.id, cleanName) ??
        (!cleanName.includes("::") ? db.byName(normalizeTypeName(cleanName))?.find(isDeclarationSymbol) : null) ??
        null;
      if (!resolved) {
        return error(SysML2ErrorCode.SYMBOL_NOT_FOUND.message(cleanName), {
          code: SysML2ErrorCode.SYMBOL_NOT_FOUND.code,
          startOffset: child.startOffset ?? self.startOffset,
          endOffset: child.endOffset ?? self.endOffset,
        });
      }
    }
  }
  for (const inh of self.inherits || []) {
    const cleanName = inh.replace(/^~\s*/, "").trim();
    if (!cleanName || cleanName === "<anonymous>" || isStdlibOrBuiltinSymbol(cleanName)) continue;
    const resolved =
      resolvePathInScope(db, self.parentId ?? self.id, cleanName) ??
      (!cleanName.includes("::") ? db.byName(normalizeTypeName(cleanName))?.find(isDeclarationSymbol) : null) ??
      null;
    if (!resolved) {
      return error(SysML2ErrorCode.SYMBOL_NOT_FOUND.message(cleanName), {
        code: SysML2ErrorCode.SYMBOL_NOT_FOUND.code,
        startOffset: self.startOffset,
        endOffset: self.endOffset,
      });
    }
  }
  return null;
}

/**
 * Statically validates that MembershipImport and NamespaceImport declarations resolve
 * to an existing package or symbol in the workspace or standard library (Code S2005).
 */
export function checkImportResolution(db: QueryDB, self: SymbolEntry): LintResult | null {
  let rawImport = (self.name && self.name !== "<anonymous>" ? self.name : "").trim();
  if (!rawImport) {
    const refChild = db.childrenOf(self.id).find((c) => c.kind === "Reference" && c.name);
    if (refChild?.name) {
      rawImport = refChild.name.trim();
    } else {
      const text = db.cstText(self.startOffset, self.endOffset, self) || "";
      const m = /\bimport\s+(?:all\s+)?([A-Za-z_][A-Za-z0-9_:]*)/.exec(text);
      if (m?.[1]) {
        rawImport = m[1].replace(/::\*+.*$/, "").trim();
      }
    }
  }
  if (!rawImport) return null;

  let cleanTarget = rawImport.trim();
  while (cleanTarget.endsWith("::*")) cleanTarget = cleanTarget.slice(0, -3);
  cleanTarget = cleanTarget.trim();
  if (!cleanTarget || isStdlibOrBuiltinSymbol(cleanTarget)) return null;

  const resolved =
    resolvePathInScope(db, self.parentId, cleanTarget) ??
    db.byName(cleanTarget)?.find(isDeclarationSymbol) ??
    (!cleanTarget.includes("::") ? db.byName(normalizeTypeName(cleanTarget))?.find(isDeclarationSymbol) : null) ??
    null;

  if (!resolved) {
    return error(SysML2ErrorCode.UNRESOLVED_IMPORT.message(rawImport), {
      code: SysML2ErrorCode.UNRESOLVED_IMPORT.code,
      startOffset: self.startOffset,
      endOffset: self.endOffset,
    });
  }
  return null;
}

/**
 * Object-oriented wrapper around the SysML v2 static type checking and name resolution queries.
 * Accepts either a `SymbolEntry` or numeric symbol ID for each validation rule.
 */
export class SysML2TypeChecker {
  /**
   * @param db - Active Salsa `QueryDB` backing symbol and CST lookups.
   */
  constructor(private db: QueryDB) {}

  /**
   * Validates that a feature's bound value expression is assignable to its declared type (`S3001`).
   */
  checkFeatureAssignmentType(entryOrId: SymbolEntry | number): LintResult | null {
    const entry = typeof entryOrId === "number" ? this.db.symbol(entryOrId) : entryOrId;
    if (!entry) return null;
    return checkFeatureAssignmentType(this.db, entry);
  }

  /**
   * Validates that connected port endpoints have mutually compatible types (`S3002`).
   */
  checkConnectionTypeCompatibility(entryOrId: SymbolEntry | number): LintResult | null {
    const entry = typeof entryOrId === "number" ? this.db.symbol(entryOrId) : entryOrId;
    if (!entry) return null;
    return checkConnectionTypeCompatibility(this.db, entry);
  }

  /**
   * Validates that feature typing (`:`) and specialization (`:>`) references resolve in scope (`S2002`).
   */
  checkSymbolResolution(entryOrId: SymbolEntry | number): LintResult | null {
    const entry = typeof entryOrId === "number" ? this.db.symbol(entryOrId) : entryOrId;
    if (!entry) return null;
    return checkSymbolResolution(this.db, entry);
  }

  /**
   * Validates that `import` clauses resolve to known packages or standard library symbols (`S2005`).
   */
  checkImportResolution(entryOrId: SymbolEntry | number): LintResult | null {
    const entry = typeof entryOrId === "number" ? this.db.symbol(entryOrId) : entryOrId;
    if (!entry) return null;
    return checkImportResolution(this.db, entry);
  }
}
