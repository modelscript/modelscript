// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @module lints/helpers/class-lookup
 *
 * Class, declaration, member kind, redeclaration target, and base primitive type lookup across scopes and inheritance.
 */

import type { CodeGraph, u16, u32 } from "@modelscript/dsl";
import type { ModelicaGrammarSymbols } from "./constants.js";
import {
  MEMBER_CLASS,
  MEMBER_COMPONENT,
  MEMBER_NONE,
  MEMBER_RECORD_COMPONENT,
  TYPE_BOOLEAN,
  TYPE_CLOCK,
  TYPE_ENUM,
  TYPE_INTEGER,
  TYPE_REAL,
  TYPE_STRING,
  TYPE_UNKNOWN,
} from "./constants.js";
import { findComposition, isClassKind, isDescendantOfInnerClass } from "./cst-utils.js";

/**
 * Fast lookup for a declaration node matching targetId in classNode without scanning equations.
 */
export function findDeclInClass(db: CodeGraph, classNode: u32, targetId: u32, $: ModelicaGrammarSymbols): u32 {
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
function findDeclInClassInternal(db: CodeGraph, classNode: u32, targetId: u32, $: ModelicaGrammarSymbols): u32 {
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
export function findInnerClassInClass(db: CodeGraph, classNode: u32, targetId: u32, $: ModelicaGrammarSymbols): u32 {
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
 * Resolves a type specifier or identifier CST node to its matching `class_definition`
 * CST node in the current document (preferring top-level classes over nested classes).
 */
export function findClassByName(db: CodeGraph, typeSpecNode: u32, $: ModelicaGrammarSymbols): u32 {
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
 * Checks if `nameNode` matches a top-level class name declared in the document.
 */
export function isTopLevelClassName(db: CodeGraph, nameNode: u32, $: ModelicaGrammarSymbols): boolean {
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
function isTopLevelClassNameInternal(db: CodeGraph, nameNode: u32, $: ModelicaGrammarSymbols): boolean {
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
 * Extracts the declared identifier node from an `element_redeclaration` or `element_replaceable` CST node.
 */
export function getRedeclName(db: CodeGraph, node: u32, $: ModelicaGrammarSymbols): u32 {
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
function findTargetElementInClassRecursive(
  db: CodeGraph,
  targetClass: u32,
  redeclName: u32,
  $: ModelicaGrammarSymbols,
  depth: u32,
): u32 {
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
      // Declarations inside a nested class definition (e.g. `model Inner Real x; end Inner;`)
      // belong to that class, not to `targetClass`.
      if (isDescendantOfInnerClass(db, decl, targetClass, $)) continue;
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
export function findTargetElementInClass(
  db: CodeGraph,
  targetClass: u32,
  redeclName: u32,
  $: ModelicaGrammarSymbols,
): u32 {
  if (targetClass == 0 || redeclName == 0) return 0;
  const memoKind: u32 = targetClass ^ 0x88880000;
  const span = db.ast.getTextSpan(redeclName);
  const cached = db.ast.getCachedByName(memoKind, span);
  if (cached >= 0) return cached as u32;
  const res = findTargetElementInClassRecursive(db, targetClass, redeclName, $, 0);
  db.ast.setCachedByName(memoKind, span, res);
  return res;
}

/**
 * Recursively checks whether `classNode` or any of its inherited base classes
 * declares a component or inner class matching `targetId`.
 */
export function classContainsElementRecursive(
  db: CodeGraph,
  classNode: u32,
  targetId: u32,
  $: ModelicaGrammarSymbols,
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
 * Finds the component clause containing declaration of `identNode` in `classNode`.
 */
export function findComponentClauseForIdent(
  db: CodeGraph,
  classNode: u32,
  identNode: u32,
  $: ModelicaGrammarSymbols,
): u32 {
  for (const comp of db.ast.getDescendants(classNode, $.component_clause)) {
    if (isDescendantOfInnerClass(db, comp, classNode, $)) continue;
    for (const decl of db.ast.getDescendants(comp, $.declaration)) {
      let nameNode = db.ast.getChildByFieldId(decl, "name");
      if (nameNode == 0) {
        for (const id of db.ast.getDescendants(decl, $.identifier)) {
          nameNode = id;
          break;
        }
      }
      if (nameNode != 0 && db.ast.textEqualsNode(nameNode, identNode)) {
        return comp;
      }
    }
  }
  return 0;
}

/**
 * Resolves a type identifier (e.g. `Real`, `Concentration`, `Voltage`) to its primitive scalar type:
 * TYPE_REAL, TYPE_INTEGER, TYPE_BOOLEAN, TYPE_STRING, TYPE_CLOCK, or TYPE_UNKNOWN.
 */
export function resolveBasePrimitiveType(db: CodeGraph, typeNameId: u32, $: ModelicaGrammarSymbols): u16 {
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
function resolveBasePrimitiveTypeInternal(db: CodeGraph, typeNameId: u32, $: ModelicaGrammarSymbols, depth: u32): u16 {
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
 * Returns member kind in classNode or its inherited base classes:
 * MEMBER_NONE (0), MEMBER_COMPONENT (1), MEMBER_CLASS (2), or MEMBER_RECORD_COMPONENT (3).
 */
export function getMemberKindInClass(db: CodeGraph, classNode: u32, identNode: u32, $: ModelicaGrammarSymbols): u16 {
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
function getMemberKindInClassInternal(
  db: CodeGraph,
  classNode: u32,
  identNode: u32,
  $: ModelicaGrammarSymbols,
  depth: u32,
): u16 {
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
 * Checks if a variable identifier `identNode` is declared in `classNode` or any of its inherited base classes via `extends`.
 */
export function isVariableDeclaredInClass(
  db: CodeGraph,
  classNode: u32,
  identNode: u32,
  $: ModelicaGrammarSymbols,
): boolean {
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
