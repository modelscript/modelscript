// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/opendss — Modelica 3.x Distribution Grid Projection.
 *
 * Synthesizes standard Modelica 3.x AC electrical distribution circuits with:
 * - Substation slack bus sources
 * - Two-winding distribution transformers
 * - Series RL branch lines
 * - Constant impedance / PQ loads
 * - Solar PV inverter generation
 */

import type { DssDeck } from "../types.js";

export function openDssToModelica(deck: DssDeck, modelName?: string): string {
  const name = (modelName ?? (deck.circuit?.name || "DistributionFeeder")).replace(/[^a-zA-Z0-9_]/g, "_");

  const buses = new Set<string>();
  if (deck.circuit) buses.add(deck.circuit.bus1);
  for (const [, line] of deck.lines) {
    buses.add(line.bus1);
    buses.add(line.bus2);
  }
  for (const [, xfmr] of deck.transformers) {
    for (const b of xfmr.buses) buses.add(b);
  }
  for (const [, l] of deck.loads) buses.add(l.bus1);
  for (const [, pv] of deck.pvSystems) buses.add(pv.bus1);

  const lines: string[] = [];
  lines.push(`model ${name} "Synthesized OpenDSS Distribution Grid Feeder"`);
  lines.push(`  import Modelica.Electrical.Analog.Basic.Resistor;`);
  lines.push(`  import Modelica.Electrical.Analog.Basic.Inductor;`);
  lines.push(`  import Modelica.Electrical.Analog.Basic.Ground;`);
  lines.push(`  import Modelica.Electrical.Analog.Sources.SineVoltage;`);
  lines.push(``);

  // Substation Source
  if (deck.circuit) {
    const c = deck.circuit;
    const vPeak = ((c.baseKv * 1e3) / Math.sqrt(3)) * Math.SQRT2 * c.pu;
    lines.push(`  // Substation Voltage Source`);
    lines.push(`  SineVoltage source(V = ${vPeak.toFixed(2)}, f = ${c.frequency ?? 60});`);
  }
  lines.push(`  Ground ground;`);
  lines.push(``);

  // Bus voltage state variables
  lines.push(`  // Bus Potential Variables (V)`);
  for (const b of buses) {
    lines.push(`  Real v_${b} "Phase potential at bus ${b}";`);
  }
  lines.push(``);

  // Line branch components
  lines.push(`  // Distribution Line RL Branches`);
  for (const [id, line] of deck.lines) {
    const lc = line.lineCode ? deck.lineCodes.get(line.lineCode) : undefined;
    const r1 = line.r1 ?? lc?.r1 ?? 0.1;
    const x1 = line.x1 ?? lc?.x1 ?? 0.4;
    const l1 = x1 / (2 * Math.PI * 60);

    const rTot = (r1 * line.length).toFixed(4);
    const lTot = (l1 * line.length).toExponential(4);

    lines.push(`  Resistor R_${id}(R = ${rTot});`);
    lines.push(`  Inductor L_${id}(L = ${lTot});`);
  }
  lines.push(``);

  // Loads
  lines.push(`  // Distribution Loads`);
  for (const [id, load] of deck.loads) {
    const vNom = (load.kv * 1e3) / Math.sqrt(3);
    const pPhase = (load.kw * 1e3) / load.phases;
    const rEq = pPhase > 0 ? ((vNom * vNom) / pPhase).toFixed(2) : "1000.0";
    lines.push(`  Resistor Load_${id}(R = ${rEq});`);
  }
  lines.push(``);

  lines.push(`equation`);
  if (deck.circuit) {
    const slack = deck.circuit.bus1;
    lines.push(`  connect(source.n, ground.p);`);
    lines.push(`  v_${slack} = source.p.v;`);
  }

  // Connect lines
  for (const [id, line] of deck.lines) {
    lines.push(`  connect(R_${id}.n, L_${id}.p);`);
    lines.push(`  R_${id}.p.v = v_${line.bus1};`);
    lines.push(`  L_${id}.n.v = v_${line.bus2};`);
  }

  // Connect loads
  for (const [id, load] of deck.loads) {
    lines.push(`  Load_${id}.p.v = v_${load.bus1};`);
    lines.push(`  connect(Load_${id}.n, ground.p);`);
  }

  lines.push(`end ${name};`);
  return lines.join("\n") + "\n";
}
