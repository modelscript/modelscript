// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { comtradePolyglotConfig } from "../src/tgg/index.js";

describe("COMTRADE L0 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "comtrade",
      level: "L0",
      config: comtradePolyglotConfig,
      samples: [
        {
          ruleName: "ComtradeChannelToModelicaSignal",
          sourceLang: "comtrade",
          targetLang: "modelica",
          makeSource: (i) => ({
            kind: "AnalogChannel",
            name: `VA_${i}`,
            properties: {
              name: `VA_${i}`,
              unit: "kV",
            },
          }),
        },
        {
          ruleName: "ComtradeConfigToSysmlAttribute",
          sourceLang: "comtrade",
          targetLang: "sysml2",
          perturbTargetProp: "sampleRateHz",
          makeSource: (i, rand) => ({
            kind: "ComtradeConfig",
            name: `FaultRec_${i}`,
            properties: {
              name: `FaultRec_${i}`,
              sampleRateHz: 1000.0 + rand() * 20000.0,
            },
          }),
        },
      ],
    });
  });
});
