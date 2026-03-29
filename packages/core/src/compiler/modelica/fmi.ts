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
  /** Display unit (optional). */
  displayUnit?: string;
  /** For state variables: index of the corresponding derivative variable. */
  derivative?: number;
  /** Alias type: "noAlias" (default), "alias", or "negatedAlias". */
  alias?: "noAlias" | "alias" | "negatedAlias";
  /** FMI 2.0 initial attribute. */
  initial?: "exact" | "approx" | "calculated";
  /** Declared type name (for TypeDefinitions linkage). */
  declaredType?: string;
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
  /** Enumeration type definitions: typeName → literals. */
  const enumTypes = new Map<string, { name: string; description: string | null }[]>();

  for (const v of dae.variables) {
    const sv = mapVariable(v, valueRef++);
    scalarVariables.push(sv);

    // Track enumeration type names for TypeDefinitions
    if (v instanceof ModelicaEnumerationVariable && v.enumerationLiterals.length > 0) {
      const typeName = v.enumerationLiterals[0]?.typeName;
      if (typeName && !enumTypes.has(typeName)) {
        enumTypes.set(
          typeName,
          v.enumerationLiterals.map((lit) => ({ name: lit.stringValue, description: lit.description })),
        );
      }
      if (typeName) sv.declaredType = typeName;
    }
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

  // ── Detect alias variables ──
  // Scan equations for trivial `a = b` pairs (both sides are name references).
  // When found, the second variable shares the first's valueReference.
  const aliasMap = detectAliases(dae, scalarVariables);

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

  // ── Compute dependencies ──
  const deps = computeDependencies(dae, scalarVariables, outputRefs, derivativeRefs, initialUnknownRefs);

  // ── Generate modelDescription.xml ──
  const fmuType = options.fmuType ?? { modelExchange: true, coSimulation: true };
  const nEventIndicators = countEventIndicators(dae);
  const xml = generateModelDescriptionXml(scalarVariables, {
    ...options,
    guid,
    outputRefs,
    derivativeRefs,
    initialUnknownRefs,
    fmuType,
    nEventIndicators,
    aliasMap,
    deps,
    enumTypes,
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
    numberOfEventIndicators: nEventIndicators,
  };
}

// ── Internal helpers ──

/**
 * Count event indicators from when-equations in the DAE.
 * Each when-equation condition (main + elseWhen) becomes one event indicator.
 */
function countEventIndicators(dae: ModelicaDAE): number {
  return dae.eventIndicators.length;
}

/**
 * Detect alias variable groups from trivial `a = b` equations.
 * Returns a map: alias variable name → primary variable name.
 */
function detectAliases(dae: ModelicaDAE, scalarVariables: FmiScalarVariable[]): Map<string, string> {
  const aliasMap = new Map<string, string>();
  const svByName = new Map<string, FmiScalarVariable>();
  for (const sv of scalarVariables) svByName.set(sv.name, sv);

  for (const eq of dae.equations) {
    if (!(eq instanceof ModelicaSimpleEquation)) continue;
    const lhs = eq.expression1;
    const rhs = eq.expression2;
    // Both sides must be simple name references (no subscripts, no operators)
    if (!(lhs instanceof ModelicaNameExpression) || !(rhs instanceof ModelicaNameExpression)) continue;

    const lhsName = lhs.name;
    const rhsName = rhs.name;
    const lhsSv = svByName.get(lhsName);
    const rhsSv = svByName.get(rhsName);
    if (!lhsSv || !rhsSv) continue;
    // Skip if either is a derivative or state variable
    if (lhsSv.derivative !== undefined || rhsSv.derivative !== undefined) continue;
    // Skip if causalities differ in incompatible ways
    if (lhsSv.type !== rhsSv.type) continue;

    // Make rhs an alias of lhs (lhs is the primary)
    if (!aliasMap.has(rhsName) && !aliasMap.has(lhsName)) {
      rhsSv.valueReference = lhsSv.valueReference;
      rhsSv.alias = "alias";
      aliasMap.set(rhsName, lhsName);
    }
  }

  return aliasMap;
}

/**
 * Compute variable dependency graph for ModelStructure.
 * For each output/derivative/initial-unknown, find which inputs/states it depends on.
 */
/** A single entry in the enriched FMI 2.0 dependency graph. */
interface DepEntry2 {
  vr: number;
  kind: "dependent" | "constant" | "fixed" | "tunable";
}

/** Map FMI 2.0 variability to dependency kind. */
function variabilityToDepKind2(v: FmiVariability): DepEntry2["kind"] {
  switch (v) {
    case "constant":
      return "constant";
    case "fixed":
      return "fixed";
    case "tunable":
      return "tunable";
    default:
      return "dependent";
  }
}

function computeDependencies(
  dae: ModelicaDAE,
  scalarVariables: FmiScalarVariable[],
  outputRefs: number[],
  derivativeRefs: number[],
  initialUnknownRefs: number[],
): Map<number, DepEntry2[]> {
  const deps = new Map<number, DepEntry2[]>();
  const svByName = new Map<string, FmiScalarVariable>();
  for (const sv of scalarVariables) svByName.set(sv.name, sv);

  // Build a map from LHS variable name → equation RHS names
  const equationDeps = new Map<string, Set<string>>();
  for (const eq of dae.equations) {
    if (!(eq instanceof ModelicaSimpleEquation)) continue;
    const lhs = eq.expression1;
    if (lhs instanceof ModelicaNameExpression) {
      const names = new Set<string>();
      collectExpressionNames(eq.expression2, names);
      equationDeps.set(lhs.name, names);
    }
  }

  const allUnknownRefs = [...outputRefs, ...derivativeRefs, ...initialUnknownRefs];
  for (const ref of allUnknownRefs) {
    const sv = scalarVariables.find((v) => v.valueReference === ref);
    if (!sv) continue;

    const rhsNames = equationDeps.get(sv.name);
    if (!rhsNames) continue;

    // Map referenced names to their value references with enriched kinds
    const entries: DepEntry2[] = [];
    for (const name of rhsNames) {
      const depSv = svByName.get(name);
      if (depSv && depSv.valueReference !== ref) {
        entries.push({ vr: depSv.valueReference, kind: variabilityToDepKind2(depSv.variability) });
      }
    }
    if (entries.length > 0) {
      deps.set(
        ref,
        entries.sort((a, b) => a.vr - b.vr),
      );
    }
  }

  return deps;
}

/** Recursively collect all variable name references from an expression. */
function collectExpressionNames(expr: ModelicaExpression, names: Set<string>): void {
  if (expr instanceof ModelicaNameExpression) {
    names.add(expr.name);
  } else if (expr instanceof ModelicaBinaryExpression) {
    collectExpressionNames(expr.operand1, names);
    collectExpressionNames(expr.operand2, names);
  } else if (expr instanceof ModelicaUnaryExpression) {
    collectExpressionNames(expr.operand, names);
  } else if (expr instanceof ModelicaSubscriptedExpression) {
    collectExpressionNames(expr.base, names);
    for (const sub of expr.subscripts) collectExpressionNames(sub, names);
  } else if (expr instanceof ModelicaArray) {
    for (const el of expr.elements) collectExpressionNames(el, names);
  } else if (expr instanceof ModelicaIfElseExpression) {
    collectExpressionNames(expr.condition, names);
    collectExpressionNames(expr.thenExpression, names);
    collectExpressionNames(expr.elseExpression, names);
  } else if (expr instanceof ModelicaFunctionCallExpression) {
    for (const arg of expr.args) collectExpressionNames(arg, names);
  }
}

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
  // Extract displayUnit
  const displayUnitAttr = v.attributes.get("displayUnit");
  if (displayUnitAttr) {
    const duVal = extractStringLiteral(displayUnitAttr);
    if (duVal) sv.displayUnit = duVal;
  }

  // Determine initial attribute per FMI 2.0 spec
  const initialVal = mapInitial(sv.causality, sv.variability);
  if (initialVal) sv.initial = initialVal;

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

/** Determine the FMI 2.0 `initial` attribute from causality + variability. */
function mapInitial(
  causality: FmiCausality,
  variability: FmiVariability,
): "exact" | "approx" | "calculated" | undefined {
  if (causality === "parameter") return "exact";
  if (causality === "input") return undefined; // inputs have no initial
  if (causality === "independent") return undefined;
  if (causality === "output") return "calculated";
  // causality === "local"
  if (variability === "constant") return "exact";
  if (variability === "fixed" || variability === "tunable") return "calculated";
  return "calculated";
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
    nEventIndicators: number;
    deps: Map<number, DepEntry2[]>;
    aliasMap: Map<string, string>;
    enumTypes: Map<string, { name: string; description: string | null }[]>;
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
  lines.push(`  numberOfEventIndicators="${opts.nEventIndicators}">`);

  // ModelExchange element
  if (opts.fmuType.modelExchange) {
    lines.push("");
    lines.push(
      `  <ModelExchange modelIdentifier="${escapeXml(opts.modelIdentifier)}" completedIntegratorStepNotNeeded="true" canGetAndSetFMUstate="true" canSerializeFMUstate="true" providesDirectionalDerivative="true" />`,
    );
  }

  // CoSimulation element
  if (opts.fmuType.coSimulation) {
    lines.push("");
    lines.push(
      `  <CoSimulation modelIdentifier="${escapeXml(opts.modelIdentifier)}" canHandleVariableCommunicationStepSize="true" canInterpolateInputs="true" maxOutputDerivativeOrder="0" canGetAndSetFMUstate="true" canSerializeFMUstate="true" providesDirectionalDerivative="true" />`,
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

  // Default experiment
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
      lines.push(`    <SimpleType name="${escapeXml(typeName)}">`);
      lines.push("      <Enumeration>");
      for (const lit of literals) {
        const descAttr = lit.description ? ` description="${escapeXml(lit.description)}"` : "";
        lines.push(`        <Item name="${escapeXml(lit.name)}"${descAttr} />`);
      }
      lines.push("      </Enumeration>");
      lines.push("    </SimpleType>");
    }
    lines.push("  </TypeDefinitions>");
  }

  // Model variables
  lines.push("");
  lines.push("  <ModelVariables>");
  for (const sv of variables) {
    lines.push(`    <!-- ${escapeXml(sv.name)} -->`);
    const descAttr = sv.description ? ` description="${escapeXml(sv.description)}"` : "";
    const aliasAttr = sv.alias && sv.alias !== "noAlias" ? ` alias="${sv.alias}"` : "";
    const initialAttr = sv.initial ? ` initial="${sv.initial}"` : "";
    lines.push(
      `    <ScalarVariable name="${escapeXml(sv.name)}" valueReference="${sv.valueReference}" causality="${sv.causality}" variability="${sv.variability}"${descAttr}${aliasAttr}${initialAttr}>`,
    );
    const startAttr = sv.start !== undefined ? ` start="${sv.start}"` : "";
    const unitAttr = sv.unit ? ` unit="${escapeXml(sv.unit)}"` : "";
    const duAttr = sv.displayUnit ? ` displayUnit="${escapeXml(sv.displayUnit)}"` : "";
    const derivAttr = sv.derivative !== undefined ? ` derivative="${sv.derivative}"` : "";
    const declTypeAttr = sv.declaredType ? ` declaredType="${escapeXml(sv.declaredType)}"` : "";
    lines.push(`      <${sv.type}${startAttr}${unitAttr}${duAttr}${derivAttr}${declTypeAttr} />`);
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
      if (idx >= 0) lines.push(formatUnknown(idx + 1, ref, opts.deps, variables));
    }
    lines.push("    </Outputs>");
  }

  if (opts.derivativeRefs.length > 0) {
    lines.push("    <Derivatives>");
    for (const ref of opts.derivativeRefs) {
      const idx = variables.findIndex((v) => v.valueReference === ref);
      if (idx >= 0) lines.push(formatUnknown(idx + 1, ref, opts.deps, variables));
    }
    lines.push("    </Derivatives>");
  }

  if (opts.initialUnknownRefs.length > 0) {
    lines.push("    <InitialUnknowns>");
    for (const ref of opts.initialUnknownRefs) {
      const idx = variables.findIndex((v) => v.valueReference === ref);
      if (idx >= 0) lines.push(formatUnknown(idx + 1, ref, opts.deps, variables));
    }
    lines.push("    </InitialUnknowns>");
  }

  lines.push("  </ModelStructure>");
  lines.push("");
  lines.push("</fmiModelDescription>");

  return lines.join("\n");
}

/** Format an <Unknown> element with optional dependency attributes. */
function formatUnknown(
  index: number,
  ref: number,
  deps: Map<number, DepEntry2[]>,
  variables: FmiScalarVariable[],
): string {
  const entries = deps.get(ref);
  if (!entries || entries.length === 0) {
    return `      <Unknown index="${index}" />`;
  }
  // Convert VRs to 1-based indices
  const depItems = entries
    .map((e) => ({ idx: variables.findIndex((v) => v.valueReference === e.vr) + 1, kind: e.kind }))
    .filter((d) => d.idx > 0);
  const depsAttr = ` dependencies="${depItems.map((d) => d.idx).join(" ")}"`;
  const kindsAttr = ` dependenciesKind="${depItems.map((d) => d.kind).join(" ")}"`;
  return `      <Unknown index="${index}"${depsAttr}${kindsAttr} />`;
}
