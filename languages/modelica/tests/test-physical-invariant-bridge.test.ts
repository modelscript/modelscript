// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Interval,
  TaylorModel,
  type FlowpipeReachabilityResult,
  type HybridFlowpipeProblemOptions,
  type HybridFlowpipeResult,
} from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import { PhysicalInvariantBridge, type ContinuousDiscreteProofCertificate } from "../src/index.js";

describe("Phase 4: Physical Reachability Invariant Bridge (Continuous Plant -> Discrete Algorithm)", () => {
  it("should extract accurate continuous reachability envelopes from FlowpipeReachabilityResult", () => {
    const mockFlowpipe: FlowpipeReachabilityResult = {
      isCertifiedSafe: true,
      summary: "Continuous flowpipe certified safe",
      violations: [],
      steps: [
        {
          stepIndex: 0,
          time: 0.0,
          tubes: [new Interval(1.5, 2.5), new Interval(300.0, 320.0)],
          nominal: [2.0, 310.0],
        },
        {
          stepIndex: 1,
          time: 0.5,
          tubes: [new Interval(1.2, 3.8), new Interval(298.0, 340.0)],
          nominal: [2.5, 319.0],
        },
        {
          stepIndex: 2,
          time: 1.0,
          tubes: [new Interval(2.0, 4.5), new Interval(310.0, 365.0)],
          nominal: [3.2, 337.5],
        },
      ],
    };

    const stateNames = ["tank_level", "fluid_temp"];
    const envelopes = PhysicalInvariantBridge.extractFlowpipeEnvelopes(mockFlowpipe, stateNames);

    assert.deepStrictEqual(envelopes.get("tank_level"), [1.2, 4.5]);
    assert.deepStrictEqual(envelopes.get("fluid_temp"), [298.0, 365.0]);
  });

  it("should extract overarching reachability envelopes across hybrid modes and jumps", () => {
    const mockHybrid: HybridFlowpipeResult = {
      isCertifiedSafe: true,
      totalSteps: 2,
      summary: "Hybrid flowpipe certified safe",
      violations: [],
      segments: [
        {
          modeId: "mode_heat",
          startTime: 0.0,
          endTime: 1.0,
          steps: [
            {
              stepIndex: 0,
              time: 0.0,
              tubes: [new Interval(5.0, 10.0)],
              nominal: [7.5],
            },
            {
              stepIndex: 1,
              time: 1.0,
              tubes: [new Interval(8.0, 15.0)],
              nominal: [11.5],
            },
          ],
        },
      ],
      jumps: [
        {
          transitionId: "t_reset",
          sourceModeId: "mode_heat",
          targetModeId: "mode_cool",
          time: 1.0,
          timeEnclosure: new Interval(1.0, 1.0),
          preJumpEnclosure: [new Interval(8.0, 15.0)],
          postJumpEnclosure: [new Interval(6.0, 12.0)],
          preJumpNominal: [11.5],
          postJumpNominal: [9.0],
        },
      ],
    };

    const stateNames = ["temp"];
    const envelopes = PhysicalInvariantBridge.extractHybridFlowpipeEnvelopes(mockHybrid, stateNames);

    assert.deepStrictEqual(envelopes.get("temp"), [5.0, 15.0]);
  });

  it("should eliminate false alarms by injecting continuous plant reachability bounds into discrete algorithms", () => {
    // Discrete controller algorithm:
    // Computes pump discharge velocity v_out and heat index
    const controlAlgorithm = `
      algorithm
        v_out := sqrt(tank_level);
        heat_index := 1000.0 / fluid_temp;
    `;

    const variables = [
      { name: "tank_level", type: "Real" as const },
      { name: "fluid_temp", type: "Real" as const },
      { name: "v_out", type: "Real" as const },
      { name: "heat_index", type: "Real" as const },
    ];

    // Verified physical plant reachability tube (guaranteed strictly positive ranges)
    const plantPreconditions = new Map<string, [number, number]>([
      ["tank_level", [1.2, 4.8]],
      ["fluid_temp", [295.0, 365.0]],
    ]);

    const cert: ContinuousDiscreteProofCertificate = PhysicalInvariantBridge.verifyWithContinuousInvariants(
      controlAlgorithm,
      variables,
      {
        functionName: "computeActuation",
        continuousModelName: "ThermalFluidTank",
        plantPreconditions,
      },
    );

    // 1. Without physical invariants, static analysis generates 2 potential bug alarms
    assert.strictEqual(cert.unconstrainedResult.isCertifiedSafe, false);
    assert.strictEqual(cert.unconstrainedResult.potentialBugs.length, 2);

    // 2. With continuous flowpipe envelopes injected, both alarms are mathematically disproven!
    assert.strictEqual(cert.physicsConstrainedResult.isCertifiedSafe, true);
    assert.strictEqual(cert.physicsConstrainedResult.potentialBugs.length, 0);
    assert.strictEqual(cert.physicsConstrainedResult.definiteBugs.length, 0);

    // 3. Exactly 2 false alarms were eliminated
    assert.strictEqual(cert.eliminatedFalseAlarms, 2);
    assert.strictEqual(cert.isCertifiedSafe, true);
    assert.ok(cert.executiveSummary.includes("100% MATHEMATICALLY CERTIFIED SAFE (Zero False Alarms)"));
  });

  it("should execute end-to-end continuous hybrid reachability and verify discrete controller", () => {
    // 1. Continuous plant model: dy/dt = -y + 2.0 (state y converges towards 2.0)
    // Starting enclosure [1.0, 1.5]
    const hybridProblem: HybridFlowpipeProblemOptions = {
      automaton: {
        modes: [
          {
            id: "nominal",
            dynamics: (t: TaylorModel, y: TaylorModel[]) => {
              // dy/dt = -y + 2.0
              const negY = y[0]!.scale(-1.0);
              const der = negY.addConstant(2.0);
              return [der];
            },
          },
        ],
        transitions: [],
      },
      initialModeId: "nominal",
      initialEnclosure: [new Interval(1.0, 1.5)],
      nominalInitial: [1.25],
      tSpan: [0.0, 0.5],
      dt: 0.1,
      order: 2,
    };

    // 2. Discrete controller: feedback_gain := 10.0 / y_plant;
    const controlCode = `
      algorithm
        feedback_gain := 10.0 / y_plant;
    `;

    const controlVariables = [
      { name: "y_plant", type: "Real" as const },
      { name: "feedback_gain", type: "Real" as const },
    ];

    const stateToInputMapping = {
      state_0: "y_plant",
    };

    const cert = PhysicalInvariantBridge.verifyContinuousHybridSystem(
      hybridProblem,
      controlCode,
      controlVariables,
      stateToInputMapping,
      {
        functionName: "plantController",
        continuousModelName: "FirstOrderPlant",
      },
    );

    // Continuous flowpipe proves y_plant remains strictly positive (> 0.9)
    // Division 10.0 / y_plant is guaranteed division-by-zero free!
    assert.strictEqual(cert.isCertifiedSafe, true);
    assert.strictEqual(cert.physicsConstrainedResult.isCertifiedSafe, true);
    assert.strictEqual(cert.physicsConstrainedResult.potentialBugs.length, 0);
    assert.strictEqual(cert.eliminatedFalseAlarms, 1);
  });
});
