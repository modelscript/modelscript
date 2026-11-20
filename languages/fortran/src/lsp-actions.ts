// SPDX-License-Identifier: AGPL-3.0-or-later

export interface LspActionContext {
  documentText?: string;
  [key: string]: unknown;
}

export interface LspActionParams {
  documentText?: string | undefined;
  uri?: string | undefined;
  startTime?: number | undefined;
  stopTime?: number | undefined;
  step?: number | undefined;
  dt?: number | undefined;
  duration?: number | undefined;
  durationSeconds?: number | undefined;
  modelName?: string | undefined;
  streamId?: string | undefined;
  cycles?: number | undefined;
  dtMs?: number | undefined;
  dataText?: string | undefined;
  definitionName?: string | undefined;
  allowSyntheticFallback?: boolean | undefined;
  strictNetlist?: boolean | undefined;
  strict?: boolean | undefined;
  durationSec?: number | undefined;
  timeStepSec?: number | undefined;
  verifyIeee2800?: boolean | undefined;
  exportComtrade?: boolean | undefined;
  exportOut?: boolean | undefined;
  consequenceClass?: 1 | 2 | 3 | undefined;
  theme?: "light" | "dark" | undefined;
  format?: string | undefined;
  q?: Record<string, number> | undefined;
  qd?: Record<string, number> | undefined;
  qdd?: Record<string, number> | undefined;
  gravity?: [number, number, number] | undefined;
  maxNadalYOverQ?: number | undefined;
  maxLateralForceYKn?: number | undefined;
  nominalAxleLoadQ0Kn?: number | undefined;
  sperlingVerticalWz?: number | undefined;
  sperlingHorizontalWz?: number | undefined;
  crossWindUnloadingRatio?: number | undefined;
  equivalentConicity?: number | undefined;
  options?: unknown;
  operatingPoint?: unknown;
  gateOptions?: unknown;
}

function textAction<T>(
  emptyFallback: T,
  fn: (text: string, params: LspActionParams, ctx: LspActionContext) => Promise<T> | T,
): (ctx: LspActionContext, params?: LspActionParams) => Promise<T> {
  return async (ctx: LspActionContext, params?: LspActionParams): Promise<T> => {
    const text = params?.documentText ?? ctx.documentText;
    if (!text) return emptyFallback;
    return fn(text, params ?? {}, ctx);
  };
}

export const fortranActionHandlers: Record<
  string,
  (ctx: LspActionContext, params?: LspActionParams) => Promise<unknown>
> = {
  lint_fortran_file: textAction([], async (text) => {
    const { lintFortran } = await import("./index.js");
    return lintFortran(text);
  }),
  simulate_fortran: textAction(null, async (text, params) => {
    const { simulateFortranRoutine } = await import("./index.js");
    return simulateFortranRoutine(text, {
      startTime: params?.startTime ?? 0,
      stopTime: params?.stopTime ?? 1.0,
      dt: params?.dt ?? 0.01,
    });
  }),
  verify_fortran: textAction(null, async (text, params) => {
    const { verifyFortranSource } = await import("./index.js");
    return verifyFortranSource(text, params?.options as Parameters<typeof verifyFortranSource>[1]);
  }),
  lower_fortran_to_dae: async (ctx: LspActionContext) => {
    const text = ctx.documentText;
    if (!text) return null;
    const { lowerFortranToDae, preprocessFortranSegment, extractFortranSignature } = await import("./index.js");
    const { DAEBuilder } = await import("@modelscript/runtime");
    const prep = preprocessFortranSegment(text);
    const sig = extractFortranSignature(text);
    const builder = new DAEBuilder();
    const lowered = lowerFortranToDae(builder, prep.lines, sig.name);
    return {
      routineName: sig.name,
      equationCount: lowered.equationCount,
      stateCount: lowered.stateVarIndices.length,
      inputs: sig.inputs,
      outputs: sig.outputs,
      locals: sig.locals,
    };
  },
  export_fortran_fmu: textAction(null, async (text, params) => {
    const { exportFortranFmu } = await import("./index.js");
    const fmu = exportFortranFmu(text, params?.options as Parameters<typeof exportFortranFmu>[1]);
    return {
      modelIdentifier: fmu.modelIdentifier,
      guid: fmu.guid,
      files: fmu.files,
      variableCount: fmu.variables.length,
      equationCount: fmu.daeSummary.equationCount,
      archiveByteLength: fmu.archive.byteLength,
      modelDescription2Xml: fmu.modelDescription2Xml,
      modelDescription3Xml: fmu.modelDescription3Xml,
      cSources: fmu.cSources,
      daeSummary: fmu.daeSummary,
      formattedSummary: `Exported Fortran FMU '${fmu.modelIdentifier}.fmu' (${fmu.archive.byteLength} bytes, ${fmu.variables.length} FMI variables, ${fmu.files.length} bundled files).`,
    };
  }),
};
