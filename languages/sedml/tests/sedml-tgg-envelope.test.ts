// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { sedmlPolyglotConfig } from "../src/tgg/index.js";

describe("SED-ML L1 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "sedml",
      level: "L1",
      config: sedmlPolyglotConfig,
      samples: [
        {
          ruleName: "SedmlSimulationToSysmlRequirement",
          sourceLang: "sedml",
          targetLang: "sysml2",
          perturbTargetProp: "stopTime",
          makeSource: (i, rand) => ({
            kind: "UniformTimeCourse",
            name: `Sim_${i}`,
            properties: {
              name: `Sim_${i}`,
              outputEndTime: 10.0 + rand() * 500.0,
            },
          }),
        },
        {
          ruleName: "SedmlModelToModelicaModel",
          sourceLang: "sedml",
          targetLang: "modelica",
          makeSource: (i) => ({
            kind: "SedModelRef",
            name: `BioModel_${i}`,
            properties: {
              name: `BioModel_${i}`,
              languageUri: "urn:sedml:language:sbml",
            },
          }),
        },
      ],
    });
  });
});
