// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { pssePolyglotConfig } from "../src/tgg/index.js";

describe("PSSE L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "psse",
      level: "L2",
      config: pssePolyglotConfig,
      samples: [
        {
          ruleName: "PsseModelToModelicaClass",
          sourceLang: "psse",
          targetLang: "modelica",
          makeSource: (i) => ({
            kind: "psse_model",
            name: `Gen_${i}`,
            properties: {
              name: `Gen_${i}`,
              psseModel: "GENROU",
              psseCategory: "generator",
            },
          }),
        },
      ],
    });
  });
});
