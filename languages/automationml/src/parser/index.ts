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
import { parseDslAmlWithCst } from "./aml-dsl-cst.js";

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

const AML_DSL_HELPERS = {
  makeRange,
  parseScalarValue,
  inferInterfaceCategory,
  normalizeDirection,
  inferPprCategory,
};

function parseDslAml(source: string, uri?: string): AmlDocument {
  return parseDslAmlWithCst(source, uri, AML_DSL_HELPERS);
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
