// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { calculateBusFaultCurrents } from "../src/analysis/fault-solver.js";
import type { OneLinerCase } from "../src/types.js";

const SAMPLE_500KV_CASE: OneLinerCase = {
  title: "500kV Transmission Interconnection Fault Benchmark",
  baseMva: 100.0,
  frequencyHz: 60.0,
  busses: [
    { id: "BUS500", name: "Substation 500kV", baseKv: 500.0 },
    { id: "BUS230", name: "Substation 230kV", baseKv: 230.0 },
  ],
  branches: [{ id: "XF500-230", bus1: "BUS500", bus2: "BUS230", z1: { r: 0.002, x: 0.08 }, z0: { r: 0.002, x: 0.08 } }],
  mutuals: [],
  generators: [
    {
      id: "GEN_500",
      busId: "BUS500",
      mvaRating: 1200.0,
      z1Subtransient: { r: 0.001, x: 0.15 },
      z0: { r: 0.001, x: 0.08 },
    },
  ],
  overcurrentRelays: [],
  distanceRelays: [],
};

export const onelinerBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "oneliner",
  referenceTool: "ASPEN OneLiner Symmetrical Components Fault Solver",
  defaultTolerance: 1e-3,
  metricKind: "rmse",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const res = calculateBusFaultCurrents(SAMPLE_500KV_CASE, "BUS500", { tolerance: 1e-3 });
    const d1 = performance.now() - t0;

    return [
      {
        id: "oneliner-3ph-slg-fault",
        name: "500 kV 3-Phase & SLG Sequence Network Short-Circuit",
        scale: "standard",
        referenceTool: "ASPEN OneLiner Symmetrical Components Fault Solver",
        metricKind: "rmse",
        threshold: 1e-3,
        measuredError: res.rmse,
        passed: res.converged && res.i3PhaseA > 0 && res.iSlgA > 0 && res.residualMax < 1e-3,
        durationMs: d1,
        details: `I3ph=${res.i3PhaseA.toFixed(0)}A, ISLG=${res.iSlgA.toFixed(0)}A`,
      },
    ];
  },
};
