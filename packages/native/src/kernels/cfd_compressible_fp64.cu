// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Self-contained NVRTC / hipRTC native IEEE-754 FP64 (double) 3D Compressible
// Navier-Stokes / Euler Finite-Volume kernel with 2nd-order MUSCL-minmod
// reconstruction, Toro HLLC approximate Riemann solver, and Shu-Osher SSP-RK3.

struct MsConserved5F64 {
  double rho;
  double ru;
  double rv;
  double rw;
  double rE;
};

static __device__ __forceinline__ int ms_wrap_or_clamp(int idx, int n, int bc) {
  if (bc == 1) {
    int m = idx % n;
    return m < 0 ? m + n : m;
  }
  if (idx < 0) return 0;
  if (idx >= n) return n - 1;
  return idx;
}

static __device__ __forceinline__ MsConserved5F64 ms_load_cell_bc_fp64(
    const double* __restrict__ u_curr,
    int i,
    int j,
    int k,
    int nx,
    int ny,
    int nz,
    int bcX,
    int bcY,
    int bcZ) {
  const int ci = ms_wrap_or_clamp(i, nx, bcX);
  const int cj = ms_wrap_or_clamp(j, ny, bcY);
  const int ck = ms_wrap_or_clamp(k, nz, bcZ);

  const double flipU = (bcX == 2 && (i < 0 || i >= nx)) ? -1.0 : 1.0;
  const double flipV = (bcY == 2 && (j < 0 || j >= ny)) ? -1.0 : 1.0;
  const double flipW = (bcZ == 2 && (k < 0 || k >= nz)) ? -1.0 : 1.0;

  const long long tc = (long long)nx * (long long)ny * (long long)nz;
  const long long cell = ((long long)ck * (long long)ny + (long long)cj) * (long long)nx + (long long)ci;

  MsConserved5F64 q;
  const double rho_raw = u_curr[cell];
  q.rho = rho_raw > 1e-12 ? rho_raw : 1e-12;
  q.ru = u_curr[tc + cell] * flipU;
  q.rv = u_curr[2LL * tc + cell] * flipV;
  q.rw = u_curr[3LL * tc + cell] * flipW;
  q.rE = u_curr[4LL * tc + cell];
  return q;
}

static __device__ __forceinline__ double ms_minmod_fp64(double a, double b) {
  if (a * b <= 0.0) return 0.0;
  return fabs(a) < fabs(b) ? a : b;
}

static __device__ __forceinline__ MsConserved5F64 ms_muscl_left_fp64(
    MsConserved5F64 qLL, MsConserved5F64 qL, MsConserved5F64 qR) {
  MsConserved5F64 out;
  const double rho = qL.rho + 0.5 * ms_minmod_fp64(qR.rho - qL.rho, qL.rho - qLL.rho);
  out.rho = rho > 1e-12 ? rho : 1e-12;
  out.ru = qL.ru + 0.5 * ms_minmod_fp64(qR.ru - qL.ru, qL.ru - qLL.ru);
  out.rv = qL.rv + 0.5 * ms_minmod_fp64(qR.rv - qL.rv, qL.rv - qLL.rv);
  out.rw = qL.rw + 0.5 * ms_minmod_fp64(qR.rw - qL.rw, qL.rw - qLL.rw);
  out.rE = qL.rE + 0.5 * ms_minmod_fp64(qR.rE - qL.rE, qL.rE - qLL.rE);
  return out;
}

static __device__ __forceinline__ MsConserved5F64 ms_muscl_right_fp64(
    MsConserved5F64 qL, MsConserved5F64 qR, MsConserved5F64 qRR) {
  MsConserved5F64 out;
  const double rho = qR.rho - 0.5 * ms_minmod_fp64(qRR.rho - qR.rho, qR.rho - qL.rho);
  out.rho = rho > 1e-12 ? rho : 1e-12;
  out.ru = qR.ru - 0.5 * ms_minmod_fp64(qRR.ru - qR.ru, qR.ru - qL.ru);
  out.rv = qR.rv - 0.5 * ms_minmod_fp64(qRR.rv - qR.rv, qR.rv - qL.rv);
  out.rw = qR.rw - 0.5 * ms_minmod_fp64(qRR.rw - qR.rw, qR.rw - qL.rw);
  out.rE = qR.rE - 0.5 * ms_minmod_fp64(qRR.rE - qR.rE, qR.rE - qL.rE);
  return out;
}

static __device__ __forceinline__ MsConserved5F64 ms_hllc_flux_3d_fp64(
    MsConserved5F64 uL,
    MsConserved5F64 uR,
    double nx_dir,
    double ny_dir,
    double nz_dir,
    double gamma) {
  const double gm1 = gamma - 1.0;

  const double rhoL = fmax(uL.rho, 1e-12);
  const double uLx = uL.ru / rhoL;
  const double uLy = uL.rv / rhoL;
  const double uLz = uL.rw / rhoL;
  const double pL = fmax(gm1 * (uL.rE - 0.5 * rhoL * (uLx * uLx + uLy * uLy + uLz * uLz)), 1e-12);
  const double cL = sqrt(gamma * pL / rhoL);
  const double qnL = uLx * nx_dir + uLy * ny_dir + uLz * nz_dir;
  const double HL = (uL.rE + pL) / rhoL;

  const double rhoR = fmax(uR.rho, 1e-12);
  const double uRx = uR.ru / rhoR;
  const double uRy = uR.rv / rhoR;
  const double uRz = uR.rw / rhoR;
  const double pR = fmax(gm1 * (uR.rE - 0.5 * rhoR * (uRx * uRx + uRy * uRy + uRz * uRz)), 1e-12);
  const double cR = sqrt(gamma * pR / rhoR);
  const double qnR = uRx * nx_dir + uRy * ny_dir + uRz * nz_dir;
  const double HR = (uR.rE + pR) / rhoR;

  const double srL = sqrt(rhoL);
  const double srR = sqrt(rhoR);
  const double invSr = 1.0 / (srL + srR);
  const double uT = (srL * uLx + srR * uRx) * invSr;
  const double vT = (srL * uLy + srR * uRy) * invSr;
  const double wT = (srL * uLz + srR * uRz) * invSr;
  const double HT = (srL * HL + srR * HR) * invSr;
  const double cT = sqrt(fmax(gm1 * (HT - 0.5 * (uT * uT + vT * vT + wT * wT)), 1e-12));
  const double qnT = uT * nx_dir + vT * ny_dir + wT * nz_dir;

  const double sL = fmin(qnL - cL, qnT - cT);
  const double sR = fmax(qnR + cR, qnT + cT);

  MsConserved5F64 flux;
  if (sL >= 0.0) {
    flux.rho = rhoL * qnL;
    flux.ru = rhoL * uLx * qnL + pL * nx_dir;
    flux.rv = rhoL * uLy * qnL + pL * ny_dir;
    flux.rw = rhoL * uLz * qnL + pL * nz_dir;
    flux.rE = (uL.rE + pL) * qnL;
    return flux;
  }
  if (sR <= 0.0) {
    flux.rho = rhoR * qnR;
    flux.ru = rhoR * uRx * qnR + pR * nx_dir;
    flux.rv = rhoR * uRy * qnR + pR * ny_dir;
    flux.rw = rhoR * uRz * qnR + pR * nz_dir;
    flux.rE = (uR.rE + pR) * qnR;
    return flux;
  }

  const double denom = rhoL * (sL - qnL) - rhoR * (sR - qnR);
  const double sStar = (fabs(denom) > 1e-30)
                           ? (pR - pL + rhoL * qnL * (sL - qnL) - rhoR * qnR * (sR - qnR)) / denom
                           : 0.5 * (qnL + qnR);

  if (sStar >= 0.0) {
    const double fac = rhoL * (sL - qnL) / (sL - sStar);
    const double uS0 = fac;
    const double uS1 = fac * (uLx + (sStar - qnL) * nx_dir);
    const double uS2 = fac * (uLy + (sStar - qnL) * ny_dir);
    const double uS3 = fac * (uLz + (sStar - qnL) * nz_dir);
    const double uS4 = fac * (uL.rE / rhoL + (sStar - qnL) * (sStar + pL / (rhoL * (sL - qnL))));
    flux.rho = rhoL * qnL + sL * (uS0 - rhoL);
    flux.ru = rhoL * uLx * qnL + pL * nx_dir + sL * (uS1 - uL.ru);
    flux.rv = rhoL * uLy * qnL + pL * ny_dir + sL * (uS2 - uL.rv);
    flux.rw = rhoL * uLz * qnL + pL * nz_dir + sL * (uS3 - uL.rw);
    flux.rE = (uL.rE + pL) * qnL + sL * (uS4 - uL.rE);
    return flux;
  } else {
    const double fac = rhoR * (sR - qnR) / (sR - sStar);
    const double uS0 = fac;
    const double uS1 = fac * (uRx + (sStar - qnR) * nx_dir);
    const double uS2 = fac * (uRy + (sStar - qnR) * ny_dir);
    const double uS3 = fac * (uRz + (sStar - qnR) * nz_dir);
    const double uS4 = fac * (uR.rE / rhoR + (sStar - qnR) * (sStar + pR / (rhoR * (sR - qnR))));
    flux.rho = rhoR * qnR + sR * (uS0 - rhoR);
    flux.ru = rhoR * uRx * qnR + pR * nx_dir + sR * (uS1 - uR.ru);
    flux.rv = rhoR * uRy * qnR + pR * ny_dir + sR * (uS2 - uR.rv);
    flux.rw = rhoR * uRz * qnR + pR * nz_dir + sR * (uS3 - uR.rw);
    flux.rE = (uR.rE + pR) * qnR + sR * (uS4 - uR.rE);
    return flux;
  }
}

extern "C" __global__ void ms_cfd_compressible_hllc_rhs_fp64(
    const double* __restrict__ u_curr,
    double* __restrict__ rhs,
    int nx,
    int ny,
    int nz,
    double dx,
    double dy,
    double dz,
    double gamma,
    int bcX,
    int bcY,
    int bcZ) {
  const long long tc = (long long)nx * (long long)ny * (long long)nz;
  const long long cell = (long long)blockIdx.x * (long long)blockDim.x + (long long)threadIdx.x;
  if (cell >= tc) return;

  const int i = (int)(cell % nx);
  const int j = (int)((cell / nx) % ny);
  const int k = (int)(cell / ((long long)nx * (long long)ny));

  double d0 = 0.0;
  double d1 = 0.0;
  double d2 = 0.0;
  double d3 = 0.0;
  double d4 = 0.0;

  if (nx > 1) {
    const MsConserved5F64 qm2 = ms_load_cell_bc_fp64(u_curr, i - 2, j, k, nx, ny, nz, bcX, bcY, bcZ);
    const MsConserved5F64 qm1 = ms_load_cell_bc_fp64(u_curr, i - 1, j, k, nx, ny, nz, bcX, bcY, bcZ);
    const MsConserved5F64 q0  = ms_load_cell_bc_fp64(u_curr, i,     j, k, nx, ny, nz, bcX, bcY, bcZ);
    const MsConserved5F64 qp1 = ms_load_cell_bc_fp64(u_curr, i + 1, j, k, nx, ny, nz, bcX, bcY, bcZ);
    const MsConserved5F64 qp2 = ms_load_cell_bc_fp64(u_curr, i + 2, j, k, nx, ny, nz, bcX, bcY, bcZ);

    const MsConserved5F64 fL = ms_hllc_flux_3d_fp64(
        ms_muscl_left_fp64(qm2, qm1, q0), ms_muscl_right_fp64(qm1, q0, qp1), 1.0, 0.0, 0.0, gamma);
    const MsConserved5F64 fR = ms_hllc_flux_3d_fp64(
        ms_muscl_left_fp64(qm1, q0, qp1), ms_muscl_right_fp64(q0, qp1, qp2), 1.0, 0.0, 0.0, gamma);

    const double invDx = 1.0 / dx;
    d0 -= (fR.rho - fL.rho) * invDx;
    d1 -= (fR.ru  - fL.ru)  * invDx;
    d2 -= (fR.rv  - fL.rv)  * invDx;
    d3 -= (fR.rw  - fL.rw)  * invDx;
    d4 -= (fR.rE  - fL.rE)  * invDx;
  }

  if (ny > 1) {
    const MsConserved5F64 qm2 = ms_load_cell_bc_fp64(u_curr, i, j - 2, k, nx, ny, nz, bcX, bcY, bcZ);
    const MsConserved5F64 qm1 = ms_load_cell_bc_fp64(u_curr, i, j - 1, k, nx, ny, nz, bcX, bcY, bcZ);
    const MsConserved5F64 q0  = ms_load_cell_bc_fp64(u_curr, i, j,     k, nx, ny, nz, bcX, bcY, bcZ);
    const MsConserved5F64 qp1 = ms_load_cell_bc_fp64(u_curr, i, j + 1, k, nx, ny, nz, bcX, bcY, bcZ);
    const MsConserved5F64 qp2 = ms_load_cell_bc_fp64(u_curr, i, j + 2, k, nx, ny, nz, bcX, bcY, bcZ);

    const MsConserved5F64 fL = ms_hllc_flux_3d_fp64(
        ms_muscl_left_fp64(qm2, qm1, q0), ms_muscl_right_fp64(qm1, q0, qp1), 0.0, 1.0, 0.0, gamma);
    const MsConserved5F64 fR = ms_hllc_flux_3d_fp64(
        ms_muscl_left_fp64(qm1, q0, qp1), ms_muscl_right_fp64(q0, qp1, qp2), 0.0, 1.0, 0.0, gamma);

    const double invDy = 1.0 / dy;
    d0 -= (fR.rho - fL.rho) * invDy;
    d1 -= (fR.ru  - fL.ru)  * invDy;
    d2 -= (fR.rv  - fL.rv)  * invDy;
    d3 -= (fR.rw  - fL.rw)  * invDy;
    d4 -= (fR.rE  - fL.rE)  * invDy;
  }

  if (nz > 1) {
    const MsConserved5F64 qm2 = ms_load_cell_bc_fp64(u_curr, i, j, k - 2, nx, ny, nz, bcX, bcY, bcZ);
    const MsConserved5F64 qm1 = ms_load_cell_bc_fp64(u_curr, i, j, k - 1, nx, ny, nz, bcX, bcY, bcZ);
    const MsConserved5F64 q0  = ms_load_cell_bc_fp64(u_curr, i, j, k,     nx, ny, nz, bcX, bcY, bcZ);
    const MsConserved5F64 qp1 = ms_load_cell_bc_fp64(u_curr, i, j, k + 1, nx, ny, nz, bcX, bcY, bcZ);
    const MsConserved5F64 qp2 = ms_load_cell_bc_fp64(u_curr, i, j, k + 2, nx, ny, nz, bcX, bcY, bcZ);

    const MsConserved5F64 fL = ms_hllc_flux_3d_fp64(
        ms_muscl_left_fp64(qm2, qm1, q0), ms_muscl_right_fp64(qm1, q0, qp1), 0.0, 0.0, 1.0, gamma);
    const MsConserved5F64 fR = ms_hllc_flux_3d_fp64(
        ms_muscl_left_fp64(qm1, q0, qp1), ms_muscl_right_fp64(q0, qp1, qp2), 0.0, 0.0, 1.0, gamma);

    const double invDz = 1.0 / dz;
    d0 -= (fR.rho - fL.rho) * invDz;
    d1 -= (fR.ru  - fL.ru)  * invDz;
    d2 -= (fR.rv  - fL.rv)  * invDz;
    d3 -= (fR.rw  - fL.rw)  * invDz;
    d4 -= (fR.rE  - fL.rE)  * invDz;
  }

  rhs[cell]            = d0;
  rhs[tc + cell]       = d1;
  rhs[2LL * tc + cell] = d2;
  rhs[3LL * tc + cell] = d3;
  rhs[4LL * tc + cell] = d4;
}

extern "C" __global__ void ms_cfd_compressible_ssp_rk3_fp64(
    const double* __restrict__ u_base,
    const double* __restrict__ u_curr,
    const double* __restrict__ rhs,
    double* __restrict__ u_next,
    long long totalCells,
    double dt,
    double gamma,
    int rkStage) {
  const long long cell = (long long)blockIdx.x * (long long)blockDim.x + (long long)threadIdx.x;
  if (cell >= totalCells) return;

  for (int m = 0; m < 5; ++m) {
    const long long idx = (long long)m * totalCells + cell;
    const double u0 = u_base[idx];
    const double uc = u_curr[idx];
    const double r = rhs[idx];
    double un = uc;
    if (rkStage == 0) {
      un = u0 + dt * r;
    } else if (rkStage == 1) {
      un = 0.75 * u0 + 0.25 * uc + 0.25 * dt * r;
    } else {
      un = (1.0 / 3.0) * u0 + (2.0 / 3.0) * uc + (2.0 / 3.0) * dt * r;
    }
    u_next[idx] = un;
  }

  // Enforce strict density and internal energy positivity
  const double rho = fmax(u_next[cell], 1e-12);
  u_next[cell] = rho;
  const double ru = u_next[totalCells + cell];
  const double rv = u_next[2LL * totalCells + cell];
  const double rw = u_next[3LL * totalCells + cell];
  const double ke = 0.5 * (ru * ru + rv * rv + rw * rw) / rho;
  const double minE = ke + 1e-12 / (gamma - 1.0);
  if (u_next[4LL * totalCells + cell] < minE) {
    u_next[4LL * totalCells + cell] = minE;
  }
}
