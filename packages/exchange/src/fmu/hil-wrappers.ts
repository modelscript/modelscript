// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

/**
 * @modelscript/exchange/fmu — Hardware-in-the-Loop (HIL) & Embedded Target Wrappers.
 *
 * Generates production real-time target wrappers around `generateStandaloneCSources`:
 *   1. Simulink Level-2 C-MEX S-Function (`<model>_sfun.c`) for Simulink / dSPACE RTI / Speedgoat
 *   2. AUTOSAR Classic Software Component (`<model>_Swc.c` + `<model>.arxml`) for automotive ECUs
 */

import type { DAEBuilder } from "@modelscript/runtime";
import { generateStandaloneCSources, type StandaloneCOptions, type StandaloneCResult } from "./standalone-codegen.js";
import { sanitizeIdentifier } from "./transpiler-utils.js";

export interface SimulinkSFunctionResult extends StandaloneCResult {
  /** Level-2 C-MEX S-Function source code (`<model>_sfun.c`). */
  sFunctionSource: string;
  /** Sample period in seconds configured for the discrete/fixed-step S-Function block. */
  sampleTimeSec: number;
}

export interface AutosarSwcResult extends StandaloneCResult {
  /** AUTOSAR Classic SWC implementation C source (`<model>_Swc.c`). */
  swcSource: string;
  /** AUTOSAR 4.x ARXML Software Component & Port Interface descriptor (`<model>.arxml`). */
  arxmlDescriptor: string;
  /** Periodic runnable execution period in milliseconds. */
  stepPeriodMs: number;
}

/**
 * Generate a MATLAB/Simulink Level-2 C-MEX S-Function (`<model>_sfun.c`) wrapping the zero-malloc
 * standalone C99 plant model for Simulink, dSPACE RTI, and Speedgoat HIL execution.
 */
export function generateSimulinkSFunctionC(
  dae: DAEBuilder,
  options: StandaloneCOptions & { sampleTimeSec?: number | undefined },
): SimulinkSFunctionResult {
  const standalone = generateStandaloneCSources(dae, {
    ...options,
    includeMain: false,
  });
  const id = standalone.modelIdentifier;
  const dt = options.sampleTimeSec ?? 0.001;
  const inSanitized = standalone.inputNames.map((n) => sanitizeIdentifier(n));
  const outSanitized = standalone.outputNames.map((n) => sanitizeIdentifier(n));
  const paramSanitized = standalone.parameterNames.map((n) => sanitizeIdentifier(n));

  const L: string[] = [];
  L.push(`/* Auto-generated Simulink Level-2 C-MEX S-Function for '${id}' */`);
  L.push(`#define S_FUNCTION_NAME  ${id}_sfun`);
  L.push("#define S_FUNCTION_LEVEL 2");
  L.push("");
  L.push('#include "simstruc.h"');
  L.push(`#include "${id}_standalone.h"`);
  L.push("");
  L.push(`static ${id}_Instance g_${id}_static_pool;`);
  L.push("");
  L.push("static void mdlInitializeSizes(SimStruct *S) {");
  L.push(`  ssSetNumSFcnParams(S, ${paramSanitized.length});`);
  L.push("  if (ssGetNumSFcnParams(S) != ssGetSFcnParamsCount(S)) return;");
  L.push("  ssSetNumContStates(S, 0);");
  L.push("  ssSetNumDiscStates(S, 1);");
  L.push(`  if (!ssSetNumInputPorts(S, ${inSanitized.length})) return;`);
  for (let i = 0; i < inSanitized.length; i++) {
    L.push(`  ssSetInputPortWidth(S, ${i}, 1);`);
    L.push(`  ssSetInputPortDirectFeedThrough(S, ${i}, 1);`);
    L.push(`  ssSetInputPortRequiredContiguous(S, ${i}, 1);`);
  }
  L.push(`  if (!ssSetNumOutputPorts(S, ${outSanitized.length})) return;`);
  for (let i = 0; i < outSanitized.length; i++) {
    L.push(`  ssSetOutputPortWidth(S, ${i}, 1);`);
  }
  L.push("  ssSetNumSampleTimes(S, 1);");
  L.push("  ssSetNumPWork(S, 1);");
  L.push("  ssSetOptions(S, SS_OPTION_WORKS_WITH_CODE_REUSE | SS_OPTION_EXCEPTION_FREE_CODE);");
  L.push("}");
  L.push("");
  L.push("static void mdlInitializeSampleTimes(SimStruct *S) {");
  L.push(`  ssSetSampleTime(S, 0, ${dt});`);
  L.push("  ssSetOffsetTime(S, 0, 0.0);");
  L.push("}");
  L.push("");
  L.push("#define MDL_START");
  L.push("static void mdlStart(SimStruct *S) {");
  L.push(`  ${id}_Instance *inst = &g_${id}_static_pool;`);
  L.push(`  ${id}_init(inst);`);
  if (paramSanitized.length > 0) {
    L.push(`  ${id}_Parameters p = inst->params;`);
    for (let i = 0; i < paramSanitized.length; i++) {
      L.push(`  p.${paramSanitized[i]!} = *mxGetPr(ssGetSFcnParam(S, ${i}));`);
    }
    L.push(`  ${id}_setParameters(inst, &p);`);
  }
  L.push("  ssGetPWork(S)[0] = (void *)inst;");
  L.push("}");
  L.push("");
  L.push("static void mdlOutputs(SimStruct *S, int_T tid) {");
  L.push("  (void)tid;");
  L.push(`  ${id}_Instance *inst = (${id}_Instance *)ssGetPWork(S)[0];`);
  L.push(`  ${id}_Inputs in = {0};`);
  L.push(`  ${id}_Outputs out = {0};`);
  for (let i = 0; i < inSanitized.length; i++) {
    L.push(`  const real_T *u_${i} = (const real_T *)ssGetInputPortSignal(S, ${i});`);
    L.push(`  in.${inSanitized[i]!} = (double)u_${i}[0];`);
  }
  L.push(`  ${id}_step(inst, &in, &out, ${dt});`);
  for (let i = 0; i < outSanitized.length; i++) {
    L.push(`  real_T *y_${i} = ssGetOutputPortRealSignal(S, ${i});`);
    L.push(`  y_${i}[0] = (real_T)out.${outSanitized[i]!};`);
  }
  L.push("}");
  L.push("");
  L.push("static void mdlTerminate(SimStruct *S) {");
  L.push("  (void)S;");
  L.push("}");
  L.push("");
  L.push("#ifdef MATLAB_MEX_FILE");
  L.push('#include "simulink.c"');
  L.push("#else");
  L.push('#include "cg_sfun.h"');
  L.push("#endif");
  L.push("");

  return {
    ...standalone,
    sFunctionSource: L.join("\n"),
    sampleTimeSec: dt,
  };
}

/**
 * Generate an AUTOSAR Classic Application Software Component (`<model>_Swc.c` and `<model>.arxml`)
 * wrapping the zero-malloc standalone C99 plant/controller model.
 */
export function generateAutosarSwcC(
  dae: DAEBuilder,
  options: StandaloneCOptions & { stepPeriodMs?: number | undefined },
): AutosarSwcResult {
  const standalone = generateStandaloneCSources(dae, {
    ...options,
    misraCompliant: options.misraCompliant ?? true,
    includeMain: false,
  });
  const id = standalone.modelIdentifier;
  const periodMs = options.stepPeriodMs ?? 10;
  const dtSec = periodMs / 1000.0;
  const inSanitized = standalone.inputNames.map((n) => sanitizeIdentifier(n));
  const outSanitized = standalone.outputNames.map((n) => sanitizeIdentifier(n));

  const cLines: string[] = [];
  cLines.push(`/* Auto-generated AUTOSAR Classic SWC for '${id}' (Period: ${periodMs} ms) */`);
  cLines.push(`#include "Rte_${id}.h"`);
  cLines.push(`#include "${id}_standalone.h"`);
  cLines.push("");
  cLines.push(`#define ${id}_START_SEC_VAR_NOINIT_UNSPECIFIED`);
  cLines.push(`static ${id}_Instance ${id}_RteInstance;`);
  cLines.push(`#define ${id}_STOP_SEC_VAR_NOINIT_UNSPECIFIED`);
  cLines.push("");
  cLines.push(`#define ${id}_START_SEC_CODE`);
  cLines.push("");
  cLines.push(`void Runnable_${id}_Init(void) {`);
  cLines.push(`  ${id}_init(&${id}_RteInstance);`);
  cLines.push("}");
  cLines.push("");
  cLines.push(`void Runnable_${id}_Step_${periodMs}ms(void) {`);
  cLines.push(`  ${id}_Inputs in_ports = {0};`);
  cLines.push(`  ${id}_Outputs out_ports = {0};`);
  for (const inName of inSanitized) {
    cLines.push(`  (void)Rte_Read_rp_${inName}_val(&in_ports.${inName});`);
  }
  cLines.push(`  ${id}_step(&${id}_RteInstance, &in_ports, &out_ports, ${dtSec});`);
  for (const outName of outSanitized) {
    cLines.push(`  (void)Rte_Write_pp_${outName}_val(out_ports.${outName});`);
  }
  cLines.push("}");
  cLines.push("");
  cLines.push(`#define ${id}_STOP_SEC_CODE`);
  cLines.push("");

  const arxmlLines: string[] = [];
  arxmlLines.push('<?xml version="1.0" encoding="UTF-8"?>');
  arxmlLines.push('<AUTOSAR xmlns="http://autosar.org/schema/r4.0">');
  arxmlLines.push("  <AR-PACKAGES>");
  arxmlLines.push("    <AR-PACKAGE>");
  arxmlLines.push(`      <SHORT-NAME>${id}_Pkg</SHORT-NAME>`);
  arxmlLines.push("      <ELEMENTS>");
  arxmlLines.push("        <APPLICATION-SW-COMPONENT-TYPE>");
  arxmlLines.push(`          <SHORT-NAME>${id}</SHORT-NAME>`);
  arxmlLines.push("          <PORTS>");
  for (const inName of inSanitized) {
    arxmlLines.push("            <R-PORT-PROTOTYPE>");
    arxmlLines.push(`              <SHORT-NAME>rp_${inName}</SHORT-NAME>`);
    arxmlLines.push("            </R-PORT-PROTOTYPE>");
  }
  for (const outName of outSanitized) {
    arxmlLines.push("            <P-PORT-PROTOTYPE>");
    arxmlLines.push(`              <SHORT-NAME>pp_${outName}</SHORT-NAME>`);
    arxmlLines.push("            </P-PORT-PROTOTYPE>");
  }
  arxmlLines.push("          </PORTS>");
  arxmlLines.push("          <INTERNAL-BEHAVIORS>");
  arxmlLines.push("            <SWC-INTERNAL-BEHAVIOR>");
  arxmlLines.push(`              <SHORT-NAME>${id}_InternalBehavior</SHORT-NAME>`);
  arxmlLines.push("              <EVENTS>");
  arxmlLines.push("                <TIMING-EVENT>");
  arxmlLines.push(`                  <SHORT-NAME>TE_${periodMs}ms</SHORT-NAME>`);
  arxmlLines.push(`                  <PERIOD>${dtSec}</PERIOD>`);
  arxmlLines.push("                </TIMING-EVENT>");
  arxmlLines.push("              </EVENTS>");
  arxmlLines.push("              <RUNNABLES>");
  arxmlLines.push("                <RUNNABLE-ENTITY>");
  arxmlLines.push(`                  <SHORT-NAME>Runnable_${id}_Init</SHORT-NAME>`);
  arxmlLines.push(`                  <SYMBOL>Runnable_${id}_Init</SYMBOL>`);
  arxmlLines.push("                </RUNNABLE-ENTITY>");
  arxmlLines.push("                <RUNNABLE-ENTITY>");
  arxmlLines.push(`                  <SHORT-NAME>Runnable_${id}_Step_${periodMs}ms</SHORT-NAME>`);
  arxmlLines.push(`                  <SYMBOL>Runnable_${id}_Step_${periodMs}ms</SYMBOL>`);
  arxmlLines.push("                </RUNNABLE-ENTITY>");
  arxmlLines.push("              </RUNNABLES>");
  arxmlLines.push("            </SWC-INTERNAL-BEHAVIOR>");
  arxmlLines.push("          </INTERNAL-BEHAVIORS>");
  arxmlLines.push("        </APPLICATION-SW-COMPONENT-TYPE>");
  arxmlLines.push("      </ELEMENTS>");
  arxmlLines.push("    </AR-PACKAGE>");
  arxmlLines.push("  </AR-PACKAGES>");
  arxmlLines.push("</AUTOSAR>");

  return {
    ...standalone,
    swcSource: cLines.join("\n"),
    arxmlDescriptor: arxmlLines.join("\n"),
    stepPeriodMs: periodMs,
  };
}
