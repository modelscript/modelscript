// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addDown,
  addUp,
  AutoSwitch,
  createCertificate,
  isRigorous,
  nextDown,
  nextUp,
  ODEProblem,
  OutwardInterval,
  registerSolver,
  remake,
  Rodas4P,
  solve,
  Tsit5,
  WasmScratchPool,
} from "../src/index.js";

describe("@modelscript/solve — OutwardInterval", () => {
  it("computes exact 32-bit nextUp / nextDown across zero, subnormals, and negatives", () => {
    assert.equal(nextUp(0), Number.MIN_VALUE);
    assert.equal(nextDown(0), -Number.MIN_VALUE);
    assert.equal(nextDown(Number.MIN_VALUE), 0);
    assert.equal(nextUp(-Number.MIN_VALUE), 0);
    assert.ok(nextUp(1.0) > 1.0);
    assert.ok(nextDown(1.0) < 1.0);
    assert.equal(nextDown(nextUp(1.0)), 1.0);
    assert.equal(nextUp(nextDown(-3.5)), -3.5);
    assert.equal(nextUp(Infinity), Infinity);
    assert.equal(nextDown(-Infinity), -Infinity);
  });

  it("handles TwoSum overflow without NaN", () => {
    const big = Number.MAX_VALUE * 0.75;
    const up = addUp(big, -big * 0.5);
    const dn = addDown(big, -big * 0.5);
    assert.ok(Number.isFinite(up) && Number.isFinite(dn));
    assert.ok(dn <= up);
  });

  it("handles 0 * Infinity and Infinity / Infinity without producing NaN", () => {
    const zero = OutwardInterval.ZERO;
    const posInf = OutwardInterval.of(1, Infinity);
    const prod = zero.mul(posInf);
    assert.equal(prod.isEmpty, false);
    assert.equal(prod.lo, 0);
    assert.equal(prod.hi, 0);

    const quot = posInf.div(posInf);
    assert.equal(quot.isEmpty, false);
    assert.equal(quot.lo, 0);
    assert.equal(quot.hi, Infinity);
  });

  it("computes outward-rounded powInt in O(log n) and preserves [0, 0]^3 = [0, 0]", () => {
    const z3 = OutwardInterval.ZERO.powInt(3);
    assert.equal(z3.lo, 0);
    assert.equal(z3.hi, 0);

    const sym = OutwardInterval.of(-2, 3).powInt(2);
    assert.equal(sym.lo, 0);
    assert.ok(sym.hi >= 9);

    const p10 = OutwardInterval.of(1.1, 1.1).powInt(10);
    const exact = Math.pow(1.1, 10);
    assert.ok(p10.lo <= exact && p10.hi >= exact);
  });
});

describe("@modelscript/solve — VerificationCertificate strict rigor contract", () => {
  it("allows isCertifiedSafe ONLY for proven + exact-rational / outward-f64", () => {
    assert.equal(isRigorous("exact-rational"), true);
    assert.equal(isRigorous("outward-f64"), true);
    assert.equal(isRigorous("floating-point"), false);
    assert.equal(isRigorous("heuristic"), false);

    const rigorousCert = createCertificate({
      verdict: { status: "proven", rigor: "outward-f64", detail: "Verified via outward-rounded TM" },
      algorithm: "TMJets",
      durationMs: 12,
      summary: "Safe",
    });
    assert.equal(rigorousCert.isCertifiedSafe, true);
    assert.equal(rigorousCert.verdict.status, "proven");

    // Attempting to emit proven + heuristic MUST be downgraded to unknown(not-rigorous)
    const fakeCert = createCertificate({
      verdict: { status: "proven", rigor: "heuristic", detail: "Sampled corners" },
      algorithm: "HeuristicSOS",
      durationMs: 5,
      summary: "Heuristic check",
    });
    assert.equal(fakeCert.isCertifiedSafe, false);
    assert.equal(fakeCert.verdict.status, "unknown");
    if (fakeCert.verdict.status === "unknown") {
      assert.equal(fakeCert.verdict.reason, "not-rigorous");
    }
  });
});

describe("@modelscript/solve — WasmScratchPool", () => {
  it("rewinds bump pointer across scopes and frees backing slabs on dispose", () => {
    const memory = new WebAssembly.Memory({ initial: 4 });
    let nextAddr = 1024;
    const freed: number[] = [];
    const pool = new WasmScratchPool(
      {
        memory,
        malloc: (bytes) => {
          const ptr = nextAddr;
          nextAddr += bytes;
          return ptr;
        },
        free: (ptr) => freed.push(ptr),
      },
      256,
    );

    let ptrA = 0;
    let ptrB = 0;
    {
      const s1 = pool.scope();
      const a = s1.allocF64(8);
      ptrA = a.ptr;
      a.view().set([1, 2, 3, 4, 5, 6, 7, 8]);
      s1.dispose();
    }
    {
      const s2 = pool.scope();
      const b = s2.allocF64(8);
      ptrB = b.ptr;
      s2.dispose();
    }
    assert.equal(ptrA, ptrB, "scope dispose should reuse the exact same scratch address");

    pool.dispose();
    assert.equal(freed.length, 1);
  });
});

describe("@modelscript/solve — Unified Problem, remake & solve() dispatch", () => {
  it("supports remake() and typed algorithm dispatch", () => {
    const prob = ODEProblem((_t, u, p: { k: number } | undefined) => [-(p?.k ?? 1) * (u[0] ?? 0)], [1], [0, 1], {
      k: 2,
    });
    const prob2 = remake(prob, { p: { k: 5 }, u0: [2] });
    assert.equal(prob.p?.k, 2);
    assert.equal(prob2.p?.k, 5);
    assert.deepEqual(prob2.u0, [2]);

    registerSolver(
      {
        problemKind: "ode",
        algorithmName: "Tsit5",
        isDefault: true,
        solve: (p, alg) => ({
          times: [p.tSpan[0], p.tSpan[1]],
          states: [[...p.u0], [...p.u0]],
          retcode: "Success" as const,
          stats: { acceptedSteps: 1, rejectedSteps: 0, fEvals: 1, jacEvals: 0, luFactorizations: 0, durationMs: 0 },
          algorithm: alg.name,
          eval: () => [...p.u0],
        }),
      },
      Tsit5(),
    );

    const sol = solve(prob2, Tsit5());
    assert.equal((sol as { retcode: string }).retcode, "Success");

    const autoAlg = AutoSwitch(Tsit5(), Rodas4P());
    assert.equal(autoAlg.name, "AutoSwitch");
    assert.equal(autoAlg.stiff.name, "Rodas4P");
  });
});
