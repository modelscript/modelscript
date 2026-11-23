// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/endf6 — Cleanroom ENDF-6 MF/MT Reaction Schemas & Reference Nuclides.
 *
 * Includes ENDF-6 MF/MT schemas (`MT=1` Total, `MT=2` Elastic, `MT=18` Fission,
 * `MT=102` Radiative Capture, `MT=451` Descriptive Data, `MT=457` Radioactive Decay)
 * and cleanroom reference nuclides (`H-1`, `B-10`, `U-235`, `U-238`, `Pu-239`).
 */

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

export interface Endf6MtDescriptor {
  mt: number;
  mf: number;
  name: string;
  symbol: string;
  description: string;
  color: string;
}

export const ENDF6_MT_DESCRIPTORS: ReadonlyMap<number, Endf6MtDescriptor> = new Map<number, Endf6MtDescriptor>([
  [
    1,
    {
      mt: 1,
      mf: 3,
      name: "Total",
      symbol: "sigma_t",
      description: "Neutron total cross-section (sum of all partial reaction cross-sections).",
      color: "#60a5fa",
    },
  ],
  [
    2,
    {
      mt: 2,
      mf: 3,
      name: "Elastic",
      symbol: "sigma_s",
      description: "Neutron elastic scattering cross-section (n, n).",
      color: "#34d399",
    },
  ],
  [
    18,
    {
      mt: 18,
      mf: 3,
      name: "Fission",
      symbol: "sigma_f",
      description: "Neutron-induced total fission cross-section (n, f).",
      color: "#f43f5e",
    },
  ],
  [
    102,
    {
      mt: 102,
      mf: 3,
      name: "Radiative Capture",
      symbol: "sigma_gamma",
      description: "Radiative neutron capture cross-section (n, gamma).",
      color: "#fbbf24",
    },
  ],
  [
    151,
    {
      mt: 151,
      mf: 2,
      name: "Resonance Parameters",
      symbol: "SLBW",
      description: "Resolved and unresolved resonance parameters (MF=2, MT=151).",
      color: "#a78bfa",
    },
  ],
  [
    451,
    {
      mt: 451,
      mf: 1,
      name: "Descriptive Data",
      symbol: "DESC",
      description: "General information, descriptive text, and section directory (MF=1, MT=451).",
      color: "#94a3b8",
    },
  ],
  [
    457,
    {
      mt: 457,
      mf: 8,
      name: "Radioactive Decay",
      symbol: "DECAY",
      description: "Radioactive nuclide half-life, decay energies, and decay modes (MF=8, MT=457).",
      color: "#fb923c",
    },
  ],
]);

export interface Endf6ReferenceNuclide {
  mat: number;
  za: number;
  awr: number;
  symbol: string;
  name: string;
  /** Thermal (0.0253 eV) elastic scattering cross-section (barns). */
  sigmaElasticThermal: number;
  /** Thermal (0.0253 eV) radiative capture cross-section (barns). */
  sigmaCaptureThermal: number;
  /** Thermal (0.0253 eV) fission cross-section (barns). */
  sigmaFissionThermal: number;
  /** Fast (1 MeV) elastic scattering cross-section (barns). */
  sigmaElasticFast: number;
  /** Fast (1 MeV) radiative capture cross-section (barns). */
  sigmaCaptureFast: number;
  /** Fast (1 MeV) fission cross-section (barns). */
  sigmaFissionFast: number;
  /** Half-life in seconds (`Infinity` if stable). */
  halfLifeSeconds: number;
  /** Optional first s-wave SLBW resonance. */
  firstResonance?: {
    er: number;
    aj: number;
    spi: number;
    ap: number;
    gn: number;
    gg: number;
    gf: number;
  };
  provenance: string;
}

/**
 * Cleanroom ENDF-6 reference nuclides (`H-1`, `B-10`, `U-235`, `U-238`, `Pu-239`)
 * with textbook thermal/fast cross-sections and first s-wave resonance parameters.
 */
export const CLEANROOM_ENDF6_NUCLIDES: ReadonlyMap<string, Endf6ReferenceNuclide> = new Map<
  string,
  Endf6ReferenceNuclide
>([
  [
    "H-1",
    {
      mat: 125,
      za: 1001,
      awr: 0.999167,
      symbol: "H-1",
      name: "Hydrogen-1",
      sigmaElasticThermal: 20.491,
      sigmaCaptureThermal: 0.3326,
      sigmaFissionThermal: 0.0,
      sigmaElasticFast: 4.26,
      sigmaCaptureFast: 3.9e-5,
      sigmaFissionFast: 0.0,
      halfLifeSeconds: Number.POSITIVE_INFINITY,
      provenance: "Cleanroom ENDF/B-VIII.0 MAT=125 textbook nuclear data",
    },
  ],
  [
    "B-10",
    {
      mat: 525,
      za: 5010,
      awr: 9.92692,
      symbol: "B-10",
      name: "Boron-10",
      sigmaElasticThermal: 2.15,
      sigmaCaptureThermal: 3837.0,
      sigmaFissionThermal: 0.0,
      sigmaElasticFast: 2.45,
      sigmaCaptureFast: 0.25,
      sigmaFissionFast: 0.0,
      halfLifeSeconds: Number.POSITIVE_INFINITY,
      provenance: "Cleanroom ENDF/B-VIII.0 MAT=525 textbook 1/v absorber standard",
    },
  ],
  [
    "U-235",
    {
      mat: 9228,
      za: 92235,
      awr: 233.025,
      symbol: "U-235",
      name: "Uranium-235",
      sigmaElasticThermal: 15.0,
      sigmaCaptureThermal: 98.7,
      sigmaFissionThermal: 585.1,
      sigmaElasticFast: 4.56,
      sigmaCaptureFast: 0.11,
      sigmaFissionFast: 1.22,
      halfLifeSeconds: 2.221e16, // 7.04e8 years
      firstResonance: {
        er: 0.273,
        aj: 3.0,
        spi: 3.5,
        ap: 0.9602,
        gn: 3.4e-6,
        gg: 0.038,
        gf: 0.105,
      },
      provenance: "Cleanroom ENDF/B-VIII.0 MAT=9228 textbook fissile data",
    },
  ],
  [
    "U-238",
    {
      mat: 9237,
      za: 92238,
      awr: 236.006,
      symbol: "U-238",
      name: "Uranium-238",
      sigmaElasticThermal: 9.36,
      sigmaCaptureThermal: 2.683,
      sigmaFissionThermal: 0.0,
      sigmaElasticFast: 4.85,
      sigmaCaptureFast: 0.12,
      sigmaFissionFast: 0.018,
      halfLifeSeconds: 1.4099e17, // 4.468e9 years
      firstResonance: {
        er: 6.674,
        aj: 0.5,
        spi: 0.0,
        ap: 0.948,
        gn: 0.001493,
        gg: 0.023,
        gf: 0.0,
      },
      provenance: "Cleanroom ENDF/B-VIII.0 MAT=9237 textbook fertile resonance data",
    },
  ],
  [
    "Pu-239",
    {
      mat: 9437,
      za: 94239,
      awr: 236.999,
      symbol: "Pu-239",
      name: "Plutonium-239",
      sigmaElasticThermal: 7.9,
      sigmaCaptureThermal: 270.3,
      sigmaFissionThermal: 747.4,
      sigmaElasticFast: 4.5,
      sigmaCaptureFast: 0.055,
      sigmaFissionFast: 1.72,
      halfLifeSeconds: 7.608e11, // 24,110 years
      firstResonance: {
        er: 0.296,
        aj: 1.0,
        spi: 0.5,
        ap: 0.941,
        gn: 8.0e-5,
        gg: 0.039,
        gf: 0.056,
      },
      provenance: "Cleanroom ENDF/B-VIII.0 MAT=9437 textbook plutonium data",
    },
  ],
]);

function makeNuclideIconSvg(symbol: string, mat: number, accent: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52"><rect x="2" y="2" width="84" height="48" rx="6" fill="#0f172a" stroke="${accent}" stroke-width="2"/><text x="44" y="24" text-anchor="middle" fill="#f8fafc" font-family="monospace" font-size="13" font-weight="700">${symbol}</text><text x="44" y="40" text-anchor="middle" fill="${accent}" font-family="monospace" font-size="9">MAT ${mat}</text></svg>`;
}

function makeMtIconSvg(mt: number, label: string, accent: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52"><rect x="2" y="2" width="84" height="48" rx="6" fill="#0f172a" stroke="${accent}" stroke-width="2"/><text x="44" y="22" text-anchor="middle" fill="${accent}" font-family="monospace" font-size="12" font-weight="700">MT=${mt}</text><text x="44" y="39" text-anchor="middle" fill="#e2e8f0" font-family="sans-serif" font-size="9">${label}</text></svg>`;
}

/**
 * Builds the declarative `CleanroomModelSchema[]` array materialized by `scripts/build-stdlib.js`.
 */
export function buildEndf6CleanroomSchemas(): CleanroomModelSchema[] {
  const schemas: CleanroomModelSchema[] = [];

  const defaultPorts: DiagramPortSpec[] = [
    { name: "E_in", kind: "signal", side: "left", dx: 0, dy: 26 },
    { name: "sigma_out", kind: "signal", side: "right", dx: 88, dy: 26 },
  ];

  // 1. ENDF-6 MF/MT Reaction Schemas
  for (const mt of [1, 2, 18, 102, 451, 457]) {
    const desc = ENDF6_MT_DESCRIPTORS.get(mt)!;
    const params: CleanroomParameterSchema[] = [
      { key: "MF", type: "real", defaultValue: desc.mf, description: "ENDF-6 file number" },
      { key: "MT", type: "real", defaultValue: desc.mt, description: "ENDF-6 reaction/section number" },
    ];
    schemas.push({
      namePath: `ENDF6.MT.MT${desc.mt}`,
      name: `MT${desc.mt}`,
      aliases: [`MT=${desc.mt}`, `MF${desc.mf}_MT${desc.mt}`, desc.name.toLowerCase()],
      label: `MT=${desc.mt} (${desc.name})`,
      category: "Reaction",
      domain: "nuclear",
      description: desc.description,
      provenance: "Cleanroom ENDF-102 ENDF-6 Format Manual",
      symbolKind: "Interface",
      width: 88,
      height: 52,
      svg: makeMtIconSvg(desc.mt, desc.name, desc.color),
      ports: defaultPorts,
      parameters: params,
      wasmKernel: "endf6Interp",
    });
  }

  // 2. Cleanroom Reference Nuclides
  for (const nuc of CLEANROOM_ENDF6_NUCLIDES.values()) {
    const accent = nuc.sigmaFissionThermal > 0 ? "#f43f5e" : nuc.sigmaCaptureThermal > 100 ? "#fbbf24" : "#34d399";
    const params: CleanroomParameterSchema[] = [
      { key: "MAT", type: "real", defaultValue: nuc.mat, description: "ENDF-6 material identifier" },
      { key: "ZA", type: "real", defaultValue: nuc.za, description: "Nuclide 1000*Z + A" },
      { key: "AWR", type: "real", defaultValue: nuc.awr, description: "Atomic weight ratio" },
      {
        key: "sigma_s_th",
        type: "real",
        defaultValue: nuc.sigmaElasticThermal,
        unit: "b",
        description: "Thermal elastic cross-section",
      },
      {
        key: "sigma_c_th",
        type: "real",
        defaultValue: nuc.sigmaCaptureThermal,
        unit: "b",
        description: "Thermal capture cross-section",
      },
      {
        key: "sigma_f_th",
        type: "real",
        defaultValue: nuc.sigmaFissionThermal,
        unit: "b",
        description: "Thermal fission cross-section",
      },
    ];
    schemas.push({
      namePath: `ENDF6.Nuclides.${nuc.symbol.replace("-", "_")}`,
      name: nuc.symbol,
      aliases: [nuc.name.toLowerCase(), `MAT${nuc.mat}`, `ZA${nuc.za}`],
      label: `${nuc.symbol} (MAT=${nuc.mat})`,
      category: "Nuclide",
      domain: "nuclear",
      description: `${nuc.name} (ZA=${nuc.za}, AWR=${nuc.awr}) evaluated neutron cross-section reference.`,
      provenance: nuc.provenance,
      symbolKind: "Class",
      width: 88,
      height: 52,
      svg: makeNuclideIconSvg(nuc.symbol, nuc.mat, accent),
      ports: defaultPorts,
      parameters: params,
      wasmKernel: "endf6ThermalSigmaCapture",
    });
  }

  return schemas;
}
