// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { runAspenBenchmark, DE_ETHANIZER_BENCHMARK_DECK } from "./aspen-benchmark-runner.js";

describe("@modelscript/aspen Industrial Benchmark Suite", () => {
  test("executes de-ethanizer hydrocarbon fractionation benchmark with DAE lowering", () => {
    const res = runAspenBenchmark();

    assert.equal(res.name, "Industrial De-Ethanizer & Hydrocarbon Fractionation Train");
    assert.equal(res.propertyMethod, "PENG-ROB");
    assert.equal(res.numComponents, 4);
    assert.equal(res.numBlocks, 5);

    // Flash mass balance: L + V === F
    assert.ok(Math.abs(res.flashLiquidFlow + res.flashVaporFlow - 1000.0) < 1e-4);
    assert.ok(res.flashVaporFraction >= 0.0 && res.flashVaporFraction <= 1.0);

    // DAE structural squareness
    assert.ok(res.daeVariableCount >= 30, `Expected >= 30 DAE variables, got ${res.daeVariableCount}`);
    assert.ok(res.daeEquationCount >= 30, `Expected >= 30 DAE equations, got ${res.daeEquationCount}`);
    assert.equal(res.isSquare, true, "Aspen DAE flowsheet system must be structurally square");

    assert.ok(res.daeLoweringTimeMs < 100, `DAE lowering should be fast, got ${res.daeLoweringTimeMs}ms`);
    assert.ok(res.totalTimeMs < 500, `Total benchmark time should be < 500ms, got ${res.totalTimeMs}ms`);
  });

  test("validates Aspen input deck structure and flowsheet blocks", () => {
    assert.ok(DE_ETHANIZER_BENCHMARK_DECK.includes("TITLE 'INDUSTRIAL DE-ETHANIZER"));
    assert.ok(DE_ETHANIZER_BENCHMARK_DECK.includes("BLOCK COL1 RADFRAC"));
    assert.ok(DE_ETHANIZER_BENCHMARK_DECK.includes("BLOCK PREFLASH FLASH2"));
    assert.ok(DE_ETHANIZER_BENCHMARK_DECK.includes("BLOCK PUMP1 PUMP"));
  });
});
