// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SystemStructure.ssd XML parser for SSP archives.
 *
 * Parses the SSD (System Structure Description) and SSV (Parameter Values)
 * XML formats using the high-performance @modelscript/dsl/xml CST parser.
 *
 * @see https://ssp-standard.org/
 */

import { parseXmlSync, type XmlElement } from "@modelscript/dsl/xml";
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
  SspParameterMapping,
  SspParameterMappingEntry,
  SspParameterValue,
  SspSignalDictionary,
  SspSignalDictionaryEntry,
  SspSystem,
} from "./types.js";

// ── XML CST Helpers ──────────────────────────────────────────────────

function localName(name: string): string {
  const idx = name.indexOf(":");
  return idx >= 0 ? name.slice(idx + 1) : name;
}

function matchName(actual: string, expected: string): boolean {
  return actual === expected || localName(actual) === localName(expected);
}

function getAttr(el: XmlElement, name: string): string | undefined {
  const attr = el.attributes.find((a) => matchName(a.name, name));
  return attr?.value;
}

function getChild(el: XmlElement | null | undefined, name: string): XmlElement | undefined {
  if (!el) return undefined;
  return el.children.find((c) => matchName(c.name, name));
}

function getChildren(el: XmlElement | null | undefined, name: string): XmlElement[] {
  if (!el) return [];
  return el.children.filter((c) => matchName(c.name, name));
}

function findDescendants(el: XmlElement, predicate: (e: XmlElement) => boolean): XmlElement[] {
  const results: XmlElement[] = [];
  function walk(node: XmlElement) {
    if (predicate(node)) {
      results.push(node);
    }
    for (const child of node.children) {
      walk(child);
    }
  }
  walk(el);
  return results;
}

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

function offsetToLine(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (lineStarts[mid]! <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return Math.max(0, low - 1) + 1;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Parse a SystemStructure.ssd XML string into an SspSystem.
 *
 * @param xml The raw XML content of SystemStructure.ssd
 * @returns Parsed SSP system structure
 */
export function parseSsd(xml: string): SspSystem {
  const doc = parseXmlSync(xml);
  const root = doc.root;

  const version = root ? (getAttr(root, "version") ?? "1.0") : "1.0";
  const name = root ? (getAttr(root, "name") ?? "System") : "System";
  const description = root ? getAttr(root, "description") : undefined;

  const lineStarts = computeLineStarts(xml);

  // Extract the <ssd:System> element
  const systemEl = getChild(root, "System");

  const systemName = (systemEl ? getAttr(systemEl, "name") : undefined) ?? name;
  const systemDescription = (systemEl ? getAttr(systemEl, "description") : undefined) ?? description;

  // Parse system geometry if present
  const sysGeomEl = getChild(systemEl, "SystemGeometry");
  const systemGeometry = sysGeomEl ? parseElementGeometryAttrs(sysGeomEl) : undefined;

  // Parse boundary connectors (declared directly under <ssd:System>)
  const systemConnectors = systemEl ? parseSystemBoundaryConnectors(systemEl, lineStarts) : [];

  // Parse components (<ssd:Elements>)
  const components = systemEl ? parseComponents(systemEl, lineStarts) : [];

  // Parse connections (<ssd:Connections>)
  const connections = systemEl ? parseConnections(systemEl, lineStarts) : [];

  // Parse parameter bindings (<ssd:ParameterBinding>)
  const parameterBindings = systemEl ? parseParameterBindings(systemEl, lineStarts) : [];

  // Parse default experiment
  const defaultExperiment = parseDefaultExperiment(root, systemEl);

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
  const doc = parseXmlSync(xml);
  const values: SspParameterValue[] = [];
  if (!doc.root) return values;

  const fullLineStarts = computeLineStarts(fullXml);
  const paramElements = findDescendants(doc.root, (e) => matchName(e.name, "Parameter"));

  for (const paramEl of paramElements) {
    const paramName = getAttr(paramEl, "name") ?? "";
    const line = offsetToLine(fullLineStarts, baseOffset + paramEl.start);

    // Determine type and value from child element
    const realEl = getChild(paramEl, "Real");
    if (realEl) {
      const val = getAttr(realEl, "value");
      if (val !== undefined) {
        values.push({ name: paramName, type: "Real", value: parseFloat(val), line });
      }
      continue;
    }

    const intEl = getChild(paramEl, "Integer");
    if (intEl) {
      const val = getAttr(intEl, "value");
      if (val !== undefined) {
        values.push({ name: paramName, type: "Integer", value: parseInt(val, 10), line });
      }
      continue;
    }

    const boolEl = getChild(paramEl, "Boolean");
    if (boolEl) {
      const val = getAttr(boolEl, "value");
      if (val !== undefined) {
        values.push({ name: paramName, type: "Boolean", value: val === "true" || val === "1", line });
      }
      continue;
    }

    const strEl = getChild(paramEl, "String");
    if (strEl) {
      const val = getAttr(strEl, "value");
      if (val !== undefined) {
        values.push({ name: paramName, type: "String", value: val, line });
      }
    }
  }

  return values;
}

// ── Internal CST Parsers ────────────────────────────────────────────

function parseElementGeometryAttrs(el: XmlElement): SspElementGeometry | undefined {
  const x1Str = getAttr(el, "x1");
  const y1Str = getAttr(el, "y1");
  const x2Str = getAttr(el, "x2");
  const y2Str = getAttr(el, "y2");
  if (x1Str === undefined || y1Str === undefined || x2Str === undefined || y2Str === undefined) {
    return undefined;
  }
  const x1 = parseFloat(x1Str);
  const y1 = parseFloat(y1Str);
  const x2 = parseFloat(x2Str);
  const y2 = parseFloat(y2Str);
  if ([x1, y1, x2, y2].some((n) => Number.isNaN(n))) return undefined;
  const rotStr = getAttr(el, "rotation");
  const rotation = rotStr !== undefined ? parseFloat(rotStr) : undefined;
  return {
    x1,
    y1,
    x2,
    y2,
    ...(rotation !== undefined && !Number.isNaN(rotation) ? { rotation } : {}),
  };
}

function parseConnectorGeometryAttrs(el: XmlElement): SspConnectorGeometry | undefined {
  const xStr = getAttr(el, "x");
  const yStr = getAttr(el, "y");
  if (xStr === undefined || yStr === undefined) return undefined;
  const x = parseFloat(xStr);
  const y = parseFloat(yStr);
  if (Number.isNaN(x) || Number.isNaN(y)) return undefined;
  return { x, y };
}

function parseConnectionGeometryAttrs(el: XmlElement): { x: number; y: number }[] | undefined {
  const pxStr = getAttr(el, "pointsX");
  const pyStr = getAttr(el, "pointsY");
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

function parseConnectors(connectorsEl: XmlElement, lineStarts: number[]): SspConnector[] {
  const connectors: SspConnector[] = [];
  const connElements = getChildren(connectorsEl, "Connector");

  for (const connEl of connElements) {
    const connName = getAttr(connEl, "name") ?? "";
    const kind = (getAttr(connEl, "kind") ?? "input") as SspConnectorKind;
    const line = offsetToLine(lineStarts, connEl.start);

    // Determine scalar type from child element
    let type: SspConnectorType = "Real";
    let unit: string | undefined;

    const realEl = getChild(connEl, "Real");
    if (realEl) {
      type = "Real";
      unit = getAttr(realEl, "unit");
    } else if (getChild(connEl, "Integer")) {
      type = "Integer";
    } else if (getChild(connEl, "Boolean")) {
      type = "Boolean";
    } else if (getChild(connEl, "String")) {
      type = "String";
    } else if (getChild(connEl, "Enumeration")) {
      type = "Enumeration";
    }

    const geomEl = getChild(connEl, "ConnectorGeometry");
    const geometry = geomEl ? parseConnectorGeometryAttrs(geomEl) : undefined;

    const connector: SspConnector = { name: connName, kind, type, line };
    if (unit) connector.unit = unit;
    if (geometry) connector.geometry = geometry;
    connectors.push(connector);
  }

  return connectors;
}

function parseSystemBoundaryConnectors(systemEl: XmlElement, lineStarts: number[]): SspConnector[] {
  const connectorsEl = getChild(systemEl, "Connectors");
  if (!connectorsEl) return [];
  return parseConnectors(connectorsEl, lineStarts);
}

function parseComponents(systemEl: XmlElement, lineStarts: number[]): SspComponent[] {
  const components: SspComponent[] = [];
  const elementsEl = getChild(systemEl, "Elements");
  if (!elementsEl) return components;

  const compElements = getChildren(elementsEl, "Component");
  for (const compEl of compElements) {
    const compName = getAttr(compEl, "name") ?? "";
    const type = getAttr(compEl, "type");
    const source = getAttr(compEl, "source") ?? "";
    const line = offsetToLine(lineStarts, compEl.start);

    const connectorsEl = getChild(compEl, "Connectors");
    const connectors = connectorsEl ? parseConnectors(connectorsEl, lineStarts) : [];

    const geomEl = getChild(compEl, "ElementGeometry");
    const geometry = geomEl ? parseElementGeometryAttrs(geomEl) : undefined;
    const geometryLine = geomEl ? offsetToLine(lineStarts, geomEl.start) : undefined;

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

function parseConnections(systemEl: XmlElement, lineStarts: number[]): SspConnection[] {
  const connections: SspConnection[] = [];
  const connectionsEl = getChild(systemEl, "Connections");
  if (!connectionsEl) return connections;

  const connElements = getChildren(connectionsEl, "Connection");
  for (const connEl of connElements) {
    const startElement = getAttr(connEl, "startElement") ?? "";
    const startConnector = getAttr(connEl, "startConnector") ?? "";
    const endElement = getAttr(connEl, "endElement") ?? "";
    const endConnector = getAttr(connEl, "endConnector") ?? "";
    const line = offsetToLine(lineStarts, connEl.start);

    const geomEl = getChild(connEl, "ConnectionGeometry");
    const points = geomEl ? parseConnectionGeometryAttrs(geomEl) : undefined;

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

function parseParameterBindings(systemEl: XmlElement, lineStarts: number[]): SspParameterBinding[] {
  const bindings: SspParameterBinding[] = [];
  const bindElements = getChildren(systemEl, "ParameterBinding");

  for (const bindEl of bindElements) {
    const prefix = getAttr(bindEl, "prefix");
    const source = getAttr(bindEl, "source");

    // Parse inline parameter values if present
    const values: SspParameterValue[] = [];
    const paramElements = findDescendants(bindEl, (e) => matchName(e.name, "Parameter"));
    for (const paramEl of paramElements) {
      const paramName = getAttr(paramEl, "name") ?? "";
      const line = offsetToLine(lineStarts, paramEl.start);

      const realEl = getChild(paramEl, "Real");
      if (realEl) {
        const val = getAttr(realEl, "value");
        if (val !== undefined) values.push({ name: paramName, type: "Real", value: parseFloat(val), line });
        continue;
      }

      const intEl = getChild(paramEl, "Integer");
      if (intEl) {
        const val = getAttr(intEl, "value");
        if (val !== undefined) values.push({ name: paramName, type: "Integer", value: parseInt(val, 10), line });
        continue;
      }

      const boolEl = getChild(paramEl, "Boolean");
      if (boolEl) {
        const val = getAttr(boolEl, "value");
        if (val !== undefined)
          values.push({ name: paramName, type: "Boolean", value: val === "true" || val === "1", line });
        continue;
      }

      const strEl = getChild(paramEl, "String");
      if (strEl) {
        const val = getAttr(strEl, "value");
        if (val !== undefined) values.push({ name: paramName, type: "String", value: val, line });
      }
    }

    bindings.push({ prefix, source, values });
  }

  return bindings;
}

function parseDefaultExperiment(
  root: XmlElement | null,
  systemEl: XmlElement | undefined,
): SspDefaultExperiment | undefined {
  const expEl = getChild(root, "DefaultExperiment") ?? getChild(systemEl, "DefaultExperiment");
  if (!expEl) return undefined;

  const startTimeStr = getAttr(expEl, "startTime");
  const stopTimeStr = getAttr(expEl, "stopTime");

  const exp: SspDefaultExperiment = {};
  if (startTimeStr !== undefined) exp.startTime = parseFloat(startTimeStr);
  if (stopTimeStr !== undefined) exp.stopTime = parseFloat(stopTimeStr);

  return exp;
}

/**
 * Parse SSM (System Structure Parameter Mapping) XML.
 *
 * @param xml The raw XML content of an .ssm file
 * @returns Parameter mapping definition
 */
export function parseSsm(xml: string): SspParameterMapping {
  const doc = parseXmlSync(xml);
  const root = doc.root;
  const version = root ? (getAttr(root, "version") ?? "1.0") : "1.0";
  const lineStarts = computeLineStarts(xml);

  const mappings: SspParameterMappingEntry[] = [];
  if (!root) return { version, mappings };

  const mapElements = findDescendants(root, (e) => matchName(e.name, "MappingEntry"));
  for (const mEl of mapElements) {
    const source = getAttr(mEl, "source") ?? "";
    const target = getAttr(mEl, "target") ?? "";
    const factorStr = getAttr(mEl, "factor");
    const offsetStr = getAttr(mEl, "offset");
    const line = offsetToLine(lineStarts, mEl.start);

    const factor = factorStr !== undefined ? parseFloat(factorStr) : undefined;
    const offset = offsetStr !== undefined ? parseFloat(offsetStr) : undefined;

    mappings.push({
      source,
      target,
      ...(factor !== undefined && !Number.isNaN(factor) ? { factor } : {}),
      ...(offset !== undefined && !Number.isNaN(offset) ? { offset } : {}),
      line,
    });
  }

  return { version, mappings };
}

/**
 * Parse SSB (System Structure Signal Dictionary) XML.
 *
 * @param xml The raw XML content of an .ssb file
 * @returns Signal dictionary definition
 */
export function parseSsb(xml: string): SspSignalDictionary {
  const doc = parseXmlSync(xml);
  const root = doc.root;
  const version = root ? (getAttr(root, "version") ?? "1.0") : "1.0";
  const name = root ? (getAttr(root, "name") ?? "SignalDictionary") : "SignalDictionary";
  const lineStarts = computeLineStarts(xml);

  const entries: SspSignalDictionaryEntry[] = [];
  if (!root) return { version, name, entries };

  const entryElements = findDescendants(root, (e) => matchName(e.name, "DictionaryEntry"));
  for (const eEl of entryElements) {
    const entryName = getAttr(eEl, "name") ?? "";
    const desc = getAttr(eEl, "description");
    const line = offsetToLine(lineStarts, eEl.start);

    // Check children for type
    const realEl = getChild(eEl, "Real");
    const intEl = getChild(eEl, "Integer");
    const boolEl = getChild(eEl, "Boolean");
    const strEl = getChild(eEl, "String");
    const enumEl = getChild(eEl, "Enumeration");

    let finalType: SspConnectorType = "Real";
    let finalUnit: string | undefined;

    if (realEl) {
      finalType = "Real";
      finalUnit = getAttr(realEl, "unit");
    } else if (intEl) {
      finalType = "Integer";
    } else if (boolEl) {
      finalType = "Boolean";
    } else if (strEl) {
      finalType = "String";
    } else if (enumEl) {
      finalType = "Enumeration";
    }

    entries.push({
      name: entryName,
      type: finalType,
      ...(finalUnit ? { unit: finalUnit } : {}),
      ...(desc ? { description: desc } : {}),
      line,
    });
  }

  return { version, name, entries };
}

/**
 * Serialize an SspSystem back to valid SystemStructure.ssd XML.
 */
export function serializeSsd(system: SspSystem): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<ssd:SystemStructureDescription xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription"');
  lines.push('                                xmlns:ssc="http://ssp-standard.org/SSP1/SystemStructureCommon"');
  lines.push(`                                name="${escapeXml(system.name)}"`);
  lines.push(`                                version="${system.version || "1.0"}"`);
  if (system.description) {
    lines.push(`                                description="${escapeXml(system.description)}"`);
  }
  lines.push(">");

  lines.push(`  <ssd:System name="${escapeXml(system.name)}">`);

  // Connectors
  if (system.connectors && system.connectors.length > 0) {
    lines.push("    <ssd:Connectors>");
    for (const c of system.connectors) {
      lines.push(`      <ssd:Connector name="${escapeXml(c.name)}" kind="${c.kind}">`);
      const uAttr = c.unit ? ` unit="${escapeXml(c.unit)}"` : "";
      lines.push(`        <ssc:${c.type}${uAttr} />`);
      lines.push("      </ssd:Connector>");
    }
    lines.push("    </ssd:Connectors>");
  }

  // Elements (Components)
  if (system.components.length > 0) {
    lines.push("    <ssd:Elements>");
    for (const cmp of system.components) {
      const typeAttr = cmp.type ? ` type="${escapeXml(cmp.type)}"` : "";
      lines.push(`      <ssd:Component name="${escapeXml(cmp.name)}" source="${escapeXml(cmp.source)}"${typeAttr}>`);
      if (cmp.connectors.length > 0) {
        lines.push("        <ssd:Connectors>");
        for (const c of cmp.connectors) {
          lines.push(`          <ssd:Connector name="${escapeXml(c.name)}" kind="${c.kind}">`);
          const uAttr = c.unit ? ` unit="${escapeXml(c.unit)}"` : "";
          lines.push(`            <ssc:${c.type}${uAttr} />`);
          lines.push("          </ssd:Connector>");
        }
        lines.push("        </ssd:Connectors>");
      }
      lines.push("      </ssd:Component>");
    }
    lines.push("    </ssd:Elements>");
  }

  // Connections
  if (system.connections.length > 0) {
    lines.push("    <ssd:Connections>");
    for (const conn of system.connections) {
      lines.push(
        `      <ssd:Connection startElement="${escapeXml(conn.startElement)}" startConnector="${escapeXml(conn.startConnector)}" endElement="${escapeXml(conn.endElement)}" endConnector="${escapeXml(conn.endConnector)}" />`,
      );
    }
    lines.push("    </ssd:Connections>");
  }

  // ParameterBindings
  if (system.parameterBindings.length > 0) {
    for (const pb of system.parameterBindings) {
      const pfxAttr = pb.prefix ? ` prefix="${escapeXml(pb.prefix)}"` : "";
      const srcAttr = pb.source ? ` source="${escapeXml(pb.source)}"` : "";
      lines.push(`    <ssd:ParameterBinding${pfxAttr}${srcAttr}>`);
      if (pb.values && pb.values.length > 0) {
        lines.push(
          '      <ssd:ParameterValues xmlns:ssv="http://ssp-standard.org/SSP1/SystemStructureParameterValues">',
        );
        lines.push("        <ssv:Parameters>");
        for (const v of pb.values) {
          lines.push(`          <ssv:Parameter name="${escapeXml(v.name)}">`);
          lines.push(`            <ssv:${v.type} value="${v.value}" />`);
          lines.push("          </ssv:Parameter>");
        }
        lines.push("        </ssv:Parameters>");
        lines.push("      </ssd:ParameterValues>");
      }
      lines.push("    </ssd:ParameterBinding>");
    }
  }

  // DefaultExperiment
  if (system.defaultExperiment) {
    const sStart =
      system.defaultExperiment.startTime !== undefined ? ` startTime="${system.defaultExperiment.startTime}"` : "";
    const sStop =
      system.defaultExperiment.stopTime !== undefined ? ` stopTime="${system.defaultExperiment.stopTime}"` : "";
    lines.push(`    <ssd:DefaultExperiment${sStart}${sStop} />`);
  }

  lines.push("  </ssd:System>");
  lines.push("</ssd:SystemStructureDescription>");
  return lines.join("\n");
}

/**
 * Serialize parameter values to valid SSV XML.
 */
export function serializeSsv(params: SspParameterValue[], name: string = "DefaultParams"): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<ssv:ParameterSet xmlns:ssv="http://ssp-standard.org/SSP1/SystemStructureParameterValues"');
  lines.push('                  version="1.0"');
  lines.push(`                  name="${escapeXml(name)}">`);
  lines.push("  <ssv:Parameters>");
  for (const p of params) {
    lines.push(`    <ssv:Parameter name="${escapeXml(p.name)}">`);
    lines.push(`      <ssv:${p.type} value="${p.value}" />`);
    lines.push("    </ssv:Parameter>");
  }
  lines.push("  </ssv:Parameters>");
  lines.push("</ssv:ParameterSet>");
  return lines.join("\n");
}

/**
 * Serialize parameter mapping to valid SSM XML.
 */
export function serializeSsm(mapping: SspParameterMapping): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<ssm:ParameterMapping xmlns:ssm="http://ssp-standard.org/SSP1/SystemStructureParameterMapping"');
  lines.push(`                      version="${mapping.version || "1.0"}">`);
  for (const m of mapping.mappings) {
    const fAttr = m.factor !== undefined ? ` factor="${m.factor}"` : "";
    const oAttr = m.offset !== undefined ? ` offset="${m.offset}"` : "";
    lines.push(
      `  <ssm:MappingEntry source="${escapeXml(m.source)}" target="${escapeXml(m.target)}"${fAttr}${oAttr} />`,
    );
  }
  lines.push("</ssm:ParameterMapping>");
  return lines.join("\n");
}

/**
 * Serialize signal dictionary to valid SSB XML.
 */
export function serializeSsb(dictionary: SspSignalDictionary): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<ssb:SignalDictionary xmlns:ssb="http://ssp-standard.org/SSP1/SystemStructureSignalDictionary"');
  lines.push(`                       name="${escapeXml(dictionary.name || "Dictionary")}"`);
  lines.push(`                       version="${dictionary.version || "1.0"}">`);
  for (const e of dictionary.entries) {
    const uAttr = e.unit ? ` unit="${escapeXml(e.unit)}"` : "";
    const dAttr = e.description ? ` description="${escapeXml(e.description)}"` : "";
    lines.push(`  <ssb:DictionaryEntry name="${escapeXml(e.name)}"${dAttr}>`);
    lines.push(`    <ssb:${e.type}${uAttr} />`);
    lines.push("  </ssb:DictionaryEntry>");
  }
  lines.push("</ssb:SignalDictionary>");
  return lines.join("\n");
}

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
