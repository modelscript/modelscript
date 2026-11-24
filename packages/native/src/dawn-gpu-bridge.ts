// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Node.js Dawn WebGPU bridge for `@modelscript/native`.
 *
 * Exposes a `@webgpu/types`-compatible `GPU` provider on
 * `globalThis.__modelscript_native_gpu__` so `WebGPUSimulationRunner` and other
 * GPU solvers can run headless compute shaders in Node.js / Desktop VS Code
 * without a browser `navigator.gpu`.
 *
 * Resolution order:
 *   1. Native Dawn N-API bindings exported by `modelscript_native.node`
 *      (`addon.gpu` or `addon.dawnDispatchCompute` when `dawnAvailable === true`).
 *   2. Optional `webgpu` Node.js package (Dawn's official Node N-API bindings)
 *      if installed in the host environment.
 *   3. Returns `null` cleanly when neither is available (CPU fallback).
 */

import { createRequire } from "node:module";
import { loadNativeAddon, type ModelScriptNativeAddon, type NativeGpuCapabilities } from "./index.js";

/**
 * Minimal structural subset of `@webgpu/types` `GPU` so `@modelscript/native`
 * remains zero-dependency while being directly assignable to `GPU` in callers
 * that reference `@webgpu/types`.
 */
export interface NativeGPUProvider {
  readonly __brand: "GPU";
  requestAdapter(options?: {
    powerPreference?: "low-power" | "high-performance";
    forceFallbackAdapter?: boolean;
  }): Promise<NativeGPUAdapter | null>;
  getPreferredCanvasFormat(): string;
  readonly wgslLanguageFeatures: ReadonlySet<string>;
}

export interface NativeGPUAdapterInfo {
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
}

export interface NativeGPUAdapter {
  readonly features: ReadonlySet<string>;
  readonly limits: Record<string, number>;
  readonly info: NativeGPUAdapterInfo;
  readonly isFallbackAdapter: boolean;
  requestDevice(descriptor?: Record<string, unknown>): Promise<NativeGPUDevice>;
}

export interface NativeGPUDevice {
  readonly features: ReadonlySet<string>;
  readonly limits: Record<string, number>;
  readonly queue: NativeGPUQueue;
  readonly lost: Promise<{ reason: string; message: string }>;
  createShaderModule(descriptor: { label?: string; code: string }): NativeGPUShaderModule;
  createComputePipeline(descriptor: {
    label?: string;
    layout: unknown;
    compute: { module: NativeGPUShaderModule; entryPoint?: string };
  }): NativeGPUComputePipeline;
  createBuffer(descriptor: {
    label?: string;
    size: number;
    usage: number;
    mappedAtCreation?: boolean;
  }): NativeGPUBuffer;
  createBindGroup(descriptor: {
    label?: string;
    layout: unknown;
    entries: Array<{ binding: number; resource: { buffer: NativeGPUBuffer; offset?: number; size?: number } }>;
  }): NativeGPUBindGroup;
  createCommandEncoder(descriptor?: { label?: string }): NativeGPUCommandEncoder;
  destroy(): void;
}

export interface NativeGPUShaderModule {
  readonly label: string;
  readonly code: string;
}

export interface NativeGPUComputePipeline {
  readonly label: string;
  readonly module: NativeGPUShaderModule;
  readonly entryPoint: string;
  getBindGroupLayout(index: number): { readonly index: number };
}

export interface NativeGPUBuffer {
  readonly label: string;
  readonly size: number;
  readonly usage: number;
  readonly mapState: "unmapped" | "pending" | "mapped";
  mapAsync(mode: number, offset?: number, size?: number): Promise<void>;
  getMappedRange(offset?: number, size?: number): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}

export interface NativeGPUBindGroup {
  readonly label: string;
  readonly entries: ReadonlyArray<{ binding: number; buffer: NativeGPUBuffer; offset: number; size: number }>;
}

export interface NativeGPUComputePassEncoder {
  setPipeline(pipeline: NativeGPUComputePipeline): void;
  setBindGroup(index: number, bindGroup: NativeGPUBindGroup): void;
  dispatchWorkgroups(workgroupCountX: number, workgroupCountY?: number, workgroupCountZ?: number): void;
  end(): void;
}

export interface NativeGPUCommandEncoder {
  beginComputePass(descriptor?: { label?: string }): NativeGPUComputePassEncoder;
  copyBufferToBuffer(
    source: NativeGPUBuffer,
    sourceOffset: number,
    destination: NativeGPUBuffer,
    destinationOffset: number,
    size: number,
  ): void;
  finish(descriptor?: { label?: string }): NativeGPUCommandBuffer;
}

export interface NativeGPUCommandBuffer {
  readonly label: string;
  readonly ops: ReadonlyArray<RecordedCommandOp>;
}

export interface NativeGPUQueue {
  writeBuffer(
    buffer: NativeGPUBuffer,
    bufferOffset: number,
    data: ArrayBuffer | ArrayBufferView,
    dataOffset?: number,
    size?: number,
  ): void;
  submit(commandBuffers: Iterable<NativeGPUCommandBuffer>): void;
  onSubmittedWorkDone(): Promise<void>;
}

export type NativeDawnDispatchFn = (
  wgslSource: string,
  entryPoint: string,
  inputData: Uint8Array,
  outputData: Uint8Array,
  workgroupsX: number,
) => number;

export interface NativeDawnGpuOptions {
  /** Extra Dawn toggles/flags passed to the optional `webgpu` Node package (`create(flags)`). */
  dawnFlags?: string[];
  /** Prefer the optional `webgpu` Node package over the embedded N-API dispatch bridge. */
  preferWebGpuPackage?: boolean;
}

interface DawnNativeAddonView extends ModelScriptNativeAddon {
  gpu?: NativeGPUProvider;
  dawnDispatchCompute?: NativeDawnDispatchFn;
}

interface OptionalWebGpuModule {
  create?: (flags?: string[]) => NativeGPUProvider;
  globals?: Record<string, unknown>;
}

type RecordedCommandOp =
  | {
      kind: "dispatch";
      pipeline: NativeGPUComputePipeline;
      bindGroup: NativeGPUBindGroup | null;
      workgroupsX: number;
    }
  | {
      kind: "copyBufferToBuffer";
      source: InternalBuffer;
      sourceOffset: number;
      destination: InternalBuffer;
      destinationOffset: number;
      size: number;
    };

const STANDARD_GPU_GLOBALS: Record<string, Record<string, number>> = {
  GPUBufferUsage: {
    MAP_READ: 0x0001,
    MAP_WRITE: 0x0002,
    COPY_SRC: 0x0004,
    COPY_DST: 0x0008,
    INDEX: 0x0010,
    VERTEX: 0x0020,
    UNIFORM: 0x0040,
    STORAGE: 0x0080,
    INDIRECT: 0x0100,
    QUERY_RESOLVE: 0x0200,
  },
  GPUMapMode: {
    READ: 0x0001,
    WRITE: 0x0002,
  },
  GPUShaderStage: {
    VERTEX: 0x1,
    FRAGMENT: 0x2,
    COMPUTE: 0x4,
  },
  GPUTextureUsage: {
    COPY_SRC: 0x01,
    COPY_DST: 0x02,
    TEXTURE_BINDING: 0x04,
    STORAGE_BINDING: 0x08,
    RENDER_ATTACHMENT: 0x10,
  },
  GPUColorWrite: {
    RED: 0x1,
    GREEN: 0x2,
    BLUE: 0x4,
    ALPHA: 0x8,
    ALL: 0xf,
  },
};

function ensureWebGpuGlobals(extra?: Record<string, unknown>): void {
  const g = globalThis as Record<string, unknown>;
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (g[k] === undefined) {
        g[k] = v;
      }
    }
  }
  for (const [k, v] of Object.entries(STANDARD_GPU_GLOBALS)) {
    if (g[k] === undefined) {
      g[k] = v;
    }
  }
}

class InternalBuffer implements NativeGPUBuffer {
  readonly label: string;
  readonly size: number;
  readonly usage: number;
  mapState: "unmapped" | "pending" | "mapped" = "unmapped";
  readonly storage: Uint8Array<ArrayBuffer>;

  constructor(descriptor: { label?: string; size: number; usage: number; mappedAtCreation?: boolean }) {
    this.label = descriptor.label ?? "";
    this.size = Math.max(0, descriptor.size);
    this.usage = descriptor.usage;
    this.storage = new Uint8Array(new ArrayBuffer(this.size));
    if (descriptor.mappedAtCreation) {
      this.mapState = "mapped";
    }
  }

  async mapAsync(_mode: number, _offset?: number, _size?: number): Promise<void> {
    this.mapState = "mapped";
  }

  getMappedRange(offset = 0, size?: number): ArrayBuffer {
    const end = size !== undefined ? offset + size : this.size;
    return this.storage.buffer.slice(offset, end);
  }

  unmap(): void {
    this.mapState = "unmapped";
  }

  destroy(): void {
    this.mapState = "unmapped";
  }
}

function createNapiDawnProvider(caps: NativeGpuCapabilities, dispatchCompute: NativeDawnDispatchFn): NativeGPUProvider {
  const limits: Record<string, number> = {
    maxStorageBufferBindingSize: 128 * 1024 * 1024,
    maxBufferSize: 256 * 1024 * 1024,
    maxComputeWorkgroupsPerDimension: 65535,
    maxComputeInvocationsPerWorkgroup: 256,
  };

  const createDevice = (): NativeGPUDevice => {
    const queue: NativeGPUQueue = {
      writeBuffer(buffer, bufferOffset, data, dataOffset = 0, size) {
        const internal = buffer as InternalBuffer;
        const src =
          data instanceof ArrayBuffer
            ? new Uint8Array(data, dataOffset, size)
            : new Uint8Array(
                data.buffer,
                data.byteOffset + dataOffset,
                size !== undefined ? size : data.byteLength - dataOffset,
              );
        internal.storage.set(src, bufferOffset);
      },

      submit(commandBuffers) {
        for (const cmd of commandBuffers) {
          for (const op of cmd.ops) {
            if (op.kind === "dispatch") {
              const entries = op.bindGroup?.entries ?? [];
              const inEntry = entries.find((e) => e.binding === 0);
              const outEntry = entries.find((e) => e.binding === 1);
              const inBytes = inEntry ? (inEntry.buffer as InternalBuffer).storage : new Uint8Array(0);
              const outBytes = outEntry ? (outEntry.buffer as InternalBuffer).storage : new Uint8Array(0);
              const rc = dispatchCompute(
                op.pipeline.module.code,
                op.pipeline.entryPoint,
                inBytes,
                outBytes,
                op.workgroupsX,
              );
              if (rc !== 0) {
                throw new Error(`[native-dawn] ms_gpu_dawn_dispatch_compute failed with code ${rc}`);
              }
            } else if (op.kind === "copyBufferToBuffer") {
              const slice = op.source.storage.subarray(op.sourceOffset, op.sourceOffset + op.size);
              op.destination.storage.set(slice, op.destinationOffset);
            }
          }
        }
      },

      async onSubmittedWorkDone() {
        // Dispatch is synchronous inside submit()
      },
    };

    const lostPromise = new Promise<{ reason: string; message: string }>(() => {
      // Resolves only if device is explicitly destroyed
    });

    return {
      features: new Set<string>(),
      limits,
      queue,
      lost: lostPromise,
      createShaderModule(descriptor) {
        return { label: descriptor.label ?? "", code: descriptor.code };
      },
      createComputePipeline(descriptor) {
        return {
          label: descriptor.label ?? "",
          module: descriptor.compute.module,
          entryPoint: descriptor.compute.entryPoint ?? "main",
          getBindGroupLayout(index: number) {
            return { index };
          },
        };
      },
      createBuffer(descriptor) {
        return new InternalBuffer(descriptor);
      },
      createBindGroup(descriptor) {
        return {
          label: descriptor.label ?? "",
          entries: descriptor.entries.map((e) => ({
            binding: e.binding,
            buffer: e.resource.buffer,
            offset: e.resource.offset ?? 0,
            size: e.resource.size ?? e.resource.buffer.size,
          })),
        };
      },
      createCommandEncoder() {
        const ops: RecordedCommandOp[] = [];
        return {
          beginComputePass() {
            let activePipeline: NativeGPUComputePipeline | null = null;
            let activeBindGroup: NativeGPUBindGroup | null = null;
            return {
              setPipeline(pipeline) {
                activePipeline = pipeline;
              },
              setBindGroup(_index, bindGroup) {
                activeBindGroup = bindGroup;
              },
              dispatchWorkgroups(workgroupCountX) {
                if (!activePipeline) {
                  throw new Error("[native-dawn] dispatchWorkgroups called before setPipeline");
                }
                ops.push({
                  kind: "dispatch",
                  pipeline: activePipeline,
                  bindGroup: activeBindGroup,
                  workgroupsX: workgroupCountX,
                });
              },
              end() {
                // Commands already recorded
              },
            };
          },
          copyBufferToBuffer(source, sourceOffset, destination, destinationOffset, size) {
            ops.push({
              kind: "copyBufferToBuffer",
              source: source as InternalBuffer,
              sourceOffset,
              destination: destination as InternalBuffer,
              destinationOffset,
              size,
            });
          },
          finish(descriptor) {
            return { label: descriptor?.label ?? "", ops };
          },
        };
      },
      destroy() {
        // No persistent handles held across dispatches
      },
    };
  };

  const adapter: NativeGPUAdapter = {
    features: new Set<string>(),
    limits,
    info: {
      vendor: caps.backendName || "dawn",
      architecture: `${process.platform}-${process.arch}`,
      device: caps.adapterName || "Dawn Native WebGPU",
      description: `${caps.backendName || "dawn-webgpu"}: ${caps.adapterName || "Dawn Native WebGPU"}`,
    },
    isFallbackAdapter: false,
    async requestDevice() {
      return createDevice();
    },
  };

  return {
    __brand: "GPU",
    wgslLanguageFeatures: new Set<string>(),
    getPreferredCanvasFormat() {
      return "bgra8unorm";
    },
    async requestAdapter() {
      return adapter;
    },
  };
}

function tryCreateFromOptionalWebGpuPackage(dawnFlags?: string[]): NativeGPUProvider | null {
  try {
    const req = createRequire(import.meta.url);
    const mod = req("webgpu") as OptionalWebGpuModule | undefined;
    if (mod && typeof mod.create === "function") {
      ensureWebGpuGlobals(mod.globals);
      return mod.create(dawnFlags ?? []);
    }
  } catch {
    // Optional `webgpu` Node package is not installed — fall through cleanly
  }
  return null;
}

function tryCreateFromNativeAddon(): NativeGPUProvider | null {
  const addon = loadNativeAddon() as DawnNativeAddonView | null;
  if (!addon) return null;

  if (addon.gpu && typeof addon.gpu.requestAdapter === "function") {
    ensureWebGpuGlobals();
    return addon.gpu;
  }

  const caps = addon.getGpuCapabilities();
  if (caps.dawnAvailable && typeof addon.dawnDispatchCompute === "function") {
    ensureWebGpuGlobals();
    return createNapiDawnProvider(caps, addon.dawnDispatchCompute);
  }

  return null;
}

/**
 * Creates a `@webgpu/types`-compatible `GPU` provider backed by Dawn WebGPU
 * (via `@modelscript/native` N-API bindings or the optional `webgpu` Node package).
 *
 * Returns `null` cleanly if native Dawn WebGPU is unavailable or disabled.
 */
export function createNativeDawnGpuProvider(options?: NativeDawnGpuOptions): NativeGPUProvider | null {
  if (process.env["MODELSCRIPT_BACKEND"] === "wasm" || process.env["MODELSCRIPT_DISABLE_NATIVE_GPU"] === "1") {
    return null;
  }

  if (options?.preferWebGpuPackage) {
    return tryCreateFromOptionalWebGpuPackage(options.dawnFlags) ?? tryCreateFromNativeAddon();
  }

  return tryCreateFromNativeAddon() ?? tryCreateFromOptionalWebGpuPackage(options?.dawnFlags);
}

/**
 * Registers the native Dawn WebGPU provider on `globalThis.__modelscript_native_gpu__`
 * so `WebGPUSimulationRunner` and GPU solvers can discover it automatically.
 *
 * Returns the registered `GPU` provider, or `null` if unavailable.
 */
export function registerNativeDawnGpu(options?: NativeDawnGpuOptions): NativeGPUProvider | null {
  const g = globalThis as { __modelscript_native_gpu__?: NativeGPUProvider };
  if (g.__modelscript_native_gpu__) {
    return g.__modelscript_native_gpu__;
  }

  const provider = createNativeDawnGpuProvider(options);
  if (provider) {
    g.__modelscript_native_gpu__ = provider;
  }
  return provider;
}
