// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  computeBasisFunctions,
  evaluateNurbsCurve,
  evaluateNurbsSurface,
  findKnotSpan,
  tessellateNurbsCurve,
  tessellateNurbsSurface,
  type TessellatedSurfaceMesh,
} from "./nurbs.js";

export {
  IDENTITY_TRANSFORM_124,
  applyTransform124,
  composeTransform124,
  computeBoundingBox,
  computePolylineLength,
  evaluateCircularArc,
  evaluateIgesDocument,
  evaluateIgesEntity,
  evaluateLineEntity,
  mergeBoundingBoxes,
  resolveEntityTransform,
  scalePoint,
  type BoundingBox3D,
  type EvaluateIgesOptions,
  type EvaluatedCircularArc,
  type EvaluatedEntityResult,
  type IgesEvaluationResult,
  type Transform3x4,
} from "./evaluator.js";

export { lowerIgesToCad, type IgesCadLoweringOptions, type IgesCadLoweringResult } from "./lowering.js";
