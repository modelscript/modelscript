// SPDX-License-Identifier: AGPL-3.0-or-later

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
  PolyhedronOptions,
  PolyhedronSolid,
  Solid,
  SolidSourceMetadata,
  SphereOptions,
  SphereSolid,
  TaggedPatchSolid,
  TorusOptions,
  TorusSolid,
  TransformOffsetRange,
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
  polyhedron,
  resetNameCounter,
  sphere,
  tagPatch,
  torus,
} from "./primitives.js";

// Transforms
export {
  IDENTITY,
  mat4Multiply,
  mergeSourceMetadata,
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

// 3D BSP CSG Clipping & Mesh Metrics
export {
  CsgBspNode,
  computeMeshVolumeAndArea,
  createPolygon,
  csgIntersect,
  csgSubtract,
  csgUnion,
  planeFromPoints,
  type CsgPlane,
  type CsgPolygon,
  type CsgVertex,
} from "./csg-bsp.js";

// Assembly
export { assembly, part } from "./assembly.js";

// STEP compiler
export {
  compileAssemblyToAp242Step,
  compileAssemblyToStep,
  compileToStep,
  type StepCompileOptions,
  type StepFeatureAnchor,
  type StepPmiDatumSpec,
  type StepPmiSpec,
  type StepPmiToleranceSpec,
  type StepToleranceEntityType,
} from "./step-compiler.js";

// OpenUSD & USDZ compiler
export {
  compileAssemblyToUsd,
  compileAssemblyToUsdz,
  compileToUsd,
  compileToUsdz,
  computeCrc32,
  createUsdzArchive,
  formatUsdGeomMesh,
  formatUsdMatrix4d,
  sanitizeUsdIdentifier,
  type UsdExportOptions,
} from "./usd-compiler.js";

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
  computeAABBClosestPoints,
  computeAABBDistance,
  computeProjectedFrontalArea,
  computeSolidAABB,
  resolveClearanceRule,
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
  type DynamicDeformationBinding,
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

// Kinematics & Spatial Orientation Solvers
export {
  QUAT_IDENTITY,
  composeTransformMatrix,
  getUnitScaleFactor,
  hermiteInterpolate,
  quaternionFromAxisAngle,
  quaternionFromDirections,
  quaternionFromEuler,
  quaternionFromMatrix3x3,
  quaternionMultiply,
  quaternionSlerp,
  quaternionToEuler,
  rotateVectorByQuaternion,
  type Quat,
} from "./kinematics.js";

// Unified 3D CAD Animation Controller
export {
  AnimationController,
  type AnimationBinding,
  type AnimationMode,
  type AnimationState,
  type CadDynamicBinding,
  type CadDynamicProperty,
  type ComponentDefaultTransform,
  type ComponentTransform,
  type StateListener,
} from "./animation-controller.js";

// CAD Annotation Serialization, Parsing & Modelica Patching
export {
  parseCadBindings,
  patchModelicaAssemblyJoint,
  patchModelicaCadAnnotation,
  patchModelicaCadPortAnnotation,
  serializeCadAnnotation,
  serializeCadBinding,
  type AssemblyJointSpec,
  type CadAnnotationConfig,
  type DynamicBindingConfig,
  type MultiBodyJointType,
} from "./binding-writer.js";

// Large-Assembly Performance & Instancing
export {
  AssemblyClusteringEngine,
  InstanceBatchBuffer,
  composeTransformMatrixDirect,
  type ClusteringOptions,
  type ClusteringResult,
  type InstanceCluster,
  type InstancedPartDescriptor,
} from "./instancing.js";

// Hierarchical Spatial Partitioning & Frustum Culling (BVH)
export { AssemblyBVH, type BVHItem, type BVHNode, type FrustumPlane, type RaycastHit } from "./bvh.js";

// Dynamic Level of Detail (LoD)
export {
  LoDTier,
  computeProjectedScreenDiameter,
  generateBoxProxyMesh,
  selectLoDTier,
  type CameraViewportConfig,
  type LoDThresholds,
} from "./lod.js";

// 3D Verification Overlay Protocol & Adapters
export {
  spatialOracleToVerification3DOverlay,
  toVerification3DOverlay,
  type BarrierCertificateShellSpec,
  type CounterexampleWitnessState,
  type DynamicClearanceVectorEntry,
  type ReachabilityTubeSegment,
  type SpatialOracleIntegrityReport,
  type SpatialPinDiagnostic,
  type Verification3DOverlayPayload,
} from "./verification-overlay.js";

// Hero-grade Studio PBR, Softbox IBL & Stencil Sectioning Shaders
export {
  ALLOY_MATERIAL_PRESETS,
  SECTION_CAP_FRAGMENT_SHADER,
  SECTION_CAP_VERTEX_SHADER,
  STUDIO_GRID_FRAGMENT_SHADER,
  STUDIO_GRID_VERTEX_SHADER,
  STUDIO_SOFTBOX_LOBES,
  classifyAlloyPreset,
  evaluateStudioDomeColor,
  synthesizeBrushedAlloyTextures,
  type AlloyMaterialSpec,
  type AlloyPresetKey,
  type StudioPbrTextureBuffers,
  type StudioSoftboxLobeSpec,
} from "./studio-pbr.js";

// ASME Y14.5 GD&T 3D Feature Control Frame & STEP AP242 PMI Extraction
export {
  GDT_CHAR_SYMBOLS,
  extractStepGdtOverlay,
  formatFeatureControlFrameText,
  formatMaterialModifierGlyph,
  type GdtCallout3D,
  type GdtCharacteristicType,
  type GdtDatumFeature3D,
  type GdtDatumRef,
  type GdtMaterialModifier,
  type GdtOverlayPayload,
} from "./gdt-overlay.js";

// Self-Contained STEP Provenance, Cross-File Directives & Modelica Telemetry
export {
  basenamePosix,
  dirnamePosix,
  extractModelicaTelemetryParams,
  joinPosix,
  normalizePosixPath,
  parseQifSourceDirectives,
  parseScadSourceDirectives,
  parseScadSpoolDirectives,
  parseStepProvenanceMeta,
  relativePosix,
  resolveStepPairingFromFileMap,
  serializeStepProvenanceMeta,
  stemPosix,
  type ModelicaTelemetryParams,
  type QifSourceDirectives,
  type ResolvedStepPairing,
  type ScadSourceDirectives,
  type SpoolId,
  type SpoolKinematicsSpec,
  type StepProvenanceMeta,
} from "./step-provenance.js";
