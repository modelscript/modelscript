// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * GPSS cleanroom block & Standard Numerical Attribute (SNA) archetype IDs
 * matching `assets/gpss-std-lib/src/models.ts`.
 */
export const GpssArchetypeId = {
  // Transaction Creation & Destruction
  GENERATE: 1,
  TERMINATE: 2,
  SPLIT: 3,
  ASSEMBLE: 4,
  // Facility & Storage Resources
  SEIZE: 10,
  RELEASE: 11,
  ENTER: 12,
  LEAVE: 13,
  STORAGE: 14,
  // Time Delay & Queuing
  ADVANCE: 20,
  QUEUE: 21,
  DEPART: 22,
  // Routing, Logic & Statistics
  TRANSFER: 30,
  ASSIGN: 31,
  TEST: 32,
  GATE: 33,
  TABULATE: 34,
  TABLE: 35,
  FUNCTION: 36,
  // Standard Numerical Attributes (SNAs)
  SNA_Q: 40,
  SNA_F: 41,
  SNA_S: 42,
  SNA_R: 43,
  SNA_FR: 44,
  SNA_SR: 45,
} as const;

export type GpssArchetypeId = (typeof GpssArchetypeId)[keyof typeof GpssArchetypeId];

export type GpssModelCategory =
  | "Transaction Flow"
  | "Facilities & Storages"
  | "Queues & Delays"
  | "Routing & Logic"
  | "Statistics & Functions"
  | "Standard Numerical Attributes";

export interface GpssModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: GpssModelCategory;
  archetypeId: GpssArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<GpssModelCategory, { fill: string; stroke: string; badge: string }> = {
  "Transaction Flow": { fill: "#1e3a5f", stroke: "#60a5fa", badge: "XACT" },
  "Facilities & Storages": { fill: "#4a1d1d", stroke: "#f97316", badge: "RES" },
  "Queues & Delays": { fill: "#163b3b", stroke: "#2dd4bf", badge: "QUE" },
  "Routing & Logic": { fill: "#2e2447", stroke: "#c084fc", badge: "FLOW" },
  "Statistics & Functions": { fill: "#3b2f16", stroke: "#facc15", badge: "STAT" },
  "Standard Numerical Attributes": { fill: "#1e3f2f", stroke: "#34d399", badge: "SNA" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for a GPSS block or SNA.
 */
export function generateGpssBlockSvg(modelType: string, category: GpssModelCategory): string {
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

function defaultPortsForSpec(spec: GpssModelSpec): DiagramPortSpec[] {
  if (spec.category === "Standard Numerical Attributes") {
    return [{ name: "value", kind: "signal", side: "right", dx: 88, dy: 26 }];
  }
  if (spec.modelType === "GENERATE") {
    return [{ name: "out", kind: "event", side: "right", dx: 88, dy: 26 }];
  }
  if (spec.modelType === "TERMINATE") {
    return [{ name: "in", kind: "event", side: "left", dx: 0, dy: 26 }];
  }
  if (spec.modelType === "TRANSFER" || spec.modelType === "SPLIT") {
    return [
      { name: "in", kind: "event", side: "left", dx: 0, dy: 26 },
      { name: "primary", kind: "event", side: "right", dx: 88, dy: 16 },
      { name: "alternate", kind: "event", side: "right", dx: 88, dy: 36 },
    ];
  }
  return [
    { name: "in", kind: "event", side: "left", dx: 0, dy: 26 },
    { name: "out", kind: "event", side: "right", dx: 88, dy: 26 },
  ];
}

export const GPSS_MODEL_SPECS: GpssModelSpec[] = [
  // ─── Transaction Flow ──────────────────────────────────────────────────────
  {
    modelType: "GENERATE",
    aliases: ["GEN"],
    label: "GENERATE Transaction Source",
    category: "Transaction Flow",
    archetypeId: GpssArchetypeId.GENERATE,
    description: "Creates transactions entering the simulation with mean interarrival time A and spread/modifier B.",
    provenance: "Geoffrey Gordon (1961) GPSS / Schriber (1974) Ch. 2",
    params: [
      ["mean", 18.0, "time", "Operand A: Mean interarrival time"],
      ["spread", 6.0, "time", "Operand B: Half-width uniform spread or modifier"],
      ["offset", 0.0, "time", "Operand C: First arrival offset time"],
      ["limit", 0.0, "count", "Operand D: Maximum transaction count (0 = unlimited)"],
      ["priority", 0.0, "level", "Operand E: Transaction priority level"],
    ],
  },
  {
    modelType: "TERMINATE",
    aliases: ["TERM"],
    label: "TERMINATE Transaction Sink",
    category: "Transaction Flow",
    archetypeId: GpssArchetypeId.TERMINATE,
    description: "Destroys entering transaction and decrements the simulation termination counter by operand A.",
    provenance: "Geoffrey Gordon (1961) GPSS / Schriber (1974) Ch. 2",
    params: [["decrement", 1.0, "count", "Operand A: Termination counter decrement"]],
  },
  {
    modelType: "SPLIT",
    label: "SPLIT Transaction Cloner",
    category: "Transaction Flow",
    archetypeId: GpssArchetypeId.SPLIT,
    description: "Creates A offspring copies of the entering transaction routed to block label B.",
    provenance: "IBM GPSS/360 & GPSS V Reference Manual",
    params: [["copies", 1.0, "count", "Operand A: Number of offspring transactions"]],
  },
  {
    modelType: "ASSEMBLE",
    label: "ASSEMBLE Transaction Synchronizer",
    category: "Transaction Flow",
    archetypeId: GpssArchetypeId.ASSEMBLE,
    description: "Synchronizes and merges A transactions belonging to the same assembly set.",
    provenance: "IBM GPSS/360 & GPSS V Reference Manual",
    params: [["count", 2.0, "count", "Operand A: Number of assembly-set transactions to merge"]],
  },

  // ─── Facilities & Storages ─────────────────────────────────────────────────
  {
    modelType: "SEIZE",
    label: "SEIZE Single-Server Facility",
    category: "Facilities & Storages",
    archetypeId: GpssArchetypeId.SEIZE,
    description: "Acquires exclusive ownership of a single-server facility (capacity 1), blocking if busy.",
    provenance: "Geoffrey Gordon (1961) GPSS / Schriber (1974) Ch. 2",
    params: [["capacity", 1.0, "servers", "Fixed single-server facility capacity"]],
  },
  {
    modelType: "RELEASE",
    label: "RELEASE Single-Server Facility",
    category: "Facilities & Storages",
    archetypeId: GpssArchetypeId.RELEASE,
    description: "Frees a previously seized single-server facility for the next waiting transaction.",
    provenance: "Geoffrey Gordon (1961) GPSS / Schriber (1974) Ch. 2",
    params: [["capacity", 1.0, "servers", "Released facility capacity"]],
  },
  {
    modelType: "ENTER",
    label: "ENTER Multi-Server Storage",
    category: "Facilities & Storages",
    archetypeId: GpssArchetypeId.ENTER,
    description:
      "Allocates B units (default 1) of multi-server storage A, blocking if remaining capacity is insufficient.",
    provenance: "IBM GPSS/360 & GPSS V Reference Manual",
    params: [["units", 1.0, "units", "Operand B: Storage units requested"]],
  },
  {
    modelType: "LEAVE",
    label: "LEAVE Multi-Server Storage",
    category: "Facilities & Storages",
    archetypeId: GpssArchetypeId.LEAVE,
    description: "Returns B units (default 1) to multi-server storage A.",
    provenance: "IBM GPSS/360 & GPSS V Reference Manual",
    params: [["units", 1.0, "units", "Operand B: Storage units released"]],
  },
  {
    modelType: "STORAGE",
    label: "STORAGE Capacity Definition",
    category: "Facilities & Storages",
    archetypeId: GpssArchetypeId.STORAGE,
    description: "Declares the total server capacity of a multi-server GPSS storage entity.",
    provenance: "IBM GPSS/360 & GPSS V Reference Manual",
    params: [["capacity", 1.0, "servers", "Total server capacity c > 0"]],
  },

  // ─── Queues & Delays ───────────────────────────────────────────────────────
  {
    modelType: "ADVANCE",
    aliases: ["ADV"],
    label: "ADVANCE Time Delay",
    category: "Queues & Delays",
    archetypeId: GpssArchetypeId.ADVANCE,
    description: "Delays transaction on the Future Events Chain for mean time A with spread/modifier B.",
    provenance: "Geoffrey Gordon (1961) GPSS / Schriber (1974) Ch. 2",
    params: [
      ["mean", 16.0, "time", "Operand A: Mean service or transit duration"],
      ["spread", 4.0, "time", "Operand B: Half-width uniform spread or modifier"],
    ],
  },
  {
    modelType: "QUEUE",
    label: "QUEUE Waiting-Line Entry",
    category: "Queues & Delays",
    archetypeId: GpssArchetypeId.QUEUE,
    description: "Increments waiting-line statistics for queue A by B units (default 1).",
    provenance: "Geoffrey Gordon (1961) GPSS / Schriber (1974) Ch. 2",
    params: [["units", 1.0, "units", "Operand B: Queue occupancy increment"]],
  },
  {
    modelType: "DEPART",
    label: "DEPART Waiting-Line Exit",
    category: "Queues & Delays",
    archetypeId: GpssArchetypeId.DEPART,
    description: "Decrements waiting-line statistics for queue A by B units (default 1) and records wait time.",
    provenance: "Geoffrey Gordon (1961) GPSS / Schriber (1974) Ch. 2",
    params: [["units", 1.0, "units", "Operand B: Queue occupancy decrement"]],
  },

  // ─── Routing & Logic ───────────────────────────────────────────────────────
  {
    modelType: "TRANSFER",
    label: "TRANSFER Routing Block",
    category: "Routing & Logic",
    archetypeId: GpssArchetypeId.TRANSFER,
    description: "Routes transaction unconditionally (,B), statistically (p,B,C), or conditionally (BOTH,B,C).",
    provenance: "IBM GPSS/360 & GPSS V Reference Manual",
    params: [["probability", 0.5, "1", "Operand A: Branch probability for statistical transfer"]],
  },
  {
    modelType: "ASSIGN",
    label: "ASSIGN Transaction Parameter",
    category: "Routing & Logic",
    archetypeId: GpssArchetypeId.ASSIGN,
    description: "Sets or modifies transaction parameter A to value B.",
    provenance: "IBM GPSS/360 & GPSS V Reference Manual",
    params: [["value", 0.0, "1", "Operand B: Assigned numeric value"]],
  },
  {
    modelType: "TEST",
    label: "TEST Relational Condition",
    category: "Routing & Logic",
    archetypeId: GpssArchetypeId.TEST,
    description: "Evaluates relational test (E, NE, G, GE, L, LE) between A and B; blocks or diverts to C if false.",
    provenance: "IBM GPSS/360 & GPSS V Reference Manual",
    params: [["threshold", 0.0, "1", "Operand B: Comparison threshold"]],
  },
  {
    modelType: "GATE",
    label: "GATE Entity State Condition",
    category: "Routing & Logic",
    archetypeId: GpssArchetypeId.GATE,
    description: "Tests facility/storage state (NU, U, SNF, SF, SE, SNE); blocks or diverts to B if false.",
    provenance: "IBM GPSS/360 & GPSS V Reference Manual",
    params: [["mode", 0.0, "1", "Gate predicate mode"]],
  },

  // ─── Statistics & Functions ────────────────────────────────────────────────
  {
    modelType: "TABULATE",
    label: "TABULATE Histogram Observation",
    category: "Statistics & Functions",
    archetypeId: GpssArchetypeId.TABULATE,
    description: "Records an observation into frequency distribution TABLE A with weight B.",
    provenance: "IBM GPSS/360 & GPSS V Reference Manual",
    params: [["weight", 1.0, "1", "Operand B: Observation weight"]],
  },
  {
    modelType: "TABLE",
    label: "TABLE Frequency Distribution",
    category: "Statistics & Functions",
    archetypeId: GpssArchetypeId.TABLE,
    description: "Defines a histogram table recording sample mean, standard deviation, and frequency classes.",
    provenance: "IBM GPSS/360 & GPSS V Reference Manual",
    params: [
      ["firstUpperLimit", 10.0, "1", "Operand B: Upper limit of first frequency class"],
      ["width", 10.0, "1", "Operand C: Class interval width"],
      ["classCount", 20.0, "count", "Operand D: Total number of frequency classes"],
    ],
  },
  {
    modelType: "FUNCTION",
    aliases: ["FN$"],
    label: "FUNCTION Piecewise Empirical Curve",
    category: "Statistics & Functions",
    archetypeId: GpssArchetypeId.FUNCTION,
    description: "Defines a continuous (C) or discrete (D) piecewise-linear empirical distribution function.",
    provenance: "IBM GPSS/360 & GPSS V Reference Manual",
    params: [["points", 24.0, "count", "Number of (x, y) breakpoint pairs"]],
  },

  // ─── Standard Numerical Attributes (SNAs) ──────────────────────────────────
  {
    modelType: "Q$",
    aliases: ["Q", "QUEUE_LENGTH"],
    label: "Q$ Current Queue Length SNA",
    category: "Standard Numerical Attributes",
    archetypeId: GpssArchetypeId.SNA_Q,
    description: "Standard Numerical Attribute returning current number of transactions waiting in queue.",
    provenance: "IBM GPSS/360 Standard Numerical Attributes",
    params: [["length", 0.0, "transactions", "Current queue contents Q$j"]],
  },
  {
    modelType: "F$",
    aliases: ["F", "FACILITY_STATUS"],
    label: "F$ Facility Status SNA",
    category: "Standard Numerical Attributes",
    archetypeId: GpssArchetypeId.SNA_F,
    description: "Standard Numerical Attribute returning 1 if facility is busy (seized) or 0 if idle.",
    provenance: "IBM GPSS/360 Standard Numerical Attributes",
    params: [["busy", 0.0, "0..1", "Facility status indicator F$j (0 = idle, 1 = busy)"]],
  },
  {
    modelType: "S$",
    aliases: ["S", "STORAGE_CONTENTS"],
    label: "S$ Current Storage Contents SNA",
    category: "Standard Numerical Attributes",
    archetypeId: GpssArchetypeId.SNA_S,
    description: "Standard Numerical Attribute returning current occupied units in multi-server storage.",
    provenance: "IBM GPSS/360 Standard Numerical Attributes",
    params: [["contents", 0.0, "units", "Current occupied storage units S$j"]],
  },
  {
    modelType: "R$",
    aliases: ["R", "STORAGE_REMAINING"],
    label: "R$ Remaining Storage Capacity SNA",
    category: "Standard Numerical Attributes",
    archetypeId: GpssArchetypeId.SNA_R,
    description: "Standard Numerical Attribute returning remaining available units (capacity - S$j) in storage.",
    provenance: "IBM GPSS/360 Standard Numerical Attributes",
    params: [["remaining", 1.0, "units", "Remaining free storage capacity R$j"]],
  },
  {
    modelType: "FR$",
    aliases: ["FR", "FACILITY_UTILIZATION"],
    label: "FR$ Facility Utilization SNA",
    category: "Standard Numerical Attributes",
    archetypeId: GpssArchetypeId.SNA_FR,
    description:
      "Standard Numerical Attribute returning time-averaged facility utilization in parts per thousand (0–1000).",
    provenance: "IBM GPSS/360 Standard Numerical Attributes",
    params: [["utilizationPpt", 0.0, "permille", "Facility utilization FR$j (0..1000)"]],
  },
  {
    modelType: "SR$",
    aliases: ["SR", "STORAGE_UTILIZATION"],
    label: "SR$ Storage Utilization SNA",
    category: "Standard Numerical Attributes",
    archetypeId: GpssArchetypeId.SNA_SR,
    description:
      "Standard Numerical Attribute returning time-averaged storage utilization in parts per thousand (0–1000).",
    provenance: "IBM GPSS/360 Standard Numerical Attributes",
    params: [["utilizationPpt", 0.0, "permille", "Storage utilization SR$j (0..1000)"]],
  },
];

/**
 * Converts `GPSS_MODEL_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG block icons and port layouts.
 */
export function buildGpssCleanroomSchemas(): CleanroomModelSchema[] {
  return GPSS_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `gpss:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "discrete-event",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: spec.category === "Standard Numerical Attributes" ? "gpss_sna" : "gpss_block",
      width: 88,
      height: 52,
      svg: generateGpssBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForSpec(spec),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
