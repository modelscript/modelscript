// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { phreeqcPolyglotConfig } from "../src/tgg/index.js";

describe("PHREEQC L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "phreeqc",
      level: "L2",
      config: phreeqcPolyglotConfig,
      samples: [
        {
          ruleName: "PhreeqcSolutionToModelicaMedium",
          sourceLang: "phreeqc",
          targetLang: "modelica",
          perturbTargetProp: "pH",
          makeSource: (i, rand) => ({
            kind: "AqueousSolution",
            name: `Brine_${i}`,
            properties: {
              name: `Brine_${i}`,
              ph: 4.0 + rand() * 5.0,
            },
          }),
        },
        {
          ruleName: "PhreeqcPhaseToSysmlAttribute",
          sourceLang: "phreeqc",
          targetLang: "sysml2",
          perturbTargetProp: "saturationIndex",
          makeSource: (i, rand) => ({
            kind: "EquilibriumPhase",
            name: `Calcite_${i}`,
            properties: {
              name: `Calcite_${i}`,
              targetSi: -1.0 + rand() * 2.0,
            },
          }),
        },
      ],
    });
  });
});
