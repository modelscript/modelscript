// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * SLB OLGA cleanroom multiphase equipment & correlation archetype IDs matching
 * `assets/olga-std-lib/src/models.ts`.
 */
export const OlgaArchetypeId = {
  // Flow & Equipment Modules
  VALVE: 1,
  CHOKE: 2,
  PUMP: 3,
  COMPRESSOR: 4,
  SEPARATOR: 5,
  HEATEXCHANGER: 6,
  WELL: 7,
  SOURCE: 8,
  LEAK: 9,
  PIG: 10,
  PID_CONTROLLER: 11,
  ESD_VALVE: 12,

  // Multiphase Flow & PVT Kernels
  FLOW_DRIFT_FLUX: 20,
  FLOW_BEGGS_BRILL: 21,
  FLOW_TAITEL_DUKLER: 22,
  PVT_BLACK_OIL: 30,
  PVT_COMPOSITIONAL_PR: 31,
  PVT_HYDRATE_CURVE: 32,
  WALL_INSULATED: 40,
  WALL_BURIED: 41,
} as const;

export type OlgaArchetypeId = (typeof OlgaArchetypeId)[keyof typeof OlgaArchetypeId];

export type OlgaModelCategory =
  | "Flow Control"
  | "Rotating Machinery"
  | "Process Equipment"
  | "Boundary & Well"
  | "Integrity & Control"
  | "Multiphase Flow"
  | "PVT & Flow Assurance"
  | "Thermal Wall";

export interface OlgaModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: OlgaModelCategory;
  archetypeId: OlgaArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<OlgaModelCategory, { fill: string; stroke: string; badge: string }> = {
  "Flow Control": { fill: "#1e3a5f", stroke: "#60a5fa", badge: "VLV" },
  "Rotating Machinery": { fill: "#3b1f47", stroke: "#c084fc", badge: "MCH" },
  "Process Equipment": { fill: "#163b3b", stroke: "#2dd4bf", badge: "EQP" },
  "Boundary & Well": { fill: "#1e3f2f", stroke: "#34d399", badge: "BND" },
  "Integrity & Control": { fill: "#422006", stroke: "#fb923c", badge: "CTL" },
  "Multiphase Flow": { fill: "#172554", stroke: "#38bdf8", badge: "FLW" },
  "PVT & Flow Assurance": { fill: "#3f2e18", stroke: "#fbbf24", badge: "PVT" },
  "Thermal Wall": { fill: "#3b2323", stroke: "#f87171", badge: "THM" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for an OLGA multiphase model.
 */
export function generateOlgaBlockSvg(modelType: string, category: OlgaModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType
    .toUpperCase()
    .replace(/^FLOW_|^PVT_|^WALL_/, "")
    .slice(0, 8);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 48" width="80" height="48">` +
    `<rect x="2" y="2" width="76" height="44" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="24" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="18" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="40" y="34" text-anchor="middle" font-family="monospace" font-size="9.5" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: OlgaModelCategory): DiagramPortSpec[] {
  switch (category) {
    case "Flow Control":
      return [
        { name: "inlet", kind: "fluid", side: "left", dx: 0, dy: 24 },
        { name: "outlet", kind: "fluid", side: "right", dx: 80, dy: 24 },
        { name: "opening", kind: "signal", side: "top", dx: 40, dy: 0 },
      ];
    case "Rotating Machinery":
      return [
        { name: "suction", kind: "fluid", side: "left", dx: 0, dy: 24 },
        { name: "discharge", kind: "fluid", side: "right", dx: 80, dy: 24 },
        { name: "speed", kind: "signal", side: "top", dx: 40, dy: 0 },
      ];
    case "Process Equipment":
      return [
        { name: "inlet", kind: "fluid", side: "left", dx: 0, dy: 24 },
        { name: "outlet", kind: "fluid", side: "right", dx: 80, dy: 16 },
        { name: "thermal", kind: "thermal", side: "bottom", dx: 40, dy: 48 },
      ];
    case "Boundary & Well":
      return [
        { name: "outlet", kind: "fluid", side: "right", dx: 80, dy: 24 },
        { name: "reservoir", kind: "fluid", side: "left", dx: 0, dy: 24 },
      ];
    case "Integrity & Control":
      return [
        { name: "meas", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "cmd", kind: "signal", side: "right", dx: 80, dy: 24 },
      ];
    case "Multiphase Flow":
      return [
        { name: "inlet", kind: "fluid", side: "left", dx: 0, dy: 24 },
        { name: "outlet", kind: "fluid", side: "right", dx: 80, dy: 24 },
      ];
    case "PVT & Flow Assurance":
      return [
        { name: "pt_in", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "props_out", kind: "signal", side: "right", dx: 80, dy: 24 },
      ];
    case "Thermal Wall":
      return [
        { name: "fluid", kind: "thermal", side: "left", dx: 0, dy: 24 },
        { name: "ambient", kind: "thermal", side: "right", dx: 80, dy: 24 },
      ];
  }
}

/**
 * Cleanroom SLB OLGA standard equipment & multiphase correlation library specifications.
 */
export const OLGA_MODEL_SPECS: OlgaModelSpec[] = [
  // ── Flow & Equipment Modules ────────────────────────────────────────────────
  {
    modelType: "VALVE",
    aliases: ["valve", "CONTROL_VALVE", "CHECKVALVE"],
    label: "Pipeline Control Valve",
    category: "Flow Control",
    archetypeId: OlgaArchetypeId.VALVE,
    description:
      "Hydrodynamic control valve modeling pressure drop and mass flow via discharge coefficient and stroke opening.",
    provenance: "ISA-75.01.01 / IEC 60534-2-1 Flow Equations for Sizing Control Valves",
    params: [
      ["diameter", 0.15, "m", "Valve throat diameter"],
      ["cd", 0.84, "-", "Discharge coefficient Cd"],
      ["rho_mix", 650.0, "kg/m3", "Reference mixture density"],
      ["opening_min", 0.0, "-", "Minimum stem opening fraction"],
      ["opening_max", 1.0, "-", "Maximum stem opening fraction"],
    ],
  },
  {
    modelType: "CHOKE",
    aliases: ["choke", "HYDROVALVE", "PERKINS_CHOKE"],
    label: "Multiphase Production Choke",
    category: "Flow Control",
    archetypeId: OlgaArchetypeId.CHOKE,
    description: "Critical and subcritical multiphase production choke using the Perkins hydrodynamic model.",
    provenance:
      "Perkins, T.K. (1993), 'Critical and Subcritical Flow of Multiphase Mixtures Through Chokes', SPE Drilling & Completion 8(4), 271-276",
    params: [
      ["diameter", 0.05, "m", "Choke bean / throat diameter"],
      ["cd", 0.826, "-", "Perkins discharge coefficient Cd"],
      ["rho_mix", 500.0, "kg/m3", "Upstream mixture density"],
      ["k_poly", 1.25, "-", "Polytropic gas expansion exponent"],
      ["glr", 0.15, "-", "Gas mass fraction at choke inlet"],
    ],
  },
  {
    modelType: "PUMP",
    aliases: ["pump", "ESP", "CENTRIFUGAL_PUMP"],
    label: "Multiphase Booster Pump",
    category: "Rotating Machinery",
    archetypeId: OlgaArchetypeId.PUMP,
    description: "Centrifugal / multiphase booster pump with gas-void-fraction head degradation and efficiency curve.",
    provenance:
      "Turpin, J.L., Lea, J.F., & Bearden, J.L. (1986), 'Gas-Liquid Flow Through Centrifugal Pumps — Correlation of Data', 3rd Int. Pump Symposium",
    params: [
      ["rated_head", 250.0, "m", "Rated liquid head at nominal speed"],
      ["rated_flow", 0.12, "m3/s", "Rated volumetric flow rate"],
      ["efficiency", 0.75, "-", "Hydraulic pump efficiency"],
      ["rho_liq", 850.0, "kg/m3", "Liquid phase density"],
      ["gvf_limit", 0.25, "-", "Gas void fraction limit for head degradation"],
    ],
  },
  {
    modelType: "COMPRESSOR",
    aliases: ["compressor", "GAS_COMPRESSOR"],
    label: "Polytropic Gas Compressor",
    category: "Rotating Machinery",
    archetypeId: OlgaArchetypeId.COMPRESSOR,
    description: "Polytropic centrifugal gas compressor computing discharge pressure boost and temperature rise.",
    provenance: "GPSA Engineering Data Book (14th Ed.), Section 13: Compressors and Expanders — Polytropic Compression",
    params: [
      ["pressure_ratio", 2.2, "-", "Nominal discharge-to-suction pressure ratio"],
      ["poly_eff", 0.78, "-", "Polytropic compression efficiency"],
      ["k_gas", 1.28, "-", "Isentropic gas heat capacity ratio Cp/Cv"],
      ["surge_margin", 0.1, "-", "Minimum anti-surge flow margin"],
    ],
  },
  {
    modelType: "SEPARATOR",
    aliases: ["separator", "FLASH_SEPARATOR", "SLUG_CATCHER"],
    label: "Multiphase Gravity Separator",
    category: "Process Equipment",
    archetypeId: OlgaArchetypeId.SEPARATOR,
    description: "Gravity gas-liquid separator / slug catcher computing phase split and liquid holdup retention.",
    provenance:
      "Arnold, K. & Stewart, M. (2008), Surface Production Operations Vol. 1: Design of Oil-Handling Systems and Facilities",
    params: [
      ["volume", 25.0, "m3", "Separator vessel internal volume"],
      ["sep_eff", 0.98, "-", "Gas-liquid separation efficiency"],
      ["liq_level_init", 0.45, "-", "Initial liquid level fraction"],
      ["dp_vessel", 5000.0, "Pa", "Internal vessel pressure drop"],
    ],
  },
  {
    modelType: "HEATEXCHANGER",
    aliases: ["heatexchanger", "HEAT_EXCHANGER", "COOLER", "HEATER"],
    label: "Pipeline Heat Exchanger",
    category: "Process Equipment",
    archetypeId: OlgaArchetypeId.HEATEXCHANGER,
    description:
      "Thermal heat exchanger transferring heat Q = U*A*(T - T_amb) between process fluid and secondary medium.",
    provenance:
      "Incropera, F.P. & DeWitt, D.P. (2007), Fundamentals of Heat and Mass Transfer, Ch. 11: Heat Exchangers",
    params: [
      ["u_coeff", 450.0, "W/(m2*K)", "Overall heat transfer coefficient U"],
      ["area", 120.0, "m2", "Effective heat transfer surface area A"],
      ["cp_mix", 2200.0, "J/(kg*K)", "Mixture specific heat capacity"],
      ["dp_hx", 15000.0, "Pa", "Shell/tube side pressure drop"],
    ],
  },
  {
    modelType: "WELL",
    aliases: ["well", "IPR", "VOGEL_WELL"],
    label: "Production Wellbore IPR",
    category: "Boundary & Well",
    archetypeId: OlgaArchetypeId.WELL,
    description:
      "Reservoir Inflow Performance Relationship (Linear PI / Vogel quadratic inflow) coupling reservoir to flowline.",
    provenance: "Vogel, J.V. (1968), 'Inflow Performance Relationships for Solution-Gas Drive Wells', JPT 20(1), 83-92",
    params: [
      ["p_res", 2.5e7, "Pa", "Static reservoir pressure"],
      ["p_bubble", 1.8e7, "Pa", "Bubble point pressure"],
      ["pi", 2.5e-6, "kg/(s*Pa)", "Productivity index above bubble point"],
      ["gas_frac", 0.12, "-", "Produced gas mass fraction"],
    ],
  },
  {
    modelType: "SOURCE",
    aliases: ["source", "MASS_SOURCE", "INLET_SOURCE"],
    label: "Multiphase Mass Source",
    category: "Boundary & Well",
    archetypeId: OlgaArchetypeId.SOURCE,
    description: "Specified multiphase mass flow rate, gas fraction, and temperature boundary source.",
    provenance:
      "Bendiksen, K.H. et al. (1991), 'The Dynamic Two-Fluid Model OLGA: Theory and Application', SPE Production Engineering 6(2), 171-180",
    params: [
      ["mass_rate", 45.0, "kg/s", "Nominal total mass flow rate"],
      ["gas_frac", 0.15, "-", "Inlet gas mass fraction"],
      ["t_source", 343.15, "K", "Source fluid temperature"],
    ],
  },
  {
    modelType: "LEAK",
    aliases: ["leak", "RUPTURE", "ORIFICE_LEAK"],
    label: "Pipeline Leak / Rupture",
    category: "Integrity & Control",
    archetypeId: OlgaArchetypeId.LEAK,
    description: "Pipeline wall breach orifice discharge model for blowdown and leak-detection transient scenarios.",
    provenance: "API RP 520 / ISO 4126 Orifice Discharge Equations for Two-Phase Release",
    params: [
      ["hole_diameter", 0.02, "m", "Equivalent circular leak orifice diameter"],
      ["cd", 0.62, "-", "Sharp-edged orifice discharge coefficient"],
      ["rho_mix", 700.0, "kg/m3", "Fluid density at leak plane"],
    ],
  },
  {
    modelType: "PIG",
    aliases: ["pig", "PIG_TRACKER", "SPHERE_PIG"],
    label: "Pipeline Inspection / Cleaning Pig",
    category: "Integrity & Control",
    archetypeId: OlgaArchetypeId.PIG,
    description: "Kinematic and dynamic pig tracking model accounting for bypass leakage and wall friction.",
    provenance:
      "Kohda, K., Suzukawa, Y., & Furukawa, H. (1988), 'Analysis of Transient Gas-Liquid Two-Phase Flow in Pipelines — Pigging', ASME JERT",
    params: [
      ["pipe_diameter", 0.3, "m", "Host pipeline inner diameter"],
      ["bypass_frac", 0.05, "-", "Fluid bypass fraction past pig cups"],
      ["dp_friction", 25000.0, "Pa", "Pig-to-wall mechanical friction pressure drop"],
    ],
  },
  {
    modelType: "PID_CONTROLLER",
    aliases: ["pid_controller", "CONTROLLER", "ANTI_SLUG_PID"],
    label: "PID Process / Anti-Slug Controller",
    category: "Integrity & Control",
    archetypeId: OlgaArchetypeId.PID_CONTROLLER,
    description:
      "Proportional-Integral-Derivative feedback controller with anti-windup clamping for choke/pressure regulation.",
    provenance:
      "Åström, K.J. & Hägglund, T. (2006), Advanced PID Control, ISA; Storkaas & Skogestad (2007) Anti-Slug Control",
    params: [
      ["kp", 1.5, "-", "Proportional gain Kp"],
      ["ti", 20.0, "s", "Integral reset time Ti"],
      ["td", 0.5, "s", "Derivative time Td"],
      ["setpoint", 5.0e6, "Pa", "Controller target setpoint"],
      ["u_min", 0.05, "-", "Minimum controller output"],
      ["u_max", 1.0, "-", "Maximum controller output"],
    ],
  },
  {
    modelType: "ESD_VALVE",
    aliases: ["esd_valve", "ESDV", "SHUTDOWN_VALVE"],
    label: "Emergency Shutdown (ESD) Valve",
    category: "Integrity & Control",
    archetypeId: OlgaArchetypeId.ESD_VALVE,
    description: "Safety-instrumented emergency shutdown valve with deterministic linear closure ramp on trip signal.",
    provenance: "IEC 61511 / API Spec 6D Emergency Shutdown Valve Closure Dynamics",
    params: [
      ["diameter", 0.25, "m", "Valve bore diameter"],
      ["cd", 0.85, "-", "Discharge coefficient Cd"],
      ["close_time", 15.0, "s", "Full-stroke emergency closure time"],
      ["rho_mix", 650.0, "kg/m3", "Reference mixture density"],
    ],
  },

  // ── Multiphase Flow & PVT Kernels ───────────────────────────────────────────
  {
    modelType: "FLOW_DRIFT_FLUX",
    aliases: ["flow_drift_flux", "DRIFT_FLUX", "ZUBER_FINDLAY"],
    label: "Zuber-Findlay Drift-Flux Kernel",
    category: "Multiphase Flow",
    archetypeId: OlgaArchetypeId.FLOW_DRIFT_FLUX,
    description:
      "Zuber-Findlay drift-flux void fraction α = j_g / (C0 * j_m + v_gj) and two-phase mixture momentum gradient.",
    provenance:
      "Zuber, N. & Findlay, J.A. (1965), 'Average Volumetric Concentration in Two-Phase Flow Systems', ASME J. Heat Transfer 87(4), 453-468",
    params: [
      ["c0", 1.2, "-", "Distribution profile parameter C0"],
      ["v_gj", 0.35, "m/s", "Weighted mean gas drift velocity v_gj"],
      ["diameter", 0.25, "m", "Pipe inner diameter"],
      ["inclination", 0.0, "rad", "Pipe inclination angle from horizontal"],
      ["rho_gas", 45.0, "kg/m3", "Gas phase density"],
      ["rho_liq", 820.0, "kg/m3", "Liquid phase density"],
      ["roughness", 4.5e-5, "m", "Pipe wall absolute roughness"],
    ],
  },
  {
    modelType: "FLOW_BEGGS_BRILL",
    aliases: ["flow_beggs_brill", "BEGGS_BRILL"],
    label: "Beggs-Brill Two-Phase Flow Kernel",
    category: "Multiphase Flow",
    archetypeId: OlgaArchetypeId.FLOW_BEGGS_BRILL,
    description: "Empirical inclined two-phase liquid holdup and frictional/hydrostatic pressure gradient correlation.",
    provenance:
      "Beggs, H.D. & Brill, J.P. (1973), 'A Study of Two-Phase Flow in Inclined Pipes', JPT 25(5), 607-617 (SPE-4007-PA)",
    params: [
      ["diameter", 0.25, "m", "Pipe inner diameter"],
      ["inclination", 0.0, "rad", "Pipe inclination angle (+uphill, -downhill)"],
      ["rho_gas", 45.0, "kg/m3", "Gas phase density"],
      ["rho_liq", 820.0, "kg/m3", "Liquid phase density"],
      ["mu_gas", 1.5e-5, "Pa*s", "Gas dynamic viscosity"],
      ["mu_liq", 1.2e-3, "Pa*s", "Liquid dynamic viscosity"],
      ["roughness", 4.5e-5, "m", "Pipe absolute roughness"],
    ],
  },
  {
    modelType: "FLOW_TAITEL_DUKLER",
    aliases: ["flow_taitel_dukler", "TAITEL_DUKLER"],
    label: "Taitel-Dukler Mechanistic Flow Kernel",
    category: "Multiphase Flow",
    archetypeId: OlgaArchetypeId.FLOW_TAITEL_DUKLER,
    description:
      "Mechanistic horizontal/near-horizontal flow regime transition (stratified, intermittent, annular) and holdup kernel.",
    provenance:
      "Taitel, Y. & Dukler, A.E. (1976), 'A Model for Predicting Flow Regime Transitions in Horizontal and Near Horizontal Gas-Liquid Flow', AIChE J. 22(1), 47-55",
    params: [
      ["diameter", 0.25, "m", "Pipe inner diameter"],
      ["inclination", 0.0, "rad", "Pipe inclination angle"],
      ["rho_gas", 45.0, "kg/m3", "Gas phase density"],
      ["rho_liq", 820.0, "kg/m3", "Liquid phase density"],
      ["mu_gas", 1.5e-5, "Pa*s", "Gas dynamic viscosity"],
      ["mu_liq", 1.2e-3, "Pa*s", "Liquid dynamic viscosity"],
    ],
  },
  {
    modelType: "PVT_BLACK_OIL",
    aliases: ["pvt_black_oil", "BLACK_OIL", "STANDING_PVT"],
    label: "Standing Black-Oil PVT Kernel",
    category: "PVT & Flow Assurance",
    archetypeId: OlgaArchetypeId.PVT_BLACK_OIL,
    description:
      "Standing black-oil correlation for solution gas-oil ratio Rs (scf/STB) and oil formation volume factor Bo (bbl/STB).",
    provenance:
      "Standing, M.B. (1947), 'A Pressure-Volume-Temperature Correlation for Mixtures of California Oils and Gases', API Drilling & Production Practice, 275-287",
    params: [
      ["api_gravity", 35.0, "degAPI", "Stock-tank oil API gravity"],
      ["gas_gravity", 0.72, "-", "Dissolved gas specific gravity (air = 1)"],
      ["water_cut", 0.1, "-", "Water volume fraction in liquid"],
    ],
  },
  {
    modelType: "PVT_COMPOSITIONAL_PR",
    aliases: ["pvt_compositional_pr", "PENG_ROBINSON", "PR_EOS"],
    label: "Peng-Robinson Compositional EOS",
    category: "PVT & Flow Assurance",
    archetypeId: OlgaArchetypeId.PVT_COMPOSITIONAL_PR,
    description: "Peng-Robinson (1976) cubic equation of state solving compressibility factor Z and fluid density.",
    provenance:
      "Peng, D.-Y. & Robinson, D.B. (1976), 'A New Two-Constant Equation of State', Ind. Eng. Chem. Fundam. 15(1), 59-64",
    params: [
      ["tc", 190.56, "K", "Pseudo-critical temperature Tc"],
      ["pc", 4.599e6, "Pa", "Pseudo-critical pressure Pc"],
      ["omega", 0.0115, "-", "Acentric factor ω"],
      ["molar_mass", 0.01604, "kg/mol", "Mixture molar mass"],
    ],
  },
  {
    modelType: "PVT_HYDRATE_CURVE",
    aliases: ["pvt_hydrate_curve", "HYDRATE_CURVE", "SLOAN_HYDRATE"],
    label: "Gas Hydrate Equilibrium Curve",
    category: "PVT & Flow Assurance",
    archetypeId: OlgaArchetypeId.PVT_HYDRATE_CURVE,
    description: "Gas hydrate phase boundary pressure and thermodynamic inhibitor (MEG/MeOH) subcooling depression.",
    provenance:
      "Sloan, E.D. & Koh, C.A. (2008), Clathrate Hydrates of Natural Gases (3rd Ed.), CRC Press; Hammerschmidt (1939)",
    params: [
      ["a_coeff", -10.5, "-", "Log-linear hydrate correlation intercept"],
      ["b_coeff", 0.095, "1/K", "Log-linear hydrate correlation temperature slope"],
      ["t_ref", 273.15, "K", "Reference ice-point temperature"],
      ["inhibitor_wt_pct", 0.0, "wt%", "Thermodynamic inhibitor (MEG) weight percent"],
      ["k_hammerschmidt", 2200.0, "K*g/mol", "Hammerschmidt constant (2200 for MEG, 2335 for MeOH)"],
      ["m_inhibitor", 62.07, "g/mol", "Inhibitor molar mass (MEG = 62.07 g/mol)"],
    ],
  },
  {
    modelType: "WALL_INSULATED",
    aliases: ["wall_insulated", "INSULATED_PIPE", "PIPE_WALL"],
    label: "Insulated Subsea Pipe Wall",
    category: "Thermal Wall",
    archetypeId: OlgaArchetypeId.WALL_INSULATED,
    description:
      "Composite cylindrical radial heat conduction through steel wall, syntactic foam insulation, and ambient film.",
    provenance:
      "Incropera, F.P. & DeWitt, D.P. (2007), Fundamentals of Heat and Mass Transfer, Ch. 3: Radial Systems (Cylindrical Wall)",
    params: [
      ["inner_diameter", 0.25, "m", "Pipe inner diameter"],
      ["insul_thickness", 0.05, "m", "Insulation layer thickness"],
      ["k_insul", 0.16, "W/(m*K)", "Insulation thermal conductivity"],
      ["h_amb", 500.0, "W/(m2*K)", "External seawater/air convective film coefficient"],
      ["length", 1000.0, "m", "Pipe segment length"],
      ["cp_mix", 2200.0, "J/(kg*K)", "Fluid mixture specific heat capacity"],
    ],
  },
  {
    modelType: "WALL_BURIED",
    aliases: ["wall_buried", "BURIED_PIPE", "SOIL_WALL"],
    label: "Buried Pipeline Thermal Wall",
    category: "Thermal Wall",
    archetypeId: OlgaArchetypeId.WALL_BURIED,
    description:
      "Buried pipeline steady radial heat loss using the cylindrical conduction shape factor in semi-infinite soil.",
    provenance:
      "Carslaw, H.S. & Jaeger, J.C. (1959), Conduction of Heat in Solids; Holman (2010) Buried Cylinder Shape Factor",
    params: [
      ["outer_diameter", 0.3, "m", "Pipe outer diameter"],
      ["burial_depth", 1.5, "m", "Burial depth to pipe centerline z"],
      ["k_soil", 1.2, "W/(m*K)", "Surrounding soil thermal conductivity"],
      ["length", 1000.0, "m", "Buried segment length"],
      ["cp_mix", 2200.0, "J/(kg*K)", "Fluid mixture specific heat capacity"],
    ],
  },
];

/**
 * Converts `OLGA_MODEL_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG icons and port layouts.
 */
export function buildOlgaCleanroomSchemas(): CleanroomModelSchema[] {
  return OLGA_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `olga:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "fluid",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "olga_model",
      width: 80,
      height: 48,
      svg: generateOlgaBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
