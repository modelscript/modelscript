// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * ECLIPSE cleanroom reservoir physics archetype IDs matching `assets/eclipse-std-lib/src/models.ts`.
 */
export const EclipseArchetypeId = {
  // PVT & EOS Models
  PVTO_LIVE_OIL: 10,
  PVDO_DEAD_OIL: 11,
  PVTG_WET_GAS: 12,
  PVDG_DRY_GAS: 13,
  PVTW_WATER: 14,
  EOS_PR_COMP: 15,
  EOS_SRK_COMP: 16,
  ROCK_COMPRESS: 17,
  // Relative Permeability & SCAL
  SWOF_COREY: 20,
  SGOF_COREY: 21,
  STONE1_3PHASE: 22,
  STONE2_3PHASE: 23,
  PC_LEVERETT_J: 24,
  // Wells & Aquifers
  WELSPECS_PROD: 30,
  WELSPECS_INJ: 31,
  COMPDAT_PEACEMAN: 32,
  VFPPROD_LIFT: 33,
  MSWELL_SEGMENT: 34,
  AQUFETP_FETKOVICH: 35,
  AQUTAB_CARTER_TRACY: 36,
} as const;

export type EclipseArchetypeId = (typeof EclipseArchetypeId)[keyof typeof EclipseArchetypeId];

export type EclipseModelCategory = "PVT & EOS" | "Relative Permeability & SCAL" | "Wells & Aquifers";

export interface EclipseModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: EclipseModelCategory;
  archetypeId: EclipseArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<EclipseModelCategory, { fill: string; stroke: string; badge: string }> = {
  "PVT & EOS": { fill: "#1e3a5f", stroke: "#38bdf8", badge: "PVT" },
  "Relative Permeability & SCAL": { fill: "#1f3b2e", stroke: "#34d399", badge: "SCAL" },
  "Wells & Aquifers": { fill: "#3f2718", stroke: "#f59e0b", badge: "WELL" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for an ECLIPSE reservoir physics model.
 */
export function generateEclipseBlockSvg(modelType: string, category: EclipseModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 9);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 84 48" width="84" height="48">` +
    `<rect x="2" y="2" width="80" height="44" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="28" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="20" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="42" y="34" text-anchor="middle" font-family="monospace" font-size="9.5" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: EclipseModelCategory): DiagramPortSpec[] {
  switch (category) {
    case "PVT & EOS":
      return [
        { name: "pressure", kind: "signal", side: "left", dx: 0, dy: 14 },
        { name: "temperature", kind: "signal", side: "left", dx: 0, dy: 34 },
        { name: "props", kind: "fluid", side: "right", dx: 84, dy: 24 },
      ];
    case "Relative Permeability & SCAL":
      return [
        { name: "sw", kind: "signal", side: "left", dx: 0, dy: 14 },
        { name: "sg", kind: "signal", side: "left", dx: 0, dy: 34 },
        { name: "kr", kind: "signal", side: "right", dx: 84, dy: 16 },
        { name: "pc", kind: "signal", side: "right", dx: 84, dy: 32 },
      ];
    case "Wells & Aquifers":
      return [
        { name: "reservoir", kind: "fluid", side: "left", dx: 0, dy: 24 },
        { name: "bhp", kind: "signal", side: "top", dx: 42, dy: 0 },
        { name: "rate", kind: "fluid", side: "right", dx: 84, dy: 24 },
      ];
  }
}

export const ECLIPSE_MODEL_SPECS: EclipseModelSpec[] = [
  // =========================================================================
  // PVT & EOS Models
  // =========================================================================
  {
    modelType: "pvto",
    aliases: ["PVTO", "PVTO_LIVE_OIL", "STANDING_PVTO"],
    label: "Live Oil PVT (PVTO / Standing)",
    category: "PVT & EOS",
    archetypeId: EclipseArchetypeId.PVTO_LIVE_OIL,
    description:
      "Black-oil live oil PVT correlation computing dissolved gas-oil ratio Rs(P), oil FVF Bo(P), and live-oil viscosity mu_o(P) for saturated and undersaturated regimes.",
    provenance:
      "Standing (1947) Drilling & Production Practice, API; Beggs & Robinson (1975) JPT; OPM Flow Reference Manual (PVTO)",
    params: [
      ["api", 35.0, "degAPI", "Stock-tank oil API gravity"],
      ["gammaG", 0.75, "1", "Solution gas specific gravity (air = 1)"],
      ["pb", 2500.0, "psia", "Bubble-point pressure"],
      ["co", 1.5e-5, "1/psi", "Undersaturated isothermal oil compressibility"],
      ["muDead", 2.0, "cP", "Reference dead-oil viscosity at reservoir temperature"],
    ],
  },
  {
    modelType: "pvdo",
    aliases: ["PVDO", "PVDO_DEAD_OIL"],
    label: "Dead Oil PVT (PVDO)",
    category: "PVT & EOS",
    archetypeId: EclipseArchetypeId.PVDO_DEAD_OIL,
    description:
      "Dead-oil (zero dissolved gas) formation volume factor Bo(P) and Barus pressure-dependent viscosity mu_o(P).",
    provenance: "OPM Flow Reference Manual (PVDO); Aziz & Settari (1979) Petroleum Reservoir Simulation",
    params: [
      ["pRef", 14.7, "psia", "Reference pressure"],
      ["boRef", 1.05, "rb/stb", "Reference oil formation volume factor"],
      ["co", 1.2e-5, "1/psi", "Isothermal oil compressibility"],
      ["muRef", 1.8, "cP", "Reference oil viscosity"],
      ["cmu", 1.0e-5, "1/psi", "Oil viscosibility coefficient"],
    ],
  },
  {
    modelType: "pvtg",
    aliases: ["PVTG", "PVTG_WET_GAS"],
    label: "Wet Gas PVT (PVTG)",
    category: "PVT & EOS",
    archetypeId: EclipseArchetypeId.PVTG_WET_GAS,
    description:
      "Wet gas with vaporized oil-gas ratio Rv(P), real-gas Z-factor, formation volume factor Bg(P), and Lee-Gonzalez-Eakin viscosity.",
    provenance: "OPM Flow Reference Manual (PVTG); Lee, Gonzalez & Eakin (1966) JPT; Standing & Katz (1942)",
    params: [
      ["gammaG", 0.72, "1", "Gas specific gravity (air = 1)"],
      ["pDew", 3200.0, "psia", "Dew-point pressure"],
      ["rvMax", 5.0e-5, "stb/scf", "Maximum vaporized oil-gas ratio at dew point"],
      ["tRes", 180.0, "degF", "Reference reservoir temperature"],
    ],
  },
  {
    modelType: "pvdg",
    aliases: ["PVDG", "PVDG_DRY_GAS"],
    label: "Dry Gas PVT (PVDG)",
    category: "PVT & EOS",
    archetypeId: EclipseArchetypeId.PVDG_DRY_GAS,
    description:
      "Dry gas real-gas compressibility Z(P,T) via Papay correlation, formation volume factor Bg(P), and gas viscosity.",
    provenance: "Papay (1968); Standing & Katz (1942) Trans. AIME; OPM Flow Reference Manual (PVDG)",
    params: [
      ["gammaG", 0.65, "1", "Dry gas specific gravity (air = 1)"],
      ["pPc", 670.0, "psia", "Pseudo-critical pressure"],
      ["tPc", 375.0, "degR", "Pseudo-critical temperature"],
      ["muRef", 0.018, "cP", "Reference gas viscosity at low pressure"],
    ],
  },
  {
    modelType: "pvtw",
    aliases: ["PVTW", "PVTW_WATER"],
    label: "Water PVT (PVTW)",
    category: "PVT & EOS",
    archetypeId: EclipseArchetypeId.PVTW_WATER,
    description: "Exponential formation volume factor Bw(P) and viscosibility mu_w(P) for reservoir brine.",
    provenance: "OPM Flow Reference Manual (PVTW); McCain (1990) Properties of Petroleum Fluids",
    params: [
      ["pRef", 3000.0, "psia", "Reference pressure"],
      ["bwRef", 1.02, "rb/stb", "Water formation volume factor at reference pressure"],
      ["cw", 3.0e-6, "1/psi", "Water compressibility"],
      ["muwRef", 0.5, "cP", "Water viscosity at reference pressure"],
      ["cmu", 0.0, "1/psi", "Water viscosibility"],
    ],
  },
  {
    modelType: "eos_pr",
    aliases: ["EOS_PR_COMP", "PR", "PENG_ROBINSON"],
    label: "Peng-Robinson Cubic EOS (PR)",
    category: "PVT & EOS",
    archetypeId: EclipseArchetypeId.EOS_PR_COMP,
    description:
      "Peng-Robinson (1976) compositional cubic equation of state solving for compressibility factor Z and molar volume.",
    provenance: "Peng & Robinson (1976) Ind. Eng. Chem. Fundam. 15(1):59-64; OPM Flow Compositional Manual",
    params: [
      ["pc", 667.8, "psia", "Critical pressure"],
      ["tc", 343.0, "degR", "Critical temperature"],
      ["omega", 0.0115, "1", "Acentric factor"],
      ["mw", 16.04, "lb/lbmol", "Molecular weight"],
    ],
  },
  {
    modelType: "eos_srk",
    aliases: ["EOS_SRK_COMP", "SRK", "SOAVE_REDLICH_KWONG"],
    label: "Soave-Redlich-Kwong EOS (SRK)",
    category: "PVT & EOS",
    archetypeId: EclipseArchetypeId.EOS_SRK_COMP,
    description:
      "Soave-Redlich-Kwong (1972) cubic equation of state solving for vapor/liquid Z-factor and fugacity departure.",
    provenance: "Soave (1972) Chem. Eng. Sci. 27(6):1197-1203; OPM Flow Compositional Manual",
    params: [
      ["pc", 667.8, "psia", "Critical pressure"],
      ["tc", 343.0, "degR", "Critical temperature"],
      ["omega", 0.0115, "1", "Acentric factor"],
      ["mw", 16.04, "lb/lbmol", "Molecular weight"],
    ],
  },
  {
    modelType: "rock",
    aliases: ["ROCK", "ROCK_COMPRESS"],
    label: "Rock Pore Compressibility (ROCK)",
    category: "PVT & EOS",
    archetypeId: EclipseArchetypeId.ROCK_COMPRESS,
    description:
      "Exponential pore-volume multiplier phi(P)/phi_ref = exp(c_r * (P - P_ref)) for geomechanical compaction.",
    provenance: "OPM Flow Reference Manual (ROCK); Hall (1953) Trans. AIME",
    params: [
      ["pRef", 3000.0, "psia", "Reference rock pressure"],
      ["cr", 4.0e-6, "1/psi", "Rock pore-volume compressibility"],
      ["poroRef", 0.2, "1", "Reference porosity"],
    ],
  },

  // =========================================================================
  // Relative Permeability & SCAL
  // =========================================================================
  {
    modelType: "swof",
    aliases: ["SWOF", "SWOF_COREY", "COREY_OW"],
    label: "Oil-Water Corey SCAL (SWOF)",
    category: "Relative Permeability & SCAL",
    archetypeId: EclipseArchetypeId.SWOF_COREY,
    description:
      "Corey (1954) power-law oil-water relative permeability krw(Sw), krow(Sw) and imbibition/drainage capillary pressure Pcow(Sw).",
    provenance: "Corey (1954) Producers Monthly 19(1):38-41; OPM Flow Reference Manual (SWOF)",
    params: [
      ["swc", 0.2, "1", "Connate water saturation"],
      ["sor", 0.2, "1", "Residual oil saturation to water"],
      ["krwMax", 0.8, "1", "Endpoint water relative permeability"],
      ["kroMax", 1.0, "1", "Endpoint oil relative permeability"],
      ["nw", 2.0, "1", "Water Corey exponent"],
      ["no", 2.0, "1", "Oil Corey exponent"],
      ["pcMax", 10.0, "psi", "Maximum oil-water capillary pressure at Swc"],
    ],
  },
  {
    modelType: "sgof",
    aliases: ["SGOF", "SGOF_COREY", "COREY_GO"],
    label: "Gas-Oil Corey SCAL (SGOF)",
    category: "Relative Permeability & SCAL",
    archetypeId: EclipseArchetypeId.SGOF_COREY,
    description:
      "Corey (1954) power-law gas-oil relative permeability krg(Sg), krog(Sg) and gas-oil capillary pressure Pcog(Sg).",
    provenance: "Corey (1954) Producers Monthly 19(1):38-41; OPM Flow Reference Manual (SGOF)",
    params: [
      ["sgc", 0.05, "1", "Critical gas saturation"],
      ["sorg", 0.15, "1", "Residual oil saturation to gas"],
      ["swc", 0.2, "1", "Connate water saturation"],
      ["krgMax", 0.9, "1", "Endpoint gas relative permeability"],
      ["kroMax", 1.0, "1", "Endpoint oil relative permeability"],
      ["ng", 2.0, "1", "Gas Corey exponent"],
      ["nog", 2.5, "1", "Oil-in-gas Corey exponent"],
      ["pcMax", 5.0, "psi", "Maximum gas-oil capillary pressure"],
    ],
  },
  {
    modelType: "stone1",
    aliases: ["STONE1", "STONE1_3PHASE"],
    label: "Stone I 3-Phase RelPerm (STONE1)",
    category: "Relative Permeability & SCAL",
    archetypeId: EclipseArchetypeId.STONE1_3PHASE,
    description:
      "Stone I (1970) probability-based three-phase oil relative permeability combining two-phase SWOF and SGOF curves.",
    provenance: "Stone (1970) JPT 22(2):214-218; Aziz & Settari (1979); OPM Flow Reference Manual (STONE1)",
    params: [
      ["swc", 0.2, "1", "Connate water saturation"],
      ["sorw", 0.2, "1", "Residual oil saturation to water"],
      ["sgc", 0.05, "1", "Critical gas saturation"],
      ["sorg", 0.15, "1", "Residual oil saturation to gas"],
      ["krocw", 1.0, "1", "Oil relperm at connate water"],
      ["now", 2.0, "1", "Oil-water Corey exponent"],
      ["nog", 2.0, "1", "Oil-gas Corey exponent"],
    ],
  },
  {
    modelType: "stone2",
    aliases: ["STONE2", "STONE2_3PHASE"],
    label: "Stone II 3-Phase RelPerm (STONE2)",
    category: "Relative Permeability & SCAL",
    archetypeId: EclipseArchetypeId.STONE2_3PHASE,
    description:
      "Stone II (1973) three-phase oil relative permeability kro = krocw * [(krow/krocw + krw)*(krog/krocw + krg) - (krw + krg)].",
    provenance: "Stone (1973) J. Can. Pet. Tech. 12(4):53-61; OPM Flow Reference Manual (STONE2)",
    params: [
      ["swc", 0.2, "1", "Connate water saturation"],
      ["sor", 0.2, "1", "Residual oil saturation"],
      ["sgc", 0.05, "1", "Critical gas saturation"],
      ["krwMax", 0.8, "1", "Endpoint water relperm"],
      ["krgMax", 0.9, "1", "Endpoint gas relperm"],
      ["krocw", 1.0, "1", "Oil relperm at connate water"],
      ["nw", 2.0, "1", "Water Corey exponent"],
      ["ng", 2.0, "1", "Gas Corey exponent"],
      ["now", 2.0, "1", "Oil-water Corey exponent"],
      ["nog", 2.0, "1", "Oil-gas Corey exponent"],
    ],
  },
  {
    modelType: "pc_jfunc",
    aliases: ["JFUNC", "PC_LEVERETT_J", "LEVERETT_J"],
    label: "Leverett J-Function (JFUNC)",
    category: "Relative Permeability & SCAL",
    archetypeId: EclipseArchetypeId.PC_LEVERETT_J,
    description:
      "Leverett (1941) dimensionless J-function capillary pressure scaling Pc = sigma * cos(theta) * sqrt(phi/k) * J(Sw).",
    provenance: "Leverett (1941) Trans. AIME 142:152-169; OPM Flow Reference Manual (JFUNC)",
    params: [
      ["sigma", 30.0, "dyn/cm", "Interfacial tension"],
      ["cosTheta", 1.0, "1", "Cosine of wetting contact angle"],
      ["poro", 0.2, "1", "Rock porosity"],
      ["perm", 100.0, "mD", "Absolute rock permeability"],
      ["swc", 0.2, "1", "Connate water saturation"],
      ["jScale", 0.5, "1", "Dimensionless J-curve scale factor"],
      ["jExp", 1.5, "1", "Dimensionless J-curve exponent"],
    ],
  },

  // =========================================================================
  // Wells & Aquifers
  // =========================================================================
  {
    modelType: "welspecs_prod",
    aliases: ["WELSPECS_PROD", "WCONPROD", "PRODUCER"],
    label: "Production Well Control (WCONPROD)",
    category: "Wells & Aquifers",
    archetypeId: EclipseArchetypeId.WELSPECS_PROD,
    description:
      "Production well rate/BHP constraint evaluator computing feasible drawdown rate subject to minimum BHP limit.",
    provenance: "OPM Flow Reference Manual (WELSPECS / WCONPROD); Peaceman (1978)",
    params: [
      ["targetRate", 2000.0, "stb/d", "Target surface production rate"],
      ["bhpMin", 1500.0, "psia", "Minimum bottom-hole pressure constraint"],
      ["wellIndex", 10.0, "stb/(d*psi)", "Effective well productivity index"],
    ],
  },
  {
    modelType: "welspecs_inj",
    aliases: ["WELSPECS_INJ", "WCONINJE", "INJECTOR"],
    label: "Injection Well Control (WCONINJE)",
    category: "Wells & Aquifers",
    archetypeId: EclipseArchetypeId.WELSPECS_INJ,
    description:
      "Injection well rate/BHP constraint evaluator computing feasible injection rate subject to maximum BHP limit.",
    provenance: "OPM Flow Reference Manual (WELSPECS / WCONINJE); Peaceman (1978)",
    params: [
      ["targetRate", 2500.0, "stb/d", "Target surface injection rate"],
      ["bhpMax", 5000.0, "psia", "Maximum bottom-hole pressure constraint"],
      ["wellIndex", 10.0, "stb/(d*psi)", "Effective well injectivity index"],
    ],
  },
  {
    modelType: "compdat",
    aliases: ["COMPDAT", "COMPDAT_PEACEMAN", "PEACEMAN_WI"],
    label: "Peaceman Completion Index (COMPDAT)",
    category: "Wells & Aquifers",
    archetypeId: EclipseArchetypeId.COMPDAT_PEACEMAN,
    description:
      "Peaceman (1978, 1983) anisotropic well productivity index WI = c_u * 2*pi*sqrt(kx*ky)*h / (ln(r_o/r_w) + s) with equivalent drainage radius r_o.",
    provenance:
      "Peaceman (1978) SPEJ 18(3):183-194; Peaceman (1983) SPEJ 23(3):531-543; OPM Flow Reference Manual (COMPDAT)",
    params: [
      ["kx", 100.0, "mD", "Grid block permeability in X direction"],
      ["ky", 100.0, "mD", "Grid block permeability in Y direction"],
      ["h", 50.0, "ft", "Completion net pay thickness dz"],
      ["dx", 100.0, "ft", "Grid block dimension dx"],
      ["dy", 100.0, "ft", "Grid block dimension dy"],
      ["rw", 0.25, "ft", "Wellbore radius"],
      ["skin", 0.0, "1", "Formation damage skin factor"],
      ["unitFactor", 1.0, "1", "Unit conversion constant (1.0 SI/canonical, 0.001127 FIELD)"],
    ],
  },
  {
    modelType: "vfpprod",
    aliases: ["VFPPROD", "VFPPROD_LIFT"],
    label: "Production VFP Lift Curve (VFPPROD)",
    category: "Wells & Aquifers",
    archetypeId: EclipseArchetypeId.VFPPROD_LIFT,
    description:
      "Vertical Flow Performance tubing-head pressure model combining hydrostatic fluid gradient and Darcy-Weisbach friction loss.",
    provenance: "Beggs & Brill (1973) JPT 25(5):607-617; OPM Flow Reference Manual (VFPPROD)",
    params: [
      ["depth", 8000.0, "ft", "Vertical tubing depth"],
      ["gradHydro", 0.35, "psi/ft", "Hydrostatic fluid pressure gradient"],
      ["fricCoeff", 1.5e-5, "psi/(stb/d)^2", "Quadratic tubing friction coefficient"],
      ["thpMin", 150.0, "psia", "Minimum tubing head pressure"],
    ],
  },
  {
    modelType: "mswell",
    aliases: ["WELSEGS", "MSWELL", "MSWELL_SEGMENT"],
    label: "Multi-Segment Wellbore (WELSEGS)",
    category: "Wells & Aquifers",
    archetypeId: EclipseArchetypeId.MSWELL_SEGMENT,
    description:
      "Multi-segment wellbore hydraulics computing hydrostatic, frictional, and acceleration pressure drop along a tubing segment.",
    provenance: "Holmes, Barkve & Lund (1998) SPE 50646; OPM Flow Reference Manual (WELSEGS)",
    params: [
      ["segLen", 500.0, "ft", "Segment measured length"],
      ["segDz", 400.0, "ft", "Segment true vertical depth change"],
      ["diameter", 0.35, "ft", "Internal tubing diameter"],
      ["roughness", 1.0e-4, "ft", "Tubing wall roughness"],
      ["rhoMix", 45.0, "lb/ft3", "Mixture fluid density"],
    ],
  },
  {
    modelType: "aqufetp",
    aliases: ["AQUFETP", "AQUFETP_FETKOVICH", "FETKOVICH"],
    label: "Fetkovich Analytical Aquifer (AQUFETP)",
    category: "Wells & Aquifers",
    archetypeId: EclipseArchetypeId.AQUFETP_FETKOVICH,
    description:
      "Fetkovich (1971) pseudo-steady-state analytical aquifer model tracking cumulative water influx We and aquifer pressure depletion.",
    provenance: "Fetkovich (1971) JPT 23(7):814-828; OPM Flow Reference Manual (AQUFETP)",
    params: [
      ["pInit", 4000.0, "psia", "Initial aquifer pressure"],
      ["wei", 1.0e8, "stb", "Maximum encroachable water volume Wei = ct * Vi * Pi"],
      ["jProd", 200.0, "stb/(d*psi)", "Aquifer productivity index J"],
    ],
  },
  {
    modelType: "aqutab",
    aliases: ["AQUTAB", "AQUCT", "AQUTAB_CARTER_TRACY", "CARTER_TRACY"],
    label: "Carter-Tracy Aquifer (AQUTAB / AQUCT)",
    category: "Wells & Aquifers",
    archetypeId: EclipseArchetypeId.AQUTAB_CARTER_TRACY,
    description:
      "Carter-Tracy (1960) analytical radial aquifer model using dimensionless pressure P_D(t_D) approximation for unsteady-state water influx.",
    provenance:
      "Carter & Tracy (1960) Trans. AIME 219:415-417; van Everdingen & Hurst (1949); OPM Flow Reference Manual (AQUCT)",
    params: [
      ["pInit", 4000.0, "psia", "Initial aquifer pressure"],
      ["influxConst", 5000.0, "stb/psi", "Aquifer influx constant B = 1.119 * phi * ct * h * ro^2 * f"],
      ["timeConst", 0.05, "1/day", "Dimensionless time conversion constant tD / t"],
    ],
  },
];

/**
 * Converts `ECLIPSE_MODEL_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG icons and port layouts.
 */
export function buildEclipseCleanroomSchemas(): CleanroomModelSchema[] {
  return ECLIPSE_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `eclipse:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "subsurface",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "eclipse_physics_model",
      width: 84,
      height: 48,
      svg: generateEclipseBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
