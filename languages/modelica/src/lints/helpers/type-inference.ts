// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @module lints/helpers/type-inference
 *
 * Expression type inference, variable type lookup, function return type resolution, and enum range checks.
 */

import type { CodeGraph, u16, u32 } from "@modelscript/dsl";
import { findClassByName, findDeclInClass, resolveBasePrimitiveType } from "./class-lookup.js";
import { resolveComponentClassDefinition } from "./component-resolution.js";
import type { ModelicaGrammarSymbols } from "./constants.js";
import {
  TYPE_BOOLEAN,
  TYPE_CLOCK,
  TYPE_ENUM,
  TYPE_INTEGER,
  TYPE_REAL,
  TYPE_STRING,
  TYPE_UNKNOWN,
} from "./constants.js";
import {
  findComposition,
  getEnclosingClass,
  hasTypePrefix,
  isClassKind,
  isDescendantOfInnerClass,
  isDescendantOfSubscript,
  resolveComplexName,
} from "./cst-utils.js";

/**
 * Collects the direct argument expression CST nodes for a function call argument list `sib`.
 */
function getCallArguments(db: CodeGraph, sib: u32, $: ModelicaGrammarSymbols): u32[] {
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
 * Resolves the return type of a function called by name `funcNameNode`.
 */
export function resolveFunctionReturnType(db: CodeGraph, funcNameNode: u32, $: ModelicaGrammarSymbols): u16 {
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
 * Resolves the declared type (e.g. TYPE_REAL, TYPE_INTEGER, TYPE_BOOLEAN, TYPE_STRING, TYPE_CLOCK, or User-Defined Type)
 * of a variable identifier `identNode` in `classNode` or its inherited base classes.
 */
export function getVariableTypeInClass(db: CodeGraph, classNode: u32, identNode: u32, $: ModelicaGrammarSymbols): u16 {
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
function getVariableTypeInClassInternal(
  db: CodeGraph,
  classNode: u32,
  identNode: u32,
  $: ModelicaGrammarSymbols,
  depth: u32,
): u16 {
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
 * Resolves the declared type of a potentially dotted variable reference (e.g. `x` or `x.y`)
 * across the class hierarchy.
 */
export function getDottedVariableType(
  db: CodeGraph,
  enclosingClass: u32,
  compRefNode: u32,
  $: ModelicaGrammarSymbols,
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
      const nextClass = resolveComponentClassDefinition(db, currClass, id, $, 0);
      if (nextClass == 0) return TYPE_UNKNOWN;
      currClass = nextClass;
      idx++;
    }
  }

  return TYPE_UNKNOWN;
}

/**
 * Infers the basic variable type of an AST expression node.
 */
export function inferExprType(db: CodeGraph, exprNode: u32, $: ModelicaGrammarSymbols): u16 {
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

    // 1a-if. If expression: if <cond> then <thenExpr> [elseif ... then ...]* else <elseExpr>
    if (db.ast.textEquals(c1, "if")) {
      let curr = c1;
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

    // 1b. If node has an `operand` field (e.g. unary minus `-x` or `not b`)
    const operandChild = db.ast.getChildByFieldId(unwrapped, "operand");
    if (operandChild != 0) {
      const op = db.ast.getFirstChild(unwrapped);
      if (op != 0 && db.ast.textEquals(op, "not")) {
        const operandType = inferExprType(db, operandChild, $);
        if (operandType >= 0x8000) return operandType;
        return TYPE_BOOLEAN;
      }
      if (
        op != 0 &&
        (db.ast.textEquals(op, "-") ||
          db.ast.textEquals(op, "+") ||
          db.ast.textEquals(op, ".-") ||
          db.ast.textEquals(op, ".+"))
      ) {
        return inferExprType(db, operandChild, $);
      }
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
 * Checks if an expression node is a 3-part range (start : step : stop) over an enumeration type.
 */
export function isEnumStepRangeExpr(db: CodeGraph, exprNode: u32, $: ModelicaGrammarSymbols): boolean {
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
