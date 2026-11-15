// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { sysml2PolyglotConfig } from "../src/tgg/index.js";

describe("SysML2 L1 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "sysml2",
      level: "L1",
      config: sysml2PolyglotConfig,
      samples: [
        {
          ruleName: "PartDefToModelicaModel",
          sourceLang: "sysml2",
          targetLang: "modelica",
          makeSource: (i) => ({
            kind: "PartDefinition",
            name: `SubSystem_${i}`,
            properties: {
              declaredName: `SubSystem_${i}`,
            },
          }),
        },
      ],
    });
  });
});
