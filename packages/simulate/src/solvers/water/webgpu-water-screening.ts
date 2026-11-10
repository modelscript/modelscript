// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — High-Performance Batched Water Network Contingency & Fire Flow Screener.
 *
 * Parallelizes thousands of N-1 pipe break isolations and hydrant fire flow capacity tests
 * across drinking water networks using WebGPU compute shaders with automatic CPU SIMD fallback.
 *
 * Implements:
 *   - Pipe Outage Distribution Factors (PODF) and dipole perturbation analysis
 *   - Pressure-Dependent Demand (PDD) satisfaction ratio under pressure deficits
 *   - NFPA 291 / ISO Available Fire Flow (AFF) screening at 20 psi residual pressure
 *   - Criticality scoring and single-point-of-failure ranking for Capital Improvement Planning (CIP)
 */

/// <reference types="@webgpu/types" />

import type { WaterSensitivityData } from "./hydraulic-sensitivity.js";
import { WATER_CONTINGENCY_WGSL } from "./shaders/water_contingency.wgsl.js";

export interface WaterScreeningOptions {
  /** Minimum residual pressure head required at consumer junctions (default: 14.06 m = 20 psi) */
  minResidualPressureM?: number | undefined;
  /** Maximum allowable pipe flow velocity in m/s (default: 2.5 m/s) */
  maxVelocityMps?: number | undefined;
  /** Minimum pressure for zero flow under PDD (default: 0.0 m) */
  pddMinPressureM?: number | undefined;
  /** Required service pressure head under PDD (default: 20.0 m) */
  pddReqPressureM?: number | undefined;
  /** Standard test fire flow draw at hydrant in L/s (default: 63.09 L/s = 1,000 gpm) */
  fireFlowDrawLps?: number | undefined;
  /** Force CPU execution even if WebGPU is available */
  preferCpu?: boolean | undefined;
}

export interface WaterScenarioSummary {
  scenarioIndex: number;
  scenarioType: "N1_OUTAGE" | "FIRE_FLOW";
  targetId: string;
  targetIndex: number;
  minPressureM: number;
  minPressureNodeId: string;
  hasPressureViolation: boolean;
  hasNegativePressure: boolean;
  unsuppliedDemandLps: number;
  satisfactionRatio: number;
  maxVelocityMps: number;
  maxVelocityPipeId?: string | undefined;
  availableFireFlowLps?: number | undefined;
  nfpaClassification?: "CLASS_AA" | "CLASS_A" | "CLASS_B" | "CLASS_C" | undefined;
  criticalityScore: number;
}

export interface WaterBatchScreeningResult {
  backend: "webgpu" | "cpu-simd";
  scenarioType: "N1_OUTAGE" | "FIRE_FLOW";
  scenariosEvaluated: number;
  nodesMonitored: number;
  pipesMonitored: number;
  totalEvaluations: number;
  vulnerableScenariosCount: number;
  summaries: WaterScenarioSummary[];
  topCriticalPipes?:
    | {
        pipeId: string;
        pipeIndex: number;
        unsuppliedDemandLps: number;
        minPressureM: number;
        criticalityScore: number;
      }[]
    | undefined;
  fireFlowCapacities?:
    | {
        nodeId: string;
        availableFireFlowLps: number;
        residualPressureM: number;
        nfpaClass: "CLASS_AA" | "CLASS_A" | "CLASS_B" | "CLASS_C";
      }[]
    | undefined;
  executionTimeMs: number;
}

export class WebGpuWaterScreener {
  private device: GPUDevice | null = null;
  private pipeline: GPUComputePipeline | null = null;

  constructor(device?: GPUDevice | null) {
    this.device = device ?? null;
  }

  /**
   * Factory method that attempts to acquire a WebGPU device from navigator.gpu if available.
   */
  public static async create(customDevice?: GPUDevice | null): Promise<WebGpuWaterScreener> {
    if (customDevice) {
      const screener = new WebGpuWaterScreener(customDevice);
      await screener.initializeGpu();
      return screener;
    }

    if (typeof navigator !== "undefined" && "gpu" in navigator) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          const device = await adapter.requestDevice();
          const screener = new WebGpuWaterScreener(device);
          await screener.initializeGpu();
          return screener;
        }
      } catch {
        // Fall back to CPU
      }
    }

    return new WebGpuWaterScreener(null);
  }

  private async initializeGpu(): Promise<void> {
    if (!this.device) return;

    const shaderModule = this.device.createShaderModule({
      code: WATER_CONTINGENCY_WGSL,
    });

    this.pipeline = await this.device.createComputePipelineAsync({
      layout: "auto",
      compute: {
        module: shaderModule,
        entryPoint: "screen_water_scenario",
      },
    });
  }

  /**
   * Screens N-1 pipe break outages across all pipes in the network simultaneously.
   */
  public async screenAllPipeOutages(
    data: WaterSensitivityData,
    options?: WaterScreeningOptions,
  ): Promise<WaterBatchScreeningResult> {
    const P = data.pipeCount;
    const targetIndices = new Uint32Array(P);
    for (let p = 0; p < P; p++) {
      targetIndices[p] = p;
    }
    return this.screenScenarios(data, "N1_OUTAGE", targetIndices, options);
  }

  /**
   * Screens fire flow capacity across all consumer junctions in the network.
   */
  public async screenAllFireHydrants(
    data: WaterSensitivityData,
    options?: WaterScreeningOptions,
  ): Promise<WaterBatchScreeningResult> {
    const N = data.nodeCount;
    const targets: number[] = [];
    for (let i = 0; i < N; i++) {
      // Screen junctions with positive base head (exclude zero-head disconnected)
      if (data.nodeBaseHeads[i]! > data.nodeElevations[i]!) {
        targets.push(i);
      }
    }
    const targetIndices = new Uint32Array(targets);
    return this.screenScenarios(data, "FIRE_FLOW", targetIndices, options);
  }

  /**
   * Executes batched screening using WebGPU compute or CPU fallback.
   */
  public async screenScenarios(
    data: WaterSensitivityData,
    scenarioType: "N1_OUTAGE" | "FIRE_FLOW",
    targetIndices: Uint32Array,
    options?: WaterScreeningOptions,
  ): Promise<WaterBatchScreeningResult> {
    if (!this.device || !this.pipeline || options?.preferCpu) {
      return this.screenScenariosCpu(data, scenarioType, targetIndices, options);
    }

    try {
      return await this.screenScenariosGpu(data, scenarioType, targetIndices, options);
    } catch {
      // Graceful fallback to CPU if WebGPU allocation or execution fails
      return this.screenScenariosCpu(data, scenarioType, targetIndices, options);
    }
  }

  /**
   * High-performance CPU fallback using unrolled typed array loops.
   */
  public screenScenariosCpu(
    data: WaterSensitivityData,
    scenarioType: "N1_OUTAGE" | "FIRE_FLOW",
    targetIndices: Uint32Array,
    options?: WaterScreeningOptions,
  ): WaterBatchScreeningResult {
    const start = performance.now();
    const N = data.nodeCount;
    const P = data.pipeCount;
    const S = targetIndices.length;

    const minResP = options?.minResidualPressureM ?? 14.06;
    const maxV = options?.maxVelocityMps ?? 2.5;
    const pddMinP = options?.pddMinPressureM ?? 0.0;
    const pddReqP = options?.pddReqPressureM ?? 20.0;
    const fireDraw = options?.fireFlowDrawLps ?? 63.09;
    const totDemand = data.totalBaseDemandLps > 0 ? data.totalBaseDemandLps : 1.0;

    const summaries: WaterScenarioSummary[] = [];
    let vulnerableCount = 0;

    if (scenarioType === "N1_OUTAGE") {
      for (let s = 0; s < S; s++) {
        const pTripped = targetIndices[s]!;
        const uNode = data.pipeFromNodes[pTripped]!;
        const vNode = data.pipeToNodes[pTripped]!;
        const q0 = data.pipeBaseFlows[pTripped]!;
        const denom = data.pipeOutageFactors[pTripped]!;
        const factor = Math.abs(denom) > 1e-6 ? q0 / denom : 0.0;

        let minP = 1e6;
        let minPNode = 0;
        let unsuppliedDem = 0.0;
        let violatedNodeCount = 0;
        let hasNegativeP = false;

        // 1. Evaluate nodal heads & PDD unsupplied demands
        for (let i = 0; i < N; i++) {
          const s_iu = data.headSensitivityMatrix[i * N + uNode]!;
          const s_iv = data.headSensitivityMatrix[i * N + vNode]!;
          const deltaH = (s_iu - s_iv) * factor;

          const postH = data.nodeBaseHeads[i]! + deltaH;
          const postP = postH - data.nodeElevations[i]!;

          if (postP < minP) {
            minP = postP;
            minPNode = i;
          }
          if (postP < minResP) {
            violatedNodeCount++;
          }
          if (postP <= 0.0) {
            hasNegativeP = true;
          }

          const baseDem = data.nodeBaseDemands[i]!;
          if (baseDem > 0.0) {
            if (postP <= pddMinP) {
              unsuppliedDem += baseDem;
            } else if (postP < pddReqP) {
              const ratio = Math.sqrt((postP - pddMinP) / (pddReqP - pddMinP));
              unsuppliedDem += baseDem * (1.0 - ratio);
            }
          }
        }

        // 2. Evaluate surviving pipe velocities
        let maxVel = 0.0;
        let maxVelPipe = 0;
        for (let l = 0; l < P; l++) {
          if (l === pTripped) continue;
          const fromN = data.pipeFromNodes[l]!;
          const toN = data.pipeToNodes[l]!;
          const s_from_u = data.headSensitivityMatrix[fromN * N + uNode]!;
          const s_from_v = data.headSensitivityMatrix[fromN * N + vNode]!;
          const s_to_u = data.headSensitivityMatrix[toN * N + uNode]!;
          const s_to_v = data.headSensitivityMatrix[toN * N + vNode]!;

          const deltaH_from = (s_from_u - s_from_v) * factor;
          const deltaH_to = (s_to_u - s_to_v) * factor;

          const postFlow = data.pipeBaseFlows[l]! + data.pipeConductances[l]! * (deltaH_from - deltaH_to);
          const diam = data.pipeDiameters[l]!;
          const area = 0.78539816 * diam * diam;
          const vel = area > 1e-6 ? (Math.abs(postFlow) * 0.001) / area : 0.0;

          if (vel > maxVel) {
            maxVel = vel;
            maxVelPipe = l;
          }
        }

        const hasViolation = minP < minResP || maxVel > maxV || hasNegativeP;
        if (hasViolation) {
          vulnerableCount++;
        }

        const demScore = (unsuppliedDem / totDemand) * 50.0;
        const nodeScore = (violatedNodeCount / Math.max(1, N)) * 30.0;
        const velScore = maxV > 0 ? Math.max(0.0, (maxVel - maxV) / maxV) * 20.0 : 0.0;
        const criticalityScore = Math.min(100.0, demScore + nodeScore + velScore);

        const delivered = Math.max(0.0, totDemand - unsuppliedDem);
        const satisfactionRatio = totDemand > 0 ? delivered / totDemand : 1.0;

        summaries.push({
          scenarioIndex: s,
          scenarioType: "N1_OUTAGE",
          targetId: data.pipeIds[pTripped] ?? `Pipe_${pTripped}`,
          targetIndex: pTripped,
          minPressureM: minP,
          minPressureNodeId: data.nodeIds[minPNode] ?? `Node_${minPNode}`,
          hasPressureViolation: minP < minResP,
          hasNegativePressure: hasNegativeP,
          unsuppliedDemandLps: unsuppliedDem,
          satisfactionRatio: Math.max(0.0, Math.min(1.0, satisfactionRatio)),
          maxVelocityMps: maxVel,
          maxVelocityPipeId: data.pipeIds[maxVelPipe],
          criticalityScore,
        });
      }
    } else {
      // Fire Flow Screening
      for (let s = 0; s < S; s++) {
        const hydrant = targetIndices[s]!;
        const s_hydrant = data.headSensitivityMatrix[hydrant * N + hydrant]!;
        const baseHydrantP = data.nodeBaseHeads[hydrant]! - data.nodeElevations[hydrant]!;

        // Local available fire flow
        let affLocal = 1e6;
        if (s_hydrant > 1e-6 && baseHydrantP > minResP) {
          affLocal = (baseHydrantP - minResP) / s_hydrant;
        } else if (baseHydrantP <= minResP) {
          affLocal = 0.0;
        }

        // Network-wide constrained available fire flow
        let affNetwork = affLocal;
        for (let i = 0; i < N; i++) {
          const s_ih = data.headSensitivityMatrix[i * N + hydrant]!;
          const baseP = data.nodeBaseHeads[i]! - data.nodeElevations[i]!;
          if (s_ih > 1e-6) {
            if (baseP <= minResP) {
              affNetwork = 0.0;
              break;
            }
            const affNode = (baseP - minResP) / s_ih;
            if (affNode < affNetwork) {
              affNetwork = affNode;
            }
          }
        }
        affNetwork = Math.max(0.0, affNetwork);

        const drawDown = s_hydrant * fireDraw;
        const resP = baseHydrantP - drawDown;
        const hasViolation = resP < minResP || resP <= 0.0;
        if (hasViolation) {
          vulnerableCount++;
        }

        // NFPA 291 Classification based on Available Fire Flow at 20 psi residual
        // AA: >= 1500 gpm (94.6 L/s), A: 1000-1499 gpm (63.1-94.6 L/s)
        // B: 500-999 gpm (31.5-63.1 L/s), C: < 500 gpm (< 31.5 L/s)
        let nfpaClassification: "CLASS_AA" | "CLASS_A" | "CLASS_B" | "CLASS_C" = "CLASS_C";
        if (affNetwork >= 94.6) {
          nfpaClassification = "CLASS_AA";
        } else if (affNetwork >= 63.1) {
          nfpaClassification = "CLASS_A";
        } else if (affNetwork >= 31.5) {
          nfpaClassification = "CLASS_B";
        }

        const unsupplied = Math.max(0.0, fireDraw - affNetwork);
        const criticalityScore = Math.max(0.0, 100.0 - Math.min(100.0, (affNetwork / fireDraw) * 100.0));

        summaries.push({
          scenarioIndex: s,
          scenarioType: "FIRE_FLOW",
          targetId: data.nodeIds[hydrant] ?? `Node_${hydrant}`,
          targetIndex: hydrant,
          minPressureM: resP,
          minPressureNodeId: data.nodeIds[hydrant] ?? `Node_${hydrant}`,
          hasPressureViolation: resP < minResP,
          hasNegativePressure: resP <= 0.0,
          unsuppliedDemandLps: unsupplied,
          satisfactionRatio: fireDraw > 0 ? Math.min(1.0, affNetwork / fireDraw) : 1.0,
          maxVelocityMps: 0.0,
          availableFireFlowLps: affNetwork,
          nfpaClassification,
          criticalityScore,
        });
      }
    }

    const elapsed = performance.now() - start;

    // Rank top critical pipes if N-1 outage
    let topCriticalPipes: WaterBatchScreeningResult["topCriticalPipes"];
    if (scenarioType === "N1_OUTAGE") {
      topCriticalPipes = [...summaries]
        .sort((a, b) => b.criticalityScore - a.criticalityScore)
        .slice(0, 10)
        .map((s) => ({
          pipeId: s.targetId,
          pipeIndex: s.targetIndex,
          unsuppliedDemandLps: Math.round(s.unsuppliedDemandLps * 100) / 100,
          minPressureM: Math.round(s.minPressureM * 100) / 100,
          criticalityScore: Math.round(s.criticalityScore * 10) / 10,
        }));
    }

    // Format fire flow capacities table if fire flow
    let fireFlowCapacities: WaterBatchScreeningResult["fireFlowCapacities"];
    if (scenarioType === "FIRE_FLOW") {
      fireFlowCapacities = summaries.map((s) => ({
        nodeId: s.targetId,
        availableFireFlowLps: Math.round((s.availableFireFlowLps ?? 0) * 10) / 10,
        residualPressureM: Math.round(s.minPressureM * 10) / 10,
        nfpaClass: s.nfpaClassification ?? "CLASS_C",
      }));
    }

    return {
      backend: "cpu-simd",
      scenarioType,
      scenariosEvaluated: S,
      nodesMonitored: N,
      pipesMonitored: P,
      totalEvaluations: S * N,
      vulnerableScenariosCount: vulnerableCount,
      summaries,
      topCriticalPipes,
      fireFlowCapacities,
      executionTimeMs: elapsed,
    };
  }

  /**
   * GPU execution dispatching WGSL compute shader.
   */
  private async screenScenariosGpu(
    data: WaterSensitivityData,
    scenarioType: "N1_OUTAGE" | "FIRE_FLOW",
    targetIndices: Uint32Array,
    options?: WaterScreeningOptions,
  ): Promise<WaterBatchScreeningResult> {
    const device = this.device!;
    const pipeline = this.pipeline!;
    const start = performance.now();

    const N = data.nodeCount;
    const P = data.pipeCount;
    const S = targetIndices.length;

    const minResP = options?.minResidualPressureM ?? 14.06;
    const maxV = options?.maxVelocityMps ?? 2.5;
    const pddMinP = options?.pddMinPressureM ?? 0.0;
    const pddReqP = options?.pddReqPressureM ?? 20.0;
    const fireDraw = options?.fireFlowDrawLps ?? 63.09;
    const totDemand = data.totalBaseDemandLps > 0 ? data.totalBaseDemandLps : 1.0;

    // Uniform buffer (10 floats/uints = 40 bytes -> aligned to 48 bytes)
    const uniformData = new ArrayBuffer(48);
    const uView = new DataView(uniformData);
    uView.setUint32(0, N, true);
    uView.setUint32(4, P, true);
    uView.setUint32(8, S, true);
    uView.setUint32(12, scenarioType === "N1_OUTAGE" ? 0 : 1, true);
    uView.setFloat32(16, minResP, true);
    uView.setFloat32(20, maxV, true);
    uView.setFloat32(24, pddMinP, true);
    uView.setFloat32(28, pddReqP, true);
    uView.setFloat32(32, fireDraw, true);
    uView.setFloat32(36, totDemand, true);

    const uniformBuffer = device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    const createStorageBuffer = (arr: ArrayBufferView, usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST) => {
      const buf = device.createBuffer({
        size: Math.max(16, (arr.byteLength + 3) & ~3),
        usage,
      });
      device.queue.writeBuffer(buf, 0, arr.buffer, arr.byteOffset, arr.byteLength);
      return buf;
    };

    const bNodeElev = createStorageBuffer(data.nodeElevations);
    const bNodeHeads = createStorageBuffer(data.nodeBaseHeads);
    const bNodeDemands = createStorageBuffer(data.nodeBaseDemands);
    const bPipeFrom = createStorageBuffer(data.pipeFromNodes);
    const bPipeTo = createStorageBuffer(data.pipeToNodes);
    const bPipeCond = createStorageBuffer(data.pipeConductances);
    const bPipeFlows = createStorageBuffer(data.pipeBaseFlows);
    const bPipeDiams = createStorageBuffer(data.pipeDiameters);
    const bTargets = createStorageBuffer(targetIndices);
    const bSensitivity = createStorageBuffer(data.headSensitivityMatrix);
    const bOutageFactors = createStorageBuffer(data.pipeOutageFactors);

    // Output storage buffers (readable on GPU and copied to staging for CPU readback)
    const sBytes = Math.max(16, S * 4);
    const createOutBuffer = () =>
      device.createBuffer({
        size: sBytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });

    const bOutMinP = createOutBuffer();
    const bOutMinPNode = createOutBuffer();
    const bOutUnsupplied = createOutBuffer();
    const bOutMaxVel = createOutBuffer();
    const bOutMaxVelPipe = createOutBuffer();
    const bOutFlags = createOutBuffer();
    const bOutAff = createOutBuffer();
    const bOutScore = createOutBuffer();

    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: bNodeElev } },
        { binding: 2, resource: { buffer: bNodeHeads } },
        { binding: 3, resource: { buffer: bNodeDemands } },
        { binding: 4, resource: { buffer: bPipeFrom } },
        { binding: 5, resource: { buffer: bPipeTo } },
        { binding: 6, resource: { buffer: bPipeCond } },
        { binding: 7, resource: { buffer: bPipeFlows } },
        { binding: 8, resource: { buffer: bPipeDiams } },
        { binding: 9, resource: { buffer: bTargets } },
        { binding: 10, resource: { buffer: bSensitivity } },
        { binding: 11, resource: { buffer: bOutageFactors } },
        { binding: 12, resource: { buffer: bOutMinP } },
        { binding: 13, resource: { buffer: bOutMinPNode } },
        { binding: 14, resource: { buffer: bOutUnsupplied } },
        { binding: 15, resource: { buffer: bOutMaxVel } },
        { binding: 16, resource: { buffer: bOutMaxVelPipe } },
        { binding: 17, resource: { buffer: bOutFlags } },
        { binding: 18, resource: { buffer: bOutAff } },
        { binding: 19, resource: { buffer: bOutScore } },
      ],
    });

    const commandEncoder = device.createCommandEncoder();
    const pass = commandEncoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(S / 64), 1, 1);
    pass.end();

    // Staging buffers for readback
    const createStagingBuffer = () =>
      device.createBuffer({
        size: sBytes,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });

    const sMinP = createStagingBuffer();
    const sMinPNode = createStagingBuffer();
    const sUnsupplied = createStagingBuffer();
    const sMaxVel = createStagingBuffer();
    const sMaxVelPipe = createStagingBuffer();
    const sFlags = createStagingBuffer();
    const sAff = createStagingBuffer();
    const sScore = createStagingBuffer();

    commandEncoder.copyBufferToBuffer(bOutMinP, 0, sMinP, 0, sBytes);
    commandEncoder.copyBufferToBuffer(bOutMinPNode, 0, sMinPNode, 0, sBytes);
    commandEncoder.copyBufferToBuffer(bOutUnsupplied, 0, sUnsupplied, 0, sBytes);
    commandEncoder.copyBufferToBuffer(bOutMaxVel, 0, sMaxVel, 0, sBytes);
    commandEncoder.copyBufferToBuffer(bOutMaxVelPipe, 0, sMaxVelPipe, 0, sBytes);
    commandEncoder.copyBufferToBuffer(bOutFlags, 0, sFlags, 0, sBytes);
    commandEncoder.copyBufferToBuffer(bOutAff, 0, sAff, 0, sBytes);
    commandEncoder.copyBufferToBuffer(bOutScore, 0, sScore, 0, sBytes);

    device.queue.submit([commandEncoder.finish()]);

    await Promise.all([
      sMinP.mapAsync(GPUMapMode.READ),
      sMinPNode.mapAsync(GPUMapMode.READ),
      sUnsupplied.mapAsync(GPUMapMode.READ),
      sMaxVel.mapAsync(GPUMapMode.READ),
      sMaxVelPipe.mapAsync(GPUMapMode.READ),
      sFlags.mapAsync(GPUMapMode.READ),
      sAff.mapAsync(GPUMapMode.READ),
      sScore.mapAsync(GPUMapMode.READ),
    ]);

    const rMinP = new Float32Array(sMinP.getMappedRange().slice(0, S * 4));
    const rMinPNode = new Uint32Array(sMinPNode.getMappedRange().slice(0, S * 4));
    const rUnsupplied = new Float32Array(sUnsupplied.getMappedRange().slice(0, S * 4));
    const rMaxVel = new Float32Array(sMaxVel.getMappedRange().slice(0, S * 4));
    const rMaxVelPipe = new Uint32Array(sMaxVelPipe.getMappedRange().slice(0, S * 4));
    const rFlags = new Uint32Array(sFlags.getMappedRange().slice(0, S * 4));
    const rAff = new Float32Array(sAff.getMappedRange().slice(0, S * 4));
    const rScore = new Float32Array(sScore.getMappedRange().slice(0, S * 4));

    sMinP.unmap();
    sMinPNode.unmap();
    sUnsupplied.unmap();
    sMaxVel.unmap();
    sMaxVelPipe.unmap();
    sFlags.unmap();
    sAff.unmap();
    sScore.unmap();

    // Destroy GPU buffers to avoid memory leaks
    uniformBuffer.destroy();
    bNodeElev.destroy();
    bNodeHeads.destroy();
    bNodeDemands.destroy();
    bPipeFrom.destroy();
    bPipeTo.destroy();
    bPipeCond.destroy();
    bPipeFlows.destroy();
    bPipeDiams.destroy();
    bTargets.destroy();
    bSensitivity.destroy();
    bOutageFactors.destroy();
    bOutMinP.destroy();
    bOutMinPNode.destroy();
    bOutUnsupplied.destroy();
    bOutMaxVel.destroy();
    bOutMaxVelPipe.destroy();
    bOutFlags.destroy();
    bOutAff.destroy();
    bOutScore.destroy();
    sMinP.destroy();
    sMinPNode.destroy();
    sUnsupplied.destroy();
    sMaxVel.destroy();
    sMaxVelPipe.destroy();
    sFlags.destroy();
    sAff.destroy();
    sScore.destroy();

    const summaries: WaterScenarioSummary[] = [];
    let vulnerableCount = 0;

    for (let s = 0; s < S; s++) {
      const targetIdx = targetIndices[s]!;
      const minP = rMinP[s]!;
      const minPNode = rMinPNode[s]!;
      const unsupplied = rUnsupplied[s]!;
      const maxVel = rMaxVel[s]!;
      const maxVelPipe = rMaxVelPipe[s]!;
      const flags = rFlags[s]!;
      const aff = rAff[s]!;
      const score = rScore[s]!;

      const hasPressureViolation = (flags & 1) !== 0;
      const hasNegativePressure = (flags & 2) !== 0;
      if (hasPressureViolation || hasNegativePressure || maxVel > maxV) {
        vulnerableCount++;
      }

      let nfpaClassification: "CLASS_AA" | "CLASS_A" | "CLASS_B" | "CLASS_C" | undefined;
      if (scenarioType === "FIRE_FLOW") {
        if (aff >= 94.6) nfpaClassification = "CLASS_AA";
        else if (aff >= 63.1) nfpaClassification = "CLASS_A";
        else if (aff >= 31.5) nfpaClassification = "CLASS_B";
        else nfpaClassification = "CLASS_C";
      }

      const delivered = Math.max(0.0, totDemand - unsupplied);
      const satisfactionRatio = totDemand > 0 ? delivered / totDemand : 1.0;

      summaries.push({
        scenarioIndex: s,
        scenarioType,
        targetId:
          scenarioType === "N1_OUTAGE"
            ? (data.pipeIds[targetIdx] ?? `Pipe_${targetIdx}`)
            : (data.nodeIds[targetIdx] ?? `Node_${targetIdx}`),
        targetIndex: targetIdx,
        minPressureM: minP,
        minPressureNodeId: data.nodeIds[minPNode] ?? `Node_${minPNode}`,
        hasPressureViolation,
        hasNegativePressure,
        unsuppliedDemandLps: unsupplied,
        satisfactionRatio: Math.max(0.0, Math.min(1.0, satisfactionRatio)),
        maxVelocityMps: maxVel,
        maxVelocityPipeId: scenarioType === "N1_OUTAGE" ? data.pipeIds[maxVelPipe] : undefined,
        availableFireFlowLps: scenarioType === "FIRE_FLOW" ? aff : undefined,
        nfpaClassification,
        criticalityScore: score,
      });
    }

    const elapsed = performance.now() - start;

    let topCriticalPipes: WaterBatchScreeningResult["topCriticalPipes"];
    if (scenarioType === "N1_OUTAGE") {
      topCriticalPipes = [...summaries]
        .sort((a, b) => b.criticalityScore - a.criticalityScore)
        .slice(0, 10)
        .map((s) => ({
          pipeId: s.targetId,
          pipeIndex: s.targetIndex,
          unsuppliedDemandLps: Math.round(s.unsuppliedDemandLps * 100) / 100,
          minPressureM: Math.round(s.minPressureM * 100) / 100,
          criticalityScore: Math.round(s.criticalityScore * 10) / 10,
        }));
    }

    let fireFlowCapacities: WaterBatchScreeningResult["fireFlowCapacities"];
    if (scenarioType === "FIRE_FLOW") {
      fireFlowCapacities = summaries.map((s) => ({
        nodeId: s.targetId,
        availableFireFlowLps: Math.round((s.availableFireFlowLps ?? 0) * 10) / 10,
        residualPressureM: Math.round(s.minPressureM * 10) / 10,
        nfpaClass: s.nfpaClassification ?? "CLASS_C",
      }));
    }

    return {
      backend: "webgpu",
      scenarioType,
      scenariosEvaluated: S,
      nodesMonitored: N,
      pipesMonitored: P,
      totalEvaluations: S * N,
      vulnerableScenariosCount: vulnerableCount,
      summaries,
      topCriticalPipes,
      fireFlowCapacities,
      executionTimeMs: elapsed,
    };
  }
}
