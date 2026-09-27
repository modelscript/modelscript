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

  it("should evaluate TGG rules with where clauses and proxy variables via syncThreadRule()", () => {
    const transformer = new PolyglotTransformer();
    const hypergraph = transformer.getHypergraph();

    transformer.registerThread("thread_104", {
      sysml2: { name: "ActuatorSysML" },
      modelica: { name: "ActuatorModelica" },
    });

    const slot = hypergraph.findSlotByThreadId(104)!;
    expect(slot).toBeDefined();

    const actuatorRule = {
      name: "ActuatorCorrespondenceRule",
      source: () => ({ nodeType: "PartDef", bindings: {} }),
      target: () => ({ nodeType: "Model", bindings: {} }),
      where: (v: (name: string) => string) => [
        { kind: "eq", args: [v("stroke_sysml"), v("stroke_modelica")] },
        {
          kind: "reconcilePhysics",
          args: [v("force_sysml"), v("force_modelica"), { min: 0, max: 1000, tolerance: 0.01 }],
        },
      ],
    };

    const satRes = transformer.syncThreadRule(slot, actuatorRule as any, {
      stroke_sysml: "Actuator_stroke_sys",
      stroke_modelica: "Actuator_stroke_mo",
      force_sysml: "Actuator_force_sys",
      force_modelica: "Actuator_force_mo",
    });

    expect(satRes.isSat).toBe(true);
    expect(hypergraph.isConflicted(slot)).toBe(false);
    expect(hypergraph.getRecord(slot)!.isSynced).toBe(true);

    const litIds = transformer.getLiteralIdsForThreadSlot(slot);
    expect(litIds.length).toBeGreaterThan(0);
    for (const litId of litIds) {
      expect(transformer.getThreadSlotForLiteralId(litId)).toBe(slot);
    }
  });

  it("should incrementally reconcile domain nodes in O(ΔN) via reconcileNode() without affecting clean nodes", () => {
    const transformer = new PolyglotTransformer();
    const hypergraph = transformer.getHypergraph();

    transformer.registerThread("thread_105", {
      sysml2: { id: 201, name: "SubsystemA" },
      modelica: { id: 202, name: "SubsystemA_Sim" },
    });

    transformer.registerThread("thread_106", {
      sysml2: { id: 203, name: "SubsystemB" },
      modelica: { id: 204, name: "SubsystemB_Sim" },
    });

    const slot1 = hypergraph.findSlotByThreadId(105)!;
    const slot2 = hypergraph.findSlotByThreadId(106)!;

    // Both start synced with valid constraints
    transformer.syncThreadTheory(slot1, [{ kind: "interval", varName: "tempA", min: 20, max: 80 }]);
    transformer.syncThreadTheory(slot2, [{ kind: "interval", varName: "tempB", min: 10, max: 50 }]);

    expect(hypergraph.getRecord(slot1)!.isSynced).toBe(true);
    expect(hypergraph.getRecord(slot2)!.isSynced).toBe(true);

    // Edit SubsystemA to have contradictory bounds [80, 20]
    const editRes = transformer.reconcileNode("sysml2", 201, [
      { kind: "interval", varName: "tempA", min: 80, max: 20 },
    ]);
    expect(editRes?.isSat).toBe(false);
    expect(hypergraph.isConflicted(slot1)).toBe(true);

    // SubsystemB must be completely unaffected in O(ΔN)
    expect(hypergraph.isConflicted(slot2)).toBe(false);
    expect(hypergraph.getRecord(slot2)!.isSynced).toBe(true);

    // Fix SubsystemA
    const fixRes = transformer.reconcileNode("sysml2", 201, [{ kind: "interval", varName: "tempA", min: 20, max: 80 }]);
    expect(fixRes?.isSat).toBe(true);
    expect(hypergraph.isConflicted(slot1)).toBe(false);
    expect(hypergraph.getRecord(slot1)!.isSynced).toBe(true);
  });

  it("should track blast radius invalidation and notify hypergraph status listeners", () => {
    const transformer = new PolyglotTransformer();
    const hypergraph = transformer.getHypergraph();

    const events: any[] = [];
    const unsubscribe = hypergraph.addListener((evt) => events.push(evt));

    // Register connected digital threads across SysML, Modelica, and CFD
    transformer.registerThread("thread_107", {
      sysml2: { id: 301, name: "PumpComponent" },
      modelica: { id: 302, name: "PumpHydraulic" },
    });

    transformer.registerThread("thread_108", {
      modelica: { id: 302, name: "PumpHydraulic" },
      cfd: { id: 303, name: "PumpVolutePatch" },
    });

    const slot107 = hypergraph.findSlotByThreadId(107)!;
    const slot108 = hypergraph.findSlotByThreadId(108)!;

    // Both assert valid intervals
    transformer.syncThreadTheory(slot107, [{ kind: "interval", varName: "flowRate", min: 1, max: 10 }]);
    transformer.syncThreadTheory(slot108, [{ kind: "interval", varName: "pressureDrop", min: 100, max: 500 }]);

    // Invalidate blast radius starting from SysML node 301
    const radius = transformer.invalidateBlastRadius("sysml2", 301);
    expect(radius).toBeDefined();
    expect(radius!.impactedThreads).toContain(107);
    expect(radius!.impactedThreads).toContain(108);

    // Both slots should now be marked stale in linear memory
    expect(hypergraph.isStale(slot107)).toBe(true);
    expect(hypergraph.isStale(slot108)).toBe(true);

    // Listener should have captured the stale transitions
    const staleEvents = events.filter((e) => e.type === "stale");
    expect(staleEvents.length).toBeGreaterThan(0);

    // Reconcile slot 107
    transformer.syncThreadTheory(slot107, [{ kind: "interval", varName: "flowRate", min: 2, max: 8 }]);
    expect(hypergraph.isStale(slot107)).toBe(false);
    expect(hypergraph.getRecord(slot107)!.isSynced).toBe(true);

    unsubscribe();
  });

  it("should cleanly retract all literals from coordinator and reverse maps via retractThreadConstraints()", () => {
    const transformer = new PolyglotTransformer();
    const hypergraph = transformer.getHypergraph();

    transformer.registerThread("thread_109", {
      sysml2: { name: "Sensor" },
      modelica: { name: "SensorSim" },
    });

    const slot = hypergraph.findSlotByThreadId(109)!;

    const lit1 = transformer.assertTggConstraint(slot, { kind: "interval", varName: "s1", min: 0, max: 10 });
    const lit2 = transformer.assertTggConstraint(slot, { kind: "diff", varA: "t1", varB: "t0", bound: 5 });

    const activeIds = transformer.getLiteralIdsForThreadSlot(slot);
    expect(activeIds).toEqual([lit1, lit2]);
    expect(transformer.getThreadSlotForLiteralId(lit1)).toBe(slot);
    expect(transformer.getThreadSlotForLiteralId(lit2)).toBe(slot);

    // Retract
    transformer.retractThreadConstraints(slot);

    expect(transformer.getLiteralIdsForThreadSlot(slot)).toEqual([]);
    expect(transformer.getThreadSlotForLiteralId(lit1)).toBeUndefined();
    expect(transformer.getThreadSlotForLiteralId(lit2)).toBeUndefined();
  });
});
