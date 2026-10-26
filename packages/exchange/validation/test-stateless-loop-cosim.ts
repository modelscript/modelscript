// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CoSimSession,
  CouplingGraph,
  Orchestrator,
  PassivityObserver,
  StatelessLoopPredictor,
  type CoSimParticipant,
  type CosimValue,
  type ParticipantMetadata,
} from "../src/cosim/index.js";

/** Mock stateless participant lacking state save/restore (canGetAndSetState = false). */
class StatelessSubsystemParticipant implements CoSimParticipant {
  readonly id: string;
  readonly modelName = "StatelessSubsystem";
  readonly metadata: ParticipantMetadata;
  readonly canGetAndSetState = false;

  private readonly gain: number;
  private readonly offset: number;
  public inputVal = 0.0;
  public outputVal = 0.0;

  constructor(id: string, gain: number, offset = 0.0) {
    this.id = id;
    this.gain = gain;
    this.offset = offset;
    this.metadata = {
      participantId: id,
      modelName: this.modelName,
      variables: [
        { name: "u", causality: "input", type: "Real" },
        { name: "y", causality: "output", type: "Real" },
      ],
    };
  }

  async initialize(_start: number, _stop: number, _step: number): Promise<void> {
    this.inputVal = 0.0;
    this.outputVal = this.offset;
  }

  async doStep(_t: number, _h: number): Promise<void> {
    // Immediate algebraic feedthrough: y = gain * u + offset
    this.outputVal = this.gain * this.inputVal + this.offset;
  }

  async getOutputs(): Promise<Map<string, CosimValue>> {
    return new Map([["y", this.outputVal]]);
  }

  async setInputs(inputs: Map<string, CosimValue>): Promise<void> {
    if (inputs.has("u")) {
      this.inputVal = Number(inputs.get("u"));
    }
  }

  async terminate(): Promise<void> {}
}

describe("Stateless Predictor-Corrector & Passivity Damping Tests", () => {
  it("extrapolates dynamic inputs with Adams-Bashforth-2 polynomial predictor", () => {
    const predictor = new StatelessLoopPredictor();
    const graph = new CouplingGraph();
    graph.addCoupling({
      from: { participantId: "p1", variableName: "pos" },
      to: { participantId: "p2", variableName: "in_pos" },
    });

    // Quadratic position profile: y(t) = 10 * t^2
    // t=0: y=0, t=0.1: y=0.1, t=0.2: y=0.4.
    // Predict at t=0.3: should be close to 0.9.
    const h = 0.1;

    // Sample 1: t = 0.0, y = 0.0
    predictor.predictInputs(graph.getAll(), new Map([["p1", new Map([["pos", 0.0]])]]), 0.0, h);

    // Sample 2: t = 0.1, y = 0.1
    predictor.predictInputs(graph.getAll(), new Map([["p1", new Map([["pos", 0.1]])]]), 0.1, h);

    // Sample 3: t = 0.2, y = 0.4 -> predict for t = 0.3
    const pred3 = predictor.predictInputs(graph.getAll(), new Map([["p1", new Map([["pos", 0.4]])]]), 0.2, h);

    const val03 = pred3.get("p2")?.get("in_pos") as number;
    // For quadratic curve y = 10*t^2, value at 0.3 is 10 * 0.09 = 0.9
    assert.ok(Math.abs(val03 - 0.9) < 0.05, `Expected quadratic extrapolation ~0.9, got ${val03}`);
  });

  it("applies Aitken delta-squared acceleration to dampen oscillations", () => {
    const predictor = new StatelessLoopPredictor({ minRelaxation: 0.2, maxRelaxation: 1.0 });

    // Oscillating error sequence: e_0 = 10, e_1 = -8, e_2 = 6, e_3 = -4.5
    const val1 = predictor.applyAitkenRelaxation("loop1", 10.0, 0.0);
    assert.strictEqual(val1, 10.0);

    // Second iteration with sign flip (oscillation)
    const val2 = predictor.applyAitkenRelaxation("loop1", -8.0, 10.0);
    // Aitken should compute an under-relaxation factor omega < 1.0
    assert.ok(val2 > -8.0, `Aitken damping should pull back overshoot, got ${val2}`);
  });

  it("injects virtual interface damping when non-physical energy is generated", () => {
    const predictor = new StatelessLoopPredictor({ enablePassivityDamping: true });
    const po = new PassivityObserver();

    // Step 1: Passive baseline (effort = 10, flow = 2 => Power = +20W)
    const res1 = predictor.applyPassivityCorrection(po, 0.0, 10.0, 2.0);
    assert.strictEqual(res1.dampingResistance, 0.0);
    assert.strictEqual(res1.effortDamped, 10.0);

    // Step 2: Negative power injection (effort = -50, flow = 2 => Power = -100W)
    for (let k = 0; k < 10; k++) {
      predictor.applyPassivityCorrection(po, (k + 1) * 0.01, -50.0, 2.0);
    }
    const resDamped = predictor.applyPassivityCorrection(po, 0.11, -50.0, 2.0);

    // Active energy was generated -> Passivity observer triggers damping
    assert.ok(resDamped.dampingResistance > 0.0, "Must calculate positive damping resistance");
    // Effort should be damped toward stability
    assert.ok(resDamped.effortDamped < -50.0, "Damped effort should counter energy injection");
  });

  it("runs closed-loop co-simulation across stateless participants stably", async () => {
    const session = new CoSimSession(
      "stateless-loop",
      { startTime: 0.0, stopTime: 0.1, stepSize: 0.01 },
      0,
      "newton", // Select Newton mode -> orchestrator uses StatelessLoopPredictor when canGetAndSetState = false
      1e-4,
    );

    // SubA: y_A = -0.5 * u_A + 2.0
    const subA = new StatelessSubsystemParticipant("subA", -0.5, 2.0);
    // SubB: y_B = 0.5 * u_B
    const subB = new StatelessSubsystemParticipant("subB", 0.5, 0.0);

    session.addParticipant(subA);
    session.addParticipant(subB);

    // Cyclic algebraic coupling:
    // SubA.y -> SubB.u
    session.coupling.addCoupling({
      from: { participantId: "subA", variableName: "y" },
      to: { participantId: "subB", variableName: "u" },
    });
    // SubB.y -> SubA.u
    session.coupling.addCoupling({
      from: { participantId: "subB", variableName: "y" },
      to: { participantId: "subA", variableName: "u" },
    });

    let statelessSteps = 0;
    const orchestrator = new Orchestrator(session, null, {
      onJacobianConvergence: (stats) => {
        if (stats.method === "stateless") {
          statelessSteps++;
        }
      },
    });

    await orchestrator.run();

    assert.strictEqual(session.state, "completed");
    assert.strictEqual(statelessSteps, 10); // 10 communication steps

    // Theoretical equilibrium:
    // u_A = y_B = 0.5 * u_B
    // u_B = y_A = -0.5 * u_A + 2.0
    // u_B = -0.5 * (0.5 * u_B) + 2.0 = -0.25 * u_B + 2.0
    // 1.25 * u_B = 2.0 => u_B = 1.6, y_A = 1.6, y_B = 0.8
    assert.ok(Math.abs(subA.outputVal - 1.6) < 0.2, `SubA output should approach 1.6, got ${subA.outputVal}`);
    assert.ok(Math.abs(subB.outputVal - 0.8) < 0.2, `SubB output should approach 0.8, got ${subB.outputVal}`);
  });
});
