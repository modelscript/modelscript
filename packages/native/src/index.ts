// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Node.js loader for `@modelscript/native` (`modelscript_native.node`).
 *
 * Exposes platform-native `wasm2c`-compiled AssemblyScript kernels (`runtime` and `simulate`),
 * native Dawn WebGPU capabilities, and optional CUDA/HIP hardware FP64 support.
 *
 * Returns `null` gracefully when no native binary is present for the current platform/arch,
 * allowing callers (`wasm_loader.ts`, `simulate-wasm.ts`) to fall back to `.wasm`.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface NativeGpuCapabilities {
  dawnCompiled: boolean;
  dawnAvailable: boolean;
  cudaCompiled: boolean;
  cudaAvailable: boolean;
  hipCompiled: boolean;
  hipAvailable: boolean;
  hardwareFp64: boolean;
  sundialsCompiled: boolean;
  backendName: string;
  adapterName: string;
}

export interface NativeMemoryHandle {
  readonly buffer: ArrayBuffer;
}

export interface NativeKernelExports extends Record<string, unknown> {
  readonly memory: NativeMemoryHandle;
  __getMemoryBuffer?: () => ArrayBuffer;
}

export interface ModelScriptNativeAddon {
  readonly backend: "wasm2c-native";
  readonly addonPath: string;
  readonly runtime: NativeKernelExports;
  readonly simulate: NativeKernelExports;
  readonly sundialsAvailable: boolean;
  selftest(): number;
  getGpuCapabilities(): NativeGpuCapabilities;
  dispatchDawnCompute(
    wgslSource: string,
    entryPoint: string,
    inputBuf: ArrayBufferView | ArrayBuffer,
    outputBytes: number,
    workgroupsX: number,
  ): Uint8Array | null;
  executeFp64Batch(
    sourceCode: string,
    kernelName: string,
    states: Float64Array,
    nVars: number,
    nEqs: number,
    batchSize: number,
    simTime: number,
  ): Float64Array | null;
}

interface RawNativeAddon {
  backend: "wasm2c-native";
  runtime: Record<string, unknown> & { __getMemoryBuffer?: () => ArrayBuffer };
  simulate: Record<string, unknown> & { __getMemoryBuffer?: () => ArrayBuffer };
  sundialsAvailable?: boolean;
  selftest(): number;
  getGpuCapabilities(): NativeGpuCapabilities;
  dispatchDawnCompute?(
    wgslSource: string,
    entryPoint: string,
    inputBuf: ArrayBufferView | ArrayBuffer,
    outputBytes: number,
    workgroupsX: number,
  ): Uint8Array | null;
  executeFp64Batch?(
    sourceCode: string,
    kernelName: string,
    states: Float64Array,
    nVars: number,
    nEqs: number,
    batchSize: number,
    simTime: number,
  ): Float64Array | null;
}

let cachedAddon: ModelScriptNativeAddon | null | undefined;

function wrapKernelExports(
  raw: Record<string, unknown> & { __getMemoryBuffer?: () => ArrayBuffer },
): NativeKernelExports {
  const memory: NativeMemoryHandle = {
    get buffer(): ArrayBuffer {
      if (typeof raw.__getMemoryBuffer !== "function") {
        throw new Error("[native] Native kernel does not expose __getMemoryBuffer()");
      }
      return raw.__getMemoryBuffer();
    },
  };

  return Object.defineProperty(Object.assign({}, raw), "memory", {
    value: memory,
    enumerable: true,
    configurable: false,
  }) as NativeKernelExports;
}

function resolveNativeAddonCandidates(): string[] {
  const candidates: string[] = [];

  if (process.env["MODELSCRIPT_NATIVE_ADDON"]) {
    candidates.push(process.env["MODELSCRIPT_NATIVE_ADDON"]);
  }

  const platformKey = `${process.platform}-${process.arch}`;
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const pkgRoot = path.resolve(thisDir, "..");

  candidates.push(
    path.join(pkgRoot, "prebuilds", platformKey, "modelscript_native.node"),
    path.join(pkgRoot, "build", "modelscript_native.node"),
    path.join(pkgRoot, "build", "Release", "modelscript_native.node"),
    path.join(process.cwd(), "packages", "native", "prebuilds", platformKey, "modelscript_native.node"),
    path.join(process.cwd(), "packages", "native", "build", "modelscript_native.node"),
    path.join(process.cwd(), "native", "modelscript_native.node"),
  );

  return candidates;
}

/**
 * Loads the platform-native `modelscript_native.node` addon if present and enabled.
 * Set `MODELSCRIPT_BACKEND=wasm` to force WebAssembly even when native binaries exist.
 */
export function loadNativeAddon(): ModelScriptNativeAddon | null {
  if (process.env["MODELSCRIPT_BACKEND"] === "wasm") {
    return null;
  }
  if (cachedAddon !== undefined) {
    return cachedAddon;
  }

  const req = createRequire(import.meta.url);
  for (const cand of resolveNativeAddonCandidates()) {
    if (!fs.existsSync(cand)) continue;
    try {
      const raw = req(cand) as RawNativeAddon;
      cachedAddon = {
        backend: raw.backend,
        addonPath: cand,
        runtime: wrapKernelExports(raw.runtime),
        simulate: wrapKernelExports(raw.simulate),
        sundialsAvailable: Boolean(raw.sundialsAvailable),
        selftest: () => raw.selftest(),
        getGpuCapabilities: () => {
          const caps = raw.getGpuCapabilities();
          return {
            ...caps,
            sundialsCompiled: Boolean(caps.sundialsCompiled),
          };
        },
        dispatchDawnCompute: (wgslSource, entryPoint, inputBuf, outputBytes, workgroupsX) =>
          typeof raw.dispatchDawnCompute === "function"
            ? raw.dispatchDawnCompute(wgslSource, entryPoint, inputBuf, outputBytes, workgroupsX)
            : null,
        executeFp64Batch: (sourceCode, kernelName, states, nVars, nEqs, batchSize, simTime) =>
          typeof raw.executeFp64Batch === "function"
            ? raw.executeFp64Batch(sourceCode, kernelName, states, nVars, nEqs, batchSize, simTime)
            : null,
      };
      (globalThis as { __modelscript_native_addon__?: ModelScriptNativeAddon }).__modelscript_native_addon__ =
        cachedAddon;
      return cachedAddon;
    } catch {
      // Try next candidate or fall back to WASM
    }
  }

  cachedAddon = null;
  return null;
}

export function isNativeAvailable(): boolean {
  return loadNativeAddon() !== null;
}

export function getNativeRuntimeExports(): NativeKernelExports | null {
  return loadNativeAddon()?.runtime ?? null;
}

export function getNativeSimulateExports(): NativeKernelExports | null {
  return loadNativeAddon()?.simulate ?? null;
}

export function getNativeGpuCapabilities(): NativeGpuCapabilities | null {
  return loadNativeAddon()?.getGpuCapabilities() ?? null;
}

export function resetNativeAddonCache(): void {
  cachedAddon = undefined;
}

export {
  createNativeDawnGpuProvider,
  registerNativeDawnGpu,
  type NativeDawnDispatchFn,
  type NativeDawnGpuOptions,
  type NativeGPUAdapter,
  type NativeGPUAdapterInfo,
  type NativeGPUBindGroup,
  type NativeGPUBuffer,
  type NativeGPUCommandBuffer,
  type NativeGPUCommandEncoder,
  type NativeGPUComputePassEncoder,
  type NativeGPUComputePipeline,
  type NativeGPUDevice,
  type NativeGPUProvider,
  type NativeGPUQueue,
  type NativeGPUShaderModule,
} from "./dawn-gpu-bridge.js";
