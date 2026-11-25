// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @module lints/helpers/connections
 *
 * Connector compatibility, flow balance, connect-equation matching, and stream variable helpers.
 */

import type { CodeGraph, u32 } from "@modelscript/dsl";
import { findClassByName, findComponentClauseForIdent } from "./class-lookup.js";
import { resolveComponentClassDefinition } from "./component-resolution.js";
import type { ModelicaGrammarSymbols } from "./constants.js";
import { hasTypePrefix, isDescendantOfInnerClass, isDescendantOfSubscript } from "./cst-utils.js";

function getFlowVariableCountRecursive(
  db: CodeGraph,
  classDefNode: u32,
  $: ModelicaGrammarSymbols,
  visited: u32,
  depth: u32,
): u32 {
  if (classDefNode == 0 || depth > 20) return 0;
  if (db.set.has(visited, classDefNode)) return 0;
  db.set.add(visited, classDefNode);

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
        count += getFlowVariableCountRecursive(db, cls, $, visited, depth + 1);
      }
    }
  }

  return count;
}

/**
 * Counts flow variables in `classDefNode` or its base classes, guarding against extends cycles.
 */
export function getFlowVariableCount(db: CodeGraph, classDefNode: u32, $: ModelicaGrammarSymbols): u32 {
  if (classDefNode == 0) return 0;
  const span = db.ast.getTextSpan(classDefNode);
  const cached = db.ast.getCachedByName(0x44440000, span);
  if (cached >= 0) return cached as u32;
  const visited = db.set.create();
  const count = getFlowVariableCountRecursive(db, classDefNode, $, visited, 0);
  db.set.release(visited);
  db.ast.setCachedByName(0x44440000, span, count);
  return count;
}

/**
 * Checks if two connector classes are compatible for a connect() equation.
 */
export function isConnectorCompatible(db: CodeGraph, lhsClass: u32, rhsClass: u32, $: ModelicaGrammarSymbols): boolean {
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
 * Checks if there is a flow / non-flow mismatch between two connector classes.
 * Returns the mismatched declaration identifier node if found, otherwise 0.
 */
export function findFlowMismatchInConnectors(
  db: CodeGraph,
  lhsClass: u32,
  rhsClass: u32,
  $: ModelicaGrammarSymbols,
): u32 {
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
 * Checks whether a matching connect(ep1, ep2) exists in classNode or its inherited hierarchy.
 */
export function hasMatchingConnectEquation(
  db: CodeGraph,
  classNode: u32,
  ep1: u32,
  ep2: u32,
  $: ModelicaGrammarSymbols,
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

    const baseClass = findClassByName(db, typeSpec, $);
    if (baseClass != 0 && baseClass != classNode) {
      if (hasMatchingConnectEquation(db, baseClass, ep1, ep2, $)) return true;
    }
  }
  return false;
}

/**
 * Checks if a leaf component identifier `leafId` is declared with the `stream` prefix
 * inside `currClass` or any of its inherited base classes.
 */
function isLeafDeclaredStreamInClass(
  db: CodeGraph,
  currClass: u32,
  leafId: u32,
  $: ModelicaGrammarSymbols,
  depth: u32,
): boolean {
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
export function isStreamVariable(
  db: CodeGraph,
  enclosingClass: u32,
  varRefNode: u32,
  $: ModelicaGrammarSymbols,
): boolean {
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
 * Checks whether a component_reference has at least 3 non-subscript identifier segments
 * (e.g., `subcomp.port.h_outflow`), representing an inside connector stream access.
 * Direct `port.h_outflow` (2 segments) on an outside connector is legal per MLS §15.2.
 */
function isInsideConnectorStreamRef(db: CodeGraph, encClass: u32, crNode: u32, $: ModelicaGrammarSymbols): boolean {
  let idCount: u32 = 0;
  for (const id of db.ast.getDescendants(crNode, $.identifier)) {
    if (id != 0 && !isDescendantOfSubscript(db, id, crNode, $)) {
      idCount++;
      if (idCount >= 3) break;
    }
  }
  if (idCount < 3) return false;
  return isStreamVariable(db, encClass, crNode, $);
}

/**
 * Checks if a simple_equation accesses an inside connector's stream variable on its RHS
 * (e.g., `sub.port.h_outflow`) without an enclosing inStream() or actualStream() operator (MLS §15.2).
 * Direct reads on an outside connector (`port.h_outflow`) are allowed.
 */
export function getStreamMissingInStreamNode(db: CodeGraph, eqNode: u32, $: ModelicaGrammarSymbols): u32 {
  let lhs = db.ast.getFirstChild(eqNode);
  if (lhs == 0) return 0;
  let rhs: u32 = 0;
  let sib = db.ast.getNextSibling(lhs);
  while (sib != 0) {
    if (!db.ast.textEquals(sib, "=")) {
      rhs = sib;
      break;
    }
    sib = db.ast.getNextSibling(sib);
  }
  if (lhs == 0 || rhs == 0) return 0;

  // Ensure LHS is a single local scalar variable (not a dotted connector member assignment)
  let lhsIdCount: u32 = 0;
  for (const _id of db.ast.getDescendants(lhs, $.identifier)) {
    lhsIdCount++;
  }
  if (lhsIdCount != 1) return 0;

  // Skip if RHS contains any function call (such as inStream, actualStream, smooth, etc.)
  for (const _fc of db.ast.getDescendants(rhs, $.function_call)) return 0;
  for (const _fca of db.ast.getDescendants(rhs, $.function_call_args)) return 0;

  let encClass: u32 = 0;
  for (const cls of db.ast.getAncestors(eqNode)) {
    if (db.ast.getType(cls) == $.class_definition) {
      encClass = cls;
      break;
    }
  }
  if (encClass == 0) return 0;

  for (const cr of db.ast.getDescendants(rhs, $.component_reference)) {
    if (isInsideConnectorStreamRef(db, encClass, cr, $)) {
      return cr;
    }
  }
  if (isInsideConnectorStreamRef(db, encClass, rhs, $)) {
    return rhs;
  }
  return 0;
}

/**
 * Checks if a component_clause mixes 'stream' and 'flow' prefixes directly or via a short class base_prefix.
 */
export function isStreamMixedWithFlow(db: CodeGraph, compClause: u32, $: ModelicaGrammarSymbols): boolean {
  const isStream = hasTypePrefix(db, compClause, "stream", $);
  const isFlow = hasTypePrefix(db, compClause, "flow", $);
  if (!isStream && !isFlow) return false;
  if (isStream && isFlow) return true;

  let typeSpec: u32 = 0;
  for (const ts of db.ast.getDescendants(compClause, $.type_specifier)) {
    typeSpec = ts;
    break;
  }
  if (typeSpec == 0) return false;
  const targetCls = findClassByName(db, typeSpec, $);
  if (targetCls == 0) return false;

  if ($.base_prefix != 0) {
    for (const bp of db.ast.getDescendants(targetCls, $.base_prefix)) {
      if (isStream && db.ast.textEquals(bp, "flow")) return true;
      if (isFlow && db.ast.textEquals(bp, "stream")) return true;
    }
  }
  if ($.short_class_specifier != 0) {
    for (const scs of db.ast.getDescendants(targetCls, $.short_class_specifier)) {
      let ch = db.ast.getFirstChild(scs);
      while (ch != 0) {
        if (isStream && db.ast.textEquals(ch, "flow")) return true;
        if (isFlow && db.ast.textEquals(ch, "stream")) return true;
        ch = db.ast.getNextSibling(ch);
      }
    }
  }
  return false;
}
