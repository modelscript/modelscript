// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { landgemPolyglotConfig } from "../src/tgg/index.js";

describe("LandGEM L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "landgem",
      level: "L2",
      config: landgemPolyglotConfig,
      samples: [
        {
          ruleName: "LandGemCellToModelicaSource",
          sourceLang: "landgem",
          targetLang: "modelica",
          perturbTargetProp: "k_decay",
          makeSource: (i, rand) => ({
            kind: "LandfillCell",
            name: `Cell_${i}`,
            properties: {
              name: `Cell_${i}`,
              methaneDecayK: 0.02 + rand() * 0.08,
            },
          }),
        },
        {
          ruleName: "LandGemSiteToSysmlPart",
          sourceLang: "landgem",
          targetLang: "sysml2",
          perturbTargetProp: "openYear",
          makeSource: (i, rand) => ({
            kind: "LandfillSite",
            name: `Site_${i}`,
            properties: {
              name: `Site_${i}`,
              openYear: 1990 + Math.floor(rand() * 35),
            },
          }),
        },
      ],
    });
  });
});
