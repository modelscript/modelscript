// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/reqif — 2D Requirements Architecture & Traceability Diagram Engine.
 *
 * Provides both declarative `DiagramConfig` (`reqifDiagramConfig`) for `@modelscript/dsl`
 * and programmatic graph/SVG builders (`buildReqIfDiagram`, `renderReqIfDiagramSvg`)
 * for LSP, VS Code webviews, and web artifact viewers.
 */

import type { DiagramConfig } from "@modelscript/dsl";
import { parseReqIf } from "./parser/reqif-parser.js";
import { evaluateReqIfDecompositionEntailment, formatReqIfContract } from "./tabular.js";
import type { ReqIfSpecHierarchy, SourceSpan } from "./types.js";

export type ReqIfDiagramEdgeKind =
  | "satisfies"
  | "verifies"
  | "refines"
  | "allocates"
  | "derives"
  | "conflicts"
  | "hierarchy";

export interface ReqIfDiagramNode {
  id: string;
  label: string;
  title: string;
  stereotype: string;
  text: string;
  asilLevel: string;
  status: string;
  contract?: string | undefined;
  entailmentStatus: "Certified" | "Contracted" | "Gap" | "Prose";
  x: number;
  y: number;
  width: number;
  height: number;
  parentId?: string | undefined;
  span?: SourceSpan | undefined;
}

export interface ReqIfDiagramEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: ReqIfDiagramEdgeKind;
  label: string;
}

export interface ReqIfDiagramModel {
  title: string;
  specificationId?: string | undefined;
  nodes: ReqIfDiagramNode[];
  edges: ReqIfDiagramEdge[];
  width: number;
  height: number;
}

/**
 * Declarative 2D Diagram configuration for `reqifLanguage`.
 */
export const reqifDiagramConfig: DiagramConfig = {
  nodes: {
    "SPEC-OBJECT": {
      role: "node",
      shape: "rect",
      label: "LONG-NAME",
      stereotype: "«requirement»",
      style: {
        fill: "#0f172a",
        stroke: "#0284c7",
        strokeWidth: 1.5,
      },
      compartments: [
        {
          header: "Attributes & Formal Contract",
          query: "VALUES",
        },
      ],
    },
    SPECIFICATION: {
      role: "group",
      shape: "package",
      label: "LONG-NAME",
      stereotype: "«specification»",
      style: {
        fill: "rgba(15, 23, 42, 0.45)",
        stroke: "#475569",
        strokeDasharray: "6,4",
      },
    },
  },
  edges: {
    "SPEC-RELATION": {
      source: "SOURCE",
      target: "TARGET",
      label: "LONG-NAME",
      style: {
        stroke: "#38bdf8",
        strokeWidth: 1.5,
        strokeDasharray: "5,3",
      },
    },
  },
  palette: {
    categories: [
      {
        name: "Requirements & Traceability",
        items: [
          {
            label: "Requirement (SPEC-OBJECT)",
            className: "SPEC-OBJECT",
            description: "Insert a new OMG ReqIF 1.2 SPEC-OBJECT requirement",
          },
          {
            label: "Traceability Link (SPEC-RELATION)",
            className: "SPEC-RELATION",
            description: "Insert a directed SPEC-RELATION link between two requirements",
          },
        ],
      },
    ],
  },
};

/**
 * Builds a structured 2D diagram layout (`ReqIfDiagramModel`) from a ReqIF XML document.
 */
export function buildReqIfDiagram(xmlContent: string): ReqIfDiagramModel {
  const doc = parseReqIf(xmlContent);
  const entailment = evaluateReqIfDecompositionEntailment(doc);
  const entailmentMap = new Map<string, boolean>();
  for (const res of entailment.results) {
    entailmentMap.set(res.parentReqId, res.isEntailed);
  }

  const edges: ReqIfDiagramEdge[] = [];
  const edgeKeys = new Set<string>();

  for (const rel of doc.specRelations) {
    if (!rel.sourceId || !rel.targetId) continue;
    const key = `${rel.sourceId}->${rel.targetId}:${rel.relationType}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({
      id: rel.identifier,
      sourceId: rel.sourceId,
      targetId: rel.targetId,
      kind: (rel.relationType as ReqIfDiagramEdgeKind) || "satisfies",
      label: `«${rel.relationType}»`,
    });
  }

  const depthByObj = new Map<string, number>();
  function walkHier(nodes: ReqIfSpecHierarchy[], depth: number, parentObjId?: string): void {
    for (const h of nodes) {
      if (h.objectRef && !depthByObj.has(h.objectRef)) {
        depthByObj.set(h.objectRef, depth);
      }
      if (parentObjId && h.objectRef && doc.specObjects.has(parentObjId) && doc.specObjects.has(h.objectRef)) {
        const key = `${h.objectRef}->${parentObjId}:hierarchy`;
        const alreadyLinked = edges.some(
          (e) =>
            (e.sourceId === h.objectRef && e.targetId === parentObjId) ||
            (e.sourceId === parentObjId && e.targetId === h.objectRef),
        );
        if (!edgeKeys.has(key) && !alreadyLinked) {
          edgeKeys.add(key);
          edges.push({
            id: `HIER-${parentObjId}-${h.objectRef}`,
            sourceId: h.objectRef,
            targetId: parentObjId,
            kind: "hierarchy",
            label: "«decomposes»",
          });
        }
      }
      if (h.children.length > 0) {
        walkHier(h.children, depth + 1, h.objectRef || parentObjId);
      }
    }
  }

  for (const spec of doc.specifications) {
    walkHier(spec.children, 0, undefined);
  }

  const targetIds = new Set(edges.map((e) => e.targetId));
  const sourceIds = new Set(edges.map((e) => e.sourceId));

  const specObjects = Array.from(doc.specObjects.values());
  const layers = new Map<number, typeof specObjects>();

  for (const so of specObjects) {
    let layer = depthByObj.get(so.identifier);
    if (layer === undefined) {
      if (targetIds.has(so.identifier) && !sourceIds.has(so.identifier)) {
        layer = 0;
      } else if (sourceIds.has(so.identifier) && targetIds.has(so.identifier)) {
        layer = 1;
      } else if (sourceIds.has(so.identifier)) {
        layer = targetIds.size > 0 ? 1 : 0;
      } else {
        layer = 0;
      }
    }
    const list = layers.get(layer) ?? [];
    list.push(so);
    layers.set(layer, list);
  }

  const sortedLayerKeys = Array.from(layers.keys()).sort((a, b) => a - b);
  const cardW = 284;
  const cardH = 122;
  const gapX = 56;
  const gapY = 68;
  const padX = 48;
  const padY = 64;

  const nodes: ReqIfDiagramNode[] = [];
  let maxRight = 640;
  let maxBottom = 260;

  if (sortedLayerKeys.length === 1 && specObjects.length > 2) {
    const cols = Math.min(3, Math.ceil(Math.sqrt(specObjects.length)));
    specObjects.forEach((so, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = padX + col * (cardW + gapX);
      const y = padY + row * (cardH + gapY);
      const ent = entailmentMap.get(so.identifier);
      const entailmentStatus = ent !== undefined ? (ent ? "Certified" : "Gap") : so.contract ? "Contracted" : "Prose";

      nodes.push({
        id: so.identifier,
        label: so.identifier,
        title: so.longName || so.identifier,
        stereotype: "«requirement»",
        text: so.text,
        asilLevel: so.asilLevel || "QM",
        status: so.status || (so.contract ? "Approved" : "Draft"),
        contract: formatReqIfContract(so) || undefined,
        entailmentStatus,
        x,
        y,
        width: cardW,
        height: cardH,
        span: so.span,
      });
      maxRight = Math.max(maxRight, x + cardW + padX);
      maxBottom = Math.max(maxBottom, y + cardH + padY);
    });
  } else {
    const maxColsInAnyLayer = Math.max(1, ...Array.from(layers.values()).map((arr) => arr.length));
    const totalContentWidth = maxColsInAnyLayer * cardW + (maxColsInAnyLayer - 1) * gapX;

    sortedLayerKeys.forEach((layerIdx, visualRow) => {
      const items = layers.get(layerIdx) ?? [];
      const rowWidth = items.length * cardW + (items.length - 1) * gapX;
      const startX = padX + Math.max(0, Math.round((totalContentWidth - rowWidth) / 2));
      const y = padY + visualRow * (cardH + gapY);

      items.forEach((so, colIdx) => {
        const x = startX + colIdx * (cardW + gapX);
        const ent = entailmentMap.get(so.identifier);
        const entailmentStatus = ent !== undefined ? (ent ? "Certified" : "Gap") : so.contract ? "Contracted" : "Prose";

        nodes.push({
          id: so.identifier,
          label: so.identifier,
          title: so.longName || so.identifier,
          stereotype: "«requirement»",
          text: so.text,
          asilLevel: so.asilLevel || "QM",
          status: so.status || (so.contract ? "Approved" : "Draft"),
          contract: formatReqIfContract(so) || undefined,
          entailmentStatus,
          x,
          y,
          width: cardW,
          height: cardH,
          span: so.span,
        });
        maxRight = Math.max(maxRight, x + cardW + padX);
        maxBottom = Math.max(maxBottom, y + cardH + padY);
      });
    });
  }

  const firstSpec = doc.specifications[0];
  return {
    title: firstSpec?.longName || doc.header.title || "ReqIF Requirements Architecture",
    specificationId: firstSpec?.identifier,
    nodes,
    edges,
    width: maxRight,
    height: maxBottom,
  };
}

function escapeSvg(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Renders a `ReqIfDiagramModel` (or raw ReqIF XML string) into a standalone,
 * theme-aware interactive SVG diagram showing specification containers,
 * requirement cards with ASIL & formal contract compartments, and traceability arrows.
 */
export function renderReqIfDiagramSvg(
  xmlOrModel: string | ReqIfDiagramModel,
  options: { isDark?: boolean } = {},
): string {
  const isDark = options.isDark ?? true;
  const model = typeof xmlOrModel === "string" ? buildReqIfDiagram(xmlOrModel) : xmlOrModel;

  const bg = isDark ? "#0b1120" : "#f8fafc";
  const pkgFill = isDark ? "rgba(15, 23, 42, 0.65)" : "rgba(241, 245, 249, 0.8)";
  const pkgStroke = isDark ? "#334155" : "#cbd5e1";
  const cardFill = isDark ? "#0f172a" : "#ffffff";
  const cardHeaderFill = isDark ? "#1e293b" : "#f1f5f9";
  const textPrimary = isDark ? "#f1f5f9" : "#0f172a";
  const textSecondary = isDark ? "#94a3b8" : "#475569";
  const contractBg = isDark ? "rgba(6, 182, 212, 0.14)" : "rgba(6, 182, 212, 0.1)";
  const contractColor = isDark ? "#22d3ee" : "#0891b2";

  const nodeMap = new Map(model.nodes.map((n) => [n.id, n]));

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${model.width} ${model.height}" width="100%" height="100%" style="background:${bg};font-family:Inter,system-ui,-apple-system,sans-serif;">`,
  );

  parts.push(`<defs>
    <marker id="reqif-arrow-satisfies" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#34d399"/>
    </marker>
    <marker id="reqif-arrow-verifies" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#60a5fa"/>
    </marker>
    <marker id="reqif-arrow-refines" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#a78bfa"/>
    </marker>
    <marker id="reqif-arrow-default" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#38bdf8"/>
    </marker>
  </defs>`);

  parts.push(
    `<rect x="16" y="16" width="${model.width - 32}" height="${model.height - 32}" rx="10" fill="${pkgFill}" stroke="${pkgStroke}" stroke-width="1.25" stroke-dasharray="6,4"/>`,
  );
  parts.push(
    `<text x="32" y="38" fill="${textSecondary}" font-size="11" font-weight="600" font-family="JetBrains Mono,monospace">«specification» ${escapeSvg(model.title)}${model.specificationId ? ` [${escapeSvg(model.specificationId)}]` : ""}</text>`,
  );

  for (const edge of model.edges) {
    const src = nodeMap.get(edge.sourceId);
    const tgt = nodeMap.get(edge.targetId);
    if (!src || !tgt) continue;

    const sx = src.x + src.width / 2;
    const sy = src.y <= tgt.y ? src.y + src.height : src.y;
    const tx = tgt.x + tgt.width / 2;
    const ty = src.y <= tgt.y ? tgt.y : tgt.y + tgt.height;

    const midY = Math.round((sy + ty) / 2);
    const strokeColor =
      edge.kind === "satisfies"
        ? "#34d399"
        : edge.kind === "verifies"
          ? "#60a5fa"
          : edge.kind === "refines"
            ? "#a78bfa"
            : edge.kind === "conflicts"
              ? "#f87171"
              : "#38bdf8";
    const markerId =
      edge.kind === "satisfies"
        ? "reqif-arrow-satisfies"
        : edge.kind === "verifies"
          ? "reqif-arrow-verifies"
          : edge.kind === "refines"
            ? "reqif-arrow-refines"
            : "reqif-arrow-default";

    parts.push(
      `<path d="M ${sx} ${sy} L ${sx} ${midY} L ${tx} ${midY} L ${tx} ${ty}" fill="none" stroke="${strokeColor}" stroke-width="1.6" stroke-dasharray="5,3" marker-end="url(#${markerId})"/>`,
    );

    const labelX = Math.round((sx + tx) / 2);
    const labelY = midY - 5;
    parts.push(
      `<rect x="${labelX - 38}" y="${labelY - 11}" width="76" height="15" rx="4" fill="${bg}" stroke="${strokeColor}" stroke-width="0.8" opacity="0.92"/>`,
    );
    parts.push(
      `<text x="${labelX}" y="${labelY}" text-anchor="middle" fill="${strokeColor}" font-size="9.5" font-weight="600" font-family="JetBrains Mono,monospace">${escapeSvg(edge.label)}</text>`,
    );
  }

  for (const node of model.nodes) {
    const borderStroke =
      node.entailmentStatus === "Gap"
        ? "#ef4444"
        : node.entailmentStatus === "Certified"
          ? "#10b981"
          : node.contract
            ? "#0284c7"
            : pkgStroke;

    const asilColor =
      node.asilLevel === "ASIL-D"
        ? "#f87171"
        : node.asilLevel === "ASIL-C"
          ? "#fb923c"
          : node.asilLevel === "ASIL-B"
            ? "#facc15"
            : node.asilLevel === "ASIL-A"
              ? "#60a5fa"
              : "#94a3b8";

    const truncTitle = node.title.length > 32 ? `${node.title.slice(0, 30)}…` : node.title;
    const truncText = node.text.length > 44 ? `${node.text.slice(0, 42)}…` : node.text;

    parts.push(`<g data-reqif-id="${escapeSvg(node.id)}">`);
    parts.push(
      `  <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="8" fill="${cardFill}" stroke="${borderStroke}" stroke-width="1.5"/>`,
    );
    parts.push(
      `  <path d="M ${node.x} ${node.y + 30} L ${node.x + node.width} ${node.y + 30}" stroke="${pkgStroke}" stroke-width="1"/>`,
    );
    parts.push(
      `  <rect x="${node.x + 1}" y="${node.y + 1}" width="${node.width - 2}" height="28" rx="7" fill="${cardHeaderFill}"/>`,
    );
    parts.push(
      `  <text x="${node.x + 10}" y="${node.y + 19}" fill="#38bdf8" font-size="10.5" font-weight="700" font-family="JetBrains Mono,monospace">${escapeSvg(node.id)}</text>`,
    );

    parts.push(
      `  <rect x="${node.x + node.width - 62}" y="${node.y + 6}" width="52" height="17" rx="4" fill="rgba(15,23,42,0.55)" stroke="${asilColor}" stroke-width="0.9"/>`,
    );
    parts.push(
      `  <text x="${node.x + node.width - 36}" y="${node.y + 18}" text-anchor="middle" fill="${asilColor}" font-size="9.5" font-weight="700" font-family="JetBrains Mono,monospace">${escapeSvg(node.asilLevel)}</text>`,
    );

    parts.push(
      `  <text x="${node.x + 12}" y="${node.y + 50}" fill="${textPrimary}" font-size="12" font-weight="600">${escapeSvg(truncTitle)}</text>`,
    );
    parts.push(
      `  <text x="${node.x + 12}" y="${node.y + 68}" fill="${textSecondary}" font-size="10.5">${escapeSvg(truncText)}</text>`,
    );

    if (node.contract) {
      parts.push(
        `  <rect x="${node.x + 10}" y="${node.y + 82}" width="${node.width - 20}" height="28" rx="5" fill="${contractBg}" stroke="${contractColor}" stroke-width="0.8"/>`,
      );
      parts.push(
        `  <text x="${node.x + 18}" y="${node.y + 100}" fill="${contractColor}" font-size="10.5" font-weight="600" font-family="JetBrains Mono,monospace">⊨ ${escapeSvg(node.contract)}</text>`,
      );
      parts.push(
        `  <text x="${node.x + node.width - 18}" y="${node.y + 100}" text-anchor="end" fill="${node.entailmentStatus === "Gap" ? "#f87171" : "#34d399"}" font-size="9.5" font-weight="700">${escapeSvg(node.entailmentStatus)}</text>`,
      );
    } else {
      parts.push(
        `  <text x="${node.x + 12}" y="${node.y + 102}" fill="${textSecondary}" font-size="9.5" font-family="JetBrains Mono,monospace">Status: ${escapeSvg(node.status)}</text>`,
      );
    }
    parts.push(`</g>`);
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}
