// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { preprocessFortran } from "../src/preprocessor.js";

describe("@modelscript/fortran Preprocessor Suite", () => {
  test("extracts #STORAGE REAL and INTEGER state allocations", () => {
    const src = `
#STORAGE REAL:4 INTEGER:2
STORF(0) = 1.0
STORI(0) = 5
`;
    const res = preprocessFortran(src);
    assert.equal(res.numRealStates, 4);
    assert.equal(res.numIntStates, 2);
    assert.ok(res.code.includes("STORF(0) = 1.0"));
  });

  test("processes #IF / #ELSE conditional compilation with parameter evaluations", () => {
    const src = `
#IF ($Mode == 1)
  STORF(0) = $Gain * 10.0
#ELSEIF ($Mode == 2)
  STORF(0) = $Gain * 20.0
#ELSE
  STORF(0) = -999.0
#ENDIF
`;
    const res1 = preprocessFortran(src, { Mode: 1, Gain: 2.5 });
    assert.ok(res1.code.includes("STORF(0) = 2.5 * 10.0"));
    assert.ok(!res1.code.includes("20.0"));
    assert.ok(!res1.code.includes("-999.0"));

    const res2 = preprocessFortran(src, { Mode: 2, Gain: 3.0 });
    assert.ok(res2.code.includes("STORF(0) = 3 * 20.0"));
    assert.ok(!res2.code.includes("10.0"));

    const res3 = preprocessFortran(src, { Mode: 3, Gain: 1.0 });
    assert.ok(res3.code.includes("STORF(0) = -999.0"));
  });

  test("expands $#DIM(port) port dimension directives", () => {
    const src = `
INTEGER n
n = $#DIM(Inputs)
`;
    const res = preprocessFortran(src, {}, { Inputs: 3 });
    assert.ok(res.code.includes("n = 3"));
  });

  test("converts #LOCAL REAL and INTEGER into valid Fortran declarations", () => {
    const src = `
#LOCAL REAL Tau, Omega
#LOCAL INTEGER idx, count
Tau = 0.01
`;
    const res = preprocessFortran(src);
    assert.ok(res.localReals.has("Tau") && res.localReals.has("Omega"));
    assert.ok(res.localInts.has("idx") && res.localInts.has("count"));
  });

  test("tracks referenced and assigned input/output ports", () => {
    const src = `
STORF(0) = $InA + $InB
$OutC = STORF(0) * 2.0
`;
    const res = preprocessFortran(src);
    assert.deepEqual(Array.from(res.referencedPorts).sort(), ["InA", "InB"]);
    assert.deepEqual(Array.from(res.assignedPorts).sort(), ["OutC"]);
  });
});
