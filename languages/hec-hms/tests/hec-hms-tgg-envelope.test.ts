// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { hecHmsPolyglotConfig } from "../src/tgg/index.js";

describe("HEC-HMS L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "hec-hms",
      level: "L2",
      config: hecHmsPolyglotConfig,
      samples: [
        {
          ruleName: "HecHmsSubbasinToModelicaCatchment",
          sourceLang: "hec-hms",
          targetLang: "modelica",
          perturbTargetProp: "areaKm2",
          makeSource: (i, rand) => ({
            kind: "Subbasin",
            name: `Subbasin_${i}`,
            properties: {
              name: `Subbasin_${i}`,
              areaKm2: 1.0 + rand() * 500.0,
            },
          }),
        },
        {
          ruleName: "HecHmsJunctionToSysmlPart",
          sourceLang: "hec-hms",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "HydroJunction",
            name: `Junc_${i}`,
            properties: {
              name: `Junc_${i}`,
              downstream: `Outlet_${i}`,
            },
          }),
        },
      ],
    });
  });
});
