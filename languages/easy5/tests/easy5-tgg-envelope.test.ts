// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { easy5PolyglotConfig } from "../src/tgg/index.js";

describe("EASY5 L3 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "easy5",
      level: "L3",
      config: easy5PolyglotConfig,
      samples: [
        {
          ruleName: "Easy5GainToModelicaGain",
          sourceLang: "easy5",
          targetLang: "modelica",
          makeSource: (i, rand) => ({
            kind: "Component",
            name: `GA_${i}`,
            properties: {
              type: "GP/GA",
              id: `GA_${i}`,
              K: 1.0 + rand() * 10.0,
            },
          }),
        },
      ],
    });
  });
});
