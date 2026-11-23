// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/doe2 — Direct Linear-Memory DAE Lowering.
 *
 * Lowers DOE-2 multi-layer composite wall U-values, 3R2C envelope thermal capacitance,
 * glazing conduction & solar heat gain, infiltration, internal gains, and HVAC control
 * ODEs directly into ModelScript's zero-GC linear-memory `DAEBuilder` arena.
 */

import {
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  ExprKind,
  StringInterner,
  Variability,
  VarType,
} from "@modelscript/runtime";
import {
  buildSpaceThermalSummaries,
  computeAllConstructionProps,
  type SpaceThermalSummary,
  type ThermalBuildOptions,
} from "../solver/doe2-thermal-solver.js";
import type { Doe2Document } from "../types.js";

export interface LowerDoe2DaeOptions extends ThermalBuildOptions {
  arenaTitle?: string | undefined;
  ambientTempK?: number | undefined; // default 283.15 K (10 C)
  groundTempK?: number | undefined; // default 285.15 K (12 C)
  solarIrradianceWPerM2?: number | undefined; // default 300.0 W/m^2
  initialZoneTempK?: number | undefined; // default 293.15 K (20 C)
  hvacGainWPerK?: number | undefined; // default 2500.0 W/K
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * Lowers a parsed `Doe2Document` directly into a `DAEBuilder` arena.
 */
export function lowerDoe2ToDae(doc: Doe2Document, options?: LowerDoe2DaeOptions): DAEBuilder {
  const title = options?.arenaTitle ?? doc.title ?? "DOE2_Building";
  const interner = new StringInterner();
  const arena = new DAEBuilder(interner, title);

  const tAmbDefaultK = options?.ambientTempK ?? 283.15;
  const tGndDefaultK = options?.groundTempK ?? 285.15;
  const iSolDefault = options?.solarIrradianceWPerM2 ?? 300.0;
  const initTempK = options?.initialZoneTempK ?? 293.15;
  const hvacKp = options?.hvacGainWPerK ?? 2500.0;

  // 1. Global boundary condition input parameters
  const tAmbId = interner.intern("T_amb");
  arena.addVariable("T_amb", VarType.Real, Variability.Parameter, Causality.Input);
  const tAmbExpr = arena.addExpression(ExprKind.Name, tAmbId);
  arena.addEquation(EqKind.InitialSimple, tAmbExpr, arena.addRealLiteral(tAmbDefaultK));

  const tGroundId = interner.intern("T_ground");
  arena.addVariable("T_ground", VarType.Real, Variability.Parameter, Causality.Input);
  const tGroundExpr = arena.addExpression(ExprKind.Name, tGroundId);
  arena.addEquation(EqKind.InitialSimple, tGroundExpr, arena.addRealLiteral(tGndDefaultK));

  const iSolarId = interner.intern("I_solar");
  arena.addVariable("I_solar", VarType.Real, Variability.Parameter, Causality.Input);
  const iSolarExpr = arena.addExpression(ExprKind.Name, iSolarId);
  arena.addEquation(EqKind.InitialSimple, iSolarExpr, arena.addRealLiteral(iSolDefault));

  // 2. Expose composite construction U-values as parameters for inspection / sensitivity
  const conProps = computeAllConstructionProps(doc, {
    rFilmIntSi: options?.rFilmIntSi,
    rFilmExtSi: options?.rFilmExtSi,
  });
  for (const prop of conProps.values()) {
    const uParamName = `U_con_${sanitizeId(prop.name)}`;
    const uId = interner.intern(uParamName);
    arena.addVariable(uParamName, VarType.Real, Variability.Parameter, Causality.Local);
    arena.addEquation(
      EqKind.InitialSimple,
      arena.addExpression(ExprKind.Name, uId),
      arena.addRealLiteral(prop.uValueSi),
    );
  }

  // 3. Lower each SPACE / ZONE RC thermal network
  const summaries = buildSpaceThermalSummaries(doc, options);
  for (const summary of summaries) {
    lowerSpaceToDae(arena, interner, summary, tAmbExpr, tGroundExpr, iSolarExpr, initTempK, hvacKp);
  }

  return arena;
}

function lowerSpaceToDae(
  arena: DAEBuilder,
  interner: StringInterner,
  s: SpaceThermalSummary,
  tAmbExpr: number,
  tGroundExpr: number,
  iSolarExpr: number,
  initTempK: number,
  hvacKp: number,
): void {
  const clean = sanitizeId(s.spaceName);

  // Zone air temperature state variable T_z (K)
  const tempVarName = `zone_${clean}_T`;
  const tempId = interner.intern(tempVarName);
  arena.addVariable(tempVarName, VarType.Real, Variability.Continuous, Causality.Local);
  const tempExpr = arena.addExpression(ExprKind.Name, tempId);
  arena.addEquation(EqKind.InitialSimple, tempExpr, arena.addRealLiteral(initTempK));

  const cZoneLit = arena.addRealLiteral(Math.max(1.0, s.cZoneJPerK));
  const deltaTAmb = arena.addBinaryExpr(BinOp.Sub, tAmbExpr, tempExpr);

  const gOpaque = s.uaWallWPerK + s.uaRoofWPerK;
  const gOpenings = s.uaWindowWPerK + s.uaDoorWPerK;

  let qTotalExpr: number;

  if (s.cWallJPerK > 0.0 && gOpaque > 0.0) {
    // 3R2C envelope thermal mass node: T_wall_<space>
    const wallVarName = `wall_${clean}_T`;
    const wallId = interner.intern(wallVarName);
    arena.addVariable(wallVarName, VarType.Real, Variability.Continuous, Causality.Local);
    const wallExpr = arena.addExpression(ExprKind.Name, wallId);
    arena.addEquation(EqKind.InitialSimple, wallExpr, arena.addRealLiteral(initTempK - 2.0));

    const gHalfLit = arena.addRealLiteral(2.0 * gOpaque);
    const cWallLit = arena.addRealLiteral(s.cWallJPerK);

    const qWallFromAmb = arena.addBinaryExpr(BinOp.Mul, gHalfLit, arena.addBinaryExpr(BinOp.Sub, tAmbExpr, wallExpr));
    const qWallFromZone = arena.addBinaryExpr(BinOp.Mul, gHalfLit, arena.addBinaryExpr(BinOp.Sub, tempExpr, wallExpr));
    const qWallNet = arena.addBinaryExpr(BinOp.Add, qWallFromAmb, qWallFromZone);
    const derWall = arena.addExpression(ExprKind.Der, wallExpr);
    arena.addEquation(EqKind.Simple, derWall, arena.addBinaryExpr(BinOp.Div, qWallNet, cWallLit));

    // Heat flow from inner wall surface to zone air
    qTotalExpr = arena.addBinaryExpr(BinOp.Mul, gHalfLit, arena.addBinaryExpr(BinOp.Sub, wallExpr, tempExpr));

    if (gOpenings > 0.0) {
      const qOpen = arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(gOpenings), deltaTAmb);
      qTotalExpr = arena.addBinaryExpr(BinOp.Add, qTotalExpr, qOpen);
    }
  } else {
    // Purely resistive 1R1C envelope conduction
    const uaExt = s.uaExteriorTotalWPerK > 0.0 ? s.uaExteriorTotalWPerK : 50.0;
    qTotalExpr = arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(uaExt), deltaTAmb);
  }

  // Ground conduction
  if (s.uaGroundWPerK > 0.0) {
    const qGnd = arena.addBinaryExpr(
      BinOp.Mul,
      arena.addRealLiteral(s.uaGroundWPerK),
      arena.addBinaryExpr(BinOp.Sub, tGroundExpr, tempExpr),
    );
    qTotalExpr = arena.addBinaryExpr(BinOp.Add, qTotalExpr, qGnd);
  }

  // Infiltration: Q_inf = m_dot_inf * c_p * (T_amb - T_z)
  if (s.gInfiltrationWPerK > 0.0) {
    const qInf = arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(s.gInfiltrationWPerK), deltaTAmb);
    qTotalExpr = arena.addBinaryExpr(BinOp.Add, qTotalExpr, qInf);
  }

  // Glazing solar heat gain: Q_solar = sum(A_win * SHGC) * I_solar
  if (s.windowEffectiveSolarAreaM2 > 0.0) {
    const qSol = arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(s.windowEffectiveSolarAreaM2), iSolarExpr);
    qTotalExpr = arena.addBinaryExpr(BinOp.Add, qTotalExpr, qSol);
  }

  // Internal gains: people + lighting + equipment
  if (s.qInternalW > 0.0) {
    qTotalExpr = arena.addBinaryExpr(BinOp.Add, qTotalExpr, arena.addRealLiteral(s.qInternalW));
  }

  // Zone HVAC heating/cooling load variable
  const qHvacName = `zone_${clean}_Q_hvac`;
  const qHvacId = interner.intern(qHvacName);
  arena.addVariable(qHvacName, VarType.Real, Variability.Continuous, Causality.Local);
  const qHvacExpr = arena.addExpression(ExprKind.Name, qHvacId);

  if (s.hasHvac) {
    const tSetK = 0.5 * (s.heatSetpointC + s.coolSetpointC) + 273.15;
    const hvacLaw = arena.addBinaryExpr(
      BinOp.Mul,
      arena.addRealLiteral(hvacKp),
      arena.addBinaryExpr(BinOp.Sub, arena.addRealLiteral(tSetK), tempExpr),
    );
    arena.addEquation(EqKind.Simple, qHvacExpr, hvacLaw);
  } else {
    arena.addEquation(EqKind.Simple, qHvacExpr, arena.addRealLiteral(0.0));
  }

  qTotalExpr = arena.addBinaryExpr(BinOp.Add, qTotalExpr, qHvacExpr);

  // Zone thermal capacitance ODE: der(T_z) = Q_total / C_z
  const derT = arena.addExpression(ExprKind.Der, tempExpr);
  arena.addEquation(EqKind.Simple, derT, arena.addBinaryExpr(BinOp.Div, qTotalExpr, cZoneLit));
}
