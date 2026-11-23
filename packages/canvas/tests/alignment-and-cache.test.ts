// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { CanvasCrdtStore } from "../src/collab/crdt-store.js";
import { CanvasIndexedDbCache } from "../src/collab/indexeddb-cache.js";
import { computeSnapAndGuides } from "../src/core/alignment-guides.js";
import { createCanonicalPolyglotDemoBoard } from "../src/schema/canvas-document.js";

describe("Smart Alignment Snap Guides & Offline IndexedDB Cache", () => {
  test("snaps dragged tile edges to neighboring tile and emits vertical/horizontal guide lines", () => {
    const others = [
      { bounds: { x: 100, y: 100, width: 400, height: 300 } },
      { bounds: { x: 600, y: 500, width: 400, height: 300 } },
    ];

    // Dragging near x=104 (within 10px of x=100) and y=495 (within 10px of y=500)
    const snapped = computeSnapAndGuides({ x: 104, y: 495, width: 320, height: 240 }, others, 10);

    assert.equal(snapped.x, 100);
    assert.equal(snapped.y, 500);
    assert.equal(snapped.guides.length, 2);
    assert.equal(snapped.guides[0]?.orientation, "vertical");
    assert.equal(snapped.guides[0]?.position, 100);
    assert.equal(snapped.guides[1]?.orientation, "horizontal");
    assert.equal(snapped.guides[1]?.position, 500);
  });

  test("persists and restores CanvasCrdtStore deltas via CanvasIndexedDbCache fallback", async () => {
    const cache = new CanvasIndexedDbCache();
    const board = createCanonicalPolyglotDemoBoard();
    const store = new CanvasCrdtStore("peer_1", board);
    store.moveTile("tile_modelica", 888, 222);

    await cache.save(board.id, store.exportFullDelta());
    const loaded = await cache.load(board.id);
    assert.ok(loaded);

    const restored = new CanvasCrdtStore("peer_2");
    restored.mergeDelta(loaded);
    assert.equal(restored.toDocument().tiles.tile_modelica?.bounds.x, 888);

    await cache.clear(board.id);
    assert.equal(await cache.load(board.id), null);
  });
});
