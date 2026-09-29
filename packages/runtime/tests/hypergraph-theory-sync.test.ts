// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { PolyglotTransformer } from "../src/interop/polyglot-transformer.js";
import {
  DigitalThreadHypergraph,
  THREAD_FIELD_STATUS,
  THREAD_STATUS_SYNCED,
  THREAD_STRIDE,
  ThreadRelation,
  type HypergraphStatusEvent,
} from "../src/interop/thread_hypergraph.js";

const expect = (val: any) => ({
  toBe: (expected: any) => assert.strictEqual(val, expected),
  toEqual: (expected: any) => assert.deepStrictEqual(val, expected),
  toBeDefined: () => assert.notStrictEqual(val, undefined),
  toBeUndefined: () => assert.strictEqual(val, undefined),
  toBeGreaterThan: (n: number) => assert.ok(val > n),
  toHaveLength: (n: number) => assert.strictEqual(val?.length, n),
  toContain: (str: string) => assert.ok(String(val).includes(str)),
});

describe("DigitalThreadHypergraph Theory Synchronization (Phase 2)", () => {
  it("should directly update linear memory Uint32Array SoA status flags on formal SAT and UNSAT", () => {
    const hypergraph = new DigitalThreadHypergraph();
    const slot = hypergraph.createThread(201, 1, ThreadRelation.Aligned, 0);

    // Initial state is THREAD_STATUS_SYNCED (0x0001)
    expect(hypergraph.isSynced(slot)).toBe(true);
    expect(hypergraph.isConflicted(slot)).toBe(false);
    expect(hypergraph.isStale(slot)).toBe(false);

    // Raw linear memory inspection
    const rawBuffer = hypergraph.toBinary();
    const rawStatus = rawBuffer[slot * THREAD_STRIDE + THREAD_FIELD_STATUS];
    expect(rawStatus & THREAD_STATUS_SYNCED).toBe(THREAD_STATUS_SYNCED);

    // 1. Record theory conflict directly
    const mockConflict = {
      culpritLiterals: [1, 2],
      culpritEntities: ["motor_torque", "inertia_load"],
      explanation: "Direct torque-load equilibrium contradiction",
    };
    hypergraph.recordTheoryConflict(slot, mockConflict);

    expect(hypergraph.isConflicted(slot)).toBe(true);
    expect(hypergraph.isSynced(slot)).toBe(false);
    expect(hypergraph.getConflict(slot)).toEqual(mockConflict);

    // 2. Transition back to formal SAT
    hypergraph.recordTheorySat(slot);
    expect(hypergraph.isSynced(slot)).toBe(true);
    expect(hypergraph.isConflicted(slot)).toBe(false);
    expect(hypergraph.getConflict(slot)).toBeUndefined();
  });

  it("should detect Octagon DBM negative cycle conflict and synchronize status flags into linear memory", () => {
    const transformer = new PolyglotTransformer();
    const hypergraph = transformer.getHypergraph();

    transformer.registerThread("thread_301", {
      sysml2: { id: 10, name: "TimingController" },
      modelica: { id: 11, name: "DigitalClockSource" },
    });

    const slot = hypergraph.findSlotByThreadId(301)!;
    expect(slot).toBeDefined();

    // Assert unsatisfiable difference constraints: t2 - t1 <= 4 AND t1 - t2 <= -8 => negative cycle (-4 <= 0)!
    const res = transformer.syncThreadTheory(
      slot,
      [
        { kind: "diff", varA: "t2", varB: "t1", bound: 4 },
        { kind: "diff", varA: "t1", varB: "t2", bound: -8 },
      ],
      "ClockSynchronizationRule",
    );

    expect(res.isSat).toBe(false);
    expect(hypergraph.isConflicted(slot)).toBe(true);
    expect(hypergraph.isSynced(slot)).toBe(false);

    const conflict = hypergraph.getConflict(slot);
    expect(conflict).toBeDefined();
    expect(conflict?.explanation).toContain("Negative cycle detected in Octagon DBM");
  });

  it("should detect dimensional unit mismatch across digital thread and flip hypergraph status to CONFLICT", () => {
    const transformer = new PolyglotTransformer();
    const hypergraph = transformer.getHypergraph();

    transformer.registerThread("thread_302", {
      sysml2: { id: 20, name: "HydraulicPiston" },
      modelica: { id: 21, name: "CylinderChamber" },
    });

    const slot = hypergraph.findSlotByThreadId(302)!;
    expect(slot).toBeDefined();

    // Length dimension [1,0,0,0,0,0,0] vs Mass dimension [0,1,0,0,0,0,0] equated together
    const res = transformer.syncThreadTheory(
      slot,
      [
        { kind: "dimension", varName: "piston_displacement", dimensionVector: [1, 0, 0, 0, 0, 0, 0] },
        { kind: "dimension", varName: "chamber_fluid_mass", dimensionVector: [0, 1, 0, 0, 0, 0, 0] },
        { kind: "eq", varA: "piston_displacement", varB: "chamber_fluid_mass" },
      ],
      "PistonFluidEquivalence",
    );

    expect(res.isSat).toBe(false);
    expect(hypergraph.isConflicted(slot)).toBe(true);
    const conflict = hypergraph.getConflict(slot);
    expect(conflict).toBeDefined();
    expect(conflict?.explanation).toContain("Dimensional Inconsistency");
  });

  it("should incrementally propagate blast radius invalidation across multi-domain chain", () => {
    const transformer = new PolyglotTransformer();
    const hypergraph = transformer.getHypergraph();

    // Setup 4-hop chain: SysML (10) <-> Modelica (20) <-> CAD (30) <-> FEA (40)
    // Plus an isolated thread 404: Telemetry (99) <-> Unrelated (100)
    transformer.registerThread("thread_chain_1", {
      sysml2: { id: 10, name: "BracketReq" },
      modelica: { id: 20, name: "BracketDynamics" },
    });

    transformer.registerThread("thread_chain_2", {
      modelica: { id: 20, name: "BracketDynamics" },
      cad: { id: 30, name: "BracketSolid" },
    });

    transformer.registerThread("thread_chain_3", {
      cad: { id: 30, name: "BracketSolid" },
      fea: { id: 40, name: "BracketStressMesh" },
    });

    transformer.registerThread("thread_isolated_4", {
      telemetry: { id: 99, name: "SensorTemp" },
      modelica: { id: 100, name: "ThermalCapacitance" },
    });

    const slot1 = hypergraph.findSlotByThreadId(1)!;
    const slot2 = hypergraph.findSlotByThreadId(2)!;
    const slot3 = hypergraph.findSlotByThreadId(3)!;
    const slot4 = hypergraph.findSlotByThreadId(4)!;

    // All slots initially synced with valid constraints
    transformer.syncThreadTheory(slot1, [{ kind: "interval", varName: "thickness", min: 2, max: 10 }]);
    transformer.syncThreadTheory(slot2, [{ kind: "interval", varName: "width", min: 10, max: 50 }]);
    transformer.syncThreadTheory(slot3, [{ kind: "interval", varName: "stress", min: 0, max: 250 }]);
    transformer.syncThreadTheory(slot4, [{ kind: "interval", varName: "temp", min: -20, max: 120 }]);

    expect(hypergraph.isSynced(slot1)).toBe(true);
    expect(hypergraph.isSynced(slot2)).toBe(true);
    expect(hypergraph.isSynced(slot3)).toBe(true);
    expect(hypergraph.isSynced(slot4)).toBe(true);

    // Invalidate blast radius starting from SysML node 10
    const radius = transformer.invalidateBlastRadius("sysml2", 10);
    expect(radius).toBeDefined();

    // Chain 1, 2, 3 should be marked stale in linear memory
    expect(hypergraph.isStale(slot1)).toBe(true);
    expect(hypergraph.isStale(slot2)).toBe(true);
    expect(hypergraph.isStale(slot3)).toBe(true);

    // Isolated thread 4 MUST remain synced and untouched
    expect(hypergraph.isStale(slot4)).toBe(false);
    expect(hypergraph.isSynced(slot4)).toBe(true);

    // Incremental re-check of slot 1 restores its synced status without requiring re-checking slot 4
    transformer.syncThreadTheory(slot1, [{ kind: "interval", varName: "thickness", min: 3, max: 8 }]);
    expect(hypergraph.isStale(slot1)).toBe(false);
    expect(hypergraph.isSynced(slot1)).toBe(true);
  });

  it("should stream real-time lifecycle events to registered hypergraph listeners", () => {
    const hypergraph = new DigitalThreadHypergraph();
    const events: HypergraphStatusEvent[] = [];

    const unsubscribe = hypergraph.addListener((event) => {
      events.push(event);
    });

    const slot = hypergraph.createThread(505);

    // 1. Mark stale
    hypergraph.markStale(slot);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("stale");
    expect(events[0].slot).toBe(slot);
    expect(events[0].threadId).toBe(505);

    // 2. Mark conflict
    const conflict = {
      culpritLiterals: [10],
      culpritEntities: ["A"],
      explanation: "Subsumption failure",
    };
    hypergraph.recordTheoryConflict(slot, conflict);
    expect(events.length).toBe(2);
    expect(events[1].type).toBe("conflict");
    expect(events[1].conflict).toEqual(conflict);

    // 3. Mark sat
    hypergraph.recordTheorySat(slot);
    expect(events.length).toBe(3);
    expect(events[2].type).toBe("sat");

    // 4. Unsubscribe
    unsubscribe();
    hypergraph.markStale(slot);
    expect(events.length).toBe(3); // No new events after unregistering
  });
});
