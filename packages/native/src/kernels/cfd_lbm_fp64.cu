// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Self-contained NVRTC / hipRTC FP64 CUDA/HIP Lattice Boltzmann Kernels:
//   1. lbm_d3q19_wmles_fp64   - D3Q19 Hermite 2nd-order regularized collision,
//                               Smagorinsky LES & Spalding WMLES wall eddy viscosity,
//                               Bouzidi curved boundary & atomic FP64 drag reduction.
//   2. lbm_d3q7_thermal_fp64  - D3Q7 double-distribution thermal advection-diffusion.
//   3. lbm_pack_halo5_fp64    - Compact 5-population Cartesian face halo pack.
//   4. lbm_unpack_halo5_fp64  - Compact 5-population Cartesian face halo unpack.

#if defined(__HIP_PLATFORM_AMD__) || defined(__HIPCC__)
#define MS_DEVICE __device__ __forceinline__
#else
#define MS_DEVICE __device__ __forceinline__
#endif

// Cell classification matching LbmCellType
#define LBM_CELL_FLUID          0u
#define LBM_CELL_OBSTACLE_SOLID 1u
#define LBM_CELL_CHANNEL_WALL   2u
#define LBM_CELL_VELOCITY_INLET 3u
#define LBM_CELL_PRESSURE_OUT   4u

// D3Q19 discrete velocity vectors, opposite indices, and lattice weights
__constant__ int D3Q19_CX[19] = {
  0, 1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0
};
__constant__ int D3Q19_CY[19] = {
  0, 0, 0, 1, -1, 0, 0, 1, -1, -1, 1, 0, 0, 0, 0, 1, -1, 1, -1
};
__constant__ int D3Q19_CZ[19] = {
  0, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0, 1, -1, -1, 1, 1, -1, -1, 1
};
__constant__ int D3Q19_OPP[19] = {
  0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 18, 17
};
__constant__ double D3Q19_W[19] = {
  1.0 / 3.0,
  1.0 / 18.0, 1.0 / 18.0, 1.0 / 18.0, 1.0 / 18.0, 1.0 / 18.0, 1.0 / 18.0,
  1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0,
  1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0
};

// D3Q7 thermal discrete velocity vectors, opposite indices, and weights
__constant__ int D3Q7_CX[7] = { 0, 1, -1, 0, 0, 0, 0 };
__constant__ int D3Q7_CY[7] = { 0, 0, 0, 1, -1, 0, 0 };
__constant__ int D3Q7_CZ[7] = { 0, 0, 0, 0, 0, 1, -1 };
__constant__ int D3Q7_OPP[7] = { 0, 2, 1, 4, 3, 6, 5 };
__constant__ double D3Q7_W[7] = {
  0.25, 0.125, 0.125, 0.125, 0.125, 0.125, 0.125
};

MS_DEVICE void atomic_add_f64(double* address, double val) {
#if defined(__CUDA_ARCH__) && (__CUDA_ARCH__ < 600)
  unsigned long long int* address_as_ull = (unsigned long long int*)address;
  unsigned long long int old = *address_as_ull;
  unsigned long long int assumed;
  do {
    assumed = old;
    old = atomicCAS(
        address_as_ull,
        assumed,
        __double_as_longlong(val + __longlong_as_double(assumed)));
  } while (assumed != old);
#else
  atomicAdd(address, val);
#endif
}

// Spalding's universal algebraic law-of-the-wall solver in FP64:
//   y+ = u+ + exp(-kappa * B) * (exp(kappa * u+) - 1 - ku - (ku)^2/2 - (ku)^3/6)
MS_DEVICE double solve_spalding_utau_fp64(
    double uTan,
    double yWall,
    double nuPhys,
    double kappa,
    double lawOfWallB) {
  double uMag = fabs(uTan);
  if (uMag < 1e-12 || yWall <= 0.0 || nuPhys <= 0.0) {
    return 0.0;
  }
  double uTau = fmax(sqrt((nuPhys * uMag) / yWall), uMag * 0.04);
  double expNegKB = exp(-kappa * lawOfWallB);

  for (int iter = 0; iter < 6; ++iter) {
    double denom = fmax(1e-12, uTau);
    double uPlus = uMag / denom;
    double yPlus = (uTau * yWall) / nuPhys;
    double ku = fmin(25.0, kappa * uPlus);
    double expKu = exp(ku);
    double poly = 1.0 + ku + 0.5 * ku * ku + (ku * ku * ku) / 6.0;
    double fVal = uPlus + expNegKB * (expKu - poly) - yPlus;

    double dfDuPlus = 1.0 + kappa * expNegKB * (expKu - (1.0 + ku + 0.5 * ku * ku));
    double dfDuTau = dfDuPlus * (-uPlus / denom) - yWall / nuPhys;
    if (fabs(dfDuTau) < 1e-15) {
      break;
    }
    double next = uTau - fVal / dfDuTau;
    if (next > 1e-12 && next < 1e12) {
      uTau = next;
    } else {
      uTau *= 0.5;
    }
  }
  return uTau;
}

extern "C" __global__ void lbm_d3q19_wmles_fp64(
    int nx,
    int ny,
    int nz,
    const unsigned int* __restrict__ cellTypes,
    const double* __restrict__ fInSoA,
    double* __restrict__ fOutSoA,
    double* __restrict__ rhoOut,
    double* __restrict__ vxOut,
    double* __restrict__ vyOut,
    double* __restrict__ vzOut,
    const double* __restrict__ deltaWall,
    double* __restrict__ wallShearOut,
    double* __restrict__ dragForceOut,
    double tau,
    double dx,
    double dt,
    double density,
    double uInletX,
    double uInletY,
    double uInletZ,
    double movingWallX,
    double movingWallY,
    double movingWallZ,
    double csSq,
    double kappa,
    double lawOfWallB,
    int useLES,
    int useWMLES,
    int useRegularized,
    int useBouzidi) {
  int gx = (int)(blockIdx.x * blockDim.x + threadIdx.x);
  int gy = (int)(blockIdx.y * blockDim.y + threadIdx.y);
  int gz = (int)(blockIdx.z * blockDim.z + threadIdx.z);
  if (gx >= nx || gy >= ny || gz >= nz) {
    return;
  }

  long long totalCells = (long long)nx * (long long)ny * (long long)nz;
  long long cellIdx = (long long)gx + (long long)gy * nx + (long long)gz * nx * ny;
  unsigned int cType = cellTypes[cellIdx];

  if (cType == LBM_CELL_OBSTACLE_SOLID || cType == LBM_CELL_CHANNEL_WALL) {
    return;
  }

  double fLoc[19];
  double cellFx = 0.0;
  double cellFy = 0.0;
  double cellFz = 0.0;
  int adjacentToSolid = 0;

  // 1. Pull streaming with Bouzidi curved wall & moving-wall momentum exchange
  for (int i = 0; i < 19; ++i) {
    int sx = gx - D3Q19_CX[i];
    int sy = gy - D3Q19_CY[i];
    int sz = gz - D3Q19_CZ[i];
    double pulled = 0.0;

    if (sx < 0 || sx >= nx || sy < 0 || sy >= ny || sz < 0 || sz >= nz) {
      if (sx >= nx && cType == LBM_CELL_PRESSURE_OUT) {
        pulled = fInSoA[(long long)i * totalCells + cellIdx];
      } else {
        int opp = D3Q19_OPP[i];
        pulled = fInSoA[(long long)opp * totalCells + cellIdx];
      }
    } else {
      long long upIdx = (long long)sx + (long long)sy * nx + (long long)sz * nx * ny;
      unsigned int upType = cellTypes[upIdx];

      if (upType == LBM_CELL_OBSTACLE_SOLID || upType == LBM_CELL_CHANNEL_WALL) {
        int opp = D3Q19_OPP[i];
        double fOutVal = fInSoA[(long long)opp * totalCells + cellIdx];
        double fRefl = fOutVal;

        if (upType == LBM_CELL_OBSTACLE_SOLID) {
          adjacentToSolid = 1;
          if (useBouzidi != 0 && deltaWall != nullptr) {
            double delta = deltaWall[(long long)opp * totalCells + cellIdx];
            if (delta > 0.0 && delta < 1.0) {
              if (delta < 0.5) {
                int bx = gx + D3Q19_CX[i];
                int by = gy + D3Q19_CY[i];
                int bz = gz + D3Q19_CZ[i];
                if (bx >= 0 && bx < nx && by >= 0 && by < ny && bz >= 0 && bz < nz) {
                  long long bIdx = (long long)bx + (long long)by * nx + (long long)bz * nx * ny;
                  unsigned int bType = cellTypes[bIdx];
                  if (bType != LBM_CELL_OBSTACLE_SOLID && bType != LBM_CELL_CHANNEL_WALL) {
                    double fB = fInSoA[(long long)opp * totalCells + bIdx];
                    fRefl = 2.0 * delta * fOutVal + (1.0 - 2.0 * delta) * fB;
                  }
                }
              } else {
                double fOppPrev = fInSoA[(long long)i * totalCells + cellIdx];
                fRefl = (1.0 / (2.0 * delta)) * fOutVal + ((2.0 * delta - 1.0) / (2.0 * delta)) * fOppPrev;
              }
            }
          }

          double cuWall =
              (double)D3Q19_CX[i] * movingWallX +
              (double)D3Q19_CY[i] * movingWallY +
              (double)D3Q19_CZ[i] * movingWallZ;
          fRefl += 6.0 * D3Q19_W[i] * cuWall;

          // Momentum exchange force exerted on obstacle along direction opp = -c_i
          double mom = fOutVal + fRefl;
          cellFx += (double)D3Q19_CX[opp] * mom;
          cellFy += (double)D3Q19_CY[opp] * mom;
          cellFz += (double)D3Q19_CZ[opp] * mom;
        }
        pulled = fRefl;
      } else {
        pulled = fInSoA[(long long)i * totalCells + upIdx];
      }
    }
    fLoc[i] = pulled;
  }

  // 2. Macroscopic moments (rho, u)
  double rho = 0.0;
  double jx = 0.0;
  double jy = 0.0;
  double jz = 0.0;
  for (int i = 0; i < 19; ++i) {
    double fi = fLoc[i];
    rho += fi;
    jx += (double)D3Q19_CX[i] * fi;
    jy += (double)D3Q19_CY[i] * fi;
    jz += (double)D3Q19_CZ[i] * fi;
  }

  if (cType == LBM_CELL_VELOCITY_INLET) {
    jx = rho * uInletX;
    jy = rho * uInletY;
    jz = rho * uInletZ;
  } else if (cType == LBM_CELL_PRESSURE_OUT) {
    rho = 1.0;
  }

  double invRho = 1.0 / fmax(1e-12, rho);
  double ux = jx * invRho;
  double uy = jy * invRho;
  double uz = jz * invRho;
  double uSq = ux * ux + uy * uy + uz * uz;

  // 3. Equilibrium & 2nd-order non-equilibrium momentum flux tensor Pi^(1)
  double feq[19];
  double fneq[19];
  double pxx = 0.0, pyy = 0.0, pzz = 0.0;
  double pxy = 0.0, pxz = 0.0, pyz = 0.0;

  for (int i = 0; i < 19; ++i) {
    double cx = (double)D3Q19_CX[i];
    double cy = (double)D3Q19_CY[i];
    double cz = (double)D3Q19_CZ[i];
    double cu = cx * ux + cy * uy + cz * uz;
    double eq = D3Q19_W[i] * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * uSq);
    double neq = fLoc[i] - eq;
    feq[i] = eq;
    fneq[i] = neq;

    pxx += cx * cx * neq;
    pyy += cy * cy * neq;
    pzz += cz * cz * neq;
    pxy += cx * cy * neq;
    pxz += cx * cz * neq;
    pyz += cy * cz * neq;
  }

  // 4. Effective relaxation time: Smagorinsky LES + Spalding WMLES wall eddy viscosity
  double tauEff = tau;
  if (useLES != 0 || useWMLES != 0) {
    double qNorm = sqrt(
        pxx * pxx + pyy * pyy + pzz * pzz +
        2.0 * (pxy * pxy + pxz * pxz + pyz * pyz));
    double tauTurb = 0.5 * (sqrt(tau * tau + 18.0 * 1.4142135623730951 * csSq * qNorm * invRho) - tau);
    tauEff = tau + fmax(0.0, tauTurb);
  }

  double wallShearPa = 0.0;
  if (useWMLES != 0 && adjacentToSolid != 0) {
    double latToPhys = dx / dt;
    double uPhysMag = sqrt(uSq) * latToPhys;
    double nuPhys = (1.0 / 3.0) * fmax(1e-6, tau - 0.5) * ((dx * dx) / dt);
    double yWall = 0.5 * dx;
    double uTau = solve_spalding_utau_fp64(uPhysMag, yWall, nuPhys, kappa, lawOfWallB);
    wallShearPa = density * uTau * uTau;
    double nuWallPhys = kappa * uTau * yWall;
    double nuWallLat = nuWallPhys * (dt / (dx * dx));
    double tauWall = 0.5 + 3.0 * (nuPhys * (dt / (dx * dx)) + nuWallLat);
    tauEff = fmax(tauEff, tauWall);
  }

  double omegaEff = 1.0 / fmax(0.5005, tauEff);

  // 5. Collision: Hermite 2nd-order regularized or standard BGK
  if (useRegularized != 0) {
    for (int i = 0; i < 19; ++i) {
      double cx = (double)D3Q19_CX[i];
      double cy = (double)D3Q19_CY[i];
      double cz = (double)D3Q19_CZ[i];
      // H^(2)_i : Pi^(1) where H^(2)_{ab} = c_a c_b - c_s^2 delta_{ab}, c_s^2 = 1/3
      double qContr =
          (cx * cx - 1.0 / 3.0) * pxx +
          (cy * cy - 1.0 / 3.0) * pyy +
          (cz * cz - 1.0 / 3.0) * pzz +
          2.0 * (cx * cy * pxy + cx * cz * pxz + cy * cz * pyz);
      // f^(1)_i = (w_i / (2 * c_s^4)) * qContr = 4.5 * w_i * qContr
      double f1Reg = 4.5 * D3Q19_W[i] * qContr;
      fOutSoA[(long long)i * totalCells + cellIdx] = feq[i] + (1.0 - omegaEff) * f1Reg;
    }
  } else {
    for (int i = 0; i < 19; ++i) {
      fOutSoA[(long long)i * totalCells + cellIdx] = feq[i] + (1.0 - omegaEff) * fneq[i];
    }
  }

  // 6. Store macroscopic fields & atomic FP64 drag force accumulation
  double latToPhys = dx / dt;
  rhoOut[cellIdx] = rho;
  vxOut[cellIdx] = ux * latToPhys;
  vyOut[cellIdx] = uy * latToPhys;
  vzOut[cellIdx] = uz * latToPhys;
  if (wallShearOut != nullptr) {
    wallShearOut[cellIdx] = wallShearPa;
  }

  if (dragForceOut != nullptr && (cellFx != 0.0 || cellFy != 0.0 || cellFz != 0.0)) {
    double forceScale = density * (dx * dx * dx * dx) / (dt * dt);
    atomic_add_f64(&dragForceOut[0], cellFx * forceScale);
    atomic_add_f64(&dragForceOut[1], cellFy * forceScale);
    atomic_add_f64(&dragForceOut[2], cellFz * forceScale);
  }
}

extern "C" __global__ void lbm_d3q7_thermal_fp64(
    int nx,
    int ny,
    int nz,
    const unsigned int* __restrict__ cellTypes,
    const double* __restrict__ vxPhys,
    const double* __restrict__ vyPhys,
    const double* __restrict__ vzPhys,
    const double* __restrict__ gInSoA,
    double* __restrict__ gOutSoA,
    double* __restrict__ tempOut,
    double tauG,
    double dx,
    double dt,
    double ambientTempK,
    double wallTempK,
    double heatFluxW,
    int hasIsothermalWall) {
  int gx = (int)(blockIdx.x * blockDim.x + threadIdx.x);
  int gy = (int)(blockIdx.y * blockDim.y + threadIdx.y);
  int gz = (int)(blockIdx.z * blockDim.z + threadIdx.z);
  if (gx >= nx || gy >= ny || gz >= nz) {
    return;
  }

  long long totalCells = (long long)nx * (long long)ny * (long long)nz;
  long long cellIdx = (long long)gx + (long long)gy * nx + (long long)gz * nx * ny;
  unsigned int cType = cellTypes[cellIdx];

  if (cType == LBM_CELL_OBSTACLE_SOLID) {
    tempOut[cellIdx] = hasIsothermalWall != 0 ? wallTempK : ambientTempK;
    return;
  }
  if (cType == LBM_CELL_CHANNEL_WALL) {
    tempOut[cellIdx] = ambientTempK;
    return;
  }

  double gLoc[7];
  double temp = 0.0;
  for (int i = 0; i < 7; ++i) {
    int sx = gx - D3Q7_CX[i];
    int sy = gy - D3Q7_CY[i];
    int sz = gz - D3Q7_CZ[i];
    double pulled = 0.0;

    if (sx < 0 || sx >= nx || sy < 0 || sy >= ny || sz < 0 || sz >= nz) {
      if (sx >= nx && cType == LBM_CELL_PRESSURE_OUT) {
        pulled = gInSoA[(long long)i * totalCells + cellIdx];
      } else {
        int opp = D3Q7_OPP[i];
        pulled = gInSoA[(long long)opp * totalCells + cellIdx];
      }
    } else {
      long long upIdx = (long long)sx + (long long)sy * nx + (long long)sz * nx * ny;
      unsigned int upType = cellTypes[upIdx];
      if (upType == LBM_CELL_OBSTACLE_SOLID) {
        int opp = D3Q7_OPP[i];
        double gOutVal = gInSoA[(long long)opp * totalCells + cellIdx];
        if (hasIsothermalWall != 0) {
          // Anti-bounce-back Dirichlet isothermal wall BC
          pulled = 2.0 * D3Q7_W[i] * wallTempK - gOutVal;
        } else {
          // Neumann wall heat flux BC
          pulled = gOutVal + D3Q7_W[i] * heatFluxW * (dt / dx);
        }
      } else if (upType == LBM_CELL_CHANNEL_WALL) {
        int opp = D3Q7_OPP[i];
        pulled = gInSoA[(long long)opp * totalCells + cellIdx];
      } else {
        pulled = gInSoA[(long long)i * totalCells + upIdx];
      }
    }
    gLoc[i] = pulled;
    temp += pulled;
  }

  if (cType == LBM_CELL_VELOCITY_INLET) {
    temp = ambientTempK;
  }

  double physToLat = dt / dx;
  double ux = vxPhys[cellIdx] * physToLat;
  double uy = vyPhys[cellIdx] * physToLat;
  double uz = vzPhys[cellIdx] * physToLat;
  double omegaG = 1.0 / fmax(0.505, tauG);

  for (int i = 0; i < 7; ++i) {
    double cu = (double)D3Q7_CX[i] * ux + (double)D3Q7_CY[i] * uy + (double)D3Q7_CZ[i] * uz;
    // D3Q7 c_s^2 = 1/4 -> 1 / c_s^2 = 4.0
    double geq = D3Q7_W[i] * temp * (1.0 + 4.0 * cu);
    gOutSoA[(long long)i * totalCells + cellIdx] = gLoc[i] - omegaG * (gLoc[i] - geq);
  }

  tempOut[cellIdx] = temp;
}

// Compact 5-population halo pack for Cartesian face slices (axis: 0=X, 1=Y, 2=Z).
extern "C" __global__ void lbm_pack_halo5_fp64(
    int nx,
    int ny,
    int nz,
    int axis,
    int sliceIdx,
    int dir0,
    int dir1,
    int dir2,
    int dir3,
    int dir4,
    const double* __restrict__ fSoA,
    double* __restrict__ haloOut) {
  int u = (int)(blockIdx.x * blockDim.x + threadIdx.x);
  int v = (int)(blockIdx.y * blockDim.y + threadIdx.y);

  int x = 0, y = 0, z = 0;
  int uMax = 0, vMax = 0;
  if (axis == 0) {
    x = sliceIdx; y = u; z = v;
    uMax = ny; vMax = nz;
  } else if (axis == 1) {
    x = u; y = sliceIdx; z = v;
    uMax = nx; vMax = nz;
  } else {
    x = u; y = v; z = sliceIdx;
    uMax = nx; vMax = ny;
  }
  if (u >= uMax || v >= vMax) {
    return;
  }

  long long totalCells = (long long)nx * (long long)ny * (long long)nz;
  long long cellIdx = (long long)x + (long long)y * nx + (long long)z * nx * ny;
  long long outBase = ((long long)u + (long long)v * uMax) * 5;

  haloOut[outBase + 0] = fSoA[(long long)dir0 * totalCells + cellIdx];
  haloOut[outBase + 1] = fSoA[(long long)dir1 * totalCells + cellIdx];
  haloOut[outBase + 2] = fSoA[(long long)dir2 * totalCells + cellIdx];
  haloOut[outBase + 3] = fSoA[(long long)dir3 * totalCells + cellIdx];
  haloOut[outBase + 4] = fSoA[(long long)dir4 * totalCells + cellIdx];
}

// Compact 5-population halo unpack into ghost face slice (axis: 0=X, 1=Y, 2=Z).
extern "C" __global__ void lbm_unpack_halo5_fp64(
    int nx,
    int ny,
    int nz,
    int axis,
    int ghostSliceIdx,
    int dir0,
    int dir1,
    int dir2,
    int dir3,
    int dir4,
    const double* __restrict__ haloIn,
    double* __restrict__ fSoA) {
  int u = (int)(blockIdx.x * blockDim.x + threadIdx.x);
  int v = (int)(blockIdx.y * blockDim.y + threadIdx.y);

  int x = 0, y = 0, z = 0;
  int uMax = 0, vMax = 0;
  if (axis == 0) {
    x = ghostSliceIdx; y = u; z = v;
    uMax = ny; vMax = nz;
  } else if (axis == 1) {
    x = u; y = ghostSliceIdx; z = v;
    uMax = nx; vMax = nz;
  } else {
    x = u; y = v; z = ghostSliceIdx;
    uMax = nx; vMax = ny;
  }
  if (u >= uMax || v >= vMax) {
    return;
  }

  long long totalCells = (long long)nx * (long long)ny * (long long)nz;
  long long cellIdx = (long long)x + (long long)y * nx + (long long)z * nx * ny;
  long long inBase = ((long long)u + (long long)v * uMax) * 5;

  fSoA[(long long)dir0 * totalCells + cellIdx] = haloIn[inBase + 0];
  fSoA[(long long)dir1 * totalCells + cellIdx] = haloIn[inBase + 1];
  fSoA[(long long)dir2 * totalCells + cellIdx] = haloIn[inBase + 2];
  fSoA[(long long)dir3 * totalCells + cellIdx] = haloIn[inBase + 3];
  fSoA[(long long)dir4 * totalCells + cellIdx] = haloIn[inBase + 4];
}
