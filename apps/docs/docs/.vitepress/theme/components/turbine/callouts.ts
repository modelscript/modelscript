// SPDX-License-Identifier: AGPL-3.0-or-later

export interface CalloutSpec {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  readonly anchor: readonly [number, number, number];
  readonly x: number;
  readonly side: 1 | -1;
  readonly domain: string;
  readonly equation: string;
  readonly summary: string;
  readonly link: string;
  readonly linkLabel: string;
}

/** True structural facts & governing physics rendered as interactive callouts. */
export const CALLOUTS: readonly CalloutSpec[] = [
  {
    key: "fan",
    title: "Fan",
    detail: "22 blades",
    anchor: [-1.92, 0.95, 0.35],
    x: -1.92,
    side: -1,
    domain: "Low-Pressure Spool (N1) · Aeroacoustics & Bypass Flow",
    equation: "π_f = (1 + (γ - 1)/2 · M_rel²)^(γ/(γ - 1)) · η_poly",
    summary: "Wide-chord titanium fan stage modeled with 3D blade-row Euler maps and coupled N1 shaft inertia.",
    link: "/industries/aerospace",
    linkLabel: "Aerospace & Defense →",
  },
  {
    key: "hpc",
    title: "HP compressor",
    detail: "7 stages",
    anchor: [-0.3, 0.52, 0.0],
    x: -0.3,
    side: 1,
    domain: "High-Pressure Spool (N2) · Axial Compression & Surge Margin",
    equation: "dh₀ = ω · d(r · V_θ),   SM = (PR_stall - PR_op) / PR_op",
    summary: "7-stage axial compressor with variable stator vane schedules and real-time surge margin tracking.",
    link: "/languages/modelica",
    linkLabel: "Modelica Fluid & Thermal →",
  },
  {
    key: "combustor",
    title: "Combustor",
    detail: "annular",
    anchor: [0.75, 0.575, 0.0],
    x: 0.75,
    side: -1,
    domain: "Thermo-Chemistry · Annular Reacting Flow (Cantera / Modelica)",
    equation: "ṁ_air · h_3 + ṁ_f · LHV · η_b = (ṁ_air + ṁ_f) · h_4(T_04)",
    summary: "Low-NOx annular combustor coupling finite-rate chemical kinetics with liner thermal radiation.",
    link: "/industries/aerospace",
    linkLabel: "Propulsion Digital Thread →",
  },
  {
    key: "turbine",
    title: "Turbine",
    detail: "2 HP + 4 LP stages",
    anchor: [1.95, 0.64, 0.0],
    x: 1.62,
    side: 1,
    domain: "Cooled Superalloy Expansion · Coupled Rotor-Thermal FEA",
    equation: "τ_shaft · ω = ṁ_g · c_p · ΔT_0t,   ε_creep = A · σ^n · exp(-Q/RT)",
    summary: "2-stage cooled HPT and 4-stage LPT with film-cooling bleed networks and Larson-Miller creep envelopes.",
    link: "/languages/modelica",
    linkLabel: "Acausal DAE Lowering →",
  },
] as const;
