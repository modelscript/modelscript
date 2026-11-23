// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * SIMSCRIPT II.5 cleanroom standard library archetype IDs matching `assets/simscript-std-lib/src/models.ts`.
 */
export const SimscriptArchetypeId = {
  // Stochastic Distributions
  EXPONENTIAL_F: 1,
  NORMAL_F: 2,
  UNIFORM_F: 3,
  POISSON_F: 4,
  ERLANG_F: 5,
  // Set Primitives
  FIFO_SET: 10,
  LIFO_SET: 11,
  RANKED_SET: 12,
  // Resource Primitives
  RESOURCE: 20,
  PREEMPTIVE_RESOURCE: 21,
  // Statistics Collectors
  TALLY: 30,
  ACCUMULATE: 31,
} as const;

export type SimscriptArchetypeId = (typeof SimscriptArchetypeId)[keyof typeof SimscriptArchetypeId];

export type SimscriptModelCategory =
  "Distributions" | "Set Primitives" | "Resource Primitives" | "Statistics Collectors";

export interface SimscriptModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: SimscriptModelCategory;
  archetypeId: SimscriptArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<SimscriptModelCategory, { fill: string; stroke: string; badge: string }> = {
  Distributions: { fill: "#1e293b", stroke: "#38bdf8", badge: "DIST" },
  "Set Primitives": { fill: "#1e3a2f", stroke: "#34d399", badge: "SET" },
  "Resource Primitives": { fill: "#3b1d2e", stroke: "#f472b6", badge: "RES" },
  "Statistics Collectors": { fill: "#362b16", stroke: "#fbbf24", badge: "STAT" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for a SIMSCRIPT II.5 library primitive.
 */
export function generateSimscriptBlockSvg(modelType: string, category: SimscriptModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 12);
  const fontSize = label.length > 9 ? "7.8" : "9.2";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 52" width="96" height="52">` +
    `<rect x="2" y="2" width="92" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="30" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="21" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="48" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForSpec(spec: SimscriptModelSpec): DiagramPortSpec[] {
  switch (spec.category) {
    case "Distributions":
      return [
        { name: "stream_in", kind: "signal", side: "left", dx: 0, dy: 26 },
        { name: "sample_out", kind: "signal", side: "right", dx: 96, dy: 26 },
      ];
    case "Set Primitives":
      return [
        { name: "file_in", kind: "event", side: "left", dx: 0, dy: 26 },
        { name: "remove_out", kind: "event", side: "right", dx: 96, dy: 26 },
      ];
    case "Resource Primitives":
      return [
        { name: "request_in", kind: "event", side: "left", dx: 0, dy: 18 },
        { name: "relinquish_in", kind: "event", side: "left", dx: 0, dy: 34 },
        { name: "grant_out", kind: "event", side: "right", dx: 96, dy: 26 },
      ];
    case "Statistics Collectors":
      return [
        { name: "observe_in", kind: "signal", side: "left", dx: 0, dy: 26 },
        { name: "mean_out", kind: "signal", side: "right", dx: 96, dy: 26 },
      ];
  }
}

export const SIMSCRIPT_STD_SPECS: readonly SimscriptModelSpec[] = [
  {
    modelType: "EXPONENTIAL.F",
    aliases: ["EXPONENTIAL", "EXP.F"],
    label: "Exponential Distribution",
    category: "Distributions",
    archetypeId: SimscriptArchetypeId.EXPONENTIAL_F,
    description:
      "SIMSCRIPT II.5 exponential random variate generator EXPONENTIAL.F(mean, stream) with PDF f(x) = (1/mean)*exp(-x/mean).",
    provenance: "RAND RM-5776-PR / Kiviat, Villanueva, Markowitz (1968) — SIMSCRIPT II.5",
    params: [
      ["MEAN", 1.0, "time", "Mean inter-event or service time (> 0)"],
      ["STREAM", 1, "1", "Pseudo-random number stream index (1..10)"],
    ],
  },
  {
    modelType: "NORMAL.F",
    aliases: ["NORMAL", "GAUSS.F"],
    label: "Normal Distribution",
    category: "Distributions",
    archetypeId: SimscriptArchetypeId.NORMAL_F,
    description:
      "SIMSCRIPT II.5 Gaussian/normal random variate generator NORMAL.F(mean, std_dev, stream) via Box-Muller transform.",
    provenance: "RAND RM-5776-PR / Kiviat, Villanueva, Markowitz (1968) — SIMSCRIPT II.5",
    params: [
      ["MEAN", 0.0, "1", "Distribution mean"],
      ["STD_DEV", 1.0, "1", "Standard deviation (> 0)"],
      ["STREAM", 1, "1", "Pseudo-random number stream index"],
    ],
  },
  {
    modelType: "UNIFORM.F",
    aliases: ["UNIFORM", "UNIF.F"],
    label: "Uniform Distribution",
    category: "Distributions",
    archetypeId: SimscriptArchetypeId.UNIFORM_F,
    description:
      "SIMSCRIPT II.5 continuous uniform random variate generator UNIFORM.F(min, max, stream) over [min, max].",
    provenance: "RAND RM-5776-PR / Kiviat, Villanueva, Markowitz (1968) — SIMSCRIPT II.5",
    params: [
      ["MIN", 0.0, "1", "Lower bound"],
      ["MAX", 1.0, "1", "Upper bound (> MIN)"],
      ["STREAM", 1, "1", "Pseudo-random number stream index"],
    ],
  },
  {
    modelType: "POISSON.F",
    aliases: ["POISSON", "POIS.F"],
    label: "Poisson Distribution",
    category: "Distributions",
    archetypeId: SimscriptArchetypeId.POISSON_F,
    description:
      "SIMSCRIPT II.5 discrete Poisson random variate generator POISSON.F(mean, stream) with P(X=k) = e^-mean * mean^k / k!.",
    provenance: "RAND RM-5776-PR / Kiviat, Villanueva, Markowitz (1968) — SIMSCRIPT II.5",
    params: [
      ["MEAN", 1.0, "1", "Expected count lambda (> 0)"],
      ["STREAM", 1, "1", "Pseudo-random number stream index"],
    ],
  },
  {
    modelType: "ERLANG.F",
    aliases: ["ERLANG", "ERL.F"],
    label: "Erlang-k Distribution",
    category: "Distributions",
    archetypeId: SimscriptArchetypeId.ERLANG_F,
    description:
      "SIMSCRIPT II.5 Erlang-k random variate generator ERLANG.F(mean, k, stream) as sum of k exponential stages.",
    provenance: "RAND RM-5776-PR / Kiviat, Villanueva, Markowitz (1968) — SIMSCRIPT II.5",
    params: [
      ["MEAN", 1.0, "time", "Total mean across k stages (> 0)"],
      ["K", 2, "1", "Shape parameter / number of exponential stages (integer >= 1)"],
      ["STREAM", 1, "1", "Pseudo-random number stream index"],
    ],
  },
  {
    modelType: "FIFO.SET",
    aliases: ["FIFO_SET", "FIFO"],
    label: "FIFO Entity Set",
    category: "Set Primitives",
    archetypeId: SimscriptArchetypeId.FIFO_SET,
    description:
      "SIMSCRIPT II.5 First-In-First-Out entity set supporting FILE ... IN and REMOVE FIRST ... FROM operations.",
    provenance: "RAND RM-5776-PR — SIMSCRIPT II.5 Set Management",
    params: [["INITIAL_SIZE", 0, "1", "Initial number of filed entities"]],
  },
  {
    modelType: "LIFO.SET",
    aliases: ["LIFO_SET", "LIFO"],
    label: "LIFO Entity Set",
    category: "Set Primitives",
    archetypeId: SimscriptArchetypeId.LIFO_SET,
    description:
      "SIMSCRIPT II.5 Last-In-First-Out stack entity set supporting FILE ... IN and REMOVE FIRST ... FROM operations.",
    provenance: "RAND RM-5776-PR — SIMSCRIPT II.5 Set Management",
    params: [["INITIAL_SIZE", 0, "1", "Initial number of filed entities"]],
  },
  {
    modelType: "RANKED.SET",
    aliases: ["RANKED_SET", "RANKED"],
    label: "Ranked Priority Set",
    category: "Set Primitives",
    archetypeId: SimscriptArchetypeId.RANKED_SET,
    description: "SIMSCRIPT II.5 attribute-ranked entity set ordered by ascending or descending priority key.",
    provenance: "RAND RM-5776-PR — SIMSCRIPT II.5 Set Management",
    params: [
      ["INITIAL_SIZE", 0, "1", "Initial number of filed entities"],
      ["HIGH_FIRST", 0, "1", "0 = ascending (LOW), 1 = descending (HIGH)"],
    ],
  },
  {
    modelType: "RESOURCE",
    aliases: ["SIMSCRIPT.RESOURCE", "SERVER_POOL"],
    label: "Multi-Unit Resource Pool",
    category: "Resource Primitives",
    archetypeId: SimscriptArchetypeId.RESOURCE,
    description:
      "SIMSCRIPT II.5 multi-server resource pool managed via REQUEST and RELINQUISH with automatic FIFO queueing (U.RES, N.X.RES, N.Q.RES).",
    provenance: "RAND RM-5776-PR / CACI SIMSCRIPT II.5 Process Interaction",
    params: [
      ["CAPACITY", 1, "units", "Total resource units U.<resource>"],
      ["ARRIVAL_RATE", 0.5, "1/time", "Nominal arrival rate lambda"],
      ["SERVICE_RATE", 1.0, "1/time", "Per-server service rate mu"],
    ],
  },
  {
    modelType: "PREEMPTIVE.RESOURCE",
    aliases: ["PREEMPTIVE_RESOURCE"],
    label: "Preemptive Resource Pool",
    category: "Resource Primitives",
    archetypeId: SimscriptArchetypeId.PREEMPTIVE_RESOURCE,
    description:
      "SIMSCRIPT II.5 priority-preemptive resource pool supporting REQUEST ... WITH PRIORITY and resume-on-relinquish.",
    provenance: "CACI SIMSCRIPT II.5 Process Interaction",
    params: [
      ["CAPACITY", 1, "units", "Total resource units"],
      ["ARRIVAL_RATE", 0.5, "1/time", "Nominal arrival rate lambda"],
      ["SERVICE_RATE", 1.0, "1/time", "Per-server service rate mu"],
    ],
  },
  {
    modelType: "TALLY",
    aliases: ["TALLY.STAT"],
    label: "Observation Tally Collector",
    category: "Statistics Collectors",
    archetypeId: SimscriptArchetypeId.TALLY,
    description:
      "SIMSCRIPT II.5 observation-based statistics collector (TALLY ... AS THE MEAN/MAX/MIN/NUMBER/STD.DEV OF ...).",
    provenance: "RAND RM-5776-PR — SIMSCRIPT II.5 Automatic Statistics",
    params: [["INITIAL_VALUE", 0.0, "1", "Initial observed value"]],
  },
  {
    modelType: "ACCUMULATE",
    aliases: ["ACCUMULATE.STAT"],
    label: "Time-Weighted Accumulate Collector",
    category: "Statistics Collectors",
    archetypeId: SimscriptArchetypeId.ACCUMULATE,
    description:
      "SIMSCRIPT II.5 time-persistent statistics collector (ACCUMULATE ... AS THE MEAN/MAX/MIN OF ...) integrating state over simulation time.",
    provenance: "RAND RM-5776-PR — SIMSCRIPT II.5 Automatic Statistics",
    params: [["INITIAL_VALUE", 0.0, "1", "Initial state value"]],
  },
];

/**
 * Builds the declarative `CleanroomModelSchema[]` array for `@modelscript/simscript-std-lib`.
 */
export function buildSimscriptCleanroomSchemas(): CleanroomModelSchema[] {
  return SIMSCRIPT_STD_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `SIMSCRIPT.${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "discrete-event-simulation",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Class",
      width: 96,
      height: 52,
      svg: generateSimscriptBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForSpec(spec),
      parameters,
      wasmKernel: "evalSlot",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}
