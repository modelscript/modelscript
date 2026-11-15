// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { openscenarioPolyglotConfig } from "../src/tgg/index.js";

describe("OpenSCENARIO L1 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "openscenario",
      level: "L1",
      config: openscenarioPolyglotConfig,
      samples: [
        {
          ruleName: "OpenScenarioEntityToSysmlPart",
          sourceLang: "openscenario",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "ScenarioEntity",
            name: `EgoVehicle_${i}`,
            properties: {
              name: `EgoVehicle_${i}`,
              category: "car",
            },
          }),
        },
        {
          ruleName: "OpenScenarioManeuverToSysmlRequirement",
          sourceLang: "openscenario",
          targetLang: "sysml2",
          perturbTargetProp: "targetSpeedMps",
          makeSource: (i, rand) => ({
            kind: "SpeedAction",
            name: `Cruise_${i}`,
            properties: {
              name: `Cruise_${i}`,
              targetSpeedMps: 15.0 + rand() * 25.0,
            },
          }),
        },
      ],
    });
  });
});
