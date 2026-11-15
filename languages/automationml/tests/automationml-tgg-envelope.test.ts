// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { automationmlPolyglotConfig } from "../src/tgg/index.js";

describe("AutomationML L1 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "automationml",
      level: "L1",
      config: automationmlPolyglotConfig,
      samples: [
        {
          ruleName: "AmlInternalElementToSysmlPart",
          sourceLang: "automationml",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "InternalElement",
            name: `RobotCell_${i}`,
            properties: {
              name: `RobotCell_${i}`,
              roleClass: "AutomationMLBaseRoleClassLib/Resource",
            },
          }),
        },
        {
          ruleName: "AmlExternalInterfaceToModelicaPort",
          sourceLang: "automationml",
          targetLang: "modelica",
          makeSource: (i) => ({
            kind: "ExternalInterface",
            name: `EtherCAT_${i}`,
            properties: {
              name: `EtherCAT_${i}`,
              interfaceClass: "CommunicationInterface",
            },
          }),
        },
      ],
    });
  });
});
