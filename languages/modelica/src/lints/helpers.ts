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
 * Fast lookup for the composition node of a class_definition or specifier.
 * Avoids recursive getDescendants scans across thousands of equations.
 */
export function findComposition(db: CodeGraph, classNode: u32, $: Record<string, u16>): u32 {
  if (classNode == 0) return 0;
  if (db.ast.getType(classNode) == $.composition) return classNode;
  for (const comp of db.ast.getDescendants(classNode, $.composition)) {
    return comp;
  }
  return 0;
}

/**
 * Checks if a class definition contains any inner/nested class definitions.
 */
export function hasAnyInnerClass(db: CodeGraph, classNode: u32, $: Record<string, u16>): boolean {
  if (classNode == 0) return false;
  let cached = db.ast.getCachedHasInnerClass(classNode);
  if (cached >= 0) return cached == 1;

  const comp = findComposition(db, classNode, $);
  if (comp != 0) {
    let sec = db.ast.getFirstChild(comp);
    while (sec != 0) {
      const sType = db.ast.getType(sec);
      if (sType != $.equation_section && sType != $.algorithm_section) {
        for (const cDef of db.ast.getDescendants(sec, $.class_definition)) {
          if (cDef != classNode) {
            db.ast.setCachedHasInnerClass(classNode, true);
            return true;
          }
        }
      }
      sec = db.ast.getNextSibling(sec);
    }
    db.ast.setCachedHasInnerClass(classNode, false);
    return false;
  }
  for (const cDef of db.ast.getDescendants(classNode, $.class_definition)) {
    if (cDef != classNode) {
      db.ast.setCachedHasInnerClass(classNode, true);
      return true;
    }
  }
  db.ast.setCachedHasInnerClass(classNode, false);
  return false;
}

/**
 * Returns the enclosing class definition for a given AST node.
 * Fast-paths single-class files by inspecting the top-level stored_definition directly.
 */
export function getEnclosingClass(db: CodeGraph, node: u32, $: Record<string, u16>): u32 {
  let root = db.ast.getRootNode();
  if (root != 0) {
    let cached = db.ast.getCachedEnclosingClass(root);
    if (cached != 0) return cached;

    let count: u32 = 0;
    let singleClass: u32 = 0;
    for (const cDef of db.ast.getDescendants(root, $.class_definition)) {
      count++;
      singleClass = cDef;
      if (count > 1) break;
    }
    if (count == 1 && !hasAnyInnerClass(db, singleClass, $)) {
      db.ast.setCachedEnclosingClass(root, singleClass);
      return singleClass;
    }
  }

  for (const anc of db.ast.getAncestors(node, 0)) {
    if (db.ast.getType(anc) == $.class_definition) {
      return anc;
    }
  }
  return 0;
}

/**
 * Fast lookup for a declaration node matching targetId in classNode without scanning equations.
 */
export function findDeclInClass(db: CodeGraph, classNode: u32, targetId: u32, $: Record<string, u16>): u32 {
  if (classNode == 0 || targetId == 0) return 0;
  const comp = findComposition(db, classNode, $);
  if (comp != 0) {
    let sec = db.ast.getFirstChild(comp);
    while (sec != 0) {
      const sType = db.ast.getType(sec);
      if (sType != $.equation_section && sType != $.algorithm_section) {
        for (const decl of db.ast.getDescendants(sec, $.declaration)) {
          if (isDescendantOfInnerClass(db, decl, classNode, $)) continue;
          let declId: u32 = 0;
          for (const id of db.ast.getDescendants(decl, $.identifier)) {
            declId = id;
            break;
          }
          if (declId == 0 && db.ast.getType(decl) == $.identifier) declId = decl;
          if (declId != 0 && db.ast.textEqualsNode(targetId, declId)) {
            return decl;
          }
        }
      }
      sec = db.ast.getNextSibling(sec);
    }
    return 0;
  }
  for (const decl of db.ast.getDescendants(classNode, $.declaration)) {
    if (isDescendantOfInnerClass(db, decl, classNode, $)) continue;
    let declId: u32 = 0;
    for (const id of db.ast.getDescendants(decl, $.identifier)) {
      declId = id;
      break;
    }
    if (declId == 0 && db.ast.getType(decl) == $.identifier) declId = decl;
    if (declId != 0 && db.ast.textEqualsNode(targetId, declId)) {
      return decl;
    }
  }
  return 0;
}

/**
 * Fast lookup for an inner class definition matching targetId in classNode without scanning equations.
 */
export function findInnerClassInClass(db: CodeGraph, classNode: u32, targetId: u32, $: Record<string, u16>): u32 {
  if (classNode == 0 || targetId == 0) return 0;
  const comp = findComposition(db, classNode, $);
  if (comp != 0) {
    let sec = db.ast.getFirstChild(comp);
    while (sec != 0) {
      const sType = db.ast.getType(sec);
      if (sType != $.equation_section && sType != $.algorithm_section) {
        for (const cDef of db.ast.getDescendants(sec, $.class_definition)) {
          if (cDef == classNode) continue;
          let isNested = false;
          for (const anc of db.ast.getAncestors(cDef)) {
            if (anc == classNode) break;
            if (anc != cDef && db.ast.getType(anc) == $.class_definition) {
              isNested = true;
              break;
            }
          }
          if (isNested) continue;

          for (const spec of db.ast.getDescendants(cDef, $.long_class_specifier)) {
            const nameId = db.ast.getChildByFieldId(spec, "name");
            if (nameId != 0 && db.ast.textEqualsNode(targetId, nameId)) {
              return cDef;
            }
            break;
          }
          for (const spec of db.ast.getDescendants(cDef, $.short_class_specifier)) {
            const nameId = db.ast.getChildByFieldId(spec, "name");
            if (nameId != 0 && db.ast.textEqualsNode(targetId, nameId)) {
              return cDef;
            }
            break;
          }
        }
      }
      sec = db.ast.getNextSibling(sec);
    }
    return 0;
  }
  for (const cDef of db.ast.getDescendants(classNode, $.class_definition)) {
    if (cDef == classNode) continue;
    let isNested = false;
    for (const anc of db.ast.getAncestors(cDef)) {
      if (anc == classNode) break;
      if (anc != cDef && db.ast.getType(anc) == $.class_definition) {
        isNested = true;
        break;
      }
    }
    if (isNested) continue;

    for (const spec of db.ast.getDescendants(cDef, $.long_class_specifier)) {
      const nameId = db.ast.getChildByFieldId(spec, "name");
      if (nameId != 0 && db.ast.textEqualsNode(targetId, nameId)) {
        return cDef;
      }
      break;
    }
    for (const spec of db.ast.getDescendants(cDef, $.short_class_specifier)) {
      const nameId = db.ast.getChildByFieldId(spec, "name");
      if (nameId != 0 && db.ast.textEqualsNode(targetId, nameId)) {
        return cDef;
      }
      break;
    }
  }
  return 0;
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
  const firstChild = db.ast.getFirstChild(exprNode);
  if (firstChild == 0) {
    if (
      nodeType == 94 ||
      nodeType == 93 ||
      db.ast.textEquals(exprNode, "true") ||
      db.ast.textEquals(exprNode, "false")
    ) {
      return TYPE_BOOLEAN;
    }
    if (
      nodeType == 95 ||
      db.ast.textEquals(exprNode, "time") ||
      db.ast.textEquals(exprNode, "der") ||
      db.ast.startsWith(exprNode, "der(")
    ) {
      return TYPE_REAL;
    }
  }

  // 1. Unwrap transparent single-child nodes to inspect binary/unary operator trees
  let unwrapped = exprNode;
  while (unwrapped != 0) {
    const uType = db.ast.getType(unwrapped);
    if (
      uType == $.component_reference ||
      uType == $.identifier ||
      uType == $.unsigned_number ||
      uType == $.unsigned_real ||
      uType == $.unsigned_integer ||
      uType == $.string_literal
    ) {
      break;
    }
    const fc = db.ast.getFirstChild(unwrapped);
    if (fc != 0 && db.ast.getNextSibling(fc) == 0) {
      unwrapped = fc;
    } else {
      break;
    }
  }

  const unwrappedType = db.ast.getType(unwrapped);
  if (unwrappedType == $.unsigned_real) return TYPE_REAL;
  if (unwrappedType == $.unsigned_integer) return TYPE_INTEGER;
  if (unwrappedType == $.string_literal) return TYPE_STRING;
  if (unwrappedType == $.unsigned_number) {
    for (const r of db.ast.getDescendants(unwrapped, $.unsigned_real)) {
      if (r != 0) return TYPE_REAL;
    }
    return TYPE_INTEGER;
  }

  const c1 = db.ast.getFirstChild(unwrapped);
  if (c1 != 0) {
    const c2 = db.ast.getNextSibling(c1);
    if (c2 != 0) {
      const c3 = db.ast.getNextSibling(c2);
      if (c3 != 0) {
        let opType = db.ast.getType(c2);
        const opChild = db.ast.getFirstChild(c2);
        if (opChild != 0) {
          opType = db.ast.getType(opChild);
        }
        if (
          (opType >= 78 && opType <= 83) ||
          opType == 75 ||
          opType == 76 ||
          db.ast.textEquals(c2, "==") ||
          db.ast.textEquals(c2, "<>") ||
          db.ast.textEquals(c2, "<") ||
          db.ast.textEquals(c2, "<=") ||
          db.ast.textEquals(c2, ">") ||
          db.ast.textEquals(c2, ">=") ||
          db.ast.textEquals(c2, "and") ||
          db.ast.textEquals(c2, "or")
        ) {
          return TYPE_BOOLEAN;
        }
        if (
          opType == 84 ||
          opType == 85 ||
          db.ast.textEquals(c2, "+") ||
          db.ast.textEquals(c2, "-") ||
          db.ast.textEquals(c2, "*") ||
          db.ast.textEquals(c2, "/") ||
          db.ast.textEquals(c2, "^") ||
          db.ast.textEquals(c2, ".+") ||
          db.ast.textEquals(c2, ".-") ||
          db.ast.textEquals(c2, ".*") ||
          db.ast.textEquals(c2, "./")
        ) {
          const lType = inferExprType(db, c1, $);
          if (lType == TYPE_REAL) return TYPE_REAL;
          const rType = inferExprType(db, c3, $);
          if (rType == TYPE_REAL) return TYPE_REAL;
          if (lType == TYPE_INTEGER && rType == TYPE_INTEGER) return TYPE_INTEGER;
          if (lType != TYPE_UNKNOWN) return lType;
          if (rType != TYPE_UNKNOWN) return rType;
        }
      } else {
        let opType = db.ast.getType(c1);
        const opChild = db.ast.getFirstChild(c1);
        if (opChild != 0) {
          opType = db.ast.getType(opChild);
        }
        if (opType == 77 || db.ast.textEquals(c1, "not")) {
          return TYPE_BOOLEAN;
        }
        if (opType == 85 || opType == 84 || db.ast.textEquals(c1, "-") || db.ast.textEquals(c1, "+")) {
          return inferExprType(db, c2, $);
        }
      }
    }
  }

  // 1b. If node is an expression / primary wrapper, check for relational / logical / arithmetic operators via left/right fields
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
      let opSibling = db.ast.getNextSibling(leftChild);
      while (opSibling != 0 && opSibling != rightChild) {
        const sType = db.ast.getType(opSibling);
        if (
          (sType >= 78 && sType <= 83) ||
          sType == 75 ||
          sType == 76 ||
          db.ast.textEquals(opSibling, "==") ||
          db.ast.textEquals(opSibling, "<>") ||
          db.ast.textEquals(opSibling, "<") ||
          db.ast.textEquals(opSibling, "<=") ||
          db.ast.textEquals(opSibling, ">") ||
          db.ast.textEquals(opSibling, ">=") ||
          db.ast.textEquals(opSibling, "and") ||
          db.ast.textEquals(opSibling, "or")
        ) {
          return TYPE_BOOLEAN;
        }
        opSibling = db.ast.getNextSibling(opSibling);
      }
      const lType = inferExprType(db, leftChild, $);
      if (lType == TYPE_REAL) return TYPE_REAL;
      const rType = inferExprType(db, rightChild, $);
      if (rType == TYPE_REAL) return TYPE_REAL;
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
        if (db.ast.textEquals(cr, "der")) {
          return TYPE_REAL;
        }
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
    let resultType = TYPE_UNKNOWN;
    while (curr != 0) {
      if (checkNext) {
        const branchType = inferExprType(db, curr, $);
        if (branchType == TYPE_REAL) return TYPE_REAL;
        if (branchType != TYPE_UNKNOWN && resultType == TYPE_UNKNOWN) {
          resultType = branchType;
        }
        checkNext = false;
      }
      if (db.ast.textEquals(curr, "then") || db.ast.textEquals(curr, "else")) {
        checkNext = true;
      }
      curr = db.ast.getNextSibling(curr);
    }
    if (resultType != TYPE_UNKNOWN) return resultType;
  }

  // Find enclosing class definition for component reference resolution
  let enclosingClass: u32 = getEnclosingClass(db, exprNode, $);

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
      const resolvedType = getDottedVariableType(db, enclosingClass, compRef, $);
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

  let targetId: u32 = typeNameId;
  for (const id of db.ast.getDescendants(typeNameId, $.identifier)) {
    targetId = id;
  }

  if (db.ast.textEquals(targetId, "Real")) return TYPE_REAL;
  if (db.ast.textEquals(targetId, "Integer")) return TYPE_INTEGER;
  if (db.ast.textEquals(targetId, "Boolean")) return TYPE_BOOLEAN;
  if (db.ast.textEquals(targetId, "String")) return TYPE_STRING;
  if (db.ast.textEquals(targetId, "Clock")) return TYPE_CLOCK;
  if (db.ast.textEquals(targetId, "enumeration")) return TYPE_ENUM;

  const docRoot = db.ast.getRootNode();
  if (docRoot != 0) {
    if ($.short_class_specifier != 0) {
      for (const spec of db.ast.getDescendants(docRoot, $.short_class_specifier)) {
        let specName = db.ast.getChildByFieldId(spec, "name");
        if (specName == 0) {
          for (const id of db.ast.getDescendants(spec, $.identifier)) {
            specName = id;
            break;
          }
        }
        if (specName != 0 && db.ast.textEqualsNode(targetId, specName)) {
          if ($.enum_list != 0) {
            for (const _ of db.ast.getDescendants(spec, $.enum_list)) {
              return TYPE_ENUM;
            }
          }
          let ch = db.ast.getFirstChild(spec);
          while (ch != 0) {
            if (db.ast.textEquals(ch, "enumeration")) {
              return TYPE_ENUM;
            }
            ch = db.ast.getNextSibling(ch);
          }
          for (const ts of db.ast.getDescendants(spec, $.type_specifier)) {
            const resolved = resolveBasePrimitiveType(db, ts, $);
            if (resolved != TYPE_UNKNOWN) return resolved;
          }
        }
      }
    }
    if ($.long_class_specifier != 0 && $.extends_clause != 0) {
      for (const spec of db.ast.getDescendants(docRoot, $.long_class_specifier)) {
        let specName = db.ast.getChildByFieldId(spec, "name");
        if (specName == 0) {
          for (const id of db.ast.getDescendants(spec, $.identifier)) {
            specName = id;
            break;
          }
        }
        if (specName != 0 && db.ast.textEqualsNode(targetId, specName)) {
          for (const ext of db.ast.getDescendants(spec, $.extends_clause)) {
            for (const ts of db.ast.getDescendants(ext, $.type_specifier)) {
              const resolved = resolveBasePrimitiveType(db, ts, $);
              if (resolved != TYPE_UNKNOWN) return resolved;
            }
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
    }
  }

  for (const funcClass of db.ast.getDescendants(docRoot, $.class_definition)) {
    if (!isClassKind(db, funcClass, "function")) continue;

    let matched = false;
    for (const spec of db.ast.getDescendants(funcClass, $.long_class_specifier)) {
      let cName = db.ast.getChildByFieldId(spec, "name");
      if (cName == 0) {
        for (const id of db.ast.getDescendants(spec, $.identifier)) {
          cName = id;
          break;
        }
      }
      if (cName != 0 && db.ast.textEqualsNode(funcName, cName)) {
        matched = true;
        break;
      }
    }
    if (!matched) continue;

    // Find output component_clause
    for (const comp of db.ast.getDescendants(funcClass, $.component_clause)) {
      if (isDescendantOfInnerClass(db, comp, funcClass, $)) continue;
      if (hasTypePrefix(db, comp, "output", $)) {
        for (const ts of db.ast.getDescendants(comp, $.type_specifier)) {
          for (const id of db.ast.getDescendants(ts, $.identifier)) {
            const baseType = resolveBasePrimitiveType(db, id, $);
            if (baseType != TYPE_UNKNOWN) return baseType;
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
  let elListParent: u32 = 0;
  for (const anc of db.ast.getAncestors(node, 0)) {
    if (elList != 0) {
      elListParent = anc;
      break;
    }
    if ($.element_list != 0 && db.ast.getType(anc) == $.element_list) {
      elList = anc;
    }
  }
  if (elList == 0 || elListParent == 0) return false;

  const fc = db.ast.getFirstChild(elListParent);
  if (fc != 0) {
    const t = db.ast.getType(fc);
    if (t == 41 || ($.protected != 0 && t == $.protected) || db.ast.textEquals(fc, "protected")) {
      return true;
    }
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
export function hasTypePrefix(db: CodeGraph, compClauseNode: u32, prefix: string, $: Record<string, u16>): boolean {
  if (compClauseNode == 0) return false;
  for (const pfx of db.ast.getDescendants(compClauseNode, $.type_prefix)) {
    if (db.ast.textEquals(pfx, prefix) || db.ast.startsWith(pfx, prefix)) return true;
    for (const d of db.ast.getDescendants(pfx)) {
      if (db.ast.textEquals(d, prefix)) return true;
    }
  }
  let pfx = db.ast.getChildByFieldId(compClauseNode, "type_prefix");
  if (pfx == 0) pfx = db.ast.getChildByFieldId(compClauseNode, "typePrefix");
  if (pfx != 0) {
    if (db.ast.startsWith(pfx, prefix) || db.ast.textEquals(pfx, prefix)) return true;
    for (const d of db.ast.getDescendants(pfx)) {
      if (db.ast.textEquals(d, prefix)) return true;
    }
    let ch = db.ast.getFirstChild(pfx);
    while (ch != 0) {
      if (db.ast.startsWith(ch, prefix) || db.ast.textEquals(ch, prefix)) return true;
      ch = db.ast.getNextSibling(ch);
    }
  }
  return false;
}

export function isPrimitiveAttribute(db: CodeGraph, primType: u16, attrNameNode: u32): boolean {
  if (primType == TYPE_REAL) {
    return (
      db.ast.textEquals(attrNameNode, "start") ||
      db.ast.textEquals(attrNameNode, "fixed") ||
      db.ast.textEquals(attrNameNode, "min") ||
      db.ast.textEquals(attrNameNode, "max") ||
      db.ast.textEquals(attrNameNode, "nominal") ||
      db.ast.textEquals(attrNameNode, "unit") ||
      db.ast.textEquals(attrNameNode, "displayUnit") ||
      db.ast.textEquals(attrNameNode, "quantity") ||
      db.ast.textEquals(attrNameNode, "stateSelect") ||
      db.ast.textEquals(attrNameNode, "uncertain")
    );
  }
  if (primType == TYPE_INTEGER) {
    return (
      db.ast.textEquals(attrNameNode, "start") ||
      db.ast.textEquals(attrNameNode, "fixed") ||
      db.ast.textEquals(attrNameNode, "min") ||
      db.ast.textEquals(attrNameNode, "max") ||
      db.ast.textEquals(attrNameNode, "quantity")
    );
  }
  if (primType == TYPE_BOOLEAN) {
    return (
      db.ast.textEquals(attrNameNode, "start") ||
      db.ast.textEquals(attrNameNode, "fixed") ||
      db.ast.textEquals(attrNameNode, "quantity")
    );
  }
  if (primType == TYPE_STRING) {
    return db.ast.textEquals(attrNameNode, "start") || db.ast.textEquals(attrNameNode, "quantity");
  }
  if (primType == TYPE_ENUM) {
    return (
      db.ast.textEquals(attrNameNode, "start") ||
      db.ast.textEquals(attrNameNode, "fixed") ||
      db.ast.textEquals(attrNameNode, "min") ||
      db.ast.textEquals(attrNameNode, "max") ||
      db.ast.textEquals(attrNameNode, "quantity")
    );
  }
  return false;
}

export function findClassByName(db: CodeGraph, typeSpecNode: u32, $: Record<string, u16>): u32 {
  if (typeSpecNode == 0) return 0;
  const docRoot = db.ast.getRootNode();
  if (docRoot == 0) return 0;

  let leafId: u32 = typeSpecNode;
  for (const id of db.ast.getDescendants(typeSpecNode, $.identifier)) {
    leafId = id;
  }

  for (const spec of db.ast.getDescendants(docRoot, $.long_class_specifier)) {
    const nameId = db.ast.getChildByFieldId(spec, "name");
    if (nameId != 0 && db.ast.textEqualsNode(leafId, nameId)) {
      for (const cls of db.ast.getAncestors(spec)) {
        if (db.ast.getType(cls) == $.class_definition) return cls;
      }
    }
  }
  for (const spec of db.ast.getDescendants(docRoot, $.short_class_specifier)) {
    const nameId = db.ast.getChildByFieldId(spec, "name");
    if (nameId != 0 && db.ast.textEqualsNode(leafId, nameId)) {
      for (const cls of db.ast.getAncestors(spec)) {
        if (db.ast.getType(cls) == $.class_definition) return cls;
      }
    }
  }
  return 0;
}

export function findComponentTypeInClass(db: CodeGraph, classNode: u32, identNode: u32, $: Record<string, u16>): u32 {
  if (classNode == 0 || identNode == 0) return 0;

  // 1. Direct component declarations
  const decl = findDeclInClass(db, classNode, identNode, $);
  if (decl != 0) {
    let compClause: u32 = 0;
    for (const anc of db.ast.getAncestors(decl, 0)) {
      if (db.ast.getType(anc) == $.component_clause) {
        compClause = anc;
        break;
      }
    }
    if (compClause != 0) {
      for (const ts of db.ast.getDescendants(compClause, $.type_specifier)) {
        return ts;
      }
    }
  }

  // 2. Inherited component declarations via extends_clause
  const docRoot = db.ast.getRootNode();
  if (docRoot == 0) return 0;
  for (const ext of db.ast.getDescendants(classNode, $.extends_clause)) {
    if (isDescendantOfInnerClass(db, ext, classNode, $)) continue;

    // Check if identNode was broken
    let isBroken = false;
    for (const brk of db.ast.getDescendants(ext, $.inheritance_modification)) {
      for (const id of db.ast.getDescendants(brk, $.identifier)) {
        if (db.ast.textEqualsNode(identNode, id)) {
          isBroken = true;
          break;
        }
      }
      if (isBroken) break;
    }
    if (isBroken) continue;

    let typeSpec = db.ast.getChildByFieldId(ext, "type_specifier");
    if (typeSpec == 0) typeSpec = db.ast.getFirstChild(ext);
    if (typeSpec == 0) continue;

    let baseNameId: u32 = typeSpec;
    for (const id of db.ast.getDescendants(typeSpec, $.identifier)) {
      baseNameId = id;
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
        if (baseClass == 0 || baseClass == classNode) continue;
        const res = findComponentTypeInClass(db, baseClass, identNode, $);
        if (res != 0) return res;
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
        if (baseClass == 0 || baseClass == classNode) continue;
        const res = findComponentTypeInClass(db, baseClass, identNode, $);
        if (res != 0) return res;
        break;
      }
    }
  }

  return 0;
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

  // 1. Direct inner class definitions in enclosingClass
  for (const cDef of db.ast.getDescendants(enclosingClass, $.class_definition)) {
    if (cDef == enclosingClass) continue;
    let isNested = false;
    for (const anc of db.ast.getAncestors(cDef)) {
      if (anc == enclosingClass) break;
      if (anc != cDef && db.ast.getType(anc) == $.class_definition) {
        isNested = true;
        break;
      }
    }
    if (isNested) continue;

    for (const spec of db.ast.getDescendants(cDef, $.long_class_specifier)) {
      const nameId = db.ast.getChildByFieldId(spec, "name");
      if (nameId != 0 && db.ast.textEqualsNode(compRefNode, nameId)) {
        return cDef;
      }
      break;
    }
    for (const spec of db.ast.getDescendants(cDef, $.short_class_specifier)) {
      const nameId = db.ast.getChildByFieldId(spec, "name");
      if (nameId != 0 && db.ast.textEqualsNode(compRefNode, nameId)) {
        return cDef;
      }
      break;
    }
  }

  // 2. Direct or inherited component declarations in enclosingClass
  const compType = findComponentTypeInClass(db, enclosingClass, compRefNode, $);
  if (compType != 0) {
    return findClassByName(db, compType, $);
  }

  // 3. Inherited inner classes via extends_clause
  for (const ext of db.ast.getDescendants(enclosingClass, $.extends_clause)) {
    if (isDescendantOfInnerClass(db, ext, enclosingClass, $)) continue;
    let extTypeSpec = db.ast.getChildByFieldId(ext, "type_specifier");
    if (extTypeSpec == 0) extTypeSpec = db.ast.getFirstChild(ext);
    if (extTypeSpec == 0) continue;

    let baseClass = findClassByName(db, extTypeSpec, $);
    if (baseClass != 0) {
      const resolved = resolveComponentClassDefinition(db, baseClass, compRefNode, $);
      if (resolved != 0) return resolved;
    }
  }

  return 0;
}

/**
 * Checks if `node` is inside an array subscript within `limitNode`.
 */
export function isDescendantOfSubscript(db: CodeGraph, node: u32, limitNode: u32, $: Record<string, u16>): boolean {
  for (const anc of db.ast.getAncestors(node, 0, limitNode)) {
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

  let firstIdent: u32 = 0;
  let idCount: u32 = 0;
  for (const id of db.ast.getDescendants(compRefNode, $.identifier)) {
    if (firstIdent == 0) firstIdent = id;
    idCount++;
  }

  if (firstIdent == 0) {
    return isVariableDeclaredInClass(db, enclosingClass, compRefNode, $);
  }

  // Fast path 1: Exactly 1 identifier in the entire reference (e.g. T, T[1], alpha, dx)
  if (idCount <= 1) {
    return isVariableDeclaredInClass(db, enclosingClass, firstIdent, $);
  }

  // If multiple identifiers exist, count non-subscript identifiers (e.g. T[i] vs x.y)
  let nonSubscriptCount: u32 = 0;
  for (const id of db.ast.getDescendants(compRefNode, $.identifier)) {
    if (id != 0 && !isDescendantOfSubscript(db, id, compRefNode, $)) {
      nonSubscriptCount++;
    }
  }

  // If only 1 non-subscript identifier (e.g. T[i]), it's a single-segment reference!
  if (nonSubscriptCount <= 1) {
    return isVariableDeclaredInClass(db, enclosingClass, firstIdent, $);
  }

  // Multi-segment reference (e.g. `x.error` or `x.p1.v`)
  let currClass = enclosingClass;
  let idx: u32 = 0;
  for (const id of db.ast.getDescendants(compRefNode, $.identifier)) {
    if (id != 0 && !isDescendantOfSubscript(db, id, compRefNode, $)) {
      if (idx == nonSubscriptCount - 1) {
        return isVariableDeclaredInClass(db, currClass, id, $);
      }
      const nextClass = resolveComponentClassDefinition(db, currClass, id, $);
      if (nextClass == 0) return false;
      currClass = nextClass;
      idx++;
    }
  }

  return false;
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
    if (!hasTypePrefix(db, comp, "flow", $)) {
      for (const decl of db.ast.getDescendants(comp, $.declaration)) {
        if (decl != 0) lhsNonFlows++;
      }
    }
  }
  let rhsNonFlows: u32 = 0;
  for (const comp of db.ast.getDescendants(rhsClass, $.component_clause)) {
    if (isDescendantOfInnerClass(db, comp, rhsClass, $)) continue;
    if (!hasTypePrefix(db, comp, "flow", $)) {
      for (const decl of db.ast.getDescendants(comp, $.declaration)) {
        if (decl != 0) rhsNonFlows++;
      }
    }
  }
  if (lhsNonFlows != rhsNonFlows) return false;

  return true;
}

/**
 * Finds the component clause containing declaration of `identNode` in `classNode`.
 */
export function findComponentClauseForIdent(
  db: CodeGraph,
  classNode: u32,
  identNode: u32,
  $: Record<string, u16>,
): u32 {
  for (const comp of db.ast.getDescendants(classNode, $.component_clause)) {
    if (isDescendantOfInnerClass(db, comp, classNode, $)) continue;
    for (const decl of db.ast.getDescendants(comp, $.declaration)) {
      const nameNode = db.ast.getChildByFieldId(decl, "name");
      if (nameNode != 0 && db.ast.textEqualsNode(nameNode, identNode)) {
        return comp;
      }
    }
  }
  return 0;
}

/**
 * Checks if there is a flow / non-flow mismatch between two connector classes.
 * Returns the mismatched declaration identifier node if found, otherwise 0.
 */
export function findFlowMismatchInConnectors(db: CodeGraph, lhsClass: u32, rhsClass: u32, $: Record<string, u16>): u32 {
  if (lhsClass == 0 || rhsClass == 0) return 0;
  for (const comp of db.ast.getDescendants(lhsClass, $.component_clause)) {
    if (isDescendantOfInnerClass(db, comp, lhsClass, $)) continue;
    const isFlow = hasTypePrefix(db, comp, "flow", $);
    for (const decl of db.ast.getDescendants(comp, $.declaration)) {
      const nameNode = db.ast.getChildByFieldId(decl, "name");
      if (nameNode != 0) {
        const rhsComp = findComponentClauseForIdent(db, rhsClass, nameNode, $);
        if (rhsComp != 0) {
          const rhsFlow = hasTypePrefix(db, rhsComp, "flow", $);
          if (isFlow != rhsFlow) {
            return nameNode;
          }
        }
      }
    }
  }
  for (const comp of db.ast.getDescendants(rhsClass, $.component_clause)) {
    if (isDescendantOfInnerClass(db, comp, rhsClass, $)) continue;
    const isFlow = hasTypePrefix(db, comp, "flow", $);
    for (const decl of db.ast.getDescendants(comp, $.declaration)) {
      const nameNode = db.ast.getChildByFieldId(decl, "name");
      if (nameNode != 0) {
        const lhsComp = findComponentClauseForIdent(db, lhsClass, nameNode, $);
        if (lhsComp != 0) {
          const lhsFlow = hasTypePrefix(db, lhsComp, "flow", $);
          if (isFlow != lhsFlow) {
            return nameNode;
          }
        }
      }
    }
  }
  return 0;
}

/**
 * Checks if a potentially dotted variable reference is declared with 'stream' variability.
 */
export function isStreamVariable(db: CodeGraph, enclosingClass: u32, varRefNode: u32, $: Record<string, u16>): boolean {
  if (enclosingClass == 0 || varRefNode == 0) return false;
  let idCount: u32 = 0;
  for (const id of db.ast.getDescendants(varRefNode, $.identifier)) {
    if (id != 0 && !isDescendantOfSubscript(db, id, varRefNode, $)) idCount++;
  }
  let currClass = enclosingClass;
  let leafId: u32 = varRefNode;
  let idx: u32 = 0;
  for (const id of db.ast.getDescendants(varRefNode, $.identifier)) {
    if (id != 0 && !isDescendantOfSubscript(db, id, varRefNode, $)) {
      if (idx == idCount - 1) {
        leafId = id;
        break;
      }
      const nextClass = resolveComponentClassDefinition(db, currClass, id, $);
      if (nextClass == 0) return false;
      currClass = nextClass;
      idx++;
    }
  }

  for (const comp of db.ast.getDescendants(currClass, $.component_clause)) {
    if (isDescendantOfInnerClass(db, comp, currClass, $)) continue;
    for (const decl of db.ast.getDescendants(comp, $.declaration)) {
      const nameNode = db.ast.getChildByFieldId(decl, "name");
      if (nameNode != 0 && db.ast.textEqualsNode(nameNode, leafId)) {
        return hasTypePrefix(db, comp, "stream", $);
      }
    }
  }
  return false;
}

/**
 * Counts flow variables in `classDefNode` or its base classes.
 */
export function getFlowVariableCount(db: CodeGraph, classDefNode: u32, $: Record<string, u16>): u32 {
  let count: u32 = 0;
  for (const comp of db.ast.getDescendants(classDefNode, $.component_clause)) {
    if (isDescendantOfInnerClass(db, comp, classDefNode, $)) continue;
    if (hasTypePrefix(db, comp, "flow", $)) {
      for (const decl of db.ast.getDescendants(comp, $.declaration)) {
        if (decl != 0) count++;
      }
    }
  }

  // Check extends clauses
  const docRoot = db.ast.getRootNode();
  if (docRoot != 0) {
    for (const ext of db.ast.getDescendants(classDefNode, $.extends_clause)) {
      if (isDescendantOfInnerClass(db, ext, classDefNode, $)) continue;
      let typeSpec = db.ast.getChildByFieldId(ext, "type_specifier");
      if (typeSpec == 0) typeSpec = db.ast.getFirstChild(ext);
      if (typeSpec == 0) continue;

      let baseNameId: u32 = typeSpec;
      for (const id of db.ast.getDescendants(typeSpec, $.identifier)) {
        baseNameId = id;
        break;
      }

      for (const spec of db.ast.getDescendants(docRoot, $.long_class_specifier)) {
        const nameId = db.ast.getChildByFieldId(spec, "name");
        if (nameId != 0 && db.ast.textEqualsNode(baseNameId, nameId)) {
          for (const cls of db.ast.getAncestors(spec)) {
            if (db.ast.getType(cls) == $.class_definition) {
              count += getFlowVariableCount(db, cls, $);
              break;
            }
          }
          break;
        }
      }
    }
  }

  return count;
}

/**
 * Checks if `nameNode` matches a top-level class name declared in the document.
 */
export function isTopLevelClassName(db: CodeGraph, nameNode: u32, $: Record<string, u16>): boolean {
  const docRoot = db.ast.getRootNode();
  if (docRoot == 0) return false;

  let firstIdent: u32 = nameNode;
  for (const id of db.ast.getDescendants(nameNode, $.identifier)) {
    firstIdent = id;
    break;
  }
  let lastIdent: u32 = firstIdent;
  for (const id of db.ast.getDescendants(nameNode, $.identifier)) {
    lastIdent = id;
  }

  for (const spec of db.ast.getDescendants(docRoot, $.long_class_specifier)) {
    const cName = db.ast.getChildByFieldId(spec, "name");
    if (
      cName != 0 &&
      (db.ast.textEqualsNode(nameNode, cName) ||
        db.ast.textEqualsNode(firstIdent, cName) ||
        db.ast.textEqualsNode(lastIdent, cName))
    ) {
      return true;
    }
  }
  for (const spec of db.ast.getDescendants(docRoot, $.short_class_specifier)) {
    const cName = db.ast.getChildByFieldId(spec, "name");
    if (
      cName != 0 &&
      (db.ast.textEqualsNode(nameNode, cName) ||
        db.ast.textEqualsNode(firstIdent, cName) ||
        db.ast.textEqualsNode(lastIdent, cName))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true if `target` is nested inside an inner class_definition child of `classNode`.
 */
export function isDescendantOfInnerClass(db: CodeGraph, target: u32, classNode: u32, $: Record<string, u16>): boolean {
  if (classNode == 0 || !hasAnyInnerClass(db, classNode, $)) return false;
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
  // 1. Direct component declaration in classNode (fastest path for variables in equations)
  if (findDeclInClass(db, classNode, identNode, $) != 0) return true;
  // 2. Direct inner class definition in classNode
  if (findInnerClassInClass(db, classNode, identNode, $) != 0) return true;
  // 3. Inherited member or record component
  return getMemberKindInClass(db, classNode, identNode, $) != MEMBER_NONE;
}

export const MEMBER_NONE: u16 = 0;
export const MEMBER_COMPONENT: u16 = 1;
export const MEMBER_CLASS: u16 = 2;
export const MEMBER_RECORD_COMPONENT: u16 = 3;

/**
 * Returns member kind in classNode or its inherited base classes:
 * MEMBER_NONE (0), MEMBER_COMPONENT (1), MEMBER_CLASS (2), or MEMBER_RECORD_COMPONENT (3).
 */
export function getMemberKindInClass(db: CodeGraph, classNode: u32, identNode: u32, $: Record<string, u16>): u16 {
  if (classNode == 0 || identNode == 0) return MEMBER_NONE;

  // 1. Direct inner class definitions
  const innerClass = findInnerClassInClass(db, classNode, identNode, $);
  if (innerClass != 0) return MEMBER_CLASS;

  // 2. Direct component declarations
  const docRoot = db.ast.getRootNode();
  const decl = findDeclInClass(db, classNode, identNode, $);
  if (decl != 0) {
    // Check if it's a record component
    let compClause: u32 = 0;
    for (const anc of db.ast.getAncestors(decl, 0)) {
      if (db.ast.getType(anc) == $.component_clause) {
        compClause = anc;
        break;
      }
    }
    if (compClause != 0) {
      let typeSpec: u32 = 0;
      for (const ts of db.ast.getDescendants(compClause, $.type_specifier)) {
        typeSpec = ts;
        break;
      }
      if (typeSpec != 0 && docRoot != 0) {
        let typeIdent: u32 = typeSpec;
        for (const id of db.ast.getDescendants(typeSpec, $.identifier)) {
          typeIdent = id;
          break;
        }
        if (resolveBasePrimitiveType(db, typeIdent, $) != TYPE_UNKNOWN) {
          return MEMBER_RECORD_COMPONENT;
        }
        for (const cDef of db.ast.getDescendants(docRoot, $.class_definition)) {
          for (const spec of db.ast.getDescendants(cDef, $.long_class_specifier)) {
            const nameId = db.ast.getChildByFieldId(spec, "name");
            if (nameId != 0 && db.ast.textEqualsNode(typeIdent, nameId)) {
              if (
                !isClassKind(db, cDef, "model") &&
                !isClassKind(db, cDef, "block") &&
                !isClassKind(db, cDef, "connector")
              ) {
                return MEMBER_RECORD_COMPONENT;
              }
            }
          }
        }
      }
    }
    return MEMBER_COMPONENT;
  }

  // 3. Inherited members via extends_clause
  if (docRoot == 0) return MEMBER_NONE;

  const comp = findComposition(db, classNode, $);
  if (comp != 0) {
    let sec = db.ast.getFirstChild(comp);
    while (sec != 0) {
      const sType = db.ast.getType(sec);
      if (sType != $.equation_section && sType != $.algorithm_section) {
        for (const ext of db.ast.getDescendants(sec, $.extends_clause)) {
          if (isDescendantOfInnerClass(db, ext, classNode, $)) continue;

          let isBroken = false;
          for (const brk of db.ast.getDescendants(ext, $.inheritance_modification)) {
            for (const id of db.ast.getDescendants(brk, $.identifier)) {
              if (db.ast.textEqualsNode(identNode, id)) {
                isBroken = true;
                break;
              }
            }
            if (isBroken) break;
          }
          if (isBroken) continue;

          let typeSpec = db.ast.getChildByFieldId(ext, "type_specifier");
          if (typeSpec == 0) typeSpec = db.ast.getFirstChild(ext);
          if (typeSpec == 0) continue;

          let baseNameId: u32 = typeSpec;
          for (const id of db.ast.getDescendants(typeSpec, $.identifier)) {
            baseNameId = id;
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
              if (baseClass == 0 || baseClass == classNode) continue;
              const res = getMemberKindInClass(db, baseClass, identNode, $);
              if (res != MEMBER_NONE) return res;
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
              if (baseClass == 0 || baseClass == classNode) continue;
              const res = getMemberKindInClass(db, baseClass, identNode, $);
              if (res != MEMBER_NONE) return res;
              break;
            }
          }
        }
      }
      sec = db.ast.getNextSibling(sec);
    }
  } else {
    for (const ext of db.ast.getDescendants(classNode, $.extends_clause)) {
      if (isDescendantOfInnerClass(db, ext, classNode, $)) continue;

      let isBroken = false;
      for (const brk of db.ast.getDescendants(ext, $.inheritance_modification)) {
        for (const id of db.ast.getDescendants(brk, $.identifier)) {
          if (db.ast.textEqualsNode(identNode, id)) {
            isBroken = true;
            break;
          }
        }
        if (isBroken) break;
      }
      if (isBroken) continue;

      let typeSpec = db.ast.getChildByFieldId(ext, "type_specifier");
      if (typeSpec == 0) typeSpec = db.ast.getFirstChild(ext);
      if (typeSpec == 0) continue;

      let baseNameId: u32 = typeSpec;
      for (const id of db.ast.getDescendants(typeSpec, $.identifier)) {
        baseNameId = id;
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
          if (baseClass == 0 || baseClass == classNode) continue;
          const res = getMemberKindInClass(db, baseClass, identNode, $);
          if (res != MEMBER_NONE) return res;
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
          if (baseClass == 0 || baseClass == classNode) continue;
          const res = getMemberKindInClass(db, baseClass, identNode, $);
          if (res != MEMBER_NONE) return res;
          break;
        }
      }
    }
  }

  // 4. Inherited members via short_class_specifier on classNode itself
  for (const spec of db.ast.getDescendants(classNode, $.short_class_specifier)) {
    if (isDescendantOfInnerClass(db, spec, classNode, $)) continue;
    let typeSpec = db.ast.getChildByFieldId(spec, "type_specifier");
    if (typeSpec == 0) {
      for (const ts of db.ast.getDescendants(spec, $.type_specifier)) {
        typeSpec = ts;
        break;
      }
    }
    if (typeSpec == 0) continue;

    let baseNameId: u32 = typeSpec;
    for (const id of db.ast.getDescendants(typeSpec, $.identifier)) {
      baseNameId = id;
    }

    for (const lspec of db.ast.getDescendants(docRoot, $.long_class_specifier)) {
      const nameId = db.ast.getChildByFieldId(lspec, "name");
      if (nameId != 0 && db.ast.textEqualsNode(baseNameId, nameId)) {
        let baseClass: u32 = lspec;
        for (const anc of db.ast.getAncestors(lspec)) {
          if (db.ast.getType(anc) == $.class_definition) {
            baseClass = anc;
            break;
          }
        }
        if (baseClass == 0 || baseClass == classNode) continue;
        const res = getMemberKindInClass(db, baseClass, identNode, $);
        if (res != MEMBER_NONE) return res;
        break;
      }
    }
    for (const sspec of db.ast.getDescendants(docRoot, $.short_class_specifier)) {
      const nameId = db.ast.getChildByFieldId(sspec, "name");
      if (nameId != 0 && db.ast.textEqualsNode(baseNameId, nameId)) {
        let baseClass: u32 = sspec;
        for (const anc of db.ast.getAncestors(sspec)) {
          if (db.ast.getType(anc) == $.class_definition) {
            baseClass = anc;
            break;
          }
        }
        if (baseClass == 0 || baseClass == classNode) continue;
        const res = getMemberKindInClass(db, baseClass, identNode, $);
        if (res != MEMBER_NONE) return res;
        break;
      }
    }
  }

  return MEMBER_NONE;
}

/**
 * Checks whether a matching connect(ep1, ep2) exists in classNode or its inherited hierarchy.
 */
export function hasMatchingConnectEquation(
  db: CodeGraph,
  classNode: u32,
  ep1: u32,
  ep2: u32,
  $: Record<string, u16>,
): boolean {
  if (classNode == 0 || ep1 == 0 || ep2 == 0) return false;
  const docRoot = db.ast.getRootNode();

  for (const conn of db.ast.getDescendants(classNode, $.connect_equation)) {
    if (isDescendantOfInnerClass(db, conn, classNode, $)) continue;
    const lhs = db.ast.getChildByFieldId(conn, "lhs");
    const rhs = db.ast.getChildByFieldId(conn, "rhs");
    if (lhs != 0 && rhs != 0) {
      if (
        (db.ast.textEqualsNode(ep1, lhs) && db.ast.textEqualsNode(ep2, rhs)) ||
        (db.ast.textEqualsNode(ep1, rhs) && db.ast.textEqualsNode(ep2, lhs))
      ) {
        return true;
      }
    }
  }

  if (docRoot == 0) return false;
  for (const ext of db.ast.getDescendants(classNode, $.extends_clause)) {
    if (isDescendantOfInnerClass(db, ext, classNode, $)) continue;
    let typeSpec = db.ast.getChildByFieldId(ext, "type_specifier");
    if (typeSpec == 0) typeSpec = db.ast.getFirstChild(ext);
    if (typeSpec == 0) continue;

    let baseNameId: u32 = typeSpec;
    for (const id of db.ast.getDescendants(typeSpec, $.identifier)) {
      baseNameId = id;
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
        if (baseClass == 0 || baseClass == classNode) continue;
        if (hasMatchingConnectEquation(db, baseClass, ep1, ep2, $)) return true;
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

  let firstIdent: u32 = 0;
  let idCount: u32 = 0;
  for (const id of db.ast.getDescendants(compRefNode, $.identifier)) {
    if (firstIdent == 0) firstIdent = id;
    idCount++;
  }

  if (firstIdent == 0) {
    return getVariableTypeInClass(db, enclosingClass, compRefNode, $);
  }

  // Fast path 1: Exactly 1 identifier in the entire reference (e.g. T, T[1], alpha, dx)
  if (idCount <= 1) {
    return getVariableTypeInClass(db, enclosingClass, firstIdent, $);
  }

  // If multiple identifiers exist, count non-subscript identifiers (e.g. T[i] vs x.y)
  let nonSubscriptCount: u32 = 0;
  for (const id of db.ast.getDescendants(compRefNode, $.identifier)) {
    if (id != 0 && !isDescendantOfSubscript(db, id, compRefNode, $)) {
      nonSubscriptCount++;
    }
  }

  // If only 1 non-subscript identifier (e.g. T[i]), it's a single-segment reference!
  if (nonSubscriptCount <= 1) {
    return getVariableTypeInClass(db, enclosingClass, firstIdent, $);
  }

  // Multi-segment reference (e.g. `x.y` or `a.b.c`)
  let currClass = enclosingClass;
  let idx: u32 = 0;
  for (const id of db.ast.getDescendants(compRefNode, $.identifier)) {
    if (id != 0 && !isDescendantOfSubscript(db, id, compRefNode, $)) {
      if (idx == nonSubscriptCount - 1) {
        return getVariableTypeInClass(db, currClass, id, $);
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
  const docRoot = db.ast.getRootNode();
  if (docRoot == 0) return TYPE_UNKNOWN;

  let targetId = identNode;
  if (db.ast.getType(identNode) != $.identifier) {
    for (const id of db.ast.getDescendants(identNode, $.identifier)) {
      targetId = id;
      break;
    }
  }

  // 1. Direct declarations in classNode (ignoring nested classes)
  const decl = findDeclInClass(db, classNode, targetId, $);
  if (decl != 0) {
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
          let lastId: u32 = 0;
          for (const id of db.ast.getDescendants(tsNode, $.identifier)) {
            lastId = id;
          }
          if (lastId != 0) {
            const baseType = resolveBasePrimitiveType(db, lastId, $);
            if (baseType != TYPE_UNKNOWN) return baseType;

            for (const spec of db.ast.getDescendants(docRoot, $.short_class_specifier)) {
              const sName = db.ast.getChildByFieldId(spec, "name");
              if (sName != 0 && db.ast.textEqualsNode(lastId, sName)) {
                for (const ts of db.ast.getDescendants(spec, $.type_specifier)) {
                  for (const tid of db.ast.getDescendants(ts, $.identifier)) {
                    const aliasBase = resolveBasePrimitiveType(db, tid, $);
                    if (aliasBase != TYPE_UNKNOWN) return aliasBase;
                  }
                }
              }
            }

            const span = db.ast.getTextSpan(lastId);
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

  // 2. Inherited declarations via `extends_clause`
  const comp = findComposition(db, classNode, $);
  if (comp != 0) {
    let sec = db.ast.getFirstChild(comp);
    while (sec != 0) {
      const sType = db.ast.getType(sec);
      if (sType != $.equation_section && sType != $.algorithm_section) {
        for (const ext of db.ast.getDescendants(sec, $.extends_clause)) {
          if (isDescendantOfInnerClass(db, ext, classNode, $)) continue;

          let typeSpec = db.ast.getChildByFieldId(ext, "type_specifier");
          if (typeSpec == 0) typeSpec = db.ast.getFirstChild(ext);
          if (typeSpec == 0) continue;

          let baseNameId: u32 = typeSpec;
          for (const id of db.ast.getDescendants(typeSpec, $.identifier)) {
            baseNameId = id;
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
              if (baseClass == 0 || baseClass == classNode) continue;
              const inheritedType = getVariableTypeInClass(db, baseClass, targetId, $);
              if (inheritedType != TYPE_UNKNOWN) return inheritedType;
              break;
            }
          }
        }
      }
      sec = db.ast.getNextSibling(sec);
    }
    return TYPE_UNKNOWN;
  } else {
    for (const ext of db.ast.getDescendants(classNode, $.extends_clause)) {
      if (isDescendantOfInnerClass(db, ext, classNode, $)) continue;

      let typeSpec = db.ast.getChildByFieldId(ext, "type_specifier");
      if (typeSpec == 0) typeSpec = db.ast.getFirstChild(ext);
      if (typeSpec == 0) continue;

      let baseNameId: u32 = typeSpec;
      for (const id of db.ast.getDescendants(typeSpec, $.identifier)) {
        baseNameId = id;
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
          if (baseClass == 0 || baseClass == classNode) continue;
          const inheritedType = getVariableTypeInClass(db, baseClass, targetId, $);
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
          if (baseClass == 0 || baseClass == classNode) continue;
          const inheritedType = getVariableTypeInClass(db, baseClass, targetId, $);
          if (inheritedType != TYPE_UNKNOWN) return inheritedType;
          break;
        }
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
  const decl = findDeclInClass(db, classNode, targetId, $);
  if (decl != 0) {
    return getComponentUnit(db, decl, $);
  }

  return null;
}

/**
 * Fast check if a class contains any unit modifications or SI-typed declarations.
 */
export function hasUnitInClass(db: CodeGraph, classNode: u32, $: Record<string, u16>): boolean {
  if (classNode == 0) return false;
  let cached = db.ast.getCachedHasUnits(classNode);
  if (cached >= 0) return cached == 1;

  const comp = findComposition(db, classNode, $);
  if (comp != 0) {
    let sec = db.ast.getFirstChild(comp);
    while (sec != 0) {
      const sType = db.ast.getType(sec);
      if (sType != $.equation_section && sType != $.algorithm_section) {
        for (const decl of db.ast.getDescendants(sec, $.declaration)) {
          if (isDescendantOfInnerClass(db, decl, classNode, $)) continue;
          if (getComponentUnit(db, decl, $) != null) {
            db.ast.setCachedHasUnits(classNode, true);
            return true;
          }
        }
      }
      sec = db.ast.getNextSibling(sec);
    }
    db.ast.setCachedHasUnits(classNode, false);
    return false;
  }
  for (const decl of db.ast.getDescendants(classNode, $.declaration)) {
    if (isDescendantOfInnerClass(db, decl, classNode, $)) continue;
    if (getComponentUnit(db, decl, $) != null) {
      db.ast.setCachedHasUnits(classNode, true);
      return true;
    }
  }
  db.ast.setCachedHasUnits(classNode, false);
  return false;
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
    let first = db.ast.getFirstChild(exprNode);
    if (first != 0 && (db.ast.textEquals(first, "der") || db.ast.startsWith(first, "der"))) {
      isDer = true;
    } else {
      for (const d of db.ast.getDescendants(exprNode)) {
        if (db.ast.textEquals(d, "der")) {
          isDer = true;
          break;
        }
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
    let op = db.ast.getNextSibling(left);
    if (op != 0) {
      if (db.ast.textEquals(op, "*") || db.ast.textEquals(op, ".*")) {
        isMul = true;
      } else if (db.ast.textEquals(op, "/") || db.ast.textEquals(op, "./")) {
        isDiv = true;
      } else if (
        db.ast.textEquals(op, "+") ||
        db.ast.textEquals(op, "-") ||
        db.ast.textEquals(op, ".+") ||
        db.ast.textEquals(op, ".-")
      ) {
        isAddSub = true;
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
