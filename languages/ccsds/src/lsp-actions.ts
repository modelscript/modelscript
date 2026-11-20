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

export const ccsdsActionHandlers: Record<
  string,
  (ctx: LspActionContext, params?: LspActionParams) => Promise<unknown>
> = {
  ccsds_lint: textAction([], async (text) => {
    const { lintCcsds, parseCcsds } = await import("./index.js");
    return lintCcsds(parseCcsds(text));
  }),
  lint_ccsds: textAction([], async (text) => {
    const { lintCcsds, parseCcsds } = await import("./index.js");
    return lintCcsds(parseCcsds(text));
  }),
  ccsds_to_modelica: textAction("", async (text) => {
    const { ccsdsToModelica, parseCcsds } = await import("./index.js");
    return ccsdsToModelica(parseCcsds(text));
  }),
  export_ccsds_modelica: textAction("", async (text) => {
    const { ccsdsToModelica, parseCcsds } = await import("./index.js");
    return ccsdsToModelica(parseCcsds(text));
  }),
  ccsds_to_sysml: textAction("", async (text) => {
    const { ccsdsToSysml, parseCcsds } = await import("./index.js");
    return ccsdsToSysml(parseCcsds(text));
  }),
  export_ccsds_sysml: textAction("", async (text) => {
    const { ccsdsToSysml, parseCcsds } = await import("./index.js");
    return ccsdsToSysml(parseCcsds(text));
  }),
  ccsds_to_dae: textAction(null, async (text) => {
    const { lowerCcsdsToDae, parseCcsds } = await import("./index.js");
    const arena = lowerCcsdsToDae(parseCcsds(text));
    return { variableCount: arena.getVarCount(), equationCount: arena.getEqCount() };
  }),
  export_ccsds_dae: textAction(null, async (text) => {
    const { lowerCcsdsToDae, parseCcsds } = await import("./index.js");
    const arena = lowerCcsdsToDae(parseCcsds(text));
    return { variableCount: arena.getVarCount(), equationCount: arena.getEqCount() };
  }),
};
