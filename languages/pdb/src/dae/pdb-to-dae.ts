// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pdb — Direct Linear-Memory DAE Arena Lowering for Coarse-Grained C_alpha Elastic Network ODEs.
 *
 * Compiles macromolecular C_alpha coordinates, Gaussian Network Model (GNM) Kirchhoff connectivity,
 * and coupled harmonic spring-damper ODEs directly into ModelScript's zero-GC DAEBuilder arena.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { parsePdb } from "../parser/pdb-parser.js";
import { solveProteinBiophysics } from "../solvers/protein-biophysics-solver.js";
import type { PdbDocument, PdbStructure } from "../types.js";

export interface PdbDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  cutoffDistance?: number | undefined; // Å (default 7.0)
  springConstant?: number | undefined; // kcal/(mol·Å^2) (default 1.0)
  damping?: number | undefined; // ps^-1 (default 0.5)
  temperature?: number | undefined; // K (default 300.0)
}

function sanitizeId(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    const code = ch.charCodeAt(0);
    const isAlnum =
      (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || ch === "_";
    out += isAlnum ? ch : "_";
  }
  if (out.length === 0) return "ProteinElasticNetwork";
  const firstCode = out.charCodeAt(0);
  if (firstCode >= 48 && firstCode <= 57) return `P_${out}`;
  return out;
}

/**
 * Lowers a PDB / mmCIF macromolecular structure into a structurally square DAEBuilder
 * representing the 3D coarse-grained C_alpha harmonic elastic network oscillator system.
 */
export function lowerPdbToDae(input: PdbStructure | PdbDocument | string, options?: PdbDaeOptions): DAEBuilder {
  const structure: PdbStructure = typeof input === "string" ? parsePdb(input) : input;
  const biophysics = solveProteinBiophysics(structure, {
    cutoffDistance: options?.cutoffDistance,
    springConstant: options?.springConstant,
    temperature: options?.temperature,
  });

  const rawName = options?.modelName ?? (structure.id ? `PDB_${structure.id}` : "ProteinElasticNetwork");
  const modelName = sanitizeId(rawName);
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  const T0 = options?.temperature ?? 300.0;
  const gamma0 = options?.springConstant ?? 1.0;
  const damping0 = options?.damping ?? 0.5;

  const addAdd = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Add, a, b);
  const addSub = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Sub, a, b);
  const addMul = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Mul, a, b);

  // 1. Global Biophysical & Thermodynamic Parameters
  const tVar = dae.addVariable("T", VarType.Real, Variability.Parameter, Causality.Local, T0);
  dae.addEquation(EqKind.Simple, dae.addName(tVar), dae.addRealLiteral(T0));

  const gammaVar = dae.addVariable("gamma", VarType.Real, Variability.Parameter, Causality.Local, gamma0);
  dae.addEquation(EqKind.Simple, dae.addName(gammaVar), dae.addRealLiteral(gamma0));

  const dampVar = dae.addVariable("damping", VarType.Real, Variability.Parameter, Causality.Local, damping0);
  dae.addEquation(EqKind.Simple, dae.addName(dampVar), dae.addRealLiteral(damping0));

  const rgVar = dae.addVariable(
    "Rg",
    VarType.Real,
    Variability.Parameter,
    Causality.Local,
    biophysics.radiusOfGyration,
  );
  dae.addEquation(EqKind.Simple, dae.addName(rgVar), dae.addRealLiteral(biophysics.radiusOfGyration));

  const mwVar = dae.addVariable(
    "MW",
    VarType.Real,
    Variability.Parameter,
    Causality.Local,
    biophysics.molecularWeightDa,
  );
  dae.addEquation(EqKind.Simple, dae.addName(mwVar), dae.addRealLiteral(biophysics.molecularWeightDa));

  const caAtoms = biophysics.caAtoms;
  const n = caAtoms.length;
  const gammaMatrix = biophysics.kirchhoffMatrix;

  const uxVars: number[] = [];
  const uyVars: number[] = [];
  const uzVars: number[] = [];
  const vxVars: number[] = [];
  const vyVars: number[] = [];
  const vzVars: number[] = [];
  const fxVars: number[] = [];
  const fyVars: number[] = [];
  const fzVars: number[] = [];

  // 2. Declare equilibrium coordinates, displacements, velocities, and forces for each C_alpha node
  for (let i = 0; i < n; i++) {
    const atom = caAtoms[i]!;
    const tag = sanitizeId(`${atom.chainId}_${atom.resName}${atom.resSeq}_${i + 1}`);

    const x0Var = dae.addVariable(`x0_${tag}`, VarType.Real, Variability.Parameter, Causality.Local, atom.x);
    dae.addEquation(EqKind.Simple, dae.addName(x0Var), dae.addRealLiteral(atom.x));

    const y0Var = dae.addVariable(`y0_${tag}`, VarType.Real, Variability.Parameter, Causality.Local, atom.y);
    dae.addEquation(EqKind.Simple, dae.addName(y0Var), dae.addRealLiteral(atom.y));

    const z0Var = dae.addVariable(`z0_${tag}`, VarType.Real, Variability.Parameter, Causality.Local, atom.z);
    dae.addEquation(EqKind.Simple, dae.addName(z0Var), dae.addRealLiteral(atom.z));

    const initDisp = i === 0 ? 0.05 : 0.0;
    const ux = dae.addVariable(`ux_${tag}`, VarType.Real, Variability.Continuous, Causality.Local, initDisp);
    const uy = dae.addVariable(`uy_${tag}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const uz = dae.addVariable(`uz_${tag}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    const vx = dae.addVariable(`vx_${tag}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const vy = dae.addVariable(`vy_${tag}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const vz = dae.addVariable(`vz_${tag}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    const fx = dae.addVariable(`Fx_${tag}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const fy = dae.addVariable(`Fy_${tag}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const fz = dae.addVariable(`Fz_${tag}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    uxVars.push(ux);
    uyVars.push(uy);
    uzVars.push(uz);
    vxVars.push(vx);
    vyVars.push(vy);
    vzVars.push(vz);
    fxVars.push(fx);
    fyVars.push(fy);
    fzVars.push(fz);
  }

  // 3. Emit coupled harmonic spring network equations and Langevin oscillator ODEs
  for (let i = 0; i < n; i++) {
    const ux = uxVars[i]!;
    const uy = uyVars[i]!;
    const uz = uzVars[i]!;
    const vx = vxVars[i]!;
    const vy = vyVars[i]!;
    const vz = vzVars[i]!;
    const fx = fxVars[i]!;
    const fy = fyVars[i]!;
    const fz = fzVars[i]!;

    // Kinematic ODEs: der(u) = v
    dae.addEquation(EqKind.Simple, dae.addDer(ux), dae.addName(vx));
    dae.addEquation(EqKind.Simple, dae.addDer(uy), dae.addName(vy));
    dae.addEquation(EqKind.Simple, dae.addDer(uz), dae.addName(vz));

    // Kirchhoff spring restoring forces: F_i = -gamma * sum_j(Gamma_ij * u_j)
    // Since Gamma_ii = deg(i) and Gamma_ij = -1 for bonded neighbors j != i:
    // F_i = gamma * (sum_{j in N(i)} u_j - Gamma_ii * u_i)
    const row = gammaMatrix[i]!;
    const gii = row[i] ?? 0.0;

    let sumNeighborX = dae.addRealLiteral(0.0);
    let sumNeighborY = dae.addRealLiteral(0.0);
    let sumNeighborZ = dae.addRealLiteral(0.0);

    for (let j = 0; j < n; j++) {
      if (j !== i && (row[j] ?? 0.0) < 0.0) {
        sumNeighborX = addAdd(sumNeighborX, dae.addName(uxVars[j]!));
        sumNeighborY = addAdd(sumNeighborY, dae.addName(uyVars[j]!));
        sumNeighborZ = addAdd(sumNeighborZ, dae.addName(uzVars[j]!));
      }
    }

    const netDx = addSub(sumNeighborX, addMul(dae.addRealLiteral(gii), dae.addName(ux)));
    const netDy = addSub(sumNeighborY, addMul(dae.addRealLiteral(gii), dae.addName(uy)));
    const netDz = addSub(sumNeighborZ, addMul(dae.addRealLiteral(gii), dae.addName(uz)));

    dae.addEquation(EqKind.Simple, dae.addName(fx), addMul(dae.addName(gammaVar), netDx));
    dae.addEquation(EqKind.Simple, dae.addName(fy), addMul(dae.addName(gammaVar), netDy));
    dae.addEquation(EqKind.Simple, dae.addName(fz), addMul(dae.addName(gammaVar), netDz));

    // Momentum ODEs: der(v) = F - damping * v
    dae.addEquation(
      EqKind.Simple,
      dae.addDer(vx),
      addSub(dae.addName(fx), addMul(dae.addName(dampVar), dae.addName(vx))),
    );
    dae.addEquation(
      EqKind.Simple,
      dae.addDer(vy),
      addSub(dae.addName(fy), addMul(dae.addName(dampVar), dae.addName(vy))),
    );
    dae.addEquation(
      EqKind.Simple,
      dae.addDer(vz),
      addSub(dae.addName(fz), addMul(dae.addName(dampVar), dae.addName(vz))),
    );
  }

  return dae;
}
