// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  applyAnimationUpdateToCell,
  applyRenderModeToDom,
  createWebGpuCanvasEl,
  paintSceneToCanvas2D,
  renderCanvas2DFrame,
  renderWidgetCanvasDom,
  resolveDesiredRenderMode,
  type Canvas2DPaintContext,
} from "./canvas2d-paint.js";
export {
  patchCellSelectorDom,
  rebuildCellDom,
  reorderCellDomByZIndex,
  resizeCellVisualDom,
  syncCellDom,
  type CellDomSyncContext,
} from "./cell-dom.js";
export {
  addEdgeToGraph,
  addNodeToGraph,
  cleanSelectionInStore,
  clearCellsFromGraph,
  disposeCellsAndCollections,
  findOrCreateCellView,
  getSelectedCellsFromStore,
  removeCellFromGraph,
  selectCellsInStore,
  syncEdgeToScene,
  syncSelectionFromFsmInStore,
  unselectCellsInStore,
  type CellStoreHost,
} from "./cell-store.js";
export {
  UnifiedCell,
  UnifiedSelection,
  UnifiedTransform,
  type UnifiedGraphOptions,
  type UnifiedSelectionOptions,
  type UnifiedTransformOptions,
} from "./cell.js";
export { attachGraphDomEventListeners } from "./dom-events.js";
export {
  applyGridArgs,
  createInitialGridState,
  mountGraphDom,
  syncAlignmentGuidesDom,
  syncGridPatternDom,
  syncMagnetHighlightsDom,
  syncMarqueeDom,
} from "./dom-layers.js";
export { computeEdgeRenderPath } from "./edge-routing.js";
export { createGraphFsmCallbacks } from "./fsm-bridge.js";
export { computeZoomToRectState, nextAutoCellId } from "./geometry.js";
export { syncEdgeToolsDom, syncSelectionBoxesDom, type OverlayDomContext } from "./overlays-dom.js";
export {
  brushPlotWidgetInHost,
  loadSimulationResultInHost,
  pauseSimulationInHost,
  playSimulationInHost,
  seekSimulationInHost,
  setWidgetPositionInHost,
  setWidgetSizeInHost,
  setWidgetTetherInHost,
  syncPlotCrosshairInHost,
  type SimulationPlaybackState,
  type SimulationWidgetsHost,
} from "./simulation-widgets.js";
export type {
  ActiveWidgetInteraction,
  EdgeRenderPathResult,
  GraphDomLayers,
  GridStyleState,
  UnifiedCanvasWidgetSpec,
  UnifiedCellViewBase,
  UnifiedConnectorFnBase,
  UnifiedEdgeTerminal,
  UnifiedPortItem,
  UnifiedRouterFnBase,
} from "./types.js";
