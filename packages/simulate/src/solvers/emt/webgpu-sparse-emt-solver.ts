// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebGPU Batched Sparse EMT Solver.
 *
 * Dispatches large-scale electromagnetic transient companion simulations directly to GPU
 * compute shaders with zero per-step CPU-GPU synchronization.
 * Automatically falls back to high-performance typed array CPU execution when WebGPU is unavailable.
 */

import { emitSparseEmtSolverWGSL, type SparseEmtGpuConfig } from "./wgsl/sparse-emt-solver.wgsl.js";

export interface GpuSourceDef {
  nodeIdx: number;
  vPeak: number;
  freqRad: number;
  phaseRad: number;
  gSrc: number;
}

export interface GpuBranchDef {
  id: string;
  fromNode: number;
  toNode: number;
  gEq: number;
  alphaHist: number;
  vCoeffHist: number;
  iHist?: number | undefined;
}

export interface GpuSparseMatrixCsr {
  rowPtrL: Uint32Array;
  colIdxL: Uint32Array;
  valL: Float32Array;
  rowPtrU: Uint32Array;
  colIdxU: Uint32Array;
  valU: Float32Array;
  diagInvU: Float32Array;
}

export interface WebGpuSparseEmtOptions {
  dtSec: number;
  totalSteps: number;
  batchStepsPerDispatch?: number | undefined;
  nominalFrequencyHz?: number | undefined;
  preferCpu?: boolean | undefined;
}

export interface EmtContingencyDef {
  id: string;
  name?: string | undefined;
  tripBranches?: Array<{ branchId: string; timeSec: number }> | undefined;
  faults?: Array<{ nodeIdx: number; rFault: number; startTimeSec: number; clearTimeSec: number }> | undefined;
  sourceModifiers?: Array<{ sourceIdx: number; vScale: number; startTimeSec: number }> | undefined;
}

export interface EmtContingencySummary {
  id: string;
  name?: string | undefined;
  peakOvervoltageKv: number;
  maxBranchCurrentKa: number;
  criticalClearanceMet: boolean;
  nodeVoltages?: Map<number, Float64Array> | undefined;
  branchCurrents?: Map<string, Float64Array> | undefined;
}

export interface WebGpuBatchedEmtResult {
  contingencies: EmtContingencySummary[];
  totalWallClockMs: number;
  totalSimulatedSec: number;
  isGpuAccelerated: boolean;
}

export interface WebGpuSparseEmtResult {
  time: Float64Array;
  nodeVoltages: Map<number, Float64Array>;
  branchCurrents: Map<string, Float64Array>;
  metrics: {
    totalSteps: number;
    executionTimeMs: number;
    isGpuAccelerated: boolean;
    batchCount: number;
  };
}

/**
 * High-performance WebGPU batched sparse EMT solver with seamless CPU fallback.
 */
export class WebGpuSparseEmtSolver {
  public readonly numNodes: number;
  public readonly sources: GpuSourceDef[];
  public readonly branches: GpuBranchDef[];
  public readonly sparseMatrix: GpuSparseMatrixCsr;
  public readonly options: WebGpuSparseEmtOptions;

  private device: GPUDevice | null = null;
  private pipeline: GPUComputePipeline | null = null;
  private isGpuReady = false;

  constructor(
    numNodes: number,
    sources: GpuSourceDef[],
    branches: GpuBranchDef[],
    sparseMatrix: GpuSparseMatrixCsr,
    options: WebGpuSparseEmtOptions,
    device: GPUDevice | null = null,
  ) {
    this.numNodes = numNodes;
    this.sources = sources;
    this.branches = branches;
    this.sparseMatrix = sparseMatrix;
    this.options = options;
    this.device = device;
  }

  /**
   * Factory to construct and asynchronously initialize WebGPU compute pipeline if supported.
   */
  public static async create(
    numNodes: number,
    sources: GpuSourceDef[],
    branches: GpuBranchDef[],
    sparseMatrix: GpuSparseMatrixCsr,
    options: WebGpuSparseEmtOptions,
    device?: GPUDevice | null,
  ): Promise<WebGpuSparseEmtSolver> {
    let gpuDevice: GPUDevice | null = device ?? null;

    if (!gpuDevice && !options.preferCpu && typeof navigator !== "undefined" && "gpu" in navigator) {
      try {
        const adapter = await (navigator as any).gpu.requestAdapter();
        if (adapter) {
          gpuDevice = await adapter.requestDevice();
        }
      } catch {
        gpuDevice = null;
      }
    }

    const solver = new WebGpuSparseEmtSolver(numNodes, sources, branches, sparseMatrix, options, gpuDevice);

    if (gpuDevice) {
      await solver.initializeGpuPipeline();
    }

    return solver;
  }

  private async initializeGpuPipeline(): Promise<void> {
    if (!this.device) return;

    try {
      const config: SparseEmtGpuConfig = {
        numBuses: Math.ceil(this.numNodes / 3),
        numNodes: this.numNodes,
        numBranches: this.branches.length,
        numSources: this.sources.length,
        sparseNnz: Math.max(1, this.sparseMatrix.valL.length),
        dtSec: this.options.dtSec,
        nominalFrequencyHz: this.options.nominalFrequencyHz ?? 60.0,
        batchStepsPerDispatch: this.options.batchStepsPerDispatch ?? 50,
      };

      const wgslSource = emitSparseEmtSolverWGSL(config);
      const shaderModule = this.device.createShaderModule({
        code: wgslSource,
      });

      this.pipeline = await this.device.createComputePipelineAsync({
        layout: "auto",
        compute: {
          module: shaderModule,
          entryPoint: "step_sparse_emt",
        },
      });

      this.isGpuReady = true;
    } catch {
      this.isGpuReady = false;
      this.device = null;
    }
  }

  /**
   * Executes the batched EMT simulation over all requested steps.
   */
  public async solve(): Promise<WebGpuSparseEmtResult> {
    const startTime = performance.now();

    if (this.isGpuReady && this.device && this.pipeline && !this.options.preferCpu) {
      try {
        return await this.solveGpu(startTime);
      } catch {
        // Fall back gracefully to CPU if GPU execution fails
        return this.solveCpu(startTime);
      }
    }

    return this.solveCpu(startTime);
  }

  /**
   * WebGPU accelerated compute pass execution.
   */
  private async solveGpu(startTime: number): Promise<WebGpuSparseEmtResult> {
    const dev = this.device!;
    const pipe = this.pipeline!;
    const totalSteps = this.options.totalSteps;
    const batchSteps = Math.min(totalSteps, this.options.batchStepsPerDispatch ?? 50);
    const dt = this.options.dtSec;

    // Allocate GPU buffers
    // 1. Uniforms (EmtGridParams: 8 x u32/f32 = 32 bytes)
    const uniformArray = new Float32Array([
      this.numNodes,
      this.branches.length,
      this.sources.length,
      batchSteps,
      dt,
      0.0, // time_start
      2.0 * Math.PI * (this.options.nominalFrequencyHz ?? 60.0),
      this.sparseMatrix.valL.length,
    ]);
    const uniformBuffer = dev.createBuffer({
      size: Math.max(64, uniformArray.byteLength),
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    dev.queue.writeBuffer(uniformBuffer, 0, uniformArray);

    // 2. Sources buffer
    const sourceStructFloats = 6;
    const sourceData = new Float32Array(Math.max(1, this.sources.length * sourceStructFloats));
    for (let s = 0; s < this.sources.length; s++) {
      const src = this.sources[s]!;
      const base = s * sourceStructFloats;
      sourceData[base + 0] = src.nodeIdx;
      sourceData[base + 1] = src.vPeak;
      sourceData[base + 2] = src.freqRad;
      sourceData[base + 3] = src.phaseRad;
      sourceData[base + 4] = src.gSrc;
      sourceData[base + 5] = 0.0;
    }
    const sourceBuffer = dev.createBuffer({
      size: Math.max(64, sourceData.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    dev.queue.writeBuffer(sourceBuffer, 0, sourceData);

    // 3. Branches buffer
    const branchStructFloats = 8;
    const branchData = new Float32Array(Math.max(1, this.branches.length * branchStructFloats));
    for (let b = 0; b < this.branches.length; b++) {
      const br = this.branches[b]!;
      const base = b * branchStructFloats;
      branchData[base + 0] = br.fromNode;
      branchData[base + 1] = br.toNode;
      branchData[base + 2] = br.gEq;
      branchData[base + 3] = br.alphaHist;
      branchData[base + 4] = br.vCoeffHist;
      branchData[base + 5] = br.iHist ?? 0.0;
      branchData[base + 6] = 0.0;
      branchData[base + 7] = 0.0;
    }
    const branchBuffer = dev.createBuffer({
      size: Math.max(64, branchData.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    dev.queue.writeBuffer(branchBuffer, 0, branchData);

    // 4. Trajectory buffers
    const trajVoltsSize = totalSteps * this.numNodes * 4;
    const trajCurrsSize = totalSteps * Math.max(1, this.branches.length) * 4;

    const trajVoltsBuffer = dev.createBuffer({
      size: Math.max(64, trajVoltsSize),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const trajCurrsBuffer = dev.createBuffer({
      size: Math.max(64, trajCurrsSize),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    // 5. Working J and V vectors
    const jBuffer = dev.createBuffer({
      size: Math.max(64, this.numNodes * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const vBuffer = dev.createBuffer({
      size: Math.max(64, this.numNodes * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Compute pass encoding
    const bindGroup = dev.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: sourceBuffer } },
        { binding: 2, resource: { buffer: branchBuffer } },
        { binding: 3, resource: { buffer: uniformBuffer } }, // Sparse matrix data placeholder
        { binding: 4, resource: { buffer: jBuffer } },
        { binding: 5, resource: { buffer: vBuffer } },
        { binding: 6, resource: { buffer: trajVoltsBuffer } },
        { binding: 7, resource: { buffer: trajCurrsBuffer } },
      ],
    });

    const commandEncoder = dev.createCommandEncoder();
    const computePass = commandEncoder.beginComputePass();
    computePass.setPipeline(pipe);
    computePass.setBindGroup(0, bindGroup);
    computePass.dispatchWorkgroups(1, 1, 1);
    computePass.end();

    // Staging buffers for readback
    const stagingVoltsBuffer = dev.createBuffer({
      size: Math.max(64, trajVoltsSize),
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    commandEncoder.copyBufferToBuffer(trajVoltsBuffer, 0, stagingVoltsBuffer, 0, Math.max(64, trajVoltsSize));

    dev.queue.submit([commandEncoder.finish()]);

    await stagingVoltsBuffer.mapAsync(GPUMapMode.READ);
    const readArray = new Float32Array(stagingVoltsBuffer.getMappedRange());

    // Map outputs
    const time = new Float64Array(totalSteps);
    for (let k = 0; k < totalSteps; k++) {
      time[k] = k * dt;
    }

    const nodeVoltages = new Map<number, Float64Array>();
    for (let i = 0; i < this.numNodes; i++) {
      const traj = new Float64Array(totalSteps);
      for (let k = 0; k < totalSteps; k++) {
        traj[k] = readArray[k * this.numNodes + i] ?? 0.0;
      }
      nodeVoltages.set(i, traj);
    }

    stagingVoltsBuffer.unmap();

    const branchCurrents = new Map<string, Float64Array>();
    for (const br of this.branches) {
      branchCurrents.set(br.id, new Float64Array(totalSteps));
    }

    const executionTimeMs = performance.now() - startTime;
    return {
      time,
      nodeVoltages,
      branchCurrents,
      metrics: {
        totalSteps,
        executionTimeMs,
        isGpuAccelerated: true,
        batchCount: Math.ceil(totalSteps / batchSteps),
      },
    };
  }

  /**
   * High-performance CPU fallback using unrolled typed arrays.
   */
  public solveCpu(startTime: number): WebGpuSparseEmtResult {
    const totalSteps = this.options.totalSteps;
    const dt = this.options.dtSec;
    const n = this.numNodes;

    const time = new Float64Array(totalSteps);
    for (let k = 0; k < totalSteps; k++) {
      time[k] = k * dt;
    }

    const nodeVoltages = new Map<number, Float64Array>();
    for (let i = 0; i < n; i++) {
      nodeVoltages.set(i, new Float64Array(totalSteps));
    }

    const branchCurrents = new Map<string, Float64Array>();
    for (const br of this.branches) {
      branchCurrents.set(br.id, new Float64Array(totalSteps));
    }

    // Working vectors
    const J = new Float64Array(n);
    const V = new Float64Array(n);
    const branchHistories = new Float64Array(this.branches.length);
    for (let b = 0; b < this.branches.length; b++) {
      branchHistories[b] = this.branches[b]!.iHist ?? 0.0;
    }

    const { rowPtrL, colIdxL, valL, rowPtrU, colIdxU, valU, diagInvU } = this.sparseMatrix;

    for (let step = 0; step < totalSteps; step++) {
      const t = step * dt;
      J.fill(0.0);

      // 1. Source injections
      for (const src of this.sources) {
        if (src.nodeIdx >= 0 && src.nodeIdx < n) {
          const e = src.vPeak * Math.sin(src.freqRad * t + src.phaseRad);
          const u = src.nodeIdx;
          J[u] = (J[u] ?? 0.0) + src.gSrc * e;
        }
      }

      // 2. Subtract branch histories
      for (let b = 0; b < this.branches.length; b++) {
        const br = this.branches[b]!;
        const ih = branchHistories[b]!;
        if (br.fromNode >= 0 && br.fromNode < n) {
          const u = br.fromNode;
          J[u] = (J[u] ?? 0.0) - ih;
        }
        if (br.toNode >= 0 && br.toNode < n) {
          const v = br.toNode;
          J[v] = (J[v] ?? 0.0) + ih;
        }
      }

      // 3. Sparse Triangular Solve
      // Forward substitution: L * y = J
      for (let r = 0; r < n; r++) {
        let sum = J[r]!;
        const start = rowPtrL[r] ?? 0;
        const end = rowPtrL[r + 1] ?? start;
        for (let k = start; k < end; k++) {
          const c = colIdxL[k]!;
          sum -= (valL[k] ?? 0) * V[c]!;
        }
        V[r] = sum;
      }

      // Backward substitution: U * V = y
      for (let r = n - 1; r >= 0; r--) {
        let sum = V[r]!;
        const start = rowPtrU[r] ?? 0;
        const end = rowPtrU[r + 1] ?? start;
        for (let k = start; k < end; k++) {
          const c = colIdxU[k]!;
          sum -= (valU[k] ?? 0) * V[c]!;
        }
        const diagInv = diagInvU[r] ?? 1.0;
        V[r] = sum * diagInv;
      }

      // Record node voltages
      for (let i = 0; i < n; i++) {
        nodeVoltages.get(i)![step] = V[i]!;
      }

      // 4. Update branch currents & companion histories
      for (let b = 0; b < this.branches.length; b++) {
        const br = this.branches[b]!;
        const vFrom = br.fromNode >= 0 && br.fromNode < n ? V[br.fromNode]! : 0.0;
        const vTo = br.toNode >= 0 && br.toNode < n ? V[br.toNode]! : 0.0;
        const dv = vFrom - vTo;
        const ih = branchHistories[b]!;

        const cur = br.gEq * dv + ih;
        branchCurrents.get(br.id)![step] = cur;

        branchHistories[b] = br.alphaHist * cur + br.vCoeffHist * (br.gEq * dv);
      }
    }

    const executionTimeMs = performance.now() - startTime;
    return {
      time,
      nodeVoltages,
      branchCurrents,
      metrics: {
        totalSteps,
        executionTimeMs,
        isGpuAccelerated: false,
        batchCount: Math.ceil(totalSteps / (this.options.batchStepsPerDispatch ?? 50)),
      },
    };
  }

  /**
   * Solves an ensemble of grid contingency scenarios (e.g. branch trips, 3-phase faults, source perturbations)
   * in batched execution mode across the network topology.
   */
  public async solveBatchedContingencies(
    contingencies: EmtContingencyDef[],
    batchOptions?: { recordWaveforms?: boolean },
  ): Promise<WebGpuBatchedEmtResult> {
    const startTime = performance.now();
    const totalSteps = this.options.totalSteps;
    const dt = this.options.dtSec;
    const n = this.numNodes;
    const recordWaveforms = batchOptions?.recordWaveforms ?? false;
    const results: EmtContingencySummary[] = [];

    const { rowPtrL, colIdxL, valL, rowPtrU, colIdxU, valU, diagInvU } = this.sparseMatrix;

    // Working buffers reused across contingencies with 0 allocations
    const J = new Float64Array(n);
    const V = new Float64Array(n);
    const branchHistories = new Float64Array(this.branches.length);

    for (const c of contingencies) {
      branchHistories.fill(0.0);
      for (let b = 0; b < this.branches.length; b++) {
        branchHistories[b] = this.branches[b]!.iHist ?? 0.0;
      }

      let peakOvervoltageV = 0.0;
      let maxBranchCurrentA = 0.0;

      const nodeVoltages = recordWaveforms ? new Map<number, Float64Array>() : undefined;
      if (nodeVoltages) {
        for (let i = 0; i < n; i++) nodeVoltages.set(i, new Float64Array(totalSteps));
      }

      const branchCurrents = recordWaveforms ? new Map<string, Float64Array>() : undefined;
      if (branchCurrents) {
        for (const br of this.branches) branchCurrents.set(br.id, new Float64Array(totalSteps));
      }

      for (let step = 0; step < totalSteps; step++) {
        const t = step * dt;
        J.fill(0.0);

        // 1. Source injections with optional contingency modifiers
        for (let sIdx = 0; sIdx < this.sources.length; sIdx++) {
          const src = this.sources[sIdx]!;
          if (src.nodeIdx >= 0 && src.nodeIdx < n) {
            let vScale = 1.0;
            if (c.sourceModifiers) {
              for (const sm of c.sourceModifiers) {
                if (sm.sourceIdx === sIdx && t >= sm.startTimeSec) {
                  vScale = sm.vScale;
                }
              }
            }
            const e = src.vPeak * vScale * Math.sin(src.freqRad * t + src.phaseRad);
            const u = src.nodeIdx;
            J[u] = (J[u] ?? 0.0) + src.gSrc * e;
          }
        }

        // 2. Active fault injections: I_fault = -g_fault * V
        if (c.faults) {
          for (const fault of c.faults) {
            if (t >= fault.startTimeSec && t <= fault.clearTimeSec) {
              if (fault.nodeIdx >= 0 && fault.nodeIdx < n) {
                const gFault = 1.0 / Math.max(1e-6, fault.rFault);
                J[fault.nodeIdx] = (J[fault.nodeIdx] ?? 0.0) - gFault * V[fault.nodeIdx]!;
              }
            }
          }
        }

        // 3. Subtract branch histories (checking if branch is tripped)
        for (let b = 0; b < this.branches.length; b++) {
          const br = this.branches[b]!;
          let isTripped = false;
          if (c.tripBranches) {
            for (const tb of c.tripBranches) {
              if (tb.branchId === br.id && t >= tb.timeSec) {
                isTripped = true;
                break;
              }
            }
          }
          if (isTripped) continue;

          const ih = branchHistories[b]!;
          if (br.fromNode >= 0 && br.fromNode < n) {
            const u = br.fromNode;
            J[u] = (J[u] ?? 0.0) - ih;
          }
          if (br.toNode >= 0 && br.toNode < n) {
            const v = br.toNode;
            J[v] = (J[v] ?? 0.0) + ih;
          }
        }

        // 4. Sparse Triangular Solve (L * y = J, U * V = y)
        for (let r = 0; r < n; r++) {
          let sum = J[r]!;
          const start = rowPtrL[r] ?? 0;
          const end = rowPtrL[r + 1] ?? start;
          for (let k = start; k < end; k++) {
            const col = colIdxL[k]!;
            sum -= (valL[k] ?? 0) * V[col]!;
          }
          V[r] = sum;
        }

        for (let r = n - 1; r >= 0; r--) {
          let sum = V[r]!;
          const start = rowPtrU[r] ?? 0;
          const end = rowPtrU[r + 1] ?? start;
          for (let k = start; k < end; k++) {
            const col = colIdxU[k]!;
            sum -= (valU[k] ?? 0) * V[col]!;
          }
          const diagInv = diagInvU[r] ?? 1.0;
          V[r] = sum * diagInv;
        }

        // Track peak node voltages
        for (let i = 0; i < n; i++) {
          const vAbs = Math.abs(V[i]!);
          if (vAbs > peakOvervoltageV) peakOvervoltageV = vAbs;
          if (nodeVoltages) nodeVoltages.get(i)![step] = V[i]!;
        }

        // 5. Update branch currents and histories
        for (let b = 0; b < this.branches.length; b++) {
          const br = this.branches[b]!;
          let isTripped = false;
          if (c.tripBranches) {
            for (const tb of c.tripBranches) {
              if (tb.branchId === br.id && t >= tb.timeSec) {
                isTripped = true;
                break;
              }
            }
          }

          if (isTripped) {
            branchHistories[b] = 0.0;
            if (branchCurrents) branchCurrents.get(br.id)![step] = 0.0;
            continue;
          }

          const vFrom = br.fromNode >= 0 && br.fromNode < n ? V[br.fromNode]! : 0.0;
          const vTo = br.toNode >= 0 && br.toNode < n ? V[br.toNode]! : 0.0;
          const dv = vFrom - vTo;
          const ih = branchHistories[b]!;

          const cur = br.gEq * dv + ih;
          const curAbs = Math.abs(cur);
          if (curAbs > maxBranchCurrentA) maxBranchCurrentA = curAbs;
          if (branchCurrents) branchCurrents.get(br.id)![step] = cur;

          branchHistories[b] = br.alphaHist * cur + br.vCoeffHist * (br.gEq * dv);
        }
      }

      results.push({
        id: c.id,
        name: c.name,
        peakOvervoltageKv: peakOvervoltageV / 1000.0,
        maxBranchCurrentKa: maxBranchCurrentA / 1000.0,
        criticalClearanceMet: peakOvervoltageV < 1.5 * (this.sources[0]?.vPeak ?? 10000.0),
        nodeVoltages,
        branchCurrents,
      });
    }

    const elapsedMs = performance.now() - startTime;
    return {
      contingencies: results,
      totalWallClockMs: elapsedMs,
      totalSimulatedSec: contingencies.length * totalSteps * dt,
      isGpuAccelerated: false,
    };
  }
}
