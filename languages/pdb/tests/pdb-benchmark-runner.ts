// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Benchmark runner for Protein Macromolecular Biophysics & Elastic Network DAE (PDB).
 *
 * Evaluates:
 * 1. wwPDB v3.3 atomic coordinates & secondary structures (alpha helix + beta sheet + disulfide bond)
 * 2. Center of mass, molecular weight, and radius of gyration (Rg)
 * 3. Ramachandran dihedral angles and Gaussian Network Model (GNM) Kirchhoff matrix
 * 4. Coarse-grained C-alpha harmonic oscillator state-space lowering into square DAEBuilder arena
 */

import assert from "node:assert/strict";
import {
  parsePdb,
  solveProteinBiophysics,
  lowerPdbToDae,
  type ProteinBiophysicsResult,
} from "../src/index.js";

/**
 * Idealized right-handed alpha-helical polypeptide in wwPDB v3.3 format with disulfide bridge.
 */
export const ALPHA_HELIX_PDB_BENCHMARK = `HEADER    DE NOVO PROTEIN                         01-JAN-26   1HLX
TITLE     IDEALIZED ALPHA HELICAL PEPTIDE WITH DISULFIDE BRIDGE
REMARK   2 RESOLUTION.    1.50 ANGSTROMS.
HELIX    1  H1 CYS A    1  CYS A    5  1                                   5
SHEET    1  S1 1 ALA A   2  GLY A   4  0
SSBOND   1 CYS A    1    CYS A    5                          1555   1555  2.04
ATOM      1  N   CYS A   1       0.000   0.000   0.000  1.00 14.00           N  
ATOM      2  CA  CYS A   1       1.460   0.000   0.000  1.00 14.00           C  
ATOM      3  C   CYS A   1       2.005   1.418   0.000  1.00 14.00           C  
ATOM      4  O   CYS A   1       1.344   2.355  -0.428  1.00 14.00           O  
ATOM      5  SG  CYS A   1      -2.500  -2.500  -2.000  1.00 14.00           S  
ATOM      6  N   ALA A   2       3.266   1.579   0.457  1.00 16.50           N  
ATOM      7  CA  ALA A   2       3.921   2.871   0.449  1.00 16.50           C  
ATOM      8  C   ALA A   2       3.844   3.551  -0.916  1.00 16.50           C  
ATOM      9  O   ALA A   2       4.743   3.447  -1.745  1.00 16.50           O  
ATOM     10  N   LEU A   3       2.753   4.250  -1.127  1.00 19.00           N  
ATOM     11  CA  LEU A   3       2.508   4.974  -2.366  1.00 19.00           C  
ATOM     12  C   LEU A   3       3.385   6.223  -2.421  1.00 19.00           C  
ATOM     13  O   LEU A   3       3.308   7.018  -3.354  1.00 19.00           O  
ATOM     14  N   GLY A   4       4.228   6.377  -1.396  1.00 21.50           N  
ATOM     15  CA  GLY A   4       5.139   7.514  -1.309  1.00 21.50           C  
ATOM     16  C   GLY A   4       4.526   8.784  -0.720  1.00 21.50           C  
ATOM     17  O   GLY A   4       5.127   9.851  -0.816  1.00 21.50           O  
ATOM     18  N   CYS A   5       3.327   8.652  -0.126  1.00 24.00           N  
ATOM     19  CA  CYS A   5       2.610   9.782   0.451  1.00 24.00           C  
ATOM     20  C   CYS A   5       1.947   9.370   1.762  1.00 24.00           C  
ATOM     21  O   CYS A   5       1.478  10.222   2.518  1.00 24.00           O  
ATOM     22  SG  CYS A   5      -2.500  -2.500  -4.040  1.00 24.00           S  
CONECT    5   22
END
`;

export interface PdbBenchmarkMetrics {
  structureId: string;
  format: string;
  atomCount: number;
  residueCount: number;
  chainCount: number;
  molecularWeightDa: number;
  radiusOfGyration: number;
  favoredFraction: number;
  outlierCount: number;
  disulfideBondsCount: number;
  kirchhoffDim: number;
  daeVarCount: number;
  daeEqCount: number;
  isSquare: boolean;
}

export function runPdbBenchmark(pdbStr = ALPHA_HELIX_PDB_BENCHMARK): PdbBenchmarkMetrics {
  const doc = parsePdb(pdbStr);
  assert.equal(doc.id, "1HLX");
  assert.equal(doc.atoms.length, 22);
  assert.equal(doc.residues.length, 5);
  assert.equal(doc.chains.length, 1);
  assert.equal(doc.disulfideBonds.length, 1);

  const bio: ProteinBiophysicsResult = solveProteinBiophysics(doc, {
    cutoffDistance: 7.0,
    springConstant: 1.5,
    temperature: 310.0,
  });

  assert.equal(bio.structureId, "1HLX");
  assert.ok(bio.molecularWeightDa > 250 && bio.molecularWeightDa < 600);
  assert.ok(bio.radiusOfGyration > 2.0 && bio.radiusOfGyration < 8.0);
  assert.equal(bio.kirchhoffMatrix.length, 5);

  // Lower into linear memory DAEBuilder arena
  const dae = lowerPdbToDae(doc, {
    cutoffDistance: 7.0,
    springConstant: 1.5,
    damping: 0.4,
    temperature: 310.0,
  });

  const varCount = dae.varCount;
  const eqCount = dae.eqCount;

  // 5 global vars + 5 residues * 12 = 65 vars & 65 eqs
  assert.equal(varCount, 65);
  assert.equal(eqCount, 65);
  assert.equal(varCount, eqCount);

  return {
    structureId: bio.structureId,
    format: doc.format,
    atomCount: bio.atomCount,
    residueCount: bio.residueCount,
    chainCount: bio.chainCount,
    molecularWeightDa: bio.molecularWeightDa,
    radiusOfGyration: bio.radiusOfGyration,
    favoredFraction: bio.ramachandranFavoredFraction,
    outlierCount: bio.ramachandranOutlierCount,
    disulfideBondsCount: doc.disulfideBonds.length,
    kirchhoffDim: bio.kirchhoffMatrix.length,
    daeVarCount: varCount,
    daeEqCount: eqCount,
    isSquare: varCount === eqCount,
  };
}

if (process.argv[1]?.endsWith("pdb-benchmark-runner.ts")) {
  const m = runPdbBenchmark();
  console.log("PDB Benchmark Results:", m);
}
