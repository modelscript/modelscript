// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Benchmark runner for Pharmacometrics & Population PK/PD (NONMEM NM-TRAN).
 *
 * Evaluates:
 * 1. Two-compartment oral pharmacokinetic study deck (ADVAN4 TRANS4)
 * 2. Mixed-effects parameterization ($THETA, $OMEGA, $SIGMA) with inter-individual variability
 * 3. Multi-dose non-linear numerical integration (II=12, ADDL=1) and PK metrics (Cmax, Tmax, AUC)
 * 4. Structural compartment state-space lowering into square DAEBuilder arena
 */

import assert from "node:assert/strict";
import {
  parseNmtran,
  solveNmtranPkPd,
  lowerNmtranToDae,
  type NmtranDocument,
  type PkPdSimulationResult,
} from "../src/index.js";

export const TWO_CMT_ORAL_CTL_BENCHMARK = `$PROBLEM Two-Compartment Oral PK Study
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

export interface NmtranBenchmarkMetrics {
  problem: string;
  advan: string;
  trans: string;
  compartmentCount: number;
  cMax: number;
  tMax: number;
  auc0ToInf: number;
  daeVarCount: number;
  daeEqCount: number;
  isSquare: boolean;
}

export function runNmtranBenchmark(ctlStr = TWO_CMT_ORAL_CTL_BENCHMARK): NmtranBenchmarkMetrics {
  const doc: NmtranDocument = parseNmtran(ctlStr, "two_cmt.ctl");
  const cs = doc.controlStream;
  assert.equal(cs.hasProblemRecord, true);
  assert.equal(cs.subroutines.advan, "ADVAN4");
  assert.equal(cs.subroutines.trans, "TRANS4");

  const sim: PkPdSimulationResult = solveNmtranPkPd(doc, { duration: 24.0, timeStep: 0.05 });
  assert.equal(sim.compartmentCount, 3);
  assert.ok(sim.metrics.cMax > 0.0);
  assert.ok(sim.metrics.tMax > 0.0);
  assert.ok(sim.metrics.auc0ToInf > 0.0);

  // Lower into linear memory DAEBuilder arena
  const dae = lowerNmtranToDae(doc);
  const varCount = dae.varCount;
  const eqCount = dae.eqCount;

  assert.ok(varCount >= 14);
  assert.equal(varCount, eqCount);

  return {
    problem: cs.problem,
    advan: cs.subroutines.advan,
    trans: cs.subroutines.trans,
    compartmentCount: sim.compartmentCount,
    cMax: sim.metrics.cMax,
    tMax: sim.metrics.tMax,
    auc0ToInf: sim.metrics.auc0ToInf,
    daeVarCount: varCount,
    daeEqCount: eqCount,
    isSquare: varCount === eqCount,
  };
}

if (process.argv[1]?.endsWith("nmtran-benchmark-runner.ts")) {
  const m = runNmtranBenchmark();
  console.log("NMTRAN Benchmark Results:", m);
}
