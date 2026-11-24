// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * 20-sim `.emx` (XML) and `.emxz` (ZIP archive) container parser.
 *
 * Extracts model hierarchy, ports, bond/signal connections, visual layout coordinates,
 * experiment settings, and embedded SIDOPS `<SpecificationCode>` blocks.
 */

import AdmZip from "adm-zip";
import { lookupTwentySimBlock } from "../catalog/index.js";
import type {
  BondCausality,
  TwentySimConnection,
  TwentySimExperiment,
  TwentySimModel,
  TwentySimParameter,
  TwentySimParseIssue,
  TwentySimPort,
  TwentySimPosition,
  TwentySimSubmodel,
} from "../types.js";
import { defaultPortsForElement, inferBondGraphElementKind, parseSidops } from "./sidops-parser.js";

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function unwrapCdata(raw: string): string {
  const trimmed = raw.trim();
  const cdataMatch = trimmed.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdataMatch) return cdataMatch[1] ?? "";
  return decodeXmlEntities(trimmed);
}

interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  text: string;
  children: XmlNode[];
  line: number;
  startOffset: number;
  endOffset: number;
}

/**
 * Lightweight, zero-dependency XML tree parser tuned for 20-sim `.emx` documents
 * (supports CDATA sections, processing instructions, XML comments, and self-closing tags).
 */
function parseXml(xml: string, issues: TwentySimParseIssue[]): XmlNode | null {
  let i = 0;
  const n = xml.length;
  let line = 1;
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;

  const advance = (count = 1): void => {
    for (let k = 0; k < count && i < n; k++) {
      if (xml[i] === "\n") line++;
      i++;
    }
  };

  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) {
      if (stack.length > 0) {
        stack[stack.length - 1]!.text += decodeXmlEntities(xml.slice(i));
      }
      break;
    }

    if (lt > i) {
      const chunk = xml.slice(i, lt);
      if (stack.length > 0) {
        stack[stack.length - 1]!.text += decodeXmlEntities(chunk);
      }
      for (let k = i; k < lt; k++) {
        if (xml[k] === "\n") line++;
      }
      i = lt;
    }

    // Comment <!-- ... -->
    if (xml.startsWith("<!--", i)) {
      const end = xml.indexOf("-->", i + 4);
      if (end === -1) {
        issues.push({ message: "Unterminated XML comment", line, column: 1, startOffset: i, endOffset: n });
        break;
      }
      advance(end + 3 - i);
      continue;
    }

    // CDATA <![CDATA[ ... ]]>
    if (xml.startsWith("<![CDATA[", i)) {
      const end = xml.indexOf("]]>", i + 9);
      if (end === -1) {
        issues.push({ message: "Unterminated CDATA section", line, column: 1, startOffset: i, endOffset: n });
        break;
      }
      const cdata = xml.slice(i + 9, end);
      if (stack.length > 0) {
        stack[stack.length - 1]!.text += cdata;
      }
      advance(end + 3 - i);
      continue;
    }

    // Processing instruction <? ... ?> or DOCTYPE <! ... >
    if (xml.startsWith("<?", i) || xml.startsWith("<!", i)) {
      const closeChar = xml.startsWith("<?", i) ? "?>" : ">";
      const end = xml.indexOf(closeChar, i + 2);
      if (end === -1) break;
      advance(end + closeChar.length - i);
      continue;
    }

    // Closing tag </Tag>
    if (xml.startsWith("</", i)) {
      const end = xml.indexOf(">", i + 2);
      if (end === -1) {
        issues.push({ message: "Unterminated closing XML tag", line, column: 1, startOffset: i, endOffset: n });
        break;
      }
      const closeTag = xml.slice(i + 2, end).trim();
      const top = stack[stack.length - 1];
      if (top && top.tag === closeTag) {
        top.endOffset = end + 1;
        stack.pop();
      } else {
        issues.push({
          message: `Mismatched XML closing tag '</${closeTag}>'`,
          line,
          column: 1,
          startOffset: i,
          endOffset: end + 1,
        });
      }
      advance(end + 1 - i);
      continue;
    }

    // Opening tag <Tag attr="val"> or <Tag .../>
    const startOffset = i;
    const startLine = line;
    const end = xml.indexOf(">", i + 1);
    if (end === -1) {
      issues.push({ message: "Unterminated opening XML tag", line, column: 1, startOffset: i, endOffset: n });
      break;
    }

    const inside = xml.slice(i + 1, end).trim();
    const selfClosing = inside.endsWith("/");
    const header = selfClosing ? inside.slice(0, -1).trim() : inside;
    const spaceIdx = header.search(/\s/);
    const tag = spaceIdx === -1 ? header : header.slice(0, spaceIdx);
    const attrStr = spaceIdx === -1 ? "" : header.slice(spaceIdx + 1);

    const attrs: Record<string, string> = {};
    const attrRegex = /([A-Za-z_][A-Za-z0-9_:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let m: RegExpExecArray | null;
    while ((m = attrRegex.exec(attrStr)) !== null) {
      attrs[m[1]!] = decodeXmlEntities(m[2] ?? m[3] ?? "");
    }

    const node: XmlNode = {
      tag,
      attrs,
      text: "",
      children: [],
      line: startLine,
      startOffset,
      endOffset: end + 1,
    };

    if (stack.length > 0) {
      stack[stack.length - 1]!.children.push(node);
    } else if (!root) {
      root = node;
    }

    if (!selfClosing) {
      stack.push(node);
    }

    advance(end + 1 - i);
  }

  return root;
}

function findChild(node: XmlNode, ...tags: string[]): XmlNode | undefined {
  const lowerTags = tags.map((t) => t.toLowerCase());
  return node.children.find((c) => lowerTags.includes(c.tag.toLowerCase()));
}

function findChildren(node: XmlNode, ...tags: string[]): XmlNode[] {
  const lowerTags = tags.map((t) => t.toLowerCase());
  return node.children.filter((c) => lowerTags.includes(c.tag.toLowerCase()));
}

function childText(node: XmlNode, ...tags: string[]): string | undefined {
  const child = findChild(node, ...tags);
  if (!child) return undefined;
  const txt = child.text.trim();
  return txt.length > 0 ? txt : undefined;
}

function parsePosition(node: XmlNode): TwentySimPosition | undefined {
  const posNode = findChild(node, "Position", "Location", "Bounds");
  if (!posNode) {
    const ax = node.attrs["x"] ?? node.attrs["X"];
    const ay = node.attrs["y"] ?? node.attrs["Y"];
    if (ax !== undefined && ay !== undefined) {
      return { x: Number(ax) || 0, y: Number(ay) || 0 };
    }
    return undefined;
  }
  const x = Number(posNode.attrs["x"] ?? posNode.attrs["X"] ?? childText(posNode, "X") ?? 0);
  const y = Number(posNode.attrs["y"] ?? posNode.attrs["Y"] ?? childText(posNode, "Y") ?? 0);
  const width = posNode.attrs["width"] ?? childText(posNode, "Width");
  const height = posNode.attrs["height"] ?? childText(posNode, "Height");
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    width: width !== undefined ? Number(width) : undefined,
    height: height !== undefined ? Number(height) : undefined,
  };
}

function parseXmlPort(node: XmlNode): TwentySimPort {
  const name = node.attrs["name"] ?? node.attrs["Name"] ?? childText(node, "Name") ?? "p";
  const rawKind = (
    node.attrs["type"] ??
    node.attrs["kind"] ??
    childText(node, "Type", "Kind") ??
    "power"
  ).toLowerCase();
  const kind: TwentySimPort["kind"] =
    rawKind.includes("signal") || rawKind === "in" || rawKind === "out" ? "signal" : "power";
  const rawDir = (node.attrs["direction"] ?? childText(node, "Direction") ?? "inout").toLowerCase();
  const direction: TwentySimPort["direction"] =
    rawDir === "in" || rawDir === "input" ? "in" : rawDir === "out" || rawDir === "output" ? "out" : "inout";
  const rawRestr = (node.attrs["restriction"] ?? childText(node, "Restriction", "Causality") ?? "none").toLowerCase();
  const restriction: TwentySimPort["restriction"] = rawRestr.includes("effort")
    ? "effort"
    : rawRestr.includes("flow")
      ? "flow"
      : "none";

  const rawDim = node.attrs["dimension"] ?? childText(node, "Dimension");
  const dimension = rawDim !== undefined ? Number(rawDim) : undefined;

  return {
    name,
    kind,
    direction,
    effortVar: childText(node, "Effort") ?? (kind === "power" ? `${name}.e` : undefined),
    flowVar: childText(node, "Flow") ?? (kind === "power" ? `${name}.f` : undefined),
    restriction,
    dimension: dimension !== undefined && Number.isFinite(dimension) ? dimension : undefined,
    line: node.line,
    startOffset: node.startOffset,
    endOffset: node.endOffset,
  };
}

function parseXmlParameter(node: XmlNode): TwentySimParameter {
  const name = node.attrs["name"] ?? node.attrs["Name"] ?? childText(node, "Name") ?? "param";
  const rawVal = node.attrs["value"] ?? node.attrs["Value"] ?? childText(node, "Value");
  const num = rawVal !== undefined && rawVal !== "" ? Number(rawVal) : undefined;
  return {
    name,
    type: "real",
    value: num !== undefined && Number.isFinite(num) ? num : rawVal,
    unit: node.attrs["unit"] ?? childText(node, "Unit"),
    description: childText(node, "Description"),
    line: node.line,
    startOffset: node.startOffset,
    endOffset: node.endOffset,
  };
}

function parseXmlCausality(raw: string | undefined): BondCausality | undefined {
  if (!raw) return undefined;
  const low = raw.toLowerCase();
  if (low === "effort-to-target" || low === "effort" || low === "target") return "effort-to-target";
  if (low === "effort-to-source" || low === "flow" || low === "source") return "effort-to-source";
  if (low === "conflict") return "conflict";
  return "unassigned";
}

function parseXmlConnection(node: XmlNode, index: number): TwentySimConnection {
  const id = node.attrs["id"] ?? node.attrs["name"] ?? childText(node, "Name") ?? `conn_${index + 1}`;
  const rawType = (node.attrs["type"] ?? node.attrs["kind"] ?? childText(node, "Type") ?? "bond").toLowerCase();
  const kind: "bond" | "signal" = rawType.includes("signal") ? "signal" : "bond";

  const fromStr = node.attrs["from"] ?? childText(node, "From", "Source") ?? "";
  const toStr = node.attrs["to"] ?? childText(node, "To", "Destination", "Target") ?? "";

  const splitRef = (ref: string, defaultPort: string): [string, string] => {
    const dot = ref.lastIndexOf(".");
    const slash = ref.lastIndexOf("\\");
    const sep = Math.max(dot, slash);
    if (sep > 0) {
      return [ref.slice(0, sep), ref.slice(sep + 1)];
    }
    return [ref, defaultPort];
  };

  const [fromSubmodel, fromPort] =
    node.attrs["fromSubmodel"] !== undefined
      ? [node.attrs["fromSubmodel"]!, node.attrs["fromPort"] ?? "p"]
      : splitRef(fromStr, "p");

  const [toSubmodel, toPort] =
    node.attrs["toSubmodel"] !== undefined
      ? [node.attrs["toSubmodel"]!, node.attrs["toPort"] ?? "p"]
      : splitRef(toStr, "p");

  const wpContainer = findChild(node, "Waypoints", "Points");
  const wpNodes = wpContainer ? findChildren(wpContainer, "Point", "Waypoint") : [];
  const waypoints =
    wpNodes.length > 0
      ? wpNodes.map((pt) => ({
          x: Number(pt.attrs["x"] ?? pt.attrs["X"] ?? childText(pt, "X") ?? 0) || 0,
          y: Number(pt.attrs["y"] ?? pt.attrs["Y"] ?? childText(pt, "Y") ?? 0) || 0,
        }))
      : undefined;

  return {
    id,
    kind,
    fromSubmodel,
    fromPort,
    toSubmodel,
    toPort,
    causality: parseXmlCausality(node.attrs["causality"] ?? childText(node, "Causality")),
    waypoints,
    line: node.line,
    startOffset: node.startOffset,
    endOffset: node.endOffset,
  };
}

function parseXmlSubmodel(node: XmlNode, issues: TwentySimParseIssue[]): TwentySimSubmodel {
  const name = node.attrs["name"] ?? node.attrs["Name"] ?? childText(node, "Name") ?? "Main";
  const typeName =
    node.attrs["type"] ??
    node.attrs["Type"] ??
    node.attrs["class"] ??
    childText(node, "Type", "SubmodelType", "BondGraphType");
  const description = childText(node, "Description");
  const catalogSpec = lookupTwentySimBlock(typeName);
  const elementKind = catalogSpec?.elementKind ?? inferBondGraphElementKind(typeName, name);

  // Embedded SIDOPS code
  const specNode = findChild(node, "SpecificationCode", "SidopsCode", "Equations", "ImplementationCode");
  const rawSidops = specNode ? unwrapCdata(specNode.text) : undefined;
  const parsedSidops = rawSidops && rawSidops.trim().length > 0 ? parseSidops(rawSidops, name) : null;
  if (parsedSidops) {
    issues.push(...parsedSidops.issues);
  }

  // Ports from XML or SIDOPS or catalog or canonical defaults
  const portsContainer = findChild(node, "Ports", "Interface");
  const xmlPortNodes = portsContainer ? findChildren(portsContainer, "Port") : findChildren(node, "Port");
  let ports: TwentySimPort[] = xmlPortNodes.map(parseXmlPort);
  if (parsedSidops && parsedSidops.submodel.ports.length > 0) {
    const existing = new Set(ports.map((p) => p.name));
    for (const sp of parsedSidops.submodel.ports) {
      if (!existing.has(sp.name)) ports.push(sp);
    }
  }
  if (ports.length === 0) {
    ports = catalogSpec ? catalogSpec.ports.map((p) => ({ ...p })) : defaultPortsForElement(elementKind);
  }

  // Parameters from XML + SIDOPS
  const paramsContainer = findChild(node, "Parameters");
  const xmlParamNodes = paramsContainer ? findChildren(paramsContainer, "Parameter") : findChildren(node, "Parameter");
  const parameters: TwentySimParameter[] = xmlParamNodes.map(parseXmlParameter);
  if (parsedSidops) {
    const existing = new Set(parameters.map((p) => p.name));
    for (const sp of parsedSidops.submodel.parameters) {
      if (!existing.has(sp.name)) parameters.push(sp);
    }
  }

  // InitialValues block
  const initContainer = findChild(node, "InitialValues");
  let initialValues: Record<string, number> | undefined;
  if (initContainer) {
    const initEntries = findChildren(initContainer, "InitialValue", "Variable", "Value");
    if (initEntries.length > 0) {
      initialValues = {};
      for (const entry of initEntries) {
        const vName = entry.attrs["name"] ?? childText(entry, "Name");
        const vVal = Number(entry.attrs["value"] ?? childText(entry, "Value") ?? 0);
        if (vName && Number.isFinite(vVal)) initialValues[vName] = vVal;
      }
    }
  }

  // Nested submodels
  const submodelsContainer = findChild(node, "Submodels", "BondGraph", "Components");
  const xmlSubNodes = submodelsContainer
    ? findChildren(submodelsContainer, "Submodel", "Element", "Component")
    : findChildren(node, "Submodel", "Element");
  const submodels: TwentySimSubmodel[] = xmlSubNodes.map((child) => parseXmlSubmodel(child, issues));
  if (parsedSidops) {
    submodels.push(...parsedSidops.submodel.submodels);
  }

  // Connections
  const connContainer = findChild(node, "Connections", "Bonds");
  const xmlConnNodes = connContainer
    ? findChildren(connContainer, "Connection", "Bond", "SignalConnection")
    : findChildren(node, "Connection", "Bond");
  const connections: TwentySimConnection[] = xmlConnNodes.map((c, idx) => parseXmlConnection(c, idx));
  if (parsedSidops) {
    connections.push(...parsedSidops.submodel.connections);
  }

  return {
    name,
    elementKind,
    typeName,
    description,
    ports,
    parameters,
    variables: parsedSidops?.submodel.variables ?? [],
    initialEquations: parsedSidops?.submodel.initialEquations ?? [],
    equations: parsedSidops?.submodel.equations ?? [],
    submodels,
    connections,
    rawSidops,
    position: parsePosition(node),
    initialValues,
    line: node.line,
    startOffset: node.startOffset,
    endOffset: node.endOffset,
  };
}

function parseExperiment(root: XmlNode): TwentySimExperiment | undefined {
  const exp = findChild(root, "Experiment", "Simulation", "RunSpecs");
  if (!exp) return undefined;
  return {
    startTime: Number(exp.attrs["startTime"] ?? childText(exp, "StartTime") ?? 0) || 0,
    finishTime: Number(exp.attrs["finishTime"] ?? childText(exp, "FinishTime", "StopTime") ?? 10) || 10,
    stepSize: Number(exp.attrs["stepSize"] ?? childText(exp, "StepSize") ?? 0.01) || 0.01,
    method: exp.attrs["method"] ?? childText(exp, "Method", "IntegrationMethod"),
  };
}

/**
 * Parse a 20-sim `.emx` XML string.
 */
export function parseEmx(xmlSource: string, defaultName = "Main"): TwentySimModel {
  const issues: TwentySimParseIssue[] = [];
  const doc = parseXml(xmlSource, issues);

  if (!doc) {
    issues.push({
      message: "Empty or malformed 20-sim .emx XML document",
      line: 1,
      column: 1,
      startOffset: 0,
      endOffset: xmlSource.length,
    });
    return {
      name: defaultName,
      sourceKind: "emx",
      root: {
        name: defaultName,
        elementKind: "Submodel",
        ports: [],
        parameters: [],
        variables: [],
        initialEquations: [],
        equations: [],
        submodels: [],
        connections: [],
      },
      parseIssues: issues,
    };
  }

  const version = doc.attrs["version"] ?? childText(doc, "Version", "FileVersion");
  const modelNode =
    findChild(doc, "Model", "MainModel", "Submodel") ??
    (doc.tag.toLowerCase() === "model" || doc.tag.toLowerCase() === "submodel" ? doc : doc);
  const root = parseXmlSubmodel(modelNode, issues);
  const experiment = parseExperiment(doc) ?? parseExperiment(modelNode);
  const globalsNode = findChild(doc, "GlobalVariables") ?? findChild(modelNode, "GlobalVariables");
  const globalVariables = globalsNode
    ? findChildren(globalsNode, "Variable", "GlobalVariable")
        .map((v) => v.attrs["name"] ?? childText(v, "Name") ?? v.text.trim())
        .filter((s) => s.length > 0)
    : undefined;

  return {
    name: root.name || defaultName,
    sourceKind: "emx",
    version,
    root,
    experiment,
    globalVariables,
    parseIssues: issues,
  };
}

/**
 * Parse a 20-sim `.emxz` ZIP archive buffer containing an `.emx` model.
 */
export function parseEmxz(buffer: Buffer | Uint8Array, defaultName = "Main"): TwentySimModel {
  const zip = new AdmZip(Buffer.from(buffer));
  const emxEntry = zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith(".emx"));
  if (!emxEntry) {
    return {
      name: defaultName,
      sourceKind: "emxz",
      root: {
        name: defaultName,
        elementKind: "Submodel",
        ports: [],
        parameters: [],
        variables: [],
        initialEquations: [],
        equations: [],
        submodels: [],
        connections: [],
      },
      parseIssues: [
        {
          message: "No .emx model file found inside .emxz archive",
          line: 1,
          column: 1,
          startOffset: 0,
          endOffset: 0,
        },
      ],
    };
  }

  const xmlText = emxEntry.getData().toString("utf-8");
  const model = parseEmx(xmlText, defaultName);
  return { ...model, sourceKind: "emxz" };
}

/**
 * Unified parser entry point for `.emx` XML, `.emxz` ZIP buffers, or standalone `.sid` SIDOPS text.
 */
export function parseTwentySim(input: string | Buffer | Uint8Array, defaultName = "Main"): TwentySimModel {
  if (typeof input !== "string") {
    // Check ZIP magic bytes PK\x03\x04
    if (input.length >= 4 && input[0] === 0x50 && input[1] === 0x4b && input[2] === 0x03 && input[3] === 0x04) {
      return parseEmxz(input, defaultName);
    }
    return parseTwentySim(Buffer.from(input).toString("utf-8"), defaultName);
  }

  const trimmed = input.trimStart();
  if (trimmed.startsWith("<")) {
    return parseEmx(input, defaultName);
  }

  const { submodel, issues } = parseSidops(input, defaultName);
  return {
    name: submodel.name || defaultName,
    sourceKind: "sidops",
    root: submodel,
    parseIssues: issues,
  };
}
