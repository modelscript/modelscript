// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { gensysPolyglotConfig } from "../src/tgg/index.js";

describe("GENSYS L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "gensys",
      level: "L2",
      config: gensysPolyglotConfig,
      samples: [
        {
          ruleName: "GensysCarBodyToModelicaBody",
          sourceLang: "gensys",
          targetLang: "modelica",
          perturbTargetProp: "m",
          makeSource: (i, rand) => ({
            kind: "RailVehicleBody",
            name: `Coach_${i}`,
            properties: {
              name: `Coach_${i}`,
              massKg: 25000.0 + rand() * 20000.0,
            },
          }),
        },
        {
          ruleName: "GensysTrackToSysmlPart",
          sourceLang: "gensys",
          targetLang: "sysml2",
          perturbTargetProp: "gaugeMm",
          makeSource: (i, rand) => ({
            kind: "TrackSegment",
            name: `Track_${i}`,
            properties: {
              name: `Track_${i}`,
              gaugeMm: 1435.0 + rand() * 5.0,
            },
          }),
        },
      ],
    });
  });
});
