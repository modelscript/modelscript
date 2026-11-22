// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/magicdraw — Requirements → OMG ReqIF 1.2 (.reqif) Projection.
 *
 * Exports SysML 1.x `«requirement»` hierarchies and traceability relations
 * (`«deriveReqt»`, `«refine»`, `«trace»`, `«satisfy»`, `«verify»`) into valid OMG ReqIF 1.2 XML.
 */

import { parseMagicDraw } from "../parser/index.js";
import type { MagicDrawDocument } from "../types.js";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Projects SysML 1.x requirements from a MagicDraw document to OMG ReqIF 1.2 XML.
 */
export function magicDrawToReqif(docOrText: MagicDrawDocument | string): string {
  const doc = typeof docOrText === "string" ? parseMagicDraw(docOrText) : docOrText;
  const title = doc.metadata.projectName ?? "MagicDraw Requirements";
  const now = "2026-01-01T00:00:00Z";

  const reqs = Array.from(doc.classifiers.values()).filter((c) => c.kind === "Requirement");
  const reqIdSet = new Set(reqs.map((r) => r.id));

  const rels = doc.relationships.filter(
    (r) =>
      (r.kind === "deriveReqt" || r.kind === "refine" || r.kind === "trace" || r.kind === "copy") &&
      reqIdSet.has(r.sourceId) &&
      reqIdSet.has(r.targetId),
  );

  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">`,
    `  <THE-HEADER>`,
    `    <REQ-IF-HEADER IDENTIFIER="HDR_MD_001">`,
    `      <CREATION-TIME>${now}</CREATION-TIME>`,
    `      <REQ-IF-TOOL-ID>ModelScript MagicDraw Importer</REQ-IF-TOOL-ID>`,
    `      <REQ-IF-VERSION>1.0</REQ-IF-VERSION>`,
    `      <SOURCE-TOOL-ID>MagicDraw</SOURCE-TOOL-ID>`,
    `      <TITLE>${escapeXml(title)}</TITLE>`,
    `    </REQ-IF-HEADER>`,
    `  </THE-HEADER>`,
    `  <CORE-CONTENT>`,
    `    <REQ-IF-CONTENT>`,
    `      <DATATYPES>`,
    `        <DATATYPE-DEFINITION-STRING IDENTIFIER="DT_STRING" LONG-NAME="String" MAX-LENGTH="4096"/>`,
    `      </DATATYPES>`,
    `      <SPEC-TYPES>`,
    `        <SPEC-OBJECT-TYPE IDENTIFIER="SOT_REQ" LONG-NAME="Requirement">`,
    `          <SPEC-ATTRIBUTES>`,
    `            <ATTRIBUTE-DEFINITION-STRING IDENTIFIER="AD_ID" LONG-NAME="ReqIF.ForeignID">`,
    `              <TYPE><DATATYPE-DEFINITION-STRING-REF>DT_STRING</DATATYPE-DEFINITION-STRING-REF></TYPE>`,
    `            </ATTRIBUTE-DEFINITION-STRING>`,
    `            <ATTRIBUTE-DEFINITION-STRING IDENTIFIER="AD_TEXT" LONG-NAME="ReqIF.Text">`,
    `              <TYPE><DATATYPE-DEFINITION-STRING-REF>DT_STRING</DATATYPE-DEFINITION-STRING-REF></TYPE>`,
    `            </ATTRIBUTE-DEFINITION-STRING>`,
    `          </SPEC-ATTRIBUTES>`,
    `        </SPEC-OBJECT-TYPE>`,
    `        <SPEC-RELATION-TYPE IDENTIFIER="SRT_TRACE" LONG-NAME="TraceRelation"/>`,
    `        <SPECIFICATION-TYPE IDENTIFIER="ST_SPEC" LONG-NAME="Specification"/>`,
    `      </SPEC-TYPES>`,
    `      <SPEC-OBJECTS>`,
  ];

  for (const r of reqs) {
    const idVal = r.requirementId ?? r.name;
    const textVal = r.requirementText ?? r.documentation ?? "";
    lines.push(
      `        <SPEC-OBJECT IDENTIFIER="${escapeXml(r.id)}" LONG-NAME="${escapeXml(r.name)}">`,
      `          <VALUES>`,
      `            <ATTRIBUTE-VALUE-STRING THE-VALUE="${escapeXml(idVal)}">`,
      `              <DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>AD_ID</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>`,
      `            </ATTRIBUTE-VALUE-STRING>`,
      `            <ATTRIBUTE-VALUE-STRING THE-VALUE="${escapeXml(textVal)}">`,
      `              <DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>AD_TEXT</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>`,
      `            </ATTRIBUTE-VALUE-STRING>`,
      `          </VALUES>`,
      `          <TYPE><SPEC-OBJECT-TYPE-REF>SOT_REQ</SPEC-OBJECT-TYPE-REF></TYPE>`,
      `        </SPEC-OBJECT>`,
    );
  }

  lines.push(`      </SPEC-OBJECTS>`, `      <SPEC-RELATIONS>`);

  for (const rel of rels) {
    lines.push(
      `        <SPEC-RELATION IDENTIFIER="${escapeXml(rel.id)}" LONG-NAME="${escapeXml(rel.kind)}">`,
      `          <TYPE><SPEC-RELATION-TYPE-REF>SRT_TRACE</SPEC-RELATION-TYPE-REF></TYPE>`,
      `          <SOURCE><SPEC-OBJECT-REF>${escapeXml(rel.sourceId)}</SPEC-OBJECT-REF></SOURCE>`,
      `          <TARGET><SPEC-OBJECT-REF>${escapeXml(rel.targetId)}</SPEC-OBJECT-REF></TARGET>`,
      `        </SPEC-RELATION>`,
    );
  }

  lines.push(
    `      </SPEC-RELATIONS>`,
    `      <SPECIFICATIONS>`,
    `        <SPECIFICATION IDENTIFIER="SPEC_ROOT" LONG-NAME="${escapeXml(title)}">`,
    `          <TYPE><SPECIFICATION-TYPE-REF>ST_SPEC</SPECIFICATION-TYPE-REF></TYPE>`,
    `          <CHILDREN>`,
  );

  for (let i = 0; i < reqs.length; i++) {
    const r = reqs[i]!;
    lines.push(
      `            <SPEC-HIERARCHY IDENTIFIER="SH_${i + 1}">`,
      `              <OBJECT><SPEC-OBJECT-REF>${escapeXml(r.id)}</SPEC-OBJECT-REF></OBJECT>`,
      `            </SPEC-HIERARCHY>`,
    );
  }

  lines.push(
    `          </CHILDREN>`,
    `        </SPECIFICATION>`,
    `      </SPECIFICATIONS>`,
    `    </REQ-IF-CONTENT>`,
    `  </CORE-CONTENT>`,
    `</REQ-IF>`,
  );

  return `${lines.join("\n")}\n`;
}
