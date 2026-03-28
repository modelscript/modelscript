// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMI 2.0 Model Exchange & Co-Simulation FMU generator.
 *
 * Generates the modelDescription.xml, optional C source files, and
 * packages a .fmu ZIP archive from a flattened ModelicaDAE.
 *
 * Works in both browser and Node.js environments.
 *
 * FMI 2.0 specification: https://fmi-standard.org/
 */

import type { ModelicaDAE, ModelicaVariable } from "./dae.js";
import {
  ModelicaBooleanVariable,
  ModelicaEnumerationVariable,
  ModelicaIntegerVariable,
  ModelicaRealVariable,
  ModelicaStringVariable,
} from "./dae.js";
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
  /** For state variables: index of the corresponding derivative variable. */
  derivative?: number;
}

/** FMU type support flags. */
export interface FmuTypeFlags {
  /** Include ModelExchange element. */
  modelExchange?: boolean;
  /** Include CoSimulation element. */
  coSimulation?: boolean;
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
  /** FMU type flags (default: both ME and CS). */
  fmuType?: FmuTypeFlags | undefined;
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
  /** GUID assigned to this FMU. */
  guid: string;
  /** Number of event indicators. */
  numberOfEventIndicators: number;
}

/**
 * Generate FMU 2.0 model description from a DAE.
 *
 * Supports both Model Exchange and Co-Simulation (configurable via options).
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

  // Map from state variable name → its valueReference (for derivative linkage)
  const stateVarRefs = new Map<string, number>();
  const states = stateVars ?? new Set<string>();

  for (const v of dae.variables) {
    const sv = mapVariable(v, valueRef++);
    scalarVariables.push(sv);

    // Track state variable references for derivative linkage
    if (states.has(v.name)) {
      stateVarRefs.set(v.name, sv.valueReference);
    }

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
  for (const v of dae.variables) {
    if (states.has(v.name)) {
      const stateRef = stateVarRefs.get(v.name);
      const derSv: FmiScalarVariable = {
        valueReference: valueRef++,
        name: `der(${v.name})`,
        causality: "local",
        variability: "continuous",
        type: "Real",
        start: 0,
      };
      if (stateRef !== undefined) derSv.derivative = stateRef;
      scalarVariables.push(derSv);
      derivativeRefs.push(derSv.valueReference);
    }
  }

  // ── Generate modelDescription.xml ──
  const fmuType = options.fmuType ?? { modelExchange: true, coSimulation: true };
  const xml = generateModelDescriptionXml(scalarVariables, {
    ...options,
    guid,
    outputRefs,
    derivativeRefs,
    initialUnknownRefs,
    fmuType,
  });

  return {
    modelDescriptionXml: xml,
    scalarVariables,
    modelStructure: {
      outputs: outputRefs,
      derivatives: derivativeRefs,
      initialUnknowns: initialUnknownRefs,
    },
    guid,
    numberOfEventIndicators: 0,
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
    type: mapType(v),
  };
  if (v.description) sv.description = v.description;

  // Extract start value: first check the 'start' attribute, then the binding expression
  const startAttr = v.attributes.get("start");
  if (startAttr) {
    const startVal = extractNumericLiteral(startAttr);
    if (startVal !== null) sv.start = startVal;
  }
  if (sv.start === undefined && v.expression) {
    const startVal = extractNumericLiteral(v.expression);
    if (startVal !== null) sv.start = startVal;
  }
  // Default start for continuous variables
  if (sv.start === undefined && sv.variability === "continuous") {
    sv.start = 0;
  }

  // Extract unit from attributes
  const unitAttr = v.attributes.get("unit");
  if (unitAttr) {
    const unitVal = extractStringLiteral(unitAttr);
    if (unitVal) sv.unit = unitVal;
  }

  return sv;
}

/** Determine the FMI type from a Modelica variable. */
function mapType(v: ModelicaVariable): "Real" | "Integer" | "Boolean" | "String" {
  if (v instanceof ModelicaRealVariable) return "Real";
  if (v instanceof ModelicaIntegerVariable) return "Integer";
  if (v instanceof ModelicaBooleanVariable) return "Boolean";
  if (v instanceof ModelicaStringVariable) return "String";
  if (v instanceof ModelicaEnumerationVariable) return "Integer";
  return "Real";
}

/** Map Modelica causality to FMI causality. */
function mapCausality(v: ModelicaVariable): FmiCausality {
  if (v.variability === ModelicaVariability.PARAMETER) return "parameter";
  if (v.variability === ModelicaVariability.CONSTANT) return "parameter";
  if (v.causality === "input") return "input";
  if (v.causality === "output") return "output";
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

/** Extract a numeric literal value from a DAE expression. */
function extractNumericLiteral(expr: unknown): number | null {
  if (!expr || typeof expr !== "object") return null;
  if ("value" in expr && typeof (expr as { value: unknown }).value === "number") {
    return (expr as { value: number }).value;
  }
  return null;
}

/** Extract a string literal value from a DAE expression. */
function extractStringLiteral(expr: unknown): string | null {
  if (!expr || typeof expr !== "object") return null;
  if ("value" in expr && typeof (expr as { value: unknown }).value === "string") {
    return (expr as { value: string }).value;
  }
  return null;
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
    fmuType: FmuTypeFlags;
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

  // ModelExchange element
  if (opts.fmuType.modelExchange) {
    lines.push("");
    lines.push(`  <ModelExchange modelIdentifier="${escapeXml(opts.modelIdentifier)}" />`);
  }

  // CoSimulation element
  if (opts.fmuType.coSimulation) {
    lines.push("");
    lines.push(`  <CoSimulation modelIdentifier="${escapeXml(opts.modelIdentifier)}" />`);
  }

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
    const descAttr = sv.description ? ` description="${escapeXml(sv.description)}"` : "";
    lines.push(
      `    <ScalarVariable name="${escapeXml(sv.name)}" valueReference="${sv.valueReference}" causality="${sv.causality}" variability="${sv.variability}"${descAttr}>`,
    );
    const startAttr = sv.start !== undefined ? ` start="${sv.start}"` : "";
    const unitAttr = sv.unit ? ` unit="${escapeXml(sv.unit)}"` : "";
    const derivAttr = sv.derivative !== undefined ? ` derivative="${sv.derivative}"` : "";
    lines.push(`      <${sv.type}${startAttr}${unitAttr}${derivAttr} />`);
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
