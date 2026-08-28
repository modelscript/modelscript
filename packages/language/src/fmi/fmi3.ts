// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMI 3.0 Model Exchange & Co-Simulation FMU generator.
 *
 * Generates the FMI 3.0 modelDescription.xml from a flattened ArenaDAEBuilder.
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

import { type ArenaDAEBuilder, Causality, EqKind, ExprKind, Variability, VarType } from "@modelscript/compiler";

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
export function generateFmi3(dae: ArenaDAEBuilder, options: Fmi3Options, stateVars?: Set<string>): Fmi3Result {
  const guid = options.guid ?? generateGuid();
  const variables: Fmi3Variable[] = [];
  let valueRef = 0;

  // ── Time variable (independent) ──
  // We assign time a VR equal to dae.varCount to ensure the other variables
  // maintain a 1:1 mapping with their DAE index (which is used in the C struct).
  variables.push({
    valueReference: dae.varCount,
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

  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;
    const shape = dae.getVarShape(i);
    const totalSize = shape.reduce((a, b) => a * b, 1);
    const fv = mapVariable3(dae, i, i);
    // Note: FMI 3.0 arrays use the base VR, we don't reserve valueReferences
    // for each element since the VR points to the whole array conceptually or
    // element references are offset. But we need to ensure the next variable gets
    // its correct DAE index, which is simply `i+1` handled by the loop!
    variables.push(fv);

    if (dae.getVarType(i) === VarType.Enumeration) {
      const literals = dae.getVarEnumerationLiterals(i);
      if (literals && literals.length > 0) {
        const typeName = `${fv.name}Type`;
        enumTypes.set(
          typeName,
          literals.map((lit: { name: string }) => ({ name: lit.name, description: null })),
        );
        fv.declaredType = typeName;
      }
    }

    if (states.has(fv.name)) {
      stateVarRefs.set(fv.name, fv.valueReference);
    }
    if (fv.causality === "output") {
      outputRefs.push(fv.valueReference);
    }
    if (fv.variability === "continuous" && fv.causality === "local") {
      initialUnknownRefs.push(fv.valueReference);
    }
    if (dae.getVarType(i) === VarType.Clock) {
      clockRefs.push(fv.valueReference);
    }
  }

  // ── Alias detection ──
  const aliasMap = detectAliases3(dae, variables);

  // ── Derivative variables ──
  for (const sv of variables) {
    const match = sv.name.match(/^der\((.+)\)$/);
    if (match) {
      const stateName = match[1] ?? "";
      const stateSv = variables.find((v) => v.name === stateName);
      if (stateSv) {
        sv.derivative = stateSv.valueReference;
        derivativeRefs.push(sv.valueReference);
        if (!stateSv.initial || stateSv.initial === "calculated") {
          stateSv.initial = "exact";
        }
      }
    }
  }

  // ── Group array variables for FMI 3.0 native arrays ──
  const groupedVariables = groupArrayVariables3(variables);

  // ── Event Indicators (FMI 3.0 requires them as ModelVariables) ──
  const nEventIndicators = dae.eventIndicatorExprIds.length;
  for (let i = 0; i < nEventIndicators; i++) {
    variables.push({
      valueReference: dae.varCount + 1 + i, // Offset past normal vars and time
      name: `z_${i}`,
      causality: "local",
      variability: "continuous",
      type: "Float64",
    });
  }

  // ── Compute dependencies ──
  const deps = computeDependencies3(dae, groupedVariables, outputRefs, derivativeRefs, initialUnknownRefs);

  // ── Generate modelDescription.xml ──
  const fmuType = options.fmuType ?? { modelExchange: true, coSimulation: true };
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
 */
function groupArrayVariables3(variables: Fmi3Variable[]): Fmi3Variable[] {
  const families = new Map<
    string,
    {
      indices: number[][];
      vars: Fmi3Variable[];
    }
  >();
  const nonArrayVars: Fmi3Variable[] = [];

  for (const sv of variables) {
    let baseName = "";
    let subscripts: number[] = [];

    const derMatch = sv.name.match(/^der\((.+)\[([0-9,]+)\]\)$/);
    const subMatch = sv.name.match(/^(.+)\[([0-9,]+)\]$/);

    if (derMatch) {
      baseName = `der(${derMatch[1]})`;
      subscripts = (derMatch[2] ?? "").split(",").map(Number);
    } else if (subMatch) {
      baseName = subMatch[1] ?? "";
      subscripts = (subMatch[2] ?? "").split(",").map(Number);
    } else {
      nonArrayVars.push(sv);
      continue;
    }

    let family = families.get(baseName);
    if (!family) {
      family = { indices: [], vars: [] };
      families.set(baseName, family);
    }
    family.indices.push(subscripts);
    family.vars.push(sv);
  }

  const result: Fmi3Variable[] = [...nonArrayVars];

  for (const [baseName, family] of families) {
    if (family.vars.length <= 1) {
      result.push(...family.vars);
      continue;
    }

    const ndims = family.indices[0]?.length ?? 1;
    const allSameNdims = family.indices.every((idx) => idx.length === ndims);
    if (!allSameNdims) {
      result.push(...family.vars);
      continue;
    }

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

    const maxIndices = Array.from({ length: ndims }, () => 0);
    for (const idx of family.indices) {
      for (let d = 0; d < ndims; d++) {
        const val = idx[d] ?? 0;
        if (val > (maxIndices[d] ?? 0)) {
          maxIndices[d] = val;
        }
      }
    }

    const expectedCount = maxIndices.reduce((a, b) => a * b, 1);
    if (family.vars.length !== expectedCount) {
      result.push(...family.vars);
      continue;
    }

    const sortedVars = [...family.vars].sort((a, b) => {
      let subsA: number[] = [];
      let subsB: number[] = [];
      const derMatchA = a.name.match(/^der\((.+)\[([0-9,]+)\]\)$/);
      if (derMatchA) subsA = (derMatchA[2] ?? "").split(",").map(Number);
      else {
        const subMatchA = a.name.match(/^(.+)\[([0-9,]+)\]$/);
        if (subMatchA) subsA = (subMatchA[2] ?? "").split(",").map(Number);
      }

      const derMatchB = b.name.match(/^der\((.+)\[([0-9,]+)\]\)$/);
      if (derMatchB) subsB = (derMatchB[2] ?? "").split(",").map(Number);
      else {
        const subMatchB = b.name.match(/^(.+)\[([0-9,]+)\]$/);
        if (subMatchB) subsB = (subMatchB[2] ?? "").split(",").map(Number);
      }

      for (let d = 0; d < ndims; d++) {
        const va = subsA[d] ?? 0;
        const vb = subsB[d] ?? 0;
        if (va !== vb) return va - vb;
      }
      return 0;
    });

    const startValues: number[] = [];
    let hasStart = false;
    for (const v of sortedVars) {
      if (v.start !== undefined) {
        hasStart = true;
        startValues.push(v.start as number);
      } else {
        startValues.push(0);
      }
    }

    const arrayVar: Fmi3Variable = {
      valueReference: refVar.valueReference,
      name: baseName,
      causality: refVar.causality,
      variability: refVar.variability,
      type: refVar.type,
      dimensions: maxIndices.map((size) => ({ start: size })),
    };
    if (hasStart) {
      arrayVar.start = startValues;
    }
    if (refVar.description) arrayVar.description = refVar.description;
    if (refVar.unit) arrayVar.unit = refVar.unit;
    if (refVar.displayUnit) arrayVar.displayUnit = refVar.displayUnit;
    if (refVar.initial) arrayVar.initial = refVar.initial;
    if (refVar.declaredType) arrayVar.declaredType = refVar.declaredType;
    if (refVar.derivative !== undefined) arrayVar.derivative = refVar.derivative;

    result.push(arrayVar);
  }

  return result.sort((a, b) => a.valueReference - b.valueReference);
}

// ── FMI 3.0 Terminal Detection ──

function detectTerminals3(groupedVariables: Fmi3Variable[]): Fmi3Terminal[] {
  const groups = new Map<string, Fmi3TerminalMemberVariable[]>();

  for (const sv of groupedVariables) {
    const parts = sv.name.split(".");
    if (parts.length < 2) continue;

    const memberName = parts.pop() ?? "";
    const terminalName = parts.join(".");

    let members = groups.get(terminalName);
    if (!members) {
      members = [];
      groups.set(terminalName, members);
    }
    members.push({
      variableName: sv.name,
      valueReference: sv.valueReference,
      memberName,
    });
  }

  const terminals: Fmi3Terminal[] = [];
  for (const [name, members] of groups) {
    if (members.length >= 2) {
      terminals.push({ name, memberVariables: members });
    }
  }

  return terminals;
}

// ── Internal helpers ──

function detectAliases3(dae: ArenaDAEBuilder, variables: Fmi3Variable[]): Map<string, string> {
  const aliasMap = new Map<string, string>();
  const svByName = new Map<string, Fmi3Variable>();
  for (const sv of variables) svByName.set(sv.name, sv);

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
        rhsSv.aliasOf = lhsName;
        aliasMap.set(rhsName, lhsName);
      }
    }
  }

  return aliasMap;
}

/** A single entry in the enriched dependency graph. */
interface DepEntry3 {
  vr: number;
  kind: "dependent" | "constant" | "fixed" | "tunable";
  elementDeps?: Map<number, number[]>;
}

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
  dae: ArenaDAEBuilder,
  variables: Fmi3Variable[],
  outputRefs: number[],
  derivativeRefs: number[],
  initialUnknownRefs: number[],
): Map<number, DepEntry3[]> {
  const deps = new Map<number, DepEntry3[]>();
  const svByName = new Map<string, Fmi3Variable>();
  for (const sv of variables) svByName.set(sv.name, sv);

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
    const sv = variables.find((v) => v.valueReference === ref);
    if (!sv) continue;

    const isArray = sv.dimensions && sv.dimensions.length > 0;
    let totalSize = 1;
    if (isArray && sv.dimensions) {
      for (const dim of sv.dimensions) {
        if (dim.start !== undefined) totalSize *= dim.start;
      }
    }

    if (isArray && totalSize > 1) {
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

/** Map an Arena DAE variable to an FMI 3.0 variable. */
function mapVariable3(dae: ArenaDAEBuilder, idx: number, valueRef: number): Fmi3Variable {
  const name = dae.getVarName(idx);
  const fv: Fmi3Variable = {
    valueReference: valueRef,
    name: name,
    causality: mapCausality3(dae.getVarCausality(idx), dae.getVarVariability(idx), dae.getVarAttrExprIds(idx)),
    variability: mapVariability3(dae.getVarVariability(idx), dae.getVarAttrExprIds(idx)),
    type: mapType3(dae, idx),
  };
  const shape = dae.getVarShape(idx);
  if (shape && shape.length > 0) {
    fv.dimensions = shape.map((d) => ({ start: d }));
  }
  const desc = dae.getVarDescription(idx);
  if (desc) fv.description = desc;

  const startAttr = dae.getVarAttrExprId(idx, "start");
  if (startAttr !== undefined && startAttr >= 0) {
    const startVal = extractNumericLiteral(dae, startAttr);
    if (startVal !== null) fv.start = startVal;
  }
  const expr = dae.getVarExpression(idx);
  if (fv.start === undefined && typeof expr === "number" && expr >= 0) {
    const startVal = extractNumericLiteral(dae, expr);
    if (startVal !== null) fv.start = startVal;
  }
  if (fv.start === undefined && fv.variability === "continuous") {
    fv.start = 0;
  }

  const unitAttr = dae.getVarAttrExprId(idx, "unit");
  if (unitAttr !== undefined && unitAttr >= 0) {
    const unitVal = extractStringLiteral(dae, unitAttr);
    if (unitVal) fv.unit = unitVal;
  }
  const displayUnitAttr = dae.getVarAttrExprId(idx, "displayUnit");
  if (displayUnitAttr !== undefined && displayUnitAttr >= 0) {
    const duVal = extractStringLiteral(dae, displayUnitAttr);
    if (duVal) fv.displayUnit = duVal;
  }

  if (fv.type !== "Float32" && fv.type !== "Float64" && fv.variability === "continuous") {
    fv.variability = "discrete";
  }

  const initialVal = mapInitial3(fv.causality, fv.variability);
  if (initialVal) fv.initial = initialVal;

  if (dae.getVarType(idx) === VarType.Clock) {
    fv.variability = "discrete";
    const intervalAttr = dae.getVarAttrExprId(idx, "intervalVariability");
    if (intervalAttr !== undefined && intervalAttr >= 0) {
      const val = extractStringLiteral(dae, intervalAttr);
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

function mapType3(dae: ArenaDAEBuilder, idx: number): Fmi3Type {
  const fmi3TypeAttr = dae.getVarAttrExprId(idx, "__fmi3_type");
  if (fmi3TypeAttr !== undefined && fmi3TypeAttr >= 0) {
    const val = extractStringLiteral(dae, fmi3TypeAttr);
    if (val && isValidFmi3Type(val)) return val;
  }

  const binaryAttr = dae.getVarAttrExprId(idx, "__fmi3_binary");
  if (binaryAttr !== undefined && binaryAttr >= 0) return "Binary";

  const t = dae.getVarType(idx);
  if (t === VarType.Real) {
    const minAttr = dae.getVarAttrExprId(idx, "min");
    const maxAttr = dae.getVarAttrExprId(idx, "max");
    if (minAttr !== undefined && minAttr >= 0 && maxAttr !== undefined && maxAttr >= 0) {
      const minVal = extractNumericLiteral(dae, minAttr);
      const maxVal = extractNumericLiteral(dae, maxAttr);
      if (minVal !== null && maxVal !== null && Math.abs(maxVal) <= 3.4e38 && Math.abs(minVal) <= 3.4e38) {
        const quantAttr = dae.getVarAttrExprId(idx, "__fmi3_float32");
        if (quantAttr !== undefined && quantAttr >= 0) return "Float32";
      }
    }
    return "Float64";
  }
  if (t === VarType.Integer) {
    const minAttr = dae.getVarAttrExprId(idx, "min");
    const maxAttr = dae.getVarAttrExprId(idx, "max");
    if (minAttr !== undefined && minAttr >= 0 && maxAttr !== undefined && maxAttr >= 0) {
      const minVal = extractNumericLiteral(dae, minAttr);
      const maxVal = extractNumericLiteral(dae, maxAttr);
      if (minVal !== null && maxVal !== null) {
        if (minVal >= 0) {
          if (maxVal <= 255) return "UInt8";
          if (maxVal <= 65535) return "UInt16";
          if (maxVal <= 4294967295) return "UInt32";
          return "UInt64";
        }
        if (minVal >= -128 && maxVal <= 127) return "Int8";
        if (minVal >= -32768 && maxVal <= 32767) return "Int16";
        if (minVal >= -2147483648 && maxVal <= 2147483647) return "Int32";
        return "Int64";
      }
    }
    return "Int32";
  }
  if (t === VarType.Boolean) return "Boolean";
  if (t === VarType.String) return "String";
  if (t === VarType.Enumeration) return "Enumeration";
  if (t === VarType.Clock) return "Clock";
  return "Float64";
}

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

function mapCausality3(c: Causality, v: Variability, attrs?: Map<string, number>): Fmi3Causality {
  if (v === Variability.Parameter) {
    if (attrs?.has("__fmi3_structuralParameter") || attrs?.has("__modelscript_mutableDimension"))
      return "structuralParameter";
    return "parameter";
  }
  if (v === Variability.Constant) return "calculatedParameter";
  if (c === Causality.Input) return "input";
  if (c === Causality.Output) return "output";
  return "local";
}

function mapVariability3(v: Variability, attrs?: Map<string, number>): Fmi3Variability {
  if (attrs?.has("__modelscript_mutableDimension")) return "tunable";
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

function mapInitial3(causality: Fmi3Causality, variability: Fmi3Variability): Fmi3Initial | undefined {
  if (causality === "parameter") return "exact";
  if (causality === "calculatedParameter") return "calculated";
  if (causality === "structuralParameter") return "exact";
  if (causality === "input") return undefined;
  if (causality === "independent") return undefined;
  if (causality === "output") return "calculated";
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

  if (opts.fmuType.modelExchange) {
    lines.push("");
    lines.push(
      `  <ModelExchange modelIdentifier="${escapeXml(opts.modelIdentifier)}" canGetAndSetFMUState="true" canSerializeFMUState="true" providesDirectionalDerivatives="true" />`,
    );
  }

  if (opts.fmuType.coSimulation) {
    lines.push("");
    lines.push(
      `  <CoSimulation modelIdentifier="${escapeXml(opts.modelIdentifier)}" canHandleVariableCommunicationStepSize="true" canReturnEarlyAfterIntermediateUpdate="true" providesIntermediateUpdate="true" canGetAndSetFMUState="true" canSerializeFMUState="true" providesDirectionalDerivatives="true" />`,
    );
  }

  if (opts.fmuType.scheduledExecution) {
    lines.push("");
    lines.push(
      `  <ScheduledExecution modelIdentifier="${escapeXml(opts.modelIdentifier)}" needsExecutionTool="false" canBeInstantiatedOnlyOncePerProcess="false" canGetAndSetFMUState="true" canSerializeFMUState="true" providesDirectionalDerivatives="true" />`,
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

  lines.push("");
  lines.push("  <ModelStructure>");

  if (opts.outputRefs.length > 0) {
    for (const ref of opts.outputRefs) {
      const idx = variables.findIndex((v) => v.valueReference === ref);
      if (idx >= 0) lines.push(formatUnknown3("Output", ref, opts.deps));
    }
  }

  if (opts.derivativeRefs.length > 0) {
    for (const ref of opts.derivativeRefs) {
      const idx = variables.findIndex((v) => v.valueReference === ref);
      if (idx >= 0) lines.push(formatUnknown3("ContinuousStateDerivative", ref, opts.deps));
    }
  }

  if (opts.initialUnknownRefs.length > 0) {
    for (const ref of opts.initialUnknownRefs) {
      const idx = variables.findIndex((v) => v.valueReference === ref);
      if (idx >= 0) lines.push(formatUnknown3("InitialUnknown", ref, opts.deps));
    }
  }

  if (opts.nEventIndicators > 0) {
    // The event indicators were appended to the end of the variables array
    const eventIndicatorStartIndex = variables.length - opts.nEventIndicators;
    for (let i = 0; i < opts.nEventIndicators; i++) {
      const vr = variables[eventIndicatorStartIndex + i]!.valueReference;
      lines.push(`    <EventIndicator valueReference="${vr}" />`);
    }
  }

  if (opts.clockRefs.length > 0) {
    for (const ref of opts.clockRefs) {
      lines.push(`    <Clock valueReference="${ref}" />`);
    }
  }

  lines.push("  </ModelStructure>");

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

function formatUnknown3(elementName: string, ref: number, deps: Map<number, DepEntry3[]>): string {
  const entries = deps.get(ref);
  if (!entries || entries.length === 0) {
    return `    <${elementName} valueReference="${ref}" />`;
  }
  const depsAttr = ` dependencies="${entries.map((e) => e.vr).join(" ")}"`;
  const kindsAttr = ` dependenciesKind="${entries.map((e) => e.kind).join(" ")}"`;

  const hasElementDeps = entries.some((e) => e.elementDeps && e.elementDeps.size > 0);
  if (!hasElementDeps) {
    return `    <${elementName} valueReference="${ref}"${depsAttr}${kindsAttr} />`;
  }

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
  return `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
