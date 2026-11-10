// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebAssembly Lattice Boltzmann Method (LBM D3Q19) Fluid Dynamics Kernel.
 *
 * Implements:
 * - High-speed SoA linear memory streaming & BGK / Smagorinsky LES collision
 * - Bouzidi curved boundary condition interpolation
 * - Accurate obstacle momentum exchange integration
 * - Zero GC allocations during simulation steps
 */

// D3Q19 Lattice constants
// CX, CY, CZ velocity vectors
const CX: StaticArray<i32> = [0, 1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0];
const CY: StaticArray<i32> = [0, 0, 0, 1, -1, 0, 0, 1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1];
const CZ: StaticArray<i32> = [0, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0, 1, 1, -1, -1, 1, 1, -1, -1];

// Opposite direction indices
const OPP: StaticArray<i32> = [0, 2, 1, 4, 3, 6, 5, 10, 9, 8, 7, 14, 13, 12, 11, 18, 17, 16, 15];

// Lattice weights
const W: StaticArray<f64> = [
  1.0 / 3.0,
  1.0 / 18.0, 1.0 / 18.0, 1.0 / 18.0, 1.0 / 18.0, 1.0 / 18.0, 1.0 / 18.0,
  1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0,
  1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0,
  1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0,
];

// Cell type constants matching LbmCellType
export const LBM_CELL_FLUID: u8 = 0;
export const LBM_CELL_OBSTACLE_SOLID: u8 = 1;
export const LBM_CELL_CHANNEL_WALL: u8 = 2;
export const LBM_CELL_VELOCITY_INLET: u8 = 3;
export const LBM_CELL_PRESSURE_OUTLET: u8 = 4;

const FEQS = new StaticArray<f64>(19);
const FPOST = new StaticArray<f64>(19);

/**
 * Performs a single time step of 3D LBM D3Q19 simulation in linear memory.
 */
export function lbm_d3q19_step(
  nx: i32,
  ny: i32,
  nz: i32,
  cellTypesPtr: usize,
  srcPtr: usize,
  dstPtr: usize,
  rhoPtr: usize,
  vxPtr: usize,
  vyPtr: usize,
  vzPtr: usize,
  deltaWallPtr: usize,
  forceOutPtr: usize,
  dt: f64,
  dx: f64,
  omega0: f64,
  tau: f64,
  uInletX: f64,
  uInletY: f64,
  uInletZ: f64,
  useLES: i32,
  CsSq: f64,
  useCurved: i32
): void {
  const totalCells = nx * ny * nz;
  const tcUsize = totalCells as usize;
  const feqs = FEQS;
  const fPost = FPOST;

  let dragLatX: f64 = 0.0;
  let dragLatY: f64 = 0.0;
  let dragLatZ: f64 = 0.0;

  const velScale = dx / dt;
  const invVelScale = dt / dx;
  const sqrt2: f64 = 1.4142135623730951;

  // Pass 1: Local macroscopic moment recovery & BGK / Smagorinsky LES collision
  for (let z: i32 = 0; z < nz; z++) {
    const zBase = z * nx * ny;
    for (let y: i32 = 0; y < ny; y++) {
      const yBase = zBase + y * nx;
      for (let x: i32 = 0; x < nx; x++) {
        const cellIdx = yBase + x;
        const cellUsize = cellIdx as usize;
        const cType = load<u8>(cellTypesPtr + cellUsize);

        if (cType == LBM_CELL_OBSTACLE_SOLID || cType == LBM_CELL_CHANNEL_WALL) {
          continue;
        }

        // 1. Macroscopic variables: rho and u (SoA indexing: i * totalCells + cellIdx)
        const f0  = load<f64>(srcPtr + (((0 * tcUsize + cellUsize) as usize) << 3));
        const f1  = load<f64>(srcPtr + (((1 * tcUsize + cellUsize) as usize) << 3));
        const f2  = load<f64>(srcPtr + (((2 * tcUsize + cellUsize) as usize) << 3));
        const f3  = load<f64>(srcPtr + (((3 * tcUsize + cellUsize) as usize) << 3));
        const f4  = load<f64>(srcPtr + (((4 * tcUsize + cellUsize) as usize) << 3));
        const f5  = load<f64>(srcPtr + (((5 * tcUsize + cellUsize) as usize) << 3));
        const f6  = load<f64>(srcPtr + (((6 * tcUsize + cellUsize) as usize) << 3));
        const f7  = load<f64>(srcPtr + (((7 * tcUsize + cellUsize) as usize) << 3));
        const f8  = load<f64>(srcPtr + (((8 * tcUsize + cellUsize) as usize) << 3));
        const f9  = load<f64>(srcPtr + (((9 * tcUsize + cellUsize) as usize) << 3));
        const f10 = load<f64>(srcPtr + (((10 * tcUsize + cellUsize) as usize) << 3));
        const f11 = load<f64>(srcPtr + (((11 * tcUsize + cellUsize) as usize) << 3));
        const f12 = load<f64>(srcPtr + (((12 * tcUsize + cellUsize) as usize) << 3));
        const f13 = load<f64>(srcPtr + (((13 * tcUsize + cellUsize) as usize) << 3));
        const f14 = load<f64>(srcPtr + (((14 * tcUsize + cellUsize) as usize) << 3));
        const f15 = load<f64>(srcPtr + (((15 * tcUsize + cellUsize) as usize) << 3));
        const f16 = load<f64>(srcPtr + (((16 * tcUsize + cellUsize) as usize) << 3));
        const f17 = load<f64>(srcPtr + (((17 * tcUsize + cellUsize) as usize) << 3));
        const f18 = load<f64>(srcPtr + (((18 * tcUsize + cellUsize) as usize) << 3));

        let rho = f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8 + f9 + f10 + f11 + f12 + f13 + f14 + f15 + f16 + f17 + f18;
        let jx = (f1 - f2) + (f7 - f8 + f9 - f10) + (f11 - f12 + f13 - f14);
        let jy = (f3 - f4) + (f7 + f8 - f9 - f10) + (f15 - f16 + f17 - f18);
        let jz = (f5 - f6) + (f11 + f12 - f13 - f14) + (f15 + f16 - f17 - f18);

        if (cType == LBM_CELL_VELOCITY_INLET) {
          jx = rho * uInletX;
          jy = rho * uInletY;
          jz = rho * uInletZ;
        } else if (cType == LBM_CELL_PRESSURE_OUTLET) {
          rho = 1.0;
        }

        const invRho = 1.0 / Math.max(1e-6, rho);
        const ux = jx * invRho;
        const uy = jy * invRho;
        const uz = jz * invRho;

        store<f64>(rhoPtr + (cellUsize << 3), rho);
        store<f64>(vxPtr + (cellUsize << 3), ux * velScale);
        store<f64>(vyPtr + (cellUsize << 3), uy * velScale);
        store<f64>(vzPtr + (cellUsize << 3), uz * velScale);

        const uSq = ux * ux + uy * uy + uz * uz;
        const oneMinus15uSq = 1.0 - 1.5 * uSq;

        // 2. Vectorized equilibrium calculation
        unchecked((feqs[0] = (1.0 / 3.0) * rho * oneMinus15uSq));

        const rhoOver18 = (1.0 / 18.0) * rho;
        const qx = 4.5 * ux * ux, cx3 = 3.0 * ux;
        const qy = 4.5 * uy * uy, cy3 = 3.0 * uy;
        const qz = 4.5 * uz * uz, cz3 = 3.0 * uz;

        unchecked((feqs[1] = rhoOver18 * (oneMinus15uSq + qx + cx3)));
        unchecked((feqs[2] = rhoOver18 * (oneMinus15uSq + qx - cx3)));
        unchecked((feqs[3] = rhoOver18 * (oneMinus15uSq + qy + cy3)));
        unchecked((feqs[4] = rhoOver18 * (oneMinus15uSq + qy - cy3)));
        unchecked((feqs[5] = rhoOver18 * (oneMinus15uSq + qz + cz3)));
        unchecked((feqs[6] = rhoOver18 * (oneMinus15uSq + qz - cz3)));

        const rhoOver36 = (1.0 / 36.0) * rho;
        const u_xy_p = ux + uy, u_xy_m = ux - uy;
        const u_xz_p = ux + uz, u_xz_m = ux - uz;
        const u_yz_p = uy + uz, u_yz_m = uy - uz;

        unchecked((feqs[7]  = rhoOver36 * (oneMinus15uSq + 4.5 * u_xy_p * u_xy_p + 3.0 * u_xy_p)));
        unchecked((feqs[8]  = rhoOver36 * (oneMinus15uSq + 4.5 * u_xy_m * u_xy_m - 3.0 * u_xy_m)));
        unchecked((feqs[9]  = rhoOver36 * (oneMinus15uSq + 4.5 * u_xy_m * u_xy_m + 3.0 * u_xy_m)));
        unchecked((feqs[10] = rhoOver36 * (oneMinus15uSq + 4.5 * u_xy_p * u_xy_p - 3.0 * u_xy_p)));

        unchecked((feqs[11] = rhoOver36 * (oneMinus15uSq + 4.5 * u_xz_p * u_xz_p + 3.0 * u_xz_p)));
        unchecked((feqs[12] = rhoOver36 * (oneMinus15uSq + 4.5 * u_xz_m * u_xz_m - 3.0 * u_xz_m)));
        unchecked((feqs[13] = rhoOver36 * (oneMinus15uSq + 4.5 * u_xz_m * u_xz_m + 3.0 * u_xz_m)));
        unchecked((feqs[14] = rhoOver36 * (oneMinus15uSq + 4.5 * u_xz_p * u_xz_p - 3.0 * u_xz_p)));

        unchecked((feqs[15] = rhoOver36 * (oneMinus15uSq + 4.5 * u_yz_p * u_yz_p + 3.0 * u_yz_p)));
        unchecked((feqs[16] = rhoOver36 * (oneMinus15uSq + 4.5 * u_yz_m * u_yz_m - 3.0 * u_yz_m)));
        unchecked((feqs[17] = rhoOver36 * (oneMinus15uSq + 4.5 * u_yz_m * u_yz_m + 3.0 * u_yz_m)));
        unchecked((feqs[18] = rhoOver36 * (oneMinus15uSq + 4.5 * u_yz_p * u_yz_p - 3.0 * u_yz_p)));

        let omegaLoc = omega0;
        if (useLES != 0) {
          const fneq1 = f1 - unchecked(feqs[1]);
          const fneq2 = f2 - unchecked(feqs[2]);
          const fneq3 = f3 - unchecked(feqs[3]);
          const fneq4 = f4 - unchecked(feqs[4]);
          const fneq5 = f5 - unchecked(feqs[5]);
          const fneq6 = f6 - unchecked(feqs[6]);
          const fneq7 = f7 - unchecked(feqs[7]);
          const fneq8 = f8 - unchecked(feqs[8]);
          const fneq9 = f9 - unchecked(feqs[9]);
          const fneq10 = f10 - unchecked(feqs[10]);
          const fneq11 = f11 - unchecked(feqs[11]);
          const fneq12 = f12 - unchecked(feqs[12]);
          const fneq13 = f13 - unchecked(feqs[13]);
          const fneq14 = f14 - unchecked(feqs[14]);
          const fneq15 = f15 - unchecked(feqs[15]);
          const fneq16 = f16 - unchecked(feqs[16]);
          const fneq17 = f17 - unchecked(feqs[17]);
          const fneq18 = f18 - unchecked(feqs[18]);

          const piXX = (fneq1 + fneq2) + (fneq7 + fneq8 + fneq9 + fneq10) + (fneq11 + fneq12 + fneq13 + fneq14);
          const piYY = (fneq3 + fneq4) + (fneq7 + fneq8 + fneq9 + fneq10) + (fneq15 + fneq16 + fneq17 + fneq18);
          const piZZ = (fneq5 + fneq6) + (fneq11 + fneq12 + fneq13 + fneq14) + (fneq15 + fneq16 + fneq17 + fneq18);
          const piXY = (fneq7 - fneq8 - fneq9 + fneq10);
          const piZX = (fneq11 - fneq12 - fneq13 + fneq14);
          const piYZ = (fneq15 - fneq16 - fneq17 + fneq18);

          const piMag = Math.sqrt(
            2.0 * (piXX * piXX + piYY * piYY + piZZ * piZZ + 2.0 * (piXY * piXY + piYZ * piYZ + piZX * piZX))
          );
          const tau0 = tau;
          const deltaTau =
            0.5 * (Math.sqrt(tau0 * tau0 + 18.0 * sqrt2 * CsSq * (piMag / Math.max(1e-6, rho))) - tau0);
          omegaLoc = 1.0 / (tau0 + deltaTau);
        }

        // Store post-collision distributions directly back into src
        store<f64>(srcPtr + (((0 * tcUsize + cellUsize) as usize) << 3), f0 - omegaLoc * (f0 - unchecked(feqs[0])));
        store<f64>(srcPtr + (((1 * tcUsize + cellUsize) as usize) << 3), f1 - omegaLoc * (f1 - unchecked(feqs[1])));
        store<f64>(srcPtr + (((2 * tcUsize + cellUsize) as usize) << 3), f2 - omegaLoc * (f2 - unchecked(feqs[2])));
        store<f64>(srcPtr + (((3 * tcUsize + cellUsize) as usize) << 3), f3 - omegaLoc * (f3 - unchecked(feqs[3])));
        store<f64>(srcPtr + (((4 * tcUsize + cellUsize) as usize) << 3), f4 - omegaLoc * (f4 - unchecked(feqs[4])));
        store<f64>(srcPtr + (((5 * tcUsize + cellUsize) as usize) << 3), f5 - omegaLoc * (f5 - unchecked(feqs[5])));
        store<f64>(srcPtr + (((6 * tcUsize + cellUsize) as usize) << 3), f6 - omegaLoc * (f6 - unchecked(feqs[6])));
        store<f64>(srcPtr + (((7 * tcUsize + cellUsize) as usize) << 3), f7 - omegaLoc * (f7 - unchecked(feqs[7])));
        store<f64>(srcPtr + (((8 * tcUsize + cellUsize) as usize) << 3), f8 - omegaLoc * (f8 - unchecked(feqs[8])));
        store<f64>(srcPtr + (((9 * tcUsize + cellUsize) as usize) << 3), f9 - omegaLoc * (f9 - unchecked(feqs[9])));
        store<f64>(srcPtr + (((10 * tcUsize + cellUsize) as usize) << 3), f10 - omegaLoc * (f10 - unchecked(feqs[10])));
        store<f64>(srcPtr + (((11 * tcUsize + cellUsize) as usize) << 3), f11 - omegaLoc * (f11 - unchecked(feqs[11])));
        store<f64>(srcPtr + (((12 * tcUsize + cellUsize) as usize) << 3), f12 - omegaLoc * (f12 - unchecked(feqs[12])));
        store<f64>(srcPtr + (((13 * tcUsize + cellUsize) as usize) << 3), f13 - omegaLoc * (f13 - unchecked(feqs[13])));
        store<f64>(srcPtr + (((14 * tcUsize + cellUsize) as usize) << 3), f14 - omegaLoc * (f14 - unchecked(feqs[14])));
        store<f64>(srcPtr + (((15 * tcUsize + cellUsize) as usize) << 3), f15 - omegaLoc * (f15 - unchecked(feqs[15])));
        store<f64>(srcPtr + (((16 * tcUsize + cellUsize) as usize) << 3), f16 - omegaLoc * (f16 - unchecked(feqs[16])));
        store<f64>(srcPtr + (((17 * tcUsize + cellUsize) as usize) << 3), f17 - omegaLoc * (f17 - unchecked(feqs[17])));
        store<f64>(srcPtr + (((18 * tcUsize + cellUsize) as usize) << 3), f18 - omegaLoc * (f18 - unchecked(feqs[18])));
      }
    }
  }

  // Pass 2: Streaming, Bouzidi curved wall interpolation, and momentum exchange
  for (let z: i32 = 0; z < nz; z++) {
    const zBase = z * nx * ny;
    for (let y: i32 = 0; y < ny; y++) {
      const yBase = zBase + y * nx;
      for (let x: i32 = 0; x < nx; x++) {
        const cellIdx = yBase + x;
        const cellUsize = cellIdx as usize;
        const cType = load<u8>(cellTypesPtr + cellUsize);

        if (cType == LBM_CELL_OBSTACLE_SOLID || cType == LBM_CELL_CHANNEL_WALL) {
          continue;
        }

        const rho = load<f64>(rhoPtr + (cellUsize << 3));
        const ux = load<f64>(vxPtr + (cellUsize << 3)) * invVelScale;
        const uy = load<f64>(vyPtr + (cellUsize << 3)) * invVelScale;
        const uz = load<f64>(vzPtr + (cellUsize << 3)) * invVelScale;
        const uSq = ux * ux + uy * uy + uz * uz;

        for (let i: i32 = 0; i < 19; i++) {
          unchecked((fPost[i] = load<f64>(srcPtr + ((((i as usize) * tcUsize + cellUsize) as usize) << 3))));
        }

        for (let i: i32 = 0; i < 19; i++) {
          const cx = unchecked(CX[i]);
          const cy = unchecked(CY[i]);
          const cz = unchecked(CZ[i]);
          const nxCoord = x + cx;
          const nyCoord = y + cy;
          const nzCoord = z + cz;

          // Handle domain boundary wrap or bounce
          if (nxCoord < 0 || nxCoord >= nx || nyCoord < 0 || nyCoord >= ny || nzCoord < 0 || nzCoord >= nz) {
            const oppI = unchecked(OPP[i]);
            if (nxCoord >= nx && cType == LBM_CELL_PRESSURE_OUTLET) {
              const oppUsize = oppI as usize;
              const cuOpp = unchecked(CX[oppI]) as f64 * ux + unchecked(CY[oppI]) as f64 * uy + unchecked(CZ[oppI]) as f64 * uz;
              store<f64>(
                dstPtr + (((oppUsize * tcUsize + cellUsize) as usize) << 3),
                unchecked(W[oppI]) * rho * (1.0 + 3.0 * cuOpp + 4.5 * cuOpp * cuOpp - 1.5 * uSq)
              );
            } else {
              store<f64>(
                dstPtr + ((((oppI as usize) * tcUsize + cellUsize) as usize) << 3),
                unchecked(fPost[i])
              );
            }
            continue;
          }

          const targetIdx = nxCoord + nyCoord * nx + nzCoord * nx * ny;
          const targetUsize = targetIdx as usize;
          const targetType = load<u8>(cellTypesPtr + targetUsize);

          if (targetType == LBM_CELL_OBSTACLE_SOLID || targetType == LBM_CELL_CHANNEL_WALL) {
            let fRefl = unchecked(fPost[i]);

            // Bouzidi curved boundary interpolation using genuine post-collision distributions
            if (useCurved != 0 && targetType == LBM_CELL_OBSTACLE_SOLID && deltaWallPtr != 0) {
              const delta = load<f64>(deltaWallPtr + ((((i as usize) * tcUsize + cellUsize) as usize) << 3));
              if (delta < 0.5) {
                const bx = x - cx;
                const by = y - cy;
                const bz = z - cz;
                if (bx >= 0 && bx < nx && by >= 0 && by < ny && bz >= 0 && bz < nz) {
                  const bIdx = bx + by * nx + bz * nx * ny;
                  const bType = load<u8>(cellTypesPtr + (bIdx as usize));
                  if (bType != LBM_CELL_OBSTACLE_SOLID && bType != LBM_CELL_CHANNEL_WALL) {
                    const fBPost = load<f64>(srcPtr + ((((i as usize) * tcUsize + (bIdx as usize)) as usize) << 3));
                    fRefl = 2.0 * delta * unchecked(fPost[i]) + (1.0 - 2.0 * delta) * fBPost;
                  }
                }
              } else {
                const oppI = unchecked(OPP[i]);
                fRefl = (1.0 / (2.0 * delta)) * unchecked(fPost[i]) + ((2.0 * delta - 1.0) / (2.0 * delta)) * unchecked(fPost[oppI]);
              }
            }

            const oppI = unchecked(OPP[i]);
            store<f64>(dstPtr + ((((oppI as usize) * tcUsize + cellUsize) as usize) << 3), fRefl);

            // Momentum exchange on obstacle walls
            if (targetType == LBM_CELL_OBSTACLE_SOLID) {
              const fNet = unchecked(fPost[i]) + fRefl;
              dragLatX += (cx as f64) * fNet;
              dragLatY += (cy as f64) * fNet;
              dragLatZ += (cz as f64) * fNet;
            }
          } else {
            // Normal streaming to neighbor
            store<f64>(dstPtr + ((((i as usize) * tcUsize + targetUsize) as usize) << 3), unchecked(fPost[i]));
          }
        }
      }
    }
  }

  // Store integrated lattice momentum exchange
  store<f64>(forceOutPtr + 0, dragLatX);
  store<f64>(forceOutPtr + 8, dragLatY);
  store<f64>(forceOutPtr + 16, dragLatZ);
}

/**
 * High-speed LBM D3Q19 time step for 32-bit float SoA arenas (matching CfdFieldArena and WebGPU buffers).
 */
export function lbm_d3q19_step_f32(
  nx: i32,
  ny: i32,
  nz: i32,
  cellTypesPtr: usize,
  isCellTypesU32: i32,
  srcPtr: usize,
  dstPtr: usize,
  rhoPtr: usize,
  vxPtr: usize,
  vyPtr: usize,
  vzPtr: usize,
  deltaWallPtr: usize,
  forceOutPtr: usize,
  dt: f64,
  dx: f64,
  omega0: f64,
  tau: f64,
  uInletX: f64,
  uInletY: f64,
  uInletZ: f64,
  useLES: i32,
  CsSq: f64,
  useCurved: i32
): void {
  const totalCells = nx * ny * nz;
  const tcUsize = totalCells as usize;
  const feqs = FEQS;
  const fPost = FPOST;

  let dragLatX: f64 = 0.0;
  let dragLatY: f64 = 0.0;
  let dragLatZ: f64 = 0.0;

  const velScale = dx / dt;
  const invVelScale = dt / dx;
  const sqrt2: f64 = 1.4142135623730951;

  // Pass 1: Local macroscopic moment recovery & BGK / Smagorinsky LES collision
  for (let z: i32 = 0; z < nz; z++) {
    const zBase = z * nx * ny;
    for (let y: i32 = 0; y < ny; y++) {
      const yBase = zBase + y * nx;
      for (let x: i32 = 0; x < nx; x++) {
        const cellIdx = yBase + x;
        const cellUsize = cellIdx as usize;
        const cType: u8 = isCellTypesU32 != 0
          ? (load<u32>(cellTypesPtr + (cellUsize << 2)) as u8)
          : load<u8>(cellTypesPtr + cellUsize);

        if (cType == LBM_CELL_OBSTACLE_SOLID || cType == LBM_CELL_CHANNEL_WALL) {
          continue;
        }

        const f0  = load<f32>(srcPtr + (((0 * tcUsize + cellUsize) as usize) << 2)) as f64;
        const f1  = load<f32>(srcPtr + (((1 * tcUsize + cellUsize) as usize) << 2)) as f64;
        const f2  = load<f32>(srcPtr + (((2 * tcUsize + cellUsize) as usize) << 2)) as f64;
        const f3  = load<f32>(srcPtr + (((3 * tcUsize + cellUsize) as usize) << 2)) as f64;
        const f4  = load<f32>(srcPtr + (((4 * tcUsize + cellUsize) as usize) << 2)) as f64;
        const f5  = load<f32>(srcPtr + (((5 * tcUsize + cellUsize) as usize) << 2)) as f64;
        const f6  = load<f32>(srcPtr + (((6 * tcUsize + cellUsize) as usize) << 2)) as f64;
        const f7  = load<f32>(srcPtr + (((7 * tcUsize + cellUsize) as usize) << 2)) as f64;
        const f8  = load<f32>(srcPtr + (((8 * tcUsize + cellUsize) as usize) << 2)) as f64;
        const f9  = load<f32>(srcPtr + (((9 * tcUsize + cellUsize) as usize) << 2)) as f64;
        const f10 = load<f32>(srcPtr + (((10 * tcUsize + cellUsize) as usize) << 2)) as f64;
        const f11 = load<f32>(srcPtr + (((11 * tcUsize + cellUsize) as usize) << 2)) as f64;
        const f12 = load<f32>(srcPtr + (((12 * tcUsize + cellUsize) as usize) << 2)) as f64;
        const f13 = load<f32>(srcPtr + (((13 * tcUsize + cellUsize) as usize) << 2)) as f64;
        const f14 = load<f32>(srcPtr + (((14 * tcUsize + cellUsize) as usize) << 2)) as f64;
        const f15 = load<f32>(srcPtr + (((15 * tcUsize + cellUsize) as usize) << 2)) as f64;
        const f16 = load<f32>(srcPtr + (((16 * tcUsize + cellUsize) as usize) << 2)) as f64;
        const f17 = load<f32>(srcPtr + (((17 * tcUsize + cellUsize) as usize) << 2)) as f64;
        const f18 = load<f32>(srcPtr + (((18 * tcUsize + cellUsize) as usize) << 2)) as f64;

        let rho = f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8 + f9 + f10 + f11 + f12 + f13 + f14 + f15 + f16 + f17 + f18;
        let jx = (f1 - f2) + (f7 - f8 + f9 - f10) + (f11 - f12 + f13 - f14);
        let jy = (f3 - f4) + (f7 + f8 - f9 - f10) + (f15 - f16 + f17 - f18);
        let jz = (f5 - f6) + (f11 + f12 - f13 - f14) + (f15 + f16 - f17 - f18);

        if (cType == LBM_CELL_VELOCITY_INLET) {
          jx = rho * uInletX;
          jy = rho * uInletY;
          jz = rho * uInletZ;
        } else if (cType == LBM_CELL_PRESSURE_OUTLET) {
          rho = 1.0;
        }

        const invRho = 1.0 / Math.max(1e-6, rho);
        const ux = jx * invRho;
        const uy = jy * invRho;
        const uz = jz * invRho;

        store<f32>(rhoPtr + (cellUsize << 2), <f32>rho);
        store<f32>(vxPtr + (cellUsize << 2), <f32>(ux * velScale));
        store<f32>(vyPtr + (cellUsize << 2), <f32>(uy * velScale));
        store<f32>(vzPtr + (cellUsize << 2), <f32>(uz * velScale));

        const uSq = ux * ux + uy * uy + uz * uz;
        const oneMinus15uSq = 1.0 - 1.5 * uSq;

        unchecked((feqs[0] = (1.0 / 3.0) * rho * oneMinus15uSq));

        const rhoOver18 = (1.0 / 18.0) * rho;
        const qx = 4.5 * ux * ux, cx3 = 3.0 * ux;
        const qy = 4.5 * uy * uy, cy3 = 3.0 * uy;
        const qz = 4.5 * uz * uz, cz3 = 3.0 * uz;

        unchecked((feqs[1] = rhoOver18 * (oneMinus15uSq + qx + cx3)));
        unchecked((feqs[2] = rhoOver18 * (oneMinus15uSq + qx - cx3)));
        unchecked((feqs[3] = rhoOver18 * (oneMinus15uSq + qy + cy3)));
        unchecked((feqs[4] = rhoOver18 * (oneMinus15uSq + qy - cy3)));
        unchecked((feqs[5] = rhoOver18 * (oneMinus15uSq + qz + cz3)));
        unchecked((feqs[6] = rhoOver18 * (oneMinus15uSq + qz - cz3)));

        const rhoOver36 = (1.0 / 36.0) * rho;
        const u_xy_p = ux + uy, u_xy_m = ux - uy;
        const u_xz_p = ux + uz, u_xz_m = ux - uz;
        const u_yz_p = uy + uz, u_yz_m = uy - uz;

        unchecked((feqs[7]  = rhoOver36 * (oneMinus15uSq + 4.5 * u_xy_p * u_xy_p + 3.0 * u_xy_p)));
        unchecked((feqs[8]  = rhoOver36 * (oneMinus15uSq + 4.5 * u_xy_m * u_xy_m - 3.0 * u_xy_m)));
        unchecked((feqs[9]  = rhoOver36 * (oneMinus15uSq + 4.5 * u_xy_m * u_xy_m + 3.0 * u_xy_m)));
        unchecked((feqs[10] = rhoOver36 * (oneMinus15uSq + 4.5 * u_xy_p * u_xy_p - 3.0 * u_xy_p)));

        unchecked((feqs[11] = rhoOver36 * (oneMinus15uSq + 4.5 * u_xz_p * u_xz_p + 3.0 * u_xz_p)));
        unchecked((feqs[12] = rhoOver36 * (oneMinus15uSq + 4.5 * u_xz_m * u_xz_m - 3.0 * u_xz_m)));
        unchecked((feqs[13] = rhoOver36 * (oneMinus15uSq + 4.5 * u_xz_m * u_xz_m + 3.0 * u_xz_m)));
        unchecked((feqs[14] = rhoOver36 * (oneMinus15uSq + 4.5 * u_xz_p * u_xz_p - 3.0 * u_xz_p)));

        unchecked((feqs[15] = rhoOver36 * (oneMinus15uSq + 4.5 * u_yz_p * u_yz_p + 3.0 * u_yz_p)));
        unchecked((feqs[16] = rhoOver36 * (oneMinus15uSq + 4.5 * u_yz_m * u_yz_m - 3.0 * u_yz_m)));
        unchecked((feqs[17] = rhoOver36 * (oneMinus15uSq + 4.5 * u_yz_m * u_yz_m + 3.0 * u_yz_m)));
        unchecked((feqs[18] = rhoOver36 * (oneMinus15uSq + 4.5 * u_yz_p * u_yz_p - 3.0 * u_yz_p)));

        let omegaLoc = omega0;
        if (useLES != 0) {
          const fneq1 = f1 - unchecked(feqs[1]);
          const fneq2 = f2 - unchecked(feqs[2]);
          const fneq3 = f3 - unchecked(feqs[3]);
          const fneq4 = f4 - unchecked(feqs[4]);
          const fneq5 = f5 - unchecked(feqs[5]);
          const fneq6 = f6 - unchecked(feqs[6]);
          const fneq7 = f7 - unchecked(feqs[7]);
          const fneq8 = f8 - unchecked(feqs[8]);
          const fneq9 = f9 - unchecked(feqs[9]);
          const fneq10 = f10 - unchecked(feqs[10]);
          const fneq11 = f11 - unchecked(feqs[11]);
          const fneq12 = f12 - unchecked(feqs[12]);
          const fneq13 = f13 - unchecked(feqs[13]);
          const fneq14 = f14 - unchecked(feqs[14]);
          const fneq15 = f15 - unchecked(feqs[15]);
          const fneq16 = f16 - unchecked(feqs[16]);
          const fneq17 = f17 - unchecked(feqs[17]);
          const fneq18 = f18 - unchecked(feqs[18]);

          const piXX = (fneq1 + fneq2) + (fneq7 + fneq8 + fneq9 + fneq10) + (fneq11 + fneq12 + fneq13 + fneq14);
          const piYY = (fneq3 + fneq4) + (fneq7 + fneq8 + fneq9 + fneq10) + (fneq15 + fneq16 + fneq17 + fneq18);
          const piZZ = (fneq5 + fneq6) + (fneq11 + fneq12 + fneq13 + fneq14) + (fneq15 + fneq16 + fneq17 + fneq18);
          const piXY = (fneq7 - fneq8 - fneq9 + fneq10);
          const piZX = (fneq11 - fneq12 - fneq13 + fneq14);
          const piYZ = (fneq15 - fneq16 - fneq17 + fneq18);

          const piMag = Math.sqrt(
            2.0 * (piXX * piXX + piYY * piYY + piZZ * piZZ + 2.0 * (piXY * piXY + piYZ * piYZ + piZX * piZX))
          );
          const tau0 = tau;
          const deltaTau =
            0.5 * (Math.sqrt(tau0 * tau0 + 18.0 * sqrt2 * CsSq * (piMag / Math.max(1e-6, rho))) - tau0);
          omegaLoc = 1.0 / (tau0 + deltaTau);
        }

        store<f32>(srcPtr + (((0 * tcUsize + cellUsize) as usize) << 2), <f32>(f0 - omegaLoc * (f0 - unchecked(feqs[0]))));
        store<f32>(srcPtr + (((1 * tcUsize + cellUsize) as usize) << 2), <f32>(f1 - omegaLoc * (f1 - unchecked(feqs[1]))));
        store<f32>(srcPtr + (((2 * tcUsize + cellUsize) as usize) << 2), <f32>(f2 - omegaLoc * (f2 - unchecked(feqs[2]))));
        store<f32>(srcPtr + (((3 * tcUsize + cellUsize) as usize) << 2), <f32>(f3 - omegaLoc * (f3 - unchecked(feqs[3]))));
        store<f32>(srcPtr + (((4 * tcUsize + cellUsize) as usize) << 2), <f32>(f4 - omegaLoc * (f4 - unchecked(feqs[4]))));
        store<f32>(srcPtr + (((5 * tcUsize + cellUsize) as usize) << 2), <f32>(f5 - omegaLoc * (f5 - unchecked(feqs[5]))));
        store<f32>(srcPtr + (((6 * tcUsize + cellUsize) as usize) << 2), <f32>(f6 - omegaLoc * (f6 - unchecked(feqs[6]))));
        store<f32>(srcPtr + (((7 * tcUsize + cellUsize) as usize) << 2), <f32>(f7 - omegaLoc * (f7 - unchecked(feqs[7]))));
        store<f32>(srcPtr + (((8 * tcUsize + cellUsize) as usize) << 2), <f32>(f8 - omegaLoc * (f8 - unchecked(feqs[8]))));
        store<f32>(srcPtr + (((9 * tcUsize + cellUsize) as usize) << 2), <f32>(f9 - omegaLoc * (f9 - unchecked(feqs[9]))));
        store<f32>(srcPtr + (((10 * tcUsize + cellUsize) as usize) << 2), <f32>(f10 - omegaLoc * (f10 - unchecked(feqs[10]))));
        store<f32>(srcPtr + (((11 * tcUsize + cellUsize) as usize) << 2), <f32>(f11 - omegaLoc * (f11 - unchecked(feqs[11]))));
        store<f32>(srcPtr + (((12 * tcUsize + cellUsize) as usize) << 2), <f32>(f12 - omegaLoc * (f12 - unchecked(feqs[12]))));
        store<f32>(srcPtr + (((13 * tcUsize + cellUsize) as usize) << 2), <f32>(f13 - omegaLoc * (f13 - unchecked(feqs[13]))));
        store<f32>(srcPtr + (((14 * tcUsize + cellUsize) as usize) << 2), <f32>(f14 - omegaLoc * (f14 - unchecked(feqs[14]))));
        store<f32>(srcPtr + (((15 * tcUsize + cellUsize) as usize) << 2), <f32>(f15 - omegaLoc * (f15 - unchecked(feqs[15]))));
        store<f32>(srcPtr + (((16 * tcUsize + cellUsize) as usize) << 2), <f32>(f16 - omegaLoc * (f16 - unchecked(feqs[16]))));
        store<f32>(srcPtr + (((17 * tcUsize + cellUsize) as usize) << 2), <f32>(f17 - omegaLoc * (f17 - unchecked(feqs[17]))));
        store<f32>(srcPtr + (((18 * tcUsize + cellUsize) as usize) << 2), <f32>(f18 - omegaLoc * (f18 - unchecked(feqs[18]))));
      }
    }
  }

  // Pass 2: Streaming, Bouzidi curved wall interpolation, and momentum exchange
  for (let z: i32 = 0; z < nz; z++) {
    const zBase = z * nx * ny;
    for (let y: i32 = 0; y < ny; y++) {
      const yBase = zBase + y * nx;
      for (let x: i32 = 0; x < nx; x++) {
        const cellIdx = yBase + x;
        const cellUsize = cellIdx as usize;
        const cType: u8 = isCellTypesU32 != 0
          ? (load<u32>(cellTypesPtr + (cellUsize << 2)) as u8)
          : load<u8>(cellTypesPtr + cellUsize);

        if (cType == LBM_CELL_OBSTACLE_SOLID || cType == LBM_CELL_CHANNEL_WALL) {
          continue;
        }

        const rho = load<f32>(rhoPtr + (cellUsize << 2)) as f64;
        const ux = load<f32>(vxPtr + (cellUsize << 2)) as f64 * invVelScale;
        const uy = load<f32>(vyPtr + (cellUsize << 2)) as f64 * invVelScale;
        const uz = load<f32>(vzPtr + (cellUsize << 2)) as f64 * invVelScale;
        const uSq = ux * ux + uy * uy + uz * uz;

        for (let i: i32 = 0; i < 19; i++) {
          unchecked((fPost[i] = load<f32>(srcPtr + ((((i as usize) * tcUsize + cellUsize) as usize) << 2)) as f64));
        }

        for (let i: i32 = 0; i < 19; i++) {
          const cx = unchecked(CX[i]);
          const cy = unchecked(CY[i]);
          const cz = unchecked(CZ[i]);
          const nxCoord = x + cx;
          const nyCoord = y + cy;
          const nzCoord = z + cz;

          // Handle domain boundary wrap or bounce
          if (nxCoord < 0 || nxCoord >= nx || nyCoord < 0 || nyCoord >= ny || nzCoord < 0 || nzCoord >= nz) {
            const oppI = unchecked(OPP[i]);
            if (nxCoord >= nx && cType == LBM_CELL_PRESSURE_OUTLET) {
              const oppUsize = oppI as usize;
              const cuOpp = unchecked(CX[oppI]) as f64 * ux + unchecked(CY[oppI]) as f64 * uy + unchecked(CZ[oppI]) as f64 * uz;
              store<f32>(
                dstPtr + (((oppUsize * tcUsize + cellUsize) as usize) << 2),
                <f32>(unchecked(W[oppI]) * rho * (1.0 + 3.0 * cuOpp + 4.5 * cuOpp * cuOpp - 1.5 * uSq))
              );
            } else {
              store<f32>(
                dstPtr + ((((oppI as usize) * tcUsize + cellUsize) as usize) << 2),
                <f32>unchecked(fPost[i])
              );
            }
            continue;
          }

          const targetIdx = nxCoord + nyCoord * nx + nzCoord * nx * ny;
          const targetUsize = targetIdx as usize;
          const targetType: u8 = isCellTypesU32 != 0
            ? (load<u32>(cellTypesPtr + (targetUsize << 2)) as u8)
            : load<u8>(cellTypesPtr + targetUsize);

          if (targetType == LBM_CELL_OBSTACLE_SOLID || targetType == LBM_CELL_CHANNEL_WALL) {
            let fRefl = unchecked(fPost[i]);

            // Bouzidi curved boundary interpolation using genuine post-collision distributions
            if (useCurved != 0 && targetType == LBM_CELL_OBSTACLE_SOLID && deltaWallPtr != 0) {
              const delta = load<f32>(deltaWallPtr + ((((i as usize) * tcUsize + cellUsize) as usize) << 2)) as f64;
              if (delta < 0.5) {
                const bx = x - cx;
                const by = y - cy;
                const bz = z - cz;
                if (bx >= 0 && bx < nx && by >= 0 && by < ny && bz >= 0 && bz < nz) {
                  const bIdx = bx + by * nx + bz * nx * ny;
                  const bType: u8 = isCellTypesU32 != 0
                    ? (load<u32>(cellTypesPtr + ((bIdx as usize) << 2)) as u8)
                    : load<u8>(cellTypesPtr + (bIdx as usize));
                  if (bType != LBM_CELL_OBSTACLE_SOLID && bType != LBM_CELL_CHANNEL_WALL) {
                    const fBPost = load<f32>(srcPtr + ((((i as usize) * tcUsize + (bIdx as usize)) as usize) << 2)) as f64;
                    fRefl = 2.0 * delta * unchecked(fPost[i]) + (1.0 - 2.0 * delta) * fBPost;
                  }
                }
              } else {
                const oppI = unchecked(OPP[i]);
                fRefl = (1.0 / (2.0 * delta)) * unchecked(fPost[i]) + ((2.0 * delta - 1.0) / (2.0 * delta)) * unchecked(fPost[oppI]);
              }
            }

            const oppI = unchecked(OPP[i]);
            store<f32>(dstPtr + ((((oppI as usize) * tcUsize + cellUsize) as usize) << 2), <f32>fRefl);

            // Momentum exchange on obstacle walls
            if (targetType == LBM_CELL_OBSTACLE_SOLID) {
              const fNet = unchecked(fPost[i]) + fRefl;
              dragLatX += (cx as f64) * fNet;
              dragLatY += (cy as f64) * fNet;
              dragLatZ += (cz as f64) * fNet;
            }
          } else {
            // Normal streaming to neighbor
            store<f32>(dstPtr + ((((i as usize) * tcUsize + targetUsize) as usize) << 2), <f32>unchecked(fPost[i]));
          }
        }
      }
    }
  }

  // Store integrated lattice momentum exchange
  store<f64>(forceOutPtr + 0, dragLatX);
  store<f64>(forceOutPtr + 8, dragLatY);
  store<f64>(forceOutPtr + 16, dragLatZ);
}
