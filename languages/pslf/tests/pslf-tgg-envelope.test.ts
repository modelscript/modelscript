// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { pslfPolyglotConfig } from "../src/tgg/index.js";

describe("PSLF L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "pslf",
      level: "L2",
      config: pslfPolyglotConfig,
      samples: [
        {
          ruleName: "PslfBusToModelicaBus",
          sourceLang: "pslf",
          targetLang: "modelica",
          perturbTargetProp: "V_b",
          makeSource: (i, rand) => ({
            kind: "BusRecord",
            name: `Bus_${i}`,
            properties: {
              name: `Bus_${i}`,
              baseKv: 13.8 + rand() * 500.0,
              vm: 1.0,
            },
          }),
        },
        {
          ruleName: "PslfGeneratorToSysmlPart",
          sourceLang: "pslf",
          targetLang: "sysml2",
          perturbTargetProp: "ratedPowerMW",
          makeSource: (i, rand) => ({
            kind: "GeneratorRecord",
            name: `Gen_${i}`,
            properties: {
              name: `Gen_${i}`,
              pgen: 50.0 + rand() * 800.0,
            },
          }),
        },
      ],
    });
  });
});
