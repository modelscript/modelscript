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

export const easy5ActionHandlers: Record<
  string,
  (ctx: LspActionContext, params?: LspActionParams) => Promise<unknown>
> = {
  lint_easy5_model: textAction([], async (text) => {
    const { parseEasy5, lintEasy5 } = await import("./index.js");
    return lintEasy5(parseEasy5(text));
  }),
  linearize_easy5_model: textAction(null, async (text, params) => {
    const { parseEasy5, linearizeEasy5 } = await import("./index.js");
    return linearizeEasy5(parseEasy5(text), params?.operatingPoint as Parameters<typeof linearizeEasy5>[1]);
  }),
  inspect_easy5_bode: textAction(null, async (text, params) => {
    const { parseEasy5, linearizeEasy5, computeEasy5FrequencyResponse } = await import("./index.js");
    const model = parseEasy5(text);
    const sys = linearizeEasy5(model, params?.operatingPoint as Parameters<typeof linearizeEasy5>[1]);
    return computeEasy5FrequencyResponse(sys, params?.options as Parameters<typeof computeEasy5FrequencyResponse>[1]);
  }),
  export_easy5_modelica: textAction("", async (text) => {
    const { parseEasy5, easy5ToModelica } = await import("./index.js");
    return easy5ToModelica(parseEasy5(text));
  }),
  export_easy5_ssp: textAction("", async (text) => {
    const { parseEasy5, easy5ToSsp } = await import("./index.js");
    return easy5ToSsp(parseEasy5(text));
  }),
  export_easy5_dae: textAction(null, async (text) => {
    const { parseEasy5, easy5ToDae } = await import("./index.js");
    const dae = easy5ToDae(parseEasy5(text));
    return { varCount: dae.varCount, eqCount: dae.eqCount };
  }),
  inspect_easy5_diagram: textAction(null, async (text) => {
    const { parseEasy5, buildEasy5DiagramData, renderEasy5SvgDiagram } = await import("./index.js");
    const model = parseEasy5(text);
    return {
      graphData: buildEasy5DiagramData(model),
      svg: renderEasy5SvgDiagram(model),
    };
  }),
};
