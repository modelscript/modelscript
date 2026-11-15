// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { jsbsimPolyglotConfig } from "../src/tgg/index.js";

describe("JSBSim L3 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "jsbsim",
      level: "L3",
      config: jsbsimPolyglotConfig,
      samples: [
        {
          ruleName: "JsbsimMetricsToModelicaBody",
          sourceLang: "jsbsim",
          targetLang: "modelica",
          perturbTargetProp: "m_lbs",
          makeSource: (i, rand) => ({
            kind: "MassBalance",
            name: `Airframe_${i}`,
            properties: {
              name: `Airframe_${i}`,
              emptyWtLbs: 2000.0 + rand() * 50000.0,
            },
          }),
        },
        {
          ruleName: "JsbsimChannelToSysmlPart",
          sourceLang: "jsbsim",
          targetLang: "sysml2",
          perturbTargetProp: "gain",
          makeSource: (i, rand) => ({
            kind: "FlightControlChannel",
            name: `Pitch_${i}`,
            properties: {
              name: `Pitch_${i}`,
              gain: 0.1 + rand() * 5.0,
            },
          }),
        },
      ],
    });
  });
});
