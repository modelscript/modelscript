// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * SDL-88 cleanroom archetype IDs matching `assets/sdl-std-lib/src/models.ts`.
 */
export const SdlArchetypeId = {
  // ITU-T Z.100 Predefined Sorts
  SORT_BOOLEAN: 1,
  SORT_INTEGER: 2,
  SORT_REAL: 3,
  SORT_DURATION: 4,
  SORT_TIME: 5,
  SORT_PID: 6,
  SORT_CHARSTRING: 7,
  // Canonical Telecom Protocol Blocks
  ABP_SENDER: 20,
  ABP_RECEIVER: 21,
  UNRELIABLE_CHANNEL: 22,
  WATCHDOG_TIMER: 23,
  CALL_SETUP_ORIGINATOR: 24,
  CALL_SETUP_TERMINATOR: 25,
} as const;

export type SdlArchetypeId = (typeof SdlArchetypeId)[keyof typeof SdlArchetypeId];

export type SdlModelCategory = "ITU-T Z.100 Predefined Sorts" | "Telecom Protocol Blocks";

export interface SdlModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: SdlModelCategory;
  archetypeId: SdlArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
  ports: DiagramPortSpec[];
}

const CATEGORY_COLORS: Record<SdlModelCategory, { fill: string; stroke: string; badge: string }> = {
  "ITU-T Z.100 Predefined Sorts": { fill: "#1e3a5f", stroke: "#60a5fa", badge: "SORT" },
  "Telecom Protocol Blocks": { fill: "#2e2447", stroke: "#c084fc", badge: "PROT" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for an SDL-88 sort or telecom block.
 */
export function generateSdlBlockSvg(modelType: string, category: SdlModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 12);
  const fontSize = label.length > 9 ? "7.6" : "9.0";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 52" width="96" height="52">` +
    `<rect x="2" y="2" width="92" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="30" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="21" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="48" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

const SDL_STD_SPECS: SdlModelSpec[] = [
  // ITU-T Z.100 Predefined Sorts
  {
    modelType: "Boolean",
    aliases: ["BOOL"],
    label: "Boolean Sort",
    category: "ITU-T Z.100 Predefined Sorts",
    archetypeId: SdlArchetypeId.SORT_BOOLEAN,
    description:
      "ITU-T Z.100 predefined Boolean sort with values True/False and logical operators (NOT, AND, OR, XOR).",
    provenance: "ITU-T Recommendation Z.100 (1988) §5.6.1",
    params: [["defaultValue", 0, "bool", "Initial Boolean value (0=False, 1=True)"]],
    ports: [{ name: "value", kind: "signal", side: "right", dx: 96, dy: 26 }],
  },
  {
    modelType: "Integer",
    aliases: ["INT", "NATURAL"],
    label: "Integer Sort",
    category: "ITU-T Z.100 Predefined Sorts",
    archetypeId: SdlArchetypeId.SORT_INTEGER,
    description: "ITU-T Z.100 predefined unbounded signed Integer sort with arithmetic and relational operators.",
    provenance: "ITU-T Recommendation Z.100 (1988) §5.6.3",
    params: [["defaultValue", 0, "1", "Initial Integer value"]],
    ports: [{ name: "value", kind: "signal", side: "right", dx: 96, dy: 26 }],
  },
  {
    modelType: "Real",
    aliases: ["FLOAT"],
    label: "Real Sort",
    category: "ITU-T Z.100 Predefined Sorts",
    archetypeId: SdlArchetypeId.SORT_REAL,
    description: "ITU-T Z.100 predefined Real floating-point sort for continuous quantities and timers.",
    provenance: "ITU-T Recommendation Z.100 (1988) §5.6.5",
    params: [["defaultValue", 0.0, "1", "Initial Real value"]],
    ports: [{ name: "value", kind: "signal", side: "right", dx: 96, dy: 26 }],
  },
  {
    modelType: "Duration",
    aliases: ["DUR"],
    label: "Duration Sort",
    category: "ITU-T Z.100 Predefined Sorts",
    archetypeId: SdlArchetypeId.SORT_DURATION,
    description: "ITU-T Z.100 predefined Duration sort representing elapsed time intervals (seconds) for timer SET.",
    provenance: "ITU-T Recommendation Z.100 (1988) §5.6.8",
    params: [["seconds", 1.0, "s", "Default duration interval in seconds"]],
    ports: [{ name: "duration", kind: "signal", side: "right", dx: 96, dy: 26 }],
  },
  {
    modelType: "Time",
    aliases: ["NOW"],
    label: "Time Sort",
    category: "ITU-T Z.100 Predefined Sorts",
    archetypeId: SdlArchetypeId.SORT_TIME,
    description: "ITU-T Z.100 predefined Time sort representing absolute system clock instants (NOW).",
    provenance: "ITU-T Recommendation Z.100 (1988) §5.6.9",
    params: [["epochOffset", 0.0, "s", "Initial virtual clock offset"]],
    ports: [{ name: "now", kind: "signal", side: "right", dx: 96, dy: 26 }],
  },
  {
    modelType: "PId",
    aliases: ["PROCESS_ID", "SELF", "SENDER", "OFFSPRING", "PARENT"],
    label: "PId Sort",
    category: "ITU-T Z.100 Predefined Sorts",
    archetypeId: SdlArchetypeId.SORT_PID,
    description: "ITU-T Z.100 predefined Process Instance Identifier sort (SELF, SENDER, OFFSPRING, PARENT, Null).",
    provenance: "ITU-T Recommendation Z.100 (1988) §5.6.7",
    params: [["pidValue", 0, "id", "Process instance identifier (0 = Null)"]],
    ports: [{ name: "pid", kind: "signal", side: "right", dx: 96, dy: 26 }],
  },
  {
    modelType: "Charstring",
    aliases: ["CHARACTER", "STRING"],
    label: "Charstring Sort",
    category: "ITU-T Z.100 Predefined Sorts",
    archetypeId: SdlArchetypeId.SORT_CHARSTRING,
    description: "ITU-T Z.100 predefined Character string sort with concatenation (//) and length operators.",
    provenance: "ITU-T Recommendation Z.100 (1988) §5.6.2",
    params: [["maxLength", 256, "chars", "Maximum string buffer length"]],
    ports: [{ name: "text", kind: "signal", side: "right", dx: 96, dy: 26 }],
  },

  // Canonical Telecom Protocol Blocks
  {
    modelType: "AlternatingBitSender",
    aliases: ["ABP_SENDER", "ABPSender"],
    label: "Alternating-Bit Sender",
    category: "Telecom Protocol Blocks",
    archetypeId: SdlArchetypeId.ABP_SENDER,
    description:
      "ITU-T Z.100 Alternating-Bit Protocol (ABP) transmitter EFSM with 1-bit sequence alternation and retransmission timer.",
    provenance: "Bartlett, Scantlebury & Wilkinson (1969) / ITU-T Z.100 Tutorial",
    params: [
      ["retransmitTimeout", 1.0, "s", "Retransmission timer T_retx duration"],
      ["maxRetries", 5, "1", "Maximum consecutive retransmissions before link fault"],
    ],
    ports: [
      { name: "data_in", kind: "signal", side: "left", dx: 0, dy: 16 },
      { name: "ack_in", kind: "signal", side: "left", dx: 0, dy: 36 },
      { name: "frame_out", kind: "signal", side: "right", dx: 96, dy: 26 },
    ],
  },
  {
    modelType: "AlternatingBitReceiver",
    aliases: ["ABP_RECEIVER", "ABPReceiver"],
    label: "Alternating-Bit Receiver",
    category: "Telecom Protocol Blocks",
    archetypeId: SdlArchetypeId.ABP_RECEIVER,
    description:
      "ITU-T Z.100 Alternating-Bit Protocol (ABP) receiver EFSM delivering in-order payloads and acknowledging sequence bits.",
    provenance: "Bartlett, Scantlebury & Wilkinson (1969) / ITU-T Z.100 Tutorial",
    params: [["expectedSeq", 0, "1", "Initial expected alternating sequence bit (0 or 1)"]],
    ports: [
      { name: "frame_in", kind: "signal", side: "left", dx: 0, dy: 26 },
      { name: "data_out", kind: "signal", side: "right", dx: 96, dy: 16 },
      { name: "ack_out", kind: "signal", side: "right", dx: 96, dy: 36 },
    ],
  },
  {
    modelType: "UnreliableChannel",
    aliases: ["LOSSY_CHANNEL", "MEDIUM"],
    label: "Unreliable Channel",
    category: "Telecom Protocol Blocks",
    archetypeId: SdlArchetypeId.UNRELIABLE_CHANNEL,
    description: "Telecom transmission channel with propagation delay and configurable frame loss rate.",
    provenance: "ITU-T Z.100 Channel Semantics",
    params: [
      ["propagationDelay", 0.05, "s", "One-way channel propagation latency"],
      ["dropProbability", 0.0, "1", "Frame drop probability in [0, 1]"],
    ],
    ports: [
      { name: "in_port", kind: "signal", side: "left", dx: 0, dy: 26 },
      { name: "out_port", kind: "signal", side: "right", dx: 96, dy: 26 },
    ],
  },
  {
    modelType: "WatchdogTimer",
    aliases: ["WATCHDOG", "SUPERVISION_TIMER"],
    label: "Watchdog Timer",
    category: "Telecom Protocol Blocks",
    archetypeId: SdlArchetypeId.WATCHDOG_TIMER,
    description:
      "Supervision watchdog timer EFSM issuing a Fault alarm when heartbeat kicks are missed within timeout.",
    provenance: "ITU-T Z.100 Timer Semantics",
    params: [["timeout", 2.0, "s", "Watchdog expiry interval in seconds"]],
    ports: [
      { name: "kick", kind: "signal", side: "left", dx: 0, dy: 26 },
      { name: "alarm", kind: "signal", side: "right", dx: 96, dy: 26 },
    ],
  },
  {
    modelType: "CallSetupOriginator",
    aliases: ["CALL_ORIG", "Q931_ORIG"],
    label: "Call Setup Originator",
    category: "Telecom Protocol Blocks",
    archetypeId: SdlArchetypeId.CALL_SETUP_ORIGINATOR,
    description:
      "Telecom call-control originating EFSM (Idle -> Calling -> Connected -> Releasing) with T303 setup timer.",
    provenance: "ITU-T Q.931 / Z.100 Call Control Reference",
    params: [["t303Timeout", 4.0, "s", "Call setup supervision timer T303 duration"]],
    ports: [
      { name: "user_req", kind: "signal", side: "left", dx: 0, dy: 26 },
      { name: "net_tx", kind: "signal", side: "right", dx: 96, dy: 16 },
      { name: "net_rx", kind: "signal", side: "right", dx: 96, dy: 36 },
    ],
  },
  {
    modelType: "CallSetupTerminator",
    aliases: ["CALL_TERM", "Q931_TERM"],
    label: "Call Setup Terminator",
    category: "Telecom Protocol Blocks",
    archetypeId: SdlArchetypeId.CALL_SETUP_TERMINATOR,
    description:
      "Telecom call-control terminating EFSM (Idle -> Alerting -> Connected) responding to Setup with Alerting/Connect.",
    provenance: "ITU-T Q.931 / Z.100 Call Control Reference",
    params: [["t301Timeout", 180.0, "s", "Alerting supervision timer T301 duration"]],
    ports: [
      { name: "net_rx", kind: "signal", side: "left", dx: 0, dy: 16 },
      { name: "net_tx", kind: "signal", side: "left", dx: 0, dy: 36 },
      { name: "user_ind", kind: "signal", side: "right", dx: 96, dy: 26 },
    ],
  },
];

/**
 * Builds the complete list of cleanroom SDL-88 standard library schemas for `@modelscript/sdl-std-lib`.
 */
export function buildSdlCleanroomSchemas(): CleanroomModelSchema[] {
  return SDL_STD_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      ...(unit !== undefined ? { unit } : {}),
      ...(description !== undefined ? { description } : {}),
    }));

    return {
      namePath: `SDL.${spec.category === "ITU-T Z.100 Predefined Sorts" ? "Predefined" : "Protocols"}.${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "telecom",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: spec.category === "ITU-T Z.100 Predefined Sorts" ? "Type" : "Block",
      width: 96,
      height: 52,
      svg: generateSdlBlockSvg(spec.modelType, spec.category),
      ports: spec.ports,
      parameters,
      wasmKernel: "sdlModelStep",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}
