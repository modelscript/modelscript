// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getReqifDocumentSymbols, getReqifHover, validateReqif } from "../src/index.js";

const VALID_REQIF = `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">
  <THE-HEADER>
    <REQ-IF-HEADER IDENTIFIER="H-01">
      <REQ-IF-VERSION>1.0</REQ-IF-VERSION>
      <TITLE>Braking System Requirements</TITLE>
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
        <SPEC-OBJECT IDENTIFIER="REQ-STOP-DIST" LONG-NAME="Stopping Distance Limit">
          <TYPE>
            <SPEC-OBJECT-TYPE-REF>ST-REQ</SPEC-OBJECT-TYPE-REF>
          </TYPE>
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <DEFINITION>
                <ATTRIBUTE-DEFINITION-STRING-REF>AD-DESC</ATTRIBUTE-DEFINITION-STRING-REF>
              </DEFINITION>
              <THE-VALUE>Emergency stopping distance must be &lt;= 35.0 m from 100 km/h. ASIL-D.</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
        <SPEC-OBJECT IDENTIFIER="REQ-BRAKE-PAD" LONG-NAME="Brake Pad Friction">
          <TYPE>
            <SPEC-OBJECT-TYPE-REF>ST-REQ</SPEC-OBJECT-TYPE-REF>
          </TYPE>
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <DEFINITION>
                <ATTRIBUTE-DEFINITION-STRING-REF>AD-DESC</ATTRIBUTE-DEFINITION-STRING-REF>
              </DEFINITION>
              <THE-VALUE>Brake pad coefficient must be &gt;= 0.4.</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
      </SPEC-OBJECTS>
      <SPEC-RELATIONS>
        <SPEC-RELATION IDENTIFIER="REL-01" LONG-NAME="satisfies">
          <SOURCE><SPEC-OBJECT-REF>REQ-BRAKE-PAD</SPEC-OBJECT-REF></SOURCE>
          <TARGET><SPEC-OBJECT-REF>REQ-STOP-DIST</SPEC-OBJECT-REF></TARGET>
        </SPEC-RELATION>
      </SPEC-RELATIONS>
      <SPECIFICATIONS>
        <SPECIFICATION IDENTIFIER="SPEC-BRAKE" LONG-NAME="Braking Spec">
          <CHILDREN>
            <SPEC-HIERARCHY IDENTIFIER="SH-01" OBJECT-REF="REQ-STOP-DIST">
              <CHILDREN>
                <SPEC-HIERARCHY IDENTIFIER="SH-02" OBJECT-REF="REQ-BRAKE-PAD" />
              </CHILDREN>
            </SPEC-HIERARCHY>
          </CHILDREN>
        </SPECIFICATION>
      </SPECIFICATIONS>
    </REQ-IF-CONTENT>
  </CORE-CONTENT>
</REQ-IF>`;

describe("ReqIF LSP Services (Diagnostics, DocumentSymbols, Hover)", () => {
  it("should validate clean ReqIF document with 0 error diagnostics", () => {
    const diags = validateReqif(VALID_REQIF);
    const errors = diags.filter((d) => d.severity === 1);
    assert.equal(errors.length, 0);
  });

  it("should emit diagnostic for malformed XML", () => {
    const malformed = "<REQ-IF><UNCLOSED";
    const diags = validateReqif(malformed);
    assert.ok(diags.length > 0);
    assert.equal(diags[0]?.severity, 1);
    assert.equal(diags[0]?.code, "REQIF-PARSE-ERROR");
  });

  it("should extract document symbol hierarchy", () => {
    const symbols = getReqifDocumentSymbols(VALID_REQIF);
    assert.equal(symbols.length, 1);

    const specSymbol = symbols[0]!;
    assert.equal(specSymbol.name, "Braking Spec");
    assert.ok(specSymbol.children && specSymbol.children.length === 1);

    const reqSymbol = specSymbol.children![0]!;
    assert.ok(reqSymbol.name.includes("REQ-STOP-DIST"));
    assert.ok(reqSymbol.detail?.includes("ASIL-D"));
    assert.ok(reqSymbol.detail?.includes("distance <= 35 m"));
    assert.ok(reqSymbol.children && reqSymbol.children.length === 1);
    assert.ok(reqSymbol.children![0]!.name.includes("REQ-BRAKE-PAD"));
  });

  it("should generate rich markdown hover under cursor", () => {
    // Find line where REQ-STOP-DIST is defined
    const lines = VALID_REQIF.split("\n");
    const targetLine = lines.findIndex((l) => l.includes('IDENTIFIER="REQ-STOP-DIST"'));
    assert.ok(targetLine >= 0);

    const hover = getReqifHover(VALID_REQIF, targetLine, 25);
    assert.ok(hover);
    assert.ok(hover.contents.value.includes("REQ-STOP-DIST"));
    assert.ok(hover.contents.value.includes("Stopping Distance Limit"));
    assert.ok(hover.contents.value.includes("ASIL-D"));
    assert.ok(hover.contents.value.includes("distance <= 35 m"));
  });
});
