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
import type { ModflowModel } from "../types.js";

/**
 * Lowers MODFLOW 6 structured groundwater cells, conductances, wells, and boundary conditions
 * directly into ModelScript's DAEBuilder linear arena.
 */
export function lowerModflowToDae(model: ModflowModel, arenaTitle?: string): DAEBuilder {
  const title = arenaTitle ?? model.name ?? "MODFLOW_Aquifer_Flow";
  const interner = new StringInterner();
  const arena = new DAEBuilder(interner, title);

  const { dis, npf, wells, rivers, chds } = model;
  const { nlay, nrow, ncol, delr, delc, top, botm } = dis;

  const dx = delr[0] ?? 100.0;
  const dy = delc[0] ?? 100.0;

  // Map CHDs
  const chdMap = new Map<string, number>();
  for (const chd of chds) {
    chdMap.set(`${chd.cell.layer},${chd.cell.row},${chd.cell.col}`, chd.head);
  }

  // Map Wells
  const wellMap = new Map<string, number>();
  for (const w of wells) {
    const k = `${w.cell.layer},${w.cell.row},${w.cell.col}`;
    wellMap.set(k, (wellMap.get(k) ?? 0) + w.q);
  }

  // Map Rivers
  const rivMap = new Map<string, { stage: number; cond: number; rbot: number }>();
  for (const r of rivers) {
    rivMap.set(`${r.cell.layer},${r.cell.row},${r.cell.col}`, {
      stage: r.stage,
      cond: r.cond,
      rbot: r.rbot,
    });
  }

  // Store head expression IDs for each cell: key -> exprId
  const headExprs = new Map<string, number>();

  // 1. Declare hydraulic head variables for all active cells
  for (let l = 1; l <= nlay; l++) {
    const zTop = l === 1 ? top : (botm[l - 2] ?? top);
    const initialH = chdMap.get(`${l},1,1`) ?? zTop;

    for (let r = 1; r <= nrow; r++) {
      for (let c = 1; c <= ncol; c++) {
        const key = `${l},${r},${c}`;
        const headName = `h_L${l}_R${r}_C${c}`;
        const headId = interner.intern(headName);

        const isChd = chdMap.has(key);
        const fixedVal = chdMap.get(key) ?? initialH;

        arena.addVariable(
          headName,
          VarType.Real,
          isChd ? Variability.Parameter : Variability.Continuous,
          isChd ? Causality.Input : Causality.Local,
          fixedVal,
        );

        const hExpr = arena.addExpression(ExprKind.Name, headId);
        headExprs.set(key, hExpr);

        if (isChd) {
          // Pinned head equation: h = fixedVal
          const chdLit = arena.addRealLiteral(fixedVal);
          arena.addEquation(EqKind.Simple, hExpr, chdLit);
        }
      }
    }
  }

  // 2. Lateral flux and conservation equations for non-CHD cells
  for (let l = 1; l <= nlay; l++) {
    const zTop = l === 1 ? top : (botm[l - 2] ?? top);
    const zBot = botm[l - 1] ?? (zTop - 10.0);
    const dz = Math.max(0.1, zTop - zBot);

    // Lateral conductances
    const T = npf.k * dz;
    const condCol = (T * dy) / dx;
    const condRow = (T * dx) / dy;

    for (let r = 1; r <= nrow; r++) {
      for (let c = 1; c <= ncol; c++) {
        const key = `${l},${r},${c}`;
        if (chdMap.has(key)) {
          // Already constrained
          continue;
        }

        const hCenter = headExprs.get(key)!;
        const neighborTerms: number[] = [];

        // Left neighbor (c - 1)
        if (c > 1) {
          const hLeft = headExprs.get(`${l},${r},${c - 1}`)!;
          const dH = arena.addBinaryExpr(BinOp.Sub, hLeft, hCenter);
          const cLit = arena.addRealLiteral(condCol);
          neighborTerms.push(arena.addBinaryExpr(BinOp.Mul, cLit, dH));
        }
        // Right neighbor (c + 1)
        if (c < ncol) {
          const hRight = headExprs.get(`${l},${r},${c + 1}`)!;
          const dH = arena.addBinaryExpr(BinOp.Sub, hRight, hCenter);
          const cLit = arena.addRealLiteral(condCol);
          neighborTerms.push(arena.addBinaryExpr(BinOp.Mul, cLit, dH));
        }
        // Upper neighbor (r - 1)
        if (r > 1) {
          const hUp = headExprs.get(`${l},${r - 1},${c}`)!;
          const dH = arena.addBinaryExpr(BinOp.Sub, hUp, hCenter);
          const cLit = arena.addRealLiteral(condRow);
          neighborTerms.push(arena.addBinaryExpr(BinOp.Mul, cLit, dH));
        }
        // Lower neighbor (r + 1)
        if (r < nrow) {
          const hDown = headExprs.get(`${l},${r + 1},${c}`)!;
          const dH = arena.addBinaryExpr(BinOp.Sub, hDown, hCenter);
          const cLit = arena.addRealLiteral(condRow);
          neighborTerms.push(arena.addBinaryExpr(BinOp.Mul, cLit, dH));
        }

        // Well extraction / injection
        if (wellMap.has(key)) {
          const qW = wellMap.get(key)!;
          const qWLit = arena.addRealLiteral(qW);
          neighborTerms.push(qWLit);
        }

        // River leakage
        if (rivMap.has(key)) {
          const riv = rivMap.get(key)!;
          const stageLit = arena.addRealLiteral(riv.stage);
          const condLit = arena.addRealLiteral(riv.cond);
          const dHRiv = arena.addBinaryExpr(BinOp.Sub, stageLit, hCenter);
          const qRiv = arena.addBinaryExpr(BinOp.Mul, condLit, dHRiv);
          neighborTerms.push(qRiv);
        }

        // Sum terms to form net flux = 0 (steady-state) or accumulation
        if (neighborTerms.length > 0) {
          let sumExpr = neighborTerms[0]!;
          for (let i = 1; i < neighborTerms.length; i++) {
            sumExpr = arena.addBinaryExpr(BinOp.Add, sumExpr, neighborTerms[i]!);
          }
          const zeroLit = arena.addRealLiteral(0.0);
          arena.addEquation(EqKind.Simple, sumExpr, zeroLit);
        }
      }
    }
  }

  return arena;
}
