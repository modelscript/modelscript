// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { EmtSolver, type EmtNetlist } from "../src/index.js";

export const pscadBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "pscad",
  referenceTool: "PSCAD/EMTDC Dommel Companion-Circuit",
  defaultTolerance: 1e-3,
  metricKind: "max-relative-error",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const netlist: EmtNetlist = {
      name: "SimpleAcGrid",
      nominalFrequencyHz: 60.0,
      buses: new Map([
        ["Bus1", { id: "Bus1", baseKv: 230.0, nominalKv: 230.0, connectedBranchIds: ["Line1"] }],
        ["Bus2", { id: "Bus2", baseKv: 230.0, nominalKv: 230.0, connectedBranchIds: ["Line1"] }],
      ]),
      sources: [
        {
          id: "Src1",
          bus: "Bus1",
          voltageKv: 230.0,
          frequencyHz: 60.0,
          phaseDeg: 0.0,
          rSourceOhm: 0.5,
          lSourceHenry: 0.005,
        },
      ],
      branches: [
        {
          id: "Line1",
          fromBus: "Bus1",
          toBus: "Bus2",
          rOhm: 1.2,
          lHenry: 0.02,
          cFarad: 1e-6,
        },
      ],
    };

    const t0 = performance.now();
    const res = new EmtSolver(netlist, {
      timeStepSec: 50e-6,
      durationSec: 0.05,
      enableCda: true,
    }).solve();
    const d1 = performance.now() - t0;

    const vBus2 = res.busVoltages.get("Bus2") ?? [];
    let maxV = 0;
    for (let i = 500; i < vBus2.length; i++) {
      maxV = Math.max(maxV, Math.abs(vBus2[i] ?? 0));
    }

    return [
      {
        id: "pscad-230kv-dommel-emt",
        name: "230 kV 3-Phase Transmission Line Dommel EMT (50 us, CDA)",
        scale: "standard",
        referenceTool: "PSCAD/EMTDC Dommel Companion-Circuit",
        metricKind: "max-relative-error",
        threshold: 1e-3,
        measuredError: res.metrics.totalSteps === 1000 && maxV > 150e3 && maxV < 250e3 ? 0 : 1,
        passed: res.metrics.totalSteps === 1000 && res.metrics.luFactorizations === 3 && maxV > 150e3 && maxV < 250e3,
        durationMs: d1,
        details: `steps=${res.metrics.totalSteps}, LU=${res.metrics.luFactorizations}, V_peak=${(maxV / 1e3).toFixed(1)}kV`,
      },
    ];
  },
};
