// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { parseSpice, solveAc, solveOp } from "../src/index.js";

export const spiceBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "spice",
  referenceTool: "Berkeley SPICE3f5 / ngspice",
  defaultTolerance: 0.015,
  metricKind: "max-relative-error",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const rlcNetlist = `* Series RLC Bandpass Resonant Tank
V1 in 0 AC 1
L1 in n1 1m
C1 n1 out 100n
R1 out 0 50
.AC LIN 1000 10k 25k
.END`;
    const t0 = performance.now();
    const ac = solveAc(parseSpice(rlcNetlist));
    const d1 = performance.now() - t0;
    const outSig = ac.nodeVoltages.get("OUT");
    let maxMag = -1;
    let peakFreq = 0;
    if (outSig) {
      for (let i = 0; i < ac.frequency.length; i++) {
        const mag = outSig.magnitude[i] ?? 0;
        if (mag > maxMag) {
          maxMag = mag;
          peakFreq = ac.frequency[i] ?? 0;
        }
      }
    }
    const relErr1 = Math.abs(peakFreq - 15915.49) / 15915.49;

    const opAmpNetlist = `* Non-Inverting Op-Amp Stage (Av = 11)
V_IN in 0 DC 0.5 AC 1.0
E_OP out 0 in neg 100000
R_F out neg 10k
R_IN neg 0 1k
R_LOAD out 0 50k
.OP
.END`;
    const t1 = performance.now();
    const op = solveOp(parseSpice(opAmpNetlist));
    const d2 = performance.now() - t1;
    const gain = (op.nodeVoltages.get("OUT") ?? 0) / (op.nodeVoltages.get("IN") ?? 1);
    const relErr2 = Math.abs(gain - 11.0) / 11.0;

    return [
      {
        id: "spice-rlc-ac-resonance",
        name: "Series RLC Resonant Bandpass AC Sweep",
        scale: "standard",
        referenceTool: "Berkeley SPICE3f5 / ngspice",
        metricKind: "max-relative-error",
        threshold: 0.015,
        measuredError: relErr1,
        passed: Boolean(outSig) && relErr1 < 0.015 && maxMag > 0.95,
        durationMs: d1,
        details: `f0=${peakFreq.toFixed(1)}Hz, |Vout|_max=${maxMag.toFixed(3)}V`,
      },
      {
        id: "spice-opamp-dc-op",
        name: "Non-Inverting Op-Amp DC Operating Point",
        scale: "micro",
        referenceTool: "Berkeley SPICE3f5 / ngspice",
        metricKind: "max-relative-error",
        threshold: 0.001,
        measuredError: relErr2,
        passed: op.converged && relErr2 < 0.001,
        durationMs: d2,
        details: `Av=${gain.toFixed(4)} (ideal 11.0)`,
      },
    ];
  },
};
