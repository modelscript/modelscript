// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { ranPolyglotConfig } from "../src/tgg/index.js";

describe("RAN L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "ran",
      level: "L2",
      config: ranPolyglotConfig,
      samples: [
        {
          ruleName: "RanGnbToSysmlPart",
          sourceLang: "ran",
          targetLang: "sysml2",
          perturbTargetProp: "carrierFreqGhz",
          makeSource: (i, rand) => ({
            kind: "GNodeB",
            name: `gNB_${i}`,
            properties: {
              name: `gNB_${i}`,
              carrierFreqGhz: 2.4 + rand() * 28.0,
            },
          }),
        },
        {
          ruleName: "RanChannelToModelicaBlock",
          sourceLang: "ran",
          targetLang: "modelica",
          perturbTargetProp: "k",
          makeSource: (i, rand) => ({
            kind: "RadioChannel",
            name: `UMa_${i}`,
            properties: {
              name: `UMa_${i}`,
              pathLossDb: 60.0 + rand() * 80.0,
            },
          }),
        },
      ],
    });
  });
});
