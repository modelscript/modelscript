// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Gaussian cleanroom quantum chemistry method and basis set archetype IDs
 * matching `assets/gaussian-std-lib/src/models.ts`.
 */
export const GaussianArchetypeId = {
  // Quantum Chemistry Methods (Wavefunction & DFT)
  HF: 1,
  MP2: 2,
  CCSD_T: 3,
  B3LYP: 4,
  PBE0: 5,
  M06_2X: 6,
  // Gaussian Basis Sets (Pople & Dunning)
  STO_3G: 101,
  BASIS_3_21G: 102,
  BASIS_6_31G_D: 103,
  BASIS_6_311PP_G_DP: 104,
  CC_PVDZ: 105,
  CC_PVTZ: 106,
} as const;

export type GaussianArchetypeId = (typeof GaussianArchetypeId)[keyof typeof GaussianArchetypeId];

export type GaussianModelCategory =
  "Wavefunction Method" | "Density Functional" | "Pople Basis Set" | "Correlation-Consistent Basis Set";

export interface GaussianModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: GaussianModelCategory;
  archetypeId: GaussianArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<GaussianModelCategory, { fill: string; stroke: string; badge: string }> = {
  "Wavefunction Method": { fill: "#1e293b", stroke: "#38bdf8", badge: "WFT" },
  "Density Functional": { fill: "#1e3a2f", stroke: "#34d399", badge: "DFT" },
  "Pople Basis Set": { fill: "#3b1d4a", stroke: "#c084fc", badge: "POPLE" },
  "Correlation-Consistent Basis Set": { fill: "#4a2511", stroke: "#fb923c", badge: "DUNN" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for a Gaussian method or basis set.
 */
export function generateGaussianBlockSvg(modelType: string, category: GaussianModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 12);
  const fontSize = label.length > 9 ? "7.6" : label.length > 7 ? "8.5" : "9.5";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 52" width="96" height="52">` +
    `<rect x="2" y="2" width="92" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="32" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="22" y="15" text-anchor="middle" font-family="monospace" font-size="7.0" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="48" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForSpec(spec: GaussianModelSpec): DiagramPortSpec[] {
  if (spec.category === "Wavefunction Method" || spec.category === "Density Functional") {
    return [
      { name: "geometry_in", kind: "signal", side: "left", dx: 0, dy: 16 },
      { name: "basis_in", kind: "signal", side: "left", dx: 0, dy: 36 },
      { name: "energy_out", kind: "signal", side: "right", dx: 96, dy: 16 },
      { name: "hessian_out", kind: "signal", side: "right", dx: 96, dy: 36 },
    ];
  }
  return [
    { name: "atoms_in", kind: "signal", side: "left", dx: 0, dy: 26 },
    { name: "basis_out", kind: "signal", side: "right", dx: 96, dy: 26 },
  ];
}

/**
 * Cleanroom catalog of standard quantum chemistry methods and Gaussian-type orbital (GTO) basis sets.
 */
export const GAUSSIAN_MODEL_SPECS: ReadonlyArray<GaussianModelSpec> = [
  // --- Wavefunction Methods ---
  {
    modelType: "HF",
    aliases: ["RHF", "UHF", "ROHF", "Hartree-Fock"],
    label: "Hartree-Fock (HF)",
    category: "Wavefunction Method",
    archetypeId: GaussianArchetypeId.HF,
    description: "Self-consistent field mean-field wavefunction theory (no dynamic electron correlation).",
    provenance: "Roothaan (1951), Rev. Mod. Phys. 23, 69; Pople & Nesbet (1954), J. Chem. Phys. 22, 571",
    params: [
      ["scalingOrder", 4.0, "N^k", "Formal computational scaling exponent with basis size N"],
      ["hfExchangeFrac", 1.0, "1", "Fraction of exact Hartree-Fock exchange"],
      ["zpeScaleFactor", 0.8953, "1", "Harmonic frequency / ZPE empirical scale factor"],
      ["correlationOrder", 0.0, "1", "Perturbative/coupled-cluster correlation level"],
    ],
  },
  {
    modelType: "MP2",
    aliases: ["RMP2", "UMP2", "Moller-Plesset-2"],
    label: "Møller-Plesset 2nd Order (MP2)",
    category: "Wavefunction Method",
    archetypeId: GaussianArchetypeId.MP2,
    description: "Second-order Møller-Plesset perturbation theory capturing dynamic pair correlation.",
    provenance: "Møller & Plesset (1934), Phys. Rev. 46, 618; Head-Gordon et al. (1988), Chem. Phys. Lett. 153, 503",
    params: [
      ["scalingOrder", 5.0, "N^k", "Formal computational scaling exponent with basis size N"],
      ["hfExchangeFrac", 1.0, "1", "Reference exact Hartree-Fock exchange fraction"],
      ["zpeScaleFactor", 0.967, "1", "Harmonic frequency / ZPE empirical scale factor"],
      ["correlationOrder", 2.0, "1", "Second-order perturbation theory"],
    ],
  },
  {
    modelType: "CCSD(T)",
    aliases: ["CCSDT", "CCSD-T"],
    label: "Coupled Cluster Singles, Doubles & Perturbative Triples (CCSD(T))",
    category: "Wavefunction Method",
    archetypeId: GaussianArchetypeId.CCSD_T,
    description: "Gold-standard coupled-cluster wavefunction method with perturbative triple excitations.",
    provenance: "Raghavachari, Trucks, Pople & Head-Gordon (1989), Chem. Phys. Lett. 157, 479",
    params: [
      ["scalingOrder", 7.0, "N^k", "Formal computational scaling exponent O(N^7)"],
      ["hfExchangeFrac", 1.0, "1", "Reference exact Hartree-Fock exchange fraction"],
      ["zpeScaleFactor", 0.975, "1", "Harmonic frequency / ZPE empirical scale factor"],
      ["correlationOrder", 3.0, "1", "Singles, doubles, and perturbative triples"],
    ],
  },
  // --- Density Functionals ---
  {
    modelType: "B3LYP",
    aliases: ["RB3LYP", "UB3LYP"],
    label: "Becke 3-Parameter Lee-Yang-Parr (B3LYP)",
    category: "Density Functional",
    archetypeId: GaussianArchetypeId.B3LYP,
    description: "Hybrid GGA density functional combining 20% exact HF exchange with Becke88 and LYP correlation.",
    provenance: "Becke (1993), J. Chem. Phys. 98, 5648; Stephens et al. (1994), J. Phys. Chem. 98, 11623",
    params: [
      ["scalingOrder", 3.0, "N^k", "Effective computational scaling exponent O(N^3)"],
      ["hfExchangeFrac", 0.2, "1", "20% exact Hartree-Fock exchange"],
      ["zpeScaleFactor", 0.9614, "1", "Harmonic frequency / ZPE empirical scale factor (6-31G(d))"],
      ["correlationOrder", 1.0, "1", "Hybrid GGA DFT correlation"],
    ],
  },
  {
    modelType: "PBE0",
    aliases: ["PBE1PBE", "PBEh"],
    label: "Perdew-Burke-Ernzerhof Hybrid (PBE0)",
    category: "Density Functional",
    archetypeId: GaussianArchetypeId.PBE0,
    description: "Parameter-free hybrid GGA functional mixing 25% exact HF exchange with 75% PBE exchange.",
    provenance: "Adamo & Barone (1999), J. Chem. Phys. 110, 6158; Perdew, Ernzerhof & Burke (1996)",
    params: [
      ["scalingOrder", 3.0, "N^k", "Effective computational scaling exponent O(N^3)"],
      ["hfExchangeFrac", 0.25, "1", "25% exact Hartree-Fock exchange"],
      ["zpeScaleFactor", 0.9512, "1", "Harmonic frequency / ZPE empirical scale factor"],
      ["correlationOrder", 1.0, "1", "Hybrid GGA DFT correlation"],
    ],
  },
  {
    modelType: "M06-2X",
    aliases: ["M062X", "M06_2X"],
    label: "Minnesota 06 Global Hybrid Meta-GGA (M06-2X)",
    category: "Density Functional",
    archetypeId: GaussianArchetypeId.M06_2X,
    description: "High-nonlocality hybrid meta-GGA functional with 54% HF exchange for main-group thermochemistry.",
    provenance: "Zhao & Truhlar (2008), Theor. Chem. Acc. 120, 215",
    params: [
      ["scalingOrder", 3.0, "N^k", "Effective computational scaling exponent O(N^3)"],
      ["hfExchangeFrac", 0.54, "1", "54% exact Hartree-Fock exchange"],
      ["zpeScaleFactor", 0.947, "1", "Harmonic frequency / ZPE empirical scale factor"],
      ["correlationOrder", 1.5, "1", "Hybrid meta-GGA DFT correlation"],
    ],
  },
  // --- Pople Basis Sets ---
  {
    modelType: "STO-3G",
    aliases: ["STO3G"],
    label: "Minimal Slater-Type Orbital 3-Gaussian (STO-3G)",
    category: "Pople Basis Set",
    archetypeId: GaussianArchetypeId.STO_3G,
    description: "Minimal basis set contracting 3 primitive Gaussians per Slater-type orbital.",
    provenance: "Hehre, Stewart & Pople (1969), J. Chem. Phys. 51, 2657",
    params: [
      ["zeta", 1.0, "1", "Minimal (single-zeta) valence representation"],
      ["bfPerH", 1.0, "1", "Contracted basis functions per Hydrogen atom"],
      ["bfPerSecondRow", 5.0, "1", "Contracted basis functions per C/N/O/F atom (1s, 2s, 2p)"],
      ["hasPolarization", 0.0, "bool", "Polarization functions present (0=no, 1=yes)"],
      ["hasDiffuse", 0.0, "bool", "Diffuse functions present (0=no, 1=yes)"],
    ],
  },
  {
    modelType: "3-21G",
    aliases: ["321G"],
    label: "Pople Split-Valence 3-21G",
    category: "Pople Basis Set",
    archetypeId: GaussianArchetypeId.BASIS_3_21G,
    description: "Split-valence double-zeta Pople basis set with 3 core primitives and 2+1 valence primitives.",
    provenance: "Binkley, Pople & Hehre (1980), J. Am. Chem. Soc. 102, 939",
    params: [
      ["zeta", 2.0, "1", "Double-zeta split valence"],
      ["bfPerH", 2.0, "1", "Contracted basis functions per Hydrogen atom"],
      ["bfPerSecondRow", 9.0, "1", "Contracted basis functions per C/N/O/F atom"],
      ["hasPolarization", 0.0, "bool", "Polarization functions present"],
      ["hasDiffuse", 0.0, "bool", "Diffuse functions present"],
    ],
  },
  {
    modelType: "6-31G(d)",
    aliases: ["6-31G*", "6-31Gd"],
    label: "Pople Polarized Split-Valence 6-31G(d)",
    category: "Pople Basis Set",
    archetypeId: GaussianArchetypeId.BASIS_6_31G_D,
    description: "Workhorse split-valence basis set with d-type polarization functions on heavy atoms.",
    provenance: "Hariharan & Pople (1973), Theor. Chim. Acta 28, 213",
    params: [
      ["zeta", 2.0, "1", "Double-zeta split valence"],
      ["bfPerH", 2.0, "1", "Contracted basis functions per Hydrogen atom"],
      ["bfPerSecondRow", 15.0, "1", "Contracted basis functions per C/N/O/F atom (6D Cartesian)"],
      ["hasPolarization", 1.0, "bool", "d polarization on heavy atoms"],
      ["hasDiffuse", 0.0, "bool", "Diffuse functions present"],
    ],
  },
  {
    modelType: "6-311++G(d,p)",
    aliases: ["6-311++G**"],
    label: "Pople Triple-Zeta Diffuse & Polarized 6-311++G(d,p)",
    category: "Pople Basis Set",
    archetypeId: GaussianArchetypeId.BASIS_6_311PP_G_DP,
    description: "Triple-zeta split-valence basis set with diffuse and polarization functions on all atoms.",
    provenance: "Krishnan et al. (1980), J. Chem. Phys. 72, 650; Clark et al. (1983), J. Comput. Chem. 4, 294",
    params: [
      ["zeta", 3.0, "1", "Triple-zeta split valence"],
      ["bfPerH", 7.0, "1", "Contracted basis functions per Hydrogen atom (3s+1s_diff+3p)"],
      ["bfPerSecondRow", 22.0, "1", "Contracted basis functions per C/N/O/F atom"],
      ["hasPolarization", 1.0, "bool", "d on heavy atoms, p on hydrogen"],
      ["hasDiffuse", 1.0, "bool", "Diffuse sp on heavy atoms, s on hydrogen"],
    ],
  },
  // --- Dunning Correlation-Consistent Basis Sets ---
  {
    modelType: "cc-pVDZ",
    aliases: ["cc-pVDZ", "ccpvdz"],
    label: "Dunning Correlation-Consistent Polarized Valence Double-Zeta (cc-pVDZ)",
    category: "Correlation-Consistent Basis Set",
    archetypeId: GaussianArchetypeId.CC_PVDZ,
    description: "Dunning correlation-consistent polarized double-zeta basis set designed for post-HF methods.",
    provenance: "Dunning (1989), J. Chem. Phys. 90, 1007",
    params: [
      ["zeta", 2.0, "1", "Double-zeta correlation-consistent"],
      ["bfPerH", 5.0, "1", "Contracted spherical basis functions per Hydrogen atom (2s1p)"],
      ["bfPerSecondRow", 14.0, "1", "Contracted spherical basis functions per C/N/O/F atom (3s2p1d)"],
      ["hasPolarization", 1.0, "bool", "Polarization functions on all atoms"],
      ["hasDiffuse", 0.0, "bool", "No augmentation diffuse shells"],
    ],
  },
  {
    modelType: "cc-pVTZ",
    aliases: ["cc-pVTZ", "ccpvtz"],
    label: "Dunning Correlation-Consistent Polarized Valence Triple-Zeta (cc-pVTZ)",
    category: "Correlation-Consistent Basis Set",
    archetypeId: GaussianArchetypeId.CC_PVTZ,
    description: "Dunning correlation-consistent polarized triple-zeta basis set for accurate energies & geometries.",
    provenance: "Dunning (1989), J. Chem. Phys. 90, 1007",
    params: [
      ["zeta", 3.0, "1", "Triple-zeta correlation-consistent"],
      ["bfPerH", 14.0, "1", "Contracted spherical basis functions per Hydrogen atom (3s2p1d)"],
      ["bfPerSecondRow", 30.0, "1", "Contracted spherical basis functions per C/N/O/F atom (4s3p2d1f)"],
      ["hasPolarization", 1.0, "bool", "Polarization functions through f on heavy atoms"],
      ["hasDiffuse", 0.0, "bool", "No augmentation diffuse shells"],
    ],
  },
];

/**
 * Builds the full `CleanroomModelSchema[]` array for `@modelscript/gaussian-std-lib`.
 */
export function buildGaussianCleanroomSchemas(): CleanroomModelSchema[] {
  return GAUSSIAN_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));

    return {
      namePath: `Gaussian.${spec.category.replace(/[^A-Za-z0-9]+/g, "")}.${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "chemistry",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Class",
      width: 96,
      height: 52,
      svg: generateGaussianBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForSpec(spec),
      parameters,
      wasmKernel: "gaussianModelEval",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}
