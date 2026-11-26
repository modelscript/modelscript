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
  useRegularized: u32,
  useWMLES: u32,
  kappa: f32,
  lawOfWallB: f32,
  _pad: u32,
};

@group(0) @binding(0) var<uniform> u: LbmUniforms;
@group(0) @binding(1) var<storage, read> cellTypes: array<u32>;
@group(0) @binding(2) var<storage, read> f_ping: array<f32>;        // SoA: totalCells * 19
@group(0) @binding(3) var<storage, read_write> f_pong: array<f32>;   // SoA: totalCells * 19
@group(0) @binding(4) var<storage, read_write> macroFields: array<vec4<f32>>; // [vx, vy, vz, rho]
@group(0) @binding(5) var<storage, read_write> dragOutput: array<atomic<i32>>; // fixed-point [Fx, Fy, Fz] * 1e6
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

fn solve_spalding_utau(uTan: f32, yWall: f32, nuPhys: f32, kappa: f32, lawOfWallB: f32) -> f32 {
  let uMag = abs(uTan);
  if (uMag < 1e-6 || yWall <= 0.0 || nuPhys <= 0.0) {
    return 0.0;
  }
  var uTau = max(sqrt((nuPhys * uMag) / yWall), uMag * 0.04);
  let expNegKB = exp(-kappa * lawOfWallB);

  for (var iter: u32 = 0u; iter < 5u; iter = iter + 1u) {
    let uPlus = uMag / max(1e-6, uTau);
    let yPlus = (uTau * yWall) / nuPhys;
    let ku = min(25.0, kappa * uPlus);
    let expKu = exp(ku);
    let poly = 1.0 + ku + 0.5 * ku * ku + (ku * ku * ku) / 6.0;
    let fVal = uPlus + expNegKB * (expKu - poly) - yPlus;

    let dfDuPlus = 1.0 + kappa * expNegKB * (expKu - (1.0 + ku + 0.5 * ku * ku));
    let dfDuTau = dfDuPlus * (-uPlus / max(1e-6, uTau)) - yWall / nuPhys;
    if (abs(dfDuTau) < 1e-12) {
      break;
    }
    let next = uTau - fVal / dfDuTau;
    if (next > 1e-6 && next < 1e12) {
      uTau = next;
    } else {
      uTau = uTau * 0.5;
    }
  }
  return uTau;
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
  var cellFx: f32 = 0.0;
  var cellFy: f32 = 0.0;
  var cellFz: f32 = 0.0;

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
      if (nxCoord >= i32(u.nx) && cType == 4u) {
        // Open pressure outlet: zero-gradient extrapolation from outlet cell
        pulledF = f_ping[getSoAIndex(i, cellIdx)];
      } else {
        // Bounce back from domain boundary
        let oppI = OPP[i];
        pulledF = f_ping[getSoAIndex(oppI, cellIdx)];
      }
    } else {
      let upIdx = getCellIndex(u32(nxCoord), u32(nyCoord), u32(nzCoord));
      let upType = cellTypes[upIdx];

      if (upType == 1u || upType == 2u) {
        // Obstacle or channel wall bounce back
        let oppI = OPP[i];
        let fOut = f_ping[getSoAIndex(oppI, cellIdx)];
        var fRefl = fOut;

        // Bouzidi curved boundary interpolation (ray from cellIdx to solid upIdx is along oppI)
        if (u.useBouzidi != 0u && upType == 1u) {
          let delta = deltaWall[oppI * u.totalCells + cellIdx];
          if (delta > 0.0 && delta < 1.0) {
            if (delta < 0.5) {
              let bx = gx + CX[i];
              let by = gy + CY[i];
              let bz = gz + CZ[i];
              if (bx >= 0 && bx < i32(u.nx) && by >= 0 && by < i32(u.ny) && bz >= 0 && bz < i32(u.nz)) {
                let bIdx = getCellIndex(u32(bx), u32(by), u32(bz));
                if (cellTypes[bIdx] != 1u && cellTypes[bIdx] != 2u) {
                  let fB = f_ping[getSoAIndex(oppI, bIdx)];
                  fRefl = 2.0 * delta * fRefl + (1.0 - 2.0 * delta) * fB;
                }
              }
            } else {
              fRefl = (1.0 / (2.0 * delta)) * fRefl + ((2.0 * delta - 1.0) / (2.0 * delta)) * f_ping[getSoAIndex(i, cellIdx)];
            }
          }
        }

        // Moving wall momentum injection: incoming direction i has c_i = -c_{oppI}, so +6 * W[i] * rho_w * (c_i . u_w)
        if (upType == 1u && (u.movingWallVx != 0.0 || u.movingWallVy != 0.0 || u.movingWallVz != 0.0)) {
          let uwx = u.movingWallVx * (u.dt / u.dx);
          let uwy = u.movingWallVy * (u.dt / u.dx);
          let uwz = u.movingWallVz * (u.dt / u.dx);
          let cuW = f32(CX[i]) * uwx + f32(CY[i]) * uwy + f32(CZ[i]) * uwz;
          let deltaF = 6.0 * W[i] * 1.0 * cuW;
          fRefl += deltaF;
        }

        if (upType == 1u) {
          let mom = fOut + fRefl;
          cellFx += f32(CX[oppI]) * mom;
          cellFy += f32(CY[oppI]) * mom;
          cellFz += f32(CZ[oppI]) * mom;
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

  // Velocity inlet / pressure outlet boundary override
  if (cType == 3u) {
    let uInletX = u.inletVx * (u.dt / u.dx);
    let uInletY = u.inletVy * (u.dt / u.dx);
    let uInletZ = u.inletVz * (u.dt / u.dx);
    jx = rho * uInletX;
    jy = rho * uInletY;
    jz = rho * uInletZ;
  } else if (cType == 4u) {
    rho = 1.0;
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
    if (cType == 4u && gx - CX[i] >= i32(u.nx)) {
      fIn[i] = feq;
    }

    if (u.useLES != 0u || u.useWMLES != 0u || u.useRegularized != 0u) {
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
  if (u.useLES != 0u || u.useWMLES != 0u) {
    let piMag = sqrt(2.0 * (piXX * piXX + piYY * piYY + piZZ * piZZ + 2.0 * (piXY * piXY + piYZ * piYZ + piZX * piZX)));
    let tau0 = u.tau;
    var deltaTauSgs: f32 = 0.0;
    if (u.useLES != 0u) {
      deltaTauSgs = 0.5 * (sqrt(tau0 * tau0 + 18.0 * 1.41421356 * u.csSq * (piMag * invRho)) - tau0);
    }

    var deltaTauWall: f32 = 0.0;
    if (u.useWMLES != 0u) {
      var isWallAdjacent: bool = false;
      var minWallDelta: f32 = 0.5;
      for (var d: u32 = 1u; d <= 6u; d = d + 1u) {
        let wx = gx + CX[d];
        let wy = gy + CY[d];
        let wz = gz + CZ[d];
        if (wx >= 0 && wx < i32(u.nx) && wy >= 0 && wy < i32(u.ny) && wz >= 0 && wz < i32(u.nz)) {
          let wt = cellTypes[getCellIndex(u32(wx), u32(wy), u32(wz))];
          if (wt == 1u || wt == 2u) {
            isWallAdjacent = true;
            if (u.useBouzidi != 0u) {
              let dw = deltaWall[d * u.totalCells + cellIdx];
              if (dw > 0.0 && dw < minWallDelta) {
                minWallDelta = dw;
              }
            }
          }
        }
      }
      if (isWallAdjacent) {
        let physSpeed = sqrt(uSq) * (u.dx / u.dt);
        let yWallPhys = max(0.1, minWallDelta) * u.dx;
        let nuPhys = (1.0 / 3.0) * max(1e-4, tau0 - 0.5) * ((u.dx * u.dx) / u.dt);
        let uTau = solve_spalding_utau(physSpeed, yWallPhys, nuPhys, u.kappa, u.lawOfWallB);
        var nuWallEff: f32 = nuPhys;
        if (physSpeed > 1e-6) {
          nuWallEff = (uTau * uTau * yWallPhys) / physSpeed;
        }
        let nuTurbWall = max(0.0, nuWallEff - nuPhys);
        deltaTauWall = 3.0 * nuTurbWall * (u.dt / (u.dx * u.dx));
      }
    }

    omegaLoc = 1.0 / (tau0 + max(deltaTauSgs, deltaTauWall));
  }

  // 4. Collision and write to f_pong in SoA layout
  if (u.useRegularized != 0u) {
    let oneMinusOmega = 1.0 - omegaLoc;
    for (var i: u32 = 0u; i < 19u; i = i + 1u) {
      let cxi = f32(CX[i]);
      let cyi = f32(CY[i]);
      let czi = f32(CZ[i]);
      let qPi =
        (cxi * cxi - 1.0 / 3.0) * piXX +
        (cyi * cyi - 1.0 / 3.0) * piYY +
        (czi * czi - 1.0 / 3.0) * piZZ +
        2.0 * (cxi * cyi * piXY + cyi * czi * piYZ + czi * cxi * piZX);
      let f1Reg = 4.5 * W[i] * qPi;
      f_pong[getSoAIndex(i, cellIdx)] = feqs[i] + oneMinusOmega * f1Reg;
    }
  } else {
    for (var i: u32 = 0u; i < 19u; i = i + 1u) {
      let fPost = fIn[i] - omegaLoc * (fIn[i] - feqs[i]);
      f_pong[getSoAIndex(i, cellIdx)] = fPost;
    }
  }

  // 5. Store macroscopic flow field: [vx, vy, vz, rho] in physical units
  let physVx = ux * (u.dx / u.dt);
  let physVy = uy * (u.dx / u.dt);
  let physVz = uz * (u.dx / u.dt);
  macroFields[cellIdx] = vec4<f32>(physVx, physVy, physVz, rho);

  if (cellFx != 0.0 || cellFy != 0.0 || cellFz != 0.0) {
    // Fixed-point atomic accumulation (scale 1e6) eliminates multi-thread race overwrites on dragOutput
    let scale: f32 = 1000000.0;
    atomicAdd(&dragOutput[0], i32(round(cellFx * scale)));
    atomicAdd(&dragOutput[1], i32(round(cellFy * scale)));
    atomicAdd(&dragOutput[2], i32(round(cellFz * scale)));
  }
}
`;

/**
 * WebGPU WGSL Compute Shader for Double-Distribution D3Q7 Thermal LBM.
 * Advects and diffuses temperature T coupled to the D3Q19 macroscopic velocity field.
 */
export const LBM_THERMAL_D3Q7_WGSL = /* wgsl */ `
struct ThermalUniforms {
  nx: u32,
  ny: u32,
  nz: u32,
  totalCells: u32,
  omegaT: f32,
  dt: f32,
  dx: f32,
  ambientTempK: f32,
  wallTempK: f32,
  heatFluxDeltaT: f32,
  useHeatFlux: u32,
  _pad: u32,
};

@group(0) @binding(0) var<uniform> tu: ThermalUniforms;
@group(0) @binding(1) var<storage, read> cellTypes: array<u32>;
@group(0) @binding(2) var<storage, read> macroFields: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> g_ping: array<f32>;
@group(0) @binding(4) var<storage, read_write> g_pong: array<f32>;
@group(0) @binding(5) var<storage, read_write> temperature: array<f32>;

const TCX = array<i32, 7>(0, 1, -1, 0, 0, 0, 0);
const TCY = array<i32, 7>(0, 0, 0, 1, -1, 0, 0);
const TCZ = array<i32, 7>(0, 0, 0, 0, 0, 1, -1);
const TOPP = array<u32, 7>(0u, 2u, 1u, 4u, 3u, 6u, 5u);
const TW = array<f32, 7>(0.25, 0.125, 0.125, 0.125, 0.125, 0.125, 0.125);

@compute @workgroup_size(8, 8, 4)
fn cs_lbm_thermal_step(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= tu.nx || gid.y >= tu.ny || gid.z >= tu.nz) {
    return;
  }
  let cellIdx = gid.x + gid.y * tu.nx + gid.z * tu.nx * tu.ny;
  let cType = cellTypes[cellIdx];
  if (cType == 1u || cType == 2u) {
    temperature[cellIdx] = tu.wallTempK;
    return;
  }

  let macro = macroFields[cellIdx];
  let ux = macro.x * (tu.dt / tu.dx);
  let uy = macro.y * (tu.dt / tu.dx);
  let uz = macro.z * (tu.dt / tu.dx);

  var gIn: array<f32, 7>;
  var temp: f32 = 0.0;
  let gx = i32(gid.x);
  let gy = i32(gid.y);
  let gz = i32(gid.z);

  for (var q: u32 = 0u; q < 7u; q = q + 1u) {
    let sx = gx - TCX[q];
    let sy = gy - TCY[q];
    let sz = gz - TCZ[q];
    var pulled: f32 = 0.0;
    if (sx < 0 || sx >= i32(tu.nx) || sy < 0 || sy >= i32(tu.ny) || sz < 0 || sz >= i32(tu.nz)) {
      pulled = TW[q] * tu.ambientTempK;
    } else {
      let upIdx = u32(sx) + u32(sy) * tu.nx + u32(sz) * tu.nx * tu.ny;
      let upType = cellTypes[upIdx];
      if (upType == 1u) {
        let oppQ = TOPP[q];
        if (tu.useHeatFlux != 0u) {
          pulled = g_ping[oppQ * tu.totalCells + cellIdx] + TW[q] * tu.heatFluxDeltaT;
        } else {
          pulled = 2.0 * TW[q] * tu.wallTempK - g_ping[oppQ * tu.totalCells + cellIdx];
        }
      } else if (upType == 2u) {
        let oppQ = TOPP[q];
        pulled = g_ping[oppQ * tu.totalCells + cellIdx];
      } else {
        pulled = g_ping[q * tu.totalCells + upIdx];
      }
    }
    gIn[q] = pulled;
    temp += pulled;
  }

  if (cType == 3u) {
    temp = tu.ambientTempK;
  }

  for (var q: u32 = 0u; q < 7u; q = q + 1u) {
    let cu = f32(TCX[q]) * ux + f32(TCY[q]) * uy + f32(TCZ[q]) * uz;
    let geq = TW[q] * temp * (1.0 + 4.0 * cu);
    g_pong[q * tu.totalCells + cellIdx] = gIn[q] - tu.omegaT * (gIn[q] - geq);
  }
  temperature[cellIdx] = temp;
}
`;
