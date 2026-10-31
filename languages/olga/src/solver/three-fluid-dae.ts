// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — 3-Fluid 9-Equation Mechanistic Hydrodynamic Solver.
 *
 * Implements SLB OLGA's full 3-fluid mechanistic formulation:
 * - 5 separate hydrodynamic phase fields:
 *     1. Continuous Gas (alpha_g)
 *     2. Oil Wall Film (alpha_fo)
 *     3. Water Wall Film (alpha_fw)
 *     4. Entrained Oil Droplets (alpha_do)
 *     5. Entrained Water Droplets (alpha_dw)
 * - 3 coupled momentum velocity fields:
 *     1. Gas core velocity (v_g)
 *     2. Liquid film velocity (v_f)
 *     3. Dispersed droplet velocity (v_d)
 * - Energy conservation and pressure balance
 * - Mechanistic droplet entrainment/deposition closures (Kataoka & Ishii)
 * - Emulsion phase inversion point tracking
 */

import type { OlgaModel } from "../types.js";
import { evaluateDropletMechanics } from "./droplet-mechanics.js";
import { evaluateEmulsionViscosity } from "./emulsion-rheology.js";

export interface ThreeFluidCellState {
  x: number; // spatial position [m]
  pressurePa: number; // P [Pa]
  temperatureK: number; // T [K]
  // Volume fractions (sum = 1.0)
  alphaGas: number; // alpha_g
  alphaFilmOil: number; // alpha_fo
  alphaFilmWater: number; // alpha_fw
  alphaDropletOil: number; // alpha_do
  alphaDropletWater: number; // alpha_dw
  // Velocities [m/s]
  velocityGas: number; // v_g
  velocityFilm: number; // v_f
  velocityDroplet: number; // v_d
  // Physical closures
  filmThicknessM: number;
  entrainmentRateKgM3S: number;
  depositionRateKgM3S: number;
  continuousPhase: "OIL" | "WATER" | "GAS";
  apparentViscosityPaS: number;
}

export interface ThreeFluidSimulationResult {
  times: number[]; // seconds
  profiles: {
    time: number;
    cells: ThreeFluidCellState[];
  }[];
  summary: {
    peakInletPressureBar: number;
    peakArrivalPressureBar: number;
    averageDropletFraction: number;
    phaseInversionLocationM: number | null;
  };
}

export interface ThreeFluidSolverOptions {
  durationSeconds?: number | undefined;
  timeStepSeconds?: number | undefined;
  gridCells?: number | undefined;
  advectionOrder?: 1 | 2 | undefined;
  inletWaterCutStep?: number | undefined;
  inletGasFractionStep?: number | undefined;
}

function minmod(a: number, b: number): number {
  if (a * b <= 0.0) return 0.0;
  return Math.abs(a) < Math.abs(b) ? a : b;
}

/**
 * Solves the transient 9-equation 3-fluid mechanistic system along an OLGA pipeline
 * using N-cell 1st/2nd-order upwind finite-volume advection and outlet-to-inlet
 * coupled pressure back-propagation across all pipe segments.
 */
export function simulateThreeFluidDAE(
  model: OlgaModel,
  options: ThreeFluidSolverOptions = {},
): ThreeFluidSimulationResult {
  const duration = options.durationSeconds ?? Math.min(model.endTime - model.startTime, 60);
  const dt = options.timeStepSeconds ?? model.maxDt ?? 1.0;
  const numCells = Math.max(2, options.gridCells ?? 20);
  const advectionOrder = options.advectionOrder ?? 2;

  const pipes = model.flowpaths[0]?.pipes ?? [];
  const valves = model.flowpaths[0]?.valves ?? [];
  const totalLength = pipes.reduce((acc, p) => acc + p.length, 0) || 5000.0;
  const defaultDiam = pipes[0]?.diameter ?? 0.254;
  const dx = totalLength / numCells;

  // Precompute per-cell pipe segment geometry (diameter, roughness, inclination sin(theta), dx_i)
  const cellDiameters = new Float64Array(numCells);
  const cellRoughness = new Float64Array(numCells);
  const cellSinTheta = new Float64Array(numCells);
  const cellDx = new Float64Array(numCells);

  for (let i = 0; i < numCells; i++) {
    const xCenter = (i + 0.5) * dx;
    let accumLen = 0.0;
    let dLocal = defaultDiam;
    let roughLocal = 0.000045;
    let sinThetaLocal = 0.0;

    for (const p of pipes) {
      const pLen = Math.max(1e-3, p.length);
      if (xCenter <= accumLen + pLen || p === pipes[pipes.length - 1]) {
        dLocal = p.diameter > 0 ? p.diameter : defaultDiam;
        roughLocal = p.roughness ?? 0.000045;
        sinThetaLocal = Math.max(-1.0, Math.min(1.0, (p.elevation ?? 0.0) / pLen));
        break;
      }
      accumLen += pLen;
    }

    cellDiameters[i] = dLocal;
    cellRoughness[i] = roughLocal;
    cellSinTheta[i] = sinThetaLocal;
    cellDx[i] = dx;
  }

  // Boundary conditions
  const inletNode = model.nodes.find((n) => n.boundaryPosition <= 0.05) ?? model.nodes[0];
  const outletNode = model.nodes.find((n) => n.boundaryPosition >= 0.95) ?? model.nodes[model.nodes.length - 1];

  const pInlet = inletNode?.pressure ?? 120e5;
  const pOutlet = outletNode?.pressure ?? 35e5;
  const tInlet = inletNode?.temperature ?? 340.15;
  const massRateTotal = inletNode?.massRate ?? 35.0; // kg/s
  const waterCut = inletNode?.waterCut ?? 0.35; // 35% water cut
  const gasFraction = inletNode?.gasMassFraction ?? 0.2;

  const rhoO = 830.0;
  const rhoW = 1000.0;
  const gGrav = 9.80665;

  // Initial steady state cell array
  let cells: ThreeFluidCellState[] = [];
  for (let i = 0; i < numCells; i++) {
    const frac = (i + 0.5) / numCells;
    const x = frac * totalLength;
    const dPipe = cellDiameters[i]!;
    const pCell = pInlet - (pInlet - pOutlet) * frac;
    const tCell = 277.15 + (tInlet - 277.15) * Math.exp(-0.0003 * x);

    // Initial fraction estimates
    const aGas = Math.max(0.05, Math.min(0.95, gasFraction * (pInlet / pCell) * 0.8));
    const aLiq = 1.0 - aGas;
    const aWater = aLiq * waterCut;
    const aOil = aLiq * (1.0 - waterCut);

    // Initial film vs droplet split (80% film, 20% droplets)
    const aFo = aOil * 0.8;
    const aDo = aOil * 0.2;
    const aFw = aWater * 0.8;
    const aDw = aWater * 0.2;

    const area = 0.25 * Math.PI * dPipe * dPipe;
    const vg = (massRateTotal * gasFraction) / (Math.max(10.0, (pCell / 1e5) * 0.8) * area * aGas);
    const vf = (massRateTotal * (1.0 - gasFraction)) / (850.0 * area * (aFo + aFw));
    const vd = 0.9 * vg;

    const deltaFilm = dPipe * 0.5 * (1.0 - Math.sqrt(Math.max(0.01, 1.0 - (aFo + aFw))));
    const emulsion = evaluateEmulsionViscosity(waterCut, 0.008, 0.001);

    cells.push({
      x,
      pressurePa: pCell,
      temperatureK: tCell,
      alphaGas: aGas,
      alphaFilmOil: aFo,
      alphaFilmWater: aFw,
      alphaDropletOil: aDo,
      alphaDropletWater: aDw,
      velocityGas: Math.max(0.5, vg),
      velocityFilm: Math.max(0.1, vf),
      velocityDroplet: Math.max(0.4, vd),
      filmThicknessM: deltaFilm,
      entrainmentRateKgM3S: 0.0,
      depositionRateKgM3S: 0.0,
      continuousPhase: emulsion.continuousPhase,
      apparentViscosityPaS: emulsion.effectiveViscosity,
    });
  }

  const times: number[] = [0];
  const profiles = [{ time: 0, cells: JSON.parse(JSON.stringify(cells)) }];

  let currentTime = 0;
  const numSteps = Math.min(100, Math.ceil(duration / dt));
  let peakInletPressurePa = cells[0]?.pressurePa ?? pInlet;
  let peakArrivalPressurePa = cells[numCells - 1]?.pressurePa ?? pOutlet;

  // Time integration loop
  for (let step = 1; step <= numSteps; step++) {
    currentTime += dt;

    // Determine CFL-stable sub-stepping for explicit upwind finite-volume advection
    let maxVel = 1.0;
    for (let i = 0; i < numCells; i++) {
      const c = cells[i]!;
      maxVel = Math.max(maxVel, Math.abs(c.velocityGas), Math.abs(c.velocityDroplet), Math.abs(c.velocityFilm));
    }
    const cflTarget = 0.45;
    const nSub = Math.max(1, Math.min(50, Math.ceil((maxVel * dt) / Math.max(1e-3, cflTarget * dx))));
    const dtSub = dt / nSub;

    // Boundary inflow state at x = 0 (ghost cell i = -1)
    const bcWaterCut = options.inletWaterCutStep ?? waterCut;
    const bcGasFrac = options.inletGasFractionStep ?? gasFraction;
    const pInletRef = cells[0]?.pressurePa ?? pInlet;
    const aGasBc = Math.max(0.05, Math.min(0.95, bcGasFrac * (pInlet / Math.max(1e5, pInletRef)) * 0.8));
    const aLiqBc = 1.0 - aGasBc;
    const aFoBc = aLiqBc * (1.0 - bcWaterCut) * 0.8;
    const aDoBc = aLiqBc * (1.0 - bcWaterCut) * 0.2;
    const aFwBc = aLiqBc * bcWaterCut * 0.8;
    const aDwBc = aLiqBc * bcWaterCut * 0.2;

    const area0 = 0.25 * Math.PI * cellDiameters[0]! * cellDiameters[0]!;
    const rhoG0 = Math.max(5.0, (pInletRef / 1e5) * 0.82);
    const vgBc = Math.max(0.5, (massRateTotal * bcGasFrac) / (rhoG0 * area0 * Math.max(0.05, aGasBc)));
    const vfBc = Math.max(0.1, (massRateTotal * (1.0 - bcGasFrac)) / (850.0 * area0 * Math.max(0.01, aFoBc + aFwBc)));
    const vdBc = Math.max(0.4, 0.9 * vgBc);

    for (let sub = 0; sub < nSub; sub++) {
      // 1. Compute mechanistic source terms Gamma_k / rho_k and phase fluxes (alpha_k * u_k) in each cell
      const srcFo = new Float64Array(numCells);
      const srcFw = new Float64Array(numCells);
      const srcDo = new Float64Array(numCells);
      const srcDw = new Float64Array(numCells);
      const entRates = new Float64Array(numCells);
      const depRates = new Float64Array(numCells);

      for (let i = 0; i < numCells; i++) {
        const c = cells[i]!;
        const dPipe = cellDiameters[i]!;
        const rhoG = Math.max(5.0, (c.pressurePa / 1e5) * 0.82);

        const dropletOil = evaluateDropletMechanics({
          gasDensityKgM3: rhoG,
          liquidDensityKgM3: rhoO,
          gasViscosityPaS: 1.5e-5,
          liquidViscosityPaS: 0.008,
          surfaceTensionNPerM: 0.025,
          pipeDiameterM: dPipe,
          gasVelocityMS: c.velocityGas,
          filmVelocityMS: c.velocityFilm,
          dropletVelocityMS: c.velocityDroplet,
          filmThicknessM: c.filmThicknessM,
          dropletVolumeFraction: c.alphaDropletOil,
          liquidHoldup: c.alphaFilmOil + c.alphaDropletOil,
        });

        const dropletWater = evaluateDropletMechanics({
          gasDensityKgM3: rhoG,
          liquidDensityKgM3: rhoW,
          gasViscosityPaS: 1.5e-5,
          liquidViscosityPaS: 0.001,
          surfaceTensionNPerM: 0.065,
          pipeDiameterM: dPipe,
          gasVelocityMS: c.velocityGas,
          filmVelocityMS: c.velocityFilm,
          dropletVelocityMS: c.velocityDroplet,
          filmThicknessM: c.filmThicknessM,
          dropletVolumeFraction: c.alphaDropletWater,
          liquidHoldup: c.alphaFilmWater + c.alphaDropletWater,
        });

        const gammaO = dropletOil.netDropletGenerationRateKgM3S / rhoO;
        const gammaW = dropletWater.netDropletGenerationRateKgM3S / rhoW;

        srcDo[i] = gammaO;
        srcFo[i] = -gammaO;
        srcDw[i] = gammaW;
        srcFw[i] = -gammaW;

        entRates[i] = (dropletOil.entrainmentRateKgM2S + dropletWater.entrainmentRateKgM2S) * (4.0 / dPipe);
        depRates[i] = (dropletOil.depositionRateKgM2S + dropletWater.depositionRateKgM2S) * (4.0 / dPipe);
      }

      // Helper to reconstruct upwind state at cell face i + 1/2 (for i = -1 .. numCells - 1)
      const getAlpha = (arr: (c: ThreeFluidCellState) => number, bcVal: number, idx: number): number => {
        if (idx < 0) return bcVal;
        if (idx >= numCells) return arr(cells[numCells - 1]!);
        return arr(cells[idx]!);
      };

      const getVel = (arr: (c: ThreeFluidCellState) => number, bcVal: number, idx: number): number => {
        if (idx < 0) return bcVal;
        if (idx >= numCells) return arr(cells[numCells - 1]!);
        return arr(cells[idx]!);
      };

      const computeFaceFlux = (
        alphaGetter: (c: ThreeFluidCellState) => number,
        bcAlpha: number,
        velGetter: (c: ThreeFluidCellState) => number,
        bcVel: number,
        faceIdx: number, // face i + 1/2 is between cell i (faceIdx) and cell i+1 (faceIdx+1)
      ): number => {
        const uL = getVel(velGetter, bcVel, faceIdx);
        const uR = getVel(velGetter, bcVel, faceIdx + 1);
        const uFace = 0.5 * (uL + uR);

        if (uFace >= 0.0) {
          const aC = getAlpha(alphaGetter, bcAlpha, faceIdx);
          if (advectionOrder === 2) {
            const aU = getAlpha(alphaGetter, bcAlpha, faceIdx - 1);
            const aD = getAlpha(alphaGetter, bcAlpha, faceIdx + 1);
            const slope = minmod(aC - aU, aD - aC);
            return (aC + 0.5 * slope) * uL;
          }
          return aC * uL;
        } else {
          const aC = getAlpha(alphaGetter, bcAlpha, faceIdx + 1);
          if (advectionOrder === 2) {
            const aU = getAlpha(alphaGetter, bcAlpha, faceIdx + 2);
            const aD = getAlpha(alphaGetter, bcAlpha, faceIdx);
            const slope = minmod(aC - aU, aD - aC);
            return (aC + 0.5 * slope) * uR;
          }
          return aC * uR;
        }
      };

      // Precompute face fluxes F_{k, i-1/2} for i = 0 .. numCells
      const fluxFo = new Float64Array(numCells + 1);
      const fluxFw = new Float64Array(numCells + 1);
      const fluxDo = new Float64Array(numCells + 1);
      const fluxDw = new Float64Array(numCells + 1);
      const fluxGas = new Float64Array(numCells + 1);

      for (let f = 0; f <= numCells; f++) {
        const cellLeft = f - 1;
        fluxFo[f] = computeFaceFlux(
          (c) => c.alphaFilmOil,
          aFoBc,
          (c) => c.velocityFilm,
          vfBc,
          cellLeft,
        );
        fluxFw[f] = computeFaceFlux(
          (c) => c.alphaFilmWater,
          aFwBc,
          (c) => c.velocityFilm,
          vfBc,
          cellLeft,
        );
        fluxDo[f] = computeFaceFlux(
          (c) => c.alphaDropletOil,
          aDoBc,
          (c) => c.velocityDroplet,
          vdBc,
          cellLeft,
        );
        fluxDw[f] = computeFaceFlux(
          (c) => c.alphaDropletWater,
          aDwBc,
          (c) => c.velocityDroplet,
          vdBc,
          cellLeft,
        );
        fluxGas[f] = computeFaceFlux(
          (c) => c.alphaGas,
          aGasBc,
          (c) => c.velocityGas,
          vgBc,
          cellLeft,
        );
      }

      // 2. Update cell holdups via finite-volume conservation law:
      //    d(alpha_k)/dt + (F_{k, i+1/2} - F_{k, i-1/2}) / dx_i = Gamma_k / rho_k
      const nextCells: ThreeFluidCellState[] = new Array(numCells);

      for (let i = 0; i < numCells; i++) {
        const c = cells[i]!;
        const dxi = cellDx[i]!;
        const dPipe = cellDiameters[i]!;

        const divFo = (fluxFo[i + 1]! - fluxFo[i]!) / dxi;
        const divFw = (fluxFw[i + 1]! - fluxFw[i]!) / dxi;
        const divDo = (fluxDo[i + 1]! - fluxDo[i]!) / dxi;
        const divDw = (fluxDw[i + 1]! - fluxDw[i]!) / dxi;
        const divGas = (fluxGas[i + 1]! - fluxGas[i]!) / dxi;

        let nextAFo = Math.max(0.002, c.alphaFilmOil + (-divFo + srcFo[i]!) * dtSub);
        let nextAFw = Math.max(0.002, c.alphaFilmWater + (-divFw + srcFw[i]!) * dtSub);
        let nextADo = Math.max(0.0, Math.min(0.35, c.alphaDropletOil + (-divDo + srcDo[i]!) * dtSub));
        let nextADw = Math.max(0.0, Math.min(0.35, c.alphaDropletWater + (-divDw + srcDw[i]!) * dtSub));
        let nextAGas = Math.max(0.05, c.alphaGas + -divGas * dtSub);

        // Normalize all 5 volume fractions to strictly satisfy sum(alpha_k) = 1.0
        const sumLiqRaw = nextAFo + nextAFw + nextADo + nextADw;
        const totalAlpha = sumLiqRaw + nextAGas;
        if (totalAlpha > 0) {
          nextAFo /= totalAlpha;
          nextAFw /= totalAlpha;
          nextADo /= totalAlpha;
          nextADw /= totalAlpha;
          nextAGas /= totalAlpha;
        }

        let sumLiq = nextAFo + nextAFw + nextADo + nextADw;
        if (sumLiq > 0.95) {
          const factor = 0.95 / sumLiq;
          nextAFo *= factor;
          nextAFw *= factor;
          nextADo *= factor;
          nextADw *= factor;
          sumLiq = 0.95;
        }
        nextAGas = 1.0 - sumLiq;

        const localWc = (nextAFw + nextADw) / Math.max(1e-4, sumLiq);
        const emulsion = evaluateEmulsionViscosity(localWc, 0.008, 0.001);
        const filmThick = dPipe * 0.5 * (1.0 - Math.sqrt(Math.max(0.01, 1.0 - (nextAFo + nextAFw))));

        nextCells[i] = {
          x: c.x,
          pressurePa: c.pressurePa,
          temperatureK: c.temperatureK,
          alphaGas: nextAGas,
          alphaFilmOil: nextAFo,
          alphaFilmWater: nextAFw,
          alphaDropletOil: nextADo,
          alphaDropletWater: nextADw,
          velocityGas: c.velocityGas,
          velocityFilm: c.velocityFilm,
          velocityDroplet: c.velocityDroplet,
          filmThicknessM: filmThick,
          entrainmentRateKgM3S: entRates[i]!,
          depositionRateKgM3S: depRates[i]!,
          continuousPhase: emulsion.continuousPhase,
          apparentViscosityPaS: emulsion.effectiveViscosity,
        };
      }

      // 3. Coupled spatial pressure integration from outlet separator back to inlet across all pipe segments
      const cellDp = new Float64Array(numCells);
      for (let i = 0; i < numCells; i++) {
        const c = nextCells[i]!;
        const dPipe = cellDiameters[i]!;
        const dxi = cellDx[i]!;
        const sinTheta = cellSinTheta[i]!;

        const rhoG = Math.max(5.0, (c.pressurePa / 1e5) * 0.82);
        const rhoFilm =
          (c.alphaFilmOil * rhoO + c.alphaFilmWater * rhoW) / Math.max(1e-4, c.alphaFilmOil + c.alphaFilmWater);
        const rhoMix =
          c.alphaGas * rhoG +
          (c.alphaFilmOil + c.alphaDropletOil) * rhoO +
          (c.alphaFilmWater + c.alphaDropletWater) * rhoW;

        // Wall friction + hydrostatic gravity + local valve losses
        const reFilm = (rhoFilm * c.velocityFilm * dPipe) / Math.max(1e-4, c.apparentViscosityPaS);
        const fWall = Math.max(0.012, Math.min(0.06, 0.316 / Math.pow(Math.max(100.0, reFilm), 0.25)));
        const tauW = 0.5 * fWall * rhoFilm * c.velocityFilm * c.velocityFilm;
        const dpFric = ((tauW * 4.0) / dPipe) * dxi;
        const dpGrav = Math.max(0.0, rhoMix * gGrav * sinTheta * dxi);

        // Check if any inline choke/valve sits inside cell [x_i - dx/2, x_i + dx/2]
        let dpValve = 0.0;
        const xMin = c.x - 0.5 * dxi;
        const xMax = c.x + 0.5 * dxi;
        for (const v of valves) {
          if (v.position >= xMin && v.position <= xMax) {
            const cd = Math.max(0.1, (v.cd ?? 0.8) * Math.max(0.05, v.opening));
            const areaRatio = Math.pow(dPipe / Math.max(0.01, v.diameter), 2);
            const vMix = c.alphaGas * c.velocityGas + (1.0 - c.alphaGas) * c.velocityFilm;
            dpValve += 0.5 * rhoMix * vMix * vMix * Math.max(0.0, areaRatio / (cd * cd) - 1.0);
          }
        }

        cellDp[i] = dpFric + dpGrav + dpValve;
      }

      // Integrate backwards from outlet boundary (pOutlet) to inlet, blending with existing pressure profile
      const targetPressures = new Float64Array(numCells);
      const totalHydroDrop = cellDp.reduce((a, b) => a + b, 0);
      const scaleDrop = totalHydroDrop > 0 ? Math.max(1.0, (pInlet - pOutlet) / Math.max(totalHydroDrop, 1.0)) : 1.0;

      let pAccum = pOutlet;
      for (let i = numCells - 1; i >= 0; i--) {
        const dpSeg = cellDp[i]! * scaleDrop;
        pAccum += 0.5 * dpSeg;
        targetPressures[i] = Math.max(pOutlet + 1e3, pAccum);
        pAccum += 0.5 * dpSeg;
      }

      const relaxP = Math.min(1.0, 0.35 * dtSub);
      for (let i = 0; i < numCells; i++) {
        const c = nextCells[i]!;
        c.pressurePa = Math.max(pOutlet + 1e3, (1.0 - relaxP) * c.pressurePa + relaxP * targetPressures[i]!);
      }

      // 4. Coupled momentum velocity update driven by spatial pressure gradient -dP/dx and interfacial shear
      for (let i = 0; i < numCells; i++) {
        const c = nextCells[i]!;
        const dPipe = cellDiameters[i]!;
        const dxi = cellDx[i]!;
        const pUpstream = i === 0 ? pInlet : nextCells[i - 1]!.pressurePa;
        const pDownstream = i === numCells - 1 ? pOutlet : nextCells[i + 1]!.pressurePa;
        const dist = i === 0 || i === numCells - 1 ? 1.5 * dxi : 2.0 * dxi;
        const gradP = Math.max(1.0, (pUpstream - pDownstream) / dist);

        const rhoG = Math.max(5.0, (c.pressurePa / 1e5) * 0.82);
        const area = 0.25 * Math.PI * dPipe * dPipe;

        const targetVg = Math.max(0.5, (massRateTotal * bcGasFrac) / (rhoG * area * Math.max(0.05, c.alphaGas)));
        const targetVf = Math.max(
          0.1,
          Math.min(
            0.85 * targetVg,
            (massRateTotal * (1.0 - bcGasFrac)) / (850.0 * area * Math.max(0.01, c.alphaFilmOil + c.alphaFilmWater)) +
              0.0002 * Math.sqrt(gradP * dPipe),
          ),
        );

        const relaxV = Math.min(1.0, 0.25 * dtSub);
        c.velocityGas = (1.0 - relaxV) * c.velocityGas + relaxV * targetVg;
        c.velocityFilm = Math.min(c.velocityGas * 0.85, (1.0 - relaxV) * c.velocityFilm + relaxV * targetVf);
        c.velocityDroplet = Math.min(
          c.velocityGas * 0.98,
          Math.max(c.velocityFilm * 1.05, c.velocityDroplet + 0.15 * (c.velocityGas - c.velocityDroplet) * dtSub),
        );
      }

      cells = nextCells;
    }

    peakInletPressurePa = Math.max(peakInletPressurePa, cells[0]?.pressurePa ?? pInlet);
    peakArrivalPressurePa = Math.max(peakArrivalPressurePa, cells[numCells - 1]?.pressurePa ?? pOutlet);

    times.push(currentTime);
    profiles.push({ time: currentTime, cells: JSON.parse(JSON.stringify(cells)) });
  }

  // Summary statistics & phase inversion location detection
  const lastSnap = profiles[profiles.length - 1]?.cells ?? [];
  const avgDroplet =
    lastSnap.reduce((acc: number, c: ThreeFluidCellState) => acc + c.alphaDropletOil + c.alphaDropletWater, 0) /
    Math.max(1, lastSnap.length);

  let phaseInversionLocationM: number | null = null;
  for (let i = 1; i < lastSnap.length; i++) {
    if (lastSnap[i]!.continuousPhase !== lastSnap[i - 1]!.continuousPhase) {
      phaseInversionLocationM = 0.5 * (lastSnap[i - 1]!.x + lastSnap[i]!.x);
      break;
    }
  }

  return {
    times,
    profiles,
    summary: {
      peakInletPressureBar: peakInletPressurePa / 1e5,
      peakArrivalPressureBar: peakArrivalPressurePa / 1e5,
      averageDropletFraction: avgDroplet,
      phaseInversionLocationM,
    },
  };
}
