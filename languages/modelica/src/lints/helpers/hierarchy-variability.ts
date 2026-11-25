// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @module lints/helpers/hierarchy-variability
 *
 * Expression variability, inheritance cycle, partial/replaceable checks, inner/outer causality, and modification/when helpers.
 */

import type { CodeGraph, u32, u8 } from "@modelscript/dsl";
import { findClassByName, findDeclInClass, findInnerClassInClass, getMemberKindInClass } from "./class-lookup.js";
import type { ModelicaGrammarSymbols } from "./constants.js";
import {
  MEMBER_CLASS,
  VARIABILITY_CONSTANT,
  VARIABILITY_CONTINUOUS,
  VARIABILITY_DISCRETE,
  VARIABILITY_PARAMETER,
} from "./constants.js";
import {
  getCallCalleeNode,
  getClassNameNode,
  getEnclosingClass,
  hasElementOrTypePrefix,
  hasTypePrefix,
  isClassKind,
  isDescendantOfInnerClass,
  isElementProtected,
  isElementReplaceable,
  isOldFrontendActive,
} from "./cst-utils.js";

/**
 * Determines the variability of an expression.
 */
export function getExpressionVariability(db: CodeGraph, exprNode: u32, $: ModelicaGrammarSymbols): u8 {
  if (exprNode == 0) return VARIABILITY_CONSTANT;

  let result: u8 = VARIABILITY_CONSTANT;
  const enclosingClass = getEnclosingClass(db, exprNode, $);
  const inFunctionOrRecord =
    enclosingClass != 0 &&
    (isClassKind(db, enclosingClass, "function") ||
      isClassKind(db, enclosingClass, "record") ||
      isClassKind(db, enclosingClass, "package") ||
      isClassKind(db, enclosingClass, "type"));

  for (const ident of db.ast.getDescendants(exprNode, $.identifier)) {
    if (db.ast.textEquals(ident, "time") || db.ast.textEquals(ident, "der") || db.ast.textEquals(ident, "sample")) {
      return VARIABILITY_CONTINUOUS;
    }

    if (inFunctionOrRecord || enclosingClass == 0) continue;

    // Skip identifiers inside size(...) or ndims(...) calls (which have parameter/constant variability)
    let insideSizeOrNdims = false;
    let isCalleeOrNamedArg = false;
    for (const anc of db.ast.getAncestors(ident, 0)) {
      if (anc == exprNode) break;
      const ancType = db.ast.getType(anc);
      if (ancType == $.function_call || ancType == $.primary) {
        const fnField = getCallCalleeNode(db, anc, $);
        if (fnField != 0) {
          if (fnField == ident) {
            isCalleeOrNamedArg = true;
            break;
          }
          for (const d of db.ast.getDescendants(fnField, $.identifier)) {
            if (d == ident) {
              isCalleeOrNamedArg = true;
              break;
            }
          }
          if (isCalleeOrNamedArg) break;
          if (db.ast.textEquals(fnField, "size") || db.ast.textEquals(fnField, "ndims")) {
            insideSizeOrNdims = true;
            break;
          }
        }
      } else if (ancType == $.named_argument || ancType == $.element_modification) {
        const firstId = db.ast.getFirstChild(anc);
        if (firstId == ident) {
          isCalleeOrNamedArg = true;
          break;
        }
      } else if (ancType == $.for_index) {
        isCalleeOrNamedArg = true;
        break;
      } else if (ancType == $.component_reference) {
        // Only resolve simple (single-identifier) component references locally
        let idCount = 0;
        for (const _d of db.ast.getDescendants(anc, $.identifier)) {
          idCount++;
          if (idCount > 1) break;
        }
        if (idCount > 1) {
          isCalleeOrNamedArg = true;
          break;
        }
      }
    }
    if (insideSizeOrNdims || isCalleeOrNamedArg) continue;
    let isComprehensionLoopVar = false;
    if ($.for_index != 0) {
      for (const fi of db.ast.getDescendants(exprNode, $.for_index)) {
        for (const fiId of db.ast.getDescendants(fi, $.identifier)) {
          if (db.ast.textEqualsNode(ident, fiId)) {
            isComprehensionLoopVar = true;
            break;
          }
        }
        if (isComprehensionLoopVar) break;
      }
    }
    if (isComprehensionLoopVar) continue;

    const decl = findDeclInClass(db, enclosingClass, ident, $);
    if (decl != 0 && db.ast.getType(decl) == $.declaration) {
      for (const comp of db.ast.getAncestors(decl, 0)) {
        if (comp == enclosingClass) break;
        if (db.ast.getType(comp) == $.component_clause) {
          let varb: u8 = VARIABILITY_CONSTANT;
          let hasExplicitPrefix = false;
          for (const pfx of db.ast.getDescendants(comp, $.type_prefix)) {
            if (db.ast.textEquals(pfx, "constant")) {
              varb = VARIABILITY_CONSTANT;
              hasExplicitPrefix = true;
              break;
            }
            if (db.ast.textEquals(pfx, "parameter")) {
              varb = VARIABILITY_PARAMETER;
              hasExplicitPrefix = true;
              break;
            }
            if (db.ast.textEquals(pfx, "discrete")) {
              varb = VARIABILITY_DISCRETE;
              hasExplicitPrefix = true;
              break;
            }
          }
          if (!hasExplicitPrefix) {
            for (const ts of db.ast.getDescendants(comp, $.type_specifier)) {
              if (
                db.ast.textEquals(ts, "Real") ||
                db.ast.textEquals(ts, "Integer") ||
                db.ast.textEquals(ts, "Boolean") ||
                db.ast.textEquals(ts, "String")
              ) {
                varb = VARIABILITY_CONTINUOUS;
              }
              break;
            }
          }
          if (varb < result) {
            result = varb;
          }
          break;
        }
      }
    }
  }

  return result;
}

/**
 * Checks whether an extends_clause creates a direct or multi-hop inheritance cycle in the same scope.
 */
export function hasExtendsCycleInScope(db: CodeGraph, extNode: u32, $: ModelicaGrammarSymbols): boolean {
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
 * Checks if an extends_clause targets a replaceable inner class in an enclosing class or document.
 */
export function isReplaceableBaseClassInScope(db: CodeGraph, extNode: u32, $: ModelicaGrammarSymbols): boolean {
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
export function isPartialTypeComponentInScope(db: CodeGraph, compClause: u32, $: ModelicaGrammarSymbols): boolean {
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
export function isCardinalityClassArg(db: CodeGraph, callNode: u32, $: ModelicaGrammarSymbols): boolean {
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
 * Checks if an element_modification assigns a scalar literal to an array component without 'each'.
 */
export function isNonArrayScalarModification(db: CodeGraph, modNode: u32, $: ModelicaGrammarSymbols): boolean {
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
export function isDiscreteAssignedOutsideWhen(db: CodeGraph, eqNode: u32, $: ModelicaGrammarSymbols): boolean {
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
 * Checks if an outer component_clause has no matching inner declaration in a self-contained document.
 */
export function isMissingInnerInDocument(db: CodeGraph, compClause: u32, $: ModelicaGrammarSymbols): boolean {
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
 * Checks if an outer component_clause has conflicting input/output causality with a matching inner declaration.
 * Returns the inner identifier node if a conflict is found, or 0 otherwise.
 */
export function getInnerOuterCausalityConflictNode(db: CodeGraph, compClause: u32, $: ModelicaGrammarSymbols): u32 {
  const outerIsInput = hasTypePrefix(db, compClause, "input", $);
  const outerIsOutput = hasTypePrefix(db, compClause, "output", $);
  if (!outerIsInput && !outerIsOutput) return 0;
  if (!hasElementOrTypePrefix(db, compClause, "outer", $)) return 0;

  let outerId: u32 = 0;
  for (const decl of db.ast.getDescendants(compClause, $.declaration)) {
    for (const id of db.ast.getDescendants(decl, $.identifier)) {
      outerId = id;
      break;
    }
    if (outerId != 0) break;
  }
  if (outerId == 0) return 0;

  const root = db.ast.getRootNode();
  if (root == 0) return 0;
  const rootSpan = db.ast.getTextSpan(root);
  const hasAnyInnerCached = db.ast.getCachedByName(0x494e434b /* INCK */, rootSpan);
  if (hasAnyInnerCached == 0) return 0;

  const outerSpan = db.ast.getTextSpan(outerId);
  const dirMemoKind: u32 = outerIsInput ? 0x494f494e /* IOIN */ : 0x494f4f55; /* IOOU */
  const cachedMatch = db.ast.getCachedByName(dirMemoKind, outerSpan);
  if (cachedMatch >= 0) return cachedMatch as u32;

  let hasAnyInnerCausal: u32 = 0;
  let matchedNode: u32 = 0;
  for (const otherComp of db.ast.getDescendants(root, $.component_clause)) {
    if (otherComp == compClause) continue;
    if (!hasElementOrTypePrefix(db, otherComp, "inner", $)) continue;
    const innerIsInput = hasTypePrefix(db, otherComp, "input", $);
    const innerIsOutput = hasTypePrefix(db, otherComp, "output", $);
    if (!innerIsInput && !innerIsOutput) continue;
    hasAnyInnerCausal = 1;
    if ((outerIsInput && innerIsOutput) || (outerIsOutput && innerIsInput)) {
      for (const decl of db.ast.getDescendants(otherComp, $.declaration)) {
        for (const id of db.ast.getDescendants(decl, $.identifier)) {
          if (db.ast.textEqualsNode(id, outerId)) {
            matchedNode = id;
            break;
          }
          break;
        }
        if (matchedNode != 0) break;
      }
      if (matchedNode != 0) break;
    }
  }
  if (hasAnyInnerCached < 0) {
    db.ast.setCachedByName(0x494e434b /* INCK */, rootSpan, hasAnyInnerCausal);
  }
  db.ast.setCachedByName(dirMemoKind, outerSpan, matchedNode);
  return matchedNode;
}

/**
 * Checks if a protected parameter in a concrete, self-contained model with equations is never referenced.
 * Returns the parameter's identifier node if unused, or 0 otherwise.
 */
export function getUnusedProtectedParameterNode(db: CodeGraph, compClause: u32, $: ModelicaGrammarSymbols): u32 {
  if (!hasTypePrefix(db, compClause, "parameter", $)) return 0;
  if (!isElementProtected(db, compClause, $)) return 0;
  if (isOldFrontendActive(db, $)) return 0;

  let encClass: u32 = 0;
  for (const cls of db.ast.getAncestors(compClause)) {
    if (db.ast.getType(cls) == $.class_definition) {
      encClass = cls;
      break;
    }
  }
  if (encClass == 0) return 0;

  const classSpan = db.ast.getTextSpan(encClass);
  const eligCached = db.ast.getCachedByName(0x4e4f5052 /* NOPR */, classSpan);
  if (eligCached == 0) return 0;
  if (eligCached < 0) {
    let eligible: u32 = 1;
    if (isClassKind(db, encClass, "partial")) eligible = 0;
    else if (!isClassKind(db, encClass, "model") && !isClassKind(db, encClass, "block")) eligible = 0;
    if (eligible != 0) {
      for (const _ext of db.ast.getDescendants(encClass, $.extends_clause)) {
        eligible = 0;
        break;
      }
    }
    if (eligible != 0) {
      let hasEquation = false;
      for (const _eq of db.ast.getDescendants(encClass, $.simple_equation)) {
        hasEquation = true;
        break;
      }
      if (!hasEquation) eligible = 0;
    }
    db.ast.setCachedByName(0x4e4f5052 /* NOPR */, classSpan, eligible);
    if (eligible == 0) return 0;
  }

  let paramId: u32 = 0;
  for (const decl of db.ast.getDescendants(compClause, $.declaration)) {
    for (const id of db.ast.getDescendants(decl, $.identifier)) {
      paramId = id;
      break;
    }
    if (paramId != 0) break;
  }
  if (paramId == 0) return 0;

  let refCount: u32 = 0;
  for (const id of db.ast.getDescendants(encClass, $.identifier)) {
    if (db.ast.textEqualsNode(id, paramId)) {
      refCount++;
      if (refCount > 1) return 0;
    }
  }
  return refCount == 1 ? paramId : 0;
}

/**
 * Checks if a simple_equation inside a when_equation directly assigns to a continuous-time state variable
 * (a variable differentiated via der(x) in the enclosing class) instead of using reinit(x, expr).
 */
export function getContinuousStateInWhenNode(db: CodeGraph, eqNode: u32, $: ModelicaGrammarSymbols): u32 {
  let inWhen = false;
  for (const anc of db.ast.getAncestors(eqNode)) {
    if (db.ast.getType(anc) == $.when_equation) {
      inWhen = true;
      break;
    }
  }
  if (!inWhen) return 0;

  let lhs = db.ast.getChildByFieldId(eqNode, "lhs");
  if (lhs == 0) lhs = db.ast.getFirstChild(eqNode);
  if (lhs == 0) return 0;

  // Ignore function call equations such as reinit(x, ...), assert(...), terminate(...)
  if (db.ast.getType(lhs) == $.function_call || getCallCalleeNode(db, lhs, $) != 0) return 0;
  for (const _fc of db.ast.getDescendants(lhs, $.function_call)) return 0;
  for (const p of db.ast.getDescendants(lhs, $.primary)) {
    if (getCallCalleeNode(db, p, $) != 0) return 0;
  }

  let lhsIdCount: u32 = 0;
  let lhsId: u32 = 0;
  for (const id of db.ast.getDescendants(lhs, $.identifier)) {
    lhsIdCount++;
    if (lhsId == 0) lhsId = id;
  }
  if (lhsIdCount != 1 || lhsId == 0) return 0;

  let encClass: u32 = 0;
  for (const cls of db.ast.getAncestors(eqNode)) {
    if (db.ast.getType(cls) == $.class_definition) {
      encClass = cls;
      break;
    }
  }
  if (encClass == 0) return 0;

  // Check if lhsId is differentiated via der(lhsId) anywhere in encClass (either on LHS or RHS)
  if ($.lhs_primary != 0) {
    for (const lp of db.ast.getDescendants(encClass, $.lhs_primary)) {
      if (db.ast.startsWith(lp, "der(")) {
        for (const id of db.ast.getDescendants(lp, $.identifier)) {
          if (db.ast.textEqualsNode(id, lhsId)) {
            return lhsId;
          }
          break;
        }
      }
    }
  }
  for (const p of db.ast.getDescendants(encClass, $.primary)) {
    if (db.ast.startsWith(p, "der(")) {
      for (const id of db.ast.getDescendants(p, $.identifier)) {
        if (db.ast.textEqualsNode(id, lhsId)) {
          return lhsId;
        }
        break;
      }
    }
  }
  return 0;
}
