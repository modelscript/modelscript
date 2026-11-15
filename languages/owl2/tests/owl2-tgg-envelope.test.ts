// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { owl2PolyglotConfig } from "../src/tgg/index.js";

describe("OWL2 L1 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "owl2",
      level: "L1",
      config: owl2PolyglotConfig,
      samples: [
        {
          ruleName: "OWL2ClassToSysML2Part",
          sourceLang: "owl2",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "ClassDeclaration",
            name: `ComponentClass_${i}`,
            properties: {
              iri: `ComponentClass_${i}`,
            },
          }),
        },
        {
          ruleName: "OWL2ClassToModelicaModel",
          sourceLang: "owl2",
          targetLang: "modelica",
          makeSource: (i) => ({
            kind: "ClassDeclaration",
            name: `ThermalSystem_${i}`,
            properties: {
              iri: `ThermalSystem_${i}`,
            },
          }),
        },
      ],
    });
  });
});
