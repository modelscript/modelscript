// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @module lints/helpers/units
 *
 * SI unit attribute extraction and expression unit propagation helpers.
 */

import type { CodeGraph, u32 } from "@modelscript/dsl";
import type { SIUnit } from "../../units.js";
import { createDimensionless, parseUnit, unitDivide, unitMultiply, unitPower } from "../../units.js";
import { findDeclInClass } from "./class-lookup.js";
import type { ModelicaGrammarSymbols } from "./constants.js";
import { findComposition, isDescendantOfInnerClass } from "./cst-utils.js";

/**
 * Resolves the declared or inferred SI unit for a component declaration or clause.
 */
export function getComponentUnit(db: CodeGraph, compNode: u32, $: ModelicaGrammarSymbols): SIUnit | null {
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
        // Fallback: parse arbitrary unit string when inside an element_modification for `unit`
        let inUnitMod = false;
        for (const anc of db.ast.getAncestors(str, 0)) {
          if (anc == compNode) break;
          if (db.ast.getType(anc) == $.element_modification) {
            if (db.ast.startsWith(anc, "unit")) {
              inUnitMod = true;
            }
            break;
          }
        }
        if (inUnitMod) {
          const strId = db.scope.internNode(str);
          const pool = db.scope.pool;
          let off = pool.stringOffsets.get(strId);
          let len = pool.stringLengths.get(strId);
          if (len >= 2) {
            const firstCh = pool.charBuffer.get(off);
            const lastCh = pool.charBuffer.get(off + len - 1);
            if ((firstCh == 34 && lastCh == 34) || (firstCh == 39 && lastCh == 39)) {
              off += 1;
              len -= 2;
            }
          }
          let unitStr = "";
          for (let i: u32 = 0; i < len; i++) {
            unitStr += String.fromCharCode(pool.charBuffer.get(off + i));
          }
          matchedUnit = parseUnit(unitStr);
          if (matchedUnit != null) break;
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
  $: ModelicaGrammarSymbols,
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
export function hasUnitInClass(db: CodeGraph, classNode: u32, $: ModelicaGrammarSymbols): boolean {
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
export function inferExprUnit(
  db: CodeGraph,
  exprNode: u32,
  $: ModelicaGrammarSymbols,
  classNode: u32 = 0,
): SIUnit | null {
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
