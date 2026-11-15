// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { pscadPolyglotConfig } from "../src/tgg/index.js";

describe("PSCAD L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "pscad",
      level: "L2",
      config: pscadPolyglotConfig,
      samples: [
        {
          ruleName: "PscadProjectToIeee2800ReportHeader",
          sourceLang: "pscad",
          targetLang: "ieee2800",
          makeSource: (i) => ({
            kind: "PscadProject",
            name: `Proj_${i}`,
            properties: {
              name: `Proj_${i}`,
            },
          }),
        },
      ],
    });
  });
});
