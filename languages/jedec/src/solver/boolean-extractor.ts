// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PAL/GAL Fuse-Matrix Sum-of-Products (SOP) Boolean Equation Extractor & Fuse Utilization Analyzer.
 */

import type {
  JedecBooleanExtractionResult,
  JedecDocument,
  JedecFuseUtilization,
  JedecOutputEquation,
  JedecProductLiteral,
  JedecProductTerm,
} from "../types.js";
import { getJedecDeviceProfile, type JedecDeviceProfile } from "./device-profiles.js";

/**
 * Encodes a single AND-array product term row into a 0/1 fuse bit-string for the given device profile.
 *
 * - `literals`: list of `{ pin, negated }` literals to connect (fuse = `0`).
 * - Pass `literals = "ALWAYS_TRUE"` for an all-`1` row (always active, e.g. OE enabled).
 * - Pass `literals = "ALWAYS_FALSE"` for an all-`0` row (unused / disabled term).
 */
export function encodeProductTermRow(
  profile: JedecDeviceProfile,
  literals: ReadonlyArray<{ pin: number; negated?: boolean }> | "ALWAYS_TRUE" | "ALWAYS_FALSE",
): string {
  const cols = profile.matrixCols;
  if (literals === "ALWAYS_TRUE") {
    return "1".repeat(cols);
  }
  if (literals === "ALWAYS_FALSE") {
    return "0".repeat(cols);
  }

  // Start with all fuses blown (1 = don't care / disconnected)
  const bits = new Uint8Array(cols);
  bits.fill(1);

  for (const lit of literals) {
    const pair = profile.columnPairs.find((p) => p.pin === lit.pin);
    if (!pair) continue;
    const col = lit.negated ? pair.compCol : pair.trueCol;
    if (col >= 0 && col < cols) {
      bits[col] = 0; // Intact fuse connects literal to AND gate
    }
  }

  let out = "";
  for (let i = 0; i < cols; i++) {
    out += bits[i] ? "1" : "0";
  }
  return out;
}

/**
 * Extracts a single product term from `fuses` at `rowIndex`.
 */
function extractProductTerm(
  fuses: Uint8Array,
  profile: JedecDeviceProfile,
  rowIndex: number,
  localIndex: number,
  isOutputEnable: boolean,
): JedecProductTerm {
  const cols = profile.matrixCols;
  const base = rowIndex * cols;

  let allZero = true;
  let allOne = true;
  let hasContradiction = false;
  const literals: JedecProductLiteral[] = [];

  for (const pair of profile.columnPairs) {
    const tBit = base + pair.trueCol < fuses.length ? (fuses[base + pair.trueCol] ?? 0) : 0;
    const cBit = base + pair.compCol < fuses.length ? (fuses[base + pair.compCol] ?? 0) : 0;

    if (tBit !== 0 || cBit !== 0) allZero = false;
    if (tBit !== 1 || cBit !== 1) allOne = false;

    if (tBit === 0 && cBit === 0) {
      // Both X and !X intact => X & !X = 0 (product term disabled)
      hasContradiction = true;
    } else if (tBit === 0 && cBit === 1) {
      literals.push({ pin: pair.pin, signalName: pair.signalName, negated: false });
    } else if (tBit === 1 && cBit === 0) {
      literals.push({ pin: pair.pin, signalName: pair.signalName, negated: true });
    }
    // tBit === 1 && cBit === 1 => don't care
  }

  const alwaysFalse = allZero || hasContradiction;
  const alwaysTrue = !alwaysFalse && allOne;

  let expression: string;
  if (alwaysFalse) {
    expression = "0";
  } else if (alwaysTrue) {
    expression = "1";
  } else {
    expression = literals.map((l) => (l.negated ? `!${l.signalName}` : l.signalName)).join(" & ");
  }

  return {
    rowIndex,
    localIndex,
    isOutputEnable,
    alwaysFalse,
    alwaysTrue,
    literals: alwaysFalse || alwaysTrue ? [] : literals,
    expression,
  };
}

/**
 * Computes fuse utilization statistics for a `JedecDocument`.
 */
export function computeFuseUtilization(
  doc: JedecDocument,
  equations?: readonly JedecOutputEquation[],
): JedecFuseUtilization {
  const totalFuses = doc.fuses.length;
  let intactFuses = 0;
  let blownFuses = 0;
  for (let i = 0; i < totalFuses; i++) {
    if (doc.fuses[i] === 0) intactFuses++;
    else blownFuses++;
  }

  let totalProductTerms = 0;
  let usedProductTerms = 0;
  let alwaysTrueTerms = 0;
  let disabledProductTerms = 0;
  let activeOutputs = 0;

  if (equations) {
    for (const eq of equations) {
      if (eq.activeTerms.length > 0 || (eq.oeTerm && !eq.oeTerm.alwaysFalse)) {
        activeOutputs++;
      }
      for (const term of eq.allTerms) {
        totalProductTerms++;
        if (term.alwaysFalse) {
          disabledProductTerms++;
        } else if (term.alwaysTrue) {
          alwaysTrueTerms++;
          usedProductTerms++;
        } else {
          usedProductTerms++;
        }
      }
    }
  }

  return {
    totalFuses,
    intactFuses,
    blownFuses,
    intactRatio: totalFuses > 0 ? intactFuses / totalFuses : 0,
    blownRatio: totalFuses > 0 ? blownFuses / totalFuses : 0,
    totalProductTerms,
    usedProductTerms,
    alwaysTrueTerms,
    disabledProductTerms,
    activeOutputs,
  };
}

/**
 * Extracts PAL/GAL Sum-of-Products (SOP) Boolean equations and fuse utilization from a `JedecDocument`.
 */
export function extractJedecEquations(
  doc: JedecDocument,
  profileOverride?: JedecDeviceProfile,
): JedecBooleanExtractionResult {
  const profile = profileOverride ?? getJedecDeviceProfile(doc);
  const equations: JedecOutputEquation[] = [];

  for (const mc of profile.macrocells) {
    const allTerms: JedecProductTerm[] = [];
    let oeTerm: JedecProductTerm | undefined;
    const activeTerms: JedecProductTerm[] = [];

    for (let localIdx = 0; localIdx < mc.rowCount; localIdx++) {
      const rowIndex = mc.startRow + localIdx;
      const isOe = mc.hasOeRow && localIdx === 0;
      const term = extractProductTerm(doc.fuses, profile, rowIndex, localIdx, isOe);
      allTerms.push(term);
      if (isOe) {
        oeTerm = term;
      } else if (!term.alwaysFalse) {
        activeTerms.push(term);
      }
    }

    // Determine output polarity (GAL16V8/GAL22V10 XOR fuse: 0 = active-low, 1 = active-high)
    let activeLow = mc.defaultActiveLow;
    if (mc.xorFuseAddress !== undefined && mc.xorFuseAddress < doc.fuses.length) {
      activeLow = doc.fuses[mc.xorFuseAddress] === 0;
    }

    let sopExpr: string;
    if (activeTerms.length === 0) {
      sopExpr = "0";
    } else if (activeTerms.some((t) => t.alwaysTrue)) {
      sopExpr = "1";
    } else if (activeTerms.length === 1) {
      sopExpr = activeTerms[0]?.expression ?? "0";
    } else {
      sopExpr = activeTerms.map((t) => `(${t.expression})`).join(" | ");
    }

    let rhsExpr: string;
    if (activeLow) {
      if (sopExpr === "0") rhsExpr = "1";
      else if (sopExpr === "1") rhsExpr = "0";
      else rhsExpr = `!(${sopExpr})`;
    } else {
      rhsExpr = sopExpr;
    }

    const equation = `${mc.signalName} = ${rhsExpr}`;

    equations.push({
      outputIndex: mc.outputIndex,
      pin: mc.pin,
      signalName: mc.signalName,
      activeLow,
      oeTerm,
      activeTerms,
      allTerms,
      equation,
    });
  }

  const utilization = computeFuseUtilization(doc, equations);

  return {
    deviceName: profile.deviceName,
    pinCount: profile.pinCount,
    matrixRows: profile.matrixRows,
    matrixCols: profile.matrixCols,
    inputPins: [...profile.dedicatedInputPins],
    outputPins: [...profile.outputPins],
    equations,
    utilization,
  };
}

/**
 * Evaluates a single product term given a map of `pin -> boolean` input logic levels.
 */
export function evaluateProductTerm(term: JedecProductTerm, pinStates: ReadonlyMap<number, boolean>): boolean {
  if (term.alwaysFalse) return false;
  if (term.alwaysTrue) return true;
  for (const lit of term.literals) {
    const val = pinStates.get(lit.pin) ?? false;
    const litVal = lit.negated ? !val : val;
    if (!litVal) return false;
  }
  return true;
}

/**
 * Evaluates an extracted `JedecOutputEquation` for a given pin state map.
 * Returns `"H"` (logic 1), `"L"` (logic 0), or `"Z"` (high-impedance when OE is false).
 */
export function evaluateOutputEquation(
  eq: JedecOutputEquation,
  pinStates: ReadonlyMap<number, boolean>,
): "H" | "L" | "Z" {
  if (eq.oeTerm) {
    const oeActive = evaluateProductTerm(eq.oeTerm, pinStates);
    if (!oeActive) return "Z";
  }

  let sop = false;
  for (const term of eq.activeTerms) {
    if (evaluateProductTerm(term, pinStates)) {
      sop = true;
      break;
    }
  }

  const outBit = eq.activeLow ? !sop : sop;
  return outBit ? "H" : "L";
}
