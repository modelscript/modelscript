// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { selPolyglotConfig } from "../src/tgg/index.js";

describe("SEL L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "sel",
      level: "L2",
      config: selPolyglotConfig,
      samples: [
        {
          ruleName: "SelSettingToModelicaParam",
          sourceLang: "sel",
          targetLang: "modelica",
          perturbTargetProp: "defaultValue",
          makeSource: (i, rand) => ({
            kind: "RelaySetting",
            name: `50P1P_${i}`,
            properties: {
              name: `50P1P_${i}`,
              value: 1.0 + rand() * 50.0,
              group: "1",
            },
          }),
        },
        {
          ruleName: "SelEquationToSysmlConstraint",
          sourceLang: "sel",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "SELogicEquation",
            name: `TR_${i}`,
            properties: {
              name: `TR_${i}`,
              expression: "51P1T OR 50P1",
            },
          }),
        },
      ],
    });
  });
});
