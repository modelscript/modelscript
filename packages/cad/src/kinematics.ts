// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cad — Kinematic transformation & spatial orientation math.
 *
 * Implements high-performance, zero-dependency Quaternion, Euler angle,
 * Direction Cosine Matrix (3×3 R.T), and Hermite spline interpolation solvers
 * for dynamic 3D CAD simulation animation.
 */

import type { Mat4, Vec3 } from "./types.js";

/** Quaternion represented as [x, y, z, w]. */
export type Quat = [number, number, number, number];

export const QUAT_IDENTITY: Quat = [0, 0, 0, 1];

// ── Quaternion Math ─────────────────────────────────────────────────────────

/**
 * Construct a quaternion from a 3×3 rotation matrix.
 *
 * Supports both standard rotation matrices and Modelica Mechanics.MultiBody
 * orientation objects where `R.T` represents the TRANSPOSE of the direction cosine matrix.
 *
 * @param r - 9-element array [r11, r12, r13, r21, r22, r23, r31, r32, r33]
 * @param isTranspose - If true, treats input as R.T (Modelica convention)
 */
export function quaternionFromMatrix3x3(r: number[] | Float64Array | Float32Array, isTranspose = true): Quat {
  if (r.length < 9) return [...QUAT_IDENTITY];

  // If isTranspose is true, matrix rows are columns of R.T
  // Row 1: m00, m01, m02
  // Row 2: m10, m11, m12
  // Row 3: m20, m21, m22
  const m00 = isTranspose ? r[0] : r[0];
  const m01 = isTranspose ? r[3] : r[1];
  const m02 = isTranspose ? r[6] : r[2];

  const m10 = isTranspose ? r[1] : r[3];
  const m11 = isTranspose ? r[4] : r[4];
  const m12 = isTranspose ? r[7] : r[5];

  const m20 = isTranspose ? r[2] : r[6];
  const m21 = isTranspose ? r[5] : r[7];
  const m22 = isTranspose ? r[8] : r[8];

  const trace = m00 + m11 + m22;
  let qx = 0,
    qy = 0,
    qz = 0,
    qw = 1;

  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    qw = 0.25 / s;
    qx = (m21 - m12) * s;
    qy = (m02 - m20) * s;
    qz = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
    qw = (m21 - m12) / s;
    qx = 0.25 * s;
    qy = (m01 + m10) / s;
    qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
    qw = (m02 - m20) / s;
    qx = (m01 + m10) / s;
    qy = 0.25 * s;
    qz = (m12 + m21) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
    qw = (m10 - m01) / s;
    qx = (m02 + m20) / s;
    qy = (m12 + m21) / s;
    qz = 0.25 * s;
  }

  // Normalize
  const len = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw) || 1.0;
  return [qx / len, qy / len, qz / len, qw / len];
}

/**
 * Construct a quaternion from intrinsic Euler angles (order: "XYZ", "ZYX", etc.).
 */
export function quaternionFromEuler(x: number, y: number, z: number, order = "XYZ", inDegrees = true): Quat {
  const toRad = inDegrees ? Math.PI / 180 : 1;
  const ex = (x * toRad) / 2;
  const ey = (y * toRad) / 2;
  const ez = (z * toRad) / 2;

  const c1 = Math.cos(ex);
  const c2 = Math.cos(ey);
  const c3 = Math.cos(ez);
  const s1 = Math.sin(ex);
  const s2 = Math.sin(ey);
  const s3 = Math.sin(ez);

  let qx = 0,
    qy = 0,
    qz = 0,
    qw = 1;

  if (order === "XYZ") {
    qx = s1 * c2 * c3 + c1 * s2 * s3;
    qy = c1 * s2 * c3 - s1 * c2 * s3;
    qz = c1 * c2 * s3 + s1 * s2 * c3;
    qw = c1 * c2 * c3 - s1 * s2 * s3;
  } else if (order === "ZYX") {
    qx = s1 * c2 * c3 - c1 * s2 * s3;
    qy = c1 * s2 * c3 + s1 * c2 * s3;
    qz = c1 * c2 * s3 - s1 * s2 * c3;
    qw = c1 * c2 * c3 + s1 * s2 * s3;
  } else {
    // Default fallback to XYZ
    qx = s1 * c2 * c3 + c1 * s2 * s3;
    qy = c1 * s2 * c3 - s1 * c2 * s3;
    qz = c1 * c2 * s3 + s1 * s2 * c3;
    qw = c1 * c2 * c3 - s1 * s2 * s3;
  }

  const len = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw) || 1.0;
  return [qx / len, qy / len, qz / len, qw / len];
}

/**
 * Construct a quaternion from an axis and rotation angle.
 */
export function quaternionFromAxisAngle(axis: Vec3, angle: number, inDegrees = false): Quat {
  const rad = inDegrees ? (angle * Math.PI) / 180 : angle;
  const halfAngle = rad / 2;
  const s = Math.sin(halfAngle);
  const len = Math.sqrt(axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2) || 1.0;

  return [(axis[0] / len) * s, (axis[1] / len) * s, (axis[2] / len) * s, Math.cos(halfAngle)];
}

/**
 * Multiply two quaternions: result = a · b.
 */
export function quaternionMultiply(a: Quat, b: Quat): Quat {
  const [x1, y1, z1, w1] = a;
  const [x2, y2, z2, w2] = b;

  return [
    w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
    w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
    w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
    w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
  ];
}

/**
 * Spherical linear interpolation between two quaternions.
 */
export function quaternionSlerp(qa: Quat, qb: Quat, t: number): Quat {
  let [bx, by, bz, bw] = qb;
  let cosHalfTheta = qa[0] * bx + qa[1] * by + qa[2] * bz + qa[3] * bw;

  // Shortest path
  if (cosHalfTheta < 0) {
    bw = -bw;
    bx = -bx;
    by = -by;
    bz = -bz;
    cosHalfTheta = -cosHalfTheta;
  }

  if (Math.abs(cosHalfTheta) >= 1.0) {
    return [...qa];
  }

  const halfTheta = Math.acos(cosHalfTheta);
  const sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta * cosHalfTheta);

  if (Math.abs(sinHalfTheta) < 0.001) {
    return [qa[0] * 0.5 + bx * 0.5, qa[1] * 0.5 + by * 0.5, qa[2] * 0.5 + bz * 0.5, qa[3] * 0.5 + bw * 0.5];
  }

  const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
  const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;

  return [
    qa[0] * ratioA + bx * ratioB,
    qa[1] * ratioA + by * ratioB,
    qa[2] * ratioA + bz * ratioB,
    qa[3] * ratioA + bw * ratioB,
  ];
}

/**
 * Convert quaternion to Euler angles (in degrees or radians).
 */
export function quaternionToEuler(q: Quat, order = "XYZ", inDegrees = true): [number, number, number] {
  const [x, y, z, w] = q;
  const sqw = w * w;
  const sqx = x * x;
  const sqy = y * y;
  const sqz = z * z;

  let ex = 0,
    ey = 0,
    ez = 0;

  if (order === "XYZ") {
    ex = Math.atan2(2 * (w * x - y * z), sqw - sqx - sqy + sqz);
    ey = Math.asin(Math.max(-1, Math.min(1, 2 * (w * y + x * z))));
    ez = Math.atan2(2 * (w * z - x * y), sqw + sqx - sqy - sqz);
  } else {
    ex = Math.atan2(2 * (w * x + y * z), 1 - 2 * (sqx + sqy));
    ey = Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x))));
    ez = Math.atan2(2 * (w * z + x * y), 1 - 2 * (sqy + sqz));
  }

  const factor = inDegrees ? 180 / Math.PI : 1;
  return [ex * factor, ey * factor, ez * factor];
}

/**
 * Convert position, quaternion, and scale into a 4×4 column-major transformation matrix.
 */
export function composeTransformMatrix(position: Vec3, quaternion: Quat, scale: Vec3 = [1, 1, 1]): Mat4 {
  const [x, y, z, w] = quaternion;
  const [sx, sy, sz] = scale;

  const x2 = x + x,
    y2 = y + y,
    z2 = z + z;
  const xx = x * x2,
    xy = x * y2,
    xz = x * z2;
  const yy = y * y2,
    yz = y * z2,
    zz = z * z2;
  const wx = w * x2,
    wy = w * y2,
    wz = w * z2;

  return [
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,

    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,

    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,

    position[0],
    position[1],
    position[2],
    1,
  ];
}

// ── Physical Unit Scaling ──────────────────────────────────────────────────

/**
 * Compute the dimensional scale factor between simulation variable units and CAD space.
 * E.g. Modelica SI meters "m" to STEP millimeters "mm" returns 1000.
 */
export function getUnitScaleFactor(sourceUnit?: string, targetUnit = "m"): number {
  if (!sourceUnit || !targetUnit) return 1.0;
  const s = sourceUnit.trim().toLowerCase();
  const t = targetUnit.trim().toLowerCase();
  if (s === t) return 1.0;

  // Length
  if (s === "m" && t === "mm") return 1000.0;
  if (s === "mm" && t === "m") return 0.001;
  if (s === "cm" && t === "m") return 0.01;
  if (s === "m" && t === "cm") return 100.0;
  if (s === "in" && t === "m") return 0.0254;
  if (s === "m" && t === "in") return 39.3701;

  // Angle
  if (s === "rad" && t === "deg") return 180 / Math.PI;
  if (s === "deg" && t === "rad") return Math.PI / 180;
  if (s === "rpm" && (t === "rad/s" || t === "1/s")) return (2 * Math.PI) / 60;
  if ((s === "rad/s" || s === "1/s") && t === "rpm") return 60 / (2 * Math.PI);

  return 1.0;
}

// ── Interpolation ──────────────────────────────────────────────────────────

/**
 * Cubic Hermite spline interpolation for smooth time-series scrubbing.
 */
export function hermiteInterpolate(p0: number, m0: number, p1: number, m1: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1;
}
