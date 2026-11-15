// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { canteraPolyglotConfig } from "../src/tgg/index.js";

describe("Cantera L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "cantera",
      level: "L2",
      config: canteraPolyglotConfig,
      samples: [
        {
          ruleName: "CanteraPhaseToModelicaMedium",
          sourceLang: "cantera",
          targetLang: "modelica",
          makeSource: (i, rand) => ({
            kind: "CanteraPhase",
            name: `GasMix_${i}`,
            properties: {
              name: `GasMix_${i}`,
              temperature: 300.0 + rand() * 1000.0,
              pressure: 101325.0 + rand() * 5e5,
            },
          }),
        },
      ],
    });
  });
});
