// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * SLAM II cleanroom standard library archetype IDs matching `assets/slam-std-lib/src/models.ts`.
 */
export const SlamArchetypeId = {
  CREATE: 1,
  QUEUE: 2,
  ACTIVITY: 3,
  ASSIGN: 4,
  AWAIT: 5,
  FREE: 6,
  RESOURCE: 7,
  GATE: 8,
  OPEN: 9,
  CLOSE: 10,
  COLCT: 11,
  DETECT: 12,
  TERMINATE: 13,
  CONTINUOUS: 14,
} as const;

export type SlamArchetypeId = (typeof SlamArchetypeId)[keyof typeof SlamArchetypeId];

export type SlamBlockCategory = "Entity Flow" | "Resources & Gates" | "Continuous & Threshold" | "Statistics & Control";

export interface SlamBlockSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: SlamBlockCategory;
  archetypeId: SlamArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<SlamBlockCategory, { fill: string; stroke: string; badge: string }> = {
  "Entity Flow": { fill: "#1e3a5f", stroke: "#60a5fa", badge: "FLOW" },
  "Resources & Gates": { fill: "#2e2447", stroke: "#c084fc", badge: "RES" },
  "Continuous & Threshold": { fill: "#4a1d1d", stroke: "#f97316", badge: "CONT" },
  "Statistics & Control": { fill: "#163b3b", stroke: "#2dd4bf", badge: "STAT" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for a SLAM II node.
 */
export function generateSlamBlockSvg(modelType: string, category: SlamBlockCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 10);
  const fontSize = label.length > 8 ? "8.2" : "9.5";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">` +
    `<rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="28" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="20" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForSpec(spec: SlamBlockSpec): DiagramPortSpec[] {
  switch (spec.modelType) {
    case "CREATE":
      return [{ name: "out", kind: "entity", side: "right", dx: 88, dy: 26 }];
    case "TERMINATE":
      return [{ name: "in", kind: "entity", side: "left", dx: 0, dy: 26 }];
    case "DETECT":
      return [
        { name: "state_in", kind: "signal", side: "left", dx: 0, dy: 26 },
        { name: "trigger_out", kind: "entity", side: "right", dx: 88, dy: 26 },
      ];
    case "CONTINUOUS":
      return [
        { name: "rate_in", kind: "signal", side: "left", dx: 0, dy: 26 },
        { name: "state_out", kind: "signal", side: "right", dx: 88, dy: 26 },
      ];
    default:
      return [
        { name: "in", kind: "entity", side: "left", dx: 0, dy: 26 },
        { name: "out", kind: "entity", side: "right", dx: 88, dy: 26 },
      ];
  }
}

export const SLAM_BLOCK_SPECS: SlamBlockSpec[] = [
  {
    modelType: "CREATE",
    aliases: ["ARRIVAL", "SOURCE"],
    label: "CREATE — Entity Arrival Generator",
    category: "Entity Flow",
    archetypeId: SlamArchetypeId.CREATE,
    description: "Generates entities into a SLAM II network according to interarrival time TBC and first creation TF.",
    provenance: "Pritsker & Pegden (1979), Introduction to Simulation and SLAM, Ch. 3",
    params: [
      ["TBC", 1.0, "time", "Time between entity creations"],
      ["TF", 0.0, "time", "Time of first entity creation"],
      ["MA", 1, "index", "Mark attribute index for creation timestamp"],
      ["MC", 0, "count", "Maximum creations (0 = unlimited)"],
    ],
  },
  {
    modelType: "QUEUE",
    aliases: ["QNODE", "BUFFER"],
    label: "QUEUE — Entity Waiting File",
    category: "Entity Flow",
    archetypeId: SlamArchetypeId.QUEUE,
    description: "Holds arriving entities in file IFL until a downstream service ACTIVITY becomes available.",
    provenance: "Pritsker & Pegden (1979), Introduction to Simulation and SLAM, Ch. 3",
    params: [
      ["IFL", 1, "index", "File number"],
      ["IQ", 0, "count", "Initial number of entities in queue"],
      ["QC", 1000, "count", "Maximum queue capacity"],
    ],
  },
  {
    modelType: "ACTIVITY",
    aliases: ["ACT", "BRANCH", "SERVICE"],
    label: "ACTIVITY — Timed Branch / Server",
    category: "Entity Flow",
    archetypeId: SlamArchetypeId.ACTIVITY,
    description:
      "Delays entities for duration DUR and routes them probabilistically or conditionally to target node NLBL.",
    provenance: "Pritsker & Pegden (1979), Introduction to Simulation and SLAM, Ch. 3",
    params: [
      ["DUR", 1.0, "time", "Activity service or transit duration"],
      ["PROB", 1.0, "1", "Branch selection probability"],
      ["N", 1, "count", "Number of parallel servers"],
    ],
  },
  {
    modelType: "ASSIGN",
    aliases: ["SET"],
    label: "ASSIGN — State & Attribute Assignment",
    category: "Statistics & Control",
    archetypeId: SlamArchetypeId.ASSIGN,
    description: "Assigns values to global variables XX(i), continuous states SS(i), or entity attributes ATRIB(i).",
    provenance: "Pritsker & Pegden (1979), Introduction to Simulation and SLAM, Ch. 3",
    params: [["M", 1, "count", "Maximum number of outgoing branches"]],
  },
  {
    modelType: "AWAIT",
    aliases: ["SEIZE", "WAIT"],
    label: "AWAIT — Resource / Gate Acquisition",
    category: "Resources & Gates",
    archetypeId: SlamArchetypeId.AWAIT,
    description: "Delays entities in file IFL until UR units of resource RLBL are available or gate GLBL is open.",
    provenance: "Pritsker & Pegden (1979), Introduction to Simulation and SLAM, Ch. 5",
    params: [
      ["IFL", 1, "index", "Wait file number"],
      ["UR", 1, "units", "Resource units requested"],
    ],
  },
  {
    modelType: "FREE",
    aliases: ["RELEASE"],
    label: "FREE — Resource Release",
    category: "Resources & Gates",
    archetypeId: SlamArchetypeId.FREE,
    description: "Releases UF units of resource RLBL and dispatches waiting entities from associated AWAIT files.",
    provenance: "Pritsker & Pegden (1979), Introduction to Simulation and SLAM, Ch. 5",
    params: [["UF", 1, "units", "Resource units freed"]],
  },
  {
    modelType: "RESOURCE",
    aliases: ["RES"],
    label: "RESOURCE — Shared Capacity Pool",
    category: "Resources & Gates",
    archetypeId: SlamArchetypeId.RESOURCE,
    description: "Declares a shared resource block RLBL with initial capacity CAP serving listed AWAIT files.",
    provenance: "Pritsker & Pegden (1979), Introduction to Simulation and SLAM, Ch. 5",
    params: [
      ["CAP", 1, "units", "Initial resource capacity"],
      ["IFL", 1, "index", "Primary file number"],
    ],
  },
  {
    modelType: "GATE",
    aliases: ["VALVE_GATE"],
    label: "GATE — Binary Flow Gate",
    category: "Resources & Gates",
    archetypeId: SlamArchetypeId.GATE,
    description: "Declares a binary gate GLBL (OPEN or CLOSED) controlling entity passage at AWAIT nodes.",
    provenance: "Pritsker & Pegden (1979), Introduction to Simulation and SLAM, Ch. 5",
    params: [
      ["INITIAL_OPEN", 1, "bool", "1 = OPEN, 0 = CLOSED"],
      ["IFL", 1, "index", "Associated wait file number"],
    ],
  },
  {
    modelType: "OPEN",
    aliases: ["GATE_OPEN"],
    label: "OPEN — Open Gate Control",
    category: "Resources & Gates",
    archetypeId: SlamArchetypeId.OPEN,
    description: "Opens gate GLBL and releases all entities queued in files awaiting that gate.",
    provenance: "Pritsker & Pegden (1979), Introduction to Simulation and SLAM, Ch. 5",
    params: [["M", 1, "count", "Maximum outgoing branches"]],
  },
  {
    modelType: "CLOSE",
    aliases: ["GATE_CLOSE"],
    label: "CLOSE — Close Gate Control",
    category: "Resources & Gates",
    archetypeId: SlamArchetypeId.CLOSE,
    description: "Closes gate GLBL so subsequent arriving entities queue at AWAIT nodes referencing GLBL.",
    provenance: "Pritsker & Pegden (1979), Introduction to Simulation and SLAM, Ch. 5",
    params: [["M", 1, "count", "Maximum outgoing branches"]],
  },
  {
    modelType: "COLCT",
    aliases: ["COLLECT", "TALLY"],
    label: "COLCT — Observation Statistics Collector",
    category: "Statistics & Control",
    archetypeId: SlamArchetypeId.COLCT,
    description:
      "Collects sample mean, min, max, and standard deviation for INT(i), BET, or continuous state variables.",
    provenance: "Pritsker & Pegden (1979), Introduction to Simulation and SLAM, Ch. 3",
    params: [["M", 1, "count", "Maximum outgoing branches"]],
  },
  {
    modelType: "DETECT",
    aliases: ["THRESHOLD", "STATE_EVENT"],
    label: "DETECT — Continuous State Threshold Event",
    category: "Continuous & Threshold",
    archetypeId: SlamArchetypeId.DETECT,
    description:
      "Monitors SS(i) or DD(i) and generates a discrete network entity when crossing VALUE in direction XDIR within TOL.",
    provenance: "Pritsker & Pegden (1979), Introduction to Simulation and SLAM, Ch. 9 (Combined Modeling)",
    params: [
      ["VALUE", 0.0, "1", "Threshold value"],
      ["TOL", 0.001, "1", "Crossing tolerance"],
      ["DIR", 1, "enum", "1 = XP (+), -1 = XN (-), 0 = X (either)"],
    ],
  },
  {
    modelType: "TERMINATE",
    aliases: ["TERM", "SINK"],
    label: "TERMINATE — Entity Sink & Run Stop",
    category: "Entity Flow",
    archetypeId: SlamArchetypeId.TERMINATE,
    description: "Destroys arriving entities and terminates the simulation run when TC entities have been terminated.",
    provenance: "Pritsker & Pegden (1979), Introduction to Simulation and SLAM, Ch. 3",
    params: [["TC", 0, "count", "Termination count (0 = unlimited)"]],
  },
  {
    modelType: "CONTINUOUS",
    aliases: ["ODE", "STATE_BLOCK"],
    label: "CONTINUOUS — RK4 ODE State Integrator",
    category: "Continuous & Threshold",
    archetypeId: SlamArchetypeId.CONTINUOUS,
    description:
      "Integrates NNEQD differential equations DD(i) and evaluates NNEQS algebraic equations SS(i) over [DTMIN, DTMAX].",
    provenance: "Pritsker & Pegden (1979), Introduction to Simulation and SLAM, Ch. 8–9",
    params: [
      ["NNEQD", 1, "count", "Number of differential equations DD(i)"],
      ["NNEQS", 0, "count", "Number of algebraic state equations SS(i)"],
      ["DTMIN", 0.01, "time", "Minimum integration step size"],
      ["DTMAX", 0.1, "time", "Maximum integration step size"],
      ["DTSAV", 0.1, "time", "Trajectory recording interval"],
    ],
  },
];

export function buildSlamCleanroomSchemas(): CleanroomModelSchema[] {
  return SLAM_BLOCK_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `SLAM.${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "systems",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "block",
      width: 88,
      height: 52,
      svg: generateSlamBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForSpec(spec),
      parameters,
      wasmKernel: "slamBlockStep",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}
