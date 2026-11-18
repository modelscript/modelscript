// SPDX-License-Identifier: AGPL-3.0-or-later

import { solveLinearSystemSparse } from "@modelscript/runtime";
import type { BranchRecord, BusRecord, LoadRecord, PsseCase } from "../types.js";
import { extractPowerFlowNetlist } from "./powerflow-netlist.js";

export interface WardEquivalentResult {
  reducedCase: PsseCase;
  retainedBusCount: number;
  eliminatedBusCount: number;
  equivalentBranchCount: number;
}

/**
 * Performs Ward (Kron) static network equivalencing on a `PsseCase`,
 * eliminating all buses not in `retainedBuses` while preserving boundary
 * nodal admittance couplings and equivalent power injections.
 */
export function reduceNetworkEquivalent(psseCase: PsseCase, retainedBuses: number[]): WardEquivalentResult {
  const retainedSet = new Set(retainedBuses);
  const netlist = extractPowerFlowNetlist(psseCase);
  const N = netlist.nBuses;

  const rIndices: number[] = [];
  const eIndices: number[] = [];
  for (let idx = 0; idx < N; idx++) {
    const bNum = netlist.busNumbers[idx]!;
    if (retainedSet.has(bNum)) rIndices.push(idx);
    else eIndices.push(idx);
  }

  const nR = rIndices.length;
  const nE = eIndices.length;

  // Build dense complex Ybus sub-blocks (for moderate external subsystems)
  const getY = (row: number, col: number): [number, number] => [
    netlist.ybus.g.get(row)?.get(col) ?? 0,
    netlist.ybus.b.get(row)?.get(col) ?? 0,
  ];

  // Start with reduced case containing retained buses and existing retained equipment
  const buses = new Map<number, BusRecord>();
  for (const bNum of retainedBuses) {
    const b = psseCase.buses.get(bNum);
    if (b) buses.set(bNum, { ...b });
  }

  const loads: LoadRecord[] = psseCase.loads.filter((l) => retainedSet.has(l.i)).map((l) => ({ ...l }));

  const branches: BranchRecord[] = psseCase.branches
    .filter((br) => retainedSet.has(br.i) && retainedSet.has(br.j))
    .map((br) => ({ ...br }));

  const fixedShunts = psseCase.fixedShunts.filter((s) => retainedSet.has(s.i)).map((s) => ({ ...s }));
  const sbaseMva = psseCase.header.sbase > 0 ? psseCase.header.sbase : 100.0;

  let equivalentBranchCount = 0;

  if (nE > 0 && nR > 0) {
    // Assemble real 2*nE x 2*nE system for Y_EE to solve Y_EE * X = Y_ER
    const dimE = 2 * nE;
    const matEE = new Float64Array(dimE * dimE);

    for (let a = 0; a < nE; a++) {
      for (let b = 0; b < nE; b++) {
        const [g, bVal] = getY(eIndices[a]!, eIndices[b]!);
        if (g !== 0 || bVal !== 0) {
          matEE[2 * a * dimE + 2 * b] = g;
          matEE[2 * a * dimE + 2 * b + 1] = -bVal;
          matEE[(2 * a + 1) * dimE + 2 * b] = bVal;
          matEE[(2 * a + 1) * dimE + 2 * b + 1] = g;
        }
      }
    }

    // Solve for each retained column j: Y_EE * col = Y_ER[:, j]
    for (let j = 0; j < nR; j++) {
      const rhsR = new Float64Array(dimE);
      for (let a = 0; a < nE; a++) {
        const [g, bVal] = getY(eIndices[a]!, rIndices[j]!);
        rhsR[2 * a] = g;
        rhsR[2 * a + 1] = bVal;
      }

      const ok = solveLinearSystemSparse(matEE, rhsR, dimE, { sparseThreshold: 30 });
      if (!ok) continue;

      // Diagonal boundary shunt delta: dY_jj = -(Y_RE * Y_EE^-1 * Y_ER)_jj
      let diagDg = 0;
      let diagDb = 0;
      for (let a = 0; a < nE; a++) {
        const [gRe, bRe] = getY(rIndices[j]!, eIndices[a]!);
        const xr = rhsR[2 * a]!;
        const xi = rhsR[2 * a + 1]!;
        diagDg += gRe * xr - bRe * xi;
        diagDb += gRe * xi + bRe * xr;
      }
      if (Math.hypot(diagDg, diagDb) > 1e-6) {
        const busJ = netlist.busNumbers[rIndices[j]!]!;
        fixedShunts.push({
          i: busJ,
          id: "EQ",
          status: 1,
          gl: Number((-diagDg * sbaseMva).toFixed(4)),
          bl: Number((-diagDb * sbaseMva).toFixed(4)),
        });
      }

      for (let i = j + 1; i < nR; i++) {
        let dg = 0;
        let db = 0;
        for (let a = 0; a < nE; a++) {
          const [gRe, bRe] = getY(rIndices[i]!, eIndices[a]!);
          const xr = rhsR[2 * a]!;
          const xi = rhsR[2 * a + 1]!;
          dg += gRe * xr - bRe * xi;
          db += gRe * xi + bRe * xr;
        }
        if (Math.hypot(dg, db) > 1e-6) {
          const busI = netlist.busNumbers[rIndices[i]!]!;
          const busJ = netlist.busNumbers[rIndices[j]!]!;
          const denom = dg * dg + db * db;
          if (denom > 1e-12) {
            const rEq = dg / denom;
            const xEq = -db / denom;
            branches.push({
              i: busI,
              j: busJ,
              ckt: "EQ",
              r: Number(rEq.toFixed(6)),
              x: Number(xEq.toFixed(6)),
              b: 0,
              rateA: 9999,
              rateB: 9999,
              rateC: 9999,
              gi: 0,
              bi: 0,
              gj: 0,
              bj: 0,
              st: 1,
              met: 1,
              len: 0,
            });
            equivalentBranchCount++;
          }
        }
      }
    }

    // Redistribute eliminated external bus injections: I_eq_R = -Y_RE * Y_EE^-1 * I_E
    const rhsI = new Float64Array(2 * nE);
    for (let a = 0; a < nE; a++) {
      const eIdx = eIndices[a]!;
      const vm = Math.max(0.1, netlist.vMagPu[eIdx] ?? 1.0);
      const va = netlist.vAngRad[eIdx] ?? 0.0;
      const vr = vm * Math.cos(va);
      const vi = vm * Math.sin(va);
      const v2 = vr * vr + vi * vi;
      const pPu = (netlist.pNetMw[eIdx] ?? 0) / sbaseMva;
      const qPu = (netlist.qNetMvar[eIdx] ?? 0) / sbaseMva;
      rhsI[2 * a] = (pPu * vr + qPu * vi) / v2;
      rhsI[2 * a + 1] = (pPu * vi - qPu * vr) / v2;
    }
    if (solveLinearSystemSparse(matEE, rhsI, dimE, { sparseThreshold: 30 })) {
      for (let i = 0; i < nR; i++) {
        const rIdx = rIndices[i]!;
        let irEq = 0;
        let iiEq = 0;
        for (let a = 0; a < nE; a++) {
          const [gRe, bRe] = getY(rIdx, eIndices[a]!);
          const xr = rhsI[2 * a]!;
          const xi = rhsI[2 * a + 1]!;
          irEq -= gRe * xr - bRe * xi;
          iiEq -= gRe * xi + bRe * xr;
        }
        if (Math.hypot(irEq, iiEq) > 1e-6) {
          const vm = Math.max(0.1, netlist.vMagPu[rIdx] ?? 1.0);
          const va = netlist.vAngRad[rIdx] ?? 0.0;
          const vr = vm * Math.cos(va);
          const vi = vm * Math.sin(va);
          const pEqMw = (vr * irEq + vi * iiEq) * sbaseMva;
          const qEqMvar = (vi * irEq - vr * iiEq) * sbaseMva;
          loads.push({
            i: netlist.busNumbers[rIdx]!,
            id: "EQ",
            status: 1,
            area: 1,
            zone: 1,
            pl: Number((-pEqMw).toFixed(4)),
            ql: Number((-qEqMvar).toFixed(4)),
            ip: 0,
            iq: 0,
            yp: 0,
            yq: 0,
            owner: 1,
            scale: 0,
            intrct: 0,
          });
        }
      }
    }
  }

  const reducedCase: PsseCase = {
    ...psseCase,
    title1: `${psseCase.title1 || "PSS/E CASE"} (WARD EQUIV ${nR} BUSES)`,
    buses,
    loads,
    fixedShunts,
    generators: psseCase.generators.filter((g) => retainedSet.has(g.i)).map((g) => ({ ...g })),
    branches,
    transformers: psseCase.transformers
      .filter((t) => retainedSet.has(t.i) && retainedSet.has(t.j) && (!t.k || retainedSet.has(t.k)))
      .map((t) => ({ ...t })),
    switchedShunts: psseCase.switchedShunts.filter((s) => retainedSet.has(s.i)).map((s) => ({ ...s })),
  };

  return {
    reducedCase,
    retainedBusCount: nR,
    eliminatedBusCount: nE,
    equivalentBranchCount,
  };
}
