// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { modelicaPolyglotConfig } from "../src/tgg/index.js";

describe("Modelica L3 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "modelica",
      level: "L3",
      config: modelicaPolyglotConfig,
      samples: [
        {
          ruleName: "ModelicaModelToSysmlBlock",
          sourceLang: "modelica",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "ClassDefinition",
            name: `PlantModel_${i}`,
            properties: {
              name: `PlantModel_${i}`,
            },
          }),
        },
        {
          ruleName: "ModelicaConnectToSysmlConnection",
          sourceLang: "modelica",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "ConnectClause",
            name: `conn_${i}`,
            properties: {
              name: `conn_${i}`,
            },
          }),
        },
      ],
    });
  });
});
