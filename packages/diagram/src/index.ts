// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Webview-side script: receives diagram data via postMessage and
// renders it using the unified @modelscript/canvas custom graph engine.

export { rerouteEdgeOrthogonal, scheduleUpdateSolderDots, updateSolderDots } from "./canvas-edge-routing.js";
export { initGraph } from "./canvas-init.js";
export { updateParameterText } from "./canvas-node-editing.js";
export { renderDiagram, renderDiagramInternal } from "./canvas-render.js";
export {
  applySimulationBatch,
  applySimulationFrame,
  autoLayoutDiagram,
  autoLayoutDiagramAsync,
  exportDiagramPng,
  exportDiagramSvg,
  flipSelectedNodes,
  groupSelectedNodes,
  isMinimapVisible,
  layoutWithElk,
  rotateSelectedNodes,
  setDiagramGrid,
  setDiagramSnap,
  toggleGroupNodeCollapse,
  toggleMinimap,
  triggerInteractiveInput,
  ungroupSelectedNodes,
} from "./canvas-runtime.js";
export {
  disposeDiagram,
  getGraph,
  getGraphFor,
  getPropertyCacheForGraph,
  getReadOnlyForGraph,
  getSelectedNodeIdForGraph,
  setDiagramOptions,
} from "./canvas-state.js";
export type {
  Cell,
  CellData,
  CellView,
  DiagramHostMessage,
  DiagramRendererOptions,
  Edge,
  EdgeTerminal,
  Graph,
  Node,
  RenderDiagramEdgeInput,
  RenderDiagramInput,
  RenderDiagramNodeInput,
} from "./canvas-types.js";

export { applyNodeFlipVisuals } from "./alignment.js";
export { registerDefaultDiagramConnectorsAndRouters } from "./connectors.js";
export {
  clearActiveDropPlaceholder,
  dropComponentGhost,
  ensureDiagramStyles,
  getActiveDropPlaceholder,
  getTypicalNodeSize,
  isEphemeralDiagramNode,
  type DropPlaceholderOptions,
} from "./drop-placeholder.js";
export {
  evaluateModelScriptPortCompatibility,
  inferCanonicalPortDomain,
  normalizeConnectorTypeFamily,
  type CanonicalPortDomain,
  type CanonicalPortPolarity,
  type ModelScriptPortCompatibilityOptions,
  type ModelScriptPortCompatibilityResult,
  type ModelScriptPortDescriptor,
} from "./port-compatibility.js";
export { translateConnectedEdgeStubs } from "./port-router.js";
export {
  alignNodeSelectionBox,
  ensurePatchedSegmentsTool,
  ensurePatchedTransformTool,
  ensurePatchedVerticesTool,
  getEdgeToolConfig,
  resolveEdgeSelectionStyle,
  syncAllNodeSelectionBoxes,
  updateNodeVisualOnResize,
  type EdgeSelectionStyle,
  type ResolvedEdgeSelectionStyle,
} from "./selection-handles.js";
export { computeEdgeNetIds, resolveWireCrossingStyle, type WireCrossingStyle } from "./solder-dots.js";
export {
  performViewportCulling,
  scheduleViewportCulling,
  type ViewportCullingGraph,
  type ViewportCullingGraphNode,
} from "./viewport-culling.js";
export { getDiagramWasmExports, hydrateDiagramWasm, setDiagramWasmExports } from "./wasm-hydration.js";

export * from "./action-dispatch.js";
export * from "./affine-matrix.js";
export * from "./alignment.js";
export * from "./aspen-diagram-builder.js";
export * from "./autosar-diagram-builder.js";
export * from "./collab-manager.js";
export * from "./collab-overlay.js";
export * from "./color-inversion.js";
export * from "./context-menu.js";
export * from "./easy5-diagram-builder.js";
export * from "./eclipse-diagram-builder.js";
export * from "./epanet-diagram-builder.js";
export * from "./fault-tree.js";
export * from "./glyphs.js";
export * from "./grid-controls.js";
export * from "./html-diff-bundle.js";
export * from "./incremental-layout.js";
export * from "./interactive.js";
export * from "./jsbsim-diagram-builder.js";
export * from "./kinematic-diagram-builder.js";
export * from "./layout-storage.js";
export * from "./lps-diagram-builder.js";
export * from "./minimap.js";
export * from "./olga-diagram-builder.js";
export * from "./opendss-diagram-builder.js";
export * from "./openscenario-diagram-builder.js";
export * from "./oscal-diagram-builder.js";
export * from "./plcopen-diagram-builder.js";
export * from "./polyglot-diagram-builder.js";
export * from "./port-ilp-solver.js";
export * from "./port-router.js";
export * from "./properties/index.js";
export * from "./property-evaluator.js";
export * from "./property-validator.js";
export * from "./protocol.js";
export type { ReactiveAnimationBinding, X6Markup } from "./protocol.js";
export * from "./pscad-diagram-builder.js";
export * from "./psse-diagram-builder.js";
export * from "./relap5-diagram-builder.js";
export * from "./rocets-diagram-builder.js";
export * from "./sbml-diagram-builder.js";
export * from "./sima-diagram-builder.js";
export * from "./simulink-diagram-builder.js";
export * from "./spice-diagram-builder.js";
export * from "./svg-renderer.js";
export * from "./swimlane-layout.js";
export * from "./swmm-diagram-builder.js";
export * from "./telemetry.js";
export type { TopologyEdge, TopologyGraph, TopologyNode } from "./topology.js";
export * from "./touchstone-diagram-builder.js";
export * from "./tsm-layout.js";
export * from "./verilog-a-diagram-builder.js";
export * from "./viewport-culling.js";
export * from "./visual-diff-graph.js";
export * from "./visual-diff-renderer.js";

export {
  detectPrimarySymbol,
  getDialectMeta,
  highlightCodeLineToSvgTspans,
  renderUniversalCodeThumbnailSvg,
  type CodeThumbnailOptions,
  type DialectMeta,
} from "./code-thumbnail-builder.js";

export {
  applySldLayoutToCase,
  parsePsseSld,
  renderSldSvg,
  serializePsseSld,
  sldToDiagramGraph,
  type PsseSldAnnotationItem,
  type PsseSldBranchItem,
  type PsseSldBusItem,
  type PsseSldComponentItem,
  type PsseSldDrawing,
} from "./psse-sld-parser.js";

export * from "./accelerator-lattice-builder.js";
export * from "./auto-layout.js";
export * from "./climate-raster-builder.js";
export * from "./crystallography-builder.js";
export * from "./fits-astro-builder.js";
export * from "./hep-event-builder.js";
export * from "./hydro-diagram-builder.js";
export * from "./molecular-diagram-builder.js";
export * from "./neural-spike-builder.js";
export * from "./nmodl-diagram-builder.js";
export * from "./optical-bench-builder.js";
export * from "./pk-diagram-builder.js";
export * from "./plasma-fusion-builder.js";
export * from "./powerfactory-diagram-builder.js";
export * from "./pq-diagram-builder.js";
export * from "./quantum-chemistry-builder.js";
export * from "./reaction-coordinate-diagram-builder.js";
export * from "./rx-diagram-builder.js";
export * from "./scl-diagram-builder.js";
export * from "./segy-trace-builder.js";
export * from "./tcc-diagram-builder.js";
export * from "./water-network-diff.js";

export {
  AnimationPropKind,
  CanvasPointerFSM,
  CompiledAnimationEngine,
  SimulationTimelineStore,
  SoaSceneGraph,
  UnifiedCell,
  UnifiedGraph,
  UnifiedSelection,
  UnifiedTransform,
  compileGlyphMarkup,
  paintGlyphToCanvas2D,
  projectRayToPlane,
} from "@modelscript/canvas/engine";
export {
  Scissor3DPortalManager,
  SpatialSurfaceBridge,
  WebGpuSchematicRenderer,
  isWebGpuAvailable,
  packSceneForWebGpu,
} from "@modelscript/canvas/renderers";
export { paintCanvasPlot, paintCanvasTable, paintStickyBadge } from "@modelscript/canvas/widgets";
