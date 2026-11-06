// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseXmlSync, type XmlElement } from "@modelscript/dsl/xml";

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
  startTime?: number | undefined;
  stopTime?: number | undefined;
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

function getAttr(elem: XmlElement, name: string): string | undefined {
  const norm = name.toLowerCase();
  return elem.attributes.find((a) => a.name.toLowerCase() === norm)?.value;
}

function findChild(parent: XmlElement, tag: string): XmlElement | undefined {
  const norm = tag.toLowerCase();
  return parent.children.find((c) => {
    const cName = c.name.toLowerCase();
    return cName === norm || cName.endsWith(`:${norm}`);
  });
}

function findChildren(parent: XmlElement, tag: string): XmlElement[] {
  const norm = tag.toLowerCase();
  return parent.children.filter((c) => {
    const cName = c.name.toLowerCase();
    return cName === norm || cName.endsWith(`:${norm}`);
  });
}

function findDescendant(parent: XmlElement, tag: string): XmlElement | undefined {
  const norm = tag.toLowerCase();
  if (parent.name.toLowerCase() === norm || parent.name.toLowerCase().endsWith(`:${norm}`)) {
    return parent;
  }
  for (const child of parent.children) {
    const found = findDescendant(child, tag);
    if (found) return found;
  }
  return undefined;
}

function findDescendants(parent: XmlElement, tag: string): XmlElement[] {
  const norm = tag.toLowerCase();
  const results: XmlElement[] = [];
  function walk(node: XmlElement) {
    const name = node.name.toLowerCase();
    if (name === norm || name.endsWith(`:${norm}`)) {
      results.push(node);
    }
    for (const child of node.children) {
      walk(child);
    }
  }
  walk(parent);
  return results;
}

export function parseSsd(xml: string): SspSystem {
  const doc = parseXmlSync(xml);
  const root = doc.root;

  const version = root ? (getAttr(root, "version") ?? "1.0") : "1.0";
  const rootName = root ? (getAttr(root, "name") ?? "System") : "System";
  const rootDesc = root ? getAttr(root, "description") : undefined;

  const systemElem = root ? findDescendant(root, "System") : undefined;
  const systemName = (systemElem ? getAttr(systemElem, "name") : undefined) ?? rootName;
  const systemDescription = (systemElem ? getAttr(systemElem, "description") : undefined) ?? rootDesc;

  const components = systemElem ? parseComponents(systemElem) : [];
  const connections = systemElem ? parseConnections(systemElem) : [];
  const parameterBindings = systemElem ? parseParameterBindings(systemElem) : [];
  const defaultExperiment = root ? parseDefaultExperiment(root) : undefined;

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

function parseComponents(systemElem: XmlElement): SspComponent[] {
  const components: SspComponent[] = [];
  const elementsElem = findChild(systemElem, "Elements") ?? systemElem;
  const compElements = findChildren(elementsElem, "Component");

  for (const compElem of compElements) {
    const name = getAttr(compElem, "name") ?? "";
    const type = getAttr(compElem, "type");
    const source = getAttr(compElem, "source") ?? "";
    const connectors = parseConnectors(compElem);
    components.push({ name, type, source, connectors });
  }

  return components;
}

function parseConnectors(compElem: XmlElement): SspConnector[] {
  const connectors: SspConnector[] = [];
  const connectorsElem = findChild(compElem, "Connectors") ?? compElem;
  const connElements = findChildren(connectorsElem, "Connector");

  for (const conn of connElements) {
    const name = getAttr(conn, "name") ?? "";
    const kind = (getAttr(conn, "kind") ?? "input") as SspConnectorKind;

    let type: SspConnectorType = "Real";
    let unit: string | undefined;

    const realChild = findChild(conn, "Real");
    if (realChild) {
      type = "Real";
      unit = getAttr(realChild, "unit");
    } else if (findChild(conn, "Integer")) {
      type = "Integer";
    } else if (findChild(conn, "Boolean")) {
      type = "Boolean";
    } else if (findChild(conn, "String")) {
      type = "String";
    } else if (findChild(conn, "Enumeration")) {
      type = "Enumeration";
    }

    const connector: SspConnector = { name, kind, type };
    if (unit) connector.unit = unit;
    connectors.push(connector);
  }

  return connectors;
}

function parseConnections(systemElem: XmlElement): SspConnection[] {
  const connections: SspConnection[] = [];
  const connectionsElem = findChild(systemElem, "Connections") ?? systemElem;
  const connElements = findChildren(connectionsElem, "Connection");

  for (const conn of connElements) {
    const startElement = getAttr(conn, "startElement") ?? "";
    const startConnector = getAttr(conn, "startConnector") ?? "";
    const endElement = getAttr(conn, "endElement") ?? "";
    const endConnector = getAttr(conn, "endConnector") ?? "";
    connections.push({ startElement, startConnector, endElement, endConnector });
  }

  return connections;
}

function extractParamValue(paramElem: XmlElement): SspParameterValue | null {
  const paramName = getAttr(paramElem, "name") ?? "";

  const realChild = findChild(paramElem, "Real");
  if (realChild) {
    const val = getAttr(realChild, "value");
    if (val !== undefined) return { name: paramName, type: "Real", value: parseFloat(val) };
  }

  const intChild = findChild(paramElem, "Integer");
  if (intChild) {
    const val = getAttr(intChild, "value");
    if (val !== undefined) return { name: paramName, type: "Integer", value: parseInt(val, 10) };
  }

  const boolChild = findChild(paramElem, "Boolean");
  if (boolChild) {
    const val = getAttr(boolChild, "value");
    if (val !== undefined) return { name: paramName, type: "Boolean", value: val === "true" || val === "1" };
  }

  const strChild = findChild(paramElem, "String");
  if (strChild) {
    const val = getAttr(strChild, "value");
    if (val !== undefined) return { name: paramName, type: "String", value: val };
  }

  return null;
}

function parseParameterBindings(systemElem: XmlElement): SspParameterBinding[] {
  const bindings: SspParameterBinding[] = [];
  const bindingsElem = findChild(systemElem, "ParameterBindings") ?? systemElem;
  const bindElements = findChildren(bindingsElem, "ParameterBinding");

  for (const bind of bindElements) {
    const prefix = getAttr(bind, "prefix");
    const source = getAttr(bind, "source");
    const values: SspParameterValue[] = [];

    const paramElements = findDescendants(bind, "Parameter");
    for (const param of paramElements) {
      const val = extractParamValue(param);
      if (val) values.push(val);
    }

    bindings.push({ prefix, source, values });
  }

  return bindings;
}

export function parseSsv(xml: string): SspParameterValue[] {
  const values: SspParameterValue[] = [];
  const doc = parseXmlSync(xml);
  if (!doc.root) return values;

  const paramElements = findDescendants(doc.root, "Parameter");
  for (const param of paramElements) {
    const val = extractParamValue(param);
    if (val) values.push(val);
  }

  return values;
}

function parseDefaultExperiment(root: XmlElement): SspDefaultExperiment | undefined {
  const expElem = findDescendant(root, "DefaultExperiment");
  if (!expElem) return undefined;

  const startTimeStr = getAttr(expElem, "startTime");
  const stopTimeStr = getAttr(expElem, "stopTime");

  const exp: SspDefaultExperiment = {};
  if (startTimeStr !== undefined) exp.startTime = parseFloat(startTimeStr);
  if (stopTimeStr !== undefined) exp.stopTime = parseFloat(stopTimeStr);

  return exp;
}
