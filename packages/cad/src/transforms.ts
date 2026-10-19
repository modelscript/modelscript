// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cad — Affine transformations.
 *
 * All transforms wrap the child solid in a {@link TransformSolid} node
 * carrying a 4×4 column-major matrix.  Transforms compose via matrix
 * multiplication when chained.
 */

import type { Mat4, Solid, SolidSourceMetadata, TransformSolid, Vec3 } from "./types.js";
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
  if (len < 1e-12) return [...IDENTITY] as Mat4;
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
  if (len < 1e-12) return [...IDENTITY] as Mat4;
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

export function mergeSourceMetadata(
  inner?: SolidSourceMetadata,
  outer?: SolidSourceMetadata,
): SolidSourceMetadata | undefined {
  if (!inner && !outer) return undefined;
  if (!inner) {
    if (!outer) return undefined;
    return {
      ...outer,
      translateRange:
        outer.translateRange ??
        (outer.transformMethod === "translate" && outer.startOffset !== undefined && outer.endOffset !== undefined
          ? { startOffset: outer.startOffset, endOffset: outer.endOffset }
          : undefined),
      rotateRange:
        outer.rotateRange ??
        (outer.transformMethod === "rotate" && outer.startOffset !== undefined && outer.endOffset !== undefined
          ? { startOffset: outer.startOffset, endOffset: outer.endOffset }
          : undefined),
      scaleRange:
        outer.scaleRange ??
        (outer.transformMethod === "scale" && outer.startOffset !== undefined && outer.endOffset !== undefined
          ? { startOffset: outer.startOffset, endOffset: outer.endOffset }
          : undefined),
    };
  }
  if (!outer) return inner;

  const translateRange =
    outer.translateRange ??
    (outer.transformMethod === "translate" && outer.startOffset !== undefined && outer.endOffset !== undefined
      ? { startOffset: outer.startOffset, endOffset: outer.endOffset }
      : inner.translateRange);
  const rotateRange =
    outer.rotateRange ??
    (outer.transformMethod === "rotate" && outer.startOffset !== undefined && outer.endOffset !== undefined
      ? { startOffset: outer.startOffset, endOffset: outer.endOffset }
      : inner.rotateRange);
  const scaleRange =
    outer.scaleRange ??
    (outer.transformMethod === "scale" && outer.startOffset !== undefined && outer.endOffset !== undefined
      ? { startOffset: outer.startOffset, endOffset: outer.endOffset }
      : inner.scaleRange);

  const composedTranslation: Vec3 | undefined =
    outer.translation && inner.translation
      ? [
          inner.translation[0] + outer.translation[0],
          inner.translation[1] + outer.translation[1],
          inner.translation[2] + outer.translation[2],
        ]
      : (outer.translation ?? inner.translation);

  const composedScale: Vec3 | undefined =
    outer.scale && inner.scale
      ? [inner.scale[0] * outer.scale[0], inner.scale[1] * outer.scale[1], inner.scale[2] * outer.scale[2]]
      : (outer.scale ?? inner.scale);

  return {
    parameterName: outer.parameterName ?? inner.parameterName,
    dimensionParams: outer.dimensionParams ?? inner.dimensionParams,
    dimensions: outer.dimensions ?? inner.dimensions,
    transformMethod: outer.transformMethod ?? inner.transformMethod,
    argIndex: outer.argIndex ?? inner.argIndex,
    startOffset: outer.startOffset ?? inner.startOffset,
    endOffset: outer.endOffset ?? inner.endOffset,
    primitiveStartOffset: outer.primitiveStartOffset ?? inner.primitiveStartOffset,
    primitiveEndOffset: outer.primitiveEndOffset ?? inner.primitiveEndOffset,
    translateRange,
    rotateRange,
    scaleRange,
    translation: composedTranslation,
    rotation: outer.rotation ?? inner.rotation,
    scale: composedScale,
    color: outer.color ?? inner.color,
  };
}

function wrapTransform(
  child: Solid,
  matrix: Mat4,
  namePrefix: string,
  sourceMetadata?: SolidSourceMetadata,
): TransformSolid {
  const mergedMeta = mergeSourceMetadata(child.sourceMetadata, sourceMetadata);
  // If the child is already a transform, compose the matrices
  if (child.kind === SolidKind.Transform) {
    return Object.freeze({
      kind: SolidKind.Transform,
      name: child.name,
      child: child.child,
      matrix: mat4Multiply(matrix, child.matrix),
      sourceMetadata: mergedMeta,
    });
  }
  return Object.freeze({
    kind: SolidKind.Transform,
    name: `${namePrefix}_${child.name}`,
    child,
    matrix,
    sourceMetadata: mergedMeta,
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
export function translate(solid: Solid, offset: Vec3, sourceMetadata?: SolidSourceMetadata): TransformSolid {
  return wrapTransform(solid, translationMatrix(offset), "Translate", sourceMetadata);
}

/**
 * Rotate a solid around an axis by an angle (in degrees).
 *
 * @example
 * ```ts
 * const tilted = rotate(arm, [0, 1, 0], 45);
 * ```
 */
export function rotate(
  solid: Solid,
  axis: Vec3,
  angleDeg: number,
  sourceMetadata?: SolidSourceMetadata,
): TransformSolid {
  return wrapTransform(solid, rotationMatrix(axis, (angleDeg * Math.PI) / 180), "Rotate", sourceMetadata);
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
export function scale(solid: Solid, factor: Vec3 | number, sourceMetadata?: SolidSourceMetadata): TransformSolid {
  return wrapTransform(solid, scaleMatrix(factor), "Scale", sourceMetadata);
}

/**
 * Mirror a solid across a named plane or custom normal.
 *
 * @example
 * ```ts
 * const motorFL = mirror(motorFR, "yz");
 * ```
 */
export function mirror(
  solid: Solid,
  plane: "xy" | "xz" | "yz" | Vec3,
  sourceMetadata?: SolidSourceMetadata,
): TransformSolid {
  let normal: Vec3;
  if (plane === "yz") normal = [1, 0, 0];
  else if (plane === "xz") normal = [0, 1, 0];
  else if (plane === "xy") normal = [0, 0, 1];
  else normal = plane;
  return wrapTransform(solid, mirrorMatrix(normal), "Mirror", sourceMetadata);
}
