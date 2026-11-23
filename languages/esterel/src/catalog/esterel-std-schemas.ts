// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Esterel cleanroom reactive pattern archetype IDs matching `assets/esterel-std-lib/src/models.ts`.
 */
export const EsterelArchetypeId = {
  ABRO: 1,
  WATCHDOG: 2,
  DEBOUNCER: 3,
  ARBITER: 4,
  TIMEOUT: 5,
  STOPWATCH: 6,
} as const;

export type EsterelArchetypeId = (typeof EsterelArchetypeId)[keyof typeof EsterelArchetypeId];

export type EsterelPatternCategory =
  "Synchronization" | "Preemption & Timing" | "Signal Conditioning" | "Arbitration & Control";

export interface EsterelPatternSpec {
  patternType: string;
  aliases?: string[];
  label: string;
  category: EsterelPatternCategory;
  archetypeId: EsterelArchetypeId;
  description: string;
  provenance: string;
  inputs: string[];
  outputs: string[];
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
  esterelSource: string;
}

const CATEGORY_COLORS: Record<EsterelPatternCategory, { fill: string; stroke: string; badge: string }> = {
  Synchronization: { fill: "#1e3a5f", stroke: "#60a5fa", badge: "SYNC" },
  "Preemption & Timing": { fill: "#4a1d1d", stroke: "#f97316", badge: "TIME" },
  "Signal Conditioning": { fill: "#163b3b", stroke: "#2dd4bf", badge: "COND" },
  "Arbitration & Control": { fill: "#2e2447", stroke: "#c084fc", badge: "CTRL" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for an Esterel reactive pattern.
 */
export function generateEsterelBlockSvg(patternType: string, category: EsterelPatternCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = patternType.toUpperCase().slice(0, 10);
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

export const ESTEREL_PATTERN_SPECS: readonly EsterelPatternSpec[] = [
  {
    patternType: "ABRO",
    aliases: ["BerryABRO", "SyncReset"],
    label: "ABRO Synchronizer",
    category: "Synchronization",
    archetypeId: EsterelArchetypeId.ABRO,
    description:
      "Gérard Berry's canonical Esterel benchmark: emits O as soon as both A and B have been received, restarting strongly on every R.",
    provenance: "Berry (1984 / 2000) Esterel Primer",
    inputs: ["A", "B", "R"],
    outputs: ["O"],
    params: [],
    esterelSource: [
      "module ABRO:",
      "input A, B, R;",
      "output O;",
      "loop",
      "  [ await A || await B ];",
      "  emit O",
      "each R",
      "end module",
    ].join("\n"),
  },
  {
    patternType: "Watchdog",
    aliases: ["WDT", "LivenessWatchdog"],
    label: "Reactive Watchdog",
    category: "Preemption & Timing",
    archetypeId: EsterelArchetypeId.WATCHDOG,
    description:
      "Monitors liveness kicks against a periodic tick clock; emits ALARM if DEADLINE ticks elapse before KICK arrives.",
    provenance: "Esterel v5 Preemption Patterns",
    inputs: ["TICK", "KICK", "RESET"],
    outputs: ["ALARM"],
    params: [["DEADLINE", 3, "ticks", "Number of ticks before emitting ALARM"]],
    esterelSource: [
      "module Watchdog:",
      "input TICK, KICK, RESET;",
      "output ALARM;",
      "loop",
      "  abort",
      "    await 3 TICK;",
      "    emit ALARM;",
      "    halt",
      "  when KICK end",
      "each RESET",
      "end module",
    ].join("\n"),
  },
  {
    patternType: "Debouncer",
    aliases: ["SignalDebouncer", "GlitchFilter"],
    label: "Input Debouncer",
    category: "Signal Conditioning",
    archetypeId: EsterelArchetypeId.DEBOUNCER,
    description:
      "Filters transient glitches on RAW by emitting STABLE only after N consecutive ticks with RAW present.",
    provenance: "Synchronous Reactive Control Library",
    inputs: ["RAW", "RESET"],
    outputs: ["STABLE"],
    params: [["COUNT", 2, "ticks", "Consecutive ticks required to confirm stability"]],
    esterelSource: [
      "module Debouncer:",
      "input RAW, RESET;",
      "output STABLE;",
      "loop",
      "  await RAW;",
      "  abort",
      "    await RAW;",
      "    emit STABLE",
      "  when not RAW end",
      "each RESET",
      "end module",
    ].join("\n"),
  },
  {
    patternType: "Arbiter",
    aliases: ["PriorityArbiter", "BusArbiter"],
    label: "Priority Bus Arbiter",
    category: "Arbitration & Control",
    archetypeId: EsterelArchetypeId.ARBITER,
    description:
      "Deterministic 2-client mutual-exclusion bus arbiter granting REQ1 over REQ2 in the same synchronous instant.",
    provenance: "Berry Esterel Hardware Synthesis Patterns",
    inputs: ["REQ1", "REQ2"],
    outputs: ["GNT1", "GNT2"],
    params: [["PRIORITY", 1, "", "Static priority client (1 = REQ1 first)"]],
    esterelSource: [
      "module Arbiter:",
      "input REQ1, REQ2;",
      "output GNT1, GNT2;",
      "loop",
      "  present REQ1 then",
      "    emit GNT1",
      "  else",
      "    present REQ2 then",
      "      emit GNT2",
      "    end",
      "  end;",
      "  pause",
      "end",
      "end module",
    ].join("\n"),
  },
  {
    patternType: "Timeout",
    aliases: ["DeadlineTimer", "OneShotTimer"],
    label: "Deadline Timeout",
    category: "Preemption & Timing",
    archetypeId: EsterelArchetypeId.TIMEOUT,
    description: "Starts on START, waits up to LIMIT ticks, and emits EXPIRED unless preempted by CANCEL.",
    provenance: "Esterel Real-Time Control Patterns",
    inputs: ["START", "TICK", "CANCEL"],
    outputs: ["EXPIRED"],
    params: [["LIMIT", 4, "ticks", "Number of ticks before expiration"]],
    esterelSource: [
      "module Timeout:",
      "input START, TICK, CANCEL;",
      "output EXPIRED;",
      "loop",
      "  await START;",
      "  abort",
      "    await 4 TICK;",
      "    emit EXPIRED",
      "  when CANCEL end",
      "end",
      "end module",
    ].join("\n"),
  },
  {
    patternType: "Stopwatch",
    aliases: ["Chronometer", "ReactiveStopwatch"],
    label: "Reactive Stopwatch",
    category: "Preemption & Timing",
    archetypeId: EsterelArchetypeId.STOPWATCH,
    description:
      "Start/stop/reset reactive chronometer using Esterel suspend/abort preemption to forward TICK to COUNT_TICK only while running.",
    provenance: "Berry (1992) Esterel Digital Wristwatch",
    inputs: ["START_STOP", "TICK", "RESET"],
    outputs: ["COUNT_TICK", "RUNNING"],
    params: [],
    esterelSource: [
      "module Stopwatch:",
      "input START_STOP, TICK, RESET;",
      "output COUNT_TICK, RUNNING;",
      "loop",
      "  await START_STOP;",
      "  abort",
      "    [ sustain RUNNING || every TICK do emit COUNT_TICK end ]",
      "  when START_STOP end",
      "each RESET",
      "end module",
    ].join("\n"),
  },
];

function portsForSpec(spec: EsterelPatternSpec): DiagramPortSpec[] {
  const ports: DiagramPortSpec[] = [];
  const inStep = 52 / (spec.inputs.length + 1);
  spec.inputs.forEach((name, idx) => {
    ports.push({
      name,
      kind: "signal",
      side: "left",
      dx: 0,
      dy: Math.round(inStep * (idx + 1)),
    });
  });
  const outStep = 52 / (spec.outputs.length + 1);
  spec.outputs.forEach((name, idx) => {
    ports.push({
      name,
      kind: "signal",
      side: "right",
      dx: 88,
      dy: Math.round(outStep * (idx + 1)),
    });
  });
  return ports;
}

/**
 * Builds declarative `CleanroomModelSchema[]` entries for `@modelscript/esterel-std-lib`.
 */
export function buildEsterelCleanroomSchemas(): CleanroomModelSchema[] {
  return ESTEREL_PATTERN_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "integer",
      defaultValue,
      ...(unit !== undefined ? { unit } : {}),
      ...(description !== undefined ? { description } : {}),
    }));
    return {
      namePath: `Esterel.Std.${spec.patternType}`,
      name: spec.patternType,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "reactive",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "module",
      width: 88,
      height: 52,
      svg: generateEsterelBlockSvg(spec.patternType, spec.category),
      ports: portsForSpec(spec),
      parameters,
      wasmKernel: "stepSlot",
      extra: {
        archetypeId: spec.archetypeId,
        inputs: spec.inputs,
        outputs: spec.outputs,
      },
    };
  });
}
