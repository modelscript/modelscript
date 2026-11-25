// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @module lints/helpers/synchronous-clocks
 *
 * Synchronous clock domain, sampling factor, state machine transition, and function purity helpers.
 */

import type { CodeGraph, u32 } from "@modelscript/dsl";
import { findClassByName, findDeclInClass } from "./class-lookup.js";
import type { ModelicaGrammarSymbols } from "./constants.js";
import { getCallCalleeNode, getEnclosingClass, hasTypePrefix, isClassKind } from "./cst-utils.js";

/**
 * Checks if a binary expression directly mixes two different Clock(...) domains or sample() + previous().
 */
export function hasMixedClockDomains(db: CodeGraph, exprNode: u32, $: ModelicaGrammarSymbols): boolean {
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
 * Checks if the second positional argument (factor) of subSample/superSample/shiftSample/backSample is negative.
 * Factor `0` means an inferred factor per MLS §16.3 and is valid.
 */
export function hasNonPositiveSampleFactor(db: CodeGraph, callNode: u32, $: ModelicaGrammarSymbols): boolean {
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
  if (db.ast.startsWith(secondArg, "-") && !db.ast.textEquals(secondArg, "-0")) {
    return true;
  }
  return false;
}

/**
 * Checks if previous() is applied to 'time' or a parameter/constant variable.
 */
export function isPreviousOnNonClocked(db: CodeGraph, callNode: u32, $: ModelicaGrammarSymbols): boolean {
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
function isInsidePureOperator(db: CodeGraph, callNode: u32, $: ModelicaGrammarSymbols): boolean {
  for (const anc of db.ast.getAncestors(callNode, 0)) {
    const t = db.ast.getType(anc);
    if (t == $.function_call || t == $.primary || t == $.lhs_primary) {
      if (
        db.ast.startsWith(anc, "pure(") ||
        db.ast.startsWith(anc, "pure ") ||
        db.ast.startsWith(anc, "pure\t") ||
        db.ast.startsWith(anc, "pure\n")
      ) {
        return true;
      }
      const ancCallee = getCallCalleeNode(db, anc, $);
      if (ancCallee != 0 && db.ast.textEquals(ancCallee, "pure")) {
        return true;
      }
    }
  }
  return false;
}

export function isImpureCalledInPureFunction(db: CodeGraph, callNode: u32, $: ModelicaGrammarSymbols): boolean {
  if (isInsidePureOperator(db, callNode, $)) return false;
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
 * Checks if an impure function is called inside a continuous equation_section (outside when_equation and initial equation).
 */
export function isImpureCalledInEquationSection(db: CodeGraph, callNode: u32, $: ModelicaGrammarSymbols): boolean {
  if (isInsidePureOperator(db, callNode, $)) return false;
  let inEqSec = false;
  for (const anc of db.ast.getAncestors(callNode, 0)) {
    const t = db.ast.getType(anc);
    if (t == $.when_equation) return false;
    if (t == $.equation_section) {
      if (db.ast.startsWith(anc, "initial")) return false;
      inEqSec = true;
    }
  }
  if (!inEqSec) return false;
  const name = getCallCalleeNode(db, callNode, $);
  if (name == 0) return false;
  const calledCls = findClassByName(db, name, $);
  if (calledCls == 0) return false;
  return isClassKind(db, calledCls, "impure");
}

/**
 * Extracts a direct argument of `callNode` by either 1-based positional index `posIndex` (skipping
 * any `named_argument` slots) or by named argument name `namedKey`.
 */
function getCallArg(db: CodeGraph, callNode: u32, posIndex: u32, namedKey: string, $: ModelicaGrammarSymbols): u32 {
  if (callNode == 0) return 0;
  if ($.named_argument != 0) {
    for (const na of db.ast.getDescendants(callNode, $.named_argument)) {
      let directCall: u32 = 0;
      for (const anc of db.ast.getAncestors(na, 0, callNode)) {
        if (anc == na) continue;
        const t = db.ast.getType(anc);
        if (t == $.function_call || (t == $.primary && getCallCalleeNode(db, anc, $) != 0)) {
          directCall = anc;
          break;
        }
      }
      if (directCall != callNode) continue;
      let nameId = db.ast.getChildByFieldId(na, "name");
      if (nameId == 0) {
        for (const id of db.ast.getDescendants(na, $.identifier)) {
          nameId = id;
          break;
        }
      }
      if (nameId != 0 && db.ast.textEquals(nameId, namedKey)) {
        const val = db.ast.getChildByFieldId(na, "value");
        if (val != 0) return val;
        let last: u32 = 0;
        let ch = db.ast.getFirstChild(na);
        while (ch != 0) {
          last = ch;
          ch = db.ast.getNextSibling(ch);
        }
        return last;
      }
    }
  }
  if ($.function_argument != 0 && posIndex > 0) {
    let idx: u32 = 0;
    for (const arg of db.ast.getDescendants(callNode, $.function_argument)) {
      let isNamedOrNested = false;
      let directCall: u32 = 0;
      for (const anc of db.ast.getAncestors(arg, 0, callNode)) {
        if (anc == arg) continue;
        const t = db.ast.getType(anc);
        if ($.named_argument != 0 && t == $.named_argument) {
          isNamedOrNested = true;
          break;
        }
        if (t == $.function_call || (t == $.primary && getCallCalleeNode(db, anc, $) != 0)) {
          directCall = anc;
          break;
        }
      }
      if (isNamedOrNested || directCall != callNode) continue;
      idx++;
      if (idx == posIndex) return arg;
    }
  }
  return 0;
}

/**
 * Checks if a `transition(from, to, condition, immediate, reset, synchronize, priority)` call
 * (MLS §17.3.2) has an invalid priority (<= 0) or duplicate priority from the same source state.
 */
export function getInvalidTransitionPriorityNode(db: CodeGraph, callNode: u32, $: ModelicaGrammarSymbols): u32 {
  const name = getCallCalleeNode(db, callNode, $);
  if (name == 0 || !db.ast.textEquals(name, "transition")) return 0;

  // MLS §17.3.2: parameter 7 is `priority` (parameter 4 is `immediate`).
  const prioArg = getCallArg(db, callNode, 7, "priority", $);
  if (prioArg != 0 && (db.ast.textEquals(prioArg, "0") || db.ast.startsWith(prioArg, "-"))) {
    return prioArg;
  }

  const fromArg = getCallArg(db, callNode, 1, "from", $);
  if (fromArg != 0 && prioArg != 0 && $.equation_section != 0) {
    for (const anc of db.ast.getAncestors(callNode, 0)) {
      if (db.ast.getType(anc) == $.equation_section) {
        for (const fc of db.ast.getDescendants(anc, $.function_call)) {
          if (fc == callNode) continue;
          const fn = getCallCalleeNode(db, fc, $);
          if (fn == 0 || !db.ast.textEquals(fn, "transition")) continue;
          const from2 = getCallArg(db, fc, 1, "from", $);
          const prio2 = getCallArg(db, fc, 7, "priority", $);
          if (
            from2 != 0 &&
            prio2 != 0 &&
            db.ast.textEqualsNode(fromArg, from2) &&
            db.ast.textEqualsNode(prioArg, prio2)
          ) {
            return prioArg;
          }
        }
        break;
      }
    }
  }
  return 0;
}

/**
 * Checks if firstTick() or interval() is applied to continuous 'time', a numeric literal, or a parameter/constant variable.
 */
export function getNonClockedOperatorArgNode(db: CodeGraph, callNode: u32, $: ModelicaGrammarSymbols): u32 {
  let firstArg: u32 = 0;
  for (const arg of db.ast.getDescendants(callNode, $.function_argument)) {
    firstArg = arg;
    break;
  }
  if (firstArg == 0) return 0;
  if (isPreviousOnNonClocked(db, callNode, $)) return firstArg;
  for (const _num of db.ast.getDescendants(firstArg, $.unsigned_number)) {
    let hasId = false;
    for (const _id of db.ast.getDescendants(firstArg, $.identifier)) {
      hasId = true;
      break;
    }
    if (!hasId) return firstArg;
  }
  return 0;
}
