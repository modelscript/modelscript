// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mcnp — Cleanroom ENDF-like Isotopic Cross-Section & MCNP Archetype Schemas.
 */

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

export const McnpArchetypeId = {
  // Isotopic Cross-Sections (ZAIDs)
  ISO_H1: 1001,
  ISO_B10: 5010,
  ISO_C12: 6012,
  ISO_O16: 8016,
  ISO_FE56: 26056,
  ISO_U235: 92235,
  ISO_U238: 92238,
  ISO_PU239: 94239,
  // Surface Primitives
  SURF_SO: 101,
  SURF_SPH: 102,
  SURF_RPP: 103,
  SURF_RCC: 104,
  SURF_PLANE: 105,
  SURF_CYL: 106,
  // Tallies
  TALLY_F1: 201,
  TALLY_F2: 202,
  TALLY_F4: 204,
  TALLY_F5: 205,
  TALLY_F6: 206,
  TALLY_F8: 208,
} as const;

export type McnpArchetypeId = (typeof McnpArchetypeId)[keyof typeof McnpArchetypeId];

export type McnpCatalogCategory = "Isotope" | "Surface" | "Tally";

export interface IsotopeCrossSectionData {
  zaid: number;
  symbol: string;
  name: string;
  atomicMass: number;
  /** Fast 1-group microscopic cross-sections (barns). */
  fast: {
    sigmaS: number;
    sigmaC: number;
    sigmaF: number;
    sigmaT: number;
    nu: number;
    /** Fast-to-thermal downscatter cross-section (barns). */
    sigma12: number;
  };
  /** Thermal group microscopic cross-sections (barns, 0.0253 eV). */
  thermal: {
    sigmaS: number;
    sigmaC: number;
    sigmaF: number;
    sigmaT: number;
    nu: number;
  };
  provenance: string;
}

/**
 * Cleanroom ENDF/B-like 1-group (fast fission spectrum) and 2-group (fast + thermal)
 * microscopic neutron cross-sections (barns).
 *
 * Fast U-235 parameters match the classic LANL Godiva bare-sphere benchmark
 * (R = 8.741 cm, rho = 18.74 g/cm^3 -> k_eff ~ 1.000).
 */
export const CLEANROOM_ISOTOPE_LIBRARY: ReadonlyMap<number, IsotopeCrossSectionData> = new Map<
  number,
  IsotopeCrossSectionData
>([
  [
    1001,
    {
      zaid: 1001,
      symbol: "H-1",
      name: "Hydrogen-1 (Protium)",
      atomicMass: 1.00784,
      fast: { sigmaS: 3.85, sigmaC: 0.00004, sigmaF: 0.0, sigmaT: 3.85004, nu: 0.0, sigma12: 1.45 },
      thermal: { sigmaS: 20.49, sigmaC: 0.3326, sigmaF: 0.0, sigmaT: 20.8226, nu: 0.0 },
      provenance: "Cleanroom ENDF/B-VIII.0 / Lamarsh Standard",
    },
  ],
  [
    5010,
    {
      zaid: 5010,
      symbol: "B-10",
      name: "Boron-10 (Neutron Absorber)",
      atomicMass: 10.0129,
      fast: { sigmaS: 2.2, sigmaC: 0.55, sigmaF: 0.0, sigmaT: 2.75, nu: 0.0, sigma12: 0.25 },
      thermal: { sigmaS: 2.23, sigmaC: 3837.0, sigmaF: 0.0, sigmaT: 3839.23, nu: 0.0 },
      provenance: "Cleanroom ENDF/B-VIII.0 / Lamarsh Standard",
    },
  ],
  [
    6012,
    {
      zaid: 6012,
      symbol: "C-12",
      name: "Carbon-12 (Graphite Moderator)",
      atomicMass: 12.011,
      fast: { sigmaS: 2.4, sigmaC: 0.0002, sigmaF: 0.0, sigmaT: 2.4002, nu: 0.0, sigma12: 0.22 },
      thermal: { sigmaS: 4.74, sigmaC: 0.0035, sigmaF: 0.0, sigmaT: 4.7435, nu: 0.0 },
      provenance: "Cleanroom ENDF/B-VIII.0 / Lamarsh Standard",
    },
  ],
  [
    8016,
    {
      zaid: 8016,
      symbol: "O-16",
      name: "Oxygen-16",
      atomicMass: 15.999,
      fast: { sigmaS: 2.9, sigmaC: 0.0001, sigmaF: 0.0, sigmaT: 2.9001, nu: 0.0, sigma12: 0.16 },
      thermal: { sigmaS: 3.76, sigmaC: 0.00019, sigmaF: 0.0, sigmaT: 3.76019, nu: 0.0 },
      provenance: "Cleanroom ENDF/B-VIII.0 / Lamarsh Standard",
    },
  ],
  [
    26056,
    {
      zaid: 26056,
      symbol: "Fe-56",
      name: "Iron-56 (Structural Shielding)",
      atomicMass: 55.9349,
      fast: { sigmaS: 2.85, sigmaC: 0.006, sigmaF: 0.0, sigmaT: 2.856, nu: 0.0, sigma12: 0.04 },
      thermal: { sigmaS: 11.44, sigmaC: 2.59, sigmaF: 0.0, sigmaT: 14.03, nu: 0.0 },
      provenance: "Cleanroom ENDF/B-VIII.0 / Lamarsh Standard",
    },
  ],
  [
    92235,
    {
      zaid: 92235,
      symbol: "U-235",
      name: "Uranium-235 (Fissile)",
      atomicMass: 235.0439,
      fast: { sigmaS: 4.566, sigmaC: 0.098, sigmaF: 1.235, sigmaT: 5.899, nu: 2.58, sigma12: 0.02 },
      thermal: { sigmaS: 15.0, sigmaC: 98.7, sigmaF: 585.0, sigmaT: 698.7, nu: 2.43 },
      provenance: "Cleanroom ENDF/B-VIII.0 / LANL Godiva LA-10860",
    },
  ],
  [
    92238,
    {
      zaid: 92238,
      symbol: "U-238",
      name: "Uranium-238 (Fertile)",
      atomicMass: 238.0508,
      fast: { sigmaS: 4.85, sigmaC: 0.12, sigmaF: 0.05, sigmaT: 5.02, nu: 2.75, sigma12: 0.02 },
      thermal: { sigmaS: 9.36, sigmaC: 2.68, sigmaF: 0.0, sigmaT: 12.04, nu: 0.0 },
      provenance: "Cleanroom ENDF/B-VIII.0 / Lamarsh Standard",
    },
  ],
  [
    94239,
    {
      zaid: 94239,
      symbol: "Pu-239",
      name: "Plutonium-239 (Fissile)",
      atomicMass: 239.0522,
      fast: { sigmaS: 4.55, sigmaC: 0.08, sigmaF: 1.8, sigmaT: 6.43, nu: 3.16, sigma12: 0.02 },
      thermal: { sigmaS: 8.0, sigmaC: 271.0, sigmaF: 747.0, sigmaT: 1026.0, nu: 2.88 },
      provenance: "Cleanroom ENDF/B-VIII.0 / LANL Jezebel LA-10860",
    },
  ],
]);

const CATEGORY_COLORS: Record<McnpCatalogCategory, { fill: string; stroke: string; badge: string }> = {
  Isotope: { fill: "#1e3a5f", stroke: "#38bdf8", badge: "ZAID" },
  Surface: { fill: "#2e2447", stroke: "#a78bfa", badge: "SURF" },
  Tally: { fill: "#1e3f2f", stroke: "#34d399", badge: "TALY" },
};

export function generateMcnpBlockSvg(label: string, category: McnpCatalogCategory): string {
  const c = CATEGORY_COLORS[category];
  const shortLabel = label.toUpperCase().slice(0, 10);
  const fontSize = shortLabel.length > 8 ? "8.2" : "9.5";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">` +
    `<rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="28" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="20" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${shortLabel}</text>` +
    `</svg>`
  );
}

function defaultPorts(category: McnpCatalogCategory): DiagramPortSpec[] {
  if (category === "Isotope") {
    return [
      { name: "flux_in", kind: "signal", side: "left", dx: 0, dy: 26 },
      { name: "xs_out", kind: "signal", side: "right", dx: 88, dy: 26 },
    ];
  }
  if (category === "Surface") {
    return [
      { name: "inside", kind: "signal", side: "left", dx: 0, dy: 26 },
      { name: "outside", kind: "signal", side: "right", dx: 88, dy: 26 },
    ];
  }
  return [{ name: "score_in", kind: "signal", side: "left", dx: 0, dy: 26 }];
}

function toParams(
  entries: Array<[key: string, defaultValue: number, unit?: string, description?: string]>,
): CleanroomParameterSchema[] {
  return entries.map(([key, defaultValue, unit, description]) => ({
    key,
    type: "real" as const,
    defaultValue,
    unit,
    description,
  }));
}

/**
 * Builds all declarative cleanroom schemas for `@modelscript/mcnp-std-lib`:
 * 8 ENDF-like isotopes + 6 surface archetypes + 6 tally archetypes = 20 schemas.
 */
export function buildMcnpCleanroomSchemas(): CleanroomModelSchema[] {
  const schemas: CleanroomModelSchema[] = [];

  for (const iso of CLEANROOM_ISOTOPE_LIBRARY.values()) {
    schemas.push({
      namePath: `MCNP.Isotopes.${iso.zaid}`,
      name: String(iso.zaid),
      aliases: [iso.symbol, `${iso.zaid}.80c`, `${iso.zaid}.70c`],
      label: `${iso.symbol} (${iso.zaid})`,
      category: "Isotope",
      domain: "nuclear",
      description: `${iso.name} cleanroom 1-group/2-group neutron cross-sections.`,
      provenance: iso.provenance,
      symbolKind: "Constant",
      width: 88,
      height: 52,
      svg: generateMcnpBlockSvg(iso.symbol, "Isotope"),
      ports: defaultPorts("Isotope"),
      parameters: toParams([
        ["atomicMass", iso.atomicMass, "amu", "Atomic mass"],
        ["sigmaS_fast", iso.fast.sigmaS, "b", "Fast scattering cross-section"],
        ["sigmaC_fast", iso.fast.sigmaC, "b", "Fast capture cross-section"],
        ["sigmaF_fast", iso.fast.sigmaF, "b", "Fast fission cross-section"],
        ["sigmaT_fast", iso.fast.sigmaT, "b", "Fast total cross-section"],
        ["nu_fast", iso.fast.nu, "1", "Fast neutrons per fission"],
        ["sigmaS_th", iso.thermal.sigmaS, "b", "Thermal scattering cross-section"],
        ["sigmaC_th", iso.thermal.sigmaC, "b", "Thermal capture cross-section"],
        ["sigmaF_th", iso.thermal.sigmaF, "b", "Thermal fission cross-section"],
      ]),
      wasmKernel: "mcnpEvalMacroscopicXs",
      extra: { archetypeId: iso.zaid },
    });
  }

  const surfaceDefs: Array<{
    name: string;
    aliases: string[];
    label: string;
    archetypeId: McnpArchetypeId;
    desc: string;
    params: Array<[string, number, string?, string?]>;
  }> = [
    {
      name: "SO",
      aliases: ["SphereOrigin"],
      label: "Sphere at Origin (SO)",
      archetypeId: McnpArchetypeId.SURF_SO,
      desc: "Sphere centered at origin: x^2 + y^2 + z^2 - R^2 = 0.",
      params: [["R", 10.0, "cm", "Sphere radius"]],
    },
    {
      name: "SPH",
      aliases: ["S", "Sphere"],
      label: "Sphere Macrobody (SPH)",
      archetypeId: McnpArchetypeId.SURF_SPH,
      desc: "Sphere centered at (vx, vy, vz) with radius R.",
      params: [
        ["vx", 0.0, "cm", "Center X"],
        ["vy", 0.0, "cm", "Center Y"],
        ["vz", 0.0, "cm", "Center Z"],
        ["R", 10.0, "cm", "Radius"],
      ],
    },
    {
      name: "RPP",
      aliases: ["Box"],
      label: "Rectangular Parallelepiped (RPP)",
      archetypeId: McnpArchetypeId.SURF_RPP,
      desc: "Axis-aligned box [xmin, xmax] x [ymin, ymax] x [zmin, zmax].",
      params: [
        ["xmin", -5.0, "cm"],
        ["xmax", 5.0, "cm"],
        ["ymin", -5.0, "cm"],
        ["ymax", 5.0, "cm"],
        ["zmin", -5.0, "cm"],
        ["zmax", 5.0, "cm"],
      ],
    },
    {
      name: "RCC",
      aliases: ["RightCircularCylinder"],
      label: "Right Circular Cylinder (RCC)",
      archetypeId: McnpArchetypeId.SURF_RCC,
      desc: "Finite cylinder from base (vx,vy,vz) along (hx,hy,hz) with radius R.",
      params: [
        ["vx", 0.0, "cm"],
        ["vy", 0.0, "cm"],
        ["vz", 0.0, "cm"],
        ["hx", 0.0, "cm"],
        ["hy", 0.0, "cm"],
        ["hz", 10.0, "cm"],
        ["R", 5.0, "cm"],
      ],
    },
    {
      name: "PX",
      aliases: ["PY", "PZ", "P"],
      label: "Axis-Aligned Plane (PX/PY/PZ)",
      archetypeId: McnpArchetypeId.SURF_PLANE,
      desc: "Plane normal to coordinate axis: x - D = 0.",
      params: [["D", 0.0, "cm", "Axis intercept"]],
    },
    {
      name: "CZ",
      aliases: ["CX", "CY", "C/X", "C/Y", "C/Z"],
      label: "Infinite Cylinder (CX/CY/CZ)",
      archetypeId: McnpArchetypeId.SURF_CYL,
      desc: "Infinite cylinder parallel to axis with radius R.",
      params: [["R", 5.0, "cm", "Cylinder radius"]],
    },
  ];

  for (const s of surfaceDefs) {
    schemas.push({
      namePath: `MCNP.Surfaces.${s.name}`,
      name: s.name,
      aliases: s.aliases,
      label: s.label,
      category: "Surface",
      domain: "nuclear",
      description: s.desc,
      provenance: "LANL MCNP6 User Manual (LA-UR-17-29981)",
      symbolKind: "Class",
      width: 88,
      height: 52,
      svg: generateMcnpBlockSvg(s.name, "Surface"),
      ports: defaultPorts("Surface"),
      parameters: toParams(s.params),
      extra: { archetypeId: s.archetypeId },
    });
  }

  const tallyDefs: Array<{
    name: string;
    label: string;
    archetypeId: McnpArchetypeId;
    desc: string;
    unit: string;
  }> = [
    {
      name: "F1",
      label: "Surface Current Tally (F1)",
      archetypeId: McnpArchetypeId.TALLY_F1,
      desc: "Current integrated over a surface (particles).",
      unit: "particles",
    },
    {
      name: "F2",
      label: "Surface Flux Tally (F2)",
      archetypeId: McnpArchetypeId.TALLY_F2,
      desc: "Flux averaged over a surface (particles/cm^2).",
      unit: "1/cm^2",
    },
    {
      name: "F4",
      label: "Cell Flux Tally (F4)",
      archetypeId: McnpArchetypeId.TALLY_F4,
      desc: "Track-length estimate of flux averaged over a cell (particles/cm^2).",
      unit: "1/cm^2",
    },
    {
      name: "F5",
      label: "Point Detector Flux Tally (F5)",
      archetypeId: McnpArchetypeId.TALLY_F5,
      desc: "Next-event flux estimator at a point or ring detector (particles/cm^2).",
      unit: "1/cm^2",
    },
    {
      name: "F6",
      label: "Energy Deposition Tally (F6)",
      archetypeId: McnpArchetypeId.TALLY_F6,
      desc: "Track-length heating / energy deposition averaged over a cell (MeV/g).",
      unit: "MeV/g",
    },
    {
      name: "F8",
      label: "Pulse Height Tally (F8)",
      archetypeId: McnpArchetypeId.TALLY_F8,
      desc: "Energy distribution of pulses created in a detector cell.",
      unit: "pulses",
    },
  ];

  for (const t of tallyDefs) {
    schemas.push({
      namePath: `MCNP.Tallies.${t.name}`,
      name: t.name,
      aliases: [`${t.name}:N`, `${t.name}:P`],
      label: t.label,
      category: "Tally",
      domain: "nuclear",
      description: t.desc,
      provenance: "LANL MCNP6 User Manual (LA-UR-17-29981)",
      symbolKind: "Function",
      width: 88,
      height: 52,
      svg: generateMcnpBlockSvg(t.name, "Tally"),
      ports: defaultPorts("Tally"),
      parameters: toParams([["normFactor", 1.0, t.unit, "Tally multiplier"]]),
      extra: { archetypeId: t.archetypeId },
    });
  }

  return schemas;
}
