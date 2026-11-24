// SPDX-License-Identifier: AGPL-3.0-or-later

export { AnimationController } from "./animation-controller";
export type {
  AnimationBinding,
  AnimationMode,
  AnimationState,
  CadDynamicBinding,
  ComponentTransform,
} from "./animation-controller";
export { AnimationTimeline } from "./animation-timeline";
export { BarrierShellOverlay, type BarrierShellOverlayProps } from "./barrier-shell-overlay";
export { default as CadViewer } from "./cad-viewer";
export type { CadAnnotation, CadComponent, CadPortAnnotation, CadViewerProps } from "./cad-viewer";
export { CaeTelemetryPanel } from "./cae-telemetry-panel";
export { DynamicClearanceVector, type DynamicClearanceVectorProps } from "./dynamic-clearance-vector";
export { InstancedCadAssembly, type InstancedCadAssemblyProps } from "./instanced-cad-assembly";
export { extractCadComponents, parseCadAnnotationString } from "./parse-cad-annotations";
export { ReachabilityTubeOverlay, type ReachabilityTubeOverlayProps } from "./reachability-tube-overlay";
export {
  RequirementVerdictCard,
  type RequirementVerdictCardProps,
  type RequirementVerdictPayload,
} from "./requirement-verdict-card";
export {
  VrButton,
  default as VrMode,
  detectSandboxedIframe,
  getSharedVsCodeApi,
  registerSharedVsCodeApi,
  type VrButtonProps,
  type VrModeProps,
} from "./vr-mode";
