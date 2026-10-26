// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ReqIf } from "../src/commands/reqif.js";

const SAMPLE_REQIF = `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">
  <THE-HEADER>
    <REQ-IF-HEADER IDENTIFIER="H-01">
      <REQ-IF-VERSION>1.0</REQ-IF-VERSION>
      <TITLE>Vehicle Safety Specification</TITLE>
    </REQ-IF-HEADER>
  </THE-HEADER>
  <CORE-CONTENT>
    <REQ-IF-CONTENT>
      <SPEC-TYPES>
        <SPEC-OBJECT-TYPE IDENTIFIER="ST-REQ" LONG-NAME="Safety Requirement">
          <SPEC-ATTRIBUTES>
            <ATTRIBUTE-DEFINITION-STRING IDENTIFIER="AD-DESC" LONG-NAME="Description" />
          </SPEC-ATTRIBUTES>
        </SPEC-OBJECT-TYPE>
      </SPEC-TYPES>
      <SPEC-OBJECTS>
        <SPEC-OBJECT IDENTIFIER="REQ-MAX-SPEED" LONG-NAME="Speed Limit">
          <TYPE>
            <SPEC-OBJECT-TYPE-REF>ST-REQ</SPEC-OBJECT-TYPE-REF>
          </TYPE>
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>AD-DESC</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>
              <THE-VALUE>Maximum vehicle velocity must be &lt;= 160 km/h. ASIL-D.</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
        <SPEC-OBJECT IDENTIFIER="REQ-MOTOR-SPEED" LONG-NAME="Motor Speed Limit">
          <TYPE>
            <SPEC-OBJECT-TYPE-REF>ST-REQ</SPEC-OBJECT-TYPE-REF>
          </TYPE>
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>AD-DESC</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>
              <THE-VALUE>Electric motor speed must be &lt;= 140 km/h. ASIL-D.</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
      </SPEC-OBJECTS>
      <SPEC-RELATIONS>
        <SPEC-RELATION IDENTIFIER="REL-01" LONG-NAME="satisfies">
          <SOURCE><SPEC-OBJECT-REF>REQ-MOTOR-SPEED</SPEC-OBJECT-REF></SOURCE>
          <TARGET><SPEC-OBJECT-REF>REQ-MAX-SPEED</SPEC-OBJECT-REF></TARGET>
        </SPEC-RELATION>
      </SPEC-RELATIONS>
      <SPECIFICATIONS>
        <SPECIFICATION IDENTIFIER="SPEC-01" LONG-NAME="Powertrain Specs">
          <CHILDREN>
            <SPEC-HIERARCHY IDENTIFIER="SH-01" OBJECT-REF="REQ-MAX-SPEED">
              <CHILDREN>
                <SPEC-HIERARCHY IDENTIFIER="SH-02" OBJECT-REF="REQ-MOTOR-SPEED" />
              </CHILDREN>
            </SPEC-HIERARCHY>
          </CHILDREN>
        </SPECIFICATION>
      </SPECIFICATIONS>
    </REQ-IF-CONTENT>
  </CORE-CONTENT>
</REQ-IF>`;

test("CLI: ReqIF Requirements Management (msx reqif lint / verify / to-sysml / to-modelica)", async (t) => {
  const scratchDir = path.resolve("scratch_reqif_cli");
  if (!fs.existsSync(scratchDir)) {
    fs.mkdirSync(scratchDir, { recursive: true });
  }

  t.after(() => {
    if (fs.existsSync(scratchDir)) {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  const reqifFile = path.join(scratchDir, "Safety.reqif");
  fs.writeFileSync(reqifFile, SAMPLE_REQIF, "utf-8");

  // Helper to find subcommand handler
  const subcommands = new Map<string, any>();
  const mockYargs: any = {
    command: (cmd: any) => {
      const name = cmd.command.split(" ")[0];
      subcommands.set(name, cmd);
      return mockYargs;
    },
    demandCommand: () => mockYargs,
  };
  (ReqIf.builder as any)(mockYargs);

  // 1. msx reqif lint Safety.reqif
  const lintCmd = subcommands.get("lint");
  assert.ok(lintCmd, "lint subcommand must be registered");
  await lintCmd.handler({ file: reqifFile });

  // 2. msx reqif verify Safety.reqif (Nelson-Oppen Entailment)
  const verifyCmd = subcommands.get("verify");
  assert.ok(verifyCmd, "verify subcommand must be registered");
  await verifyCmd.handler({ file: reqifFile });

  // 3. msx reqif to-sysml Safety.reqif --out=Safety.sysml
  const toSysmlCmd = subcommands.get("to-sysml");
  assert.ok(toSysmlCmd, "to-sysml subcommand must be registered");
  const sysmlOut = path.join(scratchDir, "Safety.sysml");
  await toSysmlCmd.handler({ file: reqifFile, out: sysmlOut });
  assert.ok(fs.existsSync(sysmlOut));
  const sysmlContent = fs.readFileSync(sysmlOut, "utf-8");
  assert.ok(sysmlContent.includes("requirement def"));

  // 4. msx reqif to-modelica Safety.reqif --out=Safety.mo
  const toModelicaCmd = subcommands.get("to-modelica");
  assert.ok(toModelicaCmd, "to-modelica subcommand must be registered");
  const moOut = path.join(scratchDir, "Safety.mo");
  await toModelicaCmd.handler({ file: reqifFile, out: moOut });
  assert.ok(fs.existsSync(moOut));
  const moContent = fs.readFileSync(moOut, "utf-8");
  assert.ok(moContent.includes("model") || moContent.includes("block"));
});
