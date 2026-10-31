// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder, initBltWasm } from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import { SysML2DaeLowerer } from "../src/sysml2-dae-lowerer.js";

describe("SysML v2 Direct DAE Arena Lowering & Execution", () => {
  it("lowers arithmetic and comparison expressions into DAE arena ExprIds", async () => {
    await initBltWasm();
    const arena = new DAEBuilder();

    const expr1 = SysML2DaeLowerer.lowerExpression("2.0 * x + 5.0", arena);
    assert(expr1 >= 0, "ExprId should be non-negative");

    const expr2 = SysML2DaeLowerer.lowerExpression("(a + b) * (c - d) / 2.0", arena);
    assert(expr2 >= 0);

    const expr3 = SysML2DaeLowerer.lowerExpression("x > 0.0 && y <= 10.0", arena);
    assert(expr3 >= 0);
  });

  it("lowers an action with assignments and executes with concrete inputs", async () => {
    const actionSysml = `
      action def ComputeTelemetry {
        in item voltage : Real;
        in item current : Real;
        out item power : Real;
        out item resistance : Real;

        assign power := voltage * current;
        assign resistance := voltage / current;
      }
    `;

    const lowered = await SysML2DaeLowerer.lowerAction(actionSysml);
    assert.strictEqual(lowered.name, "ComputeTelemetry");
    assert.deepStrictEqual(lowered.inputs, ["voltage", "current"]);
    assert.deepStrictEqual(lowered.outputs, ["power", "resistance"]);
    assert(lowered.stmtCount >= 2);

    const outputs = SysML2DaeLowerer.execute(lowered, {
      voltage: 12.0,
      current: 3.0,
    });

    assert.strictEqual(outputs["power"], 36.0);
    assert.strictEqual(outputs["resistance"], 4.0);
  });

  it("lowers conditional if/else logic and executes branches", async () => {
    const actionSysml = `
      action def ClampSpeed {
        in item speedIn : Real;
        out item speedOut : Real;

        if (speedIn > 100.0) {
          assign speedOut := 100.0;
        } else {
          assign speedOut := speedIn;
        }
      }
    `;

    const lowered = await SysML2DaeLowerer.lowerAction(actionSysml);
    assert.strictEqual(lowered.name, "ClampSpeed");

    // Branch 1: speed > 100
    const outHigh = SysML2DaeLowerer.execute(lowered, { speedIn: 150.0 });
    assert.strictEqual(outHigh["speedOut"], 100.0);

    // Branch 2: speed <= 100
    const outNormal = SysML2DaeLowerer.execute(lowered, { speedIn: 75.0 });
    assert.strictEqual(outNormal["speedOut"], 75.0);
  });

  it("lowers a while loop and executes iteration", async () => {
    const actionSysml = `
      action def Accumulate {
        in item count : Real;
        out item total : Real;

        assign total := 0.0;
        assign i := 0.0;

        while (i < count) {
          assign total := total + 2.0;
          assign i := i + 1.0;
        }
      }
    `;

    const lowered = await SysML2DaeLowerer.lowerAction(actionSysml);
    assert.strictEqual(lowered.name, "Accumulate");

    const result = SysML2DaeLowerer.execute(lowered, { count: 5.0 });
    assert.strictEqual(result["total"], 10.0);
  });

  it("lowers a calculation definition with return statement", async () => {
    const calcSysml = `
      calc def SquareAndAdd {
        in item x : Real;
        in item y : Real;
        return result : Real;

        assign temp := x * x;
        return temp + y;
      }
    `;

    const lowered = await SysML2DaeLowerer.lowerAction(calcSysml);
    assert.strictEqual(lowered.name, "SquareAndAdd");
    assert(lowered.outputs.includes("result"));
  });

  it("lowers and executes elementary transcendental and math function calls", async () => {
    const actionSysml = `
      action def MathOps {
        in item val : Real;
        out item root : Real;
        out item sine : Real;

        assign root := sqrt(val);
        assign sine := sin(val);
      }
    `;

    const lowered = await SysML2DaeLowerer.lowerAction(actionSysml);
    assert.deepStrictEqual(lowered.inputs, ["val"]);
    assert.deepStrictEqual(lowered.outputs, ["root", "sine"]);

    const res = SysML2DaeLowerer.execute(lowered, { val: 4.0 });
    assert.strictEqual(res["root"], 2.0);
    assert(Math.abs(res["sine"]! - Math.sin(4.0)) < 1e-6);
  });

  it("lowers physical constraint def with differential der(...) and algebraic equations", async () => {
    const oscillatorSysml = `
      constraint def HarmonicOscillator {
        in attribute m : ScalarValues::Real = 1.0;
        in attribute k : ScalarValues::Real = 100.0;
        in attribute d : ScalarValues::Real = 2.0;
        attribute x : ScalarValues::Real = 1.0;
        attribute v : ScalarValues::Real = 0.0;

        startTime = 0.0;
        stopTime = 5.0;
        step = 0.01;

        der(x) == v;
        m * der(v) + d * v + k * x == 0.0;
      }
    `;

    const lowered = await SysML2DaeLowerer.lowerConstraint(oscillatorSysml);
    assert.strictEqual(lowered.name, "HarmonicOscillator");
    assert.deepStrictEqual(lowered.parameters, ["m", "k", "d"]);
    assert.deepStrictEqual(lowered.states, ["x", "v"]);
    assert(lowered.derivatives.includes("der(x)"));
    assert(lowered.derivatives.includes("der(v)"));
    assert.strictEqual(lowered.eqCount, 2);

    const arena = lowered.arena;
    assert.strictEqual(arena.experiment.startTime, 0.0);
    assert.strictEqual(arena.experiment.stopTime, 5.0);
    assert.strictEqual(arena.experiment.interval, 0.01);
  });

  it("lowers complete SysML v2 part with assert constraint and connections via lowerSystem", async () => {
    const circuitSysml = `
      part def RLC_Circuit {
        attribute R : Real = 10.0;
        attribute L : Real = 0.1;
        attribute C : Real = 0.001;
        attribute v_in : Real = 12.0;
        attribute i : Real = 0.0;
        attribute v_c : Real = 0.0;

        assert constraint {
          der(i) == (v_in - R * i - v_c) / L;
          der(v_c) == i / C;
        }

        connect node_a to node_b;
      }
    `;

    const arena = await SysML2DaeLowerer.lowerSystem(circuitSysml);
    assert(arena.varCount >= 6);
    assert.strictEqual(arena.eqCount, 3); // 2 differential equations + 1 connect equation
  });

  it("lowers hierarchical components and enforces Kirchhoff port conservation laws", async () => {
    const sysmlSource = `
      port def Pin {
        attribute v : Real;
        flow attribute i : Real;
      }

      part def Resistor {
        attribute R : Real = 100.0;
        port p : Pin;
        port n : Pin;
        attribute v : Real = 0.0;
        attribute i : Real = 0.0;

        p.v - n.v == v;
        p.i == i;
        n.i == -i;
        v == R * i;
      }

      part def Capacitor {
        attribute C : Real = 0.01;
        port p : Pin;
        port n : Pin;
        attribute v : Real = 0.0;
        attribute i : Real = 0.0;

        p.v - n.v == v;
        p.i == i;
        n.i == -i;
        C * der(v) == i;
      }

      part def Circuit {
        part r1 : Resistor {
          attribute R = 50.0;
        }
        part c1 : Capacitor {
          attribute C = 0.02;
        }
        connect r1.n to c1.p;
      }
    `;

    const arena = await SysML2DaeLowerer.lowerSystem(sysmlSource);
    // r1 vars (R, v, i, p.v, p.i, n.v, n.i) = 7
    // c1 vars (C, v, i, p.v, p.i, n.v, n.i) = 7
    assert(arena.varCount >= 14);

    // r1 equations = 4, c1 equations = 4
    // connect r1.n to c1.p creates:
    // 1 potential equality (r1.n.v == c1.p.v)
    // 1 Kirchhoff flow conservation (r1.n.i + c1.p.i == 0.0)
    // Total = 4 + 4 + 1 + 1 = 10 equations
    assert.strictEqual(arena.eqCount, 10);
  });

  it("lowers hybrid continuous-discrete when event blocks", async () => {
    const ballSysml = `
      part def BouncingBall {
        attribute h : Real = 10.0;
        attribute v : Real = 0.0;
        attribute g : Real = 9.81;
        attribute restitution : Real = 0.8;

        startTime = 0.0;
        stopTime = 3.0;
        step = 0.001;

        der(h) == v;
        der(v) == -g;

        when h <= 0.0 {
          assign v := -restitution * v;
        }
      }
    `;

    const arena = await SysML2DaeLowerer.lowerSystem(ballSysml);
    assert(arena.eqCount >= 3); // 2 der equations + 1 when equation
    assert.strictEqual(arena.experiment.startTime, 0.0);
    assert.strictEqual(arena.experiment.stopTime, 3.0);
    assert.strictEqual(arena.experiment.interval, 0.001);
  });

  it("simulates physical models directly via SysML2DaeLowerer.simulate", async () => {
    const oscillatorSysml = `
      constraint def HarmonicOscillator {
        attribute m : Real = 1.0;
        attribute k : Real = 100.0;
        attribute d : Real = 2.0;
        attribute x : Real = 1.0;
        attribute v : Real = 0.0;

        startTime = 0.0;
        stopTime = 2.0;
        step = 0.01;

        der(x) == v;
        m * der(v) + d * v + k * x == 0.0;
      }
    `;

    const res = await SysML2DaeLowerer.simulate(oscillatorSysml, {
      startTime: 0,
      stopTime: 2.0,
      step: 0.01,
    });

    assert(res.t.length >= 200, "Should have simulated over 200 steps");
    assert(res.states.includes("x"), "States should include x");
    assert(res.states.includes("v"), "States should include v");

    const xIdx = res.states.indexOf("x");
    const x0 = res.y[0]![xIdx]!;
    const xEnd = res.y[res.t.length - 1]![xIdx]!;

    assert.strictEqual(x0, 1.0, "Initial position x(0) should be 1.0");
    assert(Math.abs(xEnd) < 0.6, "Final position x(2) should be damped");
  });

  it("parses and executes nested if/else-if/else, while loops, and multi-line compound expressions via recursive descent", async () => {
    const complexAction = `
      action def AdaptiveController {
        in item rawError : Real;
        in item maxSteps : Real;
        out item controlSignal : Real;
        out item iterations : Real;

        assign iterations := 0.0;
        assign acc := 0.0;

        if (rawError > 10.0) {
          if (rawError > 50.0) {
            assign controlSignal :=
              100.0 + (rawError - 50.0) * 0.5;
          } else {
            assign controlSignal :=
              20.0 + (rawError - 10.0) * 2.0;
          }
        } else if (rawError < -10.0) {
          assign controlSignal := -20.0;
        } else {
          while (iterations < maxSteps) {
            if (iterations < 2.0) {
              assign acc := acc + rawError * 1.5;
            } else {
              assign acc := acc + rawError * 0.5;
            }
            assign iterations := iterations + 1.0;
          }
          assign controlSignal := acc;
        }
      }
    `;

    const lowered = await SysML2DaeLowerer.lowerAction(complexAction);
    assert.strictEqual(lowered.name, "AdaptiveController");

    // Nested inner-then branch (rawError = 70 > 50): 100 + (70 - 50) * 0.5 = 110
    const resVeryHigh = SysML2DaeLowerer.execute(lowered, { rawError: 70.0, maxSteps: 4.0 });
    assert.strictEqual(resVeryHigh["controlSignal"], 110.0);

    // Nested inner-else branch (rawError = 25, 10 < 25 <= 50): 20 + (25 - 10) * 2 = 50
    const resHigh = SysML2DaeLowerer.execute(lowered, { rawError: 25.0, maxSteps: 4.0 });
    assert.strictEqual(resHigh["controlSignal"], 50.0);

    // Else-if branch (rawError = -15 < -10): -20
    const resNeg = SysML2DaeLowerer.execute(lowered, { rawError: -15.0, maxSteps: 4.0 });
    assert.strictEqual(resNeg["controlSignal"], -20.0);

    // Outer else branch with while + nested if/else (rawError = 4, maxSteps = 3):
    // iter 0: acc += 4 * 1.5 = 6
    // iter 1: acc += 4 * 1.5 = 12
    // iter 2: acc += 4 * 0.5 = 14
    const resLoop = SysML2DaeLowerer.execute(lowered, { rawError: 4.0, maxSteps: 3.0 });
    assert.strictEqual(resLoop["controlSignal"], 14.0);
    assert.strictEqual(resLoop["iterations"], 3.0);
  });

  it("evaluates calc def return expressions and early return statements", async () => {
    const calcSysml = `
      calc def PiecewiseEnergy {
        in item mass : Real;
        in item velocity : Real;
        return energy : Real;

        if (velocity <= 0.0) {
          return 0.0;
        }
        return 0.5 * mass * (velocity ^ 2.0);
      }
    `;

    const lowered = await SysML2DaeLowerer.lowerAction(calcSysml);
    const zeroOut = SysML2DaeLowerer.execute(lowered, { mass: 10.0, velocity: -3.0 });
    assert.strictEqual(zeroOut["energy"], 0.0);

    const posOut = SysML2DaeLowerer.execute(lowered, { mass: 4.0, velocity: 5.0 });
    assert.strictEqual(posOut["energy"], 50.0);
  });

  it("lowers hybrid continuous-discrete models containing both part/constraint equations and action/calc blocks into the same DAEBuilder arena", async () => {
    const hybridSysml = `
      part def ThermalPlantWithController {
        attribute T : Real = 300.0;
        attribute T_amb : Real = 290.0;
        attribute tau : Real = 10.0;
        attribute q_heat : Real = 5.0;

        assert constraint {
          der(T) == (T_amb - T) / tau + q_heat;
        }

        action def UpdateHeaterCommand {
          in item T_meas : Real;
          in item T_set : Real;
          out item q_cmd : Real;

          if (T_meas < T_set) {
            assign q_cmd := (T_set - T_meas) * 2.5;
          } else {
            assign q_cmd := 0.0;
          }
        }
      }
    `;

    const arena = await SysML2DaeLowerer.lowerSystem(hybridSysml);
    // Must contain BOTH the continuous differential equation AND the imperative action statements
    assert.strictEqual(arena.eqCount, 1, "Hybrid arena must contain the continuous differential equation");
    assert(arena.stmtCount >= 4, `Hybrid arena must also contain lowered action statements, got ${arena.stmtCount}`);
    assert(arena.lookupVariable("T") !== -1, "Continuous state variable T must be in arena");
    assert(arena.lookupVariable("q_cmd") !== -1, "Discrete action output variable q_cmd must be in arena");
  });
});
