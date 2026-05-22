// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMI 3.0 C source code generator.
 *
 * Transpiles an ArenaDAEBuilder expression tree into standalone C source files
 * that implement the FMI 3.0 API.
 */

import { ArenaDAEBuilder, BinOp, EqKind, ExprKind, UnaryOp, Variability } from "@modelscript/compiler";
import type { Fmi3Options, Fmi3Result, Fmi3Variable } from "./fmi3.js";
import { binaryOpToC, escapeCString, formatCDouble, mapFunctionName, sanitizeIdentifier } from "./transpiler-utils.js";

export interface Fmi3CSourceFiles {
  modelH: string;
  modelC: string;
  fmi3FunctionsC: string;
  cmakeLists: string;
}

export function generateFmi3CSources(dae: ArenaDAEBuilder, result: Fmi3Result, options: Fmi3Options): Fmi3CSourceFiles {
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

// ── Expression → C transpiler ──

function exprToC(dae: ArenaDAEBuilder, id: number, vars: Fmi3Variable[], loopIdx?: string): string {
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
      return varToC(dae, dae.interner.resolve(dae.getExprData1(id)), vars, loopIdx);
    case ExprKind.Unary: {
      const uop = dae.getExprData1(id) as UnaryOp;
      const op = uop === UnaryOp.Not ? "!" : "-";
      return `(${op}${exprToC(dae, dae.getExprLeft(id), vars, loopIdx)})`;
    }
    case ExprKind.Negate:
      return `(-${exprToC(dae, dae.getExprLeft(id), vars, loopIdx)})`;
    case ExprKind.Der: {
      const op = dae.getExprData1(id);
      const name = dae.interner.resolve(dae.getExprData1(op));
      return varToC(dae, `der(${name})`, vars, loopIdx);
    }
    case ExprKind.Pre: {
      const op = dae.getExprData1(id);
      const name = dae.interner.resolve(dae.getExprData1(op));
      return varToC(dae, `pre(${name})`, vars, loopIdx);
    }
    case ExprKind.Binary: {
      const op = dae.getExprData1(id) as BinOp;
      const lhs = exprToC(dae, dae.getExprLeft(id), vars, loopIdx);
      const rhs = exprToC(dae, dae.getExprRight(id), vars, loopIdx);
      const opStr = binaryOpToC(op);
      if (opStr === "pow") return `pow(${lhs}, ${rhs})`;
      return `(${lhs} ${opStr} ${rhs})`;
    }
    case ExprKind.Call: {
      const fname = dae.interner.resolve(dae.getExprData1(id));
      const argCount = dae.getExprRight(id);
      const args: string[] = [];
      for (let i = 0; i < argCount; i++) {
        args.push(exprToC(dae, dae.getExprLeft(id + i), vars, loopIdx));
      }
      return `${mapFunctionName(fname)}(${args.join(", ")})`;
    }
    case ExprKind.IfElse: {
      const cond = exprToC(dae, dae.getExprData1(id), vars, loopIdx);
      const then = exprToC(dae, dae.getExprLeft(id), vars, loopIdx);
      const els = exprToC(dae, dae.getExprRight(id), vars, loopIdx);
      return `(${cond} ? ${then} : ${els})`;
    }
    default:
      return "0.0 /* unknown */";
  }
}

function varToC(dae: ArenaDAEBuilder, name: string, vars: Fmi3Variable[], loopIdx?: string): string {
  if (name === "time") return "inst->time";
  const m = name.match(/^der\((.+)\)$/);
  const baseName = m ? (m[1] ?? "") : name;
  const sv = vars.find((v) => v.name === baseName);

  if (!sv) return `0.0 /* unknown ${name} */`;

  const size = sv.dimensions ? sv.dimensions.reduce((a, b) => a * (b.start ?? 1), 1) : 1;
  let idxStr = sv.valueReference.toString();
  if (size > 1 && loopIdx) idxStr += ` + ${loopIdx}`;

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

function conditionToZC(dae: ArenaDAEBuilder, condId: number, vars: Fmi3Variable[]): string {
  if (condId < 0) return "0.0";
  if (dae.getExprKind(condId) === ExprKind.Binary) {
    const op = dae.getExprData1(condId) as BinOp;
    if (op === BinOp.Lt || op === BinOp.Lte || op === BinOp.Gt || op === BinOp.Gte) {
      return `(${exprToC(dae, dae.getExprLeft(condId), vars)}) - (${exprToC(dae, dae.getExprRight(condId), vars)})`;
    }
  }
  return `(${exprToC(dae, condId, vars)} ? 1.0 : -1.0)`;
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

function generateModelC3(id: string, dae: ArenaDAEBuilder, result: Fmi3Result): string {
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
  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;
    const variability = dae.getVarVariability(i);
    const vName = dae.getVarName(i);
    if (variability === Variability.Parameter || variability === Variability.Constant) {
      const ref = vrMap.get(vName);
      const expr = dae.getVarExpression(i) as number | undefined;
      if (ref !== undefined && expr !== undefined && typeof expr === "number" && expr >= 0)
        L.push(`  inst->vars[${ref}] = ${exprToC(dae, expr, result.variables)};  /* ${vName} */`);
    }
  }
  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;
    const variability = dae.getVarVariability(i);
    const vName = dae.getVarName(i);
    if (variability === undefined || variability === null) {
      const ref = vrMap.get(vName);
      if (ref !== undefined) {
        const startAttr = dae.getVarAttrExprId(i, "start");
        const expr = dae.getVarExpression(i) as number | undefined;
        const e = startAttr !== undefined && startAttr >= 0 ? startAttr : expr;
        if (e !== undefined && typeof e === "number" && e >= 0) {
          L.push(`  inst->vars[${ref}] = ${exprToC(dae, e, result.variables)};  /* ${vName} */`);
        }
      }
    }
  }
  L.push("}");
  L.push("");

  // Derivatives
  L.push(`void ${id}_getDerivatives(${id}_Instance* inst) {`);
  L.push("  double time = inst->time; (void)time;");
  L.push("");

  // Create local aliases only for referenced variables
  const referencedNames = new Set<string>();
  for (let idx = 0; idx < dae.eqCount; idx++) {
    collectReferencedNames(dae, dae.getEqLhs(idx), referencedNames);
    collectReferencedNames(dae, dae.getEqRhs(idx), referencedNames);
  }
  for (const sv of result.variables) {
    if (sv.causality === "independent") continue;
    if (!referencedNames.has(sv.name)) continue;
    const cName = sanitize(sv.name);
    L.push(`  double ${cName} = inst->vars[${sv.valueReference}];`);
  }
  L.push("");

  let derIdx = 0;
  for (let idx = 0; idx < dae.eqCount; idx++) {
    const lhs = dae.getEqLhs(idx);
    const rhs = dae.getEqRhs(idx);
    const ld = extractDerName(dae, lhs);
    const rd = extractDerName(dae, rhs);

    if (ld) {
      L.push(`  inst->derivatives[${derIdx}] = ${exprToC(dae, rhs, result.variables)};  /* der(${ld}) */`);
      derIdx++;
    } else if (rd) {
      L.push(`  inst->derivatives[${derIdx}] = ${exprToC(dae, lhs, result.variables)};  /* der(${rd}) */`);
      derIdx++;
    }
  }
  L.push("}");
  L.push("");

  // Event indicators
  const whenEqIdxs: number[] = [];
  for (let idx = 0; idx < dae.eqCount; idx++) {
    if (dae.getEqKind(idx) === EqKind.When) {
      whenEqIdxs.push(idx);
    }
  }

  L.push(`void ${id}_getEventIndicators(${id}_Instance* inst, double* indicators) {`);
  if (whenEqIdxs.length === 0) {
    L.push("  (void)inst; (void)indicators;");
  } else {
    // Local aliases for indicators
    const eventReferencedNames = new Set<string>();
    for (const eqIdx of whenEqIdxs) {
      const weq = dae.getWhenEquationMeta(eqIdx);
      if (weq) {
        collectReferencedNames(dae, weq.conditionExprId, eventReferencedNames);
        for (const c of weq.elseWhenClauses) {
          collectReferencedNames(dae, c.conditionExprId, eventReferencedNames);
        }
      }
    }
    for (const sv of result.variables) {
      if (sv.causality === "independent") continue;
      if (!eventReferencedNames.has(sv.name)) continue;
      const cName = sanitize(sv.name);
      L.push(`  double ${cName} = inst->vars[${sv.valueReference}];`);
    }
    L.push("");

    let idx = 0;
    for (const eqIdx of whenEqIdxs) {
      const weq = dae.getWhenEquationMeta(eqIdx);
      if (weq) {
        L.push(`  indicators[${idx}] = ${conditionToZC(dae, weq.conditionExprId, result.variables)};`);
        idx++;
        for (const c of weq.elseWhenClauses) {
          L.push(`  indicators[${idx}] = ${conditionToZC(dae, c.conditionExprId, result.variables)};`);
          idx++;
        }
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
  dae: ArenaDAEBuilder,
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
    L.push(`  void* extObj_${ei}; /* ${eo.className} */`);
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

  // Mutable dimension support
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
      L.push(`  inst->extObj_${ei} = (void*)${ctorName}();  /* ${eo.className} */`);
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
      L.push(`  inst->extObj_${ei} = (void*)${ctorName}();  /* ${eo.className} */`);
    }
    L.push("");
  }

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
