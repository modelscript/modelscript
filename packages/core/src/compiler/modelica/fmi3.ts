// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMI 3.0 Model Exchange & Co-Simulation FMU generator.
 *
 * Generates the FMI 3.0 modelDescription.xml from a flattened ModelicaDAE.
 *
 * Key differences from FMI 2.0:
 *   - Explicit precision types (Float64, Int32, etc.) instead of Real/Integer
 *   - Native array support via <Dimension> elements
 *   - Clock variables for hybrid co-simulation
 *   - Intermediate update callback support
 *   - Terminals & Icons for port geometry
 *
 * FMI 3.0 specification: https://fmi-standard.org/
 */

import type { ModelicaDAE, ModelicaExpression, ModelicaVariable } from "./dae.js";
import {
  ModelicaArray,
  ModelicaBinaryExpression,
  ModelicaBooleanVariable,
  ModelicaEnumerationVariable,
  ModelicaFunctionCallExpression,
  ModelicaIfElseExpression,
  ModelicaIntegerVariable,
  ModelicaNameExpression,
  ModelicaRealVariable,
  ModelicaSimpleEquation,
  ModelicaStringVariable,
  ModelicaSubscriptedExpression,
  ModelicaUnaryExpression,
  ModelicaWhenEquation,
} from "./dae.js";
import { ModelicaVariability } from "./syntax.js";

// ── Public interface ──

/** FMI 3.0 variable causality. */
export type Fmi3Causality =
  | "input"
  | "output"
  | "parameter"
  | "structuralParameter"
  | "calculatedParameter"
  | "local"
  | "independent";

/** FMI 3.0 variable variability. */
export type Fmi3Variability = "constant" | "fixed" | "tunable" | "discrete" | "continuous";

/** FMI 3.0 initial attribute values. */
export type Fmi3Initial = "exact" | "approx" | "calculated";

/**
 * FMI 3.0 variable type.
 * FMI 3.0 uses explicit precision types instead of FMI 2.0's generic Real/Integer.
 */
export type Fmi3Type =
  | "Float64"
  | "Float32"
  | "Int64"
  | "Int32"
  | "Int16"
  | "Int8"
  | "UInt64"
  | "UInt32"
  | "UInt16"
  | "UInt8"
  | "Boolean"
  | "String"
  | "Binary"
  | "Enumeration"
  | "Clock";

/** Array dimension descriptor. */
export interface Fmi3Dimension {
  /** Fixed size (known at compile time). */
  start?: number;
  /** Value reference whose current value determines the size (structural parameter). */
  valueReference?: number;
}

/** FMI 3.0 model variable descriptor. */
export interface Fmi3Variable {
  /** Unique value reference (integer index). */
  valueReference: number;
  /** Name of the variable (dot-qualified Modelica name). */
  name: string;
  /** FMI 3.0 causality. */
  causality: Fmi3Causality;
  /** FMI 3.0 variability. */
  variability: Fmi3Variability;
  /** Description string (optional). */
  description?: string;
  /** Data type. */
  type: Fmi3Type;
  /** Start value (for numeric types). */
  start?: number | number[];
  /** SI unit string (optional, for Float types). */
  unit?: string;
  /** Display unit (optional). */
  displayUnit?: string;
  /** For state variables: VR of the corresponding derivative variable. */
  derivative?: number;
  /** FMI 3.0 initial attribute. */
  initial?: Fmi3Initial;
  /** Declared type name (linkage to TypeDefinitions). */
  declaredType?: string;
  /** Array dimensions (empty for scalar variables). */
  dimensions?: Fmi3Dimension[];
  /** For Clock variables: interval type. */
  intervalVariability?: "constant" | "fixed" | "tunable" | "changing" | "countdown" | "triggered";
  /** Alias variable name (if this is an alias). */
  aliasOf?: string;
}

/** FMU 3.0 type support flags. */
export interface Fmi3TypeFlags {
  /** Include ModelExchange element. */
  modelExchange?: boolean;
  /** Include CoSimulation element. */
  coSimulation?: boolean;
  /** Include ScheduledExecution element (new in FMI 3.0). */
  scheduledExecution?: boolean;
}

/** FMU 3.0 generation options. */
export interface Fmi3Options {
  /** Model identifier. */
  modelIdentifier: string;
  /** Description of the model. */
  description?: string;
  /** Author name. */
  author?: string;
  /** Generation tool name. */
  generationTool?: string;
  /** GUID (auto-generated if not provided). */
  guid?: string;
  /** Default experiment start time. */
  startTime?: number;
  /** Default experiment stop time. */
  stopTime?: number;
  /** Default experiment step size. */
  stepSize?: number;
  /** FMU type flags. */
  fmuType?: Fmi3TypeFlags;
}

/** Result of FMI 3.0 FMU generation. */
export interface Fmi3Result {
  /** The modelDescription.xml content. */
  modelDescriptionXml: string;
  /** Variable descriptors. */
  variables: Fmi3Variable[];
  /** Model structure. */
  modelStructure: {
    outputs: number[];
    derivatives: number[];
    initialUnknowns: number[];
    continuousStateDerivatives: number[];
    clocks: number[];
  };
  /** GUID assigned to this FMU. */
  guid: string;
  /** Number of event indicators. */
  numberOfEventIndicators: number;
}

// ── Main generator ──

/**
 * Generate FMI 3.0 model description from a DAE.
 */
export function generateFmi3(dae: ModelicaDAE, options: Fmi3Options, stateVars?: Set<string>): Fmi3Result {
  const guid = options.guid ?? generateGuid();
  const variables: Fmi3Variable[] = [];
  let valueRef = 0;

  // ── Time variable (independent) ──
  variables.push({
    valueReference: valueRef++,
    name: "time",
    causality: "independent",
    variability: "continuous",
    type: "Float64",
  });

  // ── Model variables ──
  const outputRefs: number[] = [];
  const derivativeRefs: number[] = [];
  const initialUnknownRefs: number[] = [];
  const clockRefs: number[] = [];

  const stateVarRefs = new Map<string, number>();
  const states = stateVars ?? new Set<string>();
  const enumTypes = new Map<string, { name: string; description: string | null }[]>();

  for (const v of dae.variables) {
    const fv = mapVariable3(v, valueRef++);
    variables.push(fv);

    // Track enumeration type names for TypeDefinitions
    if (v instanceof ModelicaEnumerationVariable && v.enumerationLiterals.length > 0) {
      const firstLit = v.enumerationLiterals[0];
      const typeName = firstLit?.typeName;
      if (typeName && !enumTypes.has(typeName)) {
        enumTypes.set(
          typeName,
          v.enumerationLiterals.map((lit) => ({ name: lit.stringValue, description: lit.description })),
        );
      }
      if (typeName) fv.declaredType = typeName;
    }

    if (states.has(v.name)) {
      stateVarRefs.set(v.name, fv.valueReference);
    }
    if (fv.causality === "output") {
      outputRefs.push(fv.valueReference);
    }
    if (fv.variability === "continuous" && fv.causality === "local") {
      initialUnknownRefs.push(fv.valueReference);
    }
  }

  // ── Alias detection ──
  const aliasMap = detectAliases3(dae, variables);

  // ── Derivative variables ──
  for (const v of dae.variables) {
    if (states.has(v.name)) {
      const stateRef = stateVarRefs.get(v.name);
      const derFv: Fmi3Variable = {
        valueReference: valueRef++,
        name: `der(${v.name})`,
        causality: "local",
        variability: "continuous",
        type: "Float64",
        start: 0,
      };
      if (stateRef !== undefined) derFv.derivative = stateRef;
      variables.push(derFv);
      derivativeRefs.push(derFv.valueReference);
    }
  }

  // ── Compute dependencies ──
  const deps = computeDependencies3(dae, variables, outputRefs, derivativeRefs, initialUnknownRefs);

  // ── Generate modelDescription.xml ──
  const fmuType = options.fmuType ?? { modelExchange: true, coSimulation: true };
  const nEventIndicators = countEventIndicators3(dae);
  const xml = generateModelDescriptionXml3(variables, {
    ...options,
    guid,
    outputRefs,
    derivativeRefs,
    initialUnknownRefs,
    clockRefs,
    fmuType,
    nEventIndicators,
    aliasMap,
    deps,
    enumTypes,
  });

  return {
    modelDescriptionXml: xml,
    variables,
    modelStructure: {
      outputs: outputRefs,
      derivatives: derivativeRefs,
      initialUnknowns: initialUnknownRefs,
      continuousStateDerivatives: derivativeRefs,
      clocks: clockRefs,
    },
    guid,
    numberOfEventIndicators: nEventIndicators,
  };
}

// ── Internal helpers ──

function countEventIndicators3(dae: ModelicaDAE): number {
  let count = 0;
  for (const eq of dae.equations) {
    if (eq instanceof ModelicaWhenEquation) {
      count++;
      count += eq.elseWhenClauses.length;
    }
  }
  return count;
}

function detectAliases3(dae: ModelicaDAE, variables: Fmi3Variable[]): Map<string, string> {
  const aliasMap = new Map<string, string>();
  const svByName = new Map<string, Fmi3Variable>();
  for (const sv of variables) svByName.set(sv.name, sv);

  for (const eq of dae.equations) {
    if (!(eq instanceof ModelicaSimpleEquation)) continue;
    const lhs = eq.expression1;
    const rhs = eq.expression2;
    if (!(lhs instanceof ModelicaNameExpression) || !(rhs instanceof ModelicaNameExpression)) continue;

    const lhsName = lhs.name;
    const rhsName = rhs.name;
    const lhsSv = svByName.get(lhsName);
    const rhsSv = svByName.get(rhsName);
    if (!lhsSv || !rhsSv) continue;
    if (lhsSv.derivative !== undefined || rhsSv.derivative !== undefined) continue;
    if (lhsSv.type !== rhsSv.type) continue;

    if (!aliasMap.has(rhsName) && !aliasMap.has(lhsName)) {
      rhsSv.valueReference = lhsSv.valueReference;
      rhsSv.aliasOf = lhsName;
      aliasMap.set(rhsName, lhsName);
    }
  }

  return aliasMap;
}

function computeDependencies3(
  dae: ModelicaDAE,
  variables: Fmi3Variable[],
  outputRefs: number[],
  derivativeRefs: number[],
  initialUnknownRefs: number[],
): Map<number, number[]> {
  const deps = new Map<number, number[]>();
  const svByName = new Map<string, Fmi3Variable>();
  for (const sv of variables) svByName.set(sv.name, sv);

  const equationDeps = new Map<string, Set<string>>();
  for (const eq of dae.equations) {
    if (!(eq instanceof ModelicaSimpleEquation)) continue;
    const lhs = eq.expression1;
    if (lhs instanceof ModelicaNameExpression) {
      const names = new Set<string>();
      collectExpressionNames3(eq.expression2, names);
      equationDeps.set(lhs.name, names);
    }
  }

  const allUnknownRefs = [...outputRefs, ...derivativeRefs, ...initialUnknownRefs];
  for (const ref of allUnknownRefs) {
    const sv = variables.find((v) => v.valueReference === ref);
    if (!sv) continue;
    const rhsNames = equationDeps.get(sv.name);
    if (!rhsNames) continue;

    const depRefs: number[] = [];
    for (const name of rhsNames) {
      const depSv = svByName.get(name);
      if (depSv && depSv.valueReference !== ref) {
        depRefs.push(depSv.valueReference);
      }
    }
    if (depRefs.length > 0) {
      deps.set(
        ref,
        depRefs.sort((a, b) => a - b),
      );
    }
  }

  return deps;
}

function collectExpressionNames3(expr: ModelicaExpression, names: Set<string>): void {
  if (expr instanceof ModelicaNameExpression) {
    names.add(expr.name);
  } else if (expr instanceof ModelicaBinaryExpression) {
    collectExpressionNames3(expr.operand1, names);
    collectExpressionNames3(expr.operand2, names);
  } else if (expr instanceof ModelicaUnaryExpression) {
    collectExpressionNames3(expr.operand, names);
  } else if (expr instanceof ModelicaSubscriptedExpression) {
    collectExpressionNames3(expr.base, names);
    for (const sub of expr.subscripts) collectExpressionNames3(sub, names);
  } else if (expr instanceof ModelicaArray) {
    for (const el of expr.elements) collectExpressionNames3(el, names);
  } else if (expr instanceof ModelicaIfElseExpression) {
    collectExpressionNames3(expr.condition, names);
    collectExpressionNames3(expr.thenExpression, names);
    collectExpressionNames3(expr.elseExpression, names);
  } else if (expr instanceof ModelicaFunctionCallExpression) {
    for (const arg of expr.args) collectExpressionNames3(arg, names);
  }
}

// ── Variable mapping ──

/** Map a Modelica variable to an FMI 3.0 variable. */
function mapVariable3(v: ModelicaVariable, valueRef: number): Fmi3Variable {
  const fv: Fmi3Variable = {
    valueReference: valueRef,
    name: v.name,
    causality: mapCausality3(v),
    variability: mapVariability3(v),
    type: mapType3(v),
  };
  if (v.description) fv.description = v.description;

  // Extract start value
  const startAttr = v.attributes.get("start");
  if (startAttr) {
    const startVal = extractNumericLiteral(startAttr);
    if (startVal !== null) fv.start = startVal;
  }
  if (fv.start === undefined && v.expression) {
    const startVal = extractNumericLiteral(v.expression);
    if (startVal !== null) fv.start = startVal;
  }
  if (fv.start === undefined && fv.variability === "continuous") {
    fv.start = 0;
  }

  // Extract unit
  const unitAttr = v.attributes.get("unit");
  if (unitAttr) {
    const unitVal = extractStringLiteral(unitAttr);
    if (unitVal) fv.unit = unitVal;
  }
  const displayUnitAttr = v.attributes.get("displayUnit");
  if (displayUnitAttr) {
    const duVal = extractStringLiteral(displayUnitAttr);
    if (duVal) fv.displayUnit = duVal;
  }

  // Determine initial attribute per FMI 3.0 rules
  const initialVal = mapInitial3(fv.causality, fv.variability);
  if (initialVal) fv.initial = initialVal;

  return fv;
}

/** Map Modelica type to FMI 3.0 precise type. */
function mapType3(v: ModelicaVariable): Fmi3Type {
  if (v instanceof ModelicaRealVariable) return "Float64";
  if (v instanceof ModelicaIntegerVariable) return "Int32";
  if (v instanceof ModelicaBooleanVariable) return "Boolean";
  if (v instanceof ModelicaStringVariable) return "String";
  if (v instanceof ModelicaEnumerationVariable) return "Enumeration";
  return "Float64";
}

function mapCausality3(v: ModelicaVariable): Fmi3Causality {
  if (v.variability === ModelicaVariability.PARAMETER) return "parameter";
  if (v.variability === ModelicaVariability.CONSTANT) return "calculatedParameter";
  if (v.causality === "input") return "input";
  if (v.causality === "output") return "output";
  return "local";
}

function mapVariability3(v: ModelicaVariable): Fmi3Variability {
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

function mapInitial3(causality: Fmi3Causality, variability: Fmi3Variability): Fmi3Initial | undefined {
  if (causality === "parameter") return "exact";
  if (causality === "calculatedParameter") return "calculated";
  if (causality === "structuralParameter") return "exact";
  if (causality === "input") return undefined;
  if (causality === "independent") return undefined;
  if (causality === "output") return "calculated";
  // causality === "local"
  if (variability === "constant") return "exact";
  if (variability === "fixed" || variability === "tunable") return "calculated";
  return "calculated";
}

// ── XML generation ──

function generateModelDescriptionXml3(
  variables: Fmi3Variable[],
  opts: Fmi3Options & {
    guid: string;
    outputRefs: number[];
    derivativeRefs: number[];
    initialUnknownRefs: number[];
    clockRefs: number[];
    fmuType: Fmi3TypeFlags;
    nEventIndicators: number;
    deps: Map<number, number[]>;
    aliasMap: Map<string, string>;
    enumTypes: Map<string, { name: string; description: string | null }[]>;
  },
): string {
  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push("<fmiModelDescription");
  lines.push('  fmiVersion="3.0"');
  lines.push(`  modelName="${escapeXml(opts.modelIdentifier)}"`);
  lines.push(`  instantiationToken="${escapeXml(opts.guid)}"`);
  if (opts.description) lines.push(`  description="${escapeXml(opts.description)}"`);
  if (opts.author) lines.push(`  author="${escapeXml(opts.author)}"`);
  lines.push(`  generationTool="${escapeXml(opts.generationTool ?? "ModelScript")}"`);
  lines.push(`  generationDateAndTime="${new Date().toISOString()}"`);
  lines.push('  variableNamingConvention="structured">');

  // ModelExchange element
  if (opts.fmuType.modelExchange) {
    lines.push("");
    lines.push(
      `  <ModelExchange modelIdentifier="${escapeXml(opts.modelIdentifier)}" canGetAndSetFMUState="true" canSerializeFMUState="true" providesDirectionalDerivatives="true" />`,
    );
  }

  // CoSimulation element
  if (opts.fmuType.coSimulation) {
    lines.push("");
    lines.push(
      `  <CoSimulation modelIdentifier="${escapeXml(opts.modelIdentifier)}" canHandleVariableCommunicationStepSize="true" canReturnEarlyAfterIntermediateUpdate="true" providesIntermediateUpdate="true" canGetAndSetFMUState="true" canSerializeFMUState="true" providesDirectionalDerivatives="true" />`,
    );
  }

  // ScheduledExecution element
  if (opts.fmuType.scheduledExecution) {
    lines.push("");
    lines.push(
      `  <ScheduledExecution modelIdentifier="${escapeXml(opts.modelIdentifier)}" canGetAndSetFMUState="true" canSerializeFMUState="true" />`,
    );
  }

  // LogCategories
  lines.push("");
  lines.push("  <LogCategories>");
  lines.push('    <Category name="logAll" />');
  lines.push('    <Category name="logError" />');
  lines.push('    <Category name="logEvents" />');
  lines.push('    <Category name="logStatusWarning" />');
  lines.push('    <Category name="logStatusDiscard" />');
  lines.push('    <Category name="logStatusPending" />');
  lines.push("  </LogCategories>");

  // DefaultExperiment
  lines.push("");
  lines.push("  <DefaultExperiment");
  lines.push(`    startTime="${opts.startTime ?? 0}"`);
  lines.push(`    stopTime="${opts.stopTime ?? 1}"`);
  lines.push(`    stepSize="${opts.stepSize ?? 0.001}" />`);

  // UnitDefinitions
  const units = new Set<string>();
  for (const sv of variables) {
    if (sv.unit) units.add(sv.unit);
    if (sv.displayUnit) units.add(sv.displayUnit);
  }
  if (units.size > 0) {
    lines.push("");
    lines.push("  <UnitDefinitions>");
    for (const u of units) {
      lines.push(`    <Unit name="${escapeXml(u)}" />`);
    }
    lines.push("  </UnitDefinitions>");
  }

  // TypeDefinitions (enumerations)
  if (opts.enumTypes.size > 0) {
    lines.push("");
    lines.push("  <TypeDefinitions>");
    for (const [typeName, literals] of opts.enumTypes) {
      lines.push(`    <Int32Type name="${escapeXml(typeName)}">`);
      for (let i = 0; i < literals.length; i++) {
        const lit = literals[i];
        if (!lit) continue;
        const descAttr = lit.description ? ` description="${escapeXml(lit.description)}"` : "";
        lines.push(`      <Item name="${escapeXml(lit.name)}" value="${i + 1}"${descAttr} />`);
      }
      lines.push("    </Int32Type>");
    }
    lines.push("  </TypeDefinitions>");
  }

  // Model variables
  lines.push("");
  lines.push("  <ModelVariables>");
  for (const sv of variables) {
    lines.push(`    <!-- ${escapeXml(sv.name)} -->`);
    const descAttr = sv.description ? ` description="${escapeXml(sv.description)}"` : "";
    const initialAttr = sv.initial ? ` initial="${sv.initial}"` : "";
    const unitAttr = sv.unit ? ` unit="${escapeXml(sv.unit)}"` : "";
    const duAttr = sv.displayUnit ? ` displayUnit="${escapeXml(sv.displayUnit)}"` : "";
    const derivAttr = sv.derivative !== undefined ? ` derivative="${sv.derivative}"` : "";
    const declTypeAttr = sv.declaredType ? ` declaredType="${escapeXml(sv.declaredType)}"` : "";
    const startAttr =
      sv.start !== undefined ? ` start="${Array.isArray(sv.start) ? sv.start.join(" ") : sv.start}"` : "";

    // FMI 3.0 uses the type name as the element tag (Float64, Int32, etc.)
    const hasInnerContent = sv.dimensions && sv.dimensions.length > 0;

    if (hasInnerContent) {
      lines.push(
        `    <${sv.type} name="${escapeXml(sv.name)}" valueReference="${sv.valueReference}" causality="${sv.causality}" variability="${sv.variability}"${descAttr}${initialAttr}${startAttr}${unitAttr}${duAttr}${derivAttr}${declTypeAttr}>`,
      );
      if (sv.dimensions) {
        for (const dim of sv.dimensions) {
          if (dim.start !== undefined) {
            lines.push(`      <Dimension start="${dim.start}" />`);
          } else if (dim.valueReference !== undefined) {
            lines.push(`      <Dimension valueReference="${dim.valueReference}" />`);
          }
        }
      }
      lines.push(`    </${sv.type}>`);
    } else {
      lines.push(
        `    <${sv.type} name="${escapeXml(sv.name)}" valueReference="${sv.valueReference}" causality="${sv.causality}" variability="${sv.variability}"${descAttr}${initialAttr}${startAttr}${unitAttr}${duAttr}${derivAttr}${declTypeAttr} />`,
      );
    }
  }
  lines.push("  </ModelVariables>");

  // ModelStructure
  lines.push("");
  lines.push("  <ModelStructure>");

  // Outputs
  if (opts.outputRefs.length > 0) {
    for (const ref of opts.outputRefs) {
      const idx = variables.findIndex((v) => v.valueReference === ref);
      if (idx >= 0) lines.push(formatUnknown3("Output", ref, opts.deps));
    }
  }

  // ContinuousStateDerivatives
  if (opts.derivativeRefs.length > 0) {
    for (const ref of opts.derivativeRefs) {
      const idx = variables.findIndex((v) => v.valueReference === ref);
      if (idx >= 0) lines.push(formatUnknown3("ContinuousStateDerivative", ref, opts.deps));
    }
  }

  // InitialUnknowns
  if (opts.initialUnknownRefs.length > 0) {
    for (const ref of opts.initialUnknownRefs) {
      const idx = variables.findIndex((v) => v.valueReference === ref);
      if (idx >= 0) lines.push(formatUnknown3("InitialUnknown", ref, opts.deps));
    }
  }

  // EventIndicators
  if (opts.nEventIndicators > 0) {
    for (let i = 0; i < opts.nEventIndicators; i++) {
      lines.push(`    <EventIndicator valueReference="${variables.length + i}" />`);
    }
  }

  lines.push("  </ModelStructure>");
  lines.push("");
  lines.push("</fmiModelDescription>");

  return lines.join("\n");
}

/** Format an Unknown/Output/ContinuousStateDerivative element. */
function formatUnknown3(elementName: string, ref: number, deps: Map<number, number[]>): string {
  const depRefs = deps.get(ref);
  if (!depRefs || depRefs.length === 0) {
    return `    <${elementName} valueReference="${ref}" />`;
  }
  const depsAttr = ` dependencies="${depRefs.join(" ")}"`;
  const kindsAttr = ` dependenciesKind="${depRefs.map(() => "dependent").join(" ")}"`;
  return `    <${elementName} valueReference="${ref}"${depsAttr}${kindsAttr} />`;
}

// ── Utility functions ──

function extractNumericLiteral(expr: unknown): number | null {
  if (!expr || typeof expr !== "object") return null;
  if ("value" in expr && typeof (expr as { value: unknown }).value === "number") {
    return (expr as { value: number }).value;
  }
  return null;
}

function extractStringLiteral(expr: unknown): string | null {
  if (!expr || typeof expr !== "object") return null;
  if ("value" in expr && typeof (expr as { value: unknown }).value === "string") {
    return (expr as { value: string }).value;
  }
  return null;
}

function generateGuid(): string {
  const hex = (n: number) =>
    Array.from({ length: n }, () =>
      Math.floor(Math.random() * 16)
        .toString(16)
        .toLowerCase(),
    ).join("");
  return `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
