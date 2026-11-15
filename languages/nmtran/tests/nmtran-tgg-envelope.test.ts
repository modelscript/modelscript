// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { nmtranPolyglotConfig } from "../src/tgg/index.js";

describe("NM-TRAN L3 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "nmtran",
      level: "L3",
      config: nmtranPolyglotConfig,
      samples: [
        {
          ruleName: "NmtranThetaToModelicaParam",
          sourceLang: "nmtran",
          targetLang: "modelica",
          perturbTargetProp: "defaultValue",
          makeSource: (i, rand) => ({
            kind: "ThetaParam",
            name: `CL_${i}`,
            properties: {
              name: `CL_${i}`,
              initEstimate: 1.0 + rand() * 20.0,
            },
          }),
        },
        {
          ruleName: "NmtranCompartmentToSysmlPart",
          sourceLang: "nmtran",
          targetLang: "sysml2",
          perturbTargetProp: "volumeL",
          makeSource: (i, rand) => ({
            kind: "PkCompartment",
            name: `Central_${i}`,
            properties: {
              name: `Central_${i}`,
              volumeL: 5.0 + rand() * 50.0,
            },
          }),
        },
      ],
    });
  });
});
