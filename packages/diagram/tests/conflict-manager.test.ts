// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { ConflictManager } from "../src/properties/conflict-manager.js";

describe("Properties ConflictManager (3-Way Bidirectional Sync)", () => {
  it("initializes baseline state as clean", () => {
    const cm = new ConflictManager();
    cm.reset({ R: "100", T: "293.15" });

    assert.strictEqual(cm.isFieldDirty("R"), false);
    assert.strictEqual(cm.isFieldDirty("T"), false);
    assert.strictEqual(cm.hasConflicts(), false);
    assert.strictEqual(cm.getLocalValue("R"), "100");
  });

  it("tracks local edits and marks fields dirty", () => {
    const cm = new ConflictManager();
    cm.reset({ R: "100" });

    const txId = cm.setLocalValue("R", "220");
    assert.ok(txId.startsWith("tx_"));
    assert.strictEqual(cm.isFieldDirty("R"), true);
    assert.strictEqual(cm.getLocalValue("R"), "220");
    assert.strictEqual(cm.hasConflicts(), false);
  });

  it("acknowledges self-echo transactions without marking conflicts", () => {
    const cm = new ConflictManager();
    cm.reset({ R: "100" });

    const txId = cm.setLocalValue("R", "220");
    // Host reports document changed in response to our txId
    const res = cm.handleRemoteUpdate({ R: "220" }, txId);

    assert.strictEqual(res.newConflicts.length, 0);
    assert.strictEqual(cm.hasConflicts(), false);
    assert.strictEqual(cm.isFieldDirty("R"), false);
    assert.strictEqual(cm.getLocalValue("R"), "220");
  });

  it("quietly auto-syncs clean fields when external edits arrive", () => {
    const cm = new ConflictManager();
    cm.reset({ R: "100", T: "293.15" });

    // User didn't touch T, external code editor changed T to 300.15
    const res = cm.handleRemoteUpdate({ R: "100", T: "300.15" });

    assert.strictEqual(res.updatedKeys.includes("T"), true);
    assert.strictEqual(cm.getLocalValue("T"), "300.15");
    assert.strictEqual(cm.isFieldDirty("T"), false);
    assert.strictEqual(cm.hasConflicts(), false);
  });

  it("flags a collision when an external edit contradicts a local dirty edit", () => {
    const cm = new ConflictManager();
    cm.reset({ R: "100" });

    // User edited R locally to 220
    cm.setLocalValue("R", "220");

    // External text editor changed R to 150 without our txId
    const res = cm.handleRemoteUpdate({ R: "150" });

    assert.strictEqual(res.newConflicts.length, 1);
    assert.strictEqual(cm.hasConflicts(), true);
    const conflict = cm.getConflict("R");
    assert.ok(conflict);
    assert.strictEqual(conflict.baseValue, "100");
    assert.strictEqual(conflict.localValue, "220");
    assert.strictEqual(conflict.remoteValue, "150");

    // Resolving with 'accept_remote'
    cm.resolveConflict("R", "accept_remote");
    assert.strictEqual(cm.hasConflicts(), false);
    assert.strictEqual(cm.getLocalValue("R"), "150");
    assert.strictEqual(cm.isFieldDirty("R"), false);
  });

  it("resolves conflict with 'keep_local'", () => {
    const cm = new ConflictManager();
    cm.reset({ R: "100" });

    cm.setLocalValue("R", "220");
    cm.handleRemoteUpdate({ R: "150" });

    assert.strictEqual(cm.hasConflicts(), true);

    // Resolving with 'keep_local'
    cm.resolveConflict("R", "keep_local");
    assert.strictEqual(cm.hasConflicts(), false);
    assert.strictEqual(cm.getLocalValue("R"), "220");
    assert.strictEqual(cm.isFieldDirty("R"), true); // Remains dirty relative to new remote base
  });
});
