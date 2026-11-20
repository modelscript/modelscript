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

export interface AdamsActionDeps {
  simulateDae?: (dae: unknown, opts: { startTime: number; stopTime: number; step: number }) => Promise<unknown>;
}

export function createAdamsActionHandlers(
  deps: AdamsActionDeps = {},
): Record<string, (ctx: LspActionContext, params?: LspActionParams) => Promise<unknown>> {
  return {
    lint_adams_model: textAction([], async (text) => {
      const { parseAdams, lintAdamsModel } = await import("./index.js");
      return lintAdamsModel(parseAdams(text));
    }),
    analyze_adams_mobility: textAction(null, async (text) => {
      const { parseAdams, analyzeAdamsMobility } = await import("./index.js");
      return analyzeAdamsMobility(parseAdams(text));
    }),
    export_adams_simpack: textAction(null, async (text) => {
      const { parseAdams, adamsToSimpack } = await import("./index.js");
      return adamsToSimpack(parseAdams(text));
    }),
    export_adams_modelica: textAction("", async (text) => {
      const { parseAdams, adamsToModelica } = await import("./index.js");
      return adamsToModelica(parseAdams(text));
    }),
    simulate_adams: textAction(null, async (text, params) => {
      const { parseAdams, lowerAdamsToDae } = await import("./index.js");
      const dataset = parseAdams(text);
      const dae = lowerAdamsToDae(dataset);
      return deps.simulateDae
        ? deps.simulateDae(dae, {
            startTime: params?.startTime ?? 0,
            stopTime: params?.stopTime ?? dataset.simulation?.endTime ?? 5.0,
            step: params?.step ?? dataset.simulation?.dtOut ?? 0.005,
          })
        : null;
    }),
  };
}
