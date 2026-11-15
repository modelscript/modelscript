// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { genbankPolyglotConfig } from "../src/tgg/index.js";

describe("GenBank L1 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "genbank",
      level: "L1",
      config: genbankPolyglotConfig,
      samples: [
        {
          ruleName: "GenbankLocusToSysmlPart",
          sourceLang: "genbank",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "GenBankLocus",
            name: `LOCUS_${i}`,
            properties: {
              name: `LOCUS_${i}`,
              moleculeType: "DNA",
            },
          }),
        },
        {
          ruleName: "GenbankFeatureToSbolComponent",
          sourceLang: "genbank",
          targetLang: "sbol",
          makeSource: (i) => ({
            kind: "SequenceFeature",
            name: `lacZ_${i}`,
            properties: {
              name: `lacZ_${i}`,
              featureKey: "CDS",
            },
          }),
        },
      ],
    });
  });
});
