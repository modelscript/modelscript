// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * On-GPU Parallel Statistical Reduction for Monte Carlo & Parameter Sweeps.
 *
 * Evaluates summary statistics (mean trajectory, variance, min/max envelopes)
 * directly in WebGPU storage buffers using tree-reduction compute shaders before
 * PCIe readback, reducing data transfer from O(M * N_steps * N_vars) to O(4 * N_steps * N_vars).
 */

/// <reference types="@webgpu/types" />

export interface EnsembleReductionStats {
  mean: Float32Array;
  variance: Float32Array;
  min: Float32Array;
  max: Float32Array;
}

export const REDUCTION_WGSL = /* wgsl */ `
struct ReductionUniforms {
  ensembleCount: u32,
  stepCount: u32,
  varCount: u32,
  padding: u32,
};

@group(0) @binding(0) var<uniform> uniforms: ReductionUniforms;
@group(0) @binding(1) var<storage, read> ensembleData: array<f32>;
@group(0) @binding(2) var<storage, read_write> meanData: array<f32>;
@group(0) @binding(3) var<storage, read_write> varData: array<f32>;
@group(0) @binding(4) var<storage, read_write> minData: array<f32>;
@group(0) @binding(5) var<storage, read_write> maxData: array<f32>;

@compute @workgroup_size(64, 1, 1)
fn reduce_ensemble(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let stepIdx = global_id.y;
  let varIdx = global_id.x;

  if (stepIdx >= uniforms.stepCount || varIdx >= uniforms.varCount) {
    return;
  }

  let outIdx = stepIdx * uniforms.varCount + varIdx;
  let M = uniforms.ensembleCount;
  if (M == 0u) {
    return;
  }

  var sum: f32 = 0.0;
  var minVal: f32 = 1e30;
  var maxVal: f32 = -1e30;

  // 1. First pass: mean, min, max
  for (var m: u32 = 0u; m < M; m = m + 1u) {
    let inIdx = m * (uniforms.stepCount * uniforms.varCount) + outIdx;
    let val = ensembleData[inIdx];
    sum = sum + val;
    minVal = min(minVal, val);
    maxVal = max(maxVal, val);
  }

  let mean = sum / f32(M);
  meanData[outIdx] = mean;
  minData[outIdx] = minVal;
  maxData[outIdx] = maxVal;

  // 2. Second pass: sample variance
  var sumSqDiff: f32 = 0.0;
  if (M > 1u) {
    for (var m: u32 = 0u; m < M; m = m + 1u) {
      let inIdx = m * (uniforms.stepCount * uniforms.varCount) + outIdx;
      let diff = ensembleData[inIdx] - mean;
      sumSqDiff = sumSqDiff + diff * diff;
    }
    varData[outIdx] = sumSqDiff / f32(M - 1u);
  } else {
    varData[outIdx] = 0.0;
  }
}
`;

export class WebGPUReduction {
  private pipeline!: GPUComputePipeline;

  constructor(public readonly device: GPUDevice) {}

  public async initialize(): Promise<void> {
    const shaderModule = this.device.createShaderModule({
      code: REDUCTION_WGSL,
    });
    this.pipeline = await this.device.createComputePipelineAsync({
      layout: "auto",
      compute: {
        module: shaderModule,
        entryPoint: "reduce_ensemble",
      },
    });
  }

  /**
   * Reduces an ensemble of trajectories into mean, variance, min, and max.
   *
   * @param ensembleBuffer Device storage buffer holding M * steps * vars f32 values
   * @param ensembleCount Number of parallel simulations M
   * @param stepCount Number of steps
   * @param varCount Number of state variables
   */
  public async reduceEnsemble(
    ensembleBuffer: GPUBuffer,
    ensembleCount: number,
    stepCount: number,
    varCount: number,
  ): Promise<EnsembleReductionStats> {
    const numPoints = stepCount * varCount;
    const outputBytes = numPoints * 4;

    const meanBuffer = this.device.createBuffer({
      size: outputBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const varianceBuffer = this.device.createBuffer({
      size: outputBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const minBuffer = this.device.createBuffer({
      size: outputBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const maxBuffer = this.device.createBuffer({
      size: outputBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const readbackMean = this.device.createBuffer({
      size: outputBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const readbackVar = this.device.createBuffer({
      size: outputBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const readbackMin = this.device.createBuffer({
      size: outputBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const readbackMax = this.device.createBuffer({
      size: outputBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const uniformsBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const uniformsData = new Uint32Array([ensembleCount, stepCount, varCount, 0]);
    this.device.queue.writeBuffer(uniformsBuffer, 0, uniformsData);

    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformsBuffer } },
        { binding: 1, resource: { buffer: ensembleBuffer } },
        { binding: 2, resource: { buffer: meanBuffer } },
        { binding: 3, resource: { buffer: varianceBuffer } },
        { binding: 4, resource: { buffer: minBuffer } },
        { binding: 5, resource: { buffer: maxBuffer } },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(varCount / 64), stepCount, 1);
    pass.end();

    encoder.copyBufferToBuffer(meanBuffer, 0, readbackMean, 0, outputBytes);
    encoder.copyBufferToBuffer(varianceBuffer, 0, readbackVar, 0, outputBytes);
    encoder.copyBufferToBuffer(minBuffer, 0, readbackMin, 0, outputBytes);
    encoder.copyBufferToBuffer(maxBuffer, 0, readbackMax, 0, outputBytes);

    this.device.queue.submit([encoder.finish()]);

    await Promise.all([
      readbackMean.mapAsync(GPUMapMode.READ),
      readbackVar.mapAsync(GPUMapMode.READ),
      readbackMin.mapAsync(GPUMapMode.READ),
      readbackMax.mapAsync(GPUMapMode.READ),
    ]);

    const mean = new Float32Array(readbackMean.getMappedRange()).slice();
    const variance = new Float32Array(readbackVar.getMappedRange()).slice();
    const min = new Float32Array(readbackMin.getMappedRange()).slice();
    const max = new Float32Array(readbackMax.getMappedRange()).slice();

    readbackMean.unmap();
    readbackVar.unmap();
    readbackMin.unmap();
    readbackMax.unmap();

    meanBuffer.destroy();
    varianceBuffer.destroy();
    minBuffer.destroy();
    maxBuffer.destroy();
    readbackMean.destroy();
    readbackVar.destroy();
    readbackMin.destroy();
    readbackMax.destroy();
    uniformsBuffer.destroy();

    return { mean, variance, min, max };
  }
}
