// SPDX-License-Identifier: AGPL-3.0-or-later

import { DEFAULT_GAMMA, MIN_DENSITY, MIN_PRESSURE } from "./compressible-arena.js";
import { computeHllcFlux } from "./compressible-fvm.js";

export type DgPolynomialOrder = 1 | 2 | 3;
export type DgFluxType = "rusanov" | "hllc";
export type DgBoundaryType = "periodic" | "extrapolation";

export interface CompressibleDgConfig {
  /** Number of DG elements in X. */
  nx: number;
  /** Number of DG elements in Y (default 1; if ny > 1 or nz > 1, 3D tensor-product mode is used). */
  ny?: number | undefined;
  /** Number of DG elements in Z (default 1). */
  nz?: number | undefined;
  /** Element length in X. */
  dx: number;
  /** Element length in Y (defaults to dx). */
  dy?: number | undefined;
  /** Element length in Z (defaults to dx). */
  dz?: number | undefined;
  /** Polynomial degree p in {1, 2, 3}. */
  order: DgPolynomialOrder;
  /** Ideal-gas ratio of specific heats (default 1.4). */
  gamma?: number | undefined;
  /** Numerical interface flux (default "rusanov"). */
  flux?: DgFluxType | undefined;
  /** Boundary condition along X (default "periodic"). */
  bcX?: DgBoundaryType | undefined;
  /** Boundary condition along Y (default "periodic"). */
  bcY?: DgBoundaryType | undefined;
  /** Boundary condition along Z (default "periodic"). */
  bcZ?: DgBoundaryType | undefined;
  /** Base CFL number (automatically scaled by 1 / (2p + 1), default 0.3). */
  cfl?: number | undefined;
}

export interface DgPrimitiveInit {
  rho: number;
  u: number;
  v?: number | undefined;
  w?: number | undefined;
  p: number;
}

/**
 * Exact Gauss-Lobatto-Legendre (GLL) quadrature nodes on [-1, 1] and weights
 * for polynomial orders p = 1, 2, 3.
 */
export function getGllNodesAndWeights(order: DgPolynomialOrder): {
  nodes: Float64Array;
  weights: Float64Array;
} {
  if (order === 1) {
    return {
      nodes: new Float64Array([-1.0, 1.0]),
      weights: new Float64Array([1.0, 1.0]),
    };
  }
  if (order === 2) {
    return {
      nodes: new Float64Array([-1.0, 0.0, 1.0]),
      weights: new Float64Array([1.0 / 3.0, 4.0 / 3.0, 1.0 / 3.0]),
    };
  }
  const s = 1.0 / Math.sqrt(5.0);
  return {
    nodes: new Float64Array([-1.0, -s, s, 1.0]),
    weights: new Float64Array([1.0 / 6.0, 5.0 / 6.0, 5.0 / 6.0, 1.0 / 6.0]),
  };
}

/**
 * Build row-major N x N Lagrange differentiation matrix `D[i * N + j] = l_j'(xi_i)`
 * on nodal points `nodes` using exact barycentric weights.
 */
export function buildLagrangeDiffMatrix(nodes: Float64Array): Float64Array {
  const n = nodes.length;
  const bary = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    let prod = 1.0;
    const xj = nodes[j] ?? 0;
    for (let k = 0; k < n; k++) {
      if (k !== j) {
        prod *= xj - (nodes[k] ?? 0);
      }
    }
    bary[j] = 1.0 / prod;
  }

  const D = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    let rowSum = 0.0;
    const xi = nodes[i] ?? 0;
    const bi = bary[i] ?? 1.0;
    for (let j = 0; j < n; j++) {
      if (i !== j) {
        const val = (bary[j] ?? 1.0) / (bi * (xi - (nodes[j] ?? 0)));
        D[i * n + j] = val;
        rowSum += val;
      }
    }
    D[i * n + i] = -rowSum;
  }
  return D;
}

/** Compute physical Euler flux vector F(U) along unit normal (nx, ny, nz). */
function computeEulerFlux(u: Float64Array, nx: number, ny: number, nz: number, gamma: number, out: Float64Array): void {
  const rho = Math.max(u[0] ?? MIN_DENSITY, MIN_DENSITY);
  const vx = (u[1] ?? 0) / rho;
  const vy = (u[2] ?? 0) / rho;
  const vz = (u[3] ?? 0) / rho;
  const rE = u[4] ?? 0;
  const p = Math.max((gamma - 1.0) * (rE - 0.5 * rho * (vx * vx + vy * vy + vz * vz)), MIN_PRESSURE);
  const qn = vx * nx + vy * ny + vz * nz;

  out[0] = rho * qn;
  out[1] = rho * vx * qn + p * nx;
  out[2] = rho * vy * qn + p * ny;
  out[3] = rho * vz * qn + p * nz;
  out[4] = (rE + p) * qn;
}

/**
 * Rusanov (local Lax-Friedrichs) numerical interface flux along unit normal `(nx, ny, nz)`.
 */
export function computeRusanovFlux(
  uL: Float64Array,
  uR: Float64Array,
  nx: number,
  ny: number,
  nz: number,
  gamma: number,
  out: Float64Array,
): void {
  const gm1 = gamma - 1.0;

  const rhoL = Math.max(uL[0] ?? MIN_DENSITY, MIN_DENSITY);
  const uLx = (uL[1] ?? 0) / rhoL;
  const uLy = (uL[2] ?? 0) / rhoL;
  const uLz = (uL[3] ?? 0) / rhoL;
  const rEL = uL[4] ?? 0;
  const pL = Math.max(gm1 * (rEL - 0.5 * rhoL * (uLx * uLx + uLy * uLy + uLz * uLz)), MIN_PRESSURE);
  const cL = Math.sqrt((gamma * pL) / rhoL);
  const qnL = uLx * nx + uLy * ny + uLz * nz;

  const rhoR = Math.max(uR[0] ?? MIN_DENSITY, MIN_DENSITY);
  const uRx = (uR[1] ?? 0) / rhoR;
  const uRy = (uR[2] ?? 0) / rhoR;
  const uRz = (uR[3] ?? 0) / rhoR;
  const rER = uR[4] ?? 0;
  const pR = Math.max(gm1 * (rER - 0.5 * rhoR * (uRx * uRx + uRy * uRy + uRz * uRz)), MIN_PRESSURE);
  const cR = Math.sqrt((gamma * pR) / rhoR);
  const qnR = uRx * nx + uRy * ny + uRz * nz;

  const lambdaMax = Math.max(Math.abs(qnL) + cL, Math.abs(qnR) + cR);

  const fL0 = rhoL * qnL;
  const fL1 = rhoL * uLx * qnL + pL * nx;
  const fL2 = rhoL * uLy * qnL + pL * ny;
  const fL3 = rhoL * uLz * qnL + pL * nz;
  const fL4 = (rEL + pL) * qnL;

  const fR0 = rhoR * qnR;
  const fR1 = rhoR * uRx * qnR + pR * nx;
  const fR2 = rhoR * uRy * qnR + pR * ny;
  const fR3 = rhoR * uRz * qnR + pR * nz;
  const fR4 = (rER + pR) * qnR;

  out[0] = 0.5 * (fL0 + fR0) - 0.5 * lambdaMax * (rhoR - rhoL);
  out[1] = 0.5 * (fL1 + fR1) - 0.5 * lambdaMax * ((uR[1] ?? 0) - (uL[1] ?? 0));
  out[2] = 0.5 * (fL2 + fR2) - 0.5 * lambdaMax * ((uR[2] ?? 0) - (uL[2] ?? 0));
  out[3] = 0.5 * (fL3 + fR3) - 0.5 * lambdaMax * ((uR[3] ?? 0) - (uL[3] ?? 0));
  out[4] = 0.5 * (fL4 + fR4) - 0.5 * lambdaMax * (rER - rEL);
}

/**
 * 1D / 3D Nodal Discontinuous Galerkin (p = 1, 2, 3) compressible Euler solver
 * on Gauss-Lobatto-Legendre (GLL) tensor-product elements with Lagrange
 * differentiation matrices, Rusanov / HLLC numerical interface fluxes, and
 * explicit SSP-RK3 time integration.
 */
export class CompressibleDgSolver {
  public readonly nx: number;
  public readonly ny: number;
  public readonly nz: number;
  public readonly dx: number;
  public readonly dy: number;
  public readonly dz: number;
  public readonly order: DgPolynomialOrder;
  public readonly is3D: boolean;
  public readonly n1: number;
  public readonly nyNodes: number;
  public readonly nzNodes: number;
  public readonly nodesPerElement: number;
  public readonly totalDofs: number;
  public readonly nVars: number = 5;
  public readonly gamma: number;
  public readonly fluxType: DgFluxType;
  public readonly bcX: DgBoundaryType;
  public readonly bcY: DgBoundaryType;
  public readonly bcZ: DgBoundaryType;
  public readonly cfl: number;

  public readonly gllNodes: Float64Array;
  public readonly gllWeights: Float64Array;
  public readonly diffMatrix: Float64Array;

  /** SoA conserved state buffer `[varIdx * totalDofs + dofIdx]`. */
  public readonly state: Float64Array;

  private readonly u0: Float64Array;
  private readonly u1: Float64Array;
  private readonly rhs: Float64Array;
  private readonly lineFlux: Float64Array;
  private readonly tmpL: Float64Array;
  private readonly tmpR: Float64Array;
  private readonly tmpF: Float64Array;
  private readonly tmpNumFluxL: Float64Array;
  private readonly tmpNumFluxR: Float64Array;

  constructor(config: CompressibleDgConfig) {
    this.nx = config.nx;
    this.ny = config.ny ?? 1;
    this.nz = config.nz ?? 1;
    this.dx = config.dx;
    this.dy = config.dy ?? config.dx;
    this.dz = config.dz ?? config.dx;
    this.order = config.order;
    this.gamma = config.gamma ?? DEFAULT_GAMMA;
    this.fluxType = config.flux ?? "rusanov";
    this.bcX = config.bcX ?? "periodic";
    this.bcY = config.bcY ?? "periodic";
    this.bcZ = config.bcZ ?? "periodic";
    this.cfl = config.cfl ?? 0.3;

    this.is3D = this.ny > 1 || this.nz > 1;
    const { nodes, weights } = getGllNodesAndWeights(this.order);
    this.gllNodes = nodes;
    this.gllWeights = weights;
    this.diffMatrix = buildLagrangeDiffMatrix(nodes);

    this.n1 = this.order + 1;
    this.nyNodes = this.is3D ? this.n1 : 1;
    this.nzNodes = this.is3D ? this.n1 : 1;
    this.nodesPerElement = this.n1 * this.nyNodes * this.nzNodes;
    this.totalDofs = this.nx * this.ny * this.nz * this.nodesPerElement;

    const totalLen = this.nVars * this.totalDofs;
    this.state = new Float64Array(totalLen);
    this.u0 = new Float64Array(totalLen);
    this.u1 = new Float64Array(totalLen);
    this.rhs = new Float64Array(totalLen);

    this.lineFlux = new Float64Array(this.nVars * this.n1);
    this.tmpL = new Float64Array(this.nVars);
    this.tmpR = new Float64Array(this.nVars);
    this.tmpF = new Float64Array(this.nVars);
    this.tmpNumFluxL = new Float64Array(this.nVars);
    this.tmpNumFluxR = new Float64Array(this.nVars);
  }

  /** Compute global DOF index for element (ex, ey, ez) and local GLL node (ix, iy, iz). */
  public dofIndex(ex: number, ey: number, ez: number, ix: number, iy: number = 0, iz: number = 0): number {
    const elemIdx = (ez * this.ny + ey) * this.nx + ex;
    const locIdx = (iz * this.nyNodes + iy) * this.n1 + ix;
    return elemIdx * this.nodesPerElement + locIdx;
  }

  /** Initialize all GLL DOFs from a spatial primitive state callback. */
  public initFromFunction(fn: (x: number, y: number, z: number) => DgPrimitiveInit): void {
    const invGm1 = 1.0 / (this.gamma - 1.0);
    const td = this.totalDofs;

    for (let ez = 0; ez < this.nz; ez++) {
      for (let ey = 0; ey < this.ny; ey++) {
        for (let ex = 0; ex < this.nx; ex++) {
          for (let iz = 0; iz < this.nzNodes; iz++) {
            const z = this.is3D ? (ez + 0.5 * (1.0 + (this.gllNodes[iz] ?? 0))) * this.dz : 0.5 * this.dz;
            for (let iy = 0; iy < this.nyNodes; iy++) {
              const y = this.is3D ? (ey + 0.5 * (1.0 + (this.gllNodes[iy] ?? 0))) * this.dy : 0.5 * this.dy;
              for (let ix = 0; ix < this.n1; ix++) {
                const x = (ex + 0.5 * (1.0 + (this.gllNodes[ix] ?? 0))) * this.dx;
                const s = fn(x, y, z);
                const rho = Math.max(s.rho, MIN_DENSITY);
                const u = s.u;
                const v = s.v ?? 0.0;
                const w = s.w ?? 0.0;
                const p = Math.max(s.p, MIN_PRESSURE);
                const dof = this.dofIndex(ex, ey, ez, ix, iy, iz);
                this.state[0 * td + dof] = rho;
                this.state[1 * td + dof] = rho * u;
                this.state[2 * td + dof] = rho * v;
                this.state[3 * td + dof] = rho * w;
                this.state[4 * td + dof] = p * invGm1 + 0.5 * rho * (u * u + v * v + w * w);
              }
            }
          }
        }
      }
    }
  }

  /** Compute stable DG CFL timestep scaled by 1 / (2p + 1). */
  public computeCflTimestep(state: Float64Array = this.state): number {
    const td = this.totalDofs;
    const gm1 = this.gamma - 1.0;
    const invDx = 1.0 / this.dx;
    const invDy = this.is3D && this.ny > 1 ? 1.0 / this.dy : 0.0;
    const invDz = this.is3D && this.nz > 1 ? 1.0 / this.dz : 0.0;

    let maxRate = 1e-12;
    for (let dof = 0; dof < td; dof++) {
      const rho = Math.max(state[dof] ?? MIN_DENSITY, MIN_DENSITY);
      const u = (state[td + dof] ?? 0) / rho;
      const v = (state[2 * td + dof] ?? 0) / rho;
      const w = (state[3 * td + dof] ?? 0) / rho;
      const rE = state[4 * td + dof] ?? 0;
      const p = Math.max(gm1 * (rE - 0.5 * rho * (u * u + v * v + w * w)), MIN_PRESSURE);
      const c = Math.sqrt((this.gamma * p) / rho);
      const rate = (Math.abs(u) + c) * invDx + (Math.abs(v) + c) * invDy + (Math.abs(w) + c) * invDz;
      if (rate > maxRate) maxRate = rate;
    }

    return this.cfl / ((2 * this.order + 1) * maxRate);
  }

  private evalInterfaceFlux(
    uL: Float64Array,
    uR: Float64Array,
    nxDir: number,
    nyDir: number,
    nzDir: number,
    out: Float64Array,
  ): void {
    if (this.fluxType === "hllc") {
      computeHllcFlux(uL, uR, nxDir, nyDir, nzDir, this.gamma, out);
    } else {
      computeRusanovFlux(uL, uR, nxDir, nyDir, nzDir, this.gamma, out);
    }
  }

  private loadDofState(state: Float64Array, dof: number, out: Float64Array): void {
    const td = this.totalDofs;
    for (let m = 0; m < 5; m++) {
      out[m] = state[m * td + dof] ?? 0.0;
    }
  }

  /** Compute strong-form Nodal DG semi-discrete residual `dU/dt = R(U)`. */
  public computeResidual(state: Float64Array, rhs: Float64Array): void {
    rhs.fill(0.0);
    const td = this.totalDofs;
    const n1 = this.n1;
    const last = n1 - 1;
    const invW0 = 1.0 / (this.gllWeights[0] ?? 1.0);
    const invWn = 1.0 / (this.gllWeights[last] ?? 1.0);
    const D = this.diffMatrix;

    // X-direction volume & surface terms
    const scaleX = -2.0 / this.dx;
    for (let ez = 0; ez < this.nz; ez++) {
      for (let ey = 0; ey < this.ny; ey++) {
        for (let ex = 0; ex < this.nx; ex++) {
          const exLeft = ex > 0 ? ex - 1 : this.bcX === "periodic" ? this.nx - 1 : -1;
          const exRight = ex < this.nx - 1 ? ex + 1 : this.bcX === "periodic" ? 0 : -1;

          for (let iz = 0; iz < this.nzNodes; iz++) {
            for (let iy = 0; iy < this.nyNodes; iy++) {
              // Physical fluxes along this 1D line of n1 nodes
              for (let ix = 0; ix < n1; ix++) {
                const dof = this.dofIndex(ex, ey, ez, ix, iy, iz);
                this.loadDofState(state, dof, this.tmpL);
                computeEulerFlux(this.tmpL, 1.0, 0.0, 0.0, this.gamma, this.tmpF);
                for (let m = 0; m < 5; m++) {
                  this.lineFlux[m * n1 + ix] = this.tmpF[m] ?? 0.0;
                }
              }

              // Left interface flux (at ix = 0)
              const dof0 = this.dofIndex(ex, ey, ez, 0, iy, iz);
              this.loadDofState(state, dof0, this.tmpR);
              if (exLeft >= 0) {
                const dofL = this.dofIndex(exLeft, ey, ez, last, iy, iz);
                this.loadDofState(state, dofL, this.tmpL);
              } else {
                this.tmpL.set(this.tmpR);
              }
              this.evalInterfaceFlux(this.tmpL, this.tmpR, 1.0, 0.0, 0.0, this.tmpNumFluxL);

              // Right interface flux (at ix = last)
              const dofLast = this.dofIndex(ex, ey, ez, last, iy, iz);
              this.loadDofState(state, dofLast, this.tmpL);
              if (exRight >= 0) {
                const dofR = this.dofIndex(exRight, ey, ez, 0, iy, iz);
                this.loadDofState(state, dofR, this.tmpR);
              } else {
                this.tmpR.set(this.tmpL);
              }
              this.evalInterfaceFlux(this.tmpL, this.tmpR, 1.0, 0.0, 0.0, this.tmpNumFluxR);

              // Assemble strong-form derivative + surface penalty
              for (let ix = 0; ix < n1; ix++) {
                const dof = this.dofIndex(ex, ey, ez, ix, iy, iz);
                const rowOff = ix * n1;
                for (let m = 0; m < 5; m++) {
                  const fBase = m * n1;
                  let dF = 0.0;
                  for (let j = 0; j < n1; j++) {
                    dF += (D[rowOff + j] ?? 0.0) * (this.lineFlux[fBase + j] ?? 0.0);
                  }
                  if (ix === 0) {
                    dF -= invW0 * ((this.tmpNumFluxL[m] ?? 0.0) - (this.lineFlux[fBase] ?? 0.0));
                  }
                  if (ix === last) {
                    dF += invWn * ((this.tmpNumFluxR[m] ?? 0.0) - (this.lineFlux[fBase + last] ?? 0.0));
                  }
                  rhs[m * td + dof] = (rhs[m * td + dof] ?? 0.0) + scaleX * dF;
                }
              }
            }
          }
        }
      }
    }

    // Y-direction volume & surface terms (3D mode)
    if (this.is3D && this.ny > 1) {
      const scaleY = -2.0 / this.dy;
      for (let ez = 0; ez < this.nz; ez++) {
        for (let ey = 0; ey < this.ny; ey++) {
          const eyLeft = ey > 0 ? ey - 1 : this.bcY === "periodic" ? this.ny - 1 : -1;
          const eyRight = ey < this.ny - 1 ? ey + 1 : this.bcY === "periodic" ? 0 : -1;

          for (let ex = 0; ex < this.nx; ex++) {
            for (let iz = 0; iz < this.nzNodes; iz++) {
              for (let ix = 0; ix < n1; ix++) {
                for (let iy = 0; iy < n1; iy++) {
                  const dof = this.dofIndex(ex, ey, ez, ix, iy, iz);
                  this.loadDofState(state, dof, this.tmpL);
                  computeEulerFlux(this.tmpL, 0.0, 1.0, 0.0, this.gamma, this.tmpF);
                  for (let m = 0; m < 5; m++) {
                    this.lineFlux[m * n1 + iy] = this.tmpF[m] ?? 0.0;
                  }
                }

                const dof0 = this.dofIndex(ex, ey, ez, ix, 0, iz);
                this.loadDofState(state, dof0, this.tmpR);
                if (eyLeft >= 0) {
                  this.loadDofState(state, this.dofIndex(ex, eyLeft, ez, ix, last, iz), this.tmpL);
                } else {
                  this.tmpL.set(this.tmpR);
                }
                this.evalInterfaceFlux(this.tmpL, this.tmpR, 0.0, 1.0, 0.0, this.tmpNumFluxL);

                const dofLast = this.dofIndex(ex, ey, ez, ix, last, iz);
                this.loadDofState(state, dofLast, this.tmpL);
                if (eyRight >= 0) {
                  this.loadDofState(state, this.dofIndex(ex, eyRight, ez, ix, 0, iz), this.tmpR);
                } else {
                  this.tmpR.set(this.tmpL);
                }
                this.evalInterfaceFlux(this.tmpL, this.tmpR, 0.0, 1.0, 0.0, this.tmpNumFluxR);

                for (let iy = 0; iy < n1; iy++) {
                  const dof = this.dofIndex(ex, ey, ez, ix, iy, iz);
                  const rowOff = iy * n1;
                  for (let m = 0; m < 5; m++) {
                    const fBase = m * n1;
                    let dF = 0.0;
                    for (let j = 0; j < n1; j++) {
                      dF += (D[rowOff + j] ?? 0.0) * (this.lineFlux[fBase + j] ?? 0.0);
                    }
                    if (iy === 0) {
                      dF -= invW0 * ((this.tmpNumFluxL[m] ?? 0.0) - (this.lineFlux[fBase] ?? 0.0));
                    }
                    if (iy === last) {
                      dF += invWn * ((this.tmpNumFluxR[m] ?? 0.0) - (this.lineFlux[fBase + last] ?? 0.0));
                    }
                    rhs[m * td + dof] = (rhs[m * td + dof] ?? 0.0) + scaleY * dF;
                  }
                }
              }
            }
          }
        }
      }
    }

    // Z-direction volume & surface terms (3D mode)
    if (this.is3D && this.nz > 1) {
      const scaleZ = -2.0 / this.dz;
      for (let ez = 0; ez < this.nz; ez++) {
        const ezLeft = ez > 0 ? ez - 1 : this.bcZ === "periodic" ? this.nz - 1 : -1;
        const ezRight = ez < this.nz - 1 ? ez + 1 : this.bcZ === "periodic" ? 0 : -1;

        for (let ey = 0; ey < this.ny; ey++) {
          for (let ex = 0; ex < this.nx; ex++) {
            for (let iy = 0; iy < this.nyNodes; iy++) {
              for (let ix = 0; ix < n1; ix++) {
                for (let iz = 0; iz < n1; iz++) {
                  const dof = this.dofIndex(ex, ey, ez, ix, iy, iz);
                  this.loadDofState(state, dof, this.tmpL);
                  computeEulerFlux(this.tmpL, 0.0, 0.0, 1.0, this.gamma, this.tmpF);
                  for (let m = 0; m < 5; m++) {
                    this.lineFlux[m * n1 + iz] = this.tmpF[m] ?? 0.0;
                  }
                }

                const dof0 = this.dofIndex(ex, ey, ez, ix, iy, 0);
                this.loadDofState(state, dof0, this.tmpR);
                if (ezLeft >= 0) {
                  this.loadDofState(state, this.dofIndex(ex, ey, ezLeft, ix, iy, last), this.tmpL);
                } else {
                  this.tmpL.set(this.tmpR);
                }
                this.evalInterfaceFlux(this.tmpL, this.tmpR, 0.0, 0.0, 1.0, this.tmpNumFluxL);

                const dofLast = this.dofIndex(ex, ey, ez, ix, iy, last);
                this.loadDofState(state, dofLast, this.tmpL);
                if (ezRight >= 0) {
                  this.loadDofState(state, this.dofIndex(ex, ey, ezRight, ix, iy, 0), this.tmpR);
                } else {
                  this.tmpR.set(this.tmpL);
                }
                this.evalInterfaceFlux(this.tmpL, this.tmpR, 0.0, 0.0, 1.0, this.tmpNumFluxR);

                for (let iz = 0; iz < n1; iz++) {
                  const dof = this.dofIndex(ex, ey, ez, ix, iy, iz);
                  const rowOff = iz * n1;
                  for (let m = 0; m < 5; m++) {
                    const fBase = m * n1;
                    let dF = 0.0;
                    for (let j = 0; j < n1; j++) {
                      dF += (D[rowOff + j] ?? 0.0) * (this.lineFlux[fBase + j] ?? 0.0);
                    }
                    if (iz === 0) {
                      dF -= invW0 * ((this.tmpNumFluxL[m] ?? 0.0) - (this.lineFlux[fBase] ?? 0.0));
                    }
                    if (iz === last) {
                      dF += invWn * ((this.tmpNumFluxR[m] ?? 0.0) - (this.lineFlux[fBase + last] ?? 0.0));
                    }
                    rhs[m * td + dof] = (rhs[m * td + dof] ?? 0.0) + scaleZ * dF;
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  /** Advance one explicit 3-stage SSP-RK3 step. */
  public stepSspRk3(dtOverride?: number | undefined): number {
    const state = this.state;
    const n = state.length;
    const dt = dtOverride ?? this.computeCflTimestep(state);

    this.u0.set(state);

    this.computeResidual(this.u0, this.rhs);
    for (let i = 0; i < n; i++) {
      this.u1[i] = (this.u0[i] ?? 0) + dt * (this.rhs[i] ?? 0);
    }

    this.computeResidual(this.u1, this.rhs);
    for (let i = 0; i < n; i++) {
      state[i] = 0.75 * (this.u0[i] ?? 0) + 0.25 * (this.u1[i] ?? 0) + 0.25 * dt * (this.rhs[i] ?? 0);
    }

    this.computeResidual(state, this.rhs);
    for (let i = 0; i < n; i++) {
      state[i] =
        (1.0 / 3.0) * (this.u0[i] ?? 0) + (2.0 / 3.0) * (state[i] ?? 0) + (2.0 / 3.0) * dt * (this.rhs[i] ?? 0);
    }

    return dt;
  }

  /** Advance explicitly via SSP-RK3 until physical time `tEnd`. */
  public advanceToTime(
    tEnd: number,
    maxSteps: number = 200000,
    dtFixed?: number | undefined,
  ): { time: number; steps: number } {
    let time = 0.0;
    let steps = 0;
    while (time < tEnd - 1e-14 && steps < maxSteps) {
      let dt = dtFixed ?? this.computeCflTimestep();
      if (time + dt > tEnd) dt = tEnd - time;
      this.stepSspRk3(dt);
      time += dt;
      steps++;
    }
    return { time, steps };
  }

  /** Compute GLL-quadrature L2 error of conserved variable `varIdx` (default 0 = rho) against an exact function. */
  public computeL2Error(exactFn: (x: number, y: number, z: number) => number, varIdx: number = 0): number {
    const td = this.totalDofs;
    const base = varIdx * td;
    const jac = this.is3D ? (this.dx * this.dy * this.dz) / 8.0 : this.dx / 2.0;

    let err2 = 0.0;
    for (let ez = 0; ez < this.nz; ez++) {
      for (let ey = 0; ey < this.ny; ey++) {
        for (let ex = 0; ex < this.nx; ex++) {
          for (let iz = 0; iz < this.nzNodes; iz++) {
            const wz = this.is3D ? (this.gllWeights[iz] ?? 1.0) : 1.0;
            const z = this.is3D ? (ez + 0.5 * (1.0 + (this.gllNodes[iz] ?? 0))) * this.dz : 0.5 * this.dz;
            for (let iy = 0; iy < this.nyNodes; iy++) {
              const wy = this.is3D ? (this.gllWeights[iy] ?? 1.0) : 1.0;
              const y = this.is3D ? (ey + 0.5 * (1.0 + (this.gllNodes[iy] ?? 0))) * this.dy : 0.5 * this.dy;
              for (let ix = 0; ix < this.n1; ix++) {
                const wx = this.gllWeights[ix] ?? 1.0;
                const x = (ex + 0.5 * (1.0 + (this.gllNodes[ix] ?? 0))) * this.dx;
                const dof = this.dofIndex(ex, ey, ez, ix, iy, iz);
                const diff = (this.state[base + dof] ?? 0.0) - exactFn(x, y, z);
                err2 += jac * wx * wy * wz * diff * diff;
              }
            }
          }
        }
      }
    }
    return Math.sqrt(err2);
  }
}
