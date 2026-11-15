// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { topasPolyglotConfig } from "../src/tgg/index.js";

describe("TOPAS L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "topas",
      level: "L2",
      config: topasPolyglotConfig,
      samples: [
        {
          ruleName: "TopasGeometryToSysmlPart",
          sourceLang: "topas",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "GeComponent",
            name: `WaterPhantom_${i}`,
            properties: {
              name: `WaterPhantom_${i}`,
              componentType: "TsBox",
            },
          }),
        },
        {
          ruleName: "TopasBeamToModelicaParam",
          sourceLang: "topas",
          targetLang: "modelica",
          perturbTargetProp: "E_MeV",
          makeSource: (i, rand) => ({
            kind: "SoSource",
            name: `ProtonBeam_${i}`,
            properties: {
              name: `ProtonBeam_${i}`,
              beamEnergyMev: 70.0 + rand() * 160.0,
            },
          }),
        },
      ],
    });
  });
});
