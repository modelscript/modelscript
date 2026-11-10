// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for Optical Fiber Plant & OSP Engineering.
 * Lowers end-to-end optical attenuation loss budgets and NESC Rule 250 catenary sag/tension
 * directly into ModelScript's linear-memory DAEBuilder struct-of-arrays arena.
 */

import { BinOp, Causality, EqKind, IDaeBuilder, VarType, Variability } from "@modelscript/runtime";

export interface FiberLinkParams {
  id: string;
  spanLengthMeters: number;
  wavelengthNm?: number;
  attenuationDbPerKm?: number; // e.g. 0.19 dB/km at 1550 nm
  numSplices?: number;
  spliceLossDb?: number; // e.g. 0.05 dB per fusion splice
  numConnectors?: number;
  connectorLossDb?: number; // e.g. 0.25 dB per LC/APC connector
  txPowerDbm?: number; // e.g. +3 dBm
  rxSensitivityDbm?: number; // e.g. -27 dBm
  cableWeightNPerM?: number; // e.g. 1.2 N/m
  horizontalTensionN?: number; // e.g. 4500 N
  attachmentHeightM?: number; // e.g. 8.5 m
}

export interface FiberDaeLoweringResult {
  linkId: string;
  variableIndices: Record<string, number>;
  equationCount: number;
}

/**
 * Lowers an optical fiber span and its structural catenary profile into DAEBuilder.
 */
export function lowerFiberLinkToDae(
  builder: IDaeBuilder,
  link: FiberLinkParams,
  prefix: string = link.id || "fiber",
): FiberDaeLoweringResult {
  const p = `${prefix}_`;
  let eqCount = 0;

  // 1. Parameters & Inputs
  const vLen = builder.addVariable(
    `${p}length_m`,
    VarType.Real,
    Variability.Parameter,
    Causality.Input,
    link.spanLengthMeters,
  );
  const vAttenCoeff = builder.addVariable(
    `${p}alpha_db_km`,
    VarType.Real,
    Variability.Parameter,
    Causality.Input,
    link.attenuationDbPerKm ?? 0.20,
  );
  const vNumSplices = builder.addVariable(
    `${p}num_splices`,
    VarType.Real,
    Variability.Parameter,
    Causality.Input,
    link.numSplices ?? 4,
  );
  const vSpliceLoss = builder.addVariable(
    `${p}splice_loss_db`,
    VarType.Real,
    Variability.Parameter,
    Causality.Input,
    link.spliceLossDb ?? 0.05,
  );
  const vNumConn = builder.addVariable(
    `${p}num_connectors`,
    VarType.Real,
    Variability.Parameter,
    Causality.Input,
    link.numConnectors ?? 2,
  );
  const vConnLoss = builder.addVariable(
    `${p}conn_loss_db`,
    VarType.Real,
    Variability.Parameter,
    Causality.Input,
    link.connectorLossDb ?? 0.25,
  );
  const vTxPower = builder.addVariable(
    `${p}tx_power_dbm`,
    VarType.Real,
    Variability.Parameter,
    Causality.Input,
    link.txPowerDbm ?? 3.0,
  );
  const vRxSens = builder.addVariable(
    `${p}rx_sens_dbm`,
    VarType.Real,
    Variability.Parameter,
    Causality.Input,
    link.rxSensitivityDbm ?? -28.0,
  );

  // Mechanical / Catenary parameters
  const vCableWeight = builder.addVariable(
    `${p}weight_n_m`,
    VarType.Real,
    Variability.Parameter,
    Causality.Input,
    link.cableWeightNPerM ?? 1.5,
  );
  const vTension = builder.addVariable(
    `${p}tension_n`,
    VarType.Real,
    Variability.Parameter,
    Causality.Input,
    link.horizontalTensionN ?? 5000.0,
  );
  const vHeight = builder.addVariable(
    `${p}attach_height_m`,
    VarType.Real,
    Variability.Parameter,
    Causality.Input,
    link.attachmentHeightM ?? 8.5,
  );

  // 2. Continuous / Algebraic Variables
  const vFiberLoss = builder.addVariable(`${p}fiber_loss_db`, VarType.Real, Variability.Continuous, Causality.Output);
  const vTotalSpliceLoss = builder.addVariable(
    `${p}total_splice_loss_db`,
    VarType.Real,
    Variability.Continuous,
    Causality.Output,
  );
  const vTotalConnLoss = builder.addVariable(
    `${p}total_conn_loss_db`,
    VarType.Real,
    Variability.Continuous,
    Causality.Output,
  );
  const vTotalLoss = builder.addVariable(`${p}total_loss_db`, VarType.Real, Variability.Continuous, Causality.Output);
  const vRxPower = builder.addVariable(`${p}rx_power_dbm`, VarType.Real, Variability.Continuous, Causality.Output);
  const vMargin = builder.addVariable(`${p}margin_db`, VarType.Real, Variability.Continuous, Causality.Output);
  const vSag = builder.addVariable(`${p}catenary_sag_m`, VarType.Real, Variability.Continuous, Causality.Output);
  const vClearance = builder.addVariable(
    `${p}ground_clearance_m`,
    VarType.Real,
    Variability.Continuous,
    Causality.Output,
  );

  // 3. Equations
  // eq 1: fiber_loss_db = (length_m / 1000) * alpha_db_km
  const kmLen = builder.addBinaryExpr(BinOp.Div, builder.addName(vLen), builder.addRealLiteral(1000.0));
  builder.addEquation(
    EqKind.Simple,
    builder.addName(vFiberLoss),
    builder.addBinaryExpr(BinOp.Mul, kmLen, builder.addName(vAttenCoeff)),
  );
  eqCount++;

  // eq 2: total_splice_loss_db = num_splices * splice_loss_db
  builder.addEquation(
    EqKind.Simple,
    builder.addName(vTotalSpliceLoss),
    builder.addBinaryExpr(BinOp.Mul, builder.addName(vNumSplices), builder.addName(vSpliceLoss)),
  );
  eqCount++;

  // eq 3: total_conn_loss_db = num_connectors * conn_loss_db
  builder.addEquation(
    EqKind.Simple,
    builder.addName(vTotalConnLoss),
    builder.addBinaryExpr(BinOp.Mul, builder.addName(vNumConn), builder.addName(vConnLoss)),
  );
  eqCount++;

  // eq 4: total_loss_db = fiber_loss_db + total_splice_loss_db + total_conn_loss_db
  const s1 = builder.addBinaryExpr(BinOp.Add, builder.addName(vFiberLoss), builder.addName(vTotalSpliceLoss));
  builder.addEquation(
    EqKind.Simple,
    builder.addName(vTotalLoss),
    builder.addBinaryExpr(BinOp.Add, s1, builder.addName(vTotalConnLoss)),
  );
  eqCount++;

  // eq 5: rx_power_dbm = tx_power_dbm - total_loss_db
  builder.addEquation(
    EqKind.Simple,
    builder.addName(vRxPower),
    builder.addBinaryExpr(BinOp.Sub, builder.addName(vTxPower), builder.addName(vTotalLoss)),
  );
  eqCount++;

  // eq 6: margin_db = rx_power_dbm - rx_sens_dbm
  builder.addEquation(
    EqKind.Simple,
    builder.addName(vMargin),
    builder.addBinaryExpr(BinOp.Sub, builder.addName(vRxPower), builder.addName(vRxSens)),
  );
  eqCount++;

  // eq 7: catenary_sag_m = (weight_n_m * length_m^2) / (8 * tension_n)
  const lSq = builder.addBinaryExpr(BinOp.Mul, builder.addName(vLen), builder.addName(vLen));
  const wLsq = builder.addBinaryExpr(BinOp.Mul, builder.addName(vCableWeight), lSq);
  const denom = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(8.0), builder.addName(vTension));
  builder.addEquation(EqKind.Simple, builder.addName(vSag), builder.addBinaryExpr(BinOp.Div, wLsq, denom));
  eqCount++;

  // eq 8: ground_clearance_m = attach_height_m - catenary_sag_m
  builder.addEquation(
    EqKind.Simple,
    builder.addName(vClearance),
    builder.addBinaryExpr(BinOp.Sub, builder.addName(vHeight), builder.addName(vSag)),
  );
  eqCount++;

  return {
    linkId: link.id,
    variableIndices: {
      vLen,
      vAttenCoeff,
      vNumSplices,
      vSpliceLoss,
      vNumConn,
      vConnLoss,
      vTxPower,
      vRxSens,
      vCableWeight,
      vTension,
      vHeight,
      vFiberLoss,
      vTotalSpliceLoss,
      vTotalConnLoss,
      vTotalLoss,
      vRxPower,
      vMargin,
      vSag,
      vClearance,
    },
    equationCount: eqCount,
  };
}

/**
 * Lowers a multi-span optical fiber metro ring or route into DAEBuilder.
 */
export function lowerFiberNetworkToDae(
  builder: IDaeBuilder,
  spans: FiberLinkParams[],
): { totalVariables: number; totalEquations: number; results: FiberDaeLoweringResult[] } {
  let totalEqs = 0;
  const results: FiberDaeLoweringResult[] = [];

  for (const span of spans) {
    const res = lowerFiberLinkToDae(builder, span);
    totalEqs += res.equationCount;
    results.push(res);
  }

  return {
    totalVariables: builder.getVarCount(),
    totalEquations: totalEqs,
    results,
  };
}
