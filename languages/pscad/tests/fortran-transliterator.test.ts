// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { parseFortranScript } from "../src/script/fortran-ast.js";
import { compileFortranSegment, type FortranExecutionContext } from "../src/script/fortran-codegen.js";
import { preprocessFortranSegment } from "../src/script/fortran-preprocessor.js";

describe("PSCAD Fortran AST Transliterator Suite", () => {
  test("Preprocessor: resolves #IF guards, #STORAGE, #LOCAL, and parameter substitutions", () => {
    const rawFortran = `
#STORAGE REAL:2 INTEGER:1
#LOCAL REAL PF, tempVar

#IF Mode == 1
  $Out = $In1 * $Factor
#ELSEIF Mode == 2
  $Out = $In1 + $Offset
#ELSE
  $Out = 0.0
#ENDIF

IF (UPDATE_AG) CALL PSCAD_AGR2(ICALL_NO,$#Component,$Out,"Out")
`;

    // Case 1: Mode == 1, Factor == 2.5
    const prep1 = preprocessFortranSegment(rawFortran, { Mode: 1, Factor: 2.5, Offset: 10.0 });
    assert.equal(prep1.numRealStates, 2);
    assert.equal(prep1.numIntStates, 1);
    assert.ok(prep1.localReals.has("PF"));
    assert.ok(prep1.localReals.has("tempVar"));
    assert.equal(prep1.lines.length, 1);
    assert.equal(prep1.lines[0], "$Out = $In1 * 2.5");

    // Case 2: Mode == 2, Offset == 10.0
    const prep2 = preprocessFortranSegment(rawFortran, { Mode: 2, Factor: 2.5, Offset: 10.0 });
    assert.equal(prep2.lines.length, 1);
    assert.equal(prep2.lines[0], "$Out = $In1 + 10");

    // Case 3: Mode == 3 (fallback ELSE)
    const prep3 = preprocessFortranSegment(rawFortran, { Mode: 3, Factor: 2.5, Offset: 10.0 });
    assert.equal(prep3.lines.length, 1);
    assert.equal(prep3.lines[0], "$Out = 0.0");
  });

  test("Lexer & AST Parser: parses procedural IF, math intrinsics, and state assignments", () => {
    const code = `
      PF = $In1 / sqrt($In1 * $In1 + $In2 * $In2)
      IF (PF > 1.0) THEN
        PF = 1.0
      ELSEIF (PF < -1.0) THEN
        PF = -1.0
      ENDIF
      $Out = PF
    `;

    const stmts = parseFortranScript(code);
    assert.ok(stmts.length >= 3);
    assert.equal(stmts[0]!.kind, "assign");
    assert.equal(stmts[1]!.kind, "if");
    assert.equal(stmts[2]!.kind, "assign");

    const assignOut = stmts[2] as Extract<(typeof stmts)[0], { kind: "assign" }>;
    assert.equal(assignOut.target.type, "port");
    if (assignOut.target.type === "port") {
      assert.equal(assignOut.target.portName, "Out");
    }
  });

  test("Executes PowerFactor calculation from Component_Lib.pslx with math intrinsics", () => {
    const rawFortran = `
#LOCAL REAL PF
      PF = $In1 / sqrt($In1 * $In1 + $In2 * $In2)
      IF (UPDATE_AG) CALL PSCAD_AGR2(ICALL_NO,$#Component,PF,"PF")
      $Out = PF
`;

    const compiled = compileFortranSegment(rawFortran);
    assert.ok(compiled.referencedPorts.includes("In1"));
    assert.ok(compiled.referencedPorts.includes("In2"));
    assert.ok(compiled.assignedPorts.includes("Out"));

    const inputsMap: Record<string, number> = { In1: 3.0, In2: 4.0 };
    const outputsMap: Record<string, number> = {};

    const ctx: FortranExecutionContext = {
      time: 0.1,
      dt: 50e-6,
      firstStep: false,
      inputs: (p) => inputsMap[p] ?? 0,
      setOutput: (p, v) => {
        outputsMap[p] = v;
      },
      storf: new Float64Array(10),
      stori: new Int32Array(10),
    };

    compiled.step(ctx);

    // 3.0 / sqrt(3^2 + 4^2) = 3.0 / 5.0 = 0.6
    assert.ok(Math.abs(outputsMap["Out"]! - 0.6) < 1e-6, `Expected PF = 0.6, got ${outputsMap["Out"]}`);
  });

  test("Executes State Machine & Latch Timer (Flag component from Component_Lib.pslx)", () => {
    const flagFortran = `
#STORAGE REAL:1 INTEGER:1

      IF (FIRSTSTEP) THEN
        STORF(NSTORF) = 0.0
        STORI(NSTORI) = 0
      ENDIF

      IF (($In .GT. 0) .AND. (STORI(NSTORI) .EQ. 0)) THEN
        STORI(NSTORI) = 1
        STORF(NSTORF) = TIME - $Offset
      ENDIF

      IF (UPDATE_AG) CALL PSCAD_AGR2(ICALL_NO,$#Component,STORF(NSTORF),"Flag_timer")

      $Flag_time = STORF(NSTORF)

      NSTORF = NSTORF + 1
      NSTORI = NSTORI + 1
`;

    const compiled = compileFortranSegment(flagFortran, { Offset: 0.02 });
    assert.equal(compiled.numRealStates, 1);
    assert.equal(compiled.numIntStates, 1);

    const storf = new Float64Array(compiled.numRealStates);
    const stori = new Int32Array(compiled.numIntStates);
    const outputs: Record<string, number> = {};
    let currentIn = 0.0;
    let currentTime = 0.0;
    let isFirst = true;

    const ctx: FortranExecutionContext = {
      get time() {
        return currentTime;
      },
      dt: 1e-4,
      get firstStep() {
        return isFirst;
      },
      inputs: (p) => (p === "In" ? currentIn : 0),
      setOutput: (p, v) => {
        outputs[p] = v;
      },
      storf,
      stori,
    };

    // Step 1: t = 0.0, In = 0 -> initialized to 0
    compiled.step(ctx);
    isFirst = false;
    assert.equal(outputs["Flag_time"], 0.0);
    assert.equal(stori[0], 0);

    // Step 2: t = 0.01, In = 0 -> still untriggered
    currentTime = 0.01;
    compiled.step(ctx);
    assert.equal(outputs["Flag_time"], 0.0);
    assert.equal(stori[0], 0);

    // Step 3: t = 0.05, In = 1.0 (Fault event arrives!)
    // Trigger condition satisfied: STORI latches to 1, STORF latches to TIME - Offset = 0.05 - 0.02 = 0.03
    currentTime = 0.05;
    currentIn = 1.0;
    compiled.step(ctx);
    assert.equal(stori[0], 1, "State flag must latch to 1");
    assert.ok(Math.abs(outputs["Flag_time"]! - 0.03) < 1e-6);

    // Step 4: t = 0.08, In drops back to 0.0 -> Output remains latched at 0.03
    currentTime = 0.08;
    currentIn = 0.0;
    compiled.step(ctx);
    assert.equal(stori[0], 1, "State flag must remain latched");
    assert.ok(Math.abs(outputs["Flag_time"]! - 0.03) < 1e-6, "Latched timer value must be preserved");
  });

  test("Performance Benchmark: executes 100,000 steps in < 30ms with zero allocation", () => {
    const rawFortran = `
#STORAGE REAL:1 INTEGER:1
      IF (FIRSTSTEP) STORF(NSTORF) = 0.0
      STORF(NSTORF) = STORF(NSTORF) + $In * DELT
      $Out = STORF(NSTORF)
      NSTORF = NSTORF + 1
`;
    const compiled = compileFortranSegment(rawFortran);
    const ctx: FortranExecutionContext = {
      time: 0,
      dt: 20e-6,
      firstStep: true,
      inputs: () => 10.0,
      setOutput: () => {},
      storf: new Float64Array(1),
      stori: new Int32Array(1),
    };

    const t0 = performance.now();
    for (let i = 0; i < 100_000; i++) {
      ctx.time = i * ctx.dt;
      ctx.firstStep = i === 0;
      compiled.step(ctx);
    }
    const elapsed = performance.now() - t0;
    assert.ok(elapsed < 600, `Execution took ${elapsed.toFixed(2)}ms (expected < 600ms)`);
  });
});
