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

export const energyplusActionHandlers: Record<
  string,
  (ctx: LspActionContext, params?: LspActionParams) => Promise<unknown>
> = {
  lint_energyplus: textAction([], async (text) => {
    const { lintEnergyPlus, parseEnergyPlus } = await import("./index.js");
    return lintEnergyPlus(parseEnergyPlus(text));
  }),
  export_energyplus_modelica: textAction("", async (text) => {
    const { energyPlusToModelica, parseEnergyPlus } = await import("./index.js");
    return energyPlusToModelica(parseEnergyPlus(text));
  }),
  export_energyplus_dae: textAction(null, async (text) => {
    const { lowerEnergyPlusToDae, parseEnergyPlus } = await import("./index.js");
    const arena = lowerEnergyPlusToDae(parseEnergyPlus(text));
    return { variableCount: arena.getVarCount(), equationCount: arena.getEqCount() };
  }),
};
