// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gpssToDae, lowerGpssToDae } from "../src/dae/index.js";
import { parseGpss } from "../src/parser/index.js";

describe("GPSS Linear-Memory DAE Lowering", () => {
  it("lowers single-server facility and queue balance equations directly to DAEBuilder", () => {
    const model = parseGpss(`
* MODEL: BarbershopDAE
      GENERATE 18,6
      QUEUE    LINE
      SEIZE    JOE
      DEPART   LINE
      ADVANCE  16,4
      RELEASE  JOE
      TERMINATE 1
      START    100
`);
    const dae = gpssToDae(model);

    assert.ok(dae.varCount >= 12, `Expected >= 12 DAE variables, got ${dae.varCount}`);
    assert.ok(dae.eqCount >= 7, `Expected >= 7 DAE equations, got ${dae.eqCount}`);
    assert.notStrictEqual(dae.lookupVariable("fac_JOE_rho"), -1);
    assert.notStrictEqual(dae.lookupVariable("fac_JOE_FR"), -1);
    assert.notStrictEqual(dae.lookupVariable("fac_JOE_L"), -1);
    assert.notStrictEqual(dae.lookupVariable("fac_JOE_W"), -1);
    assert.notStrictEqual(dae.lookupVariable("que_LINE_Q"), -1);
  });

  it("lowers multi-server STORAGE entities with capacity, utilization, and remaining capacity", () => {
    const model = parseGpss(`
CHAIRS STORAGE 3
      GENERATE 5,FN$EXPON
      QUEUE    LOBBY
      ENTER    CHAIRS,1
      DEPART   LOBBY
      ADVANCE  12,FN$EXPON
      LEAVE    CHAIRS,1
      TERMINATE 1
      START    100
`);
    const builder = new DAEBuilder(undefined, "MultiServerDAE");
    const result = lowerGpssToDae(builder, model);

    assert.ok(result.equationCount >= 6);
    assert.strictEqual(result.stateVarIndices.length, 1);
    assert.ok(result.variableMap.has("STO_CHAIRS_CAPACITY"));
    assert.ok(result.variableMap.has("STO_CHAIRS_RHO"));
    assert.ok(result.variableMap.has("STO_CHAIRS_SR"));
    assert.ok(result.variableMap.has("STO_CHAIRS_R"));
  });
});
