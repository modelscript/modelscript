// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { aspenPolyglotConfig } from "../src/tgg/index.js";

describe("Aspen L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "aspen",
      level: "L2",
      config: aspenPolyglotConfig,
      samples: [
        {
          ruleName: "AspenStreamToModelicaFluidPort",
          sourceLang: "aspen",
          targetLang: "modelica",
          perturbTargetProp: "T_start",
          makeSource: (i, rand) => ({
            kind: "MaterialStream",
            name: `Feed_${i}`,
            properties: {
              name: `Feed_${i}`,
              tempK: 290.0 + rand() * 300.0,
            },
          }),
        },
        {
          ruleName: "AspenBlockToSysmlPart",
          sourceLang: "aspen",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "UnitOpBlock",
            name: `Flash_${i}`,
            properties: {
              name: `Flash_${i}`,
              modelType: "Flash2",
            },
          }),
        },
      ],
    });
  });
});
