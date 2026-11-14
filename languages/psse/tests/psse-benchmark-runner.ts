// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { lowerPsseToDae, parseRaw, solvePowerFlow } from "../src/index.js";

const IEEE_5_RAW = `0, 100.00, 33, 0, 0, 60.00 / PSS/E-33.0 IEEE TEST CASE
IEEE 5 BUS TEST CASE
TRANSMISSION PLANNING MODEL
1, 'BUS 1       ', 132.000, 3, 1, 1, 1, 1.0600, 0.0000
2, 'BUS 2       ', 132.000, 2, 1, 1, 1, 1.0450, -4.9800
3, 'BUS 3       ', 132.000, 2, 1, 1, 1, 1.0100, -12.7200
4, 'BUS 4       ', 132.000, 1, 1, 1, 1, 1.0190, -10.3300
5, 'BUS 5       ', 132.000, 1, 1, 1, 1, 1.0200, -8.7800
0 / END OF BUS DATA
2, '1 ', 1, 1, 1, 21.700, 12.700, 0.000, 0.000, 0.000, 0.000, 1, 1, 1
3, '1 ', 1, 1, 1, 94.200, 19.000, 0.000, 0.000, 0.000, 0.000, 1, 1, 1
4, '1 ', 1, 1, 1, 47.800, -3.900, 0.000, 0.000, 0.000, 0.000, 1, 1, 1
5, '1 ', 1, 1, 1, 7.600, 1.600, 0.000, 0.000, 0.000, 0.000, 1, 1, 1
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 232.400, -16.900, 10.000, -9999.000, 1.0600, 0, 100.00, 0.00000, 1.00000, 0.00000, 0.00000, 1.0000, 1, 100.0, 9999.000, -9999.000
2, '1 ', 40.000, 42.400, 50.000, -40.000, 1.0450, 0, 100.00, 0.00000, 1.00000, 0.00000, 0.00000, 1.0000, 1, 100.0, 9999.000, -9999.000
3, '1 ', 0.000, 23.400, 40.000, 0.000, 1.0100, 0, 100.00, 0.00000, 1.00000, 0.00000, 0.00000, 1.0000, 1, 100.0, 9999.000, -9999.000
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.01938, 0.05917, 0.05280, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
1, 5, '1 ', 0.05403, 0.22304, 0.04920, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
2, 3, '1 ', 0.04699, 0.19797, 0.04380, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
2, 4, '1 ', 0.05811, 0.17632, 0.03400, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
2, 5, '1 ', 0.05695, 0.17388, 0.03460, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
3, 4, '1 ', 0.06701, 0.17103, 0.01280, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
4, 5, '1 ', 0.01335, 0.04211, 0.00000, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
0 / END OF AREA DATA
0 / END OF TWO-TERMINAL DC DATA
0 / END OF VSC DC DATA
0 / END OF SWITCHED SHUNT DATA`;

export const psseBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "psse",
  referenceTool: "Siemens PSS/E 33 / ANDES Newton-Raphson AC Power Flow",
  defaultTolerance: 1e-4,
  metricKind: "residual",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const raw = parseRaw(IEEE_5_RAW);
    const pf = solvePowerFlow(raw);
    const d1 = performance.now() - t0;

    const t1 = performance.now();
    const dae = lowerPsseToDae(raw);
    const d2 = performance.now() - t1;
    const varCount = dae.varCount;
    const eqCount = dae.eqCount;

    return [
      {
        id: "psse-ac-newton-raphson",
        name: "PSS/E-33 Newton-Raphson AC Power Flow Convergence",
        scale: "standard",
        referenceTool: "Siemens PSS/E 33 / ANDES Newton-Raphson AC Power Flow",
        metricKind: "residual",
        threshold: 1e-4,
        measuredError: pf.maxMismatchPu,
        passed: pf.converged && pf.maxMismatchPu < 1e-4,
        durationMs: d1,
        details: `iters=${pf.iterations}, maxMismatch=${pf.maxMismatchPu.toExponential(2)} pu`,
      },
      {
        id: "psse-dae-lowering",
        name: "PSS/E RAW to DAEBuilder Arena Lowering",
        scale: "standard",
        referenceTool: "Siemens PSS/E 33 / ANDES Newton-Raphson AC Power Flow",
        metricKind: "dae-parity",
        threshold: 0,
        measuredError: Math.abs(varCount - eqCount),
        passed: varCount > 0 && varCount === eqCount,
        durationMs: d2,
        details: `${varCount}x${eqCount} DAE`,
      },
    ];
  },
};
