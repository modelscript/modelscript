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

export const simulinkActionHandlers: Record<
  string,
  (ctx: LspActionContext, params?: LspActionParams) => Promise<unknown>
> = {
  simulink_lint: textAction([], async (text) => {
    const { parseSimulink, lintSimulinkModel } = await import("./index.js");
    return lintSimulinkModel(parseSimulink(text));
  }),
  lint_simulink_model: textAction([], async (text) => {
    const { parseSimulink, lintSimulinkModel } = await import("./index.js");
    return lintSimulinkModel(parseSimulink(text));
  }),
  simulink_to_modelica: textAction("", async (text) => {
    const { parseSimulink, simulinkToModelica } = await import("./index.js");
    return simulinkToModelica(parseSimulink(text));
  }),
  export_simulink_modelica: textAction("", async (text) => {
    const { parseSimulink, simulinkToModelica } = await import("./index.js");
    return simulinkToModelica(parseSimulink(text));
  }),
  simulink_to_dae: textAction(null, async (text) => {
    const { parseSimulink, lowerSimulinkToDae } = await import("./index.js");
    const dae = lowerSimulinkToDae(parseSimulink(text));
    return { varCount: dae.varCount, eqCount: dae.eqCount };
  }),
  export_simulink_dae: textAction(null, async (text) => {
    const { parseSimulink, lowerSimulinkToDae } = await import("./index.js");
    const dae = lowerSimulinkToDae(parseSimulink(text));
    return { varCount: dae.varCount, eqCount: dae.eqCount };
  }),
};
