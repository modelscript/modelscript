// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { spicePolyglotConfig } from "../src/tgg/index.js";

describe("SPICE L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "spice",
      level: "L2",
      config: spicePolyglotConfig,
      samples: [
        {
          ruleName: "SpiceCircuitToSysmlPartDef",
          sourceLang: "spice",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "SpiceCircuit",
            name: `Circuit_${i}`,
            properties: {
              title: `Circuit_${i}`,
            },
          }),
        },
      ],
    });
  });
});
