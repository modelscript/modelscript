// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { bnglPolyglotConfig } from "../src/tgg/index.js";

describe("BNGL L3 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "bngl",
      level: "L3",
      config: bnglPolyglotConfig,
      samples: [
        {
          ruleName: "BnglMoleculeToSysmlPart",
          sourceLang: "bngl",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "MoleculeType",
            name: `EGFR_${i}`,
            properties: {
              name: `EGFR_${i}`,
              sites: "L,CR,Y1068~U~P",
            },
          }),
        },
        {
          ruleName: "BnglRuleToModelicaParam",
          sourceLang: "bngl",
          targetLang: "modelica",
          perturbTargetProp: "k_f",
          makeSource: (i, rand) => ({
            kind: "BnglReactionRule",
            name: `Bind_${i}`,
            properties: {
              name: `Bind_${i}`,
              rateConstant: 0.1 + rand() * 100.0,
            },
          }),
        },
      ],
    });
  });
});
