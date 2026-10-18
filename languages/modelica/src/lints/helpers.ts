// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @module lints/helpers
 *
 * Shared linear-memory CST traversal, symbol resolution, type inference,
 * variability checking, and SI unit propagation helpers used across the
 * Modelica linter suites.
 */

import type { CodeGraph, u16, u32, u8 } from "@modelscript/dsl";
import type { SIUnit } from "../units.js";
import { createDimensionless, parseUnit, unitDivide, unitMultiply, unitPower } from "../units.js";

/** Sentinel type tag indicating an unresolved or unknown expression/variable type. */
export const TYPE_UNKNOWN: u16 = 0xffff;
/** Built-in primitive `Real` scalar type tag. */
export const TYPE_REAL: u16 = 0;
/** Built-in primitive `Integer` scalar type tag. */
export const TYPE_INTEGER: u16 = 1;
/** Built-in primitive `Boolean` scalar type tag. */
export const TYPE_BOOLEAN: u16 = 2;
/** Built-in primitive `String` scalar type tag. */
export const TYPE_STRING: u16 = 3;
/** Built-in `enumeration(...)` scalar type tag. */
export const TYPE_ENUM: u16 = 4;
/** Synchronous `Clock` type tag (MLS Chapter 16). */
export const TYPE_CLOCK: u16 = 5;

/** Continuous-time variability level (default for `Real` variables). */
export const VARIABILITY_CONTINUOUS: u8 = 0;
/** Discrete-time variability level (`discrete` prefix or clocked/when-assigned). */
export const VARIABILITY_DISCRETE: u8 = 1;
/** Parameter variability level (`parameter` prefix, constant during simulation). */
export const VARIABILITY_PARAMETER: u8 = 2;
/** Constant variability level (`constant` prefix or literal expression). */
export const VARIABILITY_CONSTANT: u8 = 3;

/**
 * Resolves a complex dot-separated name (e.g. `a.b.c` or single identifier `x`)
 * to a target symbol or AST declaration pointer.
 */
export function resolveComplexName(db: CodeGraph, nameNode: u32, $: any): u32 {
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
export function findComposition(db: CodeGraph, classNode: u32, $: any): u32 {
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
export function hasAnyInnerClass(db: CodeGraph, classNode: u32, $: any): boolean {
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
export function getEnclosingClass(db: CodeGraph, node: u32, $: any): u32 {
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
export function findDeclInClass(db: CodeGraph, classNode: u32, targetId: u32, $: any): u32 {
  if (classNode == 0 || targetId == 0) return 0;
  const memoKind: u32 = classNode ^ 0x33330000;
  const span = db.ast.getTextSpan(targetId);
  const cached = db.ast.getCachedByName(memoKind, span);
  if (cached >= 0) return cached as u32;
  const res = findDeclInClassInternal(db, classNode, targetId, $);
  db.ast.setCachedByName(memoKind, span, res);
  return res;
}

/**
 * Uncached implementation of {@link findDeclInClass} that scans component declarations
 * and enumeration literals directly inside `classNode` while skipping equation/algorithm sections.
 */
function findDeclInClassInternal(db: CodeGraph, classNode: u32, targetId: u32, $: any): u32 {
  const comp = findComposition(db, classNode, $);
  if (comp != 0) {
    let sec = db.ast.getFirstChild(comp);
    while (sec != 0) {
      const sType = db.ast.getType(sec);
      if (sType != $.equation_section && sType != $.algorithm_section) {
        for (const decl of db.ast.getDescendants(sec, $.declaration)) {
          let declId: u32 = 0;
          for (const id of db.ast.getDescendants(decl, $.identifier)) {
            declId = id;
            break;
          }
          if (declId == 0 && db.ast.getType(decl) == $.identifier) declId = decl;
          // Cheap name match first: isDescendantOfInnerClass walks from the tree root, so only run it on matches.
          if (declId != 0 && db.ast.textEqualsNode(targetId, declId)) {
            if (isDescendantOfInnerClass(db, decl, classNode, $)) continue;
            return decl;
          }
        }
      }
      sec = db.ast.getNextSibling(sec);
    }
    return 0;
  }
  for (const decl of db.ast.getDescendants(classNode, $.declaration)) {
    let declId: u32 = 0;
    for (const id of db.ast.getDescendants(decl, $.identifier)) {
      declId = id;
      break;
    }
    if (declId == 0 && db.ast.getType(decl) == $.identifier) declId = decl;
    if (declId != 0 && db.ast.textEqualsNode(targetId, declId)) {
      if (isDescendantOfInnerClass(db, decl, classNode, $)) continue;
      return decl;
    }
  }
  if ($.enumeration_literal != 0) {
    for (const enumLit of db.ast.getDescendants(classNode, $.enumeration_literal)) {
      let litId: u32 = 0;
      for (const id of db.ast.getDescendants(enumLit, $.identifier)) {
        litId = id;
        break;
      }
      if (litId == 0 && db.ast.getType(enumLit) == $.identifier) litId = enumLit;
      if (litId != 0 && db.ast.textEqualsNode(targetId, litId)) {
        if (isDescendantOfInnerClass(db, enumLit, classNode, $)) continue;
        return enumLit;
      }
    }
  }
  return 0;
}

/**
 * Fast lookup for an inner class definition matching targetId in classNode without scanning equations.
 */
export function findInnerClassInClass(db: CodeGraph, classNode: u32, targetId: u32, $: any): u32 {
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
 * Extracts the declared identifier node from an `element_redeclaration` or `element_replaceable` CST node.
 */
export function getRedeclName(db: CodeGraph, node: u32, $: any): u32 {
  if (node == 0) return 0;
  for (const decl of db.ast.getDescendants(node, $.declaration)) {
    for (const id of db.ast.getDescendants(decl, $.identifier)) {
      return id;
    }
  }
  for (const spec of db.ast.getDescendants(node, $.short_class_specifier)) {
    const n = db.ast.getChildByFieldId(spec, "name");
    if (n != 0) return n;
  }
  for (const spec of db.ast.getDescendants(node, $.long_class_specifier)) {
    const n = db.ast.getChildByFieldId(spec, "name");
    if (n != 0) return n;
  }
  return 0;
}

/**
 * Bounded recursive helper for {@link findTargetElementInClass} that searches direct
 * declarations, inner classes, `extends` redeclarations, and inherited base classes.
 */
function findTargetElementInClassRecursive(db: CodeGraph, targetClass: u32, redeclName: u32, $: any, depth: u32): u32 {
  if (targetClass == 0 || redeclName == 0 || depth > 20) return 0;

  // 1. Direct component declaration in targetClass (excluding declarations inside extends_clause modifications)
  for (const el of db.ast.getDescendants(targetClass, $.element)) {
    if (isDescendantOfInnerClass(db, el, targetClass, $)) continue;
    let isExtends = false;
    for (const _ext of db.ast.getDescendants(el, $.extends_clause)) {
      isExtends = true;
      break;
    }
    if (isExtends) continue;

    let declId: u32 = 0;
    for (const decl of db.ast.getDescendants(el, $.declaration)) {
      for (const id of db.ast.getDescendants(decl, $.identifier)) {
        declId = id;
        break;
      }
      break;
    }
    if (declId != 0 && db.ast.textEqualsNode(redeclName, declId)) {
      return el;
    }
  }

  // 2. Direct inner class definition in targetClass
  for (const cDef of db.ast.getDescendants(targetClass, $.class_definition)) {
    if (cDef == targetClass) continue;
    if (isDescendantOfInnerClass(db, cDef, targetClass, $)) continue;
    let nameId: u32 = 0;
    for (const spec of db.ast.getDescendants(cDef, $.long_class_specifier)) {
      const n = db.ast.getChildByFieldId(spec, "name");
      if (n != 0) {
        nameId = n;
        break;
      }
    }
    if (nameId == 0) {
      for (const spec of db.ast.getDescendants(cDef, $.short_class_specifier)) {
        const n = db.ast.getChildByFieldId(spec, "name");
        if (n != 0) {
          nameId = n;
          break;
        }
      }
    }
    if (nameId != 0 && db.ast.textEqualsNode(redeclName, nameId)) {
      return cDef;
    }
  }

  // 3. Redeclarations inside extends_clauses of targetClass
  const comp = findComposition(db, targetClass, $);
  const searchRoot = comp != 0 ? comp : targetClass;
  for (const ext of db.ast.getDescendants(searchRoot, $.extends_clause)) {
    if (isDescendantOfInnerClass(db, ext, targetClass, $)) continue;

    for (const repl of db.ast.getDescendants(ext, $.element_replaceable)) {
      const rName = getRedeclName(db, repl, $);
      if (rName != 0 && db.ast.textEqualsNode(redeclName, rName)) {
        return repl;
      }
    }
    for (const redecl of db.ast.getDescendants(ext, $.element_redeclaration)) {
      const rName = getRedeclName(db, redecl, $);
      if (rName != 0 && db.ast.textEqualsNode(redeclName, rName)) {
        return redecl;
      }
    }
  }

  // 4. Inherited from base classes
  for (const ext of db.ast.getDescendants(searchRoot, $.extends_clause)) {
    if (isDescendantOfInnerClass(db, ext, targetClass, $)) continue;
    for (const ts of db.ast.getDescendants(ext, $.type_specifier)) {
      const baseClass = findClassByName(db, ts, $);
      if (baseClass != 0) {
        const found = findTargetElementInClassRecursive(db, baseClass, redeclName, $, depth + 1);
        if (found != 0) return found;
      }
    }
  }

  return 0;
}

/**
 * Finds the original element or class definition targeted by a `redeclare` clause
 * within `targetClass` or its inherited base classes.
 */
export function findTargetElementInClass(db: CodeGraph, targetClass: u32, redeclName: u32, $: any): u32 {
  return findTargetElementInClassRecursive(db, targetClass, redeclName, $, 0);
}

/**
 * Recursively checks whether `classNode` or any of its inherited base classes
 * declares a component or inner class matching `targetId`.
 */
export function classContainsElementRecursive(
  db: CodeGraph,
  classNode: u32,
  targetId: u32,
  $: any,
  depth: u32 = 0,
): boolean {
  if (classNode == 0 || targetId == 0 || depth > 20) return false;
  if (findDeclInClass(db, classNode, targetId, $) != 0) return true;
  if (findInnerClassInClass(db, classNode, targetId, $) != 0) return true;
  const comp = findComposition(db, classNode, $);
  const searchRoot = comp != 0 ? comp : classNode;
  for (const ext of db.ast.getDescendants(searchRoot, $.extends_clause)) {
    if (isDescendantOfInnerClass(db, ext, classNode, $)) continue;
    for (const ts of db.ast.getDescendants(ext, $.type_specifier)) {
      const baseClass = findClassByName(db, ts, $);
      if (baseClass != 0 && classContainsElementRecursive(db, baseClass, targetId, $, depth + 1)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Returns `true` if `redecl` is a direct child modification of `node` without any
 * intervening nested modification or redeclaration scopes.
 */
export function isDirectModificationChild(db: CodeGraph, redecl: u32, node: u32, $: any): boolean {
  for (const anc of db.ast.getAncestors(redecl, 0)) {
    if (anc == node) break;
    if (anc == redecl) continue;
    const t = db.ast.getType(anc);
    if (
      t == $.element_modification ||
      t == $.class_modification ||
      t == $.class_or_inheritance_modification ||
      t == $.element_redeclaration ||
      t == $.element_replaceable
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Collects the direct argument expression CST nodes for a function call argument list `sib`.
 */
function getCallArguments(db: CodeGraph, sib: u32, $: any): u32[] {
  const args: u32[] = [];
  if (sib == 0) return args;
  for (const fa of db.ast.getDescendants(sib, $.function_argument)) {
    if (fa != 0) {
      let isDirect = true;
      for (const anc of db.ast.getAncestors(fa)) {
        if (anc == sib) break;
        if (db.ast.getType(anc) == $.function_call_args) {
          isDirect = false;
          break;
        }
      }
      if (isDirect) {
        const expr = db.ast.getFirstChild(fa);
        args.push(expr != 0 ? expr : fa);
      }
    }
  }
  return args;
}

/**
 * Infers the basic variable type of an AST expression node.
 */
export function inferExprType(db: CodeGraph, exprNode: u32, $: any): u16 {
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
    if (db.ast.textEquals(exprNode, "true") || db.ast.textEquals(exprNode, "false")) {
      return TYPE_BOOLEAN;
    }
    if (
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

  // 1a. If wrapped in parentheses `( expr )`, unwrap and infer the inner expression
  const c1 = db.ast.getFirstChild(unwrapped);
  if (c1 != 0) {
    if (db.ast.textEquals(c1, "(")) {
      const c2 = db.ast.getNextSibling(c1);
      if (c2 != 0) {
        let last = c2;
        let sib = db.ast.getNextSibling(c2);
        while (sib != 0) {
          last = sib;
          sib = db.ast.getNextSibling(sib);
        }
        if (db.ast.textEquals(last, ")")) {
          return inferExprType(db, c2, $);
        }
      }
    }

    // 1b. If node has an `operand` field (e.g. unary minus `-x` or `not b`)
    const operandChild = db.ast.getChildByFieldId(unwrapped, "operand");
    if (operandChild != 0) {
      const op = db.ast.getFirstChild(unwrapped);
      if (op != 0 && (db.ast.textEquals(op, "not") || db.ast.getType(op) == 77)) {
        const operandType = inferExprType(db, operandChild, $);
        if (operandType >= 0x8000) return operandType;
        return TYPE_BOOLEAN;
      }
      return inferExprType(db, operandChild, $);
    }

    const c2 = db.ast.getNextSibling(c1);
    if (c2 != 0) {
      const c3 = db.ast.getNextSibling(c2);
      if (c3 != 0) {
        if (
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
          const rType = inferExprType(db, c3, $);
          if (lType >= 0x8000) return lType;
          if (rType >= 0x8000) return rType;
          if (lType == TYPE_REAL || rType == TYPE_REAL) return TYPE_REAL;
          if (lType == TYPE_INTEGER && rType == TYPE_INTEGER) return TYPE_INTEGER;
          if (lType != TYPE_UNKNOWN) return lType;
          if (rType != TYPE_UNKNOWN) return rType;
        }
      } else {
        if (db.ast.textEquals(c1, "not")) {
          const operandType = inferExprType(db, c2, $);
          if (operandType >= 0x8000) return operandType;
          return TYPE_BOOLEAN;
        }
        if (db.ast.textEquals(c1, "-") || db.ast.textEquals(c1, "+")) {
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
        if (
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
      const rType = inferExprType(db, rightChild, $);
      if (lType >= 0x8000) return lType;
      if (rType >= 0x8000) return rType;
      if (lType == TYPE_REAL || rType == TYPE_REAL) return TYPE_REAL;
      if (lType == TYPE_INTEGER && rType == TYPE_INTEGER) return TYPE_INTEGER;
      if (lType != TYPE_UNKNOWN) return lType;
      if (rType != TYPE_UNKNOWN) return rType;
    }
  }

  // 1c. If expression: if ... then ... else ...
  const fcIf = db.ast.getFirstChild(unwrapped);
  const fcType = fcIf != 0 ? db.ast.getType(fcIf) : 0;
  if (
    fcType == 58 ||
    (fcIf != 0 && db.ast.textEquals(fcIf, "if")) ||
    db.ast.startsWith(unwrapped, "if") ||
    db.ast.textEquals(unwrapped, "if")
  ) {
    let curr = fcIf;
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
      const currType = db.ast.getType(curr);
      if (currType == 65 || currType == 67 || db.ast.textEquals(curr, "then") || db.ast.textEquals(curr, "else")) {
        checkNext = true;
      }
      curr = db.ast.getNextSibling(curr);
    }
    if (resultType != TYPE_UNKNOWN) return resultType;
  }

  // 2. Built-in functions & function calls (sample, sin, cos, pre, etc.)
  for (const cr of db.ast.getDescendants(exprNode, $.component_reference)) {
    if (cr != 0) {
      const sib = db.ast.getNextSibling(cr);
      if (sib != 0 && (db.ast.getType(sib) == $.function_call_args || db.ast.textEquals(sib, "("))) {
        if (
          db.ast.textEquals(cr, "der") ||
          db.ast.textEquals(cr, "zeros") ||
          db.ast.textEquals(cr, "ones") ||
          db.ast.textEquals(cr, "identity")
        ) {
          return TYPE_REAL;
        }
        if (db.ast.textEquals(cr, "fill")) {
          const args = getCallArguments(db, sib, $);
          if (args.length > 0) {
            const elemType = inferExprType(db, args[0]!, $);
            if (elemType !== TYPE_UNKNOWN) return elemType;
          }
          return TYPE_REAL;
        }
        if (db.ast.textEquals(cr, "initial") || db.ast.textEquals(cr, "terminal")) {
          return TYPE_BOOLEAN;
        }
        if (db.ast.textEquals(cr, "sample")) {
          const args = getCallArguments(db, sib, $);
          if (args.length === 1) {
            const uType = inferExprType(db, args[0]!, $);
            if (uType !== TYPE_UNKNOWN) return uType;
          } else if (args.length === 2) {
            const secType = inferExprType(db, args[1]!, $);
            let isClockArg = false;
            if (secType === TYPE_CLOCK) {
              isClockArg = true;
            } else if (secType === TYPE_REAL || secType === TYPE_INTEGER) {
              isClockArg = false;
            } else if (db.ast.startsWith(args[1]!, "Clock") || db.ast.startsWith(args[1]!, "clock")) {
              isClockArg = true;
            }
            if (isClockArg) {
              const uType = inferExprType(db, args[0]!, $);
              if (uType !== TYPE_UNKNOWN) return uType;
            } else {
              return TYPE_BOOLEAN;
            }
          }
          return TYPE_BOOLEAN;
        }
        if (
          db.ast.textEquals(cr, "backSample") ||
          db.ast.textEquals(cr, "subSample") ||
          db.ast.textEquals(cr, "superSample") ||
          db.ast.textEquals(cr, "shiftSample") ||
          db.ast.textEquals(cr, "hold") ||
          db.ast.textEquals(cr, "previous") ||
          db.ast.textEquals(cr, "noClock")
        ) {
          const args = getCallArguments(db, sib, $);
          if (args.length > 0) {
            const uType = inferExprType(db, args[0]!, $);
            if (uType !== TYPE_UNKNOWN) return uType;
          }
        }
        if (db.ast.textEquals(cr, "interval") || db.ast.textEquals(cr, "timeInState")) {
          return TYPE_REAL;
        }
        if (db.ast.textEquals(cr, "ticksInState")) {
          return TYPE_INTEGER;
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
        if (
          db.ast.textEquals(cr, "sum") ||
          db.ast.textEquals(cr, "product") ||
          db.ast.textEquals(cr, "min") ||
          db.ast.textEquals(cr, "max")
        ) {
          let fa = db.ast.getFirstChild(sib);
          while (fa != 0 && db.ast.textEquals(fa, "(")) {
            fa = db.ast.getNextSibling(fa);
          }
          if (fa != 0) {
            let targetExpr: u32 = fa;
            if (db.ast.getType(fa) == $.function_arguments) {
              const fChild = db.ast.getFirstChild(fa);
              if (fChild != 0) {
                targetExpr = fChild;
              }
            }
            if (targetExpr != 0 && db.ast.getType(targetExpr) == $.function_argument) {
              const faChild = db.ast.getFirstChild(targetExpr);
              if (faChild != 0) {
                targetExpr = faChild;
              }
            }
            if (targetExpr != 0) {
              const elemType = inferExprType(db, targetExpr, $);
              if (elemType != TYPE_UNKNOWN) {
                return elemType;
              }
            }
          }
          return TYPE_REAL;
        }
        const fnRet = resolveFunctionReturnType(db, cr, $);
        if (fnRet != TYPE_UNKNOWN) {
          return fnRet;
        }
      }
    }
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
      if ($.for_index != 0) {
        for (const anc of db.ast.getAncestors(compRef, 0)) {
          const ancType = db.ast.getType(anc);
          if (
            ($.for_equation != 0 && ancType == $.for_equation) ||
            ($.for_statement != 0 && ancType == $.for_statement) ||
            ($.function_arguments != 0 && ancType == $.function_arguments) ||
            ($.array_arguments != 0 && ancType == $.array_arguments)
          ) {
            for (const fi of db.ast.getDescendants(anc, $.for_index)) {
              for (const id of db.ast.getDescendants(fi, $.identifier)) {
                if (db.ast.textEqualsNode(id, compRef)) {
                  if ($.string_literal != 0) {
                    for (const sLit of db.ast.getDescendants(fi, $.string_literal)) {
                      if (sLit != 0) return TYPE_STRING;
                    }
                  }
                  return TYPE_INTEGER;
                }
                break;
              }
            }
          }
          if (ancType == $.class_definition || ancType == $.class_specifier) break;
        }
      }
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
export function resolveBasePrimitiveType(db: CodeGraph, typeNameId: u32, $: any): u16 {
  if (typeNameId == 0) return TYPE_UNKNOWN;
  const span = db.ast.getTextSpan(typeNameId);
  const cached = db.ast.getCachedByName(1, span);
  if (cached >= 0) return cached as u16;
  const res = resolveBasePrimitiveTypeInternal(db, typeNameId, $, 0);
  db.ast.setCachedByName(1, span, res as u32);
  return res;
}

/**
 * Uncached recursive implementation of {@link resolveBasePrimitiveType} that follows
 * `short_class_specifier` aliases, `enumeration` definitions, and `extends` clauses.
 */
function resolveBasePrimitiveTypeInternal(db: CodeGraph, typeNameId: u32, $: any, depth: u32): u16 {
  if (typeNameId == 0 || depth > 10) return TYPE_UNKNOWN;
  if (
    db.ast.startsWith(typeNameId, "Modelica.SIunits.") ||
    db.ast.startsWith(typeNameId, "SIunits.") ||
    db.ast.startsWith(typeNameId, "Modelica.Units.SI.") ||
    db.ast.startsWith(typeNameId, "SI.") ||
    db.ast.startsWith(typeNameId, "Modelica.Units.NonSI.") ||
    db.ast.startsWith(typeNameId, "NonSI.")
  ) {
    return TYPE_REAL;
  }
  let targetId: u32 = typeNameId;
  let idCount: u32 = 0;
  for (const id of db.ast.getDescendants(typeNameId, $.identifier)) {
    targetId = id;
    idCount = idCount + 1;
  }

  if (idCount <= 1) {
    if (db.ast.textEquals(targetId, "Real")) return TYPE_REAL;
    if (db.ast.textEquals(targetId, "Integer")) return TYPE_INTEGER;
    if (db.ast.textEquals(targetId, "Boolean")) return TYPE_BOOLEAN;
    if (db.ast.textEquals(targetId, "String")) return TYPE_STRING;
    if (db.ast.textEquals(targetId, "Clock")) return TYPE_CLOCK;
    if (db.ast.textEquals(targetId, "enumeration")) return TYPE_ENUM;
  }

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
          let cls: u32 = 0;
          for (const c of db.ast.getAncestors(spec)) {
            if (db.ast.getType(c) == $.class_definition) {
              cls = c;
              break;
            }
          }
          if (
            cls != 0 &&
            !isClassKind(db, cls, "type") &&
            !isClassKind(db, cls, "class") &&
            !isClassKind(db, cls, "connector")
          )
            continue;

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
            let tsId: u32 = ts;
            for (const id of db.ast.getDescendants(ts, $.identifier)) {
              tsId = id;
            }
            if (db.ast.textEqualsNode(targetId, tsId)) continue;
            const resolved = resolveBasePrimitiveTypeInternal(db, ts, $, depth + 1);
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
          let cls: u32 = 0;
          for (const c of db.ast.getAncestors(spec)) {
            if (db.ast.getType(c) == $.class_definition) {
              cls = c;
              break;
            }
          }
          if (
            cls != 0 &&
            !isClassKind(db, cls, "type") &&
            !isClassKind(db, cls, "class") &&
            !isClassKind(db, cls, "connector")
          )
            continue;

          for (const ext of db.ast.getDescendants(spec, $.extends_clause)) {
            for (const ts of db.ast.getDescendants(ext, $.type_specifier)) {
              let tsId: u32 = ts;
              for (const id of db.ast.getDescendants(ts, $.identifier)) {
                tsId = id;
              }
              if (db.ast.textEqualsNode(targetId, tsId)) continue;
              const resolved = resolveBasePrimitiveTypeInternal(db, ts, $, depth + 1);
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
export function resolveFunctionReturnType(db: CodeGraph, funcNameNode: u32, $: any): u16 {
  const docRoot = db.ast.getRootNode();
  if (docRoot == 0) return TYPE_UNKNOWN;

  let funcName = funcNameNode;
  if (db.ast.getType(funcNameNode) != $.identifier) {
    for (const id of db.ast.getDescendants(funcNameNode, $.identifier)) {
      funcName = id;
    }
  }

  for (const funcClass of db.ast.getDescendants(docRoot, $.class_definition)) {
    const isFunc = isClassKind(db, funcClass, "function");
    const isRec = isClassKind(db, funcClass, "record");
    if (!isFunc && !isRec) continue;

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

    if (isRec) {
      const span = db.ast.getTextSpan(funcName);
      const nameHash = (db.ast.hashSpan(span) & 0x7fff) as u16;
      return 0x8000 | (nameHash != 0 ? nameHash : 1);
    }

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
export function isElementProtected(db: CodeGraph, node: u32, $: any): boolean {
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
 * Checks if an element has the 'final' prefix.
 */
export function isElementFinal(db: CodeGraph, node: u32, $: any): boolean {
  if (node == 0) return false;
  if (db.ast.startsWith(node, "final")) return true;
  let ch = db.ast.getFirstChild(node);
  while (ch != 0) {
    if (db.ast.textEquals(ch, "final")) return true;
    ch = db.ast.getNextSibling(ch);
  }
  if ($.type_prefix) {
    for (const pfx of db.ast.getDescendants(node, $.type_prefix)) {
      if (db.ast.textEquals(pfx, "final") || db.ast.startsWith(pfx, "final")) return true;
      for (const d of db.ast.getDescendants(pfx)) {
        if (db.ast.textEquals(d, "final")) return true;
      }
    }
  }
  return false;
}

/**
 * Checks if an element is replaceable (either element_replaceable or has 'replaceable' prefix).
 */
export function isElementReplaceable(db: CodeGraph, node: u32, $: any): boolean {
  if (node == 0) return false;
  const t = db.ast.getType(node);
  if ($.element_replaceable != 0 && t == $.element_replaceable) return true;
  if (db.ast.startsWith(node, "replaceable")) return true;
  let ch = db.ast.getFirstChild(node);
  while (ch != 0) {
    if (db.ast.textEquals(ch, "replaceable")) return true;
    ch = db.ast.getNextSibling(ch);
  }
  if ($.element_replaceable != 0) {
    for (const repl of db.ast.getDescendants(node, $.element_replaceable)) {
      void repl;
      return true;
    }
  }
  for (const c of db.ast.getDescendants(node, 0xffff)) {
    if (db.ast.textEquals(c, "replaceable")) return true;
  }
  for (const anc of db.ast.getAncestors(node)) {
    if (anc == node) continue;
    const at = db.ast.getType(anc);
    if ($.element_replaceable != 0 && at == $.element_replaceable) return true;
    if (db.ast.startsWith(anc, "replaceable")) return true;
    let ach = db.ast.getFirstChild(anc);
    while (ach != 0) {
      if (db.ast.textEquals(ach, "replaceable")) return true;
      ach = db.ast.getNextSibling(ach);
    }
    if (at == $.composition || at == $.class_definition || at == $.root) break;
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
export function getExpressionVariability(db: CodeGraph, exprNode: u32, _$: any): u8 {
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
  if (kind == "record" && db.ast.startsWith(clsNode, "operator record")) return true;
  if (kind == "function" && db.ast.startsWith(clsNode, "operator function")) return true;
  let ch = db.ast.getFirstChild(clsNode);
  while (ch != 0) {
    if (
      db.ast.startsWith(ch, kind) ||
      db.ast.textEquals(ch, kind) ||
      (kind == "record" && (db.ast.startsWith(ch, "operator record") || db.ast.textEquals(ch, "operator record"))) ||
      (kind == "function" && (db.ast.startsWith(ch, "operator function") || db.ast.textEquals(ch, "operator function")))
    )
      return true;
    let sub = db.ast.getFirstChild(ch);
    while (sub != 0) {
      if (
        db.ast.startsWith(sub, kind) ||
        db.ast.textEquals(sub, kind) ||
        (kind == "record" &&
          (db.ast.startsWith(sub, "operator record") || db.ast.textEquals(sub, "operator record"))) ||
        (kind == "function" &&
          (db.ast.startsWith(sub, "operator function") || db.ast.textEquals(sub, "operator function")))
      )
        return true;
      let leaf = db.ast.getFirstChild(sub);
      while (leaf != 0) {
        if (
          db.ast.startsWith(leaf, kind) ||
          db.ast.textEquals(leaf, kind) ||
          (kind == "record" &&
            (db.ast.startsWith(leaf, "operator record") || db.ast.textEquals(leaf, "operator record"))) ||
          (kind == "function" &&
            (db.ast.startsWith(leaf, "operator function") || db.ast.textEquals(leaf, "operator function")))
        )
          return true;
        let leafSub = db.ast.getFirstChild(leaf);
        while (leafSub != 0) {
          if (
            db.ast.startsWith(leafSub, kind) ||
            db.ast.textEquals(leafSub, kind) ||
            (kind == "record" &&
              (db.ast.startsWith(leafSub, "operator record") || db.ast.textEquals(leafSub, "operator record"))) ||
            (kind == "function" &&
              (db.ast.startsWith(leafSub, "operator function") || db.ast.textEquals(leafSub, "operator function")))
          )
            return true;
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
export function hasTypePrefix(db: CodeGraph, compClauseNode: u32, prefix: string, $: any): boolean {
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

/**
 * Checks whether `attrNameNode` is a valid built-in attribute (per MLS §4.8) for the
 * given primitive scalar type `primType` (e.g., `start`, `fixed`, `min`, `max`, `unit`).
 */
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
      db.ast.textEquals(attrNameNode, "uncertain") ||
      db.ast.textEquals(attrNameNode, "unbounded")
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
    return (
      db.ast.textEquals(attrNameNode, "start") ||
      db.ast.textEquals(attrNameNode, "quantity") ||
      db.ast.textEquals(attrNameNode, "fixed")
    );
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

/**
 * Resolves a type specifier or identifier CST node to its matching `class_definition`
 * CST node in the current document (preferring top-level classes over nested classes).
 */
export function findClassByName(db: CodeGraph, typeSpecNode: u32, $: any): u32 {
  if (typeSpecNode == 0) return 0;
  const docRoot = db.ast.getRootNode();
  if (docRoot == 0) return 0;

  let prevId: u32 = 0;
  let leafId: u32 = typeSpecNode;
  for (const id of db.ast.getDescendants(typeSpecNode, $.identifier)) {
    if (leafId != typeSpecNode) {
      prevId = leafId;
    }
    leafId = id;
  }

  if (
    db.ast.textEquals(leafId, "Real") ||
    db.ast.textEquals(leafId, "Integer") ||
    db.ast.textEquals(leafId, "Boolean") ||
    db.ast.textEquals(leafId, "String")
  ) {
    return 0;
  }

  const fullSpan = db.ast.getTextSpan(typeSpecNode);
  const cachedCls = db.ast.getCachedByName(0, fullSpan);
  if (cachedCls >= 0) return cachedCls as u32;

  let result: u32 = 0;
  let fallbackNested: u32 = 0;
  for (const spec of db.ast.getDescendants(docRoot, $.long_class_specifier)) {
    const nameId = db.ast.getChildByFieldId(spec, "name");
    if (nameId != 0 && db.ast.textEqualsNode(leafId, nameId)) {
      let clsNode: u32 = 0;
      let parentClsNode: u32 = 0;
      let hasParentClass = false;
      for (const cls of db.ast.getAncestors(spec)) {
        if (db.ast.getType(cls) == $.class_definition) {
          if (clsNode == 0) {
            clsNode = cls;
          } else {
            parentClsNode = cls;
            hasParentClass = true;
            break;
          }
        }
      }
      if (clsNode != 0) {
        if (prevId != 0 && parentClsNode != 0) {
          for (const pSpec of db.ast.getDescendants(parentClsNode, $.long_class_specifier)) {
            const pNameId = db.ast.getChildByFieldId(pSpec, "name");
            if (pNameId != 0 && db.ast.textEqualsNode(prevId, pNameId)) {
              result = clsNode;
            }
            break;
          }
          if (result != 0) break;
        } else if (!hasParentClass) {
          result = clsNode;
          break;
        }
        if (fallbackNested == 0) fallbackNested = clsNode;
      }
    }
  }
  if (result == 0) {
    for (const spec of db.ast.getDescendants(docRoot, $.short_class_specifier)) {
      const nameId = db.ast.getChildByFieldId(spec, "name");
      if (nameId != 0 && db.ast.textEqualsNode(leafId, nameId)) {
        let clsNode: u32 = 0;
        let parentClsNode: u32 = 0;
        let hasParentClass = false;
        for (const cls of db.ast.getAncestors(spec)) {
          if (db.ast.getType(cls) == $.class_definition) {
            if (clsNode == 0) {
              clsNode = cls;
            } else {
              parentClsNode = cls;
              hasParentClass = true;
              break;
            }
          }
        }
        if (clsNode != 0) {
          if (prevId != 0 && parentClsNode != 0) {
            for (const pSpec of db.ast.getDescendants(parentClsNode, $.long_class_specifier)) {
              const pNameId = db.ast.getChildByFieldId(pSpec, "name");
              if (pNameId != 0 && db.ast.textEqualsNode(prevId, pNameId)) {
                result = clsNode;
              }
              break;
            }
            if (result != 0) break;
          } else if (!hasParentClass) {
            result = clsNode;
            break;
          }
          if (fallbackNested == 0) fallbackNested = clsNode;
        }
      }
    }
  }
  if (result == 0) result = fallbackNested;
  db.ast.setCachedByName(0, fullSpan, result);
  return result;
}

/**
 * Looks up the `type_specifier` CST node for component `identNode` declared in
 * `classNode` or inherited from its base classes.
 */
export function findComponentTypeInClass(db: CodeGraph, classNode: u32, identNode: u32, $: any): u32 {
  if (classNode == 0 || identNode == 0) return 0;
  const memoKind: u32 = classNode ^ 0x55550000;
  const span = db.ast.getTextSpan(identNode);
  const cached = db.ast.getCachedByName(memoKind, span);
  if (cached >= 0) return cached as u32;
  const res = findComponentTypeInClassInternal(db, classNode, identNode, $);
  db.ast.setCachedByName(memoKind, span, res);
  return res;
}

/**
 * Uncached implementation of {@link findComponentTypeInClass} that searches direct
 * component declarations and `extends` clauses while respecting `break` modifications.
 */
function findComponentTypeInClassInternal(db: CodeGraph, classNode: u32, identNode: u32, $: any): u32 {
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

    const baseClass = findClassByName(db, typeSpec, $);
    if (baseClass != 0 && baseClass != classNode) {
      const res = findComponentTypeInClass(db, baseClass, identNode, $);
      if (res != 0) return res;
    }
  }

  // 3. Inherited via long_class_specifier extends on classNode itself
  for (const spec of db.ast.getDescendants(classNode, $.long_class_specifier)) {
    if (isDescendantOfInnerClass(db, spec, classNode, $)) continue;
    if (db.ast.startsWith(spec, "extends")) {
      const nameId = db.ast.getChildByFieldId(spec, "name");
      if (nameId != 0) {
        const baseClass = findClassByName(db, nameId, $);
        if (baseClass != 0 && baseClass != classNode) {
          const res = findComponentTypeInClass(db, baseClass, identNode, $);
          if (res != 0) return res;
        }
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
  $: any,
  depth: u32 = 0,
): u32 {
  if (enclosingClass == 0 || compRefNode == 0 || depth > 15) return 0;
  if (depth == 0) {
    const memoKind: u32 = enclosingClass ^ 0x66660000;
    const span = db.ast.getTextSpan(compRefNode);
    const cached = db.ast.getCachedByName(memoKind, span);
    if (cached >= 0) return cached as u32;
    const res = resolveComponentClassDefinitionInternal(db, enclosingClass, compRefNode, $, 0);
    db.ast.setCachedByName(memoKind, span, res);
    return res;
  }
  return resolveComponentClassDefinitionInternal(db, enclosingClass, compRefNode, $, depth);
}

/**
 * Uncached recursive implementation of {@link resolveComponentClassDefinition} that resolves
 * inner classes, component types, imports, and inherited base classes.
 */
function resolveComponentClassDefinitionInternal(
  db: CodeGraph,
  enclosingClass: u32,
  compRefNode: u32,
  $: any,
  depth: u32,
): u32 {
  if (enclosingClass == 0 || compRefNode == 0 || depth > 15) return 0;
  const docRoot = db.ast.getRootNode();
  if (docRoot == 0) return 0;

  // 1. Direct inner class definitions in enclosingClass
  const inner = findInnerClassInClass(db, enclosingClass, compRefNode, $);
  if (inner != 0) return inner;

  // 2. Direct or inherited component declarations in enclosingClass
  const compType = findComponentTypeInClass(db, enclosingClass, compRefNode, $);
  if (compType != 0) {
    return findClassByName(db, compType, $);
  }

  // 2.5. Direct import_clause in enclosingClass (e.g. import P = M.Poly; or import M.Poly;)
  if ($.import_clause != 0) {
    for (const imp of db.ast.getDescendants(enclosingClass, $.import_clause)) {
      if (isDescendantOfInnerClass(db, imp, enclosingClass, $)) continue;
      let firstId: u32 = 0;
      let lastId: u32 = 0;
      for (const id of db.ast.getDescendants(imp, $.identifier)) {
        if (firstId == 0) firstId = id;
        lastId = id;
      }
      if (firstId != 0 && lastId != 0) {
        if (db.ast.textEqualsNode(compRefNode, firstId) || db.ast.textEqualsNode(compRefNode, lastId)) {
          const importedClass = findClassByName(db, lastId, $);
          if (importedClass != 0) return importedClass;
        }
      }
    }
  }

  // 3. Inherited inner classes via extends_clause
  for (const ext of db.ast.getDescendants(enclosingClass, $.extends_clause)) {
    if (isDescendantOfInnerClass(db, ext, enclosingClass, $)) continue;
    let extTypeSpec = db.ast.getChildByFieldId(ext, "type_specifier");
    if (extTypeSpec == 0) extTypeSpec = db.ast.getFirstChild(ext);
    if (extTypeSpec == 0) continue;

    let baseClass = findClassByName(db, extTypeSpec, $);
    if (baseClass != 0 && baseClass != enclosingClass) {
      const resolved = resolveComponentClassDefinition(db, baseClass, compRefNode, $, depth + 1);
      if (resolved != 0) return resolved;
    }
  }

  return 0;
}

/**
 * Checks if `node` is inside an array subscript within `limitNode`.
 */
export function isDescendantOfSubscript(db: CodeGraph, node: u32, limitNode: u32, $: any): boolean {
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
export function resolveDottedComponentClass(db: CodeGraph, enclosingClass: u32, compRefNode: u32, $: any): u32 {
  if (enclosingClass == 0 || compRefNode == 0) return 0;

  let currClass = enclosingClass;
  for (const id of db.ast.getDescendants(compRefNode, $.identifier)) {
    if (id != 0 && !isDescendantOfSubscript(db, id, compRefNode, $)) {
      const nextClass = resolveComponentClassDefinition(db, currClass, id, $, 0);
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
export function isDottedVariableDeclared(db: CodeGraph, enclosingClass: u32, compRefNode: u32, $: any): boolean {
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

  // Check if any non-leaf identifier is an enumeration type (e.g. E.a or Pkg.E.a)
  let curNonSub: u32 = 0;
  for (const id of db.ast.getDescendants(compRefNode, $.identifier)) {
    if (id != 0 && !isDescendantOfSubscript(db, id, compRefNode, $)) {
      curNonSub++;
      if (curNonSub < nonSubscriptCount) {
        if (resolveBasePrimitiveType(db, id, $) == TYPE_ENUM) {
          return true;
        }
      }
    }
  }

  // Multi-segment reference (e.g. `x.error` or `x.p1.v` or `bus.speed`)
  let currClass = enclosingClass;
  let idx: u32 = 0;
  for (const id of db.ast.getDescendants(compRefNode, $.identifier)) {
    if (id != 0 && !isDescendantOfSubscript(db, id, compRefNode, $)) {
      if (idx > 0 && isExpandableConnector(db, currClass, $)) return true;
      if (idx == nonSubscriptCount - 1) {
        return isVariableDeclaredInClass(db, currClass, id, $);
      }
      let nextClass: u32 = 0;
      if (idx == 0 && db.ast.startsWith(compRefNode, ".")) {
        nextClass = findClassByName(db, id, $);
      } else {
        nextClass = resolveComponentClassDefinition(db, currClass, id, $, 0);
      }
      if (nextClass == 0 && idx == 0) {
        for (const anc of db.ast.getAncestors(enclosingClass)) {
          if (db.ast.getType(anc) == $.class_definition) {
            for (const spec of db.ast.getDescendants(anc, $.long_class_specifier)) {
              const nameId = db.ast.getChildByFieldId(spec, "name");
              if (nameId != 0 && db.ast.textEqualsNode(id, nameId)) {
                nextClass = anc;
                break;
              }
              break;
            }
            if (nextClass != 0) break;
          }
        }
        if (nextClass == 0) {
          nextClass = findClassByName(db, id, $);
        }
      }
      if (nextClass == 0) {
        const compType = findComponentTypeInClass(db, currClass, id, $);
        if (compType != 0) {
          // If the component's type is a primitive (Real, Integer, etc.), it cannot have fields
          if (resolveBasePrimitiveType(db, compType, $) != TYPE_UNKNOWN) {
            return false;
          }
          // The component is declared and has an external / non-primitive type whose definition
          // is outside this file (e.g. Modelica Standard Library components like SineVoltage, Inductor).
          return true;
        }
        return false;
      }
      currClass = nextClass;
      idx++;
    }
  }

  return false;
}

/**
 * Returns the specific unresolved identifier node inside a component_reference
 * (e.g. `b` in `a.b.c` if `a` exists and `b` does not, or `a` in `a[1]` if `a` does not exist).
 */
export function findUnresolvedComponentIdent(db: CodeGraph, enclosingClass: u32, compRefNode: u32, $: any): u32 {
  if (enclosingClass == 0 || compRefNode == 0) return compRefNode;

  let firstIdent: u32 = 0;
  let nonSubscriptCount: u32 = 0;
  for (const id of db.ast.getDescendants(compRefNode, $.identifier)) {
    if (id != 0 && !isDescendantOfSubscript(db, id, compRefNode, $)) {
      if (firstIdent == 0) firstIdent = id;
      nonSubscriptCount++;
    }
  }

  if (firstIdent == 0) return compRefNode;
  if (nonSubscriptCount <= 1) return firstIdent;

  let currClass = enclosingClass;
  let idx: u32 = 0;
  let returnNext = false;
  for (const id of db.ast.getDescendants(compRefNode, $.identifier)) {
    if (id != 0 && !isDescendantOfSubscript(db, id, compRefNode, $)) {
      if (returnNext) return id;
      if (idx == nonSubscriptCount - 1) {
        return id;
      }
      let nextClass = resolveComponentClassDefinition(db, currClass, id, $, 0);
      if (nextClass == 0 && idx == 0) {
        for (const anc of db.ast.getAncestors(enclosingClass)) {
          if (db.ast.getType(anc) == $.class_definition) {
            for (const spec of db.ast.getDescendants(anc, $.long_class_specifier)) {
              const nameId = db.ast.getChildByFieldId(spec, "name");
              if (nameId != 0 && db.ast.textEqualsNode(id, nameId)) {
                nextClass = anc;
                break;
              }
              break;
            }
            if (nextClass != 0) break;
          }
        }
        if (nextClass == 0) {
          nextClass = findClassByName(db, id, $);
        }
      }
      if (nextClass == 0) {
        const compType = findComponentTypeInClass(db, currClass, id, $);
        if (compType != 0 && resolveBasePrimitiveType(db, compType, $) != TYPE_UNKNOWN) {
          returnNext = true;
          idx++;
          continue;
        }
        return id;
      }
      currClass = nextClass;
      idx++;
    }
  }

  return firstIdent;
}

/**
 * Checks if a class is an expandable connector.
 */
export function isExpandableConnector(db: CodeGraph, clsNode: u32, $: any): boolean {
  if (clsNode == 0) return false;
  for (const pfx of db.ast.getDescendants(clsNode, $.class_prefixes)) {
    if (db.ast.startsWith(pfx, "expandable") || isClassKind(db, pfx, "expandable")) {
      return true;
    }
  }
  return isClassKind(db, clsNode, "expandable");
}

/**
 * Checks if two connector classes are compatible for a connect() equation.
 */
export function isConnectorCompatible(db: CodeGraph, lhsClass: u32, rhsClass: u32, $: any): boolean {
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

  // 3. Each component in lhsClass must have a matching declaration by name in rhsClass
  for (const comp of db.ast.getDescendants(lhsClass, $.component_clause)) {
    if (isDescendantOfInnerClass(db, comp, lhsClass, $)) continue;
    for (const decl of db.ast.getDescendants(comp, $.declaration)) {
      const nameNode = db.ast.getChildByFieldId(decl, "name");
      if (nameNode != 0) {
        const rhsComp = findComponentClauseForIdent(db, rhsClass, nameNode, $);
        if (rhsComp == 0) return false;
      }
    }
  }

  return true;
}

/**
 * Finds the component clause containing declaration of `identNode` in `classNode`.
 */
export function findComponentClauseForIdent(db: CodeGraph, classNode: u32, identNode: u32, $: any): u32 {
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
export function findFlowMismatchInConnectors(db: CodeGraph, lhsClass: u32, rhsClass: u32, $: any): u32 {
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
 * Checks if a leaf component identifier `leafId` is declared with the `stream` prefix
 * inside `currClass` or any of its inherited base classes.
 */
function isLeafDeclaredStreamInClass(db: CodeGraph, currClass: u32, leafId: u32, $: any, depth: u32): boolean {
  if (currClass == 0 || depth > 10) return false;
  for (const comp of db.ast.getDescendants(currClass, $.component_clause)) {
    if (isDescendantOfInnerClass(db, comp, currClass, $)) continue;
    for (const decl of db.ast.getDescendants(comp, $.declaration)) {
      const nameNode = db.ast.getChildByFieldId(decl, "name");
      if (nameNode != 0 && db.ast.textEqualsNode(nameNode, leafId)) {
        return hasTypePrefix(db, comp, "stream", $);
      }
    }
  }
  for (const ext of db.ast.getDescendants(currClass, $.extends_clause)) {
    if (isDescendantOfInnerClass(db, ext, currClass, $)) continue;
    for (const ts of db.ast.getDescendants(ext, $.type_specifier)) {
      const baseClass = findClassByName(db, ts, $);
      if (baseClass != 0 && baseClass != currClass) {
        if (isLeafDeclaredStreamInClass(db, baseClass, leafId, $, depth + 1)) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Checks if a potentially dotted variable reference (`varRefNode`) resolves to a
 * connector component declared with the `stream` prefix (per MLS §15.1).
 */
export function isStreamVariable(db: CodeGraph, enclosingClass: u32, varRefNode: u32, $: any): boolean {
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
      const nextClass = resolveComponentClassDefinition(db, currClass, id, $, 0);
      if (nextClass == 0) return false;
      currClass = nextClass;
      idx++;
    }
  }

  return isLeafDeclaredStreamInClass(db, currClass, leafId, $, 0);
}

/**
 * Counts flow variables in `classDefNode` or its base classes.
 */
export function getFlowVariableCount(db: CodeGraph, classDefNode: u32, $: any): u32 {
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

      const cls = findClassByName(db, typeSpec, $);
      if (cls != 0) {
        count += getFlowVariableCount(db, cls, $);
      }
    }
  }

  return count;
}

/**
 * Checks if `nameNode` matches a top-level class name declared in the document.
 */
export function isTopLevelClassName(db: CodeGraph, nameNode: u32, $: any): boolean {
  if (nameNode == 0) return false;
  const span = db.ast.getTextSpan(nameNode);
  const cached = db.ast.getCachedByName(2, span);
  if (cached >= 0) return cached == 1;
  const res = isTopLevelClassNameInternal(db, nameNode, $);
  db.ast.setCachedByName(2, span, res ? 1 : 0);
  return res;
}

/**
 * Uncached implementation of {@link isTopLevelClassName} that checks whether the full,
 * leading, or trailing identifier of `nameNode` matches a class in the document.
 */
function isTopLevelClassNameInternal(db: CodeGraph, nameNode: u32, $: any): boolean {
  let firstIdent: u32 = nameNode;
  for (const id of db.ast.getDescendants(nameNode, $.identifier)) {
    firstIdent = id;
    break;
  }
  let lastIdent: u32 = firstIdent;
  for (const id of db.ast.getDescendants(nameNode, $.identifier)) {
    lastIdent = id;
  }

  if (findClassByName(db, nameNode, $) != 0) return true;
  if (firstIdent != nameNode && findClassByName(db, firstIdent, $) != 0) return true;
  if (lastIdent != nameNode && lastIdent != firstIdent && findClassByName(db, lastIdent, $) != 0) return true;

  return false;
}

/**
 * Returns true if `target` is nested inside an inner class_definition child of `classNode`.
 */
export function isDescendantOfInnerClass(db: CodeGraph, target: u32, classNode: u32, $: any): boolean {
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
export function isVariableDeclaredInClass(db: CodeGraph, classNode: u32, identNode: u32, $: any): boolean {
  if (classNode == 0 || identNode == 0) return false;
  // 1. Direct component declaration in classNode (fastest path for variables in equations)
  if (findDeclInClass(db, classNode, identNode, $) != 0) return true;
  // 2. Direct inner class definition in classNode
  if (findInnerClassInClass(db, classNode, identNode, $) != 0) return true;
  // 2.5. Direct import_clause in classNode
  if ($.import_clause != 0) {
    for (const imp of db.ast.getDescendants(classNode, $.import_clause)) {
      if (isDescendantOfInnerClass(db, imp, classNode, $)) continue;
      let firstId: u32 = 0;
      let lastId: u32 = 0;
      for (const id of db.ast.getDescendants(imp, $.identifier)) {
        if (firstId == 0) firstId = id;
        lastId = id;
      }
      if (firstId != 0 && lastId != 0) {
        if (db.ast.textEqualsNode(identNode, firstId) || db.ast.textEqualsNode(identNode, lastId)) {
          return true;
        }
      }
    }
  }
  // 3. Inherited member or record component
  return getMemberKindInClass(db, classNode, identNode, $) != MEMBER_NONE;
}

/** Member kind tag indicating that no matching member exists in the class hierarchy. */
export const MEMBER_NONE: u16 = 0;
/** Member kind tag indicating a `model`, `block`, or `connector` component declaration. */
export const MEMBER_COMPONENT: u16 = 1;
/** Member kind tag indicating an inner class or type definition. */
export const MEMBER_CLASS: u16 = 2;
/** Member kind tag indicating a primitive or `record` component declaration. */
export const MEMBER_RECORD_COMPONENT: u16 = 3;

/**
 * Returns member kind in classNode or its inherited base classes:
 * MEMBER_NONE (0), MEMBER_COMPONENT (1), MEMBER_CLASS (2), or MEMBER_RECORD_COMPONENT (3).
 */
export function getMemberKindInClass(db: CodeGraph, classNode: u32, identNode: u32, $: any): u16 {
  if (classNode == 0 || identNode == 0) return MEMBER_NONE;
  // kinds 0..15 are reserved for name-only memos; (class node + 16) discriminates per class.
  const memoKind: u32 = classNode + 16;
  const span = db.ast.getTextSpan(identNode);
  const cached = db.ast.getCachedByName(memoKind, span);
  if (cached >= 0) return cached as u16;
  const res = getMemberKindInClassInternal(db, classNode, identNode, $, 0);
  db.ast.setCachedByName(memoKind, span, res as u32);
  return res;
}

/**
 * Uncached recursive implementation of {@link getMemberKindInClass} that classifies
 * direct and inherited members while respecting `break` inheritance modifications.
 */
function getMemberKindInClassInternal(db: CodeGraph, classNode: u32, identNode: u32, $: any, depth: u32): u16 {
  if (classNode == 0 || identNode == 0 || depth > 10) return MEMBER_NONE;

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
        const cDef = findClassByName(db, typeSpec, $);
        if (cDef != 0) {
          if (isClassKind(db, cDef, "model") || isClassKind(db, cDef, "block") || isClassKind(db, cDef, "connector")) {
            return MEMBER_COMPONENT;
          }
          return MEMBER_RECORD_COMPONENT;
        }
        if (resolveBasePrimitiveType(db, typeIdent, $) != TYPE_UNKNOWN) {
          return MEMBER_RECORD_COMPONENT;
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

          const baseClass = findClassByName(db, typeSpec, $);
          if (baseClass != 0 && baseClass != classNode) {
            const res = getMemberKindInClassInternal(db, baseClass, identNode, $, depth + 1);
            if (res != MEMBER_NONE) return res;
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

      const baseClass = findClassByName(db, typeSpec, $);
      if (baseClass != 0 && baseClass != classNode) {
        const res = getMemberKindInClassInternal(db, baseClass, identNode, $, depth + 1);
        if (res != MEMBER_NONE) return res;
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

    const baseClass = findClassByName(db, typeSpec, $);
    if (baseClass != 0 && baseClass != classNode) {
      const res = getMemberKindInClass(db, baseClass, identNode, $);
      if (res != MEMBER_NONE) return res;
    }
  }

  // 5. Inherited members via long_class_specifier extends on classNode itself
  for (const spec of db.ast.getDescendants(classNode, $.long_class_specifier)) {
    if (isDescendantOfInnerClass(db, spec, classNode, $)) continue;
    if (db.ast.startsWith(spec, "extends")) {
      const nameId = db.ast.getChildByFieldId(spec, "name");
      if (nameId != 0) {
        const baseClass = findClassByName(db, nameId, $);
        if (baseClass != 0 && baseClass != classNode) {
          const res = getMemberKindInClass(db, baseClass, identNode, $);
          if (res != MEMBER_NONE) return res;
        }
      }
    }
  }

  return MEMBER_NONE;
}

/**
 * Checks whether a matching connect(ep1, ep2) exists in classNode or its inherited hierarchy.
 */
export function hasMatchingConnectEquation(db: CodeGraph, classNode: u32, ep1: u32, ep2: u32, $: any): boolean {
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

    const baseClass = findClassByName(db, typeSpec, $);
    if (baseClass != 0 && baseClass != classNode) {
      if (hasMatchingConnectEquation(db, baseClass, ep1, ep2, $)) return true;
    }
  }
  return false;
}

/**
 * Resolves the declared type of a potentially dotted variable reference (e.g. `x` or `x.y`)
 * across the class hierarchy.
 */
export function getDottedVariableType(db: CodeGraph, enclosingClass: u32, compRefNode: u32, $: any): u16 {
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
      const nextClass = resolveComponentClassDefinition(db, currClass, id, $, 0);
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
export function getVariableTypeInClass(db: CodeGraph, classNode: u32, identNode: u32, $: any): u16 {
  if (classNode == 0 || identNode == 0) return TYPE_UNKNOWN;
  const memoKind: u32 = classNode ^ 0x77770000;
  const span = db.ast.getTextSpan(identNode);
  const cached = db.ast.getCachedByName(memoKind, span);
  if (cached >= 0) return cached as u16;
  const res = getVariableTypeInClassInternal(db, classNode, identNode, $, 0);
  db.ast.setCachedByName(memoKind, span, res as u32);
  return res;
}

/**
 * Uncached recursive implementation of {@link getVariableTypeInClass} that resolves
 * primitive types, type aliases, and user-defined type hashes (`0x8000 | hash`) across
 * direct declarations and `extends` clauses.
 */
function getVariableTypeInClassInternal(db: CodeGraph, classNode: u32, identNode: u32, $: any, depth: u32): u16 {
  if (classNode == 0 || identNode == 0 || depth > 10) return TYPE_UNKNOWN;
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

            const specCls = findClassByName(db, tsNode, $);
            if (specCls != 0) {
              for (const scs of db.ast.getDescendants(specCls, $.short_class_specifier)) {
                for (const ts of db.ast.getDescendants(scs, $.type_specifier)) {
                  for (const tid of db.ast.getDescendants(ts, $.identifier)) {
                    const aliasBase = resolveBasePrimitiveType(db, tid, $);
                    if (aliasBase != TYPE_UNKNOWN) return aliasBase;
                  }
                }
                break;
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

          const baseClass = findClassByName(db, typeSpec, $);
          if (baseClass != 0 && baseClass != classNode) {
            const inheritedType = getVariableTypeInClassInternal(db, baseClass, targetId, $, depth + 1);
            if (inheritedType != TYPE_UNKNOWN) return inheritedType;
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

      const baseClass = findClassByName(db, typeSpec, $);
      if (baseClass != 0 && baseClass != classNode) {
        const inheritedType = getVariableTypeInClassInternal(db, baseClass, targetId, $, depth + 1);
        if (inheritedType != TYPE_UNKNOWN) return inheritedType;
      }
    }
  }

  return TYPE_UNKNOWN;
}

/**
 * Resolves the declared or inferred SI unit for a component declaration or clause.
 */
export function getComponentUnit(db: CodeGraph, compNode: u32, $: any): SIUnit | null {
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
export function getVariableUnitInClass(db: CodeGraph, classNode: u32, identNode: u32, $: any): SIUnit | null {
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
export function hasUnitInClass(db: CodeGraph, classNode: u32, $: any): boolean {
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
export function inferExprUnit(db: CodeGraph, exprNode: u32, $: any, classNode: u32 = 0): SIUnit | null {
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

/**
 * Returns the class specialization kind as a string ("record", "type", "package", "connector", "function", "model", "block", "class").
 */
export function getClassKindString(db: CodeGraph, clsNode: u32, _$: any): string {
  if (isClassKind(db, clsNode, "function")) return "function";
  if (isClassKind(db, clsNode, "record")) return "record";
  if (isClassKind(db, clsNode, "connector")) return "connector";
  if (isClassKind(db, clsNode, "model")) return "model";
  if (isClassKind(db, clsNode, "block")) return "block";
  if (isClassKind(db, clsNode, "package")) return "package";
  if (isClassKind(db, clsNode, "type")) return "type";
  return "class";
}

/**
 * Resolves the name AST node for a class_definition.
 */
export function getClassNameNode(db: CodeGraph, clsNode: u32, $: any): u32 {
  if (clsNode == 0) return 0;
  for (const spec of db.ast.getDescendants(clsNode, $.long_class_specifier)) {
    const n = db.ast.getChildByFieldId(spec, "name");
    if (n != 0) return n;
    for (const id of db.ast.getDescendants(spec, $.identifier)) return id;
  }
  for (const spec of db.ast.getDescendants(clsNode, $.short_class_specifier)) {
    const n = db.ast.getChildByFieldId(spec, "name");
    if (n != 0) return n;
    for (const id of db.ast.getDescendants(spec, $.identifier)) return id;
  }
  return 0;
}

/**
 * Checks whether an extends_clause creates a direct or multi-hop inheritance cycle in the same scope.
 */
export function hasExtendsCycleInScope(db: CodeGraph, extNode: u32, $: any): boolean {
  const startClass = getEnclosingClass(db, extNode, $);
  if (startClass == 0) return false;
  let typeSpec: u32 = 0;
  let c = db.ast.getFirstChild(extNode);
  while (c != 0) {
    if (db.ast.getType(c) == $.type_specifier) {
      typeSpec = c;
      break;
    }
    c = db.ast.getNextSibling(c);
  }
  if (typeSpec == 0) return false;
  let idCount: u32 = 0;
  let firstId: u32 = 0;
  for (const id of db.ast.getDescendants(typeSpec, $.identifier)) {
    idCount++;
    if (firstId == 0) firstId = id;
  }
  if (idCount != 1 || firstId == 0) return false;

  const startName = getClassNameNode(db, startClass, $);
  if (startName == 0) return false;
  if (db.ast.textEqualsNode(firstId, startName)) return true;

  let outerClass: u32 = 0;
  for (const anc of db.ast.getAncestors(startClass, 0)) {
    if (anc != startClass && db.ast.getType(anc) == $.class_definition) {
      outerClass = anc;
      break;
    }
  }
  const scopeRoot = outerClass != 0 ? outerClass : db.ast.getRootNode();
  if (scopeRoot == 0) return false;

  let currTargetId: u32 = firstId;
  let depth: u32 = 0;
  while (currTargetId != 0 && depth < 8) {
    depth++;
    let targetCls: u32 = 0;
    for (const cls of db.ast.getDescendants(scopeRoot, $.class_definition)) {
      if (cls == scopeRoot) continue;
      let clsParent: u32 = 0;
      for (const anc of db.ast.getAncestors(cls, 0)) {
        if (anc != cls && db.ast.getType(anc) == $.class_definition) {
          clsParent = anc;
          break;
        }
      }
      if (clsParent != outerClass) continue;
      const cName = getClassNameNode(db, cls, $);
      if (cName != 0 && db.ast.textEqualsNode(cName, currTargetId)) {
        targetCls = cls;
        break;
      }
    }
    if (targetCls == 0) return false;
    if (targetCls == startClass) return true;

    let nextTargetId: u32 = 0;
    for (const ext of db.ast.getDescendants(targetCls, $.extends_clause)) {
      if (isDescendantOfInnerClass(db, ext, targetCls, $)) continue;
      let extSpec: u32 = 0;
      let ch = db.ast.getFirstChild(ext);
      while (ch != 0) {
        if (db.ast.getType(ch) == $.type_specifier) {
          extSpec = ch;
          break;
        }
        ch = db.ast.getNextSibling(ch);
      }
      if (extSpec == 0) continue;
      let extIdCount: u32 = 0;
      let extFirstId: u32 = 0;
      for (const id of db.ast.getDescendants(extSpec, $.identifier)) {
        extIdCount++;
        if (extFirstId == 0) extFirstId = id;
      }
      if (extIdCount == 1 && extFirstId != 0) {
        if (db.ast.textEqualsNode(extFirstId, startName)) return true;
        if (nextTargetId == 0) nextTargetId = extFirstId;
      }
    }
    currTargetId = nextTargetId;
  }
  return false;
}

/**
 * Returns the callee/name node of a function_call or primary call node, or 0 if not a call.
 */
export function getCallCalleeNode(db: CodeGraph, callNode: u32, $: any): u32 {
  let name = db.ast.getChildByFieldId(callNode, "name");
  if (name == 0) name = db.ast.getChildByFieldId(callNode, "callee");
  if (name != 0) return name;
  const fc = db.ast.getFirstChild(callNode);
  if (fc != 0 && db.ast.getType(fc) == $.component_reference) {
    const sib = db.ast.getNextSibling(fc);
    if (sib != 0 && (db.ast.getType(sib) == $.function_call_args || db.ast.startsWith(sib, "("))) {
      return fc;
    }
  }
  return 0;
}

/**
 * Checks if an extends_clause targets a replaceable inner class in an enclosing class or document.
 */
export function isReplaceableBaseClassInScope(db: CodeGraph, extNode: u32, $: any): boolean {
  let typeSpec = db.ast.getChildByFieldId(extNode, "type_specifier");
  if (typeSpec == 0) {
    for (const ts of db.ast.getDescendants(extNode, $.type_specifier)) {
      typeSpec = ts;
      break;
    }
  }
  if (typeSpec == 0) return false;
  let firstId: u32 = 0;
  for (const id of db.ast.getDescendants(typeSpec, $.identifier)) {
    firstId = id;
    break;
  }
  if (firstId == 0) return false;

  for (const anc of db.ast.getAncestors(extNode, 0)) {
    if (db.ast.getType(anc) == $.class_definition) {
      const innerCls = findInnerClassInClass(db, anc, firstId, $);
      if (innerCls != 0 && isElementReplaceable(db, innerCls, $)) {
        return true;
      }
    }
  }
  const targetCls = findClassByName(db, typeSpec, $);
  if (targetCls != 0 && isElementReplaceable(db, targetCls, $)) {
    return true;
  }
  return false;
}

/**
 * Checks if a non-replaceable component_clause instantiates a partial class.
 */
export function isPartialTypeComponentInScope(db: CodeGraph, compClause: u32, $: any): boolean {
  if (isElementReplaceable(db, compClause, $)) return false;
  for (const anc of db.ast.getAncestors(compClause, 0)) {
    if (db.ast.getType(anc) == $.class_definition) {
      if (isClassKind(db, anc, "partial") || isClassKind(db, anc, "package")) return false;
      if (isClassKind(db, anc, "function") && hasTypePrefix(db, compClause, "input", $)) return false;
      break;
    }
  }
  let typeSpec: u32 = 0;
  for (const ts of db.ast.getDescendants(compClause, $.type_specifier)) {
    typeSpec = ts;
    break;
  }
  if (typeSpec == 0) return false;
  let idCount: u32 = 0;
  for (const _id of db.ast.getDescendants(typeSpec, $.identifier)) {
    idCount++;
  }
  if (idCount != 1) return false;
  const targetCls = findClassByName(db, typeSpec, $);
  if (targetCls == 0) return false;
  if (isClassKind(db, targetCls, "function") || isClassKind(db, targetCls, "package")) return false;
  return isClassKind(db, targetCls, "partial");
}

/**
 * Checks if cardinality() is called with a class name instead of a component.
 */
export function isCardinalityClassArg(db: CodeGraph, callNode: u32, $: any): boolean {
  const name = getCallCalleeNode(db, callNode, $);
  if (name == 0 || !db.ast.textEquals(name, "cardinality")) return false;
  let firstArg: u32 = 0;
  for (const arg of db.ast.getDescendants(callNode, $.function_argument)) {
    firstArg = arg;
    break;
  }
  if (firstArg == 0) return false;
  let idCount: u32 = 0;
  let argId: u32 = 0;
  for (const id of db.ast.getDescendants(firstArg, $.identifier)) {
    idCount++;
    if (argId == 0) argId = id;
  }
  if (idCount != 1 || argId == 0) return false;
  for (const _sub of db.ast.getDescendants(firstArg, $.array_subscripts)) {
    return false;
  }
  const encClass = getEnclosingClass(db, callNode, $);
  if (encClass == 0) return false;
  if (findDeclInClass(db, encClass, argId, $) != 0) return false;
  if (getMemberKindInClass(db, encClass, argId, $) == MEMBER_CLASS) return true;
  if (findClassByName(db, argId, $) != 0) return true;
  return false;
}

/**
 * Checks if an expression node is a 3-part range (start : step : stop) over an enumeration type.
 */
export function isEnumStepRangeExpr(db: CodeGraph, exprNode: u32, $: any): boolean {
  let unwrapped = exprNode;
  while (unwrapped != 0 && db.ast.getChildCount(unwrapped) == 1) {
    unwrapped = db.ast.getFirstChild(unwrapped);
  }
  if (unwrapped == 0 || db.ast.getChildCount(unwrapped) != 3) return false;
  const leftRaw = db.ast.getFirstChild(unwrapped);
  if (leftRaw == 0) return false;
  const mid = db.ast.getNextSibling(leftRaw);
  if (mid == 0 || !db.ast.textEquals(mid, ":")) return false;
  const stopNode = db.ast.getNextSibling(mid);
  if (stopNode == 0) return false;

  let left = leftRaw;
  while (left != 0 && db.ast.getChildCount(left) == 1) {
    left = db.ast.getFirstChild(left);
  }
  if (left == 0 || db.ast.getChildCount(left) != 3) return false;
  const startNode = db.ast.getFirstChild(left);
  if (startNode == 0) return false;
  const leftMid = db.ast.getNextSibling(startNode);
  if (leftMid == 0 || !db.ast.textEquals(leftMid, ":")) return false;

  const startType = inferExprType(db, startNode, $);
  const stopType = inferExprType(db, stopNode, $);
  if (startType == TYPE_ENUM || stopType == TYPE_ENUM) return true;

  for (const id of db.ast.getDescendants(startNode, $.identifier)) {
    if (resolveBasePrimitiveType(db, id, $) == TYPE_ENUM) return true;
    break;
  }
  for (const id of db.ast.getDescendants(stopNode, $.identifier)) {
    if (resolveBasePrimitiveType(db, id, $) == TYPE_ENUM) return true;
    break;
  }
  return false;
}

/**
 * Checks if an element_modification assigns a scalar literal to an array component without 'each'.
 */
export function isNonArrayScalarModification(db: CodeGraph, modNode: u32, $: any): boolean {
  for (const anc of db.ast.getAncestors(modNode, 0)) {
    const t = db.ast.getType(anc);
    if (t == $.argument || t == $.element_modification_or_replaceable) {
      let ch = db.ast.getFirstChild(anc);
      while (ch != 0) {
        if (db.ast.textEquals(ch, "each")) return false;
        ch = db.ast.getNextSibling(ch);
      }
      if (t == $.argument) break;
    }
  }
  let modName = db.ast.getChildByFieldId(modNode, "name");
  if (modName == 0) {
    for (const n of db.ast.getDescendants(modNode, $.name)) {
      modName = n;
      break;
    }
  }
  if (modName == 0) return false;
  let idCount: u32 = 0;
  let targetId: u32 = 0;
  for (const id of db.ast.getDescendants(modName, $.identifier)) {
    idCount++;
    if (targetId == 0) targetId = id;
  }
  if (idCount != 1 || targetId == 0) return false;

  let modVal = db.ast.getChildByFieldId(modNode, "modification");
  if (modVal == 0) {
    for (const m of db.ast.getDescendants(modNode, $.modification)) {
      modVal = m;
      break;
    }
  }
  if (modVal == 0) return false;
  let exprNode = db.ast.getChildByFieldId(modVal, "modification_expression");
  if (exprNode == 0) {
    for (const e of db.ast.getDescendants(modVal, $.modification_expression)) {
      exprNode = e;
      break;
    }
  }
  if (exprNode == 0) {
    let ch = db.ast.getFirstChild(modVal);
    let afterEq = false;
    while (ch != 0) {
      if (db.ast.textEquals(ch, "=") || db.ast.textEquals(ch, ":=")) {
        afterEq = true;
      } else if (afterEq) {
        exprNode = ch;
        break;
      }
      ch = db.ast.getNextSibling(ch);
    }
  }
  if (exprNode == 0) return false;
  for (const _id of db.ast.getDescendants(exprNode, $.identifier)) return false;
  for (const _fc of db.ast.getDescendants(exprNode, $.function_call)) return false;
  for (const _arr of db.ast.getDescendants(exprNode, $.array_arguments)) return false;
  for (const _sub of db.ast.getDescendants(exprNode, $.array_subscripts)) return false;
  if (db.ast.startsWith(exprNode, "{") || db.ast.startsWith(exprNode, "[")) return false;
  for (const subExpr of db.ast.getDescendants(exprNode, $.expression)) {
    let u = subExpr;
    while (u != 0 && db.ast.getChildCount(u) == 1) u = db.ast.getFirstChild(u);
    if (u != 0 && db.ast.getChildCount(u) == 3) {
      const c1 = db.ast.getFirstChild(u);
      const c2 = c1 != 0 ? db.ast.getNextSibling(c1) : 0;
      if (c2 != 0 && db.ast.textEquals(c2, ":")) return false;
    }
  }
  let hasScalarLit = false;
  for (const _num of db.ast.getDescendants(exprNode, $.unsigned_number)) {
    hasScalarLit = true;
    break;
  }
  if (!hasScalarLit && (db.ast.textEquals(exprNode, "true") || db.ast.textEquals(exprNode, "false"))) {
    hasScalarLit = true;
  }
  if (!hasScalarLit) return false;

  let compClause: u32 = 0;
  let declNode: u32 = 0;
  let classModCount: u32 = 0;
  for (const anc of db.ast.getAncestors(modNode, 0)) {
    if (anc == modNode) continue;
    const t = db.ast.getType(anc);
    if (t == $.class_modification) classModCount++;
    if (t == $.declaration && declNode == 0) declNode = anc;
    if (t == $.component_clause) {
      compClause = anc;
      break;
    }
    if (t == $.extends_clause || t == $.short_class_specifier) return false;
  }
  if (compClause == 0 || classModCount != 1) return false;

  if (declNode != 0) {
    for (const sub of db.ast.getDescendants(declNode, $.array_subscripts)) {
      let insideMod = false;
      for (const anc of db.ast.getAncestors(sub, 0, declNode)) {
        if (anc == modVal) {
          insideMod = true;
          break;
        }
      }
      if (!insideMod) return true;
    }
  }
  for (const sub of db.ast.getDescendants(compClause, $.array_subscripts)) {
    let insideDecl = false;
    for (const anc of db.ast.getAncestors(sub, 0, compClause)) {
      if (anc == declNode || anc == modVal) {
        insideDecl = true;
        break;
      }
    }
    if (!insideDecl) return true;
  }

  let typeSpec: u32 = 0;
  for (const ts of db.ast.getDescendants(compClause, $.type_specifier)) {
    typeSpec = ts;
    break;
  }
  if (typeSpec == 0) return false;
  const targetCls = findClassByName(db, typeSpec, $);
  if (targetCls == 0) return false;

  const memberDecl = findDeclInClass(db, targetCls, targetId, $);
  if (memberDecl == 0) return false;
  for (const _sub of db.ast.getDescendants(memberDecl, $.array_subscripts)) {
    return true;
  }
  for (const anc of db.ast.getAncestors(memberDecl, 0, targetCls)) {
    if (db.ast.getType(anc) == $.component_clause) {
      for (const sub of db.ast.getDescendants(anc, $.array_subscripts)) {
        let insideMember = false;
        for (const a2 of db.ast.getAncestors(sub, 0, anc)) {
          if (a2 == memberDecl) {
            insideMember = true;
            break;
          }
        }
        if (!insideMember) return true;
      }
      break;
    }
  }
  return false;
}

/**
 * Checks if a discrete variable is assigned in a continuous equation using 'time' or 'der()' outside a when_equation.
 */
export function isDiscreteAssignedOutsideWhen(db: CodeGraph, eqNode: u32, $: any): boolean {
  for (const anc of db.ast.getAncestors(eqNode, 0)) {
    if (db.ast.getType(anc) == $.when_equation) return false;
  }
  let lhs = db.ast.getChildByFieldId(eqNode, "lhs");
  let rhs = db.ast.getChildByFieldId(eqNode, "rhs");
  if (lhs == 0) lhs = db.ast.getFirstChild(eqNode);
  if (rhs == 0 && lhs != 0) {
    let sib = db.ast.getNextSibling(lhs);
    while (sib != 0) {
      if (!db.ast.textEquals(sib, "=")) {
        rhs = sib;
        break;
      }
      sib = db.ast.getNextSibling(sib);
    }
  }
  if (lhs == 0 || rhs == 0) return false;
  let idCount: u32 = 0;
  let lhsId: u32 = 0;
  for (const id of db.ast.getDescendants(lhs, $.identifier)) {
    idCount++;
    if (lhsId == 0) lhsId = id;
  }
  if (idCount != 1 || lhsId == 0) return false;

  const encClass = getEnclosingClass(db, eqNode, $);
  if (encClass == 0) return false;
  const decl = findDeclInClass(db, encClass, lhsId, $);
  if (decl == 0) return false;
  let compClause: u32 = 0;
  for (const anc of db.ast.getAncestors(decl, 0, encClass)) {
    if (db.ast.getType(anc) == $.component_clause) {
      compClause = anc;
      break;
    }
  }
  if (compClause == 0 || !hasTypePrefix(db, compClause, "discrete", $)) return false;

  let hasContinuousTimeOrDer = false;
  if (db.ast.textEquals(rhs, "time") || db.ast.startsWith(rhs, "der(")) {
    hasContinuousTimeOrDer = true;
  }
  if (!hasContinuousTimeOrDer) {
    for (const p of db.ast.getDescendants(rhs, $.primary)) {
      if (db.ast.textEquals(p, "time") || db.ast.startsWith(p, "der(")) {
        hasContinuousTimeOrDer = true;
        break;
      }
      const callee = getCallCalleeNode(db, p, $);
      if (callee != 0 && db.ast.textEquals(callee, "sample")) {
        return false;
      }
    }
  }
  if (!hasContinuousTimeOrDer) return false;
  return true;
}

/**
 * Checks if a component_clause or its enclosing element has a prefix such as 'inner' or 'outer'.
 */
export function hasElementOrTypePrefix(db: CodeGraph, compClause: u32, prefix: string, $: any): boolean {
  if (hasTypePrefix(db, compClause, prefix, $)) return true;
  if (db.ast.startsWith(compClause, prefix)) return true;
  for (const anc of db.ast.getAncestors(compClause, 0)) {
    const t = db.ast.getType(anc);
    if (t == $.element) {
      if (db.ast.startsWith(anc, prefix)) return true;
      let ch = db.ast.getFirstChild(anc);
      while (ch != 0) {
        if (db.ast.textEquals(ch, prefix)) return true;
        ch = db.ast.getNextSibling(ch);
      }
      break;
    }
    if (t == $.class_definition || t == $.composition) break;
  }
  return false;
}

/**
 * Checks if an outer component_clause has no matching inner declaration in a self-contained document.
 */
export function isMissingInnerInDocument(db: CodeGraph, compClause: u32, $: any): boolean {
  if (!hasElementOrTypePrefix(db, compClause, "outer", $)) return false;
  if (hasElementOrTypePrefix(db, compClause, "inner", $)) return false;
  const encClass = getEnclosingClass(db, compClause, $);
  if (encClass != 0 && isClassKind(db, encClass, "partial")) return false;

  let outerId: u32 = 0;
  for (const decl of db.ast.getDescendants(compClause, $.declaration)) {
    for (const id of db.ast.getDescendants(decl, $.identifier)) {
      outerId = id;
      break;
    }
    if (outerId != 0) break;
  }
  if (outerId == 0) return false;

  const root = db.ast.getRootNode();
  if (root == 0) return false;
  for (const _ext of db.ast.getDescendants(root, $.extends_clause)) {
    return false;
  }
  for (const otherComp of db.ast.getDescendants(root, $.component_clause)) {
    if (!hasElementOrTypePrefix(db, otherComp, "inner", $)) continue;
    for (const decl of db.ast.getDescendants(otherComp, $.declaration)) {
      for (const id of db.ast.getDescendants(decl, $.identifier)) {
        if (db.ast.textEqualsNode(id, outerId)) return false;
        break;
      }
    }
  }
  return true;
}

/**
 * Checks if a binary expression directly mixes two different Clock(...) domains or sample() + previous().
 */
export function hasMixedClockDomains(db: CodeGraph, exprNode: u32, $: any): boolean {
  let unwrapped = exprNode;
  while (unwrapped != 0 && db.ast.getChildCount(unwrapped) == 1) {
    unwrapped = db.ast.getFirstChild(unwrapped);
  }
  if (unwrapped == 0 || db.ast.getChildCount(unwrapped) != 3) return false;
  const left = db.ast.getFirstChild(unwrapped);
  if (left == 0) return false;
  const op = db.ast.getNextSibling(left);
  if (op == 0) return false;
  const right = db.ast.getNextSibling(op);
  if (right == 0) return false;

  let leftClockArg: u32 = 0;
  let leftHasPrevious = false;
  for (const p of db.ast.getDescendants(left, $.primary)) {
    const fnName = getCallCalleeNode(db, p, $);
    if (fnName != 0) {
      if (db.ast.textEquals(fnName, "Clock")) {
        for (const arg of db.ast.getDescendants(p, $.function_argument)) {
          leftClockArg = arg;
          break;
        }
      } else if (db.ast.textEquals(fnName, "previous")) {
        leftHasPrevious = true;
      }
    }
  }

  let rightClockArg: u32 = 0;
  let rightHasPrevious = false;
  for (const p of db.ast.getDescendants(right, $.primary)) {
    const fnName = getCallCalleeNode(db, p, $);
    if (fnName != 0) {
      if (db.ast.textEquals(fnName, "Clock")) {
        for (const arg of db.ast.getDescendants(p, $.function_argument)) {
          rightClockArg = arg;
          break;
        }
      } else if (db.ast.textEquals(fnName, "previous")) {
        rightHasPrevious = true;
      }
    }
  }

  if (leftClockArg != 0 && rightClockArg != 0) {
    return !db.ast.textEqualsNode(leftClockArg, rightClockArg);
  }
  if ((leftClockArg != 0 && rightHasPrevious) || (rightClockArg != 0 && leftHasPrevious)) {
    return true;
  }
  return false;
}

/**
 * Checks if the second positional argument (factor) of subSample/superSample/shiftSample/backSample is <= 0.
 */
export function hasNonPositiveSampleFactor(db: CodeGraph, callNode: u32, $: any): boolean {
  let argIdx: u32 = 0;
  let secondArg: u32 = 0;
  for (const arg of db.ast.getDescendants(callNode, $.function_argument)) {
    let directCall: u32 = 0;
    for (const anc of db.ast.getAncestors(arg, 0, callNode)) {
      if (anc != arg) {
        const t = db.ast.getType(anc);
        if (t == $.function_call || (t == $.primary && getCallCalleeNode(db, anc, $) != 0)) {
          directCall = anc;
          break;
        }
      }
    }
    if (directCall != callNode) continue;
    argIdx++;
    if (argIdx == 2) {
      secondArg = arg;
      break;
    }
  }
  if (secondArg == 0) return false;
  if (db.ast.textEquals(secondArg, "0") || db.ast.startsWith(secondArg, "-")) {
    return true;
  }
  return false;
}

/**
 * Checks if previous() is applied to 'time' or a parameter/constant variable.
 */
export function isPreviousOnNonClocked(db: CodeGraph, callNode: u32, $: any): boolean {
  let firstArg: u32 = 0;
  for (const arg of db.ast.getDescendants(callNode, $.function_argument)) {
    firstArg = arg;
    break;
  }
  if (firstArg == 0) return false;
  if (db.ast.textEquals(firstArg, "time")) return true;
  let argId: u32 = 0;
  for (const id of db.ast.getDescendants(firstArg, $.identifier)) {
    argId = id;
    break;
  }
  if (argId == 0) return false;
  if (db.ast.textEquals(argId, "time")) return true;

  const encClass = getEnclosingClass(db, callNode, $);
  if (encClass == 0) return false;
  const decl = findDeclInClass(db, encClass, argId, $);
  if (decl == 0) return false;
  let compClause: u32 = 0;
  for (const anc of db.ast.getAncestors(decl, 0, encClass)) {
    if (db.ast.getType(anc) == $.component_clause) {
      compClause = anc;
      break;
    }
  }
  if (compClause == 0) return false;
  if (hasTypePrefix(db, compClause, "parameter", $) || hasTypePrefix(db, compClause, "constant", $)) {
    return true;
  }
  return false;
}

/**
 * Checks if an impure function is called inside a pure (non-impure) function.
 */
export function isImpureCalledInPureFunction(db: CodeGraph, callNode: u32, $: any): boolean {
  const name = getCallCalleeNode(db, callNode, $);
  if (name == 0) return false;
  const callerCls = getEnclosingClass(db, callNode, $);
  if (callerCls == 0) return false;
  if (!isClassKind(db, callerCls, "function") || isClassKind(db, callerCls, "impure")) return false;
  const calledCls = findClassByName(db, name, $);
  if (calledCls == 0) return false;
  return isClassKind(db, calledCls, "impure");
}

/**
 * Checks if an impure function is called inside a continuous equation_section (outside when_equation).
 */
export function isImpureCalledInEquationSection(db: CodeGraph, callNode: u32, $: any): boolean {
  let inEqSec = false;
  for (const anc of db.ast.getAncestors(callNode, 0)) {
    const t = db.ast.getType(anc);
    if (t == $.when_equation) return false;
    if (t == $.equation_section) inEqSec = true;
  }
  if (!inEqSec) return false;
  const name = getCallCalleeNode(db, callNode, $);
  if (name == 0) return false;
  const calledCls = findClassByName(db, name, $);
  if (calledCls == 0) return false;
  return isClassKind(db, calledCls, "impure");
}
