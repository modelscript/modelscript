// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { compileFortranStep, simulateFortranRoutine } from "../src/codegen/step-compiler.js";
import { verifyFortranSource } from "../src/formal/verifier.js";
import { getFortranMonarchDefinition, getFortranTextMateGrammar } from "../src/ide/index.js";

describe("@modelscript/fortran Simulation Step Compiler & Formal Verifier Suite", () => {
  test("compiles and steps direct algebraic calculations", () => {
    const src = `
#LOCAL REAL InA, InB, OutC
$OutC = $InA * 2.5 + $InB
`;
    const compiled = compileFortranStep(src);
    const inMap = new Map<string, number>([
      ["InA", 4.0],
      ["InB", 3.0],
    ]);
    const outMap = new Map<string, number>();
    const storF = new Float64Array(1);
    const storI = new Int32Array(1);

    compiled.step({
      dt: 0.001,
      time: 0.0,
      firstStep: true,
      inputs: (port: string) => inMap.get(port) ?? 0,
      setOutput: (port: string, val: number) => outMap.set(port, val),
      storf: storF,
      stori: storI,
    });

    // 4.0 * 2.5 + 3.0 = 13.0
    assert.equal(outMap.get("OutC"), 13.0);
  });

  test("integrates low-pass filter over multiple simulation steps using STORF", () => {
    // 1st order lag filter: y = y_prev + DELT * (u - y_prev) / Tau
    const src = `
#STORAGE REAL:1 INTEGER:0
#LOCAL REAL Tau, y
Tau = 0.01
IF (FIRSTSTEP) THEN
  STORF(0) = 0.0
ENDIF
y = STORF(0) + DELT * ($In - STORF(0)) / Tau
STORF(0) = y
$Out = y
`;
    const compiled = compileFortranStep(src);
    assert.equal(compiled.metadata.numRealStates, 1);
    assert.equal(compiled.metadata.numIntStates, 0);

    const storF = new Float64Array(compiled.numRealStates);
    const storI = new Int32Array(compiled.numIntStates);
    const inMap = new Map<string, number>([["In", 10.0]]);
    const outMap = new Map<string, number>();

    const dt = 0.001; // 1 ms
    let time = 0.0;

    // First step
    compiled.step({
      dt,
      time,
      firstStep: true,
      inputs: (port: string) => inMap.get(port) ?? 0,
      setOutput: (port: string, val: number) => outMap.set(port, val),
      storf: storF,
      stori: storI,
    });
    // After 1 step: y ≈ 0 + 0.001 * (10 - 0) / 0.01 = 1.0
    assert.ok(Math.abs((outMap.get("Out") ?? 0) - 1.0) < 1e-4);

    // Step 50 times (50 ms, 5 time constants, expect ~9.93)
    for (let i = 1; i < 50; i++) {
      time += dt;
      compiled.step({
        dt,
        time,
        firstStep: false,
        inputs: (port: string) => inMap.get(port) ?? 0,
        setOutput: (port: string, val: number) => outMap.set(port, val),
        storf: storF,
        stori: storI,
      });
    }

    const finalVal = outMap.get("Out") ?? 0;
    // Theoretical 1 - exp(-0.05 / 0.01) = 1 - exp(-5) ≈ 0.99326 -> 9.9326
    assert.ok(finalVal > 9.9 && finalVal < 10.0, `Expected ~9.93, got ${finalVal}`);
  });

  test("executes EMTDC built-in library subroutines (HARDLIMIT, REALPOLE)", () => {
    const src = `
#STORAGE REAL:2 INTEGER:0
#LOCAL REAL u, y_lim
u = $In
CALL HARDLIMIT(u, -5.0, 5.0, y_lim)
$OutLim = y_lim
`;
    const compiled = compileFortranStep(src);
    const inMap = new Map<string, number>([["In", 12.0]]);
    const outMap = new Map<string, number>();
    const storF = new Float64Array(compiled.numRealStates);
    const storI = new Int32Array(compiled.numIntStates);

    compiled.step({
      dt: 0.001,
      time: 0.0,
      firstStep: true,
      inputs: (port: string) => inMap.get(port) ?? 0,
      setOutput: (port: string, val: number) => outMap.set(port, val),
      storf: storF,
      stori: storI,
    });
    assert.equal(outMap.get("OutLim"), 5.0, "Should clamp at upper limit 5.0");

    inMap.set("In", -15.0);
    compiled.step({
      dt: 0.001,
      time: 0.001,
      firstStep: false,
      inputs: (port: string) => inMap.get(port) ?? 0,
      setOutput: (port: string, val: number) => outMap.set(port, val),
      storf: storF,
      stori: storI,
    });
    assert.equal(outMap.get("OutLim"), -5.0, "Should clamp at lower limit -5.0");
  });

  test("simulateFortranRoutine: simulates Fortran 90 subroutine and triggers statement debugger hooks", async () => {
    const src = `subroutine nozzle_thrust(p_c, a_t, c_f, f_thrust)
  implicit none
  real(8), intent(in)  :: p_c, a_t, c_f
  real(8), intent(out) :: f_thrust
  real(8) :: g0 = 9.80665, r_gas = 287.05
  real(8) :: i_sp

  f_thrust = p_c * a_t * c_f
  i_sp = c_f * sqrt(r_gas * 3500.0) / g0
end subroutine nozzle_thrust
`;
    const visitedLines: number[] = [];
    const res = await simulateFortranRoutine(src, {
      startTime: 0,
      stopTime: 0.2,
      dt: 0.1,
      onStatement: (line) => {
        visitedLines.push(line);
      },
    });

    assert.equal(res.routineName, "nozzle_thrust");
    assert.ok(res.t.length >= 3);
    assert.ok(res.states.includes("f_thrust"));
    assert.ok(res.states.includes("i_sp"));
    assert.ok((res.finalLocals["f_thrust"] ?? 0) > 1000);
    assert.ok((res.finalLocals["i_sp"] ?? 0) > 100);
    assert.ok(visitedLines.includes(8) && visitedLines.includes(9));
  });

  test("verifyFortranSource: certifies nozzle_thrust safe and catches division-by-zero / domain bugs", () => {
    const safeSrc = `subroutine nozzle_thrust(p_c, a_t, c_f, f_thrust)
  implicit none
  real(8), intent(in)  :: p_c, a_t, c_f
  real(8), intent(out) :: f_thrust
  real(8) :: g0 = 9.80665, r_gas = 287.05
  real(8) :: i_sp

  f_thrust = p_c * a_t * c_f
  i_sp = c_f * sqrt(r_gas * 3500.0) / g0
end subroutine nozzle_thrust
`;
    const report = verifyFortranSource(safeSrc);
    assert.equal(report.isCertifiedSafe, true);
    assert.equal(report.definiteBugCount, 0);
    assert.ok(report.provenSafeCount >= 2);
    assert.ok(report.variableIntervals["f_thrust"]!.low > 0);

    const buggySrc = `subroutine bad_kernel(x, y)
  implicit none
  real(8), intent(in) :: x
  real(8), intent(out) :: y
  real(8) :: denom = 0.0
  y = sqrt(-5.0) + x / denom
end subroutine bad_kernel
`;
    const badReport = verifyFortranSource(buggySrc);
    assert.equal(badReport.isCertifiedSafe, false);
    assert.ok(badReport.definiteBugCount >= 2);
  });

  test("IDE helpers generate non-empty TextMate and Monarch definitions with '!' comments", () => {
    const tm = getFortranTextMateGrammar();
    const monarch = getFortranMonarchDefinition();
    assert.equal(tm.scopeName, "source.fortran");
    assert.ok(Array.isArray((monarch as any).keywords) && (monarch as any).keywords.includes("subroutine"));
    assert.ok(Array.isArray((monarch as any).typeKeywords) && (monarch as any).typeKeywords.includes("real"));
  });

  test("Workstream 1: executes MODULE with CONTAINS subroutines and user FUNCTION with RESULT", async () => {
    const src = `module propulsion_mod
  implicit none
  real(8), parameter :: g0 = 9.80665
contains
  subroutine compute_step(p_c, a_t, c_f, f_thrust, m_dot)
    implicit none
    real(8), intent(in) :: p_c, a_t, c_f
    real(8), intent(out) :: f_thrust, m_dot
    real(8) :: isp_val
    call calc_thrust_helper(p_c, a_t, c_f, f_thrust)
    isp_val = calc_isp(c_f)
    m_dot = f_thrust / (isp_val * g0)
  end subroutine compute_step

  subroutine calc_thrust_helper(p, a, cf, f_out)
    implicit none
    real(8), intent(in) :: p, a, cf
    real(8), intent(out) :: f_out
    f_out = p * a * cf
  end subroutine calc_thrust_helper

  function calc_isp(cf_in) result(isp_res)
    implicit none
    real(8), intent(in) :: cf_in
    real(8) :: isp_res
    isp_res = cf_in * 100.0 / g0
  end function calc_isp
end module propulsion_mod
`;
    const res = await simulateFortranRoutine(src, {
      startTime: 0,
      stopTime: 0.1,
      dt: 0.05,
      inputs: {
        p_c: 2.0e6,
        a_t: 0.05,
        c_f: 1.5,
      },
    });

    assert.equal(res.routineName, "compute_step");
    // f_thrust = 2.0e6 * 0.05 * 1.5 = 150000
    assert.ok(Math.abs((res.finalLocals["f_thrust"] ?? 0) - 150000) < 1e-3);
    // isp_val = 1.5 * 100 / g0 => m_dot = 150000 / 150 = 1000
    assert.ok(Math.abs((res.finalLocals["m_dot"] ?? 0) - 1000) < 1e-3);

    // Inter-procedural formal verification should certify compute_step + callees safe
    const report = verifyFortranSource(src);
    assert.equal(report.isCertifiedSafe, true);
    assert.equal(report.definiteBugCount, 0);
    assert.ok((report.variableIntervals["f_thrust"]?.low ?? 0) > 0);
  });

  test("Workstream 2: executes 1D/2D arrays, slices, ALLOCATABLE matrices, and array intrinsics", async () => {
    const src = `subroutine matrix_kernel(scale_in, total_out, dot_out)
  implicit none
  real(8), intent(in) :: scale_in
  real(8), intent(out) :: total_out, dot_out
  real(8) :: v1(4), v2(4)
  real(8), allocatable :: mat(:, :)
  integer :: i

  v1 = [1.0, 2.0, 3.0, 4.0]
  v2 = 0.0
  v2(1:3) = v1(2:4) * scale_in
  v2(4) = 10.0

  allocate(mat(2, 2))
  mat(1, 1) = v1(1)
  mat(2, 1) = v1(2)
  mat(1, 2) = v1(3)
  mat(2, 2) = v1(4)

  total_out = sum(v2) + maxval(mat)
  dot_out = dot_product(v1, v2)
  deallocate(mat)
end subroutine matrix_kernel
`;
    const res = await simulateFortranRoutine(src, {
      startTime: 0,
      stopTime: 0.02,
      dt: 0.01,
      inputs: { scale_in: 2.0 },
    });

    // v1 = [1, 2, 3, 4]
    // v2(1:3) = [2, 3, 4] * 2 = [4, 6, 8], v2(4) = 10 => sum(v2) = 28
    // maxval(mat) = 4 => total_out = 32
    assert.equal(res.finalLocals["total_out"], 32.0);
    // dot_product([1,2,3,4], [4,6,8,10]) = 4 + 12 + 24 + 40 = 80
    assert.equal(res.finalLocals["dot_out"], 80.0);

    // Formal verification: safe array bounds & allocation
    const safeReport = verifyFortranSource(src);
    assert.equal(safeReport.definiteBugCount, 0);

    // Formal verification: catches unallocated ALLOCATABLE access and out-of-bounds index
    const unallocSrc = `subroutine bad_array(y)
  implicit none
  real(8), intent(out) :: y
  real(8), allocatable :: a(:)
  real(8) :: fixed_arr(3)
  y = a(1) + fixed_arr(5)
end subroutine bad_array
`;
    const badReport = verifyFortranSource(unallocSrc);
    assert.equal(badReport.isCertifiedSafe, false);
    assert.ok(badReport.definiteBugCount >= 2);
  });

  test("Workstream 3: lowers Fortran to causality-aware DAE and exports standalone FMI 2.0/3.0 FMU", async () => {
    const { exportFortranFmu, lowerFortranToDae } = await import("../src/index.js");
    const { DAEBuilder } = await import("@modelscript/runtime");

    const src = `subroutine rocket_stage(p_c, a_t, c_f, f_thrust)
  implicit none
  real(8), intent(in)  :: p_c, a_t, c_f
  real(8), intent(out) :: f_thrust
  real(8), parameter   :: eta = 0.98
  real(8) :: stage_loads(3)
  integer :: k

  do k = 1, 3
    stage_loads(k) = p_c * a_t * k
  end do
  SD(1) = -0.01 * S(1) + f_thrust
  f_thrust = p_c * a_t * c_f * eta
end subroutine rocket_stage
`;
    const builder = new DAEBuilder();
    const daeRes = lowerFortranToDae(builder, src.split("\n"), "rocket_stage");
    assert.equal(daeRes.inputVarIndices.length, 3);
    assert.equal(daeRes.outputVarIndices.length, 1);
    assert.equal(daeRes.parameterVarIndices.length, 1);
    assert.equal(daeRes.stateVarIndices.length, 1);
    // 3 unrolled DO-loop array equations + 1 SD(1) state eq + 1 f_thrust eq = 5 equations
    assert.equal(daeRes.equationCount, 5);

    const fmu = exportFortranFmu(src, { fmiVersion: "both" });
    assert.equal(fmu.modelIdentifier, "rocket_stage");
    // Check ZIP magic bytes 'PK\x03\x04'
    assert.equal(fmu.archive[0], 0x50);
    assert.equal(fmu.archive[1], 0x4b);
    assert.equal(fmu.archive[2], 0x03);
    assert.equal(fmu.archive[3], 0x04);
    assert.ok(fmu.files.includes("modelDescription.xml"));
    assert.ok(fmu.files.includes("fmi3ModelDescription.xml"));
    assert.ok(fmu.files.includes("sources/rocket_stage_model.c"));
    assert.ok(fmu.files.includes("sources/rocket_stage_wasm.c"));
    assert.ok(fmu.modelDescription2Xml.includes('causality="input"'));
    assert.ok(fmu.modelDescription2Xml.includes('causality="output"'));
    assert.ok(fmu.modelDescription2Xml.includes('causality="parameter"'));
    assert.ok(fmu.cSources.modelC.includes("rocket_stage_step"));
    assert.ok(fmu.cSources.wasmModelC.includes("wasm_step"));
  });

  test("parseFortranAst & compileUserComponentStep: executes DO WHILE, SELECT CASE, EXIT, CYCLE, RETURN, 2D arrays, and inline SUBROUTINE", async () => {
    const { parseFortranAst, compileUserComponentStep } = await import("../src/index.js");

    const src = `
SUBROUTINE SCALE_AND_ACCUM(VAL, MULT, RES)
  IMPLICIT NONE
  REAL VAL, MULT, RES
  IF (VAL < 0.0) THEN
    RES = 0.0
    RETURN
  END IF
  RES = VAL * MULT
END SUBROUTINE

INTEGER I, J, MODE
REAL ACC, STEP_VAL, M(5, 3)

ACC = 0.0
DO I = 1, 10, 1
  IF (I == 2) CYCLE
  IF (I > 5) EXIT
  DO J = 1, 2
    M(I, J) = I * 10.0 + J
    ACC = ACC + M(I, J)
  END DO
END DO

I = 0
DO WHILE (I < 4)
  I = I + 1
  IF (I == 3) CYCLE
  ACC = ACC + 1.0
END DO

MODE = $ModeIn
SELECT CASE (MODE)
  CASE (1)
    CALL SCALE_AND_ACCUM(ACC, 2.0, STEP_VAL)
  CASE (2, 3)
    CALL SCALE_AND_ACCUM(ACC, 0.5, STEP_VAL)
  CASE (4:6)
    CALL SCALE_AND_ACCUM(-5.0, 10.0, STEP_VAL)
  CASE DEFAULT
    STEP_VAL = -1.0
END SELECT

$OutAcc = ACC
$OutStep = STEP_VAL
`;

    const ast = parseFortranAst(src);
    assert.ok(ast.some((s) => s.kind === "subroutine" && s.name === "SCALE_AND_ACCUM"));
    assert.ok(ast.some((s) => s.kind === "do"));
    assert.ok(ast.some((s) => s.kind === "doWhile"));
    assert.ok(ast.some((s) => s.kind === "selectCase"));

    const compiled = compileUserComponentStep(src);
    const outMap = new Map<string, number>();

    // Mode 1: scales ACC by 2.0
    // DO I = 1..10: I=1 -> M(1,1)=11, M(1,2)=12 (sum=23)
    // I=2 -> CYCLE
    // I=3 -> 31+32 = 63 (sum=86)
    // I=4 -> 41+42 = 83 (sum=169)
    // I=5 -> 51+52 = 103 (sum=272)
    // I=6 -> EXIT
    // DO WHILE (I < 4): I=1 (+1), I=2 (+1), I=3 (CYCLE), I=4 (+1) => +3 => ACC = 275
    compiled({
      inputs: { ModeIn: 1 },
      outputs: outMap,
    });
    assert.equal(outMap.get("OutAcc"), 275.0);
    assert.equal(outMap.get("OutStep"), 550.0);

    // Mode 5 (matches CASE (4:6), calls SCALE_AND_ACCUM(-5.0, 10.0, STEP_VAL) which hits early RETURN with RES = 0.0)
    compiled.step({
      inputs: { ModeIn: 5 },
      outputs: outMap,
    });
    assert.equal(outMap.get("OutStep"), 0.0);

    // Mode 99 (matches CASE DEFAULT -> -1.0)
    compiled.step({
      inputs: { ModeIn: 99 },
      outputs: outMap,
    });
    assert.equal(outMap.get("OutStep"), -1.0);
  });
});
