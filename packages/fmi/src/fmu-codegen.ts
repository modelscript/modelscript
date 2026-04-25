// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMI 2.0 C source code generator.
 *
 * Transpiles a ModelicaDAE expression tree into standalone C source files
 * that implement the FMI 2.0 API for both Model Exchange and Co-Simulation.
 *
 * Generated files:
 *   - model.c    — equation evaluation, derivative computation
 *   - model.h    — variable declarations and constants
 *   - fmi2Functions.c — FMI 2.0 C API implementation
 *
 * Works in both browser and Node.js environments (pure string generation).
 */

import { ModelicaBinaryOperator, ModelicaUnaryOperator, ModelicaVariability } from "@modelscript/modelica/ast";
import type { ModelicaDAE, ModelicaExpression } from "@modelscript/symbolics";
import {
  differentiateExpr,
  ModelicaArray,
  ModelicaArrayEquation,
  ModelicaBinaryExpression,
  ModelicaBooleanLiteral,
  ModelicaFunctionCallEquation,
  ModelicaFunctionCallExpression,
  ModelicaIfElseExpression,
  ModelicaInitialStateEquation,
  ModelicaIntegerLiteral,
  ModelicaNameExpression,
  ModelicaRealLiteral,
  ModelicaSimpleEquation,
  ModelicaStringLiteral,
  ModelicaTransitionEquation,
  ModelicaUnaryExpression,
  simplifyExpr,
  StaticTapeBuilder,
} from "@modelscript/symbolics";
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

/**
 * Generate FMI 2.0 C source files from a DAE and FMU result.
 */
export function generateFmuCSources(dae: ModelicaDAE, fmuResult: FmuResult, options: FmuOptions): FmuCSourceFiles {
  const id = options.modelIdentifier;
  const vars = fmuResult.scalarVariables;
  const nStates = fmuResult.modelStructure.derivatives.length;
  const nVars = vars.length;
  const nStringVars = vars.filter((v) => v.type === "String").length;

  // ── model.h ──
  const modelH = generateModelH(id, nVars, nStates, nStringVars, dae, fmuResult);

  // ── model.c ──
  const modelC =
    generateModelC(id, dae, fmuResult) + "\n\n" + generateAlgebraicLoopSolvers(id, dae, fmuResult, options);

  // ── fmi2Functions.c ──
  const fmi2FunctionsC = generateFmi2FunctionsC(id, nVars, nStates, nStringVars, dae, fmuResult);

  // ── fmi3Functions.c ──
  const fmi3FunctionsC = generateFmi3FunctionsC(id, dae);

  const externalLibs = new Set<string>();
  for (const fn of dae.functions) {
    for (const lib of fn.externalLibraries) externalLibs.add(lib);
  }

  // ── CMakeLists.txt ──
  const cmakeLists = generateCMakeLists(id, Array.from(externalLibs));

  return { modelH, modelC, fmi2FunctionsC, fmi3FunctionsC, cmakeLists };
}

// ── Expression → C transpiler ──

/** Convert a DAE expression to a C expression string. */
/** Counter for deterministic delay buffer indexing across exprToC calls. */
let delayBufferCounter = 0;
/** Counter for deterministic spatialDistribution buffer indexing. */
let spatialDistCounter = 0;

function exprToC(expr: ModelicaExpression): string {
  if (expr instanceof ModelicaRealLiteral) {
    return formatCDouble(expr.value);
  }
  if (expr instanceof ModelicaIntegerLiteral) {
    return `${expr.value}`;
  }
  if (expr instanceof ModelicaBooleanLiteral) {
    return expr.value ? "1" : "0";
  }
  if (expr instanceof ModelicaStringLiteral) {
    return `"${escapeCString(expr.value)}"`;
  }
  if (expr instanceof ModelicaNameExpression) {
    return varToC(expr.name);
  }
  if (expr instanceof ModelicaUnaryExpression) {
    const op = expr.operator === ModelicaUnaryOperator.UNARY_MINUS ? "-" : "!";
    return `(${op}${exprToC(expr.operand)})`;
  }
  if (expr instanceof ModelicaBinaryExpression) {
    const lhs = exprToC(expr.operand1);
    const rhs = exprToC(expr.operand2);
    const op = binaryOpToC(expr.operator);
    if (op === "pow") return `pow(${lhs}, ${rhs})`;
    return `(${lhs} ${op} ${rhs})`;
  }
  if (expr instanceof ModelicaFunctionCallExpression) {
    // Special handling for delay() — generate ring-buffer interpolation lookup
    if (expr.functionName === "delay" && expr.args.length >= 2) {
      const delayExpr = exprToC(expr.args[0] as ModelicaExpression);
      const delayTime = exprToC(expr.args[1] as ModelicaExpression);
      // Use a deterministic buffer index based on expression hash
      const bufIdx = delayBufferCounter++;
      return `delay_lookup(&m->delayBuf[${bufIdx}], m->time - (${delayTime}), ${delayExpr})`;
    }
    // initial() / terminal() predicates
    if (expr.functionName === "initial") return "inst->isInitPhase";
    if (expr.functionName === "terminal") return "0";
    // assert(condition, message) — runtime assertion
    if (expr.functionName === "assert" && expr.args.length >= 2) {
      const cond = exprToC(expr.args[0] as ModelicaExpression);
      // Message is a string literal — extract it or use a default
      const msgExpr = expr.args[1];
      const msg = msgExpr instanceof ModelicaStringLiteral ? msgExpr.value.replace(/"/g, '\\"') : "Assertion failed";
      return `((${cond}) ? 0.0 : (inst->logger ? inst->logger(inst->fmuInstance, "assert", "${msg}") : (void)0, inst->terminate ? inst->terminate(inst->fmuInstance) : (void)0, 0.0))`;
    }
    // terminate(message) — signal simulation termination
    if (expr.functionName === "terminate") {
      const msg =
        expr.args[0] instanceof ModelicaStringLiteral
          ? expr.args[0].value.replace(/"/g, '\\"')
          : "Simulation terminated";
      return `(inst->logger ? inst->logger(inst->fmuInstance, "terminate", "${msg}") : (void)0, inst->terminate ? inst->terminate(inst->fmuInstance) : (void)0, 0.0)`;
    }
    // spatialDistribution(in0, in1, x, positiveVelocity) — 1D advection
    if (expr.functionName === "spatialDistribution" && expr.args.length >= 4) {
      const in0 = exprToC(expr.args[0] as ModelicaExpression);
      const in1 = exprToC(expr.args[1] as ModelicaExpression);
      const x = exprToC(expr.args[2] as ModelicaExpression);
      const posVel = exprToC(expr.args[3] as ModelicaExpression);
      const bufIdx = spatialDistCounter++;
      return `spatial_step(&m->spatialDist[${bufIdx}], ${in0}, ${in1}, ${x}, (int)(${posVel}))`;
    }
    const args = expr.args.map((a: ModelicaExpression) => exprToC(a)).join(", ");
    const fname = mapFunctionName(expr.functionName);
    return `${fname}(${args})`;
  }
  if (expr instanceof ModelicaIfElseExpression) {
    const cond = exprToC(expr.condition);
    const then = exprToC(expr.thenExpression);
    const els = exprToC(expr.elseExpression);
    // Handle elseif chains
    if (expr.elseIfClauses.length > 0) {
      let result = `(${cond} ? ${then} : `;
      for (const clause of expr.elseIfClauses) {
        result += `${exprToC(clause.condition)} ? ${exprToC(clause.expression)} : `;
      }
      result += `${els})`;
      return result;
    }
    return `(${cond} ? ${then} : ${els})`;
  }
  // Fallback: try reading name from generic expression
  if (expr && typeof expr === "object" && "name" in expr) {
    return varToC((expr as { name: string }).name);
  }
  return "0.0 /* unknown expression */";
}

/** Map a Modelica variable name to a C-safe identifier. */
function varToC(name: string): string {
  if (name === "time") return "time";
  // der(x) → der_x
  const derMatch = name.match(/^der\((.+)\)$/);
  if (derMatch) {
    return `der_${sanitizeIdentifier(derMatch[1] ?? "")}`;
  }
  return `v_${sanitizeIdentifier(name)}`;
}

/**
 * Convert a when-equation condition to a C zero-crossing expression.
 * For relational operators (x < threshold), returns `(LHS) - (RHS)`.
 * For boolean conditions, returns the expression directly (non-zero = active).
 */
function conditionToZeroCrossingC(condition: ModelicaExpression): string {
  if (condition instanceof ModelicaBinaryExpression) {
    const op = condition.operator;
    if (
      op === ModelicaBinaryOperator.LESS_THAN ||
      op === ModelicaBinaryOperator.LESS_THAN_OR_EQUAL ||
      op === ModelicaBinaryOperator.GREATER_THAN ||
      op === ModelicaBinaryOperator.GREATER_THAN_OR_EQUAL
    ) {
      return `(${exprToC(condition.operand1)}) - (${exprToC(condition.operand2)})`;
    }
  }
  // Fallback: treat as boolean condition (1.0 if true, -1.0 if false)
  return `(${exprToC(condition)} ? 1.0 : -1.0)`;
}

/**
 * Extract time-event threshold from a when-condition.
 * Detects patterns like `time >= T` or `time > T` where T is a constant or expression.
 * Returns the C expression for the threshold, or null if the condition is not a time-event.
 */
function extractTimeEventThresholdC(condition: ModelicaExpression): string | null {
  if (!(condition instanceof ModelicaBinaryExpression)) return null;
  const op = condition.operator;
  // Pattern: time >= T  or  time > T
  if (
    (op === ModelicaBinaryOperator.GREATER_THAN_OR_EQUAL || op === ModelicaBinaryOperator.GREATER_THAN) &&
    condition.operand1 instanceof ModelicaNameExpression &&
    condition.operand1.name === "time"
  ) {
    return exprToC(condition.operand2);
  }
  // Pattern: T <= time  or  T < time
  if (
    (op === ModelicaBinaryOperator.LESS_THAN_OR_EQUAL || op === ModelicaBinaryOperator.LESS_THAN) &&
    condition.operand2 instanceof ModelicaNameExpression &&
    condition.operand2.name === "time"
  ) {
    return exprToC(condition.operand1);
  }
  return null;
}

/**
 * Extract the assignment target variable name from the LHS of a simple equation.
 */
function extractAssignmentTarget(expr: ModelicaExpression): string | null {
  if (expr instanceof ModelicaNameExpression) return expr.name;
  if (expr && typeof expr === "object" && "name" in expr) {
    return (expr as { name: string }).name;
  }
  return null;
}

// ── File generators ──

function generateModelH(
  id: string,
  nVars: number,
  nStates: number,
  nStringVars: number,
  dae: ModelicaDAE,
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
  const nWhenConditions = dae.whenClauses.reduce((acc, weq) => acc + 1 + weq.elseWhenClauses.length, 0);
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
      lines.push(`  void* extObj_${ei};  /* ${dae.externalObjects[ei]?.typeName ?? "unknown"} */`);
    }
  }

  // Count delay() calls in DAE for delay buffer allocation
  let nDelayBuffers = 0;
  const countDelays = (expr: ModelicaExpression): void => {
    if (expr instanceof ModelicaFunctionCallExpression && expr.functionName === "delay") {
      nDelayBuffers++;
      return;
    }
    if (expr instanceof ModelicaFunctionCallExpression) {
      for (const arg of expr.args) countDelays(arg);
    }
    if ("expression1" in expr && expr.expression1) countDelays(expr.expression1 as ModelicaExpression);
    if ("expression2" in expr && expr.expression2) countDelays(expr.expression2 as ModelicaExpression);
  };
  for (const eq of dae.equations) {
    if (eq instanceof ModelicaSimpleEquation) {
      countDelays(eq.expression1);
      countDelays(eq.expression2);
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
  lines.push("");
  lines.push("#endif");
  return lines.join("\n");
}

function generateAlgebraicLoopSolvers(id: string, dae: ModelicaDAE, result: FmuResult, options: FmuOptions): string {
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
  if (!dae.algebraicLoops || dae.algebraicLoops.length === 0) {
    lines.push("  (void)inst;");
    lines.push("}");
    return lines.join("\n");
  }
  lines.push("  double J[256];");
  lines.push("  double F[16];");
  lines.push("  double dx[16];");

  for (let loopIdx = 0; loopIdx < dae.algebraicLoops.length; loopIdx++) {
    const loop = dae.algebraicLoops[loopIdx];
    if (!loop) continue;
    const N = loop.variables.length;
    if (N > 16) continue;

    // Determine all referenced aliases
    const referencedNames = new Set<string>();
    for (const eq of loop.equations) {
      if ("expression1" in eq && "expression2" in eq) {
        const simpleEq = eq as { expression1: ModelicaExpression; expression2: ModelicaExpression };
        collectReferencedNames(simpleEq.expression1, referencedNames);
        collectReferencedNames(simpleEq.expression2, referencedNames);
      }
    }

    // Build AD tapes for each residual equation: residual_i = expr1_i - expr2_i
    const tapes: StaticTapeBuilder[] = [];
    const residualOutputIndices: number[] = [];
    for (const eq of loop.equations) {
      const tape = new StaticTapeBuilder();
      if (eq && "expression1" in eq && "expression2" in eq) {
        const simpleEq = eq as { expression1: ModelicaExpression; expression2: ModelicaExpression };
        const lhsIdx = tape.walk(simpleEq.expression1);
        const rhsIdx = tape.walk(simpleEq.expression2);
        residualOutputIndices.push(tape.pushOp({ type: "sub", a: lhsIdx, b: rhsIdx }));
      } else {
        residualOutputIndices.push(tape.pushOp({ type: "const", val: 0 }));
      }
      tapes.push(tape);
    }

    // Build variable name -> inst->vars[VR] resolver
    const varResolver = (name: string): string => {
      if (name === "time") return "inst->time";
      const sv = result.scalarVariables.find((v) => v.name === name);
      return sv ? `inst->vars[${sv.valueReference}]` : `0.0 /* ${name} */`;
    };

    lines.push(`  /* Algebraic Loop ${loopIdx} (${N} variables, exact AD Jacobian) */`);
    lines.push(`  {`);
    lines.push(`    int iter;`);
    lines.push(`    for (iter = 0; iter < 100; iter++) {`);

    // Evaluate residuals using the first tape's forward pass approach
    // (we emit inline C for each residual)
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
  }
  lines.push("}");
  return lines.join("\n");
}

/**
 * Generate _initializeSolve() — Newton-Raphson solver for initial equations
 * using exact AD Jacobians from StaticTapeBuilder.
 */
function generateInitializeSolve(id: string, dae: ModelicaDAE, result: FmuResult): string[] {
  const lines: string[] = [];

  if (dae.initialEquations.length === 0) {
    lines.push(`void ${id}_initializeSolve(${id}_Instance* inst) { (void)inst; }`);
    return lines;
  }

  // Collect initial equations — unroll array equations into per-element scalar equations
  const initEqs: { lhs: ModelicaExpression; rhs: ModelicaExpression }[] = [];
  for (const eq of dae.initialEquations) {
    if ("expression1" in eq && "expression2" in eq) {
      const se = eq as { expression1: ModelicaExpression; expression2: ModelicaExpression };
      if (eq instanceof ModelicaArrayEquation) {
        // Unroll array equation into per-element scalar equations
        const lhsElems = se.expression1 instanceof ModelicaArray ? [...se.expression1.flatElements] : [se.expression1];
        const rhsElems = se.expression2 instanceof ModelicaArray ? [...se.expression2.flatElements] : [se.expression2];
        const n = Math.max(lhsElems.length, rhsElems.length);
        for (let i = 0; i < n; i++) {
          const lhs = lhsElems[i] ?? lhsElems[0];
          const rhs = rhsElems[i] ?? rhsElems[0];
          if (lhs && rhs) initEqs.push({ lhs, rhs });
        }
      } else {
        initEqs.push({ lhs: se.expression1, rhs: se.expression2 });
      }
    }
  }

  if (initEqs.length === 0) {
    lines.push(`void ${id}_initializeSolve(${id}_Instance* inst) { (void)inst; }`);
    return lines;
  }

  const N = initEqs.length;

  // Identify unknowns: variables referenced in initial equations that are not parameters
  const paramNames = new Set<string>();
  for (const v of dae.variables) {
    if (v.variability === ModelicaVariability.PARAMETER || v.variability === ModelicaVariability.CONSTANT) {
      paramNames.add(v.name);
    }
  }

  const referencedNames = new Set<string>();
  for (const eq of initEqs) {
    collectReferencedNames(eq.lhs, referencedNames);
    collectReferencedNames(eq.rhs, referencedNames);
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
    const lhsIdx = tape.walk(eq.lhs);
    const rhsIdx = tape.walk(eq.rhs);
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

function generateModelC(id: string, dae: ModelicaDAE, result: FmuResult): string {
  // Reset buffer counters for this codegen invocation
  delayBufferCounter = 0;
  spatialDistCounter = 0;

  const lines: string[] = [];
  lines.push("/* Auto-generated by ModelScript — do not edit */");
  lines.push(`#include "${id}_model.h"`);
  lines.push("#include <stdio.h>");

  const externalIncludes = new Set<string>();
  for (const fn of dae.functions) {
    for (const inc of fn.externalIncludes) externalIncludes.add(inc);
  }
  for (const inc of externalIncludes) {
    if (inc.trim().startsWith("#")) {
      lines.push(inc);
    } else {
      // Sometimes just a header file name is given
      lines.push(inc.includes(";") || inc.includes("int ") || inc.includes("void ") ? inc : `#include "${inc}"`);
    }
  }
  lines.push("");

  // Count delay() calls to determine if delay helpers are needed
  let hasDelays = false;
  const checkDelays = (expr: ModelicaExpression): void => {
    if (expr instanceof ModelicaFunctionCallExpression && expr.functionName === "delay") {
      hasDelays = true;
      return;
    }
    if (expr instanceof ModelicaFunctionCallExpression) {
      for (const arg of expr.args) checkDelays(arg);
    }
    if ("expression1" in expr && expr.expression1) checkDelays(expr.expression1 as ModelicaExpression);
    if ("expression2" in expr && expr.expression2) checkDelays(expr.expression2 as ModelicaExpression);
  };
  for (const eq of dae.equations) {
    if (eq instanceof ModelicaSimpleEquation) {
      checkDelays(eq.expression1);
      checkDelays(eq.expression2);
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
    lines.push("  /* tLookup is after all recorded times — return latest */");
    lines.push("  int last = (buf->head - 1 + DELAY_BUF_SIZE) % DELAY_BUF_SIZE;");
    lines.push("  return buf->values[last];");
    lines.push("}");
    lines.push("");
  }

  // ── spatialDistribution() C helpers ──
  lines.push("/* --- spatialDistribution() 1D advection helpers --- */");
  lines.push("#define SPATIAL_BUF_SIZE 256");
  lines.push("typedef struct {");
  lines.push("  double positions[SPATIAL_BUF_SIZE];");
  lines.push("  double values[SPATIAL_BUF_SIZE];");
  lines.push("  int count;");
  lines.push("  double prevX;  /* previous position for delta computation */");
  lines.push("} SpatialDist;");
  lines.push("");
  lines.push("static inline double spatial_step(SpatialDist* sd, double in0, double in1, double x, int posVel) {");
  lines.push("  double dx = x - sd->prevX;");
  lines.push("  sd->prevX = x;");
  lines.push("  /* Advect all sample points by dx */");
  lines.push("  for (int i = 0; i < sd->count; i++) sd->positions[i] += (posVel ? dx : -dx);");
  lines.push("  /* Insert boundary values */");
  lines.push("  if (posVel && sd->count < SPATIAL_BUF_SIZE) {");
  lines.push("    sd->positions[sd->count] = 0.0; sd->values[sd->count] = in0; sd->count++;");
  lines.push("  } else if (!posVel && sd->count < SPATIAL_BUF_SIZE) {");
  lines.push("    sd->positions[sd->count] = 1.0; sd->values[sd->count] = in1; sd->count++;");
  lines.push("  }");
  lines.push("  /* Look up output value at boundary 1 (posVel) or 0 (!posVel) */");
  lines.push("  double target = posVel ? 1.0 : 0.0;");
  lines.push("  double result = posVel ? in1 : in0;  /* default */");
  lines.push("  double bestDist = 1e30;");
  lines.push("  for (int i = 0; i < sd->count; i++) {");
  lines.push("    double d = fabs(sd->positions[i] - target);");
  lines.push("    if (d < bestDist) { bestDist = d; result = sd->values[i]; }");
  lines.push("  }");
  lines.push("  return result;");
  lines.push("}");
  lines.push("");

  // Build value-reference → C accessor mappings
  const vrMap = new Map<string, number>();
  for (const sv of result.scalarVariables) {
    vrMap.set(sv.name, sv.valueReference);
  }

  // ── Initialize function ──
  lines.push(`void ${id}_initialize(${id}_Instance* inst) {`);
  lines.push("  memset(inst, 0, sizeof(*inst));");
  for (const v of dae.variables) {
    if (v.variability === ModelicaVariability.PARAMETER || v.variability === ModelicaVariability.CONSTANT) {
      const ref = vrMap.get(v.name);
      if (ref !== undefined && v.expression) {
        // For initialization, we use the literal value if available
        const cExpr = exprToC(v.expression);
        lines.push(`  inst->vars[${ref}] = ${cExpr};  /* ${v.name} */`);
      }
    }
  }
  // Set start values for continuous variables (from start attribute or binding)
  for (const v of dae.variables) {
    if (v.variability === null || v.variability === undefined) {
      const ref = vrMap.get(v.name);
      if (ref !== undefined) {
        // Prefer the 'start' attribute over the binding expression
        const startAttr = v.attributes.get("start");
        const initExpr = startAttr ?? v.expression;
        if (initExpr) {
          const cExpr = exprToC(initExpr);
          lines.push(`  inst->vars[${ref}] = ${cExpr};  /* ${v.name} */`);
        }
      }
    }
  }
  // Call the initial equation solver (generated below) after start values
  if (dae.initialEquations.length > 0) {
    lines.push(`  ${id}_initializeSolve(inst);`);
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
  for (const eq of dae.equations) {
    if (!("expression1" in eq && "expression2" in eq)) continue;
    const simpleEq = eq as { expression1: ModelicaExpression; expression2: ModelicaExpression };
    collectReferencedNames(simpleEq.expression1, referencedNames);
    collectReferencedNames(simpleEq.expression2, referencedNames);
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
  // Map derivative names to their index in the state vector based on scalarVariables order
  const derVars = result.scalarVariables.filter((sv) => sv.name.startsWith("der("));
  const derMap = new Map<string, number>();
  for (let i = 0; i < derVars.length; i++) {
    const nameMatch = derVars[i]?.name.match(/^der\((.+)\)$/);
    if (nameMatch) derMap.set(nameMatch[1] ?? "", i);
  }

  // Walk DAE equations looking for der(x) = expr patterns
  for (const eq of dae.equations) {
    if (!("expression1" in eq && "expression2" in eq)) continue;
    const simpleEq = eq as { expression1: ModelicaExpression; expression2: ModelicaExpression };
    const lhsDer = extractDerName(simpleEq.expression1);
    const rhsDer = extractDerName(simpleEq.expression2);

    if (lhsDer) {
      const idx = derMap.get(lhsDer);
      if (idx !== undefined) {
        lines.push(`  inst->derivatives[${idx}] = ${exprToC(simpleEq.expression2)};  /* der(${lhsDer}) */`);
      }
    } else if (rhsDer) {
      const idx = derMap.get(rhsDer);
      if (idx !== undefined) {
        lines.push(`  inst->derivatives[${idx}] = ${exprToC(simpleEq.expression1)};  /* der(${rhsDer}) */`);
      }
    }
  }
  if (hasDelays) {
    // Record current values of delay() expressions into ring buffers
    lines.push("");
    lines.push("  /* Record delay buffer entries */");
    let delayIdx = 0;
    const collectDelayExprs = (expr: ModelicaExpression, records: string[]): void => {
      if (expr instanceof ModelicaFunctionCallExpression && expr.functionName === "delay" && expr.args.length >= 2) {
        const delayExprC = exprToC(expr.args[0] as ModelicaExpression);
        records.push(`  delay_record(&inst->delayBuf[${delayIdx}], inst->time, ${delayExprC});`);
        delayIdx++;
        return;
      }
      if (expr instanceof ModelicaFunctionCallExpression) {
        for (const arg of expr.args) collectDelayExprs(arg, records);
      }
      if ("expression1" in expr && expr.expression1) collectDelayExprs(expr.expression1 as ModelicaExpression, records);
      if ("expression2" in expr && expr.expression2) collectDelayExprs(expr.expression2 as ModelicaExpression, records);
    };
    const recordLines: string[] = [];
    for (const eq of dae.equations) {
      if (eq instanceof ModelicaSimpleEquation) {
        collectDelayExprs(eq.expression1, recordLines);
        collectDelayExprs(eq.expression2, recordLines);
      }
    }
    for (const rl of recordLines) {
      lines.push(rl);
    }
  }

  lines.push("}");
  lines.push("");

  // ── getEventIndicators function ──
  lines.push(`void ${id}_getEventIndicators(${id}_Instance* inst, double* indicators) {`);

  if (dae.eventIndicators.length === 0) {
    lines.push("  (void)inst; (void)indicators;");
  } else {
    // Emit local variable aliases for referenced names
    const eventReferencedNames = new Set<string>();
    for (const indicator of dae.eventIndicators) {
      collectReferencedNames(indicator, eventReferencedNames);
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
    for (const indicator of dae.eventIndicators) {
      const zc = exprToC(indicator); // flattener ensures these are already 0-crossings (e.g., a - b)
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
  dae: ModelicaDAE,
  result: FmuResult,
): string {
  // Extract when-equations for event handling
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
    lines.push(`  void* extObj_${ei}; /* ${eo.typeName}: ${eo.variableName} */`);
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
      lines.push(`  inst->model.extObj_${ei} = (void*)${ctorName}();  /* ${eo.typeName} */`);
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
  lines.push("fmi2Status fmi2ExitInitializationMode(fmi2Component c) {");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  inst->model.isInitPhase = 0;");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");

  // ── fmi2SetReal / fmi2GetReal ──
  lines.push(
    "fmi2Status fmi2SetReal(fmi2Component c, const fmi2ValueReference vr[], size_t nvr, const fmi2Real value[]) {",
  );
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push(`  for (size_t i = 0; i < nvr; i++) {`);
  lines.push(`    if (vr[i] < N_VARS) inst->model.vars[vr[i]] = value[i];`);
  lines.push("  }");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");
  lines.push("fmi2Status fmi2GetReal(fmi2Component c, const fmi2ValueReference vr[], size_t nvr, fmi2Real value[]) {");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push(`  for (size_t i = 0; i < nvr; i++) {`);
  lines.push(`    if (vr[i] < N_VARS) value[i] = inst->model.vars[vr[i]];`);
  lines.push("  }");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");

  // ── fmi2SetInteger / fmi2GetInteger ──
  lines.push(
    "fmi2Status fmi2SetInteger(fmi2Component c, const fmi2ValueReference vr[], size_t nvr, const fmi2Integer value[]) {",
  );
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  for (size_t i = 0; i < nvr; i++) { if (vr[i] < N_VARS) inst->model.vars[vr[i]] = (double)value[i]; }");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push(
    "fmi2Status fmi2GetInteger(fmi2Component c, const fmi2ValueReference vr[], size_t nvr, fmi2Integer value[]) {",
  );
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push(
    "  for (size_t i = 0; i < nvr; i++) { if (vr[i] < N_VARS) value[i] = (fmi2Integer)inst->model.vars[vr[i]]; }",
  );
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");

  // ── fmi2SetBoolean / fmi2GetBoolean ──
  lines.push(
    "fmi2Status fmi2SetBoolean(fmi2Component c, const fmi2ValueReference vr[], size_t nvr, const fmi2Boolean value[]) {",
  );
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push(
    "  for (size_t i = 0; i < nvr; i++) { if (vr[i] < N_VARS) inst->model.vars[vr[i]] = value[i] ? 1.0 : 0.0; }",
  );
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push(
    "fmi2Status fmi2GetBoolean(fmi2Component c, const fmi2ValueReference vr[], size_t nvr, fmi2Boolean value[]) {",
  );
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  for (size_t i = 0; i < nvr; i++) { if (vr[i] < N_VARS) value[i] = inst->model.vars[vr[i]] != 0.0; }");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");

  // ── Model Exchange: fmi2SetTime / fmi2SetContinuousStates / fmi2GetDerivatives ──
  lines.push("/* --- Model Exchange --- */");
  lines.push("fmi2Status fmi2SetTime(fmi2Component c, fmi2Real time) {");
  lines.push("  ((FMUInstance*)c)->model.time = time; return fmi2OK;");
  lines.push("}");
  lines.push("");
  lines.push("fmi2Status fmi2SetContinuousStates(fmi2Component c, const fmi2Real x[], size_t nx) {");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  (void)inst; (void)x; (void)nx;");
  // Map state indices to value references
  const stateVRs = result.scalarVariables
    .filter((sv) =>
      result.modelStructure.derivatives.some(
        (dRef) => result.scalarVariables.find((d) => d.valueReference === dRef)?.derivative === sv.valueReference,
      ),
    )
    .map((sv) => sv.valueReference);

  if (stateVRs.length > 0) {
    // Use the derivative linkage to find state variable refs
    const derVars = result.scalarVariables.filter((sv) => sv.name.startsWith("der("));
    const stateRefs: number[] = [];
    for (const dv of derVars) {
      if (dv.derivative !== undefined) stateRefs.push(dv.derivative);
    }
    for (let i = 0; i < stateRefs.length; i++) {
      lines.push(`  if (${i} < (int)nx) inst->model.vars[${stateRefs[i]}] = x[${i}];`);
    }
  }
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");
  lines.push("fmi2Status fmi2GetDerivatives(fmi2Component c, fmi2Real derivatives[], size_t nx) {");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push(`  ${id}_getDerivatives(&inst->model);`);
  lines.push("  for (size_t i = 0; i < nx && i < (size_t)N_STATES; i++) derivatives[i] = inst->model.derivatives[i];");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");
  lines.push("fmi2Status fmi2GetContinuousStates(fmi2Component c, fmi2Real x[], size_t nx) {");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  (void)inst; (void)x; (void)nx;");

  const derVars2 = result.scalarVariables.filter((sv) => sv.name.startsWith("der("));
  const stateRefs2: number[] = [];
  for (const dv of derVars2) {
    if (dv.derivative !== undefined) stateRefs2.push(dv.derivative);
  }
  for (let i = 0; i < stateRefs2.length; i++) {
    lines.push(`  if (${i} < (int)nx) x[${i}] = inst->model.vars[${stateRefs2[i]}];`);
  }
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");
  lines.push("fmi2Status fmi2GetEventIndicators(fmi2Component c, fmi2Real indicators[], size_t ni) {");
  lines.push(`  ${id}_getEventIndicators(&((FMUInstance*)c)->model, indicators);`);
  lines.push("  (void)ni; return fmi2OK;");
  lines.push("}");
  lines.push("");
  lines.push("fmi2Status fmi2CompletedIntegratorStep(fmi2Component c, fmi2Boolean noSetFMUStatePriorToCurrentPoint,");
  lines.push("    fmi2Boolean* enterEventMode, fmi2Boolean* terminateSimulation) {");
  lines.push("  (void)c; (void)noSetFMUStatePriorToCurrentPoint;");
  lines.push("  *enterEventMode = fmi2False; *terminateSimulation = fmi2False;");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");

  // ── RK4 helper function ──
  lines.push(
    `static void take_rk4_step(${id}_Instance* m, double t, double h, const double* states0, double* statesOut) {`,
  );
  lines.push("  double k1[N_STATES + 1], k2[N_STATES + 1], k3[N_STATES + 1], k4[N_STATES + 1];");
  lines.push("  (void)k1; (void)k2; (void)k3; (void)k4; (void)states0; (void)statesOut; (void)h;");
  lines.push(`  m->time = t; ${id}_getDerivatives(m);`);
  lines.push("  for (int i = 0; i < N_STATES; i++) k1[i] = m->derivatives[i];");
  lines.push("  m->time = t + 0.5 * h;");
  for (let i = 0; i < stateRefs2.length; i++) {
    lines.push(`  m->vars[${stateRefs2[i]}] = states0[${i}] + 0.5 * h * k1[${i}];`);
  }
  lines.push(`  ${id}_getDerivatives(m);`);
  lines.push("  for (int i = 0; i < N_STATES; i++) k2[i] = m->derivatives[i];");
  for (let i = 0; i < stateRefs2.length; i++) {
    lines.push(`  m->vars[${stateRefs2[i]}] = states0[${i}] + 0.5 * h * k2[${i}];`);
  }
  lines.push(`  ${id}_getDerivatives(m);`);
  lines.push("  for (int i = 0; i < N_STATES; i++) k3[i] = m->derivatives[i];");
  lines.push("  m->time = t + h;");
  for (let i = 0; i < stateRefs2.length; i++) {
    lines.push(`  m->vars[${stateRefs2[i]}] = states0[${i}] + h * k3[${i}];`);
  }
  lines.push(`  ${id}_getDerivatives(m);`);
  lines.push("  for (int i = 0; i < N_STATES; i++) k4[i] = m->derivatives[i];");
  for (let i = 0; i < stateRefs2.length; i++) {
    lines.push(`  statesOut[${i}] = states0[${i}] + (h / 6.0) * (k1[${i}] + 2.0*k2[${i}] + 2.0*k3[${i}] + k4[${i}]);`);
  }
  lines.push("}");
  lines.push("");

  // ── DOPRI5 helper function (Dormand-Prince 4(5) with error estimate) ──
  lines.push(
    `static double take_dopri5_step(${id}_Instance* m, double t, double h, const double* s0, double* s4, double* s5) {`,
  );
  lines.push("  /* Dormand-Prince coefficients */");
  lines.push("  double k1[N_STATES+1], k2[N_STATES+1], k3[N_STATES+1], k4[N_STATES+1];");
  lines.push("  double k5[N_STATES+1], k6[N_STATES+1], k7[N_STATES+1];");
  lines.push(
    "  (void)k1; (void)k2; (void)k3; (void)k4; (void)k5; (void)k6; (void)k7; (void)s0; (void)s4; (void)s5; (void)h;",
  );
  lines.push(`  m->time = t; ${id}_getDerivatives(m);`);
  lines.push("  for (int i = 0; i < N_STATES; i++) k1[i] = m->derivatives[i];");
  // k2: t + 1/5 h
  lines.push("  m->time = t + h/5.0;");
  for (let i = 0; i < stateRefs2.length; i++) {
    lines.push(`  m->vars[${stateRefs2[i]}] = s0[${i}] + h*(1.0/5)*k1[${i}];`);
  }
  lines.push(`  ${id}_getDerivatives(m);`);
  lines.push("  for (int i = 0; i < N_STATES; i++) k2[i] = m->derivatives[i];");
  // k3: t + 3/10 h
  lines.push("  m->time = t + 3.0*h/10.0;");
  for (let i = 0; i < stateRefs2.length; i++) {
    lines.push(`  m->vars[${stateRefs2[i]}] = s0[${i}] + h*(3.0/40*k1[${i}] + 9.0/40*k2[${i}]);`);
  }
  lines.push(`  ${id}_getDerivatives(m);`);
  lines.push("  for (int i = 0; i < N_STATES; i++) k3[i] = m->derivatives[i];");
  // k4: t + 4/5 h
  lines.push("  m->time = t + 4.0*h/5.0;");
  for (let i = 0; i < stateRefs2.length; i++) {
    lines.push(`  m->vars[${stateRefs2[i]}] = s0[${i}] + h*(44.0/45*k1[${i}] - 56.0/15*k2[${i}] + 32.0/9*k3[${i}]);`);
  }
  lines.push(`  ${id}_getDerivatives(m);`);
  lines.push("  for (int i = 0; i < N_STATES; i++) k4[i] = m->derivatives[i];");
  // k5: t + 8/9 h
  lines.push("  m->time = t + 8.0*h/9.0;");
  for (let i = 0; i < stateRefs2.length; i++) {
    lines.push(
      `  m->vars[${stateRefs2[i]}] = s0[${i}] + h*(19372.0/6561*k1[${i}] - 25360.0/2187*k2[${i}] + 64448.0/6561*k3[${i}] - 212.0/729*k4[${i}]);`,
    );
  }
  lines.push(`  ${id}_getDerivatives(m);`);
  lines.push("  for (int i = 0; i < N_STATES; i++) k5[i] = m->derivatives[i];");
  // k6: t + h
  lines.push("  m->time = t + h;");
  for (let i = 0; i < stateRefs2.length; i++) {
    lines.push(
      `  m->vars[${stateRefs2[i]}] = s0[${i}] + h*(9017.0/3168*k1[${i}] - 355.0/33*k2[${i}] + 46732.0/5247*k3[${i}] + 49.0/176*k4[${i}] - 5103.0/18656*k5[${i}]);`,
    );
  }
  lines.push(`  ${id}_getDerivatives(m);`);
  lines.push("  for (int i = 0; i < N_STATES; i++) k6[i] = m->derivatives[i];");
  // 5th-order solution
  lines.push("  for (int i = 0; i < N_STATES; i++) {");
  lines.push(
    "    s5[i] = s0[i] + h*(35.0/384*k1[i] + 500.0/1113*k3[i] + 125.0/192*k4[i] - 2187.0/6784*k5[i] + 11.0/84*k6[i]);",
  );
  lines.push("  }");
  // k7: FSAL at new point
  for (let i = 0; i < stateRefs2.length; i++) {
    lines.push(`  m->vars[${stateRefs2[i]}] = s5[${i}];`);
  }
  lines.push(`  ${id}_getDerivatives(m);`);
  lines.push("  for (int i = 0; i < N_STATES; i++) k7[i] = m->derivatives[i];");
  // 4th-order solution (for error estimation)
  lines.push("  for (int i = 0; i < N_STATES; i++) {");
  lines.push(
    "    s4[i] = s0[i] + h*(5179.0/57600*k1[i] + 7571.0/16695*k3[i] + 393.0/640*k4[i] - 92097.0/339200*k5[i] + 187.0/2100*k6[i] + 1.0/40*k7[i]);",
  );
  lines.push("  }");
  // Error estimate: max |s5 - s4| / (atol + rtol * |s5|)
  lines.push("  double maxErr = 0.0;");
  lines.push("  for (int i = 0; i < N_STATES; i++) {");
  lines.push("    double sc = 1e-6 + 1e-3 * fabs(s5[i]);");
  lines.push("    double ei = fabs(s5[i] - s4[i]) / sc;");
  lines.push("    if (ei > maxErr) maxErr = ei;");
  lines.push("  }");
  lines.push("  return maxErr;");
  lines.push("}");
  lines.push("");

  // ── Static worker function for async co-simulation ──
  lines.push("/* --- Async Co-Simulation worker --- */");
  lines.push("static void doStep_sync(FMUInstance* inst) {");
  lines.push("  double t = inst->asyncCurrentT;");
  lines.push("  double tEnd = inst->asyncTEnd;");
  lines.push("  double h = inst->stepSize;");
  lines.push("  if (h <= 0) h = 0.001;");
  lines.push("  (void)t; (void)tEnd;");
  lines.push("");

  // Emit state machine transition evaluation at each step
  if (dae.stateMachines.length > 0) {
    lines.push("  /* --- State machine transitions --- */");
    for (let si = 0; si < dae.stateMachines.length; si++) {
      const sm = dae.stateMachines[si];
      if (!sm) continue;
      const stateNames = sm.states.map((s) => s.name);
      const transitions = sm.equations.filter(
        (eq): eq is ModelicaTransitionEquation => eq instanceof ModelicaTransitionEquation,
      );
      transitions.sort((a, b) => a.priority - b.priority);

      // Find initial state
      const initialStateEq = sm.equations.find(
        (eq): eq is ModelicaInitialStateEquation => eq instanceof ModelicaInitialStateEquation,
      );
      const initialIdx = initialStateEq ? stateNames.indexOf(initialStateEq.stateName) : 0;

      if (transitions.length > 0) {
        lines.push(`  /* SM ${si}: ${sm.name} (initial state: ${stateNames[initialIdx] ?? "?"}) */`);
        lines.push(`  {`);
        lines.push(`    int prevState_${si} = inst->activeState_${si};`);

        for (const tr of transitions) {
          const fromIdx = stateNames.indexOf(tr.fromState);
          const toIdx = stateNames.indexOf(tr.toState);
          if (fromIdx < 0 || toIdx < 0) continue;
          const condC = exprToC(tr.condition);
          if (tr.immediate) {
            // Immediate transition: fires in the same step the condition becomes true
            lines.push(
              `    if (inst->activeState_${si} == ${fromIdx} && (${condC})) { /* ${tr.fromState} -> ${tr.toState} */`,
            );
          } else {
            // Delayed transition: fires at the next step after the condition becomes true
            lines.push(
              `    if (prevState_${si} == ${fromIdx} && (${condC})) { /* ${tr.fromState} -> ${tr.toState} (delayed) */`,
            );
          }
          lines.push(`      inst->activeState_${si} = ${toIdx};`);

          // Reset semantics: re-initialize target state's variables to start values
          if (tr.reset) {
            const targetState = sm.states[toIdx];
            if (targetState) {
              for (const v of targetState.variables) {
                const sv = result.scalarVariables.find((s) => s.name === v.name);
                if (sv) {
                  const startAttr = v.attributes.get("start");
                  const startExpr = startAttr ?? v.expression;
                  if (startExpr) {
                    lines.push(
                      `      inst->model.vars[${sv.valueReference}] = ${exprToC(startExpr)};  /* reset ${v.name} */`,
                    );
                  }
                }
              }
            }
          }

          lines.push("    }");
        }
        lines.push("  }");
      }
    }
    lines.push("");
  }

  lines.push("  double states0[N_STATES + 1];");
  lines.push("  double states1[N_STATES + 1];");
  if (dae.eventIndicators.length > 0) {
    lines.push("  double z0[N_EVENT_INDICATORS + 1];");
    lines.push("  double z1[N_EVENT_INDICATORS + 1];");
  }
  lines.push("  int eventCount = 0;");
  lines.push("  (void)eventCount;");

  lines.push("  while (t < tEnd - 1e-15 && !inst->cancelRequested) {");
  lines.push("    double step_h = h;");
  lines.push("    if (t + step_h > tEnd) step_h = tEnd - t;");
  lines.push("");
  // Check for scheduled time events and clamp step size
  lines.push("    if (inst->nextEventTimeDefined && inst->nextEventTime > t && inst->nextEventTime < t + step_h) {");
  lines.push("      step_h = inst->nextEventTime - t;");
  lines.push("    }");
  lines.push("");

  for (let i = 0; i < stateRefs2.length; i++) {
    lines.push(`    states0[${i}] = inst->model.vars[${stateRefs2[i]}];`);
  }

  if (dae.eventIndicators.length > 0) {
    lines.push(`    ${id}_getEventIndicators(&inst->model, z0);`);
  }
  lines.push("");
  lines.push(`    take_rk4_step(&inst->model, t, step_h, states0, states1);`);
  for (let i = 0; i < stateRefs2.length; i++) {
    lines.push(`    inst->model.vars[${stateRefs2[i]}] = states1[${i}];`);
  }
  lines.push("    inst->model.time = t + step_h;");

  if (dae.eventIndicators.length > 0) {
    lines.push(`    ${id}_getEventIndicators(&inst->model, z1);`);
    lines.push("    int crossing = 0;");
    lines.push("    for (int i = 0; i < N_EVENT_INDICATORS; i++) {");
    lines.push("      if ((z0[i] > 0 && z1[i] <= 0) || (z0[i] <= 0 && z1[i] > 0)) { crossing = 1; break; }");
    lines.push("    }");
    lines.push("    if (crossing) {");
    lines.push("      /* Bisection root finding (40 iterations ≈ 1e-12 precision) */");
    lines.push("      double h_left = 0, h_right = step_h;");
    lines.push("      for (int iter = 0; iter < 40; iter++) {");
    lines.push("        double h_mid = 0.5 * (h_left + h_right);");
    lines.push(`        take_rk4_step(&inst->model, t, h_mid, states0, states1);`);
    for (let i = 0; i < stateRefs2.length; i++) {
      lines.push(`        inst->model.vars[${stateRefs2[i]}] = states1[${i}];`);
    }
    lines.push("        inst->model.time = t + h_mid;");
    lines.push(`        ${id}_getEventIndicators(&inst->model, z1);`);
    lines.push("        int cross_mid = 0;");
    lines.push("        for (int i = 0; i < N_EVENT_INDICATORS; i++) {");
    lines.push("          if ((z0[i] > 0 && z1[i] <= 0) || (z0[i] <= 0 && z1[i] > 0)) { cross_mid = 1; break; }");
    lines.push("        }");
    lines.push("        if (cross_mid) h_right = h_mid; else h_left = h_mid;");
    lines.push("      }");
    lines.push("      step_h = h_right;");
    lines.push(`      take_rk4_step(&inst->model, t, step_h, states0, states1);`);
    for (let i = 0; i < stateRefs2.length; i++) {
      lines.push(`      inst->model.vars[${stateRefs2[i]}] = states1[${i}];`);
    }
    lines.push("      inst->model.time = t + step_h;");
    lines.push("");
    lines.push("      /* Chattering guard: prevent Zeno-type infinite event loops */");
    lines.push("      eventCount++;");
    lines.push("      if (eventCount > 100) {");
    lines.push("        inst->asyncResult = fmi2Error;");
    lines.push("        inst->asyncDone = 1;");
    lines.push("        return;  /* Abort: too many events in one communication step */");
    lines.push("      }");
    lines.push("");
    lines.push("      fmi2EventInfo eventInfo;");
    lines.push("      fmi2NewDiscreteStates((fmi2Component)inst, &eventInfo);");
    lines.push("      /* Track scheduled time events from discrete state update */");
    lines.push("      inst->nextEventTimeDefined = eventInfo.nextEventTimeDefined;");
    lines.push("      if (eventInfo.nextEventTimeDefined) inst->nextEventTime = eventInfo.nextEventTime;");
    lines.push("    }");
  }

  lines.push("    t += step_h;");
  lines.push("  }");
  lines.push("  inst->model.time = tEnd;");
  lines.push("  inst->asyncResult = inst->cancelRequested ? fmi2Error : fmi2OK;");
  lines.push("  inst->asyncDone = 1;");
  lines.push("}");
  lines.push("");
  lines.push("#ifndef _WIN32");
  lines.push("static void* doStep_thread(void* arg) { doStep_sync((FMUInstance*)arg); return NULL; }");
  lines.push("#else");
  lines.push("static DWORD WINAPI doStep_thread(LPVOID arg) { doStep_sync((FMUInstance*)arg); return 0; }");
  lines.push("#endif");
  lines.push("");

  // ── Co-Simulation: fmi2DoStep ──
  lines.push("/* --- Co-Simulation --- */");
  lines.push("fmi2Status fmi2DoStep(fmi2Component c, fmi2Real currentCommunicationPoint,");
  lines.push("    fmi2Real communicationStepSize, fmi2Boolean noSetFMUStatePriorToCurrentPoint) {");
  lines.push("  (void)noSetFMUStatePriorToCurrentPoint;");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  inst->asyncCurrentT = currentCommunicationPoint;");
  lines.push("  inst->asyncTEnd = currentCommunicationPoint + communicationStepSize;");
  lines.push("  inst->asyncDone = 0;");
  lines.push("  inst->cancelRequested = 0;");
  lines.push("  if (inst->asyncMode) {");
  lines.push("#ifdef _WIN32");
  lines.push("    inst->stepThread = CreateThread(NULL, 0, doStep_thread, inst, 0, NULL);");
  lines.push("    return inst->stepThread ? fmi2Pending : fmi2Error;");
  lines.push("#else");
  lines.push("    if (pthread_create(&inst->stepThread, NULL, doStep_thread, inst) == 0) {");
  lines.push("      inst->stepThreadActive = 1;");
  lines.push("      return fmi2Pending;");
  lines.push("    }");
  lines.push("    return fmi2Error;");
  lines.push("#endif");
  lines.push("  }");
  lines.push("  /* Synchronous fallback */");
  lines.push("  doStep_sync(inst);");
  lines.push("  return inst->asyncResult;");
  lines.push("}");
  lines.push("");

  // ── Terminate / FreeInstance ──
  lines.push("fmi2Status fmi2Terminate(fmi2Component c) { (void)c; return fmi2OK; }");
  lines.push("");
  lines.push("void fmi2FreeInstance(fmi2Component c) {");
  lines.push("  if (!c) return;");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  /* Free all allocated string variables */");
  lines.push("  for (int i = 0; i < N_STRING_VARS; i++) {");
  lines.push("    if (inst->model.stringVars[i]) free(inst->model.stringVars[i]);");
  lines.push("  }");
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
  lines.push("  free(inst);");
  lines.push("}");
  lines.push("");

  // ── Stubs for remaining FMI 2.0 functions ──
  lines.push("/* --- Stubs --- */");
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

  // ── fmi2SetString / fmi2GetString ──
  // Build a value-reference → string-index mapping for string variables
  const stringVarIndices = result.scalarVariables
    .filter((sv) => sv.type === "String")
    .map((sv, idx) => ({ vr: sv.valueReference, idx }));

  if (nStringVars > 0) {
    // Emit a lookup table: VR → string index (-1 if not a string var)
    lines.push("");
    lines.push("/* VR-to-string-index mapping */");
    lines.push(`static int stringVarIndex(fmi2ValueReference vr) {`);
    lines.push("  switch (vr) {");
    for (const { vr, idx } of stringVarIndices) {
      lines.push(`    case ${vr}: return ${idx};`);
    }
    lines.push("    default: return -1;");
    lines.push("  }");
    lines.push("}");
    lines.push("");

    lines.push(
      "fmi2Status fmi2SetString(fmi2Component c, const fmi2ValueReference vr[], size_t nvr, const fmi2String value[]) {",
    );
    lines.push("  FMUInstance* inst = (FMUInstance*)c;");
    lines.push("  for (size_t i = 0; i < nvr; i++) {");
    lines.push("    int idx = stringVarIndex(vr[i]);");
    lines.push("    if (idx >= 0) {");
    lines.push("      if (inst->model.stringVars[idx]) free(inst->model.stringVars[idx]);");
    lines.push('      inst->model.stringVars[idx] = value[i] ? strdup(value[i]) : strdup("");');
    lines.push("    }");
    lines.push("  }");
    lines.push("  return fmi2OK;");
    lines.push("}");
    lines.push("");
    lines.push(
      "fmi2Status fmi2GetString(fmi2Component c, const fmi2ValueReference vr[], size_t nvr, fmi2String value[]) {",
    );
    lines.push("  FMUInstance* inst = (FMUInstance*)c;");
    lines.push("  for (size_t i = 0; i < nvr; i++) {");
    lines.push("    int idx = stringVarIndex(vr[i]);");
    lines.push('    value[i] = (idx >= 0 && inst->model.stringVars[idx]) ? inst->model.stringVars[idx] : "";');
    lines.push("  }");
    lines.push("  return fmi2OK;");
    lines.push("}");
  } else {
    lines.push(
      "fmi2Status fmi2SetString(fmi2Component c, const fmi2ValueReference vr[], size_t nvr, const fmi2String value[]) { (void)c; (void)vr; (void)nvr; (void)value; return fmi2OK; }",
    );
    lines.push(
      "fmi2Status fmi2GetString(fmi2Component c, const fmi2ValueReference vr[], size_t nvr, fmi2String value[]) { (void)c; (void)vr; (void)nvr; (void)value; return fmi2OK; }",
    );
  }
  lines.push(
    "fmi2Status fmi2GetNominalsOfContinuousStates(fmi2Component c, fmi2Real nominals[], size_t nx) { for (size_t i = 0; i < nx; i++) nominals[i] = 1.0; (void)c; return fmi2OK; }",
  );
  // ── fmi2NewDiscreteStates ──
  // Evaluate when-equation conditions and execute body assignments on rising edge
  lines.push("fmi2Status fmi2NewDiscreteStates(fmi2Component c, fmi2EventInfo* info) {");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  (void)inst;");
  lines.push("  info->newDiscreteStatesNeeded = fmi2False;");
  lines.push("  info->terminateSimulation = fmi2False;");
  lines.push("  info->nominalsOfContinuousStatesChanged = fmi2False;");
  lines.push("  info->valuesOfContinuousStatesChanged = fmi2False;");
  lines.push("  info->nextEventTimeDefined = fmi2False;");

  const whenEqs = dae.whenClauses;
  if (whenEqs.length > 0) {
    lines.push("");
    lines.push("  /* Evaluate current event indicators */");
    lines.push("  double indicators[N_EVENT_INDICATORS];");
    lines.push(`  ${id}_getEventIndicators(&inst->model, indicators);`);
    lines.push("");

    // Emit local variable aliases for when-equation body assignments and conditions
    const bodyReferencedNames = new Set<string>();
    for (const weq of whenEqs) {
      collectReferencedNames(weq.condition, bodyReferencedNames);
      for (const bodyEq of weq.equations) {
        if (bodyEq instanceof ModelicaSimpleEquation) {
          collectReferencedNames(bodyEq.expression1, bodyReferencedNames);
          collectReferencedNames(bodyEq.expression2, bodyReferencedNames);
        }
      }
      for (const clause of weq.elseWhenClauses) {
        collectReferencedNames(clause.condition, bodyReferencedNames);
        for (const bodyEq of clause.equations) {
          if (bodyEq instanceof ModelicaSimpleEquation) {
            collectReferencedNames(bodyEq.expression1, bodyReferencedNames);
            collectReferencedNames(bodyEq.expression2, bodyReferencedNames);
          }
        }
      }
    }
    if (bodyReferencedNames.has("time")) {
      lines.push("  double time = inst->model.time;");
    }
    for (const sv of result.scalarVariables) {
      if (sv.causality === "independent") continue;
      if (!bodyReferencedNames.has(sv.name)) continue;
      const cName = varToC(sv.name);
      lines.push(`  double ${cName} = inst->model.vars[${sv.valueReference}];`);
    }
    lines.push("");

    let whenIdx = 0;
    for (const weq of whenEqs) {
      // Evaluate condition directly
      const condC = conditionToZeroCrossingC(weq.condition);
      lines.push(`  /* when-equation ${whenIdx} */`);
      lines.push(`  if (${condC} > 0.0 && inst->model.whenPrev[${whenIdx}] <= 0.0) {`);

      // Execute the when-equation body assignments
      for (const bodyEq of weq.equations) {
        if (bodyEq instanceof ModelicaSimpleEquation) {
          const lhsName = extractAssignmentTarget(bodyEq.expression1);
          if (lhsName) {
            // Find the VR for this variable
            const sv = result.scalarVariables.find((v) => v.name === lhsName);
            if (sv) {
              lines.push(
                `    inst->model.vars[${sv.valueReference}] = ${exprToC(bodyEq.expression2)};  /* ${lhsName} */`,
              );
            }
          }
        } else if (bodyEq instanceof ModelicaFunctionCallEquation) {
          if (bodyEq.call.functionName === "reinit" && bodyEq.call.args.length === 2) {
            const stateRef = bodyEq.call.args[0];
            const newValue = bodyEq.call.args[1];
            if (stateRef instanceof ModelicaNameExpression && newValue) {
              const sv = result.scalarVariables.find((v) => v.name === stateRef.name);
              if (sv) {
                lines.push(
                  `    inst->model.vars[${sv.valueReference}] = ${exprToC(newValue)};  /* reinit(${stateRef.name}) */`,
                );
                lines.push(`    info->valuesOfContinuousStatesChanged = fmi2True;`);
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
        const condElseC = conditionToZeroCrossingC(clause.condition);
        lines.push(`  /* elsewhen-clause ${whenIdx} */`);
        lines.push(`  if (${condElseC} > 0.0 && inst->model.whenPrev[${whenIdx}] <= 0.0) {`);
        for (const bodyEq of clause.equations) {
          if (bodyEq instanceof ModelicaSimpleEquation) {
            const lhsName = extractAssignmentTarget(bodyEq.expression1);
            if (lhsName) {
              const sv = result.scalarVariables.find((v) => v.name === lhsName);
              if (sv) {
                lines.push(
                  `    inst->model.vars[${sv.valueReference}] = ${exprToC(bodyEq.expression2)};  /* ${lhsName} */`,
                );
              }
            }
          } else if (bodyEq instanceof ModelicaFunctionCallEquation) {
            if (bodyEq.call.functionName === "reinit" && bodyEq.call.args.length === 2) {
              const stateRef = bodyEq.call.args[0];
              const newValue = bodyEq.call.args[1];
              if (stateRef instanceof ModelicaNameExpression && newValue) {
                const sv = result.scalarVariables.find((v) => v.name === stateRef.name);
                if (sv) {
                  lines.push(
                    `    inst->model.vars[${sv.valueReference}] = ${exprToC(newValue)};  /* reinit(${stateRef.name}) */`,
                  );
                  lines.push(`    info->valuesOfContinuousStatesChanged = fmi2True;`);
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
  // and set nextEventTimeDefined/nextEventTime to the nearest future event time
  const timeThresholds: string[] = [];
  for (const weq of whenEqs) {
    const t = extractTimeEventThresholdC(weq.condition);
    if (t) timeThresholds.push(t);
    for (const clause of weq.elseWhenClauses) {
      const t2 = extractTimeEventThresholdC(clause.condition);
      if (t2) timeThresholds.push(t2);
    }
  }
  if (timeThresholds.length > 0) {
    lines.push("");
    lines.push("  /* Scan for upcoming time events */");
    lines.push("  {");
    lines.push("    double t_current = inst->model.time;");
    lines.push("    double t_next = 1e300;");
    for (const threshold of timeThresholds) {
      lines.push(`    { double t_ev = ${threshold}; if (t_ev > t_current && t_ev < t_next) t_next = t_ev; }`);
    }
    lines.push("    if (t_next < 1e300) {");
    lines.push("      info->nextEventTimeDefined = fmi2True;");
    lines.push("      info->nextEventTime = t_next;");
    lines.push("    }");
    lines.push("  }");
  }

  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("fmi2Status fmi2EnterContinuousTimeMode(fmi2Component c) { (void)c; return fmi2OK; }");
  lines.push("fmi2Status fmi2EnterEventMode(fmi2Component c) { (void)c; return fmi2OK; }");
  lines.push("fmi2Status fmi2CancelStep(fmi2Component c) {");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  if (!inst->asyncMode || inst->asyncDone) return fmi2OK;");
  lines.push("  inst->cancelRequested = 1;");
  lines.push("#ifdef _WIN32");
  lines.push("  WaitForSingleObject(inst->stepThread, INFINITE);");
  lines.push("  CloseHandle(inst->stepThread);");
  lines.push("#else");
  lines.push("  if (inst->stepThreadActive) { pthread_join(inst->stepThread, NULL); inst->stepThreadActive = 0; }");
  lines.push("#endif");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("fmi2Status fmi2GetStatus(fmi2Component c, const fmi2StatusKind s, fmi2Status* value) {");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  if (s == fmi2DoStepStatus) {");
  lines.push("    if (inst->asyncDone) {");
  lines.push("#ifndef _WIN32");
  lines.push("      if (inst->stepThreadActive) { pthread_join(inst->stepThread, NULL); inst->stepThreadActive = 0; }");
  lines.push("#endif");
  lines.push("      *value = inst->asyncResult;");
  lines.push("    } else {");
  lines.push("      *value = fmi2Pending;");
  lines.push("    }");
  lines.push("  } else {");
  lines.push("    *value = fmi2OK;");
  lines.push("  }");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push(
    "fmi2Status fmi2GetRealStatus(fmi2Component c, const fmi2StatusKind s, fmi2Real* value) { (void)c; (void)s; *value = 0.0; return fmi2OK; }",
  );
  lines.push(
    "fmi2Status fmi2GetIntegerStatus(fmi2Component c, const fmi2StatusKind s, fmi2Integer* value) { (void)c; (void)s; *value = 0; return fmi2OK; }",
  );
  lines.push(
    "fmi2Status fmi2GetBooleanStatus(fmi2Component c, const fmi2StatusKind s, fmi2Boolean* value) { (void)c; (void)s; *value = fmi2False; return fmi2OK; }",
  );
  lines.push(
    'fmi2Status fmi2GetStringStatus(fmi2Component c, const fmi2StatusKind s, fmi2String* value) { (void)c; (void)s; *value = ""; return fmi2OK; }',
  );
  lines.push("const char* fmi2GetTypesPlatform(void) { return fmi2TypesPlatform; }");
  lines.push('const char* fmi2GetVersion(void) { return "2.0"; }');

  // ── fmi2SetDebugLogging (proper implementation) ──
  lines.push("/* --- Debug Logging --- */");
  lines.push(
    "fmi2Status fmi2SetDebugLogging(fmi2Component c, fmi2Boolean loggingOn, size_t nCategories, const fmi2String categories[]) {",
  );
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  inst->loggingOn = loggingOn;");
  lines.push("  (void)nCategories; (void)categories;");
  lines.push("  return fmi2OK;");
  lines.push("}");

  // ── fmi2SetRealInputDerivatives / fmi2GetRealOutputDerivatives ──
  lines.push("/* --- Input/Output Derivatives for Interpolation --- */");
  lines.push(
    "fmi2Status fmi2SetRealInputDerivatives(fmi2Component c, const fmi2ValueReference vr[], size_t nvr, const fmi2Integer order[], const fmi2Real value[]) {",
  );
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  for (size_t i = 0; i < nvr; i++) {");
  lines.push("    if (order[i] == 1 && vr[i] < N_VARS) inst->inputDerivatives[vr[i]] = value[i];");
  lines.push("  }");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push(
    "fmi2Status fmi2GetRealOutputDerivatives(fmi2Component c, const fmi2ValueReference vr[], size_t nvr, const fmi2Integer order[], fmi2Real value[]) {",
  );
  lines.push("  (void)c; (void)vr; (void)nvr;");
  lines.push("  /* Return 0 for all output derivatives (order > 0) */");
  lines.push("  for (size_t i = 0; i < nvr; i++) { (void)order; value[i] = 0.0; }");
  lines.push("  return fmi2OK;");
  lines.push("}");

  // ── FMU State Save/Restore ──
  lines.push("/* --- FMU State Management --- */");
  lines.push("fmi2Status fmi2GetFMUstate(fmi2Component c, fmi2FMUstate* state) {");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  FMUInstance* copy = (FMUInstance*)malloc(sizeof(FMUInstance));");
  lines.push("  if (!copy) return fmi2Error;");
  lines.push("  memcpy(copy, inst, sizeof(FMUInstance));");
  lines.push("  /* Deep copy strings */");
  lines.push("  for (int i = 0; i < N_STRING_VARS; i++) {");
  lines.push("    if (inst->model.stringVars[i]) {");
  lines.push("      copy->model.stringVars[i] = strdup(inst->model.stringVars[i]);");
  lines.push("    } else {");
  lines.push("      copy->model.stringVars[i] = NULL;");
  lines.push("    }");
  lines.push("  }");
  lines.push("  *state = (fmi2FMUstate)copy;");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");
  lines.push("fmi2Status fmi2SetFMUstate(fmi2Component c, fmi2FMUstate state) {");
  lines.push("  if (!state) return fmi2Error;");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  /* Preserve the callback pointers — they belong to the master, not the snapshot */");
  lines.push("  fmi2CallbackFunctions savedCb = inst->callbacks;");
  lines.push("  fmi2String savedName = inst->instanceName;");
  lines.push("  /* Free current string vars before overwriting pointers */");
  lines.push("  for (int i = 0; i < N_STRING_VARS; i++) {");
  lines.push("    if (inst->model.stringVars[i]) free(inst->model.stringVars[i]);");
  lines.push("  }");
  lines.push("  memcpy(inst, (FMUInstance*)state, sizeof(FMUInstance));");
  lines.push("  inst->callbacks = savedCb;");
  lines.push("  inst->instanceName = savedName;");
  lines.push("  /* Deep copy snapshot strings */");
  lines.push("  for (int i = 0; i < N_STRING_VARS; i++) {");
  lines.push("    if (((FMUInstance*)state)->model.stringVars[i]) {");
  lines.push("      inst->model.stringVars[i] = strdup(((FMUInstance*)state)->model.stringVars[i]);");
  lines.push("    } else {");
  lines.push("      inst->model.stringVars[i] = NULL;");
  lines.push("    }");
  lines.push("  }");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");
  lines.push("fmi2Status fmi2FreeFMUstate(fmi2Component c, fmi2FMUstate* state) {");
  lines.push("  (void)c;");
  lines.push("  if (!state || !*state) return fmi2Error;");
  lines.push("  FMUInstance* copy = (FMUInstance*)(*state);");
  lines.push("  for (int i = 0; i < N_STRING_VARS; i++) {");
  lines.push("    if (copy->model.stringVars[i]) free(copy->model.stringVars[i]);");
  lines.push("  }");
  lines.push("  free(copy);");
  lines.push("  *state = NULL;");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");
  lines.push("fmi2Status fmi2SerializedFMUstateSize(fmi2Component c, fmi2FMUstate state, size_t* size) {");
  lines.push("  (void)c; (void)state;");
  lines.push("  if (!size) return fmi2Error;");
  lines.push("  if (N_STRING_VARS > 0) return fmi2Error; /* Serializing dynamic strings not supported yet */");
  lines.push("  *size = sizeof(FMUInstance);");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");
  lines.push("fmi2Status fmi2SerializeFMUstate(fmi2Component c, fmi2FMUstate state, fmi2Byte buf[], size_t size) {");
  lines.push("  (void)c;");
  lines.push("  if (N_STRING_VARS > 0) return fmi2Error;");
  lines.push("  if (!state || !buf || size < sizeof(FMUInstance)) return fmi2Error;");
  lines.push("  memcpy(buf, (FMUInstance*)state, sizeof(FMUInstance));");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");
  lines.push(
    "fmi2Status fmi2DeSerializeFMUstate(fmi2Component c, const fmi2Byte buf[], size_t size, fmi2FMUstate* state) {",
  );
  lines.push("  (void)c;");
  lines.push("  if (N_STRING_VARS > 0) return fmi2Error;");
  lines.push("  if (!buf || !state || size < sizeof(FMUInstance)) return fmi2Error;");
  lines.push("  FMUInstance* copy = (FMUInstance*)malloc(sizeof(FMUInstance));");
  lines.push("  if (!copy) return fmi2Error;");
  lines.push("  memcpy(copy, buf, sizeof(FMUInstance));");
  lines.push("  *state = (fmi2FMUstate)copy;");
  lines.push("  return fmi2OK;");
  lines.push("}");
  // ── fmi2GetDirectionalDerivative ──
  // Compute Δż = J · Δz where J is the Jacobian ∂f/∂x
  // J[i][j] = ∂(derivative[i])/∂(state[j]) — precomputed symbolically
  lines.push(
    "fmi2Status fmi2GetDirectionalDerivative(fmi2Component c, const fmi2ValueReference unknown[], size_t nUnknown, const fmi2ValueReference known[], size_t nKnown, const fmi2Real dvKnown[], fmi2Real dvUnknown[]) {",
  );
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  (void)inst; (void)unknown; (void)nUnknown; (void)known; (void)nKnown; (void)dvKnown; (void)dvUnknown;");

  // Extract derivative equations: der(x) = f(x, y, t)
  const derEquations: { stateName: string; rhs: ModelicaExpression }[] = [];
  for (const eq of dae.equations) {
    if (!("expression1" in eq && "expression2" in eq)) continue;
    const simpleEq = eq as { expression1: ModelicaExpression; expression2: ModelicaExpression };
    const lhsDer = extractDerName(simpleEq.expression1);
    const rhsDer = extractDerName(simpleEq.expression2);
    if (lhsDer) {
      derEquations.push({ stateName: lhsDer, rhs: simpleEq.expression2 });
    } else if (rhsDer) {
      derEquations.push({ stateName: rhsDer, rhs: simpleEq.expression1 });
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
    lines.push("      switch (unknown[i]) {");
    for (let di = 0; di < derEquations.length; di++) {
      const derVR = derVRs[di];
      const derEq = derEquations[di];
      if (derVR === undefined || !derEq) continue;
      lines.push(`      case ${derVR}: /* der(${derEq.stateName}) */`);
      lines.push("        switch (known[j]) {");
      for (let si = 0; si < stateNames.length; si++) {
        const jacVR = jacStateVRs[si];
        const stateName = stateNames[si];
        if (jacVR === undefined || !stateName) continue;
        // Symbolically differentiate rhs w.r.t. state variable
        const jacobianEntry = simplifyExpr(differentiateExpr(derEq.rhs, stateName));
        const jacobianC = exprToC(jacobianEntry);
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
    lines.push("  (void)inst; (void)unknown; (void)nUnknown; (void)known; (void)nKnown; (void)dvKnown;");
    lines.push("  for (size_t i = 0; i < nUnknown; i++) dvUnknown[i] = 0.0;");
  }

  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");

  return lines.join("\n");
}

// ── CMakeLists.txt generator ──

function generateCMakeLists(
  id: string,
  externalLibraries: string[] = [],
  solverDeps?: { sundials?: boolean; coinor?: boolean },
): string {
  const sundialsBlock = solverDeps?.sundials
    ? `
# ── SUNDIALS dependency ──
find_package(SUNDIALS REQUIRED COMPONENTS cvodes idas kinsol)
target_link_libraries(${id} PRIVATE
  SUNDIALS::cvodes
  SUNDIALS::idas
  SUNDIALS::kinsol
)
`
    : "";

  const coinorBlock = solverDeps?.coinor
    ? `
# ── COIN-OR dependency ──
find_package(PkgConfig REQUIRED)
pkg_check_modules(IPOPT QUIET ipopt)
pkg_check_modules(CLP QUIET clp)
pkg_check_modules(CBC QUIET cbc)

if(IPOPT_FOUND)
  target_compile_definitions(${id} PRIVATE HAVE_IPOPT)
  target_include_directories(${id} PRIVATE \${IPOPT_INCLUDE_DIRS})
  target_link_libraries(${id} PRIVATE \${IPOPT_LIBRARIES})
endif()
if(CLP_FOUND)
  target_compile_definitions(${id} PRIVATE HAVE_CLP)
  target_include_directories(${id} PRIVATE \${CLP_INCLUDE_DIRS})
  target_link_libraries(${id} PRIVATE \${CLP_LIBRARIES})
endif()
if(CBC_FOUND)
  target_compile_definitions(${id} PRIVATE HAVE_CBC)
  target_include_directories(${id} PRIVATE \${CBC_INCLUDE_DIRS})
  target_link_libraries(${id} PRIVATE \${CBC_LIBRARIES})
endif()
`
    : "";

  return `# Auto-generated by ModelScript — CMake build for FMU shared library
cmake_minimum_required(VERSION 3.10)
project(${id} C)

set(CMAKE_C_STANDARD 99)

# FMI platform identifier
if(CMAKE_SIZEOF_VOID_P EQUAL 8)
  set(FMI_PLATFORM_BITS "64")
else()
  set(FMI_PLATFORM_BITS "32")
endif()

if(WIN32)
  set(FMI_PLATFORM "win\${FMI_PLATFORM_BITS}")
elseif(APPLE)
  set(FMI_PLATFORM "darwin\${FMI_PLATFORM_BITS}")
else()
  set(FMI_PLATFORM "linux\${FMI_PLATFORM_BITS}")
endif()

# Build shared library
add_library(${id} SHARED
  ${id}_model.c
  fmi2Functions.c
  fmi3Functions.c
)

target_include_directories(${id} PRIVATE \${CMAKE_CURRENT_SOURCE_DIR})

${externalLibraries.length > 0 ? `target_link_libraries(${id} PRIVATE ${externalLibraries.join(" ").replace(/\\/g, "/")})` : ""}
${sundialsBlock}${coinorBlock}
# Export FMI symbols, hide everything else
set_target_properties(${id} PROPERTIES
  PREFIX ""
  C_VISIBILITY_PRESET hidden
  POSITION_INDEPENDENT_CODE ON
)

if(MSVC)
  target_compile_definitions(${id} PRIVATE FMI2_FUNCTION_PREFIX= _CRT_SECURE_NO_WARNINGS)
  set_target_properties(${id} PROPERTIES WINDOWS_EXPORT_ALL_SYMBOLS ON)
elseif(MINGW)
  target_compile_options(${id} PRIVATE -Wall -O2)
  target_link_options(${id} PRIVATE -static-libgcc)
else()
  target_compile_options(${id} PRIVATE -Wall -Wextra -O2)
endif()

# Install into FMU-standard binaries/<platform>/ directory
install(TARGETS ${id}
  LIBRARY DESTINATION binaries/\${FMI_PLATFORM}
  RUNTIME DESTINATION binaries/\${FMI_PLATFORM}
)

message(STATUS "FMI platform: \${FMI_PLATFORM}")
message(STATUS "Build with: cmake -B build && cmake --build build")
message(STATUS "Library will be: build/${id}\${CMAKE_SHARED_LIBRARY_SUFFIX}")
`;
}

function extractDerName(expr: unknown): string | null {
  if (expr && typeof expr === "object" && "functionName" in expr && "args" in expr) {
    const funcExpr = expr as { functionName: string; args: unknown[] };
    if (funcExpr.functionName === "der" && funcExpr.args.length === 1) {
      const arg0 = funcExpr.args[0];
      if (arg0 && typeof arg0 === "object" && "name" in arg0) {
        const nameVal = (arg0 as { name: unknown }).name;
        if (typeof nameVal === "string") return nameVal;
      }
    }
  }
  if (expr && typeof expr === "object" && "name" in expr) {
    const nameVal = (expr as { name: unknown }).name;
    if (typeof nameVal === "string" && nameVal.startsWith("der(") && nameVal.endsWith(")")) {
      return nameVal.substring(4, nameVal.length - 1);
    }
  }
  return null;
}

/** Recursively collect all variable names referenced in an expression. */
function collectReferencedNames(expr: unknown, names: Set<string>): void {
  if (!expr || typeof expr !== "object") return;
  // Handle ModelicaArray — recurse into each element
  if (expr instanceof ModelicaArray) {
    for (const elem of expr.flatElements) {
      collectReferencedNames(elem, names);
    }
    return;
  }
  if ("name" in expr) {
    const nameVal = (expr as { name: unknown }).name;
    if (typeof nameVal === "string") {
      if (nameVal.startsWith("der(") && nameVal.endsWith(")")) {
        names.add(nameVal.substring(4, nameVal.length - 1));
      } else {
        names.add(nameVal);
      }
    }
  }
  if ("operand" in expr) collectReferencedNames((expr as { operand: unknown }).operand, names);
  if ("operand1" in expr) collectReferencedNames((expr as { operand1: unknown }).operand1, names);
  if ("operand2" in expr) collectReferencedNames((expr as { operand2: unknown }).operand2, names);
  if ("condition" in expr) collectReferencedNames((expr as { condition: unknown }).condition, names);
  if ("thenExpression" in expr) collectReferencedNames((expr as { thenExpression: unknown }).thenExpression, names);
  if ("elseExpression" in expr) collectReferencedNames((expr as { elseExpression: unknown }).elseExpression, names);
  if ("args" in expr) {
    const args = (expr as { args: unknown[] }).args;
    if (Array.isArray(args)) {
      for (const arg of args) collectReferencedNames(arg, names);
    }
  }
  if ("elseIfClauses" in expr) {
    const clauses = (expr as { elseIfClauses: { condition: unknown; expression: unknown }[] }).elseIfClauses;
    if (Array.isArray(clauses)) {
      for (const clause of clauses) {
        collectReferencedNames(clause.condition, names);
        collectReferencedNames(clause.expression, names);
      }
    }
  }
}
export function generateFmi3FunctionsC(id: string, dae: ModelicaDAE): string {
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
  lines.push("  FMI3InstanceData* inst = (FMI3InstanceData*)instance;");
  lines.push("  inst->model.time = startTime;");
  lines.push(`  ${id}_solveAlgebraicLoops(&inst->model);`);
  lines.push("  return fmi3OK;");
  lines.push("}");
  lines.push("");
  lines.push("fmi3Status fmi3ExitInitializationMode(fmi3Instance instance) { return fmi3OK; }");
  lines.push("fmi3Status fmi3EnterEventMode(fmi3Instance instance) { return fmi3OK; }");
  lines.push("fmi3Status fmi3EnterContinuousTimeMode(fmi3Instance instance) { return fmi3OK; }");
  lines.push("fmi3Status fmi3EnterStepMode(fmi3Instance instance) { return fmi3OK; }");
  lines.push("");
  lines.push(
    "fmi3Status fmi3GetFloat64(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, fmi3Float64 value[], size_t nValues) {",
  );
  lines.push("  FMI3InstanceData* inst = (FMI3InstanceData*)instance;");
  lines.push("  for (size_t i = 0; i < nvr; i++) { if (vr[i] < N_VARS) value[i] = inst->model.vars[vr[i]]; }");
  lines.push("  return fmi3OK;");
  lines.push("}");
  lines.push(
    "fmi3Status fmi3SetFloat64(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, const fmi3Float64 value[], size_t nValues) {",
  );
  lines.push("  FMI3InstanceData* inst = (FMI3InstanceData*)instance;");
  lines.push("  for (size_t i = 0; i < nvr; i++) { if (vr[i] < N_VARS) inst->model.vars[vr[i]] = value[i]; }");
  lines.push("  return fmi3OK;");
  lines.push("}");
  lines.push(
    "fmi3Status fmi3GetInt32(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, fmi3Int32 value[], size_t nValues) {",
  );
  lines.push("  FMI3InstanceData* inst = (FMI3InstanceData*)instance;");
  lines.push(
    "  for (size_t i = 0; i < nvr; i++) { if (vr[i] < N_VARS) value[i] = (fmi3Int32)inst->model.vars[vr[i]]; }",
  );
  lines.push("  return fmi3OK;");
  lines.push("}");
  lines.push(
    "fmi3Status fmi3SetInt32(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, const fmi3Int32 value[], size_t nValues) {",
  );
  lines.push("  FMI3InstanceData* inst = (FMI3InstanceData*)instance;");
  lines.push("  for (size_t i = 0; i < nvr; i++) { if (vr[i] < N_VARS) inst->model.vars[vr[i]] = (double)value[i]; }");
  lines.push("  return fmi3OK;");
  lines.push("}");
  lines.push(
    "fmi3Status fmi3GetBoolean(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, fmi3Boolean value[], size_t nValues) {",
  );
  lines.push("  FMI3InstanceData* inst = (FMI3InstanceData*)instance;");
  lines.push(
    "  for (size_t i = 0; i < nvr; i++) { if (vr[i] < N_VARS) value[i] = inst->model.vars[vr[i]] > 0.5 ? 1 : 0; }",
  );
  lines.push("  return fmi3OK;");
  lines.push("}");
  lines.push(
    " fmi3Status fmi3SetBoolean(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, const fmi3Boolean value[], size_t nValues) {",
  );
  lines.push("  FMI3InstanceData* inst = (FMI3InstanceData*)instance;");
  lines.push(
    "  for (size_t i = 0; i < nvr; i++) { if (vr[i] < N_VARS) inst->model.vars[vr[i]] = value[i] ? 1.0 : 0.0; }",
  );
  lines.push("  return fmi3OK;");
  lines.push("}");
  lines.push(
    "fmi3Status fmi3GetClock(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, fmi3Clock value[], size_t nValues) {",
  );
  lines.push("  FMI3InstanceData* inst = (FMI3InstanceData*)instance;");
  lines.push(
    "  for (size_t i = 0; i < nvr; i++) { if (vr[i] < N_VARS) value[i] = inst->model.vars[vr[i]] > 0.5 ? 1 : 0; }",
  );
  lines.push("  return fmi3OK;");
  lines.push("}");
  lines.push(
    "fmi3Status fmi3SetClock(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, const fmi3Clock value[], size_t nValues) {",
  );
  lines.push("  FMI3InstanceData* inst = (FMI3InstanceData*)instance;");
  lines.push(
    "  for (size_t i = 0; i < nvr; i++) { if (vr[i] < N_VARS) inst->model.vars[vr[i]] = value[i] ? 1.0 : 0.0; }",
  );
  lines.push("  return fmi3OK;");
  lines.push("}");
  lines.push(
    "fmi3Status fmi3UpdateDiscreteStates(fmi3Instance instance, fmi3Boolean* discreteStatesNeedUpdate, fmi3Boolean* terminateSimulation, fmi3Boolean* nominalsOfContinuousStatesChanged, fmi3Boolean* valuesOfContinuousStatesChanged, fmi3Boolean* nextEventTimeDefined, fmi3Float64* nextEventTime) {",
  );
  lines.push("  if (discreteStatesNeedUpdate) *discreteStatesNeedUpdate = 0;");
  lines.push("  if (terminateSimulation) *terminateSimulation = 0;");
  lines.push("  if (nominalsOfContinuousStatesChanged) *nominalsOfContinuousStatesChanged = 0;");
  lines.push("  if (valuesOfContinuousStatesChanged) *valuesOfContinuousStatesChanged = 0;");
  lines.push("  if (nextEventTimeDefined) *nextEventTimeDefined = 0;");
  lines.push("  return fmi3OK;");
  lines.push("}");
  lines.push("");
  lines.push("fmi3Status fmi3GetContinuousStates(fmi3Instance instance, fmi3Float64 states[], size_t nStates) {");
  lines.push("  FMI3InstanceData* inst = (FMI3InstanceData*)instance;");
  lines.push("  for (size_t i = 0; i < nStates; i++) states[i] = inst->model.states[i];");
  lines.push("  return fmi3OK;");
  lines.push("}");
  lines.push("fmi3Status fmi3SetContinuousStates(fmi3Instance instance, const fmi3Float64 states[], size_t nStates) {");
  lines.push("  FMI3InstanceData* inst = (FMI3InstanceData*)instance;");
  lines.push("  for (size_t i = 0; i < nStates; i++) inst->model.states[i] = states[i];");
  lines.push("  return fmi3OK;");
  lines.push("}");
  lines.push(
    "fmi3Status fmi3GetContinuousStateDerivatives(fmi3Instance instance, fmi3Float64 derivatives[], size_t nStates) {",
  );
  lines.push("  FMI3InstanceData* inst = (FMI3InstanceData*)instance;");
  lines.push(`  ${id}_getDerivatives(&inst->model);`);
  lines.push("  for (size_t i = 0; i < nStates; i++) derivatives[i] = inst->model.derivatives[i];");
  lines.push("  return fmi3OK;");
  lines.push("}");
  lines.push("fmi3Status fmi3SetTime(fmi3Instance instance, fmi3Float64 time) {");
  lines.push("  ((FMI3InstanceData*)instance)->model.time = time;");
  lines.push("  return fmi3OK;");
  lines.push("}");
  lines.push("");
  lines.push("/* Co-Simulation RK4 Step */");
  lines.push(
    "fmi3Status fmi3DoStep(fmi3Instance instance, fmi3Float64 currentCommunicationPoint, fmi3Float64 communicationStepSize, fmi3Boolean noSetFMUStatePriorToCurrentPoint, fmi3Boolean* eventHandlingNeeded, fmi3Boolean* terminateSimulation, fmi3Boolean* earlyReturn, fmi3Float64* lastSuccessfulTime) {",
  );
  lines.push("  FMI3InstanceData* inst = (FMI3InstanceData*)instance;");
  lines.push("  double t = currentCommunicationPoint;");
  lines.push("  double h = communicationStepSize;");
  lines.push("  int n = N_STATES;");
  lines.push("  double k1[N_STATES+1], k2[N_STATES+1], k3[N_STATES+1], k4[N_STATES+1], y0[N_STATES+1];");
  lines.push("  for (int i=0; i<n; i++) y0[i] = inst->model.states[i];");
  lines.push("");
  lines.push(`  ${id}_getDerivatives(&inst->model);`);
  lines.push("  for (int i=0; i<n; i++) k1[i] = inst->model.derivatives[i];");
  lines.push("");
  lines.push("  inst->model.time = t + h/2;");
  lines.push("  for (int i=0; i<n; i++) inst->model.states[i] = y0[i] + h/2 * k1[i];");
  lines.push(`  ${id}_getDerivatives(&inst->model);`);
  lines.push("  for (int i=0; i<n; i++) k2[i] = inst->model.derivatives[i];");
  lines.push("");
  lines.push("  for (int i=0; i<n; i++) inst->model.states[i] = y0[i] + h/2 * k2[i];");
  lines.push(`  ${id}_getDerivatives(&inst->model);`);
  lines.push("  for (int i=0; i<n; i++) k3[i] = inst->model.derivatives[i];");
  lines.push("");
  lines.push("  inst->model.time = t + h;");
  lines.push("  for (int i=0; i<n; i++) inst->model.states[i] = y0[i] + h * k3[i];");
  lines.push(`  ${id}_getDerivatives(&inst->model);`);
  lines.push("  for (int i=0; i<n; i++) k4[i] = inst->model.derivatives[i];");
  lines.push("");
  lines.push(
    "  for (int i=0; i<n; i++) inst->model.states[i] = y0[i] + (h/6.0) * (k1[i] + 2*k2[i] + 2*k3[i] + k4[i]);",
  );

  // FMI 3.0 zero-crossing detection in fmi3DoStep
  if (dae.eventIndicators.length > 0) {
    lines.push("");
    lines.push("  /* Zero-crossing detection */");
    lines.push("  double z0_3[N_EVENT_INDICATORS+1], z1_3[N_EVENT_INDICATORS+1];");
    lines.push(`  /* Evaluate indicators at start (y0, t) */`);
    lines.push(`  for (int i=0; i<n; i++) inst->model.states[i] = y0[i];`);
    lines.push(`  inst->model.time = t;`);
    lines.push(`  ${id}_getEventIndicators(&inst->model, z0_3);`);
    lines.push(`  /* Restore end state */`);
    lines.push(
      `  for (int i=0; i<n; i++) inst->model.states[i] = y0[i] + (h/6.0) * (k1[i] + 2*k2[i] + 2*k3[i] + k4[i]);`,
    );
    lines.push(`  inst->model.time = t + h;`);
    lines.push(`  ${id}_getEventIndicators(&inst->model, z1_3);`);
    lines.push("  int crossing3 = 0;");
    lines.push("  for (int i=0; i<N_EVENT_INDICATORS; i++) {");
    lines.push("    if ((z0_3[i] > 0 && z1_3[i] <= 0) || (z0_3[i] <= 0 && z1_3[i] > 0)) { crossing3 = 1; break; }");
    lines.push("  }");
    lines.push("  if (eventHandlingNeeded) *eventHandlingNeeded = crossing3;");
    lines.push("  if (crossing3 && earlyReturn) *earlyReturn = 1;");
    lines.push("  if (crossing3 && lastSuccessfulTime) *lastSuccessfulTime = t + h;");
  } else {
    lines.push("  if (eventHandlingNeeded) *eventHandlingNeeded = 0;");
    lines.push("  if (earlyReturn) *earlyReturn = 0;");
    lines.push("  if (lastSuccessfulTime) *lastSuccessfulTime = t + h;");
  }

  lines.push("  if (terminateSimulation) *terminateSimulation = 0;");
  lines.push("  return fmi3OK;");
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}
