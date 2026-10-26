// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseReqIf, reqifToModelicaVerifier, reqifToSysml2, sysml2ToReqIf } from "../src/index.js";

const TEST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">
  <THE-HEADER>
    <REQ-IF-HEADER IDENTIFIER="H1"><TITLE>Battery Safety Spec</TITLE></REQ-IF-HEADER>
  </THE-HEADER>
  <CORE-CONTENT>
    <REQ-IF-CONTENT>
      <SPEC-OBJECTS>
        <SPEC-OBJECT IDENTIFIER="REQ-BATT-TEMP" LONG-NAME="Battery Temperature">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <THE-VALUE>Battery cell temperature must be &lt;= 55 degC. ASIL-C.</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
        <SPEC-OBJECT IDENTIFIER="REQ-BATT-VOLT" LONG-NAME="Battery Voltage">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <THE-VALUE>Pack voltage must be &gt;= 350 V.</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
      </SPEC-OBJECTS>
      <SPEC-RELATIONS>
        <SPEC-RELATION IDENTIFIER="REL-01" LONG-NAME="satisfies">
          <SOURCE><SPEC-OBJECT-REF>REQ-BATT-VOLT</SPEC-OBJECT-REF></SOURCE>
          <TARGET><SPEC-OBJECT-REF>REQ-BATT-TEMP</SPEC-OBJECT-REF></TARGET>
        </SPEC-RELATION>
      </SPEC-RELATIONS>
    </REQ-IF-CONTENT>
  </CORE-CONTENT>
</REQ-IF>`;

describe("@modelscript/reqif projections", () => {
  it("translates ReqIF document to valid SysML v2 requirement definitions and satisfaction links", () => {
    const doc = parseReqIf(TEST_XML);
    const sysmlCode = reqifToSysml2(doc);

    assert.ok(sysmlCode.includes("package Battery_Safety_Spec {"));
    assert.ok(sysmlCode.includes("requirement def REQ_BATT_TEMP_Def {"));
    assert.ok(sysmlCode.includes('attribute asilLevel : String = "ASIL-C";'));
    assert.ok(sysmlCode.includes("require constraint { temperature <= 55 }"));
    assert.ok(sysmlCode.includes("satisfy REQ_BATT_TEMP by REQ_BATT_VOLT;"));

    // Round-trip back from SysML v2 to ReqIfDocument
    const doc2 = sysml2ToReqIf(sysmlCode, "Re-imported from SysML");
    assert.ok(doc2.specObjects.has("REQ_BATT_TEMP"));
    const tempObj = doc2.specObjects.get("REQ_BATT_TEMP")!;
    assert.strictEqual(tempObj.contract?.variable, "temperature");
    assert.strictEqual(tempObj.contract?.limitValue, 55);
  });

  it("translates ReqIF document into a production Modelica verification block", () => {
    const doc = parseReqIf(TEST_XML);
    const moBlock = reqifToModelicaVerifier(doc, "BatteryMonitor");

    assert.ok(moBlock.includes("block BatteryMonitor"));
    assert.ok(moBlock.includes("Modelica.Blocks.Interfaces.RealInput temperature"));
    assert.ok(moBlock.includes("Modelica.Blocks.Interfaces.RealInput voltage"));
    assert.ok(moBlock.includes("Modelica.Blocks.Interfaces.BooleanOutput REQ_BATT_TEMP_pass"));
    assert.ok(moBlock.includes("Modelica.Blocks.Interfaces.BooleanOutput REQ_BATT_VOLT_pass"));
    assert.ok(moBlock.includes("REQ_BATT_TEMP_pass = temperature <= 55;"));
    assert.ok(moBlock.includes("assert(REQ_BATT_TEMP_pass,"));
    assert.ok(moBlock.includes("end BatteryMonitor;"));
  });
});
