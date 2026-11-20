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

export const rocetsActionHandlers: Record<
  string,
  (ctx: LspActionContext, params?: LspActionParams) => Promise<unknown>
> = {
  lint_rocets_deck: textAction([], async (text) => {
    const { parseRocetsDeck, lintRocets } = await import("./index.js");
    const model = parseRocetsDeck(text);
    return lintRocets(model);
  }),
  solve_rocets_balance: textAction(null, async (text, params) => {
    const { parseRocetsDeck, solveRocetsBalance } = await import("./index.js");
    const model = parseRocetsDeck(text);
    return solveRocetsBalance(model, params?.options as Parameters<typeof solveRocetsBalance>[1]);
  }),
  simulate_rocets_transient: textAction(null, async (text, params) => {
    const { parseRocetsDeck, simulateRocetsTransient } = await import("./index.js");
    const model = parseRocetsDeck(text);
    return simulateRocetsTransient(model, params?.options as Parameters<typeof simulateRocetsTransient>[1]);
  }),
  export_rocets_modelica: textAction("", async (text) => {
    const { parseRocetsDeck, rocetsToModelica } = await import("./index.js");
    const model = parseRocetsDeck(text);
    return rocetsToModelica(model);
  }),
  export_rocets_ssp: textAction("", async (text) => {
    const { parseRocetsDeck, rocetsToSsp } = await import("./index.js");
    const model = parseRocetsDeck(text);
    return rocetsToSsp(model);
  }),
  export_rocets_dae: textAction(null, async (text) => {
    const { parseRocetsDeck, rocetsToDae } = await import("./index.js");
    const model = parseRocetsDeck(text);
    const dae = rocetsToDae(model);
    return {
      varCount: dae.varCount,
      eqCount: dae.eqCount,
    };
  }),
  inspect_rocets_diagram: textAction(null, async (text) => {
    const { parseRocetsDeck, buildRocetsDiagramData, renderRocetsPidSvg } = await import("./index.js");
    const model = parseRocetsDeck(text);
    return {
      graphData: buildRocetsDiagramData(model),
      svg: renderRocetsPidSvg(model),
    };
  }),
};
