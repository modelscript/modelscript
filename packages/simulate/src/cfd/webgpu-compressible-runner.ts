// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Live WebGPU Compute Pipeline Runner for 3D Compressible FVM
 * (MUSCL + HLLC + SSP-RK3) and 3D Flow Feature Extraction (Q-criterion, Vorticity, Ducros).
 *
 * Wraps `COMPRESSIBLE_FVM_HLLC_WGSL` (`compute_hllc_rhs`, `ssp_rk3_update`) and
 * `FLOW_FEATURES_WGSL` (`extract_flow_features`) with zero-copy WebGPU dispatch when a
 * `GPUDevice` is available and deterministic IEEE-754 Float64 CPU fallback via
 * `CompressibleFvmSolver` and `extractFlowFeatures` in headless environments.
 */

import type { CompressibleFieldArena } from "./compressible-arena.js";
import { type BoundaryConditionType, type CompressibleFvmOptions, CompressibleFvmSolver } from "./compressible-fvm.js";
import { extractFlowFeatures, FLOW_FEATURES_WGSL, type FlowFeaturesResult } from "./flow-features.js";
import { COMPRESSIBLE_FVM_HLLC_WGSL } from "./shaders/compressible-fvm.wgsl.js";

// Numeric WebGPU buffer usage & map mode flags (safe in headless Node without WebGPU globals)
const GPU_USAGE_MAP_READ = 0x0001;
const GPU_USAGE_COPY_SRC = 0x0004;
const GPU_USAGE_COPY_DST = 0x0008;
const GPU_USAGE_UNIFORM = 0x0040;
const GPU_USAGE_STORAGE = 0x0080;
const GPU_MAP_READ = 0x0001;

export interface WebGPUInitResult {
  readonly backend: "webgpu" | "cpu";
  readonly pipelines: string[];
}

export interface CompressibleStepResult {
  readonly steps: number;
  readonly elapsedTime: number;
  readonly lastDt: number;
  readonly backend: "webgpu" | "cpu";
}

export type FlowFeaturesGpuResult = FlowFeaturesResult & {
  readonly backend: "webgpu" | "cpu";
};

function encodeBoundaryCondition(bc: BoundaryConditionType): number {
  if (bc === "periodic") return 1;
  if (bc === "reflective") return 2;
  return 0; // extrapolation
}

async function resolveGpuDevice(explicitDevice?: GPUDevice | null): Promise<GPUDevice | null> {
  if (explicitDevice) {
    return explicitDevice;
  }
  if (explicitDevice === null) {
    return null;
  }

  const g =
    typeof globalThis !== "undefined"
      ? (globalThis as {
          navigator?: { gpu?: GPU | undefined } | undefined;
          __modelscript_native_gpu__?: GPU | undefined;
        })
      : undefined;

  const gpuProvider = g?.__modelscript_native_gpu__ ?? g?.navigator?.gpu;
  if (!gpuProvider || typeof gpuProvider.requestAdapter !== "function") {
    return null;
  }

  try {
    const adapter = await gpuProvider.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) {
      return null;
    }
    return await adapter.requestDevice();
  } catch {
    return null;
  }
}

/**
 * Live WebGPU Compute Pipeline Runner for 3D Compressible Euler/Navier-Stokes FVM
 * and 3D Flow Feature Extraction, with automatic deterministic CPU fallback.
 */
export class WebGPUCompressibleRunner {
  public readonly arena: CompressibleFieldArena;
  public readonly solver: CompressibleFvmSolver;
  public readonly options: CompressibleFvmOptions;

  // WebGPU device & pipelines
  private gpuDevice: GPUDevice | null = null;
  private rhsPipeline: GPUComputePipeline | null = null;
  private rk3Pipeline: GPUComputePipeline | null = null;
  private flowFeaturesPipeline: GPUComputePipeline | null = null;

  // Compressible FVM GPU buffers
  private uniformBuffer: GPUBuffer | null = null;
  private uBaseBuffer: GPUBuffer | null = null;
  private uPingBuffer: GPUBuffer | null = null;
  private uPongBuffer: GPUBuffer | null = null;
  private rhsBuffer: GPUBuffer | null = null;
  private stateReadbackBuffer: GPUBuffer | null = null;

  // Flow features GPU buffers
  private flowUniformBuffer: GPUBuffer | null = null;
  private vxBuffer: GPUBuffer | null = null;
  private vyBuffer: GPUBuffer | null = null;
  private vzBuffer: GPUBuffer | null = null;
  private qCriterionBuffer: GPUBuffer | null = null;
  private ducrosBuffer: GPUBuffer | null = null;
  private vorticityBuffer: GPUBuffer | null = null;
  private qReadbackBuffer: GPUBuffer | null = null;
  private ducrosReadbackBuffer: GPUBuffer | null = null;
  private vorticityReadbackBuffer: GPUBuffer | null = null;

  private gpuInitialized = false;
  private readonly allocatedBuffers: GPUBuffer[] = [];

  constructor(arena: CompressibleFieldArena, options: CompressibleFvmOptions = {}) {
    this.arena = arena;
    this.options = options;
    this.solver = new CompressibleFvmSolver(arena, options);
  }

  public get isGpuInitialized(): boolean {
    return this.gpuInitialized && this.gpuDevice !== null;
  }

  private trackBuffer(buffer: GPUBuffer): GPUBuffer {
    this.allocatedBuffers.push(buffer);
    return buffer;
  }

  /**
   * Initialize WebGPU shader modules, compute pipelines, ping-pong conserved-state storage
   * buffers, uniform buffers, and flow-feature output buffers.
   * Falls back cleanly to CPU mode when no `GPUDevice` is available.
   */
  public async initWebGPU(device?: GPUDevice | null): Promise<WebGPUInitResult> {
    if (this.gpuInitialized && this.gpuDevice) {
      return {
        backend: "webgpu",
        pipelines: ["compute_hllc_rhs", "ssp_rk3_update", "extract_flow_features"],
      };
    }

    const resolvedDevice = await resolveGpuDevice(device);
    if (!resolvedDevice) {
      return { backend: "cpu", pipelines: [] };
    }

    this.gpuDevice = resolvedDevice;

    // 1. Compile WGSL shader modules
    const compressibleModule = resolvedDevice.createShaderModule({
      label: "Compressible FVM HLLC Shader",
      code: COMPRESSIBLE_FVM_HLLC_WGSL,
    });
    const flowFeaturesModule = resolvedDevice.createShaderModule({
      label: "Flow Features Shader",
      code: FLOW_FEATURES_WGSL,
    });

    // 2. Create compute pipelines
    this.rhsPipeline = resolvedDevice.createComputePipeline({
      label: "Compressible FVM HLLC RHS Pipeline",
      layout: "auto",
      compute: { module: compressibleModule, entryPoint: "compute_hllc_rhs" },
    });
    this.rk3Pipeline = resolvedDevice.createComputePipeline({
      label: "Compressible FVM SSP-RK3 Pipeline",
      layout: "auto",
      compute: { module: compressibleModule, entryPoint: "ssp_rk3_update" },
    });
    this.flowFeaturesPipeline = resolvedDevice.createComputePipeline({
      label: "Flow Features Extraction Pipeline",
      layout: "auto",
      compute: { module: flowFeaturesModule, entryPoint: "extract_flow_features" },
    });

    const totalCells = this.arena.totalCells;
    const stateBytes = Math.max(5 * totalCells * 4, 16);
    const scalarBytes = Math.max(totalCells * 4, 16);

    // 3. Allocate Compressible FVM uniform & ping-pong conserved-state storage buffers
    this.uniformBuffer = this.trackBuffer(
      resolvedDevice.createBuffer({
        label: "Compressible FVM Uniforms",
        size: 64, // 16 * 4 bytes
        usage: GPU_USAGE_UNIFORM | GPU_USAGE_COPY_DST,
      }),
    );

    const stateStorageUsage = GPU_USAGE_STORAGE | GPU_USAGE_COPY_DST | GPU_USAGE_COPY_SRC;
    this.uBaseBuffer = this.trackBuffer(
      resolvedDevice.createBuffer({
        label: "Compressible FVM u_base",
        size: stateBytes,
        usage: stateStorageUsage,
      }),
    );
    this.uPingBuffer = this.trackBuffer(
      resolvedDevice.createBuffer({
        label: "Compressible FVM u_ping",
        size: stateBytes,
        usage: stateStorageUsage,
      }),
    );
    this.uPongBuffer = this.trackBuffer(
      resolvedDevice.createBuffer({
        label: "Compressible FVM u_pong",
        size: stateBytes,
        usage: stateStorageUsage,
      }),
    );
    this.rhsBuffer = this.trackBuffer(
      resolvedDevice.createBuffer({
        label: "Compressible FVM rhs",
        size: stateBytes,
        usage: GPU_USAGE_STORAGE | GPU_USAGE_COPY_DST,
      }),
    );
    this.stateReadbackBuffer = this.trackBuffer(
      resolvedDevice.createBuffer({
        label: "Compressible FVM State Readback",
        size: stateBytes,
        usage: GPU_USAGE_MAP_READ | GPU_USAGE_COPY_DST,
      }),
    );

    // Upload initial conserved state (5 SoA variables in f32)
    this.uploadStateToBuffer(this.uPingBuffer);

    // 4. Allocate Flow Features uniform, input velocity, and output diagnostic buffers
    this.flowUniformBuffer = this.trackBuffer(
      resolvedDevice.createBuffer({
        label: "Flow Features Uniforms",
        size: 32, // 8 * 4 bytes
        usage: GPU_USAGE_UNIFORM | GPU_USAGE_COPY_DST,
      }),
    );
    this.vxBuffer = this.trackBuffer(
      resolvedDevice.createBuffer({
        label: "Flow Features vx",
        size: scalarBytes,
        usage: GPU_USAGE_STORAGE | GPU_USAGE_COPY_DST,
      }),
    );
    this.vyBuffer = this.trackBuffer(
      resolvedDevice.createBuffer({
        label: "Flow Features vy",
        size: scalarBytes,
        usage: GPU_USAGE_STORAGE | GPU_USAGE_COPY_DST,
      }),
    );
    this.vzBuffer = this.trackBuffer(
      resolvedDevice.createBuffer({
        label: "Flow Features vz",
        size: scalarBytes,
        usage: GPU_USAGE_STORAGE | GPU_USAGE_COPY_DST,
      }),
    );
    this.qCriterionBuffer = this.trackBuffer(
      resolvedDevice.createBuffer({
        label: "Flow Features Q-Criterion",
        size: scalarBytes,
        usage: GPU_USAGE_STORAGE | GPU_USAGE_COPY_SRC,
      }),
    );
    this.ducrosBuffer = this.trackBuffer(
      resolvedDevice.createBuffer({
        label: "Flow Features Ducros Sensor",
        size: scalarBytes,
        usage: GPU_USAGE_STORAGE | GPU_USAGE_COPY_SRC,
      }),
    );
    this.vorticityBuffer = this.trackBuffer(
      resolvedDevice.createBuffer({
        label: "Flow Features Vorticity Mag",
        size: scalarBytes,
        usage: GPU_USAGE_STORAGE | GPU_USAGE_COPY_SRC,
      }),
    );
    this.qReadbackBuffer = this.trackBuffer(
      resolvedDevice.createBuffer({
        label: "Flow Features Q Readback",
        size: scalarBytes,
        usage: GPU_USAGE_MAP_READ | GPU_USAGE_COPY_DST,
      }),
    );
    this.ducrosReadbackBuffer = this.trackBuffer(
      resolvedDevice.createBuffer({
        label: "Flow Features Ducros Readback",
        size: scalarBytes,
        usage: GPU_USAGE_MAP_READ | GPU_USAGE_COPY_DST,
      }),
    );
    this.vorticityReadbackBuffer = this.trackBuffer(
      resolvedDevice.createBuffer({
        label: "Flow Features Vorticity Readback",
        size: scalarBytes,
        usage: GPU_USAGE_MAP_READ | GPU_USAGE_COPY_DST,
      }),
    );

    this.gpuInitialized = true;
    return {
      backend: "webgpu",
      pipelines: ["compute_hllc_rhs", "ssp_rk3_update", "extract_flow_features"],
    };
  }

  /**
   * Advance the compressible FVM solution on CPU using `CompressibleFvmSolver`.
   */
  public step(numSteps = 1, cfl?: number): CompressibleStepResult {
    const steps = Math.max(0, Math.floor(numSteps));
    let elapsedTime = 0.0;
    let lastDt = 0.0;
    const cflScale = cfl !== undefined && this.solver.cfl > 0 ? cfl / this.solver.cfl : 1.0;

    for (let s = 0; s < steps; s++) {
      const dt = this.solver.computeCflTimestep() * cflScale;
      lastDt = this.solver.stepSspRk3(dt);
      elapsedTime += lastDt;
    }

    return {
      steps,
      elapsedTime,
      lastDt,
      backend: "cpu",
    };
  }

  /**
   * Advance the compressible FVM solution on WebGPU by dispatching `compute_hllc_rhs`
   * and `ssp_rk3_update` across all 3 SSP-RK3 stages per step, or fall back cleanly
   * to CPU `step()` when WebGPU is not initialized.
   */
  public async stepGpu(numSteps = 1, cfl?: number): Promise<CompressibleStepResult> {
    if (
      !this.gpuInitialized ||
      !this.gpuDevice ||
      !this.rhsPipeline ||
      !this.rk3Pipeline ||
      !this.uniformBuffer ||
      !this.uBaseBuffer ||
      !this.uPingBuffer ||
      !this.uPongBuffer ||
      !this.rhsBuffer ||
      !this.stateReadbackBuffer
    ) {
      return this.step(numSteps, cfl);
    }

    const steps = Math.max(0, Math.floor(numSteps));
    if (steps === 0) {
      return { steps: 0, elapsedTime: 0.0, lastDt: 0.0, backend: "webgpu" };
    }

    const device = this.gpuDevice;
    const totalCells = this.arena.totalCells;
    const stateCount = 5 * totalCells;
    const stateBytes = stateCount * 4;
    const workgroups = Math.ceil(totalCells / 64);
    const cflScale = cfl !== undefined && this.solver.cfl > 0 ? cfl / this.solver.cfl : 1.0;

    // Sync host arena state -> uPingBuffer
    this.uploadStateToBuffer(this.uPingBuffer);

    let currBuf = this.uPingBuffer;
    let nextBuf = this.uPongBuffer;
    let elapsedTime = 0.0;
    let lastDt = 0.0;

    const rhsLayout = this.rhsPipeline.getBindGroupLayout(0);
    const rk3Layout = this.rk3Pipeline.getBindGroupLayout(0);

    for (let s = 0; s < steps; s++) {
      const dt = this.solver.computeCflTimestep() * cflScale;
      lastDt = dt;
      elapsedTime += dt;

      // Save U^n into uBaseBuffer at start of SSP-RK3 step
      const copyEncoder = device.createCommandEncoder();
      copyEncoder.copyBufferToBuffer(currBuf, 0, this.uBaseBuffer, 0, stateBytes);
      device.queue.submit([copyEncoder.finish()]);

      // 3-stage Shu-Osher SSP-RK3
      for (let stage = 0; stage < 3; stage++) {
        this.writeCompressibleUniforms(dt, stage);

        const rhsBindGroup = device.createBindGroup({
          layout: rhsLayout,
          entries: [
            { binding: 0, resource: { buffer: this.uniformBuffer } },
            { binding: 1, resource: { buffer: currBuf } },
            { binding: 2, resource: { buffer: this.uBaseBuffer } },
            { binding: 3, resource: { buffer: this.rhsBuffer } },
            { binding: 4, resource: { buffer: nextBuf } },
          ],
        });

        const rk3BindGroup = device.createBindGroup({
          layout: rk3Layout,
          entries: [
            { binding: 0, resource: { buffer: this.uniformBuffer } },
            { binding: 1, resource: { buffer: currBuf } },
            { binding: 2, resource: { buffer: this.uBaseBuffer } },
            { binding: 3, resource: { buffer: this.rhsBuffer } },
            { binding: 4, resource: { buffer: nextBuf } },
          ],
        });

        const encoder = device.createCommandEncoder();

        const rhsPass = encoder.beginComputePass();
        rhsPass.setPipeline(this.rhsPipeline);
        rhsPass.setBindGroup(0, rhsBindGroup);
        rhsPass.dispatchWorkgroups(workgroups, 1, 1);
        rhsPass.end();

        const rk3Pass = encoder.beginComputePass();
        rk3Pass.setPipeline(this.rk3Pipeline);
        rk3Pass.setBindGroup(0, rk3BindGroup);
        rk3Pass.dispatchWorkgroups(workgroups, 1, 1);
        rk3Pass.end();

        device.queue.submit([encoder.finish()]);

        // Ping-pong swap: nextBuf becomes currBuf for next stage
        const tmp = currBuf;
        currBuf = nextBuf;
        nextBuf = tmp;
      }
    }

    // Read back final conserved state to CPU arena
    const readEncoder = device.createCommandEncoder();
    readEncoder.copyBufferToBuffer(currBuf, 0, this.stateReadbackBuffer, 0, stateBytes);
    device.queue.submit([readEncoder.finish()]);

    await this.stateReadbackBuffer.mapAsync(GPU_MAP_READ);
    const mapped = new Float32Array(this.stateReadbackBuffer.getMappedRange().slice(0));
    this.stateReadbackBuffer.unmap();

    const copyLen = Math.min(stateCount, mapped.length, this.arena.stateBuffer.length);
    for (let i = 0; i < copyLen; i++) {
      this.arena.stateBuffer[i] = mapped[i]!;
    }

    return {
      steps,
      elapsedTime,
      lastDt,
      backend: "webgpu",
    };
  }

  /**
   * Extract 3D flow features (Q-criterion, lambda_2, vorticity magnitude, divergence,
   * Ducros shock sensor, and density gradient magnitude) on CPU.
   */
  public extractFeatures(ducrosEps = 1e-20): FlowFeaturesResult {
    const fields = this.arena.extractFields();
    return extractFlowFeatures(
      this.arena.nx,
      this.arena.ny,
      this.arena.nz,
      this.arena.dx,
      fields.u,
      fields.v,
      fields.w,
      this.arena.rho,
      ducrosEps,
    );
  }

  /**
   * Extract 3D flow features on WebGPU using `extract_flow_features` (`FLOW_FEATURES_WGSL`),
   * or fall back cleanly to CPU `extractFeatures()` when headless.
   */
  public async extractFeaturesGpu(ducrosEps = 1e-20): Promise<FlowFeaturesGpuResult> {
    if (
      !this.gpuInitialized ||
      !this.gpuDevice ||
      !this.flowFeaturesPipeline ||
      !this.flowUniformBuffer ||
      !this.vxBuffer ||
      !this.vyBuffer ||
      !this.vzBuffer ||
      !this.qCriterionBuffer ||
      !this.ducrosBuffer ||
      !this.vorticityBuffer ||
      !this.qReadbackBuffer ||
      !this.ducrosReadbackBuffer ||
      !this.vorticityReadbackBuffer
    ) {
      return { ...this.extractFeatures(ducrosEps), backend: "cpu" };
    }

    const device = this.gpuDevice;
    const { nx, ny, nz, dx, totalCells } = this.arena;
    const scalarBytes = totalCells * 4;

    const fields = this.arena.extractFields();
    const vxF32 = new Float32Array(totalCells);
    const vyF32 = new Float32Array(totalCells);
    const vzF32 = new Float32Array(totalCells);
    for (let i = 0; i < totalCells; i++) {
      vxF32[i] = fields.u[i]!;
      vyF32[i] = fields.v[i]!;
      vzF32[i] = fields.w[i]!;
    }

    device.queue.writeBuffer(this.vxBuffer, 0, vxF32);
    device.queue.writeBuffer(this.vyBuffer, 0, vyF32);
    device.queue.writeBuffer(this.vzBuffer, 0, vzF32);

    const uBufData = new ArrayBuffer(32);
    const uView = new DataView(uBufData);
    uView.setUint32(0, nx, true);
    uView.setUint32(4, ny, true);
    uView.setUint32(8, nz, true);
    uView.setUint32(12, 0, true);
    uView.setFloat32(16, dx, true);
    uView.setFloat32(20, ducrosEps, true);
    uView.setFloat32(24, 0, true);
    uView.setFloat32(28, 0, true);
    device.queue.writeBuffer(this.flowUniformBuffer, 0, uBufData);

    const bindGroup = device.createBindGroup({
      layout: this.flowFeaturesPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.flowUniformBuffer } },
        { binding: 1, resource: { buffer: this.vxBuffer } },
        { binding: 2, resource: { buffer: this.vyBuffer } },
        { binding: 3, resource: { buffer: this.vzBuffer } },
        { binding: 4, resource: { buffer: this.qCriterionBuffer } },
        { binding: 5, resource: { buffer: this.ducrosBuffer } },
        { binding: 6, resource: { buffer: this.vorticityBuffer } },
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.flowFeaturesPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(nx / 4), Math.ceil(ny / 4), Math.ceil(nz / 4));
    pass.end();

    encoder.copyBufferToBuffer(this.qCriterionBuffer, 0, this.qReadbackBuffer, 0, scalarBytes);
    encoder.copyBufferToBuffer(this.ducrosBuffer, 0, this.ducrosReadbackBuffer, 0, scalarBytes);
    encoder.copyBufferToBuffer(this.vorticityBuffer, 0, this.vorticityReadbackBuffer, 0, scalarBytes);
    device.queue.submit([encoder.finish()]);

    await Promise.all([
      this.qReadbackBuffer.mapAsync(GPU_MAP_READ),
      this.ducrosReadbackBuffer.mapAsync(GPU_MAP_READ),
      this.vorticityReadbackBuffer.mapAsync(GPU_MAP_READ),
    ]);

    const qGpu = new Float32Array(this.qReadbackBuffer.getMappedRange().slice(0));
    const ducrosGpu = new Float32Array(this.ducrosReadbackBuffer.getMappedRange().slice(0));
    const vortGpu = new Float32Array(this.vorticityReadbackBuffer.getMappedRange().slice(0));

    this.qReadbackBuffer.unmap();
    this.ducrosReadbackBuffer.unmap();
    this.vorticityReadbackBuffer.unmap();

    // Populate complementary fields (velocityGradient, lambda2, divergence, densityGradientMagnitude)
    const base = extractFlowFeatures(nx, ny, nz, dx, fields.u, fields.v, fields.w, this.arena.rho, ducrosEps);
    const qCriterion = new Float64Array(totalCells);
    const ducrosSensor = new Float64Array(totalCells);
    const vorticityMagnitude = new Float64Array(totalCells);
    for (let i = 0; i < totalCells; i++) {
      qCriterion[i] = qGpu[i] ?? 0;
      ducrosSensor[i] = ducrosGpu[i] ?? 0;
      vorticityMagnitude[i] = vortGpu[i] ?? 0;
    }

    return {
      ...base,
      qCriterion,
      ducrosSensor,
      vorticityMagnitude,
      backend: "webgpu",
    };
  }

  /**
   * Release all allocated GPU buffers and reset WebGPU pipeline state.
   */
  public destroy(): void {
    for (const buf of this.allocatedBuffers) {
      buf.destroy();
    }
    this.allocatedBuffers.length = 0;

    this.uniformBuffer = null;
    this.uBaseBuffer = null;
    this.uPingBuffer = null;
    this.uPongBuffer = null;
    this.rhsBuffer = null;
    this.stateReadbackBuffer = null;

    this.flowUniformBuffer = null;
    this.vxBuffer = null;
    this.vyBuffer = null;
    this.vzBuffer = null;
    this.qCriterionBuffer = null;
    this.ducrosBuffer = null;
    this.vorticityBuffer = null;
    this.qReadbackBuffer = null;
    this.ducrosReadbackBuffer = null;
    this.vorticityReadbackBuffer = null;

    this.rhsPipeline = null;
    this.rk3Pipeline = null;
    this.flowFeaturesPipeline = null;
    this.gpuDevice = null;
    this.gpuInitialized = false;
  }

  private uploadStateToBuffer(target: GPUBuffer): void {
    if (!this.gpuDevice) return;
    const count = 5 * this.arena.totalCells;
    const f32 = new Float32Array(count);
    const src = this.arena.stateBuffer;
    for (let i = 0; i < count; i++) {
      f32[i] = src[i]!;
    }
    this.gpuDevice.queue.writeBuffer(target, 0, f32);
  }

  private writeCompressibleUniforms(dt: number, rkStage: number): void {
    if (!this.gpuDevice || !this.uniformBuffer) return;
    const data = new ArrayBuffer(64);
    const view = new DataView(data);
    view.setUint32(0, this.arena.nx, true);
    view.setUint32(4, this.arena.ny, true);
    view.setUint32(8, this.arena.nz, true);
    view.setUint32(12, this.arena.totalCells, true);
    view.setFloat32(16, this.arena.dx, true);
    view.setFloat32(20, this.arena.dy, true);
    view.setFloat32(24, this.arena.dz, true);
    view.setFloat32(28, dt, true);
    view.setFloat32(32, this.arena.gamma, true);
    view.setUint32(36, rkStage, true);
    view.setUint32(40, encodeBoundaryCondition(this.solver.bcX), true);
    view.setUint32(44, encodeBoundaryCondition(this.solver.bcY), true);
    view.setUint32(48, encodeBoundaryCondition(this.solver.bcZ), true);
    view.setUint32(52, 0, true);
    view.setUint32(56, 0, true);
    view.setUint32(60, 0, true);
    this.gpuDevice.queue.writeBuffer(this.uniformBuffer, 0, data);
  }
}
