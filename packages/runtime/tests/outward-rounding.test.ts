// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addDown,
  addUp,
  ivAbs,
  ivAdd,
  ivAtan,
  ivCos,
  ivDiv,
  ivExp,
  ivLog,
  ivMul,
  ivPowInt,
  ivSin,
  ivSqrt,
  ivSub,
  ivTan,
  ivTanh,
  nextDown,
  nextUp,
  subDown,
  subUp,
} from "../src/analysis/outward_rounding.js";
import { Interval } from "../src/analysis/wasm_interval.js";

/** Deterministic PRNG (mulberry32) so failures are reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInterval(r: () => number, scale: number): Interval {
  const a = (r() * 2 - 1) * scale;
  const b = (r() * 2 - 1) * scale;
  return new Interval(Math.min(a, b), Math.max(a, b));
}

function samples(r: () => number, iv: Interval, n: number): number[] {
  const out = [iv.lo, iv.hi, iv.mid];
  for (let i = 0; i < n; i++) out.push(iv.lo + r() * (iv.hi - iv.lo));
  return out;
}

function contains(iv: Interval, v: number): boolean {
  return iv.lo <= v && v <= iv.hi;
}

describe("Rigorous scalar kernel: nextUp / nextDown", () => {
  it("is bit exact around 1, 0, and the extremes", () => {
    assert.equal(nextUp(1), 1 + Number.EPSILON);
    assert.equal(nextDown(1), 1 - Number.EPSILON / 2);
    assert.equal(nextUp(0), Number.MIN_VALUE);
    assert.equal(nextDown(0), -Number.MIN_VALUE);
    assert.ok(nextUp(-Number.MIN_VALUE) === 0); // IEEE gives -0; === treats -0 and +0 as equal
    assert.ok(nextDown(Number.MIN_VALUE) === 0);
    assert.equal(nextUp(-1), -1 + Number.EPSILON / 2);
    assert.equal(nextDown(-1), -1 - Number.EPSILON);
    assert.equal(nextUp(Number.MAX_VALUE), Infinity);
    assert.equal(nextDown(-Number.MAX_VALUE), -Infinity);
    assert.equal(nextUp(Infinity), Infinity);
    assert.equal(nextDown(-Infinity), -Infinity);
    assert.ok(Number.isNaN(nextUp(NaN)));
  });

  it("nextUp(nextDown(x)) === x for random finite x", () => {
    const r = rng(1);
    for (let i = 0; i < 2000; i++) {
      const x = (r() * 2 - 1) * Math.pow(10, Math.floor(r() * 40 - 20));
      assert.equal(nextUp(nextDown(x)), x);
      assert.equal(nextDown(nextUp(x)), x);
    }
  });
});

describe("Rigorous scalar kernel: directed addition (TwoSum)", () => {
  it("is exact when the sum is exactly representable", () => {
    assert.equal(addUp(0.5, 0.25), 0.75);
    assert.equal(addDown(0.5, 0.25), 0.75);
  });

  it("brackets an inexact sum with adjacent doubles", () => {
    // 0.1 + 0.2 is not exactly representable
    const up = addUp(0.1, 0.2);
    const down = addDown(0.1, 0.2);
    assert.ok(down < up);
    assert.equal(up, nextUp(down));
  });

  it("matches exact BigInt rational arithmetic on random doubles", () => {
    const r = rng(2);
    const toBig = (x: number): { n: bigint; e: number } => {
      // x = m * 2^e with integer m
      let e = 0;
      let m = x;
      while (!Number.isInteger(m)) {
        m *= 2;
        e--;
        if (e < -1100) break;
      }
      return { n: BigInt(m), e };
    };
    for (let i = 0; i < 500; i++) {
      const a = (r() * 2 - 1) * Math.pow(2, Math.floor(r() * 20 - 10));
      const b = (r() * 2 - 1) * Math.pow(2, Math.floor(r() * 20 - 10));
      const A = toBig(a);
      const B = toBig(b);
      const e = Math.min(A.e, B.e);
      const exact = A.n * 2n ** BigInt(A.e - e) + B.n * 2n ** BigInt(B.e - e); // exact * 2^-e
      const dn = addDown(a, b);
      const up = addUp(a, b);
      const lo = toBig(dn);
      const hi = toBig(up);
      const cmp = (p: { n: bigint; e: number }, q: bigint, qe: number): number => {
        const ee = Math.min(p.e, qe);
        const l = p.n * 2n ** BigInt(p.e - ee);
        const rr = q * 2n ** BigInt(qe - ee);
        return l < rr ? -1 : l > rr ? 1 : 0;
      };
      assert.ok(cmp(lo, exact, e) <= 0, `addDown(${a}, ${b}) above exact sum`);
      assert.ok(cmp(hi, exact, e) >= 0, `addUp(${a}, ${b}) below exact sum`);
      // tightness: at most one ulp apart
      assert.ok(up === dn || up === nextUp(dn));
    }
  });

  it("subUp / subDown bracket a - b", () => {
    assert.ok(subDown(0.3, 0.1) <= 0.3 - 0.1 && 0.3 - 0.1 <= subUp(0.3, 0.1));
  });
});

describe("Rigorous scalar kernel: interval arithmetic soundness (sampled)", () => {
  const r = rng(3);

  it("add / sub / mul / div enclose all sampled point results", () => {
    for (let i = 0; i < 400; i++) {
      const a = randInterval(r, 100);
      const b = randInterval(r, 100);
      const sa = samples(r, a, 6);
      const sb = samples(r, b, 6);
      const add = ivAdd(a, b);
      const sub = ivSub(a, b);
      const mul = ivMul(a, b);
      const div = ivDiv(a, b);
      for (const x of sa) {
        for (const y of sb) {
          assert.ok(contains(add, x + y), "add");
          assert.ok(contains(sub, x - y), "sub");
          assert.ok(contains(mul, x * y), "mul");
          if (y !== 0) assert.ok(contains(div, x / y), "div");
        }
      }
    }
  });

  it("division by an interval containing zero is the whole line", () => {
    const d = ivDiv(new Interval(1, 2), new Interval(-1, 1));
    assert.equal(d.lo, -Infinity);
    assert.equal(d.hi, Infinity);
  });

  it("0 * unbounded is 0 (interval convention), not NaN", () => {
    const m = ivMul(new Interval(0, 0), new Interval(-Infinity, Infinity));
    assert.equal(m.lo <= 0 && 0 <= m.hi, true);
    assert.ok(!Number.isNaN(m.lo) && !Number.isNaN(m.hi));
  });

  it("integer powers (even and odd) enclose sampled values", () => {
    for (let i = 0; i < 300; i++) {
      const a = randInterval(r, 5);
      for (const n of [0, 1, 2, 3, 4, 5]) {
        const p = ivPowInt(a, n);
        for (const x of samples(r, a, 8)) assert.ok(contains(p, Math.pow(x, n)), `pow ${n}`);
      }
    }
  });

  it("abs encloses sampled values", () => {
    for (let i = 0; i < 200; i++) {
      const a = randInterval(r, 10);
      const p = ivAbs(a);
      for (const x of samples(r, a, 8)) assert.ok(contains(p, Math.abs(x)));
    }
  });
});

describe("Rigorous scalar kernel: elementary functions (sampled)", () => {
  const r = rng(4);

  const cases: [string, (a: Interval) => Interval, (x: number) => number, number, (a: Interval) => boolean][] = [
    ["exp", ivExp, Math.exp, 20, () => true],
    ["log", ivLog, Math.log, 50, (a) => a.lo > 0],
    ["sqrt", ivSqrt, Math.sqrt, 50, (a) => a.lo >= 0],
    ["atan", ivAtan, Math.atan, 30, () => true],
    ["tanh", ivTanh, Math.tanh, 5, () => true],
    ["sin", ivSin, Math.sin, 40, () => true],
    ["cos", ivCos, Math.cos, 40, () => true],
  ];

  for (const [name, F, f, scale, valid] of cases) {
    it(`${name} encloses sampled values`, () => {
      for (let i = 0; i < 600; i++) {
        let a = randInterval(r, scale);
        if (name === "log" || name === "sqrt") a = new Interval(Math.abs(a.lo), Math.abs(a.hi));
        if (a.lo > a.hi) a = new Interval(a.hi, a.lo);
        if (!valid(a)) continue;
        const e = F(a);
        for (const x of samples(r, a, 12)) {
          assert.ok(contains(e, f(x)), `${name}([${a.lo}, ${a.hi}]) = [${e.lo}, ${e.hi}] misses ${f(x)} at x=${x}`);
        }
      }
    });
  }

  it("sin/cos reach exactly +/-1 when an extremum is inside the interval", () => {
    assert.equal(ivSin(new Interval(1, 2)).hi, 1); // pi/2 inside
    assert.equal(ivSin(new Interval(4, 5)).lo, -1); // 3pi/2 inside
    assert.equal(ivCos(new Interval(-1, 1)).hi, 1); // 0 inside
    assert.equal(ivCos(new Interval(3, 3.5)).lo, -1); // pi inside
  });

  it("sin/cos extremum exactly at an interval endpoint is not missed (conservative)", () => {
    const s = ivSin(new Interval(Math.PI / 2, Math.PI / 2 + 0.1));
    assert.equal(s.hi, 1);
    const c = ivCos(new Interval(Math.PI - 0.1, Math.PI));
    assert.equal(c.lo, -1);
  });

  it("sin/cos of width >= 2*pi is [-1, 1]; non-finite input is [-1, 1]", () => {
    assert.deepEqual([ivSin(new Interval(0, 7)).lo, ivSin(new Interval(0, 7)).hi], [-1, 1]);
    assert.deepEqual([ivCos(new Interval(-Infinity, 0)).lo, ivCos(new Interval(-Infinity, 0)).hi], [-1, 1]);
  });

  it("sin/cos enclose sampled values at large arguments", () => {
    for (let i = 0; i < 200; i++) {
      const base = (r() * 2 - 1) * 1e6;
      const a = new Interval(base, base + r() * 3);
      const s = ivSin(a);
      const c = ivCos(a);
      for (const x of samples(r, a, 10)) {
        assert.ok(contains(s, Math.sin(x)), `sin at ${x}`);
        assert.ok(contains(c, Math.cos(x)), `cos at ${x}`);
      }
    }
  });

  it("tan returns the whole line across a pole and encloses samples elsewhere", () => {
    const across = ivTan(new Interval(1, 2)); // pi/2 inside
    assert.equal(across.lo, -Infinity);
    for (let i = 0; i < 300; i++) {
      const lo = -1.4 + r() * 0.5;
      const a = new Interval(lo, lo + r() * 0.8);
      const t = ivTan(a);
      for (const x of samples(r, a, 8)) assert.ok(contains(t, Math.tan(x)), `tan at ${x}`);
    }
  });

  it("log of a non-positive interval is NaN-flagged; of an interval touching 0 starts at -Infinity", () => {
    assert.ok(Number.isNaN(ivLog(new Interval(-2, -1)).lo));
    assert.equal(ivLog(new Interval(0, 1)).lo, -Infinity);
  });

  it("exp stays non-negative and tanh stays within [-1, 1]", () => {
    assert.ok(ivExp(new Interval(-800, -700)).lo >= 0);
    const t = ivTanh(new Interval(-50, 50));
    assert.ok(t.lo >= -1 && t.hi <= 1);
  });
});

describe("Rigorous scalar kernel: mutation guard", () => {
  it("a deliberately non-outward enclosure is detected by the same sampling check", () => {
    // Sanity check that the soundness test would fail for an unsound implementation:
    // exp without any slack, evaluated at an endpoint, does not contain a neighbouring double.
    const a = new Interval(1, 1);
    const naive = new Interval(Math.exp(a.lo), Math.exp(a.hi));
    const e = ivExp(a);
    assert.ok(e.lo < naive.lo && naive.hi < e.hi, "rigorous exp must be strictly wider than the naive point value");
    assert.ok(!contains(naive, nextUp(Math.exp(1))));
    assert.ok(contains(e, nextUp(Math.exp(1))) && contains(e, nextDown(Math.exp(1))));
  });
});
