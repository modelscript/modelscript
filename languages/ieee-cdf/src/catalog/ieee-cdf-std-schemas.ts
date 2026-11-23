// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Cleanroom IEEE CDF / BPA IPF power-flow archetype IDs matching `assets/ieee-cdf-std-lib/src/models.ts`.
 */
export const IeeeCdfArchetypeId = {
  PQ_BUS: 1,
  PV_BUS: 2,
  SLACK_BUS: 3,
  TRANSMISSION_LINE: 10,
  TAP_TRANSFORMER: 11,
  PHASE_SHIFTER: 12,
  SHUNT_ELEMENT: 20,
} as const;

export type IeeeCdfArchetypeId = (typeof IeeeCdfArchetypeId)[keyof typeof IeeeCdfArchetypeId];

export type IeeeCdfModelCategory = "Buses" | "Branches" | "Shunts";

export interface IeeeCdfModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: IeeeCdfModelCategory;
  archetypeId: IeeeCdfArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<IeeeCdfModelCategory, { fill: string; stroke: string; badge: string }> = {
  Buses: { fill: "#1e3a5f", stroke: "#38bdf8", badge: "BUS" },
  Branches: { fill: "#1e3f2f", stroke: "#34d399", badge: "BRCH" },
  Shunts: { fill: "#3b234a", stroke: "#c084fc", badge: "SHNT" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for an IEEE CDF / BPA IPF archetype.
 */
export function generateIeeeCdfBlockSvg(modelType: string, category: IeeeCdfModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().replace(/_/g, " ").slice(0, 11);
  const fontSize = label.length > 9 ? "7.8" : "9.0";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 52" width="96" height="52">` +
    `<rect x="2" y="2" width="92" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="32" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="22" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="48" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: IeeeCdfModelCategory): DiagramPortSpec[] {
  if (category === "Branches") {
    return [
      { name: "from_bus", kind: "electrical", side: "left", dx: 0, dy: 26 },
      { name: "to_bus", kind: "electrical", side: "right", dx: 96, dy: 26 },
    ];
  }
  return [{ name: "terminal", kind: "electrical", side: "bottom", dx: 48, dy: 52 }];
}

export const IEEE_CDF_STD_SPECS: IeeeCdfModelSpec[] = [
  {
    modelType: "PQ_BUS",
    aliases: ["BUS_PQ", "LOAD_BUS", "B ", "TYPE_0", "TYPE_1"],
    label: "PQ Load Bus",
    category: "Buses",
    archetypeId: IeeeCdfArchetypeId.PQ_BUS,
    description: "Unregulated IEEE CDF Type 0/1 (BPA 'B ') load bus with specified active and reactive power.",
    provenance: "IEEE Working Group 1973 Common Format / BPA IPF",
    params: [
      ["P_LOAD", 0.0, "MW", "Active power load"],
      ["Q_LOAD", 0.0, "MVAR", "Reactive power load"],
      ["G_SHUNT", 0.0, "pu", "Nodal shunt conductance"],
      ["B_SHUNT", 0.0, "pu", "Nodal shunt susceptance"],
      ["BASE_KV", 138.0, "kV", "Nominal bus base voltage"],
    ],
  },
  {
    modelType: "PV_BUS",
    aliases: ["BUS_PV", "GEN_BUS", "BQ", "BE", "TYPE_2"],
    label: "PV Generator Bus",
    category: "Buses",
    archetypeId: IeeeCdfArchetypeId.PV_BUS,
    description: "Voltage-controlled IEEE CDF Type 2 (BPA 'BQ'/'BE') generator bus with reactive limits Qmin/Qmax.",
    provenance: "IEEE Working Group 1973 Common Format / BPA IPF",
    params: [
      ["P_GEN", 40.0, "MW", "Scheduled active power generation"],
      ["V_SET", 1.0, "pu", "Scheduled voltage magnitude"],
      ["Q_MAX", 50.0, "MVAR", "Maximum reactive power limit"],
      ["Q_MIN", -40.0, "MVAR", "Minimum reactive power limit"],
      ["BASE_KV", 138.0, "kV", "Nominal bus base voltage"],
    ],
  },
  {
    modelType: "SLACK_BUS",
    aliases: ["SWING_BUS", "REF_BUS", "BS", "TYPE_3"],
    label: "Slack / Swing Bus",
    category: "Buses",
    archetypeId: IeeeCdfArchetypeId.SLACK_BUS,
    description: "Reference angle and voltage magnitude bus (IEEE CDF Type 3 / BPA 'BS') balancing system losses.",
    provenance: "IEEE Working Group 1973 Common Format / BPA IPF",
    params: [
      ["V_SET", 1.06, "pu", "Slack bus voltage magnitude"],
      ["ANGLE_DEG", 0.0, "deg", "Reference voltage phase angle"],
      ["BASE_KV", 138.0, "kV", "Nominal bus base voltage"],
    ],
  },
  {
    modelType: "TRANSMISSION_LINE",
    aliases: ["LINE", "PI_LINE", "L ", "E ", "BRANCH_0"],
    label: "Transmission Line",
    category: "Branches",
    archetypeId: IeeeCdfArchetypeId.TRANSMISSION_LINE,
    description:
      "Nominal-pi transmission line (IEEE CDF Branch Type 0 / BPA 'L ') with series R+jX and total charging B.",
    provenance: "IEEE Working Group 1973 Common Format / BPA IPF",
    params: [
      ["R", 0.02, "pu", "Series resistance"],
      ["X", 0.06, "pu", "Series reactance"],
      ["B", 0.05, "pu", "Total line charging susceptance"],
      ["RATE_A", 100.0, "MVA", "Normal thermal rating"],
    ],
  },
  {
    modelType: "TAP_TRANSFORMER",
    aliases: ["TRANSFORMER", "XFMR", "TCUL", "T ", "R ", "BRANCH_1", "BRANCH_2"],
    label: "Tap-Changing Transformer",
    category: "Branches",
    archetypeId: IeeeCdfArchetypeId.TAP_TRANSFORMER,
    description:
      "Off-nominal tap-changing transformer (IEEE CDF Branch Type 1/2/3 / BPA 'T '/'R ') with turns ratio a.",
    provenance: "IEEE Working Group 1973 Common Format / BPA IPF",
    params: [
      ["R", 0.0, "pu", "Winding resistance"],
      ["X", 0.2, "pu", "Leakage reactance"],
      ["TAP_RATIO", 0.978, "pu", "Off-nominal turns ratio on tap side"],
      ["MIN_TAP", 0.9, "pu", "Minimum tap ratio"],
      ["MAX_TAP", 1.1, "pu", "Maximum tap ratio"],
    ],
  },
  {
    modelType: "PHASE_SHIFTER",
    aliases: ["PAR", "PHASE_SHIFTING_TRANSFORMER", "BRANCH_4"],
    label: "Phase-Shifting Transformer",
    category: "Branches",
    archetypeId: IeeeCdfArchetypeId.PHASE_SHIFTER,
    description:
      "Phase-angle regulating transformer (IEEE CDF Branch Type 4) with complex turns ratio a * exp(j * phi).",
    provenance: "IEEE Working Group 1973 Common Format",
    params: [
      ["R", 0.0, "pu", "Winding resistance"],
      ["X", 0.15, "pu", "Leakage reactance"],
      ["TAP_RATIO", 1.0, "pu", "Off-nominal turns ratio"],
      ["PHASE_SHIFT_DEG", 5.0, "deg", "Phase shift angle"],
    ],
  },
  {
    modelType: "SHUNT_ELEMENT",
    aliases: ["SHUNT", "CAPACITOR_BANK", "REACTOR"],
    label: "Nodal Shunt Element",
    category: "Shunts",
    archetypeId: IeeeCdfArchetypeId.SHUNT_ELEMENT,
    description: "Fixed nodal shunt admittance G + jB on system MVA base.",
    provenance: "IEEE Working Group 1973 Common Format",
    params: [
      ["G_SHUNT", 0.0, "pu", "Shunt conductance"],
      ["B_SHUNT", 0.19, "pu", "Shunt susceptance (positive = capacitive)"],
    ],
  },
];

/**
 * Builds the declarative `CleanroomModelSchema[]` array for `@modelscript/ieee-cdf-std-lib`.
 */
export function buildIeeeCdfCleanroomSchemas(): CleanroomModelSchema[] {
  return IEEE_CDF_STD_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => {
      const p: CleanroomParameterSchema = { key, type: "real", defaultValue };
      if (unit !== undefined) p.unit = unit;
      if (description !== undefined) p.description = description;
      return p;
    });
    return {
      namePath: `ieee_cdf.${spec.category.toLowerCase()}.${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "electrical-power",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Class",
      width: 96,
      height: 52,
      svg: generateIeeeCdfBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: "ieeeCdfModelEval",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}

/**
 * Cleanroom embedded IEEE 5-bus test system in IEEE CDF (1973) format (100 MVA base).
 */
export const IEEE_5_BUS_CDF = ` 01/01/73 MODELScript            100.0  1973 S IEEE 5-BUS CLEANROOM TEST CASE
BUS DATA FOLLOWS                                        5 ITEMS
   1 Bus_1_Slack   1  1  3 1.0600   0.00      0.00      0.00    130.00      0.00  138.00 1.0600    0.00     0.00  0.0000  0.0000    0
   2 Bus_2_Gen     1  1  2 1.0000   0.00     20.00     10.00     40.00      0.00  138.00 1.0000   50.00   -40.00  0.0000  0.0000    0
   3 Bus_3_Load    1  1  0 1.0000   0.00     45.00     15.00      0.00      0.00  138.00 0.0000    0.00     0.00  0.0000  0.0000    0
   4 Bus_4_Load    1  1  0 1.0000   0.00     40.00      5.00      0.00      0.00  138.00 0.0000    0.00     0.00  0.0000  0.0000    0
   5 Bus_5_Load    1  1  0 1.0000   0.00     60.00     10.00      0.00      0.00  138.00 0.0000    0.00     0.00  0.0000  0.0000    0
-999
BRANCH DATA FOLLOWS                                     7 ITEMS
   1    2  1 1  1 0  0.020000   0.060000   0.060000   100   100   100    0 0  0.0000    0.00
   1    3  1 1  1 0  0.080000   0.240000   0.050000   100   100   100    0 0  0.0000    0.00
   2    3  1 1  1 0  0.060000   0.180000   0.040000   100   100   100    0 0  0.0000    0.00
   2    4  1 1  1 0  0.060000   0.180000   0.040000   100   100   100    0 0  0.0000    0.00
   2    5  1 1  1 0  0.040000   0.120000   0.030000   100   100   100    0 0  0.0000    0.00
   3    4  1 1  1 0  0.010000   0.030000   0.020000   100   100   100    0 0  0.0000    0.00
   4    5  1 1  1 0  0.080000   0.240000   0.050000   100   100   100    0 0  0.0000    0.00
-999
LOSS ZONES FOLLOWS                                      1 ITEMS
  1 MAIN ZONE
-99
INTERCHANGE DATA FOLLOWS                                1 ITEMS
 1    1 Bus_1_Slack      0.00   5.00 AREA1   MAIN AREA
-9
TIE LINES FOLLOWS                                       0 ITEMS
-999
END OF DATA
`;

/**
 * Cleanroom IEEE 14-bus test system in IEEE CDF (1973) fixed-column format (100 MVA base).
 * Based on the public-domain IEEE 14-bus power-flow benchmark (AEP 1962 / Christie 1993).
 */
export const IEEE_14_BUS_CDF = ` 08/19/93 UW ARCHIVE            100.0  1962 W IEEE 14 BUS TEST CASE
BUS DATA FOLLOWS                                       14 ITEMS
   1 Bus 1     HV  1  1  3 1.0600   0.00      0.00      0.00    232.40    -16.90  138.00 1.0600    0.00     0.00  0.0000  0.0000    0
   2 Bus 2     HV  1  1  2 1.0450  -4.98     21.70     12.70     40.00     42.40  138.00 1.0450   50.00   -40.00  0.0000  0.0000    0
   3 Bus 3     HV  1  1  2 1.0100 -12.72     94.20     19.00      0.00     23.40  138.00 1.0100   40.00     0.00  0.0000  0.0000    0
   4 Bus 4     HV  1  1  0 1.0190 -10.33     47.80     -3.90      0.00      0.00  138.00 0.0000    0.00     0.00  0.0000  0.0000    0
   5 Bus 5     HV  1  1  0 1.0200  -8.78      7.60      1.60      0.00      0.00  138.00 0.0000    0.00     0.00  0.0000  0.0000    0
   6 Bus 6     LV  1  1  2 1.0700 -14.22     11.20      7.50      0.00     12.20   13.80 1.0700   24.00    -6.00  0.0000  0.0000    0
   7 Bus 7     ZV  1  1  0 1.0620 -13.37      0.00      0.00      0.00      0.00   13.80 0.0000    0.00     0.00  0.0000  0.0000    0
   8 Bus 8     TV  1  1  2 1.0900 -13.36      0.00      0.00      0.00     17.40   18.00 1.0900   24.00    -6.00  0.0000  0.0000    0
   9 Bus 9     LV  1  1  0 1.0560 -14.94     29.50     16.60      0.00      0.00   13.80 0.0000    0.00     0.00  0.0000  0.1900    0
  10 Bus 10    LV  1  1  0 1.0510 -15.10      9.00      5.80      0.00      0.00   13.80 0.0000    0.00     0.00  0.0000  0.0000    0
  11 Bus 11    LV  1  1  0 1.0570 -14.79      3.50      1.80      0.00      0.00   13.80 0.0000    0.00     0.00  0.0000  0.0000    0
  12 Bus 12    LV  1  1  0 1.0550 -15.07      6.10      1.60      0.00      0.00   13.80 0.0000    0.00     0.00  0.0000  0.0000    0
  13 Bus 13    LV  1  1  0 1.0500 -15.16     13.50      5.80      0.00      0.00   13.80 0.0000    0.00     0.00  0.0000  0.0000    0
  14 Bus 14    LV  1  1  0 1.0360 -16.04     14.90      5.00      0.00      0.00   13.80 0.0000    0.00     0.00  0.0000  0.0000    0
-999
BRANCH DATA FOLLOWS                                    20 ITEMS
   1    2  1 1  1 0  0.019380   0.059170   0.052800     0     0     0    0 0  0.0000    0.00
   1    5  1 1  1 0  0.054030   0.223040   0.049200     0     0     0    0 0  0.0000    0.00
   2    3  1 1  1 0  0.046990   0.197970   0.043800     0     0     0    0 0  0.0000    0.00
   2    4  1 1  1 0  0.058110   0.176320   0.034000     0     0     0    0 0  0.0000    0.00
   2    5  1 1  1 0  0.056950   0.173880   0.034600     0     0     0    0 0  0.0000    0.00
   3    4  1 1  1 0  0.067010   0.171030   0.012800     0     0     0    0 0  0.0000    0.00
   4    5  1 1  1 0  0.013350   0.042110   0.000000     0     0     0    0 0  0.0000    0.00
   4    7  1 1  1 1  0.000000   0.209120   0.000000     0     0     0    0 0  0.9780    0.00
   4    9  1 1  1 1  0.000000   0.556180   0.000000     0     0     0    0 0  0.9690    0.00
   5    6  1 1  1 1  0.000000   0.252020   0.000000     0     0     0    0 0  0.9320    0.00
   6   11  1 1  1 0  0.094980   0.198900   0.000000     0     0     0    0 0  0.0000    0.00
   6   12  1 1  1 0  0.122910   0.255810   0.000000     0     0     0    0 0  0.0000    0.00
   6   13  1 1  1 0  0.066150   0.130270   0.000000     0     0     0    0 0  0.0000    0.00
   7    8  1 1  1 0  0.000000   0.176150   0.000000     0     0     0    0 0  0.0000    0.00
   7    9  1 1  1 0  0.000000   0.110010   0.000000     0     0     0    0 0  0.0000    0.00
   9   10  1 1  1 0  0.031810   0.084500   0.000000     0     0     0    0 0  0.0000    0.00
   9   14  1 1  1 0  0.127110   0.270380   0.000000     0     0     0    0 0  0.0000    0.00
  10   11  1 1  1 0  0.082050   0.192070   0.000000     0     0     0    0 0  0.0000    0.00
  12   13  1 1  1 0  0.220920   0.199880   0.000000     0     0     0    0 0  0.0000    0.00
  13   14  1 1  1 0  0.170930   0.348020   0.000000     0     0     0    0 0  0.0000    0.00
-999
LOSS ZONES FOLLOWS                                      1 ITEMS
  1 AEP_SYSTEM
-99
INTERCHANGE DATA FOLLOWS                                1 ITEMS
 1    1 Bus 1     HV     0.00   0.00 AEP     AEP SYSTEM
-9
TIE LINES FOLLOWS                                       0 ITEMS
-999
END OF DATA
`;

/**
 * Cleanroom 3-bus BPA IPF (1970s) reference network (100 MVA base).
 */
export const BPA_3_BUS_IPF = `(POWERFLOW, CASEID=BPA_3BUS_TEST, MVA_BASE=100.0)
C  Cleanroom 3-bus BPA IPF benchmark network
BS SLACK1 230.0 V=1.05 ANG=0.0
BQ GEN2   230.0 PL=0.0 QL=0.0 PG=60.0 QMAX=80.0 QMIN=-40.0 V=1.02
B  LOAD3  230.0 PL=100.0 QL=35.0
L  SLACK1 GEN2  1 R=0.02 X=0.08 B2=0.015
L  SLACK1 LOAD3 1 R=0.03 X=0.12 B2=0.020
L  GEN2   LOAD3 1 R=0.025 X=0.10 B2=0.018
(END)
`;
