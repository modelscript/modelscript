// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { smilesPolyglotConfig } from "../src/tgg/index.js";

describe("SMILES L1 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "smiles",
      level: "L1",
      config: smilesPolyglotConfig,
      samples: [
        {
          ruleName: "SmilesMoleculeToSysmlPart",
          sourceLang: "smiles",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "SmilesMolecule",
            name: `Aspirin_${i}`,
            properties: {
              name: `Aspirin_${i}`,
              canonicalSmiles: "CC(=O)OC1=CC=CC=C1C(=O)O",
            },
          }),
        },
        {
          ruleName: "SmilesPropertyToModelicaParam",
          sourceLang: "smiles",
          targetLang: "modelica",
          perturbTargetProp: "MM",
          makeSource: (i, rand) => ({
            kind: "MolecularProperty",
            name: `MolWt_${i}`,
            properties: {
              name: `MolWt_${i}`,
              molarMassGmol: 100.0 + rand() * 400.0,
            },
          }),
        },
      ],
    });
  });
});
