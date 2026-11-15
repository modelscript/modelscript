// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { usdPolyglotConfig } from "../src/tgg/index.js";

describe("USD L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "usd",
      level: "L2",
      config: usdPolyglotConfig,
      samples: [
        {
          ruleName: "UsdPrimToSysmlPart",
          sourceLang: "usd",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "UsdPrim",
            name: `ArmLink_${i}`,
            properties: {
              name: `ArmLink_${i}`,
              primType: "Xform",
            },
          }),
        },
        {
          ruleName: "UsdPhysicsMassToModelicaParam",
          sourceLang: "usd",
          targetLang: "modelica",
          perturbTargetProp: "m",
          makeSource: (i, rand) => ({
            kind: "UsdPhysicsMassApi",
            name: `Payload_${i}`,
            properties: {
              name: `Payload_${i}`,
              massKg: 1.0 + rand() * 250.0,
            },
          }),
        },
      ],
    });
  });
});
