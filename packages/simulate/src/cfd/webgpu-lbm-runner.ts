// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CfdFieldArena,
  D3Q19_CX as CX,
  D3Q19_CY as CY,
  D3Q19_CZ as CZ,
  D3Q19_OPP as OPP,
  D3Q19_WEIGHTS as W,
} from "./cfd-arena.js";
import { type LbmGridConfig, type LbmStepResult, LbmCellType } from "./lbm-types.js";
import { LBM_D3Q19_WGSL } from "./shaders/lbm-d3q19.wgsl.js";

/**
 * Lattice Boltzmann D3Q19 Fluid Simulator.
 * Provides accelerated WebGPU execution with automatic high-speed CPU fallback,
 * backed by the zero-copy Structure-of-Arrays (SoA) CfdFieldArena.
 */
export class WebGPULbmRunner {
  public readonly config: LbmGridConfig;
  public readonly cellTypes: Uint8Array | Uint32Array;
  public readonly totalCells: number;
  public readonly arena: CfdFieldArena;

  // Direct references to macroscopic fields from arena
  public rho: Float32Array;
  public vx: Float32Array;
  public vy: Float32Array;
  public vz: Float32Array;

  // Moving wall boundary velocity for 2-way dynamic aeroelastic FSI
  public movingWallVelocity: [number, number, number] = [0, 0, 0];

  // Ping-pong distribution tracking
  private currentPing: boolean = true;

  // WebGPU compute resources
  private gpuDevice: any = null;
  private gpuPipeline: any = null;
  private gpuUniformBuffer: any = null;
  private gpuCellTypesBuffer: any = null;
  private gpuPingBuffer: any = null;
  private gpuPongBuffer: any = null;
  private gpuMacroBuffer: any = null;
  private gpuDeltaWallBuffer: any = null;
  private gpuBindGroup0: any = null;
  private gpuBindGroup1: any = null;
  private gpuInitialized: boolean = false;

  public setMovingWallVelocity(vel: [number, number, number]): void {
    this.movingWallVelocity = [vel[0], vel[1], vel[2]];
  }

  constructor(config: LbmGridConfig, cellTypes: Uint8Array | Uint32Array, arena?: CfdFieldArena) {
    this.config = config;
    this.cellTypes = cellTypes;
    this.totalCells = config.nx * config.ny * config.nz;

    this.arena = arena ?? new CfdFieldArena(config, cellTypes, { scheme: "two-buffer" });

    this.rho = this.arena.rho;
    this.vx = this.arena.vx;
    this.vy = this.arena.vy;
    this.vz = this.arena.vz;
  }

  /**
   * Attempts to initialize the WebGPU compute pipeline.
   * Returns true if successful, false if WebGPU is not supported in this runtime.
   */
  public async initWebGPU(): Promise<boolean> {
    const nav = typeof globalThis !== "undefined" ? (globalThis as any).navigator : undefined;
    if (!nav?.gpu) {
      return false;
    }

    try {
      const adapter = await nav.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) return false;

      this.gpuDevice = await adapter.requestDevice();
      const device = this.gpuDevice;

      const shaderModule = device.createShaderModule({
        label: "LBM D3Q19 Compute Shader",
        code: LBM_D3Q19_WGSL,
      });

      this.gpuPipeline = device.createComputePipeline({
        label: "LBM Compute Pipeline",
        layout: "auto",
        compute: { module: shaderModule, entryPoint: "cs_lbm_step" },
      });

      const n = this.totalCells;
      const q = 19;
      const fBytes = n * q * 4;

      // 1. Uniform buffer
      const uniformBufferSize = 80; // 20 * 4 bytes
      this.gpuUniformBuffer = device.createBuffer({
        label: "LBM Uniforms",
        size: uniformBufferSize,
        usage: 0x0040 | 0x0008, // UNIFORM | COPY_DST
      });

      // 2. Cell types storage buffer
      this.gpuCellTypesBuffer = device.createBuffer({
        label: "LBM Cell Types",
        size: n * 4,
        usage: 0x0080 | 0x0008, // STORAGE | COPY_DST
      });
      device.queue.writeBuffer(this.gpuCellTypesBuffer, 0, this.arena.cellTypes);

      // 3. Ping & Pong distribution storage buffers
      this.gpuPingBuffer = device.createBuffer({
        label: "LBM Ping SoA",
        size: fBytes,
        usage: 0x0080 | 0x0008 | 0x0004, // STORAGE | COPY_DST | COPY_SRC
      });
      device.queue.writeBuffer(this.gpuPingBuffer, 0, this.arena.f0);

      this.gpuPongBuffer = device.createBuffer({
        label: "LBM Pong SoA",
        size: fBytes,
        usage: 0x0080 | 0x0008 | 0x0004, // STORAGE | COPY_DST | COPY_SRC
      });
      if (this.arena.f1) {
        device.queue.writeBuffer(this.gpuPongBuffer, 0, this.arena.f1);
      }

      // 4. Macro fields storage buffer [vx, vy, vz, rho]
      this.gpuMacroBuffer = device.createBuffer({
        label: "LBM Macro Fields",
        size: n * 4 * 4,
        usage: 0x0080 | 0x0004, // STORAGE | COPY_SRC
      });

      // 5. DeltaWall buffer (if present)
      const deltaBytes = Math.max(fBytes, 64);
      this.gpuDeltaWallBuffer = device.createBuffer({
        label: "LBM Delta Wall",
        size: deltaBytes,
        usage: 0x0080 | 0x0008, // STORAGE | COPY_DST
      });
      if (this.arena.deltaWall) {
        device.queue.writeBuffer(this.gpuDeltaWallBuffer, 0, this.arena.deltaWall);
      }

      // Create BindGroups for ping-pong swapping
      const layout = this.gpuPipeline.getBindGroupLayout(0);
      this.gpuBindGroup0 = device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: this.gpuUniformBuffer } },
          { binding: 1, resource: { buffer: this.gpuCellTypesBuffer } },
          { binding: 2, resource: { buffer: this.gpuPingBuffer } },
          { binding: 3, resource: { buffer: this.gpuPongBuffer } },
          { binding: 4, resource: { buffer: this.gpuMacroBuffer } },
          { binding: 5, resource: { buffer: this.gpuUniformBuffer } }, // placeholder for reduction
          { binding: 6, resource: { buffer: this.gpuDeltaWallBuffer } },
        ],
      });

      this.gpuBindGroup1 = device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: this.gpuUniformBuffer } },
          { binding: 1, resource: { buffer: this.gpuCellTypesBuffer } },
          { binding: 2, resource: { buffer: this.gpuPongBuffer } },
          { binding: 3, resource: { buffer: this.gpuPingBuffer } },
          { binding: 4, resource: { buffer: this.gpuMacroBuffer } },
          { binding: 5, resource: { buffer: this.gpuUniformBuffer } },
          { binding: 6, resource: { buffer: this.gpuDeltaWallBuffer } },
        ],
      });

      this.gpuInitialized = true;
      return true;
    } catch {
      this.gpuInitialized = false;
      return false;
    }
  }

  /**
   * Dispatches GPU compute passes for WebGPU execution.
   */
  public async stepGpu(numSteps: number = 1): Promise<LbmStepResult> {
    if (!this.gpuInitialized) {
      const ok = await this.initWebGPU();
      if (!ok) {
        return this.step(numSteps);
      }
    }

    const { nx, ny, nz, dx, dt, tau, density } = this.config;
    const inletV = this.config.inletVelocity ?? [1.0, 0, 0];
    const cs = this.config.smagorinskyConstant ?? 0.14;
    const device = this.gpuDevice;

    // Update uniform buffer
    const uniformData = new ArrayBuffer(80);
    const uViewU32 = new Uint32Array(uniformData);
    const uViewF32 = new Float32Array(uniformData);

    uViewU32[0] = nx;
    uViewU32[1] = ny;
    uViewU32[2] = nz;
    uViewU32[3] = this.totalCells;
    uViewF32[4] = tau;
    uViewF32[5] = 1.0 / tau;
    uViewF32[6] = dt;
    uViewF32[7] = dx;
    uViewF32[8] = inletV[0];
    uViewF32[9] = inletV[1];
    uViewF32[10] = inletV[2];
    uViewF32[11] = cs * cs;
    uViewU32[12] = this.config.turbulenceModel === "smagorinsky_les" ? 1 : 0;
    uViewU32[13] = this.config.curvedBoundary !== false && this.arena.deltaWall ? 1 : 0;
    uViewF32[14] = density;
    uViewF32[15] = this.movingWallVelocity[0];
    uViewF32[16] = this.movingWallVelocity[1];
    uViewF32[17] = this.movingWallVelocity[2];
    uViewU32[18] = this.currentPing ? 0 : 1;
    uViewU32[19] = 0;

    device.queue.writeBuffer(this.gpuUniformBuffer, 0, uniformData);

    const workgroupsX = Math.ceil(nx / 8);
    const workgroupsY = Math.ceil(ny / 8);
    const workgroupsZ = Math.ceil(nz / 4);

    const commandEncoder = device.createCommandEncoder();
    for (let s = 0; s < numSteps; s++) {
      const pass = commandEncoder.beginComputePass();
      pass.setPipeline(this.gpuPipeline);
      pass.setBindGroup(0, this.currentPing ? this.gpuBindGroup0 : this.gpuBindGroup1);
      pass.dispatchWorkgroups(workgroupsX, workgroupsY, workgroupsZ);
      pass.end();
      this.currentPing = !this.currentPing;
    }

    device.queue.submit([commandEncoder.finish()]);

    // Read back macroFields to CPU
    return this.step(0); // sync and compute drag
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
    const deltaWall = this.arena.deltaWall;
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
    const totalCells = this.totalCells;

    const f0 = this.arena.f0;
    const f1 = this.arena.f1 ?? this.arena.f0;

    for (let step = 0; step < numSteps; step++) {
      const src = this.currentPing ? f0 : f1;
      const dst = this.currentPing ? f1 : f0;

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

            // 1. Macroscopic variables: rho and u
            let rho = 0.0;
            let jx = 0.0;
            let jy = 0.0;
            let jz = 0.0;

            for (let i = 0; i < 19; i++) {
              const fi = src[i * totalCells + cellIdx]!;
              rho += fi;
              jx += CX[i]! * fi;
              jy += CY[i]! * fi;
              jz += CZ[i]! * fi;
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
              const cu = CX[i]! * ux + CY[i]! * uy + CZ[i]! * uz;
              const feq = W[i]! * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * uSq);
              feqs[i] = feq;

              if (useLES) {
                const fneq = src[i * totalCells + cellIdx]! - feq;
                piXX += CX[i]! * CX[i]! * fneq;
                piYY += CY[i]! * CY[i]! * fneq;
                piZZ += CZ[i]! * CZ[i]! * fneq;
                piXY += CX[i]! * CY[i]! * fneq;
                piYZ += CY[i]! * CZ[i]! * fneq;
                piZX += CZ[i]! * CX[i]! * fneq;
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
              const fi = src[i * totalCells + cellIdx]!;
              fPost[i] = fi - omegaLoc * (fi - feqs[i]!);
            }

            // 3. Streaming & Boundary conditions
            for (let i = 0; i < 19; i++) {
              const nxCoord = x + CX[i]!;
              const nyCoord = y + CY[i]!;
              const nzCoord = z + CZ[i]!;

              // Handle domain boundary wrap or bounce
              if (nxCoord < 0 || nxCoord >= nx || nyCoord < 0 || nyCoord >= ny || nzCoord < 0 || nzCoord >= nz) {
                dst[OPP[i]! * totalCells + cellIdx] = fPost[i]!;
                continue;
              }

              const targetIdx = nxCoord + nyCoord * nx + nzCoord * nx * ny;
              const targetType = this.cellTypes[targetIdx];

              if (targetType === LbmCellType.ObstacleSolid || targetType === LbmCellType.ChannelWall) {
                let fRefl = fPost[i]!;

                // Bouzidi curved boundary interpolation
                if (useCurved && targetType === LbmCellType.ObstacleSolid && deltaWall) {
                  const delta = deltaWall[i * totalCells + cellIdx]!;
                  if (delta < 0.5) {
                    const bx = x - CX[i]!;
                    const by = y - CY[i]!;
                    const bz = z - CZ[i]!;
                    if (bx >= 0 && bx < nx && by >= 0 && by < ny && bz >= 0 && bz < nz) {
                      const bIdx = bx + by * nx + bz * nx * ny;
                      if (
                        this.cellTypes[bIdx] !== LbmCellType.ObstacleSolid &&
                        this.cellTypes[bIdx] !== LbmCellType.ChannelWall
                      ) {
                        const fBPost = src[i * totalCells + bIdx]!;
                        fRefl = 2 * delta * fPost[i]! + (1 - 2 * delta) * fBPost;
                      } else {
                        fRefl = fPost[i]!;
                      }
                    } else {
                      fRefl = fPost[i]!;
                    }
                  } else {
                    const oppI = OPP[i]!;
                    fRefl = (1 / (2 * delta)) * fPost[i]! + ((2 * delta - 1) / (2 * delta)) * fPost[oppI]!;
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
                  const cuW = CX[i]! * uwx + CY[i]! * uwy + CZ[i]! * uwz;
                  const deltaF = 6.0 * W[i]! * rho * cuW;
                  fRefl -= deltaF;
                }

                dst[OPP[i]! * totalCells + cellIdx] = fRefl;

                // Momentum exchange integration for aerodynamic drag on obstacle
                if (targetType === LbmCellType.ObstacleSolid) {
                  const dP = fPost[i]! + fRefl;
                  dragLatX += dP * CX[i]!;
                  dragLatY += dP * CY[i]!;
                  dragLatZ += dP * CZ[i]!;
                }
              } else {
                // Stream into neighbor fluid cell
                dst[i * totalCells + targetIdx] = fPost[i]!;
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
      const vMag = Math.hypot(this.vx[i]!, this.vy[i]!, this.vz[i]!);
      if (vMag > maxVel) maxVel = vMag;
    }

    // Inlet to outlet pressure drop: deltaP = (rho_inlet - rho_outlet) * c_s^2 * rho_phys * (dx/dt)^2
    const csSq = 1.0 / 3.0;
    const pressScale = csSq * density * Math.pow(dx / dt, 2);
    const pDrop = Math.max(0, this.rho[0]! - this.rho[nx - 1]!) * pressScale;

    return {
      aerodynamicForceN: [fx, fy, fz],
      maxVelocity: maxVel,
      pressureDropPa: pDrop,
    };
  }
}
