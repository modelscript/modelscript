// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  AdjointSensitivityPanel,
  type AdjointMode,
  type AdjointObjective,
  type AdjointRunConfig,
  type AdjointSensitivityPanelProps,
  type AdjointSensitivityResult,
  type CadParameterSensitivity,
} from "./AdjointSensitivityPanel";
export { AnimationController } from "./animation-controller";
export type {
  AnimationBinding,
  AnimationMode,
  AnimationState,
  CadDynamicBinding,
  ComponentTransform,
} from "./animation-controller";
export { AnimationTimeline } from "./AnimationTimeline";
export {
  createDefaultAssemblyVisibility,
  inferSubsystemsFromPartNames,
  resolvePartPresentation,
  type AssemblyVisibilityState,
  type ResolvedPartPresentation,
  type SubsystemSummary,
} from "./assembly-visibility";
export { AssemblyInspectorPanel, type AssemblyInspectorPanelProps } from "./AssemblyInspectorPanel";
export { BarrierShellOverlay, type BarrierShellOverlayProps } from "./BarrierShellOverlay";
export {
  BoundaryPicker,
  type BoundaryActionPayload,
  type BoundaryConditionKind,
  type BoundaryPickerProps,
  type BoundaryProbeFields,
  type CfdBoundaryKind,
  type FaceGeometricReadout,
  type FeaBoundaryKind,
  type StressProbeMarker,
} from "./BoundaryPicker";
export { CadBindingPickerModal } from "./CadBindingPickerModal";
export { CadCommandIsland, type CadCommandIslandProps } from "./CadCommandIsland";
export { CadComponentTree, type CadComponentTreeProps } from "./CadComponentTree";
export {
  CadInspectorDrawer,
  type CadDrawerTab,
  type CadInspectorDrawerProps,
  type CadPartOverride,
} from "./CadInspectorDrawer";
export { CadSelectionRibbon, type CadSelectionRibbonProps } from "./CadSelectionRibbon";
export {
  CadStudyWizardModal,
  STUDY_ARCHETYPES,
  computeWindTunnelBounds,
  generateStudyDeckFromCad,
  type CadBoundingBox,
  type CadStudyWizardConfig,
  type CadStudyWizardModalProps,
  type CfdDomainMultipliers,
  type FeaElementOrder,
  type FeaMaterialPresetId,
  type FeaMeshDensity,
  type GeneratedCadStudyResult,
  type MeshHealSummary,
  type StudyArchetypeId,
  type StudyArchetypeSpec,
} from "./CadStudyWizardModal";
export { default as CadViewer } from "./CadViewer";
export type {
  CadAnnotation,
  CadComponent,
  CadPortAnnotation,
  CadSourceMetadata,
  CadViewerProps,
  CommitAssemblyJointPayload,
  CommitDimensionPayload,
  CommitFaceTagPayload,
  GizmoCommitPayload,
  GizmoMode,
  ProceduralMeshData,
} from "./CadViewer";
export * from "./cae-local-runner";
export {
  CaePhysicsInspector,
  computeCfrpLaminateSummary,
  computeYPlusMetrics,
  createDefaultCaePhysicsConfig,
  serializePhysicsToDeckDirectives,
  type CaeCfdPhysicsConfig,
  type CaeCltLaminateSummary,
  type CaeFeaPhysicsConfig,
  type CaePhysicsConfig,
  type CaePhysicsInspectorProps,
  type CaeYPlusResult,
} from "./CaePhysicsInspector";
export {
  CaePostProcessDrawer,
  CaeSimulationTree,
  ScalarColorbarLegend,
  buildCaeSimulationModel,
  type CaeGeometryEntry,
  type CaeNodeStatus,
  type CaeSimulationModel,
  type CaeSimulationRunEntry,
  type CaeSimulationTreeProps,
  type CaeTreeItemRef,
} from "./CaeSimulationTree";
export {
  CaeTelemetryPanel,
  type AerodynamicMonitorSnapshot,
  type CaeTelemetryPanelProps,
  type TelemetryDataPoint,
} from "./CaeTelemetryPanel";
export { CalloutLabels3D, type CalloutLabels3DProps, type CalloutPin3D } from "./CalloutLabels3D";
export { CfdDomainGizmo, type CfdDomainGizmoProps, type CfdRefinementBox } from "./CfdDomainGizmo";
export {
  DEFAULT_NASA_CFD_2030_VV_CASES,
  DigitalThreadCaePanel,
  type DigitalThreadCaePanelProps,
  type DigitalThreadHyperedge,
  type DigitalThreadTab,
  type HyperedgeSyncStatus,
  type ModelicaPeakLoadChannel,
  type NasaVvCaseResult,
  type PodRomBridgeSummary,
  type VvCaseStatus,
} from "./DigitalThreadCaePanel";
export { DynamicClearanceVector, type DynamicClearanceVectorProps } from "./DynamicClearanceVector";
export * from "./gltf-cache-guard";
export { buildCleanCreaseEdgeGeometry } from "./HeroCadMaterials";
export * from "./hypergraph-types";
export { InstancedCadAssembly, type InstancedCadAssemblyProps } from "./InstancedCadAssembly";
export { JetPlumeRenderer, type JetPlumeRendererProps } from "./JetPlumeRenderer";
export { extractCadComponents, parseCadAnnotationString, parseSourceCadVariables } from "./parse-cad-annotations";
export { ProbeTooltip, type ProbeData, type ProbeTooltipProps } from "./ProbeTooltip";
export { ReachabilityTubeOverlay, type ReachabilityTubeOverlayProps } from "./ReachabilityTubeOverlay";
export {
  RequirementVerdictCard,
  type RequirementVerdictCardProps,
  type RequirementVerdictPayload,
} from "./RequirementVerdictCard";
export {
  EMPTY_SCAD_FEATURE_OVERRIDES,
  applyScadOperationOverrides,
  countCadFeatureNodes,
  formatCadPartDisplayName,
  hasActiveScadOverrides,
  type CadFeatureKind,
  type CadFeatureNode,
  type ScadFeatureOverrides,
  type ScadModifierChar,
} from "./scad-feature-tree";
export * from "./SharedScissor3DHost";
export { SimulatorTelemetryHud, type SimulatorTelemetryHudProps } from "./SimulatorTelemetryHud";
export {
  SurrogateLiveExplorer,
  reconstructSurrogate,
  type PodSurrogateDataPayload,
  type SurrogateLiveExplorerProps,
} from "./SurrogateLiveExplorer";
export {
  SurrogateTrainDialog,
  type SurrogateExportTargets,
  type SurrogateTrainConfig,
  type SurrogateTrainDialogProps,
  type SurrogateTrainingMetrics,
} from "./SurrogateTrainDialog";
export {
  SweepConfigDrawer,
  extractTemplateParameters,
  type ActiveSweepState,
  type ParametricVariableConfig,
  type SweepConfigDrawerProps,
  type SweepLaunchConfig,
  type SweepRunInfo,
  type SweepSamplingStrategy,
  type SweepSolverKind,
} from "./SweepConfigDrawer";
export {
  drawBarArrayWidget,
  drawHorizonWidget,
  drawSegmentedBarWidget,
  drawSparklineWidget,
  formatRuntimeClock,
  paintTelemetryOverlayToCanvas,
  type CanvasHitRegion,
} from "./telemetry-canvas-painter";
export { computeCadSafeInsets, type CadSafeInsets, type ComputeCadSafeInsetsInput } from "./viewport-safe-area";
export {
  VtkRenderer,
  sampleVtkCutLine,
  type VtkProbePoint,
  type VtkRendererProps,
  type VtkSlicePlane,
} from "./VtkRenderer";
export * from "./xr-session";
export * from "./zonotope-3d-geometry";
export * from "./zonotope-workbench-state";
export { ZonotopeCadOverlay, type ZonotopeCadOverlayProps } from "./ZonotopeCadOverlay";
