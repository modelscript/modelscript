// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileTGGRules } from "@modelscript/dsl";
import assert from "node:assert";
import { describe, it } from "node:test";
import {
  parseReqIf,
  projectReqIfViaTgg,
  reqifPolyglotConfig,
  reqifTggRules,
  reqifToModelicaVerifier,
  reqifToSysml2,
  synchronizeSysml2ToReqIf,
  sysml2ToReqIf,
} from "../src/index.js";

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

  it("projects standalone REQ-BRAKE-01 SPEC-OBJECT snippet to SysML v2 requirement def", () => {
    const snippet = `<SPEC-OBJECT IDENTIFIER="REQ-BRAKE-01" LONG-NAME="Braking Distance">
  <VALUES>
    <ATTRIBUTE-VALUE-STRING
      THE-VALUE="Vehicle stopping distance from 100 km/h shall be &lt;= 35 m." />
    <ATTRIBUTE-VALUE-ENUMERATION>
      <VALUES><ENUM-VALUE-REF>ASIL-D</ENUM-VALUE-REF></VALUES>
    </ATTRIBUTE-VALUE-ENUMERATION>
  </VALUES>
</SPEC-OBJECT>`;
    const doc = parseReqIf(snippet);
    const sysmlCode = reqifToSysml2(doc);

    assert.ok(sysmlCode.includes("requirement def REQ_BRAKE_01_Def {"));
    assert.ok(sysmlCode.includes('doc /* Vehicle stopping distance from 100 km/h shall be <= 35 m. */'));
    assert.ok(sysmlCode.includes('attribute reqId : String = "REQ-BRAKE-01";'));
    assert.ok(sysmlCode.includes('attribute asilLevel : String = "ASIL-D";'));
    assert.ok(sysmlCode.includes("require constraint { distance <= 35 }"));
    assert.ok(sysmlCode.includes("requirement REQ_BRAKE_01 : REQ_BRAKE_01_Def;"));
  });

  it("compiles declarative ReqIF TGG rules and synchronizes SysML v2 edits back into ReqIF XML", () => {
    assert.strictEqual(reqifTggRules.length, 4);
    const compiled = compileTGGRules(reqifPolyglotConfig);
    assert.strictEqual(compiled.ruleCount, 4);
    assert.ok(compiled.sourceCode.includes("tgg_forward_ReqIfSpecObjectToSysmlRequirementDef"));
    assert.ok(compiled.sourceCode.includes("tgg_backward_ReqIfSpecObjectToSysmlRequirementDef"));

    const origXml = `<!-- ReqIF Header Comment -->
<SPEC-OBJECT IDENTIFIER="REQ-BRAKE-01" LONG-NAME="Braking Distance" LAST-CHANGE="2026-11-07T00:00:00Z">
  <VALUES>
    <ATTRIBUTE-VALUE-STRING>
      <THE-VALUE>Vehicle braking_distance must be &lt;= 35 m. ASIL-D.</THE-VALUE>
    </ATTRIBUTE-VALUE-STRING>
  </VALUES>
</SPEC-OBJECT>`;

    const { sysmlText } = projectReqIfViaTgg(origXml);
    assert.ok(sysmlText.includes("require constraint { braking_distance <= 35 }"));

    const modifiedSysml =
      `/* Fake block comment: requirement def IGNORED { require constraint { d <= 999 } } */\n` +
      sysmlText.replace("<= 35", "<= 30").replace('"ASIL-D"', '"ASIL-C"');
    const syncRes = synchronizeSysml2ToReqIf(origXml, modifiedSysml);
    assert.ok(syncRes.updatedText.includes("<!-- ReqIF Header Comment -->"));
    assert.ok(syncRes.updatedText.includes('LAST-CHANGE="2026-11-07T00:00:00Z"'));
    assert.ok(syncRes.updatedText.includes("braking_distance must be &lt;= 30 m. ASIL-C."));
    assert.ok(syncRes.updatedText.includes('LONG-NAME="Braking Distance"'));
    assert.ok(syncRes.changes.length >= 2);
  });

  it("keeps legacy ALM prose as doc comments only in strict mode without heuristic constraint extraction", () => {
    const origXml = `<SPEC-OBJECT IDENTIFIER="REQ-BRAKE-01" LONG-NAME="Braking Distance">
  <VALUES>
    <ATTRIBUTE-VALUE-STRING>
      <THE-VALUE>Vehicle braking_distance must be &lt;= 35 m. ASIL-D.</THE-VALUE>
    </ATTRIBUTE-VALUE-STRING>
  </VALUES>
</SPEC-OBJECT>`;

    // 1. Strict mode via projectReqIfViaTgg
    const strictRes = projectReqIfViaTgg(origXml, { contractPolicy: "strict" });
    assert.ok(strictRes.sysmlText.includes("doc /* Vehicle braking_distance must be <= 35 m. ASIL-D. */"));
    assert.ok(strictRes.sysmlText.includes('attribute asilLevel : String = "ASIL-D";'));
    assert.strictEqual(strictRes.sysmlText.includes("require constraint"), false);
    assert.strictEqual(strictRes.sysmlText.includes("attribute braking_distance : Scalar;"), false);

    // 2. Strict mode via parseReqIf and reqifToSysml2
    const doc = parseReqIf(origXml, { contractPolicy: "strict" });
    assert.strictEqual(doc.specObjects.get("REQ-BRAKE-01")?.contract, undefined);
    const sysmlText = reqifToSysml2(doc, { contractPolicy: "strict" });
    assert.ok(sysmlText.includes("doc /* Vehicle braking_distance must be <= 35 m. ASIL-D. */"));
    assert.strictEqual(sysmlText.includes("require constraint"), false);

    // 3. Explicit @contract is preserved even in strict mode
    const explicitXml = `<SPEC-OBJECT IDENTIFIER="REQ-EXPLICIT-01">
  <VALUES>
    <ATTRIBUTE-VALUE-STRING>
      <THE-VALUE>Stopping distance spec @contract: braking_distance &lt;= 35</THE-VALUE>
    </ATTRIBUTE-VALUE-STRING>
  </VALUES>
</SPEC-OBJECT>`;
    const explicitDoc = parseReqIf(explicitXml, { contractPolicy: "strict" });
    assert.ok(explicitDoc.specObjects.get("REQ-EXPLICIT-01")?.contract);
    assert.strictEqual(explicitDoc.specObjects.get("REQ-EXPLICIT-01")?.contract?.tier, "explicit");
    const explicitSysml = reqifToSysml2(explicitDoc, { contractPolicy: "strict" });
    assert.ok(explicitSysml.includes("require constraint { braking_distance <= 35 }"));

    // 4. EARS mode extracts EARS templates but rejects unstructured prose
    const earsXml = `<SPEC-OBJECT IDENTIFIER="REQ-EARS-01">
  <VALUES>
    <ATTRIBUTE-VALUE-STRING>
      <THE-VALUE>While emergency_mode == 1, the braking system shall maintain brake_pressure &gt;= 120 bar within 50 ms</THE-VALUE>
    </ATTRIBUTE-VALUE-STRING>
  </VALUES>
</SPEC-OBJECT>`;
    const earsDoc = parseReqIf(earsXml, { contractPolicy: "ears" });
    assert.ok(earsDoc.specObjects.get("REQ-EARS-01")?.contract);
    assert.strictEqual(earsDoc.specObjects.get("REQ-EARS-01")?.contract?.tier, "ears");

    const proseDocInEars = parseReqIf(origXml, { contractPolicy: "ears" });
    assert.strictEqual(proseDocInEars.specObjects.get("REQ-BRAKE-01")?.contract, undefined);
  });
});

