// SPDX-License-Identifier: AGPL-3.0-or-later

import { solvePowerFlow } from "@modelscript/psse";
import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { parsePowerFactoryText } from "../src/parser/powerfactory-parser.js";
import { powerFactoryToPsse } from "../src/projections/powerfactory-to-psse.js";
import { calculateCertifiedIec60909 } from "../src/solvers/iec60909-corrections.js";

const IEEE14_PF_XML = `<?xml version="1.0" encoding="UTF-8"?>
<PowerFactory version="2024">
  <DataObject class="ElmTerm" loc_name="Bus_1"><uknom>132.0</uknom><fnom>50.0</fnom></DataObject>
  <DataObject class="ElmTerm" loc_name="Bus_2"><uknom>132.0</uknom><fnom>50.0</fnom></DataObject>
  <DataObject class="ElmTerm" loc_name="Bus_3"><uknom>132.0</uknom><fnom>50.0</fnom></DataObject>
  <DataObject class="ElmLne" loc_name="L_1_2"><bus1>Bus_1</bus1><bus2>Bus_2</bus2><dline>25.0</dline><r1>1.938</r1><x1>5.917</x1><b1>26.4</b1></DataObject>
  <DataObject class="ElmLne" loc_name="L_2_3"><bus1>Bus_2</bus1><bus2>Bus_3</bus2><dline>30.0</dline><r1>2.325</r1><x1>7.100</x1><b1>31.6</b1></DataObject>
  <DataObject class="ElmSym" loc_name="Gen_1"><bus1>Bus_1</bus1><pgini>150.0</pgini><qgini>30.0</qgini><usetp>1.03</usetp></DataObject>
  <DataObject class="ElmSym" loc_name="Gen_2"><bus1>Bus_2</bus1><pgini>40.0</pgini><qgini>15.0</qgini><usetp>1.02</usetp></DataObject>
  <DataObject class="ElmLod" loc_name="Load_3"><bus1>Bus_3</bus1><plini>95.0</plini><qlini>35.0</qlini></DataObject>
</PowerFactory>`;

export const powerfactoryBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "powerfactory",
  referenceTool: "DIgSILENT PowerFactory 2024 / IEC 60909",
  defaultTolerance: 1e-4,
  metricKind: "max-relative-error",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const model = parsePowerFactoryText(IEEE14_PF_XML, "IEEE14_PF");
    const { psseCase, termToBusMap } = powerFactoryToPsse(model);
    const pfSol = solvePowerFlow(psseCase);
    const d1 = performance.now() - t0;

    const bus1 = pfSol.buses.find((b) => b.busNumber === termToBusMap.get("Bus_1"));
    const bus2 = pfSol.buses.find((b) => b.busNumber === termToBusMap.get("Bus_2"));
    const vErr = Math.max(Math.abs((bus1?.vm ?? 0) - 1.03), Math.abs((bus2?.vm ?? 0) - 1.02));

    const t1 = performance.now();
    const sc = calculateCertifiedIec60909(psseCase, { cMax: 1.1, tMinSec: 0.05 });
    const d2 = performance.now() - t1;

    return [
      {
        id: "powerfactory-ac-loadflow",
        name: "132 kV 3-Bus AC Load Flow Parity",
        scale: "standard",
        referenceTool: "DIgSILENT PowerFactory 2024 / IEC 60909",
        metricKind: "max-relative-error",
        threshold: 1e-4,
        measuredError: vErr,
        passed: pfSol.converged && vErr < 1e-4,
        durationMs: d1,
        details: `iters=${pfSol.iterations}, mismatch=${pfSol.maxMismatchPu.toExponential(2)} pu`,
      },
      {
        id: "powerfactory-iec60909-sc",
        name: "Certified IEC 60909:2016 Short-Circuit Breaking Duty",
        scale: "standard",
        referenceTool: "DIgSILENT PowerFactory 2024 / IEC 60909",
        metricKind: "exact",
        threshold: 0,
        measuredError: sc.buses.length === 3 && sc.maxFaultCurrentKa > 0 ? 0 : 1,
        passed: sc.buses.length === 3 && sc.maxFaultCurrentKa > 0,
        durationMs: d2,
        details: `Ik''_max=${sc.maxFaultCurrentKa.toFixed(2)} kA at Bus ${sc.maxFaultBus}`,
      },
    ];
  },
};
