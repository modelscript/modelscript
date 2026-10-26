// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — ECLIPSE Petroleum Reservoir Stratigraphy & Well Completion Diagram Builder.
 *
 * Translates Schlumberger ECLIPSE reservoir models into AntV X6 graph structures and standalone SVGs:
 * 1. Multi-layer subsurface geological grid cross-section ($X-Z$ depth slice).
 * 2. Fluid contact interfaces: Gas-Oil Contact (GOC) and Oil-Water Contact (OWC).
 * 3. Producer (`PROD`) and injector (`INJE`) wells with casing completions and perforation intervals (`COMPDAT`).
 */

export interface EclipseGridLike {
  nx?: number | undefined;
  ny?: number | undefined;
  nz?: number | undefined;
  dx?: number | number[] | undefined;
  dy?: number | number[] | undefined;
  dz?: number | number[] | undefined;
  tops?: number | undefined;
  topsDepth?: number | undefined; // meters
  poro?: number | undefined;
  permX?: number | undefined;
}

export interface EclipseWellPerforationLike {
  kTop: number;
  kBottom: number;
  diameter?: number | undefined;
  kh?: number | undefined;
}

export interface EclipseWellLike {
  name: string;
  group?: string | undefined;
  i?: number | undefined;
  j?: number | undefined;
  type?: "PROD" | "INJE" | string | undefined;
  preferredPhase?: "OIL" | "WATER" | "GAS" | undefined;
  fluid?: "OIL" | "WATER" | "GAS" | undefined;
  status?: "OPEN" | "SHUT" | undefined;
  perforations?: EclipseWellPerforationLike[] | undefined;
  completions?: { k1: number; k2: number; diameter?: number; kh?: number }[] | undefined;
}

export interface EclipseFluidContactsLike {
  gocDepth?: number | undefined; // Gas-Oil Contact depth (m)
  owcDepth?: number | undefined; // Oil-Water Contact depth (m)
}

export interface EclipseDeckLike {
  title?: string | undefined;
  dimensions?: { nx: number; ny: number; nz: number } | undefined;
  grid?: EclipseGridLike | undefined;
  wells?: Map<string, EclipseWellLike> | EclipseWellLike[] | undefined;
  contacts?: EclipseFluidContactsLike | undefined;
  solution?:
    | { equil?: { datumDepth?: number; datumPressure?: number; owcDepth?: number; gocDepth?: number } }
    | undefined;
}

export interface EclipseDiagramCell {
  id: string;
  shape: string;
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  label?: string | undefined;
  source?: { cell: string } | { x: number; y: number } | undefined;
  target?: { cell: string } | { x: number; y: number } | undefined;
  attrs?: Record<string, unknown> | undefined;
  data?: Record<string, unknown> | undefined;
}

export interface EclipseDiagramGraph {
  title: string;
  cells: EclipseDiagramCell[];
}

export interface EclipseRenderOptions {
  theme?: "dark" | "light" | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

/**
 * Helper to determine if a layer K is in the perforated or hydrocarbon pay interval.
 */
export function isLayerPayZone(deck: EclipseDeckLike, wells: EclipseWellLike[], k: number, nz: number): boolean {
  for (const w of wells) {
    const perfs = w.perforations ?? w.completions?.map((c) => ({ kTop: c.k1, kBottom: c.k2 }));
    if (perfs && perfs.some((p) => p.kTop <= k && k <= p.kBottom)) {
      return true;
    }
  }
  if (deck.grid?.poro !== undefined && deck.grid.poro >= 0.12) return true;
  if (deck.grid?.permX !== undefined && deck.grid.permX >= 50) return true;
  return k > 1 && k < nz;
}

/**
 * Builds an interactive AntV X6 graph model for an ECLIPSE reservoir cross-section.
 */
export function buildEclipseDiagram(deck: EclipseDeckLike): EclipseDiagramGraph {
  const cells: EclipseDiagramCell[] = [];
  const wells: EclipseWellLike[] = Array.isArray(deck.wells)
    ? deck.wells
    : deck.wells
      ? Array.from(deck.wells.values())
      : [];
  const nz = Math.max(3, deck.dimensions?.nz ?? deck.grid?.nz ?? 4);

  const startX = 80;
  const startY = 120;
  const sectionW = 580;
  const layerH = 45;

  // 1. Stratigraphic Geological Layers (K = 1 to nz)
  for (let k = 1; k <= nz; k++) {
    const ly = startY + (k - 1) * layerH;
    const isPayZone = isLayerPayZone(deck, wells, k, nz);
    const fill = isPayZone ? "#1e293b" : "#0f172a";
    const stroke = isPayZone ? "#f59e0b" : "#334155";

    cells.push({
      id: `layer_${k}`,
      shape: "rect",
      x: startX,
      y: ly,
      width: sectionW,
      height: layerH - 4,
      label: `Layer K=${k} ${isPayZone ? "(Pay Sandstone)" : "(Shale Caprock)"}`,
      attrs: {
        body: { fill, stroke, strokeWidth: 1.5, rx: 2, ry: 2 },
        label: { fill: "#94a3b8", fontSize: 9, refX: 10, textAnchor: "start" },
      },
      data: { layerIndex: k, isPayZone },
    });
  }

  // 2. Wells (Vertical trajectories across layers mapped to reservoir grid columns)
  const nx = deck.dimensions?.nx ?? deck.grid?.nx;
  const wellSpacing = sectionW / (wells.length + 1);
  for (let wIdx = 0; wIdx < wells.length; wIdx++) {
    const w = wells[wIdx]!;
    const wx =
      nx && w.i !== undefined
        ? startX + ((Math.min(nx, Math.max(1, w.i)) - 0.5) / nx) * sectionW
        : startX + (wIdx + 1) * wellSpacing;
    const isProd = w.type === "PROD";
    const color = isProd ? "#10b981" : "#06b6d4";

    // Wellhead Derrick
    cells.push({
      id: `wellhead_${w.name}`,
      shape: "polygon",
      x: wx - 12,
      y: startY - 35,
      width: 24,
      height: 30,
      label: w.name,
      attrs: {
        body: { fill: "#0f172a", stroke: color, strokeWidth: 2 },
        label: { fill: color, fontSize: 9, fontWeight: "bold" },
      },
      data: { wellName: w.name, type: w.type },
    });

    // Wellbore trajectory line
    cells.push({
      id: `bore_${w.name}`,
      shape: "edge",
      source: { x: wx, y: startY - 5 },
      target: { x: wx, y: startY + nz * layerH - 10 },
      attrs: { line: { stroke: color, strokeWidth: 3 } },
    });
  }

  return {
    title: deck.title ?? "ECLIPSE Reservoir Stratigraphy & Well Cross-Section",
    cells,
  };
}

/**
 * Emits a standalone SVG subsurface depth cross-section of an ECLIPSE reservoir.
 */
export function renderEclipseSvg(deck: EclipseDeckLike, options?: EclipseRenderOptions): string {
  const isDark = options?.theme !== "light";
  const bg = isDark ? "#0b0f19" : "#f8fafc";
  const textColor = isDark ? "#f8fafc" : "#0f172a";
  const subTextColor = isDark ? "#94a3b8" : "#64748b";

  const width = options?.width ?? 780;
  const height = options?.height ?? 440;

  const nz = Math.max(3, deck.dimensions?.nz ?? deck.grid?.nz ?? 4);
  const wells: EclipseWellLike[] = Array.isArray(deck.wells)
    ? deck.wells
    : deck.wells
      ? Array.from(deck.wells.values())
      : [];
  const topDepth = deck.grid?.topsDepth ?? deck.grid?.tops ?? 2400;

  const startX = 100;
  const startY = 120;
  const sectionW = width - 180;
  const layerH = 50;
  const sectionH = nz * layerH;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:${bg};font-family:Inter,system-ui,sans-serif;">\n`;

  // Title Banner
  svg += `  <text x="50" y="36" fill="${textColor}" font-size="16" font-weight="700">${deck.title ?? "Black Oil Reservoir 2D Stratigraphy Cross-Section"}</text>\n`;
  svg += `  <text x="50" y="52" fill="${subTextColor}" font-size="10">True Vertical Depth (TVD) vs Cross-Section Chainage with Well Completions</text>\n`;

  // Depth scale on the left axis
  svg += `  <line x1="${startX - 20}" y1="${startY}" x2="${startX - 20}" y2="${startY + sectionH}" stroke="${subTextColor}" stroke-width="1.5" />\n`;
  for (let k = 0; k <= nz; k++) {
    const dy = startY + k * layerH;
    const depthMeters = topDepth + k * 25;
    svg += `  <line x1="${startX - 25}" y1="${dy}" x2="${startX - 20}" y2="${dy}" stroke="${subTextColor}" stroke-width="1.5" />\n`;
    svg += `  <text x="${startX - 30}" y="${dy + 3.5}" fill="${subTextColor}" font-size="8" text-anchor="end">${depthMeters}m</text>\n`;
  }

  // 1. Draw Geological Layers
  const layerColors = isDark
    ? ["#1e293b", "#1e3a5f", "#14532d", "#3b1e54"]
    : ["#e2e8f0", "#bfdbfe", "#bbf7d0", "#f3e8ff"];

  for (let k = 1; k <= nz; k++) {
    const ly = startY + (k - 1) * layerH;
    const col = layerColors[(k - 1) % layerColors.length];

    const isPay = isLayerPayZone(deck, wells, k, nz);
    const permLabel =
      deck.grid?.permX !== undefined
        ? `k_h = ${deck.grid.permX} mD`
        : isPay
          ? "Porous Sandstone (Pay)"
          : "Impermeable Shale Seal";

    svg += `  <rect x="${startX}" y="${ly}" width="${sectionW}" height="${layerH - 2}" fill="${col}" stroke="#475569" stroke-width="1" rx="2" />\n`;
    svg += `  <text x="${startX + 15}" y="${ly + 20}" fill="${textColor}" font-size="9" font-weight="600">Layer K=${k}</text>\n`;
    svg += `  <text x="${startX + 15}" y="${ly + 35}" fill="${subTextColor}" font-size="8">${permLabel}</text>\n`;
  }

  // 2. Fluid Contacts (GOC / OWC)
  const gocDepth = deck.contacts?.gocDepth ?? deck.solution?.equil?.gocDepth;
  const owcDepth = deck.contacts?.owcDepth ?? deck.solution?.equil?.owcDepth;
  const depthSpan = nz * 25;

  const gocY =
    gocDepth !== undefined && gocDepth >= topDepth
      ? startY + Math.min(sectionH - 10, ((gocDepth - topDepth) / depthSpan) * sectionH)
      : startY + layerH * 1.3;

  const owcY =
    owcDepth !== undefined && owcDepth >= topDepth
      ? startY + Math.min(sectionH - 5, ((owcDepth - topDepth) / depthSpan) * sectionH)
      : startY + layerH * 2.8;

  // Gas-Oil Contact (GOC)
  svg += `  <line x1="${startX}" y1="${gocY}" x2="${startX + sectionW}" y2="${gocY}" stroke="#ef4444" stroke-width="2" stroke-dasharray="8,4" />\n`;
  svg += `  <text x="${startX + sectionW - 10}" y="${gocY - 6}" fill="#f87171" font-size="8" font-weight="bold" text-anchor="end">GOC: Gas-Oil Contact</text>\n`;

  // Oil-Water Contact (OWC)
  svg += `  <line x1="${startX}" y1="${owcY}" x2="${startX + sectionW}" y2="${owcY}" stroke="#38bdf8" stroke-width="2" stroke-dasharray="8,4" />\n`;
  svg += `  <text x="${startX + sectionW - 10}" y="${owcY - 6}" fill="#38bdf8" font-size="8" font-weight="bold" text-anchor="end">OWC: Oil-Water Contact</text>\n`;

  // 3. Draw Wells & Completions
  const nx = deck.dimensions?.nx ?? deck.grid?.nx;
  const wellSpacing = sectionW / (wells.length + 1);
  for (let wIdx = 0; wIdx < wells.length; wIdx++) {
    const w = wells[wIdx]!;
    const wx =
      nx && w.i !== undefined
        ? startX + ((Math.min(nx, Math.max(1, w.i)) - 0.5) / nx) * sectionW
        : startX + (wIdx + 1) * wellSpacing;
    const isProd = w.type === "PROD";
    const color = isProd ? "#10b981" : "#06b6d4";

    // Surface derrick triangle
    svg += `  <polygon points="${wx - 10},${startY - 5} ${wx},${startY - 35} ${wx + 10},${startY - 5}" fill="${isDark ? "#1e293b" : "#ffffff"}" stroke="${color}" stroke-width="2" />\n`;
    svg += `  <text x="${wx}" y="${startY - 40}" fill="${color}" font-size="10" font-weight="bold" text-anchor="middle">${w.name}</text>\n`;
    svg += `  <text x="${wx}" y="${startY - 22}" fill="${color}" font-size="7" font-weight="bold" text-anchor="middle">${w.type}</text>\n`;

    // Steel casing borehole line
    svg += `  <line x1="${wx}" y1="${startY - 5}" x2="${wx}" y2="${startY + sectionH - 15}" stroke="${color}" stroke-width="3.5" stroke-linecap="round" />\n`;

    // Perforation intervals (COMPDAT)
    const perfs = w.perforations ??
      w.completions?.map((c) => ({ kTop: c.k1, kBottom: c.k2 })) ?? [{ kTop: 2, kBottom: 3 }];
    for (const p of perfs) {
      const pTop = startY + (p.kTop - 1) * layerH;
      const pBot = startY + p.kBottom * layerH;
      // Perforation tick bursts
      for (let py = pTop + 10; py <= pBot - 10; py += 12) {
        svg += `  <line x1="${wx - 6}" y1="${py}" x2="${wx + 6}" y2="${py}" stroke="#facc15" stroke-width="2" />\n`;
      }
    }
  }

  // 4. Legend
  svg += `  <g id="eclipse-legend" transform="translate(${startX}, ${height - 25})">\n`;
  svg += `    <text x="0" y="0" fill="${subTextColor}" font-size="10" font-weight="600">Wells:</text>\n`;
  svg += `    <circle cx="50" cy="-4" r="5" fill="#10b981" />\n`;
  svg += `    <text x="60" y="0" fill="${subTextColor}" font-size="9">Producer (PROD)</text>\n`;
  svg += `    <circle cx="170" cy="-4" r="5" fill="#06b6d4" />\n`;
  svg += `    <text x="180" y="0" fill="${subTextColor}" font-size="9">Injector (INJE)</text>\n`;
  svg += `    <line x1="280" y1="-4" x2="295" y2="-4" stroke="#facc15" stroke-width="2" />\n`;
  svg += `    <text x="302" y="0" fill="${subTextColor}" font-size="9">Perforations (COMPDAT)</text>\n`;
  svg += `  </g>\n`;

  svg += `</svg>\n`;
  return svg;
}
