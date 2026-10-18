// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { CollaborationDocumentSession, CollaborationSessionManager } from "../src/services/collaboration-session.js";

test("Phase 4: Real-Time Collaborative Co-Editing & Symbol Presence Service", async (t) => {
  await t.test("1. Peer presence join, cursor tracking, and leave lifecycle", () => {
    const manager = new CollaborationSessionManager();
    const session = manager.getOrCreateSession(
      "file:///workspace/Powertrain.mo",
      "model Powertrain\n  Real v = 10.0;\nend Powertrain;\n",
    );

    const alice = session.joinPeer({
      peerId: "peer-alice",
      displayName: "Alice (Thermal)",
      cursorOffset: 5,
    });
    const bob = session.joinPeer({
      peerId: "peer-bob",
      displayName: "Bob (Controls)",
      cursorOffset: 20,
    });

    assert.equal(session.getPeers().length, 2);
    assert.notEqual(alice.color, bob.color, "Peers should receive distinct default palette colors");

    session.leavePeer("peer-alice");
    assert.equal(session.getPeers().length, 1);
    assert.equal(session.getPeers()[0]?.peerId, "peer-bob");
  });

  await t.test("2. Operational Transformation (OT) converges concurrent edits at identical baseVersion", () => {
    const initialSource = "model Battery\n  parameter Real V = 400.0;\n  parameter Real R = 0.05;\nend Battery;";
    const session = new CollaborationDocumentSession("file:///workspace/Battery.mo", initialSource, 0);

    session.joinPeer({ peerId: "alice", displayName: "Alice" });
    session.joinPeer({ peerId: "bob", displayName: "Bob" });

    // Both Alice and Bob start from baseVersion = 0:
    // Alice replaces "400.0" with "450.0" at offset [35, 40]
    const vStart = initialSource.indexOf("400.0");
    const rStart = initialSource.indexOf("0.05");

    const res1 = session.applyOperation({
      id: "op-alice-1",
      peerId: "alice",
      baseVersion: 0,
      startOffset: vStart,
      endOffset: vStart + 5,
      insertText: "450.00", // +1 character longer than "400.0"
    });
    assert.equal(res1.version, 1);

    // Bob concurrently (still at baseVersion = 0!) replaces "0.05" with "0.025" at original offset [rStart, rStart + 4]
    const res2 = session.applyOperation({
      id: "op-bob-1",
      peerId: "bob",
      baseVersion: 0,
      startOffset: rStart,
      endOffset: rStart + 4,
      insertText: "0.025",
    });

    assert.equal(res2.version, 2);
    assert.equal(
      res2.appliedOp.transformedStartOffset,
      rStart + 1,
      "Bob's edit offset must be shifted by +1 due to Alice's prior longer insertion",
    );
    assert.equal(
      session.content,
      "model Battery\n  parameter Real V = 450.00;\n  parameter Real R = 0.025;\nend Battery;",
    );
  });

  await t.test("3. Symbol-granularity collision detection warns when two peers edit the same symbol", () => {
    const source = [
      "package EV",
      "  model Inverter",
      "    parameter Real f_sw = 10000.0;",
      "  end Inverter;",
      "  model Motor",
      "    parameter Real J = 0.12;",
      "  end Motor;",
      "end EV;",
    ].join("\n");

    const session = new CollaborationDocumentSession("file:///workspace/EV.mo", source, 0);
    const invStart = source.indexOf("model Inverter");
    const invEnd = source.indexOf("end Inverter;") + "end Inverter;".length;
    const motStart = source.indexOf("model Motor");
    const motEnd = source.indexOf("end Motor;") + "end Motor;".length;

    session.setSymbolSpans([
      { name: "Inverter", kind: "model", startByte: invStart, endByte: invEnd },
      { name: "Motor", kind: "model", startByte: motStart, endByte: motEnd },
    ]);

    // Alice places cursor in Inverter, Bob places cursor in Motor -> no collision
    session.joinPeer({ peerId: "alice", displayName: "Alice", cursorOffset: invStart + 10 });
    session.joinPeer({ peerId: "bob", displayName: "Bob", cursorOffset: motStart + 10 });
    assert.equal(session.detectSymbolCollisions().length, 0);

    // Bob moves cursor into Inverter -> collision detected on symbol 'Inverter'!
    const { collisions } = session.updatePresence("bob", { cursorOffset: invStart + 25 });
    assert.equal(collisions.length, 1);
    assert.equal(collisions[0]!.symbolName, "Inverter");
    assert.equal(collisions[0]!.peers.length, 2);
    assert.ok(collisions[0]!.message.includes("Inverter"));
    assert.ok(collisions[0]!.message.includes("Alice"));
    assert.ok(collisions[0]!.message.includes("Bob"));
  });
});
