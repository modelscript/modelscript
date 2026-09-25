// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { PolyglotTransformer, type PolyglotNode } from "../src/interop/polyglot-transformer.js";

const expect = (val: any) => ({
  toBe: (expected: any) => assert.strictEqual(val, expected),
  toEqual: (expected: any) => assert.deepStrictEqual(val, expected),
  toBeDefined: () => assert.notStrictEqual(val, undefined),
  toBeUndefined: () => assert.strictEqual(val, undefined),
  toBeGreaterThan: (n: number) => assert.ok(val > n),
  toHaveLength: (n: number) => assert.strictEqual(val?.length, n),
  toContain: (str: string) => assert.ok(String(val).includes(str)),
});

describe("Incremental TGG & Semantic Theory Coordinator Synchronization", () => {
  it("should incrementally assert and satisfy TGG correspondence invariants into the Digital Thread Hypergraph", () => {
    const transformer = new PolyglotTransformer();
    const hypergraph = transformer.getHypergraph();

    const sysmlNode: PolyglotNode = {
      name: "ChassisPart",
      kind: "part def",
      attributes: [{ name: "mass", type: "Real", value: "15.0" }],
    };
    const modelicaNode: PolyglotNode = {
      name: "ChassisInertia",
      kind: "model",
      attributes: [{ name: "m", type: "Real", value: "15.0" }],
    };

    transformer.registerThread("thread_101", {
      sysml2: sysmlNode,
      modelica: modelicaNode,
    });

    const slot = hypergraph.findSlotByThreadId(101)!;
    expect(slot).toBeDefined();

    // 1. Synchronize valid interval & equality constraints
    const satRes = transformer.syncThreadTheory(
      slot,
      [
        { kind: "interval", varName: "Chassis_mass", min: 10, max: 20 },
        { kind: "diff", varA: "t_arrival", varB: "t_departure", bound: 50 },
      ],
      "SyncChassisProperties",
    );

    expect(satRes.isSat).toBe(true);
    expect(hypergraph.isConflicted(slot)).toBe(false);
    expect(hypergraph.getConflict(slot)).toBeUndefined();
    const rec = hypergraph.getRecord(slot)!;
    expect(rec.isSynced).toBe(true);
  });

  it("should detect unsatisfiable TGG constraints, mark hypergraph slots as conflicted, and preserve conflict explanations", () => {
    const transformer = new PolyglotTransformer();
    const hypergraph = transformer.getHypergraph();

    transformer.registerThread("thread_102", {
      sysml2: { name: "Motor" },
      modelica: { name: "EMachine" },
    });

    const slot = hypergraph.findSlotByThreadId(102)!;
    expect(slot).toBeDefined();

    // 1. Assert contradictory temporal difference constraints:
    // (tB - tA <= 5) and (tA - tB <= -10) => negative cycle!
    const unsatRes = transformer.syncThreadTheory(
      slot,
      [
        { kind: "diff", varA: "tB", varB: "tA", bound: 5 },
        { kind: "diff", varA: "tA", varB: "tB", bound: -10 },
      ],
      "TemporalOrderingRule",
    );

    expect(unsatRes.isSat).toBe(false);
    expect(unsatRes.conflict).toBeDefined();
    expect(unsatRes.conflict?.explanation).toContain("Negative cycle detected in Octagon DBM");

    // Hypergraph status should be flagged as CONFLICT in linear memory
    expect(hypergraph.isConflicted(slot)).toBe(true);
    const recordedConflict = hypergraph.getConflict(slot);
    expect(recordedConflict).toBeDefined();
    expect(recordedConflict?.explanation).toContain("Negative cycle detected in Octagon DBM");

    // Conflict should also be recorded in transformer's conflict registry
    const conflicts = transformer.getConflicts();
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it("should support O(ΔN) incremental retraction and re-satisfaction without full reset", () => {
    const transformer = new PolyglotTransformer();
    const hypergraph = transformer.getHypergraph();

    transformer.registerThread("thread_103", {
      sysml2: { name: "Battery" },
      modelica: { name: "BatteryPack" },
    });

    const slot = hypergraph.findSlotByThreadId(103)!;

    // Step 1: Contradictory interval bounds: x in [0, 5] and x in [10, 20]
    const res1 = transformer.syncThreadTheory(
      slot,
      [
        { kind: "interval", varName: "V_cell", min: 0, max: 5 },
        { kind: "interval", varName: "V_cell", min: 10, max: 20 },
      ],
      "BatteryVoltageRule",
    );
    expect(res1.isSat).toBe(false);
    expect(hypergraph.isConflicted(slot)).toBe(true);

    // Step 2: Incremental edit — user corrects the second bound to [3, 4.2]
    // syncThreadTheory automatically retracts previous literals for slot 103
    const res2 = transformer.syncThreadTheory(
      slot,
      [
        { kind: "interval", varName: "V_cell", min: 0, max: 5 },
        { kind: "interval", varName: "V_cell", min: 3, max: 4.2 },
      ],
      "BatteryVoltageRule",
    );

    expect(res2.isSat).toBe(true);
    expect(hypergraph.isConflicted(slot)).toBe(false);
    expect(hypergraph.getConflict(slot)).toBeUndefined();
    expect(hypergraph.getRecord(slot)!.isSynced).toBe(true);
  });
});
