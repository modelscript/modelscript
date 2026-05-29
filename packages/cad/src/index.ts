/**
 * @modelscript/cad — Public API re-exports.
 */

// Types
export type {
  Assembly,
  BooleanSolid,
  BoxOptions,
  BoxSolid,
  CylinderOptions,
  CylinderSolid,
  Mat4,
  ParamMeta,
  ParamOptions,
  PartEntry,
  Solid,
  SphereOptions,
  SphereSolid,
  TorusOptions,
  TorusSolid,
  TransformSolid,
  Vec3,
} from "./types.js";

export { SolidKind } from "./types.js";

// Primitives
export { box, cylinder, resetNameCounter, sphere, torus } from "./primitives.js";

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
