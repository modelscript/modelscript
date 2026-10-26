// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/opendrive — Direct Linear-Memory DAE Lowering.
 *
 * Lowers OpenDRIVE road geometries, Frenet-Serret track tracking coordinates,
 * elevation polynomials, and vehicle trajectory states directly into
 * ModelScript's zero-GC DAEBuilder linear memory arena.
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
import type { OpenDriveDocument, OpenDriveRoad } from "../types.js";

export function lowerOpenDriveToDae(target: OpenDriveRoad | OpenDriveDocument, arenaTitle?: string): DAEBuilder {
  const title = arenaTitle ?? ("roads" in target ? (target.header.name ?? "OpenDRIVE_Network") : `Road_${target.id}`);
  const interner = new StringInterner();
  const arena = new DAEBuilder(interner, title);

  const roads: OpenDriveRoad[] = "roads" in target ? target.roads : [target];

  for (const road of roads) {
    lowerRoadToDae(arena, interner, road);
  }

  return arena;
}

function lowerRoadToDae(arena: DAEBuilder, interner: StringInterner, road: OpenDriveRoad): void {
  const prefix = `road_${road.id}`;

  // 1. Arc length s (Continuous dynamic state, der(s) = v)
  const sName = `${prefix}_s`;
  const sNameId = interner.intern(sName);
  arena.addVariable(sName, VarType.Real, Variability.Continuous, Causality.Local);
  const sExpr = arena.addExpression(ExprKind.Name, sNameId);

  // Initial s = 0.0
  const zeroLit = arena.addRealLiteral(0.0);
  arena.addEquation(EqKind.InitialSimple, sExpr, zeroLit);

  // 2. Velocity v (Continuous state or parameter, default 20.0 m/s ~ 72 km/h)
  const vName = `${prefix}_v`;
  const vNameId = interner.intern(vName);
  arena.addVariable(vName, VarType.Real, Variability.Parameter, Causality.Input);
  const vExpr = arena.addExpression(ExprKind.Name, vNameId);
  const vDefault = arena.addRealLiteral(20.0);
  arena.addEquation(EqKind.InitialSimple, vExpr, vDefault);

  // 3. Dynamic track rate: der(s) = v
  const derS = arena.addExpression(ExprKind.Der, sExpr);
  arena.addEquation(EqKind.Simple, derS, vExpr);

  // 4. Lateral tracking error e_y: der(e_y) = 0.0 (or v * sin(e_psi))
  const eyName = `${prefix}_e_y`;
  const eyNameId = interner.intern(eyName);
  arena.addVariable(eyName, VarType.Real, Variability.Continuous, Causality.Local);
  const eyExpr = arena.addExpression(ExprKind.Name, eyNameId);
  const derEy = arena.addExpression(ExprKind.Der, eyExpr);
  arena.addEquation(EqKind.Simple, derEy, zeroLit);

  // 5. Cartesian coordinates x, y, z
  const xName = `${prefix}_x`;
  const xNameId = interner.intern(xName);
  arena.addVariable(xName, VarType.Real, Variability.Continuous, Causality.Output);
  const xExpr = arena.addExpression(ExprKind.Name, xNameId);

  const yName = `${prefix}_y`;
  const yNameId = interner.intern(yName);
  arena.addVariable(yName, VarType.Real, Variability.Continuous, Causality.Output);
  const yExpr = arena.addExpression(ExprKind.Name, yNameId);

  const zName = `${prefix}_z`;
  const zNameId = interner.intern(zName);
  arena.addVariable(zName, VarType.Real, Variability.Continuous, Causality.Output);
  const zExpr = arena.addExpression(ExprKind.Name, zNameId);

  // 6. Curvature & Roll (Banking)
  const kName = `${prefix}_curvature`;
  const kNameId = interner.intern(kName);
  arena.addVariable(kName, VarType.Real, Variability.Continuous, Causality.Output);
  const kExpr = arena.addExpression(ExprKind.Name, kNameId);

  const rollName = `${prefix}_roll`;
  const rollNameId = interner.intern(rollName);
  arena.addVariable(rollName, VarType.Real, Variability.Continuous, Causality.Output);
  const rollExpr = arena.addExpression(ExprKind.Name, rollNameId);

  // Initial reference coordinates from start geometry
  const startGeom = road.planView[0];
  const startX = startGeom ? startGeom.x : 0.0;
  const startY = startGeom ? startGeom.y : 0.0;
  const startHdg = startGeom ? startGeom.hdg : 0.0;
  const startCurv =
    startGeom?.type === "arc" ? startGeom.curvature : startGeom?.type === "spiral" ? startGeom.curvStart : 0.0;

  // Algebraic kinematic position approximation: x = x0 + s * cos(hdg0)
  const x0Lit = arena.addRealLiteral(startX);
  const cosHdgLit = arena.addRealLiteral(Math.cos(startHdg));
  const sCosHdg = arena.addBinaryExpr(BinOp.Mul, sExpr, cosHdgLit);
  const xRhs = arena.addBinaryExpr(BinOp.Add, x0Lit, sCosHdg);
  arena.addEquation(EqKind.Simple, xExpr, xRhs);

  // y = y0 + s * sin(hdg0)
  const y0Lit = arena.addRealLiteral(startY);
  const sinHdgLit = arena.addRealLiteral(Math.sin(startHdg));
  const sSinHdg = arena.addBinaryExpr(BinOp.Mul, sExpr, sinHdgLit);
  const yRhs = arena.addBinaryExpr(BinOp.Add, y0Lit, sSinHdg);
  arena.addEquation(EqKind.Simple, yExpr, yRhs);

  // z = z0 + slope * s
  const startElev = road.elevationProfile[0];
  const z0 = startElev ? startElev.a : 0.0;
  const slope = startElev ? startElev.b : 0.0;
  const z0Lit = arena.addRealLiteral(z0);
  const slopeLit = arena.addRealLiteral(slope);
  const sSlope = arena.addBinaryExpr(BinOp.Mul, sExpr, slopeLit);
  const zRhs = arena.addBinaryExpr(BinOp.Add, z0Lit, sSlope);
  arena.addEquation(EqKind.Simple, zExpr, zRhs);

  // curvature = startCurv
  const curvLit = arena.addRealLiteral(startCurv);
  arena.addEquation(EqKind.Simple, kExpr, curvLit);

  // roll = startRoll
  const startRoll = road.lateralProfile[0]?.a ?? 0.0;
  const rollLit = arena.addRealLiteral(startRoll);
  arena.addEquation(EqKind.Simple, rollExpr, rollLit);
}
