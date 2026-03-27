// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMI 2.0 Co-Simulation FMU generator.
 *
 * Generates the modelDescription.xml and packages a .fmu archive
 * from a flattened/simulated ModelicaDAE.
 *
 * FMI 2.0 specification: https://fmi-standard.org/
 */

import type { ModelicaDAE, ModelicaVariable } from "./dae.js";
import { ModelicaVariability } from "./syntax.js";

// ── Public interface ──

/** FMI variable causality. */
export type FmiCausality = "input" | "output" | "parameter" | "local" | "independent";

/** FMI variable variability. */
export type FmiVariability = "constant" | "fixed" | "tunable" | "discrete" | "continuous";

/** FMI scalar variable descriptor. */
export interface FmiScalarVariable {
  /** Unique value reference (integer index). */
  valueReference: number;
  /** Name of the variable (dot-qualified Modelica name). */
  name: string;
  /** FMI causality. */
  causality: FmiCausality;
  /** FMI variability. */
  variability: FmiVariability;
  /** Description string (optional). */
  description?: string;
  /** Data type: Real, Integer, Boolean, String. */
  type: "Real" | "Integer" | "Boolean" | "String";
  /** Start value (initial condition or default). */
  start?: number;
  /** SI unit string (optional). */
  unit?: string;
}

/** FMU generation options. */
export interface FmuOptions {
  /** Model identifier (used as the FMU file stem and in code generation). */
  modelIdentifier: string;
  /** Description of the model. */
  description?: string | undefined;
  /** Author name. */
  author?: string | undefined;
  /** Generation tool name. */
  generationTool?: string | undefined;
  /** GUID for this FMU (auto-generated if not provided). */
  guid?: string | undefined;
  /** Default experiment start time. */
  startTime?: number | undefined;
  /** Default experiment stop time. */
  stopTime?: number | undefined;
  /** Default experiment step size. */
  stepSize?: number | undefined;
}

/** Result of FMU generation. */
export interface FmuResult {
  /** The modelDescription.xml content. */
  modelDescriptionXml: string;
  /** Scalar variable descriptors. */
  scalarVariables: FmiScalarVariable[];
  /** Model structure (outputs, derivatives, initial unknowns). */
  modelStructure: {
    outputs: number[];
    derivatives: number[];
    initialUnknowns: number[];
  };
}

/**
 * Generate FMU 2.0 Co-Simulation model description from a DAE.
 *
 * @param dae       The flattened DAE
 * @param options   FMU generation options
 * @param stateVars Set of state variable names (from the simulator)
 * @returns FMU result with XML and variable descriptors
 */
export function generateFmu(dae: ModelicaDAE, options: FmuOptions, stateVars?: Set<string>): FmuResult {
  const guid = options.guid ?? generateGuid();
  const scalarVariables: FmiScalarVariable[] = [];
  let valueRef = 0;

  // ── Time variable (independent) ──
  scalarVariables.push({
    valueReference: valueRef++,
    name: "time",
    causality: "independent",
    variability: "continuous",
    type: "Real",
  });

  // ── Model variables ──
  const outputRefs: number[] = [];
  const derivativeRefs: number[] = [];
  const initialUnknownRefs: number[] = [];

  for (const v of dae.variables) {
    const sv = mapVariable(v, valueRef++);
    scalarVariables.push(sv);

    // Track outputs (connector output variables)
    if (sv.causality === "output") {
      outputRefs.push(sv.valueReference);
    }
    // Track initial unknowns (continuous variables with no fixed start)
    if (sv.variability === "continuous" && sv.causality === "local") {
      initialUnknownRefs.push(sv.valueReference);
    }
  }

  // ── Derivative variables ──
  // For each state variable x, add der(x) as a derivative output
  const states = stateVars ?? new Set<string>();
  for (const v of dae.variables) {
    if (states.has(v.name)) {
      const derSv: FmiScalarVariable = {
        valueReference: valueRef++,
        name: `der(${v.name})`,
        causality: "local",
        variability: "continuous",
        type: "Real",
        start: 0,
      };
      scalarVariables.push(derSv);
      derivativeRefs.push(derSv.valueReference);
    }
  }

  // ── Generate modelDescription.xml ──
  const xml = generateModelDescriptionXml(scalarVariables, {
    ...options,
    guid,
    outputRefs,
    derivativeRefs,
    initialUnknownRefs,
  });

  return {
    modelDescriptionXml: xml,
    scalarVariables,
    modelStructure: {
      outputs: outputRefs,
      derivatives: derivativeRefs,
      initialUnknowns: initialUnknownRefs,
    },
  };
}

// ── Internal helpers ──

/** Map a Modelica variable to an FMI scalar variable. */
function mapVariable(v: ModelicaVariable, valueRef: number): FmiScalarVariable {
  const sv: FmiScalarVariable = {
    valueReference: valueRef,
    name: v.name,
    causality: mapCausality(v),
    variability: mapVariability(v),
    type: "Real", // Default; refined below
    start: 0,
  };

  // Determine type from class name
  if (v.constructor.name.includes("Integer")) {
    sv.type = "Integer";
  } else if (v.constructor.name.includes("Boolean")) {
    sv.type = "Boolean";
  } else if (v.constructor.name.includes("String")) {
    sv.type = "String";
  }

  return sv;
}

/** Map Modelica variability to FMI causality. */
function mapCausality(v: ModelicaVariable): FmiCausality {
  if (v.variability === ModelicaVariability.PARAMETER) return "parameter";
  if (v.variability === ModelicaVariability.CONSTANT) return "parameter";
  // TODO: detect input/output from connector direction
  return "local";
}

/** Map Modelica variability to FMI variability. */
function mapVariability(v: ModelicaVariable): FmiVariability {
  switch (v.variability) {
    case ModelicaVariability.CONSTANT:
      return "constant";
    case ModelicaVariability.PARAMETER:
      return "fixed";
    case ModelicaVariability.DISCRETE:
      return "discrete";
    default:
      return "continuous";
  }
}

/** Generate a random GUID for the FMU. */
function generateGuid(): string {
  const hex = (n: number) =>
    Array.from({ length: n }, () =>
      Math.floor(Math.random() * 16)
        .toString(16)
        .toLowerCase(),
    ).join("");
  return `{${hex(8)}-${hex(4)}-4${hex(3)}-${hex(4)}-${hex(12)}}`;
}

/** Escape XML special characters. */
function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Generate the full modelDescription.xml string. */
function generateModelDescriptionXml(
  variables: FmiScalarVariable[],
  opts: FmuOptions & {
    guid: string;
    outputRefs: number[];
    derivativeRefs: number[];
    initialUnknownRefs: number[];
  },
): string {
  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push("<fmiModelDescription");
  lines.push('  fmiVersion="2.0"');
  lines.push(`  modelName="${escapeXml(opts.modelIdentifier)}"`);
  lines.push(`  guid="${escapeXml(opts.guid)}"`);
  if (opts.description) lines.push(`  description="${escapeXml(opts.description)}"`);
  if (opts.author) lines.push(`  author="${escapeXml(opts.author)}"`);
  lines.push(`  generationTool="${escapeXml(opts.generationTool ?? "ModelScript")}"`);
  lines.push(`  generationDateAndTime="${new Date().toISOString()}"`);
  lines.push('  variableNamingConvention="structured"');
  lines.push('  numberOfEventIndicators="0">');

  // CoSimulation element
  lines.push("");
  lines.push(`  <CoSimulation modelIdentifier="${escapeXml(opts.modelIdentifier)}" />`);

  // Default experiment
  lines.push("");
  lines.push("  <DefaultExperiment");
  lines.push(`    startTime="${opts.startTime ?? 0}"`);
  lines.push(`    stopTime="${opts.stopTime ?? 1}"`);
  lines.push(`    stepSize="${opts.stepSize ?? 0.001}" />`);

  // Model variables
  lines.push("");
  lines.push("  <ModelVariables>");
  for (const sv of variables) {
    lines.push(`    <!-- ${escapeXml(sv.name)} -->`);
    lines.push(
      `    <ScalarVariable name="${escapeXml(sv.name)}" valueReference="${sv.valueReference}" causality="${sv.causality}" variability="${sv.variability}">`,
    );
    const startAttr = sv.start !== undefined ? ` start="${sv.start}"` : "";
    const unitAttr = sv.unit ? ` unit="${escapeXml(sv.unit)}"` : "";
    lines.push(`      <${sv.type}${startAttr}${unitAttr} />`);
    lines.push("    </ScalarVariable>");
  }
  lines.push("  </ModelVariables>");

  // Model structure
  lines.push("");
  lines.push("  <ModelStructure>");

  if (opts.outputRefs.length > 0) {
    lines.push("    <Outputs>");
    for (const ref of opts.outputRefs) {
      const idx = variables.findIndex((v) => v.valueReference === ref);
      if (idx >= 0) lines.push(`      <Unknown index="${idx + 1}" />`);
    }
    lines.push("    </Outputs>");
  }

  if (opts.derivativeRefs.length > 0) {
    lines.push("    <Derivatives>");
    for (const ref of opts.derivativeRefs) {
      const idx = variables.findIndex((v) => v.valueReference === ref);
      if (idx >= 0) lines.push(`      <Unknown index="${idx + 1}" />`);
    }
    lines.push("    </Derivatives>");
  }

  if (opts.initialUnknownRefs.length > 0) {
    lines.push("    <InitialUnknowns>");
    for (const ref of opts.initialUnknownRefs) {
      const idx = variables.findIndex((v) => v.valueReference === ref);
      if (idx >= 0) lines.push(`      <Unknown index="${idx + 1}" />`);
    }
    lines.push("    </InitialUnknowns>");
  }

  lines.push("  </ModelStructure>");
  lines.push("");
  lines.push("</fmiModelDescription>");

  return lines.join("\n");
}
