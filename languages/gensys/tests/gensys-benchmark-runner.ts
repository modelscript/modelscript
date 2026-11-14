// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateEn14363, lowerGensysToDae, parseGensysDeck } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, "..", "testsuite", "ManchesterBenchmark.ins");

export const gensysBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "gensys",
  referenceTool: "GENSYS Manchester Benchmark / EN 14363",
  defaultTolerance: 0,
  metricKind: "dae-parity",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const deck = fs.readFileSync(fixturePath, "utf-8");

    const t0 = performance.now();
    const model = parseGensysDeck(deck, "ManchesterBenchmark");
    const dae = lowerGensysToDae(model);
    const d1 = performance.now() - t0;

    const t1 = performance.now();
    const en = evaluateEn14363({
      lateralForceY: 18.5,
      verticalForceQ: 56.0,
      nominalAxleLoadQ0: 112.0,
    });
    const d2 = performance.now() - t1;

    return [
      {
        id: "gensys-manchester-dae",
        name: "Manchester Benchmark Railway Vehicle DAE Lowering",
        scale: "standard",
        referenceTool: "GENSYS Manchester Benchmark / EN 14363",
        metricKind: "dae-parity",
        threshold: 0,
        measuredError: model.bodies.size === 3 && model.wheelsets.size === 4 && dae.varCount > 0 ? 0 : 1,
        passed: model.bodies.size === 3 && model.wheelsets.size === 4 && dae.varCount > 0,
        durationMs: d1,
        details: `${model.bodies.size} bodies, ${model.wheelsets.size} wheelsets, ${dae.varCount}x${dae.eqCount} DAE`,
      },
      {
        id: "gensys-en14363-safety",
        name: "EN 14363 Nadal Y/Q & Prud'homme Track Shift Safety",
        scale: "micro",
        referenceTool: "GENSYS Manchester Benchmark / EN 14363",
        metricKind: "exact",
        threshold: 0,
        measuredError: en.derailmentRiskPassed && en.prudhommeLimitPassed ? 0 : 1,
        passed: en.derailmentRiskPassed && en.prudhommeLimitPassed && en.yOverQ < 0.4,
        durationMs: d2,
        details: `Y/Q=${en.yOverQ.toFixed(3)} <= 0.80, Prud'homme=${en.prudhommeLimit.toFixed(1)}kN`,
      },
    ];
  },
};
