// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DaeFlowpipeSolver } from "../src/analysis/wasm_dae_flowpipe.js";
import { Interval } from "../src/analysis/wasm_interval.js";
import { BinOp, DAEBuilder, EqKind, VarType, Variability } from "../src/dae/wasm_dae.js";
import { compileArenaToDae, createDualDomain } from "../src/formal/dae/arena_dae_compiler.js";
import { evalArenaExpr } from "../src/formal/dae/arena_eval.js";

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("DualDomain (interval forward-mode AD)", () => {
  it("gradient enclosures contain central finite differences", () => {
    const arena = new DAEBuilder();
    arena.addVariable("a", VarType.Real, Variability.Continuous);
    arena.addVariable("b", VarType.Real, Variability.Continuous);
    const a = () => arena.addNameExpr("a");
    const b = () => arena.addNameExpr("b");
    const lit = (v: number) => arena.addRealLiteral(v);
    // e = sin(a*b) + exp(a)/(b*b + 1) + a^3 - atan(b)
    const e = arena.addBinaryExpr(
      BinOp.Sub,
      arena.addBinaryExpr(
        BinOp.Add,
        arena.addBinaryExpr(
          BinOp.Add,
          arena.addCallExpr("sin", [arena.addBinaryExpr(BinOp.Mul, a(), b())]),
          arena.addBinaryExpr(
            BinOp.Div,
            arena.addCallExpr("exp", [a()]),
            arena.addBinaryExpr(BinOp.Add, arena.addBinaryExpr(BinOp.Mul, b(), b()), lit(1)),
          ),
        ),
        arena.addBinaryExpr(BinOp.Pow, a(), lit(3)),
      ),
      arena.addCallExpr("atan", [b()]),
    );
    const dom = createDualDomain(2);
    const f = (x: number, y: number): number => Math.sin(x * y) + Math.exp(x) / (y * y + 1) + x ** 3 - Math.atan(y);
    const rand = rng(7);
    for (let t = 0; t < 40; t++) {
      const ca = -1 + 2 * rand();
      const cb = -1 + 2 * rand();
      const ra = 0.05 * rand();
      const rb = 0.05 * rand();
      const A = new Interval(ca - ra, ca + ra);
      const B = new Interval(cb - rb, cb + rb);
      const r = evalArenaExpr(
        arena,
        e,
        {
          variable: (_i, name) =>
            name === "a"
              ? { v: A, g: [new Interval(1, 1), new Interval(0, 0)] }
              : { v: B, g: [new Interval(0, 0), new Interval(1, 1)] },
        },
        dom,
      ).value;
      for (let s = 0; s < 10; s++) {
        const x = A.lo + rand() * (A.hi - A.lo);
        const y = B.lo + rand() * (B.hi - B.lo);
        const h = 1e-6;
        const dx = (f(x + h, y) - f(x - h, y)) / (2 * h);
        const dy = (f(x, y + h) - f(x, y - h)) / (2 * h);
        assert.ok(
          dx >= r.g[0]!.lo - 1e-6 && dx <= r.g[0]!.hi + 1e-6,
          `d/da ${dx} not in [${r.g[0]!.lo}, ${r.g[0]!.hi}]`,
        );
        assert.ok(
          dy >= r.g[1]!.lo - 1e-6 && dy <= r.g[1]!.hi + 1e-6,
          `d/db ${dy} not in [${r.g[1]!.lo}, ${r.g[1]!.hi}]`,
        );
        const v = f(x, y);
        assert.ok(v >= r.v.lo - 1e-9 && v <= r.v.hi + 1e-9);
      }
    }
  });

  it("undecided if / abs at zero give unbounded gradients (never a false 0)", () => {
    const arena = new DAEBuilder();
    arena.addVariable("a", VarType.Real, Variability.Continuous);
    const e = arena.addCallExpr("abs", [arena.addNameExpr("a")]);
    const r = evalArenaExpr(
      arena,
      e,
      { variable: () => ({ v: new Interval(-1, 1), g: [new Interval(1, 1)] }) },
      createDualDomain(1),
    ).value;
    assert.equal(r.g[0]!.lo, -Infinity);
  });
});

describe("compileArenaToDae", () => {
  const buildCubic = (): DAEBuilder => {
    const arena = new DAEBuilder();
    arena.addVariable("x", VarType.Real, Variability.Continuous);
    arena.addVariable("z", VarType.Real, Variability.Continuous);
    const x = () => arena.addNameExpr("x");
    const z = () => arena.addNameExpr("z");
    // der(x) = -z ; z^3 + z = x
    arena.addEquation(
      EqKind.Simple,
      arena.addDerExpr(x()),
      arena.addBinaryExpr(BinOp.Sub, arena.addRealLiteral(0), z()),
    );
    arena.addEquation(
      EqKind.Simple,
      arena.addBinaryExpr(BinOp.Add, arena.addBinaryExpr(BinOp.Pow, z(), arena.addRealLiteral(3)), z()),
      x(),
    );
    return arena;
  };

  it("compiles a semi-explicit arena and the validated flowpipe encloses the true solution", () => {
    const res = compileArenaToDae(buildCubic());
    assert.ok(res.ok, res.ok ? "" : res.reason);
    if (!res.ok) return;
    assert.deepEqual(res.compiled.stateNames, ["x"]);
    assert.deepEqual(res.compiled.algebraicNames, ["z"]);

    const solveZ = (x: number): number => {
      let z = x;
      for (let i = 0; i < 60; i++) z -= (z ** 3 + z - x) / (3 * z * z + 1);
      return z;
    };
    const reference = (x0: number, t: number): number => {
      let x = x0;
      const h = 1e-4;
      for (let s = 0; s < t - 1e-15; s += h) {
        const k1 = -solveZ(x);
        const k2 = -solveZ(x + 0.5 * h * k1);
        const k3 = -solveZ(x + 0.5 * h * k2);
        const k4 = -solveZ(x + h * k3);
        x += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
      }
      return x;
    };
    const out = DaeFlowpipeSolver.solve({
      dae: res.compiled.dae,
      initialX: [new Interval(0.9, 1.1)],
      initialZ: [new Interval(0, 2)],
      nominalX: [1.0],
      nominalZ: [solveZ(1.0)],
      tSpan: [0, 0.5],
      dt: 0.05,
    });
    assert.equal(out.verdict.kind, "proven", out.summary);
    for (const x0 of [0.9, 1.0, 1.1]) {
      for (const step of out.steps) {
        const x = reference(x0, step.time);
        assert.ok(x >= step.xTubes[0]!.lo - 1e-6 && x <= step.xTubes[0]!.hi + 1e-6, `t=${step.time}`);
      }
    }
  });

  it("rejects implicit der() and non-square systems instead of guessing", () => {
    const arena = new DAEBuilder();
    arena.addVariable("x", VarType.Real, Variability.Continuous);
    arena.addVariable("y", VarType.Real, Variability.Continuous);
    // der(x) + der(x)*x = 1  (implicit)
    const x = () => arena.addNameExpr("x");
    arena.addEquation(
      EqKind.Simple,
      arena.addBinaryExpr(BinOp.Add, arena.addDerExpr(x()), arena.addBinaryExpr(BinOp.Mul, arena.addDerExpr(x()), x())),
      arena.addRealLiteral(1),
    );
    const r1 = compileArenaToDae(arena);
    assert.equal(r1.ok, false);

    const arena2 = new DAEBuilder();
    arena2.addVariable("x", VarType.Real, Variability.Continuous);
    arena2.addVariable("y", VarType.Real, Variability.Continuous);
    arena2.addEquation(EqKind.Simple, arena2.addDerExpr(arena2.addNameExpr("x")), arena2.addRealLiteral(1));
    const r2 = compileArenaToDae(arena2); // y has no equation
    assert.equal(r2.ok, false);
  });

  it("unbounded parameters give unknown, not a proof", () => {
    const arena = new DAEBuilder();
    arena.addVariable("x", VarType.Real, Variability.Continuous);
    arena.addVariable("k", VarType.Real, Variability.Parameter); // no bounds, no value
    arena.addEquation(
      EqKind.Simple,
      arena.addDerExpr(arena.addNameExpr("x")),
      arena.addBinaryExpr(BinOp.Mul, arena.addNameExpr("k"), arena.addNameExpr("x")),
    );
    const res = compileArenaToDae(arena);
    assert.ok(res.ok);
    if (!res.ok) return;
    const out = DaeFlowpipeSolver.solve({
      dae: res.compiled.dae,
      initialX: [new Interval(1, 2)],
      initialZ: [],
      nominalX: [1.5],
      nominalZ: [],
      tSpan: [0, 0.2],
      dt: 0.05,
    });
    assert.notEqual(out.verdict.kind, "proven");
  });
});
