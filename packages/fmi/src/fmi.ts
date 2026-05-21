// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMI 2.0 Model Exchange & Co-Simulation FMU generator.
 *
 * Generates the modelDescription.xml, optional C source files, and
 * packages a .fmu ZIP archive from a flattened ArenaDAEBuilder.
 *
 * Works in both browser and Node.js environments.
 *
 * FMI 2.0 specification: https://fmi-standard.org/
 */

import { type ArenaDAEBuilder, Causality, EqKind, ExprKind, Variability, VarType } from "@modelscript/compiler";
import type { SolverOptions } from "./solver-options.js";

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
  /** Data type: Real, Integer, Boolean, String, Clock. */
  type: "Real" | "Integer" | "Boolean" | "String" | "Clock";
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
  /** Solver configuration. */
  solverOptions?: SolverOptions;
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
  /** External C source files to include in CMake build (from `external "C"` annotations). */
  externalSources?: string[];
}

/**
 * Generate FMU 2.0 model description from an Arena DAE.
 */
export function generateFmu(dae: ArenaDAEBuilder, options: FmuOptions, _stateVars?: Set<string>): FmuResult {
  void _stateVars;
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

  const enumTypes = new Map<string, { name: string; description: string | null }[]>();

  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;
    const sv = mapVariable(dae, i, valueRef++);
    scalarVariables.push(sv);

    if (dae.getVarType(i) === VarType.Enumeration) {
      const literals = dae.getVarEnumerationLiterals(i);
      if (literals && literals.length > 0) {
        const typeName = `${sv.name}Type`;
        enumTypes.set(
          typeName,
          literals.map((lit: { name: string }) => ({ name: lit.name, description: null })),
        );
        sv.declaredType = typeName;
      }
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

  // Link derivative variables to state variables
  for (const sv of scalarVariables) {
    const match = sv.name.match(/^der\((.+)\)$/);
    if (match) {
      const stateName = match[1] ?? "";
      const stateSv = scalarVariables.find((v) => v.name === stateName);
      if (stateSv) {
        sv.derivative = stateSv.valueReference;
        derivativeRefs.push(sv.valueReference);
      }
    }
  }

  // ── Detect alias variables ──
  const aliasMap = detectAliases(dae, scalarVariables);

  // ── Compute dependencies ──
  const deps = computeDependencies(dae, scalarVariables, outputRefs, derivativeRefs, initialUnknownRefs);

  // ── Generate modelDescription.xml ──
  const fmuType = options.fmuType ?? { modelExchange: true, coSimulation: true };
  const nEventIndicators = dae.eventIndicatorExprIds.length;
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
 * Detect alias variable groups from trivial `a = b` equations.
 */
function detectAliases(dae: ArenaDAEBuilder, scalarVariables: FmiScalarVariable[]): Map<string, string> {
  const aliasMap = new Map<string, string>();
  const svByName = new Map<string, FmiScalarVariable>();
  for (const sv of scalarVariables) svByName.set(sv.name, sv);

  for (let idx = 0; idx < dae.eqCount; idx++) {
    if (dae.getEqKind(idx) !== EqKind.Simple) continue;
    const lhs = dae.getEqLhs(idx);
    const rhs = dae.getEqRhs(idx);
    if (dae.getExprKind(lhs) === ExprKind.Name && dae.getExprKind(rhs) === ExprKind.Name) {
      const lhsName = dae.interner.resolve(dae.getExprData1(lhs));
      const rhsName = dae.interner.resolve(dae.getExprData1(rhs));
      const lhsSv = svByName.get(lhsName);
      const rhsSv = svByName.get(rhsName);
      if (!lhsSv || !rhsSv) continue;
      if (lhsSv.derivative !== undefined || rhsSv.derivative !== undefined) continue;
      if (lhsSv.type !== rhsSv.type) continue;

      if (!aliasMap.has(rhsName) && !aliasMap.has(lhsName)) {
        rhsSv.valueReference = lhsSv.valueReference;
        rhsSv.alias = "alias";
        aliasMap.set(rhsName, lhsName);
      }
    }
  }

  return aliasMap;
}

/** A single entry in the enriched FMI 2.0 dependency graph. */
interface DepEntry2 {
  vr: number;
  kind: "dependent" | "constant" | "fixed" | "tunable";
}

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
  dae: ArenaDAEBuilder,
  scalarVariables: FmiScalarVariable[],
  outputRefs: number[],
  derivativeRefs: number[],
  initialUnknownRefs: number[],
): Map<number, DepEntry2[]> {
  const deps = new Map<number, DepEntry2[]>();
  const svByName = new Map<string, FmiScalarVariable>();
  for (const sv of scalarVariables) svByName.set(sv.name, sv);

  const equationDeps = new Map<string, Set<string>>();
  for (let idx = 0; idx < dae.eqCount; idx++) {
    if (dae.getEqKind(idx) !== EqKind.Simple) continue;
    const lhs = dae.getEqLhs(idx);
    const rhs = dae.getEqRhs(idx);
    if (dae.getExprKind(lhs) === ExprKind.Name) {
      const name = dae.interner.resolve(dae.getExprData1(lhs));
      const refNames = new Set<string>();
      collectReferencedNames(dae, rhs, refNames);
      equationDeps.set(name, refNames);
    }
  }

  const allUnknownRefs = [...outputRefs, ...derivativeRefs, ...initialUnknownRefs];
  for (const ref of allUnknownRefs) {
    const sv = scalarVariables.find((v) => v.valueReference === ref);
    if (!sv) continue;

    const rhsNames = equationDeps.get(sv.name);
    if (!rhsNames) continue;

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

function collectReferencedNames(dae: ArenaDAEBuilder, id: number, names: Set<string>): void {
  if (id < 0) return;
  switch (dae.getExprKind(id)) {
    case ExprKind.Name: {
      const name = dae.interner.resolve(dae.getExprData1(id));
      if (name.startsWith("der(") && name.endsWith(")")) {
        names.add(name.substring(4, name.length - 1));
      } else {
        names.add(name);
      }
      break;
    }
    case ExprKind.Binary:
      collectReferencedNames(dae, dae.getExprLeft(id), names);
      collectReferencedNames(dae, dae.getExprRight(id), names);
      break;
    case ExprKind.Unary:
    case ExprKind.Negate:
    case ExprKind.Der:
    case ExprKind.Pre:
      collectReferencedNames(dae, dae.getExprLeft(id), names);
      break;
    case ExprKind.Subscript: {
      collectReferencedNames(dae, dae.getExprData1(id), names);
      const scount = dae.getExprRight(id);
      for (let i = 0; i < scount; i++) {
        collectReferencedNames(dae, dae.getExprLeft(id + i), names);
      }
      break;
    }
    case ExprKind.ArrayCtor: {
      const count = dae.getExprData1(id);
      for (let i = 0; i < count; i++) {
        collectReferencedNames(dae, dae.getExprLeft(id + i), names);
      }
      break;
    }
    case ExprKind.IfElse:
      collectReferencedNames(dae, dae.getExprData1(id), names);
      collectReferencedNames(dae, dae.getExprLeft(id), names);
      collectReferencedNames(dae, dae.getExprRight(id), names);
      break;
    case ExprKind.Call: {
      const argCount = dae.getExprRight(id);
      for (let i = 0; i < argCount; i++) {
        collectReferencedNames(dae, dae.getExprLeft(id + i), names);
      }
      break;
    }
  }
}

/** Map an Arena DAE variable to an FMI scalar variable. */
function mapVariable(dae: ArenaDAEBuilder, idx: number, valueRef: number): FmiScalarVariable {
  const name = dae.getVarName(idx);
  const sv: FmiScalarVariable = {
    valueReference: valueRef,
    name: name,
    causality: mapCausality(dae.getVarCausality(idx), dae.getVarVariability(idx)),
    variability: mapVariability(dae.getVarVariability(idx)),
    type: mapType(dae.getVarType(idx)),
  };
  const desc = dae.getVarDescription(idx);
  if (desc) sv.description = desc;

  const startAttr = dae.getVarAttrExprId(idx, "start");
  if (startAttr !== undefined && startAttr >= 0) {
    const startVal = extractNumericLiteral(dae, startAttr);
    if (startVal !== null) sv.start = startVal;
  }
  const expr = dae.getVarExpression(idx);
  if (sv.start === undefined && typeof expr === "number" && expr >= 0) {
    const startVal = extractNumericLiteral(dae, expr);
    if (startVal !== null) sv.start = startVal;
  }
  if (sv.start === undefined && sv.variability === "continuous") {
    sv.start = 0;
  }

  const unitAttr = dae.getVarAttrExprId(idx, "unit");
  if (unitAttr !== undefined && unitAttr >= 0) {
    const unitVal = extractStringLiteral(dae, unitAttr);
    if (unitVal) sv.unit = unitVal;
  }
  const displayUnitAttr = dae.getVarAttrExprId(idx, "displayUnit");
  if (displayUnitAttr !== undefined && displayUnitAttr >= 0) {
    const duVal = extractStringLiteral(dae, displayUnitAttr);
    if (duVal) sv.displayUnit = duVal;
  }

  const initialVal = mapInitial(sv.causality, sv.variability);
  if (initialVal) sv.initial = initialVal;

  return sv;
}

function mapType(t: VarType): FmiScalarVariable["type"] {
  switch (t) {
    case VarType.Real:
      return "Real";
    case VarType.Integer:
    case VarType.Enumeration:
      return "Integer";
    case VarType.Boolean:
      return "Boolean";
    case VarType.String:
      return "String";
    case VarType.Clock:
      return "Clock";
    default:
      return "Real";
  }
}

function mapCausality(c: Causality, v: Variability): FmiCausality {
  if (v === Variability.Parameter || v === Variability.Constant) return "parameter";
  if (c === Causality.Input) return "input";
  if (c === Causality.Output) return "output";
  return "local";
}

function mapVariability(v: Variability): FmiVariability {
  switch (v) {
    case Variability.Constant:
      return "constant";
    case Variability.Parameter:
      return "fixed";
    case Variability.Discrete:
      return "discrete";
    default:
      return "continuous";
  }
}

function mapInitial(
  causality: FmiCausality,
  variability: FmiVariability,
): "exact" | "approx" | "calculated" | undefined {
  if (causality === "parameter") return "exact";
  if (causality === "input") return undefined;
  if (causality === "independent") return undefined;
  if (causality === "output") return "calculated";
  if (variability === "constant") return "exact";
  if (variability === "fixed" || variability === "tunable") return "calculated";
  return "calculated";
}

function extractNumericLiteral(dae: ArenaDAEBuilder, exprId: number): number | null {
  if (exprId < 0) return null;
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.RealLiteral) {
    return dae.getExprRealValue(exprId);
  }
  if (kind === ExprKind.IntLiteral || kind === ExprKind.BoolLiteral) {
    return dae.getExprData1(exprId);
  }
  return null;
}

function extractStringLiteral(dae: ArenaDAEBuilder, exprId: number): string | null {
  if (exprId < 0) return null;
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.StringLiteral) {
    return dae.interner.resolve(dae.getExprData1(exprId));
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
  return `{${hex(8)}-${hex(4)}-4${hex(3)}-${hex(4)}-${hex(12)}}`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

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

  if (opts.fmuType.modelExchange) {
    lines.push("");
    lines.push(
      `  <ModelExchange modelIdentifier="${escapeXml(opts.modelIdentifier)}" completedIntegratorStepNotNeeded="true" canGetAndSetFMUstate="true" canSerializeFMUstate="true" providesDirectionalDerivative="true" />`,
    );
  }

  if (opts.fmuType.coSimulation) {
    lines.push("");
    lines.push(
      `  <CoSimulation modelIdentifier="${escapeXml(opts.modelIdentifier)}" canHandleVariableCommunicationStepSize="true" canInterpolateInputs="true" maxOutputDerivativeOrder="0" canGetAndSetFMUstate="true" canSerializeFMUstate="true" providesDirectionalDerivative="true" />`,
    );
  }

  lines.push("");
  lines.push("  <LogCategories>");
  lines.push('    <Category name="logAll" />');
  lines.push('    <Category name="logError" />');
  lines.push('    <Category name="logEvents" />');
  lines.push('    <Category name="logStatusWarning" />');
  lines.push('    <Category name="logStatusDiscard" />');
  lines.push('    <Category name="logStatusPending" />');
  lines.push("  </LogCategories>");

  lines.push("");
  lines.push("  <DefaultExperiment");
  lines.push(`    startTime="${opts.startTime ?? 0}"`);
  lines.push(`    stopTime="${opts.stopTime ?? 1}"`);
  lines.push(`    stepSize="${opts.stepSize ?? 0.001}" />`);

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

  if (opts.enumTypes.size > 0) {
    lines.push("");
    lines.push("  <TypeDefinitions>");
    for (const [typeName, literals] of opts.enumTypes) {
      lines.push(`    <SimpleType name="${escapeXml(typeName)}">`);
      lines.push("      <Enumeration>");
      for (let i = 0; i < literals.length; i++) {
        const lit = literals[i];
        if (!lit) continue;
        const descAttr = lit.description ? ` description="${escapeXml(lit.description)}"` : "";
        lines.push(`        <Item name="${escapeXml(lit.name)}" value="${i + 1}"${descAttr} />`);
      }
      lines.push("      </Enumeration>");
      lines.push("    </SimpleType>");
    }
    lines.push("  </TypeDefinitions>");
  }

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
    const startAttr = sv.start !== undefined && sv.initial !== "calculated" ? ` start="${sv.start}"` : "";
    const unitAttr = sv.unit ? ` unit="${escapeXml(sv.unit)}"` : "";
    const duAttr = sv.displayUnit ? ` displayUnit="${escapeXml(sv.displayUnit)}"` : "";
    const derivAttr = sv.derivative !== undefined ? ` derivative="${sv.derivative}"` : "";
    const declTypeAttr = sv.declaredType ? ` declaredType="${escapeXml(sv.declaredType)}"` : "";
    lines.push(`      <${sv.type}${startAttr}${unitAttr}${duAttr}${derivAttr}${declTypeAttr} />`);
    lines.push("    </ScalarVariable>");
  }
  lines.push("  </ModelVariables>");

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
  const depItems = entries
    .map((e) => ({ idx: variables.findIndex((v) => v.valueReference === e.vr) + 1, kind: e.kind }))
    .filter((d) => d.idx > 0);
  const depsAttr = ` dependencies="${depItems.map((d) => d.idx).join(" ")}"`;
  const kindsAttr = ` dependenciesKind="${depItems.map((d) => d.kind).join(" ")}"`;
  return `      <Unknown index="${index}"${depsAttr}${kindsAttr} />`;
}

interface Fmi3ArrayVariable {
  baseName: string;
  startRef: number;
  dimensions: number[];
  sv: FmiScalarVariable;
  elements: FmiScalarVariable[];
}

function groupFmi3Variables(scalarVariables: FmiScalarVariable[]): (FmiScalarVariable | Fmi3ArrayVariable)[] {
  const result: (FmiScalarVariable | Fmi3ArrayVariable)[] = [];
  const arrayMap = new Map<string, Fmi3ArrayVariable>();

  for (const sv of scalarVariables) {
    const match = sv.name.match(/^(.+)\[([\d, ]+)\]$/);
    if (match) {
      const baseName = match[1] as string;
      const indices = (match[2] as string).split(",").map((s) => parseInt(s.trim(), 10));

      let arr = arrayMap.get(baseName);
      if (!arr) {
        arr = {
          baseName,
          startRef: sv.valueReference,
          dimensions: indices.map(() => 0),
          sv: { ...sv, name: baseName },
          elements: [],
        };
        arrayMap.set(baseName, arr);
        result.push(arr);
      }

      const currentArr = arr as Fmi3ArrayVariable;
      for (let i = 0; i < indices.length; i++) {
        const ind = indices[i] as number;
        const currentDim = currentArr.dimensions[i] as number;
        if (ind !== undefined && currentDim !== undefined) {
          if (ind > currentDim) {
            currentArr.dimensions[i] = ind;
          }
        }
      }
      currentArr.elements.push(sv);
    } else {
      result.push(sv);
    }
  }
  return result;
}

export function generateFmi3ModelDescriptionXml(
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
  lines.push('  fmiVersion="3.0"');
  lines.push(`  modelName="${escapeXml(opts.modelIdentifier)}"`);
  lines.push(`  instantiationToken="${escapeXml(opts.guid)}"`);
  if (opts.description) lines.push(`  description="${escapeXml(opts.description)}"`);
  if (opts.author) lines.push(`  author="${escapeXml(opts.author)}"`);
  lines.push(`  generationTool="${escapeXml(opts.generationTool ?? "ModelScript")}"`);
  lines.push(`  generationDateAndTime="${new Date().toISOString()}"`);
  lines.push('  variableNamingConvention="structured">');

  if (opts.fmuType.modelExchange) {
    lines.push("");
    lines.push(
      `  <ModelExchange modelIdentifier="${escapeXml(opts.modelIdentifier)}" providesDirectionalDerivative="true" />`,
    );
  }

  if (opts.fmuType.coSimulation) {
    lines.push("");
    lines.push(
      `  <CoSimulation modelIdentifier="${escapeXml(opts.modelIdentifier)}" canHandleVariableCommunicationStepSize="true" providesDirectionalDerivative="true" />`,
    );
  }

  lines.push("");
  lines.push("  <DefaultExperiment");
  lines.push(`    startTime="${opts.startTime ?? 0}"`);
  lines.push(`    stopTime="${opts.stopTime ?? 1}"`);
  lines.push(`    stepSize="${opts.stepSize ?? 0.001}" />`);

  if (opts.enumTypes.size > 0) {
    lines.push("");
    lines.push("  <TypeDefinitions>");
    for (const [typeName, literals] of opts.enumTypes) {
      lines.push(`    <EnumerationType name="${escapeXml(typeName)}">`);
      for (let i = 0; i < literals.length; i++) {
        const lit = literals[i];
        if (!lit) continue;
        const descAttr = lit.description ? ` description="${escapeXml(lit.description)}"` : "";
        lines.push(`      <Item name="${escapeXml(lit.name)}" value="${i + 1}"${descAttr} />`);
      }
      lines.push("    </EnumerationType>");
    }
    lines.push("  </TypeDefinitions>");
  }

  lines.push("");
  lines.push("  <ModelVariables>");
  const groupedVars = groupFmi3Variables(variables);
  for (const item of groupedVars) {
    let sv: FmiScalarVariable;
    let dimensions: number[] | null = null;
    if ("elements" in item) {
      sv = item.sv;
      dimensions = item.dimensions;
    } else {
      sv = item;
    }

    lines.push(`    <!-- ${escapeXml(sv.name)} -->`);
    const descAttr = sv.description ? ` description="${escapeXml(sv.description)}"` : "";
    const causalityAttr = sv.causality === "independent" ? ' causality="independent"' : ` causality="${sv.causality}"`;
    const variabilityAttr = ` variability="${sv.variability}"`;
    const initialAttr = sv.initial ? ` initial="${sv.initial}"` : "";

    let fmi3Type = sv.type as string;
    if (fmi3Type === "Real") fmi3Type = "Float64";
    else if (fmi3Type === "Integer") fmi3Type = "Int32";
    else if (fmi3Type === "Clock") {
      lines.push(
        `    <Clock name="${escapeXml(sv.name)}" valueReference="${sv.valueReference}"${causalityAttr}${descAttr}`,
      );
      if (sv.start !== undefined || sv.derivative !== undefined || sv.declaredType || dimensions) {
        lines.push(`>`);
        if (dimensions) {
          for (const d of dimensions) lines.push(`      <Dimension start="${d}" />`);
        }
        lines.push(`    </Clock>`);
      } else {
        lines[lines.length - 1] += " />";
      }
      continue;
    }

    lines.push(
      `    <${fmi3Type} name="${escapeXml(sv.name)}" valueReference="${sv.valueReference}"${causalityAttr}${variabilityAttr}${initialAttr}${descAttr}`,
    );

    const hasStartAttr = sv.start !== undefined && sv.initial !== "calculated";
    if (hasStartAttr || sv.derivative !== undefined || sv.declaredType || dimensions) {
      const startAttr = hasStartAttr ? ` start="${sv.start}"` : "";
      const derivAttr = sv.derivative !== undefined ? ` derivative="${sv.derivative}"` : "";
      const declTypeAttr = sv.declaredType ? ` declaredType="${escapeXml(sv.declaredType)}"` : "";

      if (dimensions) {
        lines.push(`>`);
        for (const d of dimensions) lines.push(`      <Dimension start="${d}" />`);
        lines.push(`    </${fmi3Type}>`);
      } else {
        lines.push(`      ${startAttr}${derivAttr}${declTypeAttr} />`);
      }
    } else {
      lines[lines.length - 1] += " />";
    }
  }
  lines.push("  </ModelVariables>");

  lines.push("");
  lines.push("  <ModelStructure>");

  if (opts.outputRefs.length > 0) {
    for (const ref of opts.outputRefs) {
      lines.push(formatFmi3Unknown("Output", ref, opts.deps));
    }
  }

  if (opts.derivativeRefs.length > 0) {
    for (const ref of opts.derivativeRefs) {
      lines.push(formatFmi3Unknown("ContinuousStateDerivative", ref, opts.deps));
    }
  }

  if (opts.initialUnknownRefs.length > 0) {
    for (const ref of opts.initialUnknownRefs) {
      lines.push(formatFmi3Unknown("InitialUnknown", ref, opts.deps));
    }
  }

  lines.push("  </ModelStructure>");
  lines.push("");
  lines.push("</fmiModelDescription>");

  return lines.join("\n");
}

function formatFmi3Unknown(tagName: string, ref: number, deps: Map<number, DepEntry2[]>): string {
  const entries = deps.get(ref);
  if (!entries || entries.length === 0) {
    return `    <${tagName} valueReference="${ref}" />`;
  }
  const depsAttr = ` dependencies="${entries.map((e) => e.vr).join(" ")}"`;
  const kindsAttr = ` dependenciesKind="${entries.map((e) => e.kind).join(" ")}"`;
  return `    <${tagName} valueReference="${ref}"${depsAttr}${kindsAttr} />`;
}
