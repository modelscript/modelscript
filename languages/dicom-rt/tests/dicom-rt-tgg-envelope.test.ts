// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { dicomRtPolyglotConfig } from "../src/tgg/index.js";

describe("DICOM-RT L1 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "dicom-rt",
      level: "L1",
      config: dicomRtPolyglotConfig,
      samples: [
        {
          ruleName: "DicomRtPlanToSysmlRequirement",
          sourceLang: "dicom-rt",
          targetLang: "sysml2",
          perturbTargetProp: "targetDoseGy",
          makeSource: (i, rand) => ({
            kind: "RtPlan",
            name: `IMRT_Plan_${i}`,
            properties: {
              name: `IMRT_Plan_${i}`,
              prescribedDoseGy: 40.0 + rand() * 35.0,
            },
          }),
        },
        {
          ruleName: "DicomRtBeamToModelicaParam",
          sourceLang: "dicom-rt",
          targetLang: "modelica",
          perturbTargetProp: "gantryAngleDeg",
          makeSource: (i, rand) => ({
            kind: "RtBeam",
            name: `Beam_${i}`,
            properties: {
              name: `Beam_${i}`,
              gantryAngleDeg: 10.0 + rand() * 340.0,
            },
          }),
        },
      ],
    });
  });
});
