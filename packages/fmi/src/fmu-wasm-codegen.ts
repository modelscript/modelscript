// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WASM-targeted C source code generator.
 *
 * Transpiles an ArenaDAEBuilder expression tree into a single, self-contained C
 * source file that compiles to WebAssembly via Emscripten.
 */

import { type ArenaDAEBuilder, BinOp, EqKind, ExprKind, UnaryOp, Variability } from "@modelscript/compiler";

import type { FmuOptions, FmuResult } from "./fmi.js";
import { binaryOpToC, escapeCString, formatCDouble, mapFunctionName, sanitizeIdentifier } from "./transpiler-utils.js";

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
 */
export function generateFmuWasmSource(
  dae: ArenaDAEBuilder,
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

function varToC(name: string): string {
  if (name === "time") return "g_time";
  const derMatch = name.match(/^der\((.+)\)$/);
  if (derMatch) {
    return `der_${sanitizeIdentifier(derMatch[1] ?? "")}`;
  }
  return `v_${sanitizeIdentifier(name)}`;
}

function exprToC(dae: ArenaDAEBuilder, id: number): string {
  if (id < 0) return "0.0";
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
      const op = uop === UnaryOp.Negate ? "-" : "!";
      return `(${op}${exprToC(dae, dae.getExprLeft(id))})`;
    }
    case ExprKind.Negate:
      return `(-${exprToC(dae, dae.getExprLeft(id))})`;
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
      if (fname === "initial") return "g_isInitPhase";
      if (fname === "terminal") return "0";
      if (fname === "assert" && argCount >= 2) {
        const cond = exprToC(dae, dae.getExprLeft(id));
        return `((${cond}) ? 0.0 : 0.0)`;
      }
      const args: string[] = [];
      for (let i = 0; i < argCount; i++) {
        args.push(exprToC(dae, dae.getExprLeft(id + i)));
      }
      const mappedName = mapFunctionName(fname);
      return `${mappedName}(${args.join(", ")})`;
    }
    case ExprKind.IfElse: {
      const cond = exprToC(dae, dae.getExprData1(id));
      const then = exprToC(dae, dae.getExprLeft(id));
      const els = exprToC(dae, dae.getExprRight(id));
      return `(${cond} ? ${then} : ${els})`;
    }
    default:
      return "0.0";
  }
}

// ── DAE Analysis Helpers ──

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

function extractAssignmentTarget(dae: ArenaDAEBuilder, id: number): string | null {
  if (id >= 0 && dae.getExprKind(id) === ExprKind.Name) {
    return dae.interner.resolve(dae.getExprData1(id));
  }
  return null;
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
    case ExprKind.Der:
    case ExprKind.Pre:
      collectReferencedNames(dae, dae.getExprLeft(id), names);
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

// ── Main C Source Generator ──

function generateWasmC(
  id: string,
  nVars: number,
  nStates: number,
  nEventIndicators: number,
  dae: ArenaDAEBuilder,
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

  let nWhenConditions = 0;
  for (let idx = 0; idx < dae.eqCount; idx++) {
    if (dae.getEqKind(idx) === EqKind.When) {
      const meta = dae.getWhenEquationMeta(idx);
      if (meta) {
        nWhenConditions += 1 + meta.elseWhenClauses.length;
      }
    }
  }
  L.push(`#define N_WHEN_CONDITIONS ${nWhenConditions}`);
  L.push("");

  // ── Variable reference constants ──
  for (const sv of result.scalarVariables) {
    const cName = sanitizeIdentifier(sv.name).toUpperCase();
    L.push(`#define VR_${cName} ${sv.valueReference}`);
  }
  L.push("");

  // ── Global model state ──
  L.push("/* Global model state */");
  L.push(`static double g_vars[N_VARS + 1];`);
  L.push(`static double g_states[N_STATES + 1];`);
  L.push(`static double g_derivatives[N_STATES + 1];`);
  L.push(`static double g_event_indicators[N_EVENT_INDICATORS + 1];`);
  L.push(`static double g_when_prev[N_WHEN_CONDITIONS + 1];`);
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
  L.push("  memset(g_when_prev, 0, sizeof(g_when_prev));");
  L.push("  g_time = 0.0;");
  L.push("  g_isInitPhase = 1;");

  // Set parameter/constant values
  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;
    const vName = dae.getVarName(i);
    const variability = dae.getVarVariability(i);
    if (variability === Variability.Parameter || variability === Variability.Constant) {
      const ref = vrMap.get(vName);
      const expr = dae.getVarExpression(i);
      if (ref !== undefined && typeof expr === "number" && expr >= 0) {
        const cExpr = exprToC(dae, expr);
        L.push(`  g_vars[${ref}] = ${cExpr};  /* ${vName} */`);
      }
    }
  }

  // Set start values for continuous variables
  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;
    const vName = dae.getVarName(i);
    const variability = dae.getVarVariability(i);
    if (variability === Variability.Continuous || variability === undefined || variability === null) {
      const ref = vrMap.get(vName);
      if (ref !== undefined) {
        const startAttr = dae.getVarAttrExprId(i, "start");
        const expr = dae.getVarExpression(i);
        const initExpr = startAttr !== undefined && startAttr >= 0 ? startAttr : expr;
        if (typeof initExpr === "number" && initExpr >= 0) {
          const cExpr = exprToC(dae, initExpr);
          L.push(`  g_vars[${ref}] = ${cExpr};  /* ${vName} */`);
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
  for (let idx = 0; idx < dae.eqCount; idx++) {
    const lhs = dae.getEqLhs(idx);
    const rhs = dae.getEqRhs(idx);
    collectReferencedNames(dae, lhs, refNames);
    collectReferencedNames(dae, rhs, refNames);
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
  for (let idx = 0; idx < dae.eqCount; idx++) {
    const lhs = dae.getEqLhs(idx);
    const rhs = dae.getEqRhs(idx);
    const lhsDer = extractDerName(dae, lhs);
    const rhsDer = extractDerName(dae, rhs);
    if (lhsDer) {
      const idxDer = derMap.get(lhsDer);
      if (idxDer !== undefined) {
        L.push(`  g_derivatives[${idxDer}] = ${exprToC(dae, rhs)};  /* der(${lhsDer}) */`);
      }
    } else if (rhsDer) {
      const idxDer = derMap.get(rhsDer);
      if (idxDer !== undefined) {
        L.push(`  g_derivatives[${idxDer}] = ${exprToC(dae, lhs)};  /* der(${rhsDer}) */`);
      }
    }
  }

  // Also compute non-derivative algebraic equations (update g_vars[])
  for (let idx = 0; idx < dae.eqCount; idx++) {
    if (dae.getEqKind(idx) !== EqKind.Simple) continue;
    const lhs = dae.getEqLhs(idx);
    const rhs = dae.getEqRhs(idx);
    if (dae.getExprKind(lhs) === ExprKind.Name) {
      const targetName = dae.interner.resolve(dae.getExprData1(lhs));
      if (!targetName.startsWith("der(") && !extractDerName(dae, lhs)) {
        const ref = vrMap.get(targetName);
        if (ref !== undefined) {
          L.push(`  g_vars[${ref}] = ${exprToC(dae, rhs)};  /* ${targetName} */`);
        }
      }
    }
  }

  L.push("}");
  L.push("");

  // ── getEventIndicators function ──
  L.push("/* Compute event indicators for zero-crossing detection */");
  L.push("static void model_get_event_indicators(void) {");
  if (dae.eventIndicatorExprIds.length === 0) {
    L.push("  /* no event indicators */");
  } else {
    // Collect referenced variable names for local alias emission
    const refNames = new Set<string>();
    for (const indicator of dae.eventIndicatorExprIds) {
      if (indicator !== undefined && indicator >= 0) {
        collectReferencedNames(dae, indicator, refNames);
      }
    }

    // Local aliases for referenced variables (read from g_vars[])
    for (const sv of result.scalarVariables) {
      if (sv.causality === "independent") continue;
      if (!refNames.has(sv.name)) continue;
      const cName = varToC(sv.name);
      L.push(`  double ${cName} = g_vars[${sv.valueReference}];`);
    }
    L.push("");

    for (let i = 0; i < dae.eventIndicatorExprIds.length; i++) {
      const indicator = dae.eventIndicatorExprIds[i];
      if (indicator !== undefined && indicator >= 0) {
        L.push(`  g_event_indicators[${i}] = ${exprToC(dae, indicator)};`);
      }
    }
  }
  L.push("}");
  L.push("");

  // ── model_event_update function ──
  L.push("/* Event update: evaluate when-equations and discrete changes */");
  L.push("static void model_event_update(void) {");
  const whenEqIdxs: number[] = [];
  for (let idx = 0; idx < dae.eqCount; idx++) {
    if (dae.getEqKind(idx) === EqKind.When) whenEqIdxs.push(idx);
  }

  if (whenEqIdxs.length > 0) {
    let whenIdx = 0;
    for (const eqIdx of whenEqIdxs) {
      const weq = dae.getWhenEquationMeta(eqIdx);
      if (!weq) continue;

      const processBlock = (
        condExprId: number,
        bodyEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number }[],
      ) => {
        const condC = conditionToZeroCrossingC(dae, condExprId);
        L.push(`  if (${condC} > 0.0 && g_when_prev[${whenIdx}] <= 0.0) {`);
        for (const bodyEq of bodyEquations) {
          if (bodyEq.kind === EqKind.Simple) {
            const lhsName = extractAssignmentTarget(dae, bodyEq.lhsExprId);
            if (lhsName) {
              const sv = result.scalarVariables.find((v) => v.name === lhsName);
              if (sv) {
                L.push(`    g_vars[${sv.valueReference}] = ${exprToC(dae, bodyEq.rhsExprId)};  /* ${lhsName} */`);
                const stateRef = stateVarRefs.find((s) => s.vr === sv.valueReference);
                if (stateRef) L.push(`    g_states[${stateRef.idx}] = g_vars[${sv.valueReference}];`);
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
                    L.push(`    g_vars[${sv.valueReference}] = ${exprToC(dae, arg1)};  /* reinit(${stateName}) */`);
                    const stateRef = stateVarRefs.find((s) => s.vr === sv.valueReference);
                    if (stateRef) L.push(`    g_states[${stateRef.idx}] = g_vars[${sv.valueReference}];`);
                  }
                }
              }
            }
          }
        }
        L.push("  }");
        L.push(`  g_when_prev[${whenIdx}] = ${condC};`);
        whenIdx++;
      };

      processBlock(weq.conditionExprId, weq.bodyEquations);
      for (const clause of weq.elseWhenClauses) {
        processBlock(clause.conditionExprId, clause.bodyEquations);
      }
    }
  }
  L.push("}");
  L.push("");

  // ── Embedded RK4 stepper ──
  L.push("/* Embedded RK4 integration step */");

  L.push("static void rk4_step(double t_start, double dt) {");
  L.push("  int i;");
  L.push("  double k1[N_STATES + 1], k2[N_STATES + 1], k3[N_STATES + 1], k4[N_STATES + 1];");
  L.push("  double tmp_states[N_STATES + 1];");
  L.push("  double y0[N_STATES + 1];");
  L.push("  double z_prev[N_EVENT_INDICATORS + 1];");
  L.push("  double t = t_start;");
  L.push("  double t_end = t_start + dt;");
  L.push("");
  L.push("  while (t < t_end - 1e-13) {");
  L.push("    double h = t_end - t;");
  L.push("    int step_accepted = 0;");
  L.push("    for (i = 0; i < N_STATES; i++) y0[i] = g_states[i];");
  L.push("    g_time = t;");
  for (const sv of stateVarRefs) {
    L.push(`    g_vars[${sv.vr}] = y0[${sv.idx}];`);
  }
  L.push("    if (N_EVENT_INDICATORS > 0) {");
  L.push("      model_get_event_indicators();");
  L.push("      for (i = 0; i < N_EVENT_INDICATORS; i++) z_prev[i] = g_event_indicators[i];");
  L.push("    }");
  L.push("    while (!step_accepted) {");
  L.push("      /* k1 */");
  L.push("      g_time = t;");
  for (const sv of stateVarRefs) {
    L.push(`      g_vars[${sv.vr}] = y0[${sv.idx}];`);
  }
  L.push("      model_get_derivatives();");
  L.push("      for (i = 0; i < N_STATES; i++) k1[i] = g_derivatives[i];");
  L.push("      /* k2 */");
  L.push("      g_time = t + 0.5 * h;");
  L.push("      for (i = 0; i < N_STATES; i++) tmp_states[i] = y0[i] + 0.5 * h * k1[i];");
  for (const sv of stateVarRefs) {
    L.push(`      g_vars[${sv.vr}] = tmp_states[${sv.idx}];`);
  }
  L.push("      model_get_derivatives();");
  L.push("      for (i = 0; i < N_STATES; i++) k2[i] = g_derivatives[i];");
  L.push("      /* k3 */");
  L.push("      for (i = 0; i < N_STATES; i++) tmp_states[i] = y0[i] + 0.5 * h * k2[i];");
  for (const sv of stateVarRefs) {
    L.push(`      g_vars[${sv.vr}] = tmp_states[${sv.idx}];`);
  }
  L.push("      model_get_derivatives();");
  L.push("      for (i = 0; i < N_STATES; i++) k3[i] = g_derivatives[i];");
  L.push("      /* k4 */");
  L.push("      g_time = t + h;");
  L.push("      for (i = 0; i < N_STATES; i++) tmp_states[i] = y0[i] + h * k3[i];");
  for (const sv of stateVarRefs) {
    L.push(`      g_vars[${sv.vr}] = tmp_states[${sv.idx}];`);
  }
  L.push("      model_get_derivatives();");
  L.push("      for (i = 0; i < N_STATES; i++) k4[i] = g_derivatives[i];");
  L.push("      /* Combine */");
  L.push(
    "      for (i = 0; i < N_STATES; i++) tmp_states[i] = y0[i] + (h / 6.0) * (k1[i] + 2.0*k2[i] + 2.0*k3[i] + k4[i]);",
  );
  L.push("      ");
  L.push("      int crossing = 0;");
  L.push("      if (N_EVENT_INDICATORS > 0) {");
  L.push("        g_time = t + h;");
  for (const sv of stateVarRefs) {
    L.push(`        g_vars[${sv.vr}] = tmp_states[${sv.idx}];`);
  }
  L.push("        model_get_event_indicators();");
  L.push("        for (i = 0; i < N_EVENT_INDICATORS; i++) {");
  L.push("          if (z_prev[i] * g_event_indicators[i] < 0.0) { crossing = 1; break; }");
  L.push("        }");
  L.push("      }");
  L.push("      if (crossing && h > 1e-7) {");
  L.push("        h *= 0.5;");
  L.push("      } else {");
  L.push("        step_accepted = 1;");
  L.push("      }");
  L.push("    }");
  L.push("    t += h;");
  L.push("    for (i = 0; i < N_STATES; i++) g_states[i] = tmp_states[i];");
  for (const sv of stateVarRefs) {
    L.push(`    g_vars[${sv.vr}] = g_states[${sv.idx}];`);
  }
  L.push("    g_time = t;");
  L.push("    model_event_update();");
  L.push("  }");
  L.push("}");

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
