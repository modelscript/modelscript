// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  BnglErrorCode,
  BnglWorkspaceIndex,
  bnglLanguage,
  bnglToModelica,
  bnglToSbmlXml,
  executeBnglAction,
  generateBnglNetwork,
  getBnglDocumentSymbols,
  getBnglHover,
  lintBngl,
  lowerBnglToDae,
  parseBngl,
  provideBnglCompletions,
  serializeBngl,
  solveBngl,
  validateBngl,
} from "../src/index.js";

const RECEPTOR_PHOSPHORYLATION_BNGL = `
begin model
begin parameters
  L0 100
  R0 200
  kp1 0.002
  km1 0.1
  k_phos 0.4
  k_dephos 0.05
end parameters

begin compartments
  EC 3 1.0
end compartments

begin molecule types
  L(r)
  R(l,Y~U~P)
end molecule types

begin seed species
  L(r) L0
  R(l,Y~U) R0
end seed species

begin observables
  Molecules FreeL L(r)
  Molecules BoundR L(r!1).R(l!1)
  Molecules PhosphoR R(Y~P)
  Molecules TotalR R()
  Species BoundDimers L(r!1).R(l!1)
end observables

begin reaction rules
  Bind: L(r) + R(l) <-> L(r!1).R(l!1) kp1, km1
  Phos: L(r!1).R(l!1,Y~U) -> L(r!1).R(l!1,Y~P) k_phos
  Dephos: R(Y~P) -> R(Y~U) k_dephos
end reaction rules
end model

generate_network({overwrite=>1,max_iter=>10})
simulate({method=>"ode",t_end=>10,n_steps=>200})
`;

test("BNGL Parser: parses parameters, compartments, molecule types, seed species, observables, reaction rules, and actions", () => {
  const doc = parseBngl(RECEPTOR_PHOSPHORYLATION_BNGL, "receptor_signaling.bngl");
  const m = doc.model;

  assert.equal(m.id, "receptor_signaling");
  assert.equal(m.parameters.size, 6);
  assert.equal(m.parameters.get("L0")?.value, 100);
  assert.equal(m.parameters.get("R0")?.value, 200);
  assert.equal(m.parameters.get("kp1")?.value, 0.002);

  assert.equal(m.compartments.size, 1);
  assert.equal(m.compartments.get("EC")?.dimensions, 3);
  assert.equal(m.compartments.get("EC")?.size, 1.0);

  assert.equal(m.moleculeTypes.size, 2);
  const rMol = m.moleculeTypes.get("R");
  assert.ok(rMol);
  assert.equal(rMol.sites.length, 2);
  assert.equal(rMol.sites[0]?.name, "l");
  assert.deepEqual(rMol.sites[0]?.allowedStates, []);
  assert.equal(rMol.sites[1]?.name, "Y");
  assert.deepEqual(rMol.sites[1]?.allowedStates, ["U", "P"]);

  assert.equal(m.seedSpecies.length, 2);
  assert.equal(m.seedSpecies[0]?.initialConcentration, 100);
  assert.equal(m.seedSpecies[1]?.initialConcentration, 200);
  assert.equal(m.seedSpecies[1]?.pattern.molecules[0]?.components[1]?.state, "U");

  assert.equal(m.observables.size, 5);
  assert.equal(m.observables.get("BoundR")?.type, "Molecules");
  assert.equal(m.observables.get("BoundDimers")?.type, "Species");

  assert.equal(m.reactionRules.size, 3);
  const bindRule = m.reactionRules.get("Bind");
  assert.ok(bindRule);
  assert.equal(bindRule.reversible, true);
  assert.equal(bindRule.forwardRate, "kp1");
  assert.equal(bindRule.reverseRate, "km1");
  assert.equal(bindRule.products[0]?.molecules.length, 2);
  assert.equal(bindRule.products[0]?.molecules[0]?.components[0]?.bond, "1");
  assert.equal(bindRule.products[0]?.molecules[1]?.components[0]?.bond, "1");

  const phosRule = m.reactionRules.get("Phos");
  assert.ok(phosRule);
  assert.equal(phosRule.reversible, false);
  assert.equal(phosRule.forwardRate, "k_phos");
  assert.equal(phosRule.products[0]?.molecules[1]?.components[1]?.state, "P");

  assert.equal(doc.actions.length, 2);
  assert.equal(doc.actions[0]?.command, "generate_network");
  assert.equal(doc.actions[0]?.args["overwrite"], 1);
  assert.equal(doc.actions[1]?.command, "simulate");
  assert.equal(doc.actions[1]?.args["method"], "ode");
  assert.equal(doc.actions[1]?.args["t_end"], 10);
});

test("BNGL Serializer: roundtrips AST into canonical BioNetGen text", () => {
  const doc = parseBngl(RECEPTOR_PHOSPHORYLATION_BNGL, "receptor.bngl");
  const serialized = serializeBngl(doc);

  assert.ok(serialized.includes("begin model"));
  assert.ok(serialized.includes("begin molecule types"));
  assert.ok(serialized.includes("R(l,Y~U~P)"));
  assert.ok(serialized.includes("Bind: L(r) + R(l) <-> L(r!1).R(l!1) kp1, km1"));
  assert.ok(serialized.includes("Phos: L(r!1).R(l!1,Y~U) -> L(r!1).R(l!1,Y~P) k_phos"));
  assert.ok(serialized.includes('simulate({method=>"ode",t_end=>10,n_steps=>200})'));

  const reparsed = parseBngl(serialized);
  assert.equal(reparsed.model.moleculeTypes.size, 2);
  assert.equal(reparsed.model.seedSpecies.length, 2);
  assert.equal(reparsed.model.observables.size, 5);
  assert.equal(reparsed.model.reactionRules.size, 3);
  assert.equal(reparsed.actions.length, 2);
});

test("BNGL Linter: valid model produces zero diagnostics", () => {
  const doc = parseBngl(RECEPTOR_PHOSPHORYLATION_BNGL);
  const diags = lintBngl(doc);
  assert.equal(diags.length, 0, `Unexpected diagnostics: ${JSON.stringify(diags)}`);
});

test("BNGL Linter: detects all 10 diagnostic rules M9051 through M9060", () => {
  // M9051: Undeclared molecule type
  const doc9051 = parseBngl(`
    begin model
    begin molecule types
      L(r)
    end molecule types
    begin seed species
      L(r) 10
      GhostReceptor(l) 20
    end seed species
    end model
  `);
  const d9051 = lintBngl(doc9051);
  assert.ok(
    d9051.some((d) => d.code === BnglErrorCode.UNDECLARED_MOLECULE_TYPE.code && d.message.includes("'GhostReceptor'")),
    "Expected M9051 molecule-type-undeclared",
  );

  // M9052: Undeclared component site
  const doc9052 = parseBngl(`
    begin model
    begin molecule types
      R(l,Y~U~P)
    end molecule types
    begin seed species
      R(l,badSite~U) 50
    end seed species
    end model
  `);
  const d9052 = lintBngl(doc9052);
  assert.ok(
    d9052.some(
      (d) =>
        d.code === BnglErrorCode.UNDECLARED_COMPONENT_SITE.code &&
        d.message.includes("'badSite'") &&
        d.message.includes("'R'"),
    ),
    "Expected M9052 component-site-undeclared",
  );

  // M9053: Invalid internal state
  const doc9053 = parseBngl(`
    begin model
    begin molecule types
      R(l,Y~U~P)
    end molecule types
    begin seed species
      R(l,Y~HyperPhos) 50
    end seed species
    end model
  `);
  const d9053 = lintBngl(doc9053);
  assert.ok(
    d9053.some(
      (d) =>
        d.code === BnglErrorCode.INVALID_INTERNAL_STATE.code &&
        d.message.includes("'~HyperPhos'") &&
        d.message.includes("'Y'"),
    ),
    "Expected M9053 invalid-internal-state",
  );

  // M9054: Dangling bond label (!1 appears != 2 times in a complex pattern)
  const doc9054 = parseBngl(`
    begin model
    begin molecule types
      L(r)
      R(l)
    end molecule types
    begin seed species
      L(r!1).R(l) 10
    end seed species
    end model
  `);
  const d9054 = lintBngl(doc9054);
  assert.ok(
    d9054.some((d) => d.code === BnglErrorCode.DANGLING_BOND_LABEL.code && d.message.includes("'!1'")),
    "Expected M9054 dangling-bond-label",
  );

  // M9055: Undefined rate parameter
  const doc9055 = parseBngl(`
    begin model
    begin molecule types
      A(b)
      B(a)
    end molecule types
    begin seed species
      A(b) 10
      B(a) 10
    end seed species
    begin reaction rules
      R_undef: A(b) + B(a) -> A(b!1).B(a!1) k_missing_rate
    end reaction rules
    end model
  `);
  const d9055 = lintBngl(doc9055);
  assert.ok(
    d9055.some(
      (d) =>
        d.code === BnglErrorCode.UNDEFINED_RATE_PARAMETER.code &&
        d.message.includes("'R_undef'") &&
        d.message.includes("'k_missing_rate'"),
    ),
    "Expected M9055 undefined-rate-parameter",
  );

  // M9056: Reversible rule missing reverse rate
  const doc9056 = parseBngl(`
    begin model
    begin parameters
      kp 0.1
    end parameters
    begin molecule types
      A(b)
      B(a)
    end molecule types
    begin reaction rules
      RevNoKm: A(b) + B(a) <-> A(b!1).B(a!1) kp
    end reaction rules
    end model
  `);
  const d9056 = lintBngl(doc9056);
  assert.ok(
    d9056.some(
      (d) => d.code === BnglErrorCode.REVERSIBLE_RULE_MISSING_REVERSE_RATE.code && d.message.includes("'RevNoKm'"),
    ),
    "Expected M9056 reversible-rule-missing-reverse-rate",
  );

  // M9057: Negative seed concentration
  const doc9057 = parseBngl(`
    begin model
    begin molecule types
      A(b)
    end molecule types
    begin seed species
      A(b) -25.0
    end seed species
    end model
  `);
  const d9057 = lintBngl(doc9057);
  assert.ok(
    d9057.some((d) => d.code === BnglErrorCode.NEGATIVE_SEED_CONCENTRATION.code && d.message.includes("'A(b)'")),
    "Expected M9057 negative-seed-concentration",
  );

  // M9058: Empty BioNetGen model
  const doc9058 = parseBngl(`
    begin model EmptySignalingModel
    begin parameters
      k1 0.5
    end parameters
    end model
  `);
  const d9058 = lintBngl(doc9058);
  assert.ok(
    d9058.some(
      (d) => d.code === BnglErrorCode.EMPTY_BIONETGEN_MODEL.code && d.message.includes("'EmptySignalingModel'"),
    ),
    "Expected M9058 empty-bionetgen-model",
  );

  // M9059: Duplicate observable name
  const doc9059 = parseBngl(`
    begin model
    begin molecule types
      R(Y~U~P)
    end molecule types
    begin observables
      Molecules ActiveR R(Y~P)
      Molecules ActiveR R(Y~U)
    end observables
    end model
  `);
  const d9059 = lintBngl(doc9059);
  assert.ok(
    d9059.some((d) => d.code === BnglErrorCode.DUPLICATE_OBSERVABLE_NAME.code && d.message.includes("'ActiveR'")),
    "Expected M9059 duplicate-observable-name",
  );

  // M9060: Unbounded polymerization rule
  const doc9060 = parseBngl(`
    begin model
    begin parameters
      k_poly 0.01
    end parameters
    begin molecule types
      Actin(barbed,pointed)
    end molecule types
    begin seed species
      Actin(barbed,pointed) 100
    end seed species
    begin reaction rules
      Elongate: Actin(barbed) + Actin(pointed) -> Actin(barbed!1).Actin(pointed!1) k_poly
    end reaction rules
    end model
  `);
  const d9060 = lintBngl(doc9060);
  assert.ok(
    d9060.some(
      (d) =>
        d.code === BnglErrorCode.UNBOUNDED_POLYMERIZATION_RULE.code &&
        d.message.includes("'Elongate'") &&
        d.message.includes("'Actin'"),
    ),
    "Expected M9060 unbounded-polymerization-rule",
  );
});

test("BNGL Network Generator & RK4 Solver: expands receptor-ligand phosphorylation rules and integrates ODEs & observables", () => {
  const doc = parseBngl(RECEPTOR_PHOSPHORYLATION_BNGL, "receptor_signaling.bngl");
  const net = generateBnglNetwork(doc);

  // 2 seed species L(r) and R(l,Y~U) expand to 5 concrete species:
  // 1) L(r)
  // 2) R(l,Y~U)
  // 3) L(r!1).R(l!1,Y~U)
  // 4) L(r!1).R(l!1,Y~P)
  // 5) R(l,Y~P)
  assert.equal(net.species.length, 5, `Expected 5 expanded species, got ${net.species.length}`);
  const canonicalSet = new Set(net.species.map((s) => s.canonicalPattern));
  assert.ok(canonicalSet.has("L(r)"));
  assert.ok(canonicalSet.has("R(l,Y~U)"));
  assert.ok(canonicalSet.has("L(r!1).R(l!1,Y~U)"));
  assert.ok(canonicalSet.has("L(r!1).R(l!1,Y~P)"));
  assert.ok(canonicalSet.has("R(l,Y~P)"));
  assert.ok(net.reactions.length >= 6, `Expected at least 6 elementary reactions, got ${net.reactions.length}`);

  const sim = solveBngl(doc, { duration: 10.0, timeStep: 0.02 });
  assert.equal(sim.modelId, "receptor_signaling");
  assert.ok(sim.stepsCount >= 200);

  // Initial observables check
  assert.equal(sim.initialObservables["FreeL"], 100);
  assert.equal(sim.initialObservables["BoundR"], 0);
  assert.equal(sim.initialObservables["PhosphoR"], 0);
  assert.equal(sim.initialObservables["TotalR"], 200);

  // Final observables check after ligand binding and phosphorylation
  const finalBoundR = sim.finalObservables["BoundR"] ?? 0;
  const finalPhosphoR = sim.finalObservables["PhosphoR"] ?? 0;
  const finalFreeL = sim.finalObservables["FreeL"] ?? 0;
  const finalTotalR = sim.finalObservables["TotalR"] ?? 0;

  assert.ok(finalBoundR > 50, `Expected significant receptor-ligand binding, got BoundR=${finalBoundR}`);
  assert.ok(finalPhosphoR > 50, `Expected significant receptor phosphorylation, got PhosphoR=${finalPhosphoR}`);

  // Conservation of total receptor R0 = 200 and total ligand L0 = 100
  assert.ok(Math.abs(finalTotalR - 200.0) < 1e-6, `Expected TotalR conservation == 200.0, got ${finalTotalR}`);
  assert.ok(
    Math.abs(finalFreeL + finalBoundR - 100.0) < 1e-6,
    `Expected TotalL (FreeL + BoundR) conservation == 100.0, got ${finalFreeL + finalBoundR}`,
  );
});

test("BNGL DAE Lowering: compiles expanded species, observables, and fluxes into a structurally square DAEBuilder", () => {
  const doc = parseBngl(RECEPTOR_PHOSPHORYLATION_BNGL, "receptor_signaling.bngl");
  const dae = lowerBnglToDae(doc);

  assert.ok(dae.variables().length >= 15, "Expected at least 15 DAE variables");
  assert.equal(dae.variables().length, dae.equations().length, "Expected structurally square DAE (N_vars == N_eqs)");

  assert.notEqual(dae.lookupVariable("V_EC"), -1);
  assert.notEqual(dae.lookupVariable("param_kp1"), -1);
  assert.notEqual(dae.lookupVariable("S1"), -1);
  assert.notEqual(dae.lookupVariable("obs_BoundR"), -1);
  assert.notEqual(dae.lookupVariable("obs_PhosphoR"), -1);
  assert.notEqual(dae.lookupVariable("v_Rxn1"), -1);
});

test("BNGL Projections: exports valid Modelica 3.x and SBML Level 3 XML", () => {
  const doc = parseBngl(RECEPTOR_PHOSPHORYLATION_BNGL, "receptor_signaling.bngl");

  const mo = bnglToModelica(doc, "ProjectedBnglModel");
  assert.ok(mo.includes("model ProjectedBnglModel"));
  assert.ok(mo.includes("parameter Real V_EC = 1.0000"));
  assert.ok(mo.includes("parameter Real param_kp1"));
  assert.ok(mo.includes("Real S1(start = 1.0000e+2)"));
  assert.ok(mo.includes("Real obs_BoundR"));
  assert.ok(mo.includes("Real obs_PhosphoR"));
  assert.ok(mo.includes("end ProjectedBnglModel;"));

  const xml = bnglToSbmlXml(doc);
  assert.ok(xml.includes('<sbml xmlns="http://www.sbml.org/sbml/level3/version2/core" level="3" version="2">'));
  assert.ok(xml.includes('<model id="receptor_signaling"'));
  assert.ok(xml.includes('<compartment id="EC"'));
  assert.ok(xml.includes('<species id="S1" name="L(r)"'));
  assert.ok(xml.includes('<assignmentRule variable="BoundR"'));
  assert.ok(xml.includes('<reaction id="Rxn1"'));
});

test("BNGL WorkspaceIndex & LSP: indexes symbols, hover, completions, and actions", async () => {
  const index = new BnglWorkspaceIndex();
  const uri = "file:///workspace/receptor_signaling.bngl";
  index.indexFile(uri, RECEPTOR_PHOSPHORYLATION_BNGL);

  assert.equal(index.fileCount, 1);
  assert.ok(index.has(uri));
  assert.ok(index.getSymbols(uri).length >= 10);
  assert.equal(index.findDefinition("R")?.name, "R");
  assert.equal(index.findDefinition("BoundR")?.name, "BoundR");
  assert.equal(index.findDefinition("Bind")?.name, "Bind");
  assert.ok(index.findReferences("R").length >= 1);

  const diags = validateBngl(RECEPTOR_PHOSPHORYLATION_BNGL);
  assert.equal(diags.length, 0);

  const docSymbols = getBnglDocumentSymbols(RECEPTOR_PHOSPHORYLATION_BNGL);
  assert.equal(docSymbols.length, 1);
  assert.ok((docSymbols[0]?.children?.length ?? 0) >= 6);

  const hover = getBnglHover(RECEPTOR_PHOSPHORYLATION_BNGL, { line: 17, character: 4 });
  assert.ok(hover);
  assert.ok(hover.contents.value.includes("BioNetGen Molecule Type"));

  const completions = provideBnglCompletions(RECEPTOR_PHOSPHORYLATION_BNGL);
  assert.ok(completions.some((c) => c.label === "begin molecule types"));
  assert.ok(completions.some((c) => c.label === "R"));
  assert.ok(completions.some((c) => c.label === "BoundR"));

  const daeInfo = await executeBnglAction("bngl_to_dae", RECEPTOR_PHOSPHORYLATION_BNGL);
  assert.equal(daeInfo.variableCount, daeInfo.equationCount);

  assert.equal(bnglLanguage.name, "bngl");
});
