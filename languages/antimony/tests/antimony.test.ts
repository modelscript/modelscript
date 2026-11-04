// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  AntimonyErrorCode,
  AntimonyWorkspaceIndex,
  antimonyLanguage,
  antimonyToModelica,
  antimonyToSbmlXml,
  executeAntimonyAction,
  getAntimonyDocumentSymbols,
  getAntimonyHover,
  lintAntimony,
  lowerAntimonyToDae,
  parseAntimony,
  provideAntimonyCompletions,
  serializeAntimony,
  solveAntimony,
  validateAntimony,
} from "../src/index.js";

const VALID_ANTIMONY_MODEL = `
function MM(Vmax, S, Km)
  (Vmax * S) / (Km + S);
end

model EnzymeCascade()
  compartment cytosol = 1.0;
  species S in cytosol = 10.0, P in cytosol = 0.0;
  species $Source in cytosol = 5.0;
  const k_in = 0.2, Vmax = 2.0, Km = 1.5;
  var Stot = 10.0;

  J_in: $Source => S; k_in * Source;
  J_cat: 2 S -> 2 P; MM(Vmax, S, Km);
  Stot := S + P;
  X' = -0.25 * X;
  X = 4.0;

  E1: at (S < 4.0): S = S + 3.0;

  S is "Substrate";
  P is "Product";
  J_cat is "Catalytic Step";
end
`;

test("Antimony Parser: parses modules, functions, compartments, boundary species, reactions, rules, events, and display names", () => {
  const doc = parseAntimony(VALID_ANTIMONY_MODEL, "cascade.ant");
  const mod = doc.mainModule;

  assert.equal(mod.id, "EnzymeCascade");
  assert.equal(doc.functions.size, 1);
  assert.ok(doc.functions.has("MM"));
  assert.deepEqual(doc.functions.get("MM")?.arguments, ["Vmax", "S", "Km"]);

  assert.equal(mod.compartments.size, 1);
  assert.equal(mod.compartments.get("cytosol")?.size, 1.0);

  assert.equal(mod.species.size, 3);
  assert.equal(mod.species.get("S")?.initialConcentration, 10.0);
  assert.equal(mod.species.get("S")?.name, "Substrate");
  assert.equal(mod.species.get("S")?.boundaryCondition, false);
  assert.equal(mod.species.get("Source")?.boundaryCondition, true);
  assert.equal(mod.species.get("Source")?.initialConcentration, 5.0);

  assert.equal(mod.reactions.size, 2);
  const jIn = mod.reactions.get("J_in");
  assert.ok(jIn);
  assert.equal(jIn.reversible, false);
  assert.equal(jIn.reactants[0]?.species, "Source");
  assert.equal(jIn.reactants[0]?.boundaryCondition, true);

  const jCat = mod.reactions.get("J_cat");
  assert.ok(jCat);
  assert.equal(jCat.reversible, true);
  assert.equal(jCat.reactants[0]?.stoichiometry, 2);
  assert.equal(jCat.products[0]?.stoichiometry, 2);
  assert.equal(jCat.name, "Catalytic Step");

  assert.equal(mod.rules.length, 2);
  assert.ok(mod.rules.some((r) => r.type === "assignment" && r.variable === "Stot"));
  assert.ok(mod.rules.some((r) => r.type === "rate" && r.variable === "X"));

  assert.equal(mod.events.length, 1);
  assert.equal(mod.events[0]?.id, "E1");
  assert.equal(mod.events[0]?.trigger, "S < 4.0");
  assert.equal(mod.events[0]?.assignments[0]?.variable, "S");
});

test("Antimony Serializer: roundtrips AST into canonical Antimony text", () => {
  const doc = parseAntimony(VALID_ANTIMONY_MODEL);
  const serialized = serializeAntimony(doc);

  assert.ok(serialized.includes("model EnzymeCascade()"));
  assert.ok(serialized.includes("compartment cytosol;"));
  assert.ok(serialized.includes("species $Source in cytosol;"));
  assert.ok(serialized.includes("J_cat: 2 S -> 2 P; MM(Vmax, S, Km);"));
  assert.ok(serialized.includes("Stot := S + P;"));
  assert.ok(serialized.includes("X' = -0.25 * X;"));
  assert.ok(serialized.includes("E1: at (S < 4.0): S = S + 3.0;"));

  const reparsed = parseAntimony(serialized);
  assert.equal(reparsed.mainModule.id, "EnzymeCascade");
  assert.equal(reparsed.mainModule.species.size, 3);
  assert.equal(reparsed.mainModule.reactions.size, 2);
  assert.equal(reparsed.mainModule.events.length, 1);
});

test("Antimony Linter: valid model produces zero diagnostics", () => {
  const doc = parseAntimony(VALID_ANTIMONY_MODEL);
  const diags = lintAntimony(doc);
  assert.equal(diags.length, 0, `Unexpected diagnostics: ${JSON.stringify(diags)}`);
});

test("Antimony Linter: detects all 10 diagnostic rules M9001 through M9010", () => {
  // M9001: Empty module
  const doc9001 = parseAntimony(`
    model EmptyMod()
      compartment c1 = 1.0;
    end
  `);
  const d9001 = lintAntimony(doc9001);
  assert.ok(
    d9001.some((d) => d.code === AntimonyErrorCode.EMPTY_ANTIMONY_MODULE.code && d.message.includes("'EmptyMod'")),
    "Expected M9001 empty-antimony-module",
  );

  // M9002: Undefined compartment in species
  const doc9002 = parseAntimony(`
    model Mod9002()
      compartment cytosol = 1.0;
      species A in mitochondria = 5.0;
    end
  `);
  const d9002 = lintAntimony(doc9002);
  assert.ok(
    d9002.some(
      (d) =>
        d.code === AntimonyErrorCode.UNDEFINED_COMPARTMENT_IN_SPECIES.code &&
        d.message.includes("'A'") &&
        d.message.includes("'mitochondria'"),
    ),
    "Expected M9002 undefined-compartment-in-species",
  );

  // M9003: Missing reaction rate law
  const doc9003 = parseAntimony(`
    model Mod9003()
      species A = 1.0, B = 0.0;
      J_no_rate: A -> B;
    end
  `);
  const d9003 = lintAntimony(doc9003);
  assert.ok(
    d9003.some((d) => d.code === AntimonyErrorCode.MISSING_REACTION_RATE_LAW.code && d.message.includes("'J_no_rate'")),
    "Expected M9003 missing-reaction-rate-law",
  );

  // M9004: Negative stoichiometric coefficient
  const doc9004 = parseAntimony(`
    model Mod9004()
      const k1 = 0.5;
      J_neg: -2 A + B -> C; k1 * A * B;
    end
  `);
  const d9004 = lintAntimony(doc9004);
  assert.ok(
    d9004.some(
      (d) =>
        d.code === AntimonyErrorCode.NEGATIVE_STOICHIOMETRIC_COEFFICIENT.code &&
        d.message.includes("'A'") &&
        d.message.includes("'J_neg'"),
    ),
    "Expected M9004 negative-stoichiometric-coefficient",
  );

  // M9005: Undefined rate law symbol
  const doc9005 = parseAntimony(`
    model Mod9005()
      species A = 1.0, B = 0.0;
      J1: A -> B; k_ghost * A;
    end
  `);
  const d9005 = lintAntimony(doc9005);
  assert.ok(
    d9005.some(
      (d) =>
        d.code === AntimonyErrorCode.UNDEFINED_RATE_LAW_SYMBOL.code &&
        d.message.includes("'J1'") &&
        d.message.includes("'k_ghost'"),
    ),
    "Expected M9005 undefined-rate-law-symbol",
  );

  // M9006: Duplicate reaction ID
  const doc9006 = parseAntimony(`
    model Mod9006()
      const k1 = 0.1, k2 = 0.2;
      J_dup: A -> B; k1 * A;
      J_dup: B -> C; k2 * B;
    end
  `);
  const d9006 = lintAntimony(doc9006);
  assert.ok(
    d9006.some(
      (d) =>
        d.code === AntimonyErrorCode.DUPLICATE_REACTION_ID.code &&
        d.message.includes("'J_dup'") &&
        d.message.includes("'Mod9006'"),
    ),
    "Expected M9006 duplicate-reaction-id",
  );

  // M9007: Circular submodel instantiation
  const doc9007 = parseAntimony(`
    model SubA()
      species X = 1.0;
      subB: SubB();
    end
    model SubB()
      species Y = 1.0;
      subA: SubA();
    end
  `);
  const d9007 = lintAntimony(doc9007);
  assert.ok(
    d9007.some(
      (d) =>
        d.code === AntimonyErrorCode.CIRCULAR_SUBMODEL_INSTANTIATION.code &&
        (d.message.includes("'SubA'") || d.message.includes("'SubB'")),
    ),
    "Expected M9007 circular-submodel-instantiation",
  );

  // M9008: Conflicting species variability
  const doc9008 = parseAntimony(`
    model Mod9008()
      const species S_const = 10.0;
      species P = 0.0;
      const k1 = 0.5;
      J1: S_const -> P; k1 * S_const;
    end
  `);
  const d9008 = lintAntimony(doc9008);
  assert.ok(
    d9008.some(
      (d) => d.code === AntimonyErrorCode.CONFLICTING_SPECIES_VARIABILITY.code && d.message.includes("'S_const'"),
    ),
    "Expected M9008 conflicting-species-variability",
  );

  // M9009: Negative compartment volume
  const doc9009 = parseAntimony(`
    model Mod9009()
      compartment badComp = -1.5;
      species S in badComp = 2.0;
    end
  `);
  const d9009 = lintAntimony(doc9009);
  assert.ok(
    d9009.some((d) => d.code === AntimonyErrorCode.NEGATIVE_COMPARTMENT_VOLUME.code && d.message.includes("'badComp'")),
    "Expected M9009 negative-compartment-volume",
  );

  // M9010: Invalid event trigger
  const doc9010 = parseAntimony(`
    model Mod9010()
      species S = 10.0;
      E_bad: at (S + 5.0): S = 0.0;
    end
  `);
  const d9010 = lintAntimony(doc9010);
  assert.ok(
    d9010.some((d) => d.code === AntimonyErrorCode.INVALID_EVENT_TRIGGER.code && d.message.includes("'E_bad'")),
    "Expected M9010 invalid-event-trigger",
  );
});

test("Antimony Solver: integrates stoichiometric reactions, rate rules, assignment rules, events, and submodels", () => {
  const modularModel = `
    model ConversionStep(Sub, Prod, k_rate)
      J_sub: Sub => Prod; k_rate * Sub;
    end

    model MainPathway()
      compartment cell = 1.0;
      species A in cell = 10.0, B in cell = 0.0;
      const k1 = 0.4;
      var TotalAB = 10.0;

      M1: ConversionStep(A, B, k1);
      TotalAB := A + B;
      DecayVar' = -0.5 * DecayVar;
      DecayVar = 2.0;

      BolusEvent: at (A < 5.0): A = A + 4.0;
    end
  `;

  const doc = parseAntimony(modularModel);
  const res = solveAntimony(doc, { duration: 2.5, timeStep: 0.01 });

  assert.equal(res.moduleId, "MainPathway");
  assert.ok(res.stepsCount >= 100);
  assert.equal(res.triggeredEvents.length, 1, "Expected BolusEvent to trigger once when A dropped below 5.0");
  assert.equal(res.triggeredEvents[0]?.eventId, "BolusEvent");

  // Because BolusEvent added +4.0 to A once and A -> B conserves A + B between events, TotalAB == 14.0
  assert.ok(
    Math.abs((res.finalConcentrations["TotalAB"] ?? 0) - 14.0) < 1e-4,
    `Expected TotalAB == 14.0 after bolus event, got ${res.finalConcentrations["TotalAB"]}`,
  );

  // DecayVar(2.5) = 2.0 * exp(-0.5 * 2.5) = 2 * exp(-1.25)
  const expectedDecay = 2.0 * Math.exp(-1.25);
  assert.ok(
    Math.abs((res.finalConcentrations["DecayVar"] ?? 0) - expectedDecay) < 1e-3,
    `Expected DecayVar ~ ${expectedDecay}, got ${res.finalConcentrations["DecayVar"]}`,
  );
});

test("Antimony DAE Lowering: compiles compartments, species, fluxes, and rules into square DAEBuilder", () => {
  const doc = parseAntimony(VALID_ANTIMONY_MODEL);
  const dae = lowerAntimonyToDae(doc);

  assert.ok(dae.variables().length >= 8, "Expected at least 8 DAE variables");
  assert.equal(dae.variables().length, dae.equations().length, "Expected structurally square DAE (N_vars == N_eqs)");

  assert.notEqual(dae.lookupVariable("V_cytosol"), -1);
  assert.notEqual(dae.lookupVariable("S_S"), -1);
  assert.notEqual(dae.lookupVariable("S_P"), -1);
  assert.notEqual(dae.lookupVariable("v_J_cat"), -1);
});

test("Antimony Projections: exports valid Modelica 3.x and SBML Level 3 XML", () => {
  const doc = parseAntimony(VALID_ANTIMONY_MODEL);

  const mo = antimonyToModelica(doc, "ProjectedCascade");
  assert.ok(mo.includes("model ProjectedCascade"));
  assert.ok(mo.includes("parameter Real V_cytosol = 1.0000"));
  assert.ok(mo.includes("Real S_S(start = 1.0000e+1)"));
  assert.ok(mo.includes("Real v_J_cat"));
  assert.ok(mo.includes("when S_S < 4.0 then"));
  assert.ok(mo.includes("end ProjectedCascade;"));

  const xml = antimonyToSbmlXml(doc);
  assert.ok(xml.includes('<sbml xmlns="http://www.sbml.org/sbml/level3/version2/core" level="3" version="2">'));
  assert.ok(xml.includes('<model id="EnzymeCascade">'));
  assert.ok(xml.includes('<compartment id="cytosol"'));
  assert.ok(xml.includes('<species id="S"'));
  assert.ok(xml.includes('<reaction id="J_cat"'));
  assert.ok(xml.includes('<event id="E1"'));
});

test("Antimony WorkspaceIndex & LSP: indexes symbols, hover, completions, and actions", async () => {
  const index = new AntimonyWorkspaceIndex();
  const uri = "file:///workspace/cascade.ant";
  index.indexFile(uri, VALID_ANTIMONY_MODEL);

  assert.equal(index.fileCount, 1);
  assert.ok(index.has(uri));
  assert.ok(index.getSymbols(uri).length >= 8);
  assert.equal(index.findDefinition("S")?.name, "S");
  assert.equal(index.findDefinition("J_cat")?.name, "J_cat");
  assert.ok(index.findReferences("S").length >= 1);

  const diags = validateAntimony(VALID_ANTIMONY_MODEL);
  assert.equal(diags.length, 0);

  const docSymbols = getAntimonyDocumentSymbols(VALID_ANTIMONY_MODEL);
  assert.equal(docSymbols.length, 1);
  assert.equal(docSymbols[0]?.name, "EnzymeCascade");
  assert.ok((docSymbols[0]?.children?.length ?? 0) >= 4);

  const hover = getAntimonyHover(VALID_ANTIMONY_MODEL, { line: 7, character: 10 });
  assert.ok(hover);
  assert.ok(hover.contents.value.includes("Antimony Species"));

  const completions = provideAntimonyCompletions(VALID_ANTIMONY_MODEL);
  assert.ok(completions.some((c) => c.label === "species"));
  assert.ok(completions.some((c) => c.label === "S"));

  const daeInfo = await executeAntimonyAction("antimony_to_dae", VALID_ANTIMONY_MODEL);
  assert.equal(daeInfo.modelName, "EnzymeCascade");
  assert.equal(daeInfo.variableCount, daeInfo.equationCount);

  assert.equal(antimonyLanguage.name, "antimony");
});
