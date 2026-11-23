// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Cleanroom Lustre/SCADE temporal operator archetype IDs matching `assets/lustre-std-lib/src/models.ts`.
 */
export const LustreArchetypeId = {
  EDGE: 1,
  RISING_EDGE: 2,
  FALLING_EDGE: 3,
  COUNTER: 4,
  TIMER: 5,
  INTEGRATOR_EULER: 6,
  PID_DISCRETE: 7,
  LATCH: 8,
  ONCE_SINCE: 9,
} as const;

export type LustreArchetypeId = (typeof LustreArchetypeId)[keyof typeof LustreArchetypeId];

export type LustreOperatorCategory = "Edge & Boolean" | "Counters & Timers" | "Discrete Control" | "Temporal Logic";

export interface LustreOperatorSpec {
  name: string;
  aliases?: string[];
  label: string;
  category: LustreOperatorCategory;
  archetypeId: LustreArchetypeId;
  description: string;
  provenance: string;
  inputs: Array<{ name: string; type: "bool" | "int" | "real" }>;
  outputs: Array<{ name: string; type: "bool" | "int" | "real" }>;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
  lustreDefinition: string;
}

const CATEGORY_COLORS: Record<LustreOperatorCategory, { fill: string; stroke: string; badge: string }> = {
  "Edge & Boolean": { fill: "#1e293b", stroke: "#38bdf8", badge: "EDGE" },
  "Counters & Timers": { fill: "#1e3a5f", stroke: "#60a5fa", badge: "CNT" },
  "Discrete Control": { fill: "#163b3b", stroke: "#2dd4bf", badge: "CTRL" },
  "Temporal Logic": { fill: "#2e2447", stroke: "#c084fc", badge: "TEMP" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for a Lustre temporal operator.
 */
export function generateLustreBlockSvg(name: string, category: LustreOperatorCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = name.slice(0, 12);
  const fontSize = label.length > 9 ? "7.8" : "9.0";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 52" width="96" height="52">` +
    `<rect x="2" y="2" width="92" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="30" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="21" y="15" text-anchor="middle" font-family="monospace" font-size="7.0" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="48" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function portsForOperator(spec: LustreOperatorSpec): DiagramPortSpec[] {
  const ports: DiagramPortSpec[] = [];
  const inCount = Math.max(1, spec.inputs.length);
  for (let i = 0; i < spec.inputs.length; i++) {
    const inp = spec.inputs[i]!;
    const dy = Math.round(((i + 1) / (inCount + 1)) * 52);
    ports.push({ name: inp.name, kind: "signal", side: "left", dx: 0, dy });
  }
  const outCount = Math.max(1, spec.outputs.length);
  for (let i = 0; i < spec.outputs.length; i++) {
    const out = spec.outputs[i]!;
    const dy = Math.round(((i + 1) / (outCount + 1)) * 52);
    ports.push({ name: out.name, kind: "signal", side: "right", dx: 96, dy });
  }
  return ports;
}

export const LUSTRE_OPERATOR_SPECS: LustreOperatorSpec[] = [
  {
    name: "Edge",
    aliases: ["AnyEdge", "edge"],
    label: "Boolean Edge Detector",
    category: "Edge & Boolean",
    archetypeId: LustreArchetypeId.EDGE,
    description: "Emits true whenever the boolean input changes value relative to the previous synchronous tick.",
    provenance: "Halbwachs et al., The Synchronous Dataflow Programming Language LUSTRE (Proc. IEEE, 1991)",
    inputs: [{ name: "x", type: "bool" }],
    outputs: [{ name: "y", type: "bool" }],
    params: [],
    lustreDefinition: "node Edge(x: bool) returns (y: bool); let y = false -> (x <> pre(x)); tel",
  },
  {
    name: "RisingEdge",
    aliases: ["REdge", "rising_edge", "PosEdge"],
    label: "Rising Edge Detector",
    category: "Edge & Boolean",
    archetypeId: LustreArchetypeId.RISING_EDGE,
    description: "Emits true on the exact tick where boolean input transitions from false to true.",
    provenance: "Halbwachs et al., LUSTRE (Proc. IEEE, 1991) / SCADE Standard Digital Library",
    inputs: [{ name: "x", type: "bool" }],
    outputs: [{ name: "y", type: "bool" }],
    params: [],
    lustreDefinition: "node RisingEdge(x: bool) returns (y: bool); let y = false -> (x and not pre(x)); tel",
  },
  {
    name: "FallingEdge",
    aliases: ["FEdge", "falling_edge", "NegEdge"],
    label: "Falling Edge Detector",
    category: "Edge & Boolean",
    archetypeId: LustreArchetypeId.FALLING_EDGE,
    description: "Emits true on the exact tick where boolean input transitions from true to false.",
    provenance: "Halbwachs et al., LUSTRE (Proc. IEEE, 1991) / SCADE Standard Digital Library",
    inputs: [{ name: "x", type: "bool" }],
    outputs: [{ name: "y", type: "bool" }],
    params: [],
    lustreDefinition: "node FallingEdge(x: bool) returns (y: bool); let y = false -> (not x and pre(x)); tel",
  },
  {
    name: "Counter",
    aliases: ["Count", "UpCounter"],
    label: "Resettable Synchronous Counter",
    category: "Counters & Timers",
    archetypeId: LustreArchetypeId.COUNTER,
    description: "Resettable integer counter initialized to init and incremented by incr on each tick.",
    provenance: "Halbwachs et al., LUSTRE (Proc. IEEE, 1991)",
    inputs: [
      { name: "init", type: "int" },
      { name: "incr", type: "int" },
      { name: "reset", type: "bool" },
    ],
    outputs: [{ name: "n", type: "int" }],
    params: [
      ["init", 0, "1", "Initial counter value"],
      ["incr", 1, "1", "Counter increment per tick"],
    ],
    lustreDefinition:
      "node Counter(init, incr: int; reset: bool) returns (n: int); let n = if reset then init else (init -> pre(n) + incr); tel",
  },
  {
    name: "Timer",
    aliases: ["CountdownTimer", "ElapsedTimer"],
    label: "Synchronous Tick Timer",
    category: "Counters & Timers",
    archetypeId: LustreArchetypeId.TIMER,
    description: "Counts synchronous ticks since reset and raises expired when elapsed >= limit.",
    provenance: "Lustre/SCADE Standard Temporal Operators",
    inputs: [
      { name: "reset", type: "bool" },
      { name: "limit", type: "int" },
    ],
    outputs: [{ name: "expired", type: "bool" }],
    params: [["limit", 10, "ticks", "Timeout threshold in synchronous ticks"]],
    lustreDefinition:
      "node Timer(reset: bool; limit: int) returns (expired: bool); var c: int; let c = if reset then 0 else (0 -> pre(c) + 1); expired = c >= limit; tel",
  },
  {
    name: "IntegratorEuler",
    aliases: ["DiscreteIntegrator", "EulerIntegrator"],
    label: "Discrete Euler Integrator",
    category: "Discrete Control",
    archetypeId: LustreArchetypeId.INTEGRATOR_EULER,
    description: "Forward-Euler synchronous discrete integrator y[k] = y0 -> pre(y) + dt * u.",
    provenance: "SCADE / Lustre Discrete-Time Control Library",
    inputs: [
      { name: "u", type: "real" },
      { name: "dt", type: "real" },
      { name: "y0", type: "real" },
    ],
    outputs: [{ name: "y", type: "real" }],
    params: [
      ["dt", 0.01, "s", "Sample period"],
      ["y0", 0.0, "1", "Initial integrator state"],
    ],
    lustreDefinition: "node IntegratorEuler(u, dt, y0: real) returns (y: real); let y = y0 -> (pre(y) + dt * u); tel",
  },
  {
    name: "PIDDiscrete",
    aliases: ["PID", "DiscretePID"],
    label: "Discrete PID Controller",
    category: "Discrete Control",
    archetypeId: LustreArchetypeId.PID_DISCRETE,
    description: "Discrete-time proportional-integral-derivative controller with anti-windup output clamping.",
    provenance: "Åström & Hägglund / SCADE Discrete Control Library",
    inputs: [
      { name: "err", type: "real" },
      { name: "dt", type: "real" },
    ],
    outputs: [{ name: "u", type: "real" }],
    params: [
      ["kp", 1.0, "1", "Proportional gain"],
      ["ki", 0.1, "1/s", "Integral gain"],
      ["kd", 0.01, "s", "Derivative gain"],
      ["outMin", -100.0, "1", "Lower output saturation"],
      ["outMax", 100.0, "1", "Upper output saturation"],
    ],
    lustreDefinition:
      "node PIDDiscrete(err, dt: real) returns (u: real); var i_acc, d_err: real; let i_acc = 0.0 -> (pre(i_acc) + err * dt); d_err = 0.0 -> ((err - pre(err)) / dt); u = err + 0.1 * i_acc + 0.01 * d_err; tel",
  },
  {
    name: "Latch",
    aliases: ["SRLatch", "FlipFlop", "Bistable"],
    label: "Synchronous SR Latch",
    category: "Edge & Boolean",
    archetypeId: LustreArchetypeId.LATCH,
    description: "Set-dominant synchronous boolean latch initialized to init.",
    provenance: "Halbwachs et al., LUSTRE (Proc. IEEE, 1991)",
    inputs: [
      { name: "set", type: "bool" },
      { name: "reset", type: "bool" },
      { name: "init", type: "bool" },
    ],
    outputs: [{ name: "q", type: "bool" }],
    params: [["init", 0, "bool", "Initial latch state (0=false, 1=true)"]],
    lustreDefinition:
      "node Latch(set, reset, init: bool) returns (q: bool); let q = if set then true else if reset then false else (init -> pre(q)); tel",
  },
  {
    name: "OnceSince",
    aliases: ["once_since", "Since"],
    label: "OnceSince Temporal Observer",
    category: "Temporal Logic",
    archetypeId: LustreArchetypeId.ONCE_SINCE,
    description:
      "Synchronous observer returning true iff A has been true at least once since the last occurrence of B.",
    provenance:
      "Halbwachs, Lagnier & Raymond, Synchronous Observers and the Verification of Reactive Systems (AMAST, 1993)",
    inputs: [
      { name: "a", type: "bool" },
      { name: "b", type: "bool" },
    ],
    outputs: [{ name: "y", type: "bool" }],
    params: [],
    lustreDefinition:
      "node OnceSince(a, b: bool) returns (y: bool); let y = if b then a else (a -> (a or pre(y))); tel",
  },
];

/**
 * Builds `CleanroomModelSchema[]` for `@modelscript/lustre-std-lib`.
 */
export function buildLustreCleanroomSchemas(): CleanroomModelSchema[] {
  return LUSTRE_OPERATOR_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: unit === "bool" ? "boolean" : unit === "ticks" ? "integer" : "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `Lustre.Std.${spec.name}`,
      name: spec.name,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "controls",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Node",
      width: 96,
      height: 52,
      svg: generateLustreBlockSvg(spec.name, spec.category),
      ports: portsForOperator(spec),
      parameters,
      wasmKernel: "lustreOpStep",
      extra: {
        archetypeId: spec.archetypeId,
        inputs: spec.inputs,
        outputs: spec.outputs,
        lustreDefinition: spec.lustreDefinition,
      },
    };
  });
}
