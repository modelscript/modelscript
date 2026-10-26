// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseReqIf, verifyReqIfEntailment } from "../src/index.js";

describe("@modelscript/reqif Nelson-Oppen entailment verification", () => {
  it("proves complete mathematical entailment when sub-requirements tighten parent bounds", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">
  <THE-HEADER>
    <REQ-IF-HEADER IDENTIFIER="H1"><TITLE>Entailment Pass Test</TITLE></REQ-IF-HEADER>
  </THE-HEADER>
  <CORE-CONTENT>
    <REQ-IF-CONTENT>
      <SPEC-OBJECTS>
        <SPEC-OBJECT IDENTIFIER="REQ-MAX-POWER" LONG-NAME="Total Power">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <THE-VALUE>Total electrical power consumption must be &lt;= 150 kW.</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
        <SPEC-OBJECT IDENTIFIER="REQ-MOTOR-POWER" LONG-NAME="Motor Power">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <THE-VALUE>Traction motor power consumption must be &lt;= 120 kW.</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
      </SPEC-OBJECTS>
      <SPECIFICATIONS>
        <SPECIFICATION IDENTIFIER="SPEC-01">
          <CHILDREN>
            <SPEC-HIERARCHY IDENTIFIER="H1">
              <OBJECT><SPEC-OBJECT-REF>REQ-MAX-POWER</SPEC-OBJECT-REF></OBJECT>
              <CHILDREN>
                <SPEC-HIERARCHY IDENTIFIER="H2">
                  <OBJECT><SPEC-OBJECT-REF>REQ-MOTOR-POWER</SPEC-OBJECT-REF></OBJECT>
                </SPEC-HIERARCHY>
              </CHILDREN>
            </SPEC-HIERARCHY>
          </CHILDREN>
        </SPECIFICATION>
      </SPECIFICATIONS>
    </REQ-IF-CONTENT>
  </CORE-CONTENT>
</REQ-IF>`;

    const doc = parseReqIf(xml);
    const report = verifyReqIfEntailment(doc);

    assert.strictEqual(report.totalQueries, 1);
    assert.strictEqual(report.certifiedCount, 1);
    assert.strictEqual(report.gapCount, 0);

    const res = report.results[0]!;
    assert.strictEqual(res.isEntailed, true);
    assert.strictEqual(res.parentReqId, "REQ-MAX-POWER");
    assert.deepStrictEqual(res.childReqIds, ["REQ-MOTOR-POWER"]);
    assert.ok(res.proofManifestId);
  });

  it("detects an entailment gap and generates counterexample when sub-requirement exceeds parent bound", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">
  <THE-HEADER>
    <REQ-IF-HEADER IDENTIFIER="H1"><TITLE>Entailment Fail Test</TITLE></REQ-IF-HEADER>
  </THE-HEADER>
  <CORE-CONTENT>
    <REQ-IF-CONTENT>
      <SPEC-OBJECTS>
        <SPEC-OBJECT IDENTIFIER="REQ-PARENT-SPEED" LONG-NAME="Parent Speed">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <THE-VALUE>Vehicle speed must be &lt;= 120 km/h.</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
        <SPEC-OBJECT IDENTIFIER="REQ-CHILD-SPEED" LONG-NAME="Child Speed">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <THE-VALUE>Subsystem speed may reach &lt;= 140 km/h.</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
      </SPEC-OBJECTS>
      <SPEC-RELATIONS>
        <SPEC-RELATION IDENTIFIER="REL-01" LONG-NAME="refines">
          <SOURCE><SPEC-OBJECT-REF>REQ-CHILD-SPEED</SPEC-OBJECT-REF></SOURCE>
          <TARGET><SPEC-OBJECT-REF>REQ-PARENT-SPEED</SPEC-OBJECT-REF></TARGET>
        </SPEC-RELATION>
      </SPEC-RELATIONS>
    </REQ-IF-CONTENT>
  </CORE-CONTENT>
</REQ-IF>`;

    const doc = parseReqIf(xml);
    const report = verifyReqIfEntailment(doc);

    assert.strictEqual(report.totalQueries, 1);
    assert.strictEqual(report.certifiedCount, 0);
    assert.strictEqual(report.gapCount, 1);

    const res = report.results[0]!;
    assert.strictEqual(res.isEntailed, false);
    assert.strictEqual(res.parentReqId, "REQ-PARENT-SPEED");
    assert.ok(res.diagnosticMessage);
    assert.ok(res.diagnosticMessage.includes("Gap"));
  });
});
