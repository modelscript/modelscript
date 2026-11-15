// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { nmodlPolyglotConfig } from "../src/tgg/index.js";

describe("NMODL L3 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "nmodl",
      level: "L3",
      config: nmodlPolyglotConfig,
      samples: [
        {
          ruleName: "NmodlChannelToModelicaComponent",
          sourceLang: "nmodl",
          targetLang: "modelica",
          perturbTargetProp: "G",
          makeSource: (i, rand) => ({
            kind: "NmodlMechanism",
            name: `hh_na_${i}`,
            properties: {
              name: `hh_na_${i}`,
              conductanceS: 0.05 + rand() * 0.5,
            },
          }),
        },
        {
          ruleName: "NmodlStateToSysmlAttribute",
          sourceLang: "nmodl",
          targetLang: "sysml2",
          perturbTargetProp: "defaultValue",
          makeSource: (i, rand) => ({
            kind: "NmodlState",
            name: `v_mem_${i}`,
            properties: {
              name: `v_mem_${i}`,
              initialVal: -70.0 + rand() * 10.0,
            },
          }),
        },
      ],
    });
  });
});
