// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — EPRI OpenDSS Electric Distribution Feeder & Microgrid Diagram Builder.
 *
 * Translates OpenDSS distribution decks into AntV X6 graph structures and standalone SVGs:
 * 1. Single-Line Diagram (SLD) with substation transformers, buses, lines, loads, and DERs.
 * 2. Phase-based color coding (3-phase, 2-phase, single-phase lateral taps).
 * 3. Photovoltaic solar (PV), Battery Energy Storage Systems (BESS), and capacitor banks.
 */

export interface DssBusLike {
  name: string;
  baseKv?: number | undefined;
  phases?: number | undefined;
  x?: number | undefined;
  y?: number | undefined;
  vm?: number | undefined;
}

export interface DssLineLike {
  name: string;
  bus1: string;
  bus2: string;
  phases: number;
  length: number;
  units?: string | undefined;
  current?: number | undefined;
  loading?: number | undefined; // fraction 0.0 - 1.5
}

export interface DssTransformerLike {
  name: string;
  buses: string[];
  kvs: number[];
  kvas?: number[] | undefined;
}

export interface DssLoadLike {
  name?: string | undefined;
  id?: string | undefined;
  bus?: string | undefined;
  bus1?: string | undefined;
  kw?: number | undefined;
  kvar?: number | undefined;
  phases?: number | undefined;
}

export interface DssPvSystemLike {
  name?: string | undefined;
  id?: string | undefined;
  bus?: string | undefined;
  bus1?: string | undefined;
  kw?: number | undefined;
  pmpp?: number | undefined;
  kva?: number | undefined;
  pf?: number | undefined;
}

export interface DssStorageLike {
  name?: string | undefined;
  id?: string | undefined;
  bus?: string | undefined;
  bus1?: string | undefined;
  kwh?: number | undefined;
  kw?: number | undefined;
}

export interface DssBusLike {
  name: string;
  x?: number | undefined;
  y?: number | undefined;
  kv?: number | undefined;
}

export interface DssDeckLike {
  circuit?: { name: string; baseKv: number; bus1: string; phases: number } | undefined;
  buses?: Map<string, DssBusLike> | DssBusLike[] | undefined;
  lines: Map<string, DssLineLike> | DssLineLike[];
  transformers?: Map<string, DssTransformerLike> | DssTransformerLike[] | undefined;
  loads?: Map<string, DssLoadLike> | DssLoadLike[] | undefined;
  pvSystems?: Map<string, DssPvSystemLike> | DssPvSystemLike[] | undefined;
  storages?: Map<string, DssStorageLike> | DssStorageLike[] | undefined;
}

export interface DssDiagramCell {
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

export interface DssDiagramGraph {
  title: string;
  cells: DssDiagramCell[];
}

export interface DssRenderOptions {
  theme?: "dark" | "light" | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

/**
 * Returns color coding for feeder lines based on phase conductor count.
 */
export function getPhaseColor(phases: number): string {
  if (phases >= 3) return "#38bdf8"; // 3-Phase Backbone Cyan
  if (phases === 2) return "#fb923c"; // 2-Phase V-Phase Orange
  return "#c084fc"; // Single-Phase Lateral Tap Purple
}

/**
 * Strips node sub-indices (e.g. "BusA.1.2.3" -> "BusA").
 */
export function cleanBusName(busRef: string): string {
  return busRef.split(".")[0]!.trim();
}

/**
 * Builds an interactive AntV X6 graph model for an OpenDSS distribution network.
 */
export function buildOpenDssDiagram(deck: DssDeckLike): DssDiagramGraph {
  const cells: DssDiagramCell[] = [];
  const linesList: DssLineLike[] = Array.isArray(deck.lines) ? deck.lines : Array.from(deck.lines.values());
  const xfmrsList: DssTransformerLike[] = deck.transformers
    ? Array.isArray(deck.transformers)
      ? deck.transformers
      : Array.from(deck.transformers.values())
    : [];
  const loadsList: DssLoadLike[] = deck.loads
    ? Array.isArray(deck.loads)
      ? deck.loads
      : Array.from(deck.loads.values())
    : [];
  const pvList: DssPvSystemLike[] = deck.pvSystems
    ? Array.isArray(deck.pvSystems)
      ? deck.pvSystems
      : Array.from(deck.pvSystems.values())
    : [];
  const storageList: DssStorageLike[] = deck.storages
    ? Array.isArray(deck.storages)
      ? deck.storages
      : Array.from(deck.storages.values())
    : [];

  const busSet = new Set<string>();
  if (deck.circuit) busSet.add(cleanBusName(deck.circuit.bus1));
  for (const l of linesList) {
    busSet.add(cleanBusName(l.bus1));
    busSet.add(cleanBusName(l.bus2));
  }
  for (const x of xfmrsList) {
    x.buses.forEach((b) => busSet.add(cleanBusName(b)));
  }

  // 1. Arrange buses using bus coordinates or topological feeder tree levels
  const busCoords = new Map<string, { x: number; y: number }>();
  const explicitCoords = new Map<string, { x: number; y: number }>();

  if (deck.buses) {
    const busEntries = Array.isArray(deck.buses) ? deck.buses : Array.from(deck.buses.values());
    for (const b of busEntries) {
      if (b.x !== undefined && b.y !== undefined) {
        explicitCoords.set(cleanBusName(b.name), { x: b.x, y: b.y });
      }
    }
  }

  if (explicitCoords.size > 0) {
    // Normalize coordinates to diagram canvas
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of explicitCoords.values()) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    for (const [bName, p] of explicitCoords) {
      const x = 100 + ((p.x - minX) / spanX) * 600;
      const y = 100 + ((p.y - minY) / spanY) * 350;
      busCoords.set(bName, { x, y });
    }
  }

  // Fallback to topological feeder tree layout if coordinates omitted
  if (busCoords.size === 0) {
    const rootBus = cleanBusName(deck.circuit?.bus1 ?? busSet.values().next().value ?? "SourceBus");
    const busNeighbors = new Map<string, string[]>();
    for (const b of busSet) busNeighbors.set(b, []);
    for (const l of linesList) {
      const b1 = cleanBusName(l.bus1);
      const b2 = cleanBusName(l.bus2);
      busNeighbors.get(b1)?.push(b2);
      busNeighbors.get(b2)?.push(b1);
    }
    for (const x of xfmrsList) {
      if (x.buses.length >= 2) {
        const b1 = cleanBusName(x.buses[0]!);
        const b2 = cleanBusName(x.buses[1]!);
        busNeighbors.get(b1)?.push(b2);
        busNeighbors.get(b2)?.push(b1);
      }
    }

    const levels = new Map<string, number>();
    const levelBuses = new Map<number, string[]>();
    const queue = [rootBus];
    levels.set(rootBus, 0);
    levelBuses.set(0, [rootBus]);

    while (queue.length > 0) {
      const cur = queue.shift()!;
      const curLvl = levels.get(cur)!;
      for (const nxt of busNeighbors.get(cur) ?? []) {
        if (!levels.has(nxt)) {
          levels.set(nxt, curLvl + 1);
          if (!levelBuses.has(curLvl + 1)) levelBuses.set(curLvl + 1, []);
          levelBuses.get(curLvl + 1)!.push(nxt);
          queue.push(nxt);
        }
      }
    }

    // Include any disconnected buses
    for (const b of busSet) {
      if (!levels.has(b)) {
        const lastLvl = levelBuses.size;
        levels.set(b, lastLvl);
        if (!levelBuses.has(lastLvl)) levelBuses.set(lastLvl, []);
        levelBuses.get(lastLvl)!.push(b);
      }
    }

    for (const [lvl, bNames] of levelBuses) {
      const x = 100 + lvl * 150;
      const count = bNames.length;
      bNames.forEach((bName, idx) => {
        const yOffset = (idx - (count - 1) / 2) * 80;
        const y = 200 + yOffset;
        busCoords.set(bName, { x, y });
      });
    }
  }

  // Create bus cells
  for (const bName of busSet) {
    const pos = busCoords.get(bName) ?? { x: 100, y: 200 };
    cells.push({
      id: `bus_${bName}`,
      shape: "rect",
      x: pos.x - 5,
      y: pos.y - 25,
      width: 10,
      height: 50,
      label: bName,
      attrs: {
        body: {
          fill: "#f8fafc",
          stroke: "#38bdf8",
          strokeWidth: 2,
        },
        label: {
          fill: "#f8fafc",
          fontSize: 9,
          refY: -8,
        },
      },
      data: { busName: bName },
    });
  }

  // 2. Add Transformers
  for (const xfmr of xfmrsList) {
    if (xfmr.buses.length < 2) continue;
    const b1 = cleanBusName(xfmr.buses[0]!);
    const b2 = cleanBusName(xfmr.buses[1]!);
    const p1 = busCoords.get(b1);
    const p2 = busCoords.get(b2);
    if (!p1 || !p2) continue;

    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2;

    cells.push({
      id: `xfmr_${xfmr.name}`,
      shape: "rect",
      x: mx - 20,
      y: my - 20,
      width: 40,
      height: 40,
      label: `XFMR\n${xfmr.name}`,
      attrs: {
        body: {
          fill: "#1e293b",
          stroke: "#f59e0b",
          strokeWidth: 2,
          rx: 4,
          ry: 4,
        },
        label: { fill: "#f59e0b", fontSize: 8 },
      },
      data: { xfmrName: xfmr.name, kvs: xfmr.kvs },
    });
  }

  // 3. Add Feeder Lines
  for (const line of linesList) {
    const b1 = cleanBusName(line.bus1);
    const b2 = cleanBusName(line.bus2);
    if (!busCoords.has(b1) || !busCoords.has(b2)) continue;

    const strokeColor = getPhaseColor(line.phases);
    cells.push({
      id: `line_${line.name}`,
      shape: "edge",
      source: { cell: `bus_${b1}` },
      target: { cell: `bus_${b2}` },
      label: `${line.name} (${line.phases}Φ)`,
      attrs: {
        line: {
          stroke: strokeColor,
          strokeWidth: Math.max(1.5, Math.min(5, line.phases * 1.5)),
        },
        label: { fill: "#94a3b8", fontSize: 8 },
      },
      data: { lineName: line.name, phases: line.phases, length: line.length },
    });
  }

  // 4. Add Loads
  for (const l of loadsList) {
    const bName = cleanBusName(l.bus ?? l.bus1 ?? "");
    const p = busCoords.get(bName);
    if (!p) continue;

    const lName = l.name ?? l.id ?? "load";
    const loadId = `load_${lName}`;
    const loadKw = l.kw ?? 0;
    cells.push({
      id: loadId,
      shape: "rect",
      x: p.x + 15,
      y: p.y + 40,
      width: 32,
      height: 24,
      label: `${loadKw}kW`,
      attrs: {
        body: { fill: "#0f172a", stroke: "#ef4444", strokeWidth: 1.5, rx: 2, ry: 2 },
        label: { fill: "#fca5a5", fontSize: 8 },
      },
    });

    cells.push({
      id: `wire_${loadId}`,
      shape: "edge",
      source: { cell: `bus_${bName}` },
      target: { cell: loadId },
      attrs: { line: { stroke: "#ef4444", strokeWidth: 1.5 } },
    });
  }

  // 5. Add DER Solar PV
  for (const pv of pvList) {
    const bName = cleanBusName(pv.bus ?? pv.bus1 ?? "");
    const p = busCoords.get(bName);
    if (!p) continue;

    const pvName = pv.name ?? pv.id ?? "pv";
    const pvId = `pv_${pvName}`;
    const pvKw = pv.kw ?? pv.pmpp ?? pv.kva ?? 0;
    cells.push({
      id: pvId,
      shape: "circle",
      x: p.x + 15,
      y: p.y - 65,
      width: 28,
      height: 28,
      label: `PV\n${pvKw}k`,
      attrs: {
        body: { fill: "#064e3b", stroke: "#10b981", strokeWidth: 2 },
        label: { fill: "#6ee7b7", fontSize: 8 },
      },
    });

    cells.push({
      id: `wire_${pvId}`,
      shape: "edge",
      source: { cell: `bus_${bName}` },
      target: { cell: pvId },
      attrs: { line: { stroke: "#10b981", strokeWidth: 1.5 } },
    });
  }

  // 6. Add BESS Energy Storage
  for (const bess of storageList) {
    const bName = cleanBusName(bess.bus ?? bess.bus1 ?? "");
    const p = busCoords.get(bName);
    if (!p) continue;

    const bessName = bess.name ?? bess.id ?? "bess";
    const bessId = `bess_${bessName}`;
    cells.push({
      id: bessId,
      shape: "rect",
      x: p.x - 45,
      y: p.y - 65,
      width: 32,
      height: 26,
      label: `BESS\n${bess.kw ?? 0}k`,
      attrs: {
        body: { fill: "#312e81", stroke: "#818cf8", strokeWidth: 2, rx: 2, ry: 2 },
        label: { fill: "#c7d2fe", fontSize: 8 },
      },
    });

    cells.push({
      id: `wire_${bessId}`,
      shape: "edge",
      source: { cell: `bus_${bName}` },
      target: { cell: bessId },
      attrs: { line: { stroke: "#818cf8", strokeWidth: 1.5 } },
    });
  }

  return {
    title: deck.circuit ? `Circuit.${deck.circuit.name}` : "OpenDSS Distribution Grid",
    cells,
  };
}

/**
 * Emits a standalone SVG single-line diagram for an OpenDSS distribution network.
 */
export function renderOpenDssSvg(deck: DssDeckLike, options?: DssRenderOptions): string {
  const diag = buildOpenDssDiagram(deck);
  const isDark = options?.theme !== "light";
  const bg = isDark ? "#0b0f19" : "#f8fafc";
  const textColor = isDark ? "#f8fafc" : "#0f172a";
  const subTextColor = isDark ? "#94a3b8" : "#64748b";

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const cellMap = new Map<string, DssDiagramCell>();
  for (const c of diag.cells) {
    cellMap.set(c.id, c);
    if (c.x !== undefined && c.y !== undefined) {
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x + (c.width ?? 40));
      maxY = Math.max(maxY, c.y + (c.height ?? 40));
    }
  }

  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 800;
    maxY = 600;
  }

  const pad = 60;
  const vbX = Math.floor(minX - pad);
  const vbY = Math.floor(minY - pad);
  const vbW = Math.max(options?.width ?? 0, Math.ceil(maxX - minX + 2 * pad));
  const vbH = Math.max(options?.height ?? 0, Math.ceil(maxY - minY + 2 * pad));

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="100%" height="100%" style="background:${bg};font-family:Inter,system-ui,sans-serif;">\n`;

  // Title Banner
  svg += `  <text x="${vbX + pad}" y="${vbY + 30}" fill="${textColor}" font-size="16" font-weight="700">${diag.title}</text>\n`;
  svg += `  <text x="${vbX + pad}" y="${vbY + 46}" fill="${subTextColor}" font-size="10">ModelScript Distribution Single-Line Diagram (SLD)</text>\n`;

  // 1. Lines Layer
  svg += `  <g id="feeder-lines">\n`;
  for (const c of diag.cells) {
    if (c.shape === "edge" && c.source && c.target) {
      const srcId = typeof c.source === "object" && "cell" in c.source ? c.source.cell : null;
      const tgtId = typeof c.target === "object" && "cell" in c.target ? c.target.cell : null;
      if (!srcId || !tgtId) continue;

      const src = cellMap.get(srcId);
      const tgt = cellMap.get(tgtId);
      if (!src || !tgt || src.x === undefined || tgt.x === undefined) continue;

      const x1 = src.x + (src.width ?? 10) / 2;
      const y1 = src.y! + (src.height ?? 50) / 2;
      const x2 = tgt.x + (tgt.width ?? 10) / 2;
      const y2 = tgt.y! + (tgt.height ?? 50) / 2;

      const color = (c.attrs?.["line"]?.["stroke"] as string | undefined) ?? "#38bdf8";
      const strokeWidth = (c.attrs?.["line"]?.["strokeWidth"] as number | undefined) ?? 2;

      svg += `    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round">\n`;
      svg += `      <title>Line: ${c.label ?? ""}</title>\n`;
      svg += `    </line>\n`;

      if (c.label && !c.id.startsWith("wire_")) {
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        svg += `    <text x="${midX}" y="${midY - 6}" fill="${subTextColor}" font-size="9" text-anchor="middle">${c.label}</text>\n`;
      }
    }
  }
  svg += `  </g>\n`;

  // 2. Nodes Layer
  svg += `  <g id="grid-nodes">\n`;
  for (const c of diag.cells) {
    if (c.shape === "rect" && c.x !== undefined && c.y !== undefined) {
      const w = c.width ?? 10;
      const h = c.height ?? 50;
      const fill = (c.attrs?.["body"]?.["fill"] as string | undefined) ?? "#f8fafc";
      const stroke = (c.attrs?.["body"]?.["stroke"] as string | undefined) ?? "#38bdf8";
      const strokeWidth = (c.attrs?.["body"]?.["strokeWidth"] as number | undefined) ?? 2;

      svg += `    <g>\n`;
      svg += `      <rect x="${c.x}" y="${c.y}" width="${w}" height="${h}" rx="2" ry="2" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />\n`;
      if (c.label) {
        svg += `      <text x="${c.x + w / 2}" y="${c.y - 6}" fill="${textColor}" font-size="9" font-weight="600" text-anchor="middle">${c.label}</text>\n`;
      }
      svg += `    </g>\n`;
    } else if (c.shape === "circle" && c.x !== undefined && c.y !== undefined) {
      const r = (c.width ?? 28) / 2;
      const cx = c.x + r;
      const cy = c.y + r;
      const fill = (c.attrs?.["body"]?.["fill"] as string | undefined) ?? "#064e3b";
      const stroke = (c.attrs?.["body"]?.["stroke"] as string | undefined) ?? "#10b981";

      svg += `    <g>\n`;
      svg += `      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2" />\n`;
      if (c.label) {
        svg += `      <text x="${cx}" y="${cy + 3}" fill="#6ee7b7" font-size="8" font-weight="bold" text-anchor="middle">${c.label.split("\n")[0]}</text>\n`;
      }
      svg += `    </g>\n`;
    }
  }
  svg += `  </g>\n`;

  // 3. Phase Legend
  const legX = vbX + pad;
  const legY = vbY + vbH - 30;
  svg += `  <g id="phase-legend" transform="translate(${legX}, ${legY})">\n`;
  svg += `    <text x="0" y="0" fill="${subTextColor}" font-size="10" font-weight="600">Phases:</text>\n`;
  svg += `    <line x1="50" y1="-3" x2="70" y2="-3" stroke="#38bdf8" stroke-width="3" />\n`;
  svg += `    <text x="75" y="0" fill="${subTextColor}" font-size="9">3-Phase (3Φ)</text>\n`;
  svg += `    <line x1="150" y1="-3" x2="170" y2="-3" stroke="#fb923c" stroke-width="2" />\n`;
  svg += `    <text x="175" y="0" fill="${subTextColor}" font-size="9">2-Phase (2Φ)</text>\n`;
  svg += `    <line x1="250" y1="-3" x2="270" y2="-3" stroke="#c084fc" stroke-width="1.5" />\n`;
  svg += `    <text x="275" y="0" fill="${subTextColor}" font-size="9">1-Phase Lateral (1Φ)</text>\n`;
  svg += `  </g>\n`;

  svg += `</svg>\n`;
  return svg;
}
