// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { oscalPolyglotConfig } from "../src/tgg/index.js";

describe("OSCAL L1 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "oscal",
      level: "L1",
      config: oscalPolyglotConfig,
      samples: [
        {
          ruleName: "OscalControlToSysmlRequirement",
          sourceLang: "oscal",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "ImplementedRequirement",
            name: `AC-${i}`,
            properties: {
              controlId: `AC-${i}`,
              description: `Enforce access control policy ${i}`,
            },
          }),
        },
        {
          ruleName: "OscalComponentToSysmlPart",
          sourceLang: "oscal",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "SystemComponent",
            name: `PLC_Gateway_${i}`,
            properties: {
              title: `PLC_Gateway_${i}`,
              componentType: "hardware",
            },
          }),
        },
      ],
    });
  });
});
