// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearInitialSnapshot,
  getInitialSnapshot,
  isInitialSnapshotValue,
  loadInitialSnapshotFromJson,
  setInitialSnapshot,
  subscribeInitialSnapshot,
  type InitialSnapshotValue,
} from "../src/workbench/util/initial-snapshot-store.js";

describe("@modelscript/editor initial-snapshot-store", () => {
  it("sets, reads, and clears typed initial snapshots", () => {
    clearInitialSnapshot();
    assert.equal(getInitialSnapshot(), undefined);

    const recordSnap: InitialSnapshotValue = { time: 1.25, states: { x: 4.2 } };
    setInitialSnapshot(recordSnap);
    assert.deepEqual(getInitialSnapshot(), recordSnap);

    setInitialSnapshot("raw-snapshot-payload");
    assert.equal(getInitialSnapshot(), "raw-snapshot-payload");

    clearInitialSnapshot();
    assert.equal(getInitialSnapshot(), undefined);
  });

  it("notifies subscribers on change and respects unsubscribe", () => {
    clearInitialSnapshot();
    const observed: Array<InitialSnapshotValue | undefined> = [];
    const unsubscribe = subscribeInitialSnapshot((snap) => {
      observed.push(snap);
    });

    const first = { time: 0.5 };
    setInitialSnapshot(first);
    // Setting the same reference is a no-op
    setInitialSnapshot(first);
    clearInitialSnapshot();
    // Clearing when already cleared is a no-op
    clearInitialSnapshot();

    unsubscribe();
    setInitialSnapshot({ time: 2.0 });
    clearInitialSnapshot();

    assert.deepEqual(observed, [first, undefined]);
  });

  it("loads valid JSON snapshots and clears on invalid JSON or unsupported types", () => {
    clearInitialSnapshot();

    const loadedObj = loadInitialSnapshotFromJson('{"time": 3.5, "vars": {"v": 1}}');
    assert.deepEqual(loadedObj, { time: 3.5, vars: { v: 1 } });
    assert.deepEqual(getInitialSnapshot(), loadedObj);

    const loadedStr = loadInitialSnapshotFromJson('"snapshot-v1"');
    assert.equal(loadedStr, "snapshot-v1");
    assert.equal(getInitialSnapshot(), "snapshot-v1");

    // Malformed JSON clears existing snapshot
    assert.equal(loadInitialSnapshotFromJson("{not valid json"), undefined);
    assert.equal(getInitialSnapshot(), undefined);

    // Unsupported JSON primitives/arrays clear existing snapshot
    setInitialSnapshot({ time: 1 });
    assert.equal(loadInitialSnapshotFromJson("[1, 2, 3]"), undefined);
    assert.equal(getInitialSnapshot(), undefined);

    setInitialSnapshot({ time: 1 });
    assert.equal(loadInitialSnapshotFromJson("42"), undefined);
    assert.equal(getInitialSnapshot(), undefined);

    assert.equal(isInitialSnapshotValue(null), false);
    assert.equal(isInitialSnapshotValue([]), false);
    assert.equal(isInitialSnapshotValue("ok"), true);
    assert.equal(isInitialSnapshotValue({ a: 1 }), true);
  });
});
