// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { CollabManager } from "../src/collab-manager.js";
import { CollabOverlayRenderer } from "../src/collab-overlay.js";
import type { CollabMessage } from "../src/protocol.js";

describe("Collaborative Diagram Protocol & CollabManager", () => {
  test("broadcasts presence and tracks peer cursors", () => {
    const broadcasted: CollabMessage[] = [];
    const alice = new CollabManager({
      peerId: "alice",
      userName: "Alice",
      userColor: "#4ec9b0",
      onBroadcast: (msg) => broadcasted.push(msg),
    });

    alice.updateLocalPresence({
      cursor: { x: 120, y: 340 },
      selection: ["battery", "motor"],
    });

    assert.equal(broadcasted.length, 2); // 1 lock, 1 presence
    const presenceMsg = broadcasted.find((m) => m.type === "presence");
    assert.ok(presenceMsg && presenceMsg.type === "presence");
    assert.equal(presenceMsg.presence.cursor?.x, 120);
    assert.equal(presenceMsg.presence.cursor?.y, 340);

    // Bob receives presence
    const bob = new CollabManager({
      peerId: "bob",
      userName: "Bob",
    });

    bob.handleInboundMessage(presenceMsg);
    const bobPeers = bob.getActivePeers();
    assert.equal(bobPeers.length, 1);
    assert.equal(bobPeers[0]?.peerId, "alice");
    assert.equal(bobPeers[0]?.cursor?.x, 120);

    alice.dispose();
    bob.dispose();
  });

  test("manages selection locks and prevents visual race conditions", () => {
    const bob = new CollabManager({ peerId: "bob", userName: "Bob" });

    // Alice locks "Battery"
    bob.handleInboundMessage({
      type: "selectionLock",
      lock: {
        peerId: "alice",
        peerName: "Alice",
        color: "#4ec9b0",
        componentNames: ["Battery"],
        timestamp: Date.now(),
      },
    });

    const lock = bob.getComponentLock("Battery");
    assert.ok(lock);
    assert.equal(lock.peerId, "alice");
    assert.equal(lock.peerName, "Alice");
    assert.equal(lock.color, "#4ec9b0");

    assert.equal(bob.getComponentLock("Motor"), undefined);
    bob.dispose();
  });

  test("resolves concurrent spatial deltas using Last-Write-Wins (LWW)", () => {
    const bob = new CollabManager({ peerId: "bob", userName: "Bob" });

    // Delta 1 from Alice at t=100
    bob.handleInboundMessage({
      type: "spatialDelta",
      delta: {
        peerId: "alice",
        timestamp: 100,
        items: [{ name: "Inverter", x: 50, y: 60, width: 80, height: 40 }],
      },
    });

    assert.equal(bob.getComponentOverride("Inverter")?.x, 50);

    // Newer delta at t=200
    bob.handleInboundMessage({
      type: "spatialDelta",
      delta: {
        peerId: "charlie",
        timestamp: 200,
        items: [{ name: "Inverter", x: 150, y: 160, width: 80, height: 40 }],
      },
    });

    assert.equal(bob.getComponentOverride("Inverter")?.x, 150);

    // Stale delta at t=150 should NOT override t=200
    bob.handleInboundMessage({
      type: "spatialDelta",
      delta: {
        peerId: "alice",
        timestamp: 150,
        items: [{ name: "Inverter", x: 80, y: 90, width: 80, height: 40 }],
      },
    });

    assert.equal(bob.getComponentOverride("Inverter")?.x, 150);
    bob.dispose();
  });

  test("manages sticky note comments and renders SVG overlay", () => {
    const manager = new CollabManager({
      peerId: "alice",
      userName: "Alice",
      userColor: "#ff9800",
    });

    const comment = manager.addComment("Check thermal dissipation here", 200, 150);
    assert.equal(manager.getAllComments().length, 1);
    assert.equal(manager.getAllComments()[0]?.text, "Check thermal dissipation here");

    // Add peer cursor
    manager.handleInboundMessage({
      type: "presence",
      presence: {
        peerId: "bob",
        name: "Bob",
        color: "#007acc",
        cursor: { x: 300, y: 400 },
        lastActive: Date.now(),
      },
    });

    // Render SVG overlay
    const svg = CollabOverlayRenderer.renderSvgOverlay(manager);
    assert.match(svg, /class="collab-peer-cursor"/);
    assert.match(svg, /Bob/);
    assert.match(svg, /Check thermal dissipation here/);

    // Resolve comment
    manager.resolveComment(comment.id);
    assert.equal(manager.getAllComments().length, 0);

    manager.dispose();
  });
});
