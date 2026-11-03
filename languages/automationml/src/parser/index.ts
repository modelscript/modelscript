// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/automationml — IEC 62714 CAEX 2.15 / 3.0 XML & Declarative AML Parser.
 *
 * Supports both:
 * 1. Standard IEC 62714 CAEX XML (<CAEXFile>, <InstanceHierarchy>, <InternalElement>,
 *    <ExternalInterface>, <InternalLink>, <SystemUnitClassLib>, <RoleClassLib>,
 *    <InterfaceClassLib>, <AttributeTypeLib>, <RoleRequirements>, <Frame>, <Attribute>)
 * 2. Concise declarative AML textual syntax with accurate 1-indexed line/column source ranges.
 */

import { parseXml, type XmlElement } from "@modelscript/dsl/xml";
import type {
  AmlAttribute,
  AmlAttributeType,
  AmlAttributeTypeLib,
  AmlDocument,
  AmlExternalInterface,
  AmlFrame,
  AmlInstanceHierarchy,
  AmlInterfaceCategory,
  AmlInterfaceClass,
  AmlInterfaceClassLib,
  AmlInternalElement,
  AmlInternalLink,
  AmlPortDirection,
  AmlPprCategory,
  AmlRoleClass,
  AmlRoleClassLib,
  AmlRoleRequirement,
  AmlSchemaVersion,
  AmlSourceRange,
  AmlSystemUnitClass,
  AmlSystemUnitClassLib,
} from "../types.js";

function computeLineCol(source: string, offset: number): { line: number; col: number } {
  let line = 1;
  let col = 1;
  const target = Math.max(0, Math.min(offset, source.length));
  for (let i = 0; i < target; i++) {
    if (source[i] === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

export function makeRange(source: string, startOffset: number, endOffset: number): AmlSourceRange {
  const start = computeLineCol(source, startOffset);
  const end = computeLineCol(source, endOffset);
  return {
    startOffset,
    endOffset,
    startLine: start.line,
    startColumn: start.col,
    endLine: end.line,
    endColumn: end.col,
  };
}

function makeElemRange(source: string, elem: XmlElement): AmlSourceRange {
  return makeRange(source, elem.start, elem.end);
}

function getAttr(elem: XmlElement, name: string): string | undefined {
  const lower = name.toLowerCase();
  const attr = elem.attributes.find((a) => a.name.toLowerCase() === lower);
  return attr?.value;
}

function findChild(elem: XmlElement, name: string): XmlElement | undefined {
  const lower = name.toLowerCase();
  return elem.children.find((c) => c.name.toLowerCase() === lower);
}

function findChildren(elem: XmlElement, name: string): XmlElement[] {
  const lower = name.toLowerCase();
  return elem.children.filter((c) => c.name.toLowerCase() === lower);
}

function parseScalarValue(raw: string | undefined, dataType?: string): string | number | boolean | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  const dt = (dataType ?? "").toLowerCase();
  if (dt.includes("bool") || trimmed.toLowerCase() === "true" || trimmed.toLowerCase() === "false") {
    if (trimmed.toLowerCase() === "true") return true;
    if (trimmed.toLowerCase() === "false") return false;
  }
  if (
    dt.includes("double") ||
    dt.includes("float") ||
    dt.includes("decimal") ||
    dt.includes("real") ||
    dt.includes("int") ||
    dt.includes("integer") ||
    dt.includes("long")
  ) {
    const num = Number(trimmed);
    if (!Number.isNaN(num)) return num;
  }
  if (/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed;
}

function inferInterfaceCategory(refBaseClassPath: string, explicitCategory?: string): AmlInterfaceCategory {
  if (explicitCategory) {
    const norm = explicitCategory.trim().toLowerCase();
    if (norm === "plcopenxml") return "PLCopenXML";
    if (norm === "collada") return "COLLADA";
    if (norm === "fmu" || norm === "fmi") return "FMU";
    if (norm === "order") return "Order";
    if (norm === "energy") return "Energy";
    if (norm === "signal") return "Signal";
  }
  const pathLower = refBaseClassPath.toLowerCase();
  if (
    pathLower.includes("plcopenxml") ||
    pathLower.includes("logicinterface") ||
    pathLower.includes("variableinterface")
  ) {
    return "PLCopenXML";
  }
  if (pathLower.includes("collada")) {
    return "COLLADA";
  }
  if (pathLower.includes("fmu") || pathLower.includes("fmi")) {
    return "FMU";
  }
  if (pathLower.includes("order")) {
    return "Order";
  }
  if (
    pathLower.includes("energy") ||
    pathLower.includes("electric") ||
    pathLower.includes("pneumatic") ||
    pathLower.includes("hydraulic")
  ) {
    return "Energy";
  }
  return "Signal";
}

function normalizeDirection(raw?: string): AmlPortDirection {
  if (!raw) return "InOut";
  const norm = raw.trim().toLowerCase();
  if (norm === "in" || norm === "input") return "In";
  if (norm === "out" || norm === "output") return "Out";
  return "InOut";
}

function inferPprCategory(explicit?: string, rolePaths?: string[]): AmlPprCategory | undefined {
  if (explicit) {
    const norm = explicit.trim().toLowerCase();
    if (norm === "product") return "Product";
    if (norm === "process") return "Process";
    if (norm === "resource") return "Resource";
    if (norm === "structure") return "Structure";
  }
  if (rolePaths) {
    for (const rp of rolePaths) {
      const lower = rp.toLowerCase();
      if (lower.includes("product")) return "Product";
      if (lower.includes("process")) return "Process";
      if (lower.includes("resource")) return "Resource";
      if (lower.includes("structure")) return "Structure";
    }
  }
  return undefined;
}

function parseXmlAttribute(source: string, elem: XmlElement): AmlAttribute {
  const name = getAttr(elem, "Name") ?? "UnnamedAttribute";
  const dataType = getAttr(elem, "AttributeDataType") ?? getAttr(elem, "DataType");
  const unit = getAttr(elem, "Unit");
  const valElem = findChild(elem, "Value");
  const defElem = findChild(elem, "DefaultValue");
  const descElem = findChild(elem, "Description");

  const rawVal = getAttr(elem, "Value") ?? valElem?.text;
  const rawDef = getAttr(elem, "DefaultValue") ?? defElem?.text;
  const value = parseScalarValue(rawVal, dataType);
  const defaultValue = parseScalarValue(rawDef, dataType);
  const description = getAttr(elem, "Description") ?? (descElem?.text ? descElem.text.trim() : undefined);

  const subAttrs = findChildren(elem, "Attribute").map((c) => parseXmlAttribute(source, c));

  return {
    name,
    dataType,
    unit,
    value,
    defaultValue,
    description,
    subAttributes: subAttrs.length > 0 ? subAttrs : undefined,
    range: makeElemRange(source, elem),
  };
}

function extractFrameFromAttribute(attr: AmlAttribute): AmlFrame {
  const getCoord = (key: string): number => {
    const sub = attr.subAttributes?.find((s) => s.name.toLowerCase() === key.toLowerCase());
    if (!sub || sub.value === undefined) return 0;
    if (typeof sub.value === "number") return sub.value;
    return Number(String(sub.value).trim());
  };
  return {
    x: getCoord("x"),
    y: getCoord("y"),
    z: getCoord("z"),
    rx: getCoord("rx"),
    ry: getCoord("ry"),
    rz: getCoord("rz"),
    range: attr.range,
  };
}

function parseXmlFrameElement(source: string, elem: XmlElement): AmlFrame {
  const parseCoord = (key: string): number => {
    const raw = getAttr(elem, key);
    if (raw === undefined) {
      const child =
        findChild(elem, key) ?? elem.children.find((c) => getAttr(c, "Name")?.toLowerCase() === key.toLowerCase());
      if (child) {
        const valText = getAttr(child, "Value") ?? findChild(child, "Value")?.text ?? child.text;
        return valText !== undefined && valText.trim() !== "" ? Number(valText.trim()) : 0;
      }
      return 0;
    }
    return Number(raw.trim());
  };
  return {
    x: parseCoord("x"),
    y: parseCoord("y"),
    z: parseCoord("z"),
    rx: parseCoord("rx"),
    ry: parseCoord("ry"),
    rz: parseCoord("rz"),
    range: makeElemRange(source, elem),
  };
}

function parseXmlExternalInterface(source: string, elem: XmlElement): AmlExternalInterface {
  const name = getAttr(elem, "Name") ?? "UnnamedInterface";
  const id = getAttr(elem, "ID") ?? name;
  const refBaseClassPath = getAttr(elem, "RefBaseClassPath") ?? "";
  const attrs = findChildren(elem, "Attribute").map((a) => parseXmlAttribute(source, a));

  const dirAttr = attrs.find((a) => a.name.toLowerCase() === "direction");
  const explicitDir = getAttr(elem, "Direction") ?? (dirAttr?.value !== undefined ? String(dirAttr.value) : undefined);
  const direction = normalizeDirection(explicitDir);

  const uriAttr = attrs.find((a) => a.name.toLowerCase() === "refuri" || a.name.toLowerCase() === "uri");
  const refUri =
    getAttr(elem, "RefURI") ??
    getAttr(elem, "refUri") ??
    (uriAttr?.value !== undefined ? String(uriAttr.value) : undefined);

  const dtAttr = attrs.find((a) => a.name.toLowerCase() === "datatype" || a.name.toLowerCase() === "type");
  const dataType =
    getAttr(elem, "DataType") ??
    getAttr(elem, "AttributeDataType") ??
    (dtAttr?.value !== undefined ? String(dtAttr.value) : dtAttr?.dataType);

  const catAttr = attrs.find((a) => a.name.toLowerCase() === "category");
  const explicitCat = getAttr(elem, "Category") ?? (catAttr?.value !== undefined ? String(catAttr.value) : undefined);
  const category = inferInterfaceCategory(refBaseClassPath, explicitCat);

  return {
    id,
    name,
    refBaseClassPath,
    direction,
    dataType,
    refUri,
    category,
    attributes: attrs.length > 0 ? attrs : undefined,
    range: makeElemRange(source, elem),
  };
}

function parseXmlInternalLink(source: string, elem: XmlElement): AmlInternalLink {
  const name = getAttr(elem, "Name") ?? "UnnamedLink";
  const refPartnerSideA = getAttr(elem, "RefPartnerSideA") ?? "";
  const refPartnerSideB = getAttr(elem, "RefPartnerSideB") ?? "";
  return {
    name,
    refPartnerSideA,
    refPartnerSideB,
    range: makeElemRange(source, elem),
  };
}

function parseXmlRoleRequirement(source: string, elem: XmlElement): AmlRoleRequirement {
  const refBaseRoleClassPath = getAttr(elem, "RefBaseRoleClassPath") ?? getAttr(elem, "RefRoleClassPath") ?? "";
  const reqIfAttr = getAttr(elem, "RequiredInterfaces");
  const reqAttrAttr = getAttr(elem, "RequiredAttributes");

  const requiredInterfaces: string[] = reqIfAttr
    ? reqIfAttr
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  for (const childIf of findChildren(elem, "ExternalInterface")) {
    const ifName = getAttr(childIf, "Name");
    if (ifName && !requiredInterfaces.includes(ifName)) {
      requiredInterfaces.push(ifName);
    }
  }

  const requiredAttributes: string[] = reqAttrAttr
    ? reqAttrAttr
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  for (const childAttr of findChildren(elem, "Attribute")) {
    const attrName = getAttr(childAttr, "Name");
    if (attrName && !requiredAttributes.includes(attrName)) {
      requiredAttributes.push(attrName);
    }
  }

  return {
    refBaseRoleClassPath,
    requiredInterfaces,
    requiredAttributes,
    range: makeElemRange(source, elem),
  };
}

function parseXmlInternalElement(source: string, elem: XmlElement): AmlInternalElement {
  const name = getAttr(elem, "Name") ?? "UnnamedElement";
  const id = getAttr(elem, "ID") ?? name;
  const refBaseSystemUnitPath = getAttr(elem, "RefBaseSystemUnitPath");

  const roleReqs: AmlRoleRequirement[] = [
    ...findChildren(elem, "RoleRequirements").map((r) => parseXmlRoleRequirement(source, r)),
    ...findChildren(elem, "SupportedRoleClass").map((r) => parseXmlRoleRequirement(source, r)),
  ];

  const allAttrs = findChildren(elem, "Attribute").map((a) => parseXmlAttribute(source, a));
  let frame: AmlFrame | undefined = undefined;
  const frameElem = findChild(elem, "Frame");
  if (frameElem) {
    frame = parseXmlFrameElement(source, frameElem);
  } else {
    const frameAttr = allAttrs.find((a) => a.name.toLowerCase() === "frame");
    if (frameAttr) {
      frame = extractFrameFromAttribute(frameAttr);
    }
  }

  const attributes = allAttrs.filter((a) => a.name.toLowerCase() !== "frame");
  const interfaces = findChildren(elem, "ExternalInterface").map((i) => parseXmlExternalInterface(source, i));
  const internalLinks = findChildren(elem, "InternalLink").map((l) => parseXmlInternalLink(source, l));
  const children = findChildren(elem, "InternalElement").map((c) => parseXmlInternalElement(source, c));

  const pprCategory = inferPprCategory(
    getAttr(elem, "PPRCategory") ?? getAttr(elem, "Category"),
    roleReqs.map((r) => r.refBaseRoleClassPath),
  );

  return {
    id,
    name,
    refBaseSystemUnitPath,
    roleRequirements: roleReqs,
    pprCategory,
    frame,
    attributes,
    interfaces,
    internalLinks,
    children,
    range: makeElemRange(source, elem),
  };
}

function parseXmlSystemUnitClass(source: string, elem: XmlElement): AmlSystemUnitClass {
  const name = getAttr(elem, "Name") ?? "UnnamedSystemUnitClass";
  const id = getAttr(elem, "ID");
  const refBaseClassPath = getAttr(elem, "RefBaseClassPath");
  const supportedRoleClassPaths: string[] = [];
  for (const src of findChildren(elem, "SupportedRoleClass")) {
    const path = getAttr(src, "RefRoleClassPath") ?? getAttr(src, "RefBaseRoleClassPath");
    if (path) supportedRoleClassPaths.push(path);
  }
  const attributes = findChildren(elem, "Attribute").map((a) => parseXmlAttribute(source, a));
  const interfaces = findChildren(elem, "ExternalInterface").map((i) => parseXmlExternalInterface(source, i));
  const internalElements = findChildren(elem, "InternalElement").map((e) => parseXmlInternalElement(source, e));
  const internalLinks = findChildren(elem, "InternalLink").map((l) => parseXmlInternalLink(source, l));
  const children = findChildren(elem, "SystemUnitClass").map((c) => parseXmlSystemUnitClass(source, c));

  return {
    id,
    name,
    refBaseClassPath,
    supportedRoleClassPaths,
    attributes,
    interfaces,
    internalElements,
    internalLinks,
    children,
    range: makeElemRange(source, elem),
  };
}

function parseXmlRoleClass(source: string, elem: XmlElement): AmlRoleClass {
  const name = getAttr(elem, "Name") ?? "UnnamedRoleClass";
  const refBaseClassPath = getAttr(elem, "RefBaseClassPath");
  const attributes = findChildren(elem, "Attribute").map((a) => parseXmlAttribute(source, a));
  const interfaces = findChildren(elem, "ExternalInterface").map((i) => parseXmlExternalInterface(source, i));
  const children = findChildren(elem, "RoleClass").map((c) => parseXmlRoleClass(source, c));
  const pprCategory = inferPprCategory(
    getAttr(elem, "PPRCategory"),
    refBaseClassPath ? [refBaseClassPath, name] : [name],
  );

  return {
    name,
    refBaseClassPath,
    pprCategory,
    attributes,
    interfaces,
    children,
    range: makeElemRange(source, elem),
  };
}

function parseXmlInterfaceClass(source: string, elem: XmlElement): AmlInterfaceClass {
  const name = getAttr(elem, "Name") ?? "UnnamedInterfaceClass";
  const refBaseClassPath = getAttr(elem, "RefBaseClassPath");
  const attributes = findChildren(elem, "Attribute").map((a) => parseXmlAttribute(source, a));
  const children = findChildren(elem, "InterfaceClass").map((c) => parseXmlInterfaceClass(source, c));
  const explicitCat = getAttr(elem, "Category");
  const category = inferInterfaceCategory(refBaseClassPath ?? name, explicitCat);
  const explicitDir = getAttr(elem, "Direction");
  const direction = explicitDir ? normalizeDirection(explicitDir) : undefined;

  return {
    name,
    refBaseClassPath,
    category,
    direction,
    attributes,
    children,
    range: makeElemRange(source, elem),
  };
}

function parseXmlAttributeType(source: string, elem: XmlElement): AmlAttributeType {
  const name = getAttr(elem, "Name") ?? "UnnamedAttributeType";
  const dataType = getAttr(elem, "AttributeDataType") ?? getAttr(elem, "DataType");
  const unit = getAttr(elem, "Unit");
  const rawDef = getAttr(elem, "DefaultValue") ?? findChild(elem, "DefaultValue")?.text;
  const defaultValue = parseScalarValue(rawDef, dataType);
  const refBaseClassPath = getAttr(elem, "RefBaseClassPath");
  const children = findChildren(elem, "AttributeType").map((c) => parseXmlAttributeType(source, c));

  return {
    name,
    dataType,
    unit,
    defaultValue,
    refBaseClassPath,
    children,
    range: makeElemRange(source, elem),
  };
}

function parseCaexXml(source: string, uri?: string): AmlDocument {
  const xmlDoc = parseXml(source);
  const root = xmlDoc.root;
  if (!root) {
    throw new Error("Empty or malformed CAEX XML document.");
  }

  const rootName = root.name.toLowerCase();
  if (rootName !== "caexfile" && rootName !== "instancehierarchy") {
    throw new Error(`Expected <CAEXFile> root element in AutomationML XML, found <${root.name}>.`);
  }

  const fileName = getAttr(root, "FileName") ?? uri ?? "PlantTopology.aml";
  const rawVer = getAttr(root, "SchemaVersion") ?? "2.15";
  const schemaVersion: AmlSchemaVersion = rawVer.startsWith("3") ? "3.0" : "2.15";

  const instanceHierarchies: AmlInstanceHierarchy[] = [];
  const systemUnitClassLibs: AmlSystemUnitClassLib[] = [];
  const roleClassLibs: AmlRoleClassLib[] = [];
  const interfaceClassLibs: AmlInterfaceClassLib[] = [];
  const attributeTypeLibs: AmlAttributeTypeLib[] = [];

  if (rootName === "instancehierarchy") {
    instanceHierarchies.push({
      name: getAttr(root, "Name") ?? "DefaultHierarchy",
      version: findChild(root, "Version")?.text?.trim() ?? getAttr(root, "Version"),
      elements: findChildren(root, "InternalElement").map((e) => parseXmlInternalElement(source, e)),
      range: makeElemRange(source, root),
    });
  } else {
    for (const ih of findChildren(root, "InstanceHierarchy")) {
      const elements = findChildren(ih, "InternalElement").map((e) => parseXmlInternalElement(source, e));
      // Also attach any hierarchy-level InternalLink tags to the first element if present
      const topLinks = findChildren(ih, "InternalLink").map((l) => parseXmlInternalLink(source, l));
      if (topLinks.length > 0 && elements[0]) {
        elements[0].internalLinks.push(...topLinks);
      }
      instanceHierarchies.push({
        name: getAttr(ih, "Name") ?? "InstanceHierarchy",
        version: findChild(ih, "Version")?.text?.trim() ?? getAttr(ih, "Version"),
        elements,
        range: makeElemRange(source, ih),
      });
    }

    for (const sucLib of findChildren(root, "SystemUnitClassLib")) {
      systemUnitClassLibs.push({
        name: getAttr(sucLib, "Name") ?? "SystemUnitClassLib",
        version: findChild(sucLib, "Version")?.text?.trim() ?? getAttr(sucLib, "Version"),
        classes: findChildren(sucLib, "SystemUnitClass").map((c) => parseXmlSystemUnitClass(source, c)),
        range: makeElemRange(source, sucLib),
      });
    }

    for (const rcLib of findChildren(root, "RoleClassLib")) {
      roleClassLibs.push({
        name: getAttr(rcLib, "Name") ?? "RoleClassLib",
        version: findChild(rcLib, "Version")?.text?.trim() ?? getAttr(rcLib, "Version"),
        classes: findChildren(rcLib, "RoleClass").map((c) => parseXmlRoleClass(source, c)),
        range: makeElemRange(source, rcLib),
      });
    }

    for (const icLib of findChildren(root, "InterfaceClassLib")) {
      interfaceClassLibs.push({
        name: getAttr(icLib, "Name") ?? "InterfaceClassLib",
        version: findChild(icLib, "Version")?.text?.trim() ?? getAttr(icLib, "Version"),
        classes: findChildren(icLib, "InterfaceClass").map((c) => parseXmlInterfaceClass(source, c)),
        range: makeElemRange(source, icLib),
      });
    }

    for (const atLib of findChildren(root, "AttributeTypeLib")) {
      attributeTypeLibs.push({
        name: getAttr(atLib, "Name") ?? "AttributeTypeLib",
        version: findChild(atLib, "Version")?.text?.trim() ?? getAttr(atLib, "Version"),
        types: findChildren(atLib, "AttributeType").map((t) => parseXmlAttributeType(source, t)),
        range: makeElemRange(source, atLib),
      });
    }
  }

  return {
    fileName,
    schemaVersion,
    instanceHierarchies,
    systemUnitClassLibs,
    roleClassLibs,
    interfaceClassLibs,
    attributeTypeLibs,
    range: makeElemRange(source, root),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Declarative AML DSL Parser
// ─────────────────────────────────────────────────────────────────────────────

interface LineEntry {
  lineIndex: number; // 0-based
  raw: string;
  trimmed: string;
  startOffset: number;
  endOffset: number;
}

function stripLineComment(raw: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (!inSingle && !inDouble) {
      if (ch === "/" && raw[i + 1] === "/" && raw[i - 1] !== ":") {
        return raw.slice(0, i);
      }
      if (ch === "#" && (i === 0 || /\s/.test(raw[i - 1] ?? ""))) {
        return raw.slice(0, i);
      }
    }
  }
  return raw;
}

function splitLinesWithOffsets(source: string): LineEntry[] {
  const entries: LineEntry[] = [];
  let offset = 0;
  const rawLines = source.split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i] ?? "";
    const startOffset = offset;
    const endOffset = offset + raw.length;
    const withoutComment = stripLineComment(raw);
    entries.push({
      lineIndex: i,
      raw,
      trimmed: withoutComment.trim(),
      startOffset,
      endOffset,
    });
    // Advance offset past newline (\n or \r\n)
    offset = endOffset;
    if (source[offset] === "\r") offset++;
    if (source[offset] === "\n") offset++;
  }
  return entries;
}

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function findMatchingCloseBrace(lines: LineEntry[], startIdx: number): number {
  let depth = 0;
  for (let i = startIdx; i < lines.length; i++) {
    const text = lines[i]?.trimmed ?? "";
    for (let c = 0; c < text.length; c++) {
      if (text[c] === "{") depth++;
      else if (text[c] === "}") {
        depth--;
        if (depth === 0) return i;
      }
    }
  }
  return lines.length - 1;
}

function parseDslAttributeLine(source: string, line: LineEntry): AmlAttribute {
  // Formats supported:
  // attribute maxSpeed: REAL = 2.5 [m/s]
  // attribute status = "OK"
  const rest = line.trimmed
    .replace(/^attribute\s+/i, "")
    .replace(/;$/, "")
    .trim();
  let unit: string | undefined = undefined;
  let working = rest;
  const unitMatch = working.match(/\[([^\]]+)\]\s*$/);
  if (unitMatch?.[1]) {
    unit = unitMatch[1].trim();
    working = working.slice(0, unitMatch.index).trim();
  }

  let value: string | number | boolean | undefined = undefined;
  const eqIdx = working.indexOf("=");
  if (eqIdx !== -1) {
    const valStr = unquote(working.slice(eqIdx + 1).trim());
    working = working.slice(0, eqIdx).trim();
    value = valStr;
  }

  let name = working;
  let dataType: string | undefined = undefined;
  const colonIdx = working.indexOf(":");
  if (colonIdx !== -1) {
    name = unquote(working.slice(0, colonIdx).trim());
    dataType = working.slice(colonIdx + 1).trim();
  } else {
    name = unquote(working);
  }

  if (typeof value === "string") {
    value = parseScalarValue(value, dataType);
  }

  return {
    name,
    dataType,
    unit,
    value,
    range: makeRange(source, line.startOffset, line.endOffset),
  };
}

function parseDslInterfaceLine(source: string, line: LineEntry, parentId: string): AmlExternalInterface {
  // Formats supported:
  // interface runCmd: In BOOL extends "AutomationMLInterfaceClassLib/AutomationMLBaseInterface/SignalInterface" uri="file://..."
  // port speedOut: Out Signal REAL
  const rest = line.trimmed
    .replace(/^(?:externalInterface|interface|port)\s+/i, "")
    .replace(/;$/, "")
    .trim();

  let refUri: string | undefined = undefined;
  let working = rest;
  const uriMatch = working.match(/\buri\s*=\s*("[^"]*"|'[^']*'|\S+)/i);
  if (uriMatch?.[1]) {
    refUri = unquote(uriMatch[1]);
    working = (working.slice(0, uriMatch.index) + working.slice((uriMatch.index ?? 0) + uriMatch[0].length)).trim();
  }

  let customId: string | undefined = undefined;
  const idMatch = working.match(/\bid\s*=\s*("[^"]*"|'[^']*'|\S+)/i);
  if (idMatch?.[1]) {
    customId = unquote(idMatch[1]);
    working = (working.slice(0, idMatch.index) + working.slice((idMatch.index ?? 0) + idMatch[0].length)).trim();
  }

  let refBaseClassPath = "AutomationMLInterfaceClassLib/AutomationMLBaseInterface/SignalInterface";
  const extMatch = working.match(/\bextends\s+("[^"]*"|'[^']*'|\S+)/i);
  if (extMatch?.[1]) {
    refBaseClassPath = unquote(extMatch[1]);
    working = (working.slice(0, extMatch.index) + working.slice((extMatch.index ?? 0) + extMatch[0].length)).trim();
  }

  let name = working;
  let specPart = "";
  const colonIdx = working.indexOf(":");
  if (colonIdx !== -1) {
    name = unquote(working.slice(0, colonIdx).trim());
    specPart = working.slice(colonIdx + 1).trim();
  } else {
    name = unquote(working);
  }

  const tokens = specPart.split(/\s+/).filter(Boolean);
  let direction: AmlPortDirection = "InOut";
  let explicitCat: string | undefined = undefined;
  let dataType: string | undefined = undefined;

  for (const tok of tokens) {
    const low = tok.toLowerCase();
    if (low === "in" || low === "out" || low === "inout") {
      direction = normalizeDirection(tok);
    } else if (
      low === "signal" ||
      low === "plcopenxml" ||
      low === "collada" ||
      low === "fmu" ||
      low === "order" ||
      low === "energy"
    ) {
      explicitCat = tok;
      if (low === "plcopenxml" && !extMatch) {
        refBaseClassPath = "AutomationMLInterfaceClassLib/AutomationMLBaseInterface/PLCopenXMLInterface";
      } else if (low === "collada" && !extMatch) {
        refBaseClassPath = "AutomationMLInterfaceClassLib/AutomationMLBaseInterface/COLLADAInterface";
      } else if (low === "order" && !extMatch) {
        refBaseClassPath = "AutomationMLInterfaceClassLib/AutomationMLBaseInterface/Order";
      } else if (low === "energy" && !extMatch) {
        refBaseClassPath = "AutomationMLInterfaceClassLib/AutomationMLBaseInterface/ExternalDataConnector";
      }
    } else {
      dataType = tok;
    }
  }

  const category = inferInterfaceCategory(refBaseClassPath, explicitCat);

  return {
    id: customId ?? `${parentId}:${name}`,
    name,
    refBaseClassPath,
    direction,
    dataType,
    refUri,
    category,
    range: makeRange(source, line.startOffset, line.endOffset),
  };
}

function parseDslFrameLine(source: string, line: LineEntry): AmlFrame {
  // frame (x=1.0, y=2.0, z=0.0, rx=0, ry=0, rz=90)
  const coords: Record<string, number> = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
  const kvRegex = /\b(rx|ry|rz|x|y|z)\s*=\s*([^\s,)]+)/gi;
  let match = kvRegex.exec(line.trimmed);
  while (match !== null) {
    const key = (match[1] ?? "").toLowerCase();
    const valStr = unquote(match[2] ?? "0");
    coords[key] = Number(valStr);
    match = kvRegex.exec(line.trimmed);
  }
  return {
    x: coords["x"] ?? 0,
    y: coords["y"] ?? 0,
    z: coords["z"] ?? 0,
    rx: coords["rx"] ?? 0,
    ry: coords["ry"] ?? 0,
    rz: coords["rz"] ?? 0,
    range: makeRange(source, line.startOffset, line.endOffset),
  };
}

function parseDslRoleReqLine(source: string, line: LineEntry): AmlRoleRequirement {
  // roleRequirement "CustomRoleLib/ConveyorRole" requiresInterfaces=[powerIn] requiresAttributes=[maxSpeed]
  const rest = line.trimmed
    .replace(/^(?:roleRequirement|roleRequirements|supportedRole)\s+/i, "")
    .replace(/;$/, "")
    .trim();
  let requiredInterfaces: string[] = [];
  let requiredAttributes: string[] = [];
  let working = rest;

  const ifMatch = working.match(/requiresInterfaces\s*=\s*\[([^\]]*)\]/i);
  if (ifMatch?.[1] !== undefined) {
    requiredInterfaces = ifMatch[1]
      .split(",")
      .map((s) => unquote(s.trim()))
      .filter(Boolean);
    working = (working.slice(0, ifMatch.index) + working.slice((ifMatch.index ?? 0) + ifMatch[0].length)).trim();
  }

  const attrMatch = working.match(/requiresAttributes\s*=\s*\[([^\]]*)\]/i);
  if (attrMatch?.[1] !== undefined) {
    requiredAttributes = attrMatch[1]
      .split(",")
      .map((s) => unquote(s.trim()))
      .filter(Boolean);
    working = (working.slice(0, attrMatch.index) + working.slice((attrMatch.index ?? 0) + attrMatch[0].length)).trim();
  }

  const refBaseRoleClassPath = unquote(working);
  return {
    refBaseRoleClassPath,
    requiredInterfaces,
    requiredAttributes,
    range: makeRange(source, line.startOffset, line.endOffset),
  };
}

function parseDslLinkLine(source: string, line: LineEntry): AmlInternalLink {
  // link "StartLink" ctrl-1:startOut -> conv-1:runCmd
  // link ctrl-1:startOut -> conv-1:runCmd
  const rest = line.trimmed
    .replace(/^(?:internalLink|link)\s+/i, "")
    .replace(/;$/, "")
    .trim();
  let name = "Link";
  let connPart = rest;

  const quoteMatch = rest.match(/^("[^"]*"|'[^']*')\s+(.+)$/);
  if (quoteMatch?.[1] && quoteMatch[2]) {
    name = unquote(quoteMatch[1]);
    connPart = quoteMatch[2].trim();
  }

  const arrowParts = connPart.split(/\s*(?:<->|->|--)\s*/);
  const refPartnerSideA = unquote(arrowParts[0] ?? "");
  const refPartnerSideB = unquote(arrowParts[1] ?? "");
  if (name === "Link" && refPartnerSideA && refPartnerSideB) {
    name = `${refPartnerSideA}_to_${refPartnerSideB}`;
  }

  return {
    name,
    refPartnerSideA,
    refPartnerSideB,
    range: makeRange(source, line.startOffset, line.endOffset),
  };
}

function parseDslElementBlock(
  source: string,
  lines: LineEntry[],
  startIdx: number,
  endIdx: number,
): AmlInternalElement {
  const headerLine = lines[startIdx]!;
  const endLine = lines[endIdx]!;
  // element Conveyor1 : "PlantUnitLib/ConveyorUnit" [id="conv-1", ppr=Resource] {
  const header = headerLine.trimmed
    .replace(/^(?:internalElement|element)\s+/i, "")
    .replace(/\{.*$/, "")
    .trim();

  let id: string | undefined = undefined;
  let explicitPpr: string | undefined = undefined;
  let working = header;

  const bracketMatch = working.match(/\[([^\]]*)\]/);
  if (bracketMatch?.[1] !== undefined) {
    const meta = bracketMatch[1];
    const idM = meta.match(/\bid\s*=\s*("[^"]*"|'[^']*'|[^,\s]+)/i);
    if (idM?.[1]) id = unquote(idM[1]);
    const pprM = meta.match(/\bppr\s*=\s*("[^"]*"|'[^']*'|[^,\s]+)/i);
    if (pprM?.[1]) explicitPpr = unquote(pprM[1]);
    working = (
      working.slice(0, bracketMatch.index) + working.slice((bracketMatch.index ?? 0) + bracketMatch[0].length)
    ).trim();
  }

  let name = working;
  let refBaseSystemUnitPath: string | undefined = undefined;
  const extMatch = working.match(/(?::|\bextends\b)\s*("[^"]*"|'[^']*'|\S+)/i);
  if (extMatch?.[1]) {
    refBaseSystemUnitPath = unquote(extMatch[1]);
    name = unquote(working.slice(0, extMatch.index).trim());
  } else {
    name = unquote(working);
  }

  const finalId = id ?? name;
  const roleRequirements: AmlRoleRequirement[] = [];
  let frame: AmlFrame | undefined = undefined;
  const attributes: AmlAttribute[] = [];
  const interfaces: AmlExternalInterface[] = [];
  const internalLinks: AmlInternalLink[] = [];
  const children: AmlInternalElement[] = [];

  let i = startIdx + 1;
  while (i < endIdx) {
    const line = lines[i]!;
    const t = line.trimmed;
    if (!t || t === "}") {
      i++;
      continue;
    }
    if (/^(?:internalElement|element)\s+/i.test(t) && t.includes("{")) {
      const childEnd = findMatchingCloseBrace(lines, i);
      children.push(parseDslElementBlock(source, lines, i, childEnd));
      i = childEnd + 1;
      continue;
    }
    if (/^attribute\s+/i.test(t)) {
      attributes.push(parseDslAttributeLine(source, line));
    } else if (/^(?:externalInterface|interface|port)\s+/i.test(t)) {
      interfaces.push(parseDslInterfaceLine(source, line, finalId));
    } else if (/^frame\b/i.test(t)) {
      frame = parseDslFrameLine(source, line);
    } else if (/^(?:roleRequirement|roleRequirements|supportedRole)\s+/i.test(t)) {
      roleRequirements.push(parseDslRoleReqLine(source, line));
    } else if (/^(?:internalLink|link)\s+/i.test(t)) {
      internalLinks.push(parseDslLinkLine(source, line));
    }
    i++;
  }

  const pprCategory = inferPprCategory(
    explicitPpr,
    roleRequirements.map((r) => r.refBaseRoleClassPath),
  );

  return {
    id: finalId,
    name,
    refBaseSystemUnitPath,
    roleRequirements,
    pprCategory,
    frame,
    attributes,
    interfaces,
    internalLinks,
    children,
    range: makeRange(source, headerLine.startOffset, endLine.endOffset),
  };
}

function parseDslAml(source: string, uri?: string): AmlDocument {
  const lines = splitLinesWithOffsets(source);
  let fileName = uri ?? "PlantTopology.aml";
  let schemaVersion: AmlSchemaVersion = "2.15";

  const instanceHierarchies: AmlInstanceHierarchy[] = [];
  const systemUnitClassLibs: AmlSystemUnitClassLib[] = [];
  const roleClassLibs: AmlRoleClassLib[] = [];
  const interfaceClassLibs: AmlInterfaceClassLib[] = [];
  const attributeTypeLibs: AmlAttributeTypeLib[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const t = line.trimmed;
    if (!t) {
      i++;
      continue;
    }

    if (/^aml\b/i.test(t)) {
      const nameMatch = t.match(/^aml\s+("[^"]*"|'[^']*'|\S+)/i);
      if (nameMatch?.[1]) fileName = unquote(nameMatch[1]);
      const verMatch = t.match(/\bversion\s+("[^"]*"|'[^']*'|\S+)/i);
      if (verMatch?.[1] && unquote(verMatch[1]).startsWith("3")) {
        schemaVersion = "3.0";
      }
      i++;
      continue;
    }

    if (/^instanceHierarchy\b/i.test(t) && t.includes("{")) {
      const endIdx = findMatchingCloseBrace(lines, i);
      const namePart = t
        .replace(/^instanceHierarchy\s+/i, "")
        .replace(/\{.*$/, "")
        .trim();
      const ihName = unquote(namePart) || "InstanceHierarchy";
      const elements: AmlInternalElement[] = [];
      const topLinks: AmlInternalLink[] = [];

      let j = i + 1;
      while (j < endIdx) {
        const sub = lines[j]!;
        const st = sub.trimmed;
        if (/^(?:internalElement|element)\s+/i.test(st) && st.includes("{")) {
          const elEnd = findMatchingCloseBrace(lines, j);
          elements.push(parseDslElementBlock(source, lines, j, elEnd));
          j = elEnd + 1;
          continue;
        }
        if (/^(?:internalLink|link)\s+/i.test(st)) {
          topLinks.push(parseDslLinkLine(source, sub));
        }
        j++;
      }

      if (topLinks.length > 0 && elements[0]) {
        elements[0].internalLinks.push(...topLinks);
      }

      instanceHierarchies.push({
        name: ihName,
        elements,
        range: makeRange(source, line.startOffset, lines[endIdx]!.endOffset),
      });
      i = endIdx + 1;
      continue;
    }

    if (/^roleClassLib\b/i.test(t) && t.includes("{")) {
      const endIdx = findMatchingCloseBrace(lines, i);
      const libName =
        unquote(
          t
            .replace(/^roleClassLib\s+/i, "")
            .replace(/\{.*$/, "")
            .trim(),
        ) || "RoleClassLib";
      const classes: AmlRoleClass[] = [];

      let j = i + 1;
      while (j < endIdx) {
        const sub = lines[j]!;
        const st = sub.trimmed;
        if (/^roleClass\s+/i.test(st)) {
          const hasBlock = st.includes("{");
          const rcEnd = hasBlock ? findMatchingCloseBrace(lines, j) : j;
          const header = st
            .replace(/^roleClass\s+/i, "")
            .replace(/\{.*$/, "")
            .replace(/;$/, "")
            .trim();
          let rcName = header;
          let refBaseClassPath: string | undefined = undefined;
          const extM = header.match(/(?::|\bextends\b)\s*("[^"]*"|'[^']*'|\S+)/i);
          if (extM?.[1]) {
            refBaseClassPath = unquote(extM[1]);
            rcName = unquote(header.slice(0, extM.index).trim());
          } else {
            rcName = unquote(header);
          }

          const attributes: AmlAttribute[] = [];
          const interfaces: AmlExternalInterface[] = [];
          if (hasBlock) {
            for (let k = j + 1; k < rcEnd; k++) {
              const inner = lines[k]!;
              if (/^attribute\s+/i.test(inner.trimmed)) {
                attributes.push(parseDslAttributeLine(source, inner));
              } else if (/^(?:externalInterface|interface|port)\s+/i.test(inner.trimmed)) {
                interfaces.push(parseDslInterfaceLine(source, inner, rcName));
              }
            }
          }

          classes.push({
            name: rcName,
            refBaseClassPath,
            pprCategory: inferPprCategory(undefined, refBaseClassPath ? [refBaseClassPath, rcName] : [rcName]),
            attributes,
            interfaces,
            children: [],
            range: makeRange(source, sub.startOffset, lines[rcEnd]!.endOffset),
          });
          j = rcEnd + 1;
          continue;
        }
        j++;
      }

      roleClassLibs.push({
        name: libName,
        classes,
        range: makeRange(source, line.startOffset, lines[endIdx]!.endOffset),
      });
      i = endIdx + 1;
      continue;
    }

    if (/^interfaceClassLib\b/i.test(t) && t.includes("{")) {
      const endIdx = findMatchingCloseBrace(lines, i);
      const libName =
        unquote(
          t
            .replace(/^interfaceClassLib\s+/i, "")
            .replace(/\{.*$/, "")
            .trim(),
        ) || "InterfaceClassLib";
      const classes: AmlInterfaceClass[] = [];

      let j = i + 1;
      while (j < endIdx) {
        const sub = lines[j]!;
        const st = sub.trimmed;
        if (/^interfaceClass\s+/i.test(st)) {
          const hasBlock = st.includes("{");
          const icEnd = hasBlock ? findMatchingCloseBrace(lines, j) : j;
          const header = st
            .replace(/^interfaceClass\s+/i, "")
            .replace(/\{.*$/, "")
            .replace(/;$/, "")
            .trim();
          let icName = header;
          let refBaseClassPath: string | undefined = undefined;
          const extM = header.match(/(?::|\bextends\b)\s*("[^"]*"|'[^']*'|\S+)/i);
          if (extM?.[1]) {
            refBaseClassPath = unquote(extM[1]);
            icName = unquote(header.slice(0, extM.index).trim());
          } else {
            icName = unquote(header);
          }

          const attributes: AmlAttribute[] = [];
          let explicitCat: string | undefined = undefined;
          let direction: AmlPortDirection | undefined = undefined;
          if (hasBlock) {
            for (let k = j + 1; k < icEnd; k++) {
              const inner = lines[k]!;
              if (/^attribute\s+/i.test(inner.trimmed)) {
                attributes.push(parseDslAttributeLine(source, inner));
              } else if (/^category\s*:/i.test(inner.trimmed)) {
                explicitCat = inner.trimmed.split(":")[1]?.trim();
              } else if (/^direction\s*:/i.test(inner.trimmed)) {
                direction = normalizeDirection(inner.trimmed.split(":")[1]?.trim());
              }
            }
          }

          classes.push({
            name: icName,
            refBaseClassPath,
            category: inferInterfaceCategory(refBaseClassPath ?? icName, explicitCat),
            direction,
            attributes,
            children: [],
            range: makeRange(source, sub.startOffset, lines[icEnd]!.endOffset),
          });
          j = icEnd + 1;
          continue;
        }
        j++;
      }

      interfaceClassLibs.push({
        name: libName,
        classes,
        range: makeRange(source, line.startOffset, lines[endIdx]!.endOffset),
      });
      i = endIdx + 1;
      continue;
    }

    if (/^systemUnitClassLib\b/i.test(t) && t.includes("{")) {
      const endIdx = findMatchingCloseBrace(lines, i);
      const libName =
        unquote(
          t
            .replace(/^systemUnitClassLib\s+/i, "")
            .replace(/\{.*$/, "")
            .trim(),
        ) || "SystemUnitClassLib";
      const classes: AmlSystemUnitClass[] = [];

      let j = i + 1;
      while (j < endIdx) {
        const sub = lines[j]!;
        const st = sub.trimmed;
        if (/^systemUnitClass\s+/i.test(st)) {
          const hasBlock = st.includes("{");
          const sucEnd = hasBlock ? findMatchingCloseBrace(lines, j) : j;
          const header = st
            .replace(/^systemUnitClass\s+/i, "")
            .replace(/\{.*$/, "")
            .replace(/;$/, "")
            .trim();
          let sucName = header;
          let refBaseClassPath: string | undefined = undefined;
          const extM = header.match(/(?::|\bextends\b)\s*("[^"]*"|'[^']*'|\S+)/i);
          if (extM?.[1]) {
            refBaseClassPath = unquote(extM[1]);
            sucName = unquote(header.slice(0, extM.index).trim());
          } else {
            sucName = unquote(header);
          }

          const supportedRoleClassPaths: string[] = [];
          const attributes: AmlAttribute[] = [];
          const interfaces: AmlExternalInterface[] = [];
          if (hasBlock) {
            for (let k = j + 1; k < sucEnd; k++) {
              const inner = lines[k]!;
              if (/^attribute\s+/i.test(inner.trimmed)) {
                attributes.push(parseDslAttributeLine(source, inner));
              } else if (/^(?:externalInterface|interface|port)\s+/i.test(inner.trimmed)) {
                interfaces.push(parseDslInterfaceLine(source, inner, sucName));
              } else if (/^supportedRole\s+/i.test(inner.trimmed)) {
                supportedRoleClassPaths.push(
                  unquote(
                    inner.trimmed
                      .replace(/^supportedRole\s+/i, "")
                      .replace(/;$/, "")
                      .trim(),
                  ),
                );
              }
            }
          }

          classes.push({
            name: sucName,
            refBaseClassPath,
            supportedRoleClassPaths,
            attributes,
            interfaces,
            internalElements: [],
            internalLinks: [],
            children: [],
            range: makeRange(source, sub.startOffset, lines[sucEnd]!.endOffset),
          });
          j = sucEnd + 1;
          continue;
        }
        j++;
      }

      systemUnitClassLibs.push({
        name: libName,
        classes,
        range: makeRange(source, line.startOffset, lines[endIdx]!.endOffset),
      });
      i = endIdx + 1;
      continue;
    }

    i++;
  }

  return {
    fileName,
    schemaVersion,
    instanceHierarchies,
    systemUnitClassLibs,
    roleClassLibs,
    interfaceClassLibs,
    attributeTypeLibs,
    range: makeRange(source, 0, source.length),
  };
}

/**
 * Parses an IEC 62714 AutomationML document from either CAEX XML or declarative AML DSL text.
 */
export function parseAutomationML(text: string, uri?: string): AmlDocument {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("AutomationML document is empty.");
  }
  if (trimmed.startsWith("<")) {
    return parseCaexXml(text, uri);
  }
  return parseDslAml(text, uri);
}
