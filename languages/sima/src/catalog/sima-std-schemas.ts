// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * SINTEF SIMA (SIMO / RIFLEX) cleanroom marine & offshore model archetype IDs
 * matching `assets/sima-std-lib/src/models.ts`.
 */
export const SimaArchetypeId = {
  // Hydrodynamics & Bodies
  SIMO_BODY_6DOF: 1,
  SIMO_MORISON_MEMBER: 2,
  SIMO_HYDRO_STATIC: 3,
  SIMO_WAVE_DRIFT_QTF: 4,
  SIMO_ADDED_MASS_DAMPING: 5,

  // Mooring & Risers (RIFLEX)
  RIFLEX_CATENARY_LINE: 10,
  RIFLEX_BAR_ELEMENT: 11,
  RIFLEX_BEAM_RISER: 12,
  RIFLEX_FLEX_JOINT: 13,
  RIFLEX_BUOYANCY_MODULE: 14,
  RIFLEX_SEABED_CONTACT: 15,

  // Marine Equipment (SIMO)
  SIMO_FENDER: 20,
  SIMO_THRUSTER: 21,
  SIMO_WINCH: 22,
  SIMO_HAWSER: 23,
  SIMO_DP_CONTROLLER: 24,

  // Metocean Environment
  ENV_JONSWAP_WAVE: 30,
  ENV_PIERSON_MOSKOWITZ: 31,
  ENV_NPD_WIND: 32,
  ENV_CURRENT_PROFILE: 33,
} as const;

export type SimaArchetypeId = (typeof SimaArchetypeId)[keyof typeof SimaArchetypeId];

export type SimaModelCategory =
  | "Hydrodynamics & Bodies"
  | "Mooring & Risers"
  | "Marine Equipment"
  | "Metocean Environment";

export interface SimaModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: SimaModelCategory;
  archetypeId: SimaArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<SimaModelCategory, { fill: string; stroke: string; badge: string }> = {
  "Hydrodynamics & Bodies": { fill: "#0f2942", stroke: "#38bdf8", badge: "HYD" },
  "Mooring & Risers": { fill: "#1f2937", stroke: "#a78bfa", badge: "MOR" },
  "Marine Equipment": { fill: "#1e3a2f", stroke: "#34d399", badge: "EQP" },
  "Metocean Environment": { fill: "#16354d", stroke: "#22d3ee", badge: "ENV" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for a SIMA (SIMO/RIFLEX) model.
 */
export function generateSimaBlockSvg(modelType: string, category: SimaModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const shortName = modelType
    .replace(/^(SIMO_|RIFLEX_|ENV_)/, "")
    .toUpperCase()
    .slice(0, 10);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 48" width="96" height="48">` +
    `<rect x="2" y="2" width="92" height="44" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="26" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="19" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="48" y="34" text-anchor="middle" font-family="monospace" font-size="9.5" font-weight="bold" fill="#f8fafc">${shortName}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: SimaModelCategory): DiagramPortSpec[] {
  switch (category) {
    case "Hydrodynamics & Bodies":
      return [
        { name: "env", kind: "signal", side: "left", dx: 0, dy: 14 },
        { name: "mooring", kind: "mechanical", side: "left", dx: 0, dy: 34 },
        { name: "motion6dof", kind: "mechanical", side: "right", dx: 96, dy: 24 },
      ];
    case "Mooring & Risers":
      return [
        { name: "fairlead", kind: "mechanical", side: "left", dx: 0, dy: 24 },
        { name: "anchor", kind: "mechanical", side: "right", dx: 96, dy: 24 },
      ];
    case "Marine Equipment":
      return [
        { name: "cmd", kind: "signal", side: "left", dx: 0, dy: 14 },
        { name: "body", kind: "mechanical", side: "left", dx: 0, dy: 34 },
        { name: "force", kind: "mechanical", side: "right", dx: 96, dy: 24 },
      ];
    case "Metocean Environment":
      return [
        { name: "freq", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "field", kind: "signal", side: "right", dx: 96, dy: 24 },
      ];
  }
}

export const SIMA_MODEL_SPECS: SimaModelSpec[] = [
  // =========================================================================
  // 1. Hydrodynamics & Bodies (SIMO)
  // =========================================================================
  {
    modelType: "SIMO_Body6DOF",
    aliases: ["Body6DOF", "SIMO_Vessel", "FloatingBody6DOF"],
    label: "SIMO 6-DOF Floating Body",
    category: "Hydrodynamics & Bodies",
    archetypeId: SimaArchetypeId.SIMO_BODY_6DOF,
    description:
      "Rigid 6-DOF floating marine body governed by Cummins impulse-response equations of motion with added mass, radiation damping, and hydrostatic restoring.",
    provenance:
      "Cummins (1962) David Taylor Model Basin Report 1661; Faltinsen (1990) Sea Loads on Ships and Offshore Structures",
    params: [
      ["mass", 5.0e7, "kg", "Total structural mass of floating body"],
      ["addedMassSurge", 5.0e6, "kg", "Infinite-frequency surge added mass A11(inf)"],
      ["linearDamping", 2.0e5, "N*s/m", "Linear hydrodynamic radiation/viscous damping"],
      ["quadraticDamping", 5.0e4, "N*s^2/m^2", "Quadratic drag damping coefficient"],
      ["restoringK", 1.5e5, "N/m", "Equivalent horizontal mooring/restoring stiffness"],
      ["gmTransverse", 2.5, "m", "Transverse metacentric height GMt"],
    ],
  },
  {
    modelType: "SIMO_MorisonMember",
    aliases: ["MorisonMember", "SlenderElement", "MorisonCylinder"],
    label: "SIMO Morison Slender Member",
    category: "Hydrodynamics & Bodies",
    archetypeId: SimaArchetypeId.SIMO_MORISON_MEMBER,
    description:
      "Hydrodynamic drag and inertia force on a slender cylindrical member using the relative-velocity Morison equation.",
    provenance: "Morison, O'Brien, Johnson & Schaaf (1950) Petroleum Trans. AIME 189; DNV-RP-C205 §6.2",
    params: [
      ["diameter", 1.2, "m", "Hydrodynamic outer diameter D"],
      ["length", 20.0, "m", "Member wetted length L"],
      ["cd", 1.05, "-", "Normal drag coefficient CD"],
      ["cm", 2.0, "-", "Inertia coefficient CM (= 1 + Ca)"],
      ["waterDensity", 1025.0, "kg/m^3", "Seawater density rho"],
    ],
  },
  {
    modelType: "SIMO_HydroStatic",
    aliases: ["HydroStatic", "HydrostaticStiffness", "BuoyancyRestoring"],
    label: "SIMO Hydrostatic Restoring Matrix",
    category: "Hydrodynamics & Bodies",
    archetypeId: SimaArchetypeId.SIMO_HYDRO_STATIC,
    description:
      "Linearized hydrostatic restoring forces and moments in heave, roll, and pitch from waterplane area and metacentric heights.",
    provenance: "Faltinsen (1990) Sea Loads on Ships and Offshore Structures §3.2; DNV-RP-C205 §7.2",
    params: [
      ["waterplaneArea", 3200.0, "m^2", "Waterplane area Aw"],
      ["displacementVolume", 48000.0, "m^3", "Displaced volume V"],
      ["gmTransverse", 3.2, "m", "Transverse metacentric height GMt"],
      ["gmLongitudinal", 120.0, "m", "Longitudinal metacentric height GMl"],
      ["waterDensity", 1025.0, "kg/m^3", "Seawater density rho"],
      ["gravity", 9.80665, "m/s^2", "Gravitational acceleration g"],
    ],
  },
  {
    modelType: "SIMO_WaveDriftQTF",
    aliases: ["WaveDriftQTF", "MeanWaveDrift", "NewmanQTF"],
    label: "SIMO Second-Order Wave Drift (QTF)",
    category: "Hydrodynamics & Bodies",
    archetypeId: SimaArchetypeId.SIMO_WAVE_DRIFT_QTF,
    description:
      "Mean and slowly-varying second-order wave drift force using Newman's approximation of the Quadratic Transfer Function (QTF).",
    provenance: "Newman (1974) Second-Order Slowly-Varying Forces on Vessels in Irregular Waves; DNV-RP-C205 §7.4",
    params: [
      ["driftCoeff", 1.2e5, "N/m^2", "Diagonal wave-drift force coefficient QTF(w,w)"],
      ["waveAmplitude", 2.0, "m", "Regular/envelope wave amplitude zeta_a"],
      ["headingRad", 0.0, "rad", "Relative wave heading angle"],
      ["driftDamping", 1.5e4, "N*s/m", "Wave-drift damping coefficient"],
    ],
  },
  {
    modelType: "SIMO_AddedMassDamping",
    aliases: ["AddedMassDamping", "RadiationRetardation", "CumminsRadiation"],
    label: "SIMO Added Mass & Radiation Damping",
    category: "Hydrodynamics & Bodies",
    archetypeId: SimaArchetypeId.SIMO_ADDED_MASS_DAMPING,
    description:
      "Frequency-dependent added mass and radiation potential damping approximated via state-space retardation kernel.",
    provenance:
      "Ogilvie (1964) Recent Progress Toward the Understanding and Prediction of Ship Motions; DNV-RP-C205 §7.2",
    params: [
      ["addedMassInf", 4.5e6, "kg", "Infinite-frequency added mass A(inf)"],
      ["radiationB", 3.5e5, "N*s/m", "Potential radiation damping B(w)"],
      ["retardationDecay", 0.35, "1/s", "Exponential retardation memory decay rate"],
    ],
  },

  // =========================================================================
  // 2. Mooring & Risers (RIFLEX)
  // =========================================================================
  {
    modelType: "RIFLEX_CatenaryLine",
    aliases: ["CatenaryLine", "MooringLine", "InelasticCatenary"],
    label: "RIFLEX Catenary Mooring Line",
    category: "Mooring & Risers",
    archetypeId: SimaArchetypeId.RIFLEX_CATENARY_LINE,
    description:
      "Quasi-static inelastic catenary mooring line solver computing horizontal/vertical fairlead tensions, suspended length, and seabed touchdown.",
    provenance: "Faltinsen (1990) Sea Loads on Ships and Offshore Structures §8.2; DNV-OS-E301 Position Mooring",
    params: [
      ["submergedWeight", 1200.0, "N/m", "Submerged weight per unit length w"],
      ["totalLength", 1200.0, "m", "Total unstretched mooring line length L"],
      ["waterDepth", 300.0, "m", "Vertical fairlead-to-anchor height h"],
      ["horizontalSpan", 1080.0, "m", "Horizontal distance from anchor to fairlead X"],
      ["axialStiffnessEA", 8.0e8, "N", "Axial stiffness EA for taut regime"],
    ],
  },
  {
    modelType: "RIFLEX_BarElement",
    aliases: ["BarElement", "TrussElement", "AxialLineElement"],
    label: "RIFLEX Nonlinear Bar Element",
    category: "Mooring & Risers",
    archetypeId: SimaArchetypeId.RIFLEX_BAR_ELEMENT,
    description:
      "Tension-only axial bar finite element with elastic stiffness EA and optional proportional structural damping.",
    provenance: "DNV-OS-E301 Position Mooring; ISO 19901-7 Stationkeeping Systems for Floating Offshore Structures",
    params: [
      ["length0", 50.0, "m", "Unstretched element length L0"],
      ["axialStiffnessEA", 5.0e8, "N", "Axial stiffness EA"],
      ["structuralDamping", 1.0e5, "N*s/m", "Axial Rayleigh damping coefficient"],
      ["mbl", 1.2e7, "N", "Minimum breaking load (MBL)"],
    ],
  },
  {
    modelType: "RIFLEX_BeamRiser",
    aliases: ["BeamRiser", "FlexibleRiser", "SteelCatenaryRiser"],
    label: "RIFLEX Slender Beam Riser Element",
    category: "Mooring & Risers",
    archetypeId: SimaArchetypeId.RIFLEX_BEAM_RISER,
    description:
      "Slender marine riser beam element combining axial tension, Euler-Bernoulli bending moment EI*kappa, and minimum bending radius check.",
    provenance: "DNV-OS-F201 Dynamic Risers; API RP 17B Recommended Practice for Flexible Pipe",
    params: [
      ["bendingStiffnessEI", 2.5e7, "N*m^2", "Flexural bending stiffness EI"],
      ["axialStiffnessEA", 1.2e9, "N", "Axial stiffness EA"],
      ["outerDiameter", 0.35, "m", "Riser outer diameter"],
      ["minBendRadius", 12.0, "m", "Allowable minimum bending radius (MBR)"],
    ],
  },
  {
    modelType: "RIFLEX_FlexJoint",
    aliases: ["FlexJoint", "TaperStressJoint", "RiserFlexJoint"],
    label: "RIFLEX Elastomeric Flex Joint",
    category: "Mooring & Risers",
    archetypeId: SimaArchetypeId.RIFLEX_FLEX_JOINT,
    description:
      "Rotational elastomeric flex joint at riser hang-off or subsea wellhead with linear/nonlinear rotational stiffness and angular damping.",
    provenance: "DNV-OS-F201 Dynamic Risers §6; API RP 2RD Design of Risers for Floating Production Systems",
    params: [
      ["rotStiffness", 1.5e6, "N*m/rad", "Linear rotational stiffness K_theta"],
      ["rotStiffnessCubic", 2.0e7, "N*m/rad^3", "Nonlinear hardening stiffness at high deflection"],
      ["rotDamping", 5.0e4, "N*m*s/rad", "Angular viscous damping"],
      ["maxAngleRad", 0.1745, "rad", "Maximum rated deflection angle (10 deg)"],
    ],
  },
  {
    modelType: "RIFLEX_BuoyancyModule",
    aliases: ["BuoyancyModule", "LazyWaveBuoyancy", "SyntacticFoam"],
    label: "RIFLEX Distributed Buoyancy Module",
    category: "Mooring & Risers",
    archetypeId: SimaArchetypeId.RIFLEX_BUOYANCY_MODULE,
    description:
      "Syntactic foam buoyancy module for lazy-wave or steep-wave riser configurations providing net upward buoyancy and hydrodynamic drag.",
    provenance: "API RP 17B Flexible Pipe; DNV-RP-C205 §6.2 Hydrodynamic Loads on Slender Members",
    params: [
      ["outerDiameter", 1.1, "m", "Buoyancy module outer diameter"],
      ["length", 2.0, "m", "Module length"],
      ["dryMass", 420.0, "kg", "Dry mass of buoyancy module"],
      ["waterDensity", 1025.0, "kg/m^3", "Seawater density rho"],
      ["cd", 1.15, "-", "Transverse drag coefficient"],
    ],
  },
  {
    modelType: "RIFLEX_SeabedContact",
    aliases: ["SeabedContact", "SeabedSoil", "CoulombSeabed"],
    label: "RIFLEX Elastic-Coulomb Seabed Contact",
    category: "Mooring & Risers",
    archetypeId: SimaArchetypeId.RIFLEX_SEABED_CONTACT,
    description:
      "Unilateral normal penalty stiffness and regularized Coulomb friction model for riser/mooring touchdown zone seabed interaction.",
    provenance: "DNV-RP-F114 Pipe-Soil Interaction for Submarine Pipelines; DNV-OS-E301",
    params: [
      ["normalStiffness", 5.0e5, "N/m", "Seabed vertical soil stiffness Kz"],
      ["normalDamping", 1.0e4, "N*s/m", "Seabed vertical damping Cz"],
      ["muAxial", 0.4, "-", "Axial seabed Coulomb friction coefficient"],
      ["muLateral", 0.6, "-", "Lateral seabed Coulomb friction coefficient"],
      ["velReg", 0.05, "m/s", "Friction regularization velocity threshold"],
    ],
  },

  // =========================================================================
  // 3. Marine Equipment (SIMO)
  // =========================================================================
  {
    modelType: "SIMO_Fender",
    aliases: ["Fender", "MarineFender", "PneumaticFender"],
    label: "SIMO Nonlinear Marine Fender",
    category: "Marine Equipment",
    archetypeId: SimaArchetypeId.SIMO_FENDER,
    description:
      "Nonlinear elastomeric/pneumatic marine fender contact model with polynomial compression curve, loading hysteresis damping, and hull friction.",
    provenance: "PIANC MarCom WG 33 Guidelines for the Design of Fender Systems (2002); ISO 17357",
    params: [
      ["k1", 4.0e5, "N/m", "Linear compression stiffness"],
      ["k2", 1.5e5, "N/m^2", "Quadratic compression stiffness"],
      ["k3", 8.0e4, "N/m^3", "Cubic stiffening coefficient"],
      ["damping", 6.0e4, "N*s/m", "Hysteretic loading damping"],
      ["muFriction", 0.2, "-", "Hull-to-fender sliding friction coefficient"],
      ["maxDeflection", 1.8, "m", "Rated maximum fender compression"],
    ],
  },
  {
    modelType: "SIMO_Thruster",
    aliases: ["Thruster", "AzimuthThruster", "TunnelThruster"],
    label: "SIMO Azimuth / Tunnel Thruster",
    category: "Marine Equipment",
    archetypeId: SimaArchetypeId.SIMO_THRUSTER,
    description:
      "Marine propulsion thruster model computing bollard-pull thrust, advance-velocity inflow degradation, and azimuth force vector decomposition.",
    provenance: "Fossen (2011) Handbook of Marine Craft Hydrodynamics and Motion Control §12.3; DNV-RP-C205",
    params: [
      ["bollardPull", 6.0e5, "N", "Maximum bollard pull thrust at zero inflow"],
      ["advanceLossCoeff", 0.35, "-", "Inflow velocity thrust degradation factor"],
      ["maxInflowVel", 6.0, "m/s", "Reference inflow velocity for degradation"],
      ["azimuthRad", 0.0, "rad", "Default thruster azimuth angle"],
    ],
  },
  {
    modelType: "SIMO_Winch",
    aliases: ["Winch", "MooringWinch", "ActiveHeaveWinch"],
    label: "SIMO Mooring / Crane Winch",
    category: "Marine Equipment",
    archetypeId: SimaArchetypeId.SIMO_WINCH,
    description:
      "Line-hauling winch with drum speed control, maximum haul tension brake limit, and active constant-tension payout mode.",
    provenance: "DNV-OS-E301 Position Mooring; DNV-ST-0378 Offshore and Platform Lifting Appliances",
    params: [
      ["maxTension", 1.5e6, "N", "Maximum rated winch holding/hauling tension"],
      ["haulStiffness", 2.0e6, "N/m", "Effective wire-drum stiffness"],
      ["drumDamping", 8.0e4, "N*s/m", "Winch drive damping"],
      ["setpointTension", 4.0e5, "N", "Constant-tension mode target tension"],
    ],
  },
  {
    modelType: "SIMO_Hawser",
    aliases: ["Hawser", "TowLine", "SyntheticHawser"],
    label: "SIMO Synthetic Mooring Hawser",
    category: "Marine Equipment",
    archetypeId: SimaArchetypeId.SIMO_HAWSER,
    description:
      "Tension-only synthetic fiber hawser with power-law nonlinear elongation curve T = k * eps^p and hysteretic damping.",
    provenance: "OCIMF Mooring Equipment Guidelines (MEG4); DNV-OS-E303 Fibre Ropes for Offshore Mooring",
    params: [
      ["unstretchedLength", 80.0, "m", "Unstretched hawser length L0"],
      ["stiffnessCoeff", 1.2e7, "N", "Nonlinear tension coefficient k (T = k * eps^p)"],
      ["exponent", 1.6, "-", "Synthetic fiber load-elongation power exponent p"],
      ["damping", 3.0e4, "N*s/m", "Internal fiber damping coefficient"],
    ],
  },
  {
    modelType: "SIMO_DPController",
    aliases: ["DPController", "DynamicPositioning", "PID_DP"],
    label: "SIMO Dynamic Positioning PID Controller",
    category: "Marine Equipment",
    archetypeId: SimaArchetypeId.SIMO_DP_CONTROLLER,
    description:
      "Horizontal-plane Dynamic Positioning (DP) PID stationkeeping controller with integral anti-windup and thrust saturation.",
    provenance: "Fossen (2011) Handbook of Marine Craft Hydrodynamics and Motion Control §12.2; IMCA M 103",
    params: [
      ["kp", 2.5e5, "N/m", "Proportional position gain Kp"],
      ["ki", 1.2e4, "N/(m*s)", "Integral stationkeeping gain Ki"],
      ["kd", 8.0e5, "N*s/m", "Derivative velocity damping gain Kd"],
      ["maxForce", 2.0e6, "N", "Maximum commanded DP thrust force"],
    ],
  },

  // =========================================================================
  // 4. Metocean Environment
  // =========================================================================
  {
    modelType: "ENV_JONSWAPWave",
    aliases: ["JONSWAPWave", "JONSWAP", "WaveSpectrumJONSWAP"],
    label: "JONSWAP Irregular Wave Spectrum",
    category: "Metocean Environment",
    archetypeId: SimaArchetypeId.ENV_JONSWAP_WAVE,
    description:
      "Five-parameter JONSWAP wave energy spectral density S(omega) for fetch-limited North Sea and offshore sea states.",
    provenance:
      "Hasselmann et al. (1973) JONSWAP; DNV-RP-C205 §3.5.5.1 Environmental Conditions and Environmental Loads",
    params: [
      ["hs", 4.5, "m", "Significant wave height Hs"],
      ["tp", 10.0, "s", "Spectral peak period Tp"],
      ["gamma", 3.3, "-", "Non-dimensional peak shape parameter gamma"],
      ["sigmaA", 0.07, "-", "Spectral width parameter for omega <= omega_p"],
      ["sigmaB", 0.09, "-", "Spectral width parameter for omega > omega_p"],
    ],
  },
  {
    modelType: "ENV_PiersonMoskowitz",
    aliases: ["PiersonMoskowitz", "PMWave", "ISSCWave"],
    label: "Pierson-Moskowitz Wave Spectrum",
    category: "Metocean Environment",
    archetypeId: SimaArchetypeId.ENV_PIERSON_MOSKOWITZ,
    description:
      "Two-parameter Pierson-Moskowitz (ISSC) wave energy spectrum S(omega) for fully developed open-ocean sea states (JONSWAP with gamma = 1).",
    provenance: "Pierson & Moskowitz (1964) J. Geophys. Res. 69(24); DNV-RP-C205 §3.5.5.1",
    params: [
      ["hs", 4.5, "m", "Significant wave height Hs"],
      ["tp", 10.0, "s", "Spectral peak period Tp"],
    ],
  },
  {
    modelType: "ENV_NPDWind",
    aliases: ["NPDWind", "FroyaWind", "ISO19901Wind"],
    label: "NPD / Frøya Offshore Wind Spectrum",
    category: "Metocean Environment",
    archetypeId: SimaArchetypeId.ENV_NPD_WIND,
    description:
      "Norwegian Petroleum Directorate (NPD / Frøya) offshore wind gust power spectral density S_u(f) and logarithmic height profile.",
    provenance: "Andersen & Løvseth (1992) Frøya Wind Model; DNV-RP-C205 §2.3.3.2; ISO 19901-1",
    params: [
      ["u0", 25.0, "m/s", "1-hour mean wind speed at 10 m reference height"],
      ["heightZ", 10.0, "m", "Elevation z above mean sea level"],
      ["exponentN", 0.468, "-", "NPD spectral shape exponent n"],
    ],
  },
  {
    modelType: "ENV_CurrentProfile",
    aliases: ["CurrentProfile", "PowerLawCurrent", "OceanCurrent"],
    label: "Power-Law Ocean Current Profile",
    category: "Metocean Environment",
    archetypeId: SimaArchetypeId.ENV_CURRENT_PROFILE,
    description:
      "Depth-varying ocean current speed combining tidal power-law shear profile and wind-generated linear surface drift.",
    provenance: "DNV-RP-C205 §4.1.4 Current Velocity Profile; ISO 19901-1 Metocean Design",
    params: [
      ["surfaceSpeed", 1.2, "m/s", "Tidal current velocity at mean sea surface"],
      ["waterDepth", 300.0, "m", "Total water depth d"],
      ["powerExponent", 0.142857, "-", "Power-law exponent alpha (default 1/7)"],
      ["windDriftSpeed", 0.25, "m/s", "Wind-generated surface drift velocity"],
      ["windDriftDepth", 50.0, "m", "Reference depth z0 for wind-generated current"],
    ],
  },
];

/**
 * Converts `SIMA_MODEL_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG icons and port layouts.
 */
export function buildSimaCleanroomSchemas(): CleanroomModelSchema[] {
  return SIMA_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `sima:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "marine",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "sima_marine_model",
      width: 96,
      height: 48,
      svg: generateSimaBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
