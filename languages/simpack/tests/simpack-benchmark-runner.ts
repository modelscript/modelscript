// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeMobility, lintSimpackModel, lowerSimpackToDae, parseSpckXml } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, "..", "testsuite", "DoubleWishbone.spck");

export const simpackBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "simpack",
  referenceTool: "SIMPACK Double-Wishbone / Grübler-Kutzbach Mobility & DAE",
  defaultTolerance: 0,
  metricKind: "dae-parity",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const xml = fs.readFileSync(fixturePath, "utf-8");

    const t0 = performance.now();
    const model = parseSpckXml(xml, "DoubleWishbone");
    const diags = lintSimpackModel(model);
    const mobility = analyzeMobility(model);
    const dae = lowerSimpackToDae(model);
    const d1 = performance.now() - t0;

    return [
      {
        id: "simpack-double-wishbone-dae",
        name: "Double-Wishbone Suspension Mobility (DOF=9) & DAE Lowering",
        scale: "standard",
        referenceTool: "SIMPACK Double-Wishbone / Grübler-Kutzbach Mobility & DAE",
        metricKind: "dae-parity",
        threshold: 0,
        measuredError: Math.abs(mobility.calculatedMobility - 9) + diags.length,
        passed: diags.length === 0 && mobility.calculatedMobility === 9 && dae.varCount > 0,
        durationMs: d1,
        details: `DOF=${mobility.calculatedMobility}, ${dae.varCount}x${dae.eqCount} DAE`,
      },
    ];
  },
};
