// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { urdfPolyglotConfig } from "../src/tgg/index.js";

describe("URDF L1 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "urdf",
      level: "L1",
      config: urdfPolyglotConfig,
      samples: [
        {
          ruleName: "UrdfRobotToModelicaModel",
          sourceLang: "urdf",
          targetLang: "modelica",
          makeSource: (i) => ({
            kind: "Robot",
            name: `Arm_${i}`,
            properties: {
              name: `Arm_${i}`,
            },
          }),
        },
      ],
    });
  });
});
