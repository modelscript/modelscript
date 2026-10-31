// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/eclipse — Multiphase Darcy Flow & Reservoir Material Balance Solver.
 *
 * Implements Peaceman well inflow performance (IPR), multiphase relative permeability,
 * STOIIP / GIIP volumetric calculations, and multi-step reservoir depletion.
 */

import type { EclipseDeck } from "../types.js";

export interface ReservoirSolverOptions {
  totalDays?: number | undefined; // default 365.0 days
  stepDays?: number | undefined; // default 30.0 days
  totalCompressibility?: number | undefined; // 1/psi or 1/bar (default 1e-5)
}

export interface WellProductionSample {
  wellName: string;
  oilRate: number; // stb/d or sm3/d
  waterRate: number;
  gasRate: number;
  waterCut: number; // fraction 0 - 1
  bhp: number; // psi or bar
}

export interface ReservoirStepRecord {
  timeDays: number;
  averagePressure: number; // psi or bar
  cumulativeOil: number; // STB or sm3
  cumulativeWater: number;
  cumulativeGas: number;
  waterCut: number;
  wells: WellProductionSample[];
  cellPressures: number[];
  cellWaterSaturations: number[];
}

export interface ReservoirSimulationResult {
  title: string;
  units: string;
  poreVolume: number; // bbl or m3
  stoiip: number; // Stock Tank Oil Initially In Place (STB or sm3)
  giip: number; // Gas Initially In Place (Mscf or sm3)
  initialPressure: number;
  finalPressure: number;
  recoveryFactor: number; // Np / STOIIP fraction
  cumulativeOilProduced: number;
  stepsCount: number;
  trajectory: ReservoirStepRecord[];
  cellPressures: number[];
  cellWaterSaturations: number[];
}

export type EclipseSimulationResult = ReservoirSimulationResult;

function interpolatePvdo(
  pvdo: { pressure: number; fvf: number; viscosity?: number | undefined }[],
  p: number,
): { bo: number; muO: number } {
  const first = pvdo?.[0];
  if (!first) return { bo: 1.25, muO: 1.0 };
  if (p <= first.pressure) return { bo: first.fvf, muO: first.viscosity ?? 1.0 };
  for (let i = 0; i < pvdo.length - 1; i++) {
    const p1 = pvdo[i];
    const p2 = pvdo[i + 1];
    if (!p1 || !p2) continue;
    if (p >= p1.pressure && p <= p2.pressure) {
      const frac = (p - p1.pressure) / (p2.pressure - p1.pressure || 1e-6);
      const bo = p1.fvf + frac * (p2.fvf - p1.fvf);
      const mu1 = p1.viscosity ?? 1.0;
      const mu2 = p2.viscosity ?? 1.0;
      const muO = mu1 + frac * (mu2 - mu1);
      return { bo, muO };
    }
  }
  const last = pvdo[pvdo.length - 1] ?? first;
  return { bo: last.fvf, muO: last.viscosity ?? 1.0 };
}

function interpolateSwof(
  swof: { saturation: number; krPhase: number; krowPhase: number }[],
  sw: number,
): { krw: number; kro: number } {
  const first = swof?.[0];
  if (!first) {
    const swNorm = Math.max(0, Math.min(1, sw));
    return { krw: Math.pow(swNorm, 2), kro: Math.pow(1 - swNorm, 2) };
  }
  if (sw <= first.saturation) return { krw: first.krPhase, kro: first.krowPhase };
  for (let i = 0; i < swof.length - 1; i++) {
    const pt1 = swof[i];
    const pt2 = swof[i + 1];
    if (!pt1 || !pt2) continue;
    if (sw >= pt1.saturation && sw <= pt2.saturation) {
      const frac = (sw - pt1.saturation) / (pt2.saturation - pt1.saturation || 1e-6);
      return {
        krw: pt1.krPhase + frac * (pt2.krPhase - pt1.krPhase),
        kro: pt1.krowPhase + frac * (pt2.krowPhase - pt1.krowPhase),
      };
    }
  }
  const last = swof[swof.length - 1] ?? first;
  return { krw: last.krPhase, kro: last.krowPhase };
}

export function solveReservoirDepletion(
  deck: EclipseDeck,
  options?: ReservoirSolverOptions,
): ReservoirSimulationResult {
  const isField = deck.units === "FIELD";
  const bblPerFt3 = 1.0 / 5.614583;

  // 1. Volumetric calculations
  const nx = Math.max(1, deck.dimensions.nx);
  const ny = Math.max(1, deck.dimensions.ny);
  const nz = Math.max(1, deck.dimensions.nz);
  const totalCells = nx * ny * nz;

  const dx = deck.grid.dx;
  const dy = deck.grid.dy;
  const dz = deck.grid.dz;
  const vBulkCell = dx * dy * dz;
  const vBulkTotal = vBulkCell * totalCells;

  const phi = deck.grid.poro;
  const vPoreTotal = vBulkTotal * phi;
  const vPore = isField ? vPoreTotal * bblPerFt3 : vPoreTotal; // bbl or m^3
  const vPoreCellDefault = vPore / totalCells;

  const swc = deck.solution.initialSwat ?? deck.props.swof[0]?.saturation ?? 0.2;
  const maxSw = deck.props.swof[deck.props.swof.length - 1]?.saturation ?? 0.85;
  const boi = deck.props.pvdo[0]?.fvf ?? 1.25; // rb/stb or rm3/sm3
  const bgi = deck.props.pvdg[0]?.fvf ?? 0.001; // rb/scf or rm3/sm3

  // STOIIP = Vp * (1 - Swc) / Boi
  const stoiip = (vPore * (1.0 - swc)) / boi;

  // GIIP = Vp * Sg / Bgi
  const sgi = Math.max(0, 1.0 - swc - 0.7); // initial free gas if any
  const giip = isField ? (vPore * sgi) / (bgi * 1000.0) : (vPore * sgi) / bgi;

  // 2. Initial Reservoir State & 3D TPFA Grid Initialization
  let pres = deck.solution.initialPressure ?? 4000.0; // psi or bar
  const initPres = pres;
  const ct = options?.totalCompressibility ?? (isField ? 1.2e-5 : 1.7e-4);

  const cellP = new Float64Array(totalCells);
  const cellSw = new Float64Array(totalCells);
  const cellVp = new Float64Array(totalCells);
  const cellTx = new Float64Array(totalCells);
  const cellTy = new Float64Array(totalCells);
  const cellTz = new Float64Array(totalCells);

  // Darcy transmissibility conversion factor (rb/d / (cP * psi) or rm3/d / (cP * bar))
  const cDarcy = isField ? 0.001127 : 0.008527;

  for (let idx = 0; idx < totalCells; idx++) {
    cellP[idx] = initPres;
    cellSw[idx] = swc;
    const poroCell = deck.grid.poroArray?.[idx] ?? phi;
    cellVp[idx] = Math.max(1e-3, isField ? vBulkCell * poroCell * bblPerFt3 : vBulkCell * poroCell);

    const kx = Math.max(1e-4, deck.grid.permXArray?.[idx] ?? deck.grid.permX);
    const ky = Math.max(1e-4, deck.grid.permYArray?.[idx] ?? deck.grid.permY);
    const kz = Math.max(1e-4, deck.grid.permZArray?.[idx] ?? deck.grid.permZ);

    cellTx[idx] = (cDarcy * kx * dy * dz) / Math.max(1e-3, dx);
    cellTy[idx] = (cDarcy * ky * dx * dz) / Math.max(1e-3, dy);
    cellTz[idx] = (cDarcy * kz * dx * dy) / Math.max(1e-3, dz);
  }

  // Build 3D TPFA internal face list with harmonic geometric transmissibility:
  // T_{i+1/2}^{geom} = 2 * T_i * T_{i+1} / (T_i + T_{i+1})
  const faceCellA: number[] = [];
  const faceCellB: number[] = [];
  const faceGeomT: number[] = [];

  const cellIndex = (i: number, j: number, k: number): number => i + j * nx + k * nx * ny;

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const cA = cellIndex(i, j, k);
        if (i + 1 < nx) {
          const cB = cellIndex(i + 1, j, k);
          const tA = cellTx[cA] ?? 0.0;
          const tB = cellTx[cB] ?? 0.0;
          faceCellA.push(cA);
          faceCellB.push(cB);
          faceGeomT.push((2.0 * tA * tB) / Math.max(1e-12, tA + tB));
        }
        if (j + 1 < ny) {
          const cB = cellIndex(i, j + 1, k);
          const tA = cellTy[cA] ?? 0.0;
          const tB = cellTy[cB] ?? 0.0;
          faceCellA.push(cA);
          faceCellB.push(cB);
          faceGeomT.push((2.0 * tA * tB) / Math.max(1e-12, tA + tB));
        }
        if (k + 1 < nz) {
          const cB = cellIndex(i, j, k + 1);
          const tA = cellTz[cA] ?? 0.0;
          const tB = cellTz[cB] ?? 0.0;
          faceCellA.push(cA);
          faceCellB.push(cB);
          faceGeomT.push((2.0 * tA * tB) / Math.max(1e-12, tA + tB));
        }
      }
    }
  }
  const nFaces = faceCellA.length;

  let cumOil = 0.0;
  let cumWater = 0.0;
  let cumGas = 0.0;

  // Well Setup: compute Peaceman well index WI if not explicitly specified, and map completions to 3D cells
  const wellList = Array.from(deck.wells.values());
  const wellCellIndices = new Map<string, { cellIdx: number; wi: number }[]>();

  for (const w of wellList) {
    const perfCells: { cellIdx: number; wi: number }[] = [];
    for (const c of w.completions) {
      if (c.wellIndex <= 0) {
        // Peaceman model: ro = 0.28 * sqrt(dx^2 + dy^2) / 2
        const ro = 0.28 * Math.sqrt(dx * dx + dy * dy) * 0.5;
        const rw = (c.diameter || 0.5) / 2.0;
        const kAvg = Math.sqrt(deck.grid.permX * deck.grid.permY);
        // WI = 2 * pi * k * h / ln(ro / rw) in Darcy units
        const factor = isField ? 0.00708 : 0.00852;
        c.wellIndex = (factor * kAvg * dz) / Math.log(Math.max(1.1, ro / rw));
      }
      if (c.status === "OPEN") {
        const ci = Math.max(0, Math.min(nx - 1, (c.i || w.i || 1) - 1));
        const cj = Math.max(0, Math.min(ny - 1, (c.j || w.j || 1) - 1));
        const kStart = Math.max(0, Math.min(nz - 1, (c.k1 || 1) - 1));
        const kEnd = Math.max(kStart, Math.min(nz - 1, (c.k2 || c.k1 || 1) - 1));
        const nLayers = kEnd - kStart + 1;
        const wiPerLayer = c.wellIndex / nLayers;
        for (let ck = kStart; ck <= kEnd; ck++) {
          perfCells.push({ cellIdx: cellIndex(ci, cj, ck), wi: wiPerLayer });
        }
      }
    }
    if (perfCells.length === 0) {
      const ci = Math.max(0, Math.min(nx - 1, (w.i || 1) - 1));
      const cj = Math.max(0, Math.min(ny - 1, (w.j || 1) - 1));
      const kAvg = Math.sqrt(deck.grid.permX * deck.grid.permY);
      const defaultWi = (isField ? 0.00708 : 0.00852) * kAvg * dz;
      perfCells.push({ cellIdx: cellIndex(ci, cj, 0), wi: defaultWi });
    }
    wellCellIndices.set(w.name, perfCells);
  }

  // 3. Time Stepping
  let timeSteps: number[] = [];
  if (options?.totalDays && options?.stepDays && options.stepDays > 0) {
    for (let d = options.stepDays; d <= options.totalDays; d += options.stepDays) {
      timeSteps.push(d);
    }
    const lastStep = timeSteps[timeSteps.length - 1];
    if (lastStep === undefined || lastStep < options.totalDays) {
      timeSteps.push(options.totalDays);
    }
  } else if (deck.timeSteps.length > 0) {
    timeSteps = deck.timeSteps;
  } else {
    timeSteps = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 365];
  }
  const trajectory: ReservoirStepRecord[] = [];

  let currentDay = 0;

  for (let sIdx = 0; sIdx < timeSteps.length; sIdx++) {
    const targetDay = timeSteps[sIdx] ?? currentDay;
    const dtDays = targetDay - currentDay;
    currentDay = targetDay;

    const nSub = Math.max(1, Math.ceil(dtDays / 2.0));
    const subDt = dtDays / nSub;

    let stepOil = 0.0;
    let stepWaterProd = 0.0;
    let stepGasProd = 0.0;

    let latestWellSamples: WellProductionSample[] = [];

    const bg = deck.props.pvdg?.[0]?.fvf ?? (isField ? 0.001 : 0.005);

    for (let sub = 0; sub < nSub; sub++) {
      // Interpolate fluid properties at current average pressure
      const { bo, muO } = interpolatePvdo(deck.props.pvdo, pres);
      const bw = deck.props.pvtw?.bw ?? 1.02;
      const muW = deck.props.pvtw?.muw ?? 0.5; // cP

      // Current average water saturation in reservoir at the producer drainage zone
      const recoveryFrac = stoiip > 0 ? (cumOil + stepOil) / stoiip : 0.0;
      const displaceableMobileFraction = Math.max(0.1, 1.0 - swc - 0.2);
      const avgSw = Math.min(maxSw, swc + (maxSw - swc) * Math.min(1.0, recoveryFrac / displaceableMobileFraction));
      const { krw, kro } = interpolateSwof(deck.props.swof, avgSw);

      // Water fractional flow: fw = (krw / muW) / (krw / muW + kro / muO)
      const mobW = krw / Math.max(1e-4, muW);
      const mobO = kro / Math.max(1e-4, muO);
      const waterCut = mobW + mobO > 0 ? mobW / (mobW + mobO) : 0.0;

      let subOil = 0.0;
      let subWaterProd = 0.0;
      let subGasProd = 0.0;
      let subWaterInj = 0.0;
      let subGasInj = 0.0;

      const subWellSamples: WellProductionSample[] = [];
      const cellWellResSource = new Float64Array(totalCells); // net reservoir volume source (rb/d or rm3/d)
      const cellWaterSource = new Float64Array(totalCells); // net surface water source (stb/d or sm3/d)

      // Calculate rates from each producer and injector well
      for (const w of wellList) {
        const perfs = wellCellIndices.get(w.name) ?? [];
        const totalWi = perfs.reduce((acc, p) => acc + p.wi, 0);

        if (w.productionControl && w.productionControl.status === "OPEN") {
          const pc = w.productionControl;
          const bhpLimit = pc.bhpLimit;

          // Average local perforation pressure blended with reservoir pressure
          const avgPerfP =
            perfs.length > 0
              ? 0.5 * pres + 0.5 * (perfs.reduce((acc, p) => acc + (cellP[p.cellIdx] ?? 0), 0) / perfs.length)
              : pres;
          const dP = Math.max(0, avgPerfP - bhpLimit);

          // Inflow rate via Peaceman equation: q_oil = WI * (kro / (muO * bo)) * (P_res - P_bhp)
          const wellMobility = kro / Math.max(0.1, muO * bo);
          const maxRate = totalWi * dP * wellMobility;
          const qOil = Math.min(pc.oilRate > 0 ? pc.oilRate : maxRate, maxRate);
          const actualBhp =
            pc.oilRate > 0 && qOil < maxRate && totalWi * wellMobility > 0
              ? avgPerfP - qOil / (totalWi * wellMobility)
              : bhpLimit;

          // Also incorporate local perforation water cut if waterflood front has reached producer cell
          const avgPerfSw =
            perfs.length > 0 ? perfs.reduce((acc, p) => acc + (cellSw[p.cellIdx] ?? 0), 0) / perfs.length : avgSw;
          const perfRelPerm = interpolateSwof(deck.props.swof, Math.max(avgSw, avgPerfSw));
          const perfMobW = perfRelPerm.krw / Math.max(1e-4, muW);
          const perfMobO = perfRelPerm.kro / Math.max(1e-4, muO);
          const effWaterCut = perfMobW + perfMobO > 0 ? Math.max(waterCut, perfMobW / (perfMobW + perfMobO)) : waterCut;

          const qWater = effWaterCut > 0.001 ? (qOil * effWaterCut) / Math.max(1e-4, 1.0 - effWaterCut) : 0.0;
          // Dissolved solution gas-oil ratio Rs(P) scales with reservoir pressure
          const pRatio = Math.max(0.1, Math.min(1.5, pres / initPres));
          const baseGor = isField ? 500.0 : 90.0;
          const solutionGor = baseGor * Math.pow(pRatio, 0.8);
          const producingGor =
            pres < 0.85 * initPres ? solutionGor * (1.0 + 1.2 * (0.85 - pres / initPres)) : solutionGor;
          const qGas = isField ? (qOil * producingGor) / 1000.0 : qOil * producingGor;

          subOil += qOil * subDt;
          subWaterProd += qWater * subDt;
          subGasProd += qGas * subDt;

          // Distribute sink across perforated 3D cells
          const qResTotalRate = bo * qOil + bw * qWater + bg * qGas;
          for (const perf of perfs) {
            const wFrac = totalWi > 0 ? perf.wi / totalWi : 1.0 / perfs.length;
            cellWellResSource[perf.cellIdx] = (cellWellResSource[perf.cellIdx] ?? 0) - qResTotalRate * wFrac;
            cellWaterSource[perf.cellIdx] = (cellWaterSource[perf.cellIdx] ?? 0) - qWater * wFrac;
          }

          subWellSamples.push({
            wellName: w.name,
            oilRate: qOil,
            waterRate: qWater,
            gasRate: qGas,
            waterCut: effWaterCut,
            bhp: actualBhp,
          });
        } else if (w.injectionControl && w.injectionControl.status === "OPEN") {
          const ic = w.injectionControl;
          const qInj = ic.rate;
          if (ic.fluidType === "WATER") {
            subWaterInj += qInj * subDt;
            for (const perf of perfs) {
              const wFrac = totalWi > 0 ? perf.wi / totalWi : 1.0 / perfs.length;
              cellWellResSource[perf.cellIdx] = (cellWellResSource[perf.cellIdx] ?? 0) + bw * qInj * wFrac;
              cellWaterSource[perf.cellIdx] = (cellWaterSource[perf.cellIdx] ?? 0) + qInj * wFrac;
            }
          } else {
            subGasInj += qInj * subDt;
            for (const perf of perfs) {
              const wFrac = totalWi > 0 ? perf.wi / totalWi : 1.0 / perfs.length;
              cellWellResSource[perf.cellIdx] = (cellWellResSource[perf.cellIdx] ?? 0) + bg * qInj * wFrac;
            }
          }
          subWellSamples.push({
            wellName: w.name,
            oilRate: 0.0,
            waterRate: ic.fluidType === "WATER" ? -qInj : 0.0,
            gasRate: ic.fluidType === "GAS" ? -qInj : 0.0,
            waterCut: 0.0,
            bhp: ic.bhpLimit,
          });
        }
      }

      stepOil += subOil;
      stepWaterProd += subWaterProd;
      stepGasProd += subGasProd;
      latestWellSamples = subWellSamples;

      // Global Material Balance: net reservoir voidage = produced volume - injected volume
      const vProdRes = bo * subOil + bw * subWaterProd + bg * subGasProd;
      const vInjRes = bw * subWaterInj + bg * subGasInj;
      const netDeltaVp = vProdRes - vInjRes;
      const deltaP = netDeltaVp / (vPore * ct);
      pres = Math.max(100.0, pres - deltaP);

      // 3D Two-Point Flux Approximation (TPFA) IMPES Pressure & Saturation Solve
      if (totalCells > 0 && nFaces > 0) {
        // Compute phase and total transmissibilities on each internal face using upstream mobility weighting:
        // T_{p, i+1/2} = (2 * T_i * T_{i+1} / (T_i + T_{i+1})) * (k_{rp} / (mu_p * B_p))
        const faceTotalT = new Float64Array(nFaces);
        const faceWaterT = new Float64Array(nFaces);

        for (let f = 0; f < nFaces; f++) {
          const cA = faceCellA[f] ?? 0;
          const cB = faceCellB[f] ?? 0;
          const geomT = faceGeomT[f] ?? 0.0;
          const upCell = (cellP[cA] ?? 0.0) >= (cellP[cB] ?? 0.0) ? cA : cB;
          const swUp = cellSw[upCell] ?? 0.0;
          const pUp = cellP[upCell] ?? 0.0;

          const pvtUp = interpolatePvdo(deck.props.pvdo, pUp);
          const relUp = interpolateSwof(deck.props.swof, swUp);

          const tOil = geomT * (relUp.kro / Math.max(1e-4, pvtUp.muO * pvtUp.bo));
          const tWat = geomT * (relUp.krw / Math.max(1e-4, muW * bw));

          faceWaterT[f] = tWat;
          // Reservoir volume transmissibility = B_o * T_oil + B_w * T_wat
          faceTotalT[f] = pvtUp.bo * tOil + bw * tWat;
        }

        // Solve implicit TPFA pressure system:
        // (Vp_i * ct / subDt) * (P_i^{n+1} - P_i^n) + sum_{j} T_{t,ij} (P_i^{n+1} - P_j^{n+1}) = q_{res,i}
        const diag = new Float64Array(totalCells);
        const rhs = new Float64Array(totalCells);
        for (let i = 0; i < totalCells; i++) {
          const accum = ((cellVp[i] ?? 0.0) * ct) / Math.max(1e-4, subDt);
          diag[i] = accum;
          rhs[i] = accum * (cellP[i] ?? 0.0) + (cellWellResSource[i] ?? 0.0);
        }
        for (let f = 0; f < nFaces; f++) {
          const cA = faceCellA[f] ?? 0;
          const cB = faceCellB[f] ?? 0;
          const tTot = faceTotalT[f] ?? 0.0;
          diag[cA] = (diag[cA] ?? 0) + tTot;
          diag[cB] = (diag[cB] ?? 0) + tTot;
        }

        // Gauss-Seidel / SOR iterations for 3D elliptic pressure field
        const nIter = 12;
        for (let iter = 0; iter < nIter; iter++) {
          const offDiagSum = new Float64Array(totalCells);
          for (let f = 0; f < nFaces; f++) {
            const cA = faceCellA[f] ?? 0;
            const cB = faceCellB[f] ?? 0;
            const tTot = faceTotalT[f] ?? 0.0;
            offDiagSum[cA] = (offDiagSum[cA] ?? 0) + tTot * (cellP[cB] ?? 0.0);
            offDiagSum[cB] = (offDiagSum[cB] ?? 0) + tTot * (cellP[cA] ?? 0.0);
          }
          for (let i = 0; i < totalCells; i++) {
            const pNew = ((rhs[i] ?? 0.0) + (offDiagSum[i] ?? 0.0)) / Math.max(1e-9, diag[i] ?? 0.0);
            cellP[i] = Math.max(100.0, 0.25 * (cellP[i] ?? 0.0) + 0.75 * pNew);
          }
        }

        // Anchor spatial average to global material balance pressure `pres` while preserving TPFA spatial gradients
        let sumCellP = 0.0;
        for (let i = 0; i < totalCells; i++) {
          sumCellP += cellP[i] ?? 0.0;
        }
        const meanCellP = sumCellP / totalCells;
        const shiftP = pres - meanCellP;
        for (let i = 0; i < totalCells; i++) {
          cellP[i] = Math.max(100.0, (cellP[i] ?? 0.0) + shiftP);
        }

        // Explicit upwind water saturation update (IMPES):
        // (Vp_i / B_w) * (Sw_i^{n+1} - Sw_i^n) / subDt = sum_{j} T_{w,ij} (P_j^{n+1} - P_i^{n+1}) + q_{w,i}
        const netWaterFlux = new Float64Array(totalCells);
        for (let f = 0; f < nFaces; f++) {
          const cA = faceCellA[f] ?? 0;
          const cB = faceCellB[f] ?? 0;
          const qWatAB = (faceWaterT[f] ?? 0.0) * ((cellP[cA] ?? 0.0) - (cellP[cB] ?? 0.0)); // positive from A to B
          netWaterFlux[cA] = (netWaterFlux[cA] ?? 0) - qWatAB;
          netWaterFlux[cB] = (netWaterFlux[cB] ?? 0) + qWatAB;
        }

        for (let i = 0; i < totalCells; i++) {
          const vpCell = cellVp[i] ?? vPoreCellDefault;
          const dSw = (((netWaterFlux[i] ?? 0.0) + (cellWaterSource[i] ?? 0.0)) * bw * subDt) / Math.max(1e-3, vpCell);
          cellSw[i] = Math.max(swc, Math.min(maxSw, (cellSw[i] ?? 0.0) + dSw));
        }
      }
    }

    cumOil += stepOil;
    cumWater += stepWaterProd;
    cumGas += stepGasProd;

    const overallWc = cumOil + cumWater > 0 ? cumWater / (cumOil + cumWater) : 0.0;

    trajectory.push({
      timeDays: currentDay,
      averagePressure: pres,
      cumulativeOil: cumOil,
      cumulativeWater: cumWater,
      cumulativeGas: cumGas,
      waterCut: overallWc,
      wells: latestWellSamples,
      cellPressures: Array.from(cellP),
      cellWaterSaturations: Array.from(cellSw),
    });
  }

  const recoveryFactor = stoiip > 0 ? cumOil / stoiip : 0.0;

  return {
    title: deck.title,
    units: deck.units,
    poreVolume: vPore,
    stoiip,
    giip,
    initialPressure: initPres,
    finalPressure: pres,
    recoveryFactor,
    cumulativeOilProduced: cumOil,
    stepsCount: trajectory.length,
    trajectory,
    cellPressures: Array.from(cellP),
    cellWaterSaturations: Array.from(cellSw),
  };
}
