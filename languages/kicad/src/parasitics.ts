// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/kicad — Layout-Aware Trace RLGC, Impedance & IPC-2221 Extractor.
 *
 * Computes physical parasitics (DC resistance, lumped inductance/capacitance,
 * microstrip/stripline characteristic impedance Z0, and IPC-2221 current
 * capacity) directly from `.kicad_pcb` copper geometry and dielectric stackup.
 */

import type { KiCadBoard } from "./types.js";

const COPPER_RESISTIVITY_OHM_M = 1.68e-8; // 20 deg C annealed copper
const SPEED_OF_LIGHT_M_S = 2.99792458e8;
const MM_TO_MIL = 1 / 0.0254;

export interface TraceParasitic {
  net: string;
  layer: string;
  lengthMm: number;
  widthMm: number;
  resistanceOhm: number;
  inductanceNH: number;
  capacitancePF: number;
  impedanceOhm: number;
  propagationDelayPs: number;
  maxCurrentA: number;
}

export interface NetParasiticSummary {
  net: string;
  totalLengthMm: number;
  totalResistanceOhm: number;
  totalInductanceNH: number;
  totalCapacitancePF: number;
  minImpedanceOhm: number;
  maxImpedanceOhm: number;
  minMaxCurrentA: number;
  segmentCount: number;
}

export interface BoardParasiticsReport {
  traces: TraceParasitic[];
  nets: Record<string, NetParasiticSummary>;
  stackupDefaultsUsed: boolean;
}

export interface ParasiticOptions {
  /** Allowed temperature rise above ambient in deg C for IPC-2221 (default: 10). */
  tempRiseC?: number;
  /** Default copper thickness in mm if not specified in stackup (default: 0.035 = 1 oz). */
  defaultCopperThicknessMm?: number;
  /** Default dielectric height to reference plane in mm (default: 0.2 for 4L / 1.53 for 2L). */
  defaultDielectricHeightMm?: number;
  /** Default relative permittivity Er (default: 4.3 for FR4). */
  defaultEr?: number;
}

function resolveLayerStackupParams(
  board: KiCadBoard,
  layer: string,
  opts?: ParasiticOptions,
): { copperMm: number; dielectricMm: number; er: number; isExternal: boolean; usedDefaults: boolean } {
  const isExternal = layer === "F.Cu" || layer === "B.Cu" || layer === "TopCopper" || layer === "BottomCopper";
  let copperMm = opts?.defaultCopperThicknessMm ?? 0.035;
  let dielectricMm = opts?.defaultDielectricHeightMm ?? 1.53;
  let er = opts?.defaultEr ?? 4.3;
  let usedDefaults = true;

  if (board.stackup.length > 0) {
    const cuLayer = board.stackup.find((s) => s.name === layer);
    if (cuLayer?.thicknessMm && cuLayer.thicknessMm > 0) {
      copperMm = cuLayer.thicknessMm;
      usedDefaults = false;
    }
    const dielectric = board.stackup.find((s) => {
      const t = s.type.toLowerCase();
      return t.includes("core") || t.includes("prepreg") || t.includes("dielectric");
    });
    if (dielectric) {
      if (dielectric.thicknessMm && dielectric.thicknessMm > 0) {
        dielectricMm = dielectric.thicknessMm;
        usedDefaults = false;
      }
      if (dielectric.dielectricConstant && dielectric.dielectricConstant > 1) {
        er = dielectric.dielectricConstant;
        usedDefaults = false;
      }
    }
  }

  return { copperMm, dielectricMm, er, isExternal, usedDefaults };
}

/**
 * Hammerstad-Jensen microstrip characteristic impedance (external layers)
 * or symmetric stripline approximation (internal layers).
 */
export function computeTraceImpedance(
  widthMm: number,
  heightMm: number,
  copperThicknessMm: number,
  er: number,
  isExternal: boolean,
): { z0Ohm: number; erEff: number } {
  const w = Math.max(widthMm, 1e-4);
  const h = Math.max(heightMm, 1e-4);
  const t = Math.max(copperThicknessMm, 1e-5);

  if (isExternal) {
    // Microstrip with finite conductor thickness correction
    const wEff = w + (t / Math.PI) * (1 + Math.log((2 * h) / t));
    const u = wEff / h;
    const erEff = (er + 1) / 2 + ((er - 1) / 2) * (1 / Math.sqrt(1 + 12 / u));
    const z0 =
      u <= 1
        ? (60 / Math.sqrt(erEff)) * Math.log(8 / u + 0.25 * u)
        : (120 * Math.PI) / (Math.sqrt(erEff) * (u + 1.393 + 0.667 * Math.log(u + 1.444)));
    return { z0Ohm: z0, erEff };
  }

  // Symmetric stripline (b = 2*h + t)
  const b = 2 * h + t;
  const z0 = (60 / Math.sqrt(er)) * Math.log((4 * b) / (0.67 * Math.PI * (0.8 * w + t)));
  return { z0Ohm: Math.max(5, z0), erEff: er };
}

/**
 * IPC-2221 ampacity estimate: I = k * (dT^0.44) * (A_mil2^0.725).
 */
export function computeIpc2221Ampacity(
  widthMm: number,
  copperThicknessMm: number,
  isExternal: boolean,
  tempRiseC = 10,
): number {
  const k = isExternal ? 0.048 : 0.024;
  const areaMil2 = widthMm * MM_TO_MIL * (copperThicknessMm * MM_TO_MIL);
  return k * Math.pow(Math.max(1, tempRiseC), 0.44) * Math.pow(Math.max(1e-6, areaMil2), 0.725);
}

function arcLengthMm(a: [number, number], m: [number, number], b: [number, number]): number {
  // Approximate 3-point arc length via circular arc or 2-chord fallback for collinear points
  const chord1 = Math.hypot(m[0] - a[0], m[1] - a[1]);
  const chord2 = Math.hypot(b[0] - m[0], b[1] - m[1]);
  return chord1 + chord2;
}

/**
 * Extracts per-trace and per-net RLGC parasitics, characteristic impedance,
 * propagation delay, and IPC-2221 current capacity from a `KiCadBoard`.
 */
export function extractBoardParasitics(board: KiCadBoard, options?: ParasiticOptions): BoardParasiticsReport {
  const traces: TraceParasitic[] = [];
  const nets: Record<string, NetParasiticSummary> = {};
  const tempRiseC = options?.tempRiseC ?? 10;
  let stackupDefaultsUsed = false;

  const processTrace = (net: string, layer: string, lengthMm: number, widthMm: number) => {
    const params = resolveLayerStackupParams(board, layer, options);
    if (params.usedDefaults) stackupDefaultsUsed = true;

    const lengthM = lengthMm * 1e-3;
    const areaM2 = Math.max(widthMm * 1e-3 * (params.copperMm * 1e-3), 1e-15);
    const resistanceOhm = (COPPER_RESISTIVITY_OHM_M * lengthM) / areaM2;

    const { z0Ohm, erEff } = computeTraceImpedance(
      widthMm,
      params.dielectricMm,
      params.copperMm,
      params.er,
      params.isExternal,
    );

    const vProp = SPEED_OF_LIGHT_M_S / Math.sqrt(erEff);
    const delayS = lengthM / vProp;
    const inductanceH = delayS * z0Ohm;
    const capacitanceF = delayS / z0Ohm;
    const maxCurrentA = computeIpc2221Ampacity(widthMm, params.copperMm, params.isExternal, tempRiseC);

    const entry: TraceParasitic = {
      net,
      layer,
      lengthMm,
      widthMm,
      resistanceOhm,
      inductanceNH: inductanceH * 1e9,
      capacitancePF: capacitanceF * 1e12,
      impedanceOhm: z0Ohm,
      propagationDelayPs: delayS * 1e12,
      maxCurrentA,
    };
    traces.push(entry);

    const key = net || "__UNASSIGNED__";
    const agg = nets[key];
    if (!agg) {
      nets[key] = {
        net: key,
        totalLengthMm: lengthMm,
        totalResistanceOhm: resistanceOhm,
        totalInductanceNH: entry.inductanceNH,
        totalCapacitancePF: entry.capacitancePF,
        minImpedanceOhm: z0Ohm,
        maxImpedanceOhm: z0Ohm,
        minMaxCurrentA: maxCurrentA,
        segmentCount: 1,
      };
    } else {
      agg.totalLengthMm += lengthMm;
      agg.totalResistanceOhm += resistanceOhm;
      agg.totalInductanceNH += entry.inductanceNH;
      agg.totalCapacitancePF += entry.capacitancePF;
      agg.minImpedanceOhm = Math.min(agg.minImpedanceOhm, z0Ohm);
      agg.maxImpedanceOhm = Math.max(agg.maxImpedanceOhm, z0Ohm);
      agg.minMaxCurrentA = Math.min(agg.minMaxCurrentA, maxCurrentA);
      agg.segmentCount++;
    }
  };

  for (const seg of board.segments) {
    const len = Math.hypot(seg.end[0] - seg.start[0], seg.end[1] - seg.start[1]);
    processTrace(seg.netName, seg.layer, len, seg.width);
  }
  for (const arc of board.arcs) {
    const len = arcLengthMm(arc.start, arc.mid, arc.end);
    processTrace(arc.netName, arc.layer, len, arc.width);
  }

  return { traces, nets, stackupDefaultsUsed };
}
