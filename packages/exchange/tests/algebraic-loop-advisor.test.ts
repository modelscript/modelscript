// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { AlgebraicLoopAdvisor, type DirectFeedthroughMap } from "../src/cosim/algebraic-loop-advisor.js";
import { CouplingGraph, type VariableCoupling } from "../src/cosim/coupling.js";
import { Orchestrator } from "../src/cosim/orchestrator.ts";
import type { CoSimParticipant } from "../src/cosim/participant.js";
import { CoSimSession } from "../src/cosim/session.js";
import { extractDirectFeedthroughFromModelDescription, parseModelDescription } from "../src/fmu/model-description.js";

/** Mock CoSim participant helper for testing */
function createMockParticipant(
  id: string,
  modelName: string,
  options: {
    canGetAndSetState?: boolean;
    directFeedthrough?: Record<string, string[]>;
    inputs?: string[];
    outputs?: string[];
  } = {},
): CoSimParticipant {
  const inputs = options.inputs ?? ["u"];
  const outputs = options.outputs ?? ["y"];
  const variables = [
    ...inputs.map((name) => ({
      name,
      causality: "input" as const,
      type: "Real" as const,
    })),
    ...outputs.map((name) => ({
      name,
      causality: "output" as const,
      type: "Real" as const,
    })),
  ];

  let stateVal = 0.0;
  const inValues = new Map<string, number>();
  const outValues = new Map<string, number>();

  return {
    id,
    modelName,
    metadata: {
      participantId: id,
      modelName,
      type: "js-simulator",
      classKind: "model",
      variables,
      timestamp: new Date().toISOString(),
    },
    canGetAndSetState: options.canGetAndSetState ?? false,
    directFeedthrough: options.directFeedthrough,
    async initialize() {
      stateVal = 0.0;
      for (const o of outputs) outValues.set(o, 0.0);
    },
    async doStep(_currentTime: number, _stepSize: number) {
      // Direct feedthrough: output is 0.5 * input
      const u = inValues.get("u") ?? 0.0;
      stateVal += 1.0;
      outValues.set("y", u * 0.5 + stateVal);
    },
    async getOutputs() {
      return new Map(outValues);
    },
    async setInputs(values) {
      for (const [k, v] of values) {
        if (typeof v === "number") inValues.set(k, v);
      }
    },
    async terminate() {},
    getState: options.canGetAndSetState ? async () => ({ stateVal, inValues: new Map(inValues) }) : undefined,
    setState: options.canGetAndSetState
      ? async (saved: any) => {
          stateVal = saved.stateVal;
        }
      : undefined,
  };
}

test("AlgebraicLoopAdvisor: 2-Participant Mutual Feedthrough Detection", () => {
  const advisor = new AlgebraicLoopAdvisor();

  // Model A: output y feeds through from input u
  // Model B: output y feeds through from input u
  const couplings: VariableCoupling[] = [
    {
      from: { participantId: "FMU_A", variableName: "y" },
      to: { participantId: "FMU_B", variableName: "u" },
    },
    {
      from: { participantId: "FMU_B", variableName: "y" },
      to: { participantId: "FMU_A", variableName: "u" },
    },
  ];

  const feedthrough: DirectFeedthroughMap = new Map([
    ["FMU_A", new Map([["y", new Set(["u"])]])],
    ["FMU_B", new Map([["y", new Set(["u"])]])],
  ]);

  const loops = advisor.detectLoops(couplings, feedthrough);

  assert.strictEqual(loops.length, 1, "Must detect exactly 1 algebraic loop");
  const loop = loops[0]!;
  assert.strictEqual(loop.length, 2, "Loop length must be 2 couplings");
  assert.deepStrictEqual(loop.participants.sort(), ["FMU_A", "FMU_B"].sort(), "Participants must be FMU_A and FMU_B");
  assert.strictEqual(loop.isDirectFeedthrough, true);
  assert.ok(loop.description.includes("FMU_A.y"));
  assert.ok(loop.description.includes("FMU_B.u"));
});

test("AlgebraicLoopAdvisor: Acyclic Coupling Graph Detection (Zero False Positives)", () => {
  const advisor = new AlgebraicLoopAdvisor();

  // A -> B -> C (Pipeline, no feedback)
  const couplings: VariableCoupling[] = [
    {
      from: { participantId: "P_A", variableName: "out" },
      to: { participantId: "P_B", variableName: "in" },
    },
    {
      from: { participantId: "P_B", variableName: "out" },
      to: { participantId: "P_C", variableName: "in" },
    },
  ];

  const feedthrough: DirectFeedthroughMap = new Map([
    ["P_A", new Map([["out", new Set<string>()]])],
    ["P_B", new Map([["out", new Set(["in"])]])], // Direct feedthrough in B
    ["P_C", new Map([["out", new Set(["in"])]])],
  ]);

  const report = advisor.analyze(couplings, undefined, feedthrough);
  assert.strictEqual(report.hasLoops, false, "Must detect zero loops in acyclic pipeline");
  assert.strictEqual(report.loops.length, 0);
  assert.ok(report.summary.includes("No algebraic loops detected"));
});

test("AlgebraicLoopAdvisor: 3-Participant Ring Loop with External Branch", () => {
  const advisor = new AlgebraicLoopAdvisor();

  // Ring: A -> B -> C -> A, and branch C -> D
  const couplings: VariableCoupling[] = [
    {
      from: { participantId: "A", variableName: "y" },
      to: { participantId: "B", variableName: "u" },
    },
    {
      from: { participantId: "B", variableName: "y" },
      to: { participantId: "C", variableName: "u" },
    },
    {
      from: { participantId: "C", variableName: "y" },
      to: { participantId: "A", variableName: "u" },
    },
    {
      from: { participantId: "C", variableName: "y_aux" },
      to: { participantId: "D", variableName: "u" },
    },
  ];

  const feedthrough = {
    A: { y: ["u"] },
    B: { y: ["u"] },
    C: { y: ["u"], y_aux: ["u"] },
    D: { y: ["u"] },
  };

  const report = advisor.analyze(couplings, undefined, feedthrough);
  assert.strictEqual(report.hasLoops, true);
  assert.strictEqual(report.loops.length, 1);
  const loop = report.loops[0]!;
  assert.strictEqual(loop.length, 3);
  assert.deepStrictEqual(loop.participants.sort(), ["A", "B", "C"].sort());
  assert.strictEqual(loop.participants.includes("D"), false, "D should not be part of the loop");
});

test("AlgebraicLoopAdvisor: Remediation Selection & Conjugate Power Pair Protection", () => {
  const advisor = new AlgebraicLoopAdvisor();

  // Loop with two couplings:
  // 1. Power bond (torque * speed)
  // 2. Control setpoint signal
  const couplings: VariableCoupling[] = [
    {
      from: { participantId: "Motor", variableName: "torque", unit: "N.m" },
      to: { participantId: "Load", variableName: "appliedTorque", unit: "N.m" },
      conjugatePair: { effortVariable: "torque", flowVariable: "speed" },
    },
    {
      from: { participantId: "Load", variableName: "feedback", unit: "V" },
      to: { participantId: "Motor", variableName: "sensorInput", unit: "V" },
      interpolation: "HERMITE",
    },
  ];

  const participants = [
    createMockParticipant("Motor", "MotorModel", { canGetAndSetState: false }),
    createMockParticipant("Load", "LoadModel", { canGetAndSetState: false }),
  ];

  const feedthrough = {
    Motor: { torque: ["sensorInput"] },
    Load: { feedback: ["appliedTorque"] },
  };

  const report = advisor.analyze(couplings, participants, feedthrough);
  assert.strictEqual(report.hasLoops, true);
  const rec = report.recommendations[0]!;

  // Must recommend DELAY because participants lack state rollback
  assert.strictEqual(rec.strategy, "delay");
  assert.strictEqual(rec.canUseStateRollback, false);

  // Must choose the non-power feedback edge as the cut coupling
  assert.strictEqual(
    rec.cutCoupling.from.variableName,
    "feedback",
    "Should choose non-power signal as cut edge to protect energy conjugate pair",
  );
  assert.strictEqual(rec.recommendedExtrapolation, "HERMITE");
});

test("AlgebraicLoopAdvisor: Newton-Raphson Recommendation when State Rollback Available", () => {
  const advisor = new AlgebraicLoopAdvisor();

  const couplings: VariableCoupling[] = [
    {
      from: { participantId: "Subsystem1", variableName: "y" },
      to: { participantId: "Subsystem2", variableName: "u" },
    },
    {
      from: { participantId: "Subsystem2", variableName: "y" },
      to: { participantId: "Subsystem1", variableName: "u" },
    },
  ];

  // Both participants support state save/restore
  const participants = [
    createMockParticipant("Subsystem1", "Sub1", { canGetAndSetState: true }),
    createMockParticipant("Subsystem2", "Sub2", { canGetAndSetState: true }),
  ];

  const feedthrough = {
    Subsystem1: { y: ["u"] },
    Subsystem2: { y: ["u"] },
  };

  const report = advisor.analyze(couplings, participants, feedthrough);
  assert.strictEqual(report.hasLoops, true);
  const rec = report.recommendations[0]!;

  assert.strictEqual(rec.strategy, "newton");
  assert.strictEqual(rec.canUseStateRollback, true);
  assert.ok(rec.orderOfAccuracy.includes("Exact"));
  assert.ok(rec.alternativeStrategies.includes("delay"));
});

test("CouplingGraph: Delayed Couplings Break Algebraic Loops via History Extrapolation", () => {
  const graph = new CouplingGraph();

  // Coupling with intentional delay and LINEAR extrapolation
  const delayedCoupling: VariableCoupling = {
    from: { participantId: "P1", variableName: "y" },
    to: { participantId: "P2", variableName: "u" },
    isDelayed: true,
    delaySteps: 1,
    initialValue: 0.0,
    interpolation: "LINEAR",
  };

  graph.addCoupling(delayedCoupling);

  // Step 1 at t = 0.0: Output is 10.0
  const outputs0 = new Map([["P1", new Map([["y", 10.0]])]]);
  const inputs0 = graph.applyCouplings(outputs0, 0.0);
  // Input receives initialValue = 0.0, while 10.0 is buffered for next step
  assert.strictEqual(inputs0.get("P2")?.get("u"), 0.0);

  // Step 2 at t = 1.0: Output is 20.0
  const outputs1 = new Map([["P1", new Map([["y", 20.0]])]]);
  const inputs1 = graph.applyCouplings(outputs1, 1.0);
  // Receives the previous 10.0
  assert.strictEqual(inputs1.get("P2")?.get("u"), 10.0);

  // Step 3 at t = 2.0 with linear extrapolation:
  // History has (0, 10.0) and (1, 20.0). Slope = 10.0 / 1.0 = 10.
  // Extrapolated at t = 2.0: 20.0 + 10.0 * (2.0 - 1.0) = 30.0!
  const outputs2 = new Map([["P1", new Map([["y", 30.0]])]]);
  const inputs2 = graph.applyCouplings(outputs2, 2.0);
  const extrapolatedVal = inputs2.get("P2")?.get("u") as number;
  assert.ok(
    Math.abs(extrapolatedVal - 30.0) < 1e-6,
    `Linear extrapolation on delayed coupling should yield 30.0, got ${extrapolatedVal}`,
  );
});

test("FMI ModelDescription: Extract Direct Feedthrough from XML", () => {
  const xmlFmi2 = `<?xml version="1.0" encoding="UTF-8"?>
<fmiModelDescription fmiVersion="2.0" modelName="FeedthroughTest" guid="{1234}">
  <ModelVariables>
    <ScalarVariable name="u1" valueReference="1" causality="input" variability="continuous">
      <Real start="0.0"/>
    </ScalarVariable>
    <ScalarVariable name="u2" valueReference="2" causality="input" variability="continuous">
      <Real start="0.0"/>
    </ScalarVariable>
    <ScalarVariable name="y_feed" valueReference="3" causality="output" variability="continuous">
      <Real/>
    </ScalarVariable>
    <ScalarVariable name="y_nofeed" valueReference="4" causality="output" variability="continuous">
      <Real/>
    </ScalarVariable>
  </ModelVariables>
  <ModelStructure>
    <Outputs>
      <!-- y_feed (index 3) depends directly on u1 (index 1) -->
      <Unknown index="3" dependencies="1" dependenciesKind="dependent"/>
      <!-- y_nofeed (index 4) has dependencies="" (no direct feedthrough) -->
      <Unknown index="4" dependencies=""/>
    </Outputs>
  </ModelStructure>
</fmiModelDescription>`;

  const desc2 = parseModelDescription(xmlFmi2);
  const feedthrough2 = extractDirectFeedthroughFromModelDescription(desc2);

  assert.ok(feedthrough2.has("y_feed"));
  assert.ok(feedthrough2.get("y_feed")?.has("u1"), "y_feed must depend on u1");
  assert.strictEqual(feedthrough2.get("y_feed")?.has("u2"), false, "y_feed must not depend on u2");

  assert.ok(feedthrough2.has("y_nofeed"));
  assert.strictEqual(
    feedthrough2.get("y_nofeed")?.size,
    0,
    "y_nofeed has empty dependencies attribute and must have no direct feedthrough",
  );
});

test("Orchestrator Integration: Auto-Remediation of Algebraic Loop during Run", async () => {
  const session = new CoSimSession(
    "loop-session-1",
    { startTime: 0.0, stopTime: 0.03, stepSize: 0.01 },
    0,
    "gauss-seidel",
  );

  const pA = createMockParticipant("A", "ModelA", {
    directFeedthrough: { y: ["u"] },
  });
  const pB = createMockParticipant("B", "ModelB", {
    directFeedthrough: { y: ["u"] },
  });

  session.addParticipant(pA);
  session.addParticipant(pB);

  // Add cyclic couplings: A.y -> B.u, B.y -> A.u
  session.addCoupling({
    from: { participantId: "A", variableName: "y" },
    to: { participantId: "B", variableName: "u" },
  });
  session.addCoupling({
    from: { participantId: "B", variableName: "y" },
    to: { participantId: "A", variableName: "u" },
  });

  // Enable auto-remediation
  session.autoRemediateLoops = true;

  let loopReportReceived = false;
  const orchestrator = new Orchestrator(session, null, {
    onAlgebraicLoop: (report) => {
      loopReportReceived = true;
      assert.strictEqual(report.hasLoops, true);
      assert.strictEqual(report.loops.length, 1);
    },
  });

  // Advise loops before run
  const advice = orchestrator.adviseLoops();
  assert.strictEqual(advice.hasLoops, true);

  // Run simulation
  await orchestrator.run();

  assert.strictEqual(loopReportReceived, true, "onAlgebraicLoop callback must be invoked");
  assert.strictEqual(session.state, "completed", "Simulation must complete successfully after auto-remediation");

  // Verify that one coupling was decoupled with isDelayed
  const delayedCoupling = session.coupling.getAll().find((c) => c.isDelayed);
  assert.ok(delayedCoupling, "Auto-remediation must have inserted delay on one coupling");
  assert.strictEqual(delayedCoupling.delaySteps, 1);
});
