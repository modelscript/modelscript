// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslBuiltinSymbol, DslIndexFileContext } from "@modelscript/dsl";
import type { DAEBuilder, UnifiedWorkspace } from "@modelscript/runtime";
import { lowerPsseComponentToDae, type PsseComponentLowerOptions } from "./dae/psse-to-dae.js";
import { DYR_MODEL_SCHEMAS, isLikelyDyrContent, parseDyr, type DyrModelSchema } from "./parser/dyr-parser.js";
import { parseRaw } from "./parser/raw-parser.js";
import type { PsseCase, PsseDyrCase, PsseDyrCategory } from "./types.js";

export const PSSE_STANDARD_DYNAMICS_RESOURCE_ID = "library-bundle:/PSSE-Standard-Dynamics@1.0.0";

export interface PssePortSpec {
  name: string;
  direction: "input" | "output";
  y: number;
  description: string;
  unit?: string;
}

export const PSSE_CATEGORY_PORTS: Record<string, PssePortSpec[]> = {
  generator: [
    { name: "Pm_in", direction: "input", y: 60, description: "Mechanical turbine power input", unit: "p.u." },
    { name: "Efd_in", direction: "input", y: 0, description: "Exciter field voltage input", unit: "p.u." },
    { name: "Vt_in", direction: "input", y: -60, description: "Stator terminal bus voltage magnitude", unit: "p.u." },
    { name: "Pe_out", direction: "output", y: 40, description: "Air-gap electrical active power output", unit: "p.u." },
    { name: "omega_out", direction: "output", y: -40, description: "Rotor electrical angular speed", unit: "rad/s" },
  ],
  converter: [
    { name: "Pcmd_in", direction: "input", y: 60, description: "Active power command input", unit: "p.u." },
    { name: "Qcmd_in", direction: "input", y: 0, description: "Reactive power / current command input", unit: "p.u." },
    { name: "Vt_in", direction: "input", y: -60, description: "Terminal bus voltage magnitude", unit: "p.u." },
    { name: "Ip_out", direction: "output", y: 40, description: "Active current injection output", unit: "p.u." },
    { name: "Iq_out", direction: "output", y: -40, description: "Reactive current injection output", unit: "p.u." },
  ],
  exciter: [
    { name: "Vt_in", direction: "input", y: 40, description: "Sensed terminal voltage magnitude", unit: "p.u." },
    { name: "Vs_in", direction: "input", y: -40, description: "Supplementary PSS stabilizing signal", unit: "p.u." },
    { name: "Efd_out", direction: "output", y: 0, description: "Field excitation voltage command", unit: "p.u." },
  ],
  governor: [
    { name: "omega_in", direction: "input", y: 0, description: "Measured rotor angular speed", unit: "rad/s" },
    { name: "Pm_out", direction: "output", y: 0, description: "Mechanical turbine power output", unit: "p.u." },
  ],
  stabilizer: [
    { name: "omega_in", direction: "input", y: 0, description: "Measured rotor speed signal", unit: "rad/s" },
    { name: "Vs_out", direction: "output", y: 0, description: "Stabilizer supplementary voltage output", unit: "p.u." },
  ],
};

export function getPsseModelPortSpecs(modelName: string, category: PsseDyrCategory): PssePortSpec[] {
  const upper = modelName.toUpperCase();
  if (upper.startsWith("REGC")) {
    return PSSE_CATEGORY_PORTS["converter"]!;
  }
  return PSSE_CATEGORY_PORTS[category] ?? PSSE_CATEGORY_PORTS["generator"]!;
}

/**
 * Standard IEEE / WECC benchmark parameter defaults for PSS/E dynamic models.
 */
export const PSSE_MODEL_DEFAULTS: Record<string, Record<string, number>> = {
  GENCLS: { H: 3.5, D: 1.0, Xdp: 0.25, P0: 0.8, V0: 1.0, omega0: 376.99111843077515 },
  GENROU: {
    Td0p: 6.5,
    Td0pp: 0.035,
    Tq0p: 1.0,
    Tq0pp: 0.05,
    H: 4.5,
    D: 1.0,
    Xd: 1.8,
    Xq: 1.7,
    Xdp: 0.25,
    Xqp: 0.55,
    Xdpp: 0.2,
    Xl: 0.15,
    S10: 0.09,
    S12: 0.38,
    P0: 0.8,
    V0: 1.0,
    Efd0: 1.05,
    omega0: 376.99111843077515,
  },
  GENSAL: {
    Td0p: 5.0,
    Td0pp: 0.04,
    Tq0pp: 0.06,
    H: 3.8,
    D: 1.0,
    Xd: 1.2,
    Xq: 0.8,
    Xdp: 0.3,
    Xdpp: 0.22,
    Xl: 0.15,
    S10: 0.08,
    S12: 0.32,
    P0: 0.8,
    V0: 1.0,
    Efd0: 1.05,
    omega0: 376.99111843077515,
  },
  GENTPJ: {
    Td0p: 6.5,
    Td0pp: 0.035,
    Tq0p: 1.0,
    Tq0pp: 0.05,
    H: 4.5,
    D: 1.0,
    Xd: 1.8,
    Xq: 1.7,
    Xdp: 0.25,
    Xqp: 0.55,
    Xdpp: 0.2,
    Xqpp: 0.2,
    Xl: 0.15,
    S10: 0.09,
    S12: 0.38,
    Kis: 0.05,
    P0: 0.8,
    V0: 1.0,
    Efd0: 1.05,
    omega0: 376.99111843077515,
  },
  GENSAE: {
    Td0p: 5.2,
    Td0pp: 0.04,
    Tq0pp: 0.06,
    H: 3.8,
    D: 1.0,
    Xd: 1.25,
    Xq: 0.82,
    Xdp: 0.3,
    Xdpp: 0.22,
    Xl: 0.15,
    P0: 0.8,
    V0: 1.0,
    Efd0: 1.05,
    omega0: 376.99111843077515,
  },
  EXST1: {
    TR: 0.02,
    VIMAX: 0.2,
    VIMIN: -0.2,
    TC: 1.0,
    TB: 1.0,
    KA: 200.0,
    TA: 0.02,
    VRMAX: 5.0,
    VRMIN: -5.0,
    KC: 0.05,
    KF: 0.0,
    TF: 1.0,
    V0: 1.0,
    Efd0: 1.05,
  },
  IEEET1: {
    TR: 0.02,
    KA: 50.0,
    TA: 0.05,
    VRMAX: 4.0,
    VRMIN: -4.0,
    KE: 1.0,
    TE: 0.5,
    KF: 0.03,
    TF: 1.0,
    V0: 1.0,
    Efd0: 1.05,
  },
  SEXS: {
    TATB: 0.1,
    TB: 10.0,
    K: 100.0,
    TE: 0.1,
    EMIN: 0.0,
    EMAX: 4.0,
    V0: 1.0,
    Efd0: 1.05,
  },
  ESDC1A: {
    TR: 0.02,
    KA: 40.0,
    TA: 0.06,
    TB: 0.0,
    TC: 0.0,
    VRMAX: 4.0,
    VRMIN: -4.0,
    KE: 1.0,
    TE: 0.46,
    KF: 0.04,
    TF1: 1.0,
    V0: 1.0,
    Efd0: 1.05,
  },
  TGOV1: {
    R: 0.05,
    T1: 0.5,
    VMAX: 1.05,
    VMIN: 0.0,
    T2: 2.1,
    T3: 7.0,
    DT: 0.0,
    P0: 0.8,
    omega0: 376.99111843077515,
  },
  HYGOV: {
    R: 0.05,
    r: 0.3,
    Tr: 5.0,
    Tf: 0.05,
    Tg: 0.5,
    VELM: 0.2,
    GMAX: 1.0,
    GMIN: 0.0,
    TW: 1.2,
    At: 1.2,
    Dturb: 0.5,
    qnl: 0.08,
    P0: 0.8,
    omega0: 376.99111843077515,
  },
  IEEEG1: {
    K: 20.0,
    T1: 0.1,
    T2: 0.0,
    T3: 0.25,
    UO: 0.1,
    UC: -0.2,
    PMAX: 1.05,
    PMIN: 0.0,
    T4: 0.3,
    K1: 0.3,
    K2: 0.0,
    T5: 7.0,
    K3: 0.7,
    K4: 0.0,
    P0: 0.8,
    omega0: 376.99111843077515,
  },
  GGOV1: {
    R: 0.04,
    Tpelec: 1.0,
    maxerr: 0.05,
    minerr: -0.05,
    Kpgov: 10.0,
    Kigov: 2.0,
    Kdgov: 0.0,
    Tdgov: 1.0,
    vmax: 1.0,
    vmin: 0.15,
    Tact: 0.5,
    Kturb: 1.5,
    wfnl: 0.2,
    Tb: 0.1,
    Tc: 0.0,
    P0: 0.8,
    omega0: 376.99111843077515,
  },
  WTGT_A: {
    Ht: 4.0,
    Hg: 1.0,
    Dshaft: 1.5,
    Kshaft: 80.0,
    P0: 0.8,
    omega0: 376.99111843077515,
  },
  IEEEST: {
    A1: 0.0,
    A2: 0.0,
    T1: 0.15,
    T2: 0.03,
    T3: 0.15,
    T4: 0.03,
    T5: 10.0,
    T6: 10.0,
    KS: 10.0,
    LSMAX: 0.1,
    LSMIN: -0.1,
    omega0: 376.99111843077515,
  },
  PSS2A: {
    Tw1: 2.0,
    Tw2: 2.0,
    T6: 0.02,
    Tw3: 2.0,
    Tw4: 0.0,
    T7: 2.0,
    Ks2: 0.2,
    Ks3: 1.0,
    T8: 0.5,
    T9: 0.1,
    Ks1: 10.0,
    T1: 0.15,
    T2: 0.03,
    T3: 0.15,
    T4: 0.03,
    Vstmax: 0.1,
    Vstmin: -0.1,
    omega0: 376.99111843077515,
  },
  REGC_A: {
    Tg: 0.02,
    Rrpwr: 10.0,
    Brkpt: 0.9,
    Zerox: 0.4,
    Lvpl1: 1.22,
    Vtmax: 1.2,
    Lvpnt0: 0.4,
    Lvpnt1: 0.8,
    Iolim: -1.3,
    Tfltr: 0.02,
    Khv: 0.7,
    Iqrmax: 999.0,
    Iqrmin: -999.0,
    Accel: 0.7,
    P0: 0.8,
    Q0: 0.0,
    V0: 1.0,
  },
  REEC_A: {
    Vdip: 0.85,
    Vup: 1.15,
    Trv: 0.02,
    dbd1: -0.05,
    dbd2: 0.05,
    Kqv: 2.0,
    Iqh1: 1.05,
    Iql1: -1.05,
    Vref0: 1.0,
    Iqfrz: 0.0,
    Thld: 0.0,
    Thld2: 0.0,
    Tp: 0.05,
    Qmax: 0.44,
    Qmin: -0.44,
    Vmax: 1.1,
    Vmin: 0.9,
    Kqp: 1.0,
    Kqi: 0.5,
    Kvp: 1.0,
    Kvi: 20.0,
    Tiq: 0.02,
    dPmax: 99.0,
    dPmin: -99.0,
    Pmax: 1.0,
    Pmin: 0.0,
    Imax: 1.2,
    Tpord: 0.02,
    V0: 1.0,
    Efd0: 0.0,
  },
  REPC_A: {
    Tfltr: 0.02,
    Kp: 1.0,
    Ki: 5.0,
    Tft: 0.0,
    Tfv: 0.05,
    Vfrz: 0.7,
    Rc: 0.0,
    Xc: 0.0,
    Kc: 0.0,
    emax: 0.1,
    emin: -0.1,
    dbd: 0.0,
    Qmax: 0.44,
    Qmin: -0.44,
    Kpg: 1.0,
    Kig: 0.5,
    Tp: 0.05,
    fdbd1: -0.0006,
    fdbd2: 0.0006,
    femax: 99.0,
    femin: -99.0,
    Pmax: 1.0,
    Pmin: 0.0,
    Tg: 0.1,
    Ddn: 20.0,
    Dup: 20.0,
    P0: 0.8,
    omega0: 376.99111843077515,
  },
};

function buildPortPlacement(direction: "input" | "output", y: number): Record<string, any> {
  const ext =
    direction === "input"
      ? [
          [-120, y - 10],
          [-100, y + 10],
        ]
      : [
          [100, y - 10],
          [120, y + 10],
        ];
  return {
    "@type": "Placement",
    visible: true,
    iconVisible: true,
    transformation: {
      "@type": "Transformation",
      origin: [0, 0],
      extent: ext,
      rotation: 0,
    },
    iconTransformation: {
      "@type": "Transformation",
      origin: [0, 0],
      extent: ext,
      rotation: 0,
    },
  };
}

function buildConnectorIconAnnotation(direction: "input" | "output"): Record<string, any> {
  const fill = direction === "input" ? [37, 99, 235] : [255, 255, 255];
  return {
    "@type": "Icon",
    coordinateSystem: {
      "@type": "coordinateSystem",
      preserveAspectRatio: true,
      extent: [
        [-100, -100],
        [100, 100],
      ],
    },
    graphics: [
      {
        "@type": "Polygon",
        points: [
          [-100, 100],
          [100, 0],
          [-100, -100],
          [-100, 100],
        ],
        lineColor: [37, 99, 235],
        fillColor: fill,
        fillPattern: "solid",
        lineThickness: 0.5,
      },
    ],
  };
}

function buildModelIconSvgAndAnnotation(
  modelName: string,
  category: PsseDyrCategory,
): { iconSvg: string; iconAnnotation: Record<string, any> } {
  const upper = modelName.toUpperCase();
  const isConverter = upper.startsWith("REGC");

  if (isConverter) {
    const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="6" y="8" width="52" height="48" rx="6" fill="#ecfdf5" stroke="#059669" stroke-width="2.5"/><line x1="6" y1="56" x2="58" y2="8" stroke="#059669" stroke-width="2"/><line x1="14" y1="20" x2="28" y2="20" stroke="#047857" stroke-width="2.2"/><line x1="14" y1="25" x2="28" y2="25" stroke="#047857" stroke-width="1.5" stroke-dasharray="3,2"/><path d="M 35 42 Q 40 33 45 42 T 55 42" fill="none" stroke="#047857" stroke-width="2.2"/><text x="32" y="62" font-family="sans-serif" font-size="8.5" font-weight="700" text-anchor="middle" fill="#065f46">${modelName}</text></svg>`;
    const iconAnnotation = {
      "@type": "Icon",
      coordinateSystem: {
        "@type": "coordinateSystem",
        preserveAspectRatio: false,
        extent: [
          [-100, -100],
          [100, 100],
        ],
      },
      graphics: [
        {
          "@type": "Rectangle",
          extent: [
            [-100, -80],
            [100, 80],
          ],
          lineColor: [5, 150, 105],
          fillColor: [236, 253, 245],
          fillPattern: "solid",
          lineThickness: 0.6,
          radius: 14,
        },
        {
          "@type": "Line",
          points: [
            [-95, -75],
            [95, 75],
          ],
          color: [5, 150, 105],
          thickness: 0.5,
        },
        {
          "@type": "Line",
          points: [
            [-75, 42],
            [-25, 42],
          ],
          color: [4, 120, 87],
          thickness: 0.6,
        },
        {
          "@type": "Line",
          points: [
            [15, -35],
            [35, -15],
            [55, -55],
            [75, -35],
          ],
          color: [4, 120, 87],
          thickness: 0.6,
          smooth: 1,
        },
        {
          "@type": "Text",
          extent: [
            [-95, 82],
            [95, 112],
          ],
          string: "%name",
          lineColor: [15, 23, 42],
        },
        {
          "@type": "Text",
          extent: [
            [-90, -105],
            [90, -82],
          ],
          string: modelName,
          lineColor: [5, 150, 105],
        },
      ],
    };
    return { iconSvg, iconAnnotation };
  }

  if (category === "generator") {
    const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="30" r="22" fill="#eff6ff" stroke="#1d4ed8" stroke-width="2.5"/><path d="M 18 30 Q 25 18 32 30 T 46 30" fill="none" stroke="#1d4ed8" stroke-width="2.5"/><text x="32" y="61" font-family="sans-serif" font-size="8.5" font-weight="700" text-anchor="middle" fill="#1e3a8a">${modelName}</text></svg>`;
    const iconAnnotation = {
      "@type": "Icon",
      coordinateSystem: {
        "@type": "coordinateSystem",
        preserveAspectRatio: false,
        extent: [
          [-100, -100],
          [100, 100],
        ],
      },
      graphics: [
        {
          "@type": "Rectangle",
          extent: [
            [-100, -80],
            [100, 80],
          ],
          lineColor: [30, 64, 175],
          fillColor: [239, 246, 255],
          fillPattern: "solid",
          lineThickness: 0.5,
          radius: 14,
        },
        {
          "@type": "Ellipse",
          extent: [
            [-62, -62],
            [62, 62],
          ],
          lineColor: [29, 78, 216],
          fillColor: [255, 255, 255],
          fillPattern: "solid",
          lineThickness: 0.7,
        },
        {
          "@type": "Line",
          points: [
            [-40, 0],
            [-20, 32],
            [0, 0],
            [20, -32],
            [40, 0],
          ],
          color: [29, 78, 216],
          thickness: 0.7,
          smooth: 1,
        },
        {
          "@type": "Text",
          extent: [
            [-95, 82],
            [95, 112],
          ],
          string: "%name",
          lineColor: [15, 23, 42],
        },
        {
          "@type": "Text",
          extent: [
            [-90, -105],
            [90, -82],
          ],
          string: modelName,
          lineColor: [29, 78, 216],
        },
      ],
    };
    return { iconSvg, iconAnnotation };
  }

  if (category === "exciter") {
    const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="6" y="10" width="52" height="44" rx="6" fill="#fffbeb" stroke="#d97706" stroke-width="2.5"/><text x="32" y="31" font-family="sans-serif" font-size="11" font-weight="700" text-anchor="middle" fill="#b45309">AVR</text><text x="32" y="45" font-family="sans-serif" font-size="8.5" font-weight="600" text-anchor="middle" fill="#92400e">${modelName}</text></svg>`;
    const iconAnnotation = {
      "@type": "Icon",
      coordinateSystem: {
        "@type": "coordinateSystem",
        preserveAspectRatio: false,
        extent: [
          [-100, -100],
          [100, 100],
        ],
      },
      graphics: [
        {
          "@type": "Rectangle",
          extent: [
            [-100, -75],
            [100, 75],
          ],
          lineColor: [217, 119, 6],
          fillColor: [255, 251, 235],
          fillPattern: "solid",
          lineThickness: 0.6,
          radius: 12,
        },
        {
          "@type": "Text",
          extent: [
            [-80, -10],
            [80, 45],
          ],
          string: "AVR",
          lineColor: [180, 83, 9],
        },
        {
          "@type": "Text",
          extent: [
            [-85, -58],
            [85, -18],
          ],
          string: modelName,
          lineColor: [146, 64, 14],
        },
        {
          "@type": "Text",
          extent: [
            [-95, 80],
            [95, 110],
          ],
          string: "%name",
          lineColor: [15, 23, 42],
        },
      ],
    };
    return { iconSvg, iconAnnotation };
  }

  if (category === "governor") {
    const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><polygon points="8,16 56,10 56,54 8,48" fill="#f5f3ff" stroke="#7c3aed" stroke-width="2.5"/><text x="34" y="34" font-family="sans-serif" font-size="9.5" font-weight="700" text-anchor="middle" fill="#5b21b6">${modelName}</text></svg>`;
    const iconAnnotation = {
      "@type": "Icon",
      coordinateSystem: {
        "@type": "coordinateSystem",
        preserveAspectRatio: false,
        extent: [
          [-100, -100],
          [100, 100],
        ],
      },
      graphics: [
        {
          "@type": "Polygon",
          points: [
            [-100, 55],
            [100, 80],
            [100, -80],
            [-100, -55],
            [-100, 55],
          ],
          lineColor: [124, 58, 237],
          fillColor: [245, 243, 255],
          fillPattern: "solid",
          lineThickness: 0.6,
        },
        {
          "@type": "Text",
          extent: [
            [-85, -28],
            [85, 28],
          ],
          string: modelName,
          lineColor: [91, 33, 182],
        },
        {
          "@type": "Text",
          extent: [
            [-95, 82],
            [95, 112],
          ],
          string: "%name",
          lineColor: [15, 23, 42],
        },
      ],
    };
    return { iconSvg, iconAnnotation };
  }

  // Stabilizer / default control block
  const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="6" y="12" width="52" height="40" rx="6" fill="#fdf2f8" stroke="#db2777" stroke-width="2.5"/><text x="32" y="31" font-family="sans-serif" font-size="10.5" font-weight="700" text-anchor="middle" fill="#be185d">PSS</text><text x="32" y="44" font-family="sans-serif" font-size="8.5" font-weight="600" text-anchor="middle" fill="#9d174d">${modelName}</text></svg>`;
  const iconAnnotation = {
    "@type": "Icon",
    coordinateSystem: {
      "@type": "coordinateSystem",
      preserveAspectRatio: false,
      extent: [
        [-100, -100],
        [100, 100],
      ],
    },
    graphics: [
      {
        "@type": "Rectangle",
        extent: [
          [-100, -70],
          [100, 70],
        ],
        lineColor: [219, 39, 119],
        fillColor: [253, 242, 248],
        fillPattern: "solid",
        lineThickness: 0.6,
        radius: 12,
      },
      {
        "@type": "Text",
        extent: [
          [-80, -5],
          [80, 45],
        ],
        string: "PSS",
        lineColor: [190, 24, 93],
      },
      {
        "@type": "Text",
        extent: [
          [-85, -55],
          [85, -15],
        ],
        string: modelName,
        lineColor: [157, 23, 77],
      },
      {
        "@type": "Text",
        extent: [
          [-95, 80],
          [95, 110],
        ],
        string: "%name",
        lineColor: [15, 23, 42],
      },
    ],
  };
  return { iconSvg, iconAnnotation };
}

function buildPsseModelSymbol(schema: DyrModelSchema, modelNameOverride?: string): DslBuiltinSymbol {
  const modelName = modelNameOverride ?? schema.model;
  const defaults = PSSE_MODEL_DEFAULTS[modelName] ?? PSSE_MODEL_DEFAULTS[schema.model] ?? {};
  const portSpecs = getPsseModelPortSpecs(modelName, schema.category);
  const { iconSvg, iconAnnotation } = buildModelIconSvgAndAnnotation(modelName, schema.category);

  const children: DslBuiltinSymbol[] = [];

  // 1. Signal connector ports (connectable in Modelica / SysML v2 diagrams and equations)
  for (const port of portSpecs) {
    const typeSpec =
      port.direction === "input" ? "PSSEDynamics.Interfaces.SignalInput" : "PSSEDynamics.Interfaces.SignalOutput";
    children.push({
      name: port.name,
      kind: "Component",
      ruleName: "psse_port",
      resourceId: PSSE_STANDARD_DYNAMICS_RESOURCE_ID,
      metadata: {
        typeSpecifier: typeSpec,
        causality: port.direction,
        variability: "continuous",
        isConnectorPort: true,
        unit: port.unit ?? "p.u.",
        description: port.description,
        placementAnnotation: buildPortPlacement(port.direction, port.y),
      },
    });
  }

  // 2. Declared DYR CON parameters + operating-point parameters
  const seenParams = new Set<string>();
  for (const param of schema.params) {
    seenParams.add(param.name);
    const defaultVal = defaults[param.name] ?? 0.0;
    children.push({
      name: param.name,
      kind: "Component",
      ruleName: "psse_parameter",
      resourceId: PSSE_STANDARD_DYNAMICS_RESOURCE_ID,
      metadata: {
        typeSpecifier: "Real",
        variability: "parameter",
        defaultValue: defaultVal,
        unit: param.unit,
        description: param.description,
      },
    });
  }

  // Operating-point parameters (P0, Q0, V0, Efd0, omega0) if present in defaults
  const opMeta: Record<string, { unit: string; description: string }> = {
    P0: { unit: "p.u.", description: "Initial steady-state active power setpoint P0" },
    Q0: { unit: "p.u.", description: "Initial steady-state reactive power setpoint Q0" },
    V0: { unit: "p.u.", description: "Nominal terminal bus voltage magnitude V0" },
    Efd0: { unit: "p.u.", description: "Initial steady-state field voltage Efd0" },
    Xdp: { unit: "p.u.", description: "d-axis transient reactance X'd" },
    omega0: { unit: "rad/s", description: "Nominal synchronous electrical angular speed omega0" },
  };
  for (const [opKey, opVal] of Object.entries(defaults)) {
    if (seenParams.has(opKey)) continue;
    const info = opMeta[opKey] ?? { unit: "p.u.", description: `${opKey} operating parameter` };
    children.push({
      name: opKey,
      kind: "Component",
      ruleName: "psse_parameter",
      resourceId: PSSE_STANDARD_DYNAMICS_RESOURCE_ID,
      metadata: {
        typeSpecifier: "Real",
        variability: "parameter",
        defaultValue: opVal,
        unit: info.unit,
        description: info.description,
      },
    });
  }

  return {
    name: modelName,
    kind: "Class",
    ruleName: "psse_model",
    resourceId: PSSE_STANDARD_DYNAMICS_RESOURCE_ID,
    metadata: {
      classPrefixes: "model",
      classKind: "model",
      psseModel: modelName,
      psseCategory: schema.category,
      title: schema.title,
      description: `${schema.title} — ${schema.description}`,
      iconSvg,
      iconAnnotation,
      lowerComponentToDae: (dae: DAEBuilder, instancePrefix: string, options?: PsseComponentLowerOptions) =>
        lowerPsseComponentToDae(dae, modelName, instancePrefix, options),
    },
    children,
  };
}

/**
 * Materializes the built-in `PSSEDynamics` standard library package into `UnifiedWorkspace`.
 */
export function buildPsseBuiltinSymbols(): DslBuiltinSymbol[] {
  const modelChildren: DslBuiltinSymbol[] = [
    {
      name: "Interfaces",
      kind: "Class",
      ruleName: "psse_package",
      resourceId: PSSE_STANDARD_DYNAMICS_RESOURCE_ID,
      metadata: {
        classPrefixes: "package",
        classKind: "package",
        description: "Scalar physical control & power signal connectors for PSS/E dynamic blocks.",
      },
      children: [
        {
          name: "SignalInput",
          kind: "Class",
          ruleName: "psse_connector",
          resourceId: PSSE_STANDARD_DYNAMICS_RESOURCE_ID,
          metadata: {
            classPrefixes: "connector",
            classKind: "connector",
            causality: "input",
            isConnector: true,
            baseType: "Real",
            description: "Scalar input signal connector compatible with Modelica RealInput.",
            iconAnnotation: buildConnectorIconAnnotation("input"),
          },
        },
        {
          name: "SignalOutput",
          kind: "Class",
          ruleName: "psse_connector",
          resourceId: PSSE_STANDARD_DYNAMICS_RESOURCE_ID,
          metadata: {
            classPrefixes: "connector",
            classKind: "connector",
            causality: "output",
            isConnector: true,
            baseType: "Real",
            description: "Scalar output signal connector compatible with Modelica RealOutput.",
            iconAnnotation: buildConnectorIconAnnotation("output"),
          },
        },
      ],
    },
  ];

  for (const schema of Object.values(DYR_MODEL_SCHEMAS)) {
    modelChildren.push(buildPsseModelSymbol(schema));
  }
  // Common WECC alias REGCA1 -> REGC_A
  const regcaSchema = DYR_MODEL_SCHEMAS["REGC_A"];
  if (regcaSchema && !DYR_MODEL_SCHEMAS["REGCA1"]) {
    modelChildren.push(buildPsseModelSymbol(regcaSchema, "REGCA1"));
  }

  return [
    {
      name: "PSSEDynamics",
      kind: "Class",
      ruleName: "psse_package",
      resourceId: PSSE_STANDARD_DYNAMICS_RESOURCE_ID,
      metadata: {
        classPrefixes: "package",
        classKind: "package",
        description:
          "IEEE & WECC standard synchronous generators, exciters, turbine governors, stabilizers, and renewable IBR models.",
      },
      children: modelChildren,
    },
  ];
}

/**
 * Declarative `language({ indexing: { indexFile } })` hook for `.raw` and `.dyr` documents.
 */
export function indexPsseDocument(ctx: DslIndexFileContext): void {
  const { uri, text } = ctx;
  const isDyr = uri.toLowerCase().endsWith(".dyr") || isLikelyDyrContent(text);

  if (isDyr) {
    const dyrCase = parseDyr(text);
    ctx.setParsedModel<PsseDyrCase>(dyrCase, "dyr");

    // Link companion .raw case if already indexed in UnifiedWorkspace
    const companionRawUri = ctx.findCompanionUri([".raw"]) ?? ctx.listDocumentUris(".raw")[0];
    if (companionRawUri) {
      const rawCase = ctx.getParsedModel<PsseCase>(companionRawUri, "raw");
      if (rawCase) {
        rawCase.dyr = dyrCase;
      }
    }

    ctx.emitSymbol({
      name: "PsseDynamicData",
      kind: "Class",
      ruleName: "psse_dyr_case",
      startOffset: 0,
      endOffset: text.length,
      metadata: {
        classPrefixes: "model",
        recordCount: dyrCase.records.length,
      },
      children: dyrCase.records.map((rec) => ({
        name: `Dyr_${rec.model}_${rec.ibus}_${rec.id}`,
        kind: "Component",
        ruleName: "psse_dyr_record",
        startOffset: rec.span?.startOffset ?? 0,
        endOffset: rec.span?.endOffset ?? 0,
        metadata: {
          typeSpecifier: `PSSEDynamics.${rec.model}`,
          busNumber: rec.ibus,
          model: rec.model,
          machineId: rec.id,
          category: rec.category,
          namedParams: rec.namedParams,
        },
      })),
    });
    return;
  }

  // Otherwise parse as PSS/E .raw power flow case
  const parsedCase = parseRaw(text);
  const companionDyrUri = ctx.findCompanionUri([".dyr"]) ?? ctx.listDocumentUris(".dyr")[0];
  if (companionDyrUri) {
    const dyrCase = ctx.getParsedModel<PsseDyrCase>(companionDyrUri, "dyr");
    if (dyrCase) {
      parsedCase.dyr = dyrCase;
    }
  }
  ctx.setParsedModel<PsseCase>(parsedCase, "raw");

  const children = [];

  for (const b of parsedCase.buses.values()) {
    children.push({
      name: `Bus_${b.i}`,
      aliases: [String(b.i)],
      kind: "Component",
      ruleName: "psse_component",
      startOffset: b.span?.startOffset ?? 0,
      endOffset: b.span?.endOffset ?? 0,
      metadata: {
        busNumber: b.i,
        busName: b.name,
        baseKv: b.baseKv,
        ide: b.ide,
        vm: b.vm,
        va: b.va,
      },
    });
  }

  for (const g of parsedCase.generators) {
    children.push({
      name: `Gen_${g.i}_${g.id}`,
      kind: "Component",
      ruleName: "psse_component",
      startOffset: g.span?.startOffset ?? 0,
      endOffset: g.span?.endOffset ?? 0,
      metadata: {
        busNumber: g.i,
        genId: g.id,
        pg: g.pg,
        qg: g.qg,
        status: g.stat,
      },
    });
  }

  for (const br of parsedCase.branches) {
    children.push({
      name: `Branch_${br.i}_${br.j}_${br.ckt}`,
      kind: "Component",
      ruleName: "psse_component",
      startOffset: br.span?.startOffset ?? 0,
      endOffset: br.span?.endOffset ?? 0,
      metadata: {
        fromBus: br.i,
        toBus: br.j,
        ckt: br.ckt,
        r: br.r,
        x: br.x,
        rateA: br.rateA,
        status: br.st,
      },
    });
  }

  for (const t of parsedCase.transformers) {
    children.push({
      name: `Xfmr_${t.i}_${t.j}_${t.ckt}`,
      kind: "Component",
      ruleName: "psse_component",
      startOffset: t.span?.startOffset ?? 0,
      endOffset: t.span?.endOffset ?? 0,
      metadata: {
        fromBus: t.i,
        toBus: t.j,
        ckt: t.ckt,
        windv1: t.windv1,
        status: t.stat,
      },
    });
  }

  for (const l of parsedCase.loads) {
    children.push({
      name: `Load_${l.i}_${l.id}`,
      kind: "Component",
      ruleName: "psse_component",
      startOffset: l.span?.startOffset ?? 0,
      endOffset: l.span?.endOffset ?? 0,
      metadata: {
        busNumber: l.i,
        loadId: l.id,
        pl: l.pl,
        ql: l.ql,
        status: l.status,
      },
    });
  }

  const caseName = parsedCase.title1 || "PsseCase";
  ctx.emitSymbol({
    name: caseName,
    kind: "Class",
    ruleName: "psse_case",
    startOffset: parsedCase.header.span?.startOffset ?? 0,
    endOffset: parsedCase.header.span?.endOffset ?? text.length,
    metadata: {
      classPrefixes: "model",
      sbase: parsedCase.header.sbase,
      rev: parsedCase.header.rev,
      basfrq: parsedCase.header.basfrq,
      nBuses: parsedCase.buses.size,
      nBranches: parsedCase.branches.length,
      nGenerators: parsedCase.generators.length,
      nLoads: parsedCase.loads.length,
    },
    children,
  });
}

/**
 * Finds a companion `.dyr` dynamic data model in `workspace` for a given `.raw` URI.
 */
export function findCompanionPsseDyr(
  workspace: UnifiedWorkspace,
  rawUri: string,
): { uri: string; dyr: PsseDyrCase } | undefined {
  const exactOrDir = workspace.findCompanionUri(rawUri, [".dyr"]);
  if (exactOrDir) {
    const dyr = workspace.getParsedModel<PsseDyrCase>(exactOrDir, "dyr");
    if (dyr) return { uri: exactOrDir, dyr };
  }
  for (const uri of workspace.listDocumentUris()) {
    const dyr = workspace.getParsedModel<PsseDyrCase>(uri, "dyr");
    if (dyr) return { uri, dyr };
  }
  return undefined;
}

/**
 * Finds a companion `.raw` power-flow case in `workspace` for a given `.dyr` URI.
 */
export function findCompanionPsseRaw(
  workspace: UnifiedWorkspace,
  dyrUri: string,
): { uri: string; psseCase: PsseCase } | undefined {
  const exactOrDir = workspace.findCompanionUri(dyrUri, [".raw"]);
  if (exactOrDir) {
    const psseCase = workspace.getParsedModel<PsseCase>(exactOrDir, "raw");
    if (psseCase) return { uri: exactOrDir, psseCase };
  }
  for (const uri of workspace.listDocumentUris()) {
    const psseCase = workspace.getParsedModel<PsseCase>(uri, "raw");
    if (psseCase) return { uri, psseCase };
  }
  return undefined;
}

/**
 * Parses or retrieves a `PsseCase` from `workspace` and attaches any companion `.dyr` dynamic data.
 */
export function getMergedPsseCase(workspace: UnifiedWorkspace, uri: string, text?: string): PsseCase {
  if (uri.toLowerCase().endsWith(".dyr")) {
    if (text) {
      workspace.indexDocumentText(uri, text, "psse");
    }
    const companion = findCompanionPsseRaw(workspace, uri);
    const dyr = workspace.getParsedModel<PsseDyrCase>(uri, "dyr");
    if (companion) {
      if (dyr) companion.psseCase.dyr = dyr;
      return companion.psseCase;
    }
    const emptyCase = parseRaw("");
    if (dyr) emptyCase.dyr = dyr;
    return emptyCase;
  }
  if (text) {
    workspace.indexDocumentText(uri, text, "psse");
  }
  const existing = workspace.getParsedModel<PsseCase>(uri, "raw");
  if (existing) {
    if (!existing.dyr) {
      const companion = findCompanionPsseDyr(workspace, uri);
      if (companion) existing.dyr = companion.dyr;
    }
    return existing;
  }
  const parsed = parseRaw(text ?? "");
  const companion = findCompanionPsseDyr(workspace, uri);
  if (companion) {
    parsed.dyr = companion.dyr;
  }
  return parsed;
}
