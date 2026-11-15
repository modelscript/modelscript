// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { feaPolyglotConfig } from "../src/tgg/index.js";

describe("FEA L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "fea",
      level: "L2",
      config: feaPolyglotConfig,
      samples: [
        {
          ruleName: "FeaStressMassToModelicaParam",
          sourceLang: "fea",
          targetLang: "modelica",
          perturbTargetProp: "defaultValue",
          makeSource: (_i, rand) => ({
            kind: "KeywordCard",
            name: "MASS",
            properties: {
              name: "MASS",
              parameter: 10.0 + rand() * 500.0,
              elset: "AllParts",
            },
          }),
        },
        {
          ruleName: "FeaMaterialToSysmlAttribute",
          sourceLang: "fea",
          targetLang: "sysml2",
          perturbTargetProp: "defaultValue",
          makeSource: (_i, rand) => ({
            kind: "KeywordCard",
            name: "MATERIAL",
            properties: {
              name: "MATERIAL",
              parameter: 1e9 + rand() * 2e11,
              nu: 0.3,
            },
          }),
        },
      ],
    });
  });
});
