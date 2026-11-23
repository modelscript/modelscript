// SPDX-License-Identifier: AGPL-3.0-or-later

import { getUnitConstants } from "../solver/hydraulics.js";
import { solveHec2Profile, type Hec2SolveOptions } from "../solver/standard-step.js";
import type { Hec2Deck } from "../types.js";

function sanitizeModelicaId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+/, "");
  if (!cleaned) return "Hec2ChannelModel";
  return /^[0-9]/.test(cleaned) ? `M_${cleaned}` : cleaned;
}

/**
 * Projects a HEC-2 open-channel hydraulics deck to a clean Modelica steady-state
 * Standard Step energy & continuity model.
 */
export function projectHec2ToModelica(
  deck: Hec2Deck,
  options: Hec2SolveOptions & { modelName?: string | undefined } = {},
): string {
  const profile = solveHec2Profile(deck, options);
  const { g, phi } = getUnitConstants(profile.units);
  const modelName = sanitizeModelicaId(options.modelName ?? deck.titles[0] ?? "Hec2WaterSurfaceProfile");

  const lines: string[] = [];
  lines.push(`model ${modelName}`);
  lines.push(`  // Projected from USACE HEC-2 deck (${profile.units} units)`);
  lines.push(`  constant Real g = ${g};`);
  lines.push(`  constant Real manning_phi = ${phi};`);
  lines.push(`  parameter Real Q_inflow = ${profile.discharge};`);
  lines.push("");

  for (let i = 0; i < profile.stations.length; i++) {
    const st = profile.stations[i]!;
    const tag = `s${i + 1}`;
    lines.push(`  // Cross-section SECNO = ${st.secno}`);
    lines.push(`  parameter Real A_${tag} = ${st.area.toFixed(6)};`);
    lines.push(`  parameter Real K_${tag} = ${st.conveyance.toFixed(6)};`);
    lines.push(`  parameter Real alpha_${tag} = ${st.alpha.toFixed(6)};`);
    lines.push(`  Real wsel_${tag}(start = ${st.wsel.toFixed(6)});`);
    lines.push(`  Real egl_${tag}(start = ${st.egl.toFixed(6)});`);
    lines.push(`  Real Q_${tag}(start = ${profile.discharge.toFixed(6)});`);
    lines.push(`  Real V_${tag}(start = ${st.velocity.toFixed(6)});`);
    lines.push(`  Real Sf_${tag}(start = ${st.frictionSlope.toExponential(6)});`);
  }

  lines.push("equation");
  for (let i = 0; i < profile.stations.length; i++) {
    const st = profile.stations[i]!;
    const tag = `s${i + 1}`;
    if (i === 0) {
      lines.push(`  Q_${tag} = Q_inflow;`);
      lines.push(`  wsel_${tag} = ${st.wsel.toFixed(6)};`);
    } else {
      const prevTag = `s${i}`;
      lines.push(`  Q_${tag} = Q_${prevTag};`);
      lines.push(`  egl_${tag} = egl_${prevTag} + ${st.headLoss.toFixed(8)};`);
    }
    lines.push(`  V_${tag} * A_${tag} = Q_${tag};`);
    lines.push(`  egl_${tag} = wsel_${tag} + alpha_${tag} * V_${tag} * V_${tag} / (2.0 * g);`);
    lines.push(`  Sf_${tag} = (Q_${tag} / K_${tag}) * (Q_${tag} / K_${tag});`);
  }

  lines.push(`end ${modelName};`);
  lines.push("");

  return lines.join("\n");
}
