// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * GENSYS cleanroom multibody coupling, contact, profile, and body archetype IDs
 * matching `assets/gensys-std-lib/src/models.ts`.
 */
export const GensysArchetypeId = {
  SPRING_LINEAR: 1, // k_s, k_lin, k_p
  SPRING_PIECEWISE: 2, // kpf_s
  DAMPER_VISCOUS: 10, // c_s, c_lin, c_p
  SPRING_DAMPER_SERIES: 11, // kc_s (Maxwell series spring-damper)
  AIRSPRING: 12, // k_air (pneumatic airspring)
  FRICTION_COULOMB: 13, // f_fric (Coulomb dry friction)
  WHEEL_RAIL_PE3: 20, // wr_coupl_pe3 (3-point elastic wheel-rail contact)
  WHEEL_RAIL_PRA: 21, // wr_coupl_pra (precalculated rail-side elastic contact)
  WHEEL_RAIL_PE1: 22, // wr_coupl_pe1 (single-point elastic wheel-rail contact)
  CONTACT_HERTZ: 23, // kpf_hertz (Hertzian normal contact stiffness)
  CREEP_KALKER: 24, // creep_kalker (Kalker linear / FASTSIM creepage)
  CREEP_POLACH: 25, // creep_polach (Polach nonlinear creepage)
  PROFILE_WHEEL: 30, // prof_S1002, prof_P8, prof_AAR1B
  PROFILE_RAIL: 31, // rail_UIC60, rail_54E1
  TRACK_IRREG: 32, // track_irreg_ORE, track_irreg_FRA
  BODY_RIGID: 40, // mass_rigid, mass_wheelset, mass_bogie, mass_carbody
  CONSTRAINT_KINEMATIC: 50, // constr_fix, constr_rev
} as const;

export type GensysArchetypeId = (typeof GensysArchetypeId)[keyof typeof GensysArchetypeId];

export type GensysModelCategory =
  | "Elastic & Damping Couplings"
  | "Wheel-Rail Contact"
  | "Standard Profiles & Track"
  | "Bodies & Constraints";

export interface GensysModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: GensysModelCategory;
  archetypeId: GensysArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<GensysModelCategory, { fill: string; stroke: string; badge: string }> = {
  "Elastic & Damping Couplings": { fill: "#1e3a5f", stroke: "#60a5fa", badge: "CPL" },
  "Wheel-Rail Contact": { fill: "#3b1f47", stroke: "#c084fc", badge: "WRC" },
  "Standard Profiles & Track": { fill: "#1e3f2f", stroke: "#34d399", badge: "TRK" },
  "Bodies & Constraints": { fill: "#3f2e18", stroke: "#fbbf24", badge: "MBD" },
};

/**
 * Generates a deterministic cleanroom parametric SVG icon for a GENSYS standard library element.
 */
export function generateGensysBlockSvg(modelType: string, category: GensysModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 10);
  let motif = "";
  if (category === "Elastic & Damping Couplings") {
    // Stylized spring coil motif
    motif = `<path d="M46 11 L50 8 L54 14 L58 8 L62 14 L66 11" fill="none" stroke="${c.stroke}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>`;
  } else if (category === "Wheel-Rail Contact") {
    // Stylized wheel-on-rail contact patch motif
    motif =
      `<circle cx="58" cy="10" r="4" fill="none" stroke="${c.stroke}" stroke-width="1.3"/>` +
      `<line x1="50" y1="15" x2="66" y2="15" stroke="${c.stroke}" stroke-width="1.5"/>`;
  } else if (category === "Standard Profiles & Track") {
    // Stylized rail profile / track wave motif
    motif = `<path d="M48 14 Q53 8 58 12 T68 10" fill="none" stroke="${c.stroke}" stroke-width="1.4" stroke-linecap="round"/>`;
  } else {
    // Stylized rigid body mass center motif
    motif =
      `<rect x="52" y="7" width="12" height="9" rx="1.5" fill="none" stroke="${c.stroke}" stroke-width="1.3"/>` +
      `<circle cx="58" cy="11.5" r="1.5" fill="${c.stroke}"/>`;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 48" width="88" height="48">` +
    `<rect x="2" y="2" width="84" height="44" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="26" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="19" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${c.badge}</text>` +
    motif +
    `<text x="44" y="34" text-anchor="middle" font-family="monospace" font-size="9.5" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: GensysModelCategory): DiagramPortSpec[] {
  switch (category) {
    case "Elastic & Damping Couplings":
      return [
        { name: "body1", kind: "mechanical", side: "left", dx: 0, dy: 24 },
        { name: "body2", kind: "mechanical", side: "right", dx: 88, dy: 24 },
      ];
    case "Wheel-Rail Contact":
      return [
        { name: "wheelset", kind: "mechanical", side: "top", dx: 44, dy: 0 },
        { name: "track", kind: "mechanical", side: "bottom", dx: 44, dy: 48 },
        { name: "creep", kind: "signal", side: "right", dx: 88, dy: 24 },
      ];
    case "Standard Profiles & Track":
      return [
        { name: "geometry", kind: "signal", side: "right", dx: 88, dy: 24 },
        { name: "track_ref", kind: "mechanical", side: "left", dx: 0, dy: 24 },
      ];
    case "Bodies & Constraints":
      return [
        { name: "frame_a", kind: "mechanical", side: "left", dx: 0, dy: 24 },
        { name: "frame_b", kind: "mechanical", side: "right", dx: 88, dy: 24 },
        { name: "cg", kind: "mechanical", side: "bottom", dx: 44, dy: 48 },
      ];
  }
}

export const GENSYS_MODEL_SPECS: GensysModelSpec[] = [
  // =========================================================================
  // 1. Elastic & Damping Couplings
  // =========================================================================
  {
    modelType: "k_s",
    aliases: ["K_S", "coupl_k_s", "spring_s"],
    label: "3-Axis Elastic Spring Coupling (k_s)",
    category: "Elastic & Damping Couplings",
    archetypeId: GensysArchetypeId.SPRING_LINEAR,
    description:
      "DEsolver GENSYS three-dimensional translational elastic spring coupling with optional preload and deadband.",
    provenance: "DEsolver GENSYS Public Element Reference (coupl k_s); EN 14363:2016+A2:2022 Rail Vehicle Dynamics",
    params: [
      ["kx", 1.0e6, "N/m", "Longitudinal spring stiffness"],
      ["ky", 1.0e6, "N/m", "Lateral spring stiffness"],
      ["kz", 1.2e6, "N/m", "Vertical spring stiffness"],
      ["f0", 0.0, "N", "Static vertical preload force"],
      ["gap", 0.0, "m", "Symmetric clearance deadband"],
    ],
  },
  {
    modelType: "k_lin",
    aliases: ["K_LIN", "coupl_k_lin"],
    label: "Linear 1D/3D Stiffness Element (k_lin)",
    category: "Elastic & Damping Couplings",
    archetypeId: GensysArchetypeId.SPRING_LINEAR,
    description: "Purely linear Hookean stiffness coupling used in primary and secondary rail suspension.",
    provenance: "DEsolver GENSYS Public Element Reference (coupl k_lin); UIC 518 / EN 14363",
    params: [
      ["kx", 5.0e5, "N/m", "Longitudinal linear stiffness"],
      ["ky", 5.0e5, "N/m", "Lateral linear stiffness"],
      ["kz", 8.0e5, "N/m", "Vertical linear stiffness"],
      ["f0", 0.0, "N", "Static preload force"],
      ["gap", 0.0, "m", "Clearance deadband"],
    ],
  },
  {
    modelType: "k_p",
    aliases: ["K_P", "coupl_k_p"],
    label: "Parallel Coil / Rubber Spring (k_p)",
    category: "Elastic & Damping Couplings",
    archetypeId: GensysArchetypeId.SPRING_LINEAR,
    description: "Parallel elastic spring coupling connecting bogie frame and wheelset axlebox or carbody bolster.",
    provenance: "DEsolver GENSYS Public Element Reference (coupl k_p); Manchester Benchmarks (Iwnicki 1998)",
    params: [
      ["kx", 1.2e7, "N/m", "Primary longitudinal axlebox stiffness"],
      ["ky", 6.0e6, "N/m", "Primary lateral axlebox stiffness"],
      ["kz", 1.22e6, "N/m", "Primary vertical coil spring stiffness"],
      ["f0", 0.0, "N", "Static preload"],
      ["gap", 0.0, "m", "Deadband clearance"],
    ],
  },
  {
    modelType: "c_s",
    aliases: ["C_S", "coupl_c_s", "damper_s"],
    label: "3-Axis Viscous Damper Coupling (c_s)",
    category: "Elastic & Damping Couplings",
    archetypeId: GensysArchetypeId.DAMPER_VISCOUS,
    description: "DEsolver GENSYS three-dimensional hydraulic viscous damper coupling with blow-off force saturation.",
    provenance: "DEsolver GENSYS Public Element Reference (coupl c_s); EN 14363:2016+A2:2022",
    params: [
      ["cx", 2.0e4, "N*s/m", "Longitudinal damping coefficient"],
      ["cy", 2.5e4, "N*s/m", "Lateral damping coefficient"],
      ["cz", 3.0e4, "N*s/m", "Vertical damping coefficient"],
      ["fmax", 1.0e5, "N", "Hydraulic blow-off force limit"],
    ],
  },
  {
    modelType: "c_lin",
    aliases: ["C_LIN", "coupl_c_lin"],
    label: "Linear Viscous Damper (c_lin)",
    category: "Elastic & Damping Couplings",
    archetypeId: GensysArchetypeId.DAMPER_VISCOUS,
    description: "Linear velocity-proportional hydraulic damper for bogie yaw, lateral, and vertical suspension.",
    provenance: "DEsolver GENSYS Public Element Reference (coupl c_lin); UIC 518",
    params: [
      ["cx", 1.5e4, "N*s/m", "Longitudinal linear damping"],
      ["cy", 2.0e4, "N*s/m", "Lateral linear damping"],
      ["cz", 2.0e4, "N*s/m", "Vertical linear damping"],
      ["fmax", 1.0e6, "N", "Force saturation limit"],
    ],
  },
  {
    modelType: "c_p",
    aliases: ["C_P", "coupl_c_p"],
    label: "Parallel Hydraulic Damper (c_p)",
    category: "Elastic & Damping Couplings",
    archetypeId: GensysArchetypeId.DAMPER_VISCOUS,
    description: "Parallel primary/secondary shock absorber element with symmetric blow-off relief.",
    provenance: "DEsolver GENSYS Public Element Reference (coupl c_p); Manchester Benchmarks (Iwnicki 1998)",
    params: [
      ["cx", 1.0e4, "N*s/m", "Longitudinal parallel damping"],
      ["cy", 1.5e4, "N*s/m", "Lateral parallel damping"],
      ["cz", 4.0e3, "N*s/m", "Primary vertical damper coefficient"],
      ["fmax", 5.0e4, "N", "Blow-off valve saturation force"],
    ],
  },
  {
    modelType: "kc_s",
    aliases: ["KC_S", "coupl_kc_s", "maxwell"],
    label: "Maxwell Series Spring-Damper (kc_s)",
    category: "Elastic & Damping Couplings",
    archetypeId: GensysArchetypeId.SPRING_DAMPER_SERIES,
    description:
      "Viscoelastic Maxwell coupling (elastic end-bush stiffness in series with hydraulic yaw/lateral damper).",
    provenance: "DEsolver GENSYS Public Element Reference (coupl kc_s); UIC 518 Yaw Damper Modeling",
    params: [
      ["k_ser", 1.5e7, "N/m", "Series mounting bushing stiffness"],
      ["c_ser", 5.0e5, "N*s/m", "Hydraulic yaw damper coefficient"],
      ["fmax", 4.0e4, "N", "Blow-off force limit"],
    ],
  },
  {
    modelType: "kpf_s",
    aliases: ["KPF_S", "coupl_kpf_s", "bumpstop"],
    label: "Piecewise-Linear Bumpstop Spring (kpf_s)",
    category: "Elastic & Damping Couplings",
    archetypeId: GensysArchetypeId.SPRING_PIECEWISE,
    description: "Piecewise-linear nonlinear spring coupling modeling progressive lateral/vertical rubber bumpstops.",
    provenance: "DEsolver GENSYS Public Element Reference (coupl kpf_s); EN 14363 Bumpstop Clearance",
    params: [
      ["k1", 2.0e5, "N/m", "Primary linear stiffness before bumpstop contact"],
      ["d1", 0.025, "m", "Bumpstop clearance threshold"],
      ["k2", 1.2e7, "N/m", "Progressive bumpstop stiffness beyond clearance"],
      ["c_int", 1.0e3, "N*s/m", "Internal hysteresis damping"],
    ],
  },
  {
    modelType: "k_air",
    aliases: ["K_AIR", "coupl_k_air", "airspring"],
    label: "Pneumatic Secondary Airspring (k_air)",
    category: "Elastic & Damping Couplings",
    archetypeId: GensysArchetypeId.AIRSPRING,
    description:
      "Thermodynamic pneumatic airspring with surge reservoir, orifice damping, and bellows shear stiffness (Berg/Nishimura).",
    provenance:
      "Berg M. (1999) 'A Three-Dimensional Airspring Model with Friction and Orifice Damping', Vehicle System Dynamics; EN 14363",
    params: [
      ["ks", 6.0e5, "N/m", "Bellows series air stiffness"],
      ["kr", 2.2e5, "N/m", "Auxiliary reservoir stiffness"],
      ["cr", 4.5e4, "N*s/m", "Orifice linearized damping coefficient"],
      ["kx", 1.6e5, "N/m", "Longitudinal bellows shear stiffness"],
      ["ky", 1.6e5, "N/m", "Lateral bellows shear stiffness"],
      ["aeff", 0.28, "m^2", "Effective pneumatic piston area"],
      ["p0", 4.5e5, "Pa", "Nominal static bellows gauge pressure"],
      ["v0", 0.065, "m^3", "Total airspring + reservoir volume"],
      ["n_poly", 1.35, "-", "Polytropic gas exponent"],
    ],
  },
  {
    modelType: "f_fric",
    aliases: ["F_FRIC", "coupl_f_fric", "coulomb"],
    label: "Coulomb Dry Friction Element (f_fric)",
    category: "Elastic & Damping Couplings",
    archetypeId: GensysArchetypeId.FRICTION_COULOMB,
    description:
      "Regularized Coulomb dry friction coupling for freight Y25 Lenoir links, leaf springs, and center-plate friction.",
    provenance: "DEsolver GENSYS Public Element Reference (coupl f_fric); UIC 518 Freight Bogie Friction",
    params: [
      ["mu", 0.35, "-", "Dry Coulomb friction coefficient"],
      ["fn0", 2.5e4, "N", "Nominal normal preload force"],
      ["v_eps", 1.0e-3, "m/s", "Regularization stick-slip transition velocity"],
      ["k_stick", 1.0e7, "N/m", "Elastic stick shear stiffness"],
    ],
  },

  // =========================================================================
  // 2. Wheel-Rail Contact
  // =========================================================================
  {
    modelType: "wr_coupl_pe3",
    aliases: ["WR_COUPL_PE3", "pe3"],
    label: "3-Point Nonlinear Wheel-Rail Contact (wr_coupl_pe3)",
    category: "Wheel-Rail Contact",
    archetypeId: GensysArchetypeId.WHEEL_RAIL_PE3,
    description:
      "Three-point simultaneous tread/flange wheel-rail contact coupling with Hertzian normal elasticity and Polach/Kalker creepage.",
    provenance:
      "Kalker J.J. (1990) Three-Dimensional Elastic Bodies in Rolling Contact; Polach O. (2005) Wear 258:992-1000; EN 14363",
    params: [
      ["mu0", 0.36, "-", "Static wheel-rail friction coefficient"],
      ["a_hertz", 0.0065, "m", "Contact ellipse semi-major axis a"],
      ["b_hertz", 0.0045, "m", "Contact ellipse semi-minor axis b"],
      ["g_steel", 8.2e10, "Pa", "Steel shear modulus G"],
      ["nu_steel", 0.28, "-", "Steel Poisson ratio"],
      ["k_a", 0.6, "-", "Polach adhesion area reduction factor kA"],
      ["k_s", 0.3, "-", "Polach slip area reduction factor kS"],
      ["polach_a", 0.4, "-", "Polach friction ratio mu_inf / mu_0"],
      ["polach_b", 0.6, "s/m", "Polach exponential friction decay coefficient B"],
      ["c_hertz", 9.5e10, "N/m^1.5", "Hertzian normal contact stiffness constant"],
    ],
  },
  {
    modelType: "wr_coupl_pra",
    aliases: ["WR_COUPL_PRA", "pra"],
    label: "Precalculated Rail-Elastic Wheel-Rail Coupling (wr_coupl_pra)",
    category: "Wheel-Rail Contact",
    archetypeId: GensysArchetypeId.WHEEL_RAIL_PRA,
    description:
      "Wheel-rail contact coupling utilizing precalculated kpfr contact geometry tables with Polach/Kalker tangential forces.",
    provenance: "DEsolver GENSYS Public Reference (wr_coupl_pra); Kalker FASTSIM (1982); EN 14363",
    params: [
      ["mu0", 0.35, "-", "Nominal friction coefficient"],
      ["a_hertz", 0.0062, "m", "Contact ellipse semi-major axis"],
      ["b_hertz", 0.0042, "m", "Contact ellipse semi-minor axis"],
      ["g_steel", 8.2e10, "Pa", "Steel shear modulus"],
      ["nu_steel", 0.28, "-", "Steel Poisson ratio"],
      ["k_a", 0.7, "-", "Polach adhesion reduction factor"],
      ["k_s", 0.4, "-", "Polach slip reduction factor"],
      ["polach_a", 0.45, "-", "Polach friction ratio A"],
      ["polach_b", 0.5, "s/m", "Polach decay factor B"],
      ["c_hertz", 9.2e10, "N/m^1.5", "Hertzian normal contact constant"],
    ],
  },
  {
    modelType: "wr_coupl_pe1",
    aliases: ["WR_COUPL_PE1", "pe1"],
    label: "Single-Point Elastic Wheel-Rail Contact (wr_coupl_pe1)",
    category: "Wheel-Rail Contact",
    archetypeId: GensysArchetypeId.WHEEL_RAIL_PE1,
    description:
      "Single-point elastic wheel-rail contact coupling for fast stability and linearized hunting eigenvalue analysis.",
    provenance: "DEsolver GENSYS Public Reference (wr_coupl_pe1); Kalker Linear Theory (1967); UIC 518",
    params: [
      ["mu0", 0.4, "-", "Wheel-rail friction coefficient"],
      ["a_hertz", 0.006, "m", "Contact ellipse semi-major axis"],
      ["b_hertz", 0.004, "m", "Contact ellipse semi-minor axis"],
      ["g_steel", 8.2e10, "Pa", "Steel shear modulus"],
      ["nu_steel", 0.28, "-", "Steel Poisson ratio"],
      ["k_a", 1.0, "-", "Polach adhesion factor"],
      ["k_s", 0.4, "-", "Polach slip factor"],
      ["polach_a", 0.4, "-", "Polach friction ratio A"],
      ["polach_b", 0.6, "s/m", "Polach decay factor B"],
      ["c_hertz", 9.0e10, "N/m^1.5", "Hertzian normal contact constant"],
    ],
  },
  {
    modelType: "kpf_hertz",
    aliases: ["KPF_HERTZ", "hertz_contact"],
    label: "Hertzian Normal Contact Stiffness (kpf_hertz)",
    category: "Wheel-Rail Contact",
    archetypeId: GensysArchetypeId.CONTACT_HERTZ,
    description:
      "Nonlinear 3/2-power Hertzian normal wheel-rail contact elasticity with Hunt-Crossley hysteresis damping.",
    provenance: "Hertz H. (1882) J. Reine Angew. Math.; Johnson K.L. (1985) Contact Mechanics; EN 14363",
    params: [
      ["c_hertz", 9.5e10, "N/m^1.5", "Hertzian normal stiffness coefficient"],
      ["c_damp", 1.0e5, "N*s/m^2.5", "Hunt-Crossley contact damping factor"],
      ["r_wheel", 0.46, "m", "Nominal wheel rolling radius"],
      ["r_rail", 0.3, "m", "Rail crown radius"],
    ],
  },
  {
    modelType: "creep_kalker",
    aliases: ["CREEP_KALKER", "fastsim"],
    label: "Kalker Linear / FASTSIM Creep Force (creep_kalker)",
    category: "Wheel-Rail Contact",
    archetypeId: GensysArchetypeId.CREEP_KALKER,
    description:
      "Kalker linear creepage coefficients (C11, C22, C23) with Vermeulen-Johnson / Coulomb saturation cone.",
    provenance:
      "Kalker J.J. (1982) 'A Fast Algorithm for the Simplified Theory of Rolling Contact (FASTSIM)', Vehicle System Dynamics 11:1-13",
    params: [
      ["mu0", 0.36, "-", "Friction coefficient"],
      ["a_hertz", 0.0065, "m", "Contact semi-major axis a"],
      ["b_hertz", 0.0045, "m", "Contact semi-minor axis b"],
      ["g_steel", 8.2e10, "Pa", "Steel shear modulus G"],
      ["c11", 4.12, "-", "Kalker longitudinal creep coefficient C11"],
      ["c22", 3.67, "-", "Kalker lateral creep coefficient C22"],
      ["c23", 1.47, "-", "Kalker lateral/spin creep coefficient C23"],
    ],
  },
  {
    modelType: "creep_polach",
    aliases: ["CREEP_POLACH", "polach"],
    label: "Polach Nonlinear Creep Force (creep_polach)",
    category: "Wheel-Rail Contact",
    archetypeId: GensysArchetypeId.CREEP_POLACH,
    description:
      "Polach nonlinear traction/adhesion wheel-rail creep model with velocity-dependent falling friction for traction and curving.",
    provenance:
      "Polach O. (2005) 'Creep forces in simulations of traction vehicles running on adhesion limit', Wear 258:992-1000",
    params: [
      ["mu0", 0.36, "-", "Maximum static friction coefficient mu0"],
      ["a_hertz", 0.0065, "m", "Contact semi-major axis a"],
      ["b_hertz", 0.0045, "m", "Contact semi-minor axis b"],
      ["g_steel", 8.2e10, "Pa", "Steel shear modulus G"],
      ["nu_steel", 0.28, "-", "Steel Poisson ratio"],
      ["k_a", 0.6, "-", "Adhesion area reduction factor kA"],
      ["k_s", 0.3, "-", "Slip area reduction factor kS"],
      ["polach_a", 0.4, "-", "Ratio of limit to static friction A"],
      ["polach_b", 0.6, "s/m", "Exponential friction decay coefficient B"],
    ],
  },

  // =========================================================================
  // 3. Standard Profiles & Track
  // =========================================================================
  {
    modelType: "prof_S1002",
    aliases: ["S1002", "s1002", "ORE_S1002"],
    label: "EN 13715 / ORE S1002 Wheel Profile",
    category: "Standard Profiles & Track",
    archetypeId: GensysArchetypeId.PROFILE_WHEEL,
    description: "Standard European high-speed and mainline wear-adapted wheel tread profile S1002 (h28/e32.5).",
    provenance: "EN 13715:2020 Railway Applications — Wheelsets and Bogies — Wheels — Tread Profile (S1002); UIC 510-2",
    params: [
      ["r0", 0.46, "m", "Nominal rolling radius"],
      ["conicity", 0.12, "-", "Equivalent conicity on 60E1 1:40 rail at 3 mm amplitude"],
      ["flange_height", 0.028, "m", "Flange height h"],
      ["flange_thick", 0.0325, "m", "Flange thickness e"],
      ["flange_angle", 70.0, "deg", "Maximum flange angle"],
    ],
  },
  {
    modelType: "prof_P8",
    aliases: ["P8", "p8", "UK_P8"],
    label: "UK RSSB P8 Wheel Profile",
    category: "Standard Profiles & Track",
    archetypeId: GensysArchetypeId.PROFILE_WHEEL,
    description: "British Rail / RSSB standard P8 wear-adapted wheel profile designed for 1:20 inclined rails.",
    provenance: "RSSB GM/RT2466 / EN 13715 P8 Wheel Tread Profile Specification",
    params: [
      ["r0", 0.42, "m", "Nominal rolling radius"],
      ["conicity", 0.18, "-", "Equivalent conicity on 56E1 1:20 rail"],
      ["flange_height", 0.03, "m", "Flange height"],
      ["flange_thick", 0.0285, "m", "Flange thickness"],
      ["flange_angle", 68.0, "deg", "Maximum flange angle"],
    ],
  },
  {
    modelType: "prof_AAR1B",
    aliases: ["AAR1B", "aar1b", "AAR_1B"],
    label: "AAR-1B North American Wheel Profile",
    category: "Standard Profiles & Track",
    archetypeId: GensysArchetypeId.PROFILE_WHEEL,
    description:
      "Association of American Railroads wide-flange 1:20 taper wheel profile for heavy-haul freight and passenger service.",
    provenance: "AAR Manual of Standards and Recommended Practices Section G (M-107/M-208) AAR-1B Profile",
    params: [
      ["r0", 0.4572, "m", "Nominal rolling radius (36 in wheel)"],
      ["conicity", 0.05, "-", "Nominal 1:20 tread conicity"],
      ["flange_height", 0.0254, "m", "Flange height (1.0 in)"],
      ["flange_thick", 0.0349, "m", "Flange thickness (1.375 in)"],
      ["flange_angle", 75.0, "deg", "Flange throat angle"],
    ],
  },
  {
    modelType: "rail_UIC60",
    aliases: ["UIC60", "60E1", "uic60"],
    label: "EN 13674-1 60E1 (UIC60) Rail Profile",
    category: "Standard Profiles & Track",
    archetypeId: GensysArchetypeId.PROFILE_RAIL,
    description: "Standard European 60.21 kg/m Vignoles rail head geometry (300/80/13 mm crown radii).",
    provenance: "EN 13674-1:2011+A1:2017 Railway Applications — Track — Rail Profile 60E1 (UIC60)",
    params: [
      ["cant_inv", 40.0, "-", "Rail inclination denominator (1:40)"],
      ["gauge", 1.435, "m", "Standard track gauge"],
      ["crown_r", 0.3, "m", "Primary rail head crown radius"],
      ["shoulder_r", 0.08, "m", "Rail shoulder radius"],
      ["corner_r", 0.013, "m", "Gauge corner radius"],
    ],
  },
  {
    modelType: "rail_54E1",
    aliases: ["54E1", "UIC54", "uic54"],
    label: "EN 13674-1 54E1 (UIC54) Rail Profile",
    category: "Standard Profiles & Track",
    archetypeId: GensysArchetypeId.PROFILE_RAIL,
    description: "Standard European 54.77 kg/m mainline rail profile with 300/80/13 mm head radii.",
    provenance: "EN 13674-1:2011+A1:2017 Railway Applications — Track — Rail Profile 54E1 (UIC54)",
    params: [
      ["cant_inv", 40.0, "-", "Rail inclination denominator (1:40)"],
      ["gauge", 1.435, "m", "Standard track gauge"],
      ["crown_r", 0.3, "m", "Primary rail head crown radius"],
      ["shoulder_r", 0.08, "m", "Rail shoulder radius"],
      ["corner_r", 0.013, "m", "Gauge corner radius"],
    ],
  },
  {
    modelType: "track_irreg_ORE",
    aliases: ["ORE_B176", "ERRI_B176", "ore_irreg"],
    label: "ORE B176 / ERRI Track Irregularity PSD",
    category: "Standard Profiles & Track",
    archetypeId: GensysArchetypeId.TRACK_IRREG,
    description:
      "Analytical spatial power spectral density (PSD) generator for ORE/ERRI B176 low/high-level track irregularities.",
    provenance: "ORE/ERRI B176 RP1 (1989) Bogies with Steered or Steering Wheelsets; EN 14363 Annex C",
    params: [
      ["av", 4.032e-7, "rad*m", "Vertical roughness constant Av (low level)"],
      ["aa", 2.119e-7, "rad*m", "Alignment roughness constant Aa (low level)"],
      ["omega_c", 0.8246, "rad/m", "Critical spatial frequency omega_c"],
      ["omega_r", 0.0206, "rad/m", "Roll-off spatial frequency omega_r"],
      ["wavelength", 15.0, "m", "Representative evaluation wavelength"],
    ],
  },
  {
    modelType: "track_irreg_FRA",
    aliases: ["FRA_PSD", "FRA_CLASS6", "fra_irreg"],
    label: "FRA Track Class 1-6 Irregularity PSD",
    category: "Standard Profiles & Track",
    archetypeId: GensysArchetypeId.TRACK_IRREG,
    description: "US Federal Railroad Administration (FRA) track geometry roughness PSD for Track Classes 1 through 6.",
    provenance:
      "FRA 49 CFR Part 213 Track Safety Standards; Garg & Dukkipati (1984) Dynamics of Railway Vehicle Systems",
    params: [
      ["av", 3.39e-8, "m^2*rad/m", "FRA Class 6 vertical roughness constant Av"],
      ["aa", 3.39e-8, "m^2*rad/m", "FRA Class 6 alignment roughness constant Aa"],
      ["omega_c", 0.8245, "rad/m", "Break spatial frequency omega_c"],
      ["omega_s", 0.438, "rad/m", "Surface spatial frequency omega_s"],
      ["wavelength", 15.0, "m", "Representative evaluation wavelength"],
    ],
  },

  // =========================================================================
  // 4. Bodies & Constraints
  // =========================================================================
  {
    modelType: "mass_rigid",
    aliases: ["MASS_RIGID", "m_rigid_6"],
    label: "6-DOF Rigid Body (mass_rigid)",
    category: "Bodies & Constraints",
    archetypeId: GensysArchetypeId.BODY_RIGID,
    description:
      "General six-degree-of-freedom rigid body with diagonal inertia tensor in track-following coordinates.",
    provenance: "DEsolver GENSYS Public Element Reference (mass m_rigid_6); EN 14363",
    params: [
      ["mass", 1000.0, "kg", "Body mass"],
      ["jx", 500.0, "kg*m^2", "Roll mass moment of inertia Jxx"],
      ["jy", 500.0, "kg*m^2", "Pitch mass moment of inertia Jyy"],
      ["jz", 500.0, "kg*m^2", "Yaw mass moment of inertia Jzz"],
      ["g", 9.80665, "m/s^2", "Gravitational acceleration"],
    ],
  },
  {
    modelType: "mass_wheelset",
    aliases: ["MASS_WHEELSET", "axl"],
    label: "Railway Wheelset Rigid Body (mass_wheelset)",
    category: "Bodies & Constraints",
    archetypeId: GensysArchetypeId.BODY_RIGID,
    description: "Rigid railway wheelset with gyroscopic pitch inertia and nominal rolling radius.",
    provenance: "Manchester Benchmarks (Iwnicki 1998); UIC 518 / EN 14363",
    params: [
      ["mass", 1813.0, "kg", "Wheelset mass"],
      ["jx", 1120.0, "kg*m^2", "Wheelset roll inertia Jxx"],
      ["jy", 112.0, "kg*m^2", "Wheelset spin/pitch inertia Jyy"],
      ["jz", 1120.0, "kg*m^2", "Wheelset yaw inertia Jzz"],
      ["g", 9.80665, "m/s^2", "Gravitational acceleration"],
    ],
  },
  {
    modelType: "mass_bogie",
    aliases: ["MASS_BOGIE", "bog"],
    label: "Bogie Frame Rigid Body (mass_bogie)",
    category: "Bodies & Constraints",
    archetypeId: GensysArchetypeId.BODY_RIGID,
    description: "Two-axle passenger or freight bogie frame rigid body with roll, pitch, and yaw inertias.",
    provenance: "Manchester Benchmarks (Iwnicki 1998); EN 14363",
    params: [
      ["mass", 2615.0, "kg", "Bogie frame mass"],
      ["jx", 1722.0, "kg*m^2", "Bogie roll inertia Jxx"],
      ["jy", 1476.0, "kg*m^2", "Bogie pitch inertia Jyy"],
      ["jz", 3067.0, "kg*m^2", "Bogie yaw inertia Jzz"],
      ["g", 9.80665, "m/s^2", "Gravitational acceleration"],
    ],
  },
  {
    modelType: "mass_carbody",
    aliases: ["MASS_CARBODY", "car"],
    label: "Vehicle Carbody Rigid Body (mass_carbody)",
    category: "Bodies & Constraints",
    archetypeId: GensysArchetypeId.BODY_RIGID,
    description: "Passenger coach or locomotive carbody rigid body supported by secondary suspension.",
    provenance: "Manchester Benchmarks (Iwnicki 1998); EN 14363 / UIC 518",
    params: [
      ["mass", 32000.0, "kg", "Carbody mass"],
      ["jx", 56800.0, "kg*m^2", "Carbody roll inertia Jxx"],
      ["jy", 1.97e6, "kg*m^2", "Carbody pitch inertia Jyy"],
      ["jz", 1.97e6, "kg*m^2", "Carbody yaw inertia Jzz"],
      ["g", 9.80665, "m/s^2", "Gravitational acceleration"],
    ],
  },
  {
    modelType: "constr_fix",
    aliases: ["CONSTR_FIX", "fix_rigid"],
    label: "Fixed Kinematic Constraint (constr_fix)",
    category: "Bodies & Constraints",
    archetypeId: GensysArchetypeId.CONSTRAINT_KINEMATIC,
    description: "6-DOF rigid holonomic constraint locking relative translation and rotation between two frames.",
    provenance: "DEsolver GENSYS Public Element Reference (constr fix_rigid); Shabana (2008) Railroad Vehicle Dynamics",
    params: [
      ["k_pen", 1.0e9, "N/m", "Penalty constraint stiffness"],
      ["c_pen", 1.0e5, "N*s/m", "Penalty constraint damping"],
      ["dof_mask", 63.0, "-", "Bitmask of locked DOFs (1..63)"],
    ],
  },
  {
    modelType: "constr_rev",
    aliases: ["CONSTR_REV", "revolute"],
    label: "Revolute Pin Joint Constraint (constr_rev)",
    category: "Bodies & Constraints",
    archetypeId: GensysArchetypeId.CONSTRAINT_KINEMATIC,
    description: "Single-axis revolute joint constraining 5 DOFs (e.g., bogie center pivot or traction rod pin).",
    provenance: "DEsolver GENSYS Public Element Reference (constr); Shabana (2008) Railroad Vehicle Dynamics",
    params: [
      ["k_pen", 1.0e9, "N/m", "Translational penalty stiffness"],
      ["c_pen", 1.0e5, "N*s/m", "Translational penalty damping"],
      ["dof_mask", 31.0, "-", "Bitmask of locked DOFs (5 of 6 locked)"],
    ],
  },
];

/**
 * Converts `GENSYS_MODEL_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG icons and port layouts.
 */
export function buildGensysCleanroomSchemas(): CleanroomModelSchema[] {
  return GENSYS_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `gensys:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "mechanical",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "gensys_element",
      width: 88,
      height: 48,
      svg: generateGensysBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
