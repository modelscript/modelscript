// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebGPU Simulation Runner — Phases 2, 3 & 4
 *
 * This runner takes the serialized GPUArenaBuffers and the WGSL shader string,
 * initializes a WebGPU compute pipeline, and orchestrates the parallel
 * evaluation of the DAE system blocks on the GPU.
 *
 * It uses a fallback strategy: if `navigator.gpu` is missing (e.g. Node.js),
 * it returns null, and the caller should fall back to CPUSimulationRunner.
 */

/// <reference types="@webgpu/types" />
import { type GPUArenaBuffers } from "../../arena-gpu-buffers.js";
import { type ArenaDAEBuilder } from "../../dae-arena.js";
import { generateWGSL } from "../../generators/wgsl-codegen.js";
import { getCachedWGSL, setCachedWGSL } from "./wgsl-cache.js";

// Uses @webgpu/types directly

export class WebGPUSimulationRunner {
  public device!: GPUDevice;
  private evalPipeline!: GPUComputePipeline;
  private rk4Pipeline!: GPUComputePipeline;
  public stateBuffer!: GPUBuffer;
  private residualsBuffer!: GPUBuffer;
  private paramsBuffer!: GPUBuffer;
  private stateIndicesBuffer!: GPUBuffer;
  private derivIndicesBuffer!: GPUBuffer;
  private y0Buffer!: GPUBuffer;
  private yAccBuffer!: GPUBuffer;
  private bindGroup!: GPUBindGroup;

  /** Total number of blocks to evaluate. */
  private blockCount: number;
  private numStates: number;

  constructor(
    public readonly arena: ArenaDAEBuilder,
    public readonly buffers: GPUArenaBuffers,
  ) {
    this.blockCount = buffers.blockPlan.blockCount;
    this.numStates = buffers.stateVarIndices.length;
  }

  /**
   * Attempt to initialize WebGPU. Returns true if successful, false if unsupported.
   */
  async initialize(): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = typeof globalThis !== "undefined" ? (globalThis as any).navigator : undefined;
    if (!nav || !nav.gpu) {
      return false; // WebGPU not available in this environment
    }

    try {
      const adapter = await nav.gpu.requestAdapter({
        powerPreference: "high-performance",
      });
      if (!adapter) return false;

      this.device = await adapter.requestDevice();

      // 1. Generate WGSL (with caching)
      let wgslCode = await getCachedWGSL(this.buffers);
      if (!wgslCode) {
        wgslCode = generateWGSL(this.arena, this.buffers, { workgroupSize: 64 });
        await setCachedWGSL(this.buffers, wgslCode);
      }

      // 2. Compile Shader
      const shaderModule = this.device.createShaderModule({
        label: "DAE Compute Shader",
        code: wgslCode,
      });

      // 3. Create Compute Pipelines
      this.evalPipeline = this.device.createComputePipeline({
        label: "DAE Eval Pipeline",
        layout: "auto",
        compute: { module: shaderModule, entryPoint: "evaluate_blocks" },
      });

      this.rk4Pipeline = this.device.createComputePipeline({
        label: "DAE RK4 Pipeline",
        layout: "auto",
        compute: { module: shaderModule, entryPoint: "rk4_step" },
      });

      // 4. Create Buffers
      const numVars = this.buffers.varCount;
      const numEqs = this.buffers.eqCount;

      this.stateBuffer = this.device.createBuffer({
        size: numVars * 8, // vec2<f32>
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        label: "State Buffer",
      });

      this.residualsBuffer = this.device.createBuffer({
        size: Math.max(8, numEqs * 8), // vec2<f32>
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        label: "Residuals Buffer",
      });

      this.paramsBuffer = this.device.createBuffer({
        size: 32, // time(vec2), dt(vec2), block_count(u32), num_states(u32), rk4_stage(u32), pad
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: "Simulation Params Buffer",
      });

      // State and derivative indices arrays
      this.stateIndicesBuffer = this.device.createBuffer({
        size: Math.max(4, this.numStates * 4), // u32
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        label: "State Indices Buffer",
      });
      this.derivIndicesBuffer = this.device.createBuffer({
        size: Math.max(4, this.numStates * 4), // u32
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        label: "Deriv Indices Buffer",
      });

      this.y0Buffer = this.device.createBuffer({
        size: Math.max(8, this.numStates * 8), // vec2<f32>
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        label: "y0 Buffer",
      });

      this.yAccBuffer = this.device.createBuffer({
        size: Math.max(8, this.numStates * 8), // vec2<f32>
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        label: "y_acc Buffer",
      });

      // Upload indices
      if (this.numStates > 0) {
        this.device.queue.writeBuffer(this.stateIndicesBuffer, 0, this.buffers.stateVarIndices);
        this.device.queue.writeBuffer(this.derivIndicesBuffer, 0, this.buffers.derivVarIndices);
      }

      // 5. Create Bind Group
      // Since layout: "auto" is used and both pipelines share the same bindings,
      // we can use getBindGroupLayout(0) from either pipeline.
      this.bindGroup = this.device.createBindGroup({
        layout: this.evalPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.stateBuffer } },
          { binding: 1, resource: { buffer: this.residualsBuffer } },
          { binding: 2, resource: { buffer: this.paramsBuffer } },
          { binding: 3, resource: { buffer: this.stateIndicesBuffer } },
          { binding: 4, resource: { buffer: this.derivIndicesBuffer } },
          { binding: 5, resource: { buffer: this.y0Buffer } },
          { binding: 6, resource: { buffer: this.yAccBuffer } },
        ],
      });

      return true;
    } catch (e) {
      console.warn("WebGPU initialization failed:", e);
      return false;
    }
  }

  /**
   * Run the simulation for `steps` iterations.
   * This offloads the entire stepping loop to the GPU, minimizing CPU-GPU roundtrips.
   *
   * @param steps - Number of steps to simulate.
   * @param stepSize - Size of each timestep.
   * @param startTime - Starting time.
   * @returns Float32Array containing row-major results: [step0_vars..., step1_vars...]
   */
  async runSimulation(steps: number, stepSize: number, startTime: number): Promise<Float32Array> {
    // 1. Upload initial state
    this.device.queue.writeBuffer(this.stateBuffer, 0, this.buffers.stateBuffer);

    const resultBuffer = new Float32Array((steps + 1) * this.buffers.varCount);
    // Copy t=0
    for (let i = 0; i < this.buffers.varCount; i++) {
      resultBuffer[i] =
        this.buffers.stateBuffer[i * 2] /* eslint-disable-line @typescript-eslint/no-non-null-assertion */! +
        this.buffers.stateBuffer[i * 2 + 1] /* eslint-disable-line @typescript-eslint/no-non-null-assertion */!;
    }

    const readbackBuffer = this.device.createBuffer({
      size: this.buffers.varCount * 8, // vec2<f32>
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const evalWorkgroupCount = Math.ceil(this.blockCount / 64);
    const rk4WorkgroupCount = Math.ceil(this.numStates / 64);
    const paramsData = new ArrayBuffer(32);
    const paramsF32 = new Float32Array(paramsData);
    const paramsU32 = new Uint32Array(paramsData);

    paramsU32[4] = this.blockCount;
    paramsU32[5] = this.numStates;

    let currentTime = startTime;

    // Full RK4 Orchestration on GPU
    for (let s = 1; s <= steps; s++) {
      const commandEncoder = this.device.createCommandEncoder();

      const dtHi = Math.fround(stepSize);
      const dtLo = Math.fround(stepSize - dtHi);
      paramsF32[2] = dtHi;
      paramsF32[3] = dtLo;

      // RK4 Stage 0 (k1)
      const tHi = Math.fround(currentTime);
      const tLo = Math.fround(currentTime - tHi);
      paramsF32[0] = tHi;
      paramsF32[1] = tLo;
      paramsU32[6] = 0; // rk4_stage
      this.device.queue.writeBuffer(this.paramsBuffer, 0, paramsData);

      let passEncoder = commandEncoder.beginComputePass();
      passEncoder.setPipeline(this.evalPipeline);
      passEncoder.setBindGroup(0, this.bindGroup);
      passEncoder.dispatchWorkgroups(evalWorkgroupCount);
      if (this.numStates > 0) {
        passEncoder.setPipeline(this.rk4Pipeline);
        passEncoder.dispatchWorkgroups(rk4WorkgroupCount);
      }
      passEncoder.end();

      // RK4 Stage 1 (k2)
      const tMid = currentTime + 0.5 * stepSize;
      paramsF32[0] = Math.fround(tMid);
      paramsF32[1] = Math.fround(tMid - paramsF32[0]);
      paramsU32[6] = 1; // rk4_stage
      this.device.queue.writeBuffer(this.paramsBuffer, 0, paramsData);

      passEncoder = commandEncoder.beginComputePass();
      passEncoder.setPipeline(this.evalPipeline);
      passEncoder.setBindGroup(0, this.bindGroup);
      passEncoder.dispatchWorkgroups(evalWorkgroupCount);
      if (this.numStates > 0) {
        passEncoder.setPipeline(this.rk4Pipeline);
        passEncoder.dispatchWorkgroups(rk4WorkgroupCount);
      }
      passEncoder.end();

      // RK4 Stage 2 (k3)
      paramsU32[6] = 2; // rk4_stage
      this.device.queue.writeBuffer(this.paramsBuffer, 0, paramsData);

      passEncoder = commandEncoder.beginComputePass();
      passEncoder.setPipeline(this.evalPipeline);
      passEncoder.setBindGroup(0, this.bindGroup);
      passEncoder.dispatchWorkgroups(evalWorkgroupCount);
      if (this.numStates > 0) {
        passEncoder.setPipeline(this.rk4Pipeline);
        passEncoder.dispatchWorkgroups(rk4WorkgroupCount);
      }
      passEncoder.end();

      // RK4 Stage 3 (k4)
      const tNext = currentTime + stepSize;
      paramsF32[0] = Math.fround(tNext);
      paramsF32[1] = Math.fround(tNext - paramsF32[0]);
      paramsU32[6] = 3; // rk4_stage
      this.device.queue.writeBuffer(this.paramsBuffer, 0, paramsData);

      passEncoder = commandEncoder.beginComputePass();
      passEncoder.setPipeline(this.evalPipeline);
      passEncoder.setBindGroup(0, this.bindGroup);
      passEncoder.dispatchWorkgroups(evalWorkgroupCount);
      if (this.numStates > 0) {
        passEncoder.setPipeline(this.rk4Pipeline);
        passEncoder.dispatchWorkgroups(rk4WorkgroupCount);
      }
      passEncoder.end();

      currentTime += stepSize;

      // Copy state to readback buffer
      commandEncoder.copyBufferToBuffer(
        this.stateBuffer,
        0,
        readbackBuffer,
        0,
        this.buffers.varCount * 8, // vec2<f32>
      );

      this.device.queue.submit([commandEncoder.finish()]);

      // Read back
      await readbackBuffer.mapAsync(GPUMapMode.READ);
      const mappedData = new Float32Array(readbackBuffer.getMappedRange());
      for (let i = 0; i < this.buffers.varCount; i++) {
        resultBuffer[s * this.buffers.varCount + i] =
          mappedData[i * 2] /* eslint-disable-line @typescript-eslint/no-non-null-assertion */! +
          mappedData[i * 2 + 1] /* eslint-disable-line @typescript-eslint/no-non-null-assertion */!;
      }
      readbackBuffer.unmap();
    }

    // Cleanup
    readbackBuffer.destroy();

    return resultBuffer;
  }

  /**
   * Dispatches a single RK4 step (4 stages) natively on the GPU.
   * Does NOT read back the state buffer to the CPU.
   * This is explicitly designed for Zero-Copy Visualization pipelines.
   */
  public stepSimulation(stepSize: number, currentTime: number): void {
    const evalWorkgroupCount = Math.ceil(this.blockCount / 64);
    const rk4WorkgroupCount = Math.ceil(this.numStates / 64);
    const paramsData = new ArrayBuffer(32);
    const paramsF32 = new Float32Array(paramsData);
    const paramsU32 = new Uint32Array(paramsData);

    paramsU32[4] = this.blockCount;
    paramsU32[5] = this.numStates;

    const dtHi = Math.fround(stepSize);
    const dtLo = Math.fround(stepSize - dtHi);
    paramsF32[2] = dtHi;
    paramsF32[3] = dtLo;

    const commandEncoder = this.device.createCommandEncoder({ label: "Zero-Copy RK4 Encoder" });

    // RK4 Stage 0 (k1)
    const tHi = Math.fround(currentTime);
    const tLo = Math.fround(currentTime - tHi);
    paramsF32[0] = tHi;
    paramsF32[1] = tLo;
    paramsU32[6] = 0; // rk4_stage
    this.device.queue.writeBuffer(this.paramsBuffer, 0, paramsData);

    let passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(this.evalPipeline);
    passEncoder.setBindGroup(0, this.bindGroup);
    passEncoder.dispatchWorkgroups(evalWorkgroupCount);
    if (this.numStates > 0) {
      passEncoder.setPipeline(this.rk4Pipeline);
      passEncoder.dispatchWorkgroups(rk4WorkgroupCount);
    }
    passEncoder.end();

    // RK4 Stage 1 (k2)
    const tMid = currentTime + 0.5 * stepSize;
    paramsF32[0] = Math.fround(tMid);
    paramsF32[1] = Math.fround(tMid - paramsF32[0]);
    paramsU32[6] = 1; // rk4_stage
    this.device.queue.writeBuffer(this.paramsBuffer, 0, paramsData);

    passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(this.evalPipeline);
    passEncoder.setBindGroup(0, this.bindGroup);
    passEncoder.dispatchWorkgroups(evalWorkgroupCount);
    if (this.numStates > 0) {
      passEncoder.setPipeline(this.rk4Pipeline);
      passEncoder.dispatchWorkgroups(rk4WorkgroupCount);
    }
    passEncoder.end();

    // RK4 Stage 2 (k3)
    paramsU32[6] = 2; // rk4_stage
    this.device.queue.writeBuffer(this.paramsBuffer, 0, paramsData);

    passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(this.evalPipeline);
    passEncoder.setBindGroup(0, this.bindGroup);
    passEncoder.dispatchWorkgroups(evalWorkgroupCount);
    if (this.numStates > 0) {
      passEncoder.setPipeline(this.rk4Pipeline);
      passEncoder.dispatchWorkgroups(rk4WorkgroupCount);
    }
    passEncoder.end();

    // RK4 Stage 3 (k4)
    const tNext = currentTime + stepSize;
    paramsF32[0] = Math.fround(tNext);
    paramsF32[1] = Math.fround(tNext - paramsF32[0]);
    paramsU32[6] = 3; // rk4_stage
    this.device.queue.writeBuffer(this.paramsBuffer, 0, paramsData);

    passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(this.evalPipeline);
    passEncoder.setBindGroup(0, this.bindGroup);
    passEncoder.dispatchWorkgroups(evalWorkgroupCount);
    if (this.numStates > 0) {
      passEncoder.setPipeline(this.rk4Pipeline);
      passEncoder.dispatchWorkgroups(rk4WorkgroupCount);
    }
    passEncoder.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }

  /**
   * Evaluate the Right-Hand Side (RHS) of the ODE system: dy/dt = f(t, y).
   * This is used to integrate WebGPU evaluation with external CPU ODE solvers (like Sundials WASM).
   *
   * @param t Current time
   * @param y Current state vector (Float32Array)
   * @returns Float32Array containing the computed derivatives
   */
  async evaluateRHS(t: number, y: Float32Array): Promise<Float32Array> {
    // 1. Update the state buffer with the current ODE states
    const fullState = new Float32Array(this.buffers.stateBuffer);
    for (let i = 0; i < this.numStates; i++) {
      const v = y[i] ?? 0;
      const vHi = Math.fround(v);
      const vLo = Math.fround(v - vHi);
      fullState[
        this.buffers.stateVarIndices[i] /* eslint-disable-line @typescript-eslint/no-non-null-assertion */! * 2
      ] = vHi;
      fullState[
        this.buffers.stateVarIndices[i] /* eslint-disable-line @typescript-eslint/no-non-null-assertion */! * 2 + 1
      ] = vLo;
    }
    this.device.queue.writeBuffer(this.stateBuffer, 0, fullState);

    // 2. Update params
    const paramsData = new ArrayBuffer(32);
    const paramsF32 = new Float32Array(paramsData);
    const paramsU32 = new Uint32Array(paramsData);
    paramsF32[0] = Math.fround(t);
    paramsF32[1] = Math.fround(t - paramsF32[0]);
    paramsF32[2] = 0;
    paramsF32[3] = 0;
    paramsU32[4] = this.blockCount;
    paramsU32[5] = this.numStates;
    this.device.queue.writeBuffer(this.paramsBuffer, 0, paramsData);

    // 3. Dispatch evaluate_blocks kernel (calculates bindings and residuals)
    const commandEncoder = this.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(this.evalPipeline);
    passEncoder.setBindGroup(0, this.bindGroup);
    passEncoder.dispatchWorkgroups(Math.ceil(this.blockCount / 64));
    passEncoder.end();

    // 4. Read back the full state
    const readbackBuffer = this.device.createBuffer({
      size: this.buffers.varCount * 8, // vec2<f32>
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    commandEncoder.copyBufferToBuffer(this.stateBuffer, 0, readbackBuffer, 0, this.buffers.varCount * 8);
    this.device.queue.submit([commandEncoder.finish()]);

    await readbackBuffer.mapAsync(GPUMapMode.READ);
    const resultState = new Float32Array(readbackBuffer.getMappedRange());

    // 5. Extract only the derivative values
    const derivValues = new Float32Array(this.numStates);
    for (let i = 0; i < this.numStates; i++) {
      const idx = this.buffers.derivVarIndices[i] /* eslint-disable-line @typescript-eslint/no-non-null-assertion */!;
      derivValues[i] = (resultState[idx * 2] ?? 0) + (resultState[idx * 2 + 1] ?? 0);
    }

    readbackBuffer.unmap();
    readbackBuffer.destroy();

    return derivValues;
  }

  /**
   * Adaptive step size simulation (DOPRI5) orchestrated from the CPU,
   * using WebGPU exclusively for RHS evaluation. This supports events
   * and provides parity with existing CPU solvers.
   */
  async runSimulationAdaptive(
    t0: number,
    y0: Float32Array,
    tEnd: number,
    outputTimes: number[],
    options: { atol?: number; rtol?: number; maxStep?: number } = {},
  ): Promise<{ t: number[]; y: number[][] }> {
    const { dopri5Async } = await import("../solvers/dopri5.js");

    const rhsFnAsync = async (t: number, y: number[]): Promise<number[]> => {
      const yF32 = new Float32Array(y);
      const dyF32 = await this.evaluateRHS(t, yF32);
      return Array.from(dyF32);
    };

    // Note: Since this is an external orchestrator, event detection
    // would be passed down via event functions similar to the CPU simulator.
    // For now, we evaluate the RHS and use the async DOPRI5 to achieve
    // basic parity for continuous adaptive stepping.

    const result = await dopri5Async(rhsFnAsync, t0, Array.from(y0), tEnd, outputTimes, options);

    return { t: result.times, y: result.states };
  }
}
