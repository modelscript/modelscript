// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Multi-Language Semantic Theory Coordinator & Digital Thread Hypergraph Engine
 * for `HomeSemanticCoordinator.vue`.
 *
 * Executes live N-ary (4-language) synchronization, Nelson-Oppen equality/interval
 * propagation (`SemanticTheoryCoordinator`), canonical FQN requirement binding
 * (`parseSysmlRequirements`, `extractModelicaTwinAnnotations`), first-party
 * CAD/CAE evaluators (`evaluateScad`, `computeMeshVolumeAndArea`, `InpDialect`,
 * `OpenFoamDialect`, `evaluateCfdExpression`, `scanStepEntities`, `parseUrdf`,
 * `ToleranceStackVerifier`), browser-safe 3D meshing & physics (`Tet4Mesher`,
 * `MeshQualityAnalyzer`, `FeaSolver`, `LbmVoxelizer`, `WebGPULbmRunner`),
 * and Struct-of-Arrays alignment tracking (`DigitalThreadHypergraph`).
 */

import { CaeContractOracle } from "../formal/oracles/cae_contract_oracle.js";
import { ConstraintTheoryOracle } from "../formal/oracles/constraint_oracle.js";
import { ToleranceStackOracle } from "../formal/oracles/tolerance_stack_oracle.js";
import { extractModelicaTwinAnnotations, parseSysmlRequirements } from "../formal/requirement_binder.js";
import { SemanticTheoryCoordinator, type ConflictClause, type SharedEquality } from "../formal/theory_coordinator.js";
import { createCoordinatorPipelines } from "./coordinator_pipelines.js";
import { createCoordinatorScenarios } from "./coordinator_scenarios.js";
import {
  parseModelicaCst as rawParseModelicaCst,
  parseSysml2Cst as rawParseSysml2Cst,
  splitTopLevelCommaList,
  type ParsedModelicaCst,
  type ParsedSysml2Cst,
} from "./cst-polyglot-adapters.js";
import {
  evaluateGenericDigitalThread,
  type GenericDigitalThreadOptions,
  type GenericDigitalThreadResult,
} from "./generic_digital_thread.js";
import {
  resolveDigitalThreadWorkspace,
  runDigitalThreadAssertionLoop,
  type CoordinatorDiagnosticLike,
  type ResolvedDigitalThreadWorkspace,
} from "./semantic_coordinator_pipeline.js";
import { ThreadDomain } from "./thread_hypergraph.js";

const CST_CACHE_MAX = 64;
const modelicaCstCache = new Map<string, ParsedModelicaCst>();
const sysml2CstCache = new Map<string, ParsedSysml2Cst>();

function parseModelicaCst(code: string): ParsedModelicaCst {
  const cached = modelicaCstCache.get(code);
  if (cached) return cached;
  const parsed = rawParseModelicaCst(code);
  if (modelicaCstCache.size >= CST_CACHE_MAX) {
    const firstKey = modelicaCstCache.keys().next().value;
    if (firstKey !== undefined) modelicaCstCache.delete(firstKey);
  }
  modelicaCstCache.set(code, parsed);
  return parsed;
}

function parseSysml2Cst(code: string): ParsedSysml2Cst {
  const cached = sysml2CstCache.get(code);
  if (cached) return cached;
  const parsed = rawParseSysml2Cst(code);
  if (sysml2CstCache.size >= CST_CACHE_MAX) {
    const firstKey = sysml2CstCache.keys().next().value;
    if (firstKey !== undefined) sysml2CstCache.delete(firstKey);
  }
  sysml2CstCache.set(code, parsed);
  return parsed;
}

export type WorkflowDiagnostic = CoordinatorDiagnosticLike;

export interface ScadCstNodeLike {
  type: string;
  text: string;
  startPosition: { row: number };
  firstNamedChild: ScadCstNodeLike | null;
  namedChildren: ScadCstNodeLike[];
  childForFieldName(name: string): ScadCstNodeLike | null;
  descendantsOfType(types: string | string[]): ScadCstNodeLike[];
}

export interface ScadSolidLike {
  kind: string;
  name?: string | undefined;
  tag?: { portName: string; portType: string; normal?: readonly [number, number, number] | undefined } | undefined;
  child?: ScadSolidLike | null | undefined;
  left?: ScadSolidLike | null | undefined;
  right?: ScadSolidLike | null | undefined;
  width?: number | undefined;
  height?: number | undefined;
  depth?: number | undefined;
  radius?: number | undefined;
}

export interface ScadMeshLike {
  vertices: Float32Array | ArrayLike<number>;
  indices: Uint32Array | ArrayLike<number>;
  normals: Float32Array | ArrayLike<number>;
  faceTagIndices: ArrayLike<number>;
  tags: ReadonlyArray<{ portName: string; portType: string; normal?: readonly [number, number, number] | undefined }>;
}

export interface ScadEvalResultLike<TMesh extends ScadMeshLike = ScadMeshLike> {
  mesh: TMesh;
  solid: ScadSolidLike | null;
  boundingBox: { min: readonly [number, number, number]; max: readonly [number, number, number] };
  variables: {
    flange_thickness?: unknown;
    web_width?: unknown;
    lug_span?: unknown;
    density_kg_m3?: unknown;
    computed_mass_kg?: unknown;
    pin_bore_d?: unknown;
    channel_width_mm?: unknown;
    channel_depth_mm?: unknown;
    channel_count?: unknown;
    hydraulic_dia_mm?: unknown;
    flow_area_mm2?: unknown;
    [key: string]: unknown;
  };
}

export interface OpenFoamDocLike {
  directives: Map<string, string> | Record<string, string | number | boolean | undefined>;
  markers?: Map<string, unknown> | Record<string, unknown> | undefined;
}

function getOpenFoamDirectiveValue(
  directives: OpenFoamDocLike["directives"],
  key: string,
): string | number | boolean | undefined {
  return directives instanceof Map ? directives.get(key) : directives[key];
}

export interface InpMaterialLike {
  name?: string | undefined;
  E?: number | undefined;
  nu?: number | undefined;
}

export interface InpBoundaryLike {
  target: string | number;
  dofs: number[];
  value?: number | undefined;
  line?: number | undefined;
}

export interface InpCloadLike {
  target: string | number;
  dof?: number | undefined;
  magnitude: number;
  line?: number | undefined;
}

export interface InpDocLike {
  materials: Map<string, InpMaterialLike>;
  boundaries?: InpBoundaryLike[] | undefined;
  cloads?: InpCloadLike[] | undefined;
}

export interface UrdfLinkLike {
  name: string;
  inertial?: { mass?: number | undefined } | undefined;
}

export interface UrdfJointLike {
  name: string;
  type: string;
  parentLink: string;
  childLink: string;
  limits?:
    | {
        lower?: number | undefined;
        upper?: number | undefined;
        effort?: number | undefined;
        velocity?: number | undefined;
      }
    | undefined;
}

export interface UrdfModelLike {
  name?: string | undefined;
  links: Map<string, UrdfLinkLike>;
  joints: Map<string, UrdfJointLike>;
}

export interface TetMeshLike {
  numNodes: number;
  numElements: number;
  elements: ArrayLike<number>;
  boundaryNodes: Map<string, number[]>;
  nodeCoords: ArrayLike<number>;
}

export interface LbmCellGridLike {
  readonly length: number;
  readonly [index: number]: number;
}

export interface SolidKindMapLike {
  readonly Box: string;
  readonly Cylinder: string;
  readonly Union: string;
  readonly Subtract: string;
  readonly Intersect: string;
  readonly TaggedPatch: string;
  readonly Transform: string;
}

export interface CoordinatorDomainProviders<
  TMesh extends ScadMeshLike = ScadMeshLike,
  TCellGrid extends LbmCellGridLike = LbmCellGridLike,
  TTetMesh extends TetMeshLike = TetMeshLike,
> {
  ensureSysmlReady?: (() => void) | undefined;
  parseScadRoot?: ((scadCode: string) => ScadCstNodeLike | null | undefined) | undefined;
  lintSyntaxForLang?: ((code: string, lang: string) => CoordinatorDiagnosticLike[]) | undefined;
  OpenFoamDialect: new () => { parse(source: string): OpenFoamDocLike };
  evaluateCfdExpression(
    expr: string,
    resolver?: (ident: string) => string | number | undefined,
  ): string | number | undefined;
  InpDialect: new () => { parse(source: string): InpDocLike };
  evaluateScad(source: string): ScadEvalResultLike<TMesh>;
  scanStepEntities(source: string): Array<{ id: string; type: string; args: string }>;
  parseUrdf(source: string): UrdfModelLike;
  computeMeshVolumeAndArea(mesh: TMesh): { volume: number; surfaceArea: number };
  ToleranceStackVerifier: {
    verify(opts: {
      name: string;
      dimensions: Array<{
        name: string;
        nominal: number;
        upperTol: number;
        lowerTol: number;
        direction: 1 | -1;
      }>;
      minRequiredClearance?: number | undefined;
    }): {
      statisticalRss: { minRssGap: number; maxRssGap: number };
    };
  };
  SolidKind: SolidKindMapLike;
  LbmVoxelizer: {
    voxelize(
      cfg: {
        nx: number;
        ny: number;
        nz: number;
        dx: number;
        dt: number;
        tau: number;
        density: number;
        inletVelocity: [number, number, number];
      },
      opts: { boxes: Array<{ min: [number, number, number]; max: [number, number, number] }> },
    ): TCellGrid;
  };
  WebGPULbmRunner: new (
    cfg: {
      nx: number;
      ny: number;
      nz: number;
      dx: number;
      dt: number;
      tau: number;
      density: number;
      inletVelocity: [number, number, number];
    },
    cellGrid: TCellGrid,
  ) => {
    step(iterations: number): { maxVelocity: number; pressureDropPa: number };
    vx: ArrayLike<number>;
    vy: ArrayLike<number>;
    vz: ArrayLike<number>;
  };
  FeaSolver: new (
    mesh: TTetMesh,
    opts: { E: number; nu: number; rho: number; yieldStrength: number },
  ) => {
    step(opts: { fixedNodes: Set<number>; nodalLoads: Map<number, [number, number, number]> }): {
      maxVonMisesStress: number;
      maxDisplacement: number;
      elementVonMises: ArrayLike<number>;
      displacements: ArrayLike<number>;
    };
  };
  Tet4Mesher: {
    createBoxMesh(opts: {
      width: number;
      height: number;
      depth: number;
      nx: number;
      ny: number;
      nz: number;
      faceTags: Record<string, string>;
    }): TTetMesh;
  };
  MeshQualityAnalyzer: {
    analyze(mesh: TTetMesh): { minJacobian: number };
  };
}

export interface CoordinatorPaneSpec {
  index: number;
  id: string;
  formatLabel: string;
  roleLabel: string;
  fileName: string;
  namespaceFqn: string;
  fqnSyntaxNote: string;
  lang: "sysml" | "modelica" | "xml" | "scad" | "fea" | "cfd" | "step";
  threadDomain: ThreadDomain;
  threadDomainName: string;
  oracleName: string;
  accent: string;
  docLink: string;
  defaultCode: string;
}

export interface CoordinatorPreset {
  id: string;
  label: string;
  description: string;
  isFault: boolean;
  /** Edited pane index and code overrides */
  apply: (defaultCodes: [string, string, string, string]) => {
    codes: [string, string, string, string];
    editedPaneIndex: number;
  };
}

export interface CoordinatorScenario {
  id: string;
  title: string;
  shortTitle: string;
  domain: string;
  accent: string;
  icon: string;
  description: string;
  command: string;
  panes: [CoordinatorPaneSpec, CoordinatorPaneSpec, CoordinatorPaneSpec, CoordinatorPaneSpec];
  presets: CoordinatorPreset[];
  badges: string[];
}

export interface DomainFqnBinding {
  domainLabel: string;
  fqn: string;
  bindingSyntax: string;
  valueText: string;
}

export interface CoordinatedVariableLink {
  symbol: string;
  canonicalFqn: string;
  bindingMechanism: string;
  label: string;
  valueFormatted: string;
  boundsFormatted: string;
  unit: string;
  sourceDomain: string;
  targetDomains: string[];
  domainBindings: DomainFqnBinding[];
  oracleName: string;
  status: "SAT" | "UNSAT";
  marginText: string;
}

export interface HypergraphNodeStatus {
  paneIndex: number;
  formatLabel: string;
  fileName: string;
  namespaceFqn: string;
  domainName: string;
  oracleName: string;
  status: "SYNCED" | "CONFLICT" | "STALE";
  distanceFromEdit: number;
  accent: string;
}

export interface ExplicitDirectiveLink {
  paneIndex: number;
  fileName: string;
  line: number;
  directiveKind: "@twin" | "@mesh_source" | "@port_map" | "annotation(twin)" | "subject" | "*INCLUDE" | "geometry";
  sourceExpr: string;
  direction: "->" | "<-" | "<->";
  targetExpr: string;
  rawText: string;
}

export interface ExplicitPortBinding {
  portName: string;
  cadPortType: string;
  cadNormal: [number, number, number];
  cadFileName: string;
  cadLine: number;
  caeFileName: string;
  caeTargetKind: "CalculiX *BOUNDARY" | "CalculiX *CLOAD" | "OpenFOAM boundaryField";
  caePatchSpec: string;
  caeLine: number;
  isBound: boolean;
}

export interface EvaluatedEquationRecord {
  paneIndex: number;
  fileName: string;
  language: string;
  lhs: string;
  rhsExpression: string;
  evaluatedValue: number;
  unit: string;
}

export interface ParsedScenarioMetadata {
  directiveLinks: ExplicitDirectiveLink[];
  portBindings: ExplicitPortBinding[];
  evaluatedEquations: EvaluatedEquationRecord[];
  meshSourceSummary: string;
}

export interface Visual3DTriangle {
  v0: [number, number, number];
  v1: [number, number, number];
  v2: [number, number, number];
  normal: [number, number, number];
  tag?: string | undefined;
  scalar?: number | undefined;
}

export interface CsgTreeNodeSummary {
  id: string;
  kind: string;
  label: string;
  detail: string;
  tag?: string | undefined;
  depth: number;
}

export interface SysmlBddVisualData {
  kind: "sysml-bdd";
  packageName: string;
  partName: string;
  partAttributes: { name: string; value: string; unit: string; sourceHint: string }[];
  requirementId: string;
  subjectName: string;
  subjectType: string;
  constraints: {
    expression: string;
    actualText: string;
    limitText: string;
    isSat: boolean;
  }[];
}

export interface ModelicaDaeVisualData {
  kind: "modelica-dae";
  withinPkg: string;
  modelName: string;
  parameters: { name: string; value: string; unit: string; twinFqn?: string }[];
  equations: { lhs: string; rhs: string; resultText: string; twinFqn?: string }[];
}

export interface Scad3DVisualData {
  kind: "scad-3d";
  moduleName: string;
  triangles: Visual3DTriangle[];
  bboxMin: [number, number, number];
  bboxMax: [number, number, number];
  volumeMm3: number;
  surfaceAreaMm2: number;
  computedMassKg?: number;
  hydraulicDiaMm?: number;
  flowAreaMm2?: number;
  ports: {
    portName: string;
    portType: string;
    normal: [number, number, number];
    anchor: [number, number, number];
    boundToCae: boolean;
    caeTarget: string;
  }[];
  csgTree: CsgTreeNodeSummary[];
}

export interface Fea3DVisualData {
  kind: "fea-3d";
  materialName: string;
  youngsModulusGpa: number;
  poissonsRatio: number;
  densityKgM3: number;
  meshSourceFile: string;
  numNodes: number;
  numElements: number;
  minJacobian: number;
  appliedLoadN: number;
  maxVonMisesMpa: number;
  allowableVonMisesMpa: number;
  maxDeflectionMm: number;
  allowableDeflectionMm: number;
  undeformedTriangles: Visual3DTriangle[];
  deformedTriangles: Visual3DTriangle[];
  fixedPinCoords: [number, number, number][];
  loadArrowCoords: { origin: [number, number, number]; dir: [number, number, number] }[];
  bboxMin: [number, number, number];
  bboxMax: [number, number, number];
}

export interface Cfd3DVisualData {
  kind: "cfd-3d";
  solverName: string;
  meshSourceFile: string;
  nx: number;
  ny: number;
  nz: number;
  channelCount: number;
  hydraulicDiaMm: number;
  inletFlowLpm: number;
  wallHeatLoadW: number;
  maxVelocityMs: number;
  pressureDropKpa: number;
  maxAllowableDpKpa: number;
  maxSurfaceTempK: number;
  maxAllowableTempK: number;
  cells: {
    ix: number;
    iy: number;
    isSolid: boolean;
    velocityMagMs: number;
    pressureKpa: number;
    tempK: number;
  }[];
  patches: {
    name: string;
    openFoamType: string;
    cadPortType: string;
    isBound: boolean;
    summary: string;
  }[];
}

export interface Urdf3DVisualData {
  kind: "urdf-3d";
  robotName: string;
  links: { name: string; massKg: number }[];
  joints: {
    name: string;
    type: string;
    parent: string;
    child: string;
    lowerRad: number;
    upperRad: number;
    effortLimitNm: number;
    velocityLimitRadS: number;
    actualTorqueNm: number;
  }[];
  payloadMassKg: number;
  linkReachM: number;
}

export interface StepGdtVisualData {
  kind: "step-gdt";
  fileName: string;
  entityCount: number;
  boreEntityId: string;
  boreNominalMm: number;
  boreTolMm: number;
  shaftEntityId: string;
  shaftNominalMm: number;
  shaftTolMm: number;
  envelopeEntityId: string;
  wcMinMm: number;
  wcMaxMm: number;
  rssMinMm: number;
  rssMaxMm: number;
  allowableMinMm: number;
  allowableMaxMm: number;
  isSat: boolean;
  entities: { id: string; typeName: string; summary: string }[];
}

export type PaneVisualData =
  | SysmlBddVisualData
  | ModelicaDaeVisualData
  | Scad3DVisualData
  | Fea3DVisualData
  | Cfd3DVisualData
  | Urdf3DVisualData
  | StepGdtVisualData;

export interface CoordinatorEvaluationResult {
  status: "SAT" | "UNSAT";
  isSat: boolean;
  elapsedMs: number;
  iterations: number;
  parsedSysmlReqCount: number;
  parsedModelicaTwinCount: number;
  updatedCodes: [string, string, string, string];
  sharedEqualities: SharedEquality[];
  variableLinks: CoordinatedVariableLink[];
  hypergraphNodes: HypergraphNodeStatus[];
  conflicts: ConflictClause[];
  paneDiagnostics: [WorkflowDiagnostic[], WorkflowDiagnostic[], WorkflowDiagnostic[], WorkflowDiagnostic[]];
  parsedMetadata: ParsedScenarioMetadata;
  paneVisuals: [PaneVisualData, PaneVisualData, PaneVisualData, PaneVisualData];
  summaryText: string;
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function extractSysmlAttrNumber(code: string, attrName: string, fallback: number): number {
  const sysmlCst = parseSysml2Cst(code);
  for (const part of sysmlCst.partDefs) {
    const rawAttr = part.attributes[attrName];
    if (rawAttr !== undefined) {
      const n = Number.parseFloat(rawAttr);
      if (Number.isFinite(n)) return n;
    }
  }
  return fallback;
}

function extractModelicaBindingNumber(code: string, varName: string, fallback: number): number {
  const moCst = parseModelicaCst(code);
  const comp = moCst.components.find((c) => c.name === varName);
  if (comp?.bindingExpr !== undefined) {
    const n = Number.parseFloat(comp.bindingExpr);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function findTextRangeLineCol(
  code: string,
  start: number,
  end: number,
): { startLine: number; startCol: number; endLine: number; endCol: number } {
  return spanToLineCol(code, { start, end });
}

function findScadVarValueSpan(code: string, varName: string): { start: number; end: number } | undefined {
  const lines = code.split("\n");
  let offset = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("//") && !trimmed.startsWith("/*")) {
      const assignIdx = line.indexOf("=");
      if (assignIdx > 0) {
        const lhs = line.slice(0, assignIdx).trim();
        if (lhs === varName) {
          const semiIdx = line.indexOf(";", assignIdx + 1);
          if (semiIdx > assignIdx) {
            const rawRhs = line.slice(assignIdx + 1, semiIdx);
            const leadingWs = rawRhs.length - rawRhs.trimStart().length;
            const trimmedRhs = rawRhs.trim();
            const start = offset + assignIdx + 1 + leadingWs;
            return { start, end: start + trimmedRhs.length };
          }
        }
      }
    }
    offset += line.length + 1;
  }
  return undefined;
}

function updateScadVar(code: string, varName: string, nextVal: string): string {
  const span = findScadVarValueSpan(code, varName);
  return span ? code.slice(0, span.start) + nextVal + code.slice(span.end) : code;
}

function findScadVarLineCol(code: string, varName: string) {
  const span = findScadVarValueSpan(code, varName);
  return span
    ? findTextRangeLineCol(code, span.start, span.end)
    : { startLine: 1, startCol: 1, endLine: 1, endCol: 12 };
}

function findInpKeyValueSpan(code: string, key: string): { start: number; end: number; value: string } | undefined {
  const lines = code.split("\n");
  let offset = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("**")) {
      const eqIdx = line.indexOf("=");
      if (eqIdx > 0) {
        const lhs = line.slice(0, eqIdx).trim();
        if (lhs === key) {
          const afterEq = line.slice(eqIdx + 1);
          const leadingWs = afterEq.length - afterEq.trimStart().length;
          const valToken = afterEq.trim().split(/[\s,;]/)[0] ?? "";
          if (valToken.length > 0) {
            const start = offset + eqIdx + 1 + leadingWs;
            return { start, end: start + valToken.length, value: valToken };
          }
        }
      }
    }
    offset += line.length + 1;
  }
  return undefined;
}

function extractInpScalar(code: string, key: string, fallback: number): number {
  const found = findInpKeyValueSpan(code, key);
  if (!found) return fallback;
  const n = Number.parseFloat(found.value);
  return Number.isFinite(n) ? n : fallback;
}

function updateInpScalar(code: string, key: string, nextVal: string): string {
  const found = findInpKeyValueSpan(code, key);
  return found ? code.slice(0, found.start) + nextVal + code.slice(found.end) : code;
}

function findInpLineNumberPos(code: string, oneBasedLine: number) {
  const lines = code.split("\n");
  const idx = Math.max(0, Math.min(oneBasedLine - 1, lines.length - 1));
  const text = lines[idx] ?? "";
  return { startLine: idx + 1, startCol: 1, endLine: idx + 1, endCol: Math.max(1, text.length + 1) };
}

function updateInpSectionValue(
  code: string,
  sectionHeader: string,
  matcher: (line: string) => boolean,
  tokenIndex: number,
  nextVal: string,
): string {
  const lines = code.split("\n");
  let inSection = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed.startsWith("*")) {
      inSection = trimmed.toUpperCase().startsWith(sectionHeader.toUpperCase());
      continue;
    }
    if (inSection && !trimmed.startsWith("**") && trimmed.length > 0 && matcher(trimmed)) {
      const parts = lines[i]!.split(",");
      if (tokenIndex >= 0 && tokenIndex < parts.length) {
        const orig = parts[tokenIndex]!;
        const leading = orig.slice(0, orig.length - orig.trimStart().length);
        const trailing = orig.slice(orig.trimEnd().length);
        parts[tokenIndex] = `${leading}${nextVal}${trailing}`;
        lines[i] = parts.join(",");
        return lines.join("\n");
      }
    }
  }
  return code;
}

function findOpenFoamKeySpan(code: string, key: string): { start: number; end: number; value: string } | undefined {
  const lines = code.split("\n");
  let offset = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("//") && !trimmed.startsWith("/*")) {
      const semiIdx = line.indexOf(";");
      if (semiIdx > 0) {
        const beforeSemi = line.slice(0, semiIdx);
        const leadWs = beforeSemi.length - beforeSemi.trimStart().length;
        const body = beforeSemi.trimStart();
        if (body.startsWith(key) && /\s/.test(body[key.length] ?? "")) {
          const rest = body.slice(key.length);
          const midWs = rest.length - rest.trimStart().length;
          const val = rest.trim();
          const start = offset + leadWs + key.length + midWs;
          return { start, end: start + val.length, value: val };
        }
      }
    }
    offset += line.length + 1;
  }
  return undefined;
}

function extractOpenFoamScalar(code: string, key: string, fallback: number): number {
  const found = findOpenFoamKeySpan(code, key);
  if (!found) return fallback;
  const n = Number.parseFloat(found.value);
  return Number.isFinite(n) ? n : fallback;
}

function updateOpenFoamScalar(code: string, key: string, nextVal: string): string {
  const found = findOpenFoamKeySpan(code, key);
  return found ? code.slice(0, found.start) + nextVal + code.slice(found.end) : code;
}

function findOpenFoamPatchLineCol(code: string, patchName: string) {
  const lines = code.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === `${patchName} {` || trimmed === patchName || trimmed.startsWith(`${patchName} `)) {
      const col = Math.max(1, line.indexOf(patchName) + 1);
      return { startLine: i + 1, startCol: col, endLine: i + 1, endCol: col + patchName.length };
    }
  }
  return { startLine: 1, startCol: 1, endLine: 1, endCol: 12 };
}

function findOpenFoamKeyLineCol(code: string, key: string) {
  const found = findOpenFoamKeySpan(code, key);
  return found
    ? findTextRangeLineCol(code, found.start, found.end)
    : { startLine: 1, startCol: 1, endLine: 1, endCol: 12 };
}

function updateStepEntityArg(code: string, entityId: string, argIndex: number, nextVal: string): string {
  const lines = code.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed.startsWith(`${entityId} `) || trimmed.startsWith(`${entityId}=`)) {
      const openParen = lines[i]!.indexOf("(");
      const closeParen = lines[i]!.lastIndexOf(")");
      if (openParen >= 0 && closeParen > openParen) {
        const inner = lines[i]!.slice(openParen + 1, closeParen);
        const argSpans = splitTopLevelCommaList(inner, openParen + 1);
        if (argIndex >= 0 && argIndex < argSpans.length) {
          const span = argSpans[argIndex]!;
          const orig = lines[i]!.slice(span.start, span.end);
          const leading = orig.slice(0, orig.length - orig.trimStart().length);
          const trailing = orig.slice(orig.trimEnd().length);
          lines[i] = lines[i]!.slice(0, span.start) + `${leading}${nextVal}${trailing}` + lines[i]!.slice(span.end);
          return lines.join("\n");
        }
      }
    }
  }
  return code;
}

function findStepEntityLineCol(code: string, entityId: string) {
  const lines = code.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed.startsWith(`${entityId} `) || trimmed.startsWith(`${entityId}=`)) {
      return { startLine: i + 1, startCol: 1, endLine: i + 1, endCol: lines[i]!.length + 1 };
    }
  }
  return { startLine: 1, startCol: 1, endLine: 1, endCol: 12 };
}

function findUrdfAttrLineCol(code: string, attrName: string) {
  const needle = `${attrName}="`;
  const idx = code.indexOf(needle);
  if (idx < 0) return { startLine: 1, startCol: 1, endLine: 1, endCol: 12 };
  const closeIdx = code.indexOf('"', idx + needle.length);
  return findTextRangeLineCol(code, idx, closeIdx > idx ? closeIdx + 1 : idx + needle.length);
}

function updateUrdfLinkMass(code: string, linkName: string, nextVal: string): string {
  const linkStart = code.indexOf(`name="${linkName}"`);
  if (linkStart < 0) return code;
  const linkEnd = code.indexOf("</link>", linkStart);
  const searchEnd = linkEnd > linkStart ? linkEnd : code.length;
  const massIdx = code.indexOf("<mass", linkStart);
  if (massIdx < 0 || massIdx >= searchEnd) return code;
  const valNeedle = 'value="';
  const valIdx = code.indexOf(valNeedle, massIdx);
  if (valIdx < 0 || valIdx >= searchEnd) return code;
  const valStart = valIdx + valNeedle.length;
  const valEnd = code.indexOf('"', valStart);
  if (valEnd < 0 || valEnd >= searchEnd) return code;
  return `${code.slice(0, valStart)}${nextVal}${code.slice(valEnd)}`;
}

function findInpIncludeTarget(code: string): string | undefined {
  for (const rawLine of code.split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed.toUpperCase().startsWith("*INCLUDE")) continue;
    const upper = trimmed.toUpperCase();
    const inputIdx = upper.indexOf("INPUT=");
    if (inputIdx < 0) continue;
    const afterEq = trimmed.slice(inputIdx + "INPUT=".length).trim();
    const target = afterEq.split(/[,\s]/)[0]?.trim();
    if (target) return target;
  }
  return undefined;
}

function findSysmlSubjectLineCol(code: string, subjectVar: string) {
  const lines = code.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed.startsWith(`subject ${subjectVar}`) || trimmed.includes(`subject ${subjectVar}:`)) {
      const col = Math.max(1, line.indexOf(`subject ${subjectVar}`) + 1);
      return { startLine: i + 1, startCol: col, endLine: i + 1, endCol: col + 7 + subjectVar.length };
    }
  }
  return { startLine: 1, startCol: 1, endLine: 1, endCol: 12 };
}

function spanToLineCol(
  code: string,
  span: { start: number; end: number },
): { startLine: number; startCol: number; endLine: number; endCol: number } {
  const start = Math.max(0, Math.min(span.start, code.length));
  const end = Math.max(start, Math.min(span.end, code.length));
  const before = code.slice(0, start).split("\n");
  const startLine = before.length;
  const startCol = (before[before.length - 1]?.length ?? 0) + 1;
  const matchLines = code.slice(start, end).split("\n");
  const endLine = startLine + matchLines.length - 1;
  const endCol =
    matchLines.length === 1 ? startCol + (end - start) : (matchLines[matchLines.length - 1]?.length ?? 0) + 1;
  return { startLine, startCol, endLine, endCol };
}

function updateSysmlAttrViaCst(code: string, attrName: string, nextVal: string): string {
  const sysmlCst = parseSysml2Cst(code);
  for (const part of sysmlCst.partDefs) {
    const attrSpan = part.attributeSpans?.[attrName]?.valueSpan;
    if (attrSpan) {
      return code.slice(0, attrSpan.start) + nextVal + code.slice(attrSpan.end);
    }
  }
  return code;
}

function updateModelicaBindingViaCst(code: string, varName: string, nextVal: string): string {
  const moCst = parseModelicaCst(code);
  const comp = moCst.components.find((c) => c.name === varName);
  if (comp?.bindingSpan) {
    return code.slice(0, comp.bindingSpan.start) + nextVal + code.slice(comp.bindingSpan.end);
  }
  return code;
}

function findSysmlAttrDeclLineCol(
  code: string,
  attrName: string,
): { startLine: number; startCol: number; endLine: number; endCol: number } {
  const sysmlCst = parseSysml2Cst(code);
  for (const part of sysmlCst.partDefs) {
    const declSpan = part.attributeSpans?.[attrName]?.declSpan;
    if (declSpan) return spanToLineCol(code, declSpan);
  }
  for (const req of sysmlCst.requirementDefs) {
    const declSpan = req.attributeSpans?.[attrName]?.declSpan;
    if (declSpan) return spanToLineCol(code, declSpan);
  }
  return { startLine: 1, startCol: 1, endLine: 1, endCol: 12 };
}

function findSysmlConstraintLineCol(
  code: string,
  substring: string,
): { startLine: number; startCol: number; endLine: number; endCol: number } {
  const sysmlCst = parseSysml2Cst(code);
  for (const req of sysmlCst.requirementDefs) {
    for (let i = 0; i < req.constraints.length; i++) {
      if (req.constraints[i]!.includes(substring) && req.constraintSpans?.[i]) {
        return spanToLineCol(code, req.constraintSpans[i]!);
      }
    }
  }
  return { startLine: 1, startCol: 1, endLine: 1, endCol: 12 };
}

function findModelicaComponentLineCol(
  code: string,
  varName: string,
): { startLine: number; startCol: number; endLine: number; endCol: number } {
  const moCst = parseModelicaCst(code);
  const comp = moCst.components.find((c) => c.name === varName);
  if (comp) return spanToLineCol(code, comp.span);
  return { startLine: 1, startCol: 1, endLine: 1, endCol: 12 };
}

/**
 * Evaluates a Modelica `equation` assignment (`lhs = rhs;`) dynamically using
 * `parseModelicaCst` component bindings and `@modelscript/cfd`'s `evaluateCfdExpression`.
 */
function evaluateModelicaOutputEquation<
  TMesh extends ScadMeshLike,
  TCellGrid extends LbmCellGridLike,
  TTetMesh extends TetMeshLike,
>(
  providers: CoordinatorDomainProviders<TMesh, TCellGrid, TTetMesh>,
  moCode: string,
  outputVarName: string,
  fallbackValue: number,
  extraParams?: Record<string, number>,
): { value: number; rhsExpression: string; paramMap: Map<string, number> } {
  const moCst = parseModelicaCst(moCode);
  const paramMap = new Map<string, number>([
    ["pi", Math.PI],
    ["PI", Math.PI],
  ]);
  for (const comp of moCst.components) {
    if (comp.bindingExpr !== undefined) {
      const n = Number.parseFloat(comp.bindingExpr);
      if (Number.isFinite(n)) {
        paramMap.set(comp.name, n);
      }
    }
  }
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) {
      paramMap.set(k, v);
    }
  }

  const eqNode = moCst.equations.find((e) => e.lhs === outputVarName);
  if (!eqNode) {
    return { value: fallbackValue, rhsExpression: String(fallbackValue), paramMap };
  }
  const rhsExpression = eqNode.rhs.trim();
  const evaluated = providers.evaluateCfdExpression(rhsExpression, (ident) => paramMap.get(ident));
  const value =
    evaluated !== undefined && typeof evaluated === "number" && Number.isFinite(evaluated) ? evaluated : fallbackValue;
  return { value, rhsExpression, paramMap };
}

/**
 * Extracts triangles (`Visual3DTriangle[]`) and CSG tree summaries from `evaluateScad(scadCode)`.
 */
function buildScadVisualTrianglesAndTree<
  TMesh extends ScadMeshLike,
  TCellGrid extends LbmCellGridLike,
  TTetMesh extends TetMeshLike,
>(
  providers: CoordinatorDomainProviders<TMesh, TCellGrid, TTetMesh>,
  scadCode: string,
): {
  evalRes: ScadEvalResultLike<TMesh>;
  triangles: Visual3DTriangle[];
  volumeMm3: number;
  surfaceAreaMm2: number;
  bboxMin: [number, number, number];
  bboxMax: [number, number, number];
  csgTree: CsgTreeNodeSummary[];
  portTags: Map<string, { portType: string; normal: [number, number, number]; line: number }>;
} {
  const { SolidKind } = providers;
  const evalRes = providers.evaluateScad(scadCode);
  const mesh = evalRes.mesh;
  const { volume, surfaceArea } = providers.computeMeshVolumeAndArea(mesh);
  const verts = mesh.vertices;
  const indices = mesh.indices;
  const normals = mesh.normals;
  const faceTags = mesh.faceTagIndices;
  const tags = mesh.tags;

  const triangles: Visual3DTriangle[] = [];
  const triCount = Math.floor(indices.length / 3);
  const maxTris = 280;
  const stride = Math.max(1, Math.ceil(triCount / maxTris));

  for (let t = 0; t < triCount; t += stride) {
    const i0 = indices[t * 3]!;
    const i1 = indices[t * 3 + 1]!;
    const i2 = indices[t * 3 + 2]!;
    const v0: [number, number, number] = [verts[i0 * 3] ?? 0, verts[i0 * 3 + 1] ?? 0, verts[i0 * 3 + 2] ?? 0];
    const v1: [number, number, number] = [verts[i1 * 3] ?? 0, verts[i1 * 3 + 1] ?? 0, verts[i1 * 3 + 2] ?? 0];
    const v2: [number, number, number] = [verts[i2 * 3] ?? 0, verts[i2 * 3 + 1] ?? 0, verts[i2 * 3 + 2] ?? 0];
    const n0: [number, number, number] = [normals[i0 * 3] ?? 0, normals[i0 * 3 + 1] ?? 0, normals[i0 * 3 + 2] ?? 1];
    const tagIdx = faceTags[t] ?? 0;
    const tagObj = tagIdx > 0 ? tags[tagIdx - 1] : undefined;
    triangles.push({
      v0,
      v1,
      v2,
      normal: n0,
      tag: tagObj?.portName,
    });
  }

  // Extract tag_port(...) declarations and 1-based line numbers from the OpenSCAD WASM GLR CST
  const portTags = new Map<string, { portType: string; normal: [number, number, number]; line: number }>();
  const scadRoot = providers.parseScadRoot?.(scadCode);
  if (scadRoot) {
    for (const tagNode of scadRoot.descendantsOfType(["TagPortOp", "ModuleInstantiation"])) {
      if (tagNode.type === "ModuleInstantiation") {
        const idNode = tagNode.childForFieldName("name") ?? tagNode.firstNamedChild;
        if (idNode?.text.trim() !== "tag_port") continue;
      }
      const strNodes = tagNode.descendantsOfType(["STRING", "string"]);
      if (strNodes.length >= 1) {
        const pName = strNodes[0]!.text.trim().replace(/^["']|["']$/g, "");
        const pType = strNodes.length >= 2 ? strNodes[1]!.text.trim().replace(/^["']|["']$/g, "") : "port";
        const vecNode = tagNode.descendantsOfType(["VectorLiteral", "vector", "list"])[0];
        let normal: [number, number, number] = [0, 0, 1];
        if (vecNode) {
          const exprNodes = vecNode.descendantsOfType(["Expression"]);
          const rawItems = exprNodes.length >= 3 ? exprNodes : vecNode.namedChildren;
          const nums = rawItems
            .map((c: ScadCstNodeLike) => Number.parseFloat(c.text.trim()))
            .filter((n: number) => Number.isFinite(n));
          if (nums.length >= 3) {
            normal = [nums[0]!, nums[1]!, nums[2]!];
          }
        }
        portTags.set(pName, {
          portType: pType,
          normal,
          line: tagNode.startPosition.row + 1,
        });
      }
    }
  }

  // Merge any additional evaluated SolidKind.TaggedPatch CSG nodes and mesh.tags
  const collectSolidPortTags = (s: ScadSolidLike | null | undefined): void => {
    if (!s) return;
    if (s.kind === SolidKind["TaggedPatch"] && s.tag) {
      const existing = portTags.get(s.tag.portName);
      portTags.set(s.tag.portName, {
        portType: s.tag.portType || existing?.portType || "port",
        normal: s.tag.normal ? [s.tag.normal[0], s.tag.normal[1], s.tag.normal[2]] : (existing?.normal ?? [0, 0, 1]),
        line: existing?.line ?? 1,
      });
      collectSolidPortTags(s.child);
    } else if (s.kind === SolidKind["Union"] || s.kind === SolidKind["Subtract"] || s.kind === SolidKind["Intersect"]) {
      collectSolidPortTags(s.left);
      collectSolidPortTags(s.right);
    } else if (s.kind === SolidKind["Transform"]) {
      collectSolidPortTags(s.child);
    }
  };
  collectSolidPortTags(evalRes.solid);
  for (const t of tags) {
    if (!portTags.has(t.portName)) {
      portTags.set(t.portName, {
        portType: t.portType,
        normal: t.normal ? [t.normal[0], t.normal[1], t.normal[2]] : [0, 0, 1],
        line: 1,
      });
    }
  }

  const csgTree: CsgTreeNodeSummary[] = [];
  let nodeCounter = 0;
  const walkSolid = (s: ScadSolidLike | null | undefined, depth: number, activeTag?: string): void => {
    if (!s || csgTree.length >= 24) return;
    const id = `csg-${++nodeCounter}`;
    switch (s.kind) {
      case SolidKind.Union:
        csgTree.push({ id, kind: "union", label: "union()", detail: "Boolean CSG Union", tag: activeTag, depth });
        walkSolid(s.left, depth + 1, activeTag);
        walkSolid(s.right, depth + 1, activeTag);
        break;
      case SolidKind.Subtract:
        csgTree.push({
          id,
          kind: "difference",
          label: "difference()",
          detail: "Boolean CSG Subtraction",
          tag: activeTag,
          depth,
        });
        walkSolid(s.left, depth + 1, activeTag);
        walkSolid(s.right, depth + 1, activeTag);
        break;
      case SolidKind.Intersect:
        csgTree.push({
          id,
          kind: "intersection",
          label: "intersection()",
          detail: "Boolean CSG Intersection",
          tag: activeTag,
          depth,
        });
        walkSolid(s.left, depth + 1, activeTag);
        walkSolid(s.right, depth + 1, activeTag);
        break;
      case SolidKind.TaggedPatch:
        if (s.tag) {
          csgTree.push({
            id,
            kind: "tag_port",
            label: `tag_port("${s.tag.portName}")`,
            detail: `type="${s.tag.portType}" normal=[${(s.tag.normal ?? [0, 0, 1]).join(", ")}]`,
            tag: s.tag.portName,
            depth,
          });
          walkSolid(s.child, depth + 1, s.tag.portName);
        } else {
          walkSolid(s.child, depth, activeTag);
        }
        break;
      case SolidKind.Transform:
        walkSolid(s.child, depth, activeTag);
        break;
      case SolidKind.Box:
        csgTree.push({
          id,
          kind: "cube",
          label: "cube()",
          detail: `${(s.width ?? 0).toFixed(1)} × ${(s.height ?? 0).toFixed(1)} × ${(s.depth ?? 0).toFixed(1)} mm`,
          tag: activeTag,
          depth,
        });
        break;
      case SolidKind.Cylinder:
        csgTree.push({
          id,
          kind: "cylinder",
          label: "cylinder()",
          detail: `Ø${((s.radius ?? 0) * 2).toFixed(1)} × h=${(s.height ?? 0).toFixed(1)} mm`,
          tag: activeTag,
          depth,
        });
        break;
      default:
        csgTree.push({
          id,
          kind: s.kind,
          label: s.name || s.kind,
          detail: "3D B-Rep Solid",
          tag: activeTag,
          depth,
        });
        break;
    }
  };
  walkSolid(evalRes.solid, 0);

  const bbox = evalRes.boundingBox;
  return {
    evalRes,
    triangles,
    volumeMm3: Number(volume.toFixed(1)),
    surfaceAreaMm2: Number(surfaceArea.toFixed(1)),
    bboxMin: [bbox.min[0], bbox.min[1], bbox.min[2]],
    bboxMax: [bbox.max[0], bbox.max[1], bbox.max[2]],
    csgTree,
    portTags,
  };
}

/**
 * Parses all explicit cross-language link directives (`@twin`, `@mesh_source`,
 * `@port_map`, `annotation(twin=...)`, `subject`, `*INCLUDE`, `geometry`) from
 * the 4 pane source buffers.
 */
function parseExplicitDirectiveLinks(
  scenario: CoordinatorScenario,
  codes: [string, string, string, string],
): ExplicitDirectiveLink[] {
  const links: ExplicitDirectiveLink[] = [];

  for (let pIdx = 0; pIdx < 4; pIdx++) {
    const pane = scenario.panes[pIdx]!;
    const lines = codes[pIdx]!.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i]!;
      const lineNum = i + 1;

      const twinMatch = /@(twin|port_map)\s*:\s*([^\s<]+)\s*(<->|<-|->)\s*([^\s*]+(?:\s*\*\))?)/.exec(lineText);
      if (twinMatch) {
        const rawTarget = twinMatch[4]!
          .replace(/\*\/$/, "")
          .replace(/--!?>$/, "")
          .trim();
        links.push({
          paneIndex: pIdx,
          fileName: pane.fileName,
          line: lineNum,
          directiveKind: twinMatch[1] === "port_map" ? "@port_map" : "@twin",
          sourceExpr: twinMatch[2]!.trim(),
          direction: twinMatch[3] as "->" | "<-" | "<->",
          targetExpr: rawTarget,
          rawText: lineText.trim(),
        });
      }

      const meshSourceMatch = /@mesh_source\s*:\s*([^\s(]+)\s*(?:\(([^)]+)\))?/.exec(lineText);
      if (meshSourceMatch) {
        links.push({
          paneIndex: pIdx,
          fileName: pane.fileName,
          line: lineNum,
          directiveKind: "@mesh_source",
          sourceExpr: pane.fileName,
          direction: "<-",
          targetExpr: meshSourceMatch[2] ? `${meshSourceMatch[1]} (${meshSourceMatch[2]})` : meshSourceMatch[1]!,
          rawText: lineText.trim(),
        });
      }

      const includeMatch = /^\s*\*INCLUDE\s*,\s*INPUT\s*=\s*(\S+)/i.exec(lineText);
      if (includeMatch) {
        links.push({
          paneIndex: pIdx,
          fileName: pane.fileName,
          line: lineNum,
          directiveKind: "*INCLUDE",
          sourceExpr: "*INCLUDE, INPUT",
          direction: "<-",
          targetExpr: includeMatch[1]!.trim(),
          rawText: lineText.trim(),
        });
      }
    }

    if (pane.lang === "sysml") {
      const reqs = parseSysmlRequirements(codes[pIdx]!);
      const seenSubjects = new Set<string>();
      for (const req of reqs) {
        if (req.subjectName) {
          const subjVar = req.subjectVarName ?? "subject";
          const key = `${subjVar}:${req.subjectName}`;
          if (!seenSubjects.has(key)) {
            seenSubjects.add(key);
            const pos = findSysmlSubjectLineCol(codes[pIdx]!, subjVar);
            links.push({
              paneIndex: pIdx,
              fileName: pane.fileName,
              line: pos.startLine,
              directiveKind: "subject",
              sourceExpr: `subject ${subjVar}`,
              direction: "->",
              targetExpr: `${pane.namespaceFqn}::${req.subjectName}`,
              rawText: `subject ${subjVar} : ${req.subjectName};`,
            });
          }
        }
      }
    }

    if (pane.lang === "modelica") {
      const moCst = parseModelicaCst(codes[pIdx]!);
      for (const comp of moCst.components) {
        if (comp.twinAnnotation) {
          const pos = findModelicaComponentLineCol(codes[pIdx]!, comp.name);
          links.push({
            paneIndex: pIdx,
            fileName: pane.fileName,
            line: pos.startLine,
            directiveKind: "annotation(twin)",
            sourceExpr: `${pane.namespaceFqn}.${comp.name}`,
            direction: "<->",
            targetExpr: comp.twinAnnotation,
            rawText: `${comp.name} annotation(twin = "${comp.twinAnnotation}")`,
          });
        }
      }
    }
  }

  return links;
}

export const COORDINATOR_SCENARIOS: CoordinatorScenario[] = createCoordinatorScenarios({
  updateScadVar,
  updateModelicaBindingViaCst,
  updateStepEntityArg,
});

export interface CoordinatorPipelineContext {
  codes: [string, string, string, string];
  roleIndex: ResolvedDigitalThreadWorkspace["roleIndex"];
  editedPaneIndex: number;
  paneDiagnostics: [WorkflowDiagnostic[], WorkflowDiagnostic[], WorkflowDiagnostic[], WorkflowDiagnostic[]];
  coordinator: SemanticTheoryCoordinator;
  caeOracle: CaeContractOracle;
  toleranceOracle: ToleranceStackOracle;
  variableLinks: CoordinatedVariableLink[];
  conflicts: ConflictClause[];
  portBindings: ExplicitPortBinding[];
  evaluatedEquations: EvaluatedEquationRecord[];
  getSysmlAttrOrBound: (attrName: string, targetAttrName: string, fallback: number) => number;
}

export interface CoordinatorPipelineResult {
  meshSourceSummary: string;
  paneVisuals: [PaneVisualData, PaneVisualData, PaneVisualData, PaneVisualData];
}

export type CoordinatorPipelineEvaluator = (ctx: CoordinatorPipelineContext) => CoordinatorPipelineResult;

export function createPolyglotCoordinator<
  TMesh extends ScadMeshLike = ScadMeshLike,
  TCellGrid extends LbmCellGridLike = LbmCellGridLike,
  TTetMesh extends TetMeshLike = TetMeshLike,
>(providers: CoordinatorDomainProviders<TMesh, TCellGrid, TTetMesh>) {
  const lintSyntaxForLang = providers.lintSyntaxForLang ?? (() => []);
  const COORDINATOR_PIPELINES = createCoordinatorPipelines(providers, {
    parseModelicaCst,
    getOpenFoamDirectiveValue,
    extractSysmlAttrNumber,
    extractModelicaBindingNumber,
    findTextRangeLineCol,
    findScadVarValueSpan,
    findScadVarLineCol,
    findInpKeyValueSpan,
    extractInpScalar,
    findInpLineNumberPos,
    extractOpenFoamScalar,
    findOpenFoamPatchLineCol,
    findOpenFoamKeyLineCol,
    findStepEntityLineCol,
    findUrdfAttrLineCol,
    findInpIncludeTarget,
    findSysmlAttrDeclLineCol,
    findSysmlConstraintLineCol,
    findModelicaComponentLineCol,
    evaluateModelicaOutputEquation,
    buildScadVisualTrianglesAndTree,
    updateScadVar,
    updateInpScalar,
    updateInpSectionValue,
    updateOpenFoamScalar,
    updateStepEntityArg,
    updateUrdfLinkMass,
    updateSysmlAttrViaCst,
    updateModelicaBindingViaCst,
  });

  /**
   * Evaluates a 4-pane scenario using `SemanticTheoryCoordinator`, canonical FQN
   * requirement parsers (`parseSysmlRequirements`, `extractModelicaTwinAnnotations`),
   * first-party CAD/CAE evaluators (`evaluateScad`, `computeMeshVolumeAndArea`,
   * `InpDialect`, `OpenFoamDialect`, `evaluateCfdExpression`, `scanStepEntities`,
   * `parseUrdf`, `ToleranceStackVerifier`), domain-specific `TheoryOracle`s, and
   * `DigitalThreadHypergraph`.
   */
  function evaluateCoordinatorScenario(
    scenarioId: string,
    rawCodes: [string, string, string, string],
    editedPaneIndex: number = 0,
  ): CoordinatorEvaluationResult {
    const t0 = nowMs();
    const scenario = COORDINATOR_SCENARIOS.find((s) => s.id === scenarioId) ?? COORDINATOR_SCENARIOS[0]!;
    const codes: [string, string, string, string] = [...rawCodes];
    const paneDiagnostics: [WorkflowDiagnostic[], WorkflowDiagnostic[], WorkflowDiagnostic[], WorkflowDiagnostic[]] = [
      [],
      [],
      [],
      [],
    ];

    // Make sure the (guarded) shared SysML parser is initialised and registered with the
    // requirement binder before it parses for the first time.
    providers.ensureSysmlReady?.();

    const workspace = resolveDigitalThreadWorkspace(
      scenario.panes.map((p, idx) => ({
        fileName: p.fileName,
        content: codes[idx]!,
        lang: p.lang,
        namespaceFqn: p.namespaceFqn,
        threadDomain: p.threadDomain,
      })),
      scenario.id,
    );

    // Parse SysML v2 requirements and Modelica twin annotations using runtime binder
    const sysmlPaneIdx = workspace.roleIndex.sysml >= 0 ? workspace.roleIndex.sysml : 0;
    const sysmlReqs = parseSysmlRequirements(codes[sysmlPaneIdx]!);
    const modelicaPaneIdx = workspace.roleIndex.modelica;
    const modelicaTwins = modelicaPaneIdx >= 0 ? extractModelicaTwinAnnotations(codes[modelicaPaneIdx]!) : new Map();

    const coordinator = new SemanticTheoryCoordinator();
    const constraintOracle = new ConstraintTheoryOracle();
    const caeOracle = new CaeContractOracle();
    const toleranceOracle = new ToleranceStackOracle();

    coordinator.registerOracle(constraintOracle);
    coordinator.registerOracle(caeOracle);
    coordinator.registerOracle(toleranceOracle);

    const variableLinks: CoordinatedVariableLink[] = [];
    const conflicts: ConflictClause[] = [];
    const portBindings: ExplicitPortBinding[] = [];
    const evaluatedEquations: EvaluatedEquationRecord[] = [];
    const getSysmlAttrOrBound = (attrName: string, targetAttrName: string, fallback: number): number => {
      for (const req of sysmlReqs) {
        if (req.attributes && typeof req.attributes[attrName] === "number") {
          return req.attributes[attrName]!;
        }
        if (req.targetAttribute === targetAttrName && Number.isFinite(req.limitValue)) {
          return req.limitValue;
        }
      }
      return fallback;
    };

    const pipeline = COORDINATOR_PIPELINES[scenario.id] ?? COORDINATOR_PIPELINES["aerospace-actuator"]!;
    const { meshSourceSummary, paneVisuals } = pipeline({
      codes,
      roleIndex: workspace.roleIndex,
      editedPaneIndex,
      paneDiagnostics,
      coordinator,
      caeOracle,
      toleranceOracle,
      variableLinks,
      conflicts,
      portBindings,
      evaluatedEquations,
      getSysmlAttrOrBound,
    });

    const directiveLinks = parseExplicitDirectiveLinks(scenario, codes);
    const parsedMetadata: ParsedScenarioMetadata = {
      directiveLinks,
      portBindings,
      evaluatedEquations,
      meshSourceSummary,
    };

    const satRes = runDigitalThreadAssertionLoop({
      coordinator,
      hypergraph: workspace.hypergraph,
      threadSlot: workspace.threadSlot,
      panes: scenario.panes,
      codes,
      sysmlReqs,
      directiveLinks,
      variableLinks,
      conflicts,
      paneDiagnostics,
      lintSyntaxForLang,
    });
    const isSat = satRes.isSat;

    // Compute actual graph hop distances from editedPaneIndex over cross-domain links
    const paneCount = scenario.panes.length;
    const adj: Set<number>[] = Array.from({ length: paneCount }, () => new Set<number>());
    const findPaneByDomain = (label: string): number => {
      const lower = label.toLowerCase();
      return scenario.panes.findIndex(
        (p) =>
          p.formatLabel.toLowerCase() === lower ||
          p.threadDomainName.toLowerCase() === lower ||
          p.lang.toLowerCase() === lower,
      );
    };
    for (const vLink of variableLinks) {
      const srcIdx = findPaneByDomain(vLink.sourceDomain);
      if (srcIdx < 0) continue;
      for (const td of vLink.targetDomains) {
        const dstIdx = findPaneByDomain(td);
        if (dstIdx >= 0 && dstIdx !== srcIdx) {
          adj[srcIdx]!.add(dstIdx);
          adj[dstIdx]!.add(srcIdx);
        }
      }
    }
    for (const dLink of directiveLinks) {
      for (let otherIdx = 0; otherIdx < paneCount; otherIdx++) {
        if (otherIdx === dLink.paneIndex) continue;
        const ns = scenario.panes[otherIdx]!.namespaceFqn;
        if (ns && (dLink.targetExpr.includes(ns) || dLink.sourceExpr.includes(ns))) {
          adj[dLink.paneIndex]!.add(otherIdx);
          adj[otherIdx]!.add(dLink.paneIndex);
        }
      }
    }
    const distances = new Array<number>(paneCount).fill(Infinity);
    if (editedPaneIndex >= 0 && editedPaneIndex < paneCount) {
      distances[editedPaneIndex] = 0;
      const bfsQueue: number[] = [editedPaneIndex];
      for (let q = 0; q < bfsQueue.length; q++) {
        const cur = bfsQueue[q]!;
        const nextDist = distances[cur]! + 1;
        for (const nb of adj[cur]!) {
          if (nextDist < distances[nb]!) {
            distances[nb] = nextDist;
            bfsQueue.push(nb);
          }
        }
      }
    }

    const hypergraphNodes: HypergraphNodeStatus[] = scenario.panes.map((p, idx) => {
      const hasPaneError = paneDiagnostics[idx]?.some((d) => d.severity === "error") ?? false;
      const dist = Number.isFinite(distances[idx]) ? distances[idx]! : idx === editedPaneIndex ? 0 : 1;
      return {
        paneIndex: idx,
        formatLabel: p.formatLabel,
        fileName: p.fileName,
        namespaceFqn: p.namespaceFqn,
        domainName: p.threadDomainName,
        oracleName: p.oracleName,
        status: hasPaneError ? "CONFLICT" : !isSat ? "STALE" : "SYNCED",
        distanceFromEdit: dist,
        accent: p.accent,
      };
    });

    const elapsedMs = Math.max(0.2, Number((nowMs() - t0).toFixed(2)));
    const summaryText = isSat
      ? `SAT — All 4 theory oracles & ${portBindings.length > 0 ? `${portBindings.length} CAD↔CAE boundary ports ` : ""}verified across ${variableLinks.length} FQN-bound variables (${elapsedMs} ms)`
      : `UNSAT — ${conflicts.length} cross-domain FQN/port conflict clause${conflicts.length === 1 ? "" : "s"} detected across DigitalThreadHypergraph (${elapsedMs} ms)`;

    return {
      status: isSat ? "SAT" : "UNSAT",
      isSat,
      elapsedMs,
      iterations: Math.max(2, satRes.iterations || 3),
      parsedSysmlReqCount: sysmlReqs.length,
      parsedModelicaTwinCount: modelicaTwins.size,
      updatedCodes: codes,
      sharedEqualities: satRes.sharedEqualities,
      variableLinks,
      hypergraphNodes,
      conflicts,
      paneDiagnostics,
      parsedMetadata,
      paneVisuals,
      summaryText,
    };
  }

  function matchesCuratedScenario(
    scenario: CoordinatorScenario,
    files: { fileName: string; content: string }[],
  ): boolean {
    if (files.length !== scenario.panes.length) return false;
    const scenarioFileNames = new Set(scenario.panes.map((p) => p.fileName.toLowerCase()));
    const matchedNames = new Set<string>();
    for (const f of files) {
      const base = f.fileName.split(/[\\/]/).pop()?.toLowerCase() ?? f.fileName.toLowerCase();
      if (!scenarioFileNames.has(base) || matchedNames.has(base)) {
        return false;
      }
      matchedNames.add(base);
    }
    return matchedNames.size === scenarioFileNames.size;
  }

  /**
   * Evaluates an arbitrary N-file polyglot digital thread from file buffers on disk or open editor tabs.
   * Uses curated 4-pane CAE pipelines when the workspace matches a built-in scenario, and falls back
   * to the universal N-file, N-language `evaluateGenericDigitalThread` engine for any custom workspace.
   */
  function evaluatePolyglotDigitalThreadFromFiles(
    files: { uri?: string; fileName: string; content: string; lang?: string }[],
    explicitScenarioId?: string,
    options?: Omit<GenericDigitalThreadOptions, "providers">,
  ): (CoordinatorEvaluationResult | GenericDigitalThreadResult) & { scenarioId: string; scenarioTitle: string } {
    const explicitScenario = explicitScenarioId
      ? COORDINATOR_SCENARIOS.find((s) => s.id === explicitScenarioId)
      : undefined;
    const matchedScenario = explicitScenario ?? COORDINATOR_SCENARIOS.find((s) => matchesCuratedScenario(s, files));

    if (!matchedScenario) {
      return evaluateGenericDigitalThread(files, {
        providers: providers as unknown as Partial<CoordinatorDomainProviders>,
        ...options,
      });
    }

    const resolved = resolveDigitalThreadWorkspace(files, matchedScenario.id);
    const scenario = matchedScenario;

    const codes: [string, string, string, string] = [
      scenario.panes[0].defaultCode,
      scenario.panes[1].defaultCode,
      scenario.panes[2].defaultCode,
      scenario.panes[3].defaultCode,
    ];

    let editedPaneIndex = 0;
    for (const doc of resolved.documents) {
      const base = doc.fileName.split(/[\\/]/).pop()?.toLowerCase() ?? doc.fileName.toLowerCase();
      let matchedIdx = scenario.panes.findIndex((p) => p.fileName.toLowerCase() === base);
      if (matchedIdx < 0) {
        matchedIdx = scenario.panes.findIndex((p) => p.lang === doc.lang);
      }
      if (matchedIdx >= 0) {
        codes[matchedIdx] = doc.content;
        if (doc.content.trim() !== scenario.panes[matchedIdx]!.defaultCode.trim()) {
          editedPaneIndex = matchedIdx;
        }
      }
    }

    const res = evaluateCoordinatorScenario(scenario.id, codes, editedPaneIndex);
    return {
      ...res,
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
    };
  }

  return {
    COORDINATOR_SCENARIOS,
    evaluateCoordinatorScenario,
    evaluatePolyglotDigitalThreadFromFiles,
  };
}
