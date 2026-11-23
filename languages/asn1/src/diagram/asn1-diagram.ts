// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure SVG generator for ASN.1 schema type-dependency graphs and X.690 BER/DER TLV byte-layout diagrams.
 */

import { bytesToHex, formatBerTagName } from "../parser/ber-der.js";
import { buildAsn1TypeGraph, computeWireSizeBounds, type WireSizeBounds } from "../solver/wire-analyzer.js";
import type { Asn1Module, Asn1TypeExpr, BerTlvNode } from "../types.js";

export interface Asn1DiagramNode {
  id: string;
  label: string;
  kind: string;
  fieldCount: number;
  bounds: WireSizeBounds;
  line: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Asn1DiagramEdge {
  from: string;
  to: string;
  label: string;
  optional: boolean;
}

export interface Asn1DiagramData {
  moduleName: string;
  tagDefault: string;
  nodes: Asn1DiagramNode[];
  edges: Asn1DiagramEdge[];
  width: number;
  height: number;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function typeKindBadge(expr: Asn1TypeExpr): { label: string; color: string; count: number } {
  switch (expr.kind) {
    case "sequence":
      return { label: "SEQUENCE", color: "#38bdf8", count: expr.fields.length };
    case "set":
      return { label: "SET", color: "#818cf8", count: expr.fields.length };
    case "choice":
      return { label: "CHOICE", color: "#c084fc", count: expr.alternatives.length };
    case "enumerated":
      return { label: "ENUM", color: "#34d399", count: expr.items.length };
    case "sequenceOf":
      return { label: "SEQ OF", color: "#22d3ee", count: 1 };
    case "setOf":
      return { label: "SET OF", color: "#a78bfa", count: 1 };
    case "tagged":
      return { label: `[${expr.tag.number}]`, color: "#fbbf24", count: 1 };
    case "primitive":
      return { label: expr.primitive, color: "#94a3b8", count: 0 };
    case "reference":
      return { label: "ALIAS", color: "#64748b", count: 1 };
  }
}

/**
 * Computes layout coordinates for all ASN.1 type nodes and dependency edges.
 */
export function buildAsn1DiagramData(module: Asn1Module): Asn1DiagramData {
  const graph = buildAsn1TypeGraph(module);
  const boundsMap = computeWireSizeBounds(module);
  const typeByName = new Map(module.types.map((t) => [t.name, t]));

  const cols = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(Math.max(1, module.types.length)))));
  const cardW = 210;
  const cardH = 74;
  const gapX = 56;
  const gapY = 44;
  const padX = 28;
  const padY = 58;

  const nodes: Asn1DiagramNode[] = [];
  const ordered = [...graph.topologicalOrder].reverse();

  ordered.forEach((name, idx) => {
    const t = typeByName.get(name);
    if (!t) return;
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const badge = typeKindBadge(t.type);
    const b = boundsMap.get(name) ?? {
      typeName: name,
      minBytes: 2,
      maxBytes: 64,
      isUnbounded: true,
      minTlvOverhead: 2,
      maxTlvOverhead: 2,
    };
    nodes.push({
      id: name,
      label: name,
      kind: badge.label,
      fieldCount: badge.count,
      bounds: b,
      line: t.span.startLine,
      x: padX + col * (cardW + gapX),
      y: padY + row * (cardH + gapY),
      width: cardW,
      height: cardH,
    });
  });

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: Asn1DiagramEdge[] = graph.edges
    .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))
    .map((e) => ({
      from: e.from,
      to: e.to,
      label: e.fieldName ?? "",
      optional: e.optional,
    }));

  const rows = Math.max(1, Math.ceil(nodes.length / cols));
  const width = Math.max(520, padX * 2 + cols * cardW + Math.max(0, cols - 1) * gapX);
  const height = Math.max(220, padY + rows * cardH + Math.max(0, rows - 1) * gapY + 32);

  return {
    moduleName: module.name,
    tagDefault: module.tagDefault,
    nodes,
    edges,
    width,
    height,
  };
}

/**
 * Renders a pure SVG diagram of a decoded X.690 BER/DER Tag-Length-Value byte layout.
 */
export function renderBerTlvSvg(root: BerTlvNode): string {
  const flat: Array<{ node: BerTlvNode; depth: number }> = [];
  const walk = (n: BerTlvNode, depth: number): void => {
    flat.push({ node: n, depth });
    if (n.children) {
      for (const c of n.children) walk(c, depth + 1);
    }
  };
  walk(root, 0);

  const rowH = 38;
  const headerH = 44;
  const width = 680;
  const height = headerH + flat.length * rowH + 20;

  const lines: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `<rect width="${width}" height="${height}" rx="8" fill="#0f172a"/>`,
    `<text x="16" y="24" font-family="ui-sans-serif, system-ui, sans-serif" font-size="13" font-weight="700" fill="#f8fafc">X.690 BER/DER TLV Byte Layout (${root.totalLength} B total)</text>`,
    `<rect x="440" y="10" width="58" height="18" rx="4" fill="#0284c7" fill-opacity="0.28" stroke="#38bdf8"/>`,
    `<text x="469" y="22" text-anchor="middle" font-family="monospace" font-size="10" fill="#7dd3fc">TAG</text>`,
    `<rect x="506" y="10" width="66" height="18" rx="4" fill="#d97706" fill-opacity="0.28" stroke="#fbbf24"/>`,
    `<text x="539" y="22" text-anchor="middle" font-family="monospace" font-size="10" fill="#fde68a">LEN</text>`,
    `<rect x="580" y="10" width="84" height="18" rx="4" fill="#059669" fill-opacity="0.28" stroke="#34d399"/>`,
    `<text x="622" y="22" text-anchor="middle" font-family="monospace" font-size="10" fill="#6ee7b7">VALUE</text>`,
  ];

  flat.forEach(({ node, depth }, idx) => {
    const y = headerH + idx * rowH;
    const indent = 16 + depth * 18;
    const tagHex = bytesToHex(node.rawTagBytes, "");
    const lenHex = bytesToHex(node.rawLengthBytes, "");
    const valPreview = node.constructed
      ? `{ ${node.children?.length ?? 0} child TLV(s) }`
      : typeof node.decodedValue === "bigint"
        ? node.decodedValue.toString()
        : typeof node.decodedValue === "string" ||
            typeof node.decodedValue === "number" ||
            typeof node.decodedValue === "boolean"
          ? String(node.decodedValue)
          : bytesToHex(node.valueBytes.slice(0, 12));

    const label = formatBerTagName(node);
    const issueStroke = node.derIssues.length > 0 ? "#f87171" : "#334155";

    lines.push(
      `<g data-offset="${node.offset}">`,
      `<rect x="${indent}" y="${y}" width="${width - indent - 16}" height="30" rx="5" fill="#1e293b" stroke="${issueStroke}" stroke-width="1"/>`,
      // Tag pill
      `<rect x="${indent + 6}" y="${y + 5}" width="46" height="20" rx="3" fill="#0284c7" fill-opacity="0.25" stroke="#38bdf8" stroke-width="0.9"/>`,
      `<text x="${indent + 29}" y="${y + 19}" text-anchor="middle" font-family="monospace" font-size="10" fill="#7dd3fc">${escapeXml(tagHex)}</text>`,
      // Length pill
      `<rect x="${indent + 58}" y="${y + 5}" width="46" height="20" rx="3" fill="#d97706" fill-opacity="0.25" stroke="#fbbf24" stroke-width="0.9"/>`,
      `<text x="${indent + 81}" y="${y + 19}" text-anchor="middle" font-family="monospace" font-size="10" fill="#fde68a">${escapeXml(lenHex)}</text>`,
      // Type + Value
      `<text x="${indent + 114}" y="${y + 19}" font-family="monospace" font-size="10.5" font-weight="600" fill="#f1f5f9">${escapeXml(label)}</text>`,
      `<text x="${indent + 260}" y="${y + 19}" font-family="monospace" font-size="10" fill="#6ee7b7">${escapeXml(valPreview.slice(0, 40))}</text>`,
      `<text x="${width - 26}" y="${y + 19}" text-anchor="end" font-family="monospace" font-size="9.5" fill="#94a3b8">@${node.offset} (${node.length}B)</text>`,
      `</g>`,
    );
  });

  lines.push(`</svg>`);
  return lines.join("\n");
}

/**
 * Renders a pure SVG ASN.1 schema type-dependency graph (optionally appending a BER/DER TLV layout).
 */
export function renderAsn1DiagramSvg(module: Asn1Module, sampleTlv?: BerTlvNode): string {
  const data = buildAsn1DiagramData(module);
  const nodeById = new Map(data.nodes.map((n) => [n.id, n]));
  const typeByName = new Map(module.types.map((t) => [t.name, t]));

  const lines: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${data.width} ${data.height}" width="${data.width}" height="${data.height}">`,
    `<defs>`,
    `<marker id="asn1-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">`,
    `<path d="M 0 1 L 10 5 L 0 9 z" fill="#64748b"/>`,
    `</marker>`,
    `</defs>`,
    `<rect width="${data.width}" height="${data.height}" rx="8" fill="#0f172a"/>`,
    `<text x="20" y="28" font-family="ui-sans-serif, system-ui, sans-serif" font-size="14" font-weight="700" fill="#f8fafc">${escapeXml(data.moduleName)} — ASN.1 Type Graph</text>`,
    `<text x="${data.width - 20}" y="28" text-anchor="end" font-family="monospace" font-size="10.5" fill="#94a3b8">${escapeXml(data.tagDefault)} TAGS · ${data.nodes.length} types</text>`,
  ];

  // Edges
  for (const e of data.edges) {
    const src = nodeById.get(e.from);
    const dst = nodeById.get(e.to);
    if (!src || !dst) continue;
    const x1 = src.x + src.width / 2;
    const y1 = src.y + src.height;
    const x2 = dst.x + dst.width / 2;
    const y2 = dst.y;
    const midY = (y1 + y2) / 2;
    const dash = e.optional ? ` stroke-dasharray="4 3"` : "";
    lines.push(
      `<path d="M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}" fill="none" stroke="${e.optional ? "#94a3b8" : "#38bdf8"}" stroke-width="1.4"${dash} marker-end="url(#asn1-arrow)"/>`,
    );
    if (e.label) {
      const lx = (x1 + x2) / 2;
      const ly = midY - 4;
      lines.push(
        `<text x="${lx}" y="${ly}" text-anchor="middle" font-family="monospace" font-size="9" fill="#cbd5e1">${escapeXml(e.label)}${e.optional ? "?" : ""}</text>`,
      );
    }
  }

  // Nodes
  for (const n of data.nodes) {
    const t = typeByName.get(n.id);
    const badge = t ? typeKindBadge(t.type) : { label: n.kind, color: "#38bdf8", count: n.fieldCount };
    const sizeText = n.bounds.isUnbounded
      ? `${n.bounds.minBytes}..${n.bounds.maxBytes}+ B`
      : n.bounds.minBytes === n.bounds.maxBytes
        ? `${n.bounds.minBytes} B`
        : `${n.bounds.minBytes}..${n.bounds.maxBytes} B`;
    lines.push(
      `<g data-line="${n.line}">`,
      `<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="7" fill="#1e293b" stroke="${badge.color}" stroke-width="1.6"/>`,
      `<rect x="${n.x + 8}" y="${n.y + 8}" width="66" height="16" rx="3" fill="${badge.color}" fill-opacity="0.22"/>`,
      `<text x="${n.x + 41}" y="${n.y + 19}" text-anchor="middle" font-family="monospace" font-size="8.5" font-weight="600" fill="${badge.color}">${escapeXml(badge.label.slice(0, 10))}</text>`,
      `<text x="${n.x + n.width - 10}" y="${n.y + 19}" text-anchor="end" font-family="monospace" font-size="9" fill="#94a3b8">${escapeXml(sizeText)}</text>`,
      `<text x="${n.x + 10}" y="${n.y + 44}" font-family="monospace" font-size="12" font-weight="700" fill="#f8fafc">${escapeXml(n.label.slice(0, 22))}</text>`,
      `<text x="${n.x + 10}" y="${n.y + 62}" font-family="monospace" font-size="9.5" fill="#94a3b8">TLV overhead: ${n.bounds.minTlvOverhead}..${n.bounds.maxTlvOverhead} B</text>`,
      `</g>`,
    );
  }

  if (sampleTlv) {
    lines.push(
      `<!-- Embedded sample TLV root tag=0x${sampleTlv.tagByte.toString(16)} total=${sampleTlv.totalLength}B -->`,
    );
  }

  lines.push(`</svg>`);
  return lines.join("\n");
}
