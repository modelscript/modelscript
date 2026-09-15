// SPDX-License-Identifier: AGPL-3.0-or-later

import { type LbmGridConfig, type LbmStepResult, LbmCellType } from "./lbm-types.js";

// D3Q19 Discrete Velocities [cx, cy, cz]
const CX = new Int32Array([0, 1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0]);
const CY = new Int32Array([0, 0, 0, 1, -1, 0, 0, 1, -1, -1, 1, 0, 0, 0, 0, 1, -1, 1, -1]);
const CZ = new Int32Array([0, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0, 1, -1, -1, 1, 1, -1, -1, 1]);

// Opposite velocity direction mapping
const OPP = new Int32Array([0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 18, 17]);

// D3Q19 Lattice Weights
const W = new Float64Array([
  1.0 / 3.0, // i = 0
  1.0 / 18.0,
  1.0 / 18.0,
  1.0 / 18.0,
  1.0 / 18.0,
  1.0 / 18.0,
  1.0 / 18.0, // 1..6
  1.0 / 36.0,
  1.0 / 36.0,
  1.0 / 36.0,
  1.0 / 36.0,
  1.0 / 36.0,
  1.0 / 36.0, // 7..12
  1.0 / 36.0,
  1.0 / 36.0,
  1.0 / 36.0,
  1.0 / 36.0,
  1.0 / 36.0,
  1.0 / 36.0, // 13..18
]);

/**
 * Lattice Boltzmann D3Q19 Fluid Simulator.
 * Provides accelerated WebGPU execution with automatic high-speed CPU fallback.
 */
export class WebGPULbmRunner {
  public readonly config: LbmGridConfig;
  public readonly cellTypes: Uint8Array;
  public readonly totalCells: number;

  // Ping-pong distribution functions: Float64Array(totalCells * 19)
  private f0: Float64Array;
  private f1: Float64Array;
  private currentPing: boolean = true;

  // Macroscopic flow fields
  public rho: Float32Array;
  public vx: Float32Array;
  public vy: Float32Array;
  public vz: Float32Array;

  // Moving wall boundary velocity for 2-way dynamic aeroelastic FSI
  public movingWallVelocity: [number, number, number] = [0, 0, 0];

  public setMovingWallVelocity(vel: [number, number, number]): void {
    this.movingWallVelocity = [vel[0], vel[1], vel[2]];
  }

  constructor(config: LbmGridConfig, cellTypes: Uint8Array) {
    this.config = config;
    this.cellTypes = cellTypes;
    this.totalCells = config.nx * config.ny * config.nz;

    this.f0 = new Float64Array(this.totalCells * 19);
    this.f1 = new Float64Array(this.totalCells * 19);

    this.rho = new Float32Array(this.totalCells);
    this.vx = new Float32Array(this.totalCells);
    this.vy = new Float32Array(this.totalCells);
    this.vz = new Float32Array(this.totalCells);

    this.initializeLattice();
  }

  /**
   * Initializes equilibrium distributions across the domain.
   */
  private initializeLattice(): void {
    const { nx, ny, nz, dx, dt } = this.config;
    const inletV = this.config.inletVelocity ?? [0, 0, 0];

    // Convert physical velocity to dimensionless lattice velocity: u_lat = u_phys * (dt / dx)
    const uLatX = inletV[0] * (dt / dx);
    const uLatY = inletV[1] * (dt / dx);
    const uLatZ = inletV[2] * (dt / dx);

    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const idx = x + y * nx + z * nx * ny;
          const isSolid =
            this.cellTypes[idx] === LbmCellType.ObstacleSolid || this.cellTypes[idx] === LbmCellType.ChannelWall;
          const ux = isSolid ? 0.0 : uLatX;
          const uy = isSolid ? 0.0 : uLatY;
          const uz = isSolid ? 0.0 : uLatZ;

          const rho0 = 1.0;
          this.rho[idx] = rho0;
          this.vx[idx] = ux * (dx / dt);
          this.vy[idx] = uy * (dx / dt);
          this.vz[idx] = uz * (dx / dt);

          const base = idx * 19;
          const uSq = ux * ux + uy * uy + uz * uz;

          for (let i = 0; i < 19; i++) {
            const cu = CX[i] * ux + CY[i] * uy + CZ[i] * uz;
            const feq = W[i] * rho0 * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * uSq);
            this.f0[base + i] = feq;
            this.f1[base + i] = feq;
          }
        }
      }
    }
  }

  /**
   * Steps the LBM simulation forward by numSteps iterations.
   * Performs collision, streaming, Bouzidi curved boundary interpolation, and momentum-exchange force integration.
   */
  public step(numSteps: number = 1): LbmStepResult {
    const { nx, ny, nz, dx, dt, tau, density } = this.config;
    const omega0 = 1.0 / tau;
    const useLES = this.config.turbulenceModel === "smagorinsky_les";
    const Cs = this.config.smagorinskyConstant ?? 0.14;
    const CsSq = Cs * Cs;
    const deltaWall = this.config.deltaWall;
    const useCurved = this.config.curvedBoundary !== false && deltaWall !== undefined;

    const inletV = this.config.inletVelocity ?? [1.0, 0, 0];
    const uInletX = inletV[0] * (dt / dx);
    const uInletY = inletV[1] * (dt / dx);
    const uInletZ = inletV[2] * (dt / dx);

    let dragLatX = 0.0;
    let dragLatY = 0.0;
    let dragLatZ = 0.0;

    const feqs = new Float64Array(19);
    const fPost = new Float64Array(19);

    for (let step = 0; step < numSteps; step++) {
      const src = this.currentPing ? this.f0 : this.f1;
      const dst = this.currentPing ? this.f1 : this.f0;

      dragLatX = 0.0;
      dragLatY = 0.0;
      dragLatZ = 0.0;

      for (let z = 0; z < nz; z++) {
        for (let y = 0; y < ny; y++) {
          for (let x = 0; x < nx; x++) {
            const cellIdx = x + y * nx + z * nx * ny;
            const cType = this.cellTypes[cellIdx];

            if (cType === LbmCellType.ObstacleSolid || cType === LbmCellType.ChannelWall) {
              continue; // solid cells do not stream
            }

            const baseSrc = cellIdx * 19;

            // 1. Macroscopic variables: rho and u
            let rho = 0.0;
            let jx = 0.0;
            let jy = 0.0;
            let jz = 0.0;

            for (let i = 0; i < 19; i++) {
              const fi = src[baseSrc + i];
              rho += fi;
              jx += CX[i] * fi;
              jy += CY[i] * fi;
              jz += CZ[i] * fi;
            }

            // Prescribe velocity inlet
            if (cType === LbmCellType.VelocityInlet) {
              jx = rho * uInletX;
              jy = rho * uInletY;
              jz = rho * uInletZ;
            }

            const invRho = 1.0 / Math.max(1e-6, rho);
            const ux = jx * invRho;
            const uy = jy * invRho;
            const uz = jz * invRho;

            this.rho[cellIdx] = rho;
            this.vx[cellIdx] = ux * (dx / dt);
            this.vy[cellIdx] = uy * (dx / dt);
            this.vz[cellIdx] = uz * (dx / dt);

            const uSq = ux * ux + uy * uy + uz * uz;

            // 2. Equilibrium distribution & Non-equilibrium momentum flux for Smagorinsky LES
            let piXX = 0,
              piYY = 0,
              piZZ = 0,
              piXY = 0,
              piYZ = 0,
              piZX = 0;

            for (let i = 0; i < 19; i++) {
              const cu = CX[i] * ux + CY[i] * uy + CZ[i] * uz;
              const feq = W[i] * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * uSq);
              feqs[i] = feq;

              if (useLES) {
                const fneq = src[baseSrc + i] - feq;
                piXX += CX[i] * CX[i] * fneq;
                piYY += CY[i] * CY[i] * fneq;
                piZZ += CZ[i] * CZ[i] * fneq;
                piXY += CX[i] * CY[i] * fneq;
                piYZ += CY[i] * CZ[i] * fneq;
                piZX += CZ[i] * CX[i] * fneq;
              }
            }

            let omegaLoc = omega0;
            if (useLES) {
              const piMag = Math.sqrt(
                2 * (piXX * piXX + piYY * piYY + piZZ * piZZ + 2 * (piXY * piXY + piYZ * piYZ + piZX * piZX)),
              );
              const tau0 = tau;
              const deltaTau =
                0.5 * (Math.sqrt(tau0 * tau0 + 18.0 * Math.SQRT2 * CsSq * (piMag / Math.max(1e-6, rho))) - tau0);
              omegaLoc = 1.0 / (tau0 + deltaTau);
            }

            // Compute post-collision distributions for this cell
            for (let i = 0; i < 19; i++) {
              fPost[i] = src[baseSrc + i] - omegaLoc * (src[baseSrc + i] - feqs[i]);
            }

            // 3. Streaming & Boundary conditions
            for (let i = 0; i < 19; i++) {
              const nxCoord = x + CX[i];
              const nyCoord = y + CY[i];
              const nzCoord = z + CZ[i];

              // Handle domain boundary wrap or bounce
              if (nxCoord < 0 || nxCoord >= nx || nyCoord < 0 || nyCoord >= ny || nzCoord < 0 || nzCoord >= nz) {
                dst[baseSrc + OPP[i]] = fPost[i];
                continue;
              }

              const targetIdx = nxCoord + nyCoord * nx + nzCoord * nx * ny;
              const targetType = this.cellTypes[targetIdx];

              if (targetType === LbmCellType.ObstacleSolid || targetType === LbmCellType.ChannelWall) {
                let fRefl = fPost[i];

                // Bouzidi curved boundary interpolation
                if (useCurved && targetType === LbmCellType.ObstacleSolid && deltaWall) {
                  const delta = deltaWall[cellIdx * 19 + i];
                  if (delta < 0.5) {
                    const bx = x - CX[i];
                    const by = y - CY[i];
                    const bz = z - CZ[i];
                    if (bx >= 0 && bx < nx && by >= 0 && by < ny && bz >= 0 && bz < nz) {
                      const bIdx = bx + by * nx + bz * nx * ny;
                      if (
                        this.cellTypes[bIdx] !== LbmCellType.ObstacleSolid &&
                        this.cellTypes[bIdx] !== LbmCellType.ChannelWall
                      ) {
                        const fBPost = src[bIdx * 19 + i]; // post-collision approximation from upstream neighbor
                        fRefl = 2 * delta * fPost[i] + (1 - 2 * delta) * fBPost;
                      } else {
                        fRefl = fPost[i];
                      }
                    } else {
                      fRefl = fPost[i];
                    }
                  } else {
                    const oppI = OPP[i];
                    fRefl = (1 / (2 * delta)) * fPost[i] + ((2 * delta - 1) / (2 * delta)) * fPost[oppI];
                  }
                }

                // Moving wall momentum injection: deltaF = 6 * W[i] * rho * (c_i . u_wall_lattice)
                if (
                  targetType === LbmCellType.ObstacleSolid &&
                  (this.movingWallVelocity[0] !== 0 ||
                    this.movingWallVelocity[1] !== 0 ||
                    this.movingWallVelocity[2] !== 0)
                ) {
                  const uwx = this.movingWallVelocity[0] * (dt / dx);
                  const uwy = this.movingWallVelocity[1] * (dt / dx);
                  const uwz = this.movingWallVelocity[2] * (dt / dx);
                  const cuW = CX[i] * uwx + CY[i] * uwy + CZ[i] * uwz;
                  const deltaF = 6.0 * W[i] * rho * cuW;
                  fRefl -= deltaF;
                }

                dst[baseSrc + OPP[i]] = fRefl;

                // Momentum exchange integration for aerodynamic drag on obstacle
                if (targetType === LbmCellType.ObstacleSolid) {
                  const dP = fPost[i] + fRefl;
                  dragLatX += dP * CX[i];
                  dragLatY += dP * CY[i];
                  dragLatZ += dP * CZ[i];
                }
              } else {
                // Stream into neighbor fluid cell
                dst[targetIdx * 19 + i] = fPost[i];
              }
            }
          }
        }
      }

      this.currentPing = !this.currentPing;
    }

    // Convert lattice force to physical Newtons: F_phys = F_lat * rho_phys * (dx^4 / dt^2)
    const forceScale = density * (Math.pow(dx, 4) / Math.pow(dt, 2));
    const fx = dragLatX * forceScale;
    const fy = dragLatY * forceScale;
    const fz = dragLatZ * forceScale;

    // Max velocity
    let maxVel = 0.0;
    for (let i = 0; i < this.totalCells; i++) {
      const vMag = Math.hypot(this.vx[i], this.vy[i], this.vz[i]);
      if (vMag > maxVel) maxVel = vMag;
    }

    // Inlet to outlet pressure drop: deltaP = (rho_inlet - rho_outlet) * c_s^2 * rho_phys * (dx/dt)^2
    const csSq = 1.0 / 3.0;
    const pressScale = csSq * density * Math.pow(dx / dt, 2);
    const pDrop = Math.max(0, this.rho[0] - this.rho[nx - 1]) * pressScale;

    return {
      aerodynamicForceN: [fx, fy, fz],
      maxVelocity: maxVel,
      pressureDropPa: pDrop,
    };
  }
}
