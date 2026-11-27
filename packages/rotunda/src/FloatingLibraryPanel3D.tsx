// SPDX-License-Identifier: AGPL-3.0-or-later

import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  DOMAIN_FILTERS,
  GALLERY_COMPONENTS,
  type EngineeringDomainId,
  type GalleryComponentItem,
} from "./componentGalleryCatalog.js";
import { categoryToSpatialDomain, DOMAIN_COLORS } from "./spatial-diagram-state.js";
import {
  buildExtrudedIconBundle,
  getSharedExtrudedIconCache,
  hashStringFnv1a,
  type ExtrudedIconBundle,
  type ExtrudedWaferStyle,
} from "./svg-extruder.js";
import {
  buildLibraryPanelLayout,
  hitTestLibraryPanel,
  LIBRARY_PANEL_CANVAS_H,
  LIBRARY_PANEL_CANVAS_W,
  type LibraryCardRect,
  type LibraryPanelLayout,
} from "./wrist-palette-logic.js";
import { tryCapturePointer } from "./xr-handle.js";
import type { RotundaCueKind } from "./xr-session.js";

const PANEL_WIDTH_M = 0.68;
const PANEL_HEIGHT_M = 0.49;
const PANEL_CURVE_DEPTH_M = 0.024;
const DEFAULT_PANEL_WORLD_POS: [number, number, number] = [-0.52, 1.38, -0.46];
const DEFAULT_PANEL_YAW = 0.38;

/** Builds a gently curved stereo-ergonomic glass panel geometry matching FloatingToolWings aesthetics. */
function createCurvedLibraryGeometry(
  width: number,
  height: number,
  curveDepth: number,
  segs = 24,
): THREE.PlaneGeometry {
  const geom = new THREE.PlaneGeometry(width, height, segs, 1);
  const pos = geom.attributes["position"];
  if (pos) {
    const halfW = width * 0.5;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const t = x / halfW;
      // Curves inward gently toward the viewer at left/right edges
      pos.setZ(i, curveDepth * (t * t));
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();
  }
  return geom;
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rad = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

/** Offscreen raster cache turning GalleryComponentItem SVG strings into crisp 2D HTMLImageElement icons. */
const sharedSvgImageCache = new Map<string, HTMLImageElement | "loading" | "error">();

function requestSvgImage(svgString: string, dark: boolean, onReady: () => void): HTMLImageElement | null {
  if (typeof window === "undefined" || typeof Image === "undefined") return null;
  const ink = dark ? "#e2e8f0" : "#0f172a";
  const normalized = svgString.replace(/currentColor/gi, ink);
  const key = `${dark ? "d" : "l"}:${hashStringFnv1a(normalized)}`;
  const cached = sharedSvgImageCache.get(key);
  if (cached instanceof HTMLImageElement) return cached;
  if (cached === "loading" || cached === "error") return null;

  sharedSvgImageCache.set(key, "loading");
  try {
    const img = new Image();
    img.onload = () => {
      sharedSvgImageCache.set(key, img);
      onReady();
    };
    img.onerror = () => {
      sharedSvgImageCache.set(key, "error");
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(normalized)}`;
  } catch {
    sharedSvgImageCache.set(key, "error");
  }
  return null;
}

function paintLibraryPanelCanvas(
  canvas: HTMLCanvasElement,
  layout: LibraryPanelLayout,
  activeDomain: EngineeringDomainId,
  activePresetId: string,
  hoveredZone: string | null,
  pullingCardId: string | null,
  dark: boolean,
  onImageReady: () => void,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Translucent studio-glass panel body
  drawRoundedRect(ctx, 8, 8, canvas.width - 16, canvas.height - 16, 26);
  ctx.fillStyle = dark ? "rgba(9, 15, 29, 0.94)" : "rgba(248, 250, 252, 0.96)";
  ctx.fill();
  ctx.strokeStyle = dark ? "rgba(56, 189, 248, 0.45)" : "rgba(15, 23, 42, 0.16)";
  ctx.lineWidth = 3.5;
  ctx.stroke();

  // Header bar
  ctx.fillStyle = dark ? "#f8fafc" : "#0f172a";
  ctx.font = "700 30px Inter, -apple-system, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("3D Component Library", 38, 44);

  ctx.fillStyle = dark ? "#38bdf8" : "#0284c7";
  ctx.font = "600 18px monospace";
  ctx.fillText(`${layout.totalFiltered} ENGINEERING MODELS · GRAB ANY 2D ICON TO MATERIALIZE IN 3D`, 364, 45);

  // Close button
  const cb = layout.closeBtnRect;
  const hovClose = hoveredZone === "close";
  drawRoundedRect(ctx, cb.x, cb.y, cb.w, cb.h, 12);
  ctx.fillStyle = hovClose ? "#ef4444" : dark ? "rgba(30, 41, 59, 0.9)" : "rgba(226, 232, 240, 0.9)";
  ctx.fill();
  ctx.fillStyle = hovClose ? "#ffffff" : dark ? "#e2e8f0" : "#0f172a";
  ctx.font = "700 28px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("✕", cb.x + cb.w * 0.5, cb.y + cb.h * 0.52);

  // Domain tabs
  for (const tab of layout.domainTabs) {
    const isActive = tab.domain === activeDomain;
    const isHov = hoveredZone === `domain:${tab.domain}`;
    drawRoundedRect(ctx, tab.x, tab.y, tab.w, tab.h, 12);
    ctx.fillStyle = isActive
      ? tab.accent
      : isHov
        ? dark
          ? "rgba(30, 58, 95, 0.85)"
          : "rgba(224, 242, 254, 0.95)"
        : dark
          ? "rgba(30, 41, 59, 0.72)"
          : "rgba(226, 232, 240, 0.65)";
    ctx.fill();
    ctx.fillStyle = isActive ? "#ffffff" : dark ? "#e2e8f0" : "#1e293b";
    ctx.font = "700 18px Inter, -apple-system, sans-serif";
    ctx.textAlign = "center";
    const shortLabel = tab.label.length > 13 ? `${tab.label.slice(0, 12)}…` : tab.label;
    ctx.fillText(shortLabel, tab.x + tab.w * 0.5, tab.y + tab.h * 0.52);
  }

  // Quick-preset chips
  for (const chip of layout.presetChips) {
    const isActive = chip.preset.id === activePresetId;
    const isHov = hoveredZone === `preset:${chip.preset.id}`;
    drawRoundedRect(ctx, chip.x, chip.y, chip.w, chip.h, 21);
    ctx.fillStyle = isActive
      ? dark
        ? "rgba(14, 165, 233, 0.28)"
        : "rgba(2, 132, 199, 0.14)"
      : isHov
        ? dark
          ? "rgba(51, 65, 85, 0.75)"
          : "rgba(226, 232, 240, 0.9)"
        : "transparent";
    ctx.fill();
    ctx.strokeStyle = isActive ? "#38bdf8" : dark ? "rgba(148, 163, 184, 0.3)" : "rgba(15, 23, 42, 0.15)";
    ctx.lineWidth = isActive ? 2.5 : 1.5;
    ctx.stroke();

    ctx.fillStyle = isActive ? (dark ? "#7dd3fc" : "#0369a1") : dark ? "#cbd5e1" : "#334155";
    ctx.font = "600 17px Inter, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(chip.preset.label, chip.x + chip.w * 0.5, chip.y + chip.h * 0.52);
  }

  // 4×3 Component 2D SVG Icon Cards
  for (const card of layout.cards) {
    const item = card.item;
    const isPulling = pullingCardId === item.id;
    const isHov = hoveredZone === `card:${item.id}`;
    const accent = DOMAIN_COLORS[categoryToSpatialDomain(item.category)];

    drawRoundedRect(ctx, card.x, card.y, card.w, card.h, 16);
    if (isPulling) {
      // Blueprint ghost outline left behind while user pulls the 2D icon into 3D space
      ctx.save();
      ctx.setLineDash([10, 8]);
      ctx.fillStyle = "rgba(34, 211, 238, 0.08)";
      ctx.fill();
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = "#22d3ee";
      ctx.font = "700 18px monospace";
      ctx.textAlign = "center";
      ctx.fillText("MATERIALIZING IN 3D…", card.x + card.w * 0.5, card.y + card.h * 0.5);
      continue;
    }

    ctx.fillStyle = isHov
      ? dark
        ? "rgba(24, 44, 76, 0.96)"
        : "rgba(240, 249, 255, 0.98)"
      : dark
        ? "rgba(17, 28, 48, 0.9)"
        : "#ffffff";
    ctx.fill();
    ctx.strokeStyle = isHov ? "#22d3ee" : dark ? "rgba(148, 163, 184, 0.28)" : "rgba(15, 23, 42, 0.14)";
    ctx.lineWidth = isHov ? 3.5 : 1.8;
    ctx.stroke();

    // Top domain color bar
    ctx.fillStyle = accent;
    drawRoundedRect(ctx, card.x + 12, card.y + 10, card.w - 24, 5, 3);
    ctx.fill();

    // Crisp 2D SVG schematic icon inside well
    const iconBoxX = card.x + 28;
    const iconBoxY = card.y + 24;
    const iconBoxW = card.w - 56;
    const iconBoxH = 118;
    drawRoundedRect(ctx, iconBoxX, iconBoxY, iconBoxW, iconBoxH, 10);
    ctx.fillStyle = dark ? "rgba(15, 23, 42, 0.65)" : "rgba(241, 245, 249, 0.78)";
    ctx.fill();

    const img = requestSvgImage(item.schematicSvg, dark, onImageReady);
    if (img) {
      const pad = 12;
      const aspect = 80 / 56;
      const drawH = Math.min(iconBoxH - pad * 2, (iconBoxW - pad * 2) / aspect);
      const drawW = drawH * aspect;
      ctx.drawImage(img, iconBoxX + (iconBoxW - drawW) * 0.5, iconBoxY + (iconBoxH - drawH) * 0.5, drawW, drawH);
    } else {
      // Crisp vector placeholder glyph while image decodes or in headless JSDOM
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3;
      ctx.strokeRect(iconBoxX + iconBoxW * 0.25, iconBoxY + iconBoxH * 0.28, iconBoxW * 0.5, iconBoxH * 0.44);
    }

    // Component shortName + ports summary
    ctx.textAlign = "left";
    ctx.fillStyle = dark ? "#f8fafc" : "#0f172a";
    ctx.font = "700 22px Inter, -apple-system, sans-serif";
    const nameTxt = item.shortName.length > 18 ? `${item.shortName.slice(0, 17)}…` : item.shortName;
    ctx.fillText(nameTxt, card.x + 18, card.y + 168);

    ctx.fillStyle = dark ? "#94a3b8" : "#475569";
    ctx.font = "600 15px monospace";
    const portTxt = item.portsAndParams.length > 26 ? `${item.portsAndParams.slice(0, 25)}…` : item.portsAndParams;
    ctx.fillText(portTxt, card.x + 18, card.y + 198);

    if (isHov) {
      ctx.textAlign = "right";
      ctx.fillStyle = "#22d3ee";
      ctx.font = "700 14px monospace";
      ctx.fillText("PULL → 3D", card.x + card.w - 16, card.y + 168);
    }
  }

  // Footer pagination bar
  const drawPageBtn = (
    rect: { x: number; y: number; w: number; h: number },
    label: string,
    enabled: boolean,
    id: string,
  ) => {
    const isHov = hoveredZone === id && enabled;
    drawRoundedRect(ctx, rect.x, rect.y, rect.w, rect.h, 12);
    ctx.fillStyle = !enabled
      ? dark
        ? "rgba(30, 41, 59, 0.35)"
        : "rgba(226, 232, 240, 0.45)"
      : isHov
        ? "#0284c7"
        : dark
          ? "rgba(30, 41, 59, 0.9)"
          : "rgba(226, 232, 240, 0.9)";
    ctx.fill();
    ctx.fillStyle = !enabled ? "#64748b" : isHov ? "#ffffff" : dark ? "#f8fafc" : "#0f172a";
    ctx.font = "700 20px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, rect.x + rect.w * 0.5, rect.y + rect.h * 0.52);
  };

  drawPageBtn(layout.prevBtnRect, "‹ Previous", layout.page > 0, "prev");
  drawPageBtn(layout.nextBtnRect, "Next ›", layout.page < layout.totalPages - 1, "next");

  ctx.textAlign = "center";
  ctx.fillStyle = dark ? "#94a3b8" : "#475569";
  ctx.font = "600 20px monospace";
  ctx.fillText(
    `PAGE ${layout.page + 1} / ${layout.totalPages} · ${DOMAIN_FILTERS.find((d) => d.id === activeDomain)?.label.toUpperCase() ?? "ALL"}`,
    canvas.width * 0.5,
    canvas.height - 50,
  );
}

/** Live 3D extruded morph preview while pulling a 2D card off the Floating Library Panel. */
export interface MaterializingPreviewProps {
  item: GalleryComponentItem;
  worldPosRef: React.RefObject<THREE.Vector3>;
  worldQuatRef: React.RefObject<THREE.Quaternion>;
  morphProgressRef: React.RefObject<number>;
  isCancelReturnRef: React.RefObject<boolean>;
  waferStyle: ExtrudedWaferStyle;
  dark: boolean;
}

export function MaterializingComponentPreview({
  item,
  worldPosRef,
  worldQuatRef,
  morphProgressRef,
  isCancelReturnRef,
  waferStyle,
  dark,
}: MaterializingPreviewProps): React.ReactElement {
  const rootRef = useRef<THREE.Group | null>(null);
  const auraMatRef = useRef<THREE.MeshBasicMaterial | null>(null);

  const accentColor = DOMAIN_COLORS[categoryToSpatialDomain(item.category)];
  const cacheKey = useMemo(
    () => `mat_${hashStringFnv1a(`${item.id}|${item.schematicSvg}|${waferStyle}|${dark ? "d" : "l"}`)}`,
    [item.id, item.schematicSvg, waferStyle, dark],
  );

  const bundle: ExtrudedIconBundle = useMemo(
    () =>
      getSharedExtrudedIconCache().acquire(cacheKey, () =>
        buildExtrudedIconBundle(
          { kind: "svg", svg: item.schematicSvg, width: 80, height: 56 },
          { waferStyle, dark, accentColor, targetSpanMeters: 0.148 },
        ),
      ),
    [cacheKey, item.schematicSvg, waferStyle, dark, accentColor],
  );

  useEffect(() => {
    return () => {
      getSharedExtrudedIconCache().release(cacheKey);
    };
  }, [cacheKey]);

  useFrame(() => {
    const g = rootRef.current;
    if (!g) return;
    if (worldPosRef.current) g.position.copy(worldPosRef.current);
    if (worldQuatRef.current) g.quaternion.copy(worldQuatRef.current);

    const progress = morphProgressRef.current ?? 0;
    const isCancel = Boolean(isCancelReturnRef.current);
    // Smoothly extrude Z from flat 2D card (0.04) -> full 3D extruded thickness (1.0)
    const xyScale = isCancel ? 0.65 + progress * 0.35 : 0.84 + progress * 0.16;
    const zScale = Math.max(0.04, progress);
    g.scale.set(xyScale, xyScale, zScale);

    if (auraMatRef.current) {
      // Peak holographic materialize scanline glow midway through morph, softening once solid
      const shimmer = Math.sin(progress * Math.PI);
      auraMatRef.current.opacity = isCancel ? 0.45 : 0.15 + shimmer * 0.65;
      auraMatRef.current.color.set(isCancel ? "#f59e0b" : progress >= 0.99 ? "#10b981" : "#22d3ee");
    }
  });

  return (
    <group ref={rootRef} name="spatial-materializing-preview">
      {bundle.waferGeometry && (
        <mesh geometry={bundle.waferGeometry}>
          <meshPhysicalMaterial
            color={dark ? "#111c30" : "#f8fafc"}
            roughness={0.3}
            metalness={0.18}
            transparent
            opacity={0.9}
          />
        </mesh>
      )}
      {bundle.rimGeometry && (
        <mesh geometry={bundle.rimGeometry}>
          <meshBasicMaterial ref={auraMatRef} color="#22d3ee" transparent opacity={0.65} toneMapped={false} />
        </mesh>
      )}
      {bundle.opaqueGeometry && (
        <mesh geometry={bundle.opaqueGeometry}>
          <meshStandardMaterial vertexColors roughness={0.3} metalness={0.22} />
        </mesh>
      )}
      {bundle.translucentGeometry && (
        <mesh geometry={bundle.translucentGeometry}>
          <meshStandardMaterial vertexColors transparent opacity={0.35} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

export interface FloatingLibraryPanel3DProps {
  visible: boolean;
  catalog?: readonly GalleryComponentItem[] | undefined;
  dark: boolean;
  pullingCardId: string | null;
  onClose: () => void;
  /** Fired when the user grabs a 2D icon card on the panel to pull-and-materialize it into 3D space. */
  onStartPullCatalogCard: (
    item: GalleryComponentItem,
    cardWorldPos: THREE.Vector3,
    panelWorldNormal: THREE.Vector3,
    panelWorldQuat: THREE.Quaternion,
    e: ThreeEvent<PointerEvent>,
  ) => void;
  onPanelDragLockChange?: ((locked: boolean) => void) | undefined;
  onCue?: ((kind: RotundaCueKind) => void) | undefined;
}

/**
 * World-Locked Floating Curved 2D Component Library Panel summoned from the Wrist Tool.
 *
 * Renders the unified ModelScript component catalog as crisp 2D schematic SVG cards.
 * Grabbing any card and pulling it forward off the panel plane smoothly morphs and
 * materializes it into a solid 3D extruded component right in the user's hand.
 */
export function FloatingLibraryPanel3D({
  visible,
  catalog,
  dark,
  pullingCardId,
  onClose,
  onStartPullCatalogCard,
  onPanelDragLockChange,
  onCue,
}: FloatingLibraryPanel3DProps): React.ReactElement | null {
  const effectiveCatalog = catalog && catalog.length > 0 ? catalog : GALLERY_COMPONENTS;
  const [activeDomain, setActiveDomain] = useState<EngineeringDomainId>("all");
  const [activePresetId, setActivePresetId] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [hoveredZone, setHoveredZone] = useState<string | null>(null);
  const [imageTick, setImageTick] = useState(0);

  const panelGroupRef = useRef<THREE.Group | null>(null);
  const openAnimRef = useRef(0);
  const [panelPos, setPanelPos] = useState<[number, number, number]>(DEFAULT_PANEL_WORLD_POS);
  const [panelYaw, setPanelYaw] = useState(DEFAULT_PANEL_YAW);
  const isDraggingPanelRef = useRef(false);
  const panelDragPlane = useRef(new THREE.Plane());
  const panelDragOffset = useRef(new THREE.Vector3());
  const rayHitTmp = useRef(new THREE.Vector3());
  const normalTmp = useRef(new THREE.Vector3());
  const quatTmp = useRef(new THREE.Quaternion());
  const { camera } = useThree();

  const layout = useMemo(
    () => buildLibraryPanelLayout(effectiveCatalog, activeDomain, activePresetId, page),
    [effectiveCatalog, activeDomain, activePresetId, page],
  );

  const panelGeom = useMemo(
    () => createCurvedLibraryGeometry(PANEL_WIDTH_M, PANEL_HEIGHT_M, PANEL_CURVE_DEPTH_M, 24),
    [],
  );
  useEffect(() => () => panelGeom.dispose(), [panelGeom]);

  const { canvas, texture } = useMemo(() => {
    if (typeof document === "undefined") return { canvas: null, texture: null };
    const c = document.createElement("canvas");
    c.width = LIBRARY_PANEL_CANVAS_W;
    c.height = LIBRARY_PANEL_CANVAS_H;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return { canvas: c, texture: t };
  }, []);

  useEffect(() => {
    return () => {
      texture?.dispose();
    };
  }, [texture]);

  const bumpImageTick = useCallback(() => {
    setImageTick((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!canvas || !texture || !visible) return;
    paintLibraryPanelCanvas(
      canvas,
      layout,
      activeDomain,
      activePresetId,
      hoveredZone,
      pullingCardId,
      dark,
      bumpImageTick,
    );
    texture.needsUpdate = true;
  }, [
    canvas,
    texture,
    visible,
    layout,
    activeDomain,
    activePresetId,
    hoveredZone,
    pullingCardId,
    dark,
    imageTick,
    bumpImageTick,
  ]);

  // Reset unfold animation when opened
  useEffect(() => {
    if (visible) {
      openAnimRef.current = 0;
    }
  }, [visible]);

  useFrame((_, rawDelta) => {
    const g = panelGroupRef.current;
    if (!g || !visible) return;
    const delta = Math.min(rawDelta, 0.1);
    openAnimRef.current = Math.min(1, openAnimRef.current + delta / 0.18);
    const t = openAnimRef.current;
    const ease = 1 - Math.pow(1 - t, 3);
    g.scale.setScalar(0.84 + ease * 0.16);
  });

  // Global mouse/pointer listener for top grab-bar panel repositioning
  useEffect(() => {
    if (!visible || typeof window === "undefined") return;
    const onPointerUp = () => {
      if (isDraggingPanelRef.current) {
        isDraggingPanelRef.current = false;
        onPanelDragLockChange?.(false);
        onCue?.("release");
      }
    };
    window.addEventListener("pointerup", onPointerUp);
    return () => window.removeEventListener("pointerup", onPointerUp);
  }, [visible, onPanelDragLockChange, onCue]);

  if (!visible || !texture) return null;

  const uvToHit = (uv: THREE.Vector2 | undefined) => {
    if (!uv) return null;
    const px = uv.x * LIBRARY_PANEL_CANVAS_W;
    const py = (1 - uv.y) * LIBRARY_PANEL_CANVAS_H;
    return hitTestLibraryPanel(layout, px, py);
  };

  const zoneIdFromHit = (hit: ReturnType<typeof hitTestLibraryPanel>): string | null => {
    if (!hit) return null;
    switch (hit.kind) {
      case "close":
      case "prev":
      case "next":
        return hit.kind;
      case "domain":
        return `domain:${hit.domain}`;
      case "preset":
        return `preset:${hit.presetId}`;
      case "card":
        return `card:${hit.card.item.id}`;
    }
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (isDraggingPanelRef.current) {
      if (e.ray.intersectPlane(panelDragPlane.current, rayHitTmp.current)) {
        const nextPos = rayHitTmp.current.add(panelDragOffset.current);
        setPanelPos([nextPos.x, nextPos.y, nextPos.z]);
        // Gently orient panel toward viewer when parked
        const yaw = Math.atan2(camera.position.x - nextPos.x, camera.position.z - nextPos.z);
        setPanelYaw(yaw * 0.6);
      }
      return;
    }
    const hit = uvToHit(e.uv);
    setHoveredZone(zoneIdFromHit(hit));
  };

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const hit = uvToHit(e.uv);
    if (!hit) return;

    if (hit.kind === "close") {
      onClose();
      onCue?.("click");
      return;
    }
    if (hit.kind === "prev") {
      setPage((p) => Math.max(0, p - 1));
      onCue?.("page");
      return;
    }
    if (hit.kind === "next") {
      setPage((p) => Math.min(layout.totalPages - 1, p + 1));
      onCue?.("page");
      return;
    }
    if (hit.kind === "domain") {
      setActiveDomain(hit.domain);
      setPage(0);
      onCue?.("tick");
      return;
    }
    if (hit.kind === "preset") {
      setActivePresetId(hit.presetId);
      setPage(0);
      onCue?.("tick");
      return;
    }
    if (hit.kind === "card") {
      const card: LibraryCardRect = hit.card;
      const g = panelGroupRef.current;
      if (g) {
        g.updateWorldMatrix(true, false);
        g.getWorldQuaternion(quatTmp.current);
        normalTmp.current.set(0, 0, 1).applyQuaternion(quatTmp.current).normalize();
      } else {
        quatTmp.current.identity();
        normalTmp.current.set(0, 0, 1);
      }
      onStartPullCatalogCard(card.item, e.point.clone(), normalTmp.current.clone(), quatTmp.current.clone(), e);
    }
  };

  return (
    <group ref={panelGroupRef} name="spatial-floating-library-panel" position={panelPos} rotation={[0, panelYaw, 0]}>
      {/* Top Frosted Anodized Grab-Bar for Free Room Positioning */}
      <mesh
        position={[0, PANEL_HEIGHT_M * 0.5 + 0.022, 0.008]}
        onPointerDown={(e) => {
          e.stopPropagation();
          isDraggingPanelRef.current = true;
          onPanelDragLockChange?.(true);
          camera.getWorldDirection(normalTmp.current).negate();
          panelDragPlane.current.setFromNormalAndCoplanarPoint(
            normalTmp.current,
            new THREE.Vector3(panelPos[0], panelPos[1], panelPos[2]),
          );
          if (e.ray.intersectPlane(panelDragPlane.current, rayHitTmp.current)) {
            panelDragOffset.current.set(panelPos[0], panelPos[1], panelPos[2]).sub(rayHitTmp.current);
          } else {
            panelDragOffset.current.set(0, 0, 0);
          }
          tryCapturePointer(e);
          onCue?.("grab");
        }}
        onPointerUp={(e) => {
          if (!isDraggingPanelRef.current) return;
          e.stopPropagation();
          isDraggingPanelRef.current = false;
          onPanelDragLockChange?.(false);
          onCue?.("release");
        }}
        onPointerMove={handlePointerMove}
      >
        <capsuleGeometry args={[0.0075, 0.24, 6, 12]} />
        <meshStandardMaterial
          color={dark ? "#38bdf8" : "#0284c7"}
          emissive="#0284c7"
          emissiveIntensity={0.35}
          metalness={0.55}
          roughness={0.25}
        />
      </mesh>

      {/* Curved Glass Backing Frame */}
      <mesh geometry={panelGeom} position={[0, 0, -0.005]}>
        <meshStandardMaterial
          color={dark ? "#0f172a" : "#cbd5e1"}
          metalness={0.45}
          roughness={0.35}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Interactive High-DPI Curved 2D Component Icon Grid */}
      <mesh
        geometry={panelGeom}
        onPointerMove={handlePointerMove}
        onPointerOut={(e) => {
          e.stopPropagation();
          setHoveredZone(null);
        }}
        onPointerDown={handlePointerDown}
      >
        <meshBasicMaterial map={texture} transparent toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
