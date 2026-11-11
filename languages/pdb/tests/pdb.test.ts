// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert/strict";
import test from "node:test";
import {
  PdbErrorCode,
  computeDihedralAngle,
  computeRamachandranAngles,
  executePdbAction,
  findPdbDefinition,
  getPdbDocument,
  getPdbDocumentSymbols,
  getPdbHover,
  lintPdb,
  lowerPdbToDae,
  parseMmCif,
  parsePdb,
  pdbLanguage,
  pdbToModelica,
  providePdbCompletions,
  serializePdb,
  solveProteinBiophysics,
  validatePdb,
} from "../src/index.js";

/**
 * Generates an idealized right-handed alpha-helical polypeptide in wwPDB v3.3 format
 * with exact bond lengths (N-CA = 1.46 Å, CA-C = 1.52 Å, C-N = 1.33 Å, C=O = 1.23 Å)
 * and canonical alpha-helical Ramachandran angles (phi ≈ -60°, psi ≈ -45°, omega = 180°).
 */
function buildIdealHelixPdb(): string {
  // Build backbone atoms using NeRF (Natural Extension Reference Frame) internal coordinates
  const residues = ["CYS", "ALA", "LEU", "GLY", "CYS"];
  const phiDeg = -60.0;
  const psiDeg = -45.0;
  const omegaDeg = 180.0;

  // Bond lengths [Å] and bond angles [deg]
  const rNCa = 1.46;
  const rCaC = 1.52;
  const rCN = 1.33;
  const rCO = 1.23;

  const angNCaC = (111.0 * Math.PI) / 180.0;
  const angCaCN = (116.0 * Math.PI) / 180.0;
  const angCNO = (121.0 * Math.PI) / 180.0;
  const angCNCa = (122.0 * Math.PI) / 180.0;

  type Vec3 = { x: number; y: number; z: number };
  const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
  const scale = (v: Vec3, s: number): Vec3 => ({ x: v.x * s, y: v.y * s, z: v.z * s });
  const cross = (a: Vec3, b: Vec3): Vec3 => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  });
  const norm = (v: Vec3): Vec3 => {
    const l = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1.0;
    return { x: v.x / l, y: v.y / l, z: v.z / l };
  };

  // Place D given A, B, C, bond length rCD, angle BCD (rad), and dihedral ABCD (deg)
  const nerfPlace = (A: Vec3, B: Vec3, C: Vec3, rCD: number, angleBCD: number, dihedralDeg: number): Vec3 => {
    const bc = norm(sub(C, B));
    const ab = norm(sub(B, A));
    const n = norm(cross(ab, bc));
    const m = cross(n, bc);
    const theta = Math.PI - angleBCD;
    const phi = (dihedralDeg * Math.PI) / 180.0;
    const dx = rCD * Math.cos(theta);
    const dy = rCD * Math.sin(theta) * Math.cos(phi);
    const dz = rCD * Math.sin(theta) * Math.sin(phi);
    return add(C, add(scale(bc, dx), add(scale(m, dy), scale(n, dz))));
  };

  // Seed first residue N1, CA1, C1
  const N1: Vec3 = { x: 0.0, y: 0.0, z: 0.0 };
  const CA1: Vec3 = { x: rNCa, y: 0.0, z: 0.0 };
  const C1: Vec3 = {
    x: rNCa - rCaC * Math.cos(angNCaC),
    y: rCaC * Math.sin(angNCaC),
    z: 0.0,
  };

  const backbone: Array<{ resName: string; resSeq: number; N: Vec3; CA: Vec3; C: Vec3; O: Vec3 }> = [];
  let prevN = N1;
  let prevCA = CA1;
  let prevC = C1;

  for (let i = 0; i < residues.length; i++) {
    const resName = residues[i]!;
    const resSeq = i + 1;
    let curN: Vec3;
    let curCA: Vec3;
    let curC: Vec3;

    if (i === 0) {
      curN = N1;
      curCA = CA1;
      curC = C1;
    } else {
      curN = nerfPlace(prevN, prevCA, prevC, rCN, angCaCN, psiDeg);
      curCA = nerfPlace(prevCA, prevC, curN, rNCa, angCNCa, omegaDeg);
      curC = nerfPlace(prevC, curN, curCA, rCaC, angNCaC, phiDeg);
    }
    const curO = nerfPlace(curN, curCA, curC, rCO, angCNO, 135.0);
    backbone.push({ resName, resSeq, N: curN, CA: curCA, C: curC, O: curO });
    prevN = curN;
    prevCA = curCA;
    prevC = curC;
  }

  const lines: string[] = [
    "HEADER    DE NOVO PROTEIN                         01-JAN-26   1HLX",
    "TITLE     IDEALIZED ALPHA HELICAL PEPTIDE WITH DISULFIDE BRIDGE",
    "REMARK   2 RESOLUTION.    1.50 ANGSTROMS.",
    "HELIX    1  H1 CYS A    1  CYS A    5  1                                   5",
    "SHEET    1  S1 1 ALA A   2  GLY A   4  0",
    "SSBOND   1 CYS A    1    CYS A    5                          1555   1555  2.04",
  ];

  let serial = 1;
  const formatAtom = (name: string, resName: string, resSeq: number, p: Vec3, bVal: number, elem: string): string => {
    const s = String(serial++).padStart(5, " ");
    const nField = name.length === 4 ? name : ` ${name.padEnd(3, " ")}`;
    const rField = resName.padStart(3, " ");
    const seqField = String(resSeq).padStart(4, " ");
    const xField = p.x.toFixed(3).padStart(8, " ");
    const yField = p.y.toFixed(3).padStart(8, " ");
    const zField = p.z.toFixed(3).padStart(8, " ");
    const occField = "  1.00";
    const bField = bVal.toFixed(2).padStart(6, " ");
    const eField = elem.padStart(2, " ");
    return `ATOM  ${s} ${nField} ${rField} A${seqField}    ${xField}${yField}${zField}${occField}${bField}          ${eField}  `;
  };

  // Place SG atoms on CYS1 and CYS5 separated by 2.04 Å (disulfide bridge) away from backbone
  const sg1: Vec3 = { x: -2.5, y: -2.5, z: -2.0 };
  const sg5: Vec3 = { x: -2.5, y: -2.5, z: -4.04 };

  for (let i = 0; i < backbone.length; i++) {
    const b = backbone[i]!;
    const bFactor = 14.0 + i * 2.5;
    lines.push(formatAtom("N", b.resName, b.resSeq, b.N, bFactor, "N"));
    lines.push(formatAtom("CA", b.resName, b.resSeq, b.CA, bFactor, "C"));
    lines.push(formatAtom("C", b.resName, b.resSeq, b.C, bFactor, "C"));
    lines.push(formatAtom("O", b.resName, b.resSeq, b.O, bFactor, "O"));
    if (b.resSeq === 1) {
      lines.push(formatAtom("SG", b.resName, b.resSeq, sg1, bFactor, "S"));
    }
    if (b.resSeq === 5) {
      lines.push(formatAtom("SG", b.resName, b.resSeq, sg5, bFactor, "S"));
    }
  }

  // CONECT between CYS1.SG (serial 5) and CYS5.SG (serial 22)
  lines.push("CONECT    5   22");
  lines.push("END");
  return lines.join("\n");
}

const IDEAL_HELIX_PDB = buildIdealHelixPdb();

const SAMPLE_MMCIF = `data_1CRN
_entry.id 1CRN
_struct.title 'CRAMBIN AT 0.83 ANGSTROMS RESOLUTION'
_struct_keywords.pdbx_keywords 'PLANT PROTEIN'
_refine.ls_d_res_high 0.83
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_alt_id
_atom_site.label_comp_id
_atom_site.auth_asym_id
_atom_site.auth_seq_id
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
_atom_site.occupancy
_atom_site.B_iso_or_equiv
ATOM 1 N  N  . THR A 1 17.047 14.099 3.625 1.00 13.79
ATOM 2 C  CA . THR A 1 16.967 12.784 4.338 1.00 10.80
ATOM 3 C  C  . THR A 1 15.685 12.755 5.133 1.00 9.19
ATOM 4 O  O  . THR A 1 15.268 13.825 5.594 1.00 9.85
ATOM 5 N  N  . THR A 2 15.115 11.555 5.265 1.00 7.81
ATOM 6 C  CA . THR A 2 13.856 11.469 6.066 1.00 8.31
ATOM 7 C  C  . THR A 2 14.164 10.785 7.379 1.00 5.80
ATOM 8 O  O  . THR A 2 14.993 9.862  7.443 1.00 6.94
HETATM 9 O O . HOH A 101 22.000 18.000 10.000 1.00 25.00
`;

test("PDB & mmCIF Parser: parses wwPDB v3.3 records, mmCIF _atom_site loops, and round-trip serializes", () => {
  const doc = parsePdb(IDEAL_HELIX_PDB);
  assert.equal(doc.id, "1HLX");
  assert.equal(doc.format, "pdb");
  assert.equal(doc.classification, "DE NOVO PROTEIN");
  assert.equal(doc.resolution, 1.5);
  assert.equal(doc.atoms.length, 22);
  assert.equal(doc.residues.length, 5);
  assert.equal(doc.chains.length, 1);
  assert.equal(doc.chains[0]?.sequence, "CALGC");
  assert.equal(doc.secondaryStructures.length, 2);
  assert.equal(doc.secondaryStructures[0]?.kind, "helix");
  assert.equal(doc.secondaryStructures[1]?.kind, "sheet");
  assert.equal(doc.disulfideBonds.length, 1);
  assert.equal(doc.conectRecords.length, 1);
  assert.deepEqual(doc.conectRecords[0]?.bondedSerials, [22]);

  // Round-trip serialization
  const serialized = serializePdb(doc);
  const reparsed = parsePdb(serialized);
  assert.equal(reparsed.id, "1HLX");
  assert.equal(reparsed.atoms.length, 22);
  assert.equal(reparsed.chains[0]?.sequence, "CALGC");
  assert.equal(reparsed.disulfideBonds.length, 1);

  // mmCIF parsing via parseMmCif and auto-detected parsePdb
  const cifDoc = parseMmCif(SAMPLE_MMCIF);
  assert.equal(cifDoc.id, "1CRN");
  assert.equal(cifDoc.format, "mmcif");
  assert.equal(cifDoc.title, "CRAMBIN AT 0.83 ANGSTROMS RESOLUTION");
  assert.equal(cifDoc.resolution, 0.83);
  assert.equal(cifDoc.atoms.length, 8);
  assert.equal(cifDoc.hetAtoms.length, 1);
  assert.equal(cifDoc.chains[0]?.sequence, "TT");

  const autoCif = parsePdb(SAMPLE_MMCIF);
  assert.equal(autoCif.format, "mmcif");
  assert.equal(autoCif.id, "1CRN");
});

test("PDB Linter: validates clean structure and triggers all 10 diagnostic error codes (M9251 - M9260)", () => {
  // Clean idealized alpha helix has 0 lint diagnostics
  const cleanDiags = lintPdb(IDEAL_HELIX_PDB);
  assert.equal(cleanDiags.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(cleanDiags)}`);

  // M9251: Steric clash (non-bonded distance < 1.2 Å)
  const m9251Text = `${IDEAL_HELIX_PDB.replace("END", "")}
HETATM   99  O   HOH A  99       0.000   0.000   0.500  1.00 15.00           O  
END`;
  const m9251Diags = lintPdb(m9251Text);
  assert.ok(m9251Diags.some((d) => d.code === PdbErrorCode.STERIC_CLASH.code));

  // M9252: Broken peptide backbone (consecutive C_i -- N_{i+1} distance > 2.0 Å)
  const brokenBackbonePdb = `HEADER    BROKEN                                  01-JAN-26   1BRK
ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00 15.00           N  
ATOM      2  CA  ALA A   1       1.460   0.000   0.000  1.00 15.00           C  
ATOM      3  C   ALA A   1       2.500   1.100   0.000  1.00 15.00           C  
ATOM      4  N   ALA A   2      10.000  10.000  10.000  1.00 15.00           N  
ATOM      5  CA  ALA A   2      11.460  10.000  10.000  1.00 15.00           C  
ATOM      6  C   ALA A   2      12.500  11.100  10.000  1.00 15.00           C  
END`;
  const m9252Diags = lintPdb(brokenBackbonePdb);
  assert.ok(m9252Diags.some((d) => d.code === PdbErrorCode.BROKEN_PEPTIDE_BACKBONE.code));

  // M9253: Invalid occupancy (< 0.0 or > 1.0)
  const invalidOccPdb = `HEADER    OCC                                     01-JAN-26   1OCC
ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.50 15.00           N  
ATOM      2  CA  ALA A   1       1.460   0.000   0.000  1.00 15.00           C  
ATOM      3  C   ALA A   1       2.500   1.100   0.000  1.00 15.00           C  
END`;
  const m9253Diags = lintPdb(invalidOccPdb);
  assert.ok(m9253Diags.some((d) => d.code === PdbErrorCode.INVALID_OCCUPANCY.code));

  // M9254: Non-positive B-factor (B <= 0.0)
  const nonPosBPdb = `HEADER    BFAC                                    01-JAN-26   1BFC
ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00  0.00           N  
ATOM      2  CA  ALA A   1       1.460   0.000   0.000  1.00 15.00           C  
ATOM      3  C   ALA A   1       2.500   1.100   0.000  1.00 15.00           C  
END`;
  const m9254Diags = lintPdb(nonPosBPdb);
  assert.ok(m9254Diags.some((d) => d.code === PdbErrorCode.NON_POSITIVE_B_FACTOR.code));

  // M9255: Ramachandran outlier (non-Gly/non-Pro residue with phi=0°, psi=0° eclipsed cis conformation)
  const ramaOutlierPdb = `HEADER    RAMA                                    01-JAN-26   1RAM
ATOM      1  N   ALA A   1      -1.330   1.460   0.000  1.00 15.00           N  
ATOM      2  CA  ALA A   1      -1.330   0.000   0.000  1.00 15.00           C  
ATOM      3  C   ALA A   1       0.000   0.000   0.000  1.00 15.00           C  
ATOM      4  N   ALA A   2       0.000   1.330   0.000  1.00 15.00           N  
ATOM      5  CA  ALA A   2       1.460   1.330   0.000  1.00 15.00           C  
ATOM      6  C   ALA A   2       1.460   0.000   0.000  1.00 15.00           C  
ATOM      7  N   ALA A   3       2.790   0.000   0.000  1.00 15.00           N  
ATOM      8  CA  ALA A   3       2.790   1.460   0.000  1.00 15.00           C  
ATOM      9  C   ALA A   3       4.120   1.460   0.000  1.00 15.00           C  
END`;
  const m9255Diags = lintPdb(ramaOutlierPdb);
  assert.ok(m9255Diags.some((d) => d.code === PdbErrorCode.RAMACHANDRAN_OUTLIER.code));

  // M9256: Missing backbone atoms (ALA missing CA and C)
  const missingBackbonePdb = `HEADER    MISS                                    01-JAN-26   1MIS
ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00 15.00           N  
END`;
  const m9256Diags = lintPdb(missingBackbonePdb);
  assert.ok(m9256Diags.some((d) => d.code === PdbErrorCode.MISSING_BACKBONE_ATOMS.code));

  // M9257: Invalid disulfide distance (SG-SG distance 5.0 Å outside [1.8, 2.5] Å)
  const badSsbondPdb = `HEADER    SSB                                     01-JAN-26   1SSB
SSBOND   1 CYS A    1    CYS A    2                          1555   1555  5.00
ATOM      1  N   CYS A   1       0.000   0.000   0.000  1.00 15.00           N  
ATOM      2  CA  CYS A   1       1.460   0.000   0.000  1.00 15.00           C  
ATOM      3  C   CYS A   1       2.500   1.100   0.000  1.00 15.00           C  
ATOM      4  SG  CYS A   1       0.000  -2.000   0.000  1.00 15.00           S  
ATOM      5  N   CYS A   2       3.800   1.100   0.000  1.00 15.00           N  
ATOM      6  CA  CYS A   2       4.800   2.100   0.000  1.00 15.00           C  
ATOM      7  C   CYS A   2       6.000   2.100   0.000  1.00 15.00           C  
ATOM      8  SG  CYS A   2       5.000  -2.000   0.000  1.00 15.00           S  
END`;
  const m9257Diags = lintPdb(badSsbondPdb);
  assert.ok(m9257Diags.some((d) => d.code === PdbErrorCode.INVALID_DISULFIDE_DISTANCE.code));

  // M9258: Unresolved CONECT serial
  const badConectPdb = `HEADER    CON                                     01-JAN-26   1CON
ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00 15.00           N  
ATOM      2  CA  ALA A   1       1.460   0.000   0.000  1.00 15.00           C  
ATOM      3  C   ALA A   1       2.500   1.100   0.000  1.00 15.00           C  
CONECT    1  999
END`;
  const m9258Diags = lintPdb(badConectPdb);
  assert.ok(m9258Diags.some((d) => d.code === PdbErrorCode.UNRESOLVED_CONECT_SERIAL.code));

  // M9259: Duplicate atom serial
  const dupSerialPdb = `HEADER    DUP                                     01-JAN-26   1DUP
ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00 15.00           N  
ATOM      1  CA  ALA A   1       1.460   0.000   0.000  1.00 15.00           C  
ATOM      3  C   ALA A   1       2.500   1.100   0.000  1.00 15.00           C  
END`;
  const m9259Diags = lintPdb(dupSerialPdb);
  assert.ok(m9259Diags.some((d) => d.code === PdbErrorCode.DUPLICATE_ATOM_SERIAL.code));

  // M9260: Empty PDB structure
  const emptyPdb = `HEADER    EMPTY                                   01-JAN-26   0EMP\nEND`;
  const m9260Diags = lintPdb(emptyPdb);
  assert.ok(m9260Diags.some((d) => d.code === PdbErrorCode.EMPTY_PDB_STRUCTURE.code));
});

test("Protein Biophysics & GNM Solver: computes Rg, Ramachandran angles, Kirchhoff matrix, and B-factors", () => {
  // Verify exact 3D dihedral angle calculation
  const d90 = computeDihedralAngle(
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 1, z: 1 },
  );
  assert.ok(Math.abs(d90 - 90.0) < 1e-6);

  const rama = computeRamachandranAngles(parsePdb(IDEAL_HELIX_PDB));
  assert.equal(rama.length, 5);
  // Internal residue 2 (ALA2) should have phi ≈ -60°, psi ≈ -45° in favored_alpha
  const rama1 = rama[1];
  assert.ok(rama1 && rama1.phi !== null && Math.abs(rama1.phi - -60.0) < 0.5);
  assert.ok(rama1 && rama1.psi !== null && Math.abs(rama1.psi - -45.0) < 0.5);
  assert.equal(rama1?.region, "favored_alpha");

  const bio = solveProteinBiophysics(IDEAL_HELIX_PDB, {
    cutoffDistance: 7.0,
    springConstant: 1.0,
    temperature: 300.0,
  });

  assert.equal(bio.structureId, "1HLX");
  assert.equal(bio.atomCount, 22);
  assert.equal(bio.residueCount, 5);
  assert.equal(bio.chainCount, 1);
  assert.ok(bio.molecularWeightDa > 250 && bio.molecularWeightDa < 400);
  assert.ok(bio.radiusOfGyration > 2.5 && bio.radiusOfGyration < 6.0);
  assert.equal(bio.ramachandranFavoredFraction, 1.0);
  assert.equal(bio.ramachandranOutlierCount, 0);

  // Kirchhoff matrix properties: N x N symmetric, non-negative diagonal, row sums == 0
  assert.equal(bio.kirchhoffMatrix.length, 5);
  for (let i = 0; i < 5; i++) {
    const row = bio.kirchhoffMatrix[i]!;
    const rowSum = row.reduce((acc, v) => acc + v, 0.0);
    assert.ok(Math.abs(rowSum) < 1e-9, `Expected Kirchhoff row sum 0, got ${rowSum}`);
    assert.ok(row[i]! > 0, "Expected connected C_alpha coordination > 0");
  }

  assert.equal(bio.predictedFluctuations.length, 5);
  assert.ok(bio.predictedFluctuations.every((msf) => msf > 0));
  assert.equal(bio.predictedBFactors.length, 5);
  assert.ok(bio.predictedBFactors.every((b) => b > 0));
});

test("PDB DAE Lowering & Modelica Projection: compiles C_alpha elastic network ODEs into square DAEBuilder", () => {
  const dae = lowerPdbToDae(IDEAL_HELIX_PDB, {
    cutoffDistance: 7.0,
    springConstant: 1.5,
    damping: 0.4,
    temperature: 310.0,
  });

  // 5 global parameters + 5 residues * 12 variables (3 x0 + 3 u + 3 v + 3 F) = 65 variables & 65 equations
  assert.equal(dae.variables().length, 65);
  assert.equal(dae.variables().length, dae.equations().length, "Expected structurally square DAE (N_vars == N_eqs)");
  assert.notEqual(dae.lookupVariable("T"), -1);
  assert.notEqual(dae.lookupVariable("gamma"), -1);
  assert.notEqual(dae.lookupVariable("Rg"), -1);
  assert.notEqual(dae.lookupVariable("MW"), -1);
  assert.notEqual(dae.lookupVariable("ux_A_CYS1_1"), -1);
  assert.notEqual(dae.lookupVariable("Fx_A_CYS1_1"), -1);

  const mo = pdbToModelica(IDEAL_HELIX_PDB, "HelixElasticModel");
  assert.ok(mo.includes("model HelixElasticModel"));
  assert.ok(mo.includes('parameter Real Rg(unit = "angstrom")'));
  assert.ok(mo.includes("der(ux_A_CYS1_1) = vx_A_CYS1_1;"));
  assert.ok(mo.includes("der(vx_A_CYS1_1) = Fx_A_CYS1_1 - damping * vx_A_CYS1_1;"));
  assert.ok(mo.includes("end HelixElasticModel;"));
});

test("PDB UnifiedWorkspace & LSP: indexes chains/residues, hover cards, completions, and actions", async () => {
  const ws = new UnifiedWorkspace(pdbLanguage);
  const uri = "file:///structures/1hlx.pdb";
  ws.setDocument(uri, IDEAL_HELIX_PDB);

  assert.equal(ws.fileCount, 1);
  assert.equal(getPdbDocument(ws, uri)?.id, "1HLX");
  const rootSym = findPdbDefinition(ws, "1HLX");
  assert.ok(rootSym);
  assert.equal(rootSym.metadata?.["chainCount"], 1);

  const chainSym = findPdbDefinition(ws, "Chain_A");
  assert.ok(chainSym);
  assert.equal(chainSym.metadata?.["sequence"], "CALGC");

  const docSymbols = getPdbDocumentSymbols(IDEAL_HELIX_PDB);
  assert.equal(docSymbols.length, 1);
  assert.equal(docSymbols[0]?.children?.length, 1);
  assert.equal(docSymbols[0]?.children?.[0]?.children?.length, 5);

  const hover = getPdbHover(IDEAL_HELIX_PDB, { line: 10, character: 5 });
  assert.ok(hover);
  assert.ok(hover.contents.value.includes("1HLX"));
  assert.ok(hover.contents.value.includes("Radius of Gyration"));

  const completions = providePdbCompletions();
  assert.ok(completions.length >= 5);

  const diags = validatePdb("HEADER    EMPTY                                   01-JAN-26   0EMP\nEND");
  assert.equal(diags.length, 1);
  assert.equal(diags[0]?.code, "M9260");

  const bioAction = await executePdbAction("pdb_solve_biophysics", IDEAL_HELIX_PDB);
  assert.equal(bioAction.structureId, "1HLX");
  assert.equal(bioAction.caAtoms.length, 5);

  const daeAction = await executePdbAction("pdb_to_dae", IDEAL_HELIX_PDB);
  assert.equal(daeAction.variableCount, 65);
  assert.equal(daeAction.equationCount, 65);

  assert.equal(pdbLanguage.name, "pdb");
  assert.ok(pdbLanguage.fileExtensions?.includes(".pdb"));
  assert.ok(pdbLanguage.fileExtensions?.includes(".cif"));
});
