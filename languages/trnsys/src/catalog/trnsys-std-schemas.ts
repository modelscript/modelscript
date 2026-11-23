// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Cleanroom TRNSYS component archetype IDs matching `assets/trnsys-std-lib/src/models.ts`.
 */
export const TrnsysArchetypeId = {
  TYPE1: 1,
  TYPE2: 2,
  TYPE3: 3,
  TYPE4: 4,
  TYPE14: 14,
  TYPE15: 15,
  TYPE25: 25,
  TYPE56: 56,
} as const;

export type TrnsysArchetypeId = (typeof TrnsysArchetypeId)[keyof typeof TrnsysArchetypeId];

export type TrnsysModelCategory =
  "Solar Thermal" | "Controllers" | "Hydronics" | "Thermal Storage" | "Utility & Weather" | "Buildings";

export interface TrnsysModelSpec {
  typeNumber: number;
  modelType: string;
  aliases: string[];
  label: string;
  category: TrnsysModelCategory;
  archetypeId: TrnsysArchetypeId;
  description: string;
  provenance: string;
  numInputs: number;
  numOutputs: number;
  stateBreaking: boolean;
  variableInputs?: boolean | undefined;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<TrnsysModelCategory, { fill: string; stroke: string; badge: string }> = {
  "Solar Thermal": { fill: "#4a2511", stroke: "#f59e0b", badge: "SOLR" },
  Controllers: { fill: "#2e1f47", stroke: "#a78bfa", badge: "CTRL" },
  Hydronics: { fill: "#143547", stroke: "#38bdf8", badge: "HYDR" },
  "Thermal Storage": { fill: "#431a24", stroke: "#fb7185", badge: "TANK" },
  "Utility & Weather": { fill: "#173b2d", stroke: "#34d399", badge: "UTIL" },
  Buildings: { fill: "#283044", stroke: "#94a3b8", badge: "BLDG" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for a TRNSYS Type.
 */
export function generateTrnsysBlockSvg(modelType: string, category: TrnsysModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 10);
  const fontSize = label.length > 7 ? "8.5" : "9.5";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">` +
    `<rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="28" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="20" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForSpec(spec: TrnsysModelSpec): DiagramPortSpec[] {
  const ports: DiagramPortSpec[] = [];
  if (spec.numInputs > 0) {
    ports.push({ name: "in", kind: "thermal", side: "left", dx: 0, dy: 26 });
  }
  if (spec.numOutputs > 0) {
    ports.push({ name: "out", kind: "thermal", side: "right", dx: 88, dy: 26 });
  }
  if (spec.category === "Controllers") {
    ports.push({ name: "signal", kind: "signal", side: "bottom", dx: 44, dy: 52 });
  }
  return ports.length > 0 ? ports : [{ name: "io", kind: "signal", side: "right", dx: 88, dy: 26 }];
}

export const TRNSYS_MODEL_SPECS: TrnsysModelSpec[] = [
  {
    typeNumber: 1,
    modelType: "Type1",
    aliases: ["TYPE1", "TYPE 1", "SOLAR_COLLECTOR", "COLLECTOR"],
    label: "Type 1 — Flat-Plate Solar Collector",
    category: "Solar Thermal",
    archetypeId: TrnsysArchetypeId.TYPE1,
    description: "Hottel-Whillier-Bliss quadratic efficiency flat-plate solar thermal collector.",
    provenance: "Duffie & Beckman, Solar Engineering of Thermal Processes (4th ed.); TRNSYS Mathematical Reference",
    numInputs: 4,
    numOutputs: 3,
    stateBreaking: false,
    params: [
      ["area", 4.0, "m2", "Collector aperture area"],
      ["cp", 4.19, "kJ/(kg.K)", "Fluid specific heat capacity"],
      ["frTauAlpha", 0.75, "-", "Intercept efficiency FR*(tau*alpha)_n"],
      ["frUl", 15.0, "kJ/(h.m2.K)", "Linear thermal loss coefficient FR*UL"],
      ["frUl2", 0.0, "kJ/(h.m2.K2)", "Quadratic thermal loss coefficient"],
    ],
  },
  {
    typeNumber: 2,
    modelType: "Type2",
    aliases: ["TYPE2", "TYPE 2", "CONTROLLER", "DIFF_CONTROLLER"],
    label: "Type 2 — Differential Controller",
    category: "Controllers",
    archetypeId: TrnsysArchetypeId.TYPE2,
    description: "On/off differential temperature controller with deadband hysteresis and high-limit cutout.",
    provenance: "TRNSYS Mathematical Reference — Type 2 Differential Controller",
    numInputs: 6,
    numOutputs: 1,
    stateBreaking: true,
    params: [
      ["nStuck", 5.0, "-", "Maximum oscillations per timestep before locking"],
      ["tHighLimit", 95.0, "C", "High-temperature safety cutout"],
    ],
  },
  {
    typeNumber: 3,
    modelType: "Type3",
    aliases: ["TYPE3", "TYPE 3", "PUMP"],
    label: "Type 3 — Circulation Pump",
    category: "Hydronics",
    archetypeId: TrnsysArchetypeId.TYPE3,
    description: "Variable/constant-speed hydronic circulation pump with parasitic heat gain.",
    provenance: "TRNSYS Mathematical Reference — Type 3 Pump",
    numInputs: 3,
    numOutputs: 3,
    stateBreaking: false,
    params: [
      ["mDotMax", 200.0, "kg/h", "Maximum mass flow rate"],
      ["cp", 4.19, "kJ/(kg.K)", "Fluid specific heat capacity"],
      ["pMax", 180.0, "kJ/h", "Maximum pump shaft power"],
      ["fPar", 0.05, "-", "Fraction of pump power converted to fluid heat"],
    ],
  },
  {
    typeNumber: 4,
    modelType: "Type4",
    aliases: ["TYPE4", "TYPE 4", "STORAGE_TANK", "TANK"],
    label: "Type 4 — Stratified Storage Tank",
    category: "Thermal Storage",
    archetypeId: TrnsysArchetypeId.TYPE4,
    description: "Multi-node thermally stratified fluid storage tank with ambient UA heat loss.",
    provenance: "Klein et al. (1975); Duffie & Beckman; TRNSYS Mathematical Reference — Type 4 Tank",
    numInputs: 5,
    numOutputs: 6,
    stateBreaking: true,
    params: [
      ["volume", 0.3, "m3", "Tank fluid volume"],
      ["cp", 4.19, "kJ/(kg.K)", "Fluid specific heat capacity"],
      ["rho", 1000.0, "kg/m3", "Fluid density"],
      ["uLoss", 1.5, "kJ/(h.m2.K)", "Overall tank heat loss coefficient"],
      ["height", 1.5, "m", "Tank height"],
      ["nNodes", 3.0, "-", "Number of stratified thermal nodes (1..6)"],
    ],
  },
  {
    typeNumber: 14,
    modelType: "Type14",
    aliases: ["TYPE14", "TYPE 14", "FORCING_FUNCTION", "SCHEDULE"],
    label: "Type 14 — Time-Dependent Forcing Function",
    category: "Utility & Weather",
    archetypeId: TrnsysArchetypeId.TYPE14,
    description: "Periodic piecewise-linear time-dependent forcing function.",
    provenance: "TRNSYS Mathematical Reference — Type 14 Forcing Function",
    numInputs: 0,
    numOutputs: 2,
    stateBreaking: true,
    params: [
      ["t0", 0.0, "h", "Point 0 time"],
      ["v0", 0.0, "-", "Point 0 value"],
      ["t1", 12.0, "h", "Point 1 time"],
      ["v1", 1.0, "-", "Point 1 value"],
      ["t2", 24.0, "h", "Point 2 time"],
      ["v2", 0.0, "-", "Point 2 value"],
    ],
  },
  {
    typeNumber: 15,
    modelType: "Type15",
    aliases: ["TYPE15", "TYPE 15", "WEATHER", "TMY"],
    label: "Type 15 — Weather Data Processor",
    category: "Utility & Weather",
    archetypeId: TrnsysArchetypeId.TYPE15,
    description: "Synthetic / TMY ambient temperature and solar irradiance weather processor.",
    provenance: "TRNSYS Mathematical Reference — Type 15 Weather Data Processor",
    numInputs: 0,
    numOutputs: 4,
    stateBreaking: true,
    params: [
      ["tAmbMean", 20.0, "C", "Mean ambient temperature"],
      ["tAmbAmp", 5.0, "C", "Diurnal ambient temperature amplitude"],
      ["iPeak", 2880.0, "kJ/(h.m2)", "Peak solar irradiance (800 W/m2 = 2880 kJ/h.m2)"],
      ["sunriseHr", 6.0, "h", "Sunrise hour of day"],
      ["sunsetHr", 18.0, "h", "Sunset hour of day"],
    ],
  },
  {
    typeNumber: 25,
    modelType: "Type25",
    aliases: ["TYPE25", "TYPE 25", "PRINTER"],
    label: "Type 25 — Simulation Printer",
    category: "Utility & Weather",
    archetypeId: TrnsysArchetypeId.TYPE25,
    description: "Periodic tabular output printer recording connected unit outputs.",
    provenance: "TRNSYS Mathematical Reference — Type 25 Printer",
    numInputs: 4,
    numOutputs: 0,
    stateBreaking: true,
    variableInputs: true,
    params: [
      ["dtPrint", 1.0, "h", "Printing interval"],
      ["tStart", 0.0, "h", "Start time for printing"],
      ["tStop", 24.0, "h", "Stop time for printing"],
      ["logicalUnit", 30.0, "-", "Logical output file unit"],
    ],
  },
  {
    typeNumber: 56,
    modelType: "Type56",
    aliases: ["TYPE56", "TYPE 56", "BUILDING", "MULTIZONE_BUILDING"],
    label: "Type 56 — Multi-Zone Building",
    category: "Buildings",
    archetypeId: TrnsysArchetypeId.TYPE56,
    description: "Lumped thermal capacitance building zone ODE with envelope UA loss, solar gain, and HVAC input.",
    provenance: "TRNSYS 18 Volume 5 — Multizone Building Modeling with Type56",
    numInputs: 4,
    numOutputs: 3,
    stateBreaking: true,
    params: [
      ["capacitance", 5000.0, "kJ/K", "Effective zone thermal capacitance"],
      ["uaEnv", 250.0, "kJ/(h.K)", "Envelope overall conductance UA"],
      ["solarAperture", 6.0, "m2", "Effective glazed solar aperture area"],
      ["tInit", 20.0, "C", "Initial zone air temperature"],
    ],
  },
];

/**
 * Builds the `CleanroomModelSchema[]` array consumed by `cleanroomSchemasToLibraryPayloads`.
 */
export function buildTrnsysCleanroomSchemas(): CleanroomModelSchema[] {
  return TRNSYS_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      ...(unit !== undefined ? { unit } : {}),
      ...(description !== undefined ? { description } : {}),
    }));
    return {
      namePath: `TRNSYS.${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "thermal",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Class",
      width: 88,
      height: 52,
      svg: generateTrnsysBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForSpec(spec),
      parameters,
      wasmKernel: "trnsysModelStep",
      extra: {
        archetypeId: spec.archetypeId,
        typeNumber: spec.typeNumber,
        numInputs: spec.numInputs,
        numOutputs: spec.numOutputs,
        stateBreaking: spec.stateBreaking,
      },
    };
  });
}
