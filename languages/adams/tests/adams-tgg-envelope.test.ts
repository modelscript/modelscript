// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { adamsPolyglotConfig } from "../src/tgg/index.js";

describe("ADAMS L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "adams",
      level: "L2",
      config: adamsPolyglotConfig,
      samples: [
        {
          ruleName: "AdamsPartToUrdfLink",
          sourceLang: "adams",
          targetLang: "urdf",
          makeSource: (i, rand) => ({
            kind: "AdamsPart",
            name: `Link_${i}`,
            properties: {
              name: `Link_${i}`,
              mass: 2.0 + rand() * 50.0,
            },
          }),
        },
      ],
    });
  });
});
