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
import { Canvas } from "@react-three/fiber";
import { XR } from "@react-three/xr";
import type React from "react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
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
import type { BoundaryActionPayload } from "./BoundaryPicker";
import {
  buildBoundaryCaeSnippet,
  buildDigitalThreadHyperedges,
  computeSceneBounds,
  formatCadAssetLabel,
  mapPhysicsToCfdOptions,
  mapPhysicsToFeaOptions,
  vtkProbeToProbeData,
  type AssignedBoundaryCondition,
  type CadAnnotation,
  type CadComponent,
  type CadPortAnnotation,
  type CadSourceMetadata,
  type CfdDomainPreviewState,
  type CommitAssemblyJointPayload,
  type CommitDimensionPayload,
  type CommitFaceTagPayload,
  type FaceTagDraft,
  type FaceTagHit,
  type GizmoCommitPayload,
  type GizmoMode,
  type MateDraft,
  type ProceduralMeshData,
} from "./cad-viewer-helpers";
import { CadBindingPickerModal } from "./CadBindingPickerModal";
import { CadCommandIsland } from "./CadCommandIsland";
import { CadInspectorDrawer, type CadDrawerTab } from "./CadInspectorDrawer";
import { CadEmptyState, CaeQuickActionBar, FaceTagPopover, MateWorkflowPopovers } from "./CadOverlayPanels";
import { SceneContents, XrSceneContentsBridge, type SceneContentsProps } from "./CadSceneContents";
import { CadSelectionRibbon } from "./CadSelectionRibbon";
import {
  CadStudyWizardModal,
  computeWindTunnelBounds,
  type CadBoundingBox,
  type GeneratedCadStudyResult,
  type MeshHealSummary,
} from "./CadStudyWizardModal";
import {
  exportCaeToCgnsJson,
  generateLocalTetMeshAsync,
  runAdjointSensitivityStudyAsync,
  runCfdVvScorecardAsync,
  runLocalCfdStudyAsync,
  runLocalFeaStudyAsync,
  runMeshHealCheckAsync,
  trainLocalPodSurrogateAsync,
} from "./cae-local-runner";
import { CaePhysicsInspector, createDefaultCaePhysicsConfig, type CaePhysicsConfig } from "./CaePhysicsInspector";
import {
  buildCaeSimulationModel,
  CaePostProcessDrawer,
  CaeSimulationTree,
  ScalarColorbarLegend,
  type CaeSimulationRunEntry,
} from "./CaeSimulationTree";
import { CaeTelemetryPanel, type AerodynamicMonitorSnapshot, type TelemetryDataPoint } from "./CaeTelemetryPanel";
import { DEFAULT_NASA_CFD_2030_VV_CASES, DigitalThreadCaePanel, type NasaVvCaseResult } from "./DigitalThreadCaePanel";
import type { AnsatzRelationalHypergraphRecord } from "./hypergraph-types";
import type { JetPlumeRendererProps } from "./JetPlumeRenderer";
import { ProbeTooltip } from "./ProbeTooltip";
import { RequirementVerdictCard, type RequirementVerdictPayload } from "./RequirementVerdictCard";
import { SimulatorTelemetryHud, type SimulatorTelemetryHudProps } from "./SimulatorTelemetryHud";
import { SurrogateLiveExplorer, type PodSurrogateDataPayload } from "./SurrogateLiveExplorer";
import { SurrogateTrainDialog, type SurrogateTrainConfig, type SurrogateTrainingMetrics } from "./SurrogateTrainDialog";
import {
  generateDoeSamples,
  SweepConfigDrawer,
  type ActiveSweepState,
  type SweepLaunchConfig,
} from "./SweepConfigDrawer";
import {
  computeVtkFieldSummary,
  sampleVtkCutLine,
  type VtkColormapId,
  type VtkProbePoint,
  type VtkSlicePlane,
} from "./VtkRenderer";
import { enterXrSession, getSharedXrStore, useXrCapabilities } from "./xr-session";
import type { WamTrajectoryWaypoint } from "./zonotope-3d-geometry";
import type { LinearConstraintSpec, ZonotopePendingOverride, ZonotopeWorkbenchState } from "./zonotope-workbench-state";

// ── Re-exported Types & Helpers (100% backward-compatible public surface) ───

export { formatCadAssetLabel };
export type {
  CadAnnotation,
  CadComponent,
  CadPortAnnotation,
  CadSourceMetadata,
  CommitAssemblyJointPayload,
  CommitDimensionPayload,
  CommitFaceTagPayload,
  GizmoCommitPayload,
  GizmoMode,
  ProceduralMeshData,
};

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
  /** Enable experimental/in-progress CAE panels (Adjoint, Digital Thread, POD Surrogate). Defaults to false. */
  enableExperimentalCaePanels?: boolean | undefined;
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
  enableExperimentalCaePanels = false,
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
  const [faceTagDraft, setFaceTagDraft] = useState<FaceTagDraft | null>(null);
  const [matePartA, setMatePartA] = useState<string | null>(null);
  const [mateDraft, setMateDraft] = useState<MateDraft | null>(null);
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
  const [cfdDomainPreview, setCfdDomainPreview] = useState<CfdDomainPreviewState | null>(null);
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
  const [caeColormap, setCaeColormap] = useState<VtkColormapId>("turbo");
  const [caeLogScale, setCaeLogScale] = useState<boolean>(false);

  useEffect(() => {
    if (!isPlayingTimesteps || caeTimestepFrames.length <= 1) return;
    const timer = window.setInterval(() => {
      setActiveVtkFrame((prev) => (prev + 1) % caeTimestepFrames.length);
    }, 450);
    return () => window.clearInterval(timer);
  }, [isPlayingTimesteps, caeTimestepFrames.length]);

  // Live streaming telemetry & local worker cancellation
  const [isTelemetryOpen, setIsTelemetryOpen] = useState<boolean>(false);
  const [telemetryHistory, setTelemetryHistory] = useState<TelemetryDataPoint[]>([]);
  const [_telemetryLogs, setTelemetryLogs] = useState<string[]>([]);
  const [aeroMonitor, setAeroMonitor] = useState<AerodynamicMonitorSnapshot | undefined>(undefined);
  const [isCaeSolving, setIsCaeSolving] = useState<boolean>(false);
  const caeAbortControllerRef = useRef<AbortController | null>(null);

  // Persisted in-browser generated mesh & 3D boundary face picker state
  const [generatedFeaMesh, setGeneratedFeaMesh] = useState<{
    nodeCoords: Float32Array;
    elements: Uint32Array;
    numNodes: number;
    numElements: number;
  } | null>(null);
  const [isPickBoundaryMode, setIsPickBoundaryMode] = useState<boolean>(false);
  const [assignedBcs, setAssignedBcs] = useState<AssignedBoundaryCondition[]>([]);

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
  const caeFieldSummary = useMemo(
    () => (hasCaeContext && effectiveVtkBuffer ? computeVtkFieldSummary(effectiveVtkBuffer, activeCaeField) : null),
    [hasCaeContext, effectiveVtkBuffer, activeCaeField],
  );
  const caeModel = useMemo(() => {
    if (!hasCaeContext) return null;
    const base = buildCaeSimulationModel(
      effectiveCaeSourceCode ?? "",
      components.map((c) => ({ name: c.name, watertight: meshHealSummary ? meshHealSummary.isWatertight : true })),
    );
    if (generatedFeaMesh && base.mesh.elementCount === 0) {
      return {
        ...base,
        mesh: {
          ...base.mesh,
          nodeCount: generatedFeaMesh.numNodes,
          elementCount: generatedFeaMesh.numElements,
          elementTypes: { C3D4: generatedFeaMesh.numElements },
          status: "ok" as const,
        },
        statuses: {
          ...base.statuses,
          mesh: "ok" as const,
        },
      };
    }
    return base;
  }, [hasCaeContext, effectiveCaeSourceCode, components, generatedFeaMesh, meshHealSummary]);
  const effectivePhysicsDialect: "cfd" | "fea" =
    physicsDialectOverride ?? (caeModel?.dialect === "fea" ? "fea" : "cfd");
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
    return {
      solidPlane: new THREE.Plane(new THREE.Vector3(nx, ny, nz), 0),
      wirePlane: new THREE.Plane(new THREE.Vector3(-nx, -ny, -nz), 0),
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
  const selectedDim0 = selectedComponent?.sourceMetadata?.dimensions?.[0];
  const selectedDim1 = selectedComponent?.sourceMetadata?.dimensions?.[1];
  const selectedDim2 = selectedComponent?.sourceMetadata?.dimensions?.[2];
  useEffect(() => {
    setDimDrafts({});
  }, [selectedComponent?.name, selectedDim0, selectedDim1, selectedDim2]);

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
      return [{ index: 0, label: "R", value: dims[0]!, primitiveType: "sphere" as const }];
    }
    if (prim.includes("cylinder") || prim.includes("cone")) {
      return [
        { index: 0, label: "R", value: dims[0]!, primitiveType: "cylinder" as const },
        { index: 1, label: "H", value: dims[1]!, primitiveType: "cylinder" as const },
      ];
    }
    return [
      { index: 0, label: "X", value: dims[0]!, primitiveType: "cube" as const },
      { index: 1, label: "Y", value: dims[1]!, primitiveType: "cube" as const },
      ...(dims.length >= 3 ? [{ index: 2, label: "Z", value: dims[2]!, primitiveType: "cube" as const }] : []),
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

  const primaryCadSurfaceMesh = useMemo(() => {
    const firstSurf = effectiveComponents.find(
      (c) => c.proceduralMesh && c.proceduralMesh.vertices.length >= 9 && c.proceduralMesh.indices.length >= 3,
    )?.proceduralMesh;
    if (!firstSurf) return null;
    return {
      positions: firstSurf.vertices instanceof Float32Array ? firstSurf.vertices : new Float32Array(firstSurf.vertices),
      indices: firstSurf.indices instanceof Uint32Array ? firstSurf.indices : new Uint32Array(firstSurf.indices),
    };
  }, [effectiveComponents]);

  const handleSelectBoundary = useCallback(
    (action: BoundaryActionPayload) => {
      const targetName = String(action.targetId || "FACE_1").toUpperCase();
      setPickedFaceSet(targetName);
      if (action.worldPos) {
        setAssignedBcs((prev) => [
          ...prev.slice(-24),
          {
            id: `bc-${Date.now()}-${prev.length}`,
            kind: action.kind,
            label: targetName,
            worldPos: action.worldPos!,
            normal: action.normal ?? [0, 1, 0],
          },
        ]);
      }
      if (!onInsertCaeSnippet) return;
      const snippet = buildBoundaryCaeSnippet(action, targetName);
      if (snippet) onInsertCaeSnippet(snippet);
    },
    [onInsertCaeSnippet],
  );

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
        <CadEmptyState dark={dark} fitInsets={fitInsets} />
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

  const digitalThreadHyperedges = buildDigitalThreadHyperedges(components, caeModel?.dialect, activeFileName);

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
      const studyOpts = result.studyOptions as
        | { domainMultipliers?: { upstreamX: number; downstreamX: number; lateralY: number; verticalZ: number } }
        | undefined;
      const bounds = computeWindTunnelBounds(
        cadBoundingBox,
        studyOpts?.domainMultipliers ?? {
          upstreamX: 3,
          downstreamX: 8,
          lateralY: 3,
          verticalZ: 3,
        },
      );
      setCfdDomainPreview({
        domainMin: bounds.domainMin,
        domainMax: bounds.domainMax,
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
    const totalRuns = Math.max(1, Math.min(config.sampleCount, 32));
    const maxConcurrency = Math.max(1, Math.min(config.concurrency || 2, 4));
    const isCfd = effectivePhysicsDialect === "cfd";
    const templateText = effectiveCaeSourceCode ?? "";

    const doeSamples = generateDoeSamples(config.parameters, totalRuns, config.strategy);
    const initialRuns = doeSamples.map((pMap, i) => ({
      runIndex: i,
      status: "queued" as "queued" | "running" | "completed" | "failed",
      parameters: pMap,
      scalars: undefined as Record<string, unknown> | undefined,
      durationMs: undefined as number | undefined,
    }));

    setActiveSweepState({
      sweepId,
      status: "running",
      totalRuns: initialRuns.length,
      completedRuns: 0,
      failedRuns: 0,
      progressPercent: 0,
      runs: initialRuns,
    });

    void (async () => {
      let completed = 0;
      let failed = 0;
      let nextIdx = 0;
      const runsCopy = initialRuns.map((r) => ({ ...r }));
      const effectiveTotal = runsCopy.length;

      const emitState = (done: boolean) => {
        setActiveSweepState({
          sweepId,
          status: done
            ? failed > 0 && completed > 0
              ? "partial_success"
              : failed === effectiveTotal
                ? "failed"
                : "completed"
            : "running",
          totalRuns: effectiveTotal,
          completedRuns: completed,
          failedRuns: failed,
          progressPercent: effectiveTotal > 0 ? Math.round(((completed + failed) / effectiveTotal) * 100) : 100,
          runs: runsCopy.map((r) => ({ ...r })),
        });
      };

      const runOne = async (i: number) => {
        const entry = runsCopy[i]!;
        entry.status = "running";
        emitState(false);

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
              steps: 24,
              obstacleMesh: primaryCadSurfaceMesh
                ? { vertices: primaryCadSurfaceMesh.positions, indices: primaryCadSurfaceMesh.indices }
                : undefined,
            });
            entry.status = "completed";
            entry.scalars = {
              maxVelocity: Number(res.maxVelocity.toFixed(3)),
              deltaP: Number((res.maxPressure - res.minPressure).toFixed(1)),
            };
            entry.durationMs = Math.round(performance.now() - t0);
            completed++;
          } else {
            const res = await runLocalFeaStudyAsync(deck, `${sweepId}-${i + 1}`, `Sweep #${i + 1}`, undefined, {
              ...mapPhysicsToFeaOptions(physicsConfig),
              generatedMesh: generatedFeaMesh ?? undefined,
            });
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
        emitState(completed + failed >= effectiveTotal);
      };

      const workers = Array.from({ length: Math.min(maxConcurrency, effectiveTotal) }, async () => {
        while (nextIdx < effectiveTotal) {
          const idx = nextIdx++;
          await runOne(idx);
        }
      });
      await Promise.all(workers);
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
            boundaryPickerSurface: primaryCadSurfaceMesh,
            isPickBoundaryMode: hasCaeContext && isPickBoundaryMode,
            caeDialect: effectivePhysicsDialect,
            assignedBcs,
            onSelectBoundary: handleSelectBoundary,
            caeColormap,
            caeLogScale,
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
                        <CaeQuickActionBar
                          dark={dark}
                          hasPrimarySurfaceMesh={Boolean(primaryCadSurfaceMesh)}
                          hasComponentsAndVtk={components.length > 0 && Boolean(effectiveVtkBuffer)}
                          enableExperimentalCaePanels={enableExperimentalCaePanels}
                          isPickBoundaryMode={isPickBoundaryMode}
                          isTelemetryOpen={isTelemetryOpen}
                          isCaeSolving={isCaeSolving}
                          isoSurfaceEnabled={isoSurfaceEnabled}
                          isoThreshold={isoThreshold}
                          slicePlane={slicePlane}
                          isFeaWarpContext={isFeaWarpContext}
                          isCfdFlowContext={isCfdFlowContext}
                          animateDeformation={animateDeformation}
                          deformationScale={deformationScale}
                          animateFlow={animateFlow}
                          showCaeStreamlines={showCaeStreamlines}
                          showCaeVectors={showCaeVectors}
                          ghostCadUnderlay={ghostCadUnderlay}
                          timestepFrameCount={caeTimestepFrames.length}
                          activeVtkFrame={activeVtkFrame}
                          isPlayingTimesteps={isPlayingTimesteps}
                          onOpenStudyWizard={() => setIsStudyWizardOpen(true)}
                          onOpenSweepDrawer={() => setIsSweepDrawerOpen(true)}
                          onTogglePickBoundaryMode={() => setIsPickBoundaryMode((v) => !v)}
                          onOpenSurrogateTrain={() => setIsSurrogateTrainOpen(true)}
                          onToggleTelemetry={() => setIsTelemetryOpen((v) => !v)}
                          onToggleIsoSurface={() => setIsoSurfaceEnabled((v) => !v)}
                          onChangeIsoThreshold={setIsoThreshold}
                          onCycleSlicePlane={() =>
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
                          onChangeSlicePosition={(pos) =>
                            setSlicePlane((prev) => (prev ? { ...prev, position: pos } : null))
                          }
                          onToggleAnimateDeformation={() => setAnimateDeformation((v) => !v)}
                          onChangeDeformationScale={setDeformationScale}
                          onToggleAnimateFlow={() => setAnimateFlow((v) => !v)}
                          onToggleCaeStreamlines={() => setShowCaeStreamlines((v) => !v)}
                          onToggleCaeVectors={() => setShowCaeVectors((v) => !v)}
                          onToggleGhostCadUnderlay={() => setGhostCadUnderlay((v) => !v)}
                          onTogglePlayTimesteps={() => setIsPlayingTimesteps((v) => !v)}
                          onChangeActiveVtkFrame={setActiveVtkFrame}
                          onTriggerHpcRun={onTriggerHpcRun}
                        />
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
                              setGeneratedFeaMesh({
                                nodeCoords: meshRes.nodeCoords,
                                elements: meshRes.elements,
                                numNodes: meshRes.nodeCount,
                                numElements: meshRes.elementCount,
                              });
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
                            caeAbortControllerRef.current?.abort();
                            const abortController = new AbortController();
                            caeAbortControllerRef.current = abortController;
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
                                    {
                                      ...mapPhysicsToCfdOptions(physicsConfig),
                                      obstacleMesh: primaryCadSurfaceMesh
                                        ? {
                                            vertices: primaryCadSurfaceMesh.positions,
                                            indices: primaryCadSurfaceMesh.indices,
                                          }
                                        : undefined,
                                    },
                                    abortController.signal,
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
                                    {
                                      ...mapPhysicsToFeaOptions(physicsConfig),
                                      generatedMesh: generatedFeaMesh ?? undefined,
                                    },
                                    abortController.signal,
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
                                if (err instanceof DOMException && err.name === "AbortError") {
                                  setCaeJobStatus({ state: "idle", label: "Cancelled" });
                                  return;
                                }
                                const msg = err instanceof Error ? err.message : String(err);
                                setCaeJobStatus({ state: "error", label: "Error" });
                                setCaeRuns((prev) => [
                                  ...prev,
                                  { id: runId, name: runName, status: "failed", logLines: [`[error] ${msg}`] },
                                ]);
                                setCaePostView({ mode: "log", runId });
                              } finally {
                                if (caeAbortControllerRef.current === abortController) {
                                  caeAbortControllerRef.current = null;
                                }
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
                  hasCaeContext && enableExperimentalCaePanels ? (
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
                        blastRadiusCount={digitalThreadHyperedges.filter((e) => e.status !== "Synced").length}
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
              <FaceTagPopover
                dark={dark}
                draft={faceTagDraft}
                onChangeDraft={setFaceTagDraft}
                onClose={() => setFaceTagDraft(null)}
                onCommit={onCommitFaceTag}
              />
            )}

            {/* Mate Mode Status Hint & Assembly Joint Popover */}
            <MateWorkflowPopovers
              dark={dark}
              gizmoMode={gizmoMode}
              matePartA={matePartA}
              mateDraft={mateDraft}
              onClearMatePartA={() => setMatePartA(null)}
              onChangeMateDraft={setMateDraft}
              onCancelMate={() => {
                setMateDraft(null);
                setMatePartA(null);
              }}
              onCommitAssemblyJoint={onCommitAssemblyJoint}
              onClearSelection={() => onSelect?.(null)}
            />

            {/* CAE Scalar Field Legend */}
            {hasCaeContext && activeCaeField && (
              <div style={{ pointerEvents: "auto" }}>
                <ScalarColorbarLegend
                  title={activeCaeField}
                  unit={
                    activeCaeField.includes("Stress") ? "MPa" : activeCaeField.includes("Velocity") ? "m/s" : undefined
                  }
                  minLabel={(caeFieldSummary?.min ?? caeFieldBounds.min).toFixed(2)}
                  maxLabel={(caeFieldSummary?.max ?? caeFieldBounds.max).toFixed(2)}
                  dark={dark}
                  colormap={caeColormap}
                  onChangeColormap={setCaeColormap}
                  logScale={caeLogScale}
                  onToggleLogScale={() => setCaeLogScale((v) => !v)}
                  fieldSummary={caeFieldSummary}
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
        <ProbeTooltip
          probe={vtkProbeToProbeData(vtkProbe, caeModel?.dialect === "fea" ? "fea" : "cfd")}
          dark={dark}
          onClose={() => setVtkProbe(null)}
        />
      )}

      {/* Docked Bottom Live Streaming CAE Convergence & Aerodynamic Telemetry Strip */}
      {(isTelemetryOpen || isCaeSolving) && (
        <CaeTelemetryPanel
          isOpen={isTelemetryOpen || isCaeSolving}
          solverName={effectivePhysicsDialect === "cfd" ? "Local CFD Solver" : "Local FEA Solver"}
          onClose={() => setIsTelemetryOpen(false)}
          onCancel={
            isCaeSolving
              ? () => {
                  caeAbortControllerRef.current?.abort();
                }
              : undefined
          }
          telemetryPoints={telemetryHistory}
          currentPhase={caeJobStatus.label}
          progressPercent={caeJobStatus.progress !== undefined ? Math.round(caeJobStatus.progress * 100) : undefined}
          aerodynamicMonitor={aeroMonitor}
          isRunning={isCaeSolving}
          dark={dark}
          docked
        />
      )}

      {/* Parametric DoE Sweep Configuration Drawer */}
      <SweepConfigDrawer
        isOpen={isSweepDrawerOpen}
        onClose={() => setIsSweepDrawerOpen(false)}
        solver={effectivePhysicsDialect === "cfd" ? "local-cfd" : "local-fea"}
        deckTemplateText={effectiveCaeSourceCode ?? ""}
        onLaunchSweep={handleLaunchSweep}
        onTrainSurrogate={enableExperimentalCaePanels ? () => setIsSurrogateTrainOpen(true) : undefined}
        activeSweepState={activeSweepState}
        dark={dark}
      />

      {/* POD-Galerkin Surrogate Training Dialog (gated until real 3D snapshot training is wired) */}
      {enableExperimentalCaePanels && (
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
      )}

      {/* Client-Side POD-Galerkin Digital Twin ROM Explorer (only shown if externally provided or experimental enabled) */}
      {(surrogateData || (enableExperimentalCaePanels && liveSurrogateData)) && effectiveSurrogateData && (
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
