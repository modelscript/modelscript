// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { sbmlPolyglotConfig } from "../src/tgg/index.js";

describe("SBML L3 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "sbml",
      level: "L3",
      config: sbmlPolyglotConfig,
      samples: [
        {
          ruleName: "SbmlSpeciesToModelicaVariable",
          sourceLang: "sbml",
          targetLang: "modelica",
          perturbTargetProp: "start",
          makeSource: (i, rand) => ({
            kind: "SbmlSpecies",
            name: `ATP_${i}`,
            properties: {
              name: `ATP_${i}`,
              initialConc: 0.1 + rand() * 10.0,
            },
          }),
        },
        {
          ruleName: "SbmlReactionToSysmlConstraint",
          sourceLang: "sbml",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "SbmlReaction",
            name: `Glycolysis_${i}`,
            properties: {
              name: `Glycolysis_${i}`,
              kineticLaw: "k1 * ATP - k2 * ADP",
            },
          }),
        },
      ],
    });
  });
});
