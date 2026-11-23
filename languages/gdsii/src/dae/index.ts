// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Parasitic RC Extraction & DAE Lowering for `@modelscript/gdsii`.
 *
 * Extracts interconnect sheet resistance (`R = Rs * L / W`), substrate area + fringe
 * capacitance (`C = Ca * A + Cf * P`), Elmore delay (`tau = R * C`), and first-order
 * RC transient ODEs (`C * der(V_out) = (V_in - V_out) / R`) directly into
 * `@modelscript/runtime`'s linear-memory `DAEBuilder`.
 */

import { BinOp, Causality, DAEBuilder, EqKind, VarType, Variability, type IDaeBuilder } from "@modelscript/runtime";
import { DEFAULT_CMOS_LAYER_STACK, lowerGdsiiToGeometry, type GdsiiLowerOptions } from "../cad/index.js";
import type { GdsiiLayerStackEntry, GdsiiLibrary } from "../types.js";

export interface GdsiiLayerParasitics {
  layer: number;
  name: string;
  polygonCount: number;
  totalAreaUm2: number;
  totalPerimeterUm: number;
  /** Extracted lumped resistance in Ohms. */
  resistanceOhm: number;
  /** Extracted lumped capacitance in Farads. */
  capacitanceF: number;
  /** Elmore RC time constant in seconds. */
  elmoreDelaySec: number;
}

export interface GdsiiDaeLoweringResult {
  modelName: string;
  layerParasitics: GdsiiLayerParasitics[];
  variableCount: number;
  equationCount: number;
}

export interface GdsiiDaeOptions extends GdsiiLowerOptions {
  modelName?: string | undefined;
  layerStack?: GdsiiLayerStackEntry[] | undefined;
  /** Supply / drive voltage in Volts (default: 1.8 V). */
  vddVolts?: number | undefined;
}

/**
 * Extracts lumped parasitic RC parameters per layer from a GDSII library.
 */
export function extractGdsiiParasitics(library: GdsiiLibrary, options?: GdsiiDaeOptions): GdsiiLayerParasitics[] {
  const flat = lowerGdsiiToGeometry(library, options);
  const stack = options?.layerStack ?? DEFAULT_CMOS_LAYER_STACK;
  const stackMap = new Map<number, GdsiiLayerStackEntry>();
  for (const entry of stack) {
    stackMap.set(entry.layer, entry);
  }

  const byLayer = new Map<number, { count: number; areaUm2: number; perimeterUm: number; squares: number }>();

  for (const poly of flat.polygons) {
    if (poly.areaUm2 <= 0) continue;
    const acc = byLayer.get(poly.layer) ?? { count: 0, areaUm2: 0, perimeterUm: 0, squares: 0 };
    acc.count += 1;
    acc.areaUm2 += poly.areaUm2;
    acc.perimeterUm += poly.perimeterUm;
    const lengthUm = Math.max(poly.bboxUm.width, poly.bboxUm.height);
    const widthUm = Math.max(Math.min(poly.bboxUm.width, poly.bboxUm.height), 1e-3);
    acc.squares += lengthUm / widthUm;
    byLayer.set(poly.layer, acc);
  }

  const results: GdsiiLayerParasitics[] = [];
  for (const [layer, acc] of byLayer) {
    const meta = stackMap.get(layer) ?? {
      layer,
      name: `LAYER_${layer}`,
      zMinUm: layer * 0.5,
      thicknessUm: 0.3,
      sheetResistanceOhmSq: 1.0,
      areaCapFfPerUm2: 0.05,
      fringeCapFfPerUm: 0.02,
      color: "#94a3b8",
    };

    const resistanceOhm = Math.max(meta.sheetResistanceOhmSq * acc.squares, 1e-6);
    const capacitanceFf = meta.areaCapFfPerUm2 * acc.areaUm2 + meta.fringeCapFfPerUm * acc.perimeterUm;
    const capacitanceF = Math.max(capacitanceFf * 1e-15, 1e-18);
    const elmoreDelaySec = resistanceOhm * capacitanceF;

    results.push({
      layer,
      name: meta.name,
      polygonCount: acc.count,
      totalAreaUm2: acc.areaUm2,
      totalPerimeterUm: acc.perimeterUm,
      resistanceOhm,
      capacitanceF,
      elmoreDelaySec,
    });
  }

  results.sort((a, b) => a.layer - b.layer);
  return results;
}

/**
 * Lowers GDSII parasitic RC interconnect equations into an existing `IDaeBuilder` / `DAEBuilder`.
 */
export function lowerGdsiiToDae(
  builder: IDaeBuilder,
  library: GdsiiLibrary,
  options?: GdsiiDaeOptions,
): GdsiiDaeLoweringResult {
  const parasitics = extractGdsiiParasitics(library, options);
  const vdd = options?.vddVolts ?? 1.8;

  const vInVar = builder.addVariable("V_in", VarType.Real, Variability.Parameter, Causality.Input, vdd);

  let eqCount = 0;
  let varCount = 1;

  for (const p of parasitics) {
    const prefix = p.name.replace(/[^A-Za-z0-9_]/g, "_");
    const rVar = builder.addVariable(
      `${prefix}_R`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      p.resistanceOhm,
    );

    const cVar = builder.addVariable(
      `${prefix}_C`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      p.capacitanceF,
    );

    const tauVar = builder.addVariable(
      `${prefix}_tau`,
      VarType.Real,
      Variability.Continuous,
      Causality.Output,
      p.elmoreDelaySec,
    );

    const vVar = builder.addVariable(`${prefix}_V`, VarType.Real, Variability.Continuous, Causality.Output, 0.0);
    varCount += 4;

    // Algebraic equation: tau = R * C
    const tauLhs = builder.addName(tauVar);
    const tauRhs = builder.addBinaryExpr(BinOp.Mul, builder.addName(rVar), builder.addName(cVar));
    builder.addEquation(EqKind.Simple, tauLhs, tauRhs);
    eqCount += 1;

    // Differential equation: C * der(V) = (V_in - V) / R
    const derV = builder.addDer(vVar);
    const lhs = builder.addBinaryExpr(BinOp.Mul, builder.addName(cVar), derV);
    const dv = builder.addBinaryExpr(BinOp.Sub, builder.addName(vInVar), builder.addName(vVar));
    const rhs = builder.addBinaryExpr(BinOp.Div, dv, builder.addName(rVar));
    builder.addEquation(EqKind.Simple, lhs, rhs);
    eqCount += 1;
  }

  return {
    modelName: options?.modelName ?? library.name,
    layerParasitics: parasitics,
    variableCount: varCount,
    equationCount: eqCount,
  };
}

/**
 * Convenience wrapper that creates a `DAEBuilder` and lowers a `GdsiiLibrary` into it.
 */
export function gdsiiToDae(library: GdsiiLibrary, options?: GdsiiDaeOptions): DAEBuilder {
  const modelName = (options?.modelName || library.name || "GdsiiParasiticRC").replace(/[^A-Za-z0-9_]/g, "_");
  const builder = new DAEBuilder(undefined, modelName);
  lowerGdsiiToDae(builder, library, { ...options, modelName });
  return builder;
}
