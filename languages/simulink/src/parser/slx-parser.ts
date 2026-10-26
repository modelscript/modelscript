// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulink — Native Open Packaging Conventions (OPC) SLX Parser.
 *
 * Unpacks the .slx zip container and parses simulink/blockdiagram.xml using @modelscript/dsl/xml.
 */

import { parseXml, type XmlElement } from "@modelscript/dsl/xml";
import AdmZip from "adm-zip";
import type {
  SimulinkBlock,
  SimulinkBlockType,
  SimulinkBranch,
  SimulinkLine,
  SimulinkModel,
  SimulinkPort,
  SimulinkSystem,
  SourceRange,
} from "../types.js";

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function offsetToPosition(offset: number, lineStarts: number[]): { line: number; col: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lineStarts[mid]! <= offset) low = mid + 1;
    else high = mid - 1;
  }
  const lineIdx = low - 1;
  return { line: lineIdx + 1, col: offset - lineStarts[lineIdx]! + 1 };
}

function elementRange(el: XmlElement, lineStarts: number[]): SourceRange {
  const startPos = offsetToPosition(el.start, lineStarts);
  const endPos = offsetToPosition(el.end, lineStarts);
  return {
    startLine: startPos.line,
    startColumn: startPos.col,
    endLine: endPos.line,
    endColumn: endPos.col,
  };
}

function getAttr(el: XmlElement, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const a of el.attributes) {
    if (a.name.toLowerCase() === lower) return a.value;
  }
  return undefined;
}

function mapBlockType(rawType: string): SimulinkBlockType {
  const lower = rawType.toLowerCase();
  switch (lower) {
    case "inport":
      return "Inport";
    case "outport":
      return "Outport";
    case "constant":
      return "Constant";
    case "integrator":
      return "Integrator";
    case "unitdelay":
      return "UnitDelay";
    case "gain":
      return "Gain";
    case "sum":
      return "Sum";
    case "product":
      return "Product";
    case "transferfcn":
      return "TransferFcn";
    case "statespace":
      return "StateSpace";
    case "subsystem":
      return "SubSystem";
    case "buscreator":
      return "BusCreator";
    case "busselector":
      return "BusSelector";
    case "mux":
      return "Mux";
    case "demux":
      return "Demux";
    case "math":
      return "Math";
    case "relationaloperator":
      return "RelationalOperator";
    case "logicaloperator":
      return "LogicalOperator";
    case "switch":
      return "Switch";
    case "scope":
      return "Scope";
    case "lookup_nd":
      return "Lookup_nD";
    case "ground":
      return "Ground";
    case "terminator":
      return "Terminator";
    default:
      return "Unknown";
  }
}

/**
 * Parses an SLX buffer or raw XML string into a strongly-typed SimulinkModel.
 */
export function parseSlx(input: string | Buffer | Uint8Array, defaultName = "simulink_model"): SimulinkModel {
  let xmlContent: string;

  if (typeof input === "string") {
    // Check if it's already an XML string
    const trimmed = input.trim();
    if (trimmed.startsWith("<") || trimmed.includes("<ModelInformation") || trimmed.includes("<BlockDiagram")) {
      xmlContent = input;
    } else {
      // It's a file path or base64
      try {
        const zip = new AdmZip(input);
        const entry =
          zip.getEntry("simulink/blockdiagram.xml") ??
          zip.getEntry("simulink/systems/system_root.xml") ??
          zip.getEntries().find((e) => e.entryName.endsWith(".xml"));
        xmlContent = entry ? zip.readAsText(entry) : input;
      } catch {
        xmlContent = input;
      }
    }
  } else {
    try {
      const zip = new AdmZip(Buffer.from(input));
      const entry =
        zip.getEntry("simulink/blockdiagram.xml") ??
        zip.getEntry("simulink/systems/system_root.xml") ??
        zip.getEntries().find((e) => e.entryName.endsWith(".xml"));
      xmlContent = entry ? zip.readAsText(entry) : "";
    } catch {
      xmlContent = Buffer.from(input).toString("utf-8");
    }
  }

  const lineStarts = computeLineStarts(xmlContent);
  const doc = parseXml(xmlContent);
  const root = doc.root;

  const model: SimulinkModel = {
    name: defaultName,
    rootSystem: {
      name: defaultName,
      blocks: new Map(),
      lines: [],
    },
  };

  if (!root) return model;

  // Search for <System> or <Model>
  const systemEl = findSystemElement(root);
  if (systemEl) {
    const sysName = getAttr(systemEl, "Name") ?? defaultName;
    model.name = sysName;
    model.rootSystem = parseSystem(systemEl, lineStarts, sysName);
  }

  return model;
}

function findSystemElement(el: XmlElement): XmlElement | undefined {
  if (el.name.toLowerCase() === "system") return el;
  for (const child of el.children) {
    const found = findSystemElement(child);
    if (found) return found;
  }
  return undefined;
}

function parseSystem(el: XmlElement, lineStarts: number[], name: string): SimulinkSystem {
  const blocks = new Map<string, SimulinkBlock>();
  const lines: SimulinkLine[] = [];

  for (const child of el.children) {
    const tag = child.name.toLowerCase();
    if (tag === "block") {
      const block = parseBlock(child, lineStarts);
      blocks.set(block.name, block);
    } else if (tag === "line") {
      const line = parseLine(child, lineStarts);
      lines.push(line);
    }
  }

  return { name, blocks, lines };
}

function parseBlock(el: XmlElement, lineStarts: number[]): SimulinkBlock {
  const rawType = getAttr(el, "BlockType") ?? getAttr(el, "type") ?? "Unknown";
  const name = getAttr(el, "Name") ?? `Block_${Math.random().toString(36).slice(2, 7)}`;
  const id = getAttr(el, "SID") ?? name;
  const range = elementRange(el, lineStarts);
  const parameters = new Map<string, string | number>();
  const ports: SimulinkPort[] = [];
  let subsystem: SimulinkSystem | undefined;

  for (const child of el.children) {
    const tag = child.name.toLowerCase();
    if (tag === "p") {
      const pName = getAttr(child, "Name");
      if (pName) {
        const textVal = child.text.trim();
        const numVal = Number.parseFloat(textVal);
        parameters.set(pName, !Number.isNaN(numVal) && String(numVal) === textVal ? numVal : textVal);
      }
    } else if (tag === "port") {
      const portNum = Number.parseInt(getAttr(child, "PortNumber") ?? "1", 10);
      const portType = (getAttr(child, "PortType") ?? "in") as "in" | "out" | "trigger" | "enable";
      ports.push({
        id: `${name}_${portType}_${portNum}`,
        portNumber: portNum,
        type: portType,
      });
    } else if (tag === "system") {
      subsystem = parseSystem(child, lineStarts, name);
    }
  }

  return {
    name,
    type: mapBlockType(rawType),
    id,
    parameters,
    ports,
    subsystem,
    range,
  };
}

function extractDigits(str: string): string {
  let res = "";
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    if (ch >= 48 && ch <= 57) res += str[i];
  }
  return res;
}

function parseLine(el: XmlElement, lineStarts: number[]): SimulinkLine {
  const range = elementRange(el, lineStarts);
  let srcBlock = "";
  let srcPort = 1;
  let dstBlock: string | undefined;
  let dstPort: number | undefined;
  const branches: SimulinkBranch[] = [];

  for (const child of el.children) {
    const tag = child.name.toLowerCase();
    if (tag === "p") {
      const pName = getAttr(child, "Name");
      if (pName === "Src") {
        const val = child.text.trim();
        const hashIdx = val.indexOf("#");
        if (hashIdx >= 0) {
          srcBlock = val.slice(0, hashIdx);
          srcPort = Number.parseInt(extractDigits(val.slice(hashIdx + 1)) || "1", 10);
        } else {
          srcBlock = val;
        }
      } else if (pName === "Dst") {
        const val = child.text.trim();
        const hashIdx = val.indexOf("#");
        if (hashIdx >= 0) {
          dstBlock = val.slice(0, hashIdx);
          dstPort = Number.parseInt(extractDigits(val.slice(hashIdx + 1)) || "1", 10);
        } else {
          dstBlock = val;
          dstPort = 1;
        }
      }
    } else if (tag === "branch") {
      const branch = parseBranch(child);
      if (branch) branches.push(branch);
    }
  }

  return {
    id: `Line_${srcBlock}_${srcPort}`,
    srcBlock,
    srcPort,
    dstBlock,
    dstPort,
    branches,
    range,
  };
}

function parseBranch(el: XmlElement): SimulinkBranch | undefined {
  let dstBlock = "";
  let dstPort = 1;

  for (const child of el.children) {
    if (child.name.toLowerCase() === "p" && getAttr(child, "Name") === "Dst") {
      const val = child.text.trim();
      const hashIdx = val.indexOf("#");
      if (hashIdx >= 0) {
        dstBlock = val.slice(0, hashIdx);
        dstPort = Number.parseInt(extractDigits(val.slice(hashIdx + 1)) || "1", 10);
      } else {
        dstBlock = val;
      }
    }
  }

  return dstBlock ? { dstBlock, dstPort } : undefined;
}
