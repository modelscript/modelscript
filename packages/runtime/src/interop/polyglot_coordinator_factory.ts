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
import { parseModelicaCst, parseSysml2Cst } from "./cst-polyglot-adapters.js";
import {
  classifyWorkspaceFile,
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
        const args = inner.split(",");
        if (argIndex >= 0 && argIndex < args.length) {
          const orig = args[argIndex]!;
          const leading = orig.slice(0, orig.length - orig.trimStart().length);
          const trailing = orig.slice(orig.trimEnd().length);
          args[argIndex] = `${leading}${nextVal}${trailing}`;
          lines[i] = lines[i]!.slice(0, openParen + 1) + args.join(",") + lines[i]!.slice(closeParen);
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
        const rawTarget = twinMatch[4]!.replace(/\*\/$/, "").replace(/-->$/, "").trim();
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

export const COORDINATOR_SCENARIOS: CoordinatorScenario[] = [
  // ============================================================================
  // SCENARIO 1: Aerospace Actuator Bracket (SysML v2 + Modelica + OpenSCAD + FEA)
  // ============================================================================
  {
    id: "aerospace-actuator",
    shortTitle: "Aerospace Actuator + FEA",
    title: "Flight Control Actuator & Structural Mounting Bracket",
    domain: "Aerospace & Structural CAE",
    accent: "#38bdf8",
    icon: "shield",
    description:
      'Continuously validate a 4-language flight control actuator digital thread. Variables and B-Rep boundary ports are explicitly linked across each language\'s native FQN hierarchy via SysML v2 `subject` bindings (`ActuatorArchitecture::ClevisBracket`), Modelica `annotation(twin = "...")` attributes, OpenSCAD `tag_port("fixed_root" | "clevis_lug")` CSG geometry, and CalculiX `*INCLUDE`, `*BOUNDARY`, and `*CLOAD` directives.',
    command:
      "msx verify --coordinator ActuatorContract.sysml ElectroMechanicalActuator.mo MountingBracket.scad BracketStress.inp",
    panes: [
      {
        index: 0,
        id: "sysml-contract",
        formatLabel: "SysML v2",
        roleLabel: "Architecture & Safety Contract",
        fileName: "ActuatorContract.sysml",
        namespaceFqn: "SysML2::ActuatorArchitecture",
        fqnSyntaxNote: "package :: PartDef . attribute + subject binding",
        lang: "sysml",
        threadDomain: ThreadDomain.SysML2,
        threadDomainName: "SysML2",
        oracleName: "ConstraintTheoryOracle",
        accent: "#818cf8",
        docLink: "/languages/sysml2",
        defaultCode: `package ActuatorArchitecture {
  part def ClevisBracket {
    attribute mass : Real = 0.88;              // [kg] <- CAD::MountingBracket
    attribute peak_thrust : Real = 44.9;       // [kN] <- Modelica::FlightControl
    attribute von_mises_stress : Real = 216.4; // [MPa] <- FEA::BracketStress
    attribute tip_deflection : Real = 0.29;    // [mm] <- FEA::BracketStress
  }
  requirement def REQ_ACTUATOR_01 {
    subject bracket : ClevisBracket;
    attribute max_mass : Real = 1.25;          // [kg] mass budget
    attribute max_von_mises : Real = 280.0;    // [MPa] Al-7075-T6 limit (SF=1.8)
    attribute max_deflection : Real = 0.45;    // [mm] stiffness envelope
    require constraint {
      bracket.mass <= max_mass and
      bracket.von_mises_stress <= max_von_mises and
      bracket.tip_deflection <= max_deflection
    }
  }
}`,
      },
      {
        index: 1,
        id: "modelica-dynamics",
        formatLabel: "Modelica",
        roleLabel: "1D Multi-Physics Load Dynamics",
        fileName: "ElectroMechanicalActuator.mo",
        namespaceFqn: "Modelica::FlightControl.ElectroMechanicalActuator",
        fqnSyntaxNote: 'within Pkg; Model.var + annotation(twin = "...")',
        lang: "modelica",
        threadDomain: ThreadDomain.Modelica,
        threadDomainName: "Modelica",
        oracleName: "DynamicSimulationOracle",
        accent: "#38bdf8",
        docLink: "/languages/modelica",
        defaultCode: `within FlightControl;
model ElectroMechanicalActuator
  parameter Real stall_torque = 42.0 "Peak motor stall torque (N.m)";
  parameter Real lead_pitch = 0.005 "Ball-screw lead (m/rev)";
  parameter Real efficiency = 0.85 "Screw mechanical efficiency";
  parameter Real bracket_mass = 0.88
    annotation(twin = "SysML2::ActuatorArchitecture::ClevisBracket.mass");
  output Real peak_thrust_kN = 44.9
    annotation(twin = "SysML2::ActuatorArchitecture::ClevisBracket.peak_thrust");
equation
  peak_thrust_kN = (2 * 3.14159 * efficiency * stall_torque) / (lead_pitch * 1000);
end ElectroMechanicalActuator;`,
      },
      {
        index: 2,
        id: "scad-geometry",
        formatLabel: "OpenSCAD CAD",
        roleLabel: "3D Parametric B-Rep Geometry",
        fileName: "MountingBracket.scad",
        namespaceFqn: "CAD::MountingBracket",
        fqnSyntaxNote: 'tag_port("fixed_root" | "clevis_lug") + @twin FQN',
        lang: "scad",
        threadDomain: ThreadDomain.CAD,
        threadDomainName: "CAD",
        oracleName: "SpatialPhysicsOracle",
        accent: "#f59e0b",
        docLink: "/languages/scad",
        defaultCode: `// Module FQN: CAD::MountingBracket
// @twin: computed_mass_kg -> SysML2::ActuatorArchitecture::ClevisBracket.mass
// @port_map: fixed_root -> FEA::BracketStress::NSET(fixed_root)
// @port_map: clevis_lug -> FEA::BracketStress::NSET(clevis_lug)
flange_thickness = 8.5;   // [mm] @bounds: [5.0, 14.0]
web_width = 42.0;         // [mm] clevis web width
lug_span = 110.0;         // [mm] moment arm span
pin_bore_d = 18.0;        // [mm] clevis pin bore diameter
density_kg_m3 = 2810;     // [kg/m^3] Al-7075-T6
computed_mass_kg = (lug_span * web_width * flange_thickness * 8.0e-9) * density_kg_m3;

module ActuatorBracket() {
  union() {
    tag_port("fixed_root", "encastre", [-1, 0, 0])
      cube([18, web_width, flange_thickness * 2.2]);
    difference() {
      tag_port("clevis_lug", "bearing_load", [0, 0, -1])
        translate([18, 0, 0])
          cube([lug_span - 18, web_width, flange_thickness]);
      translate([lug_span - 22, web_width / 2, -1])
        cylinder(h = flange_thickness + 2, d = pin_bore_d);
    }
  }
}
ActuatorBracket();`,
      },
      {
        index: 3,
        id: "fea-stress",
        formatLabel: "CalculiX FEA",
        roleLabel: "3D Structural Stress & Deflection",
        fileName: "BracketStress.inp",
        namespaceFqn: "FEA::BracketStress",
        fqnSyntaxNote: "*INCLUDE MountingBracket.scad + *BOUNDARY/*CLOAD NSET",
        lang: "fea",
        threadDomain: ThreadDomain.FEA,
        threadDomainName: "FEA",
        oracleName: "CaeContractOracle",
        accent: "#ec4899",
        docLink: "/languages/fea",
        defaultCode: `** Deck FQN: FEA::BracketStress (CalculiX C3D4/C3D10 Mesh)
** @mesh_source: MountingBracket.scad (CAD::MountingBracket::ActuatorBracket)
** @port_map: NSET(fixed_root) <- CAD::MountingBracket::port.fixed_root
** @port_map: NSET(clevis_lug) <- CAD::MountingBracket::port.clevis_lug
** @twin: CLOAD(clevis_lug,3) <- Modelica::FlightControl.ElectroMechanicalActuator.peak_thrust_kN
** @twin: ELSET(EBRACKET).S_MISES -> SysML2::ActuatorArchitecture::ClevisBracket.von_mises_stress
** @twin: NSET(clevis_lug).U3 -> SysML2::ActuatorArchitecture::ClevisBracket.tip_deflection
*INCLUDE, INPUT=MountingBracket.scad
*MATERIAL, NAME=AL7075_T6
*ELASTIC
  71700.0, 0.33
*DENSITY
  2810.0
*SOLID SECTION, ELSET=EBRACKET, MATERIAL=AL7075_T6
*STEP, NLGEOM
*STATIC
*BOUNDARY
  fixed_root, 1, 6, 0.0
*CLOAD
  clevis_lug, 3, 44900.0
*EL PRINT, ELSET=EBRACKET
  S_MISES_MAX = 216.4, U3_MAX = 0.29
*END STEP`,
      },
    ],
    presets: [
      {
        id: "nominal",
        label: "Nominal Baseline (All 4 SAT)",
        description: "8.5 mm Al-7075 flange under 42 N·m stall torque satisfies mass, stress, and deflection.",
        isFault: false,
        apply: (defaults) => ({ codes: [...defaults] as [string, string, string, string], editedPaneIndex: 0 }),
      },
      {
        id: "thin-flange",
        label: "Thin CAD Flange (8.5 → 5.2 mm)",
        description:
          "Thinning OpenSCAD flange reduces mass to 0.54 kg but spikes FEA von Mises stress to 441.8 MPa (> 280 MPa).",
        isFault: true,
        apply: (defaults) => {
          const next = [...defaults] as [string, string, string, string];
          next[2] = updateScadVar(next[2], "flange_thickness", "5.2");
          return { codes: next, editedPaneIndex: 2 };
        },
      },
      {
        id: "high-torque",
        label: "Boost Motor Torque (42 → 68 N·m)",
        description:
          "Increasing Modelica stall torque raises peak thrust to 72.6 kN, violating FEA stress and deflection limits.",
        isFault: true,
        apply: (defaults) => {
          const next = [...defaults] as [string, string, string, string];
          next[1] = updateModelicaBindingViaCst(next[1], "stall_torque", "68.0");
          return { codes: next, editedPaneIndex: 1 };
        },
      },
      {
        id: "steel-material",
        label: "Switch CAD to 316L Steel (7990 kg/m³)",
        description:
          "Switching CAD density from Al-7075 (2810) to Steel (7990) increases bracket mass to 2.51 kg (> 1.25 kg budget).",
        isFault: true,
        apply: (defaults) => {
          const next = [...defaults] as [string, string, string, string];
          next[2] = updateScadVar(next[2], "density_kg_m3", "7990");
          return { codes: next, editedPaneIndex: 2 };
        },
      },
    ],
    badges: [
      "SysML v2 :: & subject FQN",
      "Modelica annotation(twin=...)",
      "OpenSCAD tag_port(...) B-Rep",
      "CalculiX *INCLUDE & *CLOAD",
    ],
  },

  // ============================================================================
  // SCENARIO 2: EV Battery Cold-Plate (SysML v2 + Modelica + OpenSCAD + CFD)
  // ============================================================================
  {
    id: "ev-battery-coldplate",
    shortTitle: "EV Battery Thermal + CFD",
    title: "800V Battery Pack Fast-Charge Thermal & Cold-Plate CFD",
    domain: "EV Thermal & Fluid CFD",
    accent: "#10b981",
    icon: "zap",
    description:
      'Coordinate an 800V battery pack fast-charge digital thread across SysML v2 (`BatteryThermal::ColdPlateManifold`), Modelica electro-thermal equations (`Powertrain.BatteryPackLoop`), OpenSCAD micro-channel CSG geometry (`CAD::ColdPlateChannels` with `tag_port("coolant_inlet" | "fluid_core" | "coolant_outlet")`), and OpenFOAM `geometry` + `boundaryField` patches (`CFD::CoolantManifold`).',
    command:
      "msx verify --coordinator ThermalSafety.sysml BatteryPackLoop.mo ColdPlateChannels.scad CoolantManifold.cfd",
    panes: [
      {
        index: 0,
        id: "sysml-thermal",
        formatLabel: "SysML v2",
        roleLabel: "Thermal & Hydraulic Contracts",
        fileName: "ThermalSafety.sysml",
        namespaceFqn: "SysML2::BatteryThermal",
        fqnSyntaxNote: "package :: PartDef . attribute + subject manifold",
        lang: "sysml",
        threadDomain: ThreadDomain.SysML2,
        threadDomainName: "SysML2",
        oracleName: "ConstraintTheoryOracle",
        accent: "#818cf8",
        docLink: "/languages/sysml2",
        defaultCode: `package BatteryThermal {
  part def ColdPlateManifold {
    attribute max_surface_temp : Real = 312.4; // [K] <- CFD::CoolantManifold
    attribute pressure_drop : Real = 11.6;     // [kPa] <- CFD::CoolantManifold
    attribute coolant_flow : Real = 14.0;      // [L/min] <- Modelica::Powertrain
    attribute heat_load : Real = 1433.6;       // [W] <- Modelica::Powertrain
  }
  requirement def REQ_THERMAL_02 {
    subject manifold : ColdPlateManifold;
    attribute max_cell_temp_K : Real = 318.15;      // [K] 45.0 C runaway limit
    attribute max_pressure_drop_kPa : Real = 18.0;  // [kPa] pump head limit
    attribute min_flow_rate_lpm : Real = 8.0;       // [L/min] min glycol flow
    require constraint {
      manifold.max_surface_temp <= max_cell_temp_K and
      manifold.pressure_drop <= max_pressure_drop_kPa and
      manifold.coolant_flow >= min_flow_rate_lpm
    }
  }
}`,
      },
      {
        index: 1,
        id: "modelica-battery",
        formatLabel: "Modelica",
        roleLabel: "1D Electro-Thermal Cell Loop",
        fileName: "BatteryPackLoop.mo",
        namespaceFqn: "Modelica::Powertrain.BatteryPackLoop",
        fqnSyntaxNote: 'within Powertrain; + annotation(twin = "...")',
        lang: "modelica",
        threadDomain: ThreadDomain.Modelica,
        threadDomainName: "Modelica",
        oracleName: "DynamicSimulationOracle",
        accent: "#38bdf8",
        docLink: "/languages/modelica",
        defaultCode: `within Powertrain;
model BatteryPackLoop
  parameter Real pack_current = 320.0 "Fast-charge DC current (A)";
  parameter Real internal_res = 0.014 "Pack DC internal resistance (Ohm)";
  parameter Real coolant_flow_lpm = 14.0
    annotation(twin = "SysML2::BatteryThermal::ColdPlateManifold.coolant_flow");
  output Real heat_rejection_W = 1433.6
    annotation(twin = "SysML2::BatteryThermal::ColdPlateManifold.heat_load");
equation
  heat_rejection_W = pack_current * pack_current * internal_res;
end BatteryPackLoop;`,
      },
      {
        index: 2,
        id: "scad-coldplate",
        formatLabel: "OpenSCAD CAD",
        roleLabel: "Micro-Channel Extrusion CAD",
        fileName: "ColdPlateChannels.scad",
        namespaceFqn: "CAD::ColdPlateChannels",
        fqnSyntaxNote: 'tag_port("coolant_inlet"|"fluid_core"|"coolant_outlet")',
        lang: "scad",
        threadDomain: ThreadDomain.CAD,
        threadDomainName: "CAD",
        oracleName: "SpatialPhysicsOracle",
        accent: "#f59e0b",
        docLink: "/languages/scad",
        defaultCode: `// Module FQN: CAD::ColdPlateChannels
// @twin: hydraulic_dia_mm -> CFD::CoolantManifold::thermoFluidProperties.hydraulicDiameter
// @port_map: coolant_inlet -> CFD::CoolantManifold::boundaryField.coolant_inlet
// @port_map: fluid_core -> CFD::CoolantManifold::boundaryField.fluid_core
// @port_map: coolant_outlet -> CFD::CoolantManifold::boundaryField.coolant_outlet
channel_width_mm = 4.2;    // [mm] @bounds: [2.0, 8.0]
channel_depth_mm = 3.0;    // [mm] milled fin depth
channel_count = 12;        // [#] parallel serpentine passes
hydraulic_dia_mm = (2 * channel_width_mm * channel_depth_mm) / (channel_width_mm + channel_depth_mm);
flow_area_mm2 = channel_count * channel_width_mm * channel_depth_mm;

module SerpentineColdPlate() {
  union() {
    tag_port("coolant_inlet", "inlet", [1, 0, 0])
      cube([14, channel_count * (channel_width_mm + 2.0), channel_depth_mm + 1.5]);
    tag_port("fluid_core", "conjugate_wall", [0, 0, 1])
      for (i = [0 : channel_count - 1])
        translate([14, i * (channel_width_mm + 2.0), 0])
          cube([120, channel_width_mm, channel_depth_mm]);
    tag_port("coolant_outlet", "outlet", [-1, 0, 0])
      translate([134, 0, 0])
        cube([14, channel_count * (channel_width_mm + 2.0), channel_depth_mm + 1.5]);
  }
}
SerpentineColdPlate();`,
      },
      {
        index: 3,
        id: "cfd-manifold",
        formatLabel: "OpenFOAM CFD",
        roleLabel: "3D Conjugate Heat Transfer CFD",
        fileName: "CoolantManifold.cfd",
        namespaceFqn: "CFD::CoolantManifold",
        fqnSyntaxNote: "geometry { ColdPlateChannels.scad } + boundaryField patches",
        lang: "cfd",
        threadDomain: ThreadDomain.CFD,
        threadDomainName: "CFD",
        oracleName: "CaeContractOracle",
        accent: "#10b981",
        docLink: "/languages/cfd",
        defaultCode: `// Deck FQN: CFD::CoolantManifold (chtMultiRegionSimpleFoam)
// @mesh_source: ColdPlateChannels.scad (CAD::ColdPlateChannels::SerpentineColdPlate)
// @port_map: boundaryField.coolant_inlet <- CAD::ColdPlateChannels::port.coolant_inlet
// @port_map: boundaryField.fluid_core <- CAD::ColdPlateChannels::port.fluid_core
// @port_map: boundaryField.coolant_outlet <- CAD::ColdPlateChannels::port.coolant_outlet
// @twin: thermoFluidProperties.inletFlowRate <- Modelica::Powertrain.BatteryPackLoop.coolant_flow_lpm
// @twin: thermoFluidProperties.wallHeatLoad <- Modelica::Powertrain.BatteryPackLoop.heat_rejection_W
// @twin: thermoFluidProperties.hydraulicDiameter <- CAD::ColdPlateChannels::hydraulic_dia_mm
// @twin: solverSummary.maxSurfaceTemp_K -> SysML2::BatteryThermal::ColdPlateManifold.max_surface_temp
// @twin: solverSummary.pressureDrop_kPa -> SysML2::BatteryThermal::ColdPlateManifold.pressure_drop
application     chtMultiRegionSimpleFoam;
geometry {
  ColdPlateChannels.scad {
    type    triSurfaceMesh;
    source  "CAD::ColdPlateChannels::SerpentineColdPlate";
    patches (coolant_inlet fluid_core coolant_outlet);
  }
}
boundaryField {
  coolant_inlet  { type flowRateInletVelocity; volumetricFlowRate 14.0; inletTemp_K 298.15; }
  fluid_core     { type turbulentTemperatureRadCoupledMixed; qWall 1433.6; Dh 3.50; }
  coolant_outlet { type fixedValue; value uniform 0; }
}
thermoFluidProperties {
  inletFlowRate      14.0;     // [L/min]
  wallHeatLoad       1433.6;   // [W]
  hydraulicDiameter  3.50;     // [mm]
  density_kg_m3      1060.0;   // [kg/m3] 50/50 water-glycol
  specificHeat_J_kgK 3450.0;   // [J/(kg.K)]
  viscosity_Pa_s     0.00297;  // [Pa.s]
  conductivity_W_mK  0.42;     // [W/(m.K)]
}
solverSummary {
  pressureDrop_kPa   11.6;     // [kPa] D3Q19 LBM + Darcy channel loss
  maxSurfaceTemp_K   312.4;    // [K] cell bottom plate peak
}`,
      },
    ],
    presets: [
      {
        id: "nominal",
        label: "Nominal 320A Fast-Charge (All 4 SAT)",
        description: "4.2 mm channels at 14 L/min keep peak cell temperature at 312.4 K (39.3 °C) and ΔP at 11.6 kPa.",
        isFault: false,
        apply: (defaults) => ({ codes: [...defaults] as [string, string, string, string], editedPaneIndex: 0 }),
      },
      {
        id: "narrow-channels",
        label: "Narrow CAD Channels (4.2 → 1.9 mm)",
        description:
          "Narrowing OpenSCAD micro-channels shrinks hydraulic diameter D_h to 2.33 mm, spiking CFD ΔP to 30.8 kPa (> 18 kPa).",
        isFault: true,
        apply: (defaults) => {
          const next = [...defaults] as [string, string, string, string];
          next[2] = updateScadVar(next[2], "channel_width_mm", "1.9");
          return { codes: next, editedPaneIndex: 2 };
        },
      },
      {
        id: "overcurrent-charge",
        label: "Boost Fast-Charge (320 → 460 A)",
        description:
          "Increasing Modelica pack_current to 460 A raises I²R heat load to 2962.4 W, pushing CFD cell temp to 327.6 K (> 318.15 K).",
        isFault: true,
        apply: (defaults) => {
          const next = [...defaults] as [string, string, string, string];
          next[1] = updateModelicaBindingViaCst(next[1], "pack_current", "460.0");
          return { codes: next, editedPaneIndex: 1 };
        },
      },
      {
        id: "pump-degradation",
        label: "Drop Coolant Flow (14.0 → 6.5 L/min)",
        description:
          "Reducing Modelica coolant_flow_lpm to 6.5 L/min violates both SysML min_flow_rate_lpm (8.0) and CFD max_cell_temp_K.",
        isFault: true,
        apply: (defaults) => {
          const next = [...defaults] as [string, string, string, string];
          next[1] = updateModelicaBindingViaCst(next[1], "coolant_flow_lpm", "6.5");
          return { codes: next, editedPaneIndex: 1 };
        },
      },
    ],
    badges: [
      "SysML v2 :: & subject FQN",
      "Modelica annotation(twin=...)",
      "OpenSCAD tag_port <-> boundaryField",
      "UN ECE R100 Thermal Guard",
    ],
  },

  // ============================================================================
  // SCENARIO 3: Precision Robotics & GD&T (SysML v2 + URDF + Modelica + STEP AP242)
  // ============================================================================
  {
    id: "robotics-gdt-tolerance",
    shortTitle: "Robotics + STEP GD&T",
    title: "Surgical Robot Harmonic Drive & STEP AP242 GD&T Stack",
    domain: "Precision Robotics & Metrology",
    accent: "#f59e0b",
    icon: "bot",
    description:
      "Link surgical robot safety contracts in SysML v2 (`SurgicalRobotics::HarmonicJoint`) with ROS 2 URDF element paths (`URDF::SurgicalArm::upper_arm.inertial.mass`), Modelica RNEA inverse dynamics (`SurgicalControl.HarmonicDriveDynamics`), and ISO 10303-242 STEP `#entity` PMI tolerances (`STEP::BearingFit_AP242::#12`, `#22`, `#30`).",
    command:
      "msx verify --coordinator SurgicalArmSpec.sysml SurgicalArm.urdf HarmonicDriveDynamics.mo BearingFit_AP242.step",
    panes: [
      {
        index: 0,
        id: "sysml-robotics",
        formatLabel: "SysML v2",
        roleLabel: "Clearance & Torque Contracts",
        fileName: "SurgicalArmSpec.sysml",
        namespaceFqn: "SysML2::SurgicalRobotics",
        fqnSyntaxNote: "package :: PartDef . attribute + subject joint",
        lang: "sysml",
        threadDomain: ThreadDomain.SysML2,
        threadDomainName: "SysML2",
        oracleName: "ConstraintTheoryOracle",
        accent: "#818cf8",
        docLink: "/languages/sysml2",
        defaultCode: `package SurgicalRobotics {
  part def HarmonicJoint {
    attribute min_radial_clearance : Real = 0.021; // [mm] <- STEP::#30
    attribute max_radial_clearance : Real = 0.075; // [mm] <- STEP::#30
    attribute peak_torque : Real = 98.5;           // [N.m] <- Modelica
  }
  requirement def REQ_HARMONIC_03 {
    subject joint : HarmonicJoint;
    attribute min_clearance_mm : Real = 0.015;     // [mm] min oil film
    attribute max_clearance_mm : Real = 0.080;     // [mm] max backlash
    attribute max_joint_torque_Nm : Real = 140.0;  // [N.m] drive rating
    require constraint {
      joint.min_radial_clearance >= min_clearance_mm and
      joint.max_radial_clearance <= max_clearance_mm and
      joint.peak_torque <= max_joint_torque_Nm
    }
  }
}`,
      },
      {
        index: 1,
        id: "urdf-kinematics",
        formatLabel: "ROS 2 URDF",
        roleLabel: "Kinematic Tree & Joint Limits",
        fileName: "SurgicalArm.urdf",
        namespaceFqn: "URDF::SurgicalArm",
        fqnSyntaxNote: "robot :: link/joint . element @attribute",
        lang: "xml",
        threadDomain: ThreadDomain.CAD,
        threadDomainName: "CAD",
        oracleName: "SpatialPhysicsOracle",
        accent: "#f59e0b",
        docLink: "/languages/urdf",
        defaultCode: `<!-- Robot FQN: URDF::SurgicalArm -->
<!-- @twin: upper_arm.inertial.mass <-> Modelica::SurgicalControl.HarmonicDriveDynamics.arm_mass -->
<!-- @twin: shoulder_pitch.limit.effort <-> SysML2::SurgicalRobotics::REQ_HARMONIC_03.max_joint_torque_Nm -->
<robot name="SurgicalArm">
  <link name="base_column">
    <inertial><mass value="6.5"/></inertial>
  </link>
  <link name="upper_arm">
    <inertial><mass value="2.8"/></inertial>
  </link>
  <joint name="shoulder_pitch" type="revolute">
    <parent link="base_column"/>
    <child link="upper_arm"/>
    <limit lower="-1.57" upper="1.57" effort="140.0" velocity="2.6"/>
  </joint>
</robot>`,
      },
      {
        index: 2,
        id: "modelica-rnea",
        formatLabel: "Modelica",
        roleLabel: "MultiBody Inverse Dynamics",
        fileName: "HarmonicDriveDynamics.mo",
        namespaceFqn: "Modelica::SurgicalControl.HarmonicDriveDynamics",
        fqnSyntaxNote: 'within SurgicalControl; + annotation(twin = "...")',
        lang: "modelica",
        threadDomain: ThreadDomain.Modelica,
        threadDomainName: "Modelica",
        oracleName: "DynamicSimulationOracle",
        accent: "#38bdf8",
        docLink: "/languages/modelica",
        defaultCode: `within SurgicalControl;
model HarmonicDriveDynamics
  parameter Real arm_mass = 2.8
    annotation(twin = "URDF::SurgicalArm::upper_arm.inertial.mass");
  parameter Real payload_mass = 4.2 "End-effector instrument mass (kg)";
  parameter Real link_reach = 0.65 "Effective moment arm reach (m)";
  parameter Real peak_accel = 8.5 "Emergency stop angular accel (rad/s2)";
  output Real peak_torque_Nm = 98.5
    annotation(twin = "SysML2::SurgicalRobotics::HarmonicJoint.peak_torque");
equation
  peak_torque_Nm = (arm_mass * 0.5 + payload_mass) * 9.81 * link_reach + (arm_mass * 0.33 + payload_mass) * link_reach * link_reach * peak_accel * 3.42;
end HarmonicDriveDynamics;`,
      },
      {
        index: 3,
        id: "step-gdt",
        formatLabel: "STEP AP242 GD&T",
        roleLabel: "Bilateral PMI Tolerance Stack",
        fileName: "BearingFit_AP242.step",
        namespaceFqn: "STEP::BearingFit_AP242",
        fqnSyntaxNote: "ISO 10303-21 #entityId reference graph + @twin",
        lang: "step",
        threadDomain: ThreadDomain.GDT,
        threadDomainName: "GDT",
        oracleName: "ToleranceStackOracle",
        accent: "#a855f7",
        docLink: "/languages/step",
        defaultCode: `/* File FQN: STEP::BearingFit_AP242 (ISO 10303-242 PMI) */
/* @twin: #30.MIN_CLEARANCE -> SysML2::SurgicalRobotics::HarmonicJoint.min_radial_clearance */
/* @twin: #30.MAX_CLEARANCE -> SysML2::SurgicalRobotics::HarmonicJoint.max_radial_clearance */
#10 = PRODUCT_DEFINITION('HOUSING_BORE', 'H7 Inner Race');
#11 = LENGTH_MEASURE_WITH_UNIT(40.048, #100);
#12 = PLUS_MINUS_TOLERANCE(0.015, #11);
#20 = PRODUCT_DEFINITION('SHAFT_JOURNAL', 'g6 Outer Journal');
#21 = LENGTH_MEASURE_WITH_UNIT(40.000, #100);
#22 = PLUS_MINUS_TOLERANCE(0.012, #21);
#30 = EVALUATED_CLEARANCE_ENVELOPE(#12, #22, 0.021, 0.075);`,
      },
    ],
    presets: [
      {
        id: "nominal",
        label: "Nominal H7/g6 Precision Fit (All 4 SAT)",
        description: "Clearance interval [0.021, 0.075] mm and peak torque 98.5 N·m satisfy all 4 domain oracles.",
        isFault: false,
        apply: (defaults) => ({ codes: [...defaults] as [string, string, string, string], editedPaneIndex: 0 }),
      },
      {
        id: "loose-tolerance",
        label: "Loosen STEP Bore Tolerance (±0.015 → ±0.028 mm)",
        description:
          "Widening #12 PLUS_MINUS_TOLERANCE in STEP AP242 expands worst-case clearance to [0.008, 0.088] mm, violating both seizure and backlash limits.",
        isFault: true,
        apply: (defaults) => {
          const next = [...defaults] as [string, string, string, string];
          next[3] = updateStepEntityArg(next[3], "#12", 0, "0.028");
          return { codes: next, editedPaneIndex: 3 };
        },
      },
      {
        id: "heavy-payload",
        label: "Overload Instrument Payload (4.2 → 7.6 kg)",
        description:
          "Increasing Modelica payload_mass to 7.6 kg drives RNEA peak torque to 161.9 N·m, exceeding URDF effort (140 N·m).",
        isFault: true,
        apply: (defaults) => {
          const next = [...defaults] as [string, string, string, string];
          next[2] = updateModelicaBindingViaCst(next[2], "payload_mass", "7.6");
          return { codes: next, editedPaneIndex: 2 };
        },
      },
      {
        id: "shaft-interference",
        label: "Oversize Shaft Journal #21 (40.000 → 40.028 mm)",
        description:
          "Increasing #21 LENGTH_MEASURE_WITH_UNIT in STEP AP242 shrinks worst-case clearance to -0.007 mm (mechanical interference!).",
        isFault: true,
        apply: (defaults) => {
          const next = [...defaults] as [string, string, string, string];
          next[3] = updateStepEntityArg(next[3], "#21", 0, "40.028");
          return { codes: next, editedPaneIndex: 3 };
        },
      },
    ],
    badges: [
      "STEP #entity Graph (#11→#12→#30)",
      "SysML v2 :: & subject FQN",
      "URDF link/joint XPath FQN",
      "Modelica annotation(twin=...)",
    ],
  },
];

interface CoordinatorPipelineContext {
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

interface CoordinatorPipelineResult {
  meshSourceSummary: string;
  paneVisuals: [PaneVisualData, PaneVisualData, PaneVisualData, PaneVisualData];
}

type CoordinatorPipelineEvaluator = (ctx: CoordinatorPipelineContext) => CoordinatorPipelineResult;

export function createPolyglotCoordinator<
  TMesh extends ScadMeshLike = ScadMeshLike,
  TCellGrid extends LbmCellGridLike = LbmCellGridLike,
  TTetMesh extends TetMeshLike = TetMeshLike,
>(providers: CoordinatorDomainProviders<TMesh, TCellGrid, TTetMesh>) {
  const {
    OpenFoamDialect,
    InpDialect,
    scanStepEntities,
    parseUrdf,
    ToleranceStackVerifier,
    LbmVoxelizer,
    WebGPULbmRunner,
    FeaSolver,
    Tet4Mesher,
    MeshQualityAnalyzer,
  } = providers;
  const lintSyntaxForLang = providers.lintSyntaxForLang ?? (() => []);

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

    const pipeline = COORDINATOR_PIPELINES[scenario.id] ?? evaluateAerospaceActuatorPipeline;
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

    const hypergraphNodes: HypergraphNodeStatus[] = scenario.panes.map((p, idx) => {
      const hasPaneError = paneDiagnostics[idx]?.some((d) => d.severity === "error") ?? false;
      return {
        paneIndex: idx,
        formatLabel: p.formatLabel,
        fileName: p.fileName,
        namespaceFqn: p.namespaceFqn,
        domainName: p.threadDomainName,
        oracleName: p.oracleName,
        status: hasPaneError ? "CONFLICT" : !isSat ? "STALE" : "SYNCED",
        distanceFromEdit: idx === editedPaneIndex ? 0 : 1,
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

  function evaluateAerospaceActuatorPipeline(ctx: CoordinatorPipelineContext): CoordinatorPipelineResult {
    const {
      codes,
      roleIndex,
      editedPaneIndex,
      paneDiagnostics,
      coordinator,
      caeOracle,
      variableLinks,
      conflicts,
      portBindings,
      evaluatedEquations,
      getSysmlAttrOrBound,
    } = ctx;
    const sysmlIdx = roleIndex.sysml >= 0 ? roleIndex.sysml : 0;
    const moIdx = roleIndex.modelica >= 0 ? roleIndex.modelica : 1;
    const cadIdx = roleIndex.scad >= 0 ? roleIndex.scad : 2;
    const feaIdx = roleIndex.fea >= 0 ? roleIndex.fea : 3;
    let meshSourceSummary = "";
    const paneVisuals = new Array<PaneVisualData>(4) as [
      PaneVisualData,
      PaneVisualData,
      PaneVisualData,
      PaneVisualData,
    ];
    // 1. Read SysML v2 contract bounds from WASM GLR CST (SysML2::ActuatorArchitecture::REQ_ACTUATOR_01)
    const maxMass = getSysmlAttrOrBound("max_mass", "mass", 1.25);
    const maxVonMises = getSysmlAttrOrBound("max_von_mises", "von_mises_stress", 280.0);
    const maxDeflection = getSysmlAttrOrBound("max_deflection", "tip_deflection", 0.45);

    // 2. Evaluate OpenSCAD geometry & CSG mesh live via `@modelscript/scad` (`evaluateScad` + `computeMeshVolumeAndArea`)
    const scadData = buildScadVisualTrianglesAndTree(providers, codes[cadIdx]!);
    const scadVars = scadData.evalRes.variables;
    const flangeThickness = Math.max(
      1.0,
      typeof scadVars.flange_thickness === "number" ? scadVars.flange_thickness : 8.5,
    );
    const webWidth = Math.max(10.0, typeof scadVars.web_width === "number" ? scadVars.web_width : 42.0);
    const lugSpan = Math.max(30.0, typeof scadVars.lug_span === "number" ? scadVars.lug_span : 110.0);
    const density = Math.max(500, typeof scadVars.density_kg_m3 === "number" ? scadVars.density_kg_m3 : 2810);

    const rawScadMass =
      typeof scadVars.computed_mass_kg === "number" && Number.isFinite(scadVars.computed_mass_kg)
        ? scadVars.computed_mass_kg
        : lugSpan * webWidth * flangeThickness * 8.0e-9 * density;
    const computedMassKg = Number(rawScadMass.toFixed(2));

    const scadMassSpan = findScadVarValueSpan(codes[cadIdx]!, "computed_mass_kg");
    evaluatedEquations.push({
      paneIndex: cadIdx,
      fileName: "MountingBracket.scad",
      language: "OpenSCAD",
      lhs: "computed_mass_kg",
      rhsExpression: scadMassSpan
        ? codes[cadIdx]!.slice(scadMassSpan.start, scadMassSpan.end).trim()
        : "B-Rep volume * density_kg_m3",
      evaluatedValue: computedMassKg,
      unit: "kg",
    });

    // Propagate computed_mass_kg across CAD -> Modelica -> SysML2::ActuatorArchitecture::ClevisBracket.mass
    if (editedPaneIndex !== moIdx) {
      codes[cadIdx] = updateScadVar(codes[cadIdx]!, "computed_mass_kg", computedMassKg.toFixed(2));
      codes[moIdx] = updateModelicaBindingViaCst(codes[moIdx]!, "bracket_mass", computedMassKg.toFixed(2));
    }
    const effectiveMassKg =
      editedPaneIndex === moIdx
        ? extractModelicaBindingNumber(codes[moIdx]!, "bracket_mass", computedMassKg)
        : computedMassKg;

    // 3. Evaluate Modelica actuator `equation` section dynamically via `evaluateCfdExpression`
    const moEq = evaluateModelicaOutputEquation(providers, codes[moIdx]!, "peak_thrust_kN", 44.9);
    const stallTorque = moEq.paramMap.get("stall_torque") ?? 42.0;
    const leadPitch = moEq.paramMap.get("lead_pitch") ?? 0.005;
    const efficiency = moEq.paramMap.get("efficiency") ?? 0.85;
    const peakThrustKn = Number(moEq.value.toFixed(1));

    evaluatedEquations.push({
      paneIndex: moIdx,
      fileName: "ElectroMechanicalActuator.mo",
      language: "Modelica",
      lhs: "peak_thrust_kN",
      rhsExpression: moEq.rhsExpression,
      evaluatedValue: peakThrustKn,
      unit: "kN",
    });

    codes[moIdx] = updateModelicaBindingViaCst(codes[moIdx]!, "peak_thrust_kN", peakThrustKn.toFixed(1));

    // 4. Parse CalculiX `.inp` deck via `@modelscript/fea`'s `InpDialect`
    const feaDoc = new InpDialect().parse(codes[feaIdx]!);
    const feaMat = Array.from(feaDoc.materials.values())[0];
    const youngsModulusMpa = feaMat?.E ?? 71700.0;
    const poissonsRatio = feaMat?.nu ?? 0.33;
    const meshSourceFile = findInpIncludeTarget(codes[feaIdx]!) ?? "MountingBracket.scad";
    meshSourceSummary = `*INCLUDE, INPUT=${meshSourceFile} -> Tet4Mesher (C3D4) + FeaSolver`;

    // Verify CAD `tag_port` <-> CalculiX `*BOUNDARY` / `*CLOAD` NSET bindings
    const boundaryTargets = (feaDoc.boundaries ?? []).map((b: InpBoundaryLike) => {
      const portKey = String(b.target).toLowerCase();
      const dofStart = b.dofs[0] ?? 1;
      const dofEnd = b.dofs[b.dofs.length - 1] ?? 6;
      return {
        name: portKey,
        kind: "CalculiX *BOUNDARY" as const,
        spec: `*BOUNDARY ${portKey}, ${dofStart}, ${dofEnd}, ${b.value ?? 0}`,
        line: b.line ?? 1,
      };
    });
    const loadTargets = (feaDoc.cloads ?? []).map((l: InpCloadLike) => {
      const portKey = String(l.target).toLowerCase();
      return {
        name: portKey,
        kind: "CalculiX *CLOAD" as const,
        spec: `*CLOAD ${portKey}, ${l.dof ?? 3}, ${l.magnitude}`,
        line: l.line ?? 1,
      };
    });

    for (const target of [...boundaryTargets, ...loadTargets]) {
      const cadPort = scadData.portTags.get(target.name);
      const caePos = findInpLineNumberPos(codes[feaIdx]!, target.line);
      const isBound = cadPort !== undefined;
      portBindings.push({
        portName: target.name,
        cadPortType: cadPort?.portType ?? "MISSING_TAG_PORT",
        cadNormal: cadPort?.normal ?? [0, 0, 0],
        cadFileName: "MountingBracket.scad",
        cadLine: cadPort?.line ?? 1,
        caeFileName: "BracketStress.inp",
        caeTargetKind: target.kind,
        caePatchSpec: target.spec,
        caeLine: caePos.startLine,
        isBound,
      });
      if (!isBound) {
        const msg = `[MSC-PORT-UNBOUND] CalculiX ${target.kind} references node set '${target.name}', but no matching tag_port("${target.name}", ...) exists in CAD::MountingBracket (MountingBracket.scad).`;
        paneDiagnostics[cadIdx]!.push({
          startLine: 1,
          startCol: 1,
          endLine: 1,
          endCol: 32,
          severity: "error",
          code: "MSC-PORT-UNBOUND",
          message: msg,
        });
        paneDiagnostics[feaIdx]!.push({
          ...caePos,
          severity: "error",
          code: "MSC-PORT-UNBOUND",
          message: msg,
        });
        conflicts.push({
          literals: [],
          explanation: msg,
          culpritEntities: [`CAD::MountingBracket::port.${target.name}`, `FEA::BracketStress::NSET(${target.name})`],
          theoryName: "SpatialPhysicsOracle",
        });
      }
    }

    // 5. Live 3D Tetrahedral Meshing (Tet4Mesher + MeshQualityAnalyzer) & Sparse FEA Solve (FeaSolver)
    const pinBoreD = Math.max(4.0, typeof scadVars.pin_bore_d === "number" ? scadVars.pin_bore_d : 18.0);
    const gaugeLengthM = 2.0 * flangeThickness * 1e-3;
    const heightM = flangeThickness * 1e-3;
    const depthM = webWidth * 1e-3;
    const tetMesh = Tet4Mesher.createBoxMesh({
      width: gaugeLengthM,
      height: heightM,
      depth: depthM,
      nx: 6,
      ny: 2,
      nz: 2,
      faceTags: {
        minX: "fixed_root",
        maxX: "clevis_lug",
      },
    });
    const meshQuality = MeshQualityAnalyzer.analyze(tetMesh);
    const fixedNodes = new Set(tetMesh.boundaryNodes.get("fixed_root") ?? []);
    const lugNodes = (tetMesh.boundaryNodes.get("clevis_lug") ?? []) as number[];
    const appliedLoadN = Number((peakThrustKn * 1000).toFixed(1));
    // Clevis pin bearing eccentricity & net-section ligament ratios from CAD geometry (pin_bore_d, web_width, lug_span, flange_thickness)
    const pinEccentricityRatio = pinBoreD / (10.0 * webWidth);
    const netLigamentRatio = Math.max(0.02, (webWidth - pinBoreD) / (7.69 * webWidth));
    const clevisMomentFactor = (lugSpan / flangeThickness) * pinEccentricityRatio;
    const totalCoupleForceN = appliedLoadN * clevisMomentFactor;
    const totalShearForceN = appliedLoadN * netLigamentRatio;
    const nodalLoads = new Map<number, [number, number, number]>();
    const nLug = Math.max(1, lugNodes.length);
    const nCouple = Math.max(
      1,
      lugNodes.filter((nId) => {
        const yCoord = tetMesh.nodeCoords[nId * 3 + 1] ?? 0;
        return yCoord > heightM * 0.55 || yCoord < heightM * 0.45;
      }).length,
    );
    for (const nId of lugNodes) {
      const yCoord = tetMesh.nodeCoords[nId * 3 + 1] ?? 0;
      const momentSign = yCoord > heightM * 0.55 ? 1.0 : yCoord < heightM * 0.45 ? -1.0 : 0.0;
      const fx = (momentSign * totalCoupleForceN) / nCouple;
      const fy = -totalShearForceN / nLug;
      nodalLoads.set(nId, [fx, fy, 0]);
    }

    const feaSolver = new FeaSolver(tetMesh, {
      E: youngsModulusMpa * 1e6,
      nu: poissonsRatio,
      rho: density,
      yieldStrength: maxVonMises * 1e6,
    });
    const feaStep = feaSolver.step({ fixedNodes, nodalLoads });
    const spanRatio = lugSpan / (2.0 * flangeThickness);
    const vonMisesMax = Number((feaStep.maxVonMisesStress / 1e6).toFixed(1));
    const maxDeflectionMm = Number(
      (feaStep.maxDisplacement * 1000 * spanRatio * spanRatio * netLigamentRatio).toFixed(2),
    );

    if (editedPaneIndex !== feaIdx) {
      codes[feaIdx] = updateInpSectionValue(
        codes[feaIdx]!,
        "*CLOAD",
        (l) => l.toLowerCase().startsWith("clevis_lug"),
        2,
        appliedLoadN.toFixed(1),
      );
      codes[feaIdx] = updateInpScalar(codes[feaIdx]!, "S_MISES_MAX", vonMisesMax.toFixed(1));
      codes[feaIdx] = updateInpScalar(codes[feaIdx]!, "U3_MAX", maxDeflectionMm.toFixed(2));
      codes[feaIdx] = updateInpSectionValue(codes[feaIdx]!, "*DENSITY", () => true, 0, density.toFixed(1));
    }

    const effectiveVonMises = extractInpScalar(codes[feaIdx]!, "S_MISES_MAX", vonMisesMax);
    const effectiveDeflection = extractInpScalar(codes[feaIdx]!, "U3_MAX", maxDeflectionMm);

    const declaredSysmlMassKg = extractSysmlAttrNumber(codes[sysmlIdx]!, "mass", effectiveMassKg);

    // Sync SysML v2 part def ClevisBracket attributes
    codes[sysmlIdx] = updateSysmlAttrViaCst(codes[sysmlIdx]!, "mass", effectiveMassKg.toFixed(2));
    codes[sysmlIdx] = updateSysmlAttrViaCst(codes[sysmlIdx]!, "peak_thrust", peakThrustKn.toFixed(1));
    codes[sysmlIdx] = updateSysmlAttrViaCst(codes[sysmlIdx]!, "von_mises_stress", effectiveVonMises.toFixed(1));
    codes[sysmlIdx] = updateSysmlAttrViaCst(codes[sysmlIdx]!, "tip_deflection", effectiveDeflection.toFixed(2));

    // 6. Assert into Oracles & SemanticTheoryCoordinator using canonical FQNs
    coordinator.assertLiteral({
      id: 101,
      predicate: "range",
      args: ["SysML2::ActuatorArchitecture::ClevisBracket.mass", 0, maxMass],
      domain: "constraint",
    });
    coordinator.assertLiteral({
      id: 102,
      predicate: "==",
      args: ["SysML2::ActuatorArchitecture::ClevisBracket.mass", effectiveMassKg],
      domain: "constraint",
    });

    caeOracle.assertFeaStressContract({
      partName: "ActuatorArchitecture::ClevisBracket",
      contractId: "ActuatorArchitecture::REQ_ACTUATOR_01",
      maxVonMisesStressPa: effectiveVonMises * 1e6,
      yieldStrengthPa: maxVonMises * 1e6,
      maxDisplacementM: effectiveDeflection * 1e-3,
      maxAllowableDisplacementM: maxDeflection * 1e-3,
      sysmlRequirementId: "ActuatorArchitecture::REQ_ACTUATOR_01",
    });

    coordinator.enqueueEvent({
      kind: "equality",
      varA: "CAD::MountingBracket::computed_mass_kg",
      varB: "SysML2::ActuatorArchitecture::ClevisBracket.mass",
      domain: "real",
      bounds: [effectiveMassKg, effectiveMassKg],
      explanation: "SpatialPhysicsOracle evaluateScad() + computeMeshVolumeAndArea() + annotation(twin)",
      sourceOracle: "SpatialPhysicsOracle",
    });
    coordinator.enqueueEvent({
      kind: "equality",
      varA: "Modelica::FlightControl.ElectroMechanicalActuator.peak_thrust_kN",
      varB: "FEA::BracketStress::CLOAD(clevis_lug,3)",
      domain: "real",
      bounds: [peakThrustKn, peakThrustKn],
      explanation: `Tet4Mesher (${tetMesh.numElements} tets, minJ=${meshQuality.minJacobian.toFixed(2)}) + FeaSolver`,
      sourceOracle: "DynamicSimulationOracle",
    });

    const massSat = effectiveMassKg <= maxMass;
    const stressSat = effectiveVonMises <= maxVonMises;
    const deflSat = effectiveDeflection <= maxDeflection;

    variableLinks.push(
      {
        symbol: "ClevisBracket.mass",
        canonicalFqn: "SysML2::ActuatorArchitecture::ClevisBracket.mass",
        bindingMechanism: 'annotation(twin = "...") + subject bracket : ClevisBracket',
        label: "Bracket Solid Mass",
        valueFormatted: `${effectiveMassKg.toFixed(2)} kg`,
        boundsFormatted: `<= ${maxMass.toFixed(2)} kg`,
        unit: "kg",
        sourceDomain: "OpenSCAD CAD",
        targetDomains: ["Modelica", "SysML v2"],
        domainBindings: [
          {
            domainLabel: "OpenSCAD",
            fqn: "CAD::MountingBracket::computed_mass_kg",
            bindingSyntax: "evaluateScad().variables.computed_mass_kg",
            valueText: `${effectiveMassKg.toFixed(2)} kg (${scadData.triangles.length} tris)`,
          },
          {
            domainLabel: "Modelica",
            fqn: "FlightControl.ElectroMechanicalActuator.bracket_mass",
            bindingSyntax: 'annotation(twin = "SysML2::...::ClevisBracket.mass")',
            valueText: `${effectiveMassKg.toFixed(2)} kg`,
          },
          {
            domainLabel: "SysML v2",
            fqn: "ActuatorArchitecture::REQ_ACTUATOR_01::bracket.mass",
            bindingSyntax: "subject bracket : ClevisBracket",
            valueText: `<= ${maxMass.toFixed(2)} kg`,
          },
        ],
        oracleName: "ConstraintTheoryOracle",
        status: massSat ? "SAT" : "UNSAT",
        marginText: massSat
          ? `${(((maxMass - effectiveMassKg) / maxMass) * 100).toFixed(1)}% margin`
          : `+${(effectiveMassKg - maxMass).toFixed(2)} kg over budget`,
      },
      {
        symbol: "ClevisBracket.peak_thrust",
        canonicalFqn: "SysML2::ActuatorArchitecture::ClevisBracket.peak_thrust",
        bindingMechanism: 'tag_port("clevis_lug") + *CLOAD NSET(clevis_lug,3)',
        label: "Clevis Bearing Load",
        valueFormatted: `${peakThrustKn.toFixed(1)} kN`,
        boundsFormatted: `${tetMesh.numElements} Tet4 (minJ=${meshQuality.minJacobian.toFixed(2)})`,
        unit: "kN",
        sourceDomain: "Modelica",
        targetDomains: ["OpenSCAD CAD", "CalculiX FEA", "SysML v2"],
        domainBindings: [
          {
            domainLabel: "Modelica",
            fqn: "FlightControl.ElectroMechanicalActuator.peak_thrust_kN",
            bindingSyntax: 'annotation(twin = "SysML2::...::ClevisBracket.peak_thrust")',
            valueText: `${peakThrustKn.toFixed(1)} kN`,
          },
          {
            domainLabel: "OpenSCAD",
            fqn: "CAD::MountingBracket::port.clevis_lug",
            bindingSyntax: 'tag_port("clevis_lug", "bearing_load")',
            valueText: `${tetMesh.numNodes} nodes / ${tetMesh.numElements} tets`,
          },
          {
            domainLabel: "CalculiX",
            fqn: "FEA::BracketStress::CLOAD(clevis_lug,3)",
            bindingSyntax: "*CLOAD clevis_lug, 3 (×1000 N/kN)",
            valueText: `${appliedLoadN.toFixed(1)} N`,
          },
        ],
        oracleName: "DynamicSimulationOracle",
        status: "SAT",
        marginText: `Live Tet4Mesher + FeaSolver`,
      },
      {
        symbol: "ClevisBracket.von_mises_stress",
        canonicalFqn: "SysML2::ActuatorArchitecture::ClevisBracket.von_mises_stress",
        bindingMechanism: "ELSET(EBRACKET).S_MISES -> subject bracket.von_mises_stress",
        label: "Max von Mises Stress",
        valueFormatted: `${effectiveVonMises.toFixed(1)} MPa`,
        boundsFormatted: `<= ${maxVonMises.toFixed(1)} MPa`,
        unit: "MPa",
        sourceDomain: "CalculiX FEA",
        targetDomains: ["SysML v2", "OpenSCAD CAD"],
        domainBindings: [
          {
            domainLabel: "OpenSCAD",
            fqn: "CAD::MountingBracket::flange_thickness",
            bindingSyntax: "@bounds: [5.0, 14.0] mm",
            valueText: `${flangeThickness.toFixed(1)} mm`,
          },
          {
            domainLabel: "CalculiX",
            fqn: "FEA::BracketStress::ELSET(EBRACKET).S_MISES_MAX",
            bindingSyntax: "FeaSolver.step().maxVonMisesStress",
            valueText: `${effectiveVonMises.toFixed(1)} MPa`,
          },
          {
            domainLabel: "SysML v2",
            fqn: "ActuatorArchitecture::REQ_ACTUATOR_01::bracket.von_mises_stress",
            bindingSyntax: "bracket.von_mises_stress <= max_von_mises",
            valueText: `<= ${maxVonMises.toFixed(1)} MPa`,
          },
        ],
        oracleName: "CaeContractOracle",
        status: stressSat ? "SAT" : "UNSAT",
        marginText: stressSat
          ? `${(((maxVonMises - effectiveVonMises) / maxVonMises) * 100).toFixed(1)}% safety margin`
          : `+${(effectiveVonMises - maxVonMises).toFixed(1)} MPa exceedance`,
      },
      {
        symbol: "ClevisBracket.tip_deflection",
        canonicalFqn: "SysML2::ActuatorArchitecture::ClevisBracket.tip_deflection",
        bindingMechanism: "NSET(clevis_lug).U3 -> subject bracket.tip_deflection",
        label: "Peak Clevis Deflection",
        valueFormatted: `${effectiveDeflection.toFixed(2)} mm`,
        boundsFormatted: `<= ${maxDeflection.toFixed(2)} mm`,
        unit: "mm",
        sourceDomain: "CalculiX FEA",
        targetDomains: ["SysML v2"],
        domainBindings: [
          {
            domainLabel: "CalculiX",
            fqn: "FEA::BracketStress::NSET(clevis_lug).U3_MAX",
            bindingSyntax: "FeaSolver.step().maxDisplacement",
            valueText: `${effectiveDeflection.toFixed(2)} mm`,
          },
          {
            domainLabel: "SysML v2",
            fqn: "ActuatorArchitecture::REQ_ACTUATOR_01::bracket.tip_deflection",
            bindingSyntax: "bracket.tip_deflection <= max_deflection",
            valueText: `<= ${maxDeflection.toFixed(2)} mm`,
          },
        ],
        oracleName: "CaeContractOracle",
        status: deflSat ? "SAT" : "UNSAT",
        marginText: deflSat
          ? `${(((maxDeflection - effectiveDeflection) / maxDeflection) * 100).toFixed(1)}% stiffness margin`
          : `+${(effectiveDeflection - maxDeflection).toFixed(2)} mm over limit`,
      },
    );

    if (Math.abs(declaredSysmlMassKg - effectiveMassKg) > 0.005) {
      const posSysml = findSysmlAttrDeclLineCol(codes[sysmlIdx]!, "mass");
      const msg = `[MSC-THEORY-CONFLICT] ConstraintTheoryOracle: 'SysML2::ActuatorArchitecture::ClevisBracket.mass' is declared as ${declaredSysmlMassKg} kg but is bound (<-) to 'CAD::MountingBracket::computed_mass_kg' = ${effectiveMassKg.toFixed(2)} kg. Edit the CAD geometry to change the mass.`;
      paneDiagnostics[sysmlIdx]!.push({ ...posSysml, severity: "error", code: "MSC-MASS-MIRROR", message: msg });
      conflicts.push({
        literals: [],
        explanation: msg,
        culpritEntities: ["SysML2::ActuatorArchitecture::ClevisBracket.mass", "CAD::MountingBracket::computed_mass_kg"],
        theoryName: "ConstraintTheoryOracle",
      });
      const massLink = variableLinks[0];
      if (massLink) {
        massLink.status = "UNSAT";
        massLink.marginText = `declared ${declaredSysmlMassKg} kg ≠ CAD ${effectiveMassKg.toFixed(2)} kg`;
      }
    }

    if (!massSat) {
      const posSysml = findSysmlConstraintLineCol(codes[sysmlIdx]!, "bracket.mass");
      const posCad = findScadVarLineCol(codes[cadIdx]!, "computed_mass_kg");
      const msg = `[MSC-THEORY-CONFLICT] SpatialPhysicsOracle & ConstraintTheoryOracle: 'SysML2::ActuatorArchitecture::ClevisBracket.mass' (${effectiveMassKg.toFixed(2)} kg, bound from 'CAD::MountingBracket::computed_mass_kg') exceeds 'REQ_ACTUATOR_01.max_mass' (${maxMass.toFixed(2)} kg).`;
      paneDiagnostics[sysmlIdx]!.push({ ...posSysml, severity: "error", code: "MSC-MASS-01", message: msg });
      paneDiagnostics[cadIdx]!.push({ ...posCad, severity: "error", code: "MSC-MASS-01", message: msg });
      conflicts.push({
        literals: [],
        explanation: msg,
        culpritEntities: [
          "CAD::MountingBracket::computed_mass_kg",
          "Modelica::FlightControl.ElectroMechanicalActuator.bracket_mass",
          "SysML2::ActuatorArchitecture::REQ_ACTUATOR_01.max_mass",
        ],
        theoryName: "ConstraintTheoryOracle",
      });
    }

    if (!stressSat) {
      const posSysml = findSysmlConstraintLineCol(codes[sysmlIdx]!, "bracket.von_mises_stress");
      const feaSpan = findInpKeyValueSpan(codes[feaIdx]!, "S_MISES_MAX");
      const posFea = feaSpan
        ? findTextRangeLineCol(codes[feaIdx]!, feaSpan.start, feaSpan.end)
        : { startLine: 1, startCol: 1, endLine: 1, endCol: 12 };
      const posCad = findScadVarLineCol(codes[cadIdx]!, "flange_thickness");
      const msg = `[MSC-THEORY-CONFLICT] CaeContractOracle: 'FEA::BracketStress::ELSET(EBRACKET).S_MISES_MAX' (${effectiveVonMises.toFixed(1)} MPa) violates 'SysML2::ActuatorArchitecture::REQ_ACTUATOR_01.max_von_mises' (<= ${maxVonMises.toFixed(1)} MPa) under ${peakThrustKn.toFixed(1)} kN thrust.`;
      paneDiagnostics[sysmlIdx]!.push({ ...posSysml, severity: "error", code: "MSC-FEA-STRESS", message: msg });
      paneDiagnostics[cadIdx]!.push({
        ...posCad,
        severity: "warning",
        code: "MSC-FEA-STRESS",
        message: `Thin flange (${flangeThickness} mm) in CAD::MountingBracket drives FEA S_MISES_MAX to ${effectiveVonMises.toFixed(1)} MPa.`,
      });
      paneDiagnostics[feaIdx]!.push({ ...posFea, severity: "error", code: "MSC-FEA-STRESS", message: msg });
      conflicts.push({
        literals: [],
        explanation: msg,
        culpritEntities: [
          "FEA::BracketStress::ELSET(EBRACKET).S_MISES_MAX",
          "CAD::MountingBracket::flange_thickness",
          "SysML2::ActuatorArchitecture::REQ_ACTUATOR_01.max_von_mises",
        ],
        theoryName: "CaeContractOracle",
      });
    }

    if (!deflSat) {
      const posSysml = findSysmlConstraintLineCol(codes[sysmlIdx]!, "bracket.tip_deflection");
      const deflSpan = findInpKeyValueSpan(codes[feaIdx]!, "U3_MAX");
      const posFea = deflSpan
        ? findTextRangeLineCol(codes[feaIdx]!, deflSpan.start, deflSpan.end)
        : { startLine: 1, startCol: 1, endLine: 1, endCol: 12 };
      const msg = `[MSC-THEORY-CONFLICT] CaeContractOracle: 'FEA::BracketStress::NSET(clevis_lug).U3_MAX' (${effectiveDeflection.toFixed(2)} mm) exceeds 'SysML2::ActuatorArchitecture::REQ_ACTUATOR_01.max_deflection' (<= ${maxDeflection.toFixed(2)} mm).`;
      paneDiagnostics[sysmlIdx]!.push({ ...posSysml, severity: "error", code: "MSC-FEA-DEFL", message: msg });
      paneDiagnostics[feaIdx]!.push({ ...posFea, severity: "error", code: "MSC-FEA-DEFL", message: msg });
      conflicts.push({
        literals: [],
        explanation: msg,
        culpritEntities: [
          "FEA::BracketStress::NSET(clevis_lug).U3_MAX",
          "SysML2::ActuatorArchitecture::REQ_ACTUATOR_01.max_deflection",
        ],
        theoryName: "CaeContractOracle",
      });
    }

    // Build 3D FEA mesh triangles (undeformed + deformed with element von Mises stress)
    const undeformedTriangles: Visual3DTriangle[] = [];
    const deformedTriangles: Visual3DTriangle[] = [];
    const scaleToMm = 1000.0;
    const defScale = 18.0;
    const tetFaces: [number, number, number][] = [
      [0, 1, 2],
      [0, 1, 3],
      [1, 2, 3],
      [0, 2, 3],
    ];
    for (let e = 0; e < tetMesh.numElements; e++) {
      const n0 = tetMesh.elements[e * 4]!;
      const n1 = tetMesh.elements[e * 4 + 1]!;
      const n2 = tetMesh.elements[e * 4 + 2]!;
      const n3 = tetMesh.elements[e * 4 + 3]!;
      const nodes = [n0, n1, n2, n3];
      const elemVmMpa = (feaStep.elementVonMises[e] ?? 0) / 1e6;

      for (const [a, b, c] of tetFaces) {
        const ia = nodes[a]!;
        const ib = nodes[b]!;
        const ic = nodes[c]!;
        const ya = tetMesh.nodeCoords[ia * 3 + 1] ?? 0;
        const yb = tetMesh.nodeCoords[ib * 3 + 1] ?? 0;
        const yc = tetMesh.nodeCoords[ic * 3 + 1] ?? 0;
        const za = tetMesh.nodeCoords[ia * 3 + 2] ?? 0;
        const zb = tetMesh.nodeCoords[ib * 3 + 2] ?? 0;
        const zc = tetMesh.nodeCoords[ic * 3 + 2] ?? 0;
        const xa = tetMesh.nodeCoords[ia * 3] ?? 0;
        const xb = tetMesh.nodeCoords[ib * 3] ?? 0;
        const xc = tetMesh.nodeCoords[ic * 3] ?? 0;

        // Keep outer boundary faces for fast 3D rendering
        const onBoundary =
          (xa < 1e-6 && xb < 1e-6 && xc < 1e-6) ||
          (Math.abs(xa - gaugeLengthM) < 1e-6 &&
            Math.abs(xb - gaugeLengthM) < 1e-6 &&
            Math.abs(xc - gaugeLengthM) < 1e-6) ||
          (ya < 1e-6 && yb < 1e-6 && yc < 1e-6) ||
          (Math.abs(ya - heightM) < 1e-6 && Math.abs(yb - heightM) < 1e-6 && Math.abs(yc - heightM) < 1e-6) ||
          (za < 1e-6 && zb < 1e-6 && zc < 1e-6) ||
          (Math.abs(za - depthM) < 1e-6 && Math.abs(zb - depthM) < 1e-6 && Math.abs(zc - depthM) < 1e-6);
        if (!onBoundary) continue;

        const u0: [number, number, number] = [xa * scaleToMm, za * scaleToMm, ya * scaleToMm];
        const u1: [number, number, number] = [xb * scaleToMm, zb * scaleToMm, yb * scaleToMm];
        const u2: [number, number, number] = [xc * scaleToMm, zc * scaleToMm, yc * scaleToMm];

        const dxa = (feaStep.displacements[ia * 3] ?? 0) * scaleToMm * defScale;
        const dya = (feaStep.displacements[ia * 3 + 1] ?? 0) * scaleToMm * defScale;
        const dza = (feaStep.displacements[ia * 3 + 2] ?? 0) * scaleToMm * defScale;
        const dxb = (feaStep.displacements[ib * 3] ?? 0) * scaleToMm * defScale;
        const dyb = (feaStep.displacements[ib * 3 + 1] ?? 0) * scaleToMm * defScale;
        const dzb = (feaStep.displacements[ib * 3 + 2] ?? 0) * scaleToMm * defScale;
        const dxc = (feaStep.displacements[ic * 3] ?? 0) * scaleToMm * defScale;
        const dyc = (feaStep.displacements[ic * 3 + 1] ?? 0) * scaleToMm * defScale;
        const dzc = (feaStep.displacements[ic * 3 + 2] ?? 0) * scaleToMm * defScale;

        undeformedTriangles.push({ v0: u0, v1: u1, v2: u2, normal: [0, 0, 1], scalar: elemVmMpa });
        deformedTriangles.push({
          v0: [u0[0] + dxa, u0[1] + dza, u0[2] + dya],
          v1: [u1[0] + dxb, u1[1] + dzb, u1[2] + dyb],
          v2: [u2[0] + dxc, u2[1] + dzc, u2[2] + dyc],
          normal: [0, 0, 1],
          scalar: elemVmMpa,
        });
      }
    }

    const fixedPinCoords: [number, number, number][] = [];
    for (const nId of fixedNodes as Set<number>) {
      if (fixedPinCoords.length >= 9) break;
      fixedPinCoords.push([
        (tetMesh.nodeCoords[nId * 3] ?? 0) * scaleToMm,
        (tetMesh.nodeCoords[nId * 3 + 2] ?? 0) * scaleToMm,
        (tetMesh.nodeCoords[nId * 3 + 1] ?? 0) * scaleToMm,
      ]);
    }
    const loadArrowCoords: { origin: [number, number, number]; dir: [number, number, number] }[] = [];
    for (const nId of lugNodes) {
      if (loadArrowCoords.length >= 6) break;
      loadArrowCoords.push({
        origin: [
          (tetMesh.nodeCoords[nId * 3] ?? 0) * scaleToMm,
          (tetMesh.nodeCoords[nId * 3 + 2] ?? 0) * scaleToMm,
          (tetMesh.nodeCoords[nId * 3 + 1] ?? 0) * scaleToMm,
        ],
        dir: [0, 0, -1],
      });
    }

    const [sysmlVis, moVis, cadVis, feaVis]: [PaneVisualData, PaneVisualData, PaneVisualData, PaneVisualData] = [
      {
        kind: "sysml-bdd",
        packageName: "ActuatorArchitecture",
        partName: "ClevisBracket",
        partAttributes: [
          { name: "mass", value: effectiveMassKg.toFixed(2), unit: "kg", sourceHint: "<- CAD::MountingBracket" },
          { name: "peak_thrust", value: peakThrustKn.toFixed(1), unit: "kN", sourceHint: "<- Modelica::FlightControl" },
          {
            name: "von_mises_stress",
            value: effectiveVonMises.toFixed(1),
            unit: "MPa",
            sourceHint: "<- FEA::BracketStress",
          },
          {
            name: "tip_deflection",
            value: effectiveDeflection.toFixed(2),
            unit: "mm",
            sourceHint: "<- FEA::BracketStress",
          },
        ],
        requirementId: "REQ_ACTUATOR_01",
        subjectName: "bracket",
        subjectType: "ClevisBracket",
        constraints: [
          {
            expression: "bracket.mass <= max_mass",
            actualText: `${effectiveMassKg.toFixed(2)} kg`,
            limitText: `<= ${maxMass.toFixed(2)} kg`,
            isSat: massSat,
          },
          {
            expression: "bracket.von_mises_stress <= max_von_mises",
            actualText: `${effectiveVonMises.toFixed(1)} MPa`,
            limitText: `<= ${maxVonMises.toFixed(1)} MPa`,
            isSat: stressSat,
          },
          {
            expression: "bracket.tip_deflection <= max_deflection",
            actualText: `${effectiveDeflection.toFixed(2)} mm`,
            limitText: `<= ${maxDeflection.toFixed(2)} mm`,
            isSat: deflSat,
          },
        ],
      },
      {
        kind: "modelica-dae",
        withinPkg: "FlightControl",
        modelName: "ElectroMechanicalActuator",
        parameters: [
          { name: "stall_torque", value: stallTorque.toFixed(1), unit: "N·m" },
          { name: "lead_pitch", value: leadPitch.toFixed(4), unit: "m/rev" },
          { name: "efficiency", value: efficiency.toFixed(2), unit: "-" },
          {
            name: "bracket_mass",
            value: effectiveMassKg.toFixed(2),
            unit: "kg",
            twinFqn: "SysML2::ActuatorArchitecture::ClevisBracket.mass",
          },
        ],
        equations: [
          {
            lhs: "peak_thrust_kN",
            rhs: moEq.rhsExpression,
            resultText: `${peakThrustKn.toFixed(1)} kN`,
            twinFqn: "SysML2::ActuatorArchitecture::ClevisBracket.peak_thrust",
          },
        ],
      },
      {
        kind: "scad-3d",
        moduleName: "ActuatorBracket",
        triangles: scadData.triangles,
        bboxMin: scadData.bboxMin,
        bboxMax: scadData.bboxMax,
        volumeMm3: scadData.volumeMm3,
        surfaceAreaMm2: scadData.surfaceAreaMm2,
        computedMassKg: effectiveMassKg,
        ports: [
          {
            portName: "fixed_root",
            portType: scadData.portTags.get("fixed_root")?.portType ?? "encastre",
            normal: scadData.portTags.get("fixed_root")?.normal ?? [-1, 0, 0],
            anchor: [0, webWidth / 2, flangeThickness],
            boundToCae: scadData.portTags.has("fixed_root"),
            caeTarget: "FEA::BracketStress::*BOUNDARY(fixed_root, 1..6)",
          },
          {
            portName: "clevis_lug",
            portType: scadData.portTags.get("clevis_lug")?.portType ?? "bearing_load",
            normal: scadData.portTags.get("clevis_lug")?.normal ?? [0, 0, -1],
            anchor: [lugSpan - 22, webWidth / 2, flangeThickness],
            boundToCae: scadData.portTags.has("clevis_lug"),
            caeTarget: `FEA::BracketStress::*CLOAD(clevis_lug, 3, ${appliedLoadN.toFixed(0)} N)`,
          },
        ],
        csgTree: scadData.csgTree,
      },
      {
        kind: "fea-3d",
        materialName: feaMat?.name ?? "AL7075_T6",
        youngsModulusGpa: Number((youngsModulusMpa / 1000).toFixed(1)),
        poissonsRatio,
        densityKgM3: density,
        meshSourceFile,
        numNodes: tetMesh.numNodes,
        numElements: tetMesh.numElements,
        minJacobian: Number(meshQuality.minJacobian.toFixed(2)),
        appliedLoadN,
        maxVonMisesMpa: effectiveVonMises,
        allowableVonMisesMpa: maxVonMises,
        maxDeflectionMm: effectiveDeflection,
        allowableDeflectionMm: maxDeflection,
        undeformedTriangles,
        deformedTriangles,
        fixedPinCoords,
        loadArrowCoords,
        bboxMin: [0, 0, 0],
        bboxMax: [gaugeLengthM * scaleToMm, depthM * scaleToMm, heightM * scaleToMm],
      },
    ];
    paneVisuals[sysmlIdx] = sysmlVis;
    paneVisuals[moIdx] = moVis;
    paneVisuals[cadIdx] = cadVis;
    paneVisuals[feaIdx] = feaVis;
    return { meshSourceSummary, paneVisuals };
  }

  function evaluateEvBatteryColdplatePipeline(ctx: CoordinatorPipelineContext): CoordinatorPipelineResult {
    const {
      codes,
      roleIndex,
      editedPaneIndex,
      paneDiagnostics,
      coordinator,
      caeOracle,
      variableLinks,
      conflicts,
      portBindings,
      evaluatedEquations,
      getSysmlAttrOrBound,
    } = ctx;
    const sysmlIdx = roleIndex.sysml >= 0 ? roleIndex.sysml : 0;
    const moIdx = roleIndex.modelica >= 0 ? roleIndex.modelica : 1;
    const cadIdx = roleIndex.scad >= 0 ? roleIndex.scad : 2;
    const cfdIdx = roleIndex.cfd >= 0 ? roleIndex.cfd : 3;
    let meshSourceSummary = "";
    const paneVisuals = new Array<PaneVisualData>(4) as [
      PaneVisualData,
      PaneVisualData,
      PaneVisualData,
      PaneVisualData,
    ];
    // 1. Read SysML v2 thermal safety contract from WASM GLR CST (SysML2::BatteryThermal::REQ_THERMAL_02)
    const maxCellTempK = getSysmlAttrOrBound("max_cell_temp_K", "max_surface_temp", 318.15);
    const maxPressureDropKpa = getSysmlAttrOrBound("max_pressure_drop_kPa", "pressure_drop", 18.0);
    const minFlowRateLpm = getSysmlAttrOrBound("min_flow_rate_lpm", "coolant_flow", 8.0);

    // 2. Evaluate Modelica electro-thermal `equation` dynamically via `evaluateCfdExpression`
    const moEq = evaluateModelicaOutputEquation(providers, codes[moIdx]!, "heat_rejection_W", 1433.6);
    const packCurrent = Math.max(10, moEq.paramMap.get("pack_current") ?? 320.0);
    const internalRes = Math.max(0.001, moEq.paramMap.get("internal_res") ?? 0.014);
    const coolantFlowLpm = Math.max(
      1.0,
      moEq.paramMap.get("coolant_flow_lpm") ?? extractModelicaBindingNumber(codes[moIdx]!, "coolant_flow_lpm", 14.0),
    );
    const heatRejectionW = Number(moEq.value.toFixed(1));

    evaluatedEquations.push({
      paneIndex: moIdx,
      fileName: "BatteryPackLoop.mo",
      language: "Modelica",
      lhs: "heat_rejection_W",
      rhsExpression: moEq.rhsExpression,
      evaluatedValue: heatRejectionW,
      unit: "W",
    });

    codes[moIdx] = updateModelicaBindingViaCst(codes[moIdx]!, "heat_rejection_W", heatRejectionW.toFixed(1));

    // 3. Evaluate OpenSCAD cold-plate micro-channel geometry live via `evaluateScad`
    const scadData = buildScadVisualTrianglesAndTree(providers, codes[cadIdx]!);
    const scadVars = scadData.evalRes.variables;
    const channelWidthMm = Math.max(
      0.5,
      typeof scadVars.channel_width_mm === "number" ? scadVars.channel_width_mm : 4.2,
    );
    const channelDepthMm = Math.max(
      0.5,
      typeof scadVars.channel_depth_mm === "number" ? scadVars.channel_depth_mm : 3.0,
    );
    const channelCount = Math.max(
      2,
      Math.round(typeof scadVars.channel_count === "number" ? scadVars.channel_count : 12),
    );
    const rawHydraulicDia =
      typeof scadVars.hydraulic_dia_mm === "number" && Number.isFinite(scadVars.hydraulic_dia_mm)
        ? scadVars.hydraulic_dia_mm
        : (2 * channelWidthMm * channelDepthMm) / (channelWidthMm + channelDepthMm);
    const hydraulicDiaMm = Number(rawHydraulicDia.toFixed(2));
    const rawFlowAreaMm2 =
      typeof scadVars.flow_area_mm2 === "number" && Number.isFinite(scadVars.flow_area_mm2)
        ? scadVars.flow_area_mm2
        : channelCount * channelWidthMm * channelDepthMm;
    const flowAreaMm2 = Number(rawFlowAreaMm2.toFixed(1));

    const dhSpan = findScadVarValueSpan(codes[cadIdx]!, "hydraulic_dia_mm");
    evaluatedEquations.push({
      paneIndex: cadIdx,
      fileName: "ColdPlateChannels.scad",
      language: "OpenSCAD",
      lhs: "hydraulic_dia_mm",
      rhsExpression: dhSpan
        ? codes[cadIdx]!.slice(dhSpan.start, dhSpan.end).trim()
        : "(2 * channel_width_mm * channel_depth_mm) / (channel_width_mm + channel_depth_mm)",
      evaluatedValue: hydraulicDiaMm,
      unit: "mm",
    });

    // 4. Parse OpenFOAM `.cfd` dictionary via `@modelscript/cfd`'s `OpenFoamDialect`
    const cfdDoc = new OpenFoamDialect().parse(codes[cfdIdx]!);
    const geomSource =
      String(getOpenFoamDirectiveValue(cfdDoc.directives, "geometry.ColdPlateChannels.scad.source") ?? "").replace(
        /^"|"$/g,
        "",
      ) || "CAD::ColdPlateChannels::SerpentineColdPlate";
    meshSourceSummary = `geometry { ColdPlateChannels.scad (${geomSource}) } -> LbmVoxelizer (20×10×8 D3Q19)`;

    // Verify every OpenFOAM boundaryField patch against OpenSCAD `tag_port(...)` declarations
    const markerKeys: string[] =
      cfdDoc.markers instanceof Map
        ? (Array.from(cfdDoc.markers.keys()) as string[])
        : Array.isArray(cfdDoc.markers)
          ? (cfdDoc.markers as string[])
          : [];
    const expectedPatches: string[] =
      markerKeys.length > 0 ? markerKeys : ["coolant_inlet", "fluid_core", "coolant_outlet"];
    for (const patchName of expectedPatches) {
      const cadPort = scadData.portTags.get(patchName);
      const patchType = String(
        getOpenFoamDirectiveValue(cfdDoc.directives, `boundaryField.${patchName}.type`) ?? "patch",
      );
      const caePos = findOpenFoamPatchLineCol(codes[cfdIdx]!, patchName);
      const isBound = cadPort !== undefined;
      portBindings.push({
        portName: patchName,
        cadPortType: cadPort?.portType ?? "MISSING_TAG_PORT",
        cadNormal: cadPort?.normal ?? [0, 0, 0],
        cadFileName: "ColdPlateChannels.scad",
        cadLine: cadPort?.line ?? 1,
        caeFileName: "CoolantManifold.cfd",
        caeTargetKind: "OpenFOAM boundaryField",
        caePatchSpec: `boundaryField.${patchName} { type ${patchType}; }`,
        caeLine: caePos.startLine,
        isBound,
      });
      if (!isBound) {
        const msg = `[MSC-PORT-UNBOUND] OpenFOAM boundaryField patch '${patchName}' (type ${patchType}) has no matching tag_port("${patchName}", ...) in ColdPlateChannels.scad (${geomSource}).`;
        paneDiagnostics[cadIdx]!.push({
          startLine: 1,
          startCol: 1,
          endLine: 1,
          endCol: 32,
          severity: "error",
          code: "MSC-PORT-UNBOUND",
          message: msg,
        });
        paneDiagnostics[cfdIdx]!.push({
          ...caePos,
          severity: "error",
          code: "MSC-PORT-UNBOUND",
          message: msg,
        });
        conflicts.push({
          literals: [],
          explanation: msg,
          culpritEntities: [
            `CAD::ColdPlateChannels::port.${patchName}`,
            `CFD::CoolantManifold::boundaryField.${patchName}`,
          ],
          theoryName: "SpatialPhysicsOracle",
        });
      }
    }

    // 5. Live 3D Lattice-Boltzmann D3Q19 Voxelization & Fluid Solve (LbmVoxelizer + WebGPULbmRunner)
    // Read fluid properties from OpenFOAM `thermoFluidProperties` & `boundaryField` dictionaries
    const fluidRho = Number(
      getOpenFoamDirectiveValue(cfdDoc.directives, "thermoFluidProperties.density_kg_m3") ?? 1060.0,
    );
    const fluidCp = Number(
      getOpenFoamDirectiveValue(cfdDoc.directives, "thermoFluidProperties.specificHeat_J_kgK") ?? 3450.0,
    );
    const fluidMu = Number(
      getOpenFoamDirectiveValue(cfdDoc.directives, "thermoFluidProperties.viscosity_Pa_s") ?? 0.00297,
    );
    const fluidK = Number(
      getOpenFoamDirectiveValue(cfdDoc.directives, "thermoFluidProperties.conductivity_W_mK") ?? 0.42,
    );
    const inletTempK = Number(
      getOpenFoamDirectiveValue(cfdDoc.directives, "boundaryField.coolant_inlet.inletTemp_K") ?? 298.15,
    );

    const channelAreaM2 = Math.max(1e-6, flowAreaMm2 * 1e-6);
    const meanInletVelMs = Math.min(4.8, Math.max(0.2, coolantFlowLpm / 60000 / channelAreaM2));
    const lbmConfig = {
      nx: 20,
      ny: 10,
      nz: 8,
      dx: (hydraulicDiaMm * 1e-3) / 4,
      dt: 5e-5,
      tau: 0.65,
      density: fluidRho,
      inletVelocity: [meanInletVelMs, 0.0, 0.0] as [number, number, number],
    };
    const finBlockage = Math.min(0.68, Math.max(0.18, 2.0 / (channelWidthMm + 2.0)));
    const cellGrid = LbmVoxelizer.voxelize(lbmConfig, {
      boxes: [
        {
          min: [0.3, 0.5 - finBlockage * 0.4, 0.2],
          max: [0.7, 0.5 + finBlockage * 0.4, 0.8],
        },
      ],
    });
    const lbmRunner = new WebGPULbmRunner(lbmConfig, cellGrid);
    const lbmRes = lbmRunner.step(8);

    // First-principles Darcy-Weisbach & Dittus-Boelter convective energy balance coupled with LBM constriction field
    const passLengthM = Math.max(0.08, (scadData.bboxMax[0] - scadData.bboxMin[0] - 28.0) * 1e-3);
    const dhM = hydraulicDiaMm * 1e-3;
    const passAreaM2 = Math.max(1e-7, channelAreaM2 / channelCount);
    const nParallelBanks = 4.0;
    const passesPerBank = channelCount / nParallelBanks;
    const uSerpMs = coolantFlowLpm / 60000 / (nParallelBanks * passAreaM2);
    const reynolds = Math.max(50.0, (fluidRho * uSerpMs * dhM) / fluidMu);
    const prandtl = (fluidMu * fluidCp) / fluidK;
    const darcyF = 0.3164 / Math.pow(reynolds, 0.25) + 64.0 / reynolds;
    const lbmConstrictionRatio = Math.max(1.0, lbmRes.maxVelocity / Math.max(0.1, meanInletVelMs));
    const dynamicHeadPa = 0.5 * fluidRho * uSerpMs * uSerpMs;
    const darcyDropPa =
      passesPerBank * ((darcyF * (passLengthM / dhM) + 0.12 * lbmConstrictionRatio) / nParallelBanks) * dynamicHeadPa;
    const computedPressureDropKpa = Number(((lbmRes.pressureDropPa * 0.4 + darcyDropPa) * 1e-3).toFixed(1));

    const massFlowKgS = fluidRho * (coolantFlowLpm / 60000);
    const nusselt = 0.023 * Math.pow(reynolds, 0.8) * Math.pow(prandtl, 0.3);
    const hConv = (nusselt * fluidK) / dhM;
    const wettedAreaM2 = channelCount * (channelWidthMm + 2.0 * channelDepthMm) * 1e-3 * passLengthM;
    const deltaTBulkK = heatRejectionW / (massFlowKgS * fluidCp);
    const deltaTConvK = heatRejectionW / (hConv * wettedAreaM2);
    const computedMaxTempK = Number((inletTempK + deltaTBulkK + deltaTConvK).toFixed(1));

    if (editedPaneIndex !== cfdIdx) {
      codes[cfdIdx] = updateOpenFoamScalar(codes[cfdIdx]!, "volumetricFlowRate", coolantFlowLpm.toFixed(1));
      codes[cfdIdx] = updateOpenFoamScalar(codes[cfdIdx]!, "qWall", heatRejectionW.toFixed(1));
      codes[cfdIdx] = updateOpenFoamScalar(codes[cfdIdx]!, "Dh", hydraulicDiaMm.toFixed(2));
      codes[cfdIdx] = updateOpenFoamScalar(codes[cfdIdx]!, "inletFlowRate", coolantFlowLpm.toFixed(1));
      codes[cfdIdx] = updateOpenFoamScalar(codes[cfdIdx]!, "wallHeatLoad", heatRejectionW.toFixed(1));
      codes[cfdIdx] = updateOpenFoamScalar(codes[cfdIdx]!, "hydraulicDiameter", hydraulicDiaMm.toFixed(2));
      codes[cfdIdx] = updateOpenFoamScalar(codes[cfdIdx]!, "pressureDrop_kPa", computedPressureDropKpa.toFixed(1));
      codes[cfdIdx] = updateOpenFoamScalar(codes[cfdIdx]!, "maxSurfaceTemp_K", computedMaxTempK.toFixed(1));
    }

    const effectiveDeltaPKpa = extractOpenFoamScalar(codes[cfdIdx]!, "pressureDrop_kPa", computedPressureDropKpa);
    const effectiveMaxTempK = extractOpenFoamScalar(codes[cfdIdx]!, "maxSurfaceTemp_K", computedMaxTempK);

    // Sync SysML v2 part def ColdPlateManifold attributes
    codes[sysmlIdx] = updateSysmlAttrViaCst(codes[sysmlIdx]!, "max_surface_temp", effectiveMaxTempK.toFixed(1));
    codes[sysmlIdx] = updateSysmlAttrViaCst(codes[sysmlIdx]!, "pressure_drop", effectiveDeltaPKpa.toFixed(1));
    codes[sysmlIdx] = updateSysmlAttrViaCst(codes[sysmlIdx]!, "coolant_flow", coolantFlowLpm.toFixed(1));
    codes[sysmlIdx] = updateSysmlAttrViaCst(codes[sysmlIdx]!, "heat_load", heatRejectionW.toFixed(1));

    // 6. Assert into Oracles
    caeOracle.assertCfdAerodynamicContract({
      partName: "BatteryThermal::ColdPlateManifold",
      contractId: "BatteryThermal::REQ_THERMAL_02",
      pressureDropPa: effectiveDeltaPKpa * 1000,
      maxPressureDropPa: maxPressureDropKpa * 1000,
      sysmlRequirementId: "BatteryThermal::REQ_THERMAL_02",
    });
    caeOracle.assertContract({
      contractId: "BatteryThermal::REQ_THERMAL_02_Temp",
      metricName: "ColdPlateManifold.max_surface_temp",
      actualValue: effectiveMaxTempK,
      threshold: maxCellTempK,
      operator: "<=",
      unit: "K",
      partName: "BatteryThermal::ColdPlateManifold",
      sysmlRequirementId: "BatteryThermal::REQ_THERMAL_02",
    });

    coordinator.enqueueEvent({
      kind: "equality",
      varA: "Modelica::Powertrain.BatteryPackLoop.heat_rejection_W",
      varB: "CFD::CoolantManifold::thermoFluidProperties.wallHeatLoad",
      domain: "real",
      bounds: [heatRejectionW, heatRejectionW],
      explanation: "Joule heating I²R coupled via annotation(twin) & boundaryField.fluid_core.qWall",
      sourceOracle: "DynamicSimulationOracle",
    });
    coordinator.enqueueEvent({
      kind: "equality",
      varA: "CAD::ColdPlateChannels::hydraulic_dia_mm",
      varB: "CFD::CoolantManifold::thermoFluidProperties.hydraulicDiameter",
      domain: "real",
      bounds: [hydraulicDiaMm, hydraulicDiaMm],
      explanation: 'evaluateScad() hydraulic_dia_mm on tag_port("fluid_core") <-> OpenFOAM boundaryField',
      sourceOracle: "SpatialPhysicsOracle",
    });

    const tempSat = effectiveMaxTempK <= maxCellTempK;
    const dpSat = effectiveDeltaPKpa <= maxPressureDropKpa;
    const flowSat = coolantFlowLpm >= minFlowRateLpm;

    variableLinks.push(
      {
        symbol: "ColdPlateManifold.heat_load",
        canonicalFqn: "SysML2::BatteryThermal::ColdPlateManifold.heat_load",
        bindingMechanism: 'annotation(twin = "...") + boundaryField.fluid_core.qWall',
        label: "Joule Heat Load (I²R)",
        valueFormatted: `${heatRejectionW.toFixed(1)} W`,
        boundsFormatted: `I = ${packCurrent.toFixed(0)} A`,
        unit: "W",
        sourceDomain: "Modelica",
        targetDomains: ["OpenFOAM CFD", "SysML v2"],
        domainBindings: [
          {
            domainLabel: "Modelica",
            fqn: "Powertrain.BatteryPackLoop.heat_rejection_W",
            bindingSyntax: 'annotation(twin = "SysML2::...::ColdPlateManifold.heat_load")',
            valueText: `${heatRejectionW.toFixed(1)} W`,
          },
          {
            domainLabel: "OpenFOAM",
            fqn: "CFD::CoolantManifold::boundaryField.fluid_core.qWall",
            bindingSyntax: "@twin <- Powertrain.BatteryPackLoop.heat_rejection_W",
            valueText: `${heatRejectionW.toFixed(1)} W`,
          },
        ],
        oracleName: "DynamicSimulationOracle",
        status: "SAT",
        marginText: `Coupled to patch fluid_core`,
      },
      {
        symbol: "ColdPlateChannels.hydraulic_dia_mm",
        canonicalFqn: "CAD::ColdPlateChannels::hydraulic_dia_mm",
        bindingMechanism: 'tag_port("fluid_core") <-> geometry { ColdPlateChannels.scad }',
        label: "Channel Hydraulic Dia D_h",
        valueFormatted: `${hydraulicDiaMm.toFixed(2)} mm`,
        boundsFormatted: `${channelWidthMm}×${channelDepthMm} mm (${channelCount} ch)`,
        unit: "mm",
        sourceDomain: "OpenSCAD CAD",
        targetDomains: ["OpenFOAM CFD"],
        domainBindings: [
          {
            domainLabel: "OpenSCAD",
            fqn: "CAD::ColdPlateChannels::hydraulic_dia_mm",
            bindingSyntax: 'evaluateScad() + tag_port("fluid_core")',
            valueText: `${hydraulicDiaMm.toFixed(2)} mm (A=${flowAreaMm2.toFixed(0)} mm²)`,
          },
          {
            domainLabel: "OpenFOAM",
            fqn: "CFD::CoolantManifold::boundaryField.fluid_core.Dh",
            bindingSyntax: "geometry.ColdPlateChannels.scad + LbmVoxelizer",
            valueText: `${cellGrid.length} D3Q19 cells (${expectedPatches.length} patches)`,
          },
        ],
        oracleName: "SpatialPhysicsOracle",
        status: portBindings.every((p) => p.isBound) ? "SAT" : "UNSAT",
        marginText: `3 tag_port patches bound to OpenFOAM`,
      },
      {
        symbol: "ColdPlateManifold.max_surface_temp",
        canonicalFqn: "SysML2::BatteryThermal::ColdPlateManifold.max_surface_temp",
        bindingMechanism: "solverSummary.maxSurfaceTemp_K -> subject manifold.max_surface_temp",
        label: "Peak Cell Surface Temp",
        valueFormatted: `${effectiveMaxTempK.toFixed(1)} K`,
        boundsFormatted: `<= ${maxCellTempK.toFixed(2)} K`,
        unit: "K",
        sourceDomain: "OpenFOAM CFD",
        targetDomains: ["SysML v2", "Modelica"],
        domainBindings: [
          {
            domainLabel: "OpenFOAM",
            fqn: "CFD::CoolantManifold::solverSummary.maxSurfaceTemp_K",
            bindingSyntax: "@twin -> ColdPlateManifold.max_surface_temp",
            valueText: `${effectiveMaxTempK.toFixed(1)} K`,
          },
          {
            domainLabel: "SysML v2",
            fqn: "BatteryThermal::REQ_THERMAL_02::manifold.max_surface_temp",
            bindingSyntax: "manifold.max_surface_temp <= max_cell_temp_K",
            valueText: `<= ${maxCellTempK.toFixed(2)} K`,
          },
        ],
        oracleName: "CaeContractOracle",
        status: tempSat ? "SAT" : "UNSAT",
        marginText: tempSat
          ? `${(maxCellTempK - effectiveMaxTempK).toFixed(1)} K below runaway limit`
          : `+${(effectiveMaxTempK - maxCellTempK).toFixed(1)} K thermal exceedance`,
      },
      {
        symbol: "ColdPlateManifold.pressure_drop",
        canonicalFqn: "SysML2::BatteryThermal::ColdPlateManifold.pressure_drop",
        bindingMechanism: "solverSummary.pressureDrop_kPa -> subject manifold.pressure_drop",
        label: "Manifold Pressure Drop ΔP",
        valueFormatted: `${effectiveDeltaPKpa.toFixed(1)} kPa`,
        boundsFormatted: `<= ${maxPressureDropKpa.toFixed(1)} kPa`,
        unit: "kPa",
        sourceDomain: "OpenFOAM CFD",
        targetDomains: ["SysML v2", "OpenSCAD CAD"],
        domainBindings: [
          {
            domainLabel: "Modelica",
            fqn: "Powertrain.BatteryPackLoop.coolant_flow_lpm",
            bindingSyntax: 'annotation(twin = "SysML2::...::ColdPlateManifold.coolant_flow")',
            valueText: `${coolantFlowLpm.toFixed(1)} L/min`,
          },
          {
            domainLabel: "OpenFOAM",
            fqn: "CFD::CoolantManifold::solverSummary.pressureDrop_kPa",
            bindingSyntax: "WebGPULbmRunner.step(8).pressureDropPa",
            valueText: `${effectiveDeltaPKpa.toFixed(1)} kPa (u_max=${lbmRes.maxVelocity.toFixed(2)} m/s)`,
          },
          {
            domainLabel: "SysML v2",
            fqn: "BatteryThermal::REQ_THERMAL_02::manifold.pressure_drop",
            bindingSyntax: "manifold.pressure_drop <= max_pressure_drop_kPa",
            valueText: `<= ${maxPressureDropKpa.toFixed(1)} kPa`,
          },
        ],
        oracleName: "CaeContractOracle",
        status: dpSat && flowSat ? "SAT" : "UNSAT",
        marginText: !flowSat
          ? `Flow ${coolantFlowLpm.toFixed(1)} < ${minFlowRateLpm.toFixed(1)} L/min`
          : dpSat
            ? `${(((maxPressureDropKpa - effectiveDeltaPKpa) / maxPressureDropKpa) * 100).toFixed(1)}% pump margin`
            : `+${(effectiveDeltaPKpa - maxPressureDropKpa).toFixed(1)} kPa over pump head`,
      },
    );

    if (!tempSat) {
      const posSysml = findSysmlConstraintLineCol(codes[sysmlIdx]!, "manifold.max_surface_temp");
      const posCfd = findOpenFoamKeyLineCol(codes[cfdIdx]!, "maxSurfaceTemp_K");
      const msg = `[MSC-THEORY-CONFLICT] CaeContractOracle: 'CFD::CoolantManifold::solverSummary.maxSurfaceTemp_K' (${effectiveMaxTempK.toFixed(1)} K) exceeds 'SysML2::BatteryThermal::REQ_THERMAL_02.max_cell_temp_K' (${maxCellTempK.toFixed(2)} K) under ${heatRejectionW.toFixed(0)} W heat load.`;
      paneDiagnostics[sysmlIdx]!.push({ ...posSysml, severity: "error", code: "MSC-CFD-TEMP", message: msg });
      paneDiagnostics[cfdIdx]!.push({ ...posCfd, severity: "error", code: "MSC-CFD-TEMP", message: msg });
      conflicts.push({
        literals: [],
        explanation: msg,
        culpritEntities: [
          "CFD::CoolantManifold::solverSummary.maxSurfaceTemp_K",
          "Modelica::Powertrain.BatteryPackLoop.pack_current",
          "SysML2::BatteryThermal::REQ_THERMAL_02.max_cell_temp_K",
        ],
        theoryName: "CaeContractOracle",
      });
    }

    if (!dpSat) {
      const posSysml = findSysmlConstraintLineCol(codes[sysmlIdx]!, "manifold.pressure_drop");
      const posCad = findScadVarLineCol(codes[cadIdx]!, "channel_width_mm");
      const posCfd = findOpenFoamKeyLineCol(codes[cfdIdx]!, "pressureDrop_kPa");
      const msg = `[MSC-THEORY-CONFLICT] CaeContractOracle: 'CFD::CoolantManifold::solverSummary.pressureDrop_kPa' (${effectiveDeltaPKpa.toFixed(1)} kPa) violates 'SysML2::BatteryThermal::REQ_THERMAL_02.max_pressure_drop_kPa' (<= ${maxPressureDropKpa.toFixed(1)} kPa) for D_h = ${hydraulicDiaMm.toFixed(2)} mm.`;
      paneDiagnostics[sysmlIdx]!.push({ ...posSysml, severity: "error", code: "MSC-CFD-DP", message: msg });
      paneDiagnostics[cadIdx]!.push({
        ...posCad,
        severity: "warning",
        code: "MSC-CFD-DP",
        message: `Narrow channel width (${channelWidthMm} mm) in CAD::ColdPlateChannels restricts D_h to ${hydraulicDiaMm.toFixed(2)} mm.`,
      });
      paneDiagnostics[cfdIdx]!.push({ ...posCfd, severity: "error", code: "MSC-CFD-DP", message: msg });
      conflicts.push({
        literals: [],
        explanation: msg,
        culpritEntities: [
          "CFD::CoolantManifold::solverSummary.pressureDrop_kPa",
          "CAD::ColdPlateChannels::channel_width_mm",
          "SysML2::BatteryThermal::REQ_THERMAL_02.max_pressure_drop_kPa",
        ],
        theoryName: "CaeContractOracle",
      });
    }

    if (!flowSat) {
      const posSysml = findSysmlConstraintLineCol(codes[sysmlIdx]!, "manifold.coolant_flow");
      const posMo = findModelicaComponentLineCol(codes[moIdx]!, "coolant_flow_lpm");
      const msg = `[MSC-THEORY-CONFLICT] ConstraintTheoryOracle: 'Modelica::Powertrain.BatteryPackLoop.coolant_flow_lpm' (${coolantFlowLpm.toFixed(1)} L/min) is below 'SysML2::BatteryThermal::REQ_THERMAL_02.min_flow_rate_lpm' (>= ${minFlowRateLpm.toFixed(1)} L/min).`;
      paneDiagnostics[sysmlIdx]!.push({ ...posSysml, severity: "error", code: "MSC-FLOW-MIN", message: msg });
      paneDiagnostics[moIdx]!.push({ ...posMo, severity: "error", code: "MSC-FLOW-MIN", message: msg });
      conflicts.push({
        literals: [],
        explanation: msg,
        culpritEntities: [
          "Modelica::Powertrain.BatteryPackLoop.coolant_flow_lpm",
          "SysML2::BatteryThermal::REQ_THERMAL_02.min_flow_rate_lpm",
        ],
        theoryName: "ConstraintTheoryOracle",
      });
    }

    // Extract mid-plane z=4 slice of the D3Q19 LBM grid for 3D/2D field visualization
    const sliceZ = Math.floor(lbmConfig.nz / 2);
    const lbmCells: Cfd3DVisualData["cells"] = [];
    for (let iy = 0; iy < lbmConfig.ny; iy++) {
      for (let ix = 0; ix < lbmConfig.nx; ix++) {
        const idx = ix + lbmConfig.nx * (iy + lbmConfig.ny * sliceZ);
        const isSolid = cellGrid[idx] === 1;
        const ux = lbmRunner.vx[idx] ?? 0;
        const uy = lbmRunner.vy[idx] ?? 0;
        const uz = lbmRunner.vz[idx] ?? 0;
        const uMag = Math.sqrt(ux * ux + uy * uy + uz * uz);
        const xFrac = ix / Math.max(1, lbmConfig.nx - 1);
        const pKpa = Number((effectiveDeltaPKpa * (1 - xFrac)).toFixed(2));
        const tK = Number((298.15 + (effectiveMaxTempK - 298.15) * (isSolid ? 1.0 : 0.25 + 0.75 * xFrac)).toFixed(1));
        lbmCells.push({
          ix,
          iy,
          isSolid,
          velocityMagMs: Number(uMag.toFixed(2)),
          pressureKpa: pKpa,
          tempK: tK,
        });
      }
    }

    const totalPlateWidthMm = channelCount * (channelWidthMm + 2.0);
    const [sysmlVis, moVis, cadVis, cfdVis]: [PaneVisualData, PaneVisualData, PaneVisualData, PaneVisualData] = [
      {
        kind: "sysml-bdd",
        packageName: "BatteryThermal",
        partName: "ColdPlateManifold",
        partAttributes: [
          {
            name: "max_surface_temp",
            value: effectiveMaxTempK.toFixed(1),
            unit: "K",
            sourceHint: "<- CFD::CoolantManifold",
          },
          {
            name: "pressure_drop",
            value: effectiveDeltaPKpa.toFixed(1),
            unit: "kPa",
            sourceHint: "<- CFD::CoolantManifold",
          },
          {
            name: "coolant_flow",
            value: coolantFlowLpm.toFixed(1),
            unit: "L/min",
            sourceHint: "<- Modelica::Powertrain",
          },
          { name: "heat_load", value: heatRejectionW.toFixed(1), unit: "W", sourceHint: "<- Modelica::Powertrain" },
        ],
        requirementId: "REQ_THERMAL_02",
        subjectName: "manifold",
        subjectType: "ColdPlateManifold",
        constraints: [
          {
            expression: "manifold.max_surface_temp <= max_cell_temp_K",
            actualText: `${effectiveMaxTempK.toFixed(1)} K`,
            limitText: `<= ${maxCellTempK.toFixed(2)} K`,
            isSat: tempSat,
          },
          {
            expression: "manifold.pressure_drop <= max_pressure_drop_kPa",
            actualText: `${effectiveDeltaPKpa.toFixed(1)} kPa`,
            limitText: `<= ${maxPressureDropKpa.toFixed(1)} kPa`,
            isSat: dpSat,
          },
          {
            expression: "manifold.coolant_flow >= min_flow_rate_lpm",
            actualText: `${coolantFlowLpm.toFixed(1)} L/min`,
            limitText: `>= ${minFlowRateLpm.toFixed(1)} L/min`,
            isSat: flowSat,
          },
        ],
      },
      {
        kind: "modelica-dae",
        withinPkg: "Powertrain",
        modelName: "BatteryPackLoop",
        parameters: [
          { name: "pack_current", value: packCurrent.toFixed(1), unit: "A" },
          { name: "internal_res", value: internalRes.toFixed(3), unit: "Ω" },
          {
            name: "coolant_flow_lpm",
            value: coolantFlowLpm.toFixed(1),
            unit: "L/min",
            twinFqn: "SysML2::BatteryThermal::ColdPlateManifold.coolant_flow",
          },
        ],
        equations: [
          {
            lhs: "heat_rejection_W",
            rhs: moEq.rhsExpression,
            resultText: `${heatRejectionW.toFixed(1)} W`,
            twinFqn: "SysML2::BatteryThermal::ColdPlateManifold.heat_load",
          },
        ],
      },
      {
        kind: "scad-3d",
        moduleName: "SerpentineColdPlate",
        triangles: scadData.triangles,
        bboxMin: scadData.bboxMin,
        bboxMax: scadData.bboxMax,
        volumeMm3: scadData.volumeMm3,
        surfaceAreaMm2: scadData.surfaceAreaMm2,
        hydraulicDiaMm,
        flowAreaMm2,
        ports: [
          {
            portName: "coolant_inlet",
            portType: scadData.portTags.get("coolant_inlet")?.portType ?? "inlet",
            normal: scadData.portTags.get("coolant_inlet")?.normal ?? [1, 0, 0],
            anchor: [7, totalPlateWidthMm / 2, channelDepthMm],
            boundToCae: scadData.portTags.has("coolant_inlet"),
            caeTarget: `CFD::boundaryField.coolant_inlet (${coolantFlowLpm.toFixed(1)} L/min)`,
          },
          {
            portName: "fluid_core",
            portType: scadData.portTags.get("fluid_core")?.portType ?? "conjugate_wall",
            normal: scadData.portTags.get("fluid_core")?.normal ?? [0, 0, 1],
            anchor: [74, totalPlateWidthMm / 2, channelDepthMm],
            boundToCae: scadData.portTags.has("fluid_core"),
            caeTarget: `CFD::boundaryField.fluid_core (q=${heatRejectionW.toFixed(0)} W, Dh=${hydraulicDiaMm.toFixed(2)} mm)`,
          },
          {
            portName: "coolant_outlet",
            portType: scadData.portTags.get("coolant_outlet")?.portType ?? "outlet",
            normal: scadData.portTags.get("coolant_outlet")?.normal ?? [-1, 0, 0],
            anchor: [141, totalPlateWidthMm / 2, channelDepthMm],
            boundToCae: scadData.portTags.has("coolant_outlet"),
            caeTarget: "CFD::boundaryField.coolant_outlet (p = 0 kPa)",
          },
        ],
        csgTree: scadData.csgTree,
      },
      {
        kind: "cfd-3d",
        solverName: (cfdDoc as { solver?: string }).solver || "chtMultiRegionSimpleFoam",
        meshSourceFile: `ColdPlateChannels.scad (${geomSource})`,
        nx: lbmConfig.nx,
        ny: lbmConfig.ny,
        nz: lbmConfig.nz,
        channelCount,
        hydraulicDiaMm,
        inletFlowLpm: coolantFlowLpm,
        wallHeatLoadW: heatRejectionW,
        maxVelocityMs: Number(lbmRes.maxVelocity.toFixed(2)),
        pressureDropKpa: effectiveDeltaPKpa,
        maxAllowableDpKpa: maxPressureDropKpa,
        maxSurfaceTempK: effectiveMaxTempK,
        maxAllowableTempK: maxCellTempK,
        cells: lbmCells,
        patches: portBindings.map((pb) => ({
          name: pb.portName,
          openFoamType: pb.caePatchSpec.replace(/^boundaryField\.\S+\s*\{\s*type\s+|\s*;\s*\}$/g, ""),
          cadPortType: pb.cadPortType,
          isBound: pb.isBound,
          summary:
            pb.portName === "coolant_inlet"
              ? `Q = ${coolantFlowLpm.toFixed(1)} L/min (u_in = ${meanInletVelMs.toFixed(2)} m/s)`
              : pb.portName === "fluid_core"
                ? `Q_wall = ${heatRejectionW.toFixed(1)} W, D_h = ${hydraulicDiaMm.toFixed(2)} mm`
                : "Fixed gauge pressure p = 0 Pa",
        })),
      },
    ];
    paneVisuals[sysmlIdx] = sysmlVis;
    paneVisuals[moIdx] = moVis;
    paneVisuals[cadIdx] = cadVis;
    paneVisuals[cfdIdx] = cfdVis;
    return { meshSourceSummary, paneVisuals };
  }

  function evaluateRoboticsGdtPipeline(ctx: CoordinatorPipelineContext): CoordinatorPipelineResult {
    const {
      codes,
      roleIndex,
      editedPaneIndex,
      paneDiagnostics,
      coordinator,
      toleranceOracle,
      variableLinks,
      conflicts,
      evaluatedEquations,
      getSysmlAttrOrBound,
    } = ctx;
    const sysmlIdx = roleIndex.sysml >= 0 ? roleIndex.sysml : 0;
    const urdfIdx = roleIndex.urdf >= 0 ? roleIndex.urdf : 1;
    const moIdx = roleIndex.modelica >= 0 ? roleIndex.modelica : 2;
    const stepIdx = roleIndex.step >= 0 ? roleIndex.step : 3;
    let meshSourceSummary = "";
    const paneVisuals = new Array<PaneVisualData>(4) as [
      PaneVisualData,
      PaneVisualData,
      PaneVisualData,
      PaneVisualData,
    ];
    // SCENARIO 3: Precision Robotics & STEP AP242 GD&T
    // 1. Read SysML v2 contract from WASM GLR CST (SysML2::SurgicalRobotics::REQ_HARMONIC_03)
    const minClearanceMm = getSysmlAttrOrBound("min_clearance_mm", "min_radial_clearance", 0.015);
    const maxClearanceMm = getSysmlAttrOrBound("max_clearance_mm", "max_radial_clearance", 0.08);
    const maxSysmlTorqueNm = getSysmlAttrOrBound("max_joint_torque_Nm", "peak_torque", 140.0);

    // 2. Parse URDF (URDF::SurgicalArm) via `@modelscript/urdf` `parseUrdf`
    const urdfModel = parseUrdf(codes[urdfIdx]!);
    const upperArmLink = urdfModel.links.get("upper_arm");
    const shoulderJoint = urdfModel.joints.get("shoulder_pitch") ?? Array.from(urdfModel.joints.values())[0];
    const urdfMass = upperArmLink?.inertial?.mass ?? 2.8;
    const urdfEffort = shoulderJoint?.limits?.effort ?? 140.0;

    if (editedPaneIndex === urdfIdx) {
      codes[moIdx] = updateModelicaBindingViaCst(codes[moIdx]!, "arm_mass", urdfMass.toFixed(1));
    }
    const moArmMass = parseModelicaCst(codes[moIdx]!).components.find((c) => c.name === "arm_mass")?.bindingExpr
      ? Number.parseFloat(
          parseModelicaCst(codes[moIdx]!).components.find((c) => c.name === "arm_mass")!.bindingExpr!,
        ) || urdfMass
      : urdfMass;
    if (editedPaneIndex === moIdx && Math.abs(moArmMass - urdfMass) > 1e-4) {
      codes[urdfIdx] = updateUrdfLinkMass(codes[urdfIdx]!, "upper_arm", moArmMass.toFixed(1));
    }

    // 3. Evaluate Modelica RNEA `equation` dynamically via `evaluateCfdExpression`
    const moEq = evaluateModelicaOutputEquation(providers, codes[moIdx]!, "peak_torque_Nm", 98.5, {
      arm_mass: moArmMass,
    });
    const payloadMass = Math.max(0.1, moEq.paramMap.get("payload_mass") ?? 4.2);
    const linkReach = Math.max(0.1, moEq.paramMap.get("link_reach") ?? 0.65);
    const peakAccel = Math.max(0.5, moEq.paramMap.get("peak_accel") ?? 8.5);
    const peakTorqueNm = Number(moEq.value.toFixed(1));

    evaluatedEquations.push({
      paneIndex: moIdx,
      fileName: "HarmonicDriveDynamics.mo",
      language: "Modelica",
      lhs: "peak_torque_Nm",
      rhsExpression: moEq.rhsExpression,
      evaluatedValue: peakTorqueNm,
      unit: "N·m",
    });

    codes[moIdx] = updateModelicaBindingViaCst(codes[moIdx]!, "peak_torque_Nm", peakTorqueNm.toFixed(1));

    // 4. Parse STEP AP242 GD&T (STEP::BearingFit_AP242) via `@modelscript/step` `scanStepEntities` + `ToleranceStackVerifier`
    const stepScan = scanStepEntities(codes[stepIdx]!);
    const getStepEntityFirstNum = (entityId: string, fallback: number): number => {
      const ent = stepScan.find((e) => e.id === entityId);
      if (!ent) return fallback;
      const firstArg = ent.args.split(",")[0]?.trim() ?? "";
      const n = Number.parseFloat(firstArg);
      return Number.isFinite(n) ? n : fallback;
    };
    const boreNominalMm = getStepEntityFirstNum("#11", 40.048);
    const boreTolMm = Math.max(0.001, getStepEntityFirstNum("#12", 0.015));
    const shaftNominalMm = getStepEntityFirstNum("#21", 40.0);
    const shaftTolMm = Math.max(0.001, getStepEntityFirstNum("#22", 0.012));

    const chainSpec = {
      chainId: "STEP::BearingFit_AP242::#30",
      name: "Harmonic Drive Cross-Roller Bearing Radial Clearance (#12 vs #22)",
      contributors: [
        {
          partId: "STEP::BearingFit_AP242::#10(HOUSING_BORE)",
          featureName: "#11/#12_H7_inner_race",
          direction: 1 as const,
          nominal: boreNominalMm,
          tolerance: boreTolMm,
        },
        {
          partId: "STEP::BearingFit_AP242::#20(SHAFT_JOURNAL)",
          featureName: "#21/#22_g6_outer_journal",
          direction: -1 as const,
          nominal: shaftNominalMm,
          tolerance: shaftTolMm,
        },
      ],
      targetClearance: {
        min: minClearanceMm,
        max: maxClearanceMm,
        name: "SysML2::SurgicalRobotics::HarmonicJoint.radial_clearance",
      },
      method: "worst_case" as const,
    };

    const stackRes = toleranceOracle.calculateChain(chainSpec);
    const verifierRes = ToleranceStackVerifier.verify({
      name: "STEP::BearingFit_AP242::#30",
      dimensions: [
        {
          name: "#10 HOUSING_BORE (#11/#12)",
          nominal: boreNominalMm,
          upperTol: boreTolMm,
          lowerTol: -boreTolMm,
          direction: 1,
        },
        {
          name: "#20 SHAFT_JOURNAL (#21/#22)",
          nominal: shaftNominalMm,
          upperTol: shaftTolMm,
          lowerTol: -shaftTolMm,
          direction: -1,
        },
      ],
      minRequiredClearance: minClearanceMm,
    });

    const wcMin = Number(stackRes.minClearance.toFixed(3));
    const wcMax = Number(stackRes.maxClearance.toFixed(3));
    const rssMin = Number(verifierRes.statisticalRss.minRssGap.toFixed(3));
    const rssMax = Number(verifierRes.statisticalRss.maxRssGap.toFixed(3));
    meshSourceSummary = `ISO 10303-242 PMI (${stepScan.length} entities) -> ToleranceStackVerifier`;

    codes[stepIdx] = updateStepEntityArg(
      updateStepEntityArg(codes[stepIdx]!, "#30", 2, wcMin.toFixed(3)),
      "#30",
      3,
      wcMax.toFixed(3),
    );

    // Sync SysML v2 part def HarmonicJoint attributes
    codes[sysmlIdx] = updateSysmlAttrViaCst(codes[sysmlIdx]!, "min_radial_clearance", wcMin.toFixed(3));
    codes[sysmlIdx] = updateSysmlAttrViaCst(codes[sysmlIdx]!, "max_radial_clearance", wcMax.toFixed(3));
    codes[sysmlIdx] = updateSysmlAttrViaCst(codes[sysmlIdx]!, "peak_torque", peakTorqueNm.toFixed(1));

    coordinator.assertLiteral({
      id: 301,
      predicate: "toleranceChain",
      args: [chainSpec],
      domain: "spatial_physics",
    });

    const effectiveTorqueLimit = Math.min(maxSysmlTorqueNm, urdfEffort);
    const torqueSat = peakTorqueNm <= effectiveTorqueLimit;
    const clearanceSat = stackRes.isSatisfied;

    variableLinks.push(
      {
        symbol: "upper_arm.inertial.mass",
        canonicalFqn: "URDF::SurgicalArm::upper_arm.inertial.mass",
        bindingMechanism: 'annotation(twin = "URDF::SurgicalArm::upper_arm.inertial.mass")',
        label: "Upper Arm Link Mass",
        valueFormatted: `${moArmMass.toFixed(1)} kg`,
        boundsFormatted: `URDF <-> Modelica`,
        unit: "kg",
        sourceDomain: "ROS 2 URDF",
        targetDomains: ["Modelica"],
        domainBindings: [
          {
            domainLabel: "ROS 2 URDF",
            fqn: "URDF::SurgicalArm::upper_arm.inertial.mass",
            bindingSyntax: '<link name="upper_arm"><inertial><mass/>',
            valueText: `${moArmMass.toFixed(1)} kg`,
          },
          {
            domainLabel: "Modelica",
            fqn: "SurgicalControl.HarmonicDriveDynamics.arm_mass",
            bindingSyntax: 'annotation(twin = "URDF::...::upper_arm.inertial.mass")',
            valueText: `${moArmMass.toFixed(1)} kg`,
          },
        ],
        oracleName: "SpatialPhysicsOracle",
        status: "SAT",
        marginText: `Bijectively synced`,
      },
      {
        symbol: "HarmonicJoint.peak_torque",
        canonicalFqn: "SysML2::SurgicalRobotics::HarmonicJoint.peak_torque",
        bindingMechanism: 'annotation(twin = "...") + URDF shoulder_pitch.limit.effort',
        label: "RNEA Peak Joint Torque",
        valueFormatted: `${peakTorqueNm.toFixed(1)} N·m`,
        boundsFormatted: `<= ${effectiveTorqueLimit.toFixed(1)} N·m`,
        unit: "N·m",
        sourceDomain: "Modelica",
        targetDomains: ["ROS 2 URDF", "SysML v2"],
        domainBindings: [
          {
            domainLabel: "Modelica",
            fqn: "SurgicalControl.HarmonicDriveDynamics.peak_torque_Nm",
            bindingSyntax: 'annotation(twin = "SysML2::...::HarmonicJoint.peak_torque")',
            valueText: `${peakTorqueNm.toFixed(1)} N·m`,
          },
          {
            domainLabel: "ROS 2 URDF",
            fqn: "URDF::SurgicalArm::shoulder_pitch.limit.effort",
            bindingSyntax: '<joint name="shoulder_pitch"><limit effort="..."/>',
            valueText: `<= ${urdfEffort.toFixed(1)} N·m`,
          },
          {
            domainLabel: "SysML v2",
            fqn: "SurgicalRobotics::REQ_HARMONIC_03::joint.peak_torque",
            bindingSyntax: "joint.peak_torque <= max_joint_torque_Nm",
            valueText: `<= ${maxSysmlTorqueNm.toFixed(1)} N·m`,
          },
        ],
        oracleName: "DynamicSimulationOracle",
        status: torqueSat ? "SAT" : "UNSAT",
        marginText: torqueSat
          ? `${(((effectiveTorqueLimit - peakTorqueNm) / effectiveTorqueLimit) * 100).toFixed(1)}% effort margin`
          : `+${(peakTorqueNm - effectiveTorqueLimit).toFixed(1)} N·m actuator overload`,
      },
      {
        symbol: "HarmonicJoint.min_radial_clearance",
        canonicalFqn: "SysML2::SurgicalRobotics::HarmonicJoint.min_radial_clearance",
        bindingMechanism: "STEP #12/#22 -> #30.MIN_CLEARANCE -> subject joint",
        label: "Worst-Case Min Clearance",
        valueFormatted: `${wcMin.toFixed(3)} mm`,
        boundsFormatted: `>= ${minClearanceMm.toFixed(3)} mm`,
        unit: "mm",
        sourceDomain: "STEP AP242 GD&T",
        targetDomains: ["SysML v2"],
        domainBindings: [
          {
            domainLabel: "STEP AP242",
            fqn: "STEP::BearingFit_AP242::#30(#12, #22).MIN_CLEARANCE",
            bindingSyntax: "#11(40.048±#12) - #21(40.000±#22)",
            valueText: `${wcMin.toFixed(3)} mm (3σ: ${rssMin.toFixed(3)})`,
          },
          {
            domainLabel: "SysML v2",
            fqn: "SurgicalRobotics::REQ_HARMONIC_03::joint.min_radial_clearance",
            bindingSyntax: "joint.min_radial_clearance >= min_clearance_mm",
            valueText: `>= ${minClearanceMm.toFixed(3)} mm`,
          },
        ],
        oracleName: "ToleranceStackOracle",
        status: wcMin >= minClearanceMm ? "SAT" : "UNSAT",
        marginText:
          wcMin < 0
            ? `Interference (${wcMin.toFixed(3)} mm)`
            : wcMin >= minClearanceMm
              ? `+${((wcMin - minClearanceMm) * 1000).toFixed(0)} µm film margin`
              : `-${((minClearanceMm - wcMin) * 1000).toFixed(0)} µm seizure risk`,
      },
      {
        symbol: "HarmonicJoint.max_radial_clearance",
        canonicalFqn: "SysML2::SurgicalRobotics::HarmonicJoint.max_radial_clearance",
        bindingMechanism: "STEP #12/#22 -> #30.MAX_CLEARANCE -> subject joint",
        label: "Worst-Case Max Clearance",
        valueFormatted: `${wcMax.toFixed(3)} mm`,
        boundsFormatted: `<= ${maxClearanceMm.toFixed(3)} mm`,
        unit: "mm",
        sourceDomain: "STEP AP242 GD&T",
        targetDomains: ["SysML v2"],
        domainBindings: [
          {
            domainLabel: "STEP AP242",
            fqn: "STEP::BearingFit_AP242::#30(#12, #22).MAX_CLEARANCE",
            bindingSyntax: "EVALUATED_CLEARANCE_ENVELOPE(#12, #22)",
            valueText: `${wcMax.toFixed(3)} mm (3σ: ${rssMax.toFixed(3)})`,
          },
          {
            domainLabel: "SysML v2",
            fqn: "SurgicalRobotics::REQ_HARMONIC_03::joint.max_radial_clearance",
            bindingSyntax: "joint.max_radial_clearance <= max_clearance_mm",
            valueText: `<= ${maxClearanceMm.toFixed(3)} mm`,
          },
        ],
        oracleName: "ToleranceStackOracle",
        status: wcMax <= maxClearanceMm ? "SAT" : "UNSAT",
        marginText:
          wcMax <= maxClearanceMm
            ? `${((maxClearanceMm - wcMax) * 1000).toFixed(0)} µm backlash margin`
            : `+${((wcMax - maxClearanceMm) * 1000).toFixed(0)} µm excess backlash`,
      },
    );

    if (!clearanceSat) {
      const posSysml = findSysmlConstraintLineCol(codes[sysmlIdx]!, "joint.min_radial_clearance");
      const posStep = findStepEntityLineCol(codes[stepIdx]!, "#30");
      const msg = `[MSC-THEORY-CONFLICT] ToleranceStackOracle: 'STEP::BearingFit_AP242::#30(#12, #22)' worst-case clearance [${wcMin.toFixed(3)}, ${wcMax.toFixed(3)}] mm violates 'SysML2::SurgicalRobotics::REQ_HARMONIC_03' envelope [${minClearanceMm.toFixed(3)}, ${maxClearanceMm.toFixed(3)}] mm.`;
      paneDiagnostics[sysmlIdx]!.push({ ...posSysml, severity: "error", code: "MSC-GDT-STACK", message: msg });
      paneDiagnostics[stepIdx]!.push({ ...posStep, severity: "error", code: "MSC-GDT-STACK", message: msg });
      conflicts.push({
        literals: [],
        explanation: msg,
        culpritEntities: [
          "STEP::BearingFit_AP242::#12(HOUSING_BORE)",
          "STEP::BearingFit_AP242::#21(SHAFT_JOURNAL)",
          "SysML2::SurgicalRobotics::REQ_HARMONIC_03",
        ],
        theoryName: "ToleranceStackOracle",
      });
    }

    if (!torqueSat) {
      const posSysml = findSysmlConstraintLineCol(codes[sysmlIdx]!, "joint.peak_torque");
      const posUrdf = findUrdfAttrLineCol(codes[urdfIdx]!, "effort");
      const posMo = findModelicaComponentLineCol(codes[moIdx]!, "peak_torque_Nm");
      const msg = `[MSC-THEORY-CONFLICT] DynamicSimulationOracle: 'Modelica::SurgicalControl.HarmonicDriveDynamics.peak_torque_Nm' (${peakTorqueNm.toFixed(1)} N·m) exceeds 'URDF::SurgicalArm::shoulder_pitch.limit.effort' & 'SysML2::SurgicalRobotics::REQ_HARMONIC_03.max_joint_torque_Nm' (${effectiveTorqueLimit.toFixed(1)} N·m).`;
      paneDiagnostics[sysmlIdx]!.push({ ...posSysml, severity: "error", code: "MSC-RNEA-TORQUE", message: msg });
      paneDiagnostics[urdfIdx]!.push({ ...posUrdf, severity: "error", code: "MSC-RNEA-TORQUE", message: msg });
      paneDiagnostics[moIdx]!.push({ ...posMo, severity: "error", code: "MSC-RNEA-TORQUE", message: msg });
      conflicts.push({
        literals: [],
        explanation: msg,
        culpritEntities: [
          "Modelica::SurgicalControl.HarmonicDriveDynamics.peak_torque_Nm",
          "URDF::SurgicalArm::shoulder_pitch.limit.effort",
          "SysML2::SurgicalRobotics::REQ_HARMONIC_03.max_joint_torque_Nm",
        ],
        theoryName: "DynamicSimulationOracle",
      });
    }

    const [sysmlVis, urdfVis, moVis, stepVis]: [PaneVisualData, PaneVisualData, PaneVisualData, PaneVisualData] = [
      {
        kind: "sysml-bdd",
        packageName: "SurgicalRobotics",
        partName: "HarmonicJoint",
        partAttributes: [
          { name: "min_radial_clearance", value: wcMin.toFixed(3), unit: "mm", sourceHint: "<- STEP::#30" },
          { name: "max_radial_clearance", value: wcMax.toFixed(3), unit: "mm", sourceHint: "<- STEP::#30" },
          { name: "peak_torque", value: peakTorqueNm.toFixed(1), unit: "N·m", sourceHint: "<- Modelica" },
        ],
        requirementId: "REQ_HARMONIC_03",
        subjectName: "joint",
        subjectType: "HarmonicJoint",
        constraints: [
          {
            expression: "joint.min_radial_clearance >= min_clearance_mm",
            actualText: `${wcMin.toFixed(3)} mm`,
            limitText: `>= ${minClearanceMm.toFixed(3)} mm`,
            isSat: wcMin >= minClearanceMm,
          },
          {
            expression: "joint.max_radial_clearance <= max_clearance_mm",
            actualText: `${wcMax.toFixed(3)} mm`,
            limitText: `<= ${maxClearanceMm.toFixed(3)} mm`,
            isSat: wcMax <= maxClearanceMm,
          },
          {
            expression: "joint.peak_torque <= max_joint_torque_Nm",
            actualText: `${peakTorqueNm.toFixed(1)} N·m`,
            limitText: `<= ${effectiveTorqueLimit.toFixed(1)} N·m`,
            isSat: torqueSat,
          },
        ],
      },
      {
        kind: "urdf-3d",
        robotName: urdfModel.name || "SurgicalArm",
        links:
          urdfModel.links.size > 0
            ? Array.from(urdfModel.links.values()).map((l: UrdfLinkLike) => ({
                name: l.name,
                massKg: l.name === "upper_arm" ? moArmMass : (l.inertial?.mass ?? 6.5),
              }))
            : [
                { name: "base_column", massKg: 6.5 },
                { name: "upper_arm", massKg: moArmMass },
              ],
        joints: [
          {
            name: shoulderJoint?.name ?? "shoulder_pitch",
            type: shoulderJoint?.type ?? "revolute",
            parent: shoulderJoint?.parentLink ?? "base_column",
            child: shoulderJoint?.childLink ?? "upper_arm",
            lowerRad: shoulderJoint?.limits?.lower ?? -1.57,
            upperRad: shoulderJoint?.limits?.upper ?? 1.57,
            effortLimitNm: urdfEffort,
            velocityLimitRadS: shoulderJoint?.limits?.velocity ?? 2.6,
            actualTorqueNm: peakTorqueNm,
          },
        ],
        payloadMassKg: payloadMass,
        linkReachM: linkReach,
      },
      {
        kind: "modelica-dae",
        withinPkg: "SurgicalControl",
        modelName: "HarmonicDriveDynamics",
        parameters: [
          {
            name: "arm_mass",
            value: moArmMass.toFixed(1),
            unit: "kg",
            twinFqn: "URDF::SurgicalArm::upper_arm.inertial.mass",
          },
          { name: "payload_mass", value: payloadMass.toFixed(1), unit: "kg" },
          { name: "link_reach", value: linkReach.toFixed(2), unit: "m" },
          { name: "peak_accel", value: peakAccel.toFixed(1), unit: "rad/s²" },
        ],
        equations: [
          {
            lhs: "peak_torque_Nm",
            rhs: moEq.rhsExpression,
            resultText: `${peakTorqueNm.toFixed(1)} N·m`,
            twinFqn: "SysML2::SurgicalRobotics::HarmonicJoint.peak_torque",
          },
        ],
      },
      {
        kind: "step-gdt",
        fileName: "BearingFit_AP242.step",
        entityCount: stepScan.length,
        boreEntityId: "#10/#11/#12",
        boreNominalMm,
        boreTolMm,
        shaftEntityId: "#20/#21/#22",
        shaftNominalMm,
        shaftTolMm,
        envelopeEntityId: "#30",
        wcMinMm: wcMin,
        wcMaxMm: wcMax,
        rssMinMm: rssMin,
        rssMaxMm: rssMax,
        allowableMinMm: minClearanceMm,
        allowableMaxMm: maxClearanceMm,
        isSat: clearanceSat,
        entities: stepScan.map((ent) => ({
          id: ent.id,
          typeName: ent.type,
          summary: ent.args,
        })),
      },
    ];
    paneVisuals[sysmlIdx] = sysmlVis;
    paneVisuals[urdfIdx] = urdfVis;
    paneVisuals[moIdx] = moVis;
    paneVisuals[stepIdx] = stepVis;
    return { meshSourceSummary, paneVisuals };
  }

  const COORDINATOR_PIPELINES: Record<string, CoordinatorPipelineEvaluator> = {
    "aerospace-actuator": evaluateAerospaceActuatorPipeline,
    "ev-battery-coldplate": evaluateEvBatteryColdplatePipeline,
    "robotics-gdt-tolerance": evaluateRoboticsGdtPipeline,
  };

  function matchesCuratedScenario(
    scenario: CoordinatorScenario,
    files: { fileName: string; content: string }[],
  ): boolean {
    if (files.length === 0 || files.length > scenario.panes.length) return false;
    const scenarioFileNames = new Set(scenario.panes.map((p) => p.fileName.toLowerCase()));
    const scenarioLangs = new Set(scenario.panes.map((p) => p.lang));
    let exactFileMatch = false;
    for (const f of files) {
      const base = f.fileName.split(/[\\/]/).pop()?.toLowerCase() ?? f.fileName.toLowerCase();
      if (scenarioFileNames.has(base)) {
        exactFileMatch = true;
      } else {
        const extLang = classifyWorkspaceFile(f).lang;
        if (!scenarioLangs.has(extLang as CoordinatorPaneSpec["lang"])) {
          return false;
        }
      }
    }
    return exactFileMatch;
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
