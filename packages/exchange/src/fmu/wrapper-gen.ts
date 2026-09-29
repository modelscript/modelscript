// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Generate a synthetic Modelica wrapper class from an FMU's modelDescription.xml
 * and optional FMI 3.0 Terminals and Icons (FMI-LS-TI).
 *
 * Supports two distinct paradigms:
 * 1. Acausal Physical Model (preferred when FMI 3.0 Terminals are present):
 *    - Synthesizes a Modelica `model` (not `block`)
 *    - Reconstructs multi-domain acausal physical connectors (Fluid, Thermal, Electrical, Mechanical)
 *    - Maps boundary variables to protected internal FMU variables
 *    - Connects physical connector potential/flow/stream members directly to internal FMU variables
 *    - Prioritizes Model Exchange (ME) over Co-Simulation (CS)
 *
 * 2. Causal Signal Block (standard fallback when terminals are absent):
 *    - Synthesizes a Modelica `block` with scalar input and output connectors and parameters
 *
 * Strictly vendor-neutral and compliant with official Modelica Association FMI standards.
 */

import type { FmiModelDescription, FmiScalarVariable, FmiTerminal } from "./model-description.js";

export interface TerminalKindInfo {
  connectorName: string;
  importPath: string;
}

/**
 * Standard FMI-LS-TI Terminal Kind taxonomy mapped to Modelica Standard Library (MSL) connectors.
 */
export const TERMINAL_KIND_MAP: Record<string, TerminalKindInfo> = {
  // Fluid (Hydraulic / Refrigerant)
  "org.modelica.types.fluid.FluidPort_a": {
    connectorName: "FluidPort_a",
    importPath: "Modelica.Fluid.Interfaces.FluidPort_a",
  },
  "Modelica.Fluid.Interfaces.FluidPort_a": {
    connectorName: "FluidPort_a",
    importPath: "Modelica.Fluid.Interfaces.FluidPort_a",
  },
  FluidPort_a: {
    connectorName: "FluidPort_a",
    importPath: "Modelica.Fluid.Interfaces.FluidPort_a",
  },
  "org.modelica.types.fluid.FluidPort_b": {
    connectorName: "FluidPort_b",
    importPath: "Modelica.Fluid.Interfaces.FluidPort_b",
  },
  "Modelica.Fluid.Interfaces.FluidPort_b": {
    connectorName: "FluidPort_b",
    importPath: "Modelica.Fluid.Interfaces.FluidPort_b",
  },
  FluidPort_b: {
    connectorName: "FluidPort_b",
    importPath: "Modelica.Fluid.Interfaces.FluidPort_b",
  },

  // Thermal Heat Transfer
  "org.modelica.types.thermal.HeatPort_a": {
    connectorName: "HeatPort_a",
    importPath: "Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a",
  },
  "Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a": {
    connectorName: "HeatPort_a",
    importPath: "Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a",
  },
  HeatPort_a: {
    connectorName: "HeatPort_a",
    importPath: "Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a",
  },
  "org.modelica.types.thermal.HeatPort_b": {
    connectorName: "HeatPort_b",
    importPath: "Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_b",
  },
  "Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_b": {
    connectorName: "HeatPort_b",
    importPath: "Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_b",
  },
  HeatPort_b: {
    connectorName: "HeatPort_b",
    importPath: "Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_b",
  },

  // Electrical Analog
  "org.modelica.types.electrical.PositivePin": {
    connectorName: "PositivePin",
    importPath: "Modelica.Electrical.Analog.Interfaces.PositivePin",
  },
  "Modelica.Electrical.Analog.Interfaces.PositivePin": {
    connectorName: "PositivePin",
    importPath: "Modelica.Electrical.Analog.Interfaces.PositivePin",
  },
  PositivePin: {
    connectorName: "PositivePin",
    importPath: "Modelica.Electrical.Analog.Interfaces.PositivePin",
  },
  "org.modelica.types.electrical.NegativePin": {
    connectorName: "NegativePin",
    importPath: "Modelica.Electrical.Analog.Interfaces.NegativePin",
  },
  "Modelica.Electrical.Analog.Interfaces.NegativePin": {
    connectorName: "NegativePin",
    importPath: "Modelica.Electrical.Analog.Interfaces.NegativePin",
  },
  NegativePin: {
    connectorName: "NegativePin",
    importPath: "Modelica.Electrical.Analog.Interfaces.NegativePin",
  },
  "org.modelica.types.electrical.Pin": {
    connectorName: "Pin",
    importPath: "Modelica.Electrical.Analog.Interfaces.Pin",
  },
  "Modelica.Electrical.Analog.Interfaces.Pin": {
    connectorName: "Pin",
    importPath: "Modelica.Electrical.Analog.Interfaces.Pin",
  },
  Pin: {
    connectorName: "Pin",
    importPath: "Modelica.Electrical.Analog.Interfaces.Pin",
  },

  // Rotational Mechanics
  "org.modelica.types.rotational.Flange_a": {
    connectorName: "Flange_a",
    importPath: "Modelica.Mechanics.Rotational.Interfaces.Flange_a",
  },
  "Modelica.Mechanics.Rotational.Interfaces.Flange_a": {
    connectorName: "Flange_a",
    importPath: "Modelica.Mechanics.Rotational.Interfaces.Flange_a",
  },
  "org.modelica.types.rotational.Flange_b": {
    connectorName: "Flange_b",
    importPath: "Modelica.Mechanics.Rotational.Interfaces.Flange_b",
  },
  "Modelica.Mechanics.Rotational.Interfaces.Flange_b": {
    connectorName: "Flange_b",
    importPath: "Modelica.Mechanics.Rotational.Interfaces.Flange_b",
  },

  // Translational Mechanics
  "org.modelica.types.translational.Flange_a": {
    connectorName: "Flange_a",
    importPath: "Modelica.Mechanics.Translational.Interfaces.Flange_a",
  },
  "Modelica.Mechanics.Translational.Interfaces.Flange_a": {
    connectorName: "Flange_a",
    importPath: "Modelica.Mechanics.Translational.Interfaces.Flange_a",
  },
  "org.modelica.types.translational.Flange_b": {
    connectorName: "Flange_b",
    importPath: "Modelica.Mechanics.Translational.Interfaces.Flange_b",
  },
  "Modelica.Mechanics.Translational.Interfaces.Flange_b": {
    connectorName: "Flange_b",
    importPath: "Modelica.Mechanics.Translational.Interfaces.Flange_b",
  },

  // Magnetic Flux
  "org.modelica.types.magnetic.MagneticPort_a": {
    connectorName: "MagneticPort_a",
    importPath: "Modelica.Magnetic.FluxTubes.Interfaces.MagneticPort_a",
  },
  "Modelica.Magnetic.FluxTubes.Interfaces.MagneticPort_a": {
    connectorName: "MagneticPort_a",
    importPath: "Modelica.Magnetic.FluxTubes.Interfaces.MagneticPort_a",
  },
  "org.modelica.types.magnetic.MagneticPort_b": {
    connectorName: "MagneticPort_b",
    importPath: "Modelica.Magnetic.FluxTubes.Interfaces.MagneticPort_b",
  },
  "Modelica.Magnetic.FluxTubes.Interfaces.MagneticPort_b": {
    connectorName: "MagneticPort_b",
    importPath: "Modelica.Magnetic.FluxTubes.Interfaces.MagneticPort_b",
  },
};

/**
 * Resolve an FMI-LS-TI terminalKind URI or string to a connector name and import statement.
 */
export function resolveTerminalKind(kind?: string): TerminalKindInfo {
  if (!kind) {
    return { connectorName: "FluidPort_a", importPath: "Modelica.Fluid.Interfaces.FluidPort_a" };
  }
  if (TERMINAL_KIND_MAP[kind]) {
    return TERMINAL_KIND_MAP[kind];
  }
  if (kind.includes(".")) {
    const parts = kind.split(".");
    const connectorName = parts[parts.length - 1]!;
    return { connectorName, importPath: kind };
  }
  return { connectorName: kind, importPath: kind };
}

/**
 * Generate Modelica source code for a wrapper representing an FMU.
 *
 * If `terminals` are present (or embedded in `desc.terminals`), synthesizes a full
 * acausal `model` with physical connectors and ME-first priority.
 * Otherwise, falls back to a standard causal `block`.
 *
 * @param desc        Parsed FMU model description
 * @param fmuPath     Path to the .fmu file (used in annotation)
 * @param packageName Optional enclosing package name
 * @param terminals   Optional array of FMI 3.0 Terminals
 * @returns           Modelica source code string
 */
export function generateFmuWrapperModelica(
  desc: FmiModelDescription,
  fmuPath?: string,
  packageName?: string,
  terminals?: FmiTerminal[],
): string {
  const effectiveTerminals = terminals && terminals.length > 0 ? terminals : (desc.terminals ?? []);
  const preferredKind = desc.supportsModelExchange ? "ModelExchange" : "CoSimulation";

  if (effectiveTerminals.length > 0) {
    return generateAcausalFmuModel(desc, effectiveTerminals, fmuPath, packageName, preferredKind);
  } else {
    return generateCausalFmuBlock(desc, fmuPath, packageName, preferredKind);
  }
}

/**
 * Synthesize an acausal Modelica model from FMI 3.0 Terminals and Icons metadata.
 */
function generateAcausalFmuModel(
  desc: FmiModelDescription,
  terminals: FmiTerminal[],
  fmuPath?: string,
  packageName?: string,
  preferredKind: "ModelExchange" | "CoSimulation" = "ModelExchange",
): string {
  const lines: string[] = [];
  const className = sanitizeModelicaName(desc.modelName);

  if (packageName) {
    lines.push(`within ${packageName};`);
    lines.push("");
  }

  lines.push(`model ${className} "${desc.description ?? `Acausal FMU wrapper for ${desc.modelName}`}"`);

  // 1. Resolve and deduplicate domain imports
  const importStatements = new Set<string>();
  const terminalInfos: {
    terminal: FmiTerminal;
    info: TerminalKindInfo;
    sanitizedName: string;
    extent: string;
  }[] = [];

  // Group variables for placement distribution
  let leftPortIndex = 0;
  let rightPortIndex = 0;
  let topPortIndex = 0;
  let bottomPortIndex = 0;

  for (let i = 0; i < terminals.length; i++) {
    const t = terminals[i]!;
    const info = resolveTerminalKind(t.terminalKind);
    if (info.importPath.includes(".")) {
      importStatements.add(`  import ${info.importPath};`);
    }

    const sanitizedName = sanitizeModelicaName(t.name);

    // Compute graphical placement extent
    let extent = "";
    if (
      t.graphicalRepresentation &&
      t.graphicalRepresentation.x1 !== undefined &&
      t.graphicalRepresentation.y1 !== undefined &&
      t.graphicalRepresentation.x2 !== undefined &&
      t.graphicalRepresentation.y2 !== undefined
    ) {
      extent = `{{${t.graphicalRepresentation.x1}, ${t.graphicalRepresentation.y1}}, {${t.graphicalRepresentation.x2}, ${t.graphicalRepresentation.y2}}}`;
    } else if (
      t.graphicalRepresentation &&
      t.graphicalRepresentation.x !== undefined &&
      t.graphicalRepresentation.y !== undefined
    ) {
      const cx = t.graphicalRepresentation.x;
      const cy = t.graphicalRepresentation.y;
      extent = `{{${cx - 10}, ${cy - 10}}, {${cx + 10}, ${cy + 10}}}`;
    } else {
      // Automatic perimeter placement
      const lowerKind = (t.terminalKind ?? "").toLowerCase();
      const lowerName = t.name.toLowerCase();
      if (lowerKind.includes("thermal") || lowerKind.includes("heat") || lowerName.includes("heat")) {
        const cx = -20 + topPortIndex * 40;
        topPortIndex++;
        extent = `{{${cx - 10}, 90}, {${cx + 10}, 110}}`;
      } else if (
        lowerName.endsWith("_b") ||
        lowerName.includes("outlet") ||
        lowerName.includes("negative") ||
        lowerName.includes("neg")
      ) {
        const cy = 20 - rightPortIndex * 40;
        rightPortIndex++;
        extent = `{{90, ${cy - 10}}, {110, ${cy + 10}}}`;
      } else {
        const cy = 20 - leftPortIndex * 40;
        leftPortIndex++;
        extent = `{{-110, ${cy - 10}}, {-90, ${cy + 10}}}`;
      }
    }

    terminalInfos.push({ terminal: t, info, sanitizedName, extent });
  }

  if (importStatements.size > 0) {
    lines.push(`  // ── Standard Domain Imports ──`);
    for (const imp of Array.from(importStatements).sort()) {
      lines.push(imp);
    }
    lines.push("");
  }

  // 2. Physical Connectors
  lines.push(`  // ── Acausal Physical Connectors ──`);
  for (const { info, sanitizedName, extent, terminal } of terminalInfos) {
    const descStr = terminal.description ? ` "${terminal.description}"` : "";
    lines.push(
      `  ${info.connectorName} ${sanitizedName}${descStr} annotation(Placement(transformation(extent = ${extent})));`,
    );
  }
  lines.push("");

  // 3. Unbound Causal Signals & Parameters
  const claimedVarNames = new Set<string>();
  for (const t of terminals) {
    for (const mv of t.memberVariables) {
      claimedVarNames.add(mv.variableName);
    }
  }

  const varMap = new Map<string, FmiScalarVariable>();
  for (const v of desc.variables) {
    varMap.set(v.name, v);
  }

  const unclaimedInputs = desc.variables.filter((v) => v.causality === "input" && !claimedVarNames.has(v.name));
  const unclaimedOutputs = desc.variables.filter((v) => v.causality === "output" && !claimedVarNames.has(v.name));
  const unclaimedParams = desc.variables.filter(
    (v) => (v.causality === "parameter" || v.causality === "calculatedParameter") && !claimedVarNames.has(v.name),
  );

  if (unclaimedInputs.length > 0 || unclaimedOutputs.length > 0 || unclaimedParams.length > 0) {
    lines.push(`  // ── Causal Control Signals & Tunable Parameters ──`);
    for (const v of unclaimedInputs) {
      const moType = fmiTypeToModelica(v);
      const startStr = v.start !== undefined ? ` = ${v.start}` : "";
      const descStr = v.description ? ` "${v.description}"` : "";
      lines.push(`  input ${moType} ${sanitizeModelicaName(v.name)}${startStr}${descStr};`);
    }
    for (const v of unclaimedOutputs) {
      const moType = fmiTypeToModelica(v);
      const descStr = v.description ? ` "${v.description}"` : "";
      lines.push(`  output ${moType} ${sanitizeModelicaName(v.name)}${descStr};`);
    }
    for (const v of unclaimedParams) {
      const moType = fmiTypeToModelica(v);
      const startStr = v.start !== undefined ? ` = ${v.start}` : "";
      const descStr = v.description ? ` "${v.description}"` : "";
      lines.push(`  parameter ${moType} ${sanitizeModelicaName(v.name)}${startStr}${descStr};`);
    }
    lines.push("");
  }

  // 4. Protected Internal FMU Boundary Variables
  lines.push(`  // ── Protected Internal FMU Boundary Variables ──`);
  lines.push(`  protected`);
  const terminalMappings: { portMember: string; fmuVar: string; terminalName: string }[] = [];

  for (const { terminal, sanitizedName } of terminalInfos) {
    for (const mv of terminal.memberVariables) {
      const memberSanitized = sanitizeModelicaName(mv.memberName);
      const fmuVarName = `fmu_${sanitizedName}_${memberSanitized}`;
      const originalVar = varMap.get(mv.variableName);
      const moType = originalVar ? fmiTypeToModelica(originalVar) : "Real";

      lines.push(`    ${moType} ${fmuVarName};`);
      terminalMappings.push({
        portMember: `${sanitizedName}.${mv.memberName}`,
        fmuVar: fmuVarName,
        terminalName: sanitizedName,
      });
    }
  }
  lines.push("");

  // 5. FMU Metadata Annotations
  lines.push(`  // ── FMU Metadata Annotation ──`);
  lines.push(`  annotation(`);
  if (fmuPath) {
    lines.push(`    __ModelScript_fmuPath = "${fmuPath}",`);
  }
  lines.push(`    __ModelScript_fmiVersion = "${desc.fmiVersion}",`);
  if (desc.guid) {
    lines.push(`    __ModelScript_guid = "${desc.guid}",`);
  }
  lines.push(`    __ModelScript_preferredKind = "${preferredKind}",`);
  if (desc.supportsCoSimulation && desc.coSimulationModelIdentifier) {
    lines.push(`    __ModelScript_csModelIdentifier = "${desc.coSimulationModelIdentifier}",`);
  }
  if (desc.supportsModelExchange && desc.modelExchangeModelIdentifier) {
    lines.push(`    __ModelScript_meModelIdentifier = "${desc.modelExchangeModelIdentifier}",`);
  }

  // Terminal Mapping
  lines.push(`    __ModelScript_terminalMapping = {`);
  for (let m = 0; m < terminalMappings.length; m++) {
    const tm = terminalMappings[m]!;
    const comma = m < terminalMappings.length - 1 ? "," : "";
    lines.push(`      ("${tm.portMember}", "${tm.fmuVar}")${comma}`);
  }
  lines.push(`    },`);

  // Icon
  lines.push(`    Icon(coordinateSystem(extent = {{-100, -100}, {100, 100}}),`);
  lines.push(`      graphics = {`);
  lines.push(`        Rectangle(extent = {{-100, -100}, {100, 100}}, lineColor = {0, 0, 127},`);
  lines.push(`                  fillColor = {250, 250, 255}, fillPattern = FillPattern.Solid),`);
  lines.push(`        Text(extent = {{-90, 40}, {90, -40}}, textString = "${className}",`);
  lines.push(`             lineColor = {0, 0, 127})`);
  lines.push(`      }`);
  lines.push(`    )`);
  lines.push(`  );`);
  lines.push("");

  // 6. Equation Section: Physical Boundary Coupling
  lines.push(`equation`);
  lines.push(`  // ── Physical Boundary Coupling ──`);

  let currentTerm = "";
  for (const tm of terminalMappings) {
    if (tm.terminalName !== currentTerm) {
      currentTerm = tm.terminalName;
      lines.push(`  // Terminal: ${currentTerm}`);
    }
    lines.push(`  ${tm.portMember} = ${tm.fmuVar};`);
  }
  lines.push("");

  lines.push(`end ${className};`);
  return lines.join("\n");
}

/**
 * Synthesize a standard causal Modelica block (legacy / fallback behavior).
 */
function generateCausalFmuBlock(
  desc: FmiModelDescription,
  fmuPath?: string,
  packageName?: string,
  preferredKind: "ModelExchange" | "CoSimulation" = "CoSimulation",
): string {
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
  lines.push(`    __ModelScript_preferredKind = "${preferredKind}",`);
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
export function fmiTypeToModelica(v: FmiScalarVariable): string {
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
export function sanitizeModelicaName(name: string): string {
  let sanitized = name.replace(/[^a-zA-Z0-9_]/g, "_");
  if (/^[0-9]/.test(sanitized)) {
    sanitized = "_" + sanitized;
  }
  return sanitized;
}
