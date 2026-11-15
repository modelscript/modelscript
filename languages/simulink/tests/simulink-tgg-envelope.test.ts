// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { simulinkPolyglotConfig } from "../src/tgg/index.js";

describe("Simulink L3 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "simulink",
      level: "L3",
      config: simulinkPolyglotConfig,
      samples: [
        {
          ruleName: "SimulinkGainToModelicaGain",
          sourceLang: "simulink",
          targetLang: "modelica",
          makeSource: (i, rand) => ({
            kind: "Block",
            name: `Gain_${i}`,
            properties: {
              type: "Gain",
              name: `Gain_${i}`,
              Gain: 1.0 + rand() * 5.0,
            },
          }),
        },
      ],
    });
  });
});
