// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Browser WebGPU WGSL Compute Shaders & Hybrid Executor for Dynamic-m Zonotopes.
 *
 * Provides:
 *   1. Validated WebGPU WGSL 1.0 compute shaders:
 *      - `ZONOTOPE_LORA_LINEAR_WGSL`  : Wrapping-free affine projection through frozen W_0 + LoRA (B·A)
 *        across center + all m active generator slices in parallel.
 *      - `ZONOTOPE_BOUNDS_WGSL`       : Exact interval enclosure `[lo, hi]` and half-width `radius = Σ|G_k|`.
 *      - `ZONOTOPE_GIRARD_REDUCE_WGSL`: Hard `m_cap` VRAM-ceiling Girard box reduction folding smallest-norm
 *        generator slices into a diagonal box slack slice.
 *   2. `validateWgslShaderSource`: Lightweight structural validator for WGSL compute shader modules.
 *   3. `WebGpuDynamicMExecutor`: Browser WebGPU executor using `GPUDevice` when available and falling back
 *      seamlessly to CPU `DynamicMLoraLinearLayer` / `computeZonotopeBounds` / `contractZonotopeGenerators`
 *      in Node/headless environments.
 */

import {
  computeZonotopeBounds,
  contractZonotopeGenerators,
  type DynamicMLoraLinearLayer,
  type GeneratorLifecycleEvent,
  type ZonotopeTensor,
} from "./dynamic-m-zonotope.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Validated WebGPU WGSL 1.0 Compute Shaders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WGSL compute shader for wrapping-free affine zonotope propagation through a frozen base matrix
 * `W_0 [out_dim, in_dim]` plus trainable low-rank LoRA adapters `A [rank, in_dim]` and `B [out_dim, rank]`.
 *
 * Input layout: `input_slices` is packed as `[(1 + m), seq_len, in_dim]` where slice `0` is the
 * zonotope center `c` (bias applied) and slices `1..m` are generator slices `G[0..m-1]` (no bias).
 * Dispatch grid: `(ceil(out_dim / 64), seq_len, 1 + m)`.
 */
export const ZONOTOPE_LORA_LINEAR_WGSL = /* wgsl */ `
struct LoraLinearParams {
  seq_len: u32,
  in_dim: u32,
  out_dim: u32,
  rank: u32,
  m: u32,
  lora_scale: f32,
  _pad0: u32,
  _pad1: u32,
};

@group(0) @binding(0) var<uniform> params: LoraLinearParams;
@group(0) @binding(1) var<storage, read> input_slices: array<f32>;
@group(0) @binding(2) var<storage, read> base_weight: array<f32>;
@group(0) @binding(3) var<storage, read> bias: array<f32>;
@group(0) @binding(4) var<storage, read> lora_a: array<f32>;
@group(0) @binding(5) var<storage, read> lora_b: array<f32>;
@group(0) @binding(6) var<storage, read_write> output_slices: array<f32>;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let o: u32 = gid.x;
  let t: u32 = gid.y;
  let s: u32 = gid.z;

  if (o >= params.out_dim || t >= params.seq_len || s >= (1u + params.m)) {
    return;
  }

  let in_base: u32 = (s * params.seq_len + t) * params.in_dim;
  let w_row: u32 = o * params.in_dim;

  var acc: f32 = select(0.0, bias[o], s == 0u);

  for (var i: u32 = 0u; i < params.in_dim; i = i + 1u) {
    acc = acc + input_slices[in_base + i] * base_weight[w_row + i];
  }

  // Factored low-rank LoRA contribution: lora_scale * B[o, :] @ (A @ x)
  var lora_acc: f32 = 0.0;
  let b_row: u32 = o * params.rank;
  for (var r: u32 = 0u; r < params.rank; r = r + 1u) {
    let a_row: u32 = r * params.in_dim;
    var proj: f32 = 0.0;
    for (var i: u32 = 0u; i < params.in_dim; i = i + 1u) {
      proj = proj + input_slices[in_base + i] * lora_a[a_row + i];
    }
    lora_acc = lora_acc + lora_b[b_row + r] * proj;
  }

  let out_idx: u32 = (s * params.seq_len + t) * params.out_dim + o;
  output_slices[out_idx] = acc + params.lora_scale * lora_acc;
}
`;

/**
 * WGSL compute shader computing exact per-element interval bounds `[lo, hi]` and half-width
 * `radius[idx] = sum_{k=0}^{m-1} |generators[k * seq_len * dim + idx]|`.
 *
 * Dispatch grid: `(ceil((seq_len * dim) / 64), 1, 1)`.
 */
export const ZONOTOPE_BOUNDS_WGSL = /* wgsl */ `
struct BoundsParams {
  seq_len: u32,
  dim: u32,
  m: u32,
  _pad0: u32,
};

@group(0) @binding(0) var<uniform> params: BoundsParams;
@group(0) @binding(1) var<storage, read> center: array<f32>;
@group(0) @binding(2) var<storage, read> generators: array<f32>;
@group(0) @binding(3) var<storage, read_write> out_lo: array<f32>;
@group(0) @binding(4) var<storage, read_write> out_hi: array<f32>;
@group(0) @binding(5) var<storage, read_write> out_radius: array<f32>;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx: u32 = gid.x;
  let ld: u32 = params.seq_len * params.dim;
  if (idx >= ld) {
    return;
  }

  var rad: f32 = 0.0;
  for (var k: u32 = 0u; k < params.m; k = k + 1u) {
    rad = rad + abs(generators[k * ld + idx]);
  }

  let c: f32 = center[idx];
  out_radius[idx] = rad;
  out_lo[idx] = c - rad;
  out_hi[idx] = c + rad;
}
`;

/**
 * WGSL compute shader performing Girard order reduction to enforce hard VRAM ceiling `m_cap`.
 * Copies the `keep_count` largest-norm generator slices intact and folds the absolute magnitudes
 * of `collapsed_count` smallest-norm slices into a single diagonal box slack slice at index `keep_count`.
 *
 * Dispatch grid: `(ceil(ld / 64), 1, 1)`.
 */
export const ZONOTOPE_GIRARD_REDUCE_WGSL = /* wgsl */ `
struct GirardReduceParams {
  ld: u32,
  m_in: u32,
  keep_count: u32,
  collapsed_count: u32,
};

@group(0) @binding(0) var<uniform> params: GirardReduceParams;
@group(0) @binding(1) var<storage, read> in_generators: array<f32>;
@group(0) @binding(2) var<storage, read> keep_indices: array<u32>;
@group(0) @binding(3) var<storage, read> collapsed_indices: array<u32>;
@group(0) @binding(4) var<storage, read_write> out_generators: array<f32>;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx: u32 = gid.x;
  if (idx >= params.ld) {
    return;
  }

  for (var k: u32 = 0u; k < params.keep_count; k = k + 1u) {
    let src_k: u32 = keep_indices[k];
    out_generators[k * params.ld + idx] = in_generators[src_k * params.ld + idx];
  }

  var box_slack: f32 = 0.0;
  for (var j: u32 = 0u; j < params.collapsed_count; j = j + 1u) {
    let src_k: u32 = collapsed_indices[j];
    box_slack = box_slack + abs(in_generators[src_k * params.ld + idx]);
  }

  out_generators[params.keep_count * params.ld + idx] = box_slack;
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// 2. WGSL Structural Validator
// ─────────────────────────────────────────────────────────────────────────────

export interface WgslValidationResult {
  valid: boolean;
  errors: string[];
  entryPoint: string | null;
  workgroupSize: [number, number, number] | null;
  bindings: number[];
}

/**
 * Validates that a WGSL compute shader source contains well-formed balanced delimiters,
 * a `@compute @workgroup_size(...)` entry point, `@builtin(global_invocation_id)`,
 * and unique `@group(0) @binding(n)` bindings.
 */
export function validateWgslShaderSource(source: string): WgslValidationResult {
  const errors: string[] = [];

  // Strip line comments for structural checks
  const stripped = source.replace(/\/\/[^\n]*/g, "");

  // Check balanced braces and parentheses
  let braceDepth = 0;
  let parenDepth = 0;
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === "{") braceDepth++;
    else if (ch === "}") braceDepth--;
    else if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth--;
    if (braceDepth < 0) errors.push(`Unmatched '}' at char ${i}`);
    if (parenDepth < 0) errors.push(`Unmatched ')' at char ${i}`);
  }
  if (braceDepth !== 0) errors.push(`Unbalanced braces (depth=${braceDepth})`);
  if (parenDepth !== 0) errors.push(`Unbalanced parentheses (depth=${parenDepth})`);

  if (!/@compute\b/.test(stripped)) {
    errors.push("Missing @compute stage attribute.");
  }

  const wgMatch = stripped.match(/@workgroup_size\(\s*(\d+)(?:\s*,\s*(\d+))?(?:\s*,\s*(\d+))?\s*\)/);
  let workgroupSize: [number, number, number] | null = null;
  if (!wgMatch) {
    errors.push("Missing @workgroup_size(...) attribute.");
  } else {
    workgroupSize = [Number(wgMatch[1]), Number(wgMatch[2] ?? "1"), Number(wgMatch[3] ?? "1")];
    if (workgroupSize[0] <= 0 || workgroupSize[1] <= 0 || workgroupSize[2] <= 0) {
      errors.push("Workgroup dimensions must be positive integers.");
    }
  }

  const entryMatch = stripped.match(/@compute[\s\S]*?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
  const entryPoint = entryMatch?.[1] ?? null;
  if (!entryPoint) {
    errors.push("Missing compute entry point function declaration.");
  }

  if (!/@builtin\(\s*global_invocation_id\s*\)/.test(stripped)) {
    errors.push("Missing @builtin(global_invocation_id) parameter.");
  }

  const bindings: number[] = [];
  const seenBindings = new Set<number>();
  const bindingRegex = /@group\(\s*(\d+)\s*\)\s*@binding\(\s*(\d+)\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = bindingRegex.exec(stripped)) !== null) {
    const b = Number(match[2]);
    bindings.push(b);
    if (seenBindings.has(b)) {
      errors.push(`Duplicate @binding(${b}) declaration.`);
    }
    seenBindings.add(b);
  }
  if (bindings.length === 0) {
    errors.push("Shader declares no @group/@binding resources.");
  }

  return {
    valid: errors.length === 0,
    errors,
    entryPoint,
    workgroupSize,
    bindings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Structural WebGPU Interfaces (Node & Browser Compatible, Zero Extra Deps)
// ─────────────────────────────────────────────────────────────────────────────

export const GPU_BUFFER_USAGE = {
  MAP_READ: 0x0001,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
} as const;

export const GPU_MAP_MODE_READ = 0x0001;

export interface GPUBufferLike {
  mapAsync(mode: number): Promise<void>;
  getMappedRange(offset?: number, size?: number): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}

export interface GPUShaderModuleLike {
  readonly label?: string;
}

export interface GPUBindGroupLayoutLike {
  readonly label?: string;
}

export interface GPUComputePipelineLike {
  getBindGroupLayout(index: number): GPUBindGroupLayoutLike;
}

export interface GPUBindGroupLike {
  readonly label?: string;
}

export interface GPUComputePassEncoderLike {
  setPipeline(pipeline: GPUComputePipelineLike): void;
  setBindGroup(index: number, bindGroup: GPUBindGroupLike): void;
  dispatchWorkgroups(x: number, y?: number, z?: number): void;
  end(): void;
}

export interface GPUCommandEncoderLike {
  beginComputePass(descriptor?: { label?: string }): GPUComputePassEncoderLike;
  copyBufferToBuffer(
    source: GPUBufferLike,
    sourceOffset: number,
    destination: GPUBufferLike,
    destinationOffset: number,
    size: number,
  ): void;
  finish(): unknown;
}

export interface GPUQueueLike {
  writeBuffer(
    buffer: GPUBufferLike,
    bufferOffset: number,
    data: ArrayBufferView | ArrayBuffer,
    dataOffset?: number,
    size?: number,
  ): void;
  submit(commandBuffers: unknown[]): void;
}

export interface GPUDeviceLike {
  readonly queue: GPUQueueLike;
  createShaderModule(descriptor: { label?: string; code: string }): GPUShaderModuleLike;
  createComputePipeline(descriptor: {
    label?: string;
    layout: "auto";
    compute: { module: GPUShaderModuleLike; entryPoint: string };
  }): GPUComputePipelineLike;
  createBuffer(descriptor: { label?: string; size: number; usage: number }): GPUBufferLike;
  createBindGroup(descriptor: {
    label?: string;
    layout: GPUBindGroupLayoutLike;
    entries: { binding: number; resource: { buffer: GPUBufferLike } }[];
  }): GPUBindGroupLike;
  createCommandEncoder(descriptor?: { label?: string }): GPUCommandEncoderLike;
}

interface NavigatorWithGpu {
  gpu?: {
    requestAdapter(): Promise<{ requestDevice(): Promise<GPUDeviceLike> } | null>;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. WebGpuDynamicMExecutor (WebGPU Compute + Seamless CPU Fallback)
// ─────────────────────────────────────────────────────────────────────────────

function padByteLength(bytes: number): number {
  const minBytes = Math.max(4, bytes);
  return Math.ceil(minBytes / 4) * 4;
}

function toFloat32Array(arr: Float64Array | Float32Array): Float32Array {
  if (arr instanceof Float32Array) return arr;
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i]!;
  return out;
}

function sliceL2Norm(gens: Float64Array, sliceIdx: number, ld: number): number {
  const base = sliceIdx * ld;
  let sumSq = 0;
  for (let i = 0; i < ld; i++) {
    const v = gens[base + i]!;
    sumSq += v * v;
  }
  return Math.sqrt(sumSq);
}

/**
 * Browser WebGPU compute executor for Dynamic-m Relational Zonotope operations.
 * Automatically executes WGSL compute shaders on `GPUDevice` when present and falls back
 * transparently to `DynamicMLoraLinearLayer` / `computeZonotopeBounds` / `contractZonotopeGenerators`
 * in Node or headless environments without WebGPU.
 */
export class WebGpuDynamicMExecutor {
  private readonly device: GPUDeviceLike | null;
  private loraPipeline: GPUComputePipelineLike | null = null;
  private boundsPipeline: GPUComputePipelineLike | null = null;
  private girardPipeline: GPUComputePipelineLike | null = null;

  constructor(device?: GPUDeviceLike | null) {
    this.device = device ?? null;
  }

  /**
   * Attempts to acquire a WebGPU `GPUDevice` from `globalThis.navigator?.gpu`.
   * Falls back cleanly to CPU mode when WebGPU is unavailable.
   */
  public static async create(): Promise<WebGpuDynamicMExecutor> {
    const nav = (globalThis as unknown as { navigator?: NavigatorWithGpu }).navigator;
    if (nav?.gpu) {
      try {
        const adapter = await nav.gpu.requestAdapter();
        if (adapter) {
          const device = await adapter.requestDevice();
          return new WebGpuDynamicMExecutor(device);
        }
      } catch {
        // Fall through to CPU fallback
      }
    }
    return new WebGpuDynamicMExecutor(null);
  }

  /** Active execution backend (`"webgpu"` or `"cpu-fallback"`). */
  public get backend(): "webgpu" | "cpu-fallback" {
    return this.device !== null ? "webgpu" : "cpu-fallback";
  }

  private getOrCreatePipeline(kind: "lora" | "bounds" | "girard"): GPUComputePipelineLike {
    const dev = this.device;
    if (!dev) throw new Error("WebGPU device is not available.");

    if (kind === "lora") {
      if (!this.loraPipeline) {
        const mod = dev.createShaderModule({ label: "zonotope-lora-linear", code: ZONOTOPE_LORA_LINEAR_WGSL });
        this.loraPipeline = dev.createComputePipeline({
          label: "zonotope-lora-linear-pipeline",
          layout: "auto",
          compute: { module: mod, entryPoint: "main" },
        });
      }
      return this.loraPipeline;
    }

    if (kind === "bounds") {
      if (!this.boundsPipeline) {
        const mod = dev.createShaderModule({ label: "zonotope-bounds", code: ZONOTOPE_BOUNDS_WGSL });
        this.boundsPipeline = dev.createComputePipeline({
          label: "zonotope-bounds-pipeline",
          layout: "auto",
          compute: { module: mod, entryPoint: "main" },
        });
      }
      return this.boundsPipeline;
    }

    if (!this.girardPipeline) {
      const mod = dev.createShaderModule({ label: "zonotope-girard-reduce", code: ZONOTOPE_GIRARD_REDUCE_WGSL });
      this.girardPipeline = dev.createComputePipeline({
        label: "zonotope-girard-reduce-pipeline",
        layout: "auto",
        compute: { module: mod, entryPoint: "main" },
      });
    }
    return this.girardPipeline;
  }

  private createUploadedBuffer(label: string, data: ArrayBufferView, usage: number): GPUBufferLike {
    const dev = this.device!;
    const size = padByteLength(data.byteLength);
    const buf = dev.createBuffer({ label, size, usage: usage | GPU_BUFFER_USAGE.COPY_DST });
    if (data.byteLength > 0) {
      dev.queue.writeBuffer(buf, 0, data);
    }
    return buf;
  }

  private async readBackFloat64(srcBuffer: GPUBufferLike, elementCount: number): Promise<Float64Array> {
    const dev = this.device!;
    if (elementCount === 0) return new Float64Array(0);
    const byteLength = padByteLength(elementCount * 4);
    const readBuf = dev.createBuffer({
      label: "zonotope-readback",
      size: byteLength,
      usage: GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.MAP_READ,
    });
    try {
      const encoder = dev.createCommandEncoder({ label: "zonotope-readback-copy" });
      encoder.copyBufferToBuffer(srcBuffer, 0, readBuf, 0, byteLength);
      dev.queue.submit([encoder.finish()]);
      await readBuf.mapAsync(GPU_MAP_MODE_READ);
      const mapped = new Float32Array(readBuf.getMappedRange(0, elementCount * 4));
      const out = new Float64Array(elementCount);
      for (let i = 0; i < elementCount; i++) out[i] = mapped[i]!;
      readBuf.unmap();
      return out;
    } finally {
      readBuf.destroy();
    }
  }

  /**
   * Executes wrapping-free affine LoRA linear propagation `y = x (W_0 + scale * B A)^T + b`
   * on WebGPU when available, or falls back directly to `layer.forward(x)`.
   */
  public async loraLinearForward(layer: DynamicMLoraLinearLayer, x: ZonotopeTensor): Promise<ZonotopeTensor> {
    if (!this.device) {
      return layer.forward(x);
    }

    const L = x.seqLen;
    const m = x.m;
    const totalSlices = 1 + m;
    const inSliceSize = L * layer.inDim;
    const outSliceSize = L * layer.outDim;

    // Pack [center, generators] contiguously as float32
    const packedIn = new Float32Array(totalSlices * inSliceSize);
    for (let i = 0; i < inSliceSize; i++) packedIn[i] = x.center[i]!;
    for (let i = 0; i < m * inSliceSize; i++) packedIn[inSliceSize + i] = x.generators[i]!;

    // Uniforms: [seq_len, in_dim, out_dim, rank, m, lora_scale, 0, 0]
    const uniformBufData = new ArrayBuffer(32);
    const u32View = new Uint32Array(uniformBufData);
    const f32View = new Float32Array(uniformBufData);
    u32View[0] = L;
    u32View[1] = layer.inDim;
    u32View[2] = layer.outDim;
    u32View[3] = layer.rank;
    u32View[4] = m;
    f32View[5] = layer.loraScale;
    u32View[6] = 0;
    u32View[7] = 0;

    const buffers: GPUBufferLike[] = [];
    try {
      const paramsBuf = this.createUploadedBuffer("lora-params", u32View, GPU_BUFFER_USAGE.UNIFORM);
      const inBuf = this.createUploadedBuffer("lora-in", packedIn, GPU_BUFFER_USAGE.STORAGE);
      const w0Buf = this.createUploadedBuffer("lora-w0", toFloat32Array(layer.baseWeight), GPU_BUFFER_USAGE.STORAGE);
      const biasBuf = this.createUploadedBuffer("lora-bias", toFloat32Array(layer.bias), GPU_BUFFER_USAGE.STORAGE);
      const aBuf = this.createUploadedBuffer("lora-a", toFloat32Array(layer.loraA), GPU_BUFFER_USAGE.STORAGE);
      const bBuf = this.createUploadedBuffer("lora-b", toFloat32Array(layer.loraB), GPU_BUFFER_USAGE.STORAGE);
      const outBuf = this.device.createBuffer({
        label: "lora-out",
        size: padByteLength(totalSlices * outSliceSize * 4),
        usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_SRC,
      });
      buffers.push(paramsBuf, inBuf, w0Buf, biasBuf, aBuf, bBuf, outBuf);

      const pipeline = this.getOrCreatePipeline("lora");
      const bindGroup = this.device.createBindGroup({
        label: "lora-bind-group",
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: paramsBuf } },
          { binding: 1, resource: { buffer: inBuf } },
          { binding: 2, resource: { buffer: w0Buf } },
          { binding: 3, resource: { buffer: biasBuf } },
          { binding: 4, resource: { buffer: aBuf } },
          { binding: 5, resource: { buffer: bBuf } },
          { binding: 6, resource: { buffer: outBuf } },
        ],
      });

      const encoder = this.device.createCommandEncoder({ label: "lora-compute" });
      const pass = encoder.beginComputePass({ label: "lora-pass" });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(layer.outDim / 64), Math.max(1, L), totalSlices);
      pass.end();
      this.device.queue.submit([encoder.finish()]);

      const packedOut = await this.readBackFloat64(outBuf, totalSlices * outSliceSize);
      const outCenter = packedOut.slice(0, outSliceSize);
      const outGen = packedOut.slice(outSliceSize);
      return {
        seqLen: L,
        dim: layer.outDim,
        m,
        center: outCenter,
        generators: outGen,
        groupIds: new Int32Array(x.groupIds),
      };
    } finally {
      for (const b of buffers) b.destroy();
    }
  }

  /**
   * Computes exact interval bounds `[lo, hi]` and `radius = Σ|G_k|` on WebGPU when available,
   * or falls back directly to `computeZonotopeBounds(z)`.
   */
  public async computeBounds(z: ZonotopeTensor): Promise<{ lo: Float64Array; hi: Float64Array; radius: Float64Array }> {
    if (!this.device) {
      return computeZonotopeBounds(z);
    }

    const ld = z.seqLen * z.dim;
    if (ld === 0) {
      return { lo: new Float64Array(0), hi: new Float64Array(0), radius: new Float64Array(0) };
    }

    const paramsData = new Uint32Array([z.seqLen, z.dim, z.m, 0]);
    const genF32 = z.m > 0 ? toFloat32Array(z.generators) : new Float32Array(1);
    const buffers: GPUBufferLike[] = [];
    try {
      const paramsBuf = this.createUploadedBuffer("bounds-params", paramsData, GPU_BUFFER_USAGE.UNIFORM);
      const centerBuf = this.createUploadedBuffer("bounds-center", toFloat32Array(z.center), GPU_BUFFER_USAGE.STORAGE);
      const genBuf = this.createUploadedBuffer("bounds-gen", genF32, GPU_BUFFER_USAGE.STORAGE);
      const outByteLen = padByteLength(ld * 4);
      const loBuf = this.device.createBuffer({
        label: "bounds-lo",
        size: outByteLen,
        usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_SRC,
      });
      const hiBuf = this.device.createBuffer({
        label: "bounds-hi",
        size: outByteLen,
        usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_SRC,
      });
      const radBuf = this.device.createBuffer({
        label: "bounds-rad",
        size: outByteLen,
        usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_SRC,
      });
      buffers.push(paramsBuf, centerBuf, genBuf, loBuf, hiBuf, radBuf);

      const pipeline = this.getOrCreatePipeline("bounds");
      const bindGroup = this.device.createBindGroup({
        label: "bounds-bind-group",
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: paramsBuf } },
          { binding: 1, resource: { buffer: centerBuf } },
          { binding: 2, resource: { buffer: genBuf } },
          { binding: 3, resource: { buffer: loBuf } },
          { binding: 4, resource: { buffer: hiBuf } },
          { binding: 5, resource: { buffer: radBuf } },
        ],
      });

      const encoder = this.device.createCommandEncoder({ label: "bounds-compute" });
      const pass = encoder.beginComputePass({ label: "bounds-pass" });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(ld / 64), 1, 1);
      pass.end();
      this.device.queue.submit([encoder.finish()]);

      const [lo, hi, radius] = await Promise.all([
        this.readBackFloat64(loBuf, ld),
        this.readBackFloat64(hiBuf, ld),
        this.readBackFloat64(radBuf, ld),
      ]);
      return { lo, hi, radius };
    } finally {
      for (const b of buffers) b.destroy();
    }
  }

  /**
   * Performs Girard box reduction to enforce hard safety ceiling `mCap` (`m <= mCap`).
   * Runs `ZONOTOPE_GIRARD_REDUCE_WGSL` on WebGPU when available, or falls back seamlessly
   * to `contractZonotopeGenerators` in CPU/headless mode.
   */
  public async girardReduce(
    z: ZonotopeTensor,
    mCap: number,
    layerIndex = 0,
  ): Promise<{ out: ZonotopeTensor; events: GeneratorLifecycleEvent[] }> {
    const safeCap = Math.max(1, Math.floor(mCap));
    if (z.m <= safeCap) {
      return {
        out: {
          seqLen: z.seqLen,
          dim: z.dim,
          m: z.m,
          center: new Float64Array(z.center),
          generators: new Float64Array(z.generators),
          groupIds: new Int32Array(z.groupIds),
        },
        events: [],
      };
    }

    if (!this.device) {
      return contractZonotopeGenerators(z, { pruneEps: 0, collinearCosineThreshold: 2.0, mCap: safeCap }, layerIndex);
    }

    const ld = z.seqLen * z.dim;
    const ranked = Array.from({ length: z.m }, (_, k) => ({
      index: k,
      groupId: z.groupIds[k]!,
      norm: sliceL2Norm(z.generators, k, ld),
    }));
    ranked.sort((a, b) => b.norm - a.norm);

    const keepCount = safeCap - 1;
    const kept = ranked.slice(0, keepCount);
    const collapsed = ranked.slice(keepCount);

    const keepIndices = Uint32Array.from(kept.length > 0 ? kept.map((r) => r.index) : [0]);
    const collapsedIndices = Uint32Array.from(collapsed.map((r) => r.index));
    const paramsData = new Uint32Array([ld, z.m, keepCount, collapsed.length]);

    const buffers: GPUBufferLike[] = [];
    try {
      const paramsBuf = this.createUploadedBuffer("girard-params", paramsData, GPU_BUFFER_USAGE.UNIFORM);
      const inGenBuf = this.createUploadedBuffer(
        "girard-in-gen",
        toFloat32Array(z.generators),
        GPU_BUFFER_USAGE.STORAGE,
      );
      const keepIdxBuf = this.createUploadedBuffer("girard-keep-idx", keepIndices, GPU_BUFFER_USAGE.STORAGE);
      const collIdxBuf = this.createUploadedBuffer("girard-coll-idx", collapsedIndices, GPU_BUFFER_USAGE.STORAGE);
      const outGenBuf = this.device.createBuffer({
        label: "girard-out-gen",
        size: padByteLength(safeCap * ld * 4),
        usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_SRC,
      });
      buffers.push(paramsBuf, inGenBuf, keepIdxBuf, collIdxBuf, outGenBuf);

      const pipeline = this.getOrCreatePipeline("girard");
      const bindGroup = this.device.createBindGroup({
        label: "girard-bind-group",
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: paramsBuf } },
          { binding: 1, resource: { buffer: inGenBuf } },
          { binding: 2, resource: { buffer: keepIdxBuf } },
          { binding: 3, resource: { buffer: collIdxBuf } },
          { binding: 4, resource: { buffer: outGenBuf } },
        ],
      });

      const encoder = this.device.createCommandEncoder({ label: "girard-compute" });
      const pass = encoder.beginComputePass({ label: "girard-pass" });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(ld / 64), 1, 1);
      pass.end();
      this.device.queue.submit([encoder.finish()]);

      const outGen = await this.readBackFloat64(outGenBuf, safeCap * ld);
      const outGroupIds = new Int32Array(safeCap);
      for (let k = 0; k < keepCount; k++) outGroupIds[k] = kept[k]!.groupId;
      outGroupIds[keepCount] = -1;

      const event: GeneratorLifecycleEvent = {
        layerIndex,
        kind: "girard-capped",
        mBefore: z.m,
        mAfter: safeCap,
        groupIds: collapsed.map((c) => c.groupId),
        metric: safeCap,
        detail: `WebGPU Girard-reduced ${collapsed.length} smallest generators to enforce m_cap = ${safeCap}`,
      };

      return {
        out: {
          seqLen: z.seqLen,
          dim: z.dim,
          m: safeCap,
          center: new Float64Array(z.center),
          generators: outGen,
          groupIds: outGroupIds,
        },
        events: [event],
      };
    } finally {
      for (const b of buffers) b.destroy();
    }
  }
}
