// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { olgaPolyglotConfig } from "../src/tgg/index.js";

describe("OLGA L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "olga",
      level: "L2",
      config: olgaPolyglotConfig,
      samples: [
        {
          ruleName: "OlgaFlowpathToSysmlPart",
          sourceLang: "olga",
          targetLang: "sysml2",
          perturbTargetProp: "diameter",
          makeSource: (i, rand) => ({
            kind: "FlowpathElement",
            name: `FP_${i}`,
            properties: {
              name: `FP_${i}`,
              diameter: 0.1 + rand() * 1.5,
              roughness: 1e-5 + rand() * 1e-4,
            },
          }),
        },
        {
          ruleName: "OlgaNodeToModelicaFluidPort",
          sourceLang: "olga",
          targetLang: "modelica",
          perturbTargetProp: "p_start",
          makeSource: (i, rand) => ({
            kind: "NodeElement",
            name: `N_${i}`,
            properties: {
              name: `N_${i}`,
              pressure: 1e5 + rand() * 5e6,
              temperature: 300 + rand() * 50,
            },
          }),
        },
      ],
    });
  });
});
