// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { opensimPolyglotConfig } from "../src/tgg/index.js";

describe("OpenSim L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "opensim",
      level: "L2",
      config: opensimPolyglotConfig,
      samples: [
        {
          ruleName: "OpenSimBodyToModelicaBody",
          sourceLang: "opensim",
          targetLang: "modelica",
          perturbTargetProp: "m",
          makeSource: (i, rand) => ({
            kind: "OsimBody",
            name: `Femur_${i}`,
            properties: {
              name: `Femur_${i}`,
              massKg: 5.0 + rand() * 15.0,
            },
          }),
        },
        {
          ruleName: "OpenSimMuscleToSysmlPart",
          sourceLang: "opensim",
          targetLang: "sysml2",
          perturbTargetProp: "maxForceN",
          makeSource: (i, rand) => ({
            kind: "Thelen2003Muscle",
            name: `Soleus_${i}`,
            properties: {
              name: `Soleus_${i}`,
              maxIsometricForceN: 500.0 + rand() * 3000.0,
            },
          }),
        },
      ],
    });
  });
});
