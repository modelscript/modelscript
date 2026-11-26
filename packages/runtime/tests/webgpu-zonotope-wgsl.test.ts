// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeZonotopeBounds,
  contractZonotopeGenerators,
  createSeededRng,
  DynamicMLoraLinearLayer,
  evaluateZonotopePoint,
  RelationalZonotopeEmbedder,
  type ZonotopeTensor,
} from "../src/ml/dynamic-m-zonotope.js";
import { RelTypeId, type RelationalHypergraphRecord } from "../src/ml/schemas.js";
import {
  validateWgslShaderSource,
  WebGpuDynamicMExecutor,
  ZONOTOPE_BOUNDS_WGSL,
  ZONOTOPE_GIRARD_REDUCE_WGSL,
  ZONOTOPE_LORA_LINEAR_WGSL,
  type GPUBindGroupLike,
  type GPUBufferLike,
  type GPUCommandEncoderLike,
  type GPUComputePipelineLike,
  type GPUDeviceLike,
} from "../src/ml/webgpu-zonotope-wgsl.js";

function makeSampleRecord(): RelationalHypergraphRecord {
  return {
    exampleId: "webgpu_test_01",
    uri: "test/thermal_rc.mo",
    dialect: "modelica",
    mInit: 4,
    tokenIds: [10, 21, 32, 43, 54, 65],
    groupIds: [0, 1, 2, 1, 3, 4],
    relTypeIds: [
      RelTypeId.NONE,
      RelTypeId.IDENTITY_SYNC,
      RelTypeId.INVERSE_COUPLE,
      RelTypeId.IDENTITY_SYNC,
      RelTypeId.FLOW_CONSERVATION,
      RelTypeId.GDT_TOLERANCE_CONE,
    ],
    relSigns: [0.0, 1.0, -1.0, 1.0, 1.0, -1.0],
    spans: [],
    groups: [],
  };
}

/**
 * Software-emulated mock GPUDeviceLike that executes the exact semantics of our three
 * WGSL compute shaders in float32 while recording shader compiles, dispatches, and buffer lifecycles.
 */
function createEmulatedWebGpuDevice(): {
  device: GPUDeviceLike;
  compiledShaders: string[];
  dispatches: { label: string; x: number; y: number; z: number }[];
  createdBuffers: number;
  destroyedBuffers: number;
} {
  const compiledShaders: string[] = [];
  const dispatches: { label: string; x: number; y: number; z: number }[] = [];
  const stats = { createdBuffers: 0, destroyedBuffers: 0 };

  interface MockBuffer extends GPUBufferLike {
    readonly data: Uint8Array;
    destroyed: boolean;
  }

  interface MockPipeline extends GPUComputePipelineLike {
    readonly kind: string;
  }

  interface MockBindGroup extends GPUBindGroupLike {
    readonly bindings: Map<number, MockBuffer>;
  }

  const device: GPUDeviceLike = {
    queue: {
      writeBuffer(buffer, bufferOffset, data) {
        const mb = buffer as MockBuffer;
        const src =
          data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        mb.data.set(src, bufferOffset);
      },
      submit(commandBuffers) {
        for (const cmd of commandBuffers as (() => void)[]) {
          cmd();
        }
      },
    },
    createShaderModule(descriptor) {
      compiledShaders.push(descriptor.label ?? "unnamed");
      return { label: descriptor.label ?? "unnamed" };
    },
    createComputePipeline(descriptor) {
      return {
        kind: descriptor.label ?? "unknown",
        getBindGroupLayout: () => ({ label: "layout-0" }),
      } as MockPipeline;
    },
    createBuffer(descriptor) {
      stats.createdBuffers++;
      const data = new Uint8Array(descriptor.size);
      const buf: MockBuffer = {
        data,
        destroyed: false,
        async mapAsync() {
          // Ready immediately in mock
        },
        getMappedRange(offset = 0, size = data.byteLength - offset) {
          return data.slice(offset, offset + size).buffer;
        },
        unmap() {
          // No-op in mock
        },
        destroy() {
          if (!buf.destroyed) {
            buf.destroyed = true;
            stats.destroyedBuffers++;
          }
        },
      };
      return buf;
    },
    createBindGroup(descriptor) {
      const bindings = new Map<number, MockBuffer>();
      for (const e of descriptor.entries) {
        bindings.set(e.binding, e.resource.buffer as MockBuffer);
      }
      return { label: descriptor.label ?? "bg", bindings } as MockBindGroup;
    },
    createCommandEncoder() {
      const ops: (() => void)[] = [];
      const encoder: GPUCommandEncoderLike = {
        beginComputePass() {
          let activePipeline: MockPipeline | null = null;
          let activeBg: MockBindGroup | null = null;
          return {
            setPipeline(p) {
              activePipeline = p as MockPipeline;
            },
            setBindGroup(_idx, bg) {
              activeBg = bg as MockBindGroup;
            },
            dispatchWorkgroups(x, y = 1, z = 1) {
              const pipe = activePipeline!;
              const bg = activeBg!;
              dispatches.push({ label: pipe.kind, x, y, z });
              ops.push(() => {
                if (pipe.kind === "zonotope-lora-linear-pipeline") {
                  const pBuf = bg.bindings.get(0)!.data;
                  const u32 = new Uint32Array(pBuf.buffer, pBuf.byteOffset, 8);
                  const f32p = new Float32Array(pBuf.buffer, pBuf.byteOffset, 8);
                  const L = u32[0]!;
                  const inDim = u32[1]!;
                  const outDim = u32[2]!;
                  const rank = u32[3]!;
                  const m = u32[4]!;
                  const scale = f32p[5]!;

                  const input = new Float32Array(bg.bindings.get(1)!.data.buffer);
                  const w0 = new Float32Array(bg.bindings.get(2)!.data.buffer);
                  const bias = new Float32Array(bg.bindings.get(3)!.data.buffer);
                  const a = new Float32Array(bg.bindings.get(4)!.data.buffer);
                  const b = new Float32Array(bg.bindings.get(5)!.data.buffer);
                  const out = new Float32Array(bg.bindings.get(6)!.data.buffer);

                  for (let s = 0; s < 1 + m; s++) {
                    for (let t = 0; t < L; t++) {
                      const inBase = (s * L + t) * inDim;
                      for (let o = 0; o < outDim; o++) {
                        let acc = s === 0 ? bias[o]! : 0;
                        const wRow = o * inDim;
                        for (let i = 0; i < inDim; i++) {
                          acc = Math.fround(acc + Math.fround(input[inBase + i]! * w0[wRow + i]!));
                        }
                        let loraAcc = 0;
                        const bRow = o * rank;
                        for (let r = 0; r < rank; r++) {
                          let proj = 0;
                          const aRow = r * inDim;
                          for (let i = 0; i < inDim; i++) {
                            proj = Math.fround(proj + Math.fround(input[inBase + i]! * a[aRow + i]!));
                          }
                          loraAcc = Math.fround(loraAcc + Math.fround(b[bRow + r]! * proj));
                        }
                        out[(s * L + t) * outDim + o] = Math.fround(acc + Math.fround(scale * loraAcc));
                      }
                    }
                  }
                } else if (pipe.kind === "zonotope-bounds-pipeline") {
                  const u32 = new Uint32Array(bg.bindings.get(0)!.data.buffer, 0, 4);
                  const ld = u32[0]! * u32[1]!;
                  const m = u32[2]!;
                  const center = new Float32Array(bg.bindings.get(1)!.data.buffer);
                  const gen = new Float32Array(bg.bindings.get(2)!.data.buffer);
                  const lo = new Float32Array(bg.bindings.get(3)!.data.buffer);
                  const hi = new Float32Array(bg.bindings.get(4)!.data.buffer);
                  const rad = new Float32Array(bg.bindings.get(5)!.data.buffer);
                  for (let idx = 0; idx < ld; idx++) {
                    let r = 0;
                    for (let k = 0; k < m; k++) r = Math.fround(r + Math.abs(gen[k * ld + idx]!));
                    const c = center[idx]!;
                    rad[idx] = r;
                    lo[idx] = Math.fround(c - r);
                    hi[idx] = Math.fround(c + r);
                  }
                } else if (pipe.kind === "zonotope-girard-reduce-pipeline") {
                  const u32 = new Uint32Array(bg.bindings.get(0)!.data.buffer, 0, 4);
                  const ld = u32[0]!;
                  const keepCount = u32[2]!;
                  const collCount = u32[3]!;
                  const inGen = new Float32Array(bg.bindings.get(1)!.data.buffer);
                  const keepIdx = new Uint32Array(bg.bindings.get(2)!.data.buffer);
                  const collIdx = new Uint32Array(bg.bindings.get(3)!.data.buffer);
                  const outGen = new Float32Array(bg.bindings.get(4)!.data.buffer);
                  for (let idx = 0; idx < ld; idx++) {
                    for (let k = 0; k < keepCount; k++) {
                      outGen[k * ld + idx] = inGen[keepIdx[k]! * ld + idx]!;
                    }
                    let box = 0;
                    for (let j = 0; j < collCount; j++) {
                      box = Math.fround(box + Math.abs(inGen[collIdx[j]! * ld + idx]!));
                    }
                    outGen[keepCount * ld + idx] = box;
                  }
                }
              });
            },
            end() {
              // No-op
            },
          };
        },
        copyBufferToBuffer(src, srcOff, dst, dstOff, size) {
          ops.push(() => {
            const s = (src as MockBuffer).data;
            const d = (dst as MockBuffer).data;
            d.set(s.subarray(srcOff, srcOff + size), dstOff);
          });
        },
        finish() {
          return () => {
            for (const op of ops) op();
          };
        },
      };
      return encoder;
    },
  };

  return {
    device,
    compiledShaders,
    dispatches,
    get createdBuffers() {
      return stats.createdBuffers;
    },
    get destroyedBuffers() {
      return stats.destroyedBuffers;
    },
  };
}

describe("WebGPU WGSL Dynamic-m Zonotope Compute Shaders & Hybrid Executor", () => {
  it("validates all three WGSL compute shader sources structurally", () => {
    const loraCheck = validateWgslShaderSource(ZONOTOPE_LORA_LINEAR_WGSL);
    assert.equal(loraCheck.valid, true, `LoRA WGSL errors: ${loraCheck.errors.join("; ")}`);
    assert.equal(loraCheck.entryPoint, "main");
    assert.deepEqual(loraCheck.workgroupSize, [64, 1, 1]);
    assert.deepEqual(loraCheck.bindings, [0, 1, 2, 3, 4, 5, 6]);

    const boundsCheck = validateWgslShaderSource(ZONOTOPE_BOUNDS_WGSL);
    assert.equal(boundsCheck.valid, true, `Bounds WGSL errors: ${boundsCheck.errors.join("; ")}`);
    assert.equal(boundsCheck.entryPoint, "main");
    assert.deepEqual(boundsCheck.workgroupSize, [64, 1, 1]);
    assert.deepEqual(boundsCheck.bindings, [0, 1, 2, 3, 4, 5]);

    const girardCheck = validateWgslShaderSource(ZONOTOPE_GIRARD_REDUCE_WGSL);
    assert.equal(girardCheck.valid, true, `Girard WGSL errors: ${girardCheck.errors.join("; ")}`);
    assert.equal(girardCheck.entryPoint, "main");
    assert.deepEqual(girardCheck.workgroupSize, [64, 1, 1]);
    assert.deepEqual(girardCheck.bindings, [0, 1, 2, 3, 4]);

    // Sanity check validator catches malformed WGSL
    const broken = validateWgslShaderSource("fn main() { let x = 1u; ");
    assert.equal(broken.valid, false);
    assert.ok(broken.errors.length >= 3);
  });

  it("falls back seamlessly to CPU Dynamic-m kernels in headless Node environments", async () => {
    const executor = await WebGpuDynamicMExecutor.create();
    assert.equal(executor.backend, "cpu-fallback");

    const embedder = new RelationalZonotopeEmbedder(128, 16, 8, 42);
    const layer = new DynamicMLoraLinearLayer(16, 20, 4, 8, 101);
    const zIn = embedder.forward(makeSampleRecord(), 8);

    const zOut = await executor.loraLinearForward(layer, zIn);
    const zExpected = layer.forward(zIn);
    assert.deepEqual(zOut.center, zExpected.center);
    assert.deepEqual(zOut.generators, zExpected.generators);
    assert.deepEqual(zOut.groupIds, zExpected.groupIds);

    const bounds = await executor.computeBounds(zOut);
    const expectedBounds = computeZonotopeBounds(zOut);
    assert.deepEqual(bounds.lo, expectedBounds.lo);
    assert.deepEqual(bounds.hi, expectedBounds.hi);
    assert.deepEqual(bounds.radius, expectedBounds.radius);

    // Formal soundness: random concrete points stay enclosed inside [lo, hi]
    const rng = createSeededRng(777);
    const eff = layer.effectiveWeight();
    for (let sample = 0; sample < 24; sample++) {
      const xi = Array.from({ length: zIn.m }, () => rng() * 2 - 1);
      const xConcrete = evaluateZonotopePoint(zIn, xi);
      for (let t = 0; t < zIn.seqLen; t++) {
        for (let o = 0; o < layer.outDim; o++) {
          let y = layer.bias[o]!;
          for (let i = 0; i < layer.inDim; i++) {
            y += xConcrete[t * layer.inDim + i]! * eff[o * layer.inDim + i]!;
          }
          const idx = t * layer.outDim + o;
          assert.ok(
            y >= bounds.lo[idx]! - 1e-10 && y <= bounds.hi[idx]! + 1e-10,
            `Point ${y} escaped bounds [${bounds.lo[idx]}, ${bounds.hi[idx]}]`,
          );
        }
      }
    }

    // Girard reduction from m=4 down to mCap=2
    const reduced = await executor.girardReduce(zOut, 2, 3);
    assert.equal(reduced.out.m, 2);
    assert.equal(reduced.events.length, 1);
    assert.equal(reduced.events[0]!.kind, "girard-capped");
    const reducedBounds = await executor.computeBounds(reduced.out);
    for (let i = 0; i < bounds.lo.length; i++) {
      assert.ok(reducedBounds.lo[i]! <= bounds.lo[i]! + 1e-12);
      assert.ok(reducedBounds.hi[i]! >= bounds.hi[i]! - 1e-12);
    }
  });

  it("dispatches WGSL compute pipelines on a GPUDevice, matches CPU precision, and destroys all buffers", async () => {
    const mock = createEmulatedWebGpuDevice();
    const executor = new WebGpuDynamicMExecutor(mock.device);
    assert.equal(executor.backend, "webgpu");

    const embedder = new RelationalZonotopeEmbedder(128, 16, 8, 99);
    const layer = new DynamicMLoraLinearLayer(16, 24, 4, 8, 202);
    const zIn: ZonotopeTensor = embedder.forward(makeSampleRecord(), 8);

    // 1. LoRA Linear forward on WebGPU vs CPU reference
    const zGpu = await executor.loraLinearForward(layer, zIn);
    const zCpu = layer.forward(zIn);
    assert.equal(zGpu.seqLen, zCpu.seqLen);
    assert.equal(zGpu.dim, zCpu.dim);
    assert.equal(zGpu.m, zCpu.m);
    for (let i = 0; i < zCpu.center.length; i++) {
      assert.ok(
        Math.abs(zGpu.center[i]! - zCpu.center[i]!) < 1e-5,
        `Center mismatch at ${i}: gpu=${zGpu.center[i]}, cpu=${zCpu.center[i]}`,
      );
    }
    for (let i = 0; i < zCpu.generators.length; i++) {
      assert.ok(
        Math.abs(zGpu.generators[i]! - zCpu.generators[i]!) < 1e-5,
        `Generator mismatch at ${i}: gpu=${zGpu.generators[i]}, cpu=${zCpu.generators[i]}`,
      );
    }

    // 2. Bounds computation on WebGPU vs CPU reference
    const bGpu = await executor.computeBounds(zGpu);
    const bCpu = computeZonotopeBounds(zCpu);
    for (let i = 0; i < bCpu.radius.length; i++) {
      assert.ok(Math.abs(bGpu.radius[i]! - bCpu.radius[i]!) < 1e-5);
      assert.ok(Math.abs(bGpu.lo[i]! - bCpu.lo[i]!) < 1e-5);
      assert.ok(Math.abs(bGpu.hi[i]! - bCpu.hi[i]!) < 1e-5);
    }

    // 3. Girard reduction on WebGPU vs CPU reference (m=4 -> mCap=2)
    const gGpu = await executor.girardReduce(zCpu, 2, 1);
    const gCpu = contractZonotopeGenerators(zCpu, { pruneEps: 0, collinearCosineThreshold: 2.0, mCap: 2 }, 1);
    assert.equal(gGpu.out.m, 2);
    assert.equal(gGpu.events.length, 1);
    assert.equal(gGpu.events[0]!.kind, "girard-capped");
    assert.deepEqual(gGpu.out.groupIds, gCpu.out.groupIds);
    for (let i = 0; i < gCpu.out.generators.length; i++) {
      assert.ok(
        Math.abs(gGpu.out.generators[i]! - gCpu.out.generators[i]!) < 1e-5,
        `Girard mismatch at ${i}: gpu=${gGpu.out.generators[i]}, cpu=${gCpu.out.generators[i]}`,
      );
    }

    // Verify pipeline caching (second call shouldn't recompile shader module)
    await executor.computeBounds(zGpu);
    assert.equal(mock.compiledShaders.length, 3);
    assert.equal(mock.dispatches.length, 4);
    assert.deepEqual(mock.dispatches[0], {
      label: "zonotope-lora-linear-pipeline",
      x: Math.ceil(layer.outDim / 64),
      y: zIn.seqLen,
      z: 1 + zIn.m,
    });

    // Verify zero GPU buffer leaks
    assert.equal(mock.createdBuffers, mock.destroyedBuffers);
    assert.ok(mock.createdBuffers > 0);
  });
});
