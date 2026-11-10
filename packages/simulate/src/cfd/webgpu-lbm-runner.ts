// SPDX-License-Identifier: AGPL-3.0-or-later

import { getDefaultWasmExports } from "@modelscript/runtime";
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
  private gpuDevice: GPUDevice | null = null;
  private gpuPipeline: GPUComputePipeline | null = null;
  private gpuUniformBuffer: GPUBuffer | null = null;
  private gpuCellTypesBuffer: GPUBuffer | null = null;
  private gpuPingBuffer: GPUBuffer | null = null;
  private gpuPongBuffer: GPUBuffer | null = null;
  private gpuMacroBuffer: GPUBuffer | null = null;
  private gpuDeltaWallBuffer: GPUBuffer | null = null;
  private gpuDragOutputBuffer: GPUBuffer | null = null;
  private gpuBindGroup0: GPUBindGroup | null = null;
  private gpuBindGroup1: GPUBindGroup | null = null;
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
    if (this.gpuInitialized) {
      return true;
    }
    const nav =
      typeof globalThis !== "undefined"
        ? (globalThis as { navigator?: { gpu?: GPU | undefined } | undefined }).navigator
        : undefined;
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
      device.queue.writeBuffer(this.gpuCellTypesBuffer, 0, this.arena.cellTypes as Uint32Array<ArrayBuffer>);

      // 3. Ping & Pong distribution storage buffers
      this.gpuPingBuffer = device.createBuffer({
        label: "LBM Ping SoA",
        size: fBytes,
        usage: 0x0080 | 0x0008 | 0x0004, // STORAGE | COPY_DST | COPY_SRC
      });
      device.queue.writeBuffer(this.gpuPingBuffer, 0, this.arena.f0 as Float32Array<ArrayBuffer>);

      this.gpuPongBuffer = device.createBuffer({
        label: "LBM Pong SoA",
        size: fBytes,
        usage: 0x0080 | 0x0008 | 0x0004, // STORAGE | COPY_DST | COPY_SRC
      });
      if (this.arena.f1) {
        device.queue.writeBuffer(this.gpuPongBuffer, 0, this.arena.f1 as Float32Array<ArrayBuffer>);
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
        device.queue.writeBuffer(this.gpuDeltaWallBuffer, 0, this.arena.deltaWall as Float32Array<ArrayBuffer>);
      }

      // 6. Drag output & macroscopic reduction storage buffer [Fx, Fy, Fz, maxVel, pDrop]
      this.gpuDragOutputBuffer = device.createBuffer({
        label: "LBM Drag Output",
        size: 32, // 8 * sizeof(f32)
        usage: 0x0080 | 0x0004 | 0x0008, // STORAGE | COPY_SRC | COPY_DST
      });

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
          { binding: 5, resource: { buffer: this.gpuDragOutputBuffer } },
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
          { binding: 5, resource: { buffer: this.gpuDragOutputBuffer } },
          { binding: 6, resource: { buffer: this.gpuDeltaWallBuffer } },
        ],
      });

      this.gpuInitialized = true;
      return true;
    } catch {
      this.destroy();
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
    const device = this.gpuDevice!;

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

    device.queue.writeBuffer(this.gpuUniformBuffer!, 0, uniformData);

    const workgroupsX = Math.ceil(nx / 8);
    const workgroupsY = Math.ceil(ny / 8);
    const workgroupsZ = Math.ceil(nz / 4);

    const macroBytes = this.totalCells * 4 * 4;
    const readbackMacro = device.createBuffer({
      label: "LBM Macro Readback",
      size: macroBytes,
      usage: 0x0001 | 0x0008, // MAP_READ | COPY_DST
    });

    const commandEncoder = device.createCommandEncoder();
    for (let s = 0; s < numSteps; s++) {
      const pass = commandEncoder.beginComputePass();
      pass.setPipeline(this.gpuPipeline!);
      pass.setBindGroup(0, this.currentPing ? this.gpuBindGroup0! : this.gpuBindGroup1!);
      pass.dispatchWorkgroups(workgroupsX, workgroupsY, workgroupsZ);
      pass.end();
      this.currentPing = !this.currentPing;
    }

    commandEncoder.copyBufferToBuffer(this.gpuMacroBuffer!, 0, readbackMacro, 0, macroBytes);
    device.queue.submit([commandEncoder.finish()]);

    // Read back macroFields [vx, vy, vz, rho] from GPU to CPU arrays
    try {
      await readbackMacro.mapAsync(0x0001); // GPUMapMode.READ
      const macroData = new Float32Array(readbackMacro.getMappedRange());
      for (let i = 0; i < this.totalCells; i++) {
        const base = i * 4;
        this.vx[i] = macroData[base] ?? 0;
        this.vy[i] = macroData[base + 1] ?? 0;
        this.vz[i] = macroData[base + 2] ?? 0;
        this.rho[i] = macroData[base + 3] ?? 1;
      }
      readbackMacro.unmap();
    } finally {
      readbackMacro.destroy();
    }

    return this.step(0); // compute summary metrics from updated macro fields
  }

  private static wasmLbmBuffers?:
    | {
        wasm: {
          memory: WebAssembly.Memory;
          __new: (bytes: number, id: number) => number;
          __pin?: ((ptr: number) => void) | undefined;
          __unpin?: ((ptr: number) => void) | undefined;
          lbm_d3q19_step_f32: (
            nx: number,
            ny: number,
            nz: number,
            cellTypesPtr: number,
            isCellTypesU32: number,
            srcPtr: number,
            dstPtr: number,
            rhoPtr: number,
            vxPtr: number,
            vyPtr: number,
            vzPtr: number,
            deltaWallPtr: number,
            forceOutPtr: number,
            dt: number,
            dx: number,
            omega0: number,
            tau: number,
            uInletX: number,
            uInletY: number,
            uInletZ: number,
            useLES: number,
            CsSq: number,
            useCurved: number,
          ) => void;
        };
        capTotalCells: number;
        owner: WebGPULbmRunner | null;
        cellTypesPtr: number;
        f0Ptr: number;
        f1Ptr: number;
        rhoPtr: number;
        vxPtr: number;
        vyPtr: number;
        vzPtr: number;
        deltaWallPtr: number;
        forceOutPtr: number;
      }
    | undefined;

  private ensureWasmBuffers(): typeof WebGPULbmRunner.wasmLbmBuffers {
    const totalCells = this.totalCells;
    const wasm = getDefaultWasmExports() as
      | {
          memory: WebAssembly.Memory;
          __new?: ((bytes: number, id: number) => number) | undefined;
          __pin?: ((ptr: number) => void) | undefined;
          __unpin?: ((ptr: number) => void) | undefined;
          lbm_d3q19_step_f32?:
            | NonNullable<typeof WebGPULbmRunner.wasmLbmBuffers>["wasm"]["lbm_d3q19_step_f32"]
            | undefined;
        }
      | null
      | undefined;

    if (!wasm || typeof wasm.lbm_d3q19_step_f32 !== "function" || typeof wasm.__new !== "function" || totalCells <= 0) {
      return undefined;
    }

    const validWasm = wasm as NonNullable<typeof WebGPULbmRunner.wasmLbmBuffers>["wasm"];
    const prev = WebGPULbmRunner.wasmLbmBuffers;

    const needRealloc = !prev || prev.wasm !== validWasm || prev.capTotalCells < totalCells;

    if (needRealloc) {
      if (prev && prev.wasm === validWasm && typeof validWasm.__unpin === "function") {
        validWasm.__unpin(prev.cellTypesPtr);
        validWasm.__unpin(prev.f0Ptr);
        validWasm.__unpin(prev.f1Ptr);
        validWasm.__unpin(prev.rhoPtr);
        validWasm.__unpin(prev.vxPtr);
        validWasm.__unpin(prev.vyPtr);
        validWasm.__unpin(prev.vzPtr);
        validWasm.__unpin(prev.deltaWallPtr);
        validWasm.__unpin(prev.forceOutPtr);
      }

      const capTotalCells = prev && prev.wasm === validWasm ? Math.max(prev.capTotalCells, totalCells) : totalCells;
      const alloc = (bytes: number): number => {
        const ptr = validWasm.__new(bytes, 0);
        if (typeof validWasm.__pin === "function") validWasm.__pin(ptr);
        return ptr;
      };

      WebGPULbmRunner.wasmLbmBuffers = {
        wasm: validWasm,
        capTotalCells,
        owner: null,
        cellTypesPtr: alloc(capTotalCells * 4),
        f0Ptr: alloc(19 * capTotalCells * 4),
        f1Ptr: alloc(19 * capTotalCells * 4),
        rhoPtr: alloc(capTotalCells * 4),
        vxPtr: alloc(capTotalCells * 4),
        vyPtr: alloc(capTotalCells * 4),
        vzPtr: alloc(capTotalCells * 4),
        deltaWallPtr: alloc(19 * capTotalCells * 4),
        forceOutPtr: alloc(3 * 8),
      };
    }

    const bufs = WebGPULbmRunner.wasmLbmBuffers!;
    const memBuf = validWasm.memory.buffer;

    if (bufs.owner !== this) {
      const isU32 = this.cellTypes instanceof Uint32Array;
      if (isU32) {
        new Uint32Array(memBuf, bufs.cellTypesPtr, totalCells).set(this.cellTypes as Uint32Array);
      } else {
        new Uint8Array(memBuf, bufs.cellTypesPtr, totalCells).set(this.cellTypes as Uint8Array);
      }

      if (this.arena.deltaWall) {
        new Float32Array(memBuf, bufs.deltaWallPtr, 19 * totalCells).set(this.arena.deltaWall);
      }

      new Float32Array(memBuf, bufs.f0Ptr, 19 * totalCells).set(this.arena.f0);
      const f1 = this.arena.f1 ?? this.arena.f0;
      new Float32Array(memBuf, bufs.f1Ptr, 19 * totalCells).set(f1);
      new Float32Array(memBuf, bufs.rhoPtr, totalCells).set(this.rho);
      new Float32Array(memBuf, bufs.vxPtr, totalCells).set(this.vx);
      new Float32Array(memBuf, bufs.vyPtr, totalCells).set(this.vy);
      new Float32Array(memBuf, bufs.vzPtr, totalCells).set(this.vz);

      bufs.owner = this;
    }

    return bufs;
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

    const totalCells = this.totalCells;
    const f0 = this.arena.f0;
    const f1 = this.arena.f1 ?? this.arena.f0;

    const bufs = this.ensureWasmBuffers();
    if (
      bufs &&
      typeof bufs.wasm.lbm_d3q19_step_f32 === "function" &&
      numSteps > 0 &&
      this.movingWallVelocity[0] === 0 &&
      this.movingWallVelocity[1] === 0 &&
      this.movingWallVelocity[2] === 0
    ) {
      const isU32 = this.cellTypes instanceof Uint32Array ? 1 : 0;
      const dWallPtr = useCurved ? bufs.deltaWallPtr : 0;
      const memBuf = bufs.wasm.memory.buffer;
      const forceView = new Float64Array(memBuf, bufs.forceOutPtr, 3);

      for (let s = 0; s < numSteps; s++) {
        const srcPtr = this.currentPing ? bufs.f0Ptr : bufs.f1Ptr;
        const dstPtr = this.currentPing ? bufs.f1Ptr : bufs.f0Ptr;

        bufs.wasm.lbm_d3q19_step_f32(
          nx,
          ny,
          nz,
          bufs.cellTypesPtr,
          isU32,
          srcPtr,
          dstPtr,
          bufs.rhoPtr,
          bufs.vxPtr,
          bufs.vyPtr,
          bufs.vzPtr,
          dWallPtr,
          bufs.forceOutPtr,
          dt,
          dx,
          omega0,
          tau,
          uInletX,
          uInletY,
          uInletZ,
          useLES ? 1 : 0,
          CsSq,
          useCurved ? 1 : 0,
        );

        dragLatX = forceView[0]!;
        dragLatY = forceView[1]!;
        dragLatZ = forceView[2]!;
        this.currentPing = !this.currentPing;
      }

      this.rho.set(new Float32Array(memBuf, bufs.rhoPtr, totalCells));
      this.vx.set(new Float32Array(memBuf, bufs.vxPtr, totalCells));
      this.vy.set(new Float32Array(memBuf, bufs.vyPtr, totalCells));
      this.vz.set(new Float32Array(memBuf, bufs.vzPtr, totalCells));
      f0.set(new Float32Array(memBuf, bufs.f0Ptr, totalCells * 19));
      if (f1 !== f0) {
        f1.set(new Float32Array(memBuf, bufs.f1Ptr, totalCells * 19));
      }
    } else {
      const feqs = new Float64Array(19);
      const fPost = new Float64Array(19);

      for (let step = 0; step < numSteps; step++) {
        const src = this.currentPing ? f0 : f1;
        const dst = this.currentPing ? f1 : f0;

        dragLatX = 0.0;
        dragLatY = 0.0;
        dragLatZ = 0.0;

        // Pass 1: Local macroscopic moment recovery & BGK / Smagorinsky LES collision (in-place in src)
        for (let z = 0; z < nz; z++) {
          for (let y = 0; y < ny; y++) {
            for (let x = 0; x < nx; x++) {
              const cellIdx = x + y * nx + z * nx * ny;
              const cType = this.cellTypes[cellIdx];

              if (cType === LbmCellType.ObstacleSolid || cType === LbmCellType.ChannelWall) {
                continue;
              }

              // 1. Macroscopic variables: rho and u (vectorized unrolled accumulation)
              const f0 = src[0 * totalCells + cellIdx]!;
              const f1 = src[1 * totalCells + cellIdx]!;
              const f2 = src[2 * totalCells + cellIdx]!;
              const f3 = src[3 * totalCells + cellIdx]!;
              const f4 = src[4 * totalCells + cellIdx]!;
              const f5 = src[5 * totalCells + cellIdx]!;
              const f6 = src[6 * totalCells + cellIdx]!;
              const f7 = src[7 * totalCells + cellIdx]!;
              const f8 = src[8 * totalCells + cellIdx]!;
              const f9 = src[9 * totalCells + cellIdx]!;
              const f10 = src[10 * totalCells + cellIdx]!;
              const f11 = src[11 * totalCells + cellIdx]!;
              const f12 = src[12 * totalCells + cellIdx]!;
              const f13 = src[13 * totalCells + cellIdx]!;
              const f14 = src[14 * totalCells + cellIdx]!;
              const f15 = src[15 * totalCells + cellIdx]!;
              const f16 = src[16 * totalCells + cellIdx]!;
              const f17 = src[17 * totalCells + cellIdx]!;
              const f18 = src[18 * totalCells + cellIdx]!;

              let rho =
                f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8 + f9 + f10 + f11 + f12 + f13 + f14 + f15 + f16 + f17 + f18;
              let jx = f1 - f2 + (f7 - f8 + f9 - f10) + (f11 - f12 + f13 - f14);
              let jy = f3 - f4 + (f7 + f8 - f9 - f10) + (f15 - f16 + f17 - f18);
              let jz = f5 - f6 + (f11 + f12 - f13 - f14) + (f15 + f16 - f17 - f18);

              // Prescribe velocity inlet or constant-pressure outlet
              if (cType === LbmCellType.VelocityInlet) {
                jx = rho * uInletX;
                jy = rho * uInletY;
                jz = rho * uInletZ;
              } else if (cType === LbmCellType.PressureOutlet) {
                rho = 1.0;
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
              const oneMinus15uSq = 1.0 - 1.5 * uSq;

              // 2. Vectorized Equilibrium Distribution
              feqs[0] = (1.0 / 3.0) * rho * oneMinus15uSq;

              const rhoOver18 = (1.0 / 18.0) * rho;
              const qx = 4.5 * ux * ux,
                cx3 = 3.0 * ux;
              const qy = 4.5 * uy * uy,
                cy3 = 3.0 * uy;
              const qz = 4.5 * uz * uz,
                cz3 = 3.0 * uz;
              feqs[1] = rhoOver18 * (oneMinus15uSq + qx + cx3);
              feqs[2] = rhoOver18 * (oneMinus15uSq + qx - cx3);
              feqs[3] = rhoOver18 * (oneMinus15uSq + qy + cy3);
              feqs[4] = rhoOver18 * (oneMinus15uSq + qy - cy3);
              feqs[5] = rhoOver18 * (oneMinus15uSq + qz + cz3);
              feqs[6] = rhoOver18 * (oneMinus15uSq + qz - cz3);

              const rhoOver36 = (1.0 / 36.0) * rho;
              const u_xy_p = ux + uy,
                u_xy_m = ux - uy;
              const u_xz_p = ux + uz,
                u_xz_m = ux - uz;
              const u_yz_p = uy + uz,
                u_yz_m = uy - uz;

              feqs[7] = rhoOver36 * (oneMinus15uSq + 4.5 * u_xy_p * u_xy_p + 3.0 * u_xy_p);
              feqs[8] = rhoOver36 * (oneMinus15uSq + 4.5 * u_xy_m * u_xy_m - 3.0 * u_xy_m);
              feqs[9] = rhoOver36 * (oneMinus15uSq + 4.5 * u_xy_m * u_xy_m + 3.0 * u_xy_m);
              feqs[10] = rhoOver36 * (oneMinus15uSq + 4.5 * u_xy_p * u_xy_p - 3.0 * u_xy_p);

              feqs[11] = rhoOver36 * (oneMinus15uSq + 4.5 * u_xz_p * u_xz_p + 3.0 * u_xz_p);
              feqs[12] = rhoOver36 * (oneMinus15uSq + 4.5 * u_xz_m * u_xz_m - 3.0 * u_xz_m);
              feqs[13] = rhoOver36 * (oneMinus15uSq + 4.5 * u_xz_m * u_xz_m + 3.0 * u_xz_m);
              feqs[14] = rhoOver36 * (oneMinus15uSq + 4.5 * u_xz_p * u_xz_p - 3.0 * u_xz_p);

              feqs[15] = rhoOver36 * (oneMinus15uSq + 4.5 * u_yz_p * u_yz_p + 3.0 * u_yz_p);
              feqs[16] = rhoOver36 * (oneMinus15uSq + 4.5 * u_yz_m * u_yz_m - 3.0 * u_yz_m);
              feqs[17] = rhoOver36 * (oneMinus15uSq + 4.5 * u_yz_m * u_yz_m + 3.0 * u_yz_m);
              feqs[18] = rhoOver36 * (oneMinus15uSq + 4.5 * u_yz_p * u_yz_p - 3.0 * u_yz_p);

              let omegaLoc = omega0;
              if (useLES) {
                const fneq1 = f1 - feqs[1]!;
                const fneq2 = f2 - feqs[2]!;
                const fneq3 = f3 - feqs[3]!;
                const fneq4 = f4 - feqs[4]!;
                const fneq5 = f5 - feqs[5]!;
                const fneq6 = f6 - feqs[6]!;
                const fneq7 = f7 - feqs[7]!;
                const fneq8 = f8 - feqs[8]!;
                const fneq9 = f9 - feqs[9]!;
                const fneq10 = f10 - feqs[10]!;
                const fneq11 = f11 - feqs[11]!;
                const fneq12 = f12 - feqs[12]!;
                const fneq13 = f13 - feqs[13]!;
                const fneq14 = f14 - feqs[14]!;
                const fneq15 = f15 - feqs[15]!;
                const fneq16 = f16 - feqs[16]!;
                const fneq17 = f17 - feqs[17]!;
                const fneq18 = f18 - feqs[18]!;

                const piXX = fneq1 + fneq2 + (fneq7 + fneq8 + fneq9 + fneq10) + (fneq11 + fneq12 + fneq13 + fneq14);
                const piYY = fneq3 + fneq4 + (fneq7 + fneq8 + fneq9 + fneq10) + (fneq15 + fneq16 + fneq17 + fneq18);
                const piZZ = fneq5 + fneq6 + (fneq11 + fneq12 + fneq13 + fneq14) + (fneq15 + fneq16 + fneq17 + fneq18);
                const piXY = fneq7 - fneq8 - fneq9 + fneq10;
                const piZX = fneq11 - fneq12 - fneq13 + fneq14;
                const piYZ = fneq15 - fneq16 - fneq17 + fneq18;

                const piMag = Math.sqrt(
                  2 * (piXX * piXX + piYY * piYY + piZZ * piZZ + 2 * (piXY * piXY + piYZ * piYZ + piZX * piZX)),
                );
                const tau0 = tau;
                const deltaTau =
                  0.5 * (Math.sqrt(tau0 * tau0 + 18.0 * Math.SQRT2 * CsSq * (piMag / Math.max(1e-6, rho))) - tau0);
                omegaLoc = 1.0 / (tau0 + deltaTau);
              }

              // Store post-collision distributions in src
              src[0 * totalCells + cellIdx] = f0 - omegaLoc * (f0 - feqs[0]!);
              src[1 * totalCells + cellIdx] = f1 - omegaLoc * (f1 - feqs[1]!);
              src[2 * totalCells + cellIdx] = f2 - omegaLoc * (f2 - feqs[2]!);
              src[3 * totalCells + cellIdx] = f3 - omegaLoc * (f3 - feqs[3]!);
              src[4 * totalCells + cellIdx] = f4 - omegaLoc * (f4 - feqs[4]!);
              src[5 * totalCells + cellIdx] = f5 - omegaLoc * (f5 - feqs[5]!);
              src[6 * totalCells + cellIdx] = f6 - omegaLoc * (f6 - feqs[6]!);
              src[7 * totalCells + cellIdx] = f7 - omegaLoc * (f7 - feqs[7]!);
              src[8 * totalCells + cellIdx] = f8 - omegaLoc * (f8 - feqs[8]!);
              src[9 * totalCells + cellIdx] = f9 - omegaLoc * (f9 - feqs[9]!);
              src[10 * totalCells + cellIdx] = f10 - omegaLoc * (f10 - feqs[10]!);
              src[11 * totalCells + cellIdx] = f11 - omegaLoc * (f11 - feqs[11]!);
              src[12 * totalCells + cellIdx] = f12 - omegaLoc * (f12 - feqs[12]!);
              src[13 * totalCells + cellIdx] = f13 - omegaLoc * (f13 - feqs[13]!);
              src[14 * totalCells + cellIdx] = f14 - omegaLoc * (f14 - feqs[14]!);
              src[15 * totalCells + cellIdx] = f15 - omegaLoc * (f15 - feqs[15]!);
              src[16 * totalCells + cellIdx] = f16 - omegaLoc * (f16 - feqs[16]!);
              src[17 * totalCells + cellIdx] = f17 - omegaLoc * (f17 - feqs[17]!);
              src[18 * totalCells + cellIdx] = f18 - omegaLoc * (f18 - feqs[18]!);
            }
          }
        }

        // Pass 2: Streaming, Bouzidi curved wall interpolation (using genuine post-collision src), and momentum exchange
        for (let z = 0; z < nz; z++) {
          for (let y = 0; y < ny; y++) {
            for (let x = 0; x < nx; x++) {
              const cellIdx = x + y * nx + z * nx * ny;
              const cType = this.cellTypes[cellIdx];

              if (cType === LbmCellType.ObstacleSolid || cType === LbmCellType.ChannelWall) {
                continue;
              }

              const rho = this.rho[cellIdx]!;
              const ux = this.vx[cellIdx]! * (dt / dx);
              const uy = this.vy[cellIdx]! * (dt / dx);
              const uz = this.vz[cellIdx]! * (dt / dx);
              const uSq = ux * ux + uy * uy + uz * uz;

              for (let i = 0; i < 19; i++) {
                fPost[i] = src[i * totalCells + cellIdx]!;
              }

              for (let i = 0; i < 19; i++) {
                const nxCoord = x + CX[i]!;
                const nyCoord = y + CY[i]!;
                const nzCoord = z + CZ[i]!;

                // Handle domain boundary wrap or bounce (or open outlet equilibrium)
                if (nxCoord < 0 || nxCoord >= nx || nyCoord < 0 || nyCoord >= ny || nzCoord < 0 || nzCoord >= nz) {
                  const oppI = OPP[i]!;
                  if (nxCoord >= nx && cType === LbmCellType.PressureOutlet) {
                    const cuOpp = CX[oppI]! * ux + CY[oppI]! * uy + CZ[oppI]! * uz;
                    dst[oppI * totalCells + cellIdx] =
                      W[oppI]! * rho * (1.0 + 3.0 * cuOpp + 4.5 * cuOpp * cuOpp - 1.5 * uSq);
                  } else {
                    dst[oppI * totalCells + cellIdx] = fPost[i]!;
                  }
                  continue;
                }

                const targetIdx = nxCoord + nyCoord * nx + nzCoord * nx * ny;
                const targetType = this.cellTypes[targetIdx];

                if (targetType === LbmCellType.ObstacleSolid || targetType === LbmCellType.ChannelWall) {
                  let fRefl = fPost[i]!;

                  // Bouzidi curved boundary interpolation using post-collision distributions from Pass 1
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
    }

    // If numSteps === 0 (e.g. called after stepGpu macro readback), evaluate momentum exchange across obstacle links
    if (numSteps === 0) {
      const src = this.currentPing ? f0 : f1;
      for (let z = 0; z < nz; z++) {
        for (let y = 0; y < ny; y++) {
          for (let x = 0; x < nx; x++) {
            const cellIdx = x + y * nx + z * nx * ny;
            const cType = this.cellTypes[cellIdx];
            if (cType === LbmCellType.ObstacleSolid || cType === LbmCellType.ChannelWall) continue;
            const rho = this.rho[cellIdx] ?? 1.0;
            const ux = (this.vx[cellIdx] ?? 0) * (dt / dx);
            const uy = (this.vy[cellIdx] ?? 0) * (dt / dx);
            const uz = (this.vz[cellIdx] ?? 0) * (dt / dx);
            const uSq = ux * ux + uy * uy + uz * uz;
            for (let i = 1; i < 19; i++) {
              const nxCoord = x + CX[i]!;
              const nyCoord = y + CY[i]!;
              const nzCoord = z + CZ[i]!;
              if (nxCoord < 0 || nxCoord >= nx || nyCoord < 0 || nyCoord >= ny || nzCoord < 0 || nzCoord >= nz) {
                continue;
              }
              const targetIdx = nxCoord + nyCoord * nx + nzCoord * nx * ny;
              if (this.cellTypes[targetIdx] === LbmCellType.ObstacleSolid) {
                const fi = src[i * totalCells + cellIdx]!;
                const cu = CX[i]! * ux + CY[i]! * uy + CZ[i]! * uz;
                const feq = W[i]! * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * uSq);
                const fOut = fi > 0 ? fi - omega0 * (fi - feq) : feq;
                let fRefl = fOut;
                if (
                  this.movingWallVelocity[0] !== 0 ||
                  this.movingWallVelocity[1] !== 0 ||
                  this.movingWallVelocity[2] !== 0
                ) {
                  const uwx = this.movingWallVelocity[0] * (dt / dx);
                  const uwy = this.movingWallVelocity[1] * (dt / dx);
                  const uwz = this.movingWallVelocity[2] * (dt / dx);
                  const cuW = CX[i]! * uwx + CY[i]! * uwy + CZ[i]! * uwz;
                  fRefl -= 6.0 * W[i]! * rho * cuW;
                }
                const dP = fOut + fRefl;
                dragLatX += dP * CX[i]!;
                dragLatY += dP * CY[i]!;
                dragLatZ += dP * CZ[i]!;
              }
            }
          }
        }
      }
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

    // Cross-sectional inlet-to-outlet pressure drop
    let inletRhoSum = 0.0;
    let inletCount = 0;
    let outletRhoSum = 0.0;
    let outletCount = 0;
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        const inIdx = 0 + y * nx + z * nx * ny;
        if (this.cellTypes[inIdx] !== LbmCellType.ObstacleSolid && this.cellTypes[inIdx] !== LbmCellType.ChannelWall) {
          inletRhoSum += this.rho[inIdx]!;
          inletCount++;
        }
        const outIdx = nx - 1 + y * nx + z * nx * ny;
        if (
          this.cellTypes[outIdx] !== LbmCellType.ObstacleSolid &&
          this.cellTypes[outIdx] !== LbmCellType.ChannelWall
        ) {
          outletRhoSum += this.rho[outIdx]!;
          outletCount++;
        }
      }
    }
    const avgInletRho = inletCount > 0 ? inletRhoSum / inletCount : this.rho[0]!;
    const avgOutletRho = outletCount > 0 ? outletRhoSum / outletCount : this.rho[nx - 1]!;

    const csSq = 1.0 / 3.0;
    const pressScale = csSq * density * Math.pow(dx / dt, 2);
    const channelArea = Math.max(1e-12, ny * dx * (nz * dx));
    const inVxPhys = inletV[0];
    const inMagPhys = Math.hypot(inletV[0], inletV[1], inletV[2]);
    const pDrop =
      inMagPhys > 0
        ? fx / channelArea + 0.5 * density * inVxPhys * inMagPhys
        : (avgInletRho - avgOutletRho) * pressScale;

    return {
      aerodynamicForceN: [fx, fy, fz],
      maxVelocity: maxVel,
      pressureDropPa: pDrop,
    };
  }

  /**
   * Releases all allocated WebGPU storage/uniform buffers and destroys the GPU device.
   */
  public destroy(): void {
    this.gpuUniformBuffer?.destroy?.();
    this.gpuCellTypesBuffer?.destroy?.();
    this.gpuPingBuffer?.destroy?.();
    this.gpuPongBuffer?.destroy?.();
    this.gpuMacroBuffer?.destroy?.();
    this.gpuDeltaWallBuffer?.destroy?.();
    this.gpuDragOutputBuffer?.destroy?.();
    this.gpuDevice?.destroy?.();
    this.gpuUniformBuffer = null;
    this.gpuCellTypesBuffer = null;
    this.gpuPingBuffer = null;
    this.gpuPongBuffer = null;
    this.gpuMacroBuffer = null;
    this.gpuDeltaWallBuffer = null;
    this.gpuDragOutputBuffer = null;
    this.gpuBindGroup0 = null;
    this.gpuBindGroup1 = null;
    this.gpuPipeline = null;
    this.gpuDevice = null;
    this.gpuInitialized = false;
  }
}
