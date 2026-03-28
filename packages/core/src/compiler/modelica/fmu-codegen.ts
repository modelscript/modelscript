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
  ModelicaStringLiteral,
  ModelicaUnaryExpression,
} from "./dae.js";
import type { FmuOptions, FmuResult } from "./fmi.js";
import { ModelicaBinaryOperator, ModelicaUnaryOperator, ModelicaVariability } from "./syntax.js";

/** Generated C source files. */
export interface FmuCSourceFiles {
  /** model.h — variable declarations. */
  modelH: string;
  /** model.c — equation evaluation. */
  modelC: string;
  /** fmi2Functions.c — FMI 2.0 API wrapper. */
  fmi2FunctionsC: string;
}

/**
 * Generate FMI 2.0 C source files from a DAE and FMU result.
 */
export function generateFmuCSources(dae: ModelicaDAE, fmuResult: FmuResult, options: FmuOptions): FmuCSourceFiles {
  const id = options.modelIdentifier;
  const vars = fmuResult.scalarVariables;
  const nStates = fmuResult.modelStructure.derivatives.length;
  const nVars = vars.length;

  // ── model.h ──
  const modelH = generateModelH(id, nVars, nStates, fmuResult);

  // ── model.c ──
  const modelC = generateModelC(id, dae, fmuResult);

  // ── fmi2Functions.c ──
  const fmi2FunctionsC = generateFmi2FunctionsC(id, nVars, nStates, fmuResult);

  return { modelH, modelC, fmi2FunctionsC };
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

// ── File generators ──

function generateModelH(id: string, nVars: number, nStates: number, result: FmuResult): string {
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
  lines.push(`#define N_EVENT_INDICATORS ${result.numberOfEventIndicators}`);
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
  lines.push("  double time;");
  lines.push("  int isDirtyValues;");
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
  // Set start values for continuous variables
  for (const v of dae.variables) {
    if (v.variability === null || v.variability === undefined) {
      const ref = vrMap.get(v.name);
      if (ref !== undefined && v.expression) {
        const cExpr = exprToC(v.expression);
        lines.push(`  inst->vars[${ref}] = ${cExpr};  /* ${v.name} */`);
      }
    }
  }
  lines.push("}");
  lines.push("");

  // ── getDerivatives function ──
  lines.push(`void ${id}_getDerivatives(${id}_Instance* inst) {`);
  lines.push("  double time = inst->time;");

  // Create local aliases for readability
  for (const sv of result.scalarVariables) {
    if (sv.causality === "independent") continue;
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

  // ── getEventIndicators function (stub) ──
  lines.push(`void ${id}_getEventIndicators(${id}_Instance* inst, double* indicators) {`);
  lines.push("  (void)inst; (void)indicators;");
  lines.push("  /* No event indicators yet */");
  lines.push("}");

  return lines.join("\n");
}

function generateFmi2FunctionsC(id: string, nVars: number, nStates: number, result: FmuResult): string {
  const lines: string[] = [];
  lines.push("/* Auto-generated by ModelScript — FMI 2.0 API implementation */");
  lines.push(`#include "${id}_model.h"`);
  lines.push('#include "fmi2Functions.h"');
  lines.push("#include <stdlib.h>");
  lines.push("#include <string.h>");
  lines.push("#include <stdio.h>");
  lines.push("");
  lines.push("typedef struct {");
  lines.push(`  ${id}_Instance model;`);
  lines.push("  fmi2String instanceName;");
  lines.push("  fmi2CallbackFunctions callbacks;");
  lines.push("  fmi2Boolean loggingOn;");
  lines.push("  double startTime;");
  lines.push("  double stopTime;");
  lines.push("  double stepSize;");
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

  // ── Co-Simulation: fmi2DoStep ──
  lines.push("/* --- Co-Simulation --- */");
  lines.push("fmi2Status fmi2DoStep(fmi2Component c, fmi2Real currentCommunicationPoint,");
  lines.push("    fmi2Real communicationStepSize, fmi2Boolean noSetFMUStatePriorToCurrentPoint) {");
  lines.push("  (void)noSetFMUStatePriorToCurrentPoint;");
  lines.push("  FMUInstance* inst = (FMUInstance*)c;");
  lines.push("  double t = currentCommunicationPoint;");
  lines.push("  double tEnd = t + communicationStepSize;");
  lines.push("  double h = inst->stepSize;");
  lines.push("  if (h <= 0) h = 0.001;");
  lines.push("");
  lines.push("  /* Fixed-step RK4 integration */");
  lines.push("  while (t < tEnd - 1e-15) {");
  lines.push("    if (t + h > tEnd) h = tEnd - t;");
  lines.push("    double states[N_STATES + 1];");
  lines.push("    double k1[N_STATES + 1], k2[N_STATES + 1], k3[N_STATES + 1], k4[N_STATES + 1];");
  lines.push("");

  // Save states
  for (let i = 0; i < stateRefs2.length; i++) {
    lines.push(`    states[${i}] = inst->model.vars[${stateRefs2[i]}];`);
  }
  lines.push("");

  // k1
  lines.push("    inst->model.time = t;");
  lines.push(`    ${id}_getDerivatives(&inst->model);`);
  lines.push("    for (int i = 0; i < N_STATES; i++) k1[i] = inst->model.derivatives[i];");
  lines.push("");

  // k2
  lines.push("    inst->model.time = t + 0.5 * h;");
  for (let i = 0; i < stateRefs2.length; i++) {
    lines.push(`    inst->model.vars[${stateRefs2[i]}] = states[${i}] + 0.5 * h * k1[${i}];`);
  }
  lines.push(`    ${id}_getDerivatives(&inst->model);`);
  lines.push("    for (int i = 0; i < N_STATES; i++) k2[i] = inst->model.derivatives[i];");
  lines.push("");

  // k3
  for (let i = 0; i < stateRefs2.length; i++) {
    lines.push(`    inst->model.vars[${stateRefs2[i]}] = states[${i}] + 0.5 * h * k2[${i}];`);
  }
  lines.push(`    ${id}_getDerivatives(&inst->model);`);
  lines.push("    for (int i = 0; i < N_STATES; i++) k3[i] = inst->model.derivatives[i];");
  lines.push("");

  // k4
  lines.push("    inst->model.time = t + h;");
  for (let i = 0; i < stateRefs2.length; i++) {
    lines.push(`    inst->model.vars[${stateRefs2[i]}] = states[${i}] + h * k3[${i}];`);
  }
  lines.push(`    ${id}_getDerivatives(&inst->model);`);
  lines.push("    for (int i = 0; i < N_STATES; i++) k4[i] = inst->model.derivatives[i];");
  lines.push("");

  // Update
  for (let i = 0; i < stateRefs2.length; i++) {
    lines.push(
      `    inst->model.vars[${stateRefs2[i]}] = states[${i}] + (h / 6.0) * (k1[${i}] + 2.0*k2[${i}] + 2.0*k3[${i}] + k4[${i}]);`,
    );
  }
  lines.push("    t += h;");
  lines.push("  }");
  lines.push("  inst->model.time = tEnd;");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");

  // ── Terminate / FreeInstance ──
  lines.push("fmi2Status fmi2Terminate(fmi2Component c) { (void)c; return fmi2OK; }");
  lines.push("void fmi2FreeInstance(fmi2Component c) { free(c); }");
  lines.push("");

  // ── Stubs for remaining FMI 2.0 functions ──
  lines.push("/* --- Stubs --- */");
  lines.push("fmi2Status fmi2Reset(fmi2Component c) { (void)c; return fmi2OK; }");
  lines.push(
    "fmi2Status fmi2SetString(fmi2Component c, const fmi2ValueReference vr[], size_t nvr, const fmi2String value[]) { (void)c; (void)vr; (void)nvr; (void)value; return fmi2OK; }",
  );
  lines.push(
    "fmi2Status fmi2GetString(fmi2Component c, const fmi2ValueReference vr[], size_t nvr, fmi2String value[]) { (void)c; (void)vr; (void)nvr; (void)value; return fmi2OK; }",
  );
  lines.push(
    "fmi2Status fmi2GetNominalsOfContinuousStates(fmi2Component c, fmi2Real nominals[], size_t nx) { for (size_t i = 0; i < nx; i++) nominals[i] = 1.0; (void)c; return fmi2OK; }",
  );
  lines.push(
    "fmi2Status fmi2NewDiscreteStates(fmi2Component c, fmi2EventInfo* info) { info->newDiscreteStatesNeeded = fmi2False; info->terminateSimulation = fmi2False; info->nominalsOfContinuousStatesChanged = fmi2False; info->valuesOfContinuousStatesChanged = fmi2False; info->nextEventTimeDefined = fmi2False; (void)c; return fmi2OK; }",
  );
  lines.push("fmi2Status fmi2EnterContinuousTimeMode(fmi2Component c) { (void)c; return fmi2OK; }");
  lines.push("fmi2Status fmi2EnterEventMode(fmi2Component c) { (void)c; return fmi2OK; }");
  lines.push("fmi2Status fmi2CancelStep(fmi2Component c) { (void)c; return fmi2OK; }");
  lines.push(
    "fmi2Status fmi2GetStatus(fmi2Component c, const fmi2StatusKind s, fmi2Status* value) { (void)c; (void)s; *value = fmi2OK; return fmi2OK; }",
  );
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
  lines.push(
    "fmi2Status fmi2SetDebugLogging(fmi2Component c, fmi2Boolean loggingOn, size_t nCategories, const fmi2String categories[]) { (void)c; (void)loggingOn; (void)nCategories; (void)categories; return fmi2OK; }",
  );
  lines.push(
    "fmi2Status fmi2GetFMUstate(fmi2Component c, fmi2FMUstate* state) { (void)c; (void)state; return fmi2Error; }",
  );
  lines.push(
    "fmi2Status fmi2SetFMUstate(fmi2Component c, fmi2FMUstate state) { (void)c; (void)state; return fmi2Error; }",
  );
  lines.push(
    "fmi2Status fmi2FreeFMUstate(fmi2Component c, fmi2FMUstate* state) { (void)c; (void)state; return fmi2Error; }",
  );
  lines.push(
    "fmi2Status fmi2SerializedFMUstateSize(fmi2Component c, fmi2FMUstate state, size_t* size) { (void)c; (void)state; (void)size; return fmi2Error; }",
  );
  lines.push(
    "fmi2Status fmi2SerializeFMUstate(fmi2Component c, fmi2FMUstate state, fmi2Byte buf[], size_t size) { (void)c; (void)state; (void)buf; (void)size; return fmi2Error; }",
  );
  lines.push(
    "fmi2Status fmi2DeSerializeFMUstate(fmi2Component c, const fmi2Byte buf[], size_t size, fmi2FMUstate* state) { (void)c; (void)buf; (void)size; (void)state; return fmi2Error; }",
  );
  lines.push(
    "fmi2Status fmi2GetDirectionalDerivative(fmi2Component c, const fmi2ValueReference unknown[], size_t nUnknown, const fmi2ValueReference known[], size_t nKnown, const fmi2Real dvKnown[], fmi2Real dvUnknown[]) { (void)c; (void)unknown; (void)nUnknown; (void)known; (void)nKnown; (void)dvKnown; (void)dvUnknown; return fmi2Error; }",
  );
  lines.push("");

  return lines.join("\n");
}

// ── Helper: extract der(x) name from expression ──

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
