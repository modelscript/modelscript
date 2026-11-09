// SPDX-License-Identifier: AGPL-3.0-or-later

export * from "./centroid.js";
export * from "./gerber.js";
export * from "./ipc2581.js";
export * from "./netlist.js";
export * from "./odb.js";

// Rendering engine
export { DEFAULT_LAYERS, PCBRenderer } from "./engine/renderer.js";
export type {
  Camera,
  Color,
  DRCMarker,
  LayerConfig,
  Point2D,
  RatsnestLine,
  RenderPad,
  RenderTrace,
  RenderVia,
} from "./engine/renderer.js";

// Interactive router
export { DEFAULT_ROUTING_RULES, PCBRouter } from "./engine/router.js";
export type { RouterEvent, RouterEventHandler, RouterState, RoutingMode, RoutingRules } from "./engine/router.js";

// Design rule checking
export { CM_ADVANCED_HDI_RULES, CM_STANDARD_RULES, DEFAULT_DESIGN_RULES, runDRC } from "./engine/drc.js";
export type { DRCInput, DRCResult, DRCSeverity, DRCViolation, DesignRules, DfaComponentInfo } from "./engine/drc.js";

// 3D Populated PCBA Assembly & Enclosure Clearance
export * from "./pcba-3d.js";

// Regulatory & Materials Declarations (IPC-1752A, CMRT, RoHS/REACH)
export * from "./regulatory.js";
