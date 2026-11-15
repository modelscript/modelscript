// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { hecRasPolyglotConfig } from "../src/tgg/index.js";

describe("HEC-RAS L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "hec-ras",
      level: "L2",
      config: hecRasPolyglotConfig,
      samples: [
        {
          ruleName: "HecRasReachToModelicaChannel",
          sourceLang: "hec-ras",
          targetLang: "modelica",
          perturbTargetProp: "n_manning",
          makeSource: (i, rand) => ({
            kind: "RiverReach",
            name: `Reach_${i}`,
            properties: {
              name: `Reach_${i}`,
              manningN: 0.015 + rand() * 0.1,
            },
          }),
        },
        {
          ruleName: "HecRasBridgeToSysmlPart",
          sourceLang: "hec-ras",
          targetLang: "sysml2",
          perturbTargetProp: "crestElevM",
          makeSource: (i, rand) => ({
            kind: "InlineStructure",
            name: `Weir_${i}`,
            properties: {
              name: `Weir_${i}`,
              crestElevM: 10.0 + rand() * 300.0,
            },
          }),
        },
      ],
    });
  });
});
