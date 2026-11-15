// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { rocetsPolyglotConfig } from "../src/tgg/index.js";

describe("ROCETS L3 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "rocets",
      level: "L3",
      config: rocetsPolyglotConfig,
      samples: [
        {
          ruleName: "RocetsChamberToModelicaVolume",
          sourceLang: "rocets",
          targetLang: "modelica",
          perturbTargetProp: "p_c",
          makeSource: (i, rand) => ({
            kind: "ThrustChamber",
            name: `MainChamber_${i}`,
            properties: {
              name: `MainChamber_${i}`,
              chamberPressureBar: 50.0 + rand() * 200.0,
            },
          }),
        },
        {
          ruleName: "RocetsTurbopumpToSysmlPart",
          sourceLang: "rocets",
          targetLang: "sysml2",
          perturbTargetProp: "shaftRpm",
          makeSource: (i, rand) => ({
            kind: "Turbopump",
            name: `LOX_Pump_${i}`,
            properties: {
              name: `LOX_Pump_${i}`,
              shaftRpm: 15000.0 + rand() * 20000.0,
            },
          }),
        },
      ],
    });
  });
});
