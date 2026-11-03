// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/oscal — Cross-Language Projections (SysML v2 & OMG ReqIF).
 *
 * Projects OSCAL catalogs, profiles, and System Security Plans (SSPs) into:
 * 1. SysML v2 (`requirement def`, `part def`, and `satisfy` traceability links)
 * 2. OMG ReqIF 1.2 XML (`<SPEC-OBJECT>` requirements interchange format)
 */

import { getBuiltInControl } from "../catalogs/index.js";
import { substituteControlProse } from "../resolver/index.js";
import type { OscalControl, OscalDocument, OscalGroup } from "../types.js";

function sanitizeIdentifier(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1");
  return cleaned || "OscalElement";
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function collectEffectiveControls(doc: OscalDocument): {
  controlId: string;
  title: string;
  prose: string;
}[] {
  const result: { controlId: string; title: string; prose: string }[] = [];
  const seen = new Set<string>();

  const paramOverrides: Record<string, string> = {};
  for (const sp of doc.modify?.setParameters ?? []) {
    if (sp.values.length > 0) paramOverrides[sp.paramId] = sp.values.join(", ");
  }
  for (const sp of doc.controlImplementation?.setParameters ?? []) {
    if (sp.values.length > 0) paramOverrides[sp.paramId] = sp.values.join(", ");
  }

  const addControl = (ctrl: OscalControl, descriptionOverride?: string) => {
    const key = ctrl.id.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const sub = substituteControlProse(ctrl, paramOverrides);
    result.push({
      controlId: ctrl.id,
      title: ctrl.title,
      prose: descriptionOverride ? `${sub.prose} (${descriptionOverride})`.trim() : sub.prose || ctrl.title,
    });
    if (ctrl.controls) {
      for (const child of ctrl.controls) {
        addControl(child);
      }
    }
  };

  if (doc.controls) {
    for (const c of doc.controls) addControl(c);
  }
  if (doc.groups) {
    const visitGroups = (groups: OscalGroup[]) => {
      for (const g of groups) {
        if (g.controls) {
          for (const c of g.controls) addControl(c);
        }
        if (g.groups) visitGroups(g.groups);
      }
    };
    visitGroups(doc.groups);
  }

  if (doc.controlImplementation?.implementedRequirements) {
    for (const ir of doc.controlImplementation.implementedRequirements) {
      for (const sp of ir.setParameters ?? []) {
        if (sp.values.length > 0) paramOverrides[sp.paramId] = sp.values.join(", ");
      }
      const builtIn = getBuiltInControl(ir.controlId);
      if (builtIn) {
        addControl(builtIn, ir.description);
      } else if (!seen.has(ir.controlId.toLowerCase())) {
        seen.add(ir.controlId.toLowerCase());
        result.push({
          controlId: ir.controlId,
          title: ir.controlId.toUpperCase(),
          prose: ir.description ?? `Implementation of control ${ir.controlId}.`,
        });
      }
    }
  }

  return result;
}

/**
 * Projects an `OscalDocument` into SysML v2 `requirement def`, `part def`, and `satisfy` statements.
 */
export function oscalToSysML2(doc: OscalDocument): string {
  const pkgName = sanitizeIdentifier(doc.metadata.title || "OscalSecurityModel");
  const lines: string[] = [`package ${pkgName} {`, `  // Generated from OSCAL ${doc.kind} (${doc.uuid})`, ""];

  const controls = collectEffectiveControls(doc);
  for (const ctrl of controls) {
    const reqIdent = `Control_${sanitizeIdentifier(ctrl.controlId.toUpperCase())}`;
    const safeProse = ctrl.prose.replace(/\*\//g, "* /");
    lines.push(`  requirement def ${reqIdent} {`);
    lines.push(`    doc /* [${ctrl.controlId.toUpperCase()}] ${ctrl.title}: ${safeProse} */`);
    lines.push(`    attribute controlId = "${ctrl.controlId}";`);
    lines.push(`  }`);
    lines.push("");
  }

  const components = [...(doc.systemImplementation?.components ?? []), ...(doc.components ?? [])];

  const compUuidToIdent = new Map<string, { defIdent: string; instIdent: string }>();

  for (const comp of components) {
    const baseIdent = sanitizeIdentifier(comp.title || comp.uuid);
    const defIdent = `${baseIdent}_Component`;
    const instIdent = baseIdent.charAt(0).toLowerCase() + baseIdent.slice(1);
    compUuidToIdent.set(comp.uuid.toLowerCase(), { defIdent, instIdent });

    lines.push(`  part def ${defIdent} {`);
    lines.push(`    attribute uuid = "${comp.uuid}";`);
    lines.push(`    attribute componentType = "${comp.type}";`);
    lines.push(`  }`);
    lines.push("");
  }

  lines.push(`  part securityBoundary {`);
  for (const { defIdent, instIdent } of compUuidToIdent.values()) {
    lines.push(`    part ${instIdent} : ${defIdent};`);
  }

  if (doc.controlImplementation?.implementedRequirements) {
    for (const ir of doc.controlImplementation.implementedRequirements) {
      const reqIdent = `Control_${sanitizeIdentifier(ir.controlId.toUpperCase())}`;
      if (ir.byComponents && ir.byComponents.length > 0) {
        for (const bc of ir.byComponents) {
          const target = compUuidToIdent.get(bc.componentUuid.toLowerCase());
          const byTarget = target ? target.instIdent : "securityBoundary";
          lines.push(`    satisfy requirement ${reqIdent} by ${byTarget};`);
        }
      } else {
        lines.push(`    satisfy requirement ${reqIdent} by securityBoundary;`);
      }
    }
  } else {
    for (const ctrl of controls) {
      const reqIdent = `Control_${sanitizeIdentifier(ctrl.controlId.toUpperCase())}`;
      lines.push(`    satisfy requirement ${reqIdent} by securityBoundary;`);
    }
  }

  lines.push(`  }`);
  lines.push(`}`);
  return lines.join("\n");
}

/**
 * Projects an `OscalDocument` into OMG ReqIF 1.2 XML format.
 */
export function oscalToReqif(doc: OscalDocument): string {
  const controls = collectEffectiveControls(doc);
  const timestamp = doc.metadata.lastModified ?? "2026-01-01T00:00:00Z";

  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">`,
    `  <THE-HEADER>`,
    `    <REQ-IF-HEADER IDENTIFIER="header-${escapeXml(doc.uuid)}">`,
    `      <CREATION-TIME>${escapeXml(timestamp)}</CREATION-TIME>`,
    `      <TITLE>${escapeXml(doc.metadata.title)}</TITLE>`,
    `      <REQ-IF-TOOL-ID>@modelscript/oscal</REQ-IF-TOOL-ID>`,
    `      <REQ-IF-VERSION>1.2</REQ-IF-VERSION>`,
    `      <SOURCE-TOOL-ID>NIST-OSCAL-${escapeXml(doc.metadata.oscalVersion ?? "1.1.2")}</SOURCE-TOOL-ID>`,
    `    </REQ-IF-HEADER>`,
    `  </THE-HEADER>`,
    `  <CORE-CONTENT>`,
    `    <REQ-IF-CONTENT>`,
    `      <DATATYPES>`,
    `        <DATATYPE-DEFINITION-STRING IDENTIFIER="dt-string" LONG-NAME="String" MAX-LENGTH="4096"/>`,
    `      </DATATYPES>`,
    `      <SPEC-TYPES>`,
    `        <SPEC-OBJECT-TYPE IDENTIFIER="sot-oscal-control" LONG-NAME="OSCAL Security Control">`,
    `          <SPEC-ATTRIBUTES>`,
    `            <ATTRIBUTE-DEFINITION-STRING IDENTIFIER="attr-control-id" LONG-NAME="Control ID"/>`,
    `            <ATTRIBUTE-DEFINITION-STRING IDENTIFIER="attr-title" LONG-NAME="Title"/>`,
    `            <ATTRIBUTE-DEFINITION-STRING IDENTIFIER="attr-statement" LONG-NAME="Statement"/>`,
    `          </SPEC-ATTRIBUTES>`,
    `        </SPEC-OBJECT-TYPE>`,
    `      </SPEC-TYPES>`,
    `      <SPEC-OBJECTS>`,
  ];

  for (const ctrl of controls) {
    lines.push(
      `        <SPEC-OBJECT IDENTIFIER="so-${escapeXml(ctrl.controlId)}" LONG-NAME="${escapeXml(ctrl.title)}" LAST-CHANGE="${escapeXml(timestamp)}">`,
    );
    lines.push(`          <VALUES>`);
    lines.push(`            <ATTRIBUTE-VALUE-STRING THE-VALUE="${escapeXml(ctrl.controlId)}">`);
    lines.push(
      `              <DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>attr-control-id</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>`,
    );
    lines.push(`            </ATTRIBUTE-VALUE-STRING>`);
    lines.push(`            <ATTRIBUTE-VALUE-STRING THE-VALUE="${escapeXml(ctrl.title)}">`);
    lines.push(
      `              <DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>attr-title</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>`,
    );
    lines.push(`            </ATTRIBUTE-VALUE-STRING>`);
    lines.push(`            <ATTRIBUTE-VALUE-STRING THE-VALUE="${escapeXml(ctrl.prose)}">`);
    lines.push(
      `              <DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>attr-statement</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>`,
    );
    lines.push(`            </ATTRIBUTE-VALUE-STRING>`);
    lines.push(`          </VALUES>`);
    lines.push(`          <TYPE><SPEC-OBJECT-TYPE-REF>sot-oscal-control</SPEC-OBJECT-TYPE-REF></TYPE>`);
    lines.push(`        </SPEC-OBJECT>`);
  }

  lines.push(`      </SPEC-OBJECTS>`);
  lines.push(`      <SPECIFICATIONS>`);
  lines.push(
    `        <SPECIFICATION IDENTIFIER="spec-${escapeXml(doc.uuid)}" LONG-NAME="${escapeXml(doc.metadata.title)}" LAST-CHANGE="${escapeXml(timestamp)}">`,
  );
  lines.push(`          <CHILDREN>`);
  for (const ctrl of controls) {
    lines.push(`            <SPEC-HIERARCHY IDENTIFIER="sh-${escapeXml(ctrl.controlId)}">`);
    lines.push(`              <OBJECT><SPEC-OBJECT-REF>so-${escapeXml(ctrl.controlId)}</SPEC-OBJECT-REF></OBJECT>`);
    lines.push(`            </SPEC-HIERARCHY>`);
  }
  lines.push(`          </CHILDREN>`);
  lines.push(`        </SPECIFICATION>`);
  lines.push(`      </SPECIFICATIONS>`);
  lines.push(`    </REQ-IF-CONTENT>`);
  lines.push(`  </CORE-CONTENT>`);
  lines.push(`</REQ-IF>`);

  return lines.join("\n");
}
