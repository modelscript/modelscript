// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { runEclipseBenchmark, SPE10_BRENT_BENCHMARK_DECK } from "./eclipse-benchmark-runner.js";

describe("@modelscript/eclipse Industrial Benchmark Suite", () => {
  test("executes SPE10 North Sea reservoir benchmark with DAE lowering and depletion trajectory", () => {
    const res = runEclipseBenchmark();

    assert.equal(res.name, "SPE10 / North Sea Brent Multiphase Black-Oil Reservoir Benchmark");
    assert.deepEqual(res.gridDimensions, [12, 12, 4]);
    assert.equal(res.numActiveCells, 576);

    // Physical bounds on reservoir properties
    assert.ok(res.poreVolumeM3 > 1e6, `Pore volume should be large: ${res.poreVolumeM3}`);
    assert.ok(res.stoiipM3 > 1e6, `STOIIP should be large: ${res.stoiipM3}`);
    assert.ok(res.initialPressurePsi > 3000.0);
    assert.ok(res.cumulativeOilProducedM3 > 0.0);
    assert.ok(res.recoveryFactor > 0.0 && res.recoveryFactor < 1.0);

    // DAE equations and variables
    assert.ok(res.daeVariableCount >= 10, `Expected >= 10 DAE variables, got ${res.daeVariableCount}`);
    assert.ok(res.daeEquationCount >= 10, `Expected >= 10 DAE equations, got ${res.daeEquationCount}`);

    assert.ok(res.daeLoweringTimeMs < 100, `DAE lowering should be fast, got ${res.daeLoweringTimeMs}ms`);
    assert.ok(res.totalTimeMs < 1000, `Total benchmark time should be < 1000ms, got ${res.totalTimeMs}ms`);
  });

  test("validates ECLIPSE deck keywords for black-oil simulation", () => {
    assert.ok(SPE10_BRENT_BENCHMARK_DECK.includes("RUNSPEC"));
    assert.ok(SPE10_BRENT_BENCHMARK_DECK.includes("DIMENS"));
    assert.ok(SPE10_BRENT_BENCHMARK_DECK.includes("PVTO"));
    assert.ok(SPE10_BRENT_BENCHMARK_DECK.includes("WELSPECS"));
    assert.ok(SPE10_BRENT_BENCHMARK_DECK.includes("COMPDAT"));
  });
});
