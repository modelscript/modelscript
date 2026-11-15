// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { mlxtranPolyglotConfig } from "../src/tgg/index.js";

describe("Mlxtran L3 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "mlxtran",
      level: "L3",
      config: mlxtranPolyglotConfig,
      samples: [
        {
          ruleName: "MlxtranParamToModelicaParam",
          sourceLang: "mlxtran",
          targetLang: "modelica",
          perturbTargetProp: "defaultValue",
          makeSource: (i, rand) => ({
            kind: "MlxtranParameter",
            name: `ka_${i}`,
            properties: {
              name: `ka_${i}`,
              typicalValue: 0.2 + rand() * 5.0,
            },
          }),
        },
        {
          ruleName: "MlxtranOdeToSysmlConstraint",
          sourceLang: "mlxtran",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "MlxtranEquation",
            name: `ddt_Ac_${i}`,
            properties: {
              name: `ddt_Ac_${i}`,
              rhsExpr: "-ka * Ac",
            },
          }),
        },
      ],
    });
  });
});
