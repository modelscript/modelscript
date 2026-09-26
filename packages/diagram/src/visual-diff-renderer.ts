// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Headless SVG Serializer for ModelScript Visual PR Diffs.
// Renders VisualDiffData into a standalone, pure SVG XML string with zero DOM dependencies.
// Features color-coded diff statuses (+ added, − deleted, ~ modified), breaking change tags,
// jumpover crossings, and diff summary badges.

import { computeJumpoverPath, computeSmoothBezierPath, type JumpoverSegment, type PointLike } from "./port-router.js";
import type { SvgExportOptions } from "./protocol.js";
import type { VisualDiffData, VisualDiffEdge, VisualDiffNode } from "./visual-diff-graph.js";

export interface VisualDiffSvgOptions extends SvgExportOptions {
  /** Include the diff statistics header banner in the SVG. Default: true */
  showStatsBanner?: boolean;
  /** Custom title for the diff banner. */
  title?: string;
  /** Dim unchanged elements to emphasize changes. Default: true */
  dimUnchanged?: boolean;
}

function escapeXml(str: any): string {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Headless SVG Serializer for VisualDiffData.
 */
export function renderVisualDiffToSvg(diffData: VisualDiffData, options: VisualDiffSvgOptions = {}): string {
  const isDark = options.theme !== "light";
  const padding = options.padding ?? 40;
  const showBanner = options.showStatsBanner !== false;
  const dimUnchanged = options.dimUnchanged !== false;

  const bgColor = options.background ?? (isDark ? "#090d16" : "#ffffff");
  const textColor = isDark ? "#f8fafc" : "#0f172a";
  const mutedTextColor = isDark ? "#94a3b8" : "#64748b";

  // Visual Diff Color Palette
  const addedStroke = "#22c55e";
  const addedFill = isDark ? "#062b16" : "#f0fdf4";
  const addedBadgeBg = "#15803d";

  const deletedStroke = "#ef4444";
  const deletedFill = isDark ? "#380b0b" : "#fef2f2";
  const deletedBadgeBg = "#b91c1c";

  const modifiedStroke = "#f59e0b";
  const modifiedFill = isDark ? "#381f08" : "#fffbeb";
  const modifiedBadgeBg = "#b45309";

  const unchangedBorder = isDark ? "#334155" : "#cbd5e1";
  const unchangedFill = isDark ? "#1e293b" : "#f8fafc";
  const unchangedEdgeStroke = isDark ? "#475569" : "#94a3b8";

  // Calculate ViewBox bounds
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const nodeMap = new Map<string, VisualDiffNode>();
  for (const n of diffData.nodes) {
    nodeMap.set(n.id, n);
    const nx = n.x ?? 0;
    const ny = n.y ?? 0;
    const nw = n.width ?? 120;
    const nh = n.height ?? 60;
    minX = Math.min(minX, nx);
    minY = Math.min(minY, ny);
    maxX = Math.max(maxX, nx + nw);
    maxY = Math.max(maxY, ny + nh);
  }

  for (const e of diffData.edges) {
    if (e.vertices) {
      for (const v of e.vertices) {
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

  const bannerHeight = showBanner ? 56 : 0;
  const viewBoxX = Math.floor(minX - padding);
  const viewBoxY = Math.floor(minY - padding - bannerHeight);
  const viewBoxW = Math.ceil(maxX - minX + padding * 2);
  const viewBoxH = Math.ceil(maxY - minY + padding * 2 + bannerHeight);

  // SVG Defs
  const defs: string[] = [];
  defs.push(`
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;display=swap');
      text { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      .diff-banner-title { font-size: 14px; font-weight: 700; fill: ${textColor}; }
      .diff-stat-pill { font-size: 11px; font-weight: 600; }
      .node-title { font-size: 13px; font-weight: 600; }
      .node-stereotype { font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; }
      .compartment-header { font-size: 10px; font-weight: 600; font-style: italic; }
      .compartment-row { font-size: 11px; }
      .edge-label { font-size: 11px; font-weight: 500; }
      .diff-badge-text { font-size: 11px; font-weight: 800; fill: #ffffff; text-anchor: middle; dominant-baseline: central; }
      .breaking-pill { font-size: 9px; font-weight: 700; text-transform: uppercase; fill: #ffffff; }
    </style>
    <filter id="diff-shadow" x="-5%" y="-5%" width="115%" height="115%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="${isDark ? "0.5" : "0.15"}"/>
    </filter>
    <filter id="added-glow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="${addedStroke}" flood-opacity="0.4"/>
    </filter>

    <!-- Markers for Added / Deleted / Modified Edges -->
    <marker id="marker-added" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="${addedStroke}"/>
    </marker>
    <marker id="marker-deleted" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="${deletedStroke}"/>
    </marker>
    <marker id="marker-modified" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="${modifiedStroke}"/>
    </marker>
    <marker id="marker-unchanged" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="${unchangedEdgeStroke}"/>
    </marker>
  `);

  const bodyParts: string[] = [];

  // Background
  bodyParts.push(`<rect x="${viewBoxX}" y="${viewBoxY}" width="${viewBoxW}" height="${viewBoxH}" fill="${bgColor}"/>`);

  // Diff Stats Banner
  if (showBanner) {
    const bannerY = viewBoxY + 12;
    const bannerW = viewBoxW - 24;
    const bannerX = viewBoxX + 12;

    bodyParts.push(`
      <g id="diff-stats-banner">
        <rect x="${bannerX}" y="${bannerY}" width="${bannerW}" height="40" rx="8" fill="${isDark ? "#131b2e" : "#f1f5f9"}" stroke="${isDark ? "#1e293b" : "#e2e8f0"}" stroke-width="1"/>
        <text x="${bannerX + 16}" y="${bannerY + 24}" class="diff-banner-title">${escapeXml(options.title || "Visual Model Diff (Base ➔ Head)")}</text>
        
        <!-- Stats Badges -->
        <g transform="translate(${bannerX + bannerW - 380}, ${bannerY + 10})">
          <!-- Added -->
          <rect x="0" y="0" width="76" height="20" rx="10" fill="${isDark ? "#062b16" : "#dcfce7"}" stroke="${addedStroke}" stroke-width="1"/>
          <text x="38" y="14" text-anchor="middle" class="diff-stat-pill" fill="${addedStroke}">+${diffData.stats.addedNodes} Added</text>
          
          <!-- Deleted -->
          <rect x="84" y="0" width="84" height="20" rx="10" fill="${isDark ? "#380b0b" : "#fee2e2"}" stroke="${deletedStroke}" stroke-width="1"/>
          <text x="126" y="14" text-anchor="middle" class="diff-stat-pill" fill="${deletedStroke}">−${diffData.stats.deletedNodes} Deleted</text>
          
          <!-- Modified -->
          <rect x="176" y="0" width="94" height="20" rx="10" fill="${isDark ? "#381f08" : "#fef3c7"}" stroke="${modifiedStroke}" stroke-width="1"/>
          <text x="223" y="14" text-anchor="middle" class="diff-stat-pill" fill="${modifiedStroke}">~${diffData.stats.modifiedNodes} Modified</text>

          <!-- Breaking Changes Tag -->
          ${
            diffData.stats.breakingChanges > 0
              ? `
          <rect x="278" y="0" width="94" height="20" rx="10" fill="#dc2626"/>
          <text x="325" y="14" text-anchor="middle" class="diff-stat-pill" fill="#ffffff">⚠ ${diffData.stats.breakingChanges} Breaking</text>
          `
              : ""
          }
        </g>
      </g>
    `);
  }

  // Edge Segments & Rendering
  const edgeSegments: JumpoverSegment[] = [];
  const edgePaths: {
    edge: VisualDiffEdge;
    points: PointLike[];
    stroke: string;
    strokeWidth: number;
    dash?: string;
    markerEnd?: string;
    opacity: number;
  }[] = [];

  for (const edge of diffData.edges) {
    const srcId = typeof edge.source === "string" ? edge.source : edge.source?.cell;
    const tgtId = typeof edge.target === "string" ? edge.target : edge.target?.cell;

    const srcNode = srcId ? nodeMap.get(srcId) : undefined;
    const tgtNode = tgtId ? nodeMap.get(tgtId) : undefined;

    let pSrc: PointLike = { x: 0, y: 0 };
    if (srcNode) {
      const sw = srcNode.width ?? 120;
      const sh = srcNode.height ?? 60;
      pSrc = { x: (srcNode.x ?? 0) + sw / 2, y: (srcNode.y ?? 0) + sh / 2 };
      if (typeof edge.source === "object" && edge.source?.port && srcNode.ports?.items) {
        const pt = srcNode.ports.items.find((p) => p.id === edge.source?.port);
        if (pt?.args) pSrc = { x: (srcNode.x ?? 0) + pt.args.x, y: (srcNode.y ?? 0) + pt.args.y };
      }
    }

    let pTgt: PointLike = { x: 0, y: 0 };
    if (tgtNode) {
      const tw = tgtNode.width ?? 120;
      const th = tgtNode.height ?? 60;
      pTgt = { x: (tgtNode.x ?? 0) + tw / 2, y: (tgtNode.y ?? 0) + th / 2 };
      if (typeof edge.target === "object" && edge.target?.port && tgtNode.ports?.items) {
        const pt = tgtNode.ports.items.find((p) => p.id === edge.target?.port);
        if (pt?.args) pTgt = { x: (tgtNode.x ?? 0) + pt.args.x, y: (tgtNode.y ?? 0) + pt.args.y };
      }
    }

    const points: PointLike[] = [pSrc, ...(edge.vertices || []), pTgt];

    let stroke = unchangedEdgeStroke;
    let strokeWidth = 1.5;
    let dash: string | undefined = undefined;
    let markerEnd = "url(#marker-unchanged)";
    let opacity = dimUnchanged ? 0.45 : 0.8;

    if (edge.diffStatus === "added") {
      stroke = addedStroke;
      strokeWidth = 2.5;
      markerEnd = "url(#marker-added)";
      opacity = 1.0;
    } else if (edge.diffStatus === "deleted") {
      stroke = deletedStroke;
      strokeWidth = 2.0;
      dash = "6,4";
      markerEnd = "url(#marker-deleted)";
      opacity = 0.85;
    } else if (edge.diffStatus === "modified") {
      stroke = modifiedStroke;
      strokeWidth = 2.5;
      markerEnd = "url(#marker-modified)";
      opacity = 1.0;
    }

    for (let i = 0; i < points.length - 1; i++) {
      edgeSegments.push({ p1: points[i], p2: points[i + 1] });
    }

    edgePaths.push({ edge, points, stroke, strokeWidth, dash, markerEnd, opacity });
  }

  // Draw Edges with Jumpover handling
  bodyParts.push(`<g id="diff-edges">`);
  for (let idx = 0; idx < edgePaths.length; idx++) {
    const ep = edgePaths[idx];
    const isCurved = ep.edge.connector === "smooth" || ep.edge.connector === "bezier";
    let d: string;

    if (isCurved) {
      d = computeSmoothBezierPath(ep.points);
    } else {
      const obstacleSegments = edgeSegments.filter((_, segIdx) => Math.floor(segIdx / (ep.points.length - 1)) < idx);
      d = computeJumpoverPath(ep.points, obstacleSegments, { radius: 6 });
    }

    const dashAttr = ep.dash ? ` stroke-dasharray="${ep.dash}"` : "";
    const markerAttr = ep.markerEnd ? ` marker-end="${ep.markerEnd}"` : "";

    bodyParts.push(`
      <path d="${d}" fill="none" stroke="${ep.stroke}" stroke-width="${ep.strokeWidth}" opacity="${ep.opacity}"${dashAttr}${markerAttr} vector-effect="non-scaling-stroke"/>
    `);
  }
  bodyParts.push(`</g>`);

  // Draw Nodes
  bodyParts.push(`<g id="diff-nodes">`);
  for (const node of diffData.nodes) {
    const nx = node.x ?? 0;
    const ny = node.y ?? 0;
    const nw = node.width ?? 120;
    const nh = node.height ?? 60;

    let border = unchangedBorder;
    let fill = unchangedFill;
    let borderWidth = 1.5;
    let borderDash = "";
    let opacity = dimUnchanged && node.diffStatus === "unchanged" ? 0.5 : 1.0;
    let filterAttr = `filter="url(#diff-shadow)"`;

    let badgeText = "";
    let badgeBg = "";

    if (node.diffStatus === "added") {
      border = addedStroke;
      fill = addedFill;
      borderWidth = 2.5;
      badgeText = "+";
      badgeBg = addedBadgeBg;
      filterAttr = `filter="url(#added-glow)"`;
    } else if (node.diffStatus === "deleted") {
      border = deletedStroke;
      fill = deletedFill;
      borderWidth = 2.0;
      borderDash = `stroke-dasharray="6,4"`;
      badgeText = "−";
      badgeBg = deletedBadgeBg;
      opacity = 0.75;
    } else if (node.diffStatus === "modified") {
      border = modifiedStroke;
      fill = modifiedFill;
      borderWidth = 2.5;
      badgeText = "~";
      badgeBg = modifiedBadgeBg;
    }

    const title = escapeXml(node.properties?.values?.name || node.id || "Component");
    const stereotype = escapeXml(node.properties?.values?.typeName || node.properties?.values?.type || "");

    bodyParts.push(`
      <g class="diff-node" transform="translate(${nx}, ${ny})" opacity="${opacity}">
        <!-- Node Box -->
        <rect x="0" y="0" width="${nw}" height="${nh}" rx="8" fill="${fill}" stroke="${border}" stroke-width="${borderWidth}" ${borderDash} ${filterAttr}/>

        <!-- Deleted Diagonal Strikethrough Line -->
        ${
          node.diffStatus === "deleted"
            ? `<line x1="4" y1="4" x2="${nw - 4}" y2="${nh - 4}" stroke="${deletedStroke}" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.6"/>`
            : ""
        }

        <!-- Stereotype / Type -->
        ${
          stereotype
            ? `<text x="14" y="20" class="node-stereotype" fill="${mutedTextColor}">«${stereotype}»</text>`
            : ""
        }

        <!-- Name / Identifier -->
        <text x="14" y="${stereotype ? 38 : 32}" class="node-title" fill="${textColor}">${title}</text>

        <!-- Status Badge (+, −, ~) -->
        ${
          badgeText
            ? `
        <g class="diff-badge" transform="translate(${nw - 12}, -8)">
          <circle cx="0" cy="0" r="11" fill="${badgeBg}" stroke="#ffffff" stroke-width="1.5"/>
          <text x="0" y="0" class="diff-badge-text">${badgeText}</text>
        </g>
        `
            : ""
        }

        <!-- Breaking Tag Pill on Modified Node -->
        ${
          node.isBreaking && node.diffStatus === "modified"
            ? `
        <g transform="translate(14, ${nh - 18})">
          <rect x="0" y="0" width="70" height="14" rx="4" fill="#dc2626"/>
          <text x="35" y="10" text-anchor="middle" class="breaking-pill">BREAKING</text>
        </g>
        `
            : ""
        }
      </g>
    `);
  }
  bodyParts.push(`</g>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${viewBoxX} ${viewBoxY} ${viewBoxW} ${viewBoxH}" width="${viewBoxW}" height="${viewBoxH}">
  <defs>
    ${defs.join("\n")}
  </defs>
  ${bodyParts.join("\n")}
</svg>`;
}
