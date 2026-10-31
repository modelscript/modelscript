// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  computeFilletedOrthogonalPath,
  computeJumpoverPath,
  computeOrthogonalRoute,
  computeSmoothBezierPath,
  healOrthogonalVertices,
  type JumpoverSegment,
  type PointLike,
} from "./port-router.js";
import type {
  ComponentPropertyData,
  DiagramData,
  DiagramEdge,
  DiagramEdgeLabel,
  DiagramEdgeMarker,
  DiagramNode,
  DiagramNodeData,
  SvgExportOptions,
  X6Markup,
} from "./protocol.js";

type LooseEdgeEndpoint =
  | string
  | {
      cell?: string | undefined;
      port?: string | undefined;
      x?: number | undefined;
      y?: number | undefined;
    };

export interface RawGraphCell {
  id: string;
  shape?: string | undefined;
  source?:
    | string
    | {
        cell: string;
        port?: string | undefined;
        anchor?: string | undefined;
        connectionPoint?: { name: string } | undefined;
      }
    | undefined;
  target?:
    | string
    | {
        cell: string;
        port?: string | undefined;
        anchor?: string | undefined;
        connectionPoint?: { name: string } | undefined;
      }
    | undefined;
  vertices?: { x: number; y: number }[] | undefined;
  connector?: string | undefined;
  router?: string | { name: string; args?: Record<string, unknown> | undefined } | undefined;
  zIndex?: number | undefined;
  label?: string | undefined;
  labels?: DiagramEdgeLabel[] | undefined;
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  angle?: number | undefined;
  opacity?: number | undefined;
  markup?: X6Markup | undefined;
  ports?: DiagramNode["ports"] | undefined;
  attrs?:
    | {
        line?:
          | {
              stroke?: string | undefined;
              strokeWidth?: number | undefined;
              strokeDasharray?: string | undefined;
              targetMarker?: DiagramEdgeMarker | undefined;
              sourceMarker?: DiagramEdgeMarker | undefined;
              [key: string]: unknown;
            }
          | undefined;
        body?:
          | {
              fill?: string | undefined;
              stroke?: string | undefined;
              strokeWidth?: number | undefined;
              rx?: number | undefined;
              ry?: number | undefined;
              [key: string]: unknown;
            }
          | undefined;
        label?:
          | {
              text?: string | undefined;
              fill?: string | undefined;
              fontSize?: number | undefined;
              [key: string]: unknown;
            }
          | undefined;
        [key: string]: Record<string, unknown> | undefined;
      }
    | undefined;
  data?: DiagramNodeData | undefined;
  properties?: ComponentPropertyData | undefined;
}

/**
 * Escapes XML special characters.
 */
function escapeXml(str: unknown): string {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function stripGuillemets(s: string): string {
  let start = 0;
  while (start < s.length && (s[start] === "«" || s[start] === "<")) start++;
  let end = s.length;
  while (end > start && (s[end - 1] === "»" || s[end - 1] === ">")) end--;
  return s.slice(start, end);
}

/**
 * Headless SVG Serializer for ModelScript Polyglot Diagrams.
 * Renders DiagramData into a standalone, pure SVG XML string with zero DOM dependencies.
 */
export function renderPolyglotDiagramToSvg(diagram: DiagramData, options: SvgExportOptions = {}): string {
  const isBlueprint = options.theme === "blueprint";
  const isDark = options.theme !== "light" && !isBlueprint;
  const padding = options.padding ?? 40;
  const bgColor = options.background ?? (isBlueprint ? "#1e3a8a" : isDark ? "#0f172a" : "#ffffff");
  const textColor = isBlueprint ? "#ffffff" : isDark ? "#f8fafc" : "#0f172a";
  const mutedTextColor = isBlueprint ? "#bfdbfe" : isDark ? "#94a3b8" : "#64748b";
  const borderColor = isBlueprint ? "#93c5fd" : isDark ? "#334155" : "#cbd5e1";
  const defaultNodeFill = isBlueprint ? "#172554" : isDark ? "#1e293b" : "#f1f5f9";
  const defaultEdgeStroke = isBlueprint ? "#93c5fd" : isDark ? "#38bdf8" : "#0284c7";

  // 1. Calculate bounding box enclosing all nodes and edges
  // If multiple nodes are stacked at (0, 0), assign non-overlapping grid coordinates for headless rendering
  const unplacedNodes = diagram.nodes.filter((n) => (n.x ?? 0) === 0 && (n.y ?? 0) === 0);
  const resolvedCoords = new Map<string, { x: number; y: number }>();
  if (unplacedNodes.length > 1) {
    const cols = Math.max(1, Math.ceil(Math.sqrt(unplacedNodes.length)));
    unplacedNodes.forEach((n, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      resolvedCoords.set(n.id, { x: 80 + col * 240, y: 80 + row * 140 });
    });
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const nodeMap = new Map<string, DiagramNode>();

  for (const node of diagram.nodes) {
    const override = resolvedCoords.get(node.id);
    const effectiveNode = override ? { ...node, x: override.x, y: override.y } : node;
    nodeMap.set(node.id, effectiveNode);
    const nx = effectiveNode.x ?? 0;
    const ny = effectiveNode.y ?? 0;
    const nw = effectiveNode.width ?? 120;
    const nh = effectiveNode.height ?? 60;

    minX = Math.min(minX, nx);
    minY = Math.min(minY, ny);
    maxX = Math.max(maxX, nx + nw);
    maxY = Math.max(maxY, ny + nh);
  }

  // Include edges in bounds
  for (const edge of diagram.edges) {
    if (edge.vertices) {
      for (const v of edge.vertices) {
        minX = Math.min(minX, v.x);
        minY = Math.min(minY, v.y);
        maxX = Math.max(maxX, v.x);
        maxY = Math.max(maxY, v.y);
      }
    }
  }

  if (!isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 800;
    maxY = 600;
  }

  const viewBoxX = Math.floor(minX - padding);
  const viewBoxY = Math.floor(minY - padding);
  const viewBoxW = Math.ceil(maxX - minX + padding * 2);
  const viewBoxH = Math.ceil(maxY - minY + padding * 2);

  // 2. Prepare SVG Defs (Markers, Filters, Procedural 3D Gradients)
  const defs: string[] = [];
  defs.push(`
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;display=swap');
      text { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      .node-title { font-size: 13px; font-weight: 600; }
      .node-stereotype { font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; }
      .compartment-header { font-size: 10px; font-weight: 600; font-style: italic; }
      .compartment-row { font-size: 11px; }
      .edge-label { font-size: 11px; font-weight: 500; }
    </style>
    <filter id="shadow" x="-5%" y="-5%" width="115%" height="115%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000000" flood-opacity="${isDark ? "0.4" : "0.1"}"/>
    </filter>
    <!-- Procedural 3D Shaders (Modelica / Physical parities) -->
    <linearGradient id="grad-cylinder-horizontal" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#0f172a" stop-opacity="0.8"/>
      <stop offset="25%" stop-color="#ffffff" stop-opacity="0.45"/>
      <stop offset="55%" stop-color="${defaultEdgeStroke}" stop-opacity="0.9"/>
      <stop offset="85%" stop-color="#0284c7" stop-opacity="1.0"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0.95"/>
    </linearGradient>
    <linearGradient id="grad-cylinder-vertical" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#0f172a" stop-opacity="0.8"/>
      <stop offset="25%" stop-color="#ffffff" stop-opacity="0.45"/>
      <stop offset="55%" stop-color="${defaultEdgeStroke}" stop-opacity="0.9"/>
      <stop offset="85%" stop-color="#0284c7" stop-opacity="1.0"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0.95"/>
    </linearGradient>
    <radialGradient id="grad-sphere" cx="35%" cy="35%" r="65%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.85"/>
      <stop offset="40%" stop-color="${defaultEdgeStroke}" stop-opacity="0.9"/>
      <stop offset="80%" stop-color="#0284c7" stop-opacity="1.0"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0.95"/>
    </radialGradient>
    <!-- Arrowhead Markers -->
    <marker id="marker-classic" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="${defaultEdgeStroke}"/>
    </marker>
    <marker id="marker-hollow-triangle" viewBox="0 0 12 12" refX="12" refY="6" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <polygon points="1,1 11,6 1,11" fill="${isDark ? "#1e293b" : "#ffffff"}" stroke="${defaultEdgeStroke}" stroke-width="1.5"/>
    </marker>
    <marker id="marker-diamond" viewBox="0 0 12 12" refX="12" refY="6" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <polygon points="1,6 6,1 11,6 6,11" fill="${defaultEdgeStroke}"/>
    </marker>
    <marker id="marker-hollow-diamond" viewBox="0 0 12 12" refX="12" refY="6" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <polygon points="1,6 6,1 11,6 6,11" fill="${isDark ? "#1e293b" : "#ffffff"}" stroke="${defaultEdgeStroke}" stroke-width="1.5"/>
    </marker>
  `);

  const bodyParts: string[] = [];

  // 3. Background rectangle
  bodyParts.push(`<rect x="${viewBoxX}" y="${viewBoxY}" width="${viewBoxW}" height="${viewBoxH}" fill="${bgColor}"/>`);

  // 4. Collect edge segments for jumpover obstacle detection
  const edgeSegments: JumpoverSegment[] = [];
  const edgePaths: {
    edge: DiagramEdge;
    points: PointLike[];
    stroke: string;
    strokeWidth: number;
    dash?: string | undefined;
    markerEnd?: string | undefined;
    markerStart?: string | undefined;
  }[] = [];

  for (const edge of diagram.edges) {
    const srcEndpoint = edge.source as LooseEdgeEndpoint;
    const tgtEndpoint = edge.target as LooseEdgeEndpoint;
    const srcId = typeof srcEndpoint === "string" ? srcEndpoint : srcEndpoint?.cell;
    const tgtId = typeof tgtEndpoint === "string" ? tgtEndpoint : tgtEndpoint?.cell;

    const srcNode = srcId ? nodeMap.get(srcId) : undefined;
    const tgtNode = tgtId ? nodeMap.get(tgtId) : undefined;

    const resolvePortWorldPoint = (node: DiagramNode, px: number, py: number, nw: number, nh: number): PointLike => {
      const nx = node.x ?? 0;
      const ny = node.y ?? 0;
      const angleDeg = node.angle ?? 0;
      if (!angleDeg) {
        return { x: nx + px, y: ny + py };
      }
      const cx = nw / 2;
      const cy = nh / 2;
      const rad = (angleDeg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const dx = px - cx;
      const dy = py - cy;
      return {
        x: nx + cx + dx * cos - dy * sin,
        y: ny + cy + dx * sin + dy * cos,
      };
    };

    // Calculate source point
    let pSrc: PointLike = { x: 0, y: 0 };
    if (srcNode) {
      const sw = srcNode.width ?? 120;
      const sh = srcNode.height ?? 60;
      pSrc = { x: (srcNode.x ?? 0) + sw / 2, y: (srcNode.y ?? 0) + sh / 2 };
      // Check port if specified
      if (typeof srcEndpoint === "object" && srcEndpoint?.port && srcNode.ports?.items) {
        const pt = srcNode.ports.items.find((p) => p.id === srcEndpoint.port);
        if (pt?.args) {
          pSrc = resolvePortWorldPoint(srcNode, pt.args.x ?? sw / 2, pt.args.y ?? sh / 2, sw, sh);
        }
      }
    } else if (
      typeof srcEndpoint === "object" &&
      typeof srcEndpoint.x === "number" &&
      typeof srcEndpoint.y === "number"
    ) {
      pSrc = { x: srcEndpoint.x, y: srcEndpoint.y };
    }

    // Calculate target point
    let pTgt: PointLike = { x: 0, y: 0 };
    if (tgtNode) {
      const tw = tgtNode.width ?? 120;
      const th = tgtNode.height ?? 60;
      pTgt = { x: (tgtNode.x ?? 0) + tw / 2, y: (tgtNode.y ?? 0) + th / 2 };
      if (typeof tgtEndpoint === "object" && tgtEndpoint?.port && tgtNode.ports?.items) {
        const pt = tgtNode.ports.items.find((p) => p.id === tgtEndpoint.port);
        if (pt?.args) {
          pTgt = resolvePortWorldPoint(tgtNode, pt.args.x ?? tw / 2, pt.args.y ?? th / 2, tw, th);
        }
      }
    } else if (
      typeof tgtEndpoint === "object" &&
      typeof tgtEndpoint.x === "number" &&
      typeof tgtEndpoint.y === "number"
    ) {
      pTgt = { x: tgtEndpoint.x, y: tgtEndpoint.y };
    }

    const isSmoothEdge =
      edge.connector === "smooth" ||
      edge.connector === "bezier" ||
      edge.style?.connector === "smooth" ||
      edge.style?.connector === "bezier" ||
      edge.router === "bezier" ||
      edge.style?.router === "bezier";

    const points: PointLike[] = [pSrc];
    if (edge.vertices && edge.vertices.length > 0) {
      const healed = isSmoothEdge ? edge.vertices : healOrthogonalVertices(pSrc, pTgt, edge.vertices);
      for (const v of healed) {
        points.push({ x: v.x, y: v.y });
      }
      points.push(pTgt);
    } else {
      const routerName = typeof edge.router === "string" ? edge.router : edge.router?.name;
      if (
        !isSmoothEdge &&
        (routerName === "port-orthogonal-astar" ||
          routerName === "manhattan" ||
          routerName === "orthogonal" ||
          routerName === undefined)
      ) {
        const obstacles = diagram.nodes
          .filter((n) => n.id !== srcId && n.id !== tgtId)
          .map((n) => ({ x: n.x ?? 0, y: n.y ?? 0, width: n.width ?? 120, height: n.height ?? 60 }));
        const sourceBox = srcNode
          ? { x: srcNode.x ?? 0, y: srcNode.y ?? 0, width: srcNode.width ?? 120, height: srcNode.height ?? 60 }
          : undefined;
        const targetBox = tgtNode
          ? { x: tgtNode.x ?? 0, y: tgtNode.y ?? 0, width: tgtNode.width ?? 120, height: tgtNode.height ?? 60 }
          : undefined;
        const waypoints = computeOrthogonalRoute(pSrc, pTgt, obstacles, { sourceBox, targetBox });
        points.push(...waypoints);
      }
      points.push(pTgt);
    }

    // Register segments
    for (let i = 0; i < points.length - 1; i++) {
      edgeSegments.push({ p1: points[i]!, p2: points[i + 1]! });
    }

    const stroke = (edge.attrs?.line?.stroke as string) || defaultEdgeStroke;
    const strokeWidth = (edge.attrs?.line?.strokeWidth as number) || 1.5;
    const dash = (edge.attrs?.line?.strokeDasharray as string) || undefined;

    let markerEnd: string | undefined;
    let markerStart: string | undefined;
    const targetMarker = edge.attrs?.line?.targetMarker;
    if (targetMarker) {
      const name = typeof targetMarker === "string" ? targetMarker : targetMarker.name;
      if (name === "classic" || name === "block") markerEnd = "url(#marker-classic)";
      else if (name === "hollow-triangle") markerEnd = "url(#marker-hollow-triangle)";
      else if (name === "diamond") markerEnd = "url(#marker-diamond)";
      else if (name === "hollow-diamond") markerEnd = "url(#marker-hollow-diamond)";
    }
    const sourceMarker = edge.attrs?.line?.sourceMarker;
    if (sourceMarker) {
      const name = typeof sourceMarker === "string" ? sourceMarker : sourceMarker.name;
      if (name === "diamond") markerStart = "url(#marker-diamond)";
      else if (name === "hollow-diamond") markerStart = "url(#marker-hollow-diamond)";
    }

    edgePaths.push({ edge, points, stroke, strokeWidth, dash, markerEnd, markerStart });
  }

  // 5. Render Edges (with jumpover crossing, rounded orthogonal fillets, and smooth Bezier support)
  bodyParts.push(`<g id="edges">`);
  for (const ep of edgePaths) {
    const connectorObj =
      typeof ep.edge.connector === "object" && ep.edge.connector !== null
        ? (ep.edge.connector as { name?: string; args?: { radius?: number } })
        : undefined;
    const connectorName =
      typeof ep.edge.connector === "string"
        ? ep.edge.connector
        : (connectorObj?.name ?? (ep.edge.style?.connector as string | undefined));
    const isJumpover = connectorName === "jumpover";
    const isSmooth =
      connectorName === "smooth" ||
      connectorName === "bezier" ||
      ep.edge.router === "bezier" ||
      ep.edge.style?.router === "bezier";
    const isRounded = connectorName === "rounded" || connectorName === "fillet";

    let d = "";
    if (isJumpover) {
      // Find obstacles from other edges
      const obstacles = edgeSegments.filter((s) => !ep.points.some((p) => p === s.p1 || p === s.p2));
      d = computeJumpoverPath(ep.points, obstacles, { radius: 5 });
    } else if (isSmooth) {
      d = computeSmoothBezierPath(ep.points);
    } else if (isRounded && ep.points.length >= 3) {
      const radius = connectorObj?.args?.radius ?? 8;
      d = computeFilletedOrthogonalPath(ep.points, radius);
    } else {
      d = `M ${ep.points[0]!.x} ${ep.points[0]!.y}`;
      for (let i = 1; i < ep.points.length; i++) {
        d += ` L ${ep.points[i]!.x} ${ep.points[i]!.y}`;
      }
    }

    let edgeSvg = `<path d="${d}" stroke="${ep.stroke}" stroke-width="${ep.strokeWidth}" fill="none" stroke-linejoin="round" stroke-linecap="round"`;
    if (ep.dash) edgeSvg += ` stroke-dasharray="${ep.dash}"`;
    if (ep.markerEnd) edgeSvg += ` marker-end="${ep.markerEnd}"`;
    if (ep.markerStart) edgeSvg += ` marker-start="${ep.markerStart}"`;
    edgeSvg += `/>`;
    bodyParts.push(edgeSvg);

    // Edge label if present
    if (ep.edge.labels && ep.edge.labels.length > 0) {
      const midIdx = Math.floor(ep.points.length / 2);
      const lp = ep.points[midIdx]!;
      const labelText = ep.edge.labels[0]?.attrs?.text?.text || "";
      if (labelText) {
        const textStr = escapeXml(String(labelText));
        const badgeW = textStr.length * 6.5 + 16;
        const badgeH = 18;
        bodyParts.push(
          `<rect x="${lp.x - badgeW / 2}" y="${lp.y - 15}" width="${badgeW}" height="${badgeH}" rx="4" fill="${isDark ? "#1e293b" : "#ffffff"}" stroke="${borderColor}" stroke-width="1"/>`,
          `<text x="${lp.x}" y="${lp.y - 3}" text-anchor="middle" fill="${textColor}" class="edge-label">${textStr}</text>`,
        );
      }
    }
  }
  bodyParts.push(`</g>`);

  // 6. Render Nodes
  bodyParts.push(`<g id="nodes">`);
  for (const rawNode of diagram.nodes) {
    const node = nodeMap.get(rawNode.id) ?? rawNode;
    const nx = node.x ?? 0;
    const ny = node.y ?? 0;
    const nw = node.width ?? 120;
    const nh = node.height ?? 60;

    const markupChildren: X6Markup[] = Array.isArray(node.markup)
      ? node.markup
      : Array.isArray(node.markup?.children)
        ? node.markup.children
        : [];
    const markupRect = markupChildren.find((c) => c.tagName === "rect");

    let fill = (node.attrs?.body?.fill as string) || (markupRect?.attrs?.["fill"] as string) || defaultNodeFill;

    if (node.id.startsWith("solder_dot_") || node.shape === "circle") {
      const r = nw / 2;
      bodyParts.push(
        `<circle id="${escapeXml(node.id)}" cx="${nx + r}" cy="${ny + r}" r="${r}" fill="${escapeXml(fill)}" stroke="none"/>`,
      );
      continue;
    }
    const fillPattern = (node.attrs?.body?.fillPattern as string) || (node.data?.fillPattern as string);
    if (fillPattern === "HorizontalCylinder") {
      fill = "url(#grad-cylinder-horizontal)";
    } else if (fillPattern === "VerticalCylinder") {
      fill = "url(#grad-cylinder-vertical)";
    } else if (fillPattern === "Sphere") {
      fill = "url(#grad-sphere)";
    }

    const stroke = (node.attrs?.body?.stroke as string) || (markupRect?.attrs?.["stroke"] as string) || borderColor;
    const strokeWidth =
      (node.attrs?.body?.strokeWidth as number) || (markupRect?.attrs?.["stroke-width"] as number) || 1.5;
    const rx = (node.attrs?.body?.rx as number) || (markupRect?.attrs?.["rx"] as number) || 6;
    const ry = (node.attrs?.body?.ry as number) || (markupRect?.attrs?.["ry"] as number) || 6;
    const labelText =
      (node.attrs?.label?.text as string) ||
      (node.properties?.name as string) ||
      (node.properties?.description as string) ||
      node.id;
    const headerText = node.attrs?.header?.text as string | undefined;
    const stereotype =
      (headerText ? stripGuillemets(headerText) : "") ||
      (node.data?.ruleName as string) ||
      (node.properties?.className as string);
    const multiplicity = (node.data?.multiplicity as number) || 1;
    const rawIconUrl =
      (node.attrs?.icon?.href as string) ||
      (node.attrs?.icon?.["xlink:href"] as string) ||
      (node.data?.icon as string) ||
      (node.properties?.icon as string);
    const iconUrl = typeof rawIconUrl === "string" && rawIconUrl.trim().length > 0 ? rawIconUrl.trim() : undefined;

    bodyParts.push(`<g id="${escapeXml(node.id)}" transform="translate(${nx}, ${ny})" filter="url(#shadow)">`);

    // 2.5D Multiplicity Cascade: Stacked background card shadows
    if (multiplicity > 1) {
      bodyParts.push(
        `<rect x="6" y="-6" width="${nw}" height="${nh}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="0.4"/>`,
      );
      bodyParts.push(
        `<rect x="3" y="-3" width="${nw}" height="${nh}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="0.7"/>`,
      );
    }

    // Main node rectangle
    bodyParts.push(
      `<rect width="${nw}" height="${nh}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`,
    );

    // Bitmap raster / vector image embedding if present
    if (iconUrl) {
      const imgW = Math.min(nw - 16, 48);
      const imgH = Math.min(nh - 16, 48);
      bodyParts.push(
        `<image href="${escapeXml(iconUrl)}" x="${(nw - imgW) / 2}" y="${stereotype ? 20 : (nh - imgH) / 2}" width="${imgW}" height="${imgH}" preserveAspectRatio="xMidYMid meet"/>`,
      );
    }

    // Multi-compartment table check
    const sections = (node.data?.sections as { header: string; entries: string[] }[]) || [];
    if (sections.length > 0) {
      let curY = 24;
      // Two-tone header band with rounded top corners
      bodyParts.push(
        `<path d="M 0 ${rx} A ${rx} ${ry} 0 0 1 ${rx} 0 L ${nw - rx} 0 A ${rx} ${ry} 0 0 1 ${nw} ${rx} L ${nw} 34 L 0 34 Z" fill="${escapeXml(fill)}" stroke="none"/>`,
      );
      if (stereotype) {
        bodyParts.push(
          `<text x="${nw / 2}" y="14" text-anchor="middle" fill="${stroke}" class="node-stereotype">«${escapeXml(stereotype.toLowerCase())}»</text>`,
        );
      }
      bodyParts.push(
        `<text x="${nw / 2}" y="${curY}" text-anchor="middle" fill="${textColor}" class="node-title">${escapeXml(labelText)}</text>`,
      );
      curY += 10;

      // Divider below title
      bodyParts.push(`<line x1="0" y1="${curY}" x2="${nw}" y2="${curY}" stroke="${stroke}" stroke-width="1"/>`);
      curY += 4;

      for (const sec of sections) {
        curY += 12;
        bodyParts.push(
          `<text x="${nw / 2}" y="${curY}" text-anchor="middle" fill="${mutedTextColor}" class="compartment-header">«${escapeXml(sec.header.toLowerCase())}»</text>`,
        );
        for (const entry of sec.entries) {
          curY += 14;
          bodyParts.push(
            `<text x="16" y="${curY}" fill="${textColor}" class="compartment-row">${escapeXml(entry)}</text>`,
          );
        }
        curY += 4;
        bodyParts.push(
          `<line x1="0" y1="${curY}" x2="${nw}" y2="${curY}" stroke="${borderColor}" stroke-width="0.5"/>`,
        );
      }
    } else if (node.attrs?.tab) {
      const tabW = (node.attrs.tab.width as number) || 120;
      const tabH = (node.attrs.tab.height as number) || 32;
      const tabFill = (node.attrs.tab.fill as string) || (isDark ? "#1e293b" : "#f1f5f9");
      const tabStroke = (node.attrs.tab.stroke as string) || stroke;
      const tabRx = (node.attrs.tab.rx as number) || 4;
      bodyParts.push(
        `<rect x="0" y="0" width="${tabW}" height="${tabH}" rx="${tabRx}" ry="${tabRx}" fill="${escapeXml(tabFill)}" stroke="${escapeXml(tabStroke)}" stroke-width="${strokeWidth}"/>`,
      );
      const stText = (node.attrs?.tabStereotype?.text as string) || (stereotype ? `«${stereotype.toLowerCase()}»` : "");
      if (stText) {
        bodyParts.push(
          `<text x="10" y="13" fill="${escapeXml(tabStroke)}" class="node-stereotype" font-size="9" font-style="italic">${escapeXml(stText)}</text>`,
        );
      }
      const titleText = (node.attrs?.tabLabel?.text as string) || labelText;
      bodyParts.push(
        `<text x="10" y="25" fill="${textColor}" class="node-title" font-size="11" font-weight="bold">${escapeXml(titleText)}</text>`,
      );
    } else if (!iconUrl) {
      // Standard Node Label (when no icon is centered)
      if (stereotype) {
        bodyParts.push(
          `<text x="${nw / 2}" y="${nh / 2 - 8}" text-anchor="middle" fill="${mutedTextColor}" class="node-stereotype">«${escapeXml(stereotype.toLowerCase())}»</text>`,
        );
        bodyParts.push(
          `<text x="${nw / 2}" y="${nh / 2 + 10}" text-anchor="middle" fill="${textColor}" class="node-title">${escapeXml(labelText)}</text>`,
        );
      } else {
        bodyParts.push(
          `<text x="${nw / 2}" y="${nh / 2 + 4}" text-anchor="middle" fill="${textColor}" class="node-title">${escapeXml(labelText)}</text>`,
        );
      }
    }

    // Ports
    if (node.ports?.items) {
      for (const port of node.ports.items) {
        const px = port.args?.x ?? (port.group === "in" || port.group === "left" ? 0 : nw);
        const py = port.args?.y ?? nh / 2;
        const isConj = port.isConjugated;
        const portFill = isConj ? stroke : isBlueprint ? "#172554" : isDark ? "#1e293b" : "#ffffff";
        const portStroke = isBlueprint ? "#93c5fd" : stroke;
        bodyParts.push(
          `<rect x="${px - 4.5}" y="${py - 4.5}" width="9" height="9" fill="${portFill}" stroke="${portStroke}" stroke-width="1.5" rx="1" ry="1"/>`,
        );

        // Directional arrow indicator
        const dir =
          port.direction ??
          (port.group === "in" || port.group === "left"
            ? "in"
            : port.group === "out" || port.group === "right"
              ? "out"
              : undefined);
        const arrowColor = isConj ? "#ffffff" : portStroke;
        if (dir === "in") {
          // Pointing into the block
          const d =
            px <= 5
              ? `M ${px - 2} ${py - 2.5} L ${px + 2} ${py} L ${px - 2} ${py + 2.5} Z`
              : `M ${px + 2} ${py - 2.5} L ${px - 2} ${py} L ${px + 2} ${py + 2.5} Z`;
          bodyParts.push(`<path d="${d}" fill="${arrowColor}"/>`);
        } else if (dir === "out") {
          // Pointing out of the block
          const d =
            px <= 5
              ? `M ${px + 2} ${py - 2.5} L ${px - 2} ${py} L ${px + 2} ${py + 2.5} Z`
              : `M ${px - 2} ${py - 2.5} L ${px + 2} ${py} L ${px - 2} ${py + 2.5} Z`;
          bodyParts.push(`<path d="${d}" fill="${arrowColor}"/>`);
        } else if (dir === "inout") {
          bodyParts.push(
            `<polygon points="${px},${py - 2.5} ${px + 2.5},${py} ${px},${py + 2.5} ${px - 2.5},${py}" fill="${arrowColor}"/>`,
          );
        }
      }
    }

    bodyParts.push(`</g>`);
  }
  bodyParts.push(`</g>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBoxX} ${viewBoxY} ${viewBoxW} ${viewBoxH}" width="${viewBoxW}" height="${viewBoxH}" style="background-color: ${bgColor};">
  <defs>${defs.join("\n")}</defs>
  ${bodyParts.join("\n  ")}
</svg>`;
}

export const renderDiagramDataToSvg = renderPolyglotDiagramToSvg;

/**
 * Adapts an AntV X6 or domain visualizer cell graph into canonical DiagramData.
 */
export function cellsToDiagramData(graph: { title?: string | undefined; cells: RawGraphCell[] }): DiagramData {
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const cell of graph.cells) {
    if (cell.shape === "edge" || (cell.source && cell.target)) {
      const src: DiagramEdge["source"] =
        typeof cell.source === "object" && cell.source !== null && "cell" in cell.source
          ? {
              cell: cell.source.cell,
              port: cell.source.port ?? "",
              anchor: "center",
              connectionPoint: { name: "boundary" },
            }
          : {
              cell: typeof cell.source === "string" ? cell.source : "",
              port: "",
              anchor: "center",
              connectionPoint: { name: "boundary" },
            };
      const tgt: DiagramEdge["target"] =
        typeof cell.target === "object" && cell.target !== null && "cell" in cell.target
          ? {
              cell: cell.target.cell,
              port: cell.target.port ?? "",
              anchor: "center",
              connectionPoint: { name: "boundary" },
            }
          : {
              cell: typeof cell.target === "string" ? cell.target : "",
              port: "",
              anchor: "center",
              connectionPoint: { name: "boundary" },
            };

      const edgeAttrs = cell.attrs ?? {};
      const lineAttrs = edgeAttrs.line ?? {};

      edges.push({
        id: cell.id,
        source: src,
        target: tgt,
        vertices: cell.vertices,
        connector: cell.connector,
        router: cell.router ?? "port-orthogonal-astar",
        zIndex: cell.zIndex ?? 2,
        attrs: {
          line: {
            stroke: lineAttrs.stroke ?? "#38bdf8",
            strokeWidth: lineAttrs.strokeWidth ?? 1.8,
            strokeDasharray: lineAttrs.strokeDasharray,
            targetMarker: lineAttrs.targetMarker ?? { name: "classic", width: 8, height: 6 },
            sourceMarker: lineAttrs.sourceMarker,
            "vector-effect": "non-scaling-stroke",
            "pointer-events": "stroke",
          },
        },
        labels: cell.label ? [{ attrs: { text: { text: cell.label } } }] : cell.labels,
        data: cell.data,
      });
    } else {
      const nx = cell.x ?? 0;
      const ny = cell.y ?? 0;
      const nw = cell.width ?? 100;
      const nh = cell.height ?? 60;

      minX = Math.min(minX, nx);
      minY = Math.min(minY, ny);
      maxX = Math.max(maxX, nx + nw);
      maxY = Math.max(maxY, ny + nh);

      const cellAttrs = cell.attrs ?? {};
      const bodyAttrs = cellAttrs.body ?? {};
      const labelAttrs = cellAttrs.label ?? {};

      nodes.push({
        id: cell.id,
        shape: cell.shape,
        x: nx,
        y: ny,
        width: nw,
        height: nh,
        angle: cell.angle ?? 0,
        opacity: cell.opacity ?? 1,
        zIndex: cell.zIndex ?? 1,
        markup: cell.markup ?? { tagName: cell.shape === "circle" ? "circle" : "rect", selector: "body" },
        ports: cell.ports ?? { items: [], groups: {} },
        attrs: {
          body: {
            fill: bodyAttrs.fill ?? "#1e293b",
            stroke: bodyAttrs.stroke ?? "#38bdf8",
            strokeWidth: bodyAttrs.strokeWidth ?? 1.8,
            rx: bodyAttrs.rx ?? (cell.shape === "circle" ? nw / 2 : 6),
            ry: bodyAttrs.ry ?? (cell.shape === "circle" ? nh / 2 : 6),
          },
          label: {
            text: labelAttrs.text ?? cell.label ?? cell.id,
            fill: labelAttrs.fill ?? "#f8fafc",
            fontSize: labelAttrs.fontSize ?? 11,
          },
        },
        data: cell.data,
        properties: cell.properties,
      });
    }
  }

  if (!isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 800;
    maxY = 600;
  }

  return {
    nodes,
    edges,
    coordinateSystem: {
      x: minX,
      y: minY,
      width: Math.max(100, maxX - minX),
      height: Math.max(100, maxY - minY),
    },
    diagramBackground: null,
  };
}

/**
 * Headless SVG Serializer for cell graphs.
 */
export function renderCellsSvg(
  graph: { title?: string | undefined; cells: RawGraphCell[] },
  options: SvgExportOptions = {},
): string {
  const diagram = cellsToDiagramData(graph);
  return renderPolyglotDiagramToSvg(diagram, options);
}
