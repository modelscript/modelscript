// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { opendssPolyglotConfig } from "../src/tgg/index.js";

describe("OpenDSS L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "opendss",
      level: "L2",
      config: opendssPolyglotConfig,
      samples: [
        {
          ruleName: "OpenDssLoadToModelicaLoad",
          sourceLang: "opendss",
          targetLang: "modelica",
          perturbTargetProp: "P_0",
          makeSource: (i, rand) => ({
            kind: "LoadElement",
            name: `Load_${i}`,
            properties: {
              name: `Load_${i}`,
              kw: 10.0 + rand() * 2500.0,
              kvar: 5.0,
            },
          }),
        },
        {
          ruleName: "OpenDssCircuitToSysmlPart",
          sourceLang: "opendss",
          targetLang: "sysml2",
          perturbTargetProp: "baseKv",
          makeSource: (i, rand) => ({
            kind: "CircuitElement",
            name: `Feeder_${i}`,
            properties: {
              name: `Feeder_${i}`,
              basekv: 4.16 + rand() * 34.5,
            },
          }),
        },
      ],
    });
  });
});
