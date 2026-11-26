// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebGPU WGSL Compute Shader (f32) for 3D Compressible Navier-Stokes / Euler FVM.
 * Implements SoA conserved variable layout `[rho, rhoU, rhoV, rhoW, rhoE]`,
 * 2nd-order MUSCL reconstruction with minmod slope limiter, Toro HLLC approximate
 * Riemann flux, and Shu-Osher 3-stage SSP-RK3 time integration.
 */
export const COMPRESSIBLE_FVM_HLLC_WGSL = /* wgsl */ `
struct CompressibleUniforms {
  nx: u32,
  ny: u32,
  nz: u32,
  totalCells: u32,
  dx: f32,
  dy: f32,
  dz: f32,
  dt: f32,
  gamma: f32,
  rkStage: u32,
  bcX: u32, // 0 = extrapolation, 1 = periodic, 2 = reflective
  bcY: u32,
  bcZ: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

struct Conserved5 {
  rho: f32,
  ru: f32,
  rv: f32,
  rw: f32,
  rE: f32,
};

@group(0) @binding(0) var<uniform> params: CompressibleUniforms;
@group(0) @binding(1) var<storage, read> u_curr: array<f32>;
@group(0) @binding(2) var<storage, read> u_base: array<f32>;
@group(0) @binding(3) var<storage, read_write> rhs: array<f32>;
@group(0) @binding(4) var<storage, read_write> u_next: array<f32>;

const MIN_RHO: f32 = 1e-7;
const MIN_P: f32 = 1e-7;

fn wrap_or_clamp(idx: i32, n: i32, bc: u32) -> i32 {
  if (bc == 1u) {
    return ((idx % n) + n) % n;
  }
  return clamp(idx, 0, n - 1);
}

fn load_cell_bc(i: i32, j: i32, k: i32) -> Conserved5 {
  let nx_i = i32(params.nx);
  let ny_i = i32(params.ny);
  let nz_i = i32(params.nz);

  let ci = wrap_or_clamp(i, nx_i, params.bcX);
  let cj = wrap_or_clamp(j, ny_i, params.bcY);
  let ck = wrap_or_clamp(k, nz_i, params.bcZ);

  var flipU: f32 = 1.0;
  var flipV: f32 = 1.0;
  var flipW: f32 = 1.0;
  if (params.bcX == 2u && (i < 0 || i >= nx_i)) { flipU = -1.0; }
  if (params.bcY == 2u && (j < 0 || j >= ny_i)) { flipV = -1.0; }
  if (params.bcZ == 2u && (k < 0 || k >= nz_i)) { flipW = -1.0; }

  let cell = u32((ck * ny_i + cj) * nx_i + ci);
  let tc = params.totalCells;

  return Conserved5(
    max(u_curr[cell], MIN_RHO),
    u_curr[tc + cell] * flipU,
    u_curr[2u * tc + cell] * flipV,
    u_curr[3u * tc + cell] * flipW,
    u_curr[4u * tc + cell]
  );
}

fn minmod_f32(a: f32, b: f32) -> f32 {
  if (a * b <= 0.0) {
    return 0.0;
  }
  if (abs(a) < abs(b)) {
    return a;
  }
  return b;
}

fn muscl_left(qLL: Conserved5, qL: Conserved5, qR: Conserved5) -> Conserved5 {
  return Conserved5(
    max(qL.rho + 0.5 * minmod_f32(qR.rho - qL.rho, qL.rho - qLL.rho), MIN_RHO),
    qL.ru + 0.5 * minmod_f32(qR.ru - qL.ru, qL.ru - qLL.ru),
    qL.rv + 0.5 * minmod_f32(qR.rv - qL.rv, qL.rv - qLL.rv),
    qL.rw + 0.5 * minmod_f32(qR.rw - qL.rw, qL.rw - qLL.rw),
    qL.rE + 0.5 * minmod_f32(qR.rE - qL.rE, qL.rE - qLL.rE)
  );
}

fn muscl_right(qL: Conserved5, qR: Conserved5, qRR: Conserved5) -> Conserved5 {
  return Conserved5(
    max(qR.rho - 0.5 * minmod_f32(qRR.rho - qR.rho, qR.rho - qL.rho), MIN_RHO),
    qR.ru - 0.5 * minmod_f32(qRR.ru - qR.ru, qR.ru - qL.ru),
    qR.rv - 0.5 * minmod_f32(qRR.rv - qR.rv, qR.rv - qL.rv),
    qR.rw - 0.5 * minmod_f32(qRR.rw - qR.rw, qR.rw - qL.rw),
    qR.rE - 0.5 * minmod_f32(qRR.rE - qR.rE, qR.rE - qL.rE)
  );
}

fn hllc_flux_3d(uL: Conserved5, uR: Conserved5, nx: f32, ny: f32, nz: f32) -> Conserved5 {
  let gamma = params.gamma;
  let gm1 = gamma - 1.0;

  let rhoL = max(uL.rho, MIN_RHO);
  let uLx = uL.ru / rhoL;
  let uLy = uL.rv / rhoL;
  let uLz = uL.rw / rhoL;
  let pL = max(gm1 * (uL.rE - 0.5 * rhoL * (uLx * uLx + uLy * uLy + uLz * uLz)), MIN_P);
  let cL = sqrt(gamma * pL / rhoL);
  let qnL = uLx * nx + uLy * ny + uLz * nz;
  let HL = (uL.rE + pL) / rhoL;

  let rhoR = max(uR.rho, MIN_RHO);
  let uRx = uR.ru / rhoR;
  let uRy = uR.rv / rhoR;
  let uRz = uR.rw / rhoR;
  let pR = max(gm1 * (uR.rE - 0.5 * rhoR * (uRx * uRx + uRy * uRy + uRz * uRz)), MIN_P);
  let cR = sqrt(gamma * pR / rhoR);
  let qnR = uRx * nx + uRy * ny + uRz * nz;
  let HR = (uR.rE + pR) / rhoR;

  let srL = sqrt(rhoL);
  let srR = sqrt(rhoR);
  let invSr = 1.0 / (srL + srR);
  let uT = (srL * uLx + srR * uRx) * invSr;
  let vT = (srL * uLy + srR * uRy) * invSr;
  let wT = (srL * uLz + srR * uRz) * invSr;
  let HT = (srL * HL + srR * HR) * invSr;
  let cT = sqrt(max(gm1 * (HT - 0.5 * (uT * uT + vT * vT + wT * wT)), 1e-7));
  let qnT = uT * nx + vT * ny + wT * nz;

  let sL = min(qnL - cL, qnT - cT);
  let sR = max(qnR + cR, qnT + cT);

  if (sL >= 0.0) {
    return Conserved5(
      rhoL * qnL,
      rhoL * uLx * qnL + pL * nx,
      rhoL * uLy * qnL + pL * ny,
      rhoL * uLz * qnL + pL * nz,
      (uL.rE + pL) * qnL
    );
  }
  if (sR <= 0.0) {
    return Conserved5(
      rhoR * qnR,
      rhoR * uRx * qnR + pR * nx,
      rhoR * uRy * qnR + pR * ny,
      rhoR * uRz * qnR + pR * nz,
      (uR.rE + pR) * qnR
    );
  }

  let denom = rhoL * (sL - qnL) - rhoR * (sR - qnR);
  let sStar = select(
    0.5 * (qnL + qnR),
    (pR - pL + rhoL * qnL * (sL - qnL) - rhoR * qnR * (sR - qnR)) / denom,
    abs(denom) > 1e-12
  );

  if (sStar >= 0.0) {
    let fac = rhoL * (sL - qnL) / (sL - sStar);
    let uS0 = fac;
    let uS1 = fac * (uLx + (sStar - qnL) * nx);
    let uS2 = fac * (uLy + (sStar - qnL) * ny);
    let uS3 = fac * (uLz + (sStar - qnL) * nz);
    let uS4 = fac * (uL.rE / rhoL + (sStar - qnL) * (sStar + pL / (rhoL * (sL - qnL))));
    return Conserved5(
      rhoL * qnL + sL * (uS0 - rhoL),
      rhoL * uLx * qnL + pL * nx + sL * (uS1 - uL.ru),
      rhoL * uLy * qnL + pL * ny + sL * (uS2 - uL.rv),
      rhoL * uLz * qnL + pL * nz + sL * (uS3 - uL.rw),
      (uL.rE + pL) * qnL + sL * (uS4 - uL.rE)
    );
  } else {
    let fac = rhoR * (sR - qnR) / (sR - sStar);
    let uS0 = fac;
    let uS1 = fac * (uRx + (sStar - qnR) * nx);
    let uS2 = fac * (uRy + (sStar - qnR) * ny);
    let uS3 = fac * (uRz + (sStar - qnR) * nz);
    let uS4 = fac * (uR.rE / rhoR + (sStar - qnR) * (sStar + pR / (rhoR * (sR - qnR))));
    return Conserved5(
      rhoR * qnR + sR * (uS0 - rhoR),
      rhoR * uRx * qnR + pR * nx + sR * (uS1 - uR.ru),
      rhoR * uRy * qnR + pR * ny + sR * (uS2 - uR.rv),
      rhoR * uRz * qnR + pR * nz + sR * (uS3 - uR.rw),
      (uR.rE + pR) * qnR + sR * (uS4 - uR.rE)
    );
  }
}

@compute @workgroup_size(64, 1, 1)
fn compute_hllc_rhs(@builtin(global_invocation_id) gid: vec3<u32>) {
  let cell = gid.x;
  if (cell >= params.totalCells) {
    return;
  }

  let nx = params.nx;
  let ny = params.ny;
  let nz = params.nz;
  let i = i32(cell % nx);
  let j = i32((cell / nx) % ny);
  let k = i32(cell / (nx * ny));

  var d0: f32 = 0.0;
  var d1: f32 = 0.0;
  var d2: f32 = 0.0;
  var d3: f32 = 0.0;
  var d4: f32 = 0.0;

  // X-direction flux divergence
  if (nx > 1u) {
    let qm2 = load_cell_bc(i - 2, j, k);
    let qm1 = load_cell_bc(i - 1, j, k);
    let q0  = load_cell_bc(i, j, k);
    let qp1 = load_cell_bc(i + 1, j, k);
    let qp2 = load_cell_bc(i + 2, j, k);

    let fL = hllc_flux_3d(muscl_left(qm2, qm1, q0), muscl_right(qm1, q0, qp1), 1.0, 0.0, 0.0);
    let fR = hllc_flux_3d(muscl_left(qm1, q0, qp1), muscl_right(q0, qp1, qp2), 1.0, 0.0, 0.0);
    let invDx = 1.0 / params.dx;
    d0 -= (fR.rho - fL.rho) * invDx;
    d1 -= (fR.ru  - fL.ru)  * invDx;
    d2 -= (fR.rv  - fL.rv)  * invDx;
    d3 -= (fR.rw  - fL.rw)  * invDx;
    d4 -= (fR.rE  - fL.rE)  * invDx;
  }

  // Y-direction flux divergence
  if (ny > 1u) {
    let qm2 = load_cell_bc(i, j - 2, k);
    let qm1 = load_cell_bc(i, j - 1, k);
    let q0  = load_cell_bc(i, j, k);
    let qp1 = load_cell_bc(i, j + 1, k);
    let qp2 = load_cell_bc(i, j + 2, k);

    let fL = hllc_flux_3d(muscl_left(qm2, qm1, q0), muscl_right(qm1, q0, qp1), 0.0, 1.0, 0.0);
    let fR = hllc_flux_3d(muscl_left(qm1, q0, qp1), muscl_right(q0, qp1, qp2), 0.0, 1.0, 0.0);
    let invDy = 1.0 / params.dy;
    d0 -= (fR.rho - fL.rho) * invDy;
    d1 -= (fR.ru  - fL.ru)  * invDy;
    d2 -= (fR.rv  - fL.rv)  * invDy;
    d3 -= (fR.rw  - fL.rw)  * invDy;
    d4 -= (fR.rE  - fL.rE)  * invDy;
  }

  // Z-direction flux divergence
  if (nz > 1u) {
    let qm2 = load_cell_bc(i, j, k - 2);
    let qm1 = load_cell_bc(i, j, k - 1);
    let q0  = load_cell_bc(i, j, k);
    let qp1 = load_cell_bc(i, j, k + 1);
    let qp2 = load_cell_bc(i, j, k + 2);

    let fL = hllc_flux_3d(muscl_left(qm2, qm1, q0), muscl_right(qm1, q0, qp1), 0.0, 0.0, 1.0);
    let fR = hllc_flux_3d(muscl_left(qm1, q0, qp1), muscl_right(q0, qp1, qp2), 0.0, 0.0, 1.0);
    let invDz = 1.0 / params.dz;
    d0 -= (fR.rho - fL.rho) * invDz;
    d1 -= (fR.ru  - fL.ru)  * invDz;
    d2 -= (fR.rv  - fL.rv)  * invDz;
    d3 -= (fR.rw  - fL.rw)  * invDz;
    d4 -= (fR.rE  - fL.rE)  * invDz;
  }

  let tc = params.totalCells;
  rhs[cell]            = d0;
  rhs[tc + cell]       = d1;
  rhs[2u * tc + cell]  = d2;
  rhs[3u * tc + cell]  = d3;
  rhs[4u * tc + cell]  = d4;
}

@compute @workgroup_size(64, 1, 1)
fn ssp_rk3_update(@builtin(global_invocation_id) gid: vec3<u32>) {
  let cell = gid.x;
  if (cell >= params.totalCells) {
    return;
  }

  let tc = params.totalCells;
  let dt = params.dt;
  let stage = params.rkStage;

  for (var m: u32 = 0u; m < 5u; m = m + 1u) {
    let idx = m * tc + cell;
    let u0 = u_base[idx];
    let uc = u_curr[idx];
    let r = rhs[idx];
    var un: f32 = uc;
    if (stage == 0u) {
      un = u0 + dt * r;
    } else if (stage == 1u) {
      un = 0.75 * u0 + 0.25 * uc + 0.25 * dt * r;
    } else {
      un = (1.0 / 3.0) * u0 + (2.0 / 3.0) * uc + (2.0 / 3.0) * dt * r;
    }
    u_next[idx] = un;
  }

  // Enforce density and internal energy positivity
  let rho = max(u_next[cell], MIN_RHO);
  u_next[cell] = rho;
  let ru = u_next[tc + cell];
  let rv = u_next[2u * tc + cell];
  let rw = u_next[3u * tc + cell];
  let ke = 0.5 * (ru * ru + rv * rv + rw * rw) / rho;
  let minE = ke + MIN_P / (params.gamma - 1.0);
  if (u_next[4u * tc + cell] < minE) {
    u_next[4u * tc + cell] = minE;
  }
}
`;
