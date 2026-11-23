// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { CameraController } from "../src/core/camera.js";
import type { Canvas2DContextLike } from "../src/engine/glyph-compiler.js";
import { SoaSceneGraph } from "../src/engine/soa-scene.js";
import {
  SCHEMATIC_NODE_WGSL,
  SCHEMATIC_WIRE_WGSL,
  ScissorSnapshotBaker,
  WebGpuSchematicRenderer,
  type GpuBindGroupLike,
  type GpuBufferLike,
  type GpuCanvasContextLike,
  type GpuCommandBufferLike,
  type GpuDeviceLike,
  type GpuRenderPipelineLike,
  type SnapshotBitmapLike,
  type WebGpuCanvasLike,
  type WebGpuLike,
} from "../src/renderers/index.js";
import {
  computePlotBounds,
  hitTestScatterBrush,
  paintCanvasPlot,
  paintWidgetLeaderTether,
  type CanvasPlotSpec,
} from "../src/widgets/canvas-plot.js";
import { paintCanvasTable, paintStickyBadge } from "../src/widgets/canvas-table.js";

interface RecordedGpuBuffer extends GpuBufferLike {
  readonly id: number;
  readonly label: string;
  readonly size: number;
  readonly usage: number;
  destroyed: boolean;
}

interface RecordedDrawCall {
  pipelineLabel: string;
  bindGroupLabel: string;
  vertexBufferId: number | null;
  vertexCount: number;
  instanceCount: number | undefined;
}

interface RecordedWriteBuffer {
  bufferId: number;
  bufferLabel: string;
  offset: number;
  byteLength: number;
  snapshot: Float32Array;
}

function createMockWebGpuHarness() {
  let nextBufferId = 1;
  const shaderModules: Array<{ label: string; code: string }> = [];
  const pipelines: Array<{ label: string; topology: string; handle: GpuRenderPipelineLike }> = [];
  const buffers: RecordedGpuBuffer[] = [];
  const writeBuffers: RecordedWriteBuffer[] = [];
  const drawCalls: RecordedDrawCall[] = [];
  const submittedCommandBuffers: GpuCommandBufferLike[] = [];
  let configureCalls = 0;
  let unconfigureCalls = 0;
  let renderPassEnds = 0;
  let bindGroupCount = 0;

  const device: GpuDeviceLike = {
    queue: {
      writeBuffer(buffer, bufferOffset, data) {
        const rec = buffer as RecordedGpuBuffer;
        const view =
          data instanceof ArrayBuffer
            ? new Float32Array(data.slice(0))
            : new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
        writeBuffers.push({
          bufferId: rec.id,
          bufferLabel: rec.label,
          offset: bufferOffset,
          byteLength: view.byteLength,
          snapshot: view,
        });
      },
      submit(commandBuffers) {
        submittedCommandBuffers.push(...commandBuffers);
      },
    },
    createShaderModule(descriptor) {
      const label = descriptor.label ?? "unnamed-shader";
      shaderModules.push({ label, code: descriptor.code });
      return { label };
    },
    createBindGroupLayout(descriptor) {
      return { label: String(descriptor["label"] ?? "bgl") };
    },
    createPipelineLayout(descriptor) {
      return { label: String(descriptor["label"] ?? "pl") };
    },
    createRenderPipeline(descriptor) {
      const label = String(descriptor["label"] ?? `pipeline_${pipelines.length}`);
      const primitive = descriptor["primitive"] as { topology?: string } | undefined;
      const topology = primitive?.topology ?? "triangle-list";
      const handle: GpuRenderPipelineLike = {
        getBindGroupLayout: () => ({ label: `${label}:bgl0` }),
      };
      pipelines.push({ label, topology, handle });
      return handle;
    },
    createBuffer(descriptor) {
      const rec: RecordedGpuBuffer = {
        id: nextBufferId++,
        label: descriptor.label ?? "unnamed-buffer",
        size: descriptor.size,
        usage: descriptor.usage,
        destroyed: false,
        destroy() {
          rec.destroyed = true;
        },
      };
      buffers.push(rec);
      return rec;
    },
    createBindGroup(descriptor): GpuBindGroupLike {
      bindGroupCount++;
      return { label: String(descriptor["label"] ?? `bg_${bindGroupCount}`) };
    },
    createCommandEncoder(descriptor) {
      const encoderLabel = descriptor?.label ?? "cmd-encoder";
      return {
        beginRenderPass() {
          let activePipeline = "";
          let activeBindGroup = "";
          let activeVertexBufferId: number | null = null;
          return {
            setPipeline(pipeline) {
              const found = pipelines.find((p) => p.handle === pipeline);
              activePipeline = found?.label ?? "unknown";
            },
            setBindGroup(_index, bindGroup) {
              activeBindGroup = bindGroup.label ?? "unknown";
            },
            setVertexBuffer(_slot, buffer) {
              activeVertexBufferId = (buffer as RecordedGpuBuffer).id;
            },
            draw(vertexCount, instanceCount) {
              drawCalls.push({
                pipelineLabel: activePipeline,
                bindGroupLabel: activeBindGroup,
                vertexBufferId: activeVertexBufferId,
                vertexCount,
                instanceCount,
              });
            },
            end() {
              renderPassEnds++;
            },
          };
        },
        finish() {
          return { label: `${encoderLabel}:cmd` };
        },
      };
    },
  };

  const gpuContext: GpuCanvasContextLike = {
    configure() {
      configureCalls++;
    },
    getCurrentTexture() {
      return {
        createView: () => ({ label: "swapchain-view" }),
      };
    },
    unconfigure() {
      unconfigureCalls++;
    },
  };

  const canvas: WebGpuCanvasLike = {
    width: 1280,
    height: 800,
    getContext(contextId: string) {
      return contextId === "webgpu" ? gpuContext : null;
    },
  };

  const gpu: WebGpuLike = {
    async requestAdapter() {
      return {
        async requestDevice() {
          return device;
        },
      };
    },
    getPreferredCanvasFormat() {
      return "bgra8unorm";
    },
  };

  return {
    gpu,
    canvas,
    shaderModules,
    pipelines,
    buffers,
    writeBuffers,
    drawCalls,
    submittedCommandBuffers,
    getConfigureCalls: () => configureCalls,
    getUnconfigureCalls: () => unconfigureCalls,
    getRenderPassEnds: () => renderPassEnds,
  };
}

interface RecordedCanvas2D {
  ctx: Canvas2DContextLike & {
    drawImage?: (image: unknown, dx: number, dy: number, dw: number, dh: number) => void;
    quadraticCurveTo?: (cpx: number, cpy: number, x: number, y: number) => void;
    measureText?: (text: string) => { width: number };
  };
  texts: string[];
  fillStyles: string[];
  strokeStyles: string[];
  lineDashes: number[][];
  arcs: Array<{ x: number; y: number; r: number }>;
  quadraticCurves: number;
  lineTos: number;
  drawImageCalls: Array<{ image: unknown; dx: number; dy: number; dw: number; dh: number }>;
}

function createRecordingCanvas2D(
  options: {
    withDrawImage?: boolean;
    withQuadraticCurveTo?: boolean;
  } = {},
): RecordedCanvas2D {
  const texts: string[] = [];
  const fillStyles: string[] = [];
  const strokeStyles: string[] = [];
  const lineDashes: number[][] = [];
  const arcs: Array<{ x: number; y: number; r: number }> = [];
  const drawImageCalls: Array<{ image: unknown; dx: number; dy: number; dw: number; dh: number }> = [];
  let quadraticCurves = 0;
  let lineTos = 0;

  const ctx: RecordedCanvas2D["ctx"] = {
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    globalAlpha: 1,
    font: "12px sans-serif",
    textAlign: "left",
    textBaseline: "middle",
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    rotate: () => undefined,
    scale: () => undefined,
    beginPath: () => undefined,
    closePath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => {
      lineTos++;
    },
    rect: () => undefined,
    roundRect: () => undefined,
    arc: (x, y, r) => {
      arcs.push({ x, y, r });
    },
    ellipse: () => undefined,
    fill: () => {
      fillStyles.push(String(ctx.fillStyle));
    },
    stroke: () => {
      strokeStyles.push(String(ctx.strokeStyle));
    },
    fillText: (t) => {
      texts.push(t);
    },
    setLineDash: (segs) => {
      lineDashes.push([...segs]);
    },
  };

  if (options.withDrawImage) {
    ctx.drawImage = (image, dx, dy, dw, dh) => {
      drawImageCalls.push({ image, dx, dy, dw, dh });
    };
  }
  if (options.withQuadraticCurveTo) {
    ctx.quadraticCurveTo = () => {
      quadraticCurves++;
    };
    ctx.measureText = (text) => ({ width: text.length * 6 });
  }

  return {
    ctx,
    texts,
    fillStyles,
    strokeStyles,
    lineDashes,
    arcs,
    get quadraticCurves() {
      return quadraticCurves;
    },
    get lineTos() {
      return lineTos;
    },
    drawImageCalls,
  };
}

describe("WebGPU Pipeline Execution, 3D LOD Snapshot Baker & Widget Tethers / Scatter Brush-Linking", () => {
  test("WebGpuSchematicRenderer compiles node + wire WGSL pipelines, executes renderFrame passes, grows buffers dynamically, and disposes cleanly", async () => {
    assert.ok(SCHEMATIC_NODE_WGSL.includes("@vertex") && SCHEMATIC_NODE_WGSL.includes("@fragment"));
    assert.ok(
      SCHEMATIC_WIRE_WGSL.includes("@vertex") &&
        SCHEMATIC_WIRE_WGSL.includes("@fragment") &&
        SCHEMATIC_WIRE_WGSL.includes("CameraUniforms"),
    );

    const harness = createMockWebGpuHarness();
    const renderer = new WebGpuSchematicRenderer();

    // Before initialize -> graceful fallback
    const scene = new SoaSceneGraph(512);
    for (let i = 0; i < 10; i++) {
      scene.upsertNode({ id: `n_${i}`, x: i * 80, y: 40, width: 50, height: 30 });
    }
    scene.upsertEdge({
      id: "w_0",
      sourceNodeId: "n_0",
      targetNodeId: "n_1",
      vertices: [{ x: 65, y: 55 }],
      routePoints: [],
      zIndex: 0,
      flags: 0,
    });
    scene.upsertEdge({
      id: "w_1",
      sourceNodeId: "n_1",
      targetNodeId: "n_2",
      vertices: [],
      routePoints: [],
      zIndex: 0,
      flags: 0,
    });

    const camera = new CameraController({ initial: { tx: 25, ty: -10, zoom: 1.5 } });
    const viewport = { width: 1280, height: 800 };

    const preInitRes = renderer.renderFrame(scene, camera, viewport);
    assert.equal(preInitRes.rendered, false);
    assert.equal(preInitRes.backend, "fallback");
    assert.equal(preInitRes.instanceCount, 10);
    assert.equal(preInitRes.wireSegmentCount, 3);

    // Initialize with mock WebGpuLike + canvas
    const ok = await renderer.initialize(harness.canvas, harness.gpu);
    assert.equal(ok, true);
    assert.equal(renderer.isReady(), true);
    assert.equal(harness.getConfigureCalls(), 1);
    assert.equal(harness.shaderModules.length, 2);
    assert.equal(harness.pipelines.length, 2);
    assert.ok(harness.pipelines.some((p) => p.topology === "triangle-list"));
    assert.ok(harness.pipelines.some((p) => p.topology === "line-list"));

    // First WebGPU renderFrame pass
    const res1 = renderer.renderFrame(scene, camera, viewport);
    assert.deepEqual(res1, {
      rendered: true,
      backend: "webgpu",
      instanceCount: 10,
      wireSegmentCount: 3,
    });

    // Verify camera uniforms, instance data, and wire segments were written
    const uniformWrite = harness.writeBuffers.find((w) => w.bufferLabel === "schematic-camera-uniforms");
    assert.ok(uniformWrite);
    assert.equal(uniformWrite.snapshot[0], 1280);
    assert.equal(uniformWrite.snapshot[1], 800);
    assert.equal(uniformWrite.snapshot[2], 25);
    assert.equal(uniformWrite.snapshot[3], -10);
    assert.equal(uniformWrite.snapshot[4], 1.5);

    assert.ok(harness.writeBuffers.some((w) => w.bufferLabel === "schematic-node-instances"));
    assert.ok(harness.writeBuffers.some((w) => w.bufferLabel === "schematic-wire-segments"));

    // Verify draw(6, 10) for nodes and draw(2, 3) for wires + submit
    assert.equal(harness.drawCalls.length, 2);
    assert.ok(
      harness.drawCalls.some(
        (d) => d.pipelineLabel === "schematic-node-pipeline" && d.vertexCount === 6 && d.instanceCount === 10,
      ),
    );
    assert.ok(
      harness.drawCalls.some(
        (d) => d.pipelineLabel === "schematic-wire-pipeline" && d.vertexCount === 2 && d.instanceCount === 3,
      ),
    );
    assert.equal(harness.getRenderPassEnds(), 1);
    assert.equal(harness.submittedCommandBuffers.length, 1);

    // Steady-state frame reuses vertex buffers without reallocation
    const bufferCountAfterFrame1 = harness.buffers.length;
    const res2 = renderer.renderFrame(scene, camera, viewport);
    assert.equal(res2.rendered, true);
    assert.equal(harness.buffers.length, bufferCountAfterFrame1);

    // Grow scene past initial 1024-byte instance buffer & 512-byte wire buffer -> triggers dynamic growth
    for (let i = 10; i < 80; i++) {
      scene.upsertNode({
        id: `n_${i}`,
        x: (i % 10) * 60,
        y: 80 + Math.floor(i / 10) * 40,
        width: 40,
        height: 24,
      });
    }
    for (let i = 2; i < 45; i++) {
      scene.upsertEdge({
        id: `w_${i}`,
        sourceNodeId: `n_${i}`,
        targetNodeId: `n_${i + 1}`,
        vertices: [],
        routePoints: [],
        zIndex: 0,
        flags: 0,
      });
    }

    const prevInstanceBuf = harness.buffers.find((b) => b.label === "schematic-node-instances")!;
    const prevWireBuf = harness.buffers.find((b) => b.label === "schematic-wire-segments")!;
    const res3 = renderer.renderFrame(scene, camera, viewport);
    assert.equal(res3.rendered, true);
    assert.equal(res3.instanceCount, 80);
    assert.equal(res3.wireSegmentCount, 46);
    assert.equal(prevInstanceBuf.destroyed, true);
    assert.equal(prevWireBuf.destroyed, true);
    assert.ok(harness.buffers.length > bufferCountAfterFrame1);

    // Dispose destroys all active GPU buffers and resets ready state
    renderer.dispose();
    assert.equal(renderer.isReady(), false);
    assert.equal(harness.getUnconfigureCalls(), 1);
    assert.ok(harness.buffers.every((b) => b.destroyed));

    const postDispose = renderer.renderFrame(scene, camera, viewport);
    assert.equal(postDispose.rendered, false);
    assert.equal(postDispose.backend, "fallback");

    // Graceful failure when adapter is null
    const failed = await renderer.initialize(harness.canvas, {
      async requestAdapter() {
        return null;
      },
    });
    assert.equal(failed, false);
    assert.equal(renderer.isReady(), false);
  });

  test("ScissorSnapshotBaker caches by stampKey, evicts LRU entries closing bitmaps, invalidates cleanly, and paints frozen snapshots", async () => {
    const closedBitmaps: string[] = [];
    let captureInvocations = 0;

    const baker = new ScissorSnapshotBaker({
      maxSnapshots: 2,
      createImageBitmapFn: async (_src, _sx, _sy, sw, sh): Promise<SnapshotBitmapLike> => {
        captureInvocations++;
        const tag = `bmp_${captureInvocations}`;
        return {
          width: sw,
          height: sh,
          close() {
            closedBitmaps.push(tag);
          },
        };
      },
    });

    const mockCanvas = { width: 1024, height: 768 };

    // Capture portal_a
    const okA = await baker.captureFromCanvas(
      "portal_a",
      mockCanvas,
      { x: 10, y: 20, width: 200, height: 150 },
      "cam_v1",
    );
    assert.equal(okA, true);
    assert.equal(baker.hasSnapshot("portal_a"), true);
    assert.equal(baker.hasSnapshot("portal_a", "cam_v1"), true);
    assert.equal(baker.hasSnapshot("portal_a", "cam_v2"), false);
    assert.equal(captureInvocations, 1);

    // Re-capturing identical (portalId, stampKey) hits cache with zero extra readbacks
    await baker.captureFromCanvas("portal_a", mockCanvas, { x: 10, y: 20, width: 200, height: 150 }, "cam_v1");
    assert.equal(captureInvocations, 1);

    // Capture portal_b
    await baker.captureFromCanvas("portal_b", mockCanvas, { x: 240, y: 20, width: 180, height: 140 }, "cam_b1");
    assert.equal(baker.size, 2);

    // Touch portal_a so portal_b becomes the LRU entry
    const snapA = baker.getSnapshot("portal_a");
    assert.ok(snapA);
    assert.equal(snapA.synthetic, false);

    // Capture portal_c -> evicts portal_b and closes bmp_2
    await baker.captureFromCanvas("portal_c", mockCanvas, { x: 460, y: 20, width: 160, height: 120 }, "cam_c1");
    assert.equal(baker.size, 2);
    assert.equal(baker.hasSnapshot("portal_b"), false);
    assert.equal(baker.hasSnapshot("portal_a"), true);
    assert.equal(baker.hasSnapshot("portal_c"), true);
    assert.deepEqual(closedBitmaps, ["bmp_2"]);

    // Paint frozen snapshots onto a Canvas2D context supporting drawImage
    const recWithDrawImage = createRecordingCanvas2D({ withDrawImage: true });
    const paintedCount = baker.paintFrozenSnapshots(recWithDrawImage.ctx, [
      {
        portalId: "portal_a",
        x: 12,
        y: 24,
        width: 200,
        height: 150,
        snapshotFrozen: true,
        label: "Turbine CAD",
      },
      {
        portalId: "portal_c",
        x: 240,
        y: 24,
        width: 160,
        height: 120,
        snapshotFrozen: false, // live portal -> skipped
        label: "Live FEA",
      },
      {
        portalId: "portal_unbaked",
        x: 420,
        y: 24,
        width: 160,
        height: 120,
        snapshotFrozen: true, // unbaked -> skipped
      },
    ]);
    assert.equal(paintedCount, 1);
    assert.equal(recWithDrawImage.drawImageCalls.length, 1);
    assert.equal(recWithDrawImage.drawImageCalls[0]!.dx, 12);
    assert.equal(recWithDrawImage.drawImageCalls[0]!.dw, 200);
    assert.ok(recWithDrawImage.texts.includes("Turbine CAD"));

    // Headless synthetic fallback when sourceCanvas is null + card fallback painter
    const headlessBaker = new ScissorSnapshotBaker(4);
    const okSynthetic = await headlessBaker.captureFromCanvas(
      "portal_headless",
      null,
      { x: 0, y: 0, width: 140, height: 100 },
      "rev_7",
    );
    assert.equal(okSynthetic, true);
    assert.equal(headlessBaker.getSnapshot("portal_headless")?.synthetic, true);

    const recFallback = createRecordingCanvas2D();
    const fallbackPainted = headlessBaker.paintFrozenSnapshots(recFallback.ctx, [
      {
        portalId: "portal_headless",
        x: 30,
        y: 40,
        width: 140,
        height: 100,
        snapshotFrozen: true,
        label: "CFD Mesh",
      },
    ]);
    assert.equal(fallbackPainted, 1);
    assert.ok(recFallback.texts.includes("CFD Mesh"));
    assert.ok(recFallback.texts.some((t) => t.includes("rev_7")));

    // Invalidate specific portal and dispose remaining
    baker.invalidate("portal_a");
    assert.equal(baker.hasSnapshot("portal_a"), false);
    assert.ok(closedBitmaps.includes("bmp_1"));

    baker.dispose();
    assert.equal(baker.size, 0);
    assert.ok(closedBitmaps.includes("bmp_3"));
  });

  test("paintWidgetLeaderTether, hitTestScatterBrush, and CanvasTable row highlighting link Monte Carlo scatter brushes to ReqIF tables", () => {
    // 1. paintWidgetLeaderTether with quadraticCurveTo and pill label
    const recCurve = createRecordingCanvas2D({ withQuadraticCurveTo: true });
    paintWidgetLeaderTether(recCurve.ctx, 300, 120, 140, 80, "#38bdf8", "motor.T");
    assert.equal(recCurve.quadraticCurves, 1);
    assert.ok(recCurve.lineDashes.some((d) => d.length === 2 && d[0] === 5));
    assert.ok(recCurve.lineDashes.some((d) => d.length === 0));
    assert.ok(recCurve.arcs.length >= 3); // origin + halo + target dot
    assert.ok(recCurve.texts.includes("motor.T"));

    // 2. paintWidgetLeaderTether polyline fallback when quadraticCurveTo is absent
    const recPoly = createRecordingCanvas2D({ withQuadraticCurveTo: false });
    paintWidgetLeaderTether(recPoly.ctx, 10, 20, 110, 90, "#f59e0b", "flange_a");
    assert.ok(recPoly.lineTos >= 12);
    assert.ok(recPoly.texts.includes("flange_a"));

    // 3. hitTestScatterBrush accurate pixel -> data mapping + unique ReqIF linked IDs
    const plotX = 100;
    const plotY = 50;
    const plotWidth = 360;
    const plotHeight = 200;
    const baseSpec: CanvasPlotSpec = {
      id: "mc_pareto",
      title: "Monte Carlo Mass vs Peak Temp",
      kind: "scatter",
      series: [
        {
          id: "mc",
          label: "MC Runs",
          color: "#14b8a6",
          x: [1.0, 2.0, 3.0, 4.0, 5.0],
          y: [310, 330, 355, 360, 390],
        },
      ],
      sampleEntityIds: ["REQ-001", "REQ-014", "REQ-042", "REQ-014", "REQ-099"],
      tetherTarget: { x: 40, y: 120, label: "thermal.core" },
    };

    // Compute exact pixel coordinates of points #1 (2.0, 330), #2 (3.0, 355), #3 (4.0, 360)
    const bounds = computePlotBounds(baseSpec);
    const padL = 42;
    const padR = 12;
    const padT = 24;
    const padB = 24;
    const innerW = plotWidth - padL - padR;
    const innerH = plotHeight - padT - padB;
    const toCanvasX = (vx: number) => plotX + padL + ((vx - bounds.minX) / (bounds.maxX - bounds.minX)) * innerW;
    const toCanvasY = (vy: number) =>
      plotY + padT + innerH - ((vy - bounds.minY) / (bounds.maxY - bounds.minY)) * innerH;

    // Pass reversed corners (x0 > x1, y0 > y1) to verify drag-direction normalization
    const brush = {
      x0: toCanvasX(4.2),
      y0: toCanvasY(325),
      x1: toCanvasX(1.8),
      y1: toCanvasY(365),
    };

    const hit = hitTestScatterBrush(baseSpec, plotX, plotY, plotWidth, plotHeight, brush);
    assert.deepEqual(hit.indices, [1, 2, 3]);
    // REQ-014 appears at both index 1 and index 3 -> deduplicated cleanly!
    assert.deepEqual(hit.linkedIds, ["REQ-014", "REQ-042"]);

    // Brush completely outside plot returns empty selection
    const miss = hitTestScatterBrush(baseSpec, plotX, plotY, plotWidth, plotHeight, {
      x0: 0,
      y0: 0,
      x1: 20,
      y1: 20,
    });
    assert.deepEqual(miss, { indices: [], linkedIds: [] });

    // 4. paintCanvasPlot paints tether + translucent selection box + amber highlighted points
    const recPlot = createRecordingCanvas2D({ withQuadraticCurveTo: true });
    const plotRes = paintCanvasPlot(
      recPlot.ctx,
      { ...baseSpec, brushRect: brush },
      plotX,
      plotY,
      plotWidth,
      plotHeight,
    );
    assert.equal(plotRes.renderedPoints, 5);
    assert.ok(recPlot.texts.includes("thermal.core"));
    assert.ok(recPlot.fillStyles.includes("rgba(56, 189, 248, 0.16)"));
    assert.ok(recPlot.fillStyles.includes("#f59e0b"));
    assert.ok(recPlot.strokeStyles.includes("#38bdf8"));

    // 5. Cross-widget brush-linking into CanvasTable highlights matched ReqIF rows
    const recTable = createRecordingCanvas2D();
    const tableRes = paintCanvasTable(
      recTable.ctx,
      {
        title: "ReqIF Verification Matrix",
        columns: [
          { key: "id", label: "Req ID", widthRatio: 0.35 },
          { key: "limit", label: "Limit", widthRatio: 0.65, align: "right" },
        ],
        rows: [
          { id: "REQ-001", cells: { id: "REQ-001", limit: "Mass <= 5 kg" }, status: "pass" },
          { id: "REQ-014", cells: { id: "REQ-014", limit: "Mass <= 4 kg" }, status: "pass" },
          { id: "REQ-042", cells: { id: "REQ-042", limit: "T <= 360 K" }, status: "stale" },
          { id: "REQ-099", cells: { id: "REQ-099", limit: "T <= 380 K" }, status: "fail" },
        ],
        highlightedRowIds: hit.linkedIds,
      },
      500,
      50,
      300,
      160,
    );
    assert.equal(tableRes.visibleRowCount, 4);
    assert.equal(tableRes.highlightedRowCount, 2);
    assert.ok(recTable.strokeStyles.includes("#f59e0b"));
    assert.ok(recTable.fillStyles.includes("rgba(245, 158, 11, 0.2)"));

    // 6. StickyBadge delegates to paintWidgetLeaderTether including optional tether label
    const recBadge = createRecordingCanvas2D({ withQuadraticCurveTo: true });
    paintStickyBadge(
      recBadge.ctx,
      {
        label: "Peak Core Temp",
        value: "355.0",
        unit: "K",
        status: "warning",
        tetherTarget: { x: 40, y: 80, label: "probe.T" },
      },
      180,
      60,
    );
    assert.equal(recBadge.quadraticCurves, 1);
    assert.ok(recBadge.texts.includes("probe.T"));
    assert.ok(recBadge.texts.includes("355.0 K"));
  });
});
