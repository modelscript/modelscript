// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  extractVrDiagramData,
  extractVrSimulationSeries,
  paintBoardToTextureCanvas,
  resolveEffectiveBounds,
  type DragPreviewState,
  type VrDiagramDataLike,
  type VrDiagramEdgeLike,
  type VrDiagramNodeLike,
} from "./board-painter.js";
export { DraftingPodium, type DraftingPodiumProps } from "./DraftingPodium.js";
export { EngineeringRotunda, default } from "./EngineeringRotunda.js";
export {
  RotundaEnvironment,
  getEnvironmentSceneBackdrop,
  type EnvironmentSceneBackdrop,
  type RotundaEnvironmentProps,
} from "./environments.js";
export { FloatingToolWings, type FloatingToolWingsProps } from "./FloatingToolWings.js";
export { HeroModelAsset, type HeroModelAssetProps } from "./HeroModelAsset.js";
export {
  MultiplayerPresence,
  computePeerRotundaSeat,
  type MultiplayerPresenceProps,
  type PeerRotundaSeat,
} from "./MultiplayerPresence.js";
export { ROTUNDA_SHOWCASE_MODELS, ROTUNDA_SHOWCASE_SCENARIOS, getRotundaScenarioById } from "./showcase-catalog.js";
export {
  TurntableCarousel,
  computeCarouselSlotTransform,
  type CarouselSlotTransform,
  type TurntableCarouselProps,
} from "./TurntableCarousel.js";
export {
  PLINTH_CENTER_REAL_SCALE,
  PLINTH_CENTER_TABLETOP,
  PODIUM_CENTER,
  PODIUM_HEIGHT_METERS,
  PODIUM_WIDTH_METERS,
  ROTUNDA_BOARD_CANVAS_HEIGHT,
  ROTUNDA_BOARD_CANVAS_WIDTH,
  ROTUNDA_BOARD_TEX_OFFSET_X,
  ROTUNDA_BOARD_TEX_OFFSET_Y,
  ROTUNDA_BOARD_TEX_SCALE,
  ROTUNDA_ENVIRONMENTS,
  boardBoundsToPlaneBounds,
  buildPodiumSpatialPlane,
  buildRotundaCanvasDocument,
  clampNumber,
  createInitialRotundaState,
  extractModelsFromCanvasDocument,
  extractVtkBuffer,
  isLoadableGltfUri,
  planeUvToBoard,
  rotundaReducer,
  wrapIndex,
  type BuildRotundaBoardOptions,
  type EngineeringRotundaProps,
  type RotundaAction,
  type RotundaAnimationControllerLike,
  type RotundaCadPartInput,
  type RotundaCaeOverlay,
  type RotundaClipAxis,
  type RotundaComponentTransformLike,
  type RotundaEnvironmentId,
  type RotundaEnvironmentMeta,
  type RotundaModelEntry,
  type RotundaModelKind,
  type RotundaRenderStyle,
  type RotundaScaleMode,
  type RotundaScenarioPreset,
  type RotundaState,
} from "./types.js";
export {
  XrControllerBindings,
  XrLocomotionRig,
  clampTeleportDestination,
  computeTwoHandExplodeDelta,
  evaluatePinchState,
  type XrControllerBindingsProps,
  type XrLocomotionRigProps,
} from "./xr-gestures.js";
export {
  SHARED_XR_STORE_CONFIG,
  detectSandboxedIframe,
  getSharedXrStore,
  playRotundaCue,
  pulseXrHaptics,
  useXrCapabilities,
  type RotundaCueKind,
  type XrCapabilities,
} from "./xr-session.js";
