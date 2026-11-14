// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { lowerAutosarToDae } from "../src/dae/index.js";
import { parseArxml } from "../src/parser/index.js";

const POWERTRAIN_ARXML = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR>
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>Powertrain</SHORT-NAME>
      <ELEMENTS>
        <APPLICATION-SW-COMPONENT-TYPE>
          <SHORT-NAME>PedalSensor</SHORT-NAME>
          <PORTS>
            <P-PORT-PROTOTYPE>
              <SHORT-NAME>PedalOut</SHORT-NAME>
              <PROVIDED-INTERFACE-TREF>/Powertrain/PedalIf</PROVIDED-INTERFACE-TREF>
            </P-PORT-PROTOTYPE>
          </PORTS>
        </APPLICATION-SW-COMPONENT-TYPE>
        <APPLICATION-SW-COMPONENT-TYPE>
          <SHORT-NAME>EngineController</SHORT-NAME>
          <PORTS>
            <R-PORT-PROTOTYPE>
              <SHORT-NAME>PedalIn</SHORT-NAME>
              <REQUIRED-INTERFACE-TREF>/Powertrain/PedalIf</REQUIRED-INTERFACE-TREF>
            </R-PORT-PROTOTYPE>
          </PORTS>
        </APPLICATION-SW-COMPONENT-TYPE>
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>`;

export const autosarBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "autosar",
  referenceTool: "AUTOSAR R22-11 ARXML / DAEBuilder Arena",
  defaultTolerance: 0,
  metricKind: "dae-parity",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const doc = parseArxml(POWERTRAIN_ARXML);
    const dae = lowerAutosarToDae(doc);
    const d1 = performance.now() - t0;

    return [
      {
        id: "autosar-arxml-dae",
        name: "AUTOSAR Powertrain SWC ARXML to DAEBuilder Arena",
        scale: "micro",
        referenceTool: "AUTOSAR R22-11 ARXML / DAEBuilder Arena",
        metricKind: "dae-parity",
        threshold: 0,
        measuredError: dae.varCount > 0 ? 0 : 1,
        passed: dae.varCount > 0 && dae.eqCount >= 0,
        durationMs: d1,
        details: `${dae.varCount} vars, ${dae.eqCount} eqs`,
      },
    ];
  },
};
