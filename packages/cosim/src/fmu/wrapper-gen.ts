// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Generate a synthetic Modelica wrapper class from an FMU's modelDescription.xml.
 *
 * Converts FMU scalar variable metadata into a Modelica `block` with:
 * - Input connectors for FMU input variables
 * - Output connectors for FMU output variables
 * - Parameters for FMU parameter variables
 * - An annotation referencing the FMU file path
 *
 * This allows FMUs to be used seamlessly in Modelica models: users see
 * a proper Modelica class with typed ports that can be connected to
 * other components.
 */

import type { FmiModelDescription, FmiScalarVariable } from "@modelscript/cosim";

/**
 * Generate Modelica source code for a wrapper block representing an FMU.
 *
 * @param desc        Parsed FMU model description
 * @param fmuPath     Path to the .fmu file (used in annotation)
 * @param packageName Optional enclosing package name
 * @returns           Modelica source code string
 */
export function generateFmuWrapperModelica(desc: FmiModelDescription, fmuPath?: string, packageName?: string): string {
  const lines: string[] = [];
  const className = sanitizeModelicaName(desc.modelName);

  if (packageName) {
    lines.push(`within ${packageName};`);
  }

  lines.push(`block ${className} "${desc.description ?? `FMU wrapper for ${desc.modelName}`}"`);

  // Group variables by causality
  const inputs = desc.variables.filter((v) => v.causality === "input");
  const outputs = desc.variables.filter((v) => v.causality === "output");
  const parameters = desc.variables.filter((v) => v.causality === "parameter" || v.causality === "calculatedParameter");

  // Emit input connectors
  for (const v of inputs) {
    const moType = fmiTypeToModelica(v);
    const startStr = v.start !== undefined ? ` = ${v.start}` : "";
    const descStr = v.description ? ` "${v.description}"` : "";
    lines.push(`  input ${moType} ${sanitizeModelicaName(v.name)}${startStr}${descStr};`);
  }

  // Emit output connectors
  for (const v of outputs) {
    const moType = fmiTypeToModelica(v);
    const descStr = v.description ? ` "${v.description}"` : "";
    lines.push(`  output ${moType} ${sanitizeModelicaName(v.name)}${descStr};`);
  }

  // Emit parameters
  for (const v of parameters) {
    const moType = fmiTypeToModelica(v);
    const startStr = v.start !== undefined ? ` = ${v.start}` : "";
    const descStr = v.description ? ` "${v.description}"` : "";
    lines.push(`  parameter ${moType} ${sanitizeModelicaName(v.name)}${startStr}${descStr};`);
  }

  // Emit FMU file path annotation
  lines.push(`  annotation(`);
  if (fmuPath) {
    lines.push(`    __ModelScript_fmuPath = "${fmuPath}",`);
  }
  lines.push(`    __ModelScript_fmiVersion = "${desc.fmiVersion}",`);
  if (desc.guid) {
    lines.push(`    __ModelScript_guid = "${desc.guid}",`);
  }
  if (desc.supportsCoSimulation && desc.coSimulationModelIdentifier) {
    lines.push(`    __ModelScript_csModelIdentifier = "${desc.coSimulationModelIdentifier}",`);
  }
  if (desc.supportsModelExchange && desc.modelExchangeModelIdentifier) {
    lines.push(`    __ModelScript_meModelIdentifier = "${desc.modelExchangeModelIdentifier}",`);
  }

  // Icon annotation: rectangle with FMU label
  lines.push(`    Icon(coordinateSystem(extent = {{-100, -100}, {100, 100}}),`);
  lines.push(`      graphics = {`);
  lines.push(`        Rectangle(extent = {{-100, -100}, {100, 100}}, lineColor = {0, 0, 127},`);
  lines.push(`          fillColor = {255, 255, 255}, fillPattern = FillPattern.Solid),`);
  lines.push(`        Text(extent = {{-80, 40}, {80, -40}}, textString = "${className}",`);
  lines.push(`          lineColor = {0, 0, 127})`);
  lines.push(`      })`);
  lines.push(`  );`);

  lines.push(`end ${className};`);

  return lines.join("\n");
}

/**
 * Map FMI type info to a Modelica type name.
 */
function fmiTypeToModelica(v: FmiScalarVariable): string {
  switch (v.type) {
    case "Real":
      return "Real";
    case "Integer":
    case "Enumeration":
      return "Integer";
    case "Boolean":
      return "Boolean";
    case "String":
      return "String";
    default:
      return "Real";
  }
}

/**
 * Sanitize a name for use as a Modelica identifier.
 * Replaces dots, hyphens, spaces with underscores;
 * prepends underscore if starts with a digit.
 */
function sanitizeModelicaName(name: string): string {
  let sanitized = name.replace(/[^a-zA-Z0-9_]/g, "_");
  if (/^[0-9]/.test(sanitized)) {
    sanitized = "_" + sanitized;
  }
  return sanitized;
}
