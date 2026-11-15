// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { reqifPolyglotConfig } from "../src/tgg/index.js";

describe("ReqIF L1 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "reqif",
      level: "L1",
      config: reqifPolyglotConfig,
      samples: [
        {
          ruleName: "ReqIfSpecObjectToSysmlRequirementDef",
          sourceLang: "reqif",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "SpecObject",
            name: `REQ_${i}`,
            properties: {
              identifier: `REQ_${i}`,
              text: `System shall satisfy constraint ${i}`,
              asilLevel: "ASIL-B",
            },
          }),
        },
      ],
    });
  });
});
