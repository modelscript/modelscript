// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Cleanroom archetype IDs matching `assets/sinda-std-lib/src/models.ts`.
 */
export const SindaArchetypeId = {
  // Solver routines
  STDSTL: 1,
  FWDBCK: 2,
  CRANKN: 3,
  SNFR: 4,
  // Spacecraft thermal materials
  AL_6061: 10,
  TI_6AL_4V: 11,
  MLI: 12,
  KAPTON: 13,
  BLACK_ANODIZE: 14,
  OSR: 15,
} as const;

export type SindaArchetypeId = (typeof SindaArchetypeId)[keyof typeof SindaArchetypeId];

export type SindaCatalogCategory = "Solver Routines" | "Spacecraft Thermal Materials";

export interface SindaModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: SindaCatalogCategory;
  archetypeId: SindaArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<SindaCatalogCategory, { fill: string; stroke: string; badge: string }> = {
  "Solver Routines": { fill: "#1e3a5f", stroke: "#60a5fa", badge: "SOLV" },
  "Spacecraft Thermal Materials": { fill: "#3b2314", stroke: "#f59e0b", badge: "MATL" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for a SINDA library element.
 */
export function generateSindaBlockSvg(modelType: string, category: SindaCatalogCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 12);
  const fontSize = label.length > 9 ? "7.5" : "9.0";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">` +
    `<rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="28" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="20" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForSpec(spec: SindaModelSpec): DiagramPortSpec[] {
  if (spec.category === "Solver Routines") {
    return [
      { name: "network_in", kind: "thermal", side: "left", dx: 0, dy: 26 },
      { name: "solution_out", kind: "signal", side: "right", dx: 88, dy: 26 },
    ];
  }
  return [
    { name: "port_a", kind: "thermal", side: "left", dx: 0, dy: 26 },
    { name: "port_b", kind: "thermal", side: "right", dx: 88, dy: 26 },
  ];
}

export const SINDA_MODEL_SPECS: SindaModelSpec[] = [
  // ---- SINDA Solver Routines ----
  {
    modelType: "STDSTL",
    aliases: ["STEADY", "STDSTL_NR"],
    label: "Steady-State Newton-Raphson Solver (STDSTL)",
    category: "Solver Routines",
    archetypeId: SindaArchetypeId.STDSTL,
    description:
      "NASA SINDA steady-state thermal network solver using damped Newton-Raphson relaxation for linear and radiative equilibrium.",
    provenance: "NASA MSC-13805 / SINDA User's Manual",
    params: [
      ["NLOOP", 100, "", "Maximum relaxation / Newton iterations"],
      ["DRLXCA", 1e-6, "K", "Diffusion node convergence tolerance"],
      ["ARLXCA", 1e-6, "K", "Arithmetic node convergence tolerance"],
      ["DAMPA", 1.0, "", "Under-relaxation damping factor"],
    ],
  },
  {
    modelType: "FWDBCK",
    aliases: ["FORWARD_BACKWARD"],
    label: "Forward-Backward Implicit Transient Solver (FWDBCK)",
    category: "Solver Routines",
    archetypeId: SindaArchetypeId.FWDBCK,
    description:
      "NASA SINDA implicit forward-backward (Crank-Nicolson) transient thermal network integrator with unconditional linear stability.",
    provenance: "NASA MSC-13805 / SINDA User's Manual",
    params: [
      ["TIMEO", 0.0, "s", "Initial simulation time"],
      ["TIMEND", 3600.0, "s", "Final simulation time"],
      ["DTIMEI", 1.0, "s", "Initial integration time step"],
      ["THETA", 0.5, "", "Implicit weighting factor (0.5 = Crank-Nicolson)"],
    ],
  },
  {
    modelType: "CRANKN",
    aliases: ["CRANK_NICOLSON", "CN"],
    label: "Crank-Nicolson Implicit Transient Solver (CRANKN)",
    category: "Solver Routines",
    archetypeId: SindaArchetypeId.CRANKN,
    description:
      "Second-order implicit Crank-Nicolson transient thermal integrator with per-step Newton-Raphson iteration for radiation and arithmetic nodes.",
    provenance: "NASA MSC-13805 / SINDA-FLUINT Reference Manual",
    params: [
      ["TIMEO", 0.0, "s", "Initial simulation time"],
      ["TIMEND", 3600.0, "s", "Final simulation time"],
      ["DTIMEI", 1.0, "s", "Integration time step"],
      ["NLOOP", 40, "", "Max Newton iterations per time step"],
    ],
  },
  {
    modelType: "SNFR",
    aliases: ["SNFR_SOLVER", "FAST_RELAX"],
    label: "Simultaneous Newton / Fast Relaxation Solver (SNFR)",
    category: "Solver Routines",
    archetypeId: SindaArchetypeId.SNFR,
    description:
      "Simultaneous matrix steady-state solver with analytical radiative Jacobian for tightly coupled spacecraft thermal networks.",
    provenance: "NASA SINDA/G & SINDA-FLUINT Reference Manual",
    params: [
      ["NLOOP", 50, "", "Maximum Newton-Raphson iterations"],
      ["TOL", 1e-8, "W", "Energy balance residual tolerance"],
      ["SIGMA", 5.670374419e-8, "W/(m2.K4)", "Stefan-Boltzmann constant"],
    ],
  },

  // ---- Spacecraft Thermal Material Catalog ----
  {
    modelType: "AL_6061",
    aliases: ["ALUMINUM_6061", "AL6061", "AL6061_T6"],
    label: "Aluminum 6061-T6 Structural Alloy",
    category: "Spacecraft Thermal Materials",
    archetypeId: SindaArchetypeId.AL_6061,
    description:
      "Standard spacecraft structural aluminum alloy (6061-T6) with high thermal conductivity and moderate bare IR emittance.",
    provenance: "Gilmore, Spacecraft Thermal Control Handbook, Vol. I (Aerospace Press)",
    params: [
      ["k", 167.0, "W/(m.K)", "Thermal conductivity at 300 K"],
      ["rho", 2700.0, "kg/m3", "Mass density"],
      ["cp", 896.0, "J/(kg.K)", "Specific heat capacity"],
      ["alpha_s", 0.2, "", "Solar absorptance (bare polished/mill)"],
      ["epsilon_ir", 0.08, "", "Infrared hemispherical emittance"],
    ],
  },
  {
    modelType: "TI_6AL_4V",
    aliases: ["TITANIUM_6AL_4V", "TI64", "TITANIUM"],
    label: "Titanium Ti-6Al-4V Thermal Isolator Alloy",
    category: "Spacecraft Thermal Materials",
    archetypeId: SindaArchetypeId.TI_6AL_4V,
    description:
      "Low-conductivity aerospace titanium alloy widely used for spacecraft thermal standoffs, flexures, and cryo-mounts.",
    provenance: "Gilmore, Spacecraft Thermal Control Handbook, Vol. I (Aerospace Press)",
    params: [
      ["k", 6.7, "W/(m.K)", "Thermal conductivity at 300 K"],
      ["rho", 4430.0, "kg/m3", "Mass density"],
      ["cp", 526.0, "J/(kg.K)", "Specific heat capacity"],
      ["alpha_s", 0.52, "", "Solar absorptance"],
      ["epsilon_ir", 0.19, "", "Infrared hemispherical emittance"],
    ],
  },
  {
    modelType: "MLI",
    aliases: ["MULTI_LAYER_INSULATION", "BLANKET"],
    label: "Multi-Layer Insulation (MLI Blanket)",
    category: "Spacecraft Thermal Materials",
    archetypeId: SindaArchetypeId.MLI,
    description:
      "Spacecraft radiation shield blanket characterized by effective emittance e* (~0.02–0.03) and ultra-low effective conductivity.",
    provenance: "NASA TP-1999-209263 / Gilmore Spacecraft Thermal Control Handbook",
    params: [
      ["k", 0.0002, "W/(m.K)", "Effective vacuum thermal conductivity"],
      ["rho", 40.0, "kg/m3", "Bulk blanket density"],
      ["cp", 1090.0, "J/(kg.K)", "Effective specific heat capacity"],
      ["e_star", 0.02, "", "Effective blanket emittance e*"],
      ["alpha_s", 0.38, "", "Outer Kapton/aluminized film solar absorptance"],
      ["epsilon_ir", 0.67, "", "Outer layer IR emittance"],
    ],
  },
  {
    modelType: "KAPTON",
    aliases: ["ALUMINIZED_KAPTON", "POLYIMIDE"],
    label: "Aluminized Kapton (2 mil Polyimide Film)",
    category: "Spacecraft Thermal Materials",
    archetypeId: SindaArchetypeId.KAPTON,
    description:
      "Second-surface vapor-deposited aluminum (VDA) Kapton polyimide thermal control film for spacecraft exterior blankets.",
    provenance: "NASA RP-1121 / Gilmore Spacecraft Thermal Control Handbook",
    params: [
      ["k", 0.12, "W/(m.K)", "Thermal conductivity"],
      ["rho", 1420.0, "kg/m3", "Mass density"],
      ["cp", 1090.0, "J/(kg.K)", "Specific heat capacity"],
      ["alpha_s", 0.41, "", "Solar absorptance (2 mil Kapton/Al)"],
      ["epsilon_ir", 0.75, "", "Infrared hemispherical emittance"],
    ],
  },
  {
    modelType: "BLACK_ANODIZE",
    aliases: ["BLACK_ANODIZED_AL", "ANODIZE_BLACK"],
    label: "Black Anodized Aluminum Coating",
    category: "Spacecraft Thermal Materials",
    archetypeId: SindaArchetypeId.BLACK_ANODIZE,
    description:
      "High-emittance, high-absorptance black anodized aluminum surface finish used on internal spacecraft electronics boxes and baffles.",
    provenance: "NASA RP-1121 / Gilmore Spacecraft Thermal Control Handbook",
    params: [
      ["k", 167.0, "W/(m.K)", "Substrate thermal conductivity (Al 6061)"],
      ["rho", 2700.0, "kg/m3", "Substrate density"],
      ["cp", 896.0, "J/(kg.K)", "Substrate specific heat"],
      ["alpha_s", 0.88, "", "Solar absorptance"],
      ["epsilon_ir", 0.86, "", "Infrared hemispherical emittance"],
    ],
  },
  {
    modelType: "OSR",
    aliases: ["OPTICAL_SOLAR_REFLECTOR", "SSM", "SILVER_TEFLON"],
    label: "Optical Solar Reflector (OSR Quartz Mirror)",
    category: "Spacecraft Thermal Materials",
    archetypeId: SindaArchetypeId.OSR,
    description:
      "Second-surface silvered fused-silica radiator mirror with ultra-low solar absorptance (alpha_s ~ 0.08) and high IR emittance (epsilon ~ 0.80).",
    provenance: "Gilmore, Spacecraft Thermal Control Handbook, Vol. I (Aerospace Press)",
    params: [
      ["k", 1.38, "W/(m.K)", "Fused silica thermal conductivity"],
      ["rho", 2200.0, "kg/m3", "Fused silica density"],
      ["cp", 740.0, "J/(kg.K)", "Fused silica specific heat"],
      ["alpha_s", 0.08, "", "Solar absorptance (BOL)"],
      ["epsilon_ir", 0.8, "", "Infrared hemispherical emittance"],
    ],
  },
];

/**
 * Builds the declarative `CleanroomModelSchema[]` array for `@modelscript/sinda-std-lib`.
 */
export function buildSindaCleanroomSchemas(): CleanroomModelSchema[] {
  return SINDA_MODEL_SPECS.map((spec): CleanroomModelSchema => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));

    return {
      namePath: `SINDA.${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "thermal",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Model",
      width: 88,
      height: 52,
      svg: generateSindaBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForSpec(spec),
      parameters,
      wasmKernel: "evalSindaThermalElement",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}
