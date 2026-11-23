// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for LLNL NEC-2 Wire Antenna Decks.
 *
 * Lowers a NEC-2 antenna into an equivalent series RLC resonant feedpoint circuit
 * directly inside `@modelscript/runtime`'s `IDaeBuilder` linear memory arena with
 * zero intermediate AST wrapper allocations:
 *   - L_ant * der(i_ant) = v_feed - (R_rad + R_loss) * i_ant - v_cap
 *   - C_ant * der(v_cap) = i_ant
 *   - p_rad = R_rad * i_ant * i_ant
 *   - i_feed = i_ant
 */

import { BinOp, Causality, EqKind, type IDaeBuilder, VarType, Variability } from "@modelscript/runtime";
import { extractEquivalentRlc } from "../solver/mom-solver.js";
import type { Nec2Deck, Nec2EquivalentRlc } from "../types.js";

export interface Nec2DaeLoweringOptions {
  /** Prefix for emitted DAE variable names (default: "ant") */
  prefix?: string | undefined;
  /** Reference characteristic impedance Z0 in Ohms (default: 50) */
  z0Ohm?: number | undefined;
  /** Optional pre-computed RLC parameters (avoids re-solving MoM if already computed) */
  rlc?: Nec2EquivalentRlc | undefined;
}

export interface Nec2DaeLoweringResult {
  stateVarIndices: number[];
  equationCount: number;
  variableMap: Map<string, number>;
  rlc: Nec2EquivalentRlc;
}

/**
 * Lowers a NEC-2 antenna deck's equivalent RLC resonant circuit directly into `IDaeBuilder`.
 */
export function lowerNec2ToDae(
  builder: IDaeBuilder,
  deck: Nec2Deck,
  options: Nec2DaeLoweringOptions = {},
): Nec2DaeLoweringResult {
  const prefix = options.prefix ?? "ant";
  const z0Ohm = options.z0Ohm ?? 50.0;
  const rlc = options.rlc ?? extractEquivalentRlc(deck, z0Ohm);

  const variableMap = new Map<string, number>();
  const stateVarIndices: number[] = [];
  let equationCount = 0;

  function addVar(name: string, variability: Variability, causality: Causality, startVal: number): number {
    const existing = builder.lookupVariable(name);
    if (existing !== -1) {
      variableMap.set(name, existing);
      return existing;
    }
    const idx = builder.addVariable(name, VarType.Real, variability, causality, startVal);
    variableMap.set(name, idx);
    return idx;
  }

  // Parameters
  const rRadVar = addVar(`${prefix}_R_rad`, Variability.Parameter, Causality.Local, rlc.rRadOhm);
  const rLossVar = addVar(`${prefix}_R_loss`, Variability.Parameter, Causality.Local, rlc.rLossOhm);
  const lAntVar = addVar(`${prefix}_L_ant`, Variability.Parameter, Causality.Local, rlc.lAntH);
  const cAntVar = addVar(`${prefix}_C_ant`, Variability.Parameter, Causality.Local, rlc.cAntF);
  addVar(`${prefix}_Z_0`, Variability.Parameter, Causality.Local, rlc.z0Ohm);
  addVar(`${prefix}_f_0`, Variability.Parameter, Causality.Local, rlc.frequencyMhz * 1e6);

  // Continuous states
  const iAntVar = addVar(`${prefix}_i_ant`, Variability.Continuous, Causality.Local, 0.0);
  const vCapVar = addVar(`${prefix}_v_cap`, Variability.Continuous, Causality.Local, 0.0);
  stateVarIndices.push(iAntVar, vCapVar);

  // Port & observable variables
  const vFeedVar = addVar(`${prefix}_v_feed`, Variability.Continuous, Causality.Input, 1.0);
  const iFeedVar = addVar(`${prefix}_i_feed`, Variability.Continuous, Causality.Output, 0.0);
  const pRadVar = addVar(`${prefix}_p_rad`, Variability.Continuous, Causality.Output, 0.0);

  // Eq 1: L_ant * der(i_ant) = v_feed - (R_rad + R_loss) * i_ant - v_cap
  const lhs1 = builder.addBinaryExpr(BinOp.Mul, builder.addName(lAntVar), builder.addDer(iAntVar));
  const rTot = builder.addBinaryExpr(BinOp.Add, builder.addName(rRadVar), builder.addName(rLossVar));
  const vRes = builder.addBinaryExpr(BinOp.Mul, rTot, builder.addName(iAntVar));
  const rhs1a = builder.addBinaryExpr(BinOp.Sub, builder.addName(vFeedVar), vRes);
  const rhs1 = builder.addBinaryExpr(BinOp.Sub, rhs1a, builder.addName(vCapVar));
  builder.addEquation(EqKind.Simple, lhs1, rhs1);
  equationCount++;

  // Eq 2: C_ant * der(v_cap) = i_ant
  const lhs2 = builder.addBinaryExpr(BinOp.Mul, builder.addName(cAntVar), builder.addDer(vCapVar));
  const rhs2 = builder.addName(iAntVar);
  builder.addEquation(EqKind.Simple, lhs2, rhs2);
  equationCount++;

  // Eq 3: p_rad = R_rad * (i_ant * i_ant)
  const iSq = builder.addBinaryExpr(BinOp.Mul, builder.addName(iAntVar), builder.addName(iAntVar));
  const rhs3 = builder.addBinaryExpr(BinOp.Mul, builder.addName(rRadVar), iSq);
  builder.addEquation(EqKind.Simple, builder.addName(pRadVar), rhs3);
  equationCount++;

  // Eq 4: i_feed = i_ant
  builder.addEquation(EqKind.Simple, builder.addName(iFeedVar), builder.addName(iAntVar));
  equationCount++;

  return {
    stateVarIndices,
    equationCount,
    variableMap,
    rlc,
  };
}
