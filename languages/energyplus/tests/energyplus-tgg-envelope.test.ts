// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { energyplusPolyglotConfig } from "../src/tgg/index.js";

describe("EnergyPlus L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "energyplus",
      level: "L2",
      config: energyplusPolyglotConfig,
      samples: [
        {
          ruleName: "EnergyPlusZoneToModelicaThermalZone",
          sourceLang: "energyplus",
          targetLang: "modelica",
          perturbTargetProp: "V",
          makeSource: (i, rand) => ({
            kind: "ThermalZone",
            name: `Zone_${i}`,
            properties: {
              name: `Zone_${i}`,
              volumeM3: 50.0 + rand() * 2000.0,
            },
          }),
        },
        {
          ruleName: "EnergyPlusSetPointToSysmlRequirement",
          sourceLang: "energyplus",
          targetLang: "sysml2",
          perturbTargetProp: "heatingSetpointC",
          makeSource: (i, rand) => ({
            kind: "ThermostatSetpoint",
            name: `HeatSP_${i}`,
            properties: {
              name: `HeatSP_${i}`,
              heatingTempC: 18.0 + rand() * 6.0,
            },
          }),
        },
      ],
    });
  });
});
