// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { modelscriptPolyglotConfig } from "../src/tgg/index.js";

describe("ModelScript L3 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "modelscript",
      level: "L3",
      config: modelscriptPolyglotConfig,
      samples: [
        {
          ruleName: "ModelScriptStructToModelicaRecord",
          sourceLang: "modelscript",
          targetLang: "modelica",
          makeSource: (i) => ({
            kind: "StructDeclaration",
            name: `Params_${i}`,
            properties: {
              name: `Params_${i}`,
            },
          }),
        },
        {
          ruleName: "ModelScriptParamToModelicaMod",
          sourceLang: "modelscript",
          targetLang: "modelica",
          makeSource: (i, rand) => ({
            kind: "VariableDeclaration",
            name: `gain_${i}`,
            properties: {
              name: `gain_${i}`,
              value: Number((1.0 + rand() * 10.0).toFixed(4)),
            },
          }),
        },
      ],
    });
  });
});
