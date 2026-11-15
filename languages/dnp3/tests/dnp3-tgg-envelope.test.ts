// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { dnp3PolyglotConfig } from "../src/tgg/index.js";

describe("DNP3 L1 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "dnp3",
      level: "L1",
      config: dnp3PolyglotConfig,
      samples: [
        {
          ruleName: "Dnp3OutstationToSysmlPart",
          sourceLang: "dnp3",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "OutstationDevice",
            name: `RTU_${i}`,
            properties: {
              name: `RTU_${i}`,
              address: 100 + i,
            },
          }),
        },
        {
          ruleName: "Dnp3PointToModelicaSignal",
          sourceLang: "dnp3",
          targetLang: "modelica",
          makeSource: (i) => ({
            kind: "PointMapping",
            name: `AI_${i}`,
            properties: {
              name: `AI_${i}`,
              group: "AnalogInput",
            },
          }),
        },
      ],
    });
  });
});
