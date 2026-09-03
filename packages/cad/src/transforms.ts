/**
 * @modelscript/cad — Affine transformations.
 *
 * All transforms wrap the child solid in a {@link TransformSolid} node
 * carrying a 4×4 column-major matrix.  Transforms compose via matrix
 * multiplication when chained.
 */

import type { Mat4, Solid, TransformSolid, Vec3 } from "./types.js";
import { SolidKind } from "./types.js";

// ── Matrix helpers ───────────────────────────────────────────────────────

/** The 4×4 identity matrix. */
export const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Multiply two 4×4 column-major matrices: result = A · B. */
export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const r = new Array<number>(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      r[col * 4 + row] =
        (a[0 * 4 + row] as number) * (b[col * 4 + 0] as number) +
        (a[1 * 4 + row] as number) * (b[col * 4 + 1] as number) +
        (a[2 * 4 + row] as number) * (b[col * 4 + 2] as number) +
        (a[3 * 4 + row] as number) * (b[col * 4 + 3] as number);
    }
  }
  return r as unknown as Mat4;
}

/** Build a translation matrix. */
export function translationMatrix(offset: Vec3): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, offset[0], offset[1], offset[2], 1];
}

/** Build a rotation matrix around an arbitrary axis (angle in radians). */
export function rotationMatrix(axis: Vec3, angle: number): Mat4 {
  const len = Math.sqrt(axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2);
  const x = axis[0] / len,
    y = axis[1] / len,
    z = axis[2] / len;
  const c = Math.cos(angle),
    s = Math.sin(angle),
    t = 1 - c;
  return [
    t * x * x + c,
    t * x * y + s * z,
    t * x * z - s * y,
    0,
    t * x * y - s * z,
    t * y * y + c,
    t * y * z + s * x,
    0,
    t * x * z + s * y,
    t * y * z - s * x,
    t * z * z + c,
    0,
    0,
    0,
    0,
    1,
  ];
}

/** Build a uniform or non-uniform scale matrix. */
export function scaleMatrix(factor: Vec3 | number): Mat4 {
  const [sx, sy, sz] = typeof factor === "number" ? [factor, factor, factor] : factor;
  return [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1];
}

/** Build a mirror matrix across a plane defined by its normal. */
export function mirrorMatrix(planeNormal: Vec3): Mat4 {
  const len = Math.sqrt(planeNormal[0] ** 2 + planeNormal[1] ** 2 + planeNormal[2] ** 2);
  const nx = planeNormal[0] / len,
    ny = planeNormal[1] / len,
    nz = planeNormal[2] / len;
  return [
    1 - 2 * nx * nx,
    -2 * nx * ny,
    -2 * nx * nz,
    0,
    -2 * nx * ny,
    1 - 2 * ny * ny,
    -2 * ny * nz,
    0,
    -2 * nx * nz,
    -2 * ny * nz,
    1 - 2 * nz * nz,
    0,
    0,
    0,
    0,
    1,
  ];
}

// ── Transform constructors ───────────────────────────────────────────────

function wrapTransform(child: Solid, matrix: Mat4, namePrefix: string): TransformSolid {
  // If the child is already a transform, compose the matrices
  if (child.kind === SolidKind.Transform) {
    return Object.freeze({
      kind: SolidKind.Transform,
      name: child.name,
      child: child.child,
      matrix: mat4Multiply(matrix, child.matrix),
    });
  }
  return Object.freeze({
    kind: SolidKind.Transform,
    name: `${namePrefix}_${child.name}`,
    child,
    matrix,
  });
}

/**
 * Translate a solid by the given offset.
 *
 * @example
 * ```ts
 * const motorFR = translate(motor, [10, 1, 10]);
 * ```
 */
export function translate(solid: Solid, offset: Vec3): TransformSolid {
  return wrapTransform(solid, translationMatrix(offset), "Translate");
}

/**
 * Rotate a solid around an axis by an angle (in degrees).
 *
 * @example
 * ```ts
 * const tilted = rotate(arm, [0, 1, 0], 45);
 * ```
 */
export function rotate(solid: Solid, axis: Vec3, angleDeg: number): TransformSolid {
  return wrapTransform(solid, rotationMatrix(axis, (angleDeg * Math.PI) / 180), "Rotate");
}

/**
 * Scale a solid uniformly or non-uniformly.
 *
 * @example
 * ```ts
 * const big = scale(part, 2);          // uniform 2×
 * const flat = scale(part, [1, 0.5, 1]); // squash Y
 * ```
 */
export function scale(solid: Solid, factor: Vec3 | number): TransformSolid {
  return wrapTransform(solid, scaleMatrix(factor), "Scale");
}

/**
 * Mirror a solid across a named plane or custom normal.
 *
 * @example
 * ```ts
 * const motorFL = mirror(motorFR, "yz");
 * ```
 */
export function mirror(solid: Solid, plane: "xy" | "xz" | "yz" | Vec3): TransformSolid {
  let normal: Vec3;
  if (plane === "yz") normal = [1, 0, 0];
  else if (plane === "xz") normal = [0, 1, 0];
  else if (plane === "xy") normal = [0, 0, 1];
  else normal = plane;
  return wrapTransform(solid, mirrorMatrix(normal), "Mirror");
}
