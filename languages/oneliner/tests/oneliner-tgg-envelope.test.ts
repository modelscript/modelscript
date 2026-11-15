// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { onelinerPolyglotConfig } from "../src/tgg/index.js";

describe("OneLiner L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "oneliner",
      level: "L2",
      config: onelinerPolyglotConfig,
      samples: [
        {
          ruleName: "OnelinerRelayToModelicaRelay",
          sourceLang: "oneliner",
          targetLang: "modelica",
          perturbTargetProp: "I_pickup",
          makeSource: (i, rand) => ({
            kind: "OvercurrentRelay",
            name: `Relay_${i}`,
            properties: {
              name: `Relay_${i}`,
              pickupAmps: 100.0 + rand() * 2000.0,
              curveType: "IEEE_VeryInverse",
            },
          }),
        },
        {
          ruleName: "OnelinerBreakerToSysmlPart",
          sourceLang: "oneliner",
          targetLang: "sysml2",
          perturbTargetProp: "ratingKa",
          makeSource: (i, rand) => ({
            kind: "BreakerElement",
            name: `Brk_${i}`,
            properties: {
              name: `Brk_${i}`,
              interruptingKa: 20.0 + rand() * 63.0,
            },
          }),
        },
      ],
    });
  });
});
