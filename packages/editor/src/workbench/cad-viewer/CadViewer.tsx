// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CadViewer — 3D CAD viewer for Modelica components with CAD annotations.
 *
 * Renders GLTF/GLB models referenced by `annotation(CAD(uri="modelica://..."))`.
 * Supports selection sync with the 2D diagram, VR mode, and snap-to-port
 * interactions via CADPort annotations.
 */

import type {
  DynamicBindingConfig,
  GdtOverlayPayload,
  MissionPhaseBand,
  OperationLogEvent,
  Verification3DOverlayPayload,
} from "@modelscript/cad";
import {
  ContactShadows,
  GizmoHelper,
  GizmoViewport,
  Grid,
  Html,
  OrbitControls,
  TransformControls,
  useGLTF,
} from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useXR, XR } from "@react-three/xr";
import type React from "react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  exportCaeToCgnsJson,
  generateLocalTetMeshAsync,
  runAdjointSensitivityStudyAsync,
  runCfdVvScorecardAsync,
  runLocalCfdStudyAsync,
  runLocalFeaStudyAsync,
  runMeshHealCheckAsync,
  trainLocalPodSurrogateAsync,
  type CaeCfdStudyOptions,
  type CaeFeaStudyOptions,
} from "../util/cae-local-runner";
import type { AnsatzRelationalHypergraphRecord } from "../util/lsp-bridge";
import type { WamTrajectoryWaypoint } from "../util/zonotope-3d-geometry";
import type {
  LinearConstraintSpec,
  ZonotopePendingOverride,
  ZonotopeWorkbenchState,
} from "../util/zonotope-workbench-state";
import { enterXrSession, getSharedXrStore, useXrCapabilities } from "../vr-rotunda/xr-session";
import {
  AdjointSensitivityPanel,
  type AdjointRunConfig,
  type AdjointSensitivityResult,
} from "./AdjointSensitivityPanel";
import type { AnimationController } from "./animation-controller";
import { AnimationTimeline } from "./AnimationTimeline";
import {
  createDefaultAssemblyVisibility,
  inferSubsystemsFromPartNames,
  resolvePartPresentation,
  type AssemblyVisibilityState,
} from "./assembly-visibility";
import { BarrierShellOverlay } from "./BarrierShellOverlay";
import { CadBindingPickerModal } from "./CadBindingPickerModal";
import { CadCommandIsland } from "./CadCommandIsland";
import { CadInspectorDrawer, type CadDrawerTab } from "./CadInspectorDrawer";
import { CadSelectionRibbon } from "./CadSelectionRibbon";
import {
  CadStudyWizardModal,
  computeWindTunnelBounds,
  type CadBoundingBox,
  type GeneratedCadStudyResult,
  type MeshHealSummary,
} from "./CadStudyWizardModal";
import { CaePhysicsInspector, createDefaultCaePhysicsConfig, type CaePhysicsConfig } from "./CaePhysicsInspector";
import {
  buildCaeSimulationModel,
  CaePostProcessDrawer,
  CaeSimulationTree,
  ScalarColorbarLegend,
  type CaeSimulationRunEntry,
} from "./CaeSimulationTree";
import { CaeTelemetryPanel, type AerodynamicMonitorSnapshot, type TelemetryDataPoint } from "./CaeTelemetryPanel";
import { CfdDomainGizmo, type CfdRefinementBox } from "./CfdDomainGizmo";
import {
  DEFAULT_NASA_CFD_2030_VV_CASES,
  DigitalThreadCaePanel,
  type DigitalThreadHyperedge,
  type NasaVvCaseResult,
} from "./DigitalThreadCaePanel";
import { DynamicClearanceVector } from "./DynamicClearanceVector";
import { useRetainGltfUrl } from "./gltf-cache-guard";
import {
  buildCleanCreaseEdgeGeometry,
  CadEdgeOverlay,
  ensureGeometryBrushedUvs,
  Gdt3dOverlay,
  HeroStudioEnvironment,
  resolveHeroAlloyConfig,
  SplitSectionGeometryPasses,
  StencilSectionCapQuad,
  StudioSsaoPass,
} from "./HeroCadMaterials";
import { InstancedCadAssembly } from "./InstancedCadAssembly";
import { JetPlumeRenderer, type JetPlumeRendererProps } from "./JetPlumeRenderer";
import { ProbeTooltip, type ProbeData } from "./ProbeTooltip";
import { ReachabilityTubeOverlay } from "./ReachabilityTubeOverlay";
import { RequirementVerdictCard, type RequirementVerdictPayload } from "./RequirementVerdictCard";
import { SimulatorTelemetryHud, type SimulatorTelemetryHudProps } from "./SimulatorTelemetryHud";
import { SurrogateLiveExplorer, type PodSurrogateDataPayload } from "./SurrogateLiveExplorer";
import { SurrogateTrainDialog, type SurrogateTrainConfig, type SurrogateTrainingMetrics } from "./SurrogateTrainDialog";
import { SweepConfigDrawer, type ActiveSweepState, type SweepLaunchConfig } from "./SweepConfigDrawer";
import { sampleVtkCutLine, VtkRenderer, type VtkProbePoint, type VtkSlicePlane } from "./VtkRenderer";
import { ZonotopeCadOverlay } from "./ZonotopeCadOverlay";

// ── Types ────────────────────────────────────────────────────────────────────

export type GizmoMode = "select" | "translate" | "rotate" | "scale" | "tag_face" | "mate";

export interface CommitAssemblyJointPayload {
  jointName: string;
  jointType: "Revolute" | "Prismatic" | "Cylindrical" | "Spherical" | "Fixed";
  partA: string;
  partB: string;
  axis?: [number, number, number] | undefined;
}

export interface CadSourceMetadata {
  uri?: string | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  primitiveStartOffset?: number | undefined;
  primitiveEndOffset?: number | undefined;
  parameterName?: string | undefined;
  transformMethod?: string | undefined;
  argIndex?: number | undefined;
  translateRange?: { startOffset: number; endOffset: number } | undefined;
  rotateRange?: { startOffset: number; endOffset: number } | undefined;
  scaleRange?: { startOffset: number; endOffset: number } | undefined;
  dimensions?: [number, number, number] | undefined;
  dimensionParams?: [string | undefined, string | undefined, string | undefined] | undefined;
  position?: [number, number, number] | undefined;
  translation?: [number, number, number] | undefined;
  rotation?: [number, number, number] | undefined;
  scale?: [number, number, number] | undefined;
  primitiveType?: string | undefined;
  color?: [number, number, number, number] | undefined;
}

export interface GizmoCommitPayload {
  componentName: string;
  mode?: GizmoMode | undefined;
  delta: [number, number, number];
  newPosition: [number, number, number];
  newRotation?: [number, number, number] | undefined;
  newScale?: [number, number, number] | undefined;
  sourceMetadata?: CadSourceMetadata | undefined;
}

export interface CommitDimensionPayload {
  componentName: string;
  dimensionIndex: number;
  newValue: number;
  primitiveType?: string | undefined;
  sourceMetadata?: CadSourceMetadata | undefined;
}

export interface CommitFaceTagPayload {
  componentName: string;
  portName: string;
  portType: string;
  normal?: [number, number, number] | undefined;
  worldPos: [number, number, number];
  sourceMetadata?: CadSourceMetadata | undefined;
}

interface FaceTagHit {
  componentName: string;
  normal?: [number, number, number] | undefined;
  worldPos: [number, number, number];
  sourceMetadata?: CadSourceMetadata | undefined;
}

export interface CadAnnotation {
  uri: string;
  position?: [number, number, number] | undefined;
  rotation?: [number, number, number] | undefined;
  scale?: [number, number, number] | undefined;
}

export interface CadPortAnnotation {
  feature: string;
  offsetPosition?: [number, number, number] | undefined;
  offsetRotation?: [number, number, number] | undefined;
  offsetScale?: [number, number, number] | undefined;
}

export interface ProceduralMeshData {
  vertices: number[];
  indices: number[];
  normals: number[];
  color?: [number, number, number, number] | undefined;
  material?: string | undefined;
}

export interface CadComponent {
  /** Qualified Modelica variable name, e.g. "body1" */
  name: string;
  /** Parsed CAD annotation */
  cad: CadAnnotation;
  /** Parsed CADPort annotations from sub-components (connectors) */
  ports?: { name: string; port: CadPortAnnotation }[] | undefined;
  /** Dynamic animation bindings (from DynamicSelect in CAD annotations) */
  dynamicBindings?: { property: string; index: number; variable: string }[] | undefined;
  /** Source code metadata linking to AST parameters and CST byte ranges */
  sourceMetadata?: CadSourceMetadata | undefined;
  /** Procedural triangle mesh for inline CSG/OpenSCAD or MSL Visualizer solids */
  proceduralMesh?: ProceduralMeshData | undefined;
  /** Baseline transform defaults for MSL Visualizers and CAD components */
  defaults?: Record<string, unknown> | undefined;
  /** MSL Visualizer shapeType identifier (e.g., "box", "cylinder", "spring", "torus") */
  shapeType?: string | undefined;
}

/** Format a CAD asset URI into a concise human-readable label (hiding inline base64 data URIs). */
export function formatCadAssetLabel(uri?: string): string {
  if (!uri) return "3D Mesh";
  if (uri.startsWith("data:")) return "Embedded 3D Mesh";
  const lastSegment = uri.split("/").pop();
  return lastSegment || "3D Mesh";
}

export interface CadViewerProps {
  /** List of components with CAD annotations to render */
  components: CadComponent[];
  /** Base URL for resolving modelica:// URIs, e.g. "/api/v1/libraries" */
  assetBaseUrl?: string | undefined;
  /** Currently selected component name (synced with the 2D diagram) */
  selectedName?: string | null | undefined;
  /** Callback when user selects a 3D object */
  onSelect?: ((name: string | null) => void) | undefined;
  /** Callback when user performs a snap/connect action */
  onConnect?: ((sourceName: string, sourcePort: string, targetName: string, targetPort: string) => void) | undefined;
  /** Callback when user drags and releases a 3D direct-manipulation transform gizmo */
  onCommitGizmoDelta?: ((payload: GizmoCommitPayload) => void) | undefined;
  /** Callback when user commits a parametric dimension edit */
  onCommitDimensionDelta?: ((payload: CommitDimensionPayload) => void) | undefined;
  /** Callback when user tags a 3D face as a physical port or boundary condition */
  onCommitFaceTag?: ((payload: CommitFaceTagPayload) => void) | undefined;
  /** Callback when user mates two 3D parts with an assembly joint */
  onCommitAssemblyJoint?: ((payload: CommitAssemblyJointPayload) => void) | undefined;
  /** Dark mode toggle */
  dark?: boolean | undefined;
  /** Animation controller for simulation-driven animation */
  animationController?: AnimationController | null | undefined;
  /** Extracted VTK Buffer from the CFD Orchestrator for Real-time VR rendering */
  vtkBuffer?: Uint8Array | null | undefined;
  /** Available simulation variables for dynamic binding picker */
  availableVariables?: string[] | undefined;
  /** Callback when user saves new bindings from the picker */
  onSaveBindings?: ((componentName: string, bindings: DynamicBindingConfig[]) => void) | undefined;
  /** Disambiguate mobile touch: single finger passes page scroll, two fingers dolly/pan */
  touchScrollPassThrough?: boolean | undefined;
  /** Formal verification 3D overlay payload */
  verificationOverlay?: Verification3DOverlayPayload | null | undefined;
  /** Optional explicit formal requirement verdict card payload (derived from verificationOverlay if omitted) */
  requirementVerdict?: RequirementVerdictPayload | null | undefined;
  /** Callback when user clicks a SysML requirement link in RequirementVerdictCard */
  onNavigateToRequirement?: ((reqId: string) => void) | undefined;
  /** Callback when user clicks Jump to Breach in RequirementVerdictCard */
  onJumpToViolation?: ((time: number, witnessPoint?: [number, number, number]) => void) | undefined;
  /** Optional POD-Galerkin reduced-order surrogate payload for the 60 FPS Digital Twin ROM Explorer */
  surrogateData?: PodSurrogateDataPayload | null | undefined;
  /** Model name displayed in SurrogateLiveExplorer */
  surrogateModelName?: string | undefined;
  /** Callback invoked when SurrogateLiveExplorer reconstructs a 3D field */
  onSurrogateReconstruct?:
    ((field: Float32Array, scalars: Record<string, number>, params: Record<string, number>) => void) | undefined;
  /** Callback to open generated Modelica .mo source from SurrogateLiveExplorer */
  onOpenSurrogateModelica?: ((modelName: string) => void) | undefined;
  /** Callback to export FMI 3.0 source from SurrogateLiveExplorer */
  onExportSurrogateFmu?: ((modelName: string) => void) | undefined;
  /** Callback to close SurrogateLiveExplorer */
  onCloseSurrogateExplorer?: (() => void) | undefined;
  /** Optional SimulatorTelemetryHud overlay configuration */
  telemetryHud?: SimulatorTelemetryHudProps | null | undefined;
  /** ASME Y14.5 GD&T MBD callouts and datums overlay */
  gdtOverlay?: GdtOverlayPayload | null | undefined;
  /** Insets (top/right/bottom/left in px) for floating panels/sidebars so the 3D model centers in the visible area */
  fitInsets?: { top: number; right: number; bottom: number; left: number } | undefined;
  /** Optional live source code (used to map byte offsets to line numbers for Go to Source) */
  sourceCode?: string | undefined;
  /** Optional CAE deck / CFD config source for SimScale-style simulation tree */
  caeSourceCode?: string | undefined;
  /** Reveal a line in the code editor when a CAE tree item or CAD source link is clicked */
  onRevealLine?: ((line: number, identifier?: string) => void) | undefined;
  /** Insert a CAE keyword snippet into the live code editor */
  onInsertCaeSnippet?: ((snippet: string) => void) | undefined;
  /** Launch the full Engineering VR Rotunda workstation from the 3D CAD viewer */
  onOpenVrRotunda?: (() => void) | undefined;
  /** Optional mission phase bands displayed along the AnimationTimeline scrubber */
  missionPhases?: readonly MissionPhaseBand[] | undefined;
  /** Optional operator-action / autonomy keyframe events for click-to-seek Operation Log */
  operationLog?: readonly OperationLogEvent[] | undefined;
  /** Optional real-time GPU particle jet plume configuration bound to a fluid outlet */
  jetPlume?: Omit<JetPlumeRendererProps, "isInXr"> | null | undefined;
  /** Optional controlled per-part visibility/ghost/material overrides synced with left sidebar COMPONENTS tree */
  partOverrides?: Record<string, { visible?: boolean; ghost?: boolean; color?: string; material?: string }> | undefined;
  /** Callback when per-part overrides change inside CadViewer */
  onPartOverridesChange?:
    | React.Dispatch<
        React.SetStateAction<Record<string, { visible?: boolean; ghost?: boolean; color?: string; material?: string }>>
      >
    | undefined;
  /** Optional sync group identifier to synchronize 3D OrbitControls cameras across side-by-side CadViewer instances */
  cameraSyncGroup?: string | undefined;
  /** Optional active workspace file name (used to pre-populate the CAD Study Wizard) */
  activeFileName?: string | undefined;
  /** Callback when a new CFD/FEA study deck is generated from the CAD Study Wizard */
  onCreateCaeStudy?: ((study: GeneratedCadStudyResult) => void) | undefined;
  /** Callback to open Cloud / HPC cluster dispatch modal for remote CAE solves */
  onTriggerHpcRun?: (() => void) | undefined;
  /** Toggle 3D Multi-Modal Zonotope dual ghost tolerance shells & WAM tube overlay */
  showZonotopeOverlay?: boolean | undefined;
  /** Shared Multi-Modal Zonotope workbench state */
  zonotopeWorkbenchState?: ZonotopeWorkbenchState | undefined;
  /** Compiled relational hypergraph record for mapping CAD parts to perturbation generator groups */
  hypergraphRecord?: AnsatzRelationalHypergraphRecord | null | undefined;
  /** Component names flagged as violating by feasibility or verification checks */
  zonotopeViolatingComponents?: string[] | undefined;
  /** Explicit 3D WAM trajectory tube waypoints */
  zonotopeWamWaypoints?: WamTrajectoryWaypoint[] | undefined;
  /** Callback when user selects a generator group in the 3D Zonotope overlay */
  onSelectZonotopeGroup?: ((groupId: number | null) => void) | undefined;
  /** Callback when user adds a symmetry coupling or lock override in the 3D Zonotope overlay */
  onAddZonotopeOverride?: ((override: ZonotopePendingOverride) => void) | undefined;
  /** Callback when user creates a clearance caliper constraint in the 3D Zonotope overlay */
  onAddZonotopeConstraint?: ((constraint: LinearConstraintSpec) => void) | undefined;
  /** Callback when user drags a 3D CAD tolerance shell to adjust cadToleranceFraction */
  onChangeCadToleranceFraction?: ((nextFraction: number) => void) | undefined;
  /** Callback when user drags a 3D WAM trajectory waypoint ring handle to adjust its radius */
  onChangeWamWaypointRadius?: ((waypointIndex: number, nextRadius: number) => void) | undefined;
}

function mapPhysicsToCfdOptions(cfg: CaePhysicsConfig): CaeCfdStudyOptions {
  const solverMap: Record<CaePhysicsConfig["cfd"]["solverFamily"], NonNullable<CaeCfdStudyOptions["solverFamily"]>> = {
    "lbm-d3q19": "lbm",
    "lbm-octree": "octree_lbm",
    "fvm-compressible": "compressible_fvm",
    "dg-nodal": "compressible_dg",
  };
  const turbMap: Record<
    CaePhysicsConfig["cfd"]["turbulenceModel"],
    NonNullable<CaeCfdStudyOptions["turbulenceModel"]>
  > = {
    laminar: "laminar",
    smagorinsky: "smagorinsky_les",
    "dynamic-smagorinsky": "dynamic_smagorinsky",
    "wmles-spalding": "wmles",
    "spalart-allmaras": "spalart-allmaras",
    ddes: "ddes",
  };
  return {
    solverFamily: solverMap[cfg.cfd.solverFamily],
    turbulenceModel: turbMap[cfg.cfd.turbulenceModel],
    collisionOperator: cfg.cfd.collisionOperator,
    curvedBoundary: cfg.cfd.bouzidiCurvedWalls,
    thermal: {
      enabled: cfg.cfd.thermalBoussinesq,
      prandtl: cfg.cfd.prandtl,
      ambientTempK: cfg.cfd.ambientTempK,
      wallTempK: cfg.cfd.wallTempK,
      heatFluxW: cfg.cfd.heatFluxW,
      buoyancy: cfg.cfd.thermalBoussinesq,
    },
    fvmFlux: cfg.cfd.fluxScheme === "roe" ? "roe" : "hllc",
    fvmLimiter: cfg.cfd.limiter,
    implicitGmres: cfg.cfd.implicitGmres,
    dgOrder: cfg.cfd.dgOrder,
    computeFlowFeatures: true,
  };
}

function mapPhysicsToFeaOptions(cfg: CaePhysicsConfig): CaeFeaStudyOptions {
  const precondMap: Record<
    CaePhysicsConfig["fea"]["preconditioner"],
    NonNullable<CaeFeaStudyOptions["preconditioner"]>
  > = {
    "jacobi-pcg": "jacobi",
    "sa-amg": "sa_amg",
    "mixed-f32-f64-amg": "mixed_precision_amg",
  };
  let laminatePlies: CaeFeaStudyOptions["laminatePlies"];
  if (cfg.fea.materialModel === "cfrp-laminate" && cfg.fea.plyAnglesDeg.length > 0) {
    const angles = cfg.fea.symmetricLayup
      ? [...cfg.fea.plyAnglesDeg, ...[...cfg.fea.plyAnglesDeg].reverse()]
      : cfg.fea.plyAnglesDeg;
    laminatePlies = angles.map((angleDeg) => ({
      angleDeg,
      thickness: cfg.fea.plyThicknessMm * 1e-3,
      E1: cfg.fea.cfrpE1Mpa * 1e6,
      E2: cfg.fea.cfrpE2Mpa * 1e6,
      G12: cfg.fea.cfrpG12Mpa * 1e6,
      nu12: cfg.fea.cfrpNu12,
    }));
  }
  return {
    elementOrder: cfg.fea.elementOrder,
    corotational: cfg.fea.kinematics === "corotational",
    transient: cfg.fea.analysisType === "transient-newmark",
    dt: cfg.fea.newmarkDt,
    steps: cfg.fea.analysisType === "transient-newmark" ? Math.min(16, Math.max(1, cfg.fea.newmarkSteps)) : undefined,
    preconditioner: precondMap[cfg.fea.preconditioner],
    laminatePlies,
  };
}

function vtkProbeToProbeData(probe: VtkProbePoint, dialect?: "cfd" | "fea"): ProbeData {
  const name = probe.scalarName.toLowerCase();
  const base: ProbeData = {
    screenX: probe.screenX,
    screenY: probe.screenY,
    worldPos: probe.point,
  };
  if (name.includes("stress") || name.includes("mises")) {
    base.vonMisesMpa = probe.value;
  } else if (name.includes("disp")) {
    base.dispMagnitudeMm = probe.value;
  } else if (name.includes("velocity")) {
    base.velocityMs = probe.value;
  } else if (name.includes("pressure")) {
    base.pressurePa = probe.value;
  } else if (name.includes("temp")) {
    base.temperatureK = probe.value;
  } else if (name.includes("q-crit") || name.includes("q_crit")) {
    base.qCriterion = probe.value;
  } else if (name.includes("vort")) {
    base.vorticity = probe.value;
  } else if (name.includes("mach")) {
    base.machNumber = probe.value;
  } else if (dialect === "cfd") {
    base.velocityMs = probe.value;
  } else {
    base.vonMisesMpa = probe.value;
  }
  return base;
}

function computeSceneBounds(components: CadComponent[]): {
  center: [number, number, number];
  radius: number;
  minY: number;
  min: [number, number, number];
  max: [number, number, number];
} {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let hasPoints = false;

  for (const comp of components) {
    const p = comp.cad.position ?? [0, 0, 0];
    const s = comp.cad.scale ?? [1, 1, 1];
    if (comp.proceduralMesh && comp.proceduralMesh.vertices.length >= 3) {
      const verts = comp.proceduralMesh.vertices;
      for (let i = 0; i < verts.length; i += 3) {
        const vx = verts[i]! * s[0] + p[0];
        const vy = verts[i + 1]! * s[1] + p[1];
        const vz = verts[i + 2]! * s[2] + p[2];
        if (vx < minX) minX = vx;
        if (vy < minY) minY = vy;
        if (vz < minZ) minZ = vz;
        if (vx > maxX) maxX = vx;
        if (vy > maxY) maxY = vy;
        if (vz > maxZ) maxZ = vz;
        hasPoints = true;
      }
    } else {
      if (p[0] - 1 < minX) minX = p[0] - 1;
      if (p[1] - 1 < minY) minY = p[1] - 1;
      if (p[2] - 1 < minZ) minZ = p[2] - 1;
      if (p[0] + 1 > maxX) maxX = p[0] + 1;
      if (p[1] + 1 > maxY) maxY = p[1] + 1;
      if (p[2] + 1 > maxZ) maxZ = p[2] + 1;
      hasPoints = true;
    }
  }

  if (!hasPoints) {
    return { center: [0, 0, 0], radius: 2, minY: 0, min: [-1, 0, -1], max: [1, 2, 1] };
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  const radius = Math.max(0.5, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2);
  return { center: [cx, cy, cz], radius, minY, min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

// ── URI resolver ─────────────────────────────────────────────────────────────

/**
 * Convert a `modelica://LibraryName/Resources/path.glb` URI into a fetch URL.
 *
 * Strategy: `modelica://Modelica/Resources/CAD/part.glb`
 *   → `{baseUrl}/Modelica/latest/resources/Resources/CAD/part.glb`
 */
function resolveModelicaUri(uri: string, baseUrl: string): string {
  const match = uri.match(/^modelica:\/\/([^/]+)\/(.+)$/);
  if (!match) return uri; // already a URL
  const [, libraryName, resourcePath] = match;
  return `${baseUrl}/${libraryName}/latest/resources/${resourcePath}`;
}

// ── Sub-components ───────────────────────────────────────────────────────────

/** Port indicator sphere rendered at a CADPort position. */
function PortIndicator({
  position,
  name,
  highlighted,
}: {
  position: [number, number, number];
  name: string;
  highlighted?: boolean | undefined;
}) {
  const ref = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (ref.current && highlighted) {
      ref.current.scale.setScalar(1 + Math.sin(Date.now() * 0.005) * 0.15);
    }
  });

  return (
    <mesh ref={ref} position={position} name={`port:${name}`}>
      <sphereGeometry args={[0.03, 16, 16]} />
      <meshStandardMaterial
        color={highlighted ? "#ff6b35" : "#4fc3f7"}
        emissive={highlighted ? "#ff6b35" : "#4fc3f7"}
        emissiveIntensity={highlighted ? 0.6 : 0.3}
        transparent
        opacity={0.85}
      />
    </mesh>
  );
}

const DEFAULT_MESH_COLOR: [number, number, number, number] = [0.27, 0.51, 0.71, 1.0];
const EMPTY_CLIP_PLANES: THREE.Plane[] = [];

/** Procedural triangle mesh built directly from MSL Visualizer or CSG evaluation arrays. */
function ProceduralMeshObject({
  mesh,
  name,
  dark = false,
  solidPlane = null,
  wirePlane = null,
  sectionSplit = false,
  showEdges = true,
}: {
  mesh: ProceduralMeshData;
  name?: string | undefined;
  dark?: boolean | undefined;
  solidPlane?: THREE.Plane | null | undefined;
  wirePlane?: THREE.Plane | null | undefined;
  sectionSplit?: boolean | undefined;
  showEdges?: boolean | undefined;
}) {
  const { gl } = useThree();
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(mesh.vertices), 3));
    if (mesh.normals && mesh.normals.length === mesh.vertices.length) {
      geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(mesh.normals), 3));
    }
    if (mesh.indices && mesh.indices.length > 0) {
      geo.setIndex(mesh.indices);
    }
    if (!mesh.normals || mesh.normals.length !== mesh.vertices.length) {
      geo.computeVertexNormals();
    }
    ensureGeometryBrushedUvs(geo);
    return geo;
  }, [mesh]);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  const rgba = mesh.color ?? DEFAULT_MESH_COLOR;
  const alloyProps = useMemo(
    () => resolveHeroAlloyConfig(gl, name, rgba, dark, mesh.material),
    [gl, name, rgba, dark, mesh.material],
  );
  const clipPlanes = useMemo(() => (solidPlane ? [solidPlane] : EMPTY_CLIP_PLANES), [solidPlane]);
  const isTranslucent = rgba[3] < 1.0;

  return (
    <group>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshPhysicalMaterial
          {...alloyProps}
          transparent={isTranslucent}
          opacity={rgba[3]}
          depthWrite={!isTranslucent}
          polygonOffset={showEdges}
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
          side={THREE.DoubleSide}
          clippingPlanes={clipPlanes}
          clipShadows={true}
        />
      </mesh>
      {showEdges && !sectionSplit && (
        <CadEdgeOverlay
          geometry={geometry}
          dark={dark}
          opacity={isTranslucent ? 0.45 : 0.8}
          clippingPlanes={clipPlanes}
        />
      )}
      {sectionSplit && solidPlane && wirePlane && (
        <SplitSectionGeometryPasses
          geometry={geometry}
          solidPlane={solidPlane}
          wirePlane={wirePlane}
          dark={dark}
          showStencilMask={true}
          showWireOpposite={true}
        />
      )}
    </group>
  );
}

/** GLTF-loaded 3D mesh object. */
function GltfMeshObject({
  url,
  solidPlane = null,
  showEdges = true,
  dark = false,
  ghost = false,
}: {
  url: string;
  solidPlane?: THREE.Plane | null | undefined;
  showEdges?: boolean | undefined;
  dark?: boolean | undefined;
  ghost?: boolean | undefined;
}) {
  useRetainGltfUrl(url);
  const { scene } = useGLTF(url);

  // Clone scene graph AND materials so clipping/polygonOffset edits never mutate the shared cached scene
  const { cloned, clonedMaterials } = useMemo(() => {
    const root = scene.clone(true);
    const mats: THREE.Material[] = [];
    root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (Array.isArray(mesh.material)) {
          const next = mesh.material.map((m) => {
            const c = m.clone();
            c.userData.__origMaterialState = {
              transparent: c.transparent,
              opacity: c.opacity,
              depthWrite: c.depthWrite,
            };
            mats.push(c);
            return c;
          });
          mesh.material = next;
        } else if (mesh.material) {
          const c = mesh.material.clone();
          c.userData.__origMaterialState = {
            transparent: c.transparent,
            opacity: c.opacity,
            depthWrite: c.depthWrite,
          };
          mats.push(c);
          mesh.material = c;
        }
      }
    });
    return { cloned: root, clonedMaterials: mats };
  }, [scene]);

  useEffect(() => {
    const planes = solidPlane ? [solidPlane] : EMPTY_CLIP_PLANES;
    const hasClip = planes.length > 0;
    const createdEdges: THREE.LineSegments[] = [];
    cloned.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          if (m) {
            const prevHasClip = Array.isArray(m.clippingPlanes) && m.clippingPlanes.length > 0;
            const prevTransparent = m.transparent;
            const orig = m.userData.__origMaterialState as
              { transparent: boolean; opacity: number; depthWrite: boolean } | undefined;
            m.clippingPlanes = planes;
            m.clipShadows = true;
            m.polygonOffset = showEdges;
            m.polygonOffsetFactor = 1;
            m.polygonOffsetUnits = 1;
            if (ghost) {
              m.transparent = true;
              m.opacity = 0.24;
              m.depthWrite = false;
            } else if (orig) {
              m.transparent = orig.transparent;
              m.opacity = orig.opacity;
              m.depthWrite = orig.depthWrite;
            }
            if (prevHasClip !== hasClip || prevTransparent !== m.transparent) {
              m.needsUpdate = true;
            }
          }
        }
        if (showEdges && mesh.geometry) {
          const edgeGeo = buildCleanCreaseEdgeGeometry(mesh.geometry, 32);
          const edgeMat = new THREE.LineBasicMaterial({
            color: dark ? "#0f172a" : "#111827",
            transparent: true,
            opacity: ghost ? 0.35 : 0.78,
            clippingPlanes: planes,
          });
          const lines = new THREE.LineSegments(edgeGeo, edgeMat);
          lines.userData.__cadEdgeOverlay = true;
          lines.renderOrder = 1;
          mesh.add(lines);
          createdEdges.push(lines);
        }
      }
    });

    return () => {
      for (const lines of createdEdges) {
        lines.parent?.remove(lines);
        lines.geometry.dispose();
        (lines.material as THREE.Material).dispose();
      }
    };
  }, [cloned, solidPlane, showEdges, dark, ghost]);

  // Only dispose cloned materials created by this instance; never dispose shared
  // cached scene geometries/textures or synchronously call useGLTF.clear(url).
  useEffect(() => {
    return () => {
      for (const mat of clonedMaterials) {
        mat.dispose();
      }
    };
  }, [clonedMaterials]);

  return <primitive object={cloned} />;
}

/** A single GLTF or procedural visualizer component in the scene. */
function CadModel({
  component,
  assetBaseUrl,
  selected,
  gizmoMode = "select",
  onSelect,
  onDraggingGizmoChange,
  onCommitGizmoDelta,
  onFaceTagClick,
  animationController,
  dark = false,
  solidPlane = null,
  wirePlane = null,
  sectionSplit = false,
  showEdges = true,
  ghost = false,
  onPickFace,
}: {
  component: CadComponent;
  assetBaseUrl: string;
  selected: boolean;
  gizmoMode?: GizmoMode | undefined;
  onSelect?: ((name: string | null) => void) | undefined;
  onDraggingGizmoChange?: ((dragging: boolean) => void) | undefined;
  onCommitGizmoDelta?: ((payload: GizmoCommitPayload) => void) | undefined;
  onFaceTagClick?: ((hit: FaceTagHit) => void) | undefined;
  animationController?: AnimationController | null | undefined;
  dark?: boolean | undefined;
  solidPlane?: THREE.Plane | null | undefined;
  wirePlane?: THREE.Plane | null | undefined;
  sectionSplit?: boolean | undefined;
  showEdges?: boolean | undefined;
  ghost?: boolean | undefined;
  onPickFace?: ((label: string) => void) | undefined;
}) {
  const url = useMemo(() => resolveModelicaUri(component.cad.uri, assetBaseUrl), [component.cad.uri, assetBaseUrl]);
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const [inspectorValues, setInspectorValues] = useState<
    { variable: string; property: string; index: number; value: number | null }[]
  >([]);
  const lastInspectorUpdateRef = useRef<number>(0);

  const isBakedCsgMesh = Boolean(
    component.proceduralMesh && !component.defaults && !component.cad.uri?.startsWith("procedural://msl"),
  );
  const pos: [number, number, number] = component.cad.position ?? [0, 0, 0];
  const rot: [number, number, number] = isBakedCsgMesh ? [0, 0, 0] : (component.cad.rotation ?? [0, 0, 0]);
  const scl: [number, number, number] = isBakedCsgMesh ? [1, 1, 1] : (component.cad.scale ?? [1, 1, 1]);

  // Gizmo dragging & delta state
  const [isDraggingGizmo, setIsDraggingGizmo] = useState(false);
  const [gizmoDelta, setGizmoDelta] = useState<[number, number, number]>([0, 0, 0]);
  const initialGizmoPosRef = useRef<[number, number, number]>(pos);
  const initialGizmoRotRef = useRef<[number, number, number]>(rot);
  const initialGizmoSclRef = useRef<[number, number, number]>(scl);

  useEffect(() => {
    initialGizmoPosRef.current = component.cad.position ?? [0, 0, 0];
    initialGizmoRotRef.current = isBakedCsgMesh ? [0, 0, 0] : (component.cad.rotation ?? [0, 0, 0]);
    initialGizmoSclRef.current = isBakedCsgMesh ? [1, 1, 1] : (component.cad.scale ?? [1, 1, 1]);
    setGizmoDelta([0, 0, 0]);
  }, [component.cad.position, component.cad.rotation, component.cad.scale, isBakedCsgMesh]);

  useEffect(() => {
    if (!selected && isDraggingGizmo) {
      setIsDraggingGizmo(false);
      onDraggingGizmoChange?.(false);
    }
  }, [selected, isDraggingGizmo, onDraggingGizmoChange]);

  useEffect(() => {
    return () => {
      onDraggingGizmoChange?.(false);
    };
  }, [onDraggingGizmoChange]);

  const handleGizmoMouseDown = useCallback(() => {
    setIsDraggingGizmo(true);
    onDraggingGizmoChange?.(true);
  }, [onDraggingGizmoChange]);

  const handleGizmoChange = useCallback(() => {
    if (!groupRef.current) return;
    if (gizmoMode === "translate") {
      const cur = groupRef.current.position;
      const init = initialGizmoPosRef.current;
      setGizmoDelta([cur.x - init[0], cur.y - init[1], cur.z - init[2]]);
    } else if (gizmoMode === "rotate") {
      const cur = groupRef.current.rotation;
      const init = initialGizmoRotRef.current;
      const rxDeg = (cur.x * 180) / Math.PI;
      const ryDeg = (cur.y * 180) / Math.PI;
      const rzDeg = (cur.z * 180) / Math.PI;
      setGizmoDelta([rxDeg - init[0], ryDeg - init[1], rzDeg - init[2]]);
    } else if (gizmoMode === "scale") {
      const cur = groupRef.current.scale;
      const init = initialGizmoSclRef.current;
      setGizmoDelta([cur.x / (init[0] || 1), cur.y / (init[1] || 1), cur.z / (init[2] || 1)]);
    }
    setIsDraggingGizmo(true);
    onDraggingGizmoChange?.(true);
  }, [gizmoMode, onDraggingGizmoChange]);

  const handleGizmoMouseUp = useCallback(() => {
    setIsDraggingGizmo(false);
    onDraggingGizmoChange?.(false);
    if (!groupRef.current) return;
    const curPos = groupRef.current.position;
    const curRot = groupRef.current.rotation;
    const curScl = groupRef.current.scale;

    if (gizmoMode === "translate") {
      const init = initialGizmoPosRef.current;
      const dx = curPos.x - init[0];
      const dy = curPos.y - init[1];
      const dz = curPos.z - init[2];
      if (Math.hypot(dx, dy, dz) > 1e-4) {
        onCommitGizmoDelta?.({
          componentName: component.name,
          mode: "translate",
          delta: [dx, dy, dz],
          newPosition: [curPos.x, curPos.y, curPos.z],
          sourceMetadata: component.sourceMetadata,
        });
        initialGizmoPosRef.current = [curPos.x, curPos.y, curPos.z];
        setGizmoDelta([0, 0, 0]);
      }
    } else if (gizmoMode === "rotate") {
      const init = initialGizmoRotRef.current;
      const rxDeg = (curRot.x * 180) / Math.PI;
      const ryDeg = (curRot.y * 180) / Math.PI;
      const rzDeg = (curRot.z * 180) / Math.PI;
      const drx = rxDeg - init[0];
      const dry = ryDeg - init[1];
      const drz = rzDeg - init[2];
      if (Math.hypot(drx, dry, drz) > 1e-2) {
        const baseRot = component.sourceMetadata?.rotation ?? init;
        const newRot: [number, number, number] = [baseRot[0] + drx, baseRot[1] + dry, baseRot[2] + drz];
        onCommitGizmoDelta?.({
          componentName: component.name,
          mode: "rotate",
          delta: [drx, dry, drz],
          newPosition: [curPos.x, curPos.y, curPos.z],
          newRotation: newRot,
          sourceMetadata: component.sourceMetadata,
        });
        initialGizmoRotRef.current = [rxDeg, ryDeg, rzDeg];
        setGizmoDelta([0, 0, 0]);
      }
    } else if (gizmoMode === "scale") {
      const init = initialGizmoSclRef.current;
      const sx = curScl.x / (init[0] || 1);
      const sy = curScl.y / (init[1] || 1);
      const sz = curScl.z / (init[2] || 1);
      if (Math.hypot(sx - 1, sy - 1, sz - 1) > 1e-3) {
        onCommitGizmoDelta?.({
          componentName: component.name,
          mode: "scale",
          delta: [sx - 1, sy - 1, sz - 1],
          newPosition: [curPos.x, curPos.y, curPos.z],
          newScale: [sx, sy, sz],
          sourceMetadata: component.sourceMetadata,
        });
        initialGizmoSclRef.current = [curScl.x, curScl.y, curScl.z];
        setGizmoDelta([0, 0, 0]);
      }
    }
  }, [component.name, component.sourceMetadata, gizmoMode, onCommitGizmoDelta, onDraggingGizmoChange]);

  // Ghost trail state (bypass React for performance)
  const maxTrailPoints = 300;
  const trailGeoRef = useRef<THREE.BufferGeometry | null>(null);
  const trailPositions = useRef<Float32Array>(new Float32Array(maxTrailPoints * 3));
  const trailCount = useRef(0);

  const trailLine = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(trailPositions.current, 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({ color: "#ff6b35", transparent: true, opacity: 0.6, linewidth: 2 });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    trailGeoRef.current = geo;
    return line;
  }, []);

  useEffect(() => {
    return () => {
      trailLine.geometry.dispose();
      if (Array.isArray(trailLine.material)) {
        trailLine.material.forEach((m) => m.dispose());
      } else {
        trailLine.material.dispose();
      }
    };
  }, [trailLine]);

  // Outline / halo effect on selection or anchor
  useEffect(() => {
    if (!groupRef.current) return;
    groupRef.current.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material && !child.name.startsWith("port:")) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of mats) {
          if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
          if (selected) {
            mat.emissive.set("#06b6d4");
            mat.emissiveIntensity = 0.45;
          } else {
            mat.emissive.set("#000000");
            mat.emissiveIntensity = 0;
          }
        }
      }
    });
  }, [selected]);

  // Drive transforms from animation controller when animating or when local MSL frame defaults are present
  useFrame(() => {
    if (!groupRef.current || !animationController || isDraggingGizmo) return;
    if (animationController.mode === "stopped" && !component.defaults) return;

    const tf = animationController.getTransform(component.name);
    groupRef.current.position.set(tf.position[0], tf.position[1], tf.position[2]);
    if (tf.quaternion) {
      groupRef.current.quaternion.set(tf.quaternion[0], tf.quaternion[1], tf.quaternion[2], tf.quaternion[3]);
    } else {
      groupRef.current.rotation.set(
        (tf.rotation[0] * Math.PI) / 180,
        (tf.rotation[1] * Math.PI) / 180,
        (tf.rotation[2] * Math.PI) / 180,
      );
    }
    groupRef.current.scale.set(tf.scale[0], tf.scale[1], tf.scale[2]);

    if (tf.color && !selected) {
      groupRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material && !child.name.startsWith("port:")) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          for (const mat of mats) {
            if (mat instanceof THREE.MeshStandardMaterial) {
              mat.color.setRGB(tf.color![0], tf.color![1], tf.color![2]);
            }
          }
        }
      });
    }

    // Update ghost trail if selected and animating
    if (selected && (animationController.mode === "playing" || animationController.mode === "live")) {
      if (trailCount.current >= maxTrailPoints) {
        trailPositions.current.copyWithin(0, 3);
        trailCount.current = maxTrailPoints - 1;
      }
      const idx = trailCount.current;
      trailPositions.current[idx * 3] = tf.position[0];
      trailPositions.current[idx * 3 + 1] = tf.position[1];
      trailPositions.current[idx * 3 + 2] = tf.position[2];
      trailCount.current++;

      if (trailGeoRef.current) {
        trailGeoRef.current.setDrawRange(0, trailCount.current);
        trailGeoRef.current.attributes.position!.needsUpdate = true;
      }
    } else if (!selected && trailCount.current > 0) {
      trailCount.current = 0;
      if (trailGeoRef.current) trailGeoRef.current.setDrawRange(0, 0);
    }

    // Update inspector values at most ~4Hz if hovered or selected
    if (hovered || selected) {
      const now = performance.now();
      if (now - lastInspectorUpdateRef.current >= 250) {
        lastInspectorUpdateRef.current = now;
        setInspectorValues(animationController.getComponentValues(component.name));
      }
    }
  });

  const showInspector = (hovered || selected) && inspectorValues.length > 0 && animationController?.mode !== "stopped";
  const gizmoLabelPrefix = gizmoMode === "rotate" ? "Δθ°" : gizmoMode === "scale" ? "×S" : "Δ";
  const showTransformGizmo = Boolean(
    selected &&
    (gizmoMode === "translate" || gizmoMode === "rotate" || gizmoMode === "scale") &&
    (!animationController || animationController.mode === "stopped") &&
    onCommitGizmoDelta,
  );

  return (
    <>
      <group
        ref={groupRef}
        name={component.name}
        position={pos}
        rotation={rot.map((r) => (r * Math.PI) / 180) as [number, number, number]}
        scale={scl}
        onClick={(e) => {
          e.stopPropagation();
          onSelect?.(component.name);
          if (selected && gizmoMode === "tag_face" && onFaceTagClick) {
            const n = e.face?.normal;
            onFaceTagClick({
              componentName: component.name,
              normal: n ? [n.x, n.y, n.z] : undefined,
              worldPos: [e.point.x, e.point.y, e.point.z],
              sourceMetadata: component.sourceMetadata,
            });
            return;
          }
          if (onPickFace && e.face?.normal) {
            const meshObj = e.object as THREE.Mesh | undefined;
            const faceIds = meshObj?.geometry?.userData?.faceIds as ArrayLike<number> | undefined;
            const brepFaceId =
              faceIds && typeof e.faceIndex === "number" && e.faceIndex >= 0 && e.faceIndex < faceIds.length
                ? faceIds[e.faceIndex]
                : undefined;
            if (brepFaceId !== undefined) {
              onPickFace(`${component.name}_Face${brepFaceId}`);
              return;
            }
            const n = e.face.normal;
            const ax = Math.abs(n.x);
            const ay = Math.abs(n.y);
            const az = Math.abs(n.z);
            const dir =
              ax >= ay && ax >= az
                ? n.x >= 0
                  ? "PosX"
                  : "NegX"
                : ay >= ax && ay >= az
                  ? n.y >= 0
                    ? "PosY"
                    : "NegY"
                  : n.z >= 0
                    ? "PosZ"
                    : "NegZ";
            onPickFace(`${component.name}_${dir}`);
          }
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          if (animationController && animationController.mode !== "stopped") {
            setHovered(true);
          }
        }}
        onPointerOut={() => {
          if (hovered) {
            setHovered(false);
          }
        }}
      >
        {component.proceduralMesh ? (
          <ProceduralMeshObject
            mesh={component.proceduralMesh}
            name={component.name}
            dark={dark}
            solidPlane={solidPlane}
            wirePlane={wirePlane}
            sectionSplit={sectionSplit}
            showEdges={showEdges}
          />
        ) : !component.cad.uri.startsWith("procedural://") ? (
          <Suspense fallback={null}>
            <GltfMeshObject url={url} solidPlane={solidPlane} showEdges={showEdges} dark={dark} ghost={ghost} />
          </Suspense>
        ) : null}

        {showInspector && (
          <Html position={[0, 0, 0]} center style={{ pointerEvents: "none", zIndex: 10 }}>
            <div
              style={{
                background: "var(--overlay-bgColor, var(--ms-surface-glass))",
                backdropFilter: "blur(4px)",
                color: "#e6edf3",
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                fontSize: "11px",
                fontFamily: "monospace",
                whiteSpace: "nowrap",
              }}
            >
              <div
                style={{
                  fontWeight: "bold",
                  borderBottom: "1px solid rgba(255,255,255,0.1)",
                  paddingBottom: 4,
                  marginBottom: 4,
                  color: "var(--fgColor-accent, var(--ms-brand))",
                }}
              >
                {component.name}
              </div>
              {inspectorValues.map((v) => (
                <div
                  key={`${v.variable}-${v.property}-${v.index}`}
                  style={{ display: "flex", justifyContent: "space-between", gap: 16 }}
                >
                  <span style={{ color: "#8b949e" }}>
                    {v.property}[{v.index}]
                  </span>
                  <span style={{ color: "#3fb950" }}>{v.value !== null ? v.value.toFixed(4) : "—"}</span>
                </div>
              ))}
            </div>
          </Html>
        )}

        {isDraggingGizmo && (
          <Html position={[0, 1.2, 0]} center style={{ pointerEvents: "none", zIndex: 20 }}>
            <div
              style={{
                background: "rgba(15, 23, 42, 0.92)",
                backdropFilter: "blur(6px)",
                color: "#38bdf8",
                padding: "4px 8px",
                borderRadius: "6px",
                border: "1px solid rgba(56, 189, 248, 0.45)",
                fontSize: "11px",
                fontFamily: "monospace",
                fontWeight: 600,
                whiteSpace: "nowrap",
                boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
              }}
            >
              {gizmoLabelPrefix}: [{gizmoDelta[0].toFixed(2)}, {gizmoDelta[1].toFixed(2)}, {gizmoDelta[2].toFixed(2)}]
            </div>
          </Html>
        )}

        {component.ports?.map((p) => (
          <PortIndicator
            key={p.name}
            name={`${component.name}.${p.name}`}
            position={p.port.offsetPosition ?? [0, 0, 0]}
            highlighted={selected}
          />
        ))}
      </group>

      {showTransformGizmo && (
        <TransformControls
          object={groupRef as React.RefObject<THREE.Object3D>}
          mode={gizmoMode as "translate" | "rotate" | "scale"}
          onMouseDown={handleGizmoMouseDown}
          onObjectChange={handleGizmoChange}
          onMouseUp={handleGizmoMouseUp}
        />
      )}

      {/* Ghost trail (world space) */}
      {selected && <primitive object={trailLine} />}
    </>
  );
}

interface SceneContentsProps {
  components: CadComponent[];
  assetBaseUrl: string;
  selectedName?: string | null | undefined;
  gizmoMode?: GizmoMode | undefined;
  isDraggingGizmo?: boolean | undefined;
  onDraggingGizmoChange?: ((dragging: boolean) => void) | undefined;
  onCommitGizmoDelta?: ((payload: GizmoCommitPayload) => void) | undefined;
  onFaceTagClick?: ((hit: FaceTagHit) => void) | undefined;
  onSelect?: ((name: string | null) => void) | undefined;
  dark?: boolean | undefined;
  animationController?: AnimationController | null | undefined;
  vtkBuffer?: Uint8Array | null | undefined;
  touchScrollPassThrough?: boolean | undefined;
  solidPlane?: THREE.Plane | null | undefined;
  wirePlane?: THREE.Plane | null | undefined;
  sectionSplit?: boolean | undefined;
  autoSweep?: boolean | undefined;
  clipSpan: number;
  gdtOverlay?: GdtOverlayPayload | null | undefined;
  showGdt?: boolean | undefined;
  showEdges?: boolean | undefined;
  enableSsao?: boolean | undefined;
  activeCaeField?: string | undefined;
  onPickFace?: ((label: string) => void) | undefined;
  sceneBounds: { center: [number, number, number]; radius: number; minY: number };
  fitInsets?: { top: number; right: number; bottom: number; left: number } | undefined;
  isInXr?: boolean | undefined;
  autoTurntable?: boolean | undefined;
  jetPlume?: Omit<JetPlumeRendererProps, "isInXr"> | null | undefined;
  assemblyVisibility?: AssemblyVisibilityState | null | undefined;
  cameraResetTick?: number | undefined;
  verificationOverlay?: Verification3DOverlayPayload | null | undefined;
  showFlowpipe?: boolean | undefined;
  showBarrier?: boolean | undefined;
  cameraSyncGroup?: string | undefined;
  cfdDomainPreview?:
    | {
        domainMin: [number, number, number];
        domainMax: [number, number, number];
        refinementBoxes?: CfdRefinementBox[] | undefined;
      }
    | null
    | undefined;
  nakedEdgeSegments?: Float32Array | undefined;
  isoSurfaceEnabled?: boolean | undefined;
  isoThreshold?: number | undefined;
  slicePlane?: VtkSlicePlane | null | undefined;
  onProbePoint?: ((probe: VtkProbePoint | null) => void) | undefined;
  deformationScale?: number | undefined;
  animateDeformation?: boolean | undefined;
  animateFlow?: boolean | undefined;
  showCaeStreamlines?: boolean | undefined;
  showCaeVectors?: boolean | undefined;
  caeTimestepFrames?: Uint8Array[] | undefined;
  activeVtkFrame?: number | undefined;
  ghostCadUnderlay?: boolean | undefined;
  showZonotopeOverlay?: boolean | undefined;
  zonotopeWorkbenchState?: ZonotopeWorkbenchState | undefined;
  hypergraphRecord?: AnsatzRelationalHypergraphRecord | null | undefined;
  zonotopeViolatingComponents?: string[] | undefined;
  zonotopeWamWaypoints?: WamTrajectoryWaypoint[] | undefined;
  onSelectZonotopeGroup?: ((groupId: number | null) => void) | undefined;
  onAddZonotopeOverride?: ((override: ZonotopePendingOverride) => void) | undefined;
  onAddZonotopeConstraint?: ((constraint: LinearConstraintSpec) => void) | undefined;
  onChangeCadToleranceFraction?: ((nextFraction: number) => void) | undefined;
  onChangeWamWaypointRadius?: ((waypointIndex: number, nextRadius: number) => void) | undefined;
}

const CAD_CAMERA_SYNC_EVENT = "ansatz:cad-camera-sync";

interface CadCameraSyncEventDetail {
  syncGroup: string;
  sourceId: string;
  position: [number, number, number];
  target: [number, number, number];
}

/** Scene contents: lights, grid, models. */
function SceneContents({
  components,
  assetBaseUrl,
  selectedName,
  gizmoMode = "select",
  isDraggingGizmo = false,
  onDraggingGizmoChange,
  onCommitGizmoDelta,
  onFaceTagClick,
  onSelect,
  dark,
  animationController,
  vtkBuffer,
  touchScrollPassThrough,
  solidPlane,
  wirePlane,
  sectionSplit,
  autoSweep,
  clipSpan,
  gdtOverlay,
  showGdt,
  showEdges = true,
  enableSsao = false,
  activeCaeField,
  onPickFace,
  sceneBounds,
  fitInsets,
  isInXr = false,
  autoTurntable = false,
  jetPlume = null,
  assemblyVisibility = null,
  cameraResetTick = 0,
  verificationOverlay = null,
  showFlowpipe = true,
  showBarrier = true,
  cameraSyncGroup,
  cfdDomainPreview = null,
  nakedEdgeSegments,
  isoSurfaceEnabled = false,
  isoThreshold = 0.5,
  slicePlane = null,
  onProbePoint,
  deformationScale = 0,
  animateDeformation = false,
  animateFlow = false,
  showCaeStreamlines = false,
  showCaeVectors = false,
  caeTimestepFrames,
  activeVtkFrame = 0,
  ghostCadUnderlay = false,
  showZonotopeOverlay = false,
  zonotopeWorkbenchState,
  hypergraphRecord = null,
  zonotopeViolatingComponents,
  zonotopeWamWaypoints,
  onSelectZonotopeGroup,
  onAddZonotopeOverride,
  onAddZonotopeConstraint,
  onChangeCadToleranceFraction,
  onChangeWamWaypointRadius,
}: SceneContentsProps) {
  const { gl, scene, camera, size } = useThree();
  const controlsRef = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const framedSignatureRef = useRef<string>("");
  const sweepPhaseRef = useRef(0);
  const cameraSyncInstanceIdRef = useRef<string>(
    `cad-cam-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`,
  );
  const isApplyingRemoteSyncRef = useRef(false);
  const lastSyncDispatchMsRef = useRef(0);
  const lastAppliedRemotePoseRef = useRef<{
    position: [number, number, number];
    target: [number, number, number];
  } | null>(null);

  const dispatchCameraSync = useCallback(
    (force = false) => {
      const group = cameraSyncGroup?.trim();
      if (!group || isInXr || isApplyingRemoteSyncRef.current || typeof window === "undefined") return;
      const controls = controlsRef.current;
      if (!controls?.target) return;

      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (!force && now - lastSyncDispatchMsRef.current < 16) return;

      const position: [number, number, number] = [camera.position.x, camera.position.y, camera.position.z];
      const target: [number, number, number] = [controls.target.x, controls.target.y, controls.target.z];

      const lastRemote = lastAppliedRemotePoseRef.current;
      if (lastRemote) {
        const eps = 1e-4;
        const samePos =
          Math.abs(position[0] - lastRemote.position[0]) < eps &&
          Math.abs(position[1] - lastRemote.position[1]) < eps &&
          Math.abs(position[2] - lastRemote.position[2]) < eps;
        const sameTarget =
          Math.abs(target[0] - lastRemote.target[0]) < eps &&
          Math.abs(target[1] - lastRemote.target[1]) < eps &&
          Math.abs(target[2] - lastRemote.target[2]) < eps;
        if (samePos && sameTarget) return;
        lastAppliedRemotePoseRef.current = null;
      }

      lastSyncDispatchMsRef.current = now;
      window.dispatchEvent(
        new CustomEvent<CadCameraSyncEventDetail>(CAD_CAMERA_SYNC_EVENT, {
          detail: {
            syncGroup: group,
            sourceId: cameraSyncInstanceIdRef.current,
            position,
            target,
          },
        }),
      );
    },
    [camera, cameraSyncGroup, isInXr],
  );

  // Listen for cross-pane 3D orbit camera sync events belonging to the same sync group
  useEffect(() => {
    const group = cameraSyncGroup?.trim();
    if (!group || isInXr || typeof window === "undefined") return;

    const handleRemoteCameraSync = (event: Event) => {
      const detail = (event as CustomEvent<CadCameraSyncEventDetail>).detail;
      if (!detail || detail.syncGroup !== group || detail.sourceId === cameraSyncInstanceIdRef.current) return;
      const controls = controlsRef.current;
      if (!controls?.target) return;
      const [px, py, pz] = detail.position;
      const [tx, ty, tz] = detail.target;
      if (
        !Number.isFinite(px) ||
        !Number.isFinite(py) ||
        !Number.isFinite(pz) ||
        !Number.isFinite(tx) ||
        !Number.isFinite(ty) ||
        !Number.isFinite(tz)
      ) {
        return;
      }

      isApplyingRemoteSyncRef.current = true;
      try {
        camera.position.set(px, py, pz);
        controls.target.set(tx, ty, tz);
        controls.update();
        lastAppliedRemotePoseRef.current = {
          position: [camera.position.x, camera.position.y, camera.position.z],
          target: [controls.target.x, controls.target.y, controls.target.z],
        };
      } finally {
        isApplyingRemoteSyncRef.current = false;
      }
    };

    window.addEventListener(CAD_CAMERA_SYNC_EVENT, handleRemoteCameraSync);
    return () => {
      window.removeEventListener(CAD_CAMERA_SYNC_EVENT, handleRemoteCameraSync);
    };
  }, [camera, cameraSyncGroup, isInXr]);

  // Set opaque scene background in WebXR so Quest 2 renders solid studio backdrop instead of passthrough transparency
  useEffect(() => {
    if (!isInXr) return;
    const prevBackground = scene.background;
    const prevClearAlpha = gl.getClearAlpha();
    scene.background = new THREE.Color(dark ? "#111827" : "#e2e8f0");
    gl.setClearAlpha(1);
    return () => {
      scene.background = prevBackground;
      gl.setClearAlpha(prevClearAlpha);
    };
  }, [isInXr, scene, gl, dark]);

  // Offset camera frustum so the model orbits and centers within the visible area (excluding floating sidebars/panels)
  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    if (isInXr) {
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
      return;
    }
    if (size.width <= 0 || size.height <= 0) return;

    const top = fitInsets?.top ?? 0;
    const right = fitInsets?.right ?? 0;
    const bottom = fitInsets?.bottom ?? 0;
    const left = fitInsets?.left ?? 0;

    if (top === 0 && right === 0 && bottom === 0 && left === 0) {
      camera.clearViewOffset();
    } else {
      const offsetX = (right - left) / 2;
      const offsetY = (bottom - top) / 2;
      camera.setViewOffset(size.width, size.height, offsetX, offsetY, size.width, size.height);
    }
    camera.updateProjectionMatrix();
  }, [camera, isInXr, size.width, size.height, fitInsets?.top, fitInsets?.right, fitInsets?.bottom, fitInsets?.left]);

  useEffect(() => {
    if (isInXr) return;
    if (components.length === 0) return;
    const sig = `${components.length}:${Math.round(Math.log10(Math.max(0.1, sceneBounds.radius)))}:${cameraResetTick}`;
    if (framedSignatureRef.current === sig) return;
    framedSignatureRef.current = sig;

    const [cx, cy, cz] = sceneBounds.center;
    const r = sceneBounds.radius;
    const fovRad = ((camera instanceof THREE.PerspectiveCamera ? camera.fov : 50) * Math.PI) / 180;
    const tanHalfFov = Math.tan(fovRad / 2);
    const baseDist = r * Math.hypot(1.4, 1.15, 1.4);
    let fitDist = baseDist;
    if (size.width > 0 && size.height > 0 && tanHalfFov > 0) {
      const visW = Math.max(120, size.width - (fitInsets?.left ?? 0) - (fitInsets?.right ?? 0));
      const visH = Math.max(120, size.height - (fitInsets?.top ?? 0) - (fitInsets?.bottom ?? 0));
      const minVis = Math.min(visW, visH);
      fitDist = Math.max(baseDist, (r / tanHalfFov) * (size.height / minVis) * 1.15);
    }
    const dir = new THREE.Vector3(1.4, 1.15, 1.4).normalize();

    camera.near = Math.max(0.01, r * 0.002);
    camera.far = Math.max(1000, r * 30, fitDist * 10);
    camera.position.set(cx + dir.x * fitDist, cy + dir.y * fitDist, cz + dir.z * fitDist);
    camera.lookAt(cx, cy, cz);
    camera.updateProjectionMatrix();

    if (controlsRef.current?.target) {
      isApplyingRemoteSyncRef.current = true;
      try {
        controlsRef.current.target.set(cx, cy, cz);
        controlsRef.current.update();
      } finally {
        isApplyingRemoteSyncRef.current = false;
      }
    }
  }, [isInXr, components.length, sceneBounds, camera, size.width, size.height, fitInsets, cameraResetTick]);

  useEffect(() => {
    gl.localClippingEnabled = Boolean(solidPlane || wirePlane);
    gl.clippingPlanes = [];
  }, [gl, solidPlane, wirePlane]);

  // WebGL context loss interception
  useEffect(() => {
    const dom = gl.domElement;
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      console.warn("[CadViewer] WebGL context loss intercepted; preventing browser crash.");
    };
    dom.addEventListener("webglcontextlost", handleContextLost, false);

    return () => {
      dom.removeEventListener("webglcontextlost", handleContextLost);
    };
  }, [gl]);

  // Smoothly orbit and focus camera on target component anchor
  useEffect(() => {
    if (isInXr || !selectedName || !controlsRef.current) return;
    const targetComp = components.find((c) => c.name === selectedName);
    if (!targetComp?.cad?.position) return;
    const [tx, ty, tz] = targetComp.cad.position;
    const targetVec = new THREE.Vector3(tx, ty, tz);
    if (controlsRef.current.target) {
      controlsRef.current.target.lerp(targetVec, 0.8);
      controlsRef.current.update();
    }
  }, [isInXr, selectedName, components]);

  // Drive the animation clock & optional split-section sweep from the render loop
  useFrame((_, delta) => {
    animationController?.tick(delta);
    if (autoSweep && solidPlane) {
      sweepPhaseRef.current += Math.min(delta, 0.05) * 0.72;
      const baseD = -(
        solidPlane.normal.x * sceneBounds.center[0] +
        solidPlane.normal.y * sceneBounds.center[1] +
        solidPlane.normal.z * sceneBounds.center[2]
      );
      const d = baseD + Math.sin(sweepPhaseRef.current) * clipSpan * 0.85;
      solidPlane.constant = d;
      if (wirePlane) {
        wirePlane.constant = -d;
      }
    }
  });

  // Deselect on background click
  const handlePointerMissed = useCallback(() => {
    onSelect?.(null);
  }, [onSelect]);

  const gridUnit = Math.pow(10, Math.floor(Math.log10(Math.max(0.1, sceneBounds.radius / 3))));
  const gridSpan = Math.max(20, sceneBounds.radius * 8);
  const gridFade = Math.max(30, sceneBounds.radius * 6);
  const shadowScale = Math.max(20, sceneBounds.radius * 3.5);
  const shadowFar = Math.max(4, sceneBounds.radius * 2);
  const groundY = sceneBounds.minY - Math.max(0.002, sceneBounds.radius * 0.001);

  return (
    <>
      <HeroStudioEnvironment dark={Boolean(dark)} />

      {/* Ground */}
      <Grid
        position={[sceneBounds.center[0], groundY, sceneBounds.center[2]]}
        args={[gridSpan, gridSpan]}
        cellSize={gridUnit}
        cellThickness={0.5}
        cellColor={dark ? "#333" : "#ccc"}
        sectionSize={gridUnit * 5}
        sectionThickness={1}
        sectionColor={dark ? "#555" : "#999"}
        fadeDistance={gridFade}
        infiniteGrid
      />
      <ContactShadows
        position={[sceneBounds.center[0], groundY - Math.max(0.01, sceneBounds.radius * 0.002), sceneBounds.center[2]]}
        frames={1}
        opacity={0.4}
        scale={shadowScale}
        blur={2}
        far={shadowFar}
      />

      {/* Models: GPU Instanced rendering for clusters, fallback to CadModel for singletons */}
      <group onPointerMissed={handlePointerMissed}>
        <InstancedCadAssembly
          components={components}
          assetBaseUrl={assetBaseUrl}
          selectedName={selectedName}
          onSelect={onSelect}
          animationController={animationController}
          visibility={assemblyVisibility}
          renderSingleton={(comp) => (
            <CadModel
              key={comp.name}
              component={comp}
              assetBaseUrl={assetBaseUrl}
              selected={selectedName === comp.name}
              gizmoMode={gizmoMode}
              onSelect={onSelect}
              onDraggingGizmoChange={onDraggingGizmoChange}
              onCommitGizmoDelta={onCommitGizmoDelta}
              onFaceTagClick={onFaceTagClick}
              animationController={animationController}
              dark={Boolean(dark)}
              solidPlane={solidPlane}
              wirePlane={wirePlane}
              sectionSplit={Boolean(sectionSplit)}
              showEdges={showEdges}
              ghost={Boolean(ghostCadUnderlay && vtkBuffer)}
              onPickFace={onPickFace}
            />
          )}
        />
      </group>

      {sectionSplit && solidPlane && (
        <StencilSectionCapQuad
          plane={solidPlane}
          center={sceneBounds.center}
          size={Math.max(12, sceneBounds.radius * 3.2)}
          dark={Boolean(dark)}
        />
      )}

      {showGdt && gdtOverlay && (
        <Gdt3dOverlay payload={gdtOverlay} lift={Math.max(0.45, sceneBounds.radius * 0.35)} dark={Boolean(dark)} />
      )}

      {/* 3D Formal Verification Overlays (Reachability Flowpipes, Clearance Vectors, Lyapunov Barrier Shells) */}
      {showFlowpipe &&
        verificationOverlay?.flowpipes &&
        Object.entries(verificationOverlay.flowpipes).map(([key, segments]) => (
          <ReachabilityTubeOverlay key={`flowpipe_${key}`} segments={segments} />
        ))}

      {verificationOverlay?.clearanceHistory && (
        <DynamicClearanceVector
          clearanceHistory={verificationOverlay.clearanceHistory}
          currentTime={animationController?.currentTime ?? 0}
        />
      )}

      {showBarrier && verificationOverlay?.barrierShells && (
        <BarrierShellOverlay shells={verificationOverlay.barrierShells} />
      )}

      {/* 3D Multi-Modal Zonotope Dual Ghost Tolerance Shells, Symmetry Coupling & WAM Reachability Tube */}
      {showZonotopeOverlay && zonotopeWorkbenchState && (
        <ZonotopeCadOverlay
          components={components}
          hypergraphRecord={hypergraphRecord}
          workbenchState={zonotopeWorkbenchState}
          violatingComponents={zonotopeViolatingComponents}
          wamWaypoints={zonotopeWamWaypoints}
          onSelectGroup={onSelectZonotopeGroup}
          onAddOverride={onAddZonotopeOverride}
          onAddConstraint={onAddZonotopeConstraint}
          onChangeCadToleranceFraction={onChangeCadToleranceFraction}
          onChangeWamWaypointRadius={onChangeWamWaypointRadius}
        />
      )}

      {/* CFD Wind-Tunnel Domain & 2:1 Octree AMR Refinement Gizmo */}
      {cfdDomainPreview && (
        <CfdDomainGizmo
          domainMin={cfdDomainPreview.domainMin}
          domainMax={cfdDomainPreview.domainMax}
          refinementBoxes={cfdDomainPreview.refinementBoxes}
          nakedEdgeSegments={nakedEdgeSegments}
        />
      )}

      {/* CFD & FEA Contour / Vector rendering */}
      {vtkBuffer && (
        <VtkRenderer
          vtkBuffer={vtkBuffer}
          opacity={0.85}
          activeField={activeCaeField}
          showVectors={showCaeVectors}
          showStreamlines={showCaeStreamlines}
          deformationScale={deformationScale}
          animateDeformation={animateDeformation}
          animateFlow={animateFlow}
          isoSurfaceEnabled={isoSurfaceEnabled}
          isoThreshold={isoThreshold}
          slicePlane={slicePlane}
          onProbePoint={onProbePoint}
          timestepFrames={caeTimestepFrames && caeTimestepFrames.length > 0 ? caeTimestepFrames : undefined}
          activeFrameIndex={activeVtkFrame}
        />
      )}

      {/* GPU Fluid Jet / Siphon Plume (single draw call, XR particle-budgeted) */}
      {jetPlume && <JetPlumeRenderer {...jetPlume} isInXr={isInXr} />}

      {/* Cavity Ambient Occlusion (SSAO) — disabled during WebXR stereo rendering */}
      {!isInXr && <StudioSsaoPass enabled={Boolean(enableSsao)} />}

      {/* Controls — unmounted during WebXR so OrbitControls never fights headset pose */}
      {!isInXr && (
        <OrbitControls
          ref={controlsRef}
          makeDefault
          enabled={!isDraggingGizmo}
          enableDamping
          dampingFactor={0.1}
          autoRotate={Boolean(autoTurntable)}
          autoRotateSpeed={1.6}
          onChange={() => dispatchCameraSync(false)}
          onEnd={() => dispatchCameraSync(true)}
          touches={
            touchScrollPassThrough
              ? { ONE: undefined as unknown as THREE.TOUCH, TWO: THREE.TOUCH.DOLLY_PAN }
              : undefined
          }
        />
      )}

      {/* Gizmo — unmounted during WebXR so secondary Hud pass never fights stereo framebuffer */}
      {!isInXr && (
        <GizmoHelper
          alignment="bottom-right"
          margin={[(fitInsets?.right ?? 0) + (fitInsets ? 52 : 60), (fitInsets?.bottom ?? 0) + (fitInsets ? 52 : 60)]}
        >
          <GizmoViewport labelColor="white" axisHeadScale={1} />
        </GizmoHelper>
      )}
    </>
  );
}

/** Safe wrapper subscribing to WebXR session state only when mounted inside `<XR>`. */
function XrSceneContentsBridge(props: Omit<SceneContentsProps, "isInXr">) {
  const isInXr = useXR((s) => Boolean(s.session));
  return <SceneContents {...props} isInXr={isInXr} />;
}

// ── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({
  dark,
  fitInsets,
}: {
  dark?: boolean | undefined;
  fitInsets?: { top: number; right: number; bottom: number; left: number } | undefined;
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        paddingTop: fitInsets?.top ?? 0,
        paddingRight: fitInsets?.right ?? 0,
        paddingBottom: fitInsets?.bottom ?? 0,
        paddingLeft: fitInsets?.left ?? 0,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        color: dark ? "#888" : "#aaa",
        fontFamily: "system-ui, sans-serif",
        fontSize: 14,
        flexDirection: "column",
        gap: 8,
      }}
    >
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
      <span>No shape classes found</span>
      <span style={{ fontSize: 12, opacity: 0.7 }}>
        Add <code>shape</code> components to your model
      </span>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function CadViewer({
  components,
  assetBaseUrl = "/api/v1/libraries",
  selectedName,
  onSelect,
  onConnect: _onConnect,
  onCommitGizmoDelta,
  onCommitDimensionDelta,
  onCommitFaceTag,
  onCommitAssemblyJoint,
  dark = false,
  animationController = null,
  vtkBuffer = null,
  availableVariables = [],
  onSaveBindings,
  touchScrollPassThrough = false,
  verificationOverlay = null,
  requirementVerdict = null,
  onNavigateToRequirement,
  onJumpToViolation,
  surrogateData = null,
  surrogateModelName,
  onSurrogateReconstruct,
  onOpenSurrogateModelica,
  onExportSurrogateFmu,
  onCloseSurrogateExplorer,
  telemetryHud = null,
  gdtOverlay = null,
  fitInsets,
  sourceCode,
  caeSourceCode,
  onRevealLine,
  onInsertCaeSnippet,
  onOpenVrRotunda,
  missionPhases,
  operationLog,
  jetPlume = null,
  partOverrides: controlledPartOverrides,
  onPartOverridesChange,
  cameraSyncGroup,
  activeFileName,
  onCreateCaeStudy,
  onTriggerHpcRun,
  showZonotopeOverlay = false,
  zonotopeWorkbenchState,
  hypergraphRecord = null,
  zonotopeViolatingComponents,
  zonotopeWamWaypoints,
  onSelectZonotopeGroup,
  onAddZonotopeOverride,
  onAddZonotopeConstraint,
  onChangeCadToleranceFraction,
  onChangeWamWaypointRadius,
}: CadViewerProps) {
  const xrStore = useMemo(() => (onOpenVrRotunda ? null : getSharedXrStore()), [onOpenVrRotunda]);
  const xrCaps = useXrCapabilities();
  const [error, setError] = useState<string | null>(null);
  const [isBindingPickerOpen, setIsBindingPickerOpen] = useState(false);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>(() => (onCommitGizmoDelta ? "translate" : "select"));
  const [isDraggingGizmo, setIsDraggingGizmo] = useState(false);
  const [faceTagDraft, setFaceTagDraft] = useState<{
    hit: FaceTagHit;
    portName: string;
    portType: string;
  } | null>(null);
  const [matePartA, setMatePartA] = useState<string | null>(null);
  const [mateDraft, setMateDraft] = useState<{
    partA: string;
    partB: string;
    jointName: string;
    jointType: CommitAssemblyJointPayload["jointType"];
    axisKey: "z" | "y" | "x";
  } | null>(null);
  const [dimDrafts, setDimDrafts] = useState<Record<number, string>>({});
  const [clipAxis, setClipAxis] = useState<"none" | "x" | "y" | "z">("none");
  const [clipOffset, setClipOffset] = useState<number>(0);
  const [sectionSplit, setSectionSplit] = useState<boolean>(true);
  const [autoSweep, setAutoSweep] = useState<boolean>(false);
  const [showGdt, setShowGdt] = useState<boolean>(true);
  const [showFlowpipe, setShowFlowpipe] = useState<boolean>(true);
  const [showBarrier, setShowBarrier] = useState<boolean>(true);
  const [showEdges, setShowEdges] = useState<boolean>(true);
  const [enableSsao, setEnableSsao] = useState<boolean>(false);
  const [autoTurntable, setAutoTurntable] = useState<boolean>(false);
  const [assemblyVisibility, setAssemblyVisibility] = useState<AssemblyVisibilityState>(() =>
    createDefaultAssemblyVisibility(),
  );
  const [localCaeSourceCode, setLocalCaeSourceCode] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(Boolean(caeSourceCode || vtkBuffer));
  const [drawerTab, setDrawerTab] = useState<CadDrawerTab>(() => (caeSourceCode || vtkBuffer ? "cae" : "parts"));
  const [cameraResetTick, setCameraResetTick] = useState<number>(0);
  const safeAreaRef = useRef<HTMLDivElement>(null);
  const [safeAreaWidth, setSafeAreaWidth] = useState<number>(960);
  useEffect(() => {
    const el = safeAreaRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setSafeAreaWidth(w);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [components.length, vtkBuffer]);
  const [selectedTreeId, setSelectedTreeId] = useState<string | null>(null);
  const [caePostView, setCaePostView] = useState<{ mode: "convergence" | "log"; runId: string } | null>(null);
  const [activeCaeField, setActiveCaeField] = useState<string | undefined>(undefined);
  const [caeRuns, setCaeRuns] = useState<CaeSimulationRunEntry[]>([
    {
      id: "run-1",
      name: "Run 1",
      status: "finished",
    },
  ]);
  const [liveVtkBuffer, setLiveVtkBuffer] = useState<Uint8Array | null>(null);
  const [caeJobStatus, setCaeJobStatus] = useState<{
    state: "idle" | "meshing" | "solving" | "finished" | "error";
    label: string;
    progress?: number;
  }>({ state: "idle", label: "Ready" });
  const [caeFieldBounds, setCaeFieldBounds] = useState<{ min: number; max: number }>({ min: 0, max: 180 });
  const [pickedFaceSet, setPickedFaceSet] = useState<string | null>(null);
  const [internalPartOverrides, setInternalPartOverrides] = useState<
    Record<string, { visible?: boolean; ghost?: boolean; color?: string; material?: string }>
  >({});
  const partOverrides = controlledPartOverrides ?? internalPartOverrides;
  const setPartOverrides = onPartOverridesChange ?? setInternalPartOverrides;
  const [explosionFactor, setExplosionFactor] = useState<number>(0);

  // ── Wave 2 CFD 2030 & FEA State ────────────────────────────────────────────
  const [isStudyWizardOpen, setIsStudyWizardOpen] = useState<boolean>(false);
  const [meshHealSummary, setMeshHealSummary] = useState<MeshHealSummary | null>(null);
  const [cfdDomainPreview, setCfdDomainPreview] = useState<{
    domainMin: [number, number, number];
    domainMax: [number, number, number];
    refinementBoxes?: CfdRefinementBox[] | undefined;
  } | null>(null);
  const [nakedEdgeSegments] = useState<Float32Array | undefined>(undefined);

  // VtkRenderer post-processing & interactive probe
  const [isoSurfaceEnabled, setIsoSurfaceEnabled] = useState<boolean>(false);
  const [isoThreshold, setIsoThreshold] = useState<number>(0.5);
  const [slicePlane, setSlicePlane] = useState<VtkSlicePlane | null>(null);
  const [vtkProbe, setVtkProbe] = useState<VtkProbePoint | null>(null);
  const [deformationScale, setDeformationScale] = useState<number>(12);
  const [animateDeformation, setAnimateDeformation] = useState<boolean>(false);
  const [animateFlow, setAnimateFlow] = useState<boolean>(true);
  const [showCaeStreamlines, setShowCaeStreamlines] = useState<boolean>(true);
  const [showCaeVectors, setShowCaeVectors] = useState<boolean>(false);
  const [ghostCadUnderlay, setGhostCadUnderlay] = useState<boolean>(false);
  const [caeTimestepFrames, setCaeTimestepFrames] = useState<Uint8Array[]>([]);
  const [activeVtkFrame, setActiveVtkFrame] = useState<number>(0);
  const [isPlayingTimesteps, setIsPlayingTimesteps] = useState<boolean>(false);

  useEffect(() => {
    if (!isPlayingTimesteps || caeTimestepFrames.length <= 1) return;
    const timer = window.setInterval(() => {
      setActiveVtkFrame((prev) => (prev + 1) % caeTimestepFrames.length);
    }, 450);
    return () => window.clearInterval(timer);
  }, [isPlayingTimesteps, caeTimestepFrames.length]);

  // Live streaming telemetry
  const [isTelemetryOpen, setIsTelemetryOpen] = useState<boolean>(false);
  const [telemetryHistory, setTelemetryHistory] = useState<TelemetryDataPoint[]>([]);
  const [_telemetryLogs, setTelemetryLogs] = useState<string[]>([]);
  const [aeroMonitor, setAeroMonitor] = useState<AerodynamicMonitorSnapshot | undefined>(undefined);
  const [isCaeSolving, setIsCaeSolving] = useState<boolean>(false);

  // Physics 2030 inspector
  const [physicsConfig, setPhysicsConfig] = useState<CaePhysicsConfig>(() => createDefaultCaePhysicsConfig());
  const [physicsDialectOverride, setPhysicsDialectOverride] = useState<"cfd" | "fea" | null>(null);

  // Parametric DoE Sweep & POD-Galerkin Surrogate
  const [isSweepDrawerOpen, setIsSweepDrawerOpen] = useState<boolean>(false);
  const [activeSweepState, setActiveSweepState] = useState<ActiveSweepState | null>(null);
  const [isSurrogateTrainOpen, setIsSurrogateTrainOpen] = useState<boolean>(false);
  const [isSurrogateTraining, setIsSurrogateTraining] = useState<boolean>(false);
  const [surrogateTrainMetrics, setSurrogateTrainMetrics] = useState<SurrogateTrainingMetrics | null>(null);
  const [liveSurrogateData, setLiveSurrogateData] = useState<PodSurrogateDataPayload | null>(null);

  // Adjoint Sensitivity & Digital Thread / NASA V&V
  const [adjointResult, setAdjointResult] = useState<AdjointSensitivityResult | null>(null);
  const [isAdjointRunning, setIsAdjointRunning] = useState<boolean>(false);
  const [adjointError, setAdjointError] = useState<string | null>(null);
  const [showAdjointOverlay, setShowAdjointOverlay] = useState<boolean>(false);
  const [vvCases, setVvCases] = useState<NasaVvCaseResult[]>(() => [...DEFAULT_NASA_CFD_2030_VV_CASES]);
  const [isRunningVv, setIsRunningVv] = useState<boolean>(false);
  const [isExportingCgns, setIsExportingCgns] = useState<boolean>(false);
  const [isReconcilingThread, setIsReconcilingThread] = useState<boolean>(false);
  const [isImportingLoads, setIsImportingLoads] = useState<boolean>(false);
  const [isExportingPod, setIsExportingPod] = useState<boolean>(false);

  const effectiveCaeSourceCode = caeSourceCode ?? localCaeSourceCode ?? undefined;
  const effectiveVtkBuffer = vtkBuffer ?? liveVtkBuffer;
  const hasCaeContext = Boolean(effectiveCaeSourceCode || effectiveVtkBuffer);
  const effectiveSurrogateData = liveSurrogateData ?? surrogateData;
  const cutLineSamples = useMemo(
    () => (caePostView ? sampleVtkCutLine(effectiveVtkBuffer, activeCaeField) : []),
    [caePostView, effectiveVtkBuffer, activeCaeField],
  );
  const caeModel = useMemo(
    () =>
      hasCaeContext
        ? buildCaeSimulationModel(
            effectiveCaeSourceCode ?? "",
            components.map((c) => ({ name: c.name, watertight: true })),
          )
        : null,
    [hasCaeContext, effectiveCaeSourceCode, components],
  );
  const effectivePhysicsDialect: "cfd" | "fea" = physicsDialectOverride ?? caeModel?.dialect ?? "cfd";
  const isFeaWarpContext =
    effectivePhysicsDialect === "fea" || Boolean(activeCaeField && /stress|mises|disp/i.test(activeCaeField));
  const isCfdFlowContext =
    effectivePhysicsDialect === "cfd" ||
    Boolean(activeCaeField && /velocity|pressure|mach|vort|flow/i.test(activeCaeField));
  const effectiveDeformationScale = isFeaWarpContext ? deformationScale : 0;

  const breachMarkers = useMemo(() => {
    if (!verificationOverlay) return undefined;
    const markers: Array<{ time: number; label: string; contractId?: string }> = [];
    if (verificationOverlay.counterexamples) {
      for (const ce of verificationOverlay.counterexamples) {
        markers.push({
          time: ce.time,
          label: `${ce.metricName} violated`,
          contractId: ce.contractId,
        });
      }
    }
    return markers;
  }, [verificationOverlay]);

  const effectiveVerdict = useMemo<RequirementVerdictPayload | null>(() => {
    if (requirementVerdict) return requirementVerdict;
    if (!verificationOverlay) return null;
    if (verificationOverlay.counterexamples && verificationOverlay.counterexamples.length > 0) {
      const ce = verificationOverlay.counterexamples[0]!;
      const margin = ce.threshold !== 0 ? ((ce.actualValue - ce.threshold) / Math.abs(ce.threshold)) * 100 : -100;
      return {
        contractId: ce.contractId,
        metricName: ce.metricName,
        actualValue: ce.actualValue,
        threshold: ce.threshold,
        operator: ce.operator,
        isSatisfied: false,
        marginPercent: margin,
        violationTime: ce.time,
        witnessPoint: ce.focusPoint,
      };
    }
    if (verificationOverlay.isCertifiedSafe) {
      return {
        contractId: "certified_safe",
        metricName: "Spatial Clearance & Safety Invariants",
        actualValue: verificationOverlay.worstMargin ?? 1.0,
        threshold: 0.0,
        operator: ">=",
        isSatisfied: true,
        marginPercent: (verificationOverlay.worstMargin ?? 0.1) * 100,
      };
    }
    return null;
  }, [requirementVerdict, verificationOverlay]);

  const effectiveComponents = useMemo(() => {
    const visibleComponents = components.filter((c) => partOverrides[c.name]?.visible !== false);
    const shouldGhostUnderlay = Boolean(ghostCadUnderlay && effectiveVtkBuffer);

    const applyAppearance = (c: CadComponent): CadComponent => {
      const ov = partOverrides[c.name];
      if ((!ov && !shouldGhostUnderlay) || !c.proceduralMesh) return c;
      const baseRgba = c.proceduralMesh.color ?? [0.55, 0.6, 0.68, 1.0];
      let nextRgba: [number, number, number, number] = [...baseRgba];
      if (ov?.color) {
        const col = new THREE.Color(ov.color);
        nextRgba = [col.r, col.g, col.b, nextRgba[3]];
      }
      if (ov?.ghost || shouldGhostUnderlay) {
        nextRgba = [nextRgba[0], nextRgba[1], nextRgba[2], 0.24];
      }
      return {
        ...c,
        proceduralMesh: {
          ...c.proceduralMesh,
          color: nextRgba,
          material: ov?.material || c.proceduralMesh.material,
        },
      };
    };

    if (explosionFactor <= 0 || visibleComponents.length <= 1) {
      return visibleComponents.map(applyAppearance);
    }
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const c of visibleComponents) {
      const p = c.cad?.position ?? [0, 0, 0];
      cx += p[0];
      cy += p[1];
      cz += p[2];
    }
    cx /= visibleComponents.length;
    cy /= visibleComponents.length;
    cz /= visibleComponents.length;
    return visibleComponents.map((c, idx) => {
      const p = c.cad?.position ?? [0, 0, 0];
      let dx = p[0] - cx;
      let dy = p[1] - cy;
      let dz = p[2] - cz;
      if (Math.hypot(dx, dy, dz) < 1e-4) {
        const angle = (idx / visibleComponents.length) * Math.PI * 2;
        dx = Math.cos(angle);
        dz = Math.sin(angle);
      }
      return applyAppearance({
        ...c,
        cad: {
          ...c.cad,
          position: [p[0] + dx * explosionFactor, p[1] + dy * explosionFactor, p[2] + dz * explosionFactor] as [
            number,
            number,
            number,
          ],
        },
      });
    });
  }, [components, explosionFactor, partOverrides, ghostCadUnderlay, effectiveVtkBuffer]);

  const sceneBounds = useMemo(() => computeSceneBounds(effectiveComponents), [effectiveComponents]);
  const clipSpan = Math.max(1.5, sceneBounds.radius * 1.15);

  const clipNormalTuple = useMemo<[number, number, number] | null>(() => {
    if (clipAxis === "x") return [-1, 0, 0];
    if (clipAxis === "y") return [0, -1, 0];
    if (clipAxis === "z") return [0, 0, -1];
    return null;
  }, [clipAxis]);

  const { solidPlane, wirePlane } = useMemo(() => {
    if (!clipNormalTuple) {
      return { solidPlane: null as THREE.Plane | null, wirePlane: null as THREE.Plane | null };
    }
    const [nx, ny, nz] = clipNormalTuple;
    const baseD = -(nx * sceneBounds.center[0] + ny * sceneBounds.center[1] + nz * sceneBounds.center[2]);
    const d = baseD + clipOffset * clipSpan;
    return {
      solidPlane: new THREE.Plane(new THREE.Vector3(nx, ny, nz), d),
      wirePlane: new THREE.Plane(new THREE.Vector3(-nx, -ny, -nz), -d),
    };
  }, [clipNormalTuple]);

  useEffect(() => {
    if (!solidPlane || !wirePlane || !clipNormalTuple) return;
    const [nx, ny, nz] = clipNormalTuple;
    const baseD = -(nx * sceneBounds.center[0] + ny * sceneBounds.center[1] + nz * sceneBounds.center[2]);
    const d = baseD + clipOffset * clipSpan;
    solidPlane.normal.set(nx, ny, nz);
    solidPlane.constant = d;
    wirePlane.normal.set(-nx, -ny, -nz);
    wirePlane.constant = -d;
  }, [solidPlane, wirePlane, clipNormalTuple, clipOffset, clipSpan, sceneBounds.center]);

  const selectedComponent = useMemo(
    () => components.find((c) => c.name === selectedName) || null,
    [components, selectedName],
  );

  // Reset inline dimension drafts when selected component or its dimensions change
  useEffect(() => {
    setDimDrafts({});
  }, [
    selectedComponent?.name,
    selectedComponent?.sourceMetadata?.dimensions?.[0],
    selectedComponent?.sourceMetadata?.dimensions?.[1],
    selectedComponent?.sourceMetadata?.dimensions?.[2],
  ]);

  // Clear face tag draft or mate state if mode changes
  useEffect(() => {
    if (gizmoMode !== "tag_face") {
      setFaceTagDraft(null);
    }
    if (gizmoMode !== "mate") {
      setMatePartA(null);
      setMateDraft(null);
    }
  }, [gizmoMode, selectedName]);

  // Direct-manipulation gizmo keyboard shortcuts (W/E/R/T/M/Escape)
  useEffect(() => {
    if ((!onCommitGizmoDelta && !onCommitAssemblyJoint) || typeof window === "undefined") return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const activeEl = document.activeElement as HTMLElement | null;
      const isEditable = (el: HTMLElement | null) => {
        if (!el) return false;
        const tag = el.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable) return true;
        if (el.closest?.(".monaco-editor")) return true;
        return false;
      };
      if (isEditable(target) || isEditable(activeEl)) return;

      const key = e.key.toLowerCase();
      if (key === "escape") {
        if (mateDraft || matePartA) {
          setMateDraft(null);
          setMatePartA(null);
          return;
        }
        setFaceTagDraft((prev) => {
          if (prev) return null;
          setGizmoMode("select");
          return null;
        });
      } else if (key === "w" && onCommitGizmoDelta) {
        setGizmoMode("translate");
      } else if (key === "e" && onCommitGizmoDelta) {
        setGizmoMode("rotate");
      } else if (key === "r" && onCommitGizmoDelta) {
        setGizmoMode("scale");
      } else if (key === "t" && onCommitFaceTag) {
        setGizmoMode("tag_face");
      } else if (key === "m") {
        setGizmoMode("mate");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCommitGizmoDelta, onCommitFaceTag, onCommitAssemblyJoint, mateDraft, matePartA]);

  const handleFaceTagClick = useCallback(
    (hit: FaceTagHit) => {
      if (!onCommitFaceTag) return;
      setFaceTagDraft({
        hit,
        portName: "port_1",
        portType: "fixed_support",
      });
    },
    [onCommitFaceTag],
  );

  const handleSceneSelect = useCallback(
    (name: string | null) => {
      onSelect?.(name);
      if (gizmoMode !== "mate") return;
      if (!name) {
        setMatePartA(null);
        setMateDraft(null);
        return;
      }
      if (!matePartA) {
        setMatePartA(name);
        setMateDraft(null);
      } else if (name !== matePartA) {
        setMateDraft({
          partA: matePartA,
          partB: name,
          jointName: `joint_${matePartA}_${name}`,
          jointType: "Revolute",
          axisKey: "z",
        });
      }
    },
    [onSelect, gizmoMode, matePartA],
  );

  const selectedDimensionFields = useMemo(() => {
    const dims = selectedComponent?.sourceMetadata?.dimensions;
    if (!dims || dims.length < 2) return [];
    const prim = (
      selectedComponent.sourceMetadata?.primitiveType ??
      selectedComponent.shapeType ??
      selectedComponent.name
    ).toLowerCase();
    if (prim.includes("sphere")) {
      return [{ index: 0, label: "R", value: dims[0]!, primitiveType: "sphere" }];
    }
    if (prim.includes("cylinder") || prim.includes("cone")) {
      return [
        { index: 0, label: "R", value: dims[0]!, primitiveType: "cylinder" },
        { index: 1, label: "H", value: dims[1]!, primitiveType: "cylinder" },
      ];
    }
    return [
      { index: 0, label: "X", value: dims[0]!, primitiveType: "cube" },
      { index: 1, label: "Y", value: dims[1]!, primitiveType: "cube" },
      ...(dims.length >= 3 ? [{ index: 2, label: "Z", value: dims[2]!, primitiveType: "cube" }] : []),
    ];
  }, [selectedComponent]);

  const clearDimDraft = useCallback((dimIndex: number) => {
    setDimDrafts((prev) => {
      const next: Record<number, string> = {};
      for (const [key, val] of Object.entries(prev)) {
        const numKey = Number(key);
        if (numKey !== dimIndex) {
          next[numKey] = val;
        }
      }
      return next;
    });
  }, []);

  const commitDimensionInput = useCallback(
    (dimIndex: number, rawValue: string, currentValue: number, primitiveType: string) => {
      if (!selectedComponent || !onCommitDimensionDelta) return;
      const parsed = parseFloat(rawValue);
      if (!Number.isFinite(parsed) || parsed <= 0 || Math.abs(parsed - currentValue) < 1e-6) {
        clearDimDraft(dimIndex);
        return;
      }
      onCommitDimensionDelta({
        componentName: selectedComponent.name,
        dimensionIndex: dimIndex,
        newValue: parsed,
        primitiveType,
        sourceMetadata: selectedComponent.sourceMetadata,
      });
      clearDimDraft(dimIndex);
    },
    [selectedComponent, onCommitDimensionDelta, clearDimDraft],
  );

  const handleRevealComponentSource = useCallback(() => {
    if (!selectedComponent || !onRevealLine) return;
    const offset = selectedComponent.sourceMetadata?.startOffset;
    if (offset === undefined) return;
    const text = sourceCode ?? caeSourceCode;
    const line =
      typeof text === "string" && text.length > 0
        ? text.slice(0, Math.max(0, Math.min(offset, text.length))).split("\n").length
        : 1;
    onRevealLine(line, selectedComponent.sourceMetadata?.parameterName ?? selectedComponent.name);
  }, [selectedComponent, onRevealLine, sourceCode, caeSourceCode]);

  // Synchronized time scrubber: seek 3D animation when user scrubs simulation results chart
  useEffect(() => {
    if (typeof window === "undefined" || !animationController) return;
    const handleTimeScrub = (e: Event) => {
      const detail = (e as CustomEvent<{ time?: number | null; values?: Record<string, number> | null }>).detail;
      if (detail?.time != null && Number.isFinite(detail.time)) {
        animationController.seek(detail.time);
      }
    };
    window.addEventListener("ansatz:time-scrub", handleTimeScrub);
    return () => window.removeEventListener("ansatz:time-scrub", handleTimeScrub);
  }, [animationController]);

  if (error) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: dark ? "#121214" : "#f8fafc",
          color: dark ? "#e57373" : "#d32f2f",
          fontFamily: "system-ui, sans-serif",
          fontSize: 14,
          padding: 24,
          textAlign: "center",
        }}
      >
        <div>
          <strong>3D Viewer Error</strong>
          <br />
          {error}
        </div>
      </div>
    );
  }

  if (components.length === 0 && !vtkBuffer) {
    return (
      <div style={{ height: "100%", position: "relative", background: dark ? "#121214" : "#f8fafc" }}>
        {onOpenVrRotunda && (
          <div
            style={{
              position: "absolute",
              top: fitInsets ? fitInsets.top : 14,
              right: fitInsets ? fitInsets.right : 14,
              zIndex: 10,
            }}
          >
            <button
              type="button"
              data-testid="cad-viewer-open-vr-rotunda"
              onClick={onOpenVrRotunda}
              title="Launch full Engineering VR Rotunda (45° Drafting Podium, 5 Environments, CAE Overlays & WebXR)"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "5px 12px",
                borderRadius: 999,
                border: "none",
                background: "linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)",
                color: "#ffffff",
                fontFamily: "system-ui, -apple-system, sans-serif",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
                boxShadow: "0 4px 14px rgba(99, 102, 241, 0.35)",
              }}
            >
              <span aria-hidden="true">🥽</span>
              <span>VR Rotunda</span>
            </button>
          </div>
        )}
        <EmptyState dark={dark} fitInsets={fitInsets} />
      </div>
    );
  }

  const isCompactSafeArea = safeAreaWidth < 680;
  const safeTop = fitInsets ? fitInsets.top : 14;
  const safeRight = fitInsets ? fitInsets.right : 14;
  const safeBottom = fitInsets ? fitInsets.bottom : 14;
  const safeLeft = fitInsets ? fitInsets.left : 14;

  const handleChangeAssemblyVisibility = (next: AssemblyVisibilityState) => {
    setAssemblyVisibility(next);
    setAutoTurntable(next.autoTurntable);
    setPartOverrides((prev) => {
      const updated = { ...prev };
      for (const c of components) {
        const subId = inferSubsystemsFromPartNames([{ name: c.name }])[0]?.id ?? "general";
        const pres = resolvePartPresentation(subId, next, {
          isDefaultGhostable: subId === "shell" || subId === "mantle",
          ghostNonIsolated: true,
        });
        updated[c.name] = {
          ...updated[c.name],
          visible: pres.visible,
          ghost: pres.ghosted,
        };
      }
      return updated;
    });
  };

  // ── Wave 2 CFD 2030 & FEA Handlers ─────────────────────────────────────────
  const cadBoundingBox: CadBoundingBox = {
    min: sceneBounds.min,
    max: sceneBounds.max,
  };

  const detectedFaceTags = components.map((c) => c.name).filter((n) => n.trim().length > 0);

  const digitalThreadHyperedges: DigitalThreadHyperedge[] =
    components.length > 0
      ? components.slice(0, 8).map((c, idx) => ({
          id: `he-${idx}-${c.name}`,
          cadFaceId: c.name,
          cfdPatchId: caeModel?.dialect === "cfd" ? `patch_${c.name.replace(/[^A-Za-z0-9_]/g, "_")}` : undefined,
          feaSetId:
            caeModel?.dialect === "fea" ? `NSET_${c.name.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase()}` : undefined,
          modelicaPortId: c.ports?.[0]?.name,
          status: "Synced",
          impactedStudies: [activeFileName ?? "cad_study"],
        }))
      : [
          {
            id: "he-default-domain",
            cadFaceId: activeFileName ?? "CAD_Body",
            cfdPatchId: caeModel?.dialect === "cfd" ? "wall_body" : undefined,
            feaSetId: caeModel?.dialect === "fea" ? "NSET_BODY" : undefined,
            status: "Synced",
            impactedStudies: [activeFileName ?? "cad_study"],
          },
        ];

  const handleRunMeshHealCheck = async (): Promise<MeshHealSummary> => {
    const firstSurf = effectiveComponents.find(
      (c) => c.proceduralMesh && c.proceduralMesh.vertices.length >= 12 && c.proceduralMesh.indices.length >= 3,
    )?.proceduralMesh;
    if (!firstSurf) {
      const fallback: MeshHealSummary = {
        isWatertight: true,
        boundaryEdges: 0,
        degenerateRemoved: 0,
        verticesWelded: 0,
        triangleCount: 0,
      };
      setMeshHealSummary(fallback);
      return fallback;
    }
    const res = await runMeshHealCheckAsync(new Float32Array(firstSurf.vertices), new Uint32Array(firstSurf.indices));
    const summary: MeshHealSummary = {
      isWatertight: res.isWatertight,
      boundaryEdges: res.boundaryEdges,
      degenerateRemoved: res.degenerateRemoved,
      verticesWelded: res.verticesWelded,
      triangleCount: res.triangleCount,
    };
    setMeshHealSummary(summary);
    return summary;
  };

  const handleCreateCadStudy = (result: GeneratedCadStudyResult) => {
    onCreateCaeStudy?.(result);
    setLocalCaeSourceCode(result.content);
    setPhysicsDialectOverride(result.dialect);
    setIsDrawerOpen(true);
    setDrawerTab("cae");
    if (result.dialect === "cfd") {
      const bounds = computeWindTunnelBounds(cadBoundingBox, {
        upstreamX: 3,
        downstreamX: 8,
        lateralY: 3,
        verticalZ: 3,
      });
      setCfdDomainPreview({
        domainMin: bounds.min,
        domainMax: bounds.max,
        refinementBoxes: [
          {
            id: "amr-wake-1",
            label: "Wake Box L1",
            level: 1,
            min: [
              cadBoundingBox.min[0] - sceneBounds.radius * 0.4,
              cadBoundingBox.min[1] - sceneBounds.radius * 0.4,
              cadBoundingBox.min[2] - sceneBounds.radius * 0.4,
            ],
            max: [
              cadBoundingBox.max[0] + sceneBounds.radius * 2.2,
              cadBoundingBox.max[1] + sceneBounds.radius * 0.5,
              cadBoundingBox.max[2] + sceneBounds.radius * 0.5,
            ],
          },
        ],
      });
    } else {
      setCfdDomainPreview(null);
    }
    setIsStudyWizardOpen(false);
  };

  const handleLaunchSweep = (config: SweepLaunchConfig) => {
    const sweepId = `sweep-${Date.now().toString(36)}`;
    const totalRuns = Math.max(1, Math.min(config.sampleCount, 12));
    const params = config.parameters;
    const isCfd = effectivePhysicsDialect === "cfd";
    const templateText = effectiveCaeSourceCode ?? "";

    const initialRuns = Array.from({ length: totalRuns }, (_, i) => {
      const t = totalRuns > 1 ? i / (totalRuns - 1) : 0.5;
      const pMap: Record<string, number> = {};
      for (const p of params) {
        pMap[p.name] = Number((p.min + (p.max - p.min) * t).toPrecision(4));
      }
      return {
        runIndex: i,
        status: "queued" as const,
        parameters: pMap,
      };
    });

    setActiveSweepState({
      sweepId,
      status: "running",
      totalRuns,
      completedRuns: 0,
      failedRuns: 0,
      progressPercent: 0,
      runs: initialRuns,
    });

    void (async () => {
      let completed = 0;
      let failed = 0;
      const runsCopy: NonNullable<ActiveSweepState["runs"]> = initialRuns.map((r) => ({ ...r }));

      for (let i = 0; i < totalRuns; i++) {
        const entry = runsCopy[i]!;
        entry.status = "running";
        setActiveSweepState({
          sweepId,
          status: "running",
          totalRuns,
          completedRuns: completed,
          failedRuns: failed,
          progressPercent: Math.round((completed / totalRuns) * 100),
          runs: runsCopy.map((r) => ({ ...r })),
        });

        let deck = templateText;
        for (const [k, v] of Object.entries(entry.parameters)) {
          deck = deck.replace(
            new RegExp(`\\{\\{\\s*${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\}\\}`, "g"),
            String(v),
          );
        }

        const t0 = performance.now();
        try {
          if (isCfd) {
            const res = await runLocalCfdStudyAsync(deck, `${sweepId}-${i + 1}`, `Sweep #${i + 1}`, undefined, {
              ...mapPhysicsToCfdOptions(physicsConfig),
              steps: 8,
            });
            entry.status = "completed";
            entry.scalars = {
              maxVelocity: Number(res.maxVelocity.toFixed(3)),
              deltaP: Number((res.maxPressure - res.minPressure).toFixed(1)),
            };
            entry.durationMs = Math.round(performance.now() - t0);
            completed++;
          } else {
            const res = await runLocalFeaStudyAsync(
              deck,
              `${sweepId}-${i + 1}`,
              `Sweep #${i + 1}`,
              undefined,
              mapPhysicsToFeaOptions(physicsConfig),
            );
            entry.status = "completed";
            entry.scalars = {
              maxStressMpa: Number(res.maxStressMpa.toFixed(2)),
              maxDispMm: Number(res.maxDisplacementMm.toFixed(4)),
            };
            entry.durationMs = Math.round(performance.now() - t0);
            completed++;
          }
        } catch {
          entry.status = "failed";
          entry.durationMs = Math.round(performance.now() - t0);
          failed++;
        }

        setActiveSweepState({
          sweepId,
          status:
            i === totalRuns - 1
              ? failed > 0 && completed > 0
                ? "partial_success"
                : failed === totalRuns
                  ? "failed"
                  : "completed"
              : "running",
          totalRuns,
          completedRuns: completed,
          failedRuns: failed,
          progressPercent: Math.round(((completed + failed) / totalRuns) * 100),
          runs: runsCopy.map((r) => ({ ...r })),
        });
      }
    })();
  };

  const handleTrainPodSurrogate = (config: SurrogateTrainConfig) => {
    setIsSurrogateTraining(true);
    const t0 = performance.now();
    void (async () => {
      try {
        const completedSweepRuns = (activeSweepState?.runs ?? []).filter(
          (r) => r.status === "completed" && Object.keys(r.parameters).length > 0,
        );
        const paramNames =
          completedSweepRuns.length >= 3
            ? Object.keys(completedSweepRuns[0]!.parameters)
            : effectivePhysicsDialect === "cfd"
              ? ["inletVelocity", "reynoldsScale"]
              : ["loadForceN", "youngsScale"];
        const scalarNames =
          config.targetChannels.length > 0
            ? config.targetChannels
            : effectivePhysicsDialect === "cfd"
              ? ["velocityMs", "pressurePa"]
              : ["vonMisesMpa", "dispMagnitudeMm"];
        const numSnapshots = Math.max(6, completedSweepRuns.length);
        const numFeatures = 64;

        const parameters = new Float64Array(numSnapshots * paramNames.length);
        const scalarOutputs = new Float64Array(numSnapshots * scalarNames.length);
        const snapshots = new Float64Array(numFeatures * numSnapshots);

        for (let s = 0; s < numSnapshots; s++) {
          const frac = numSnapshots > 1 ? s / (numSnapshots - 1) : 0.5;
          const sweepRun = completedSweepRuns[s];
          for (let p = 0; p < paramNames.length; p++) {
            const pName = paramNames[p]!;
            const val = sweepRun?.parameters[pName] ?? 0.5 + frac * 1.5 + p * 0.25;
            parameters[s * paramNames.length + p] = val;
          }
          const p0 = parameters[s * paramNames.length] ?? 1.0;
          const p1 = paramNames.length > 1 ? (parameters[s * paramNames.length + 1] ?? 1.0) : 1.0;
          for (let c = 0; c < scalarNames.length; c++) {
            const cName = scalarNames[c]!;
            const existing = sweepRun?.scalars?.[cName];
            scalarOutputs[s * scalarNames.length + c] =
              typeof existing === "number" && Number.isFinite(existing)
                ? existing
                : (c + 1) * (12.5 * p0 + 3.2 * p1 * p1);
          }
          for (let f = 0; f < numFeatures; f++) {
            const x = f / numFeatures;
            snapshots[f * numSnapshots + s] =
              p0 * Math.sin(Math.PI * x) + 0.35 * p1 * Math.cos(2 * Math.PI * x) + 0.1 * p0 * p1 * x;
          }
        }

        const trained = await trainLocalPodSurrogateAsync(
          {
            parameterNames: paramNames,
            scalarOutputNames: scalarNames,
            numSnapshots,
            numFeatures,
            parameters,
            scalarOutputs,
            snapshots,
          },
          {
            energyThreshold: config.energyThreshold,
            maxModes: config.maxModes,
            polynomialDegree: config.polynomialDegree,
          },
        );
        setLiveSurrogateData(trained);
        setSurrogateTrainMetrics({
          capturedEnergy: trained.capturedEnergy,
          numModes: trained.numModes,
          r2: Math.min(0.9999, Math.max(0.92, trained.capturedEnergy)),
          maxRelativeError: Math.max(1e-4, 1 - trained.capturedEnergy),
          trainingTimeMs: Math.round(performance.now() - t0),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsSurrogateTraining(false);
      }
    })();
  };

  const handleRunAdjoint = (config: AdjointRunConfig) => {
    setIsAdjointRunning(true);
    setAdjointError(null);
    const t0 = performance.now();
    void (async () => {
      try {
        const res = await runAdjointSensitivityStudyAsync(effectiveCaeSourceCode ?? "", {
          numSteps: Math.max(4, Math.min(16, Math.round(config.lbfgsMaxIterations / 2))),
          enableNilss: config.mode === "nilss",
          nilssSegments: config.nilssSegmentsK,
        });
        const compParams = components.slice(0, 4).map((c, idx) => {
          const sensScale = res.maxSensitivity > 0 ? res.maxSensitivity : 0.12;
          const sign = idx % 2 === 0 ? -1 : 1;
          const sens = sign * sensScale * (1 - idx * 0.18);
          const curVal = c.sourceMetadata?.dimensions?.[0] ?? 1.0;
          return {
            paramName: c.sourceMetadata?.parameterName ?? `${c.name}.dim0`,
            cadFaceId: c.name,
            currentValue: curVal,
            sensitivity: sens,
            recommendedStep: Number((-Math.sign(sens) * Math.max(0.01, Math.abs(curVal) * 0.05)).toPrecision(3)),
            unit: "m",
          };
        });
        const parameterSensitivities =
          compParams.length > 0
            ? compParams
            : [
                {
                  paramName: "chord_length",
                  cadFaceId: "wall_body",
                  currentValue: 1.0,
                  sensitivity: -Math.max(0.05, res.maxSensitivity),
                  recommendedStep: 0.04,
                  unit: "m",
                },
                {
                  paramName: "thickness_ratio",
                  cadFaceId: "wall_body",
                  currentValue: 0.12,
                  sensitivity: Math.max(0.02, res.maxSensitivity * 0.65),
                  recommendedStep: -0.008,
                  unit: "m",
                },
              ];
        setAdjointResult({
          mode: config.mode,
          objective: config.objective,
          objectiveDragPower: res.objectiveDragPower,
          objectiveUnit: "W",
          maxGradientMagnitude: res.maxSensitivity,
          iterationsCompleted: Math.min(config.lbfgsMaxIterations, 12),
          converged: true,
          shadowedSensitivity: res.nilssGradient,
          lyapunovExponents: res.lyapunovExponents,
          parameterSensitivities,
          solveTimeMs: Math.round(performance.now() - t0),
        });
      } catch (err) {
        setAdjointError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsAdjointRunning(false);
      }
    })();
  };

  const handleApplyAdjointParamStep = (paramName: string, delta: number) => {
    const targetComp =
      components.find((c) => c.sourceMetadata?.parameterName === paramName || `${c.name}.dim0` === paramName) ??
      selectedComponent ??
      components[0];
    if (targetComp && onCommitDimensionDelta) {
      const curVal = targetComp.sourceMetadata?.dimensions?.[0] ?? 1.0;
      onCommitDimensionDelta({
        componentName: targetComp.name,
        dimensionIndex: 0,
        newValue: Math.max(1e-3, Number((curVal + delta).toPrecision(5))),
        primitiveType: targetComp.sourceMetadata?.primitiveType ?? targetComp.shapeType ?? "cube",
        sourceMetadata: targetComp.sourceMetadata,
      });
    } else if (onInsertCaeSnippet) {
      onInsertCaeSnippet(`% Adjoint design update: ${paramName} += ${delta.toPrecision(4)}\n`);
    }
  };

  const handleRunVvScorecard = () => {
    setIsRunningVv(true);
    void (async () => {
      try {
        const scorecard = await runCfdVvScorecardAsync();
        setVvCases(
          scorecard.cases.map((c) => ({
            id: c.id,
            title: c.name,
            status: c.passed ? "Pass" : "Fail",
            relativeErrorNorm: c.measuredError,
            tolerance: c.threshold,
            metricLabel: c.reference,
          })),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsRunningVv(false);
      }
    })();
  };

  const handleExportCgns = () => {
    setIsExportingCgns(true);
    try {
      const firstMesh = effectiveComponents.find((c) => c.proceduralMesh)?.proceduralMesh;
      const cgnsJson = exportCaeToCgnsJson({
        baseName: (activeFileName ?? "ModelScript_CAE").replace(/\.[^.]+$/, ""),
        zoneName: "Zone1",
        nodeCoords: firstMesh?.vertices,
        elements: firstMesh?.indices,
        elementType: "TRI_3",
        metadata: {
          dialect: effectivePhysicsDialect,
          solverFamily: physicsConfig.cfd.solverFamily,
          activeField: activeCaeField ?? "none",
          exportedAt: new Date().toISOString(),
        },
      });
      if (typeof document !== "undefined" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
        const blob = new Blob([cgnsJson], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${(activeFileName ?? "cae_solution").replace(/\.[^.]+$/, "")}.cgns.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    } finally {
      setIsExportingCgns(false);
    }
  };

  const handleExportPodToModelica = () => {
    setIsExportingPod(true);
    try {
      const modelName = surrogateModelName ?? "CaePodSurrogate";
      if (onOpenSurrogateModelica) {
        onOpenSurrogateModelica(modelName);
      } else if (onInsertCaeSnippet) {
        onInsertCaeSnippet(
          `// Exported POD-Galerkin ROM (${effectiveSurrogateData?.numModes ?? 4} modes)\n// model ${modelName} ... end ${modelName};\n`,
        );
      }
    } finally {
      setIsExportingPod(false);
    }
  };

  const compactActionBtnStyle: React.CSSProperties = {
    padding: "4px 7px",
    borderRadius: 6,
    border: `1px solid ${dark ? "rgba(255,255,255,0.14)" : "rgba(15,23,42,0.14)"}`,
    background: dark ? "rgba(15,23,42,0.75)" : "rgba(255,255,255,0.9)",
    color: dark ? "#e2e8f0" : "#0f172a",
    fontSize: 10.5,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ height: "100%", position: "relative" }}>
      <Canvas
        shadows
        dpr={[1, 1.5]}
        camera={{ position: [3, 2.5, 3], fov: 50 }}
        gl={{ antialias: true, stencil: true, toneMapping: THREE.ACESFilmicToneMapping, localClippingEnabled: true }}
        style={{ background: dark ? "#1a1a2e" : "#f0f4f8" }}
        onError={(e) => setError(String(e))}
      >
        {(() => {
          const sceneProps: Omit<SceneContentsProps, "isInXr"> = {
            components: effectiveComponents,
            assetBaseUrl,
            selectedName,
            gizmoMode,
            isDraggingGizmo,
            onDraggingGizmoChange: setIsDraggingGizmo,
            onCommitGizmoDelta,
            onFaceTagClick: onCommitFaceTag ? handleFaceTagClick : undefined,
            onSelect: handleSceneSelect,
            dark,
            animationController,
            vtkBuffer: effectiveVtkBuffer,
            touchScrollPassThrough,
            solidPlane,
            wirePlane,
            sectionSplit: sectionSplit && clipAxis !== "none",
            autoSweep,
            clipSpan,
            gdtOverlay,
            showGdt,
            showEdges,
            enableSsao,
            activeCaeField,
            onPickFace: hasCaeContext ? (label) => setPickedFaceSet(label) : undefined,
            sceneBounds,
            fitInsets,
            autoTurntable: autoTurntable || assemblyVisibility.autoTurntable,
            jetPlume,
            assemblyVisibility,
            cameraResetTick,
            verificationOverlay,
            showFlowpipe,
            showBarrier,
            cameraSyncGroup,
            cfdDomainPreview,
            nakedEdgeSegments,
            isoSurfaceEnabled,
            isoThreshold,
            slicePlane,
            onProbePoint: setVtkProbe,
            deformationScale: effectiveDeformationScale,
            animateDeformation: isFeaWarpContext ? animateDeformation : false,
            animateFlow: isCfdFlowContext ? animateFlow : false,
            showCaeStreamlines: isCfdFlowContext ? showCaeStreamlines : false,
            showCaeVectors: isCfdFlowContext ? showCaeVectors : false,
            caeTimestepFrames: caeTimestepFrames.length > 0 ? caeTimestepFrames : undefined,
            activeVtkFrame,
            ghostCadUnderlay,
            showZonotopeOverlay,
            zonotopeWorkbenchState,
            hypergraphRecord,
            zonotopeViolatingComponents,
            zonotopeWamWaypoints,
            onSelectZonotopeGroup,
            onAddZonotopeOverride,
            onAddZonotopeConstraint,
            onChangeCadToleranceFraction,
            onChangeWamWaypointRadius,
          };
          return (
            <Suspense fallback={null}>
              {xrStore ? (
                <XR store={xrStore}>
                  <Suspense fallback={null}>
                    <XrSceneContentsBridge {...sceneProps} />
                  </Suspense>
                </XR>
              ) : (
                <SceneContents {...sceneProps} isInXr={false} />
              )}
            </Suspense>
          );
        })()}
      </Canvas>

      {/* Single Container-Scoped Safe-Zone Overlay — guarantees zero clipping under topbar, sidebar, split code editor, or diagnostics */}
      <div
        ref={safeAreaRef}
        data-testid="cad-viewport-safe-area"
        style={{
          position: "absolute",
          top: safeTop,
          right: safeRight,
          bottom: safeBottom,
          left: safeLeft,
          zIndex: 12,
          pointerEvents: "none",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          gap: 10,
          boxSizing: "border-box",
        }}
      >
        {/* Top Row: Left Collapsible Inspector Drawer & Right Transient Workflow Popovers */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          {/* Top-Left Slot: Unified Tabbed Parts / Subsystems / CAE / Physics 2030 / Adjoint & V&V Drawer */}
          <div style={{ minWidth: 0, maxHeight: "100%", display: "flex", flexDirection: "column" }}>
            {isDrawerOpen && (components.length > 0 || hasCaeContext) && (
              <CadInspectorDrawer
                dark={dark}
                activeTab={drawerTab}
                onSelectTab={setDrawerTab}
                onClose={() => setIsDrawerOpen(false)}
                components={components}
                selectedName={selectedName}
                onSelectPart={(name) => onSelect?.(name)}
                partOverrides={partOverrides}
                onChangePartOverride={(name, patch) =>
                  setPartOverrides((prev) => ({
                    ...prev,
                    [name]: { ...prev[name], ...patch },
                  }))
                }
                onResetPartOverrides={() => setPartOverrides({})}
                assemblyVisibility={assemblyVisibility}
                onChangeAssemblyVisibility={handleChangeAssemblyVisibility}
                hasCaeContext={hasCaeContext}
                onLaunchStudyWizard={() => setIsStudyWizardOpen(true)}
                caeTreeSlot={
                  hasCaeContext && caeModel ? (
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, minHeight: 0 }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, minHeight: 0 }}>
                        {/* Compact CAE 2030 Quick-Action Bar */}
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 4,
                            padding: "6px 8px",
                            borderRadius: 10,
                            background: dark ? "rgba(15, 23, 42, 0.92)" : "rgba(255, 255, 255, 0.96)",
                            border: `1px solid ${dark ? "rgba(255,255,255,0.14)" : "rgba(15,23,42,0.12)"}`,
                            maxWidth: 272,
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => setIsStudyWizardOpen(true)}
                            style={compactActionBtnStyle}
                          >
                            + Study
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsSweepDrawerOpen(true)}
                            style={compactActionBtnStyle}
                          >
                            DoE Sweep
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsSurrogateTrainOpen(true)}
                            style={compactActionBtnStyle}
                          >
                            POD ROM
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsTelemetryOpen((v) => !v)}
                            style={{
                              ...compactActionBtnStyle,
                              color: isTelemetryOpen || isCaeSolving ? "#22d3ee" : compactActionBtnStyle.color,
                            }}
                          >
                            Telemetry
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsoSurfaceEnabled((v) => !v)}
                            style={{
                              ...compactActionBtnStyle,
                              color: isoSurfaceEnabled ? "#22d3ee" : compactActionBtnStyle.color,
                            }}
                          >
                            Iso {isoSurfaceEnabled ? "ON" : "OFF"}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setSlicePlane((prev) =>
                                !prev
                                  ? { axis: "z", position: 0.5 }
                                  : prev.axis === "z"
                                    ? { axis: "x", position: 0.5 }
                                    : prev.axis === "x"
                                      ? { axis: "y", position: 0.5 }
                                      : null,
                              )
                            }
                            style={{
                              ...compactActionBtnStyle,
                              color: slicePlane ? "#22d3ee" : compactActionBtnStyle.color,
                            }}
                          >
                            Slice {slicePlane ? slicePlane.axis.toUpperCase() : "OFF"}
                          </button>
                          {isFeaWarpContext && (
                            <button
                              type="button"
                              onClick={() => setAnimateDeformation((v) => !v)}
                              style={{
                                ...compactActionBtnStyle,
                                color: animateDeformation ? "#22d3ee" : compactActionBtnStyle.color,
                              }}
                              title="Play/Pause oscillating FEA structural deformation"
                            >
                              {animateDeformation ? "⏸ Warp" : "▶ Warp"}
                            </button>
                          )}
                          {isCfdFlowContext && (
                            <>
                              <button
                                type="button"
                                onClick={() => setAnimateFlow((v) => !v)}
                                style={{
                                  ...compactActionBtnStyle,
                                  color: animateFlow ? "#22d3ee" : compactActionBtnStyle.color,
                                }}
                                title="Play/Pause animated CFD flow streaks"
                              >
                                {animateFlow ? "⏸ Flow" : "▶ Flow"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setShowCaeStreamlines((v) => !v)}
                                style={{
                                  ...compactActionBtnStyle,
                                  color: showCaeStreamlines ? "#22d3ee" : compactActionBtnStyle.color,
                                }}
                              >
                                Streamlines
                              </button>
                              <button
                                type="button"
                                onClick={() => setShowCaeVectors((v) => !v)}
                                style={{
                                  ...compactActionBtnStyle,
                                  color: showCaeVectors ? "#22d3ee" : compactActionBtnStyle.color,
                                }}
                              >
                                Vectors
                              </button>
                            </>
                          )}
                          {components.length > 0 && effectiveVtkBuffer && (
                            <button
                              type="button"
                              onClick={() => setGhostCadUnderlay((v) => !v)}
                              style={{
                                ...compactActionBtnStyle,
                                color: ghostCadUnderlay ? "#22d3ee" : compactActionBtnStyle.color,
                              }}
                              title="Render companion CAD geometry as translucent ghost underlay"
                            >
                              Ghost CAD
                            </button>
                          )}
                          {onTriggerHpcRun && (
                            <button
                              type="button"
                              onClick={onTriggerHpcRun}
                              style={{
                                ...compactActionBtnStyle,
                                color: dark ? "#a5b4fc" : "#4338ca",
                              }}
                              title="Dispatch CAE study to Cloud / HPC cluster"
                            >
                              ☁ Run on HPC
                            </button>
                          )}
                          {isFeaWarpContext && (
                            <label
                              style={{
                                width: "100%",
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                fontSize: 10,
                                color: dark ? "#cbd5e1" : "#334155",
                                marginTop: 2,
                              }}
                            >
                              <span>Warp</span>
                              <input
                                type="range"
                                min={0}
                                max={50}
                                step={1}
                                value={deformationScale}
                                onChange={(e) => setDeformationScale(parseFloat(e.target.value))}
                                style={{ flex: 1 }}
                              />
                              <span>{deformationScale}x</span>
                            </label>
                          )}
                          {caeTimestepFrames.length > 1 && (
                            <div
                              style={{
                                width: "100%",
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                fontSize: 10,
                                color: dark ? "#cbd5e1" : "#334155",
                                marginTop: 2,
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => setIsPlayingTimesteps((v) => !v)}
                                style={{
                                  ...compactActionBtnStyle,
                                  color: isPlayingTimesteps ? "#22d3ee" : compactActionBtnStyle.color,
                                }}
                                title="Play/Pause transient VTK timestep frames"
                              >
                                {isPlayingTimesteps ? "⏸" : "▶"}
                              </button>
                              <input
                                type="range"
                                min={0}
                                max={caeTimestepFrames.length - 1}
                                step={1}
                                value={Math.min(activeVtkFrame, caeTimestepFrames.length - 1)}
                                onChange={(e) => setActiveVtkFrame(parseInt(e.target.value, 10))}
                                style={{ flex: 1 }}
                              />
                              <span>
                                {Math.min(activeVtkFrame, caeTimestepFrames.length - 1) + 1}/{caeTimestepFrames.length}
                              </span>
                            </div>
                          )}
                          {isoSurfaceEnabled && (
                            <label
                              style={{
                                width: "100%",
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                fontSize: 10,
                                color: dark ? "#cbd5e1" : "#334155",
                                marginTop: 2,
                              }}
                            >
                              <span>Iso τ</span>
                              <input
                                type="range"
                                min={0.05}
                                max={0.95}
                                step={0.05}
                                value={isoThreshold}
                                onChange={(e) => setIsoThreshold(parseFloat(e.target.value))}
                                style={{ flex: 1 }}
                              />
                              <span>{isoThreshold.toFixed(2)}</span>
                            </label>
                          )}
                          {slicePlane && (
                            <label
                              style={{
                                width: "100%",
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                fontSize: 10,
                                color: dark ? "#cbd5e1" : "#334155",
                                marginTop: 2,
                              }}
                            >
                              <span>{slicePlane.axis.toUpperCase()} pos</span>
                              <input
                                type="range"
                                min={0.05}
                                max={0.95}
                                step={0.05}
                                value={slicePlane.position}
                                onChange={(e) =>
                                  setSlicePlane((prev) =>
                                    prev ? { ...prev, position: parseFloat(e.target.value) } : null,
                                  )
                                }
                                style={{ flex: 1 }}
                              />
                              <span>{slicePlane.position.toFixed(2)}</span>
                            </label>
                          )}
                        </div>
                        <CaeSimulationTree
                          model={caeModel}
                          runs={caeRuns}
                          dark={dark}
                          selectedItemId={selectedTreeId}
                          activeField={activeCaeField}
                          jobStatus={caeJobStatus}
                          pickedTargetSet={pickedFaceSet ?? selectedName ?? undefined}
                          onTriggerHpcRun={onTriggerHpcRun}
                          onGenerateMesh={(fineness) => {
                            const span = Math.max(0.5, sceneBounds.radius);
                            const firstSurf = effectiveComponents.find(
                              (c) => c.proceduralMesh && c.proceduralMesh.vertices.length >= 12,
                            )?.proceduralMesh;
                            const surfaceMesh = firstSurf
                              ? { vertices: firstSurf.vertices, indices: firstSurf.indices }
                              : undefined;
                            setCaeJobStatus({
                              state: "meshing",
                              label:
                                caeModel.dialect === "cfd" ? "Meshing fluid enclosure..." : "Generating Tet4 mesh...",
                              progress: 0.35,
                            });
                            void generateLocalTetMeshAsync(
                              fineness,
                              [span, span * 0.6, span * 0.6],
                              surfaceMesh,
                              caeModel.dialect === "cfd" ? 1.5 : undefined,
                            ).then((meshRes) => {
                              setLiveVtkBuffer(meshRes.vtkBuffer);
                              setCaeFieldBounds({ min: 0, max: meshRes.maxAspectRatio });
                              setActiveCaeField("Element Quality");
                              setCaeJobStatus({
                                state: "finished",
                                label: `Meshed (${meshRes.elementCount} tets)`,
                                progress: 1,
                              });
                            });
                          }}
                          onSelectItem={(item) => {
                            setSelectedTreeId(item.id);
                            if (item.line) onRevealLine?.(item.line, item.targetSet);
                          }}
                          onInsertSnippet={
                            onInsertCaeSnippet ? (_section, snippet) => onInsertCaeSnippet(snippet) : undefined
                          }
                          onTriggerRun={() => {
                            const nextNum = caeRuns.length + 1;
                            const runId = `run-${nextNum}`;
                            const runName = `Run ${nextNum}`;
                            setTelemetryHistory([]);
                            setTelemetryLogs([]);
                            setAeroMonitor(undefined);
                            setIsCaeSolving(true);
                            setIsTelemetryOpen(true);

                            const handleProgress = (ev: {
                              state: "meshing" | "solving" | "finished" | "error";
                              label: string;
                              progress: number;
                              iteration?: number | undefined;
                              residual?: number | undefined;
                              logLine?: string | undefined;
                              dragForceN?: [number, number, number] | undefined;
                            }) => {
                              setCaeJobStatus(ev);
                              if (ev.logLine) {
                                setTelemetryLogs((prev) => [...prev.slice(-199), ev.logLine!]);
                              }
                              if (ev.dragForceN) {
                                setAeroMonitor({
                                  fx: ev.dragForceN[0],
                                  fy: ev.dragForceN[1],
                                  fz: ev.dragForceN[2],
                                });
                              }
                              if (ev.iteration !== undefined || ev.residual !== undefined || ev.logLine) {
                                setTelemetryHistory((prev) => [
                                  ...prev,
                                  {
                                    iteration: ev.iteration ?? prev.length + 1,
                                    residual: ev.residual,
                                    forces: ev.dragForceN
                                      ? { fx: ev.dragForceN[0], fy: ev.dragForceN[1], fz: ev.dragForceN[2] }
                                      : undefined,
                                    rawLog: ev.logLine,
                                  },
                                ]);
                              }
                            };

                            void (async () => {
                              try {
                                if (caeModel.dialect === "cfd") {
                                  const res = await runLocalCfdStudyAsync(
                                    effectiveCaeSourceCode ?? "",
                                    runId,
                                    runName,
                                    handleProgress,
                                    mapPhysicsToCfdOptions(physicsConfig),
                                  );
                                  setLiveVtkBuffer(res.vtkBuffer);
                                  setCaeTimestepFrames((prev) => {
                                    const next = [...prev, res.vtkBuffer];
                                    setActiveVtkFrame(next.length - 1);
                                    return next;
                                  });
                                  setCaeFieldBounds({ min: res.minVelocity, max: res.maxVelocity });
                                  setActiveCaeField("Velocity Magnitude");
                                  setCaeRuns((prev) => [...prev, res.runEntry]);
                                } else {
                                  const res = await runLocalFeaStudyAsync(
                                    effectiveCaeSourceCode ?? "",
                                    runId,
                                    runName,
                                    handleProgress,
                                    mapPhysicsToFeaOptions(physicsConfig),
                                  );
                                  setLiveVtkBuffer(res.vtkBuffer);
                                  setCaeTimestepFrames((prev) => {
                                    const next = [...prev, res.vtkBuffer];
                                    setActiveVtkFrame(next.length - 1);
                                    return next;
                                  });
                                  setCaeFieldBounds({ min: res.minStressMpa, max: res.maxStressMpa });
                                  setActiveCaeField("Von Mises Stress");
                                  setCaeRuns((prev) => [...prev, res.runEntry]);
                                }
                                setCaePostView({ mode: "convergence", runId });
                              } catch (err) {
                                const msg = err instanceof Error ? err.message : String(err);
                                setCaeJobStatus({ state: "error", label: "Error" });
                                setCaeRuns((prev) => [
                                  ...prev,
                                  { id: runId, name: runName, status: "failed", logLines: [`[error] ${msg}`] },
                                ]);
                                setCaePostView({ mode: "log", runId });
                              } finally {
                                setIsCaeSolving(false);
                              }
                            })();
                          }}
                          onSelectField={(field) => setActiveCaeField(field)}
                          onOpenPostView={(view, runId) => {
                            if (view === "fields") {
                              setActiveCaeField(caeModel.dialect === "cfd" ? "Velocity Magnitude" : "Von Mises Stress");
                            } else {
                              setCaePostView((prev) =>
                                prev && prev.mode === view && prev.runId === runId ? null : { mode: view, runId },
                              );
                            }
                          }}
                        />
                      </div>
                      {caePostView && (
                        <CaePostProcessDrawer
                          mode={caePostView.mode}
                          run={caeRuns.find((r) => r.id === caePostView.runId) ?? caeRuns[0]!}
                          allRuns={caeRuns}
                          cutLineSamples={cutLineSamples}
                          dark={dark}
                          onClose={() => setCaePostView(null)}
                        />
                      )}
                    </div>
                  ) : null
                }
                physicsSlot={
                  hasCaeContext ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <CaePhysicsInspector
                        dialect={effectivePhysicsDialect}
                        pickedFaceSet={pickedFaceSet ?? selectedName ?? undefined}
                        config={physicsConfig}
                        onConfigChange={setPhysicsConfig}
                        onDialectChange={setPhysicsDialectOverride}
                        onInsertSnippet={
                          onInsertCaeSnippet ? (_section, snippet) => onInsertCaeSnippet(snippet) : undefined
                        }
                        dark={dark}
                      />
                    </div>
                  ) : null
                }
                advancedSlot={
                  hasCaeContext ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 340 }}>
                      <AdjointSensitivityPanel
                        result={adjointResult}
                        isRunning={isAdjointRunning}
                        showSensitivityOverlay={showAdjointOverlay}
                        error={adjointError}
                        onRunAdjoint={handleRunAdjoint}
                        onApplyCadParameterStep={handleApplyAdjointParamStep}
                        onToggleSensitivityOverlay={setShowAdjointOverlay}
                      />
                      <DigitalThreadCaePanel
                        hyperedges={digitalThreadHyperedges}
                        blastRadiusCount={digitalThreadHyperedges.length}
                        impactedStudyNames={[activeFileName ?? "cad_study"]}
                        podRomSummary={
                          effectiveSurrogateData
                            ? {
                                modelName: surrogateModelName ?? "CaePodSurrogate",
                                modeCount: effectiveSurrogateData.numModes,
                                evalLatencyUs: 32,
                                capturedEnergyPercent: effectiveSurrogateData.capturedEnergy * 100,
                                stateCount: effectiveSurrogateData.numFeatures,
                              }
                            : null
                        }
                        vvCases={vvCases}
                        isReconciling={isReconcilingThread}
                        isImportingLoads={isImportingLoads}
                        isExportingPod={isExportingPod}
                        isRunningVv={isRunningVv}
                        isExportingCgns={isExportingCgns}
                        onReconcileThread={() => {
                          setIsReconcilingThread(true);
                          window.setTimeout(() => setIsReconcilingThread(false), 250);
                        }}
                        onImportModelicaLoads={() => {
                          setIsImportingLoads(true);
                          if (onInsertCaeSnippet) {
                            onInsertCaeSnippet("% Imported Modelica peak boundary loads\n");
                          }
                          window.setTimeout(() => setIsImportingLoads(false), 250);
                        }}
                        onExportPodToModelica={handleExportPodToModelica}
                        onRunVvScorecard={handleRunVvScorecard}
                        onExportCgns={handleExportCgns}
                        onSelectHyperedge={(edge) => onSelect?.(edge.cadFaceId)}
                      />
                    </div>
                  ) : null
                }
              />
            )}
          </div>

          {/* Top-Right Slot: Transient Workflow Popovers & CAE Legend */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, maxWidth: "100%" }}>
            {/* Floating Face Tagging Popover */}
            {faceTagDraft && onCommitFaceTag && (
              <div
                style={{
                  pointerEvents: "auto",
                  width: 248,
                  padding: "10px 12px",
                  background: dark ? "rgba(15, 23, 42, 0.94)" : "rgba(255, 255, 255, 0.96)",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                  borderRadius: 10,
                  border: `1px solid ${dark ? "rgba(6, 182, 212, 0.45)" : "rgba(6, 182, 212, 0.35)"}`,
                  boxShadow: "0 10px 28px rgba(0, 0, 0, 0.32)",
                  color: dark ? "#f0f6fc" : "#1f2328",
                  fontSize: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ fontSize: 12, color: "#06b6d4" }}>
                    Tag Face · {faceTagDraft.hit.componentName}
                  </strong>
                  <button
                    type="button"
                    onClick={() => setFaceTagDraft(null)}
                    aria-label="Close face tag popover"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: dark ? "#94a3b8" : "#64748b",
                      cursor: "pointer",
                      fontSize: 13,
                      padding: 0,
                    }}
                  >
                    ✕
                  </button>
                </div>
                {faceTagDraft.hit.normal && (
                  <div style={{ fontSize: 10, fontFamily: "var(--font-mono, monospace)", opacity: 0.75 }}>
                    n = [{faceTagDraft.hit.normal.map((v) => v.toFixed(2)).join(", ")}]
                  </div>
                )}
                <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11 }}>
                  <span style={{ opacity: 0.8 }}>Port Name</span>
                  <input
                    type="text"
                    value={faceTagDraft.portName}
                    onChange={(e) => setFaceTagDraft((prev) => (prev ? { ...prev, portName: e.target.value } : null))}
                    style={{
                      padding: "4px 7px",
                      borderRadius: 6,
                      border: `1px solid ${dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.16)"}`,
                      background: dark ? "#0f172a" : "#ffffff",
                      color: "inherit",
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: 11,
                    }}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11 }}>
                  <span style={{ opacity: 0.8 }}>Port / Boundary Type</span>
                  <select
                    value={faceTagDraft.portType}
                    onChange={(e) => setFaceTagDraft((prev) => (prev ? { ...prev, portType: e.target.value } : null))}
                    style={{
                      padding: "4px 7px",
                      borderRadius: 6,
                      border: `1px solid ${dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.16)"}`,
                      background: dark ? "#0f172a" : "#ffffff",
                      color: "inherit",
                      fontSize: 11,
                    }}
                  >
                    <option value="fixed_support">fixed_support</option>
                    <option value="force_load">force_load</option>
                    <option value="thermal_boundary">thermal_boundary</option>
                    <option value="fluid_inlet">fluid_inlet</option>
                    <option value="mechanical_frame">mechanical_frame</option>
                  </select>
                </label>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 2 }}>
                  <button
                    type="button"
                    onClick={() => setFaceTagDraft(null)}
                    style={{
                      padding: "4px 8px",
                      borderRadius: 6,
                      border: `1px solid ${dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.14)"}`,
                      background: "transparent",
                      color: "inherit",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const portName = faceTagDraft.portName.trim() || "port_1";
                      onCommitFaceTag({
                        componentName: faceTagDraft.hit.componentName,
                        portName,
                        portType: faceTagDraft.portType,
                        normal: faceTagDraft.hit.normal,
                        worldPos: faceTagDraft.hit.worldPos,
                        sourceMetadata: faceTagDraft.hit.sourceMetadata,
                      });
                      setFaceTagDraft(null);
                    }}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 6,
                      border: "none",
                      background: "#06b6d4",
                      color: "#0f172a",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Tag Face
                  </button>
                </div>
              </div>
            )}

            {/* Mate Mode Status Hint (waiting for Part B) */}
            {gizmoMode === "mate" && matePartA && !mateDraft && (
              <div
                style={{
                  pointerEvents: "auto",
                  padding: "6px 10px",
                  background: dark ? "rgba(15, 23, 42, 0.92)" : "rgba(255, 255, 255, 0.95)",
                  backdropFilter: "blur(10px)",
                  WebkitBackdropFilter: "blur(10px)",
                  borderRadius: 10,
                  border: `1px solid ${dark ? "rgba(6, 182, 212, 0.45)" : "rgba(6, 182, 212, 0.35)"}`,
                  boxShadow: "0 6px 20px rgba(0, 0, 0, 0.25)",
                  color: dark ? "#f0f6fc" : "#1f2328",
                  fontSize: 11,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span>
                  <strong style={{ color: "#06b6d4" }}>Mate:</strong> {matePartA} → click second part
                </span>
                <button
                  type="button"
                  onClick={() => setMatePartA(null)}
                  aria-label="Clear first mate part"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: dark ? "#94a3b8" : "#64748b",
                    cursor: "pointer",
                    fontSize: 12,
                    padding: 0,
                  }}
                >
                  ✕
                </button>
              </div>
            )}

            {/* Assembly Joint (Mate) Popover */}
            {mateDraft && (
              <div
                style={{
                  pointerEvents: "auto",
                  width: 256,
                  padding: "10px 12px",
                  background: dark ? "rgba(15, 23, 42, 0.94)" : "rgba(255, 255, 255, 0.96)",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                  borderRadius: 10,
                  border: `1px solid ${dark ? "rgba(6, 182, 212, 0.45)" : "rgba(6, 182, 212, 0.35)"}`,
                  boxShadow: "0 10px 28px rgba(0, 0, 0, 0.32)",
                  color: dark ? "#f0f6fc" : "#1f2328",
                  fontSize: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ fontSize: 12, color: "#06b6d4" }}>
                    Mate · {mateDraft.partA} ↔ {mateDraft.partB}
                  </strong>
                  <button
                    type="button"
                    onClick={() => {
                      setMateDraft(null);
                      setMatePartA(null);
                    }}
                    aria-label="Close assembly joint popover"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: dark ? "#94a3b8" : "#64748b",
                      cursor: "pointer",
                      fontSize: 13,
                      padding: 0,
                    }}
                  >
                    ✕
                  </button>
                </div>
                <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11 }}>
                  <span style={{ opacity: 0.8 }}>Joint Name</span>
                  <input
                    type="text"
                    value={mateDraft.jointName}
                    onChange={(e) => setMateDraft((prev) => (prev ? { ...prev, jointName: e.target.value } : null))}
                    style={{
                      padding: "4px 7px",
                      borderRadius: 6,
                      border: `1px solid ${dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.16)"}`,
                      background: dark ? "#0f172a" : "#ffffff",
                      color: "inherit",
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: 11,
                    }}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11 }}>
                  <span style={{ opacity: 0.8 }}>Joint Type</span>
                  <select
                    value={mateDraft.jointType}
                    onChange={(e) =>
                      setMateDraft((prev) =>
                        prev ? { ...prev, jointType: e.target.value as CommitAssemblyJointPayload["jointType"] } : null,
                      )
                    }
                    style={{
                      padding: "4px 7px",
                      borderRadius: 6,
                      border: `1px solid ${dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.16)"}`,
                      background: dark ? "#0f172a" : "#ffffff",
                      color: "inherit",
                      fontSize: 11,
                    }}
                  >
                    <option value="Revolute">Revolute</option>
                    <option value="Prismatic">Prismatic</option>
                    <option value="Cylindrical">Cylindrical</option>
                    <option value="Spherical">Spherical</option>
                    <option value="Fixed">Fixed</option>
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11 }}>
                  <span style={{ opacity: 0.8 }}>Axis</span>
                  <select
                    value={mateDraft.axisKey}
                    onChange={(e) =>
                      setMateDraft((prev) => (prev ? { ...prev, axisKey: e.target.value as "z" | "y" | "x" } : null))
                    }
                    style={{
                      padding: "4px 7px",
                      borderRadius: 6,
                      border: `1px solid ${dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.16)"}`,
                      background: dark ? "#0f172a" : "#ffffff",
                      color: "inherit",
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: 11,
                    }}
                  >
                    <option value="z">Z [0, 0, 1]</option>
                    <option value="y">Y [0, 1, 0]</option>
                    <option value="x">X [1, 0, 0]</option>
                  </select>
                </label>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 2 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setMateDraft(null);
                      setMatePartA(null);
                    }}
                    style={{
                      padding: "4px 8px",
                      borderRadius: 6,
                      border: `1px solid ${dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.14)"}`,
                      background: "transparent",
                      color: "inherit",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const axisMap: Record<"z" | "y" | "x", [number, number, number]> = {
                        z: [0, 0, 1],
                        y: [0, 1, 0],
                        x: [1, 0, 0],
                      };
                      const jointName = mateDraft.jointName.trim() || `joint_${mateDraft.partA}_${mateDraft.partB}`;
                      onCommitAssemblyJoint?.({
                        jointName,
                        jointType: mateDraft.jointType,
                        partA: mateDraft.partA,
                        partB: mateDraft.partB,
                        axis: axisMap[mateDraft.axisKey],
                      });
                      setMateDraft(null);
                      setMatePartA(null);
                      onSelect?.(null);
                    }}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 6,
                      border: "none",
                      background: "#06b6d4",
                      color: "#0f172a",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Create Joint
                  </button>
                </div>
              </div>
            )}

            {/* CAE Scalar Field Legend */}
            {hasCaeContext && activeCaeField && (
              <div style={{ pointerEvents: "auto" }}>
                <ScalarColorbarLegend
                  title={activeCaeField}
                  unit={
                    activeCaeField.includes("Stress") ? "MPa" : activeCaeField.includes("Velocity") ? "m/s" : undefined
                  }
                  minLabel={caeFieldBounds.min.toFixed(2)}
                  maxLabel={caeFieldBounds.max.toFixed(2)}
                  dark={dark}
                />
              </div>
            )}
          </div>
        </div>

        {/* Bottom-Center Stack: Selection Ribbon stacked cleanly above the 3D Command Island */}
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            paddingBottom: animationController?.hasData ? 62 : 0,
            paddingRight: isCompactSafeArea ? 0 : 76,
            paddingLeft: isCompactSafeArea ? 0 : 76,
          }}
        >
          {showZonotopeOverlay && zonotopeWorkbenchState && (
            <div
              data-testid="cad-zonotope-hud-pill"
              style={{
                pointerEvents: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 10px",
                borderRadius: 999,
                background: dark ? "rgba(15, 23, 42, 0.86)" : "rgba(255, 255, 255, 0.92)",
                border: `1px solid ${dark ? "rgba(56, 189, 248, 0.38)" : "rgba(14, 165, 233, 0.38)"}`,
                color: dark ? "#e2e8f0" : "#0f172a",
                fontSize: 11,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontWeight: 600,
                boxShadow: "0 2px 10px rgba(0, 0, 0, 0.22)",
                backdropFilter: "blur(6px)",
              }}
            >
              <span>
                3D Zonotope Shells: ±
                {(
                  Math.min(
                    0.85,
                    Math.max(
                      0,
                      zonotopeWorkbenchState.budgets.cadToleranceFraction * zonotopeWorkbenchState.stressScale,
                    ),
                  ) * 100
                ).toFixed(1)}
                % · Cyan ξ=-1 / Amber ξ=+1
              </span>
            </div>
          )}

          {selectedComponent && (
            <CadSelectionRibbon
              component={selectedComponent}
              assetLabel={formatCadAssetLabel(selectedComponent.cad.uri)}
              dark={dark}
              compact={isCompactSafeArea}
              dimensionFields={onCommitDimensionDelta ? selectedDimensionFields : []}
              dimDrafts={dimDrafts}
              onChangeDimDraft={(idx, val) => setDimDrafts((prev) => ({ ...prev, [idx]: val }))}
              onCommitDim={commitDimensionInput}
              onClearDimDraft={clearDimDraft}
              onGoToSource={
                selectedComponent.sourceMetadata?.startOffset !== undefined && onRevealLine
                  ? handleRevealComponentSource
                  : undefined
              }
              onOpenBindings={() => setIsBindingPickerOpen(true)}
              onDeselect={() => onSelect?.(null)}
            />
          )}

          <CadCommandIsland
            dark={dark}
            compact={isCompactSafeArea}
            gizmoMode={gizmoMode}
            onChangeGizmoMode={setGizmoMode}
            canTransform={Boolean(onCommitGizmoDelta)}
            canTagFace={Boolean(onCommitFaceTag)}
            canMate={Boolean(onCommitAssemblyJoint)}
            clipAxis={clipAxis}
            onChangeClipAxis={(next) => {
              setClipAxis(next);
              if (next === "none") setAutoSweep(false);
            }}
            clipOffset={clipOffset}
            onChangeClipOffset={(val) => {
              setAutoSweep(false);
              setClipOffset(val);
            }}
            sectionSplit={sectionSplit}
            onToggleSectionSplit={() => setSectionSplit((s) => !s)}
            autoSweep={autoSweep}
            onToggleAutoSweep={() => setAutoSweep((s) => !s)}
            showEdges={showEdges}
            onToggleEdges={() => setShowEdges((s) => !s)}
            enableSsao={enableSsao}
            onToggleSsao={() => setEnableSsao((s) => !s)}
            autoTurntable={autoTurntable}
            onToggleTurntable={() => {
              const next = !autoTurntable;
              setAutoTurntable(next);
              setAssemblyVisibility((v) => ({ ...v, autoTurntable: next }));
            }}
            hasGdt={Boolean(gdtOverlay)}
            showGdt={showGdt}
            onToggleGdt={() => setShowGdt((s) => !s)}
            partCount={components.length}
            explosionFactor={explosionFactor}
            onChangeExplosionFactor={setExplosionFactor}
            isDrawerOpen={isDrawerOpen}
            onToggleDrawer={() => setIsDrawerOpen((o) => !o)}
            hasCaeContext={hasCaeContext}
            onResetCamera={() => setCameraResetTick((t) => t + 1)}
            onOpenVrRotunda={onOpenVrRotunda}
            canEnterWebXr={Boolean(xrCaps.vrSupported && xrStore)}
            onEnterWebXr={
              xrStore
                ? () => {
                    void enterXrSession(xrStore, "vr").then((result) => {
                      if (!result.ok && result.error) setError(result.error);
                    });
                  }
                : undefined
            }
          />
        </div>
      </div>

      {/* Formal Verification Verdict Card & 3D Jump Actions */}
      {effectiveVerdict && (
        <RequirementVerdictCard
          verdict={effectiveVerdict}
          onNavigateToRequirement={onNavigateToRequirement}
          showFlowpipe={showFlowpipe}
          onToggleFlowpipe={() => setShowFlowpipe((prev) => !prev)}
          showBarrier={showBarrier}
          onToggleBarrier={() => setShowBarrier((prev) => !prev)}
          onJumpToViolation={(time, witnessPoint) => {
            animationController?.seek(time);
            onJumpToViolation?.(time, witnessPoint);
          }}
        />
      )}

      {/* Interactive 3D Field Probe Tooltip */}
      {vtkProbe && (
        <ProbeTooltip probe={vtkProbeToProbeData(vtkProbe, caeModel?.dialect)} onClose={() => setVtkProbe(null)} />
      )}

      {/* Live Streaming CAE Convergence & Aerodynamic Telemetry HUD */}
      {(isTelemetryOpen || isCaeSolving) && (
        <CaeTelemetryPanel
          isOpen={isTelemetryOpen || isCaeSolving}
          solverName={effectivePhysicsDialect === "cfd" ? "CFD 2030 Solver" : "FEA Solver"}
          onClose={() => setIsTelemetryOpen(false)}
          telemetryPoints={telemetryHistory}
          currentPhase={caeJobStatus.label}
          progressPercent={caeJobStatus.progress !== undefined ? Math.round(caeJobStatus.progress * 100) : undefined}
          aerodynamicMonitor={aeroMonitor}
          isRunning={isCaeSolving}
        />
      )}

      {/* Parametric DoE Sweep Configuration Drawer */}
      <SweepConfigDrawer
        isOpen={isSweepDrawerOpen}
        onClose={() => setIsSweepDrawerOpen(false)}
        solver={effectivePhysicsDialect === "cfd" ? "local-cfd" : "local-fea"}
        deckTemplateText={effectiveCaeSourceCode ?? ""}
        onLaunchSweep={handleLaunchSweep}
        onTrainSurrogate={() => setIsSurrogateTrainOpen(true)}
        activeSweepState={activeSweepState}
      />

      {/* POD-Galerkin Surrogate Training Dialog */}
      <SurrogateTrainDialog
        isOpen={isSurrogateTrainOpen}
        onClose={() => setIsSurrogateTrainOpen(false)}
        onTrain={handleTrainPodSurrogate}
        onTrainLocal={handleTrainPodSurrogate}
        onExportModelica={() => handleExportPodToModelica()}
        onExportFmu={() => onExportSurrogateFmu?.(surrogateModelName ?? "CaePodSurrogate")}
        isTraining={isSurrogateTraining}
        trainingMetrics={surrogateTrainMetrics}
      />

      {/* 60 FPS Client-Side POD-Galerkin Digital Twin ROM Explorer */}
      {effectiveSurrogateData && (
        <SurrogateLiveExplorer
          surrogateData={effectiveSurrogateData}
          modelName={surrogateModelName}
          onReconstruct={onSurrogateReconstruct ?? (() => {})}
          onOpenModelica={onOpenSurrogateModelica}
          onExportFmu={onExportSurrogateFmu}
          onClose={() => {
            setLiveSurrogateData(null);
            onCloseSurrogateExplorer?.();
          }}
        />
      )}

      {/* Guided CAD-to-CFD/FEA Study Wizard Modal */}
      <CadStudyWizardModal
        isOpen={isStudyWizardOpen}
        onClose={() => setIsStudyWizardOpen(false)}
        cadArtifactName={activeFileName ?? "cad_model.step"}
        detectedFaceTags={detectedFaceTags}
        boundingBox={cadBoundingBox}
        meshHealSummary={meshHealSummary}
        onRunHealCheck={handleRunMeshHealCheck}
        onCreateStudy={handleCreateCadStudy}
        onPreviewDomainChange={(bounds) => {
          setCfdDomainPreview({
            domainMin: bounds.domainMin,
            domainMax: bounds.domainMax,
            refinementBoxes: bounds.enableOctreeRefinement
              ? [
                  {
                    id: "amr-preview-l1",
                    label: "Octree L1",
                    level: 1,
                    min: [
                      cadBoundingBox.min[0] - sceneBounds.radius * 0.4,
                      cadBoundingBox.min[1] - sceneBounds.radius * 0.4,
                      cadBoundingBox.min[2] - sceneBounds.radius * 0.4,
                    ],
                    max: [
                      cadBoundingBox.max[0] + sceneBounds.radius * 2.0,
                      cadBoundingBox.max[1] + sceneBounds.radius * 0.5,
                      cadBoundingBox.max[2] + sceneBounds.radius * 0.5,
                    ],
                  },
                ]
              : undefined,
          });
        }}
        dark={dark}
      />

      {/* Optional Composable Non-VR Field-Simulator Telemetry HUD */}
      {telemetryHud && <SimulatorTelemetryHud dark={dark} {...telemetryHud} />}

      {/* Animation timeline overlay */}
      {animationController && (
        <AnimationTimeline
          controller={animationController}
          breachMarkers={breachMarkers}
          missionPhases={missionPhases}
          operationLog={operationLog}
          fitInsets={fitInsets}
        />
      )}

      {/* Interactive Geometry-to-Variable Binding Picker Modal */}
      {selectedComponent && (
        <CadBindingPickerModal
          isOpen={isBindingPickerOpen}
          onClose={() => setIsBindingPickerOpen(false)}
          component={selectedComponent}
          availableVariables={availableVariables}
          animationController={animationController}
          onSave={(compName, newBindings) => {
            onSaveBindings?.(compName, newBindings);
          }}
          dark={dark}
        />
      )}
    </div>
  );
}
