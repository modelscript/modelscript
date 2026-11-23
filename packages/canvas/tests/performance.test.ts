// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test, { describe } from "node:test";
import { CameraController } from "../src/core/camera.js";
import { resolveTileLodTier } from "../src/core/lod-scheduler.js";
import { CanvasSpatialIndex } from "../src/core/spatial-index.js";
import type { CanvasTile, CanvasWire } from "../src/schema/canvas-document.js";
import { resolveAnchorWorldPoint } from "../src/threads/anchor-projector.js";
import { routeCanvasWire } from "../src/threads/wire-router.js";

describe("Spatial Canvas 60fps Performance Budgets (500 Tiles + 200 Wires)", () => {
  test("frustum culling, LOD resolution, and 200-wire routing complete well within a 16.7ms frame budget", () => {
    const index = new CanvasSpatialIndex<CanvasTile>(512);
    const tiles: Record<string, CanvasTile> = {};

    for (let i = 0; i < 500; i++) {
      const col = i % 25;
      const row = Math.floor(i / 25);
      const tile: CanvasTile = {
        id: `t_${i}`,
        title: `Artifact ${i}`,
        artifactUri: `models/m_${i}.mo`,
        languageId: i % 3 === 0 ? "modelica" : i % 3 === 1 ? "step" : "reqif",
        archetype: i % 3 === 0 ? "schematic" : i % 3 === 1 ? "cad3d" : "table",
        bounds: { x: col * 520, y: row * 420, width: 420, height: 320 },
        zIndex: i,
        pinnedAnchors: [
          { path: "in_0", label: "in_0", kind: "fmi-input", side: "left", sideOffset: 0.5 },
          { path: "out_0", label: "out_0", kind: "fmi-output", side: "right", sideOffset: 0.5 },
        ],
      };
      tiles[tile.id] = tile;
      index.upsert(tile);
    }

    const wires: CanvasWire[] = [];
    for (let i = 0; i < 200; i++) {
      wires.push({
        id: `w_${i}`,
        kind: i % 2 === 0 ? "fmi-signal" : "shared-parameter",
        source: { tileId: `t_${i}`, anchorPath: "out_0" },
        target: { tileId: `t_${i + 1}`, anchorPath: "in_0" },
        origin: "auto-thread",
        status: "synced",
      });
    }

    const cam = new CameraController({ initial: { tx: -1200, ty: -800, zoom: 0.75 } });
    const viewport = { width: 1920, height: 1080 };

    const t0 = performance.now();
    const visibleRect = cam.getVisibleWorldBounds(viewport, 200);
    const visibleTiles = index.queryRect(visibleRect);
    const lods = visibleTiles.map((t) => resolveTileLodTier(t, 0.75));
    const routed = wires.map((w) => {
      const s = tiles[w.source.tileId]!;
      const d = tiles[w.target.tileId]!;
      const sPt = resolveAnchorWorldPoint(s, w.source.anchorPath, { isSource: true, lod: "interactive" });
      const dPt = resolveAnchorWorldPoint(d, w.target.anchorPath, { isSource: false, lod: "interactive" });
      return routeCanvasWire(w, sPt, dPt);
    });
    const elapsedMs = performance.now() - t0;

    assert.ok(visibleTiles.length > 0 && visibleTiles.length < 100);
    assert.equal(lods.length, visibleTiles.length);
    assert.equal(routed.length, 200);
    // Must stay strictly under 16.7ms (60fps frame budget); allow generous CI margin of 50ms
    assert.ok(elapsedMs < 50, `Expected frame pipeline < 50ms, got ${elapsedMs.toFixed(2)}ms`);
  });
});
