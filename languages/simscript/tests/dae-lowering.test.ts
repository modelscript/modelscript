// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerSimscriptToDae, resolveSimscriptSchemaParamDefaults, simscriptToDae } from "../src/dae/index.js";
import { parseSimscript } from "../src/parser/index.js";

const JOB_SHOP_MODEL = `
'' MODEL: JobShopMMC
PREAMBLE
  PROCESSES
    INCLUDE ARRIVAL
    INCLUDE JOB
  RESOURCES
    EVERY MACHINE
  TALLY MEAN.FLOWTIME AS THE MEAN OF FLOW.TIME
  ACCUMULATE AVG.UTIL AS THE MEAN OF N.X.MACHINE
  ACCUMULATE AVG.QUEUE AS THE MEAN OF N.Q.MACHINE
END

MAIN
  LET U.MACHINE = 3
  ACTIVATE A ARRIVAL NOW
  START SIMULATION
END

PROCESS ARRIVAL
  ACTIVATE A JOB NOW
  ACTIVATE A ARRIVAL IN EXPONENTIAL.F(1.25, 1)
END

PROCESS JOB
  REQUEST 1 MACHINE
  WORK EXPONENTIAL.F(2.5, 2)
  RELINQUISH 1 MACHINE
END
`;

describe("SIMSCRIPT II.5 Direct DAE Arena Lowering", () => {
  it("lowers SIMSCRIPT resources and TALLY/ACCUMULATE invariants directly into DAEBuilder", () => {
    const model = parseSimscript(JOB_SHOP_MODEL);
    const builder = new DAEBuilder(undefined, "JobShopMMC");
    const result = lowerSimscriptToDae(builder, model);

    assert.ok(result.stateVarIndices.length >= 1, "Expected at least one queue state variable");
    assert.ok(result.equationCount >= 7, `Expected >= 7 equations (4 resource + 3 stats), got ${result.equationCount}`);
    assert.ok(result.variableMap.has("U_MACHINE"));
    assert.ok(result.variableMap.has("LAMBDA_MACHINE"));
    assert.ok(result.variableMap.has("MU_MACHINE"));
    assert.ok(result.variableMap.has("RHO_MACHINE"));
    assert.ok(result.variableMap.has("BUSY_MACHINE"));
    assert.ok(result.variableMap.has("L_MACHINE"));
    assert.ok(result.variableMap.has("W_MACHINE"));
    assert.ok(result.variableMap.has("Q_MACHINE"));
    assert.ok(result.variableMap.has("ACCUMULATE_AVG_UTIL"));
    assert.ok(result.variableMap.has("ACCUMULATE_AVG_QUEUE"));
    assert.ok(result.variableMap.has("TALLY_MEAN_FLOWTIME"));
  });

  it("constructs a standalone DAEBuilder via simscriptToDae and resolves stdlib schema defaults", () => {
    const model = parseSimscript(JOB_SHOP_MODEL);
    const dae = simscriptToDae(model);
    assert.ok(dae.lookupVariable("rho_MACHINE") !== -1);
    assert.ok(dae.lookupVariable("L_MACHINE") !== -1);

    const defaults = resolveSimscriptSchemaParamDefaults("EXPONENTIAL.F", { MEAN: 4.0 });
    assert.strictEqual(defaults["MEAN"], 4.0);
    assert.strictEqual(defaults["STREAM"], 1);
  });
});
