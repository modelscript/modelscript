// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ecad-canvas
 *
 * Web-native ECAD PCB layout canvas for ModelScript.
 * Provides rendering, interactive routing, and design rule checking.
 */

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
export { DEFAULT_DESIGN_RULES, runDRC } from "./engine/drc.js";
export type { DRCInput, DRCResult, DRCSeverity, DRCViolation, DesignRules } from "./engine/drc.js";
