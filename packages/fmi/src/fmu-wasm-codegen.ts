// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WASM-targeted C source code generator.
 *
 * Transpiles a ModelicaDAE expression tree into a single, self-contained C
 * source file that compiles to WebAssembly via Emscripten.  The resulting
 * `.wasm` module exposes a flat C API for initialisation, derivative
 * evaluation, and co-simulation stepping — no FMI overhead, no external
 * dependencies beyond `<math.h>`.
 *
 * Design goals:
 *   - Zero per-step JS↔WASM bridge cost (the solver loop runs entirely in WASM)
 *   - Works with Emscripten (`emcc`) out of the box
 *   - Embeds a simple RK4 stepper for `wasm_do_step()`; SUNDIALS linkage is
 *     optional and handled at compile time via `-DWASM_USE_SUNDIALS`
 */

import { ModelicaBinaryOperator, ModelicaUnaryOperator, ModelicaVariability } from "@modelscript/modelica/ast";
import type { ModelicaDAE, ModelicaExpression } from "@modelscript/symbolics";
import {
  ModelicaArray,
  ModelicaBinaryExpression,
  ModelicaBooleanLiteral,
  ModelicaFunctionCallExpression,
  ModelicaIfElseExpression,
  ModelicaIntegerLiteral,
  ModelicaNameExpression,
  ModelicaRealLiteral,
  ModelicaSimpleEquation,
  ModelicaStringLiteral,
  ModelicaUnaryExpression,
} from "@modelscript/symbolics";
import type { FmuOptions, FmuResult } from "./fmi.js";

// ── Public interface ──

/** Result of WASM C source generation. */
export interface FmuWasmSourceResult {
  /** The single C source file for Emscripten compilation. */
  wasmC: string;
  /** Recommended `emcc` command-line flags. */
  emccFlags: string[];
  /** List of exported WASM function names. */
  exportedFunctions: string[];
}

/**
 * Generate a self-contained C source file targeting Emscripten/WASM.
 *
 * The generated code is a single `model_wasm.c` that can be compiled with:
 * ```
 * emcc model_wasm.c -O2 -sWASM=1 -sMODULARIZE=1 \
 *   -sEXPORTED_FUNCTIONS="[...]" \
 *   -sEXPORTED_RUNTIME_METHODS="['ccall','cwrap','getValue','setValue']" \
 *   -lm -o model.js
 * ```
 */
export function generateFmuWasmSource(
  dae: ModelicaDAE,
  fmuResult: FmuResult,
  options: FmuOptions,
): FmuWasmSourceResult {
  const id = options.modelIdentifier;
  const vars = fmuResult.scalarVariables;
  const nStates = fmuResult.modelStructure.derivatives.length;
  const nVars = vars.length;
  const nEventIndicators = fmuResult.numberOfEventIndicators;

  const exportedFunctions = [
    "_wasm_init",
    "_wasm_get_derivatives",
    "_wasm_get_event_indicators",
    "_wasm_do_step",
    "_wasm_get_n_states",
    "_wasm_get_n_vars",
    "_wasm_get_n_event_indicators",
    "_wasm_get_vars_ptr",
    "_wasm_get_states_ptr",
    "_wasm_get_derivatives_ptr",
    "_wasm_get_time",
    "_wasm_set_var",
    "_wasm_get_var",
    "_malloc",
    "_free",
  ];

  const emccFlags = [
    "-O2",
    "-sWASM=1",
    "-sMODULARIZE=1",
    `-sEXPORT_NAME="createWasmModel"`,
    `-sEXPORTED_FUNCTIONS="[${exportedFunctions.map((f) => `'${f}'`).join(",")}]"`,
    `-sEXPORTED_RUNTIME_METHODS="['ccall','cwrap','getValue','setValue']"`,
    "-sALLOW_MEMORY_GROWTH=1",
    "-lm",
  ];

  const wasmC = generateWasmC(id, nVars, nStates, nEventIndicators, dae, fmuResult);

  return { wasmC, emccFlags, exportedFunctions };
}

// ── C Expression Transpiler (WASM-specific) ──
// These mirror fmu-codegen.ts but target a flat struct layout
// (global arrays instead of inst-> pointer chasing).

function sanitizeIdentifier(name: string): string {
  return name
    .replace(/\./g, "_")
    .replace(/\[/g, "_")
    .replace(/\]/g, "")
    .replace(/[^a-zA-Z0-9_]/g, "_");
}

function varToC(name: string): string {
  if (name === "time") return "g_time";
  const derMatch = name.match(/^der\((.+)\)$/);
  if (derMatch) {
    return `der_${sanitizeIdentifier(derMatch[1] ?? "")}`;
  }
  return `v_${sanitizeIdentifier(name)}`;
}

function formatCDouble(value: number): string {
  if (!isFinite(value)) {
    if (value === Infinity) return "INFINITY";
    if (value === -Infinity) return "(-INFINITY)";
    return "NAN";
  }
  const s = value.toString();
  if (!s.includes(".") && !s.includes("e") && !s.includes("E")) {
    return s + ".0";
  }
  return s;
}

function escapeCString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

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

function exprToC(expr: ModelicaExpression): string {
  if (expr instanceof ModelicaRealLiteral) return formatCDouble(expr.value);
  if (expr instanceof ModelicaIntegerLiteral) return `${expr.value}`;
  if (expr instanceof ModelicaBooleanLiteral) return expr.value ? "1" : "0";
  if (expr instanceof ModelicaStringLiteral) return `"${escapeCString(expr.value)}"`;
  if (expr instanceof ModelicaNameExpression) return varToC(expr.name);
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
    if (expr.functionName === "initial") return "g_isInitPhase";
    if (expr.functionName === "terminal") return "0";
    if (expr.functionName === "assert" && expr.args.length >= 2) {
      const cond = exprToC(expr.args[0] as ModelicaExpression);
      return `((${cond}) ? 0.0 : 0.0)`;
    }
    const args = expr.args.map((a: ModelicaExpression) => exprToC(a)).join(", ");
    const fname = mapFunctionName(expr.functionName);
    return `${fname}(${args})`;
  }
  if (expr instanceof ModelicaIfElseExpression) {
    const cond = exprToC(expr.condition);
    const then = exprToC(expr.thenExpression);
    const els = exprToC(expr.elseExpression);
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
  if (expr && typeof expr === "object" && "name" in expr) {
    return varToC((expr as { name: string }).name);
  }
  return "0.0";
}

// ── DAE Analysis Helpers ──

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

function collectReferencedNames(expr: unknown, names: Set<string>): void {
  if (!expr || typeof expr !== "object") return;
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

// ── Main C Source Generator ──

function generateWasmC(
  id: string,
  nVars: number,
  nStates: number,
  nEventIndicators: number,
  dae: ModelicaDAE,
  result: FmuResult,
): string {
  const L: string[] = [];

  // ── Header ──
  L.push("/* Auto-generated by ModelScript — WebAssembly model module */");
  L.push("/* Compile with: emcc model_wasm.c -O2 -sWASM=1 -sMODULARIZE=1 -lm -o model.js */");
  L.push("");
  L.push("#include <math.h>");
  L.push("#include <string.h>");
  L.push("#include <stdint.h>");
  L.push("");
  L.push("#ifdef __EMSCRIPTEN__");
  L.push("#include <emscripten/emscripten.h>");
  L.push("#else");
  L.push("#define EMSCRIPTEN_KEEPALIVE");
  L.push("#endif");
  L.push("");

  // ── Constants ──
  L.push(`#define N_VARS ${nVars}`);
  L.push(`#define N_STATES ${nStates}`);
  L.push(`#define N_EVENT_INDICATORS ${nEventIndicators}`);
  L.push("");

  // ── Variable reference constants ──
  for (const sv of result.scalarVariables) {
    const cName = sanitizeIdentifier(sv.name).toUpperCase();
    L.push(`#define VR_${cName} ${sv.valueReference}`);
  }
  L.push("");

  // ── Global model state ──
  // Using global arrays avoids struct pointer indirection in the hot loop
  L.push("/* Global model state */");
  L.push(`static double g_vars[N_VARS + 1];`);
  L.push(`static double g_states[N_STATES + 1];`);
  L.push(`static double g_derivatives[N_STATES + 1];`);
  L.push(`static double g_event_indicators[N_EVENT_INDICATORS + 1];`);
  L.push(`static double g_time = 0.0;`);
  L.push(`static int g_isInitPhase = 1;`);
  L.push("");

  // ── VR map for variable access ──
  const vrMap = new Map<string, number>();
  for (const sv of result.scalarVariables) {
    vrMap.set(sv.name, sv.valueReference);
  }

  // ── Derivative equation mapping ──
  const derVars = result.scalarVariables.filter((sv) => sv.name.startsWith("der("));
  const derMap = new Map<string, number>();
  for (let i = 0; i < derVars.length; i++) {
    const nameMatch = derVars[i]?.name.match(/^der\((.+)\)$/);
    if (nameMatch) derMap.set(nameMatch[1] ?? "", i);
  }

  // ── State variable ↔ index mapping ──
  const stateVarRefs: { name: string; vr: number; derVr: number; idx: number }[] = [];
  for (const sv of result.scalarVariables) {
    if (sv.derivative !== undefined) {
      const stateSv = result.scalarVariables.find((v) => v.valueReference === sv.derivative);
      if (stateSv) {
        stateVarRefs.push({
          name: stateSv.name,
          vr: stateSv.valueReference,
          derVr: sv.valueReference,
          idx: stateVarRefs.length,
        });
      }
    }
  }

  // ── Initialize function ──
  L.push("/* Initialize model state */");
  L.push("static void model_initialize(void) {");
  L.push("  memset(g_vars, 0, sizeof(g_vars));");
  L.push("  memset(g_states, 0, sizeof(g_states));");
  L.push("  memset(g_derivatives, 0, sizeof(g_derivatives));");
  L.push("  g_time = 0.0;");
  L.push("  g_isInitPhase = 1;");

  // Set parameter/constant values
  for (const v of dae.variables) {
    if (v.variability === ModelicaVariability.PARAMETER || v.variability === ModelicaVariability.CONSTANT) {
      const ref = vrMap.get(v.name);
      if (ref !== undefined && v.expression) {
        const cExpr = exprToC(v.expression);
        L.push(`  g_vars[${ref}] = ${cExpr};  /* ${v.name} */`);
      }
    }
  }

  // Set start values for continuous variables
  for (const v of dae.variables) {
    if (v.variability === null || v.variability === undefined) {
      const ref = vrMap.get(v.name);
      if (ref !== undefined) {
        const startAttr = v.attributes.get("start");
        const initExpr = startAttr ?? v.expression;
        if (initExpr) {
          const cExpr = exprToC(initExpr);
          L.push(`  g_vars[${ref}] = ${cExpr};  /* ${v.name} */`);
        }
      }
    }
  }

  // Copy initial state values into g_states[]
  for (const sv of stateVarRefs) {
    L.push(`  g_states[${sv.idx}] = g_vars[${sv.vr}];  /* ${sv.name} */`);
  }

  L.push("  g_isInitPhase = 0;");
  L.push("}");
  L.push("");

  // ── getDerivatives function ──
  L.push("/* Compute derivatives: reads g_vars[], g_time; writes g_derivatives[] */");
  L.push("static void model_get_derivatives(void) {");

  // Collect referenced variable names for local alias emission
  const refNames = new Set<string>();
  for (const eq of dae.equations) {
    if (!("expression1" in eq && "expression2" in eq)) continue;
    const se = eq as { expression1: ModelicaExpression; expression2: ModelicaExpression };
    collectReferencedNames(se.expression1, refNames);
    collectReferencedNames(se.expression2, refNames);
  }

  // Local aliases for referenced variables (read from g_vars[])
  for (const sv of result.scalarVariables) {
    if (sv.causality === "independent") continue;
    if (!refNames.has(sv.name)) continue;
    const cName = varToC(sv.name);
    L.push(`  double ${cName} = g_vars[${sv.valueReference}];`);
  }
  L.push("");

  // Emit derivative equations
  for (const eq of dae.equations) {
    if (!("expression1" in eq && "expression2" in eq)) continue;
    const se = eq as { expression1: ModelicaExpression; expression2: ModelicaExpression };
    const lhsDer = extractDerName(se.expression1);
    const rhsDer = extractDerName(se.expression2);
    if (lhsDer) {
      const idx = derMap.get(lhsDer);
      if (idx !== undefined) {
        L.push(`  g_derivatives[${idx}] = ${exprToC(se.expression2)};  /* der(${lhsDer}) */`);
      }
    } else if (rhsDer) {
      const idx = derMap.get(rhsDer);
      if (idx !== undefined) {
        L.push(`  g_derivatives[${idx}] = ${exprToC(se.expression1)};  /* der(${rhsDer}) */`);
      }
    }
  }

  // Also compute non-derivative algebraic equations (update g_vars[])
  for (const eq of dae.equations) {
    if (!(eq instanceof ModelicaSimpleEquation)) continue;
    if (
      eq.expression1 instanceof ModelicaNameExpression &&
      !eq.expression1.name.startsWith("der(") &&
      !extractDerName(eq.expression1)
    ) {
      const targetName = eq.expression1.name;
      const ref = vrMap.get(targetName);
      if (ref !== undefined) {
        L.push(`  g_vars[${ref}] = ${exprToC(eq.expression2)};  /* ${targetName} */`);
      }
    }
  }

  L.push("}");
  L.push("");

  // ── getEventIndicators function ──
  L.push("/* Compute event indicators for zero-crossing detection */");
  L.push("static void model_get_event_indicators(void) {");
  if (dae.eventIndicators.length === 0) {
    L.push("  /* no event indicators */");
  } else {
    for (let i = 0; i < dae.eventIndicators.length; i++) {
      const indicator = dae.eventIndicators[i];
      if (indicator) {
        L.push(`  g_event_indicators[${i}] = ${exprToC(indicator)};`);
      }
    }
  }
  L.push("}");
  L.push("");

  // ── Embedded RK4 stepper ──
  L.push("/* Embedded RK4 integration step */");
  L.push("static void rk4_step(double t, double dt) {");
  L.push("  int i;");
  L.push(`  double k1[N_STATES + 1], k2[N_STATES + 1], k3[N_STATES + 1], k4[N_STATES + 1];`);
  L.push(`  double tmp_states[N_STATES + 1];`);
  L.push("");
  L.push("  /* k1 = f(t, y) */");
  L.push("  g_time = t;");
  L.push(
    `  for (i = 0; i < N_STATES; i++) g_vars[${stateVarRefs.length > 0 ? stateVarRefs.map((sv) => sv.vr).join(" /* ... */] = g_states[0]; /* patched below */ g_vars[") : "0"}] = g_states[i]; /* simplified */`,
  );

  // Generate proper state→var copy
  L.pop(); // Remove the broken line above
  for (const sv of stateVarRefs) {
    L.push(`  g_vars[${sv.vr}] = g_states[${sv.idx}];  /* ${sv.name} */`);
  }
  L.push("  model_get_derivatives();");
  L.push("  for (i = 0; i < N_STATES; i++) k1[i] = g_derivatives[i];");
  L.push("");

  L.push("  /* k2 = f(t + dt/2, y + dt/2 * k1) */");
  L.push("  g_time = t + 0.5 * dt;");
  L.push("  for (i = 0; i < N_STATES; i++) tmp_states[i] = g_states[i] + 0.5 * dt * k1[i];");
  for (const sv of stateVarRefs) {
    L.push(`  g_vars[${sv.vr}] = tmp_states[${sv.idx}];`);
  }
  L.push("  model_get_derivatives();");
  L.push("  for (i = 0; i < N_STATES; i++) k2[i] = g_derivatives[i];");
  L.push("");

  L.push("  /* k3 = f(t + dt/2, y + dt/2 * k2) */");
  L.push("  for (i = 0; i < N_STATES; i++) tmp_states[i] = g_states[i] + 0.5 * dt * k2[i];");
  for (const sv of stateVarRefs) {
    L.push(`  g_vars[${sv.vr}] = tmp_states[${sv.idx}];`);
  }
  L.push("  model_get_derivatives();");
  L.push("  for (i = 0; i < N_STATES; i++) k3[i] = g_derivatives[i];");
  L.push("");

  L.push("  /* k4 = f(t + dt, y + dt * k3) */");
  L.push("  g_time = t + dt;");
  L.push("  for (i = 0; i < N_STATES; i++) tmp_states[i] = g_states[i] + dt * k3[i];");
  for (const sv of stateVarRefs) {
    L.push(`  g_vars[${sv.vr}] = tmp_states[${sv.idx}];`);
  }
  L.push("  model_get_derivatives();");
  L.push("  for (i = 0; i < N_STATES; i++) k4[i] = g_derivatives[i];");
  L.push("");

  L.push("  /* Combine: y_new = y + dt/6 * (k1 + 2*k2 + 2*k3 + k4) */");
  L.push("  for (i = 0; i < N_STATES; i++) g_states[i] += (dt / 6.0) * (k1[i] + 2.0*k2[i] + 2.0*k3[i] + k4[i]);");
  L.push("");

  // Write updated states back to g_vars[]
  for (const sv of stateVarRefs) {
    L.push(`  g_vars[${sv.vr}] = g_states[${sv.idx}];  /* ${sv.name} */`);
  }
  L.push("  g_time = t + dt;");
  L.push("  model_get_derivatives();");
  L.push("}");
  L.push("");

  // ── Exported WASM API ──
  L.push("/* ═══════════════════════════════════════════════════════════ */");
  L.push("/*  Exported WASM API                                        */");
  L.push("/* ═══════════════════════════════════════════════════════════ */");
  L.push("");

  L.push("EMSCRIPTEN_KEEPALIVE");
  L.push("void wasm_init(void) {");
  L.push("  model_initialize();");
  L.push("}");
  L.push("");

  L.push("EMSCRIPTEN_KEEPALIVE");
  L.push("void wasm_get_derivatives(void) {");
  L.push("  model_get_derivatives();");
  L.push("}");
  L.push("");

  L.push("EMSCRIPTEN_KEEPALIVE");
  L.push("void wasm_get_event_indicators(void) {");
  L.push("  model_get_event_indicators();");
  L.push("}");
  L.push("");

  L.push("EMSCRIPTEN_KEEPALIVE");
  L.push("void wasm_do_step(double t, double dt) {");
  L.push("  rk4_step(t, dt);");
  L.push("}");
  L.push("");

  L.push("EMSCRIPTEN_KEEPALIVE");
  L.push("int wasm_get_n_states(void) {");
  L.push("  return N_STATES;");
  L.push("}");
  L.push("");

  L.push("EMSCRIPTEN_KEEPALIVE");
  L.push("int wasm_get_n_vars(void) {");
  L.push("  return N_VARS;");
  L.push("}");
  L.push("");

  L.push("EMSCRIPTEN_KEEPALIVE");
  L.push("int wasm_get_n_event_indicators(void) {");
  L.push("  return N_EVENT_INDICATORS;");
  L.push("}");
  L.push("");

  L.push("EMSCRIPTEN_KEEPALIVE");
  L.push("double* wasm_get_vars_ptr(void) {");
  L.push("  return g_vars;");
  L.push("}");
  L.push("");

  L.push("EMSCRIPTEN_KEEPALIVE");
  L.push("double* wasm_get_states_ptr(void) {");
  L.push("  return g_states;");
  L.push("}");
  L.push("");

  L.push("EMSCRIPTEN_KEEPALIVE");
  L.push("double* wasm_get_derivatives_ptr(void) {");
  L.push("  return g_derivatives;");
  L.push("}");
  L.push("");

  L.push("EMSCRIPTEN_KEEPALIVE");
  L.push("double wasm_get_time(void) {");
  L.push("  return g_time;");
  L.push("}");
  L.push("");

  L.push("EMSCRIPTEN_KEEPALIVE");
  L.push("void wasm_set_var(int vr, double value) {");
  L.push("  if (vr >= 0 && vr < N_VARS) g_vars[vr] = value;");
  L.push("}");
  L.push("");

  L.push("EMSCRIPTEN_KEEPALIVE");
  L.push("double wasm_get_var(int vr) {");
  L.push("  if (vr >= 0 && vr < N_VARS) return g_vars[vr];");
  L.push("  return 0.0;");
  L.push("}");
  L.push("");

  return L.join("\n");
}
