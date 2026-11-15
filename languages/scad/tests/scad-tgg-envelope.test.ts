// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { scadPolyglotConfig } from "../src/tgg/index.js";

describe("SCAD L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "scad",
      level: "L2",
      config: scadPolyglotConfig,
      samples: [
        {
          ruleName: "ScadModuleToSysmlPart",
          sourceLang: "scad",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "ModuleDeclaration",
            name: `Bracket_${i}`,
            properties: {
              name: `Bracket_${i}`,
              parameters: ["w", "h"],
            },
          }),
        },
        {
          ruleName: "ScadProjectedAreaToModelicaParam",
          sourceLang: "scad",
          targetLang: "modelica",
          perturbTargetProp: "defaultValue",
          makeSource: (_i, rand) => ({
            kind: "AssignStatement",
            name: "projected_area",
            properties: {
              name: "projected_area",
              value: 0.05 + rand() * 5.0,
              unit: "m2",
            },
          }),
        },
      ],
    });
  });
});
