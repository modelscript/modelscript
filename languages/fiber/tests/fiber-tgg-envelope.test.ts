// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { fiberPolyglotConfig } from "../src/tgg/index.js";

describe("Fiber L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "fiber",
      level: "L2",
      config: fiberPolyglotConfig,
      samples: [
        {
          ruleName: "FiberSpanToModelicaLink",
          sourceLang: "fiber",
          targetLang: "modelica",
          perturbTargetProp: "L_km",
          makeSource: (i, rand) => ({
            kind: "FiberSpan",
            name: `SMF28_${i}`,
            properties: {
              name: `SMF28_${i}`,
              lengthKm: 1.0 + rand() * 120.0,
            },
          }),
        },
        {
          ruleName: "FiberNodeToSysmlPart",
          sourceLang: "fiber",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "OpticalNode",
            name: `ROADM_${i}`,
            properties: {
              name: `ROADM_${i}`,
              nodeType: "WSS",
            },
          }),
        },
      ],
    });
  });
});
