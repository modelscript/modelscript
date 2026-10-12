// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  ArenaBltResult,
  arenaFingerprint,
  BinOp,
  DaeBltReachabilityEngine,
  DAEBuilder,
  EqKind,
  NumericalInterval,
  Variability,
  VarType,
} from "../src/index.js";

/** y = k * u + c  (u parameter in [5,7]) */
function build(k: number, c: number, extraVar = false) {
  const arena = new DAEBuilder();
  const uIdx = arena.addVariable("u", VarType.Real, Variability.Parameter);
  const yIdx = arena.addVariable("y", VarType.Real, Variability.Continuous);
  if (extraVar) arena.addVariable("zz", VarType.Real, Variability.Continuous);
  const rhs = arena.addBinaryExpr(
    BinOp.Add,
    arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(k), arena.addNameExpr("u")),
    arena.addRealLiteral(c),
  );
  const eq = arena.addEquation(EqKind.Simple, arena.addNameExpr("y"), rhs);
  const blt: ArenaBltResult = { sortedEquations: [eq], blocks: [{ eqIdxs: [eq], vars: [yIdx] }] };
  return { arena, uIdx, yIdx, blt };
}

describe("arena fingerprints & block cache soundness", () => {
  it("independently built identical models share a fingerprint; any content change differs", () => {
    const a = arenaFingerprint(build(2, 1).arena);
    const b = arenaFingerprint(build(2, 1).arena);
    assert.strictEqual(a, b);
    assert.notStrictEqual(a, arenaFingerprint(build(2, 1.0000000001).arena));
    assert.notStrictEqual(a, arenaFingerprint(build(3, 1).arena));
    assert.notStrictEqual(a, arenaFingerprint(build(2, 1, true).arena));
  });

  it("block cache does not reuse a result for inputs that differ beyond 8 significant digits", () => {
    const { arena, uIdx, yIdx, blt } = build(1, 0);
    const engine = new DaeBltReachabilityEngine(arena, {
      initialBounds: new Map([[uIdx, new NumericalInterval(1, 2)]]),
    });
    const p1 = engine.verify(blt);
    assert.strictEqual(p1.recomputedBlocks, 1);

    engine.evaluator.setVarBound(uIdx, new NumericalInterval(1, 2 + 1e-12));
    const p2 = engine.verify(blt);
    assert.strictEqual(p2.recomputedBlocks, 1, "tiny input change must be a cache miss");
    assert.ok(p2.variableBounds.get(yIdx)!.high >= 2 + 1e-12, "bound must reflect the new input");
  });

  it("block cache is invalidated by a change of the block's own equation (same inputs)", () => {
    const first = build(2, 0);
    const engine = new DaeBltReachabilityEngine(first.arena, {
      initialBounds: new Map([[first.uIdx, new NumericalInterval(5, 7)]]),
    });
    const p1 = engine.verify(first.blt);
    assert.ok(p1.variableBounds.get(first.yIdx)!.high >= 14 && p1.variableBounds.get(first.yIdx)!.high < 14.001);

    // Same arena, equation content changed in place (y = 3*u instead of 2*u) — same input bounds.
    const arena = first.arena;
    const rhs = arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(3), arena.addNameExpr("u"));
    const eq2 = arena.addEquation(EqKind.Simple, arena.addNameExpr("y"), rhs);
    const p2 = engine.verify({ sortedEquations: [eq2], blocks: [{ eqIdxs: [eq2], vars: [first.yIdx] }] });
    assert.strictEqual(p2.cachedBlocks, 0, "stale block result must not be reused");
    assert.ok(p2.variableBounds.get(first.yIdx)!.high >= 21);
  });
});
