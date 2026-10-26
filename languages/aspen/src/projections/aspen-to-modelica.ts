// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/aspen — High-Fidelity Projection of Aspen Flowsheets to Modelica 3.x.
 */

import type { AspenDeck } from "../types.js";

export interface AspenModelicaOptions {
  modelName?: string | undefined;
}

export function aspenToModelica(deck: AspenDeck, options?: AspenModelicaOptions): string {
  const modelName = (options?.modelName ?? deck.title ?? "AspenProcessModel").replace(/[^a-zA-Z0-9_]/g, "_");
  const lines: string[] = [];

  lines.push(`model ${modelName}`);
  lines.push(`  "Acausal Modelica representation synthesized from Aspen Plus flowsheet"`);
  lines.push("");
  lines.push("  import Modelica.Units.SI;");
  lines.push("");

  // Components list as string array annotation
  const compNames = Array.from(deck.components.keys());
  if (compNames.length > 0) {
    lines.push(`  // Chemical Species: ${compNames.join(", ")}`);
    lines.push(`  constant Integer nComponents = ${compNames.length};`);
    lines.push("");
  }

  // Declared equipment blocks
  lines.push("  // Equipment Block Declarations");
  for (const entry of deck.flowsheet) {
    const block = deck.blocks.get(entry.blockId);
    const bType = block?.type ?? "FLASH2";

    if (bType === "FLASH2" || bType === "FLASH3") {
      lines.push(`  // Flash Separator: ${entry.blockId}`);
      lines.push(`  SI.HeatFlowRate Q_${entry.blockId}(start=0.0) "Heat duty";`);
      lines.push(`  Real psi_${entry.blockId}(start=0.5, min=0.0, max=1.0) "Vapor molar fraction";`);
    } else if (bType === "PUMP") {
      const pres = Number(block?.params["PRES"] ?? 3.0);
      lines.push(`  // Centrifugal Pump: ${entry.blockId}`);
      lines.push(`  parameter SI.AbsolutePressure P_out_set_${entry.blockId} = ${pres * 1e5} "Discharge pressure";`);
      lines.push(`  SI.Power W_shaft_${entry.blockId}(start=15000.0) "Shaft mechanical power";`);
    } else if (bType === "RADFRAC") {
      const nStages = block?.nStages ?? 15;
      const rr = Number(block?.colSpecs?.["RR"] ?? 2.5);
      lines.push(`  // Fractionation Column: ${entry.blockId}`);
      lines.push(`  parameter Integer nStages_${entry.blockId} = ${nStages} "Number of theoretical stages";`);
      lines.push(`  parameter Real refluxRatio_${entry.blockId} = ${rr} "Molar reflux ratio";`);
      lines.push(`  SI.HeatFlowRate Q_cond_${entry.blockId}(start=-500000.0) "Condenser duty";`);
      lines.push(`  SI.HeatFlowRate Q_reb_${entry.blockId}(start=600000.0) "Reboiler duty";`);
    } else if (bType === "HEATX" || bType === "HEATER") {
      lines.push(`  // Heat Exchanger: ${entry.blockId}`);
      lines.push(`  SI.HeatFlowRate Q_transfer_${entry.blockId}(start=100000.0) "Heat transfer duty";`);
    }
  }
  lines.push("");

  // Streams state variables
  lines.push("  // Stream Variables");
  const allStreams = new Set<string>();
  for (const sId of deck.streams.keys()) allStreams.add(sId);
  for (const entry of deck.flowsheet) {
    for (const s of entry.inlets) allStreams.add(s);
    for (const s of entry.outlets) allStreams.add(s);
  }

  for (const sId of allStreams) {
    const sDef = deck.streams.get(sId);
    const flow = (sDef?.moleFlow ?? 100.0) / 3600.0; // kmol/hr -> kmol/s
    const tempK = (sDef?.temperature ?? 25.0) + 273.15;
    const presPa = (sDef?.pressure ?? 1.0) * 1e5;

    lines.push(`  // Stream ${sId}`);
    lines.push(`  SI.MolarFlowRate F_${sId}(start=${flow.toFixed(4)}) "Total molar flow rate";`);
    lines.push(`  SI.Temperature T_${sId}(start=${tempK.toFixed(2)}) "Stream temperature";`);
    lines.push(`  SI.AbsolutePressure P_${sId}(start=${presPa.toFixed(0)}) "Stream pressure";`);
    for (const comp of compNames) {
      const z = sDef?.moleFractions.get(comp) ?? 1.0 / compNames.length;
      lines.push(`  Real z_${sId}_${comp}(start=${z.toFixed(4)}, min=0.0, max=1.0) "${comp} mole fraction";`);
    }
  }
  lines.push("");

  // Equation section
  lines.push("equation");
  for (const entry of deck.flowsheet) {
    const block = deck.blocks.get(entry.blockId);
    const bType = block?.type ?? "FLASH2";

    if (bType === "FLASH2" || bType === "FLASH3") {
      const inS = entry.inlets[0] ?? "FEED";
      const vapS = entry.outlets[0] ?? `${entry.blockId}_VAP`;
      const liqS = entry.outlets[1] ?? `${entry.blockId}_LIQ`;

      lines.push(`  // Flash ${entry.blockId} Material Balances`);
      lines.push(`  F_${inS} = F_${vapS} + F_${liqS};`);
      lines.push(`  F_${vapS} = F_${inS} * psi_${entry.blockId};`);
      lines.push(`  T_${vapS} = T_${liqS};`);
      lines.push(`  P_${vapS} = P_${liqS};`);

      for (const comp of compNames) {
        lines.push(`  F_${inS} * z_${inS}_${comp} = F_${vapS} * z_${vapS}_${comp} + F_${liqS} * z_${liqS}_${comp};`);
      }
    } else if (bType === "PUMP") {
      const inS = entry.inlets[0] ?? `${entry.blockId}_IN`;
      const outS = entry.outlets[0] ?? `${entry.blockId}_OUT`;

      lines.push(`  // Pump ${entry.blockId} Balances`);
      lines.push(`  F_${outS} = F_${inS};`);
      lines.push(`  P_${outS} = P_out_set_${entry.blockId};`);
      lines.push(`  W_shaft_${entry.blockId} = F_${inS} * 0.018 * (P_${outS} - P_${inS});`);
    } else if (bType === "RADFRAC") {
      const inS = entry.inlets[0] ?? "FEED";
      const distS = entry.outlets[0] ?? "DISTIL";
      const bottS = entry.outlets[1] ?? "BOTT";

      lines.push(`  // RadFrac ${entry.blockId} Overall Balances`);
      lines.push(`  F_${inS} = F_${distS} + F_${bottS};`);
    }
  }

  lines.push("");
  lines.push(`end ${modelName};`);
  return lines.join("\n");
}
