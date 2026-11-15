// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { autosarPolyglotConfig } from "../src/tgg/index.js";

describe("AUTOSAR L1 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "autosar",
      level: "L1",
      config: autosarPolyglotConfig,
      samples: [
        {
          ruleName: "AutosarRPortToSysmlInPort",
          sourceLang: "autosar",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "PortPrototype",
            name: `Port_${i}`,
            properties: {
              shortName: `Port_${i}`,
              direction: "required",
            },
          }),
        },
      ],
    });
  });
});
