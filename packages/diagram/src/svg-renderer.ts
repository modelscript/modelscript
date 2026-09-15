// SPDX-License-Identifier: AGPL-3.0-or-later

import { computeJumpoverPath, computeSmoothBezierPath, type JumpoverSegment, type PointLike } from "./port-router.js";
import type { DiagramData, DiagramEdge, DiagramNode, SvgExportOptions } from "./protocol.js";

/**
 * Escapes XML special characters.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Headless SVG Serializer for ModelScript Polyglot Diagrams.
 * Renders DiagramData into a standalone, pure SVG XML string with zero DOM dependencies.
 */
export function renderPolyglotDiagramToSvg(diagram: DiagramData, options: SvgExportOptions = {}): string {
  const isDark = options.theme !== "light";
  const padding = options.padding ?? 40;
  const bgColor = options.background ?? (isDark ? "#0f172a" : "#ffffff");
  const textColor = isDark ? "#f8fafc" : "#0f172a";
  const mutedTextColor = isDark ? "#94a3b8" : "#64748b";
  const borderColor = isDark ? "#334155" : "#cbd5e1";
  const defaultNodeFill = isDark ? "#1e293b" : "#f1f5f9";
  const defaultEdgeStroke = isDark ? "#38bdf8" : "#0284c7";

  // 1. Calculate bounding box enclosing all nodes and edges
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const nodeMap = new Map<string, DiagramNode>();

  for (const node of diagram.nodes) {
    nodeMap.set(node.id, node);
    const nx = node.x ?? 0;
    const ny = node.y ?? 0;
    const nw = node.width ?? 120;
    const nh = node.height ?? 60;

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
    dash?: string;
    markerEnd?: string;
    markerStart?: string;
  }[] = [];

  for (const edge of diagram.edges) {
    const srcId = typeof edge.source === "string" ? edge.source : edge.source?.cell;
    const tgtId = typeof edge.target === "string" ? edge.target : edge.target?.cell;

    const srcNode = srcId ? nodeMap.get(srcId) : undefined;
    const tgtNode = tgtId ? nodeMap.get(tgtId) : undefined;

    // Calculate source point
    let pSrc: PointLike = { x: 0, y: 0 };
    if (srcNode) {
      const sw = srcNode.width ?? 120;
      const sh = srcNode.height ?? 60;
      pSrc = { x: (srcNode.x ?? 0) + sw / 2, y: (srcNode.y ?? 0) + sh / 2 };
      // Check port if specified
      if (typeof edge.source === "object" && edge.source?.port && srcNode.ports?.items) {
        const pt = srcNode.ports.items.find((p) => p.id === edge.source?.port);
        if (pt?.args) {
          pSrc = { x: (srcNode.x ?? 0) + (pt.args.x ?? sw / 2), y: (srcNode.y ?? 0) + (pt.args.y ?? sh / 2) };
        }
      }
    }

    // Calculate target point
    let pTgt: PointLike = { x: 0, y: 0 };
    if (tgtNode) {
      const tw = tgtNode.width ?? 120;
      const th = tgtNode.height ?? 60;
      pTgt = { x: (tgtNode.x ?? 0) + tw / 2, y: (tgtNode.y ?? 0) + th / 2 };
      if (typeof edge.target === "object" && edge.target?.port && tgtNode.ports?.items) {
        const pt = tgtNode.ports.items.find((p) => p.id === edge.target?.port);
        if (pt?.args) {
          pTgt = { x: (tgtNode.x ?? 0) + (pt.args.x ?? tw / 2), y: (tgtNode.y ?? 0) + (pt.args.y ?? th / 2) };
        }
      }
    }

    const points: PointLike[] = [pSrc];
    if (edge.vertices) {
      for (const v of edge.vertices) {
        points.push({ x: v.x, y: v.y });
      }
    }
    points.push(pTgt);

    // Register segments
    for (let i = 0; i < points.length - 1; i++) {
      edgeSegments.push({ p1: points[i], p2: points[i + 1] });
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

  // 5. Render Edges (with jumpover crossing and smooth Bezier support)
  bodyParts.push(`<g id="edges">`);
  for (const ep of edgePaths) {
    const isJumpover = ep.edge.connector === "jumpover" || ep.edge.style?.connector === "jumpover";
    const isSmooth =
      ep.edge.connector === "smooth" ||
      ep.edge.connector === "bezier" ||
      ep.edge.style?.connector === "smooth" ||
      ep.edge.style?.connector === "bezier" ||
      ep.edge.router === "bezier" ||
      ep.edge.style?.router === "bezier";

    let d = "";
    if (isJumpover) {
      // Find obstacles from other edges
      const obstacles = edgeSegments.filter((s) => !ep.points.some((p) => p === s.p1 || p === s.p2));
      d = computeJumpoverPath(ep.points, obstacles, { radius: 5 });
    } else if (isSmooth) {
      d = computeSmoothBezierPath(ep.points);
    } else {
      d = `M ${ep.points[0].x} ${ep.points[0].y}`;
      for (let i = 1; i < ep.points.length; i++) {
        d += ` L ${ep.points[i].x} ${ep.points[i].y}`;
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
      const lp = ep.points[midIdx];
      const labelText = ep.edge.labels[0].attrs?.text?.text || "";
      if (labelText) {
        bodyParts.push(
          `<text x="${lp.x}" y="${lp.y - 6}" text-anchor="middle" fill="${mutedTextColor}" class="edge-label">${escapeXml(String(labelText))}</text>`,
        );
      }
    }
  }
  bodyParts.push(`</g>`);

  // 6. Render Nodes
  bodyParts.push(`<g id="nodes">`);
  for (const node of diagram.nodes) {
    const nx = node.x ?? 0;
    const ny = node.y ?? 0;
    const nw = node.width ?? 120;
    const nh = node.height ?? 60;

    let fill = (node.attrs?.body?.fill as string) || defaultNodeFill;
    const fillPattern = (node.attrs?.body?.fillPattern as string) || (node.data?.fillPattern as string);
    if (fillPattern === "HorizontalCylinder") {
      fill = "url(#grad-cylinder-horizontal)";
    } else if (fillPattern === "VerticalCylinder") {
      fill = "url(#grad-cylinder-vertical)";
    } else if (fillPattern === "Sphere") {
      fill = "url(#grad-sphere)";
    }

    const stroke = (node.attrs?.body?.stroke as string) || borderColor;
    const strokeWidth = (node.attrs?.body?.strokeWidth as number) || 1.5;
    const rx = (node.attrs?.body?.rx as number) || 6;
    const ry = (node.attrs?.body?.ry as number) || 6;
    const labelText = (node.attrs?.label?.text as string) || (node.properties?.description as string) || node.id;
    const stereotype = (node.data?.ruleName as string) || (node.properties?.className as string);
    const multiplicity = (node.data?.multiplicity as number) || 1;
    const iconUrl =
      (node.attrs?.icon?.href as string) ||
      (node.attrs?.icon?.["xlink:href"] as string) ||
      (node.data?.icon as string) ||
      (node.properties?.icon as string);

    bodyParts.push(`<g id="${node.id}" transform="translate(${nx}, ${ny})" filter="url(#shadow)">`);

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
      // Header area
      if (stereotype) {
        bodyParts.push(
          `<text x="${nw / 2}" y="14" text-anchor="middle" fill="${mutedTextColor}" class="node-stereotype">«${escapeXml(stereotype)}»</text>`,
        );
      }
      bodyParts.push(
        `<text x="${nw / 2}" y="${curY}" text-anchor="middle" fill="${textColor}" class="node-title">${escapeXml(labelText)}</text>`,
      );
      curY += 10;

      // Divider below title
      bodyParts.push(`<line x1="0" y1="${curY}" x2="${nw}" y2="${curY}" stroke="${borderColor}" stroke-width="1"/>`);
      curY += 4;

      for (const sec of sections) {
        curY += 12;
        bodyParts.push(
          `<text x="8" y="${curY}" fill="${mutedTextColor}" class="compartment-header">«${escapeXml(sec.header)}»</text>`,
        );
        for (const entry of sec.entries) {
          curY += 14;
          bodyParts.push(
            `<text x="12" y="${curY}" fill="${textColor}" class="compartment-row">${escapeXml(entry)}</text>`,
          );
        }
        curY += 4;
        bodyParts.push(
          `<line x1="0" y1="${curY}" x2="${nw}" y2="${curY}" stroke="${borderColor}" stroke-width="0.5"/>`,
        );
      }
    } else if (!iconUrl) {
      // Standard Node Label (when no icon is centered)
      if (stereotype) {
        bodyParts.push(
          `<text x="${nw / 2}" y="${nh / 2 - 8}" text-anchor="middle" fill="${mutedTextColor}" class="node-stereotype">«${escapeXml(stereotype)}»</text>`,
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
        bodyParts.push(
          `<circle cx="${px}" cy="${py}" r="3.5" fill="${isDark ? "#38bdf8" : "#0284c7"}" stroke="${isDark ? "#0f172a" : "#ffffff"}" stroke-width="1"/>`,
        );
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
