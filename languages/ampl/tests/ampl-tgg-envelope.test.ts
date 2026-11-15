// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { amplPolyglotConfig } from "../src/tgg/index.js";

describe("AMPL L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "ampl",
      level: "L2",
      config: amplPolyglotConfig,
      samples: [
        {
          ruleName: "AmplVarToModelicaComponent",
          sourceLang: "ampl",
          targetLang: "modelica",
          perturbTargetProp: "max",
          makeSource: (i, rand) => ({
            kind: "VariableDecl",
            name: `x_${i}`,
            properties: {
              name: `x_${i}`,
              upperBound: 10.0 + rand() * 500.0,
              lowerBound: 0.0,
            },
          }),
        },
        {
          ruleName: "AmplParamToSysmlAttribute",
          sourceLang: "ampl",
          targetLang: "sysml2",
          perturbTargetProp: "defaultValue",
          makeSource: (i, rand) => ({
            kind: "ParamDecl",
            name: `cost_${i}`,
            properties: {
              name: `cost_${i}`,
              defaultValue: 1.0 + rand() * 100.0,
            },
          }),
        },
      ],
    });
  });
});
