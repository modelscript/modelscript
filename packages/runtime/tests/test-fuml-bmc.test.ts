// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ActivityBmcEngine } from "../src/statemachine/wasm_bmc_engine.js";
import { ActivityEdgeKind, ActivityNodeKind, WasmFumlEngine } from "../src/statemachine/wasm_fuml_engine.js";

describe("Discrete Activity Bounded Model Checking (BMC) & k-Induction Suite", () => {
  it("should detect violation when a forbidden node is reachable in bounded execution", () => {
    const engine = new WasmFumlEngine();

    const initId = engine.addNode("Init", ActivityNodeKind.Initial);
    const computeId = engine.addNode("Compute", ActivityNodeKind.Action);
    const failId = engine.addNode("HazardState", ActivityNodeKind.Action);

    engine.addEdge(initId, computeId);
    engine.addEdge(computeId, failId);

    engine.init();

    const bmc = new ActivityBmcEngine(engine);
    const result = bmc.checkBoundedSafety(
      {
        name: "NoHazardEncountered",
        forbiddenNodes: ["HazardState"],
      },
      10,
    );

    assert.strictEqual(result.satisfied, false, "BMC should find that HazardState is reachable");
    assert(result.violation !== undefined);
    assert.strictEqual(result.violation?.reason.includes("HazardState"), true);
    assert.strictEqual(result.violation?.step, 3);
    assert(result.violation?.trace.length >= 2);
  });

  it("should verify safe activity where forbidden node is never reachable", () => {
    const engine = new WasmFumlEngine();

    const initId = engine.addNode("Init", ActivityNodeKind.Initial);
    const step1Id = engine.addNode("Step1", ActivityNodeKind.Action);
    const decisionId = engine.addNode("CheckBranch", ActivityNodeKind.Decision);
    const finalId = engine.addNode("Final", ActivityNodeKind.ActivityFinal);
    const unreachableFailId = engine.addNode("UnreachableFail", ActivityNodeKind.Action);

    engine.addEdge(initId, step1Id);
    engine.addEdge(step1Id, decisionId);
    engine.addEdge(decisionId, finalId, ActivityEdgeKind.Control, {
      guard: () => true,
    });
    engine.addEdge(decisionId, unreachableFailId, ActivityEdgeKind.Control, {
      guard: () => false, // Dead branch: guard is never satisfied
    });

    engine.init();

    const bmc = new ActivityBmcEngine(engine);
    const result = bmc.checkBoundedSafety(
      {
        name: "NoFailurePossible",
        forbiddenNodes: ["UnreachableFail"],
      },
      10,
    );

    assert.strictEqual(result.satisfied, true, "BMC should prove UnreachableFail is never triggered");
    assert.strictEqual(result.violation, undefined);
  });

  it("should prove safety invariant using k-induction", () => {
    const engine = new WasmFumlEngine();

    const initId = engine.addNode("Init", ActivityNodeKind.Initial);
    const loopTask = engine.addNode("ProcessItem", ActivityNodeKind.Action);
    const complete = engine.addNode("Done", ActivityNodeKind.ActivityFinal);

    engine.addEdge(initId, loopTask);
    engine.addEdge(loopTask, complete);

    engine.init();

    const bmc = new ActivityBmcEngine(engine);
    const kResult = bmc.checkKInduction(
      {
        name: "ControlledBufferCapacity",
        maxTokenCapacity: 5,
        forbiddenNodes: ["Hazard"],
      },
      10,
    );

    assert.strictEqual(kResult.isProvenInvariant, true);
    assert.strictEqual(kResult.baseStepSatisfied, true);
    assert.strictEqual(kResult.inductiveStepSatisfied, true);
  });

  it("should fail inductive step when k is smaller than distance to hazard", () => {
    const engine = new WasmFumlEngine();

    const initId = engine.addNode("Init", ActivityNodeKind.Initial);
    const step1Id = engine.addNode("Step1", ActivityNodeKind.Action);
    const step2Id = engine.addNode("Step2", ActivityNodeKind.Action);
    const hazardId = engine.addNode("Hazard", ActivityNodeKind.Action);

    engine.addEdge(initId, step1Id);
    engine.addEdge(step1Id, step2Id);
    engine.addEdge(step2Id, hazardId);

    engine.init();

    const bmc = new ActivityBmcEngine(engine);
    // Base step at k=1 will only check up to step 1 (Init and Step1 are safe, base holds)
    // But inductive step from Step2 to Hazard will fail (or base step at k=3 will detect violation)
    const kResult = bmc.checkKInduction(
      {
        name: "DetectDelayedHazard",
        forbiddenNodes: ["Hazard"],
      },
      1,
    );

    // Hazard is reachable at step 3, so invariant does NOT hold
    assert.strictEqual(kResult.isProvenInvariant, false);
  });

  it("should prove unbounded token capacity invariant via Sinz cardinality networks for non-terminating cyclic activity", () => {
    const engine = new WasmFumlEngine();

    const initId = engine.addNode("Init", ActivityNodeKind.Initial);
    const taskA = engine.addNode("TaskA", ActivityNodeKind.Action);
    const taskB = engine.addNode("TaskB", ActivityNodeKind.Action);

    engine.addEdge(initId, taskA);
    engine.addEdge(taskA, taskB);
    engine.addEdge(taskB, taskA); // Cyclic loop: TaskA -> TaskB -> TaskA

    engine.init();

    const bmc = new ActivityBmcEngine(engine);
    // Non-terminating loop: bound k=4 will not terminate, triggering the SAT inductive step
    const kResult = bmc.checkKInduction(
      {
        name: "BoundedBufferCapacityUnboundedTime",
        maxTokenCapacity: 2,
      },
      4,
    );

    assert.strictEqual(kResult.baseStepSatisfied, true, "Base step should hold for single-token loop");
    assert.strictEqual(kResult.inductiveStepSatisfied, true, "Inductive step should hold via Sinz cardinality network");
    assert.strictEqual(
      kResult.isProvenInvariant,
      true,
      "Token capacity <= 2 must be formally proven invariant for all time",
    );
  });

  it("should fail inductive step when fork creates unbounded tokens exceeding capacity", () => {
    const engine = new WasmFumlEngine();

    const initId = engine.addNode("Init", ActivityNodeKind.Initial);
    const forkId = engine.addNode("ForkBranch", ActivityNodeKind.Fork);
    const act1 = engine.addNode("Action1", ActivityNodeKind.Action);
    const act2 = engine.addNode("Action2", ActivityNodeKind.Action);

    engine.addEdge(initId, forkId);
    engine.addEdge(forkId, act1);
    engine.addEdge(forkId, act2);

    engine.init();

    const bmc = new ActivityBmcEngine(engine);
    // Fork splits 1 token into 2 tokens simultaneously.
    // Capacity 1 should fail either in base step or inductive step!
    const kResult = bmc.checkKInduction(
      {
        name: "StrictSingleTokenCapacity",
        maxTokenCapacity: 1,
      },
      3,
    );

    assert.strictEqual(kResult.isProvenInvariant, false, "Must detect that fork exceeds single-token capacity");
  });
});
