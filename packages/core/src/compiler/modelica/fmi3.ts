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

import { ModelicaVariability } from "@modelscript/modelica-ast";
import type { ModelicaDAE, ModelicaExpression, ModelicaVariable } from "./dae.js";
import {
  ModelicaArray,
  ModelicaBinaryExpression,
  ModelicaBooleanVariable,
  ModelicaClockVariable,
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

/** An FMI 3.0 Terminal member variable reference. */
export interface Fmi3TerminalMemberVariable {
  /** Variable name (possibly dot-qualified, e.g. "connector.v"). */
  variableName: string;
  /** Value reference of the corresponding FMI variable. */
  valueReference: number;
  /** The member name within the terminal (e.g., "v" without prefix). */
  memberName: string;
}

/** An FMI 3.0 Terminal (maps to a Modelica connector instance). */
export interface Fmi3Terminal {
  /** Terminal name (connector instance name). */
  name: string;
  /** Terminal type (connector type name, e.g. "Modelica.Electrical.Analog.Interfaces.Pin"). */
  terminalKind?: string;
  /** Description string. */
  description?: string;
  /** Member variables. */
  memberVariables: Fmi3TerminalMemberVariable[];
}

/** FMU 3.0 generation options. */
export interface Fmi3Options {
  /** Model identifier. */
  modelIdentifier: string;
  /** Description of the model. */
  description?: string | undefined;
  /** Author name. */
  author?: string | undefined;
  /** Generation tool name. */
  generationTool?: string | undefined;
  /** GUID (auto-generated if not provided). */
  guid?: string | undefined;
  /** Default experiment start time. */
  startTime?: number | undefined;
  /** Default experiment stop time. */
  stopTime?: number | undefined;
  /** Default experiment step size. */
  stepSize?: number | undefined;
  /** FMU type flags. */
  fmuType?: Fmi3TypeFlags | undefined;
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
  /** Terminals (from Modelica connectors). */
  terminals: Fmi3Terminal[];
  /** Terminals and Icons XML payload. */
  terminalsAndIconsXml?: string | null;
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
    const totalSize = v.arrayDimensions ? v.arrayDimensions.reduce((a, b) => a * b, 1) : 1;
    const fv = mapVariable3(v, valueRef);
    valueRef += totalSize;
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
    if (v instanceof ModelicaClockVariable) {
      clockRefs.push(fv.valueReference);
    }
  }

  // ── Alias detection ──
  const aliasMap = detectAliases3(dae, variables);

  // ── Derivative variables ──
  for (const v of dae.variables) {
    if (states.has(v.name)) {
      const stateRef = stateVarRefs.get(v.name);
      const totalSize = v.arrayDimensions ? v.arrayDimensions.reduce((a, b) => a * b, 1) : 1;
      const derFv: Fmi3Variable = {
        valueReference: valueRef,
        name: `der(${v.name})`,
        causality: "local",
        variability: "continuous",
        type: "Float64",
        start: 0,
      };
      if (v.arrayDimensions && v.arrayDimensions.length > 0) {
        derFv.dimensions = v.arrayDimensions.map((d) => ({ start: d }));
      }
      valueRef += totalSize;
      if (stateRef !== undefined) derFv.derivative = stateRef;
      variables.push(derFv);
      derivativeRefs.push(derFv.valueReference);
    }
  }

  // ── Group array variables for FMI 3.0 native arrays ──
  const groupedVariables = groupArrayVariables3(variables);

  // ── Compute dependencies ──
  const deps = computeDependencies3(dae, groupedVariables, outputRefs, derivativeRefs, initialUnknownRefs);

  // ── Generate modelDescription.xml ──
  const fmuType = options.fmuType ?? { modelExchange: true, coSimulation: true };
  const nEventIndicators = countEventIndicators3(dae);
  const terminals = detectTerminals3(groupedVariables);
  const xml = generateModelDescriptionXml3(groupedVariables, {
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
    terminals,
  });

  return {
    modelDescriptionXml: xml,
    variables: groupedVariables,
    modelStructure: {
      outputs: outputRefs,
      derivatives: derivativeRefs,
      initialUnknowns: initialUnknownRefs,
      continuousStateDerivatives: derivativeRefs,
      clocks: clockRefs,
    },
    guid,
    numberOfEventIndicators: nEventIndicators,
    terminals,
    terminalsAndIconsXml: generateTerminalsAndIconsXml(terminals),
  };
}

// ── Array Grouping (FMI 3.0 Native Arrays) ──

/** Regex to match subscripted variable names like `x[1]`, `a.b[2,3]` etc. */
const SUBSCRIPT_RE = /^(.+)\[([0-9,]+)\]$/;

/**
 * Group flattened subscripted scalar variables into FMI 3.0 array variables.
 *
 * For example, `x[1]`, `x[2]`, `x[3]` with type Float64 become a single
 * `x` variable with `dimensions: [{start: 3}]` and `start: [v1, v2, v3]`.
 *
 * Multi-dimensional arrays like `A[1,1]`, `A[1,2]`, `A[2,1]`, `A[2,2]`
 * become `A` with `dimensions: [{start: 2}, {start: 2}]`.
 *
 * Variables that don't have subscript notation are left unchanged.
 */
function groupArrayVariables3(variables: Fmi3Variable[]): Fmi3Variable[] {
  // Phase 1: Identify array families by base name
  const families = new Map<
    string,
    {
      indices: number[][]; // e.g., [[1], [2], [3]] for 1D or [[1,1],[1,2],[2,1],[2,2]] for 2D
      vars: Fmi3Variable[];
    }
  >();
  const nonArrayVars: Fmi3Variable[] = [];

  for (const sv of variables) {
    const match = SUBSCRIPT_RE.exec(sv.name);
    if (!match) {
      nonArrayVars.push(sv);
      continue;
    }
    const baseName = match[1] ?? "";
    const subscripts = (match[2] ?? "").split(",").map(Number);

    let family = families.get(baseName);
    if (!family) {
      family = { indices: [], vars: [] };
      families.set(baseName, family);
    }
    family.indices.push(subscripts);
    family.vars.push(sv);
  }

  // Phase 2: Convert families into array variables
  const result: Fmi3Variable[] = [...nonArrayVars];

  for (const [baseName, family] of families) {
    if (family.vars.length <= 1) {
      // Only 1 element — keep as scalar (not worth grouping)
      result.push(...family.vars);
      continue;
    }

    // Ensure all have the same number of subscript dimensions
    const ndims = family.indices[0]?.length ?? 1;
    const allSameNdims = family.indices.every((idx) => idx.length === ndims);
    if (!allSameNdims) {
      // Mixed dimensions — can't group; keep as scalars
      result.push(...family.vars);
      continue;
    }

    // Ensure all have the same type, causality, variability
    const refVar = family.vars[0];
    if (!refVar) {
      result.push(...family.vars);
      continue;
    }
    const allSameType = family.vars.every(
      (v) => v.type === refVar.type && v.causality === refVar.causality && v.variability === refVar.variability,
    );
    if (!allSameType) {
      result.push(...family.vars);
      continue;
    }

    // Compute dimension sizes: max index along each dimension
    const dimSizes: number[] = new Array(ndims).fill(0);
    for (const idx of family.indices) {
      for (let d = 0; d < ndims; d++) {
        const curMax = dimSizes[d] ?? 0;
        const curVal = idx[d] ?? 0;
        dimSizes[d] = Math.max(curMax, curVal);
      }
    }

    // Verify we have the complete set of elements
    const expectedCount = dimSizes.reduce((a, b) => a * b, 1);
    if (family.vars.length !== expectedCount) {
      // Incomplete array — keep as scalars
      result.push(...family.vars);
      continue;
    }

    // Sort by subscript indices (row-major order) for contiguous start values
    const sorted = [...family.vars].sort((a, b) => {
      const aMatch = SUBSCRIPT_RE.exec(a.name);
      const bMatch = SUBSCRIPT_RE.exec(b.name);
      const aIdx = aMatch ? (aMatch[2] ?? "").split(",").map(Number) : [];
      const bIdx = bMatch ? (bMatch[2] ?? "").split(",").map(Number) : [];
      for (let d = 0; d < ndims; d++) {
        const diff = (aIdx[d] ?? 0) - (bIdx[d] ?? 0);
        if (diff !== 0) return diff;
      }
      return 0;
    });

    // Build the array variable
    const startValues: number[] = [];
    for (const sv of sorted) {
      if (sv.start !== undefined && typeof sv.start === "number") {
        startValues.push(sv.start);
      }
    }

    const arrayVar: Fmi3Variable = {
      valueReference: refVar.valueReference, // Use the first element's VR
      name: baseName,
      causality: refVar.causality,
      variability: refVar.variability,
      type: refVar.type,
      dimensions: dimSizes.map((size) => ({ start: size })),
    };
    if (refVar.description) arrayVar.description = refVar.description;
    if (refVar.unit) arrayVar.unit = refVar.unit;
    if (refVar.displayUnit) arrayVar.displayUnit = refVar.displayUnit;
    if (refVar.initial) arrayVar.initial = refVar.initial;
    if (refVar.declaredType) arrayVar.declaredType = refVar.declaredType;
    if (startValues.length === expectedCount) {
      arrayVar.start = startValues;
    }

    result.push(arrayVar);
  }

  return result;
}

// ── Terminal Detection (FMI 3.0 Terminals from Modelica Connectors) ──

/**
 * Detect terminals from dot-qualified variable names.
 *
 * In the flattened DAE, connector variables appear as `connector.v`, `connector.i`, etc.
 * This function groups variables that share a common dot-prefix and have at least 2 members
 * into an Fmi3Terminal, which maps to the `<Terminals>` section of the modelDescription.xml.
 */
function detectTerminals3(variables: Fmi3Variable[]): Fmi3Terminal[] {
  const groups = new Map<string, Fmi3TerminalMemberVariable[]>();

  for (const sv of variables) {
    // Skip time, derivative, and array-subscripted variables
    if (sv.causality === "independent") continue;
    if (sv.name.startsWith("der(")) continue;

    const dotIdx = sv.name.lastIndexOf(".");
    if (dotIdx <= 0) continue; // Must have at least one dot

    const prefix = sv.name.substring(0, dotIdx);
    const member = sv.name.substring(dotIdx + 1);

    // Skip nested connectors (multiple dots) — only group top-level connectors
    // but allow one level of nesting for hierarchical models
    let memberList = groups.get(prefix);
    if (!memberList) {
      memberList = [];
      groups.set(prefix, memberList);
    }
    memberList.push({
      variableName: sv.name,
      valueReference: sv.valueReference,
      memberName: member,
    });
  }

  // Only create terminals for groups with 2+ members (likely connectors)
  const terminals: Fmi3Terminal[] = [];
  for (const [name, members] of groups) {
    if (members.length >= 2) {
      terminals.push({ name, memberVariables: members });
    }
  }

  return terminals;
}

// ── Internal helpers ──

function countEventIndicators3(dae: ModelicaDAE): number {
  return dae.eventIndicators.length;
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

/** A single entry in the enriched dependency graph. */
interface DepEntry3 {
  vr: number;
  kind: "dependent" | "constant" | "fixed" | "tunable";
  /**
   * Optional per-element dependencies for FMI 3.0 arrays.
   * Maps each 1-based element index of the *unknown* to the 1-based
   * element indices of the *dependency* that it depends on.
   * If absent, the dependency is dense (all elements depend on all elements).
   */
  elementDeps?: Map<number, number[]>;
}

/** Map variable variability to FMI dependency kind. */
function variabilityToDepKind(v: Fmi3Variability): DepEntry3["kind"] {
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

function computeDependencies3(
  dae: ModelicaDAE,
  variables: Fmi3Variable[],
  outputRefs: number[],
  derivativeRefs: number[],
  initialUnknownRefs: number[],
): Map<number, DepEntry3[]> {
  const deps = new Map<number, DepEntry3[]>();
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

    // Check if this is an array variable — if so, build element-level deps
    const isArray = sv.dimensions && sv.dimensions.length > 0;
    let totalSize = 1;
    if (isArray && sv.dimensions) {
      for (const dim of sv.dimensions) {
        if (dim.start !== undefined) totalSize *= dim.start;
      }
    }

    if (isArray && totalSize > 1) {
      // Build element-level deps from scalar equations matching baseName[i]
      const elementEntries = new Map<number, Map<number, Set<number>>>();
      for (let ei = 1; ei <= totalSize; ei++) {
        const scalarName = `${sv.name}[${ei}]`;
        const rhsNames = equationDeps.get(scalarName);
        if (!rhsNames) continue;
        for (const name of rhsNames) {
          const depMatch = SUBSCRIPT_RE.exec(name);
          if (depMatch && depMatch[1] && depMatch[2]) {
            const depBase = depMatch[1];
            const depIdx = parseInt(depMatch[2], 10);
            const depSv = svByName.get(depBase);
            if (depSv && depSv.valueReference !== ref) {
              if (!elementEntries.has(depSv.valueReference)) {
                elementEntries.set(depSv.valueReference, new Map());
              }
              const vrMap = elementEntries.get(depSv.valueReference);
              if (vrMap) {
                if (!vrMap.has(ei)) vrMap.set(ei, new Set());
                const eiSet = vrMap.get(ei);
                if (eiSet) eiSet.add(depIdx);
              }
            }
          } else {
            // Non-subscripted dep — falls on the root
            const depSv = svByName.get(name);
            if (depSv && depSv.valueReference !== ref) {
              if (!elementEntries.has(depSv.valueReference)) {
                elementEntries.set(depSv.valueReference, new Map());
              }
            }
          }
        }
      }

      const entries: DepEntry3[] = [];
      for (const [depVr, elemMap] of elementEntries) {
        const depSv = variables.find((v) => v.valueReference === depVr);
        if (!depSv) continue;
        const entry: DepEntry3 = { vr: depVr, kind: variabilityToDepKind(depSv.variability) };
        if (elemMap.size > 0) {
          const eDeps = new Map<number, number[]>();
          for (const [ei, idxSet] of elemMap) {
            eDeps.set(
              ei,
              Array.from(idxSet).sort((a, b) => a - b),
            );
          }
          entry.elementDeps = eDeps;
        }
        entries.push(entry);
      }
      if (entries.length > 0) {
        deps.set(
          ref,
          entries.sort((a, b) => a.vr - b.vr),
        );
      }
    } else {
      // Scalar variable — use the existing root-level dep tracking
      const rhsNames = equationDeps.get(sv.name);
      if (!rhsNames) continue;

      const entries: DepEntry3[] = [];
      for (const name of rhsNames) {
        const depSv = svByName.get(name);
        if (depSv && depSv.valueReference !== ref) {
          entries.push({ vr: depSv.valueReference, kind: variabilityToDepKind(depSv.variability) });
        }
      }
      if (entries.length > 0) {
        deps.set(
          ref,
          entries.sort((a, b) => a.vr - b.vr),
        );
      }
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
  if (v.arrayDimensions && v.arrayDimensions.length > 0) {
    fv.dimensions = v.arrayDimensions.map((d) => ({ start: d }));
  }
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

  // Clock-specific attributes
  if (v instanceof ModelicaClockVariable) {
    fv.variability = "discrete";
    // Determine interval variability from attributes if present
    const intervalAttr = v.attributes.get("intervalVariability");
    if (intervalAttr) {
      const val = extractStringLiteral(intervalAttr);
      if (
        val === "constant" ||
        val === "fixed" ||
        val === "tunable" ||
        val === "changing" ||
        val === "countdown" ||
        val === "triggered"
      ) {
        fv.intervalVariability = val;
      }
    }
    if (!fv.intervalVariability) fv.intervalVariability = "triggered";
  }

  return fv;
}

/** Map Modelica type to FMI 3.0 precise type.
 *
 * Priority:
 *   1. Explicit `__fmi3_type` vendor annotation (e.g., "Float32", "Int8")
 *   2. Integer range inference from `min`/`max` attributes
 *   3. Default mapping (Real→Float64, Integer→Int32, etc.)
 */
function mapType3(v: ModelicaVariable): Fmi3Type {
  // 1. Check for explicit vendor annotation override
  const fmi3TypeAttr = v.attributes.get("__fmi3_type");
  if (fmi3TypeAttr) {
    const val = extractStringLiteral(fmi3TypeAttr);
    if (val && isValidFmi3Type(val)) return val;
  }

  // 2. Check for __fmi3_binary annotation
  if (v.attributes.has("__fmi3_binary")) return "Binary";

  // 3. Type-specific mapping
  if (v instanceof ModelicaRealVariable) {
    // Check for single-precision annotation via min/max range or explicit Float32
    const minAttr = v.attributes.get("min");
    const maxAttr = v.attributes.get("max");
    if (minAttr && maxAttr) {
      const minVal = extractNumericLiteral(minAttr);
      const maxVal = extractNumericLiteral(maxAttr);
      // If range fits in Float32 (approx ±3.4e38) and explicitly annotated small
      if (minVal !== null && maxVal !== null && Math.abs(maxVal) <= 3.4e38 && Math.abs(minVal) <= 3.4e38) {
        // Only demote if explicitly requested via quantization hint
        const quantAttr = v.attributes.get("__fmi3_float32");
        if (quantAttr) return "Float32";
      }
    }
    return "Float64";
  }
  if (v instanceof ModelicaIntegerVariable) {
    // Infer narrow integer types from min/max range annotations
    const minAttr = v.attributes.get("min");
    const maxAttr = v.attributes.get("max");
    if (minAttr && maxAttr) {
      const minVal = extractNumericLiteral(minAttr);
      const maxVal = extractNumericLiteral(maxAttr);
      if (minVal !== null && maxVal !== null) {
        // Unsigned types
        if (minVal >= 0) {
          if (maxVal <= 255) return "UInt8";
          if (maxVal <= 65535) return "UInt16";
          if (maxVal <= 4294967295) return "UInt32";
          return "UInt64";
        }
        // Signed types
        if (minVal >= -128 && maxVal <= 127) return "Int8";
        if (minVal >= -32768 && maxVal <= 32767) return "Int16";
        if (minVal >= -2147483648 && maxVal <= 2147483647) return "Int32";
        return "Int64";
      }
    }
    return "Int32";
  }
  if (v instanceof ModelicaBooleanVariable) return "Boolean";
  if (v instanceof ModelicaStringVariable) return "String";
  if (v instanceof ModelicaEnumerationVariable) return "Enumeration";
  if (v instanceof ModelicaClockVariable) return "Clock";
  return "Float64";
}

/** Check if a string is a valid FMI 3.0 type name. */
function isValidFmi3Type(s: string): s is Fmi3Type {
  return [
    "Float64",
    "Float32",
    "Int64",
    "Int32",
    "Int16",
    "Int8",
    "UInt64",
    "UInt32",
    "UInt16",
    "UInt8",
    "Boolean",
    "String",
    "Binary",
    "Enumeration",
    "Clock",
  ].includes(s);
}

function mapCausality3(v: ModelicaVariable): Fmi3Causality {
  // FMI 3.0 structural parameter: controls array dimensions at init time
  if (v.variability === ModelicaVariability.PARAMETER) {
    if (v.attributes.has("__fmi3_structuralParameter") || v.attributes.has("__modelscript_mutableDimension"))
      return "structuralParameter";
    return "parameter";
  }
  if (v.variability === ModelicaVariability.CONSTANT) return "calculatedParameter";
  if (v.causality === "input") return "input";
  if (v.causality === "output") return "output";
  return "local";
}

function mapVariability3(v: ModelicaVariable): Fmi3Variability {
  // Mutable dimensions get tunable variability (can be resized at runtime)
  if (v.attributes.has("__modelscript_mutableDimension")) return "tunable";
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
    deps: Map<number, DepEntry3[]>;
    aliasMap: Map<string, string>;
    enumTypes: Map<string, { name: string; description: string | null }[]>;
    terminals: Fmi3Terminal[];
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
      `  <ScheduledExecution modelIdentifier="${escapeXml(opts.modelIdentifier)}" needsExecutionTool="false" canBeInstantiatedOnlyOncePerProcess="false" canGetAndSetFMUState="true" canSerializeFMUState="true" providesDirectionalDerivatives="true" />`,
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
    const intervalAttr = sv.intervalVariability ? ` intervalVariability="${sv.intervalVariability}"` : "";

    // FMI 3.0 uses the type name as the element tag (Float64, Int32, etc.)
    const hasInnerContent = sv.dimensions && sv.dimensions.length > 0;

    if (hasInnerContent) {
      lines.push(
        `    <${sv.type} name="${escapeXml(sv.name)}" valueReference="${sv.valueReference}" causality="${sv.causality}" variability="${sv.variability}"${descAttr}${initialAttr}${startAttr}${unitAttr}${duAttr}${derivAttr}${declTypeAttr}${intervalAttr}>`,
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
        `    <${sv.type} name="${escapeXml(sv.name)}" valueReference="${sv.valueReference}" causality="${sv.causality}" variability="${sv.variability}"${descAttr}${initialAttr}${startAttr}${unitAttr}${duAttr}${derivAttr}${declTypeAttr}${intervalAttr} />`,
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

  // Clocks (FMI 3.0)
  if (opts.clockRefs.length > 0) {
    for (const ref of opts.clockRefs) {
      lines.push(`    <Clock valueReference="${ref}" />`);
    }
  }

  lines.push("  </ModelStructure>");

  // Terminals (FMI 3.0)
  if (opts.terminals.length > 0) {
    lines.push("");
    lines.push("  <Terminals>");
    for (const term of opts.terminals) {
      const kindAttr = term.terminalKind ? ` terminalKind="${escapeXml(term.terminalKind)}"` : "";
      const descAttr = term.description ? ` description="${escapeXml(term.description)}"` : "";
      lines.push(`    <Terminal name="${escapeXml(term.name)}"${kindAttr}${descAttr}>`);
      for (const mv of term.memberVariables) {
        lines.push(
          `      <TerminalMemberVariable variableName="${escapeXml(mv.variableName)}" memberName="${escapeXml(mv.memberName)}" variableKind="signal" />`,
        );
      }
      lines.push("    </Terminal>");
    }
    lines.push("  </Terminals>");
  }

  lines.push("");
  lines.push("</fmiModelDescription>");

  return lines.join("\n");
}

/** Format an Unknown/Output/ContinuousStateDerivative element. */
function formatUnknown3(elementName: string, ref: number, deps: Map<number, DepEntry3[]>): string {
  const entries = deps.get(ref);
  if (!entries || entries.length === 0) {
    return `    <${elementName} valueReference="${ref}" />`;
  }
  const depsAttr = ` dependencies="${entries.map((e) => e.vr).join(" ")}"`;
  const kindsAttr = ` dependenciesKind="${entries.map((e) => e.kind).join(" ")}"`;

  // Check if any entry has element-level dependencies
  const hasElementDeps = entries.some((e) => e.elementDeps && e.elementDeps.size > 0);
  if (!hasElementDeps) {
    return `    <${elementName} valueReference="${ref}"${depsAttr}${kindsAttr} />`;
  }

  // Emit element-level dependencies as nested XML
  const lines: string[] = [];
  lines.push(`    <${elementName} valueReference="${ref}"${depsAttr}${kindsAttr}>`);
  for (const e of entries) {
    if (e.elementDeps && e.elementDeps.size > 0) {
      for (const [unknownIdx, depIndices] of e.elementDeps) {
        lines.push(`      <!-- element ${unknownIdx} depends on ${e.vr}[${depIndices.join(",")}] -->`);
      }
    }
  }
  lines.push(`    </${elementName}>`);
  return lines.join("\n");
}

// ── Standalone terminalsAndIcons.xml Generation (FMI 3.0 §2.4.9) ──

/**
 * Generate a standalone `terminalsAndIcons.xml` file for the FMU archive.
 * This re-exports the same terminal data that is embedded in modelDescription.xml
 * as a separate file in `terminalsAndIcons/`, as required by graphical FMI tools.
 */
export function generateTerminalsAndIconsXml(terminals: Fmi3Terminal[]): string | null {
  if (terminals.length === 0) return null;

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<fmiTerminalsAndIcons fmiVersion="3.0">');
  lines.push("  <Terminals>");
  for (const term of terminals) {
    const kindAttr = term.terminalKind ? ` terminalKind="${escapeXml(term.terminalKind)}"` : "";
    const descAttr = term.description ? ` description="${escapeXml(term.description)}"` : "";
    lines.push(`    <Terminal name="${escapeXml(term.name)}"${kindAttr}${descAttr}>`);
    for (const mv of term.memberVariables) {
      lines.push(
        `      <TerminalMemberVariable variableName="${escapeXml(mv.variableName)}" memberName="${escapeXml(mv.memberName)}" variableKind="signal" />`,
      );
    }
    lines.push("    </Terminal>");
  }
  lines.push("  </Terminals>");
  lines.push("  <!-- GraphicalRepresentation is omitted; no SVG icon data available. -->");
  lines.push("</fmiTerminalsAndIcons>");
  return lines.join("\n");
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
