// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { threeMfPolyglotConfig } from "../src/tgg/index.js";

describe("3MF L1 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "three-mf",
      level: "L1",
      config: threeMfPolyglotConfig,
      samples: [
        {
          ruleName: "ThreeMfObjectToStepProduct",
          sourceLang: "three-mf",
          targetLang: "step",
          makeSource: (i) => ({
            kind: "ThreeMfObject",
            name: `Implant_${i}`,
            properties: {
              name: `Implant_${i}`,
              objectType: "model",
            },
          }),
        },
        {
          ruleName: "ThreeMfBuildItemToSysmlPart",
          sourceLang: "three-mf",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "BuildItem",
            name: `TrayItem_${i}`,
            properties: {
              name: `TrayItem_${i}`,
              transformMatrix: "1 0 0 0 1 0 0 0 1 0 0 0",
            },
          }),
        },
      ],
    });
  });
});
