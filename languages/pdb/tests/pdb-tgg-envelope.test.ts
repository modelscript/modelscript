// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { pdbPolyglotConfig } from "../src/tgg/index.js";

describe("PDB L0 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "pdb",
      level: "L0",
      config: pdbPolyglotConfig,
      samples: [
        {
          ruleName: "PdbChainToSysmlPart",
          sourceLang: "pdb",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "PolypeptideChain",
            name: `ChainA_${i}`,
            properties: {
              name: `ChainA_${i}`,
              residueCount: 150 + i,
            },
          }),
        },
        {
          ruleName: "PdbAtomSiteToModelicaParam",
          sourceLang: "pdb",
          targetLang: "modelica",
          perturbTargetProp: "B_factor",
          makeSource: (i, rand) => ({
            kind: "AtomSite",
            name: `CA_${i}`,
            properties: {
              name: `CA_${i}`,
              bFactor: 15.0 + rand() * 40.0,
            },
          }),
        },
      ],
    });
  });
});
