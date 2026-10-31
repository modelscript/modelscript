// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { checkContractEntailment, checkContractFormulaSat, parseReqIf, verifyReqIfEntailment } from "../src/index.js";

describe("@modelscript/reqif Nelson-Oppen & SMT LRA entailment verification", () => {
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
    assert.ok(res.counterexample);
    assert.ok(res.counterexample.speed! > 120 && res.counterexample.speed! <= 140);
  });

  it("proves multi-variable linear-arithmetic additive budget entailment in ReqIF hierarchies", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">
  <THE-HEADER>
    <REQ-IF-HEADER IDENTIFIER="H2"><TITLE>Multi-Variable Budget Entailment</TITLE></REQ-IF-HEADER>
  </THE-HEADER>
  <CORE-CONTENT>
    <REQ-IF-CONTENT>
      <SPEC-OBJECTS>
        <SPEC-OBJECT IDENTIFIER="REQ-SYS-POWER" LONG-NAME="System Power Budget">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <THE-VALUE>@contract: motor_power + aux_power &lt;= 150</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
        <SPEC-OBJECT IDENTIFIER="REQ-SUB-MOTOR" LONG-NAME="Motor Budget">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <THE-VALUE>@contract: motor_power &lt;= 95 &amp;&amp; motor_power &gt;= 0</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
        <SPEC-OBJECT IDENTIFIER="REQ-SUB-AUX" LONG-NAME="Auxiliary Budget">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <THE-VALUE>@contract: aux_power &lt;= 45 &amp;&amp; aux_power &gt;= 0</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
      </SPEC-OBJECTS>
      <SPECIFICATIONS>
        <SPECIFICATION IDENTIFIER="SPEC-BUDGET">
          <CHILDREN>
            <SPEC-HIERARCHY IDENTIFIER="HB-1">
              <OBJECT><SPEC-OBJECT-REF>REQ-SYS-POWER</SPEC-OBJECT-REF></OBJECT>
              <CHILDREN>
                <SPEC-HIERARCHY IDENTIFIER="HB-2">
                  <OBJECT><SPEC-OBJECT-REF>REQ-SUB-MOTOR</SPEC-OBJECT-REF></OBJECT>
                </SPEC-HIERARCHY>
                <SPEC-HIERARCHY IDENTIFIER="HB-3">
                  <OBJECT><SPEC-OBJECT-REF>REQ-SUB-AUX</SPEC-OBJECT-REF></OBJECT>
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
    assert.strictEqual(report.results[0]!.isEntailed, true);
  });

  it("verifies compound boolean implications (=>), disjunctions (||), and negations (!) with counterexamples", () => {
    // 1. Modus ponens + linear inequality tightening:
    // Premises: (speed >= 100 => brake_force >= 5000) AND (speed >= 110)
    // Conclusion: brake_force >= 4500
    const entailedRes = checkContractEntailment(
      [
        { id: "R1", formula: "speed >= 100 => brake_force >= 5000" },
        { id: "R2", formula: "speed >= 110 && !(temp > 85)" },
      ],
      { id: "R_PARENT", formula: "brake_force >= 4500 && temp <= 90" },
    );
    assert.strictEqual(entailedRes.isEntailed, true);

    // 2. Disjunction where one branch violates the parent requirement:
    // Premises: (2 * x + y <= 20) || (x >= 15 && y >= 10)
    // Conclusion: 2 * x + y <= 30
    const gapRes = checkContractEntailment([{ id: "R_CHILD", formula: "(2 * x + y <= 20) || (x >= 15 && y >= 10)" }], {
      id: "R_PARENT",
      formula: "2 * x + y <= 30",
    });
    assert.strictEqual(gapRes.isEntailed, false);
    assert.ok(gapRes.counterexample);
    const cx = gapRes.counterexample.x ?? 0;
    const cy = gapRes.counterexample.y ?? 0;
    assert.ok(2 * cx + cy > 30);

    // 3. Direct SAT check on contradictory linear system
    const unsatCheck = checkContractFormulaSat([
      { id: "C1", formula: "x + y <= 10" },
      { id: "C2", formula: "x >= 6 && y >= 6" },
    ]);
    assert.strictEqual(unsatCheck.satisfiable, false);
    assert.ok(unsatCheck.unsatCore && unsatCheck.unsatCore.length > 0);
  });

  it("verifies structured EARS requirement templates end-to-end in ReqIF entailment hierarchies", () => {
    const earsXml = `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">
  <THE-HEADER>
    <REQ-IF-HEADER IDENTIFIER="H-EARS"><TITLE>EARS Entailment Test</TITLE></REQ-IF-HEADER>
  </THE-HEADER>
  <CORE-CONTENT>
    <REQ-IF-CONTENT>
      <SPEC-OBJECTS>
        <SPEC-OBJECT IDENTIFIER="REQ-SYS-EARS" LONG-NAME="System Braking EARS">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <THE-VALUE>While speed &gt;= 80 km/h, when obstacle_dist &lt;= 40 m, the braking system shall maintain brake_force &gt;= 4500 N within 50 ms.</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
        <SPEC-OBJECT IDENTIFIER="REQ-SUB-EARS" LONG-NAME="Subsystem Braking EARS">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <THE-VALUE>While speed &gt;= 60 km/h, when obstacle_dist &lt;= 50 m, the actuator shall maintain brake_force &gt;= 5200 N within 35 ms.</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
      </SPEC-OBJECTS>
      <SPECIFICATIONS>
        <SPECIFICATION IDENTIFIER="SPEC-EARS">
          <CHILDREN>
            <SPEC-HIERARCHY IDENTIFIER="HE-1">
              <OBJECT><SPEC-OBJECT-REF>REQ-SYS-EARS</SPEC-OBJECT-REF></OBJECT>
              <CHILDREN>
                <SPEC-HIERARCHY IDENTIFIER="HE-2">
                  <OBJECT><SPEC-OBJECT-REF>REQ-SUB-EARS</SPEC-OBJECT-REF></OBJECT>
                </SPEC-HIERARCHY>
              </CHILDREN>
            </SPEC-HIERARCHY>
          </CHILDREN>
        </SPECIFICATION>
      </SPECIFICATIONS>
    </REQ-IF-CONTENT>
  </CORE-CONTENT>
</REQ-IF>`;

    const doc = parseReqIf(earsXml);
    const report = verifyReqIfEntailment(doc);
    assert.strictEqual(report.totalQueries, 1);
    assert.strictEqual(report.certifiedCount, 1);
    assert.strictEqual(report.gapCount, 0);
    assert.strictEqual(report.results[0]!.isEntailed, true);
  });
});
