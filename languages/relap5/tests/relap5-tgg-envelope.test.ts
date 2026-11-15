// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { relap5PolyglotConfig } from "../src/tgg/index.js";

describe("RELAP5 L3 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "relap5",
      level: "L3",
      config: relap5PolyglotConfig,
      samples: [
        {
          ruleName: "Relap5VolumeToModelicaVolume",
          sourceLang: "relap5",
          targetLang: "modelica",
          perturbTargetProp: "A",
          makeSource: (i, rand) => ({
            kind: "HydroComponent",
            name: `CoreVol_${i}`,
            properties: {
              name: `CoreVol_${i}`,
              flowAreaM2: 0.05 + rand() * 10.0,
            },
          }),
        },
        {
          ruleName: "Relap5TripToSysmlRequirement",
          sourceLang: "relap5",
          targetLang: "sysml2",
          perturbTargetProp: "setpoint",
          makeSource: (i, rand) => ({
            kind: "TripCard",
            name: `SCRAM_${i}`,
            properties: {
              name: `SCRAM_${i}`,
              setpoint: 1.0e6 + rand() * 1.5e7,
            },
          }),
        },
      ],
    });
  });
});
