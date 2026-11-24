// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Browser / VS Code for Web stub for `@modelscript/native`.
 *
 * Ensures web bundles (`apps/web`, `apps/docs`, `modelscript-web.vsix`) never
 * reference Node.js built-ins or native `.node` binaries and always run pure WASM.
 */

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

export function loadNativeAddon(): ModelScriptNativeAddon | null {
  return null;
}

export function isNativeAvailable(): boolean {
  return false;
}

export function getNativeRuntimeExports(): NativeKernelExports | null {
  return null;
}

export function getNativeSimulateExports(): NativeKernelExports | null {
  return null;
}

export function getNativeGpuCapabilities(): NativeGpuCapabilities | null {
  return null;
}

export function resetNativeAddonCache(): void {
  // No-op in browser environments
}

export interface NativeDawnGpuOptions {
  dawnFlags?: string[];
  preferWebGpuPackage?: boolean;
}

export interface NativeGPUProvider {
  readonly __brand: "GPU";
  requestAdapter(options?: {
    powerPreference?: "low-power" | "high-performance";
    forceFallbackAdapter?: boolean;
  }): Promise<unknown>;
  getPreferredCanvasFormat(): string;
  readonly wgslLanguageFeatures: ReadonlySet<string>;
}

export function createNativeDawnGpuProvider(_options?: NativeDawnGpuOptions): NativeGPUProvider | null {
  return null;
}

export function registerNativeDawnGpu(_options?: NativeDawnGpuOptions): NativeGPUProvider | null {
  return null;
}
