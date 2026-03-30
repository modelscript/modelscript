// SPDX-License-Identifier: AGPL-3.0-or-later

export type SspConnectorKind = "input" | "output" | "inout" | "parameter" | "calculatedParameter";
export type SspConnectorType = "Real" | "Integer" | "Boolean" | "String" | "Enumeration";

export interface SspConnector {
  name: string;
  kind: SspConnectorKind;
  type: SspConnectorType;
  unit?: string | undefined;
}

export interface SspComponent {
  name: string;
  type?: string | undefined;
  source: string;
  connectors: SspConnector[];
}

export interface SspConnection {
  startElement: string;
  startConnector: string;
  endElement: string;
  endConnector: string;
}

export interface SspParameterValue {
  name: string;
  type: SspConnectorType;
  value: number | string | boolean;
}

export interface SspParameterBinding {
  prefix?: string | undefined;
  source?: string | undefined;
  values: SspParameterValue[];
}

export interface SspDefaultExperiment {
  startTime?: number;
  stopTime?: number;
}

export interface SspSystem {
  name: string;
  description?: string | undefined;
  version: string;
  components: SspComponent[];
  connections: SspConnection[];
  parameterBindings: SspParameterBinding[];
  defaultExperiment?: SspDefaultExperiment | undefined;
}

export function parseSsd(xml: string): SspSystem {
  const version = extractAttr(xml, "ssd:SystemStructureDescription", "version") ?? "1.0";
  const name = extractAttr(xml, "ssd:SystemStructureDescription", "name") ?? "System";
  const description = extractAttr(xml, "ssd:SystemStructureDescription", "description");

  const systemMatch = xml.match(/<ssd:System\s+([^>]*)>([\s\S]*?)<\/ssd:System>/);
  const systemAttrs = systemMatch?.[1] ?? "";
  const systemBody = systemMatch?.[2] ?? "";

  const systemName = extractAttrFromStr(systemAttrs, "name") ?? name;
  const systemDescription = extractAttrFromStr(systemAttrs, "description") ?? description;

  const components = parseComponents(systemBody);
  const connections = parseConnections(systemBody);
  const parameterBindings = parseParameterBindings(systemBody);
  const defaultExperiment = parseDefaultExperiment(xml);

  return {
    name: systemName,
    description: systemDescription,
    version,
    components,
    connections,
    parameterBindings,
    defaultExperiment,
  };
}

export function parseSsv(xml: string): SspParameterValue[] {
  const values: SspParameterValue[] = [];
  const paramRegex = /<ssv:Parameter\s+([^>]*)>([\s\S]*?)<\/ssv:Parameter>/g;
  let match: RegExpExecArray | null;

  while ((match = paramRegex.exec(xml)) !== null) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const paramName = extractAttrFromStr(attrs, "name") ?? "";

    const realMatch = body.match(/<ssv:Real\s+([^>]*)\/?>/);
    if (realMatch) {
      const val = extractAttrFromStr(realMatch[1] ?? "", "value");
      if (val !== undefined) values.push({ name: paramName, type: "Real", value: parseFloat(val) });
      continue;
    }

    const intMatch = body.match(/<ssv:Integer\s+([^>]*)\/?>/);
    if (intMatch) {
      const val = extractAttrFromStr(intMatch[1] ?? "", "value");
      if (val !== undefined) values.push({ name: paramName, type: "Integer", value: parseInt(val, 10) });
      continue;
    }

    const boolMatch = body.match(/<ssv:Boolean\s+([^>]*)\/?>/);
    if (boolMatch) {
      const val = extractAttrFromStr(boolMatch[1] ?? "", "value");
      if (val !== undefined) values.push({ name: paramName, type: "Boolean", value: val === "true" || val === "1" });
      continue;
    }

    const strMatch = body.match(/<ssv:String\s+([^>]*)\/?>/);
    if (strMatch) {
      const val = extractAttrFromStr(strMatch[1] ?? "", "value");
      if (val !== undefined) values.push({ name: paramName, type: "String", value: val });
    }
  }

  return values;
}

function parseComponents(systemBody: string): SspComponent[] {
  const components: SspComponent[] = [];
  const elementsMatch = systemBody.match(/<ssd:Elements>([\s\S]*?)<\/ssd:Elements>/);
  if (!elementsMatch) return components;
  const elementsBody = elementsMatch[1] ?? "";

  const compRegex = /<ssd:Component\s+([^>]*)>([\s\S]*?)<\/ssd:Component>|<ssd:Component\s+([^>]*)\/?>/g;
  let match: RegExpExecArray | null;

  while ((match = compRegex.exec(elementsBody)) !== null) {
    const attrs = match[1] ?? match[3] ?? "";
    const body = match[2] ?? "";
    const compName = extractAttrFromStr(attrs, "name") ?? "";
    const type = extractAttrFromStr(attrs, "type");
    const source = extractAttrFromStr(attrs, "source") ?? "";
    const connectors = parseConnectors(body);
    components.push({ name: compName, type, source, connectors });
  }
  return components;
}

function parseConnectors(componentBody: string): SspConnector[] {
  const connectors: SspConnector[] = [];
  const connectorsMatch = componentBody.match(/<ssd:Connectors>([\s\S]*?)<\/ssd:Connectors>/);
  if (!connectorsMatch) return connectors;
  const connectorsBody = connectorsMatch[1] ?? "";

  const connRegex = /<ssd:Connector\s+([^>]*)>([\s\S]*?)<\/ssd:Connector>|<ssd:Connector\s+([^>]*)\/?>/g;
  let match: RegExpExecArray | null;

  while ((match = connRegex.exec(connectorsBody)) !== null) {
    const attrs = match[1] ?? match[3] ?? "";
    const body = match[2] ?? "";
    const connName = extractAttrFromStr(attrs, "name") ?? "";
    const kind = (extractAttrFromStr(attrs, "kind") ?? "input") as SspConnectorKind;

    let type: SspConnectorType = "Real";
    let unit: string | undefined;

    if (body.match(/<ssc:Real/)) {
      type = "Real";
      const realMatch = body.match(/<ssc:Real\s+([^>]*)\/?>/);
      if (realMatch) unit = extractAttrFromStr(realMatch[1] ?? "", "unit");
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
      values.push(...parseSsv(body));
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
