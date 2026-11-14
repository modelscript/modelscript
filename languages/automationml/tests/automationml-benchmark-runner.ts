// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { lowerAutomationMLToDae } from "../src/dae/index.js";
import { parseAutomationML } from "../src/parser/index.js";

const CELL_AML = `
  aml "ConveyorStation.aml" version "2.15"
  instanceHierarchy "SortingCell" {
    element PlcController [id="plc-1", ppr=Resource] {
      interface partAtEnd: In BOOL
      interface motorRun: Out BOOL
    }
    element BeltConveyor [id="conv-1", ppr=Resource] {
      frame (x=0.0, y=0.0, z=0.0, rx=0, ry=0, rz=0)
      attribute maxSpeed: REAL = 2.0 [m/s]
      attribute timeConstant: REAL = 0.02 [s]
      interface runCmd: In BOOL
      interface endSensor: Out BOOL
    }
    link "CmdLink" plc-1:motorRun -> conv-1:runCmd
    link "SensorLink" conv-1:endSensor -> plc-1:partAtEnd
  }
`;

export const automationmlBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "automationml",
  referenceTool: "AutomationML 2.15 / DAEBuilder Plant Arena",
  defaultTolerance: 0,
  metricKind: "dae-parity",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const doc = parseAutomationML(CELL_AML);
    const arena = lowerAutomationMLToDae(doc);
    const d1 = performance.now() - t0;

    return [
      {
        id: "automationml-dae-arena",
        name: "AutomationML SortingCell Topology to DAEBuilder Arena",
        scale: "micro",
        referenceTool: "AutomationML 2.15 / DAEBuilder Plant Arena",
        metricKind: "dae-parity",
        threshold: 0,
        measuredError: arena.getVarCount() >= 8 && arena.getEqCount() >= 6 ? 0 : 1,
        passed: arena.getVarCount() >= 8 && arena.getEqCount() >= 6,
        durationMs: d1,
        details: `${arena.getVarCount()} vars, ${arena.getEqCount()} eqs`,
      },
    ];
  },
};
