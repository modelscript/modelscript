// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CouplingGraph, type CosimValue, type VariableCoupling } from "../src/cosim/coupling.js";
import type { ParticipantMetadata } from "../src/cosim/mqtt/protocol.js";
import { Orchestrator, type OrchestratorCallbacks } from "../src/cosim/orchestrator.js";
import type { CoSimParticipant } from "../src/cosim/participant.js";
import { CoSimSession } from "../src/cosim/session.js";

/** Mock CoSimParticipant implementation for master algorithm testing. */
class MockParticipant implements CoSimParticipant {
  readonly id: string;
  readonly modelName: string;
  readonly metadata: ParticipantMetadata;
  readonly canGetAndSetState: boolean;

  currentTime = 0;
  stepCount = 0;
  initialized = false;
  terminated = false;

  inputs = new Map<string, CosimValue>();
  outputs = new Map<string, CosimValue>();
  parameters = new Map<string, CosimValue>();
  state: { time: number; stepCount: number; outputs: Record<string, CosimValue> } = {
    time: 0,
    stepCount: 0,
    outputs: {},
  };

  private readonly stepBehavior?: (p: MockParticipant, t: number, h: number) => Promise<void> | void;

  constructor(
    id: string,
    modelName: string,
    options: {
      canGetAndSetState?: boolean;
      initialOutputs?: Record<string, CosimValue>;
      stepBehavior?: (p: MockParticipant, t: number, h: number) => Promise<void> | void;
    } = {},
  ) {
    this.id = id;
    this.modelName = modelName;
    this.canGetAndSetState = options.canGetAndSetState ?? true;
    this.stepBehavior = options.stepBehavior;

    if (options.initialOutputs) {
      for (const [k, v] of Object.entries(options.initialOutputs)) {
        this.outputs.set(k, v);
      }
    }

    this.metadata = {
      participantId: id,
      modelName,
      variables: [],
    };
  }

  async initialize(startTime: number, _stopTime: number, _stepSize: number): Promise<void> {
    this.initialized = true;
    this.currentTime = startTime;
    this.stepCount = 0;
    this.saveInternalState();
  }

  async doStep(currentTime: number, stepSize: number): Promise<void> {
    this.currentTime = currentTime + stepSize;
    this.stepCount++;

    if (this.stepBehavior) {
      await this.stepBehavior(this, currentTime, stepSize);
    }
    this.saveInternalState();
  }

  async getOutputs(): Promise<Map<string, CosimValue>> {
    return new Map(this.outputs);
  }

  async setInputs(values: Map<string, CosimValue>): Promise<void> {
    for (const [k, v] of values) {
      this.inputs.set(k, v);
    }
  }

  async setParameters(values: Map<string, CosimValue>): Promise<void> {
    for (const [k, v] of values) {
      this.parameters.set(k, v);
    }
  }

  async getState(): Promise<unknown> {
    return JSON.parse(JSON.stringify(this.state));
  }

  async setState(saved: unknown): Promise<void> {
    const s = saved as typeof this.state;
    this.currentTime = s.time;
    this.stepCount = s.stepCount;
    this.outputs.clear();
    for (const [k, v] of Object.entries(s.outputs)) {
      this.outputs.set(k, v);
    }
    this.saveInternalState();
  }

  async terminate(): Promise<void> {
    this.terminated = true;
  }

  private saveInternalState(): void {
    const outRecord: Record<string, CosimValue> = {};
    for (const [k, v] of this.outputs) {
      outRecord[k] = v;
    }
    this.state = {
      time: this.currentTime,
      stepCount: this.stepCount,
      outputs: outRecord,
    };
  }
}

describe("Co-Simulation Orchestrator & Master Algorithm Unit Tests", () => {
  describe("CouplingGraph", () => {
    it("manages couplings, detects duplicate inputs, and filters by participant", () => {
      const graph = new CouplingGraph();

      const c1: VariableCoupling = {
        from: { participantId: "p1", variableName: "out1" },
        to: { participantId: "p2", variableName: "in1" },
      };
      const c2: VariableCoupling = {
        from: { participantId: "p1", variableName: "out2" },
        to: { participantId: "p3", variableName: "in1" },
      };

      graph.addCoupling(c1);
      graph.addCoupling(c2);

      assert.strictEqual(graph.getAll().length, 2);
      assert.strictEqual(graph.getOutputCouplings("p1").length, 2);
      assert.strictEqual(graph.getInputCouplings("p2").length, 1);

      // Duplicate target should throw
      assert.throws(
        () =>
          graph.addCoupling({
            from: { participantId: "p4", variableName: "another_out" },
            to: { participantId: "p2", variableName: "in1" },
          }),
        /already coupled/,
      );

      // Remove coupling
      graph.removeCoupling({ participantId: "p1", variableName: "out1" });
      assert.strictEqual(graph.getAll().length, 1);

      graph.clear();
      assert.strictEqual(graph.getAll().length, 0);
    });

    it("validates unit compatibility (exact, convertible warning, incompatible error)", () => {
      const graph = new CouplingGraph();

      // Exact match
      graph.addCoupling({
        from: { participantId: "p1", variableName: "v1", unit: "m/s" },
        to: { participantId: "p2", variableName: "u1", unit: "m/s" },
      });

      // Convertible units
      graph.addCoupling({
        from: { participantId: "p1", variableName: "v2", unit: "km/h" },
        to: { participantId: "p2", variableName: "u2", unit: "m/s" },
      });

      // Incompatible units
      graph.addCoupling({
        from: { participantId: "p1", variableName: "v3", unit: "kg" },
        to: { participantId: "p2", variableName: "u3", unit: "m" },
      });

      const warnings = graph.validateUnits();
      assert.strictEqual(warnings.length, 2);

      const warn = warnings.find((w) => w.severity === "warning");
      assert.ok(warn);
      assert.strictEqual(warn.fromUnit, "km/h");
      assert.strictEqual(warn.toUnit, "m/s");

      const err = warnings.find((w) => w.severity === "error");
      assert.ok(err);
      assert.strictEqual(err.fromUnit, "kg");
      assert.strictEqual(err.toUnit, "m");
    });

    it("applies couplings with auto unit conversion and preserves binary values", () => {
      const graph = new CouplingGraph();

      // 90 km/h should convert to 25 m/s
      graph.addCoupling({
        from: { participantId: "p1", variableName: "speed", unit: "km/h" },
        to: { participantId: "p2", variableName: "speed_ms", unit: "m/s" },
      });

      // 2.5 bar should convert to 250,000 Pa
      graph.addCoupling({
        from: { participantId: "p1", variableName: "pressure", unit: "bar" },
        to: { participantId: "p2", variableName: "p_pascal", unit: "Pa" },
      });

      // Binary payload
      const binaryPayload = new Uint8Array([1, 2, 3, 4, 5]);
      graph.addCoupling({
        from: { participantId: "p1", variableName: "mesh" },
        to: { participantId: "p2", variableName: "mesh_in" },
      });

      const allOutputs = new Map<string, Map<string, CosimValue>>();
      const p1Outputs = new Map<string, CosimValue>();
      p1Outputs.set("speed", 90);
      p1Outputs.set("pressure", 2.5);
      p1Outputs.set("mesh", binaryPayload);
      allOutputs.set("p1", p1Outputs);

      const appliedInputs = graph.applyCouplings(allOutputs);
      const p2Inputs = appliedInputs.get("p2");
      assert.ok(p2Inputs);

      const convertedSpeed = p2Inputs.get("speed_ms") as number;
      assert.ok(Math.abs(convertedSpeed - 25) < 1e-6);

      const convertedPressure = p2Inputs.get("p_pascal") as number;
      assert.ok(Math.abs(convertedPressure - 250000) < 1e-6);

      const receivedBinary = p2Inputs.get("mesh_in") as Uint8Array;
      assert.deepStrictEqual(receivedBinary, binaryPayload);
    });
  });

  describe("CoSimSession Lifecycle", () => {
    it("handles participant registration, state transitions, and tunable parameters", () => {
      const session = new CoSimSession("sess-1", { startTime: 0, stopTime: 10, stepSize: 0.1 });
      assert.strictEqual(session.state, "created");

      const p1 = new MockParticipant("part1", "ModelA");
      session.addParticipant(p1);
      assert.strictEqual(session.participants.size, 1);

      // Cannot add duplicate
      assert.throws(() => session.addParticipant(p1), /already exists/);

      // Queue parameter changes
      session.queueParameterChange("part1", "kp", 12.5);
      session.queueParameterChange("part1", "ki", 0.8);

      const drained = session.drainParameterChanges();
      assert.strictEqual(drained.size, 1);
      const part1Params = drained.get("part1");
      assert.ok(part1Params);
      assert.strictEqual(part1Params.get("kp"), 12.5);
      assert.strictEqual(part1Params.get("ki"), 0.8);

      // After drain, pending parameters are empty
      assert.strictEqual(session.drainParameterChanges().size, 0);

      // State transitions
      session.transition("initializing");
      assert.strictEqual(session.state, "initializing");

      // Cannot add participant when not in 'created' state
      const p2 = new MockParticipant("part2", "ModelB");
      assert.throws(() => session.addParticipant(p2), /Cannot add participants/);

      session.transition("running");
      session.transition("paused");
      session.transition("running");
      session.transition("completed");
      assert.strictEqual(session.state, "completed");
    });
  });

  describe("Orchestrator Master Algorithms", () => {
    it("runs Gauss-Seidel master algorithm from start to completion", async () => {
      const session = new CoSimSession("gs-sess", { startTime: 0, stopTime: 0.05, stepSize: 0.01 }, 0, "gauss-seidel");

      // Part1: emits x = t * 10
      const p1 = new MockParticipant("p1", "Producer", {
        initialOutputs: { x: 0 },
        stepBehavior: (p, t, h) => {
          p.outputs.set("x", (t + h) * 10);
        },
      });

      // Part2: reads u, emits y = u * 2
      const p2 = new MockParticipant("p2", "Consumer", {
        initialOutputs: { y: 0 },
        stepBehavior: (p) => {
          const u = (p.inputs.get("u") as number) ?? 0;
          p.outputs.set("y", u * 2);
        },
      });

      session.addParticipant(p1);
      session.addParticipant(p2);

      session.coupling.addCoupling({
        from: { participantId: "p1", variableName: "x" },
        to: { participantId: "p2", variableName: "u" },
      });

      const stepResults: number[] = [];
      const stateChanges: string[] = [];

      const callbacks: OrchestratorCallbacks = {
        onStep: (res) => {
          stepResults.push(res.time);
        },
        onStateChange: (st) => {
          stateChanges.push(st);
        },
      };

      const orchestrator = new Orchestrator(session, null, callbacks);
      await orchestrator.run();

      assert.strictEqual(session.state, "completed");
      assert.strictEqual(p1.terminated, true);
      assert.strictEqual(p2.terminated, true);

      // 5 steps: 0.01, 0.02, 0.03, 0.04, 0.05
      assert.strictEqual(stepResults.length, 5);
      assert.ok(Math.abs(stepResults[stepResults.length - 1] - 0.05) < 1e-9);

      // Final output of p1 at t=0.05: x = 0.05 * 10 = 0.5
      assert.ok(Math.abs((p1.outputs.get("x") as number) - 0.5) < 1e-9);
      // p2 received u=0.4 at start of last step, y = 0.4 * 2 = 0.8
      assert.ok(Math.abs((p2.outputs.get("y") as number) - 0.8) < 1e-9);
    });

    it("runs Jacobi master algorithm with parallel execution", async () => {
      const session = new CoSimSession("jacobi-sess", { startTime: 0, stopTime: 0.04, stepSize: 0.01 }, 0, "jacobi");

      const p1 = new MockParticipant("p1", "Worker1", {
        initialOutputs: { val1: 1 },
        stepBehavior: (p) => {
          const current = (p.outputs.get("val1") as number) ?? 0;
          p.outputs.set("val1", current + 1);
        },
      });

      const p2 = new MockParticipant("p2", "Worker2", {
        initialOutputs: { val2: 10 },
        stepBehavior: (p) => {
          const current = (p.outputs.get("val2") as number) ?? 0;
          p.outputs.set("val2", current + 10);
        },
      });

      session.addParticipant(p1);
      session.addParticipant(p2);

      const orchestrator = new Orchestrator(session, null);
      await orchestrator.run();

      assert.strictEqual(session.state, "completed");
      assert.strictEqual(p1.stepCount, 4);
      assert.strictEqual(p2.stepCount, 4);
    });

    it("runs Richardson master algorithm with adaptive step estimation", async () => {
      const session = new CoSimSession(
        "richardson-sess",
        { startTime: 0, stopTime: 0.04, stepSize: 0.02 },
        0,
        "richardson",
        1e-3,
      );

      // Stateful exponential decay participant
      const p1 = new MockParticipant("p1", "Decay", {
        canGetAndSetState: true,
        initialOutputs: { x: 1.0 },
        stepBehavior: (p, _t, h) => {
          const prev = (p.outputs.get("x") as number) ?? 1.0;
          // Euler step for dx/dt = -x
          p.outputs.set("x", prev * (1 - h));
        },
      });

      session.addParticipant(p1);

      const orchestrator = new Orchestrator(session, null);
      await orchestrator.run();

      assert.strictEqual(session.state, "completed");
      assert.strictEqual(p1.terminated, true);
    });

    it("runs Implicit Newton master algorithm with iterative fixed point loop", async () => {
      const session = new CoSimSession("newton-sess", { startTime: 0, stopTime: 0.03, stepSize: 0.01 }, 0, "newton");

      const p1 = new MockParticipant("p1", "SubA", {
        canGetAndSetState: true,
        initialOutputs: { a_out: 0 },
        stepBehavior: (p) => {
          const inB = (p.inputs.get("b_in") as number) ?? 0;
          p.outputs.set("a_out", 0.5 * inB + 1.0);
        },
      });

      const p2 = new MockParticipant("p2", "SubB", {
        canGetAndSetState: true,
        initialOutputs: { b_out: 0 },
        stepBehavior: (p) => {
          const inA = (p.inputs.get("a_in") as number) ?? 0;
          p.outputs.set("b_out", 0.5 * inA);
        },
      });

      session.addParticipant(p1);
      session.addParticipant(p2);

      session.coupling.addCoupling({
        from: { participantId: "p1", variableName: "a_out" },
        to: { participantId: "p2", variableName: "a_in" },
      });
      session.coupling.addCoupling({
        from: { participantId: "p2", variableName: "b_out" },
        to: { participantId: "p1", variableName: "b_in" },
      });

      const orchestrator = new Orchestrator(session, null);
      await orchestrator.run();

      assert.strictEqual(session.state, "completed");
      assert.strictEqual(p1.terminated, true);
      assert.strictEqual(p2.terminated, true);
    });

    it("supports pause, resume, and abort controls", async () => {
      const session = new CoSimSession("control-sess", { startTime: 0, stopTime: 2.0, stepSize: 0.1 });
      const p1 = new MockParticipant("p1", "LongTask", {
        stepBehavior: async () => {
          await new Promise((r) => setTimeout(r, 20));
        },
      });
      session.addParticipant(p1);

      const orchestrator = new Orchestrator(session, null);

      // Start running in background
      const runPromise = orchestrator.run();

      // Give it a moment to enter running state
      await new Promise((r) => setTimeout(r, 10));

      orchestrator.pause();
      assert.strictEqual(session.state, "paused");

      orchestrator.resume();
      assert.strictEqual(session.state, "running");

      orchestrator.abort();
      await runPromise;

      assert.strictEqual(session.state, "failed");
      assert.strictEqual(session.error, "Simulation aborted");
    });

    it("aborts simulation when incompatible units are detected", async () => {
      const session = new CoSimSession("unit-err-sess", { startTime: 0, stopTime: 1.0, stepSize: 0.1 });
      const p1 = new MockParticipant("p1", "Source");
      const p2 = new MockParticipant("p2", "Sink");
      session.addParticipant(p1);
      session.addParticipant(p2);

      // Incompatible unit coupling
      session.coupling.addCoupling({
        from: { participantId: "p1", variableName: "force", unit: "N" },
        to: { participantId: "p2", variableName: "temp", unit: "K" },
      });

      let unitWarningsReported = false;
      let errorReported = false;

      const orchestrator = new Orchestrator(session, null, {
        onUnitWarning: () => {
          unitWarningsReported = true;
        },
        onError: () => {
          errorReported = true;
        },
      });

      await orchestrator.run();

      assert.strictEqual(session.state, "failed");
      assert.ok(session.error?.includes("Unit incompatibilities detected"));
      assert.strictEqual(unitWarningsReported, true);
      assert.strictEqual(errorReported, true);
    });
  });
});
