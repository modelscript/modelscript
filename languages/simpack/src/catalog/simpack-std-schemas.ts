// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * SIMPACK cleanroom multibody element archetype IDs matching `assets/simpack-std-lib/src/models.ts`.
 */
export const SimpackArchetypeId = {
  // Force Elements
  PTP_SPRING_DAMPER: 1, // $F_PtP_SpringDamper
  CMP_BUSHING: 2, // $F_Cmp_Bushing
  CMP_BUMPSTOP: 3, // $F_Cmp_Bumpstop
  CMP_FRICTION: 4, // $F_Cmp_Friction
  CMP_HYDROMOUNT: 5, // $F_Cmp_Hydromount
  CMP_AIR_SPRING: 6, // $F_Cmp_AirSpring
  GEAR_MESH: 7, // $F_Gear_Mesh
  BEARING_ROLLER: 8, // $F_Bearing_Roller

  // Joint Types
  JOINT_REVOLUTE: 20, // $J_Revolute
  JOINT_PRISMATIC: 21, // $J_Prismatic
  JOINT_SPHERICAL: 22, // $J_Spherical
  JOINT_UNIVERSAL: 23, // $J_Universal
  JOINT_CYLINDRICAL: 24, // $J_Cylindrical
  JOINT_PLANAR: 25, // $J_Planar
  JOINT_GENERAL6DOF: 26, // $J_General6DOF
  JOINT_TRACK: 27, // $J_TrackJoint

  // Rail & Wheel-Rail Contact
  WHEELRAIL_KALKER: 40, // $R_WheelRail_Kalker
  WHEELRAIL_POLACH: 41, // $R_WheelRail_Polach
  TRACK_UIC60: 42, // $R_Track_UIC60
  WHEEL_S1002: 43, // $R_Wheel_S1002
  TRACK_IRREGULARITY: 44, // $R_Track_Irregularity

  // Automotive Tires & Controls
  TIRE_PACEJKA_MF: 60, // $T_Pacejka_MF
  TIRE_FTIRE_SIMPLE: 61, // $T_FTire_Simple
  CTRL_PID: 70, // $C_PID
  CTRL_TRANSFER_FCN: 71, // $C_TransferFcn
  CTRL_LOOKUP1D: 72, // $C_Lookup1D
} as const;

export type SimpackArchetypeId = (typeof SimpackArchetypeId)[keyof typeof SimpackArchetypeId];

export type SimpackModelCategory = "Force Element" | "Joint" | "Rail / Wheel-Rail" | "Tire" | "Control";

export interface SimpackModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: SimpackModelCategory;
  archetypeId: SimpackArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<SimpackModelCategory, { fill: string; stroke: string; badge: string }> = {
  "Force Element": { fill: "#1e3a5f", stroke: "#60a5fa", badge: "FRC" },
  Joint: { fill: "#1e3f2f", stroke: "#34d399", badge: "JNT" },
  "Rail / Wheel-Rail": { fill: "#3f2e18", stroke: "#fbbf24", badge: "RAIL" },
  Tire: { fill: "#3b2323", stroke: "#f87171", badge: "TIRE" },
  Control: { fill: "#3b1f47", stroke: "#c084fc", badge: "CTRL" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for a SIMPACK multibody element.
 */
export function generateSimpackBlockSvg(modelType: string, category: SimpackModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const shortName = modelType.replace(/^\$[A-Z]_/, "").slice(0, 11);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 48" width="96" height="48">` +
    `<rect x="2" y="2" width="92" height="44" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="28" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="20" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="48" y="34" text-anchor="middle" font-family="monospace" font-size="9" font-weight="bold" fill="#f8fafc">${shortName}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: SimpackModelCategory): DiagramPortSpec[] {
  switch (category) {
    case "Force Element":
      return [
        { name: "markerI", kind: "mechanical", side: "left", dx: 0, dy: 24 },
        { name: "markerJ", kind: "mechanical", side: "right", dx: 96, dy: 24 },
      ];
    case "Joint":
      return [
        { name: "fromMarker", kind: "mechanical", side: "left", dx: 0, dy: 24 },
        { name: "toMarker", kind: "mechanical", side: "right", dx: 96, dy: 24 },
      ];
    case "Rail / Wheel-Rail":
      return [
        { name: "wheelMarker", kind: "mechanical", side: "top", dx: 48, dy: 0 },
        { name: "railMarker", kind: "mechanical", side: "bottom", dx: 48, dy: 48 },
        { name: "creepOut", kind: "signal", side: "right", dx: 96, dy: 24 },
      ];
    case "Tire":
      return [
        { name: "hubMarker", kind: "mechanical", side: "top", dx: 48, dy: 0 },
        { name: "roadContact", kind: "mechanical", side: "bottom", dx: 48, dy: 48 },
        { name: "slipOut", kind: "signal", side: "right", dx: 96, dy: 24 },
      ];
    case "Control":
      return [
        { name: "u", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "y", kind: "signal", side: "right", dx: 96, dy: 24 },
      ];
  }
}

export const SIMPACK_MODEL_SPECS: readonly SimpackModelSpec[] = [
  // =========================================================================
  // 1. Force Elements
  // =========================================================================
  {
    modelType: "$F_PtP_SpringDamper",
    aliases: ["PtP_SpringDamper", "FE5", "SpringDamper"],
    label: "Point-to-Point Spring-Damper",
    category: "Force Element",
    archetypeId: SimpackArchetypeId.PTP_SPRING_DAMPER,
    description: "Uniaxial point-to-point linear/cubic spring and viscous damper force element with preload.",
    provenance: "Classical Kelvin-Voigt viscoelastic element; Shabana, Dynamics of Multibody Systems (4th ed.)",
    params: [
      ["k", 25000.0, "N/m", "Linear stiffness"],
      ["c", 1500.0, "N*s/m", "Viscous damping coefficient"],
      ["l0", 0.0, "m", "Undeformed free length"],
      ["f0", 0.0, "N", "Static preload force"],
      ["k3", 0.0, "N/m^3", "Cubic progressive stiffness"],
    ],
  },
  {
    modelType: "$F_Cmp_Bushing",
    aliases: ["Cmp_Bushing", "FE43", "Bushing6DOF"],
    label: "6-DOF Elastomer Bushing",
    category: "Force Element",
    archetypeId: SimpackArchetypeId.CMP_BUSHING,
    description:
      "Six-degree-of-freedom translational and rotational elastomer bushing with Berg hysteresis parameters.",
    provenance:
      "Berg, M. (1998), A non-linear rubber spring model for rail vehicle dynamics analysis, Vehicle System Dynamics 30(3-4)",
    params: [
      ["kx", 1.5e6, "N/m", "Longitudinal stiffness"],
      ["ky", 1.5e6, "N/m", "Lateral stiffness"],
      ["kz", 3.0e6, "N/m", "Vertical stiffness"],
      ["cx", 2500.0, "N*s/m", "Longitudinal viscous damping"],
      ["cy", 2500.0, "N*s/m", "Lateral viscous damping"],
      ["cz", 4000.0, "N*s/m", "Vertical viscous damping"],
      ["fMaxHyst", 1200.0, "N", "Berg friction hysteresis saturation force"],
      ["x2Hyst", 0.002, "m", "Berg half-saturation displacement"],
    ],
  },
  {
    modelType: "$F_Cmp_Bumpstop",
    aliases: ["Cmp_Bumpstop", "FE18", "Bumpstop"],
    label: "Nonlinear Progressive Bumpstop",
    category: "Force Element",
    archetypeId: SimpackArchetypeId.CMP_BUMPSTOP,
    description:
      "Unilateral clearance-gap rubber bumpstop with progressive power-law stiffness and asymmetric damping.",
    provenance: "ISO 2631 / UIC 518 secondary suspension lateral/vertical progressive end-stop formulation",
    params: [
      ["clearance", 0.03, "m", "Free travel clearance gap before contact"],
      ["kLin", 5.0e4, "N/m", "Initial contact linear stiffness"],
      ["kExp", 2.5e7, "N/m^n", "Progressive nonlinear stiffness coefficient"],
      ["expN", 2.5, "-", "Power-law stiffening exponent"],
      ["c", 3000.0, "N*s/m", "Contact compression damping"],
    ],
  },
  {
    modelType: "$F_Cmp_Friction",
    aliases: ["Cmp_Friction", "FE19", "StribeckFriction"],
    label: "Stribeck Dry Friction Element",
    category: "Force Element",
    archetypeId: SimpackArchetypeId.CMP_FRICTION,
    description: "Smooth Stribeck dry friction model combining static breakaway, Coulomb sliding, and viscous damping.",
    provenance:
      "Armstrong-Helouvry, Dupont & Canudas de Wit (1994), Automatica 30(7): A Survey of Models, Analysis Tools and Compensation Methods for the Control of Machines with Friction",
    params: [
      ["muS", 0.35, "-", "Static friction coefficient"],
      ["muK", 0.25, "-", "Kinetic (Coulomb) friction coefficient"],
      ["vStribeck", 0.05, "m/s", "Stribeck characteristic velocity"],
      ["cVisc", 50.0, "N*s/m", "Viscous friction coefficient"],
      ["vEps", 0.005, "m/s", "Hyperbolic tangent smoothing velocity"],
    ],
  },
  {
    modelType: "$F_Cmp_Hydromount",
    aliases: ["Cmp_Hydromount", "FE45", "Hydromount"],
    label: "Hydraulic Engine / Cab Mount",
    category: "Force Element",
    archetypeId: SimpackArchetypeId.CMP_HYDROMOUNT,
    description:
      "Frequency-dependent lumped-parameter hydraulic mount with rubber main spring and inertia track fluid column.",
    provenance:
      "Flower, W. C. (1985), SAE Technical Paper 850975: Understanding Hydraulic Mounts for Improved Vehicle Noise, Vibration and Ride Qualities",
    params: [
      ["kMain", 1.8e5, "N/m", "Main elastomer stiffness"],
      ["cMain", 450.0, "N*s/m", "Main elastomer damping"],
      ["kBulge", 4.5e5, "N/m", "Upper chamber volumetric bulge stiffness"],
      ["mFluid", 12.0, "kg", "Effective inertia track fluid mass"],
      ["cTrack", 600.0, "N*s/m", "Inertia track flow resistance damping"],
    ],
  },
  {
    modelType: "$F_Cmp_AirSpring",
    aliases: ["Cmp_AirSpring", "FE84", "AirSpring"],
    label: "Polytropic Pneumatic Air Spring",
    category: "Force Element",
    archetypeId: SimpackArchetypeId.CMP_AIR_SPRING,
    description:
      "Thermodynamic polytropic pneumatic air spring with effective piston area, gas volume, and orifice damping.",
    provenance:
      "Berg, M. (1999), A Three-Dimensional Airspring Model with Friction and Orifice Damping, Vehicle System Dynamics 33(sup1); UIC 518",
    params: [
      ["p0", 4.5e5, "Pa", "Nominal gauge pressure"],
      ["pAtm", 1.01325e5, "Pa", "Ambient atmospheric pressure"],
      ["area", 0.2, "m^2", "Effective pneumatic piston area"],
      ["vol0", 0.04, "m^3", "Nominal air + reservoir volume"],
      ["gamma", 1.38, "-", "Polytropic gas exponent (1.0 isothermal .. 1.4 adiabatic)"],
      ["cOrifice", 8000.0, "N*s/m", "Surge-pipe orifice damping coefficient"],
    ],
  },
  {
    modelType: "$F_Gear_Mesh",
    aliases: ["Gear_Mesh", "FE225", "GearPair"],
    label: "Involute Gear Pair Mesh",
    category: "Force Element",
    archetypeId: SimpackArchetypeId.GEAR_MESH,
    description: "Involute spur/helical gear tooth mesh compliance with backlash deadzone and viscous mesh damping.",
    provenance:
      "ISO 6336-1:2019 Calculation of load capacity of spur and helical gears — Basic principles and mesh stiffness",
    params: [
      ["kMesh", 2.5e8, "N/m", "Mean gear tooth mesh stiffness"],
      ["cMesh", 1.5e4, "N*s/m", "Gear mesh viscous damping"],
      ["backlash", 1.0e-4, "m", "Half-backlash clearance along line of action"],
      ["rBase", 0.08, "m", "Base circle radius for torque arm"],
    ],
  },
  {
    modelType: "$F_Bearing_Roller",
    aliases: ["Bearing_Roller", "FE88", "RollerBearing"],
    label: "Hertzian Rolling-Element Bearing",
    category: "Force Element",
    archetypeId: SimpackArchetypeId.BEARING_ROLLER,
    description: "Nonlinear Hertzian load-deflection rolling bearing force element with radial internal clearance.",
    provenance: "Harris, T. A. & Kotzalas, M. N. (2006), Rolling Bearing Analysis (5th ed.); ISO 281",
    params: [
      ["kHertz", 1.2e10, "N/m^1.5", "Hertzian contact stiffness coefficient"],
      ["clearance", 2.0e-5, "m", "Radial internal clearance"],
      ["cDamp", 2500.0, "N*s/m", "Lubricant film viscous damping"],
      ["expN", 1.5, "-", "Contact load-deflection exponent (1.5 ball, 1.11 roller)"],
    ],
  },

  // =========================================================================
  // 2. Joint Types
  // =========================================================================
  {
    modelType: "$J_Revolute",
    aliases: ["Revolute", "Joint2", "RevJoint"],
    label: "Revolute Joint (1-DOF)",
    category: "Joint",
    archetypeId: SimpackArchetypeId.JOINT_REVOLUTE,
    description: "Single-axis rotational joint constraining 3 translations and 2 rotations.",
    provenance: "Haug, E. J. (1989), Computer-Aided Kinematics and Dynamics of Mechanical Systems; Baumgarte (1972)",
    params: [
      ["kPen", 1.0e8, "N/m", "Constraint stabilization penalty stiffness"],
      ["cPen", 1.0e5, "N*s/m", "Constraint stabilization penalty damping"],
      ["alpha", 10.0, "1/s", "Baumgarte position stabilization parameter"],
      ["beta", 20.0, "1/s", "Baumgarte velocity stabilization parameter"],
    ],
  },
  {
    modelType: "$J_Prismatic",
    aliases: ["Prismatic", "Joint1", "TransJoint"],
    label: "Prismatic Joint (1-DOF)",
    category: "Joint",
    archetypeId: SimpackArchetypeId.JOINT_PRISMATIC,
    description: "Single-axis translational sliding joint constraining 2 transverse translations and 3 rotations.",
    provenance: "Haug, E. J. (1989), Computer-Aided Kinematics and Dynamics of Mechanical Systems; Baumgarte (1972)",
    params: [
      ["kPen", 1.0e8, "N/m", "Constraint stabilization penalty stiffness"],
      ["cPen", 1.0e5, "N*s/m", "Constraint stabilization penalty damping"],
      ["alpha", 10.0, "1/s", "Baumgarte position stabilization parameter"],
      ["beta", 20.0, "1/s", "Baumgarte velocity stabilization parameter"],
    ],
  },
  {
    modelType: "$J_Spherical",
    aliases: ["Spherical", "Joint5", "BallJoint"],
    label: "Spherical / Ball Joint (3-DOF)",
    category: "Joint",
    archetypeId: SimpackArchetypeId.JOINT_SPHERICAL,
    description: "Three-DOF rotational ball-and-socket joint constraining all 3 relative translations.",
    provenance: "Haug, E. J. (1989), Computer-Aided Kinematics and Dynamics of Mechanical Systems",
    params: [
      ["kPen", 1.0e8, "N/m", "Translational constraint penalty stiffness"],
      ["cPen", 1.0e5, "N*s/m", "Translational constraint penalty damping"],
      ["alpha", 10.0, "1/s", "Baumgarte position stabilization parameter"],
      ["beta", 20.0, "1/s", "Baumgarte velocity stabilization parameter"],
    ],
  },
  {
    modelType: "$J_Universal",
    aliases: ["Universal", "Joint3", "HookeJoint", "CardanJoint"],
    label: "Universal / Cardan Joint (2-DOF)",
    category: "Joint",
    archetypeId: SimpackArchetypeId.JOINT_UNIVERSAL,
    description: "Two-DOF orthogonal-axis universal (Hooke/Cardan) joint constraining 3 translations and 1 axial spin.",
    provenance: "Shabana, A. A. (2013), Dynamics of Multibody Systems (4th ed.)",
    params: [
      ["kPen", 1.0e8, "N/m", "Constraint penalty stiffness"],
      ["cPen", 1.0e5, "N*s/m", "Constraint penalty damping"],
      ["alpha", 10.0, "1/s", "Baumgarte position stabilization parameter"],
      ["beta", 20.0, "1/s", "Baumgarte velocity stabilization parameter"],
    ],
  },
  {
    modelType: "$J_Cylindrical",
    aliases: ["Cylindrical", "Joint4", "CylJoint"],
    label: "Cylindrical Joint (2-DOF)",
    category: "Joint",
    archetypeId: SimpackArchetypeId.JOINT_CYLINDRICAL,
    description: "Two-DOF joint permitting coaxial translation and rotation while constraining 4 orthogonal DOFs.",
    provenance: "Haug, E. J. (1989), Computer-Aided Kinematics and Dynamics of Mechanical Systems",
    params: [
      ["kPen", 1.0e8, "N/m", "Constraint penalty stiffness"],
      ["cPen", 1.0e5, "N*s/m", "Constraint penalty damping"],
      ["alpha", 10.0, "1/s", "Baumgarte position stabilization parameter"],
      ["beta", 20.0, "1/s", "Baumgarte velocity stabilization parameter"],
    ],
  },
  {
    modelType: "$J_Planar",
    aliases: ["Planar", "Joint6", "PlanarJoint"],
    label: "Planar Joint (3-DOF)",
    category: "Joint",
    archetypeId: SimpackArchetypeId.JOINT_PLANAR,
    description: "Three-DOF planar motion joint permitting 2 in-plane translations and 1 normal rotation.",
    provenance: "Shabana, A. A. (2013), Dynamics of Multibody Systems (4th ed.)",
    params: [
      ["kPen", 1.0e8, "N/m", "Out-of-plane constraint penalty stiffness"],
      ["cPen", 1.0e5, "N*s/m", "Out-of-plane constraint penalty damping"],
      ["alpha", 10.0, "1/s", "Baumgarte position stabilization parameter"],
      ["beta", 20.0, "1/s", "Baumgarte velocity stabilization parameter"],
    ],
  },
  {
    modelType: "$J_General6DOF",
    aliases: ["General6DOF", "Joint7", "FreeJoint"],
    label: "General 6-DOF Floating Joint",
    category: "Joint",
    archetypeId: SimpackArchetypeId.JOINT_GENERAL6DOF,
    description: "Unconstrained 6-DOF free-body relative coordinate joint (3 translations + 3 Cardan/Euler angles).",
    provenance: "Featherstone, R. (2008), Rigid Body Dynamics Algorithms",
    params: [
      ["kPen", 0.0, "N/m", "Optional soft tether stiffness"],
      ["cPen", 0.0, "N*s/m", "Optional soft tether damping"],
    ],
  },
  {
    modelType: "$J_TrackJoint",
    aliases: ["TrackJoint", "Joint9", "RailTrackJoint"],
    label: "Railway Curvilinear Track Joint",
    category: "Joint",
    archetypeId: SimpackArchetypeId.JOINT_TRACK,
    description:
      "6-DOF railway track-following joint parameterized by arc length s, curvature, cant (superelevation), and grade.",
    provenance:
      "UIC 518 / EN 14363 Testing and approval of railway vehicles; Shabana et al. (2008) Railroad Vehicle Dynamics",
    params: [
      ["gauge", 1.435, "m", "Standard track gauge"],
      ["cant", 0.0, "m", "Track superelevation (cant)"],
      ["curveRadius", 1.0e6, "m", "Horizontal curve radius"],
      ["grade", 0.0, "-", "Longitudinal track gradient"],
    ],
  },

  // =========================================================================
  // 3. Rail & Wheel-Rail Contact
  // =========================================================================
  {
    modelType: "$R_WheelRail_Kalker",
    aliases: ["WheelRail_Kalker", "FASTSIM", "KalkerContact"],
    label: "Kalker Wheel-Rail Creep Contact",
    category: "Rail / Wheel-Rail",
    archetypeId: SimpackArchetypeId.WHEELRAIL_KALKER,
    description:
      "Kalker linear creepage theory with Vermeulen-Johnson / Coulomb tangential saturation for Hertzian wheel-rail patches.",
    provenance:
      "Kalker, J. J. (1967, 1982, 1990), Three-Dimensional Elastic Bodies in Rolling Contact, Kluwer Academic Publishers",
    params: [
      ["mu", 0.35, "-", "Coulomb wheel-rail friction coefficient"],
      ["a", 0.006, "m", "Hertzian contact ellipse longitudinal semi-axis"],
      ["b", 0.0045, "m", "Hertzian contact ellipse lateral semi-axis"],
      ["G", 8.1e10, "Pa", "Combined steel shear modulus"],
      ["c11", 4.12, "-", "Kalker longitudinal creepage coefficient C11"],
      ["c22", 3.67, "-", "Kalker lateral creepage coefficient C22"],
      ["c23", 1.47, "-", "Kalker lateral-spin creepage coefficient C23"],
      ["c33", 1.19, "-", "Kalker spin creepage coefficient C33"],
    ],
  },
  {
    modelType: "$R_WheelRail_Polach",
    aliases: ["WheelRail_Polach", "PolachContact", "Polach"],
    label: "Polach Nonlinear Wheel-Rail Contact",
    category: "Rail / Wheel-Rail",
    archetypeId: SimpackArchetypeId.WHEELRAIL_POLACH,
    description:
      "Polach fast nonlinear wheel-rail creep force law with variable slip-dependent falling friction for traction and curving.",
    provenance:
      "Polach, O. (1999), Vehicle System Dynamics 33(sup1):728-739; Polach, O. (2005), Wear 258(7-8):992-1000",
    params: [
      ["mu0", 0.4, "-", "Maximum static friction coefficient at zero slip"],
      ["A", 0.4, "-", "Ratio of limit friction at infinity to maximum friction"],
      ["B", 0.6, "s/m", "Exponential friction decay coefficient"],
      ["kA", 1.0, "-", "Reduction factor in adhesion area"],
      ["kS", 0.4, "-", "Reduction factor in slip area"],
      ["a", 0.0065, "m", "Hertzian contact patch longitudinal semi-axis"],
      ["b", 0.0045, "m", "Hertzian contact patch lateral semi-axis"],
      ["G", 8.1e10, "Pa", "Combined steel shear modulus"],
      ["c11", 4.12, "-", "Kalker longitudinal coefficient C11"],
      ["c22", 3.67, "-", "Kalker lateral coefficient C22"],
    ],
  },
  {
    modelType: "$R_Track_UIC60",
    aliases: ["Track_UIC60", "60E1", "UIC60"],
    label: "UIC 60 (60E1) Rail Profile",
    category: "Rail / Wheel-Rail",
    archetypeId: SimpackArchetypeId.TRACK_UIC60,
    description:
      "Standard European UIC 60 / 60E1 rail head profile geometry (R300/R80/R13 crown arcs) with rail inclination.",
    provenance: "EN 13674-1:2011+A1:2017 Railway applications — Track — Rail (Profile 60E1 / UIC 60)",
    params: [
      ["crownRadius", 0.3, "m", "Primary rail crown radius R300"],
      ["shoulderRadius", 0.08, "m", "Rail shoulder radius R80"],
      ["gaugeCornerRadius", 0.013, "m", "Gauge corner radius R13"],
      ["inclination", 0.025, "rad", "Rail cant / inclination (1:40 = 0.025 rad)"],
      ["headWidth", 0.072, "m", "Nominal rail head width"],
    ],
  },
  {
    modelType: "$R_Wheel_S1002",
    aliases: ["Wheel_S1002", "S1002", "ORE_S1002"],
    label: "ORE S1002 Railway Wheel Profile",
    category: "Rail / Wheel-Rail",
    archetypeId: SimpackArchetypeId.WHEEL_S1002,
    description:
      "Standard ORE S1002 wear-adapted railway wheel tread and 70-degree flange profile with equivalent conicity.",
    provenance: "EN 13715:2020 Railway applications — Wheelsets and bogies — Wheels — Tread profile S1002; UIC 510-2",
    params: [
      ["nominalRadius", 0.46, "m", "Nominal wheel rolling radius"],
      ["equivConicity", 0.12, "-", "Nominal equivalent conicity lambda_e on UIC60 1:40"],
      ["flangeClearance", 0.007, "m", "Nominal lateral flangeway clearance"],
      ["flangeAngleDeg", 70.0, "deg", "Maximum flange face angle"],
      ["wheelWidth", 0.135, "m", "Nominal wheel rim width"],
    ],
  },
  {
    modelType: "$R_Track_Irregularity",
    aliases: ["Track_Irregularity", "ERRI_B176", "TrackPSD"],
    label: "ERRI B176 Track Irregularity PSD",
    category: "Rail / Wheel-Rail",
    archetypeId: SimpackArchetypeId.TRACK_IRREGULARITY,
    description:
      "Analytic spatial track alignment, vertical longitudinal level, and cross-level irregularity realization from ERRI B176 PSD.",
    provenance: "ERRI B176 / ORE B176 RP1 (1989) & UIC 518 / EN 14363 standard track irregularity spectral densities",
    params: [
      ["av", 4.032e-7, "m*rad", "Vertical roughness constant Av (low-level quality)"],
      ["aa", 2.119e-7, "m*rad", "Alignment roughness constant Aa"],
      ["omegaC", 0.8246, "rad/m", "Upper break spatial frequency"],
      ["omegaR", 0.0206, "rad/m", "Lower break spatial frequency"],
      ["ampScale", 1.0, "-", "Overall irregularity amplitude scaling factor"],
    ],
  },

  // =========================================================================
  // 4. Automotive Tires & Controls
  // =========================================================================
  {
    modelType: "$T_Pacejka_MF",
    aliases: ["Pacejka_MF", "MF52", "MF61", "MagicFormula"],
    label: "Pacejka Magic Formula Tire",
    category: "Tire",
    archetypeId: SimpackArchetypeId.TIRE_PACEJKA_MF,
    description:
      "Pacejka Magic Formula 5.2/6.1 combined-slip longitudinal, lateral, and self-aligning pneumatic tire force model.",
    provenance: "Pacejka, H. B. (2012), Tire and Vehicle Dynamics (3rd ed.), Butterworth-Heinemann",
    params: [
      ["Bx", 10.0, "-", "Longitudinal stiffness factor B_x"],
      ["Cx", 1.65, "-", "Longitudinal shape factor C_x"],
      ["Dx", 1.05, "-", "Longitudinal peak friction factor D_x"],
      ["Ex", 0.97, "-", "Longitudinal curvature factor E_x"],
      ["By", 8.5, "-", "Lateral stiffness factor B_y"],
      ["Cy", 1.3, "-", "Lateral shape factor C_y"],
      ["Dy", 1.0, "-", "Lateral peak friction factor D_y"],
      ["Ey", -1.6, "-", "Lateral curvature factor E_y"],
      ["fzNom", 4000.0, "N", "Nominal vertical tire load"],
      ["rEff", 0.315, "m", "Effective rolling radius"],
    ],
  },
  {
    modelType: "$T_FTire_Simple",
    aliases: ["FTire_Simple", "FTire", "FlexRingTire"],
    label: "Flexible-Ring Tire (Simplified FTire)",
    category: "Tire",
    archetypeId: SimpackArchetypeId.TIRE_FTIRE_SIMPLE,
    description:
      "Simplified flexible-belt tire model with vertical sidewall stiffness/damping and brush-model tangential contact.",
    provenance:
      "Gipser, M. (2007), FTire — the tire simulation model for all applications related to vehicle dynamics, Vehicle System Dynamics 45(sup1)",
    params: [
      ["kVert", 2.2e5, "N/m", "Vertical radial tire stiffness"],
      ["cVert", 150.0, "N*s/m", "Vertical radial tire damping"],
      ["rUnloaded", 0.32, "m", "Unloaded tire outer radius"],
      ["muPeak", 1.0, "-", "Peak road-tire friction coefficient"],
      ["cSlip", 6.5e4, "N/rad", "Effective brush cornering/slip stiffness"],
    ],
  },
  {
    modelType: "$C_PID",
    aliases: ["PID", "Ctrl_PID", "PIDController"],
    label: "PID Control Element",
    category: "Control",
    archetypeId: SimpackArchetypeId.CTRL_PID,
    description: "Continuous-time proportional-integral-derivative controller with output saturation and anti-windup.",
    provenance: "Astrom, K. J. & Hagglund, T. (2006), Advanced PID Control, ISA",
    params: [
      ["kp", 10.0, "-", "Proportional gain"],
      ["ki", 2.0, "1/s", "Integral gain"],
      ["kd", 0.5, "s", "Derivative gain"],
      ["uMin", -1.0e6, "-", "Lower output saturation limit"],
      ["uMax", 1.0e6, "-", "Upper output saturation limit"],
    ],
  },
  {
    modelType: "$C_TransferFcn",
    aliases: ["TransferFcn", "Ctrl_TF", "FirstOrderLag"],
    label: "Linear Transfer Function",
    category: "Control",
    archetypeId: SimpackArchetypeId.CTRL_TRANSFER_FCN,
    description: "SISO first-order linear time-invariant transfer function block G(s) = K / (tau*s + 1).",
    provenance: "Ogata, K. (2010), Modern Control Engineering (5th ed.)",
    params: [
      ["gain", 1.0, "-", "DC steady-state gain K"],
      ["tau", 0.1, "s", "Lag time constant tau"],
      ["y0", 0.0, "-", "Initial state output"],
    ],
  },
  {
    modelType: "$C_Lookup1D",
    aliases: ["Lookup1D", "Ctrl_Lookup1D", "InputFunction1D"],
    label: "1D Piecewise-Linear Lookup Table",
    category: "Control",
    archetypeId: SimpackArchetypeId.CTRL_LOOKUP1D,
    description:
      "1D clamped piecewise-linear lookup table mapping input u to output y across up to 5 knot pairs (x_i, y_i).",
    provenance: "Standard piecewise-linear spline interpolation; ISO/IEC 10967 numerical arithmetic",
    params: [
      ["x0", -1.0, "-", "Knot 0 abscissa"],
      ["y0", -1.0, "-", "Knot 0 ordinate"],
      ["x1", 0.0, "-", "Knot 1 abscissa"],
      ["y1", 0.0, "-", "Knot 1 ordinate"],
      ["x2", 1.0, "-", "Knot 2 abscissa"],
      ["y2", 1.0, "-", "Knot 2 ordinate"],
    ],
  },
];

/**
 * Converts `SIMPACK_MODEL_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG icons and port layouts.
 */
export function buildSimpackCleanroomSchemas(): CleanroomModelSchema[] {
  return SIMPACK_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `simpack:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "mechanical",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "simpack_element",
      width: 96,
      height: 48,
      svg: generateSimpackBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
