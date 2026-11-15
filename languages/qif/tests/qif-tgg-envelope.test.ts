// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { qifPolyglotConfig } from "../src/tgg/index.js";

describe("QIF L1 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "qif",
      level: "L1",
      config: qifPolyglotConfig,
      samples: [
        {
          ruleName: "QifCharacteristicToSysmlRequirement",
          sourceLang: "qif",
          targetLang: "sysml2",
          perturbTargetProp: "nominalMm",
          makeSource: (i, rand) => ({
            kind: "DimensionalCharacteristic",
            name: `BoreDia_${i}`,
            properties: {
              name: `BoreDia_${i}`,
              nominalMm: 10.0 + rand() * 100.0,
            },
          }),
        },
        {
          ruleName: "QifFeatureToStepEntity",
          sourceLang: "qif",
          targetLang: "step",
          makeSource: (i) => ({
            kind: "MeasurementFeature",
            name: `CylFeature_${i}`,
            properties: {
              name: `CylFeature_${i}`,
              featureType: "CYLINDRICAL_SURFACE",
            },
          }),
        },
      ],
    });
  });
});
