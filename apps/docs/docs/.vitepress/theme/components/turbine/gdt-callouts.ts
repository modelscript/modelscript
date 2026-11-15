// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  formatFeatureControlFrameText,
  GDT_CHAR_SYMBOLS,
  type GdtCallout3D,
  type GdtDatumFeature3D,
  type GdtOverlayPayload,
} from "@modelscript/cad/gdt-overlay";

export interface TurbineGdtCalloutMeta {
  callout: GdtCallout3D;
  sectionId: "fan" | "hpc" | "combustor" | "turbine";
  qifCharacteristicId: string;
  actualDeviationMm: number;
  fcfText: string;
}

export const TURBINE_GDT_DATUMS: readonly GdtDatumFeature3D[] = [
  {
    label: "A",
    name: "Fan Frame Mounting Plane",
    anchor: [-1.15, 0.44, 0.0],
    sourceRef: "F_DATUM_A",
  },
  {
    label: "B",
    name: "LP/HP Coaxial Centerline Axis",
    anchor: [-0.08, 0.0, 0.0],
    sourceRef: "F_DATUM_B",
  },
  {
    label: "C",
    name: "Clocking Keyway Datum",
    anchor: [-1.15, -0.46, 0.24],
    sourceRef: "F_DATUM_C",
  },
];

const RAW_CALLOUTS: readonly {
  callout: GdtCallout3D;
  sectionId: "fan" | "hpc" | "combustor" | "turbine";
  qifCharacteristicId: string;
  actualDeviationMm: number;
}[] = [
  {
    sectionId: "fan",
    qifCharacteristicId: "C_FAN_RUNOUT",
    actualDeviationMm: 0.019,
    callout: {
      id: "gdt-fan-runout",
      characteristic: "total_runout",
      symbol: GDT_CHAR_SYMBOLS.total_runout,
      tolerance: 0.035,
      unit: "mm",
      diametrical: false,
      materialCondition: "RFS",
      datums: [{ label: "B" }, { label: "A" }],
      anchor: [-1.92, 1.48, 0.2],
      measured: 0.019,
      sourceRef: "C_FAN_RUNOUT",
      label: "Fan Tip Shroud Total Runout",
      note: "Controls cold/hot rub envelope along intake acoustic liner (actual 0.019 mm).",
      status: "PASS",
    },
  },
  {
    sectionId: "hpc",
    qifCharacteristicId: "C_SHAFT_POS",
    actualDeviationMm: 0.012,
    callout: {
      id: "gdt-shaft-pos",
      characteristic: "position",
      symbol: GDT_CHAR_SYMBOLS.position,
      tolerance: 0.025,
      unit: "mm",
      diametrical: true,
      materialCondition: "MMC",
      datums: [{ label: "A" }, { label: "B", modifier: "MMC" }, { label: "C" }],
      anchor: [-0.3, 0.56, 0.08],
      measured: 0.012,
      sourceRef: "C_SHAFT_POS",
      label: "HP/LP Bearing Journal Coaxiality",
      note: "7-stage N2 drum to inter-shaft roller bearing concentricity (actual 0.012 mm).",
      status: "PASS",
    },
  },
  {
    sectionId: "hpc",
    qifCharacteristicId: "C_HPC_CYL",
    actualDeviationMm: 0.011,
    callout: {
      id: "gdt-hpc-cyl",
      characteristic: "cylindricity",
      symbol: GDT_CHAR_SYMBOLS.cylindricity,
      tolerance: 0.018,
      unit: "mm",
      diametrical: false,
      materialCondition: "RFS",
      datums: [],
      anchor: [-0.55, 0.52, -0.14],
      measured: 0.011,
      sourceRef: "C_HPC_CYL",
      label: "HPC Ti-6Al-4V Casing Cylindricity",
      note: "Maintains uniform 0.42 mm compressor blade tip clearance across stages 1–7.",
      status: "PASS",
    },
  },
  {
    sectionId: "combustor",
    qifCharacteristicId: "C_COMB_PROF",
    actualDeviationMm: 0.068,
    callout: {
      id: "gdt-comb-prof",
      characteristic: "profile_surface",
      symbol: GDT_CHAR_SYMBOLS.profile_surface,
      tolerance: 0.08,
      unit: "mm",
      diametrical: false,
      materialCondition: "RFS",
      datums: [{ label: "A" }, { label: "B" }],
      anchor: [0.75, 0.575, 0.0],
      measured: 0.068,
      sourceRef: "C_COMB_PROF",
      label: "Annular Combustor Liner Profile",
      note: "TBC-coated superalloy flame tube profile at T_04 = 1650 K (actual 0.068 mm).",
      status: "MARGINAL",
    },
  },
  {
    sectionId: "turbine",
    qifCharacteristicId: "C_LPT_PERP",
    actualDeviationMm: 0.008,
    callout: {
      id: "gdt-lpt-perp",
      characteristic: "perpendicularity",
      symbol: GDT_CHAR_SYMBOLS.perpendicularity,
      tolerance: 0.015,
      unit: "mm",
      diametrical: false,
      materialCondition: "RFS",
      datums: [{ label: "B" }, { label: "A" }],
      anchor: [1.95, 0.64, 0.0],
      measured: 0.008,
      sourceRef: "C_LPT_PERP",
      label: "LPT Stage-1 Hub Face Perpendicularity",
      note: "Locks N1 LP turbine disk face squareness to main shaft centerline.",
      status: "PASS",
    },
  },
];

export const TURBINE_GDT_ITEMS: readonly TurbineGdtCalloutMeta[] = RAW_CALLOUTS.map((entry) => ({
  ...entry,
  fcfText: formatFeatureControlFrameText(entry.callout),
}));

export const TURBINE_GDT_OVERLAY: GdtOverlayPayload = {
  datums: TURBINE_GDT_DATUMS,
  callouts: RAW_CALLOUTS.map((r) => r.callout),
};
