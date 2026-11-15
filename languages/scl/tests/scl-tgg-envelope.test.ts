// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { sclPolyglotConfig } from "../src/tgg/index.js";

describe("SCL L1 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "scl",
      level: "L1",
      config: sclPolyglotConfig,
      samples: [
        {
          ruleName: "SclIedToSysmlPart",
          sourceLang: "scl",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "IED",
            name: `IED_${i}`,
            properties: {
              name: `IED_${i}`,
              manufacturer: "SEL",
            },
          }),
        },
        {
          ruleName: "SclLogicalNodeToModelicaBlock",
          sourceLang: "scl",
          targetLang: "modelica",
          makeSource: (i) => ({
            kind: "LogicalNode",
            name: `PTOC_${i}`,
            properties: {
              name: `PTOC_${i}`,
              lnClass: "PTOC",
            },
          }),
        },
      ],
    });
  });
});
