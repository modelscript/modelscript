// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/swmm — High-Fidelity Projection of SWMM Drainage Networks to Modelica 3.x.
 */

import type { SwmmDeck } from "../types.js";

export interface SwmmModelicaOptions {
  modelName?: string | undefined;
}

export function swmmToModelica(deck: SwmmDeck, options?: SwmmModelicaOptions): string {
  const modelName = (options?.modelName ?? deck.title ?? "StormwaterNetworkModel").replace(/[^a-zA-Z0-9_]/g, "_");
  const lines: string[] = [];

  lines.push(`model ${modelName}`);
  lines.push(`  "Acausal Modelica representation of US EPA SWMM 5.x stormwater network"`);
  lines.push("");
  lines.push("  import Modelica.Units.SI;");
  lines.push("");

  // Junctions
  lines.push("  // Hydraulic Junction Nodes");
  for (const [id, j] of deck.junctions) {
    lines.push(`  // Junction: ${id}`);
    lines.push(`  parameter SI.Length z_invert_${id} = ${j.elevation.toFixed(2)} "Invert elevation";`);
    lines.push(`  parameter SI.Length maxDepth_${id} = ${j.maxDepth.toFixed(2)} "Maximum depth";`);
    lines.push(
      `  parameter SI.Area aPond_${id} = ${Math.max(1.0, j.aPond && j.aPond > 0 ? j.aPond : 10.0).toFixed(2)} "Ponded surface area";`,
    );
    lines.push(`  SI.Length depth_${id}(start=${(j.initDepth ?? 0.2).toFixed(2)}) "Water depth";`);
    lines.push(`  SI.Length head_${id} "Total hydraulic head";`);
    lines.push(`  SI.VolumeFlowRate Q_in_${id} "Total nodal inflow";`);
    lines.push(`  SI.VolumeFlowRate Q_out_${id} "Total nodal outflow";`);
  }
  lines.push("");

  // Outfalls
  lines.push("  // Outfall Boundary Nodes");
  for (const [id, o] of deck.outfalls) {
    const stage = o.stage ?? (o.type === "FREE" ? 0.0 : 0.5);
    lines.push(`  // Outfall: ${id} (${o.type})`);
    lines.push(`  parameter SI.Length z_outfall_${id} = ${o.elevation.toFixed(2)} "Outfall invert elevation";`);
    lines.push(`  SI.Length depth_${id}(start=${stage.toFixed(2)}) "Outfall stage depth";`);
    lines.push(`  SI.Length head_${id}(start=${(o.elevation + stage).toFixed(2)}) "Tailwater head";`);
  }
  lines.push("");

  // Conduits
  lines.push("  // Conduits / Culverts / Open Channels");
  for (const [id, c] of deck.conduits) {
    const xsec = deck.crossSections.get(id);
    const D = xsec?.geom1 ?? 1.0;
    lines.push(`  // Conduit: ${id} (${c.inletNode} -> ${c.outletNode})`);
    lines.push(`  parameter SI.Length length_${id} = ${c.length.toFixed(2)} "Length";`);
    lines.push(`  parameter SI.Length diameter_${id} = ${D.toFixed(2)} "Diameter / Height";`);
    lines.push(`  parameter Real roughness_${id} = ${c.roughness.toFixed(4)} "Manning n";`);
    lines.push(`  SI.VolumeFlowRate Q_${id}(start=${(c.initFlow ?? 0.1).toFixed(3)}) "Discharge";`);
    lines.push(`  SI.Area A_${id} "Wetted cross-sectional area";`);
    lines.push(`  SI.Velocity V_${id} "Flow velocity";`);
    lines.push(`  Real Sf_${id} "Manning friction slope";`);
  }
  lines.push("");

  // Equations
  lines.push("equation");
  for (const [id] of deck.junctions) {
    lines.push(`  // Head and continuity equations for Junction ${id}`);
    lines.push(`  head_${id} = z_invert_${id} + depth_${id};`);

    let runoffInflow = 0.0;
    for (const [, sc] of deck.subcatchments) {
      if (sc.outlet === id) {
        runoffInflow += sc.area * (sc.impervPct / 100.0) * 0.05;
      }
    }
    const inTerms: string[] = [runoffInflow.toFixed(4)];
    const outTerms: string[] = ["0.0"];
    for (const [cId, c] of deck.conduits) {
      if (c.outletNode === id) inTerms.push(`Q_${cId}`);
      if (c.inletNode === id) outTerms.push(`Q_${cId}`);
    }
    lines.push(`  Q_in_${id} = ${inTerms.join(" + ")};`);
    lines.push(`  Q_out_${id} = ${outTerms.join(" + ")};`);
    lines.push(`  aPond_${id} * der(depth_${id}) = Q_in_${id} - Q_out_${id};`);
  }

  for (const [id, o] of deck.outfalls) {
    const stage = o.stage ?? (o.type === "FREE" ? 0.0 : 0.5);
    lines.push(`  // Outfall boundary equations for ${id}`);
    lines.push(`  depth_${id} = ${stage.toFixed(2)};`);
    lines.push(`  head_${id} = z_outfall_${id} + depth_${id};`);
  }

  for (const [id, c] of deck.conduits) {
    lines.push(`  // Momentum drop and area/velocity relations across conduit ${id}`);
    lines.push(`  A_${id} = 0.785 * diameter_${id}^2;`);
    lines.push(`  Sf_${id} = (roughness_${id}^2 * abs(Q_${id}) * Q_${id}) / (0.196 * diameter_${id}^5.33);`);
    lines.push(
      `  head_${c.inletNode} - head_${c.outletNode} = length_${id} * (roughness_${id}^2 * abs(Q_${id}) * Q_${id}) / (0.196 * diameter_${id}^5.33);`,
    );
    lines.push(`  V_${id} = Q_${id} / A_${id};`);
  }

  lines.push("");
  lines.push(`end ${modelName};`);
  return lines.join("\n");
}
