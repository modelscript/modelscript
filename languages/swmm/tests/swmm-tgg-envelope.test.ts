// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { swmmPolyglotConfig } from "../src/tgg/index.js";

describe("SWMM L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "swmm",
      level: "L2",
      config: swmmPolyglotConfig,
      samples: [
        {
          ruleName: "SwmmConduitToModelicaChannel",
          sourceLang: "swmm",
          targetLang: "modelica",
          makeSource: (i, rand) => ({
            kind: "SwmmConduit",
            name: `C_${i}`,
            properties: {
              name: `C_${i}`,
              length: 50.0 + rand() * 200.0,
              roughness: 0.012,
            },
          }),
        },
      ],
    });
  });
});
