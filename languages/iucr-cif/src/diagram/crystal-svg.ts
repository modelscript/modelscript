// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure SVG Crystal Lattice (3D Isometric Projection) & Cu-Kα Powder XRD Pattern Renderer.
 */

import { fractionalToCartesian, lookupElement, solveCrystalStructure } from "../solver/index.js";
import type { CifDataBlock, CifDocument, CrystalSolution, CrystalStructure, Vec3 } from "../types.js";

export type IucrCifSvgView = "combined" | "lattice" | "xrd";

export interface RenderIucrCifSvgOptions {
  view?: IucrCifSvgView;
  azimuthDeg?: number;
  elevationDeg?: number;
  width?: number;
  height?: number;
  colorMode?: "dark" | "light";
}

function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function projectPoint(
  p: Vec3,
  center: Vec3,
  cosAz: number,
  sinAz: number,
  cosEl: number,
  sinEl: number,
): { x: number; y: number; z: number } {
  const dx = p[0] - center[0];
  const dy = p[1] - center[1];
  const dz = p[2] - center[2];

  // Rotate around Z (azimuth), then tilt around X (elevation)
  const x1 = dx * cosAz - dy * sinAz;
  const y1 = dx * sinAz + dy * cosAz;
  const z1 = dz;

  const x2 = x1;
  const y2 = y1 * cosEl - z1 * sinEl;
  const z2 = y1 * sinEl + z1 * cosEl;

  return { x: x2, y: -z2, z: y2 };
}

function renderLatticePanel(
  sol: CrystalSolution,
  x0: number,
  y0: number,
  w: number,
  h: number,
  azimuthDeg: number,
  elevationDeg: number,
  isDark: boolean,
): string {
  const { metric, expandedAtoms, bonds, structure } = sol;
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const cosAz = Math.cos(az);
  const sinAz = Math.sin(az);
  const cosEl = Math.cos(el);
  const sinEl = Math.sin(el);

  const center = fractionalToCartesian(metric, [0.5, 0.5, 0.5]);

  // 8 unit-cell corners
  const cornerFracts: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 1, 0],
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
  ];
  const cornerProj = cornerFracts.map((f) =>
    projectPoint(fractionalToCartesian(metric, f), center, cosAz, sinAz, cosEl, sinEl),
  );

  // Compute bounding radius for scale
  let maxSpan = 1e-3;
  for (const cp of cornerProj) {
    maxSpan = Math.max(maxSpan, Math.abs(cp.x), Math.abs(cp.y));
  }
  const usable = Math.min(w - 56, h - 76);
  const scale = (usable * 0.44) / maxSpan;
  const cx = x0 + w / 2;
  const cy = y0 + h / 2 + 10;

  const toScreen = (p: { x: number; y: number }) => ({
    sx: cx + p.x * scale,
    sy: cy + p.y * scale,
  });

  const parts: string[] = [];
  const bg = isDark ? "#0f172a" : "#f8fafc";
  const border = isDark ? "#334155" : "#cbd5e1";
  const textPrimary = isDark ? "#f1f5f9" : "#0f172a";
  const textMuted = isDark ? "#94a3b8" : "#475569";
  const wireColor = isDark ? "#475569" : "#94a3b8";

  parts.push(
    `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="8" fill="${bg}" stroke="${border}" stroke-width="1"/>`,
  );
  parts.push(
    `<text x="${x0 + 14}" y="${y0 + 22}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="12" font-weight="600" fill="${textPrimary}">Unit Cell Lattice — ${escXml(structure.name)}</text>`,
  );
  parts.push(
    `<text x="${x0 + 14}" y="${y0 + 38}" font-family="ui-monospace, monospace" font-size="10" fill="${textMuted}">a=${structure.cell.a.toFixed(3)} b=${structure.cell.b.toFixed(3)} c=${structure.cell.c.toFixed(3)} Å · V=${metric.volume.toFixed(2)} Å³ · ${escXml(structure.spaceGroupName ?? metric.crystalSystem)}</text>`,
  );

  // Unit cell wireframe edges: [idxA, idxB, color, label?]
  const edges: Array<[number, number, string, string?]> = [
    [0, 1, "#ef4444", "a"],
    [0, 2, "#22c55e", "b"],
    [0, 3, "#3b82f6", "c"],
    [1, 4, wireColor],
    [1, 5, wireColor],
    [2, 4, wireColor],
    [2, 6, wireColor],
    [3, 5, wireColor],
    [3, 6, wireColor],
    [4, 7, wireColor],
    [5, 7, wireColor],
    [6, 7, wireColor],
  ];

  for (const [iA, iB, color, axisLabel] of edges) {
    const pA = toScreen(cornerProj[iA]!);
    const pB = toScreen(cornerProj[iB]!);
    const dash = axisLabel ? "" : ` stroke-dasharray="3,3"`;
    const sw = axisLabel ? "1.8" : "1.0";
    parts.push(
      `<line x1="${pA.sx.toFixed(1)}" y1="${pA.sy.toFixed(1)}" x2="${pB.sx.toFixed(1)}" y2="${pB.sy.toFixed(1)}" stroke="${color}" stroke-width="${sw}"${dash} opacity="0.85"/>`,
    );
    if (axisLabel) {
      parts.push(
        `<text x="${(pB.sx + (pB.sx - pA.sx) * 0.08).toFixed(1)}" y="${(pB.sy + (pB.sy - pA.sy) * 0.08).toFixed(1)}" font-family="ui-monospace, monospace" font-size="11" font-weight="700" fill="${color}">${axisLabel}</text>`,
      );
    }
  }

  // Project atoms and prepare depth-sorted drawables (bonds + atoms)
  const atomProj = expandedAtoms.map((atom) => ({
    atom,
    proj: projectPoint(atom.cart, center, cosAz, sinAz, cosEl, sinEl),
  }));

  interface DrawItem {
    depth: number;
    svg: string;
  }
  const drawables: DrawItem[] = [];

  // Intra-cell bonds
  const bondColor = isDark ? "#cbd5e1" : "#64748b";
  for (const bond of bonds) {
    if (bond.imageShift[0] !== 0 || bond.imageShift[1] !== 0 || bond.imageShift[2] !== 0) continue;
    const aP = atomProj[bond.atomA];
    const bP = atomProj[bond.atomB];
    if (!aP || !bP) continue;
    const sA = toScreen(aP.proj);
    const sB = toScreen(bP.proj);
    const depth = (aP.proj.z + bP.proj.z) / 2 - 0.05;
    drawables.push({
      depth,
      svg: `<line x1="${sA.sx.toFixed(1)}" y1="${sA.sy.toFixed(1)}" x2="${sB.sx.toFixed(1)}" y2="${sB.sy.toFixed(1)}" stroke="${bondColor}" stroke-width="2.2" stroke-linecap="round" opacity="0.72"/>`,
    });
  }

  // Atoms as shaded CPK spheres
  for (const { atom, proj } of atomProj) {
    const s = toScreen(proj);
    const elInfo = lookupElement(atom.symbol);
    const fill = elInfo?.cpkColor ?? "#38bdf8";
    const baseR = Math.max(6, Math.min(14, (elInfo?.covalentRadius ?? 1.0) * 7.5));
    const strokeCol = isDark ? "#0f172a" : "#ffffff";
    const labelColor = isDark ? "#0f172a" : "#ffffff";
    drawables.push({
      depth: proj.z,
      svg:
        `<g>` +
        `<circle cx="${s.sx.toFixed(1)}" cy="${s.sy.toFixed(1)}" r="${baseR.toFixed(1)}" fill="${fill}" stroke="${strokeCol}" stroke-width="1.2"/>` +
        `<circle cx="${(s.sx - baseR * 0.28).toFixed(1)}" cy="${(s.sy - baseR * 0.28).toFixed(1)}" r="${(baseR * 0.28).toFixed(1)}" fill="#ffffff" opacity="0.45"/>` +
        `<text x="${s.sx.toFixed(1)}" y="${(s.sy + 3.2).toFixed(1)}" text-anchor="middle" font-family="ui-sans-serif, sans-serif" font-size="8.5" font-weight="700" fill="${labelColor}">${escXml(atom.symbol)}</text>` +
        `</g>`,
    });
  }

  // Back-to-front painter's sort
  drawables.sort((a, b) => a.depth - b.depth);
  for (const item of drawables) {
    parts.push(item.svg);
  }

  // Footer info
  parts.push(
    `<text x="${x0 + 14}" y="${y0 + h - 10}" font-family="ui-monospace, monospace" font-size="9.5" fill="${textMuted}">Atoms: ${expandedAtoms.length} · NN: ${sol.nearestNeighborDistance.toFixed(3)} Å · ρ: ${sol.densityGCm3.toFixed(3)} g/cm³</text>`,
  );

  return parts.join("\n");
}

function renderXrdPanel(sol: CrystalSolution, x0: number, y0: number, w: number, h: number, isDark: boolean): string {
  const { xrd } = sol;
  const bg = isDark ? "#0f172a" : "#f8fafc";
  const border = isDark ? "#334155" : "#cbd5e1";
  const textPrimary = isDark ? "#f1f5f9" : "#0f172a";
  const textMuted = isDark ? "#94a3b8" : "#475569";
  const gridColor = isDark ? "#1e293b" : "#e2e8f0";
  const curveColor = isDark ? "#38bdf8" : "#0284c7";
  const peakColor = isDark ? "#f59e0b" : "#d97706";

  const padL = 46;
  const padR = 18;
  const padT = 50;
  const padB = 42;
  const plotW = Math.max(60, w - padL - padR);
  const plotH = Math.max(60, h - padT - padB);
  const px0 = x0 + padL;
  const py0 = y0 + padT;

  const ttMin = xrd.twoThetaMin;
  const ttMax = xrd.twoThetaMax;
  const ttSpan = Math.max(1, ttMax - ttMin);

  const mapX = (tt: number) => px0 + ((tt - ttMin) / ttSpan) * plotW;
  const mapY = (inten: number) => py0 + plotH - (Math.min(105, Math.max(0, inten)) / 105) * plotH;

  const parts: string[] = [];
  parts.push(
    `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="8" fill="${bg}" stroke="${border}" stroke-width="1"/>`,
  );
  parts.push(
    `<text x="${x0 + 14}" y="${y0 + 22}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="12" font-weight="600" fill="${textPrimary}">Simulated Powder XRD Pattern</text>`,
  );
  parts.push(
    `<text x="${x0 + 14}" y="${y0 + 38}" font-family="ui-monospace, monospace" font-size="10" fill="${textMuted}">Cu-Kα λ = ${xrd.wavelength.toFixed(4)} Å · ${xrd.peaks.length} reflections (${ttMin}°–${ttMax}°)</text>`,
  );

  // Horizontal grid lines (0, 25, 50, 75, 100%)
  for (const pct of [0, 25, 50, 75, 100]) {
    const gy = mapY(pct);
    parts.push(
      `<line x1="${px0}" y1="${gy.toFixed(1)}" x2="${(px0 + plotW).toFixed(1)}" y2="${gy.toFixed(1)}" stroke="${gridColor}" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${px0 - 6}" y="${(gy + 3).toFixed(1)}" text-anchor="end" font-family="ui-monospace, monospace" font-size="9" fill="${textMuted}">${pct}</text>`,
    );
  }

  // Vertical 2θ grid lines every 10°
  const startTick = Math.ceil(ttMin / 10) * 10;
  for (let tt = startTick; tt <= ttMax; tt += 10) {
    const gx = mapX(tt);
    parts.push(
      `<line x1="${gx.toFixed(1)}" y1="${py0}" x2="${gx.toFixed(1)}" y2="${(py0 + plotH).toFixed(1)}" stroke="${gridColor}" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${gx.toFixed(1)}" y="${(py0 + plotH + 14).toFixed(1)}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="9" fill="${textMuted}">${tt}°</text>`,
    );
  }

  // Axes border
  parts.push(
    `<rect x="${px0}" y="${py0}" width="${plotW}" height="${plotH}" fill="none" stroke="${border}" stroke-width="1"/>`,
  );

  // Broadened diffraction profile curve
  if (xrd.profile.length > 1) {
    let maxProf = 1;
    for (const pt of xrd.profile) {
      if (pt.intensity > maxProf) maxProf = pt.intensity;
    }
    const pts = xrd.profile
      .map((pt) => `${mapX(pt.twoTheta).toFixed(1)},${mapY((pt.intensity / maxProf) * 100).toFixed(1)}`)
      .join(" ");
    parts.push(
      `<polyline points="${pts}" fill="none" stroke="${curveColor}" stroke-width="1.6" stroke-linejoin="round"/>`,
    );
  }

  // Stick markers & (hkl) labels for top peaks
  const labeledPeaks = [...xrd.peaks].sort((a, b) => b.relativeIntensity - a.relativeIntensity).slice(0, 7);
  const labeledSet = new Set(labeledPeaks);

  for (const peak of xrd.peaks) {
    const gx = mapX(peak.twoTheta);
    const gyTop = mapY(peak.relativeIntensity);
    const gyBot = mapY(0);
    parts.push(
      `<line x1="${gx.toFixed(1)}" y1="${gyBot.toFixed(1)}" x2="${gx.toFixed(1)}" y2="${gyTop.toFixed(1)}" stroke="${peakColor}" stroke-width="1.1" opacity="0.65"/>`,
    );
    if (labeledSet.has(peak)) {
      const [h, k, l] = peak.hkl;
      parts.push(
        `<text x="${gx.toFixed(1)}" y="${Math.max(py0 + 10, gyTop - 4).toFixed(1)}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="8.5" font-weight="600" fill="${textPrimary}">(${h}${k}${l})</text>`,
      );
    }
  }

  // Axis labels
  parts.push(
    `<text x="${(px0 + plotW / 2).toFixed(1)}" y="${y0 + h - 8}" text-anchor="middle" font-family="ui-sans-serif, sans-serif" font-size="10" fill="${textMuted}">2θ (degrees)</text>`,
  );
  parts.push(
    `<text x="${x0 + 13}" y="${(py0 + plotH / 2).toFixed(1)}" text-anchor="middle" font-family="ui-sans-serif, sans-serif" font-size="10" fill="${textMuted}" transform="rotate(-90 ${x0 + 13} ${(py0 + plotH / 2).toFixed(1)})">Rel. Intensity (%)</text>`,
  );

  return parts.join("\n");
}

/**
 * Renders a pure SVG crystal lattice (3D isometric projection) and/or Cu-Kα powder XRD pattern.
 */
export function renderIucrCifSvg(
  input: string | CifDocument | CifDataBlock | CrystalStructure | CrystalSolution,
  options: RenderIucrCifSvgOptions = {},
): string {
  const sol: CrystalSolution =
    typeof input === "object" && "xrd" in input && "metric" in input ? input : solveCrystalStructure(input);

  const view = options.view ?? "combined";
  const azimuthDeg = options.azimuthDeg ?? 32;
  const elevationDeg = options.elevationDeg ?? 22;
  const isDark = (options.colorMode ?? "dark") === "dark";
  const width = options.width ?? (view === "combined" ? 920 : 520);
  const height = options.height ?? 420;
  const outerBg = isDark ? "#020617" : "#ffffff";

  const body: string[] = [];
  if (view === "combined") {
    const gap = 12;
    const leftW = Math.floor((width - 24 - gap) * 0.48);
    const rightW = width - 24 - gap - leftW;
    body.push(renderLatticePanel(sol, 12, 12, leftW, height - 24, azimuthDeg, elevationDeg, isDark));
    body.push(renderXrdPanel(sol, 12 + leftW + gap, 12, rightW, height - 24, isDark));
  } else if (view === "lattice") {
    body.push(renderLatticePanel(sol, 12, 12, width - 24, height - 24, azimuthDeg, elevationDeg, isDark));
  } else {
    body.push(renderXrdPanel(sol, 12, 12, width - 24, height - 24, isDark));
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `<rect width="${width}" height="${height}" fill="${outerBg}"/>`,
    ...body,
    `</svg>`,
  ].join("\n");
}
