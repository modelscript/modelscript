// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { SysML2DaeLowerer } from "../src/sysml2-dae-lowerer.js";

export const sysml2BenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "sysml2",
  referenceTool: "OMG SysML v2 Pilot / DAEBuilder Action Kernel",
  defaultTolerance: 0,
  metricKind: "exact",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const actionSysml = `
      action def ComputeTelemetry {
        in item voltage : Real;
        in item current : Real;
        out item power : Real;
        out item resistance : Real;

        assign power := voltage * current;
        assign resistance := voltage / current;
      }
    `;

    const t0 = performance.now();
    const lowered = await SysML2DaeLowerer.lowerAction(actionSysml);
    const outputs = SysML2DaeLowerer.execute(lowered, { voltage: 12.0, current: 3.0 });
    const d1 = performance.now() - t0;

    const err = Math.max(Math.abs((outputs["power"] ?? 0) - 36.0), Math.abs((outputs["resistance"] ?? 0) - 4.0));

    return [
      {
        id: "sysml2-action-dae-exec",
        name: "SysML v2 Action DAE Arena Lowering & Concrete Execution",
        scale: "micro",
        referenceTool: "OMG SysML v2 Pilot / DAEBuilder Action Kernel",
        metricKind: "exact",
        threshold: 0,
        measuredError: err,
        passed: err === 0 && lowered.stmtCount >= 2,
        durationMs: d1,
        details: `power=${outputs["power"]}, R=${outputs["resistance"]}, stmts=${lowered.stmtCount}`,
      },
    ];
  },
};
