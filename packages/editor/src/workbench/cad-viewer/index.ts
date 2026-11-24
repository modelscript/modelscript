// SPDX-License-Identifier: AGPL-3.0-or-later

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
export { CadBindingPickerModal } from "./CadBindingPickerModal";
export { default as CadViewer } from "./CadViewer";
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
} from "./CadViewer";
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
export { CalloutLabels3D, type CalloutLabels3DProps, type CalloutPin3D } from "./CalloutLabels3D";
export { InstancedCadAssembly, type InstancedCadAssemblyProps } from "./InstancedCadAssembly";
export { JetPlumeRenderer, type JetPlumeRendererProps } from "./JetPlumeRenderer";
export { extractCadComponents, parseCadAnnotationString, parseSourceCadVariables } from "./parse-cad-annotations";
export { SimulatorTelemetryHud, type SimulatorTelemetryHudProps } from "./SimulatorTelemetryHud";
export {
  drawBarArrayWidget,
  drawHorizonWidget,
  drawSegmentedBarWidget,
  drawSparklineWidget,
  formatRuntimeClock,
  paintTelemetryOverlayToCanvas,
  type CanvasHitRegion,
} from "./telemetry-canvas-painter";
