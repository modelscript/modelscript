// SPDX-License-Identifier: AGPL-3.0-or-later

import { VarType } from "@modelscript/dsl";
import { Causality, DAEBuilder, EqKind, UnaryOp, Variability, initBltWasm } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ODEProblem } from "../src/core/problem-types.js";
import { ArenaSimulator } from "../src/core/simulate-arena.js";
import { solveSPRK, type HamiltonianProblem, type SPRKTableau } from "../src/solvers/sprk.js";

describe("Symplectic Partitioned Runge-Kutta (SPRK) Solver Suite", () => {
  // ───────────────────────────────────────────────────────────────────────────
  // 1. Harmonic Oscillator: H = 0.5 * p^2 + 0.5 * q^2
  // ───────────────────────────────────────────────────────────────────────────
  describe("Linear Harmonic Oscillator", () => {
    const harmonicProblem: HamiltonianProblem = {
      evaluateQ: (_t, p, _q) => [p[0]!], // dq/dt = p
      evaluateP: (_t, q, _p) => [-q[0]!], // dp/dt = -q
      q0: [1.0],
      p0: [0.0],
      tSpan: [0.0, 100.0], // ~15.9 full periods (2*pi)
    };

    const hamiltonian = (_t: number, q: Float64Array, p: Float64Array) => 0.5 * (p[0]! * p[0]! + q[0]! * q[0]!);

    const tableaus: SPRKTableau[] = ["verlet", "ruth3", "forest-ruth4", "yoshida6", "yoshida8"];

    for (const tab of tableaus) {
      it(`conserves energy over 10,000 steps using ${tab}`, () => {
        const res = solveSPRK(harmonicProblem, {
          method: tab,
          dt: 0.01,
          hamiltonian,
        });

        assert.equal(res.stats.converged, true);
        assert.ok(res.energy !== undefined);
        assert.ok(res.maxEnergyDrift !== undefined);

        // Energy should remain strictly bounded with zero secular growth
        const H0 = 0.5 * (1.0 * 1.0 + 0.0 * 0.0); // 0.5
        const finalE = res.energy![res.energy!.length - 1]!;
        assert.ok(Math.abs(finalE - H0) < 0.01, `Energy drift too high for ${tab}: finalE=${finalE}, H0=${H0}`);

        if (tab === "forest-ruth4") {
          // 4th order should have error < 1e-6
          assert.ok(res.maxEnergyDrift! < 1e-6, `Forest-Ruth 4 max drift: ${res.maxEnergyDrift}`);
        } else if (tab === "yoshida6") {
          // 6th order should have error < 1e-9
          assert.ok(res.maxEnergyDrift! < 1e-9, `Yoshida 6 max drift: ${res.maxEnergyDrift}`);
        } else if (tab === "yoshida8") {
          // 8th order should have error < 1e-11
          assert.ok(res.maxEnergyDrift! < 1e-11, `Yoshida 8 max drift: ${res.maxEnergyDrift}`);
        }
      });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Kepler Two-Body Celestial Problem (e = 0.6)
  // ───────────────────────────────────────────────────────────────────────────
  describe("Kepler Two-Body Orbit (Eccentricity e = 0.6)", () => {
    const e = 0.6;
    const keplerProblem: HamiltonianProblem = {
      evaluateQ: (_t, p, _q) => [p[0]!, p[1]!],
      evaluateP: (_t, q, _p) => {
        const r2 = q[0]! * q[0]! + q[1]! * q[1]!;
        const r3 = Math.pow(r2, 1.5);
        return [-q[0]! / r3, -q[1]! / r3];
      },
      q0: [1.0 - e, 0.0],
      p0: [0.0, Math.sqrt((1.0 + e) / (1.0 - e))],
      tSpan: [0.0, 50.0], // ~8 complete orbits
    };

    const keplerH = (_t: number, q: Float64Array, p: Float64Array) => {
      const r = Math.sqrt(q[0]! * q[0]! + q[1]! * q[1]!);
      return 0.5 * (p[0]! * p[0]! + p[1]! * p[1]!) - 1.0 / r;
    };

    it("exhibits order scaling across Forest-Ruth 4, Yoshida 6, and Yoshida 8", () => {
      const dt = 0.005;

      const res4 = solveSPRK(keplerProblem, { method: "forest-ruth4", dt, hamiltonian: keplerH });
      const res6 = solveSPRK(keplerProblem, { method: "yoshida6", dt, hamiltonian: keplerH });
      const res8 = solveSPRK(keplerProblem, { method: "yoshida8", dt, hamiltonian: keplerH });

      const drift4 = res4.maxEnergyDrift!;
      const drift6 = res6.maxEnergyDrift!;
      const drift8 = res8.maxEnergyDrift!;

      assert.ok(drift4 < 1e-6, `Forest-Ruth 4 drift: ${drift4}`);
      assert.ok(drift6 < 1e-9, `Yoshida 6 drift: ${drift6}`);
      assert.ok(drift8 < 1e-11, `Yoshida 8 drift: ${drift8}`);

      // High-order methods should be strictly more accurate
      assert.ok(drift6 < drift4, "Yoshida 6 must outperform Forest-Ruth 4");
      assert.ok(drift8 < drift6, "Yoshida 8 must outperform Yoshida 6");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Nonlinear Large-Amplitude Pendulum: H = 0.5 * p^2 - cos(q)
  // ───────────────────────────────────────────────────────────────────────────
  describe("Nonlinear Pendulum", () => {
    const pendulumProblem: HamiltonianProblem = {
      evaluateQ: (_t, p, _q) => [p[0]!],
      evaluateP: (_t, q, _p) => [-Math.sin(q[0]!)],
      q0: [2.0], // ~114 degrees (large nonlinear oscillation)
      p0: [0.0],
      tSpan: [0.0, 30.0],
    };

    const pendulumH = (_t: number, q: Float64Array, p: Float64Array) => 0.5 * p[0]! * p[0]! - Math.cos(q[0]!);

    it("preserves energy over large amplitude libration using Forest-Ruth 4", () => {
      const res = solveSPRK(pendulumProblem, {
        method: "forest-ruth4",
        dt: 0.01,
        hamiltonian: pendulumH,
      });

      assert.equal(res.stats.converged, true);
      assert.ok(res.maxEnergyDrift! < 1e-7, `Max drift: ${res.maxEnergyDrift}`);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Partitioned ODEProblem Interface
  // ───────────────────────────────────────────────────────────────────────────
  describe("Partitioned ODEProblem Integration", () => {
    it("partitions state vector y = [q, p] automatically", () => {
      const odeProb: ODEProblem = {
        f: (_t, y) => {
          const q = y[0]!;
          const p = y[1]!;
          return [p, -q]; // dq/dt = p, dp/dt = -q
        },
        y0: [1.0, 0.0],
        tSpan: [0.0, 10.0],
      };

      const res = solveSPRK(odeProb, {
        method: "forest-ruth4",
        dt: 0.01,
        splitIndex: 1,
      });

      assert.equal(res.stats.converged, true);
      assert.equal(res.states[0]!.length, 2);
      assert.equal(res.q[0]!.length, 1);
      assert.equal(res.p[0]!.length, 1);

      // At any time t, exact solution is q = cos(t), p = -sin(t)
      const targetIdx = 628;
      const tAtTarget = res.times[targetIdx]!;
      const qAtTarget = res.q[targetIdx]![0]!;
      const pAtTarget = res.p[targetIdx]![0]!;
      const expectedQ = Math.cos(tAtTarget);
      const expectedP = -Math.sin(tAtTarget);

      assert.ok(Math.abs(qAtTarget - expectedQ) < 1e-6, `q mismatch: got ${qAtTarget}, expected ${expectedQ}`);
      assert.ok(Math.abs(pAtTarget - expectedP) < 1e-6, `p mismatch: got ${pAtTarget}, expected ${expectedP}`);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. ArenaSimulator Dispatch Integration
  // ───────────────────────────────────────────────────────────────────────────
  describe("ArenaSimulator Integration", () => {
    it("simulates a physical oscillator via ArenaSimulator with solver 'forest-ruth4'", async () => {
      await initBltWasm();
      const arena = new DAEBuilder();
      const qIdx = arena.addVariable("q", VarType.Real, Variability.Continuous, Causality.Local, 1.0);
      const pIdx = arena.addVariable("p", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      arena.setVarStartValue(qIdx, 1.0);
      arena.setVarStartValue(pIdx, 0.0);

      const qExpr = arena.addNameExpr("q");
      const pExpr = arena.addNameExpr("p");
      const derQ = arena.addDerExpr(qExpr);
      const derP = arena.addDerExpr(pExpr);

      // der(q) = p
      arena.addEquation(EqKind.Simple, derQ, pExpr);
      // der(p) = -q
      const negQ = arena.addUnaryExpr(UnaryOp.Negate, qExpr);
      arena.addEquation(EqKind.Simple, derP, negQ);

      const sim = new ArenaSimulator(arena);
      sim.prepare();

      const timeId = arena.interner.intern("time");
      const qId = arena.interner.intern("q");
      const pId = arena.interner.intern("p");
      const derQId = arena.interner.intern("der(q)");
      const derPId = arena.interner.intern("der(p)");

      // Initial conditions: q(0) = 1.0, p(0) = 0.0
      const initialValues = new Float64Array(arena.interner.size + 16);
      initialValues[timeId] = 0.0;
      initialValues[qId] = 1.0;
      initialValues[pId] = 0.0;

      const result = sim.simulate(100, 0.05, initialValues, [qId, pId], [derQId, derPId], {
        solver: "forest-ruth4",
        outputStringIds: [qId, pId],
      });

      assert.ok(result.t.length > 50);
      assert.ok(result.y.length > 50);

      // At t = 5.0, exact solution is q = cos(5.0), p = -sin(5.0)
      const lastT = result.t[result.t.length - 1]!;
      const lastY = result.y[result.y.length - 1]!;
      const expectedQ = Math.cos(lastT);
      const expectedP = -Math.sin(lastT);

      assert.ok(
        Math.abs(lastY[0]! - expectedQ) < 1e-3,
        `Arena SPRK q mismatch: got ${lastY[0]}, expected ${expectedQ}`,
      );
      assert.ok(
        Math.abs(lastY[1]! - expectedP) < 1e-3,
        `Arena SPRK p mismatch: got ${lastY[1]}, expected ${expectedP}`,
      );
    });
  });
});
