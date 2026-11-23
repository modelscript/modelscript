// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/fits — Cleanroom FITS 4.0 Mandatory & WCS Keyword Standard Library Schemas.
 */

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Archetype IDs matching `assets/fits-std-lib/src/models.ts`.
 */
export const FitsArchetypeId = {
  SIMPLE: 1,
  BITPIX: 2,
  NAXIS: 3,
  BSCALE: 4,
  BZERO: 5,
  XTENSION: 6,
  TFIELDS: 7,
  RA_TAN: 10,
  DEC_TAN: 11,
  RA_SIN: 12,
  RA_ARC: 13,
  CRVAL: 14,
  CRPIX: 15,
  CDELT: 16,
  CD_MATRIX: 17,
} as const;

export type FitsArchetypeId = (typeof FitsArchetypeId)[keyof typeof FitsArchetypeId];

export type FitsSchemaCategory = "Mandatory Header" | "Physical Scaling" | "Extension Table" | "WCS Astrometry";

export interface FitsKeywordSpec {
  name: string;
  aliases?: string[];
  label: string;
  category: FitsSchemaCategory;
  archetypeId: FitsArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<FitsSchemaCategory, { fill: string; stroke: string; badge: string }> = {
  "Mandatory Header": { fill: "#1e293b", stroke: "#38bdf8", badge: "HDR" },
  "Physical Scaling": { fill: "#1e3a2f", stroke: "#34d399", badge: "SCL" },
  "Extension Table": { fill: "#3b234a", stroke: "#c084fc", badge: "EXT" },
  "WCS Astrometry": { fill: "#3b2513", stroke: "#fbbf24", badge: "WCS" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for a FITS 4.0 keyword / WCS schema.
 */
export function generateFitsBlockSvg(name: string, category: FitsSchemaCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = name.toUpperCase().slice(0, 10);
  const fontSize = label.length > 8 ? "8.0" : "9.5";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">` +
    `<rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="28" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="20" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPorts(category: FitsSchemaCategory): DiagramPortSpec[] {
  if (category === "WCS Astrometry") {
    return [
      { name: "pixel_in", kind: "signal", side: "left", dx: 0, dy: 26 },
      { name: "sky_out", kind: "signal", side: "right", dx: 88, dy: 26 },
    ];
  }
  return [
    { name: "raw_in", kind: "signal", side: "left", dx: 0, dy: 26 },
    { name: "phys_out", kind: "signal", side: "right", dx: 88, dy: 26 },
  ];
}

const FITS_SPECS: FitsKeywordSpec[] = [
  {
    name: "SIMPLE",
    aliases: ["PRIMARY_HEADER"],
    label: "SIMPLE (Primary Conformance)",
    category: "Mandatory Header",
    archetypeId: FitsArchetypeId.SIMPLE,
    description: "Mandatory logical first keyword of a Primary HDU indicating FITS 4.0 conformance (T/F).",
    provenance: "IAU FITS 4.0 Standard §4.4.1.1",
    params: [["conforms", 1, "bool", "1 for T (conforms to FITS 4.0), 0 for F"]],
  },
  {
    name: "BITPIX",
    aliases: ["DATA_BITS"],
    label: "BITPIX (Bits Per Pixel)",
    category: "Mandatory Header",
    archetypeId: FitsArchetypeId.BITPIX,
    description:
      "Mandatory integer specifying bits per pixel: 8, 16, 32, 64 (big-endian int) or -32, -64 (IEEE float).",
    provenance: "IAU FITS 4.0 Standard §4.4.1.1",
    params: [["bitpix", -32, "bits", "Bits per data value (-32 = IEEE 754 float32)"]],
  },
  {
    name: "NAXIS",
    aliases: ["NAXIS1", "NAXIS2"],
    label: "NAXIS (Data Array Axes)",
    category: "Mandatory Header",
    archetypeId: FitsArchetypeId.NAXIS,
    description: "Mandatory integer specifying number of axes (0..999) in the associated data array.",
    provenance: "IAU FITS 4.0 Standard §4.4.1.1",
    params: [
      ["naxis", 2, "count", "Number of axes"],
      ["naxis1", 512, "px", "Length of axis 1 (columns)"],
      ["naxis2", 512, "px", "Length of axis 2 (rows)"],
    ],
  },
  {
    name: "BSCALE",
    aliases: ["SCALE"],
    label: "BSCALE (Physical Scale Factor)",
    category: "Physical Scaling",
    archetypeId: FitsArchetypeId.BSCALE,
    description:
      "Linear scaling coefficient converting stored array values to physical units: physical = BZERO + BSCALE * raw.",
    provenance: "IAU FITS 4.0 Standard §4.4.2.5",
    params: [
      ["bscale", 1.0, "1", "Linear scaling multiplier (must be non-zero)"],
      ["bzero", 0.0, "1", "Companion physical offset"],
    ],
  },
  {
    name: "BZERO",
    aliases: ["OFFSET"],
    label: "BZERO (Physical Zero Offset)",
    category: "Physical Scaling",
    archetypeId: FitsArchetypeId.BZERO,
    description: "Physical zero-point offset added to scaled array values (e.g., 32768 for unsigned 16-bit integers).",
    provenance: "IAU FITS 4.0 Standard §4.4.2.5",
    params: [
      ["bzero", 32768.0, "1", "Physical zero offset"],
      ["bscale", 1.0, "1", "Companion linear scaling factor"],
    ],
  },
  {
    name: "XTENSION",
    aliases: ["IMAGE", "TABLE", "BINTABLE"],
    label: "XTENSION (Extension HDU Type)",
    category: "Extension Table",
    archetypeId: FitsArchetypeId.XTENSION,
    description: "Mandatory first keyword of an extension HDU declaring 'IMAGE', 'TABLE', or 'BINTABLE'.",
    provenance: "IAU FITS 4.0 Standard §4.4.1.2",
    params: [
      ["pcount", 0, "bytes", "Random group / heap parameter count"],
      ["gcount", 1, "count", "Group count (1 for standard extensions)"],
    ],
  },
  {
    name: "TFIELDS",
    aliases: ["TTYPE", "TFORM"],
    label: "TFIELDS (Table Field Count)",
    category: "Extension Table",
    archetypeId: FitsArchetypeId.TFIELDS,
    description: "Number of columns (fields) in each row of a TABLE or BINTABLE extension.",
    provenance: "IAU FITS 4.0 Standard §7.2–7.3",
    params: [["tfields", 1, "count", "Number of fields per row"]],
  },
  {
    name: "RA---TAN",
    aliases: ["TAN", "GNOMONIC"],
    label: "RA---TAN (Gnomonic Tangent Projection)",
    category: "WCS Astrometry",
    archetypeId: FitsArchetypeId.RA_TAN,
    description:
      "Right Ascension axis with gnomonic (tangent-plane) zenithal projection per Calabretta & Greisen (2002).",
    provenance: "FITS WCS Paper II (A&A 395, 1077)",
    params: [
      ["crval1", 180.0, "deg", "Reference Right Ascension (J2000 deg)"],
      ["crval2", 0.0, "deg", "Reference Declination (J2000 deg)"],
      ["crpix1", 256.5, "px", "Reference X pixel (1-based)"],
      ["crpix2", 256.5, "px", "Reference Y pixel (1-based)"],
      ["cd1_1", -0.0002777778, "deg/px", "CD matrix element (1,1)"],
      ["cd2_2", 0.0002777778, "deg/px", "CD matrix element (2,2)"],
    ],
  },
  {
    name: "DEC--TAN",
    aliases: ["DECTAN"],
    label: "DEC--TAN (Declination Gnomonic Axis)",
    category: "WCS Astrometry",
    archetypeId: FitsArchetypeId.DEC_TAN,
    description: "Declination axis paired with RA---TAN for gnomonic celestial tangent-plane astrometry.",
    provenance: "FITS WCS Paper II (A&A 395, 1077)",
    params: [
      ["crval1", 180.0, "deg", "Reference Right Ascension (J2000 deg)"],
      ["crval2", 0.0, "deg", "Reference Declination (J2000 deg)"],
      ["crpix1", 256.5, "px", "Reference X pixel (1-based)"],
      ["crpix2", 256.5, "px", "Reference Y pixel (1-based)"],
    ],
  },
  {
    name: "RA---SIN",
    aliases: ["SIN", "ORTHOGRAPHIC", "DEC--SIN"],
    label: "RA---SIN (Slant Orthographic Projection)",
    category: "WCS Astrometry",
    archetypeId: FitsArchetypeId.RA_SIN,
    description: "Slant orthographic celestial projection widely used in radio interferometry synthesis imaging.",
    provenance: "FITS WCS Paper II (A&A 395, 1077)",
    params: [
      ["crval1", 180.0, "deg", "Reference Right Ascension (J2000 deg)"],
      ["crval2", 0.0, "deg", "Reference Declination (J2000 deg)"],
      ["crpix1", 256.5, "px", "Reference X pixel (1-based)"],
      ["crpix2", 256.5, "px", "Reference Y pixel (1-based)"],
      ["cd1_1", -0.0002777778, "deg/px", "CD matrix element (1,1)"],
      ["cd2_2", 0.0002777778, "deg/px", "CD matrix element (2,2)"],
    ],
  },
  {
    name: "RA---ARC",
    aliases: ["ARC", "ZENITHAL_EQUIDISTANT", "DEC--ARC"],
    label: "RA---ARC (Zenithal Equidistant Projection)",
    category: "WCS Astrometry",
    archetypeId: FitsArchetypeId.RA_ARC,
    description:
      "Zenithal equidistant (Schmidt camera) projection preserving true angular distance from the reference pole.",
    provenance: "FITS WCS Paper II (A&A 395, 1077)",
    params: [
      ["crval1", 180.0, "deg", "Reference Right Ascension (J2000 deg)"],
      ["crval2", 0.0, "deg", "Reference Declination (J2000 deg)"],
      ["crpix1", 256.5, "px", "Reference X pixel (1-based)"],
      ["crpix2", 256.5, "px", "Reference Y pixel (1-based)"],
      ["cd1_1", -0.0002777778, "deg/px", "CD matrix element (1,1)"],
      ["cd2_2", 0.0002777778, "deg/px", "CD matrix element (2,2)"],
    ],
  },
  {
    name: "CRVAL",
    aliases: ["CRVAL1", "CRVAL2"],
    label: "CRVAL (Reference World Coordinate)",
    category: "WCS Astrometry",
    archetypeId: FitsArchetypeId.CRVAL,
    description: "World coordinate value (RA/Dec in degrees) at the reference pixel CRPIX.",
    provenance: "IAU FITS 4.0 Standard §8.2",
    params: [
      ["crval1", 0.0, "deg", "Axis 1 reference world coordinate"],
      ["crval2", 0.0, "deg", "Axis 2 reference world coordinate"],
    ],
  },
  {
    name: "CRPIX",
    aliases: ["CRPIX1", "CRPIX2"],
    label: "CRPIX (Reference Pixel Coordinate)",
    category: "WCS Astrometry",
    archetypeId: FitsArchetypeId.CRPIX,
    description: "1-based pixel coordinates corresponding to the WCS fiducial point CRVAL.",
    provenance: "IAU FITS 4.0 Standard §8.2",
    params: [
      ["crpix1", 1.0, "px", "Axis 1 reference pixel"],
      ["crpix2", 1.0, "px", "Axis 2 reference pixel"],
    ],
  },
  {
    name: "CDELT",
    aliases: ["CDELT1", "CDELT2"],
    label: "CDELT (Coordinate Increment)",
    category: "WCS Astrometry",
    archetypeId: FitsArchetypeId.CDELT,
    description: "Coordinate increment per pixel along each axis at the reference point.",
    provenance: "IAU FITS 4.0 Standard §8.2",
    params: [
      ["cdelt1", -0.0002777778, "deg/px", "Axis 1 pixel scale"],
      ["cdelt2", 0.0002777778, "deg/px", "Axis 2 pixel scale"],
    ],
  },
  {
    name: "CD_MATRIX",
    aliases: ["CD1_1", "CD1_2", "CD2_1", "CD2_2"],
    label: "CD Matrix (Linear WCS Jacobian)",
    category: "WCS Astrometry",
    archetypeId: FitsArchetypeId.CD_MATRIX,
    description:
      "2x2 linear transformation matrix encoding plate scale, rotation, and shear from pixel to intermediate world coordinates.",
    provenance: "IAU FITS 4.0 Standard §8.2",
    params: [
      ["cd1_1", -0.0002777778, "deg/px", "d(xi)/dx"],
      ["cd1_2", 0.0, "deg/px", "d(xi)/dy"],
      ["cd2_1", 0.0, "deg/px", "d(eta)/dx"],
      ["cd2_2", 0.0002777778, "deg/px", "d(eta)/dy"],
    ],
  },
];

/**
 * Builds the complete cleanroom FITS 4.0 & WCS `CleanroomModelSchema[]` catalog.
 */
export function buildFitsCleanroomSchemas(): CleanroomModelSchema[] {
  return FITS_SPECS.map((spec): CleanroomModelSchema => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      ...(unit !== undefined ? { unit } : {}),
      ...(description !== undefined ? { description } : {}),
    }));

    return {
      namePath: `fits.${spec.name}`,
      name: spec.name,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "astronomy",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "fits_keyword",
      width: 88,
      height: 52,
      svg: generateFitsBlockSvg(spec.name, spec.category),
      ports: defaultPorts(spec.category),
      parameters,
      wasmKernel: "fitsEval",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}
