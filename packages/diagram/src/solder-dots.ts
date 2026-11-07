// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Topological Solder Dot Junction Engine for Schematics & Polyglot Diagrams.
// Detects connection convergence points where multiple lines share an anchor or intersection.

export interface SolderDot {
  id: string;
  x: number;
  y: number;
  color: string;
  edgeIds: [string, string] | string[];
}

export interface EdgePath {
  id: string;
  points: { x: number; y: number }[];
  color?: string | undefined;
  netId?: string | undefined;
  sourceKey?: string | undefined;
  targetKey?: string | undefined;
}

export interface ComputeSolderDotsOptions {
  cellSize?: number | undefined;
  tolerance?: number | undefined;
  portPoints?: { x: number; y: number }[] | undefined;
  componentBoxes?: { x: number; y: number; width: number; height: number }[] | undefined;
}

/**
 * Computes connected electrical net IDs for edges using Union-Find over their endpoint port keys.
 * Edges that share a common port endpoint belong to the same electrical net.
 */
export function computeEdgeNetIds(
  edges: {
    id: string;
    netId?: string | undefined;
    sourceKey?: string | undefined;
    targetKey?: string | undefined;
  }[],
): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.has(root) && parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    let curr = x;
    while (curr !== root) {
      const nxt = parent.get(curr)!;
      parent.set(curr, root);
      curr = nxt;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      if (ra < rb) parent.set(rb, ra);
      else parent.set(ra, rb);
    }
  };

  for (const e of edges) {
    if (e.netId) continue;
    if (e.sourceKey && !parent.has(e.sourceKey)) {
      parent.set(e.sourceKey, e.sourceKey);
    }
    if (e.targetKey && !parent.has(e.targetKey)) {
      parent.set(e.targetKey, e.targetKey);
    }
    if (e.sourceKey && e.targetKey) {
      union(e.sourceKey, e.targetKey);
    }
  }

  const result = new Map<string, string>();
  for (const e of edges) {
    if (e.netId) {
      result.set(e.id, e.netId);
    } else if (e.sourceKey) {
      result.set(e.id, find(e.sourceKey));
    } else if (e.targetKey) {
      result.set(e.id, find(e.targetKey));
    }
  }
  return result;
}

export function distToSegmentSquared(px: number, py: number, vx: number, vy: number, wx: number, wy: number): number {
  const l2 = (wx - vx) * (wx - vx) + (wy - vy) * (wy - vy);
  if (l2 === 0) return (px - vx) * (px - vx) + (py - vy) * (py - vy);
  const t = Math.max(0, Math.min(1, ((px - vx) * (wx - vx) + (py - vy) * (wy - vy)) / l2));
  const dx = px - (vx + t * (wx - vx));
  const dy = py - (vy + t * (wy - vy));
  return dx * dx + dy * dy;
}

/**
 * Computes solder junction dots for an array of edge paths using an O(V) spatial hash grid,
 * topological branch degree counting, and subpixel coordinate clustering.
 * When edges carry `netId` or `sourceKey`/`targetKey` metadata, junctions are only formed
 * between edges belonging to the same connected electrical net.
 */
export function computeSolderDots(
  edges: EdgePath[],
  optionsOrCellSize: number | ComputeSolderDotsOptions = 40,
): SolderDot[] {
  const opts: ComputeSolderDotsOptions =
    typeof optionsOrCellSize === "number" ? { cellSize: optionsOrCellSize } : optionsOrCellSize || {};

  const validEdges = edges.filter((e) => e.points && e.points.length >= 2);
  if (validEdges.length === 0) return [];

  const netIds = computeEdgeNetIds(validEdges);
  if (netIds.size > 0) {
    const groups = new Map<string, EdgePath[]>();
    for (const edge of validEdges) {
      const key = netIds.get(edge.id) ?? "";
      let list = groups.get(key);
      if (!list) {
        list = [];
        groups.set(key, list);
      }
      list.push(edge);
    }
    const allDots: SolderDot[] = [];
    for (const groupEdges of groups.values()) {
      if (groupEdges.length < 2) continue;
      allDots.push(...computeSolderDotsSingleNet(groupEdges, opts));
    }
    return allDots;
  }

  return computeSolderDotsSingleNet(validEdges, opts);
}

function computeSolderDotsSingleNet(validEdges: EdgePath[], opts: ComputeSolderDotsOptions): SolderDot[] {
  const cellSize = opts.cellSize ?? 40;
  const tolerance = opts.tolerance ?? 2.5;
  const tolSq = tolerance * tolerance;
  const portPoints = opts.portPoints;

  // 1. Gather all candidate vertices from all valid edges
  interface RawCandidate {
    x: number;
    y: number;
    color: string;
  }
  const rawCandidates: RawCandidate[] = [];
  for (const edge of validEdges) {
    const color = edge.color && edge.color !== "none" ? edge.color : "#333333";
    for (const pt of edge.points) {
      rawCandidates.push({ x: pt.x, y: pt.y, color });
    }
  }

  // 2. Cluster candidate points within tolerance to eliminate subpixel jitter and duplicate junctions
  interface JunctionCluster {
    x: number;
    y: number;
    count: number;
    preferredColor?: string | undefined;
  }
  const clusters: JunctionCluster[] = [];
  const clusterGrid = new Map<string, JunctionCluster[]>();
  const clusterCellSize = Math.max(cellSize, 40);

  for (const rc of rawCandidates) {
    const gx = Math.floor(rc.x / clusterCellSize);
    const gy = Math.floor(rc.y / clusterCellSize);
    let matchedCluster: JunctionCluster | null = null;

    outerCluster: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = clusterGrid.get(`${gx + dx}:${gy + dy}`);
        if (!bucket) continue;
        for (const cl of bucket) {
          const d2 = (rc.x - cl.x) * (rc.x - cl.x) + (rc.y - cl.y) * (rc.y - cl.y);
          if (d2 <= tolSq) {
            matchedCluster = cl;
            break outerCluster;
          }
        }
      }
    }

    if (matchedCluster) {
      matchedCluster.x = (matchedCluster.x * matchedCluster.count + rc.x) / (matchedCluster.count + 1);
      matchedCluster.y = (matchedCluster.y * matchedCluster.count + rc.y) / (matchedCluster.count + 1);
      matchedCluster.count++;
      if (!matchedCluster.preferredColor && rc.color !== "#333333") {
        matchedCluster.preferredColor = rc.color;
      }
    } else {
      const newCluster: JunctionCluster = {
        x: rc.x,
        y: rc.y,
        count: 1,
        preferredColor: rc.color !== "#333333" ? rc.color : undefined,
      };
      clusters.push(newCluster);
      const key = `${gx}:${gy}`;
      let bucket = clusterGrid.get(key);
      if (!bucket) {
        bucket = [];
        clusterGrid.set(key, bucket);
      }
      bucket.push(newCluster);
    }
  }

  // 3. Spatial hash index for path segments
  interface IndexedSegment {
    edgeId: string;
    color: string;
    p1: { x: number; y: number };
    p2: { x: number; y: number };
    isStartSegment: boolean;
    isEndSegment: boolean;
  }
  const segmentGrid = new Map<string, IndexedSegment[]>();

  for (const edge of validEdges) {
    const color = edge.color && edge.color !== "none" ? edge.color : "#333333";
    for (let k = 0; k < edge.points.length - 1; k++) {
      const p1 = edge.points[k]!;
      const p2 = edge.points[k + 1]!;
      const seg: IndexedSegment = {
        edgeId: edge.id,
        color,
        p1,
        p2,
        isStartSegment: k === 0,
        isEndSegment: k === edge.points.length - 2,
      };

      const minX = Math.floor(Math.min(p1.x, p2.x) / cellSize);
      const maxX = Math.floor(Math.max(p1.x, p2.x) / cellSize);
      const minY = Math.floor(Math.min(p1.y, p2.y) / cellSize);
      const maxY = Math.floor(Math.max(p1.y, p2.y) / cellSize);

      for (let gx = minX; gx <= maxX; gx++) {
        for (let gy = minY; gy <= maxY; gy++) {
          const key = `${gx}:${gy}`;
          let bucket = segmentGrid.get(key);
          if (!bucket) {
            bucket = [];
            segmentGrid.set(key, bucket);
          }
          bucket.push(seg);
        }
      }
    }
  }

  // 4. Test each cluster for topological junction criteria
  const dots: SolderDot[] = [];
  const seenIds = new Set<string>();

  for (const C of clusters) {
    // Exclude clusters located on component connection ports/pins
    if (portPoints && portPoints.length > 0) {
      let isAtPort = false;
      for (const pp of portPoints) {
        const d2 = (C.x - pp.x) * (C.x - pp.x) + (C.y - pp.y) * (C.y - pp.y);
        if (d2 <= tolSq * 1.5) {
          isAtPort = true;
          break;
        }
      }
      if (isAtPort) continue;
    }

    // Exclude clusters located strictly inside component bounding boxes
    if (opts.componentBoxes && opts.componentBoxes.length > 0) {
      let insideBox = false;
      for (const box of opts.componentBoxes) {
        if (
          C.x > box.x + 1 &&
          C.x < box.x + box.width - 1 &&
          C.y > box.y + 1 &&
          C.y < box.y + box.height - 1
        ) {
          insideBox = true;
          break;
        }
      }
      if (insideBox) continue;
    }

    const cgx = Math.floor(C.x / cellSize);
    const cgy = Math.floor(C.y / cellSize);

    const edgeBranches = new Map<string, number>();
    const edgeColors = new Map<string, string>();
    const checkedSegments = new Set<IndexedSegment>();

    let snapX = C.x;
    let snapY = C.y;
    let hasThroughWire = false;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = segmentGrid.get(`${cgx + dx}:${cgy + dy}`);
        if (!bucket) continue;

        for (const seg of bucket) {
          if (checkedSegments.has(seg)) continue;
          checkedSegments.add(seg);

          const vx = seg.p1.x;
          const vy = seg.p1.y;
          const wx = seg.p2.x;
          const wy = seg.p2.y;
          const segDx = wx - vx;
          const segDy = wy - vy;
          const l2 = segDx * segDx + segDy * segDy;
          if (l2 === 0) continue;

          const tRaw = ((C.x - vx) * segDx + (C.y - vy) * segDy) / l2;
          const tClamped = Math.max(0, Math.min(1, tRaw));
          const projX = vx + tClamped * segDx;
          const projY = vy + tClamped * segDy;
          const d2 = (C.x - projX) * (C.x - projX) + (C.y - projY) * (C.y - projY);

          if (d2 <= tolSq) {
            const dP1 = Math.hypot(C.x - vx, C.y - vy);
            const dP2 = Math.hypot(C.x - wx, C.y - wy);

            let branches = 0;
            if (dP1 <= tolerance) {
              branches = seg.isStartSegment ? 1 : 2;
            } else if (dP2 <= tolerance) {
              branches = seg.isEndSegment ? 1 : 2;
            } else {
              // In interior of segment -> continuous line through cluster
              branches = 2;
              if (!hasThroughWire) {
                snapX = projX;
                snapY = projY;
                hasThroughWire = true;
              }
            }

            const current = edgeBranches.get(seg.edgeId) || 0;
            edgeBranches.set(seg.edgeId, Math.max(current, branches));
            if (!edgeColors.has(seg.edgeId)) {
              edgeColors.set(seg.edgeId, seg.color);
            }
          }
        }
      }
    }

    let totalBranches = 0;
    for (const b of edgeBranches.values()) {
      totalBranches += b;
    }

    // Must be a true junction: at least 3 branches meeting and at least 2 distinct edges
    if (totalBranches < 3) continue;
    if (edgeBranches.size < 2) continue;

    const incidentEdgeIds = Array.from(edgeBranches.keys()).sort();
    const id =
      incidentEdgeIds.length === 2
        ? `solder_dot_${incidentEdgeIds[0]}_${incidentEdgeIds[1]}`
        : `solder_dot_${incidentEdgeIds.join("_")}`;

    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const color = C.preferredColor || edgeColors.get(incidentEdgeIds[0]!) || "#333333";

    dots.push({
      id,
      x: Math.round(snapX * 10) / 10,
      y: Math.round(snapY * 10) / 10,
      color,
      edgeIds: incidentEdgeIds,
    });
  }

  return dots;
}

/**
 * Converts a SolderDot into an AntV X6 node suitable for serialization.
 */
export function solderDotToDiagramNode(dot: SolderDot, size = 3) {
  const r = size / 2;
  return {
    id: dot.id,
    shape: "circle",
    x: dot.x - r,
    y: dot.y - r,
    width: size,
    height: size,
    angle: 0,
    opacity: 1,
    zIndex: 20,
    autoLayout: false,
    markup: [
      {
        tagName: "circle",
        selector: "body",
        attrs: {
          cx: r,
          cy: r,
          r,
          fill: dot.color,
          stroke: "none",
          pointerEvents: "none",
          style: "pointer-events: none;",
        },
      },
    ],
    attrs: {
      body: {
        fill: dot.color,
        stroke: "none",
        pointerEvents: "none",
        style: { pointerEvents: "none" },
      },
    },
    ports: { items: [], groups: {} },
  };
}

export interface WireCrossing {
  id: string;
  x: number;
  y: number;
  horizontalEdgeId: string;
  verticalEdgeId: string;
  color: string;
}

/**
 * Computes non-connected orthogonal wire crossings where two wires cross without forming a T-junction solder dot.
 * IEEE Std 315 / IEC 60617 schematic jumpover arcs are placed at these coordinates to visually clarify that the wires do not intersect.
 */
export function computeWireCrossings(
  edges: EdgePath[],
  solderDots: SolderDot[],
  options: {
    portPoints?: { x: number; y: number }[];
    tolerance?: number;
    componentBoxes?: { x: number; y: number; width: number; height: number }[];
  } = {},
): WireCrossing[] {
  const tolerance = options.tolerance ?? 4.0;
  const tolSq = tolerance * tolerance;
  const portPoints = options.portPoints ?? [];
  const componentBoxes = options.componentBoxes ?? [];

  interface OrthoSeg {
    edgeId: string;
    color: string;
    isHoriz: boolean;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }

  const horizSegs: OrthoSeg[] = [];
  const vertSegs: OrthoSeg[] = [];

  for (const edge of edges) {
    if (!edge.points || edge.points.length < 2) continue;
    const color = edge.color && edge.color !== "none" ? edge.color : "#1890ff";
    for (let i = 0; i < edge.points.length - 1; i++) {
      const p1 = edge.points[i]!;
      const p2 = edge.points[i + 1]!;
      if (Math.abs(p1.y - p2.y) <= 0.5 && Math.abs(p1.x - p2.x) > 8) {
        horizSegs.push({
          edgeId: edge.id,
          color,
          isHoriz: true,
          x1: Math.min(p1.x, p2.x),
          y1: p1.y,
          x2: Math.max(p1.x, p2.x),
          y2: p1.y,
        });
      } else if (Math.abs(p1.x - p2.x) <= 0.5 && Math.abs(p1.y - p2.y) > 8) {
        vertSegs.push({
          edgeId: edge.id,
          color,
          isHoriz: false,
          x1: p1.x,
          y1: Math.min(p1.y, p2.y),
          x2: p1.x,
          y2: Math.max(p1.y, p2.y),
        });
      }
    }
  }

  const crossings: WireCrossing[] = [];
  const seenCrossingKeys = new Set<string>();

  for (const h of horizSegs) {
    for (const v of vertSegs) {
      if (h.edgeId === v.edgeId) continue;

      // Crossing point is at (v.x1, h.y1)
      const cx = v.x1;
      const cy = h.y1;

      // Must be strictly interior to both segments (not endpoints)
      if (cx <= h.x1 + 6 || cx >= h.x2 - 6) continue;
      if (cy <= v.y1 + 6 || cy >= v.y2 - 6) continue;

      // Exclude if close to any solder dot
      let atSolderDot = false;
      for (const dot of solderDots) {
        const d2 = (cx - dot.x) * (cx - dot.x) + (cy - dot.y) * (cy - dot.y);
        if (d2 <= tolSq) {
          atSolderDot = true;
          break;
        }
      }
      if (atSolderDot) continue;

      // Exclude if close to any component port
      let atPort = false;
      for (const pp of portPoints) {
        const d2 = (cx - pp.x) * (cx - pp.x) + (cy - pp.y) * (cy - pp.y);
        if (d2 <= tolSq) {
          atPort = true;
          break;
        }
      }
      if (atPort) continue;

      // Exclude if inside any component box
      if (componentBoxes.length > 0) {
        let insideBox = false;
        for (const box of componentBoxes) {
          if (
            cx > box.x + 1 &&
            cx < box.x + box.width - 1 &&
            cy > box.y + 1 &&
            cy < box.y + box.height - 1
          ) {
            insideBox = true;
            break;
          }
        }
        if (insideBox) continue;
      }

      const key = `${Math.round(cx)}:${Math.round(cy)}`;
      if (seenCrossingKeys.has(key)) continue;
      seenCrossingKeys.add(key);

      crossings.push({
        id: `wire_crossing_${h.edgeId}_${v.edgeId}_${Math.round(cx)}_${Math.round(cy)}`,
        x: Math.round(cx),
        y: Math.round(cy),
        horizontalEdgeId: h.edgeId,
        verticalEdgeId: v.edgeId,
        color: h.color,
      });
    }
  }

  return crossings;
}

/**
 * Visual styling options for non-connected orthogonal wire crossings.
 * - "none": Modern EDA standard (KiCad, Altium, Modelica Spec) — straight orthogonal lines (+).
 *           Connections are strictly denoted by solder dots at T-junctions.
 * - "micro-arc": Proportional semicircular bridge hop (PSCAD, OpenDSS, Simulink, Ladder Logic).
 * - "gap": Technical air-gap break on the crossing line (P&ID ISA-5.1, fluid networks).
 * - "auto": Inferred from diagram metadata language (default).
 */
export type WireCrossingStyle = "none" | "micro-arc" | "gap" | "auto";

/**
 * Resolves the appropriate wire crossing style based on language domain conventions
 * or explicit user/diagram preference.
 */
export function resolveWireCrossingStyle(
  language?: string | null | undefined,
  userPreference?: WireCrossingStyle | string | null | undefined,
): "none" | "micro-arc" | "gap" {
  if (userPreference && userPreference !== "auto") {
    if (userPreference === "none" || userPreference === "micro-arc" || userPreference === "gap") {
      return userPreference;
    }
  }

  const lang = (language ?? "").toLowerCase().trim();

  // Languages where bridge hops / micro-arcs are traditional:
  // - Power systems & grid simulation (PSCAD, OpenDSS, PSSE)
  // - Industrial automation & ladder logic (PLCOpen, AutomationML)
  // - Control block diagrams (Simulink, EASY5, ROCETS, JSBSim)
  const MICRO_ARC_LANGUAGES = new Set([
    "pscad",
    "opendss",
    "psse",
    "plcopen",
    "automationml",
    "simulink",
    "easy5",
    "rocets",
    "jsbsim",
  ]);

  // Languages where air-gap / wire breaks are traditional (P&ID / fluid networks):
  const AIR_GAP_LANGUAGES = new Set(["relap5", "olga", "lps", "aspen", "epanet", "swmm", "eclipse"]);

  if (MICRO_ARC_LANGUAGES.has(lang)) {
    return "micro-arc";
  }
  if (AIR_GAP_LANGUAGES.has(lang)) {
    return "gap";
  }

  // Modern EDA standard (Modelica, SPICE, Verilog-A, SysML v2, SSP, ReqIF, OSCAL, etc.)
  // Straight orthogonal crossings (+) without hops. Connections explicitly indicated by solder dots.
  return "none";
}

export interface WireCrossingNodeOptions {
  size?: number | undefined;
  style?: WireCrossingStyle | undefined;
  strokeWidth?: number | undefined;
}

/**
 * Builds an ephemeral diagram node for a wire crossing jumpover arc or technical air-gap.
 */
export function wireCrossingToDiagramNode(crossing: WireCrossing, isDark: boolean, options?: WireCrossingNodeOptions) {
  const size = options?.size ?? 6;
  const style = options?.style ?? "micro-arc";
  const half = size / 2;
  const bg = isDark ? "#1e1e1e" : "#ffffff";
  const strokeWidth = options?.strokeWidth ?? 1.0;

  if (style === "gap") {
    const maskW = Math.max(2, strokeWidth * 2.5);
    const maskH = Math.max(3, strokeWidth * 3);
    return {
      id: crossing.id,
      type: "wire-crossing",
      x: crossing.x - half,
      y: crossing.y - half,
      width: size,
      height: size,
      angle: 0,
      opacity: 1,
      zIndex: 25,
      autoLayout: false,
      markup: [
        {
          tagName: "rect",
          selector: "mask",
          attrs: {
            x: half - maskW / 2,
            y: half - maskH / 2,
            width: maskW,
            height: maskH,
            fill: bg,
            stroke: "none",
            pointerEvents: "none",
          },
        },
      ],
      attrs: {
        mask: { fill: bg, stroke: "none", pointerEvents: "none" },
      },
      ports: { items: [], groups: {} },
    };
  }

  // Refined micro-arc style:
  // Proportional semicircle with non-scaling stroke and compact grid-preserving mask
  const maskW = Math.max(2, strokeWidth * 2);
  const maskH = Math.max(2.5, strokeWidth * 2.5);
  const r = half;
  const arcPath = `M 0 ${half} A ${r} ${r} 0 0 1 ${size} ${half}`;

  return {
    id: crossing.id,
    type: "wire-crossing",
    x: crossing.x - half,
    y: crossing.y - half,
    width: size,
    height: size,
    angle: 0,
    opacity: 1,
    zIndex: 25,
    autoLayout: false,
    markup: [
      {
        tagName: "rect",
        selector: "mask",
        attrs: {
          x: half - maskW / 2,
          y: half - maskH / 2,
          width: maskW,
          height: maskH,
          fill: bg,
          stroke: "none",
          pointerEvents: "none",
        },
      },
      {
        tagName: "path",
        selector: "arc",
        attrs: {
          d: arcPath,
          fill: "none",
          stroke: crossing.color,
          strokeWidth: strokeWidth,
          "vector-effect": "non-scaling-stroke",
          strokeLinecap: "round",
          pointerEvents: "none",
        },
      },
    ],
    attrs: {
      mask: { fill: bg, stroke: "none", pointerEvents: "none" },
      arc: {
        stroke: crossing.color,
        strokeWidth: strokeWidth,
        fill: "none",
        pointerEvents: "none",
        "vector-effect": "non-scaling-stroke",
        strokeLinecap: "round",
      },
    },
    ports: { items: [], groups: {} },
  };
}
