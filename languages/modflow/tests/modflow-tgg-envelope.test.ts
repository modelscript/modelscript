// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { modflowPolyglotConfig } from "../src/tgg/index.js";

describe("MODFLOW L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "modflow",
      level: "L2",
      config: modflowPolyglotConfig,
      samples: [
        {
          ruleName: "ModflowAquiferToModelicaMedium",
          sourceLang: "modflow",
          targetLang: "modelica",
          perturbTargetProp: "K",
          makeSource: (i, rand) => ({
            kind: "AquiferLayer",
            name: `Layer_${i}`,
            properties: {
              name: `Layer_${i}`,
              hydraulicCond: 0.01 + rand() * 5.0,
            },
          }),
        },
        {
          ruleName: "ModflowWellToSysmlPart",
          sourceLang: "modflow",
          targetLang: "sysml2",
          perturbTargetProp: "rate",
          makeSource: (i, rand) => ({
            kind: "WellBoundary",
            name: `Well_${i}`,
            properties: {
              name: `Well_${i}`,
              pumpingRate: -500.0 + rand() * 1000.0,
            },
          }),
        },
      ],
    });
  });
});
