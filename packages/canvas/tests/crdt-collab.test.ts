// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { CanvasCrdtStore } from "../src/collab/crdt-store.js";
import { createCanonicalPolyglotDemoBoard } from "../src/schema/canvas-document.js";
import { serializeCanvasDocument } from "../src/schema/serializer.js";

describe("Multiplayer CanvasCrdtStore Convergence & Presence", () => {
  test("converges deterministically under concurrent edits and out-of-order/duplicate deltas", () => {
    const base = createCanonicalPolyglotDemoBoard();
    const alice = new CanvasCrdtStore("peer_alice", base);
    const bob = new CanvasCrdtStore("peer_bob", base);
    const carol = new CanvasCrdtStore("peer_carol", base);

    // Concurrent edits on the same tile + different tiles
    const dAliceMove = alice.moveTile("tile_modelica", 650, 150)!;
    const dBobMove = bob.moveTile("tile_modelica", 720, 180)!;
    const dBobWire = bob.upsertWire({
      id: "wire_thermal_pcb",
      kind: "shared-parameter",
      source: { tileId: "tile_kicad", anchorPath: "board.R_th" },
      target: { tileId: "tile_modelica", anchorPath: "thermal.T_max" },
      origin: "user-authored",
      status: "synced",
    });
    const dCarolMove = carol.moveTile("tile_step", 640, 660)!;

    // Deliver deltas in different orders (and with duplicates) to each peer
    alice.mergeDelta(dCarolMove);
    alice.mergeDelta(dBobMove);
    alice.mergeDelta(dBobWire);
    alice.mergeDelta(dBobMove); // duplicate

    bob.mergeDelta(dAliceMove);
    bob.mergeDelta(dCarolMove);

    carol.mergeDelta(dBobWire);
    carol.mergeDelta(dAliceMove);
    carol.mergeDelta(dBobMove);

    const sAlice = serializeCanvasDocument(alice.toDocument());
    const sBob = serializeCanvasDocument(bob.toDocument());
    const sCarol = serializeCanvasDocument(carol.toDocument());

    assert.equal(sAlice, sBob);
    assert.equal(sBob, sCarol);
    // Tie-breaker: clock=1 for both Alice & Bob, "peer_bob" > "peer_alice"
    assert.equal(alice.toDocument().tiles.tile_modelica?.bounds.x, 720);
    assert.ok(alice.toDocument().wires.wire_thermal_pcb);
  });

  test("tracks multiplayer cursors, active peer timeouts, and soft selection locks", () => {
    const store = new CanvasCrdtStore("peer_local");
    const now = 1_000_000;

    store.updatePeerPresence({
      peerId: "peer_remote",
      userName: "Dr. Chen",
      color: "#4ec9b0",
      cursor: { x: 420, y: 280 },
      selection: ["tile_step"],
      activeTool: "Orbiting STEP",
      lastActiveMs: now,
    });

    assert.equal(store.getActivePeers(now + 2000).length, 1);
    assert.equal(store.getTileLockOwner("tile_step", now + 2000)?.userName, "Dr. Chen");
    assert.equal(store.getTileLockOwner("tile_modelica", now + 2000), undefined);

    // Stale peer expires cleanly after timeout
    assert.equal(store.getActivePeers(now + 20000, 15000).length, 0);
  });
});
