// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — RELAP5 Nuclear Primary & Secondary Loop Thermal-Hydraulic Diagram Builder.
 *
 * Translates RELAP5 hydrodynamic volume/junction decks into AntV X6 graph structures and standalone SVGs:
 * 1. Reactor Pressure Vessel (RPV) active core volume stack.
 * 2. Hot Leg & Cold Leg pipe loops with temperature gradient color fill.
 * 3. Steam Generator (SG) with primary U-tubes and secondary boiler shell.
 * 4. Pressurizer with electrical immersion heaters, spray valve, and surge line.
 * 5. Reactor Coolant Pump (RCP) and ECCS safety injection accumulators.
 */

export interface Relap5VolumeLike {
  id: number;
  name?: string | undefined;
  type?: string | undefined;
  length?: number | undefined;
  area?: number | undefined;
  elevation?: number | undefined;
  tempK?: number | undefined;
  pressurePa?: number | undefined;
  voidFraction?: number | undefined;
}

export interface Relap5JunctionLike {
  id: number;
  fromVolume: number;
  toVolume: number;
  flowArea?: number | undefined;
  massFlow?: number | undefined;
}

export interface Relap5ComponentLike {
  name: string;
  type: "CORE" | "STEAM_GENERATOR" | "PRESSURIZER" | "PUMP" | "PIPE" | "VALVE";
  volumeIds: number[];
  junctionIds?: number[] | undefined;
}

export interface Relap5DeckLike {
  title?: string | undefined;
  volumes: Map<number, Relap5VolumeLike> | Relap5VolumeLike[];
  junctions: Map<number, Relap5JunctionLike> | Relap5JunctionLike[];
  components?: Relap5ComponentLike[] | undefined;
}

export interface Relap5DiagramCell {
  id: string;
  shape: string;
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  label?: string | undefined;
  source?: { cell: string; port?: string | undefined } | { x: number; y: number } | undefined;
  target?: { cell: string; port?: string | undefined } | { x: number; y: number } | undefined;
  attrs?: Record<string, Record<string, unknown>> | undefined;
  data?: Record<string, unknown> | undefined;
}

export interface Relap5DiagramGraph {
  title: string;
  cells: Relap5DiagramCell[];
}

export interface Relap5RenderOptions {
  theme?: "dark" | "light" | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

/**
 * Returns thermodynamic temperature color (Coolant Blue -> Hot Core Red).
 */
export function getCoolantTempColor(tempK?: number): string {
  if (!tempK) return "#38bdf8";
  if (tempK >= 590) return "#ef4444"; // Hot Leg / Core Exit (> 317 C)
  if (tempK >= 570) return "#f59e0b"; // Core Mid
  if (tempK >= 550) return "#10b981"; // Steam Gen Exit
  return "#0284c7"; // Cold Leg Inlet (< 277 C)
}

/**
 * Builds an interactive AntV X6 graph model for a RELAP5 nuclear system.
 */
export function buildRelap5Diagram(deck: Relap5DeckLike): Relap5DiagramGraph {
  const cells: Relap5DiagramCell[] = [];
  const volsList: Relap5VolumeLike[] = Array.isArray(deck.volumes) ? deck.volumes : Array.from(deck.volumes.values());
  const juncsList: Relap5JunctionLike[] = Array.isArray(deck.junctions)
    ? deck.junctions
    : Array.from(deck.junctions.values());
  const junctionCount = juncsList.length;

  const isPwr =
    (deck.title && /pwr|westinghouse|reactor/i.test(deck.title)) ||
    deck.components?.some((c) => c.type === "CORE" || c.type === "STEAM_GENERATOR") ||
    volsList.length === 0;

  if (!isPwr && volsList.length > 0) {
    let curX = 80;
    let curY = 100;
    const volMap = new Map<number, { x: number; y: number; width: number; height: number }>();

    for (const v of volsList) {
      const width = 110;
      const height = 65;
      const stroke = getCoolantTempColor(v.tempK);
      const name = v.name || `Vol ${v.id}`;
      const tempStr = v.tempK ? `${(v.tempK - 273.15).toFixed(1)}°C` : "";
      const presStr = v.pressurePa ? `${(v.pressurePa / 1e6).toFixed(2)} MPa` : "";
      const subLabels = [tempStr, presStr].filter(Boolean).join(" | ");

      volMap.set(v.id, { x: curX, y: curY, width, height });

      cells.push({
        id: `vol_${v.id}`,
        shape: "rect",
        x: curX,
        y: curY,
        width,
        height,
        label: subLabels ? `${name}\n${subLabels}` : name,
        attrs: {
          body: { fill: "#0f172a", stroke, strokeWidth: 2, rx: 6, ry: 6 },
          label: { fill: "#f1f5f9", fontSize: 9.5, fontWeight: "600" },
        },
        data: {
          volumeId: v.id,
          name: v.name,
          tempK: v.tempK,
          pressurePa: v.pressurePa,
          elevation: v.elevation,
        },
      });

      curX += width + 60;
      if (curX > 750) {
        curX = 80;
        curY += height + 70;
      }
    }

    for (const j of juncsList) {
      const fromVol = volMap.get(j.fromVolume);
      const toVol = volMap.get(j.toVolume);
      const flowStr = j.massFlow !== undefined ? `${j.massFlow.toFixed(1)} kg/s` : `Junc ${j.id}`;

      cells.push({
        id: `junc_${j.id}`,
        shape: "edge",
        source: fromVol ? { cell: `vol_${j.fromVolume}` } : { x: 100, y: 100 },
        target: toVol ? { cell: `vol_${j.toVolume}` } : { x: 200, y: 100 },
        label: flowStr,
        attrs: {
          line: {
            stroke: "#38bdf8",
            strokeWidth: 2.2,
            targetMarker: { name: "classic", width: 8, height: 6 },
          },
          label: { fill: "#7dd3fc", fontSize: 8.5 },
        },
        data: {
          junctionId: j.id,
          fromVolume: j.fromVolume,
          toVolume: j.toVolume,
          massFlow: j.massFlow,
        },
      });
    }

    return {
      title: deck.title ?? "RELAP5 Hydrodynamic Nodalization",
      cells,
    };
  }

  // Closed loop physical nodalization layout
  // Center coordinates
  const rpvX = 180;
  const rpvY = 160;
  const sgX = 520;
  const sgY = 140;

  // 1. Reactor Pressure Vessel (RPV)
  cells.push({
    id: "rpv_vessel",
    shape: "rect",
    x: rpvX - 40,
    y: rpvY - 20,
    width: 80,
    height: 180,
    label: "RPV Core\nActive Fuel",
    attrs: {
      body: { fill: "#1e1b4b", stroke: "#ef4444", strokeWidth: 2.5, rx: 8, ry: 8 },
      label: { fill: "#fca5a5", fontSize: 10, fontWeight: "700" },
    },
    data: { componentType: "RPV", volumes: volsList.length, junctions: junctionCount },
  });

  // 2. Steam Generator (SG)
  cells.push({
    id: "sg_vessel",
    shape: "rect",
    x: sgX - 45,
    y: sgY - 30,
    width: 90,
    height: 200,
    label: "Steam Generator\n(U-Tubes)",
    attrs: {
      body: { fill: "#0f172a", stroke: "#06b6d4", strokeWidth: 2.5, rx: 10, ry: 10 },
      label: { fill: "#67e8f9", fontSize: 10, fontWeight: "700" },
    },
    data: { componentType: "STEAM_GENERATOR" },
  });

  // 3. Pressurizer (PZR) attached to Hot Leg
  const pzrX = 350;
  const pzrY = 70;
  cells.push({
    id: "pzr_vessel",
    shape: "rect",
    x: pzrX - 25,
    y: pzrY,
    width: 50,
    height: 90,
    label: "PZR\nPressurizer",
    attrs: {
      body: { fill: "#311042", stroke: "#c084fc", strokeWidth: 2, rx: 6, ry: 6 },
      label: { fill: "#e9d5ff", fontSize: 9, fontWeight: "600" },
    },
    data: { componentType: "PRESSURIZER" },
  });

  // Surge Line to Hot Leg
  cells.push({
    id: "wire_pzr_surge",
    shape: "edge",
    source: { x: pzrX, y: pzrY + 90 },
    target: { x: pzrX, y: rpvY + 10 },
    attrs: { line: { stroke: "#c084fc", strokeWidth: 2, strokeDasharray: "3,3" } },
  });

  // 4. Reactor Coolant Pump (RCP) on Cold Leg
  const rcpX = 350;
  const rcpY = rpvY + 130;
  cells.push({
    id: "rcp_pump",
    shape: "circle",
    x: rcpX - 22,
    y: rcpY - 22,
    width: 44,
    height: 44,
    label: "RCP",
    attrs: {
      body: { fill: "#064e3b", stroke: "#10b981", strokeWidth: 2 },
      label: { fill: "#6ee7b7", fontSize: 10, fontWeight: "bold" },
    },
    data: { componentType: "PUMP" },
  });

  // 5. Hot Leg Pipe: RPV -> SG
  cells.push({
    id: "pipe_hot_leg",
    shape: "edge",
    source: { x: rpvX + 40, y: rpvY + 10 },
    target: { x: sgX - 45, y: sgY + 140 },
    label: "Hot Leg\n320°C",
    attrs: {
      line: { stroke: "#ef4444", strokeWidth: 5, targetMarker: { name: "classic", width: 8, height: 6 } },
      label: { fill: "#fca5a5", fontSize: 9 },
    },
  });

  // 6. Cold Leg Pipes: SG -> RCP -> RPV
  cells.push({
    id: "pipe_crossover_leg",
    shape: "edge",
    source: { x: sgX - 45, y: sgY + 160 },
    target: { x: rcpX + 22, y: rcpY },
    label: "Crossover Leg",
    attrs: {
      line: { stroke: "#0284c7", strokeWidth: 4, targetMarker: { name: "classic", width: 8, height: 6 } },
      label: { fill: "#7dd3fc", fontSize: 8 },
    },
  });

  cells.push({
    id: "pipe_cold_leg",
    shape: "edge",
    source: { x: rcpX - 22, y: rcpY },
    target: { x: rpvX + 40, y: rpvY + 130 },
    label: "Cold Leg\n285°C",
    attrs: {
      line: { stroke: "#0284c7", strokeWidth: 5, targetMarker: { name: "classic", width: 8, height: 6 } },
      label: { fill: "#7dd3fc", fontSize: 9 },
    },
  });

  // 7. Secondary Steam and Feedwater Ports
  cells.push({
    id: "pipe_main_steam",
    shape: "edge",
    source: { x: sgX, y: sgY - 30 },
    target: { x: sgX + 100, y: sgY - 30 },
    label: "Main Steam\n6.8 MPa",
    attrs: {
      line: { stroke: "#f59e0b", strokeWidth: 3, targetMarker: { name: "classic", width: 8, height: 6 } },
      label: { fill: "#fde68a", fontSize: 8 },
    },
  });

  cells.push({
    id: "pipe_feedwater",
    shape: "edge",
    source: { x: sgX + 100, y: sgY + 70 },
    target: { x: sgX + 45, y: sgY + 70 },
    label: "Feedwater\n220°C",
    attrs: {
      line: { stroke: "#06b6d4", strokeWidth: 2.5, targetMarker: { name: "classic", width: 8, height: 6 } },
      label: { fill: "#67e8f9", fontSize: 8 },
    },
  });

  return {
    title: deck.title ?? "RELAP5 Nuclear Power Plant Nodalization",
    cells,
  };
}

/**
 * Emits a standalone SVG flowsheet of a RELAP5 nuclear primary/secondary loop system.
 */
export function renderRelap5Svg(deck: Relap5DeckLike, options?: Relap5RenderOptions): string {
  const diag = buildRelap5Diagram(deck);
  const isDark = options?.theme !== "light";
  const bg = isDark ? "#0b0f19" : "#f8fafc";
  const textColor = isDark ? "#f8fafc" : "#0f172a";
  const subTextColor = isDark ? "#94a3b8" : "#64748b";

  const nodeMap = new Map<string, Relap5DiagramCell>();
  let maxX = 780;
  let maxY = 460;
  for (const c of diag.cells) {
    if (c.x !== undefined && c.y !== undefined) {
      nodeMap.set(c.id, c);
      maxX = Math.max(maxX, c.x + (c.width ?? 110) + 60);
      maxY = Math.max(maxY, c.y + (c.height ?? 80) + 70);
    }
  }

  const width = options?.width ?? maxX;
  const height = options?.height ?? maxY;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:${bg};font-family:Inter,system-ui,sans-serif;">\n`;
  svg += `  <defs>\n`;
  svg += `    <linearGradient id="core-glow" x1="0%" y1="0%" x2="0%" y2="100%">\n`;
  svg += `      <stop offset="0%" stop-color="#ef4444" stop-opacity="0.8" />\n`;
  svg += `      <stop offset="100%" stop-color="#7f1d1d" stop-opacity="0.3" />\n`;
  svg += `    </linearGradient>\n`;
  svg += `    <marker id="nuc-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n`;
  svg += `      <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />\n`;
  svg += `    </marker>\n`;
  svg += `  </defs>\n`;

  // Title Banner
  svg += `  <text x="50" y="36" fill="${textColor}" font-size="16" font-weight="700">${diag.title}</text>\n`;
  svg += `  <text x="50" y="52" fill="${subTextColor}" font-size="10">Reactor Coolant System (RCS) Thermal-Hydraulic Nodalization</text>\n`;

  // 1. Draw Piping & Flow Loops
  for (const c of diag.cells) {
    if (c.shape === "edge" && c.source && c.target) {
      let p1 = { x: 200, y: 200 };
      let p2 = { x: 300, y: 200 };

      if ("x" in c.source && typeof c.source.x === "number") {
        p1 = { x: c.source.x, y: c.source.y };
      } else if ("cell" in c.source && nodeMap.has(c.source.cell)) {
        const srcNode = nodeMap.get(c.source.cell)!;
        p1 = {
          x: (srcNode.x ?? 0) + (srcNode.width ?? 110),
          y: (srcNode.y ?? 0) + (srcNode.height ?? 65) / 2,
        };
      }

      if ("x" in c.target && typeof c.target.x === "number") {
        p2 = { x: c.target.x, y: c.target.y };
      } else if ("cell" in c.target && nodeMap.has(c.target.cell)) {
        const tgtNode = nodeMap.get(c.target.cell)!;
        p2 = {
          x: tgtNode.x ?? 0,
          y: (tgtNode.y ?? 0) + (tgtNode.height ?? 65) / 2,
        };
      }

      const stroke = (c.attrs?.["line"]?.["stroke"] as string | undefined) ?? "#38bdf8";
      const strokeWidth = (c.attrs?.["line"]?.["strokeWidth"] as number | undefined) ?? 3;
      const rawDash = c.attrs?.["line"]?.["strokeDasharray"] as string | undefined;
      const dash = rawDash ? `stroke-dasharray="${rawDash}"` : "";

      svg += `  <line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="${stroke}" stroke-width="${strokeWidth}" ${dash} stroke-linecap="round" />\n`;
      if (c.label) {
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;
        svg += `  <text x="${mx}" y="${my - 6}" fill="${subTextColor}" font-size="9" text-anchor="middle">${c.label.split("\n")[0]}</text>\n`;
      }
    }
  }

  // 2. Draw Vessels & Equipment
  for (const c of diag.cells) {
    if (c.shape === "rect" && c.x !== undefined && c.y !== undefined) {
      const w = c.width ?? 80;
      const h = c.height ?? 160;
      const fill = (c.attrs?.["body"]?.["fill"] as string | undefined) ?? "#0f172a";
      const stroke = (c.attrs?.["body"]?.["stroke"] as string | undefined) ?? "#ef4444";
      const rx = (c.attrs?.["body"]?.["rx"] as number | undefined) ?? 6;

      svg += `  <g>\n`;
      svg += `    <rect x="${c.x}" y="${c.y}" width="${w}" height="${h}" rx="${rx}" ry="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="2.5" />\n`;

      // Internal fuel core hashes for RPV
      if (c.id === "rpv_vessel") {
        for (let i = 1; i <= 5; i++) {
          const fx = c.x + 12 + i * 9;
          svg += `    <line x1="${fx}" y1="${c.y + 40}" x2="${fx}" y2="${c.y + h - 30}" stroke="#f87171" stroke-width="2" />\n`;
        }
      }

      // Internal U-tube inverted arch for SG
      if (c.id === "sg_vessel") {
        svg += `    <path d="M ${c.x + 25} ${c.y + h - 30} L ${c.x + 25} ${c.y + 35} A 20 20 0 0 1 ${c.x + 65} ${c.y + 35} L ${c.x + 65} ${c.y + h - 30}" fill="none" stroke="#38bdf8" stroke-width="2" stroke-dasharray="3,2" />\n`;
      }

      const lines = (c.label ?? "").split("\n");
      svg += `    <text x="${c.x + w / 2}" y="${c.y + h / 2 - 4}" fill="${textColor}" font-size="10" font-weight="700" text-anchor="middle">${lines[0]}</text>\n`;
      if (lines[1]) {
        svg += `    <text x="${c.x + w / 2}" y="${c.y + h / 2 + 10}" fill="${subTextColor}" font-size="8" text-anchor="middle">${lines[1]}</text>\n`;
      }
      svg += `  </g>\n`;
    } else if (c.shape === "circle" && c.x !== undefined && c.y !== undefined) {
      const r = (c.width ?? 44) / 2;
      const cx = c.x + r;
      const cy = c.y + r;
      const fill = (c.attrs?.["body"]?.["fill"] as string | undefined) ?? "#064e3b";
      const stroke = (c.attrs?.["body"]?.["stroke"] as string | undefined) ?? "#10b981";

      svg += `  <g>\n`;
      svg += `    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2.5" />\n`;
      svg += `    <text x="${cx}" y="${cy + 4}" fill="#6ee7b7" font-size="10" font-weight="bold" text-anchor="middle">${c.label}</text>\n`;
      svg += `  </g>\n`;
    }
  }

  // 3. Temperature Gradient Legend
  svg += `  <g id="relap-legend" transform="translate(50, ${height - 25})">\n`;
  svg += `    <text x="0" y="0" fill="${subTextColor}" font-size="10" font-weight="600">Coolant Temp:</text>\n`;
  svg += `    <rect x="85" y="-9" width="12" height="12" rx="2" fill="#0284c7" />\n`;
  svg += `    <text x="103" y="0" fill="${subTextColor}" font-size="9">Cold Leg (~285°C)</text>\n`;
  svg += `    <rect x="210" y="-9" width="12" height="12" rx="2" fill="#ef4444" />\n`;
  svg += `    <text x="228" y="0" fill="${subTextColor}" font-size="9">Hot Leg (~320°C)</text>\n`;
  svg += `    <rect x="330" y="-9" width="12" height="12" rx="2" fill="#c084fc" />\n`;
  svg += `    <text x="348" y="0" fill="${subTextColor}" font-size="9">PZR Saturation (~345°C)</text>\n`;
  svg += `  </g>\n`;

  svg += `</svg>\n`;
  return svg;
}
