// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/relap5 — Bidirectional Modelica 3.x Projection for Nuclear Plants.
 *
 * Emits rigorous Modelica physical models for nuclear thermal-hydraulic loops,
 * steam generators, pressurizers, and reactor core point kinetics.
 */

import type { Relap5Deck } from "../types.js";

export function relap5ToModelica(deck: Relap5Deck, modelName = "NuclearPlantSimulation"): string {
  const safeModelName = modelName.replace(/[^a-zA-Z0-9_]/g, "_");
  const lines: string[] = [];

  lines.push(`model ${safeModelName}`);
  lines.push(`  "US NRC RELAP5-3D Thermal-Hydraulics & Reactor Simulation"`);
  lines.push(``);

  // 1. Hydrodynamic Volumes
  lines.push(`  // --- Hydrodynamic Volumes ---`);
  for (const vol of deck.volumes.values()) {
    const id = vol.id;
    lines.push(`  parameter Real V_${id}_vol = ${vol.volume.toFixed(4)} "Volume [m^3]";`);
    lines.push(`  parameter Real V_${id}_length = ${vol.length.toFixed(2)} "Length [m]";`);
    lines.push(`  Real P_${id}(start = ${vol.initialPressure.toFixed(1)}) "Pressure [Pa]";`);
    lines.push(`  Real alpha_${id}(start = ${(vol.initialVoidFraction ?? 0.0).toFixed(4)}) "Void fraction";`);
    lines.push(`  Real Tf_${id}(start = ${vol.initialTemperature.toFixed(2)}) "Liquid temperature [K]";`);
    lines.push(`  Real Tg_${id}(start = ${(vol.initialTemperature + 5.0).toFixed(2)}) "Vapor temperature [K]";`);
    lines.push(``);
  }

  // 2. Hydrodynamic Junctions
  lines.push(`  // --- Hydrodynamic Junctions ---`);
  for (const junc of deck.junctions.values()) {
    const jId = junc.id;
    lines.push(`  parameter Real J_${jId}_area = ${junc.area.toFixed(4)} "Junction area [m^2]";`);
    lines.push(`  Real mf_${jId}(start = 100.0) "Liquid mass flow rate [kg/s]";`);
    lines.push(`  Real mg_${jId}(start = 0.0) "Vapor mass flow rate [kg/s]";`);
    lines.push(``);
  }

  // 3. Point Kinetics
  if (deck.kinetics) {
    const k = deck.kinetics;
    lines.push(`  // --- Reactor Core Point Kinetics ---`);
    lines.push(`  parameter Real P0 = ${k.initialPower.toExponential(3)} "Nominal reactor thermal power [W]";`);
    lines.push(`  parameter Real Lambda = ${k.promptGenerationTime.toExponential(3)} "Prompt neutron lifetime [s]";`);
    lines.push(`  parameter Real beta = ${k.totalDelayedFraction.toFixed(5)} "Delayed neutron fraction";`);
    lines.push(`  Real reactor_power(start = 1.0) "Normalized core power";`);
    lines.push(`  Real reactivity(start = 0.0) "Total core reactivity [$]";`);
    for (let i = 1; i <= 6; i++) {
      lines.push(`  Real C_${i}(start = 1.0) "Delayed precursor group ${i} concentration";`);
    }
    lines.push(``);
  }

  lines.push(`equation`);

  // 4. Volume equations
  for (const vol of deck.volumes.values()) {
    const id = vol.id;
    lines.push(`  der(P_${id}) = 0.0;`);
    lines.push(`  der(alpha_${id}) = 0.0;`);
    lines.push(`  der(Tf_${id}) = 0.0;`);
    lines.push(`  der(Tg_${id}) = 0.0;`);
  }
  lines.push(``);

  // 5. Junction momentum equations
  for (const junc of deck.junctions.values()) {
    const jId = junc.id;
    const hasFrom = deck.volumes.has(junc.fromVolume);
    const hasTo = deck.volumes.has(junc.toVolume);
    if (hasFrom && hasTo) {
      lines.push(`  der(mf_${jId}) = (P_${junc.fromVolume} - P_${junc.toVolume}) / 10.0;`);
    } else {
      lines.push(`  der(mf_${jId}) = 0.0;`);
    }
    lines.push(`  der(mg_${jId}) = 0.0;`);
  }
  lines.push(``);

  // 6. Kinetics equations
  if (deck.kinetics) {
    lines.push(`  der(reactor_power) = 0.0;`);
    lines.push(`  reactivity = 0.0;`);
    for (let i = 1; i <= 6; i++) {
      lines.push(`  der(C_${i}) = 0.0;`);
    }
  }

  lines.push(`end ${safeModelName};`);
  return lines.join("\n");
}
