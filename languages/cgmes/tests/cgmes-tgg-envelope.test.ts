// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { cgmesPolyglotConfig } from "../src/tgg/index.js";

describe("CGMES L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "cgmes",
      level: "L2",
      config: cgmesPolyglotConfig,
      samples: [
        {
          ruleName: "CgmesLineToModelicaLine",
          sourceLang: "cgmes",
          targetLang: "modelica",
          perturbTargetProp: "R",
          makeSource: (i, rand) => ({
            kind: "ACLineSegment",
            name: `Line_${i}`,
            properties: {
              name: `Line_${i}`,
              r: 0.01 + rand() * 5.0,
              x: 0.1,
            },
          }),
        },
        {
          ruleName: "CgmesSubstationToSysmlPart",
          sourceLang: "cgmes",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "Substation",
            name: `Sub_${i}`,
            properties: {
              name: `Sub_${i}`,
              region: "RegionNorth",
            },
          }),
        },
      ],
    });
  });
});
