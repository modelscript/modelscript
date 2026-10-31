// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PSS/E Single-Line Diagram (SLD) Builder.
 *
 * Translates PSS/E base cases into AntV X6 diagram graphs and standalone SVGs
 * with voltage-level color coding and standard electrical power symbols.
 */

export interface PsseBusLike {
  i: number;
  name: string;
  baseKv: number;
  ide: number;
  vm?: number | undefined;
  va?: number | undefined;
  position?: { x: number; y: number } | undefined;
}

export interface PsseBranchLike {
  i: number;
  j: number;
  ckt: string;
  r: number;
  x: number;
  b: number;
  rateA?: number | undefined;
  st: number;
}

export interface PsseTransformerLike {
  i: number;
  j: number;
  k?: number | undefined;
  ckt: string;
  windv1?: number | undefined;
  stat: number;
}

export interface PsseGeneratorLike {
  i: number;
  id: string;
  pg: number;
  qg: number;
  stat: number;
}

export interface PsseLoadLike {
  i: number;
  id: string;
  pl: number;
  ql: number;
  status: number;
}

export interface PsseBusPowerFlowOverlay {
  busNumber: number;
  vm: number;
  va: number;
  pGen: number;
  qGen: number;
  pLoad: number;
  qLoad: number;
}

export interface PsseBranchPowerFlowOverlay {
  fromBus: number;
  toBus: number;
  ckt: string;
  pFrom: number;
  qFrom: number;
  pTo: number;
  qTo: number;
  pLoss: number;
  qLoss: number;
  loadingPct: number;
}

export interface PssePowerFlowOverlay {
  converged: boolean;
  iterations?: number | undefined;
  maxMismatch?: number | undefined;
  buses: PsseBusPowerFlowOverlay[];
  branches: PsseBranchPowerFlowOverlay[];
}

export interface PsseCaseLike {
  title1?: string | undefined;
  buses: Map<number, PsseBusLike> | PsseBusLike[];
  branches: PsseBranchLike[];
  transformers?: PsseTransformerLike[] | undefined;
  generators?: PsseGeneratorLike[] | undefined;
  loads?: PsseLoadLike[] | undefined;
  powerflow?: PssePowerFlowOverlay | undefined;
}

export interface PsseDiagramCell {
  id: string;
  shape: string;
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  label?: string | undefined;
  labels?: Array<Record<string, unknown>> | undefined;
  source?: { cell: string; port?: string } | { x: number; y: number } | undefined;
  target?: { cell: string; port?: string } | { x: number; y: number } | undefined;
  vertices?: { x: number; y: number }[] | undefined;
  attrs?: Record<string, Record<string, unknown>> | undefined;
  data?: Record<string, unknown> | undefined;
}

export interface PsseDiagramGraph {
  title: string;
  cells: PsseDiagramCell[];
}

/**
 * Maps a nominal voltage to a standard transmission color.
 */
export function getVoltageColor(baseKv: number): string {
  if (baseKv >= 500) return "#E53935"; // 500 kV Red
  if (baseKv >= 230) return "#FB8C00"; // 230 kV Orange
  if (baseKv >= 115) return "#1E88E5"; // 138/115 kV Blue
  if (baseKv >= 60) return "#43A047"; // 69 kV Green
  return "#38BDF8"; // Distribution / Sub-transmission Cyan
}

function formatKv(baseKv: number): string {
  if (!baseKv || baseKv <= 0) return "138 kV";
  if (baseKv < 1.0) return `${(baseKv * 1000).toFixed(0)} V`;
  return Number.isInteger(baseKv) ? `${baseKv} kV` : `${baseKv.toFixed(1)} kV`;
}

/**
 * Builds an interactive AntV X6 graph model for a PSS/E base case,
 * optionally overlaid with solved AC power-flow telemetry (voltages, angles,
 * generator dispatch, branch MW/Mvar flows, and thermal loading percentages).
 */
export function buildPsseDiagram(c: PsseCaseLike, powerflow?: PssePowerFlowOverlay): PsseDiagramGraph {
  const cells: PsseDiagramCell[] = [];
  const pf = powerflow ?? c.powerflow;
  const pfBusMap = new Map<number, PsseBusPowerFlowOverlay>();
  const pfBranchMap = new Map<string, PsseBranchPowerFlowOverlay>();

  if (pf?.buses) {
    for (const b of pf.buses) {
      pfBusMap.set(b.busNumber, b);
    }
  }
  if (pf?.branches) {
    for (const br of pf.branches) {
      const key = `${br.fromBus}_${br.toBus}_${br.ckt.trim() || "1"}`;
      if (!pfBranchMap.has(key)) {
        pfBranchMap.set(key, br);
      }
    }
  }

  const busList: PsseBusLike[] = Array.isArray(c.buses) ? c.buses : Array.from(c.buses.values());
  const busMap = new Map<number, PsseBusLike>();
  for (const b of busList) {
    busMap.set(b.i, b);
  }

  // Count in-service generators per bus so solved bus generation can be apportioned
  const inServiceGenCountByBus = new Map<number, number>();
  if (c.generators) {
    for (const g of c.generators) {
      if (g.stat === 1) {
        inServiceGenCountByBus.set(g.i, (inServiceGenCountByBus.get(g.i) ?? 0) + 1);
      }
    }
  }

  // 1. Position and create bus nodes in voltage-level tiers (wrapping into rows of <= 4 buses)
  const hasExplicitPositions = busList.some((b) => b.position?.x !== undefined);
  const busCoords = new Map<number, { x: number; y: number }>();

  if (hasExplicitPositions) {
    for (const b of busList) {
      const x = b.position?.x ?? 200;
      const y = b.position?.y ?? 200;
      busCoords.set(b.i, { x, y });
    }
  } else {
    // Group buses into voltage-level tiers and wrap wide tiers into balanced multi-row bands
    const tier1: PsseBusLike[] = []; // >= 345 kV
    const tier2: PsseBusLike[] = []; // 161 - 344 kV
    const tier3: PsseBusLike[] = []; // 100 - 160 kV (e.g. 138 kV)
    const tier4: PsseBusLike[] = []; // 50 - 99 kV (e.g. 69 kV)
    const tier5: PsseBusLike[] = []; // < 50 kV

    for (const b of busList) {
      if (b.baseKv >= 345) tier1.push(b);
      else if (b.baseKv >= 161) tier2.push(b);
      else if (b.baseKv >= 100) tier3.push(b);
      else if (b.baseKv >= 50) tier4.push(b);
      else tier5.push(b);
    }

    const rawTiers = [tier1, tier2, tier3, tier4, tier5].filter((t) => t.length > 0);
    const maxCols = 4;
    const rows: PsseBusLike[][] = [];
    for (const tier of rawTiers) {
      if (tier.length <= maxCols) {
        rows.push(tier);
      } else {
        const perRow = Math.min(maxCols, Math.ceil(tier.length / Math.ceil(tier.length / maxCols)));
        for (let i = 0; i < tier.length; i += perRow) {
          rows.push(tier.slice(i, i + perRow));
        }
      }
    }

    const startY = 140;
    const rowSpacingY = 220;
    const busSpacingX = 240;

    for (let rIdx = 0; rIdx < rows.length; rIdx++) {
      const rowBuses = rows[rIdx]!;
      const yBase = startY + rIdx * rowSpacingY;
      const rowWidth = (rowBuses.length - 1) * busSpacingX;
      const startX = Math.max(150, Math.round(520 - rowWidth / 2) + (rIdx % 2 === 1 ? 45 : 0));

      for (let bIdx = 0; bIdx < rowBuses.length; bIdx++) {
        const b = rowBuses[bIdx]!;
        const x = startX + bIdx * busSpacingX;
        // Slight vertical stagger on middle buses in a row so horizontal tie-lines don't overlap busbars
        const staggerY = rowBuses.length >= 3 && bIdx % 2 === 1 ? 28 : 0;
        busCoords.set(b.i, { x, y: yBase + staggerY });
      }
    }
  }

  for (const b of busList) {
    const pos = busCoords.get(b.i) ?? { x: 200, y: 200 };
    const x = pos.x;
    const y = pos.y;
    const pfBus = pfBusMap.get(b.i);
    const vm = pfBus?.vm ?? b.vm;
    const va = pfBus?.va ?? b.va;

    let strokeColor = getVoltageColor(b.baseKv);
    let fillColor = "#1e293b";
    let voltageStatus: "normal" | "warning" | "violation" = "normal";

    if (vm !== undefined && vm > 0) {
      if (vm < 0.95 || vm > 1.05) {
        strokeColor = "#ef4444"; // ANSI C84.1 Emergency Violation Red
        fillColor = "#3b1219";
        voltageStatus = "violation";
      } else if (vm < 0.97 || vm > 1.03) {
        strokeColor = "#f59e0b"; // Near-limit Warning Amber
        fillColor = "#2e2111";
        voltageStatus = "warning";
      }
    }

    const typeLabel = b.ide === 3 ? "Slack" : b.ide === 2 ? "PV" : "PQ";
    const vmText = vm !== undefined && vm > 0 ? ` · ${vm.toFixed(3)} pu` : "";
    const vaText = va !== undefined && pfBus ? ` ∠${va.toFixed(1)}°` : "";
    const busLabel = `Bus ${b.i}: ${b.name.trim()}\n${formatKv(b.baseKv)} (${typeLabel}${vmText}${vaText})`;

    cells.push({
      id: `bus_${b.i}`,
      shape: "rect",
      x: x - 74,
      y: y - 19,
      width: 148,
      height: 38,
      label: busLabel,
      attrs: {
        body: {
          fill: fillColor,
          stroke: strokeColor,
          strokeWidth: voltageStatus === "violation" ? 3.5 : 3,
          rx: 5,
          ry: 5,
        },
        label: {
          text: busLabel,
          fill: "#f8fafc",
          fontSize: 10,
          fontWeight: "bold",
          fontFamily: "Inter, system-ui, sans-serif",
          textAnchor: "middle",
        },
      },
      data: {
        busNumber: b.i,
        baseKv: b.baseKv,
        busType: b.ide,
        vm,
        va,
        voltageStatus,
      },
    });
  }

  // 2. Add Generators attached above buses
  if (c.generators) {
    for (const g of c.generators) {
      if (g.stat !== 1) continue;
      const bPos = busCoords.get(g.i);
      if (!bPos) continue;

      const pfBus = pfBusMap.get(g.i);
      const genCount = inServiceGenCountByBus.get(g.i) ?? 1;
      const pGen = pfBus ? pfBus.pGen / genCount : g.pg;
      const qGen = pfBus ? pfBus.qGen / genCount : g.qg;

      const genNodeId = `gen_${g.i}_${g.id.trim() || "1"}`;
      const gx = bPos.x;
      const gy = bPos.y - 68;
      const genLabel = pfBus
        ? `G~ ${pGen.toFixed(1)} MW\n${qGen >= 0 ? "+" : ""}${qGen.toFixed(1)} Mvar`
        : `G~ (${g.pg.toFixed(0)} MW)`;

      cells.push({
        id: genNodeId,
        shape: "circle",
        x: gx - 24,
        y: gy - 24,
        width: 48,
        height: 48,
        label: genLabel,
        attrs: {
          body: {
            fill: "#0f172a",
            stroke: "#22c55e",
            strokeWidth: 2.5,
          },
          label: {
            text: genLabel,
            fill: "#4ade80",
            fontSize: 8.5,
            fontWeight: "bold",
            fontFamily: "Inter, system-ui, sans-serif",
          },
        },
        data: {
          busNumber: g.i,
          generatorId: g.id.trim() || "1",
          pGen,
          qGen,
        },
      });

      // Connecting lead from generator to bus (no directional arrowhead)
      cells.push({
        id: `wire_${genNodeId}_to_bus_${g.i}`,
        shape: "edge",
        source: { cell: genNodeId },
        target: { cell: `bus_${g.i}` },
        attrs: {
          line: {
            stroke: "#22c55e",
            strokeWidth: 2,
            targetMarker: null,
            sourceMarker: null,
          },
        },
      });
    }
  }

  // 3. Add Loads attached below buses
  if (c.loads) {
    for (const l of c.loads) {
      if (l.status !== 1) continue;
      const bPos = busCoords.get(l.i);
      if (!bPos) continue;

      const loadNodeId = `load_${l.i}_${l.id.trim() || "1"}`;
      const lx = bPos.x;
      const ly = bPos.y + 66;
      const loadLabel = `Load ${l.pl.toFixed(1)} MW\n${l.ql.toFixed(1)} Mvar`;

      cells.push({
        id: loadNodeId,
        shape: "rect",
        x: lx - 40,
        y: ly - 15,
        width: 80,
        height: 30,
        label: loadLabel,
        attrs: {
          body: {
            fill: "#0f172a",
            stroke: "#f59e0b",
            strokeWidth: 1.8,
            rx: 4,
            ry: 4,
          },
          label: {
            text: loadLabel,
            fill: "#fbbf24",
            fontSize: 9,
            fontFamily: "Inter, system-ui, sans-serif",
          },
        },
      });

      // Connecting feeder lead from bus to load
      cells.push({
        id: `wire_bus_${l.i}_to_${loadNodeId}`,
        shape: "edge",
        source: { cell: `bus_${l.i}` },
        target: { cell: loadNodeId },
        attrs: {
          line: {
            stroke: "#f59e0b",
            strokeWidth: 1.8,
            targetMarker: {
              name: "block",
              width: 6,
              height: 5,
            },
          },
        },
      });
    }
  }

  // 4. Add AC Transmission Lines
  for (const br of c.branches) {
    if (br.st !== 1) continue;
    const fromBus = busMap.get(br.i);
    if (!fromBus || !busCoords.has(br.i) || !busCoords.has(br.j)) continue;

    const cktId = br.ckt.trim() || "1";
    const pfBr = pfBranchMap.get(`${br.i}_${br.j}_${cktId}`);
    let color = getVoltageColor(fromBus.baseKv);
    let strokeWidth = 2.2;

    if (pfBr) {
      if (pfBr.loadingPct >= 100) {
        color = "#ef4444"; // Thermal Overload Red
        strokeWidth = 3.2;
      } else if (pfBr.loadingPct >= 80) {
        color = "#f59e0b"; // High Thermal Loading Amber
        strokeWidth = 2.8;
      }
    }

    const loadingSuffix = pfBr && pfBr.loadingPct > 0 ? ` [${pfBr.loadingPct.toFixed(0)}%]` : "";
    const edgeLabel = pfBr
      ? `${br.i}→${br.j}: ${pfBr.pFrom.toFixed(1)} MW, ${pfBr.qFrom.toFixed(1)} Mvar${loadingSuffix}`
      : `${br.i}–${br.j} (X=${br.x.toFixed(3)})`;

    cells.push({
      id: `branch_${br.i}_${br.j}_${cktId}`,
      shape: "edge",
      source: { cell: `bus_${br.i}` },
      target: { cell: `bus_${br.j}` },
      label: edgeLabel,
      labels: [
        {
          attrs: {
            text: {
              text: edgeLabel,
              fill: pfBr && pfBr.loadingPct >= 100 ? "#fecaca" : "#cbd5e1",
              fontSize: 9,
              fontFamily: "Inter, system-ui, sans-serif",
            },
            rect: {
              fill: "#0f172a",
              stroke: color,
              strokeWidth: 1,
              rx: 3,
              ry: 3,
            },
          },
          position: 0.5,
        },
      ],
      attrs: {
        line: {
          stroke: color,
          strokeWidth,
          targetMarker: null,
          sourceMarker: null,
        },
      },
      data: pfBr
        ? {
            fromBus: br.i,
            toBus: br.j,
            ckt: cktId,
            pFrom: pfBr.pFrom,
            qFrom: pfBr.qFrom,
            loadingPct: pfBr.loadingPct,
          }
        : undefined,
    });
  }

  // 5. Add Two-Winding / Three-Winding Transformers
  if (c.transformers) {
    for (const t of c.transformers) {
      if (t.stat !== 1) continue;
      if (!busCoords.has(t.i) || !busCoords.has(t.j)) continue;

      const cktId = t.ckt.trim() || "1";
      const pfXf = pfBranchMap.get(`${t.i}_${t.j}_${cktId}`);
      const tapStr = t.windv1 && Math.abs(t.windv1 - 1.0) > 1e-3 ? ` (${t.windv1.toFixed(3)}:1)` : "";
      const is3W = t.k !== undefined && t.k !== 0;
      const xfPrefix = is3W ? `3W-XFMR ${t.i}→${t.j}→${t.k}` : `XFMR ${t.i}→${t.j}`;
      const xfLabel = pfXf
        ? `${xfPrefix}${tapStr}: ${pfXf.pFrom.toFixed(1)} MW, ${pfXf.qFrom.toFixed(1)} Mvar`
        : `${xfPrefix}${tapStr}`;

      cells.push({
        id: `xfmr_${t.i}_${t.j}_${cktId}`,
        shape: "edge",
        source: { cell: `bus_${t.i}` },
        target: { cell: `bus_${t.j}` },
        label: xfLabel,
        labels: [
          {
            attrs: {
              text: {
                text: xfLabel,
                fill: "#f9a8d4",
                fontSize: 9,
                fontWeight: "bold",
                fontFamily: "Inter, system-ui, sans-serif",
              },
              rect: {
                fill: "#0f172a",
                stroke: "#ec4899",
                strokeWidth: 1.2,
                rx: 3,
                ry: 3,
              },
            },
            position: 0.5,
          },
        ],
        attrs: {
          line: {
            stroke: "#ec4899",
            strokeWidth: 2.5,
            strokeDasharray: "6 3",
            targetMarker: null,
            sourceMarker: null,
          },
        },
      });

      // Render tertiary winding leg for 3-winding transformers
      if (is3W && t.k && busCoords.has(t.k)) {
        const w3Label = `3W Tertiary ${t.i}→${t.k}`;
        cells.push({
          id: `xfmr_${t.i}_${t.k}_${cktId}_w3`,
          shape: "edge",
          source: { cell: `bus_${t.i}` },
          target: { cell: `bus_${t.k}` },
          label: w3Label,
          labels: [
            {
              attrs: {
                text: {
                  text: w3Label,
                  fill: "#f9a8d4",
                  fontSize: 8.5,
                  fontFamily: "Inter, system-ui, sans-serif",
                },
                rect: {
                  fill: "#0f172a",
                  stroke: "#ec4899",
                  strokeWidth: 1,
                  rx: 3,
                  ry: 3,
                },
              },
              position: 0.5,
            },
          ],
          attrs: {
            line: {
              stroke: "#ec4899",
              strokeWidth: 2,
              strokeDasharray: "4 3",
              targetMarker: null,
              sourceMarker: null,
            },
          },
        });
      }
    }
  }

  return {
    title: c.title1 || "PSS/E Single-Line Diagram",
    cells,
  };
}

/**
 * Renders standalone SVG markup for a PSS/E base case.
 */
export function renderPsseSvg(c: PsseCaseLike, powerflow?: PssePowerFlowOverlay): string {
  const diag = buildPsseDiagram(c, powerflow);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const cellMap = new Map<string, PsseDiagramCell>();
  for (const cell of diag.cells) {
    cellMap.set(cell.id, cell);
    if (cell.x !== undefined && cell.y !== undefined) {
      if (cell.x < minX) minX = cell.x;
      if (cell.y < minY) minY = cell.y;
      const w = cell.width ?? 80;
      const h = cell.height ?? 30;
      if (cell.x + w > maxX) maxX = cell.x + w;
      if (cell.y + h > maxY) maxY = cell.y + h;
    }
  }

  if (!isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 800;
    maxY = 600;
  }

  const pad = 60;
  const vbX = Math.round(minX - pad);
  const vbY = Math.round(minY - pad);
  const vbW = Math.round(maxX - minX + 2 * pad);
  const vbH = Math.round(maxY - minY + 2 * pad);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="100%" height="100%" style="background:#0b0f19;">\n`;
  svg += `  <defs>\n`;
  svg += `    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">\n`;
  svg += `      <feGaussianBlur stdDeviation="3" result="blur" />\n`;
  svg += `      <feComposite in="SourceGraphic" in2="blur" operator="over" />\n`;
  svg += `    </filter>\n`;
  svg += `  </defs>\n`;
  svg += `  <style>\n`;
  svg += `    .bus-text { font-family: Inter, system-ui, sans-serif; fill: #f8fafc; font-size: 10px; font-weight: 500; pointer-events: none; }\n`;
  svg += `    .gen-text { font-family: Inter, system-ui, sans-serif; fill: #22c55e; font-size: 9px; font-weight: bold; pointer-events: none; }\n`;
  svg += `    .load-text { font-family: Inter, system-ui, sans-serif; fill: #f59e0b; font-size: 9px; pointer-events: none; }\n`;
  svg += `    .edge-text { font-family: Inter, system-ui, sans-serif; fill: #94a3b8; font-size: 9px; pointer-events: none; }\n`;
  svg += `    .sld-edge { transition: all 0.2s ease; cursor: pointer; }\n`;
  svg += `    .sld-edge:hover line { stroke-width: 4.5px !important; filter: drop-shadow(0 0 6px rgba(255,255,255,0.8)); }\n`;
  svg += `    .sld-edge.selected line { stroke: #facc15 !important; stroke-width: 4px !important; filter: drop-shadow(0 0 8px #facc15); }\n`;
  svg += `    .sld-node { transition: all 0.2s ease; cursor: pointer; }\n`;
  svg += `    .sld-node:hover rect { stroke-width: 3.5px !important; filter: drop-shadow(0 0 8px #38bdf8); }\n`;
  svg += `    .sld-node:hover circle { stroke-width: 3px !important; filter: drop-shadow(0 0 8px #22c55e); }\n`;
  svg += `    .sld-node.selected rect { stroke: #facc15 !important; stroke-width: 4px !important; filter: drop-shadow(0 0 10px #facc15); }\n`;
  svg += `    .sld-node.selected circle { stroke: #facc15 !important; stroke-width: 3.5px !important; filter: drop-shadow(0 0 10px #facc15); }\n`;
  svg += `  </style>\n`;

  // Helper to get center of a cell
  function getCellCenter(id: string): { x: number; y: number } | null {
    const cell = cellMap.get(id);
    if (!cell || cell.x === undefined || cell.y === undefined) return null;
    return {
      x: cell.x + (cell.width ?? 80) / 2,
      y: cell.y + (cell.height ?? 20) / 2,
    };
  }

  // 1. Draw Edges / Lines layer (behind nodes)
  svg += `  <g id="sld-edges-layer">\n`;
  for (const cell of diag.cells) {
    if (cell.shape === "edge" && cell.source && cell.target) {
      const srcId = typeof cell.source === "object" && "cell" in cell.source ? cell.source.cell : null;
      const tgtId = typeof cell.target === "object" && "cell" in cell.target ? cell.target.cell : null;
      if (!srcId || !tgtId) continue;

      const p1 = getCellCenter(srcId);
      const p2 = getCellCenter(tgtId);
      if (!p1 || !p2) continue;

      const stroke = (cell.attrs?.["line"]?.["stroke"] as string | undefined) ?? "#38bdf8";
      const strokeWidth = (cell.attrs?.["line"]?.["strokeWidth"] as number | undefined) ?? 2;
      const rawDash = cell.attrs?.["line"]?.["strokeDasharray"] as string | undefined;
      const strokeDash = rawDash ? `stroke-dasharray="${rawDash}"` : "";

      if (cell.id.startsWith("wire_")) {
        svg += `    <line id="${cell.id}" x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="0.6" />\n`;
      } else if (cell.id.startsWith("xfmr_")) {
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        svg += `    <g id="${cell.id}" class="sld-edge xfmr-line">\n`;
        svg += `      <line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="${stroke}" stroke-width="${strokeWidth}" ${strokeDash} />\n`;
        svg += `      <circle cx="${midX - 6}" cy="${midY}" r="7" fill="none" stroke="${stroke}" stroke-width="1.5" />\n`;
        svg += `      <circle cx="${midX + 6}" cy="${midY}" r="7" fill="none" stroke="${stroke}" stroke-width="1.5" />\n`;
        if (cell.label) {
          svg += `      <text x="${midX}" y="${midY - 10}" text-anchor="middle" class="edge-text">${cell.label}</text>\n`;
        }
        svg += `    </g>\n`;
      } else {
        // Transmission branch line
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        svg += `    <g id="${cell.id}" class="sld-edge branch-line">\n`;
        svg += `      <line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="${stroke}" stroke-width="${strokeWidth}" />\n`;
        if (cell.label) {
          svg += `      <text x="${midX}" y="${midY - 6}" text-anchor="middle" class="edge-text">${cell.label}</text>\n`;
        }
        svg += `    </g>\n`;
      }
    }
  }
  svg += `  </g>\n`;

  // 2. Draw Nodes layer (on top of edges)
  svg += `  <g id="sld-nodes-layer">\n`;
  for (const cell of diag.cells) {
    if (cell.x !== undefined && cell.y !== undefined) {
      const w = cell.width ?? 80;
      const h = cell.height ?? 20;

      if (cell.shape === "circle") {
        const cx = cell.x + w / 2;
        const cy = cell.y + h / 2;
        const r = w / 2;
        svg += `    <g id="${cell.id}" class="sld-node gen-node">\n`;
        svg += `      <circle cx="${cx}" cy="${cy}" r="${r}" fill="#0f172a" stroke="#22c55e" stroke-width="2" />\n`;
        svg += `      <text x="${cx}" y="${cy + 3}" text-anchor="middle" class="gen-text">~</text>\n`;
        if (cell.label) {
          const lines = cell.label.split("\n");
          if (lines[1]) {
            svg += `      <text x="${cx}" y="${cy + r + 11}" text-anchor="middle" class="gen-text">${lines[1]}</text>\n`;
          }
        }
        svg += `    </g>\n`;
      } else if (cell.id.startsWith("load_")) {
        const stroke = (cell.attrs?.["body"]?.["stroke"] as string | undefined) ?? "#f59e0b";
        svg += `    <g id="${cell.id}" class="sld-node load-node">\n`;
        svg += `      <rect x="${cell.x}" y="${cell.y}" width="${w}" height="${h}" rx="3" fill="#0f172a" stroke="${stroke}" stroke-width="1.5" />\n`;
        if (cell.label) {
          const lines = cell.label.split("\n");
          let lineY = cell.y + 11;
          for (const l of lines) {
            svg += `      <text x="${cell.x + w / 2}" y="${lineY}" text-anchor="middle" class="load-text">${l}</text>\n`;
            lineY += 10;
          }
        }
        svg += `    </g>\n`;
      } else {
        // Bus node
        const stroke = (cell.attrs?.["body"]?.["stroke"] as string | undefined) ?? "#38bdf8";
        const busNum = cell.data?.["busNumber"] ?? cell.id.replace("bus_", "");
        svg += `    <g id="${cell.id}" class="sld-node bus-node" data-bus="${busNum}">\n`;
        svg += `      <rect x="${cell.x}" y="${cell.y}" width="${w}" height="${h}" rx="4" fill="#1e293b" stroke="${stroke}" stroke-width="2.5" />\n`;
        if (cell.label) {
          const lines = cell.label.split("\n");
          let lineY = cell.y + 12;
          for (const l of lines) {
            svg += `      <text x="${cell.x + w / 2}" y="${lineY}" text-anchor="middle" class="bus-text">${l}</text>\n`;
            lineY += 12;
          }
        }
        svg += `    </g>\n`;
      }
    }
  }
  svg += `  </g>\n`;

  svg += `</svg>\n`;
  return svg;
}

export const renderPsseSldSvg = renderPsseSvg;
