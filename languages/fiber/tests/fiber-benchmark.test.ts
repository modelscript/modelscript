// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { runFiberBenchmark } from "./fiber-benchmark-runner.js";

describe("@modelscript/fiber Industrial Benchmark Suite", () => {
  test("executes 144-strand metro ring & NESC structural benchmark with DAE lowering", () => {
    const res = runFiberBenchmark();

    assert.equal(res.name, "144-Strand ANSI/TIA-598-D Metro Optical Ring & NESC Structural Benchmark");
    assert.equal(res.totalStrandCount, 144);
    assert.equal(res.bufferTubeCount, 12);
    assert.equal(res.numRingSpans, 6);
    assert.ok(res.totalRingRouteKm > 20.0, `Expected > 20 km total route, got ${res.totalRingRouteKm} km`);

    // Physical compliance
    assert.equal(res.isSrlgDisjoint, true, "Primary and protection ring paths must be physically disjoint");
    assert.equal(res.isPoleLoadingCompliant, true, "Pole loading should comply with ANSI O5.1");
    assert.ok(res.maxPoleStressRatio < 1.0, `Pole stress ratio should be < 1.0, got ${res.maxPoleStressRatio}`);

    // Optical loss budget & catenary sag
    assert.ok(res.minOpticalMarginDb > 20.0, `Optical margin should be > 20 dB, got ${res.minOpticalMarginDb} dB`);
    assert.ok(res.maxCatenarySagM < 0.5, `Catenary sag should be < 0.5m, got ${res.maxCatenarySagM}m`);
    assert.ok(res.minGroundClearanceM > 8.0, `Ground clearance should be > 8m, got ${res.minGroundClearanceM}m`);

    // DAE equations and variables
    // 6 spans * 19 vars = 114 vars; 6 spans * 8 eqs = 48 eqs
    assert.ok(res.variableCount >= 100, `Expected >= 100 DAE variables, got ${res.variableCount}`);
    assert.ok(res.equationCount >= 40, `Expected >= 40 DAE equations, got ${res.equationCount}`);

    assert.ok(res.daeLoweringTimeMs < 100, `DAE lowering should be fast, got ${res.daeLoweringTimeMs}ms`);
    assert.ok(res.totalTimeMs < 500, `Total benchmark time should be < 500ms, got ${res.totalTimeMs}ms`);
  });
});
