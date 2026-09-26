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
  SspConnectorKind,
  SspConnectorType,
  SspDefaultExperiment,
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

  const systemName = extractAttrFromStr(systemAttrs, "name") ?? name;
  const systemDescription = extractAttrFromStr(systemAttrs, "description") ?? description;

  // Parse boundary connectors (connectors directly on the system)
  const systemConnectors = parseSystemBoundaryConnectors(systemBody);

  // Parse components
  const components = parseComponents(systemBody);

  // Parse connections
  const connections = parseConnections(systemBody);

  // Parse parameter bindings
  const parameterBindings = parseParameterBindings(systemBody);

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
  };
}

/**
 * Parse SSV (System Structure Parameter Values) XML.
 *
 * @param xml The raw XML content of an .ssv file
 * @returns Array of parameter values
 */
export function parseSsv(xml: string): SspParameterValue[] {
  const values: SspParameterValue[] = [];
  const paramElements = extractTagElements(xml, "ssv:Parameter");

  for (const { attrs, body } of paramElements) {
    const paramName = extractAttrFromStr(attrs, "name") ?? "";

    // Determine type and value
    const realBlock = extractTagBlock(body, "ssv:Real");
    if (realBlock) {
      const val = extractAttrFromStr(realBlock.attrs, "value");
      if (val !== undefined) {
        values.push({ name: paramName, type: "Real", value: parseFloat(val) });
      }
      continue;
    }

    const intBlock = extractTagBlock(body, "ssv:Integer");
    if (intBlock) {
      const val = extractAttrFromStr(intBlock.attrs, "value");
      if (val !== undefined) {
        values.push({ name: paramName, type: "Integer", value: parseInt(val, 10) });
      }
      continue;
    }

    const boolBlock = extractTagBlock(body, "ssv:Boolean");
    if (boolBlock) {
      const val = extractAttrFromStr(boolBlock.attrs, "value");
      if (val !== undefined) {
        values.push({ name: paramName, type: "Boolean", value: val === "true" || val === "1" });
      }
      continue;
    }

    const strBlock = extractTagBlock(body, "ssv:String");
    if (strBlock) {
      const val = extractAttrFromStr(strBlock.attrs, "value");
      if (val !== undefined) {
        values.push({ name: paramName, type: "String", value: val });
      }
    }
  }

  return values;
}

// ── Internal parsers ────────────────────────────────────────────────

function parseSystemBoundaryConnectors(systemBody: string): SspConnector[] {
  const elementsIdx = systemBody.indexOf("<ssd:Elements>");
  const connectorsBlock = elementsIdx >= 0 ? systemBody.substring(0, elementsIdx) : systemBody;
  return parseConnectors(connectorsBlock);
}

function parseComponents(systemBody: string): SspComponent[] {
  const components: SspComponent[] = [];

  // Extract the <ssd:Elements> block
  const elementsBlock = extractTagBlock(systemBody, "ssd:Elements");
  if (!elementsBlock) return components;

  // Parse each <ssd:Component>
  const compElements = extractTagElements(elementsBlock.body, "ssd:Component");
  for (const { attrs, body } of compElements) {
    const compName = extractAttrFromStr(attrs, "name") ?? "";
    const type = extractAttrFromStr(attrs, "type");
    const source = extractAttrFromStr(attrs, "source") ?? "";

    const connectors = parseConnectors(body);

    components.push({
      name: compName,
      type,
      source,
      connectors,
    });
  }

  return components;
}

function parseConnectors(componentBody: string): SspConnector[] {
  const connectors: SspConnector[] = [];

  // Extract the <ssd:Connectors> block
  const connectorsBlock = extractTagBlock(componentBody, "ssd:Connectors");
  if (!connectorsBlock) return connectors;

  // Parse each <ssd:Connector>
  const connElements = extractTagElements(connectorsBlock.body, "ssd:Connector");
  for (const { attrs, body } of connElements) {
    const connName = extractAttrFromStr(attrs, "name") ?? "";
    const kind = (extractAttrFromStr(attrs, "kind") ?? "input") as SspConnectorKind;

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

    const connector: SspConnector = { name: connName, kind, type };
    if (unit) connector.unit = unit;
    connectors.push(connector);
  }

  return connectors;
}

function parseConnections(systemBody: string): SspConnection[] {
  const connections: SspConnection[] = [];

  // Extract the <ssd:Connections> block
  const connectionsBlock = extractTagBlock(systemBody, "ssd:Connections");
  if (!connectionsBlock) return connections;

  // Parse each <ssd:Connection>
  const connElements = extractTagElements(connectionsBlock.body, "ssd:Connection");
  for (const { attrs } of connElements) {
    const startElement = extractAttrFromStr(attrs, "startElement") ?? "";
    const startConnector = extractAttrFromStr(attrs, "startConnector") ?? "";
    const endElement = extractAttrFromStr(attrs, "endElement") ?? "";
    const endConnector = extractAttrFromStr(attrs, "endConnector") ?? "";

    connections.push({ startElement, startConnector, endElement, endConnector });
  }

  return connections;
}

function parseParameterBindings(systemBody: string): SspParameterBinding[] {
  const bindings: SspParameterBinding[] = [];
  const bindElements = extractTagElements(systemBody, "ssd:ParameterBinding");

  for (const { attrs, body } of bindElements) {
    const prefix = extractAttrFromStr(attrs, "prefix");
    const source = extractAttrFromStr(attrs, "source");

    // Parse inline parameter values if present
    const values: SspParameterValue[] = [];
    if (body) {
      const inlineValues = parseSsv(body);
      values.push(...inlineValues);
    }

    bindings.push({ prefix, source, values });
  }

  return bindings;
}

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

function extractTagBlock(xml: string, tag: string): { attrs: string; body: string } | null {
  const openTag = `<${tag}`;
  let pos = 0;
  while (pos < xml.length) {
    const startIdx = xml.indexOf(openTag, pos);
    if (startIdx === -1) return null;
    const charAfter = xml[startIdx + openTag.length];
    if (
      charAfter !== undefined &&
      charAfter !== " " &&
      charAfter !== "\t" &&
      charAfter !== "\r" &&
      charAfter !== "\n" &&
      charAfter !== ">" &&
      charAfter !== "/"
    ) {
      pos = startIdx + openTag.length;
      continue;
    }
    const tagEnd = xml.indexOf(">", startIdx + openTag.length);
    if (tagEnd === -1) return null;
    const isSelfClosing = xml[tagEnd - 1] === "/";
    const rawAttrs = xml.slice(startIdx + openTag.length, tagEnd);
    const attrs = isSelfClosing ? rawAttrs.slice(0, -1).trim() : rawAttrs.trim();
    if (isSelfClosing) {
      return { attrs, body: "" };
    }
    const closeTag = `</${tag}>`;
    const endIdx = xml.indexOf(closeTag, tagEnd + 1);
    if (endIdx === -1) {
      return { attrs, body: "" };
    }
    const body = xml.slice(tagEnd + 1, endIdx);
    return { attrs, body };
  }
  return null;
}

function extractTagElements(xml: string, tag: string): { attrs: string; body: string }[] {
  const result: { attrs: string; body: string }[] = [];
  const openTag = `<${tag}`;
  const closeTag = `</${tag}>`;
  let pos = 0;
  while (pos < xml.length) {
    const startIdx = xml.indexOf(openTag, pos);
    if (startIdx === -1) break;
    const charAfter = xml[startIdx + openTag.length];
    if (
      charAfter !== undefined &&
      charAfter !== " " &&
      charAfter !== "\t" &&
      charAfter !== "\r" &&
      charAfter !== "\n" &&
      charAfter !== ">" &&
      charAfter !== "/"
    ) {
      pos = startIdx + openTag.length;
      continue;
    }
    const tagEnd = xml.indexOf(">", startIdx + openTag.length);
    if (tagEnd === -1) break;
    const isSelfClosing = xml[tagEnd - 1] === "/";
    const rawAttrs = xml.slice(startIdx + openTag.length, tagEnd);
    const attrs = isSelfClosing ? rawAttrs.slice(0, -1).trim() : rawAttrs.trim();
    if (isSelfClosing) {
      result.push({ attrs, body: "" });
      pos = tagEnd + 1;
    } else {
      const endIdx = xml.indexOf(closeTag, tagEnd + 1);
      if (endIdx === -1) {
        result.push({ attrs, body: "" });
        pos = tagEnd + 1;
      } else {
        result.push({ attrs, body: xml.slice(tagEnd + 1, endIdx) });
        pos = endIdx + closeTag.length;
      }
    }
  }
  return result;
}

function extractAttr(xml: string, element: string, attr: string): string | undefined {
  const block = extractTagBlock(xml, element);
  if (!block) return undefined;
  return extractAttrFromStr(block.attrs, attr);
}

function extractAttrFromStr(attrs: string, attr: string): string | undefined {
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = attrs.match(new RegExp(`\\b${escaped}\\s*=\\s*"([^"]*)"`));
  if (match) return match[1];
  const singleMatch = attrs.match(new RegExp(`\\b${escaped}\\s*=\\s*'([^']*)'`));
  return singleMatch ? singleMatch[1] : undefined;
}
