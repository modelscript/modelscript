// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { plcopenPolyglotConfig } from "../src/tgg/index.js";

describe("PLCopen L3 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "plcopen",
      level: "L3",
      config: plcopenPolyglotConfig,
      samples: [
        {
          ruleName: "PlcopenPouToModelicaBlock",
          sourceLang: "plcopen",
          targetLang: "modelica",
          perturbTargetProp: "samplePeriodMs",
          makeSource: (i, rand) => ({
            kind: "PlcPou",
            name: `PID_Loop_${i}`,
            properties: {
              name: `PID_Loop_${i}`,
              cycleTimeMs: 5.0 + rand() * 100.0,
            },
          }),
        },
        {
          ruleName: "PlcopenVarToSysmlAttribute",
          sourceLang: "plcopen",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "PlcVariable",
            name: `ValveCmd_${i}`,
            properties: {
              name: `ValveCmd_${i}`,
              dataType: "REAL",
            },
          }),
        },
      ],
    });
  });
});
