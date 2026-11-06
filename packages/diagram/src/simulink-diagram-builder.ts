// SPDX-License-Identifier: AGPL-3.0-or-later

import { findXmlNode, findXmlNodes, parseMiniXml, unescapeXmlEntities } from "./xml-utils.js";

/**
 * @modelscript/diagram — Simulink Block Diagram Visualizer & X6 Graph Builder.
 *
 * Translates Simulink (.slx / .mdl) models and block systems into:
 * 1. Interactive AntV X6 graph model (nodes, ports, hierarchical subsystems, signal lines).
 * 2. Standalone, responsive SVG schematic renderings with domain glyphs (Integrator 1/s, Sum, Gain, TransferFcn).
 */

export interface SimulinkPortLike {
  id: string | number;
  portNumber: number;
  type: "in" | "out" | "trigger" | "enable";
  name?: string | undefined;
}

export interface SimulinkBranchLike {
  dstBlock: string;
  dstPort: number;
  points?: [number, number][] | undefined;
}

export interface SimulinkLineLike {
  id: string;
  srcBlock: string;
  srcPort: number;
  dstBlock?: string | undefined;
  dstPort?: number | undefined;
  branches?: SimulinkBranchLike[] | undefined;
  name?: string | undefined;
}

export interface SimulinkBlockLike {
  name: string;
  type: string;
  id?: string | undefined;
  parameters?: Map<string, string | number> | Record<string, string | number> | undefined;
  ports?: SimulinkPortLike[] | undefined;
  subsystem?: SimulinkSystemLike | undefined;
  position?: { x: number; y: number; width?: number; height?: number } | undefined;
}

export interface SimulinkSystemLike {
  name: string;
  blocks: Map<string, SimulinkBlockLike> | Record<string, SimulinkBlockLike> | SimulinkBlockLike[];
  lines?: SimulinkLineLike[] | undefined;
}

export interface SimulinkModelLike {
  name: string;
  rootSystem: SimulinkSystemLike;
  version?: string | undefined;
  solver?: string | undefined;
}

export interface SimulinkDiagramCell {
  id: string;
  shape: string;
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  label?: string | undefined;
  source?: { cell: string; port?: string } | { x: number; y: number } | undefined;
  target?: { cell: string; port?: string } | { x: number; y: number } | undefined;
  vertices?: { x: number; y: number }[] | undefined;
  attrs?: Record<string, unknown> | undefined;
  data?: Record<string, unknown> | undefined;
}

export interface SimulinkDiagramGraph {
  title: string;
  cells: SimulinkDiagramCell[];
}

function formatPolynomialInS(raw: string, fallback: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const inner = trimmed.replace(/^\[|\]$/g, "").trim();
  if (!inner) return fallback;
  const parts = inner.split(/[\s,]+/).filter(Boolean);
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n))) {
    return trimmed;
  }
  const deg = nums.length - 1;
  const terms: { sign: "+" | "-"; text: string }[] = [];
  for (let i = 0; i < nums.length; i++) {
    const val = nums[i]!;
    if (Math.abs(val) < 1e-12) continue;
    const p = deg - i;
    const sign: "+" | "-" = val < 0 ? "-" : "+";
    const absVal = Math.abs(val);
    const sPart = p === 0 ? "" : p === 1 ? "s" : p === 2 ? "s²" : p === 3 ? "s³" : `s^${p}`;
    const coeffPart = p > 0 && Math.abs(absVal - 1) < 1e-12 ? "" : String(absVal);
    terms.push({ sign, text: `${coeffPart}${sPart}` });
  }
  if (terms.length === 0) return "0";
  return terms
    .map((t, idx) => (idx === 0 ? (t.sign === "-" ? `-${t.text}` : t.text) : `${t.sign} ${t.text}`))
    .join(" ");
}

/**
 * Returns formatted symbol text or glyph icon indicator for standard Simulink blocks.
 */
function getBlockGlyph(
  type: string,
  params: Map<string, string | number> | Record<string, string | number> | undefined,
): { symbol: string; badge?: string } {
  const getParam = (key: string): string => {
    if (!params) return "";
    if (params instanceof Map) return String(params.get(key) ?? "");
    return String((params as Record<string, string | number>)[key] ?? "");
  };

  switch (type) {
    case "Integrator":
      return { symbol: "1/s", badge: "∫" };
    case "UnitDelay":
      return { symbol: "1/z", badge: "z⁻¹" };
    case "Gain": {
      const g = getParam("Gain") || "K";
      return { symbol: g, badge: "▶" };
    }
    case "Sum": {
      const signs = getParam("Inputs") || "++";
      return { symbol: signs, badge: "∑" };
    }
    case "Product": {
      const ops = getParam("Inputs") || "**";
      return { symbol: ops, badge: "∏" };
    }
    case "TransferFcn": {
      const num = formatPolynomialInS(getParam("Numerator"), "1");
      const den = formatPolynomialInS(getParam("Denominator"), "s + 1");
      return { symbol: `${num}\n───\n${den}`, badge: "TF" };
    }
    case "StateSpace":
      return { symbol: "ẋ = Ax + Bu\ny = Cx + Du", badge: "SS" };
    case "Constant": {
      const val = getParam("Value") || "1";
      return { symbol: val, badge: "C" };
    }
    case "Scope":
      return { symbol: "∿", badge: "SCOPE" };
    case "Inport":
      return { symbol: "IN ▶", badge: "IN" };
    case "Outport":
      return { symbol: "▶ OUT", badge: "OUT" };
    case "SubSystem":
      return { symbol: "[ SubSystem ]", badge: "SYS" };
    default:
      return { symbol: type, badge: type.slice(0, 3).toUpperCase() };
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Lightweight parser for ASCII .mdl and XML .slx text into SimulinkModelLike
 * so frontends can render fresh topological Simulink diagrams directly from source.
 */
export function parseSimulinkTextToSystem(source: string, fallbackTitle = "Simulink_Model"): SimulinkModelLike {
  const blocks: SimulinkBlockLike[] = [];
  const lines: SimulinkLineLike[] = [];
  const trimmed = source.trim();

  if (trimmed.startsWith("<")) {
    const root = parseMiniXml(source);
    const modelInfo = findXmlNode(root, "ModelInformation");
    const modelName = modelInfo?.attrs["name"] || modelInfo?.attrs["Name"] || fallbackTitle;
    const sidToName = new Map<string, string>();

    const blockNodes = findXmlNodes(root, "Block");
    for (const bNode of blockNodes) {
      const bType = bNode.attrs["BlockType"] || bNode.attrs["blocktype"] || "SubSystem";
      const bName = bNode.attrs["Name"] || bNode.attrs["name"] || `Block_${blocks.length + 1}`;
      const sid = bNode.attrs["SID"] || bNode.attrs["sid"];
      if (sid) sidToName.set(sid, bName);

      const params: Record<string, string> = {};
      for (const pNode of bNode.children) {
        if (pNode.tag.toLowerCase() === "p") {
          const pName = pNode.attrs["Name"] || pNode.attrs["name"];
          if (pName) {
            params[pName] = unescapeXmlEntities(pNode.text.trim());
          }
        }
      }
      blocks.push({ name: bName, type: bType, id: sid || bName, parameters: params });
    }

    const lineNodes = findXmlNodes(root, "Line");
    for (const lNode of lineNodes) {
      const pMap: Record<string, string> = {};
      for (const pNode of lNode.children) {
        if (pNode.tag.toLowerCase() === "p") {
          const pName = pNode.attrs["Name"] || pNode.attrs["name"];
          if (pName) {
            pMap[pName] = unescapeXmlEntities(pNode.text.trim());
          }
        }
      }

      let srcBlock = pMap["SrcBlock"] || "";
      let srcPort = Number(pMap["SrcPort"] || 1);
      let dstBlock = pMap["DstBlock"] || "";
      let dstPort = Number(pMap["DstPort"] || 1);

      if (!srcBlock && pMap["Src"]) {
        const sm = /^([^#]+)#out:(\d+)/i.exec(pMap["Src"]);
        if (sm) {
          srcBlock = sidToName.get(sm[1]!) || sm[1]!;
          srcPort = Number(sm[2]);
        }
      }
      if (!dstBlock && pMap["Dst"]) {
        const dm = /^([^#]+)#in:(\d+)/i.exec(pMap["Dst"]);
        if (dm) {
          dstBlock = sidToName.get(dm[1]!) || dm[1]!;
          dstPort = Number(dm[2]);
        }
      }

      const branchNodes = findXmlNodes(lNode, "Branch");
      const branches: SimulinkBranchLike[] = [];
      for (const brNode of branchNodes) {
        const brPMap: Record<string, string> = {};
        for (const pNode of brNode.children) {
          if (pNode.tag.toLowerCase() === "p") {
            const pName = pNode.attrs["Name"] || pNode.attrs["name"];
            if (pName) brPMap[pName] = unescapeXmlEntities(pNode.text.trim());
          }
        }
        let bDst = brPMap["DstBlock"] || "";
        let bPort = Number(brPMap["DstPort"] || 1);
        if (!bDst && brPMap["Dst"]) {
          const dm = /^([^#]+)#in:(\d+)/i.exec(brPMap["Dst"]);
          if (dm) {
            bDst = sidToName.get(dm[1]!) || dm[1]!;
            bPort = Number(dm[2]);
          }
        }
        if (bDst) {
          branches.push({ dstBlock: bDst, dstPort: bPort });
        }
      }

      if (srcBlock && (dstBlock || branches.length > 0)) {
        lines.push({
          id: `line_${lines.length + 1}`,
          srcBlock,
          srcPort,
          dstBlock: dstBlock || undefined,
          dstPort: dstPort || undefined,
          branches: branches.length > 0 ? branches : undefined,
        });
      }
    }

    return {
      name: modelName,
      rootSystem: { name: modelName, blocks, lines },
    };
  }

  // ASCII .mdl format
  const modelNameMatch = /\bModel\s*\{[\s\S]*?\bName\s+"([^"]+)"/i.exec(source);
  const sysNameMatch = /\bSystem\s*\{[\s\S]*?\bName\s+"([^"]+)"/i.exec(source);
  const modelName = modelNameMatch?.[1] || sysNameMatch?.[1] || fallbackTitle;

  const blockRe = /\bBlock\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
  let bm: RegExpExecArray | null;
  while ((bm = blockRe.exec(source)) !== null) {
    const body = bm[1] || "";
    const bType = /\bBlockType\s+([A-Za-z0-9_]+)/.exec(body)?.[1] || "Block";
    const bName = /\bName\s+"([^"]+)"/.exec(body)?.[1] || `Block_${blocks.length + 1}`;
    const sid = /\bSID\s+"([^"]+)"/.exec(body)?.[1] || bName;
    const params: Record<string, string> = {};
    const kvRe = /\b([A-Za-z_][A-Za-z0-9_]*)\s+(?:"([^"]*)"|(\[[^\]]*\]|[^\s\r\n"{}]+))/g;
    let km: RegExpExecArray | null;
    while ((km = kvRe.exec(body)) !== null) {
      const key = km[1]!;
      const val = km[2] !== undefined ? km[2] : (km[3] ?? "");
      if (key !== "BlockType" && key !== "Name" && key !== "SID") {
        params[key] = val;
      }
    }
    blocks.push({ name: bName, type: bType, id: sid, parameters: params });
  }

  const lineRe = /\bLine\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
  let lm: RegExpExecArray | null;
  while ((lm = lineRe.exec(source)) !== null) {
    const body = lm[1] || "";
    const srcBlock = /\bSrcBlock\s+"([^"]+)"/.exec(body)?.[1];
    const srcPort = Number(/\bSrcPort\s+(\d+)/.exec(body)?.[1] || 1);
    if (!srcBlock) continue;

    const branches: SimulinkBranchLike[] = [];
    const branchRe = /\bBranch\s*\{([^{}]*)\}/g;
    let brm: RegExpExecArray | null;
    while ((brm = branchRe.exec(body)) !== null) {
      const bBody = brm[1] || "";
      const bDst = /\bDstBlock\s+"([^"]+)"/.exec(bBody)?.[1];
      const bPort = Number(/\bDstPort\s+(\d+)/.exec(bBody)?.[1] || 1);
      if (bDst) branches.push({ dstBlock: bDst, dstPort: bPort });
    }

    const bodyWithoutBranches = body.replace(/\bBranch\s*\{[^{}]*\}/g, "");
    const dstBlock = /\bDstBlock\s+"([^"]+)"/.exec(bodyWithoutBranches)?.[1];
    const dstPort = Number(/\bDstPort\s+(\d+)/.exec(bodyWithoutBranches)?.[1] || 1);

    lines.push({
      id: `line_${lines.length + 1}`,
      srcBlock,
      srcPort,
      dstBlock,
      dstPort,
      branches: branches.length > 0 ? branches : undefined,
    });
  }

  return {
    name: modelName,
    rootSystem: { name: modelName, blocks, lines },
  };
}

/**
 * Builds an interactive AntV X6 diagram graph for a Simulink model or subsystem.
 */
export function buildSimulinkDiagram(modelOrSystem: SimulinkModelLike | SimulinkSystemLike): SimulinkDiagramGraph {
  const sys: SimulinkSystemLike = "rootSystem" in modelOrSystem ? modelOrSystem.rootSystem : modelOrSystem;
  const title = "name" in modelOrSystem ? modelOrSystem.name : sys.name;
  const cells: SimulinkDiagramCell[] = [];

  // Extract blocks
  const blocks: SimulinkBlockLike[] = [];
  if (Array.isArray(sys.blocks)) {
    blocks.push(...sys.blocks);
  } else if (sys.blocks instanceof Map) {
    for (const b of sys.blocks.values()) blocks.push(b);
  } else if (typeof sys.blocks === "object") {
    for (const b of Object.values(sys.blocks)) blocks.push(b);
  }

  const lines = sys.lines || [];

  // Flatten all directed connections for topological layout and port counting
  interface FlatConn {
    src: string;
    srcPort: number;
    dst: string;
    dstPort: number;
  }
  const flatConns: FlatConn[] = [];
  for (const line of lines) {
    if (line.dstBlock) {
      flatConns.push({
        src: line.srcBlock,
        srcPort: line.srcPort || 1,
        dst: line.dstBlock,
        dstPort: line.dstPort ?? 1,
      });
    }
    if (line.branches) {
      for (const br of line.branches) {
        flatConns.push({
          src: line.srcBlock,
          srcPort: line.srcPort || 1,
          dst: br.dstBlock,
          dstPort: br.dstPort || 1,
        });
      }
    }
  }

  // Compute block dimensions
  const blockIds: string[] = [];
  const blockById = new Map<string, SimulinkBlockLike>();
  const blockSizes = new Map<string, { width: number; height: number }>();

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const blockId = block.name || block.id || `block_${i}`;
    blockIds.push(blockId);
    blockById.set(blockId, block);
    const { symbol } = getBlockGlyph(block.type, block.parameters);
    const maxSymbolLine = Math.max(...symbol.split("\n").map((l) => l.length), 4);
    const defaultWidth =
      block.type === "Sum" || block.type === "Product"
        ? 52
        : block.type === "TransferFcn" || block.type === "StateSpace"
          ? Math.max(122, Math.min(168, maxSymbolLine * 7.5 + 26))
          : Math.max(92, Math.min(130, maxSymbolLine * 7.5 + 28));
    const defaultHeight =
      block.type === "Sum" || block.type === "Product"
        ? 52
        : block.type === "TransferFcn" || block.type === "StateSpace"
          ? 64
          : 56;
    blockSizes.set(blockId, {
      width: block.position?.width || Math.round(defaultWidth),
      height: block.position?.height || defaultHeight,
    });
  }

  // Compute topological ranks for blocks without explicit coordinates
  const outgoing = new Map<string, FlatConn[]>();
  const incoming = new Map<string, FlatConn[]>();
  for (const id of blockIds) {
    outgoing.set(id, []);
    incoming.set(id, []);
  }
  for (const c of flatConns) {
    if (outgoing.has(c.src) && incoming.has(c.dst) && c.src !== c.dst) {
      outgoing.get(c.src)!.push(c);
      incoming.get(c.dst)!.push(c);
    }
  }

  const ranks = new Map<string, number>();
  for (const id of blockIds) ranks.set(id, 0);

  // Longest-path DAG relaxation (bounded by blockIds.length - 1 to guard against feedback cycles)
  const maxRankCap = Math.max(1, blockIds.length - 1);
  for (let iter = 0; iter < blockIds.length; iter++) {
    let changed = false;
    for (const c of flatConns) {
      if (!ranks.has(c.src) || !ranks.has(c.dst) || c.src === c.dst) continue;
      // Ignore back-edges where dst is an ancestor of src with lower index
      const srcIdx = blockIds.indexOf(c.src);
      const dstIdx = blockIds.indexOf(c.dst);
      if (srcIdx > dstIdx && (ranks.get(c.src) ?? 0) >= (ranks.get(c.dst) ?? 0) && iter > 0) {
        continue;
      }
      const nextRank = Math.min(maxRankCap, (ranks.get(c.src) ?? 0) + 1);
      if (nextRank > (ranks.get(c.dst) ?? 0)) {
        ranks.set(c.dst, nextRank);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Pull source nodes (in-degree 0) forward so they sit directly in the column preceding their earliest consumer
  for (const id of blockIds) {
    const inc = incoming.get(id) ?? [];
    const out = outgoing.get(id) ?? [];
    if (inc.length === 0 && out.length > 0) {
      const minSuccRank = Math.min(...out.map((e) => ranks.get(e.dst) ?? 1));
      if (minSuccRank > 1) {
        ranks.set(id, minSuccRank - 1);
      }
    }
  }

  // Group blocks by rank
  const rankGroups = new Map<number, string[]>();
  let maxRank = 0;
  for (const id of blockIds) {
    const r = ranks.get(id) ?? 0;
    maxRank = Math.max(maxRank, r);
    if (!rankGroups.has(r)) rankGroups.set(r, []);
    rankGroups.get(r)!.push(id);
  }

  // Compute column X positions based on widest block in each rank
  const rankX = new Map<number, number>();
  let cursorX = 70;
  for (let r = 0; r <= maxRank; r++) {
    const group = rankGroups.get(r);
    if (!group || group.length === 0) continue;
    rankX.set(r, cursorX);
    const maxW = Math.max(...group.map((id) => blockSizes.get(id)?.width ?? 96));
    cursorX += maxW + 84;
  }

  // Compute row Y positions per rank with barycenter ordering & chain alignment
  const autoCoords = new Map<string, { x: number; y: number }>();
  const centerY = 165;
  const rowStep = 116;

  for (let r = 0; r <= maxRank; r++) {
    const group = rankGroups.get(r);
    if (!group || group.length === 0) continue;

    // Sort blocks in this rank by predecessor Y + destination port number
    group.sort((a, b) => {
      const incA = incoming.get(a) ?? [];
      const incB = incoming.get(b) ?? [];
      const outA = outgoing.get(a) ?? [];
      const outB = outgoing.get(b) ?? [];
      const portScoreA = outA.length > 0 ? Math.min(...outA.map((e) => e.dstPort)) : 99;
      const portScoreB = outB.length > 0 ? Math.min(...outB.map((e) => e.dstPort)) : 99;
      const predYA =
        incA.length > 0
          ? incA.reduce((acc, e) => acc + (autoCoords.get(e.src)?.y ?? centerY), 0) / incA.length
          : centerY + (portScoreA - 1.5) * 40;
      const predYB =
        incB.length > 0
          ? incB.reduce((acc, e) => acc + (autoCoords.get(e.src)?.y ?? centerY), 0) / incB.length
          : centerY + (portScoreB - 1.5) * 40;
      if (Math.abs(predYA - predYB) > 4) return predYA - predYB;
      return blockIds.indexOf(a) - blockIds.indexOf(b);
    });

    const colX = rankX.get(r) ?? 70;
    if (group.length === 1) {
      const id = group[0]!;
      const h = blockSizes.get(id)?.height ?? 56;
      const inc = incoming.get(id) ?? [];
      // If single predecessor in previous rank and that predecessor had multiple outputs, align with predecessor
      let targetCenterY = centerY;
      if (inc.length === 1) {
        const predId = inc[0]!.src;
        const predCoord = autoCoords.get(predId);
        const predH = blockSizes.get(predId)?.height ?? 56;
        const predGroup = rankGroups.get(ranks.get(predId) ?? -1) ?? [];
        if (predCoord && predGroup.length > 1) {
          targetCenterY = predCoord.y + predH / 2;
        }
      }
      autoCoords.set(id, { x: colX, y: Math.round(targetCenterY - h / 2) });
    } else {
      const startCenterY = centerY - ((group.length - 1) * rowStep) / 2;
      for (let idx = 0; idx < group.length; idx++) {
        const id = group[idx]!;
        const h = blockSizes.get(id)?.height ?? 56;
        const rowCenterY = startCenterY + idx * rowStep;
        autoCoords.set(id, { x: colX, y: Math.round(rowCenterY - h / 2) });
      }
    }
  }

  // Backward alignment pass: if a single-block earlier rank feeds a single block in the next rank, align its Y
  for (let r = maxRank - 1; r >= 0; r--) {
    const group = rankGroups.get(r);
    if (!group || group.length !== 1) continue;
    const id = group[0]!;
    const inc = incoming.get(id) ?? [];
    const out = outgoing.get(id) ?? [];
    if (inc.length === 0 && out.length === 1) {
      const succId = out[0]!.dst;
      const succCoord = autoCoords.get(succId);
      const succH = blockSizes.get(succId)?.height ?? 56;
      const h = blockSizes.get(id)?.height ?? 56;
      if (succCoord) {
        autoCoords.set(id, {
          x: autoCoords.get(id)!.x,
          y: Math.round(succCoord.y + succH / 2 - h / 2),
        });
      }
    }
  }

  // Track max input port count per block so edges can attach at distinct port offsets
  const maxInPorts = new Map<string, number>();
  for (const c of flatConns) {
    maxInPorts.set(c.dst, Math.max(maxInPorts.get(c.dst) ?? 1, c.dstPort));
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const blockId = blockIds[i]!;
    const size = blockSizes.get(blockId) ?? { width: 96, height: 56 };
    const width = size.width;
    const height = size.height;

    let x = block.position?.x;
    let y = block.position?.y;

    if (x === undefined || y === undefined || (x === 0 && y === 0)) {
      const computed = autoCoords.get(blockId) ?? { x: 70 + i * 150, y: 120 };
      x = computed.x;
      y = computed.y;
    }

    const { symbol, badge } = getBlockGlyph(block.type, block.parameters);
    const isRound = block.type === "Sum" || block.type === "Product";
    const cellShape = isRound ? "circle" : "rect";

    cells.push({
      id: `block_${blockId}`,
      shape: cellShape,
      x,
      y,
      width,
      height,
      label: `${symbol}\n${block.name}`,
      attrs: {
        body: {
          fill: isRound ? "#1e293b" : "#0f172a",
          stroke: block.type === "SubSystem" ? "#a855f7" : block.type === "Scope" ? "#eab308" : "#38bdf8",
          strokeWidth: 2,
          rx: isRound ? undefined : 6,
          ry: isRound ? undefined : 6,
        },
        label: {
          fill: "#f8fafc",
          fontSize: 11,
          fontFamily: "Inter, system-ui, sans-serif",
          textAnchor: "middle",
        },
      },
      data: {
        blockName: block.name,
        blockType: block.type,
        badge,
        symbol,
        inPortCount: maxInPorts.get(blockId) ?? 1,
        parameters: block.parameters instanceof Map ? Object.fromEntries(block.parameters) : block.parameters,
      },
    });
  }

  // Extract and draw lines/connections
  let lineIdx = 1;

  for (const line of lines) {
    const srcId = `block_${line.srcBlock}`;

    // Direct destination
    if (line.dstBlock) {
      const dstId = `block_${line.dstBlock}`;
      cells.push({
        id: line.id || `line_${lineIdx++}`,
        shape: "edge",
        source: { cell: srcId, port: `out_${line.srcPort}` },
        target: { cell: dstId, port: `in_${line.dstPort ?? 1}` },
        label: line.name,
        attrs: {
          line: {
            stroke: "#38bdf8",
            strokeWidth: 2,
            targetMarker: {
              name: "block",
              width: 8,
              height: 6,
            },
          },
        },
        data: {
          srcBlock: line.srcBlock,
          srcPort: line.srcPort,
          dstBlock: line.dstBlock,
          dstPort: line.dstPort ?? 1,
        },
      });
    }

    // Branch destinations (signal fan-out)
    if (line.branches && line.branches.length > 0) {
      for (const branch of line.branches) {
        const dstId = `block_${branch.dstBlock}`;
        cells.push({
          id: `branch_${lineIdx++}`,
          shape: "edge",
          source: { cell: srcId, port: `out_${line.srcPort}` },
          target: { cell: dstId, port: `in_${branch.dstPort}` },
          attrs: {
            line: {
              stroke: "#38bdf8",
              strokeWidth: 2,
              strokeDasharray: "4 2",
              targetMarker: {
                name: "block",
                width: 8,
                height: 6,
              },
            },
          },
          data: {
            srcBlock: line.srcBlock,
            srcPort: line.srcPort,
            dstBlock: branch.dstBlock,
            dstPort: branch.dstPort,
          },
        });
      }
    }
  }

  return { title, cells };
}

/**
 * Renders a Simulink model or subsystem into a standalone, dark-mode SVG drawing.
 */
export function renderSimulinkSvg(modelOrSystem: SimulinkModelLike | SimulinkSystemLike): string {
  const diag = buildSimulinkDiagram(modelOrSystem);

  // Compute bounding box including block labels below nodes
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const cell of diag.cells) {
    if (cell.x !== undefined && cell.y !== undefined) {
      const w = cell.width ?? 96;
      const h = cell.height ?? 56;
      const bName = (cell.data?.["blockName"] as string) || "";
      const labelHalfW = Math.max(w / 2, bName.length * 3.1 + 8);
      const cx = cell.x + w / 2;
      minX = Math.min(minX, cx - labelHalfW);
      minY = Math.min(minY, cell.y);
      maxX = Math.max(maxX, cx + labelHalfW);
      maxY = Math.max(maxY, cell.y + h + 26);
    }
  }

  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 800;
    maxY = 360;
  }

  const padX = 44;
  const padTop = 54;
  const padBottom = 28;
  const vbX = Math.round(minX - padX);
  const vbY = Math.round(minY - padTop);
  const width = Math.round(Math.max(680, maxX - minX + padX * 2));
  const height = Math.round(Math.max(260, maxY - minY + padTop + padBottom));
  const viewBox = `${vbX} ${vbY} ${width} ${height}`;

  const nodeMap = new Map<string, SimulinkDiagramCell>();
  for (const cell of diag.cells) {
    if (cell.x !== undefined) nodeMap.set(cell.id, cell);
  }

  const getPortY = (node: SimulinkDiagramCell, portNum: number, totalPorts: number): number => {
    const ny = node.y ?? 0;
    const nh = node.height ?? 56;
    if (totalPorts <= 1) return ny + nh / 2;
    const clampedPort = Math.max(1, Math.min(totalPorts, portNum));
    return Math.round(ny + (nh * clampedPort) / (totalPorts + 1));
  };

  let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  svg += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}" style="background-color: #0b0f19; font-family: Inter, system-ui, -apple-system, sans-serif;">\n`;
  svg += `  <defs>\n`;
  svg += `    <marker id="simulink-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n`;
  svg += `      <path d="M 0 1 L 9 5 L 0 9 z" fill="#38bdf8" />\n`;
  svg += `    </marker>\n`;
  svg += `    <filter id="simulink-glow" x="-20%" y="-20%" width="140%" height="140%">\n`;
  svg += `      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#0284c7" flood-opacity="0.22" />\n`;
  svg += `    </filter>\n`;
  svg += `  </defs>\n\n`;

  // Explicit dark background rect so light-mode stages never wash out light SVG text
  svg += `  <rect x="${vbX}" y="${vbY}" width="${width}" height="${height}" rx="8" fill="#0b0f19" />\n`;

  // Title header
  svg += `  <text x="${vbX + 24}" y="${vbY + 30}" fill="#f8fafc" font-size="14" font-weight="700" letter-spacing="0.2">${escapeXml(diag.title)} — Simulink Block Diagram</text>\n\n`;

  // Draw Edges Layer
  svg += `  <g id="simulink-lines-layer">\n`;
  for (const cell of diag.cells) {
    if (cell.shape === "edge" && cell.source && cell.target) {
      const srcId = typeof cell.source === "object" && "cell" in cell.source ? cell.source.cell : null;
      const tgtId = typeof cell.target === "object" && "cell" in cell.target ? cell.target.cell : null;
      if (!srcId || !tgtId) continue;

      const srcNode = nodeMap.get(srcId);
      const tgtNode = nodeMap.get(tgtId);
      if (!srcNode || !tgtNode) continue;

      const dstPort = Number(cell.data?.["dstPort"] ?? 1);
      const totalIn = Number(tgtNode.data?.["inPortCount"] ?? 1);

      const x1 = (srcNode.x ?? 0) + (srcNode.width ?? 96);
      const y1 = Math.round((srcNode.y ?? 0) + (srcNode.height ?? 56) / 2);
      const x2 = tgtNode.x ?? 0;
      const y2 = getPortY(tgtNode, dstPort, totalIn);

      const dx = Math.max(28, Math.abs(x2 - x1) * 0.45);
      const pathD =
        Math.abs(y1 - y2) <= 2 && x2 > x1
          ? `M ${x1} ${y1} L ${x2} ${y2}`
          : `M ${x1} ${y1} C ${Math.round(x1 + dx)} ${y1}, ${Math.round(x2 - dx)} ${y2}, ${x2} ${y2}`;
      const isBranch = cell.id.startsWith("branch_");
      const strokeDash = isBranch ? ` stroke-dasharray="5 3"` : "";

      svg += `    <path id="${escapeXml(cell.id)}" d="${pathD}" fill="none" stroke="#38bdf8" stroke-width="2" marker-end="url(#simulink-arrow)"${strokeDash} opacity="0.9" />\n`;
      if (cell.label) {
        const midX = Math.round((x1 + x2) / 2);
        svg += `    <text x="${midX}" y="${Math.round((y1 + y2) / 2 - 6)}" fill="#94a3b8" font-size="10" text-anchor="middle">${escapeXml(cell.label)}</text>\n`;
      }
    }
  }
  svg += `  </g>\n\n`;

  // Draw Nodes Layer
  svg += `  <g id="simulink-blocks-layer">\n`;
  for (const cell of diag.cells) {
    if (cell.x !== undefined && cell.y !== undefined) {
      const w = cell.width ?? 96;
      const h = cell.height ?? 56;
      const cx = Math.round(cell.x + w / 2);
      const cy = Math.round(cell.y + h / 2);
      const bType = (cell.data?.["blockType"] as string) || "Block";
      const bName = (cell.data?.["blockName"] as string) || cell.label || "";
      const badge = (cell.data?.["badge"] as string) || "";
      const symbol = (cell.data?.["symbol"] as string) || (cell.label ?? "").split("\n")[0] || bType;
      const totalIn = Number(cell.data?.["inPortCount"] ?? 1);

      svg += `    <g id="${escapeXml(cell.id)}" filter="url(#simulink-glow)">\n`;

      if (cell.shape === "circle") {
        const r = Math.round(w / 2);
        svg += `      <circle cx="${cx}" cy="${cy}" r="${r}" fill="#1e293b" stroke="#38bdf8" stroke-width="2" />\n`;
        svg += `      <text x="${cx}" y="${cy + 5}" fill="#f8fafc" font-size="14" font-weight="700" text-anchor="middle">${escapeXml(badge)}</text>\n`;
        if (bType === "Sum" && symbol.length >= 2) {
          for (let p = 1; p <= Math.min(totalIn, symbol.length); p++) {
            const signChar = symbol[p - 1] === "-" ? "−" : "+";
            const py = getPortY(cell, p, totalIn);
            svg += `      <text x="${cell.x + 11}" y="${py + 3}" fill="#94a3b8" font-size="10" font-weight="700" text-anchor="middle">${signChar}</text>\n`;
          }
        }
      } else {
        const strokeColor =
          bType === "SubSystem"
            ? "#a855f7"
            : bType === "Scope" || bType === "Outport"
              ? "#eab308"
              : bType === "Inport" || bType === "Constant"
                ? "#10b981"
                : "#38bdf8";
        svg += `      <rect x="${cell.x}" y="${cell.y}" width="${w}" height="${h}" rx="6" fill="#1e293b" stroke="${strokeColor}" stroke-width="2" />\n`;

        // Badge pill in top-left corner
        const badgeW = Math.max(24, badge.length * 5.5 + 8);
        svg += `      <rect x="${cell.x + 6}" y="${cell.y + 5}" width="${Math.round(badgeW)}" height="13" rx="3" fill="${strokeColor}" fill-opacity="0.18" />\n`;
        svg += `      <text x="${Math.round(cell.x + 6 + badgeW / 2)}" y="${cell.y + 14.5}" fill="${strokeColor}" font-size="8" font-weight="700" text-anchor="middle">${escapeXml(badge)}</text>\n`;

        // Central math symbol or fraction
        const symLines = symbol.split("\n");
        if (bType === "TransferFcn" && symLines.length >= 3) {
          const numText = symLines[0] ?? "1";
          const denText = symLines[2] ?? "s+1";
          svg += `      <text x="${cx}" y="${cy - 2}" fill="#f8fafc" font-size="10.5" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-weight="600" text-anchor="middle">${escapeXml(numText)}</text>\n`;
          svg += `      <line x1="${cell.x + 12}" y1="${cy + 3}" x2="${cell.x + w - 12}" y2="${cy + 3}" stroke="#64748b" stroke-width="1.25" />\n`;
          svg += `      <text x="${cx}" y="${cy + 15}" fill="#cbd5e1" font-size="10.5" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-weight="600" text-anchor="middle">${escapeXml(denText)}</text>\n`;
        } else {
          const bodyText = symLines[0] ?? bType;
          svg += `      <text x="${cx}" y="${cy + 8}" fill="#f8fafc" font-size="12" font-weight="600" text-anchor="middle">${escapeXml(bodyText)}</text>\n`;
        }
      }

      // Label cleanly below the block
      svg += `      <text x="${cx}" y="${cell.y + h + 15}" fill="#cbd5e1" font-size="10" font-weight="500" text-anchor="middle">${escapeXml(bName)}</text>\n`;

      // Port pin markers
      if (bType !== "Inport" && bType !== "Constant") {
        for (let p = 1; p <= totalIn; p++) {
          const py = getPortY(cell, p, totalIn);
          svg += `      <circle cx="${cell.x}" cy="${py}" r="3" fill="#38bdf8" />\n`;
        }
      }
      if (bType !== "Outport" && bType !== "Scope") {
        svg += `      <circle cx="${cell.x + w}" cy="${cy}" r="3" fill="#38bdf8" />\n`;
      }
      svg += `    </g>\n`;
    }
  }
  svg += `  </g>\n`;

  svg += `</svg>\n`;
  return svg;
}
