// SPDX-License-Identifier: AGPL-3.0-or-later

import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useXR, useXRInputSourceState } from "@react-three/xr";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { GalleryComponentItem } from "./componentGalleryCatalog.js";
import { resolveDiagramLanguageTheme } from "./diagram-language-theme.js";
import {
  buildFallbackLibraryTree,
  buildGlassPanelLayout,
  clampBezelRepositionOffset,
  computeActivePanelTransitionOffset,
  computeGlassStackPoses,
  computeHeadParallaxGlintOffset,
  computeHeadRelativeAnchor,
  computeMaxScrollRow,
  computePinnedPanelOffset,
  computeTileLocalCenter3D,
  createInitialGlassLibraryState,
  drillIntoGlassNode,
  evaluateBareHandSwipe,
  evaluateTetherPullStep,
  extractAvailableLanguages,
  filterRootLibrariesByLanguage,
  findAncestorPathInLocalTree,
  GLASS_ACTIVE_POS,
  GLASS_CANVAS_H,
  GLASS_CANVAS_W,
  GLASS_GRID_COLS,
  GLASS_GRID_VISIBLE_ROWS,
  GLASS_HOLOGRAM_HOVER_DELAY_MS,
  GLASS_PANEL_CURVE_DEPTH,
  GLASS_PANEL_H,
  GLASS_PANEL_W,
  HIERARCHY_FLICK_COOLDOWN_MS,
  HIERARCHY_FLICK_ENGAGE,
  HIERARCHY_FLICK_RESET,
  hitTestGlassPanel,
  hydrateGlassLevelChildren,
  INITIAL_GLASS_TILE_MAGNET_STATE,
  isContainerLibraryNode,
  isNodeCompatibleWithOpenPorts,
  jumpToGlassDepth,
  loadStarredNodeIds,
  recordRecentComponent,
  searchLocalLibraryTree,
  sortNodesWithStarredFirst,
  splitFqnAncestorPrefixes,
  stepDownGlassHierarchy,
  stepGlassGridScroll,
  stepGlassTileMagnetLock,
  stepSiblingRotundaPan,
  stepUpGlassHierarchy,
  switchToSiblingContainer,
  toggleStarredNodeId,
  treeNodeToGlassLibraryNode,
  type ActivePanelTransitionKind,
  type BezelRepositionOffset,
  type GlassLibraryNavState,
  type GlassLibraryNode,
  type GlassPanelHitZone,
  type GlassPanelLayout,
  type GlassTileMagnetState,
  type HeadRelativeAnchor,
  type RotundaLibraryProvider,
} from "./glass-library-logic.js";
import {
  drawGlassContainerEmblem,
  drawGlassRoundedRect,
  GlassSkeletonGhostPanel,
  HoverTileHologram3D,
  requestSharedGlassSvg,
  RotundaSiblingAtlasRing,
  VrGlassKeyboard3D,
} from "./GlassLibrarySubComponents.js";
import type { SpatialPortDomain } from "./spatial-diagram-state.js";
import { evaluatePinchState } from "./xr-gestures.js";
import {
  applyStickDeadzone,
  pointAlongRayPose,
  pulseEventHaptic,
  releaseEventForBinding,
  resolveXrPointerBinding,
  sampleBindingPose,
  type XrPointerBinding,
} from "./xr-handle.js";
import { getSharedXrStore, pulseXrHaptics, type RotundaCueKind } from "./xr-session.js";

const NOOP_RAYCAST: THREE.Object3D["raycast"] = () => {};
const UI_FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
const CANVAS_SCROLL_REPAINT_MIN_MS = 32;

function createCurvedGlassGeometry(width: number, height: number, curveDepth: number, segs = 28): THREE.PlaneGeometry {
  const geom = new THREE.PlaneGeometry(width, height, segs, 1);
  const pos = geom.attributes["position"];
  if (pos) {
    const halfW = width * 0.5;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const t = x / halfW;
      pos.setZ(i, curveDepth * (t * t));
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();
  }
  return geom;
}

function createGenericSkeletonTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const w = 512;
  const h = 362;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, w, h);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(15, 23, 42, 0.72)");
  grad.addColorStop(1, "rgba(9, 15, 29, 0.78)");
  drawGlassRoundedRect(ctx, 4, 4, w - 8, h - 8, 18);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "rgba(148, 163, 184, 0.42)";
  ctx.stroke();

  drawGlassRoundedRect(ctx, 20, 18, 180, 18, 9);
  ctx.fillStyle = "rgba(148, 163, 184, 0.28)";
  ctx.fill();
  drawGlassRoundedRect(ctx, 212, 20, 74, 14, 7);
  ctx.fillStyle = "rgba(56, 189, 248, 0.25)";
  ctx.fill();

  const gx = 20;
  const gy = 54;
  const gap = 10;
  const tw = (w - gx * 2 - gap * 3) / 4;
  const th = (h - gy - 22 - gap * 2) / 3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      const tx = gx + c * (tw + gap);
      const ty = gy + r * (th + gap);
      drawGlassRoundedRect(ctx, tx, ty, tw, th, 10);
      ctx.fillStyle = "rgba(30, 41, 59, 0.56)";
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = "rgba(148, 163, 184, 0.22)";
      ctx.stroke();
      drawGlassRoundedRect(ctx, tx + tw * 0.28, ty + 12, tw * 0.44, th * 0.44, 8);
      ctx.fillStyle = "rgba(148, 163, 184, 0.16)";
      ctx.fill();
      drawGlassRoundedRect(ctx, tx + 14, ty + th - 18, tw - 28, 8, 4);
      ctx.fillStyle = "rgba(148, 163, 184, 0.22)";
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  tex.needsUpdate = true;
  return tex;
}

/* -------------------------------------------------------------------------- */
/*  Active Foreground Polished Glass Panel Canvas Painter                     */
/* -------------------------------------------------------------------------- */

function paintActiveGlassPanel(
  ctx: CanvasRenderingContext2D,
  nav: GlassLibraryNavState,
  visibleItems: readonly GlassLibraryNode[],
  scrollRow: number,
  layout: GlassPanelLayout,
  hoveredZone: GlassPanelHitZone | null,
  lockedTileIndex: number | null,
  activeLangFilter: string,
  recentItems: readonly GalleryComponentItem[],
  starredIds: ReadonlySet<string>,
  openPortDomains: readonly SpatialPortDomain[] | undefined,
  pinned: boolean,
  searchOpen: boolean,
  searchQuery: string,
  onImageReady: () => void,
): void {
  const activeLevel = nav.levels[nav.activeDepth];
  if (!activeLevel) return;

  ctx.clearRect(0, 0, GLASS_CANVAS_W, GLASS_CANVAS_H);

  const langTheme = resolveDiagramLanguageTheme(activeLevel.languageId);
  const accent = activeLevel.accentColor || langTheme.accentColor;

  // 1. Polished translucent studio-glass panel slab
  const bgGrad = ctx.createLinearGradient(0, 0, 0, GLASS_CANVAS_H);
  bgGrad.addColorStop(0, "rgba(15, 23, 42, 0.86)");
  bgGrad.addColorStop(0.45, "rgba(10, 18, 36, 0.82)");
  bgGrad.addColorStop(1, "rgba(7, 13, 27, 0.88)");
  drawGlassRoundedRect(ctx, 6, 6, GLASS_CANVAS_W - 12, GLASS_CANVAS_H - 12, 34);
  ctx.fillStyle = bgGrad;
  ctx.fill();

  ctx.save();
  drawGlassRoundedRect(ctx, 8, 8, GLASS_CANVAS_W - 16, 130, 32);
  ctx.clip();
  const sheen = ctx.createLinearGradient(0, 8, 0, 138);
  sheen.addColorStop(0, "rgba(255, 255, 255, 0.14)");
  sheen.addColorStop(1, "rgba(255, 255, 255, 0.0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(8, 8, GLASS_CANVAS_W - 16, 130);
  ctx.restore();

  drawGlassRoundedRect(ctx, 6, 6, GLASS_CANVAS_W - 12, GLASS_CANVAS_H - 12, 34);
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = pinned ? "#22d3ee" : `${accent}aa`;
  ctx.stroke();

  drawGlassRoundedRect(ctx, 13, 13, GLASS_CANVAS_W - 26, GLASS_CANVAS_H - 26, 28);
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = "rgba(226, 232, 240, 0.18)";
  ctx.stroke();

  // 2. Header Bar
  const titleX = 46;
  const titleY = layout.headerY + 26;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#f8fafc";
  ctx.font = `800 30px ${UI_FONT}`;
  const headerTitle = searchOpen
    ? searchQuery
      ? `🔍 "${searchQuery}"`
      : "🔍 Search Libraries…"
    : activeLevel.title.length > 22
      ? `${activeLevel.title.slice(0, 21)}…`
      : activeLevel.title;
  ctx.fillText(headerTitle, titleX, titleY);

  const titleW = Math.min(410, ctx.measureText(headerTitle).width);
  const badgeX = titleX + titleW + 16;
  const badgeText = searchOpen
    ? `${visibleItems.length} MATCHES`
    : nav.activeDepth === 0
      ? `${visibleItems.length} LIBRARIES`
      : `${langTheme.badgeLabel} · ${visibleItems.length}`;
  ctx.font = `700 15px ${UI_FONT}`;
  const badgeW = Math.max(108, ctx.measureText(badgeText).width + 24);
  drawGlassRoundedRect(ctx, badgeX, titleY - 15, badgeW, 30, 15);
  ctx.fillStyle = `${accent}38`;
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = `${accent}cc`;
  ctx.stroke();
  ctx.fillStyle = "#e0f2fe";
  ctx.textAlign = "center";
  ctx.fillText(badgeText, badgeX + badgeW * 0.5, titleY + 1);

  // Language filter pills (root) OR breadcrumbs
  const langFilterZones = layout.zones.filter((z) => z.kind === "lang-filter");
  if (langFilterZones.length > 0 && !searchOpen) {
    for (const z of langFilterZones) {
      const lid = z.languageId ?? "all";
      const isSelected = lid === activeLangFilter;
      const isHov = hoveredZone?.kind === "lang-filter" && hoveredZone.languageId === lid;
      const chipTheme = lid === "all" ? null : resolveDiagramLanguageTheme(lid);
      const chipAccent = chipTheme?.accentColor ?? "#38bdf8";

      drawGlassRoundedRect(ctx, z.x, z.y, z.w, z.h, 12);
      ctx.fillStyle = isSelected ? chipAccent : isHov ? `${chipAccent}44` : "rgba(30, 41, 59, 0.62)";
      ctx.fill();
      ctx.lineWidth = isSelected || isHov ? 2 : 1.2;
      ctx.strokeStyle = isSelected ? "#e0f2fe" : isHov ? chipAccent : "rgba(148, 163, 184, 0.3)";
      ctx.stroke();

      ctx.fillStyle = isSelected ? "#ffffff" : "#cbd5e1";
      ctx.font = `700 14px ${UI_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = lid === "all" ? "All" : (chipTheme?.badgeLabel ?? lid.toUpperCase()).slice(0, 10);
      ctx.fillText(label, z.x + z.w * 0.5, z.y + z.h * 0.52);
    }
  } else if (!searchOpen) {
    const crumbZones = layout.zones.filter((z) => z.kind === "breadcrumb");
    const startCrumbIdx = Math.max(0, nav.activeDepth + 1 - crumbZones.length);
    crumbZones.forEach((z, ci) => {
      const lvIdx = startCrumbIdx + ci;
      const lv = nav.levels[lvIdx];
      if (!lv) return;
      const isCurrent = lvIdx === nav.activeDepth;
      const isHov = hoveredZone?.kind === "breadcrumb" && hoveredZone.index === ci;
      drawGlassRoundedRect(ctx, z.x, z.y, z.w, z.h, 10);
      ctx.fillStyle = isCurrent ? `${accent}44` : isHov ? "rgba(56, 189, 248, 0.25)" : "rgba(30, 41, 59, 0.52)";
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = isCurrent ? accent : "rgba(148, 163, 184, 0.28)";
      ctx.stroke();

      ctx.fillStyle = isCurrent ? "#ffffff" : "#cbd5e1";
      ctx.font = `${isCurrent ? "700" : "600"} 15px ${UI_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lbl = lv.title.length > 15 ? `${lv.title.slice(0, 14)}…` : lv.title;
      ctx.fillText(lbl, z.x + z.w * 0.5, z.y + z.h * 0.52);
      if (ci < crumbZones.length - 1) {
        ctx.fillStyle = "rgba(148, 163, 184, 0.6)";
        ctx.font = `700 16px ${UI_FONT}`;
        ctx.fillText("›", z.x + z.w + 5, z.y + z.h * 0.52);
      }
    });
  }

  // Header action pills: Up, Down, Search, Pin, Close
  for (const z of layout.zones) {
    if (z.kind !== "up" && z.kind !== "down" && z.kind !== "search" && z.kind !== "pin" && z.kind !== "close") {
      continue;
    }
    const isHov = hoveredZone?.kind === z.kind;
    drawGlassRoundedRect(ctx, z.x, z.y, z.w, z.h, 13);
    if (z.kind === "close") {
      ctx.fillStyle = isHov ? "#ef4444" : "rgba(185, 28, 28, 0.65)";
      ctx.strokeStyle = isHov ? "#fecaca" : "rgba(248, 113, 113, 0.55)";
    } else if (z.kind === "pin") {
      ctx.fillStyle = pinned ? "#0891b2" : isHov ? "rgba(56, 189, 248, 0.35)" : "rgba(30, 41, 59, 0.78)";
      ctx.strokeStyle = pinned ? "#67e8f9" : isHov ? "#38bdf8" : "rgba(148, 163, 184, 0.45)";
    } else if (z.kind === "search") {
      ctx.fillStyle = searchOpen ? "#2563eb" : isHov ? "rgba(59, 130, 246, 0.4)" : "rgba(30, 41, 59, 0.78)";
      ctx.strokeStyle = searchOpen ? "#93c5fd" : isHov ? "#60a5fa" : "rgba(148, 163, 184, 0.45)";
    } else if (z.kind === "down") {
      ctx.fillStyle = isHov ? "#059669" : "rgba(16, 185, 129, 0.28)";
      ctx.strokeStyle = isHov ? "#6ee7b7" : "rgba(52, 211, 153, 0.65)";
    } else {
      ctx.fillStyle = isHov ? "#0284c7" : "rgba(30, 41, 59, 0.78)";
      ctx.strokeStyle = isHov ? "#7dd3fc" : "rgba(148, 163, 184, 0.45)";
    }
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${z.kind === "close" ? 22 : 16}px ${UI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const text =
      z.kind === "close"
        ? "✕"
        : z.kind === "pin"
          ? pinned
            ? "📌 On"
            : "📌 Pin"
          : z.kind === "search"
            ? "🔍 Find"
            : z.kind === "up"
              ? "▲ Up"
              : "▼ Child";
    ctx.fillText(text, z.x + z.w * 0.5, z.y + z.h * 0.52);
  }

  ctx.strokeStyle = "rgba(148, 163, 184, 0.22)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(layout.gridX, layout.gridY - 8);
  ctx.lineTo(GLASS_CANVAS_W - 34, layout.gridY - 8);
  ctx.stroke();

  // 3. Clipped 2D Scrollable Tile Grid
  ctx.save();
  drawGlassRoundedRect(ctx, layout.gridX - 4, layout.gridY - 2, layout.gridW + 8, layout.gridH + 4, 16);
  ctx.clip();

  if (activeLevel.loading && visibleItems.length === 0 && !searchOpen) {
    for (let r = 0; r < GLASS_GRID_VISIBLE_ROWS; r++) {
      for (let c = 0; c < GLASS_GRID_COLS; c++) {
        const tx = layout.gridX + c * (layout.tileW + layout.gapX);
        const ty = layout.gridY + r * (layout.tileH + layout.gapY);
        drawGlassRoundedRect(ctx, tx, ty, layout.tileW, layout.tileH, 18);
        ctx.fillStyle = "rgba(30, 41, 59, 0.45)";
        ctx.fill();
      }
    }
    ctx.fillStyle = "#94a3b8";
    ctx.font = `700 22px ${UI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Loading library contents…", layout.gridX + layout.gridW * 0.5, layout.gridY + layout.gridH * 0.5);
  } else if (visibleItems.length === 0) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = `700 22px ${UI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      searchOpen ? "Type or tap 🎙 to search components" : "No components in this package",
      layout.gridX + layout.gridW * 0.5,
      layout.gridY + layout.gridH * 0.5,
    );
  } else {
    const rowPitch = layout.tileH + layout.gapY;
    const firstRow = Math.max(0, Math.floor(scrollRow));
    const lastRow = Math.ceil(scrollRow) + GLASS_GRID_VISIBLE_ROWS;

    for (let row = firstRow; row <= lastRow; row++) {
      const ty = layout.gridY + (row - scrollRow) * rowPitch;
      if (ty + layout.tileH < layout.gridY - 4 || ty > layout.gridY + layout.gridH + 4) continue;
      for (let col = 0; col < GLASS_GRID_COLS; col++) {
        const idx = row * GLASS_GRID_COLS + col;
        const node = visibleItems[idx];
        if (!node) continue;

        const tx = layout.gridX + col * (layout.tileW + layout.gapX);
        const isHov =
          lockedTileIndex === idx ||
          (lockedTileIndex === null && hoveredZone?.kind === "tile" && hoveredZone.index === idx);
        const isStarHov = hoveredZone?.kind === "star" && hoveredZone.index === idx;
        const isStarred = starredIds.has(node.id) || starredIds.has(node.fqn);
        const isCompatible = isNodeCompatibleWithOpenPorts(node, openPortDomains);
        const isContainer = isContainerLibraryNode(node);
        const tileAccent = isCompatible ? "#10b981" : node.accentColor || accent;

        const tileGrad = ctx.createLinearGradient(tx, ty, tx, ty + layout.tileH);
        if (isHov) {
          tileGrad.addColorStop(0, "rgba(30, 58, 95, 0.92)");
          tileGrad.addColorStop(1, "rgba(15, 23, 42, 0.96)");
        } else if (isCompatible) {
          tileGrad.addColorStop(0, "rgba(6, 52, 42, 0.84)");
          tileGrad.addColorStop(1, "rgba(10, 26, 30, 0.88)");
        } else if (isContainer) {
          tileGrad.addColorStop(0, "rgba(30, 41, 59, 0.72)");
          tileGrad.addColorStop(1, "rgba(15, 23, 42, 0.80)");
        } else {
          tileGrad.addColorStop(0, "rgba(24, 34, 54, 0.78)");
          tileGrad.addColorStop(1, "rgba(12, 20, 36, 0.86)");
        }
        drawGlassRoundedRect(ctx, tx, ty, layout.tileW, layout.tileH, 18);
        ctx.fillStyle = tileGrad;
        ctx.fill();

        ctx.lineWidth = isHov ? 3.5 : isCompatible ? 2.4 : 1.6;
        ctx.strokeStyle = isHov
          ? "#38bdf8"
          : isCompatible
            ? "#34d399"
            : isContainer
              ? `${tileAccent}88`
              : "rgba(148, 163, 184, 0.28)";
        ctx.stroke();

        // Top accent bar
        drawGlassRoundedRect(ctx, tx + 14, ty + 10, layout.tileW - 28, 5, 2.5);
        ctx.fillStyle = isHov ? "#38bdf8" : tileAccent;
        ctx.fill();

        // Icon well
        const wellX = tx + 16;
        const wellY = ty + 22;
        const wellW = layout.tileW - 32;
        const wellH = Math.max(44, layout.tileH - 92);
        drawGlassRoundedRect(ctx, wellX, wellY, wellW, wellH, 12);
        ctx.fillStyle = isHov ? "rgba(56, 189, 248, 0.14)" : "rgba(255, 255, 255, 0.05)";
        ctx.fill();

        const img = node.iconSvg ? requestSharedGlassSvg(node.iconSvg, onImageReady) : null;
        if (img) {
          const pad = 10;
          const aspect = img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 80 / 56;
          let drawW = wellW - pad * 2;
          let drawH = drawW / aspect;
          if (drawH > wellH - pad * 2) {
            drawH = wellH - pad * 2;
            drawW = drawH * aspect;
          }
          ctx.drawImage(img, wellX + (wellW - drawW) * 0.5, wellY + (wellH - drawH) * 0.5, drawW, drawH);
        } else if (isContainer) {
          drawGlassContainerEmblem(
            ctx,
            node.kind,
            wellX + wellW * 0.5,
            wellY + wellH * 0.5,
            Math.min(wellW, wellH) * 0.68,
            tileAccent,
          );
        } else {
          ctx.strokeStyle = tileAccent;
          ctx.lineWidth = 2.8;
          drawGlassRoundedRect(ctx, wellX + wellW * 0.25, wellY + wellH * 0.22, wellW * 0.5, wellH * 0.56, 8);
          ctx.stroke();
        }

        // #7 Star favorite button (top-left of tile)
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `800 18px ${UI_FONT}`;
        ctx.fillStyle = isStarred ? "#fbbf24" : isStarHov ? "#fde68a" : "rgba(148, 163, 184, 0.45)";
        ctx.fillText(isStarred ? "★" : "☆", tx + 27, ty + 35);

        // "↗ Tree" reveal-in-hierarchy pill when viewing Search results
        const isRevealHov = hoveredZone?.kind === "reveal-tree" && hoveredZone.index === idx;
        if (searchOpen && node.fqn.includes(".")) {
          drawGlassRoundedRect(ctx, tx + layout.tileW - 86, ty + 18, 74, 28, 8);
          ctx.fillStyle = isRevealHov ? "#0284c7" : "rgba(30, 41, 59, 0.88)";
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = isRevealHov ? "#7dd3fc" : "#38bdf8";
          ctx.stroke();
          ctx.fillStyle = "#e0f2fe";
          ctx.font = `700 12px ${UI_FONT}`;
          ctx.fillText("↗ Tree", tx + layout.tileW - 49, ty + 33);
        } else if (isCompatible) {
          drawGlassRoundedRect(ctx, wellX + wellW - 58, wellY + 6, 52, 20, 6);
          ctx.fillStyle = "#059669";
          ctx.fill();
          ctx.fillStyle = "#ffffff";
          ctx.font = `800 11px ${UI_FONT}`;
          ctx.fillText("⚡ FIT", wellX + wellW - 32, wellY + 16);
        } else if (!isContainer && node.realisticKind) {
          drawGlassRoundedRect(ctx, wellX + wellW - 44, wellY + 6, 36, 22, 6);
          ctx.fillStyle = "#059669";
          ctx.fill();
          ctx.fillStyle = "#ffffff";
          ctx.font = `800 12px ${UI_FONT}`;
          ctx.fillText("3D", wellX + wellW - 26, wellY + 17);
        } else if (isContainer) {
          drawGlassRoundedRect(ctx, wellX + wellW - 34, wellY + 6, 26, 22, 6);
          ctx.fillStyle = `${tileAccent}44`;
          ctx.fill();
          ctx.fillStyle = "#e0f2fe";
          ctx.font = `800 16px ${UI_FONT}`;
          ctx.fillText("›", wellX + wellW - 21, wellY + 17);
        }

        // Tile title
        ctx.fillStyle = "#f8fafc";
        ctx.font = `800 19px ${UI_FONT}`;
        const label = node.name.length > 17 ? `${node.name.slice(0, 16)}…` : node.name;
        ctx.fillText(label, tx + layout.tileW * 0.5, ty + layout.tileH - 48);

        if (isHov) {
          drawGlassRoundedRect(ctx, tx + 18, ty + layout.tileH - 31, layout.tileW - 36, 22, 11);
          ctx.fillStyle = isContainer ? tileAccent : "#0284c7";
          ctx.fill();
          ctx.fillStyle = "#ffffff";
          ctx.font = `800 12px ${UI_FONT}`;
          ctx.fillText(
            isContainer ? "OPEN PACKAGE →" : "SELECT / GRAB → 3D",
            tx + layout.tileW * 0.5,
            ty + layout.tileH - 20,
          );
        } else {
          ctx.fillStyle = "#94a3b8";
          ctx.font = `600 13px monospace`;
          const sub = (node.subtitle ?? "").slice(0, 22);
          ctx.fillText(sub, tx + layout.tileW * 0.5, ty + layout.tileH - 20);
        }
      }
    }
  }
  ctx.restore();

  // 4. Right-Edge Scrollbar
  const sbX = layout.gridX + layout.gridW + 14;
  const sbW = 24;
  drawGlassRoundedRect(ctx, sbX, layout.gridY, sbW, layout.gridH, 12);
  ctx.fillStyle = "rgba(30, 41, 59, 0.55)";
  ctx.fill();

  const maxScroll = computeMaxScrollRow(visibleItems.length);
  const trackTop = layout.gridY + 52;
  const trackH = Math.max(40, layout.gridH - 104);
  if (maxScroll > 0) {
    const totalRows = Math.ceil(visibleItems.length / GLASS_GRID_COLS);
    const thumbH = Math.max(42, trackH * (GLASS_GRID_VISIBLE_ROWS / totalRows));
    const thumbY = trackTop + (scrollRow / maxScroll) * (trackH - thumbH);
    drawGlassRoundedRect(ctx, sbX + 4, thumbY, sbW - 8, thumbH, 8);
    ctx.fillStyle = accent;
    ctx.fill();
  }
  ctx.fillStyle = hoveredZone?.kind === "scroll-up" ? "#38bdf8" : "#cbd5e1";
  ctx.font = `800 18px ${UI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("▲", sbX + sbW * 0.5, layout.gridY + 24);
  ctx.fillStyle = hoveredZone?.kind === "scroll-down" ? "#38bdf8" : "#cbd5e1";
  ctx.fillText("▼", sbX + sbW * 0.5, layout.gridY + layout.gridH - 24);

  // 5. Persistent "Recently Placed" Quick-Grab Mini-Tray
  const recentZones = layout.zones.filter((z) => z.kind === "recent");
  if (recentZones.length > 0 && recentItems.length > 0) {
    const firstZ = recentZones[0]!;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#38bdf8";
    ctx.font = `800 14px monospace`;
    ctx.fillText("↺ RECENTS:", layout.gridX, firstZ.y + firstZ.h * 0.52);

    for (const rz of recentZones) {
      const it = rz.recentItem;
      if (!it) continue;
      const isHov = hoveredZone?.kind === "recent" && hoveredZone.index === rz.index;
      drawGlassRoundedRect(ctx, rz.x, rz.y, rz.w, rz.h, 12);
      ctx.fillStyle = isHov ? "rgba(2, 132, 199, 0.88)" : "rgba(30, 41, 59, 0.72)";
      ctx.fill();
      ctx.lineWidth = isHov ? 2.5 : 1.4;
      ctx.strokeStyle = isHov ? "#7dd3fc" : "rgba(56, 189, 248, 0.42)";
      ctx.stroke();

      ctx.fillStyle = "#f8fafc";
      ctx.font = `700 15px ${UI_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lbl = it.shortName.length > 16 ? `${it.shortName.slice(0, 15)}…` : it.shortName;
      ctx.fillText(lbl, rz.x + rz.w * 0.5, rz.y + rz.h * 0.52);
    }
  }

  // 6. Bottom Legend
  ctx.fillStyle = "rgba(148, 163, 184, 0.82)";
  ctx.font = `600 14px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const legend = pinned
    ? "📌 PINNED MULTI-DROP · GRAB TOP BEZEL TO MOVE · R-STICK ▲▼ SCROLL · L-STICK ▲▼ PARENT / CHILD · ◀▶ ROTUNDA"
    : "R-STICK ▲▼ SCROLL · L-STICK ▲▼ PARENT / CHILD · ◀▶ ROTUNDA · TRIGGER / GRAB OPEN OR MATERIALIZE";
  ctx.fillText(legend, GLASS_CANVAS_W * 0.5, GLASS_CANVAS_H - 20);
}

/* -------------------------------------------------------------------------- */
/*  Main Component: GlassLibraryNavigator3D                                   */
/* -------------------------------------------------------------------------- */

export interface GlassLibraryNavigator3DProps {
  visible: boolean;
  languageId?: string | undefined;
  catalog?: readonly GalleryComponentItem[] | undefined;
  libraryProvider?: RotundaLibraryProvider | undefined;
  /** Open/unconnected port domains on the active 3D diagram for #6 Compatible-Next highlighting. */
  openPortDomains?: readonly SpatialPortDomain[] | undefined;
  onGrabComponent: (
    item: GalleryComponentItem,
    worldPos: THREE.Vector3,
    e: ThreeEvent<PointerEvent> | null,
    overrideBinding?: XrPointerBinding,
    keepOpen?: boolean,
  ) => void;
  onClose: () => void;
  onCue?: ((kind: RotundaCueKind) => void) | undefined;
}

export function GlassLibraryNavigator3D({
  visible,
  languageId = "modelica",
  catalog,
  libraryProvider,
  openPortDomains,
  onGrabComponent,
  onClose,
  onCue,
}: GlassLibraryNavigator3DProps): React.ReactElement {
  const { gl, camera } = useThree();
  const xrSession = useXR((s) => s.session);
  const xrOrigin = useXR((s) => s.origin);
  const leftController = useXRInputSourceState("controller", "left");
  const rightController = useXRInputSourceState("controller", "right");
  const leftHand = useXRInputSourceState("hand", "left");
  const rightHand = useXRInputSourceState("hand", "right");

  const rootAnchorRef = useRef<THREE.Group | null>(null);
  const activePanelGroupRef = useRef<THREE.Group | null>(null);
  const parallaxGlintRef = useRef<THREE.Mesh | null>(null);

  const [headAnchor, setHeadAnchor] = useState<HeadRelativeAnchor>({ position: [0, 0, 0], yawRad: 0 });
  const prevVisibleRef = useRef(false);

  // #4 Pin-Open Multi-Drop Mode & #9 Grabbable Glass Bezel Offset
  const [pinned, setPinned] = useState(false);
  const pinnedRef = useRef(false);
  const [parkedToShoulder, setParkedToShoulder] = useState(false);
  const [bezelOffset, setBezelOffset] = useState<BezelRepositionOffset>({ dx: 0, dy: 0, dz: 0 });
  const [bezelDragging, setBezelDragging] = useState(false);
  const bezelDragRef = useRef<{
    active: boolean;
    binding: XrPointerBinding | null;
    startWorld: THREE.Vector3;
    startOffset: BezelRepositionOffset;
    dragPlane: THREE.Plane;
  }>({
    active: false,
    binding: null,
    startWorld: new THREE.Vector3(),
    startOffset: { dx: 0, dy: 0, dz: 0 },
    dragPlane: new THREE.Plane(),
  });
  const bezelPointerNdcRef = useRef(new THREE.Vector2());
  const bezelRaycasterRef = useRef(new THREE.Raycaster());
  const bezelPosScratch = useRef(new THREE.Vector3());
  const bezelQuatScratch = useRef(new THREE.Quaternion());
  const bezelHitScratch = useRef(new THREE.Vector3());
  const [bezelHovered, setBezelHovered] = useState(false);
  const [recenterHovered, setRecenterHovered] = useState(false);

  const snapHeadAnchorNow = useCallback(() => {
    setBezelOffset({ dx: 0, dy: 0, dz: 0 });
    setParkedToShoulder(false);
    if (!xrSession) {
      setHeadAnchor({ position: [0, 0, 0], yawRad: 0 });
      return;
    }
    const parent = rootAnchorRef.current?.parent;
    const headWorld = new THREE.Vector3();
    const headFwdWorld = new THREE.Vector3();
    camera.getWorldPosition(headWorld);
    camera.getWorldDirection(headFwdWorld);
    if (parent) {
      parent.updateWorldMatrix(true, false);
      const invMat = parent.matrixWorld.clone().invert();
      const invQuat = new THREE.Quaternion();
      parent.getWorldQuaternion(invQuat).invert();
      headWorld.applyMatrix4(invMat);
      headFwdWorld.applyQuaternion(invQuat);
    }
    setHeadAnchor(
      computeHeadRelativeAnchor(
        [headWorld.x, headWorld.y, headWorld.z],
        [headFwdWorld.x, headFwdWorld.y, headFwdWorld.z],
      ),
    );
  }, [xrSession, camera]);

  // #5 Voice + Quick-Search State
  const [searchOpen, setSearchOpen] = useState(false);
  const searchOpenRef = useRef(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<readonly GlassLibraryNode[]>([]);
  const [voiceListening, setVoiceListening] = useState(false);

  // #7 Starred / Favorites (localStorage persisted)
  const [starredIds, setStarredIds] = useState<ReadonlySet<string>>(() => loadStarredNodeIds());
  const starredIdsRef = useRef<ReadonlySet<string>>(starredIds);

  // Head-relative spawn snapshot on open
  useEffect(() => {
    if (visible && !prevVisibleRef.current) {
      setParkedToShoulder(false);
      if (xrSession) {
        const parent = rootAnchorRef.current?.parent;
        const headWorld = new THREE.Vector3();
        const headFwdWorld = new THREE.Vector3();
        camera.getWorldPosition(headWorld);
        camera.getWorldDirection(headFwdWorld);
        if (parent) {
          parent.updateWorldMatrix(true, false);
          const invMat = parent.matrixWorld.clone().invert();
          const invQuat = new THREE.Quaternion();
          parent.getWorldQuaternion(invQuat).invert();
          headWorld.applyMatrix4(invMat);
          headFwdWorld.applyQuaternion(invQuat);
        }
        setHeadAnchor(
          computeHeadRelativeAnchor(
            [headWorld.x, headWorld.y, headWorld.z],
            [headFwdWorld.x, headFwdWorld.y, headFwdWorld.z],
          ),
        );
      }
    } else if (!visible && prevVisibleRef.current && !xrSession) {
      setHeadAnchor({ position: [0, 0, 0], yawRad: 0 });
    }
    prevVisibleRef.current = visible;
  }, [visible, xrSession, camera]);

  const fallbackTree = useMemo(() => buildFallbackLibraryTree(catalog, languageId), [catalog, languageId]);
  const [nav, setNav] = useState<GlassLibraryNavState>(() => createInitialGlassLibraryState(fallbackTree, languageId));
  const navRef = useRef<GlassLibraryNavState>(nav);

  const [activeLangFilter, setActiveLangFilter] = useState<string>("all");
  const activeLangFilterRef = useRef("all");
  const [recentItems, setRecentItems] = useState<readonly GalleryComponentItem[]>([]);
  const recentItemsRef = useRef<readonly GalleryComponentItem[]>([]);

  const transitionRef = useRef<{ kind: ActivePanelTransitionKind; elapsedSec: number }>({
    kind: "none",
    elapsedSec: 1,
  });
  const triggerPanelTransition = useCallback((kind: ActivePanelTransitionKind) => {
    transitionRef.current = { kind, elapsedSec: 0 };
  }, []);

  // Zero-rerender 90Hz motion refs
  const liveScrollRef = useRef({ row: 0, vel: 0, lastPaintedRow: 0, lastPaintMs: 0 });
  const livePanIndexRef = useRef(0);
  const livePanVelRef = useRef(0);

  const activeParentId = nav.levels[nav.activeDepth]?.parentId;
  const activeScrollRow = nav.levels[nav.activeDepth]?.scrollRow ?? 0;
  useEffect(() => {
    liveScrollRef.current.row = activeScrollRow;
    liveScrollRef.current.vel = 0;
    liveScrollRef.current.lastPaintedRow = -999;
    livePanIndexRef.current = nav.rotundaPanIndex;
    livePanVelRef.current = 0;
  }, [nav.activeDepth, activeParentId, activeScrollRow, nav.rotundaPanIndex]);

  const childrenCacheRef = useRef<Map<string, readonly GlassLibraryNode[]>>(new Map());
  const requestedIconsRef = useRef<Set<string>>(new Set());
  const [svgTick, setSvgTick] = useState(0);

  const [hoveredZone, setHoveredZone] = useState<GlassPanelHitZone | null>(null);
  const hoveredZoneRef = useRef<GlassPanelHitZone | null>(null);
  const rawHoverTileRef = useRef<number | null>(null);
  const magnetStateRef = useRef<GlassTileMagnetState>(INITIAL_GLASS_TILE_MAGNET_STATE);
  const [lockedTileIndex, setLockedTileIndex] = useState<number | null>(null);
  const lastHoverWorldPosRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 1.36, -0.92));

  const hoverLeafStartRef = useRef<{ index: number; atMs: number } | null>(null);
  const [hologramTileIndex, setHologramTileIndex] = useState<number | null>(null);

  const [hoveredRotundaNodeId, setHoveredRotundaNodeId] = useState<string | null>(null);
  const hoveredRotundaNodeRef = useRef<{ node: GlassLibraryNode; worldPos: THREE.Vector3 } | null>(null);
  const hoveredGhostDepthRef = useRef<number | null>(null);

  // #10 Bare-hand pinch swipe & tether pull tracking refs
  const bareHandRef = useRef({
    pinched: false,
    prevPos: new THREE.Vector3(),
    tetherPulling: false,
    tetherAccumDy: 0,
  });

  const scrollImpulseRef = useRef(0);
  const panImpulseRef = useRef(0);
  const flickArmedRef = useRef(true);
  const lastFlickMsRef = useRef(0);
  const lastActionMsRef = useRef(0);

  // Hydrate root libraries from live Ansatz Editor LSP provider
  useEffect(() => {
    if (!visible) return;
    if (!libraryProvider) {
      setNav((prev) => {
        if (
          prev.levels[0]?.items.length === fallbackTree.length &&
          prev.levels[0]?.items[0]?.id === fallbackTree[0]?.id
        ) {
          return prev;
        }
        return createInitialGlassLibraryState(fallbackTree, languageId);
      });
      return;
    }

    let cancelled = false;
    libraryProvider
      .loadChildren(undefined)
      .then((rawNodes) => {
        if (cancelled) return;
        const mapped =
          rawNodes.length > 0 ? rawNodes.map((n) => treeNodeToGlassLibraryNode(n, 0, languageId)) : fallbackTree;
        childrenCacheRef.current.set("__root__", mapped);
        setNav((prev) => {
          if (prev.activeDepth === 0 && prev.levels.length === 1) {
            return createInitialGlassLibraryState(mapped, languageId);
          }
          return hydrateGlassLevelChildren(prev, "__root__", mapped);
        });
      })
      .catch(() => {
        if (!cancelled) {
          setNav((prev) =>
            prev.levels[0]?.items.length ? prev : createInitialGlassLibraryState(fallbackTree, languageId),
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [visible, libraryProvider, fallbackTree, languageId]);

  // #5 Live Quick-Search (LSP `searchClasses` or local tree fallback)
  useEffect(() => {
    if (!searchOpen || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    const q = searchQuery.trim();
    if (libraryProvider?.searchClasses) {
      void libraryProvider
        .searchClasses(q, 24)
        .then((raw) => {
          if (cancelled) return;
          setSearchResults(raw.map((r) => treeNodeToGlassLibraryNode(r, 1, languageId)));
          liveScrollRef.current.row = 0;
        })
        .catch(() => {
          if (!cancelled) {
            setSearchResults(searchLocalLibraryTree(navRef.current.levels[0]?.items ?? fallbackTree, q, 24));
          }
        });
    } else {
      setSearchResults(searchLocalLibraryTree(navRef.current.levels[0]?.items ?? fallbackTree, q, 24));
      liveScrollRef.current.row = 0;
    }
    return () => {
      cancelled = true;
    };
  }, [searchOpen, searchQuery, libraryProvider, languageId, fallbackTree]);

  // #5 Web Speech API Voice Trigger for Quest / Desktop Browser
  const startVoiceSearch = useCallback(() => {
    if (typeof window === "undefined") return;
    const SR =
      (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown })
        .SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;
    if (!SR) {
      onCue?.("click");
      return;
    }
    try {
      const rec = new SR() as {
        lang: string;
        interimResults: boolean;
        onresult: ((ev: { results?: ArrayLike<ArrayLike<{ transcript?: string }>> }) => void) | null;
        onerror: (() => void) | null;
        onend: (() => void) | null;
        start: () => void;
      };
      rec.lang = "en-US";
      rec.interimResults = false;
      setVoiceListening(true);
      rec.onresult = (ev) => {
        const transcript = ev.results?.[0]?.[0]?.transcript?.trim() ?? "";
        if (transcript) {
          setSearchQuery(transcript);
          onCue?.("glass-drill");
        }
      };
      rec.onerror = () => setVoiceListening(false);
      rec.onend = () => setVoiceListening(false);
      rec.start();
    } catch {
      setVoiceListening(false);
    }
  }, [onCue]);

  const activeLevel = nav.levels[nav.activeDepth];
  const rootLibraries = nav.levels[0]?.items;
  const availableLanguages = useMemo(
    () => extractAvailableLanguages(rootLibraries ?? [], languageId),
    [rootLibraries, languageId],
  );

  // Visible foreground items (Search results OR Root language-filtered OR active level, with starred first!)
  const visibleItems = useMemo(() => {
    if (searchOpen) return sortNodesWithStarredFirst(searchResults, starredIds);
    if (!activeLevel) return [];
    const base =
      nav.activeDepth === 0 ? filterRootLibrariesByLanguage(activeLevel.items, activeLangFilter) : activeLevel.items;
    return sortNodesWithStarredFirst(base, starredIds);
  }, [searchOpen, searchResults, activeLevel, nav.activeDepth, activeLangFilter, starredIds]);
  const visibleItemsRef = useRef<readonly GlassLibraryNode[]>(visibleItems);

  useEffect(() => {
    pinnedRef.current = pinned;
    searchOpenRef.current = searchOpen;
    starredIdsRef.current = starredIds;
    navRef.current = nav;
    activeLangFilterRef.current = activeLangFilter;
    recentItemsRef.current = recentItems;
    hoveredZoneRef.current = hoveredZone;
    visibleItemsRef.current = visibleItems;
  }, [pinned, searchOpen, starredIds, nav, activeLangFilter, recentItems, hoveredZone, visibleItems]);

  // Lazy SVG icon loading ONLY for visible foreground tiles
  useEffect(() => {
    if (!visible || !libraryProvider?.loadIcon || visibleItems.length === 0) return;
    const loadIcon = libraryProvider.loadIcon;
    let cancelled = false;
    const startIdx = Math.max(0, Math.floor(liveScrollRef.current.row) * GLASS_GRID_COLS);
    const slice = visibleItems.slice(startIdx, startIdx + GLASS_GRID_COLS * (GLASS_GRID_VISIBLE_ROWS + 2));

    for (const item of slice) {
      if (item.iconSvg || requestedIconsRef.current.has(item.fqn)) continue;
      requestedIconsRef.current.add(item.fqn);
      void loadIcon(item.fqn)
        .then((svg) => {
          if (cancelled || !svg) return;
          setNav((prev) => {
            const nextLevels = prev.levels.map((lv) => {
              let changed = false;
              const nextItems = lv.items.map((it) => {
                if (it.fqn !== item.fqn) return it;
                changed = true;
                return {
                  ...it,
                  iconSvg: svg,
                  galleryItem: it.galleryItem ? { ...it.galleryItem, schematicSvg: svg } : undefined,
                };
              });
              return changed ? { ...lv, items: nextItems } : lv;
            });
            return { ...prev, levels: nextLevels };
          });
        })
        .catch(() => undefined);
    }

    return () => {
      cancelled = true;
    };
  }, [visible, libraryProvider, activeLevel?.parentId, visibleItems]);

  const resolveAndOpenContainer = useCallback(
    (node: GlassLibraryNode, mode: "drill" | "sibling") => {
      const cached = childrenCacheRef.current.get(node.id);
      const staticChildren = node.children;
      const immediate = cached ?? staticChildren ?? [];
      const needsFetch = !cached && !staticChildren && Boolean(libraryProvider);

      setSearchOpen(false);
      setNav((prev) =>
        mode === "sibling"
          ? switchToSiblingContainer(prev, node, immediate, needsFetch)
          : drillIntoGlassNode(prev, node, immediate, needsFetch),
      );
      setHoveredZone(null);
      setLockedTileIndex(null);
      setHologramTileIndex(null);
      setHoveredRotundaNodeId(null);
      hoveredRotundaNodeRef.current = null;
      triggerPanelTransition(mode === "sibling" ? "sibling" : "drill");
      onCue?.("glass-drill");

      if (needsFetch && libraryProvider) {
        const nextDepth = mode === "sibling" ? navRef.current.activeDepth : navRef.current.activeDepth + 1;
        void libraryProvider
          .loadChildren(node.id)
          .then((raw) => {
            const mapped = raw.map((r) => treeNodeToGlassLibraryNode(r, nextDepth, node.languageId ?? languageId));
            childrenCacheRef.current.set(node.id, mapped);
            setNav((prev) => hydrateGlassLevelChildren(prev, node.id, mapped));
          })
          .catch(() => {
            setNav((prev) => hydrateGlassLevelChildren(prev, node.id, []));
          });
      }
    },
    [libraryProvider, languageId, onCue, triggerPanelTransition],
  );

  const materializeLeafItem = useCallback(
    (
      item: GalleryComponentItem,
      worldPos: THREE.Vector3,
      e: ThreeEvent<PointerEvent> | null,
      overrideBinding?: XrPointerBinding,
    ) => {
      setRecentItems((prev) => recordRecentComponent(prev, item));
      if (pinnedRef.current) {
        setParkedToShoulder(true);
      }
      if (e) pulseEventHaptic(e, 0.55, 28);
      else if (overrideBinding?.handedness) pulseXrHaptics(getSharedXrStore(), 0.55, 28, overrideBinding.handedness);
      onGrabComponent(item, worldPos, e, overrideBinding, pinnedRef.current);
    },
    [onGrabComponent],
  );

  const activateLibraryNode = useCallback(
    (
      node: GlassLibraryNode,
      source: "grid" | "rotunda",
      worldPos: THREE.Vector3,
      e: ThreeEvent<PointerEvent> | null,
      overrideBinding?: XrPointerBinding,
    ) => {
      const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (nowMs - lastActionMsRef.current < 130) return;
      lastActionMsRef.current = nowMs;

      if (isContainerLibraryNode(node)) {
        if (e) pulseEventHaptic(e, 0.24, 14);
        else if (overrideBinding?.handedness) pulseXrHaptics(getSharedXrStore(), 0.24, 14, overrideBinding.handedness);
        resolveAndOpenContainer(node, source === "rotunda" ? "sibling" : "drill");
        return;
      }

      if (node.galleryItem) {
        materializeLeafItem(node.galleryItem, worldPos, e, overrideBinding);
      }
    },
    [resolveAndOpenContainer, materializeLeafItem],
  );

  const revealNodeInHierarchy = useCallback(
    async (targetNode: GlassLibraryNode) => {
      setSearchOpen(false);
      setHoveredZone(null);
      setLockedTileIndex(null);
      setHologramTileIndex(null);

      // 1. Try instant local/fallback tree resolution first
      const roots = navRef.current.levels[0]?.items ?? fallbackTree;
      const localPath = findAncestorPathInLocalTree(roots, targetNode.fqn);
      if (localPath && localPath.length > 0) {
        let nextNav = createInitialGlassLibraryState(roots, languageId);
        for (const anc of localPath) {
          nextNav = drillIntoGlassNode(nextNav, anc, anc.children ?? [], false);
        }
        setNav(nextNav);
        triggerPanelTransition("drill");
        onCue?.("glass-drill");
        return;
      }

      // 2. Async LSP FQN prefix drill-down ("Modelica.Electrical.Analog.Basic.Resistor")
      if (!libraryProvider) return;
      const prefixes = splitFqnAncestorPrefixes(targetNode.fqn);
      if (prefixes.length === 0) return;

      let nextNav = createInitialGlassLibraryState(roots, languageId);
      let currentItems: readonly GlassLibraryNode[] = roots;
      for (let d = 0; d < prefixes.length; d++) {
        const prefix = prefixes[d];
        if (!prefix) continue;
        const segName = prefix.split(".").pop() ?? prefix;
        const match = currentItems.find(
          (it) => it.fqn === prefix || it.name === segName || it.fqn.endsWith(`.${segName}`),
        );
        if (!match) break;
        let children = childrenCacheRef.current.get(match.id);
        if (!children) {
          try {
            const raw = await libraryProvider.loadChildren(match.id);
            children = raw.map((r) => treeNodeToGlassLibraryNode(r, d + 1, match.languageId ?? languageId));
            childrenCacheRef.current.set(match.id, children);
          } catch {
            children = [];
          }
        }
        nextNav = drillIntoGlassNode(nextNav, match, children, false);
        currentItems = children;
      }
      setNav(nextNav);
      triggerPanelTransition("drill");
      onCue?.("glass-drill");
    },
    [fallbackTree, languageId, libraryProvider, triggerPanelTransition, onCue],
  );

  // Far-field WebXR Controller Grab (`squeezestart`)
  useEffect(() => {
    if (!visible || !xrSession) return;
    const onSqueezeStart = (ev: XRInputSourceEvent) => {
      const src = ev.inputSource;
      if (!src || src.hand) return;
      const handedness = src.handedness === "left" || src.handedness === "right" ? src.handedness : undefined;

      const ghostDepth = hoveredGhostDepthRef.current;
      if (ghostDepth !== null) {
        const prevDepth = navRef.current.activeDepth;
        setNav((prev) => jumpToGlassDepth(prev, ghostDepth));
        triggerPanelTransition(ghostDepth < prevDepth ? "step-up" : "step-down");
        onCue?.(ghostDepth < prevDepth ? "glass-up" : "glass-down");
        pulseXrHaptics(getSharedXrStore(), 0.24, 14, handedness);
        return;
      }

      const hitWorld = lastHoverWorldPosRef.current.clone();
      const rotHit = hoveredRotundaNodeRef.current;
      if (rotHit) hitWorld.copy(rotHit.worldPos);

      let hitDistance = 0.92;
      const ctrlObj = handedness === "left" ? leftController?.object : rightController?.object;
      if (ctrlObj) {
        const ctrlPos = new THREE.Vector3();
        ctrlObj.getWorldPosition(ctrlPos);
        hitDistance = Math.max(0.25, Math.min(3.5, ctrlPos.distanceTo(hitWorld)));
      }

      const binding: XrPointerBinding = {
        kind: "ray",
        pointerId: -1,
        handedness,
        inputSource: src,
        isHand: false,
        hitDistance,
        releaseEvent: "squeezeend",
      };

      if (rotHit) {
        activateLibraryNode(rotHit.node, "rotunda", hitWorld, null, binding);
        return;
      }

      const zone = hoveredZoneRef.current;
      if (zone?.kind === "recent" && zone.recentItem) {
        materializeLeafItem(zone.recentItem, hitWorld, null, binding);
        return;
      }
      if (zone?.kind === "reveal-tree" && zone.node) {
        pulseXrHaptics(getSharedXrStore(), 0.2, 12, handedness);
        void revealNodeInHierarchy(zone.node);
        return;
      }
      if (zone?.kind === "star" && zone.node) {
        setStarredIds((prev) => toggleStarredNodeId(prev, zone.node!.id));
        onCue?.("click");
        return;
      }
      if (zone?.kind === "up") {
        setNav((prev) => stepUpGlassHierarchy(prev));
        triggerPanelTransition("step-up");
        onCue?.("glass-up");
        return;
      }
      if (zone?.kind === "down") {
        setNav((prev) => stepDownGlassHierarchy(prev));
        triggerPanelTransition("step-down");
        onCue?.("glass-down");
        return;
      }

      const lockedIdx = magnetStateRef.current.lockedTileIndex;
      const lockedNode = lockedIdx !== null ? visibleItemsRef.current[lockedIdx] : undefined;
      if (lockedNode) {
        activateLibraryNode(lockedNode, "grid", hitWorld, null, binding);
      } else if (zone?.kind === "tile" && zone.node) {
        activateLibraryNode(zone.node, "grid", hitWorld, null, binding);
      }
    };

    const onEndBezel = (type: "selectend" | "squeezeend") => (ev: XRInputSourceEvent) => {
      const bd = bezelDragRef.current;
      if (
        bd.active &&
        bd.binding &&
        bd.binding.inputSource === ev.inputSource &&
        releaseEventForBinding(bd.binding) === type
      ) {
        bd.active = false;
        bd.binding = null;
        setBezelDragging(false);
      }
    };
    const onBezelSelectEnd = onEndBezel("selectend");
    const onBezelSqueezeEnd = onEndBezel("squeezeend");

    xrSession.addEventListener("squeezestart", onSqueezeStart);
    xrSession.addEventListener("selectend", onBezelSelectEnd);
    xrSession.addEventListener("squeezeend", onBezelSqueezeEnd);
    return () => {
      xrSession.removeEventListener("squeezestart", onSqueezeStart);
      xrSession.removeEventListener("selectend", onBezelSelectEnd);
      xrSession.removeEventListener("squeezeend", onBezelSqueezeEnd);
    };
  }, [
    visible,
    xrSession,
    leftController,
    rightController,
    activateLibraryNode,
    materializeLeafItem,
    revealNodeInHierarchy,
    triggerPanelTransition,
    onCue,
  ]);

  // Desktop keyboard & mouse wheel support (including live typing when Search is open!)
  useEffect(() => {
    if (!visible) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      scrollImpulseRef.current += Math.sign(e.deltaY) * 2.4;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (searchOpenRef.current) {
          setSearchOpen(false);
          setSearchQuery("");
        } else {
          onClose();
        }
        return;
      }
      if (searchOpenRef.current) {
        if (e.key === "Backspace") {
          e.preventDefault();
          setSearchQuery((q) => q.slice(0, -1));
          return;
        }
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          setSearchQuery((q) => q + e.key);
          return;
        }
      }
      if (e.key === "ArrowUp" || e.key.toLowerCase() === "w") {
        e.preventDefault();
        setNav((prev) => {
          const next = stepUpGlassHierarchy(prev);
          if (next !== prev) {
            triggerPanelTransition("step-up");
            onCue?.("glass-up");
          }
          return next;
        });
      } else if (e.key === "ArrowDown" || e.key.toLowerCase() === "s") {
        e.preventDefault();
        setNav((prev) => {
          const next = stepDownGlassHierarchy(prev);
          if (next !== prev) {
            triggerPanelTransition("step-down");
            onCue?.("glass-down");
          }
          return next;
        });
      } else if (e.key === "ArrowLeft" || e.key.toLowerCase() === "a") {
        e.preventDefault();
        panImpulseRef.current -= 4.2;
      } else if (e.key === "ArrowRight" || e.key.toLowerCase() === "d") {
        e.preventDefault();
        panImpulseRef.current += 4.2;
      }
    };
    const onPointerMoveGlobal = (e: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        bezelPointerNdcRef.current.set(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -(((e.clientY - rect.top) / rect.height) * 2 - 1),
        );
      }
    };
    const onPointerUpGlobal = () => {
      bezelDragRef.current.active = false;
      bezelDragRef.current.binding = null;
      setBezelDragging(false);
    };
    const el = gl.domElement;
    el.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointermove", onPointerMoveGlobal);
    window.addEventListener("pointerup", onPointerUpGlobal);
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointermove", onPointerMoveGlobal);
      window.removeEventListener("pointerup", onPointerUpGlobal);
    };
  }, [visible, gl.domElement, onClose, onCue, triggerPanelTransition]);

  const curvedPanelGeom = useMemo(
    () => createCurvedGlassGeometry(GLASS_PANEL_W, GLASS_PANEL_H, GLASS_PANEL_CURVE_DEPTH),
    [],
  );
  const skeletonTexture = useMemo(() => createGenericSkeletonTexture(), []);
  useEffect(() => {
    return () => {
      curvedPanelGeom.dispose();
      skeletonTexture?.dispose();
    };
  }, [curvedPanelGeom, skeletonTexture]);

  const activeBundle = useMemo(() => {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = GLASS_CANVAS_W;
    canvas.height = GLASS_CANVAS_H;
    const ctx = canvas.getContext("2d");
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return { canvas, ctx, texture };
  }, []);
  useEffect(() => () => activeBundle?.texture.dispose(), [activeBundle]);

  const computeCurrentLayout = useCallback(
    (scrollRow: number) =>
      buildGlassPanelLayout(
        visibleItemsRef.current,
        scrollRow,
        navRef.current.activeDepth > 0,
        navRef.current.activeDepth < navRef.current.levels.length - 1,
        navRef.current.activeDepth + 1,
        {
          languageFilters: navRef.current.activeDepth === 0 && !searchOpenRef.current ? availableLanguages : undefined,
          recentItems: recentItemsRef.current,
          searchMode: searchOpenRef.current,
        },
      ),
    [availableLanguages],
  );

  // Repaint foreground canvas on discrete state changes
  useEffect(() => {
    if (!visible || !activeBundle?.ctx) return;
    const sr = liveScrollRef.current.row;
    const layout = computeCurrentLayout(sr);
    paintActiveGlassPanel(
      activeBundle.ctx,
      nav,
      visibleItems,
      sr,
      layout,
      hoveredZone,
      lockedTileIndex,
      activeLangFilter,
      recentItems,
      starredIds,
      openPortDomains,
      pinned,
      searchOpen,
      searchQuery,
      () => setSvgTick((t) => t + 1),
    );
    activeBundle.texture.needsUpdate = true;
    liveScrollRef.current.lastPaintedRow = sr;
  }, [
    visible,
    activeBundle,
    nav,
    visibleItems,
    hoveredZone,
    lockedTileIndex,
    activeLangFilter,
    recentItems,
    starredIds,
    openPortDomains,
    pinned,
    searchOpen,
    searchQuery,
    svgTick,
    computeCurrentLayout,
  ]);

  const headTmpRef = useRef(new THREE.Vector3());
  const pinchTmpRef = useRef(new THREE.Vector3());

  // 90Hz Loop: transitions, head-parallax glint, bare-hand swipe/tether, magnetic tile lock, throttled scroll, rotunda pan
  useFrame((_, rawDelta, frame) => {
    if (!visible) return;
    const dt = Math.min(rawDelta, 0.1);
    const cur = navRef.current;
    const lv = cur.levels[cur.activeDepth];
    if (!lv) return;
    const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();

    // 0. True 6DOF Bezel Reposition Drag in useFrame (XR ray/grip OR desktop camera ray-plane)
    if (bezelDragRef.current.active) {
      const bd = bezelDragRef.current;
      let hasHit = false;
      if (bd.binding && bd.binding.kind !== "desktop") {
        const refSpace = gl.xr.getReferenceSpace();
        if (
          sampleBindingPose(bd.binding, frame, refSpace, xrOrigin, bezelPosScratch.current, bezelQuatScratch.current)
        ) {
          if (bd.binding.kind === "ray") {
            pointAlongRayPose(
              bezelPosScratch.current,
              bezelQuatScratch.current,
              Math.max(0.35, bd.binding.hitDistance),
              bezelHitScratch.current,
            );
          } else {
            bezelHitScratch.current.copy(bezelPosScratch.current);
          }
          hasHit = true;
        }
      } else {
        bezelRaycasterRef.current.setFromCamera(bezelPointerNdcRef.current, camera);
        hasHit = Boolean(bezelRaycasterRef.current.ray.intersectPlane(bd.dragPlane, bezelHitScratch.current));
      }
      if (hasHit) {
        const dx = bezelHitScratch.current.x - bd.startWorld.x;
        const dy = bezelHitScratch.current.y - bd.startWorld.y;
        const dz = bezelHitScratch.current.z - bd.startWorld.z;
        const clamped = clampBezelRepositionOffset(
          bd.startOffset.dx + dx,
          bd.startOffset.dy + dy,
          bd.startOffset.dz + dz,
        );
        if (rootAnchorRef.current) {
          rootAnchorRef.current.position.set(
            headAnchor.position[0] + clamped.dx,
            headAnchor.position[1] + clamped.dy,
            headAnchor.position[2] + clamped.dz,
          );
        }
        setBezelOffset(clamped);
      }
    }

    // 1. Active panel glide transition + #4 Pinned shoulder dock smooth slide
    const pinOff = computePinnedPanelOffset(pinnedRef.current, parkedToShoulder);
    let dy = 0;
    let dz = 0;
    let targetScale = 1;
    if (transitionRef.current.kind !== "none") {
      transitionRef.current.elapsedSec += dt;
      const off = computeActivePanelTransitionOffset(transitionRef.current.kind, transitionRef.current.elapsedSec);
      dy = off.dy;
      dz = off.dz;
      targetScale = off.scale;
      if (off.settled) transitionRef.current.kind = "none";
    }
    if (activePanelGroupRef.current) {
      const a = 1 - Math.exp(-dt * 12);
      const tx = GLASS_ACTIVE_POS[0] + pinOff.dx;
      const ty = GLASS_ACTIVE_POS[1] + dy;
      const tz = GLASS_ACTIVE_POS[2] + pinOff.dz + dz;
      activePanelGroupRef.current.position.x += (tx - activePanelGroupRef.current.position.x) * a;
      activePanelGroupRef.current.position.y += (ty - activePanelGroupRef.current.position.y) * a;
      activePanelGroupRef.current.position.z += (tz - activePanelGroupRef.current.position.z) * a;
      activePanelGroupRef.current.rotation.y += (pinOff.yawRad - activePanelGroupRef.current.rotation.y) * a;
      activePanelGroupRef.current.scale.setScalar(
        activePanelGroupRef.current.scale.x + (targetScale - activePanelGroupRef.current.scale.x) * a,
      );
    }

    // 2. #11 Head-Parallax Specular Glint across the curved glass panel
    if (parallaxGlintRef.current) {
      camera.getWorldPosition(headTmpRef.current);
      const glint = computeHeadParallaxGlintOffset(
        headTmpRef.current.x,
        headTmpRef.current.y,
        GLASS_ACTIVE_POS[0],
        GLASS_ACTIVE_POS[1],
      );
      parallaxGlintRef.current.position.set(glint.glintX * 0.22, GLASS_PANEL_H * 0.32 + glint.glintY * 0.08, 0.004);
    }

    // 3. #10 Bare-Hand Pinch-Drag Scroll, Air-Swipe Rotunda, & Vertical Tether Pull
    const refSpace = gl.xr.getReferenceSpace();
    const activeHand = rightHand?.inputSource.hand ?? leftHand?.inputSource.hand;
    if (frame && refSpace && activeHand && typeof frame.getJointPose === "function") {
      const thumb = activeHand.get("thumb-tip");
      const index = activeHand.get("index-finger-tip");
      const tp = thumb ? frame.getJointPose(thumb, refSpace) : undefined;
      const ip = index ? frame.getJointPose(index, refSpace) : undefined;
      if (tp && ip) {
        const a = tp.transform.position;
        const b = ip.transform.position;
        const dist = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
        const pinched = evaluatePinchState(dist, bareHandRef.current.pinched);
        pinchTmpRef.current.set((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5);
        if (xrOrigin) pinchTmpRef.current.applyMatrix4(xrOrigin.matrixWorld);

        if (pinched && bareHandRef.current.pinched) {
          const dxM = pinchTmpRef.current.x - bareHandRef.current.prevPos.x;
          const dyM = pinchTmpRef.current.y - bareHandRef.current.prevPos.y;
          if (bareHandRef.current.tetherPulling) {
            bareHandRef.current.tetherAccumDy += dyM;
            const step = evaluateTetherPullStep(bareHandRef.current.tetherAccumDy);
            if (step === -1 && cur.activeDepth > 0) {
              bareHandRef.current.tetherAccumDy = 0;
              setNav((prev) => stepUpGlassHierarchy(prev));
              triggerPanelTransition("step-up");
              onCue?.("glass-up");
            } else if (step === 1 && cur.activeDepth < cur.levels.length - 1) {
              bareHandRef.current.tetherAccumDy = 0;
              setNav((prev) => stepDownGlassHierarchy(prev));
              triggerPanelTransition("step-down");
              onCue?.("glass-down");
            }
          } else {
            const swipe = evaluateBareHandSwipe(dxM, dyM, dt);
            if (Math.abs(swipe.scrollDeltaRows) > 0.005) {
              scrollImpulseRef.current += swipe.scrollDeltaRows * 6;
            }
            if (Math.abs(swipe.rotundaPanImpulse) > 0.1) {
              panImpulseRef.current += swipe.rotundaPanImpulse * dt * 12;
            }
          }
        } else if (!pinched) {
          bareHandRef.current.tetherPulling = false;
          bareHandRef.current.tetherAccumDy = 0;
        }
        bareHandRef.current.pinched = pinched;
        bareHandRef.current.prevPos.copy(pinchTmpRef.current);
      }
    }

    // 4. Magnetic tile lock + 150ms hover-to-pop 3D hologram timer
    const magStep = stepGlassTileMagnetLock(magnetStateRef.current, rawHoverTileRef.current, dt);
    magnetStateRef.current = magStep.next;
    if (magStep.next.lockedTileIndex !== lockedTileIndex) {
      setLockedTileIndex(magStep.next.lockedTileIndex);
    }
    const lockedIdx = magStep.next.lockedTileIndex;
    const lockedNode = lockedIdx !== null ? visibleItemsRef.current[lockedIdx] : null;
    if (lockedIdx !== null && lockedNode && !isContainerLibraryNode(lockedNode)) {
      if (!hoverLeafStartRef.current || hoverLeafStartRef.current.index !== lockedIdx) {
        hoverLeafStartRef.current = { index: lockedIdx, atMs: nowMs };
        if (hologramTileIndex !== null) setHologramTileIndex(null);
      } else if (
        nowMs - hoverLeafStartRef.current.atMs >= GLASS_HOLOGRAM_HOVER_DELAY_MS &&
        hologramTileIndex !== lockedIdx
      ) {
        setHologramTileIndex(lockedIdx);
      }
    } else {
      hoverLeafStartRef.current = null;
      if (hologramTileIndex !== null) setHologramTileIndex(null);
    }

    // 5. Dual WebXR Thumbsticks
    const rStick = rightController?.gamepad["xr-standard-thumbstick"];
    const lStick = leftController?.gamepad["xr-standard-thumbstick"];
    const rX = applyStickDeadzone(rStick?.xAxis ?? 0, 0.16);
    const rY = applyStickDeadzone(rStick?.yAxis ?? 0, 0.16);
    const lX = applyStickDeadzone(lStick?.xAxis ?? 0, 0.16);
    const lY = applyStickDeadzone(lStick?.yAxis ?? 0, 0.16);

    const maxScroll = computeMaxScrollRow(visibleItemsRef.current.length);
    const hierarchyAxisY = Math.abs(lY) > 0.01 ? lY : maxScroll === 0 ? rY : 0;

    if (Math.abs(hierarchyAxisY) < HIERARCHY_FLICK_RESET) {
      flickArmedRef.current = true;
    } else if (
      Math.abs(hierarchyAxisY) >= HIERARCHY_FLICK_ENGAGE &&
      flickArmedRef.current &&
      nowMs - lastFlickMsRef.current >= HIERARCHY_FLICK_COOLDOWN_MS
    ) {
      flickArmedRef.current = false;
      lastFlickMsRef.current = nowMs;
      if (hierarchyAxisY < 0 && cur.activeDepth > 0) {
        setNav((prev) => stepUpGlassHierarchy(prev));
        triggerPanelTransition("step-up");
        onCue?.("glass-up");
        pulseXrHaptics(getSharedXrStore(), 0.28, 16, "left");
        return;
      }
      if (hierarchyAxisY > 0 && cur.activeDepth < cur.levels.length - 1) {
        setNav((prev) => stepDownGlassHierarchy(prev));
        triggerPanelTransition("step-down");
        onCue?.("glass-down");
        pulseXrHaptics(getSharedXrStore(), 0.28, 16, "left");
        return;
      }
    }

    // 6. Throttled zero-rerender 2D grid vertical scroll
    const scrollStickY = maxScroll > 0 ? rY : 0;
    const scrollStep = stepGlassGridScroll(
      liveScrollRef.current.row,
      liveScrollRef.current.vel,
      scrollStickY,
      scrollImpulseRef.current,
      maxScroll,
      dt,
    );
    scrollImpulseRef.current = 0;
    liveScrollRef.current.row = scrollStep.scrollRow;
    liveScrollRef.current.vel = scrollStep.scrollVel;

    if (scrollStep.crossedRow) {
      onCue?.("tick");
      pulseXrHaptics(getSharedXrStore(), 0.09, 6, "right");
    }

    if (
      activeBundle?.ctx &&
      Math.abs(liveScrollRef.current.row - liveScrollRef.current.lastPaintedRow) > 0.02 &&
      nowMs - liveScrollRef.current.lastPaintMs >= CANVAS_SCROLL_REPAINT_MIN_MS
    ) {
      const sr = liveScrollRef.current.row;
      const layout = computeCurrentLayout(sr);
      paintActiveGlassPanel(
        activeBundle.ctx,
        cur,
        visibleItemsRef.current,
        sr,
        layout,
        hoveredZoneRef.current,
        magnetStateRef.current.lockedTileIndex,
        activeLangFilterRef.current,
        recentItemsRef.current,
        starredIdsRef.current,
        openPortDomains,
        pinnedRef.current,
        searchOpenRef.current,
        searchQuery,
        () => setSvgTick((t) => t + 1),
      );
      activeBundle.texture.needsUpdate = true;
      liveScrollRef.current.lastPaintedRow = sr;
      liveScrollRef.current.lastPaintMs = nowMs;
    }

    // 7. Advance Rotunda Pan index (consumed directly by O(1) VRAM RotundaSiblingAtlasRing!)
    if (cur.activeDepth > 0) {
      const parentCount = cur.levels[cur.activeDepth - 1]?.items.length ?? 0;
      if (parentCount > 1) {
        const panStickX = Math.abs(lX) >= Math.abs(rX) ? lX : rX;
        const panStep = stepSiblingRotundaPan(
          livePanIndexRef.current,
          livePanVelRef.current,
          panStickX,
          panImpulseRef.current,
          parentCount,
          dt,
        );
        panImpulseRef.current = 0;
        livePanIndexRef.current = panStep.panIndex;
        livePanVelRef.current = panStep.panVel;

        if (panStep.crossedSlot) {
          onCue?.("rotunda-tick");
          pulseXrHaptics(getSharedXrStore(), 0.11, 7, "left");
        }
      }
    }
  });

  const stackPoses = useMemo(
    () => computeGlassStackPoses(nav.levels.length, nav.activeDepth),
    [nav.levels.length, nav.activeDepth],
  );
  const activePose = stackPoses.find((p) => p.role === "active");
  const tetherEndpoints = useMemo(() => {
    if (stackPoses.length <= 1) return null;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of stackPoses) {
      if (p.position[1] < minY) minY = p.position[1];
      if (p.position[1] > maxY) maxY = p.position[1];
    }
    return { midY: (minY + maxY) * 0.5, length: Math.max(0.1, maxY - minY), z: GLASS_ACTIVE_POS[2] - 0.22 };
  }, [stackPoses]);

  const parentLevel = nav.activeDepth > 0 ? nav.levels[nav.activeDepth - 1] : undefined;
  const hologramNode = hologramTileIndex !== null ? (visibleItems[hologramTileIndex] ?? null) : null;
  const [hologramLocalPos, setHologramLocalPos] = useState<readonly [number, number, number] | null>(null);
  useEffect(() => {
    if (hologramTileIndex === null || !hologramNode || isContainerLibraryNode(hologramNode)) {
      setHologramLocalPos(null);
      return;
    }
    const layout = computeCurrentLayout(liveScrollRef.current.row);
    setHologramLocalPos(computeTileLocalCenter3D(layout, hologramTileIndex, liveScrollRef.current.row));
  }, [hologramTileIndex, hologramNode, computeCurrentLayout]);

  const hitActivePanel = useCallback(
    (e: ThreeEvent<PointerEvent>): GlassPanelHitZone | null => {
      if (!e.uv) return null;
      return hitTestGlassPanel(
        computeCurrentLayout(liveScrollRef.current.row),
        e.uv.x * GLASS_CANVAS_W,
        (1 - e.uv.y) * GLASS_CANVAS_H,
      );
    },
    [computeCurrentLayout],
  );

  const handleActivePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!visible) return;
      e.stopPropagation();
      if (parkedToShoulder) setParkedToShoulder(false);
      const zone = hitActivePanel(e);

      if (zone?.kind === "close") {
        pulseEventHaptic(e, 0.14, 10);
        setPinned(false);
        setSearchOpen(false);
        onCue?.("click");
        onClose();
        return;
      }
      if (zone?.kind === "pin") {
        pulseEventHaptic(e, 0.16, 10);
        setPinned((p) => !p);
        setParkedToShoulder(false);
        onCue?.("click");
        return;
      }
      if (zone?.kind === "search") {
        pulseEventHaptic(e, 0.16, 10);
        setSearchOpen((s) => !s);
        onCue?.("click");
        return;
      }
      if (zone?.kind === "reveal-tree" && zone.node) {
        pulseEventHaptic(e, 0.2, 12);
        void revealNodeInHierarchy(zone.node);
        return;
      }
      if (zone?.kind === "star" && zone.node) {
        pulseEventHaptic(e, 0.14, 10);
        setStarredIds((prev) => toggleStarredNodeId(prev, zone.node!.id));
        onCue?.("click");
        return;
      }
      if (zone?.kind === "up") {
        pulseEventHaptic(e, 0.18, 12);
        setNav((prev) => stepUpGlassHierarchy(prev));
        triggerPanelTransition("step-up");
        onCue?.("glass-up");
        return;
      }
      if (zone?.kind === "down") {
        pulseEventHaptic(e, 0.18, 12);
        setNav((prev) => stepDownGlassHierarchy(prev));
        triggerPanelTransition("step-down");
        onCue?.("glass-down");
        return;
      }
      if (zone?.kind === "lang-filter" && zone.languageId) {
        pulseEventHaptic(e, 0.14, 10);
        setActiveLangFilter(zone.languageId);
        liveScrollRef.current.row = 0;
        liveScrollRef.current.vel = 0;
        onCue?.("click");
        return;
      }
      if (zone?.kind === "breadcrumb" && typeof zone.index === "number") {
        pulseEventHaptic(e, 0.16, 10);
        const startIdx = Math.max(0, navRef.current.activeDepth + 1 - Math.min(navRef.current.activeDepth + 1, 4));
        const target = startIdx + zone.index;
        const prevD = navRef.current.activeDepth;
        setNav((prev) => jumpToGlassDepth(prev, target));
        if (target !== prevD) {
          triggerPanelTransition(target < prevD ? "step-up" : "step-down");
          onCue?.(target < prevD ? "glass-up" : "glass-down");
        }
        return;
      }
      if (zone?.kind === "scroll-up") {
        pulseEventHaptic(e, 0.1, 8);
        scrollImpulseRef.current -= 4.2;
        return;
      }
      if (zone?.kind === "scroll-down") {
        pulseEventHaptic(e, 0.1, 8);
        scrollImpulseRef.current += 4.2;
        return;
      }
      if (zone?.kind === "recent" && zone.recentItem) {
        materializeLeafItem(zone.recentItem, e.point.clone(), e);
        return;
      }

      const lockedIdx = magnetStateRef.current.lockedTileIndex;
      const lockedNode = lockedIdx !== null ? visibleItemsRef.current[lockedIdx] : undefined;
      if (zone?.kind === "tile" && zone.node) {
        activateLibraryNode(zone.node, "grid", e.point.clone(), e);
      } else if (lockedNode) {
        activateLibraryNode(lockedNode, "grid", e.point.clone(), e);
      }
    },
    [
      visible,
      parkedToShoulder,
      hitActivePanel,
      revealNodeInHierarchy,
      onClose,
      onCue,
      triggerPanelTransition,
      materializeLeafItem,
      activateLibraryNode,
    ],
  );

  const handleVrKeyboardPress = useCallback(
    (key: string) => {
      if (key === "⌫") {
        setSearchQuery((q) => q.slice(0, -1));
      } else if (key === "CLR") {
        setSearchQuery("");
      } else if (key === "🎙") {
        startVoiceSearch();
      } else {
        setSearchQuery((q) => q + key.toLowerCase());
      }
      onCue?.("tick");
    },
    [startVoiceSearch, onCue],
  );

  const activeAccent = activeLevel?.accentColor || resolveDiagramLanguageTheme(languageId).accentColor;

  return (
    <group
      ref={rootAnchorRef}
      name="rotunda-glass-library-navigator"
      visible={visible}
      position={[
        headAnchor.position[0] + bezelOffset.dx,
        headAnchor.position[1] + bezelOffset.dy,
        headAnchor.position[2] + bezelOffset.dz,
      ]}
      rotation={[0, headAnchor.yawRad, 0]}
    >
      {/* Vertical Fiber-Optic Depth Tether (also pinch-draggable in bare-hand mode!) */}
      {visible && tetherEndpoints && (
        <group name="glass-depth-fiber-tether">
          <mesh
            position={[0, tetherEndpoints.midY, tetherEndpoints.z]}
            onPointerDown={(e) => {
              e.stopPropagation();
              bareHandRef.current.tetherPulling = true;
              bareHandRef.current.tetherAccumDy = 0;
            }}
          >
            <cylinderGeometry args={[0.005, 0.005, tetherEndpoints.length, 8]} />
            <meshBasicMaterial color={activeAccent} transparent opacity={0.44} depthWrite={false} toneMapped={false} />
          </mesh>
          {stackPoses.map((p) => (
            <mesh
              key={`bead:${p.levelIndex}`}
              position={[0, p.position[1], tetherEndpoints.z]}
              onPointerDown={(e) => {
                e.stopPropagation();
                const prevD = navRef.current.activeDepth;
                setNav((prev) => jumpToGlassDepth(prev, p.levelIndex));
                if (p.levelIndex !== prevD) {
                  triggerPanelTransition(p.levelIndex < prevD ? "step-up" : "step-down");
                  onCue?.(p.levelIndex < prevD ? "glass-up" : "glass-down");
                }
              }}
            >
              <sphereGeometry args={[p.role === "active" ? 0.014 : 0.01, 10, 10]} />
              <meshBasicMaterial
                color={p.role === "descendant" ? "#10b981" : p.role === "active" ? "#38bdf8" : activeAccent}
                transparent
                opacity={p.role === "active" ? 0.95 : 0.68}
                toneMapped={false}
              />
            </mesh>
          ))}
        </group>
      )}

      {/* Pushed-Out Ancestor (Above) & Remembered-Descendant (Below) Skeleton Glass Panels */}
      {visible &&
        stackPoses
          .filter((p) => p.useSkeleton)
          .map((pose) => {
            const lv = nav.levels[pose.levelIndex];
            if (!lv) return null;
            return (
              <GlassSkeletonGhostPanel
                key={`${lv.parentId}:${pose.levelIndex}`}
                pose={pose}
                title={lv.title}
                accentColor={lv.accentColor}
                skeletonTexture={skeletonTexture}
                geometry={curvedPanelGeom}
                onHoverDepth={(idx) => {
                  hoveredGhostDepthRef.current = idx;
                }}
                onSelectDepth={(idx) => {
                  const prevD = navRef.current.activeDepth;
                  setNav((prev) => jumpToGlassDepth(prev, idx));
                  triggerPanelTransition(idx < prevD ? "step-up" : "step-down");
                  onCue?.(idx < prevD ? "glass-up" : "glass-down");
                }}
              />
            );
          })}

      {/* Active Foreground Polished Translucent Curved Glass Panel */}
      {visible && activePose && (
        <group
          ref={activePanelGroupRef}
          name="glass-library-active-panel"
          position={[activePose.position[0], activePose.position[1], activePose.position[2]]}
        >
          {/* #9 True 6DOF Grabbable Top Glass Bezel Handle + Quick Re-center (⌖) Pill */}
          <mesh
            name="glass-bezel-handle"
            position={[0, GLASS_PANEL_H * 0.5 + 0.022, 0.012]}
            onPointerOver={(e) => {
              e.stopPropagation();
              setBezelHovered(true);
            }}
            onPointerOut={() => setBezelHovered(false)}
            onPointerDown={(e) => {
              e.stopPropagation();
              const binding = resolveXrPointerBinding(e);
              const planeNormal = new THREE.Vector3();
              camera.getWorldDirection(planeNormal).negate();
              bezelDragRef.current = {
                active: true,
                binding,
                startWorld: e.point.clone(),
                startOffset: { ...bezelOffset },
                dragPlane: new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, e.point.clone()),
              };
              setBezelDragging(true);
              pulseEventHaptic(e, 0.16, 10);
            }}
            onPointerUp={() => {
              bezelDragRef.current.active = false;
              bezelDragRef.current.binding = null;
              setBezelDragging(false);
            }}
          >
            <boxGeometry args={[0.32, 0.022, 0.016]} />
            <meshBasicMaterial
              color={bezelHovered || bezelDragging ? "#38bdf8" : "#94a3b8"}
              transparent
              opacity={bezelHovered || bezelDragging ? 0.92 : 0.48}
              toneMapped={false}
            />
          </mesh>

          {(Math.hypot(bezelOffset.dx, bezelOffset.dy, bezelOffset.dz) > 0.02 || parkedToShoulder) && (
            <mesh
              name="glass-recenter-btn"
              position={[0.21, GLASS_PANEL_H * 0.5 + 0.022, 0.014]}
              onPointerOver={(e) => {
                e.stopPropagation();
                setRecenterHovered(true);
              }}
              onPointerOut={() => setRecenterHovered(false)}
              onPointerDown={(e) => {
                e.stopPropagation();
                pulseEventHaptic(e, 0.16, 10);
                snapHeadAnchorNow();
                onCue?.("snap");
              }}
            >
              <circleGeometry args={[0.018, 20]} />
              <meshBasicMaterial
                color={recenterHovered ? "#22d3ee" : "#0284c7"}
                transparent
                opacity={0.9}
                toneMapped={false}
              />
            </mesh>
          )}

          {/* Physical Frosted Glass Backing */}
          <mesh position={[0, 0, -0.012]} geometry={curvedPanelGeom} raycast={NOOP_RAYCAST}>
            <meshPhysicalMaterial
              color="#0b1529"
              roughness={0.14}
              metalness={0.12}
              transmission={0.28}
              transparent
              opacity={0.52}
              clearcoat={1}
              clearcoatRoughness={0.08}
              depthWrite={false}
            />
          </mesh>

          {/* #11 Head-Parallax Specular Optical Glint Band */}
          <mesh ref={parallaxGlintRef} position={[0, GLASS_PANEL_H * 0.32, 0.004]} raycast={NOOP_RAYCAST}>
            <planeGeometry args={[0.36, 0.075]} />
            <meshBasicMaterial color="#e0f2fe" transparent opacity={0.09} depthWrite={false} toneMapped={false} />
          </mesh>

          {/* Luminous Outer Rim Glow */}
          <mesh position={[0, 0, -0.016]} raycast={NOOP_RAYCAST}>
            <planeGeometry args={[GLASS_PANEL_W + 0.024, GLASS_PANEL_H + 0.024]} />
            <meshBasicMaterial
              color={pinned ? "#22d3ee" : activeAccent}
              transparent
              opacity={0.16}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>

          {/* Interactive Frosted-Glass UI Face */}
          <mesh
            geometry={curvedPanelGeom}
            onPointerMove={(e) => {
              if (!visible) return;
              e.stopPropagation();
              lastHoverWorldPosRef.current.copy(e.point);
              const z = hitActivePanel(e);
              rawHoverTileRef.current = z?.kind === "tile" && typeof z.index === "number" ? z.index : null;
              setHoveredZone((prev) =>
                prev?.kind === z?.kind && prev?.index === z?.index && prev?.languageId === z?.languageId ? prev : z,
              );
            }}
            onPointerOut={() => {
              rawHoverTileRef.current = null;
              setHoveredZone(null);
            }}
            onPointerDown={handleActivePointerDown}
          >
            {activeBundle ? (
              <meshBasicMaterial map={activeBundle.texture} transparent toneMapped={false} />
            ) : (
              <meshBasicMaterial color="#0f172a" transparent opacity={0.85} />
            )}
          </mesh>

          {/* #2 + #8 Hover-to-Pop 3D Hologram (Hardware OR Extruded SVG Wafer) + Live Port/Param Spec Peek */}
          {hologramNode && hologramLocalPos && (
            <HoverTileHologram3D
              node={hologramNode}
              localPos={hologramLocalPos}
              loadParameters={libraryProvider?.loadParameters}
            />
          )}

          {/* #5 Compact Translucent VR Glass Keyboard below panel when Search is active */}
          <VrGlassKeyboard3D
            visible={searchOpen}
            query={searchQuery}
            voiceListening={voiceListening}
            position={[0, -GLASS_PANEL_H * 0.5 - 0.145, 0.04]}
            onKeyPress={handleVrKeyboardPress}
          />
        </group>
      )}

      {/* #1 O(1) VRAM Shared-Atlas Flanking Sibling Rotunda Ring (Option A Behind-Panel Bridge) */}
      <RotundaSiblingAtlasRing
        visible={visible && nav.activeDepth > 0 && !searchOpen}
        parentItems={parentLevel?.items ?? []}
        activeSourceNodeId={activeLevel?.sourceNode?.id ?? null}
        livePanIndexRef={livePanIndexRef}
        hoveredNodeId={hoveredRotundaNodeId}
        onHoverNode={(n, wp) => {
          setHoveredRotundaNodeId(n?.id ?? null);
          hoveredRotundaNodeRef.current = n && wp ? { node: n, worldPos: wp } : null;
        }}
        onActivateNode={(n, worldPos, e) => activateLibraryNode(n, "rotunda", worldPos, e)}
      />
    </group>
  );
}
