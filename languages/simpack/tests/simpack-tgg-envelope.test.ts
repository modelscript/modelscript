// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { simpackPolyglotConfig } from "../src/tgg/index.js";

describe("SIMPACK L2 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "simpack",
      level: "L2",
      config: simpackPolyglotConfig,
      samples: [
        {
          ruleName: "SimpackBodyToModelicaBody",
          sourceLang: "simpack",
          targetLang: "modelica",
          perturbTargetProp: "m",
          makeSource: (i, rand) => ({
            kind: "RigidBody",
            name: `Chassis_${i}`,
            properties: {
              name: `Chassis_${i}`,
              massKg: 500.0 + rand() * 2000.0,
            },
          }),
        },
        {
          ruleName: "SimpackJointToSysmlConnection",
          sourceLang: "simpack",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "KinematicJoint",
            name: `Revolute_${i}`,
            properties: {
              name: `Revolute_${i}`,
              jointType: "Revolute",
            },
          }),
        },
      ],
    });
  });
});
