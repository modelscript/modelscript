// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { lpsPolyglotConfig } from "../src/tgg/index.js";

describe("LPS L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "lps",
      level: "L2",
      config: lpsPolyglotConfig,
      samples: [
        {
          ruleName: "LpsPipeToModelicaPipe",
          sourceLang: "lps",
          targetLang: "modelica",
          perturbTargetProp: "diameter",
          makeSource: (i, rand) => ({
            kind: "LpsPipeSegment",
            name: `Pipe_${i}`,
            properties: {
              name: `Pipe_${i}`,
              innerDiameterM: 0.1 + rand() * 1.2,
            },
          }),
        },
        {
          ruleName: "LpsPumpStationToSysmlPart",
          sourceLang: "lps",
          targetLang: "sysml2",
          perturbTargetProp: "ratedHeadM",
          makeSource: (i, rand) => ({
            kind: "PumpStation",
            name: `PS_${i}`,
            properties: {
              name: `PS_${i}`,
              ratedHeadM: 20.0 + rand() * 200.0,
            },
          }),
        },
      ],
    });
  });
});
