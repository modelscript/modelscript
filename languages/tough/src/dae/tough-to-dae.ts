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
import type { ToughDeck } from "../types.js";

/**
 * Lowers TOUGH2/TOUGH3 non-isothermal reservoir grid blocks and inter-element flux connections
 * directly into ModelScript's zero-overhead DAEBuilder linear arena.
 */
export function lowerToughToDae(deck: ToughDeck, arenaTitle?: string): DAEBuilder {
  const title = arenaTitle ?? deck.title ?? "TOUGH_Geothermal_Reservoir";
  const interner = new StringInterner();
  const arena = new DAEBuilder(interner, title);

  const pExprs = new Map<string, number>();
  const tExprs = new Map<string, number>();

  // Map initial conditions if provided
  const inconMap = new Map<string, { p: number; t: number }>();
  for (const ic of deck.inconds) {
    inconMap.set(ic.elem.trim(), { p: ic.pressure, t: ic.temperature });
  }

  // 1. Elements (Grid Blocks) - 2 primary continuous state variables (P, T)
  for (const el of deck.elements) {
    const cleanId = el.name.replace(/[^a-zA-Z0-9_]/g, "_");
    const init = inconMap.get(el.name.trim()) ?? { p: 1.0e7, t: 200.0 };

    // Pressure variable
    const pName = `P_${cleanId}`;
    const pId = interner.intern(pName);
    arena.addVariable(pName, VarType.Real, Variability.Continuous, Causality.Local, init.p);
    const pExpr = arena.addExpression(ExprKind.Name, pId);
    pExprs.set(el.name.trim(), pExpr);

    // Initial pressure equation: P = init.p
    const pLit = arena.addRealLiteral(init.p);
    arena.addEquation(EqKind.Simple, pExpr, pLit);

    // Temperature variable
    const tName = `T_${cleanId}`;
    const tId = interner.intern(tName);
    arena.addVariable(tName, VarType.Real, Variability.Continuous, Causality.Local, init.t);
    const tExpr = arena.addExpression(ExprKind.Name, tId);
    tExprs.set(el.name.trim(), tExpr);

    // Initial temperature equation: T = init.t
    const tLit = arena.addRealLiteral(init.t);
    arena.addEquation(EqKind.Simple, tExpr, tLit);
  }

  // 2. Generators (Production/Injection Wells)
  for (const g of deck.generators) {
    const cleanId = `${g.elem}_${g.name}`.replace(/[^a-zA-Z0-9_]/g, "_");
    const qName = `Q_well_${cleanId}`;
    const qId = interner.intern(qName);
    arena.addVariable(qName, VarType.Real, Variability.Parameter, Causality.Input, g.rate);
    const qExpr = arena.addExpression(ExprKind.Name, qId);
    const qLit = arena.addRealLiteral(g.rate);
    arena.addEquation(EqKind.Simple, qExpr, qLit);
  }

  // 3. Connections (Inter-block Darcy & Conductive Heat Flux)
  for (let k = 0; k < deck.connections.length; k++) {
    const c = deck.connections[k]!;
    const e1 = c.elem1.trim();
    const e2 = c.elem2.trim();
    const p1 = pExprs.get(e1);
    const p2 = pExprs.get(e2);

    if (p1 !== undefined && p2 !== undefined) {
      const cleanConnId = `conn_${k + 1}_${e1}_${e2}`.replace(/[^a-zA-Z0-9_]/g, "_");
      const fluxName = `Flux_${cleanConnId}`;
      const fluxId = interner.intern(fluxName);
      arena.addVariable(fluxName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      const fluxExpr = arena.addExpression(ExprKind.Name, fluxId);

      // Darcy flux proportional to pressure diff (P1 - P2)
      const dTotal = Math.max(c.dist1 + c.dist2, 0.1);
      const transmissibility = (c.area / dTotal) * 1e-12; // approximate mobility
      const transLit = arena.addRealLiteral(transmissibility);

      const deltaP = arena.addBinaryExpr(BinOp.Sub, p1, p2);
      const rhsFlux = arena.addBinaryExpr(BinOp.Mul, transLit, deltaP);

      arena.addEquation(EqKind.Simple, fluxExpr, rhsFlux);
    }
  }

  return arena;
}
