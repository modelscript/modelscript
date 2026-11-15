// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { powerfactoryPolyglotConfig } from "../src/tgg/index.js";

describe("PowerFactory L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "powerfactory",
      level: "L2",
      config: powerfactoryPolyglotConfig,
      samples: [
        {
          ruleName: "PowerFactoryTermToPsseBus",
          sourceLang: "powerfactory",
          targetLang: "psse",
          makeSource: (i) => ({
            kind: "ElmTerm",
            name: `Term_${i}`,
            properties: {
              loc_name: `Term_${i}`,
              uknom: 110.0,
            },
          }),
        },
      ],
    });
  });
});
