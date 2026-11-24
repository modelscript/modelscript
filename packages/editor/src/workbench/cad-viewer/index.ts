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
export { InstancedCadAssembly, type InstancedCadAssemblyProps } from "./InstancedCadAssembly";
export { extractCadComponents, parseCadAnnotationString, parseSourceCadVariables } from "./parse-cad-annotations";
