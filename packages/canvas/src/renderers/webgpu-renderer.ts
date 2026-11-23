// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CameraController, ViewportSize } from "../core/camera.js";
import type { SoaSceneGraph } from "../engine/soa-scene.js";

/**
 * Optional WebGPU Instanced Schematic Renderer (Stage-2 High-Scale Backend).
 *
 * Designed for 50,000-500,000+ node schematics (e.g. continental PSS/E / CGMES
 * transmission grids or giant SysML v2 hierarchies) at 60-120 FPS by uploading
 * packed `Float32Array` instance buffers directly from `SoaSceneGraph` to WGSL
 * instanced shaders with zero per-node CPU draw calls.
 *
 * Automatically reports availability via `isWebGpuAvailable()` so callers fall
 * back seamlessly to the high-DPI Canvas2D backend when WebGPU is unavailable.
 */

export const SCHEMATIC_NODE_WGSL = /* wgsl */ `
struct CameraUniforms {
  viewport: vec2<f32>,
  pan: vec2<f32>,
  zoom: f32,
  _pad: f32,
};

@group(0) @binding(0) var<uniform> cam: CameraUniforms;

struct VertexOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) localUV: vec2<f32>,
  @location(1) color: vec4<f32>,
};

@vertex
fn vs_main(
  @builtin(vertex_index) vid: u32,
  @location(0) rect: vec4<f32>,
  @location(1) color: vec4<f32>,
) -> VertexOut {
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0)
  );
  let uv = corners[vid];
  let world = rect.xy + uv * rect.zw;
  let screen = world * cam.zoom + cam.pan;
  let ndc = vec2<f32>(
    (screen.x / max(1.0, cam.viewport.x)) * 2.0 - 1.0,
    1.0 - (screen.y / max(1.0, cam.viewport.y)) * 2.0
  );
  var out: VertexOut;
  out.pos = vec4<f32>(ndc, 0.0, 1.0);
  out.localUV = uv;
  out.color = color;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let edge = min(min(in.localUV.x, 1.0 - in.localUV.x), min(in.localUV.y, 1.0 - in.localUV.y));
  if (edge < 0.04) {
    return vec4<f32>(0.22, 0.74, 0.97, 1.0);
  }
  return in.color;
}
`;

export const SCHEMATIC_WIRE_WGSL = /* wgsl */ `
struct CameraUniforms {
  viewport: vec2<f32>,
  pan: vec2<f32>,
  zoom: f32,
  _pad: f32,
};

@group(0) @binding(0) var<uniform> cam: CameraUniforms;

struct WireVertexOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) t: f32,
};

@vertex
fn vs_main(
  @builtin(vertex_index) vid: u32,
  @location(0) segment: vec4<f32>,
) -> WireVertexOut {
  let world = select(segment.xy, segment.zw, vid == 1u);
  let screen = world * cam.zoom + cam.pan;
  let ndc = vec2<f32>(
    (screen.x / max(1.0, cam.viewport.x)) * 2.0 - 1.0,
    1.0 - (screen.y / max(1.0, cam.viewport.y)) * 2.0
  );
  var out: WireVertexOut;
  out.pos = vec4<f32>(ndc, 0.0, 1.0);
  out.t = f32(vid);
  return out;
}

@fragment
fn fs_main(in: WireVertexOut) -> @location(0) vec4<f32> {
  let glow = 0.85 + 0.15 * in.t;
  return vec4<f32>(0.22 * glow, 0.74 * glow, 0.97 * glow, 0.92);
}
`;

export interface PackedGpuInstanceBatch {
  /** Packed [x, y, width, height, r, g, b, a] per visible node instance (stride 8 floats). */
  instanceData: Float32Array;
  instanceCount: number;
  /** Packed [x1, y1, x2, y2] per visible wire segment (stride 4 floats). */
  wireSegments: Float32Array;
  wireSegmentCount: number;
}

export interface GpuBufferLike {
  readonly size?: number | undefined;
  destroy(): void;
}

export interface GpuShaderModuleLike {
  readonly label?: string | undefined;
}

export interface GpuBindGroupLayoutLike {
  readonly label?: string | undefined;
}

export interface GpuBindGroupLike {
  readonly label?: string | undefined;
}

export interface GpuRenderPipelineLike {
  getBindGroupLayout?(index: number): GpuBindGroupLayoutLike;
}

export interface GpuTextureViewLike {
  readonly label?: string | undefined;
}

export interface GpuTextureLike {
  createView(): GpuTextureViewLike;
}

export interface GpuRenderPassEncoderLike {
  setPipeline(pipeline: GpuRenderPipelineLike): void;
  setBindGroup(index: number, bindGroup: GpuBindGroupLike): void;
  setVertexBuffer(slot: number, buffer: GpuBufferLike, offset?: number, size?: number): void;
  draw(vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number): void;
  end(): void;
}

export interface GpuCommandBufferLike {
  readonly label?: string | undefined;
}

export interface GpuCommandEncoderLike {
  beginRenderPass(descriptor: Record<string, unknown>): GpuRenderPassEncoderLike;
  finish(): GpuCommandBufferLike;
}

export interface GpuQueueLike {
  writeBuffer(
    buffer: GpuBufferLike,
    bufferOffset: number,
    data: ArrayBufferView | ArrayBuffer,
    dataOffset?: number,
    size?: number,
  ): void;
  submit(commandBuffers: GpuCommandBufferLike[]): void;
}

export interface GpuDeviceLike {
  readonly queue: GpuQueueLike;
  createShaderModule(descriptor: { label?: string; code: string }): GpuShaderModuleLike;
  createRenderPipeline(descriptor: Record<string, unknown>): GpuRenderPipelineLike;
  createBuffer(descriptor: { label?: string; size: number; usage: number }): GpuBufferLike;
  createBindGroup(descriptor: Record<string, unknown>): GpuBindGroupLike;
  createBindGroupLayout?(descriptor: Record<string, unknown>): GpuBindGroupLayoutLike;
  createPipelineLayout?(descriptor: Record<string, unknown>): unknown;
  createCommandEncoder(descriptor?: { label?: string }): GpuCommandEncoderLike;
  destroy?(): void;
}

export interface GpuAdapterLike {
  requestDevice(): Promise<GpuDeviceLike | null>;
}

export interface WebGpuLike {
  requestAdapter(): Promise<GpuAdapterLike | null>;
  getPreferredCanvasFormat?(): string;
}

export interface GpuCanvasContextLike {
  configure(configuration: { device: GpuDeviceLike; format: string; alphaMode?: string }): void;
  getCurrentTexture(): GpuTextureLike;
  unconfigure?(): void;
}

export interface WebGpuCanvasLike {
  getContext(contextId: string): GpuCanvasContextLike | null;
  width?: number | undefined;
  height?: number | undefined;
}

export interface WebGpuRenderResult {
  rendered: boolean;
  backend: "webgpu" | "fallback";
  instanceCount: number;
  wireSegmentCount: number;
}

const GPU_BUFFER_USAGE = {
  COPY_DST: 0x0008,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
} as const;

const GPU_SHADER_STAGE_VERTEX = 0x0001;
const CAMERA_UNIFORM_BYTES = 32; // 8 x f32 (viewport.xy, pan.xy, zoom, _pad[3])

/** Returns true if the current browser runtime exposes WebGPU (`navigator.gpu`). */
export function isWebGpuAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "gpu" in navigator &&
    Boolean((navigator as unknown as { gpu?: { requestAdapter?: unknown } }).gpu?.requestAdapter)
  );
}

/**
 * Packs frustum-culled `SoaSceneGraph` nodes and edges into contiguous GPU instance
 * buffers suitable for single-call `pass.draw(6, instanceCount)` WebGPU submission.
 */
export function packSceneForWebGpu(
  scene: SoaSceneGraph,
  camera: CameraController,
  viewport: ViewportSize,
): PackedGpuInstanceBatch {
  const visibleWorld = camera.getVisibleWorldBounds(viewport, 96);
  const visibleNodes = scene.queryVisibleNodes(visibleWorld);
  const instanceData = new Float32Array(visibleNodes.length * 8);

  for (let i = 0; i < visibleNodes.length; i++) {
    const n = visibleNodes[i]!;
    const off = i * 8;
    instanceData[off] = n.x;
    instanceData[off + 1] = n.y;
    instanceData[off + 2] = n.width;
    instanceData[off + 3] = n.height;
    // Domain-neutral slate fill RGBA
    instanceData[off + 4] = 0.118;
    instanceData[off + 5] = 0.161;
    instanceData[off + 6] = 0.231;
    instanceData[off + 7] = n.opacity;
  }

  const edges = scene.getAllEdges();
  let segTotal = 0;
  for (const e of edges) {
    const mid = e.routePoints && e.routePoints.length > 0 ? e.routePoints : (e.vertices ?? []);
    segTotal += mid.length + 1;
  }
  const wireSegments = new Float32Array(segTotal * 4);
  let wIdx = 0;
  for (const e of edges) {
    const { source, target } = scene.resolveEdgeEndpoints(e);
    const mid = e.routePoints && e.routePoints.length > 0 ? e.routePoints : (e.vertices ?? []);
    const pts = [source, ...mid, target];
    for (let j = 0; j < pts.length - 1; j++) {
      const a = pts[j]!;
      const b = pts[j + 1]!;
      const off = wIdx * 4;
      wireSegments[off] = a.x;
      wireSegments[off + 1] = a.y;
      wireSegments[off + 2] = b.x;
      wireSegments[off + 3] = b.y;
      wIdx++;
    }
  }

  return {
    instanceData,
    instanceCount: visibleNodes.length,
    wireSegments,
    wireSegmentCount: wIdx,
  };
}

function alignUp4(bytes: number): number {
  return (Math.max(4, Math.ceil(bytes)) + 3) & ~3;
}

/**
 * WebGPU Instanced Schematic Renderer with automatic Canvas2D fallback signal.
 */
export class WebGpuSchematicRenderer {
  public readonly wgslSource = SCHEMATIC_NODE_WGSL;
  public readonly wireWgslSource = SCHEMATIC_WIRE_WGSL;
  private initialized = false;
  private device: GpuDeviceLike | null = null;
  private context: GpuCanvasContextLike | null = null;
  private nodePipeline: GpuRenderPipelineLike | null = null;
  private wirePipeline: GpuRenderPipelineLike | null = null;
  private uniformBuffer: GpuBufferLike | null = null;
  private nodeBindGroup: GpuBindGroupLike | null = null;
  private wireBindGroup: GpuBindGroupLike | null = null;
  private instanceBuffer: GpuBufferLike | null = null;
  private instanceBufferBytes = 0;
  private wireBuffer: GpuBufferLike | null = null;
  private wireBufferBytes = 0;
  private readonly uniformScratch = new Float32Array(8);

  public async initialize(
    canvas?: HTMLCanvasElement | WebGpuCanvasLike | null,
    gpuOverride?: WebGpuLike | null,
  ): Promise<boolean> {
    if (this.initialized) {
      this.dispose();
    }

    const gpu: WebGpuLike | null =
      gpuOverride ?? (isWebGpuAvailable() ? (navigator as unknown as { gpu: WebGpuLike }).gpu : null);

    if (!canvas || !gpu) {
      this.initialized = false;
      return false;
    }

    try {
      const adapter = await gpu.requestAdapter();
      if (!adapter) {
        this.initialized = false;
        return false;
      }

      const device = await adapter.requestDevice();
      if (!device) {
        this.initialized = false;
        return false;
      }

      const rawContext = (canvas as WebGpuCanvasLike).getContext("webgpu");
      if (
        !rawContext ||
        typeof rawContext.configure !== "function" ||
        typeof rawContext.getCurrentTexture !== "function"
      ) {
        this.initialized = false;
        return false;
      }

      const format = gpu.getPreferredCanvasFormat?.() ?? "bgra8unorm";
      rawContext.configure({
        device,
        format,
        alphaMode: "premultiplied",
      });

      const nodeModule = device.createShaderModule({
        label: "schematic-node-wgsl",
        code: SCHEMATIC_NODE_WGSL,
      });
      const wireModule = device.createShaderModule({
        label: "schematic-wire-wgsl",
        code: SCHEMATIC_WIRE_WGSL,
      });

      let sharedBindGroupLayout: GpuBindGroupLayoutLike | null = null;
      let pipelineLayout: unknown = "auto";
      if (typeof device.createBindGroupLayout === "function" && typeof device.createPipelineLayout === "function") {
        sharedBindGroupLayout = device.createBindGroupLayout({
          label: "schematic-camera-bgl",
          entries: [
            {
              binding: 0,
              visibility: GPU_SHADER_STAGE_VERTEX,
              buffer: { type: "uniform" },
            },
          ],
        });
        pipelineLayout = device.createPipelineLayout({
          label: "schematic-pipeline-layout",
          bindGroupLayouts: [sharedBindGroupLayout],
        });
      }

      const alphaBlend = {
        color: {
          srcFactor: "src-alpha",
          dstFactor: "one-minus-src-alpha",
          operation: "add",
        },
        alpha: {
          srcFactor: "one",
          dstFactor: "one-minus-src-alpha",
          operation: "add",
        },
      };

      const nodePipeline = device.createRenderPipeline({
        label: "schematic-node-pipeline",
        layout: pipelineLayout,
        vertex: {
          module: nodeModule,
          entryPoint: "vs_main",
          buffers: [
            {
              arrayStride: 32,
              stepMode: "instance",
              attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x4" },
                { shaderLocation: 1, offset: 16, format: "float32x4" },
              ],
            },
          ],
        },
        fragment: {
          module: nodeModule,
          entryPoint: "fs_main",
          targets: [{ format, blend: alphaBlend }],
        },
        primitive: {
          topology: "triangle-list",
        },
      });

      const wirePipeline = device.createRenderPipeline({
        label: "schematic-wire-pipeline",
        layout: pipelineLayout,
        vertex: {
          module: wireModule,
          entryPoint: "vs_main",
          buffers: [
            {
              arrayStride: 16,
              stepMode: "instance",
              attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }],
            },
          ],
        },
        fragment: {
          module: wireModule,
          entryPoint: "fs_main",
          targets: [{ format, blend: alphaBlend }],
        },
        primitive: {
          topology: "line-list",
        },
      });

      const uniformBuffer = device.createBuffer({
        label: "schematic-camera-uniforms",
        size: CAMERA_UNIFORM_BYTES,
        usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
      });

      let nodeBindGroup: GpuBindGroupLike;
      let wireBindGroup: GpuBindGroupLike;
      if (sharedBindGroupLayout) {
        nodeBindGroup = device.createBindGroup({
          label: "schematic-camera-bg",
          layout: sharedBindGroupLayout,
          entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
        });
        wireBindGroup = nodeBindGroup;
      } else {
        const nodeLayout = nodePipeline.getBindGroupLayout?.(0) ?? {};
        nodeBindGroup = device.createBindGroup({
          label: "schematic-node-camera-bg",
          layout: nodeLayout,
          entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
        });
        if (typeof wirePipeline.getBindGroupLayout === "function") {
          wireBindGroup = device.createBindGroup({
            label: "schematic-wire-camera-bg",
            layout: wirePipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
          });
        } else {
          wireBindGroup = nodeBindGroup;
        }
      }

      this.device = device;
      this.context = rawContext;
      this.nodePipeline = nodePipeline;
      this.wirePipeline = wirePipeline;
      this.uniformBuffer = uniformBuffer;
      this.nodeBindGroup = nodeBindGroup;
      this.wireBindGroup = wireBindGroup;
      this.initialized = true;
      return true;
    } catch {
      this.dispose();
      return false;
    }
  }

  public isReady(): boolean {
    return this.initialized;
  }

  /** Prepares GPU instance buffers directly from `SoaSceneGraph` (zero per-node JS allocations). */
  public prepareFrame(scene: SoaSceneGraph, camera: CameraController, viewport: ViewportSize): PackedGpuInstanceBatch {
    return packSceneForWebGpu(scene, camera, viewport);
  }

  /**
   * Executes a full WebGPU instanced render pass for nodes and wire segments.
   * Returns `{ rendered: false, backend: "fallback", ... }` when WebGPU is not initialized.
   */
  public renderFrame(scene: SoaSceneGraph, camera: CameraController, viewport: ViewportSize): WebGpuRenderResult {
    const batch = packSceneForWebGpu(scene, camera, viewport);
    if (
      !this.initialized ||
      !this.device ||
      !this.context ||
      !this.nodePipeline ||
      !this.wirePipeline ||
      !this.uniformBuffer ||
      !this.nodeBindGroup ||
      !this.wireBindGroup
    ) {
      return {
        rendered: false,
        backend: "fallback",
        instanceCount: batch.instanceCount,
        wireSegmentCount: batch.wireSegmentCount,
      };
    }

    try {
      const camState = camera.getState();
      this.uniformScratch[0] = Math.max(1, viewport.width);
      this.uniformScratch[1] = Math.max(1, viewport.height);
      this.uniformScratch[2] = camState.tx;
      this.uniformScratch[3] = camState.ty;
      this.uniformScratch[4] = camState.zoom;
      this.uniformScratch[5] = 0;
      this.uniformScratch[6] = 0;
      this.uniformScratch[7] = 0;
      this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformScratch);

      if (batch.instanceCount > 0) {
        const requiredBytes = alignUp4(batch.instanceData.byteLength);
        if (!this.instanceBuffer || this.instanceBufferBytes < requiredBytes) {
          this.instanceBuffer?.destroy();
          const nextCapacity = alignUp4(Math.max(requiredBytes, this.instanceBufferBytes * 2, 1024));
          this.instanceBuffer = this.device.createBuffer({
            label: "schematic-node-instances",
            size: nextCapacity,
            usage: GPU_BUFFER_USAGE.VERTEX | GPU_BUFFER_USAGE.COPY_DST,
          });
          this.instanceBufferBytes = nextCapacity;
        }
        this.device.queue.writeBuffer(this.instanceBuffer, 0, batch.instanceData);
      }

      if (batch.wireSegmentCount > 0) {
        const requiredBytes = alignUp4(batch.wireSegments.byteLength);
        if (!this.wireBuffer || this.wireBufferBytes < requiredBytes) {
          this.wireBuffer?.destroy();
          const nextCapacity = alignUp4(Math.max(requiredBytes, this.wireBufferBytes * 2, 512));
          this.wireBuffer = this.device.createBuffer({
            label: "schematic-wire-segments",
            size: nextCapacity,
            usage: GPU_BUFFER_USAGE.VERTEX | GPU_BUFFER_USAGE.COPY_DST,
          });
          this.wireBufferBytes = nextCapacity;
        }
        this.device.queue.writeBuffer(this.wireBuffer, 0, batch.wireSegments);
      }

      const encoder = this.device.createCommandEncoder({ label: "schematic-frame-encoder" });
      const view = this.context.getCurrentTexture().createView();
      const pass = encoder.beginRenderPass({
        label: "schematic-render-pass",
        colorAttachments: [
          {
            view,
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0.043, g: 0.071, b: 0.125, a: 1.0 },
          },
        ],
      });

      if (batch.wireSegmentCount > 0 && this.wireBuffer) {
        pass.setPipeline(this.wirePipeline);
        pass.setBindGroup(0, this.wireBindGroup);
        pass.setVertexBuffer(0, this.wireBuffer);
        pass.draw(2, batch.wireSegmentCount);
      }

      if (batch.instanceCount > 0 && this.instanceBuffer) {
        pass.setPipeline(this.nodePipeline);
        pass.setBindGroup(0, this.nodeBindGroup);
        pass.setVertexBuffer(0, this.instanceBuffer);
        pass.draw(6, batch.instanceCount);
      }

      pass.end();
      this.device.queue.submit([encoder.finish()]);

      return {
        rendered: true,
        backend: "webgpu",
        instanceCount: batch.instanceCount,
        wireSegmentCount: batch.wireSegmentCount,
      };
    } catch {
      return {
        rendered: false,
        backend: "fallback",
        instanceCount: batch.instanceCount,
        wireSegmentCount: batch.wireSegmentCount,
      };
    }
  }

  /** Destroys all owned GPU buffers and resets renderer state cleanly. */
  public dispose(): void {
    this.uniformBuffer?.destroy();
    this.instanceBuffer?.destroy();
    this.wireBuffer?.destroy();
    this.context?.unconfigure?.();
    this.uniformBuffer = null;
    this.instanceBuffer = null;
    this.instanceBufferBytes = 0;
    this.wireBuffer = null;
    this.wireBufferBytes = 0;
    this.nodeBindGroup = null;
    this.wireBindGroup = null;
    this.nodePipeline = null;
    this.wirePipeline = null;
    this.context = null;
    this.device = null;
    this.initialized = false;
  }
}
