// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/epanet — Direct Linear-Memory DAE Lowering.
 *
 * Lowers EPANET hydraulic networks, nodal continuity balances, and non-linear
 * pipe friction head losses directly into ModelScript's zero-GC DAEBuilder linear arena.
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
import type { EpanetNetwork } from "../types.js";

export function lowerEpanetToDae(net: EpanetNetwork, arenaTitle?: string): DAEBuilder {
  const title = arenaTitle ?? net.title ?? "EPANET_Water_Network";
  const interner = new StringInterner();
  const arena = new DAEBuilder(interner, title);

  const nodeHeadExprs = new Map<string, number>();
  const tankLevelExprs = new Map<string, number>();

  // 1. Reservoirs (Fixed Source Heads) — 1 variable, 1 equation per reservoir
  for (const r of net.reservoirs) {
    const cleanId = r.id.replace(/[^a-zA-Z0-9_]/g, "_");
    const hName = `res_${cleanId}_H`;
    const hId = interner.intern(hName);
    arena.addVariable(hName, VarType.Real, Variability.Parameter, Causality.Input, r.totalHead);
    const hExpr = arena.addExpression(ExprKind.Name, hId);
    const hLit = arena.addRealLiteral(r.totalHead);
    arena.addEquation(EqKind.Simple, hExpr, hLit);
    nodeHeadExprs.set(r.id.toLowerCase(), hExpr);
  }

  // 2. Storage Tanks (Dynamic Mass Accumulation) — 2 variables, 2 equations per tank
  for (const t of net.tanks) {
    const cleanId = t.id.replace(/[^a-zA-Z0-9_]/g, "_");
    const lvlName = `tank_${cleanId}_level`;
    const lvlId = interner.intern(lvlName);
    arena.addVariable(lvlName, VarType.Real, Variability.Continuous, Causality.Local, t.initLevel);
    const lvlExpr = arena.addExpression(ExprKind.Name, lvlId);
    tankLevelExprs.set(t.id.toLowerCase(), lvlExpr);

    // Head = elevation + level
    const hName = `tank_${cleanId}_H`;
    const hId = interner.intern(hName);
    arena.addVariable(hName, VarType.Real, Variability.Continuous, Causality.Local, t.elevation + t.initLevel);
    const hExpr = arena.addExpression(ExprKind.Name, hId);
    const elevLit = arena.addRealLiteral(t.elevation);
    const sumHead = arena.addBinaryExpr(BinOp.Add, elevLit, lvlExpr);
    arena.addEquation(EqKind.Simple, hExpr, sumHead);

    nodeHeadExprs.set(t.id.toLowerCase(), hExpr);
  }

  // 3. Junctions (Pressure Heads & Variable Pressures) — 2 variables, 2 equations per junction
  for (const j of net.junctions) {
    const cleanId = j.id.replace(/[^a-zA-Z0-9_]/g, "_");
    const hName = `junc_${cleanId}_H`;
    const hId = interner.intern(hName);
    arena.addVariable(hName, VarType.Real, Variability.Continuous, Causality.Local, Math.max(j.elevation + 20.0, 50.0));
    const hExpr = arena.addExpression(ExprKind.Name, hId);
    nodeHeadExprs.set(j.id.toLowerCase(), hExpr);

    // Pressure P = H - Elev
    const pName = `junc_${cleanId}_P`;
    const pId = interner.intern(pName);
    arena.addVariable(pName, VarType.Real, Variability.Continuous, Causality.Output, 20.0);
    const pExpr = arena.addExpression(ExprKind.Name, pId);
    const elevLit = arena.addRealLiteral(j.elevation);
    const pressDiff = arena.addBinaryExpr(BinOp.Sub, hExpr, elevLit);
    arena.addEquation(EqKind.Simple, pExpr, pressDiff);
  }

  // 4. Pipes (Friction Head Loss Equations) — 1 variable, 1 equation per pipe
  const pipeFlowExprs = new Map<string, number>();

  for (const p of net.pipes) {
    const cleanId = p.id.replace(/[^a-zA-Z0-9_]/g, "_");
    const qName = `pipe_${cleanId}_Q`;
    const qId = interner.intern(qName);
    arena.addVariable(qName, VarType.Real, Variability.Continuous, Causality.Local, 10.0);
    const qExpr = arena.addExpression(ExprKind.Name, qId);
    pipeFlowExprs.set(p.id.toLowerCase(), qExpr);

    // Head loss: H_1 - H_2 = r * Q
    const h1Expr = nodeHeadExprs.get(p.node1.toLowerCase());
    const h2Expr = nodeHeadExprs.get(p.node2.toLowerCase());

    if (h1Expr !== undefined && h2Expr !== undefined) {
      const deltaH = arena.addBinaryExpr(BinOp.Sub, h1Expr, h2Expr);
      // Linearized resistance: r = 0.05 * L / D
      const D = p.diameter > 5.0 ? p.diameter / 1000.0 : p.diameter;
      const rNominal = 0.001 * (p.length / Math.max(0.01, D));
      const rLit = arena.addRealLiteral(Math.max(0.0001, rNominal));
      const frictionLoss = arena.addBinaryExpr(BinOp.Mul, rLit, qExpr);
      arena.addEquation(EqKind.Simple, deltaH, frictionLoss);
    } else {
      arena.addEquation(EqKind.Simple, qExpr, arena.addRealLiteral(0.0));
    }
  }

  // 5. Tank Dynamic Level Equations: A_tank * der(level) = (sum(Q_in) - sum(Q_out)) * 1e-3
  for (const t of net.tanks) {
    const tId = t.id.toLowerCase();
    const lvlExpr = tankLevelExprs.get(tId);
    if (lvlExpr === undefined) continue;

    const inPipes = net.pipes.filter((p) => p.node2.toLowerCase() === tId);
    const outPipes = net.pipes.filter((p) => p.node1.toLowerCase() === tId);

    let netFlowExpr = arena.addRealLiteral(0.0);
    for (const ip of inPipes) {
      const qExp = pipeFlowExprs.get(ip.id.toLowerCase());
      if (qExp !== undefined) {
        netFlowExpr = arena.addBinaryExpr(BinOp.Add, netFlowExpr, qExp);
      }
    }
    for (const op of outPipes) {
      const qExp = pipeFlowExprs.get(op.id.toLowerCase());
      if (qExp !== undefined) {
        netFlowExpr = arena.addBinaryExpr(BinOp.Sub, netFlowExpr, qExp);
      }
    }

    const diam = Math.max(0.5, t.diameter);
    const area = (Math.PI * diam * diam) / 4.0;
    const scaleLit = arena.addRealLiteral(1.0 / (area * 1000.0)); // convert L/s to m/s
    const derLvl = arena.addExpression(ExprKind.Der, lvlExpr);
    const rhsRate = arena.addBinaryExpr(BinOp.Mul, scaleLit, netFlowExpr);
    arena.addEquation(EqKind.Simple, derLvl, rhsRate);
  }

  // 6. Flow Continuity Balance at Junctions
  for (const j of net.junctions) {
    const jId = j.id.toLowerCase();
    // Inflow pipes
    const inPipes = net.pipes.filter((p) => p.node2.toLowerCase() === jId);
    // Outflow pipes
    const outPipes = net.pipes.filter((p) => p.node1.toLowerCase() === jId);

    if (inPipes.length > 0 || outPipes.length > 0) {
      const zeroLit = arena.addRealLiteral(0.0);
      let netFlowExpr = zeroLit;

      for (const ip of inPipes) {
        const qExp = pipeFlowExprs.get(ip.id.toLowerCase());
        if (qExp !== undefined) {
          netFlowExpr = arena.addBinaryExpr(BinOp.Add, netFlowExpr, qExp);
        }
      }
      for (const op of outPipes) {
        const qExp = pipeFlowExprs.get(op.id.toLowerCase());
        if (qExp !== undefined) {
          netFlowExpr = arena.addBinaryExpr(BinOp.Sub, netFlowExpr, qExp);
        }
      }

      const demandLit = arena.addRealLiteral(j.demand);
      arena.addEquation(EqKind.Simple, netFlowExpr, demandLit);
    } else {
      const hExpr = nodeHeadExprs.get(jId);
      if (hExpr !== undefined) {
        arena.addEquation(EqKind.Simple, hExpr, arena.addRealLiteral(j.elevation));
      }
    }
  }

  return arena;
}
