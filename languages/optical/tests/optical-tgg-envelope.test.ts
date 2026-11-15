// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { opticalPolyglotConfig } from "../src/tgg/index.js";

describe("Optical L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "optical",
      level: "L2",
      config: opticalPolyglotConfig,
      samples: [
        {
          ruleName: "OpticalSurfaceToSysmlPart",
          sourceLang: "optical",
          targetLang: "sysml2",
          perturbTargetProp: "radiusMm",
          makeSource: (i, rand) => ({
            kind: "OpticalSurface",
            name: `Lens_${i}`,
            properties: {
              name: `Lens_${i}`,
              radiusMm: 20.0 + rand() * 500.0,
            },
          }),
        },
        {
          ruleName: "OpticalLaserToModelicaSource",
          sourceLang: "optical",
          targetLang: "modelica",
          perturbTargetProp: "lambda_nm",
          makeSource: (i, rand) => ({
            kind: "OpticalSource",
            name: `Laser_${i}`,
            properties: {
              name: `Laser_${i}`,
              wavelengthNm: 450.0 + rand() * 1100.0,
            },
          }),
        },
      ],
    });
  });
});
