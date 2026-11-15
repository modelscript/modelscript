// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { cPolyglotConfig } from "../src/tgg/index.js";

describe("C L3 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "c",
      level: "L3",
      config: cPolyglotConfig,
      samples: [
        {
          ruleName: "CFunctionToModelicaFunction",
          sourceLang: "c",
          targetLang: "modelica",
          makeSource: (i) => ({
            kind: "FunctionDefinition",
            name: `compute_rhs_${i}`,
            properties: {
              name: `compute_rhs_${i}`,
              returnType: "double",
            },
          }),
        },
        {
          ruleName: "CStructToModelicaRecord",
          sourceLang: "c",
          targetLang: "modelica",
          makeSource: (i) => ({
            kind: "StructSpecifier",
            name: `StateVec_${i}`,
            properties: {
              name: `StateVec_${i}`,
            },
          }),
        },
      ],
    });
  });
});
