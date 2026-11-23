// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projects a NASA SINDA / SINDA-FLUINT thermal network to Modelica using
 * `Modelica.Thermal.HeatTransfer` components (`HeatCapacitor`, `FixedTemperature`,
 * `ThermalConductor`, `BodyRadiation`, `FixedHeatFlow`).
 */

import type { SindaModel } from "../types.js";

export interface SindaToModelicaOptions {
  modelName?: string;
}

function sanitizeIdent(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+/, "");
  if (!cleaned) return "SindaThermalNetwork";
  return /^[0-9]/.test(cleaned) ? `M_${cleaned}` : cleaned;
}

function formatNum(val: number): string {
  if (!Number.isFinite(val)) return "0.0";
  return Number.isInteger(val) ? `${val}.0` : String(val);
}

/**
 * Generates a complete Modelica model string using `Modelica.Thermal.HeatTransfer`.
 */
export function sindaToModelica(model: SindaModel, options?: SindaToModelicaOptions): string {
  const modelName = sanitizeIdent(options?.modelName ?? model.title);
  const abszro = model.options.abszro;

  const lines: string[] = [
    `model ${modelName}`,
    `  "Projected from NASA SINDA thermal network: ${model.title.replace(/"/g, "'")}"`,
    `  import HT = Modelica.Thermal.HeatTransfer;`,
    "",
  ];

  // Track the Modelica port reference for each node
  const nodePortRef = new Map<number, string>();

  // 1. Thermal nodes
  for (const node of model.nodes.values()) {
    const tK = node.initialTemp - abszro;
    if (node.kind === "boundary") {
      const compName = `bc_${node.id}`;
      lines.push(`  HT.Sources.FixedTemperature ${compName}(T = ${formatNum(tK)});`);
      nodePortRef.set(node.id, `${compName}.port`);
    } else if (node.kind === "diffusion") {
      const compName = `node_${node.id}`;
      lines.push(
        `  HT.Components.HeatCapacitor ${compName}(C = ${formatNum(node.capacitance)}, T(start = ${formatNum(tK)}, fixed = true));`,
      );
      nodePortRef.set(node.id, `${compName}.port`);
    } else {
      // Arithmetic node (zero capacitance thermal junction)
      const compName = `arith_${node.id}`;
      lines.push(`  HT.Interfaces.HeatPort_a ${compName}(T(start = ${formatNum(tK)}));`);
      nodePortRef.set(node.id, compName);
    }
  }

  lines.push("");

  // 2. Thermal conductors (linear & Stefan-Boltzmann radiation)
  for (const cond of model.conductors.values()) {
    if (cond.kind === "linear") {
      lines.push(`  HT.Components.ThermalConductor cond_${cond.id}(G = ${formatNum(cond.conductance)});`);
    } else {
      lines.push(`  HT.Components.BodyRadiation rad_${cond.id}(Gr = ${formatNum(cond.conductance)});`);
    }
  }

  // 3. Heat sources
  const aggSources = new Map<number, number>();
  for (const src of model.sources) {
    aggSources.set(src.nodeId, (aggSources.get(src.nodeId) ?? 0.0) + src.heatLoad);
  }
  if (aggSources.size > 0) {
    lines.push("");
    for (const [nodeId, q] of aggSources.entries()) {
      lines.push(`  HT.Sources.FixedHeatFlow src_${nodeId}(Q_flow = ${formatNum(q)});`);
    }
  }

  lines.push("");
  lines.push("equation");

  // 4. Connect conductors
  for (const cond of model.conductors.values()) {
    const portI = nodePortRef.get(cond.nodeI);
    const portJ = nodePortRef.get(cond.nodeJ);
    if (!portI || !portJ) continue;
    const compName = cond.kind === "linear" ? `cond_${cond.id}` : `rad_${cond.id}`;
    lines.push(`  connect(${portI}, ${compName}.port_a);`);
    lines.push(`  connect(${compName}.port_b, ${portJ});`);
  }

  // 5. Connect heat sources
  for (const nodeId of aggSources.keys()) {
    const port = nodePortRef.get(nodeId);
    if (!port) continue;
    lines.push(`  connect(src_${nodeId}.port, ${port});`);
  }

  lines.push(`end ${modelName};`);
  lines.push("");

  return lines.join("\n");
}
