// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lintReqIf, parseReqIf, ReqIfErrorCode } from "../src/index.js";

describe("@modelscript/reqif linter", () => {
  it("detects dangling requirement relations (M7001)", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">
  <THE-HEADER>
    <REQ-IF-HEADER IDENTIFIER="H1"><TITLE>Test</TITLE></REQ-IF-HEADER>
  </THE-HEADER>
  <CORE-CONTENT>
    <REQ-IF-CONTENT>
      <SPEC-OBJECTS>
        <SPEC-OBJECT IDENTIFIER="REQ-01" LONG-NAME="Valid Req" />
      </SPEC-OBJECTS>
      <SPEC-RELATIONS>
        <SPEC-RELATION IDENTIFIER="REL-BAD" LONG-NAME="refines">
          <SOURCE><SPEC-OBJECT-REF>REQ-01</SPEC-OBJECT-REF></SOURCE>
          <TARGET><SPEC-OBJECT-REF>REQ-NONEXISTENT</SPEC-OBJECT-REF></TARGET>
        </SPEC-RELATION>
      </SPEC-RELATIONS>
    </REQ-IF-CONTENT>
  </CORE-CONTENT>
</REQ-IF>`;

    const doc = parseReqIf(xml);
    const diags = lintReqIf(doc);

    const dangling = diags.find((d) => d.code === ReqIfErrorCode.DANGLING_RELATION.code);
    assert.ok(dangling);
    assert.strictEqual(dangling.severity, "error");
    assert.ok(dangling.message.includes("REQ-NONEXISTENT"));
  });

  it("detects circular requirement hierarchies (M7003)", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">
  <THE-HEADER>
    <REQ-IF-HEADER IDENTIFIER="H1"><TITLE>Test</TITLE></REQ-IF-HEADER>
  </THE-HEADER>
  <CORE-CONTENT>
    <REQ-IF-CONTENT>
      <SPEC-OBJECTS>
        <SPEC-OBJECT IDENTIFIER="REQ-A" LONG-NAME="Req A" />
        <SPEC-OBJECT IDENTIFIER="REQ-B" LONG-NAME="Req B" />
      </SPEC-OBJECTS>
      <SPECIFICATIONS>
        <SPECIFICATION IDENTIFIER="SPEC-LOOP">
          <CHILDREN>
            <SPEC-HIERARCHY IDENTIFIER="H-A">
              <OBJECT><SPEC-OBJECT-REF>REQ-A</SPEC-OBJECT-REF></OBJECT>
              <CHILDREN>
                <SPEC-HIERARCHY IDENTIFIER="H-B">
                  <OBJECT><SPEC-OBJECT-REF>REQ-B</SPEC-OBJECT-REF></OBJECT>
                  <CHILDREN>
                    <SPEC-HIERARCHY IDENTIFIER="H-A-CYCLE">
                      <OBJECT><SPEC-OBJECT-REF>REQ-A</SPEC-OBJECT-REF></OBJECT>
                    </SPEC-HIERARCHY>
                  </CHILDREN>
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
    const diags = lintReqIf(doc);

    const cycle = diags.find((d) => d.code === ReqIfErrorCode.CIRCULAR_HIERARCHY.code);
    assert.ok(cycle);
    assert.strictEqual(cycle.severity, "error");
    assert.ok(cycle.message.includes("REQ-A -> REQ-B -> REQ-A"));
  });

  it("detects unbounded safety contracts on ASIL requirements (M7005)", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">
  <THE-HEADER>
    <REQ-IF-HEADER IDENTIFIER="H1"><TITLE>Test</TITLE></REQ-IF-HEADER>
  </THE-HEADER>
  <CORE-CONTENT>
    <REQ-IF-CONTENT>
      <SPEC-OBJECTS>
        <SPEC-OBJECT IDENTIFIER="REQ-SAFE-01" LONG-NAME="Battery Safe">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <THE-VALUE>The high-voltage battery system must maintain safe shutdown without fire. ASIL-D.</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
      </SPEC-OBJECTS>
    </REQ-IF-CONTENT>
  </CORE-CONTENT>
</REQ-IF>`;

    const doc = parseReqIf(xml);
    const diags = lintReqIf(doc);

    const unbounded = diags.find((d) => d.code === ReqIfErrorCode.UNBOUNDED_FORMAL_CONTRACT.code);
    assert.ok(unbounded);
    assert.strictEqual(unbounded.severity, "warning");
    assert.ok(unbounded.quickFix);
  });

  it("detects missing mandatory attributes (M7007)", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">
  <THE-HEADER>
    <REQ-IF-HEADER IDENTIFIER="H1"><TITLE>Test</TITLE></REQ-IF-HEADER>
  </THE-HEADER>
  <CORE-CONTENT>
    <REQ-IF-CONTENT>
      <SPEC-TYPES>
        <SPEC-OBJECT-TYPE IDENTIFIER="ST-STRICT">
          <SPEC-ATTRIBUTES>
            <ATTRIBUTE-DEFINITION-STRING IDENTIFIER="AD-OWNER" LONG-NAME="Owner" IS-MANDATORY="true" />
          </SPEC-ATTRIBUTES>
        </SPEC-OBJECT-TYPE>
      </SPEC-TYPES>
      <SPEC-OBJECTS>
        <SPEC-OBJECT IDENTIFIER="REQ-NO-OWNER" LONG-NAME="Req Without Owner">
          <TYPE><SPEC-OBJECT-TYPE-REF>ST-STRICT</SPEC-OBJECT-TYPE-REF></TYPE>
        </SPEC-OBJECT>
      </SPEC-OBJECTS>
    </REQ-IF-CONTENT>
  </CORE-CONTENT>
</REQ-IF>`;

    const doc = parseReqIf(xml);
    const diags = lintReqIf(doc);

    const missingAttr = diags.find((d) => d.code === ReqIfErrorCode.MISSING_MANDATORY_ATTRIBUTE.code);
    assert.ok(missingAttr);
    assert.strictEqual(missingAttr.severity, "error");
    assert.ok(missingAttr.message.includes("Owner"));
  });

  it("detects duplicate SPEC-OBJECT identifiers (M7006)", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">
  <THE-HEADER>
    <REQ-IF-HEADER IDENTIFIER="H1"><TITLE>Test</TITLE></REQ-IF-HEADER>
  </THE-HEADER>
  <CORE-CONTENT>
    <REQ-IF-CONTENT>
      <SPEC-OBJECTS>
        <SPEC-OBJECT IDENTIFIER="REQ-DUP" LONG-NAME="First Req" />
        <SPEC-OBJECT IDENTIFIER="REQ-DUP" LONG-NAME="Second Req" />
      </SPEC-OBJECTS>
    </REQ-IF-CONTENT>
  </CORE-CONTENT>
</REQ-IF>`;

    const doc = parseReqIf(xml);
    const diags = lintReqIf(doc);

    const dup = diags.find((d) => d.code === ReqIfErrorCode.DUPLICATE_SPEC_OBJECT_ID.code);
    assert.ok(dup, "Should detect M7006 duplicate identifier");
    assert.strictEqual(dup.severity, "error");
    assert.ok(dup.message.includes("REQ-DUP"));
  });

  it("detects attribute datatype/bounds mismatch (M7002) and invalid contract comparator (M7010)", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">
  <THE-HEADER>
    <REQ-IF-HEADER IDENTIFIER="H1"><TITLE>Test</TITLE></REQ-IF-HEADER>
  </THE-HEADER>
  <CORE-CONTENT>
    <REQ-IF-CONTENT>
      <DATATYPES>
        <DATATYPE-DEFINITION-INTEGER IDENTIFIER="DT-INT-PCT" LONG-NAME="Percentage" MIN="0" MAX="100" />
      </DATATYPES>
      <SPEC-TYPES>
        <SPEC-OBJECT-TYPE IDENTIFIER="ST-REQ">
          <SPEC-ATTRIBUTES>
            <ATTRIBUTE-DEFINITION-INTEGER IDENTIFIER="AD-LOAD" LONG-NAME="MaxLoad">
              <TYPE><DATATYPE-DEFINITION-INTEGER-REF>DT-INT-PCT</DATATYPE-DEFINITION-INTEGER-REF></TYPE>
            </ATTRIBUTE-DEFINITION-INTEGER>
          </SPEC-ATTRIBUTES>
        </SPEC-OBJECT-TYPE>
      </SPEC-TYPES>
      <SPEC-OBJECTS>
        <SPEC-OBJECT IDENTIFIER="REQ-BAD-ATTR" LONG-NAME="Overload Req">
          <TYPE><SPEC-OBJECT-TYPE-REF>ST-REQ</SPEC-OBJECT-TYPE-REF></TYPE>
          <VALUES>
            <ATTRIBUTE-VALUE-INTEGER THE-VALUE="150">
              <DEFINITION><ATTRIBUTE-DEFINITION-INTEGER-REF>AD-LOAD</ATTRIBUTE-DEFINITION-INTEGER-REF></DEFINITION>
            </ATTRIBUTE-VALUE-INTEGER>
            <ATTRIBUTE-VALUE-STRING THE-VALUE="Speed must be =< 120 km/h" />
          </VALUES>
        </SPEC-OBJECT>
      </SPEC-OBJECTS>
    </REQ-IF-CONTENT>
  </CORE-CONTENT>
</REQ-IF>`;

    const doc = parseReqIf(xml);
    const diags = lintReqIf(doc);

    const m7002 = diags.find((d) => d.code === ReqIfErrorCode.TYPE_ATTRIBUTE_MISMATCH.code);
    assert.ok(m7002, "Should detect M7002 attribute value exceeding datatype MAX");
    assert.ok(m7002.message.includes("MaxLoad"));
    assert.ok(m7002.message.includes("150"));

    const m7010 = diags.find((d) => d.code === ReqIfErrorCode.INVALID_CONTRACT_COMPARATOR.code);
    assert.ok(m7010, "Should detect M7010 malformed comparator '=<'");
    assert.ok(m7010.message.includes("=<"));
  });
});
