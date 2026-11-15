// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { opendrivePolyglotConfig } from "../src/tgg/index.js";

describe("OpenDRIVE L1 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "opendrive",
      level: "L1",
      config: opendrivePolyglotConfig,
      samples: [
        {
          ruleName: "OpenDriveRoadToSysmlPart",
          sourceLang: "opendrive",
          targetLang: "sysml2",
          perturbTargetProp: "lengthM",
          makeSource: (i, rand) => ({
            kind: "RoadSegment",
            name: `Road_${i}`,
            properties: {
              name: `Road_${i}`,
              lengthM: 50.0 + rand() * 1000.0,
            },
          }),
        },
        {
          ruleName: "OpenDriveSpeedLimitToModelicaParam",
          sourceLang: "opendrive",
          targetLang: "modelica",
          perturbTargetProp: "v_max",
          makeSource: (i, rand) => ({
            kind: "LaneSpeedLimit",
            name: `Lane_${i}`,
            properties: {
              name: `Lane_${i}`,
              maxSpeedMps: 10.0 + rand() * 30.0,
            },
          }),
        },
      ],
    });
  });
});
