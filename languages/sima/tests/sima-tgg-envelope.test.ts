// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { simaPolyglotConfig } from "../src/tgg/index.js";

describe("SIMA L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "sima",
      level: "L2",
      config: simaPolyglotConfig,
      samples: [
        {
          ruleName: "SimaFloaterToModelicaBody",
          sourceLang: "sima",
          targetLang: "modelica",
          perturbTargetProp: "displacementTons",
          makeSource: (i, rand) => ({
            kind: "FloatingBody",
            name: `SemiSub_${i}`,
            properties: {
              name: `SemiSub_${i}`,
              displacementTons: 10000.0 + rand() * 50000.0,
            },
          }),
        },
        {
          ruleName: "SimaMooringToSysmlConnection",
          sourceLang: "sima",
          targetLang: "sysml2",
          perturbTargetProp: "pretensionKn",
          makeSource: (i, rand) => ({
            kind: "MooringLine",
            name: `Moor_${i}`,
            properties: {
              name: `Moor_${i}`,
              pretensionKn: 500.0 + rand() * 2000.0,
            },
          }),
        },
      ],
    });
  });
});
