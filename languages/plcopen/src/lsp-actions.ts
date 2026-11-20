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

export const plcopenActionHandlers: Record<
  string,
  (ctx: LspActionContext, params?: LspActionParams) => Promise<unknown>
> = {
  lint_plcopen: textAction([], async (text) => {
    const { lintPlcProject, parsePlcopen } = await import("./index.js");
    return lintPlcProject(parsePlcopen(text));
  }),
  export_plcopen_modelica: textAction("", async (text) => {
    const { parsePlcopen, plcopenToModelica } = await import("./index.js");
    return plcopenToModelica(parsePlcopen(text));
  }),
  export_plcopen_sysml: textAction("", async (text) => {
    const { parsePlcopen, plcopenToSysML } = await import("./index.js");
    return plcopenToSysML(parsePlcopen(text));
  }),
  export_plcopen_dae: textAction(null, async (text) => {
    const { parsePlcopen, lowerPlcopenToDae } = await import("./index.js");
    const arena = lowerPlcopenToDae(parsePlcopen(text));
    return { variableCount: arena.getVarCount(), equationCount: arena.getEqCount() };
  }),
  run_plcopen_scan: textAction(null, async (text, params) => {
    const { parsePlcopen, VirtualPlc } = await import("./index.js");
    const plc = new VirtualPlc(parsePlcopen(text));
    const cycles = params?.cycles ?? 10;
    const dtMs = params?.dtMs ?? 10;
    return { cycles, dtMs, history: plc.runCycles(cycles, dtMs) };
  }),
};
