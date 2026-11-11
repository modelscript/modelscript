// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert/strict";
import test from "node:test";
import {
  SmilesErrorCode,
  estimateThermophysicalProperties,
  executeSmilesAction,
  getSmilesDocumentSymbols,
  getSmilesHover,
  lintSmiles,
  lowerSmilesToDae,
  parseMolfile,
  parseSdf,
  parseSmiles,
  parseSmilesDocument,
  provideSmilesCompletions,
  serializeSmiles,
  smilesLanguage,
  smilesToAspenComponent,
  smilesToAspenDeck,
  smilesToModelica,
  solveMolecularProperties,
  validateSmiles,
} from "../src/index.js";

const ASPIRIN_SMILES = "CC(=O)Oc1ccccc1C(=O)O";
const CAFFEINE_SMILES = "Cn1cnc2c1c(=O)n(C)c(=O)n2C";
const BENZENE_SMILES = "c1ccccc1";
const ETHANOL_SMILES = "CCO";

const BENZENE_MOLFILE = `Benzene
  ModelScript01012612002D

  6  6  0  0  0  0  0  0  0  0999 V2000
    1.2124    0.7000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    1.2124   -0.7000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    0.0000   -1.4000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
   -1.2124   -0.7000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
   -1.2124    0.7000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    0.0000    1.4000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  4  0  0  0  0
  2  3  4  0  0  0  0
  3  4  4  0  0  0  0
  4  5  4  0  0  0  0
  5  6  4  0  0  0  0
  6  1  4  0  0  0  0
M  END`;

const MULTI_RECORD_SDF = `${BENZENE_MOLFILE}
> <FORMULA>
C6H6

> <CAS>
71-43-2

$$$$
Ethanol
  ModelScript01012612002D

  3  2  0  0  0  0  0  0  0  0999 V2000
    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    1.5000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    2.5000    1.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0  0  0  0
  2  3  1  0  0  0  0
M  END
> <FORMULA>
C2H6O

$$$$`;

test("SMILES Parser: parses organic subset, branches, bonds, isotopes, charges, chirality, and %10+ rings", () => {
  // Bracketed isotopes, charges, and chirality
  const c13Methane = parseSmiles("[13CH4]", "Carbon13Methane");
  assert.equal(c13Methane.atoms.length, 1);
  assert.equal(c13Methane.atoms[0]?.element, "C");
  assert.equal(c13Methane.atoms[0]?.isotope, 13);
  assert.equal(c13Methane.atoms[0]?.explicitHydrogens, 4);
  assert.equal(c13Methane.atoms[0]?.implicitHydrogens, 0);

  // Disconnected ionic salt [NH4+].[O-]C(=O)C
  const ammoniumAcetate = parseSmiles("[NH4+].[O-]C(=O)C", "AmmoniumAcetate");
  assert.equal(ammoniumAcetate.atoms.length, 5);
  assert.equal(ammoniumAcetate.atoms[0]?.formalCharge, 1);
  assert.equal(ammoniumAcetate.atoms[0]?.explicitHydrogens, 4);
  assert.equal(ammoniumAcetate.atoms[1]?.formalCharge, -1);

  // Tetrahedral chiral L-Alanine N[C@@H](C)C(=O)O
  const lAlanine = parseSmiles("N[C@@H](C)C(=O)O", "L_Alanine");
  assert.equal(lAlanine.atoms[1]?.chiralTag, "@@");
  assert.equal(lAlanine.atoms[1]?.explicitHydrogens, 1);
  assert.equal(lintSmiles(lAlanine).length, 0);

  // Two-digit ring closure %10
  const cyclohexane10 = parseSmiles("C%10CCCCC%10", "Cyclohexane10");
  assert.equal(cyclohexane10.atoms.length, 6);
  assert.equal(cyclohexane10.bonds.length, 6);
  assert.equal(lintSmiles(cyclohexane10).length, 0);

  // Multi-line .smi document
  const smiDoc = parseSmilesDocument(`
# Canonical benchmark library
${ASPIRIN_SMILES} Aspirin
${CAFFEINE_SMILES} Caffeine
${BENZENE_SMILES} Benzene
${ETHANOL_SMILES} Ethanol
`);
  assert.equal(smiDoc.molecules.length, 4);
  assert.equal(smiDoc.molecules[0]?.name, "Aspirin");
  assert.equal(smiDoc.molecules[1]?.name, "Caffeine");
  assert.equal(smiDoc.molecules[2]?.name, "Benzene");
  assert.equal(smiDoc.molecules[3]?.name, "Ethanol");

  // Roundtrip serializer
  const serialized = serializeSmiles(smiDoc.molecules[3]!);
  const reparsed = parseSmiles(serialized, "EthanolRoundtrip");
  assert.equal(estimateThermophysicalProperties(reparsed).formula, "C2H6O");
});

test("MDL Molfile V2000 & SDF Parser: parses connection tables, aromatic bonds, and SDF data fields", () => {
  const mol = parseMolfile(BENZENE_MOLFILE);
  assert.equal(mol.name, "Benzene");
  assert.equal(mol.atoms.length, 6);
  assert.equal(mol.bonds.length, 6);
  assert.ok(mol.atoms.every((a) => a.isAromatic && a.implicitHydrogens === 1));

  const est = estimateThermophysicalProperties(mol);
  assert.equal(est.formula, "C6H6");
  assert.ok(Math.abs(est.molecularWeight - 78.114) < 0.01);
  assert.equal(est.ringCount, 1);
  assert.equal(est.aromaticRingCount, 1);

  const sdfRecords = parseSdf(MULTI_RECORD_SDF);
  assert.equal(sdfRecords.length, 2);
  assert.equal(sdfRecords[0]?.properties.get("CAS"), "71-43-2");
  assert.equal(sdfRecords[1]?.name, "Ethanol");
  assert.equal(estimateThermophysicalProperties(sdfRecords[1]!).formula, "C2H6O");
});

test("Cheminformatics & Joback Estimator: exact formula, molar mass, rings, TPSA, logP, and critical properties", () => {
  // 1. Aspirin (C9H8O4, MW = 180.159 g/mol, R = 1, TPSA = 63.60 A^2)
  const aspirin = parseSmiles(ASPIRIN_SMILES, "Aspirin");
  const aspProps = estimateThermophysicalProperties(aspirin);
  assert.equal(aspProps.formula, "C9H8O4");
  assert.ok(Math.abs(aspProps.molecularWeight - 180.159) < 0.02);
  assert.equal(aspProps.heavyAtomCount, 13);
  assert.equal(aspProps.totalAtomCount, 21);
  assert.equal(aspProps.implicitHydrogenCount, 8);
  assert.equal(aspProps.ringCount, 1);
  assert.equal(aspProps.aromaticRingCount, 1);
  assert.equal(aspProps.hBondDonors, 1);
  assert.equal(aspProps.hBondAcceptors, 4);
  assert.ok(Math.abs(aspProps.tpsa - 63.6) < 0.1);
  assert.ok(aspProps.Tb > 550 && aspProps.Tb < 700);
  assert.ok(aspProps.Tc > aspProps.Tb);
  assert.ok(aspProps.Pc > 20 && aspProps.Pc < 60);

  // 2. Caffeine (C8H10N4O2, MW = 194.194 g/mol, R = 2, TPSA = 61.82 A^2)
  const caffeine = parseSmiles(CAFFEINE_SMILES, "Caffeine");
  const cafProps = estimateThermophysicalProperties(caffeine);
  assert.equal(cafProps.formula, "C8H10N4O2");
  assert.ok(Math.abs(cafProps.molecularWeight - 194.194) < 0.02);
  assert.equal(cafProps.heavyAtomCount, 14);
  assert.equal(cafProps.totalAtomCount, 24);
  assert.equal(cafProps.implicitHydrogenCount, 10);
  assert.equal(cafProps.ringCount, 2);
  assert.equal(cafProps.aromaticRingCount, 2);
  assert.equal(cafProps.hBondDonors, 0);
  assert.equal(cafProps.hBondAcceptors, 6);
  assert.ok(Math.abs(cafProps.tpsa - 61.82) < 0.1);

  // 3. Benzene (C6H6, MW = 78.114 g/mol, Joback Tb = 358.58 K, Tc = 569.98 K, Pc = 47.69 bar, Vc = 263.5 cm3/mol)
  const benzene = parseSmiles(BENZENE_SMILES, "Benzene");
  const bzProps = estimateThermophysicalProperties(benzene);
  assert.equal(bzProps.formula, "C6H6");
  assert.ok(Math.abs(bzProps.molecularWeight - 78.114) < 0.01);
  assert.equal(bzProps.ringCount, 1);
  assert.equal(bzProps.tpsa, 0);
  assert.ok(Math.abs(bzProps.Tb - 358.58) < 0.1);
  assert.ok(Math.abs(bzProps.Tc - 569.98) < 0.5);
  assert.ok(Math.abs(bzProps.Pc - 47.69) < 0.2);
  assert.ok(Math.abs(bzProps.Vc - 263.5) < 0.1);

  // 4. Ethanol (C2H6O, MW = 46.069 g/mol, Joback Tb = 337.54 K, Vc = 166.5 cm3/mol, TPSA = 20.23 A^2)
  const ethanol = parseSmiles(ETHANOL_SMILES, "Ethanol");
  const etohProps = estimateThermophysicalProperties(ethanol);
  assert.equal(etohProps.formula, "C2H6O");
  assert.ok(Math.abs(etohProps.molecularWeight - 46.069) < 0.01);
  assert.equal(etohProps.ringCount, 0);
  assert.equal(etohProps.hBondDonors, 1);
  assert.equal(etohProps.hBondAcceptors, 1);
  assert.ok(Math.abs(etohProps.tpsa - 20.23) < 0.05);
  assert.ok(Math.abs(etohProps.Tb - 337.54) < 0.1);
  assert.ok(Math.abs(etohProps.Vc - 166.5) < 0.1);
});

test("SMILES Linter: triggers and validates all 10 diagnostic error codes (M9301 - M9310)", () => {
  // Valid benchmarks produce 0 diagnostics
  for (const s of [ASPIRIN_SMILES, CAFFEINE_SMILES, BENZENE_SMILES, ETHANOL_SMILES]) {
    const diags = lintSmiles(parseSmiles(s));
    assert.equal(diags.length, 0, `Expected 0 diagnostics for ${s}, got ${JSON.stringify(diags)}`);
  }

  // M9301: Unclosed ring digit
  const m9301Diags = lintSmiles(parseSmiles("C1CCCCC", "UnclosedHexane"));
  assert.ok(m9301Diags.some((d) => d.code === SmilesErrorCode.UNCLOSED_RING_DIGIT.code));

  // M9302: Unbalanced branch parenthesis
  const m9302Diags = lintSmiles(parseSmiles("CC(CO", "UnbalancedBranch"));
  assert.ok(m9302Diags.some((d) => d.code === SmilesErrorCode.UNBALANCED_BRANCH_PARENTHESIS.code));

  // M9303: Valence exceeded (Texas pentavalent carbon CC(C)(C)(C)C)
  const m9303Diags = lintSmiles(parseSmiles("CC(C)(C)(C)C", "PentavalentCarbon"));
  assert.ok(m9303Diags.some((d) => d.code === SmilesErrorCode.VALENCE_EXCEEDED.code));

  // M9304: Invalid aromatic Kekulé ring (anti-aromatic cyclobutadiene c1ccc1 violates Hückel 4n+2)
  const m9304Diags = lintSmiles(parseSmiles("c1ccc1", "Cyclobutadiene"));
  assert.ok(m9304Diags.some((d) => d.code === SmilesErrorCode.INVALID_AROMATIC_KEKULE_RING.code));

  // M9305: Unknown chemical element ([Xx])
  const m9305Diags = lintSmiles(parseSmiles("C[Xx]O", "UnknownElementMol"));
  assert.ok(m9305Diags.some((d) => d.code === SmilesErrorCode.UNKNOWN_CHEMICAL_ELEMENT.code));

  // M9306: Conflicting ring bond order (C=1CCCCC-1)
  const m9306Diags = lintSmiles(parseSmiles("C=1CCCCC-1", "ConflictingRingOrder"));
  assert.ok(m9306Diags.some((d) => d.code === SmilesErrorCode.CONFLICTING_RING_BOND_ORDER.code));

  // M9307: Self-loop bond (C11)
  const m9307Diags = lintSmiles(parseSmiles("C11", "SelfLoopCarbon"));
  assert.ok(m9307Diags.some((d) => d.code === SmilesErrorCode.SELF_LOOP_BOND.code));

  // M9308: Duplicate atom bond (C1C1)
  const m9308Diags = lintSmiles(parseSmiles("C1C1", "DuplicateBondEthane"));
  assert.ok(m9308Diags.some((d) => d.code === SmilesErrorCode.DUPLICATE_ATOM_BOND.code));

  // M9309: Invalid tetrahedral chirality (isopropanol C[C@H](C)O has two identical methyl groups)
  const m9309Diags = lintSmiles(parseSmiles("C[C@H](C)O", "AchiralIsopropanol"));
  assert.ok(m9309Diags.some((d) => d.code === SmilesErrorCode.INVALID_TETRAHEDRAL_CHIRALITY.code));

  // M9310: Empty molecular graph
  const m9310Diags = lintSmiles(parseSmiles("", "EmptyMol"));
  assert.ok(m9310Diags.some((d) => d.code === SmilesErrorCode.EMPTY_MOLECULAR_GRAPH.code));
});

test("SMILES DAE Lowering: compiles species critical properties, Cp(T), and vapor pressure into DAEBuilder", () => {
  const doc = parseSmilesDocument(`${BENZENE_SMILES} Benzene\n${ETHANOL_SMILES} Ethanol`);
  const dae = lowerSmilesToDae(doc, { temperature: 350.0, pressure: 1.01325 });

  assert.ok(dae.variables().length >= 22);
  assert.equal(dae.variables().length, dae.equations().length, "Expected structurally square DAE (N_vars == N_eqs)");

  assert.notEqual(dae.lookupVariable("T"), -1);
  assert.notEqual(dae.lookupVariable("P"), -1);
  assert.notEqual(dae.lookupVariable("MW_Benzene"), -1);
  assert.notEqual(dae.lookupVariable("Tc_Benzene"), -1);
  assert.notEqual(dae.lookupVariable("Pc_Benzene"), -1);
  assert.notEqual(dae.lookupVariable("Cp_Benzene"), -1);
  assert.notEqual(dae.lookupVariable("Psat_Benzene"), -1);
  assert.notEqual(dae.lookupVariable("K_Ethanol"), -1);
});

test("SMILES Projections: generates Modelica 3.x thermodynamic models and Aspen Plus property cards", () => {
  const aspirin = parseSmiles(ASPIRIN_SMILES, "Aspirin");
  const mo = smilesToModelica(aspirin, "AspirinThermoModel");

  assert.ok(mo.includes("model AspirinThermoModel"));
  assert.ok(mo.includes('parameter Real MW_Aspirin(unit = "g/mol") = 180.159'));
  assert.ok(mo.includes("Cp_Aspirin = cp_a_Aspirin + cp_b_Aspirin * T"));
  assert.ok(mo.includes("K_Aspirin = Psat_Aspirin / P;"));
  assert.ok(mo.includes("end AspirinThermoModel;"));

  const aspenDeck = smilesToAspenDeck(aspirin, "Aspirin Process Deck");
  assert.ok(aspenDeck.includes("COMPONENTS"));
  assert.ok(aspenDeck.includes('ASPIRIN C9H8O4 "Aspirin"'));
  assert.ok(aspenDeck.includes("PROP-LIST MW / TB / TC / PC / VC / OMEGA / DHFORM"));

  const aspenComp = smilesToAspenComponent(aspirin);
  assert.equal(aspenComp.formula, "C9H8O4");
  assert.equal(aspenComp.id, "ASPIRIN");
});

test("SMILES UnifiedWorkspace & LSP: indexes symbols, hover cards, completions, and actions", async () => {
  const ws = new UnifiedWorkspace(smilesLanguage);
  const sampleText = `${ASPIRIN_SMILES} Aspirin\n${CAFFEINE_SMILES} Caffeine`;
  ws.setDocument("file:///chem/drugs.smi", sampleText);

  assert.equal(ws.fileCount, 1);
  const aspirinSym = ws.findSymbolsByName("Aspirin")[0];
  assert.ok(aspirinSym);
  assert.equal(aspirinSym.metadata?.["formula"], "C9H8O4");

  const docSymbols = getSmilesDocumentSymbols(sampleText);
  assert.equal(docSymbols.length, 1);
  assert.equal(docSymbols[0]?.children?.length, 2);

  const hover = getSmilesHover(sampleText, { line: 0, character: 2 });
  assert.ok(hover);
  assert.ok(hover.contents.value.includes("C9H8O4"));
  assert.ok(hover.contents.value.includes("180.159 g/mol"));

  const completions = provideSmilesCompletions();
  assert.ok(completions.length >= 6);

  const diags = validateSmiles("C1CCCCC Unclosed");
  assert.equal(diags.length, 1);
  assert.equal(diags[0]?.code, "M9301");

  const propResult = await executeSmilesAction("smiles_estimate_properties", sampleText);
  assert.equal(propResult.molecules.length, 2);
  assert.equal(propResult.primary.formula, "C9H8O4");

  const directSolved = solveMolecularProperties(sampleText);
  assert.equal(directSolved.molecules.length, 2);
  assert.equal(directSolved.molecules[1]?.formula, "C8H10N4O2");

  assert.equal(smilesLanguage.name, "smiles");
  assert.ok(smilesLanguage.fileExtensions?.includes(".smi"));
  assert.ok(smilesLanguage.fileExtensions?.includes(".sdf"));
});
