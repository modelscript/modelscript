// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert/strict";
import test from "node:test";
import {
  PhreeqcErrorCode,
  executePhreeqcAction,
  findPhreeqcDefinition,
  getPhreeqcDocument,
  getPhreeqcDocumentSymbols,
  getPhreeqcHover,
  lintPhreeqc,
  lowerPhreeqcToDae,
  parsePhreeqc,
  phreeqcLanguage,
  phreeqcToModelica,
  serializePhreeqc,
  solvePhreeqcSpeciation,
  validatePhreeqc,
} from "../src/index.js";

const VALID_PHREEQC_DECK = `TITLE Limestone Aquifer Speciation & Calcite Kinetics
# Standard karst groundwater geochemical deck
SOLUTION 1 Karst Groundwater
    temp      25.0
    pH        7.4
    pe        4.0
    units     mmol/kgw
    Ca        2.0
    Mg        0.5
    Na        1.0
    Cl        1.0
    C(4)      3.0
    S(6)      1.0

SOLUTION 2 Recharge Rainwater
    temp      20.0
    pH        6.5 charge
    pe        4.0
    units     mmol/kgw
    Ca        0.2
    C(4)      0.4

EQUILIBRIUM_PHASES 1
    Calcite   0.0 10.0
    Gypsum    0.0 5.0

REACTION 1
    NaCl      1.0
    CaCO3     0.5
    0.01 moles in 5 steps

KINETICS 1
    Calcite
        -m0     2.5
        -m      2.5
        -parms  1.67e-6 10.0
    -steps 3600 in 10 steps

MIX 1
    1 0.7
    2 0.3

END
`;

test("PHREEQC Parser & Serializer: parses and roundtrips .pqi blocks accurately", () => {
  const doc = parsePhreeqc(VALID_PHREEQC_DECK, "karst.pqi");

  assert.equal(doc.title, "Limestone Aquifer Speciation & Calcite Kinetics");
  assert.equal(doc.solutions.size, 2);

  const sol1 = doc.solutions.get(1);
  assert.ok(sol1);
  assert.equal(sol1.name, "Karst Groundwater");
  assert.equal(sol1.temp, 25.0);
  assert.equal(sol1.pH, 7.4);
  assert.equal(sol1.pe, 4.0);
  assert.equal(sol1.units, "mmol/kgw");
  assert.equal(sol1.solutes.get("Ca"), 2.0);
  assert.equal(sol1.solutes.get("C(4)"), 3.0);
  assert.equal(sol1.solutes.get("S(6)"), 1.0);

  const sol2 = doc.solutions.get(2);
  assert.ok(sol2);
  assert.equal(sol2.pHChargeBalance, true);
  assert.equal(sol2.chargeBalanceElement, "pH");

  assert.equal(doc.equilibriumPhases.length, 2);
  assert.equal(doc.equilibriumPhases[0]?.name, "Calcite");
  assert.equal(doc.equilibriumPhases[0]?.targetSI, 0.0);
  assert.equal(doc.equilibriumPhases[0]?.initialMoles, 10.0);

  const rxn1 = doc.reactions.get(1);
  assert.ok(rxn1);
  assert.equal(rxn1.reactants.get("NaCl"), 1.0);
  assert.equal(rxn1.reactants.get("CaCO3"), 0.5);
  assert.equal(rxn1.totalMoles, 0.01);
  assert.equal(rxn1.stepCount, 5);

  assert.equal(doc.kinetics.length, 1);
  const kin1 = doc.kinetics[0]!;
  assert.equal(kin1.name, "Calcite");
  assert.equal(kin1.m0, 2.5);
  assert.equal(kin1.rateConstant, 1.67e-6);
  assert.equal(kin1.surfaceArea, 10.0);
  assert.equal(kin1.stepCount, 10);

  const mix1 = doc.mixes.get(1);
  assert.ok(mix1);
  assert.equal(mix1.fractions.get(1), 0.7);
  assert.equal(mix1.fractions.get(2), 0.3);

  // Roundtrip serialization
  const serialized = serializePhreeqc(doc);
  assert.ok(serialized.includes("SOLUTION 1 Karst Groundwater"));
  assert.ok(serialized.includes("EQUILIBRIUM_PHASES 1"));
  assert.ok(serialized.includes("REACTION 1"));
  assert.ok(serialized.includes("KINETICS 1"));
  assert.ok(serialized.includes("MIX 1"));

  const reparsed = parsePhreeqc(serialized);
  assert.equal(reparsed.solutions.size, 2);
  assert.equal(reparsed.equilibriumPhases.length, 2);
  assert.equal(reparsed.reactions.size, 1);
  assert.equal(reparsed.kinetics.length, 1);
  assert.equal(reparsed.mixes.size, 1);
});

test("PHREEQC Linter: valid deck produces zero diagnostics", () => {
  const doc = parsePhreeqc(VALID_PHREEQC_DECK);
  const diags = lintPhreeqc(doc);
  assert.equal(diags.length, 0, `Unexpected diagnostics: ${JSON.stringify(diags)}`);
});

test("PHREEQC Linter: detects all 10 diagnostic rules M9551 through M9560", () => {
  // M9560: Empty deck
  const emptyDoc = parsePhreeqc("# Only comments\nEND\n");
  const emptyDiags = lintPhreeqc(emptyDoc);
  assert.equal(emptyDiags.length, 1);
  assert.equal(emptyDiags[0]?.code, PhreeqcErrorCode.EMPTY_PHREEQC_DECK.code);

  // M9551 - M9559
  const flawedDeck = `
SOLUTION 1 Flawed Water
    temp      420.0
    pH        15.5
    pe        -22.0
    units     mmol/kgw
    Ca        5.0
    Cl        -0.5
    Unobtainium 1.0

EQUILIBRIUM_PHASES 1
    Kryptonite  0.0 5.0
    Calcite     0.0 -3.0

MIX 1
    1   0.5
    99  0.5
END
`;

  const doc = parsePhreeqc(flawedDeck);
  const diags = lintPhreeqc(doc);
  const codes = new Set(diags.map((d) => d.code));

  assert.ok(codes.has(9551), "Expected M9551 PH_OUT_OF_PHYSICAL_BOUNDS");
  assert.ok(codes.has(9552), "Expected M9552 PE_OUT_OF_REDOX_STABILITY_BOUNDS");
  assert.ok(codes.has(9553), "Expected M9553 NON_PHYSICAL_TEMPERATURE");
  assert.ok(codes.has(9554), "Expected M9554 NEGATIVE_SOLUTE_CONCENTRATION");
  assert.ok(codes.has(9555), "Expected M9555 CHARGE_IMBALANCE_EXCEEDED");
  assert.ok(codes.has(9556), "Expected M9556 UNKNOWN_AQUEOUS_MASTER_SPECIES");
  assert.ok(codes.has(9557), "Expected M9557 UNKNOWN_EQUILIBRIUM_MINERAL_PHASE");
  assert.ok(codes.has(9558), "Expected M9558 NEGATIVE_MINERAL_MOLES");
  assert.ok(codes.has(9559), "Expected M9559 UNRESOLVED_MIX_SOLUTION");
});

test("PHREEQC Speciation Solver: computes ionic strength, Davies activity coefficients, carbonate species, and mineral SI", () => {
  const doc = parsePhreeqc(VALID_PHREEQC_DECK);
  const spec = solvePhreeqcSpeciation(doc, { solutionNumber: 1 });

  assert.equal(spec.solutionNumber, 1);
  assert.equal(spec.temperatureC, 25.0);
  assert.equal(spec.pH, 7.4);

  // Ionic strength should be positive (~ 0.0085 mol/kgw)
  assert.ok(spec.ionicStrength > 0.005 && spec.ionicStrength < 0.015);

  // Davies activity coefficients: 0 < gamma_2 < gamma_1 < 1
  const gammaHCO3 = spec.activityCoefficients["HCO3-"]!;
  const gammaCO3 = spec.activityCoefficients["CO3-2"]!;
  assert.ok(gammaHCO3 > 0.85 && gammaHCO3 < 0.95, `Unexpected gamma_1: ${gammaHCO3}`);
  assert.ok(gammaCO3 > 0.55 && gammaCO3 < 0.8, `Unexpected gamma_2: ${gammaCO3}`);
  assert.ok(gammaCO3 < gammaHCO3);

  // At pH 7.4, HCO3- is the dominant carbonate species: HCO3- > H2CO3* > CO3-2
  const { totalCarbon, h2co3, hco3, co3 } = spec.carbonateSpeciation;
  assert.ok(Math.abs(totalCarbon - 0.003) < 1.0e-9);
  assert.ok(Math.abs(h2co3 + hco3 + co3 - totalCarbon) < 1.0e-10);
  assert.ok(hco3 > h2co3 && h2co3 > co3);

  // Mineral Saturation Indices for Calcite, Aragonite, Gypsum, Anhydrite, Halite, Dolomite, Fluorite
  assert.ok(spec.saturationIndices["Calcite"]);
  assert.ok(spec.saturationIndices["Aragonite"]);
  assert.ok(spec.saturationIndices["Gypsum"]);
  assert.ok(spec.saturationIndices["Anhydrite"]);
  assert.ok(spec.saturationIndices["Halite"]);
  assert.ok(spec.saturationIndices["Dolomite"]);
  assert.ok(spec.saturationIndices["Fluorite"]);

  // Calcite is slightly more stable than Aragonite (logKsp_Calcite = -8.48 < logKsp_Aragonite = -8.336 => SI_Calcite > SI_Aragonite)
  const siCalcite = spec.saturationIndices["Calcite"]!.si;
  const siAragonite = spec.saturationIndices["Aragonite"]!.si;
  assert.ok(siCalcite > siAragonite);

  // Gypsum is undersaturated at 2 mmol/kgw Ca and 1 mmol/kgw SO4
  const siGypsum = spec.saturationIndices["Gypsum"]!.si;
  assert.ok(siGypsum < 0.0);
  assert.equal(spec.saturationIndices["Gypsum"]!.state, "undersaturated");

  // Solution 2 uses pH charge balance adjustment: verify net charge balance converges near zero
  const spec2 = solvePhreeqcSpeciation(doc, { solutionNumber: 2 });
  assert.ok(
    Math.abs(spec2.chargeBalanceError) < 1.0e-6,
    `Expected charge balance near zero, got ${spec2.chargeBalanceError}`,
  );
});

test("PHREEQC DAE Lowering: compiles aqueous speciation and mineral kinetics into a square DAEBuilder", () => {
  const doc = parsePhreeqc(VALID_PHREEQC_DECK);
  const dae = lowerPhreeqcToDae(doc);

  const varCount = dae.variables().length;
  const eqCount = dae.equations().length;
  assert.ok(varCount >= 18, `Expected at least 18 DAE variables, got ${varCount}`);
  assert.equal(varCount, eqCount, `Expected square DAE (N_vars=${varCount} == N_eqs=${eqCount})`);

  assert.notEqual(dae.lookupVariable("I"), -1);
  assert.notEqual(dae.lookupVariable("gamma_1"), -1);
  assert.notEqual(dae.lookupVariable("gamma_2"), -1);
  assert.notEqual(dae.lookupVariable("m_H"), -1);
  assert.notEqual(dae.lookupVariable("m_OH"), -1);
  assert.notEqual(dae.lookupVariable("C_tot"), -1);
  assert.notEqual(dae.lookupVariable("m_H2CO3"), -1);
  assert.notEqual(dae.lookupVariable("m_HCO3"), -1);
  assert.notEqual(dae.lookupVariable("m_CO3"), -1);
  assert.notEqual(dae.lookupVariable("m_Ca"), -1);
  assert.notEqual(dae.lookupVariable("IAP_Calcite"), -1);
  assert.notEqual(dae.lookupVariable("SI_Calcite"), -1);
  assert.notEqual(dae.lookupVariable("M_Calcite"), -1);
  assert.notEqual(dae.lookupVariable("rate_Calcite"), -1);
});

test("PHREEQC Modelica Projection: generates valid Modelica 3.x aqueous geochemistry model", () => {
  const doc = parsePhreeqc(VALID_PHREEQC_DECK);
  const mo = phreeqcToModelica(doc, "KarstAquiferModel");

  assert.ok(mo.includes("model KarstAquiferModel"));
  assert.ok(mo.includes("parameter Real T_C = 25.0000"));
  assert.ok(mo.includes("Real I("));
  assert.ok(mo.includes("Real gamma_1("));
  assert.ok(mo.includes("Real m_HCO3("));
  assert.ok(mo.includes("Real SI_Calcite("));
  assert.ok(mo.includes("Real M_Calcite("));
  assert.ok(mo.includes("der(M_Calcite) = -rate_Calcite;"));
  assert.ok(mo.includes("end KarstAquiferModel;"));
});

test("PHREEQC UnifiedWorkspace & LSP: indexes symbols, hover, diagnostics, and actions", async () => {
  const ws = new UnifiedWorkspace(phreeqcLanguage);
  const uri = "file:///geochem/karst.pqi";
  ws.setDocument(uri, VALID_PHREEQC_DECK);

  assert.equal(ws.fileCount, 1);
  assert.equal(getPhreeqcDocument(ws, uri)?.solutions.size, 2);
  const symbols = ws.getSymbolsForUri(uri);
  assert.ok(symbols.length >= 10);

  const solDef = findPhreeqcDefinition(ws, "SOLUTION_1");
  assert.ok(solDef);
  const caDef = findPhreeqcDefinition(ws, "Ca");
  assert.ok(caDef);
  const calciteDef = findPhreeqcDefinition(ws, "Calcite");
  assert.ok(calciteDef);

  const lspDiags = validatePhreeqc(VALID_PHREEQC_DECK);
  assert.equal(lspDiags.length, 0);

  const docSymbols = getPhreeqcDocumentSymbols(VALID_PHREEQC_DECK);
  assert.equal(docSymbols.length, 1);
  assert.ok((docSymbols[0]?.children?.length ?? 0) >= 4);

  const calciteLineIdx = VALID_PHREEQC_DECK.split("\n").findIndex((l) => l.includes("Calcite   0.0"));
  const hover = getPhreeqcHover(VALID_PHREEQC_DECK, { line: calciteLineIdx, character: 6 });
  assert.ok(hover);
  assert.ok(hover.contents.value.includes("Calcite"));

  const daeInfo = await executePhreeqcAction("phreeqc_to_dae", VALID_PHREEQC_DECK);
  assert.equal(daeInfo.variableCount, daeInfo.equationCount);
});
