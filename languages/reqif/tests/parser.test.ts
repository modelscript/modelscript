// SPDX-License-Identifier: AGPL-3.0-or-later

import { createZipArchive, defaultContainerToolkit, extractContainerArchive } from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import { extractFormalContract, extractReqIfzBundle, parseReqIf, reqifLanguage, serializeReqIf } from "../src/index.js";

const SAMPLE_REQIF_XML = `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <THE-HEADER>
    <REQ-IF-HEADER IDENTIFIER="HEADER-01">
      <CREATION-TIME>2026-10-25T12:00:00Z</CREATION-TIME>
      <REQ-IF-VERSION>1.0</REQ-IF-VERSION>
      <TITLE>Electric Vehicle Powertrain Requirements</TITLE>
      <COMMENT>Sample ReqIF for testing</COMMENT>
    </REQ-IF-HEADER>
  </THE-HEADER>
  <CORE-CONTENT>
    <REQ-IF-CONTENT>
      <DATATYPES>
        <DATATYPE-DEFINITION-STRING IDENTIFIER="DT-STRING" LONG-NAME="String" />
        <DATATYPE-DEFINITION-REAL IDENTIFIER="DT-REAL" LONG-NAME="Real" />
        <DATATYPE-DEFINITION-ENUMERATION IDENTIFIER="DT-ASIL" LONG-NAME="ASIL">
          <SPECIFIED-VALUES>
            <ENUM-VALUE IDENTIFIER="EV-QM" LONG-NAME="QM" KEY="0" />
            <ENUM-VALUE IDENTIFIER="EV-ASIL-D" LONG-NAME="ASIL-D" KEY="4" />
          </SPECIFIED-VALUES>
        </DATATYPE-DEFINITION-ENUMERATION>
      </DATATYPES>
      <SPEC-TYPES>
        <SPEC-OBJECT-TYPE IDENTIFIER="ST-REQ" LONG-NAME="Requirement Type">
          <SPEC-ATTRIBUTES>
            <ATTRIBUTE-DEFINITION-STRING IDENTIFIER="AD-DESC" LONG-NAME="Description" IS-MANDATORY="true">
              <TYPE>
                <DATATYPE-DEFINITION-STRING-REF>DT-STRING</DATATYPE-DEFINITION-STRING-REF>
              </TYPE>
            </ATTRIBUTE-DEFINITION-STRING>
          </SPEC-ATTRIBUTES>
        </SPEC-OBJECT-TYPE>
      </SPEC-TYPES>
      <SPEC-OBJECTS>
        <SPEC-OBJECT IDENTIFIER="REQ-MAX-SPEED" LONG-NAME="Maximum Speed Limit">
          <TYPE>
            <SPEC-OBJECT-TYPE-REF>ST-REQ</SPEC-OBJECT-TYPE-REF>
          </TYPE>
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <DEFINITION>
                <ATTRIBUTE-DEFINITION-STRING-REF>AD-DESC</ATTRIBUTE-DEFINITION-STRING-REF>
              </DEFINITION>
              <THE-VALUE>Vehicle speed must be &lt;= 160 km/h under normal operation. ASIL-D.</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
        <SPEC-OBJECT IDENTIFIER="REQ-CITY-SPEED" LONG-NAME="City Speed Limit">
          <TYPE>
            <SPEC-OBJECT-TYPE-REF>ST-REQ</SPEC-OBJECT-TYPE-REF>
          </TYPE>
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <DEFINITION>
                <ATTRIBUTE-DEFINITION-STRING-REF>AD-DESC</ATTRIBUTE-DEFINITION-STRING-REF>
              </DEFINITION>
              <THE-VALUE>In urban mode, speed must be &lt;= 60 km/h.</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
      </SPEC-OBJECTS>
      <SPEC-RELATIONS>
        <SPEC-RELATION IDENTIFIER="REL-01" LONG-NAME="refines">
          <SOURCE>
            <SPEC-OBJECT-REF>REQ-CITY-SPEED</SPEC-OBJECT-REF>
          </SOURCE>
          <TARGET>
            <SPEC-OBJECT-REF>REQ-MAX-SPEED</SPEC-OBJECT-REF>
          </TARGET>
        </SPEC-RELATION>
      </SPEC-RELATIONS>
      <SPECIFICATIONS>
        <SPECIFICATION IDENTIFIER="SPEC-01" LONG-NAME="Powertrain Specification">
          <CHILDREN>
            <SPEC-HIERARCHY IDENTIFIER="HIER-01">
              <OBJECT>
                <SPEC-OBJECT-REF>REQ-MAX-SPEED</SPEC-OBJECT-REF>
              </OBJECT>
              <CHILDREN>
                <SPEC-HIERARCHY IDENTIFIER="HIER-02">
                  <OBJECT>
                    <SPEC-OBJECT-REF>REQ-CITY-SPEED</SPEC-OBJECT-REF>
                  </OBJECT>
                </SPEC-HIERARCHY>
              </CHILDREN>
            </SPEC-HIERARCHY>
          </CHILDREN>
        </SPECIFICATION>
      </SPECIFICATIONS>
    </REQ-IF-CONTENT>
  </CORE-CONTENT>
</REQ-IF>`;

describe("@modelscript/reqif parser", () => {
  it("parses valid OMG ReqIF 1.2 XML with types, spec-objects, and hierarchies", () => {
    const doc = parseReqIf(SAMPLE_REQIF_XML);

    assert.strictEqual(doc.header.identifier, "HEADER-01");
    assert.strictEqual(doc.header.title, "Electric Vehicle Powertrain Requirements");
    assert.strictEqual(doc.dataTypes.size, 3);
    assert.strictEqual(doc.specTypes.size, 1);
    assert.strictEqual(doc.specObjects.size, 2);
    assert.strictEqual(doc.specRelations.length, 1);
    assert.strictEqual(doc.specifications.length, 1);

    const maxSpeed = doc.specObjects.get("REQ-MAX-SPEED")!;
    assert.ok(maxSpeed);
    assert.strictEqual(maxSpeed.contract?.variable, "speed");
    assert.strictEqual(maxSpeed.contract?.comparator, "<=");
    assert.strictEqual(maxSpeed.contract?.limitValue, 160);
    assert.strictEqual(maxSpeed.contract?.unit, "km/h");
    assert.strictEqual(maxSpeed.asilLevel, "ASIL-D");

    const citySpeed = doc.specObjects.get("REQ-CITY-SPEED")!;
    assert.ok(citySpeed);
    assert.strictEqual(citySpeed.contract?.variable, "speed");
    assert.strictEqual(citySpeed.contract?.comparator, "<=");
    assert.strictEqual(citySpeed.contract?.limitValue, 60);

    const rel = doc.specRelations[0]!;
    assert.strictEqual(rel.relationType, "refines");
    assert.strictEqual(rel.sourceId, "REQ-CITY-SPEED");
    assert.strictEqual(rel.targetId, "REQ-MAX-SPEED");

    const spec = doc.specifications[0]!;
    assert.strictEqual(spec.children.length, 1);
    assert.strictEqual(spec.children[0]!.objectRef, "REQ-MAX-SPEED");
    assert.strictEqual(spec.children[0]!.children[0]!.objectRef, "REQ-CITY-SPEED");
  });

  it("extracts formal contracts correctly with decimal values and units", () => {
    const c1 = extractFormalContract("Motor continuous torque >= 250.5 N*m at base speed");
    assert.ok(c1);
    assert.strictEqual(c1.variable, "torque");
    assert.strictEqual(c1.comparator, ">=");
    assert.strictEqual(c1.limitValue, 250.5);

    const c2 = extractFormalContract("Cell temperature < 65 degC");
    assert.ok(c2);
    assert.strictEqual(c2.variable, "temperature");
    assert.strictEqual(c2.comparator, "<");
    assert.strictEqual(c2.limitValue, 65);
  });

  it("roundtrips serialized ReqIF XML back into an identical parsed AST", () => {
    const doc1 = parseReqIf(SAMPLE_REQIF_XML);
    const xml = serializeReqIf(doc1);
    const doc2 = parseReqIf(xml);

    assert.strictEqual(doc2.header.title, doc1.header.title);
    assert.strictEqual(doc2.specObjects.size, doc1.specObjects.size);
    assert.strictEqual(doc2.specRelations.length, doc1.specRelations.length);
    assert.strictEqual(doc2.specifications.length, doc1.specifications.length);

    for (const [id, obj1] of doc1.specObjects) {
      const obj2 = doc2.specObjects.get(id)!;
      assert.ok(obj2);
      assert.strictEqual(obj2.contract?.limitValue, obj1.contract?.limitValue);
      assert.strictEqual(obj2.contract?.comparator, obj1.contract?.comparator);
    }
  });

  it("extracts and parses .reqifz ZIP bundles via extractReqIfzBundle and reqifLanguage.container", async () => {
    const reqifzData = createZipArchive({
      "PowertrainSpec.reqif": SAMPLE_REQIF_XML,
      "attachments/architecture-diagram.svg": "<svg></svg>",
    });

    const bundle = extractReqIfzBundle(reqifzData);
    assert.strictEqual(bundle.documents.length, 1);
    assert.deepStrictEqual(bundle.reqIfPaths, ["PowertrainSpec.reqif"]);
    assert.deepStrictEqual(bundle.attachmentPaths, ["attachments/architecture-diagram.svg"]);
    assert.strictEqual(bundle.primaryDocument.header.title, "Electric Vehicle Powertrain Requirements");
    assert.strictEqual(bundle.primaryDocument.specObjects.size, 2);

    assert.ok(reqifLanguage.container);
    const extracted = await extractContainerArchive(reqifzData, reqifLanguage.container, defaultContainerToolkit);
    assert.ok(extracted);
    assert.strictEqual(extracted?.manifest?.path, "PowertrainSpec.reqif");
    assert.strictEqual(extracted?.entries.length, 2);
    const projectedSysml = extracted?.project?.("sysml2");
    assert.strictEqual(typeof projectedSysml, "string");
    assert.ok(projectedSysml?.includes("requirement"));
  });

  it("parses structured EARS requirement templates and multi-clause conjunctions/implications", () => {
    const earsComplex = extractFormalContract(
      "While battery_soc >= 20 %, when throttle_req >= 80 %, the powertrain shall maintain motor_torque >= 240 N*m within 50 ms.",
    );
    assert.ok(earsComplex);
    assert.strictEqual(earsComplex.variable, "motor_torque");
    assert.strictEqual(earsComplex.comparator, ">=");
    assert.strictEqual(earsComplex.limitValue, 240);
    assert.strictEqual(earsComplex.unit, "N*m");
    assert.strictEqual(
      earsComplex.expression,
      "(battery_soc >= 20 && throttle_req >= 80) => (motor_torque >= 240 && response_time <= 50)",
    );

    const conditionalConj = extractFormalContract(
      "If vehicle_speed >= 100 km/h and fault_code == 0, then brake_force >= 5000 N and decel_rate >= 6.5 m/s^2",
    );
    assert.ok(conditionalConj);
    assert.strictEqual(conditionalConj.variable, "brake_force");
    assert.strictEqual(conditionalConj.comparator, ">=");
    assert.strictEqual(conditionalConj.limitValue, 5000);
    assert.strictEqual(
      conditionalConj.expression,
      "(vehicle_speed >= 100 && fault_code == 0) => (brake_force >= 5000 && decel_rate >= 6.5)",
    );
  });
});
