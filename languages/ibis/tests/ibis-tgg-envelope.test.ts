// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { ibisPolyglotConfig } from "../src/tgg/index.js";

describe("IBIS L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "ibis",
      level: "L2",
      config: ibisPolyglotConfig,
      samples: [
        {
          ruleName: "IbisComponentToSysmlPart",
          sourceLang: "ibis",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "IbisComponent",
            name: `FPGA_IO_${i}`,
            properties: {
              name: `FPGA_IO_${i}`,
              manufacturer: "AcmeSemi",
            },
          }),
        },
        {
          ruleName: "IbisModelToModelicaBuffer",
          sourceLang: "ibis",
          targetLang: "modelica",
          perturbTargetProp: "C",
          makeSource: (i, rand) => ({
            kind: "IbisModel",
            name: `LVDS_${i}`,
            properties: {
              name: `LVDS_${i}`,
              cCompPf: 0.5 + rand() * 10.0,
            },
          }),
        },
      ],
    });
  });
});
