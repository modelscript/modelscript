// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { antimonyPolyglotConfig } from "../src/tgg/index.js";

describe("Antimony L3 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "antimony",
      level: "L3",
      config: antimonyPolyglotConfig,
      samples: [
        {
          ruleName: "AntimonyModelToModelicaModel",
          sourceLang: "antimony",
          targetLang: "modelica",
          makeSource: (i) => ({
            kind: "AntimonyModel",
            name: `Pathway_${i}`,
            properties: {
              name: `Pathway_${i}`,
            },
          }),
        },
        {
          ruleName: "AntimonyRateParamToModelicaParam",
          sourceLang: "antimony",
          targetLang: "modelica",
          perturbTargetProp: "defaultValue",
          makeSource: (i, rand) => ({
            kind: "RateParameter",
            name: `k_cat_${i}`,
            properties: {
              name: `k_cat_${i}`,
              value: 0.01 + rand() * 50.0,
            },
          }),
        },
      ],
    });
  });
});
