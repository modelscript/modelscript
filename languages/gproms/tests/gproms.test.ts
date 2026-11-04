// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  GpromsErrorCode,
  GpromsWorkspaceIndex,
  executeGpromsAction,
  getGpromsDocumentSymbols,
  getGpromsHover,
  gpromsLanguage,
  gpromsToModelica,
  lintGproms,
  lowerGpromsToDae,
  parseGproms,
  provideGpromsCompletions,
  serializeGproms,
  solveGpromsProcess,
  validateGproms,
} from "../src/index.js";

const VALID_CSTR_GPROMS = `
DECLARE
  TYPE
    Concentration = 1.0 : 0.0 : 100.0 UNIT = "mol/L"
    FlowRate      = 2.0 : 0.0 : 1000.0 UNIT = "L/s"
    ReactionRate  = 0.0 : -1000.0 : 1000.0 UNIT = "mol/(L*s)"
  END
END

MODEL IsothermalCSTR
  PARAMETER
    V AS REAL DEFAULT 10.0
    k AS REAL DEFAULT 0.3

  VARIABLE
    C_A    AS Concentration
    C_B    AS Concentration
    F      AS FlowRate
    C_A_in AS Concentration
    r      AS ReactionRate

  EQUATION
    r = k * C_A ;
    $C_A = (F / V) * (C_A_in - C_A) - r ;
    $C_B = -(F / V) * C_B + r ;
END

PROCESS CstrSimulation
  UNIT
    R101 AS IsothermalCSTR
  SET
    R101.V := 10.0 ;
    R101.k := 0.3 ;
  ASSIGN
    R101.F := 2.0 ;
    R101.C_A_in := 5.0 ;
  INITIAL
    R101.C_A := 5.0 ;
    R101.C_B := 0.0 ;
  SOLUTIONPARAMETERS
    ReportingInterval := 0.1 ;
    TotalTime := 10.0 ;
END
`;

const VALID_TUBULAR_PFR_GPROMS = `
DECLARE
  TYPE
    Concentration = 1.0 : 0.0 : 100.0 UNIT = "mol/L"
  END
END

MODEL AxialDispersionPFR
  PARAMETER
    v    AS REAL DEFAULT 0.5
    D_ax AS REAL DEFAULT 0.01
    k    AS REAL DEFAULT 0.4
    C_in AS REAL DEFAULT 10.0

  DISTRIBUTION_DOMAIN
    Axial AS [ 0.0 : 1.0 ] N = 11

  VARIABLE
    C AS DISTRIBUTION(Axial) OF Concentration

  BOUNDARY
    C(0.0) = C_in ;

  EQUATION
    $C = -v * PARTIAL(C, Axial) + D_ax * PARTIAL(PARTIAL(C, Axial), Axial) - k * C ;
END

PROCESS PfrSimulation
  UNIT
    T101 AS AxialDispersionPFR
  SET
    T101.v := 0.5 ;
    T101.D_ax := 0.01 ;
    T101.k := 0.4 ;
    T101.C_in := 10.0 ;
  INITIAL
    T101.C := 0.0 ;
  SOLUTIONPARAMETERS
    TotalTime := 6.0 ;
    TimeStep := 0.005 ;
END
`;

test("gPROMS Parser & Serializer: parses DECLARE TYPE, MODEL, and PROCESS blocks and roundtrips cleanly", () => {
  const doc = parseGproms(VALID_CSTR_GPROMS, "cstr.gproms");

  assert.equal(doc.variableTypes.size, 3);
  const concType = doc.variableTypes.get("Concentration");
  assert.ok(concType);
  assert.equal(concType.defaultValue, 1.0);
  assert.equal(concType.lowerBound, 0.0);
  assert.equal(concType.upperBound, 100.0);
  assert.equal(concType.unit, "mol/L");

  const model = doc.models.get("IsothermalCSTR");
  assert.ok(model);
  assert.equal(model.parameters.size, 2);
  assert.equal(model.variables.size, 5);
  assert.equal(model.equations.length, 3);

  const proc = doc.processes.get("CstrSimulation");
  assert.ok(proc);
  assert.equal(proc.units.get("R101"), "IsothermalCSTR");
  assert.equal(proc.sets.get("k"), 0.3);
  assert.equal(proc.assigns.get("F"), 2.0);
  assert.equal(proc.initials.get("C_A"), 5.0);

  // Roundtrip serialization
  const serialized = serializeGproms(doc);
  const reparsed = parseGproms(serialized);
  assert.equal(reparsed.variableTypes.size, 3);
  assert.equal(reparsed.models.get("IsothermalCSTR")?.variables.size, 5);
  assert.equal(reparsed.models.get("IsothermalCSTR")?.equations.length, 3);
  assert.equal(reparsed.processes.get("CstrSimulation")?.assignEntries.length, 2);
});

test("gPROMS Parser: parses DISTRIBUTION_DOMAIN, BOUNDARY, and 1st/2nd-order PARTIAL derivatives", () => {
  const doc = parseGproms(VALID_TUBULAR_PFR_GPROMS, "pfr.pml");
  const model = doc.models.get("AxialDispersionPFR");
  assert.ok(model);

  const dom = model.domains.get("Axial");
  assert.ok(dom);
  assert.equal(dom.lowerBound, 0.0);
  assert.equal(dom.upperBound, 1.0);
  assert.equal(dom.gridPoints, 11);

  const cVar = model.variables.get("C");
  assert.ok(cVar);
  assert.deepEqual(cVar.domains, ["Axial"]);

  assert.equal(model.boundaryEquations.length, 1);
  assert.equal(model.equations.length, 1);

  const pde = model.equations[0]!;
  assert.deepEqual(pde.differentialVariables, ["C"]);
  assert.equal(pde.partials.length, 2);
  assert.equal(pde.partials[0]?.variable, "C");
  assert.equal(pde.partials[0]?.domain, "Axial");
  assert.equal(pde.partials[0]?.order, 1);
  assert.equal(pde.partials[1]?.order, 2);
});

test("gPROMS Linter: valid lumped CSTR and distributed PFR models produce zero diagnostics", () => {
  const cstrDiags = lintGproms(parseGproms(VALID_CSTR_GPROMS));
  assert.equal(cstrDiags.length, 0, `Unexpected CSTR diags: ${JSON.stringify(cstrDiags)}`);

  const pfrDiags = lintGproms(parseGproms(VALID_TUBULAR_PFR_GPROMS));
  assert.equal(pfrDiags.length, 0, `Unexpected PFR diags: ${JSON.stringify(pfrDiags)}`);
});

test("gPROMS Linter: detects all 10 diagnostic rules M9451 through M9460", () => {
  // M9451 (undeclared type), M9452 (invalid bounds), M9453 (invalid domain),
  // M9454 (undeclared equation identifier), M9455 (structural DOF mismatch),
  // M9456 (uninitialized differential state), M9457 (PARTIAL on non-distributed variable),
  // M9458 (overassigned parameter/variable), M9460 (duplicate declaration)
  const flawedSource = `
DECLARE
  TYPE
    BadBoundsType = 150.0 : 100.0 : 50.0 UNIT = "K"
    Conc = 1.0 : 0.0 : 10.0 UNIT = "mol/L"
    Conc = 1.0 : 0.0 : 10.0 UNIT = "mol/L"
  END
END

MODEL FlawedReactor
  PARAMETER
    k AS REAL DEFAULT 0.1

  DISTRIBUTION_DOMAIN
    BadAxial AS [ 2.0 : 1.0 ] N = 1

  VARIABLE
    C_lumped AS Conc
    C_ghost  AS UndeclaredType
    C_extra  AS Conc

  EQUATION
    $C_lumped = -k * C_lumped + PARTIAL(C_lumped, BadAxial) + ghost_ident ;
END

MODEL EmptyModel
END

PROCESS FlawedProcess
  UNIT
    U1 AS FlawedReactor
  SET
    U1.k := 0.2 ;
    U1.k := 0.3 ;
    U1.C_lumped := 1.0 ;
  ASSIGN
    U1.k := 0.5 ;
  INITIAL
END
`;

  const doc = parseGproms(flawedSource);
  const diags = lintGproms(doc);
  const codes = new Set(diags.map((d) => d.code));

  assert.ok(codes.has(GpromsErrorCode.UNDECLARED_VARIABLE_TYPE.code), "Expected M9451 undeclared variable type");
  assert.ok(codes.has(GpromsErrorCode.INVALID_VARIABLE_BOUNDS.code), "Expected M9452 invalid variable bounds");
  assert.ok(codes.has(GpromsErrorCode.INVALID_DISTRIBUTION_DOMAIN.code), "Expected M9453 invalid distribution domain");
  assert.ok(
    codes.has(GpromsErrorCode.UNDECLARED_EQUATION_IDENTIFIER.code),
    "Expected M9454 undeclared equation identifier",
  );
  assert.ok(codes.has(GpromsErrorCode.STRUCTURAL_DOF_MISMATCH.code), "Expected M9455 structural DOF mismatch");
  assert.ok(
    codes.has(GpromsErrorCode.UNINITIALIZED_DIFFERENTIAL_STATE.code),
    "Expected M9456 uninitialized differential state",
  );
  assert.ok(
    codes.has(GpromsErrorCode.PARTIAL_ON_NON_DISTRIBUTED_VARIABLE.code),
    "Expected M9457 PARTIAL on non-distributed variable",
  );
  assert.ok(
    codes.has(GpromsErrorCode.OVERASSIGNED_PARAMETER_OR_VARIABLE.code),
    "Expected M9458 overassigned parameter or variable",
  );
  assert.ok(codes.has(GpromsErrorCode.EMPTY_GPROMS_MODEL.code), "Expected M9459 empty gPROMS model");
  assert.ok(codes.has(GpromsErrorCode.DUPLICATE_ENTITY_DECLARATION.code), "Expected M9460 duplicate declaration");
});

test("gPROMS Solver: simulates lumped isothermal CSTR to analytical steady-state conversion", () => {
  const doc = parseGproms(VALID_CSTR_GPROMS);
  const sim = solveGpromsProcess(doc, { duration: 25.0, timeStep: 0.02 });

  assert.equal(sim.modelName, "IsothermalCSTR");
  assert.equal(sim.processName, "CstrSimulation");

  // Analytical steady state for CSTR:
  // tau = V / F = 10 / 2 = 5 s
  // C_A_ss = C_A_in / (1 + k * tau) = 5.0 / (1 + 0.3 * 5) = 5.0 / 2.5 = 2.0 mol/L
  // C_B_ss = C_A_in - C_A_ss = 3.0 mol/L
  const caFinal = sim.finalStates["C_A"] ?? 0;
  const cbFinal = sim.finalStates["C_B"] ?? 0;

  assert.ok(Math.abs(caFinal - 2.0) < 0.02, `Expected C_A_ss ~ 2.0, got ${caFinal}`);
  assert.ok(Math.abs(cbFinal - 3.0) < 0.02, `Expected C_B_ss ~ 3.0, got ${cbFinal}`);
  // Mass balance conservation: C_A + C_B == C_A_in == 5.0
  assert.ok(Math.abs(caFinal + cbFinal - 5.0) < 1e-4);
});

test("gPROMS Solver: simulates 1D tubular reactor PDE-DAE via Method-of-Lines (MOL) RK4", () => {
  const doc = parseGproms(VALID_TUBULAR_PFR_GPROMS);
  const sim = solveGpromsProcess(doc, { duration: 8.0, timeStep: 0.005 });

  const profile = sim.finalSpatialProfiles["C"];
  assert.ok(profile);
  assert.equal(profile.length, 11);

  // Inlet node C_0 pinned to C_in = 10.0
  assert.ok(Math.abs((profile[0] ?? 0) - 10.0) < 1e-6);

  // Monotonically decreasing axial concentration profile along reactor length
  for (let i = 1; i < profile.length; i++) {
    assert.ok(
      (profile[i] ?? 0) < (profile[i - 1] ?? 0),
      `Expected C_${i} (${profile[i]}) < C_${i - 1} (${profile[i - 1]})`,
    );
  }

  // Analytical plug-flow conversion with dispersion: outlet C(L=1) ~ 10 * exp(-k*L/v) = 10 * exp(-0.8) ~ 4.493
  const outletC = sim.finalStates["C"] ?? 0;
  assert.ok(outletC > 4.0 && outletC < 5.0, `Expected outlet concentration ~ 4.49, got ${outletC}`);
});

test("gPROMS DAE Lowering: lowers lumped CSTR and discretized MOL PFR into square DAEBuilder", () => {
  const cstrDoc = parseGproms(VALID_CSTR_GPROMS);
  const cstrDae = lowerGpromsToDae(cstrDoc);
  assert.equal(cstrDae.variables().length, cstrDae.equations().length, "CSTR DAE must be structurally square");
  assert.notEqual(cstrDae.lookupVariable("C_A"), -1);
  assert.notEqual(cstrDae.lookupVariable("C_B"), -1);
  assert.notEqual(cstrDae.lookupVariable("r"), -1);

  const pfrDoc = parseGproms(VALID_TUBULAR_PFR_GPROMS);
  const pfrDae = lowerGpromsToDae(pfrDoc);
  assert.equal(pfrDae.variables().length, pfrDae.equations().length, "Discretized PFR DAE must be structurally square");
  assert.notEqual(pfrDae.lookupVariable("C_0"), -1);
  assert.notEqual(pfrDae.lookupVariable("C_10"), -1);
  assert.notEqual(pfrDae.lookupVariable("C"), -1);
});

test("gPROMS Modelica Projection, WorkspaceIndex, and LSP services", async () => {
  const doc = parseGproms(VALID_TUBULAR_PFR_GPROMS);
  const mo = gpromsToModelica(doc, "TubularReactorMo");

  assert.ok(mo.includes("model TubularReactorMo"));
  assert.ok(mo.includes("parameter Real dz_Axial"));
  assert.ok(mo.includes("C_0 = C_in;"));
  assert.ok(mo.includes("der(C_1) ="));
  assert.ok(mo.includes("end TubularReactorMo;"));

  // WorkspaceIndex
  const index = new GpromsWorkspaceIndex();
  index.indexFile("file:///proc/cstr.gproms", VALID_CSTR_GPROMS);
  assert.equal(index.fileCount, 1);
  assert.ok(index.findDefinition("IsothermalCSTR"));
  assert.ok(index.findDefinition("Concentration"));
  assert.ok(index.findDefinition("C_A"));
  assert.ok(index.findDefinition("CstrSimulation"));

  // LSP validation, symbols, hover, completions, and actions
  const lspDiags = validateGproms(VALID_CSTR_GPROMS);
  assert.equal(lspDiags.length, 0);

  const docSymbols = getGpromsDocumentSymbols(VALID_CSTR_GPROMS);
  assert.ok(docSymbols.length >= 4);

  const hover = getGpromsHover(VALID_CSTR_GPROMS, { line: 3, character: 6 });
  assert.ok(hover);
  assert.ok(hover.contents.value.includes("Concentration"));

  const completions = provideGpromsCompletions();
  assert.ok(completions.length >= 4);

  const daeInfo = await executeGpromsAction("gproms_to_dae", VALID_CSTR_GPROMS);
  assert.equal(daeInfo.variableCount, daeInfo.equationCount);
  assert.equal(gpromsLanguage.name, "gproms");
});
