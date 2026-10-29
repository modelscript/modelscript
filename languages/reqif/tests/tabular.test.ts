// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyReqIfTabularMutation,
  buildReqIfDiagram,
  completeReqIfTabularCell,
  executeReqIfTabular,
  parseReqIf,
  renderReqIfDiagramSvg,
  reqifLanguage,
  validateReqIfTabularCell,
} from "../src/index.js";

const SAMPLE_REQIF = `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">
  <THE-HEADER>
    <REQ-IF-HEADER IDENTIFIER="HDR-01">
      <REQ-IF-VERSION>1.2</REQ-IF-VERSION>
      <TITLE>Flight Control Safety Specification</TITLE>
    </REQ-IF-HEADER>
  </THE-HEADER>
  <CORE-CONTENT>
    <REQ-IF-CONTENT>
      <DATATYPES>
        <DATATYPE-DEFINITION-STRING IDENTIFIER="DT-STR" LONG-NAME="Text"/>
        <DATATYPE-DEFINITION-ENUMERATION IDENTIFIER="DT-METHOD" LONG-NAME="Verification Method">
          <SPECIFIED-VALUES>
            <ENUM-VALUE IDENTIFIER="EV-HIL" LONG-NAME="HIL Test"/>
            <ENUM-VALUE IDENTIFIER="EV-PROOF" LONG-NAME="Formal Proof"/>
          </SPECIFIED-VALUES>
        </DATATYPE-DEFINITION-ENUMERATION>
      </DATATYPES>
      <SPEC-TYPES>
        <SPEC-OBJECT-TYPE IDENTIFIER="SOT-REQ" LONG-NAME="Safety Requirement">
          <SPEC-ATTRIBUTES>
            <ATTRIBUTE-DEFINITION-STRING IDENTIFIER="AD-TEXT" LONG-NAME="ReqIF.Text"/>
            <ATTRIBUTE-DEFINITION-ENUMERATION IDENTIFIER="AD-VERIF" LONG-NAME="VerificationMethod">
              <TYPE><DATATYPE-DEFINITION-ENUMERATION-REF>DT-METHOD</DATATYPE-DEFINITION-ENUMERATION-REF></TYPE>
            </ATTRIBUTE-DEFINITION-ENUMERATION>
          </SPEC-ATTRIBUTES>
        </SPEC-OBJECT-TYPE>
      </SPEC-TYPES>
      <SPEC-OBJECTS>
        <SPEC-OBJECT IDENTIFIER="REQ-FCS-014" LONG-NAME="Pitch Step Overshoot">
          <TYPE><SPEC-OBJECT-TYPE-REF>SOT-REQ</SPEC-OBJECT-TYPE-REF></TYPE>
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>AD-TEXT</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>
              <THE-VALUE>The pitch controller shall maintain overshoot &lt;= 2.5 % (ASIL-D).</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
            <ATTRIBUTE-VALUE-ENUMERATION>
              <DEFINITION><ATTRIBUTE-DEFINITION-ENUMERATION-REF>AD-VERIF</ATTRIBUTE-DEFINITION-ENUMERATION-REF></DEFINITION>
              <VALUES><ENUM-VALUE-REF>Formal Proof</ENUM-VALUE-REF></VALUES>
            </ATTRIBUTE-VALUE-ENUMERATION>
          </VALUES>
        </SPEC-OBJECT>
        <SPEC-OBJECT IDENTIFIER="REQ-FCS-028" LONG-NAME="Inner Loop Overshoot">
          <TYPE><SPEC-OBJECT-TYPE-REF>SOT-REQ</SPEC-OBJECT-TYPE-REF></TYPE>
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>AD-TEXT</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>
              <THE-VALUE>The inner loop damper shall maintain overshoot &lt;= 1.8 % (ASIL-D).</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
            <ATTRIBUTE-VALUE-ENUMERATION>
              <DEFINITION><ATTRIBUTE-DEFINITION-ENUMERATION-REF>AD-VERIF</ATTRIBUTE-DEFINITION-ENUMERATION-REF></DEFINITION>
              <VALUES><ENUM-VALUE-REF>HIL Test</ENUM-VALUE-REF></VALUES>
            </ATTRIBUTE-VALUE-ENUMERATION>
          </VALUES>
        </SPEC-OBJECT>
      </SPEC-OBJECTS>
      <SPEC-RELATIONS>
        <SPEC-RELATION IDENTIFIER="REL-01" SOURCE="REQ-FCS-028" TARGET="REQ-FCS-014" LONG-NAME="refines"/>
      </SPEC-RELATIONS>
      <SPECIFICATIONS>
        <SPECIFICATION IDENTIFIER="SPEC-01" LONG-NAME="Flight Control Spec">
          <CHILDREN>
            <SPEC-HIERARCHY IDENTIFIER="SH-1">
              <OBJECT><SPEC-OBJECT-REF>REQ-FCS-014</SPEC-OBJECT-REF></OBJECT>
              <CHILDREN>
                <SPEC-HIERARCHY IDENTIFIER="SH-1-1">
                  <OBJECT><SPEC-OBJECT-REF>REQ-FCS-028</SPEC-OBJECT-REF></OBJECT>
                </SPEC-HIERARCHY>
              </CHILDREN>
            </SPEC-HIERARCHY>
          </CHILDREN>
        </SPECIFICATION>
      </SPECIFICATIONS>
    </REQ-IF-CONTENT>
  </CORE-CONTENT>
</REQ-IF>`;

describe("ReqIF Bidirectional Tabular & Diagram Engine (@modelscript/reqif)", () => {
  it("exposes declarative diagram and tabular configs on reqifLanguage", () => {
    assert.ok(reqifLanguage.tabular);
    assert.ok(reqifLanguage.diagram);
    assert.equal(reqifLanguage.tabular.defaultSheet, "requirements");
    assert.ok(reqifLanguage.tabular.sheets.requirements);
    assert.ok(reqifLanguage.tabular.sheets.matrix);
    assert.ok(reqifLanguage.tabular.sheets.traceability);
    assert.ok(reqifLanguage.tabular.sheets.types);
  });

  it("extracts hierarchical requirements, dynamic SPEC-TYPE columns, contracts, and KPIs", () => {
    const payload = executeReqIfTabular(SAMPLE_REQIF, "requirements");
    assert.equal(payload.rows.length, 2);

    const parentRow = payload.rows[0]!;
    const childRow = payload.rows[1]!;

    assert.equal(parentRow.id, "REQ-FCS-014");
    assert.equal(parentRow.sectionNumber, "1");
    assert.equal(parentRow.depth, 0);
    assert.equal(parentRow.cells.contract, "overshoot <= 2.5 %");
    assert.equal(parentRow.cells.asilLevel, "ASIL-D");
    assert.equal(parentRow.cells.entailment, "Certified");
    assert.equal(parentRow.cells["attr:AD-VERIF"], "Formal Proof");

    assert.equal(childRow.id, "REQ-FCS-028");
    assert.equal(childRow.sectionNumber, "1.1");
    assert.equal(childRow.depth, 1);
    assert.equal(childRow.parentId, "REQ-FCS-014");

    // Verify dynamic column discovery from SPEC-OBJECT-TYPE
    assert.ok(payload.columns.some((c) => c.id === "attr:AD-VERIF" && c.isDynamic));

    // Verify KPIs
    assert.equal(payload.kpis.length, 4);
    assert.equal(payload.kpis[0]!.value, 2);
    assert.equal(payload.kpis[1]!.value, "2 / 2");
    assert.equal(payload.kpis[2]!.value, "100%");
    assert.equal(payload.kpis[3]!.value, "Certified");
  });

  it("performs lossless bidirectional writeback on requirement cells, contracts, and dynamic attributes", () => {
    // 1. Update formal contract on child requirement so it violates parent bound (3.2 % > 2.5 %)
    const contractEdit = applyReqIfTabularMutation(SAMPLE_REQIF, {
      kind: "updateCell",
      sheetId: "requirements",
      rowId: "REQ-FCS-028",
      columnId: "contract",
      value: "overshoot <= 3.2 %",
    });
    assert.equal(contractEdit.success, true);

    const afterContractPayload = executeReqIfTabular(contractEdit.newText, "requirements");
    const updatedChild = afterContractPayload.rows.find((r) => r.id === "REQ-FCS-028")!;
    const updatedParent = afterContractPayload.rows.find((r) => r.id === "REQ-FCS-014")!;
    assert.equal(updatedChild.cells.contract, "overshoot <= 3.2 %");
    // Parent entailment should now report a Gap because 3.2 % does not entail <= 2.5 %!
    assert.equal(updatedParent.cells.entailment, "Gap");

    // 2. Insert a new requirement row
    const insertRes = applyReqIfTabularMutation(contractEdit.newText, {
      kind: "insertRow",
      sheetId: "requirements",
      parentId: "REQ-FCS-014",
      initialCells: {
        identifier: "REQ-FCS-099",
        longName: "Yaw Damper Authority",
        text: "The yaw damper shall maintain settling_time <= 1.2 s (ASIL-C).",
      },
    });
    assert.equal(insertRes.success, true);
    const afterInsertDoc = parseReqIf(insertRes.newText);
    assert.ok(afterInsertDoc.specObjects.has("REQ-FCS-099"));

    // 3. Delete the newly inserted requirement
    const deleteRes = applyReqIfTabularMutation(insertRes.newText, {
      kind: "deleteRow",
      sheetId: "requirements",
      rowId: "REQ-FCS-099",
    });
    assert.equal(deleteRes.success, true);
    assert.ok(!parseReqIf(deleteRes.newText).specObjects.has("REQ-FCS-099"));
  });

  it("projects and mutates the 2D Traceability Matrix (RTM) and Spec Relations sheet", () => {
    const matrixPayload = executeReqIfTabular(SAMPLE_REQIF, "matrix");
    assert.ok(matrixPayload.matrix);
    assert.equal(matrixPayload.matrix.coveragePercent, 100);
    assert.equal(matrixPayload.matrix.cells["REQ-FCS-028::REQ-FCS-014"]?.kind, "refines");

    // Toggle a new matrix link from REQ-FCS-014 to REQ-FCS-028
    const toggled = applyReqIfTabularMutation(SAMPLE_REQIF, {
      kind: "toggleMatrixCell",
      sheetId: "matrix",
      rowId: "REQ-FCS-014",
      colId: "REQ-FCS-028",
      newKind: "verifies",
    });
    assert.equal(toggled.success, true);

    const updatedTrace = executeReqIfTabular(toggled.newText, "traceability");
    assert.equal(updatedTrace.rows.length, 2);
    assert.ok(updatedTrace.rows.some((r) => r.cells.relationType === "verifies"));
  });

  it("validates formal contract expressions and provides context-aware cell completions", () => {
    const badContract = validateReqIfTabularCell(
      SAMPLE_REQIF,
      "requirements",
      "REQ-FCS-014",
      "contract",
      "not a valid inequality",
    );
    assert.equal(badContract.valid, false);

    const goodContract = validateReqIfTabularCell(
      SAMPLE_REQIF,
      "requirements",
      "REQ-FCS-014",
      "contract",
      "latency <= 5.0 ms",
    );
    assert.equal(goodContract.valid, true);

    const refCompletions = completeReqIfTabularCell(SAMPLE_REQIF, "traceability", "REL-01", "sourceId", "REQ-FCS");
    assert.equal(refCompletions.length, 2);
  });

  it("builds a 2D Requirements Architecture Diagram and renders theme-aware SVG", () => {
    const model = buildReqIfDiagram(SAMPLE_REQIF);
    assert.equal(model.nodes.length, 2);
    assert.ok(model.edges.length >= 1);

    const svg = renderReqIfDiagramSvg(model, { isDark: true });
    assert.ok(svg.startsWith("<svg"));
    assert.ok(svg.includes("REQ-FCS-014"));
    assert.ok(svg.includes("REQ-FCS-028"));
    assert.ok(svg.includes("overshoot &lt;= 2.5 %"));
  });
});
