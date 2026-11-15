// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { epanetPolyglotConfig } from "../src/tgg/index.js";

describe("EPANET L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "epanet",
      level: "L2",
      config: epanetPolyglotConfig,
      samples: [
        {
          ruleName: "EpanetJunctionToModelicaNode",
          sourceLang: "epanet",
          targetLang: "modelica",
          makeSource: (i, rand) => ({
            kind: "EpanetJunction",
            name: `J_${i}`,
            properties: {
              id: `J_${i}`,
              elevation: 10.0 + rand() * 100.0,
              demand: 0.01 + rand() * 0.5,
            },
          }),
        },
      ],
    });
  });
});
