/**
 * @modelscript/cad — Public API re-exports.
 */

// Types
export type {
  Assembly,
  BooleanSolid,
  BoundaryPatchTag,
  BoundaryPatchType,
  BoxOptions,
  BoxSolid,
  ChamferSolid,
  CylinderOptions,
  CylinderSolid,
  ExtrusionOptions,
  ExtrusionSolid,
  FilletSolid,
  Mat4,
  ParamMeta,
  ParamOptions,
  PartEntry,
  Solid,
  SphereOptions,
  SphereSolid,
  TaggedPatchSolid,
  TorusOptions,
  TorusSolid,
  TransformSolid,
  Vec3,
} from "./types.js";

export { SolidKind } from "./types.js";

// Primitives
export {
  box,
  chamfer,
  cylinder,
  fillet,
  linearExtrude,
  resetNameCounter,
  sphere,
  tagPatch,
  torus,
} from "./primitives.js";

// Transforms
export {
  IDENTITY,
  mat4Multiply,
  mirror,
  mirrorMatrix,
  rotate,
  rotationMatrix,
  scale,
  scaleMatrix,
  translate,
  translationMatrix,
} from "./transforms.js";

// Booleans
export { intersect, subtract, union } from "./booleans.js";

// Assembly
export { assembly, part } from "./assembly.js";

// STEP compiler
export { compileAssemblyToStep, compileToStep } from "./step-compiler.js";

// CSG OpenCascade Worker
export { CSGWorker, type CSGExecutionGraph, type CSGNode } from "./worker.js";

// Manifold CSG Worker
export { ManifoldWorker, type ManifoldSurfaceMesh } from "./manifold-worker.js";

// Parameter Inversion & ROM Load Pipeline
export {
  ParameterInversionEngine,
  type InversionResult as CadInversionResult,
  type CertifiedInversionResult,
  type ParameterConstraintRule,
  type ParameterInversionUpdate,
  type SafeRegionGuard,
} from "./parameter-inversion.js";
export { RomLoadPipeline, type FeaBoundaryCondition, type TransientPeakLoad } from "./rom_load_pipeline.js";

// Spatial Clearance & Verification
export {
  computeAABBDistance,
  computeSolidAABB,
  transformAABB,
  unionAABB,
  verifyAssemblyClearance,
  type AABB,
  type ClearanceConstraint,
  type SpatialClearanceReport,
  type SpatialClearanceViolation,
} from "./clearance.js";

// Reachability-Certified Dynamic Clearance
export {
  DynamicClearanceVerifier,
  type DynamicClearanceOptions,
  type DynamicClearanceReport,
  type DynamicClearanceViolation,
  type DynamicTransformBinding,
  type IntervalBox,
  type TrajectoryStepEnclosure,
} from "./dynamic-clearance.js";

// Dynamic GD&T and Operational Tolerance Stack-Up
export {
  ToleranceStackVerifier,
  type DimensionTolerance,
  type OperationalEnvironment,
  type ToleranceContributor,
  type ToleranceStackOptions,
  type ToleranceStackResult,
} from "./tolerance-stack.js";
