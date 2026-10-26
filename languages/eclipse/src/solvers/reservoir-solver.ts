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
}

function interpolatePvdo(
  pvdo: { pressure: number; fvf: number; viscosity?: number | undefined }[],
  p: number,
): { bo: number; muO: number } {
  if (!pvdo || pvdo.length === 0) return { bo: 1.25, muO: 1.0 };
  if (p <= pvdo[0]!.pressure) return { bo: pvdo[0]!.fvf, muO: pvdo[0]!.viscosity ?? 1.0 };
  for (let i = 0; i < pvdo.length - 1; i++) {
    const p1 = pvdo[i]!;
    const p2 = pvdo[i + 1]!;
    if (p >= p1.pressure && p <= p2.pressure) {
      const frac = (p - p1.pressure) / (p2.pressure - p1.pressure || 1e-6);
      const bo = p1.fvf + frac * (p2.fvf - p1.fvf);
      const mu1 = p1.viscosity ?? 1.0;
      const mu2 = p2.viscosity ?? 1.0;
      const muO = mu1 + frac * (mu2 - mu1);
      return { bo, muO };
    }
  }
  const last = pvdo[pvdo.length - 1]!;
  return { bo: last.fvf, muO: last.viscosity ?? 1.0 };
}

function interpolateSwof(
  swof: { saturation: number; krPhase: number; krowPhase: number }[],
  sw: number,
): { krw: number; kro: number } {
  if (!swof || swof.length === 0) {
    const swNorm = Math.max(0, Math.min(1, sw));
    return { krw: Math.pow(swNorm, 2), kro: Math.pow(1 - swNorm, 2) };
  }
  if (sw <= swof[0]!.saturation) return { krw: swof[0]!.krPhase, kro: swof[0]!.krowPhase };
  for (let i = 0; i < swof.length - 1; i++) {
    const pt1 = swof[i]!;
    const pt2 = swof[i + 1]!;
    if (sw >= pt1.saturation && sw <= pt2.saturation) {
      const frac = (sw - pt1.saturation) / (pt2.saturation - pt1.saturation || 1e-6);
      return {
        krw: pt1.krPhase + frac * (pt2.krPhase - pt1.krPhase),
        kro: pt1.krowPhase + frac * (pt2.krowPhase - pt1.krowPhase),
      };
    }
  }
  const last = swof[swof.length - 1]!;
  return { krw: last.krPhase, kro: last.krowPhase };
}

export function solveReservoirDepletion(
  deck: EclipseDeck,
  options?: ReservoirSolverOptions,
): ReservoirSimulationResult {
  const isField = deck.units === "FIELD";
  const bblPerFt3 = 1.0 / 5.614583;

  // 1. Volumetric calculations
  const nx = deck.dimensions.nx;
  const ny = deck.dimensions.ny;
  const nz = deck.dimensions.nz;
  const totalCells = nx * ny * nz;

  const dx = deck.grid.dx;
  const dy = deck.grid.dy;
  const dz = deck.grid.dz;
  const vBulkCell = dx * dy * dz;
  const vBulkTotal = vBulkCell * totalCells;

  const phi = deck.grid.poro;
  const vPoreTotal = vBulkTotal * phi;
  const vPore = isField ? vPoreTotal * bblPerFt3 : vPoreTotal; // bbl or m^3

  const swc = deck.solution.initialSwat ?? deck.props.swof[0]?.saturation ?? 0.2;
  const boi = deck.props.pvdo[0]?.fvf ?? 1.25; // rb/stb or rm3/sm3
  const bgi = deck.props.pvdg[0]?.fvf ?? 0.001; // rb/scf or rm3/sm3

  // STOIIP = Vp * (1 - Swc) / Boi
  const stoiip = (vPore * (1.0 - swc)) / boi;

  // GIIP = Vp * Sg / Bgi
  const sgi = Math.max(0, 1.0 - swc - 0.7); // initial free gas if any
  const giip = isField ? (vPore * sgi) / (bgi * 1000.0) : (vPore * sgi) / bgi;

  // 2. Initial Reservoir State
  let pres = deck.solution.initialPressure ?? 4000.0; // psi or bar
  const initPres = pres;
  const ct = options?.totalCompressibility ?? (isField ? 1.2e-5 : 1.7e-4);

  let cumOil = 0.0;
  let cumWater = 0.0;
  let cumGas = 0.0;

  // Well Setup: compute Peaceman well index WI if not explicitly specified
  const wellList = Array.from(deck.wells.values());
  for (const w of wellList) {
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
    }
  }

  // 3. Time Stepping
  let timeSteps: number[] = [];
  if (options?.totalDays && options?.stepDays && options.stepDays > 0) {
    for (let d = options.stepDays; d <= options.totalDays; d += options.stepDays) {
      timeSteps.push(d);
    }
    if (timeSteps.length === 0 || timeSteps[timeSteps.length - 1]! < options.totalDays) {
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
    const targetDay = timeSteps[sIdx]!;
    const dtDays = targetDay - currentDay;
    currentDay = targetDay;

    let stepOil = 0.0;
    let stepWater = 0.0;
    let stepGas = 0.0;

    const wellSamples: WellProductionSample[] = [];

    // Interpolate fluid properties at current average pressure
    const { bo, muO } = interpolatePvdo(deck.props.pvdo, pres);
    const bw = deck.props.pvtw?.bw ?? 1.02;
    const muW = deck.props.pvtw?.muw ?? 0.5; // cP

    // Current average water saturation in reservoir at the producer drainage zone
    // Advances with cumulative oil recovery and Buckley-Leverett waterflood displacement
    const recoveryFrac = stoiip > 0 ? cumOil / stoiip : 0.0;
    const maxSw = deck.props.swof.length > 0 ? deck.props.swof[deck.props.swof.length - 1]!.saturation : 0.8;
    const displaceableMobileFraction = Math.max(0.1, 1.0 - swc - 0.2);
    const avgSw = Math.min(maxSw, swc + (maxSw - swc) * Math.min(1.0, recoveryFrac / displaceableMobileFraction));
    const { krw, kro } = interpolateSwof(deck.props.swof, avgSw);

    // Water fractional flow: fw = (krw / muW) / (krw / muW + kro / muO)
    const mobW = krw / Math.max(1e-4, muW);
    const mobO = kro / Math.max(1e-4, muO);
    const waterCut = mobW + mobO > 0 ? mobW / (mobW + mobO) : 0.0;

    // Calculate rates from each producer well
    for (const w of wellList) {
      if (w.productionControl && w.productionControl.status === "OPEN") {
        const pc = w.productionControl;
        const bhp = pc.bhpLimit;
        const dP = Math.max(0, pres - bhp);

        let totalWi = 0.0;
        for (const c of w.completions) {
          if (c.status === "OPEN") totalWi += c.wellIndex;
        }
        if (totalWi === 0.0) {
          const kAvg = Math.sqrt(deck.grid.permX * deck.grid.permY);
          totalWi = (isField ? 0.00708 : 0.00852) * kAvg * dz;
        }

        // Inflow rate via Peaceman equation: q_oil = WI * (kro / (muO * bo)) * (P_res - P_bhp)
        const wellMobility = kro / Math.max(0.1, muO * bo);
        const maxRate = totalWi * dP * wellMobility;
        const qOil = Math.min(pc.oilRate > 0 ? pc.oilRate : maxRate, maxRate);

        const qWater = waterCut > 0.001 ? (qOil * waterCut) / Math.max(1e-4, 1.0 - waterCut) : 0.0;
        // Dissolved solution gas-oil ratio Rs(P) scales with reservoir pressure
        const pRatio = Math.max(0.1, Math.min(1.5, pres / initPres));
        const baseGor = isField ? 500.0 : 90.0;
        const solutionGor = baseGor * Math.pow(pRatio, 0.8);
        const producingGor =
          pres < 0.85 * initPres ? solutionGor * (1.0 + 1.2 * (0.85 - pres / initPres)) : solutionGor;
        const qGas = isField ? (qOil * producingGor) / 1000.0 : qOil * producingGor;

        stepOil += qOil * dtDays;
        stepWater += qWater * dtDays;
        stepGas += qGas * dtDays;

        wellSamples.push({
          wellName: w.name,
          oilRate: qOil,
          waterRate: qWater,
          gasRate: qGas,
          waterCut,
          bhp,
        });
      } else if (w.injectionControl && w.injectionControl.status === "OPEN") {
        const ic = w.injectionControl;
        const qInj = ic.rate;
        if (ic.fluidType === "WATER") {
          stepWater -= qInj * dtDays;
        } else {
          stepGas -= qInj * dtDays;
        }
        wellSamples.push({
          wellName: w.name,
          oilRate: 0.0,
          waterRate: ic.fluidType === "WATER" ? -qInj : 0.0,
          gasRate: ic.fluidType === "GAS" ? -qInj : 0.0,
          waterCut: 0.0,
          bhp: ic.bhpLimit,
        });
      }
    }

    // Material balance pressure drop with waterflood sweep efficiency (eta_sweep ~ 0.75)
    // Local drainage area depletes even with pattern injection:
    const netDeltaVp = Math.max(0.15 * bo * stepOil, bo * stepOil + bw * stepWater * 0.75);
    const deltaP = netDeltaVp / (vPore * ct);
    pres = Math.max(100.0, pres - deltaP);

    cumOil += stepOil;
    cumWater += stepWater;
    cumGas += stepGas;

    const overallWc = cumOil + cumWater > 0 ? cumWater / (cumOil + cumWater) : 0.0;

    trajectory.push({
      timeDays: currentDay,
      averagePressure: pres,
      cumulativeOil: cumOil,
      cumulativeWater: cumWater,
      cumulativeGas: cumGas,
      waterCut: overallWc,
      wells: wellSamples,
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
  };
}
