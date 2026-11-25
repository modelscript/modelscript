// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WorldBounds, WorldPoint } from "../../schema/canvas-document.js";
import type { DiagramMarkupNode } from "../glyph-compiler.js";
import type { ResizeHandleKind } from "../pointer-fsm.js";
import type { UnifiedPortItem } from "./types.js";

let autoCellCounter = 1;

/** Generates a monotonically increasing identifier with the given prefix. */
export function nextAutoCellId(prefix: string): string {
  return `${prefix}${autoCellCounter++}`;
}

export function defaultPolylinePath(
  source: WorldPoint,
  target: WorldPoint,
  routePoints: WorldPoint[],
  connectorName: string,
  radius = 8,
): string {
  const pts = [source, ...routePoints, target];
  if (pts.length < 2) return "";
  if (connectorName === "rounded" && pts.length >= 3 && radius > 0) {
    let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const prev = pts[i - 1]!;
      const curr = pts[i]!;
      const next = pts[i + 1]!;
      const d1 = Math.hypot(curr.x - prev.x, curr.y - prev.y);
      const d2 = Math.hypot(next.x - curr.x, next.y - curr.y);
      const r = Math.min(radius, d1 / 2, d2 / 2);
      if (r <= 0.5) {
        d += ` L ${curr.x} ${curr.y}`;
        continue;
      }
      const p1x = curr.x - ((curr.x - prev.x) / d1) * r;
      const p1y = curr.y - ((curr.y - prev.y) / d1) * r;
      const p2x = curr.x + ((next.x - curr.x) / d2) * r;
      const p2y = curr.y + ((next.y - curr.y) / d2) * r;
      d += ` L ${p1x} ${p1y} Q ${curr.x} ${curr.y} ${p2x} ${p2y}`;
    }
    const last = pts[pts.length - 1]!;
    d += ` L ${last.x} ${last.y}`;
    return d;
  }

  let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i]!.x} ${pts[i]!.y}`;
  }
  return d;
}

export function samplePointAlongPolyline(pts: WorldPoint[], fraction: number): WorldPoint {
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1) return pts[0]!;
  const segLengths: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y);
    segLengths.push(len);
    total += len;
  }
  if (total <= 1e-6) return pts[0]!;
  const targetDist = Math.max(0, Math.min(1, fraction)) * total;
  let acc = 0;
  for (let i = 0; i < segLengths.length; i++) {
    const seg = segLengths[i]!;
    if (acc + seg >= targetDist || i === segLengths.length - 1) {
      const localT = seg > 1e-6 ? (targetDist - acc) / seg : 0;
      const a = pts[i]!;
      const b = pts[i + 1]!;
      return { x: a.x + (b.x - a.x) * localT, y: a.y + (b.y - a.y) * localT };
    }
    acc += seg;
  }
  return pts[pts.length - 1]!;
}

const RESIZE_CURSOR_RING = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"] as const;

const HANDLE_BASE_ANGLE: Record<ResizeHandleKind, number> = {
  e: 0,
  w: 0,
  nw: 45,
  se: 45,
  n: 90,
  s: 90,
  ne: 135,
  sw: 135,
  rotate: 0,
};

export function getResizeCursorForHandle(handle: ResizeHandleKind, angleDeg: number): string {
  if (handle === "rotate") return "grab";
  const effective = (((HANDLE_BASE_ANGLE[handle] + angleDeg) % 180) + 180) % 180;
  const sector = Math.round(effective / 45) % 4;
  return RESIZE_CURSOR_RING[sector] ?? "nwse-resize";
}

export function escapeSelectorAttr(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

export function isDarkColorString(color: string): boolean {
  const c = color.trim().toLowerCase();
  if (!c || c === "transparent" || c === "none") return false;
  if (c === "#ffffff" || c === "#fff" || c === "white" || c === "#f8fafc" || c === "#f1f5f9") return false;
  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(c);
  if (hexMatch) {
    const hex = hexMatch[1]!;
    const r = hex.length === 3 ? parseInt(hex[0]! + hex[0]!, 16) : parseInt(hex.slice(0, 2), 16);
    const g = hex.length === 3 ? parseInt(hex[1]! + hex[1]!, 16) : parseInt(hex.slice(2, 4), 16);
    const b = hex.length === 3 ? parseInt(hex[2]! + hex[2]!, 16) : parseInt(hex.slice(4, 6), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum < 0.5;
  }
  const rgbMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(c);
  if (rgbMatch) {
    const lum = (0.299 * Number(rgbMatch[1]) + 0.587 * Number(rgbMatch[2]) + 0.114 * Number(rgbMatch[3])) / 255;
    return lum < 0.5;
  }
  return true;
}

export function resolvePortScalar(raw: unknown, total: number): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.endsWith("%")) {
      const pct = parseFloat(trimmed.slice(0, -1));
      return Number.isFinite(pct) ? (pct / 100) * total : undefined;
    }
    const n = parseFloat(trimmed);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function resolvePortsWithGroups(
  items: UnifiedPortItem[],
  groups: Record<string, unknown>,
  width: number,
  height: number,
): UnifiedPortItem[] {
  const countsByGroup = new Map<string, number>();
  for (const p of items) {
    const g = p.group ?? "";
    countsByGroup.set(g, (countsByGroup.get(g) ?? 0) + 1);
  }
  const indexByGroup = new Map<string, number>();

  return items.map((raw) => {
    const p: UnifiedPortItem = { ...raw, args: raw.args ? { ...raw.args } : {} };
    const grpName = p.group ?? "";
    const idx = indexByGroup.get(grpName) ?? 0;
    indexByGroup.set(grpName, idx + 1);
    const totalInGroup = countsByGroup.get(grpName) ?? 1;

    const grpSpec =
      grpName && typeof groups[grpName] === "object" && groups[grpName] !== null
        ? (groups[grpName] as Record<string, unknown>)
        : null;

    if (!p.markup && grpSpec?.["markup"]) {
      p.markup = grpSpec["markup"] as DiagramMarkupNode | DiagramMarkupNode[];
    }
    if (!p.attrs && grpSpec?.["attrs"]) {
      p.attrs = grpSpec["attrs"] as Record<string, Record<string, unknown>>;
    }

    const posSpec = grpSpec?.["position"];
    const posName =
      typeof posSpec === "string"
        ? posSpec
        : posSpec && typeof posSpec === "object"
          ? String((posSpec as Record<string, unknown>)["name"] ?? "")
          : grpName;
    const posArgs =
      posSpec && typeof posSpec === "object" && typeof (posSpec as Record<string, unknown>)["args"] === "object"
        ? ((posSpec as Record<string, unknown>)["args"] as Record<string, unknown>)
        : undefined;

    const rawX = (p.args as Record<string, unknown> | undefined)?.["x"] ?? posArgs?.["x"];
    const rawY = (p.args as Record<string, unknown> | undefined)?.["y"] ?? posArgs?.["y"];
    let x = resolvePortScalar(rawX, width);
    let y = resolvePortScalar(rawY, height);

    const frac = (idx + 1) / (totalInGroup + 1);
    if (x === undefined || y === undefined) {
      if (posName === "left" || posName === "in") {
        if (x === undefined) x = 0;
        if (y === undefined) y = height * frac;
      } else if (posName === "right" || posName === "out") {
        if (x === undefined) x = width;
        if (y === undefined) y = height * frac;
      } else if (posName === "top") {
        if (x === undefined) x = width * frac;
        if (y === undefined) y = 0;
      } else if (posName === "bottom") {
        if (x === undefined) x = width * frac;
        if (y === undefined) y = height;
      }
    }

    p.args = {
      ...(p.args ?? {}),
      x: x ?? 0,
      y: y ?? 0,
    };
    return p;
  });
}

export function computeZoomToRectState(
  rect: WorldBounds,
  viewportWidth: number,
  viewportHeight: number,
  clampZoom: (z: number) => number,
  options?: {
    padding?: number | undefined;
    maxScale?: number | undefined;
    viewportArea?: WorldBounds | undefined;
  },
): { tx: number; ty: number; zoom: number } {
  const pad = options?.padding ?? 24;
  const area = options?.viewportArea ?? { x: 0, y: 0, width: viewportWidth, height: viewportHeight };
  const safeW = Math.max(1, rect.width);
  const safeH = Math.max(1, rect.height);
  const availW = Math.max(16, area.width - pad * 2);
  const availH = Math.max(16, area.height - pad * 2);
  let zoom = clampZoom(Math.min(availW / safeW, availH / safeH));
  if (options?.maxScale !== undefined && zoom > options.maxScale) {
    zoom = clampZoom(options.maxScale);
  }
  const cx = rect.x + safeW / 2;
  const cy = rect.y + safeH / 2;
  return {
    tx: area.x + area.width / 2 - cx * zoom,
    ty: area.y + area.height / 2 - cy * zoom,
    zoom,
  };
}
