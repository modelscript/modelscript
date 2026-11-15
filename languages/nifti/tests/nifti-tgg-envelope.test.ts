// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { niftiPolyglotConfig } from "../src/tgg/index.js";

describe("NIfTI L0 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "nifti",
      level: "L0",
      config: niftiPolyglotConfig,
      samples: [
        {
          ruleName: "NiftiVolumeToSysmlPart",
          sourceLang: "nifti",
          targetLang: "sysml2",
          perturbTargetProp: "voxelSpacingMm",
          makeSource: (i, rand) => ({
            kind: "NiftiHeader",
            name: `T1_MRI_${i}`,
            properties: {
              name: `T1_MRI_${i}`,
              voxelSpacingMm: 0.5 + rand() * 2.5,
            },
          }),
        },
        {
          ruleName: "NiftiIntensityToModelicaParam",
          sourceLang: "nifti",
          targetLang: "modelica",
          perturbTargetProp: "slope",
          makeSource: (i, rand) => ({
            kind: "IntensityWindow",
            name: `Win_${i}`,
            properties: {
              name: `Win_${i}`,
              sclSlope: 0.5 + rand() * 5.0,
            },
          }),
        },
      ],
    });
  });
});
