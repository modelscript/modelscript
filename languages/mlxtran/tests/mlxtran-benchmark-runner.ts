// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { lowerMlxtranToDae, parseMlxtran, solveMlxtranPk } from "../src/index.js";

const TWO_CMT_MLXTRAN = `
[LONGITUDINAL]
input = {ka, V, Cl, Q, V2}

EQUATION:
ddt_Ad = -ka * Ad
ddt_Ac = ka * Ad - (Cl / V) * Ac - (Q / V) * Ac + (Q / V2) * Ap
ddt_Ap = (Q / V) * Ac - (Q / V2) * Ap
Cc = Ac / V

OUTPUT:
output = {Cc}
`;

export const mlxtranBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "mlxtran",
  referenceTool: "Monolix Mlxtran / 2-Compartment Oral PK",
  defaultTolerance: 0,
  metricKind: "dae-parity",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const doc = parseMlxtran(TWO_CMT_MLXTRAN);
    const dae = lowerMlxtranToDae(doc);
    const d1 = performance.now() - t0;

    const t1 = performance.now();
    const res = solveMlxtranPk(doc, {
      tEnd: 24.0,
      dt: 0.1,
      dose: 100.0,
      params: { ka: 1.0, v: 10.0, cl: 2.0, q: 0.5, v2: 25.0 },
    });
    const d2 = performance.now() - t1;

    return [
      {
        id: "mlxtran-2cmt-dae-square",
        name: "Mlxtran 2-Compartment Oral PK Square DAE Lowering",
        scale: "micro",
        referenceTool: "Monolix Mlxtran / 2-Compartment Oral PK",
        metricKind: "dae-parity",
        threshold: 0,
        measuredError: Math.abs(dae.varCount - dae.eqCount),
        passed: dae.varCount > 0 && dae.varCount === dae.eqCount,
        durationMs: d1,
        details: `${dae.varCount}x${dae.eqCount} DAE`,
      },
      {
        id: "mlxtran-pk-solve",
        name: "Mlxtran 24h Oral PK Integration (AUC / Cmax)",
        scale: "standard",
        referenceTool: "Monolix Mlxtran / 2-Compartment Oral PK",
        metricKind: "exact",
        threshold: 0,
        measuredError: res.auc > 0 ? 0 : 1,
        passed: res.auc > 0,
        durationMs: d2,
        details: `AUC=${res.auc.toFixed(2)} mg*h/L`,
      },
    ];
  },
};
