// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, Causality, DAEBuilder, EqKind, VarType, Variability } from "@modelscript/runtime";
import { flattenCifLayout, type CifFlattenOptions, type FlattenedCifLayout } from "../cad/geometry.js";
import { lookupMosisLayerRule } from "../catalog/cif-std-schemas.js";
import type { CifDocument } from "../types.js";

export interface LayerParasitics {
  layer: string;
  areaUm2: number;
  perimeterUm: number;
  sheetResistanceOhmPerSq: number;
  areaCapAfPerUm2: number;
  fringeCapAfPerUm: number;
  /** Total parasitic capacitance in femtofarads (fF). */
  capacitanceFf: number;
  /** Estimated lumped interconnect resistance in Ohms (Ω). */
  resistanceOhm: number;
  /** Elmore RC time constant in picoseconds (ps). */
  rcDelayPs: number;
}

export interface CifDaeResult {
  builder: DAEBuilder;
  layout: FlattenedCifLayout;
  parasitics: Record<string, LayerParasitics>;
  totalCapacitanceFf: number;
  totalResistanceOhm: number;
  varCount: number;
  eqCount: number;
}

export interface CifToDaeOptions extends CifFlattenOptions {
  modelName?: string;
  /** Supply / drive voltage in Volts (default: 5.0 V for classic MOSIS SCMOS / NMOS). */
  vddVolts?: number;
}

/**
 * Lowers a CIF 2.0 IC layout into a `@modelscript/runtime` `DAEBuilder` parasitic RC network.
 *
 * For each mask layer present in the flattened layout, emits:
 * - Parameters: area (`A_<L>`), perimeter (`P_<L>`), sheet resistance (`Rs_<L>`),
 *   area capacitance (`Ca_<L>`), fringe capacitance (`Cf_<L>`), effective squares (`Nsq_<L>`).
 * - Algebraic variables & equations: parasitic capacitance `C_<L>` (F), lumped resistance `R_<L>` (Ω),
 *   and Elmore delay `tau_<L> = R_<L> * C_<L>` (s).
 * - Dynamic RC charging ODE: `tau_<L> * der(V_<L>) = Vdd - V_<L>`.
 */
export function cifToDae(doc: CifDocument, options?: CifToDaeOptions): CifDaeResult {
  const layout = flattenCifLayout(doc, options);
  const modelName = (options?.modelName || "CifParasiticRC").replace(/[^A-Za-z0-9_]/g, "_");
  const vdd = options?.vddVolts ?? 5.0;
  const builder = new DAEBuilder(undefined, modelName);

  const vddVar = builder.addVariable("Vdd", VarType.Real, Variability.Parameter, Causality.Local, vdd);

  const parasitics: Record<string, LayerParasitics> = {};
  let totalCapacitanceFf = 0;
  let totalResistanceOhm = 0;

  for (const [layer, areaUm2] of Object.entries(layout.layerAreasUm2)) {
    const perimeterUm = layout.layerPerimetersUm[layer] ?? 0;
    const rule = lookupMosisLayerRule(layer);
    const sheetRes = rule?.sheetResistanceOhmPerSq ?? 10.0;
    const areaCapAf = rule?.areaCapAfPerUm2 ?? 50.0;
    const fringeCapAf = rule?.fringeCapAfPerUm ?? 25.0;

    // C_fF = (areaCap [aF/um^2] * area [um^2] + fringeCap [aF/um] * perimeter [um]) * 1e-3
    const capFf = (areaCapAf * areaUm2 + fringeCapAf * perimeterUm) * 1e-3;
    const capF = Math.max(1e-21, capFf * 1e-15);

    // Effective square count estimated from perimeter² / (16 * area) >= 1.0
    const effectiveSquares = areaUm2 > 1e-12 ? Math.max(1.0, (perimeterUm * perimeterUm) / (16.0 * areaUm2)) : 1.0;
    const resOhm = Math.max(1e-6, sheetRes * effectiveSquares);
    const rcDelayPs = resOhm * capFf * 1e-3;

    parasitics[layer] = {
      layer,
      areaUm2,
      perimeterUm,
      sheetResistanceOhmPerSq: sheetRes,
      areaCapAfPerUm2: areaCapAf,
      fringeCapAfPerUm: fringeCapAf,
      capacitanceFf: capFf,
      resistanceOhm: resOhm,
      rcDelayPs,
    };

    totalCapacitanceFf += capFf;
    totalResistanceOhm += resOhm;

    const safeLayer = layer.replace(/[^A-Za-z0-9_]/g, "_");

    // Emit parameters
    const aVar = builder.addVariable(`A_${safeLayer}`, VarType.Real, Variability.Parameter, Causality.Local, areaUm2);
    const pVar = builder.addVariable(
      `P_${safeLayer}`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      perimeterUm,
    );
    const rsVar = builder.addVariable(
      `Rs_${safeLayer}`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      sheetRes,
    );
    const caVar = builder.addVariable(
      `Ca_${safeLayer}`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      areaCapAf * 1e-18,
    );
    const cfVar = builder.addVariable(
      `Cf_${safeLayer}`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      fringeCapAf * 1e-18,
    );
    const sqVar = builder.addVariable(
      `Nsq_${safeLayer}`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      effectiveSquares,
    );

    // Continuous algebraic & state variables
    const cVar = builder.addVariable(`C_${safeLayer}`, VarType.Real, Variability.Continuous, Causality.Local, capF);
    const rVar = builder.addVariable(`R_${safeLayer}`, VarType.Real, Variability.Continuous, Causality.Local, resOhm);
    const tauVar = builder.addVariable(
      `tau_${safeLayer}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      resOhm * capF,
    );
    const vVar = builder.addVariable(`V_${safeLayer}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    // Eq 1: C_<L> = Ca_<L> * A_<L> + Cf_<L> * P_<L>
    const cAreaTerm = builder.addBinaryExpr(BinOp.Mul, builder.addName(caVar), builder.addName(aVar));
    const cFringeTerm = builder.addBinaryExpr(BinOp.Mul, builder.addName(cfVar), builder.addName(pVar));
    builder.addEquation(EqKind.Simple, builder.addName(cVar), builder.addBinaryExpr(BinOp.Add, cAreaTerm, cFringeTerm));

    // Eq 2: R_<L> = Rs_<L> * Nsq_<L>
    builder.addEquation(
      EqKind.Simple,
      builder.addName(rVar),
      builder.addBinaryExpr(BinOp.Mul, builder.addName(rsVar), builder.addName(sqVar)),
    );

    // Eq 3: tau_<L> = R_<L> * C_<L>
    builder.addEquation(
      EqKind.Simple,
      builder.addName(tauVar),
      builder.addBinaryExpr(BinOp.Mul, builder.addName(rVar), builder.addName(cVar)),
    );

    // Eq 4: tau_<L> * der(V_<L>) = Vdd - V_<L>
    const derV = builder.addDer(vVar);
    const lhsOde = builder.addBinaryExpr(BinOp.Mul, builder.addName(tauVar), derV);
    const rhsOde = builder.addBinaryExpr(BinOp.Sub, builder.addName(vddVar), builder.addName(vVar));
    builder.addEquation(EqKind.Simple, lhsOde, rhsOde);
  }

  return {
    builder,
    layout,
    parasitics,
    totalCapacitanceFf,
    totalResistanceOhm,
    varCount: builder.varCount,
    eqCount: builder.eqCount,
  };
}
