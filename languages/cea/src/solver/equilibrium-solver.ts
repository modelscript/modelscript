// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cea — Newton-Raphson Lagrange-Multiplier Gibbs Free-Energy Minimization Solver.
 *
 * Implements the Gordon & McBride (NASA RP-1311) chemical equilibrium formulation for
 * TP, HP, SP, UV, TV, and SV thermodynamic problems, plus frozen-composition expansion.
 */

import type { CeaDeck, CeaSpeciesData, EquilibriumState } from "../types.js";
import {
  CEA_SPECIES_LIST,
  P_BAR_PA,
  P_STD_PA,
  R_UNIVERSAL,
  computeMolarMass,
  computeReactantEnthalpyJMol,
  evalNasa7,
  lookupCeaSpecies,
} from "./thermo-db.js";

export interface PreparedMixture {
  elements: string[];
  /** Elemental abundance vector b0 [mol element / kg mixture] */
  elementMolesPerKg: Record<string, number>;
  /** Initial mixture specific enthalpy h0 [J/kg] */
  enthalpyJKg: number;
  /** Initial reactant temperature [K] */
  initialTempK: number;
  /** Initial reactant molar mass [kg/mol] */
  initialMolarMassKgMol: number;
  /** Oxidizer-to-fuel mass ratio O/F (0 if premixed without fuel/oxid split) */
  ofRatio: number;
  /** Equivalence ratio phi */
  phi: number;
  /** Candidate gas-phase product species */
  species: CeaSpeciesData[];
}

/**
 * Solves a small dense linear system A * x = b using Gaussian elimination with partial pivoting.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(M[col]![col]!);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(M[row]![col]!);
      if (v > maxVal) {
        maxVal = v;
        pivotRow = row;
      }
    }
    if (pivotRow !== col) {
      const tmp = M[col]!;
      M[col] = M[pivotRow]!;
      M[pivotRow] = tmp;
    }

    const pivot = M[col]![col]!;
    if (Math.abs(pivot) < 1e-30) {
      // Tikhonov regularization for near-singular pivot
      M[col]![col] = pivot >= 0 ? 1e-18 : -1e-18;
    }
    const diag = M[col]![col]!;
    for (let row = col + 1; row < n; row++) {
      const factor = M[row]![col]! / diag;
      if (factor === 0) continue;
      for (let k = col; k <= n; k++) {
        M[row]![k] = M[row]![k]! - factor * M[col]![k]!;
      }
    }
  }

  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = M[row]![n]!;
    for (let k = row + 1; k < n; k++) {
      sum -= M[row]![k]! * x[k]!;
    }
    x[row] = sum / M[row]![row]!;
  }
  return x;
}

/**
 * Resolves a reactant entry to its species data, elemental formula, molar mass, and molar enthalpy.
 */
function resolveReactantInfo(r: CeaDeck["reactants"][number]): {
  formula: Record<string, number>;
  molarMass: number;
  hJMol: number;
  tempK: number;
} {
  const sp = lookupCeaSpecies(r.name);
  const tempK = r.temperatureK ?? 298.15;
  if (sp) {
    const formula = r.formula ?? sp.formula;
    const molarMass = r.formula ? computeMolarMass(r.formula) : sp.molarMassKgMol;
    const hJMol = computeReactantEnthalpyJMol(sp, r.name, tempK, r.enthalpyKjMol);
    return { formula, molarMass, hJMol, tempK };
  }
  if (r.formula) {
    const molarMass = computeMolarMass(r.formula);
    const hJMol = (r.enthalpyKjMol ?? 0) * 1000.0;
    return { formula: r.formula, molarMass, hJMol, tempK };
  }
  throw new Error(`Unknown reactant species '${r.name}'`);
}

function accumulateGroupPerKg(group: CeaDeck["reactants"]): {
  elements: Record<string, number>;
  enthalpyJKg: number;
  molesPerKg: number;
  avgTempK: number;
} {
  // Compute unnormalized mass weights
  const items = group.map((r) => {
    const info = resolveReactantInfo(r);
    let rawWeight = 1.0;
    if (r.wtPercent !== undefined) rawWeight = r.wtPercent;
    else if (r.moles !== undefined) rawWeight = r.moles * info.molarMass;
    return { info, rawWeight };
  });

  const totalMass = items.reduce((s, it) => s + it.rawWeight, 0);
  if (totalMass <= 0) {
    throw new Error("Reactant group has non-positive total mass");
  }

  const elements: Record<string, number> = {};
  let enthalpyJKg = 0;
  let molesPerKg = 0;
  let avgTempK = 0;

  for (const it of items) {
    const massFrac = it.rawWeight / totalMass;
    const molPerKg = massFrac / it.info.molarMass;
    molesPerKg += molPerKg;
    enthalpyJKg += molPerKg * it.info.hJMol;
    avgTempK += massFrac * it.info.tempK;
    for (const [el, count] of Object.entries(it.info.formula)) {
      elements[el] = (elements[el] ?? 0) + molPerKg * count;
    }
  }

  return { elements, enthalpyJKg, molesPerKg, avgTempK };
}

/**
 * Prepares the per-kg elemental abundance vector, initial enthalpy, and candidate product species
 * from a parsed `CeaDeck`.
 */
export function prepareReactantMixture(deck: CeaDeck, overrideOfRatio?: number, overridePhi?: number): PreparedMixture {
  const fuels = deck.reactants.filter((r) => r.role === "fuel");
  const oxids = deck.reactants.filter((r) => r.role === "oxid");
  const others = deck.reactants.filter((r) => r.role === "name");

  const elementMolesPerKg: Record<string, number> = {};
  let enthalpyJKg = 0;
  let initialMolesPerKg = 0;
  let initialTempK = 298.15;
  let ofRatio = 0;
  let phi = 1.0;

  if (fuels.length > 0 && oxids.length > 0) {
    const fGrp = accumulateGroupPerKg(fuels);
    const oGrp = accumulateGroupPerKg(oxids);

    // Stoichiometric O/F from valence balance: C -> CO2 (+2 O), H -> H2O (+0.5 O)
    const oReqFuel = 2 * (fGrp.elements["C"] ?? 0) + 0.5 * (fGrp.elements["H"] ?? 0) - (fGrp.elements["O"] ?? 0);
    const oAvailOx = (oGrp.elements["O"] ?? 0) - 2 * (oGrp.elements["C"] ?? 0) - 0.5 * (oGrp.elements["H"] ?? 0);
    const stoichOF = oAvailOx > 1e-12 && oReqFuel > 1e-12 ? oReqFuel / oAvailOx : 1.0;

    if (overrideOfRatio !== undefined) {
      ofRatio = overrideOfRatio;
      phi = ofRatio > 0 ? stoichOF / ofRatio : 1.0;
    } else if (overridePhi !== undefined) {
      phi = overridePhi;
      ofRatio = phi > 0 ? stoichOF / phi : stoichOF;
    } else if (deck.problem.ofRatios.length > 0) {
      ofRatio = deck.problem.ofRatios[0]!;
      phi = ofRatio > 0 ? stoichOF / ofRatio : 1.0;
    } else if (deck.problem.phiRatios.length > 0) {
      phi = deck.problem.phiRatios[0]!;
      ofRatio = phi > 0 ? stoichOF / phi : stoichOF;
    } else {
      ofRatio = stoichOF;
      phi = 1.0;
    }

    const wFuel = 1.0 / (1.0 + ofRatio);
    const wOxid = ofRatio / (1.0 + ofRatio);

    const allEls = new Set([...Object.keys(fGrp.elements), ...Object.keys(oGrp.elements)]);
    for (const el of allEls) {
      const v = wFuel * (fGrp.elements[el] ?? 0) + wOxid * (oGrp.elements[el] ?? 0);
      if (v > 1e-15) elementMolesPerKg[el] = v;
    }
    enthalpyJKg = wFuel * fGrp.enthalpyJKg + wOxid * oGrp.enthalpyJKg;
    initialMolesPerKg = wFuel * fGrp.molesPerKg + wOxid * oGrp.molesPerKg;
    initialTempK = wFuel * fGrp.avgTempK + wOxid * oGrp.avgTempK;
  } else {
    const allReactants = [...fuels, ...oxids, ...others];
    if (allReactants.length === 0) {
      throw new Error("No reactants specified in NASA CEA deck");
    }
    const grp = accumulateGroupPerKg(allReactants);
    for (const [el, v] of Object.entries(grp.elements)) {
      if (v > 1e-15) elementMolesPerKg[el] = v;
    }
    enthalpyJKg = grp.enthalpyJKg;
    initialMolesPerKg = grp.molesPerKg;
    initialTempK = grp.avgTempK;
    const oReq = 2 * (elementMolesPerKg["C"] ?? 0) + 0.5 * (elementMolesPerKg["H"] ?? 0);
    const oPres = elementMolesPerKg["O"] ?? 0;
    phi = oPres > 1e-12 ? oReq / oPres : 1.0;
  }

  const elements = Object.keys(elementMolesPerKg).sort();
  const presentSet = new Set(elements);
  const onlySet = new Set(deck.only.map((s) => s.toUpperCase()));
  const omitSet = new Set(deck.omit.map((s) => s.toUpperCase()));

  const species = CEA_SPECIES_LIST.filter((sp) => {
    if (sp.phase !== "gas") return false;
    for (const el of Object.keys(sp.formula)) {
      if (!presentSet.has(el)) return false;
    }
    const upper = sp.name.toUpperCase();
    if (onlySet.size > 0 && !onlySet.has(upper)) return false;
    if (omitSet.has(upper)) return false;
    return true;
  });

  if (species.length === 0) {
    throw new Error("No valid gas-phase product species available for the given elements and filters");
  }

  return {
    elements,
    elementMolesPerKg,
    enthalpyJKg,
    initialTempK,
    initialMolarMassKgMol: initialMolesPerKg > 0 ? 1.0 / initialMolesPerKg : 0.02,
    ofRatio,
    phi,
    species,
  };
}

interface RawEquilibriumSolution {
  nSpecies: number[];
  nTotal: number;
  hJKg: number;
  sJKgK: number;
  gJKg: number;
  cpFrozenJKgK: number;
  elementResidualMax: number;
  converged: boolean;
  iterations: number;
}

/**
 * Core Gordon & McBride (NASA RP-1311) Newton-Raphson Lagrange-multiplier Gibbs minimizer
 * at fixed (T, P).
 */
function minimizeGibbsTP(
  elements: string[],
  b0: number[],
  species: CeaSpeciesData[],
  temperatureK: number,
  pressurePa: number,
  warmStart?: number[],
): RawEquilibriumSolution {
  const ne = elements.length;
  const ns = species.length;
  const T = Math.max(100.0, Math.min(15000.0, temperatureK));
  const P = Math.max(1.0, pressurePa);
  const lnP = Math.log(P / P_STD_PA);

  // Stoichiometry matrix a[i][j]
  const a: number[][] = elements.map((el) => species.map((sp) => sp.formula[el] ?? 0));

  // Precompute standard chemical potentials g°/(RT), h°, s°, cp°
  const g0OverRT = new Array<number>(ns);
  const hJMol = new Array<number>(ns);
  const sJMolK = new Array<number>(ns);
  const cpJMolK = new Array<number>(ns);
  for (let j = 0; j < ns; j++) {
    const ev = evalNasa7(species[j]!.nasa7, T);
    g0OverRT[j] = ev.gOverRT;
    hJMol[j] = ev.hJMol;
    sJMolK[j] = ev.sJMolK;
    cpJMolK[j] = ev.cpJMolK;
  }

  // Initial mole estimates [mol/kg]
  const totalAtoms = b0.reduce((s, v) => s + v, 0);
  const initN = Math.max(1.0, totalAtoms * 0.5);
  const lnNj = new Array<number>(ns);
  let nTotal = initN;

  if (warmStart && warmStart.length === ns) {
    let sum = 0;
    for (let j = 0; j < ns; j++) {
      const nj = Math.max(1e-25, warmStart[j]!);
      lnNj[j] = Math.log(nj);
      sum += nj;
    }
    nTotal = Math.max(1e-12, sum);
  } else {
    const nj0 = initN / ns;
    for (let j = 0; j < ns; j++) {
      lnNj[j] = Math.log(nj0);
    }
  }
  let lnN = Math.log(nTotal);

  let converged = false;
  let iterations = 0;
  const maxIter = 100;
  const dim = ne + 1;

  for (let iter = 1; iter <= maxIter; iter++) {
    iterations = iter;
    const nj = new Array<number>(ns);
    const muOverRT = new Array<number>(ns);
    let sumNj = 0;

    for (let j = 0; j < ns; j++) {
      const v = Math.exp(lnNj[j]!);
      nj[j] = v;
      sumNj += v;
      muOverRT[j] = g0OverRT[j]! + (lnNj[j]! - lnN) + lnP;
    }

    // Assemble symmetric (ne + 1) x (ne + 1) matrix
    const M: number[][] = Array.from({ length: dim }, () => new Array<number>(dim).fill(0));
    const rhs = new Array<number>(dim).fill(0);

    for (let i = 0; i < ne; i++) {
      let sumAiNj = 0;
      let sumAiNjMu = 0;
      for (let j = 0; j < ns; j++) {
        const aij = a[i]![j]!;
        if (aij === 0) continue;
        const aijNj = aij * nj[j]!;
        sumAiNj += aijNj;
        sumAiNjMu += aijNj * muOverRT[j]!;
        for (let k = i; k < ne; k++) {
          const akj = a[k]![j]!;
          if (akj !== 0) {
            M[i]![k] = M[i]![k]! + aijNj * akj;
          }
        }
      }
      M[i]![ne] = sumAiNj;
      M[ne]![i] = sumAiNj;
      rhs[i] = b0[i]! - sumAiNj + sumAiNjMu;
    }
    for (let i = 0; i < ne; i++) {
      for (let k = 0; k < i; k++) {
        M[i]![k] = M[k]![i]!;
      }
    }

    let sumNjMu = 0;
    for (let j = 0; j < ns; j++) {
      sumNjMu += nj[j]! * muOverRT[j]!;
    }
    M[ne]![ne] = sumNj - nTotal;
    rhs[ne] = nTotal - sumNj + sumNjMu;

    const sol = solveLinearSystem(M, rhs);
    const dLnN = sol[ne]!;

    const dLnNj = new Array<number>(ns);
    for (let j = 0; j < ns; j++) {
      let sumApi = 0;
      for (let i = 0; i < ne; i++) {
        const aij = a[i]![j]!;
        if (aij !== 0) sumApi += aij * sol[i]!;
      }
      dLnNj[j] = sumApi + dLnN - muOverRT[j]!;
    }

    // Gordon & McBride step-size control (lambda)
    let lambda = 1.0;
    const absDLnN = Math.abs(dLnN);
    if (absDLnN > 2.0) {
      lambda = Math.min(lambda, 2.0 / absDLnN);
    }

    for (let j = 0; j < ns; j++) {
      const d = dLnNj[j]!;
      const rel = lnNj[j]! - lnN;
      if (rel > -18.42) {
        // Major species (mole fraction > 1e-8)
        const absD = Math.abs(d);
        if (absD > 2.0) {
          lambda = Math.min(lambda, 2.0 / absD);
        }
      } else if (d > 0) {
        // Trace species trying to grow rapidly
        const cap = Math.abs(-rel - 9.2103404) + 2.0;
        if (d > cap) {
          lambda = Math.min(lambda, cap / d);
        }
      }
    }
    if (!Number.isFinite(lambda) || lambda <= 0) lambda = 0.05;

    // Apply damped update
    lnN = lnN + lambda * dLnN;
    nTotal = Math.exp(lnN);
    for (let j = 0; j < ns; j++) {
      lnNj[j] = Math.max(-75.0, Math.min(20.0, lnNj[j]! + lambda * dLnNj[j]!));
    }

    // Check convergence
    let maxStep = Math.abs(dLnN);
    for (let j = 0; j < ns; j++) {
      const moleFrac = Math.exp(lnNj[j]! - lnN);
      const weighted = moleFrac * Math.abs(dLnNj[j]!);
      if (weighted > maxStep) maxStep = weighted;
    }

    let maxElRes = 0;
    for (let i = 0; i < ne; i++) {
      let sum = 0;
      for (let j = 0; j < ns; j++) {
        sum += a[i]![j]! * Math.exp(lnNj[j]!);
      }
      const res = Math.abs(b0[i]! - sum) / Math.max(1e-12, b0[i]!);
      if (res > maxElRes) maxElRes = res;
    }

    if (maxStep < 1e-10 && maxElRes < 1e-9 && Math.abs(sumNj - nTotal) / Math.max(1e-12, nTotal) < 1e-9) {
      converged = true;
      break;
    }
  }

  // Final property evaluation
  const nSpecies = new Array<number>(ns);
  let sumN = 0;
  for (let j = 0; j < ns; j++) {
    const v = Math.exp(lnNj[j]!);
    nSpecies[j] = v;
    sumN += v;
  }

  let hJKg = 0;
  let sJKgK = 0;
  let cpFrozenJKgK = 0;
  for (let j = 0; j < ns; j++) {
    const nj = nSpecies[j]!;
    hJKg += nj * hJMol[j]!;
    cpFrozenJKgK += nj * cpJMolK[j]!;
    if (nj > 1e-35) {
      const xj = nj / sumN;
      sJKgK += nj * (sJMolK[j]! - R_UNIVERSAL * Math.log(xj) - R_UNIVERSAL * lnP);
    }
  }

  let elementResidualMax = 0;
  for (let i = 0; i < ne; i++) {
    let sum = 0;
    for (let j = 0; j < ns; j++) {
      sum += a[i]![j]! * nSpecies[j]!;
    }
    const res = Math.abs(b0[i]! - sum) / Math.max(1e-12, b0[i]!);
    if (res > elementResidualMax) elementResidualMax = res;
  }

  return {
    nSpecies,
    nTotal: sumN,
    hJKg,
    sJKgK,
    gJKg: hJKg - T * sJKgK,
    cpFrozenJKgK,
    elementResidualMax,
    converged,
    iterations,
  };
}

function buildEquilibriumState(
  mix: PreparedMixture,
  T: number,
  P_pa: number,
  sol: RawEquilibriumSolution,
  computeShiftingDerivatives: boolean,
): EquilibriumState {
  const b0 = mix.elements.map((el) => mix.elementMolesPerKg[el]!);
  const nTotal = sol.nTotal;
  const molarMassKgMol = 1.0 / nTotal;
  const rMix = nTotal * R_UNIVERSAL;
  const densityKgM3 = P_pa / (rMix * T);
  const internalEnergyJKg = sol.hJKg - rMix * T;

  let cpJKgK = sol.cpFrozenJKgK;
  let cvJKgK = Math.max(1.0, cpJKgK - rMix);
  let gamma = cpJKgK / cvJKgK;

  if (computeShiftingDerivatives) {
    const dT = Math.max(0.25, T * 1e-4);
    const solPlusT = minimizeGibbsTP(mix.elements, b0, mix.species, T + dT, P_pa, sol.nSpecies);
    const solMinusT = minimizeGibbsTP(mix.elements, b0, mix.species, Math.max(100, T - dT), P_pa, sol.nSpecies);
    const spanT = T + dT - Math.max(100, T - dT);
    const cpEq = (solPlusT.hJKg - solMinusT.hJKg) / spanT;
    const dLnN_dLnT = ((Math.log(solPlusT.nTotal) - Math.log(solMinusT.nTotal)) / spanT) * T;

    const dP = P_pa * 1e-4;
    const solPlusP = minimizeGibbsTP(mix.elements, b0, mix.species, T, P_pa + dP, sol.nSpecies);
    const solMinusP = minimizeGibbsTP(mix.elements, b0, mix.species, T, Math.max(1.0, P_pa - dP), sol.nSpecies);
    const dLnN_dLnP = ((Math.log(solPlusP.nTotal) - Math.log(solMinusP.nTotal)) / (2 * dP)) * P_pa;

    const dLnV_dLnT_P = 1.0 + dLnN_dLnT;
    const dLnV_dLnP_T = -1.0 + dLnN_dLnP;

    if (Number.isFinite(cpEq) && cpEq > rMix) {
      cpJKgK = cpEq;
      const denom = cpEq * -dLnV_dLnP_T - rMix * dLnV_dLnT_P * dLnV_dLnT_P;
      if (Number.isFinite(denom) && denom > 1.0) {
        gamma = cpEq / denom;
        cvJKgK = cpEq / gamma;
      } else {
        cvJKgK = Math.max(1.0, cpEq - rMix);
        gamma = cpEq / cvJKgK;
      }
    }
  }

  const sonicVelocityMS = Math.sqrt(Math.max(1.0, gamma * rMix * T));

  const moleFractions: Record<string, number> = {};
  const massFractions: Record<string, number> = {};
  const speciesMolesPerKg: Record<string, number> = {};
  for (let j = 0; j < mix.species.length; j++) {
    const sp = mix.species[j]!;
    const nj = sol.nSpecies[j]!;
    speciesMolesPerKg[sp.name] = nj;
    moleFractions[sp.name] = nj / nTotal;
    massFractions[sp.name] = nj * sp.molarMassKgMol;
  }

  return {
    temperatureK: T,
    pressurePa: P_pa,
    pressureBar: P_pa / P_BAR_PA,
    densityKgM3,
    molarMassKgMol,
    molarMassGMol: molarMassKgMol * 1000.0,
    enthalpyJKg: sol.hJKg,
    internalEnergyJKg,
    entropyJKgK: sol.sJKgK,
    gibbsJKg: sol.gJKg,
    cpJKgK,
    cvJKgK,
    gamma,
    sonicVelocityMS,
    totalMolesPerKg: nTotal,
    moleFractions,
    massFractions,
    speciesMolesPerKg,
    elementMolesPerKg: { ...mix.elementMolesPerKg },
    elementResidualMax: sol.elementResidualMax,
    converged: sol.converged,
    iterations: sol.iterations,
  };
}

/**
 * Solves chemical equilibrium at assigned temperature T [K] and pressure P [Pa].
 */
export function solveEquilibriumTP(
  mix: PreparedMixture,
  temperatureK: number,
  pressurePa: number,
  computeShiftingDerivatives: boolean = true,
): EquilibriumState {
  const b0 = mix.elements.map((el) => mix.elementMolesPerKg[el]!);
  const sol = minimizeGibbsTP(mix.elements, b0, mix.species, temperatureK, pressurePa);
  return buildEquilibriumState(mix, temperatureK, pressurePa, sol, computeShiftingDerivatives);
}

/**
 * Solves adiabatic constant-pressure combustion equilibrium (HP) at assigned enthalpy h0 [J/kg]
 * and pressure P [Pa].
 */
export function solveEquilibriumHP(
  mix: PreparedMixture,
  pressurePa: number,
  targetEnthalpyJKg: number = mix.enthalpyJKg,
  tGuessK: number = 3000.0,
): EquilibriumState {
  const b0 = mix.elements.map((el) => mix.elementMolesPerKg[el]!);
  let tLo = 200.0;
  let tHi = 7500.0;
  let T = Math.max(tLo + 10, Math.min(tHi - 10, tGuessK));

  let sol = minimizeGibbsTP(mix.elements, b0, mix.species, T, pressurePa);
  let totalIter = sol.iterations;

  for (let outer = 0; outer < 45; outer++) {
    const f = sol.hJKg - targetEnthalpyJKg;
    if (Math.abs(f) < 1e-2 * Math.max(1.0, Math.abs(targetEnthalpyJKg)) * 1e-5 || Math.abs(f) < 1.0) {
      break;
    }

    if (f < 0) tLo = Math.max(tLo, T);
    else tHi = Math.min(tHi, T);

    // Estimate equilibrium Cp via finite difference
    const dT = Math.max(1.0, T * 1e-3);
    const solPlus = minimizeGibbsTP(mix.elements, b0, mix.species, T + dT, pressurePa, sol.nSpecies);
    const cpEst = Math.max(sol.cpFrozenJKgK, (solPlus.hJKg - sol.hJKg) / dT);

    let tNext = T - f / cpEst;
    if (!Number.isFinite(tNext) || tNext <= tLo || tNext >= tHi) {
      tNext = 0.5 * (tLo + tHi);
    }
    const step = Math.abs(tNext - T);
    T = tNext;
    sol = minimizeGibbsTP(mix.elements, b0, mix.species, T, pressurePa, sol.nSpecies);
    totalIter += sol.iterations;

    if (step < 1e-5) break;
  }

  const state = buildEquilibriumState(mix, T, pressurePa, sol, true);
  state.iterations = totalIter;
  return state;
}

/**
 * Solves isentropic equilibrium expansion (SP) at assigned entropy s0 [J/(kg*K)] and pressure P [Pa].
 */
export function solveEquilibriumSP(
  mix: PreparedMixture,
  pressurePa: number,
  targetEntropyJKgK: number,
  tGuessK: number = 2200.0,
  warmStart?: number[],
): EquilibriumState {
  const b0 = mix.elements.map((el) => mix.elementMolesPerKg[el]!);
  let tLo = 150.0;
  let tHi = 7500.0;
  let T = Math.max(tLo + 5, Math.min(tHi - 5, tGuessK));

  let sol = minimizeGibbsTP(mix.elements, b0, mix.species, T, pressurePa, warmStart);
  let totalIter = sol.iterations;

  for (let outer = 0; outer < 45; outer++) {
    const f = sol.sJKgK - targetEntropyJKgK;
    if (Math.abs(f) < 1e-5) break;

    if (f < 0) tLo = Math.max(tLo, T);
    else tHi = Math.min(tHi, T);

    const dT = Math.max(1.0, T * 1e-3);
    const solPlus = minimizeGibbsTP(mix.elements, b0, mix.species, T + dT, pressurePa, sol.nSpecies);
    const ds_dT = Math.max(sol.cpFrozenJKgK / T, (solPlus.sJKgK - sol.sJKgK) / dT);

    let tNext = T - f / ds_dT;
    if (!Number.isFinite(tNext) || tNext <= tLo || tNext >= tHi) {
      tNext = 0.5 * (tLo + tHi);
    }
    const step = Math.abs(tNext - T);
    T = tNext;
    sol = minimizeGibbsTP(mix.elements, b0, mix.species, T, pressurePa, sol.nSpecies);
    totalIter += sol.iterations;

    if (step < 1e-5) break;
  }

  const state = buildEquilibriumState(mix, T, pressurePa, sol, true);
  state.iterations = totalIter;
  return state;
}

/**
 * Solves isentropic frozen-composition expansion at fixed species moles `frozenMolesPerKg`
 * and assigned entropy s0 [J/(kg*K)] and pressure P [Pa].
 */
export function solveFrozenSP(
  mix: PreparedMixture,
  frozenMolesPerKg: Record<string, number>,
  pressurePa: number,
  targetEntropyJKgK: number,
  tGuessK: number = 2000.0,
): EquilibriumState {
  const nSpecies = mix.species.map((sp) => frozenMolesPerKg[sp.name] ?? 0);
  const nTotal = nSpecies.reduce((s, v) => s + v, 0);
  const lnP = Math.log(Math.max(1.0, pressurePa) / P_STD_PA);

  const evalFrozen = (T: number) => {
    let hJKg = 0;
    let sJKgK = 0;
    let cpJKgK = 0;
    for (let j = 0; j < mix.species.length; j++) {
      const nj = nSpecies[j]!;
      if (nj <= 0) continue;
      const ev = evalNasa7(mix.species[j]!.nasa7, T);
      hJKg += nj * ev.hJMol;
      cpJKgK += nj * ev.cpJMolK;
      const xj = nj / nTotal;
      if (xj > 1e-35) {
        sJKgK += nj * (ev.sJMolK - R_UNIVERSAL * Math.log(xj) - R_UNIVERSAL * lnP);
      }
    }
    return { hJKg, sJKgK, cpJKgK };
  };

  let tLo = 100.0;
  let tHi = 7500.0;
  let T = Math.max(tLo + 5, Math.min(tHi - 5, tGuessK));
  let ev = evalFrozen(T);

  for (let iter = 0; iter < 40; iter++) {
    const f = ev.sJKgK - targetEntropyJKgK;
    if (Math.abs(f) < 1e-6) break;
    if (f < 0) tLo = Math.max(tLo, T);
    else tHi = Math.min(tHi, T);

    let tNext = T - (f * T) / Math.max(100.0, ev.cpJKgK);
    if (!Number.isFinite(tNext) || tNext <= tLo || tNext >= tHi) {
      tNext = 0.5 * (tLo + tHi);
    }
    const step = Math.abs(tNext - T);
    T = tNext;
    ev = evalFrozen(T);
    if (step < 1e-6) break;
  }

  const sol: RawEquilibriumSolution = {
    nSpecies,
    nTotal,
    hJKg: ev.hJKg,
    sJKgK: ev.sJKgK,
    gJKg: ev.hJKg - T * ev.sJKgK,
    cpFrozenJKgK: ev.cpJKgK,
    elementResidualMax: 0,
    converged: true,
    iterations: 1,
  };
  return buildEquilibriumState(mix, T, pressurePa, sol, false);
}

/**
 * Solves constant-volume equilibrium at assigned (T, rho) — TV problem.
 */
export function solveEquilibriumTV(mix: PreparedMixture, temperatureK: number, densityKgM3: number): EquilibriumState {
  let P = densityKgM3 * (R_UNIVERSAL / mix.initialMolarMassKgMol) * temperatureK;
  let state = solveEquilibriumTP(mix, temperatureK, P, false);
  for (let i = 0; i < 15; i++) {
    const pNext = densityKgM3 * state.totalMolesPerKg * R_UNIVERSAL * temperatureK;
    if (Math.abs(pNext - P) / Math.max(1.0, P) < 1e-9) {
      P = pNext;
      break;
    }
    P = pNext;
    state = solveEquilibriumTP(mix, temperatureK, P, false);
  }
  return solveEquilibriumTP(mix, temperatureK, P, true);
}

/**
 * Solves constant-volume adiabatic combustion (UV) at assigned internal energy u0 and density rho0.
 */
export function solveEquilibriumUV(
  mix: PreparedMixture,
  densityKgM3: number,
  targetInternalEnergyJKg: number,
  tGuessK: number = 3200.0,
): EquilibriumState {
  let tLo = 200.0;
  let tHi = 7500.0;
  let T = Math.max(tLo + 10, Math.min(tHi - 10, tGuessK));
  let state = solveEquilibriumTV(mix, T, densityKgM3);

  for (let iter = 0; iter < 40; iter++) {
    const f = state.internalEnergyJKg - targetInternalEnergyJKg;
    if (Math.abs(f) < 1.0) break;
    if (f < 0) tLo = Math.max(tLo, T);
    else tHi = Math.min(tHi, T);
    let tNext = T - f / Math.max(500.0, state.cvJKgK);
    if (!Number.isFinite(tNext) || tNext <= tLo || tNext >= tHi) {
      tNext = 0.5 * (tLo + tHi);
    }
    const step = Math.abs(tNext - T);
    T = tNext;
    state = solveEquilibriumTV(mix, T, densityKgM3);
    if (step < 1e-4) break;
  }
  return state;
}

/**
 * Solves constant-entropy constant-volume equilibrium (SV).
 */
export function solveEquilibriumSV(
  mix: PreparedMixture,
  densityKgM3: number,
  targetEntropyJKgK: number,
  tGuessK: number = 2500.0,
): EquilibriumState {
  let tLo = 200.0;
  let tHi = 7500.0;
  let T = Math.max(tLo + 10, Math.min(tHi - 10, tGuessK));
  let state = solveEquilibriumTV(mix, T, densityKgM3);

  for (let iter = 0; iter < 40; iter++) {
    const f = state.entropyJKgK - targetEntropyJKgK;
    if (Math.abs(f) < 1e-4) break;
    if (f < 0) tLo = Math.max(tLo, T);
    else tHi = Math.min(tHi, T);
    let tNext = T - (f * T) / Math.max(500.0, state.cvJKgK);
    if (!Number.isFinite(tNext) || tNext <= tLo || tNext >= tHi) {
      tNext = 0.5 * (tLo + tHi);
    }
    const step = Math.abs(tNext - T);
    T = tNext;
    state = solveEquilibriumTV(mix, T, densityKgM3);
    if (step < 1e-4) break;
  }
  return state;
}
