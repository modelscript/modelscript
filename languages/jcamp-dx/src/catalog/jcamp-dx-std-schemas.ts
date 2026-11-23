// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Cleanroom archetype IDs matching `assets/jcamp-dx-std-lib/src/models.ts`.
 */
export const JcampDxArchetypeId = {
  INFRARED_SPECTRUM: 1,
  NMR_SPECTRUM: 2,
  MASS_SPECTRUM: 3,
  UV_VIS_SPECTRUM: 4,
  RAMAN_SPECTRUM: 5,
  // Characteristic IR Functional-Group Absorption Bands
  IR_BAND_OH: 10,
  IR_BAND_CO_CARBONYL: 11,
  IR_BAND_CH_ALKANE: 12,
  IR_BAND_CC_ALKENE: 13,
  IR_BAND_CO_ETHER: 14,
} as const;

export type JcampDxArchetypeId = (typeof JcampDxArchetypeId)[keyof typeof JcampDxArchetypeId];

export type JcampDxModelCategory = "Spectroscopy Types" | "IR Functional Groups";

export interface IrFunctionalGroupBand {
  id: string;
  group: string;
  bond: string;
  mode: string;
  minCm1: number;
  maxCm1: number;
  centerCm1: number;
  widthCm1: number;
  typicalIntensity: "strong" | "medium" | "variable";
}

/**
 * IUPAC characteristic infrared functional-group absorption bands (cm^-1).
 */
export const IR_FUNCTIONAL_GROUP_BANDS: readonly IrFunctionalGroupBand[] = [
  {
    id: "IR_BAND_OH",
    group: "Hydroxyl (Alcohol / Phenol)",
    bond: "O-H",
    mode: "stretch (H-bonded, broad)",
    minCm1: 3200,
    maxCm1: 3600,
    centerCm1: 3380,
    widthCm1: 120,
    typicalIntensity: "strong",
  },
  {
    id: "IR_BAND_CH_ALKANE",
    group: "Alkane / Aliphatic",
    bond: "C-H",
    mode: "sp3 C-H stretch",
    minCm1: 2850,
    maxCm1: 2960,
    centerCm1: 2925,
    widthCm1: 35,
    typicalIntensity: "strong",
  },
  {
    id: "IR_BAND_CO_CARBONYL",
    group: "Carbonyl (Ketone / Ester / Carboxylic Acid)",
    bond: "C=O",
    mode: "stretch (sharp, intense)",
    minCm1: 1680,
    maxCm1: 1750,
    centerCm1: 1715,
    widthCm1: 18,
    typicalIntensity: "strong",
  },
  {
    id: "IR_BAND_CC_ALKENE",
    group: "Alkene / Conjugated Unsaturated",
    bond: "C=C",
    mode: "stretch",
    minCm1: 1620,
    maxCm1: 1680,
    centerCm1: 1650,
    widthCm1: 15,
    typicalIntensity: "medium",
  },
  {
    id: "IR_BAND_CO_ETHER",
    group: "Ether / Ester / Alcohol",
    bond: "C-O",
    mode: "stretch",
    minCm1: 1050,
    maxCm1: 1250,
    centerCm1: 1150,
    widthCm1: 30,
    typicalIntensity: "strong",
  },
];

/**
 * Matches a wavenumber (in `cm^-1`) against characteristic IR functional-group absorption bands.
 */
export function matchIrFunctionalGroup(wavenumberCm1: number): IrFunctionalGroupBand | undefined {
  for (const band of IR_FUNCTIONAL_GROUP_BANDS) {
    if (wavenumberCm1 >= band.minCm1 && wavenumberCm1 <= band.maxCm1) {
      return band;
    }
  }
  return undefined;
}

interface JcampDxModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: JcampDxModelCategory;
  archetypeId: JcampDxArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<JcampDxModelCategory, { fill: string; stroke: string; badge: string }> = {
  "Spectroscopy Types": { fill: "#1e293b", stroke: "#38bdf8", badge: "SPEC" },
  "IR Functional Groups": { fill: "#2e1065", stroke: "#c084fc", badge: "IR-FG" },
};

export function generateJcampDxBlockSvg(modelType: string, category: JcampDxModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 12);
  const fontSize = label.length > 9 ? "7.5" : "9.0";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 52" width="96" height="52">` +
    `<rect x="2" y="2" width="92" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="32" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="22" y="15" text-anchor="middle" font-family="monospace" font-size="7.0" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="48" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

const DEFAULT_PORTS: DiagramPortSpec[] = [
  { name: "x_in", kind: "signal", side: "left", dx: 0, dy: 26 },
  { name: "absorbance_out", kind: "signal", side: "right", dx: 96, dy: 18 },
  { name: "transmittance_out", kind: "signal", side: "right", dx: 96, dy: 34 },
];

const JCAMP_DX_SPECS: JcampDxModelSpec[] = [
  {
    modelType: "INFRARED_SPECTRUM",
    aliases: ["INFRARED SPECTRUM", "IR", "FTIR"],
    label: "Infrared Spectrum (JCAMP-DX 4.24)",
    category: "Spectroscopy Types",
    archetypeId: JcampDxArchetypeId.INFRARED_SPECTRUM,
    description: "Mid/Near-IR vibrational absorption or transmittance spectrum (4000–400 cm^-1).",
    provenance: "IUPAC JCAMP-DX 4.24 (McDonald & Wilks, 1988)",
    params: [
      ["FIRSTX", 4000, "1/CM", "Starting wavenumber"],
      ["LASTX", 400, "1/CM", "Ending wavenumber"],
      ["PATH_LENGTH", 0.01, "cm", "Optical path length"],
      ["CONCENTRATION", 0.1, "mol/L", "Sample concentration"],
    ],
  },
  {
    modelType: "NMR_SPECTRUM",
    aliases: ["NMR SPECTRUM", "1H NMR", "13C NMR"],
    label: "NMR Spectrum (JCAMP-DX 5.01)",
    category: "Spectroscopy Types",
    archetypeId: JcampDxArchetypeId.NMR_SPECTRUM,
    description: "Nuclear Magnetic Resonance chemical shift spectrum (ppm, descending axis).",
    provenance: "IUPAC JCAMP-DX 5.01 (Davies & Lampen, 1993)",
    params: [
      ["FIRSTX", 12, "PPM", "Downfield chemical shift limit"],
      ["LASTX", 0, "PPM", "Upfield TMS reference limit"],
      ["OBSERVE_FREQ", 400, "MHz", "Larmor observe frequency"],
      ["LINEWIDTH", 0.02, "PPM", "Lorentzian half-width at half-maximum"],
    ],
  },
  {
    modelType: "MASS_SPECTRUM",
    aliases: ["MASS SPECTRUM", "MS", "EI-MS"],
    label: "Mass Spectrum (JCAMP-DX 5.00)",
    category: "Spectroscopy Types",
    archetypeId: JcampDxArchetypeId.MASS_SPECTRUM,
    description: "Discrete mass-to-charge (m/z) ion abundance spectrum.",
    provenance: "IUPAC JCAMP-DX 5.00 (Lampen et al., 1994)",
    params: [
      ["FIRSTX", 10, "M/Z", "Minimum m/z"],
      ["LASTX", 500, "M/Z", "Maximum m/z"],
      ["BASE_PEAK_INTENSITY", 100, "%", "Normalized base peak intensity"],
    ],
  },
  {
    modelType: "UV_VIS_SPECTRUM",
    aliases: ["UV/VIS SPECTRUM", "UV-VIS", "ULTRAVIOLET SPECTRUM"],
    label: "UV/Vis Electronic Spectrum (JCAMP-DX 4.24)",
    category: "Spectroscopy Types",
    archetypeId: JcampDxArchetypeId.UV_VIS_SPECTRUM,
    description: "Ultraviolet-Visible electronic absorption spectrum (200–800 nm) obeying Beer-Lambert law.",
    provenance: "IUPAC JCAMP-DX 4.24",
    params: [
      ["FIRSTX", 200, "NANOMETERS", "Starting wavelength"],
      ["LASTX", 800, "NANOMETERS", "Ending wavelength"],
      ["EPSILON", 12000, "L/(mol*cm)", "Molar absorptivity"],
      ["PATH_LENGTH", 1.0, "cm", "Cuvette optical path length"],
    ],
  },
  {
    modelType: "RAMAN_SPECTRUM",
    aliases: ["RAMAN SPECTRUM", "RAMAN"],
    label: "Raman Scattering Spectrum (JCAMP-DX 4.24)",
    category: "Spectroscopy Types",
    archetypeId: JcampDxArchetypeId.RAMAN_SPECTRUM,
    description: "Inelastic Raman shift vibrational scattering spectrum (cm^-1).",
    provenance: "IUPAC JCAMP-DX 4.24",
    params: [
      ["FIRSTX", 100, "1/CM", "Minimum Raman shift"],
      ["LASTX", 3500, "1/CM", "Maximum Raman shift"],
      ["LASER_WAVELENGTH", 532, "nm", "Excitation laser wavelength"],
    ],
  },
  {
    modelType: "IR_BAND_OH",
    aliases: ["O-H", "HYDROXYL", "ALCOHOL_OH"],
    label: "IR O-H Stretch (3200–3600 cm^-1)",
    category: "IR Functional Groups",
    archetypeId: JcampDxArchetypeId.IR_BAND_OH,
    description: "Broad hydrogen-bonded O-H stretching absorption band characteristic of alcohols and phenols.",
    provenance: "IUPAC / Silverstein IR Correlation Table",
    params: [
      ["CENTER", 3380, "1/CM", "Band center wavenumber"],
      ["MIN_X", 3200, "1/CM", "Lower wavenumber bound"],
      ["MAX_X", 3600, "1/CM", "Upper wavenumber bound"],
      ["WIDTH", 120, "1/CM", "Gaussian/Lorentzian half-width"],
      ["AMPLITUDE", 0.85, "AU", "Peak absorbance amplitude"],
    ],
  },
  {
    modelType: "IR_BAND_CO_CARBONYL",
    aliases: ["C=O", "CARBONYL", "KETONE_CO"],
    label: "IR C=O Stretch (1680–1750 cm^-1)",
    category: "IR Functional Groups",
    archetypeId: JcampDxArchetypeId.IR_BAND_CO_CARBONYL,
    description: "Strong, sharp C=O carbonyl stretching band characteristic of ketones, aldehydes, esters, and acids.",
    provenance: "IUPAC / Silverstein IR Correlation Table",
    params: [
      ["CENTER", 1715, "1/CM", "Band center wavenumber"],
      ["MIN_X", 1680, "1/CM", "Lower wavenumber bound"],
      ["MAX_X", 1750, "1/CM", "Upper wavenumber bound"],
      ["WIDTH", 18, "1/CM", "Lorentzian half-width"],
      ["AMPLITUDE", 1.1, "AU", "Peak absorbance amplitude"],
    ],
  },
  {
    modelType: "IR_BAND_CH_ALKANE",
    aliases: ["C-H", "ALKANE_CH"],
    label: "IR C-H Stretch (2850–2960 cm^-1)",
    category: "IR Functional Groups",
    archetypeId: JcampDxArchetypeId.IR_BAND_CH_ALKANE,
    description: "Aliphatic sp3 C-H stretching band.",
    provenance: "IUPAC / Silverstein IR Correlation Table",
    params: [
      ["CENTER", 2925, "1/CM", "Band center wavenumber"],
      ["MIN_X", 2850, "1/CM", "Lower wavenumber bound"],
      ["MAX_X", 2960, "1/CM", "Upper wavenumber bound"],
      ["WIDTH", 35, "1/CM", "Half-width"],
      ["AMPLITUDE", 0.75, "AU", "Peak absorbance amplitude"],
    ],
  },
  {
    modelType: "IR_BAND_CC_ALKENE",
    aliases: ["C=C", "ALKENE_CC"],
    label: "IR C=C Stretch (1620–1680 cm^-1)",
    category: "IR Functional Groups",
    archetypeId: JcampDxArchetypeId.IR_BAND_CC_ALKENE,
    description: "Unsaturated alkene C=C stretching band.",
    provenance: "IUPAC / Silverstein IR Correlation Table",
    params: [
      ["CENTER", 1650, "1/CM", "Band center wavenumber"],
      ["MIN_X", 1620, "1/CM", "Lower wavenumber bound"],
      ["MAX_X", 1680, "1/CM", "Upper wavenumber bound"],
      ["WIDTH", 15, "1/CM", "Half-width"],
      ["AMPLITUDE", 0.45, "AU", "Peak absorbance amplitude"],
    ],
  },
  {
    modelType: "IR_BAND_CO_ETHER",
    aliases: ["C-O", "ETHER_CO"],
    label: "IR C-O Stretch (1050–1250 cm^-1)",
    category: "IR Functional Groups",
    archetypeId: JcampDxArchetypeId.IR_BAND_CO_ETHER,
    description: "Strong C-O single-bond stretching band in ethers, esters, and alcohols.",
    provenance: "IUPAC / Silverstein IR Correlation Table",
    params: [
      ["CENTER", 1150, "1/CM", "Band center wavenumber"],
      ["MIN_X", 1050, "1/CM", "Lower wavenumber bound"],
      ["MAX_X", 1250, "1/CM", "Upper wavenumber bound"],
      ["WIDTH", 30, "1/CM", "Half-width"],
      ["AMPLITUDE", 0.8, "AU", "Peak absorbance amplitude"],
    ],
  },
];

/**
 * Builds the declarative cleanroom standard library schemas for `@modelscript/jcamp-dx-std-lib`.
 */
export function buildJcampDxCleanroomSchemas(): CleanroomModelSchema[] {
  return JCAMP_DX_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      ...(unit !== undefined ? { unit } : {}),
      ...(description !== undefined ? { description } : {}),
    }));

    return {
      namePath: `JCAMP.${spec.modelType}`,
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
      svg: generateJcampDxBlockSvg(spec.modelType, spec.category),
      ports: DEFAULT_PORTS,
      parameters,
      wasmKernel: "jcampDxEvalBand",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}
