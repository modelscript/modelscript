// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { touchstonePolyglotConfig } from "../src/tgg/index.js";

describe("Touchstone L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "touchstone",
      level: "L2",
      config: touchstonePolyglotConfig,
      samples: [
        {
          ruleName: "TouchstoneNetworkToModelicaPort",
          sourceLang: "touchstone",
          targetLang: "modelica",
          perturbTargetProp: "Z0",
          makeSource: (i, rand) => ({
            kind: "TouchstoneOption",
            name: `Channel_${i}`,
            properties: {
              name: `Channel_${i}`,
              z0Ohm: 45.0 + rand() * 55.0,
            },
          }),
        },
        {
          ruleName: "TouchstoneSampleToSysmlAttribute",
          sourceLang: "touchstone",
          targetLang: "sysml2",
          perturbTargetProp: "frequencyHz",
          makeSource: (i, rand) => ({
            kind: "SParamSample",
            name: `S21_${i}`,
            properties: {
              name: `S21_${i}`,
              freqHz: 1e6 + rand() * 1e10,
            },
          }),
        },
      ],
    });
  });
});
