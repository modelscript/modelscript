// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { verilogAPolyglotConfig } from "../src/tgg/index.js";

describe("Verilog-A L3 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "verilog-a",
      level: "L3",
      config: verilogAPolyglotConfig,
      samples: [
        {
          ruleName: "VerilogAModuleToModelicaModel",
          sourceLang: "verilog-a",
          targetLang: "modelica",
          makeSource: (i) => ({
            kind: "ModuleDeclaration",
            name: `MOSFET_L3_${i}`,
            properties: {
              name: `MOSFET_L3_${i}`,
            },
          }),
        },
        {
          ruleName: "VerilogAParameterToModelicaParam",
          sourceLang: "verilog-a",
          targetLang: "modelica",
          perturbTargetProp: "defaultValue",
          makeSource: (i, rand) => ({
            kind: "ParameterDeclaration",
            name: `vth0_${i}`,
            properties: {
              name: `vth0_${i}`,
              defaultValue: 0.2 + rand() * 1.5,
            },
          }),
        },
      ],
    });
  });
});
