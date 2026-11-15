// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { asmPolyglotConfig } from "../src/tgg/index.js";

describe("ASM L3 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "asm",
      level: "L3",
      config: asmPolyglotConfig,
      samples: [
        {
          ruleName: "AsmReactorToModelicaTank",
          sourceLang: "asm",
          targetLang: "modelica",
          perturbTargetProp: "V",
          makeSource: (i, rand) => ({
            kind: "BioreactorUnit",
            name: `AerationTank_${i}`,
            properties: {
              name: `AerationTank_${i}`,
              volumeM3: 100.0 + rand() * 5000.0,
            },
          }),
        },
        {
          ruleName: "AsmProcessToSysmlConstraint",
          sourceLang: "asm",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "BiokineticProcess",
            name: `AerobicGrowth_${i}`,
            properties: {
              name: `AerobicGrowth_${i}`,
              rateExpr: "mu_H * (S_S / (K_S + S_S)) * X_BH",
            },
          }),
        },
      ],
    });
  });
});
