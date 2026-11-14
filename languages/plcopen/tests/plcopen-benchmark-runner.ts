// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { parsePlcopen } from "../src/parser/index.js";
import { VirtualPlc } from "../src/solver/virtual-plc.js";

const LATCH_ST = `
  PROGRAM LogicTest
    VAR_INPUT
      StartBtn : BOOL := FALSE;
      StopBtn : BOOL := FALSE;
    END_VAR
    VAR_OUTPUT
      MotorOn : BOOL := FALSE;
      Cycles : INT := 0;
    END_VAR
    IF StartBtn AND NOT StopBtn THEN
      MotorOn := TRUE;
    ELSIF StopBtn THEN
      MotorOn := FALSE;
    END_IF;
    Cycles := Cycles + 1;
  END_PROGRAM
`;

export const plcopenBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "plcopen",
  referenceTool: "IEC 61131-3 PLCopen Virtual PLC Scan Engine",
  defaultTolerance: 0,
  metricKind: "exact",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const project = parsePlcopen(LATCH_ST);
    const plc = new VirtualPlc(project);
    plc.step();
    plc.setVariable("StartBtn", true);
    plc.step();
    plc.setVariable("StartBtn", false);
    plc.step();
    const motor = plc.getVariable("MotorOn");
    const cycles = plc.getVariable("Cycles");
    const d1 = performance.now() - t0;

    return [
      {
        id: "plcopen-virtual-plc-scan",
        name: "IEC 61131-3 ST Latch & Deterministic 3-Cycle Scan",
        scale: "micro",
        referenceTool: "IEC 61131-3 PLCopen Virtual PLC Scan Engine",
        metricKind: "exact",
        threshold: 0,
        measuredError: motor === true && cycles === 3 ? 0 : 1,
        passed: motor === true && cycles === 3,
        durationMs: d1,
        details: `MotorOn=${String(motor)}, Cycles=${String(cycles)}`,
      },
    ];
  },
};
