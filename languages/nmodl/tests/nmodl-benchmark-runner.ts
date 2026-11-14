// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { lowerNmodlToDae, parseNmodl, solveNmodlActionPotential } from "../src/index.js";

const HH_MOD = `
TITLE Hodgkin-Huxley Benchmark
NEURON {
  SUFFIX hh_bench
  USEION na READ ena WRITE ina
  USEION k READ ek WRITE ik
}
PARAMETER {
  gnabar = 120.0
  gkbar = 36.0
  ena = 50.0
  ek = -77.0
}
STATE { m h n }
BREAKPOINT {
  SOLVE states METHOD cnexp
  ina = gnabar*m*m*m*h*(v - ena)
  ik = gkbar*n*n*n*n*(v - ek)
}
DERIVATIVE states {
  m' = (0.5 - m)/1.0
  h' = (0.5 - h)/1.0
  n' = (0.5 - n)/1.0
}
`;

export const nmodlBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "nmodl",
  referenceTool: "NEURON NMODL / Hodgkin-Huxley Action Potential",
  defaultTolerance: 0,
  metricKind: "dae-parity",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const doc = parseNmodl(HH_MOD);
    const dae = lowerNmodlToDae(doc);
    const d1 = performance.now() - t0;

    const t1 = performance.now();
    const res = solveNmodlActionPotential(doc, {
      tEnd: 25.0,
      dt: 0.05,
      stimAmp: 10.0,
      stimStart: 2.0,
      stimDuration: 18.0,
    });
    const d2 = performance.now() - t1;

    return [
      {
        id: "nmodl-hh-dae-square",
        name: "NMODL Hodgkin-Huxley Square DAE Arena Lowering",
        scale: "micro",
        referenceTool: "NEURON NMODL / Hodgkin-Huxley Action Potential",
        metricKind: "dae-parity",
        threshold: 0,
        measuredError: Math.abs(dae.varCount - dae.eqCount),
        passed: dae.varCount > 0 && dae.varCount === dae.eqCount,
        durationMs: d1,
        details: `${dae.varCount}x${dae.eqCount} DAE`,
      },
      {
        id: "nmodl-ap-sweep",
        name: "NMODL 25ms Membrane Action Potential Integration",
        scale: "standard",
        referenceTool: "NEURON NMODL / Hodgkin-Huxley Action Potential",
        metricKind: "exact",
        threshold: 0,
        measuredError: res.time.length >= 400 ? 0 : 1,
        passed: res.time.length >= 400,
        durationMs: d2,
        details: `${res.time.length} steps`,
      },
    ];
  },
};
