// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { gtfsPolyglotConfig } from "../src/tgg/index.js";

describe("GTFS L0 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "gtfs",
      level: "L0",
      config: gtfsPolyglotConfig,
      samples: [
        {
          ruleName: "GtfsStopToSysmlPart",
          sourceLang: "gtfs",
          targetLang: "sysml2",
          perturbTargetProp: "latitude",
          makeSource: (i, rand) => ({
            kind: "TransitStop",
            name: `Stop_${i}`,
            properties: {
              name: `Stop_${i}`,
              stopLat: 30.0 + rand() * 20.0,
            },
          }),
        },
        {
          ruleName: "GtfsRouteToModelicaBlock",
          sourceLang: "gtfs",
          targetLang: "modelica",
          perturbTargetProp: "period",
          makeSource: (i, rand) => ({
            kind: "TransitRoute",
            name: `Route_${i}`,
            properties: {
              name: `Route_${i}`,
              headwaySec: 300.0 + rand() * 900.0,
            },
          }),
        },
      ],
    });
  });
});
