// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { ocppPolyglotConfig } from "../src/tgg/index.js";

describe("OCPP L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "ocpp",
      level: "L2",
      config: ocppPolyglotConfig,
      samples: [
        {
          ruleName: "OcppEvseToSysmlPart",
          sourceLang: "ocpp",
          targetLang: "sysml2",
          perturbTargetProp: "maxPowerKw",
          makeSource: (i, rand) => ({
            kind: "EvseUnit",
            name: `EVSE_${i}`,
            properties: {
              name: `EVSE_${i}`,
              maxPowerKw: 7.2 + rand() * 350.0,
            },
          }),
        },
        {
          ruleName: "OcppChargingProfileToModelicaInput",
          sourceLang: "ocpp",
          targetLang: "modelica",
          perturbTargetProp: "I_limit",
          makeSource: (i, rand) => ({
            kind: "ChargingProfile",
            name: `Prof_${i}`,
            properties: {
              name: `Prof_${i}`,
              limitAmps: 16.0 + rand() * 400.0,
            },
          }),
        },
      ],
    });
  });
});
