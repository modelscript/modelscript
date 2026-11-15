// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { stepPolyglotConfig } from "../src/tgg/index.js";

describe("STEP L1 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "step",
      level: "L1",
      config: stepPolyglotConfig,
      samples: [
        {
          ruleName: "StepProductToSysmlPart",
          sourceLang: "step",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "StepEntity",
            name: `Part_${i}`,
            properties: {
              entityType: "PRODUCT",
              name: `Part_${i}`,
              stepId: `#${100 + i}`,
            },
          }),
        },
        {
          ruleName: "StepProductToModelicaModel",
          sourceLang: "step",
          targetLang: "modelica",
          makeSource: (i) => ({
            kind: "StepEntity",
            name: `Assembly_${i}`,
            properties: {
              entityType: "PRODUCT",
              name: `Assembly_${i}`,
              stepId: `#${200 + i}`,
            },
          }),
        },
      ],
    });
  });
});
