// SPDX-License-Identifier: AGPL-3.0-or-later

export type BackendKind = "cuda-fp64" | "hip-fp64" | "dawn-webgpu" | "browser-webgpu" | "cpu-aot";

export interface ComputeBackendInfo {
  readonly kind: BackendKind;
  readonly hardwareFp64: boolean;
  readonly adapterName: string;
  readonly isGpu: boolean;
}

export interface NativeGpuBridge {
  readonly backend?: "cuda-fp64" | "hip-fp64" | "dawn-webgpu";
  readonly cudaAvailable?: boolean;
  readonly hipAvailable?: boolean;
  readonly dawnAvailable?: boolean;
  readonly hardwareFp64?: boolean;
  readonly adapterName?: string;
  createBuffer?(byteLength: number, label?: string): number | string;
  upload?(handle: number | string, data: Uint8Array, byteOffset: number): void | Promise<void>;
  download?(handle: number | string, byteOffset: number, byteLength: number): Uint8Array | Promise<Uint8Array>;
  sync?(): void | Promise<void>;
  destroyBuffer?(handle: number | string): void;
  compileKernel?(name: string, source: string): Promise<void> | void;
  launchKernel?(
    name: string,
    grid: [number, number, number],
    block: [number, number, number],
    bufferHandles: unknown[],
  ): Promise<void> | void;
}

export interface PersistentComputeBuffer {
  readonly id: string;
  readonly byteLength: number;
  readonly backend: BackendKind;
  readonly label?: string;
  readonly destroyed: boolean;
  upload(data: ArrayBufferView | ArrayBuffer, byteOffset?: number): Promise<void>;
  download(byteOffset?: number, byteLength?: number): Promise<Uint8Array>;
  downloadFloat64(byteOffset?: number, count?: number): Promise<Float64Array>;
  destroy(): void;
}

export interface DetectBackendOptions {
  /** Optional override to prefer a specific backend when available. */
  preferredBackend?: BackendKind;
}

interface WebGpuAdapterLike {
  readonly name?: string;
  readonly info?: {
    readonly device?: string;
    readonly description?: string;
    readonly vendor?: string;
  };
  readonly features?: { has(feature: string): boolean };
}

interface NavigatorGpuLike {
  requestAdapter(options?: { powerPreference?: string }): Promise<WebGpuAdapterLike | null>;
}

interface GlobalWithComputeBridges {
  __modelscript_native_gpu__?: NativeGpuBridge;
  navigator?: { gpu?: NavigatorGpuLike };
}

function toUint8View(data: ArrayBufferView | ArrayBuffer): Uint8Array {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function resolveNativeBackendKind(bridge: NativeGpuBridge): BackendKind | null {
  if (bridge.backend === "cuda-fp64" || bridge.backend === "hip-fp64" || bridge.backend === "dawn-webgpu") {
    return bridge.backend;
  }
  if (bridge.cudaAvailable) return "cuda-fp64";
  if (bridge.hipAvailable) return "hip-fp64";
  if (bridge.dawnAvailable) return "dawn-webgpu";
  return null;
}

class HostPersistentBuffer implements PersistentComputeBuffer {
  readonly id: string;
  readonly byteLength: number;
  readonly backend: BackendKind;
  readonly label?: string;

  private storage: Uint8Array | null;
  private isDestroyed = false;

  constructor(id: string, byteLength: number, backend: BackendKind, label?: string) {
    this.id = id;
    this.byteLength = byteLength;
    this.backend = backend;
    if (label !== undefined) this.label = label;
    this.storage = new Uint8Array(byteLength);
  }

  get destroyed(): boolean {
    return this.isDestroyed;
  }

  private assertAlive(): Uint8Array {
    if (this.isDestroyed || this.storage === null) {
      throw new Error(`PersistentComputeBuffer '${this.id}' has been destroyed.`);
    }
    return this.storage;
  }

  async upload(data: ArrayBufferView | ArrayBuffer, byteOffset = 0): Promise<void> {
    const buf = this.assertAlive();
    const src = toUint8View(data);
    if (!Number.isInteger(byteOffset) || byteOffset < 0 || byteOffset + src.byteLength > this.byteLength) {
      throw new RangeError(
        `Upload range [${byteOffset}, ${byteOffset + src.byteLength}) exceeds buffer byteLength ${this.byteLength}.`,
      );
    }
    buf.set(src, byteOffset);
  }

  async download(byteOffset = 0, byteLength = this.byteLength - byteOffset): Promise<Uint8Array> {
    const buf = this.assertAlive();
    if (
      !Number.isInteger(byteOffset) ||
      !Number.isInteger(byteLength) ||
      byteOffset < 0 ||
      byteLength < 0 ||
      byteOffset + byteLength > this.byteLength
    ) {
      throw new RangeError(
        `Download range [${byteOffset}, ${byteOffset + byteLength}) exceeds buffer byteLength ${this.byteLength}.`,
      );
    }
    return buf.slice(byteOffset, byteOffset + byteLength);
  }

  async downloadFloat64(
    byteOffset = 0,
    count = Math.floor((this.byteLength - byteOffset) / Float64Array.BYTES_PER_ELEMENT),
  ): Promise<Float64Array> {
    const byteLength = count * Float64Array.BYTES_PER_ELEMENT;
    const bytes = await this.download(byteOffset, byteLength);
    return new Float64Array(bytes.buffer, bytes.byteOffset, count);
  }

  destroy(): void {
    this.storage = null;
    this.isDestroyed = true;
  }
}

class NativeBridgePersistentBuffer implements PersistentComputeBuffer {
  readonly id: string;
  readonly byteLength: number;
  readonly backend: BackendKind;
  readonly label?: string;

  private readonly bridge: Required<Pick<NativeGpuBridge, "createBuffer" | "upload" | "download">> & NativeGpuBridge;
  private readonly nativeHandle: number | string;
  private isDestroyed = false;

  constructor(
    id: string,
    byteLength: number,
    backend: BackendKind,
    bridge: Required<Pick<NativeGpuBridge, "createBuffer" | "upload" | "download">> & NativeGpuBridge,
    label?: string,
  ) {
    this.id = id;
    this.byteLength = byteLength;
    this.backend = backend;
    if (label !== undefined) this.label = label;
    this.bridge = bridge;
    this.nativeHandle = bridge.createBuffer(byteLength, label);
  }

  get destroyed(): boolean {
    return this.isDestroyed;
  }

  private assertAlive(): void {
    if (this.isDestroyed) {
      throw new Error(`PersistentComputeBuffer '${this.id}' has been destroyed.`);
    }
  }

  async upload(data: ArrayBufferView | ArrayBuffer, byteOffset = 0): Promise<void> {
    this.assertAlive();
    const src = toUint8View(data);
    if (!Number.isInteger(byteOffset) || byteOffset < 0 || byteOffset + src.byteLength > this.byteLength) {
      throw new RangeError(
        `Upload range [${byteOffset}, ${byteOffset + src.byteLength}) exceeds buffer byteLength ${this.byteLength}.`,
      );
    }
    await this.bridge.upload(this.nativeHandle, src, byteOffset);
  }

  async download(byteOffset = 0, byteLength = this.byteLength - byteOffset): Promise<Uint8Array> {
    this.assertAlive();
    if (
      !Number.isInteger(byteOffset) ||
      !Number.isInteger(byteLength) ||
      byteOffset < 0 ||
      byteLength < 0 ||
      byteOffset + byteLength > this.byteLength
    ) {
      throw new RangeError(
        `Download range [${byteOffset}, ${byteOffset + byteLength}) exceeds buffer byteLength ${this.byteLength}.`,
      );
    }
    const raw = await this.bridge.download(this.nativeHandle, byteOffset, byteLength);
    return raw.slice();
  }

  async downloadFloat64(
    byteOffset = 0,
    count = Math.floor((this.byteLength - byteOffset) / Float64Array.BYTES_PER_ELEMENT),
  ): Promise<Float64Array> {
    const byteLength = count * Float64Array.BYTES_PER_ELEMENT;
    const bytes = await this.download(byteOffset, byteLength);
    return new Float64Array(bytes.buffer, bytes.byteOffset, count);
  }

  getNativeHandle(): number | string {
    this.assertAlive();
    return this.nativeHandle;
  }

  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.bridge.destroyBuffer?.(this.nativeHandle);
  }
}

function validateDim3(label: string, dims: [number, number, number]): void {
  if (!Array.isArray(dims) || dims.length !== 3) {
    throw new RangeError(`${label} dimensions must be a 3-element tuple [x, y, z].`);
  }
  for (let i = 0; i < 3; i++) {
    const d = dims[i];
    if (d === undefined || !Number.isInteger(d) || d <= 0) {
      throw new RangeError(`${label} dimension[${i}] must be a positive integer, got ${d}.`);
    }
  }
}

export class SolverComputeBackend {
  readonly info: ComputeBackendInfo;
  private readonly nativeBridge?: NativeGpuBridge;
  private readonly buffers = new Set<PersistentComputeBuffer>();
  private readonly compiledKernels = new Set<string>();
  private nextBufferId = 1;

  constructor(info: ComputeBackendInfo, nativeBridge?: NativeGpuBridge) {
    this.info = info;
    if (nativeBridge !== undefined) this.nativeBridge = nativeBridge;
  }

  get kind(): BackendKind {
    return this.info.kind;
  }

  createPersistentBuffer(byteLength: number, label?: string): PersistentComputeBuffer {
    if (!Number.isInteger(byteLength) || byteLength <= 0) {
      throw new RangeError(`Persistent buffer byteLength must be a positive integer, got ${byteLength}.`);
    }
    const id = `${this.info.kind}:buf-${this.nextBufferId++}`;
    let buffer: PersistentComputeBuffer;
    if (
      this.nativeBridge &&
      typeof this.nativeBridge.createBuffer === "function" &&
      typeof this.nativeBridge.upload === "function" &&
      typeof this.nativeBridge.download === "function"
    ) {
      buffer = new NativeBridgePersistentBuffer(
        id,
        byteLength,
        this.info.kind,
        this.nativeBridge as Required<Pick<NativeGpuBridge, "createBuffer" | "upload" | "download">> & NativeGpuBridge,
        label,
      );
    } else {
      buffer = new HostPersistentBuffer(id, byteLength, this.info.kind, label);
    }
    this.buffers.add(buffer);
    return buffer;
  }

  async compileKernel(name: string, source: string): Promise<void> {
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new RangeError("Kernel name must be a non-empty string.");
    }
    if (typeof source !== "string" || source.trim().length === 0) {
      throw new RangeError(`Kernel '${name}' source code must be a non-empty string.`);
    }
    if (!this.nativeBridge || typeof this.nativeBridge.compileKernel !== "function") {
      throw new Error(
        `Kernel compilation is not supported on backend '${this.info.kind}' (no native compileKernel bridge).`,
      );
    }
    await this.nativeBridge.compileKernel(name, source);
    this.compiledKernels.add(name);
  }

  async launchKernel(
    name: string,
    grid: [number, number, number],
    block: [number, number, number],
    buffers: readonly PersistentComputeBuffer[],
  ): Promise<void> {
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new RangeError("Kernel name must be a non-empty string.");
    }
    if (!this.compiledKernels.has(name)) {
      throw new Error(`Kernel '${name}' has not been compiled on backend '${this.info.kind}'.`);
    }
    validateDim3("Grid", grid);
    validateDim3("Block", block);
    if (!Array.isArray(buffers)) {
      throw new RangeError("Kernel launch buffers must be an array.");
    }
    if (!this.nativeBridge || typeof this.nativeBridge.launchKernel !== "function") {
      throw new Error(`Kernel launch is not supported on backend '${this.info.kind}' (no native launchKernel bridge).`);
    }

    const bufferHandles: unknown[] = [];
    for (const buf of buffers) {
      if (!buf || buf.destroyed) {
        throw new Error(`Cannot launch kernel '${name}' with destroyed or invalid buffer '${buf?.id ?? "unknown"}'.`);
      }
      if (!this.buffers.has(buf)) {
        throw new Error(`Buffer '${buf.id}' does not belong to compute backend '${this.info.kind}'.`);
      }
      bufferHandles.push(buf instanceof NativeBridgePersistentBuffer ? buf.getNativeHandle() : buf.id);
    }

    await this.nativeBridge.launchKernel(name, grid, block, bufferHandles);
  }

  async sync(): Promise<void> {
    if (this.nativeBridge && typeof this.nativeBridge.sync === "function") {
      await this.nativeBridge.sync();
    }
  }

  dispose(): void {
    for (const buf of this.buffers) {
      buf.destroy();
    }
    this.buffers.clear();
    this.compiledKernels.clear();
  }

  static async detectBestComputeBackend(options: DetectBackendOptions = {}): Promise<SolverComputeBackend> {
    return detectBestComputeBackend(options);
  }
}

export async function detectBestComputeBackend(options: DetectBackendOptions = {}): Promise<SolverComputeBackend> {
  const g = globalThis as unknown as GlobalWithComputeBridges;

  if (options.preferredBackend === "cpu-aot") {
    return new SolverComputeBackend({
      kind: "cpu-aot",
      hardwareFp64: true,
      adapterName: "cpu-aot",
      isGpu: false,
    });
  }

  const nativeBridge = g.__modelscript_native_gpu__;
  if (nativeBridge && typeof nativeBridge === "object") {
    const nativeKind = resolveNativeBackendKind(nativeBridge);
    if (nativeKind && (!options.preferredBackend || options.preferredBackend === nativeKind)) {
      const hardwareFp64 = nativeBridge.hardwareFp64 ?? (nativeKind === "cuda-fp64" || nativeKind === "hip-fp64");
      return new SolverComputeBackend(
        {
          kind: nativeKind,
          hardwareFp64,
          adapterName: nativeBridge.adapterName ?? nativeKind,
          isGpu: true,
        },
        nativeBridge,
      );
    }
  }

  const navGpu = g.navigator?.gpu;
  if (
    navGpu &&
    typeof navGpu.requestAdapter === "function" &&
    (!options.preferredBackend || options.preferredBackend === "browser-webgpu")
  ) {
    try {
      const adapter = await navGpu.requestAdapter({ powerPreference: "high-performance" });
      if (adapter) {
        const adapterName = adapter.info?.description || adapter.info?.device || adapter.name || "browser-webgpu";
        const hasF64 = Boolean(adapter.features?.has("shader-f64"));
        return new SolverComputeBackend({
          kind: "browser-webgpu",
          hardwareFp64: hasF64,
          adapterName,
          isGpu: true,
        });
      }
    } catch {
      // Fall through cleanly to cpu-aot when WebGPU adapter probing fails.
    }
  }

  return new SolverComputeBackend({
    kind: "cpu-aot",
    hardwareFp64: true,
    adapterName: "cpu-aot",
    isGpu: false,
  });
}
