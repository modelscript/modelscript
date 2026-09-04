import type { CodeGraph, u16, u32, u8 } from "@modelscript/language";
import type { SIUnit } from "../units.js";
import { createDimensionless, parseUnit, unitDivide, unitMultiply, unitPower } from "../units.js";

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
  if (nodeType == $.unsigned_number) {
    for (const r of db.ast.getDescendants(exprNode, $.unsigned_real)) {
      if (r != 0) return TYPE_REAL;
    }
    return TYPE_INTEGER;
  }
  if (nodeType == $.string_literal) return TYPE_STRING;

  if (db.ast.textEquals(exprNode, "true") || db.ast.textEquals(exprNode, "false")) {
    return TYPE_BOOLEAN;
  }
  if (db.ast.textEquals(exprNode, "time")) {
    return TYPE_REAL;
  }

  // 1. If node is an expression / primary wrapper, check for relational / logical / arithmetic operators
  if (
    nodeType == $.expression ||
    nodeType == $.primary ||
    nodeType == $.some_equation ||
    nodeType == $.simple_equation
  ) {
    const leftChild = db.ast.getChildByFieldId(exprNode, "left");
    const rightChild = db.ast.getChildByFieldId(exprNode, "right");
    if (leftChild != 0 && rightChild != 0) {
      const op = db.ast.getBinaryOp(leftChild, rightChild);
      if (op >= 10 && op <= 17) {
        return TYPE_BOOLEAN;
      }
      for (const ch of db.ast.getDescendants(exprNode)) {
        if (
          db.ast.textEquals(ch, "==") ||
          db.ast.textEquals(ch, "<>") ||
          db.ast.textEquals(ch, "<") ||
          db.ast.textEquals(ch, "<=") ||
          db.ast.textEquals(ch, ">") ||
          db.ast.textEquals(ch, ">=") ||
          db.ast.textEquals(ch, "and") ||
          db.ast.textEquals(ch, "or") ||
          db.ast.textEquals(ch, "not")
        ) {
          return TYPE_BOOLEAN;
        }
      }
      const lType = inferExprType(db, leftChild, $);
      const rType = inferExprType(db, rightChild, $);
      if (lType == TYPE_REAL || rType == TYPE_REAL) return TYPE_REAL;
      if (lType == TYPE_INTEGER && rType == TYPE_INTEGER) return TYPE_INTEGER;
      if (lType != TYPE_UNKNOWN) return lType;
      if (rType != TYPE_UNKNOWN) return rType;
    }
  }

  // 2. Built-in functions & function calls (sample, sin, cos, pre, etc.)
  for (const cr of db.ast.getDescendants(exprNode, $.component_reference)) {
    if (cr != 0) {
      const sib = db.ast.getNextSibling(cr);
      if (sib != 0 && (db.ast.getType(sib) == $.function_call_args || db.ast.textEquals(sib, "("))) {
        if (db.ast.textEquals(cr, "sample") || db.ast.textEquals(cr, "initial") || db.ast.textEquals(cr, "terminal")) {
          return TYPE_BOOLEAN;
        }
        if (
          db.ast.textEquals(cr, "sin") ||
          db.ast.textEquals(cr, "cos") ||
          db.ast.textEquals(cr, "tan") ||
          db.ast.textEquals(cr, "asin") ||
          db.ast.textEquals(cr, "acos") ||
          db.ast.textEquals(cr, "atan") ||
          db.ast.textEquals(cr, "atan2") ||
          db.ast.textEquals(cr, "sinh") ||
          db.ast.textEquals(cr, "cosh") ||
          db.ast.textEquals(cr, "tanh") ||
          db.ast.textEquals(cr, "exp") ||
          db.ast.textEquals(cr, "log") ||
          db.ast.textEquals(cr, "log10") ||
          db.ast.textEquals(cr, "sqrt")
        ) {
          return TYPE_REAL;
        }
        if (
          db.ast.textEquals(cr, "integer") ||
          db.ast.textEquals(cr, "floor") ||
          db.ast.textEquals(cr, "ceil") ||
          db.ast.textEquals(cr, "div") ||
          db.ast.textEquals(cr, "mod") ||
          db.ast.textEquals(cr, "rem")
        ) {
          return TYPE_INTEGER;
        }
        if (db.ast.textEquals(cr, "Clock")) {
          return TYPE_CLOCK;
        }
        if (db.ast.textEquals(cr, "String")) {
          return TYPE_STRING;
        }
        const fnRet = resolveFunctionReturnType(db, cr, $);
        if (fnRet != TYPE_UNKNOWN) {
          return fnRet;
        }
      }
    }
  }

  // If expression: if ... then ... else ...
  if (db.ast.startsWith(exprNode, "if") || db.ast.textEquals(exprNode, "if")) {
    let curr = db.ast.getFirstChild(exprNode);
    let checkNext = false;
    while (curr != 0) {
      if (checkNext) {
        const branchType = inferExprType(db, curr, $);
        if (branchType != TYPE_UNKNOWN) return branchType;
        checkNext = false;
      }
      if (db.ast.textEquals(curr, "then") || db.ast.textEquals(curr, "else")) {
        checkNext = true;
      }
      curr = db.ast.getNextSibling(curr);
    }
  }

  // Find enclosing class definition for component reference resolution
  let enclosingClass: u32 = 0;
  for (const anc of db.ast.getAncestors(exprNode)) {
    if (db.ast.getType(anc) == $.class_definition) {
      enclosingClass = anc;
      break;
    }
  }

  // Component reference / Identifier lookup in enclosingClass
  if (enclosingClass != 0) {
    let compRef: u32 = 0;
    if (nodeType == $.component_reference || nodeType == $.name || nodeType == $.identifier) {
      compRef = exprNode;
    } else {
      for (const cr of db.ast.getDescendants(exprNode, $.component_reference)) {
        compRef = cr;
        break;
      }
      if (compRef == 0) {
        for (const id of db.ast.getDescendants(exprNode, $.identifier)) {
          compRef = id;
          break;
        }
      }
    }
    if (compRef != 0) {
      const resolvedType = db.runQuery("resolveDottedType", enclosingClass, compRef) as u16;
      if (resolvedType != TYPE_UNKNOWN) return resolvedType;
    }
  }

  // Identifier / component reference global symbol lookup fallback
  if (nodeType == $.identifier || nodeType == $.name || nodeType == $.component_reference) {
    const symId = resolveComplexName(db, exprNode, $);
    if (symId != 0) {
      const baseType = db.model.getProperty(symId, "baseType") as u16;
      if (baseType != 0) return baseType;
    }
  }

  // Clock constructor -> Clock
  if (nodeType == $.function_call_args || nodeType == $.primary) {
    const funcName = db.ast.getChildByFieldId(exprNode, "name");
    if (funcName != 0 && db.ast.textEquals(funcName, "Clock")) {
      return TYPE_CLOCK;
    }
  }
  // Finally, check descendants for literals if wrapped in modification_expression / expression
  for (const lit of db.ast.getDescendants(exprNode, $.string_literal)) {
    if (lit != 0) return TYPE_STRING;
  }
  for (const lit of db.ast.getDescendants(exprNode, $.unsigned_real)) {
    if (lit != 0) return TYPE_REAL;
  }
  for (const lit of db.ast.getDescendants(exprNode, $.unsigned_integer)) {
    if (lit != 0) return TYPE_INTEGER;
  }
  for (const lit of db.ast.getDescendants(exprNode, $.unsigned_number)) {
    if (lit != 0) {
      for (const r of db.ast.getDescendants(lit, $.unsigned_real)) {
        if (r != 0) return TYPE_REAL;
      }
      return TYPE_INTEGER;
    }
  }

  return TYPE_UNKNOWN;
}

/**
 * Resolves a type identifier (e.g. `Real`, `Concentration`, `Voltage`) to its primitive scalar type:
 * TYPE_REAL, TYPE_INTEGER, TYPE_BOOLEAN, TYPE_STRING, TYPE_CLOCK, or TYPE_UNKNOWN.
 */
export function resolveBasePrimitiveType(db: CodeGraph, typeNameId: u32, $: Record<string, u16>): u16 {
  if (typeNameId == 0) return TYPE_UNKNOWN;

  if (db.ast.textEquals(typeNameId, "Real")) return TYPE_REAL;
  if (db.ast.textEquals(typeNameId, "Integer")) return TYPE_INTEGER;
  if (db.ast.textEquals(typeNameId, "Boolean")) return TYPE_BOOLEAN;
  if (db.ast.textEquals(typeNameId, "String")) return TYPE_STRING;
  if (db.ast.textEquals(typeNameId, "Clock")) return TYPE_CLOCK;

  const docRoot = db.ast.getRootNode();
  if (docRoot != 0 && $.short_class_specifier != 0) {
    for (const spec of db.ast.getDescendants(docRoot, $.short_class_specifier)) {
      let specName = db.ast.getChildByFieldId(spec, "name");
      if (specName == 0) {
        for (const id of db.ast.getDescendants(spec, $.identifier)) {
          specName = id;
          break;
        }
      }
      if (specName != 0 && db.ast.textEqualsNode(typeNameId, specName)) {
        for (const ts of db.ast.getDescendants(spec, $.type_specifier)) {
          for (const baseId of db.ast.getDescendants(ts, $.identifier)) {
            const resolved = resolveBasePrimitiveType(db, baseId, $);
            if (resolved != TYPE_UNKNOWN) return resolved;
          }
        }
      }
    }
  }

  return TYPE_UNKNOWN;
}

/**
 * Resolves the return type of a function called by name `funcNameNode`.
 */
export function resolveFunctionReturnType(db: CodeGraph, funcNameNode: u32, $: Record<string, u16>): u16 {
  const docRoot = db.ast.getRootNode();
  if (docRoot == 0) return TYPE_UNKNOWN;

  let funcName = funcNameNode;
  if (db.ast.getType(funcNameNode) != $.identifier) {
    for (const id of db.ast.getDescendants(funcNameNode, $.identifier)) {
      funcName = id;
      break;
    }
  }

  for (const spec of db.ast.getDescendants(docRoot, $.long_class_specifier)) {
    const cName = db.ast.getChildByFieldId(spec, "name");
    if (cName != 0 && db.ast.textEqualsNode(funcName, cName)) {
      let funcClass: u32 = spec;
      for (const anc of db.ast.getAncestors(spec, 0)) {
        if (db.ast.getType(anc) == $.class_definition) {
          funcClass = anc;
          break;
        }
      }
      if (!isClassKind(db, funcClass, "function")) continue;

      // Find output component_clause
      for (const comp of db.ast.getDescendants(funcClass, $.component_clause)) {
        if (isDescendantOfInnerClass(db, comp, funcClass, $)) continue;
        if (hasTypePrefix(db, comp, "output")) {
          for (const ts of db.ast.getDescendants(comp, $.type_specifier)) {
            for (const id of db.ast.getDescendants(ts, $.identifier)) {
              const baseType = resolveBasePrimitiveType(db, id, $);
              if (baseType != TYPE_UNKNOWN) return baseType;
            }
          }
        }
      }
    }
  }

  return TYPE_UNKNOWN;
}

/**
 * Checks if a node inside a class/composition is declared in a protected section.
 */
export function isElementProtected(db: CodeGraph, node: u32, $: Record<string, u16>): boolean {
  if (node == 0) return false;
  let elList: u32 = 0;
  for (const anc of db.ast.getAncestors(node, 0)) {
    if ($.element_list != 0 && db.ast.getType(anc) == $.element_list) {
      elList = anc;
      break;
    }
  }
  if (elList == 0) return false;

  let comp: u32 = 0;
  for (const anc of db.ast.getAncestors(elList, 0)) {
    if ($.composition != 0 && db.ast.getType(anc) == $.composition) {
      comp = anc;
      break;
    }
  }
  if (comp == 0) return false;

  let ch = db.ast.getFirstChild(comp);
  let isProt = false;
  while (ch != 0) {
    if (ch == elList) {
      return isProt;
    }
    if (db.ast.textEquals(ch, "protected")) {
      isProt = true;
    } else if (db.ast.textEquals(ch, "public")) {
      isProt = false;
    }
    ch = db.ast.getNextSibling(ch);
  }

  return false;
}

/**
 * Checks whether an actual type is compatible with (or a subtype of) an expected type.
 */
export function isTypeCompatible(actualType: u16, expectedType: u16): boolean {
  if (actualType == expectedType) return true;
  // Integer coerces to Real
  if (actualType == TYPE_INTEGER && expectedType == TYPE_REAL) return true;
  // User-defined types (>= 0x8000) are incompatible with primitive scalar types (< 0x8000)
  if ((actualType >= 0x8000 && expectedType < 0x8000) || (expectedType >= 0x8000 && actualType < 0x8000)) {
    return false;
  }
  return false;
}

/**
 * Determines the variability of an expression.
 */
export function getExpressionVariability(db: CodeGraph, exprNode: u32, $: Record<string, u16>): u8 {
  if (exprNode == 0) return VARIABILITY_CONSTANT;

  // Check if expression directly references `time` -> Continuous
  for (const ident of db.ast.getDescendants(exprNode, 0xffff)) {
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
  if (db.ast.startsWith(clsNode, kind)) return true;
  let ch = db.ast.getFirstChild(clsNode);
  while (ch != 0) {
    if (db.ast.startsWith(ch, kind) || db.ast.textEquals(ch, kind)) return true;
    let sub = db.ast.getFirstChild(ch);
    while (sub != 0) {
      if (db.ast.startsWith(sub, kind) || db.ast.textEquals(sub, kind)) return true;
      let leaf = db.ast.getFirstChild(sub);
      while (leaf != 0) {
        if (db.ast.startsWith(leaf, kind) || db.ast.textEquals(leaf, kind)) return true;
        let leafSub = db.ast.getFirstChild(leaf);
        while (leafSub != 0) {
          if (db.ast.startsWith(leafSub, kind) || db.ast.textEquals(leafSub, kind)) return true;
          leafSub = db.ast.getNextSibling(leafSub);
        }
        leaf = db.ast.getNextSibling(leaf);
      }
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
    if (db.ast.startsWith(pfx, prefix) || db.ast.textEquals(pfx, prefix)) return true;
    let ch = db.ast.getFirstChild(pfx);
    while (ch != 0) {
      if (db.ast.startsWith(ch, prefix) || db.ast.textEquals(ch, prefix)) return true;
      ch = db.ast.getNextSibling(ch);
    }
  }
  return false;
}

/**
 * Resolves a single component identifier (e.g. `p1` inside `model X`) to its class definition in the document.
 */
export function resolveComponentClassDefinition(
  db: CodeGraph,
  enclosingClass: u32,
  compRefNode: u32,
  $: Record<string, u16>,
): u32 {
  if (enclosingClass == 0 || compRefNode == 0) return 0;
  const docRoot = db.ast.getRootNode();
  if (docRoot == 0) return 0;

  // 1. Direct declarations in enclosingClass (ignoring inner classes)
  let typeSpecNode: u32 = 0;
  for (const comp of db.ast.getDescendants(enclosingClass, $.component_clause)) {
    if (isDescendantOfInnerClass(db, comp, enclosingClass, $)) continue;
    let matchesComp = false;
    for (const decl of db.ast.getDescendants(comp, $.declaration)) {
      for (const id of db.ast.getDescendants(decl, $.identifier)) {
        if (db.ast.textEqualsNode(compRefNode, id)) {
          matchesComp = true;
          break;
        }
      }
      if (matchesComp) break;
    }
    if (matchesComp) {
      for (const ts of db.ast.getDescendants(comp, $.type_specifier)) {
        typeSpecNode = ts;
        break;
      }
      break;
    }
  }

  // 2. Inherited declarations in enclosingClass via extends_clause
  if (typeSpecNode == 0) {
    for (const ext of db.ast.getDescendants(enclosingClass, $.extends_clause)) {
      if (isDescendantOfInnerClass(db, ext, enclosingClass, $)) continue;
      let extTypeSpec = db.ast.getChildByFieldId(ext, "type_specifier");
      if (extTypeSpec == 0) extTypeSpec = db.ast.getFirstChild(ext);
      if (extTypeSpec == 0) continue;

      let baseNameId: u32 = extTypeSpec;
      for (const id of db.ast.getDescendants(extTypeSpec, $.identifier)) {
        baseNameId = id;
        break;
      }

      for (const spec of db.ast.getDescendants(docRoot, $.long_class_specifier)) {
        const nameId = db.ast.getChildByFieldId(spec, "name");
        if (nameId != 0 && db.ast.textEqualsNode(baseNameId, nameId)) {
          let baseClass: u32 = spec;
          for (const anc of db.ast.getAncestors(spec)) {
            if (db.ast.getType(anc) == $.class_definition) {
              baseClass = anc;
              break;
            }
          }
          const resolved = resolveComponentClassDefinition(db, baseClass, compRefNode, $);
          if (resolved != 0) return resolved;
          break;
        }
      }
    }
  }

  if (typeSpecNode == 0) return 0;

  // 3. Find class_definition in document matching typeSpecNode
  for (const spec of db.ast.getDescendants(docRoot, $.long_class_specifier)) {
    const nameId = db.ast.getChildByFieldId(spec, "name");
    if (nameId != 0) {
      for (const tsId of db.ast.getDescendants(typeSpecNode, $.identifier)) {
        if (db.ast.textEqualsNode(tsId, nameId)) {
          for (const cls of db.ast.getAncestors(spec)) {
            if (db.ast.getType(cls) == $.class_definition) return cls;
          }
        }
        break;
      }
    }
  }
  for (const spec of db.ast.getDescendants(docRoot, $.short_class_specifier)) {
    const nameId = db.ast.getChildByFieldId(spec, "name");
    if (nameId != 0) {
      for (const tsId of db.ast.getDescendants(typeSpecNode, $.identifier)) {
        if (db.ast.textEqualsNode(tsId, nameId)) {
          for (const cls of db.ast.getAncestors(spec)) {
            if (db.ast.getType(cls) == $.class_definition) return cls;
          }
        }
        break;
      }
    }
  }
  return 0;
}

/**
 * Checks if `node` is inside an array subscript within `limitNode`.
 */
export function isDescendantOfSubscript(db: CodeGraph, node: u32, limitNode: u32, $: Record<string, u16>): boolean {
  for (const anc of db.ast.getAncestors(node, 0)) {
    if (anc == limitNode) break;
    const ancType = db.ast.getType(anc);
    if (($.array_subscripts != 0 && ancType == $.array_subscripts) || ($.subscript != 0 && ancType == $.subscript)) {
      return true;
    }
  }
  return false;
}

/**
 * Resolves a potentially dotted component reference (e.g. `x.p1`) starting from `enclosingClass`
 * down to its leaf class definition (e.g. `Pin1`).
 */
export function resolveDottedComponentClass(
  db: CodeGraph,
  enclosingClass: u32,
  compRefNode: u32,
  $: Record<string, u16>,
): u32 {
  if (enclosingClass == 0 || compRefNode == 0) return 0;

  let currClass = enclosingClass;
  for (const id of db.ast.getDescendants(compRefNode, $.identifier)) {
    if (id != 0 && !isDescendantOfSubscript(db, id, compRefNode, $)) {
      const nextClass = resolveComponentClassDefinition(db, currClass, id, $);
      if (nextClass == 0) return 0;
      currClass = nextClass;
    }
  }

  return currClass != enclosingClass ? currClass : 0;
}

/**
 * Checks if a potentially dotted variable reference (e.g. `x` or `x.error` or `x.p1`)
 * is declared across the class hierarchy.
 */
export function isDottedVariableDeclared(
  db: CodeGraph,
  enclosingClass: u32,
  compRefNode: u32,
  $: Record<string, u16>,
): boolean {
  if (enclosingClass == 0 || compRefNode == 0) return false;

  let idCount: u32 = 0;
  for (const id of db.ast.getDescendants(compRefNode, $.identifier)) {
    if (id != 0 && !isDescendantOfSubscript(db, id, compRefNode, $)) idCount++;
  }
  if (idCount == 0) return isVariableDeclaredInClass(db, enclosingClass, compRefNode, $);

  if (idCount == 1) {
    for (const id of db.ast.getDescendants(compRefNode, $.identifier)) {
      if (id != 0 && !isDescendantOfSubscript(db, id, compRefNode, $)) {
        return isVariableDeclaredInClass(db, enclosingClass, id, $);
      }
    }
  }

  // Multi-segment reference (e.g. `x.error` or `x.p1.v`)
  let currClass = enclosingClass;
  let idx: u32 = 0;
  for (const id of db.ast.getDescendants(compRefNode, $.identifier)) {
    if (id != 0 && !isDescendantOfSubscript(db, id, compRefNode, $)) {
      if (idx == idCount - 1) {
        // Leaf segment: check declaration in currClass
        return isVariableDeclaredInClass(db, currClass, id, $);
      }
      const nextClass = resolveComponentClassDefinition(db, currClass, id, $);
      if (nextClass == 0) return false;
      currClass = nextClass;
      idx++;
    }
  }

  return true;
}

/**
 * Checks if two connector classes are compatible for a connect() equation.
 */
export function isConnectorCompatible(db: CodeGraph, lhsClass: u32, rhsClass: u32, $: Record<string, u16>): boolean {
  if (lhsClass == 0 || rhsClass == 0) return true;
  if (lhsClass == rhsClass) return true;

  // 1. Flow variable count must match
  const lhsFlows = getFlowVariableCount(db, lhsClass, $);
  const rhsFlows = getFlowVariableCount(db, rhsClass, $);
  if (lhsFlows != rhsFlows) return false;

  // 2. Non-flow variable count must match
  let lhsNonFlows: u32 = 0;
  for (const comp of db.ast.getDescendants(lhsClass, $.component_clause)) {
    if (isDescendantOfInnerClass(db, comp, lhsClass, $)) continue;
    if (!hasTypePrefix(db, comp, "flow")) {
      for (const decl of db.ast.getDescendants(comp, $.declaration)) {
        if (decl != 0) lhsNonFlows++;
      }
    }
  }
  let rhsNonFlows: u32 = 0;
  for (const comp of db.ast.getDescendants(rhsClass, $.component_clause)) {
    if (isDescendantOfInnerClass(db, comp, rhsClass, $)) continue;
    if (!hasTypePrefix(db, comp, "flow")) {
      for (const decl of db.ast.getDescendants(comp, $.declaration)) {
        if (decl != 0) rhsNonFlows++;
      }
    }
  }
  if (lhsNonFlows != rhsNonFlows) return false;

  return true;
}

/**
 * Counts the number of flow variables in a class/connector definition.
 */
export function getFlowVariableCount(db: CodeGraph, classDefNode: u32, $: Record<string, u16>): u32 {
  if (classDefNode == 0) return 0;
  let count: u32 = 0;
  for (const comp of db.ast.getDescendants(classDefNode, $.component_clause)) {
    if (isDescendantOfInnerClass(db, comp, classDefNode, $)) continue;
    if (hasTypePrefix(db, comp, "flow")) {
      for (const decl of db.ast.getDescendants(comp, $.declaration)) {
        if (decl != 0) count++;
      }
    }
  }
  return count;
}

/**
 * Fast lookup to check if an identifier matches any top-level class name in the document.
 */
export function isTopLevelClassName(db: CodeGraph, nameNode: u32, $: Record<string, u16>): boolean {
  const docRoot = db.ast.getRootNode();
  if (docRoot == 0) return false;
  let targetIdent: u32 = nameNode;
  for (const id of db.ast.getDescendants(nameNode, $.identifier)) {
    targetIdent = id;
    break;
  }
  for (const spec of db.ast.getDescendants(docRoot, $.long_class_specifier)) {
    const nameId = db.ast.getChildByFieldId(spec, "name");
    if (nameId != 0 && (db.ast.textEqualsNode(nameNode, nameId) || db.ast.textEqualsNode(targetIdent, nameId))) {
      return true;
    }
  }
  for (const spec of db.ast.getDescendants(docRoot, $.short_class_specifier)) {
    const nameId = db.ast.getChildByFieldId(spec, "name");
    if (nameId != 0 && (db.ast.textEqualsNode(nameNode, nameId) || db.ast.textEqualsNode(targetIdent, nameId))) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true if `target` is nested inside an inner class_definition child of `classNode`.
 */
export function isDescendantOfInnerClass(db: CodeGraph, target: u32, classNode: u32, $: Record<string, u16>): boolean {
  for (const anc of db.ast.getAncestors(target)) {
    if (anc == classNode) break;
    if (db.ast.getType(anc) == $.class_definition) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if a variable identifier `identNode` is declared in `classNode` or any of its inherited base classes via `extends`.
 */
export function isVariableDeclaredInClass(
  db: CodeGraph,
  classNode: u32,
  identNode: u32,
  $: Record<string, u16>,
): boolean {
  if (classNode == 0 || identNode == 0) return false;

  // 1. Direct declarations in classNode (ignoring nested classes)
  for (const decl of db.ast.getDescendants(classNode, $.declaration)) {
    if (isDescendantOfInnerClass(db, decl, classNode, $)) continue;
    let declId: u32 = 0;
    for (const id of db.ast.getDescendants(decl, $.identifier)) {
      declId = id;
      break;
    }
    if (declId != 0 && db.ast.textEqualsNode(identNode, declId)) {
      return true;
    }
  }

  // 2. Inherited declarations via `extends_clause`
  const docRoot = db.ast.getRootNode();
  if (docRoot == 0) return false;

  for (const ext of db.ast.getDescendants(classNode, $.extends_clause)) {
    let typeSpec = db.ast.getChildByFieldId(ext, "type_specifier");
    if (typeSpec == 0) typeSpec = db.ast.getFirstChild(ext);
    if (typeSpec == 0) continue;

    let baseNameId: u32 = typeSpec;
    for (const id of db.ast.getDescendants(typeSpec, $.identifier)) {
      baseNameId = id;
      break;
    }

    // Find class_definition for baseNameId
    for (const spec of db.ast.getDescendants(docRoot, $.long_class_specifier)) {
      const nameId = db.ast.getChildByFieldId(spec, "name");
      if (nameId != 0 && db.ast.textEqualsNode(baseNameId, nameId)) {
        let baseClass: u32 = spec;
        for (const anc of db.ast.getAncestors(spec)) {
          if (db.ast.getType(anc) == $.class_definition) {
            baseClass = anc;
            break;
          }
        }
        if (isVariableDeclaredInClass(db, baseClass, identNode, $)) {
          return true;
        }
        break;
      }
    }
    for (const spec of db.ast.getDescendants(docRoot, $.short_class_specifier)) {
      const nameId = db.ast.getChildByFieldId(spec, "name");
      if (nameId != 0 && db.ast.textEqualsNode(baseNameId, nameId)) {
        let baseClass: u32 = spec;
        for (const anc of db.ast.getAncestors(spec)) {
          if (db.ast.getType(anc) == $.class_definition) {
            baseClass = anc;
            break;
          }
        }
        if (isVariableDeclaredInClass(db, baseClass, identNode, $)) {
          return true;
        }
        break;
      }
    }
  }

  return false;
}

/**
 * Resolves the declared type of a potentially dotted variable reference (e.g. `x` or `x.y`)
 * across the class hierarchy.
 */
export function getDottedVariableType(
  db: CodeGraph,
  enclosingClass: u32,
  compRefNode: u32,
  $: Record<string, u16>,
): u16 {
  if (enclosingClass == 0 || compRefNode == 0) return TYPE_UNKNOWN;

  let idCount: u32 = 0;
  for (const id of db.ast.getDescendants(compRefNode, $.identifier)) {
    if (id != 0 && !isDescendantOfSubscript(db, id, compRefNode, $)) idCount++;
  }
  if (idCount == 0) return db.runQuery("resolveComponentTypeInClass", enclosingClass, compRefNode) as u16;

  if (idCount == 1) {
    for (const id of db.ast.getDescendants(compRefNode, $.identifier)) {
      if (id != 0 && !isDescendantOfSubscript(db, id, compRefNode, $)) {
        return db.runQuery("resolveComponentTypeInClass", enclosingClass, id) as u16;
      }
    }
  }

  // Multi-segment reference (e.g. `x.y` or `a.b.c`)
  let currClass = enclosingClass;
  let idx: u32 = 0;
  for (const id of db.ast.getDescendants(compRefNode, $.identifier)) {
    if (id != 0 && !isDescendantOfSubscript(db, id, compRefNode, $)) {
      if (idx == idCount - 1) {
        return db.runQuery("resolveComponentTypeInClass", currClass, id) as u16;
      }
      const nextClass = resolveComponentClassDefinition(db, currClass, id, $);
      if (nextClass == 0) return TYPE_UNKNOWN;
      currClass = nextClass;
      idx++;
    }
  }

  return TYPE_UNKNOWN;
}

/**
 * Resolves the declared type (e.g. TYPE_REAL, TYPE_INTEGER, TYPE_BOOLEAN, TYPE_STRING, TYPE_CLOCK, or User-Defined Type)
 * of a variable identifier `identNode` in `classNode` or its inherited base classes.
 */
export function getVariableTypeInClass(db: CodeGraph, classNode: u32, identNode: u32, $: Record<string, u16>): u16 {
  if (classNode == 0 || identNode == 0) return TYPE_UNKNOWN;

  let targetId = identNode;
  if (db.ast.getType(identNode) != $.identifier) {
    for (const id of db.ast.getDescendants(identNode, $.identifier)) {
      targetId = id;
      break;
    }
  }

  // 1. Direct declarations in classNode (ignoring nested classes)
  for (const decl of db.ast.getDescendants(classNode, $.declaration)) {
    if (isDescendantOfInnerClass(db, decl, classNode, $)) continue;
    let declId: u32 = 0;
    for (const id of db.ast.getDescendants(decl, $.identifier)) {
      declId = id;
      break;
    }
    if (declId == 0 && db.ast.getType(decl) == $.identifier) declId = decl;
    if (declId != 0 && db.ast.textEqualsNode(targetId, declId)) {
      // Find parent component_clause or component_clause1
      for (const anc of db.ast.getAncestors(decl)) {
        const ancType = db.ast.getType(anc);
        if (ancType == $.component_clause || ancType == $.component_clause1) {
          let tsNode: u32 = 0;
          for (const ts of db.ast.getDescendants(anc, $.type_specifier)) {
            tsNode = ts;
            break;
          }
          if (tsNode != 0) {
            for (const id of db.ast.getDescendants(tsNode, $.identifier)) {
              const baseType = resolveBasePrimitiveType(db, id, $);
              if (baseType != TYPE_UNKNOWN) return baseType;

              const span = db.ast.getTextSpan(id);
              const nameHash = (db.ast.hashSpan(span) & 0x7fff) as u16;
              return 0x8000 | (nameHash != 0 ? nameHash : 1);
            }
          }
          for (const id of db.ast.getDescendants(anc, $.identifier)) {
            const baseType = resolveBasePrimitiveType(db, id, $);
            if (baseType != TYPE_UNKNOWN) return baseType;
            break;
          }
          break;
        }
      }
    }
  }

  // 2. Inherited declarations via `extends_clause`
  const docRoot = db.ast.getRootNode();
  if (docRoot == 0) return TYPE_UNKNOWN;

  for (const ext of db.ast.getDescendants(classNode, $.extends_clause)) {
    let typeSpec = db.ast.getChildByFieldId(ext, "type_specifier");
    if (typeSpec == 0) typeSpec = db.ast.getFirstChild(ext);
    if (typeSpec == 0) continue;

    let baseNameId: u32 = typeSpec;
    for (const id of db.ast.getDescendants(typeSpec, $.identifier)) {
      baseNameId = id;
      break;
    }

    // Find class_definition for baseNameId
    for (const spec of db.ast.getDescendants(docRoot, $.long_class_specifier)) {
      const nameId = db.ast.getChildByFieldId(spec, "name");
      if (nameId != 0 && db.ast.textEqualsNode(baseNameId, nameId)) {
        let baseClass: u32 = spec;
        for (const anc of db.ast.getAncestors(spec)) {
          if (db.ast.getType(anc) == $.class_definition) {
            baseClass = anc;
            break;
          }
        }
        const inheritedType = getVariableTypeInClass(db, baseClass, identNode, $);
        if (inheritedType != TYPE_UNKNOWN) return inheritedType;
        break;
      }
    }
    for (const spec of db.ast.getDescendants(docRoot, $.short_class_specifier)) {
      const nameId = db.ast.getChildByFieldId(spec, "name");
      if (nameId != 0 && db.ast.textEqualsNode(baseNameId, nameId)) {
        let baseClass: u32 = spec;
        for (const anc of db.ast.getAncestors(spec)) {
          if (db.ast.getType(anc) == $.class_definition) {
            baseClass = anc;
            break;
          }
        }
        const inheritedType = getVariableTypeInClass(db, baseClass, identNode, $);
        if (inheritedType != TYPE_UNKNOWN) return inheritedType;
        break;
      }
    }
  }

  return TYPE_UNKNOWN;
}

/**
 * Resolves the declared or inferred SI unit for a component declaration or clause.
 */
export function getComponentUnit(db: CodeGraph, compNode: u32, $: Record<string, u16>): SIUnit | null {
  if (compNode == 0) return null;

  // 1. Check for explicit (unit = "...") in modification
  let hasUnit = false;
  for (const d of db.ast.getDescendants(compNode)) {
    if (db.ast.textEquals(d, "unit") || db.ast.startsWith(d, "unit")) {
      hasUnit = true;
      break;
    }
  }

  let matchedUnit: SIUnit | null = null;
  if (hasUnit) {
    for (const str of db.ast.getDescendants(compNode)) {
      if (
        db.ast.getType(str) == $.string_literal ||
        (db.ast.getFirstChild(str) == 0 && (db.ast.startsWith(str, '"') || db.ast.startsWith(str, "'")))
      ) {
        if (db.ast.textEquals(str, '"m"') || db.ast.textEquals(str, "'m'") || db.ast.textEquals(str, "m")) {
          matchedUnit = parseUnit("m");
          break;
        }
        if (db.ast.textEquals(str, '"kg"') || db.ast.textEquals(str, "'kg'") || db.ast.textEquals(str, "kg")) {
          matchedUnit = parseUnit("kg");
          break;
        }
        if (db.ast.textEquals(str, '"s"') || db.ast.textEquals(str, "'s'") || db.ast.textEquals(str, "s")) {
          matchedUnit = parseUnit("s");
          break;
        }
        if (db.ast.textEquals(str, '"A"') || db.ast.textEquals(str, "'A'") || db.ast.textEquals(str, "A")) {
          matchedUnit = parseUnit("A");
          break;
        }
        if (db.ast.textEquals(str, '"K"') || db.ast.textEquals(str, "'K'") || db.ast.textEquals(str, "K")) {
          matchedUnit = parseUnit("K");
          break;
        }
        if (db.ast.textEquals(str, '"V"') || db.ast.textEquals(str, "'V'") || db.ast.textEquals(str, "V")) {
          matchedUnit = parseUnit("V");
          break;
        }
        if (db.ast.textEquals(str, '"Ohm"') || db.ast.textEquals(str, "'Ohm'") || db.ast.textEquals(str, "Ohm")) {
          matchedUnit = parseUnit("Ohm");
          break;
        }
        if (db.ast.textEquals(str, '"F"') || db.ast.textEquals(str, "'F'") || db.ast.textEquals(str, "F")) {
          matchedUnit = parseUnit("F");
          break;
        }
        if (db.ast.textEquals(str, '"H"') || db.ast.textEquals(str, "'H'") || db.ast.textEquals(str, "H")) {
          matchedUnit = parseUnit("H");
          break;
        }
        if (db.ast.textEquals(str, '"N"') || db.ast.textEquals(str, "'N'") || db.ast.textEquals(str, "N")) {
          matchedUnit = parseUnit("N");
          break;
        }
        if (db.ast.textEquals(str, '"Pa"') || db.ast.textEquals(str, "'Pa'") || db.ast.textEquals(str, "Pa")) {
          matchedUnit = parseUnit("Pa");
          break;
        }
        if (db.ast.textEquals(str, '"J"') || db.ast.textEquals(str, "'J'") || db.ast.textEquals(str, "J")) {
          matchedUnit = parseUnit("J");
          break;
        }
        if (db.ast.textEquals(str, '"W"') || db.ast.textEquals(str, "'W'") || db.ast.textEquals(str, "W")) {
          matchedUnit = parseUnit("W");
          break;
        }
        if (db.ast.textEquals(str, '"Hz"') || db.ast.textEquals(str, "'Hz'") || db.ast.textEquals(str, "Hz")) {
          matchedUnit = parseUnit("Hz");
          break;
        }
        if (db.ast.textEquals(str, '"rad"') || db.ast.textEquals(str, "'rad'") || db.ast.textEquals(str, "rad")) {
          matchedUnit = parseUnit("rad");
          break;
        }
        if (db.ast.textEquals(str, '"rad/s"') || db.ast.textEquals(str, "'rad/s'") || db.ast.textEquals(str, "rad/s")) {
          matchedUnit = parseUnit("rad/s");
          break;
        }
        if (db.ast.textEquals(str, '"m/s"') || db.ast.textEquals(str, "'m/s'") || db.ast.textEquals(str, "m/s")) {
          matchedUnit = parseUnit("m/s");
          break;
        }
        if (db.ast.textEquals(str, '"m/s2"') || db.ast.textEquals(str, "'m/s2'") || db.ast.textEquals(str, "m/s2")) {
          matchedUnit = parseUnit("m/s2");
          break;
        }
        if (db.ast.textEquals(str, '"kg/m3"') || db.ast.textEquals(str, "'kg/m3'") || db.ast.textEquals(str, "kg/m3")) {
          matchedUnit = parseUnit("kg/m3");
          break;
        }
        if (
          db.ast.textEquals(str, '"J/(kg.K)"') ||
          db.ast.textEquals(str, "'J/(kg.K)'") ||
          db.ast.textEquals(str, "J/(kg.K)")
        ) {
          matchedUnit = parseUnit("J/(kg.K)");
          break;
        }
        if (
          db.ast.textEquals(str, '"W/(m.K)"') ||
          db.ast.textEquals(str, "'W/(m.K)'") ||
          db.ast.textEquals(str, "W/(m.K)")
        ) {
          matchedUnit = parseUnit("W/(m.K)");
          break;
        }
        if (db.ast.textEquals(str, '"1"') || db.ast.textEquals(str, "'1'") || db.ast.textEquals(str, "1")) {
          matchedUnit = parseUnit("1");
          break;
        }
      }
    }
  }
  if (matchedUnit != null) return matchedUnit;

  // 2. Check type specifier for SI standard types
  let typeSpec = 0;
  for (const ts of db.ast.getDescendants(compNode, $.type_specifier)) {
    typeSpec = ts;
    break;
  }
  if (typeSpec == 0) {
    for (const anc of db.ast.getAncestors(compNode)) {
      const ancType = db.ast.getType(anc);
      if (ancType == $.component_clause || ancType == $.component_clause1) {
        for (const ts of db.ast.getDescendants(anc, $.type_specifier)) {
          typeSpec = ts;
          break;
        }
        break;
      }
    }
  }

  if (typeSpec != 0) {
    for (const id of db.ast.getDescendants(typeSpec, $.identifier)) {
      if (db.ast.textEquals(id, "Voltage")) {
        matchedUnit = parseUnit("V");
        break;
      }
      if (db.ast.textEquals(id, "Current")) {
        matchedUnit = parseUnit("A");
        break;
      }
      if (db.ast.textEquals(id, "Resistance")) {
        matchedUnit = parseUnit("Ohm");
        break;
      }
      if (db.ast.textEquals(id, "Capacitance")) {
        matchedUnit = parseUnit("F");
        break;
      }
      if (db.ast.textEquals(id, "Inductance")) {
        matchedUnit = parseUnit("H");
        break;
      }
      if (db.ast.textEquals(id, "Time")) {
        matchedUnit = parseUnit("s");
        break;
      }
      if (db.ast.textEquals(id, "Length") || db.ast.textEquals(id, "Position")) {
        matchedUnit = parseUnit("m");
        break;
      }
      if (db.ast.textEquals(id, "Velocity")) {
        matchedUnit = parseUnit("m/s");
        break;
      }
      if (db.ast.textEquals(id, "Acceleration")) {
        matchedUnit = parseUnit("m/s2");
        break;
      }
      if (db.ast.textEquals(id, "Pressure")) {
        matchedUnit = parseUnit("Pa");
        break;
      }
      if (db.ast.textEquals(id, "Force")) {
        matchedUnit = parseUnit("N");
        break;
      }
      if (db.ast.textEquals(id, "Power")) {
        matchedUnit = parseUnit("W");
        break;
      }
      if (db.ast.textEquals(id, "Energy")) {
        matchedUnit = parseUnit("J");
        break;
      }
      if (db.ast.textEquals(id, "Temperature")) {
        matchedUnit = parseUnit("K");
        break;
      }
      if (db.ast.textEquals(id, "Mass")) {
        matchedUnit = parseUnit("kg");
        break;
      }
      if (db.ast.textEquals(id, "Angle")) {
        matchedUnit = parseUnit("rad");
        break;
      }
      if (db.ast.textEquals(id, "AngularVelocity")) {
        matchedUnit = parseUnit("rad/s");
        break;
      }
      if (db.ast.textEquals(id, "Frequency")) {
        matchedUnit = parseUnit("Hz");
        break;
      }
    }
  }
  if (matchedUnit != null) return matchedUnit;

  return null;
}

/**
 * Resolves the unit of a variable identifier in a class.
 */
export function getVariableUnitInClass(
  db: CodeGraph,
  classNode: u32,
  identNode: u32,
  $: Record<string, u16>,
): SIUnit | null {
  if (classNode == 0 || identNode == 0) return null;

  let targetId = identNode;
  if (db.ast.getType(identNode) != $.identifier) {
    for (const id of db.ast.getDescendants(identNode, $.identifier)) {
      targetId = id;
      break;
    }
  }

  // 1. Direct declarations in classNode
  let directUnit: SIUnit | null = null;
  for (const decl of db.ast.getDescendants(classNode, $.declaration)) {
    if (isDescendantOfInnerClass(db, decl, classNode, $)) continue;
    let declId = 0;
    for (const id of db.ast.getDescendants(decl, $.identifier)) {
      declId = id;
      break;
    }
    if (declId == 0 && db.ast.getType(decl) == $.identifier) declId = decl;
    if (declId != 0 && db.ast.textEqualsNode(targetId, declId)) {
      const u = getComponentUnit(db, decl, $);
      if (u != null) {
        directUnit = u;
        break;
      }
    }
  }
  if (directUnit != null) return directUnit;

  return null;
}

/**
 * Recursively infers the SI unit of an AST expression.
 */
export function inferExprUnit(db: CodeGraph, exprNode: u32, $: Record<string, u16>, classNode: u32 = 0): SIUnit | null {
  if (exprNode == 0) return null;
  const nodeType = db.ast.getType(exprNode);

  // 0. Unwrap expression wrappers if single child
  const firstChild = db.ast.getFirstChild(exprNode);
  if (firstChild != 0 && db.ast.getNextSibling(firstChild) == 0) {
    const unwrapped = inferExprUnit(db, firstChild, $, classNode);
    if (unwrapped != null) return unwrapped;
  }

  // 1. Numbers / Literals
  if (nodeType == $.unsigned_real || nodeType == $.unsigned_integer || nodeType == $.number) {
    return createDimensionless();
  }

  // 2. Component references / identifiers
  if (nodeType == $.component_reference || nodeType == $.identifier) {
    if (classNode != 0) {
      const u = getVariableUnitInClass(db, classNode, exprNode, $);
      if (u != null) return u;
    }
  }

  // 3. der(x) call
  if (
    nodeType == $.primary ||
    nodeType == $.function_call ||
    nodeType == $.call_expression ||
    db.ast.startsWith(exprNode, "der")
  ) {
    let isDer = false;
    for (const d of db.ast.getDescendants(exprNode)) {
      if (db.ast.textEquals(d, "der")) {
        isDer = true;
        break;
      }
    }
    if (isDer) {
      for (const arg of db.ast.getDescendants(exprNode, $.component_reference)) {
        const u = inferExprUnit(db, arg, $, classNode);
        if (u != null) {
          const sUnit = parseUnit("s");
          return sUnit ? unitDivide(u, sUnit) : u;
        }
      }
      for (const arg of db.ast.getDescendants(exprNode, $.expression)) {
        const u = inferExprUnit(db, arg, $, classNode);
        if (u != null) {
          const sUnit = parseUnit("s");
          return sUnit ? unitDivide(u, sUnit) : u;
        }
      }
    }
  }

  // 4. Binary Expressions (+, -, *, /, ^)
  const left = db.ast.getChildByFieldId(exprNode, "left");
  const right = db.ast.getChildByFieldId(exprNode, "right");
  if (left != 0 && right != 0) {
    const u1 = inferExprUnit(db, left, $, classNode);
    const u2 = inferExprUnit(db, right, $, classNode);

    let isMul = false;
    let isDiv = false;
    let isAddSub = false;
    for (const d of db.ast.getDescendants(exprNode, 0)) {
      if (db.ast.textEquals(d, "*") || db.ast.textEquals(d, ".*")) {
        isMul = true;
        break;
      }
      if (db.ast.textEquals(d, "/") || db.ast.textEquals(d, "./")) {
        isDiv = true;
        break;
      }
      if (
        db.ast.textEquals(d, "+") ||
        db.ast.textEquals(d, "-") ||
        db.ast.textEquals(d, ".+") ||
        db.ast.textEquals(d, ".-")
      ) {
        isAddSub = true;
        break;
      }
    }

    if (isMul) {
      if (u1 && u2) return unitMultiply(u1, u2);
      return u1 ? u1 : u2;
    }
    if (isDiv) {
      if (u1 && u2) return unitDivide(u1, u2);
      if (u1) return u1;
      if (u2) return unitPower(u2, -1);
    }
    if (isAddSub) {
      return u1 ? u1 : u2;
    }
  }

  const child1 = db.ast.getFirstChild(exprNode);
  if (child1 != 0) {
    let opNode = 0;
    let child2 = 0;
    let sib = db.ast.getNextSibling(child1);
    while (sib != 0) {
      if (opNode == 0) {
        if (
          db.ast.textEquals(sib, "+") ||
          db.ast.textEquals(sib, "-") ||
          db.ast.textEquals(sib, "*") ||
          db.ast.textEquals(sib, "/") ||
          db.ast.textEquals(sib, "^")
        ) {
          opNode = sib;
        }
      } else if (child2 == 0 && db.ast.getType(sib) != 0) {
        child2 = sib;
        break;
      }
      sib = db.ast.getNextSibling(sib);
    }

    if (child2 != 0 && opNode != 0) {
      const u1 = inferExprUnit(db, child1, $, classNode);
      const u2 = inferExprUnit(db, child2, $, classNode);

      if (db.ast.textEquals(opNode, "+") || db.ast.textEquals(opNode, "-")) {
        return u1 ? u1 : u2;
      }
      if (db.ast.textEquals(opNode, "*")) {
        if (u1 && u2) return unitMultiply(u1, u2);
        return u1 ? u1 : u2;
      }
      if (db.ast.textEquals(opNode, "/")) {
        if (u1 && u2) return unitDivide(u1, u2);
        if (u1) return u1;
        if (u2) return unitPower(u2, -1);
      }
    }
  }

  // 5. Unpack single-child wrappers
  const first = db.ast.getFirstChild(exprNode);
  if (first != 0 && db.ast.getNextSibling(first) == 0) {
    const unwrapped = inferExprUnit(db, first, $, classNode);
    if (unwrapped != null) return unwrapped;
  }

  // 6. Direct fallback for component reference within expression
  if (classNode != 0) {
    let crFound = 0;
    for (const cr of db.ast.getDescendants(exprNode, $.component_reference)) {
      crFound = cr;
      break;
    }
    if (crFound != 0) {
      let isOp = false;
      for (const op of db.ast.getDescendants(exprNode)) {
        if (
          db.ast.textEquals(op, "+") ||
          db.ast.textEquals(op, "-") ||
          db.ast.textEquals(op, "*") ||
          db.ast.textEquals(op, "/")
        ) {
          isOp = true;
          break;
        }
      }
      if (!isOp) {
        const u = getVariableUnitInClass(db, classNode, crFound, $);
        if (u != null) return u;
      }
    }
  }

  return null;
}
