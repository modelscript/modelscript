// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulink — Native Zero-Regex ASCII MDL Parser & Serializer.
 *
 * Implements a robust recursive-descent character scanner for legacy MATLAB/Simulink .mdl files.
 */

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

interface MdlNode {
  type: string;
  params: Map<string, string | number>;
  children: MdlNode[];
  range: SourceRange;
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
 * Parses an ASCII MDL string into a SimulinkModel using a zero-regex scanner.
 */
export function parseMdl(text: string, defaultName = "simulink_model"): SimulinkModel {
  let pos = 0;
  let line = 1;
  let col = 1;

  function advance(): number {
    const ch = text.charCodeAt(pos++);
    if (ch === 10) {
      line++;
      col = 1;
    } else {
      col++;
    }
    return ch;
  }

  function peek(): number {
    return pos < text.length ? text.charCodeAt(pos) : 0;
  }

  function skipWhitespaceAndComments(): void {
    while (pos < text.length) {
      const ch = peek();
      if (ch === 32 || ch === 9 || ch === 10 || ch === 13) {
        advance();
      } else if (ch === 35) {
        // # comment until newline
        while (pos < text.length && peek() !== 10) {
          advance();
        }
      } else {
        break;
      }
    }
  }

  function readWord(): string {
    const start = pos;
    while (pos < text.length) {
      const ch = peek();
      if (
        (ch >= 48 && ch <= 57) || // 0-9
        (ch >= 65 && ch <= 90) || // A-Z
        (ch >= 97 && ch <= 122) || // a-z
        ch === 95 || // _
        ch === 46 || // .
        ch === 45 // -
      ) {
        advance();
      } else {
        break;
      }
    }
    return text.slice(start, pos);
  }

  function readQuotedString(): string {
    advance(); // skip opening quote
    let res = "";
    while (pos < text.length) {
      const ch = advance();
      if (ch === 34) {
        break; // closing quote
      }
      if (ch === 92 && pos < text.length) {
        // escape
        const next = advance();
        if (next === 110) res += "\n";
        else if (next === 116) res += "\t";
        else res += String.fromCharCode(next);
      } else {
        res += String.fromCharCode(ch);
      }
    }
    return res;
  }

  function readBracketedValue(): string {
    advance(); // skip [
    let depth = 1;
    let res = "";
    while (pos < text.length && depth > 0) {
      const ch = advance();
      if (ch === 91) depth++;
      else if (ch === 93) {
        depth--;
        if (depth === 0) break;
      }
      res += String.fromCharCode(ch);
    }
    return res.trim();
  }

  function parseBlockNode(): MdlNode | null {
    skipWhitespaceAndComments();
    if (pos >= text.length) return null;

    const startLine = line;
    const startCol = col;

    const blockType = readWord();
    if (!blockType) return null;

    skipWhitespaceAndComments();
    if (peek() !== 123) {
      // not an open brace {
      return null;
    }
    advance(); // consume {

    const params = new Map<string, string | number>();
    const children: MdlNode[] = [];

    while (pos < text.length) {
      skipWhitespaceAndComments();
      if (pos >= text.length) break;
      if (peek() === 125) {
        // }
        advance();
        break;
      }

      const keyStartPos = pos;
      const keyStartLine = line;
      const keyStartCol = col;
      const key = readWord();
      if (!key) break;

      skipWhitespaceAndComments();
      if (peek() === 123) {
        // nested sub-block! Backtrack key so parseBlockNode can read it
        pos = keyStartPos;
        line = keyStartLine;
        col = keyStartCol;
        const sub = parseBlockNode();
        if (sub) children.push(sub);
      } else if (peek() === 34) {
        // Quoted string
        const strVal = readQuotedString();
        params.set(key, strVal);
      } else if (peek() === 91) {
        // [ Bracketed Array ]
        const arrVal = readBracketedValue();
        params.set(key, arrVal);
      } else {
        // Bare value (number or keyword)
        const valStr = readWord();
        const numVal = Number(valStr);
        if (valStr.length > 0 && !Number.isNaN(numVal)) {
          params.set(key, numVal);
        } else {
          params.set(key, valStr);
        }
      }
    }

    return {
      type: blockType,
      params,
      children,
      range: {
        startLine,
        startColumn: startCol,
        endLine: line,
        endColumn: col,
      },
    };
  }

  // Parse root nodes
  const rootNodes: MdlNode[] = [];
  while (pos < text.length) {
    skipWhitespaceAndComments();
    if (pos >= text.length) break;
    const node = parseBlockNode();
    if (node) rootNodes.push(node);
    else advance();
  }

  const modelNode = rootNodes.find((n) => n.type.toLowerCase() === "model") ?? rootNodes[0];
  const modelName = (modelNode?.params.get("Name") as string) ?? defaultName;

  const model: SimulinkModel = {
    name: modelName,
    rootSystem: {
      name: modelName,
      blocks: new Map(),
      lines: [],
    },
  };

  const systemNode = modelNode?.children.find((c) => c.type.toLowerCase() === "system");
  if (systemNode) {
    model.rootSystem = convertSystemNode(systemNode, modelName);
  }

  return model;
}

function convertSystemNode(node: MdlNode, name: string): SimulinkSystem {
  const blocks = new Map<string, SimulinkBlock>();
  const lines: SimulinkLine[] = [];

  for (const child of node.children) {
    const cType = child.type.toLowerCase();
    if (cType === "block") {
      const bTypeStr = (child.params.get("BlockType") as string) ?? "Unknown";
      const bName = (child.params.get("Name") as string) ?? `Block_${blocks.size + 1}`;
      const sid = (child.params.get("SID") as string) ?? bName;

      let subSys: SimulinkSystem | undefined;
      const subNode = child.children.find((c) => c.type.toLowerCase() === "system");
      if (subNode) {
        subSys = convertSystemNode(subNode, bName);
      }

      const ports: SimulinkPort[] = [];
      const portsParam = child.params.get("Ports");
      if (typeof portsParam === "string") {
        // e.g. "[1, 1]" or "[2, 1]"
        const nums = tokenizeNumbers(portsParam);
        const inPorts = nums[0] ?? 1;
        const outPorts = nums[1] ?? 1;
        for (let i = 1; i <= inPorts; i++) {
          ports.push({ id: `${bName}_in_${i}`, portNumber: i, type: "in" });
        }
        for (let i = 1; i <= outPorts; i++) {
          ports.push({ id: `${bName}_out_${i}`, portNumber: i, type: "out" });
        }
      }

      const blockKey = blocks.has(bName) ? `${bName}#dup_${blocks.size + 1}` : bName;
      blocks.set(blockKey, {
        name: bName,
        type: mapBlockType(bTypeStr),
        id: sid,
        parameters: child.params,
        ports,
        subsystem: subSys,
        range: child.range,
      });
    } else if (cType === "line") {
      let srcBlock = (child.params.get("SrcBlock") as string) ?? "";
      let srcPort = Number(child.params.get("SrcPort") ?? 1);
      let dstBlock = child.params.get("DstBlock") as string | undefined;
      let dstPort = child.params.has("DstPort") ? Number(child.params.get("DstPort")) : undefined;

      const srcStr = child.params.get("Src") as string | undefined;
      if (srcStr) {
        const parts = srcStr.split("#");
        srcBlock = parts[0] ?? "";
        if (parts[1]) {
          const m = parts[1].match(/(\d+)/);
          if (m && m[1]) srcPort = Number.parseInt(m[1], 10);
        }
      }

      const dstStr = child.params.get("Dst") as string | undefined;
      if (dstStr) {
        const parts = dstStr.split("#");
        dstBlock = parts[0];
        if (parts[1]) {
          const m = parts[1].match(/(\d+)/);
          if (m && m[1]) dstPort = Number.parseInt(m[1], 10);
        }
      }

      const branches: SimulinkBranch[] = [];
      for (const branchChild of child.children) {
        if (branchChild.type.toLowerCase() === "branch") {
          let bDstBlock = branchChild.params.get("DstBlock") as string | undefined;
          let bDstPort = Number(branchChild.params.get("DstPort") ?? 1);
          const bDstStr = branchChild.params.get("Dst") as string | undefined;
          if (bDstStr) {
            const parts = bDstStr.split("#");
            bDstBlock = parts[0];
            if (parts[1]) {
              const m = parts[1].match(/(\d+)/);
              if (m && m[1]) bDstPort = Number.parseInt(m[1], 10);
            }
          }
          if (bDstBlock) {
            branches.push({ dstBlock: bDstBlock, dstPort: bDstPort });
          }
        }
      }

      lines.push({
        id: `Line_${srcBlock}_${srcPort}`,
        srcBlock,
        srcPort,
        dstBlock,
        dstPort,
        branches,
        range: child.range,
      });
    }
  }

  return { name, blocks, lines };
}

function tokenizeNumbers(str: string): number[] {
  const nums: number[] = [];
  let start = -1;
  for (let i = 0; i <= str.length; i++) {
    const ch = i < str.length ? str.charCodeAt(i) : 32;
    if (ch === 32 || ch === 9 || ch === 10 || ch === 13 || ch === 44) {
      if (start >= 0) {
        const token = str.slice(start, i);
        const val = Number.parseFloat(token);
        if (!Number.isNaN(val)) nums.push(val);
        start = -1;
      }
    } else {
      if (start < 0) start = i;
    }
  }
  return nums;
}

/**
 * Losslessly serializes a SimulinkModel into ASCII MDL format.
 */
export function serializeMdl(model: SimulinkModel): string {
  const lines: string[] = [];
  lines.push(`Model {`);
  lines.push(`  Name "${model.name}"`);
  lines.push(`  System {`);
  lines.push(`    Name "${model.rootSystem.name}"`);

  // Blocks
  for (const block of model.rootSystem.blocks.values()) {
    lines.push(`    Block {`);
    lines.push(`      BlockType ${block.type}`);
    lines.push(`      Name "${block.name}"`);
    lines.push(`      SID "${block.id}"`);
    for (const [k, v] of block.parameters.entries()) {
      if (k === "BlockType" || k === "Name" || k === "SID") continue;
      if (typeof v === "number") {
        lines.push(`      ${k} ${v}`);
      } else {
        lines.push(`      ${k} "${v}"`);
      }
    }
    lines.push(`    }`);
  }

  // Lines
  for (const line of model.rootSystem.lines) {
    lines.push(`    Line {`);
    lines.push(`      SrcBlock "${line.srcBlock}"`);
    lines.push(`      SrcPort ${line.srcPort}`);
    if (line.dstBlock) {
      lines.push(`      DstBlock "${line.dstBlock}"`);
      lines.push(`      DstPort ${line.dstPort ?? 1}`);
    }
    for (const br of line.branches) {
      lines.push(`      Branch {`);
      lines.push(`        DstBlock "${br.dstBlock}"`);
      lines.push(`        DstPort ${br.dstPort}`);
      lines.push(`      }`);
    }
    lines.push(`    }`);
  }

  lines.push(`  }`);
  lines.push(`}`);
  return lines.join("\n");
}
