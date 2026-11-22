// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * MSC Adams cleanroom standard library archetype IDs matching `assets/adams-std-lib/src/models.ts`.
 */
export const AdamsArchetypeId = {
  // Runtime Functions (1..19)
  FUNC_STEP: 1,
  FUNC_STEP5: 2,
  FUNC_IMPACT: 3,
  FUNC_BISTOP: 4,
  FUNC_AKISPL: 5,
  FUNC_CUBSPL: 6,
  FUNC_HAVSIN: 7,
  FUNC_SHF: 8,
  FUNC_MEASURE_DISP: 9,
  FUNC_MEASURE_VEL: 10,

  // Joints & Constraints (20..39)
  JOINT_REVOLUTE: 20,
  JOINT_TRANSLATIONAL: 21,
  JOINT_SPHERICAL: 22,
  JOINT_UNIVERSAL: 23,
  JOINT_CYLINDRICAL: 24,
  JOINT_FIXED: 25,
  JOINT_PLANAR: 26,
  JOINT_CV: 27,
  JOINT_HOOKE: 28,
  JOINT_POINT_CURVE: 29,
  CONSTRAINT_MOTION: 30,

  // Forces & Bushings (40..59)
  FORCE_SPRING_DAMPER: 40,
  FORCE_BUSHING: 41,
  FORCE_BEAM: 42,
  FORCE_FIELD: 43,
  FORCE_SFORCE: 44,
  FORCE_VFORCE: 45,
  FORCE_GFORCE: 46,
  FORCE_CONTACT_3D: 47,

  // Tires & Automotive (60..79)
  TIRE_PAC2002: 60,
  TIRE_FIALA: 61,
  TIRE_UA: 62,
  ROAD_FLAT: 63,
  ROAD_CLEAT: 64,
} as const;

export type AdamsArchetypeId = (typeof AdamsArchetypeId)[keyof typeof AdamsArchetypeId];

export interface AdamsModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: "Runtime Function" | "Joint / Constraint" | "Force / Bushing" | "Tire / Road";
  archetypeId: AdamsArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<AdamsModelSpec["category"], { fill: string; stroke: string; badge: string }> = {
  "Runtime Function": { fill: "#1e3a5f", stroke: "#60a5fa", badge: "FNC" },
  "Joint / Constraint": { fill: "#1e3f2f", stroke: "#34d399", badge: "JNT" },
  "Force / Bushing": { fill: "#3f2e18", stroke: "#fbbf24", badge: "FRC" },
  "Tire / Road": { fill: "#3b1f47", stroke: "#c084fc", badge: "TIR" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for an MSC Adams element or runtime function.
 */
export function generateAdamsBlockSvg(modelType: string, category: AdamsModelSpec["category"]): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 10);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 48" width="88" height="48">` +
    `<rect x="2" y="2" width="84" height="44" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="24" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="18" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="34" text-anchor="middle" font-family="monospace" font-size="9.5" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: AdamsModelSpec["category"]): DiagramPortSpec[] {
  switch (category) {
    case "Runtime Function":
      return [
        { name: "x", kind: "signal", side: "left", dx: 0, dy: 14 },
        { name: "xdot", kind: "signal", side: "left", dx: 0, dy: 34 },
        { name: "out", kind: "signal", side: "right", dx: 88, dy: 24 },
      ];
    case "Joint / Constraint":
      return [
        { name: "i_marker", kind: "mechanical", side: "left", dx: 0, dy: 24 },
        { name: "j_marker", kind: "mechanical", side: "right", dx: 88, dy: 24 },
      ];
    case "Force / Bushing":
      return [
        { name: "i_marker", kind: "mechanical", side: "left", dx: 0, dy: 24 },
        { name: "j_marker", kind: "mechanical", side: "right", dx: 88, dy: 24 },
        { name: "ctrl", kind: "signal", side: "top", dx: 44, dy: 0 },
      ];
    case "Tire / Road":
      return [
        { name: "wheel_hub", kind: "mechanical", side: "top", dx: 44, dy: 0 },
        { name: "road_patch", kind: "mechanical", side: "bottom", dx: 44, dy: 48 },
        { name: "slip_in", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "wrench_out", kind: "signal", side: "right", dx: 88, dy: 24 },
      ];
  }
}

const STEP_PARAMS: AdamsModelSpec["params"] = [
  ["x0", 0.0, "1", "Start of transition interval"],
  ["h0", 0.0, "1", "Initial value for x <= x0"],
  ["x1", 1.0, "1", "End of transition interval"],
  ["h1", 1.0, "1", "Final value for x >= x1"],
];

const IMPACT_PARAMS: AdamsModelSpec["params"] = [
  ["x1", 0.0, "m", "Contact trigger threshold distance"],
  ["k", 1.0e5, "N/m^e", "Hertzian contact stiffness coefficient"],
  ["e", 1.5, "1", "Force-penetration exponent (1.5 for Hertzian spheres)"],
  ["cmax", 100.0, "N*s/m", "Maximum viscous damping coefficient"],
  ["d", 1.0e-3, "m", "Penetration depth at which full damping cmax is reached"],
];

const BISTOP_PARAMS: AdamsModelSpec["params"] = [
  ["x1", -0.05, "m", "Lower gap stop boundary"],
  ["x2", 0.05, "m", "Upper gap stop boundary"],
  ["k", 1.0e5, "N/m^e", "Stop contact stiffness"],
  ["e", 1.5, "1", "Force-penetration exponent"],
  ["cmax", 100.0, "N*s/m", "Maximum stop damping coefficient"],
  ["d", 1.0e-3, "m", "Full damping penetration depth"],
];

const SPLINE_PARAMS: AdamsModelSpec["params"] = [
  ["x0", 0.0, "1", "First knot abscissa"],
  ["y0", 0.0, "1", "First knot ordinate"],
  ["x1", 1.0, "1", "Second knot abscissa"],
  ["y1", 1.0, "1", "Second knot ordinate"],
  ["x2", 2.0, "1", "Third knot abscissa"],
  ["y2", 1.5, "1", "Third knot ordinate"],
  ["order", 0.0, "1", "Derivative order (0=value, 1=first derivative, 2=second derivative)"],
];

const JOINT_BASIC_PARAMS: AdamsModelSpec["params"] = [
  ["dof", 1.0, "1", "Number of unconstrained relative degrees of freedom"],
  ["penalty_k", 1.0e7, "N/m", "Baumgarte / penalty constraint stiffness"],
  ["penalty_c", 1.0e3, "N*s/m", "Baumgarte / penalty constraint damping"],
];

const BUSHING_PARAMS: AdamsModelSpec["params"] = [
  ["kx", 1.0e5, "N/m", "Translational stiffness along X"],
  ["ky", 1.0e5, "N/m", "Translational stiffness along Y"],
  ["kz", 1.0e5, "N/m", "Translational stiffness along Z"],
  ["krx", 1.0e3, "N*m/rad", "Rotational stiffness about X"],
  ["kry", 1.0e3, "N*m/rad", "Rotational stiffness about Y"],
  ["krz", 1.0e3, "N*m/rad", "Rotational stiffness about Z"],
  ["cx", 500.0, "N*s/m", "Translational damping along X"],
  ["cy", 500.0, "N*s/m", "Translational damping along Y"],
  ["cz", 500.0, "N*s/m", "Translational damping along Z"],
  ["crx", 10.0, "N*m*s/rad", "Rotational damping about X"],
  ["cry", 10.0, "N*m*s/rad", "Rotational damping about Y"],
  ["crz", 10.0, "N*m*s/rad", "Rotational damping about Z"],
];

const PAC2002_PARAMS: AdamsModelSpec["params"] = [
  ["Bx", 10.0, "1", "Longitudinal stiffness factor B_x"],
  ["Cx", 1.65, "1", "Longitudinal shape factor C_x"],
  ["Dx", 1.0, "1", "Longitudinal peak friction coefficient mu_x (D_x = mu_x * Fz)"],
  ["Ex", 0.1, "1", "Longitudinal curvature factor E_x"],
  ["By", 8.5, "1/rad", "Lateral stiffness factor B_y"],
  ["Cy", 1.3, "1", "Lateral shape factor C_y"],
  ["Dy", 0.95, "1", "Lateral peak friction coefficient mu_y (D_y = mu_y * Fz)"],
  ["Ey", -0.5, "1", "Lateral curvature factor E_y"],
  ["fz0", 4000.0, "N", "Nominal vertical tire load F_z0"],
  ["trail", 0.03, "m", "Nominal pneumatic trail t_p0 for aligning torque M_z"],
  ["rBx1", 12.0, "1", "Combined-slip longitudinal weighting slope factor B_xalpha"],
  ["rCx1", 1.0, "1", "Combined-slip longitudinal weighting shape factor C_xalpha"],
  ["rBy1", 10.0, "1", "Combined-slip lateral weighting slope factor B_ykappa"],
  ["rCy1", 1.0, "1", "Combined-slip lateral weighting shape factor C_ykappa"],
  ["kGamma", 0.08, "1", "Camber thrust equivalent slip stiffness factor"],
  ["Bt", 10.0, "1/rad", "Pneumatic trail stiffness factor B_t"],
  ["Ct", 1.0, "1", "Pneumatic trail shape factor C_t"],
  ["Et", -0.5, "1", "Pneumatic trail curvature factor E_t"],
];

/**
 * Cleanroom catalog of MSC Adams / Solver built-in runtime functions, kinematic joints,
 * compliance/force elements, and Pacejka/Fiala/UA tire & road templates.
 */
export const ADAMS_MODEL_SPECS: AdamsModelSpec[] = [
  // =========================================================================
  // 1. Runtime Functions (16)
  // =========================================================================
  {
    modelType: "STEP",
    aliases: ["step"],
    label: "Cubic Hermite Step Function",
    category: "Runtime Function",
    archetypeId: AdamsArchetypeId.FUNC_STEP,
    description: "C1-continuous cubic Hermite polynomial transition from h0 at x0 to h1 at x1.",
    provenance: "Shabana, Dynamics of Multibody Systems (5th ed.); Cubic Hermite Interpolation",
    params: STEP_PARAMS,
  },
  {
    modelType: "STEP5",
    aliases: ["step5"],
    label: "Quintic Step Function",
    category: "Runtime Function",
    archetypeId: AdamsArchetypeId.FUNC_STEP5,
    description: "C2-continuous quintic polynomial transition with zero first and second derivatives at endpoints.",
    provenance: "Shabana, Dynamics of Multibody Systems (5th ed.); Quintic Minimum-Jerk Interpolation",
    params: STEP_PARAMS,
  },
  {
    modelType: "IMPACT",
    aliases: ["impact"],
    label: "Hertzian Impact Contact Force",
    category: "Runtime Function",
    archetypeId: AdamsArchetypeId.FUNC_IMPACT,
    description: "Unilateral nonlinear Hertzian spring-damper contact force with cubic-step damping ramp.",
    provenance: "Hunt & Crossley (1975) ASME J. Appl. Mech.; Flores & Lankarani, Contact Force Models",
    params: IMPACT_PARAMS,
  },
  {
    modelType: "BISTOP",
    aliases: ["bistop"],
    label: "Bilateral Gap Stop Force",
    category: "Runtime Function",
    archetypeId: AdamsArchetypeId.FUNC_BISTOP,
    description: "Two-sided clearance gap contact force engaging Hertzian IMPACT stops below x1 and above x2.",
    provenance: "Flores & Lankarani, Contact Force Models for Multibody Dynamics (Springer, 2016)",
    params: BISTOP_PARAMS,
  },
  {
    modelType: "AKISPL",
    aliases: ["akispl"],
    label: "Akima Cubic Spline Interpolation",
    category: "Runtime Function",
    archetypeId: AdamsArchetypeId.FUNC_AKISPL,
    description: "Shape-preserving local Akima cubic spline interpolation minimizing overshoot.",
    provenance: "Akima (1970) J. ACM 17(4):589-602, A New Method of Interpolation and Smooth Curve Fitting",
    params: SPLINE_PARAMS,
  },
  {
    modelType: "CUBSPL",
    aliases: ["cubspl"],
    label: "Natural Cubic Spline Interpolation",
    category: "Runtime Function",
    archetypeId: AdamsArchetypeId.FUNC_CUBSPL,
    description: "C2-continuous piecewise cubic spline interpolation over tabulated data points.",
    provenance: "de Boor, A Practical Guide to Splines (Springer, 2001)",
    params: SPLINE_PARAMS,
  },
  {
    modelType: "HAVSIN",
    aliases: ["havsin"],
    label: "Haversine Smooth Step Function",
    category: "Runtime Function",
    archetypeId: AdamsArchetypeId.FUNC_HAVSIN,
    description: "Smooth raised-cosine (haversine) transition from h0 at x0 to h1 at x1.",
    provenance: "Standard Trigonometric Haversine Transition; Shabana, Multibody Systems",
    params: STEP_PARAMS,
  },
  {
    modelType: "SHF",
    aliases: ["shf"],
    label: "Simple Harmonic Function",
    category: "Runtime Function",
    archetypeId: AdamsArchetypeId.FUNC_SHF,
    description: "Sinusoidal excitation a * sin(omega * (x - x0) - phi) + b.",
    provenance: "Meirovitch, Fundamentals of Vibrations (McGraw-Hill, 2001)",
    params: [
      ["x0", 0.0, "s", "Independent variable shift"],
      ["a", 1.0, "1", "Amplitude"],
      ["omega", 6.283185307179586, "rad/s", "Angular frequency"],
      ["phi", 0.0, "rad", "Phase shift"],
      ["b", 0.0, "1", "Average value / DC offset"],
    ],
  },
  {
    modelType: "DM",
    aliases: ["dm"],
    label: "Marker Distance Magnitude",
    category: "Runtime Function",
    archetypeId: AdamsArchetypeId.FUNC_MEASURE_DISP,
    description: "Euclidean distance magnitude sqrt(dx^2 + dy^2 + dz^2) between I and J markers.",
    provenance: "Haug, Computer Aided Kinematics and Dynamics of Mechanical Systems (1989)",
    params: [
      ["axis", 0.0, "1", "0 = 3D Euclidean magnitude"],
      ["scale", 1.0, "1", "Scale factor"],
    ],
  },
  {
    modelType: "DX",
    aliases: ["dx"],
    label: "X Displacement Measure",
    category: "Runtime Function",
    archetypeId: AdamsArchetypeId.FUNC_MEASURE_DISP,
    description: "Translational displacement component along reference X axis between I and J markers.",
    provenance: "Haug, Computer Aided Kinematics and Dynamics of Mechanical Systems (1989)",
    params: [
      ["axis", 1.0, "1", "1 = X component"],
      ["scale", 1.0, "1", "Scale factor"],
    ],
  },
  {
    modelType: "DY",
    aliases: ["dy"],
    label: "Y Displacement Measure",
    category: "Runtime Function",
    archetypeId: AdamsArchetypeId.FUNC_MEASURE_DISP,
    description: "Translational displacement component along reference Y axis between I and J markers.",
    provenance: "Haug, Computer Aided Kinematics and Dynamics of Mechanical Systems (1989)",
    params: [
      ["axis", 2.0, "1", "2 = Y component"],
      ["scale", 1.0, "1", "Scale factor"],
    ],
  },
  {
    modelType: "DZ",
    aliases: ["dz"],
    label: "Z Displacement Measure",
    category: "Runtime Function",
    archetypeId: AdamsArchetypeId.FUNC_MEASURE_DISP,
    description: "Translational displacement component along reference Z axis between I and J markers.",
    provenance: "Haug, Computer Aided Kinematics and Dynamics of Mechanical Systems (1989)",
    params: [
      ["axis", 3.0, "1", "3 = Z component"],
      ["scale", 1.0, "1", "Scale factor"],
    ],
  },
  {
    modelType: "VX",
    aliases: ["vx"],
    label: "X Translational Velocity Measure",
    category: "Runtime Function",
    archetypeId: AdamsArchetypeId.FUNC_MEASURE_VEL,
    description: "Relative translational velocity component along reference X axis between I and J markers.",
    provenance: "Nikravesh, Computer-Aided Analysis of Mechanical Systems (Prentice Hall, 1988)",
    params: [
      ["axis", 1.0, "1", "1 = X velocity component"],
      ["scale", 1.0, "1", "Scale factor"],
    ],
  },
  {
    modelType: "VY",
    aliases: ["vy"],
    label: "Y Translational Velocity Measure",
    category: "Runtime Function",
    archetypeId: AdamsArchetypeId.FUNC_MEASURE_VEL,
    description: "Relative translational velocity component along reference Y axis between I and J markers.",
    provenance: "Nikravesh, Computer-Aided Analysis of Mechanical Systems (Prentice Hall, 1988)",
    params: [
      ["axis", 2.0, "1", "2 = Y velocity component"],
      ["scale", 1.0, "1", "Scale factor"],
    ],
  },
  {
    modelType: "VZ",
    aliases: ["vz"],
    label: "Z Translational Velocity Measure",
    category: "Runtime Function",
    archetypeId: AdamsArchetypeId.FUNC_MEASURE_VEL,
    description: "Relative translational velocity component along reference Z axis between I and J markers.",
    provenance: "Nikravesh, Computer-Aided Analysis of Mechanical Systems (Prentice Hall, 1988)",
    params: [
      ["axis", 3.0, "1", "3 = Z velocity component"],
      ["scale", 1.0, "1", "Scale factor"],
    ],
  },
  {
    modelType: "VR",
    aliases: ["vr"],
    label: "Radial Separation Velocity Measure",
    category: "Runtime Function",
    archetypeId: AdamsArchetypeId.FUNC_MEASURE_VEL,
    description: "Time rate of change of separation distance d/dt(DM) = (r . v) / |r| between I and J markers.",
    provenance: "Nikravesh, Computer-Aided Analysis of Mechanical Systems (Prentice Hall, 1988)",
    params: [
      ["axis", 4.0, "1", "4 = radial line-of-sight velocity"],
      ["scale", 1.0, "1", "Scale factor"],
    ],
  },

  // =========================================================================
  // 2. Joints & Constraints (11)
  // =========================================================================
  {
    modelType: "REVOLUTE",
    aliases: ["rev", "hinge", "joint_revolute"],
    label: "Revolute (Hinge) Joint",
    category: "Joint / Constraint",
    archetypeId: AdamsArchetypeId.JOINT_REVOLUTE,
    description: "1-DOF kinematic constraint permitting pure rotation about the common Z axis (5 constraints).",
    provenance: "Shabana, Dynamics of Multibody Systems (5th ed.), Ch. 3 Revolute Joint",
    params: JOINT_BASIC_PARAMS,
  },
  {
    modelType: "TRANSLATIONAL",
    aliases: ["trans", "prismatic", "joint_translational"],
    label: "Translational (Prismatic) Joint",
    category: "Joint / Constraint",
    archetypeId: AdamsArchetypeId.JOINT_TRANSLATIONAL,
    description: "1-DOF kinematic constraint permitting pure sliding along the common Z axis (5 constraints).",
    provenance: "Shabana, Dynamics of Multibody Systems (5th ed.), Ch. 3 Prismatic Joint",
    params: JOINT_BASIC_PARAMS,
  },
  {
    modelType: "SPHERICAL",
    aliases: ["sph", "ball", "joint_spherical"],
    label: "Spherical (Ball-and-Socket) Joint",
    category: "Joint / Constraint",
    archetypeId: AdamsArchetypeId.JOINT_SPHERICAL,
    description: "3-DOF rotational constraint enforcing coincident marker origins (3 translational constraints).",
    provenance: "Haug, Computer Aided Kinematics and Dynamics of Mechanical Systems (1989), Ch. 9",
    params: [
      ["dof", 3.0, "1", "3 rotational degrees of freedom"],
      ["penalty_k", 1.0e7, "N/m", "Constraint stiffness"],
      ["penalty_c", 1.0e3, "N*s/m", "Constraint damping"],
    ],
  },
  {
    modelType: "UNIVERSAL",
    aliases: ["uni", "cardan", "joint_universal"],
    label: "Universal (Cardan) Joint",
    category: "Joint / Constraint",
    archetypeId: AdamsArchetypeId.JOINT_UNIVERSAL,
    description: "2-DOF intersecting-axis rotational constraint enforcing orthogonal I-Z and J-Z axes (4 constraints).",
    provenance: "Nikravesh, Computer-Aided Analysis of Mechanical Systems (1988), Universal Joint",
    params: [
      ["dof", 2.0, "1", "2 rotational degrees of freedom"],
      ["penalty_k", 1.0e7, "N/m", "Constraint stiffness"],
      ["penalty_c", 1.0e3, "N*s/m", "Constraint damping"],
    ],
  },
  {
    modelType: "CYLINDRICAL",
    aliases: ["cyl", "joint_cylindrical"],
    label: "Cylindrical Joint",
    category: "Joint / Constraint",
    archetypeId: AdamsArchetypeId.JOINT_CYLINDRICAL,
    description: "2-DOF kinematic constraint permitting collinear translation and rotation along Z (4 constraints).",
    provenance: "Shabana, Dynamics of Multibody Systems (5th ed.), Ch. 3 Cylindrical Joint",
    params: [
      ["dof", 2.0, "1", "1 translational + 1 rotational DOF"],
      ["penalty_k", 1.0e7, "N/m", "Constraint stiffness"],
      ["penalty_c", 1.0e3, "N*s/m", "Constraint damping"],
    ],
  },
  {
    modelType: "FIXED",
    aliases: ["fix", "weld", "bracket", "joint_fixed"],
    label: "Fixed (Weld) Joint",
    category: "Joint / Constraint",
    archetypeId: AdamsArchetypeId.JOINT_FIXED,
    description: "0-DOF rigid attachment removing all 6 relative translational and rotational degrees of freedom.",
    provenance: "Haug, Computer Aided Kinematics and Dynamics of Mechanical Systems (1989)",
    params: [
      ["dof", 0.0, "1", "0 relative degrees of freedom (6 constraints)"],
      ["penalty_k", 1.0e8, "N/m", "Constraint stiffness"],
      ["penalty_c", 5.0e3, "N*s/m", "Constraint damping"],
    ],
  },
  {
    modelType: "PLANAR",
    aliases: ["pln", "joint_planar"],
    label: "Planar Joint",
    category: "Joint / Constraint",
    archetypeId: AdamsArchetypeId.JOINT_PLANAR,
    description: "3-DOF constraint keeping I marker origin in the J-XY plane and Z axes parallel (3 constraints).",
    provenance: "Nikravesh, Computer-Aided Analysis of Mechanical Systems (1988), Planar Joint",
    params: [
      ["dof", 3.0, "1", "2 translational + 1 rotational in-plane DOF"],
      ["penalty_k", 1.0e7, "N/m", "Constraint stiffness"],
      ["penalty_c", 1.0e3, "N*s/m", "Constraint damping"],
    ],
  },
  {
    modelType: "CONSTANT_VELOCITY",
    aliases: ["convel", "cv", "cv_joint"],
    label: "Constant Velocity (CV) Joint",
    category: "Joint / Constraint",
    archetypeId: AdamsArchetypeId.JOINT_CV,
    description:
      "2-DOF homokinetic drive joint transmitting identical shaft angular velocity across articulation angles.",
    provenance: "Gillespie, Fundamentals of Vehicle Dynamics (SAE, 1992); Homokinetic CV Kinematics",
    params: [
      ["dof", 2.0, "1", "2 articulation degrees of freedom"],
      ["penalty_k", 1.0e7, "N/m", "Constraint stiffness"],
      ["penalty_c", 1.0e3, "N*s/m", "Constraint damping"],
    ],
  },
  {
    modelType: "HOOKE",
    aliases: ["hooke_joint"],
    label: "Hooke Joint",
    category: "Joint / Constraint",
    archetypeId: AdamsArchetypeId.JOINT_HOOKE,
    description:
      "2-DOF gimbal/Hooke coupling with orthogonal cross-pin axes transmitting torque across shaft misalignment.",
    provenance: "Shabana, Dynamics of Multibody Systems (5th ed.), Universal / Hooke Joint",
    params: [
      ["dof", 2.0, "1", "2 rotational degrees of freedom"],
      ["penalty_k", 1.0e7, "N/m", "Constraint stiffness"],
      ["penalty_c", 1.0e3, "N*s/m", "Constraint damping"],
    ],
  },
  {
    modelType: "POINT_CURVE",
    aliases: ["ptcv", "point_on_curve"],
    label: "Point-Curve Constraint",
    category: "Joint / Constraint",
    archetypeId: AdamsArchetypeId.JOINT_POINT_CURVE,
    description: "Higher-pair 4-DOF constraint restricting marker I origin to lie on a parametric 3D curve on body J.",
    provenance: "Haug, Computer Aided Kinematics and Dynamics (1989); Higher-Pair Cam/Curve Constraints",
    params: [
      ["dof", 4.0, "1", "4 degrees of freedom (2 normal constraints)"],
      ["penalty_k", 1.0e7, "N/m", "Normal curve constraint stiffness"],
      ["penalty_c", 1.0e3, "N*s/m", "Normal curve constraint damping"],
    ],
  },
  {
    modelType: "MOTION",
    aliases: ["joint_motion", "pmotion"],
    label: "Prescribed Kinematic Motion Driver",
    category: "Joint / Constraint",
    archetypeId: AdamsArchetypeId.CONSTRAINT_MOTION,
    description: "Rheonomic constraint prescribing displacement, velocity, or acceleration as a function of time.",
    provenance: "Shabana, Dynamics of Multibody Systems (5th ed.), Ch. 3 Driving Constraints",
    params: [
      ["amplitude", 1.0, "m", "Motion amplitude or rate"],
      ["omega", 1.0, "rad/s", "Harmonic frequency (0 for linear ramp)"],
      ["phase", 0.0, "rad", "Phase offset"],
      ["offset", 0.0, "m", "Initial offset"],
    ],
  },

  // =========================================================================
  // 3. Forces & Bushings (8)
  // =========================================================================
  {
    modelType: "SPRING_DAMPER",
    aliases: ["springdamper", "tsda", "rsda"],
    label: "Translational / Rotational Spring-Damper",
    category: "Force / Bushing",
    archetypeId: AdamsArchetypeId.FORCE_SPRING_DAMPER,
    description: "Linear/cubic-nonlinear viscoelastic Kelvin-Voigt spring-damper element with preload and free length.",
    provenance: "Shabana, Dynamics of Multibody Systems (5th ed.), TSDA / RSDA Force Elements",
    params: [
      ["k", 1.0e4, "N/m", "Linear stiffness coefficient"],
      ["c", 100.0, "N*s/m", "Viscous damping coefficient"],
      ["l0", 0.0, "m", "Free (unloaded) length"],
      ["f0", 0.0, "N", "Static preload force"],
      ["k_nl", 0.0, "N/m^3", "Cubic progressive stiffness coefficient"],
    ],
  },
  {
    modelType: "BUSHING",
    aliases: ["bush", "elastomer_bushing"],
    label: "6-DOF Elastomeric Bushing",
    category: "Force / Bushing",
    archetypeId: AdamsArchetypeId.FORCE_BUSHING,
    description: "6-DOF compliant translational and rotational viscoelastic mount between I and J markers.",
    provenance: "Blundell & Harty, The Multibody Systems Approach to Vehicle Dynamics (2nd ed., 2015)",
    params: BUSHING_PARAMS,
  },
  {
    modelType: "BEAM",
    aliases: ["timoshenko_beam"],
    label: "3D Timoshenko Elastic Beam Element",
    category: "Force / Bushing",
    archetypeId: AdamsArchetypeId.FORCE_BEAM,
    description: "6-DOF massless linear Timoshenko beam compliance element with axial, bending, shear, and torsion.",
    provenance: "Przemieniecki, Theory of Matrix Structural Analysis (Dover, 1985)",
    params: [
      ["length", 1.0, "m", "Unloaded beam length L"],
      ["area", 1.0e-3, "m^2", "Cross-sectional area A"],
      ["iyy", 1.0e-6, "m^4", "Second moment of area Iyy"],
      ["izz", 1.0e-6, "m^4", "Second moment of area Izz"],
      ["ixx", 2.0e-6, "m^4", "Torsional constant J = Ixx"],
      ["ymodulus", 2.1e11, "Pa", "Young's modulus E"],
      ["gmodulus", 8.0e10, "Pa", "Shear modulus G"],
      ["cr", 0.01, "s", "Proportional structural damping ratio"],
    ],
  },
  {
    modelType: "FIELD",
    aliases: ["stiffness_field"],
    label: "6-DOF Coupled Stiffness-Damping Field",
    category: "Force / Bushing",
    archetypeId: AdamsArchetypeId.FORCE_FIELD,
    description: "General 6x6 stiffness and damping matrix field force element between I and J markers.",
    provenance: "Shabana, Dynamics of Multibody Systems (5th ed.); General 6-DOF Compliance Matrix",
    params: BUSHING_PARAMS,
  },
  {
    modelType: "SFORCE",
    aliases: ["single_force", "scalar_force"],
    label: "Single-Component Action-Reaction Force",
    category: "Force / Bushing",
    archetypeId: AdamsArchetypeId.FORCE_SFORCE,
    description: "Scalar translational or rotational action-reaction force applied along the I-J line of action.",
    provenance: "Haug, Computer Aided Kinematics and Dynamics of Mechanical Systems (1989)",
    params: [
      ["gain", 1.0, "N", "Proportional gain on input signal"],
      ["bias", 0.0, "N", "Constant force bias"],
      ["fmin", -1.0e9, "N", "Lower saturation limit"],
      ["fmax", 1.0e9, "N", "Upper saturation limit"],
    ],
  },
  {
    modelType: "VFORCE",
    aliases: ["vector_force"],
    label: "3-Component Vector Force",
    category: "Force / Bushing",
    archetypeId: AdamsArchetypeId.FORCE_VFORCE,
    description: "Three orthogonal translational force components (Fx, Fy, Fz) resolved in reference marker frame.",
    provenance: "Haug, Computer Aided Kinematics and Dynamics of Mechanical Systems (1989)",
    params: [
      ["fx", 0.0, "N", "X force component"],
      ["fy", 0.0, "N", "Y force component"],
      ["fz", 0.0, "N", "Z force component"],
    ],
  },
  {
    modelType: "GFORCE",
    aliases: ["general_force"],
    label: "6-Component General Force & Torque",
    category: "Force / Bushing",
    archetypeId: AdamsArchetypeId.FORCE_GFORCE,
    description: "Full 6-component spatial wrench (Fx, Fy, Fz, Tx, Ty, Tz) resolved in reference marker frame.",
    provenance: "Shabana, Dynamics of Multibody Systems (5th ed.), Generalized Spatial Forces",
    params: [
      ["fx", 0.0, "N", "X force component"],
      ["fy", 0.0, "N", "Y force component"],
      ["fz", 0.0, "N", "Z force component"],
      ["tx", 0.0, "N*m", "X torque component"],
      ["ty", 0.0, "N*m", "Y torque component"],
      ["tz", 0.0, "N*m", "Z torque component"],
    ],
  },
  {
    modelType: "CONTACT_3D",
    aliases: ["contact", "solid_contact"],
    label: "3D Geometry Impact & Coulomb Friction Contact",
    category: "Force / Bushing",
    archetypeId: AdamsArchetypeId.FORCE_CONTACT_3D,
    description: "3D solid-to-solid Hertzian normal impact with regularized Stribeck/Coulomb tangential friction.",
    provenance: "Flores & Lankarani (2016); Regularized Coulomb Friction for Multibody Contact",
    params: [
      ["k", 1.0e5, "N/m^e", "Normal Hertzian contact stiffness"],
      ["e", 1.5, "1", "Normal force exponent"],
      ["cmax", 100.0, "N*s/m", "Maximum normal damping"],
      ["d", 1.0e-3, "m", "Full damping penetration depth"],
      ["mu_s", 0.3, "1", "Static friction coefficient"],
      ["mu_d", 0.25, "1", "Dynamic (kinetic) friction coefficient"],
      ["vs", 0.01, "m/s", "Stiction transition velocity"],
      ["vd", 0.1, "m/s", "Friction transition velocity"],
    ],
  },

  // =========================================================================
  // 4. Tires & Automotive (5)
  // =========================================================================
  {
    modelType: "PAC2002_TIRE",
    aliases: ["pac2002", "magic_formula", "mf2002"],
    label: "Pacejka Magic Formula 2002 Tire",
    category: "Tire / Road",
    archetypeId: AdamsArchetypeId.TIRE_PAC2002,
    description: "Semi-empirical Pacejka Magic Formula (PAC2002) longitudinal/lateral tire force and aligning torque.",
    provenance: "Pacejka, Tyre and Vehicle Dynamics (3rd ed., Butterworth-Heinemann, 2012)",
    params: PAC2002_PARAMS,
  },
  {
    modelType: "FIALA_TIRE",
    aliases: ["fiala"],
    label: "Fiala Analytical Tire Model",
    category: "Tire / Road",
    archetypeId: AdamsArchetypeId.TIRE_FIALA,
    description: "Analytical parabolic-pressure brush tire model for longitudinal, lateral, and aligning forces.",
    provenance: "Fiala (1954) VDI Zeitschrift 96(29):973-979; Blundell & Harty (2015)",
    params: [
      ["kz", 2.0e5, "N/m", "Vertical tire stiffness"],
      ["cz", 500.0, "N*s/m", "Vertical tire damping"],
      ["c_slip", 1.0e5, "N", "Longitudinal slip stiffness"],
      ["c_alpha", 6.0e4, "N/rad", "Cornering stiffness"],
      ["u_min", 0.8, "1", "Sliding friction coefficient"],
      ["u_max", 1.0, "1", "Peak static friction coefficient"],
      ["r_unloaded", 0.32, "m", "Unloaded tire radius"],
    ],
  },
  {
    modelType: "UA_TIRE",
    aliases: ["ua", "university_of_arizona_tire"],
    label: "University of Arizona (UA) Tire Model",
    category: "Tire / Road",
    archetypeId: AdamsArchetypeId.TIRE_UA,
    description: "Combined-slip friction-ellipse analytical tire model with camber thrust and rolling resistance.",
    provenance: "Gim & Nikravesh (1990) Int. J. Vehicle Design 11(6):589-603, Analytical Model of Pneumatic Tyres",
    params: [
      ["kz", 2.0e5, "N/m", "Vertical tire stiffness"],
      ["cz", 500.0, "N*s/m", "Vertical tire damping"],
      ["c_s", 1.0e5, "N", "Longitudinal slip stiffness"],
      ["c_alpha", 6.0e4, "N/rad", "Lateral cornering stiffness"],
      ["c_gamma", 2.5e3, "N/rad", "Camber thrust stiffness"],
      ["mu_0", 0.95, "1", "Peak tire-road friction coefficient"],
      ["r_unloaded", 0.32, "m", "Unloaded tire radius"],
    ],
  },
  {
    modelType: "ROAD_FLAT",
    aliases: ["flat_road", "rdf_flat"],
    label: "Flat Planar Road Surface",
    category: "Tire / Road",
    archetypeId: AdamsArchetypeId.ROAD_FLAT,
    description: "Infinite planar road surface at constant elevation z0 with uniform friction scaling mu.",
    provenance: "Pacejka, Tyre and Vehicle Dynamics (3rd ed., 2012); Standard Flat Road Profile",
    params: [
      ["z0", 0.0, "m", "Road plane elevation"],
      ["mu", 1.0, "1", "Road surface friction scaling factor"],
      ["grade", 0.0, "rad", "Longitudinal road slope"],
    ],
  },
  {
    modelType: "ROAD_CLEAT",
    aliases: ["cleat_road", "rdf_cleat", "speed_bump"],
    label: "Cleat / Speed-Bump Road Profile",
    category: "Tire / Road",
    archetypeId: AdamsArchetypeId.ROAD_CLEAT,
    description: "Flat road with a trapezoidal or haversine cleat obstacle for ride and harshness evaluation.",
    provenance: "ISO 8608 & Pacejka (2012); Transient Cleat Envelopment Road Test Profile",
    params: [
      ["x_start", 5.0, "m", "Longitudinal start position of cleat"],
      ["length", 0.2, "m", "Cleat longitudinal width"],
      ["height", 0.025, "m", "Cleat peak height"],
      ["ramp", 0.03, "m", "Bevel / transition ramp length"],
      ["mu", 1.0, "1", "Road friction scaling factor"],
    ],
  },
];

/**
 * Converts `ADAMS_MODEL_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG icons and port layouts.
 */
export function buildAdamsCleanroomSchemas(): CleanroomModelSchema[] {
  return ADAMS_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `adams:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "mechanical",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "adams_element",
      width: 88,
      height: 48,
      svg: generateAdamsBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: spec.modelType.toLowerCase(),
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
