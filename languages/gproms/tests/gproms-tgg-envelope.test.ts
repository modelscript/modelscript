// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { gpromsPolyglotConfig } from "../src/tgg/index.js";

describe("gPROMS L3 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "gproms",
      level: "L3",
      config: gpromsPolyglotConfig,
      samples: [
        {
          ruleName: "GpromsModelToModelicaModel",
          sourceLang: "gproms",
          targetLang: "modelica",
          makeSource: (i) => ({
            kind: "GpromsModel",
            name: `DistillationCol_${i}`,
            properties: {
              name: `DistillationCol_${i}`,
            },
          }),
        },
        {
          ruleName: "GpromsParamToModelicaParam",
          sourceLang: "gproms",
          targetLang: "modelica",
          perturbTargetProp: "defaultValue",
          makeSource: (i, rand) => ({
            kind: "GpromsParameter",
            name: `TrayEff_${i}`,
            properties: {
              name: `TrayEff_${i}`,
              value: 0.5 + rand() * 0.5,
            },
          }),
        },
      ],
    });
  });
});
