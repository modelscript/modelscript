// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projection from SIMSCRIPT II.5 discrete-event simulation models to Modelica.
 *
 * Generates a continuous-time fluid-limit and Little's Law Modelica model
 * preserving resource capacities, arrival/service rates, utilization invariants,
 * queue dynamics, and TALLY/ACCUMULATE observables.
 */

import { inferResourceRates } from "../dae/lowering.js";
import type { SimscriptModel } from "../types.js";

function sanitizeIdent(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) ? `S_${cleaned}` : cleaned || "SimscriptModel";
}

/**
 * Projects a parsed `SimscriptModel` to valid Modelica source code.
 */
export function simscriptToModelica(model: SimscriptModel): string {
  const modelName = sanitizeIdent(model.name || "SimscriptModel");
  const resourceRates = inferResourceRates(model);
  const lines: string[] = [];

  lines.push(`model ${modelName}`);
  lines.push(`  "Projected from SIMSCRIPT II.5 discrete-event simulation model '${model.name}'"`);
  lines.push("");

  // Resource parameters and continuous states
  for (const [resName, info] of resourceRates) {
    const id = sanitizeIdent(resName);
    const cap = Math.max(1, info.capacity);
    const rho0 = Math.min(0.999, info.lambda / (cap * info.mu));
    const w0 = 1.0 / Math.max(1e-6, cap * info.mu - info.lambda);
    const l0 = info.lambda * w0;

    lines.push(`  // Resource: ${resName}`);
    lines.push(`  parameter Real U_${id} = ${cap.toFixed(1)} "Resource capacity U.${resName}";`);
    lines.push(`  parameter Real lambda_${id} = ${info.lambda.toFixed(6)} "Arrival rate";`);
    lines.push(`  parameter Real mu_${id} = ${info.mu.toFixed(6)} "Per-server service rate";`);
    lines.push(`  Real rho_${id}(start = ${rho0.toFixed(6)}) "Resource utilization";`);
    lines.push(`  Real busy_${id}(start = ${(rho0 * cap).toFixed(6)}) "Busy resource units N.X.${resName}";`);
    lines.push(`  Real Q_${id}(start = ${Math.max(0, l0 - rho0 * cap).toFixed(6)}) "Queue length N.Q.${resName}";`);
    lines.push(`  Real L_${id}(start = ${l0.toFixed(6)}) "Mean entities in system (Little's Law)";`);
    lines.push(`  Real W_${id}(start = ${w0.toFixed(6)}) "Mean time in system";`);
    lines.push("");
  }

  // TALLY and ACCUMULATE observables
  for (const st of model.preamble.stats) {
    const statId = sanitizeIdent(`${st.kind.toLowerCase()}_${st.statName}`);
    lines.push(`  Real ${statId}(start = 0.0) "${st.kind} ${st.measure} OF ${st.target}";`);
  }
  if (model.preamble.stats.length > 0) {
    lines.push("");
  }

  lines.push("equation");
  for (const [resName] of resourceRates) {
    const id = sanitizeIdent(resName);
    lines.push(`  rho_${id} * (U_${id} * mu_${id}) = lambda_${id};`);
    lines.push(`  busy_${id} = rho_${id} * U_${id};`);
    lines.push(`  L_${id} = lambda_${id} * W_${id};`);
    lines.push(`  der(Q_${id}) = lambda_${id} - busy_${id} * mu_${id};`);
  }

  for (const st of model.preamble.stats) {
    const statId = sanitizeIdent(`${st.kind.toLowerCase()}_${st.statName}`);
    const nxMatch = st.target.match(/^N\.X\.([A-Z0-9._]+)$/i);
    const nqMatch = st.target.match(/^N\.Q\.([A-Z0-9._]+)$/i);
    if (nxMatch && resourceRates.has(nxMatch[1]!.toUpperCase())) {
      lines.push(`  ${statId} = busy_${sanitizeIdent(nxMatch[1]!.toUpperCase())};`);
    } else if (nqMatch && resourceRates.has(nqMatch[1]!.toUpperCase())) {
      lines.push(`  ${statId} = Q_${sanitizeIdent(nqMatch[1]!.toUpperCase())};`);
    } else {
      lines.push(`  ${statId} = 0.0;`);
    }
  }

  lines.push(`end ${modelName};`);
  lines.push("");
  return lines.join("\n");
}
