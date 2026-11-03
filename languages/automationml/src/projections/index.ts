// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/automationml — Polyglot Projections (SSP 1.0 .ssd, SysML v2, Modelica 3.x).
 *
 * Projects IEC 62714 AutomationML (CAEX) mechatronic plant hierarchies, PPR roles,
 * 6-DOF frames, ExternalInterfaces, and InternalLinks into:
 * 1. Modelica Association SSP 1.0 SystemStructureDescription (.ssd XML)
 * 2. OMG SysML v2 textual notation (part def, part, port, connect)
 * 3. Modelica 3.x physical system model with connect(...) equations
 */

import type { AmlDocument, AmlExternalInterface, AmlInternalElement, AmlInternalLink } from "../types.js";

function sanitizeIdentifier(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned || "Unnamed";
}

function resolvePartnerEndpoint(
  ref: string,
  elementsById: Map<string, AmlInternalElement>,
  elementsByName: Map<string, AmlInternalElement>,
): { elementName: string; portName: string } {
  const sep = ref.indexOf(":");
  if (sep === -1) {
    return { elementName: sanitizeIdentifier(ref), portName: "port" };
  }
  const elKey = ref.slice(0, sep).trim();
  const portKey = ref.slice(sep + 1).trim();
  const el = elementsById.get(elKey) ?? elementsByName.get(elKey);
  return {
    elementName: sanitizeIdentifier(el?.name ?? elKey),
    portName: sanitizeIdentifier(portKey),
  };
}

function collectFlatTopology(doc: AmlDocument): {
  elements: AmlInternalElement[];
  links: AmlInternalLink[];
  elementsById: Map<string, AmlInternalElement>;
  elementsByName: Map<string, AmlInternalElement>;
} {
  const elements: AmlInternalElement[] = [];
  const links: AmlInternalLink[] = [];
  const elementsById = new Map<string, AmlInternalElement>();
  const elementsByName = new Map<string, AmlInternalElement>();

  const visit = (el: AmlInternalElement): void => {
    elements.push(el);
    elementsById.set(el.id, el);
    elementsByName.set(el.name, el);
    for (const link of el.internalLinks) {
      links.push(link);
    }
    for (const child of el.children) {
      visit(child);
    }
  };

  for (const ih of doc.instanceHierarchies) {
    for (const el of ih.elements) {
      visit(el);
    }
  }

  return { elements, links, elementsById, elementsByName };
}

function mapSspTypeTag(iface: AmlExternalInterface): string {
  const dt = (iface.dataType ?? "").toLowerCase();
  if (dt.includes("bool")) return "<ssc:Boolean />";
  if (dt.includes("int") || dt.includes("short") || dt.includes("long")) return "<ssc:Integer />";
  if (dt.includes("string")) return "<ssc:String />";
  return "<ssc:Real />";
}

function mapSspConnectorKind(dir: AmlExternalInterface["direction"]): string {
  if (dir === "In") return "input";
  if (dir === "Out") return "output";
  return "inout";
}

/**
 * Exports an AutomationML document to a Modelica Association SSP 1.0 (.ssd) XML document.
 */
export function amlToSsp(doc: AmlDocument): string {
  const sysName = sanitizeIdentifier(doc.instanceHierarchies[0]?.name ?? doc.fileName.replace(/\.[^.]+$/, ""));
  const { elements, links, elementsById, elementsByName } = collectFlatTopology(doc);

  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<ssd:SystemStructureDescription xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription" xmlns:ssc="http://ssp-standard.org/SSP1/SystemStructureCommon" version="1.0" name="${sysName}">`,
    `  <ssd:System name="${sysName}">`,
    `    <ssd:Elements>`,
  ];

  for (const el of elements) {
    const compName = sanitizeIdentifier(el.name);
    const fmuInterface = el.interfaces.find((i) => i.category === "FMU" || i.category === "PLCopenXML");
    const sourceAttr = fmuInterface?.refUri
      ? ` source="${fmuInterface.refUri}"`
      : ` source="resources/${compName}.fmu"`;
    lines.push(`      <ssd:Component name="${compName}" type="application/x-fmu-sharedlibrary"${sourceAttr}>`);
    if (el.interfaces.length > 0) {
      lines.push(`        <ssd:Connectors>`);
      for (const iface of el.interfaces) {
        const kind = mapSspConnectorKind(iface.direction);
        const typeTag = mapSspTypeTag(iface);
        lines.push(`          <ssd:Connector name="${sanitizeIdentifier(iface.name)}" kind="${kind}">`);
        lines.push(`            ${typeTag}`);
        lines.push(`          </ssd:Connector>`);
      }
      lines.push(`        </ssd:Connectors>`);
    }
    if (el.frame) {
      const f = el.frame;
      lines.push(`        <ssd:ElementGeometry x1="${f.x}" y1="${f.y}" x2="${f.x + 10}" y2="${f.y + 10}" />`);
    }
    lines.push(`      </ssd:Component>`);
  }

  lines.push(`    </ssd:Elements>`);
  lines.push(`    <ssd:Connections>`);

  for (const link of links) {
    const sideA = resolvePartnerEndpoint(link.refPartnerSideA, elementsById, elementsByName);
    const sideB = resolvePartnerEndpoint(link.refPartnerSideB, elementsById, elementsByName);
    lines.push(
      `      <ssd:Connection startElement="${sideA.elementName}" startConnector="${sideA.portName}" endElement="${sideB.elementName}" endConnector="${sideB.portName}" />`,
    );
  }

  lines.push(`    </ssd:Connections>`);
  lines.push(`  </ssd:System>`);
  lines.push(`</ssd:SystemStructureDescription>`);

  return lines.join("\n");
}

function mapSysMLType(dt?: string, val?: string | number | boolean): string {
  if (typeof val === "boolean") return "Boolean";
  const low = (dt ?? "").toLowerCase();
  if (low.includes("bool")) return "Boolean";
  if (low.includes("int") || low.includes("long") || low.includes("short")) return "Integer";
  if (low.includes("string")) return "String";
  return "Real";
}

/**
 * Projects an AutomationML document to OMG SysML v2 textual notation.
 */
export function amlToSysML2(doc: AmlDocument): string {
  const pkgName = sanitizeIdentifier(doc.instanceHierarchies[0]?.name ?? doc.fileName.replace(/\.[^.]+$/, ""));
  const { elements, links, elementsById, elementsByName } = collectFlatTopology(doc);

  const lines: string[] = [
    `package ${pkgName} {`,
    `  doc /* Generated from IEC 62714 AutomationML (${doc.fileName}, CAEX ${doc.schemaVersion}) */`,
    ``,
  ];

  // Emit part definitions for each InternalElement
  for (const el of elements) {
    const defName = `${sanitizeIdentifier(el.name)}Def`;
    const pprTag = el.pprCategory ? ` /* PPR: ${el.pprCategory} */` : "";
    lines.push(`  part def ${defName} {${pprTag}`);

    for (const attr of el.attributes) {
      const sysType = mapSysMLType(attr.dataType, attr.value ?? attr.defaultValue);
      const rawVal = attr.value ?? attr.defaultValue;
      const valClause = rawVal !== undefined ? ` = ${typeof rawVal === "string" ? `"${rawVal}"` : String(rawVal)}` : "";
      lines.push(`    attribute ${sanitizeIdentifier(attr.name)} : ${sysType}${valClause};`);
    }

    if (el.frame) {
      lines.push(`    attribute frame_x : Real = ${Number.isFinite(el.frame.x) ? el.frame.x : 0};`);
      lines.push(`    attribute frame_y : Real = ${Number.isFinite(el.frame.y) ? el.frame.y : 0};`);
      lines.push(`    attribute frame_z : Real = ${Number.isFinite(el.frame.z) ? el.frame.z : 0};`);
    }

    for (const iface of el.interfaces) {
      const dirPrefix = iface.direction === "In" ? "in " : iface.direction === "Out" ? "out " : "inout ";
      const portType = sanitizeIdentifier(iface.category);
      lines.push(`    ${dirPrefix}port ${sanitizeIdentifier(iface.name)} : ${portType};`);
    }

    lines.push(`  }`);
    lines.push(``);
  }

  // Emit composite plant assembly with part instances and connections
  lines.push(`  part plantTopology {`);
  for (const el of elements) {
    const instName = sanitizeIdentifier(el.name);
    const defName = `${instName}Def`;
    lines.push(`    part ${instName} : ${defName};`);
  }

  if (links.length > 0) {
    lines.push(``);
    for (const link of links) {
      const sideA = resolvePartnerEndpoint(link.refPartnerSideA, elementsById, elementsByName);
      const sideB = resolvePartnerEndpoint(link.refPartnerSideB, elementsById, elementsByName);
      lines.push(`    connect ${sideA.elementName}.${sideA.portName} to ${sideB.elementName}.${sideB.portName};`);
    }
  }

  lines.push(`  }`);
  lines.push(`}`);

  return lines.join("\n");
}

function mapModelicaType(dt?: string, val?: string | number | boolean): string {
  if (typeof val === "boolean") return "Boolean";
  const low = (dt ?? "").toLowerCase();
  if (low.includes("bool")) return "Boolean";
  if (low.includes("int") || low.includes("long") || low.includes("short")) return "Integer";
  return "Real";
}

/**
 * Projects an AutomationML document to a Modelica 3.x system model with connect(...) equations.
 */
export function amlToModelica(doc: AmlDocument): string {
  const modelName = sanitizeIdentifier(doc.instanceHierarchies[0]?.name ?? doc.fileName.replace(/\.[^.]+$/, ""));
  const { elements, links, elementsById, elementsByName } = collectFlatTopology(doc);

  const lines: string[] = [`model ${modelName} "Generated from IEC 62714 AutomationML (${doc.fileName})"`];

  // 1. Component submodels and declarations
  for (const el of elements) {
    const elId = sanitizeIdentifier(el.name);
    for (const attr of el.attributes) {
      const moType = mapModelicaType(attr.dataType, attr.value ?? attr.defaultValue);
      if (typeof attr.value === "string" && moType === "Real" && Number.isNaN(Number(attr.value))) {
        continue;
      }
      const rawVal = attr.value ?? attr.defaultValue ?? 0;
      const valStr = typeof rawVal === "boolean" ? (rawVal ? "true" : "false") : String(Number(rawVal) || 0);
      lines.push(`  parameter ${moType} ${elId}_${sanitizeIdentifier(attr.name)} = ${valStr};`);
    }

    if (el.frame) {
      lines.push(`  parameter Real ${elId}_frame_x = ${Number.isFinite(el.frame.x) ? el.frame.x : 0};`);
      lines.push(`  parameter Real ${elId}_frame_y = ${Number.isFinite(el.frame.y) ? el.frame.y : 0};`);
      lines.push(`  parameter Real ${elId}_frame_z = ${Number.isFinite(el.frame.z) ? el.frame.z : 0};`);
    }

    lines.push(`  Real ${elId}_state(start = 0.0);`);

    for (const iface of el.interfaces) {
      const moType = mapModelicaType(iface.dataType);
      const prefix = iface.direction === "In" ? "input " : iface.direction === "Out" ? "output " : "";
      lines.push(`  ${prefix}${moType} ${elId}_${sanitizeIdentifier(iface.name)};`);
    }
  }

  lines.push(`equation`);

  // 2. First-order plant equations and connect(...) equations
  for (const el of elements) {
    const elId = sanitizeIdentifier(el.name);
    lines.push(`  der(${elId}_state) = -${elId}_state;`);
  }

  for (const link of links) {
    const sideA = resolvePartnerEndpoint(link.refPartnerSideA, elementsById, elementsByName);
    const sideB = resolvePartnerEndpoint(link.refPartnerSideB, elementsById, elementsByName);
    lines.push(`  connect(${sideA.elementName}.${sideA.portName}, ${sideB.elementName}.${sideB.portName});`);
  }

  lines.push(`end ${modelName};`);
  return lines.join("\n");
}
