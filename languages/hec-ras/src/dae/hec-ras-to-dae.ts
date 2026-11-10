// SPDX-License-Identifier: AGPL-3.0-or-later

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
import { computeSectionProperties } from "../solver/steady-step-solver.js";
import type { HecRasFlow, HecRasGeometry } from "../types.js";

const GRAVITY = 9.80665;

export function lowerHecRasToDae(geom: HecRasGeometry, flow?: HecRasFlow, arenaTitle?: string): DAEBuilder {
  const title = arenaTitle ?? geom.title ?? "HEC_RAS_River_Hydraulics";
  const interner = new StringInterner();
  const arena = new DAEBuilder(interner, title);

  if (geom.crossSections.length === 0) {
    return arena;
  }

  // Sort cross-sections upstream to downstream
  const sorted = [...geom.crossSections].sort((a, b) => b.station - a.station);

  // Determine discharge from flow file or default to 100 m^3/s
  let defaultDischarge = 100.0;
  let frictionSlope = 0.001;
  let knownStage: number | undefined;

  if (flow && flow.boundaryConditions.length > 0) {
    for (const bc of flow.boundaryConditions) {
      if (bc.type === "Flow Hydrograph" && bc.hydrograph && bc.hydrograph.length > 0) {
        defaultDischarge = bc.hydrograph[0]!.flowOrStage;
      }
      if (bc.type === "Normal Depth" && bc.frictionSlope) {
        frictionSlope = bc.frictionSlope;
      }
      if (bc.type === "Known WS" && bc.knownStage !== undefined) {
        knownStage = bc.knownStage;
      }
    }
  }

  // Parameter: Gravity
  const gId = interner.intern("gravity");
  arena.addVariable("gravity", VarType.Real, Variability.Constant, Causality.Local, GRAVITY);
  const gExpr = arena.addExpression(ExprKind.Name, gId);

  // Variables and equations per cross section
  const wselExprs: number[] = [];
  const eglExprs: number[] = [];
  const qExprs: number[] = [];
  const vExprs: number[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const cs = sorted[i]!;
    const cleanId = `${cs.river}_${cs.reach}_sta_${cs.station}`.replace(/[^a-zA-Z0-9_]/g, "_");

    // Invert elevation
    const minZ = cs.stationElevations.reduce((min, p) => Math.min(min, p.elevation), Infinity);
    const initWsel = minZ + 2.0;
    const initProps = computeSectionProperties(cs, initWsel);
    const initArea = Math.max(initProps.area, 1.0);
    const initVel = defaultDischarge / initArea;
    const initHv = (initVel * initVel) / (2 * GRAVITY);
    const initEgl = initWsel + initHv;

    // 1. Water Surface Elevation (WSEL)
    const wselName = `wsel_${cleanId}`;
    const wselId = interner.intern(wselName);
    arena.addVariable(wselName, VarType.Real, Variability.Continuous, Causality.Local, initWsel);
    const wselExpr = arena.addExpression(ExprKind.Name, wselId);
    wselExprs.push(wselExpr);

    // 2. Discharge (Q)
    const qName = `Q_${cleanId}`;
    const qId = interner.intern(qName);
    arena.addVariable(qName, VarType.Real, Variability.Continuous, Causality.Local, defaultDischarge);
    const qExpr = arena.addExpression(ExprKind.Name, qId);
    qExprs.push(qExpr);

    // 3. Flow Velocity (v)
    const vName = `v_${cleanId}`;
    const vId = interner.intern(vName);
    arena.addVariable(vName, VarType.Real, Variability.Continuous, Causality.Local, initVel);
    const vExpr = arena.addExpression(ExprKind.Name, vId);
    vExprs.push(vExpr);

    // 4. Energy Grade Line (EGL)
    const eglName = `egl_${cleanId}`;
    const eglId = interner.intern(eglName);
    arena.addVariable(eglName, VarType.Real, Variability.Continuous, Causality.Local, initEgl);
    const eglExpr = arena.addExpression(ExprKind.Name, eglId);
    eglExprs.push(eglExpr);

    // 5. Inflow equation: Q = defaultDischarge (steady reach)
    const qLit = arena.addRealLiteral(defaultDischarge);
    arena.addEquation(EqKind.Simple, qExpr, qLit);

    // 6. Velocity Head definition: EGL = WSEL + (v^2) / (2*g)
    const vSquared = arena.addBinaryExpr(BinOp.Mul, vExpr, vExpr);
    const twoG = arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(2.0), gExpr);
    const hvExpr = arena.addBinaryExpr(BinOp.Div, vSquared, twoG);
    const eglRhs = arena.addBinaryExpr(BinOp.Add, wselExpr, hvExpr);
    arena.addEquation(EqKind.Simple, eglExpr, eglRhs);
  }

  // Downstream Boundary Equation (at ds index = sorted.length - 1)
  const dsIdx = sorted.length - 1;
  const dsCs = sorted[dsIdx]!;
  const dsWselExpr = wselExprs[dsIdx]!;

  if (knownStage !== undefined) {
    const stageLit = arena.addRealLiteral(knownStage);
    arena.addEquation(EqKind.Simple, dsWselExpr, stageLit);
  } else {
    // Normal depth approximation: set initial downstream stage
    const minZ = dsCs.stationElevations.reduce((min, p) => Math.min(min, p.elevation), Infinity);
    const approxNormalWsel = minZ + Math.pow((defaultDischarge * dsCs.manning.channel) / Math.sqrt(frictionSlope), 0.6);
    const normalLit = arena.addRealLiteral(approxNormalWsel);
    arena.addEquation(EqKind.Simple, dsWselExpr, normalLit);
  }

  // Energy loss equations linking upstream to downstream sections
  for (let i = 0; i < sorted.length - 1; i++) {
    const usEgl = eglExprs[i]!;
    const dsEgl = eglExprs[i + 1]!;
    const csUs = sorted[i]!;
    const csDs = sorted[i + 1]!;
    const dx = csUs.reachLengths.channel || Math.abs(csUs.station - csDs.station) || 100;

    // Head loss: hf = dx * Sf_approx
    const hfLoss = dx * frictionSlope;
    const hfLit = arena.addRealLiteral(hfLoss);
    const targetEgl = arena.addBinaryExpr(BinOp.Add, dsEgl, hfLit);

    arena.addEquation(EqKind.Simple, usEgl, targetEgl);
  }

  return arena;
}
