// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @module lints/helpers/component-resolution
 *
 * Component type resolution, dotted component reference resolution, and unresolved identifier diagnostics.
 */

import type { CodeGraph, u32 } from "@modelscript/dsl";
import {
  findClassByName,
  findDeclInClass,
  findInnerClassInClass,
  isVariableDeclaredInClass,
  resolveBasePrimitiveType,
} from "./class-lookup.js";
import type { ModelicaGrammarSymbols } from "./constants.js";
import { TYPE_ENUM, TYPE_UNKNOWN } from "./constants.js";
import { isDescendantOfInnerClass, isDescendantOfSubscript, isExpandableConnector } from "./cst-utils.js";

/**
 * Looks up the `type_specifier` CST node for component `identNode` declared in
 * `classNode` or inherited from its base classes.
 */
export function findComponentTypeInClass(
  db: CodeGraph,
  classNode: u32,
  identNode: u32,
  $: ModelicaGrammarSymbols,
): u32 {
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
function findComponentTypeInClassInternal(
  db: CodeGraph,
  classNode: u32,
  identNode: u32,
  $: ModelicaGrammarSymbols,
): u32 {
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
  $: ModelicaGrammarSymbols,
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
  $: ModelicaGrammarSymbols,
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
 * Resolves a potentially dotted component reference (e.g. `x.p1`) starting from `enclosingClass`
 * down to its leaf class definition (e.g. `Pin1`).
 */
export function resolveDottedComponentClass(
  db: CodeGraph,
  enclosingClass: u32,
  compRefNode: u32,
  $: ModelicaGrammarSymbols,
): u32 {
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
export function isDottedVariableDeclared(
  db: CodeGraph,
  enclosingClass: u32,
  compRefNode: u32,
  $: ModelicaGrammarSymbols,
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
export function findUnresolvedComponentIdent(
  db: CodeGraph,
  enclosingClass: u32,
  compRefNode: u32,
  $: ModelicaGrammarSymbols,
): u32 {
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
