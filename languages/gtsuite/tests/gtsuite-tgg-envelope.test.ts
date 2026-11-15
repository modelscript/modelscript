// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { gtsuitePolyglotConfig } from "../src/tgg/index.js";

describe("GT-SUITE L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "gtsuite",
      level: "L2",
      config: gtsuitePolyglotConfig,
      samples: [
        {
          ruleName: "GtSuiteCylinderToModelicaVolume",
          sourceLang: "gtsuite",
          targetLang: "modelica",
          perturbTargetProp: "boreMm",
          makeSource: (i, rand) => ({
            kind: "EngineCylinder",
            name: `Cyl_${i}`,
            properties: {
              name: `Cyl_${i}`,
              boreMm: 75.0 + rand() * 40.0,
            },
          }),
        },
        {
          ruleName: "GtSuiteManifoldToSysmlPart",
          sourceLang: "gtsuite",
          targetLang: "sysml2",
          perturbTargetProp: "volumeCm3",
          makeSource: (i, rand) => ({
            kind: "FlowSplit",
            name: `Plenum_${i}`,
            properties: {
              name: `Plenum_${i}`,
              volumeCm3: 500.0 + rand() * 2000.0,
            },
          }),
        },
      ],
    });
  });
});
