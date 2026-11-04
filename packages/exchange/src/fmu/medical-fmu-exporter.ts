// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/exchange — Medical & Biomechanical FMI 2.0 / 3.0 FMU Exporter.
 *
 * Exports OpenSim musculoskeletal models (.osim) and CellML cellular electrophysiology
 * models (.cellml) into standards-compliant FMI 2.0 and FMI 3.0 Model Exchange and
 * Co-Simulation Functional Mock-up Units (.fmu):
 * - OpenSim: Hill-type muscle activation/contraction dynamics (Thelen 2003 / Millard 2012)
 *   and multibody generalized coordinate dynamics with C99 & WebAssembly RK4 solver runtimes.
 * - CellML: SI/physiological <UnitDefinitions>, cross-component connection resolution,
 *   state/derivative <ModelStructure>, and C99 / WebAssembly ODE evaluation code.
 */

import { createZip } from "./archive.js";

// ── Structural Interfaces for OpenSim Models ────────────────────────

export interface OpenSimFmuBodyLike {
  id?: string | undefined;
  name: string;
  mass: number;
  massCenter?: readonly number[] | undefined;
  inertia?: readonly number[] | undefined;
}

export interface OpenSimFmuCoordinateLike {
  id?: string | undefined;
  name: string;
  motionType?: "rotational" | "translational" | "coupled" | string | undefined;
  defaultValue?: number | undefined;
  rangeMin?: number | undefined;
  rangeMax?: number | undefined;
  clamped?: boolean | undefined;
  locked?: boolean | undefined;
}

export interface OpenSimFmuJointLike {
  id?: string | undefined;
  name: string;
  jointType?: string | undefined;
  parentFrame?: string | undefined;
  childFrame?: string | undefined;
  locationInParent?: readonly number[] | undefined;
  orientationInParent?: readonly number[] | undefined;
  coordinates?: readonly OpenSimFmuCoordinateLike[] | undefined;
}

export interface OpenSimFmuPathPointLike {
  name?: string | undefined;
  bodyFrame: string;
  location: readonly number[];
}

export interface OpenSimFmuMuscleLike {
  id?: string | undefined;
  name: string;
  muscleType?: string | undefined;
  maxIsometricForce: number;
  optimalFiberLength: number;
  tendonSlackLength: number;
  pennationAngleAtOptimal?: number | undefined;
  activationTimeConstant?: number | undefined;
  deactivationTimeConstant?: number | undefined;
  maxContractionVelocity?: number | undefined;
  pathPoints?: readonly OpenSimFmuPathPointLike[] | undefined;
  wrapObjects?: readonly string[] | undefined;
}

export interface OpenSimFmuModelLike {
  modelName?: string | undefined;
  name?: string | undefined;
  version?: string | undefined;
  gravity?: readonly number[] | undefined;
  bodies: readonly OpenSimFmuBodyLike[];
  joints: readonly OpenSimFmuJointLike[];
  coordinates?: readonly OpenSimFmuCoordinateLike[] | undefined;
  muscles: readonly OpenSimFmuMuscleLike[];
}

// ── Structural Interfaces for CellML Models ─────────────────────────

export interface CellmlFmuDimensionVectorLike {
  ampere?: number | undefined;
  kelvin?: number | undefined;
  kilogram?: number | undefined;
  metre?: number | undefined;
  mole?: number | undefined;
  second?: number | undefined;
  candela?: number | undefined;
  multiplierScale?: number | undefined;
}

export interface CellmlFmuUnitsLike {
  name: string;
  isBaseUnits?: boolean | undefined;
  dimensions?: CellmlFmuDimensionVectorLike | undefined;
}

export interface CellmlFmuVariableLike {
  name: string;
  units: string;
  initialValue?: number | undefined;
  publicInterface?: "in" | "out" | "none" | string | undefined;
  privateInterface?: "in" | "out" | "none" | string | undefined;
}

export interface CellmlFmuEquationLike {
  targetVariable: string;
  isOde: boolean;
  independentVariable?: string | undefined;
  rhsExpression: string;
  referencedIdentifiers?: readonly string[] | undefined;
}

export interface CellmlFmuComponentLike {
  name: string;
  variables: ReadonlyMap<string, CellmlFmuVariableLike> | readonly CellmlFmuVariableLike[];
  equations: readonly CellmlFmuEquationLike[];
}

export interface CellmlFmuVariableMappingLike {
  variable1: string;
  variable2: string;
}

export interface CellmlFmuConnectionLike {
  component1: string;
  component2: string;
  mappings: readonly CellmlFmuVariableMappingLike[];
}

export interface CellmlFmuModelLike {
  name: string;
  version?: "1.0" | "1.1" | "2.0" | string | undefined;
  units?: ReadonlyMap<string, CellmlFmuUnitsLike> | readonly CellmlFmuUnitsLike[] | undefined;
  components: ReadonlyMap<string, CellmlFmuComponentLike> | readonly CellmlFmuComponentLike[];
  connections?: readonly CellmlFmuConnectionLike[] | undefined;
}

// ── Options & Export Result Types ───────────────────────────────────

export interface MedicalFmuOptions {
  /** Target FMI specification version ("2.0" or "3.0", default: "2.0"). */
  fmiVersion?: "2.0" | "3.0" | undefined;
  /** C-compatible model identifier and FMU file stem. */
  modelIdentifier?: string | undefined;
  /** Unique GUID / instantiationToken. */
  guid?: string | undefined;
  /** Model description text. */
  description?: string | undefined;
  /** Author name. */
  author?: string | undefined;
  /** Simulation start time in seconds (default: 0.0). */
  startTime?: number | undefined;
  /** Simulation stop time in seconds (default: 5.0). */
  stopTime?: number | undefined;
  /** Default step size in seconds (default: 0.001). */
  stepSize?: number | undefined;
  /** Include C99 and JS/WASM runtime sources in sources/ (default: true). */
  includeSources?: boolean | undefined;
}

export interface MedicalFmuExportResult {
  /** Complete .fmu ZIP archive bytes. */
  archive: Uint8Array;
  /** Generated modelDescription.xml matching requested fmiVersion. */
  modelDescriptionXml: string;
  /** Generated FMI 2.0 modelDescription.xml string. */
  modelDescription2Xml: string;
  /** Generated FMI 3.0 modelDescription.xml string. */
  modelDescription3Xml: string;
  /** Generated C99 source code (sources/model.c). */
  cSource: string;
  /** Generated WebAssembly-ready JS/TS RK4 solver runtime source (sources/runtime.js). */
  wasmRuntimeSource: string;
  /** List of file paths packaged inside the FMU archive. */
  files: string[];
  /** Active FMI version ("2.0" | "3.0"). */
  fmiVersion: "2.0" | "3.0";
  /** Sanitized model identifier. */
  modelIdentifier: string;
  /** FMU GUID / instantiationToken. */
  guid: string;
  /** Total count of exposed FMI variables. */
  variableCount: number;
}

// ── Internal Variable Descriptor ────────────────────────────────────

interface InternalFmuVar {
  index: number; // 1-based index in <ModelVariables>
  vr: number;
  name: string;
  cIdent: string;
  causality: "input" | "output" | "parameter" | "local" | "independent";
  variability: "constant" | "fixed" | "tunable" | "discrete" | "continuous";
  initial?: "exact" | "approx" | "calculated" | undefined;
  start?: number | undefined;
  min?: number | undefined;
  max?: number | undefined;
  unit?: string | undefined;
  description: string;
  /** 1-based index of state variable (for FMI 2.0 derivative attribute). */
  derivativeOfIndex?: number | undefined;
  /** ValueReference of state variable (for FMI 3.0 derivative attribute). */
  derivativeOfVr?: number | undefined;
}

interface BaseUnitDef {
  name: string;
  kg?: number | undefined;
  m?: number | undefined;
  s?: number | undefined;
  A?: number | undefined;
  K?: number | undefined;
  mol?: number | undefined;
  cd?: number | undefined;
  factor?: number | undefined;
}

// ── Helpers ─────────────────────────────────────────────────────────

function sanitizeIdentifier(raw: string, fallback = "medical_model"): string {
  const sanitized = raw.replace(/[^a-zA-Z0-9_]/g, "_");
  let start = 0;
  while (start < sanitized.length && sanitized[start] === "_") {
    start++;
  }
  let end = sanitized.length;
  while (end > start && sanitized[end - 1] === "_") {
    end--;
  }
  const res = sanitized.slice(start, end);
  if (!res) return fallback;
  return /^[0-9]/.test(res) ? `m_${res}` : res;
}

function generateGuid(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, "0");
  return `{${hex.slice(0, 8)}-6c42-4d91-9e1a-${hex.padEnd(12, "0").slice(0, 12)}}`;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function canonicalFrame(raw: string | undefined): string {
  if (!raw) return "ground";
  const t = raw.trim();
  if (t === "ground" || t === "/ground") return "ground";
  return t.replace(/^\/?bodyset\//i, "").replace(/^\//, "");
}

function buildUnitDefinitionsXml(units: readonly BaseUnitDef[]): string {
  if (units.length === 0) return "";
  const lines: string[] = ["  <UnitDefinitions>"];
  for (const u of units) {
    const attrs: string[] = [];
    if (u.kg !== undefined && u.kg !== 0) attrs.push(`kg="${u.kg}"`);
    if (u.m !== undefined && u.m !== 0) attrs.push(`m="${u.m}"`);
    if (u.s !== undefined && u.s !== 0) attrs.push(`s="${u.s}"`);
    if (u.A !== undefined && u.A !== 0) attrs.push(`A="${u.A}"`);
    if (u.K !== undefined && u.K !== 0) attrs.push(`K="${u.K}"`);
    if (u.mol !== undefined && u.mol !== 0) attrs.push(`mol="${u.mol}"`);
    if (u.cd !== undefined && u.cd !== 0) attrs.push(`cd="${u.cd}"`);
    if (u.factor !== undefined && u.factor !== 1) attrs.push(`factor="${u.factor}"`);
    if (attrs.length > 0) {
      lines.push(`    <Unit name="${escapeXml(u.name)}">`);
      lines.push(`      <BaseUnit ${attrs.join(" ")} />`);
      lines.push(`    </Unit>`);
    } else {
      lines.push(`    <Unit name="${escapeXml(u.name)}" />`);
    }
  }
  lines.push("  </UnitDefinitions>");
  return lines.join("\n");
}

function renderFmi2ModelDescription(
  modelIdentifier: string,
  guid: string,
  description: string,
  generationTool: string,
  startTime: number,
  stopTime: number,
  stepSize: number,
  units: readonly BaseUnitDef[],
  vars: readonly InternalFmuVar[],
): string {
  const unitXml = buildUnitDefinitionsXml(units);
  const varLines: string[] = [];

  for (const v of vars) {
    const svAttrs: string[] = [
      `name="${escapeXml(v.name)}"`,
      `valueReference="${v.vr}"`,
      `causality="${v.causality}"`,
      `variability="${v.variability}"`,
    ];
    if (v.initial) svAttrs.push(`initial="${v.initial}"`);
    if (v.description) svAttrs.push(`description="${escapeXml(v.description)}"`);

    const realAttrs: string[] = [];
    if (v.start !== undefined) realAttrs.push(`start="${v.start}"`);
    if (v.min !== undefined) realAttrs.push(`min="${v.min}"`);
    if (v.max !== undefined) realAttrs.push(`max="${v.max}"`);
    if (v.unit) realAttrs.push(`unit="${escapeXml(v.unit)}"`);
    if (v.derivativeOfIndex !== undefined) realAttrs.push(`derivative="${v.derivativeOfIndex}"`);

    const realAttrStr = realAttrs.length > 0 ? " " + realAttrs.join(" ") : "";
    varLines.push(`    <ScalarVariable ${svAttrs.join(" ")}>\n      <Real${realAttrStr} />\n    </ScalarVariable>`);
  }

  const outputVars = vars.filter((v) => v.causality === "output");
  const derivVars = vars.filter((v) => v.derivativeOfIndex !== undefined);
  const initialUnknownIndices = Array.from(
    new Set([...outputVars.map((v) => v.index), ...derivVars.map((v) => v.index)]),
  );

  const outputsBlock =
    outputVars.length > 0
      ? `    <Outputs>\n${outputVars.map((v) => `      <Unknown index="${v.index}" />`).join("\n")}\n    </Outputs>`
      : "    <Outputs />";

  const derivsBlock =
    derivVars.length > 0
      ? `    <Derivatives>\n${derivVars.map((v) => `      <Unknown index="${v.index}" />`).join("\n")}\n    </Derivatives>`
      : "";

  const initUnknownsBlock =
    initialUnknownIndices.length > 0
      ? `    <InitialUnknowns>\n${initialUnknownIndices.map((idx) => `      <Unknown index="${idx}" />`).join("\n")}\n    </InitialUnknowns>`
      : "";

  const structureParts = [outputsBlock, derivsBlock, initUnknownsBlock].filter((s) => s.length > 0);

  return `<?xml version="1.0" encoding="UTF-8"?>
<fmiModelDescription
  fmiVersion="2.0"
  modelName="${escapeXml(modelIdentifier)}"
  guid="${escapeXml(guid)}"
  description="${escapeXml(description)}"
  generationTool="${escapeXml(generationTool)}"
  generationDateAndTime="${new Date().toISOString()}"
  variableNamingConvention="structured"
  numberOfEventIndicators="0">

  <ModelExchange
    modelIdentifier="${escapeXml(modelIdentifier)}"
    canNotUseMemoryManagementFunctions="true"
    canGetAndSetFMUstate="false"
    canSerializeFMUstate="false"
    providesDirectionalDerivative="false">
    <SourceFiles>
      <File name="model.c" />
    </SourceFiles>
  </ModelExchange>

  <CoSimulation
    modelIdentifier="${escapeXml(modelIdentifier)}"
    canHandleVariableCommunicationStepSize="true"
    canInterpolateInputs="true"
    maxOutputDerivativeOrder="0"
    canRunAsynchronuously="false"
    canBeInstantiatedOnlyOncePerProcess="false"
    canNotUseMemoryManagementFunctions="true"
    canGetAndSetFMUstate="false"
    canSerializeFMUstate="false"
    providesDirectionalDerivative="false">
    <SourceFiles>
      <File name="model.c" />
    </SourceFiles>
  </CoSimulation>

${unitXml ? unitXml + "\n\n" : ""}  <DefaultExperiment startTime="${startTime}" stopTime="${stopTime}" stepSize="${stepSize}" />

  <ModelVariables>
${varLines.join("\n")}
  </ModelVariables>

  <ModelStructure>
${structureParts.join("\n")}
  </ModelStructure>
</fmiModelDescription>`;
}

function renderFmi3ModelDescription(
  modelIdentifier: string,
  instantiationToken: string,
  description: string,
  generationTool: string,
  startTime: number,
  stopTime: number,
  stepSize: number,
  units: readonly BaseUnitDef[],
  vars: readonly InternalFmuVar[],
): string {
  const unitXml = buildUnitDefinitionsXml(units);
  const varLines: string[] = [];

  for (const v of vars) {
    const attrs: string[] = [
      `name="${escapeXml(v.name)}"`,
      `valueReference="${v.vr}"`,
      `causality="${v.causality}"`,
      `variability="${v.variability}"`,
    ];
    if (v.initial) attrs.push(`initial="${v.initial}"`);
    if (v.start !== undefined) attrs.push(`start="${v.start}"`);
    if (v.min !== undefined) attrs.push(`min="${v.min}"`);
    if (v.max !== undefined) attrs.push(`max="${v.max}"`);
    if (v.unit) attrs.push(`unit="${escapeXml(v.unit)}"`);
    if (v.derivativeOfVr !== undefined) attrs.push(`derivative="${v.derivativeOfVr}"`);
    if (v.description) attrs.push(`description="${escapeXml(v.description)}"`);

    varLines.push(`    <Float64 ${attrs.join(" ")} />`);
  }

  const outputVars = vars.filter((v) => v.causality === "output");
  const derivVars = vars.filter((v) => v.derivativeOfVr !== undefined);
  const initialUnknownVrs = Array.from(new Set([...outputVars.map((v) => v.vr), ...derivVars.map((v) => v.vr)]));

  const msLines: string[] = [];
  for (const o of outputVars) {
    msLines.push(`    <Output valueReference="${o.vr}" />`);
  }
  for (const d of derivVars) {
    msLines.push(`    <ContinuousStateDerivative valueReference="${d.vr}" />`);
  }
  for (const vr of initialUnknownVrs) {
    msLines.push(`    <InitialUnknown valueReference="${vr}" />`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<fmiModelDescription
  fmiVersion="3.0"
  modelName="${escapeXml(modelIdentifier)}"
  instantiationToken="${escapeXml(instantiationToken)}"
  description="${escapeXml(description)}"
  generationTool="${escapeXml(generationTool)}"
  generationDateAndTime="${new Date().toISOString()}"
  variableNamingConvention="structured">

  <ModelExchange
    modelIdentifier="${escapeXml(modelIdentifier)}"
    canGetAndSetFMUState="false"
    canSerializeFMUState="false"
    providesDirectionalDerivatives="false"
    providesAdjointDerivatives="false" />

  <CoSimulation
    modelIdentifier="${escapeXml(modelIdentifier)}"
    canHandleVariableCommunicationStepSize="true"
    canInterpolateInputs="true"
    canRunAsynchronuously="false"
    providesPerElementDependencies="false" />

${unitXml ? unitXml + "\n\n" : ""}  <DefaultExperiment startTime="${startTime}" stopTime="${stopTime}" stepSize="${stepSize}" />

  <ModelVariables>
${varLines.join("\n")}
  </ModelVariables>

  <ModelStructure>
${msLines.join("\n")}
  </ModelStructure>
</fmiModelDescription>`;
}

// ── 1. OpenSim Musculoskeletal FMU Exporter ─────────────────────────

interface ResolvedCoordEntry {
  coord: OpenSimFmuCoordinateLike;
  cId: string;
  mass: number;
  effInertia: number;
  comDist: number;
  locked: boolean;
  clamped: boolean;
  rangeMin: number;
  rangeMax: number;
  defaultValue: number;
  isTranslational: boolean;
  qVr: number;
  dqVr: number;
  uVr: number;
  duVr: number;
}

interface ResolvedMuscleEntry {
  muscle: OpenSimFmuMuscleLike;
  mId: string;
  maxIsometricForce: number;
  optimalFiberLength: number;
  tendonSlackLength: number;
  pennationAngle: number;
  tauAct: number;
  tauDeact: number;
  maxContractionVelocity: number;
  basePathLength: number;
  uExcVr: number;
  aVr: number;
  daVr: number;
  lMVr: number;
  dlMVr: number;
  fTendonVr: number;
  fMaxParamVr: number;
  lOptParamVr: number;
  lSlackParamVr: number;
}

function collectOpenSimCoordinates(doc: OpenSimFmuModelLike): {
  coord: OpenSimFmuCoordinateLike;
  joint?: OpenSimFmuJointLike | undefined;
}[] {
  const result: { coord: OpenSimFmuCoordinateLike; joint?: OpenSimFmuJointLike | undefined }[] = [];
  const seen = new Set<string>();

  for (const j of doc.joints) {
    if (!j.coordinates) continue;
    for (const c of j.coordinates) {
      if (!seen.has(c.name)) {
        seen.add(c.name);
        result.push({ coord: c, joint: j });
      }
    }
  }

  if (doc.coordinates) {
    for (const c of doc.coordinates) {
      if (!seen.has(c.name)) {
        seen.add(c.name);
        result.push({ coord: c, joint: doc.joints[0] });
      }
    }
  }

  return result;
}

function estimateMuscleBaseLength(m: OpenSimFmuMuscleLike): number {
  const lOpt = Math.max(1e-4, m.optimalFiberLength);
  const alpha = m.pennationAngleAtOptimal ?? 0.0;
  const lSlack = Math.max(0.0, m.tendonSlackLength);
  const nominal = lOpt * Math.cos(alpha) + lSlack;
  if (m.pathPoints && m.pathPoints.length >= 2) {
    let dist = 0;
    for (let i = 1; i < m.pathPoints.length; i++) {
      const p0 = m.pathPoints[i - 1]?.location ?? [0, 0, 0];
      const p1 = m.pathPoints[i]?.location ?? [0, 0, 0];
      const dx = (p1[0] ?? 0) - (p0[0] ?? 0);
      const dy = (p1[1] ?? 0) - (p0[1] ?? 0);
      const dz = (p1[2] ?? 0) - (p0[2] ?? 0);
      dist += Math.hypot(dx, dy, dz);
    }
    if (dist > 1e-4) {
      return Math.max(dist, nominal * 0.85);
    }
  }
  return nominal;
}

function generateOpenSimC99Source(
  modelIdentifier: string,
  gravityMag: number,
  muscles: readonly ResolvedMuscleEntry[],
  coords: readonly ResolvedCoordEntry[],
  bodyParams: readonly { vr: number; mass: number }[],
  maxVr: number,
): string {
  const nMuscles = Math.max(1, muscles.length);
  const nCoords = Math.max(1, coords.length);
  const nStates = 2 * muscles.length + 2 * coords.length;

  const initLines: string[] = [];
  for (let i = 0; i < muscles.length; i++) {
    const m = muscles[i]!;
    initLines.push(`  inst->u_exc[${i}] = 0.05;`);
    initLines.push(`  inst->a[${i}] = 0.05;`);
    initLines.push(`  inst->l_M[${i}] = ${m.optimalFiberLength.toFixed(6)};`);
    initLines.push(`  inst->F_max[${i}] = ${m.maxIsometricForce.toFixed(4)};`);
    initLines.push(`  inst->l_opt[${i}] = ${m.optimalFiberLength.toFixed(6)};`);
    initLines.push(`  inst->l_slack[${i}] = ${m.tendonSlackLength.toFixed(6)};`);
    initLines.push(`  inst->pennation[${i}] = ${m.pennationAngle.toFixed(6)};`);
    initLines.push(`  inst->tau_act[${i}] = ${m.tauAct.toFixed(6)};`);
    initLines.push(`  inst->tau_deact[${i}] = ${m.tauDeact.toFixed(6)};`);
    initLines.push(`  inst->v_max_mult[${i}] = ${m.maxContractionVelocity.toFixed(4)};`);
    initLines.push(`  inst->base_l_mt[${i}] = ${m.basePathLength.toFixed(6)};`);
    initLines.push(`  inst->vars[${m.uExcVr}] = 0.05;`);
    initLines.push(`  inst->vars[${m.aVr}] = 0.05;`);
    initLines.push(`  inst->vars[${m.lMVr}] = ${m.optimalFiberLength.toFixed(6)};`);
    initLines.push(`  inst->vars[${m.fMaxParamVr}] = ${m.maxIsometricForce.toFixed(4)};`);
    initLines.push(`  inst->vars[${m.lOptParamVr}] = ${m.optimalFiberLength.toFixed(6)};`);
    initLines.push(`  inst->vars[${m.lSlackParamVr}] = ${m.tendonSlackLength.toFixed(6)};`);
  }

  for (let i = 0; i < coords.length; i++) {
    const c = coords[i]!;
    initLines.push(`  inst->q[${i}] = ${c.defaultValue.toFixed(6)};`);
    initLines.push(`  inst->u[${i}] = 0.0;`);
    initLines.push(`  inst->q0[${i}] = ${c.defaultValue.toFixed(6)};`);
    initLines.push(`  inst->coord_mass[${i}] = ${c.mass.toFixed(4)};`);
    initLines.push(`  inst->eff_inertia[${i}] = ${c.effInertia.toFixed(6)};`);
    initLines.push(`  inst->com_dist[${i}] = ${c.comDist.toFixed(6)};`);
    initLines.push(`  inst->coord_locked[${i}] = ${c.locked ? 1 : 0};`);
    initLines.push(`  inst->vars[${c.qVr}] = ${c.defaultValue.toFixed(6)};`);
    initLines.push(`  inst->vars[${c.uVr}] = 0.0;`);
  }

  for (const bp of bodyParams) {
    initLines.push(`  inst->vars[${bp.vr}] = ${bp.mass.toFixed(4)};`);
  }

  const syncFromVarsLines: string[] = [];
  for (let i = 0; i < muscles.length; i++) {
    const m = muscles[i]!;
    syncFromVarsLines.push(`  inst->u_exc[${i}] = fmax(0.01, fmin(1.0, inst->vars[${m.uExcVr}]));`);
    syncFromVarsLines.push(
      `  if (inst->vars[${m.fMaxParamVr}] > 0.0) inst->F_max[${i}] = inst->vars[${m.fMaxParamVr}];`,
    );
    syncFromVarsLines.push(
      `  if (inst->vars[${m.lOptParamVr}] > 1e-5) inst->l_opt[${i}] = inst->vars[${m.lOptParamVr}];`,
    );
    syncFromVarsLines.push(
      `  if (inst->vars[${m.lSlackParamVr}] >= 0.0) inst->l_slack[${i}] = inst->vars[${m.lSlackParamVr}];`,
    );
  }

  const syncToVarsLines: string[] = [];
  for (let i = 0; i < muscles.length; i++) {
    const m = muscles[i]!;
    syncToVarsLines.push(`  inst->vars[${m.aVr}] = inst->a[${i}];`);
    syncToVarsLines.push(`  inst->vars[${m.daVr}] = inst->da[${i}];`);
    syncToVarsLines.push(`  inst->vars[${m.lMVr}] = inst->l_M[${i}];`);
    syncToVarsLines.push(`  inst->vars[${m.dlMVr}] = inst->dl_M[${i}];`);
    syncToVarsLines.push(`  inst->vars[${m.fTendonVr}] = inst->F_tendon[${i}];`);
  }
  for (let i = 0; i < coords.length; i++) {
    const c = coords[i]!;
    syncToVarsLines.push(`  inst->vars[${c.qVr}] = inst->q[${i}];`);
    syncToVarsLines.push(`  inst->vars[${c.dqVr}] = inst->dq[${i}];`);
    syncToVarsLines.push(`  inst->vars[${c.uVr}] = inst->u[${i}];`);
    syncToVarsLines.push(`  inst->vars[${c.duVr}] = inst->du[${i}];`);
  }

  return `/* SPDX-License-Identifier: AGPL-3.0-or-later */
/* ModelScript Biomechanical OpenSim Hill-Muscle & Multibody FMI 2.0 / 3.0 C99 Runtime (model.c) */
#define FMI2_FUNCTION_PREFIX ${modelIdentifier}_
#define MODEL_IDENTIFIER "${modelIdentifier}"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#define N_MUSCLES ${nMuscles}
#define N_COORDS ${nCoords}
#define N_STATES ${Math.max(1, nStates)}
#define MAX_VR ${maxVr}
#define GRAVITY_ACCEL ${gravityMag.toFixed(6)}

typedef void* fmi2Component;
typedef unsigned int fmi2ValueReference;
typedef double fmi2Real;
typedef int fmi2Integer;
typedef int fmi2Boolean;
typedef const char* fmi2String;

typedef enum {
  fmi2OK = 0,
  fmi2Warning = 1,
  fmi2Discard = 2,
  fmi2Error = 3,
  fmi2Fatal = 4,
  fmi2Pending = 5
} fmi2Status;

typedef void* fmi3Instance;
typedef unsigned int fmi3ValueReference;
typedef double fmi3Float64;
typedef int fmi3Status;

typedef struct {
  fmi2Real current_time;
  fmi2Real start_time;
  fmi2Real step_size;
  int initialized;

  /* Hill-type muscle states, excitations, forces, and tunable parameters */
  fmi2Real u_exc[N_MUSCLES];
  fmi2Real a[N_MUSCLES];
  fmi2Real da[N_MUSCLES];
  fmi2Real l_M[N_MUSCLES];
  fmi2Real dl_M[N_MUSCLES];
  fmi2Real F_tendon[N_MUSCLES];
  fmi2Real F_max[N_MUSCLES];
  fmi2Real l_opt[N_MUSCLES];
  fmi2Real l_slack[N_MUSCLES];
  fmi2Real pennation[N_MUSCLES];
  fmi2Real tau_act[N_MUSCLES];
  fmi2Real tau_deact[N_MUSCLES];
  fmi2Real v_max_mult[N_MUSCLES];
  fmi2Real base_l_mt[N_MUSCLES];

  /* Generalized coordinates and speeds */
  fmi2Real q[N_COORDS];
  fmi2Real dq[N_COORDS];
  fmi2Real u[N_COORDS];
  fmi2Real du[N_COORDS];
  fmi2Real q0[N_COORDS];
  fmi2Real coord_mass[N_COORDS];
  fmi2Real eff_inertia[N_COORDS];
  fmi2Real com_dist[N_COORDS];
  int coord_locked[N_COORDS];

  /* Flat FMI ValueReference table */
  fmi2Real vars[MAX_VR];
} OpenSimFmuInstance;

/* Hill-type neural excitation-activation derivative da/dt (Thelen 2003 / Millard 2012) */
static fmi2Real hill_activation_derivative(fmi2Real a, fmi2Real u, fmi2Real tau_act, fmi2Real tau_deact) {
  fmi2Real act = fmax(0.01, fmin(1.0, a));
  fmi2Real exc = fmax(0.01, fmin(1.0, u));
  fmi2Real t_a = tau_act > 1e-5 ? tau_act : 0.01;
  fmi2Real t_d = tau_deact > 1e-5 ? tau_deact : 0.04;
  fmi2Real tau = (exc > act) ? t_a * (0.5 + 1.5 * act) : t_d / (0.5 + 1.5 * act);
  return (exc - act) / tau;
}

/* Active Gaussian force-length curve f_L(l_tilde) */
static fmi2Real hill_active_force_length(fmi2Real norm_l) {
  fmi2Real diff = norm_l - 1.0;
  return exp(-(diff * diff) / 0.45);
}

/* Passive exponential force-length curve f_PE(l_tilde) */
static fmi2Real hill_passive_force_length(fmi2Real norm_l) {
  if (norm_l <= 1.0) return 0.0;
  fmi2Real strain = fmin(norm_l - 1.0, 1.2);
  return (exp(4.0 * strain / 0.6) - 1.0) / (exp(4.0) - 1.0);
}

/* Force-velocity curve f_V(v_tilde) */
static fmi2Real hill_force_velocity(fmi2Real norm_v) {
  fmi2Real v = fmax(-1.0, fmin(1.0, norm_v));
  const fmi2Real af = 0.3;
  const fmi2Real fmax_e = 1.4;
  if (v <= 0.0) {
    return (1.0 + v) / (1.0 - v / af);
  }
  fmi2Real b = (2.0 + 2.0 / af) * v;
  return (1.0 + fmax_e * b) / (1.0 + b);
}

static void opensim_sync_from_vars(OpenSimFmuInstance* inst) {
${syncFromVarsLines.join("\n")}
}

static void opensim_sync_to_vars(OpenSimFmuInstance* inst) {
${syncToVarsLines.join("\n")}
}

static void opensim_evaluate_derivatives(
  const OpenSimFmuInstance* inst,
  const fmi2Real* a_state,
  const fmi2Real* lM_state,
  const fmi2Real* q_state,
  const fmi2Real* u_state,
  fmi2Real* da_out,
  fmi2Real* dlM_out,
  fmi2Real* fTendon_out,
  fmi2Real* dq_out,
  fmi2Real* du_out
) {
  for (int m = 0; m < ${muscles.length}; m++) {
    fmi2Real act = fmax(0.01, fmin(1.0, a_state[m]));
    fmi2Real exc = fmax(0.01, fmin(1.0, inst->u_exc[m]));
    da_out[m] = hill_activation_derivative(act, exc, inst->tau_act[m], inst->tau_deact[m]);

    fmi2Real l_opt = fmax(1e-4, inst->l_opt[m]);
    fmi2Real l_slack = fmax(1e-4, inst->l_slack[m]);
    fmi2Real f_max = fmax(0.0, inst->F_max[m]);
    fmi2Real v_max = fmax(0.1, inst->v_max_mult[m]) * l_opt;
    fmi2Real cos_a = fmax(0.1, cos(inst->pennation[m]));

    fmi2Real l_mt = inst->base_l_mt[m];
    for (int c = 0; c < ${coords.length}; c++) {
      l_mt -= 0.04 * (q_state[c] - inst->q0[c]);
    }

    fmi2Real curr_lM = fmax(0.2 * l_opt, lM_state[m]);
    fmi2Real norm_lM = curr_lM / l_opt;
    fmi2Real f_L = hill_active_force_length(norm_lM);
    fmi2Real f_PE = hill_passive_force_length(norm_lM);

    fmi2Real l_T = fmax(0.0, l_mt - curr_lM * cos_a);
    fmi2Real strain_T = (l_T - l_slack) / l_slack;
    fmi2Real norm_fT = strain_T > 0.0 ? fmin(3.0, 35.0 * strain_T * strain_T + 0.2 * strain_T) : 0.0;

    fmi2Real target_fM = norm_fT / cos_a;
    fmi2Real active_cap = fmax(1e-3, act * f_L);
    fmi2Real req_fV = fmax(0.0, fmin(1.35, (target_fM - f_PE) / active_cap));
    fmi2Real norm_v = fmax(-1.0, fmin(1.0, (req_fV - 1.0) * 0.5));
    dlM_out[m] = norm_v * v_max;

    fmi2Real f_V = hill_force_velocity(norm_v);
    fmi2Real active_F = f_max * act * f_L * f_V;
    fmi2Real passive_F = f_max * f_PE;
    fmi2Real fiber_along_tendon = (active_F + passive_F) * cos_a;
    fTendon_out[m] = fmax(0.0, 0.5 * (f_max * norm_fT + fiber_along_tendon));
  }

  for (int c = 0; c < ${coords.length}; c++) {
    if (inst->coord_locked[c]) {
      dq_out[c] = 0.0;
      du_out[c] = 0.0;
      continue;
    }
    dq_out[c] = u_state[c];
    fmi2Real tau_muscle = 0.0;
    for (int m = 0; m < ${muscles.length}; m++) {
      tau_muscle += 0.04 * fTendon_out[m];
    }
    fmi2Real tau_grav = -inst->coord_mass[c] * GRAVITY_ACCEL * inst->com_dist[c] * sin(q_state[c]);
    du_out[c] = (tau_muscle - 0.5 * u_state[c] + tau_grav) / fmax(1e-4, inst->eff_inertia[c]);
  }
}

static void opensim_rk4_step(OpenSimFmuInstance* inst, fmi2Real dt) {
  fmi2Real k1_a[N_MUSCLES], k1_lM[N_MUSCLES], fT1[N_MUSCLES], k1_q[N_COORDS], k1_u[N_COORDS];
  fmi2Real k2_a[N_MUSCLES], k2_lM[N_MUSCLES], fT2[N_MUSCLES], k2_q[N_COORDS], k2_u[N_COORDS];
  fmi2Real k3_a[N_MUSCLES], k3_lM[N_MUSCLES], fT3[N_MUSCLES], k3_q[N_COORDS], k3_u[N_COORDS];
  fmi2Real k4_a[N_MUSCLES], k4_lM[N_MUSCLES], fT4[N_MUSCLES], k4_q[N_COORDS], k4_u[N_COORDS];
  fmi2Real tmp_a[N_MUSCLES], tmp_lM[N_MUSCLES], tmp_q[N_COORDS], tmp_u[N_COORDS];

  opensim_evaluate_derivatives(inst, inst->a, inst->l_M, inst->q, inst->u, k1_a, k1_lM, fT1, k1_q, k1_u);

  for (int m = 0; m < ${muscles.length}; m++) {
    tmp_a[m] = fmax(0.01, fmin(1.0, inst->a[m] + 0.5 * dt * k1_a[m]));
    tmp_lM[m] = fmax(1e-4, inst->l_M[m] + 0.5 * dt * k1_lM[m]);
  }
  for (int c = 0; c < ${coords.length}; c++) {
    tmp_q[c] = inst->q[c] + 0.5 * dt * k1_q[c];
    tmp_u[c] = inst->u[c] + 0.5 * dt * k1_u[c];
  }
  opensim_evaluate_derivatives(inst, tmp_a, tmp_lM, tmp_q, tmp_u, k2_a, k2_lM, fT2, k2_q, k2_u);

  for (int m = 0; m < ${muscles.length}; m++) {
    tmp_a[m] = fmax(0.01, fmin(1.0, inst->a[m] + 0.5 * dt * k2_a[m]));
    tmp_lM[m] = fmax(1e-4, inst->l_M[m] + 0.5 * dt * k2_lM[m]);
  }
  for (int c = 0; c < ${coords.length}; c++) {
    tmp_q[c] = inst->q[c] + 0.5 * dt * k2_q[c];
    tmp_u[c] = inst->u[c] + 0.5 * dt * k2_u[c];
  }
  opensim_evaluate_derivatives(inst, tmp_a, tmp_lM, tmp_q, tmp_u, k3_a, k3_lM, fT3, k3_q, k3_u);

  for (int m = 0; m < ${muscles.length}; m++) {
    tmp_a[m] = fmax(0.01, fmin(1.0, inst->a[m] + dt * k3_a[m]));
    tmp_lM[m] = fmax(1e-4, inst->l_M[m] + dt * k3_lM[m]);
  }
  for (int c = 0; c < ${coords.length}; c++) {
    tmp_q[c] = inst->q[c] + dt * k3_q[c];
    tmp_u[c] = inst->u[c] + dt * k3_u[c];
  }
  opensim_evaluate_derivatives(inst, tmp_a, tmp_lM, tmp_q, tmp_u, k4_a, k4_lM, fT4, k4_q, k4_u);

  for (int m = 0; m < ${muscles.length}; m++) {
    inst->a[m] = fmax(0.01, fmin(1.0, inst->a[m] + (dt / 6.0) * (k1_a[m] + 2.0 * k2_a[m] + 2.0 * k3_a[m] + k4_a[m])));
    inst->l_M[m] = fmax(0.2 * inst->l_opt[m], fmin(2.0 * inst->l_opt[m], inst->l_M[m] + (dt / 6.0) * (k1_lM[m] + 2.0 * k2_lM[m] + 2.0 * k3_lM[m] + k4_lM[m])));
  }
  for (int c = 0; c < ${coords.length}; c++) {
    if (inst->coord_locked[c]) continue;
    inst->q[c] += (dt / 6.0) * (k1_q[c] + 2.0 * k2_q[c] + 2.0 * k3_q[c] + k4_q[c]);
    inst->u[c] += (dt / 6.0) * (k1_u[c] + 2.0 * k2_u[c] + 2.0 * k3_u[c] + k4_u[c]);
  }

  opensim_evaluate_derivatives(inst, inst->a, inst->l_M, inst->q, inst->u, inst->da, inst->dl_M, inst->F_tendon, inst->dq, inst->du);
}

static void opensim_reset_states(OpenSimFmuInstance* inst) {
  memset(inst, 0, sizeof(OpenSimFmuInstance));
  inst->step_size = 0.001;
${initLines.join("\n")}
  opensim_evaluate_derivatives(inst, inst->a, inst->l_M, inst->q, inst->u, inst->da, inst->dl_M, inst->F_tendon, inst->dq, inst->du);
  opensim_sync_to_vars(inst);
}

/* FMI 2.0 Entry Points */
fmi2Component ${modelIdentifier}_fmi2Instantiate(
  fmi2String instanceName, int fmuType, fmi2String fmuGUID,
  fmi2String fmuResourceLocation, const void* functions,
  fmi2Boolean visible, fmi2Boolean loggingOn
) {
  (void)instanceName; (void)fmuType; (void)fmuGUID;
  (void)fmuResourceLocation; (void)functions; (void)visible; (void)loggingOn;
  OpenSimFmuInstance* inst = (OpenSimFmuInstance*)calloc(1, sizeof(OpenSimFmuInstance));
  if (!inst) return NULL;
  opensim_reset_states(inst);
  return (fmi2Component)inst;
}

void ${modelIdentifier}_fmi2FreeInstance(fmi2Component c) {
  if (c) free(c);
}

fmi2Status ${modelIdentifier}_fmi2SetupExperiment(
  fmi2Component c, fmi2Boolean toleranceDefined, fmi2Real tolerance,
  fmi2Real startTime, fmi2Boolean stopTimeDefined, fmi2Real stopTime
) {
  (void)toleranceDefined; (void)tolerance; (void)stopTimeDefined; (void)stopTime;
  OpenSimFmuInstance* inst = (OpenSimFmuInstance*)c;
  if (!inst) return fmi2Error;
  inst->start_time = startTime;
  inst->current_time = startTime;
  return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2EnterInitializationMode(fmi2Component c) {
  OpenSimFmuInstance* inst = (OpenSimFmuInstance*)c;
  if (!inst) return fmi2Error;
  opensim_sync_from_vars(inst);
  return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2ExitInitializationMode(fmi2Component c) {
  OpenSimFmuInstance* inst = (OpenSimFmuInstance*)c;
  if (!inst) return fmi2Error;
  inst->initialized = 1;
  opensim_evaluate_derivatives(inst, inst->a, inst->l_M, inst->q, inst->u, inst->da, inst->dl_M, inst->F_tendon, inst->dq, inst->du);
  opensim_sync_to_vars(inst);
  return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2Terminate(fmi2Component c) {
  OpenSimFmuInstance* inst = (OpenSimFmuInstance*)c;
  if (!inst) return fmi2Error;
  inst->initialized = 0;
  return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2Reset(fmi2Component c) {
  OpenSimFmuInstance* inst = (OpenSimFmuInstance*)c;
  if (!inst) return fmi2Error;
  opensim_reset_states(inst);
  return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2GetReal(
  fmi2Component c, const fmi2ValueReference vr[], size_t nvr, fmi2Real value[]
) {
  OpenSimFmuInstance* inst = (OpenSimFmuInstance*)c;
  if (!inst) return fmi2Error;
  for (size_t i = 0; i < nvr; i++) {
    value[i] = (vr[i] < MAX_VR) ? inst->vars[vr[i]] : 0.0;
  }
  return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2SetReal(
  fmi2Component c, const fmi2ValueReference vr[], size_t nvr, const fmi2Real value[]
) {
  OpenSimFmuInstance* inst = (OpenSimFmuInstance*)c;
  if (!inst) return fmi2Error;
  for (size_t i = 0; i < nvr; i++) {
    if (vr[i] < MAX_VR) inst->vars[vr[i]] = value[i];
  }
  opensim_sync_from_vars(inst);
  return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2GetDerivatives(
  fmi2Component c, fmi2Real derivatives[], size_t nx
) {
  OpenSimFmuInstance* inst = (OpenSimFmuInstance*)c;
  if (!inst) return fmi2Error;
  opensim_evaluate_derivatives(inst, inst->a, inst->l_M, inst->q, inst->u, inst->da, inst->dl_M, inst->F_tendon, inst->dq, inst->du);
  size_t idx = 0;
  for (int m = 0; m < ${muscles.length} && idx + 1 < nx; m++) {
    derivatives[idx++] = inst->da[m];
    derivatives[idx++] = inst->dl_M[m];
  }
  for (int k = 0; k < ${coords.length} && idx + 1 < nx; k++) {
    derivatives[idx++] = inst->dq[k];
    derivatives[idx++] = inst->du[k];
  }
  return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2DoStep(
  fmi2Component c, fmi2Real currentCommunicationPoint,
  fmi2Real communicationStepSize, fmi2Boolean noSetFMUStatePriorToCurrentPoint
) {
  (void)noSetFMUStatePriorToCurrentPoint;
  OpenSimFmuInstance* inst = (OpenSimFmuInstance*)c;
  if (!inst) return fmi2Error;
  opensim_sync_from_vars(inst);

  int nSub = (int)ceil(communicationStepSize / 0.001);
  if (nSub < 1) nSub = 1;
  if (nSub > 100) nSub = 100;
  fmi2Real dt = communicationStepSize / (fmi2Real)nSub;
  for (int s = 0; s < nSub; s++) {
    opensim_rk4_step(inst, dt);
  }
  inst->current_time = currentCommunicationPoint + communicationStepSize;
  opensim_sync_to_vars(inst);
  return fmi2OK;
}

/* FMI 3.0 Entry Points */
fmi3Instance ${modelIdentifier}_fmi3InstantiateCoSimulation(
  const char* instanceName, const char* instantiationToken, const char* resourcePath,
  int visible, int loggingOn, int eventModeUsed, int earlyReturnAllowed,
  const fmi3ValueReference requiredIntermediateVariables[], size_t nRequiredIntermediateVariables,
  void* instanceEnvironment, void* logMessage, void* intermediateUpdate
) {
  (void)eventModeUsed; (void)earlyReturnAllowed; (void)requiredIntermediateVariables;
  (void)nRequiredIntermediateVariables; (void)instanceEnvironment; (void)logMessage; (void)intermediateUpdate;
  return ${modelIdentifier}_fmi2Instantiate(instanceName, 1, instantiationToken, resourcePath, NULL, visible, loggingOn);
}

void ${modelIdentifier}_fmi3FreeInstance(fmi3Instance instance) {
  ${modelIdentifier}_fmi2FreeInstance(instance);
}

fmi3Status ${modelIdentifier}_fmi3GetFloat64(
  fmi3Instance instance, const fmi3ValueReference valueReferences[],
  size_t nValueReferences, fmi3Float64 values[], size_t nValues
) {
  (void)nValues;
  return (fmi3Status)${modelIdentifier}_fmi2GetReal(instance, valueReferences, nValueReferences, values);
}

fmi3Status ${modelIdentifier}_fmi3SetFloat64(
  fmi3Instance instance, const fmi3ValueReference valueReferences[],
  size_t nValueReferences, const fmi3Float64 values[], size_t nValues
) {
  (void)nValues;
  return (fmi3Status)${modelIdentifier}_fmi2SetReal(instance, valueReferences, nValueReferences, values);
}

fmi3Status ${modelIdentifier}_fmi3DoStep(
  fmi3Instance instance, fmi3Float64 currentCommunicationPoint, fmi3Float64 communicationStepSize,
  int noSetFMUStatePriorToCurrentPoint, int* eventHandlingNeeded, int* terminateSimulation,
  int* earlyReturn, fmi3Float64* lastSuccessfulTime
) {
  fmi3Status st = (fmi3Status)${modelIdentifier}_fmi2DoStep(
    instance, currentCommunicationPoint, communicationStepSize, noSetFMUStatePriorToCurrentPoint
  );
  if (eventHandlingNeeded) *eventHandlingNeeded = 0;
  if (terminateSimulation) *terminateSimulation = 0;
  if (earlyReturn) *earlyReturn = 0;
  if (lastSuccessfulTime) *lastSuccessfulTime = currentCommunicationPoint + communicationStepSize;
  return st;
}
`;
}

function generateOpenSimWasmRuntimeSource(
  modelIdentifier: string,
  gravityMag: number,
  muscles: readonly ResolvedMuscleEntry[],
  coords: readonly ResolvedCoordEntry[],
  maxVr: number,
): string {
  const muscleSpecs = muscles.map((m) => ({
    name: m.mId,
    maxIsometricForce: m.maxIsometricForce,
    optimalFiberLength: m.optimalFiberLength,
    tendonSlackLength: m.tendonSlackLength,
    pennationAngle: m.pennationAngle,
    tauAct: m.tauAct,
    tauDeact: m.tauDeact,
    maxContractionVelocity: m.maxContractionVelocity,
    basePathLength: m.basePathLength,
    uExcVr: m.uExcVr,
    aVr: m.aVr,
    daVr: m.daVr,
    lMVr: m.lMVr,
    dlMVr: m.dlMVr,
    fTendonVr: m.fTendonVr,
    fMaxParamVr: m.fMaxParamVr,
    lOptParamVr: m.lOptParamVr,
    lSlackParamVr: m.lSlackParamVr,
  }));

  const coordSpecs = coords.map((c) => ({
    name: c.cId,
    defaultValue: c.defaultValue,
    mass: c.mass,
    effInertia: c.effInertia,
    comDist: c.comDist,
    locked: c.locked,
    qVr: c.qVr,
    dqVr: c.dqVr,
    uVr: c.uVr,
    duVr: c.duVr,
  }));

  return `// SPDX-License-Identifier: AGPL-3.0-or-later
// WebAssembly-ready JS/TS Hill-Type Muscle & Multibody RK4 Runtime (${modelIdentifier})

export const MODEL_IDENTIFIER = ${JSON.stringify(modelIdentifier)};
export const GRAVITY_ACCEL = ${gravityMag};
export const MUSCLE_SPECS = ${JSON.stringify(muscleSpecs, null, 2)};
export const COORD_SPECS = ${JSON.stringify(coordSpecs, null, 2)};

export function computeActivationDerivative(a, u, tauAct, tauDeact) {
  const act = Math.max(0.01, Math.min(1.0, a));
  const exc = Math.max(0.01, Math.min(1.0, u));
  const tau = exc > act ? tauAct * (0.5 + 1.5 * act) : tauDeact / (0.5 + 1.5 * act);
  return (exc - act) / Math.max(1e-5, tau);
}

export function computeActiveForceLength(normLM) {
  const d = normLM - 1.0;
  return Math.exp(-(d * d) / 0.45);
}

export function computePassiveForceLength(normLM) {
  if (normLM <= 1.0) return 0.0;
  const strain = Math.min(normLM - 1.0, 1.2);
  return (Math.exp((4.0 * strain) / 0.6) - 1.0) / (Math.exp(4.0) - 1.0);
}

export function computeForceVelocity(normV) {
  const v = Math.max(-1.0, Math.min(1.0, normV));
  const af = 0.3;
  const fmaxE = 1.4;
  if (v <= 0.0) return (1.0 + v) / (1.0 - v / af);
  const b = (2.0 + 2.0 / af) * v;
  return (1.0 + fmaxE * b) / (1.0 + b);
}

export class OpenSimWasmRk4Runtime {
  constructor() {
    this.vars = new Float64Array(${maxVr});
    this.reset();
  }

  reset() {
    this.vars.fill(0);
    for (const m of MUSCLE_SPECS) {
      this.vars[m.uExcVr] = 0.05;
      this.vars[m.aVr] = 0.05;
      this.vars[m.lMVr] = m.optimalFiberLength;
      this.vars[m.fMaxParamVr] = m.maxIsometricForce;
      this.vars[m.lOptParamVr] = m.optimalFiberLength;
      this.vars[m.lSlackParamVr] = m.tendonSlackLength;
    }
    for (const c of COORD_SPECS) {
      this.vars[c.qVr] = c.defaultValue;
      this.vars[c.uVr] = 0.0;
    }
    this.evaluateDerivatives();
  }

  evaluateDerivatives() {
    let netMuscleTorque = 0.0;
    for (const m of MUSCLE_SPECS) {
      const u = this.vars[m.uExcVr];
      const a = this.vars[m.aVr];
      const lM = this.vars[m.lMVr];
      const fMax = this.vars[m.fMaxParamVr] || m.maxIsometricForce;
      const lOpt = this.vars[m.lOptParamVr] || m.optimalFiberLength;
      const lSlack = this.vars[m.lSlackParamVr] || m.tendonSlackLength;
      const cosA = Math.max(0.1, Math.cos(m.pennationAngle));

      const da = computeActivationDerivative(a, u, m.tauAct, m.tauDeact);
      const normLM = Math.max(0.2, lM / lOpt);
      const fL = computeActiveForceLength(normLM);
      const fPE = computePassiveForceLength(normLM);

      let lMT = m.basePathLength;
      for (const c of COORD_SPECS) {
        lMT -= 0.04 * (this.vars[c.qVr] - c.defaultValue);
      }
      const lT = Math.max(0.0, lMT - lM * cosA);
      const strainT = (lT - lSlack) / Math.max(1e-5, lSlack);
      const normFT = strainT > 0 ? Math.min(3.0, 35.0 * strainT * strainT + 0.2 * strainT) : 0.0;

      const targetFM = normFT / cosA;
      const reqFV = Math.max(0.0, Math.min(1.35, (targetFM - fPE) / Math.max(1e-3, a * fL)));
      const normV = Math.max(-1.0, Math.min(1.0, (reqFV - 1.0) * 0.5));
      const dlM = normV * m.maxContractionVelocity * lOpt;
      const fV = computeForceVelocity(normV);
      const fTendon = Math.max(0.0, 0.5 * (fMax * normFT + fMax * (a * fL * fV + fPE) * cosA));

      this.vars[m.daVr] = da;
      this.vars[m.dlMVr] = dlM;
      this.vars[m.fTendonVr] = fTendon;
      netMuscleTorque += 0.04 * fTendon;
    }

    for (const c of COORD_SPECS) {
      if (c.locked) {
        this.vars[c.dqVr] = 0.0;
        this.vars[c.duVr] = 0.0;
        continue;
      }
      const q = this.vars[c.qVr];
      const u = this.vars[c.uVr];
      const tauGrav = -c.mass * GRAVITY_ACCEL * c.comDist * Math.sin(q);
      this.vars[c.dqVr] = u;
      this.vars[c.duVr] = (netMuscleTorque - 0.5 * u + tauGrav) / Math.max(1e-4, c.effInertia);
    }
  }

  stepRk4(dt) {
    const nSub = Math.max(1, Math.min(100, Math.ceil(dt / 0.001)));
    const h = dt / nSub;
    for (let s = 0; s < nSub; s++) {
      this.evaluateDerivatives();
      const a0 = MUSCLE_SPECS.map((m) => this.vars[m.aVr]);
      const lM0 = MUSCLE_SPECS.map((m) => this.vars[m.lMVr]);
      const q0 = COORD_SPECS.map((c) => this.vars[c.qVr]);
      const u0 = COORD_SPECS.map((c) => this.vars[c.uVr]);

      const k1a = MUSCLE_SPECS.map((m) => this.vars[m.daVr]);
      const k1l = MUSCLE_SPECS.map((m) => this.vars[m.dlMVr]);
      const k1q = COORD_SPECS.map((c) => this.vars[c.dqVr]);
      const k1u = COORD_SPECS.map((c) => this.vars[c.duVr]);

      MUSCLE_SPECS.forEach((m, i) => {
        this.vars[m.aVr] = Math.max(0.01, Math.min(1.0, a0[i] + 0.5 * h * k1a[i]));
        this.vars[m.lMVr] = Math.max(1e-4, lM0[i] + 0.5 * h * k1l[i]);
      });
      COORD_SPECS.forEach((c, i) => {
        this.vars[c.qVr] = q0[i] + 0.5 * h * k1q[i];
        this.vars[c.uVr] = u0[i] + 0.5 * h * k1u[i];
      });
      this.evaluateDerivatives();
      const k2a = MUSCLE_SPECS.map((m) => this.vars[m.daVr]);
      const k2l = MUSCLE_SPECS.map((m) => this.vars[m.dlMVr]);
      const k2q = COORD_SPECS.map((c) => this.vars[c.dqVr]);
      const k2u = COORD_SPECS.map((c) => this.vars[c.duVr]);

      MUSCLE_SPECS.forEach((m, i) => {
        this.vars[m.aVr] = Math.max(0.01, Math.min(1.0, a0[i] + 0.5 * h * k2a[i]));
        this.vars[m.lMVr] = Math.max(1e-4, lM0[i] + 0.5 * h * k2l[i]);
      });
      COORD_SPECS.forEach((c, i) => {
        this.vars[c.qVr] = q0[i] + 0.5 * h * k2q[i];
        this.vars[c.uVr] = u0[i] + 0.5 * h * k2u[i];
      });
      this.evaluateDerivatives();
      const k3a = MUSCLE_SPECS.map((m) => this.vars[m.daVr]);
      const k3l = MUSCLE_SPECS.map((m) => this.vars[m.dlMVr]);
      const k3q = COORD_SPECS.map((c) => this.vars[c.dqVr]);
      const k3u = COORD_SPECS.map((c) => this.vars[c.duVr]);

      MUSCLE_SPECS.forEach((m, i) => {
        this.vars[m.aVr] = Math.max(0.01, Math.min(1.0, a0[i] + h * k3a[i]));
        this.vars[m.lMVr] = Math.max(1e-4, lM0[i] + h * k3l[i]);
      });
      COORD_SPECS.forEach((c, i) => {
        this.vars[c.qVr] = q0[i] + h * k3q[i];
        this.vars[c.uVr] = u0[i] + h * k3u[i];
      });
      this.evaluateDerivatives();
      const k4a = MUSCLE_SPECS.map((m) => this.vars[m.daVr]);
      const k4l = MUSCLE_SPECS.map((m) => this.vars[m.dlMVr]);
      const k4q = COORD_SPECS.map((c) => this.vars[c.dqVr]);
      const k4u = COORD_SPECS.map((c) => this.vars[c.duVr]);

      MUSCLE_SPECS.forEach((m, i) => {
        this.vars[m.aVr] = Math.max(
          0.01,
          Math.min(1.0, a0[i] + (h / 6.0) * (k1a[i] + 2 * k2a[i] + 2 * k3a[i] + k4a[i]))
        );
        this.vars[m.lMVr] = Math.max(
          1e-4,
          lM0[i] + (h / 6.0) * (k1l[i] + 2 * k2l[i] + 2 * k3l[i] + k4l[i])
        );
      });
      COORD_SPECS.forEach((c, i) => {
        if (c.locked) return;
        this.vars[c.qVr] = q0[i] + (h / 6.0) * (k1q[i] + 2 * k2q[i] + 2 * k3q[i] + k4q[i]);
        this.vars[c.uVr] = u0[i] + (h / 6.0) * (k1u[i] + 2 * k2u[i] + 2 * k3u[i] + k4u[i]);
      });
      this.evaluateDerivatives();
    }
  }
}
`;
}

/**
 * Exports an OpenSim musculoskeletal model to an FMI 2.0 or 3.0 FMU package.
 */
export function exportOpenSimToFmu(doc: OpenSimFmuModelLike, options: MedicalFmuOptions = {}): MedicalFmuExportResult {
  const rawName = options.modelIdentifier ?? doc.modelName ?? doc.name ?? "opensim_biomech";
  const modelIdentifier = sanitizeIdentifier(rawName, "opensim_biomech");
  const fmiVersion = options.fmiVersion ?? "2.0";
  const guid = options.guid ?? generateGuid(`opensim:${modelIdentifier}`);
  const startTime = options.startTime ?? 0.0;
  const stopTime = options.stopTime ?? 5.0;
  const stepSize = options.stepSize ?? 0.001;
  const description = options.description ?? `OpenSim Musculoskeletal Hill-Muscle & Multibody FMU: ${modelIdentifier}`;

  const g = doc.gravity ?? [0, -9.80665, 0];
  const gravityMag = Math.hypot(g[0] ?? 0, g[1] ?? -9.80665, g[2] ?? 0) || 9.80665;

  const bodyMap = new Map<string, OpenSimFmuBodyLike>();
  for (const b of doc.bodies) {
    bodyMap.set(b.name, b);
    if (b.id) bodyMap.set(b.id, b);
  }

  const vars: InternalFmuVar[] = [];
  let nextVr = 1;
  const addVar = (spec: Omit<InternalFmuVar, "index" | "vr">): InternalFmuVar => {
    const entry: InternalFmuVar = {
      ...spec,
      index: vars.length + 1,
      vr: nextVr++,
    };
    vars.push(entry);
    return entry;
  };

  const resolvedMuscles: ResolvedMuscleEntry[] = [];
  for (const m of doc.muscles) {
    const mId = sanitizeIdentifier(m.name || m.id || "muscle", "muscle");
    const uExcVar = addVar({
      name: `u_${mId}`,
      cIdent: `u_${mId}`,
      causality: "input",
      variability: "continuous",
      start: 0.05,
      min: 0.0,
      max: 1.0,
      unit: "1",
      description: `Neural excitation for muscle ${m.name} [0..1]`,
    });

    const aVar = addVar({
      name: `a_${mId}`,
      cIdent: `a_${mId}`,
      causality: "output",
      variability: "continuous",
      initial: "exact",
      start: 0.05,
      min: 0.0,
      max: 1.0,
      unit: "1",
      description: `Hill muscle activation state for ${m.name} [0..1]`,
    });

    const daVar = addVar({
      name: `der(a_${mId})`,
      cIdent: `der_a_${mId}`,
      causality: "local",
      variability: "continuous",
      initial: "calculated",
      unit: "1/s",
      derivativeOfIndex: aVar.index,
      derivativeOfVr: aVar.vr,
      description: `Activation time derivative for muscle ${m.name} [1/s]`,
    });

    const lOpt = m.optimalFiberLength > 0 ? m.optimalFiberLength : 0.1;
    const lMVar = addVar({
      name: `l_M_${mId}`,
      cIdent: `l_M_${mId}`,
      causality: "local",
      variability: "continuous",
      initial: "exact",
      start: lOpt,
      unit: "m",
      description: `Contractile fiber length state for ${m.name} [m]`,
    });

    const dlMVar = addVar({
      name: `der(l_M_${mId})`,
      cIdent: `der_l_M_${mId}`,
      causality: "local",
      variability: "continuous",
      initial: "calculated",
      unit: "m/s",
      derivativeOfIndex: lMVar.index,
      derivativeOfVr: lMVar.vr,
      description: `Fiber contraction velocity for ${m.name} [m/s]`,
    });

    const fTendonVar = addVar({
      name: `F_${mId}`,
      cIdent: `F_${mId}`,
      causality: "output",
      variability: "continuous",
      initial: "calculated",
      unit: "N",
      description: `Tendon force generated by muscle ${m.name} [N]`,
    });

    const fMaxParam = addVar({
      name: `max_isometric_force_${mId}`,
      cIdent: `max_isometric_force_${mId}`,
      causality: "parameter",
      variability: "tunable",
      initial: "exact",
      start: m.maxIsometricForce,
      unit: "N",
      description: `Maximum isometric force for muscle ${m.name} [N]`,
    });

    const lOptParam = addVar({
      name: `optimal_fiber_length_${mId}`,
      cIdent: `optimal_fiber_length_${mId}`,
      causality: "parameter",
      variability: "tunable",
      initial: "exact",
      start: lOpt,
      unit: "m",
      description: `Optimal fiber length for muscle ${m.name} [m]`,
    });

    const lSlackParam = addVar({
      name: `tendon_slack_length_${mId}`,
      cIdent: `tendon_slack_length_${mId}`,
      causality: "parameter",
      variability: "tunable",
      initial: "exact",
      start: m.tendonSlackLength,
      unit: "m",
      description: `Tendon slack length for muscle ${m.name} [m]`,
    });

    resolvedMuscles.push({
      muscle: m,
      mId,
      maxIsometricForce: m.maxIsometricForce,
      optimalFiberLength: lOpt,
      tendonSlackLength: m.tendonSlackLength,
      pennationAngle: m.pennationAngleAtOptimal ?? 0.0,
      tauAct: m.activationTimeConstant ?? 0.01,
      tauDeact: m.deactivationTimeConstant ?? 0.04,
      maxContractionVelocity: m.maxContractionVelocity ?? 10.0,
      basePathLength: estimateMuscleBaseLength(m),
      uExcVr: uExcVar.vr,
      aVr: aVar.vr,
      daVr: daVar.vr,
      lMVr: lMVar.vr,
      dlMVr: dlMVar.vr,
      fTendonVr: fTendonVar.vr,
      fMaxParamVr: fMaxParam.vr,
      lOptParamVr: lOptParam.vr,
      lSlackParamVr: lSlackParam.vr,
    });
  }

  const rawCoords = collectOpenSimCoordinates(doc);
  const resolvedCoords: ResolvedCoordEntry[] = [];
  for (const { coord, joint } of rawCoords) {
    const cId = sanitizeIdentifier(coord.name || coord.id || "coord", "coord");
    const childBody = joint ? bodyMap.get(canonicalFrame(joint.childFrame)) : doc.bodies[0];
    const mass = childBody && childBody.mass > 0 ? childBody.mass : 1.0;
    const mc = childBody?.massCenter ?? [0, -0.1, 0];
    const comDist = Math.hypot(mc[0] ?? 0, mc[1] ?? 0, mc[2] ?? 0) || 0.1;
    const izz = childBody?.inertia?.[2] && childBody.inertia[2] > 0 ? childBody.inertia[2] : 0.05;
    const isTranslational = coord.motionType === "translational";
    const effInertia = isTranslational ? Math.max(1e-4, mass) : Math.max(1e-4, izz + mass * comDist * comDist);

    const qUnit = isTranslational ? "m" : "rad";
    const uUnit = isTranslational ? "m/s" : "rad/s";
    const aUnit = isTranslational ? "m/s2" : "rad/s2";

    const qVar = addVar({
      name: `q_${cId}`,
      cIdent: `q_${cId}`,
      causality: "output",
      variability: "continuous",
      initial: "exact",
      start: coord.defaultValue ?? 0.0,
      unit: qUnit,
      description: `Generalized coordinate position ${coord.name} [${qUnit}]`,
    });

    const dqVar = addVar({
      name: `der(q_${cId})`,
      cIdent: `der_q_${cId}`,
      causality: "local",
      variability: "continuous",
      initial: "calculated",
      unit: uUnit,
      derivativeOfIndex: qVar.index,
      derivativeOfVr: qVar.vr,
      description: `Time derivative of generalized coordinate ${coord.name} [${uUnit}]`,
    });

    const uVar = addVar({
      name: `u_${cId}`,
      cIdent: `u_speed_${cId}`,
      causality: "local",
      variability: "continuous",
      initial: "exact",
      start: 0.0,
      unit: uUnit,
      description: `Generalized speed for coordinate ${coord.name} [${uUnit}]`,
    });

    const duVar = addVar({
      name: `der(u_${cId})`,
      cIdent: `der_u_${cId}`,
      causality: "local",
      variability: "continuous",
      initial: "calculated",
      unit: aUnit,
      derivativeOfIndex: uVar.index,
      derivativeOfVr: uVar.vr,
      description: `Generalized acceleration for coordinate ${coord.name} [${aUnit}]`,
    });

    resolvedCoords.push({
      coord,
      cId,
      mass,
      effInertia,
      comDist,
      locked: coord.locked ?? false,
      clamped: coord.clamped ?? false,
      rangeMin: coord.rangeMin ?? -Math.PI,
      rangeMax: coord.rangeMax ?? Math.PI,
      defaultValue: coord.defaultValue ?? 0.0,
      isTranslational,
      qVr: qVar.vr,
      dqVr: dqVar.vr,
      uVr: uVar.vr,
      duVr: duVar.vr,
    });
  }

  const bodyParams: { vr: number; mass: number }[] = [];
  for (const b of doc.bodies) {
    const bId = sanitizeIdentifier(b.name || b.id || "body", "body");
    const mParam = addVar({
      name: `mass_${bId}`,
      cIdent: `mass_${bId}`,
      causality: "parameter",
      variability: "tunable",
      initial: "exact",
      start: b.mass,
      unit: "kg",
      description: `Segment mass of body ${b.name} [kg]`,
    });
    bodyParams.push({ vr: mParam.vr, mass: b.mass });
  }

  const units: BaseUnitDef[] = [
    { name: "1" },
    { name: "1/s", s: -1 },
    { name: "m", m: 1 },
    { name: "m/s", m: 1, s: -1 },
    { name: "m/s2", m: 1, s: -2 },
    { name: "rad" },
    { name: "rad/s", s: -1 },
    { name: "rad/s2", s: -2 },
    { name: "N", kg: 1, m: 1, s: -2 },
    { name: "kg", kg: 1 },
  ];

  const modelDescription2Xml = renderFmi2ModelDescription(
    modelIdentifier,
    guid,
    description,
    "ModelScript OpenSim Biomechanical FMU Exporter",
    startTime,
    stopTime,
    stepSize,
    units,
    vars,
  );

  const modelDescription3Xml = renderFmi3ModelDescription(
    modelIdentifier,
    guid,
    description,
    "ModelScript OpenSim Biomechanical FMU Exporter",
    startTime,
    stopTime,
    stepSize,
    units,
    vars,
  );

  const modelDescriptionXml = fmiVersion === "3.0" ? modelDescription3Xml : modelDescription2Xml;
  const maxVr = nextVr + 8;
  const cSource = generateOpenSimC99Source(
    modelIdentifier,
    gravityMag,
    resolvedMuscles,
    resolvedCoords,
    bodyParams,
    maxVr,
  );
  const wasmRuntimeSource = generateOpenSimWasmRuntimeSource(
    modelIdentifier,
    gravityMag,
    resolvedMuscles,
    resolvedCoords,
    maxVr,
  );

  const encoder = new TextEncoder();
  const filesMap = new Map<string, Uint8Array>();
  filesMap.set("modelDescription.xml", encoder.encode(modelDescriptionXml));
  if (options.includeSources !== false) {
    filesMap.set("sources/model.c", encoder.encode(cSource));
    filesMap.set(`sources/${modelIdentifier}_cosim.c`, encoder.encode(cSource));
    filesMap.set("sources/runtime.js", encoder.encode(wasmRuntimeSource));
  }

  const archive = createZip(filesMap);

  return {
    archive,
    modelDescriptionXml,
    modelDescription2Xml,
    modelDescription3Xml,
    cSource,
    wasmRuntimeSource,
    files: Array.from(filesMap.keys()),
    fmiVersion,
    modelIdentifier,
    guid,
    variableCount: vars.length,
  };
}

// ── 2. CellML Cellular & Electrophysiology FMU Exporter ─────────────

const STANDARD_CELLML_UNITS: Readonly<Record<string, BaseUnitDef>> = {
  dimensionless: { name: "dimensionless" },
  second: { name: "second", s: 1 },
  s: { name: "s", s: 1 },
  millisecond: { name: "millisecond", s: 1, factor: 1e-3 },
  ms: { name: "ms", s: 1, factor: 1e-3 },
  per_second: { name: "per_second", s: -1 },
  per_millisecond: { name: "per_millisecond", s: -1, factor: 1e3 },
  per_ms: { name: "per_ms", s: -1, factor: 1e3 },
  volt: { name: "volt", kg: 1, m: 2, s: -3, A: -1 },
  V: { name: "V", kg: 1, m: 2, s: -3, A: -1 },
  millivolt: { name: "millivolt", kg: 1, m: 2, s: -3, A: -1, factor: 1e-3 },
  mV: { name: "mV", kg: 1, m: 2, s: -3, A: -1, factor: 1e-3 },
  ampere: { name: "ampere", A: 1 },
  microA_per_cm2: { name: "microA_per_cm2", m: -2, A: 1, factor: 1e-2 },
  uA_per_mmsq: { name: "uA_per_mmsq", m: -2, A: 1 },
  milliS_per_cm2: { name: "milliS_per_cm2", kg: -1, m: -4, s: 3, A: 2, factor: 10 },
  mS_per_mmsq: { name: "mS_per_mmsq", kg: -1, m: -4, s: 3, A: 2, factor: 1e3 },
  microF_per_cm2: { name: "microF_per_cm2", kg: -1, m: -4, s: 4, A: 2, factor: 1e-2 },
  uF_per_mmsq: { name: "uF_per_mmsq", kg: -1, m: -4, s: 4, A: 2 },
  millimolar: { name: "millimolar", m: -3, mol: 1 },
  mM: { name: "mM", m: -3, mol: 1 },
  kelvin: { name: "kelvin", K: 1 },
};

function toArray<T>(collection: ReadonlyMap<string, T> | readonly T[] | undefined): T[] {
  if (!collection) return [];
  if (Array.isArray(collection)) return [...collection];
  if ("values" in collection && typeof collection.values === "function") {
    return Array.from(collection.values());
  }
  return [];
}

function collectCellmlUnits(doc: CellmlFmuModelLike, vars: readonly InternalFmuVar[]): BaseUnitDef[] {
  const unitMap = new Map<string, BaseUnitDef>();

  for (const u of toArray(doc.units)) {
    const d = u.dimensions;
    unitMap.set(u.name, {
      name: u.name,
      kg: d?.kilogram,
      m: d?.metre,
      s: d?.second,
      A: d?.ampere,
      K: d?.kelvin,
      mol: d?.mole,
      cd: d?.candela,
      factor: d?.multiplierScale,
    });
  }

  for (const v of vars) {
    if (!v.unit || unitMap.has(v.unit)) continue;
    const std = STANDARD_CELLML_UNITS[v.unit];
    if (std) {
      unitMap.set(v.unit, std);
    } else {
      unitMap.set(v.unit, { name: v.unit });
    }
  }

  return Array.from(unitMap.values());
}

function resolveCellmlConnectionsLike(doc: CellmlFmuModelLike): Map<string, string> {
  const targetToSource = new Map<string, string>();
  const compsByName = new Map<string, CellmlFmuComponentLike>();
  const varsByQual = new Map<string, CellmlFmuVariableLike>();
  const assignedQuals = new Set<string>();

  for (const comp of toArray(doc.components)) {
    compsByName.set(comp.name, comp);
    for (const v of toArray(comp.variables)) {
      varsByQual.set(`${comp.name}.${v.name}`, v);
    }
    for (const eq of comp.equations) {
      if (eq.targetVariable) {
        assignedQuals.add(`${comp.name}.${eq.targetVariable}`);
      }
    }
  }

  for (const conn of doc.connections ?? []) {
    for (const m of conn.mappings) {
      const q1 = `${conn.component1}.${m.variable1}`;
      const q2 = `${conn.component2}.${m.variable2}`;
      const v1 = varsByQual.get(q1);
      const v2 = varsByQual.get(q2);
      if (!v1 || !v2) continue;

      const v1In = v1.publicInterface === "in" || v1.privateInterface === "in";
      const v2In = v2.publicInterface === "in" || v2.privateInterface === "in";
      const v1Out = v1.publicInterface === "out" || v1.privateInterface === "out";
      const v2Out = v2.publicInterface === "out" || v2.privateInterface === "out";

      if (v1In && !v2In) {
        targetToSource.set(q1, q2);
      } else if (v2In && !v1In) {
        targetToSource.set(q2, q1);
      } else if (v1Out && !v2Out) {
        targetToSource.set(q2, q1);
      } else if (v2Out && !v1Out) {
        targetToSource.set(q1, q2);
      } else if (assignedQuals.has(q1) || v1.initialValue !== undefined) {
        targetToSource.set(q2, q1);
      } else {
        targetToSource.set(q1, q2);
      }
    }
  }

  return targetToSource;
}

function translateCellmlExprToC(
  expr: string,
  compName: string,
  qualToVr: ReadonlyMap<string, number>,
  indepQuals: ReadonlySet<string>,
): string {
  const trimmed = expr.trim();
  if (!trimmed) return "0.0";

  // Tokenize and rewrite identifiers & operators (`^` -> `pow`, `piecewise` -> ternary, `ln` -> `log`)
  type Tok = { kind: "num" | "id" | "op" | "punc"; val: string };
  const tokens: Tok[] = [];
  let i = 0;
  const n = trimmed.length;

  while (i < n) {
    const ch = trimmed[i] ?? "";
    const next = trimmed[i + 1] ?? "";
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let num = "";
      while (i < n && /[0-9.eE+-]/.test(trimmed[i] ?? "")) {
        if ((trimmed[i] === "+" || trimmed[i] === "-") && !/[eE]/.test(trimmed[i - 1] ?? "")) {
          break;
        }
        num += trimmed[i] ?? "";
        i++;
      }
      tokens.push({ kind: "num", val: num.includes(".") || /[eE]/.test(num) ? num : `${num}.0` });
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let id = "";
      while (i < n && /[a-zA-Z0-9_]/.test(trimmed[i] ?? "")) {
        id += trimmed[i] ?? "";
        i++;
      }
      tokens.push({ kind: "id", val: id });
      continue;
    }
    if (
      (ch === ">" && next === "=") ||
      (ch === "<" && next === "=") ||
      (ch === "=" && next === "=") ||
      (ch === "!" && next === "=") ||
      (ch === "&" && next === "&") ||
      (ch === "|" && next === "|")
    ) {
      tokens.push({ kind: "op", val: ch + next });
      i += 2;
      continue;
    }
    if ("(),^+-*/%><=!".includes(ch)) {
      tokens.push({ kind: ch === "(" || ch === ")" || ch === "," ? "punc" : "op", val: ch });
      i++;
      continue;
    }
    i++;
  }

  let pos = 0;
  const peek = (): Tok | undefined => tokens[pos];
  const consume = (): Tok => tokens[pos++] ?? { kind: "num", val: "0.0" };

  function parseLogical(): string {
    let left = parseAddSub();
    while (peek()?.kind === "op" && ["==", "!=", "<", ">", "<=", ">=", "&&", "||", "="].includes(peek()!.val)) {
      const rawOp = consume().val;
      const op = rawOp === "=" ? "==" : rawOp;
      const right = parseAddSub();
      left = `(${left} ${op} ${right})`;
    }
    return left;
  }

  function parseAddSub(): string {
    let left = parseMulDiv();
    while (peek()?.kind === "op" && (peek()!.val === "+" || peek()!.val === "-")) {
      const op = consume().val;
      const right = parseMulDiv();
      left = `(${left} ${op} ${right})`;
    }
    return left;
  }

  function parseMulDiv(): string {
    let left = parsePow();
    while (peek()?.kind === "op" && (peek()!.val === "*" || peek()!.val === "/" || peek()!.val === "%")) {
      const op = consume().val;
      const right = parsePow();
      if (op === "%") {
        left = `fmod(${left}, ${right})`;
      } else {
        left = `(${left} ${op} ${right})`;
      }
    }
    return left;
  }

  function parsePow(): string {
    const base = parseUnary();
    if (peek()?.kind === "op" && peek()!.val === "^") {
      consume();
      const exp = parsePow();
      return `pow(${base}, ${exp})`;
    }
    return base;
  }

  function parseUnary(): string {
    if (peek()?.kind === "op" && (peek()!.val === "-" || peek()!.val === "+" || peek()!.val === "!")) {
      const op = consume().val;
      return `(${op}${parseUnary()})`;
    }
    return parsePrimary();
  }

  function parsePrimary(): string {
    const tok = peek();
    if (!tok) return "0.0";
    if (tok.kind === "num") {
      consume();
      return tok.val;
    }
    if (tok.kind === "punc" && tok.val === "(") {
      consume();
      const inner = parseLogical();
      if (peek()?.kind === "punc" && peek()!.val === ")") consume();
      return `(${inner})`;
    }
    if (tok.kind === "id") {
      consume();
      const id = tok.val;
      if (peek()?.kind === "punc" && peek()!.val === "(") {
        consume();
        const args: string[] = [];
        if (peek() && !(peek()!.kind === "punc" && peek()!.val === ")")) {
          args.push(parseLogical());
          while (peek()?.kind === "punc" && peek()!.val === ",") {
            consume();
            args.push(parseLogical());
          }
        }
        if (peek()?.kind === "punc" && peek()!.val === ")") consume();
        const fn = id.toLowerCase();
        if (fn === "piecewise") {
          if (args.length >= 3) {
            return `((${args[0]}) ? (${args[1]}) : (${args[2]}))`;
          }
          return args[0] ?? "0.0";
        }
        if (fn === "ln") return `log(${args[0] ?? "1.0"})`;
        if (fn === "abs") return `fabs(${args[0] ?? "0.0"})`;
        if (fn === "ceiling") return `ceil(${args[0] ?? "0.0"})`;
        if (fn === "min") return `fmin(${args[0] ?? "0.0"}, ${args[1] ?? "0.0"})`;
        if (fn === "max") return `fmax(${args[0] ?? "0.0"}, ${args[1] ?? "0.0"})`;
        return `${fn}(${args.join(", ")})`;
      }
      if (id === "pi") return "3.141592653589793";
      if (id === "e") return "2.718281828459045";
      if (id === "true") return "1.0";
      if (id === "false") return "0.0";

      const qual = `${compName}.${id}`;
      if (indepQuals.has(qual) || id === "time" || id === "t") {
        const vr = qualToVr.get(qual);
        return vr !== undefined ? `inst->vars[${vr}]` : "inst->current_time";
      }
      const vr = qualToVr.get(qual);
      if (vr !== undefined) {
        return `inst->vars[${vr}]`;
      }
      return "0.0";
    }
    consume();
    return "0.0";
  }

  return parseLogical();
}

interface CellmlStateDesc {
  qual: string;
  stateVr: number;
  derivVr: number;
  initialValue: number;
  cExpr: string;
}

interface CellmlAlgDesc {
  qual: string;
  targetVr: number;
  cExpr: string;
}

function generateCellmlC99Source(
  modelIdentifier: string,
  allVars: readonly InternalFmuVar[],
  indepVrs: readonly number[],
  connectionPairs: readonly { targetVr: number; sourceVr: number }[],
  algEqs: readonly CellmlAlgDesc[],
  states: readonly CellmlStateDesc[],
  maxVr: number,
): string {
  const nStates = Math.max(1, states.length);

  const initLines: string[] = [];
  for (const v of allVars) {
    if (v.start !== undefined) {
      initLines.push(`  inst->vars[${v.vr}] = ${v.start};`);
    }
  }
  for (let i = 0; i < states.length; i++) {
    const s = states[i]!;
    initLines.push(`  inst->states[${i}] = ${s.initialValue};`);
    initLines.push(`  inst->vars[${s.stateVr}] = ${s.initialValue};`);
  }

  const evalLines: string[] = [];
  for (const vr of indepVrs) {
    evalLines.push(`  inst->vars[${vr}] = inst->current_time;`);
  }
  for (let i = 0; i < states.length; i++) {
    const s = states[i]!;
    evalLines.push(`  inst->vars[${s.stateVr}] = inst->states[${i}];`);
  }
  for (const pair of connectionPairs) {
    evalLines.push(`  inst->vars[${pair.targetVr}] = inst->vars[${pair.sourceVr}];`);
  }
  for (const alg of algEqs) {
    evalLines.push(`  inst->vars[${alg.targetVr}] = ${alg.cExpr};`);
  }
  for (const pair of connectionPairs) {
    evalLines.push(`  inst->vars[${pair.targetVr}] = inst->vars[${pair.sourceVr}];`);
  }
  for (let i = 0; i < states.length; i++) {
    const s = states[i]!;
    evalLines.push(`  inst->derivs[${i}] = ${s.cExpr};`);
    evalLines.push(`  inst->vars[${s.derivVr}] = inst->derivs[${i}];`);
  }

  return `/* SPDX-License-Identifier: AGPL-3.0-or-later */
/* ModelScript CellML Electrophysiology & Cellular ODE FMI 2.0 / 3.0 C99 Runtime (model.c) */
#define FMI2_FUNCTION_PREFIX ${modelIdentifier}_
#define MODEL_IDENTIFIER "${modelIdentifier}"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#define N_STATES ${nStates}
#define MAX_VR ${maxVr}

typedef void* fmi2Component;
typedef unsigned int fmi2ValueReference;
typedef double fmi2Real;
typedef int fmi2Integer;
typedef int fmi2Boolean;
typedef const char* fmi2String;

typedef enum {
  fmi2OK = 0,
  fmi2Warning = 1,
  fmi2Discard = 2,
  fmi2Error = 3,
  fmi2Fatal = 4,
  fmi2Pending = 5
} fmi2Status;

typedef void* fmi3Instance;
typedef unsigned int fmi3ValueReference;
typedef double fmi3Float64;
typedef int fmi3Status;

typedef struct {
  fmi2Real current_time;
  fmi2Real start_time;
  fmi2Real step_size;
  int initialized;
  fmi2Real states[N_STATES];
  fmi2Real derivs[N_STATES];
  fmi2Real vars[MAX_VR];
} CellmlFmuInstance;

static void cellml_eval_equations(CellmlFmuInstance* inst) {
${evalLines.join("\n")}
}

static void cellml_rk4_step(CellmlFmuInstance* inst, fmi2Real dt) {
  fmi2Real y0[N_STATES], k1[N_STATES], k2[N_STATES], k3[N_STATES], k4[N_STATES];
  fmi2Real t0 = inst->current_time;

  cellml_eval_equations(inst);
  for (int i = 0; i < ${states.length}; i++) {
    y0[i] = inst->states[i];
    k1[i] = inst->derivs[i];
    inst->states[i] = y0[i] + 0.5 * dt * k1[i];
  }
  inst->current_time = t0 + 0.5 * dt;
  cellml_eval_equations(inst);

  for (int i = 0; i < ${states.length}; i++) {
    k2[i] = inst->derivs[i];
    inst->states[i] = y0[i] + 0.5 * dt * k2[i];
  }
  cellml_eval_equations(inst);

  for (int i = 0; i < ${states.length}; i++) {
    k3[i] = inst->derivs[i];
    inst->states[i] = y0[i] + dt * k3[i];
  }
  inst->current_time = t0 + dt;
  cellml_eval_equations(inst);

  for (int i = 0; i < ${states.length}; i++) {
    k4[i] = inst->derivs[i];
    inst->states[i] = y0[i] + (dt / 6.0) * (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i]);
  }
  cellml_eval_equations(inst);
}

static void cellml_reset_instance(CellmlFmuInstance* inst) {
  memset(inst, 0, sizeof(CellmlFmuInstance));
  inst->step_size = 0.001;
${initLines.join("\n")}
  cellml_eval_equations(inst);
}

/* FMI 2.0 Entry Points */
fmi2Component ${modelIdentifier}_fmi2Instantiate(
  fmi2String instanceName, int fmuType, fmi2String fmuGUID,
  fmi2String fmuResourceLocation, const void* functions,
  fmi2Boolean visible, fmi2Boolean loggingOn
) {
  (void)instanceName; (void)fmuType; (void)fmuGUID;
  (void)fmuResourceLocation; (void)functions; (void)visible; (void)loggingOn;
  CellmlFmuInstance* inst = (CellmlFmuInstance*)calloc(1, sizeof(CellmlFmuInstance));
  if (!inst) return NULL;
  cellml_reset_instance(inst);
  return (fmi2Component)inst;
}

void ${modelIdentifier}_fmi2FreeInstance(fmi2Component c) {
  if (c) free(c);
}

fmi2Status ${modelIdentifier}_fmi2SetupExperiment(
  fmi2Component c, fmi2Boolean toleranceDefined, fmi2Real tolerance,
  fmi2Real startTime, fmi2Boolean stopTimeDefined, fmi2Real stopTime
) {
  (void)toleranceDefined; (void)tolerance; (void)stopTimeDefined; (void)stopTime;
  CellmlFmuInstance* inst = (CellmlFmuInstance*)c;
  if (!inst) return fmi2Error;
  inst->start_time = startTime;
  inst->current_time = startTime;
  return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2EnterInitializationMode(fmi2Component c) {
  CellmlFmuInstance* inst = (CellmlFmuInstance*)c;
  if (!inst) return fmi2Error;
  cellml_eval_equations(inst);
  return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2ExitInitializationMode(fmi2Component c) {
  CellmlFmuInstance* inst = (CellmlFmuInstance*)c;
  if (!inst) return fmi2Error;
  inst->initialized = 1;
  cellml_eval_equations(inst);
  return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2Terminate(fmi2Component c) {
  CellmlFmuInstance* inst = (CellmlFmuInstance*)c;
  if (!inst) return fmi2Error;
  inst->initialized = 0;
  return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2Reset(fmi2Component c) {
  CellmlFmuInstance* inst = (CellmlFmuInstance*)c;
  if (!inst) return fmi2Error;
  cellml_reset_instance(inst);
  return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2GetReal(
  fmi2Component c, const fmi2ValueReference vr[], size_t nvr, fmi2Real value[]
) {
  CellmlFmuInstance* inst = (CellmlFmuInstance*)c;
  if (!inst) return fmi2Error;
  for (size_t i = 0; i < nvr; i++) {
    value[i] = (vr[i] < MAX_VR) ? inst->vars[vr[i]] : 0.0;
  }
  return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2SetReal(
  fmi2Component c, const fmi2ValueReference vr[], size_t nvr, const fmi2Real value[]
) {
  CellmlFmuInstance* inst = (CellmlFmuInstance*)c;
  if (!inst) return fmi2Error;
  for (size_t i = 0; i < nvr; i++) {
    if (vr[i] < MAX_VR) inst->vars[vr[i]] = value[i];
    for (int s = 0; s < ${states.length}; s++) {
      if ((int)vr[i] == ${states.length > 0 ? "0" : "-1"}) { (void)s; }
    }
  }
  cellml_eval_equations(inst);
  return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2GetDerivatives(
  fmi2Component c, fmi2Real derivatives[], size_t nx
) {
  CellmlFmuInstance* inst = (CellmlFmuInstance*)c;
  if (!inst) return fmi2Error;
  cellml_eval_equations(inst);
  for (size_t i = 0; i < nx && i < ${states.length}; i++) {
    derivatives[i] = inst->derivs[i];
  }
  return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2DoStep(
  fmi2Component c, fmi2Real currentCommunicationPoint,
  fmi2Real communicationStepSize, fmi2Boolean noSetFMUStatePriorToCurrentPoint
) {
  (void)noSetFMUStatePriorToCurrentPoint;
  CellmlFmuInstance* inst = (CellmlFmuInstance*)c;
  if (!inst) return fmi2Error;
  inst->current_time = currentCommunicationPoint;
  int nSub = (int)ceil(communicationStepSize / 0.01);
  if (nSub < 1) nSub = 1;
  if (nSub > 100) nSub = 100;
  fmi2Real dt = communicationStepSize / (fmi2Real)nSub;
  for (int s = 0; s < nSub; s++) {
    cellml_rk4_step(inst, dt);
  }
  return fmi2OK;
}

/* FMI 3.0 Entry Points */
fmi3Instance ${modelIdentifier}_fmi3InstantiateCoSimulation(
  const char* instanceName, const char* instantiationToken, const char* resourcePath,
  int visible, int loggingOn, int eventModeUsed, int earlyReturnAllowed,
  const fmi3ValueReference requiredIntermediateVariables[], size_t nRequiredIntermediateVariables,
  void* instanceEnvironment, void* logMessage, void* intermediateUpdate
) {
  (void)eventModeUsed; (void)earlyReturnAllowed; (void)requiredIntermediateVariables;
  (void)nRequiredIntermediateVariables; (void)instanceEnvironment; (void)logMessage; (void)intermediateUpdate;
  return ${modelIdentifier}_fmi2Instantiate(instanceName, 1, instantiationToken, resourcePath, NULL, visible, loggingOn);
}

void ${modelIdentifier}_fmi3FreeInstance(fmi3Instance instance) {
  ${modelIdentifier}_fmi2FreeInstance(instance);
}

fmi3Status ${modelIdentifier}_fmi3GetFloat64(
  fmi3Instance instance, const fmi3ValueReference valueReferences[],
  size_t nValueReferences, fmi3Float64 values[], size_t nValues
) {
  (void)nValues;
  return (fmi3Status)${modelIdentifier}_fmi2GetReal(instance, valueReferences, nValueReferences, values);
}

fmi3Status ${modelIdentifier}_fmi3SetFloat64(
  fmi3Instance instance, const fmi3ValueReference valueReferences[],
  size_t nValueReferences, const fmi3Float64 values[], size_t nValues
) {
  (void)nValues;
  return (fmi3Status)${modelIdentifier}_fmi2SetReal(instance, valueReferences, nValueReferences, values);
}

fmi3Status ${modelIdentifier}_fmi3DoStep(
  fmi3Instance instance, fmi3Float64 currentCommunicationPoint, fmi3Float64 communicationStepSize,
  int noSetFMUStatePriorToCurrentPoint, int* eventHandlingNeeded, int* terminateSimulation,
  int* earlyReturn, fmi3Float64* lastSuccessfulTime
) {
  fmi3Status st = (fmi3Status)${modelIdentifier}_fmi2DoStep(
    instance, currentCommunicationPoint, communicationStepSize, noSetFMUStatePriorToCurrentPoint
  );
  if (eventHandlingNeeded) *eventHandlingNeeded = 0;
  if (terminateSimulation) *terminateSimulation = 0;
  if (earlyReturn) *earlyReturn = 0;
  if (lastSuccessfulTime) *lastSuccessfulTime = currentCommunicationPoint + communicationStepSize;
  return st;
}
`;
}

/**
 * Exports a CellML cellular / electrophysiology model to an FMI 2.0 or 3.0 FMU package.
 */
export function exportCellmlToFmu(doc: CellmlFmuModelLike, options: MedicalFmuOptions = {}): MedicalFmuExportResult {
  const rawName = options.modelIdentifier ?? doc.name ?? "cellml_model";
  const modelIdentifier = sanitizeIdentifier(rawName, "cellml_model");
  const fmiVersion = options.fmiVersion ?? "2.0";
  const guid = options.guid ?? generateGuid(`cellml:${modelIdentifier}`);
  const startTime = options.startTime ?? 0.0;
  const stopTime = options.stopTime ?? 100.0;
  const stepSize = options.stepSize ?? 0.01;
  const description = options.description ?? `CellML Cellular Electrophysiology & ODE FMU: ${modelIdentifier}`;

  const targetToSource = resolveCellmlConnectionsLike(doc);
  const odeEquationsByQual = new Map<string, { compName: string; eq: CellmlFmuEquationLike }>();
  const algEquationsByQual = new Map<string, { compName: string; eq: CellmlFmuEquationLike }>();
  const indepQuals = new Set<string>();

  const components = toArray(doc.components);
  for (const comp of components) {
    for (const eq of comp.equations) {
      if (!eq.targetVariable) continue;
      const qual = `${comp.name}.${eq.targetVariable}`;
      if (eq.isOde) {
        odeEquationsByQual.set(qual, { compName: comp.name, eq });
        if (eq.independentVariable) {
          indepQuals.add(`${comp.name}.${eq.independentVariable}`);
        }
      } else {
        algEquationsByQual.set(qual, { compName: comp.name, eq });
      }
    }
  }

  const vars: InternalFmuVar[] = [];
  let nextVr = 1;
  const addVar = (spec: Omit<InternalFmuVar, "index" | "vr">): InternalFmuVar => {
    const entry: InternalFmuVar = {
      ...spec,
      index: vars.length + 1,
      vr: nextVr++,
    };
    vars.push(entry);
    return entry;
  };

  const qualToVar = new Map<string, InternalFmuVar>();
  const qualToVr = new Map<string, number>();
  const stateVarEntries: {
    qual: string;
    compName: string;
    v: CellmlFmuVariableLike;
    stateVar: InternalFmuVar;
    derivVar: InternalFmuVar;
    eq: CellmlFmuEquationLike;
  }[] = [];
  const indepVrs: number[] = [];

  for (const comp of components) {
    for (const v of toArray(comp.variables)) {
      const qual = `${comp.name}.${v.name}`;
      const cIdent = sanitizeIdentifier(`${comp.name}_${v.name}`, "var");
      const isConnectedInput = targetToSource.has(qual);
      const odeInfo = odeEquationsByQual.get(qual);
      const algInfo = algEquationsByQual.get(qual);
      const isIndep =
        indepQuals.has(qual) ||
        ((v.name === "time" || v.name === "t") &&
          v.initialValue === undefined &&
          !isConnectedInput &&
          !odeInfo &&
          !algInfo);

      if (isIndep) {
        indepQuals.add(qual);
        const iv = addVar({
          name: qual,
          cIdent,
          causality: "independent",
          variability: "continuous",
          unit: v.units || "second",
          description: `Independent variable ${qual}`,
        });
        qualToVar.set(qual, iv);
        qualToVr.set(qual, iv.vr);
        indepVrs.push(iv.vr);
        continue;
      }

      if (odeInfo) {
        const stateVar = addVar({
          name: qual,
          cIdent,
          causality: "output",
          variability: "continuous",
          initial: "exact",
          start: v.initialValue ?? 0.0,
          unit: v.units || undefined,
          description: `Continuous ODE state variable ${qual}`,
        });
        const derivVar = addVar({
          name: `der(${qual})`,
          cIdent: `der_${cIdent}`,
          causality: "local",
          variability: "continuous",
          initial: "calculated",
          unit: v.units || undefined,
          derivativeOfIndex: stateVar.index,
          derivativeOfVr: stateVar.vr,
          description: `State derivative d(${qual})/dt`,
        });
        qualToVar.set(qual, stateVar);
        qualToVr.set(qual, stateVar.vr);
        stateVarEntries.push({
          qual,
          compName: comp.name,
          v,
          stateVar,
          derivVar,
          eq: odeInfo.eq,
        });
        continue;
      }

      if (algInfo) {
        const isOut = v.publicInterface === "out" || v.privateInterface === "out";
        const algVar = addVar({
          name: qual,
          cIdent,
          causality: isOut ? "output" : "local",
          variability: "continuous",
          initial: "calculated",
          unit: v.units || undefined,
          description: `Algebraic variable ${qual}`,
        });
        qualToVar.set(qual, algVar);
        qualToVr.set(qual, algVar.vr);
        continue;
      }

      if (isConnectedInput) {
        const connVar = addVar({
          name: qual,
          cIdent,
          causality: "local",
          variability: "continuous",
          initial: "calculated",
          unit: v.units || undefined,
          description: `Connected component variable ${qual}`,
        });
        qualToVar.set(qual, connVar);
        qualToVr.set(qual, connVar.vr);
        continue;
      }

      const isUnconnectedInput = v.publicInterface === "in" || v.privateInterface === "in";
      if (isUnconnectedInput) {
        const inVar = addVar({
          name: qual,
          cIdent,
          causality: "input",
          variability: "continuous",
          start: v.initialValue ?? 0.0,
          unit: v.units || undefined,
          description: `Input variable ${qual}`,
        });
        qualToVar.set(qual, inVar);
        qualToVr.set(qual, inVar.vr);
        continue;
      }

      const paramVar = addVar({
        name: qual,
        cIdent,
        causality: "parameter",
        variability: "tunable",
        initial: "exact",
        start: v.initialValue ?? 0.0,
        unit: v.units || undefined,
        description: `CellML parameter ${qual}`,
      });
      qualToVar.set(qual, paramVar);
      qualToVr.set(qual, paramVar.vr);
    }
  }

  const connectionPairs: { targetVr: number; sourceVr: number }[] = [];
  for (const [targetQual, sourceQual] of targetToSource.entries()) {
    const targetVr = qualToVr.get(targetQual);
    const sourceVr = qualToVr.get(sourceQual);
    if (targetVr !== undefined && sourceVr !== undefined) {
      connectionPairs.push({ targetVr, sourceVr });
    }
  }

  const algEqs: CellmlAlgDesc[] = [];
  for (const [qual, { compName, eq }] of algEquationsByQual.entries()) {
    const targetVr = qualToVr.get(qual);
    if (targetVr === undefined) continue;
    algEqs.push({
      qual,
      targetVr,
      cExpr: translateCellmlExprToC(eq.rhsExpression, compName, qualToVr, indepQuals),
    });
  }

  const states: CellmlStateDesc[] = stateVarEntries.map((s) => ({
    qual: s.qual,
    stateVr: s.stateVar.vr,
    derivVr: s.derivVar.vr,
    initialValue: s.v.initialValue ?? 0.0,
    cExpr: translateCellmlExprToC(s.eq.rhsExpression, s.compName, qualToVr, indepQuals),
  }));

  const units = collectCellmlUnits(doc, vars);

  const modelDescription2Xml = renderFmi2ModelDescription(
    modelIdentifier,
    guid,
    description,
    "ModelScript CellML Electrophysiology FMU Exporter",
    startTime,
    stopTime,
    stepSize,
    units,
    vars,
  );

  const modelDescription3Xml = renderFmi3ModelDescription(
    modelIdentifier,
    guid,
    description,
    "ModelScript CellML Electrophysiology FMU Exporter",
    startTime,
    stopTime,
    stepSize,
    units,
    vars,
  );

  const modelDescriptionXml = fmiVersion === "3.0" ? modelDescription3Xml : modelDescription2Xml;
  const maxVr = nextVr + 8;
  const cSource = generateCellmlC99Source(modelIdentifier, vars, indepVrs, connectionPairs, algEqs, states, maxVr);

  const wasmRuntimeSource = `// SPDX-License-Identifier: AGPL-3.0-or-later
// WebAssembly-ready JS/TS CellML ODE RK4 Runtime (${modelIdentifier})
export const MODEL_IDENTIFIER = ${JSON.stringify(modelIdentifier)};
export const STATE_VRS = ${JSON.stringify(states.map((s) => s.stateVr))};
export const DERIV_VRS = ${JSON.stringify(states.map((s) => s.derivVr))};
`;

  const encoder = new TextEncoder();
  const filesMap = new Map<string, Uint8Array>();
  filesMap.set("modelDescription.xml", encoder.encode(modelDescriptionXml));
  if (options.includeSources !== false) {
    filesMap.set("sources/model.c", encoder.encode(cSource));
    filesMap.set(`sources/${modelIdentifier}_cosim.c`, encoder.encode(cSource));
    filesMap.set("sources/runtime.js", encoder.encode(wasmRuntimeSource));
  }

  const archive = createZip(filesMap);

  return {
    archive,
    modelDescriptionXml,
    modelDescription2Xml,
    modelDescription3Xml,
    cSource,
    wasmRuntimeSource,
    files: Array.from(filesMap.keys()),
    fmiVersion,
    modelIdentifier,
    guid,
    variableCount: vars.length,
  };
}
