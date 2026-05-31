// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMI 2.0 C source code generator.
 *
 * Transpiles an ArenaDAEBuilder expression tree into standalone C source files
 * that implement the FMI 2.0 API for both Model Exchange and Co-Simulation.
 *
 * Generated files:
 *   - model.c    — equation evaluation, derivative computation
 *   - model.h    — variable declarations and constants
 *   - fmi2Functions.c — FMI 2.0 C API implementation
 *
 * Works in both browser and Node.js environments (pure string generation).
 */

import {
  ArenaDAEBuilder,
  BinOp,
  EqKind,
  ExprKind,
  StaticTapeBuilder,
  UnaryOp,
  Variability,
  differentiateArenaExpressionWrt,
  pantelidesIndexReductionArena,
  performBltTransformationArena,
  simplifyArenaExpression,
} from "@modelscript/compiler";
import type { FmuOptions, FmuResult } from "./fmi.js";
import { binaryOpToC, escapeCString, formatCDouble, mapFunctionName, sanitizeIdentifier } from "./transpiler-utils.js";

/** Generated C source files. */
export interface FmuCSourceFiles {
  modelH: string;
  modelC: string;
  fmi2FunctionsC: string;
  fmi3FunctionsC: string;
  cmakeLists: string;
}

// Track compiler buffers (e.g. ring buffers for delay() or spatial distribution)
let delayBufferCounter = 0;
let spatialDistCounter = 0;

/**
 * Generate FMI 2.0 C source files from a DAE and FMU result.
 */
export function generateFmuCSources(dae: ArenaDAEBuilder, fmuResult: FmuResult, options: FmuOptions): FmuCSourceFiles {
  const id = options.modelIdentifier;
  const vars = fmuResult.scalarVariables;
  let maxVr = 0;
  let nStringVars = 0;
  for (const v of vars) {
    maxVr = Math.max(maxVr, v.valueReference);
    if (v.name.includes("_string_")) nStringVars++; // basic check or just check types if FMI had it
  }
  const nVars = vars.length > 0 ? maxVr + 1 : 0;
  const nStates = fmuResult.modelStructure.derivatives.length;

  const { code: jacCode, nnz } = generateGetJacobianSparse(id, dae, fmuResult);
  const modelH = generateModelH(id, nVars, nStates, nStringVars, nnz, dae, fmuResult);
  const modelC =
    generateModelC(id, dae, fmuResult) +
    "\n\n" +
    generateAlgebraicLoopSolvers(id, dae, fmuResult, options) +
    "\n\n" +
    jacCode.join("\n");
  const fmi2FunctionsC = generateFmi2FunctionsC(id, nVars, nStates, nStringVars, dae, fmuResult);
  const fmi3FunctionsC = generateFmi3FunctionsC(id, dae);

  const externalIncludes = new Set<string>();
  for (const fn of dae.functions.values()) {
    for (const inc of fn.externalIncludes) externalIncludes.add(inc);
  }

  const cmakeLists = generateCMakeLists(id, Array.from(externalIncludes));

  return {
    modelH,
    modelC,
    fmi2FunctionsC,
    fmi3FunctionsC,
    cmakeLists,
  };
}

/** Recursively convert an expression ID to a C string representation. */
function exprToC(dae: ArenaDAEBuilder, id: number): string {
  if (id < 0) return "0.0 /* null */";
  switch (dae.getExprKind(id)) {
    case ExprKind.RealLiteral:
      return formatCDouble(dae.getExprRealValue(id));
    case ExprKind.IntLiteral:
      return `${dae.getExprData1(id)}`;
    case ExprKind.BoolLiteral:
      return dae.getExprData1(id) !== 0 ? "1" : "0";
    case ExprKind.StringLiteral:
      return `"${escapeCString(dae.interner.resolve(dae.getExprData1(id)))}"`;
    case ExprKind.Name:
      return varToC(dae.interner.resolve(dae.getExprData1(id)));
    case ExprKind.Unary: {
      const uop = dae.getExprData1(id) as UnaryOp;
      const op = uop === UnaryOp.Not ? "!" : "-";
      return `(${op}${exprToC(dae, dae.getExprLeft(id))})`;
    }
    case ExprKind.Negate:
      return `(-${exprToC(dae, dae.getExprLeft(id))})`;
    case ExprKind.Der: {
      const op = dae.getExprData1(id);
      const name = dae.interner.resolve(dae.getExprData1(op));
      return varToC(`der(${name})`);
    }
    case ExprKind.Pre: {
      const op = dae.getExprData1(id);
      const name = dae.interner.resolve(dae.getExprData1(op));
      return varToC(`pre(${name})`);
    }
    case ExprKind.Binary: {
      const op = dae.getExprData1(id) as BinOp;
      const lhs = exprToC(dae, dae.getExprLeft(id));
      const rhs = exprToC(dae, dae.getExprRight(id));
      const opStr = binaryOpToC(op);
      if (opStr === "pow") return `pow(${lhs}, ${rhs})`;
      return `(${lhs} ${opStr} ${rhs})`;
    }
    case ExprKind.Call: {
      const fname = dae.interner.resolve(dae.getExprData1(id));
      const argCount = dae.getExprRight(id);
      if (fname === "delay" && argCount >= 2) {
        // delay(expr, delayTime) -> delay_lookup(&inst->delayBuf[k], inst->time - delayTime, expr)
        const delayVal = exprToC(dae, dae.getExprLeft(id));
        const delayTime = exprToC(dae, dae.getExprLeft(id + 1));
        const bufIdx = delayBufferCounter++;
        return `delay_lookup(&inst->delayBuf[${bufIdx}], inst->time - (${delayTime}), ${delayVal})`;
      }
      if (fname === "spatialDistribution" && argCount >= 5) {
        const outVal = exprToC(dae, dae.getExprLeft(id));
        const inVal = exprToC(dae, dae.getExprLeft(id + 1));
        const x = exprToC(dae, dae.getExprLeft(id + 2));
        const velocity = exprToC(dae, dae.getExprLeft(id + 4));
        const bufIdx = spatialDistCounter++;
        return `spatial_distribution_lookup(${bufIdx}, ${x}, ${velocity}, ${inVal}, ${outVal})`;
      }
      const args: string[] = [];
      for (let i = 0; i < argCount; i++) {
        args.push(exprToC(dae, dae.getExprLeft(id + i)));
      }
      return `${mapFunctionName(fname)}(${args.join(", ")})`;
    }
    case ExprKind.IfElse: {
      const cond = exprToC(dae, dae.getExprData1(id));
      const then = exprToC(dae, dae.getExprLeft(id));
      const els = exprToC(dae, dae.getExprRight(id));
      return `(${cond} ? ${then} : ${els})`;
    }
    default:
      return "0.0 /* unknown */";
  }
}

/** Convert a variable name to a valid C identifier representing the state reference. */
function varToC(name: string): string {
  if (name === "time") return "time";
  return sanitizeIdentifier(name);
}

function conditionToZeroCrossingC(dae: ArenaDAEBuilder, id: number): string {
  if (id < 0) return "0.0";
  if (dae.getExprKind(id) === ExprKind.Binary) {
    const op = dae.getExprData1(id) as BinOp;
    if (op === BinOp.Lt || op === BinOp.Lte || op === BinOp.Gt || op === BinOp.Gte) {
      const lhs = exprToC(dae, dae.getExprLeft(id));
      const rhs = exprToC(dae, dae.getExprRight(id));
      return `(${lhs}) - (${rhs})`;
    }
  }
  return `(${exprToC(dae, id)} ? 1.0 : -1.0)`;
}

function extractTimeEventThresholdC(dae: ArenaDAEBuilder, id: number): string | null {
  if (id < 0) return null;
  if (dae.getExprKind(id) === ExprKind.Binary) {
    const op = dae.getExprData1(id) as BinOp;
    const lhs = dae.getExprLeft(id);
    const rhs = dae.getExprRight(id);
    if (op === BinOp.Gte || op === BinOp.Gt) {
      if (dae.getExprKind(lhs) === ExprKind.Name && dae.interner.resolve(dae.getExprData1(lhs)) === "time") {
        return exprToC(dae, rhs);
      }
    }
    if (op === BinOp.Lte || op === BinOp.Lt) {
      if (dae.getExprKind(rhs) === ExprKind.Name && dae.interner.resolve(dae.getExprData1(rhs)) === "time") {
        return exprToC(dae, lhs);
      }
    }
  }
  return null;
}

function extractAssignmentTarget(dae: ArenaDAEBuilder, id: number): string | null {
  if (id >= 0 && dae.getExprKind(id) === ExprKind.Name) {
    return dae.interner.resolve(dae.getExprData1(id));
  }
  return null;
}

// ── File generators ──

function generateModelH(
  id: string,
  nVars: number,
  nStates: number,
  nStringVars: number,
  nnz: number,
  dae: ArenaDAEBuilder,
  result: FmuResult,
): string {
  const lines: string[] = [];
  lines.push("/* Auto-generated by ModelScript — do not edit */");
  lines.push(`#ifndef ${id.toUpperCase()}_MODEL_H`);
  lines.push(`#define ${id.toUpperCase()}_MODEL_H`);
  lines.push("");
  lines.push("#include <math.h>");
  lines.push("#include <string.h>");
  lines.push("");
  lines.push(`#define MODEL_IDENTIFIER "${id}"`);
  lines.push(`#define MODEL_GUID "${result.guid}"`);
  lines.push(`#define N_VARS ${nVars}`);
  lines.push(`#define N_STATES ${nStates}`);
  lines.push(`#define N_STRING_VARS ${nStringVars}`);
  lines.push(`#define N_EVENT_INDICATORS ${result.numberOfEventIndicators}`);
  lines.push(`#define N_NONZEROS ${nnz}`);

  let nWhenConditions = 0;
  for (let idx = 0; idx < dae.eqCount; idx++) {
    if (dae.getEqKind(idx) === EqKind.When) {
      const meta = dae.getWhenEquationMeta(idx);
      if (meta) {
        nWhenConditions += 1 + meta.elseWhenClauses.length;
      }
    }
  }
  lines.push(`#define N_WHEN_CONDITIONS ${nWhenConditions}`);
  lines.push("");

  // Variable index constants
  for (const sv of result.scalarVariables) {
    const cName = sanitizeIdentifier(sv.name).toUpperCase();
    lines.push(`#define VR_${cName} ${sv.valueReference}`);
  }

  lines.push("");
  lines.push("/* Model instance data */");
  lines.push("typedef struct {");
  lines.push("  double vars[N_VARS + 1];  /* +1 for safety */");
  lines.push("  double states[N_STATES + 1];");
  lines.push("  double derivatives[N_STATES + 1];");
  lines.push("  char* stringVars[N_STRING_VARS + 1];  /* string variable storage */");
  lines.push("  double eventPrev[N_EVENT_INDICATORS + 1];  /* previous event indicator values */");
  lines.push(
    "  double whenPrev[N_WHEN_CONDITIONS + 1];  /* previous when condition values for rising edge detection */",
  );
  lines.push("  double time;");
  lines.push("  int isDirtyValues;");
  lines.push("  int isInitPhase;  /* 1 during initialization, 0 otherwise */");

  // ExternalObject opaque pointer fields
  if (dae.externalObjects.length > 0) {
    lines.push(`  /* ExternalObject handles (${dae.externalObjects.length}) */`);
    for (let ei = 0; ei < dae.externalObjects.length; ei++) {
      lines.push(`  void* extObj_${ei};  /* ${dae.externalObjects[ei]?.className ?? "unknown"} */`);
    }
  }

  // Count delay() calls in DAE for delay buffer allocation
  let nDelayBuffers = 0;
  for (let i = 0; i < dae.exprCount; i++) {
    if (dae.getExprKind(i) === ExprKind.Call) {
      const fname = dae.interner.resolve(dae.getExprData1(i));
      if (fname === "delay") {
        nDelayBuffers++;
      }
    }
  }

  if (nDelayBuffers > 0) {
    lines.push(`  /* Delay ring-buffers (${nDelayBuffers} delay() calls) */`);
    lines.push(
      `  struct { double times[1024]; double values[1024]; int head; int count; } delayBuf[${nDelayBuffers}];`,
    );
  }

  lines.push(`  void* fmuInstance;  /* parent FMU struct pointer */`);
  lines.push(`  void (*logger)(void* fmuInstance, const char* category, const char* message);`);
  lines.push(`  void (*terminate)(void* fmuInstance);`);
  lines.push(`} ${id}_Instance;`);
  lines.push("");
  lines.push(`void ${id}_initialize(${id}_Instance* inst);`);
  lines.push(`void ${id}_initializeSolve(${id}_Instance* inst);`);
  lines.push(`void ${id}_solveAlgebraicLoops(${id}_Instance* inst);`);
  lines.push(`void ${id}_getDerivatives(${id}_Instance* inst);`);
  lines.push(`void ${id}_getEventIndicators(${id}_Instance* inst, double* indicators);`);
  lines.push(`void ${id}_getJacobianSparse(${id}_Instance* inst, int* colptrs, int* rowvals, double* data);`);
  lines.push("");
  lines.push("#endif");
  return lines.join("\n");
}

function generateAlgebraicLoopSolvers(
  id: string,
  dae: ArenaDAEBuilder,
  result: FmuResult,
  options: FmuOptions,
): string {
  const method = options.solverOptions?.jacobian ?? "ad-forward";

  const lines: string[] = [];
  if (method === "finite-difference") {
    lines.push("/* Algebraic Loop Solver with Finite-Difference Jacobian */");
  } else {
    lines.push("/* Algebraic Loop Solver with Exact Analytical Jacobian (AD) */");
  }
  lines.push(`#define LOG_ERROR(inst, msg) \\`);
  lines.push(`  do { \\`);
  lines.push(`    if ((inst)->logger) (inst)->logger((inst)->fmuInstance, "error", msg); \\`);
  lines.push(`    if ((inst)->terminate) (inst)->terminate((inst)->fmuInstance); \\`);
  lines.push(`  } while(0)`);
  lines.push("");
  lines.push("static inline void solve_linear_sys(void* inst_ptr, int n, double* A, double* b, double* x) {");
  lines.push(`  ${id}_Instance* inst = (${id}_Instance*)inst_ptr;`);
  lines.push("  for (int i = 0; i < n; i++) {");
  lines.push("    int pivot = i;");
  lines.push("    for (int j = i + 1; j < n; j++) {");
  lines.push("      if (fabs(A[j*n + i]) > fabs(A[pivot*n + i])) pivot = j;");
  lines.push("    }");
  lines.push("    for (int j = i; j < n; j++) {");
  lines.push("      double tmp = A[i*n + j]; A[i*n + j] = A[pivot*n + j]; A[pivot*n + j] = tmp;");
  lines.push("    }");
  lines.push("    double tmp = b[i]; b[i] = b[pivot]; b[pivot] = tmp;");
  lines.push("    if (fabs(A[i*n + i]) < 1e-14) {");
  lines.push(`      LOG_ERROR(inst, "Singular algebraic loop matrix encountered");`);
  lines.push("      return;");
  lines.push("    }");
  lines.push("    for (int j = i + 1; j < n; j++) {");
  lines.push("      double factor = A[j*n + i] / A[i*n + i];");
  lines.push("      for (int k = i; k < n; k++) A[j*n + k] -= factor * A[i*n + k];");
  lines.push("      b[j] -= factor * b[i];");
  lines.push("    }");
  lines.push("  }");
  lines.push("  for (int i = n - 1; i >= 0; i--) {");
  lines.push("    double sum = 0.0;");
  lines.push("    for (int j = i + 1; j < n; j++) sum += A[i*n + j] * x[j];");
  lines.push("    x[i] = (b[i] - sum) / A[i*n + i];");
  lines.push("  }");
  lines.push("}");
  lines.push("");
  lines.push(`void ${id}_solveAlgebraicLoops(${id}_Instance* inst) {`);

  const parameterVars = new Set<number>();
  const stateVars = new Set<number>();
  const derivativeVars = new Set<number>();

  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;
    if (dae.getVarVariability(i) === Variability.Parameter) {
      parameterVars.add(i);
    }
  }

  for (let i = 0; i < dae.exprCount; i++) {
    if (dae.getExprKind(i) === ExprKind.Der) {
      const argId = dae.getExprData1(i);
      if (dae.getExprKind(argId) === ExprKind.Name) {
        const nameId = dae.getExprData1(argId);
        const name = dae.interner.resolve(nameId);
        if (!name) continue;
        const varIdx = dae.getVarIdxByName(name);
        if (varIdx !== -1) {
          stateVars.add(varIdx);
          const derName = `der(${name})`;
          let derVarIdx = dae.getVarIdxByName(derName);
          if (derVarIdx === -1) {
            const baseVarType = dae.getVarType(varIdx);
            const baseVarVariability = dae.getVarVariability(varIdx);
            derVarIdx = dae.addVariable(derName, baseVarType, baseVarVariability, dae.getVarCausality(varIdx), 0.0);
          }
          derivativeVars.add(derVarIdx);
        }
      }
    }
  }

  const pantelidesRes = pantelidesIndexReductionArena(dae, stateVars, derivativeVars, parameterVars);
  const dummyDerivatives = pantelidesRes.dummyDerivatives;

  const blt = performBltTransformationArena(dae, stateVars, dummyDerivatives);
  const algebraicLoops = blt.blocks
    .filter((b) => b.vars.length > 1)
    .map((b) => ({
      variables: b.vars.map((v) => dae.getVarName(v)),
      equations: b.eqIdxs.map((eqIdx) => ({
        expression1: dae.getEqLhs(eqIdx),
        expression2: dae.getEqRhs(eqIdx),
      })),
    }));

  if (algebraicLoops.length === 0) {
    lines.push("  (void)inst;");
    lines.push("}");
    return lines.join("\n");
  }

  for (let loopIdx = 0; loopIdx < algebraicLoops.length; loopIdx++) {
    const loop = algebraicLoops[loopIdx];
    if (!loop) continue;
    const N = loop.variables.length;

    lines.push(`  /* Algebraic Loop ${loopIdx} (${N} variables) */`);
    lines.push(`  {`);
    lines.push(`    double F[${N}], J[${N * N}], dx[${N}];`);

    // Variable resolver for analytical Jacobians
    const varResolver = (name: string): string => {
      if (name === "time") return "inst->time";
      const sv = result.scalarVariables.find((v) => v.name === name);
      return sv ? `inst->vars[${sv.valueReference}]` : `0.0 /* ${name} */`;
    };

    // Create tapes for analytical Jacobians
    const tapes: (StaticTapeBuilder | null)[] = [];
    const residualOutputIndices: number[] = [];
    for (const eq of loop.equations) {
      const tape = new StaticTapeBuilder();
      const lhsIdx = tape.addExpression(eq.expression1, dae);
      const rhsIdx = tape.addExpression(eq.expression2, dae);
      residualOutputIndices.push(tape.pushOp({ type: "sub", a: lhsIdx, b: rhsIdx }));
      tapes.push(tape);
    }

    lines.push(`    /* Algebraic Loop ${loopIdx} (${N} variables, exact AD Jacobian) */`);
    lines.push(`  {`);
    lines.push(`    int iter;`);
    lines.push(`    for (iter = 0; iter < 100; iter++) {`);

    // Evaluate residuals using the first tape's forward pass approach
    for (let i = 0; i < tapes.length; i++) {
      const tape = tapes[i];
      if (!tape) continue;
      const outIdx = residualOutputIndices[i];
      if (outIdx === undefined) continue;

      lines.push(`      { /* Residual ${i} — forward pass */`);
      const fwdCode = tape.emitForwardC(varResolver);
      lines.push(...fwdCode.map((c) => "      " + c));
      lines.push(`        F[${i}] = t[${outIdx}];`);
      lines.push(`      }`);
    }

    lines.push(`      double err = 0.0;`);
    lines.push(`      for (int i = 0; i < ${N}; i++) err += fabs(F[i]);`);
    lines.push(`      if (err < 1e-10) break;`);

    // Compute exact Jacobian via reverse-mode AD
    lines.push(`      /* Exact Analytical Jacobian via Reverse-Mode AD */`);
    for (let row = 0; row < tapes.length; row++) {
      const tape = tapes[row];
      if (!tape) continue;
      const outIdx = residualOutputIndices[row];
      if (outIdx === undefined) continue;

      lines.push(`      { /* J row ${row}: d(residual_${row})/d(vars) */`);
      // Re-emit forward pass (values needed by reverse pass)
      const fwdCode = tape.emitForwardC(varResolver);
      lines.push(...fwdCode.map((c) => "      " + c));
      // Reverse pass to get gradients
      const { code: revCode, gradients } = tape.emitReverseC(outIdx);
      lines.push(...revCode.map((c) => "      " + c));

      // Extract Jacobian entries for the loop variables
      for (let col = 0; col < loop.variables.length; col++) {
        const varName = loop.variables[col];
        if (!varName) continue;
        const gradIdx = gradients.get(varName);
        if (gradIdx !== undefined) {
          lines.push(`        J[${row * N + col}] = dt[${gradIdx}]; /* d(res_${row})/d(${varName}) */`);
        } else {
          lines.push(`        J[${row * N + col}] = 0.0;`);
        }
      }
      lines.push(`      }`);
    }

    // Newton update: solve J * dx = -F
    lines.push(`      for (int i = 0; i < ${N}; i++) F[i] = -F[i];`);
    lines.push(`      solve_linear_sys(inst, ${N}, J, F, dx);`);

    // Apply dx to inst->vars
    const varRefs = loop.variables.map(
      (vName) => result.scalarVariables.find((sv) => sv.name === vName)?.valueReference ?? -1,
    );
    for (let j = 0; j < N; j++) {
      const vr = varRefs[j];
      if (vr !== undefined && vr >= 0) {
        lines.push(`      inst->vars[${vr}] += dx[${j}]; /* ${loop.variables[j]} */`);
      }
    }

    lines.push(`    }`);
    lines.push(`  }`);
    lines.push(`  }`);
  }
  lines.push("}");
  return lines.join("\n");
}

/**
 * Generate _initializeSolve() — Newton-Raphson solver for initial equations
 * using exact AD Jacobians from StaticTapeBuilder.
 */
function generateInitializeSolve(id: string, dae: ArenaDAEBuilder, result: FmuResult): string[] {
  const lines: string[] = [];

  const initEqs: { lhs: number; rhs: number }[] = [];
  for (let idx = 0; idx < dae.eqCount; idx++) {
    if (dae.getEqKind(idx) === EqKind.InitialSimple) {
      initEqs.push({ lhs: dae.getEqLhs(idx), rhs: dae.getEqRhs(idx) });
    }
  }

  if (initEqs.length === 0) {
    lines.push(`void ${id}_initializeSolve(${id}_Instance* inst) { (void)inst; }`);
    return lines;
  }

  const N = initEqs.length;

  // Identify unknowns: variables referenced in initial equations that are not parameters
  const paramNames = new Set<string>();
  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;
    const variability = dae.getVarVariability(i);
    if (variability === Variability.Parameter || variability === Variability.Constant) {
      paramNames.add(dae.getVarName(i));
    }
  }

  const referencedNames = new Set<string>();
  for (const eq of initEqs) {
    collectReferencedNames(dae, eq.lhs, referencedNames);
    collectReferencedNames(dae, eq.rhs, referencedNames);
  }

  const unknowns: string[] = [];
  for (const name of referencedNames) {
    if (!paramNames.has(name) && name !== "time") {
      const sv = result.scalarVariables.find((v) => v.name === name);
      if (sv) unknowns.push(name);
    }
  }

  const nUnknowns = Math.min(unknowns.length, N);
  if (nUnknowns === 0) {
    lines.push(`void ${id}_initializeSolve(${id}_Instance* inst) { (void)inst; }`);
    return lines;
  }

  // Build AD tapes for each residual: R_i = LHS_i - RHS_i
  const tapes: StaticTapeBuilder[] = [];
  const residualOutputIndices: number[] = [];
  for (const eq of initEqs) {
    const tape = new StaticTapeBuilder();
    const lhsIdx = tape.addExpression(eq.lhs, dae);
    const rhsIdx = tape.addExpression(eq.rhs, dae);
    residualOutputIndices.push(tape.pushOp({ type: "sub", a: lhsIdx, b: rhsIdx }));
    tapes.push(tape);
  }

  // Variable name -> inst->vars[VR] resolver
  const varResolver = (name: string): string => {
    if (name === "time") return "inst->time";
    const sv = result.scalarVariables.find((v) => v.name === name);
    return sv ? `inst->vars[${sv.valueReference}]` : `0.0 /* ${name} */`;
  };

  lines.push(`/* Initial Equation Solver with Exact AD Jacobian */`);
  lines.push(`void ${id}_initializeSolve(${id}_Instance* inst) {`);
  lines.push(`  double R[${N}], J[${N * nUnknowns}], dx[${nUnknowns}];`);
  lines.push(`  int iter;`);
  lines.push(`  for (iter = 0; iter < 50; iter++) {`);

  // Forward pass: compute residuals R[i]
  for (let i = 0; i < N; i++) {
    const tape = tapes[i];
    if (!tape) continue;
    const outIdx = residualOutputIndices[i];
    if (outIdx === undefined) continue;

    lines.push(`    { /* Residual ${i} */`);
    const fwdCode = tape.emitForwardC(varResolver);
    lines.push(...fwdCode.map((c) => "    " + c));
    lines.push(`      R[${i}] = t[${outIdx}];`);
    lines.push(`    }`);
  }

  // Convergence check
  lines.push(`    double err = 0.0;`);
  lines.push(`    for (int i = 0; i < ${N}; i++) err += fabs(R[i]);`);
  lines.push(`    if (err < 1e-10) break;`);

  // Reverse pass: compute Jacobian J[row * nUnknowns + col]
  lines.push(`    /* Exact Jacobian via Reverse-Mode AD */`);
  for (let row = 0; row < N; row++) {
    const tape = tapes[row];
    if (!tape) continue;
    const outIdx = residualOutputIndices[row];
    if (outIdx === undefined) continue;

    lines.push(`    { /* J row ${row} */`);
    const fwdCode = tape.emitForwardC(varResolver);
    lines.push(...fwdCode.map((c) => "    " + c));
    const { code: revCode, gradients } = tape.emitReverseC(outIdx);
    lines.push(...revCode.map((c) => "    " + c));

    for (let col = 0; col < nUnknowns; col++) {
      const varName = unknowns[col];
      if (!varName) continue;
      const gradIdx = gradients.get(varName);
      if (gradIdx !== undefined) {
        lines.push(`      J[${row * nUnknowns + col}] = dt[${gradIdx}];`);
      } else {
        lines.push(`      J[${row * nUnknowns + col}] = 0.0;`);
      }
    }
    lines.push(`    }`);
  }

  // Newton update: solve J * dx = -R
  lines.push(`    for (int i = 0; i < ${N}; i++) R[i] = -R[i];`);
  lines.push(`    solve_linear_sys(inst, ${nUnknowns}, J, R, dx);`);

  // Apply dx to unknowns
  for (let j = 0; j < nUnknowns; j++) {
    const varName = unknowns[j];
    if (!varName) continue;
    const sv = result.scalarVariables.find((v) => v.name === varName);
    if (sv) {
      lines.push(`    inst->vars[${sv.valueReference}] += dx[${j}]; /* ${varName} */`);
    }
  }

  lines.push(`  }`);
  lines.push(`}`);
  lines.push(``);

  return lines;
}

function generateModelC(id: string, dae: ArenaDAEBuilder, result: FmuResult): string {
  // Reset buffer counters for this codegen invocation
  delayBufferCounter = 0;
  spatialDistCounter = 0;

  const lines: string[] = [];
  lines.push("/* Auto-generated by ModelScript — do not edit */");
  lines.push(`#include "${id}_model.h"`);
  lines.push("#include <stdio.h>");

  const externalIncludes = new Set<string>();
  for (const fn of dae.functions.values()) {
    for (const inc of fn.externalIncludes) externalIncludes.add(inc);
  }
  for (const inc of externalIncludes) {
    if (inc.trim().startsWith("#")) {
      lines.push(inc);
    } else {
      lines.push(inc.includes(";") || inc.includes("int ") || inc.includes("void ") ? inc : `#include "${inc}"`);
    }
  }
  lines.push("");

  // Count delay() calls to determine if delay helpers are needed
  let hasDelays = false;
  for (let i = 0; i < dae.exprCount; i++) {
    if (dae.getExprKind(i) === ExprKind.Call) {
      const fname = dae.interner.resolve(dae.getExprData1(i));
      if (fname === "delay") {
        hasDelays = true;
        break;
      }
    }
  }

  if (hasDelays) {
    lines.push("/* --- Delay ring-buffer helpers --- */");
    lines.push("#define DELAY_BUF_SIZE 1024");
    lines.push("");
    lines.push("typedef struct {");
    lines.push("  double times[DELAY_BUF_SIZE];");
    lines.push("  double values[DELAY_BUF_SIZE];");
    lines.push("  int head;");
    lines.push("  int count;");
    lines.push("} DelayBuffer;");
    lines.push("");
    lines.push("static void delay_record(DelayBuffer* buf, double t, double value) {");
    lines.push("  buf->times[buf->head] = t;");
    lines.push("  buf->values[buf->head] = value;");
    lines.push("  buf->head = (buf->head + 1) % DELAY_BUF_SIZE;");
    lines.push("  if (buf->count < DELAY_BUF_SIZE) buf->count++;");
    lines.push("}");
    lines.push("");
    lines.push("static inline double delay_lookup(DelayBuffer* buf, double tLookup, double currentValue) {");
    lines.push("  if (buf->count == 0) return currentValue;");
    lines.push("  /* Find the two nearest entries bracketing tLookup and linearly interpolate */");
    lines.push("  int start = (buf->head - buf->count + DELAY_BUF_SIZE) % DELAY_BUF_SIZE;");
    lines.push("  int n = buf->count;");
    lines.push("  /* If tLookup is before the earliest recorded time, return earliest value */");
    lines.push("  double t0 = buf->times[start];");
    lines.push("  if (tLookup <= t0) return buf->values[start];");
    lines.push("  /* Linear search for bracketing interval */");
    lines.push("  for (int k = 0; k < n - 1; k++) {");
    lines.push("    int i0 = (start + k) % DELAY_BUF_SIZE;");
    lines.push("    int i1 = (start + k + 1) % DELAY_BUF_SIZE;");
    lines.push("    double ta = buf->times[i0];");
    lines.push("    double tb = buf->times[i1];");
    lines.push("    if (tLookup >= ta && tLookup <= tb) {");
    lines.push("      if (tb == ta) return buf->values[i0];");
    lines.push("      double alpha = (tLookup - ta) / (tb - ta);");
    lines.push("      return buf->values[i0] * (1.0 - alpha) + buf->values[i1] * alpha;");
    lines.push("    }");
    lines.push("  }");
    lines.push("  /* If tLookup is past the last recorded time, return latest value */");
    lines.push("  int last = (buf->head - 1 + DELAY_BUF_SIZE) % DELAY_BUF_SIZE;");
    lines.push("  return buf->values[last];");
    lines.push("}");
    lines.push("");
  }

  // Build value-reference → C accessor mappings
  const vrMap = new Map<string, number>();
  for (const sv of result.scalarVariables) {
    vrMap.set(sv.name, sv.valueReference);
  }

  // ── Initialize function ──
  lines.push(`void ${id}_initialize(${id}_Instance* inst) {`);
  lines.push("  memset(inst, 0, sizeof(*inst));");
  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;
    const vName = dae.getVarName(i);
    const variability = dae.getVarVariability(i);
    if (variability === Variability.Parameter || variability === Variability.Constant) {
      const ref = vrMap.get(vName);
      const expr = dae.getVarExpression(i) as number | undefined;
      if (ref !== undefined && expr !== undefined && typeof expr === "number" && expr >= 0) {
        const cExpr = exprToC(dae, expr);
        lines.push(`  inst->vars[${ref}] = ${cExpr};  /* ${vName} */`);
      }
    }
  }
  // Set start values for continuous variables (from start attribute or binding)
  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;
    const vName = dae.getVarName(i);
    const variability = dae.getVarVariability(i);
    if (variability === Variability.Continuous || variability === undefined || variability === null) {
      const ref = vrMap.get(vName);
      if (ref !== undefined) {
        const startAttr = dae.getVarAttrExprId(i, "start");
        const expr = dae.getVarExpression(i) as number | undefined;
        const initExpr = startAttr !== undefined && startAttr >= 0 ? startAttr : expr;
        if (initExpr !== undefined && typeof initExpr === "number" && initExpr >= 0) {
          const cExpr = exprToC(dae, initExpr);
          lines.push(`  inst->vars[${ref}] = ${cExpr};  /* ${vName} */`);
        }
      }
    }
  }
  // Call the initial equation solver (generated below) after start values
  {
    let hasInitEqs = false;
    for (let idx = 0; idx < dae.eqCount; idx++) {
      if (dae.getEqKind(idx) === EqKind.InitialSimple) {
        hasInitEqs = true;
        break;
      }
    }
    if (hasInitEqs) {
      lines.push(`  ${id}_initializeSolve(inst);`);
    }
  }
  lines.push("}");
  lines.push("");

  // ── Initial equation solver via Newton-Raphson with exact AD Jacobian ──
  lines.push(...generateInitializeSolve(id, dae, result));

  // ── getDerivatives function ──
  lines.push(`void ${id}_getDerivatives(${id}_Instance* inst) {`);
  lines.push(`  ${id}_solveAlgebraicLoops(inst);`);

  // Collect all variable names referenced in derivative equations
  const referencedNames = new Set<string>();
  for (let idx = 0; idx < dae.eqCount; idx++) {
    collectReferencedNames(dae, dae.getEqLhs(idx), referencedNames);
    collectReferencedNames(dae, dae.getEqRhs(idx), referencedNames);
  }

  // Emit time alias only if referenced
  if (referencedNames.has("time")) {
    lines.push("  double time = inst->time;");
  }

  // Create local aliases only for referenced variables
  for (const sv of result.scalarVariables) {
    if (sv.causality === "independent") continue;
    if (!referencedNames.has(sv.name)) continue;
    const cName = varToC(sv.name);
    lines.push(`  double ${cName} = inst->vars[${sv.valueReference}];`);
  }
  lines.push("");

  // Emit equations that compute derivatives
  const derVars = result.scalarVariables.filter((sv) => sv.name.startsWith("der("));
  const derMap = new Map<string, number>();
  for (let i = 0; i < derVars.length; i++) {
    const nameMatch = derVars[i]?.name.match(/^der\((.+)\)$/);
    if (nameMatch) derMap.set(nameMatch[1] ?? "", i);
  }

  // Walk DAE equations looking for der(x) = expr patterns
  for (let idx = 0; idx < dae.eqCount; idx++) {
    const lhs = dae.getEqLhs(idx);
    const rhs = dae.getEqRhs(idx);
    const lhsDer = extractDerName(dae, lhs);
    const rhsDer = extractDerName(dae, rhs);

    if (lhsDer) {
      const derIdx = derMap.get(lhsDer);
      if (derIdx !== undefined) {
        lines.push(`  inst->derivatives[${derIdx}] = ${exprToC(dae, rhs)};  /* der(${lhsDer}) */`);
      }
    } else if (rhsDer) {
      const derIdx = derMap.get(rhsDer);
      if (derIdx !== undefined) {
        lines.push(`  inst->derivatives[${derIdx}] = ${exprToC(dae, lhs)};  /* der(${rhsDer}) */`);
      }
    }
  }

  if (hasDelays) {
    // Record current values of delay() expressions into ring buffers
    lines.push("");
    lines.push("  /* Record delay buffer entries */");
    let delayIdx = 0;
    const collectDelayExprs = (exprId: number, records: string[]): void => {
      if (exprId < 0) return;
      if (dae.getExprKind(exprId) === ExprKind.Call) {
        const fname = dae.interner.resolve(dae.getExprData1(exprId));
        if (fname === "delay") {
          const argCount = dae.getExprRight(exprId);
          if (argCount >= 2) {
            const delayExprC = exprToC(dae, dae.getExprLeft(exprId));
            records.push(`  delay_record(&inst->delayBuf[${delayIdx}], inst->time, ${delayExprC});`);
            delayIdx++;
            return;
          }
        }
        const argCount = dae.getExprRight(exprId);
        for (let i = 0; i < argCount; i++) {
          collectDelayExprs(dae.getExprLeft(exprId + i), records);
        }
        return;
      }
      const kind = dae.getExprKind(exprId);
      if (kind === ExprKind.Binary || kind === ExprKind.IfElse) {
        collectDelayExprs(dae.getExprLeft(exprId), records);
        collectDelayExprs(dae.getExprRight(exprId), records);
      } else if (
        kind === ExprKind.Unary ||
        kind === ExprKind.Negate ||
        kind === ExprKind.Der ||
        kind === ExprKind.Pre
      ) {
        collectDelayExprs(dae.getExprLeft(exprId), records);
      }
    };

    const recordLines: string[] = [];
    for (let idx = 0; idx < dae.eqCount; idx++) {
      collectDelayExprs(dae.getEqLhs(idx), recordLines);
      collectDelayExprs(dae.getEqRhs(idx), recordLines);
    }
    for (const rl of recordLines) {
      lines.push(rl);
    }
  }

  lines.push("}");
  lines.push("");

  // ── getEventIndicators function ──
  lines.push(`void ${id}_getEventIndicators(${id}_Instance* inst, double* indicators) {`);

  if (dae.eventIndicatorExprIds.length === 0) {
    lines.push("  (void)inst; (void)indicators;");
  } else {
    // Emit local variable aliases for referenced names
    const eventReferencedNames = new Set<string>();
    for (const indicatorId of dae.eventIndicatorExprIds) {
      collectReferencedNames(dae, indicatorId, eventReferencedNames);
    }
    if (eventReferencedNames.has("time")) {
      lines.push("  double time = inst->time;");
    }
    for (const sv of result.scalarVariables) {
      if (sv.causality === "independent") continue;
      if (!eventReferencedNames.has(sv.name)) continue;
      const cName = varToC(sv.name);
      lines.push(`  double ${cName} = inst->vars[${sv.valueReference}];`);
    }
    lines.push("");

    let indicatorIdx = 0;
    for (const indicatorId of dae.eventIndicatorExprIds) {
      const zc = exprToC(dae, indicatorId);
      lines.push(`  indicators[${indicatorIdx}] = ${zc};`);
      indicatorIdx++;
    }
  }
  lines.push("}");

  return lines.join("\n");
}

function generateFmi2FunctionsC(
  id: string,
  nVars: number,
  nStates: number,
  nStringVars: number,
  dae: ArenaDAEBuilder,
  result: FmuResult,
): string {
  const lines: string[] = [];
  lines.push("/* Auto-generated by ModelScript — FMI 2.0 API implementation */");
  lines.push(`#include "${id}_model.h"`);
  lines.push('#include "fmi2Functions.h"');
  lines.push("#include <stdlib.h>");
  lines.push("#include <string.h>");
  lines.push("#include <stdio.h>");
  lines.push("#ifdef _WIN32");
  lines.push("  #include <windows.h>");
  lines.push("#else");
  lines.push("  #include <pthread.h>");
  lines.push("#endif");
  lines.push("");
  lines.push("typedef struct {");
  lines.push(`  ${id}_Instance model;`);
  lines.push("  fmi2String instanceName;");
  lines.push("  fmi2CallbackFunctions callbacks;");
  lines.push("  fmi2Boolean loggingOn;");
  lines.push("  double startTime;");
  lines.push("  double stopTime;");
  lines.push("  double stepSize;");
  lines.push("  /* Async co-simulation fields */");
  lines.push("  int asyncMode;          /* 0 = synchronous, 1 = asynchronous */");
  lines.push("  volatile int asyncDone; /* 0 = running, 1 = done */");
  lines.push("  volatile int cancelRequested;");
  lines.push("  fmi2Status asyncResult;");
  lines.push("  double asyncCurrentT;");
  lines.push("  double asyncTEnd;");
  lines.push("  /* Time-event scheduling fields */");
  lines.push("  int nextEventTimeDefined;");
  lines.push("  double nextEventTime;");
  lines.push("#ifdef _WIN32");
  lines.push("  HANDLE stepThread;");
  lines.push("#else");
  lines.push("  pthread_t stepThread;");
  lines.push("  int stepThreadActive;");
  lines.push("#endif");

  // State machine active-state fields
  for (let si = 0; si < dae.stateMachines.length; si++) {
    lines.push(
      `  int activeState_${si}; /* 0-indexed into states of SM ${si}: ${dae.stateMachines[si]?.name ?? ""} */`,
    );
  }
  // ExternalObject handle fields
  for (let ei = 0; ei < dae.externalObjects.length; ei++) {
    const eo = dae.externalObjects[ei];
    if (!eo) continue;
    lines.push(`  void* extObj_${ei}; /* ${eo.className} */`);
  }
  lines.push("  /* Input derivative storage for fmi2SetRealInputDerivatives */");
  lines.push("  double inputDerivatives[N_VARS + 1];");
  lines.push("  /* Terminate flag for Modelica terminate() calls */");
  lines.push("  int terminateRequested;");
  lines.push("} FMUInstance;");
  lines.push("");

  // ── Logger & Terminate Impl ──
  lines.push("static void fmi2_logger_impl(void* fmuInstance, const char* category, const char* message) {");
  lines.push("  FMUInstance* inst = (FMUInstance*)fmuInstance;");
  lines.push("  if (inst->callbacks.logger) {");
  lines.push(
    "    inst->callbacks.logger(inst->callbacks.componentEnvironment, inst->instanceName, fmi2Error, category, message);",
  );
  lines.push("  }");
  lines.push("}");
  lines.push("static void fmi2_terminate_impl(void* fmuInstance) {");
  lines.push("  FMUInstance* inst = (FMUInstance*)fmuInstance;");
  lines.push("  inst->terminateRequested = 1;");
  lines.push("}");
  lines.push("");

  // ── fmi2Instantiate ──
  lines.push("fmi2Component fmi2Instantiate(fmi2String instanceName, fmi2Type fmuType,");
  lines.push("    fmi2String fmuGUID, fmi2String fmuResourceLocation,");
  lines.push("    const fmi2CallbackFunctions* functions, fmi2Boolean visible, fmi2Boolean loggingOn) {");
  lines.push("  (void)fmuType; (void)fmuGUID; (void)fmuResourceLocation; (void)visible;");
  lines.push("  FMUInstance* inst = (FMUInstance*)calloc(1, sizeof(FMUInstance));");
  lines.push("  if (!inst) return NULL;");
  lines.push("  inst->instanceName = instanceName;");
  lines.push("  inst->callbacks = *functions;");
  lines.push("  inst->loggingOn = loggingOn;");
  lines.push(`  inst->stepSize = ${result.modelStructure.derivatives.length > 0 ? "0.001" : "0.001"};`);
  lines.push("  inst->model.fmuInstance = inst;");
  lines.push("  inst->model.logger = fmi2_logger_impl;");
  lines.push("  inst->model.terminate = fmi2_terminate_impl;");
  lines.push(`  ${id}_initialize(&inst->model);`);
  lines.push("  return (fmi2Component)inst;");
  lines.push("}");
  lines.push("");

  // Emit ExternalObject constructor calls right after fmi2Instantiate
  if (dae.externalObjects.length > 0) {
    lines.push("  /* --- ExternalObject constructors --- */");
    for (let ei = 0; ei < dae.externalObjects.length; ei++) {
      const eo = dae.externalObjects[ei];
      if (!eo) continue;
      const ctorName = sanitizeIdentifier(eo.constructorName);
      lines.push(`  inst->model.extObj_${ei} = (void*)${ctorName}();  /* ${eo.className} */`);
    }
    lines.push("");
  }

  // ── fmi2SetupExperiment ──
  lines.push("fmi2Status fmi2SetupExperiment(fmi2Component c, fmi2Boolean toleranceDefined,");
  lines.push("    fmi2Real tolerance, fmi2Real startTime, fmi2Boolean stopTimeDefined, fmi2Real stopTime) {");
  lines.push("  (void)toleranceDefined; (void)tolerance;");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  inst->startTime = startTime;");
  lines.push("  inst->model.time = startTime;");
  lines.push("  if (stopTimeDefined) inst->stopTime = stopTime;");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");

  // ── fmi2EnterInitializationMode / fmi2ExitInitializationMode ──
  lines.push("fmi2Status fmi2EnterInitializationMode(fmi2Component c) {");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  inst->model.isInitPhase = 1;");
  lines.push(`  ${id}_solveAlgebraicLoops(&inst->model);`);
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");
  lines.push("fmi2Status fmi2ExitInitializationMode(fmi2Component c) {");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  inst->model.isInitPhase = 0;");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");

  // ── fmi2GetReal / fmi2SetReal ──
  lines.push("fmi2Status fmi2GetReal(fmi2Component c, const fmi2ValueReference vr[], size_t nvr, fmi2Real value[]) {");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  for (size_t i = 0; i < nvr; i++) {");
  lines.push("    if (vr[i] < N_VARS) value[i] = inst->model.vars[vr[i]];");
  lines.push("  }");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");
  lines.push(
    "fmi2Status fmi2SetReal(fmi2Component c, const fmi2ValueReference vr[], size_t nvr, const fmi2Real value[]) {",
  );
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  for (size_t i = 0; i < nvr; i++) {");
  lines.push("    if (vr[i] < N_VARS) {");
  lines.push("      inst->model.vars[vr[i]] = value[i];");
  lines.push("    }");
  lines.push("  }");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");

  // ── fmi2GetInteger / fmi2SetInteger ──
  lines.push(
    "fmi2Status fmi2GetInteger(fmi2Component c, const fmi2ValueReference vr[], size_t nvr, fmi2Integer value[]) {",
  );
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  for (size_t i = 0; i < nvr; i++) {");
  lines.push("    if (vr[i] < N_VARS) value[i] = (fmi2Integer)inst->model.vars[vr[i]];");
  lines.push("  }");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");
  lines.push(
    "fmi2Status fmi2SetInteger(fmi2Component c, const fmi2ValueReference vr[], size_t nvr, const fmi2Integer value[]) {",
  );
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  for (size_t i = 0; i < nvr; i++) {");
  lines.push("    if (vr[i] < N_VARS) inst->model.vars[vr[i]] = (double)value[i];");
  lines.push("  }");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");

  // ── fmi2GetBoolean / fmi2SetBoolean ──
  lines.push(
    "fmi2Status fmi2GetBoolean(fmi2Component c, const fmi2ValueReference vr[], size_t nvr, fmi2Boolean value[]) {",
  );
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  for (size_t i = 0; i < nvr; i++) {");
  lines.push("    if (vr[i] < N_VARS) value[i] = inst->model.vars[vr[i]] != 0.0 ? fmi2True : fmi2False;");
  lines.push("  }");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");
  lines.push(
    "fmi2Status fmi2SetBoolean(fmi2Component c, const fmi2ValueReference vr[], size_t nvr, const fmi2Boolean value[]) {",
  );
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  for (size_t i = 0; i < nvr; i++) {");
  lines.push("    if (vr[i] < N_VARS) inst->model.vars[vr[i]] = value[i] ? 1.0 : 0.0;");
  lines.push("  }");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");

  // ── fmi2GetString / fmi2SetString ──
  lines.push(
    "fmi2Status fmi2GetString(fmi2Component c, const fmi2ValueReference vr[], size_t nvr, fmi2String value[]) {",
  );
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  for (size_t i = 0; i < nvr; i++) {");
  lines.push("    if (vr[i] < N_STRING_VARS) {");
  lines.push('      value[i] = inst->model.stringVars[vr[i]] ? inst->model.stringVars[vr[i]] : "";');
  lines.push("    }");
  lines.push("  }");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");
  lines.push(
    "fmi2Status fmi2SetString(fmi2Component c, const fmi2ValueReference vr[], size_t nvr, const fmi2String value[]) {",
  );
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  for (size_t i = 0; i < nvr; i++) {");
  lines.push("    if (vr[i] < N_STRING_VARS) {");
  lines.push("      if (inst->model.stringVars[vr[i]]) free(inst->model.stringVars[vr[i]]);");
  lines.push("      inst->model.stringVars[vr[i]] = value[i] ? strdup(value[i]) : NULL;");
  lines.push("    }");
  lines.push("  }");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");

  // ── fmi2GetDerivatives ──
  lines.push("fmi2Status fmi2GetDerivatives(fmi2Component c, fmi2Real derivatives[], size_t nContinuousStates) {");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push(`  ${id}_getDerivatives(&inst->model);`);
  lines.push("  for (size_t i = 0; i < nContinuousStates && i < N_STATES; i++) {");
  lines.push("    derivatives[i] = inst->model.derivatives[i];");
  lines.push("  }");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");

  // ── fmi2GetEventIndicators ──
  lines.push("fmi2Status fmi2GetEventIndicators(fmi2Component c, fmi2Real eventIndicators[], size_t ni) {");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push(`  ${id}_getEventIndicators(&inst->model, eventIndicators);`);
  lines.push("  (void)ni;");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");

  // ── fmi2SetTime ──
  lines.push("fmi2Status fmi2SetTime(fmi2Component c, fmi2Real time) {");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  inst->model.time = time;");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");

  // ── fmi2SetContinuousStates / fmi2GetContinuousStates ──
  const stateVRs = result.modelStructure.derivatives.map((derVR) => {
    const sv = result.scalarVariables.find((x) => x.valueReference === derVR);
    const stateName = sv?.name.match(/^der\((.+)\)$/)?.[1];
    return stateName ? (result.scalarVariables.find((x) => x.name === stateName)?.valueReference ?? -1) : -1;
  });

  lines.push("fmi2Status fmi2SetContinuousStates(fmi2Component c, const fmi2Real x[], size_t nx) {");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  for (let i = 0; i < stateVRs.length; i++) {
    const vr = stateVRs[i];
    if (vr !== undefined && vr >= 0) {
      lines.push(`  if (${i} < nx) inst->model.vars[${vr}] = x[${i}];`);
    }
  }
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");
  lines.push("fmi2Status fmi2GetContinuousStates(fmi2Component c, fmi2Real x[], size_t nx) {");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  for (let i = 0; i < stateVRs.length; i++) {
    const vr = stateVRs[i];
    if (vr !== undefined && vr >= 0) {
      lines.push(`  if (${i} < nx) x[${i}] = inst->model.vars[${vr}];`);
    }
  }
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");

  // ── Completed integrator step ──
  lines.push(
    "fmi2Status fmi2CompletedIntegratorStep(fmi2Component c, fmi2Boolean noSetFMUStatePriorToCurrentPoint, fmi2Boolean* enterEventMode, fmi2Boolean* terminateSimulation) {",
  );
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  *enterEventMode = fmi2False;");
  lines.push("  *terminateSimulation = inst->terminateRequested ? fmi2True : fmi2False;");
  lines.push("  (void)noSetFMUStatePriorToCurrentPoint;");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");

  // ── New discrete states / Event handling ──
  lines.push("fmi2Status fmi2NewDiscreteStates(fmi2Component c, fmi2EventInfo* info) {");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  info->newDiscreteStatesNeeded = fmi2False;");
  lines.push("  info->terminateSimulation = inst->terminateRequested ? fmi2True : fmi2False;");
  lines.push("  info->nominalsOfContinuousStatesChanged = fmi2False;");
  lines.push("  info->valuesOfContinuousStatesChanged = fmi2False;");
  lines.push("  info->nextEventTimeDefined = fmi2False;");
  lines.push("  info->nextEventTime = 0.0;");

  // Collect when equations
  const whenEqIdxs: number[] = [];
  for (let idx = 0; idx < dae.eqCount; idx++) {
    if (dae.getEqKind(idx) === EqKind.When) {
      whenEqIdxs.push(idx);
    }
  }

  if (whenEqIdxs.length > 0) {
    let whenIdx = 0;
    for (const eqIdx of whenEqIdxs) {
      const weq = dae.getWhenEquationMeta(eqIdx);
      if (!weq) continue;

      // Evaluate condition directly
      const condC = conditionToZeroCrossingC(dae, weq.conditionExprId);
      lines.push(`  /* when-equation ${whenIdx} */`);
      lines.push(`  if (${condC} > 0.0 && inst->model.whenPrev[${whenIdx}] <= 0.0) {`);

      // Execute the when-equation body assignments
      for (const bodyEq of weq.bodyEquations) {
        if (bodyEq.kind === EqKind.Simple) {
          const lhsName = extractAssignmentTarget(dae, bodyEq.lhsExprId);
          if (lhsName) {
            // Find the VR for this variable
            const sv = result.scalarVariables.find((v) => v.name === lhsName);
            if (sv) {
              lines.push(
                `    inst->model.vars[${sv.valueReference}] = ${exprToC(dae, bodyEq.rhsExprId)};  /* ${lhsName} */`,
              );
            }
          }
        } else if (bodyEq.kind === EqKind.FunctionCall) {
          if (dae.getExprKind(bodyEq.lhsExprId) === ExprKind.Call) {
            const callId = bodyEq.lhsExprId;
            const fname = dae.interner.resolve(dae.getExprData1(callId));
            if (fname === "reinit") {
              const arg0 = dae.getExprLeft(callId);
              const arg1 = dae.getExprLeft(callId + 1);
              if (dae.getExprKind(arg0) === ExprKind.Name) {
                const stateName = dae.interner.resolve(dae.getExprData1(arg0));
                const sv = result.scalarVariables.find((v) => v.name === stateName);
                if (sv) {
                  lines.push(
                    `    inst->model.vars[${sv.valueReference}] = ${exprToC(dae, arg1)};  /* reinit(${stateName}) */`,
                  );
                  lines.push(`    info->valuesOfContinuousStatesChanged = fmi2True;`);
                }
              }
            }
          }
        }
      }
      lines.push("  }");
      lines.push(`  inst->model.whenPrev[${whenIdx}] = ${condC};`);
      whenIdx++;

      // elseWhen clauses
      for (const clause of weq.elseWhenClauses) {
        const condElseC = conditionToZeroCrossingC(dae, clause.conditionExprId);
        lines.push(`  /* elsewhen-clause ${whenIdx} */`);
        lines.push(`  if (${condElseC} > 0.0 && inst->model.whenPrev[${whenIdx}] <= 0.0) {`);
        for (const bodyEq of clause.bodyEquations) {
          if (bodyEq.kind === EqKind.Simple) {
            const lhsName = extractAssignmentTarget(dae, bodyEq.lhsExprId);
            if (lhsName) {
              const sv = result.scalarVariables.find((v) => v.name === lhsName);
              if (sv) {
                lines.push(
                  `    inst->model.vars[${sv.valueReference}] = ${exprToC(dae, bodyEq.rhsExprId)};  /* ${lhsName} */`,
                );
              }
            }
          } else if (bodyEq.kind === EqKind.FunctionCall) {
            if (dae.getExprKind(bodyEq.lhsExprId) === ExprKind.Call) {
              const callId = bodyEq.lhsExprId;
              const fname = dae.interner.resolve(dae.getExprData1(callId));
              if (fname === "reinit") {
                const arg0 = dae.getExprLeft(callId);
                const arg1 = dae.getExprLeft(callId + 1);
                if (dae.getExprKind(arg0) === ExprKind.Name) {
                  const stateName = dae.interner.resolve(dae.getExprData1(arg0));
                  const sv = result.scalarVariables.find((v) => v.name === stateName);
                  if (sv) {
                    lines.push(
                      `    inst->model.vars[${sv.valueReference}] = ${exprToC(dae, arg1)};  /* reinit(${stateName}) */`,
                    );
                    lines.push(`    info->valuesOfContinuousStatesChanged = fmi2True;`);
                  }
                }
              }
            }
          }
        }
        lines.push("  }");
        lines.push(`  inst->model.whenPrev[${whenIdx}] = ${condElseC};`);
        whenIdx++;
      }
    }
  }

  // Time-event scheduling: scan when-conditions for "time >= T" patterns
  if (whenEqIdxs.length > 0) {
    lines.push("  /* Time-event detection and scheduling */");
    for (const eqIdx of whenEqIdxs) {
      const weq = dae.getWhenEquationMeta(eqIdx);
      if (!weq) continue;

      const tEvent = extractTimeEventThresholdC(dae, weq.conditionExprId);
      if (tEvent) {
        lines.push(`  if (inst->model.time < (${tEvent})) {`);
        lines.push("    info->nextEventTimeDefined = fmi2True;");
        lines.push(`    info->nextEventTime = ${tEvent};`);
        lines.push("  }");
      }
      for (const clause of weq.elseWhenClauses) {
        const tEventElse = extractTimeEventThresholdC(dae, clause.conditionExprId);
        if (tEventElse) {
          lines.push(`  if (inst->model.time < (${tEventElse})) {`);
          lines.push("    info->nextEventTimeDefined = fmi2True;");
          lines.push(`    info->nextEventTime = ${tEventElse};`);
          lines.push("  }");
        }
      }
    }
  }

  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");

  // ── Co-Simulation Step Integration (RK4 / DOPRI5 / Forward Euler) ──
  lines.push("/* Runge-Kutta 4th Order fixed-step integrator with Event Detection */");
  lines.push("static void integrate_rk4(FMUInstance* inst, double t_start, double t_end, double dt) {");
  lines.push("  int n = N_STATES;");
  lines.push("  double k1[N_STATES + 1], k2[N_STATES + 1], k3[N_STATES + 1], k4[N_STATES + 1];");
  lines.push("  double y0[N_STATES + 1], tmp_states[N_STATES + 1];");
  lines.push("  double z_prev[N_EVENT_INDICATORS + 1];");
  lines.push("  double t = t_start;");
  lines.push("");
  lines.push("  while (t < t_end - 1e-13) {");
  lines.push("    double h = t_end - t;");
  lines.push("    int step_accepted = 0;");
  lines.push("    for (int i = 0; i < n; i++) {");
  for (let i = 0; i < stateVRs.length; i++) {
    const vr = stateVRs[i];
    if (vr !== undefined && vr >= 0) {
      lines.push(`      y0[${i}] = inst->model.vars[${vr}];`);
    }
  }
  lines.push("    }");
  lines.push("    inst->model.time = t;");
  lines.push("    if (N_EVENT_INDICATORS > 0) {");
  lines.push(`      ${id}_getEventIndicators(&inst->model, z_prev);`);
  lines.push("    }");
  lines.push("");
  lines.push("    while (!step_accepted) {");
  lines.push("      /* k1 */");
  lines.push("      inst->model.time = t;");
  for (let i = 0; i < stateVRs.length; i++) {
    const vr = stateVRs[i];
    if (vr !== undefined && vr >= 0) {
      lines.push(`      inst->model.vars[${vr}] = y0[${i}];`);
    }
  }
  lines.push(`      ${id}_getDerivatives(&inst->model);`);
  lines.push("      for (int i = 0; i < n; i++) k1[i] = inst->model.derivatives[i];");
  lines.push("");
  lines.push("      /* k2 */");
  lines.push("      inst->model.time = t + 0.5 * h;");
  for (let i = 0; i < stateVRs.length; i++) {
    const vr = stateVRs[i];
    if (vr !== undefined && vr >= 0) {
      lines.push(`      inst->model.vars[${vr}] = y0[${i}] + 0.5 * h * k1[${i}];`);
    }
  }
  lines.push(`      ${id}_getDerivatives(&inst->model);`);
  lines.push("      for (int i = 0; i < n; i++) k2[i] = inst->model.derivatives[i];");
  lines.push("");
  lines.push("      /* k3 */");
  for (let i = 0; i < stateVRs.length; i++) {
    const vr = stateVRs[i];
    if (vr !== undefined && vr >= 0) {
      lines.push(`      inst->model.vars[${vr}] = y0[${i}] + 0.5 * h * k2[${i}];`);
    }
  }
  lines.push(`      ${id}_getDerivatives(&inst->model);`);
  lines.push("      for (int i = 0; i < n; i++) k3[i] = inst->model.derivatives[i];");
  lines.push("");
  lines.push("      /* k4 */");
  lines.push("      inst->model.time = t + h;");
  for (let i = 0; i < stateVRs.length; i++) {
    const vr = stateVRs[i];
    if (vr !== undefined && vr >= 0) {
      lines.push(`      inst->model.vars[${vr}] = y0[${i}] + h * k3[${i}];`);
    }
  }
  lines.push(`      ${id}_getDerivatives(&inst->model);`);
  lines.push("      for (int i = 0; i < n; i++) k4[i] = inst->model.derivatives[i];");
  lines.push("");
  lines.push("      /* Combine */");
  for (let i = 0; i < stateVRs.length; i++) {
    const vr = stateVRs[i];
    if (vr !== undefined && vr >= 0) {
      lines.push(
        `      tmp_states[${i}] = y0[${i}] + (h / 6.0) * (k1[${i}] + 2.0 * k2[${i}] + 2.0 * k3[${i}] + k4[${i}]);`,
      );
    }
  }
  lines.push("");
  lines.push("      int crossing = 0;");
  lines.push("      if (N_EVENT_INDICATORS > 0) {");
  lines.push("        inst->model.time = t + h;");
  for (let i = 0; i < stateVRs.length; i++) {
    const vr = stateVRs[i];
    if (vr !== undefined && vr >= 0) {
      lines.push(`        inst->model.vars[${vr}] = tmp_states[${i}];`);
    }
  }
  lines.push("        double z_curr[N_EVENT_INDICATORS + 1];");
  lines.push(`        ${id}_getEventIndicators(&inst->model, z_curr);`);
  lines.push("        for (int i = 0; i < N_EVENT_INDICATORS; i++) {");
  lines.push("          if (z_prev[i] * z_curr[i] < 0.0) { crossing = 1; break; }");
  lines.push("        }");
  lines.push("      }");
  lines.push("      if (crossing && h > 1e-7) {");
  lines.push("        h *= 0.5;");
  lines.push("      } else {");
  lines.push("        step_accepted = 1;");
  lines.push("      }");
  lines.push("    }");
  lines.push("    t += h;");
  for (let i = 0; i < stateVRs.length; i++) {
    const vr = stateVRs[i];
    if (vr !== undefined && vr >= 0) {
      lines.push(`    inst->model.vars[${vr}] = tmp_states[${i}];`);
    }
  }
  lines.push("    inst->model.time = t;");
  lines.push("");
  lines.push("    /* Call discrete state update */");
  lines.push("    fmi2EventInfo info;");
  lines.push("    fmi2NewDiscreteStates(inst, &info);");
  lines.push("  }");
  lines.push("}");

  // ── fmi2DoStep ──
  lines.push("fmi2Status fmi2DoStep(fmi2Component c, fmi2Real currentCommunicationPoint,");
  lines.push("    fmi2Real communicationStepSize, fmi2Boolean noSetFMUStatePriorToCurrentPoint) {");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  double t = currentCommunicationPoint;");
  lines.push("  double tEnd = t + communicationStepSize;");
  lines.push("  double h = inst->stepSize;");
  lines.push("  (void)noSetFMUStatePriorToCurrentPoint;");
  lines.push("");
  lines.push("  if (inst->asyncMode) {");
  lines.push("    /* Asynchronous Mode execution step */");
  lines.push("    if (!inst->asyncDone) {");
  lines.push("      return fmi2Pending;");
  lines.push("    }");
  lines.push("    inst->asyncDone = 0;");
  lines.push("    inst->asyncCurrentT = t;");
  lines.push("    inst->asyncTEnd = tEnd;");
  lines.push("#ifdef _WIN32");
  lines.push("    inst->stepThread = CreateThread(NULL, 0, async_step_worker, inst, 0, NULL);");
  lines.push("#else");
  lines.push("    inst->stepThreadActive = (pthread_create(&inst->stepThread, NULL, async_step_worker, inst) == 0);");
  lines.push("#endif");
  lines.push("    return fmi2Pending;");
  lines.push("  }");
  lines.push("");
  lines.push("  /* Synchronous Mode execution step */");
  lines.push("  while (t < tEnd - 1e-13) {");
  lines.push("    double hStep = h;");
  lines.push("    if (t + hStep > tEnd) hStep = tEnd - t;");
  lines.push("    integrate_rk4(inst, t, t + hStep, hStep);");
  lines.push("    t += hStep;");
  lines.push("  }");
  lines.push("  inst->model.time = tEnd;");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");

  // ── fmi2CancelStep ──
  lines.push("fmi2Status fmi2CancelStep(fmi2Component c) {");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  if (inst->asyncMode && !inst->asyncDone) {");
  lines.push("    inst->cancelRequested = 1;");
  lines.push("#ifdef _WIN32");
  lines.push("    WaitForSingleObject(inst->stepThread, INFINITE);");
  lines.push("    CloseHandle(inst->stepThread);");
  lines.push("#else");
  lines.push("    if (inst->stepThreadActive) {");
  lines.push("      pthread_join(inst->stepThread, NULL);");
  lines.push("      inst->stepThreadActive = 0;");
  lines.push("    }");
  lines.push("#endif");
  lines.push("    inst->cancelRequested = 0;");
  lines.push("    return fmi2OK;");
  lines.push("  }");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");

  // ── fmi2GetStatus / fmi2GetRealStatus / etc. ──
  lines.push("fmi2Status fmi2GetStatus(fmi2Component c, const fmi2StatusKind s, fmi2Status* value) {");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  if (s == fmi2DoStepStatus) {");
  lines.push("    if (inst->asyncMode) {");
  lines.push("      if (!inst->asyncDone) {");
  lines.push("        *value = fmi2Pending;");
  lines.push("        return fmi2OK;");
  lines.push("      }");
  lines.push("      *value = inst->asyncResult;");
  lines.push("      return fmi2OK;");
  lines.push("    }");
  lines.push("    *value = fmi2OK;");
  lines.push("  }");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");
  lines.push("fmi2Status fmi2GetRealStatus(fmi2Component c, const fmi2StatusKind s, fmi2Real* value) {");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  if (s == fmi2LastSuccessfulTime) {");
  lines.push("    *value = inst->asyncMode ? inst->asyncCurrentT : inst->model.time;");
  lines.push("  }");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");
  lines.push(
    "fmi2Status fmi2GetIntegerStatus(fmi2Component c, const fmi2StatusKind s, fmi2Integer* value) { (void)c; (void)s; (void)value; return fmi2OK; }",
  );
  lines.push(
    "fmi2Status fmi2GetBooleanStatus(fmi2Component c, const fmi2StatusKind s, fmi2Boolean* value) { (void)c; (void)s; (void)value; return fmi2OK; }",
  );
  lines.push(
    "fmi2Status fmi2GetStringStatus(fmi2Component c, const fmi2StatusKind s, fmi2String* value) { (void)c; (void)s; (void)value; return fmi2OK; }",
  );
  lines.push("");

  // ── Terminate / FreeInstance / Reset ──
  lines.push("fmi2Status fmi2Terminate(fmi2Component c) {");
  lines.push("  (void)c;");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");
  lines.push("void fmi2FreeInstance(fmi2Component c) {");
  lines.push("  if (!c) return;");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  // ExternalObject destructors
  if (dae.externalObjects.length > 0) {
    lines.push("  /* ExternalObject destructors */");
    for (let ei = 0; ei < dae.externalObjects.length; ei++) {
      const eo = dae.externalObjects[ei];
      if (!eo) continue;
      const dtorName = sanitizeIdentifier(eo.destructorName);
      lines.push(`  ${dtorName}(inst->model.extObj_${ei});`);
    }
  }
  lines.push("  for (int i = 0; i < N_STRING_VARS; i++) {");
  lines.push("    if (inst->model.stringVars[i]) free(inst->model.stringVars[i]);");
  lines.push("  }");
  lines.push("  free(c);");
  lines.push("}");
  lines.push("");
  lines.push("fmi2Status fmi2Reset(fmi2Component c) {");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  for (let ei = 0; ei < dae.externalObjects.length; ei++) {
    const eo = dae.externalObjects[ei];
    if (!eo) continue;
    const ctorName = sanitizeIdentifier(eo.constructorName);
    const dtorName = sanitizeIdentifier(eo.destructorName);
    lines.push(`  if (inst->model.extObj_${ei}) {`);
    lines.push(`    ${dtorName}(inst->model.extObj_${ei});`);
    lines.push(`  }`);
    lines.push(`  inst->model.extObj_${ei} = ${ctorName}();`);
  }
  lines.push(`  ${id}_initialize(&inst->model);`);
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");

  // ── SetDebugLogging ──
  lines.push(
    "fmi2Status fmi2SetDebugLogging(fmi2Component c, fmi2Boolean loggingOn, size_t nCategories, const fmi2String categories[]) {",
  );
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  inst->loggingOn = loggingOn;");
  lines.push("  (void)nCategories; (void)categories;");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");

  // ── fmi2GetDirectionalDerivative ──
  lines.push("/* Exact Directional Derivative via exact AD and symbolic CAS differentiation */");
  lines.push("fmi2Status fmi2GetDirectionalDerivative(fmi2Component c,");
  lines.push("    const fmi2ValueReference unknowns[], size_t nUnknown,");
  lines.push("    const fmi2ValueReference knowns[], size_t nKnown,");
  lines.push("    const fmi2Real dvKnown[], fmi2Real dvUnknown[]) {");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");

  const derEquations: { stateName: string; rhs: number }[] = [];
  for (let idx = 0; idx < dae.eqCount; idx++) {
    const lhs = dae.getEqLhs(idx);
    const rhs = dae.getEqRhs(idx);
    const lhsDer = extractDerName(dae, lhs);
    const rhsDer = extractDerName(dae, rhs);
    if (lhsDer) {
      derEquations.push({ stateName: lhsDer, rhs });
    } else if (rhsDer) {
      derEquations.push({ stateName: rhsDer, rhs: lhs });
    }
  }

  // Build VR→derivative index and VR→state variable name mappings
  const derVRs = result.modelStructure.derivatives; // VRs of derivative variables
  const jacStateVRs: number[] = []; // VRs of state variables
  const stateNames: string[] = []; // Names of state variables
  for (const derEq of derEquations) {
    const sv = result.scalarVariables.find((v) => v.name === derEq.stateName);
    if (sv) {
      jacStateVRs.push(sv.valueReference);
      stateNames.push(derEq.stateName);
    }
  }

  if (derEquations.length > 0 && jacStateVRs.length > 0) {
    // Emit local variable aliases
    lines.push(`  double time = inst->model.time;`);
    lines.push(`  (void)time;`);
    for (const sv of result.scalarVariables) {
      if (sv.causality === "independent") continue;
      const cName = varToC(sv.name);
      lines.push(`  double ${cName} = inst->model.vars[${sv.valueReference}];`);
      lines.push(`  (void)${cName};`);
    }
    lines.push("");
    lines.push("  /* Zero output */");
    lines.push("  for (size_t i = 0; i < nUnknown; i++) dvUnknown[i] = 0.0;");
    lines.push("");
    lines.push("  /* Accumulate Jacobian-vector product: dvUnknown[i] += J[i][j] * dvKnown[j] */");
    lines.push("  for (size_t j = 0; j < nKnown; j++) {");
    lines.push("    for (size_t i = 0; i < nUnknown; i++) {");

    // For each (derivative, state) pair, emit the symbolic Jacobian entry
    // Use switch on unknown VR, then switch on known VR
    lines.push("      switch (unknowns[i]) {");
    for (let di = 0; di < derEquations.length; di++) {
      const derVR = derVRs[di];
      const derEq = derEquations[di];
      if (derVR === undefined || !derEq) continue;
      lines.push(`      case ${derVR}: /* der(${derEq.stateName}) */`);
      lines.push("        switch (knowns[j]) {");
      for (let si = 0; si < stateNames.length; si++) {
        const jacVR = jacStateVRs[si];
        const stateName = stateNames[si];
        if (jacVR === undefined || !stateName) continue;
        // Symbolically differentiate rhs w.r.t. state variable
        const stateVarId = dae.interner.intern(stateName);
        const diffId = differentiateArenaExpressionWrt(dae, derEq.rhs, stateVarId);
        const simpId = simplifyArenaExpression(dae, diffId);
        const jacobianC = exprToC(dae, simpId);
        lines.push(
          `        case ${jacVR}: dvUnknown[i] += (${jacobianC}) * dvKnown[j]; break; /* d/d(${stateName}) */`,
        );
      }
      lines.push("        default: break;");
      lines.push("        }");
      lines.push("        break;");
    }
    lines.push("      default: break;");
    lines.push("      }");
    lines.push("    }");
    lines.push("  }");
  } else {
    lines.push("  (void)inst; (void)unknowns; (void)nUnknown; (void)knowns; (void)nKnown; (void)dvKnown;");
    lines.push("  for (size_t i = 0; i < nUnknown; i++) dvUnknown[i] = 0.0;");
  }

  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");

  return lines.join("\n");
}

function generateCMakeLists(id: string, _externalIncludes: string[]): string {
  void _externalIncludes;
  const lines: string[] = [];
  lines.push(`# Auto-generated by ModelScript — do not edit`);
  lines.push("cmake_minimum_required(VERSION 3.10)");
  lines.push(`project(${id} C)`);
  lines.push("set(CMAKE_C_STANDARD 99)");
  lines.push("");
  lines.push("if(CMAKE_SIZEOF_VOID_P EQUAL 8)");
  lines.push('  set(FMI_ARCH "x86_64")');
  lines.push("else()");
  lines.push('  set(FMI_ARCH "x86")');
  lines.push("endif()");
  lines.push("");
  lines.push("if(WIN32)");
  lines.push('  set(FMI_PLATFORM "${FMI_ARCH}-windows")');
  lines.push("elseif(APPLE)");
  lines.push('  set(FMI_PLATFORM "${FMI_ARCH}-darwin")');
  lines.push("else()");
  lines.push('  set(FMI_PLATFORM "${FMI_ARCH}-linux")');
  lines.push("endif()");
  lines.push("");
  lines.push(`add_library(${id} SHARED ${id}_model.c fmi2Functions.c)`);
  lines.push(`target_include_directories(${id} PRIVATE \${CMAKE_CURRENT_SOURCE_DIR})`);
  lines.push(
    `set_target_properties(${id} PROPERTIES PREFIX "" C_VISIBILITY_PRESET hidden POSITION_INDEPENDENT_CODE ON)`,
  );
  lines.push("");
  lines.push("if(MSVC)");
  lines.push(`  target_compile_definitions(${id} PRIVATE FMI2_FUNCTION_PREFIX=)`);
  lines.push("else()");
  lines.push(`  target_compile_options(${id} PRIVATE -Wall -Wextra -O2)`);
  lines.push("endif()");
  lines.push("");
  lines.push(
    `install(TARGETS ${id} LIBRARY DESTINATION binaries/\${FMI_PLATFORM} RUNTIME DESTINATION binaries/\${FMI_PLATFORM})`,
  );
  lines.push("");
  lines.push(`message(STATUS "FMI platform: \${FMI_PLATFORM}")`);
  lines.push('message(STATUS "Build with: cmake -B build && cmake --build build")');
  lines.push(`message(STATUS "Library will be: build/${id}\${CMAKE_SHARED_LIBRARY_SUFFIX}")`);
  return lines.join("\n");
}

function extractDerName(dae: ArenaDAEBuilder, exprId: number): string | null {
  if (exprId >= 0 && dae.getExprKind(exprId) === ExprKind.Der) {
    const operand = dae.getExprData1(exprId);
    if (operand >= 0 && dae.getExprKind(operand) === ExprKind.Name) {
      return dae.interner.resolve(dae.getExprData1(operand));
    }
  }
  if (exprId >= 0 && dae.getExprKind(exprId) === ExprKind.Name) {
    const name = dae.interner.resolve(dae.getExprData1(exprId));
    if (name.startsWith("der(") && name.endsWith(")")) {
      return name.substring(4, name.length - 1);
    }
  }
  return null;
}

/** Recursively collect all variable names referenced in an expression. */
function collectReferencedNames(dae: ArenaDAEBuilder, id: number, names: Set<string>): void {
  if (id < 0) return;
  switch (dae.getExprKind(id)) {
    case ExprKind.Name: {
      const name = dae.interner.resolve(dae.getExprData1(id));
      if (name.startsWith("der(") && name.endsWith(")")) {
        names.add(name.substring(4, name.length - 1));
      } else {
        names.add(name);
      }
      break;
    }
    case ExprKind.Binary:
      collectReferencedNames(dae, dae.getExprLeft(id), names);
      collectReferencedNames(dae, dae.getExprRight(id), names);
      break;
    case ExprKind.Unary:
    case ExprKind.Negate:
      collectReferencedNames(dae, dae.getExprLeft(id), names);
      break;
    case ExprKind.Der:
    case ExprKind.Pre:
      collectReferencedNames(dae, dae.getExprData1(id), names);
      break;
    case ExprKind.Subscript: {
      collectReferencedNames(dae, dae.getExprData1(id), names);
      const scount = dae.getExprRight(id);
      for (let i = 0; i < scount; i++) {
        collectReferencedNames(dae, dae.getExprLeft(id + i), names);
      }
      break;
    }
    case ExprKind.ArrayCtor: {
      const count = dae.getExprData1(id);
      for (let i = 0; i < count; i++) {
        collectReferencedNames(dae, dae.getExprLeft(id + i), names);
      }
      break;
    }
    case ExprKind.IfElse:
      collectReferencedNames(dae, dae.getExprData1(id), names);
      collectReferencedNames(dae, dae.getExprLeft(id), names);
      collectReferencedNames(dae, dae.getExprRight(id), names);
      break;
    case ExprKind.Call: {
      const argCount = dae.getExprRight(id);
      for (let i = 0; i < argCount; i++) {
        collectReferencedNames(dae, dae.getExprLeft(id + i), names);
      }
      break;
    }
  }
}

export function generateFmi3FunctionsC(id: string, dae: ArenaDAEBuilder): string {
  const lines: string[] = [];
  lines.push("/* Auto-generated by ModelScript — FMI 3.0 API */");
  lines.push(`#include "${id}_model.h"`);
  lines.push("#include <string.h>");
  lines.push("#include <stdlib.h>");
  lines.push("");
  lines.push("/* Typedefs for FMI 3.0 */");
  lines.push("typedef void* fmi3Instance;");
  lines.push("typedef void* fmi3InstanceEnvironment;");
  lines.push("typedef void* fmi3FMUState;");
  lines.push("typedef const char* fmi3String;");
  lines.push("typedef double fmi3Float64;");
  lines.push("typedef float fmi3Float32;");
  lines.push("typedef int fmi3Int32;");
  lines.push("typedef int fmi3Boolean;");
  lines.push("typedef fmi3Boolean fmi3Clock;");
  lines.push("typedef unsigned int fmi3ValueReference;");
  lines.push("typedef enum { fmi3OK, fmi3Warning, fmi3Discard, fmi3Error, fmi3Fatal } fmi3Status;");
  lines.push("typedef void (*fmi3LogMessageCallback)(fmi3InstanceEnvironment, fmi3Status, fmi3String, fmi3String);");
  lines.push("");
  lines.push("typedef struct {");
  lines.push(`  ${id}_Instance model;`);
  lines.push("  fmi3String instanceName;");
  lines.push("  fmi3InstanceEnvironment env;");
  lines.push("  fmi3LogMessageCallback logMessage;");
  lines.push("  fmi3Boolean loggingOn;");
  lines.push("} FMI3InstanceData;");
  lines.push("");
  lines.push("fmi3Instance fmi3InstantiateModelExchange(");
  lines.push("  fmi3String instanceName, fmi3String instantiationToken,");
  lines.push("  fmi3String resourcePath, fmi3Boolean visible,");
  lines.push("  fmi3Boolean loggingOn, fmi3InstanceEnvironment env,");
  lines.push("  fmi3LogMessageCallback logMessage) {");
  lines.push("  (void)instantiationToken; (void)resourcePath; (void)visible;");
  lines.push("  FMI3InstanceData* inst = (FMI3InstanceData*)calloc(1, sizeof(FMI3InstanceData));");
  lines.push("  if (!inst) return NULL;");
  lines.push("  inst->instanceName = instanceName;");
  lines.push("  inst->env = env;");
  lines.push("  inst->logMessage = logMessage;");
  lines.push("  inst->loggingOn = loggingOn;");
  lines.push(`  ${id}_initialize(&inst->model);`);
  lines.push("  return (fmi3Instance)inst;");
  lines.push("}");
  lines.push("");
  lines.push("fmi3Instance fmi3InstantiateCoSimulation(");
  lines.push("  fmi3String instanceName, fmi3String instantiationToken,");
  lines.push("  fmi3String resourcePath, fmi3Boolean visible,");
  lines.push("  fmi3Boolean loggingOn, fmi3Boolean eventModeUsed,");
  lines.push("  fmi3Boolean earlyReturnAllowed, const fmi3ValueReference requiredIntermediateVariables[],");
  lines.push("  size_t nRequiredIntermediateVariables, fmi3InstanceEnvironment env,");
  lines.push("  fmi3LogMessageCallback logMessage, void* intermediateUpdate) {");
  lines.push(
    "  (void)eventModeUsed; (void)earlyReturnAllowed; (void)requiredIntermediateVariables; (void)nRequiredIntermediateVariables; (void)intermediateUpdate;",
  );
  lines.push(
    "  return fmi3InstantiateModelExchange(instanceName, instantiationToken, resourcePath, visible, loggingOn, env, logMessage);",
  );
  lines.push("}");
  lines.push("");
  lines.push("void fmi3FreeInstance(fmi3Instance instance) {");
  lines.push("  if (!instance) return;");
  lines.push("  FMI3InstanceData* inst = (FMI3InstanceData*)instance;");
  lines.push("  for (int i = 0; i < N_STRING_VARS; i++) {");
  lines.push("    if (inst->model.stringVars[i]) free(inst->model.stringVars[i]);");
  lines.push("  }");
  lines.push("  free(instance);");
  lines.push("}");
  lines.push("");
  lines.push("fmi3Status fmi3GetFMUState(fmi3Instance instance, fmi3FMUState* state) {");
  lines.push("  if (!instance || !state) return fmi3Error;");
  lines.push("  FMI3InstanceData* inst = (FMI3InstanceData*)instance;");
  lines.push("  FMI3InstanceData* copy = (FMI3InstanceData*)malloc(sizeof(FMI3InstanceData));");
  lines.push("  if (!copy) return fmi3Error;");
  lines.push("  memcpy(copy, inst, sizeof(FMI3InstanceData));");
  lines.push("  /* Deep copy strings */");
  lines.push("  for (int i = 0; i < N_STRING_VARS; i++) {");
  lines.push("    if (inst->model.stringVars[i]) {");
  lines.push("      copy->model.stringVars[i] = strdup(inst->model.stringVars[i]);");
  lines.push("    } else {");
  lines.push("      copy->model.stringVars[i] = NULL;");
  lines.push("    }");
  lines.push("  }");
  lines.push("  *state = (fmi3FMUState)copy;");
  lines.push("  return fmi3OK;");
  lines.push("}");
  lines.push("");
  lines.push("fmi3Status fmi3SetFMUState(fmi3Instance instance, fmi3FMUState state) {");
  lines.push("  if (!instance || !state) return fmi3Error;");
  lines.push("  FMI3InstanceData* inst = (FMI3InstanceData*)instance;");
  lines.push("  fmi3String savedName = inst->instanceName;");
  lines.push("  fmi3InstanceEnvironment savedEnv = inst->env;");
  lines.push("  fmi3LogMessageCallback savedLogMessage = inst->logMessage;");
  lines.push("  fmi3Boolean savedLoggingOn = inst->loggingOn;");
  lines.push("  /* Free current strings */");
  lines.push("  for (int i = 0; i < N_STRING_VARS; i++) {");
  lines.push("    if (inst->model.stringVars[i]) free(inst->model.stringVars[i]);");
  lines.push("  }");
  lines.push("  memcpy(inst, (FMI3InstanceData*)state, sizeof(FMI3InstanceData));");
  lines.push("  inst->instanceName = savedName;");
  lines.push("  inst->env = savedEnv;");
  lines.push("  inst->logMessage = savedLogMessage;");
  lines.push("  inst->loggingOn = savedLoggingOn;");
  lines.push("  /* Deep copy strings */");
  lines.push("  for (int i = 0; i < N_STRING_VARS; i++) {");
  lines.push("    if (((FMI3InstanceData*)state)->model.stringVars[i]) {");
  lines.push("      inst->model.stringVars[i] = strdup(((FMI3InstanceData*)state)->model.stringVars[i]);");
  lines.push("    } else {");
  lines.push("      inst->model.stringVars[i] = NULL;");
  lines.push("    }");
  lines.push("  }");
  lines.push("  return fmi3OK;");
  lines.push("}");
  lines.push("");
  lines.push("fmi3Status fmi3FreeFMUState(fmi3Instance instance, fmi3FMUState* state) {");
  lines.push("  (void)instance;");
  lines.push("  if (!state || !*state) return fmi3Error;");
  lines.push("  FMI3InstanceData* copy = (FMI3InstanceData*)(*state);");
  lines.push("  for (int i = 0; i < N_STRING_VARS; i++) {");
  lines.push("    if (copy->model.stringVars[i]) free(copy->model.stringVars[i]);");
  lines.push("  }");
  lines.push("  free(copy);");
  lines.push("  *state = NULL;");
  lines.push("  return fmi3OK;");
  lines.push("}");
  lines.push("");
  lines.push(
    "fmi3Status fmi3EnterInitializationMode(fmi3Instance instance, fmi3Boolean toleranceDefined, fmi3Float64 tolerance, fmi3Float64 startTime, fmi3Boolean stopTimeDefined, fmi3Float64 stopTime) {",
  );
  lines.push("  (void)toleranceDefined; (void)tolerance; (void)stopTimeDefined; (void)stopTime;");
  lines.push("  FMI3InstanceData* inst = (FMI3InstanceData*)instance;");
  lines.push("  inst->model.time = startTime;");
  lines.push(`  ${id}_solveAlgebraicLoops(&inst->model);`);
  lines.push("  return fmi3OK;");
  lines.push("}");
  lines.push("");
  lines.push("fmi3Status fmi3ExitInitializationMode(fmi3Instance instance) { (void)instance; return fmi3OK; }");
  lines.push("fmi3Status fmi3Terminate(fmi3Instance instance) { (void)instance; return fmi3OK; }");
  lines.push("fmi3Status fmi3Reset(fmi3Instance instance) {");
  lines.push("  FMI3InstanceData* inst = (FMI3InstanceData*)instance;");
  lines.push(`  ${id}_initialize(&inst->model);`);
  lines.push("  return fmi3OK;");
  lines.push("}");
  lines.push("");

  const numericTypes = ["Float32", "Float64", "Int8", "UInt8", "Int16", "UInt16", "Int32", "UInt32", "Int64", "UInt64"];
  for (const t of numericTypes) {
    lines.push(
      `fmi3Status fmi3Get${t}(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, fmi3${t} value[], size_t nValues) {`,
    );
    lines.push("  FMI3InstanceData* inst = (FMI3InstanceData*)instance; (void)nValues;");
    lines.push("  for (size_t i = 0; i < nvr; i++) {");
    lines.push(`    if (vr[i] < N_VARS) value[i] = (fmi3${t})inst->model.vars[vr[i]];`);
    lines.push("  }");
    lines.push("  return fmi3OK;");
    lines.push("}");
    lines.push(
      `fmi3Status fmi3Set${t}(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, const fmi3${t} value[], size_t nValues) {`,
    );
    lines.push("  FMI3InstanceData* inst = (FMI3InstanceData*)instance; (void)nValues;");
    lines.push("  for (size_t i = 0; i < nvr; i++) {");
    lines.push("    if (vr[i] < N_VARS) inst->model.vars[vr[i]] = (double)value[i];");
    lines.push("  }");
    lines.push("  return fmi3OK;");
    lines.push("}");
    lines.push("");
  }

  lines.push(
    "fmi3Status fmi3GetBoolean(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, fmi3Boolean value[], size_t nValues) {",
  );
  lines.push("  FMI3InstanceData* inst = (FMI3InstanceData*)instance; (void)nValues;");
  lines.push("  for (size_t i = 0; i < nvr; i++) {");
  lines.push("    if (vr[i] < N_VARS) value[i] = inst->model.vars[vr[i]] != 0.0;");
  lines.push("  }");
  lines.push("  return fmi3OK;");
  lines.push("}");
  lines.push(
    "fmi3Status fmi3SetBoolean(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, const fmi3Boolean value[], size_t nValues) {",
  );
  lines.push("  FMI3InstanceData* inst = (FMI3InstanceData*)instance; (void)nValues;");
  lines.push("  for (size_t i = 0; i < nvr; i++) {");
  lines.push("    if (vr[i] < N_VARS) inst->model.vars[vr[i]] = value[i] ? 1.0 : 0.0;");
  lines.push("  }");
  lines.push("  return fmi3OK;");
  lines.push("}");
  lines.push("");

  lines.push(
    "fmi3Status fmi3GetString(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, fmi3String value[], size_t nValues) {",
  );
  lines.push("  FMI3InstanceData* inst = (FMI3InstanceData*)instance; (void)nValues;");
  lines.push("  for (size_t i = 0; i < nvr; i++) {");
  lines.push(
    `    if (vr[i] < N_STRING_VARS) value[i] = inst->model.stringVars[vr[i]] ? inst->model.stringVars[vr[i]] : "";`,
  );
  lines.push("  }");
  lines.push("  return fmi3OK;");
  lines.push("}");
  lines.push(
    "fmi3Status fmi3SetString(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, const fmi3String value[], size_t nValues) {",
  );
  lines.push("  FMI3InstanceData* inst = (FMI3InstanceData*)instance; (void)nValues;");
  lines.push("  for (size_t i = 0; i < nvr; i++) {");
  lines.push("    if (vr[i] < N_STRING_VARS) {");
  lines.push("      if (inst->model.stringVars[vr[i]]) free(inst->model.stringVars[vr[i]]);");
  lines.push("      inst->model.stringVars[vr[i]] = value[i] ? strdup(value[i]) : NULL;");
  lines.push("    }");
  lines.push("  }");
  lines.push("  return fmi3OK;");
  lines.push("}");
  lines.push("");

  lines.push(
    "fmi3Status fmi3SetTime(fmi3Instance instance, fmi3Float64 time) { ((FMI3InstanceData*)instance)->model.time = time; return fmi3OK; }",
  );
  lines.push(
    "fmi3Status fmi3SetContinuousStates(fmi3Instance instance, const fmi3Float64 continuousStates[], size_t nContinuousStates) {",
  );
  lines.push("  (void)instance; (void)continuousStates; (void)nContinuousStates; return fmi3OK;");
  lines.push("}");
  lines.push(
    "fmi3Status fmi3GetContinuousStateDerivatives(fmi3Instance instance, fmi3Float64 derivatives[], size_t nContinuousStates) {",
  );
  lines.push("  (void)instance; (void)derivatives; (void)nContinuousStates; return fmi3OK;");
  lines.push("}");
  lines.push(
    "fmi3Status fmi3GetContinuousStates(fmi3Instance instance, fmi3Float64 continuousStates[], size_t nContinuousStates) {",
  );
  lines.push("  (void)instance; (void)continuousStates; (void)nContinuousStates; return fmi3OK;");
  lines.push("}");
  lines.push(
    "fmi3Status fmi3GetEventIndicators(fmi3Instance instance, fmi3Float64 eventIndicators[], size_t nEventIndicators) {",
  );
  lines.push("  (void)instance; (void)eventIndicators; (void)nEventIndicators; return fmi3OK;");
  lines.push("}");
  lines.push("");
  lines.push(
    "fmi3Status fmi3DoStep(fmi3Instance instance, fmi3Float64 currentCommunicationPoint, fmi3Float64 communicationStepSize, fmi3Boolean noSetFMUStatePriorToCurrentPoint,",
  );
  lines.push(
    "    fmi3Boolean* eventHandlingNeeded, fmi3Boolean* terminateSimulation, fmi3Boolean* earlyReturn, fmi3Float64* lastSuccessfulTime) {",
  );
  lines.push("  FMU3InstanceData* inst = (FMI3InstanceData*)instance;");
  lines.push("  double t = currentCommunicationPoint, tEnd = t + communicationStepSize;");
  lines.push("  double h = 0.001;");
  lines.push("  while (t < tEnd - 1e-15) {");
  lines.push("    if (t + h > tEnd) h = tEnd - t;");
  lines.push("    /* Fixed-step FE integrator */");
  lines.push("    int n = N_STATES;");
  lines.push("    double y0[N_STATES + 1];");
  lines.push("    /* Load states */");
  lines.push("    (void)y0;");
  lines.push("    /* Evaluate derivatives */");
  lines.push(`    inst->model.time = t;`);
  lines.push(`    ${id}_getDerivatives(&inst->model);`);
  lines.push("    /* Update states */");
  lines.push("    t += h;");
  lines.push("  }");
  lines.push("  integrate_rk4((FMUInstance*)inst, currentCommunicationPoint, tEnd, communicationStepSize);");

  // FMI 3.0 zero-crossing detection in fmi3DoStep
  if (dae.eventIndicatorExprIds.length > 0) {
    lines.push("");
    lines.push("  /* Zero-crossing detection */");
    lines.push("  double z0_3[N_EVENT_INDICATORS+1], z1_3[N_EVENT_INDICATORS+1];");
    lines.push(`  /* Evaluate indicators at start (y0, t) */`);
    lines.push(`  inst->model.time = currentCommunicationPoint;`);
    lines.push(`  ${id}_getEventIndicators(&inst->model, z0_3);`);
    lines.push(`  inst->model.time = tEnd;`);
    lines.push(`  ${id}_getEventIndicators(&inst->model, z1_3);`);
    lines.push("  int crossing3 = 0;");
    lines.push("  for (int i=0; i<N_EVENT_INDICATORS; i++) {");
    lines.push("    if ((z0_3[i] > 0 && z1_3[i] <= 0) || (z0_3[i] <= 0 && z1_3[i] > 0)) { crossing3 = 1; break; }");
    lines.push("  }");
    lines.push("  if (eventHandlingNeeded) *eventHandlingNeeded = crossing3;");
    lines.push("  if (earlyReturn) *earlyReturn = crossing3;");
    lines.push("  if (lastSuccessfulTime) *lastSuccessfulTime = crossing3 ? currentCommunicationPoint : tEnd;");
  } else {
    lines.push("  if (eventHandlingNeeded) *eventHandlingNeeded = 0;");
    lines.push("  if (earlyReturn) *earlyReturn = 0;");
    lines.push("  if (lastSuccessfulTime) *lastSuccessfulTime = tEnd;");
  }

  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

function generateGetJacobianSparse(
  id: string,
  dae: ArenaDAEBuilder,
  result: FmuResult,
): { code: string[]; nnz: number } {
  const lines: string[] = [];
  lines.push(`/* Exact Sparse Analytical Jacobian (CSC) */`);
  lines.push(`void ${id}_getJacobianSparse(${id}_Instance* inst, int* colptrs, int* rowvals, double* data) {`);

  // Find states and their derivative expressions
  const states: string[] = [];
  const derEqs = new Map<string, number>();

  const derVars = result.scalarVariables.filter((sv) => sv.name.startsWith("der("));
  const derMap = new Map<string, number>();
  for (let i = 0; i < derVars.length; i++) {
    const match = derVars[i]?.name.match(/^der\((.+)\)$/);
    if (match && match[1]) {
      states.push(match[1]);
      derMap.set(match[1], i);
    }
  }

  for (let idx = 0; idx < dae.eqCount; idx++) {
    const lhs = dae.getEqLhs(idx);
    const rhs = dae.getEqRhs(idx);
    const lhsDer = extractDerName(dae, lhs);
    const rhsDer = extractDerName(dae, rhs);

    if (lhsDer && derMap.has(lhsDer)) derEqs.set(lhsDer, rhs);
    else if (rhsDer && derMap.has(rhsDer)) derEqs.set(rhsDer, lhs);
  }

  const nStates = states.length;
  const tapes: (StaticTapeBuilder | null)[] = [];
  const tapeOutputs: number[] = [];

  for (const state of states) {
    const exprId = derEqs.get(state);
    if (exprId !== undefined) {
      const tape = new StaticTapeBuilder();
      const outIdx = tape.addExpression(exprId, dae);
      tapes.push(tape);
      tapeOutputs.push(outIdx);
    } else {
      tapes.push(null);
      tapeOutputs.push(-1);
    }
  }

  // Structural sparsity
  const conDeps: Set<string>[] = [];
  for (let i = 0; i < nStates; i++) {
    const tape = tapes[i];
    const outIdx = tapeOutputs[i];
    if (!tape || outIdx === undefined || outIdx === -1) {
      conDeps.push(new Set<string>());
      continue;
    }
    const deps = tape.getDependencies(outIdx);
    const filtered = new Set<string>();
    for (const d of deps) {
      if (states.includes(d)) filtered.add(d);
    }
    conDeps.push(filtered);
  }

  // CCS sparsity pattern
  const jacRowIdx: number[] = [];
  const jacColPtr: number[] = [];
  const sparseIdxMap = new Map<string, number>();

  for (let col = 0; col < nStates; col++) {
    jacColPtr.push(jacRowIdx.length);
    const varName = states[col];
    if (!varName) continue;
    for (let row = 0; row < nStates; row++) {
      const deps = conDeps[row];
      if (deps && deps.has(varName)) {
        sparseIdxMap.set(`${row},${col}`, jacRowIdx.length);
        jacRowIdx.push(row);
      }
    }
  }
  jacColPtr.push(jacRowIdx.length);
  const nnz = jacRowIdx.length;

  if (nnz === 0) {
    lines.push(`  (void)inst; (void)colptrs; (void)rowvals; (void)data;`);
    lines.push(`}`);
    return { code: lines, nnz: 0 };
  }

  lines.push(`  static const int static_colptrs[${nStates + 1}] = {${jacColPtr.join(", ")}};`);
  lines.push(
    `  static const int static_rowvals[${Math.max(nnz, 1)}] = {${jacRowIdx.length > 0 ? jacRowIdx.join(", ") : "0"}};`,
  );
  lines.push(`  if (colptrs) {`);
  lines.push(`    for (int i = 0; i <= ${nStates}; i++) colptrs[i] = static_colptrs[i];`);
  lines.push(`  }`);
  lines.push(`  if (rowvals) {`);
  lines.push(`    for (int i = 0; i < ${nnz}; i++) rowvals[i] = static_rowvals[i];`);
  lines.push(`  }`);
  lines.push(`  if (!data) return;`);
  lines.push("");

  const varResolver = (name: string): string => {
    if (name === "time") return "inst->time";
    const sv = result.scalarVariables.find((v) => v.name === name);
    return sv ? `inst->vars[${sv.valueReference}]` : `0.0 /* ${name} */`;
  };

  for (let row = 0; row < nStates; row++) {
    const tape = tapes[row];
    const deps = conDeps[row];
    const outIdx = tapeOutputs[row];
    if (!tape || !deps || deps.size === 0 || outIdx === undefined || outIdx === -1) continue;

    lines.push(`  { /* Row ${row}: der(${states[row]}) */`);
    const fwdCode = tape.emitForwardC(varResolver);
    lines.push(...fwdCode.map((c) => "    " + c));
    const { code: revCode, gradients } = tape.emitReverseC(outIdx);
    lines.push(...revCode.map((c) => "    " + c));

    for (let col = 0; col < nStates; col++) {
      const varName = states[col];
      if (!varName || !deps.has(varName)) continue;
      const gIdx = gradients.get(varName);
      const sparseIdx = sparseIdxMap.get(`${row},${col}`);
      if (gIdx !== undefined && sparseIdx !== undefined) {
        lines.push(`    data[${sparseIdx}] = dt[${gIdx}];`);
      }
    }
    lines.push(`  }`);
  }

  lines.push(`}`);
  return { code: lines, nnz };
}
