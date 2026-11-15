// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { matpowerPolyglotConfig } from "../src/tgg/index.js";

describe("MATPOWER L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "matpower",
      level: "L2",
      config: matpowerPolyglotConfig,
      samples: [
        {
          ruleName: "MatpowerBusToPsseBus",
          sourceLang: "matpower",
          targetLang: "psse",
          makeSource: (i, rand) => ({
            kind: "MatpowerBus",
            name: `${i + 1}`,
            properties: {
              bus_i: i + 1,
              baseKV: 138.0,
              vm: 0.95 + rand() * 0.1,
              va: -10.0 + rand() * 20.0,
            },
          }),
        },
      ],
    });
  });
});
