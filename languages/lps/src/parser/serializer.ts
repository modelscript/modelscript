// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lps — Serializer for PipelineStudio Models (XML & Keyword Deck).
 */

import type { LpsModel } from "../types.js";

/** Serializes an LpsModel into clean, standardized PipelineStudio XML format. */
export function serializeLpsXml(model: LpsModel): string {
  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="utf-8"?>`);
  lines.push(`<PipelineStudio id="${model.id}" title="${model.title}" simulationType="${model.type}">`);

  // Nodes
  lines.push(`  <Nodes>`);
  for (const n of model.nodes) {
    const attrs: string[] = [`name="${n.name}"`, `type="${n.type}"`, `elevation="${n.elevation}"`];
    if (n.pressure != null) attrs.push(`pressure="${(n.pressure / 1e5).toFixed(2)}bar"`);
    if (n.flowRate != null) attrs.push(`flow="${n.flowRate.toFixed(2)}"`);
    if (n.minDeliveryPressure != null)
      attrs.push(`minDeliveryPressure="${(n.minDeliveryPressure / 1e5).toFixed(2)}bar"`);
    if (n.maxAllowablePressure != null) attrs.push(`maop="${(n.maxAllowablePressure / 1e5).toFixed(2)}bar"`);
    if (n.coordinates) {
      attrs.push(`x="${n.coordinates.x}" y="${n.coordinates.y}"`);
    }
    lines.push(`    <Node ${attrs.join(" ")} />`);
  }
  lines.push(`  </Nodes>`);

  // Pipes
  lines.push(`  <Pipes>`);
  for (const p of model.pipes) {
    const attrs: string[] = [
      `name="${p.name}"`,
      `from="${p.fromNode}"`,
      `to="${p.toNode}"`,
      `length="${(p.length / 1000).toFixed(2)}km"`,
      `diameter="${(p.diameter * 1000).toFixed(1)}mm"`,
      `roughness="${p.roughness}"`,
      `maop="${(p.maop / 1e5).toFixed(2)}bar"`,
    ];
    if (p.heatTransferCoefficient != null) attrs.push(`u="${p.heatTransferCoefficient}"`);
    if (p.ambientTemperature != null) attrs.push(`t_amb="${p.ambientTemperature}"`);
    if (p.draPpm != null) attrs.push(`dra="${p.draPpm}"`);
    lines.push(`    <Pipe ${attrs.join(" ")} />`);
  }
  lines.push(`  </Pipes>`);

  // Compressors
  if (model.compressors.length > 0) {
    lines.push(`  <Compressors>`);
    for (const c of model.compressors) {
      lines.push(
        `    <Compressor name="${c.name}" from="${c.fromNode}" to="${c.toNode}" type="${c.type}" ` +
          `power="${c.maxPower}" maxRatio="${c.maxPressureRatio}" efficiency="${c.polytropicEfficiency}" ` +
          `mode="${c.controlMode}" setpoint="${(c.setpoint / 1e5).toFixed(2)}bar" status="${c.status}" />`,
      );
    }
    lines.push(`  </Compressors>`);
  }

  // Pumps
  if (model.pumps.length > 0) {
    lines.push(`  <Pumps>`);
    for (const pu of model.pumps) {
      lines.push(
        `    <Pump name="${pu.name}" from="${pu.fromNode}" to="${pu.toNode}" power="${pu.maxPower}" ` +
          `ratedFlow="${pu.ratedFlow}" ratedHead="${pu.ratedHead}" npshr="${pu.npshRequired}" ` +
          `efficiency="${pu.efficiency}" mode="${pu.controlMode}" setpoint="${pu.setpoint}" status="${pu.status}" />`,
      );
    }
    lines.push(`  </Pumps>`);
  }

  // Regulators
  if (model.regulators.length > 0) {
    lines.push(`  <Regulators>`);
    for (const r of model.regulators) {
      lines.push(
        `    <Regulator name="${r.name}" from="${r.fromNode}" to="${r.toNode}" ` +
          `setpoint="${(r.setpointPressure / 1e5).toFixed(2)}bar" capacity="${r.maxCapacity}" ` +
          `preheater="${r.preheaterInstalled}" />`,
      );
    }
    lines.push(`  </Regulators>`);
  }

  // Valves
  if (model.valves.length > 0) {
    lines.push(`  <Valves>`);
    for (const v of model.valves) {
      lines.push(
        `    <Valve name="${v.name}" from="${v.fromNode}" to="${v.toNode}" ` +
          `opening="${v.opening}" closingTime="${v.closingTimeSeconds}" />`,
      );
    }
    lines.push(`  </Valves>`);
  }

  // Gas Composition
  if (model.gasComposition) {
    const g = model.gasComposition;
    lines.push(
      `  <GasComposition ch4="${g.methane}" c2h6="${g.ethane}" c3h8="${g.propane}" ` +
        `co2="${g.carbonDioxide}" n2="${g.nitrogen}" h2="${g.hydrogen}" ghv="${g.grossHeatingValue ?? 38.5}" />`,
    );
  }

  // Simulation Controls
  const sc = model.simulationControls;
  lines.push(
    `  <SimulationControls startTime="${sc.startTime}" endTime="${sc.endTime}" ` +
      `timeStep="${sc.timeStep}" eos="${sc.equationOfState}" steadyStateFirst="${sc.steadyStateFirst}" />`,
  );

  lines.push(`</PipelineStudio>`);
  return lines.join("\n");
}

/** Serializes an LpsModel into standard ASCII keyword deck. */
export function serializeLpsKeyDeck(model: LpsModel): string {
  const lines: string[] = [];
  lines.push(`CASE ${model.id} TITLE "${model.title}"`);
  lines.push(`SIMULATION ${model.type}`);

  for (const n of model.nodes) {
    let line = `NODE ${n.name} TYPE ${n.type} ELEVATION ${n.elevation}`;
    if (n.pressure != null) line += ` PRESSURE ${(n.pressure / 1e5).toFixed(2)}bar`;
    if (n.flowRate != null) line += ` FLOW ${n.flowRate.toFixed(2)}`;
    if (n.minDeliveryPressure != null) line += ` MINP ${(n.minDeliveryPressure / 1e5).toFixed(2)}bar`;
    lines.push(line);
  }

  for (const p of model.pipes) {
    lines.push(
      `PIPE ${p.name} FROM ${p.fromNode} TO ${p.toNode} LENGTH ${p.length} ` +
        `DIAMETER ${p.diameter} ROUGHNESS ${p.roughness} MAOP ${(p.maop / 1e5).toFixed(2)}bar`,
    );
  }

  for (const c of model.compressors) {
    lines.push(
      `COMPRESSOR ${c.name} FROM ${c.fromNode} TO ${c.toNode} POWER ${c.maxPower} ` +
        `RATIO ${c.maxPressureRatio} EFF ${c.polytropicEfficiency} SETPOINT ${(c.setpoint / 1e5).toFixed(2)}bar`,
    );
  }

  for (const pu of model.pumps) {
    lines.push(
      `PUMP ${pu.name} FROM ${pu.fromNode} TO ${pu.toNode} POWER ${pu.maxPower} ` +
        `HEAD ${pu.ratedHead} FLOW ${pu.ratedFlow} NPSHR ${pu.npshRequired}`,
    );
  }

  for (const r of model.regulators) {
    lines.push(
      `REGULATOR ${r.name} FROM ${r.fromNode} TO ${r.toNode} ` +
        `SETPOINT ${(r.setpointPressure / 1e5).toFixed(2)}bar CAPACITY ${r.maxCapacity}`,
    );
  }

  for (const v of model.valves) {
    lines.push(`VALVE ${v.name} FROM ${v.fromNode} TO ${v.toNode} OPENING ${v.opening} TIME ${v.closingTimeSeconds}`);
  }

  if (model.gasComposition) {
    const g = model.gasComposition;
    lines.push(
      `COMPOSITION CH4 ${g.methane} C2H6 ${g.ethane} C3H8 ${g.propane} ` +
        `CO2 ${g.carbonDioxide} N2 ${g.nitrogen} H2 ${g.hydrogen}`,
    );
  }

  const sc = model.simulationControls;
  lines.push(`INTEGRATION START ${sc.startTime} END ${sc.endTime} DT ${sc.timeStep} EOS ${sc.equationOfState}`);

  return lines.join("\n");
}
