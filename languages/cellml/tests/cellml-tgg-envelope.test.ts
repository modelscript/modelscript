// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { cellmlPolyglotConfig } from "../src/tgg/index.js";

describe("CellML L3 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "cellml",
      level: "L3",
      config: cellmlPolyglotConfig,
      samples: [
        {
          ruleName: "CellmlComponentToModelicaModel",
          sourceLang: "cellml",
          targetLang: "modelica",
          makeSource: (i) => ({
            kind: "CellmlComponent",
            name: `Membrane_${i}`,
            properties: {
              name: `Membrane_${i}`,
            },
          }),
        },
        {
          ruleName: "CellmlVariableToModelicaVar",
          sourceLang: "cellml",
          targetLang: "modelica",
          perturbTargetProp: "start",
          makeSource: (i, rand) => ({
            kind: "CellmlVariable",
            name: `V_m_${i}`,
            properties: {
              name: `V_m_${i}`,
              initialValue: -85.0 + rand() * 20.0,
            },
          }),
        },
      ],
    });
  });
});
