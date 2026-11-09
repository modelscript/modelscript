// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder, EqKind, initBltWasm } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ArenaSimulator } from "../src/core/simulate-arena.js";
import { kencarp4 } from "../src/solvers/imex-kencarp4.js";
import { vern7, vern9 } from "../src/solvers/verner.js";

describe("Ultra-High-Order Explicit (Vern7/Vern9) & Stiff IMEX (KenCarp4) Solvers (Track 3)", () => {
  it("integrates a harmonic oscillator to < 1e-11 global error using Vern7 and < 1e-13 using Vern9", () => {
    const tEnd = 2.0 * Math.PI;
    const problem = {
      tSpan: [0.0, tEnd] as [number, number],
      y0: [1.0, 0.0],
      f: (_t: number, y: number[]) => [-y[1]!, y[0]!],
    };

    const res7 = vern7(problem, { atol: 1e-11, rtol: 1e-11, initialStep: 0.2 });
    assert.equal(res7.stats.converged, true, "Vern7 should converge");
    const final7 = res7.states[res7.states.length - 1]!;
    const err7 = Math.hypot(final7[0]! - 1.0, final7[1]! - 0.0);
    assert.ok(err7 < 1e-10, `Expected Vern7 global error < 1e-10, got ${err7}`);

    const res9 = vern9(problem, { atol: 1e-13, rtol: 1e-13, initialStep: 0.25 });
    assert.equal(res9.stats.converged, true, "Vern9 should converge");
    const final9 = res9.states[res9.states.length - 1]!;
    const err9 = Math.hypot(final9[0]! - 1.0, final9[1]! - 0.0);
    assert.ok(err9 < 1e-12, `Expected Vern9 global error < 1e-12, got ${err9}`);
  });

  it("integrates an eccentric two-body Kepler orbit with Vern9 conserving Hamiltonian energy to < 1e-12", () => {
    const e = 0.5;
    const qx0 = 1.0 - e;
    const qy0 = 0.0;
    const px0 = 0.0;
    const py0 = Math.sqrt((1.0 + e) / (1.0 - e));

    const energy = (s: number[]) => {
      const r = Math.hypot(s[0]!, s[1]!);
      return 0.5 * (s[2]! * s[2]! + s[3]! * s[3]!) - 1.0 / r;
    };

    const E0 = energy([qx0, qy0, px0, py0]);

    const res = vern9(
      {
        tSpan: [0.0, 2.0 * Math.PI],
        y0: [qx0, qy0, px0, py0],
        f: (_t, y) => {
          const r2 = y[0]! * y[0]! + y[1]! * y[1]!;
          const r3 = r2 * Math.sqrt(r2);
          return [y[2]!, y[3]!, -y[0]! / r3, -y[1]! / r3];
        },
      },
      { atol: 1e-13, rtol: 1e-13, initialStep: 0.05 },
    );

    assert.equal(res.stats.converged, true);
    const yFinal = res.states[res.states.length - 1]!;
    const Ef = energy(yFinal);
    assert.ok(Math.abs(Ef - E0) < 1e-12, `Expected energy drift < 1e-12, got ${Math.abs(Ef - E0)}`);
    assert.ok(Math.hypot(yFinal[0]! - qx0, yFinal[1]! - qy0) < 1e-11);
  });

  it("integrates a split stiff advection-diffusion-reaction system using KenCarp4 IMEX", () => {
    // dy1/dt = -1000 * (y1 - cos(t)) - sin(t)   [stiff relaxation + non-stiff forcing]
    // dy2/dt = -500 * (y2 - exp(-t)) - exp(-t)
    // Exact solution: y1(t) = cos(t), y2(t) = exp(-t)
    const lambda1 = 1000.0;
    const lambda2 = 500.0;
    const tEnd = 1.5;

    const res = kencarp4(
      {
        tSpan: [0.0, tEnd],
        y0: [1.0, 1.0],
        fStiff: (t, y) => [-lambda1 * (y[0]! - Math.cos(t)), -lambda2 * (y[1]! - Math.exp(-t))],
        fNonStiff: (t, _y) => [-Math.sin(t), -Math.exp(-t)],
        jacStiff: () => [
          [-lambda1, 0.0],
          [0.0, -lambda2],
        ],
      },
      { atol: 1e-8, rtol: 1e-7, initialStep: 0.02 },
    );

    assert.equal(res.stats.converged, true, "KenCarp4 IMEX should converge on stiff split system");
    const yEnd = res.states[res.states.length - 1]!;
    assert.ok(Math.abs(yEnd[0]! - Math.cos(tEnd)) < 1e-5, `y1 error: ${Math.abs(yEnd[0]! - Math.cos(tEnd))}`);
    assert.ok(Math.abs(yEnd[1]! - Math.exp(-tEnd)) < 1e-5, `y2 error: ${Math.abs(yEnd[1]! - Math.exp(-tEnd))}`);
  });

  it("dispatches 'vern9' and 'kencarp4' through ArenaSimulator", async () => {
    await initBltWasm();
    const arena = new DAEBuilder();
    arena.addVariable("x", { start: 1.0 });
    const xExpr = arena.addNameExpr("x");
    const derX = arena.addDerExpr(xExpr);
    const negX = arena.addUnaryExpr(0 /* Neg */, xExpr);
    arena.addEquation(EqKind.Simple, derX, negX);

    const sim = new ArenaSimulator(arena);
    sim.prepare();

    const xId = arena.interner.intern("x");
    const derXId = arena.interner.intern("der(x)");
    const timeId = arena.interner.intern("time");

    const env1 = new Float64Array(arena.interner.size + 16);
    env1[xId] = 1.0;
    env1[timeId] = 0.0;
    const resVern = sim.simulate(10, 0.1, env1, [xId], [derXId], {
      solver: "vern9",
      atol: 1e-11,
      rtol: 1e-11,
      outputStringIds: [xId],
    });
    const finalVern = resVern.y[resVern.y.length - 1]![0]!;
    assert.ok(Math.abs(finalVern - Math.exp(-1.0)) < 1e-9);

    const env2 = new Float64Array(arena.interner.size + 16);
    env2[xId] = 1.0;
    env2[timeId] = 0.0;
    const resImex = sim.simulate(10, 0.1, env2, [xId], [derXId], {
      solver: "kencarp4",
      atol: 1e-8,
      rtol: 1e-8,
      outputStringIds: [xId],
    });
    const finalImex = resImex.y[resImex.y.length - 1]![0]!;
    assert.ok(Math.abs(finalImex - Math.exp(-1.0)) < 1e-5);
  });
});
