// SPDX-License-Identifier: AGPL-3.0-or-later

import type { GtModel } from "../types.js";

/**
 * Projects a GT-SUITE engine model into an FMI SystemStructure and Parameterization (SSP) XML document.
 */
export function gtsuiteToSsp(model: GtModel): string {
  const modelName = model.name.replace(/[^A-Za-z0-9_]/g, "_");
  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<ssd:SystemStructureDescription xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription"');
  lines.push('  xmlns:ssc="http://ssp-standard.org/SSP1/SystemStructureCommon"');
  lines.push('  version="1.0"');
  lines.push(`  name="${modelName}">`);
  lines.push(`  <ssd:System name="${modelName}">`);
  lines.push("    <ssd:Elements>");

  for (const comp of model.components) {
    const compId = comp.id.replace(/[^A-Za-z0-9_]/g, "_");
    lines.push(
      `      <ssd:Component name="${compId}" type="application/x-fmu-sharedlibrary" source="resources/${compId}.fmu">`,
    );
    lines.push("        <ssd:Connectors>");
    lines.push('          <ssd:Connector name="in" kind="input"><ssc:Real /></ssd:Connector>');
    lines.push('          <ssd:Connector name="out" kind="output"><ssc:Real /></ssd:Connector>');
    lines.push("        </ssd:Connectors>");
    lines.push("      </ssd:Component>");
  }

  lines.push("    </ssd:Elements>");
  lines.push("    <ssd:Connections>");

  for (const conn of model.connections) {
    const from = conn.fromComponent.replace(/[^A-Za-z0-9_]/g, "_");
    const to = conn.toComponent.replace(/[^A-Za-z0-9_]/g, "_");
    lines.push(
      `      <ssd:Connection startElement="${from}" startConnector="${conn.fromPort}" endElement="${to}" endConnector="${conn.toPort}" />`,
    );
  }

  lines.push("    </ssd:Connections>");
  lines.push("  </ssd:System>");
  lines.push("</ssd:SystemStructureDescription>");

  return lines.join("\n");
}
