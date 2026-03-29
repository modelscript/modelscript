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

import type { ModelicaDAE, ModelicaExpression } from "./dae.js";
import {
  ModelicaBinaryExpression,
  ModelicaBooleanLiteral,
  ModelicaFunctionCallExpression,
  ModelicaIfElseExpression,
  ModelicaIntegerLiteral,
  ModelicaNameExpression,
  ModelicaRealLiteral,
  ModelicaSimpleEquation,
  ModelicaStringLiteral,
  ModelicaTransitionEquation,
  ModelicaUnaryExpression,
} from "./dae.js";
import type { FmuOptions, FmuResult } from "./fmi.js";
import { differentiateExpr, simplifyExpr } from "./symbolic-diff.js";
import { ModelicaBinaryOperator, ModelicaUnaryOperator, ModelicaVariability } from "./syntax.js";

/** Generated C source files. */
export interface FmuCSourceFiles {
  /** model.h — variable declarations. */
  modelH: string;
  /** model.c — equation evaluation. */
  modelC: string;
  /** fmi2Functions.c — FMI 2.0 API wrapper. */
  fmi2FunctionsC: string;
  /** CMakeLists.txt — build system for compiling the FMU shared library. */
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
  const modelC = generateModelC(id, dae, fmuResult);

  // ── fmi2Functions.c ──
  const fmi2FunctionsC = generateFmi2FunctionsC(id, nVars, nStates, nStringVars, dae, fmuResult);

  // ── CMakeLists.txt ──
  const cmakeLists = generateCMakeLists(id);

  return { modelH, modelC, fmi2FunctionsC, cmakeLists };
}

// ── Expression → C transpiler ──

/** Convert a DAE expression to a C expression string. */
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

/** Sanitize a Modelica name into a valid C identifier. */
function sanitizeIdentifier(name: string): string {
  return name
    .replace(/\./g, "_")
    .replace(/\[/g, "_")
    .replace(/\]/g, "")
    .replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Map binary operator to C operator. */
function binaryOpToC(op: ModelicaBinaryOperator): string {
  switch (op) {
    case ModelicaBinaryOperator.ADDITION:
    case ModelicaBinaryOperator.ELEMENTWISE_ADDITION:
      return "+";
    case ModelicaBinaryOperator.SUBTRACTION:
    case ModelicaBinaryOperator.ELEMENTWISE_SUBTRACTION:
      return "-";
    case ModelicaBinaryOperator.MULTIPLICATION:
    case ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION:
      return "*";
    case ModelicaBinaryOperator.DIVISION:
    case ModelicaBinaryOperator.ELEMENTWISE_DIVISION:
      return "/";
    case ModelicaBinaryOperator.EXPONENTIATION:
    case ModelicaBinaryOperator.ELEMENTWISE_EXPONENTIATION:
      return "pow";
    case ModelicaBinaryOperator.LESS_THAN:
      return "<";
    case ModelicaBinaryOperator.LESS_THAN_OR_EQUAL:
      return "<=";
    case ModelicaBinaryOperator.GREATER_THAN:
      return ">";
    case ModelicaBinaryOperator.GREATER_THAN_OR_EQUAL:
      return ">=";
    case ModelicaBinaryOperator.EQUALITY:
      return "==";
    case ModelicaBinaryOperator.INEQUALITY:
      return "!=";
    case ModelicaBinaryOperator.LOGICAL_AND:
      return "&&";
    case ModelicaBinaryOperator.LOGICAL_OR:
      return "||";
    default:
      return "+";
  }
}

/** Map Modelica built-in function names to C math library equivalents. */
function mapFunctionName(name: string): string {
  const builtins: Record<string, string> = {
    sin: "sin",
    cos: "cos",
    tan: "tan",
    asin: "asin",
    acos: "acos",
    atan: "atan",
    atan2: "atan2",
    sinh: "sinh",
    cosh: "cosh",
    tanh: "tanh",
    exp: "exp",
    log: "log",
    log10: "log10",
    sqrt: "sqrt",
    abs: "fabs",
    sign: "copysign",
    floor: "floor",
    ceil: "ceil",
    min: "fmin",
    max: "fmax",
    mod: "fmod",
    "Modelica.Math.sin": "sin",
    "Modelica.Math.cos": "cos",
    "Modelica.Math.log": "log",
    "Modelica.Math.exp": "exp",
    "Modelica.Math.sqrt": "sqrt",
    "Modelica.Math.atan2": "atan2",
  };
  return builtins[name] ?? sanitizeIdentifier(name);
}

/** Format a double for C source. */
function formatCDouble(value: number): string {
  if (!isFinite(value)) {
    if (value === Infinity) return "INFINITY";
    if (value === -Infinity) return "(-INFINITY)";
    return "NAN";
  }
  const s = value.toString();
  // Ensure it has a decimal point or exponent to be a C double literal
  if (!s.includes(".") && !s.includes("e") && !s.includes("E")) {
    return s + ".0";
  }
  return s;
}

/** Escape special characters for C string literals. */
function escapeCString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
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

  lines.push(`} ${id}_Instance;`);
  lines.push("");
  lines.push(`void ${id}_initialize(${id}_Instance* inst);`);
  lines.push(`void ${id}_getDerivatives(${id}_Instance* inst);`);
  lines.push(`void ${id}_getEventIndicators(${id}_Instance* inst, double* indicators);`);
  lines.push("");
  lines.push("#endif");
  return lines.join("\n");
}

function generateModelC(id: string, dae: ModelicaDAE, result: FmuResult): string {
  const lines: string[] = [];
  lines.push("/* Auto-generated by ModelScript — do not edit */");
  lines.push(`#include "${id}_model.h"`);
  lines.push("#include <stdio.h>");
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
  lines.push("}");
  lines.push("");

  // ── getDerivatives function ──
  lines.push(`void ${id}_getDerivatives(${id}_Instance* inst) {`);

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
  // Walk DAE equations looking for der(x) = expr patterns
  let derIdx = 0;
  for (const eq of dae.equations) {
    if (!("expression1" in eq && "expression2" in eq)) continue;
    const simpleEq = eq as { expression1: ModelicaExpression; expression2: ModelicaExpression };
    const lhsDer = extractDerName(simpleEq.expression1);
    const rhsDer = extractDerName(simpleEq.expression2);

    if (lhsDer) {
      lines.push(`  inst->derivatives[${derIdx}] = ${exprToC(simpleEq.expression2)};  /* der(${lhsDer}) */`);
      derIdx++;
    } else if (rhsDer) {
      lines.push(`  inst->derivatives[${derIdx}] = ${exprToC(simpleEq.expression1)};  /* der(${rhsDer}) */`);
      derIdx++;
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
  lines.push("} FMUInstance;");
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
  lines.push(`  ${id}_initialize(&inst->model);`);
  lines.push("  return (fmi2Component)inst;");
  lines.push("}");
  lines.push("");

  // Emit ExternalObject constructor calls right after fmi2Instantiate
  if (dae.externalObjects.length > 0) {
    lines.push("/* --- ExternalObject constructor stubs --- */");
    for (let ei = 0; ei < dae.externalObjects.length; ei++) {
      const eo = dae.externalObjects[ei];
      if (!eo) continue;
      lines.push(`/* TODO: inst->extObj_${ei} = ${sanitizeIdentifier(eo.constructorName)}(...); */`);
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
  lines.push("fmi2Status fmi2EnterInitializationMode(fmi2Component c) { (void)c; return fmi2OK; }");
  lines.push("fmi2Status fmi2ExitInitializationMode(fmi2Component c) { (void)c; return fmi2OK; }");
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
  lines.push("  for (size_t i = 0; i < nx && i < N_STATES; i++) derivatives[i] = inst->model.derivatives[i];");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");
  lines.push("fmi2Status fmi2GetContinuousStates(fmi2Component c, fmi2Real x[], size_t nx) {");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");

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

  // ── Static worker function for async co-simulation ──
  lines.push("/* --- Async Co-Simulation worker --- */");
  lines.push("static void doStep_sync(FMUInstance* inst) {");
  lines.push("  double t = inst->asyncCurrentT;");
  lines.push("  double tEnd = inst->asyncTEnd;");
  lines.push("  double h = inst->stepSize;");
  lines.push("  if (h <= 0) h = 0.001;");
  lines.push("");

  // ── RK4 helper function ──
  lines.push(
    `static void take_rk4_step(${id}_Instance* m, double t, double h, const double* states0, double* statesOut) {`,
  );
  lines.push("  double k1[N_STATES + 1], k2[N_STATES + 1], k3[N_STATES + 1], k4[N_STATES + 1];");
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

  // ── Static worker function for async co-simulation ──
  lines.push("/* --- Async Co-Simulation worker --- */");
  lines.push("static void doStep_sync(FMUInstance* inst) {");
  lines.push("  double t = inst->asyncCurrentT;");
  lines.push("  double tEnd = inst->asyncTEnd;");
  lines.push("  double h = inst->stepSize;");
  lines.push("  if (h <= 0) h = 0.001;");
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

      if (transitions.length > 0) {
        lines.push(`  /* SM ${si}: ${sm.name} */`);
        let first = true;
        for (const tr of transitions) {
          const fromIdx = stateNames.indexOf(tr.fromState);
          const toIdx = stateNames.indexOf(tr.toState);
          if (fromIdx < 0 || toIdx < 0) continue;
          const prefix = first ? "if" : "else if";
          first = false;
          lines.push(
            `  ${prefix} (inst->activeState_${si} == ${fromIdx}) { /* ${tr.fromState} -> ${tr.toState}, priority ${tr.priority} */`,
          );
          lines.push(`    /* TODO: evaluate condition and set inst->activeState_${si} = ${toIdx}; */`);
          lines.push("  }");
        }
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

  lines.push("  while (t < tEnd - 1e-15 && !inst->cancelRequested) {");
  lines.push("    double step_h = h;");
  lines.push("    if (t + step_h > tEnd) step_h = tEnd - t;");
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
    lines.push("      /* Bisection root finding */");
    lines.push("      double h_left = 0, h_right = step_h;");
    lines.push("      for (int iter = 0; iter < 10; iter++) {");
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
    lines.push("      fmi2EventInfo eventInfo;");
    lines.push("      fmi2NewDiscreteStates((fmi2Component)inst, &eventInfo);");
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
  // ExternalObject destructor stubs
  if (dae.externalObjects.length > 0) {
    lines.push("  /* ExternalObject destructors */");
    for (let ei = 0; ei < dae.externalObjects.length; ei++) {
      const eo = dae.externalObjects[ei];
      if (!eo) continue;
      lines.push(`  /* TODO: ${sanitizeIdentifier(eo.destructorName)}(inst->extObj_${ei}); */`);
    }
  }
  lines.push("  free(inst);");
  lines.push("}");
  lines.push("");

  // ── Stubs for remaining FMI 2.0 functions ──
  lines.push("/* --- Stubs --- */");
  lines.push("fmi2Status fmi2Reset(fmi2Component c) { (void)c; return fmi2OK; }");

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
          }
        }
        lines.push("  }");
        lines.push(`  inst->model.whenPrev[${whenIdx}] = ${condElseC};`);
        whenIdx++;
      }
    }
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
  lines.push("  (void)c; (void)vr; (void)nvr; (void)order; (void)value;");
  lines.push("  /* Store input derivatives for higher-order interpolation */");
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
    for (const sv of result.scalarVariables) {
      if (sv.causality === "independent") continue;
      const cName = varToC(sv.name);
      lines.push(`  double ${cName} = inst->model.vars[${sv.valueReference}];`);
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

function generateCMakeLists(id: string): string {
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
)

target_include_directories(${id} PRIVATE \${CMAKE_CURRENT_SOURCE_DIR})

# Export FMI symbols, hide everything else
set_target_properties(${id} PROPERTIES
  PREFIX ""
  C_VISIBILITY_PRESET hidden
  POSITION_INDEPENDENT_CODE ON
)

if(MSVC)
  target_compile_definitions(${id} PRIVATE FMI2_FUNCTION_PREFIX=)
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
