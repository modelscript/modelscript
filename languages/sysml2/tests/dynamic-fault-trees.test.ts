// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert";
import test from "node:test";
import {
  analyzeDynamicFaultTree,
  evaluateDftSequence,
  synthesizeStpaUcas,
  type ControlLoop,
  type DftModel,
} from "../src/index.js";

test("Dynamic Fault Trees (DFT) - Temporal Gates & Minimal Cut Sequences", async (t) => {
  await t.test("evaluates Priority-AND (PAND) order sensitivity", () => {
    const dft: DftModel = {
      topGateId: "TopHazard",
      gates: new Map([
        [
          "TopHazard",
          {
            id: "TopHazard",
            name: "Priority Hazard",
            type: "PAND",
            inputs: ["PrimaryFail", "BackupFail"],
          },
        ],
      ]),
      basicEvents: new Map([
        ["PrimaryFail", { id: "PrimaryFail", name: "Primary Sensor Loss", component: "Sensors" }],
        ["BackupFail", { id: "BackupFail", name: "Backup Sensor Loss", component: "Sensors" }],
      ]),
    };

    // Primary then Backup -> triggers PAND
    assert.strictEqual(evaluateDftSequence(dft, ["PrimaryFail", "BackupFail"]), true);

    // Backup then Primary -> does NOT trigger PAND
    assert.strictEqual(evaluateDftSequence(dft, ["BackupFail", "PrimaryFail"]), false);

    // Primary alone -> does NOT trigger
    assert.strictEqual(evaluateDftSequence(dft, ["PrimaryFail"]), false);

    // Minimal Cut Sequences synthesis
    const result = analyzeDynamicFaultTree(dft, 2);
    assert.strictEqual(result.isHazardTriggerable, true);
    assert.strictEqual(result.cutSequences.length, 1);
    assert.deepStrictEqual(result.cutSequences[0]?.sequence, ["PrimaryFail", "BackupFail"]);
    assert.match(result.summary, /DFT synthesized 1 Minimal Cut Sequences/);
  });

  await t.test("propagates Functional Dependency (FDEP) cascading failures", () => {
    const dft: DftModel = {
      topGateId: "LossOfFlow",
      gates: new Map([
        [
          "LossOfFlow",
          {
            id: "LossOfFlow",
            name: "Complete Flow Loss",
            type: "AND",
            inputs: ["Pump1", "Pump2"],
          },
        ],
        [
          "FDEP_Bus",
          {
            id: "FDEP_Bus",
            name: "Power Bus Dependency",
            type: "FDEP",
            inputs: [],
            trigger: "PowerBusLoss",
            dependents: ["Pump1", "Pump2"],
          },
        ],
      ]),
      basicEvents: new Map([
        ["PowerBusLoss", { id: "PowerBusLoss", name: "Main Bus Trip", component: "Power" }],
        ["Pump1", { id: "Pump1", name: "Pump 1 Mechanical Failure", component: "Hydraulics" }],
        ["Pump2", { id: "Pump2", name: "Pump 2 Mechanical Failure", component: "Hydraulics" }],
      ]),
    };

    // PowerBusLoss cascades to Pump1 and Pump2 simultaneously, triggering LossOfFlow
    assert.strictEqual(evaluateDftSequence(dft, ["PowerBusLoss"]), true);

    // Single pump does not trigger LossOfFlow
    assert.strictEqual(evaluateDftSequence(dft, ["Pump1"]), false);

    // Both pumps fail individually
    assert.strictEqual(evaluateDftSequence(dft, ["Pump1", "Pump2"]), true);

    const result = analyzeDynamicFaultTree(dft, 2);
    assert.strictEqual(result.isHazardTriggerable, true);
    // Order-1 cut sequence: PowerBusLoss
    const order1 = result.cutSequences.find((s) => s.order === 1);
    assert.ok(order1);
    assert.deepStrictEqual(order1.sequence, ["PowerBusLoss"]);
  });

  await t.test("evaluates SPARE gate switching dynamics", () => {
    const dft: DftModel = {
      topGateId: "ComputeLoss",
      gates: new Map([
        [
          "ComputeLoss",
          {
            id: "ComputeLoss",
            name: "Compute Redundancy Loss",
            type: "SPARE",
            inputs: [],
            primary: "PrimaryECU",
            spares: ["ColdSpareECU"],
          },
        ],
      ]),
      basicEvents: new Map([
        ["PrimaryECU", { id: "PrimaryECU", name: "Primary Flight Computer", component: "Avionics" }],
        ["ColdSpareECU", { id: "ColdSpareECU", name: "Cold Spare Computer", component: "Avionics" }],
      ]),
    };

    // Primary fails first, then spare fails -> hazard triggers
    assert.strictEqual(evaluateDftSequence(dft, ["PrimaryECU", "ColdSpareECU"]), true);

    // Spare alone cannot fail active system
    assert.strictEqual(evaluateDftSequence(dft, ["ColdSpareECU"]), false);

    // Spare failing before primary -> spare inactive at time of primary failure
    assert.strictEqual(evaluateDftSequence(dft, ["ColdSpareECU", "PrimaryECU"]), false);
  });
});

test("STPA - Automated Unsafe Control Action (UCA) Synthesis", async (t) => {
  await t.test("synthesizes all 4 canonical UCAs for control feedback loops", () => {
    const loops: ControlLoop[] = [
      {
        id: "loop_braking",
        controller: "AutonomousBrakingECU",
        controlAction: "ApplyEmergencyBraking",
        controlledProcess: "BrakeCalipers",
        context: "pedestrian detected within stopping distance",
      },
    ];

    const stpa = synthesizeStpaUcas(loops, "PedestrianCollisionHazard");

    assert.strictEqual(stpa.controlLoopsCount, 1);
    assert.strictEqual(stpa.totalUcasSynthesized, 4);

    // 1. Not Providing
    const notProv = stpa.ucasByCategory.NOT_PROVIDING[0]!;
    assert.ok(notProv);
    assert.strictEqual(notProv.category, "NOT_PROVIDING");
    assert.match(notProv.description, /does not provide 'ApplyEmergencyBraking'/);
    assert.match(notProv.safetyConstraint, /must provide 'ApplyEmergencyBraking'/);

    // 2. Providing Incorrectly
    const provInc = stpa.ucasByCategory.PROVIDING_INCORRECTLY[0]!;
    assert.ok(provInc);
    assert.match(provInc.description, /provides 'ApplyEmergencyBraking' inappropriately/);

    // 3. Timing / Order
    const timing = stpa.ucasByCategory.TIMING_ORDER[0]!;
    assert.ok(timing);
    assert.match(timing.description, /too late, too early, or out of sequence/);

    // 4. Duration
    const dur = stpa.ucasByCategory.DURATION[0]!;
    assert.ok(dur);
    assert.match(dur.description, /stops 'ApplyEmergencyBraking' prematurely or applies it for too long/);

    assert.match(stpa.summary, /Synthesized 4 Unsafe Control Actions/);
  });
});
