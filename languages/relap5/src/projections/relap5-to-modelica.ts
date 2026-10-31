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
  const firstVol = deck.volumes.values().next().value;
  for (const vol of deck.volumes.values()) {
    const id = vol.id;
    const inMf: string[] = [];
    const outMf: string[] = [];
    const inMg: string[] = [];
    const outMg: string[] = [];
    const advF: string[] = [];
    const advG: string[] = [];

    for (const junc of deck.junctions.values()) {
      const jId = junc.id;
      if (junc.toVolume === id) {
        inMf.push(`mf_${jId}`);
        inMg.push(`mg_${jId}`);
        if (deck.volumes.has(junc.fromVolume)) {
          advF.push(`5200.0 * mf_${jId} * (Tf_${junc.fromVolume} - Tf_${id})`);
          advG.push(`3800.0 * mg_${jId} * (Tg_${junc.fromVolume} - Tg_${id})`);
        }
      }
      if (junc.fromVolume === id) {
        outMf.push(`mf_${jId}`);
        outMg.push(`mg_${jId}`);
      }
    }

    const netMfStr = `${inMf.length > 0 ? inMf.join(" + ") : "0.0"} - (${outMf.length > 0 ? outMf.join(" + ") : "0.0"})`;
    const netMgStr = `${inMg.length > 0 ? inMg.join(" + ") : "0.0"} - (${outMg.length > 0 ? outMg.join(" + ") : "0.0"})`;
    const advFStr = advF.length > 0 ? advF.join(" + ") : "0.0";
    const advGStr = advG.length > 0 ? advG.join(" + ") : "0.0";

    const hasHs = Array.from(deck.heatStructures.values()).some(
      (hs) => hs.leftVolumeId === id || hs.rightVolumeId === id,
    );
    const coreTerm =
      deck.kinetics && (hasHs || (firstVol && firstVol.id === id && deck.heatStructures.size === 0))
        ? ` + 0.01 * P0 * reactor_power`
        : "";

    lines.push(`  der(P_${id}) = (1.0e6 / V_${id}_vol) * ((${netMfStr}) + (${netMgStr}));`);
    lines.push(`  der(alpha_${id}) = (${netMgStr}) / (35.0 * V_${id}_vol) + 1.0e-4 * (Tf_${id} - Tg_${id});`);
    lines.push(
      `  der(Tf_${id}) = (${advFStr} - 25000.0 * V_${id}_vol * (Tf_${id} - Tg_${id})${coreTerm}) / (750.0 * 5200.0 * V_${id}_vol);`,
    );
    lines.push(
      `  der(Tg_${id}) = (25000.0 * V_${id}_vol * (Tf_${id} - Tg_${id}) + ${advGStr}) / (35.0 * 3800.0 * V_${id}_vol);`,
    );
  }
  lines.push(``);

  // 5. Junction momentum equations
  for (const junc of deck.junctions.values()) {
    const jId = junc.id;
    const hasFrom = deck.volumes.has(junc.fromVolume);
    const hasTo = deck.volumes.has(junc.toVolume);
    const kLoss = Math.max(0.1, junc.forwardLoss + 0.5).toFixed(4);
    if (hasFrom && hasTo) {
      lines.push(
        `  der(mf_${jId}) = (J_${jId}_area / 10.0) * (P_${junc.fromVolume} - P_${junc.toVolume}) - (${kLoss} / 10.0) * mf_${jId};`,
      );
      lines.push(
        `  der(mg_${jId}) = (J_${jId}_area / 10.0) * (P_${junc.fromVolume} - P_${junc.toVolume}) - (2.0 * ${kLoss} / 10.0) * mg_${jId};`,
      );
    } else {
      lines.push(`  der(mf_${jId}) = 0.0;`);
      lines.push(`  der(mg_${jId}) = 0.0;`);
    }
  }
  lines.push(``);

  // 6. Kinetics equations
  if (deck.kinetics) {
    const k = deck.kinetics;
    const groups =
      k.delayedGroups.length === 6
        ? k.delayedGroups
        : [
            { group: 1, decayConstant: 0.0124, fraction: 0.000215 },
            { group: 2, decayConstant: 0.0305, fraction: 0.001424 },
            { group: 3, decayConstant: 0.111, fraction: 0.001274 },
            { group: 4, decayConstant: 0.301, fraction: 0.002568 },
            { group: 5, decayConstant: 1.14, fraction: 0.000748 },
            { group: 6, decayConstant: 3.01, fraction: 0.000271 },
          ];

    const sumTerms: string[] = [];
    for (let i = 0; i < 6; i++) {
      const grp = groups[i];
      if (!grp) continue;
      lines.push(
        `  der(C_${i + 1}) = (${grp.fraction.toExponential(4)} / Lambda) * reactor_power - ${grp.decayConstant.toFixed(4)} * C_${i + 1};`,
      );
      sumTerms.push(`${grp.decayConstant.toFixed(4)} * C_${i + 1}`);
    }
    lines.push(`  der(reactor_power) = ((reactivity - beta) / Lambda) * reactor_power + ${sumTerms.join(" + ")};`);
    if (firstVol) {
      const alphaTot = (
        (k.fuelTempReactivityCoeff ?? -2.5e-5) + (k.moderatorTempReactivityCoeff ?? -1.5e-4)
      ).toExponential(4);
      lines.push(`  reactivity = ${alphaTot} * (Tf_${firstVol.id} - ${firstVol.initialTemperature.toFixed(2)});`);
    } else {
      lines.push(`  reactivity = 0.0;`);
    }
  }

  lines.push(`end ${safeModelName};`);
  return lines.join("\n");
}
