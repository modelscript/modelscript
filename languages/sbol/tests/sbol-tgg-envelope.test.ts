// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { sbolPolyglotConfig } from "../src/tgg/index.js";

describe("SBOL L1 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "sbol",
      level: "L1",
      config: sbolPolyglotConfig,
      samples: [
        {
          ruleName: "SbolComponentToSysmlPart",
          sourceLang: "sbol",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "ComponentDefinition",
            name: `Promoter_${i}`,
            properties: {
              name: `Promoter_${i}`,
              roleUri: "http://identifiers.org/so/SO:0000167",
            },
          }),
        },
        {
          ruleName: "SbolInteractionToModelicaBlock",
          sourceLang: "sbol",
          targetLang: "modelica",
          makeSource: (i) => ({
            kind: "GeneticInteraction",
            name: `Repression_${i}`,
            properties: {
              name: `Repression_${i}`,
              interactionType: "Inhibition",
            },
          }),
        },
      ],
    });
  });
});
