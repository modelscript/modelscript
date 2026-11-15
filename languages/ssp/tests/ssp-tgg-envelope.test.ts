// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { sspPolyglotConfig } from "../src/tgg/index.js";

describe("SSP L1 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "ssp",
      level: "L1",
      config: sspPolyglotConfig,
      samples: [
        {
          ruleName: "SspSystemToModelicaModel",
          sourceLang: "ssp",
          targetLang: "modelica",
          makeSource: (i) => ({
            kind: "System",
            name: `Sys_${i}`,
            properties: {
              name: `Sys_${i}`,
              version: "1.0",
              description: `SSP System ${i}`,
            },
          }),
        },
        {
          ruleName: "SspComponentToModelicaComponent",
          sourceLang: "ssp",
          targetLang: "modelica",
          makeSource: (i) => ({
            kind: "Component",
            name: `Comp_${i}`,
            properties: {
              name: `Comp_${i}`,
              source: `resources/model_${i}.fmu`,
              type: "application/x-fmu-sharedlibrary",
            },
          }),
        },
      ],
    });
  });
});
