// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { watermlPolyglotConfig } from "../src/tgg/index.js";

describe("WaterML L0 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "waterml",
      level: "L0",
      config: watermlPolyglotConfig,
      samples: [
        {
          ruleName: "WaterMlSeriesToModelicaTable",
          sourceLang: "waterml",
          targetLang: "modelica",
          makeSource: (i) => ({
            kind: "TimeSeriesObservation",
            name: `FlowObs_${i}`,
            properties: {
              name: `FlowObs_${i}`,
              unitCode: "m3/s",
            },
          }),
        },
        {
          ruleName: "WaterMlMonitoringPointToSysmlAttribute",
          sourceLang: "waterml",
          targetLang: "sysml2",
          perturbTargetProp: "elevationM",
          makeSource: (i, rand) => ({
            kind: "MonitoringPoint",
            name: `USGS_${i}`,
            properties: {
              name: `USGS_${i}`,
              elevationM: 10.0 + rand() * 1500.0,
            },
          }),
        },
      ],
    });
  });
});
