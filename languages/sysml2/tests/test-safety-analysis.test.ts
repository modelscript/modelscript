// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeSafetyAndFaultTree,
  enumerateAllMinimalCutSets,
  quickXplain,
  type FailureMode,
  type HazardDefinition,
} from "../src/safety-analyzer.js";

describe("Automated Safety Analysis & Fault Tree (MCS) Suite", () => {
  it("should extract minimal cut sets using QuickXplain divide-and-conquer", () => {
    // 4 candidate faults: F1, F2, F3, F4
    // Hazard condition requires (F1 AND F3)
    const causesHazard = (active: Set<string>) => active.has("F1") && active.has("F3");

    const mcs = quickXplain([], ["F1", "F2", "F3", "F4"], causesHazard);
    assert.deepStrictEqual(mcs.sort(), ["F1", "F3"]);
  });

  it("should verify dual-redundant architecture has zero single points of failure", () => {
    const failureModes: FailureMode[] = [
      { id: "BusA_Loss", name: "Primary Power Bus A Loss", component: "PowerDistribution", probability: 1e-3 },
      { id: "BusB_Loss", name: "Backup Power Bus B Loss", component: "PowerDistribution", probability: 1e-3 },
      { id: "Sensor_Loss", name: "Auxiliary Sensor Loss", component: "Telemetry", probability: 1e-2 },
    ];

    // Total Blackout hazard requires BOTH Bus A and Bus B to fail
    const hazard: HazardDefinition = {
      id: "TotalBlackout",
      name: "Total Vehicle Blackout",
      causesHazard: (active) => active.has("BusA_Loss") && active.has("BusB_Loss"),
    };

    const result = analyzeSafetyAndFaultTree(undefined, {
      failureModes,
      hazard,
      maxOrder: 3,
    });

    assert(result.isHazardReachable, "Hazard should be reachable under simultaneous bus failures");
    assert.strictEqual(result.singlePointsOfFailure.length, 0, "Redundant architecture must have no SPOFs");
    assert.strictEqual(result.minimalCutSets.length, 1);

    const mcs = result.minimalCutSets[0]!;
    assert.strictEqual(mcs.order, 2);
    assert.deepStrictEqual(mcs.faultIds.sort(), ["BusA_Loss", "BusB_Loss"]);
    assert.strictEqual(mcs.probability, 1e-6);
  });

  it("should identify single points of failure (order-1 cut sets) and multi-fault combinations", () => {
    const failureModes: FailureMode[] = [
      { id: "MainECU_Dead", name: "Main ECU Fatal Crash", component: "ControlUnit" },
      { id: "SpeedSensorA_Fail", name: "Wheel Speed Sensor A Fail", component: "Chassis" },
      { id: "SpeedSensorB_Fail", name: "Wheel Speed Sensor B Fail", component: "Chassis" },
    ];

    // Hazard occurs if Main ECU dies OR both speed sensors fail
    const hazard: HazardDefinition = {
      id: "BrakingLoss",
      name: "Loss of Emergency Braking",
      causesHazard: (active) =>
        active.has("MainECU_Dead") || (active.has("SpeedSensorA_Fail") && active.has("SpeedSensorB_Fail")),
    };

    const result = analyzeSafetyAndFaultTree(undefined, {
      failureModes,
      hazard,
      maxOrder: 3,
    });

    assert.strictEqual(result.minimalCutSets.length, 2);
    assert.strictEqual(result.singlePointsOfFailure.length, 1);

    const spof = result.singlePointsOfFailure[0]!;
    assert.strictEqual(spof.order, 1);
    assert.deepStrictEqual(spof.faultIds, ["MainECU_Dead"]);

    const dualCutSet = result.minimalCutSets.find((cs) => cs.order === 2);
    assert(dualCutSet !== undefined);
    assert.deepStrictEqual(dualCutSet.faultIds.sort(), ["SpeedSensorA_Fail", "SpeedSensorB_Fail"]);
  });

  it("should synthesize all order-2 cut sets for Triple Modular Redundancy (2-out-of-3)", () => {
    const failureModes: FailureMode[] = [
      { id: "P1", name: "Processor 1 Fail", component: "TMR" },
      { id: "P2", name: "Processor 2 Fail", component: "TMR" },
      { id: "P3", name: "Processor 3 Fail", component: "TMR" },
    ];

    // Majority voting fails if any 2 of the 3 processors fail
    const hazard: HazardDefinition = {
      id: "TMR_Consensus_Loss",
      name: "Loss of TMR Consensus",
      causesHazard: (active) => {
        let count = 0;
        if (active.has("P1")) count++;
        if (active.has("P2")) count++;
        if (active.has("P3")) count++;
        return count >= 2;
      },
    };

    const cutSets = enumerateAllMinimalCutSets(failureModes, hazard, 2);
    assert.strictEqual(cutSets.length, 3, "2-out-of-3 system has exactly 3 order-2 cut sets");

    for (const cs of cutSets) {
      assert.strictEqual(cs.order, 2);
    }
  });

  it("should generate valid DiagramData conforming to diagram protocol", () => {
    const failureModes: FailureMode[] = [
      { id: "PumpA", name: "Cooling Pump A Fail", component: "Thermal" },
      { id: "PumpB", name: "Cooling Pump B Fail", component: "Thermal" },
    ];

    const hazard: HazardDefinition = {
      id: "CoreOverheat",
      name: "Core Overheating Hazard",
      causesHazard: (active) => active.has("PumpA") && active.has("PumpB"),
    };

    const result = analyzeSafetyAndFaultTree(undefined, {
      failureModes,
      hazard,
      generateDiagram: true,
    });

    const diagram = result.faultTreeDiagram;
    assert(diagram !== undefined, "DiagramData must be generated");
    assert(diagram.nodes.length >= 4, "Must contain Top Event, OR Gate, AND Gate, and Basic Events");
    assert(diagram.edges.length >= 3, "Must contain edges linking Top Event -> OR -> AND -> Events");

    const topNode = diagram.nodes.find((n) => n.id === "node_hazard_top");
    assert(topNode !== undefined);
    assert.strictEqual(topNode.data?.kind, "top-event");

    const orGateNode = diagram.nodes.find((n) => n.id === "node_gate_root_or");
    assert(orGateNode !== undefined);
    assert.strictEqual(orGateNode.data?.kind, "gate-or");

    const andGateNode = diagram.nodes.find((n) => n.id === "node_gate_and_1");
    assert(andGateNode !== undefined);
    assert.strictEqual(andGateNode.data?.kind, "gate-and");
  });
});
