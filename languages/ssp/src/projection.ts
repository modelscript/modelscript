// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SSP-to-Modelica Model & Block Projection Generator.
 *
 * Translates an SSP SystemStructure Description into an authentic
 * Modelica `block` definition with typed ports, parameters, placement coordinates,
 * and diagram icon annotations.
 */

import { parseSsd } from "./ssd-parser.js";
import type { SspConnector, SspSystem } from "./types.js";

export interface SspProjectionOptions {
  /** Target Modelica block name (defaults to system.name) */
  blockName?: string;
  /** Relative or absolute path to the .ssp container file */
  sspFilePath?: string;
  /** Enclosing Modelica package name */
  packageName?: string;
}

/**
 * Generate standard Modelica block source code from an SSP system structure.
 *
 * @param input Parsed SspSystem or raw SSD XML string
 * @param options Projection configuration options
 * @returns Formatted Modelica source code string
 */
export function sspToModelicaBlock(input: SspSystem | string, options: SspProjectionOptions = {}): string {
  const system: SspSystem = typeof input === "string" ? parseSsd(input) : input;
  const name = options.blockName || sanitizeIdentifier(system.name) || "SspSystem";

  const connectors: SspConnector[] = system.connectors || [];

  const inputs = connectors.filter((c) => c.kind === "input");
  const outputs = connectors.filter((c) => c.kind === "output" || c.kind === "inout");
  const parameters = connectors.filter((c) => c.kind === "parameter" || c.kind === "calculatedParameter");

  const lines: string[] = [];

  if (options.packageName) {
    lines.push(`within ${options.packageName};`);
    lines.push("");
  }

  lines.push(`block ${name}${system.description ? ` "${escapeString(system.description)}"` : ""}`);

  // 1. Declarations: Inputs
  if (inputs.length > 0) {
    lines.push("  // ── Inputs ──");
    for (let i = 0; i < inputs.length; i++) {
      const conn = inputs[i];
      const y = calculatePortY(i, inputs.length);
      const placement = `annotation(Placement(transformation(extent={{-120,${y - 10}},{-100,${y + 10}}})))`;
      const unitAttr = conn.unit ? `(unit="${escapeString(conn.unit)}")` : "";
      lines.push(`  input ${conn.type} ${sanitizeIdentifier(conn.name)}${unitAttr} ${placement};`);
    }
    lines.push("");
  }

  // 2. Declarations: Outputs
  if (outputs.length > 0) {
    lines.push("  // ── Outputs ──");
    for (let i = 0; i < outputs.length; i++) {
      const conn = outputs[i];
      const y = calculatePortY(i, outputs.length);
      const placement = `annotation(Placement(transformation(extent={{100,${y - 10}},{120,${y + 10}}})))`;
      const unitAttr = conn.unit ? `(unit="${escapeString(conn.unit)}")` : "";
      lines.push(`  output ${conn.type} ${sanitizeIdentifier(conn.name)}${unitAttr} ${placement};`);
    }
    lines.push("");
  }

  // 3. Declarations: Parameters
  if (parameters.length > 0) {
    lines.push("  // ── Parameters ──");
    for (const param of parameters) {
      const unitAttr = param.unit ? `(unit="${escapeString(param.unit)}")` : "";
      lines.push(`  parameter ${param.type} ${sanitizeIdentifier(param.name)}${unitAttr};`);
    }
    lines.push("");
  }

  // 4. Block Annotation (Icon & External Binding)
  lines.push("  annotation(");
  if (options.sspFilePath) {
    lines.push(`    __modelscript_external(type="ssp", file="${escapeString(options.sspFilePath)}"),`);
  }
  lines.push(`    Icon(coordinateSystem(extent={{-100,-100},{100,100}}), graphics={`);
  lines.push(
    `      Rectangle(extent={{-100,-100},{100,100}}, lineColor={0,128,0}, fillColor={255,255,255}, fillPattern=FillPattern.Solid),`,
  );
  lines.push(
    `      Text(extent={{-80,80},{80,50}}, textString="SSP", textColor={0,128,0}, textStyle={TextStyle.Bold}),`,
  );
  lines.push(`      Text(extent={{-100,20},{100,-20}}, textString="${name}", textColor={0,0,0})`);
  lines.push(`    })`);
  lines.push(`  );`);

  lines.push(`end ${name};`);
  return lines.join("\n") + "\n";
}

// ── Helpers ─────────────────────────────────────────────────────────

function calculatePortY(index: number, total: number): number {
  if (total <= 1) return 0;
  return Math.round(100 - ((index + 1) * 200) / (total + 1));
}

function sanitizeIdentifier(name: string): string {
  if (!name) return "unnamed";
  let sanitized = name.replace(/[^a-zA-Z0-9_]/g, "_");
  if (/^[0-9]/.test(sanitized)) {
    sanitized = "_" + sanitized;
  }
  return sanitized;
}

function escapeString(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
