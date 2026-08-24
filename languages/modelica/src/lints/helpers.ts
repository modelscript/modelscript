import type { CodeGraph, u16, u32, u8 } from "@modelscript/language";

export const TYPE_UNKNOWN: u16 = 0xffff;
export const TYPE_REAL: u16 = 0;
export const TYPE_INTEGER: u16 = 1;
export const TYPE_BOOLEAN: u16 = 2;
export const TYPE_STRING: u16 = 3;
export const TYPE_ENUM: u16 = 4;
export const TYPE_CLOCK: u16 = 5;

export const VARIABILITY_CONTINUOUS: u8 = 0;
export const VARIABILITY_DISCRETE: u8 = 1;
export const VARIABILITY_PARAMETER: u8 = 2;
export const VARIABILITY_CONSTANT: u8 = 3;

/**
 * Resolves a complex dot-separated name (e.g. `a.b.c` or single identifier `x`)
 * to a target symbol or AST declaration pointer.
 */
export function resolveComplexName(db: CodeGraph, nameNode: u32, $: Record<string, u16>): u32 {
  if (nameNode == 0) return 0;
  const nodeType = db.ast.getType(nameNode);

  if (nodeType == $.identifier) {
    return db.scope.resolve(nameNode);
  }

  const firstChild = db.ast.getFirstChild(nameNode);
  if (firstChild == 0) return 0;

  let currentScope = db.scope.resolve(firstChild);
  if (currentScope == 0) return 0;

  let nextSegment = db.ast.getNextSibling(firstChild);
  while (nextSegment != 0) {
    const span = db.ast.getTextSpan(nextSegment);
    const memberHash = db.ast.hashSpan(span);
    currentScope = db.model.resolveHash(currentScope, memberHash);
    if (currentScope == 0) return 0;
    nextSegment = db.ast.getNextSibling(nextSegment);
  }

  return currentScope;
}

/**
 * Infers the basic variable type of an AST expression node.
 */
export function inferExprType(db: CodeGraph, exprNode: u32, $: Record<string, u16>): u16 {
  if (exprNode == 0) return TYPE_UNKNOWN;
  const nodeType = db.ast.getType(exprNode);

  if (nodeType == $.unsigned_real) return TYPE_REAL;
  if (nodeType == $.unsigned_integer) return TYPE_INTEGER;
  if (nodeType == $.string_literal) return TYPE_STRING;

  if (db.ast.textEquals(exprNode, "true") || db.ast.textEquals(exprNode, "false")) {
    return TYPE_BOOLEAN;
  }

  // Identifier / component reference
  if (nodeType == $.identifier || nodeType == $.name || nodeType == $.component_reference) {
    const symId = resolveComplexName(db, exprNode, $);
    if (symId != 0) {
      return db.model.getProperty(symId, "baseType") as u16;
    }
  }

  // Clock constructor -> Clock
  if (nodeType == $.function_call_args || nodeType == $.primary) {
    const funcName = db.ast.getChildByFieldId(exprNode, "name");
    if (funcName != 0 && db.ast.textEquals(funcName, "Clock")) {
      return TYPE_CLOCK;
    }
  }

  return TYPE_UNKNOWN;
}

/**
 * Checks whether an actual type is compatible with (or a subtype of) an expected type.
 */
export function isTypeCompatible(actualType: u16, expectedType: u16): boolean {
  if (actualType == expectedType) return true;
  // Integer coerces to Real
  if (actualType == TYPE_INTEGER && expectedType == TYPE_REAL) return true;
  return false;
}

/**
 * Determines the variability of an expression.
 */
export function getExpressionVariability(db: CodeGraph, exprNode: u32, $: Record<string, u16>): u8 {
  if (exprNode == 0) return VARIABILITY_CONSTANT;

  // Check if expression directly references `time` -> Continuous
  for (const ident of db.ast.getDescendants(exprNode, $.identifier)) {
    if (db.ast.textEquals(ident, "time")) {
      return VARIABILITY_CONTINUOUS;
    }
  }

  return VARIABILITY_CONSTANT;
}

/**
 * Fast $O(1)$ check for class kind (e.g. "function", "record", "connector", "model", "block", "package").
 * Inspects immediate class prefix children rather than walking all descendants of the class.
 */
export function isClassKind(db: CodeGraph, clsNode: u32, kind: string): boolean {
  if (clsNode == 0) return false;
  let ch = db.ast.getFirstChild(clsNode);
  while (ch != 0) {
    if (db.ast.textEquals(ch, kind)) return true;
    let sub = db.ast.getFirstChild(ch);
    while (sub != 0) {
      if (db.ast.textEquals(sub, kind)) return true;
      sub = db.ast.getNextSibling(sub);
    }
    ch = db.ast.getNextSibling(ch);
  }
  return false;
}

/**
 * Fast check for whether a component_clause has a specific type prefix (e.g. "constant", "input", "output", "flow", "stream").
 */
export function hasTypePrefix(db: CodeGraph, compClauseNode: u32, prefix: string): boolean {
  if (compClauseNode == 0) return false;
  let pfx = db.ast.getChildByFieldId(compClauseNode, "type_prefix");
  if (pfx == 0) pfx = db.ast.getChildByFieldId(compClauseNode, "typePrefix");
  if (pfx != 0) {
    if (db.ast.textEquals(pfx, prefix)) return true;
    let ch = db.ast.getFirstChild(pfx);
    while (ch != 0) {
      if (db.ast.textEquals(ch, prefix)) return true;
      ch = db.ast.getNextSibling(ch);
    }
  }
  return false;
}

/**
 * Fast lookup to check if an identifier matches any top-level class name in the document.
 */
export function isTopLevelClassName(db: CodeGraph, nameNode: u32, $: Record<string, u16>): boolean {
  const docRoot = db.ast.getRootNode();
  if (docRoot == 0) return false;
  for (const spec of db.ast.getDescendants(docRoot, $.long_class_specifier)) {
    const nameId = db.ast.getChildByFieldId(spec, "name");
    if (nameId != 0 && db.ast.textEqualsNode(nameNode, nameId)) {
      return true;
    }
  }
  for (const spec of db.ast.getDescendants(docRoot, $.short_class_specifier)) {
    const nameId = db.ast.getChildByFieldId(spec, "name");
    if (nameId != 0 && db.ast.textEqualsNode(nameNode, nameId)) {
      return true;
    }
  }
  return false;
}
