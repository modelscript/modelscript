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
  const systemMatch = xml.match(/<ssd:System\s+([^>]*)>([\s\S]*?)<\/ssd:System>/);
  const systemAttrs = systemMatch?.[1] ?? "";
  const systemBody = systemMatch?.[2] ?? "";

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
  const paramRegex = /<ssv:Parameter\s+([^>]*)>([\s\S]*?)<\/ssv:Parameter>/g;
  let match: RegExpExecArray | null;

  while ((match = paramRegex.exec(xml)) !== null) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const paramName = extractAttrFromStr(attrs, "name") ?? "";

    // Determine type and value
    const realMatch = body.match(/<ssv:Real\s+([^>]*)\/?>/);
    if (realMatch) {
      const val = extractAttrFromStr(realMatch[1] ?? "", "value");
      if (val !== undefined) {
        values.push({ name: paramName, type: "Real", value: parseFloat(val) });
      }
      continue;
    }

    const intMatch = body.match(/<ssv:Integer\s+([^>]*)\/?>/);
    if (intMatch) {
      const val = extractAttrFromStr(intMatch[1] ?? "", "value");
      if (val !== undefined) {
        values.push({ name: paramName, type: "Integer", value: parseInt(val, 10) });
      }
      continue;
    }

    const boolMatch = body.match(/<ssv:Boolean\s+([^>]*)\/?>/);
    if (boolMatch) {
      const val = extractAttrFromStr(boolMatch[1] ?? "", "value");
      if (val !== undefined) {
        values.push({ name: paramName, type: "Boolean", value: val === "true" || val === "1" });
      }
      continue;
    }

    const strMatch = body.match(/<ssv:String\s+([^>]*)\/?>/);
    if (strMatch) {
      const val = extractAttrFromStr(strMatch[1] ?? "", "value");
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
  const elementsMatch = systemBody.match(/<ssd:Elements>([\s\S]*?)<\/ssd:Elements>/);
  if (!elementsMatch) return components;
  const elementsBody = elementsMatch[1] ?? "";

  // Parse each <ssd:Component>
  const compRegex = /<ssd:Component\s+([^>]*)>([\s\S]*?)<\/ssd:Component>|<ssd:Component\s+([^>]*)\/?>/g;
  let match: RegExpExecArray | null;

  while ((match = compRegex.exec(elementsBody)) !== null) {
    const attrs = match[1] ?? match[3] ?? "";
    const body = match[2] ?? "";

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

function parseConnectors(bodyText: string): SspConnector[] {
  const connectors: SspConnector[] = [];

  const connectorsMatch = bodyText.match(/<ssd:Connectors>([\s\S]*?)<\/ssd:Connectors>/);
  if (!connectorsMatch) return connectors;
  const connectorsBody = connectorsMatch[1] ?? "";

  const connRegex = /<ssd:Connector\s+([^>]*)>([\s\S]*?)<\/ssd:Connector>|<ssd:Connector\s+([^>]*)\/?>/g;
  let match: RegExpExecArray | null;

  while ((match = connRegex.exec(connectorsBody)) !== null) {
    const attrs = match[1] ?? match[3] ?? "";
    const body = match[2] ?? "";

    const connName = extractAttrFromStr(attrs, "name") ?? "";
    const kind = (extractAttrFromStr(attrs, "kind") ?? "input") as SspConnectorKind;

    // Determine scalar type from child element
    let type: SspConnectorType = "Real";
    let unit: string | undefined;

    if (body.match(/<ssc:Real/)) {
      type = "Real";
      const realMatch = body.match(/<ssc:Real\s+([^>]*)\/?>/);
      if (realMatch) {
        unit = extractAttrFromStr(realMatch[1] ?? "", "unit");
      }
    } else if (body.match(/<ssc:Integer/)) {
      type = "Integer";
    } else if (body.match(/<ssc:Boolean/)) {
      type = "Boolean";
    } else if (body.match(/<ssc:String/)) {
      type = "String";
    } else if (body.match(/<ssc:Enumeration/)) {
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

  const connectionsMatch = systemBody.match(/<ssd:Connections>([\s\S]*?)<\/ssd:Connections>/);
  if (!connectionsMatch) return connections;
  const connectionsBody = connectionsMatch[1] ?? "";

  const connRegex = /<ssd:Connection\s+([^>]*)\/?>/g;
  let match: RegExpExecArray | null;

  while ((match = connRegex.exec(connectionsBody)) !== null) {
    const attrs = match[1] ?? "";

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

  const bindRegex =
    /<ssd:ParameterBinding\s+([^>]*)>([\s\S]*?)<\/ssd:ParameterBinding>|<ssd:ParameterBinding\s+([^>]*)\/?>/g;
  let match: RegExpExecArray | null;

  while ((match = bindRegex.exec(systemBody)) !== null) {
    const attrs = match[1] ?? match[3] ?? "";
    const body = match[2] ?? "";

    const prefix = extractAttrFromStr(attrs, "prefix");
    const source = extractAttrFromStr(attrs, "source");

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
  const expMatch = xml.match(/<ssd:DefaultExperiment\s+([^>]*)\/?>/);
  if (!expMatch) return undefined;

  const attrs = expMatch[1] ?? "";
  const startTimeStr = extractAttrFromStr(attrs, "startTime");
  const stopTimeStr = extractAttrFromStr(attrs, "stopTime");

  const exp: SspDefaultExperiment = {};
  if (startTimeStr !== undefined) exp.startTime = parseFloat(startTimeStr);
  if (stopTimeStr !== undefined) exp.stopTime = parseFloat(stopTimeStr);

  return exp;
}

// ── Helpers ─────────────────────────────────────────────────────────

function extractAttr(xml: string, element: string, attr: string): string | undefined {
  const escapedElement = element.replace(/\./g, "\\.");
  const elemMatch = xml.match(new RegExp(`<${escapedElement}\\s+([^>]*)>`, "s"));
  if (!elemMatch) return undefined;
  return extractAttrFromStr(elemMatch[1] ?? "", attr);
}

function extractAttrFromStr(attrs: string, attr: string): string | undefined {
  const match = attrs.match(new RegExp(`${attr}\\s*=\\s*"([^"]*)"`, "s"));
  return match ? (match[1] ?? undefined) : undefined;
}
