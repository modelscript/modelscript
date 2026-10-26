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

/**
 * Constructs an interactive AntV X6 graph model for a multibody mechanism.
 */
export function buildKinematicDiagram(system: KinematicSystemLike): KinematicDiagramGraph {
  const cells: KinematicDiagramCell[] = [];
  const bodyCoords = new Map<string, { x: number; y: number }>();

  // 1. Position bodies on a responsive grid
  const cols = Math.max(1, Math.ceil(Math.sqrt(system.bodies.length || 1)));
  const cellWidth = 140;
  const cellHeight = 70;
  const gapX = 80;
  const gapY = 80;

  system.bodies.forEach((body, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = 50 + col * (cellWidth + gapX);
    const y = 50 + row * (cellHeight + gapY);

    bodyCoords.set(body.id, { x: x + cellWidth / 2, y: y + cellHeight / 2 });

    const isGround = body.isGround || body.id === "ground" || body.id === "$inertial";
    const massLabel = body.mass !== undefined ? `${body.mass.toFixed(1)} kg` : "";

    cells.push({
      id: `body_${body.id}`,
      shape: "rect",
      x,
      y,
      width: cellWidth,
      height: cellHeight,
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

  const cellWidth = 140;
  const cellHeight = 70;
  const gapX = 80;
  const gapY = 80;

  const cols = Math.max(1, Math.ceil(Math.sqrt(system.bodies.length || 1)));
  const rows = Math.max(1, Math.ceil((system.bodies.length || 1) / cols));
  const svgWidth = options?.width ?? Math.max(400, 100 + cols * (cellWidth + gapX));
  const svgHeight = options?.height ?? Math.max(300, 100 + rows * (cellHeight + gapY));

  const bodyCenters = new Map<string, { x: number; y: number }>();

  let svgElements = "";

  // 1. Layout bodies
  system.bodies.forEach((body, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = 50 + col * (cellWidth + gapX);
    const y = 50 + row * (cellHeight + gapY);

    bodyCenters.set(body.id, { x: x + cellWidth / 2, y: y + cellHeight / 2 });

    const isGround = body.isGround || body.id === "ground" || body.id === "$inertial";
    const massText = body.mass !== undefined ? `${body.mass.toFixed(1)} kg` : "";

    svgElements += `
    <g id="body_${body.id}" transform="translate(${x}, ${y})">
      <rect width="${cellWidth}" height="${cellHeight}" rx="6" ry="6"
            fill="${isGround ? groundFill : bodyFill}"
            stroke="${isGround ? textMuted : bodyStroke}"
            stroke-width="${isGround ? 3 : 2}"
            ${isGround ? 'stroke-dasharray="4 2"' : ""} />
      <text x="${cellWidth / 2}" y="${cellHeight / 2 - 4}" text-anchor="middle"
            font-family="Inter, sans-serif" font-size="12" font-weight="600" fill="${textColor}">
        ${escapeXml(body.name || body.id)}
      </text>
      <text x="${cellWidth / 2}" y="${cellHeight / 2 + 14}" text-anchor="middle"
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
