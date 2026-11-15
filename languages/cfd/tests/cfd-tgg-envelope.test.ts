// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { cfdPolyglotConfig } from "../src/tgg/index.js";

describe("CFD L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "cfd",
      level: "L2",
      config: cfdPolyglotConfig,
      samples: [
        {
          ruleName: "CfdDragPolarToModelicaParam",
          sourceLang: "cfd",
          targetLang: "modelica",
          perturbTargetProp: "defaultValue",
          makeSource: (_i, rand) => ({
            kind: "Directive",
            name: "CD",
            properties: {
              key: "CD",
              value: 0.02 + rand() * 1.2,
              refArea: 1.5,
            },
          }),
        },
        {
          ruleName: "CfdMarkerToSysmlPort",
          sourceLang: "cfd",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "Directive",
            name: "MARKER_SYM",
            properties: {
              key: "MARKER_SYM",
              value: `symPlane_${i}`,
              dialect: "SU2",
            },
          }),
        },
      ],
    });
  });
});
