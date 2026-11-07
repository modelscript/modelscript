/**
 * @modelscript/cad — Affine transformations.
 *
 * All transforms wrap the child solid in a {@link TransformSolid} node
 * carrying a 4×4 column-major matrix.  Transforms compose via matrix
 * multiplication when chained.
 */
import type { Mat4, Solid, SolidSourceMetadata, TransformSolid, Vec3 } from "./types.js";
/** The 4×4 identity matrix. */
export declare const IDENTITY: Mat4;
/** Multiply two 4×4 column-major matrices: result = A · B. */
export declare function mat4Multiply(a: Mat4, b: Mat4): Mat4;
/** Build a translation matrix. */
export declare function translationMatrix(offset: Vec3): Mat4;
/** Build a rotation matrix around an arbitrary axis (angle in radians). */
export declare function rotationMatrix(axis: Vec3, angle: number): Mat4;
/** Build a uniform or non-uniform scale matrix. */
export declare function scaleMatrix(factor: Vec3 | number): Mat4;
/** Build a mirror matrix across a plane defined by its normal. */
export declare function mirrorMatrix(planeNormal: Vec3): Mat4;
export declare function mergeSourceMetadata(inner?: SolidSourceMetadata, outer?: SolidSourceMetadata): SolidSourceMetadata | undefined;
/**
 * Translate a solid by the given offset.
 *
 * @example
 * ```ts
 * const motorFR = translate(motor, [10, 1, 10]);
 * ```
 */
export declare function translate(solid: Solid, offset: Vec3, sourceMetadata?: SolidSourceMetadata): TransformSolid;
/**
 * Rotate a solid around an axis by an angle (in degrees).
 *
 * @example
 * ```ts
 * const tilted = rotate(arm, [0, 1, 0], 45);
 * ```
 */
export declare function rotate(solid: Solid, axis: Vec3, angleDeg: number, sourceMetadata?: SolidSourceMetadata): TransformSolid;
/**
 * Scale a solid uniformly or non-uniformly.
 *
 * @example
 * ```ts
 * const big = scale(part, 2);          // uniform 2×
 * const flat = scale(part, [1, 0.5, 1]); // squash Y
 * ```
 */
export declare function scale(solid: Solid, factor: Vec3 | number, sourceMetadata?: SolidSourceMetadata): TransformSolid;
/**
 * Mirror a solid across a named plane or custom normal.
 *
 * @example
 * ```ts
 * const motorFL = mirror(motorFR, "yz");
 * ```
 */
export declare function mirror(solid: Solid, plane: "xy" | "xz" | "yz" | Vec3, sourceMetadata?: SolidSourceMetadata): TransformSolid;
//# sourceMappingURL=transforms.d.ts.map