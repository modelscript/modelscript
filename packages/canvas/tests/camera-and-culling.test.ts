// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { CameraController } from "../src/core/camera.js";
import { CanvasCommandBus } from "../src/core/command-bus.js";
import { resolveTileLodTier, WebGlContextBudget } from "../src/core/lod-scheduler.js";
import { CanvasSpatialIndex } from "../src/core/spatial-index.js";
import { createCanonicalPolyglotDemoBoard, type CanvasTile } from "../src/schema/canvas-document.js";

describe("CameraController, SpatialIndex, LOD & CommandBus", () => {
  test("worldToScreen and screenToWorld round-trip accurately across zoom range", () => {
    const cam = new CameraController({ initial: { tx: 145.5, ty: -82.25, zoom: 0.42 } });
    const worldPt = { x: 1234.5, y: -678.25 };
    const screenPt = cam.worldToScreen(worldPt);
    const recovered = cam.screenToWorld(screenPt);
    assert.ok(Math.abs(recovered.x - worldPt.x) < 1e-9);
    assert.ok(Math.abs(recovered.y - worldPt.y) < 1e-9);
  });

  test("zoomAtScreenPoint keeps the world point under cursor stationary", () => {
    const cam = new CameraController({ initial: { tx: 40, ty: 60, zoom: 1.0 } });
    const cursor = { x: 512, y: 320 };
    const before = cam.screenToWorld(cursor);
    cam.zoomAtScreenPoint(2.75, cursor);
    const after = cam.screenToWorld(cursor);
    assert.ok(Math.abs(after.x - before.x) < 1e-9);
    assert.ok(Math.abs(after.y - before.y) < 1e-9);
  });

  test("CanvasSpatialIndex culls 500 tiles in O(K_visible) and hit-tests topmost zIndex", () => {
    const index = new CanvasSpatialIndex<CanvasTile>(512);
    for (let i = 0; i < 500; i++) {
      const col = i % 25;
      const row = Math.floor(i / 25);
      index.upsert({
        id: `t_${i}`,
        title: `Tile ${i}`,
        artifactUri: `models/m_${i}.mo`,
        languageId: "modelica",
        archetype: "schematic",
        bounds: { x: col * 600, y: row * 500, width: 400, height: 300 },
        zIndex: i,
      });
    }

    assert.equal(index.size, 500);

    // Query a 1200x1000 viewport at the origin — should only return the top-left 2x2 tiles
    const visible = index.queryRect({ x: 0, y: 0, width: 1100, height: 900 });
    assert.equal(visible.length, 4);
    assert.deepEqual(
      visible.map((t) => t.id),
      ["t_0", "t_1", "t_25", "t_26"],
    );

    // Overlap a higher-zIndex tile on top of t_0 and verify hitTestPoint returns topmost first
    index.upsert({
      id: "t_top",
      title: "Top Overlay",
      artifactUri: "cad/housing.step",
      languageId: "step",
      archetype: "cad3d",
      bounds: { x: 50, y: 50, width: 200, height: 200 },
      zIndex: 999,
    });
    const hits = index.hitTestPoint({ x: 100, y: 100 });
    assert.equal(hits[0]?.id, "t_top");
    assert.equal(hits[1]?.id, "t_0");
  });

  test("resolveTileLodTier enforces 4-tier LOD with hysteresis and focus override", () => {
    const tile = { id: "t1", bounds: { x: 0, y: 0, width: 440, height: 360 } };
    assert.equal(resolveTileLodTier(tile, 0.1), "macro");
    assert.equal(resolveTileLodTier(tile, 0.3), "thumbnail");
    assert.equal(resolveTileLodTier(tile, 0.8), "interactive");
    assert.equal(resolveTileLodTier(tile, 0.1, { focusedTileId: "t1" }), "focus");

    // Hysteresis: when already in thumbnail, zooming slightly above 0.45 (0.46) stays thumbnail
    assert.equal(resolveTileLodTier(tile, 0.46, { previousTier: "thumbnail" }), "thumbnail");
    assert.equal(resolveTileLodTier(tile, 0.5, { previousTier: "thumbnail" }), "interactive");
  });

  test("WebGlContextBudget caps active 3D contexts to 4 and evicts LRU", () => {
    const budget = new WebGlContextBudget(4);
    budget.acquire("step_1");
    budget.acquire("step_2");
    budget.acquire("step_3");
    budget.acquire("step_4");
    // Touch step_1 so step_2 becomes LRU
    budget.acquire("step_1");
    const alloc = budget.acquire("step_5");
    assert.deepEqual(alloc.evictedTileIds, ["step_2"]);
    assert.equal(budget.isLive("step_2"), false);
    assert.equal(budget.isLive("step_1"), true);
    assert.equal(budget.isLive("step_5"), true);
  });

  test("CanvasCommandBus supports atomic batches, cascade wire removal, and undo/redo", () => {
    const doc = createCanonicalPolyglotDemoBoard();
    const bus = new CanvasCommandBus(doc);

    bus.execute({ type: "moveTiles", moves: { tile_modelica: { x: 700, y: 200 } } });
    assert.equal(bus.getDocument().tiles.tile_modelica?.bounds.x, 700);

    // Deleting tile_simulink should cascade-delete FMI wires attached to it
    bus.execute({ type: "removeTiles", tileIds: ["tile_simulink"] });
    assert.equal(bus.getDocument().tiles.tile_simulink, undefined);
    assert.equal(bus.getDocument().wires.wire_fmi_cmd, undefined);

    // Undo restores both tile and wires
    bus.undo();
    assert.ok(bus.getDocument().tiles.tile_simulink);
    assert.ok(bus.getDocument().wires.wire_fmi_cmd);

    // Redo reapplies deletion
    bus.redo();
    assert.equal(bus.getDocument().tiles.tile_simulink, undefined);
  });
});
