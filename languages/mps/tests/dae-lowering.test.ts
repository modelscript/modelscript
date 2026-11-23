// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder, VarType } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerMpsToDae, mpsToDae, parseMps } from "../src/index.js";

describe("@modelscript/mps DAE Lowering Suite", () => {
  it("lowers LP sparse matrix directly to @modelscript/runtime DAEBuilder", () => {
    const lp = `
NAME          LP_DAE
ROWS
 N  COST
 L  CAP
 G  DEMAND
 E  BAL
COLUMNS
    X1        COST      2        CAP       1
    X1        BAL       1
    X2        COST      3        CAP       2
    X2        DEMAND    1        BAL       -1
RHS
    RHS1      CAP       10       DEMAND    2
    RHS1      BAL       0
ENDATA
`;
    const model = parseMps(lp);
    const builder = new DAEBuilder(undefined, "LP_DAE");
    const res = lowerMpsToDae(builder, model);

    assert.strictEqual(res.variableCount, 2);
    assert.strictEqual(res.slackCount, 2, "Expected 2 slacks for L and G rows");
    assert.strictEqual(res.equationCount, 4, "Expected 1 objective eq + 3 constraint eqs");
    assert.ok(res.variableMap.has("X1"));
    assert.ok(res.variableMap.has("X2"));
    assert.ok(res.slackMap.has("CAP"));
    assert.ok(res.slackMap.has("DEMAND"));
    assert.ok(res.objectiveVarId >= 0);
  });

  it("lowers MILP and QP models preserving integer variable types and quadratic objective", () => {
    const miqp = `
NAME          MIQP_DAE
ROWS
 N  OBJ
 L  R1
COLUMNS
    X1        OBJ       -2       R1        1
    MARK0001  'MARKER'           'INTORG'
    Y1        OBJ       -4       R1        2
    MARK0002  'MARKER'           'INTEND'
RHS
    RHS1      R1        5
BOUNDS
 BV BND1      Y1
QUADOBJ
    X1        X1        2
    X1        Y1        1
    Y1        Y1        2
ENDATA
`;
    const builder = mpsToDae(miqp);
    assert.ok(builder, "mpsToDae should return a DAEBuilder instance");
    const x1Id = builder.lookupVariable("X1");
    const y1Id = builder.lookupVariable("Y1");
    assert.ok(x1Id >= 0, "X1 should exist in DAE arena");
    assert.ok(y1Id >= 0, "Y1 should exist in DAE arena");
    assert.strictEqual(builder.getVarType(x1Id), VarType.Real);
    assert.strictEqual(builder.getVarType(y1Id), VarType.Integer);
  });
});
