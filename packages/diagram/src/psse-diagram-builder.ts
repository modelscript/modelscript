// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PSS/E Single-Line Diagram (SLD) Builder.
 *
 * Translates PSS/E base cases into AntV X6 diagram graphs and standalone SVGs
 * with voltage-level color coding, Sugiyama barycenter crossing minimization,
 * IEEE/IEC electrical equipment symbols (Synchronous Generators, Wind/Solar IBRs,
 * Synchronous Condensers, Shunt Capacitor/Reactor Banks, 2W/3W Transformers, HVDC),
 * and AC power-flow telemetry overlays.
 */

export interface PsseBusLike {
  i: number;
  name: string;
  baseKv: number;
  ide: number;
  vm?: number | undefined;
  va?: number | undefined;
  nvhi?: number | undefined;
  nvlo?: number | undefined;
  evhi?: number | undefined;
  evlo?: number | undefined;
  area?: number | undefined;
  zone?: number | undefined;
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
  windv2?: number | undefined;
  ang1?: number | undefined;
  r12?: number | undefined;
  x12?: number | undefined;
  sbase12?: number | undefined;
  stat: number;
}

export interface PsseGeneratorLike {
  i: number;
  id: string;
  pg: number;
  qg: number;
  qt?: number | undefined;
  qb?: number | undefined;
  vs?: number | undefined;
  mbase?: number | undefined;
  pt?: number | undefined;
  pb?: number | undefined;
  stat: number;
}

export interface PsseLoadLike {
  i: number;
  id: string;
  pl: number;
  ql: number;
  ip?: number | undefined;
  iq?: number | undefined;
  yp?: number | undefined;
  yq?: number | undefined;
  status: number;
}

export interface PsseFixedShuntLike {
  i: number;
  id: string;
  status: number;
  gl: number;
  bl: number;
}

export interface PsseSwitchedShuntLike {
  i: number;
  modsw?: number | undefined;
  stat: number;
  vswhi?: number | undefined;
  vswlo?: number | undefined;
  binit: number;
}

export interface PsseTwoTerminalDcLike {
  i?: number | undefined;
  name?: string | undefined;
  mdc: number;
  rcomp?: number | undefined;
  setvl?: number | undefined;
  vschd?: number | undefined;
  ipr?: number | undefined;
  ipi?: number | undefined;
}

export interface PsseVscDcLike {
  name: string;
  mdc: number;
  ibus1?: number | undefined;
  ibus2?: number | undefined;
}

/**
 * Supports both PssePowerFlowOverlay (`pGen`, `qGen`, `pLoad`, `qLoad`)
 * and `BusPowerFlowResult` from `@modelscript/psse` (`pgMw`, `qgMvar`, `plMw`, `qlMvar`).
 */
export interface PsseBusPowerFlowOverlay {
  busNumber: number;
  vm: number;
  va: number;
  pGen?: number | undefined;
  qGen?: number | undefined;
  pLoad?: number | undefined;
  qLoad?: number | undefined;
  pgMw?: number | undefined;
  qgMvar?: number | undefined;
  plMw?: number | undefined;
  qlMvar?: number | undefined;
}

/**
 * Supports both PssePowerFlowOverlay (`pFrom`, `qFrom`, `pTo`, `qTo`, `pLoss`, `qLoss`, `loadingPct`)
 * and `BranchPowerFlowResult` from `@modelscript/psse` (`pFromMw`, `qFromMvar`, `pToMw`, `qToMvar`, `lossMw`, `lossMvar`, `loadingPercent`).
 */
export interface PsseBranchPowerFlowOverlay {
  fromBus: number;
  toBus: number;
  ckt: string;
  pFrom?: number | undefined;
  qFrom?: number | undefined;
  pTo?: number | undefined;
  qTo?: number | undefined;
  pLoss?: number | undefined;
  qLoss?: number | undefined;
  loadingPct?: number | undefined;
  pFromMw?: number | undefined;
  qFromMvar?: number | undefined;
  pToMw?: number | undefined;
  qToMvar?: number | undefined;
  lossMw?: number | undefined;
  lossMvar?: number | undefined;
  mvaFlow?: number | undefined;
  loadingPercent?: number | undefined;
}

export interface PssePowerFlowOverlay {
  converged: boolean;
  iterations?: number | undefined;
  maxMismatch?: number | undefined;
  totalGenMw?: number | undefined;
  totalLoadMw?: number | undefined;
  totalLossMw?: number | undefined;
  buses: PsseBusPowerFlowOverlay[];
  branches: PsseBranchPowerFlowOverlay[];
}

export type PsseSldOverlayMode = "powerflow" | "impedance" | "voltage" | "shortcircuit";

export interface PsseCaseLike {
  title1?: string | undefined;
  sbase?: number | undefined;
  buses: Map<number, PsseBusLike> | PsseBusLike[];
  branches: PsseBranchLike[];
  transformers?: PsseTransformerLike[] | undefined;
  generators?: PsseGeneratorLike[] | undefined;
  loads?: PsseLoadLike[] | undefined;
  fixedShunts?: PsseFixedShuntLike[] | undefined;
  switchedShunts?: PsseSwitchedShuntLike[] | undefined;
  twoTerminalDc?: PsseTwoTerminalDcLike[] | undefined;
  vscDc?: PsseVscDcLike[] | undefined;
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

export type PsseGenKind = "sync" | "wind" | "solar" | "condenser";

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

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface NormalizedBusPf {
  busNumber: number;
  vm: number;
  va: number;
  pGen: number;
  qGen: number;
  pLoad: number;
  qLoad: number;
}

interface NormalizedBranchPf {
  fromBus: number;
  toBus: number;
  ckt: string;
  pFrom: number;
  qFrom: number;
  pTo: number;
  qTo: number;
  pLoss: number;
  qLoss: number;
  mvaFlow: number;
  loadingPct: number;
}

function normalizeBusPf(b: PsseBusPowerFlowOverlay): NormalizedBusPf {
  return {
    busNumber: b.busNumber,
    vm: b.vm ?? 1.0,
    va: b.va ?? 0.0,
    pGen: b.pGen ?? b.pgMw ?? 0.0,
    qGen: b.qGen ?? b.qgMvar ?? 0.0,
    pLoad: b.pLoad ?? b.plMw ?? 0.0,
    qLoad: b.qLoad ?? b.qlMvar ?? 0.0,
  };
}

function normalizeBranchPf(br: PsseBranchPowerFlowOverlay): NormalizedBranchPf {
  const pFrom = br.pFrom ?? br.pFromMw ?? 0.0;
  const qFrom = br.qFrom ?? br.qFromMvar ?? 0.0;
  const pTo = br.pTo ?? br.pToMw ?? -pFrom;
  const qTo = br.qTo ?? br.qToMvar ?? -qFrom;
  const pLoss = br.pLoss ?? br.lossMw ?? Math.abs(pFrom + pTo);
  const qLoss = br.qLoss ?? br.lossMvar ?? Math.abs(qFrom + qTo);
  const mvaFlow = br.mvaFlow ?? Math.hypot(pFrom, qFrom);
  const loadingPct = br.loadingPct ?? br.loadingPercent ?? 0.0;
  return {
    fromBus: br.fromBus,
    toBus: br.toBus,
    ckt: br.ckt,
    pFrom,
    qFrom,
    pTo,
    qTo,
    pLoss,
    qLoss,
    mvaFlow,
    loadingPct,
  };
}

/**
 * Classifies a generator into Synchronous, Wind IBR, Solar PV IBR, or Synchronous Condenser
 * based on its machine ID, host bus name, and active/reactive power limits.
 */
export function classifyGeneratorKind(g: PsseGeneratorLike, busName?: string): PsseGenKind {
  const idUpper = g.id.trim().toUpperCase();
  const nameUpper = (busName ?? "").toUpperCase();

  if (
    idUpper.startsWith("W") ||
    nameUpper.includes("WIND") ||
    nameUpper.includes("WTG") ||
    nameUpper.includes("OFFSHORE")
  ) {
    return "wind";
  }
  if (idUpper.startsWith("S") && !idUpper.startsWith("SC") && !idUpper.startsWith("SYNC")) {
    return "solar";
  }
  if (
    idUpper.startsWith("PV") ||
    nameUpper.includes("SOLAR") ||
    nameUpper.includes("PV") ||
    nameUpper.includes("BESS")
  ) {
    return "solar";
  }
  if (
    idUpper.startsWith("SC") ||
    idUpper.startsWith("CS") ||
    nameUpper.includes("COND") ||
    (Math.abs(g.pg) < 0.05 && Math.abs(g.qg) > 0.1 && (g.pt === undefined || Math.abs(g.pt) < 0.05))
  ) {
    return "condenser";
  }
  return "sync";
}

/**
 * Sugiyama barycenter ordering within voltage-level rows to minimize edge crossings.
 */
function orderRowsByBarycenter(rows: PsseBusLike[][], neighbors: Map<number, number[]>): void {
  if (rows.length <= 1 && (rows[0]?.length ?? 0) <= 2) return;

  const getRowPosMap = (): Map<number, { row: number; col: number }> => {
    const map = new Map<number, { row: number; col: number }>();
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!;
      for (let c = 0; c < row.length; c++) {
        map.set(row[c]!.i, { row: r, col: c });
      }
    }
    return map;
  };

  for (let pass = 0; pass < 4; pass++) {
    // Top-down sweep
    for (let r = 1; r < rows.length; r++) {
      const posMap = getRowPosMap();
      const row = rows[r]!;
      if (row.length <= 1) continue;
      const weights = new Map<number, number>();
      row.forEach((b, idx) => {
        const nbrs = neighbors.get(b.i) ?? [];
        const adjCols: number[] = [];
        for (const nb of nbrs) {
          const p = posMap.get(nb);
          if (p && p.row <= r) {
            adjCols.push(p.col);
          }
        }
        const avg = adjCols.length > 0 ? adjCols.reduce((a, v) => a + v, 0) / adjCols.length : idx;
        weights.set(b.i, avg);
      });
      row.sort((a, b) => (weights.get(a.i) ?? 0) - (weights.get(b.i) ?? 0) || a.i - b.i);
    }

    // Bottom-up sweep
    for (let r = rows.length - 2; r >= 0; r--) {
      const posMap = getRowPosMap();
      const row = rows[r]!;
      if (row.length <= 1) continue;
      const weights = new Map<number, number>();
      row.forEach((b, idx) => {
        const nbrs = neighbors.get(b.i) ?? [];
        const adjCols: number[] = [];
        for (const nb of nbrs) {
          const p = posMap.get(nb);
          if (p && p.row >= r) {
            adjCols.push(p.col);
          }
        }
        const avg = adjCols.length > 0 ? adjCols.reduce((a, v) => a + v, 0) / adjCols.length : idx;
        weights.set(b.i, avg);
      });
      row.sort((a, b) => (weights.get(a.i) ?? 0) - (weights.get(b.i) ?? 0) || a.i - b.i);
    }
  }
}

export interface PsseViewportOptions {
  /** Optional world-coordinate bounding box for frustum culling (`[minX, minY, maxX, maxY]`). */
  viewport?: { minX: number; minY: number; maxX: number; maxY: number } | undefined;
  /** Zoom level (`1.0` = 100%). At `zoom < 0.45`, LOD mode suppresses secondary text labels and equipment sub-nodes. */
  zoom?: number | undefined;
  /** Maximum number of buses to emit in full SVG/X6 mode before enabling LOD simplification. Default: 500. */
  lodBusThreshold?: number | undefined;
}

export interface PsseCanvasBusNode {
  busNumber: number;
  name: string;
  baseKv: number;
  x: number;
  y: number;
  width?: number | undefined;
  height?: number | undefined;
  color: string;
  vm: number;
  va: number;
  status: "normal" | "warning" | "violation";
}

export interface PsseCanvasEdge {
  id?: string | undefined;
  fromBus: number;
  toBus: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  loadingPct: number;
  isTransformer: boolean;
  dashed?: boolean | undefined;
  label?: string | undefined;
}

export interface PsseCanvasScene {
  title: string;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  buses: PsseCanvasBusNode[];
  edges: PsseCanvasEdge[];
}

/**
 * Builds an interactive AntV X6 graph model for a PSS/E base case,
 * optionally overlaid with solved AC power-flow telemetry (voltages, angles,
 * generator dispatch, branch MW/Mvar flows, and thermal loading percentages)
 * and optional viewport frustum culling / Level-of-Detail (LOD) simplification.
 */
export function buildPsseDiagram(
  c: PsseCaseLike,
  powerflow?: PssePowerFlowOverlay,
  options?: PsseViewportOptions,
): PsseDiagramGraph {
  const cells: PsseDiagramCell[] = [];
  const pf = powerflow ?? c.powerflow;
  const pfBusMap = new Map<number, NormalizedBusPf>();
  const pfBranchMap = new Map<string, NormalizedBranchPf>();

  if (pf?.buses) {
    for (const b of pf.buses) {
      pfBusMap.set(b.busNumber, normalizeBusPf(b));
    }
  }
  if (pf?.branches) {
    for (const br of pf.branches) {
      const norm = normalizeBranchPf(br);
      const ckt = norm.ckt.trim() || "1";
      const key = `${norm.fromBus}_${norm.toBus}_${ckt}`;
      if (!pfBranchMap.has(key)) {
        pfBranchMap.set(key, norm);
      }
      const revKey = `${norm.toBus}_${norm.fromBus}_${ckt}`;
      if (!pfBranchMap.has(revKey)) {
        pfBranchMap.set(revKey, {
          ...norm,
          fromBus: norm.toBus,
          toBus: norm.fromBus,
          pFrom: norm.pTo,
          qFrom: norm.qTo,
          pTo: norm.pFrom,
          qTo: norm.qFrom,
        });
      }
    }
  }

  const busList: PsseBusLike[] = Array.isArray(c.buses) ? c.buses : Array.from(c.buses.values());
  const busMap = new Map<number, PsseBusLike>();
  for (const b of busList) {
    busMap.set(b.i, b);
  }

  // Build adjacency map for Sugiyama crossing minimization
  const neighbors = new Map<number, number[]>();
  const addNeighbor = (u: number, v: number): void => {
    if (!u || !v || u === v) return;
    let listU = neighbors.get(u);
    if (!listU) {
      listU = [];
      neighbors.set(u, listU);
    }
    if (!listU.includes(v)) listU.push(v);

    let listV = neighbors.get(v);
    if (!listV) {
      listV = [];
      neighbors.set(v, listV);
    }
    if (!listV.includes(u)) listV.push(u);
  };

  for (const br of c.branches) {
    if (br.st === 1) addNeighbor(br.i, br.j);
  }
  if (c.transformers) {
    for (const t of c.transformers) {
      if (t.stat !== 0) {
        addNeighbor(t.i, t.j);
        if (t.k) {
          addNeighbor(t.i, t.k);
          addNeighbor(t.j, t.k);
        }
      }
    }
  }

  // Count in-service generators per bus so solved bus generation can be apportioned
  const inServiceGensByBus = new Map<number, PsseGeneratorLike[]>();
  if (c.generators) {
    for (const g of c.generators) {
      if (g.stat === 1) {
        const arr = inServiceGensByBus.get(g.i) ?? [];
        arr.push(g);
        inServiceGensByBus.set(g.i, arr);
      }
    }
  }

  const inServiceLoadsByBus = new Map<number, PsseLoadLike[]>();
  if (c.loads) {
    for (const l of c.loads) {
      if (l.status === 1) {
        const arr = inServiceLoadsByBus.get(l.i) ?? [];
        arr.push(l);
        inServiceLoadsByBus.set(l.i, arr);
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
    const maxCols = busList.length <= 16 ? 4 : Math.min(32, Math.max(6, Math.ceil(Math.sqrt(busList.length * 2.2))));
    const rows: PsseBusLike[][] = [];
    for (const tier of rawTiers) {
      if (tier.length <= maxCols) {
        rows.push([...tier]);
      } else {
        const perRow = Math.min(maxCols, Math.ceil(tier.length / Math.ceil(tier.length / maxCols)));
        for (let i = 0; i < tier.length; i += perRow) {
          rows.push(tier.slice(i, i + perRow));
        }
      }
    }

    // Apply Sugiyama barycenter ordering within rows to minimize crossings
    orderRowsByBarycenter(rows, neighbors);

    const startY = 150;
    const rowSpacingY = 230;
    const busSpacingX = 250;

    for (let rIdx = 0; rIdx < rows.length; rIdx++) {
      const rowBuses = rows[rIdx]!;
      const yBase = startY + rIdx * rowSpacingY;
      const rowWidth = (rowBuses.length - 1) * busSpacingX;
      const startX = Math.max(160, Math.round(540 - rowWidth / 2) + (rIdx % 2 === 1 && rowBuses.length > 1 ? 35 : 0));

      for (let bIdx = 0; bIdx < rowBuses.length; bIdx++) {
        const b = rowBuses[bIdx]!;
        const x = startX + bIdx * busSpacingX;
        // Slight vertical stagger on middle buses in a wide row so horizontal tie-lines don't overlap busbars
        const staggerY = rowBuses.length >= 3 && bIdx % 2 === 1 ? 30 : 0;
        busCoords.set(b.i, { x, y: yBase + staggerY });
      }
    }
  }

  const vp = options?.viewport;
  const vpMargin = 200;
  const lodThreshold = options?.lodBusThreshold ?? 500;
  const isLowDetail = (options?.zoom !== undefined && options.zoom < 0.45) || busList.length > lodThreshold;

  const isPointInViewport = (x: number, y: number): boolean => {
    if (!vp) return true;
    return x >= vp.minX - vpMargin && x <= vp.maxX + vpMargin && y >= vp.minY - vpMargin && y <= vp.maxY + vpMargin;
  };

  const visibleBusSet = new Set<number>();

  for (const b of busList) {
    const pos = busCoords.get(b.i) ?? { x: 200, y: 200 };
    const x = pos.x;
    const y = pos.y;
    if (!isPointInViewport(x, y)) continue;
    visibleBusSet.add(b.i);

    const pfBus = pfBusMap.get(b.i);
    const vm = pfBus?.vm ?? b.vm;
    const va = pfBus?.va ?? b.va;

    const voltageColor = getVoltageColor(b.baseKv);
    let strokeColor = voltageColor;
    let fillColor = "#1e293b";
    let voltageStatus: "normal" | "warning" | "violation" = "normal";

    // Respect bus-specific normal (nvlo/nvhi) and emergency (evlo/evhi) voltage limits
    const nvlo = b.nvlo && b.nvlo > 0 ? b.nvlo : 0.95;
    const nvhi = b.nvhi && b.nvhi > 0 ? b.nvhi : 1.05;
    const evlo = b.evlo && b.evlo > 0 ? b.evlo : Math.min(0.9, nvlo - 0.03);
    const evhi = b.evhi && b.evhi > 0 ? b.evhi : Math.max(1.1, nvhi + 0.03);

    if (vm !== undefined && vm > 0) {
      if (vm < evlo || vm > evhi || vm < 0.92 || vm > 1.08) {
        strokeColor = "#ef4444"; // Emergency Voltage Violation Red
        fillColor = "#3b1219";
        voltageStatus = "violation";
      } else if (vm < nvlo || vm > nvhi) {
        fillColor = "#2e2111";
        voltageStatus = "warning";
      }
    }

    const typeLabel = b.ide === 3 ? "Slack" : b.ide === 2 ? "PV" : b.ide === 4 ? "Isolated" : "PQ";
    const vmText = vm !== undefined && vm > 0 ? ` · ${vm.toFixed(3)} pu` : "";
    const vaText = va !== undefined && (pfBus !== undefined || Math.abs(va) > 1e-3) ? ` ∠${va.toFixed(1)}°` : "";
    const busLabel = isLowDetail
      ? `Bus ${b.i}`
      : `Bus ${b.i}: ${b.name.trim()}\n${formatKv(b.baseKv)} (${typeLabel}${vmText}${vaText})`;

    cells.push({
      id: `bus_${b.i}`,
      shape: "rect",
      x: x - 78,
      y: y - 20,
      width: 156,
      height: 40,
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
        busName: b.name.trim(),
        baseKv: b.baseKv,
        voltageColor,
        busType: b.ide,
        vm,
        va,
        nvlo,
        nvhi,
        evlo,
        evhi,
        voltageStatus,
      },
    });
  }

  // 2. Add Generators attached above buses (fanning out multiple units per bus)
  if (!isLowDetail) {
    for (const [busNum, gens] of inServiceGensByBus.entries()) {
      if (!visibleBusSet.has(busNum)) continue;
      const bPos = busCoords.get(busNum);
      if (!bPos) continue;
      const hostBus = busMap.get(busNum);
      const pfBus = pfBusMap.get(busNum);
      const genCount = gens.length;

      // Total nominal pg for proportional sharing when solved pfBus is present
      const totalSchedPg = gens.reduce((acc, g) => acc + Math.abs(g.pg), 0);
      const totalSchedQg = gens.reduce((acc, g) => acc + Math.abs(g.qg), 0);

      gens.forEach((g, idx) => {
        const pShare = totalSchedPg > 1e-3 ? Math.abs(g.pg) / totalSchedPg : 1 / genCount;
        const qShare = totalSchedQg > 1e-3 ? Math.abs(g.qg) / totalSchedQg : 1 / genCount;
        const pGen = pfBus ? pfBus.pGen * pShare : g.pg;
        const qGen = pfBus ? pfBus.qGen * qShare : g.qg;

        const genIdClean = g.id.trim() || "1";
        const genNodeId = `gen_${g.i}_${genIdClean}`;
        const offsetX = genCount > 1 ? (idx - (genCount - 1) / 2) * 72 : 0;
        const gx = bPos.x + offsetX;
        const gy = bPos.y - 74;

        const genKind = classifyGeneratorKind(g, hostBus?.name);
        const kindBadge =
          genKind === "wind" ? "WTG" : genKind === "solar" ? "PV" : genKind === "condenser" ? "SC" : "G~";
        const strokeColor = genKind === "condenser" ? "#38bdf8" : genKind === "solar" ? "#10b981" : "#22c55e";

        const qSign = qGen >= 0 ? "+" : "";
        const genPrefix =
          genIdClean.toUpperCase() === kindBadge.toUpperCase() ? kindBadge : `${kindBadge} ${genIdClean}`;
        const genLabel = `${genPrefix} · ${pGen.toFixed(1)} MW\n${qSign}${qGen.toFixed(1)} Mvar`;

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
              stroke: strokeColor,
              strokeWidth: 2.5,
            },
            label: {
              text: genLabel,
              fill: genKind === "condenser" ? "#7dd3fc" : "#4ade80",
              fontSize: 8.5,
              fontWeight: "bold",
              fontFamily: "Inter, system-ui, sans-serif",
            },
          },
          data: {
            busNumber: g.i,
            generatorId: genIdClean,
            genKind,
            pGen,
            qGen,
            mbase: g.mbase ?? 100,
          },
        });

        // Connecting lead from generator to bus
        cells.push({
          id: `wire_${genNodeId}_to_bus_${g.i}`,
          shape: "edge",
          source: { cell: genNodeId },
          target: { cell: `bus_${g.i}` },
          attrs: {
            line: {
              stroke: strokeColor,
              strokeWidth: 2,
              targetMarker: null,
              sourceMarker: null,
            },
          },
        });
      });
    }

    // 3. Add Loads attached below buses
    for (const [busNum, loads] of inServiceLoadsByBus.entries()) {
      if (!visibleBusSet.has(busNum)) continue;
      const bPos = busCoords.get(busNum);
      if (!bPos) continue;
      const loadCount = loads.length;

      loads.forEach((l, idx) => {
        const loadIdClean = l.id.trim() || "1";
        const loadNodeId = `load_${l.i}_${loadIdClean}`;
        const offsetX = loadCount > 1 ? (idx - (loadCount - 1) / 2) * 92 : 0;
        const lx = bPos.x + offsetX;
        const ly = bPos.y + 68;
        const loadLabel = `Load ${l.pl.toFixed(1)} MW\n${l.ql.toFixed(1)} Mvar`;

        cells.push({
          id: loadNodeId,
          shape: "rect",
          x: lx - 42,
          y: ly - 15,
          width: 84,
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
          data: {
            busNumber: l.i,
            loadId: loadIdClean,
            pl: l.pl,
            ql: l.ql,
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
      });
    }

    // 3b. Add Fixed & Switched Shunt Capacitor / Reactor Banks
    interface ShuntEntry {
      id: string;
      bus: number;
      shuntId: string;
      bMvar: number;
      gMw: number;
      isSwitched: boolean;
    }
    const shuntsByBus = new Map<number, ShuntEntry[]>();
    if (c.fixedShunts) {
      for (const s of c.fixedShunts) {
        if (s.status !== 1 || !visibleBusSet.has(s.i)) continue;
        const arr = shuntsByBus.get(s.i) ?? [];
        const shuntIdClean = s.id.trim() || "1";
        arr.push({
          id: `shunt_${s.i}_${shuntIdClean}`,
          bus: s.i,
          shuntId: shuntIdClean,
          bMvar: s.bl,
          gMw: s.gl,
          isSwitched: false,
        });
        shuntsByBus.set(s.i, arr);
      }
    }
    if (c.switchedShunts) {
      for (const s of c.switchedShunts) {
        if (s.stat !== 1 || !visibleBusSet.has(s.i)) continue;
        const arr = shuntsByBus.get(s.i) ?? [];
        arr.push({
          id: `swshunt_${s.i}_SW`,
          bus: s.i,
          shuntId: "SW",
          bMvar: s.binit,
          gMw: 0,
          isSwitched: true,
        });
        shuntsByBus.set(s.i, arr);
      }
    }

    for (const [busNum, shunts] of shuntsByBus.entries()) {
      const bPos = busCoords.get(busNum);
      if (!bPos) continue;
      const hasLoadOnBus = (inServiceLoadsByBus.get(busNum)?.length ?? 0) > 0;

      shunts.forEach((sh, idx) => {
        // Place shunt bank to the bottom-right if bus already has a load below it, or directly below
        const sx = hasLoadOnBus ? bPos.x + 76 + idx * 66 : bPos.x + idx * 66;
        const sy = bPos.y + 66;
        const isCap = sh.bMvar >= 0;
        const typeTag = sh.isSwitched ? (isCap ? "SwCap" : "SwReac") : isCap ? "Cap" : "Reac";
        const sign = sh.bMvar >= 0 ? "+" : "";
        const shuntLabel = `${typeTag} ${sh.shuntId}\n${sign}${sh.bMvar.toFixed(1)} Mvar`;

        cells.push({
          id: sh.id,
          shape: "rect",
          x: sx - 32,
          y: sy - 15,
          width: 64,
          height: 30,
          label: shuntLabel,
          attrs: {
            body: {
              fill: "#0f172a",
              stroke: "#06b6d4",
              strokeWidth: 1.8,
              rx: 4,
              ry: 4,
            },
            label: {
              text: shuntLabel,
              fill: "#67e8f9",
              fontSize: 8.5,
              fontFamily: "Inter, system-ui, sans-serif",
            },
          },
          data: {
            busNumber: sh.bus,
            shuntId: sh.shuntId,
            bMvar: sh.bMvar,
            gMw: sh.gMw,
            isSwitched: sh.isSwitched,
          },
        });

        cells.push({
          id: `wire_bus_${sh.bus}_to_${sh.id}`,
          shape: "edge",
          source: { cell: `bus_${sh.bus}` },
          target: { cell: sh.id },
          attrs: {
            line: {
              stroke: "#06b6d4",
              strokeWidth: 1.8,
              targetMarker: null,
              sourceMarker: null,
            },
          },
        });
      });
    }
  }

  // Group parallel branches between the same bus pair so they can be offset cleanly
  const pairCounts = new Map<string, number>();
  const pairIndices = new Map<string, number>();
  for (const br of c.branches) {
    if (br.st !== 1) continue;
    if (!visibleBusSet.has(br.i) && !visibleBusSet.has(br.j)) continue;
    const pairKey = `${Math.min(br.i, br.j)}_${Math.max(br.i, br.j)}`;
    pairCounts.set(pairKey, (pairCounts.get(pairKey) ?? 0) + 1);
  }

  // Ensure any direct 1-hop endpoint bus of a partially-visible edge is also emitted into cells if viewport culling is active
  if (vp) {
    const initialVisibleBuses = new Set(visibleBusSet);
    const ensureEndpointBus = (busNum: number) => {
      if (visibleBusSet.has(busNum)) return;
      const b = busMap.get(busNum);
      const pos = busCoords.get(busNum);
      if (!b || !pos) return;
      visibleBusSet.add(busNum);
      const voltageColor = getVoltageColor(b.baseKv);
      const busLabel = isLowDetail ? `Bus ${b.i}` : `Bus ${b.i}: ${b.name.trim()}\n${formatKv(b.baseKv)}`;
      cells.push({
        id: `bus_${b.i}`,
        shape: "rect",
        x: pos.x - 78,
        y: pos.y - 20,
        width: 156,
        height: 40,
        label: busLabel,
        attrs: {
          body: {
            fill: "#1e293b",
            stroke: voltageColor,
            strokeWidth: 3,
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
          busName: b.name.trim(),
          baseKv: b.baseKv,
          voltageColor,
          busType: b.ide,
          voltageStatus: "normal",
        },
      });
    };

    for (const br of c.branches) {
      if (br.st !== 1) continue;
      if (initialVisibleBuses.has(br.i) !== initialVisibleBuses.has(br.j)) {
        ensureEndpointBus(br.i);
        ensureEndpointBus(br.j);
      }
    }
    if (c.transformers) {
      for (const t of c.transformers) {
        if (t.stat === 0) continue;
        if (initialVisibleBuses.has(t.i) !== initialVisibleBuses.has(t.j)) {
          ensureEndpointBus(t.i);
          ensureEndpointBus(t.j);
        }
      }
    }
  }

  // 4. Add AC Transmission Lines
  for (const br of c.branches) {
    if (br.st !== 1) continue;
    if (!visibleBusSet.has(br.i) || !visibleBusSet.has(br.j)) continue;
    const fromBus = busMap.get(br.i);
    if (!fromBus || !busCoords.has(br.i) || !busCoords.has(br.j)) continue;

    const cktId = br.ckt.trim() || "1";
    const pairKey = `${Math.min(br.i, br.j)}_${Math.max(br.i, br.j)}`;
    const parallelCount = pairCounts.get(pairKey) ?? 1;
    const parallelIndex = pairIndices.get(pairKey) ?? 0;
    pairIndices.set(pairKey, parallelIndex + 1);

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

    const cktBadge = parallelCount > 1 || cktId !== "1" ? ` #${cktId}` : "";
    const loadingSuffix = pfBr && pfBr.loadingPct > 0 ? ` [${pfBr.loadingPct.toFixed(0)}%]` : "";
    const edgeLabel = isLowDetail
      ? undefined
      : pfBr
        ? `${br.i}→${br.j}${cktBadge}: ${pfBr.pFrom.toFixed(1)} MW, ${pfBr.qFrom.toFixed(1)} Mvar${loadingSuffix}`
        : `${br.i}–${br.j}${cktBadge} (X=${br.x.toFixed(3)})`;

    cells.push({
      id: `branch_${br.i}_${br.j}_${cktId}`,
      shape: "edge",
      source: { cell: `bus_${br.i}` },
      target: { cell: `bus_${br.j}` },
      ...(edgeLabel
        ? {
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
          }
        : {}),
      attrs: {
        line: {
          stroke: color,
          strokeWidth,
          targetMarker: null,
          sourceMarker: null,
        },
      },
      data: {
        fromBus: br.i,
        toBus: br.j,
        ckt: cktId,
        r: br.r,
        x: br.x,
        b: br.b,
        rateA: br.rateA ?? 0,
        parallelIndex,
        parallelCount,
        ...(pfBr
          ? {
              pFrom: pfBr.pFrom,
              qFrom: pfBr.qFrom,
              pTo: pfBr.pTo,
              qTo: pfBr.qTo,
              pLoss: pfBr.pLoss,
              qLoss: pfBr.qLoss,
              mvaFlow: pfBr.mvaFlow,
              loadingPct: pfBr.loadingPct,
            }
          : {}),
      },
    });
  }

  // 5. Add Two-Winding / Three-Winding Transformers
  if (c.transformers) {
    for (const t of c.transformers) {
      if (t.stat === 0) continue;
      if (!visibleBusSet.has(t.i) || !visibleBusSet.has(t.j)) continue;
      if (!busCoords.has(t.i) || !busCoords.has(t.j)) continue;

      const cktId = t.ckt.trim() || "1";
      const pfXf = pfBranchMap.get(`${t.i}_${t.j}_${cktId}`);
      const tapStr = t.windv1 && Math.abs(t.windv1 - 1.0) > 1e-3 ? ` (${t.windv1.toFixed(3)}:1)` : "";
      const is3W = t.k !== undefined && t.k !== 0;
      const xfPrefix = is3W ? `3W-XFMR ${t.i}→${t.j}→${t.k}` : `XFMR ${t.i}→${t.j}`;
      const xfLabel = isLowDetail
        ? undefined
        : pfXf
          ? `${xfPrefix}${tapStr}: ${pfXf.pFrom.toFixed(1)} MW, ${pfXf.qFrom.toFixed(1)} Mvar`
          : `${xfPrefix}${tapStr}`;

      cells.push({
        id: `xfmr_${t.i}_${t.j}_${cktId}`,
        shape: "edge",
        source: { cell: `bus_${t.i}` },
        target: { cell: `bus_${t.j}` },
        ...(xfLabel
          ? {
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
            }
          : {}),
        attrs: {
          line: {
            stroke: "#ec4899",
            strokeWidth: 2.5,
            strokeDasharray: "6 3",
            targetMarker: null,
            sourceMarker: null,
          },
        },
        data: {
          fromBus: t.i,
          toBus: t.j,
          tertiaryBus: t.k ?? 0,
          ckt: cktId,
          windv1: t.windv1 ?? 1.0,
          windv2: t.windv2 ?? 1.0,
          x12: t.x12 ?? 0,
          ...(pfXf
            ? {
                pFrom: pfXf.pFrom,
                qFrom: pfXf.qFrom,
                loadingPct: pfXf.loadingPct,
              }
            : {}),
        },
      });

      // Render tertiary winding leg for 3-winding transformers
      if (is3W && t.k && visibleBusSet.has(t.k) && busCoords.has(t.k)) {
        const w3Label = isLowDetail ? undefined : `3W Tertiary ${t.i}→${t.k}`;
        cells.push({
          id: `xfmr_${t.i}_${t.k}_${cktId}_w3`,
          shape: "edge",
          source: { cell: `bus_${t.i}` },
          target: { cell: `bus_${t.k}` },
          ...(w3Label
            ? {
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
              }
            : {}),
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

  // 6. Add HVDC Links (Two-Terminal DC & VSC DC)
  if (c.twoTerminalDc) {
    for (const dc of c.twoTerminalDc) {
      if (dc.mdc === 0 || !dc.ipr || !dc.ipi) continue;
      if (!visibleBusSet.has(dc.ipr) || !visibleBusSet.has(dc.ipi)) continue;
      if (!busCoords.has(dc.ipr) || !busCoords.has(dc.ipi)) continue;
      const dcName = dc.name?.trim() || (dc.i !== undefined ? String(dc.i) : "1");
      const dcLabel = isLowDetail ? undefined : `HVDC ${dcName}: ${dc.ipr}⇒${dc.ipi}`;
      cells.push({
        id: `hvdc_${dc.ipr}_${dc.ipi}_${dcName}`,
        shape: "edge",
        source: { cell: `bus_${dc.ipr}` },
        target: { cell: `bus_${dc.ipi}` },
        ...(dcLabel ? { label: dcLabel } : {}),
        attrs: {
          line: {
            stroke: "#a855f7",
            strokeWidth: 2.8,
            strokeDasharray: "8 4",
          },
        },
        data: {
          fromBus: dc.ipr,
          toBus: dc.ipi,
          dcName,
          dcType: "LCC",
        },
      });
    }
  }
  if (c.vscDc) {
    for (const vsc of c.vscDc) {
      if (vsc.mdc === 0 || !vsc.ibus1 || !vsc.ibus2) continue;
      if (!visibleBusSet.has(vsc.ibus1) || !visibleBusSet.has(vsc.ibus2)) continue;
      if (!busCoords.has(vsc.ibus1) || !busCoords.has(vsc.ibus2)) continue;
      const vscLabel = isLowDetail ? undefined : `VSC-HVDC ${vsc.name.trim()}: ${vsc.ibus1}⇔${vsc.ibus2}`;
      cells.push({
        id: `vscdc_${vsc.ibus1}_${vsc.ibus2}_${vsc.name.trim() || "1"}`,
        shape: "edge",
        source: { cell: `bus_${vsc.ibus1}` },
        target: { cell: `bus_${vsc.ibus2}` },
        ...(vscLabel ? { label: vscLabel } : {}),
        attrs: {
          line: {
            stroke: "#c084fc",
            strokeWidth: 2.8,
            strokeDasharray: "8 4",
          },
        },
        data: {
          fromBus: vsc.ibus1,
          toBus: vsc.ibus2,
          dcName: vsc.name.trim(),
          dcType: "VSC",
        },
      });
    }
  }

  return {
    title: c.title1 || "PSS/E Single-Line Diagram",
    cells,
  };
}

/**
 * Builds a compact, flat Canvas 2D / WebGL scene descriptor for high-scale
 * PSS/E networks (5,000+ to 70,000+ buses) without allocating SVG DOM nodes.
 */
export function buildPsseCanvasScene(
  c: PsseCaseLike,
  powerflow?: PssePowerFlowOverlay,
  options?: PsseViewportOptions,
): PsseCanvasScene {
  const diag = buildPsseDiagram(c, powerflow, options);
  const buses: PsseCanvasBusNode[] = [];
  const edges: PsseCanvasEdge[] = [];
  const busCenterMap = new Map<string, { x: number; y: number }>();

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const cell of diag.cells) {
    if (cell.id.startsWith("bus_") && cell.x !== undefined && cell.y !== undefined) {
      const w = cell.width ?? 156;
      const h = cell.height ?? 40;
      const cx = cell.x + w / 2;
      const cy = cell.y + h / 2;
      busCenterMap.set(cell.id, { x: cx, y: cy });

      if (cell.x < minX) minX = cell.x;
      if (cell.y < minY) minY = cell.y;
      if (cell.x + w > maxX) maxX = cell.x + w;
      if (cell.y + h > maxY) maxY = cell.y + h;

      const busNum = (cell.data?.["busNumber"] as number | undefined) ?? Number(cell.id.slice(4));
      buses.push({
        busNumber: busNum,
        name: (cell.data?.["busName"] as string | undefined) ?? `Bus ${busNum}`,
        x: cx,
        y: cy,
        width: w,
        height: h,
        baseKv: (cell.data?.["baseKv"] as number | undefined) ?? 138,
        color: (cell.data?.["voltageColor"] as string | undefined) ?? "#38bdf8",
        vm: (cell.data?.["vm"] as number | undefined) ?? 1.0,
        va: (cell.data?.["va"] as number | undefined) ?? 0.0,
        status: (cell.data?.["voltageStatus"] as "normal" | "warning" | "violation" | undefined) ?? "normal",
      });
    }
  }

  for (const cell of diag.cells) {
    if (cell.shape === "edge" && cell.source && cell.target && !cell.id.startsWith("wire_")) {
      const srcId = typeof cell.source === "object" && "cell" in cell.source ? cell.source.cell : undefined;
      const tgtId = typeof cell.target === "object" && "cell" in cell.target ? cell.target.cell : undefined;
      if (!srcId || !tgtId) continue;
      const p1 = busCenterMap.get(srcId);
      const p2 = busCenterMap.get(tgtId);
      if (!p1 || !p2) continue;

      const color = (cell.attrs?.["line"]?.["stroke"] as string | undefined) ?? "#38bdf8";
      const width = (cell.attrs?.["line"]?.["strokeWidth"] as number | undefined) ?? 2;
      const dashed = Boolean(cell.attrs?.["line"]?.["strokeDasharray"]);

      edges.push({
        id: cell.id,
        fromBus: (cell.data?.["fromBus"] as number | undefined) ?? 0,
        toBus: (cell.data?.["toBus"] as number | undefined) ?? 0,
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        color,
        width,
        dashed,
        loadingPct: (cell.data?.["loadingPct"] as number | undefined) ?? 0.0,
        isTransformer: cell.id.startsWith("xfmr_"),
        label: cell.label,
      });
    }
  }

  if (!isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 800;
    maxY = 600;
  }

  return {
    title: diag.title,
    bounds: { minX, minY, maxX, maxY },
    buses,
    edges,
  };
}

/**
 * Renders standalone SVG markup for a PSS/E base case with IEEE/IEC power
 * symbols, substation busbars, interlocking transformer coils, and haloed
 * telemetry badges.
 */
export function renderPsseSvg(
  c: PsseCaseLike,
  powerflow?: PssePowerFlowOverlay,
  options?: PsseViewportOptions,
): string {
  const diag = buildPsseDiagram(c, powerflow, options);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const cellMap = new Map<string, PsseDiagramCell>();
  for (const cell of diag.cells) {
    cellMap.set(cell.id, cell);
    if (cell.x !== undefined && cell.y !== undefined) {
      if (cell.x < minX) minX = cell.x;
      // Account for generator top callout pill above circle
      const topExtra = cell.shape === "circle" ? 28 : 0;
      if (cell.y - topExtra < minY) minY = cell.y - topExtra;
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

  const pad = 64;
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
  svg += `    <pattern id="sld-grid" width="40" height="40" patternUnits="userSpaceOnUse">\n`;
  svg += `      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e293b" stroke-width="0.6" opacity="0.45" />\n`;
  svg += `    </pattern>\n`;
  svg += `  </defs>\n`;
  svg += `  <style>\n`;
  svg += `    .bus-text { font-family: Inter, system-ui, sans-serif; fill: #f8fafc; font-size: 10px; font-weight: 600; pointer-events: none; }\n`;
  svg += `    .bus-subtext { font-family: Inter, system-ui, sans-serif; fill: #cbd5e1; font-size: 9.5px; font-weight: 500; pointer-events: none; }\n`;
  svg += `    .gen-text { font-family: Inter, system-ui, sans-serif; fill: #4ade80; font-size: 9px; font-weight: bold; pointer-events: none; }\n`;
  svg += `    .load-text { font-family: Inter, system-ui, sans-serif; fill: #fbbf24; font-size: 9px; font-weight: 600; pointer-events: none; }\n`;
  svg += `    .shunt-text { font-family: Inter, system-ui, sans-serif; fill: #67e8f9; font-size: 8.5px; font-weight: 600; pointer-events: none; }\n`;
  svg += `    .edge-text { font-family: Inter, system-ui, sans-serif; fill: #e2e8f0; font-size: 9px; font-weight: 500; pointer-events: none; }\n`;
  svg += `    .xfmr-text { font-family: Inter, system-ui, sans-serif; fill: #f9a8d4; font-size: 9px; font-weight: 600; pointer-events: none; }\n`;
  svg += `    .sld-edge { transition: all 0.2s ease; cursor: pointer; }\n`;
  svg += `    .sld-edge:hover line, .sld-edge:hover path.edge-main { stroke-width: 4.5px !important; filter: drop-shadow(0 0 6px rgba(255,255,255,0.8)); }\n`;
  svg += `    .sld-edge.selected line, .sld-edge.selected path.edge-main { stroke: #facc15 !important; stroke-width: 4px !important; filter: drop-shadow(0 0 8px #facc15); }\n`;
  svg += `    .sld-node { transition: all 0.2s ease; cursor: pointer; }\n`;
  svg += `    .sld-node:hover rect.node-body { stroke-width: 3.5px !important; filter: drop-shadow(0 0 8px #38bdf8); }\n`;
  svg += `    .sld-node:hover circle { stroke-width: 3px !important; filter: drop-shadow(0 0 8px #22c55e); }\n`;
  svg += `    .sld-node.selected rect.node-body { stroke: #facc15 !important; stroke-width: 4px !important; filter: drop-shadow(0 0 10px #facc15); }\n`;
  svg += `    .sld-node.selected circle { stroke: #facc15 !important; stroke-width: 3.5px !important; filter: drop-shadow(0 0 10px #facc15); }\n`;
  svg += `  </style>\n`;
  svg += `  <rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="url(#sld-grid)" pointer-events="none" />\n`;

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
        svg += `    <line id="${cell.id}" x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="0.75" />\n`;
      } else if (cell.id.startsWith("xfmr_")) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const nx = -uy;

        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        const coilOffset = 7.5;
        const coilR = 9;
        const c1x = (midX - ux * coilOffset).toFixed(1);
        const c1y = (midY - uy * coilOffset).toFixed(1);
        const c2x = (midX + ux * coilOffset).toFixed(1);
        const c2y = (midY + uy * coilOffset).toFixed(1);

        svg += `    <g id="${cell.id}" class="sld-edge xfmr-line">\n`;
        svg += `      <line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="${stroke}" stroke-width="${strokeWidth}" ${strokeDash} />\n`;
        // Opaque dark mask behind transformer windings so dashed line doesn't cut through coils
        svg += `      <circle cx="${c1x}" cy="${c1y}" r="${coilR + 1.5}" fill="#0b0f19" />\n`;
        svg += `      <circle cx="${c2x}" cy="${c2y}" r="${coilR + 1.5}" fill="#0b0f19" />\n`;
        svg += `      <circle cx="${c1x}" cy="${c1y}" r="${coilR}" fill="none" stroke="${stroke}" stroke-width="2" />\n`;
        svg += `      <circle cx="${c2x}" cy="${c2y}" r="${coilR}" fill="none" stroke="${stroke}" stroke-width="2" />\n`;
        if (cell.label) {
          const safeLabel = escapeXml(cell.label);
          const pillW = Math.max(76, cell.label.length * 5.6 + 14);
          // Offset label perpendicular to the branch or above it so it never collides with coils
          const labelX = midX + (Math.abs(uy) > 0.7 ? 62 : nx * 20);
          const labelY = midY + (Math.abs(uy) > 0.7 ? 0 : -20);
          svg += `      <rect x="${(labelX - pillW / 2).toFixed(1)}" y="${(labelY - 10).toFixed(1)}" width="${pillW.toFixed(1)}" height="15" rx="4" fill="#0f172a" stroke="${stroke}" stroke-width="1" opacity="0.95" />\n`;
          svg += `      <text x="${labelX.toFixed(1)}" y="${(labelY + 1).toFixed(1)}" text-anchor="middle" class="xfmr-text">${safeLabel}</text>\n`;
        }
        svg += `    </g>\n`;
      } else {
        // Transmission branch line (or HVDC link)
        const parallelCount = (cell.data?.["parallelCount"] as number | undefined) ?? 1;
        const parallelIndex = (cell.data?.["parallelIndex"] as number | undefined) ?? 0;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const nx = -uy;
        const ny = ux;

        const offsetDist = parallelCount > 1 ? (parallelIndex - (parallelCount - 1) / 2) * 18 : 0;
        const x1 = p1.x + nx * offsetDist;
        const y1 = p1.y + ny * offsetDist;
        const x2 = p2.x + nx * offsetDist;
        const y2 = p2.y + ny * offsetDist;
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;

        // Flow direction arrow along line
        const pFrom = cell.data?.["pFrom"] as number | undefined;
        const dirSign = pFrom !== undefined && pFrom < 0 ? -1 : 1;
        const arrowX = midX + ux * 36 * dirSign;
        const arrowY = midY + uy * 36 * dirSign;
        const angleDeg = (Math.atan2(uy * dirSign, ux * dirSign) * 180) / Math.PI;

        svg += `    <g id="${cell.id}" class="sld-edge branch-line">\n`;
        svg += `      <line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}" stroke-width="${strokeWidth}" ${strokeDash} />\n`;
        // Directional flow chevron
        if (len > 110) {
          svg += `      <polygon points="-5,-3.5 5,0 -5,3.5" fill="${stroke}" transform="translate(${arrowX.toFixed(1)},${arrowY.toFixed(1)}) rotate(${angleDeg.toFixed(1)})" opacity="0.9" />\n`;
        }
        if (cell.label) {
          const safeLabel = escapeXml(cell.label);
          const pillW = Math.max(78, cell.label.length * 5.4 + 14);
          const pillY = midY - 12;
          svg += `      <rect x="${(midX - pillW / 2).toFixed(1)}" y="${pillY.toFixed(1)}" width="${pillW.toFixed(1)}" height="16" rx="4" fill="#0f172a" stroke="${stroke}" stroke-width="0.9" opacity="0.94" />\n`;
          svg += `      <text x="${midX.toFixed(1)}" y="${(pillY + 11).toFixed(1)}" text-anchor="middle" class="edge-text">${safeLabel}</text>\n`;
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
        // Generator / IBR / Synchronous Condenser node
        const cx = cell.x + w / 2;
        const cy = cell.y + h / 2;
        const r = w / 2;
        const genKind = (cell.data?.["genKind"] as PsseGenKind | undefined) ?? "sync";
        const stroke = (cell.attrs?.["body"]?.["stroke"] as string | undefined) ?? "#22c55e";

        svg += `    <g id="${cell.id}" class="sld-node gen-node" data-gen-kind="${genKind}">\n`;
        svg += `      <circle cx="${cx}" cy="${cy}" r="${r}" fill="#0f172a" stroke="${stroke}" stroke-width="2.2" />\n`;

        if (genKind === "wind") {
          // Wind Turbine Generator icon + AC wave
          svg += `      <circle cx="${cx}" cy="${cy - 2}" r="2.2" fill="${stroke}" />\n`;
          svg += `      <path d="M ${cx} ${cy - 2} L ${cx} ${cy - 14} M ${cx} ${cy - 2} L ${cx - 10} ${cy + 5} M ${cx} ${cy - 2} L ${cx + 10} ${cy + 5}" stroke="${stroke}" stroke-width="2" stroke-linecap="round" />\n`;
          svg += `      <path d="M ${cx - 8} ${cy + 13} Q ${cx - 4} ${cy + 9}, ${cx} ${cy + 13} T ${cx + 8} ${cy + 13}" fill="none" stroke="${stroke}" stroke-width="1.6" />\n`;
        } else if (genKind === "solar") {
          // Solar PV Inverter icon
          svg += `      <rect x="${cx - 10}" y="${cy - 11}" width="20" height="12" rx="1.5" fill="none" stroke="${stroke}" stroke-width="1.6" />\n`;
          svg += `      <line x1="${cx - 10}" y1="${cy - 5}" x2="${cx + 10}" y2="${cy - 5}" stroke="${stroke}" stroke-width="1.1" />\n`;
          svg += `      <line x1="${cx - 3.5}" y1="${cy - 11}" x2="${cx - 3.5}" y2="${cy + 1}" stroke="${stroke}" stroke-width="1.1" />\n`;
          svg += `      <line x1="${cx + 3.5}" y1="${cy - 11}" x2="${cx + 3.5}" y2="${cy + 1}" stroke="${stroke}" stroke-width="1.1" />\n`;
          svg += `      <path d="M ${cx - 8} ${cy + 10} Q ${cx - 4} ${cy + 6}, ${cx} ${cy + 10} T ${cx + 8} ${cy + 10}" fill="none" stroke="${stroke}" stroke-width="1.6" />\n`;
        } else if (genKind === "condenser") {
          // Synchronous Condenser (SC + sine wave)
          svg += `      <text x="${cx}" y="${cy - 2}" text-anchor="middle" class="gen-text" style="fill:${stroke};font-size:10px;">SC</text>\n`;
          svg += `      <path d="M ${cx - 9} ${cy + 8} Q ${cx - 4.5} ${cy + 3}, ${cx} ${cy + 8} T ${cx + 9} ${cy + 8}" fill="none" stroke="${stroke}" stroke-width="1.8" />\n`;
        } else {
          // Standard Synchronous Generator (crisp AC sine wave + ~)
          svg += `      <path d="M ${cx - 10} ${cy} Q ${cx - 5} ${cy - 7}, ${cx} ${cy} T ${cx + 10} ${cy}" fill="none" stroke="${stroke}" stroke-width="2" />\n`;
          svg += `      <text x="${cx}" y="${cy + 13}" text-anchor="middle" class="gen-text" style="font-size:8px;opacity:0.85;">~</text>\n`;
        }

        // Always render generator callout badge above the circle so it never collides with lead wire
        if (cell.label) {
          const lines = cell.label.split("\n");
          const line0 = escapeXml(lines[0] ?? "");
          const line1 = lines[1] ? escapeXml(lines[1]) : "";
          const badgeH = line1 ? 26 : 15;
          const badgeW = Math.max(78, Math.max(lines[0]?.length ?? 0, lines[1]?.length ?? 0) * 5.5 + 12);
          const badgeY = cy - r - badgeH - 5;
          svg += `      <rect x="${(cx - badgeW / 2).toFixed(1)}" y="${badgeY.toFixed(1)}" width="${badgeW.toFixed(1)}" height="${badgeH}" rx="4" fill="#0f172a" stroke="${stroke}" stroke-width="1" opacity="0.95" />\n`;
          svg += `      <text x="${cx}" y="${(badgeY + 10.5).toFixed(1)}" text-anchor="middle" class="gen-text" style="fill:${genKind === "condenser" ? "#7dd3fc" : "#4ade80"};">${line0}</text>\n`;
          if (line1) {
            svg += `      <text x="${cx}" y="${(badgeY + 21.5).toFixed(1)}" text-anchor="middle" class="gen-text" style="fill:#86efac;font-weight:500;font-size:8.5px;">${line1}</text>\n`;
          }
        }
        svg += `    </g>\n`;
      } else if (cell.id.startsWith("load_")) {
        const stroke = (cell.attrs?.["body"]?.["stroke"] as string | undefined) ?? "#f59e0b";
        svg += `    <g id="${cell.id}" class="sld-node load-node">\n`;
        svg += `      <rect class="node-body" x="${cell.x}" y="${cell.y}" width="${w}" height="${h}" rx="4" fill="#0f172a" stroke="${stroke}" stroke-width="1.6" />\n`;
        if (cell.label) {
          const lines = cell.label.split("\n");
          let lineY = cell.y + 11.5;
          for (const l of lines) {
            svg += `      <text x="${cell.x + w / 2}" y="${lineY}" text-anchor="middle" class="load-text">${escapeXml(l)}</text>\n`;
            lineY += 11;
          }
        }
        svg += `    </g>\n`;
      } else if (cell.id.startsWith("shunt_") || cell.id.startsWith("swshunt_")) {
        const stroke = (cell.attrs?.["body"]?.["stroke"] as string | undefined) ?? "#06b6d4";
        const cx = cell.x + w / 2;
        svg += `    <g id="${cell.id}" class="sld-node shunt-node">\n`;
        // Capacitor plates symbol at top of shunt box
        svg += `      <line x1="${cx - 8}" y1="${cell.y - 5}" x2="${cx + 8}" y2="${cell.y - 5}" stroke="${stroke}" stroke-width="2" />\n`;
        svg += `      <line x1="${cx - 8}" y1="${cell.y - 2}" x2="${cx + 8}" y2="${cell.y - 2}" stroke="${stroke}" stroke-width="2" />\n`;
        svg += `      <rect class="node-body" x="${cell.x}" y="${cell.y}" width="${w}" height="${h}" rx="4" fill="#0f172a" stroke="${stroke}" stroke-width="1.6" />\n`;
        if (cell.label) {
          const lines = cell.label.split("\n");
          let lineY = cell.y + 11.5;
          for (const l of lines) {
            svg += `      <text x="${cx}" y="${lineY}" text-anchor="middle" class="shunt-text">${escapeXml(l)}</text>\n`;
            lineY += 11;
          }
        }
        svg += `    </g>\n`;
      } else {
        // Substation Busbar Node
        const stroke = (cell.attrs?.["body"]?.["stroke"] as string | undefined) ?? "#38bdf8";
        const voltageColor = (cell.data?.["voltageColor"] as string | undefined) ?? stroke;
        const fill = (cell.attrs?.["body"]?.["fill"] as string | undefined) ?? "#1e293b";
        const busNum = cell.data?.["busNumber"] ?? cell.id.replace("bus_", "");
        const voltageStatus = (cell.data?.["voltageStatus"] as string | undefined) ?? "normal";

        svg += `    <g id="${cell.id}" class="sld-node bus-node" data-bus="${busNum}">\n`;
        svg += `      <rect class="node-body" x="${cell.x}" y="${cell.y}" width="${w}" height="${h}" rx="5" fill="${fill}" stroke="${stroke}" stroke-width="2.5" />\n`;
        // Prominent substation busbar conductor rail along top edge in nominal voltage color
        svg += `      <line x1="${cell.x + 3}" y1="${cell.y + 2}" x2="${cell.x + w - 3}" y2="${cell.y + 2}" stroke="${voltageColor}" stroke-width="3.5" stroke-linecap="round" />\n`;
        if (voltageStatus === "warning" || voltageStatus === "violation") {
          const badgeColor = voltageStatus === "violation" ? "#ef4444" : "#f59e0b";
          svg += `      <circle cx="${cell.x + w - 9}" cy="${cell.y + 10}" r="3.5" fill="${badgeColor}" />\n`;
        }
        if (cell.label) {
          const lines = cell.label.split("\n");
          if (lines[0]) {
            svg += `      <text x="${cell.x + w / 2}" y="${cell.y + 15}" text-anchor="middle" class="bus-text">${escapeXml(lines[0])}</text>\n`;
          }
          if (lines[1]) {
            svg += `      <text x="${cell.x + w / 2}" y="${cell.y + 29}" text-anchor="middle" class="bus-subtext">${escapeXml(lines[1])}</text>\n`;
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
