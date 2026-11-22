// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * PLS-CADD cleanroom transmission line model archetype IDs matching `assets/plscadd-std-lib/src/models.ts`.
 */
export const PlsCaddArchetypeId = {
  CONDUCTOR_ACSR: 1,
  CONDUCTOR_AAAC: 2,
  CONDUCTOR_ACSS: 3,
  CONDUCTOR_OPGW: 4,
  STRUCTURE_LATTICE: 10,
  STRUCTURE_TUBULAR: 11,
  STRUCTURE_HFRAME: 12,
  INSULATOR_SUSPENSION: 20,
  INSULATOR_DEADEND: 21,
  INSULATOR_VSTRING: 22,
  LOAD_NESC: 30,
  LOAD_IEC: 31,
} as const;

export type PlsCaddArchetypeId = (typeof PlsCaddArchetypeId)[keyof typeof PlsCaddArchetypeId];

export interface PlsCaddModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: "Conductor" | "Structure" | "Insulator" | "Weather Load Case";
  archetypeId: PlsCaddArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<PlsCaddModelSpec["category"], { fill: string; stroke: string; badge: string }> = {
  Conductor: { fill: "#1e3a5f", stroke: "#60a5fa", badge: "WIR" },
  Structure: { fill: "#1e3f2f", stroke: "#34d399", badge: "STR" },
  Insulator: { fill: "#3b1f47", stroke: "#c084fc", badge: "INS" },
  "Weather Load Case": { fill: "#3f2e18", stroke: "#fbbf24", badge: "WLC" },
};

/**
 * Generates a deterministic cleanroom parametric SVG icon for a PLS-CADD transmission line component.
 */
export function generatePlsCaddSvg(modelType: string, category: PlsCaddModelSpec["category"]): string {
  const c = CATEGORY_COLORS[category];
  const shortLabel = modelType
    .replace(/^(WIR|STR|INS|LOAD)_/, "")
    .slice(0, 10)
    .toUpperCase();

  let glyph = "";
  if (category === "Conductor") {
    // Catenary sag curve between two attachment points
    glyph =
      `<path d="M 10 22 Q 40 34 70 22" fill="none" stroke="${c.stroke}" stroke-width="2" stroke-linecap="round"/>` +
      `<circle cx="10" cy="22" r="2.2" fill="${c.stroke}"/>` +
      `<circle cx="70" cy="22" r="2.2" fill="${c.stroke}"/>`;
  } else if (category === "Structure") {
    // Lattice transmission tower silhouette
    glyph = `<path d="M 40 12 L 32 34 M 40 12 L 48 34 M 28 19 L 52 19 M 34 26 L 46 26" fill="none" stroke="${c.stroke}" stroke-width="1.6" stroke-linecap="round"/>`;
  } else if (category === "Insulator") {
    // Stacked porcelain/polymer insulator sheds
    glyph =
      `<line x1="40" y1="12" x2="40" y2="33" stroke="${c.stroke}" stroke-width="1.6"/>` +
      `<ellipse cx="40" cy="17" rx="8" ry="2.2" fill="none" stroke="${c.stroke}" stroke-width="1.4"/>` +
      `<ellipse cx="40" cy="22.5" rx="8" ry="2.2" fill="none" stroke="${c.stroke}" stroke-width="1.4"/>` +
      `<ellipse cx="40" cy="28" rx="8" ry="2.2" fill="none" stroke="${c.stroke}" stroke-width="1.4"/>`;
  } else {
    // Weather load case: wind streamlines + ice crystal indicator
    glyph =
      `<path d="M 14 20 H 46 M 18 26 H 52 M 12 31 H 42" fill="none" stroke="${c.stroke}" stroke-width="1.5" stroke-linecap="round"/>` +
      `<polygon points="62,16 66,22 62,28 58,22" fill="none" stroke="${c.stroke}" stroke-width="1.4"/>`;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 48" width="80" height="48">` +
    `<rect x="2" y="2" width="76" height="44" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="5" width="24" height="11" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="18" y="13.5" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    glyph +
    `<text x="40" y="42" text-anchor="middle" font-family="monospace" font-size="7.5" font-weight="bold" fill="#f8fafc">${shortLabel}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: PlsCaddModelSpec["category"]): DiagramPortSpec[] {
  switch (category) {
    case "Conductor":
      return [
        { name: "ahead", kind: "mechanical", side: "left", dx: 0, dy: 24 },
        { name: "back", kind: "mechanical", side: "right", dx: 80, dy: 24 },
        { name: "weather", kind: "signal", side: "top", dx: 40, dy: 0 },
      ];
    case "Structure":
      return [
        { name: "wire_in", kind: "mechanical", side: "left", dx: 0, dy: 18 },
        { name: "wire_out", kind: "mechanical", side: "right", dx: 80, dy: 18 },
        { name: "foundation", kind: "mechanical", side: "bottom", dx: 40, dy: 48 },
      ];
    case "Insulator":
      return [
        { name: "structure", kind: "mechanical", side: "top", dx: 40, dy: 0 },
        { name: "conductor", kind: "mechanical", side: "bottom", dx: 40, dy: 48 },
      ];
    case "Weather Load Case":
      return [
        { name: "conductor_in", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "load_out", kind: "signal", side: "right", dx: 80, dy: 24 },
      ];
  }
}

/**
 * Standard cleanroom Bentley PLS-CADD transmission line library specifications.
 *
 * Parameter vector ordering (`CON[0..n-1]`) is aligned with `assets/plscadd-std-lib/src/models.ts`:
 * - Conductors:
 *   [0] diameterM (m), [1] areaM2 (m^2), [2] unitWeightNPerM (N/m), [3] rtsN (N),
 *   [4] modulusPa (Pa), [5] thermalExpPerC (1/degC), [6] r25OhmPerKm (ohm/km),
 *   [7] r75OhmPerKm (ohm/km), [8] gmrM (m), [9] maxTempC (degC)
 * - Structures:
 *   [0] heightM (m), [1] phaseSpacingM (m), [2] maxWindSpanM (m), [3] maxWeightSpanM (m),
 *   [4] maxLineAngleDeg (deg), [5] momentCapacityKnM (kN*m), [6] voltageKv (kV),
 *   [7] minGroundClearanceM (m)
 * - Insulators:
 *   [0] stringLengthM (m), [1] smlN (N), [2] weightN (N), [3] dryFlashoverKv (kV),
 *   [4] wetFlashoverKv (kV), [5] maxSwingDeg (deg)
 * - Weather Load Cases:
 *   [0] radialIceM (m), [1] windPressurePa (Pa), [2] windSpeedMs (m/s), [3] nescConstantNPerM (N/m),
 *   [4] tempC (degC), [5] iceDensityKgPerM3 (kg/m^3), [6] verticalOverloadFactor (-),
 *   [7] transverseOverloadFactor (-)
 */
export const PLSCADD_MODEL_SPECS: PlsCaddModelSpec[] = [
  // =========================================================================
  // Conductors (.wir ASTM B232 / ASTM B399 / ASTM B856 / IEEE Std 1138)
  // =========================================================================
  {
    modelType: "WIR_ACSR_DRAKE_795",
    aliases: ["DRAKE", "ACSR_DRAKE", "795_DRAKE", "drake.wir"],
    label: "ACSR 795 kcmil 26/7 Drake",
    category: "Conductor",
    archetypeId: PlsCaddArchetypeId.CONDUCTOR_ACSR,
    description:
      "Standard ASTM B232 Aluminum Conductor Steel Reinforced (ACSR) 795 kcmil 26/7 stranding 'Drake' overhead transmission conductor with IEEE Std 738 thermal parameters.",
    provenance: "ASTM B232/B232M (Drake 795 kcmil 26/7) & IEEE Std 738-2012",
    params: [
      ["diameterM", 0.02814, "m", "Conductor outer diameter (1.108 in)"],
      ["areaM2", 4.684e-4, "m^2", "Total aluminum + steel cross-sectional area (468.4 mm^2)"],
      ["unitWeightNPerM", 15.965, "N/m", "Bare conductor unit weight (1.628 kg/m, 1.094 lb/ft)"],
      ["rtsN", 140100.0, "N", "Rated tensile strength (31,500 lbf)"],
      ["modulusPa", 7.58e10, "Pa", "Final composite modulus of elasticity"],
      ["thermalExpPerC", 1.91e-5, "1/degC", "Composite coefficient of linear thermal expansion"],
      ["r25OhmPerKm", 0.07283, "ohm/km", "AC resistance at 25 degC (60 Hz)"],
      ["r75OhmPerKm", 0.08688, "ohm/km", "AC resistance at 75 degC (60 Hz)"],
      ["gmrM", 0.01143, "m", "Geometric mean radius (0.0375 ft)"],
      ["maxTempC", 75.0, "degC", "Maximum continuous operating temperature"],
    ],
  },
  {
    modelType: "WIR_ACSR_CARDINAL_954",
    aliases: ["CARDINAL", "ACSR_CARDINAL", "954_CARDINAL", "cardinal.wir"],
    label: "ACSR 954 kcmil 54/7 Cardinal",
    category: "Conductor",
    archetypeId: PlsCaddArchetypeId.CONDUCTOR_ACSR,
    description:
      "ASTM B232 ACSR 954 kcmil 54/7 stranding 'Cardinal' conductor widely used on 230 kV and 345 kV transmission corridors.",
    provenance: "ASTM B232/B232M (Cardinal 954 kcmil 54/7) & IEEE Std 738-2012",
    params: [
      ["diameterM", 0.03042, "m", "Conductor outer diameter (1.198 in)"],
      ["areaM2", 5.462e-4, "m^2", "Total cross-sectional area (546.2 mm^2)"],
      ["unitWeightNPerM", 17.92, "N/m", "Bare conductor unit weight (1.827 kg/m, 1.228 lb/ft)"],
      ["rtsN", 150350.0, "N", "Rated tensile strength (33,800 lbf)"],
      ["modulusPa", 7.1e10, "Pa", "Final composite modulus of elasticity"],
      ["thermalExpPerC", 1.98e-5, "1/degC", "Composite coefficient of linear thermal expansion"],
      ["r25OhmPerKm", 0.0609, "ohm/km", "AC resistance at 25 degC (60 Hz)"],
      ["r75OhmPerKm", 0.0726, "ohm/km", "AC resistance at 75 degC (60 Hz)"],
      ["gmrM", 0.01228, "m", "Geometric mean radius (0.0403 ft)"],
      ["maxTempC", 75.0, "degC", "Maximum continuous operating temperature"],
    ],
  },
  {
    modelType: "WIR_ACSR_RAIL_954",
    aliases: ["RAIL", "ACSR_RAIL", "954_RAIL", "rail.wir"],
    label: "ACSR 954 kcmil 45/7 Rail",
    category: "Conductor",
    archetypeId: PlsCaddArchetypeId.CONDUCTOR_ACSR,
    description:
      "ASTM B232 ACSR 954 kcmil 45/7 stranding 'Rail' lightweight-core conductor for bundled 345–500 kV lines.",
    provenance: "ASTM B232/B232M (Rail 954 kcmil 45/7) & IEEE Std 738-2012",
    params: [
      ["diameterM", 0.02959, "m", "Conductor outer diameter (1.165 in)"],
      ["areaM2", 5.17e-4, "m^2", "Total cross-sectional area (517.0 mm^2)"],
      ["unitWeightNPerM", 15.69, "N/m", "Bare conductor unit weight (1.600 kg/m, 1.075 lb/ft)"],
      ["rtsN", 115200.0, "N", "Rated tensile strength (25,900 lbf)"],
      ["modulusPa", 6.62e10, "Pa", "Final composite modulus of elasticity"],
      ["thermalExpPerC", 2.07e-5, "1/degC", "Composite coefficient of linear thermal expansion"],
      ["r25OhmPerKm", 0.0616, "ohm/km", "AC resistance at 25 degC (60 Hz)"],
      ["r75OhmPerKm", 0.0734, "ohm/km", "AC resistance at 75 degC (60 Hz)"],
      ["gmrM", 0.01173, "m", "Geometric mean radius (0.0385 ft)"],
      ["maxTempC", 75.0, "degC", "Maximum continuous operating temperature"],
    ],
  },
  {
    modelType: "WIR_ACSR_BLUEBIRD_2156",
    aliases: ["BLUEBIRD", "ACSR_BLUEBIRD", "2156_BLUEBIRD", "bluebird.wir"],
    label: "ACSR 2156 kcmil 84/19 Bluebird",
    category: "Conductor",
    archetypeId: PlsCaddArchetypeId.CONDUCTOR_ACSR,
    description:
      "ASTM B232 ACSR 2156 kcmil 84/19 stranding 'Bluebird' extra-high-ampacity conductor for 500 kV EHV bulk transmission.",
    provenance: "ASTM B232/B232M (Bluebird 2156 kcmil 84/19) & IEEE Std 738-2012",
    params: [
      ["diameterM", 0.04475, "m", "Conductor outer diameter (1.762 in)"],
      ["areaM2", 1.181e-3, "m^2", "Total cross-sectional area (1181 mm^2)"],
      ["unitWeightNPerM", 36.65, "N/m", "Bare conductor unit weight (3.737 kg/m, 2.511 lb/ft)"],
      ["rtsN", 268200.0, "N", "Rated tensile strength (60,300 lbf)"],
      ["modulusPa", 6.69e10, "Pa", "Final composite modulus of elasticity"],
      ["thermalExpPerC", 2.05e-5, "1/degC", "Composite coefficient of linear thermal expansion"],
      ["r25OhmPerKm", 0.0289, "ohm/km", "AC resistance at 25 degC (60 Hz)"],
      ["r75OhmPerKm", 0.0342, "ohm/km", "AC resistance at 75 degC (60 Hz)"],
      ["gmrM", 0.01786, "m", "Geometric mean radius (0.0586 ft)"],
      ["maxTempC", 75.0, "degC", "Maximum continuous operating temperature"],
    ],
  },
  {
    modelType: "WIR_ACSR_LINNET_336",
    aliases: ["LINNET", "ACSR_LINNET", "336_LINNET", "linnet.wir"],
    label: "ACSR 336.4 kcmil 26/7 Linnet",
    category: "Conductor",
    archetypeId: PlsCaddArchetypeId.CONDUCTOR_ACSR,
    description: "ASTM B232 ACSR 336.4 kcmil 26/7 stranding 'Linnet' sub-transmission conductor for 69–138 kV lines.",
    provenance: "ASTM B232/B232M (Linnet 336.4 kcmil 26/7) & IEEE Std 738-2012",
    params: [
      ["diameterM", 0.01831, "m", "Conductor outer diameter (0.721 in)"],
      ["areaM2", 1.982e-4, "m^2", "Total cross-sectional area (198.2 mm^2)"],
      ["unitWeightNPerM", 6.757, "N/m", "Bare conductor unit weight (0.689 kg/m, 0.463 lb/ft)"],
      ["rtsN", 62720.0, "N", "Rated tensile strength (14,100 lbf)"],
      ["modulusPa", 7.58e10, "Pa", "Final composite modulus of elasticity"],
      ["thermalExpPerC", 1.91e-5, "1/degC", "Composite coefficient of linear thermal expansion"],
      ["r25OhmPerKm", 0.1714, "ohm/km", "AC resistance at 25 degC (60 Hz)"],
      ["r75OhmPerKm", 0.205, "ohm/km", "AC resistance at 75 degC (60 Hz)"],
      ["gmrM", 0.00744, "m", "Geometric mean radius (0.0244 ft)"],
      ["maxTempC", 75.0, "degC", "Maximum continuous operating temperature"],
    ],
  },
  {
    modelType: "WIR_AAAC_GREELEY_927",
    aliases: ["GREELEY", "AAAC_GREELEY", "927_GREELEY", "greeley.wir"],
    label: "AAAC 927.2 kcmil 37-Strand Greeley",
    category: "Conductor",
    archetypeId: PlsCaddArchetypeId.CONDUCTOR_AAAC,
    description:
      "ASTM B399 All-Aluminum Alloy Conductor (6201-T81) 927.2 kcmil 'Greeley' offering high corrosion resistance and strength-to-weight ratio.",
    provenance: "ASTM B399/B399M (Greeley 927.2 kcmil 6201-T81) & IEEE Std 738-2012",
    params: [
      ["diameterM", 0.02814, "m", "Conductor outer diameter (1.108 in)"],
      ["areaM2", 4.698e-4, "m^2", "Total 6201-T81 cross-sectional area (469.8 mm^2)"],
      ["unitWeightNPerM", 12.71, "N/m", "Bare conductor unit weight (1.296 kg/m, 0.871 lb/ft)"],
      ["rtsN", 135700.0, "N", "Rated tensile strength (30,500 lbf)"],
      ["modulusPa", 6.21e10, "Pa", "Final 6201-T81 alloy modulus of elasticity"],
      ["thermalExpPerC", 2.3e-5, "1/degC", "Aluminum alloy coefficient of linear thermal expansion"],
      ["r25OhmPerKm", 0.0721, "ohm/km", "AC resistance at 25 degC (60 Hz)"],
      ["r75OhmPerKm", 0.0853, "ohm/km", "AC resistance at 75 degC (60 Hz)"],
      ["gmrM", 0.01082, "m", "Geometric mean radius (0.0355 ft)"],
      ["maxTempC", 75.0, "degC", "Maximum continuous operating temperature"],
    ],
  },
  {
    modelType: "WIR_ACSS_DRAKE_795",
    aliases: ["ACSS_DRAKE", "DRAKE_ACSS", "795_ACSS", "acss_drake.wir"],
    label: "ACSS 795 kcmil 26/7 Drake HTLS",
    category: "Conductor",
    archetypeId: PlsCaddArchetypeId.CONDUCTOR_ACSS,
    description:
      "ASTM B856 Aluminum Conductor Steel Supported (ACSS) 795 kcmil 'Drake' High-Temperature Low-Sag (HTLS) conductor rated for continuous 200 degC operation.",
    provenance: "ASTM B856 (ACSS Drake 795 kcmil 26/7) & IEEE Std 738-2012",
    params: [
      ["diameterM", 0.02814, "m", "Conductor outer diameter (1.108 in)"],
      ["areaM2", 4.684e-4, "m^2", "Total annealed Al + HS steel area (468.4 mm^2)"],
      ["unitWeightNPerM", 15.965, "N/m", "Bare conductor unit weight (1.628 kg/m, 1.094 lb/ft)"],
      ["rtsN", 115200.0, "N", "Rated tensile strength with annealed Al (25,900 lbf)"],
      ["modulusPa", 6.45e10, "Pa", "Final steel-core dominated effective modulus"],
      ["thermalExpPerC", 1.15e-5, "1/degC", "Steel-core low-sag thermal expansion above knee-point"],
      ["r25OhmPerKm", 0.0706, "ohm/km", "AC resistance at 25 degC (1350-O annealed Al)"],
      ["r75OhmPerKm", 0.0844, "ohm/km", "AC resistance at 75 degC (60 Hz)"],
      ["gmrM", 0.01143, "m", "Geometric mean radius (0.0375 ft)"],
      ["maxTempC", 200.0, "degC", "HTLS maximum continuous operating temperature"],
    ],
  },
  {
    modelType: "WIR_OPGW_48F",
    aliases: ["OPGW", "OPGW_48", "OPGW_48F", "opgw48.wir"],
    label: "OPGW 48-Fiber Optical Ground Wire",
    category: "Conductor",
    archetypeId: PlsCaddArchetypeId.CONDUCTOR_OPGW,
    description:
      "IEEE Std 1138 Optical Ground Wire (OPGW) 48-fiber aluminum-clad steel shield wire providing lightning protection and telecom fiber.",
    provenance: "IEEE Std 1138-2009 (OPGW) & IEC 60794-4",
    params: [
      ["diameterM", 0.014, "m", "Outer diameter (14.0 mm)"],
      ["areaM2", 1.14e-4, "m^2", "Metallic cross-sectional area (114 mm^2)"],
      ["unitWeightNPerM", 5.88, "N/m", "Bare OPGW unit weight (0.600 kg/m)"],
      ["rtsN", 75000.0, "N", "Rated breaking strength (75 kN)"],
      ["modulusPa", 1.25e11, "Pa", "Composite ACS/Al modulus of elasticity"],
      ["thermalExpPerC", 1.45e-5, "1/degC", "Coefficient of linear thermal expansion"],
      ["r25OhmPerKm", 0.48, "ohm/km", "DC/AC resistance at 25 degC"],
      ["r75OhmPerKm", 0.565, "ohm/km", "AC resistance at 75 degC"],
      ["gmrM", 0.0052, "m", "Geometric mean radius"],
      ["maxTempC", 80.0, "degC", "Maximum continuous fiber-safe temperature"],
    ],
  },

  // =========================================================================
  // Structures & Hardware (ASCE 10-15 / ASCE 48-19 / ANSI O5.1 / IEC 60305)
  // =========================================================================
  {
    modelType: "STR_LATTICE_TANGENT_230kV",
    aliases: ["LATTICE_230", "TANGENT_230KV", "230KV_LATTICE"],
    label: "230 kV Lattice Steel Tangent Tower",
    category: "Structure",
    archetypeId: PlsCaddArchetypeId.STRUCTURE_LATTICE,
    description:
      "Self-supporting galvanized lattice steel tangent suspension tower for 230 kV single/double-circuit overhead transmission lines.",
    provenance: "ASCE 10-15 (Design of Latticed Steel Transmission Structures) & NESC C2",
    params: [
      ["heightM", 32.0, "m", "Total tower height above ground line"],
      ["phaseSpacingM", 6.5, "m", "Nominal phase-to-phase conductor spacing"],
      ["maxWindSpanM", 380.0, "m", "Maximum allowable horizontal wind span"],
      ["maxWeightSpanM", 460.0, "m", "Maximum allowable vertical weight span"],
      ["maxLineAngleDeg", 3.0, "deg", "Maximum tangent deflection angle"],
      ["momentCapacityKnM", 2800.0, "kN*m", "Factored base overturning moment capacity"],
      ["voltageKv", 230.0, "kV", "Nominal system phase-to-phase voltage"],
      ["minGroundClearanceM", 7.6, "m", "NESC Table 232-1 minimum ground clearance"],
    ],
  },
  {
    modelType: "STR_LATTICE_DE_500kV",
    aliases: ["LATTICE_DE_500", "DEADEND_500KV", "500KV_DE"],
    label: "500 kV Lattice Steel Dead-End Tower",
    category: "Structure",
    archetypeId: PlsCaddArchetypeId.STRUCTURE_LATTICE,
    description:
      "Heavy-duty 500 kV EHV lattice steel strain/dead-end tower rated for full longitudinal tension and large line deflection angles.",
    provenance: "ASCE 10-15 & IEEE Std 977 / NESC C2 Rule 250",
    params: [
      ["heightM", 44.0, "m", "Total dead-end tower height above ground line"],
      ["phaseSpacingM", 11.5, "m", "Nominal 500 kV phase spacing"],
      ["maxWindSpanM", 480.0, "m", "Maximum allowable horizontal wind span"],
      ["maxWeightSpanM", 600.0, "m", "Maximum allowable vertical weight span"],
      ["maxLineAngleDeg", 45.0, "deg", "Maximum strain/dead-end deflection angle"],
      ["momentCapacityKnM", 9500.0, "kN*m", "Factored base overturning moment capacity"],
      ["voltageKv", 500.0, "kV", "Nominal system phase-to-phase voltage"],
      ["minGroundClearanceM", 10.7, "m", "NESC Table 232-1 minimum ground clearance for 500 kV"],
    ],
  },
  {
    modelType: "STR_TUBULAR_STEEL_138kV",
    aliases: ["MONOPOLE_138", "TUBULAR_138KV", "138KV_POLE"],
    label: "138 kV Tubular Steel Monopole",
    category: "Structure",
    archetypeId: PlsCaddArchetypeId.STRUCTURE_TUBULAR,
    description:
      "Tapered dodecagonal tubular steel tangent monopole with davit arms for narrow right-of-way 138 kV corridors.",
    provenance: "ASCE/SEI 48-19 (Design of Steel Transmission Pole Structures)",
    params: [
      ["heightM", 26.0, "m", "Above-ground monopole height"],
      ["phaseSpacingM", 4.2, "m", "Vertical/horizontal davit-arm phase spacing"],
      ["maxWindSpanM", 260.0, "m", "Maximum allowable horizontal wind span"],
      ["maxWeightSpanM", 320.0, "m", "Maximum allowable vertical weight span"],
      ["maxLineAngleDeg", 5.0, "deg", "Maximum tangent deflection angle"],
      ["momentCapacityKnM", 1650.0, "kN*m", "Factored ground-line flexural moment capacity"],
      ["voltageKv", 138.0, "kV", "Nominal system phase-to-phase voltage"],
      ["minGroundClearanceM", 6.7, "m", "NESC Table 232-1 minimum ground clearance"],
    ],
  },
  {
    modelType: "STR_HFRAME_WOOD_115kV",
    aliases: ["HFRAME_115", "WOOD_HFRAME", "115KV_HFRAME"],
    label: "115 kV Wood H-Frame Tangent Structure",
    category: "Structure",
    archetypeId: PlsCaddArchetypeId.STRUCTURE_HFRAME,
    description:
      "Two-pole Class 1 Douglas Fir / Southern Yellow Pine X-braced wood H-frame tangent structure for 115 kV lines.",
    provenance: "ANSI O5.1-2017 & RUS Bulletin 1724E-200 / NESC C2 Grade B",
    params: [
      ["heightM", 21.5, "m", "Above-ground pole height (70 ft setting)"],
      ["phaseSpacingM", 4.4, "m", "Horizontal crossarm phase spacing"],
      ["maxWindSpanM", 245.0, "m", "Maximum allowable horizontal wind span"],
      ["maxWeightSpanM", 300.0, "m", "Maximum allowable vertical weight span"],
      ["maxLineAngleDeg", 2.0, "deg", "Maximum tangent deflection angle"],
      ["momentCapacityKnM", 720.0, "kN*m", "Factored H-frame overturning moment capacity"],
      ["voltageKv", 115.0, "kV", "Nominal system phase-to-phase voltage"],
      ["minGroundClearanceM", 6.4, "m", "NESC Table 232-1 minimum ground clearance"],
    ],
  },
  {
    modelType: "INS_SUSPENSION_GLASS",
    aliases: ["SUSP_GLASS", "GLASS_INSULATOR", "I_STRING"],
    label: "Toughened Glass Suspension Insulator String",
    category: "Insulator",
    archetypeId: PlsCaddArchetypeId.INSULATOR_SUSPENSION,
    description:
      "IEC 60305 U120B toughened glass cap-and-pin I-string suspension insulator assembly with free transverse swing.",
    provenance: "IEC 60305 (U120B) & ANSI C29.2B",
    params: [
      ["stringLengthM", 2.35, "m", "Total assembly length (15 discs @ 146 mm + hardware)"],
      ["smlN", 120000.0, "N", "Specified Mechanical Load (120 kN)"],
      ["weightN", 950.0, "N", "Assembly dead weight"],
      ["dryFlashoverKv", 690.0, "kV", "Power-frequency dry flashover voltage (rms)"],
      ["wetFlashoverKv", 490.0, "kV", "Power-frequency wet flashover voltage (rms)"],
      ["maxSwingDeg", 45.0, "deg", "Maximum permissible transverse swing angle"],
    ],
  },
  {
    modelType: "INS_DEADEND_POLYMER",
    aliases: ["DE_POLYMER", "POLYMER_DEADEND", "COMPOSITE_DE"],
    label: "Silicone Polymer Dead-End Insulator",
    category: "Insulator",
    archetypeId: PlsCaddArchetypeId.INSULATOR_DEADEND,
    description:
      "High-strength fiberglass-core silicone-rubber composite dead-end strain insulator for tension towers.",
    provenance: "IEC 61109 & ANSI C29.12",
    params: [
      ["stringLengthM", 2.6, "m", "End-to-end dead-end assembly length"],
      ["smlN", 210000.0, "N", "Specified Mechanical Load (210 kN)"],
      ["weightN", 180.0, "N", "Lightweight composite assembly weight"],
      ["dryFlashoverKv", 760.0, "kV", "Power-frequency dry flashover voltage (rms)"],
      ["wetFlashoverKv", 580.0, "kV", "Power-frequency wet flashover voltage (rms)"],
      ["maxSwingDeg", 5.0, "deg", "Tension alignment limit"],
    ],
  },
  {
    modelType: "INS_VSTRING_500kV",
    aliases: ["VSTRING_500", "V_STRING", "500KV_VSTRING"],
    label: "500 kV V-String Suspension Assembly",
    category: "Insulator",
    archetypeId: PlsCaddArchetypeId.INSULATOR_VSTRING,
    description:
      "Dual-leg 90-degree V-string suspension insulator assembly constraining transverse conductor swing inside 500 kV tower windows.",
    provenance: "IEEE Std 1313.2 & IEC 60305 (U160BL)",
    params: [
      ["stringLengthM", 4.1, "m", "Per-leg insulator string length (25 discs + yoke)"],
      ["smlN", 160000.0, "N", "Per-leg Specified Mechanical Load (160 kN)"],
      ["weightN", 3400.0, "N", "Dual-leg V-string dead weight"],
      ["dryFlashoverKv", 1180.0, "kV", "Power-frequency dry flashover voltage (rms)"],
      ["wetFlashoverKv", 890.0, "kV", "Power-frequency wet flashover voltage (rms)"],
      ["maxSwingDeg", 0.0, "deg", "Restrained transverse swing (V-string geometry)"],
    ],
  },

  // =========================================================================
  // NESC C2 & IEC 60826 Weather Load Cases
  // =========================================================================
  {
    modelType: "LOAD_NESC_HEAVY",
    aliases: ["NESC_HEAVY", "NESC_250B_HEAVY"],
    label: "NESC Rule 250B Heavy Loading",
    category: "Weather Load Case",
    archetypeId: PlsCaddArchetypeId.LOAD_NESC,
    description:
      "NESC C2 Rule 250B Heavy Loading District: 12.7 mm (0.5 in) radial glaze ice, 191.52 Pa (4 psf) horizontal wind, -17.8 degC (0 degF), constant K = 4.378 N/m (0.30 lb/ft).",
    provenance: "NESC IEEE C2-2023 Rule 250B Table 250-1 (Heavy District)",
    params: [
      ["radialIceM", 0.0127, "m", "Radial glaze ice thickness (0.50 in)"],
      ["windPressurePa", 191.52, "Pa", "Horizontal wind pressure (4.0 psf)"],
      ["windSpeedMs", 17.68, "m/s", "Equivalent wind speed (~39.5 mph)"],
      ["nescConstantNPerM", 4.378, "N/m", "NESC Rule 250B additive constant K (0.30 lb/ft)"],
      ["tempC", -17.8, "degC", "Ambient temperature (0 degF)"],
      ["iceDensityKgPerM3", 913.0, "kg/m^3", "Glaze ice density (57 lb/ft^3)"],
      ["verticalOverloadFactor", 1.5, "-", "Grade B vertical overload factor (Table 253-1)"],
      ["transverseOverloadFactor", 2.5, "-", "Grade B wind overload factor (Table 253-1)"],
    ],
  },
  {
    modelType: "LOAD_NESC_MEDIUM",
    aliases: ["NESC_MEDIUM", "NESC_250B_MEDIUM"],
    label: "NESC Rule 250B Medium Loading",
    category: "Weather Load Case",
    archetypeId: PlsCaddArchetypeId.LOAD_NESC,
    description:
      "NESC C2 Rule 250B Medium Loading District: 6.35 mm (0.25 in) radial glaze ice, 191.52 Pa (4 psf) horizontal wind, -9.4 degC (15 degF), constant K = 2.919 N/m (0.20 lb/ft).",
    provenance: "NESC IEEE C2-2023 Rule 250B Table 250-1 (Medium District)",
    params: [
      ["radialIceM", 0.00635, "m", "Radial glaze ice thickness (0.25 in)"],
      ["windPressurePa", 191.52, "Pa", "Horizontal wind pressure (4.0 psf)"],
      ["windSpeedMs", 17.68, "m/s", "Equivalent wind speed (~39.5 mph)"],
      ["nescConstantNPerM", 2.919, "N/m", "NESC Rule 250B additive constant K (0.20 lb/ft)"],
      ["tempC", -9.4, "degC", "Ambient temperature (15 degF)"],
      ["iceDensityKgPerM3", 913.0, "kg/m^3", "Glaze ice density (57 lb/ft^3)"],
      ["verticalOverloadFactor", 1.5, "-", "Grade B vertical overload factor (Table 253-1)"],
      ["transverseOverloadFactor", 2.5, "-", "Grade B wind overload factor (Table 253-1)"],
    ],
  },
  {
    modelType: "LOAD_NESC_LIGHT",
    aliases: ["NESC_LIGHT", "NESC_250B_LIGHT"],
    label: "NESC Rule 250B Light Loading",
    category: "Weather Load Case",
    archetypeId: PlsCaddArchetypeId.LOAD_NESC,
    description:
      "NESC C2 Rule 250B Light Loading District: 0 mm ice, 430.92 Pa (9 psf) horizontal wind, -1.1 degC (30 degF), constant K = 0.730 N/m (0.05 lb/ft).",
    provenance: "NESC IEEE C2-2023 Rule 250B Table 250-1 (Light District)",
    params: [
      ["radialIceM", 0.0, "m", "Radial ice thickness (0 in)"],
      ["windPressurePa", 430.92, "Pa", "Horizontal wind pressure (9.0 psf)"],
      ["windSpeedMs", 26.52, "m/s", "Equivalent wind speed (~59.3 mph)"],
      ["nescConstantNPerM", 0.73, "N/m", "NESC Rule 250B additive constant K (0.05 lb/ft)"],
      ["tempC", -1.1, "degC", "Ambient temperature (30 degF)"],
      ["iceDensityKgPerM3", 913.0, "kg/m^3", "Reference ice density"],
      ["verticalOverloadFactor", 1.5, "-", "Grade B vertical overload factor (Table 253-1)"],
      ["transverseOverloadFactor", 2.5, "-", "Grade B wind overload factor (Table 253-1)"],
    ],
  },
  {
    modelType: "LOAD_NESC_EXTREME_WIND",
    aliases: ["NESC_250C", "EXTREME_WIND"],
    label: "NESC Rule 250C Extreme Wind",
    category: "Weather Load Case",
    archetypeId: PlsCaddArchetypeId.LOAD_NESC,
    description:
      "NESC C2 Rule 250C Extreme Wind Loading: 45 m/s (~100 mph 3-sec gust) bare conductor wind at 15.6 degC (60 degF), load factor 1.0.",
    provenance: "NESC IEEE C2-2023 Rule 250C (Extreme Wind Loading)",
    params: [
      ["radialIceM", 0.0, "m", "No ice accumulation"],
      ["windPressurePa", 1240.3, "Pa", "Extreme wind velocity pressure (0.5 * 1.225 * 45^2)"],
      ["windSpeedMs", 45.0, "m/s", "3-second gust basic wind speed (~100 mph)"],
      ["nescConstantNPerM", 0.0, "N/m", "No Rule 250B additive constant"],
      ["tempC", 15.6, "degC", "Ambient temperature (60 degF)"],
      ["iceDensityKgPerM3", 913.0, "kg/m^3", "Reference ice density"],
      ["verticalOverloadFactor", 1.0, "-", "Rule 250C vertical load factor"],
      ["transverseOverloadFactor", 1.0, "-", "Rule 250C transverse load factor"],
    ],
  },
  {
    modelType: "LOAD_NESC_ICE_WIND",
    aliases: ["NESC_250D", "EXTREME_ICE_WIND"],
    label: "NESC Rule 250D Extreme Ice w/ Wind",
    category: "Weather Load Case",
    archetypeId: PlsCaddArchetypeId.LOAD_NESC,
    description:
      "NESC C2 Rule 250D Extreme Ice with Concurrent Wind: 25.4 mm (1.0 in) radial glaze ice with 18 m/s (40 mph) concurrent wind at -9.4 degC (15 degF).",
    provenance: "NESC IEEE C2-2023 Rule 250D (Extreme Ice with Concurrent Wind)",
    params: [
      ["radialIceM", 0.0254, "m", "Extreme radial glaze ice thickness (1.0 in)"],
      ["windPressurePa", 198.45, "Pa", "Concurrent wind pressure (0.5 * 1.225 * 18^2)"],
      ["windSpeedMs", 18.0, "m/s", "Concurrent wind speed (~40 mph)"],
      ["nescConstantNPerM", 0.0, "N/m", "No Rule 250B additive constant"],
      ["tempC", -9.4, "degC", "Ambient temperature (15 degF)"],
      ["iceDensityKgPerM3", 913.0, "kg/m^3", "Glaze ice density (57 lb/ft^3)"],
      ["verticalOverloadFactor", 1.0, "-", "Rule 250D vertical load factor"],
      ["transverseOverloadFactor", 1.0, "-", "Rule 250D transverse load factor"],
    ],
  },
  {
    modelType: "LOAD_IEC_60826_WIND",
    aliases: ["IEC_60826_WIND", "IEC_WIND"],
    label: "IEC 60826 Extreme Wind Limit State",
    category: "Weather Load Case",
    archetypeId: PlsCaddArchetypeId.LOAD_IEC,
    description:
      "IEC 60826 reliability-based extreme wind limit state: 36 m/s 10-minute mean reference wind speed, bare conductor, 15 degC.",
    provenance: "IEC 60826:2017 Clause 6.2 (Wind Loads on Overhead Transmission Lines)",
    params: [
      ["radialIceM", 0.0, "m", "Bare conductor (no ice)"],
      ["windPressurePa", 793.8, "Pa", "Reference dynamic wind pressure (0.5 * 1.225 * 36^2)"],
      ["windSpeedMs", 36.0, "m/s", "10-minute mean reference wind speed (50-yr return)"],
      ["nescConstantNPerM", 0.0, "N/m", "Not applicable in IEC 60826"],
      ["tempC", 15.0, "degC", "Reference ambient temperature"],
      ["iceDensityKgPerM3", 900.0, "kg/m^3", "IEC glaze ice density"],
      ["verticalOverloadFactor", 1.0, "-", "IEC reliability class vertical factor"],
      ["transverseOverloadFactor", 1.0, "-", "IEC reliability class wind factor"],
    ],
  },
  {
    modelType: "LOAD_IEC_60826_ICE",
    aliases: ["IEC_60826_ICE", "IEC_ICE_WIND"],
    label: "IEC 60826 Combined Ice & Wind",
    category: "Weather Load Case",
    archetypeId: PlsCaddArchetypeId.LOAD_IEC,
    description:
      "IEC 60826 reliability-based combined glaze ice and concurrent wind limit state: 20 mm radial ice (900 kg/m^3) with 15 m/s wind at -5 degC.",
    provenance: "IEC 60826:2017 Clause 6.3–6.4 (Ice Loads & Combined Wind-on-Ice)",
    params: [
      ["radialIceM", 0.02, "m", "Radial glaze ice thickness (20 mm)"],
      ["windPressurePa", 137.81, "Pa", "Concurrent wind pressure (0.5 * 1.225 * 15^2)"],
      ["windSpeedMs", 15.0, "m/s", "Concurrent wind speed during icing"],
      ["nescConstantNPerM", 0.0, "N/m", "Not applicable in IEC 60826"],
      ["tempC", -5.0, "degC", "Icing ambient temperature"],
      ["iceDensityKgPerM3", 900.0, "kg/m^3", "IEC 60826 glaze ice density"],
      ["verticalOverloadFactor", 1.0, "-", "IEC reliability class vertical factor"],
      ["transverseOverloadFactor", 1.0, "-", "IEC reliability class transverse factor"],
    ],
  },
];

/**
 * Converts `PLSCADD_MODEL_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG icons and port layouts.
 */
export function buildPlsCaddCleanroomSchemas(): CleanroomModelSchema[] {
  return PLSCADD_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `plscadd:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "electrical",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "plscadd_model",
      width: 80,
      height: 48,
      svg: generatePlsCaddSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
