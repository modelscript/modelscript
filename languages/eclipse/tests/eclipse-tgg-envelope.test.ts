// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { eclipsePolyglotConfig } from "../src/tgg/index.js";

describe("Eclipse L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "eclipse",
      level: "L2",
      config: eclipsePolyglotConfig,
      samples: [
        {
          ruleName: "EclipseWellToModelicaSink",
          sourceLang: "eclipse",
          targetLang: "modelica",
          perturbTargetProp: "p",
          makeSource: (i, rand) => ({
            kind: "WellSpec",
            name: `PROD_${i}`,
            properties: {
              name: `PROD_${i}`,
              bhpBar: 50.0 + rand() * 300.0,
            },
          }),
        },
        {
          ruleName: "EclipseGridToSysmlPart",
          sourceLang: "eclipse",
          targetLang: "sysml2",
          perturbTargetProp: "porosity",
          makeSource: (i, rand) => ({
            kind: "ReservoirGrid",
            name: `Grid_${i}`,
            properties: {
              name: `Grid_${i}`,
              porosity: 0.05 + rand() * 0.3,
            },
          }),
        },
      ],
    });
  });
});
