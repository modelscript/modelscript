// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { fortranPolyglotConfig } from "../src/tgg/index.js";

describe("Fortran L3 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "fortran",
      level: "L3",
      config: fortranPolyglotConfig,
      samples: [
        {
          ruleName: "FortranSubroutineToModelicaFunction",
          sourceLang: "fortran",
          targetLang: "modelica",
          makeSource: (i) => ({
            kind: "SubroutineDeclaration",
            name: `solve_step_${i}`,
            properties: {
              name: `solve_step_${i}`,
              arguments: ["x", "dt"],
            },
          }),
        },
        {
          ruleName: "FortranAssignToModelicaEquation",
          sourceLang: "fortran",
          targetLang: "modelica",
          makeSource: (i) => ({
            kind: "AssignmentStatement",
            name: `eq_${i}`,
            properties: {
              target: `y_${i}`,
              value: `a * x_${i}`,
            },
          }),
        },
      ],
    });
  });
});
