// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { openadrPolyglotConfig } from "../src/tgg/index.js";

describe("OpenADR L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "openadr",
      level: "L2",
      config: openadrPolyglotConfig,
      samples: [
        {
          ruleName: "OpenAdrEventToSysmlRequirement",
          sourceLang: "openadr",
          targetLang: "sysml2",
          perturbTargetProp: "curtailmentKw",
          makeSource: (i, rand) => ({
            kind: "DrEvent",
            name: `Evt_${i}`,
            properties: {
              name: `Evt_${i}`,
              targetCurtailmentKw: 10.0 + rand() * 5000.0,
            },
          }),
        },
        {
          ruleName: "OpenAdrVenToModelicaLoad",
          sourceLang: "openadr",
          targetLang: "modelica",
          perturbTargetProp: "P_0",
          makeSource: (i, rand) => ({
            kind: "VirtualEndNode",
            name: `VEN_${i}`,
            properties: {
              name: `VEN_${i}`,
              baselineKw: 50.0 + rand() * 10000.0,
            },
          }),
        },
      ],
    });
  });
});
