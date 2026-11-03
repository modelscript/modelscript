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
import { type DAEBuilder } from "@modelscript/runtime/wasm_dae.js";
import { type GPUArenaBuffers } from "./gpu-buffers.js";
import { getCachedWGSL, setCachedWGSL } from "./wgsl-cache.js";
import { generateWGSL } from "./wgsl-codegen.js";

// Uses @webgpu/types directly

export class WebGPUSimulationRunner {
  public device!: GPUDevice;
  private evalPipeline!: GPUComputePipeline;
  private rk4Pipeline!: GPUComputePipeline;
  private tsit5Pipeline!: GPUComputePipeline;
  private trbdf2Pipeline!: GPUComputePipeline;
  public stateBuffer!: GPUBuffer;
  private residualsBuffer!: GPUBuffer;
  private paramsBuffer!: GPUBuffer;
  private stateIndicesBuffer!: GPUBuffer;
  private derivIndicesBuffer!: GPUBuffer;
  private y0Buffer!: GPUBuffer;
  private yAccBuffer!: GPUBuffer;
  private stageScratchBuffer!: GPUBuffer;
  private bindGroup!: GPUBindGroup;

  /** Total number of blocks to evaluate. */
  private blockCount: number;
  private numStates: number;

  constructor(
    public readonly arena: DAEBuilder,
    public readonly buffers: GPUArenaBuffers,
  ) {
    this.blockCount = buffers.blockPlan.blockCount;
    this.numStates = buffers.stateVarIndices.length;
  }

  /**
   * Attempt to initialize WebGPU. Returns true if successful, false if unsupported.
   */
  async initialize(): Promise<boolean> {
    const nav =
      typeof globalThis !== "undefined"
        ? (globalThis as { navigator?: { gpu?: GPU | undefined } | undefined }).navigator
        : undefined;
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

      this.tsit5Pipeline = this.device.createComputePipeline({
        label: "DAE Tsit5 Pipeline",
        layout: "auto",
        compute: { module: shaderModule, entryPoint: "tsit5_step" },
      });

      this.trbdf2Pipeline = this.device.createComputePipeline({
        label: "DAE TR-BDF2 Pipeline",
        layout: "auto",
        compute: { module: shaderModule, entryPoint: "trbdf2_step" },
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
        size: 48, // time(vec2), dt(vec2), block_count(u32), num_states(u32), rk4_stage(u32), solver_type(u32), sub_stage(u32), pad(u32)
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

      this.stageScratchBuffer = this.device.createBuffer({
        size: Math.max(8, this.numStates * 8 * 8), // 8 stages * numStates * vec2<f32>
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        label: "stage_scratch Buffer",
      });

      // Upload indices
      if (this.numStates > 0) {
        this.device.queue.writeBuffer(this.stateIndicesBuffer, 0, this.buffers.stateVarIndices as BufferSource);
        this.device.queue.writeBuffer(this.derivIndicesBuffer, 0, this.buffers.derivVarIndices as BufferSource);
      }

      // 5. Create Bind Group
      // Since layout: "auto" is used and pipelines share bindings,
      // we can use getBindGroupLayout(0) from evalPipeline.
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
          { binding: 7, resource: { buffer: this.stageScratchBuffer } },
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
  async runSimulation(
    steps: number,
    stepSize: number,
    startTime: number,
    options?: { solver?: "rk4" | "tsit5" | "trbdf2" | undefined },
  ): Promise<Float32Array> {
    const solver = options?.solver ?? "rk4";
    // 1. Upload initial state
    this.device.queue.writeBuffer(this.stateBuffer, 0, this.buffers.stateBuffer as BufferSource);

    const resultBuffer = new Float32Array((steps + 1) * this.buffers.varCount);
    // Copy t=0
    for (let i = 0; i < this.buffers.varCount; i++) {
      resultBuffer[i] = this.buffers.stateBuffer[i * 2]! + this.buffers.stateBuffer[i * 2 + 1]!;
    }

    const totalTrajectoryBytes = (steps + 1) * this.buffers.varCount * 8; // vec2<f32>
    const trajectoryReadbackBuffer = this.device.createBuffer({
      size: totalTrajectoryBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const evalWorkgroupCount = 1;
    const odeWorkgroupCount = Math.max(1, Math.ceil(this.numStates / 64));
    const paramsData = new ArrayBuffer(48);
    const paramsF32 = new Float32Array(paramsData);
    const paramsU32 = new Uint32Array(paramsData);

    paramsU32[4] = this.blockCount;
    paramsU32[5] = this.numStates;
    paramsU32[7] = solver === "tsit5" ? 1 : solver === "trbdf2" ? 2 : 0;

    let currentTime = startTime;

    for (let s = 1; s <= steps; s++) {
      const commandEncoder = this.device.createCommandEncoder();

      const dtHi = Math.fround(stepSize);
      const dtLo = Math.fround(stepSize - dtHi);
      paramsF32[2] = dtHi;
      paramsF32[3] = dtLo;

      if (solver === "tsit5") {
        // Tsit5 7 stages (FSAL)
        const c = [0.0, 0.161, 0.327, 0.9, 0.9800255404875019, 1.0, 1.0];
        for (let st = 0; st < 7; st++) {
          const tStage = currentTime + (c[st] ?? 0.0) * stepSize;
          paramsF32[0] = Math.fround(tStage);
          paramsF32[1] = Math.fround(tStage - paramsF32[0]);
          paramsU32[6] = st; // rk4_stage / sub_stage
          paramsU32[8] = st; // sub_stage
          this.device.queue.writeBuffer(this.paramsBuffer, 0, paramsData);

          const passEncoder = commandEncoder.beginComputePass();
          passEncoder.setPipeline(this.evalPipeline);
          passEncoder.setBindGroup(0, this.bindGroup);
          passEncoder.dispatchWorkgroups(evalWorkgroupCount);
          if (this.numStates > 0) {
            passEncoder.setPipeline(this.tsit5Pipeline);
            passEncoder.dispatchWorkgroups(odeWorkgroupCount);
          }
          passEncoder.end();
        }
      } else if (solver === "trbdf2") {
        // TR-BDF2 with implicit Newton-secant corrector iterations for both stages
        const gamma = 0.585786437626905;
        const stageSchedule: { subStage: number; timeOffset: number; corrIters: number }[] = [
          { subStage: 0, timeOffset: 0.0, corrIters: 1 },
          { subStage: 1, timeOffset: gamma, corrIters: 4 },
          { subStage: 2, timeOffset: gamma, corrIters: 1 },
          { subStage: 3, timeOffset: 1.0, corrIters: 4 },
        ];
        for (const item of stageSchedule) {
          const tStage = currentTime + item.timeOffset * stepSize;
          paramsF32[0] = Math.fround(tStage);
          paramsF32[1] = Math.fround(tStage - paramsF32[0]);
          paramsU32[8] = item.subStage;
          for (let corr = 0; corr < item.corrIters; corr++) {
            paramsU32[6] = corr;
            this.device.queue.writeBuffer(this.paramsBuffer, 0, paramsData);

            const passEncoder = commandEncoder.beginComputePass();
            passEncoder.setPipeline(this.evalPipeline);
            passEncoder.setBindGroup(0, this.bindGroup);
            passEncoder.dispatchWorkgroups(evalWorkgroupCount);
            if (this.numStates > 0) {
              passEncoder.setPipeline(this.trbdf2Pipeline);
              passEncoder.dispatchWorkgroups(odeWorkgroupCount);
            }
            passEncoder.end();
          }
        }
      } else {
        // Default RK4 (4 stages)
        // Stage 0 (k1)
        paramsF32[0] = Math.fround(currentTime);
        paramsF32[1] = Math.fround(currentTime - paramsF32[0]);
        paramsU32[6] = 0;
        this.device.queue.writeBuffer(this.paramsBuffer, 0, paramsData);

        let passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(this.evalPipeline);
        passEncoder.setBindGroup(0, this.bindGroup);
        passEncoder.dispatchWorkgroups(evalWorkgroupCount);
        if (this.numStates > 0) {
          passEncoder.setPipeline(this.rk4Pipeline);
          passEncoder.dispatchWorkgroups(odeWorkgroupCount);
        }
        passEncoder.end();

        // Stage 1 (k2)
        const tMid = currentTime + 0.5 * stepSize;
        paramsF32[0] = Math.fround(tMid);
        paramsF32[1] = Math.fround(tMid - paramsF32[0]);
        paramsU32[6] = 1;
        this.device.queue.writeBuffer(this.paramsBuffer, 0, paramsData);

        passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(this.evalPipeline);
        passEncoder.setBindGroup(0, this.bindGroup);
        passEncoder.dispatchWorkgroups(evalWorkgroupCount);
        if (this.numStates > 0) {
          passEncoder.setPipeline(this.rk4Pipeline);
          passEncoder.dispatchWorkgroups(odeWorkgroupCount);
        }
        passEncoder.end();

        // Stage 2 (k3)
        paramsU32[6] = 2;
        this.device.queue.writeBuffer(this.paramsBuffer, 0, paramsData);

        passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(this.evalPipeline);
        passEncoder.setBindGroup(0, this.bindGroup);
        passEncoder.dispatchWorkgroups(evalWorkgroupCount);
        if (this.numStates > 0) {
          passEncoder.setPipeline(this.rk4Pipeline);
          passEncoder.dispatchWorkgroups(odeWorkgroupCount);
        }
        passEncoder.end();

        // Stage 3 (k4)
        const tNext = currentTime + stepSize;
        paramsF32[0] = Math.fround(tNext);
        paramsF32[1] = Math.fround(tNext - paramsF32[0]);
        paramsU32[6] = 3;
        this.device.queue.writeBuffer(this.paramsBuffer, 0, paramsData);

        passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(this.evalPipeline);
        passEncoder.setBindGroup(0, this.bindGroup);
        passEncoder.dispatchWorkgroups(evalWorkgroupCount);
        if (this.numStates > 0) {
          passEncoder.setPipeline(this.rk4Pipeline);
          passEncoder.dispatchWorkgroups(odeWorkgroupCount);
        }
        passEncoder.end();
      }

      currentTime += stepSize;

      // Copy state to current step slice of trajectoryReadbackBuffer asynchronously
      commandEncoder.copyBufferToBuffer(
        this.stateBuffer,
        0,
        trajectoryReadbackBuffer,
        s * this.buffers.varCount * 8, // vec2<f32>
        this.buffers.varCount * 8,
      );

      this.device.queue.submit([commandEncoder.finish()]);
    }

    // Single batched read back across entire simulation trajectory
    try {
      await trajectoryReadbackBuffer.mapAsync(GPUMapMode.READ);
      const mappedData = new Float32Array(trajectoryReadbackBuffer.getMappedRange());
      const stepStride = this.buffers.varCount * 2;
      for (let s = 1; s <= steps; s++) {
        const srcOffset = s * stepStride;
        const dstOffset = s * this.buffers.varCount;
        for (let i = 0; i < this.buffers.varCount; i++) {
          resultBuffer[dstOffset + i] = mappedData[srcOffset + i * 2]! + mappedData[srcOffset + i * 2 + 1]!;
        }
      }
      trajectoryReadbackBuffer.unmap();
    } finally {
      trajectoryReadbackBuffer.destroy();
    }

    return resultBuffer;
  }

  /**
   * Dispatches a single RK4 step (4 stages) natively on the GPU.
   * Does NOT read back the state buffer to the CPU.
   * This is explicitly designed for Zero-Copy Visualization pipelines.
   */
  public stepSimulation(stepSize: number, currentTime: number): void {
    const evalWorkgroupCount = 1;
    const rk4WorkgroupCount = Math.max(1, Math.ceil(this.numStates / 64));
    const paramsData = new ArrayBuffer(48);
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
      fullState[this.buffers.stateVarIndices[i]! * 2] = vHi;
      fullState[this.buffers.stateVarIndices[i]! * 2 + 1] = vLo;
    }
    this.device.queue.writeBuffer(this.stateBuffer, 0, fullState);

    // 2. Update params
    const paramsData = new ArrayBuffer(48);
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
    passEncoder.dispatchWorkgroups(1);
    passEncoder.end();

    // 4. Read back the full state
    const readbackBuffer = this.device.createBuffer({
      size: this.buffers.varCount * 8, // vec2<f32>
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    commandEncoder.copyBufferToBuffer(this.stateBuffer, 0, readbackBuffer, 0, this.buffers.varCount * 8);
    this.device.queue.submit([commandEncoder.finish()]);

    const derivValues = new Float32Array(this.numStates);
    try {
      await readbackBuffer.mapAsync(GPUMapMode.READ);
      const resultState = new Float32Array(readbackBuffer.getMappedRange());

      // 5. Extract only the derivative values
      for (let i = 0; i < this.numStates; i++) {
        const idx = this.buffers.derivVarIndices[i]!;
        derivValues[i] = (resultState[idx * 2] ?? 0) + (resultState[idx * 2 + 1] ?? 0);
      }

      readbackBuffer.unmap();
    } finally {
      readbackBuffer.destroy();
    }

    return derivValues;
  }

  /**
   * Adaptive step size simulation (DOPRI5) orchestrated from the CPU,
   * using WebGPU exclusively for RHS evaluation. Wires zero-crossing event
   * detection from the DAEBuilder arena (`when`, `if`, relational conditions)
   * into `dopri5Async` for parity with CPU solvers.
   */
  async runSimulationAdaptive(
    t0: number,
    y0: Float32Array,
    tEnd: number,
    outputTimes: number[],
    options: {
      atol?: number | undefined;
      rtol?: number | undefined;
      maxStep?: number | undefined;
      eventFunctions?: ((t: number, y: number[]) => number)[] | undefined;
      eventCallback?: ((eventIndex: number, t: number, y: number[]) => boolean | undefined) | undefined;
      eventDirections?: number[] | undefined;
    } = {},
  ): Promise<{ t: number[]; y: number[][]; events?: { time: number; eventIndex: number }[] | undefined }> {
    const { dopri5Async } = await import("@modelscript/runtime/wasm_dopri5.js");
    const { BinOp, EqKind, ExprKind, Variability, evaluateArenaExpression } = await import("@modelscript/runtime");

    const rhsFnAsync = async (t: number, y: number[]): Promise<number[]> => {
      const yF32 = new Float32Array(y);
      const dyF32 = await this.evaluateRHS(t, yF32);
      return Array.from(dyF32);
    };

    // Extract zero-crossing expressions and when-actions from this.arena
    const arena = this.arena;
    const stateNames: string[] = [];
    for (let i = 0; i < this.buffers.stateVarIndices.length; i++) {
      const vIdx = this.buffers.stateVarIndices[i]!;
      stateNames.push(arena.getVarName(vIdx));
    }

    const parameterMap = new Map<string, import("@modelscript/runtime").ArenaValue>();
    for (let i = 0; i < arena.varCount; i++) {
      const variability = arena.getVarVariability(i);
      if (variability === Variability.Parameter || variability === Variability.Constant) {
        const name = arena.getVarName(i);
        let val = arena.getVarStartValue(i);
        const bindExpr = arena.getVarExpression(i);
        if (bindExpr !== undefined && bindExpr >= 0) {
          const ev = evaluateArenaExpression(arena, bindExpr, parameterMap);
          if (typeof ev === "number" && Number.isFinite(ev)) val = ev;
        }
        parameterMap.set(name, val);
      }
    }

    const buildEvalContext = (t: number, y: number[]): Map<string, import("@modelscript/runtime").ArenaValue> => {
      const evalMap = new Map<string, import("@modelscript/runtime").ArenaValue>(parameterMap);
      for (let i = 0; i < stateNames.length && i < y.length; i++) {
        evalMap.set(stateNames[i]!, y[i]!);
      }
      evalMap.set("time", t);
      return evalMap;
    };

    interface ArenaZeroCrossing {
      condExprId: number;
      direction: number;
      whenEqId?: number | undefined;
    }

    const zeroCrossings: ArenaZeroCrossing[] = [];
    const seenCondExprs = new Set<number>();

    const isRelationalOp = (op: number): boolean =>
      op === BinOp.Lt || op === BinOp.Lte || op === BinOp.Gt || op === BinOp.Gte || op === BinOp.Eq || op === BinOp.Neq;

    const addZeroCrossingExpr = (exprId: number, whenEqId?: number) => {
      if (exprId < 0 || exprId >= arena.exprCount || seenCondExprs.has(exprId)) return;
      const kind = arena.getExprKind(exprId);
      if (kind === ExprKind.Binary) {
        const op = arena.getExprData1(exprId);
        if (isRelationalOp(op)) {
          seenCondExprs.add(exprId);
          const dir = whenEqId !== undefined ? 1 : 0;
          zeroCrossings.push({ condExprId: exprId, direction: dir, whenEqId });
          return;
        }
        addZeroCrossingExpr(arena.getExprLeft(exprId), whenEqId);
        addZeroCrossingExpr(arena.getExprRight(exprId), whenEqId);
      } else if (kind === ExprKind.IfElse) {
        addZeroCrossingExpr(arena.getExprData1(exprId), whenEqId);
        addZeroCrossingExpr(arena.getExprLeft(exprId), whenEqId);
        addZeroCrossingExpr(arena.getExprRight(exprId), whenEqId);
      } else if (kind === ExprKind.Call && arena.interner?.resolve?.(arena.getExprData1(exprId)) === "sample") {
        seenCondExprs.add(exprId);
        zeroCrossings.push({ condExprId: exprId, direction: 1, whenEqId });
      }
    };

    if (Array.isArray(arena.eventIndicatorExprIds)) {
      for (const exprId of arena.eventIndicatorExprIds) {
        addZeroCrossingExpr(exprId);
      }
    }

    for (let e = 0; e < arena.eqCount; e++) {
      const kind = arena.getEqKind(e);
      if (kind === EqKind.When) {
        addZeroCrossingExpr(arena.getEqLhs(e), e);
        const whenMeta = arena.getWhenEquationMeta(e);
        if (whenMeta) {
          addZeroCrossingExpr(whenMeta.conditionExprId, e);
          if (Array.isArray(whenMeta.elseWhenClauses)) {
            for (const ew of whenMeta.elseWhenClauses) {
              addZeroCrossingExpr(ew.conditionExprId, e);
            }
          }
        }
      } else if (kind === EqKind.If) {
        addZeroCrossingExpr(arena.getEqLhs(e));
        const ifMeta = arena.getIfEquationMeta(e);
        if (ifMeta) {
          addZeroCrossingExpr(ifMeta.conditionExprId);
          if (Array.isArray(ifMeta.elseIfClauses)) {
            for (const ei of ifMeta.elseIfClauses) {
              addZeroCrossingExpr(ei.conditionExprId);
            }
          }
        }
      } else if (kind === EqKind.Simple) {
        addZeroCrossingExpr(arena.getEqLhs(e));
        addZeroCrossingExpr(arena.getEqRhs(e));
      }
    }

    const arenaEventFunctions: ((t: number, y: number[]) => Promise<number>)[] = zeroCrossings.map((zc) => {
      return async (t: number, y: number[]): Promise<number> => {
        const ctx = buildEvalContext(t, y);
        const exprId = zc.condExprId;
        const kind = arena.getExprKind(exprId);
        if (kind === ExprKind.Binary) {
          const op = arena.getExprData1(exprId);
          const lhsVal = Number(evaluateArenaExpression(arena, arena.getExprLeft(exprId), ctx));
          const rhsVal = Number(evaluateArenaExpression(arena, arena.getExprRight(exprId), ctx));
          if (Number.isFinite(lhsVal) && Number.isFinite(rhsVal)) {
            return op === BinOp.Lt || op === BinOp.Lte ? rhsVal - lhsVal : lhsVal - rhsVal;
          }
        }
        const val = evaluateArenaExpression(arena, exprId, ctx);
        if (typeof val === "boolean") return val ? 1 : -1;
        return typeof val === "number" && Number.isFinite(val) ? val : -1;
      };
    });

    const allEventFunctions: ((t: number, y: number[]) => Promise<number>)[] = [
      ...arenaEventFunctions,
      ...(options.eventFunctions ?? []).map((fn) => async (t: number, y: number[]) => fn(t, y)),
    ];
    const allEventDirections = [
      ...zeroCrossings.map((zc) => zc.direction),
      ...(options.eventDirections ?? (options.eventFunctions ?? []).map(() => 0)),
    ];

    const detectedEvents: { time: number; eventIndex: number }[] = [];
    const eventHandler =
      allEventFunctions.length > 0
        ? (t: number, y: number[], eventIndex: number, _dir: 1 | -1): number[] => {
            detectedEvents.push({ time: t, eventIndex });
            const yAfter = [...y];
            if (eventIndex < zeroCrossings.length) {
              const zc = zeroCrossings[eventIndex]!;
              if (zc.whenEqId !== undefined) {
                const whenMeta = arena.getWhenEquationMeta(zc.whenEqId);
                const ctx = buildEvalContext(t, yAfter);
                const bodyEquations: { kind: number; lhsExprId: number; rhsExprId: number }[] =
                  whenMeta?.bodyEquations ?? [];
                for (const bodyEq of bodyEquations) {
                  let targetNameId = -1;
                  let valExpr = -1;
                  if (bodyEq.kind === EqKind.FunctionCall) {
                    const callExprId = bodyEq.lhsExprId;
                    if (arena.getExprKind(callExprId) === ExprKind.Call) {
                      const funcName = arena.interner?.resolve?.(arena.getExprData1(callExprId));
                      if (funcName === "reinit" && arena.getExprRight(callExprId) >= 2) {
                        const firstArgId = arena.getExprLeft(callExprId);
                        if (arena.getExprKind(firstArgId) === ExprKind.Name) {
                          targetNameId = arena.getExprData1(firstArgId);
                          valExpr = arena.getExprLeft(callExprId + 1);
                        }
                      }
                    }
                  } else if (bodyEq.kind === EqKind.Simple) {
                    const lhs = bodyEq.lhsExprId;
                    const rhs = bodyEq.rhsExprId;
                    if (arena.getExprKind(rhs) === ExprKind.Call) {
                      const funcName = arena.interner?.resolve?.(arena.getExprData1(rhs));
                      if (funcName === "reinit" && arena.getExprKind(lhs) === ExprKind.Name) {
                        targetNameId = arena.getExprData1(lhs);
                        if (arena.getExprRight(rhs) >= 2) {
                          valExpr = arena.getExprLeft(rhs + 1);
                        }
                      }
                    }
                  }
                  if (targetNameId >= 0 && valExpr >= 0) {
                    const vName = arena.interner?.resolve?.(targetNameId);
                    const sIdx = vName ? stateNames.indexOf(vName) : -1;
                    const newVal = Number(evaluateArenaExpression(arena, valExpr, ctx));
                    if (sIdx >= 0 && Number.isFinite(newVal)) {
                      yAfter[sIdx] = newVal;
                    }
                  }
                }
              }
            }
            if (options.eventCallback) {
              const userIdx = eventIndex >= zeroCrossings.length ? eventIndex - zeroCrossings.length : eventIndex;
              options.eventCallback(userIdx, t, yAfter);
            }
            return yAfter;
          }
        : undefined;

    const result = await dopri5Async(
      rhsFnAsync,
      t0,
      Array.from(y0),
      tEnd,
      outputTimes,
      options,
      allEventFunctions.length > 0 ? allEventFunctions : undefined,
      eventHandler,
      allEventFunctions.length > 0 ? allEventDirections : undefined,
    );

    return {
      t: result.times,
      y: result.states,
      ...(detectedEvents.length > 0 ? { events: detectedEvents } : {}),
    };
  }

  /**
   * Release all allocated GPU buffers and destroy the WebGPU device.
   */
  public destroy(): void {
    this.stateBuffer?.destroy?.();
    this.residualsBuffer?.destroy?.();
    this.paramsBuffer?.destroy?.();
    this.stateIndicesBuffer?.destroy?.();
    this.derivIndicesBuffer?.destroy?.();
    this.y0Buffer?.destroy?.();
    this.yAccBuffer?.destroy?.();
    this.stageScratchBuffer?.destroy?.();
    this.device?.destroy?.();
  }
}
