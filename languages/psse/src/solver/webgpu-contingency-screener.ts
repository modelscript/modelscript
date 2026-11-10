// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/psse — WebGPU & SIMD Typed-Array Batched N-1 / N-2 Contingency Screener
 *
 * Evaluates thousands of N-1 and N-2 branch contingencies in parallel using:
 * 1. WebGPU Compute Shader (`CONTINGENCY_SCREENING_WGSL`, `@workgroup_size(64)`) over flat
 *    row-major LODF storage buffers when `navigator.gpu` is available in the browser.
 * 2. Zero-allocation typed-array CPU fallback (`evaluateBatchedLodfCpu`) with identical
 *    N-1 and N-2 Woodbury 2x2 determinant semantics for headless Node.js / worker threads.
 * 3. Top-K non-linear multi-island AC power flow confirmation and RAS/SPS evaluation.
 */

import type { PsseCase } from "../types.js";
import { solvePowerFlow } from "./ac-powerflow.js";
import {
  type CandidateContingency,
  type ContingencyEvaluationResult,
  type ContingencyScreeningOptions,
  type ContingencyScreeningReport,
  type RasAction,
  type RasEvaluationContext,
  type RemedialActionScheme,
  applyRasActions,
  calculateLodfMatrix,
  evaluateRasTriggerCondition,
} from "./contingency-screener.js";
import { detectElectricalIslands, solveMultiIslandPowerFlow } from "./island-solver.js";

// ============================================================================
// WebGPU Compute Shader (WGSL)
// ============================================================================

export const CONTINGENCY_SCREENING_WGSL = /* wgsl */ `
struct ScreeningParams {
  numBranches: u32,
  numContingencies: u32,
  overloadThresholdRatio: f32,
  padding: u32,
};

@group(0) @binding(0) var<uniform> params: ScreeningParams;
@group(0) @binding(1) var<storage, read> baseFlows: array<f32>;
@group(0) @binding(2) var<storage, read> ratings: array<f32>;
@group(0) @binding(3) var<storage, read> lodfMatrix: array<f32>;
@group(0) @binding(4) var<storage, read> outagePairs: array<i32>;
@group(0) @binding(5) var<storage, read_write> outMetrics: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let cIdx = global_id.x;
  if (cIdx >= params.numContingencies) {
    return;
  }

  let M = params.numBranches;
  let k1 = outagePairs[cIdx * 2u];
  let k2 = outagePairs[cIdx * 2u + 1u];

  var si: f32 = 0.0;
  var maxLoadingPct: f32 = 0.0;
  var overloads: f32 = 0.0;

  if (k1 >= 0 && k2 < 0) {
    // N-1 single branch outage
    let u1 = u32(k1);
    let pk1 = baseFlows[u1];
    for (var l: u32 = 0u; l < M; l = l + 1u) {
      if (l == u1) {
        continue;
      }
      let lodf_l1 = abs(lodfMatrix[l * M + u1]);
      let postFlow = abs(baseFlows[l] + lodf_l1 * pk1);
      let rating = max(ratings[l], 1e-3);
      let ratio = postFlow / rating;
      let loadingPct = ratio * 100.0;
      if (loadingPct > maxLoadingPct) {
        maxLoadingPct = loadingPct;
      }
      if (ratio >= params.overloadThresholdRatio) {
        overloads = overloads + 1.0;
      }
      let r2 = ratio * ratio;
      si = si + r2 * r2;
    }
  } else if (k1 >= 0 && k2 >= 0) {
    // N-2 double branch outage via 2x2 Woodbury determinant
    let u1 = u32(k1);
    let u2 = u32(k2);
    let lodf_12 = lodfMatrix[u1 * M + u2];
    let lodf_21 = lodfMatrix[u2 * M + u1];
    let det = 1.0 - lodf_12 * lodf_21;

    if (abs(det) > 1e-4) {
      let invDet = 1.0 / det;
      let pk1 = baseFlows[u1];
      let pk2 = baseFlows[u2];
      let eff1 = (pk1 + abs(lodf_12) * pk2) * invDet;
      let eff2 = (abs(lodf_21) * pk1 + pk2) * invDet;

      for (var l: u32 = 0u; l < M; l = l + 1u) {
        if (l == u1 || l == u2) {
          continue;
        }
        let lodf_l1 = abs(lodfMatrix[l * M + u1]);
        let lodf_l2 = abs(lodfMatrix[l * M + u2]);
        let postFlow = abs(baseFlows[l] + lodf_l1 * eff1 + lodf_l2 * eff2);
        let rating = max(ratings[l], 1e-3);
        let ratio = postFlow / rating;
        let loadingPct = ratio * 100.0;
        if (loadingPct > maxLoadingPct) {
          maxLoadingPct = loadingPct;
        }
        if (ratio >= params.overloadThresholdRatio) {
          overloads = overloads + 1.0;
        }
        let r2 = ratio * ratio;
        si = si + r2 * r2;
      }
    } else {
      // Islanding N-2 pair penalty
      si = 5000.0;
    }
  }

  let outBase = cIdx * 3u;
  outMetrics[outBase] = si;
  outMetrics[outBase + 1u] = maxLoadingPct;
  outMetrics[outBase + 2u] = overloads;
}
`;

// ============================================================================
// Batched Screening Interfaces
// ============================================================================

export interface BatchedContingencyScreeningOptions extends ContingencyScreeningOptions {
  /** Force CPU typed-array execution even if WebGPU is available. */
  preferCpu?: boolean | undefined;
}

export interface BatchedContingencyScreeningReport extends ContingencyScreeningReport {
  /** Execution backend used for linear DFAX contingency ranking. */
  backend: "webgpu" | "cpu-typed-array";
  /** Wall-clock time spent in the batched linear DFAX screening pass (ms). */
  linearScreeningTimeMs: number;
}

// ============================================================================
// Vectorized Typed-Array CPU Kernel (Exact Parity with WGSL Shader)
// ============================================================================

/**
 * Evaluates a batch of N-1 and N-2 branch contingencies on the CPU using flat typed arrays.
 * Returns `outMetrics` of length `3 * numContingencies`:
 * `[severityIndex, maxLoadingPercent, overloadCount]` per contingency.
 */
export function evaluateBatchedLodfCpu(
  baseFlows: Float64Array | Float32Array,
  ratings: Float64Array | Float32Array,
  lodfMatrix: Float64Array | Float32Array,
  outagePairs: Int32Array,
  overloadThresholdPercent = 100.0,
): Float64Array {
  const M = baseFlows.length;
  const numContingencies = outagePairs.length >>> 1;
  const outMetrics = new Float64Array(numContingencies * 3);
  const thresholdRatio = overloadThresholdPercent / 100.0;

  for (let cIdx = 0; cIdx < numContingencies; cIdx++) {
    const k1 = outagePairs[cIdx * 2]!;
    const k2 = outagePairs[cIdx * 2 + 1]!;

    let si = 0.0;
    let maxLoadingPct = 0.0;
    let overloads = 0;

    if (k1 >= 0 && k2 < 0) {
      const pk1 = baseFlows[k1]!;
      for (let l = 0; l < M; l++) {
        if (l === k1) continue;
        const lodf_l1 = Math.abs(lodfMatrix[l * M + k1]!);
        const postFlow = Math.abs(baseFlows[l]! + lodf_l1 * pk1);
        const rating = Math.max(ratings[l]!, 1e-3);
        const ratio = postFlow / rating;
        const loadingPct = ratio * 100.0;
        if (loadingPct > maxLoadingPct) maxLoadingPct = loadingPct;
        if (ratio >= thresholdRatio) overloads++;
        const r2 = ratio * ratio;
        si += r2 * r2;
      }
    } else if (k1 >= 0 && k2 >= 0) {
      const lodf_12 = lodfMatrix[k1 * M + k2]!;
      const lodf_21 = lodfMatrix[k2 * M + k1]!;
      const det = 1.0 - lodf_12 * lodf_21;

      if (Math.abs(det) > 1e-4) {
        const invDet = 1.0 / det;
        const pk1 = baseFlows[k1]!;
        const pk2 = baseFlows[k2]!;
        const eff1 = (pk1 + Math.abs(lodf_12) * pk2) * invDet;
        const eff2 = (Math.abs(lodf_21) * pk1 + pk2) * invDet;

        for (let l = 0; l < M; l++) {
          if (l === k1 || l === k2) continue;
          const lodf_l1 = Math.abs(lodfMatrix[l * M + k1]!);
          const lodf_l2 = Math.abs(lodfMatrix[l * M + k2]!);
          const postFlow = Math.abs(baseFlows[l]! + lodf_l1 * eff1 + lodf_l2 * eff2);
          const rating = Math.max(ratings[l]!, 1e-3);
          const ratio = postFlow / rating;
          const loadingPct = ratio * 100.0;
          if (loadingPct > maxLoadingPct) maxLoadingPct = loadingPct;
          if (ratio >= thresholdRatio) overloads++;
          const r2 = ratio * ratio;
          si += r2 * r2;
        }
      } else {
        si = 5000.0;
      }
    }

    const outBase = cIdx * 3;
    outMetrics[outBase] = si;
    outMetrics[outBase + 1] = maxLoadingPct;
    outMetrics[outBase + 2] = overloads;
  }

  return outMetrics;
}

// ============================================================================
// WebGPU Contingency Screener Class
// ============================================================================

export class WebGpuContingencyScreener {
  private device: any = null;
  private pipeline: any = null;
  private initialized = false;

  /**
   * Attempts to initialize WebGPU compute pipeline if `navigator.gpu` is available.
   */
  async init(): Promise<boolean> {
    if (this.initialized) return this.device !== null;
    this.initialized = true;

    const g = globalThis as any;
    if (typeof g.navigator === "undefined" || !g.navigator.gpu) {
      return false;
    }

    try {
      const adapter = await g.navigator.gpu.requestAdapter();
      if (!adapter) return false;
      this.device = await adapter.requestDevice();
      const shaderModule = this.device.createShaderModule({
        code: CONTINGENCY_SCREENING_WGSL,
      });
      this.pipeline = await this.device.createComputePipelineAsync({
        layout: "auto",
        compute: {
          module: shaderModule,
          entryPoint: "main",
        },
      });
      return true;
    } catch {
      this.device = null;
      this.pipeline = null;
      return false;
    }
  }

  /**
   * Executes batched LODF screening on WebGPU if available, or falls back to typed-array CPU.
   */
  async evaluateBatch(
    baseFlows: Float64Array,
    ratings: Float64Array,
    lodfMatrix: Float64Array,
    outagePairs: Int32Array,
    overloadThresholdPercent = 100.0,
    preferCpu = false,
  ): Promise<{ metrics: Float64Array; backend: "webgpu" | "cpu-typed-array" }> {
    const numContingencies = outagePairs.length >>> 1;
    if (numContingencies === 0) {
      return { metrics: new Float64Array(0), backend: "cpu-typed-array" };
    }

    if (!preferCpu && (await this.init()) && this.device && this.pipeline) {
      try {
        const M = baseFlows.length;
        const dev = this.device;
        const GPUBufferUsage = (globalThis as any).GPUBufferUsage;
        const GPUMapMode = (globalThis as any).GPUMapMode;

        const paramsData = new ArrayBuffer(16);
        const paramsU32 = new Uint32Array(paramsData);
        const paramsF32 = new Float32Array(paramsData);
        paramsU32[0] = M;
        paramsU32[1] = numContingencies;
        paramsF32[2] = overloadThresholdPercent / 100.0;
        paramsU32[3] = 0;

        const makeBuffer = (data: ArrayBufferView, usage: number) => {
          const buf = dev.createBuffer({
            size: Math.max(16, (data.byteLength + 3) & ~3),
            usage,
            mappedAtCreation: true,
          });
          new Uint8Array(buf.getMappedRange()).set(
            new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
          );
          buf.unmap();
          return buf;
        };

        const paramsBuf = makeBuffer(
          new Uint8Array(paramsData),
          GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        );
        const flowsBuf = makeBuffer(new Float32Array(baseFlows), GPUBufferUsage.STORAGE);
        const ratingsBuf = makeBuffer(new Float32Array(ratings), GPUBufferUsage.STORAGE);
        const lodfBuf = makeBuffer(new Float32Array(lodfMatrix), GPUBufferUsage.STORAGE);
        const pairsBuf = makeBuffer(outagePairs, GPUBufferUsage.STORAGE);

        const outByteLen = Math.max(16, numContingencies * 3 * 4);
        const outBuf = dev.createBuffer({
          size: outByteLen,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        const readbackBuf = dev.createBuffer({
          size: outByteLen,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });

        const bindGroup = dev.createBindGroup({
          layout: this.pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: paramsBuf } },
            { binding: 1, resource: { buffer: flowsBuf } },
            { binding: 2, resource: { buffer: ratingsBuf } },
            { binding: 3, resource: { buffer: lodfBuf } },
            { binding: 4, resource: { buffer: pairsBuf } },
            { binding: 5, resource: { buffer: outBuf } },
          ],
        });

        const encoder = dev.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(Math.ceil(numContingencies / 64));
        pass.end();

        encoder.copyBufferToBuffer(outBuf, 0, readbackBuf, 0, outByteLen);
        dev.queue.submit([encoder.finish()]);

        await readbackBuf.mapAsync(GPUMapMode.READ);
        const f32Out = new Float32Array(readbackBuf.getMappedRange(), 0, numContingencies * 3);
        const metrics = new Float64Array(f32Out);
        readbackBuf.unmap();

        paramsBuf.destroy();
        flowsBuf.destroy();
        ratingsBuf.destroy();
        lodfBuf.destroy();
        pairsBuf.destroy();
        outBuf.destroy();
        readbackBuf.destroy();

        return { metrics, backend: "webgpu" };
      } catch {
        // Fall through to deterministic CPU typed-array path
      }
    }

    const metrics = evaluateBatchedLodfCpu(
      baseFlows,
      ratings,
      lodfMatrix,
      outagePairs,
      overloadThresholdPercent,
    );
    return { metrics, backend: "cpu-typed-array" };
  }
}

// ============================================================================
// High-Level Async Batched Contingency Screening Entry Point
// ============================================================================

/**
 * Screens a large batch of N-1 and N-2 contingencies using WebGPU compute (or
 * vectorized typed-array fallback) for linear LODF ranking, followed by top-K
 * multi-island AC power flow confirmation.
 */
export async function screenContingenciesBatchAsync(
  psCase: PsseCase,
  contingencies: CandidateContingency[],
  options: BatchedContingencyScreeningOptions = {},
): Promise<BatchedContingencyScreeningReport> {
  const topK = options.topKAcConfirmation ?? 50;
  const vMin = options.vMinPu ?? 0.9;
  const vMax = options.vMaxPu ?? 1.1;
  const overloadThreshold = options.overloadThresholdPercent ?? 100.0;
  const rasSchemes = (options.rasSchemes ?? []).filter((s) => s.enabled !== false);

  const t0 = performance.now();

  // 1. Solve base AC power flow once
  const baseSol = solvePowerFlow(psCase, { maxIterations: 30, tolerance: 1e-4 });
  const branchBaseMap = new Map<string, number>();
  for (const br of baseSol.branches) {
    branchBaseMap.set(`${br.fromBus}_${br.toBus}_${br.ckt}`, br.mvaFlow);
  }

  const inServiceBranches = psCase.branches.filter((b) => b.st !== 0);
  const M = inServiceBranches.length;
  const baseFlows = new Float64Array(M);
  const ratings = new Float64Array(M);
  const branchIndexMap = new Map<string, number>();

  for (let idx = 0; idx < M; idx++) {
    const b = inServiceBranches[idx]!;
    const key = `${b.i}_${b.j}_${b.ckt}`;
    baseFlows[idx] = branchBaseMap.get(key) ?? 10.0;
    ratings[idx] = b.rateA > 0 ? b.rateA : 100.0;
    branchIndexMap.set(key, idx);
    branchIndexMap.set(`${b.j}_${b.i}_${b.ckt}`, idx);
  }

  // 2. Compute sparse LODF matrix and bridge-branch set
  const lodfResult = calculateLodfMatrix(psCase, {
    monitoredBranches: inServiceBranches.map((b) => ({ fromBus: b.i, toBus: b.j, ckt: b.ckt })),
    skipDenseRows: true,
  });
  const flatLodf = lodfResult.flatFactors ?? new Float64Array(M * M);
  const islandingIdxSet = new Set<number>();
  for (const br of lodfResult.islandingBranches) {
    const idx = branchIndexMap.get(`${br.fromBus}_${br.toBus}_${br.ckt}`);
    if (idx !== undefined) islandingIdxSet.add(idx);
  }

  // 3. Encode contingencies into flat Int32Array outagePairs (2 * numContingencies)
  const numCtg = contingencies.length;
  const outagePairs = new Int32Array(numCtg * 2);
  outagePairs.fill(-1);
  const trippedBranchSets: Array<Set<string>> = new Array(numCtg);
  const trippedIdxLists: Array<number[]> = new Array(numCtg);

  for (let c = 0; c < numCtg; c++) {
    const ctg = contingencies[c]!;
    const tSet = new Set<string>();
    const tIdxs: number[] = [];
    for (const ev of ctg.events) {
      if (ev.type === "trip_branch" && ev.fromBus !== undefined && ev.toBus !== undefined) {
        const ckt = ev.ckt ?? "1";
        const key = `${ev.fromBus}_${ev.toBus}_${ckt}`;
        tSet.add(key);
        const idx = branchIndexMap.get(key);
        if (idx !== undefined && !tIdxs.includes(idx)) {
          tIdxs.push(idx);
        }
      }
    }
    trippedBranchSets[c] = tSet;
    trippedIdxLists[c] = tIdxs;
    if (tIdxs.length >= 1) outagePairs[c * 2] = tIdxs[0]!;
    if (tIdxs.length >= 2) outagePairs[c * 2 + 1] = tIdxs[1]!;
  }

  // 4. Execute batched GPU / CPU linear DFAX screening
  const screener = new WebGpuContingencyScreener();
  const { metrics, backend } = await screener.evaluateBatch(
    baseFlows,
    ratings,
    flatLodf,
    outagePairs,
    overloadThreshold,
    options.preferCpu ?? false,
  );

  const baseIslands = detectElectricalIslands(psCase);
  const baseIslandCount = baseIslands.length;

  const screenedCandidates: Array<{
    contingency: CandidateContingency;
    severityIndex: number;
    causesIslanding: boolean;
    islandCount: number;
    trippedBranches: Set<string>;
  }> = [];

  for (let c = 0; c < numCtg; c++) {
    const tIdxs = trippedIdxLists[c]!;
    const trippedBranches = trippedBranchSets[c]!;
    let causesIslanding = false;
    let islandCount = baseIslandCount;

    if (tIdxs.length === 0) {
      causesIslanding = baseIslandCount > 1;
    } else if (tIdxs.length === 1 && baseIslandCount === 1 && !islandingIdxSet.has(tIdxs[0]!)) {
      causesIslanding = false;
      islandCount = 1;
    } else {
      const islands = detectElectricalIslands(psCase, (br) => {
        const k1 = `${br.i}_${br.j}_${br.ckt}`;
        const k2 = `${br.j}_${br.i}_${br.ckt}`;
        return !trippedBranches.has(k1) && !trippedBranches.has(k2);
      });
      causesIslanding = islands.length > 1;
      islandCount = islands.length;
    }

    let si = metrics[c * 3]!;
    if (causesIslanding) {
      si += 5000.0 * (islandCount - 1);
    }

    screenedCandidates.push({
      contingency: contingencies[c]!,
      severityIndex: si,
      causesIslanding,
      islandCount,
      trippedBranches,
    });
  }

  const linearScreeningTimeMs = performance.now() - t0;

  // Sort by severity descending
  screenedCandidates.sort((a, b) => b.severityIndex - a.severityIndex);

  // 5. Confirm top K with multi-island non-linear AC power flow
  const evaluatedResults: ContingencyEvaluationResult[] = [];
  const topCandidates = screenedCandidates.slice(0, Math.min(topK, screenedCandidates.length));

  for (const cand of topCandidates) {
    const ctg = cand.contingency;
    const activeFilter = (br: any) => {
      const k1 = `${br.i}_${br.j}_${br.ckt}`;
      const k2 = `${br.j}_${br.i}_${br.ckt}`;
      return !cand.trippedBranches.has(k1) && !cand.trippedBranches.has(k2);
    };

    const acSol = solveMultiIslandPowerFlow(psCase, {
      maxIterations: 25,
      tolerance: 1e-4,
      autoBalanceIslands: true,
      activeBranchFilter: activeFilter,
    });

    const overloadedBranches: ContingencyEvaluationResult["overloadedBranches"] = [];
    let maxLoading = 0.0;
    const flowMap = new Map<string, number>();
    const ratingMap = new Map<string, number>();

    for (const br of acSol.branches) {
      const key = `${br.fromBus}_${br.toBus}_${br.ckt}`;
      flowMap.set(key, br.mvaFlow);
      const rating = br.rateMva ?? 100.0;
      ratingMap.set(key, rating);

      if (rating > 0) {
        const loading = (br.mvaFlow / rating) * 100.0;
        if (loading > maxLoading) maxLoading = loading;
        if (loading >= overloadThreshold) {
          overloadedBranches.push({
            fromBus: br.fromBus,
            toBus: br.toBus,
            ckt: br.ckt,
            flowMva: br.mvaFlow,
            ratingMva: rating,
            loadingPercent: loading,
          });
        }
      }
    }

    const voltageViolations: ContingencyEvaluationResult["voltageViolations"] = [];
    const vmMap = new Map<number, number>();
    for (const b of acSol.buses) {
      vmMap.set(b.busNumber, b.vm);
      if (b.vm < vMin && b.vm > 0.1) {
        voltageViolations.push({
          busNumber: b.busNumber,
          vmPu: b.vm,
          violationType: "low",
        });
      } else if (b.vm > vMax) {
        voltageViolations.push({
          busNumber: b.busNumber,
          vmPu: b.vm,
          violationType: "high",
        });
      }
    }

    let rasTriggered: string[] | undefined;
    let rasActionsExecuted: RasAction[] | undefined;
    let postRasMaxLoading: number | undefined;
    let mitigated = false;

    if (rasSchemes.length > 0) {
      const rasCtx: RasEvaluationContext = {
        events: ctg.events,
        flowMap,
        ratingMap,
        vmMap,
        psCase,
      };

      const triggeredSchemes: RemedialActionScheme[] = [];
      for (const scheme of rasSchemes) {
        if (scheme.armingCondition && !evaluateRasTriggerCondition(scheme.armingCondition, rasCtx)) {
          continue;
        }
        if (evaluateRasTriggerCondition(scheme.trigger, rasCtx)) {
          triggeredSchemes.push(scheme);
        }
      }

      if (triggeredSchemes.length > 0) {
        triggeredSchemes.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
        rasTriggered = triggeredSchemes.map((s) => s.id);
        rasActionsExecuted = triggeredSchemes.flatMap((s) => s.actions);

        const { modifiedCase } = applyRasActions(psCase, rasActionsExecuted);
        const postRasSol = solveMultiIslandPowerFlow(modifiedCase, {
          maxIterations: 25,
          tolerance: 1e-4,
          autoBalanceIslands: true,
          activeBranchFilter: activeFilter,
        });

        if (postRasSol.converged) {
          let pMax = 0.0;
          let pOverloads = 0;
          for (const br of postRasSol.branches) {
            const rating = br.rateMva ?? 100.0;
            if (rating > 0) {
              const ld = (br.mvaFlow / rating) * 100.0;
              if (ld > pMax) pMax = ld;
              if (ld >= overloadThreshold) pOverloads++;
            }
          }
          postRasMaxLoading = Number(pMax.toFixed(1));
          mitigated = pOverloads === 0 || pMax < maxLoading;
        }
      }
    }

    let exactSi = cand.severityIndex;
    if (overloadedBranches.length > 0) {
      exactSi += overloadedBranches.reduce((sum, o) => sum + Math.pow(o.loadingPercent / 100.0, 4) * 100.0, 0);
    }
    if (voltageViolations.length > 0) {
      exactSi += voltageViolations.length * 200.0;
    }
    if (!acSol.converged) {
      exactSi += 10000.0;
    }
    if (mitigated && postRasMaxLoading !== undefined) {
      exactSi = Math.max(10.0, exactSi * (postRasMaxLoading / Math.max(1.0, maxLoading)));
    }

    evaluatedResults.push({
      id: ctg.id,
      name: ctg.name,
      events: ctg.events,
      severityIndex: Number(exactSi.toFixed(2)),
      causesIslanding: cand.causesIslanding,
      islandCount: cand.islandCount,
      acConverged: acSol.converged,
      maxBranchLoadingPercent: Number(maxLoading.toFixed(1)),
      overloadedBranches,
      voltageViolations,
      rasTriggered,
      rasActionsExecuted,
      postRasMaxBranchLoadingPercent: postRasMaxLoading,
      mitigated: rasTriggered ? mitigated : undefined,
    });
  }

  evaluatedResults.sort((a, b) => b.severityIndex - a.severityIndex);

  const criticalCount = evaluatedResults.filter(
    (r) => (r.overloadedBranches.length > 0 && !r.mitigated) || r.voltageViolations.length > 0 || !r.acConverged,
  ).length;
  const islandingCount = evaluatedResults.filter((r) => r.causesIslanding).length;

  return {
    totalEvaluated: contingencies.length,
    criticalCount,
    islandingCount,
    rankedContingencies: evaluatedResults,
    backend,
    linearScreeningTimeMs,
  };
}
