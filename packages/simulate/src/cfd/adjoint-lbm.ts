// SPDX-License-Identifier: AGPL-3.0-or-later

import { lbfgsbSolve } from "../optimizer/solvers/lbfgsb.js";
import { D3Q19_CX as CX, D3Q19_CY as CY, D3Q19_CZ as CZ, D3Q19_OPP as OPP, D3Q19_WEIGHTS as W } from "./cfd-arena.js";
import { LbmCellType, type LbmGridConfig } from "./lbm-types.js";

export interface AdjointLbmOptions {
  /** Number of primal/adjoint timesteps (default: 10). */
  numSteps?: number | undefined;
  /** Maximum Brinkman solid resistance factor d_max in (0, 1] (default: 0.9). */
  maxResistance?: number | undefined;
  /** Weight on Darcy viscous dissipation / drag power objective (default: 1.0). */
  dragPowerWeight?: number | undefined;
}

export interface AdjointEvaluationResult {
  /** Scalar aerodynamic objective J(alpha) (Darcy drag power / dissipation). */
  objective: number;
  /** Exact discrete adjoint gradient dJ/d(alpha_i) for every cell i in [0, totalCells). */
  gradient: Float64Array;
  /** Per-cell adjoint sensitivity magnitude |dJ/d(alpha_i)| usable as a goal-oriented AMR indicator. */
  sensitivityField: Float32Array;
  /** Final primal velocity magnitude field [nx * ny * nz]. */
  velocityMagnitude: Float32Array;
}

export interface AdjointShapeOptimizationResult {
  /** Optimized full-grid Brinkman porosity field alpha in [0, 1]. */
  alpha: Float64Array;
  /** Initial objective J(alpha_0). */
  initialObjective: number;
  /** Final objective J(alpha_opt). */
  finalObjective: number;
  /** Number of L-BFGS-B iterations performed. */
  iterations: number;
  /** Whether L-BFGS-B reached projected-gradient convergence tolerance. */
  converged: boolean;
}

/**
 * Exact Reverse-Mode Discrete Adjoint D3Q19 Lattice Boltzmann Solver.
 *
 * Uses the smooth Brinkman porosity formulation (design variable alpha_i in [0, 1])
 * where each cell applies momentum damping factor (1 - d_max * alpha_i) to macroscopic velocity.
 * Checkpoints primal distributions over the horizon and performs a single exact reverse-mode
 * sweep to compute sensitivities dJ/d(alpha_i) for gradient-based MDAO (L-BFGS-B / IPOPT)
 * and goal-oriented Adaptive Mesh Refinement (AMR).
 */
export class AdjointLbmSolver {
  public readonly config: LbmGridConfig;
  public readonly cellTypes: Uint8Array | Uint32Array;
  public readonly totalCells: number;
  public readonly options: {
    numSteps: number;
    maxResistance: number;
    dragPowerWeight: number;
  };

  constructor(config: LbmGridConfig, cellTypes: Uint8Array | Uint32Array, options?: AdjointLbmOptions) {
    this.config = config;
    this.cellTypes = cellTypes;
    this.totalCells = config.nx * config.ny * config.nz;
    this.options = {
      numSteps: options?.numSteps ?? 10,
      maxResistance: options?.maxResistance ?? 0.9,
      dragPowerWeight: options?.dragPowerWeight ?? 1.0,
    };
  }

  /**
   * Evaluates the scalar aerodynamic objective J(alpha) via primal forward propagation.
   * When computeGradient is true, executes the exact reverse-mode adjoint pass in O(T * N).
   */
  public evaluate(alpha: Float64Array | Float32Array, computeGradient = true): AdjointEvaluationResult {
    const { nx, ny, nz, dx, dt, tau } = this.config;
    const total = this.totalCells;
    const omega = 1.0 / tau;
    const steps = this.options.numSteps;
    const dMax = this.options.maxResistance;
    const wPower = this.options.dragPowerWeight;

    const inletV = this.config.inletVelocity ?? [1.0, 0, 0];
    const uInX = inletV[0] * (dt / dx);
    const uInY = inletV[1] * (dt / dx);
    const uInZ = inletV[2] * (dt / dx);

    // Checkpoints of pre-collision f at each timestep t = 0..steps
    const fHist: Float64Array[] = [];
    const fInit = new Float64Array(total * 19);

    for (let idx = 0; idx < total; idx++) {
      const cType = this.cellTypes[idx];
      const isSolid = cType === LbmCellType.ObstacleSolid || cType === LbmCellType.ChannelWall;
      const ux = isSolid ? 0.0 : uInX;
      const uy = isSolid ? 0.0 : uInY;
      const uz = isSolid ? 0.0 : uInZ;
      const uSq = ux * ux + uy * uy + uz * uz;
      for (let q = 0; q < 19; q++) {
        const cu = CX[q]! * ux + CY[q]! * uy + CZ[q]! * uz;
        fInit[q * total + idx] = W[q]! * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * uSq);
      }
    }
    fHist.push(fInit);

    // Saved primal macroscopic states per step for exact reverse-mode differentiation
    const rhoHist: Float64Array[] = [];
    const uxRawHist: Float64Array[] = [];
    const uyRawHist: Float64Array[] = [];
    const uzRawHist: Float64Array[] = [];

    let objective = 0.0;

    // ── Forward Primal Pass ──────────────────────────────────────────────────
    for (let t = 0; t < steps; t++) {
      const fCur = fHist[t]!;
      const fPost = new Float64Array(total * 19);
      const fNext = new Float64Array(total * 19);
      const rhoArr = new Float64Array(total);
      const uxRawArr = new Float64Array(total);
      const uyRawArr = new Float64Array(total);
      const uzRawArr = new Float64Array(total);

      // Pass 1: Macroscopic recovery + Brinkman damping + BGK collision
      for (let idx = 0; idx < total; idx++) {
        const cType = this.cellTypes[idx];
        if (cType === LbmCellType.ObstacleSolid || cType === LbmCellType.ChannelWall) {
          for (let q = 0; q < 19; q++) fPost[q * total + idx] = fCur[q * total + idx]!;
          continue;
        }

        let rho = 0.0,
          jx = 0.0,
          jy = 0.0,
          jz = 0.0;
        for (let q = 0; q < 19; q++) {
          const fq = fCur[q * total + idx]!;
          rho += fq;
          jx += CX[q]! * fq;
          jy += CY[q]! * fq;
          jz += CZ[q]! * fq;
        }

        if (cType === LbmCellType.VelocityInlet) {
          jx = rho * uInX;
          jy = rho * uInY;
          jz = rho * uInZ;
        } else if (cType === LbmCellType.PressureOutlet) {
          rho = 1.0;
        }

        const invRho = 1.0 / Math.max(1e-8, rho);
        const uxRaw = jx * invRho;
        const uyRaw = jy * invRho;
        const uzRaw = jz * invRho;

        rhoArr[idx] = rho;
        uxRawArr[idx] = uxRaw;
        uyRawArr[idx] = uyRaw;
        uzRawArr[idx] = uzRaw;

        const damp = 1.0 - dMax * alpha[idx]!;
        const ux = damp * uxRaw;
        const uy = damp * uyRaw;
        const uz = damp * uzRaw;
        const uSq = ux * ux + uy * uy + uz * uz;

        // Objective contribution: Brinkman drag dissipation power J += wPower * dMax * alpha_i * |u_raw|^2
        const uRawSq = uxRaw * uxRaw + uyRaw * uyRaw + uzRaw * uzRaw;
        objective += wPower * dMax * alpha[idx]! * uRawSq;

        for (let q = 0; q < 19; q++) {
          const cu = CX[q]! * ux + CY[q]! * uy + CZ[q]! * uz;
          const feq = W[q]! * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * uSq);
          const fq = fCur[q * total + idx]!;
          fPost[q * total + idx] = fq - omega * (fq - feq);
        }
      }

      rhoHist.push(rhoArr);
      uxRawHist.push(uxRawArr);
      uyRawHist.push(uyRawArr);
      uzRawHist.push(uzRawArr);

      // Pass 2: Streaming & bounce-back
      for (let z = 0; z < nz; z++) {
        for (let y = 0; y < ny; y++) {
          for (let x = 0; x < nx; x++) {
            const idx = x + y * nx + z * nx * ny;
            const cType = this.cellTypes[idx];
            if (cType === LbmCellType.ObstacleSolid || cType === LbmCellType.ChannelWall) continue;

            for (let q = 0; q < 19; q++) {
              const nxC = x + CX[q]!;
              const nyC = y + CY[q]!;
              const nzC = z + CZ[q]!;
              const val = fPost[q * total + idx]!;
              if (nxC < 0 || nxC >= nx || nyC < 0 || nyC >= ny || nzC < 0 || nzC >= nz) {
                fNext[OPP[q]! * total + idx] = val;
              } else {
                const tIdx = nxC + nyC * nx + nzC * nx * ny;
                const tType = this.cellTypes[tIdx];
                if (tType === LbmCellType.ObstacleSolid || tType === LbmCellType.ChannelWall) {
                  fNext[OPP[q]! * total + idx] = val;
                } else {
                  fNext[q * total + tIdx] = val;
                }
              }
            }
          }
        }
      }
      fHist.push(fNext);
    }

    const velocityMagnitude = new Float32Array(total);
    const lastUx = uxRawHist[steps - 1]!;
    const lastUy = uyRawHist[steps - 1]!;
    const lastUz = uzRawHist[steps - 1]!;
    const velScale = dx / dt;
    for (let idx = 0; idx < total; idx++) {
      const damp = 1.0 - dMax * alpha[idx]!;
      velocityMagnitude[idx] = Math.hypot(lastUx[idx]!, lastUy[idx]!, lastUz[idx]!) * damp * velScale;
    }

    const gradient = new Float64Array(total);
    const sensitivityField = new Float32Array(total);

    if (!computeGradient) {
      return { objective, gradient, sensitivityField, velocityMagnitude };
    }

    // ── Reverse-Mode Discrete Adjoint Pass ───────────────────────────────────
    let adjFNext = new Float64Array(total * 19);

    for (let t = steps - 1; t >= 0; t--) {
      const adjFPost = new Float64Array(total * 19);
      const adjFCur = new Float64Array(total * 19);

      // Adjoint of Pass 2 (Streaming transpose = pull from streaming target)
      for (let z = 0; z < nz; z++) {
        for (let y = 0; y < ny; y++) {
          for (let x = 0; x < nx; x++) {
            const idx = x + y * nx + z * nx * ny;
            const cType = this.cellTypes[idx];
            if (cType === LbmCellType.ObstacleSolid || cType === LbmCellType.ChannelWall) continue;

            for (let q = 0; q < 19; q++) {
              const nxC = x + CX[q]!;
              const nyC = y + CY[q]!;
              const nzC = z + CZ[q]!;
              if (nxC < 0 || nxC >= nx || nyC < 0 || nyC >= ny || nzC < 0 || nzC >= nz) {
                adjFPost[q * total + idx] = adjFNext[OPP[q]! * total + idx]!;
              } else {
                const tIdx = nxC + nyC * nx + nzC * nx * ny;
                const tType = this.cellTypes[tIdx];
                if (tType === LbmCellType.ObstacleSolid || tType === LbmCellType.ChannelWall) {
                  adjFPost[q * total + idx] = adjFNext[OPP[q]! * total + idx]!;
                } else {
                  adjFPost[q * total + idx] = adjFNext[q * total + tIdx]!;
                }
              }
            }
          }
        }
      }

      // Adjoint of Pass 1 (Collision + Brinkman damping + Objective)
      const rhoArr = rhoHist[t]!;
      const uxRawArr = uxRawHist[t]!;
      const uyRawArr = uyRawHist[t]!;
      const uzRawArr = uzRawHist[t]!;

      for (let idx = 0; idx < total; idx++) {
        const cType = this.cellTypes[idx];
        if (cType === LbmCellType.ObstacleSolid || cType === LbmCellType.ChannelWall) continue;

        const rho = rhoArr[idx]!;
        const invRho = 1.0 / Math.max(1e-8, rho);
        const uxRaw = uxRawArr[idx]!;
        const uyRaw = uyRawArr[idx]!;
        const uzRaw = uzRawArr[idx]!;
        const damp = 1.0 - dMax * alpha[idx]!;
        const ux = damp * uxRaw;
        const uy = damp * uyRaw;
        const uz = damp * uzRaw;
        const uSq = ux * ux + uy * uy + uz * uz;

        // Direct objective derivative wrt alpha_i and uRaw
        gradient[idx] = gradient[idx]! + wPower * dMax * (uxRaw * uxRaw + uyRaw * uyRaw + uzRaw * uzRaw);
        let adjUxRaw = 2.0 * wPower * dMax * alpha[idx]! * uxRaw;
        let adjUyRaw = 2.0 * wPower * dMax * alpha[idx]! * uyRaw;
        let adjUzRaw = 2.0 * wPower * dMax * alpha[idx]! * uzRaw;

        // Backprop through fPost = (1 - omega) * fCur + omega * feq(rho, u)
        let adjRho = 0.0;
        let adjUx = 0.0;
        let adjUy = 0.0;
        let adjUz = 0.0;

        for (let q = 0; q < 19; q++) {
          const afp = adjFPost[q * total + idx]!;
          adjFCur[q * total + idx] = (1.0 - omega) * afp;

          const adjFeq = omega * afp;
          const cx = CX[q]!;
          const cy = CY[q]!;
          const cz = CZ[q]!;
          const wq = W[q]!;
          const cu = cx * ux + cy * uy + cz * uz;

          // d(feq)/d(rho)
          adjRho += adjFeq * wq * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * uSq);
          // d(feq)/d(u)
          const factor = adjFeq * wq * rho;
          const dCu = 3.0 + 9.0 * cu;
          adjUx += factor * (dCu * cx - 3.0 * ux);
          adjUy += factor * (dCu * cy - 3.0 * uy);
          adjUz += factor * (dCu * cz - 3.0 * uz);
        }

        // Backprop through u = (1 - dMax * alpha_i) * uRaw
        gradient[idx] = gradient[idx]! - dMax * (adjUx * uxRaw + adjUy * uyRaw + adjUz * uzRaw);
        adjUxRaw += damp * adjUx;
        adjUyRaw += damp * adjUy;
        adjUzRaw += damp * adjUz;

        // Backprop through uRaw = j / rho and inlet/outlet BC
        let adjJx = adjUxRaw * invRho;
        let adjJy = adjUyRaw * invRho;
        let adjJz = adjUzRaw * invRho;
        adjRho -= (adjUxRaw * uxRaw + adjUyRaw * uyRaw + adjUzRaw * uzRaw) * invRho;

        if (cType === LbmCellType.VelocityInlet) {
          adjRho += adjJx * uInX + adjJy * uInY + adjJz * uInZ;
          adjJx = 0.0;
          adjJy = 0.0;
          adjJz = 0.0;
        } else if (cType === LbmCellType.PressureOutlet) {
          adjRho = 0.0;
        }

        // Backprop through rho = sum f_q, j = sum c_q * f_q
        for (let q = 0; q < 19; q++) {
          adjFCur[q * total + idx] =
            adjFCur[q * total + idx]! + adjRho + CX[q]! * adjJx + CY[q]! * adjJy + CZ[q]! * adjJz;
        }
      }

      adjFNext = adjFCur;
    }

    for (let idx = 0; idx < total; idx++) {
      sensitivityField[idx] = Math.abs(gradient[idx]!);
    }

    return { objective, gradient, sensitivityField, velocityMagnitude };
  }

  /**
   * Returns a gradient oracle compatible with L-BFGS-B / IPOPT aerodynamic shape optimization.
   */
  public createOptimizerOracle(): {
    evaluate: (alpha: Float64Array) => { value: number; gradient: Float64Array };
  } {
    return {
      evaluate: (alpha: Float64Array) => {
        const res = this.evaluate(alpha, true);
        return { value: res.objective, gradient: res.gradient };
      },
    };
  }

  /**
   * Runs box-constrained L-BFGS-B aerodynamic shape optimization over the specified
   * `designCellIndices` with porosity bounds alpha_i in [0, 1], wiring `createOptimizerOracle()`
   * directly into `lbfgsbSolve`.
   */
  public optimizeShapeLbfgsb(
    initialAlpha: Float64Array,
    designCellIndices: number[],
    options?: { maxIterations?: number | undefined; tolerance?: number | undefined },
  ): AdjointShapeOptimizationResult {
    const oracle = this.createOptimizerOracle();
    const workAlpha = Float64Array.from(initialAlpha);
    const n = designCellIndices.length;

    if (n === 0) {
      const initialObj = oracle.evaluate(workAlpha).value;
      return {
        alpha: workAlpha,
        initialObjective: initialObj,
        finalObjective: initialObj,
        iterations: 0,
        converged: true,
      };
    }

    const x0 = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      x0[k] = initialAlpha[designCellIndices[k]!]!;
    }
    const lowerBounds = new Float64Array(n).fill(0.0);
    const upperBounds = new Float64Array(n).fill(1.0);

    const res = lbfgsbSolve(
      x0,
      (x: Float64Array) => {
        for (let k = 0; k < n; k++) {
          workAlpha[designCellIndices[k]!] = x[k]!;
        }
        const { value, gradient } = oracle.evaluate(workAlpha);
        const grad = new Float64Array(n);
        for (let k = 0; k < n; k++) {
          grad[k] = gradient[designCellIndices[k]!]!;
        }
        return { cost: value, grad };
      },
      lowerBounds,
      upperBounds,
      {
        maxIterations: options?.maxIterations ?? 20,
        tolerance: options?.tolerance ?? 1e-6,
      },
    );

    const finalAlpha = Float64Array.from(initialAlpha);
    for (let k = 0; k < n; k++) {
      finalAlpha[designCellIndices[k]!] = res.x[k]!;
    }

    return {
      alpha: finalAlpha,
      initialObjective: res.costHistory[0] ?? res.cost,
      finalObjective: res.cost,
      iterations: res.iterations,
      converged: res.converged,
    };
  }
}
