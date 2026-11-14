// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { lowerSimulinkToDae } from "../src/dae/index.js";
import { parseMdl } from "../src/parser/index.js";

const FIRST_ORDER_LAG_MDL = `Model {
  Name "FirstOrderLag"
  System {
    Name "FirstOrderLag"
    Block { BlockType Constant Name "U_in" Value 5.0 }
    Block { BlockType Sum Name "Sum1" Inputs "+-" }
    Block { BlockType Gain Name "Gain1" Gain 2.0 }
    Block { BlockType Integrator Name "Integrator1" InitialCondition 0.0 }
    Line { SrcBlock "U_in" SrcPort 1 DstBlock "Sum1" DstPort 1 }
    Line { SrcBlock "Sum1" SrcPort 1 DstBlock "Gain1" DstPort 1 }
    Line { SrcBlock "Gain1" SrcPort 1 DstBlock "Integrator1" DstPort 1 }
    Line { SrcBlock "Integrator1" SrcPort 1 DstBlock "Sum1" DstPort 2 }
  }
}`;

export const simulinkBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "simulink",
  referenceTool: "MathWorks Simulink / DAEBuilder Block Diagram Arena",
  defaultTolerance: 0,
  metricKind: "dae-parity",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const doc = parseMdl(FIRST_ORDER_LAG_MDL);
    const dae = lowerSimulinkToDae(doc);
    const d1 = performance.now() - t0;

    return [
      {
        id: "simulink-first-order-lag-dae",
        name: "Simulink .mdl Feedback Loop to DAEBuilder Arena",
        scale: "micro",
        referenceTool: "MathWorks Simulink / DAEBuilder Block Diagram Arena",
        metricKind: "dae-parity",
        threshold: 0,
        measuredError: dae.varCount > 0 && dae.eqCount > 0 ? 0 : 1,
        passed: dae.varCount > 0 && dae.eqCount > 0,
        durationMs: d1,
        details: `${dae.varCount} vars, ${dae.eqCount} eqs`,
      },
    ];
  },
};
