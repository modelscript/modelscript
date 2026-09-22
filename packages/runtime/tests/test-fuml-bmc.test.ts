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
});
