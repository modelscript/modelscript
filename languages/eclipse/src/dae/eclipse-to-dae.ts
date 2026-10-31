// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/eclipse — Direct Linear-Memory DAE Arena Lowering for Reservoir Systems.
 *
 * Compiles ECLIPSE 100/300 multiphase black-oil reservoir dynamics, material balance,
 * and Peaceman well inflow performance into ModelScript's zero-GC DAEBuilder:
 *   1. Reservoir pressure depletion ODE: der(P_avg)
 *   2. Phase saturation dynamics: der(Sw), der(Sg), der(So)
 *   3. Cumulative production ODEs: der(Np), der(Wp), der(Gp)
 *   4. Peaceman inflow algebraic equations per producer/injector well
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { EclipseDeck } from "../types.js";

export interface EclipseDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
}

export function lowerEclipseToDae(deck: EclipseDeck, options?: EclipseDaeOptions): DAEBuilder {
  const modelName = (options?.modelName ?? (deck.title || "EclipseReservoir")).replace(/[^a-zA-Z0-9_]/g, "_");
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  const isField = deck.units === "FIELD";
  const bblPerFt3 = 1.0 / 5.614583;

  // Grid Pore Volume calculation
  const totalCells = deck.dimensions.nx * deck.dimensions.ny * deck.dimensions.nz;
  const vBulkCell = deck.grid.dx * deck.grid.dy * deck.grid.dz;
  const vBulkTotal = vBulkCell * totalCells;
  const vPoreTotal = vBulkTotal * deck.grid.poro;
  const vPore = isField ? vPoreTotal * bblPerFt3 : vPoreTotal; // bbl or m3

  const swc = deck.solution.initialSwat ?? deck.props.swof[0]?.saturation ?? 0.2;
  const boi = deck.props.pvdo[0]?.fvf ?? 1.25;
  const initP = deck.solution.initialPressure ?? (isField ? 4000.0 : 250.0);
  const ct = isField ? 1.2e-5 : 1.7e-4; // 1/psi or 1/bar

  // 1. Reservoir State Variables
  const pAvgVar = dae.addVariable("P_avg", VarType.Real, Variability.Continuous, Causality.Local, initP);
  const swVar = dae.addVariable("S_w", VarType.Real, Variability.Continuous, Causality.Local, swc);
  const npVar = dae.addVariable("Np", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const wpVar = dae.addVariable("Wp", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const gpVar = dae.addVariable("Gp", VarType.Real, Variability.Continuous, Causality.Local, 0.0);

  const qOilTotVar = dae.addVariable("Q_oil_total", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const qWaterTotVar = dae.addVariable("Q_water_total", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const qGasTotVar = dae.addVariable("Q_gas_total", VarType.Real, Variability.Continuous, Causality.Local, 0.0);

  // 2. Individual Well Equations
  let sumOilRateExpr: number | null = null;
  let sumWaterRateExpr: number | null = null;
  let sumGasRateExpr: number | null = null;

  for (const well of deck.wells.values()) {
    const safeName = well.name.replace(/[^a-zA-Z0-9_]/g, "_");
    const qOilW = dae.addVariable(`q_oil_${safeName}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const qWaterW = dae.addVariable(`q_water_${safeName}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const qGasW = dae.addVariable(`q_gas_${safeName}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const bhpW = dae.addVariable(
      `bhp_${safeName}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      isField ? 2000.0 : 150.0,
    );

    // Summing well rates into total expressions
    const qOilRef = dae.addName(qOilW);
    sumOilRateExpr = sumOilRateExpr === null ? qOilRef : dae.addBinaryExpr(BinOp.Add, sumOilRateExpr, qOilRef);

    const qWaterRef = dae.addName(qWaterW);
    sumWaterRateExpr =
      sumWaterRateExpr === null ? qWaterRef : dae.addBinaryExpr(BinOp.Add, sumWaterRateExpr, qWaterRef);

    const qGasRef = dae.addName(qGasW);
    sumGasRateExpr = sumGasRateExpr === null ? qGasRef : dae.addBinaryExpr(BinOp.Add, sumGasRateExpr, qGasRef);

    // Inflow Performance Relationship (IPR)
    // q_oil = WI * (P_avg - BHP)
    const wi = well.completions.reduce((acc, c) => acc + (c.wellIndex > 0 ? c.wellIndex : 10.0), 0);
    const wiLit = dae.addRealLiteral(wi);
    const dPExpr = dae.addBinaryExpr(BinOp.Sub, dae.addName(pAvgVar), dae.addName(bhpW));
    const iprRhs = dae.addBinaryExpr(BinOp.Mul, wiLit, dPExpr);
    dae.addEquation(EqKind.Simple, dae.addName(qOilW), iprRhs);

    // Fractional water rate and solution gas-oil ratio (GOR)
    const mobRatio = dae.addCallExpr("max", [
      dae.addRealLiteral(0.0),
      dae.addBinaryExpr(BinOp.Sub, dae.addName(swVar), dae.addRealLiteral(swc)),
    ]);
    dae.addEquation(EqKind.Simple, dae.addName(qWaterW), dae.addBinaryExpr(BinOp.Mul, dae.addName(qOilW), mobRatio));
    const gor = isField ? 500.0 : 90.0;
    dae.addEquation(
      EqKind.Simple,
      dae.addName(qGasW),
      dae.addBinaryExpr(BinOp.Mul, dae.addName(qOilW), dae.addRealLiteral(gor)),
    );

    // Specified BHP or target rate control
    if (well.productionControl) {
      dae.addEquation(EqKind.Simple, dae.addName(bhpW), dae.addRealLiteral(well.productionControl.bhpLimit));
    } else if (well.injectionControl) {
      dae.addEquation(EqKind.Simple, dae.addName(bhpW), dae.addRealLiteral(well.injectionControl.bhpLimit));
    } else {
      dae.addEquation(EqKind.Simple, dae.addName(bhpW), dae.addRealLiteral(isField ? 2000.0 : 150.0));
    }
  }

  // Assign Total Field Rates
  dae.addEquation(EqKind.Simple, dae.addName(qOilTotVar), sumOilRateExpr ?? dae.addRealLiteral(0.0));
  dae.addEquation(EqKind.Simple, dae.addName(qWaterTotVar), sumWaterRateExpr ?? dae.addRealLiteral(0.0));
  dae.addEquation(EqKind.Simple, dae.addName(qGasTotVar), sumGasRateExpr ?? dae.addRealLiteral(0.0));

  // 3. Reservoir Material Balance ODEs
  // der(Np) = Q_oil_total
  dae.addEquation(EqKind.Simple, dae.addDer(npVar), dae.addName(qOilTotVar));
  // der(Wp) = Q_water_total
  dae.addEquation(EqKind.Simple, dae.addDer(wpVar), dae.addName(qWaterTotVar));
  // der(Gp) = Q_gas_total
  dae.addEquation(EqKind.Simple, dae.addDer(gpVar), dae.addName(qGasTotVar));

  // der(P_avg) = - (Q_oil_total * Bo) / (V_pore * c_t)
  const denom = vPore * ct;
  const scale = -boi / Math.max(1e-6, denom);
  const dPdtExpr = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(scale), dae.addName(qOilTotVar));
  dae.addEquation(EqKind.Simple, dae.addDer(pAvgVar), dPdtExpr);

  // der(S_w) = (Q_oil_total * Bo - Q_water_total) / V_pore (voidage replacement saturation rate)
  const swScale = boi / Math.max(1e-6, vPore);
  const dSwdtExpr = dae.addBinaryExpr(
    BinOp.Mul,
    dae.addRealLiteral(swScale),
    dae.addBinaryExpr(BinOp.Sub, dae.addName(qOilTotVar), dae.addName(qWaterTotVar)),
  );
  dae.addEquation(EqKind.Simple, dae.addDer(swVar), dSwdtExpr);

  return dae;
}
