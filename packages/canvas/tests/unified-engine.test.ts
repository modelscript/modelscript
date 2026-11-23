// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  CanvasPointerFSM,
  SceneNodeFlags,
  SoaSceneGraph,
  UnifiedGraph,
  UnifiedSelection,
  UnifiedTransform,
  compileGlyphMarkup,
  materializeGlyphToSvg,
  paintGlyphToCanvas2D,
  patchGlyphAttrPath,
  readGlyphAttrPath,
  type Canvas2DContextLike,
} from "../src/engine/index.js";

function createMockCanvas2D(): { ctx: Canvas2DContextLike; ops: string[] } {
  const ops: string[] = [];
  const ctx: Canvas2DContextLike = {
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    globalAlpha: 1,
    font: "12px sans-serif",
    textAlign: "left",
    textBaseline: "middle",
    save: () => ops.push("save"),
    restore: () => ops.push("restore"),
    translate: (x, y) => ops.push(`translate:${Math.round(x)},${Math.round(y)}`),
    rotate: (r) => ops.push(`rotate:${r.toFixed(2)}`),
    scale: (x, y) => ops.push(`scale:${x.toFixed(2)},${y.toFixed(2)}`),
    beginPath: () => ops.push("beginPath"),
    closePath: () => ops.push("closePath"),
    moveTo: (x, y) => ops.push(`moveTo:${Math.round(x)},${Math.round(y)}`),
    lineTo: (x, y) => ops.push(`lineTo:${Math.round(x)},${Math.round(y)}`),
    rect: (x, y, w, h) => ops.push(`rect:${Math.round(x)},${Math.round(y)},${Math.round(w)},${Math.round(h)}`),
    roundRect: (x, y, w, h) =>
      ops.push(`roundRect:${Math.round(x)},${Math.round(y)},${Math.round(w)},${Math.round(h)}`),
    arc: (x, y, r) => ops.push(`arc:${Math.round(x)},${Math.round(y)},${Math.round(r)}`),
    ellipse: (x, y, rx, ry) =>
      ops.push(`ellipse:${Math.round(x)},${Math.round(y)},${Math.round(rx)},${Math.round(ry)}`),
    fill: () => ops.push("fill"),
    stroke: () => ops.push("stroke"),
    fillText: (t) => ops.push(`text:${t}`),
    setLineDash: () => ops.push("dash"),
  };
  return { ctx, ops };
}

describe("Unified SoA SceneGraph, GlyphCompiler, PointerFSM & UnifiedGraph", () => {
  test("SoaSceneGraph scales to 50,000 nodes with O(K_visible) frustum queries under 16.7ms", () => {
    const scene = new SoaSceneGraph(50_000, 512);
    const cols = 250;
    for (let i = 0; i < 50_000; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      scene.upsertNode({
        id: `bus_${i}`,
        x: col * 120,
        y: row * 90,
        width: 80,
        height: 40,
        zIndex: i % 5,
      });
    }
    assert.equal(scene.nodeCount, 50_000);

    // Warm up index once (models steady-state panning/zooming)
    const warmHits = scene.queryVisibleNodes({ x: 5000, y: 5000, width: 1200, height: 800 });
    assert.ok(warmHits.length > 50 && warmHits.length < 300);

    // Measure 20 consecutive pan frames
    const t0 = performance.now();
    for (let f = 0; f < 20; f++) {
      const visible = scene.queryVisibleNodes({
        x: 5000 + f * 30,
        y: 5000 + f * 20,
        width: 1280,
        height: 800,
      });
      assert.ok(visible.length > 0);
    }
    const avgMs = (performance.now() - t0) / 20;
    assert.ok(avgMs < 16.7, `Expected frustum query < 16.7ms on 50k nodes, got ${avgMs.toFixed(2)}ms`);

    // Verify flat WASM rect packing
    const packed = scene.packNodeRectsForWasm();
    assert.equal(packed.ids.length, 50_000);
    assert.equal(packed.rects.length, 200_000);
  });

  test("SoaSceneGraph computes exact rotated and flipped port world coordinates & outward normals", () => {
    const scene = new SoaSceneGraph();
    scene.upsertNode({
      id: "resistor",
      x: 100,
      y: 100,
      width: 80,
      height: 40,
      angleDeg: 90,
      flipX: false,
      flipY: false,
    });
    scene.setNodePorts("resistor", [
      { id: "p", x: 0, y: 20 },
      { id: "n", x: 80, y: 20 },
    ]);

    // Center is (140, 120). Local p=(-40, 0) rotated +90 deg -> (0, -40) => (140, 80)
    const pWorld = scene.getPortWorldPosition("resistor", "p");
    const nWorld = scene.getPortWorldPosition("resistor", "n");
    assert.ok(pWorld && nWorld);
    assert.ok(Math.abs(pWorld.x - 140) < 0.01 && Math.abs(pWorld.y - 80) < 0.01);
    assert.ok(Math.abs(nWorld.x - 140) < 0.01 && Math.abs(nWorld.y - 160) < 0.01);
    // Outward normal of left port (-1, 0) rotated +90 deg -> (0, -1)
    assert.ok(Math.abs(pWorld.nx) < 0.01 && Math.abs(pWorld.ny + 1) < 0.01);

    // Hit-test inside rotated OBB (height is now vertical 80px around center (140, 120))
    assert.equal(scene.hitTestNode(140, 85)?.id, "resistor");
    assert.equal(scene.hitTestNode(105, 120), null);

    // Flip X swaps left and right ports
    scene.setNodeFlip("resistor", true, false);
    const pFlipped = scene.getPortWorldPosition("resistor", "p");
    assert.ok(pFlipped && Math.abs(pFlipped.y - 160) < 0.01);
  });

  test("GlyphCompiler compiles Modelica X6Markup, supports O(1) selector patching and Canvas2D painting", () => {
    const glyph = compileGlyphMarkup(
      {
        tagName: "svg",
        attrs: { viewBox: "-100 -100 200 200", width: 80, height: 80 },
        children: [
          {
            tagName: "rect",
            selector: "body",
            attrs: { x: -80, y: -40, width: 160, height: 80, fill: "#1e293b", stroke: "#38bdf8", strokeWidth: 2 },
          },
          {
            tagName: "circle",
            selector: "indicator",
            attrs: { cx: 0, cy: 0, r: 16, fill: "#57606a" },
          },
          {
            tagName: "text",
            selector: "label",
            attrs: { x: 0, y: 65, "text-anchor": "middle", fill: "#f8fafc" },
            textContent: "R1=100",
          },
        ],
      },
      { indicator: { fill: "#2da44e" } },
      80,
      80,
    );

    assert.equal(readGlyphAttrPath(glyph, "indicator/fill"), "#2da44e");
    assert.equal(patchGlyphAttrPath(glyph, "label/text", "R1=250"), true);
    assert.equal(readGlyphAttrPath(glyph, "label/text"), "R1=250");

    const { ctx, ops } = createMockCanvas2D();
    paintGlyphToCanvas2D(ctx, glyph, 80, 80, { scale: 1 });
    assert.ok(ops.some((op) => op.startsWith("rect:")));
    assert.ok(ops.some((op) => op.startsWith("arc:")));
    assert.ok(ops.includes("text:R1=250"));

    // Minimal LOD skips micro text labels
    const low = createMockCanvas2D();
    paintGlyphToCanvas2D(low.ctx, glyph, 80, 80, { lodMinimal: true, scale: 0.2 });
    assert.ok(!low.ops.some((op) => op.startsWith("text:")));
  });

  test("CanvasPointerFSM handles drag, rotated resize, orthogonal segment doglegs (no port ripping), wiring, and portal focus", () => {
    const scene = new SoaSceneGraph();
    scene.upsertNode({ id: "src", x: 100, y: 100, width: 80, height: 40 });
    scene.setNodePorts("src", [{ id: "out", x: 80, y: 20 }]);
    scene.upsertNode({ id: "dst", x: 300, y: 100, width: 80, height: 40 });
    scene.setNodePorts("dst", [{ id: "in", x: 0, y: 20 }]);
    scene.upsertNode({
      id: "cad_portal",
      x: 100,
      y: 260,
      width: 240,
      height: 180,
      flags: SceneNodeFlags.VISIBLE | SceneNodeFlags.PORTAL,
    });
    scene.upsertEdge({
      id: "e1",
      sourceNodeId: "src",
      sourcePortId: "out",
      targetNodeId: "dst",
      targetPortId: "in",
      vertices: [],
      routePoints: [],
      zIndex: 0,
      flags: SceneNodeFlags.VISIBLE,
    });

    const connected: { sourceNodeId: string; targetNodeId: string }[] = [];
    const focusHistory: (string | null)[] = [];
    const fsm = new CanvasPointerFSM(
      scene,
      {
        onWireConnected: (c) => connected.push(c),
        onPortalFocusChange: (id) => focusHistory.push(id),
      },
      { gridSize: 2, smartGuides: false },
    );

    // 1. Port-to-port wire dragging with magnet snap
    fsm.handleEvent({
      planeId: "p",
      u: 180,
      v: 120,
      button: 0,
      buttons: 1,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      phase: "down",
    });
    assert.equal(fsm.mode, "wiring");
    fsm.handleEvent({
      planeId: "p",
      u: 295,
      v: 122,
      button: 0,
      buttons: 1,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      phase: "move",
    });
    assert.equal(fsm.wiringPreview?.snappedTarget?.nodeId, "dst");
    fsm.handleEvent({
      planeId: "p",
      u: 295,
      v: 122,
      button: 0,
      buttons: 0,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      phase: "up",
    });
    assert.equal(connected.length, 1);
    assert.equal(connected[0]?.sourceNodeId, "src");
    assert.equal(connected[0]?.targetNodeId, "dst");

    // 2. Native orthogonal segment dragging on terminal wire preserves port anchors by inserting dogleg vertices
    assert.equal(fsm.startSegmentDrag("e1", 0, 240, 120), true);
    fsm.handleEvent({
      planeId: "p",
      u: 240,
      v: 160,
      button: 0,
      buttons: 1,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      phase: "move",
    });
    fsm.handleEvent({
      planeId: "p",
      u: 240,
      v: 160,
      button: 0,
      buttons: 0,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      phase: "up",
    });
    const edgeAfter = scene.getEdge("e1")!;
    assert.equal(edgeAfter.sourcePortId, "out");
    assert.equal(edgeAfter.targetPortId, "in");
    assert.equal(edgeAfter.vertices.length, 4);
    assert.equal(edgeAfter.vertices[1]?.y, 160);
    assert.equal(edgeAfter.vertices[2]?.y, 160);

    // 3. Double-clicking CAD portal enters Click-to-Enter focus mode; clicking outside exits
    fsm.handleEvent({
      planeId: "p",
      u: 200,
      v: 320,
      button: 0,
      buttons: 0,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      phase: "dblclick",
    });
    assert.equal(fsm.focusedPortalId, "cad_portal");
    fsm.handleEvent({
      planeId: "p",
      u: 10,
      v: 10,
      button: 0,
      buttons: 1,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      phase: "down",
    });
    assert.equal(fsm.focusedPortalId, null);
    assert.deepEqual(focusHistory, ["cad_portal", null]);
  });

  test("UnifiedGraph delivers complete AntV X6 replacement parity with custom routers, connectors, portals, and Canvas2D painting", () => {
    let customRouterCalled = false;
    let customConnectorCalled = false;
    UnifiedGraph.registerRouter("test-ortho", (_verts, _args, view) => {
      customRouterCalled = true;
      const s = view.sourcePoint ?? { x: 0, y: 0 };
      const t = view.targetPoint ?? { x: 100, y: 100 };
      return [
        { x: (s.x + t.x) / 2, y: s.y },
        { x: (s.x + t.x) / 2, y: t.y },
      ];
    });
    UnifiedGraph.registerConnector("test-rounded", (s, t, pts) => {
      customConnectorCalled = true;
      return `M ${s.x} ${s.y} ` + pts.map((p) => `L ${p.x} ${p.y}`).join(" ") + ` L ${t.x} ${t.y}`;
    });

    const graph = new UnifiedGraph({ width: 1000, height: 600 });
    graph.use(new UnifiedSelection({ enabled: true, rubberband: true }));
    graph.use(new UnifiedTransform({ resizing: { enabled: true }, rotating: { enabled: true } }));

    const events: string[] = [];
    graph.on("selection:changed", () => events.push("selection:changed"));
    graph.on("node:change:position", () => events.push("node:change:position"));

    const n1 = graph.addNode({
      id: "motor",
      x: 50,
      y: 80,
      width: 100,
      height: 60,
      ports: { items: [{ id: "flange_b", args: { x: 100, y: 30 } }] },
    });
    const n2 = graph.addNode({
      id: "housing_cad",
      x: 280,
      y: 60,
      width: 240,
      height: 180,
      ports: { items: [{ id: "flange_a", args: { x: 0, y: 50 } }] },
      data: {
        portal: {
          kind: "cad",
          artifactUri: "cad/housing.step",
          isAnimating: true,
        },
      },
    });
    const e1 = graph.addEdge({
      id: "conn_1",
      source: { cell: "motor", port: "flange_b" },
      target: { cell: "housing_cad", port: "flange_a" },
      router: { name: "test-ortho" },
      connector: { name: "test-rounded" },
    });

    graph.registerCanvasWidget({
      id: "plot_torque",
      kind: "plot",
      bounds: { x: 50, y: 260, width: 260, height: 140 },
      plot: {
        id: "plot_torque",
        title: "Motor Torque (N.m)",
        kind: "timeseries",
        series: [{ id: "tau", label: "tau", color: "#38bdf8", x: [0, 1, 2], y: [0, 4.2, 3.8] }],
        crosshairX: 1,
      },
    });

    assert.equal(graph.getNodes().length, 2);
    assert.equal(graph.getEdges().length, 1);
    assert.equal(graph.getConnectedEdges(n1).length, 1);

    graph.select(n1);
    assert.equal(graph.isSelected(n1), true);
    n1.setPosition(70, 90);
    assert.ok(events.includes("selection:changed"));
    assert.ok(events.includes("node:change:position"));

    graph.zoomToFit({ padding: 20 });
    assert.ok(graph.scale().sx > 0);

    // Embedded 3D CAD portal automatically registered on 1 shared WebGL context
    const scissorRects = graph.computeEmbedded3DScissorRects();
    assert.equal(graph.portal3DManager.sharedWebGlContextCount, 1);
    assert.equal(scissorRects.length, 1);
    assert.equal(scissorRects[0]?.portalId, "housing_cad");
    assert.equal(scissorRects[0]?.renderLive, true);

    // Paint entire unified scene (nodes + custom routed edge + pinned Modelon Impact plot) to Canvas2D
    const { ctx } = createMockCanvas2D();
    const stats = graph.paintToCanvas2D(ctx, { dark: true });
    assert.equal(stats.drawnNodes, 2);
    assert.equal(stats.drawnEdges, 1);
    assert.equal(stats.drawnWidgets, 1);
    assert.equal(customRouterCalled, true);
    assert.equal(customConnectorCalled, true);
    assert.equal(e1.getSourceCellId(), "motor");
    assert.equal(n2.id, "housing_cad");

    graph.dispose();
    assert.equal(graph.isDisposed(), true);
  });

  test("UnifiedGraph auto-switches to high-scale Canvas2D mode above threshold, honors viewportArea insets, and syncs plot crosshairs", () => {
    const graph = new UnifiedGraph({ width: 1000, height: 600, renderMode: "auto", highScaleThreshold: 120 });
    assert.equal(graph.getActiveRenderMode(), "svg");

    for (let i = 0; i < 125; i++) {
      graph.addNode({ id: `n_${i}`, x: (i % 15) * 80, y: Math.floor(i / 15) * 60, width: 50, height: 30 });
    }
    assert.equal(graph.getActiveRenderMode(), "canvas2d");

    // viewportArea shifts fitted content center to the inset region's center (left=200, width=600 -> center X=500)
    graph.zoomToRect(
      { x: 0, y: 0, width: 200, height: 100 },
      { padding: 0, maxScale: 1, viewportArea: { x: 200, y: 50, width: 600, height: 400 } },
    );
    const m = graph.matrix();
    // Content center (100, 50) maps to viewportArea center (500, 250) at zoom=1 -> tx=400, ty=200
    assert.equal(m.a, 1);
    assert.equal(m.e, 400);
    assert.equal(m.f, 200);

    // Pinned plot widget crosshair synchronization
    graph.registerCanvasWidget({
      id: "w_plot",
      kind: "plot",
      bounds: { x: 0, y: 0, width: 300, height: 150 },
      plot: {
        id: "w_plot",
        title: "Temp",
        kind: "timeseries",
        series: [{ id: "T", label: "T", color: "#14b8a6", x: [0, 5, 10], y: [300, 340, 350] }],
      },
    });
    graph.syncPlotCrosshair(4.25);
    assert.equal(graph.getCanvasWidgets()[0]?.plot?.crosshairX, 4.25);
    graph.syncPlotCrosshair(undefined);
    assert.equal(graph.getCanvasWidgets()[0]?.plot?.crosshairX, undefined);

    graph.dispose();
  });

  test("UnifiedGraph renders SVG edge markers, edge labels, vertex/segment/remove edge tools, marquee & guides in DOM", () => {
    // Minimal DOM shim for headless Node verification of SVG chrome construction
    class FakeEl {
      public tagName: string;
      public attrs = new Map<string, string>();
      public children: FakeEl[] = [];
      public parentNode: FakeEl | null = null;
      public parentElement: FakeEl | null = null;
      public style: Record<string, string> = {};
      public textContent: string | null = null;
      public clientWidth = 800;
      public clientHeight = 600;
      private classes = new Set<string>();
      public classList = {
        add: (c: string) => this.classes.add(c),
        remove: (c: string) => this.classes.delete(c),
        contains: (c: string) => this.classes.has(c),
      };
      constructor(tag: string) {
        this.tagName = tag;
      }
      set className(val: string) {
        this.attrs.set("class", val);
        this.classes = new Set(val.split(/\s+/).filter(Boolean));
      }
      get className(): string {
        return Array.from(this.classes).join(" ");
      }
      set innerHTML(val: string) {
        if (val === "") {
          for (const c of this.children) {
            c.parentNode = null;
            c.parentElement = null;
          }
          this.children = [];
        }
      }
      setAttribute(k: string, v: string) {
        this.attrs.set(k, v);
        if (k === "class") this.className = v;
      }
      setAttributeNS(_ns: string, k: string, v: string) {
        this.setAttribute(k, v);
      }
      getAttribute(k: string): string | null {
        return this.attrs.get(k) ?? null;
      }
      removeAttribute(k: string) {
        this.attrs.delete(k);
      }
      appendChild(child: FakeEl) {
        child.parentNode = this;
        child.parentElement = this;
        this.children.push(child);
        return child;
      }
      removeChild(child: FakeEl) {
        this.children = this.children.filter((c) => c !== child);
        child.parentNode = null;
        child.parentElement = null;
        return child;
      }
      addEventListener() {
        // noop
      }
      removeEventListener() {
        // noop
      }
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 800, height: 600 };
      }
      getContext() {
        return null;
      }
      closest(sel: string): FakeEl | null {
        const attrName = sel.startsWith("[") && sel.endsWith("]") ? sel.slice(1, -1) : null;
        if (!attrName) return null;
        if (this.attrs.has(attrName)) return this;
        let cur: FakeEl | null = this.parentNode;
        while (cur) {
          if (cur.attrs.has(attrName)) return cur;
          cur = cur.parentNode;
        }
        return null;
      }
      querySelector(sel: string): FakeEl | null {
        return this.querySelectorAll(sel)[0] ?? null;
      }
      querySelectorAll(sel: string): FakeEl[] {
        const hits: FakeEl[] = [];
        const walk = (node: FakeEl) => {
          for (const c of node.children) {
            if (sel.startsWith(".") && c.classList.contains(sel.slice(1))) {
              hits.push(c);
            } else if (sel.startsWith("[data-edge-tools-id=")) {
              const wanted = sel.slice('[data-edge-tools-id="'.length, -2);
              if (c.getAttribute("data-edge-tools-id") === wanted) hits.push(c);
            } else if (sel.includes(" ")) {
              // simple descendant match for `#id path`
              const parts = sel.split(" ");
              if (c.tagName === parts[1]) hits.push(c);
            }
            walk(c);
          }
        };
        walk(this);
        return hits;
      }
    }

    const origDoc = globalThis.document;
    (globalThis as unknown as { document: unknown }).document = {
      createElement: (tag: string) => new FakeEl(tag),
      createElementNS: (_ns: string, tag: string) => new FakeEl(tag),
    };

    try {
      const container = new FakeEl("div");
      const graph = new UnifiedGraph({
        container: container as unknown as HTMLElement,
        width: 800,
        height: 600,
      });

      graph.addNode({
        id: "a",
        x: 20,
        y: 40,
        width: 80,
        height: 40,
        ports: { items: [{ id: "out", args: { x: 80, y: 20 } }] },
      });
      graph.addNode({
        id: "b",
        x: 260,
        y: 120,
        width: 80,
        height: 40,
        ports: { items: [{ id: "in", args: { x: 0, y: 20 } }] },
      });
      const edge = graph.addEdge({
        id: "e_labeled",
        source: { cell: "a", port: "out" },
        target: { cell: "b", port: "in" },
        vertices: [
          { x: 180, y: 60 },
          { x: 180, y: 140 },
        ],
        labels: [{ attrs: { text: { text: "u_cmd" } }, position: 0.5 }],
        attrs: {
          line: {
            stroke: "#10b981",
            strokeWidth: 2,
            targetMarker: { name: "block", width: 10, height: 8 },
          },
        },
      });
      edge.addTools(["segments", "vertices", "button-remove"]);

      // Verify marker-end, label, segment handles, vertex handles, and remove button were materialized in SVG DOM
      const pathEl = edge.selectorElements.get("line")?.[0] as unknown as FakeEl;
      assert.ok(pathEl.getAttribute("marker-end")?.startsWith("url(#ms-marker-"));
      assert.equal(container.querySelectorAll(".x6-edge-label").length, 1);
      assert.ok(container.querySelectorAll(".ms-segment-handle").length >= 2);
      assert.equal(container.querySelectorAll(".ms-vertex-handle").length, 2);
      assert.equal(container.querySelectorAll(".ms-edge-remove-btn").length, 1);

      // Verify marquee rect & magnet highlighting update DOM
      graph.fsm.handleEvent({
        planeId: "primary",
        u: 10,
        v: 10,
        button: 0,
        buttons: 1,
        shiftKey: true,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        phase: "down",
      });
      graph.fsm.handleEvent({
        planeId: "primary",
        u: 200,
        v: 150,
        button: 0,
        buttons: 1,
        shiftKey: true,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        phase: "move",
      });
      const marquee = container.querySelector(".ms-marquee-rect");
      assert.ok(marquee && marquee.getAttribute("width") === "190");

      graph.dispose();
    } finally {
      (globalThis as unknown as { document: unknown }).document = origDoc;
    }
  });

  test("WebGpuSchematicRenderer packs SoA scene into contiguous GPU instance buffers and falls back gracefully without navigator.gpu", async () => {
    const { CameraController, SCHEMATIC_NODE_WGSL, WebGpuSchematicRenderer, isWebGpuAvailable, packSceneForWebGpu } =
      await import("../src/index.js");

    assert.equal(isWebGpuAvailable(), false);
    assert.ok(SCHEMATIC_NODE_WGSL.includes("@vertex"));
    assert.ok(SCHEMATIC_NODE_WGSL.includes("@fragment"));
    assert.ok(SCHEMATIC_NODE_WGSL.includes("vs_main"));

    const scene = new SoaSceneGraph(1024);
    for (let i = 0; i < 120; i++) {
      scene.upsertNode({
        id: `bus_${i}`,
        x: (i % 12) * 80,
        y: Math.floor(i / 12) * 60,
        width: 50,
        height: 30,
      });
    }
    scene.upsertEdge({
      id: "line_0",
      source: { cell: "bus_0" },
      target: { cell: "bus_1" },
      vertices: [{ x: 65, y: 15 }],
    });

    const camera = new CameraController({ x: 0, y: 0, zoom: 1 });
    const renderer = new WebGpuSchematicRenderer();
    const ready = await renderer.initialize(null);
    assert.equal(ready, false);
    assert.equal(renderer.isReady(), false);

    const batch = packSceneForWebGpu(scene, camera, { width: 1200, height: 800 });
    assert.equal(batch.instanceCount, 120);
    assert.equal(batch.instanceData.length, 120 * 8);
    assert.equal(batch.instanceData[0], 0);
    assert.equal(batch.instanceData[2], 50);
    assert.equal(batch.instanceData[3], 30);
    assert.equal(batch.wireSegmentCount, 2);
    assert.equal(batch.wireSegments.length, 8);

    const batchFromRenderer = renderer.prepareFrame(scene, camera, { width: 1200, height: 800 });
    assert.equal(batchFromRenderer.instanceCount, 120);
  });

  test("CanvasCrdtStore isolates per-user undo/redo and merges concurrent comment replies conflict-free", async () => {
    const { CanvasCrdtStore, createCanonicalPolyglotDemoBoard } = await import("../src/index.js");
    const base = createCanonicalPolyglotDemoBoard();
    const alice = new CanvasCrdtStore("alice", base);
    const bob = new CanvasCrdtStore("bob", base);

    // Alice moves Modelica tile; Bob concurrently moves CAD tile
    const dAlice = alice.moveTile("tile_modelica", 777, 111)!;
    const dBob = bob.moveTile("tile_step", 888, 222)!;
    alice.mergeDelta(dBob);
    bob.mergeDelta(dAlice);

    // Alice undoes ONLY her move -> Bob's CAD move MUST stay at 888
    assert.equal(alice.canUndo(), true);
    const dUndo = alice.undo()!;
    bob.mergeDelta(dUndo);
    assert.equal(bob.toDocument().tiles["tile_modelica"]?.bounds.x, base.tiles["tile_modelica"]!.bounds.x);
    assert.equal(bob.toDocument().tiles["tile_step"]?.bounds.x, 888);

    // Alice redoes her move -> both converge back to 777 & 888
    assert.equal(alice.canRedo(), true);
    const dRedo = alice.redo()!;
    bob.mergeDelta(dRedo);
    assert.equal(bob.toDocument().tiles["tile_modelica"]?.bounds.x, 777);
    assert.equal(bob.toDocument().tiles["tile_step"]?.bounds.x, 888);

    // Concurrent replies on the same comment thread merge via reply set-union without loss
    const baseThread = {
      id: "thread_1",
      authorId: "alice",
      authorName: "Alice",
      text: "Check thermal margin",
      createdAt: "2026-01-01T00:00:00Z",
      resolved: false,
      position: { x: 100, y: 100 },
      replies: [],
    };
    bob.mergeDelta(alice.upsertComment(baseThread));

    const rAlice = alice.appendCommentReply("thread_1", {
      id: "rep_a",
      authorId: "alice",
      authorName: "Alice",
      text: "Margin is 12 K",
      createdAt: "2026-01-01T00:01:00Z",
    })!;
    const rBob = bob.appendCommentReply("thread_1", {
      id: "rep_b",
      authorId: "bob",
      authorName: "Bob",
      text: "Confirmed in FEA",
      createdAt: "2026-01-01T00:01:05Z",
    })!;
    alice.mergeDelta(rBob);
    bob.mergeDelta(rAlice);

    assert.equal(alice.toDocument().comments["thread_1"]?.replies.length, 2);
    assert.equal(bob.toDocument().comments["thread_1"]?.replies.length, 2);
    assert.deepEqual(
      alice.toDocument().comments["thread_1"]?.replies.map((r) => r.id),
      ["rep_a", "rep_b"],
    );
  });

  test("UnifiedGraph runs Float64Array simulation playback and links scatter plot brush to table highlights", () => {
    const graph = new UnifiedGraph({ width: 800, height: 600 });
    const tank = graph.addNode({
      id: "tank1",
      x: 50,
      y: 50,
      width: 80,
      height: 80,
      markup: [{ tagName: "rect", selector: "body" }],
      attrs: { body: { fill: "#38bdf8" } },
    });

    graph.loadSimulationResult({
      time: [0, 1, 2],
      signals: { "tank1.T": [300, 350, 400] },
    });
    graph.compileAnimations(
      [
        {
          targetId: "tank1",
          selector: "body",
          variableName: "tank1.T",
          property: "fill",
          min: 300,
          max: 400,
        },
      ],
      graph.timelineStore.getVarIndexMap(),
    );

    graph.registerCanvasWidget({
      id: "scatter_mc",
      kind: "plot",
      bounds: { x: 200, y: 40, width: 220, height: 140 },
      plot: {
        id: "scatter_mc",
        title: "Monte Carlo",
        kind: "scatter",
        series: [{ id: "mc", label: "Samples", color: "#38bdf8", x: [1, 5, 9], y: [10, 50, 90] }],
        sampleEntityIds: ["REQ-001", "REQ-014", "REQ-022"],
      },
    });
    graph.registerCanvasWidget({
      id: "req_table",
      kind: "table",
      bounds: { x: 460, y: 40, width: 220, height: 140 },
      table: {
        title: "Requirements",
        columns: [{ key: "id", label: "ID", widthRatio: 1 }],
        rows: [
          { id: "REQ-001", cells: { id: "REQ-001" } },
          { id: "REQ-014", cells: { id: "REQ-014" } },
          { id: "REQ-022", cells: { id: "REQ-022" } },
        ],
      },
    });

    const ticks: number[] = [];
    graph.on<{ time: number }>("simulation:tick", (e) => ticks.push(e.time));
    graph.seekSimulation(1.0);
    assert.deepEqual(graph.getSimulationTimeRange(), { start: 0, end: 2, current: 1 });
    assert.equal(ticks[0], 1);
    assert.ok(String(tank.attr("body/fill")).startsWith("rgb("));

    // Move, resize, tether, and brush scatter plot -> highlights linked table rows
    assert.equal(graph.setWidgetPosition("scatter_mc", 220, 60), true);
    assert.equal(graph.setWidgetSize("scatter_mc", 240, 160), true);
    assert.equal(graph.setWidgetTether("scatter_mc", { x: 130, y: 90, label: "tank1.T" }), true);

    const brushed = graph.brushPlotWidget("scatter_mc", { x0: 220, y0: 60, x1: 460, y1: 220 });
    assert.equal(brushed.indices.length, 3);
    assert.deepEqual(brushed.linkedIds, ["REQ-001", "REQ-014", "REQ-022"]);
    const tableWidget = graph.getCanvasWidgets().find((w) => w.id === "req_table");
    assert.deepEqual(tableWidget?.table?.highlightedRowIds, ["REQ-001", "REQ-014", "REQ-022"]);
    graph.dispose();
  });

  test("compiles string children, fractional refX/refY, textVerticalAnchor, resolves port groups & prop(ports), and selects 20x20 Modelica nodes cleanly", () => {
    const glyph = compileGlyphMarkup([
      {
        tagName: "rect",
        selector: "body",
        attrs: { refWidth: 1, refHeight: 1 },
      },
      {
        tagName: "text",
        selector: "label",
        attrs: { refX: 0.5, refY: 0.5, textVerticalAnchor: "middle" },
        children: "R1",
      } as unknown as { tagName: string; selector: string; attrs: Record<string, string | number> },
    ]);
    assert.equal(glyph.roots[1]?.textContent, "R1");

    const svgChildren: Array<{ tag: string; attrs: Record<string, string>; text: string | null }> = [];
    const fakeDoc = {
      createElementNS: (_ns: string, tag: string) => {
        const attrs: Record<string, string> = {};
        const el = {
          tagName: tag,
          textContent: null as string | null,
          setAttribute: (k: string, v: string) => {
            attrs[k] = v;
          },
          setAttributeNS: (_ns2: string, k: string, v: string) => {
            attrs[k] = v;
          },
          getAttribute: (k: string) => attrs[k] ?? null,
          appendChild: (c: unknown) => {
            if (tag === "g" && c && typeof c === "object") {
              const childObj = c as { tagName: string; _attrs: Record<string, string>; textContent: string | null };
              svgChildren.push({ tag: childObj.tagName, attrs: childObj._attrs, text: childObj.textContent });
            }
          },
          _attrs: attrs,
        };
        return el;
      },
    } as unknown as Document;

    materializeGlyphToSvg(glyph, fakeDoc, 200, 100);
    const rectOut = svgChildren.find((c) => c.tag === "rect");
    const textOut = svgChildren.find((c) => c.tag === "text");
    assert.equal(rectOut?.attrs["width"], "200");
    assert.equal(rectOut?.attrs["height"], "100");
    assert.equal(rectOut?.attrs["magnet"], undefined);
    assert.equal(textOut?.attrs["x"], "100");
    assert.equal(textOut?.attrs["y"], "50");
    assert.equal(textOut?.attrs["dominant-baseline"], "central");
    assert.equal(textOut?.text, "R1");

    // 20x20 Modelica component: interior click selects node instead of port wiring; explicit pointerPortHit starts wiring
    const graph = new UnifiedGraph({ grid: 1 });
    const r1 = graph.addNode({
      id: "R1",
      x: 100,
      y: 100,
      width: 20,
      height: 20,
      ports: {
        groups: { left: { position: "left" }, right: { position: "right" } },
        items: [
          { id: "p", group: "left" },
          { id: "n", group: "right" },
        ],
      },
    });
    const r2 = graph.addNode({
      id: "R2",
      x: 200,
      y: 100,
      width: 20,
      height: 20,
      ports: [
        { id: "p", args: { x: 0, y: 10 } },
        { id: "n", args: { x: 20, y: 10 } },
      ],
    });

    assert.equal(r1.getPorts()[0]?.args?.x, 0);
    assert.equal(r1.getPorts()[0]?.args?.y, 10);
    assert.equal(r1.getPorts()[1]?.args?.x, 20);
    assert.equal(r1.getPorts()[1]?.args?.y, 10);

    // Click center of 20x20 R1 -> selects & enters dragging-nodes, NOT wiring
    graph.fsm.handleEvent({
      planeId: "primary",
      u: 110,
      v: 110,
      button: 0,
      buttons: 1,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      phase: "down",
    });
    assert.equal(graph.fsm.mode, "dragging-nodes");
    assert.deepEqual(
      graph.getSelectedCells().map((c) => c.id),
      ["R1"],
    );
    graph.fsm.handleEvent({
      planeId: "primary",
      u: 110,
      v: 110,
      button: 0,
      buttons: 0,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      phase: "up",
    });

    // Click port R1.n with explicit pointerPortHit and drag to R2.p -> connects edge
    graph.fsm.handleEvent({
      planeId: "primary",
      u: 120,
      v: 110,
      button: 0,
      buttons: 1,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      phase: "down",
      pointerPortHit: { nodeId: "R1", portId: "n" },
    });
    assert.equal(graph.fsm.mode, "wiring");
    graph.fsm.handleEvent({
      planeId: "primary",
      u: 200,
      v: 110,
      button: 0,
      buttons: 1,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      phase: "move",
    });
    graph.fsm.handleEvent({
      planeId: "primary",
      u: 200,
      v: 110,
      button: 0,
      buttons: 0,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      phase: "up",
    });
    assert.equal(graph.getEdges().length, 1);
    assert.equal(graph.getEdges()[0]?.getSource().cell, "R1");
    assert.equal(graph.getEdges()[0]?.getSource().port, "n");
    assert.equal(graph.getEdges()[0]?.getTarget().cell, "R2");
    assert.equal(graph.getEdges()[0]?.getTarget().port, "p");

    // prop("ports", ...) & setPortProp() update SoA scene ports
    r2.prop("ports", [{ id: "p", args: { x: 0, y: 5 } }]);
    assert.equal(graph.scene.getNodePorts("R2").length, 1);
    assert.equal(graph.scene.getNodePorts("R2")[0]?.localY, 5);
    r2.setPortProp("p", "args", { x: 0, y: 15 });
    assert.equal(graph.scene.getNodePorts("R2")[0]?.localY, 15);

    graph.dispose();
  });
});
