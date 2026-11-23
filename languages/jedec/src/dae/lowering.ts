// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct Boolean Logic DAE Arena Lowering for JEDEC JESD3 PAL/GAL Fuse Maps.
 *
 * Lowers extracted PLD input pins, product terms, and sum-of-products (SOP) Boolean output
 * equations directly into `@modelscript/runtime`'s `IDaeBuilder` linear memory representation.
 */

import { BinOp, Causality, EqKind, type IDaeBuilder, UnaryOp, VarType, Variability } from "@modelscript/runtime";
import { extractJedecEquations } from "../solver/boolean-extractor.js";
import type { JedecDeviceProfile } from "../solver/device-profiles.js";
import type { JedecBooleanExtractionResult, JedecDocument, JedecProductTerm } from "../types.js";

export interface JedecDaeLoweringResult {
  extraction: JedecBooleanExtractionResult;
  variableMap: Map<string, number>;
  inputCount: number;
  outputCount: number;
  productTermCount: number;
  equationCount: number;
}

function lowerProductTermExpr(
  dae: IDaeBuilder,
  term: JedecProductTerm,
  pinVarIds: ReadonlyMap<number, number>,
): number {
  if (term.alwaysFalse) return dae.addBoolLiteral(false);
  if (term.alwaysTrue) return dae.addBoolLiteral(true);
  if (term.literals.length === 0) return dae.addBoolLiteral(true);

  let acc: number | undefined;
  for (const lit of term.literals) {
    const varId = pinVarIds.get(lit.pin);
    if (varId === undefined) continue;
    const baseExpr = dae.addName(varId);
    const litExpr = lit.negated ? dae.addUnaryExpr(UnaryOp.Not, baseExpr) : baseExpr;
    acc = acc === undefined ? litExpr : dae.addBinaryExpr(BinOp.And, acc, litExpr);
  }
  return acc ?? dae.addBoolLiteral(true);
}

/**
 * Lowers a parsed `JedecDocument` (PAL/GAL fuse map) into Boolean variables and equations
 * in `@modelscript/runtime`'s `IDaeBuilder`.
 */
export function lowerJedecToDae(
  doc: JedecDocument,
  dae: IDaeBuilder,
  profileOverride?: JedecDeviceProfile,
): JedecDaeLoweringResult {
  const extraction = extractJedecEquations(doc, profileOverride);
  const variableMap = new Map<string, number>();
  const pinVarIds = new Map<number, number>();

  // 1. Register dedicated input pins as Boolean inputs
  let inputCount = 0;
  for (const pin of extraction.inputPins) {
    const name = `I${pin}`;
    if (!variableMap.has(name)) {
      const varId = dae.addVariable(name, VarType.Boolean, Variability.Discrete, Causality.Input);
      variableMap.set(name, varId);
      pinVarIds.set(pin, varId);
      inputCount++;
    }
  }

  // Ensure any referenced literal pin (including bidirectional I/O feedback pins) has a variable
  for (const eq of extraction.equations) {
    for (const term of eq.allTerms) {
      for (const lit of term.literals) {
        if (!pinVarIds.has(lit.pin)) {
          let varId = variableMap.get(lit.signalName);
          if (varId === undefined) {
            varId = dae.addVariable(lit.signalName, VarType.Boolean, Variability.Discrete, Causality.Input);
            variableMap.set(lit.signalName, varId);
            inputCount++;
          }
          pinVarIds.set(lit.pin, varId);
        }
      }
    }
  }

  // 2. Register output pins and lower each output's active product terms + SOP equation
  let outputCount = 0;
  let productTermCount = 0;
  let equationCount = 0;

  for (const eq of extraction.equations) {
    let outId = variableMap.get(eq.signalName);
    if (outId === undefined) {
      outId = dae.addVariable(eq.signalName, VarType.Boolean, Variability.Discrete, Causality.Output);
      variableMap.set(eq.signalName, outId);
      outputCount++;
    }

    // Lower each active product term as a local Boolean signal `pt_<rowIndex>`
    const ptNameExprs: number[] = [];
    for (const term of eq.activeTerms) {
      const ptName = `pt_${term.rowIndex}`;
      let ptId = variableMap.get(ptName);
      if (ptId === undefined) {
        ptId = dae.addVariable(ptName, VarType.Boolean, Variability.Discrete, Causality.Local);
        variableMap.set(ptName, ptId);
        productTermCount++;
      }
      const lhs = dae.addName(ptId);
      const rhs = lowerProductTermExpr(dae, term, pinVarIds);
      dae.addEquation(EqKind.Simple, lhs, rhs);
      equationCount++;
      ptNameExprs.push(dae.addName(ptId));
    }

    // Combine product terms via OR
    let sopExpr: number;
    if (ptNameExprs.length === 0) {
      sopExpr = dae.addBoolLiteral(false);
    } else {
      let acc = ptNameExprs[0]!;
      for (let i = 1; i < ptNameExprs.length; i++) {
        acc = dae.addBinaryExpr(BinOp.Or, acc, ptNameExprs[i]!);
      }
      sopExpr = acc;
    }

    const outRhs = eq.activeLow ? dae.addUnaryExpr(UnaryOp.Not, sopExpr) : sopExpr;
    dae.addEquation(EqKind.Simple, dae.addName(outId), outRhs);
    equationCount++;
  }

  return {
    extraction,
    variableMap,
    inputCount,
    outputCount,
    productTermCount,
    equationCount,
  };
}
