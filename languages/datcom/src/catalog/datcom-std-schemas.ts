// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Cleanroom archetype IDs matching `assets/datcom-std-lib/src/models.ts`.
 */
export const DatcomArchetypeId = {
  // NACA Airfoil Catalog
  NACA_0012: 1,
  NACA_2412: 2,
  NACA_4412: 3,
  NACA_23012: 4,
  NACA_64A010: 5,
  // Standard Aircraft Configuration Templates
  CESSNA_172: 10,
  CITATION_JET: 11,
  SUPERSONIC_DELTA: 12,
} as const;

export type DatcomArchetypeId = (typeof DatcomArchetypeId)[keyof typeof DatcomArchetypeId];

export type DatcomModelCategory = "NACA Airfoils" | "Aircraft Configurations";

export interface DatcomModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: DatcomModelCategory;
  archetypeId: DatcomArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<DatcomModelCategory, { fill: string; stroke: string; badge: string }> = {
  "NACA Airfoils": { fill: "#1e3a5f", stroke: "#38bdf8", badge: "NACA" },
  "Aircraft Configurations": { fill: "#2e2447", stroke: "#a78bfa", badge: "ACFT" },
};

export function generateDatcomBlockSvg(modelType: string, category: DatcomModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 12);
  const fontSize = label.length > 9 ? "7.5" : "9.0";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 52" width="96" height="52">` +
    `<rect x="2" y="2" width="92" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="30" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="21" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="48" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForSpec(spec: DatcomModelSpec): DiagramPortSpec[] {
  if (spec.category === "NACA Airfoils") {
    return [
      { name: "alpha_in", kind: "signal", side: "left", dx: 0, dy: 26 },
      { name: "cl_cd_cm_out", kind: "signal", side: "right", dx: 96, dy: 26 },
    ];
  }
  return [
    { name: "fltcon_in", kind: "signal", side: "left", dx: 0, dy: 18 },
    { name: "controls_in", kind: "signal", side: "left", dx: 0, dy: 34 },
    { name: "aero_out", kind: "signal", side: "right", dx: 96, dy: 18 },
    { name: "modes_out", kind: "signal", side: "right", dx: 96, dy: 34 },
  ];
}

export const DATCOM_STD_SPECS: DatcomModelSpec[] = [
  // --- NACA Airfoil Catalog ---
  {
    modelType: "NACA_0012",
    aliases: ["0012", "NACA0012", "NACA-W-4-0012"],
    label: "NACA 0012 Symmetric Airfoil",
    category: "NACA Airfoils",
    archetypeId: DatcomArchetypeId.NACA_0012,
    description: "Symmetric 12% thickness NACA 4-digit airfoil section (Abbott & von Doenhoff).",
    provenance: "NACA TR-824 / USAF Digital DATCOM",
    params: [
      ["TC", 0.12, "1", "Maximum thickness-to-chord ratio"],
      ["CAMBER", 0.0, "1", "Maximum camber-to-chord ratio"],
      ["ALPHA_L0", 0.0, "deg", "Zero-lift angle of attack"],
      ["CL_ALPHA", 6.283185, "1/rad", "2D section lift-curve slope"],
      ["CD0", 0.0056, "1", "Minimum section profile drag coefficient"],
      ["CM_AC", 0.0, "1", "Quarter-chord pitching moment coefficient"],
    ],
  },
  {
    modelType: "NACA_2412",
    aliases: ["2412", "NACA2412", "NACA-W-4-2412"],
    label: "NACA 2412 Cambered Airfoil",
    category: "NACA Airfoils",
    archetypeId: DatcomArchetypeId.NACA_2412,
    description: "2% camber at 40% chord, 12% thickness NACA 4-digit airfoil (Cessna 172 root/tip).",
    provenance: "NACA TR-824 / USAF Digital DATCOM",
    params: [
      ["TC", 0.12, "1", "Maximum thickness-to-chord ratio"],
      ["CAMBER", 0.02, "1", "Maximum camber-to-chord ratio"],
      ["ALPHA_L0", -2.1, "deg", "Zero-lift angle of attack"],
      ["CL_ALPHA", 6.283185, "1/rad", "2D section lift-curve slope"],
      ["CD0", 0.0058, "1", "Minimum section profile drag coefficient"],
      ["CM_AC", -0.05, "1", "Quarter-chord pitching moment coefficient"],
    ],
  },
  {
    modelType: "NACA_4412",
    aliases: ["4412", "NACA4412", "NACA-W-4-4412"],
    label: "NACA 4412 High-Camber Airfoil",
    category: "NACA Airfoils",
    archetypeId: DatcomArchetypeId.NACA_4412,
    description: "4% camber at 40% chord, 12% thickness NACA 4-digit high-lift airfoil.",
    provenance: "NACA TR-824 / USAF Digital DATCOM",
    params: [
      ["TC", 0.12, "1", "Maximum thickness-to-chord ratio"],
      ["CAMBER", 0.04, "1", "Maximum camber-to-chord ratio"],
      ["ALPHA_L0", -4.0, "deg", "Zero-lift angle of attack"],
      ["CL_ALPHA", 6.283185, "1/rad", "2D section lift-curve slope"],
      ["CD0", 0.0062, "1", "Minimum section profile drag coefficient"],
      ["CM_AC", -0.095, "1", "Quarter-chord pitching moment coefficient"],
    ],
  },
  {
    modelType: "NACA_23012",
    aliases: ["23012", "NACA23012", "NACA-W-5-23012"],
    label: "NACA 23012 Reflex-Mean 5-Digit Airfoil",
    category: "NACA Airfoils",
    archetypeId: DatcomArchetypeId.NACA_23012,
    description: "Low pitching-moment 5-digit airfoil (design CL=0.3, 12% thickness).",
    provenance: "NACA TR-824 / USAF Digital DATCOM",
    params: [
      ["TC", 0.12, "1", "Maximum thickness-to-chord ratio"],
      ["CAMBER", 0.018, "1", "Maximum camber-to-chord ratio"],
      ["ALPHA_L0", -1.2, "deg", "Zero-lift angle of attack"],
      ["CL_ALPHA", 6.283185, "1/rad", "2D section lift-curve slope"],
      ["CD0", 0.0055, "1", "Minimum section profile drag coefficient"],
      ["CM_AC", -0.008, "1", "Quarter-chord pitching moment coefficient"],
    ],
  },
  {
    modelType: "NACA_64A010",
    aliases: ["64A010", "NACA64A010", "NACA-W-6-64A010"],
    label: "NACA 64A010 Laminar High-Speed Airfoil",
    category: "NACA Airfoils",
    archetypeId: DatcomArchetypeId.NACA_64A010,
    description: "Symmetric 10% thickness 6-series laminar airfoil for transonic/supersonic wings.",
    provenance: "NACA TR-824 / USAF Digital DATCOM",
    params: [
      ["TC", 0.1, "1", "Maximum thickness-to-chord ratio"],
      ["CAMBER", 0.0, "1", "Maximum camber-to-chord ratio"],
      ["ALPHA_L0", 0.0, "deg", "Zero-lift angle of attack"],
      ["CL_ALPHA", 6.283185, "1/rad", "2D section lift-curve slope"],
      ["CD0", 0.0046, "1", "Minimum section profile drag coefficient"],
      ["CM_AC", 0.0, "1", "Quarter-chord pitching moment coefficient"],
    ],
  },

  // --- Standard Aircraft Configuration Templates ---
  {
    modelType: "CESSNA_172",
    aliases: ["C172", "SKYHAWK"],
    label: "Cessna-172 Class Light Trainer",
    category: "Aircraft Configurations",
    archetypeId: DatcomArchetypeId.CESSNA_172,
    description: "High-wing general aviation single-engine trainer (AR=7.38, NACA 2412, M=0.18).",
    provenance: "USAF Digital DATCOM / Roskam Airplane Flight Dynamics",
    params: [
      ["SREF", 16.17, "m2", "Reference wing area"],
      ["CBARR", 1.49, "m", "Mean aerodynamic chord"],
      ["BLREF", 10.92, "m", "Reference wing span"],
      ["AR", 7.38, "1", "Wing aspect ratio"],
      ["SWEEP_DEG", 0.0, "deg", "Wing quarter-chord sweep"],
      ["MASS", 1043.0, "kg", "Gross aircraft mass"],
      ["MACH", 0.18, "1", "Nominal cruise Mach number"],
    ],
  },
  {
    modelType: "CITATION_JET",
    aliases: ["CITATION", "C550", "BIZJET"],
    label: "Citation-Class Business Jet",
    category: "Aircraft Configurations",
    archetypeId: DatcomArchetypeId.CITATION_JET,
    description: "Medium-sweep subsonic twin-turbofan business jet (AR=8.2, NACA 23012, M=0.65).",
    provenance: "USAF Digital DATCOM / Roskam Airplane Flight Dynamics",
    params: [
      ["SREF", 29.9, "m2", "Reference wing area"],
      ["CBARR", 2.06, "m", "Mean aerodynamic chord"],
      ["BLREF", 15.76, "m", "Reference wing span"],
      ["AR", 8.31, "1", "Wing aspect ratio"],
      ["SWEEP_DEG", 15.0, "deg", "Wing quarter-chord sweep"],
      ["MASS", 5800.0, "kg", "Nominal cruise mass"],
      ["MACH", 0.65, "1", "Nominal cruise Mach number"],
    ],
  },
  {
    modelType: "SUPERSONIC_DELTA",
    aliases: ["DELTA", "F106", "SUPERSONIC"],
    label: "Supersonic Delta Fighter",
    category: "Aircraft Configurations",
    archetypeId: DatcomArchetypeId.SUPERSONIC_DELTA,
    description: "Low-aspect-ratio 55-deg swept supersonic delta interceptor (NACA 64A010, M=1.6).",
    provenance: "USAF Digital DATCOM / Etkin Dynamics of Flight",
    params: [
      ["SREF", 48.0, "m2", "Reference wing area"],
      ["CBARR", 5.8, "m", "Mean aerodynamic chord"],
      ["BLREF", 11.4, "m", "Reference wing span"],
      ["AR", 2.71, "1", "Wing aspect ratio"],
      ["SWEEP_DEG", 55.0, "deg", "Wing leading-edge sweep"],
      ["MASS", 12500.0, "kg", "Nominal combat mass"],
      ["MACH", 1.6, "1", "Nominal supersonic Mach number"],
    ],
  },
];

/**
 * Ready-to-parse Digital DATCOM input decks for the 3 standard aircraft configurations.
 */
export const DATCOM_AIRCRAFT_TEMPLATES: Record<"CESSNA_172" | "CITATION_JET" | "SUPERSONIC_DELTA", string> = {
  CESSNA_172: [
    "CASEID CESSNA 172 CLASS TRAINER",
    "DIM M",
    "DERIV DEG",
    "DAMP",
    " $FLTCON NMACH=1.0, MACH(1)=0.18,",
    "  NALPHA=7.0, ALSCHD(1)=-4.0,-2.0,0.0,2.0,4.0,6.0,8.0,",
    "  NALT=1.0, ALT(1)=1500.0, WT=10230.0$",
    " $OPTINS SREF=16.17, CBARR=1.49, BLREF=10.92$",
    " $SYNTHS XCG=2.55, ZCG=0.0, XW=2.1, ZW=0.3, ALIW=1.5,",
    "  XH=6.7, ZH=0.1, ALIH=-1.5, XV=6.6, ZV=0.2, VERTUP=.TRUE.$",
    " $WGPLNF CHRDR=1.63, CHRDTP=1.12, SSPN=5.46, SSPNE=5.0, SAVSI=0.0, CHSTAT=0.25, DHDADI=1.7, TYPE=1.0$",
    "NACA-W-4-2412",
    " $HTPLNF CHRDR=1.1, CHRDTP=0.75, SSPN=1.73, SSPNE=1.6, SAVSI=5.0, CHSTAT=0.25, TYPE=1.0$",
    "NACA-H-4-0012",
    " $VTPLNF CHRDR=1.4, CHRDTP=0.7, SSPN=1.45, SSPNE=1.35, SAVSI=30.0, CHSTAT=0.25, TYPE=1.0$",
    "NACA-V-4-0012",
    "BUILD",
    "NEXT CASE",
    "",
  ].join("\n"),

  CITATION_JET: [
    "CASEID CITATION CLASS BUSINESS JET",
    "DIM M",
    "DERIV DEG",
    "DAMP",
    " $FLTCON NMACH=1.0, MACH(1)=0.65,",
    "  NALPHA=7.0, ALSCHD(1)=-2.0,0.0,2.0,4.0,6.0,8.0,10.0,",
    "  NALT=1.0, ALT(1)=10000.0, WT=56880.0$",
    " $OPTINS SREF=29.9, CBARR=2.06, BLREF=15.76$",
    " $SYNTHS XCG=5.8, ZCG=0.0, XW=5.0, ZW=-0.3, ALIW=1.0,",
    "  XH=12.2, ZH=0.8, ALIH=-1.0, XV=11.8, ZV=0.5, VERTUP=.TRUE.$",
    " $WGPLNF CHRDR=2.65, CHRDTP=1.14, SSPN=7.88, SSPNE=7.1, SAVSI=15.0, CHSTAT=0.25, DHDADI=3.0, TYPE=1.0$",
    "NACA-W-5-23012",
    " $HTPLNF CHRDR=1.45, CHRDTP=0.85, SSPN=2.85, SSPNE=2.6, SAVSI=20.0, CHSTAT=0.25, TYPE=1.0$",
    "NACA-H-4-0012",
    " $VTPLNF CHRDR=2.2, CHRDTP=1.1, SSPN=2.4, SSPNE=2.2, SAVSI=35.0, CHSTAT=0.25, TYPE=1.0$",
    "NACA-V-4-0012",
    "BUILD",
    "NEXT CASE",
    "",
  ].join("\n"),

  SUPERSONIC_DELTA: [
    "CASEID SUPERSONIC DELTA INTERCEPTOR",
    "DIM M",
    "DERIV DEG",
    "DAMP",
    " $FLTCON NMACH=1.0, MACH(1)=1.6,",
    "  NALPHA=6.0, ALSCHD(1)=-2.0,0.0,2.0,4.0,6.0,8.0,",
    "  NALT=1.0, ALT(1)=12000.0, WT=122580.0$",
    " $OPTINS SREF=48.0, CBARR=5.8, BLREF=11.4$",
    " $SYNTHS XCG=9.2, ZCG=0.0, XW=6.0, ZW=-0.2, ALIW=0.0,",
    "  XV=12.0, ZV=0.5, VERTUP=.TRUE.$",
    " $WGPLNF CHRDR=7.6, CHRDTP=0.82, SSPN=5.7, SSPNE=5.0, SAVSI=55.0, CHSTAT=0.0, DHDADI=0.0, TYPE=1.0$",
    "NACA-W-6-64A010",
    " $VTPLNF CHRDR=3.5, CHRDTP=1.0, SSPN=2.8, SSPNE=2.5, SAVSI=48.0, CHSTAT=0.25, TYPE=1.0$",
    "NACA-V-6-64A010",
    "BUILD",
    "NEXT CASE",
    "",
  ].join("\n"),
};

/**
 * Builds the declarative `CleanroomModelSchema[]` array for `@modelscript/datcom-std-lib`.
 */
export function buildDatcomCleanroomSchemas(): CleanroomModelSchema[] {
  return DATCOM_STD_SPECS.map((spec): CleanroomModelSchema => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `DATCOM.${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "aerospace",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Class",
      width: 96,
      height: 52,
      svg: generateDatcomBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForSpec(spec),
      parameters,
      wasmKernel: "datcomModelEval",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}
