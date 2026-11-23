// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projection from LLNL NEC-2 wire antenna decks to Modelica equivalent RLC resonant circuit models.
 */

import { extractEquivalentRlc } from "../solver/mom-solver.js";
import type { Nec2Deck, Nec2EquivalentRlc } from "../types.js";

export interface Nec2ModelicaOptions {
  /** Modelica model identifier (default: sanitized deck title) */
  modelName?: string | undefined;
  /** Reference impedance Z0 in Ohms (default: 50) */
  z0Ohm?: number | undefined;
  /** Optional pre-computed RLC parameters */
  rlc?: Nec2EquivalentRlc | undefined;
}

function sanitizeModelicaName(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+/, "");
  if (cleaned.length === 0) return "Nec2Antenna";
  return /^[0-9]/.test(cleaned) ? `Antenna_${cleaned}` : cleaned;
}

/**
 * Projects a NEC-2 antenna deck to a self-contained Modelica equivalent resonant RLC circuit model.
 */
export function nec2ToModelica(deck: Nec2Deck, options: Nec2ModelicaOptions = {}): string {
  const modelName = sanitizeModelicaName(options.modelName ?? deck.title);
  const z0Ohm = options.z0Ohm ?? 50.0;
  const rlc = options.rlc ?? extractEquivalentRlc(deck, z0Ohm);

  return [
    `model ${modelName}`,
    `  "Equivalent RLC resonant antenna feedpoint circuit synthesized from NEC-2 MoM"`,
    `  parameter Real R_rad = ${rlc.rRadOhm.toPrecision(6)} "Radiation resistance [Ohm]";`,
    `  parameter Real R_loss = ${rlc.rLossOhm.toPrecision(6)} "Ohmic loss resistance [Ohm]";`,
    `  parameter Real L_ant = ${rlc.lAntH.toExponential(6)} "Equivalent antenna inductance [H]";`,
    `  parameter Real C_ant = ${rlc.cAntF.toExponential(6)} "Equivalent antenna capacitance [F]";`,
    `  parameter Real Z_0 = ${rlc.z0Ohm.toPrecision(4)} "Reference characteristic impedance [Ohm]";`,
    `  parameter Real f_0 = ${(rlc.frequencyMhz * 1e6).toExponential(6)} "Operating frequency [Hz]";`,
    `  input Real v_feed(start = 1.0) "Feedpoint excitation voltage [V]";`,
    `  output Real i_feed "Feedpoint current [A]";`,
    `  output Real p_rad "Instantaneous radiated power [W]";`,
    `  Real i_ant(start = 0.0) "Antenna series current [A]";`,
    `  Real v_cap(start = 0.0) "Equivalent capacitive voltage [V]";`,
    `equation`,
    `  L_ant * der(i_ant) = v_feed - (R_rad + R_loss) * i_ant - v_cap;`,
    `  C_ant * der(v_cap) = i_ant;`,
    `  p_rad = R_rad * i_ant * i_ant;`,
    `  i_feed = i_ant;`,
    `end ${modelName};`,
    "",
  ].join("\n");
}
