// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — Multibody Dynamics & Robotics Kinematic Schematic Builder.
 *
 * Translates multibody kinematic models (SIMPACK, GENSYS, Adams, URDF) into:
 * 1. Interactive AntV X6 graph model with body nodes, joint constraint edges, and force element links.
 * 2. Standalone vector SVG kinematic topology diagrams (dark/light themes).
 */

export interface KinematicBodyLike {
  id: string;
  name: string;
  mass?: number | undefined;
  isGround?: boolean | undefined;
  inertia?: { ixx?: number; iyy?: number; izz?: number } | undefined;
}

export interface KinematicJointLike {
  id: string;
  name: string;
  type: string; // "revolute" | "prismatic" | "spherical" | "cylindrical" | "fixed" | "planar" | string
  fromBody: string;
  toBody: string;
  fromMarker?: string | undefined;
  toMarker?: string | undefined;
  limits?: { lower?: number | undefined; upper?: number | undefined } | undefined;
}

export interface KinematicForceElementLike {
  id: string;
  type: string; // "spring" | "damper" | "bushing" | "actuator" | string
  body1: string;
  body2: string;
  stiffness?: number | undefined;
  damping?: number | undefined;
}

export interface KinematicSystemLike {
  title: string;
  bodies: KinematicBodyLike[];
  joints: KinematicJointLike[];
  forces?: KinematicForceElementLike[] | undefined;
}

export interface KinematicDiagramCell {
  id: string;
  shape: string;
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  label?: string | undefined;
  source?: { cell: string; port?: string } | { x: number; y: number } | undefined;
  target?: { cell: string; port?: string } | { x: number; y: number } | undefined;
  attrs?: Record<string, unknown> | undefined;
  data?: Record<string, unknown> | undefined;
}

export interface KinematicDiagramGraph {
  title: string;
  cells: KinematicDiagramCell[];
}

export interface KinematicLayoutResult {
  bodyCoords: Map<string, { x: number; y: number; width: number; height: number; cx: number; cy: number }>;
  svgWidth: number;
  svgHeight: number;
}

/**
 * Computes topological kinematic tree layout:
 * 1. Identifies ground/inertial base root(s).
 * 2. Assigns bodies to kinematic depth layers via BFS traversal across joint connections.
 * 3. Centers and balances bodies at each hierarchical level.
 */
export function computeKinematicTreeLayout(
  system: KinematicSystemLike,
  options?: { width?: number | undefined; height?: number | undefined } | undefined,
): KinematicLayoutResult {
  const cellWidth = 140;
  const cellHeight = 70;
  const gapX = 80;
  const gapY = 80;

  const bodies = system.bodies || [];
  if (bodies.length === 0) {
    return {
      bodyCoords: new Map(),
      svgWidth: options?.width ?? 400,
      svgHeight: options?.height ?? 300,
    };
  }

  // 1. Build adjacency list of joints (undirected topology)
  const adj = new Map<string, string[]>();
  for (const b of bodies) {
    adj.set(b.id, []);
  }
  for (const j of system.joints || []) {
    adj.get(j.fromBody)?.push(j.toBody);
    adj.get(j.toBody)?.push(j.fromBody);
  }

  // 2. Identify ground / base roots
  const groundRoots = bodies.filter((b) => b.isGround || b.id.toLowerCase() === "ground" || b.id === "$inertial");
  const startRoots = groundRoots.length > 0 ? groundRoots : [bodies[0]!];

  // 3. BFS tree assignment
  const depthMap = new Map<string, number>();
  const visited = new Set<string>();
  const queue: string[] = [];

  for (const root of startRoots) {
    depthMap.set(root.id, 0);
    visited.add(root.id);
    queue.push(root.id);
  }

  while (queue.length > 0) {
    const currId = queue.shift()!;
    const currDepth = depthMap.get(currId)!;
    const neighbors = adj.get(currId) || [];
    for (const n of neighbors) {
      if (!visited.has(n)) {
        visited.add(n);
        depthMap.set(n, currDepth + 1);
        queue.push(n);
      }
    }
  }

  // Handle any unvisited bodies (disconnected kinematic chains)
  for (const b of bodies) {
    if (!visited.has(b.id)) {
      const maxCurrentDepth = Math.max(0, ...depthMap.values());
      depthMap.set(b.id, maxCurrentDepth + 1);
      visited.add(b.id);
      queue.push(b.id);
      while (queue.length > 0) {
        const currId = queue.shift()!;
        const currDepth = depthMap.get(currId)!;
        const neighbors = adj.get(currId) || [];
        for (const n of neighbors) {
          if (!visited.has(n)) {
            visited.add(n);
            depthMap.set(n, currDepth + 1);
            queue.push(n);
          }
        }
      }
    }
  }

  // 4. Group bodies by depth level
  const levels = new Map<number, KinematicBodyLike[]>();
  for (const b of bodies) {
    const d = depthMap.get(b.id) ?? 0;
    if (!levels.has(d)) levels.set(d, []);
    levels.get(d)!.push(b);
  }

  const depthKeys = Array.from(levels.keys()).sort((a, b) => a - b);
  const maxDepth = depthKeys.length > 0 ? depthKeys[depthKeys.length - 1]! : 0;

  // Calculate maximum level width
  let maxLevelWidth = 0;
  for (const d of depthKeys) {
    const count = levels.get(d)!.length;
    const levelWidth = count * cellWidth + (count - 1) * gapX;
    if (levelWidth > maxLevelWidth) maxLevelWidth = levelWidth;
  }

  const svgWidth = options?.width ?? Math.max(400, maxLevelWidth + 100);
  const svgHeight = options?.height ?? Math.max(300, 100 + (maxDepth + 1) * (cellHeight + gapY));

  // 5. Position bodies centered per level
  const bodyCoords = new Map<string, { x: number; y: number; width: number; height: number; cx: number; cy: number }>();
  for (const d of depthKeys) {
    const list = levels.get(d)!;
    const count = list.length;
    const levelWidth = count * cellWidth + (count - 1) * gapX;
    const startX = Math.max(50, (svgWidth - levelWidth) / 2);
    const y = 50 + d * (cellHeight + gapY);

    list.forEach((body, idx) => {
      const x = startX + idx * (cellWidth + gapX);
      bodyCoords.set(body.id, {
        x,
        y,
        width: cellWidth,
        height: cellHeight,
        cx: x + cellWidth / 2,
        cy: y + cellHeight / 2,
      });
    });
  }

  return { bodyCoords, svgWidth, svgHeight };
}

/**
 * Constructs an interactive AntV X6 graph model for a multibody mechanism.
 */
export function buildKinematicDiagram(system: KinematicSystemLike): KinematicDiagramGraph {
  const { bodyCoords } = computeKinematicTreeLayout(system);
  const cells: KinematicDiagramCell[] = [];

  // 1. Position bodies via kinematic tree hierarchy
  system.bodies.forEach((body) => {
    const coords = bodyCoords.get(body.id) ?? { x: 50, y: 50, width: 140, height: 70, cx: 120, cy: 85 };
    const isGround = body.isGround || body.id === "ground" || body.id === "$inertial";
    const massLabel = body.mass !== undefined ? `${body.mass.toFixed(1)} kg` : "";

    cells.push({
      id: `body_${body.id}`,
      shape: "rect",
      x: coords.x,
      y: coords.y,
      width: coords.width,
      height: coords.height,
      label: `${body.name || body.id}\n${massLabel}`,
      attrs: {
        body: {
          fill: isGround ? "#374151" : "#1e293b",
          stroke: isGround ? "#9ca3af" : "#38bdf8",
          strokeWidth: isGround ? 3 : 2,
          strokeDasharray: isGround ? "4 2" : "0",
          rx: 6,
          ry: 6,
        },
        label: {
          fill: "#f8fafc",
          fontSize: 12,
          fontFamily: "Inter, sans-serif",
          textAnchor: "middle",
        },
      },
      data: {
        kind: "body",
        bodyId: body.id,
        isGround,
        mass: body.mass,
        inertia: body.inertia,
      },
    });
  });

  // 2. Joints as structural edges with joint type markers
  for (const joint of system.joints) {
    const srcBodyId = `body_${joint.fromBody}`;
    const tgtBodyId = `body_${joint.toBody}`;

    cells.push({
      id: `joint_${joint.id}`,
      shape: "edge",
      source: { cell: srcBodyId },
      target: { cell: tgtBodyId },
      label: `${joint.name || joint.id} (${joint.type})`,
      attrs: {
        line: {
          stroke: "#22c55e",
          strokeWidth: 2,
          targetMarker: {
            name: "block",
            size: 6,
          },
        },
        label: {
          fill: "#86efac",
          fontSize: 10,
          fontFamily: "Inter, sans-serif",
        },
      },
      data: {
        kind: "joint",
        jointId: joint.id,
        type: joint.type,
        limits: joint.limits,
      },
    });
  }

  // 3. Force elements (Springs, Dampers, Bushings) as dashed dynamic edges
  if (system.forces) {
    for (const force of system.forces) {
      cells.push({
        id: `force_${force.id}`,
        shape: "edge",
        source: { cell: `body_${force.body1}` },
        target: { cell: `body_${force.body2}` },
        label: `${force.id} (${force.type})`,
        attrs: {
          line: {
            stroke: "#f59e0b",
            strokeWidth: 2,
            strokeDasharray: "5 5",
          },
          label: {
            fill: "#fcd34d",
            fontSize: 10,
            fontFamily: "Inter, sans-serif",
          },
        },
        data: {
          kind: "force",
          forceId: force.id,
          type: force.type,
          stiffness: force.stiffness,
          damping: force.damping,
        },
      });
    }
  }

  return {
    title: system.title || "Kinematic Mechanism",
    cells,
  };
}

/**
 * Generates standalone, responsive vector SVG schematics for a multibody mechanism.
 */
export function renderKinematicSvg(
  system: KinematicSystemLike,
  options?:
    | {
        isDark?: boolean | undefined;
        theme?: "dark" | "light" | undefined;
        width?: number | undefined;
        height?: number | undefined;
      }
    | undefined,
): string {
  const isDark = options?.isDark !== undefined ? options.isDark : options?.theme !== "light";

  const bgColor = isDark ? "#0f172a" : "#f8fafc";
  const textColor = isDark ? "#f8fafc" : "#0f172a";
  const textMuted = isDark ? "#94a3b8" : "#64748b";
  const groundFill = isDark ? "#334155" : "#e2e8f0";
  const bodyFill = isDark ? "#1e293b" : "#ffffff";
  const bodyStroke = isDark ? "#38bdf8" : "#0284c7";
  const jointStroke = isDark ? "#22c55e" : "#16a34a";
  const forceStroke = isDark ? "#f59e0b" : "#d97706";

  const { bodyCoords, svgWidth, svgHeight } = computeKinematicTreeLayout(system, options);

  const bodyCenters = new Map<string, { x: number; y: number }>();
  for (const [id, coord] of bodyCoords.entries()) {
    bodyCenters.set(id, { x: coord.cx, y: coord.cy });
  }

  let svgElements = "";

  // 1. Layout bodies
  system.bodies.forEach((body) => {
    const coord = bodyCoords.get(body.id) ?? { x: 50, y: 50, width: 140, height: 70, cx: 120, cy: 85 };
    const isGround = body.isGround || body.id === "ground" || body.id === "$inertial";
    const massText = body.mass !== undefined ? `${body.mass.toFixed(1)} kg` : "";

    svgElements += `
    <g id="body_${body.id}" transform="translate(${coord.x}, ${coord.y})">
      <rect width="${coord.width}" height="${coord.height}" rx="6" ry="6"
            fill="${isGround ? groundFill : bodyFill}"
            stroke="${isGround ? textMuted : bodyStroke}"
            stroke-width="${isGround ? 3 : 2}"
            ${isGround ? 'stroke-dasharray="4 2"' : ""} />
      <text x="${coord.width / 2}" y="${coord.height / 2 - 4}" text-anchor="middle"
            font-family="Inter, sans-serif" font-size="12" font-weight="600" fill="${textColor}">
        ${escapeXml(body.name || body.id)}
      </text>
      <text x="${coord.width / 2}" y="${coord.height / 2 + 14}" text-anchor="middle"
            font-family="Inter, sans-serif" font-size="10" fill="${textMuted}">
        ${escapeXml(massText)}
      </text>
    </g>`;
  });

  // 2. Render joint connections
  for (const joint of system.joints) {
    const from = bodyCenters.get(joint.fromBody);
    const to = bodyCenters.get(joint.toBody);
    if (!from || !to) continue;

    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;

    svgElements += `
    <g id="joint_${joint.id}">
      <line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"
            stroke="${jointStroke}" stroke-width="2" marker-end="url(#jointArrow)" />
      <circle cx="${midX}" cy="${midY}" r="12" fill="${bgColor}" stroke="${jointStroke}" stroke-width="2" />
      <text x="${midX}" y="${midY + 4}" text-anchor="middle"
            font-family="Inter, sans-serif" font-size="9" font-weight="700" fill="${jointStroke}">
        ${getJointGlyph(joint.type)}
      </text>
      <text x="${midX}" y="${midY - 16}" text-anchor="middle"
            font-family="Inter, sans-serif" font-size="9" fill="${textColor}">
        ${escapeXml(joint.name || joint.id)}
      </text>
    </g>`;
  }

  // 3. Render force elements
  if (system.forces) {
    for (const force of system.forces) {
      const b1 = bodyCenters.get(force.body1);
      const b2 = bodyCenters.get(force.body2);
      if (!b1 || !b2) continue;

      const midX = (b1.x + b2.x) / 2 + 10;
      const midY = (b1.y + b2.y) / 2 + 10;

      const forceParam =
        force.stiffness !== undefined
          ? `${force.stiffness} N/m`
          : force.damping !== undefined
            ? `${force.damping} Ns/m`
            : "";
      const forceLabel = forceParam ? `${force.id} (${forceParam})` : force.id;
      const boxWidth = Math.max(50, forceLabel.length * 6 + 10);

      svgElements += `
      <g id="force_${force.id}">
        <line x1="${b1.x}" y1="${b1.y}" x2="${b2.x}" y2="${b2.y}"
              stroke="${forceStroke}" stroke-width="2" stroke-dasharray="5 5" />
        <rect x="${midX - boxWidth / 2}" y="${midY - 8}" width="${boxWidth}" height="16" rx="3"
              fill="${bgColor}" stroke="${forceStroke}" stroke-width="1" />
        <text x="${midX}" y="${midY + 3}" text-anchor="middle"
              font-family="Inter, sans-serif" font-size="8" fill="${forceStroke}">
          ${escapeXml(forceLabel)}
        </text>
      </g>`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${svgWidth}" height="${svgHeight}">
  <defs>
    <marker id="jointArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${jointStroke}" />
    </marker>
  </defs>
  <rect width="100%" height="100%" fill="${bgColor}" />
  <text x="20" y="30" font-family="Inter, sans-serif" font-size="16" font-weight="700" fill="${textColor}">
    ${escapeXml(system.title)}
  </text>
  ${svgElements}
</svg>
`;
}

function getJointGlyph(type: string): string {
  const lower = (type || "").toLowerCase();
  if (lower.includes("rev") || lower.includes("pin") || lower.includes("hinge")) return "↻";
  if (lower.includes("prism") || lower.includes("slider") || lower.includes("trans")) return "↔";
  if (lower.includes("spher") || lower.includes("ball")) return "⨁";
  if (lower.includes("cylind")) return "⊙";
  if (lower.includes("fixed") || lower.includes("weld")) return "✕";
  return "⚲";
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
