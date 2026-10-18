// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SystemStructure.ssd XML parser for SSP archives.
 *
 * Parses the SSD (System Structure Description) XML format using lightweight,
 * zero-DOM regex-based extraction.
 *
 * @see https://ssp-standard.org/
 */

import type {
  SspComponent,
  SspConnection,
  SspConnector,
  SspConnectorGeometry,
  SspConnectorKind,
  SspConnectorType,
  SspDefaultExperiment,
  SspElementGeometry,
  SspParameterBinding,
  SspParameterValue,
  SspSystem,
} from "./types.js";

// ── Public API ──────────────────────────────────────────────────────

/**
 * Parse a SystemStructure.ssd XML string into an SspSystem.
 *
 * @param xml The raw XML content of SystemStructure.ssd
 * @returns Parsed SSP system structure
 */
export function parseSsd(xml: string): SspSystem {
  const version = extractAttr(xml, "ssd:SystemStructureDescription", "version") ?? "1.0";
  const name = extractAttr(xml, "ssd:SystemStructureDescription", "name") ?? "System";
  const description = extractAttr(xml, "ssd:SystemStructureDescription", "description");

  // Extract the <ssd:System> element
  const systemBlock = extractTagBlock(xml, "ssd:System");
  const systemAttrs = systemBlock?.attrs ?? "";
  const systemBody = systemBlock?.body ?? "";
  const systemBodyOffset = systemBlock?.bodyOffset ?? 0;

  const systemName = extractAttrFromStr(systemAttrs, "name") ?? name;
  const systemDescription = extractAttrFromStr(systemAttrs, "description") ?? description;

  // Parse system geometry if present
  const sysGeomBlock =
    extractTagBlock(systemBody, "ssd:SystemGeometry") ?? extractTagBlock(systemBody, "SystemGeometry");
  const systemGeometry = sysGeomBlock ? parseElementGeometryAttrs(sysGeomBlock.attrs) : undefined;

  // Parse boundary connectors (connectors directly on the system)
  const systemConnectors = parseSystemBoundaryConnectors(systemBody, xml, systemBodyOffset);

  // Parse components
  const components = parseComponents(systemBody, xml, systemBodyOffset);

  // Parse connections
  const connections = parseConnections(systemBody, xml, systemBodyOffset);

  // Parse parameter bindings
  const parameterBindings = parseParameterBindings(systemBody, xml, systemBodyOffset);

  // Parse default experiment
  const defaultExperiment = parseDefaultExperiment(xml);

  return {
    name: systemName,
    description: systemDescription,
    version,
    connectors: systemConnectors,
    components,
    connections,
    parameterBindings,
    defaultExperiment,
    ...(systemGeometry ? { geometry: systemGeometry } : {}),
  };
}

/**
 * Parse SSV (System Structure Parameter Values) XML.
 *
 * @param xml The raw XML content of an .ssv file
 * @param fullXml Optional full XML string for line number calculation
 * @param baseOffset Optional byte offset of `xml` within `fullXml`
 * @returns Array of parameter values
 */
export function parseSsv(xml: string, fullXml: string = xml, baseOffset: number = 0): SspParameterValue[] {
  const values: SspParameterValue[] = [];
  const paramElements = extractTagElements(xml, "ssv:Parameter");

  for (const { attrs, body, startIdx } of paramElements) {
    const paramName = extractAttrFromStr(attrs, "name") ?? "";
    const line = offsetToLine(fullXml, baseOffset + startIdx);

    // Determine type and value
    const realBlock = extractTagBlock(body, "ssv:Real");
    if (realBlock) {
      const val = extractAttrFromStr(realBlock.attrs, "value");
      if (val !== undefined) {
        values.push({ name: paramName, type: "Real", value: parseFloat(val), line });
      }
      continue;
    }

    const intBlock = extractTagBlock(body, "ssv:Integer");
    if (intBlock) {
      const val = extractAttrFromStr(intBlock.attrs, "value");
      if (val !== undefined) {
        values.push({ name: paramName, type: "Integer", value: parseInt(val, 10), line });
      }
      continue;
    }

    const boolBlock = extractTagBlock(body, "ssv:Boolean");
    if (boolBlock) {
      const val = extractAttrFromStr(boolBlock.attrs, "value");
      if (val !== undefined) {
        values.push({ name: paramName, type: "Boolean", value: val === "true" || val === "1", line });
      }
      continue;
    }

    const strBlock = extractTagBlock(body, "ssv:String");
    if (strBlock) {
      const val = extractAttrFromStr(strBlock.attrs, "value");
      if (val !== undefined) {
        values.push({ name: paramName, type: "String", value: val, line });
      }
    }
  }

  return values;
}

// ── Internal parsers ────────────────────────────────────────────────

/**
 * Compute the 1-indexed line number corresponding to `offset` within `xml`.
 */
function offsetToLine(xml: string, offset: number): number {
  let line = 1;
  const end = Math.min(offset, xml.length);
  for (let i = 0; i < end; i++) {
    if (xml.charCodeAt(i) === 10) line++;
  }
  return line;
}

/**
 * Parse `x1`, `y1`, `x2`, `y2`, and optional `rotation` attributes from an `<ssd:ElementGeometry>` or `<ssd:SystemGeometry>` tag.
 */
function parseElementGeometryAttrs(attrs: string): SspElementGeometry | undefined {
  const x1Str = extractAttrFromStr(attrs, "x1");
  const y1Str = extractAttrFromStr(attrs, "y1");
  const x2Str = extractAttrFromStr(attrs, "x2");
  const y2Str = extractAttrFromStr(attrs, "y2");
  if (x1Str === undefined || y1Str === undefined || x2Str === undefined || y2Str === undefined) {
    return undefined;
  }
  const x1 = parseFloat(x1Str);
  const y1 = parseFloat(y1Str);
  const x2 = parseFloat(x2Str);
  const y2 = parseFloat(y2Str);
  if ([x1, y1, x2, y2].some((n) => Number.isNaN(n))) return undefined;
  const rotStr = extractAttrFromStr(attrs, "rotation");
  const rotation = rotStr !== undefined ? parseFloat(rotStr) : undefined;
  return {
    x1,
    y1,
    x2,
    y2,
    ...(rotation !== undefined && !Number.isNaN(rotation) ? { rotation } : {}),
  };
}

/**
 * Parse normalized `x` and `y` coordinates from an `<ssd:ConnectorGeometry>` tag.
 */
function parseConnectorGeometryAttrs(attrs: string): SspConnectorGeometry | undefined {
  const xStr = extractAttrFromStr(attrs, "x");
  const yStr = extractAttrFromStr(attrs, "y");
  if (xStr === undefined || yStr === undefined) return undefined;
  const x = parseFloat(xStr);
  const y = parseFloat(yStr);
  if (Number.isNaN(x) || Number.isNaN(y)) return undefined;
  return { x, y };
}

/**
 * Parse whitespace-separated `pointsX` and `pointsY` waypoint arrays from an `<ssd:ConnectionGeometry>` tag.
 */
function parseConnectionGeometryAttrs(attrs: string): { x: number; y: number }[] | undefined {
  const pxStr = extractAttrFromStr(attrs, "pointsX");
  const pyStr = extractAttrFromStr(attrs, "pointsY");
  if (!pxStr || !pyStr) return undefined;
  const xs = pxStr
    .trim()
    .split(/\s+/)
    .map((s) => parseFloat(s));
  const ys = pyStr
    .trim()
    .split(/\s+/)
    .map((s) => parseFloat(s));
  const len = Math.min(xs.length, ys.length);
  if (len === 0) return undefined;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < len; i++) {
    if (!Number.isNaN(xs[i]!) && !Number.isNaN(ys[i]!)) {
      pts.push({ x: xs[i]!, y: ys[i]! });
    }
  }
  return pts.length > 0 ? pts : undefined;
}

/**
 * Parse top-level system boundary `<ssd:Connectors>` declared prior to `<ssd:Elements>`.
 */
function parseSystemBoundaryConnectors(systemBody: string, fullXml: string, systemBodyOffset: number): SspConnector[] {
  const elementsIdx = systemBody.indexOf("<ssd:Elements>");
  const connectorsBlock = elementsIdx >= 0 ? systemBody.substring(0, elementsIdx) : systemBody;
  return parseConnectors(connectorsBlock, fullXml, systemBodyOffset);
}

/**
 * Parse all `<ssd:Component>` declarations inside `<ssd:Elements>`, including nested connectors and geometry.
 */
function parseComponents(systemBody: string, fullXml: string, systemBodyOffset: number): SspComponent[] {
  const components: SspComponent[] = [];

  // Extract the <ssd:Elements> block
  const elementsBlock = extractTagBlock(systemBody, "ssd:Elements");
  if (!elementsBlock) return components;
  const elementsOffset = systemBodyOffset + elementsBlock.bodyOffset;

  // Parse each <ssd:Component>
  const compElements = extractTagElements(elementsBlock.body, "ssd:Component");
  for (const { attrs, body, startIdx, bodyOffset } of compElements) {
    const compName = extractAttrFromStr(attrs, "name") ?? "";
    const type = extractAttrFromStr(attrs, "type");
    const source = extractAttrFromStr(attrs, "source") ?? "";
    const line = offsetToLine(fullXml, elementsOffset + startIdx);
    const compBodyOffset = elementsOffset + bodyOffset;

    const connectors = parseConnectors(body, fullXml, compBodyOffset);
    const geomBlock = extractTagBlock(body, "ssd:ElementGeometry") ?? extractTagBlock(body, "ElementGeometry");
    const geometry = geomBlock ? parseElementGeometryAttrs(geomBlock.attrs) : undefined;
    const geometryLine = geomBlock ? offsetToLine(fullXml, compBodyOffset + geomBlock.startIdx) : undefined;

    components.push({
      name: compName,
      type,
      source,
      connectors,
      line,
      ...(geometry ? { geometry } : {}),
      ...(geometryLine ? { geometryLine } : {}),
    });
  }

  return components;
}

/**
 * Parse `<ssd:Connector>` elements inside a component or system `<ssd:Connectors>` block.
 */
function parseConnectors(componentBody: string, fullXml: string, baseOffset: number): SspConnector[] {
  const connectors: SspConnector[] = [];

  // Extract the <ssd:Connectors> block
  const connectorsBlock = extractTagBlock(componentBody, "ssd:Connectors");
  if (!connectorsBlock) return connectors;
  const connBlockOffset = baseOffset + connectorsBlock.bodyOffset;

  // Parse each <ssd:Connector>
  const connElements = extractTagElements(connectorsBlock.body, "ssd:Connector");
  for (const { attrs, body, startIdx } of connElements) {
    const connName = extractAttrFromStr(attrs, "name") ?? "";
    const kind = (extractAttrFromStr(attrs, "kind") ?? "input") as SspConnectorKind;
    const line = offsetToLine(fullXml, connBlockOffset + startIdx);

    // Determine scalar type from child element
    let type: SspConnectorType = "Real";
    let unit: string | undefined;

    const realBlock = extractTagBlock(body, "ssc:Real");
    if (realBlock) {
      type = "Real";
      unit = extractAttrFromStr(realBlock.attrs, "unit");
    } else if (body.includes("<ssc:Integer")) {
      type = "Integer";
    } else if (body.includes("<ssc:Boolean")) {
      type = "Boolean";
    } else if (body.includes("<ssc:String")) {
      type = "String";
    } else if (body.includes("<ssc:Enumeration")) {
      type = "Enumeration";
    }

    const geomBlock = extractTagBlock(body, "ssd:ConnectorGeometry") ?? extractTagBlock(body, "ConnectorGeometry");
    const geometry = geomBlock ? parseConnectorGeometryAttrs(geomBlock.attrs) : undefined;

    const connector: SspConnector = { name: connName, kind, type, line };
    if (unit) connector.unit = unit;
    if (geometry) connector.geometry = geometry;
    connectors.push(connector);
  }

  return connectors;
}

/**
 * Parse all `<ssd:Connection>` elements inside `<ssd:Connections>`, including optional routing waypoints.
 */
function parseConnections(systemBody: string, fullXml: string, systemBodyOffset: number): SspConnection[] {
  const connections: SspConnection[] = [];

  // Extract the <ssd:Connections> block
  const connectionsBlock = extractTagBlock(systemBody, "ssd:Connections");
  if (!connectionsBlock) return connections;
  const connsOffset = systemBodyOffset + connectionsBlock.bodyOffset;

  // Parse each <ssd:Connection>
  const connElements = extractTagElements(connectionsBlock.body, "ssd:Connection");
  for (const { attrs, body, startIdx } of connElements) {
    const startElement = extractAttrFromStr(attrs, "startElement") ?? "";
    const startConnector = extractAttrFromStr(attrs, "startConnector") ?? "";
    const endElement = extractAttrFromStr(attrs, "endElement") ?? "";
    const endConnector = extractAttrFromStr(attrs, "endConnector") ?? "";
    const line = offsetToLine(fullXml, connsOffset + startIdx);

    const geomBlock = extractTagBlock(body, "ssd:ConnectionGeometry") ?? extractTagBlock(body, "ConnectionGeometry");
    const points = geomBlock ? parseConnectionGeometryAttrs(geomBlock.attrs) : undefined;

    connections.push({
      startElement,
      startConnector,
      endElement,
      endConnector,
      line,
      ...(points ? { points } : {}),
    });
  }

  return connections;
}

/**
 * Parse `<ssd:ParameterBinding>` elements and any inline `<ssv:Parameter>` values within the system body.
 */
function parseParameterBindings(systemBody: string, fullXml: string, systemBodyOffset: number): SspParameterBinding[] {
  const bindings: SspParameterBinding[] = [];
  const bindElements = extractTagElements(systemBody, "ssd:ParameterBinding");

  for (const { attrs, body, bodyOffset } of bindElements) {
    const prefix = extractAttrFromStr(attrs, "prefix");
    const source = extractAttrFromStr(attrs, "source");

    // Parse inline parameter values if present
    const values: SspParameterValue[] = [];
    if (body) {
      const inlineValues = parseSsv(body, fullXml, systemBodyOffset + bodyOffset);
      values.push(...inlineValues);
    }

    bindings.push({ prefix, source, values });
  }

  return bindings;
}

/**
 * Parse `startTime` and `stopTime` attributes from `<ssd:DefaultExperiment>`.
 */
function parseDefaultExperiment(xml: string): SspDefaultExperiment | undefined {
  const expBlock = extractTagBlock(xml, "ssd:DefaultExperiment") ?? extractTagBlock(xml, "DefaultExperiment");
  if (!expBlock) return undefined;

  const attrs = expBlock.attrs;
  const startTimeStr = extractAttrFromStr(attrs, "startTime");
  const stopTimeStr = extractAttrFromStr(attrs, "stopTime");

  const exp: SspDefaultExperiment = {};
  if (startTimeStr !== undefined) exp.startTime = parseFloat(startTimeStr);
  if (stopTimeStr !== undefined) exp.stopTime = parseFloat(stopTimeStr);

  return exp;
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Check whether `ch` is a valid XML tag-name terminator (whitespace, `>`, `/`, or EOF).
 */
function isTagBoundaryChar(ch: string | undefined): boolean {
  return ch === undefined || ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === ">" || ch === "/";
}

/**
 * Find the byte index of the matching `</tag>` closing tag, accounting for nested `<tag>` elements.
 */
function findMatchingCloseTag(xml: string, tag: string, searchFrom: number): number {
  const openTag = `<${tag}`;
  const closeTag = `</${tag}>`;
  let depth = 1;
  let cursor = searchFrom;
  while (cursor < xml.length && depth > 0) {
    const nextClose = xml.indexOf(closeTag, cursor);
    if (nextClose === -1) return -1;
    let nextOpen = xml.indexOf(openTag, cursor);
    while (nextOpen !== -1 && nextOpen < nextClose) {
      const charAfter = xml[nextOpen + openTag.length];
      if (isTagBoundaryChar(charAfter)) {
        const openEnd = xml.indexOf(">", nextOpen + openTag.length);
        if (openEnd !== -1 && xml[openEnd - 1] !== "/") {
          depth++;
        }
        cursor = openEnd !== -1 ? openEnd + 1 : nextOpen + openTag.length;
      } else {
        cursor = nextOpen + openTag.length;
      }
      nextOpen = xml.indexOf(openTag, cursor);
    }
    depth--;
    if (depth === 0) return nextClose;
    cursor = nextClose + closeTag.length;
  }
  return -1;
}

/**
 * Extract the first occurrence of `<tag ...>...</tag>` (or self-closing `<tag .../>`) from `xml`.
 */
function extractTagBlock(
  xml: string,
  tag: string,
): { attrs: string; body: string; startIdx: number; bodyOffset: number } | null {
  const openTag = `<${tag}`;
  let pos = 0;
  while (pos < xml.length) {
    const startIdx = xml.indexOf(openTag, pos);
    if (startIdx === -1) return null;
    const charAfter = xml[startIdx + openTag.length];
    if (!isTagBoundaryChar(charAfter)) {
      pos = startIdx + openTag.length;
      continue;
    }
    const tagEnd = xml.indexOf(">", startIdx + openTag.length);
    if (tagEnd === -1) return null;
    const isSelfClosing = xml[tagEnd - 1] === "/";
    const rawAttrs = xml.slice(startIdx + openTag.length, tagEnd);
    const attrs = isSelfClosing ? rawAttrs.slice(0, -1).trim() : rawAttrs.trim();
    if (isSelfClosing) {
      return { attrs, body: "", startIdx, bodyOffset: tagEnd + 1 };
    }
    const endIdx = findMatchingCloseTag(xml, tag, tagEnd + 1);
    if (endIdx === -1) {
      return { attrs, body: "", startIdx, bodyOffset: tagEnd + 1 };
    }
    const body = xml.slice(tagEnd + 1, endIdx);
    return { attrs, body, startIdx, bodyOffset: tagEnd + 1 };
  }
  return null;
}

/**
 * Extract all sequential occurrences of `<tag ...>...</tag>` (or `<tag .../>`) within `xml`.
 */
function extractTagElements(
  xml: string,
  tag: string,
): { attrs: string; body: string; startIdx: number; bodyOffset: number }[] {
  const result: { attrs: string; body: string; startIdx: number; bodyOffset: number }[] = [];
  const openTag = `<${tag}`;
  const closeTag = `</${tag}>`;
  let pos = 0;
  while (pos < xml.length) {
    const startIdx = xml.indexOf(openTag, pos);
    if (startIdx === -1) break;
    const charAfter = xml[startIdx + openTag.length];
    if (!isTagBoundaryChar(charAfter)) {
      pos = startIdx + openTag.length;
      continue;
    }
    const tagEnd = xml.indexOf(">", startIdx + openTag.length);
    if (tagEnd === -1) break;
    const isSelfClosing = xml[tagEnd - 1] === "/";
    const rawAttrs = xml.slice(startIdx + openTag.length, tagEnd);
    const attrs = isSelfClosing ? rawAttrs.slice(0, -1).trim() : rawAttrs.trim();
    if (isSelfClosing) {
      result.push({ attrs, body: "", startIdx, bodyOffset: tagEnd + 1 });
      pos = tagEnd + 1;
    } else {
      const endIdx = findMatchingCloseTag(xml, tag, tagEnd + 1);
      if (endIdx === -1) {
        result.push({ attrs, body: "", startIdx, bodyOffset: tagEnd + 1 });
        pos = tagEnd + 1;
      } else {
        result.push({ attrs, body: xml.slice(tagEnd + 1, endIdx), startIdx, bodyOffset: tagEnd + 1 });
        pos = endIdx + closeTag.length;
      }
    }
  }
  return result;
}

/**
 * Extract a named XML attribute value from the first occurrence of `<element>` in `xml`.
 */
function extractAttr(xml: string, element: string, attr: string): string | undefined {
  const block = extractTagBlock(xml, element);
  if (!block) return undefined;
  return extractAttrFromStr(block.attrs, attr);
}

/**
 * Extract a single- or double-quoted XML attribute value from a raw attribute string.
 */
function extractAttrFromStr(attrs: string, attr: string): string | undefined {
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = attrs.match(new RegExp(`\\b${escaped}\\s*=\\s*"([^"]*)"`));
  if (match) return match[1];
  const singleMatch = attrs.match(new RegExp(`\\b${escaped}\\s*=\\s*'([^']*)'`));
  return singleMatch ? singleMatch[1] : undefined;
}
