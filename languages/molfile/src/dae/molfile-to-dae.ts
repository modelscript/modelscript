// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/molfile — Direct Linear-Memory DAE Arena Lowering for Harmonic Molecular Mechanics.
 *
 * Compiles 3D atomic coordinates, UFF/harmonic bond-stretch equilibrium lengths r0,
 * force constants kb, Euclidean bond length equations r = sqrt((x2-x1)^2 + (y2-y1)^2 + (z2-z1)^2),
 * and harmonic bond-stretch potential energy E_stretch = sum(0.5 * kb * (r - r0)^2)
 * directly into ModelScript's zero-GC `DAEBuilder`.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { analyzeMolRecord } from "../solver/index.js";
import type { MolfileDocument, MolRecord } from "../types.js";

export interface MolfileDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  /** Optional record index to lower when passing a multi-record `MolfileDocument` (default: all records). */
  recordIndex?: number | undefined;
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
  if (out.length === 0) return "Molecule";
  const firstCode = out.charCodeAt(0);
  if (firstCode >= 48 && firstCode <= 57) return `M_${out}`;
  return out;
}

function isMolfileDocument(input: MolfileDocument | MolRecord): input is MolfileDocument {
  return "records" in input && Array.isArray(input.records);
}

/**
 * Lowers one or more `MolRecord` structures into harmonic molecular mechanics DAE equations
 * inside `@modelscript/runtime`'s linear-memory `DAEBuilder`.
 */
export function lowerMolfileToDae(input: MolfileDocument | MolRecord, options?: MolfileDaeOptions): DAEBuilder {
  const allRecords: MolRecord[] = isMolfileDocument(input) ? input.records : [input];
  const records: MolRecord[] =
    options?.recordIndex !== undefined && allRecords[options.recordIndex] !== undefined
      ? [allRecords[options.recordIndex]!]
      : allRecords;

  const firstRec = records[0];
  const rawName = options?.modelName ?? firstRec?.name ?? "MolfileMechanicsSystem";
  const modelName = sanitizeId(rawName);
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  const addAdd = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Add, a, b);
  const addSub = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Sub, a, b);
  const addMul = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Mul, a, b);
  const addPow = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Pow, a, b);

  for (let recIdx = 0; recIdx < records.length; recIdx++) {
    const rec = records[recIdx]!;
    const analysis = analyzeMolRecord(rec);
    const prefix =
      records.length === 1 ? sanitizeId(rec.name || rec.id) : `${sanitizeId(rec.name || rec.id)}_${recIdx + 1}`;

    // Molecular-level scalar parameters
    const mwVar = dae.addVariable(
      `${prefix}_MW`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      analysis.molecularWeight,
    );
    dae.addEquation(EqKind.Simple, dae.addName(mwVar), dae.addRealLiteral(analysis.molecularWeight));

    const exactVar = dae.addVariable(
      `${prefix}_ExactMass`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      analysis.exactMass,
    );
    dae.addEquation(EqKind.Simple, dae.addName(exactVar), dae.addRealLiteral(analysis.exactMass));

    const ringVar = dae.addVariable(
      `${prefix}_RingCount`,
      VarType.Integer,
      Variability.Parameter,
      Causality.Local,
      analysis.ringCount,
    );
    dae.addEquation(EqKind.Simple, dae.addName(ringVar), dae.addIntLiteral(analysis.ringCount));

    // Atom 3D coordinate variables (x_i, y_i, z_i)
    const coordVars = new Map<number, { x: number; y: number; z: number }>();
    for (const atom of rec.atoms) {
      const xVar = dae.addVariable(
        `${prefix}_x_${atom.index}`,
        VarType.Real,
        Variability.Parameter,
        Causality.Local,
        atom.x,
      );
      const yVar = dae.addVariable(
        `${prefix}_y_${atom.index}`,
        VarType.Real,
        Variability.Parameter,
        Causality.Local,
        atom.y,
      );
      const zVar = dae.addVariable(
        `${prefix}_z_${atom.index}`,
        VarType.Real,
        Variability.Parameter,
        Causality.Local,
        atom.z,
      );
      dae.addEquation(EqKind.Simple, dae.addName(xVar), dae.addRealLiteral(atom.x));
      dae.addEquation(EqKind.Simple, dae.addName(yVar), dae.addRealLiteral(atom.y));
      dae.addEquation(EqKind.Simple, dae.addName(zVar), dae.addRealLiteral(atom.z));
      coordVars.set(atom.index, { x: xVar, y: yVar, z: zVar });
    }

    // Per-bond Euclidean distance & harmonic stretch energy equations:
    //   r_k = ((x_j - x_i)^2 + (y_j - y_i)^2 + (z_j - z_i)^2)^0.5
    //   E_k = 0.5 * kb_k * (r_k - r0_k)^2
    const bondEnergyVarIds: number[] = [];
    for (const bg of analysis.bondGeometries) {
      const c1 = coordVars.get(bg.atom1);
      const c2 = coordVars.get(bg.atom2);
      if (!c1 || !c2) continue;

      const bTag = `${prefix}_b${bg.bondIndex}`;
      const r0Var = dae.addVariable(
        `${bTag}_r0`,
        VarType.Real,
        Variability.Parameter,
        Causality.Local,
        bg.equilibriumLength,
      );
      dae.addEquation(EqKind.Simple, dae.addName(r0Var), dae.addRealLiteral(bg.equilibriumLength));

      const kbVar = dae.addVariable(
        `${bTag}_kb`,
        VarType.Real,
        Variability.Parameter,
        Causality.Local,
        bg.forceConstant,
      );
      dae.addEquation(EqKind.Simple, dae.addName(kbVar), dae.addRealLiteral(bg.forceConstant));

      const rVar = dae.addVariable(`${bTag}_r`, VarType.Real, Variability.Continuous, Causality.Local, bg.length);
      const dx = addSub(dae.addName(c2.x), dae.addName(c1.x));
      const dy = addSub(dae.addName(c2.y), dae.addName(c1.y));
      const dz = addSub(dae.addName(c2.z), dae.addName(c1.z));
      const distSq = addAdd(
        addAdd(addPow(dx, dae.addRealLiteral(2.0)), addPow(dy, dae.addRealLiteral(2.0))),
        addPow(dz, dae.addRealLiteral(2.0)),
      );
      const rExpr = addPow(distSq, dae.addRealLiteral(0.5));
      dae.addEquation(EqKind.Simple, dae.addName(rVar), rExpr);

      const eVar = dae.addVariable(
        `${bTag}_E_stretch`,
        VarType.Real,
        Variability.Continuous,
        Causality.Local,
        bg.stretchEnergy,
      );
      const dr = addSub(dae.addName(rVar), dae.addName(r0Var));
      const drSq = addPow(dr, dae.addRealLiteral(2.0));
      const eExpr = addMul(addMul(dae.addRealLiteral(0.5), dae.addName(kbVar)), drSq);
      dae.addEquation(EqKind.Simple, dae.addName(eVar), eExpr);

      bondEnergyVarIds.push(eVar);
    }

    // Total harmonic bond-stretch potential energy equation
    const totalEVar = dae.addVariable(
      `${prefix}_E_stretch_total`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      analysis.totalStretchEnergy,
    );
    if (bondEnergyVarIds.length === 0) {
      dae.addEquation(EqKind.Simple, dae.addName(totalEVar), dae.addRealLiteral(0.0));
    } else {
      let sumExpr = dae.addName(bondEnergyVarIds[0]!);
      for (let i = 1; i < bondEnergyVarIds.length; i++) {
        sumExpr = addAdd(sumExpr, dae.addName(bondEnergyVarIds[i]!));
      }
      dae.addEquation(EqKind.Simple, dae.addName(totalEVar), sumExpr);
    }
  }

  return dae;
}
