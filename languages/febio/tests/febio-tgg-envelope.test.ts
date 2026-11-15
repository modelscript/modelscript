// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { febioPolyglotConfig } from "../src/tgg/index.js";

describe("FEBio L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "febio",
      level: "L2",
      config: febioPolyglotConfig,
      samples: [
        {
          ruleName: "FebioMaterialToModelicaParam",
          sourceLang: "febio",
          targetLang: "modelica",
          perturbTargetProp: "E",
          makeSource: (i, rand) => ({
            kind: "FebioMaterial",
            name: `Cartilage_${i}`,
            properties: {
              name: `Cartilage_${i}`,
              youngsModulusPa: 1e5 + rand() * 1e7,
            },
          }),
        },
        {
          ruleName: "FebioBoundaryToSysmlConstraint",
          sourceLang: "febio",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "FebioBoundary",
            name: `FixBase_${i}`,
            properties: {
              name: `FixBase_${i}`,
              bcType: "zero_displacement",
            },
          }),
        },
      ],
    });
  });
});
