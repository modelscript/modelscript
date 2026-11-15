// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { ccsdsPolyglotConfig } from "../src/tgg/index.js";

describe("CCSDS L1 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "ccsds",
      level: "L1",
      config: ccsdsPolyglotConfig,
      samples: [
        {
          ruleName: "CcsdsOemToModelicaTrajectory",
          sourceLang: "ccsds",
          targetLang: "modelica",
          perturbTargetProp: "a_km",
          makeSource: (i, rand) => ({
            kind: "OrbitStateVector",
            name: `Sat_${i}`,
            properties: {
              name: `Sat_${i}`,
              semiMajorAxisKm: 6778.0 + rand() * 35000.0,
            },
          }),
        },
        {
          ruleName: "CcsdsPacketToSysmlInterface",
          sourceLang: "ccsds",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "SpacePacket",
            name: `TM_${i}`,
            properties: {
              name: `TM_${i}`,
              apid: 100 + i,
            },
          }),
        },
      ],
    });
  });
});
