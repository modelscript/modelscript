// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert/strict";
import test from "node:test";
import {
  NmtranErrorCode,
  executeNmtranAction,
  getNmtranDocumentSymbols,
  getNmtranHover,
  lintNmtran,
  lowerNmtranToDae,
  nmtranLanguage,
  nmtranToModelica,
  parseNmtran,
  provideNmtranCompletions,
  serializeNmtran,
  solveNmtranPkPd,
  validateNmtran,
} from "../src/index.js";

const TWO_CMT_ORAL_CTL = `$PROBLEM Two-Compartment Oral PK Study
$INPUT ID TIME AMT DV CMT EVID II ADDL
$DATA oral_pk.csv IGNORE=@
$SUBROUTINES ADVAN4 TRANS4
$PK
  CL = THETA(1) * EXP(ETA(1))
  V2 = THETA(2) * EXP(ETA(2))
  Q  = THETA(3)
  V3 = THETA(4)
  KA = THETA(5)
  S2 = V2
$ERROR
  IPRED = F
  W = IPRED * 0.1
  Y = IPRED + W * EPS(1)
$THETA
  (0, 5.0, 50.0)   ; CL (L/h)
  (0, 20.0, 200.0) ; V2 (L)
  (0, 4.0, 50.0)   ; Q (L/h)
  (0, 40.0, 500.0) ; V3 (L)
  (0, 1.2, 10.0)   ; KA (1/h)
$OMEGA
  0.04 ; IIV_CL
  0.04 ; IIV_V2
$SIGMA
  0.01 ; RUV_PROP
$ESTIMATION METHOD=1 INTERACTION MAXEVAL=9999 SIGDIGITS=3 PRINT=5 NOABORT POSTHOC
$SIMULATION (12345) SUBPROBLEMS=100 ONLYSIMULATION
$DOSE
  TIME=0 AMT=100 RATE=0 CMT=1 EVID=1 II=12 ADDL=1
`;

const CUSTOM_DES_CTL = `$PROBLEM Custom Two-Compartment $DES Model
$INPUT ID TIME AMT DV CMT EVID
$DATA des_pk.csv IGNORE=#
$SUBROUTINES ADVAN6 TOL=6
$MODEL NCOMPARTMENTS=2 COMP=(DEPOT DEFDOSE) COMP=(CENTRAL DEFOBS)
$PK
  KA = THETA(1) * EXP(ETA(1))
  CL = THETA(2) * EXP(ETA(2))
  V  = THETA(3)
  K  = CL / V
  S2 = V
$DES
  DADT(1) = -KA * A(1)
  DADT(2) = KA * A(1) - K * A(2)
$ERROR
  IPRED = A(2) / V
  Y = IPRED * (1 + EPS(1))
$THETA
  (0, 1.0, 10.0) ; KA (1/h)
  (0, 4.0, 40.0) ; CL (L/h)
  20.0 FIX       ; V (L)
$OMEGA
  0.09
  0.0 FIX
$SIGMA
  0.02
$DOSE
  TIME=0 AMT=200 RATE=0 CMT=1 EVID=1 II=0 ADDL=0
`;

test("NMTRAN Parser: parses $PROBLEM, $SUBROUTINES, $PK, $ERROR, $THETA, $OMEGA, $SIGMA, $ESTIMATION, $SIMULATION, and $DOSE", () => {
  const doc = parseNmtran(TWO_CMT_ORAL_CTL, "two_cmt.ctl");
  const cs = doc.controlStream;

  assert.equal(cs.hasProblemRecord, true);
  assert.equal(cs.problem, "Two-Compartment Oral PK Study");
  assert.deepEqual(cs.inputs, ["ID", "TIME", "AMT", "DV", "CMT", "EVID", "II", "ADDL"]);
  assert.equal(cs.dataFile, "oral_pk.csv");
  assert.deepEqual(cs.ignoreChars, ["@"]);

  assert.equal(cs.subroutines.advan, "ADVAN4");
  assert.equal(cs.subroutines.trans, "TRANS4");

  assert.equal(cs.pkStatements.length, 6);
  assert.equal(cs.pkStatements[0]?.lhs, "CL");
  assert.deepEqual(cs.pkStatements[0]?.thetaRefs, [1]);
  assert.deepEqual(cs.pkStatements[0]?.etaRefs, [1]);

  assert.equal(cs.hasErrorBlock, true);
  assert.equal(cs.errorStatements.length, 3);
  assert.equal(cs.errorStatements[2]?.lhs, "Y");
  assert.deepEqual(cs.errorStatements[2]?.epsRefs, [1]);

  assert.equal(cs.thetas.length, 5);
  assert.equal(cs.thetas[0]?.init, 5.0);
  assert.equal(cs.thetas[0]?.lower, 0);
  assert.equal(cs.thetas[0]?.upper, 50.0);
  assert.equal(cs.thetas[0]?.name, "CL");
  assert.equal(cs.thetas[0]?.units, "L/h");

  assert.equal(cs.omegas.length, 2);
  assert.equal(cs.omegas[0]?.variance, 0.04);
  assert.equal(cs.omegas[0]?.name, "IIV_CL");

  assert.equal(cs.sigmas.length, 1);
  assert.equal(cs.sigmas[0]?.variance, 0.01);

  assert.equal(cs.estimations.length, 1);
  assert.equal(cs.estimations[0]?.method, "1");
  assert.equal(cs.estimations[0]?.interaction, true);
  assert.equal(cs.estimations[0]?.maxEval, 9999);

  assert.ok(cs.simulation);
  assert.equal(cs.simulation.seed, 12345);
  assert.equal(cs.simulation.subProblems, 100);
  assert.equal(cs.simulation.onlySimulation, true);

  assert.equal(cs.dosingRecords.length, 1);
  assert.equal(cs.dosingRecords[0]?.amt, 100);
  assert.equal(cs.dosingRecords[0]?.ii, 12);
  assert.equal(cs.dosingRecords[0]?.addl, 1);
});

test("NMTRAN Parser & Serializer: parses $MODEL, $DES, fixed $THETA/$OMEGA, and roundtrips cleanly", () => {
  const doc = parseNmtran(CUSTOM_DES_CTL);
  const cs = doc.controlStream;

  assert.equal(cs.nCompartments, 2);
  assert.equal(cs.compartments.length, 2);
  assert.equal(cs.compartments[0]?.name, "DEPOT");
  assert.equal(cs.compartments[0]?.defDose, true);
  assert.equal(cs.compartments[1]?.name, "CENTRAL");
  assert.equal(cs.compartments[1]?.defObs, true);

  assert.equal(cs.hasDesBlock, true);
  assert.equal(cs.desEquations.length, 2);
  assert.equal(cs.desEquations[0]?.isDerivative, true);
  assert.equal(cs.desEquations[0]?.compartmentIndex, 1);
  assert.deepEqual(cs.desEquations[1]?.compartmentRefs, [2, 1]);

  assert.equal(cs.thetas[2]?.fixed, true);
  assert.equal(cs.omegas[1]?.fixed, true);

  const serialized = serializeNmtran(doc);
  const reparsed = parseNmtran(serialized);
  assert.equal(reparsed.controlStream.problem, cs.problem);
  assert.equal(reparsed.controlStream.thetas.length, cs.thetas.length);
  assert.equal(reparsed.controlStream.desEquations.length, cs.desEquations.length);
  assert.equal(reparsed.controlStream.compartments.length, cs.compartments.length);
});

test("NMTRAN Linter: valid control streams produce zero diagnostics", () => {
  const doc1 = parseNmtran(TWO_CMT_ORAL_CTL);
  assert.equal(lintNmtran(doc1).length, 0);

  const doc2 = parseNmtran(CUSTOM_DES_CTL);
  assert.equal(lintNmtran(doc2).length, 0);
});

test("NMTRAN Linter: triggers all 10 pre-flight diagnostic rules (M9401 - M9410)", () => {
  // M9401: missing $PROBLEM record & M9402: $THETA bounds violation
  const m9401And9402 = parseNmtran(`
$SUBROUTINES ADVAN1 TRANS2
$PK
  CL = THETA(1)
  V  = THETA(2)
$ERROR
  Y = F
$THETA
  (10.0, 5.0, 50.0)
  (0.0, 200.0, 100.0)
`);
  const diags12 = lintNmtran(m9401And9402);
  assert.ok(diags12.some((d) => d.code === NmtranErrorCode.MISSING_PROBLEM_RECORD.code));
  assert.ok(diags12.some((d) => d.code === NmtranErrorCode.THETA_BOUNDS_VIOLATION.code));

  // M9403: missing $DES block for general ADVAN6 / ADVAN13
  const m9403 = parseNmtran(`
$PROBLEM Missing DES Block
$SUBROUTINES ADVAN13 TOL=6
$MODEL NCOMPARTMENTS=2 COMP=(DEPOT) COMP=(CENTRAL)
$PK
  CL = THETA(1)
$ERROR
  Y = F
$THETA 5.0
`);
  const diags3 = lintNmtran(m9403);
  assert.ok(diags3.some((d) => d.code === NmtranErrorCode.MISSING_DES_BLOCK_FOR_GENERAL_ADVAN.code));

  // M9404: undefined THETA(n) & M9405: undefined ETA(n) & M9406: non-positive $OMEGA variance
  const m9404To9406 = parseNmtran(`
$PROBLEM Undefined Refs and Bad Omega
$SUBROUTINES ADVAN1 TRANS2
$PK
  CL = THETA(1) * EXP(ETA(1))
  V  = THETA(3) * EXP(ETA(2))
$ERROR
  Y = F
$THETA 5.0
$OMEGA -0.04
`);
  const diags456 = lintNmtran(m9404To9406);
  assert.ok(diags456.some((d) => d.code === NmtranErrorCode.UNDEFINED_THETA_REFERENCE.code));
  assert.ok(diags456.some((d) => d.code === NmtranErrorCode.UNDEFINED_ETA_REFERENCE.code));
  assert.ok(diags456.some((d) => d.code === NmtranErrorCode.NON_POSITIVE_OMEGA_VARIANCE.code));

  // M9407: compartment index out of bounds & M9408: missing Y in $ERROR
  const m9407And9408 = parseNmtran(`
$PROBLEM Out of Bounds Compartment and Missing Y
$SUBROUTINES ADVAN6
$MODEL NCOMPARTMENTS=2 COMP=(DEPOT) COMP=(CENTRAL)
$PK
  K = THETA(1)
$DES
  DADT(1) = -K * A(1)
  DADT(3) = K * A(1)
$ERROR
  IPRED = F
$THETA 0.5
`);
  const diags78 = lintNmtran(m9407And9408);
  assert.ok(diags78.some((d) => d.code === NmtranErrorCode.COMPARTMENT_INDEX_OUT_OF_BOUNDS.code));
  assert.ok(diags78.some((d) => d.code === NmtranErrorCode.MISSING_ERROR_PREDICTION_Y.code));

  // M9409: missing required TRANS parameter (KA missing in ADVAN2 TRANS2) & M9410: negative dosing AMT/RATE
  const m9409And9410 = parseNmtran(`
$PROBLEM Missing KA and Negative Dose
$SUBROUTINES ADVAN2 TRANS2
$PK
  CL = THETA(1)
  V  = THETA(2)
$ERROR
  Y = F
$THETA 5.0 20.0
$DOSE TIME=0 AMT=-50 RATE=-10 CMT=1
`);
  const diags910 = lintNmtran(m9409And9410);
  assert.ok(
    diags910.some(
      (d) => d.code === NmtranErrorCode.MISSING_REQUIRED_TRANS_PARAMETER.code && d.message.includes("'KA'"),
    ),
  );
  assert.ok(diags910.some((d) => d.code === NmtranErrorCode.NEGATIVE_DOSING_AMOUNT.code));
});

test("NMTRAN PK/PD Solver: analytically verifies 1-compartment IV bolus Cmax, half-life, and AUC", () => {
  const oneCmtIv = parseNmtran(`
$PROBLEM 1-Cmt IV Bolus
$SUBROUTINES ADVAN1 TRANS2
$PK
  CL = THETA(1)
  V  = THETA(2)
  S1 = V
$ERROR
  IPRED = F
  Y = IPRED
$THETA
  5.0  ; CL (L/h)
  20.0 ; V (L)
$DOSE
  TIME=0 AMT=100 RATE=0 CMT=1 EVID=1 II=0 ADDL=0
`);

  // Analytical: D = 100 mg, V = 20 L, CL = 5 L/h => C(0) = 5.0 mg/L, k = 0.25 1/h, t1/2 = ln(2)/0.25 = 2.7725887 h, AUC_inf = D/CL = 20.0 mg*h/L
  const sim = solveNmtranPkPd(oneCmtIv, { duration: 48.0, timeStep: 0.02 });

  assert.ok(Math.abs(sim.metrics.cMax - 5.0) < 1e-4, `Expected Cmax=5.0, got ${sim.metrics.cMax}`);
  assert.equal(sim.metrics.tMax, 0);
  assert.ok(
    Math.abs(sim.metrics.halfLife - Math.LN2 / 0.25) < 1e-4,
    `Expected halfLife=${Math.LN2 / 0.25}, got ${sim.metrics.halfLife}`,
  );
  assert.ok(Math.abs(sim.metrics.auc0ToInf - 20.0) < 0.05, `Expected AUC0->inf=20.0, got ${sim.metrics.auc0ToInf}`);
});

test("NMTRAN PK/PD Solver: simulates 2-compartment oral multi-dose (II/ADDL) and custom $DES models", () => {
  const oralDoc = parseNmtran(TWO_CMT_ORAL_CTL);
  const oralSim = solveNmtranPkPd(oralDoc, { duration: 24.0, timeStep: 0.05 });

  assert.equal(oralSim.compartmentCount, 3);
  assert.ok(oralSim.metrics.cMax > 0);
  assert.ok(oralSim.metrics.tMax > 0, "Oral absorption Tmax must be > 0");
  // Second dose at t=12h should cause concentration at t=14h to exceed concentration at t=11.5h
  const cBeforeDose2 = oralSim.trajectory.find((p) => Math.abs(p.time - 11.5) < 1e-3)?.centralConcentration ?? 0;
  const cAfterDose2 = oralSim.trajectory.find((p) => Math.abs(p.time - 14.0) < 1e-3)?.centralConcentration ?? 0;
  assert.ok(cAfterDose2 > cBeforeDose2, "Second dose at II=12 ADDL=1 should boost plasma concentration");

  const desDoc = parseNmtran(CUSTOM_DES_CTL);
  const desSim = solveNmtranPkPd(desDoc, { duration: 36.0, timeStep: 0.02 });
  assert.equal(desSim.compartmentCount, 2);
  // Dose = 200 mg, CL = 4 L/h => theoretical AUC(0->inf) = 200 / 4 = 50 mg*h/L
  assert.ok(
    Math.abs(desSim.metrics.auc0ToInf - 50.0) < 0.2,
    `Expected custom $DES AUC0->inf ~ 50.0, got ${desSim.metrics.auc0ToInf}`,
  );
});

test("NMTRAN DAE Lowering: compiles $THETA, $PK, and compartment ODEs into square DAEBuilder", () => {
  const doc = parseNmtran(TWO_CMT_ORAL_CTL);
  const dae = lowerNmtranToDae(doc);

  assert.ok(dae.variables().length >= 14);
  assert.equal(
    dae.variables().length,
    dae.equations().length,
    "Expected structurally square DAE (variables == equations)",
  );
  assert.notEqual(dae.lookupVariable("THETA_1"), -1);
  assert.notEqual(dae.lookupVariable("ETA_1"), -1);
  assert.notEqual(dae.lookupVariable("CL"), -1);
  assert.notEqual(dae.lookupVariable("A_1"), -1);
  assert.notEqual(dae.lookupVariable("A_2"), -1);
  assert.notEqual(dae.lookupVariable("A_3"), -1);
  assert.notEqual(dae.lookupVariable("Y"), -1);
});

test("NMTRAN Modelica Projection: generates valid Modelica 3.x pharmacokinetic model", () => {
  const doc = parseNmtran(CUSTOM_DES_CTL);
  const mo = nmtranToModelica(doc, "CustomTwoCmtPK");

  assert.ok(mo.includes("model CustomTwoCmtPK"));
  assert.ok(mo.includes("parameter Real THETA_1 = 1.0000"));
  assert.ok(mo.includes("Real A_1(start = 200.0000, fixed = true)"));
  assert.ok(mo.includes("der(A_1) = -KA * A_1;"));
  assert.ok(mo.includes("der(A_2) = KA * A_1 - K * A_2;"));
  assert.ok(mo.includes("end CustomTwoCmtPK;"));
});

test("NMTRAN UnifiedWorkspace & LSP: indexes symbols, validates diagnostics, hover, completions, and actions", async () => {
  const ws = new UnifiedWorkspace(nmtranLanguage);
  ws.setDocument("file:///pk/study.ctl", TWO_CMT_ORAL_CTL);

  assert.equal(ws.fileCount, 1);
  assert.ok(ws.getSymbolsForUri("file:///pk/study.ctl").length >= 10);
  assert.ok(ws.findSymbolsByName("CL")[0]);
  assert.ok(ws.findSymbolsByName("THETA(1)")[0]);

  const lspDiags = validateNmtran(TWO_CMT_ORAL_CTL);
  assert.equal(lspDiags.length, 0);

  const docSymbols = getNmtranDocumentSymbols(TWO_CMT_ORAL_CTL);
  assert.equal(docSymbols.length, 1);
  assert.ok((docSymbols[0]?.children?.length ?? 0) >= 8);

  const hover = getNmtranHover(TWO_CMT_ORAL_CTL, { line: 5, character: 10 });
  assert.ok(hover);
  assert.ok(hover.contents.value.includes("THETA(1)"));

  const completions = provideNmtranCompletions(TWO_CMT_ORAL_CTL);
  assert.ok(completions.some((c) => c.label === "$PK"));

  const daeSummary = await executeNmtranAction("nmtran_to_dae", TWO_CMT_ORAL_CTL);
  assert.equal(daeSummary.variableCount, daeSummary.equationCount);
});
