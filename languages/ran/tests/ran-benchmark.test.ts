// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { runRanBenchmark, SAMPLE_NSMA_5G_PATTERN } from "./ran-benchmark-runner.js";

describe("@modelscript/ran Industrial Benchmark Suite", () => {
  test("executes 5G C-Band Massive-MIMO & Multi-Hop Backhaul benchmark with DAE lowering", () => {
    const res = runRanBenchmark();

    assert.equal(res.name, "5G C-Band Massive-MIMO & Multi-Hop Backhaul Network");
    assert.equal(res.numSectors, 3);
    assert.equal(res.numBackhaulLinks, 4);

    assert.equal(res.antennaPeakGainDbi, 24.5);
    assert.ok(Math.abs(res.interpolatedBoresightGainDbi - 24.5) < 0.5);

    assert.equal(res.isMpeCompliant, true);
    assert.ok(res.mpeMaxTer < 1.0, `Expected TER < 1.0, got ${res.mpeMaxTer}`);

    assert.ok(res.totalBackhaulCapacityMbps > 500, `Expected capacity > 500 Mbps, got ${res.totalBackhaulCapacityMbps}`);
    assert.ok(res.variableCount >= 50, `Expected >= 50 DAE variables, got ${res.variableCount}`);
    assert.ok(res.equationCount >= 30, `Expected >= 30 DAE equations, got ${res.equationCount}`);

    assert.ok(res.daeLoweringTimeMs < 100, `DAE lowering should be fast, got ${res.daeLoweringTimeMs}ms`);
    assert.ok(res.totalTimeMs < 500, `Total execution should be < 500ms, got ${res.totalTimeMs}ms`);
  });

  test("validates NSMA pattern deck structure and frequency specifications", () => {
    assert.ok(SAMPLE_NSMA_5G_PATTERN.includes("REVNUM: 1.01"));
    assert.ok(SAMPLE_NSMA_5G_PATTERN.includes("GAIN: 24.5"));
    assert.ok(SAMPLE_NSMA_5G_PATTERN.includes("NOAVAL: 8"));
    assert.ok(SAMPLE_NSMA_5G_PATTERN.includes("NOEVAL: 8"));
  });
});
