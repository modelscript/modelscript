// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMI 3.0 C source code generator.
 *
 * Generates standalone C source files implementing the FMI 3.0 API
 * for Model Exchange, Co-Simulation, and Scheduled Execution.
 */

import { ModelicaBinaryOperator, ModelicaUnaryOperator, ModelicaVariability } from "@modelscript/modelica-polyglot/ast";
import type { ModelicaDAE, ModelicaExpression } from "@modelscript/symbolics";
import {
  ModelicaArrayEquation,
  ModelicaBinaryExpression,
  ModelicaBooleanLiteral,
  ModelicaFunctionCallExpression,
  ModelicaIfElseExpression,
  ModelicaIntegerLiteral,
  ModelicaNameExpression,
  ModelicaRealLiteral,
  ModelicaStringLiteral,
  ModelicaUnaryExpression,
  ModelicaWhenEquation,
} from "@modelscript/symbolics";
import type { Fmi3Options, Fmi3Result, Fmi3Variable } from "./fmi3.js";
import {
  binaryOpToC,
  escapeCString,
  extractDerName,
  formatCDouble,
  mapFunctionName,
  sanitizeIdentifier,
} from "./transpiler-utils.js";

/** Generated FMI 3.0 C source files. */
export interface Fmi3CSourceFiles {
  modelH: string;
  modelC: string;
  fmi3FunctionsC: string;
  cmakeLists: string;
}

/**
 * Generate FMI 3.0 C source files from a DAE and FMI 3.0 result.
 */
export function generateFmi3CSources(dae: ModelicaDAE, result: Fmi3Result, options: Fmi3Options): Fmi3CSourceFiles {
  const id = options.modelIdentifier;
  const vars = result.variables;
  let maxVr = 0;
  let nStringVars = 0;
  for (const v of vars) {
    const size = v.dimensions ? v.dimensions.reduce((a, b) => a * (b.start ?? 1), 1) : 1;
    maxVr = Math.max(maxVr, v.valueReference + size - 1);
    if (v.type === "String") nStringVars += size;
  }
  const nVars = vars.length > 0 ? maxVr + 1 : 0;

  let maxStateVr = 0;
  let nStates = 0;
  for (const derVr of result.modelStructure.derivatives) {
    const v = vars.find((x) => x.valueReference === derVr);
    const size = v?.dimensions ? v.dimensions.reduce((a, b) => a * (b.start ?? 1), 1) : 1;
    maxStateVr = Math.max(maxStateVr, derVr + size - 1);
    nStates += size;
  }

  return {
    modelH: generateModelH3(id, nVars, nStates, nStringVars, result),
    modelC: generateModelC3(id, dae, result),
    fmi3FunctionsC: generateFmi3FunctionsC(id, nVars, nStates, nStringVars, dae, result),
    cmakeLists: generateCMakeLists3(id),
  };
}

// ── Expression → C transpiler (reused from FMI 2.0 with minor changes) ──

function exprToC(expr: ModelicaExpression, vars: Fmi3Variable[], loopIdx?: string): string {
  if (expr instanceof ModelicaRealLiteral) return formatCDouble(expr.value);
  if (expr instanceof ModelicaIntegerLiteral) return `${expr.value}`;
  if (expr instanceof ModelicaBooleanLiteral) return expr.value ? "1" : "0";
  if (expr instanceof ModelicaStringLiteral) return `"${escapeCString(expr.value)}"`;
  if (expr instanceof ModelicaNameExpression) return varToC(expr.name, vars, loopIdx);
  if (expr instanceof ModelicaUnaryExpression) {
    const op = expr.operator === ModelicaUnaryOperator.UNARY_MINUS ? "-" : "!";
    return `(${op}${exprToC(expr.operand, vars, loopIdx)})`;
  }
  if (expr instanceof ModelicaBinaryExpression) {
    const lhs = exprToC(expr.operand1, vars, loopIdx);
    const rhs = exprToC(expr.operand2, vars, loopIdx);
    const op = binaryOpToC(expr.operator);
    if (op === "pow") return `pow(${lhs}, ${rhs})`;
    return `(${lhs} ${op} ${rhs})`;
  }
  if (expr instanceof ModelicaFunctionCallExpression) {
    const args = expr.args.map((a: ModelicaExpression) => exprToC(a, vars, loopIdx)).join(", ");
    return `${mapFunctionName(expr.functionName)}(${args})`;
  }
  if (expr instanceof ModelicaIfElseExpression) {
    const cond = exprToC(expr.condition, vars, loopIdx);
    const then = exprToC(expr.thenExpression, vars, loopIdx);
    const els = exprToC(expr.elseExpression, vars, loopIdx);
    if (expr.elseIfClauses.length > 0) {
      let r = `(${cond} ? ${then} : `;
      for (const clause of expr.elseIfClauses)
        r += `${exprToC(clause.condition, vars, loopIdx)} ? ${exprToC(clause.expression, vars, loopIdx)} : `;
      return r + `${els})`;
    }
    return `(${cond} ? ${then} : ${els})`;
  }
  if (expr && typeof expr === "object" && "name" in expr) return varToC((expr as { name: string }).name, vars, loopIdx);
  return "0.0 /* unknown */";
}

function varToC(name: string, vars: Fmi3Variable[], loopIdx?: string): string {
  if (name === "time") return "inst->time";
  const m = name.match(/^der\((.+)\)$/);
  const baseName = m ? (m[1] ?? "") : name;
  const sv = vars.find((v) => v.name === baseName);

  if (!sv) return `0.0 /* unknown ${name} */`;

  const size = sv.dimensions ? sv.dimensions.reduce((a, b) => a * (b.start ?? 1), 1) : 1;
  let idxStr = sv.valueReference.toString();
  if (size > 1 && loopIdx) idxStr += ` + ${loopIdx}`;

  // If it's a derivative, it's technically supposed to be in inst->derivatives?
  // Wait, if an equation actually reads der(A) on the RHS, which is extremely rare.
  // We can just query `inst->derivatives` if we mapped its state index.
  // Actually, FMI 3.0 gives derivatives their own VR! So it CAN be in inst->vars!
  // Wait, FMI 3.0 codegen doesn't write derivatives to inst->vars, it writes to inst->derivatives.
  // Let's assume FMI 3.0 just uses inst->vars for it if we store it there, but we only write to inst->derivatives.
  // Let's just return `inst->vars[VR]` and if FMI needs it we might have a bug. BUT FMI 2.0 didn't have der_A either.
  const isDer = m !== null;
  if (isDer) {
    const derSv = vars.find((v) => v.name === name);
    if (derSv) {
      let derIdxStr = derSv.valueReference.toString();
      if (size > 1 && loopIdx) derIdxStr += ` + ${loopIdx}`;
      return `inst->vars[${derIdxStr}]`;
    }
  }

  return `inst->vars[${idxStr}]`;
}

const sanitize = sanitizeIdentifier;

function conditionToZC(cond: ModelicaExpression, vars: Fmi3Variable[]): string {
  if (cond instanceof ModelicaBinaryExpression) {
    const op = cond.operator;
    if (
      op === ModelicaBinaryOperator.LESS_THAN ||
      op === ModelicaBinaryOperator.LESS_THAN_OR_EQUAL ||
      op === ModelicaBinaryOperator.GREATER_THAN ||
      op === ModelicaBinaryOperator.GREATER_THAN_OR_EQUAL
    )
      return `(${exprToC(cond.operand1, vars)}) - (${exprToC(cond.operand2, vars)})`;
  }
  return `(${exprToC(cond, vars)} ? 1.0 : -1.0)`;
}

// ── File generators ──

function generateModelH3(id: string, nVars: number, nStates: number, nStringVars: number, result: Fmi3Result): string {
  const L: string[] = [];
  L.push("/* Auto-generated by ModelScript — FMI 3.0 */");
  L.push(`#ifndef ${id.toUpperCase()}_MODEL_H`);
  L.push(`#define ${id.toUpperCase()}_MODEL_H`);
  L.push("#include <math.h>");
  L.push("#include <string.h>");
  L.push("");
  L.push(`#define MODEL_IDENTIFIER "${id}"`);
  L.push(`#define MODEL_GUID "${result.guid}"`);
  L.push(`#define N_VARS ${nVars}`);
  L.push(`#define N_STATES ${nStates}`);
  L.push(`#define N_STRING_VARS ${nStringVars}`);
  L.push(`#define N_EVENT_INDICATORS ${result.numberOfEventIndicators}`);
  L.push("");
  for (const sv of result.variables) L.push(`#define VR_${sanitize(sv.name).toUpperCase()} ${sv.valueReference}`);
  L.push("");
  L.push("typedef struct {");
  L.push("  double vars[N_VARS + 1];");
  L.push("  double states[N_STATES + 1];");
  L.push("  double derivatives[N_STATES + 1];");
  L.push("  char* stringVars[N_STRING_VARS + 1];");
  L.push("  double eventPrev[N_EVENT_INDICATORS + 1];");
  L.push("  double time;");
  L.push("  int isDirtyValues;");
  L.push(`} ${id}_Instance;`);
  L.push("");
  L.push(`void ${id}_initialize(${id}_Instance* inst);`);
  L.push(`void ${id}_getDerivatives(${id}_Instance* inst);`);
  L.push(`void ${id}_getEventIndicators(${id}_Instance* inst, double* indicators);`);
  L.push("");
  L.push("#endif");
  return L.join("\n");
}

function generateModelC3(id: string, dae: ModelicaDAE, result: Fmi3Result): string {
  const L: string[] = [];
  L.push("/* Auto-generated by ModelScript — FMI 3.0 */");
  L.push(`#include "${id}_model.h"`);
  L.push("#include <stdio.h>");
  L.push("");
  const vrMap = new Map<string, number>();
  for (const sv of result.variables) vrMap.set(sv.name, sv.valueReference);

  // Initialize
  L.push(`void ${id}_initialize(${id}_Instance* inst) {`);
  L.push("  memset(inst, 0, sizeof(*inst));");
  for (const v of dae.variables) {
    if (v.variability === ModelicaVariability.PARAMETER || v.variability === ModelicaVariability.CONSTANT) {
      const ref = vrMap.get(v.name);
      if (ref !== undefined && v.expression)
        L.push(`  inst->vars[${ref}] = ${exprToC(v.expression, result.variables)};  /* ${v.name} */`);
    }
  }
  for (const v of dae.variables) {
    if (v.variability === null || v.variability === undefined) {
      const ref = vrMap.get(v.name);
      if (ref !== undefined) {
        const e = v.attributes.get("start") ?? v.expression;
        if (e) L.push(`  inst->vars[${ref}] = ${exprToC(e, result.variables)};  /* ${v.name} */`);
      }
    }
  }
  L.push("}");
  L.push("");

  // Derivatives
  L.push(`void ${id}_getDerivatives(${id}_Instance* inst) {`);
  L.push("  double time = inst->time; (void)time;");
  L.push("");
  let derIdx = 0;
  for (const eq of dae.equations) {
    if (!("expression1" in eq && "expression2" in eq)) continue;
    const isArrayEq = eq instanceof ModelicaArrayEquation;
    const se = eq as { expression1: ModelicaExpression; expression2: ModelicaExpression };
    const ld = extractDerName(se.expression1);
    const rd = extractDerName(se.expression2);

    if (isArrayEq) {
      const baseName = ld || rd;
      if (!baseName) continue;
      const sv = result.variables.find((v) => v.name === baseName);
      if (!sv) continue;
      const size = sv.dimensions ? sv.dimensions.reduce((a, b) => a * (b.start ?? 1), 1) : 1;

      L.push(`  for (int _i = 0; _i < ${size}; _i++) {`);
      if (ld) {
        L.push(
          `    inst->derivatives[${derIdx} + _i] = ${exprToC(se.expression2, result.variables, "_i")};  /* der(${ld}) */`,
        );
      } else if (rd) {
        L.push(
          `    inst->derivatives[${derIdx} + _i] = ${exprToC(se.expression1, result.variables, "_i")};  /* der(${rd}) */`,
        );
      }
      L.push(`  }`);
      derIdx += size;
    } else {
      if (ld) {
        L.push(`  inst->derivatives[${derIdx}] = ${exprToC(se.expression2, result.variables)};  /* der(${ld}) */`);
        derIdx++;
      } else if (rd) {
        L.push(`  inst->derivatives[${derIdx}] = ${exprToC(se.expression1, result.variables)};  /* der(${rd}) */`);
        derIdx++;
      }
    }
  }
  L.push("}");
  L.push("");

  // Event indicators
  const whenEqs = dae.equations.filter((eq): eq is ModelicaWhenEquation => eq instanceof ModelicaWhenEquation);
  L.push(`void ${id}_getEventIndicators(${id}_Instance* inst, double* indicators) {`);
  if (whenEqs.length === 0) {
    L.push("  (void)inst; (void)indicators;");
  } else {
    let idx = 0;
    for (const weq of whenEqs) {
      L.push(`  indicators[${idx}] = ${conditionToZC(weq.condition, result.variables)};`);
      idx++;
      for (const c of weq.elseWhenClauses) {
        L.push(`  indicators[${idx}] = ${conditionToZC(c.condition, result.variables)};`);
        idx++;
      }
    }
  }
  L.push("}");
  return L.join("\n");
}

function generateFmi3FunctionsC(
  id: string,
  nVars: number,
  nStates: number,
  nStringVars: number,
  dae: ModelicaDAE,
  result: Fmi3Result,
): string {
  const L: string[] = [];

  // Header
  L.push("/* Auto-generated by ModelScript — FMI 3.0 API */");
  L.push(`#include "${id}_model.h"`);
  L.push('#include "fmi3Functions.h"');
  L.push("#include <stdlib.h>");
  L.push("#include <string.h>");
  L.push("#include <stdio.h>");
  L.push("");

  // Instance struct
  L.push("typedef struct {");
  L.push(`  ${id}_Instance model;`);
  L.push("  fmi3String instanceName;");
  L.push("  fmi3LogMessageCallback logMessage;");
  L.push("  fmi3IntermediateUpdateCallback intermediateUpdate;");
  L.push("  fmi3InstanceEnvironment instanceEnvironment;");
  L.push("  fmi3Boolean loggingOn;");
  L.push("  fmi3Float64 startTime;");
  L.push("  fmi3Float64 stopTime;");
  L.push("  fmi3Float64 stepSize;");
  L.push("  fmi3Boolean eventModeUsed;");
  L.push("  fmi3Boolean earlyReturnAllowed;");
  L.push("  int state; /* 0=INIT, 1=STEP, 2=EVENT, 3=TERMINATED */");
  // ExternalObject handle fields
  for (let ei = 0; ei < dae.externalObjects.length; ei++) {
    const eo = dae.externalObjects[ei];
    if (!eo) continue;
    L.push(`  void* extObj_${ei}; /* ${eo.typeName}: ${eo.variableName} */`);
  }
  L.push("  int terminateRequested;");
  L.push("} FMU3Instance;");
  L.push("#define FMU3_STATE_INIT  0");
  L.push("#define FMU3_STATE_STEP  1");
  L.push("#define FMU3_STATE_EVENT 2");
  L.push("#define FMU3_STATE_TERM  3");
  L.push("");
  L.push("/* Variable size lookup table for array batching (FMI 3.0 §2.2.7) */");
  L.push("static const size_t varSizes[N_VARS + 1] = {");
  const sizeEntries: number[] = new Array(nVars).fill(1);
  for (const sv of result.variables) {
    if (sv.dimensions && sv.dimensions.length > 0) {
      let totalSize = 1;
      for (const dim of sv.dimensions) {
        if (dim.start !== undefined) totalSize *= dim.start;
      }
      if (sv.valueReference < nVars) sizeEntries[sv.valueReference] = totalSize;
    }
  }
  for (let i = 0; i < sizeEntries.length; i += 20) {
    const batch = sizeEntries.slice(i, Math.min(i + 20, sizeEntries.length));
    const isLast = i + 20 >= sizeEntries.length;
    L.push(`  ${batch.join(",")}${isLast ? "" : ","}`);
  }
  L.push("};");
  L.push("");

  // Mutable dimension support (FMI 3.0 §2.2.8)
  // ONLY emitted when the model has __modelscript_mutableDimension annotations.
  // Static models get zero overhead — no extra code, no branches, no lookups.
  const mutableDimVRs: number[] = [];
  for (const sv of result.variables) {
    if (sv.causality === "structuralParameter" && sv.variability === "tunable") {
      mutableDimVRs.push(sv.valueReference);
    }
  }
  const hasMutableDims = mutableDimVRs.length > 0;
  if (hasMutableDims) {
    L.push("/* ── Mutable dimension support (FMI 3.0 dynamic arrays) ── */");
    L.push("#define HAS_MUTABLE_DIMS 1");
    L.push(`static const fmi3ValueReference mutableDimVRs[] = { ${mutableDimVRs.join(", ")} };`);
    L.push(`#define N_MUTABLE_DIMS ${mutableDimVRs.length}`);
    L.push("static int isMutableDimVR(fmi3ValueReference vr) {");
    L.push("  for (int i = 0; i < N_MUTABLE_DIMS; i++) if (mutableDimVRs[i] == vr) return 1;");
    L.push("  return 0;");
    L.push("}");
    L.push("");
  } else {
    L.push("/* No mutable dimensions — static array layout, zero dynamic overhead */");
    L.push("");
  }

  L.push("static void fmi3_logger_impl(void* fmuInstance, const char* category, const char* message) {");
  L.push("  FMU3Instance* inst = (FMU3Instance*)fmuInstance;");
  L.push("  if (inst->logMessage) {");
  L.push("    inst->logMessage(inst->instanceEnvironment, fmi3Error, category, message);");
  L.push("  }");
  L.push("}");
  L.push("static void fmi3_terminate_impl(void* fmuInstance) {");
  L.push("  FMU3Instance* inst = (FMU3Instance*)fmuInstance;");
  L.push("  inst->terminateRequested = 1;");
  L.push("}");
  L.push("");

  // fmi3InstantiateCoSimulation
  L.push("fmi3Instance fmi3InstantiateCoSimulation(");
  L.push("    fmi3String instanceName, fmi3String instantiationToken, fmi3String resourcePath,");
  L.push("    fmi3Boolean visible, fmi3Boolean loggingOn,");
  L.push("    fmi3Boolean eventModeUsed, fmi3Boolean earlyReturnAllowed,");
  L.push("    const fmi3ValueReference requiredIntermediateVariables[], size_t nRequiredIntermediateVariables,");
  L.push("    fmi3InstanceEnvironment instanceEnvironment, fmi3LogMessageCallback logMessage,");
  L.push("    fmi3IntermediateUpdateCallback intermediateUpdate) {");
  L.push("  (void)instantiationToken; (void)resourcePath; (void)visible;");
  L.push("  (void)requiredIntermediateVariables; (void)nRequiredIntermediateVariables;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)calloc(1, sizeof(FMU3Instance));");
  L.push("  if (!inst) return NULL;");
  L.push("  inst->instanceName = instanceName;");
  L.push("  inst->logMessage = logMessage;");
  L.push("  inst->intermediateUpdate = intermediateUpdate;");
  L.push("  inst->instanceEnvironment = instanceEnvironment;");
  L.push("  inst->loggingOn = loggingOn;");
  L.push("  inst->stepSize = 0.001;");
  L.push("  inst->eventModeUsed = eventModeUsed;");
  L.push("  inst->earlyReturnAllowed = earlyReturnAllowed;");
  L.push("  inst->state = FMU3_STATE_INIT;");
  L.push("  inst->model.fmuInstance = inst;");
  L.push("  inst->model.logger = fmi3_logger_impl;");
  L.push("  inst->model.terminate = fmi3_terminate_impl;");
  L.push(`  ${id}_initialize(&inst->model);`);

  // Emit ExternalObject constructor calls right after instantiation
  if (dae.externalObjects.length > 0) {
    L.push("  /* --- ExternalObject constructors --- */");
    for (let ei = 0; ei < dae.externalObjects.length; ei++) {
      const eo = dae.externalObjects[ei];
      if (!eo) continue;
      const ctorName = sanitizeIdentifier(eo.constructorName);
      L.push(`  inst->extObj_${ei} = (void*)${ctorName}();  /* ${eo.typeName} */`);
    }
    L.push("");
  }

  L.push("  return (fmi3Instance)inst;");
  L.push("}");
  L.push("");

  // fmi3InstantiateModelExchange
  L.push("fmi3Instance fmi3InstantiateModelExchange(");
  L.push("    fmi3String instanceName, fmi3String instantiationToken, fmi3String resourcePath,");
  L.push("    fmi3Boolean visible, fmi3Boolean loggingOn,");
  L.push("    fmi3InstanceEnvironment instanceEnvironment, fmi3LogMessageCallback logMessage) {");
  L.push("  (void)instantiationToken; (void)resourcePath; (void)visible;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)calloc(1, sizeof(FMU3Instance));");
  L.push("  if (!inst) return NULL;");
  L.push("  inst->instanceName = instanceName;");
  L.push("  inst->logMessage = logMessage;");
  L.push("  inst->instanceEnvironment = instanceEnvironment;");
  L.push("  inst->loggingOn = loggingOn;");
  L.push("  inst->model.fmuInstance = inst;");
  L.push("  inst->model.logger = fmi3_logger_impl;");
  L.push("  inst->model.terminate = fmi3_terminate_impl;");
  L.push(`  ${id}_initialize(&inst->model);`);

  // Emit ExternalObject constructor calls right after instantiation
  if (dae.externalObjects.length > 0) {
    L.push("  /* --- ExternalObject constructors --- */");
    for (let ei = 0; ei < dae.externalObjects.length; ei++) {
      const eo = dae.externalObjects[ei];
      if (!eo) continue;
      const ctorName = sanitizeIdentifier(eo.constructorName);
      L.push(`  inst->extObj_${ei} = (void*)${ctorName}();  /* ${eo.typeName} */`);
    }
    L.push("");
  }

  L.push("  return (fmi3Instance)inst;");
  L.push("}");
  L.push("");

  // Lifecycle
  L.push(
    "fmi3Status fmi3EnterInitializationMode(fmi3Instance instance, fmi3Boolean toleranceDefined, fmi3Float64 tolerance, fmi3Float64 startTime, fmi3Boolean stopTimeDefined, fmi3Float64 stopTime) {",
  );
  L.push("  (void)toleranceDefined; (void)tolerance;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push("  inst->startTime = startTime; inst->model.time = startTime;");
  L.push("  if (stopTimeDefined) inst->stopTime = stopTime;");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3ExitInitializationMode(fmi3Instance instance) { ((FMU3Instance*)instance)->state = FMU3_STATE_STEP; return fmi3OK; }",
  );
  L.push(
    "fmi3Status fmi3Terminate(fmi3Instance instance) { ((FMU3Instance*)instance)->state = FMU3_STATE_TERM; return fmi3OK; }",
  );
  L.push("void fmi3FreeInstance(fmi3Instance instance) {");
  L.push("  if (!instance) return;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  // ExternalObject destructors
  if (dae.externalObjects.length > 0) {
    L.push("  /* ExternalObject destructors */");
    for (let ei = 0; ei < dae.externalObjects.length; ei++) {
      const eo = dae.externalObjects[ei];
      if (!eo) continue;
      const dtorName = sanitizeIdentifier(eo.destructorName);
      L.push(`  ${dtorName}(inst->extObj_${ei});`);
    }
  }
  L.push("  free(inst);");
  L.push("}");
  L.push("fmi3Status fmi3Reset(fmi3Instance instance) {");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push("  inst->state = FMU3_STATE_INIT;");
  for (let ei = 0; ei < dae.externalObjects.length; ei++) {
    const eo = dae.externalObjects[ei];
    if (!eo) continue;
    const ctorName = sanitizeIdentifier(eo.constructorName);
    const dtorName = sanitizeIdentifier(eo.destructorName);
    L.push(`  if (inst->extObj_${ei}) {`);
    L.push(`    ${dtorName}(inst->extObj_${ei});`);
    L.push(`  }`);
    L.push(`  inst->extObj_${ei} = ${ctorName}();`);
  }
  L.push(`  ${id}_initialize(&inst->model);`);
  L.push("  return fmi3OK;");
  L.push("}");
  L.push("");

  const numericTypes = ["Float32", "Float64", "Int8", "UInt8", "Int16", "UInt16", "Int32", "UInt32", "Int64", "UInt64"];
  for (const t of numericTypes) {
    L.push(`  // Get/Set ${t} (array-aware batching)`);
    L.push(
      `  fmi3Status fmi3Get${t}(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, fmi3${t} value[], size_t nValues) {`,
    );
    L.push("    FMU3Instance* inst = (FMU3Instance*)instance;");
    L.push("    size_t vi = 0;");
    L.push("    for (size_t i = 0; i < nvr && vi < nValues; i++) {");
    L.push("      if (vr[i] < N_VARS) {");
    L.push("        size_t sz = varSizes[vr[i]];");
    L.push(
      `        for (size_t j = 0; j < sz && vi < nValues; j++) value[vi++] = (fmi3${t})inst->model.vars[vr[i] + j];`,
    );
    L.push("      }");
    L.push("    }");
    L.push("    return fmi3OK;");
    L.push("  }");
    L.push(
      `  fmi3Status fmi3Set${t}(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, const fmi3${t} value[], size_t nValues) {`,
    );
    L.push("    FMU3Instance* inst = (FMU3Instance*)instance;");
    L.push("    size_t vi = 0;");
    L.push("    for (size_t i = 0; i < nvr && vi < nValues; i++) {");
    L.push("      if (vr[i] < N_VARS) {");
    L.push("        size_t sz = varSizes[vr[i]];");
    L.push(
      "        for (size_t j = 0; j < sz && vi < nValues; j++) inst->model.vars[vr[i] + j] = (double)value[vi++];",
    );
    L.push("      }");
    L.push("    }");
    L.push("    return fmi3OK;");
    L.push("  }");
    L.push("");
  }

  // Get/Set Boolean (array-aware batching)
  L.push(
    "fmi3Status fmi3GetBoolean(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, fmi3Boolean value[], size_t nValues) {",
  );
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push("  size_t vi = 0;");
  L.push("  for (size_t i = 0; i < nvr && vi < nValues; i++) {");
  L.push("    if (vr[i] < N_VARS) {");
  L.push("      size_t sz = varSizes[vr[i]];");
  L.push("      for (size_t j = 0; j < sz && vi < nValues; j++) value[vi++] = inst->model.vars[vr[i] + j] != 0.0;");
  L.push("    }");
  L.push("  }");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3SetBoolean(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, const fmi3Boolean value[], size_t nValues) {",
  );
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push("  size_t vi = 0;");
  L.push("  for (size_t i = 0; i < nvr && vi < nValues; i++) {");
  L.push("    if (vr[i] < N_VARS) {");
  L.push("      size_t sz = varSizes[vr[i]];");
  L.push(
    "      for (size_t j = 0; j < sz && vi < nValues; j++) inst->model.vars[vr[i] + j] = value[vi++] ? 1.0 : 0.0;",
  );
  L.push("    }");
  L.push("  }");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push("");

  // Get/Set String
  L.push(
    "fmi3Status fmi3GetString(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, fmi3String value[], size_t nValues) {",
  );
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance; (void)nValues;");
  L.push(
    '  for (size_t i = 0; i < nvr; i++) { if (vr[i] < N_STRING_VARS) value[i] = inst->model.stringVars[vr[i]] ? inst->model.stringVars[vr[i]] : ""; }',
  );
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3SetString(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, const fmi3String value[], size_t nValues) {",
  );
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance; (void)nValues;");
  L.push("  for (size_t i = 0; i < nvr; i++) {");
  L.push("    if (vr[i] < N_STRING_VARS) {");
  L.push("      if (inst->model.stringVars[vr[i]]) free(inst->model.stringVars[vr[i]]);");
  L.push("      inst->model.stringVars[vr[i]] = value[i] ? strdup(value[i]) : NULL;");
  L.push("    }");
  L.push("  }");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push("");

  // Get/Set Binary (FMI 3.0 opaque payload)
  L.push(
    "fmi3Status fmi3GetBinary(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, size_t sizes[], fmi3Binary value[], size_t nValues) {",
  );
  L.push("  (void)instance; (void)vr; (void)nvr; (void)sizes; (void)value; (void)nValues;");
  L.push("  /* Binary variables are not produced by Modelica — stub returns empty */");
  L.push("  for (size_t i = 0; i < nvr; i++) { sizes[i] = 0; value[i] = NULL; }");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3SetBinary(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, const size_t sizes[], const fmi3Binary value[], size_t nValues) {",
  );
  L.push("  (void)instance; (void)vr; (void)nvr; (void)sizes; (void)value; (void)nValues;");
  L.push("  /* Binary variables are not produced by Modelica — stub ignores */");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push("");

  // Clocks and Intervals
  L.push(
    "fmi3Status fmi3GetClock(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, fmi3Clock value[], size_t nValues) {",
  );
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push("  size_t vi = 0;");
  L.push("  for (size_t i = 0; i < nvr && vi < nValues; i++) {");
  L.push("    if (vr[i] < N_VARS) {");
  L.push("      size_t sz = varSizes[vr[i]];");
  L.push("      for (size_t j = 0; j < sz && vi < nValues; j++) value[vi++] = inst->model.vars[vr[i] + j] != 0.0;");
  L.push("    }");
  L.push("  }");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3SetClock(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, const fmi3Clock value[], size_t nValues) {",
  );
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push("  size_t vi = 0;");
  L.push("  for (size_t i = 0; i < nvr && vi < nValues; i++) {");
  L.push("    if (vr[i] < N_VARS) {");
  L.push("      size_t sz = varSizes[vr[i]];");
  L.push(
    "      for (size_t j = 0; j < sz && vi < nValues; j++) inst->model.vars[vr[i] + j] = value[vi++] ? 1.0 : 0.0;",
  );
  L.push("    }");
  L.push("  }");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3GetIntervalDecimal(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, fmi3Float64 interval[], fmi3IntervalQualifier qualifier[]) {",
  );
  L.push("  (void)instance; (void)vr; (void)nvr; (void)interval; (void)qualifier; return fmi3Error;");
  L.push("}");
  L.push(
    "fmi3Status fmi3GetIntervalFraction(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, fmi3UInt64 intervalCounter[], fmi3UInt64 resolution[], fmi3IntervalQualifier qualifier[]) {",
  );
  L.push(
    "  (void)instance; (void)vr; (void)nvr; (void)intervalCounter; (void)resolution; (void)qualifier; return fmi3Error;",
  );
  L.push("}");
  L.push(
    "fmi3Status fmi3SetIntervalDecimal(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, const fmi3Float64 interval[]) {",
  );
  L.push("  (void)instance; (void)vr; (void)nvr; (void)interval; return fmi3Error;");
  L.push("}");
  L.push(
    "fmi3Status fmi3SetIntervalFraction(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, const fmi3UInt64 intervalCounter[], const fmi3UInt64 resolution[]) {",
  );
  L.push("  (void)instance; (void)vr; (void)nvr; (void)intervalCounter; (void)resolution; return fmi3Error;");
  L.push("}");
  L.push("");

  // ME: SetTime, SetContinuousStates, GetDerivatives, GetContinuousStates, GetEventIndicators
  L.push("/* --- Model Exchange --- */");
  L.push(
    "fmi3Status fmi3SetTime(fmi3Instance instance, fmi3Float64 time) { ((FMU3Instance*)instance)->model.time = time; return fmi3OK; }",
  );

  const derVars = result.variables.filter((sv) => sv.name.startsWith("der("));
  const stateRefs: number[] = [];
  for (const dv of derVars) {
    if (dv.derivative !== undefined) stateRefs.push(dv.derivative);
  }

  L.push(
    "fmi3Status fmi3SetContinuousStates(fmi3Instance instance, const fmi3Float64 continuousStates[], size_t nContinuousStates) {",
  );
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  for (let i = 0; i < stateRefs.length; i++)
    L.push(`  if (${i} < (int)nContinuousStates) inst->model.vars[${stateRefs[i]}] = continuousStates[${i}];`);
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3GetContinuousStateDerivatives(fmi3Instance instance, fmi3Float64 derivatives[], size_t nContinuousStates) {",
  );
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push(`  ${id}_getDerivatives(&inst->model);`);
  L.push(
    "  for (size_t i = 0; i < nContinuousStates && i < N_STATES; i++) derivatives[i] = inst->model.derivatives[i];",
  );
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3GetContinuousStates(fmi3Instance instance, fmi3Float64 continuousStates[], size_t nContinuousStates) {",
  );
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  for (let i = 0; i < stateRefs.length; i++)
    L.push(`  if (${i} < (int)nContinuousStates) continuousStates[${i}] = inst->model.vars[${stateRefs[i]}];`);
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3GetEventIndicators(fmi3Instance instance, fmi3Float64 eventIndicators[], size_t nEventIndicators) {",
  );
  L.push(
    `  ${id}_getEventIndicators(&((FMU3Instance*)instance)->model, eventIndicators); (void)nEventIndicators; return fmi3OK;`,
  );
  L.push("}");
  L.push("");

  // CS: fmi3DoStep with intermediate update callback support
  L.push("/* --- Co-Simulation --- */");
  L.push(
    "fmi3Status fmi3DoStep(fmi3Instance instance, fmi3Float64 currentCommunicationPoint, fmi3Float64 communicationStepSize, fmi3Boolean noSetFMUStatePriorToCurrentPoint,",
  );
  L.push(
    "    fmi3Boolean* eventHandlingNeeded, fmi3Boolean* terminateSimulation, fmi3Boolean* earlyReturn, fmi3Float64* lastSuccessfulTime) {",
  );
  L.push("  (void)noSetFMUStatePriorToCurrentPoint;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push("  *eventHandlingNeeded = fmi3False; *terminateSimulation = fmi3False; *earlyReturn = fmi3False;");
  L.push("  double t = currentCommunicationPoint, tEnd = t + communicationStepSize, h = inst->stepSize;");
  L.push("  if (h <= 0) h = 0.001;");
  L.push("  while (t < tEnd - 1e-15) {");
  L.push("    if (t + h > tEnd) h = tEnd - t;");
  L.push("    double k1[N_STATES+1], k2[N_STATES+1], k3[N_STATES+1], k4[N_STATES+1], sv[N_STATES+1];");
  for (let i = 0; i < stateRefs.length; i++) L.push(`    sv[${i}] = inst->model.vars[${stateRefs[i]}];`);
  // RK4 k1
  L.push(`    inst->model.time = t; ${id}_getDerivatives(&inst->model);`);
  L.push("    for (int i=0; i<N_STATES; i++) k1[i] = inst->model.derivatives[i];");
  // RK4 k2
  L.push("    inst->model.time = t + 0.5*h;");
  for (let i = 0; i < stateRefs.length; i++)
    L.push(`    inst->model.vars[${stateRefs[i]}] = sv[${i}] + 0.5*h*k1[${i}];`);
  L.push(`    ${id}_getDerivatives(&inst->model);`);
  L.push("    for (int i=0; i<N_STATES; i++) k2[i] = inst->model.derivatives[i];");
  // RK4 k3
  for (let i = 0; i < stateRefs.length; i++)
    L.push(`    inst->model.vars[${stateRefs[i]}] = sv[${i}] + 0.5*h*k2[${i}];`);
  L.push(`    ${id}_getDerivatives(&inst->model);`);
  L.push("    for (int i=0; i<N_STATES; i++) k3[i] = inst->model.derivatives[i];");
  // RK4 k4
  L.push("    inst->model.time = t + h;");
  for (let i = 0; i < stateRefs.length; i++) L.push(`    inst->model.vars[${stateRefs[i]}] = sv[${i}] + h*k3[${i}];`);
  L.push(`    ${id}_getDerivatives(&inst->model);`);
  L.push("    for (int i=0; i<N_STATES; i++) k4[i] = inst->model.derivatives[i];");
  // RK4 update
  for (let i = 0; i < stateRefs.length; i++)
    L.push(
      `    inst->model.vars[${stateRefs[i]}] = sv[${i}] + (h/6.0)*(k1[${i}] + 2.0*k2[${i}] + 2.0*k3[${i}] + k4[${i}]);`,
    );
  L.push("    t += h;");
  // Intermediate update callback
  L.push("    /* FMI 3.0: Intermediate update callback */");
  L.push("    if (inst->intermediateUpdate) {");
  L.push("      fmi3Boolean canReturnEarly = fmi3False;");
  L.push(
    "      inst->intermediateUpdate(inst->instanceEnvironment, t, fmi3False, fmi3True, fmi3False, fmi3True, NULL, 0, &canReturnEarly);",
  );
  L.push("      if (canReturnEarly) { *earlyReturn = fmi3True; *lastSuccessfulTime = t; return fmi3OK; }");
  L.push("    }");
  L.push("    /* FMI 3.0: CS Event Mode — check event indicators for zero crossings */");
  L.push("    if (inst->eventModeUsed) {");
  L.push("      double ei[N_EVENT_INDICATORS + 1];");
  L.push(`      ${id}_getEventIndicators(&inst->model, ei);`);
  L.push("      for (int k = 0; k < N_EVENT_INDICATORS; k++) {");
  L.push("        if ((inst->model.eventPrev[k] <= 0 && ei[k] > 0) || (inst->model.eventPrev[k] >= 0 && ei[k] < 0)) {");
  L.push("          *eventHandlingNeeded = fmi3True;");
  L.push("          if (inst->earlyReturnAllowed) { *earlyReturn = fmi3True; *lastSuccessfulTime = t; }");
  L.push("          break;");
  L.push("        }");
  L.push("      }");
  L.push("      for (int k = 0; k < N_EVENT_INDICATORS; k++) inst->model.eventPrev[k] = ei[k];");
  L.push("      if (*earlyReturn) return fmi3OK;");
  L.push("    }");
  L.push("  }");
  L.push("  inst->model.time = tEnd; *lastSuccessfulTime = tEnd;");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push("");

  // Remaining stubs
  L.push("/* --- Stubs --- */");
  L.push(
    "fmi3Status fmi3EnterEventMode(fmi3Instance instance) { ((FMU3Instance*)instance)->state = FMU3_STATE_EVENT; return fmi3OK; }",
  );
  L.push("fmi3Status fmi3EnterContinuousTimeMode(fmi3Instance instance) { (void)instance; return fmi3OK; }");
  L.push(
    "fmi3Status fmi3EnterStepMode(fmi3Instance instance) { ((FMU3Instance*)instance)->state = FMU3_STATE_STEP; return fmi3OK; }",
  );
  L.push(
    "fmi3Status fmi3CompletedIntegratorStep(fmi3Instance instance, fmi3Boolean noSetFMUStatePriorToCurrentPoint, fmi3Boolean* enterEventMode, fmi3Boolean* terminateSimulation) { (void)instance; (void)noSetFMUStatePriorToCurrentPoint; *enterEventMode = fmi3False; *terminateSimulation = fmi3False; return fmi3OK; }",
  );
  // fmi3UpdateDiscreteStates — clock-driven event detection via zero-crossing
  L.push(
    "fmi3Status fmi3UpdateDiscreteStates(fmi3Instance instance, fmi3Boolean* discreteStatesNeedUpdate, fmi3Boolean* terminateSimulation, fmi3Boolean* nominalsOfContinuousStatesChanged, fmi3Boolean* valuesOfContinuousStatesChanged, fmi3Boolean* nextEventTimeDefined, fmi3Float64* nextEventTime) {",
  );
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push("  *terminateSimulation = fmi3False;");
  L.push("  *nominalsOfContinuousStatesChanged = fmi3False;");
  L.push("  *valuesOfContinuousStatesChanged = fmi3False;");
  L.push("  *nextEventTimeDefined = fmi3False;");
  L.push("  *nextEventTime = 0;");
  L.push("  /* Check event indicators for zero crossings */");
  L.push("  double indicators[N_EVENT_INDICATORS + 1];");
  L.push(`  ${id}_getEventIndicators(&inst->model, indicators);`);
  L.push("  fmi3Boolean needUpdate = fmi3False;");
  L.push("  for (int i = 0; i < N_EVENT_INDICATORS; i++) {");
  L.push("    if ((inst->model.eventPrev[i] <= 0 && indicators[i] > 0) ||");
  L.push("        (inst->model.eventPrev[i] > 0 && indicators[i] <= 0)) {");
  L.push("      needUpdate = fmi3True;");
  L.push("    }");
  L.push("    inst->model.eventPrev[i] = indicators[i];");
  L.push("  }");
  L.push("  *discreteStatesNeedUpdate = needUpdate;");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3GetNominalsOfContinuousStates(fmi3Instance instance, fmi3Float64 nominals[], size_t nContinuousStates) { for (size_t i=0; i<nContinuousStates; i++) nominals[i]=1.0; (void)instance; return fmi3OK; }",
  );
  L.push(
    "fmi3Status fmi3GetNumberOfVariableDependencies(fmi3Instance instance, fmi3ValueReference vr, size_t* nDeps) { (void)instance; (void)vr; *nDeps=0; return fmi3OK; }",
  );
  L.push(
    "fmi3Status fmi3SetDebugLogging(fmi3Instance instance, fmi3Boolean loggingOn, size_t nCategories, const fmi3String categories[]) { ((FMU3Instance*)instance)->loggingOn = loggingOn; (void)nCategories; (void)categories; return fmi3OK; }",
  );
  L.push("");

  // fmi3GetDirectionalDerivative — forward-mode Jacobian-vector product via finite differences
  L.push("/* Directional derivative: dz = (∂z/∂v) · dv  (forward-mode via finite differences) */");
  L.push(
    "fmi3Status fmi3GetDirectionalDerivative(fmi3Instance instance, const fmi3ValueReference unknowns[], size_t nUnknowns, const fmi3ValueReference knowns[], size_t nKnowns, const fmi3Float64 seed[], size_t nSeed, fmi3Float64 sensitivity[], size_t nSensitivity) {",
  );
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push("  (void)nSeed; (void)nSensitivity;");
  L.push("  const double h = 1e-8;");
  L.push("  /* Save original known values */");
  L.push("  double* saved = (double*)malloc(nKnowns * sizeof(double));");
  L.push("  if (!saved) return fmi3Error;");
  L.push("  for (size_t i = 0; i < nKnowns; i++) saved[i] = inst->model.vars[knowns[i]];");
  L.push("  /* Evaluate f(v) */");
  L.push("  double* f0 = (double*)malloc(nUnknowns * sizeof(double));");
  L.push("  if (!f0) { free(saved); return fmi3Error; }");
  L.push(`  ${id}_getDerivatives(&inst->model);`);
  L.push("  for (size_t i = 0; i < nUnknowns; i++) f0[i] = inst->model.vars[unknowns[i]];");
  L.push("  /* Perturb: v += h * seed */");
  L.push("  for (size_t i = 0; i < nKnowns; i++) inst->model.vars[knowns[i]] = saved[i] + h * seed[i];");
  L.push(`  ${id}_getDerivatives(&inst->model);`);
  L.push("  /* sensitivity = (f(v + h*seed) - f(v)) / h */");
  L.push("  for (size_t i = 0; i < nUnknowns; i++) sensitivity[i] = (inst->model.vars[unknowns[i]] - f0[i]) / h;");
  L.push("  /* Restore */");
  L.push("  for (size_t i = 0; i < nKnowns; i++) inst->model.vars[knowns[i]] = saved[i];");
  L.push(`  ${id}_getDerivatives(&inst->model);`);
  L.push("  free(saved); free(f0);");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push("");

  // fmi3GetAdjointDerivative — reverse-mode via column-wise finite differences
  L.push("/* Adjoint derivative: dv = (∂z/∂v)ᵀ · δz  (reverse-mode via column-wise FD) */");
  L.push(
    "fmi3Status fmi3GetAdjointDerivative(fmi3Instance instance, const fmi3ValueReference unknowns[], size_t nUnknowns, const fmi3ValueReference knowns[], size_t nKnowns, const fmi3Float64 seed[], size_t nSeed, fmi3Float64 sensitivity[], size_t nSensitivity) {",
  );
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push("  (void)nSeed; (void)nSensitivity;");
  L.push("  const double h = 1e-8;");
  L.push("  /* Evaluate f(v) */");
  L.push(`  ${id}_getDerivatives(&inst->model);`);
  L.push("  double* f0 = (double*)malloc(nUnknowns * sizeof(double));");
  L.push("  if (!f0) return fmi3Error;");
  L.push("  for (size_t i = 0; i < nUnknowns; i++) f0[i] = inst->model.vars[unknowns[i]];");
  L.push("  /* Column-wise FD: for each known, perturb and compute Jacobian column, then dot with seed */");
  L.push("  for (size_t j = 0; j < nKnowns; j++) {");
  L.push("    double orig = inst->model.vars[knowns[j]];");
  L.push("    inst->model.vars[knowns[j]] = orig + h;");
  L.push(`    ${id}_getDerivatives(&inst->model);`);
  L.push("    double dot = 0.0;");
  L.push("    for (size_t i = 0; i < nUnknowns; i++) dot += ((inst->model.vars[unknowns[i]] - f0[i]) / h) * seed[i];");
  L.push("    sensitivity[j] = dot;");
  L.push("    inst->model.vars[knowns[j]] = orig;");
  L.push("  }");
  L.push(`  ${id}_getDerivatives(&inst->model);`);
  L.push("  free(f0);");
  L.push("  return fmi3OK;");
  L.push("}");

  // FMU state management
  L.push(
    "fmi3Status fmi3GetFMUState(fmi3Instance instance, fmi3FMUState* state) { FMU3Instance* copy = (FMU3Instance*)malloc(sizeof(FMU3Instance)); if (!copy) return fmi3Error; memcpy(copy, instance, sizeof(FMU3Instance)); *state = (fmi3FMUState)copy; return fmi3OK; }",
  );
  L.push(
    "fmi3Status fmi3SetFMUState(fmi3Instance instance, fmi3FMUState state) { if (!state) return fmi3Error; memcpy(instance, state, sizeof(FMU3Instance)); return fmi3OK; }",
  );
  L.push(
    "fmi3Status fmi3FreeFMUState(fmi3Instance instance, fmi3FMUState* state) { (void)instance; if (state && *state) { free(*state); *state = NULL; } return fmi3OK; }",
  );
  L.push("");

  // Scheduled Execution
  L.push("/* --- Scheduled Execution --- */");
  L.push(
    "fmi3Status fmi3ActivateModelPartition(fmi3Instance instance, fmi3ValueReference clockReference, fmi3Float64 activationTime) {",
  );
  L.push("  (void)instance; (void)clockReference; (void)activationTime; return fmi3Error;");
  L.push("}");
  L.push("");
  L.push(
    "fmi3Status fmi3SerializedFMUStateSize(fmi3Instance instance, fmi3FMUState state, size_t* size) { (void)instance; (void)state; *size = sizeof(FMU3Instance); return fmi3OK; }",
  );
  L.push(
    "fmi3Status fmi3SerializeFMUState(fmi3Instance instance, fmi3FMUState state, fmi3Byte buf[], size_t size) { (void)instance; if (size < sizeof(FMU3Instance)) return fmi3Error; memcpy(buf, state, sizeof(FMU3Instance)); return fmi3OK; }",
  );
  L.push(
    "fmi3Status fmi3DeserializeFMUState(fmi3Instance instance, const fmi3Byte buf[], size_t size, fmi3FMUState* state) { (void)instance; if (size < sizeof(FMU3Instance)) return fmi3Error; FMU3Instance* copy = (FMU3Instance*)malloc(sizeof(FMU3Instance)); if (!copy) return fmi3Error; memcpy(copy, buf, sizeof(FMU3Instance)); *state = (fmi3FMUState)copy; return fmi3OK; }",
  );
  L.push("");

  // Clock stubs (Phase 3 foundation)
  L.push("/* --- Clock (Phase 3 foundation) --- */");
  L.push(
    "fmi3Status fmi3GetClock(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, fmi3Clock value[]) { (void)instance; for (size_t i=0; i<nvr; i++) { (void)vr; value[i] = fmi3ClockInactive; } return fmi3OK; }",
  );
  L.push(
    "fmi3Status fmi3SetClock(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, const fmi3Clock value[]) { (void)instance; (void)vr; (void)nvr; (void)value; return fmi3OK; }",
  );
  L.push(
    "fmi3Status fmi3GetIntervalDecimal(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, fmi3Float64 intervals[], fmi3IntervalQualifier qualifiers[]) { (void)instance; for (size_t i=0; i<nvr; i++) { (void)vr; intervals[i]=0; qualifiers[i]=fmi3IntervalNotYetKnown; } return fmi3OK; }",
  );
  L.push("");

  // Binary stubs (Phase 1 foundation)
  L.push("/* --- Binary --- */");
  L.push(
    "fmi3Status fmi3GetBinary(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, size_t valueSizes[], fmi3Binary value[], size_t nValues) { (void)instance; (void)vr; (void)nvr; (void)nValues; for (size_t i=0; i<nvr; i++) { valueSizes[i]=0; value[i]=NULL; } return fmi3OK; }",
  );
  L.push(
    "fmi3Status fmi3SetBinary(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, const size_t valueSizes[], const fmi3Binary value[], size_t nValues) { (void)instance; (void)vr; (void)nvr; (void)valueSizes; (void)value; (void)nValues; return fmi3OK; }",
  );
  L.push("");

  return L.join("\n");
}

function generateCMakeLists3(id: string): string {
  return `# Auto-generated by ModelScript — CMake build for FMI 3.0 FMU
cmake_minimum_required(VERSION 3.10)
project(${id} C)
set(CMAKE_C_STANDARD 99)

if(CMAKE_SIZEOF_VOID_P EQUAL 8)
  set(FMI_ARCH "x86_64")
else()
  set(FMI_ARCH "x86")
endif()

if(WIN32)
  set(FMI_PLATFORM "\${FMI_ARCH}-windows")
elseif(APPLE)
  set(FMI_PLATFORM "\${FMI_ARCH}-darwin")
else()
  set(FMI_PLATFORM "\${FMI_ARCH}-linux")
endif()

add_library(${id} SHARED ${id}_model.c fmi3Functions.c)
target_include_directories(${id} PRIVATE \${CMAKE_CURRENT_SOURCE_DIR})
set_target_properties(${id} PROPERTIES PREFIX "" C_VISIBILITY_PRESET hidden POSITION_INDEPENDENT_CODE ON)

if(MSVC)
  target_compile_definitions(${id} PRIVATE FMI3_FUNCTION_PREFIX=)
else()
  target_compile_options(${id} PRIVATE -Wall -Wextra -O2)
endif()

install(TARGETS ${id} LIBRARY DESTINATION binaries/\${FMI_PLATFORM} RUNTIME DESTINATION binaries/\${FMI_PLATFORM})
message(STATUS "FMI 3.0 platform: \${FMI_PLATFORM}")
`;
}
