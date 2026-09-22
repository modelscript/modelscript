// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert";
import { describe, it } from "node:test";
import { ReqIfParser } from "../src/index.js";

const SAMPLE_REQIF_XML = `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">
  <THE-HEADER>
    <REQ-IF-HEADER IDENTIFIER="header_01">
      <CREATION-TIME>2026-09-14T00:00:00Z</CREATION-TIME>
      <REQ-IF-TOOL-ID>Siemens Polarion ALM</REQ-IF-TOOL-ID>
      <TITLE>Electric Powertrain Safety Requirements</TITLE>
    </REQ-IF-HEADER>
  </THE-HEADER>
  <CORE-CONTENT>
    <REQ-IF-CONTENT>
      <SPEC-OBJECTS>
        <SPEC-OBJECT IDENTIFIER="REQ-SYS-001" LAST-CHANGE="2026-09-14T00:00:00Z">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING THE-VALUE="Vehicle Powertrain Performance">
              <DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>req_name</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>
            </ATTRIBUTE-VALUE-STRING>
            <ATTRIBUTE-VALUE-STRING THE-VALUE="The vehicle shall deliver specified torque and speed dynamics without thermal runaway.">
              <DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>req_text</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>
            </ATTRIBUTE-VALUE-STRING>
            <ATTRIBUTE-VALUE-STRING THE-VALUE="ASIL-C">
              <DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>req_asil</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
        <SPEC-OBJECT IDENTIFIER="REQ-MTR-002" LAST-CHANGE="2026-09-14T00:00:00Z">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING THE-VALUE="Peak Motor Torque">
              <DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>req_name</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>
            </ATTRIBUTE-VALUE-STRING>
            <ATTRIBUTE-VALUE-STRING THE-VALUE="Peak electric motor torque shall not exceed 350 Nm.">
              <DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>req_text</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>
            </ATTRIBUTE-VALUE-STRING>
            <ATTRIBUTE-VALUE-REAL THE-VALUE="350.0">
              <DEFINITION><ATTRIBUTE-DEFINITION-REAL-REF>req_limit</ATTRIBUTE-DEFINITION-REAL-REF></DEFINITION>
            </ATTRIBUTE-VALUE-REAL>
            <ATTRIBUTE-VALUE-STRING THE-VALUE="&lt;=">
              <DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>req_comparator</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
        <SPEC-OBJECT IDENTIFIER="REQ-SPD-003" LAST-CHANGE="2026-09-14T00:00:00Z">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING THE-VALUE="Max Rotor Speed">
              <DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>req_name</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>
            </ATTRIBUTE-VALUE-STRING>
            <ATTRIBUTE-VALUE-STRING THE-VALUE="Rotor angular velocity shall remain within 12000 RPM.">
              <DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>req_text</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>
            </ATTRIBUTE-VALUE-STRING>
            <ATTRIBUTE-VALUE-REAL THE-VALUE="12000.0">
              <DEFINITION><ATTRIBUTE-DEFINITION-REAL-REF>req_limit</ATTRIBUTE-DEFINITION-REAL-REF></DEFINITION>
            </ATTRIBUTE-VALUE-REAL>
            <ATTRIBUTE-VALUE-STRING THE-VALUE="&lt;=">
              <DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>req_comparator</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
      </SPEC-OBJECTS>
      <SPEC-RELATIONS>
        <SPEC-RELATION IDENTIFIER="REL-01">
          <SOURCE><SPEC-OBJECT-REF>ELEM_Motor_Assy</SPEC-OBJECT-REF></SOURCE>
          <TARGET><SPEC-OBJECT-REF>REQ-MTR-002</SPEC-OBJECT-REF></TARGET>
          <TYPE><SPEC-RELATION-TYPE-REF>satisfies</SPEC-RELATION-TYPE-REF></TYPE>
        </SPEC-RELATION>
        <SPEC-RELATION IDENTIFIER="REL-02">
          <SOURCE><SPEC-OBJECT-REF>TEST_Motor_Dyno</SPEC-OBJECT-REF></SOURCE>
          <TARGET><SPEC-OBJECT-REF>REQ-MTR-002</SPEC-OBJECT-REF></TARGET>
          <TYPE><SPEC-RELATION-TYPE-REF>verifies</SPEC-RELATION-TYPE-REF></TYPE>
        </SPEC-RELATION>
      </SPEC-RELATIONS>
      <SPECIFICATIONS>
        <SPECIFICATION IDENTIFIER="SPEC-MAIN">
          <CHILDREN>
            <SPEC-HIERARCHY IDENTIFIER="SH-1">
              <OBJECT><SPEC-OBJECT-REF>REQ-SYS-001</SPEC-OBJECT-REF></OBJECT>
              <CHILDREN>
                <SPEC-HIERARCHY IDENTIFIER="SH-1-1">
                  <OBJECT><SPEC-OBJECT-REF>REQ-MTR-002</SPEC-OBJECT-REF></OBJECT>
                </SPEC-HIERARCHY>
                <SPEC-HIERARCHY IDENTIFIER="SH-1-2">
                  <OBJECT><SPEC-OBJECT-REF>REQ-SPD-003</SPEC-OBJECT-REF></OBJECT>
                </SPEC-HIERARCHY>
              </CHILDREN>
            </SPEC-HIERARCHY>
          </CHILDREN>
        </SPECIFICATION>
      </SPECIFICATIONS>
    </REQ-IF-CONTENT>
  </CORE-CONTENT>
</REQ-IF>`;

describe("OMG ReqIF 1.2 Round-Trip & SysML v2 Synchronization", () => {
  it("should parse ReqIF XML with hierarchy, typed attributes, and relations", () => {
    const spec = ReqIfParser.parse(SAMPLE_REQIF_XML);
    assert.strictEqual(spec.title, "Electric Powertrain Safety Requirements");

    // Top-level requirements (REQ-SYS-001 is root, childs are REQ-MTR-002, REQ-SPD-003)
    assert.strictEqual(spec.requirements.length, 1);
    const root = spec.requirements[0];
    assert.strictEqual(root.id, "REQ-SYS-001");
    assert.strictEqual(root.asilLevel, "ASIL-C");
    assert.strictEqual(root.children?.length, 2);

    const child1 = root.children![0];
    assert.strictEqual(child1.id, "REQ-MTR-002");
    assert.strictEqual(child1.limitValue, 350.0);
    assert.strictEqual(child1.comparator, "<=");

    const child2 = root.children![1];
    assert.strictEqual(child2.id, "REQ-SPD-003");
    assert.strictEqual(child2.limitValue, 12000.0);

    // Relations
    assert.strictEqual(spec.relations?.length, 2);
    const relSat = spec.relations!.find((r) => r.type === "satisfies");
    assert.ok(relSat);
    assert.strictEqual(relSat!.sourceId, "ELEM_Motor_Assy");
    assert.strictEqual(relSat!.targetId, "REQ-MTR-002");
  });

  it("should serialize ReqIF spec back to valid ReqIF 1.2 XML", () => {
    const parsed = ReqIfParser.parse(SAMPLE_REQIF_XML);
    const reEmittedXml = ReqIfParser.emit(parsed);

    assert.ok(reEmittedXml.includes("<REQ-IF"));
    assert.ok(reEmittedXml.includes('IDENTIFIER="REQ-SYS-001"'));
    assert.ok(reEmittedXml.includes('IDENTIFIER="REQ-MTR-002"'));
    assert.ok(reEmittedXml.includes("<SPEC-HIERARCHY"));
    assert.ok(reEmittedXml.includes("<SPEC-RELATIONS"));

    // Re-parse the emitted XML to verify lossless round-trip
    const reParsed = ReqIfParser.parse(reEmittedXml);
    assert.strictEqual(reParsed.requirements.length, 1);
    assert.strictEqual(reParsed.requirements[0].id, "REQ-SYS-001");
    assert.strictEqual(reParsed.requirements[0].children?.length, 2);
    assert.strictEqual(reParsed.relations?.length, 2);
  });

  it("should transform ReqIF specification into SysML v2 requirement defs", () => {
    const spec = ReqIfParser.parse(SAMPLE_REQIF_XML);
    const sysmlCode = ReqIfParser.toSysML2(spec);

    assert.ok(sysmlCode.includes("package 'Electric Powertrain Safety Requirements'"));
    assert.ok(sysmlCode.includes("requirement def REQ_SYS_001"));
    assert.ok(sysmlCode.includes("requirement def REQ_MTR_002"));
    assert.ok(sysmlCode.includes("attribute limitValue : Real = 350;"));
    assert.ok(sysmlCode.includes('attribute comparator : String = "<=";'));
    assert.ok(sysmlCode.includes('attribute asil : String = "ASIL-C";'));
    assert.ok(sysmlCode.includes("satisfy REQ_MTR_002 by ELEM_Motor_Assy;"));
    assert.ok(sysmlCode.includes("verify REQ_MTR_002 by TEST_Motor_Dyno;"));
  });

  it("should parse SysML v2 requirements into ReqIF specification", () => {
    const sysmlCode = `
      package PowertrainReqs {
        requirement def REQ_BATTERY_01 {
          doc /* Maximum battery pack voltage shall not exceed 800V */
          attribute limitValue : Real = 800.0;
          attribute comparator : String = "<=";
          attribute asil : String = "ASIL-D";
        }
        satisfy REQ_BATTERY_01 by BatteryPack;
        verify REQ_BATTERY_01 by BatteryHILTest;
      }
    `;

    const spec = ReqIfParser.fromSysML2(sysmlCode, "Battery Safety");
    assert.strictEqual(spec.title, "Battery Safety");
    assert.strictEqual(spec.requirements.length, 1);
    assert.strictEqual(spec.requirements[0].id, "REQ_BATTERY_01");
    assert.strictEqual(spec.requirements[0].limitValue, 800.0);
    assert.strictEqual(spec.requirements[0].comparator, "<=");
    assert.strictEqual(spec.requirements[0].asilLevel, "ASIL-D");

    assert.strictEqual(spec.relations?.length, 2);
    const sat = spec.relations!.find((r) => r.type === "satisfies");
    assert.ok(sat);
    assert.strictEqual(sat!.sourceId, "BatteryPack");
    assert.strictEqual(sat!.targetId, "REQ_BATTERY_01");
  });

  it("should generate Modelica verification assertions from requirements", () => {
    const spec = ReqIfParser.parse(SAMPLE_REQIF_XML);
    const moCode = ReqIfParser.toModelicaVerifier(spec, "MotorSafetyVerifier");

    assert.ok(moCode.includes("model MotorSafetyVerifier"));
    assert.ok(moCode.includes("Modelica.Blocks.Interfaces.RealInput val_REQ_MTR_002"));
    assert.ok(moCode.includes("parameter Real limit_REQ_MTR_002 = 350"));
    assert.ok(moCode.includes("pass_REQ_MTR_002 = val_REQ_MTR_002 <= limit_REQ_MTR_002;"));
    assert.ok(moCode.includes("assert(pass_REQ_MTR_002"));
  });
});
