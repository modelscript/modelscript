// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projects a GPSS discrete-event queuing model into clean, executable Modelica 3.x code
 * representing its continuous fluid-balance and Little's Law ($L = \lambda W$) equations.
 */

import type { GpssModel } from "../types.js";

function sanitizeId(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_");
}

function inferRates(model: GpssModel): { lambda: number; mu: number } {
  let genMean = 18.0;
  let advMean = 16.0;
  for (const b of model.blocks) {
    if (b.opcode === "GENERATE" && b.operands[0]) {
      const m = /^EXP\(([^)]+)\)$/i.exec(b.operands[0].trim());
      const v = Number(m ? m[1] : b.operands[0]);
      if (Number.isFinite(v) && v > 0) {
        genMean = v;
        break;
      }
    }
  }
  for (const b of model.blocks) {
    if (b.opcode === "ADVANCE" && b.operands[0]) {
      const m = /^EXP\(([^)]+)\)$/i.exec(b.operands[0].trim());
      const v = Number(m ? m[1] : b.operands[0]);
      if (Number.isFinite(v) && v > 0) {
        advMean = v;
        break;
      }
    }
  }
  return {
    lambda: 1.0 / Math.max(1e-9, genMean),
    mu: 1.0 / Math.max(1e-9, advMean),
  };
}

/**
 * Generates a Modelica 3.x model representing the GPSS queuing network's
 * fluid conservation equations, server utilizations, and Little's Law invariants.
 */
export function gpssToModelica(model: GpssModel): string {
  const modelName = sanitizeId(model.name || "GpssModel");
  const { lambda, mu } = inferRates(model);
  const lines: string[] = [];

  lines.push(`// Modelica projection generated from GPSS model: ${model.name}`);
  lines.push(
    `// Blocks: ${model.blocks.length}, Facilities: ${model.facilities.size}, Storages: ${model.storages.size}, Queues: ${model.queues.size}`,
  );
  lines.push(`model ${modelName}`);
  lines.push(`  parameter Real lambda = ${lambda.toFixed(6)} "Nominal transaction arrival rate";`);
  lines.push(`  parameter Real mu = ${mu.toFixed(6)} "Nominal service rate per server";`);

  if (model.facilities.size > 0) {
    lines.push("");
    lines.push("  // Single-server GPSS Facilities");
    for (const fac of model.facilities) {
      const id = sanitizeId(fac);
      lines.push(`  Real fac_${id}_rho "Facility ${fac} utilization";`);
      lines.push(`  Real fac_${id}_FR "Facility ${fac} utilization (permille)";`);
      lines.push(`  Real fac_${id}_Lq "Facility ${fac} mean queue length";`);
      lines.push(`  Real fac_${id}_Wq "Facility ${fac} mean waiting time";`);
      lines.push(`  Real fac_${id}_L "Facility ${fac} mean count in system";`);
      lines.push(`  Real fac_${id}_W "Facility ${fac} mean system time";`);
    }
  }

  if (model.storages.size > 0) {
    lines.push("");
    lines.push("  // Multi-server GPSS Storages");
    for (const [sName, sDef] of model.storages) {
      const id = sanitizeId(sName);
      const cap = Number.isFinite(sDef.capacity) && sDef.capacity > 0 ? sDef.capacity : 1;
      lines.push(`  parameter Real sto_${id}_capacity = ${cap} "Storage ${sName} capacity";`);
      lines.push(`  Real sto_${id}_S "Storage ${sName} average occupied units";`);
      lines.push(`  Real sto_${id}_R "Storage ${sName} remaining capacity";`);
      lines.push(`  Real sto_${id}_rho "Storage ${sName} utilization";`);
      lines.push(`  Real sto_${id}_SR "Storage ${sName} utilization (permille)";`);
    }
  }

  if (model.queues.size > 0) {
    lines.push("");
    lines.push("  // GPSS Waiting Queues (Fluid Conservation)");
    for (const qName of model.queues) {
      const id = sanitizeId(qName);
      lines.push(`  Real que_${id}_Q(start = 0.0) "Queue ${qName} fluid length";`);
      lines.push(`  Real que_${id}_inflow "Queue ${qName} arrival rate";`);
      lines.push(`  Real que_${id}_outflow "Queue ${qName} departure rate";`);
      lines.push(`  Real que_${id}_Wq "Queue ${qName} mean waiting time";`);
    }
  }

  lines.push("");
  lines.push("equation");

  for (const fac of model.facilities) {
    const id = sanitizeId(fac);
    lines.push(`  // Facility ${fac} M/M/1 & Little's Law equations`);
    lines.push(`  fac_${id}_rho = lambda / mu;`);
    lines.push(`  fac_${id}_FR = 1000.0 * fac_${id}_rho;`);
    lines.push(`  fac_${id}_Lq = (fac_${id}_rho * fac_${id}_rho) / max(1e-6, 1.0 - fac_${id}_rho);`);
    lines.push(`  fac_${id}_Wq = fac_${id}_Lq / lambda;`);
    lines.push(`  fac_${id}_W = fac_${id}_Wq + 1.0 / mu;`);
    lines.push(`  fac_${id}_L = lambda * fac_${id}_W;`);
  }

  for (const [sName] of model.storages) {
    const id = sanitizeId(sName);
    lines.push(`  // Storage ${sName} balance equations`);
    lines.push(`  sto_${id}_S = lambda / mu;`);
    lines.push(`  sto_${id}_rho = sto_${id}_S / sto_${id}_capacity;`);
    lines.push(`  sto_${id}_SR = 1000.0 * sto_${id}_rho;`);
    lines.push(`  sto_${id}_R = sto_${id}_capacity - sto_${id}_S;`);
  }

  for (const qName of model.queues) {
    const id = sanitizeId(qName);
    lines.push(`  // Queue ${qName} fluid conservation & Little's Law`);
    lines.push(`  que_${id}_inflow = lambda;`);
    lines.push(`  que_${id}_outflow = min(lambda, mu);`);
    lines.push(`  der(que_${id}_Q) = que_${id}_inflow - que_${id}_outflow;`);
    lines.push(`  que_${id}_Q = que_${id}_inflow * que_${id}_Wq;`);
  }

  lines.push(`end ${modelName};`);
  lines.push("");
  return lines.join("\n");
}
