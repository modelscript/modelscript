// SPDX-License-Identifier: AGPL-3.0-or-later

import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useXR, useXRInputSourceState } from "@react-three/xr";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  DOMAIN_FILTERS,
  GALLERY_COMPONENTS,
  type EngineeringDomainId,
  type GalleryComponentItem,
} from "./componentGalleryCatalog.js";
import {
  computeMatrixEntranceState,
  computeStockroomSlotPose,
  INITIAL_STOCKROOM_MAGNET_STATE,
  resolveStockroomSlotItem,
  stepStockroomMagnetLock,
  stepStockroomScroll,
  STOCKROOM_CARD_H,
  STOCKROOM_CARD_W,
  STOCKROOM_CENTER_Y,
  STOCKROOM_CENTER_Z,
  STOCKROOM_COL_SPACING,
  STOCKROOM_ROW_SPACING,
  STOCKROOM_TOTAL_VISIBLE_SLOTS,
  STOCKROOM_VISIBLE_COLS,
  STOCKROOM_VISIBLE_ROWS,
  STOCKROOM_WALL_TOE_IN_RAD,
  STOCKROOM_WALL_X,
  type StockroomMagnetState,
  type StockroomScrollState,
  type StockroomSide,
} from "./matrix-stockroom-logic.js";
import { RealisticComponentMesh3D, resolveRealisticComponentKind } from "./realistic-components-3d.js";
import { categoryToSpatialDomain, DOMAIN_COLORS } from "./spatial-diagram-state.js";
import { hashStringFnv1a } from "./svg-extruder.js";
import { filterLibraryCatalog } from "./wrist-palette-logic.js";
import { applyStickDeadzone, pulseEventHaptic } from "./xr-handle.js";
import { getSharedXrStore, pulseXrHaptics, type RotundaCueKind } from "./xr-session.js";

const NOOP_RAYCAST: THREE.Object3D["raycast"] = () => {};

// Shared 6×5 sprite atlas packing all 30 simultaneous visible bays into ONE CanvasTexture (1536×1020)
const ATLAS_COLS = 6;
const ATLAS_ROWS = 5;
const ATLAS_TILE_W = 256;
const ATLAS_TILE_H = 204;
const ATLAS_W = ATLAS_COLS * ATLAS_TILE_W; // 1536
const ATLAS_H = ATLAS_ROWS * ATLAS_TILE_H; // 1020

// Overhead slim category & navigation bar texture
const HEADER_W = 1280;
const HEADER_H = 148;
const HEADER_WORLD_W = 1.44;
const HEADER_WORLD_H = 0.168;

// Receding bright placeholder component bays stretching left & right beyond the 5 interactive center columns
// (7 cols per outer end × 2 ends × 3 rows × 2 walls = 84 frosted-white placeholder cards in 2 InstancedMesh draw calls)
const PLACEHOLDER_COLS_PER_END = 7;
const TOTAL_PLACEHOLDER_BAYS = PLACEHOLDER_COLS_PER_END * 2 * STOCKROOM_VISIBLE_ROWS * 2;

const STOCKROOM_FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";

interface HeaderHitZone {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly label: string;
  readonly accent?: string | undefined;
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

/** Shared SVG -> HTMLImageElement offscreen cache so schematic icons never re-decode while scrolling. */
const stockroomSvgCache = new Map<string, HTMLImageElement | "loading" | "error">();

function requestStockroomSvgImage(svgString: string, onReady: () => void): HTMLImageElement | null {
  if (typeof window === "undefined" || typeof Image === "undefined") return null;
  const normalized = svgString.replace(/currentColor/gi, "#0f172a");
  const key = hashStringFnv1a(normalized);
  const cached = stockroomSvgCache.get(key);
  if (cached instanceof HTMLImageElement) return cached;
  if (cached === "loading" || cached === "error") return null;

  stockroomSvgCache.set(key, "loading");
  try {
    const img = new Image();
    img.onload = () => {
      stockroomSvgCache.set(key, img);
      onReady();
    };
    img.onerror = () => {
      stockroomSvgCache.set(key, "error");
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(normalized)}`;
  } catch {
    stockroomSvgCache.set(key, "error");
  }
  return null;
}

/** Creates a 2-triangle PlaneGeometry whose UVs address one specific cell `(slotIndex)` of the 6×5 atlas. */
function createAtlasSlotGeometry(slotIndex: number): THREE.PlaneGeometry {
  const geom = new THREE.PlaneGeometry(STOCKROOM_CARD_W, STOCKROOM_CARD_H, 1, 1);
  const col = slotIndex % ATLAS_COLS;
  const row = Math.floor(slotIndex / ATLAS_COLS);
  const u0 = (col * ATLAS_TILE_W + 2) / ATLAS_W;
  const u1 = ((col + 1) * ATLAS_TILE_W - 2) / ATLAS_W;
  // Canvas Y=0 is at the top, Three.js UV V=1 is at the top
  const vTop = 1 - (row * ATLAS_TILE_H + 2) / ATLAS_H;
  const vBot = 1 - ((row + 1) * ATLAS_TILE_H - 2) / ATLAS_H;

  const uv = geom.attributes["uv"];
  if (uv) {
    // PlaneGeometry 1x1 vertex order: top-left, top-right, bottom-left, bottom-right
    uv.setXY(0, u0, vTop);
    uv.setXY(1, u1, vTop);
    uv.setXY(2, u0, vBot);
    uv.setXY(3, u1, vBot);
    uv.needsUpdate = true;
  }
  return geom;
}

interface SlotDescriptor {
  readonly slotIndex: number;
  readonly side: StockroomSide;
  readonly visibleCol: number;
  readonly visibleRow: number;
}

const SLOT_DESCRIPTORS: readonly SlotDescriptor[] = (() => {
  const out: SlotDescriptor[] = [];
  let idx = 0;
  for (const side of ["left", "right"] as const) {
    for (let row = 0; row < STOCKROOM_VISIBLE_ROWS; row++) {
      for (let col = 0; col < STOCKROOM_VISIBLE_COLS; col++) {
        out.push({ slotIndex: idx++, side, visibleCol: col, visibleRow: row });
      }
    }
  }
  return out;
})();

function paintStockroomAtlas(
  ctx: CanvasRenderingContext2D,
  items: readonly GalleryComponentItem[],
  baseCol: number,
  baseRow: number,
  hoveredSlotIndex: number | null,
  onImageReady: () => void,
): void {
  ctx.clearRect(0, 0, ATLAS_W, ATLAS_H);

  for (const slot of SLOT_DESCRIPTORS) {
    const col = slot.slotIndex % ATLAS_COLS;
    const row = Math.floor(slot.slotIndex / ATLAS_COLS);
    const ox = col * ATLAS_TILE_W;
    const oy = row * ATLAS_TILE_H;
    const pad = 6;
    const x = ox + pad;
    const y = oy + pad;
    const w = ATLAS_TILE_W - pad * 2;
    const h = ATLAS_TILE_H - pad * 2;

    const item = resolveStockroomSlotItem(items, slot.side, baseCol + slot.visibleCol, baseRow + slot.visibleRow);
    const isHov = hoveredSlotIndex === slot.slotIndex;
    const accent = item ? DOMAIN_COLORS[categoryToSpatialDomain(item.category)] : "#38bdf8";

    // Dark recessed outer bevel framing each bright keycap plaque
    drawRoundedRect(ctx, x, y, w, h, 16);
    ctx.fillStyle = isHov ? "#0c4a6e" : "#0f172a";
    ctx.fill();

    // Raised bright frosted-white keycap face (matches DraftingPodium BezelKeycapButton)
    const innerPad = 5;
    const ix = x + innerPad;
    const iy = y + innerPad;
    const iw = w - innerPad * 2;
    const ih = h - innerPad * 2;
    const cardGrad = ctx.createLinearGradient(ix, iy, ix, iy + ih);
    if (isHov) {
      cardGrad.addColorStop(0, "#e0f2fe");
      cardGrad.addColorStop(1, "#bae6fd");
    } else {
      cardGrad.addColorStop(0, "#ffffff");
      cardGrad.addColorStop(1, "#f1f5f9");
    }
    drawRoundedRect(ctx, ix, iy, iw, ih, 12);
    ctx.fillStyle = cardGrad;
    ctx.fill();

    // Crisp hover glow or subtle slate rim
    ctx.lineWidth = isHov ? 4.5 : 2;
    ctx.strokeStyle = isHov ? "#38bdf8" : "#cbd5e1";
    ctx.stroke();

    // Vivid top domain color bar
    drawRoundedRect(ctx, ix + 10, iy + 8, iw - 20, 7, 3.5);
    ctx.fillStyle = accent;
    ctx.fill();

    if (!item) continue;

    const realisticKind = resolveRealisticComponentKind(`${item.id} ${item.fqn} ${item.shortName}`);

    // Schematic icon well (or clean frosted spotlight backing when a live 3D hardware model sits proud of the bay)
    const wellX = ix + 14;
    const wellY = iy + 22;
    const wellW = iw - 28;
    const wellH = 92;
    drawRoundedRect(ctx, wellX, wellY, wellW, wellH, 8);
    ctx.fillStyle = realisticKind
      ? isHov
        ? "rgba(224, 242, 254, 0.9)"
        : "rgba(226, 232, 240, 0.45)"
      : isHov
        ? "rgba(255, 255, 255, 0.85)"
        : "rgba(226, 232, 240, 0.55)";
    ctx.fill();

    if (realisticKind) {
      // Crisp emerald "3D" badge in top-right corner of the showcase well
      drawRoundedRect(ctx, wellX + wellW - 44, wellY + 6, 38, 20, 6);
      ctx.fillStyle = "#059669";
      ctx.fill();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#ffffff";
      ctx.font = `800 12px ${STOCKROOM_FONT}`;
      ctx.fillText("3D", wellX + wellW - 25, wellY + 16);
    } else {
      const img = requestStockroomSvgImage(item.schematicSvg, onImageReady);
      if (img) {
        const iconPad = 8;
        const aspect = 80 / 56;
        const drawH = Math.min(wellH - iconPad * 2, (wellW - iconPad * 2) / aspect);
        const drawW = drawH * aspect;
        ctx.drawImage(img, wellX + (wellW - drawW) * 0.5, wellY + (wellH - drawH) * 0.5, drawW, drawH);
      } else {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 3;
        ctx.strokeRect(wellX + wellW * 0.28, wellY + wellH * 0.26, wellW * 0.44, wellH * 0.48);
      }
    }

    // Bold Quest-2-legible component title
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#0f172a";
    ctx.font = `800 22px ${STOCKROOM_FONT}`;
    const shortTitle = item.shortName.length > 16 ? `${item.shortName.slice(0, 15)}…` : item.shortName;
    ctx.fillText(shortTitle, ix + iw * 0.5, iy + 136);

    // Sub-label or unmistakable hover callout
    if (isHov) {
      drawRoundedRect(ctx, ix + 24, iy + 152, iw - 48, 24, 12);
      ctx.fillStyle = "#0284c7";
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = `800 13px ${STOCKROOM_FONT}`;
      ctx.fillText("GRAB → MATERIALIZE 3D", ix + iw * 0.5, iy + 164);
    } else {
      ctx.fillStyle = "#475569";
      ctx.font = `700 14px monospace`;
      const ports = item.portsAndParams.length > 22 ? `${item.portsAndParams.slice(0, 21)}…` : item.portsAndParams;
      ctx.fillText(ports, ix + iw * 0.5, iy + 163);
    }
  }
}

function buildHeaderZones(): readonly HeaderHitZone[] {
  const zones: HeaderHitZone[] = [];
  const domains = DOMAIN_FILTERS.slice(0, 7);
  const tabY = 76;
  const tabH = 54;
  const gap = 8;
  const startX = 24;
  const domainAreaW = 860;
  const tabW = (domainAreaW - gap * (domains.length - 1)) / domains.length;

  domains.forEach((d, idx) => {
    zones.push({
      id: `domain:${d.id}`,
      x: startX + idx * (tabW + gap),
      y: tabY,
      w: tabW,
      h: tabH,
      label: d.label.length > 10 ? d.label.slice(0, 9) : d.label,
      accent: d.accent,
    });
  });

  // Fast directional scroll buttons for desktop / bare-hand users
  const navX = startX + domainAreaW + 16;
  const navW = 64;
  const navSpecs: readonly [string, string][] = [
    ["nav:left", "◀"],
    ["nav:right", "▶"],
    ["nav:up", "▲"],
    ["nav:down", "▼"],
  ];
  navSpecs.forEach(([id, label], idx) => {
    zones.push({
      id,
      x: navX + idx * (navW + 8),
      y: tabY,
      w: navW,
      h: tabH,
      label,
      accent: "#0284c7",
    });
  });

  // Prominent Close button at top-right
  zones.push({
    id: "close",
    x: HEADER_W - 148,
    y: 16,
    w: 124,
    h: 48,
    label: "✕ Close",
    accent: "#dc2626",
  });

  return zones;
}

const HEADER_ZONES = buildHeaderZones();

function paintHeaderBar(
  ctx: CanvasRenderingContext2D,
  activeDomain: EngineeringDomainId,
  totalCount: number,
  hoveredId: string | null,
  searchQuery = "",
): void {
  ctx.clearRect(0, 0, HEADER_W, HEADER_H);

  // Dark recessed CNC keybed header bar matching DraftingPodium & Side Wings
  const bg = ctx.createLinearGradient(0, 0, 0, HEADER_H);
  bg.addColorStop(0, "#1e293b");
  bg.addColorStop(1, "#0f172a");
  drawRoundedRect(ctx, 4, 4, HEADER_W - 8, HEADER_H - 8, 20);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(56, 189, 248, 0.55)";
  ctx.stroke();

  // Title + intuitive VR thumbstick hint
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#38bdf8";
  ctx.font = `800 24px ${STOCKROOM_FONT}`;
  ctx.fillText("◈ MATRIX COMPONENT STOCKROOM", 26, 40);

  ctx.fillStyle = searchQuery ? "#38bdf8" : "#cbd5e1";
  ctx.font = `700 18px monospace`;
  ctx.fillText(
    searchQuery
      ? `🔍 FILTER: "${searchQuery}" (${totalCount} MATCHES · ESC TO CLEAR)`
      : `${totalCount} PARTS · TYPE TO FILTER · STICK ◀▶▲▼ SCROLL · GRAB → 3D`,
    472,
    40,
  );

  // Domain filter keycaps + scroll arrows + Close keycap
  for (const z of HEADER_ZONES) {
    const isActive = z.id === `domain:${activeDomain}`;
    const isClose = z.id === "close";
    const isHov = hoveredId === z.id;

    drawRoundedRect(ctx, z.x, z.y, z.w, z.h, 12);
    if (isClose) {
      ctx.fillStyle = isHov ? "#ef4444" : "#b91c1c";
    } else if (isActive) {
      ctx.fillStyle = z.accent ?? "#0284c7";
    } else if (isHov) {
      ctx.fillStyle = "#bae6fd";
    } else {
      ctx.fillStyle = "#f8fafc";
    }
    ctx.fill();

    ctx.lineWidth = isHov ? 3.5 : 1.8;
    ctx.strokeStyle = isClose ? "#fca5a5" : isHov ? "#38bdf8" : isActive ? "#e0f2fe" : "#cbd5e1";
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = isClose || isActive ? "#ffffff" : "#0f172a";
    ctx.font = `800 ${z.id.startsWith("nav:") ? 24 : 18}px ${STOCKROOM_FONT}`;
    ctx.fillText(z.label, z.x + z.w * 0.5, z.y + z.h * 0.52);
  }
}

export interface MatrixStockroom3DProps {
  visible: boolean;
  catalog?: readonly GalleryComponentItem[] | undefined;
  /** Called immediately when the user grabs/taps any shelf item — closes shelves & materializes 3D block. */
  onGrabComponent: (item: GalleryComponentItem, worldPos: THREE.Vector3, e: ThreeEvent<PointerEvent>) => void;
  onClose: () => void;
  onCue?: ((kind: RotundaCueKind) => void) | undefined;
}

/**
 * Iconic "Matrix Stockroom" Infinite-Scroll 3D Component Vault.
 *
 * - Flanking brushed-steel & glowing glass shelf corridors blast forward from the distance on open.
 * - Both VR thumbsticks (and desktop wheel/arrows/buttons) fast-pan infinitely Left/Right & Up/Down
 *   across BOTH sides of the engineer simultaneously.
 * - Uses ONE shared 1536×1020 `CanvasTexture` atlas + InstancedMesh hardware shelves for locked
 *   Quest 2 72+ FPS performance.
 * - Grabbing any component immediately dismisses the shelves and materializes the 3D block.
 */
export function MatrixStockroom3D({
  visible,
  catalog,
  onGrabComponent,
  onClose,
  onCue,
}: MatrixStockroom3DProps): React.ReactElement {
  const gl = useThree((s) => s.gl);
  const isInXr = useXR((s) => s.session != null);
  const leftController = useXRInputSourceState("controller", "left");
  const rightController = useXRInputSourceState("controller", "right");

  const [activeDomain, setActiveDomain] = useState<EngineeringDomainId>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [hoveredSlotIndex, setHoveredSlotIndex] = useState<number | null>(null);
  const [hoveredHeaderId, setHoveredHeaderId] = useState<string | null>(null);
  const [imageTick, setImageTick] = useState(0);
  const [atlasBase, setAtlasBase] = useState<{ col: number; row: number }>({ col: 0, row: 0 });

  useEffect(() => {
    if (!visible) {
      setSearchQuery("");
      return;
    }
    if (typeof window === "undefined") return;
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        if (searchQuery) {
          setSearchQuery("");
        } else {
          onClose();
        }
      } else if (e.key === "Backspace") {
        setSearchQuery((q) => q.slice(0, -1));
      } else if (e.key.length === 1 && /[a-zA-Z0-9_.\- ]/.test(e.key)) {
        setSearchQuery((q) => (q.length < 24 ? q + e.key : q));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible, searchQuery, onClose]);

  const sourceCatalog = catalog && catalog.length > 0 ? catalog : GALLERY_COMPONENTS;
  const filteredItems = useMemo(() => {
    const byDomain = filterLibraryCatalog(sourceCatalog, activeDomain, "all");
    const q = searchQuery.trim().toLowerCase();
    if (!q) return byDomain;
    const matches = byDomain.filter(
      (it) =>
        it.shortName.toLowerCase().includes(q) ||
        it.fqn.toLowerCase().includes(q) ||
        (it.library ?? it.packageName ?? "").toLowerCase().includes(q) ||
        it.summary.toLowerCase().includes(q),
    );
    return matches.length > 0 ? matches : byDomain;
  }, [sourceCatalog, activeDomain, searchQuery]);
  const filteredItemsRef = useRef(filteredItems);
  useEffect(() => {
    filteredItemsRef.current = filteredItems;
  }, [filteredItems]);

  // Continuous infinite scroll state + entrance timer (mutated in useFrame for zero React churn)
  const scrollStateRef = useRef<StockroomScrollState>({ scrollCol: 0, scrollRow: 0, velCol: 0, velRow: 0 });
  const pendingImpulseRef = useRef<{ col: number; row: number }>({ col: 0, row: 0 });
  const entranceElapsedRef = useRef<number>(999);
  const wasVisibleRef = useRef<boolean>(false);
  const lastHeaderPressRef = useRef<{ id: string; atMs: number }>({ id: "", atMs: 0 });
  const lastGrabMsRef = useRef<number>(0);
  const rawHoverSlotRef = useRef<number | null>(null);
  const magnetStateRef = useRef<StockroomMagnetState>(INITIAL_STOCKROOM_MAGNET_STATE);

  // Direct refs to the 30 interactive bay groups & instanced shelf hardware
  const slotGroupRefs = useRef<(THREE.Group | null)[]>(new Array(STOCKROOM_TOTAL_VISIBLE_SLOTS).fill(null));
  const shelfLedgeInstRef = useRef<THREE.InstancedMesh | null>(null);
  const shelfLedInstRef = useRef<THREE.InstancedMesh | null>(null);
  const placeholderCardInstRef = useRef<THREE.InstancedMesh | null>(null);
  const placeholderAccentInstRef = useRef<THREE.InstancedMesh | null>(null);
  const streakLeftRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const streakRightRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const scratchDummyRef = useRef(new THREE.Object3D());

  // Pre-allocate all 30 UV-sliced slot geometries ONCE (disposed on unmount)
  const slotGeometries = useMemo(() => SLOT_DESCRIPTORS.map((s) => createAtlasSlotGeometry(s.slotIndex)), []);
  const magnetPadGeom = useMemo(() => new THREE.PlaneGeometry(STOCKROOM_CARD_W * 1.18, STOCKROOM_CARD_H * 1.18), []);
  const ledgeGeom = useMemo(() => new THREE.BoxGeometry(STOCKROOM_CARD_W + 0.06, 0.022, 0.14), []);
  const ledStripGeom = useMemo(() => new THREE.BoxGeometry(STOCKROOM_CARD_W + 0.04, 0.008, 0.012), []);
  const placeholderCardGeom = useMemo(() => new THREE.BoxGeometry(STOCKROOM_CARD_W, STOCKROOM_CARD_H, 0.014), []);
  const placeholderAccentGeom = useMemo(() => new THREE.BoxGeometry(STOCKROOM_CARD_W - 0.06, 0.022, 0.018), []);

  useEffect(() => {
    return () => {
      for (const g of slotGeometries) g.dispose();
      magnetPadGeom.dispose();
      ledgeGeom.dispose();
      ledStripGeom.dispose();
      placeholderCardGeom.dispose();
      placeholderAccentGeom.dispose();
    };
  }, [slotGeometries, magnetPadGeom, ledgeGeom, ledStripGeom, placeholderCardGeom, placeholderAccentGeom]);

  // ONE shared high-DPI CanvasTexture Atlas for all 30 visible component bays
  const atlasBundle = useMemo(() => {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = ATLAS_W;
    canvas.height = ATLAS_H;
    const ctx = canvas.getContext("2d");
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = isInXr ? 4 : Math.min(8, gl.capabilities.getMaxAnisotropy());
    return { canvas, ctx, texture };
  }, [gl, isInXr]);

  // ONE slim CanvasTexture for the overhead category/navigation bar
  const headerBundle = useMemo(() => {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = HEADER_W;
    canvas.height = HEADER_H;
    const ctx = canvas.getContext("2d");
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = isInXr ? 4 : 8;
    return { canvas, ctx, texture };
  }, [isInXr]);

  const atlasMaterial = useMemo(() => {
    if (!atlasBundle) {
      return new THREE.MeshBasicMaterial({ color: "#f8fafc", toneMapped: false });
    }
    return new THREE.MeshBasicMaterial({
      map: atlasBundle.texture,
      transparent: true,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
  }, [atlasBundle]);

  useEffect(() => {
    return () => {
      atlasMaterial.dispose();
    };
  }, [atlasMaterial]);

  useEffect(() => {
    return () => {
      atlasBundle?.texture.dispose();
      headerBundle?.texture.dispose();
    };
  }, [atlasBundle, headerBundle]);

  // Trigger dramatic Matrix Construct whiz-in entrance each time Stockroom opens
  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      entranceElapsedRef.current = 0;
      scrollStateRef.current.velCol = 0;
      scrollStateRef.current.velRow = 0;
      setHoveredSlotIndex(null);
      setHoveredHeaderId(null);
      onCue?.("stockroom-open");
      if (isInXr) {
        pulseXrHaptics(getSharedXrStore(), 0.32, 26, "left");
        pulseXrHaptics(getSharedXrStore(), 0.32, 26, "right");
      }
    }
    wasVisibleRef.current = visible;
  }, [visible, isInXr, onCue]);

  // Repaint shared 30-slot atlas ONLY when base cell, domain filter, hover, or SVG decode changes
  useEffect(() => {
    if (!visible || !atlasBundle?.ctx) return;
    paintStockroomAtlas(atlasBundle.ctx, filteredItems, atlasBase.col, atlasBase.row, hoveredSlotIndex, () => {
      setImageTick((n) => n + 1);
    });
    atlasBundle.texture.needsUpdate = true;
  }, [visible, atlasBundle, filteredItems, atlasBase.col, atlasBase.row, hoveredSlotIndex, imageTick]);

  // Repaint overhead header bar when domain/hover/count/search changes
  useEffect(() => {
    if (!visible || !headerBundle?.ctx) return;
    paintHeaderBar(headerBundle.ctx, activeDomain, filteredItems.length, hoveredHeaderId, searchQuery);
    headerBundle.texture.needsUpdate = true;
  }, [visible, headerBundle, activeDomain, filteredItems.length, hoveredHeaderId, searchQuery]);

  // Desktop keyboard (Arrow keys / Escape) & mouse wheel fast-scroll bindings while open
  useEffect(() => {
    if (!visible || typeof window === "undefined") return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight" || e.key.toLowerCase() === "d") {
        pendingImpulseRef.current.col += 2.6;
      } else if (e.key === "ArrowLeft" || e.key.toLowerCase() === "a") {
        pendingImpulseRef.current.col -= 2.6;
      } else if (e.key === "ArrowUp" || e.key.toLowerCase() === "w") {
        pendingImpulseRef.current.row += 2.2;
      } else if (e.key === "ArrowDown" || e.key.toLowerCase() === "s") {
        pendingImpulseRef.current.row -= 2.2;
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (e.shiftKey) {
        pendingImpulseRef.current.row += Math.sign(e.deltaY) * 2.2;
      } else {
        pendingImpulseRef.current.col += Math.sign(e.deltaY) * 2.6;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("wheel", onWheel);
    };
  }, [visible, onClose]);

  // Smooth 72/90Hz Matrix entrance + thumbstick/inertia infinite scrolling (zero per-frame React re-renders)
  useFrame((_state, rawDelta) => {
    if (!visible) return;
    const dt = Math.min(rawDelta, 0.05);
    entranceElapsedRef.current += dt;

    // 1. Read BOTH Quest 2 thumbsticks (whichever has stronger deflection drives fast 4-way scroll)
    const ls = leftController?.gamepad["xr-standard-thumbstick"];
    const rs = rightController?.gamepad["xr-standard-thumbstick"];
    const lx = applyStickDeadzone(ls?.xAxis ?? 0, 0.16);
    const ly = applyStickDeadzone(-(ls?.yAxis ?? 0), 0.16);
    const rx = applyStickDeadzone(rs?.xAxis ?? 0, 0.16);
    const ry = applyStickDeadzone(-(rs?.yAxis ?? 0), 0.16);

    const stickX = Math.abs(rx) >= Math.abs(lx) ? rx : lx;
    const stickY = Math.abs(ry) >= Math.abs(ly) ? ry : ly;
    const stickMag = Math.hypot(stickX, stickY);

    // 1b. Magnetic bay lock with sticky hold + scroll brake so hand jitter never drops or slips a grab
    const magnet = stepStockroomMagnetLock(magnetStateRef.current, rawHoverSlotRef.current, dt, stickMag);
    const prevLockedSlot = magnetStateRef.current.lockedSlotIndex;
    magnetStateRef.current = magnet.next;
    if (magnet.next.lockedSlotIndex !== prevLockedSlot) {
      setHoveredSlotIndex(magnet.next.lockedSlotIndex);
      if (magnet.justLocked) {
        onCue?.("hover");
        if (isInXr) {
          pulseXrHaptics(getSharedXrStore(), 0.08, 6);
        }
      }
    }

    const impCol = pendingImpulseRef.current.col;
    const impRow = pendingImpulseRef.current.row;
    pendingImpulseRef.current.col = 0;
    pendingImpulseRef.current.row = 0;

    const step = stepStockroomScroll(
      scrollStateRef.current,
      {
        stickX: stickX * magnet.scrollBrake,
        stickY: stickY * magnet.scrollBrake,
        impulseCol: impCol,
        impulseRow: impRow,
      },
      dt,
    );
    scrollStateRef.current = step.next;

    if (step.crossedBay) {
      setAtlasBase((prev) =>
        prev.col === step.baseCol && prev.row === step.baseRow ? prev : { col: step.baseCol, row: step.baseRow },
      );
      onCue?.("tick");
      if (isInXr) {
        const activeHand = Math.abs(rx) + Math.abs(ry) >= Math.abs(lx) + Math.abs(ly) ? "right" : "left";
        pulseXrHaptics(getSharedXrStore(), 0.09, 7, activeHand);
      }
    }

    const fracCol = step.next.scrollCol - step.baseCol;
    const fracRow = step.next.scrollRow - step.baseRow;
    const dummy = scratchDummyRef.current;

    // 2. Position all 30 interactive shelf bays + matching 3D chrome shelf ledges & LED trims
    let peakStreak = 0;
    const ledgeMesh = shelfLedgeInstRef.current;
    const ledMesh = shelfLedInstRef.current;
    const activeMagnetSlot = magnet.next.lockedSlotIndex;

    for (let i = 0; i < SLOT_DESCRIPTORS.length; i++) {
      const slot = SLOT_DESCRIPTORS[i]!;
      const ent = computeMatrixEntranceState(entranceElapsedRef.current, slot.visibleCol);
      if (ent.streakIntensity > peakStreak) peakStreak = ent.streakIntensity;

      const pose = computeStockroomSlotPose(
        slot.side,
        slot.visibleCol,
        slot.visibleRow,
        fracCol,
        fracRow,
        ent.zOffsetMeters,
      );

      const isMagnetized = activeMagnetSlot === slot.slotIndex;
      const inwardX = slot.side === "left" ? 1 : -1;
      const magnetPopX = isMagnetized ? inwardX * 0.044 : 0;
      const magnetScale = isMagnetized ? 1.07 : 1.0;

      const grp = slotGroupRefs.current[i];
      if (grp) {
        grp.position.set(pose.position[0] + magnetPopX, pose.position[1], pose.position[2]);
        grp.rotation.set(0, pose.yawRad, 0);
        grp.scale.setScalar(pose.edgeScale * magnetScale);
      }

      if (ledgeMesh) {
        dummy.position.set(pose.position[0], pose.position[1] - STOCKROOM_CARD_H * 0.52, pose.position[2]);
        dummy.rotation.set(0, pose.yawRad, 0);
        dummy.scale.setScalar(pose.edgeScale);
        dummy.updateMatrix();
        ledgeMesh.setMatrixAt(i, dummy.matrix);
      }
      if (ledMesh) {
        dummy.position.set(
          pose.position[0] + inwardX * 0.068,
          pose.position[1] - STOCKROOM_CARD_H * 0.52,
          pose.position[2],
        );
        dummy.rotation.set(0, pose.yawRad, 0);
        dummy.scale.setScalar(pose.edgeScale);
        dummy.updateMatrix();
        ledMesh.setMatrixAt(i, dummy.matrix);
      }
    }
    if (ledgeMesh) ledgeMesh.instanceMatrix.needsUpdate = true;
    if (ledMesh) ledMesh.instanceMatrix.needsUpdate = true;

    // 3. Animate receding bright frosted-white placeholder component plaques down both flanking aisles (-Z & +Z)
    const phCardMesh = placeholderCardInstRef.current;
    const phAccentMesh = placeholderAccentInstRef.current;
    if (phCardMesh || phAccentMesh) {
      const entGlobal = computeMatrixEntranceState(entranceElapsedRef.current, 0);
      const halfCols = (STOCKROOM_VISIBLE_COLS - 1) * 0.5;
      const halfRows = (STOCKROOM_VISIBLE_ROWS - 1) * 0.5;
      const wrapShift =
        (((step.next.scrollCol * STOCKROOM_COL_SPACING + entGlobal.zOffsetMeters * 0.65) % STOCKROOM_COL_SPACING) +
          STOCKROOM_COL_SPACING) %
        STOCKROOM_COL_SPACING;
      let idx = 0;
      for (const sideSign of [-1, 1] as const) {
        const yaw = sideSign < 0 ? Math.PI / 2 - STOCKROOM_WALL_TOE_IN_RAD : -Math.PI / 2 + STOCKROOM_WALL_TOE_IN_RAD;
        for (const endSign of [-1, 1] as const) {
          for (let k = 0; k < PLACEHOLDER_COLS_PER_END; k++) {
            const colOffset = halfCols + 1 + k;
            const zLocal = endSign * colOffset * STOCKROOM_COL_SPACING + wrapShift;
            const z = STOCKROOM_CENTER_Z + zLocal;
            const fade = Math.max(0.42, 1 - k / (PLACEHOLDER_COLS_PER_END + 3));
            const toeInX = -sideSign * Math.sin(STOCKROOM_WALL_TOE_IN_RAD) * zLocal * 0.25;
            const x = sideSign * STOCKROOM_WALL_X + toeInX;
            for (let row = 0; row < STOCKROOM_VISIBLE_ROWS; row++) {
              const y = STOCKROOM_CENTER_Y + (row - halfRows - fracRow) * STOCKROOM_ROW_SPACING;
              if (phCardMesh) {
                dummy.position.set(x, y, z);
                dummy.rotation.set(0, yaw, 0);
                dummy.scale.set(fade, fade, 1);
                dummy.updateMatrix();
                phCardMesh.setMatrixAt(idx, dummy.matrix);
              }
              if (phAccentMesh) {
                dummy.position.set(x - sideSign * 0.009, y + STOCKROOM_CARD_H * 0.38 * fade, z);
                dummy.rotation.set(0, yaw, 0);
                dummy.scale.set(fade, fade, 1);
                dummy.updateMatrix();
                phAccentMesh.setMatrixAt(idx, dummy.matrix);
              }
              idx++;
            }
          }
        }
      }
      if (phCardMesh) phCardMesh.instanceMatrix.needsUpdate = true;
      if (phAccentMesh) phAccentMesh.instanceMatrix.needsUpdate = true;
    }

    // 4. Flare floor Construct guide rail streaks during the Matrix whiz-in arrival
    const railOpacity = 0.38 + peakStreak * 0.62;
    if (streakLeftRef.current) streakLeftRef.current.opacity = railOpacity;
    if (streakRightRef.current) streakRightRef.current.opacity = railOpacity;
  });

  // Immediate grab-to-materialize on onPointerDown (honors magnetic lock so hand jitter never grabs wrong bay)
  const handleSlotPointerDown = useCallback(
    (slot: SlotDescriptor, e: ThreeEvent<PointerEvent>) => {
      if (!visible) return;
      e.stopPropagation();
      const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (nowMs - lastGrabMsRef.current < 160) return;
      lastGrabMsRef.current = nowMs;

      const lockedIdx = magnetStateRef.current.lockedSlotIndex;
      const effectiveSlot = lockedIdx !== null && SLOT_DESCRIPTORS[lockedIdx] ? SLOT_DESCRIPTORS[lockedIdx]! : slot;

      const baseCol = Math.floor(scrollStateRef.current.scrollCol);
      const baseRow = Math.floor(scrollStateRef.current.scrollRow);
      const item = resolveStockroomSlotItem(
        filteredItemsRef.current,
        effectiveSlot.side,
        baseCol + effectiveSlot.visibleCol,
        baseRow + effectiveSlot.visibleRow,
      );
      if (!item) return;

      pulseEventHaptic(e, 0.55, 28);
      onGrabComponent(item, e.point.clone(), e);
    },
    [visible, onGrabComponent],
  );

  // Overhead category filter & quick-nudge bar interactions (fires immediately on onPointerDown)
  const hitHeaderZone = useCallback((e: ThreeEvent<PointerEvent>): HeaderHitZone | null => {
    if (!e.uv) return null;
    const px = e.uv.x * HEADER_W;
    const py = (1 - e.uv.y) * HEADER_H;
    for (const z of HEADER_ZONES) {
      if (px >= z.x && px <= z.x + z.w && py >= z.y && py <= z.y + z.h) {
        return z;
      }
    }
    return null;
  }, []);

  const handleHeaderPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!visible) return;
      e.stopPropagation();
      const zone = hitHeaderZone(e);
      if (!zone) return;
      const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (lastHeaderPressRef.current.id === zone.id && nowMs - lastHeaderPressRef.current.atMs < 110) {
        return;
      }
      lastHeaderPressRef.current = { id: zone.id, atMs: nowMs };
      pulseEventHaptic(e, 0.14, 10);

      if (zone.id === "close") {
        onCue?.("click");
        onClose();
        return;
      }
      if (zone.id.startsWith("domain:")) {
        const nextDomain = zone.id.slice(7) as EngineeringDomainId;
        setActiveDomain(nextDomain);
        scrollStateRef.current = { scrollCol: 0, scrollRow: 0, velCol: 0, velRow: 0 };
        setAtlasBase({ col: 0, row: 0 });
        // Re-trigger snappy Matrix rack whiz-in when switching domain vault!
        entranceElapsedRef.current = 0;
        onCue?.("stockroom-open");
        return;
      }
      if (zone.id === "nav:left") {
        pendingImpulseRef.current.col -= 5.2;
        onCue?.("page");
      } else if (zone.id === "nav:right") {
        pendingImpulseRef.current.col += 5.2;
        onCue?.("page");
      } else if (zone.id === "nav:up") {
        pendingImpulseRef.current.row += 4.2;
        onCue?.("page");
      } else if (zone.id === "nav:down") {
        pendingImpulseRef.current.row -= 4.2;
        onCue?.("page");
      }
    },
    [visible, hitHeaderZone, onClose, onCue],
  );

  return (
    <group name="rotunda-matrix-stockroom" visible={visible}>
      {/* Twin Glowing Construct Floor Guide Rails flanking the infinite corridor */}
      <mesh position={[-STOCKROOM_WALL_X + 0.08, 0.015, -4.0]} rotation={[-Math.PI / 2, 0, 0]} raycast={NOOP_RAYCAST}>
        <planeGeometry args={[0.075, 16]} />
        <meshBasicMaterial
          ref={streakLeftRef}
          color="#38bdf8"
          transparent
          opacity={0.62}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[STOCKROOM_WALL_X - 0.08, 0.015, -4.0]} rotation={[-Math.PI / 2, 0, 0]} raycast={NOOP_RAYCAST}>
        <planeGeometry args={[0.075, 16]} />
        <meshBasicMaterial
          ref={streakRightRef}
          color="#38bdf8"
          transparent
          opacity={0.62}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Bright Frosted-White Placeholder Component Cards stretching into the distance (zero dark reflections) */}
      <instancedMesh
        ref={placeholderCardInstRef}
        args={[placeholderCardGeom, undefined, TOTAL_PLACEHOLDER_BAYS]}
        frustumCulled={false}
        raycast={NOOP_RAYCAST}
      >
        <meshBasicMaterial color="#eef4fa" toneMapped={false} />
      </instancedMesh>
      <instancedMesh
        ref={placeholderAccentInstRef}
        args={[placeholderAccentGeom, undefined, TOTAL_PLACEHOLDER_BAYS]}
        frustumCulled={false}
        raycast={NOOP_RAYCAST}
      >
        <meshBasicMaterial color="#38bdf8" toneMapped={false} />
      </instancedMesh>

      {/* 30 Physical Brushed-Silver Shelf Ledges beneath the interactive component plaques (1 draw call) */}
      <instancedMesh
        ref={shelfLedgeInstRef}
        args={[ledgeGeom, undefined, STOCKROOM_TOTAL_VISIBLE_SLOTS]}
        frustumCulled={false}
        raycast={NOOP_RAYCAST}
      >
        <meshBasicMaterial color="#cbd5e1" toneMapped={false} />
      </instancedMesh>

      {/* 30 Illuminated Cyan Shelf-Lip LED Accent Strips (1 draw call) */}
      <instancedMesh
        ref={shelfLedInstRef}
        args={[ledStripGeom, undefined, STOCKROOM_TOTAL_VISIBLE_SLOTS]}
        frustumCulled={false}
        raycast={NOOP_RAYCAST}
      >
        <meshBasicMaterial color="#38bdf8" toneMapped={false} />
      </instancedMesh>

      {/* 30 Interactive UV-Sliced Component Plaques (Left 5×3 + Right 5×3) sharing ONE Atlas Texture */}
      {SLOT_DESCRIPTORS.map((slot) => {
        const slotItem = visible
          ? resolveStockroomSlotItem(
              filteredItems,
              slot.side,
              atlasBase.col + slot.visibleCol,
              atlasBase.row + slot.visibleRow,
            )
          : null;
        const realisticKind = slotItem
          ? resolveRealisticComponentKind(`${slotItem.id} ${slotItem.fqn} ${slotItem.shortName}`)
          : null;
        return (
          <group
            key={slot.slotIndex}
            ref={(el) => {
              slotGroupRefs.current[slot.slotIndex] = el;
            }}
          >
            <mesh geometry={slotGeometries[slot.slotIndex]} material={atlasMaterial} raycast={NOOP_RAYCAST} />
            {/* Forgiving 1.18× invisible magnetic grab pad so VR laser jitter never slips off the bay */}
            <mesh
              geometry={magnetPadGeom}
              position={[0, 0, 0.008]}
              onPointerOver={(e) => {
                if (!visible) return;
                e.stopPropagation();
                rawHoverSlotRef.current = slot.slotIndex;
              }}
              onPointerOut={(e) => {
                if (!visible) return;
                e.stopPropagation();
                if (rawHoverSlotRef.current === slot.slotIndex) {
                  rawHoverSlotRef.current = null;
                }
              }}
              onPointerDown={(e) => handleSlotPointerDown(slot, e)}
            >
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            {hoveredSlotIndex === slot.slotIndex && (
              <mesh position={[0, 0, -0.004]} raycast={NOOP_RAYCAST}>
                <planeGeometry args={[STOCKROOM_CARD_W + 0.032, STOCKROOM_CARD_H + 0.032]} />
                <meshBasicMaterial color="#38bdf8" transparent opacity={0.45} depthWrite={false} toneMapped={false} />
              </mesh>
            )}
            {realisticKind && (
              <group position={[0, 0.036, 0.044]} rotation={[0.16, slot.side === "left" ? -0.24 : 0.24, 0]}>
                <RealisticComponentMesh3D
                  kind={realisticKind}
                  scale={1.08}
                  emissiveColor={hoveredSlotIndex === slot.slotIndex ? "#0369a1" : "#000000"}
                  emissiveIntensity={hoveredSlotIndex === slot.slotIndex ? 0.25 : 0}
                  disableRaycast
                />
              </group>
            )}
          </group>
        );
      })}

      {/* Overhead Slim Domain Filter & Quick-Scroll Control Bar */}
      <group position={[0, 2.04, -1.24]} rotation={[0.24, 0, 0]}>
        <mesh
          onPointerMove={(e) => {
            if (!visible) return;
            e.stopPropagation();
            const z = hitHeaderZone(e);
            setHoveredHeaderId(z?.id ?? null);
          }}
          onPointerOut={() => setHoveredHeaderId(null)}
          onPointerDown={handleHeaderPointerDown}
        >
          <planeGeometry args={[HEADER_WORLD_W, HEADER_WORLD_H]} />
          {headerBundle ? (
            <meshBasicMaterial key="header-tex" map={headerBundle.texture} transparent toneMapped={false} />
          ) : (
            <meshBasicMaterial key="header-fallback" color="#0f172a" toneMapped={false} />
          )}
        </mesh>
      </group>
    </group>
  );
}
