// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AnchorSide, CanvasTile, TileAnchorSpec, TileLodTier, WorldPoint } from "../schema/canvas-document.js";

export interface ResolvedAnchorPoint {
  world: WorldPoint;
  side: AnchorSide;
  /** Outward unit normal vector for smooth bezier / orthogonal routing. */
  normal: WorldPoint;
  /** True when an internal sub-element (e.g. scrolled table row or off-frustum 3D pin) was clamped to the tile border. */
  clamped: boolean;
}

export interface TableProjectionContext {
  headerHeightPx?: number | undefined;
  rowHeightPx?: number | undefined;
  scrollTopPx?: number | undefined;
}

/** Column-major 4x4 View-Projection matrix for projecting 3D STEP/CAD feature pins to 2D NDC. */
export type Mat4 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface Cad3DProjectionContext {
  viewProjectionMatrix: Mat4;
}

const HEADER_HEIGHT_DEFAULT = 36;

function sideNormal(side: AnchorSide): WorldPoint {
  switch (side) {
    case "left":
      return { x: -1, y: 0 };
    case "right":
      return { x: 1, y: 0 };
    case "top":
      return { x: 0, y: -1 };
    case "bottom":
      return { x: 0, y: 1 };
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function inferDefaultSide(anchor: TileAnchorSpec | undefined, isSource: boolean): AnchorSide {
  if (anchor?.side) return anchor.side;
  if (anchor?.kind === "fmi-input") return "left";
  if (anchor?.kind === "fmi-output") return "right";
  return isSource ? "right" : "left";
}

/**
 * Projects a 3D model-space point through a column-major 4x4 View-Projection matrix
 * into normalized device coordinates (NDC in [-1, 1]).
 */
export function project3DToNdc(
  pos: readonly [number, number, number],
  m: Mat4,
): { x: number; y: number; z: number } | null {
  const [px, py, pz] = pos;
  const x = m[0] * px + m[4] * py + m[8] * pz + m[12];
  const y = m[1] * px + m[5] * py + m[9] * pz + m[13];
  const z = m[2] * px + m[6] * py + m[10] * pz + m[14];
  const w = m[3] * px + m[7] * py + m[11] * pz + m[15];
  if (Math.abs(w) < 1e-9 || w < 0) {
    return null; // Behind camera
  }
  return { x: x / w, y: y / w, z: z / w };
}

/**
 * Resolves a sub-tile anchor (`motor.u`, `REQ-042`, `flange.mounting_holes`, etc.)
 * into exact world-space coordinates for live visual thread routing.
 */
export function resolveAnchorWorldPoint(
  tile: CanvasTile,
  anchorPath: string,
  options: {
    isSource: boolean;
    lod?: TileLodTier | undefined;
    tableCtx?: TableProjectionContext | undefined;
    cad3DCtx?: Cad3DProjectionContext | undefined;
  },
): ResolvedAnchorPoint {
  const anchor = tile.pinnedAnchors?.find((a) => a.path === anchorPath);
  const { x, y, width, height } = tile.bounds;
  const side = inferDefaultSide(anchor, options.isSource);
  const offset = clamp01(anchor?.sideOffset ?? 0.5);

  // At macro/thumbnail LOD, collapse all threads cleanly to the tile perimeter
  const isDetailedLod = options.lod === undefined || options.lod === "interactive" || options.lod === "focus";

  // 1. 3D CAD feature pin projection (STEP / USD / URDF)
  if (isDetailedLod && tile.archetype === "cad3d" && anchor?.model3DPosition && options.cad3DCtx) {
    const ndc = project3DToNdc(anchor.model3DPosition, options.cad3DCtx.viewProjectionMatrix);
    if (ndc && ndc.x >= -1 && ndc.x <= 1 && ndc.y >= -1 && ndc.y <= 1) {
      const contentTop = y + HEADER_HEIGHT_DEFAULT;
      const contentH = Math.max(1, height - HEADER_HEIGHT_DEFAULT);
      const wx = x + (ndc.x + 1) * 0.5 * width;
      const wy = contentTop + (1 - ndc.y) * 0.5 * contentH;
      return {
        world: { x: wx, y: wy },
        side,
        normal: sideNormal(side),
        clamped: false,
      };
    }
  }

  // 2. Virtualized table / ReqIF row anchor with scroll clamping
  if (isDetailedLod && tile.archetype === "table" && anchor?.rowIndex !== undefined) {
    const headerH = options.tableCtx?.headerHeightPx ?? HEADER_HEIGHT_DEFAULT + 28;
    const rowH = options.tableCtx?.rowHeightPx ?? 32;
    const scrollTop = options.tableCtx?.scrollTopPx ?? 0;
    const rawLocalY = headerH + (anchor.rowIndex + 0.5) * rowH - scrollTop;
    const minY = y + headerH;
    const maxY = y + height - 8;
    const worldY = y + rawLocalY;
    const clampedY = Math.min(maxY, Math.max(minY, worldY));
    const clamped = clampedY !== worldY;
    const worldX = side === "right" ? x + width : x;
    return {
      world: { x: worldX, y: clampedY },
      side: side === "right" ? "right" : "left",
      normal: sideNormal(side === "right" ? "right" : "left"),
      clamped,
    };
  }

  // 3. Default perimeter rail placement
  switch (side) {
    case "left":
      return {
        world: { x, y: y + HEADER_HEIGHT_DEFAULT + offset * Math.max(1, height - HEADER_HEIGHT_DEFAULT) },
        side: "left",
        normal: sideNormal("left"),
        clamped: false,
      };
    case "right":
      return {
        world: { x: x + width, y: y + HEADER_HEIGHT_DEFAULT + offset * Math.max(1, height - HEADER_HEIGHT_DEFAULT) },
        side: "right",
        normal: sideNormal("right"),
        clamped: false,
      };
    case "top":
      return {
        world: { x: x + offset * width, y },
        side: "top",
        normal: sideNormal("top"),
        clamped: false,
      };
    case "bottom":
      return {
        world: { x: x + offset * width, y: y + height },
        side: "bottom",
        normal: sideNormal("bottom"),
        clamped: false,
      };
  }
}
