// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Native PSCAD `.pscx` XML Writer ("Beyond PSCAD Silos").
 *
 * Serializes a `PscxProject` (settings, schematic components, buses, wires,
 * and sub-modules) into PSCAD v4/v5-compatible `.pscx` XML that round-trips
 * cleanly through `parsePscx`.
 */

import type { PscxBus, PscxComponent, PscxModule, PscxProject, PscxWire } from "../types.js";

function escapeXmlAttr(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function serializeComponent(comp: PscxComponent): string {
  const nameAttr = comp.instanceName ? ` name="${escapeXmlAttr(comp.instanceName)}"` : "";
  const wAttr = comp.width !== undefined ? ` w="${comp.width}"` : "";
  const hAttr = comp.height !== undefined ? ` h="${comp.height}"` : "";
  const rotAttr = comp.rotation !== undefined ? ` rot="${comp.rotation}"` : "";
  const mirAttr = comp.mirror !== undefined ? ` mir="${comp.mirror ? 1 : 0}"` : "";
  const disAttr = comp.disabled ? ` disabled="true"` : "";
  const params = Object.entries(comp.parameters);
  if (params.length === 0) {
    return `      <User classid="UserCmp" id="${escapeXmlAttr(comp.id)}" defn="${escapeXmlAttr(comp.definitionName)}" x="${comp.position.x}" y="${comp.position.y}"${nameAttr}${wAttr}${hAttr}${rotAttr}${mirAttr}${disAttr} />`;
  }
  const paramLines = params
    .map(([k, v]) => `          <param name="${escapeXmlAttr(k)}" value="${escapeXmlAttr(String(v))}" />`)
    .join("\n");
  return [
    `      <User classid="UserCmp" id="${escapeXmlAttr(comp.id)}" defn="${escapeXmlAttr(comp.definitionName)}" x="${comp.position.x}" y="${comp.position.y}"${nameAttr}${wAttr}${hAttr}${rotAttr}${mirAttr}${disAttr}>`,
    `        <paramlist>`,
    paramLines,
    `        </paramlist>`,
    `      </User>`,
  ].join("\n");
}

function serializeBus(bus: PscxBus): string {
  const kvAttr = bus.voltageBaseKv !== undefined ? ` basekv="${bus.voltageBaseKv}"` : "";
  return `      <Bus id="${escapeXmlAttr(bus.id)}" name="${escapeXmlAttr(bus.name)}" x="${bus.position.x}" y="${bus.position.y}" phases="${bus.phaseCount}"${kvAttr} />`;
}

function serializeWire(wire: PscxWire): string {
  const pts = wire.vertices.map((p) => `<point x="${p.x}" y="${p.y}" />`).join("");
  return `      <Wire id="${escapeXmlAttr(wire.id)}">${pts}</Wire>`;
}

function serializeModule(mod: PscxModule): string {
  const lines: string[] = [
    `  <Definition classid="Station" name="${escapeXmlAttr(mod.name)}" id="${escapeXmlAttr(mod.id)}">`,
    `    <schematic classid="UserCanvas">`,
  ];
  for (const bus of mod.buses) {
    lines.push(serializeBus(bus));
  }
  for (const comp of mod.components) {
    lines.push(serializeComponent(comp));
  }
  for (const wire of mod.wires) {
    lines.push(serializeWire(wire));
  }
  lines.push(`    </schematic>`);
  lines.push(`  </Definition>`);
  return lines.join("\n");
}

/**
 * Serializes a `PscxProject` to PSCAD `.pscx` XML text.
 */
export function serializePscx(project: PscxProject): string {
  const { settings } = project;
  const lines: string[] = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<project name="${escapeXmlAttr(project.name)}" version="${escapeXmlAttr(project.version)}" type="${escapeXmlAttr(project.projectType ?? "case")}">`,
    `  <paramlist name="Settings">`,
    `    <param name="time_step" value="${settings.timeStepUs}" />`,
    `    <param name="time_duration" value="${settings.durationSec}" />`,
    `    <param name="StartType" value="${settings.startType === "snapshot" ? 1 : 0}" />`,
    `    <param name="Frequency" value="${settings.frequencyHz}" />`,
    `  </paramlist>`,
    `  <definitions>`,
    serializeModule(project.rootModule),
  ];

  for (const sub of project.subModules.values()) {
    lines.push(serializeModule(sub));
  }

  lines.push(`  </definitions>`);
  lines.push(`</project>`);
  return lines.join("\n");
}
