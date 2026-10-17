// SPDX-License-Identifier: AGPL-3.0-or-later

import { error, type LintResult } from "@modelscript/dsl";
import type { QueryDB, SymbolEntry } from "@modelscript/runtime";
import { kermlStdlibEntries } from "../src-gen/kerml-snapshot.js";
import { KNOWN_DIMENSIONS } from "./dimensions.js";
import { SysML2ErrorCode } from "./errors.js";

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

for (const entry of kermlStdlibEntries) {
  if (entry.name && entry.name !== "<anonymous>") {
    STDLIB_SYMBOLS.add(entry.name.trim());
  }
}

/**
 * Checks whether a symbol or qualified path belongs to the built-in KerML/SysML v2 standard library.
 */
export function isStdlibOrBuiltinSymbol(name: string): boolean {
  if (!name) return true;
  const clean = name
    .trim()
    .replace(/^~\s*/, "")
    .replace(/::\*+(?:::\*+)*$/, "");
  if (!clean || clean === "<anonymous>" || clean === "*") return true;
  if (clean.includes("::")) {
    const parts = clean.split("::");
    const rootPkg = parts[0]!.trim();
    const leaf = parts[parts.length - 1]!.trim();
    if (STDLIB_PACKAGES.has(rootPkg)) return true;
    if (STDLIB_SYMBOLS.has(leaf)) return true;
    return false;
  }
  return STDLIB_PACKAGES.has(clean) || STDLIB_SYMBOLS.has(clean);
}

export interface TypeInferenceResult {
  typeName?: string;
  error?: {
    message: string;
    startByte?: number;
    endByte?: number;
  };
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
export function inferExpressionType(db: QueryDB, node: any, scopeId: number | null): TypeInferenceResult {
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
    if (node.childForFieldName && node.childForFieldName("memberElement")) {
      refName = node.childForFieldName("memberElement").text?.trim() ?? null;
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
      if (resolved.metadata?.typeSpecifier) {
        return { typeName: normalizeTypeName(String(resolved.metadata.typeSpecifier)) };
      }
    }
    return {};
  }

  // Additive & Multiplicative Arithmetic
  if (type === "AdditiveExpression" || type === "MultiplicativeExpression" || type === "ExponentiationExpression") {
    const operands: any[] = node.childrenForFieldName
      ? node.childrenForFieldName("operand")
      : (node.children?.filter((c: any) => c.type.includes("Expression")) ?? []);

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
              startByte: opNode.startIndex ?? opNode.startOffset ?? opNode.startByte,
              endByte: opNode.endIndex ?? opNode.endOffset ?? opNode.endByte,
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
    const operands: any[] = node.childrenForFieldName
      ? node.childrenForFieldName("operand")
      : (node.children?.filter((c: any) => c.type.includes("Expression")) ?? []);

    for (const opNode of operands) {
      const res = inferExpressionType(db, opNode, scopeId);
      if (res.error) return res;
      if (res.typeName && res.typeName !== "Boolean") {
        return {
          error: {
            message: `Type error: logical operators require Boolean operands, got '${res.typeName}'.`,
            startByte: opNode.startIndex ?? opNode.startOffset ?? opNode.startByte,
            endByte: opNode.endIndex ?? opNode.endOffset ?? opNode.endByte,
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
              startByte: operandNode.startIndex ?? operandNode.startOffset ?? operandNode.startByte,
              endByte: operandNode.endIndex ?? operandNode.endOffset ?? operandNode.endByte,
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
  if (node.childCount === 1) {
    return inferExpressionType(db, node.child(0), scopeId);
  }

  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c.type && (c.type.includes("Expression") || c.type.includes("Literal") || c.type.includes("Value"))) {
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
    const segments = cleanPath.split("::");
    const rootName = segments[0]!;
    const rest = segments.slice(1);
    let curr: SymbolEntry | null = resolveFeatureInScopeLocal(db, scopeId, rootName);
    for (const seg of rest) {
      if (!curr) return null;
      const children = db.childrenOf(curr.id);
      curr = children.find((c) => c.name === seg) ?? null;
    }
    return curr;
  }

  // 2. If path contains ".", resolve via dot-notation (subpart -> port/feature)
  if (cleanPath.includes(".")) {
    const segments = cleanPath.split(".");
    let curr: SymbolEntry | null = resolveFeatureInScopeLocal(db, scopeId, segments[0]!);
    if (!curr) return null;

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
      if (!typeDef && curr.metadata?.typeSpecifier) {
        const norm = normalizeTypeName(String(curr.metadata.typeSpecifier));
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
      const direct = db.childrenOf(curr.id).find((c) => c.name === segName);
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
  if (!declaredTypeName && self.metadata?.typeSpecifier) {
    declaredTypeName = String(self.metadata.typeSpecifier);
  }
  if (!declaredTypeName) return null;

  // 2. Locate expression node in CST
  const cst = db.cstNode(self.id) as any;
  if (!cst) return null;

  let exprNode: any = null;
  for (const child of cst.children || []) {
    if (child.type === "OwnedExpression" || child.type === "ResultExpressionMember") {
      exprNode = child.type === "ResultExpressionMember" ? child.childForFieldName?.("ownedRelatedElement") : child;
      break;
    }
    if (child.type === "FeatureValue" || child.type === "_ValuePart" || child.type === "ValuePart") {
      exprNode =
        child.children?.find((c: any) => c.type === "OwnedExpression") ||
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
      startByte: inferRes.error.startByte ?? self.startByte,
      endByte: inferRes.error.endByte ?? self.endByte,
    });
  }

  if (inferRes.typeName) {
    if (!isTypeAssignable(db, inferRes.typeName, declaredTypeName)) {
      const exprStart = exprNode.startIndex ?? exprNode.startOffset ?? exprNode.startByte;
      const exprEnd = exprNode.endIndex ?? exprNode.endOffset ?? exprNode.endByte;
      return error(
        SysML2ErrorCode.TYPE_MISMATCH.message(self.name || "<anonymous>", declaredTypeName, inferRes.typeName),
        {
          code: SysML2ErrorCode.TYPE_MISMATCH.code,
          field: "declaredName",
          ...(typeof exprStart === "number" && typeof exprEnd === "number" && exprEnd > exprStart
            ? { startByte: exprStart, endByte: exprEnd }
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
    return (db.cstText(ref.startByte, ref.endByte) || "").trim();
  };

  const getPortType = (entry: SymbolEntry) => {
    const typeChild = db.childrenOf(entry.id).find((c) => c.ruleName === "OwnedFeatureTyping");
    if (typeChild?.name) return normalizeTypeName(typeChild.name);
    if (entry.metadata?.typeSpecifier) return normalizeTypeName(String(entry.metadata.typeSpecifier));
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
              startByte: self.startByte,
              endByte: self.endByte,
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
      const rawName = (child.name || db.cstText(child.startByte, child.endByte, child) || "").trim();
      const cleanName = rawName.replace(/^~\s*/, "").trim();
      if (!cleanName || cleanName === "<anonymous>" || isStdlibOrBuiltinSymbol(cleanName)) continue;

      const resolved =
        resolvePathInScope(db, self.parentId ?? self.id, cleanName) ??
        db.byName(normalizeTypeName(cleanName))?.find(isDeclarationSymbol) ??
        null;
      if (!resolved) {
        return error(SysML2ErrorCode.SYMBOL_NOT_FOUND.message(cleanName), {
          code: SysML2ErrorCode.SYMBOL_NOT_FOUND.code,
          startByte: child.startByte ?? self.startByte,
          endByte: child.endByte ?? self.endByte,
        });
      }
    }
  }
  for (const inh of self.inherits || []) {
    const cleanName = inh.replace(/^~\s*/, "").trim();
    if (!cleanName || cleanName === "<anonymous>" || isStdlibOrBuiltinSymbol(cleanName)) continue;
    const resolved =
      resolvePathInScope(db, self.parentId ?? self.id, cleanName) ??
      db.byName(normalizeTypeName(cleanName))?.find(isDeclarationSymbol) ??
      null;
    if (!resolved) {
      return error(SysML2ErrorCode.SYMBOL_NOT_FOUND.message(cleanName), {
        code: SysML2ErrorCode.SYMBOL_NOT_FOUND.code,
        startByte: self.startByte,
        endByte: self.endByte,
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
      const text = db.cstText(self.startByte, self.endByte, self) || "";
      const m = /\bimport\s+(?:all\s+)?([A-Za-z_][A-Za-z0-9_:]*)/.exec(text);
      if (m?.[1]) {
        rawImport = m[1].replace(/::\*+.*$/, "").trim();
      }
    }
  }
  if (!rawImport) return null;

  const cleanTarget = rawImport.replace(/::\*+(?:::\*+)*$/, "").trim();
  if (!cleanTarget || isStdlibOrBuiltinSymbol(cleanTarget)) return null;

  const resolved =
    resolvePathInScope(db, self.parentId, cleanTarget) ??
    db.byName(cleanTarget)?.find(isDeclarationSymbol) ??
    db.byName(normalizeTypeName(cleanTarget))?.find(isDeclarationSymbol) ??
    null;

  if (!resolved) {
    return error(SysML2ErrorCode.UNRESOLVED_IMPORT.message(rawImport), {
      code: SysML2ErrorCode.UNRESOLVED_IMPORT.code,
      startByte: self.startByte,
      endByte: self.endByte,
    });
  }
  return null;
}

export class SysML2TypeChecker {
  constructor(private db: QueryDB) {}

  checkFeatureAssignmentType(entryOrId: SymbolEntry | number): LintResult | null {
    const entry = typeof entryOrId === "number" ? this.db.symbol(entryOrId) : entryOrId;
    if (!entry) return null;
    return checkFeatureAssignmentType(this.db, entry);
  }

  checkConnectionTypeCompatibility(entryOrId: SymbolEntry | number): LintResult | null {
    const entry = typeof entryOrId === "number" ? this.db.symbol(entryOrId) : entryOrId;
    if (!entry) return null;
    return checkConnectionTypeCompatibility(this.db, entry);
  }

  checkSymbolResolution(entryOrId: SymbolEntry | number): LintResult | null {
    const entry = typeof entryOrId === "number" ? this.db.symbol(entryOrId) : entryOrId;
    if (!entry) return null;
    return checkSymbolResolution(this.db, entry);
  }

  checkImportResolution(entryOrId: SymbolEntry | number): LintResult | null {
    const entry = typeof entryOrId === "number" ? this.db.symbol(entryOrId) : entryOrId;
    if (!entry) return null;
    return checkImportResolution(this.db, entry);
  }
}
