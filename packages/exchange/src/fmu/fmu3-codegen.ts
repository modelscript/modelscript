// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMI 3.0 C source code generator.
 *
 * Transpiles an DAEBuilder expression tree into standalone C source files
 * that implement the FMI 3.0 API.
 */

import { BinOp, DAEBuilder, EqKind, ExprKind, UnaryOp, Variability } from "@modelscript/runtime";
import type { Fmi3Options, Fmi3Result, Fmi3Variable } from "./fmi3.js";
import { binaryOpToC, escapeCString, formatCDouble, mapFunctionName, sanitizeIdentifier } from "./transpiler-utils.js";

export interface Fmi3CSourceFiles {
  modelH: string;
  modelC: string;
  fmi3FunctionsC: string;
  cmakeLists: string;
}

export function generateFmi3CSources(dae: DAEBuilder, result: Fmi3Result, options: Fmi3Options): Fmi3CSourceFiles {
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

function exprToC(dae: DAEBuilder, id: number, vars: Fmi3Variable[], loopIdx?: string): string {
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
      return exprToC(dae, op, vars, loopIdx);
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
      if (fname === "pre" && argCount === 1) {
        return exprToC(dae, dae.getExprLeft(id), vars, loopIdx);
      }
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

function varToC(_dae: DAEBuilder, name: string, vars: Fmi3Variable[], loopIdx?: string): string {
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

function conditionToZC(dae: DAEBuilder, condId: number, vars: Fmi3Variable[]): string {
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
  L.push("  void* fmuInstance;");
  L.push("  void (*logger)(void*, const char*, const char*);");
  L.push("  void (*terminate)(void*);");
  L.push(`} ${id}_Instance;`);
  L.push("");
  L.push(`void ${id}_initialize(${id}_Instance* inst);`);
  L.push(`void ${id}_getDerivatives(${id}_Instance* inst);`);
  L.push(`void ${id}_getEventIndicators(${id}_Instance* inst, double* indicators);`);
  L.push("");
  L.push("#endif");
  return L.join("\n");
}

function generateModelC3(id: string, dae: DAEBuilder, result: Fmi3Result): string {
  const L: string[] = [];
  L.push("/* Auto-generated by ModelScript — FMI 3.0 */");
  L.push(`#include "${id}_model.h"`);
  L.push("#include <stdio.h>");
  L.push("");
  const vrMap = new Map<string, number>();
  for (const sv of result.variables) vrMap.set(sv.name, sv.valueReference);

  // Initialize
  L.push(`void ${id}_initialize(${id}_Instance* inst) {`);
  L.push("  void* savedFmu = inst->fmuInstance;");
  L.push("  void (*savedLogger)(void*, const char*, const char*) = inst->logger;");
  L.push("  void (*savedTerminate)(void*) = inst->terminate;");
  L.push("  memset(inst, 0, sizeof(*inst));");
  L.push("  inst->fmuInstance = savedFmu;");
  L.push("  inst->logger = savedLogger;");
  L.push("  inst->terminate = savedTerminate;");
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
    if (
      variability === undefined ||
      variability === null ||
      variability === Variability.Continuous ||
      variability === Variability.Discrete
    ) {
      const ref = vrMap.get(vName);
      if (ref !== undefined) {
        const startAttr = dae.getVarAttrExprId(i, "start");
        const expr = dae.getVarExpression(i) as number | undefined;
        const e = startAttr !== undefined && startAttr >= 0 ? startAttr : expr;
        if (e !== undefined && typeof e === "number" && e >= 0) {
          L.push(`  inst->vars[${ref}] = ${exprToC(dae, e, result.variables)};  /* ${vName} */`);
        } else {
          const startVal = dae.getVarStartValue(i);
          if (startVal !== 0) {
            L.push(`  inst->vars[${ref}] = ${formatCDouble(startVal)};  /* ${vName} */`);
          }
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
    L.push(`  double ${cName} = inst->vars[${sv.valueReference}]; (void)${cName};`);
  }
  L.push("");

  let derIdx = 0;
  for (let idx = 0; idx < dae.eqCount; idx++) {
    if (dae.getEqKind(idx) !== EqKind.Simple) continue;
    const lhs = dae.getEqLhs(idx);
    const rhs = dae.getEqRhs(idx);
    const ld = extractDerName(dae, lhs);
    const rd = extractDerName(dae, rhs);

    if (ld) {
      const rhsC = exprToC(dae, rhs, result.variables);
      L.push(`  inst->derivatives[${derIdx}] = ${rhsC};  /* der(${ld}) */`);
      const derRef = vrMap.get(`der(${ld})`);
      if (derRef !== undefined) L.push(`  inst->vars[${derRef}] = inst->derivatives[${derIdx}];`);
      derIdx++;
    } else if (rd) {
      const lhsC = exprToC(dae, lhs, result.variables);
      L.push(`  inst->derivatives[${derIdx}] = ${lhsC};  /* der(${rd}) */`);
      const derRef = vrMap.get(`der(${rd})`);
      if (derRef !== undefined) L.push(`  inst->vars[${derRef}] = inst->derivatives[${derIdx}];`);
      derIdx++;
    } else if (dae.getExprKind(lhs) === ExprKind.Name) {
      const lhsName = dae.interner.resolve(dae.getExprData1(lhs));
      const lhsRef = vrMap.get(lhsName);
      if (lhsRef !== undefined) {
        L.push(`  inst->vars[${lhsRef}] = ${exprToC(dae, rhs, result.variables)};  /* ${lhsName} */`);
      }
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
  if (whenEqIdxs.length === 0 && dae.eventIndicatorExprIds.length === 0) {
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
    for (const zcExprId of dae.eventIndicatorExprIds) {
      collectReferencedNames(dae, zcExprId, eventReferencedNames);
    }
    for (const sv of result.variables) {
      if (sv.causality === "independent") continue;
      if (!eventReferencedNames.has(sv.name)) continue;
      const cName = sanitize(sv.name);
      L.push(`  double ${cName} = inst->vars[${sv.valueReference}]; (void)${cName};`);
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
    for (const zcExprId of dae.eventIndicatorExprIds) {
      if (idx < result.numberOfEventIndicators) {
        L.push(`  indicators[${idx}] = ${conditionToZC(dae, zcExprId, result.variables)};`);
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
  _nStates: number,
  _nStringVars: number,
  dae: DAEBuilder,
  result: Fmi3Result,
): string {
  const L: string[] = [];

  // Extract state VRs corresponding to derivatives
  const stateVRs = result.modelStructure.derivatives.map((derVr) => {
    const derVar = result.variables.find((v) => v.valueReference === derVr);
    if (derVar?.derivative !== undefined) return derVar.derivative;
    const stateName = derVar?.name.replace(/^der\((.+)\)$/, "$1");
    return stateName ? (result.variables.find((v) => v.name === stateName)?.valueReference ?? -1) : -1;
  });

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
  L.push("  int state; /* 0=INIT, 1=STEP, 2=EVENT, 3=TERMINATED, 4=CONFIG */");
  L.push("  fmi3Clock clocks[N_VARS + 1];");
  L.push("  fmi3Float64 clockIntervals[N_VARS + 1];");
  L.push("  fmi3Float64 clockShifts[N_VARS + 1];");
  L.push("  fmi3UInt64 clockResolutions[N_VARS + 1];");
  // ExternalObject handle fields
  for (let ei = 0; ei < dae.externalObjects.length; ei++) {
    const eo = dae.externalObjects[ei];
    if (!eo) continue;
    L.push(`  void* extObj_${ei}; /* ${eo.className} */`);
  }
  L.push("  int terminateRequested;");
  L.push("} FMU3Instance;");
  L.push("#define FMU3_STATE_INIT   0");
  L.push("#define FMU3_STATE_STEP   1");
  L.push("#define FMU3_STATE_EVENT  2");
  L.push("#define FMU3_STATE_TERM   3");
  L.push("#define FMU3_STATE_CONFIG 4");
  L.push("");
  L.push("/* Variable size lookup table for array batching (FMI 3.0 §2.2.7) */");
  L.push("static const size_t varSizes[N_VARS + 1] = {");
  const sizeEntries: number[] = new Array(Math.max(1, nVars)).fill(1);
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
  L.push("  if (inst && inst->logMessage) {");
  L.push("    inst->logMessage(inst->instanceEnvironment, fmi3Error, category, message);");
  L.push("  }");
  L.push("}");
  L.push("static void fmi3_terminate_impl(void* fmuInstance) {");
  L.push("  FMU3Instance* inst = (FMU3Instance*)fmuInstance;");
  L.push("  if (inst) inst->terminateRequested = 1;");
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
  L.push("  for (int i = 0; i <= N_VARS; i++) { inst->clockIntervals[i] = 1.0; inst->clockResolutions[i] = 1; }");
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
      const ctorName = sanitizeIdentifier(eo.constructorName ?? "");
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
  L.push("  inst->stepSize = 0.001;");
  L.push("  inst->state = FMU3_STATE_INIT;");
  L.push("  for (int i = 0; i <= N_VARS; i++) { inst->clockIntervals[i] = 1.0; inst->clockResolutions[i] = 1; }");
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
      const ctorName = sanitizeIdentifier(eo.constructorName ?? "");
      L.push(`  inst->extObj_${ei} = (void*)${ctorName}();  /* ${eo.className} */`);
    }
    L.push("");
  }

  L.push("  return (fmi3Instance)inst;");
  L.push("}");
  L.push("");

  // fmi3InstantiateScheduledExecution
  L.push("fmi3Instance fmi3InstantiateScheduledExecution(");
  L.push("    fmi3String instanceName, fmi3String instantiationToken, fmi3String resourcePath,");
  L.push("    fmi3Boolean visible, fmi3Boolean loggingOn,");
  L.push("    fmi3InstanceEnvironment instanceEnvironment, fmi3LogMessageCallback logMessage,");
  L.push("    fmi3ClockUpdateCallback clockUpdate, fmi3LockPreemptionCallback lockPreemption,");
  L.push("    fmi3UnlockPreemptionCallback unlockPreemption) {");
  L.push("  (void)clockUpdate; (void)lockPreemption; (void)unlockPreemption;");
  L.push(
    "  return fmi3InstantiateModelExchange(instanceName, instantiationToken, resourcePath, visible, loggingOn, instanceEnvironment, logMessage);",
  );
  L.push("}");
  L.push("");

  // fmi3FreeInstance
  L.push("void fmi3FreeInstance(fmi3Instance instance) {");
  L.push("  if (!instance) return;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  if (dae.externalObjects.length > 0) {
    L.push("  /* --- ExternalObject destructors --- */");
    for (let ei = 0; ei < dae.externalObjects.length; ei++) {
      const eo = dae.externalObjects[ei];
      if (!eo) continue;
      const dtorName = sanitizeIdentifier(eo.destructorName ?? "");
      L.push(`  if (inst->extObj_${ei}) ${dtorName}(inst->extObj_${ei});`);
    }
  }
  L.push("  for (int i = 0; i < N_STRING_VARS; i++) {");
  L.push("    if (inst->model.stringVars[i]) free(inst->model.stringVars[i]);");
  L.push("  }");
  L.push("  free(inst);");
  L.push("}");
  L.push("");

  L.push('const char* fmi3GetVersion(void) { return "3.0"; }');
  L.push("");
  L.push(
    "fmi3Status fmi3SetDebugLogging(fmi3Instance instance, fmi3Boolean loggingOn, size_t nCategories, const fmi3String categories[]) {",
  );
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push("  inst->loggingOn = loggingOn;");
  L.push("  (void)nCategories; (void)categories;");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push("");

  // Initialization & Mode Transitions
  L.push(
    "fmi3Status fmi3EnterInitializationMode(fmi3Instance instance, fmi3Boolean toleranceDefined, fmi3Float64 tolerance, fmi3Float64 startTime, fmi3Boolean stopTimeDefined, fmi3Float64 stopTime) {",
  );
  L.push("  if (!instance) return fmi3Error;");
  L.push("  (void)toleranceDefined; (void)tolerance;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push("  inst->startTime = startTime;");
  L.push("  if (stopTimeDefined) inst->stopTime = stopTime;");
  L.push("  inst->model.time = startTime;");
  L.push("  inst->state = FMU3_STATE_INIT;");
  L.push(`  ${id}_getDerivatives(&inst->model);`);
  L.push("  return fmi3OK;");
  L.push("}");
  L.push("");
  L.push("fmi3Status fmi3ExitInitializationMode(fmi3Instance instance) {");
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push(`  ${id}_getDerivatives(&inst->model);`);
  L.push("  inst->state = FMU3_STATE_STEP;");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push("");
  L.push("fmi3Status fmi3EnterEventMode(fmi3Instance instance) {");
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push("  inst->state = FMU3_STATE_EVENT;");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push("");
  L.push("fmi3Status fmi3EnterStepMode(fmi3Instance instance) {");
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push("  inst->state = FMU3_STATE_STEP;");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push("");
  L.push("fmi3Status fmi3EnterContinuousTimeMode(fmi3Instance instance) {");
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push("  inst->state = FMU3_STATE_STEP;");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push("");
  L.push("fmi3Status fmi3EnterConfigurationMode(fmi3Instance instance) {");
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push("  inst->state = FMU3_STATE_CONFIG;");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push("");
  L.push("fmi3Status fmi3ExitConfigurationMode(fmi3Instance instance) {");
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push("  inst->state = FMU3_STATE_STEP;");
  L.push(`  ${id}_getDerivatives(&inst->model);`);
  L.push("  return fmi3OK;");
  L.push("}");
  L.push("");
  L.push("fmi3Status fmi3Terminate(fmi3Instance instance) {");
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push("  inst->state = FMU3_STATE_TERM;");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push("");
  L.push("fmi3Status fmi3Reset(fmi3Instance instance) {");
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push("  inst->state = FMU3_STATE_INIT;");
  L.push("  inst->terminateRequested = 0;");
  L.push(`  ${id}_initialize(&inst->model);`);
  L.push("  return fmi3OK;");
  L.push("}");
  L.push("");

  // Numeric Getters & Setters
  const numericTypes = ["Float32", "Float64", "Int8", "UInt8", "Int16", "UInt16", "Int32", "UInt32", "Int64", "UInt64"];
  for (const t of numericTypes) {
    L.push(
      `fmi3Status fmi3Get${t}(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, fmi3${t} value[], size_t nValues) {`,
    );
    L.push("  if (!instance) return fmi3Error;");
    L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
    L.push(`  if (nvr > 0) ${id}_getDerivatives(&inst->model);`);
    L.push("  size_t vIdx = 0;");
    L.push("  for (size_t i = 0; i < nvr; i++) {");
    L.push("    size_t size = (vr[i] < N_VARS) ? varSizes[vr[i]] : 1;");
    L.push("    for (size_t j = 0; j < size; j++) {");
    L.push("      if (vIdx >= nValues) return fmi3Error;");
    L.push(`      if (vr[i] + j < N_VARS) value[vIdx++] = (fmi3${t})inst->model.vars[vr[i] + j];`);
    L.push(`      else if (vr[i] == N_VARS) value[vIdx++] = (fmi3${t})inst->model.time;`);
    L.push(`      else value[vIdx++] = (fmi3${t})0;`);
    L.push("    }");
    L.push("  }");
    L.push("  return fmi3OK;");
    L.push("}");
    L.push(
      `fmi3Status fmi3Set${t}(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, const fmi3${t} value[], size_t nValues) {`,
    );
    L.push("  if (!instance) return fmi3Error;");
    L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
    L.push("  size_t vIdx = 0;");
    L.push("  for (size_t i = 0; i < nvr; i++) {");
    if (hasMutableDims) {
      L.push(
        "    if (isMutableDimVR(vr[i]) && inst->state != FMU3_STATE_CONFIG && inst->state != FMU3_STATE_INIT) return fmi3Error;",
      );
    }
    L.push("    size_t size = (vr[i] < N_VARS) ? varSizes[vr[i]] : 1;");
    L.push("    for (size_t j = 0; j < size; j++) {");
    L.push("      if (vIdx >= nValues) return fmi3Error;");
    L.push("      if (vr[i] + j < N_VARS) inst->model.vars[vr[i] + j] = (double)value[vIdx++];");
    L.push("      else if (vr[i] == N_VARS) inst->model.time = (double)value[vIdx++];");
    L.push("      else vIdx++;");
    L.push("    }");
    L.push("  }");
    L.push("  inst->model.isDirtyValues = 1;");
    L.push("  return fmi3OK;");
    L.push("}");
    L.push("");
  }

  // Boolean, String, Binary, Clock Getters & Setters
  L.push(
    "fmi3Status fmi3GetBoolean(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, fmi3Boolean value[], size_t nValues) {",
  );
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance; (void)nValues;");
  L.push(`  if (nvr > 0) ${id}_getDerivatives(&inst->model);`);
  L.push("  for (size_t i = 0; i < nvr; i++) {");
  L.push("    value[i] = (vr[i] < N_VARS && inst->model.vars[vr[i]] != 0.0) ? fmi3True : fmi3False;");
  L.push("  }");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3SetBoolean(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, const fmi3Boolean value[], size_t nValues) {",
  );
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance; (void)nValues;");
  L.push("  for (size_t i = 0; i < nvr; i++) {");
  L.push("    if (vr[i] < N_VARS) inst->model.vars[vr[i]] = value[i] ? 1.0 : 0.0;");
  L.push("  }");
  L.push("  inst->model.isDirtyValues = 1;");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push("");

  L.push(
    "fmi3Status fmi3GetString(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, fmi3String value[], size_t nValues) {",
  );
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance; (void)nValues;");
  L.push("  for (size_t i = 0; i < nvr; i++) {");
  L.push(
    '    value[i] = (vr[i] < N_STRING_VARS && inst->model.stringVars[vr[i]]) ? inst->model.stringVars[vr[i]] : "";',
  );
  L.push("  }");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3SetString(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, const fmi3String value[], size_t nValues) {",
  );
  L.push("  if (!instance) return fmi3Error;");
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

  L.push(
    "fmi3Status fmi3GetBinary(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, size_t valueSizes[], fmi3Binary value[], size_t nValues) {",
  );
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance; (void)nValues;");
  L.push("  for (size_t i = 0; i < nvr; i++) {");
  L.push("    if (vr[i] < N_STRING_VARS && inst->model.stringVars[vr[i]]) {");
  L.push("      valueSizes[i] = strlen(inst->model.stringVars[vr[i]]);");
  L.push("      value[i] = (fmi3Binary)inst->model.stringVars[vr[i]];");
  L.push("    } else {");
  L.push("      valueSizes[i] = 0;");
  L.push("      value[i] = NULL;");
  L.push("    }");
  L.push("  }");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3SetBinary(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, const size_t valueSizes[], const fmi3Binary value[], size_t nValues) {",
  );
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance; (void)nValues;");
  L.push("  for (size_t i = 0; i < nvr; i++) {");
  L.push("    if (vr[i] < N_STRING_VARS) {");
  L.push("      if (inst->model.stringVars[vr[i]]) free(inst->model.stringVars[vr[i]]);");
  L.push("      if (value[i] && valueSizes[i] > 0) {");
  L.push("        inst->model.stringVars[vr[i]] = (char*)malloc(valueSizes[i] + 1);");
  L.push("        if (inst->model.stringVars[vr[i]]) {");
  L.push("          memcpy(inst->model.stringVars[vr[i]], value[i], valueSizes[i]);");
  L.push("          inst->model.stringVars[vr[i]][valueSizes[i]] = '\\0';");
  L.push("        }");
  L.push("      } else {");
  L.push("        inst->model.stringVars[vr[i]] = NULL;");
  L.push("      }");
  L.push("    }");
  L.push("  }");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push("");

  L.push(
    "fmi3Status fmi3GetClock(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, fmi3Clock value[], size_t nValues) {",
  );
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance; (void)nValues;");
  L.push("  for (size_t i = 0; i < nvr; i++) {");
  L.push("    if (vr[i] <= N_VARS) {");
  L.push("      value[i] = inst->clocks[vr[i]];");
  L.push("      inst->clocks[vr[i]] = fmi3ClockInactive;");
  L.push("    } else {");
  L.push("      value[i] = fmi3ClockInactive;");
  L.push("    }");
  L.push("  }");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3SetClock(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, const fmi3Clock value[], size_t nValues) {",
  );
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance; (void)nValues;");
  L.push("  for (size_t i = 0; i < nvr; i++) {");
  L.push("    if (vr[i] <= N_VARS) {");
  L.push("      inst->clocks[vr[i]] = value[i];");
  L.push("      if (vr[i] < N_VARS) inst->model.vars[vr[i]] = value[i] ? 1.0 : 0.0;");
  L.push("    }");
  L.push("  }");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push("");

  // Continuous States & Model Exchange
  L.push("fmi3Status fmi3SetTime(fmi3Instance instance, fmi3Float64 time) {");
  L.push("  if (!instance) return fmi3Error;");
  L.push("  ((FMU3Instance*)instance)->model.time = time;");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3SetContinuousStates(fmi3Instance instance, const fmi3Float64 continuousStates[], size_t nContinuousStates) {",
  );
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  for (let i = 0; i < stateVRs.length; i++) {
    const vr = stateVRs[i];
    if (vr !== undefined && vr >= 0) {
      L.push(
        `  if (${i} < nContinuousStates) { inst->model.vars[${vr}] = continuousStates[${i}]; inst->model.states[${i}] = continuousStates[${i}]; }`,
      );
    }
  }
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3GetContinuousStates(fmi3Instance instance, fmi3Float64 continuousStates[], size_t nContinuousStates) {",
  );
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  for (let i = 0; i < stateVRs.length; i++) {
    const vr = stateVRs[i];
    if (vr !== undefined && vr >= 0) {
      L.push(`  if (${i} < nContinuousStates) continuousStates[${i}] = inst->model.vars[${vr}];`);
    }
  }
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3GetContinuousStateDerivatives(fmi3Instance instance, fmi3Float64 derivatives[], size_t nContinuousStates) {",
  );
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push(`  ${id}_getDerivatives(&inst->model);`);
  L.push("  for (size_t i = 0; i < nContinuousStates && i < N_STATES; i++) {");
  L.push("    derivatives[i] = inst->model.derivatives[i];");
  L.push("  }");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3GetEventIndicators(fmi3Instance instance, fmi3Float64 eventIndicators[], size_t nEventIndicators) {",
  );
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push("  if (N_EVENT_INDICATORS > 0 && nEventIndicators > 0) {");
  L.push(`    ${id}_getEventIndicators(&inst->model, eventIndicators);`);
  L.push("  }");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3GetNominalsOfContinuousStates(fmi3Instance instance, fmi3Float64 nominals[], size_t nContinuousStates) {",
  );
  L.push("  if (!instance) return fmi3Error;");
  L.push("  for (size_t i = 0; i < nContinuousStates; i++) nominals[i] = 1.0;");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3GetNumberOfContinuousStates(fmi3Instance instance, size_t* nContinuousStates) { if (!instance || !nContinuousStates) return fmi3Error; *nContinuousStates = N_STATES; return fmi3OK; }",
  );
  L.push(
    "fmi3Status fmi3GetNumberOfEventIndicators(fmi3Instance instance, size_t* nEventIndicators) { if (!instance || !nEventIndicators) return fmi3Error; *nEventIndicators = N_EVENT_INDICATORS; return fmi3OK; }",
  );
  L.push(
    "fmi3Status fmi3CompletedIntegratorStep(fmi3Instance instance, fmi3Boolean noSetFMUStatePriorToCurrentPoint, fmi3Boolean* enterEventMode, fmi3Boolean* terminateSimulation) {",
  );
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push("  (void)noSetFMUStatePriorToCurrentPoint;");
  L.push("  if (enterEventMode) *enterEventMode = fmi3False;");
  L.push("  if (terminateSimulation) *terminateSimulation = inst->terminateRequested ? fmi3True : fmi3False;");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3UpdateDiscreteStates(fmi3Instance instance, fmi3Boolean* discreteStatesNeedUpdate, fmi3Boolean* terminateSimulation, fmi3Boolean* nominalsOfContinuousStatesChanged, fmi3Boolean* valuesOfContinuousStatesChanged, fmi3Boolean* nextEventTimeDefined, fmi3Float64* nextEventTime) {",
  );
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push("  if (discreteStatesNeedUpdate) *discreteStatesNeedUpdate = fmi3False;");
  L.push("  if (terminateSimulation) *terminateSimulation = inst->terminateRequested ? fmi3True : fmi3False;");
  L.push("  if (nominalsOfContinuousStatesChanged) *nominalsOfContinuousStatesChanged = fmi3False;");
  L.push("  if (valuesOfContinuousStatesChanged) *valuesOfContinuousStatesChanged = fmi3False;");
  L.push("  if (nextEventTimeDefined) *nextEventTimeDefined = fmi3False;");
  L.push("  if (nextEventTime) *nextEventTime = 0.0;");
  L.push(`  ${id}_getDerivatives(&inst->model);`);
  L.push("  return fmi3OK;");
  L.push("}");
  L.push("fmi3Status fmi3EvaluateDiscreteStates(fmi3Instance instance) {");
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push(`  ${id}_getDerivatives(&inst->model);`);
  L.push("  return fmi3OK;");
  L.push("}");
  L.push("");

  // Co-Simulation fmi3DoStep with RK4
  L.push(
    "fmi3Status fmi3DoStep(fmi3Instance instance, fmi3Float64 currentCommunicationPoint, fmi3Float64 communicationStepSize, fmi3Boolean noSetFMUStatePriorToCurrentPoint,",
  );
  L.push(
    "    fmi3Boolean* eventHandlingNeeded, fmi3Boolean* terminateSimulation, fmi3Boolean* earlyReturn, fmi3Float64* lastSuccessfulTime) {",
  );
  L.push("  if (!instance) return fmi3Fatal;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push("  (void)noSetFMUStatePriorToCurrentPoint;");
  L.push("  double t = currentCommunicationPoint;");
  L.push("  double tEnd = currentCommunicationPoint + communicationStepSize;");
  L.push("  double maxH = inst->stepSize > 0.0 ? inst->stepSize : communicationStepSize;");
  L.push("  while (t < tEnd - 1e-13) {");
  L.push("    double h = (t + maxH > tEnd) ? (tEnd - t) : maxH;");
  if (stateVRs.length > 0) {
    L.push("    double y0[N_STATES + 1], k1[N_STATES + 1], k2[N_STATES + 1], k3[N_STATES + 1], k4[N_STATES + 1];");
    for (let i = 0; i < stateVRs.length; i++) {
      const vr = stateVRs[i];
      if (vr !== undefined && vr >= 0) L.push(`    y0[${i}] = inst->model.vars[${vr}];`);
    }
    L.push("    inst->model.time = t;");
    L.push(`    ${id}_getDerivatives(&inst->model);`);
    L.push("    for (int i = 0; i < N_STATES; i++) k1[i] = inst->model.derivatives[i];");
    L.push("    inst->model.time = t + 0.5 * h;");
    for (let i = 0; i < stateVRs.length; i++) {
      const vr = stateVRs[i];
      if (vr !== undefined && vr >= 0) L.push(`    inst->model.vars[${vr}] = y0[${i}] + 0.5 * h * k1[${i}];`);
    }
    L.push(`    ${id}_getDerivatives(&inst->model);`);
    L.push("    for (int i = 0; i < N_STATES; i++) k2[i] = inst->model.derivatives[i];");
    for (let i = 0; i < stateVRs.length; i++) {
      const vr = stateVRs[i];
      if (vr !== undefined && vr >= 0) L.push(`    inst->model.vars[${vr}] = y0[${i}] + 0.5 * h * k2[${i}];`);
    }
    L.push(`    ${id}_getDerivatives(&inst->model);`);
    L.push("    for (int i = 0; i < N_STATES; i++) k3[i] = inst->model.derivatives[i];");
    L.push("    inst->model.time = t + h;");
    for (let i = 0; i < stateVRs.length; i++) {
      const vr = stateVRs[i];
      if (vr !== undefined && vr >= 0) L.push(`    inst->model.vars[${vr}] = y0[${i}] + h * k3[${i}];`);
    }
    L.push(`    ${id}_getDerivatives(&inst->model);`);
    L.push("    for (int i = 0; i < N_STATES; i++) k4[i] = inst->model.derivatives[i];");
    for (let i = 0; i < stateVRs.length; i++) {
      const vr = stateVRs[i];
      if (vr !== undefined && vr >= 0) {
        L.push(
          `    inst->model.vars[${vr}] = y0[${i}] + (h / 6.0) * (k1[${i}] + 2.0 * k2[${i}] + 2.0 * k3[${i}] + k4[${i}]);`,
        );
      }
    }
  }
  L.push("    t += h;");
  L.push("    inst->model.time = t;");
  L.push(`    ${id}_getDerivatives(&inst->model);`);
  L.push("  }");
  L.push("  if (eventHandlingNeeded) *eventHandlingNeeded = fmi3False;");
  L.push("  if (terminateSimulation) *terminateSimulation = inst->terminateRequested ? fmi3True : fmi3False;");
  L.push("  if (earlyReturn) *earlyReturn = fmi3False;");
  L.push("  if (lastSuccessfulTime) *lastSuccessfulTime = tEnd;");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push("");

  // Scheduled Execution
  L.push(
    "fmi3Status fmi3ActivateModelPartition(fmi3Instance instance, fmi3ValueReference clockReference, fmi3Float64 activationTime) {",
  );
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push("  inst->model.time = activationTime;");
  L.push("  if (clockReference <= N_VARS) inst->clocks[clockReference] = fmi3ClockActive;");
  L.push(`  ${id}_getDerivatives(&inst->model);`);
  L.push("  return fmi3OK;");
  L.push("}");
  L.push("");

  // FMU State Serialization & Cloning
  L.push("fmi3Status fmi3GetFMUState(fmi3Instance instance, fmi3FMUState* FMUState) {");
  L.push("  if (!instance || !FMUState) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push("  FMU3Instance* copy = (FMU3Instance*)malloc(sizeof(FMU3Instance));");
  L.push("  if (!copy) return fmi3Error;");
  L.push("  memcpy(copy, inst, sizeof(FMU3Instance));");
  L.push("  for (int i = 0; i < N_STRING_VARS; i++) {");
  L.push("    copy->model.stringVars[i] = inst->model.stringVars[i] ? strdup(inst->model.stringVars[i]) : NULL;");
  L.push("  }");
  L.push("  *FMUState = (fmi3FMUState)copy;");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push("fmi3Status fmi3SetFMUState(fmi3Instance instance, fmi3FMUState FMUState) {");
  L.push("  if (!instance || !FMUState) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push("  FMU3Instance* src = (FMU3Instance*)FMUState;");
  L.push("  for (int i = 0; i < N_STRING_VARS; i++) {");
  L.push("    if (inst->model.stringVars[i]) free(inst->model.stringVars[i]);");
  L.push("  }");
  L.push("  inst->model = src->model;");
  L.push("  inst->model.fmuInstance = inst;");
  L.push("  for (int i = 0; i < N_STRING_VARS; i++) {");
  L.push("    inst->model.stringVars[i] = src->model.stringVars[i] ? strdup(src->model.stringVars[i]) : NULL;");
  L.push("  }");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push("fmi3Status fmi3FreeFMUState(fmi3Instance instance, fmi3FMUState* FMUState) {");
  L.push("  (void)instance;");
  L.push("  if (!FMUState || !*FMUState) return fmi3Error;");
  L.push("  FMU3Instance* copy = (FMU3Instance*)(*FMUState);");
  L.push("  for (int i = 0; i < N_STRING_VARS; i++) {");
  L.push("    if (copy->model.stringVars[i]) free(copy->model.stringVars[i]);");
  L.push("  }");
  L.push("  free(copy);");
  L.push("  *FMUState = NULL;");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push("fmi3Status fmi3SerializedFMUStateSize(fmi3Instance instance, fmi3FMUState FMUState, size_t* size) {");
  L.push("  (void)instance;");
  L.push("  if (!FMUState || !size) return fmi3Error;");
  L.push("  *size = sizeof(FMU3Instance);");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3SerializeFMUState(fmi3Instance instance, fmi3FMUState FMUState, fmi3Byte serializedState[], size_t size) {",
  );
  L.push("  (void)instance;");
  L.push("  if (!FMUState || !serializedState || size < sizeof(FMU3Instance)) return fmi3Error;");
  L.push("  memcpy(serializedState, FMUState, sizeof(FMU3Instance));");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3DeserializeFMUState(fmi3Instance instance, const fmi3Byte serializedState[], size_t size, fmi3FMUState* FMUState) {",
  );
  L.push("  (void)instance;");
  L.push("  if (!serializedState || !FMUState || size < sizeof(FMU3Instance)) return fmi3Error;");
  L.push("  FMU3Instance* copy = (FMU3Instance*)calloc(1, sizeof(FMU3Instance));");
  L.push("  if (!copy) return fmi3Error;");
  L.push("  memcpy(copy, serializedState, sizeof(FMU3Instance));");
  L.push("  *FMUState = (fmi3FMUState)copy;");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push("");

  // Directional & Adjoint Derivatives (Finite-Difference Jacobian Evaluation)
  L.push(
    "fmi3Status fmi3GetDirectionalDerivative(fmi3Instance instance, const fmi3ValueReference unknowns[], size_t nUnknowns, const fmi3ValueReference knowns[], size_t nKnowns, const fmi3Float64 seed[], size_t nSeed, fmi3Float64 sensitivity[], size_t nSensitivity) {",
  );
  L.push("  if (!instance || !unknowns || !knowns || !seed || !sensitivity) return fmi3Error;");
  L.push("  (void)nSeed; (void)nSensitivity;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push(`  ${id}_getDerivatives(&inst->model);`);
  L.push("  double baseVars[N_VARS + 1];");
  L.push("  memcpy(baseVars, inst->model.vars, sizeof(baseVars));");
  L.push("  for (size_t i = 0; i < nUnknowns; i++) sensitivity[i] = 0.0;");
  L.push("  for (size_t j = 0; j < nKnowns; j++) {");
  L.push("    if (seed[j] == 0.0 || knowns[j] >= N_VARS) continue;");
  L.push("    double orig = baseVars[knowns[j]];");
  L.push("    double eps = 1e-7 * (1.0 + fabs(orig));");
  L.push("    inst->model.vars[knowns[j]] = orig + eps;");
  L.push(`    ${id}_getDerivatives(&inst->model);`);
  L.push("    for (size_t i = 0; i < nUnknowns; i++) {");
  L.push("      if (unknowns[i] < N_VARS) {");
  L.push("        double df = (inst->model.vars[unknowns[i]] - baseVars[unknowns[i]]) / eps;");
  L.push("        sensitivity[i] += df * seed[j];");
  L.push("      }");
  L.push("    }");
  L.push("    memcpy(inst->model.vars, baseVars, sizeof(baseVars));");
  L.push("  }");
  L.push(`  ${id}_getDerivatives(&inst->model);`);
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3GetAdjointDerivative(fmi3Instance instance, const fmi3ValueReference unknowns[], size_t nUnknowns, const fmi3ValueReference knowns[], size_t nKnowns, const fmi3Float64 seed[], size_t nSeed, fmi3Float64 sensitivity[], size_t nSensitivity) {",
  );
  L.push("  if (!instance || !unknowns || !knowns || !seed || !sensitivity) return fmi3Error;");
  L.push("  (void)nSeed; (void)nSensitivity;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push(`  ${id}_getDerivatives(&inst->model);`);
  L.push("  double baseVars[N_VARS + 1];");
  L.push("  memcpy(baseVars, inst->model.vars, sizeof(baseVars));");
  L.push("  for (size_t j = 0; j < nKnowns; j++) {");
  L.push("    sensitivity[j] = 0.0;");
  L.push("    if (knowns[j] >= N_VARS) continue;");
  L.push("    double orig = baseVars[knowns[j]];");
  L.push("    double eps = 1e-7 * (1.0 + fabs(orig));");
  L.push("    inst->model.vars[knowns[j]] = orig + eps;");
  L.push(`    ${id}_getDerivatives(&inst->model);`);
  L.push("    for (size_t i = 0; i < nUnknowns; i++) {");
  L.push("      if (unknowns[i] < N_VARS) {");
  L.push("        double df = (inst->model.vars[unknowns[i]] - baseVars[unknowns[i]]) / eps;");
  L.push("        sensitivity[j] += df * seed[i];");
  L.push("      }");
  L.push("    }");
  L.push("    memcpy(inst->model.vars, baseVars, sizeof(baseVars));");
  L.push("  }");
  L.push(`  ${id}_getDerivatives(&inst->model);`);
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3GetOutputDerivatives(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, const fmi3Int32 order[], fmi3Float64 value[], size_t nValues) {",
  );
  L.push("  if (!instance || !vr || !order || !value) return fmi3Error;");
  L.push("  (void)nValues;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance;");
  L.push(`  ${id}_getDerivatives(&inst->model);`);
  L.push("  for (size_t i = 0; i < nvr; i++) value[i] = 0.0;");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push("");

  // Clock Interval & Dependency Queries
  L.push(
    "fmi3Status fmi3GetIntervalDecimal(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, fmi3Float64 interval[], fmi3IntervalQualifier qualifier[], size_t nValues) {",
  );
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance; (void)nValues;");
  L.push("  for (size_t i = 0; i < nvr; i++) {");
  L.push("    interval[i] = (vr[i] <= N_VARS) ? inst->clockIntervals[vr[i]] : 1.0;");
  L.push("    qualifier[i] = fmi3IntervalUnchanged;");
  L.push("  }");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3GetIntervalFraction(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, fmi3UInt64 intervalCounter[], fmi3UInt64 resolution[], fmi3IntervalQualifier qualifier[], size_t nValues) {",
  );
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance; (void)nValues;");
  L.push("  for (size_t i = 0; i < nvr; i++) {");
  L.push(
    "    resolution[i] = (vr[i] <= N_VARS && inst->clockResolutions[vr[i]] > 0) ? inst->clockResolutions[vr[i]] : 1;",
  );
  L.push(
    "    intervalCounter[i] = (vr[i] <= N_VARS) ? (fmi3UInt64)(inst->clockIntervals[vr[i]] * (double)resolution[i]) : 1;",
  );
  L.push("    qualifier[i] = fmi3IntervalUnchanged;");
  L.push("  }");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3GetShiftDecimal(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, fmi3Float64 shift[], size_t nValues) {",
  );
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance; (void)nValues;");
  L.push("  for (size_t i = 0; i < nvr; i++) shift[i] = (vr[i] <= N_VARS) ? inst->clockShifts[vr[i]] : 0.0;");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3GetShiftFraction(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, fmi3UInt64 shiftCounter[], fmi3UInt64 resolution[], size_t nValues) {",
  );
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance; (void)nValues;");
  L.push("  for (size_t i = 0; i < nvr; i++) {");
  L.push(
    "    resolution[i] = (vr[i] <= N_VARS && inst->clockResolutions[vr[i]] > 0) ? inst->clockResolutions[vr[i]] : 1;",
  );
  L.push(
    "    shiftCounter[i] = (vr[i] <= N_VARS) ? (fmi3UInt64)(inst->clockShifts[vr[i]] * (double)resolution[i]) : 0;",
  );
  L.push("  }");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3SetIntervalDecimal(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, const fmi3Float64 interval[], size_t nValues) {",
  );
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance; (void)nValues;");
  L.push("  for (size_t i = 0; i < nvr; i++) if (vr[i] <= N_VARS) inst->clockIntervals[vr[i]] = interval[i];");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3SetIntervalFraction(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, const fmi3UInt64 intervalCounter[], const fmi3UInt64 resolution[], size_t nValues) {",
  );
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance; (void)nValues;");
  L.push("  for (size_t i = 0; i < nvr; i++) {");
  L.push("    if (vr[i] <= N_VARS && resolution[i] > 0) {");
  L.push("      inst->clockResolutions[vr[i]] = resolution[i];");
  L.push("      inst->clockIntervals[vr[i]] = (double)intervalCounter[i] / (double)resolution[i];");
  L.push("    }");
  L.push("  }");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3SetShiftDecimal(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, const fmi3Float64 shift[], size_t nValues) {",
  );
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance; (void)nValues;");
  L.push("  for (size_t i = 0; i < nvr; i++) if (vr[i] <= N_VARS) inst->clockShifts[vr[i]] = shift[i];");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3SetShiftFraction(fmi3Instance instance, const fmi3ValueReference vr[], size_t nvr, const fmi3UInt64 shiftCounter[], const fmi3UInt64 resolution[], size_t nValues) {",
  );
  L.push("  if (!instance) return fmi3Error;");
  L.push("  FMU3Instance* inst = (FMU3Instance*)instance; (void)nValues;");
  L.push("  for (size_t i = 0; i < nvr; i++) {");
  L.push("    if (vr[i] <= N_VARS && resolution[i] > 0) {");
  L.push("      inst->clockResolutions[vr[i]] = resolution[i];");
  L.push("      inst->clockShifts[vr[i]] = (double)shiftCounter[i] / (double)resolution[i];");
  L.push("    }");
  L.push("  }");
  L.push("  return fmi3OK;");
  L.push("}");
  L.push(
    "fmi3Status fmi3GetNumberOfVariableDependencies(fmi3Instance instance, fmi3ValueReference valueReference, size_t* nDependencies) { if (!instance || !nDependencies) return fmi3Error; (void)valueReference; *nDependencies = 0; return fmi3OK; }",
  );
  L.push(
    "fmi3Status fmi3GetVariableDependencies(fmi3Instance instance, fmi3ValueReference dependent, size_t elementIndicesOfDependent[], fmi3ValueReference independents[], size_t elementIndicesOfIndependents[], fmi3DependencyKind dependencyKinds[], size_t nDependencies) { if (!instance) return fmi3Error; (void)dependent; (void)elementIndicesOfDependent; (void)independents; (void)elementIndicesOfIndependents; (void)dependencyKinds; (void)nDependencies; return fmi3OK; }",
  );

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

function extractDerName(dae: DAEBuilder, exprId: number): string | null {
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

function collectReferencedNames(dae: DAEBuilder, id: number, names: Set<string>): void {
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
