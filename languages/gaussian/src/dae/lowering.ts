// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for `@modelscript/gaussian`.
 *
 * Lowers molecular mechanics and harmonic vibrational normal-mode ODEs directly
 * into `@modelscript/runtime`'s `IDaeBuilder` linear memory representation
 * without allocating intermediate AST wrapper objects.
 */

import { BinOp, Causality, EqKind, type IDaeBuilder, VarType, Variability } from "@modelscript/runtime";
import {
  ensureBuiltInGaussianLibraryRegistered,
  lookupGaussianModelSchema,
} from "../catalog/library-package-adapter.js";
import { computeMomentsOfInertia } from "../solver/inertia.js";
import { jobToCartesian, perceiveBonds } from "../solver/nerf.js";
import { computeHarmonicNormalModes } from "../solver/vibrational.js";
import type { CartesianAtom, GaussianJobStep, InertiaTensorResult, NormalModeResult } from "../types.js";

export interface GaussianDaeLoweringOptions {
  /** Initial displacement amplitude for normal mode coordinates Q_k (amu^(1/2)*Å). */
  initialAmplitude?: number | undefined;
  /** Optional linear modal damping coefficient gamma (1/s, default 0 = conservative). */
  damping?: number | undefined;
  /** Custom Cartesian Hessian in mDyne/Å (optional). */
  customHessian?: number[][] | undefined;
}

export interface GaussianDaeLoweringResult {
  stateVarIndices: number[];
  equationCount: number;
  variableMap: Map<string, number>;
  atoms: CartesianAtom[];
  inertia: InertiaTensorResult;
  normalModes: NormalModeResult;
  zpeScaleFactor: number;
}

/**
 * Lowers a Gaussian job step's molecular geometry, rotational inertia invariants,
 * bonded stretch oscillators, and harmonic vibrational normal-mode ODEs directly
 * into an `IDaeBuilder` arena.
 */
export function lowerGaussianToDae(
  builder: IDaeBuilder,
  job: GaussianJobStep,
  options: GaussianDaeLoweringOptions = {},
): GaussianDaeLoweringResult {
  ensureBuiltInGaussianLibraryRegistered();

  const variableMap = new Map<string, number>();
  const stateVarIndices: number[] = [];
  let equationCount = 0;

  const initialAmp = options.initialAmplitude ?? 0.05;
  const damping = options.damping ?? 0.0;

  // Lookup ZPE scale factor from cleanroom stdlib for the job's method
  let zpeScaleFactor = 1.0;
  if (job.route?.method) {
    const schema = lookupGaussianModelSchema(job.route.method);
    const scaleParam = schema?.parameters.find((p) => p.key === "zpeScaleFactor");
    if (scaleParam && typeof scaleParam.defaultValue === "number") {
      zpeScaleFactor = scaleParam.defaultValue;
    }
  }

  function addOrLookupVar(name: string, variability: Variability, startVal: number): number {
    const existing = variableMap.get(name);
    if (existing !== undefined) return existing;
    const idx = builder.addVariable(name, VarType.Real, variability, Causality.Local, startVal);
    variableMap.set(name, idx);
    return idx;
  }

  const atoms = jobToCartesian(job, { includeDummy: false });
  const inertia = computeMomentsOfInertia(atoms);
  const normalModes = computeHarmonicNormalModes(atoms, options.customHessian);
  const bonds = perceiveBonds(atoms);

  // 1. Molecular scalar parameters (mass, charge, multiplicity, principal moments, ZPE)
  addOrLookupVar("mol_total_mass_amu", Variability.Parameter, inertia.totalMass);
  addOrLookupVar("mol_charge", Variability.Parameter, job.charge ?? 0);
  addOrLookupVar("mol_multiplicity", Variability.Parameter, job.multiplicity ?? 1);
  addOrLookupVar("mol_I_A", Variability.Parameter, inertia.principalMoments[0]);
  addOrLookupVar("mol_I_B", Variability.Parameter, inertia.principalMoments[1]);
  addOrLookupVar("mol_I_C", Variability.Parameter, inertia.principalMoments[2]);
  addOrLookupVar("mol_zpe_kcal_mol", Variability.Parameter, normalModes.zeroPointEnergyKcalMol * zpeScaleFactor);
  addOrLookupVar("mol_zpe_scale", Variability.Parameter, zpeScaleFactor);

  // 2. Harmonic vibrational normal-mode ODEs:
  //    der(Q_k)   = v_Qk
  //    der(v_Qk)  = -omega_k^2 * Q_k  (minus gamma * v_Qk if damped)
  //    E_mode_k   = 0.5 * v_Qk^2 + 0.5 * omega_k^2 * Q_k^2
  const modeEnergyExprs: number[] = [];

  for (const mode of normalModes.vibrationalModes) {
    const k = mode.modeIndex;
    // Use normalized angular frequency in ps^-1 (rad/ps) for well-conditioned ODE timescales
    const omegaPs = mode.angularFrequencyRadS * 1e-12;
    const omegaSq = omegaPs * omegaPs;

    const qVar = addOrLookupVar(`Q_mode_${k}`, Variability.Continuous, initialAmp);
    const vVar = addOrLookupVar(`v_mode_${k}`, Variability.Continuous, 0.0);
    const eVar = addOrLookupVar(`E_mode_${k}`, Variability.Continuous, 0.5 * omegaSq * initialAmp * initialAmp);
    addOrLookupVar(`freq_cm1_mode_${k}`, Variability.Parameter, mode.frequencyCm1 * zpeScaleFactor);
    addOrLookupVar(`mu_amu_mode_${k}`, Variability.Parameter, mode.reducedMassAmu);

    stateVarIndices.push(qVar, vVar);

    // der(Q_k) = v_Qk
    builder.addEquation(EqKind.Simple, builder.addDer(qVar), builder.addName(vVar));
    equationCount++;

    // der(v_Qk) = -omega^2 * Q_k [- damping * v_Qk]
    let rhsAcc = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(-omegaSq), builder.addName(qVar));
    if (damping > 0) {
      const dampTerm = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(damping), builder.addName(vVar));
      rhsAcc = builder.addBinaryExpr(BinOp.Sub, rhsAcc, dampTerm);
    }
    builder.addEquation(EqKind.Simple, builder.addDer(vVar), rhsAcc);
    equationCount++;

    // E_mode_k = 0.5 * (v_Qk * v_Qk) + 0.5 * omega^2 * (Q_k * Q_k)
    const keTerm = builder.addBinaryExpr(
      BinOp.Mul,
      builder.addRealLiteral(0.5),
      builder.addBinaryExpr(BinOp.Mul, builder.addName(vVar), builder.addName(vVar)),
    );
    const peTerm = builder.addBinaryExpr(
      BinOp.Mul,
      builder.addRealLiteral(0.5 * omegaSq),
      builder.addBinaryExpr(BinOp.Mul, builder.addName(qVar), builder.addName(qVar)),
    );
    const totalModeE = builder.addBinaryExpr(BinOp.Add, keTerm, peTerm);
    builder.addEquation(EqKind.Simple, builder.addName(eVar), totalModeE);
    equationCount++;

    modeEnergyExprs.push(builder.addName(eVar));
  }

  // 3. Total vibrational Hamiltonian E_vib_total = sum_k E_mode_k
  if (modeEnergyExprs.length > 0) {
    const eTotVar = addOrLookupVar("E_vib_total", Variability.Continuous, 0.0);
    let sumExpr = modeEnergyExprs[0]!;
    for (let i = 1; i < modeEnergyExprs.length; i++) {
      sumExpr = builder.addBinaryExpr(BinOp.Add, sumExpr, modeEnergyExprs[i]!);
    }
    builder.addEquation(EqKind.Simple, builder.addName(eTotVar), sumExpr);
    equationCount++;
  }

  // 4. Equilibrium bond-length parameters for perceived molecular bonds
  for (let i = 0; i < bonds.length; i++) {
    const b = bonds[i]!;
    addOrLookupVar(`r0_bond_${b.atom1}_${b.atom2}`, Variability.Parameter, b.distance);
  }

  return {
    stateVarIndices,
    equationCount,
    variableMap,
    atoms,
    inertia,
    normalModes,
    zpeScaleFactor,
  };
}
