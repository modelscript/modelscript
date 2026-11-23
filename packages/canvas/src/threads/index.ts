// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  project3DToNdc,
  resolveAnchorWorldPoint,
  type Cad3DProjectionContext,
  type Mat4,
  type ResolvedAnchorPoint,
  type TableProjectionContext,
} from "./anchor-projector.js";
export { propagateParameterEdit, type ParameterPropagationResult } from "./reactive-propagator.js";
export { synthesizeThreadsForCanvas, type DigitalThreadAlignmentInput } from "./thread-synthesizer.js";
export {
  computeCanvasBlastRadius,
  routeCanvasWire,
  validateFmiWire,
  type CanvasBlastRadius,
  type FmiWireValidationResult,
  type RoutedWireGeometry,
} from "./wire-router.js";
