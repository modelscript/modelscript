// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Easy5Model } from "../types.js";

/**
 * Projects an EASY5 model into an FMI System Structure and Parameterization (SSP) XML document.
 */
export function easy5ToSsp(model: Easy5Model): string {
  const modelName = model.name.replace(/[^A-Za-z0-9_]/g, "_");
  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<ssd:SystemStructureDescription xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription"');
  lines.push('  xmlns:ssc="http://ssp-standard.org/SSP1/SystemStructureCommon"');
  lines.push('  xmlns:ssv="http://ssp-standard.org/SSP1/SystemStructureParameterValues"');
  lines.push('  version="1.0"');
  lines.push(`  name="${modelName}">`);
  lines.push(`  <ssd:System name="${modelName}">`);
  lines.push("    <ssd:Elements>");

  for (const [compId, comp] of model.components) {
    lines.push(
      `      <ssd:Component name="${compId}" type="application/x-fmu-sharedlibrary" source="resources/${compId}.fmu">`,
    );
    lines.push("        <ssd:Connectors>");
    for (const [portName, port] of Object.entries(comp.ports)) {
      const kind = port.kind === "output" ? "output" : "input";
      lines.push(`          <ssd:Connector name="${portName}" kind="${kind}">`);
      lines.push("            <ssc:Real />");
      lines.push("          </ssd:Connector>");
    }
    lines.push("        </ssd:Connectors>");
    lines.push("      </ssd:Component>");
  }

  lines.push("    </ssd:Elements>");
  lines.push("    <ssd:Connections>");

  for (const conn of model.connections) {
    lines.push(
      `      <ssd:Connection startElement="${conn.fromComponent}" startConnector="${conn.fromPort}" endElement="${conn.toComponent}" endConnector="${conn.toPort}" />`,
    );
  }

  lines.push("    </ssd:Connections>");
  lines.push("  </ssd:System>");
  lines.push("</ssd:SystemStructureDescription>");

  return lines.join("\n");
}
