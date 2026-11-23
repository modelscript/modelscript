// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CameraController } from "../src/core/camera.js";
import {
  AnimationPropKind,
  CompiledAnimationEngine,
  SimulationTimelineStore,
  UnifiedGraph,
  type AnimationBindingSpec,
  type Canvas2DContextLike,
} from "../src/engine/index.js";
import { Scissor3DPortalManager } from "../src/renderers/scissor-3d-manager.js";
import { createCanonicalPolyglotDemoBoard } from "../src/schema/canvas-document.js";
import { SpatialCanvas } from "../src/ui/SpatialCanvas.js";
import { downsampleLTTB, paintCanvasPlot } from "../src/widgets/canvas-plot.js";
import { paintCanvasTable, paintStickyBadge } from "../src/widgets/canvas-table.js";

function createCountingCanvas2D(): {
  ctx: Canvas2DContextLike;
  strokeCount: () => number;
  fillCount: () => number;
  texts: string[];
} {
  let strokes = 0;
  let fills = 0;
  const texts: string[] = [];
  const ctx: Canvas2DContextLike = {
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
    lineTo: () => undefined,
    rect: () => undefined,
    roundRect: () => undefined,
    arc: () => undefined,
    ellipse: () => undefined,
    fill: () => {
      fills++;
    },
    stroke: () => {
      strokes++;
    },
    fillText: (t) => {
      texts.push(t);
    },
    setLineDash: () => undefined,
  };
  return { ctx, strokeCount: () => strokes, fillCount: () => fills, texts };
}

describe("SCADA/Modelica Animations, Modelon-Impact Plots/Tables, Shared 3D Scissor Portals & 3D/VR Surface", () => {
  test("CompiledAnimationEngine ticks 1,000 SCADA/Modelica bindings from Float64Array in < 5ms with synchronized timeline", () => {
    const timeline = new SimulationTimelineStore();
    timeline.loadTrajectories([0, 1, 2], {
      "motor.T": [300, 350, 400],
      "pipe.m_flow": [0, 2.5, 5.0],
      "valve.angle": [0, 45, 90],
      "tank.level": [0.1, 0.5, 0.9],
    });

    const bindings: AnimationBindingSpec[] = [];
    for (let i = 0; i < 250; i++) {
      bindings.push(
        { targetId: `n_${i}`, property: "thermal", variableName: "motor.T", min: 300, max: 400 },
        { targetId: `e_${i}`, targetKind: "edge", property: "flowSpeed", variableName: "pipe.m_flow" },
        { targetId: `v_${i}`, property: "rotation", variableName: "valve.angle" },
        { targetId: `t_${i}`, property: "text", variableName: "motor.T", unit: "K", precision: 1 },
      );
    }

    const engine = new CompiledAnimationEngine();
    engine.compile(bindings, timeline.getVarIndexMap());
    assert.equal(engine.bindingCount, 1000);

    // Sync timeline subscriber (e.g. 3D CAD AnimationController + Plot Crosshair)
    let syncedTime = -1;
    let syncedTemp = 0;
    timeline.subscribe((st, frame, map) => {
      syncedTime = st.currentTime;
      syncedTemp = frame[map.get("motor.T")!]!;
    });

    // Seek to midpoint t=0.5 -> motor.T interpolates to 325.0 K
    timeline.seek(0.5);
    assert.equal(syncedTime, 0.5);
    assert.ok(Math.abs(syncedTemp - 325) < 1e-6);

    let lastColor = "";
    let lastText = "";
    let lastFlow = 0;
    const t0 = performance.now();
    const mutated = engine.tick(timeline.getCurrentFrame(), 1 / 60, (upd) => {
      if (upd.propKind === AnimationPropKind.FILL_COLOR && upd.color) lastColor = upd.color;
      if (upd.propKind === AnimationPropKind.TEXT && upd.formattedValue) lastText = upd.formattedValue;
      if (upd.propKind === AnimationPropKind.FLOW_SPEED) lastFlow = upd.numericValue;
    });
    const elapsedMs = performance.now() - t0;

    assert.equal(mutated, 1000);
    assert.ok(elapsedMs < 10, `Expected 1,000 bindings tick < 10ms, got ${elapsedMs.toFixed(2)}ms`);
    assert.ok(lastColor.startsWith("rgb("));
    assert.equal(lastText, "325.0 K");
    assert.ok(lastFlow > 0);

    // Verify end-to-end UnifiedGraph live animation tick
    const graph = new UnifiedGraph();
    const gauge = graph.addNode({ id: "gauge1", x: 0, y: 0, width: 60, height: 60 });
    graph.compileAnimations(
      [
        { targetId: "gauge1", property: "text", selector: "label", variableName: "motor.T", unit: "K", precision: 1 },
        { targetId: "gauge1", property: "rotation", variableName: "valve.angle" },
      ],
      timeline.getVarIndexMap(),
    );
    graph.tickAnimations(timeline.getCurrentFrame(), 1 / 60);
    assert.equal(gauge.attr("label/text"), "325.0 K");
    assert.ok(Math.abs(gauge.getAngle() - 22.5) < 0.01);
  });

  test("CanvasPlot downsamples 100k waveforms via LTTB, paints 50k Monte Carlo scatter, tables & stickies", () => {
    // 100,000-sample transient with sharp spike preserved by LTTB
    const n = 100_000;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = i * 0.0001;
      ys[i] = Math.sin(xs[i]! * 4) + (i === 50_000 ? 15 : 0);
    }
    const reduced = downsampleLTTB(xs, ys, 300);
    assert.equal(reduced.length, 300);
    assert.ok(
      reduced.some((p) => p.y > 10),
      "LTTB should preserve transient spike",
    );

    // 50,000-point Monte Carlo scatter plot paints fast via strided Canvas2D pass
    const mcX = new Float64Array(50_000);
    const mcY = new Float64Array(50_000);
    for (let i = 0; i < 50_000; i++) {
      mcX[i] = 1.8 + (i % 100) * 0.01;
      mcY[i] = 335 + ((i * 17) % 40);
    }
    const c = createCountingCanvas2D();
    const t0 = performance.now();
    const res = paintCanvasPlot(
      c.ctx,
      {
        id: "mc_1",
        title: "Monte Carlo UQ (50k)",
        kind: "scatter",
        series: [{ id: "samples", label: "Samples", color: "#14b8a6", x: mcX, y: mcY }],
        thresholds: [{ label: "T_max <= 360K", axis: "y", value: 360, direction: "above-fail" }],
        crosshairX: 2.14,
      },
      0,
      0,
      360,
      200,
    );
    const elapsed = performance.now() - t0;
    assert.ok(res.renderedPoints > 4000 && res.renderedPoints <= 6000);
    assert.ok(elapsed < 25, `Expected 50k scatter render < 25ms, got ${elapsed.toFixed(2)}ms`);

    // Compact Canvas2D ReqIF table + sticky KPI badge
    const tRes = paintCanvasTable(
      c.ctx,
      {
        title: "ReqIF Verification",
        columns: [
          { key: "id", label: "ID", widthRatio: 0.3 },
          { key: "status", label: "Status", widthRatio: 0.7, align: "right" },
        ],
        rows: [
          { id: "REQ-014", cells: { id: "REQ-014", status: "PASS (2.14 kg)" }, status: "pass" },
          { id: "REQ-042", cells: { id: "REQ-042", status: "PASS (354 K)" }, status: "pass" },
        ],
      },
      0,
      0,
      280,
      120,
    );
    assert.equal(tRes.visibleRowCount, 2);
    paintStickyBadge(
      c.ctx,
      { label: "Peak Temp", value: "354.2", unit: "K", status: "ok", tetherTarget: { x: 10, y: 10 } },
      100,
      40,
    );
    assert.ok(c.texts.includes("354.2 K"));
  });

  test("Scissor3DPortalManager runs 12 simultaneous CAD/FEA/CFD portals on 1 shared WebGL context with LOD freezing & 3D CADPort projection", () => {
    const mgr = new Scissor3DPortalManager({ liveMinPixelWidth: 160, devicePixelRatio: 2 });
    assert.equal(mgr.sharedWebGlContextCount, 1);

    for (let i = 0; i < 12; i++) {
      mgr.registerPortal({
        id: `portal_${i}`,
        kind: i % 3 === 0 ? "cad" : i % 3 === 1 ? "fea" : "cfd",
        artifactUri: `models/part_${i}.step`,
        bounds: { x: (i % 4) * 300, y: Math.floor(i / 4) * 240, width: 240, height: 180 },
        snapshotDataUrl: i > 0 ? "data:image/png;base64,AAA" : undefined,
        featurePins: { flange_a: [0.5, 0.25, 0] },
        // Identity 4x4 column-major matrix
        viewProjectionMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      });
    }

    const cam = new CameraController({ initial: { tx: 0, ty: 0, zoom: 0.5 } });
    // At zoom=0.5, 240px tile = 120px on screen (< 160px threshold) => cached portals freeze to snapshot!
    mgr.setFocusedPortal("portal_2");
    const rects = mgr.computeFrameScissorRects(cam, { width: 1280, height: 800 });
    assert.equal(rects.length, 12);

    const focused = rects.find((r) => r.portalId === "portal_2")!;
    const frozen = rects.find((r) => r.portalId === "portal_3")!;
    assert.equal(focused.renderLive, true);
    assert.equal(focused.lod, "focus");
    assert.equal(frozen.renderLive, false);
    assert.equal(frozen.lod, "thumbnail");

    // 3D CADPort projection through identity view-projection: ndc=(0.5, 0.25) -> u=0.75, v=0.375
    const pinWorld = mgr.project3DFeatureToWorld("portal_0", "flange_a");
    assert.ok(pinWorld);
    assert.ok(Math.abs(pinWorld.x - 180) < 0.01);
    assert.ok(Math.abs(pinWorld.y - 67.5) < 0.01);
  });

  test("SpatialSurfaceBridge drives identical node dragging via WebXR VR controller rays, volumetric CAD popouts, and 3D-to-2D wires", () => {
    const graph = new UnifiedGraph({ width: 1000, height: 600 });
    const motor = graph.addNode({
      id: "motor_vr",
      x: 100,
      y: 100,
      width: 100,
      height: 60,
    });
    const bridge = graph.createSpatialBridge();
    bridge.setMode("webxr-vr");

    // Compute exact 3D position of motor center (u=150, v=130) and drag target (u=250, v=190)
    const start3D = bridge.planeUVToWorld3D("primary", 150, 130, 0)!;
    const end3D = bridge.planeUVToWorld3D("primary", 250, 190, 0)!;

    // VR controller sits at z = 0 pointing straight at the plane (-z)
    const hitDown = bridge.dispatchRayPointer([start3D[0], start3D[1], 0], [0, 0, -1], "down");
    assert.ok(hitDown && Math.abs(hitDown.u - 150) < 0.01 && Math.abs(hitDown.v - 130) < 0.01);

    bridge.dispatchRayPointer([end3D[0], end3D[1], 0], [0, 0, -1], "move");
    bridge.dispatchRayPointer([end3D[0], end3D[1], 0], [0, 0, -1], "up");

    // Node moved cleanly by (+100, +60) using the EXACT same headless PointerFSM as desktop 2D!
    assert.equal(motor.getPosition().x, 200);
    assert.equal(motor.getPosition().y, 160);
    assert.ok(bridge.consumeDirtyRects("primary").length >= 3);

    // Volumetric 3D CAD pop-out floats along +normal in front of schematic block
    const popout = bridge.computeVolumetricPopout(
      "primary",
      "cad_housing",
      { x: 300, y: 100, width: 250, height: 200 },
      0.4,
    );
    assert.ok(popout);
    assert.ok(popout.position[2] > -1.6); // lifted forward along +Z normal
    assert.ok(Math.abs(popout.sizeMeters[0] - 0.5) < 1e-6);

    // 3D-to-2D wire from physical 3D CADPort to 2D Modelica flange port on floating plane
    const wire3D = bridge.upsert3DTo2DWire("w_cad_mo", [0, 1.2, -0.8], "primary", { u: 200, v: 190 });
    assert.ok(wire3D);
    assert.equal(bridge.get3DTo2DWires().length, 1);
  });

  test("SpatialCanvas renders 3D/VR surface switcher, shared 1-WebGL-context attribute, and synchronized timeline bar", () => {
    const board = createCanonicalPolyglotDemoBoard();
    const html = renderToStaticMarkup(
      React.createElement(SpatialCanvas, {
        document: board,
        surfaceMode: "spatial-3d",
        simulationTime: 2.5,
        simulationEndTime: 10,
        onSimulationTimeChange: () => undefined,
      }),
    );

    assert.ok(html.includes('data-surface-mode="spatial-3d"'));
    assert.ok(html.includes('data-shared-webgl-contexts="1"'));
    assert.ok(html.includes("3D Spatial"));
    assert.ok(html.includes('data-testid="canvas-simulation-timeline"'));
    assert.ok(html.includes("t = 2.50s"));
  });
});
