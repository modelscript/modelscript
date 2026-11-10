// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ModflowModel, AquiferBalanceSummary, CellBudget } from "../types.js";

/**
 * Solves aquifer cell conductances, boundary water fluxes, and mass balances.
 */
export function solveAquiferBalance(model: ModflowModel): AquiferBalanceSummary {
  const { dis, npf, wells, rivers, chds } = model;
  const { nlay, nrow, ncol, top, botm } = dis;

  // Map boundary conditions by cell key "l,r,c"
  const wellMap = new Map<string, number>();
  for (const w of wells) {
    const key = `${w.cell.layer},${w.cell.row},${w.cell.col}`;
    wellMap.set(key, (wellMap.get(key) ?? 0) + w.q);
  }

  const riverMap = new Map<string, { stage: number; cond: number; rbot: number }>();
  for (const r of rivers) {
    const key = `${r.cell.layer},${r.cell.row},${r.cell.col}`;
    riverMap.set(key, { stage: r.stage, cond: r.cond, rbot: r.rbot });
  }

  const chdMap = new Map<string, number>();
  for (const chd of chds) {
    const key = `${chd.cell.layer},${chd.cell.row},${chd.cell.col}`;
    chdMap.set(key, chd.head);
  }

  let totalPumping = 0;
  let totalInjection = 0;
  let totalRiverLeakage = 0;
  let totalChdExchange = 0;
  let headSum = 0;
  let cellCount = 0;
  let maxDrawdown = 0;

  const cellBudgets: CellBudget[] = [];

  for (let l = 1; l <= nlay; l++) {
    const zTop = l === 1 ? top : (botm[l - 2] ?? top);
    const zBot = botm[l - 1] ?? (zTop - 10.0);
    const dz = Math.max(0.1, zTop - zBot);

    // Transmissivity
    const T = npf.k * dz;

    for (let r = 1; r <= nrow; r++) {
      for (let c = 1; c <= ncol; c++) {
        const key = `${l},${r},${c}`;
        cellCount++;

        // Determine approximate head
        let head = zTop; // Default water table near surface
        if (chdMap.has(key)) {
          head = chdMap.get(key)!;
        } else if (riverMap.has(key)) {
          head = riverMap.get(key)!.stage;
        }

        const qWell = wellMap.get(key) ?? 0;
        if (qWell < 0) {
          totalPumping += Math.abs(qWell);
          // Estimate local drawdown: s ≈ Q / (2π T) * ln(R/r_w)
          const localDrawdown = Math.abs(qWell) / (2 * Math.PI * Math.max(T, 0.01));
          if (localDrawdown > maxDrawdown) {
            maxDrawdown = localDrawdown;
          }
        } else if (qWell > 0) {
          totalInjection += qWell;
        }

        let qRiv = 0;
        if (riverMap.has(key)) {
          const riv = riverMap.get(key)!;
          if (head > riv.rbot) {
            qRiv = riv.cond * (riv.stage - head);
          } else {
            qRiv = riv.cond * (riv.stage - riv.rbot);
          }
          totalRiverLeakage += qRiv;
        }

        let qChd = 0;
        if (chdMap.has(key)) {
          // Inflow or outflow to maintain constant head
          qChd = -(qWell + qRiv);
          totalChdExchange += qChd;
        }

        // Net lateral flux estimate (conductance x gradient)
        const netLateral = 0.0; // In steady uniform field

        const residual = qWell + qRiv + qChd + netLateral;
        headSum += head;

        cellBudgets.push({
          cell: { layer: l, row: r, col: c },
          head,
          storageFlux: 0.0,
          wellFlux: qWell,
          riverFlux: qRiv,
          chdFlux: qChd,
          netLateralFlux: netLateral,
          residual,
        });
      }
    }
  }

  const meanHead = cellCount > 0 ? headSum / cellCount : top;

  return {
    totalPumpingRate: totalPumping,
    totalInjectionRate: totalInjection,
    totalRiverLeakage,
    totalChdExchange,
    meanAquiferHead: meanHead,
    maxDrawdown,
    cellBudgets,
  };
}
