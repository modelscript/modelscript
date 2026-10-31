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
  for (const [, st] of deck.storages) buses.add(st.bus1);
  for (const [, cap] of deck.capacitors) buses.add(cap.bus1);

  const lines: string[] = [];
  lines.push(`model ${name} "Synthesized OpenDSS Distribution Grid Feeder"`);
  lines.push(`  import Modelica.Electrical.Analog.Basic.Resistor;`);
  lines.push(`  import Modelica.Electrical.Analog.Basic.Inductor;`);
  lines.push(`  import Modelica.Electrical.Analog.Basic.Capacitor;`);
  lines.push(`  import Modelica.Electrical.Analog.Basic.IdealTransformer;`);
  lines.push(`  import Modelica.Electrical.Analog.Basic.Ground;`);
  lines.push(`  import Modelica.Electrical.Analog.Interfaces.Pin;`);
  lines.push(`  import Modelica.Electrical.Analog.Sources.SineVoltage;`);
  lines.push(`  import Modelica.Electrical.Analog.Sources.ConstantCurrent;`);
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

  // Bus Connectors & Potential Variables
  lines.push(`  // Bus Connectors and Phase Potential Variables (V)`);
  for (const b of buses) {
    lines.push(`  Pin bus_${b} "Electrical node connector at bus ${b}";`);
    lines.push(`  Real v_${b} "Phase potential at bus ${b}";`);
  }
  lines.push(``);

  // Transformers
  if (deck.transformers.size > 0) {
    lines.push(`  // Substation & Service Transformers`);
    for (const [id, xfmr] of deck.transformers) {
      const kv1 = xfmr.kvs[0] ?? 115.0;
      const kv2 = xfmr.kvs[1] ?? 12.47;
      const ratio = (kv1 / kv2).toFixed(4);
      lines.push(`  IdealTransformer Xfmr_${id}(n = ${ratio});`);
    }
    lines.push(``);
  }

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

  // Capacitors & DERs
  for (const [id, cap] of deck.capacitors) {
    const vNom = (cap.kv * 1e3) / Math.sqrt(3);
    const qPhase = (cap.kvar * 1e3) / cap.phases;
    const cEq = (qPhase / (2 * Math.PI * 60 * vNom * vNom)).toExponential(4);
    lines.push(`  Capacitor Cap_${id}(C = ${cEq});`);
  }
  for (const [id, pv] of deck.pvSystems) {
    const vNom = (pv.kv * 1e3) / Math.sqrt(3);
    const iPhase = ((pv.pmpp * 1e3) / pv.phases / Math.max(1.0, vNom)).toFixed(2);
    lines.push(`  ConstantCurrent PV_${id}(I = ${iPhase});`);
  }

  lines.push(`equation`);
  for (const b of buses) {
    lines.push(`  v_${b} = bus_${b}.v;`);
  }

  if (deck.circuit) {
    const slack = deck.circuit.bus1;
    lines.push(`  connect(source.p, bus_${slack});`);
    lines.push(`  connect(source.n, ground.p);`);
  }

  // Connect transformers
  for (const [id, xfmr] of deck.transformers) {
    const b1 = xfmr.buses[0] ?? "SourceBus";
    const b2 = xfmr.buses[1] ?? "SubBus";
    lines.push(`  connect(Xfmr_${id}.p1, bus_${b1});`);
    lines.push(`  connect(Xfmr_${id}.n1, ground.p);`);
    lines.push(`  connect(Xfmr_${id}.p2, bus_${b2});`);
    lines.push(`  connect(Xfmr_${id}.n2, ground.p);`);
  }

  // Connect lines
  for (const [id, line] of deck.lines) {
    lines.push(`  connect(R_${id}.p, bus_${line.bus1});`);
    lines.push(`  connect(R_${id}.n, L_${id}.p);`);
    lines.push(`  connect(L_${id}.n, bus_${line.bus2});`);
  }

  // Connect loads, capacitors, and PV systems
  for (const [id, load] of deck.loads) {
    lines.push(`  connect(Load_${id}.p, bus_${load.bus1});`);
    lines.push(`  connect(Load_${id}.n, ground.p);`);
  }
  for (const [id, cap] of deck.capacitors) {
    lines.push(`  connect(Cap_${id}.p, bus_${cap.bus1});`);
    lines.push(`  connect(Cap_${id}.n, ground.p);`);
  }
  for (const [id, pv] of deck.pvSystems) {
    lines.push(`  connect(PV_${id}.n, bus_${pv.bus1});`);
    lines.push(`  connect(PV_${id}.p, ground.p);`);
  }

  lines.push(`end ${name};`);
  return lines.join("\n") + "\n";
}
