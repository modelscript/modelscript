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

export const relap5ActionHandlers: Record<
  string,
  (ctx: LspActionContext, params?: LspActionParams) => Promise<unknown>
> = {
  lint_relap5: textAction([], async (text) => {
    const { parseRelap5, lintRelap5 } = await import("./index.js");
    return lintRelap5(parseRelap5(text));
  }),
  relap5_kinetics_solve: textAction(null, async (text, params) => {
    const { parseRelap5, solvePointKinetics } = await import("./index.js");
    return solvePointKinetics(parseRelap5(text), params?.options as Parameters<typeof solvePointKinetics>[1]);
  }),
  relap5_to_dae: textAction(null, async (text) => {
    const { parseRelap5, lowerRelap5ToDae } = await import("./index.js");
    const dae = lowerRelap5ToDae(parseRelap5(text));
    return {
      modelName: "Relap5NuclearPlant",
      variableCount: dae.variables().length,
      equationCount: dae.equations().length,
    };
  }),
  relap5_to_modelica: textAction("", async (text, params) => {
    const { parseRelap5, relap5ToModelica } = await import("./index.js");
    return relap5ToModelica(parseRelap5(text), params?.modelName);
  }),
};
