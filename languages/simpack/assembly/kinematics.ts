// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript WebAssembly Kernel for SIMPACK Multibody Kinematics.
 *
 * Implements high-performance, zero-allocation linear-memory operations for:
 * - 3D Tait-Bryan Direction Cosine rotation matrices R(alpha, beta, gamma) in SO(3)
 * - Spatial coordinate transformations for markers on 6-DOF rigid/flexible bodies
 * - Algebraic joint kinematic constraint residuals Phi(q) = 0
 * - Cut-joint kinematic loop closure residuals for closed spatial kinematic chains
 * - Batched multi-marker and multi-joint kinematics evaluation with zero JS boundary crossings
 */

// =============================================================================
// Constants & Memory Layout
// =============================================================================

export const VECTOR3D_BYTES: usize = 24;       // 3 x f64
export const ROT_MATRIX_BYTES: usize = 72;     // 9 x f64
export const SPATIAL_TRANSFORM_BYTES: usize = 96; // Vector (24) + Matrix (72)
export const JOINT_RESIDUAL_BYTES: usize = 56;    // posError (24) + orientError (24) + norm (8)

// Pre-allocated static scratchpad (64KB at offset 1024 to avoid zero pointer)
export const SCRATCH_BASE: usize = 1024;
export const SCRATCH_SIZE: usize = 64512;

// Inertial reference frame (0 pos, identity rot) stored at SCRATCH_BASE
const INERTIAL_POS_PTR: usize = SCRATCH_BASE;
const INERTIAL_ROT_PTR: usize = SCRATCH_BASE + 24;

// Global working scratch pointers
const SCRATCH_VEC_0: usize = SCRATCH_BASE + 96;
const SCRATCH_VEC_1: usize = SCRATCH_BASE + 120;
const SCRATCH_VEC_2: usize = SCRATCH_BASE + 144;
const SCRATCH_MAT_0: usize = SCRATCH_BASE + 168;
const SCRATCH_MAT_1: usize = SCRATCH_BASE + 240;
const SCRATCH_MAT_2: usize = SCRATCH_BASE + 312;
const SCRATCH_RESIDUAL_0: usize = SCRATCH_BASE + 384;
const SCRATCH_BUFFER_START: usize = SCRATCH_BASE + 512;

// =============================================================================
// Memory Allocation & Initialization
// =============================================================================

export function kin_alloc(size: usize): usize {
  return heap.alloc(size);
}

export function kin_free(ptr: usize): void {
  if (ptr != 0 && ptr >= (SCRATCH_BASE + SCRATCH_SIZE)) {
    heap.free(ptr);
  }
}

export function kin_get_scratch_base(): usize {
  return SCRATCH_BASE;
}

export function kin_get_scratch_buffer(): usize {
  return SCRATCH_BUFFER_START;
}

export function kin_init(): void {
  // Initialize inertial frame position (0, 0, 0)
  store<f64>(INERTIAL_POS_PTR + 0, 0.0);
  store<f64>(INERTIAL_POS_PTR + 8, 0.0);
  store<f64>(INERTIAL_POS_PTR + 16, 0.0);

  // Initialize inertial frame rotation (Identity 3x3)
  kin_identity_matrix(INERTIAL_ROT_PTR);
}

// =============================================================================
// Vector Algebra (3D)
// =============================================================================

export function kin_dot_product(uPtr: usize, vPtr: usize): f64 {
  const ux = load<f64>(uPtr + 0);
  const uy = load<f64>(uPtr + 8);
  const uz = load<f64>(uPtr + 16);

  const vx = load<f64>(vPtr + 0);
  const vy = load<f64>(vPtr + 8);
  const vz = load<f64>(vPtr + 16);

  return ux * vx + uy * vy + uz * vz;
}

export function kin_cross_product(uPtr: usize, vPtr: usize, outPtr: usize): void {
  const ux = load<f64>(uPtr + 0);
  const uy = load<f64>(uPtr + 8);
  const uz = load<f64>(uPtr + 16);

  const vx = load<f64>(vPtr + 0);
  const vy = load<f64>(vPtr + 8);
  const vz = load<f64>(vPtr + 16);

  store<f64>(outPtr + 0, uy * vz - uz * vy);
  store<f64>(outPtr + 8, uz * vx - ux * vz);
  store<f64>(outPtr + 16, ux * vy - uy * vx);
}

export function kin_vector_norm(vPtr: usize): f64 {
  const vx = load<f64>(vPtr + 0);
  const vy = load<f64>(vPtr + 8);
  const vz = load<f64>(vPtr + 16);
  return Math.sqrt(vx * vx + vy * vy + vz * vz);
}

// =============================================================================
// Rotation Matrix Algebra (SO(3))
// =============================================================================

/**
 * Computes direction cosine matrix from Tait-Bryan angles (Z-Y'-X'' sequence: yaw, pitch, roll).
 * alpha: rotation around Z [rad] (yaw)
 * beta:  rotation around Y [rad] (pitch)
 * gamma: rotation around X [rad] (roll)
 */
export function kin_rotation_from_euler(alpha: f64, beta: f64, gamma: f64, outPtr: usize): void {
  const ca = Math.cos(alpha);
  const sa = Math.sin(alpha);
  const cb = Math.cos(beta);
  const sb = Math.sin(beta);
  const cg = Math.cos(gamma);
  const sg = Math.sin(gamma);

  store<f64>(outPtr + 0, ca * cb);
  store<f64>(outPtr + 8, ca * sb * sg - sa * cg);
  store<f64>(outPtr + 16, ca * sb * cg + sa * sg);

  store<f64>(outPtr + 24, sa * cb);
  store<f64>(outPtr + 32, sa * sb * sg + ca * cg);
  store<f64>(outPtr + 40, sa * sb * cg - ca * sg);

  store<f64>(outPtr + 48, -sb);
  store<f64>(outPtr + 56, cb * sg);
  store<f64>(outPtr + 64, cb * cg);
}

export function kin_identity_matrix(outPtr: usize): void {
  store<f64>(outPtr + 0, 1.0);
  store<f64>(outPtr + 8, 0.0);
  store<f64>(outPtr + 16, 0.0);

  store<f64>(outPtr + 24, 0.0);
  store<f64>(outPtr + 32, 1.0);
  store<f64>(outPtr + 40, 0.0);

  store<f64>(outPtr + 48, 0.0);
  store<f64>(outPtr + 56, 0.0);
  store<f64>(outPtr + 64, 1.0);
}

export function kin_multiply_matrices(aPtr: usize, bPtr: usize, outPtr: usize): void {
  const a00 = load<f64>(aPtr + 0);
  const a01 = load<f64>(aPtr + 8);
  const a02 = load<f64>(aPtr + 16);
  const a10 = load<f64>(aPtr + 24);
  const a11 = load<f64>(aPtr + 32);
  const a12 = load<f64>(aPtr + 40);
  const a20 = load<f64>(aPtr + 48);
  const a21 = load<f64>(aPtr + 56);
  const a22 = load<f64>(aPtr + 64);

  const b00 = load<f64>(bPtr + 0);
  const b01 = load<f64>(bPtr + 8);
  const b02 = load<f64>(bPtr + 16);
  const b10 = load<f64>(bPtr + 24);
  const b11 = load<f64>(bPtr + 32);
  const b12 = load<f64>(bPtr + 40);
  const b20 = load<f64>(bPtr + 48);
  const b21 = load<f64>(bPtr + 56);
  const b22 = load<f64>(bPtr + 64);

  store<f64>(outPtr + 0, a00 * b00 + a01 * b10 + a02 * b20);
  store<f64>(outPtr + 8, a00 * b01 + a01 * b11 + a02 * b21);
  store<f64>(outPtr + 16, a00 * b02 + a01 * b12 + a02 * b22);

  store<f64>(outPtr + 24, a10 * b00 + a11 * b10 + a12 * b20);
  store<f64>(outPtr + 32, a10 * b01 + a11 * b11 + a12 * b21);
  store<f64>(outPtr + 40, a10 * b02 + a11 * b12 + a12 * b22);

  store<f64>(outPtr + 48, a20 * b00 + a21 * b10 + a22 * b20);
  store<f64>(outPtr + 56, a20 * b01 + a21 * b11 + a22 * b21);
  store<f64>(outPtr + 64, a20 * b02 + a21 * b12 + a22 * b22);
}

export function kin_transform_vector(rPtr: usize, vPtr: usize, outPtr: usize): void {
  const r00 = load<f64>(rPtr + 0);
  const r01 = load<f64>(rPtr + 8);
  const r02 = load<f64>(rPtr + 16);
  const r10 = load<f64>(rPtr + 24);
  const r11 = load<f64>(rPtr + 32);
  const r12 = load<f64>(rPtr + 40);
  const r20 = load<f64>(rPtr + 48);
  const r21 = load<f64>(rPtr + 56);
  const r22 = load<f64>(rPtr + 64);

  const vx = load<f64>(vPtr + 0);
  const vy = load<f64>(vPtr + 8);
  const vz = load<f64>(vPtr + 16);

  store<f64>(outPtr + 0, r00 * vx + r01 * vy + r02 * vz);
  store<f64>(outPtr + 8, r10 * vx + r11 * vy + r12 * vz);
  store<f64>(outPtr + 16, r20 * vx + r21 * vy + r22 * vz);
}

// =============================================================================
// Marker Spatial Transformations
// =============================================================================

export function kin_marker_spatial_transform(
  bodyPosPtr: usize,
  bodyRotPtr: usize,
  markerLocalPosPtr: usize,
  markerLocalRotPtr: usize,
  outPosPtr: usize,
  outRotPtr: usize,
): void {
  // 1. globalMarkerPosRel = R_body * s_local
  const r00 = load<f64>(bodyRotPtr + 0);
  const r01 = load<f64>(bodyRotPtr + 8);
  const r02 = load<f64>(bodyRotPtr + 16);
  const r10 = load<f64>(bodyRotPtr + 24);
  const r11 = load<f64>(bodyRotPtr + 32);
  const r12 = load<f64>(bodyRotPtr + 40);
  const r20 = load<f64>(bodyRotPtr + 48);
  const r21 = load<f64>(bodyRotPtr + 56);
  const r22 = load<f64>(bodyRotPtr + 64);

  const sx = load<f64>(markerLocalPosPtr + 0);
  const sy = load<f64>(markerLocalPosPtr + 8);
  const sz = load<f64>(markerLocalPosPtr + 16);

  const rx = r00 * sx + r01 * sy + r02 * sz;
  const ry = r10 * sx + r11 * sy + r12 * sz;
  const rz = r20 * sx + r21 * sy + r22 * sz;

  // 2. r_marker = r_body + globalMarkerPosRel
  const bx = load<f64>(bodyPosPtr + 0);
  const by = load<f64>(bodyPosPtr + 8);
  const bz = load<f64>(bodyPosPtr + 16);

  store<f64>(outPosPtr + 0, bx + rx);
  store<f64>(outPosPtr + 8, by + ry);
  store<f64>(outPosPtr + 16, bz + rz);

  // 3. R_marker = R_body * R_local
  kin_multiply_matrices(bodyRotPtr, markerLocalRotPtr, outRotPtr);
}

// =============================================================================
// Joint Constraint Residuals Phi(q) = 0
// =============================================================================

/**
 * Evaluates algebraic kinematic constraint equations Phi(q) = 0 for standard joints:
 * - Spherical (0): 3 translation constraints (r_A = r_B)
 * - Revolute (1): 3 translation constraints + 2 orientation constraints (collinear z-axes)
 * - Prismatic (2): 2 translation constraints (perpendicular to translation axis) + 3 orientation constraints (locked rotation)
 * - Fixed (3): 3 translation + 3 orientation constraints
 * - Cylindrical (4): 2 translation + 2 orientation constraints
 * - Planar (5): 1 translation + 2 orientation constraints
 * - Free (6): 0 constraints
 *
 * Writes [posError(3), orientError(3), norm(1)] (56 bytes) to outResidualPtr.
 * Returns the constraint norm.
 */
export function kin_evaluate_joint_constraint(
  typeId: i32,
  markerAPosPtr: usize,
  markerARotPtr: usize,
  markerBPosPtr: usize,
  markerBRotPtr: usize,
  outResidualPtr: usize,
): f64 {
  // Delta r = r_B - r_A
  const dx = load<f64>(markerBPosPtr + 0) - load<f64>(markerAPosPtr + 0);
  const dy = load<f64>(markerBPosPtr + 8) - load<f64>(markerAPosPtr + 8);
  const dz = load<f64>(markerBPosPtr + 16) - load<f64>(markerAPosPtr + 16);

  // Columns of Marker A rotation:
  // xA = col 0
  const xA_x = load<f64>(markerARotPtr + 0);
  const xA_y = load<f64>(markerARotPtr + 24);
  const xA_z = load<f64>(markerARotPtr + 48);

  // yA = col 1
  const yA_x = load<f64>(markerARotPtr + 8);
  const yA_y = load<f64>(markerARotPtr + 32);
  const yA_z = load<f64>(markerARotPtr + 56);

  // zA = col 2
  const zA_x = load<f64>(markerARotPtr + 16);
  const zA_y = load<f64>(markerARotPtr + 40);
  const zA_z = load<f64>(markerARotPtr + 64);

  // Columns of Marker B rotation:
  // xB = col 0
  const xB_x = load<f64>(markerBRotPtr + 0);
  const xB_y = load<f64>(markerBRotPtr + 24);
  const xB_z = load<f64>(markerBRotPtr + 48);

  // zB = col 2
  const zB_x = load<f64>(markerBRotPtr + 16);
  const zB_y = load<f64>(markerBRotPtr + 40);
  const zB_z = load<f64>(markerBRotPtr + 64);

  // Projections
  const dot_zB_xA = zB_x * xA_x + zB_y * xA_y + zB_z * xA_z;
  const dot_zB_yA = zB_x * yA_x + zB_y * yA_y + zB_z * yA_z;
  const dot_xB_yA = xB_x * yA_x + xB_y * yA_y + xB_z * yA_z;

  const dot_dr_xA = dx * xA_x + dy * xA_y + dz * xA_z;
  const dot_dr_yA = dx * yA_x + dy * yA_y + dz * yA_z;
  const dot_dr_zA = dx * zA_x + dy * zA_y + dz * zA_z;

  let px: f64 = 0.0;
  let py: f64 = 0.0;
  let pz: f64 = 0.0;
  let ox: f64 = 0.0;
  let oy: f64 = 0.0;
  let oz: f64 = 0.0;

  switch (typeId) {
    case 0: // Spherical
      px = dx;
      py = dy;
      pz = dz;
      break;

    case 1: // Revolute
      px = dx;
      py = dy;
      pz = dz;
      ox = dot_zB_xA;
      oy = dot_zB_yA;
      break;

    case 2: // Prismatic
      px = dot_dr_xA;
      py = dot_dr_yA;
      ox = dot_zB_xA;
      oy = dot_zB_yA;
      oz = dot_xB_yA;
      break;

    case 3: // Fixed
      px = dx;
      py = dy;
      pz = dz;
      ox = dot_zB_xA;
      oy = dot_zB_yA;
      oz = dot_xB_yA;
      break;

    case 4: // Cylindrical
      px = dot_dr_xA;
      py = dot_dr_yA;
      ox = dot_zB_xA;
      oy = dot_zB_yA;
      break;

    case 5: // Planar
      pz = dot_dr_zA;
      ox = dot_zB_xA;
      oy = dot_zB_yA;
      break;

    case 7: // Universal
      px = dx;
      py = dy;
      pz = dz;
      ox = dot_zB_xA;
      break;

    case 6: // Free
    default:
      break;
  }

  const pNorm = Math.sqrt(px * px + py * py + pz * pz);
  const oNorm = Math.sqrt(ox * ox + oy * oy + oz * oz);
  const norm = Math.sqrt(pNorm * pNorm + oNorm * oNorm);

  store<f64>(outResidualPtr + 0, px);
  store<f64>(outResidualPtr + 8, py);
  store<f64>(outResidualPtr + 16, pz);
  store<f64>(outResidualPtr + 24, ox);
  store<f64>(outResidualPtr + 32, oy);
  store<f64>(outResidualPtr + 40, oz);
  store<f64>(outResidualPtr + 48, norm);

  return norm;
}

// =============================================================================
// Kinematic Loop Closure Residual
// =============================================================================

export function kin_solve_loop_closure(positionsPtr: usize, chainCount: i32, outResidualPtr: usize): f64 {
  if (chainCount <= 1) {
    store<f64>(outResidualPtr + 0, 0.0);
    store<f64>(outResidualPtr + 8, 0.0);
    store<f64>(outResidualPtr + 16, 0.0);
    store<f64>(outResidualPtr + 24, 0.0);
    return 0.0;
  }

  if (chainCount == 2) {
    const x0: f64 = load<f64>(positionsPtr + 0);
    const y0: f64 = load<f64>(positionsPtr + 8);
    const z0: f64 = load<f64>(positionsPtr + 16);
    const x1: f64 = load<f64>(positionsPtr + 24);
    const y1: f64 = load<f64>(positionsPtr + 32);
    const z1: f64 = load<f64>(positionsPtr + 40);
    const rx2: f64 = x1 - x0;
    const ry2: f64 = y1 - y0;
    const rz2: f64 = z1 - z0;
    const mag2: f64 = Math.sqrt(rx2 * rx2 + ry2 * ry2 + rz2 * rz2);
    store<f64>(outResidualPtr + 0, rx2);
    store<f64>(outResidualPtr + 8, ry2);
    store<f64>(outResidualPtr + 16, rz2);
    store<f64>(outResidualPtr + 24, mag2);
    store<f64>(positionsPtr + 24, x0);
    store<f64>(positionsPtr + 32, y0);
    store<f64>(positionsPtr + 40, z0);
    return mag2;
  }

  // Evaluate open-chain link lengths L_i = ||p_{i+1} - p_i|| for i = 0 .. n-2
  let sumLinkLen: f64 = 0.0;
  let refLen: f64 = 0.0;
  for (let i: i32 = 0; i < chainCount - 1; i++) {
    const off1: usize = <usize>(i * 24);
    const off2: usize = <usize>((i + 1) * 24);
    const dx: f64 = load<f64>(positionsPtr + off2 + 0) - load<f64>(positionsPtr + off1 + 0);
    const dy: f64 = load<f64>(positionsPtr + off2 + 8) - load<f64>(positionsPtr + off1 + 8);
    const dz: f64 = load<f64>(positionsPtr + off2 + 16) - load<f64>(positionsPtr + off1 + 16);
    const len: f64 = Math.sqrt(dx * dx + dy * dy + dz * dz);
    sumLinkLen += len;
    if (i == 0) {
      refLen = len;
    }
  }

  const meanOpenLen: f64 = sumLinkLen / <f64>(chainCount - 1);
  const targetLen: f64 = refLen > 1e-12 ? refLen : meanOpenLen;

  // Evaluate cut-joint closing link vector from last body (n-1) back to first body (0)
  const offLast: usize = <usize>((chainCount - 1) * 24);
  const closeDx: f64 = load<f64>(positionsPtr + 0) - load<f64>(positionsPtr + offLast + 0);
  const closeDy: f64 = load<f64>(positionsPtr + 8) - load<f64>(positionsPtr + offLast + 8);
  const closeDz: f64 = load<f64>(positionsPtr + 16) - load<f64>(positionsPtr + offLast + 16);
  const closeLen: f64 = Math.sqrt(closeDx * closeDx + closeDy * closeDy + closeDz * closeDz);

  let rx: f64 = 0.0;
  let ry: f64 = 0.0;
  let rz: f64 = 0.0;

  if (closeLen > 1e-12) {
    const scale: f64 = (closeLen - targetLen) / closeLen;
    rx = closeDx * scale;
    ry = closeDy * scale;
    rz = closeDz * scale;
  } else {
    rx = targetLen;
  }

  // Accumulate link-length mismatch variance across intermediate links so distorted chains cannot cancel
  let lengthVarSq: f64 = 0.0;
  for (let i: i32 = 1; i < chainCount - 1; i++) {
    const off1: usize = <usize>(i * 24);
    const off2: usize = <usize>((i + 1) * 24);
    const dx: f64 = load<f64>(positionsPtr + off2 + 0) - load<f64>(positionsPtr + off1 + 0);
    const dy: f64 = load<f64>(positionsPtr + off2 + 8) - load<f64>(positionsPtr + off1 + 8);
    const dz: f64 = load<f64>(positionsPtr + off2 + 16) - load<f64>(positionsPtr + off1 + 16);
    const len: f64 = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const diff: f64 = len - targetLen;
    lengthVarSq += diff * diff;
    if (len > 1e-12 && Math.abs(diff) > 1e-9) {
      rx += (dx / len) * diff;
      ry += (dy / len) * diff;
      rz += (dz / len) * diff;
    }
  }

  const errMag: f64 = Math.sqrt(rx * rx + ry * ry + rz * rz + lengthVarSq);
  store<f64>(outResidualPtr + 0, rx);
  store<f64>(outResidualPtr + 8, ry);
  store<f64>(outResidualPtr + 16, rz);
  store<f64>(outResidualPtr + 24, errMag);

  // Iteratively adjust dependent body coordinates (indices 2 .. chainCount-1) to close the loop
  if (errMag >= 1e-8 && targetLen > 1e-12) {
    for (let iter: i32 = 0; iter < 30; iter++) {
      // Forward pass: enforce link lengths L_i = targetLen from i = 1 .. chainCount-2
      for (let i: i32 = 1; i < chainCount - 1; i++) {
        const pOff1: usize = <usize>(i * 24);
        const pOff2: usize = <usize>((i + 1) * 24);
        const x1: f64 = load<f64>(positionsPtr + pOff1 + 0);
        const y1: f64 = load<f64>(positionsPtr + pOff1 + 8);
        const z1: f64 = load<f64>(positionsPtr + pOff1 + 16);
        const dx: f64 = load<f64>(positionsPtr + pOff2 + 0) - x1;
        const dy: f64 = load<f64>(positionsPtr + pOff2 + 8) - y1;
        const dz: f64 = load<f64>(positionsPtr + pOff2 + 16) - z1;
        const dist: f64 = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > 1e-12) {
          const s: f64 = targetLen / dist;
          store<f64>(positionsPtr + pOff2 + 0, x1 + dx * s);
          store<f64>(positionsPtr + pOff2 + 8, y1 + dy * s);
          store<f64>(positionsPtr + pOff2 + 16, z1 + dz * s);
        }
      }
      // Backward pass from anchor body 0 to body chainCount-1 and back down to 2
      const x0: f64 = load<f64>(positionsPtr + 0);
      const y0: f64 = load<f64>(positionsPtr + 8);
      const z0: f64 = load<f64>(positionsPtr + 16);
      const bdx: f64 = load<f64>(positionsPtr + offLast + 0) - x0;
      const bdy: f64 = load<f64>(positionsPtr + offLast + 8) - y0;
      const bdz: f64 = load<f64>(positionsPtr + offLast + 16) - z0;
      const bdist: f64 = Math.sqrt(bdx * bdx + bdy * bdy + bdz * bdz);
      if (bdist > 1e-12) {
        const bs: f64 = targetLen / bdist;
        store<f64>(positionsPtr + offLast + 0, x0 + bdx * bs);
        store<f64>(positionsPtr + offLast + 8, y0 + bdy * bs);
        store<f64>(positionsPtr + offLast + 16, z0 + bdz * bs);
      }
      for (let i: i32 = chainCount - 1; i > 2; i--) {
        const pOffCurr: usize = <usize>(i * 24);
        const pOffPrev: usize = <usize>((i - 1) * 24);
        const xc: f64 = load<f64>(positionsPtr + pOffCurr + 0);
        const yc: f64 = load<f64>(positionsPtr + pOffCurr + 8);
        const zc: f64 = load<f64>(positionsPtr + pOffCurr + 16);
        const dx: f64 = load<f64>(positionsPtr + pOffPrev + 0) - xc;
        const dy: f64 = load<f64>(positionsPtr + pOffPrev + 8) - yc;
        const dz: f64 = load<f64>(positionsPtr + pOffPrev + 16) - zc;
        const dist: f64 = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > 1e-12) {
          const s: f64 = targetLen / dist;
          store<f64>(positionsPtr + pOffPrev + 0, xc + dx * s);
          store<f64>(positionsPtr + pOffPrev + 8, yc + dy * s);
          store<f64>(positionsPtr + pOffPrev + 16, zc + dz * s);
        }
      }
    }
  }

  return errMag;
}

// =============================================================================
// Batched Multibody Kinematics
// =============================================================================

/**
 * Batch evaluates all marker spatial transforms in a single WASM call.
 * bodyIndicesPtr: array of i32 (-1 indicates inertial ground frame)
 * bodyTransformsPtr: array of SpatialTransform (96 bytes each)
 * markerLocalsPtr: array of local SpatialTransform (96 bytes each)
 * outGlobalsPtr: destination buffer for global SpatialTransform (96 bytes each)
 */
export function kin_batch_marker_transforms(
  markerCount: i32,
  bodyIndicesPtr: usize,
  bodyTransformsPtr: usize,
  markerLocalsPtr: usize,
  outGlobalsPtr: usize,
): void {
  for (let i: i32 = 0; i < markerCount; i++) {
    const bodyIdx: i32 = load<i32>(bodyIndicesPtr + <usize>(i * 4));
    let bodyPosPtr: usize;
    let bodyRotPtr: usize;

    if (bodyIdx < 0) {
      bodyPosPtr = INERTIAL_POS_PTR;
      bodyRotPtr = INERTIAL_ROT_PTR;
    } else {
      const bOff: usize = <usize>(bodyIdx * 96);
      bodyPosPtr = bodyTransformsPtr + bOff;
      bodyRotPtr = bodyTransformsPtr + bOff + 24;
    }

    const mOff: usize = <usize>(i * 96);

    kin_marker_spatial_transform(
      bodyPosPtr,
      bodyRotPtr,
      markerLocalsPtr + mOff,
      markerLocalsPtr + mOff + 24,
      outGlobalsPtr + mOff,
      outGlobalsPtr + mOff + 24,
    );
  }
}

/**
 * Batch evaluates all joint constraint residuals in a single WASM call.
 * Returns the maximum residual norm across all joints.
 */
export function kin_batch_evaluate_joints(
  jointCount: i32,
  jointTypesPtr: usize,
  markerAIdxPtr: usize,
  markerBIdxPtr: usize,
  markerGlobalsPtr: usize,
  outResidualsPtr: usize,
): f64 {
  let maxNorm: f64 = 0.0;
  for (let j: i32 = 0; j < jointCount; j++) {
    const jType: i32 = load<i32>(jointTypesPtr + <usize>(j * 4));
    const idxA: i32 = load<i32>(markerAIdxPtr + <usize>(j * 4));
    const idxB: i32 = load<i32>(markerBIdxPtr + <usize>(j * 4));

    const offA: usize = markerGlobalsPtr + <usize>(idxA * 96);
    const offB: usize = markerGlobalsPtr + <usize>(idxB * 96);
    const resOff: usize = outResidualsPtr + <usize>(j * 56);

    const norm: f64 = kin_evaluate_joint_constraint(
      jType,
      offA,
      offA + 24,
      offB,
      offB + 24,
      resOff,
    );
    if (norm > maxNorm) {
      maxNorm = norm;
    }
  }
  return maxNorm;
}
