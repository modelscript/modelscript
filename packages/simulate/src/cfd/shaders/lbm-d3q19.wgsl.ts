// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebGPU WGSL Compute Shader for D3Q19 Lattice Boltzmann Fluid Dynamics.
 * Implements Structure-of-Arrays (SoA) coalesced memory access, pull streaming,
 * BGK / Smagorinsky Sub-Grid Scale (LES) turbulence collision, Bouzidi curved wall
 * boundary conditions, moving wall momentum exchange, and macroscopic field extraction.
 */
export const LBM_D3Q19_WGSL = /* wgsl */ `
struct LbmUniforms {
  nx: u32,
  ny: u32,
  nz: u32,
  totalCells: u32,
  tau: f32,
  omega: f32,       // 1.0 / tau
  dt: f32,
  dx: f32,
  inletVx: f32,
  inletVy: f32,
  inletVz: f32,
  csSq: f32,        // Smagorinsky Cs^2
  useLES: u32,
  useBouzidi: u32,
  density: f32,
  movingWallVx: f32,
  movingWallVy: f32,
  movingWallVz: f32,
  timestepParity: u32,
};

@group(0) @binding(0) var<uniform> u: LbmUniforms;
@group(0) @binding(1) var<storage, read> cellTypes: array<u32>;
@group(0) @binding(2) var<storage, read> f_ping: array<f32>;        // SoA: totalCells * 19
@group(0) @binding(3) var<storage, read_write> f_pong: array<f32>;   // SoA: totalCells * 19
@group(0) @binding(4) var<storage, read_write> macroFields: array<vec4<f32>>; // [vx, vy, vz, rho]
@group(0) @binding(5) var<storage, read_write> dragOutput: array<f32>; // [Fx, Fy, Fz, maxVel, pDrop]
@group(0) @binding(6) var<storage, read> deltaWall: array<f32>;     // Bouzidi delta: totalCells * 19

const CX = array<i32, 19>(0, 1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0);
const CY = array<i32, 19>(0, 0, 0, 1, -1, 0, 0, 1, -1, -1, 1, 0, 0, 0, 0, 1, -1, 1, -1);
const CZ = array<i32, 19>(0, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0, 1, -1, -1, 1, 1, -1, -1, 1);

const OPP = array<u32, 19>(0u, 2u, 1u, 4u, 3u, 6u, 5u, 8u, 7u, 10u, 9u, 12u, 11u, 14u, 13u, 16u, 15u, 18u, 17u);

const W = array<f32, 19>(
  0.333333333,
  0.055555556, 0.055555556, 0.055555556, 0.055555556, 0.055555556, 0.055555556,
  0.027777778, 0.027777778, 0.027777778, 0.027777778, 0.027777778, 0.027777778,
  0.027777778, 0.027777778, 0.027777778, 0.027777778, 0.027777778, 0.027777778
);

fn getCellIndex(x: u32, y: u32, z: u32) -> u32 {
  return x + y * u.nx + z * u.nx * u.ny;
}

fn getSoAIndex(direction: u32, cellIdx: u32) -> u32 {
  return direction * u.totalCells + cellIdx;
}

@compute @workgroup_size(8, 8, 4)
fn cs_lbm_step(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= u.nx || gid.y >= u.ny || gid.z >= u.nz) {
    return;
  }

  let cellIdx = getCellIndex(gid.x, gid.y, gid.z);
  let cType = cellTypes[cellIdx];

  // Solid cells do not stream or collide internally
  if (cType == 1u || cType == 2u) {
    return;
  }

  var fIn: array<f32, 19>;
  let gx = i32(gid.x);
  let gy = i32(gid.y);
  let gz = i32(gid.z);

  // 1. Pull streaming with boundary conditions
  for (var i: u32 = 0u; i < 19u; i = i + 1u) {
    let nxCoord = gx - CX[i];
    let nyCoord = gy - CY[i];
    let nzCoord = gz - CZ[i];

    var pulledF: f32 = 0.0;

    // Check domain boundary
    if (nxCoord < 0 || nxCoord >= i32(u.nx) ||
        nyCoord < 0 || nyCoord >= i32(u.ny) ||
        nzCoord < 0 || nzCoord >= i32(u.nz)) {
      // Bounce back from domain boundary
      let oppI = OPP[i];
      pulledF = f_ping[getSoAIndex(oppI, cellIdx)];
    } else {
      let upIdx = getCellIndex(u32(nxCoord), u32(nyCoord), u32(nzCoord));
      let upType = cellTypes[upIdx];

      if (upType == 1u || upType == 2u) {
        // Obstacle or channel wall bounce back
        let oppI = OPP[i];
        var fRefl = f_ping[getSoAIndex(oppI, cellIdx)];

        // Bouzidi curved boundary interpolation
        if (u.useBouzidi != 0u && upType == 1u) {
          let delta = deltaWall[i * u.totalCells + cellIdx];
          if (delta > 0.0 && delta < 1.0) {
            if (delta < 0.5) {
              let bx = gx + CX[i];
              let by = gy + CY[i];
              let bz = gz + CZ[i];
              if (bx >= 0 && bx < i32(u.nx) && by >= 0 && by < i32(u.ny) && bz >= 0 && bz < i32(u.nz)) {
                let bIdx = getCellIndex(u32(bx), u32(by), u32(bz));
                if (cellTypes[bIdx] != 1u && cellTypes[bIdx] != 2u) {
                  let fB = f_ping[getSoAIndex(i, bIdx)];
                  fRefl = 2.0 * delta * fRefl + (1.0 - 2.0 * delta) * fB;
                }
              }
            } else {
              fRefl = (1.0 / (2.0 * delta)) * fRefl + ((2.0 * delta - 1.0) / (2.0 * delta)) * f_ping[getSoAIndex(i, cellIdx)];
            }
          }
        }

        // Moving wall momentum injection
        if (upType == 1u && (u.movingWallVx != 0.0 || u.movingWallVy != 0.0 || u.movingWallVz != 0.0)) {
          let uwx = u.movingWallVx * (u.dt / u.dx);
          let uwy = u.movingWallVy * (u.dt / u.dx);
          let uwz = u.movingWallVz * (u.dt / u.dx);
          let cuW = f32(CX[i]) * uwx + f32(CY[i]) * uwy + f32(CZ[i]) * uwz;
          let deltaF = 6.0 * W[i] * 1.0 * cuW;
          fRefl -= deltaF;
        }

        pulledF = fRefl;
      } else {
        // Stream from fluid neighbor
        pulledF = f_ping[getSoAIndex(i, upIdx)];
      }
    }

    fIn[i] = pulledF;
  }

  // 2. Macroscopic density and velocity
  var rho: f32 = 0.0;
  var jx: f32 = 0.0;
  var jy: f32 = 0.0;
  var jz: f32 = 0.0;

  for (var i: u32 = 0u; i < 19u; i = i + 1u) {
    let fi = fIn[i];
    rho += fi;
    jx += f32(CX[i]) * fi;
    jy += f32(CY[i]) * fi;
    jz += f32(CZ[i]) * fi;
  }

  // Velocity inlet boundary override
  if (cType == 3u) {
    let uInletX = u.inletVx * (u.dt / u.dx);
    let uInletY = u.inletVy * (u.dt / u.dx);
    let uInletZ = u.inletVz * (u.dt / u.dx);
    jx = rho * uInletX;
    jy = rho * uInletY;
    jz = rho * uInletZ;
  }

  let invRho = 1.0 / max(1e-6, rho);
  let ux = jx * invRho;
  let uy = jy * invRho;
  let uz = jz * invRho;
  let uSq = ux * ux + uy * uy + uz * uz;

  // 3. Equilibrium distribution and non-equilibrium stress tensor for Smagorinsky LES
  var feqs: array<f32, 19>;
  var piXX: f32 = 0.0;
  var piYY: f32 = 0.0;
  var piZZ: f32 = 0.0;
  var piXY: f32 = 0.0;
  var piYZ: f32 = 0.0;
  var piZX: f32 = 0.0;

  for (var i: u32 = 0u; i < 19u; i = i + 1u) {
    let cx = f32(CX[i]);
    let cy = f32(CY[i]);
    let cz = f32(CZ[i]);
    let cu = cx * ux + cy * uy + cz * uz;
    let feq = W[i] * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * uSq);
    feqs[i] = feq;

    if (u.useLES != 0u) {
      let fneq = fIn[i] - feq;
      piXX += cx * cx * fneq;
      piYY += cy * cy * fneq;
      piZZ += cz * cz * fneq;
      piXY += cx * cy * fneq;
      piYZ += cy * cz * fneq;
      piZX += cz * cx * fneq;
    }
  }

  var omegaLoc = u.omega;
  if (u.useLES != 0u) {
    let piMag = sqrt(2.0 * (piXX * piXX + piYY * piYY + piZZ * piZZ + 2.0 * (piXY * piXY + piYZ * piYZ + piZX * piZX)));
    let tau0 = u.tau;
    let deltaTau = 0.5 * (sqrt(tau0 * tau0 + 18.0 * 1.41421356 * u.csSq * (piMag * invRho)) - tau0);
    omegaLoc = 1.0 / (tau0 + deltaTau);
  }

  // 4. Collision and write to f_pong in SoA layout
  for (var i: u32 = 0u; i < 19u; i = i + 1u) {
    let fPost = fIn[i] - omegaLoc * (fIn[i] - feqs[i]);
    f_pong[getSoAIndex(i, cellIdx)] = fPost;
  }

  // 5. Store macroscopic flow field: [vx, vy, vz, rho] in physical units
  let physVx = ux * (u.dx / u.dt);
  let physVy = uy * (u.dx / u.dt);
  let physVz = uz * (u.dx / u.dt);
  macroFields[cellIdx] = vec4<f32>(physVx, physVy, physVz, rho);
}
`;
