// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Interval } from "../src/analysis/wasm_interval.js";
import { evaluateArenaRuntime } from "../src/dae/wasm_evaluator.js";
import { affineBoxEnv, createAffineDomain } from "../src/formal/dae/affine_domain.js";
import { evalArenaExpr, IntervalDomain, type ArenaEvalEnv } from "../src/formal/dae/arena_eval.js";
import { taylorBoxEnv, TaylorDomain } from "../src/formal/dae/taylor_domain.js";
import { BinOp, Causality, DAEBuilder, UnaryOp, Variability, VarType } from "../src/index.js";

function setup() {
  const arena = new DAEBuilder();
  arena.addVariable("x", VarType.Real, Variability.Continuous, Causality.Local, 0);
  arena.addVariable("y", VarType.Real, Variability.Continuous, Causality.Local, 0);
  return arena;
}

function boxEnv(arena: DAEBuilder, box: Record<string, Interval>): ArenaEvalEnv<Interval> {
  return { variable: (_i, name) => box[name] };
}

let seed = 12345;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

describe("evalArenaExpr (interval domain) soundness", () => {
  const arena = setup();
  const x = arena.addNameExpr("x");
  const y = arena.addNameExpr("y");
  const lit = (v: number) => arena.addRealLiteral(v);
  const call = (f: string, ...a: number[]) => arena.addCallExpr(f, a);
  const bin = (op: BinOp, a: number, b: number) => arena.addBinaryExpr(op, a, b);

  const cases: Record<string, number> = {
    "x*y - sin(x)/(2+y^2)": bin(
      BinOp.Sub,
      bin(BinOp.Mul, x, y),
      bin(BinOp.Div, call("sin", x), bin(BinOp.Add, lit(2), bin(BinOp.Pow, y, lit(2)))),
    ),
    "exp(-x)*cos(y)": bin(BinOp.Mul, call("exp", arena.addUnaryExpr(UnaryOp.Negate, x)), call("cos", y)),
    "sqrt(x^2+1)+atan(y)": bin(
      BinOp.Add,
      call("sqrt", bin(BinOp.Add, bin(BinOp.Pow, x, lit(2)), lit(1))),
      call("atan", y),
    ),
    "if x>0 then x else -x": arena.addIfElseExpr(bin(BinOp.Gt, x, lit(0)), x, arena.addUnaryExpr(UnaryOp.Negate, x)),
    "x^3 - y^2": bin(BinOp.Sub, bin(BinOp.Pow, x, lit(3)), bin(BinOp.Pow, y, lit(2))),
    "tanh(x*y)": call("tanh", bin(BinOp.Mul, x, y)),
    "max(x,y)-min(x,y)": bin(BinOp.Sub, call("max", x, y), call("min", x, y)),
    "x^-2 (x>0 box handled)": bin(BinOp.Pow, bin(BinOp.Add, bin(BinOp.Pow, x, lit(2)), lit(1)), lit(-2)),
    "(x^2+1)^0.5": bin(BinOp.Pow, bin(BinOp.Add, bin(BinOp.Pow, x, lit(2)), lit(1)), lit(0.5)),
    "(x^2+1)^y": bin(BinOp.Pow, bin(BinOp.Add, bin(BinOp.Pow, x, lit(2)), lit(1)), y),
    "log(x^2+0.5)": call("log", bin(BinOp.Add, bin(BinOp.Pow, x, lit(2)), lit(0.5))),
  };

  const evalHull = (domainName: string, expr: number, box: Record<string, Interval>): Interval => {
    if (domainName === "interval") return evalArenaExpr(arena, expr, boxEnv(arena, box), IntervalDomain).value;
    if (domainName === "taylor") {
      const td = new TaylorDomain([box.x!, box.y!], 4);
      const tr = evalArenaExpr(
        arena,
        expr,
        taylorBoxEnv(td, (_i, n) => (n === "x" ? 0 : 1)),
        td,
      );
      return td.toInterval(tr.value);
    }
    const dom = createAffineDomain();
    const r = evalArenaExpr(
      arena,
      expr,
      affineBoxEnv(dom, (_i, n) => box[n]),
      dom,
    );
    return dom.toInterval(r.value);
  };

  for (const domainName of ["interval", "affine", "taylor"]) {
    for (const [name, expr] of Object.entries(cases)) {
      it(`${domainName} encloses point values: ${name}`, () => {
        for (let trial = 0; trial < 200; trial++) {
          const xa = rnd() * 6 - 3;
          const ya = rnd() * 6 - 3;
          const box = {
            x: new Interval(xa, xa + rnd() * 1.5),
            y: new Interval(ya, ya + rnd() * 1.5),
          };
          const value = evalHull(domainName, expr, box);
          for (let s = 0; s < 20; s++) {
            const px = box.x.lo + rnd() * (box.x.hi - box.x.lo);
            const py = box.y.lo + rnd() * (box.y.hi - box.y.lo);
            const env = new Float64Array(arena.interner.size);
            env[arena.getVarNameId(arena.getVarIdxByName("x"))] = px;
            env[arena.getVarNameId(arena.getVarIdxByName("y"))] = py;
            const truth = evaluateArenaRuntime(arena, expr, env);
            if (!Number.isFinite(truth)) continue;
            assert.ok(
              value.lo <= truth && truth <= value.hi,
              `${name}: ${truth} not in [${value.lo}, ${value.hi}] at (${px}, ${py})`,
            );
          }
        }
      });
    }
  }

  it("affine: x - x and (x+y)-(x+y) keep correlation", () => {
    const box = { x: new Interval(1, 3), y: new Interval(-2, 5) };
    const xx = bin(BinOp.Sub, x, x);
    const h = evalHull("affine", xx, box);
    assert.ok(h.lo <= 0 && h.hi >= 0 && h.hi - h.lo < 1e-9, `got [${h.lo}, ${h.hi}]`);
    const s = bin(BinOp.Add, x, y);
    const h2 = evalHull("affine", bin(BinOp.Sub, s, s), box);
    assert.ok(h2.lo <= 0 && h2.hi >= 0 && h2.hi - h2.lo < 1e-9);
    const hi = evalHull("interval", xx, box);
    assert.ok(hi.hi - hi.lo >= 4);
  });

  it("affine: unbounded variable is TOP", () => {
    const dom = createAffineDomain();
    const { value } = evalArenaExpr(
      arena,
      bin(BinOp.Mul, x, y),
      affineBoxEnv(dom, () => undefined),
      dom,
    );
    const h = dom.toInterval(value);
    assert.equal(h.lo, -Infinity);
    assert.equal(h.hi, Infinity);
  });

  it("unbounded variable (env returns undefined) is TOP, not a point", () => {
    const { value } = evalArenaExpr(arena, x, { variable: () => undefined }, IntervalDomain);
    assert.equal(value.lo, -Infinity);
    assert.equal(value.hi, Infinity);
  });

  it("der(x) is not the bound of x", () => {
    const d = arena.addDerExpr(x);
    const { value } = evalArenaExpr(arena, d, { variable: () => new Interval(1, 2) }, IntervalDomain);
    assert.equal(value.lo, -Infinity);
    assert.equal(value.hi, Infinity);
    const r2 = evalArenaExpr(
      arena,
      d,
      { variable: () => new Interval(1, 2), derivative: () => new Interval(-5, -4) },
      IntervalDomain,
    );
    assert.equal(r2.value.lo, -5);
  });

  it("reports and widens division through zero", () => {
    const e = bin(BinOp.Div, lit(1), x);
    const r = evalArenaExpr(arena, e, { variable: () => new Interval(-1, 1) }, IntervalDomain);
    assert.equal(r.issues[0]?.kind, "div_by_zero");
    assert.equal(r.value.lo, -Infinity);
  });

  it("sqrt of possibly-negative radicand reports issue and widens", () => {
    const r = evalArenaExpr(arena, call("sqrt", x), { variable: () => new Interval(-1, 4) }, IntervalDomain);
    assert.equal(r.issues[0]?.kind, "sqrt_negative");
    assert.equal(r.value.lo, -Infinity);
  });

  it("indeterminate condition joins both branches", () => {
    const e = arena.addIfElseExpr(bin(BinOp.Gt, x, lit(0)), lit(10), lit(20));
    const r = evalArenaExpr(arena, e, { variable: () => new Interval(-1, 1) }, IntervalDomain);
    assert.equal(r.value.lo, 10);
    assert.equal(r.value.hi, 20);
  });
});
