// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CoSimSession,
  CouplingGraph,
  InterfaceJacobianSolver,
  Orchestrator,
  type CoSimParticipant,
  type CosimValue,
  type ParticipantMetadata,
} from "../src/cosim/index.js";

/**
 * Mock participant that computes non-linear algebraic responses and
 * provides exact analytical directional derivatives.
 */
class NonlinearLoadParticipant implements CoSimParticipant {
  readonly id: string;
  readonly modelName = "NonlinearLoad";
  readonly metadata: ParticipantMetadata;
  readonly canGetAndSetState = true;
  readonly providesDirectionalDerivatives = true;

  // Non-linear load: I = 0.01 * V^2 (for V >= 0)
  // Input: voltage V
  // Output: current I
  public voltage = 1.0;
  public current = 0.01;
  private savedState = { voltage: 1.0, current: 0.01 };

  constructor(id: string) {
    this.id = id;
    this.metadata = {
      participantId: id,
      modelName: this.modelName,
      variables: [
        { name: "v_in", causality: "input", type: "Real", unit: "V" },
        { name: "i_out", causality: "output", type: "Real", unit: "A" },
      ],
    };
  }

  async initialize(_start: number, _stop: number, _step: number): Promise<void> {
    this.voltage = 1.0;
    this.current = 0.01;
    this.savedState = { voltage: 1.0, current: 0.01 };
  }

  async doStep(_t: number, _h: number): Promise<void> {
    const v = Math.max(0, this.voltage);
    this.current = 0.01 * v * v;
  }

  async getOutputs(): Promise<Map<string, CosimValue>> {
    return new Map([["i_out", this.current]]);
  }

  async setInputs(inputs: Map<string, CosimValue>): Promise<void> {
    if (inputs.has("v_in")) {
      this.voltage = Number(inputs.get("v_in"));
    }
  }

  async getState(): Promise<unknown> {
    return { ...this.savedState, voltage: this.voltage, current: this.current };
  }

  async setState(state: unknown): Promise<void> {
    const s = state as typeof this.savedState;
    this.voltage = s.voltage;
    this.current = s.current;
  }

  /**
   * Analytical directional derivative: dI / dV = 0.02 * V.
   */
  async getDirectionalDerivative(_unknownRefs: number[], _knownRefs: number[], dvKnown: number[]): Promise<number[]> {
    const v = Math.max(0, this.voltage);
    const dIdV = 0.02 * v;
    return [dIdV * (dvKnown[0] ?? 1.0)];
  }

  async terminate(): Promise<void> {}
}

/**
 * Linear Thevenin Source: V = V_th - R_th * I
 * Input: current I
 * Output: voltage V
 */
class TheveninSourceParticipant implements CoSimParticipant {
  readonly id: string;
  readonly modelName = "TheveninSource";
  readonly metadata: ParticipantMetadata;
  readonly canGetAndSetState = true;
  readonly providesDirectionalDerivatives = true;

  public Vth = 5.0; // 5V
  public Rth = 100.0; // 100 Ohm
  public current = 0.01;
  public voltage = 4.0;
  private savedState = { current: 0.01, voltage: 4.0 };

  constructor(id: string) {
    this.id = id;
    this.metadata = {
      participantId: id,
      modelName: this.modelName,
      variables: [
        { name: "i_in", causality: "input", type: "Real", unit: "A" },
        { name: "v_out", causality: "output", type: "Real", unit: "V" },
      ],
    };
  }

  async initialize(_start: number, _stop: number, _step: number): Promise<void> {
    this.current = 0.01;
    this.voltage = 4.0;
    this.savedState = { current: 0.01, voltage: 4.0 };
  }

  async doStep(_t: number, _h: number): Promise<void> {
    this.voltage = this.Vth - this.Rth * this.current;
  }

  async getOutputs(): Promise<Map<string, CosimValue>> {
    return new Map([["v_out", this.voltage]]);
  }

  async setInputs(inputs: Map<string, CosimValue>): Promise<void> {
    if (inputs.has("i_in")) {
      this.current = Number(inputs.get("i_in"));
    }
  }

  async getState(): Promise<unknown> {
    return { ...this.savedState, current: this.current, voltage: this.voltage };
  }

  async setState(state: unknown): Promise<void> {
    const s = state as typeof this.savedState;
    this.current = s.current;
    this.voltage = s.voltage;
  }

  /**
   * Analytical directional derivative: dV / dI = -R_th.
   */
  async getDirectionalDerivative(_unknownRefs: number[], _knownRefs: number[], dvKnown: number[]): Promise<number[]> {
    return [-this.Rth * (dvKnown[0] ?? 1.0)];
  }

  async terminate(): Promise<void> {}
}

describe("Interface Jacobian Newton-Raphson Solver Tests", () => {
  it("solves dense linear system with LU decomposition and partial pivoting", () => {
    const graph = new CouplingGraph();
    graph.addCoupling({
      from: { participantId: "src", variableName: "y1" },
      to: { participantId: "tgt", variableName: "u1" },
    });
    graph.addCoupling({
      from: { participantId: "tgt", variableName: "y2" },
      to: { participantId: "src", variableName: "u2" },
    });

    const solver = new InterfaceJacobianSolver(graph.getAll());
    assert.strictEqual(solver.dimension, 2);

    // Linear system:
    // [ 3  2 ] [ x1 ] = [ 1 ]  -> residual = [ -1 ]
    // [ 1  4 ] [ x2 ] = [ 2 ]  -> residual = [ -2 ]
    // J * deltaX = -residual = [ 1, 2 ]^T
    // Det = 12 - 2 = 10
    // x1 = (4 - 4)/10 = 0 ? wait:
    // 3*x1 + 2*x2 = 1
    // 1*x1 + 4*x2 = 2 => x1 = 2 - 4*x2 => 3(2 - 4*x2) + 2*x2 = 1 => 6 - 10*x2 = 1 => x2 = 0.5, x1 = 0
    // Column-major flattened: [3, 1, 2, 4]
    const J = new Float64Array([3, 1, 2, 4]);
    const residual = new Float64Array([-1, -2]);

    const deltaU = solver.solveLinearSystem(J, residual);
    assert.ok(Math.abs(deltaU[0]! - 0.0) < 1e-6);
    assert.ok(Math.abs(deltaU[1]! - 0.5) < 1e-6);
  });

  it("handles ill-conditioned / singular Jacobians via Tikhonov regularization", () => {
    const graph = new CouplingGraph();
    graph.addCoupling({
      from: { participantId: "p1", variableName: "y" },
      to: { participantId: "p2", variableName: "u" },
    });
    const solver = new InterfaceJacobianSolver(graph.getAll());

    // Near-zero pivot (singular)
    const J = new Float64Array([1e-15]);
    const residual = new Float64Array([-1.0]);

    // Should not throw or produce NaN/Infinity due to Tikhonov damping
    const deltaU = solver.solveLinearSystem(J, residual);
    assert.ok(Number.isFinite(deltaU[0]!));
  });

  it("applies Broyden rank-1 secant updates accurately", () => {
    const graph = new CouplingGraph();
    graph.addCoupling({
      from: { participantId: "p1", variableName: "y" },
      to: { participantId: "p2", variableName: "u" },
    });
    const solver = new InterfaceJacobianSolver(graph.getAll());

    const J = new Float64Array([1.0]);
    const deltaU = new Float64Array([2.0]);
    const deltaR = new Float64Array([4.0]); // True slope is 2.0

    solver.updateBroyden(J, deltaU, deltaR);
    // J += (deltaR - J*deltaU) / ||deltaU||^2 * deltaU = (4 - 2)/4 * 2 = 1.0 => J = 2.0
    assert.ok(Math.abs(J[0]! - 2.0) < 1e-6);
  });

  it("converges non-linear stiff circuit loop in <= 4 iterations via Orchestrator", async () => {
    const session = new CoSimSession(
      "stiff-diode-loop",
      { startTime: 0.0, stopTime: 0.02, stepSize: 0.01 },
      0,
      "newton",
      1e-5,
    );

    const source = new TheveninSourceParticipant("v_source");
    const load = new NonlinearLoadParticipant("load");

    session.addParticipant(source);
    session.addParticipant(load);

    // Couple source voltage -> load input
    session.coupling.addCoupling({
      from: { participantId: "v_source", variableName: "v_out" },
      to: { participantId: "load", variableName: "v_in" },
    });

    // Couple load current -> source input
    session.coupling.addCoupling({
      from: { participantId: "load", variableName: "i_out" },
      to: { participantId: "v_source", variableName: "i_in" },
    });

    let maxNewtonIterations = 0;
    let convergenceMethod = "";

    const orchestrator = new Orchestrator(session, null, {
      onJacobianConvergence: (stats) => {
        if (stats.iterations > maxNewtonIterations) {
          maxNewtonIterations = stats.iterations;
        }
        convergenceMethod = stats.method;
      },
    });

    await orchestrator.run();

    assert.strictEqual(session.state, "completed");
    // Interface Newton should converge in <= 4 iterations due to quadratic convergence
    assert.ok(maxNewtonIterations <= 4, `Expected <= 4 Newton iterations, took ${maxNewtonIterations}`);
    assert.strictEqual(convergenceMethod, "newton");

    // Theoretical operating point: V^2 + V - 5 = 0 => V = 1.791288 V, I = 32.087 mA
    assert.ok(Math.abs(load.voltage - 1.791288) < 1e-4, `Expected V ~ 1.7913 V, got ${load.voltage}`);
    assert.ok(Math.abs(load.current - 0.032087) < 1e-4, `Expected I ~ 32.087 mA, got ${load.current}`);
  });
});
