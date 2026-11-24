// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cad — Kinematic transformation & spatial orientation math.
 *
 * Implements high-performance, zero-dependency Quaternion, Euler angle,
 * Direction Cosine Matrix (3×3 R.T), and Hermite spline interpolation solvers
 * for dynamic 3D CAD simulation animation.
 */

import type { AssemblyGraph, Mat4, Vec3 } from "./types.js";

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
  const m00 = isTranspose ? r[0]! : r[0]!;
  const m01 = isTranspose ? r[3]! : r[1]!;
  const m02 = isTranspose ? r[6]! : r[2]!;

  const m10 = isTranspose ? r[1]! : r[3]!;
  const m11 = isTranspose ? r[4]! : r[4]!;
  const m12 = isTranspose ? r[7]! : r[5]!;

  const m20 = isTranspose ? r[2]! : r[6]!;
  const m21 = isTranspose ? r[5]! : r[7]!;
  const m22 = isTranspose ? r[8]! : r[8]!;

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

  switch (order) {
    case "XYZ":
      qx = s1 * c2 * c3 + c1 * s2 * s3;
      qy = c1 * s2 * c3 - s1 * c2 * s3;
      qz = c1 * c2 * s3 + s1 * s2 * c3;
      qw = c1 * c2 * c3 - s1 * s2 * s3;
      break;
    case "YXZ":
      qx = s1 * c2 * c3 + c1 * s2 * s3;
      qy = c1 * s2 * c3 - s1 * c2 * s3;
      qz = c1 * c2 * s3 - s1 * s2 * c3;
      qw = c1 * c2 * c3 + s1 * s2 * s3;
      break;
    case "ZXY":
      qx = s1 * c2 * c3 - c1 * s2 * s3;
      qy = c1 * s2 * c3 + s1 * c2 * s3;
      qz = c1 * c2 * s3 + s1 * s2 * c3;
      qw = c1 * c2 * c3 - s1 * s2 * s3;
      break;
    case "ZYX":
      qx = s1 * c2 * c3 - c1 * s2 * s3;
      qy = c1 * s2 * c3 + s1 * c2 * s3;
      qz = c1 * c2 * s3 - s1 * s2 * c3;
      qw = c1 * c2 * c3 + s1 * s2 * s3;
      break;
    case "YZX":
      qx = s1 * c2 * c3 + c1 * s2 * s3;
      qy = c1 * s2 * c3 + s1 * c2 * s3;
      qz = c1 * c2 * s3 - s1 * s2 * c3;
      qw = c1 * c2 * c3 - s1 * s2 * s3;
      break;
    case "XZY":
      qx = s1 * c2 * c3 - c1 * s2 * s3;
      qy = c1 * s2 * c3 - s1 * c2 * s3;
      qz = c1 * c2 * s3 + s1 * s2 * c3;
      qw = c1 * c2 * c3 + s1 * s2 * s3;
      break;
    default:
      qx = s1 * c2 * c3 + c1 * s2 * s3;
      qy = c1 * s2 * c3 - s1 * c2 * s3;
      qz = c1 * c2 * s3 + s1 * s2 * c3;
      qw = c1 * c2 * c3 - s1 * s2 * s3;
      break;
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
 * Rotate a 3D vector by a unit quaternion: v' = q * v * q^-1.
 */
export function rotateVectorByQuaternion(v: Vec3, q: Quat): Vec3 {
  const [vx, vy, vz] = v;
  const [qx, qy, qz, qw] = q;

  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);

  // v' = v + qw * t + cross(q.xyz, t)
  return [vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz), vz + qw * tz + (qx * ty - qy * tx)];
}

/**
 * Construct a quaternion from Modelica MultiBody `lengthDirection` (local +X axis)
 * and `widthDirection` (local +Y reference plane), following MSL `Frames.Internal` conventions.
 */
export function quaternionFromDirections(lengthDirection: Vec3, widthDirection: Vec3 = [0, 1, 0]): Quat {
  const lx = lengthDirection[0];
  const ly = lengthDirection[1];
  const lz = lengthDirection[2];
  const lLen = Math.hypot(lx, ly, lz);
  if (lLen < 1e-12) {
    return [...QUAT_IDENTITY];
  }

  const ex0 = lx / lLen;
  const ex1 = ly / lLen;
  const ex2 = lz / lLen;

  let wx = widthDirection[0];
  let wy = widthDirection[1];
  let wz = widthDirection[2];
  const wLen = Math.hypot(wx, wy, wz);
  if (wLen < 1e-12) {
    wx = 0;
    wy = 1;
    wz = 0;
  } else {
    wx /= wLen;
    wy /= wLen;
    wz /= wLen;
  }

  // ez = normalize(ex × widthDirection)
  let ez0 = ex1 * wz - ex2 * wy;
  let ez1 = ex2 * wx - ex0 * wz;
  let ez2 = ex0 * wy - ex1 * wx;
  let ezLen = Math.hypot(ez0, ez1, ez2);

  // Fallback if widthDirection is parallel to lengthDirection
  if (ezLen < 1e-7) {
    const fx = Math.abs(ex0) < 0.9 ? 1 : 0;
    const fy = Math.abs(ex0) < 0.9 ? 0 : 1;
    const fz = 0;
    ez0 = ex1 * fz - ex2 * fy;
    ez1 = ex2 * fx - ex0 * fz;
    ez2 = ex0 * fy - ex1 * fx;
    ezLen = Math.hypot(ez0, ez1, ez2) || 1;
  }
  ez0 /= ezLen;
  ez1 /= ezLen;
  ez2 /= ezLen;

  // ey = ez × ex (guaranteed unit length and right-handed)
  const ey0 = ez1 * ex2 - ez2 * ex1;
  const ey1 = ez2 * ex0 - ez0 * ex2;
  const ey2 = ez0 * ex1 - ez1 * ex0;

  // Columns of rotation matrix are ex, ey, ez (row-major array for quaternionFromMatrix3x3(..., false))
  return quaternionFromMatrix3x3([ex0, ey0, ez0, ex1, ey1, ez1, ex2, ey2, ez2], false);
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
    const rx = qa[0] * (1 - t) + bx * t;
    const ry = qa[1] * (1 - t) + by * t;
    const rz = qa[2] * (1 - t) + bz * t;
    const rw = qa[3] * (1 - t) + bw * t;
    const len = Math.hypot(rx, ry, rz, rw) || 1.0;
    return [rx / len, ry / len, rz / len, rw / len];
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
  const sqx = x * x;
  const sqy = y * y;
  const sqz = z * z;

  const m00 = 1 - 2 * (sqy + sqz);
  const m01 = 2 * (x * y - w * z);
  const m02 = 2 * (x * z + w * y);
  const m10 = 2 * (x * y + w * z);
  const m11 = 1 - 2 * (sqx + sqz);
  const m12 = 2 * (y * z - w * x);
  const m20 = 2 * (x * z - w * y);
  const m21 = 2 * (y * z + w * x);
  const m22 = 1 - 2 * (sqx + sqy);

  const clamp = (v: number) => Math.max(-1, Math.min(1, v));

  let ex = 0,
    ey = 0,
    ez = 0;

  switch (order) {
    case "XYZ":
      ey = Math.asin(clamp(m02));
      if (Math.abs(m02) < 0.9999999) {
        ex = Math.atan2(-m12, m22);
        ez = Math.atan2(-m01, m00);
      } else {
        ex = Math.atan2(m21, m11);
        ez = 0;
      }
      break;
    case "YXZ":
      ex = Math.asin(-clamp(m12));
      if (Math.abs(m12) < 0.9999999) {
        ey = Math.atan2(m02, m22);
        ez = Math.atan2(m10, m11);
      } else {
        ey = Math.atan2(-m20, m00);
        ez = 0;
      }
      break;
    case "ZXY":
      ex = Math.asin(clamp(m21));
      if (Math.abs(m21) < 0.9999999) {
        ey = Math.atan2(-m20, m22);
        ez = Math.atan2(-m01, m11);
      } else {
        ey = 0;
        ez = Math.atan2(m10, m00);
      }
      break;
    case "ZYX":
      ey = Math.asin(-clamp(m20));
      if (Math.abs(m20) < 0.9999999) {
        ex = Math.atan2(m21, m22);
        ez = Math.atan2(m10, m00);
      } else {
        ex = 0;
        ez = Math.atan2(-m01, m11);
      }
      break;
    case "YZX":
      ez = Math.asin(clamp(m10));
      if (Math.abs(m10) < 0.9999999) {
        ex = Math.atan2(-m12, m11);
        ey = Math.atan2(-m20, m00);
      } else {
        ex = 0;
        ey = Math.atan2(m02, m22);
      }
      break;
    case "XZY":
      ez = Math.asin(-clamp(m01));
      if (Math.abs(m01) < 0.9999999) {
        ex = Math.atan2(m21, m11);
        ey = Math.atan2(m02, m00);
      } else {
        ex = Math.atan2(-m12, m22);
        ey = 0;
      }
      break;
    default:
      ey = Math.asin(clamp(m02));
      ex = Math.atan2(-m12, m22);
      ez = Math.atan2(-m01, m00);
      break;
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

// ── Hierarchical Forward Kinematics & Closed-Loop Mechanism Solvers ────────

export interface ForwardKinematicsOutput {
  /** Contiguous [x, y, z] world positions per node (`nodes.length * 3`). */
  readonly positions: Float64Array;
  /** Contiguous [qx, qy, qz, qw] world quaternions per node (`nodes.length * 4`). */
  readonly quaternions: Float64Array;
}

/**
 * Evaluates parent-before-child forward kinematics across an {@link AssemblyGraph}
 * in a single topological pass, writing world positions and quaternions directly
 * into pre-allocated typed arrays (zero per-frame allocations when reused).
 *
 * Supports `revolute`, `prismatic`, `cylindrical`, `fixed`, and `spherical` joints,
 * plus runtime detachment overrides via `detachedNodes`.
 */
export function evaluateForwardKinematics(
  graph: AssemblyGraph,
  jointValues: ReadonlyMap<string, number> | Record<string, number>,
  out?: ForwardKinematicsOutput,
  detachedNodes?: ReadonlySet<string>,
): ForwardKinematicsOutput {
  const n = graph.nodes.length;
  const positions = out && out.positions.length >= n * 3 ? out.positions : new Float64Array(n * 3);
  const quaternions = out && out.quaternions.length >= n * 4 ? out.quaternions : new Float64Array(n * 4);

  const readVal = (key: string | undefined): number => {
    if (!key) return 0;
    if (jointValues instanceof Map) return jointValues.get(key) ?? 0;
    return (jointValues as Record<string, number>)[key] ?? 0;
  };

  for (let orderIdx = 0; orderIdx < graph.topologicalOrder.length; orderIdx++) {
    const idx = graph.topologicalOrder[orderIdx]!;
    const node = graph.nodes[idx]!;
    const pOff = idx * 3;
    const qOff = idx * 4;

    const isDetached = detachedNodes?.has(node.name) ?? false;
    const parentIdx = isDetached ? -1 : node.parentIndex;

    // Parent world pose
    let px = 0;
    let py = 0;
    let pz = 0;
    let pqx = 0;
    let pqy = 0;
    let pqz = 0;
    let pqw = 1;

    if (parentIdx >= 0) {
      const ppOff = parentIdx * 3;
      const pqOff = parentIdx * 4;
      px = positions[ppOff]!;
      py = positions[ppOff + 1]!;
      pz = positions[ppOff + 2]!;
      pqx = quaternions[pqOff]!;
      pqy = quaternions[pqOff + 1]!;
      pqz = quaternions[pqOff + 2]!;
      pqw = quaternions[pqOff + 3]!;
    }

    const joint = node.joint;
    let lx = joint ? joint.origin[0] : 0;
    let ly = joint ? joint.origin[1] : 0;
    let lz = joint ? joint.origin[2] : 0;
    let lqx = 0;
    let lqy = 0;
    let lqz = 0;
    let lqw = 1;

    if (joint) {
      let qVal = readVal(joint.channel ?? node.name);
      if (joint.limits) {
        qVal = Math.max(joint.limits[0], Math.min(joint.limits[1], qVal));
      }
      const axis: Vec3 = joint.axis ?? [0, 0, 1];
      const aLen = Math.hypot(axis[0], axis[1], axis[2]) || 1;
      const ax = axis[0] / aLen;
      const ay = axis[1] / aLen;
      const az = axis[2] / aLen;

      if (joint.kind === "revolute" || joint.kind === "cylindrical") {
        const half = qVal * 0.5;
        const s = Math.sin(half);
        lqx = ax * s;
        lqy = ay * s;
        lqz = az * s;
        lqw = Math.cos(half);
      } else if (joint.kind === "prismatic") {
        lx += ax * qVal;
        ly += ay * qVal;
        lz += az * qVal;
      }
    }

    // World position = parentPos + rotate(localOrigin, parentQuat)
    const tx = 2 * (pqy * lz - pqz * ly);
    const ty = 2 * (pqz * lx - pqx * lz);
    const tz = 2 * (pqx * ly - pqy * lx);
    positions[pOff] = px + lx + pqw * tx + (pqy * tz - pqz * ty);
    positions[pOff + 1] = py + ly + pqw * ty + (pqz * tx - pqx * tz);
    positions[pOff + 2] = pz + lz + pqw * tz + (pqx * ty - pqy * tx);

    // World quaternion = parentQuat * localQuat
    quaternions[qOff] = pqw * lqx + pqx * lqw + pqy * lqz - pqz * lqy;
    quaternions[qOff + 1] = pqw * lqy - pqx * lqz + pqy * lqw + pqz * lqx;
    quaternions[qOff + 2] = pqw * lqz + pqx * lqy - pqy * lqx + pqz * lqw;
    quaternions[qOff + 3] = pqw * lqw - pqx * lqx - pqy * lqy - pqz * lqz;
  }

  return { positions, quaternions };
}

/** Closed-loop kinematic state of one piston in an axial swashplate pump (e.g., 7-piston subsea pump). */
export interface SwashplatePistonState {
  readonly index: number;
  readonly ringAngleRad: number;
  readonly radialX: number;
  readonly radialZ: number;
  /** Axial stroke displacement along +Y (meters). */
  readonly axialOffset: number;
  /** Dimensionless normalized axial velocity (-1..+1), positive = discharge stroke. */
  readonly normalizedVelocity: number;
  /** True during high-pressure discharge half-cycle, false during intake suction. */
  readonly isDischarging: boolean;
}

export interface SwashplatePumpSolution {
  readonly shaftAngleRad: number;
  readonly swashplateTiltRad: number;
  readonly swashplateQuaternion: Quat;
  readonly pistons: readonly SwashplatePistonState[];
  /** Instantaneous normalized volumetric discharge flow rate (sum of discharging pistons). */
  readonly instantaneousFlowNorm: number;
}

/**
 * Analytical closed-loop kinematics for an N-piston axial swashplate pump (e.g. 7-piston hydraulic/water-jet core).
 * Ensures exact piston-shoe contact against the tilted swashplate plane at every shaft angle.
 */
export function solveSwashplatePumpKinematics(
  shaftAngleRad: number,
  pistonCount = 7,
  swashplateTiltRad = 0.28,
  pitchRadius = 0.042,
): SwashplatePumpSolution {
  const count = Math.max(1, Math.floor(pistonCount));
  const tanTilt = Math.tan(swashplateTiltRad);
  const strokeAmp = pitchRadius * tanTilt;
  const pistons: SwashplatePistonState[] = [];
  let dischargeSum = 0;

  for (let i = 0; i < count; i++) {
    const ringAngle = (i / count) * Math.PI * 2;
    const phase = ringAngle + shaftAngleRad;
    const radialX = Math.cos(ringAngle) * pitchRadius;
    const radialZ = Math.sin(ringAngle) * pitchRadius;
    // Closed-loop constraint: piston shoe rides in plane y = R * tan(alpha) * cos(theta_i + omega*t)
    const axialOffset = strokeAmp * Math.cos(phase);
    const velNorm = -Math.sin(phase);
    const isDischarging = velNorm > 0;
    if (isDischarging) dischargeSum += velNorm;

    pistons.push({
      index: i,
      ringAngleRad: ringAngle,
      radialX,
      radialZ,
      axialOffset,
      normalizedVelocity: velNorm,
      isDischarging,
    });
  }

  // Swashplate wobbles in phase with shaft rotation while maintaining tilt angle
  const qSpin = quaternionFromAxisAngle([0, 1, 0], -shaftAngleRad, false);
  const qTilt = quaternionFromAxisAngle([0, 0, 1], swashplateTiltRad, false);
  const swashplateQuaternion = quaternionMultiply(qSpin, qTilt);

  // Average sum of positive sin half-waves over N pistons is N / PI
  const meanSum = count / Math.PI;
  const instantaneousFlowNorm = meanSum > 1e-6 ? dischargeSum / meanSum : 0;

  return {
    shaftAngleRad,
    swashplateTiltRad,
    swashplateQuaternion,
    pistons,
    instantaneousFlowNorm,
  };
}

export interface SliderCrankState {
  readonly crankAngleRad: number;
  readonly crankPin: readonly [number, number];
  readonly sliderPosition: number;
  readonly connectingRodAngleRad: number;
  readonly normalizedVelocity: number;
}

/**
 * Analytical closed-loop kinematics for a planar slider-crank mechanism (`rodLength > crankRadius`).
 */
export function solveSliderCrankKinematics(
  crankAngleRad: number,
  crankRadius: number,
  rodLength: number,
): SliderCrankState {
  const r = Math.max(1e-6, crankRadius);
  const l = Math.max(r * 1.05, rodLength);
  const cx = r * Math.cos(crankAngleRad);
  const cy = r * Math.sin(crankAngleRad);
  const sinBeta = Math.max(-0.999, Math.min(0.999, -cy / l));
  const cosBeta = Math.sqrt(Math.max(1e-9, 1 - sinBeta * sinBeta));
  const sliderPosition = cx + l * cosBeta;
  const connectingRodAngleRad = Math.asin(sinBeta);
  // dx/dtheta = -r*sin(theta) - (r^2 * sin(theta)*cos(theta)) / (l * cosBeta)
  const dxdTheta = -r * Math.sin(crankAngleRad) * (1 + (r * Math.cos(crankAngleRad)) / (l * cosBeta));
  return {
    crankAngleRad,
    crankPin: [cx, cy],
    sliderPosition,
    connectingRodAngleRad,
    normalizedVelocity: dxdTheta / r,
  };
}
