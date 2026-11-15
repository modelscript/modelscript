// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { atpPolyglotConfig } from "../src/tgg/index.js";

describe("ATP L3 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "atp",
      level: "L3",
      config: atpPolyglotConfig,
      samples: [
        {
          ruleName: "AtpBranchToModelicaRlc",
          sourceLang: "atp",
          targetLang: "modelica",
          perturbTargetProp: "R",
          makeSource: (i, rand) => ({
            kind: "BranchCard",
            name: `Br_${i}`,
            properties: {
              name: `Br_${i}`,
              rOhm: 0.1 + rand() * 500.0,
              lMh: 1.5,
            },
          }),
        },
        {
          ruleName: "AtpControlToSysmlRequirement",
          sourceLang: "atp",
          targetLang: "sysml2",
          perturbTargetProp: "timeStep",
          makeSource: (i, rand) => ({
            kind: "SimulationControl",
            name: `SimCtl_${i}`,
            properties: {
              name: `SimCtl_${i}`,
              deltaT: 1e-6 + rand() * 1e-4,
            },
          }),
        },
      ],
    });
  });
});
