// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { igtlPolyglotConfig } from "../src/tgg/index.js";

describe("OpenIGTLink L0 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "igtl",
      level: "L0",
      config: igtlPolyglotConfig,
      samples: [
        {
          ruleName: "IgtlTransformToModelicaFrame",
          sourceLang: "igtl",
          targetLang: "modelica",
          perturbTargetProp: "t_stamp",
          makeSource: (i, rand) => ({
            kind: "IgtlTransformMsg",
            name: `TrackerTool_${i}`,
            properties: {
              name: `TrackerTool_${i}`,
              timestampSec: 100.0 + rand() * 5000.0,
            },
          }),
        },
        {
          ruleName: "IgtlDeviceToSysmlPort",
          sourceLang: "igtl",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "IgtlEndpoint",
            name: `NavServer_${i}`,
            properties: {
              name: `NavServer_${i}`,
              msgType: "TRANSFORM",
            },
          }),
        },
      ],
    });
  });
});
