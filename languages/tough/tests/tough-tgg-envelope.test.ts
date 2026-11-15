// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { toughPolyglotConfig } from "../src/tgg/index.js";

describe("TOUGH L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "tough",
      level: "L2",
      config: toughPolyglotConfig,
      samples: [
        {
          ruleName: "ToughRockToModelicaMedium",
          sourceLang: "tough",
          targetLang: "modelica",
          perturbTargetProp: "k",
          makeSource: (i, rand) => ({
            kind: "RockDomain",
            name: `Shale_${i}`,
            properties: {
              name: `Shale_${i}`,
              permeabilityM2: 1e-16 + rand() * 1e-12,
            },
          }),
        },
        {
          ruleName: "ToughGenToSysmlPart",
          sourceLang: "tough",
          targetLang: "sysml2",
          perturbTargetProp: "massRateKgS",
          makeSource: (i, rand) => ({
            kind: "SourceSinkBlock",
            name: `Inj_${i}`,
            properties: {
              name: `Inj_${i}`,
              rateKgS: 1.0 + rand() * 50.0,
            },
          }),
        },
      ],
    });
  });
});
