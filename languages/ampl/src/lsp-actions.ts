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

export const amplActionHandlers: Record<string, (ctx: LspActionContext, params?: LspActionParams) => Promise<unknown>> =
  {
    ampl_lint: textAction([], async (text) => {
      const { parseAmplModel, lintAmpl } = await import("./index.js");
      return lintAmpl(parseAmplModel(text));
    }),
    ampl_solve: textAction(null, async (text, params) => {
      const { parseAmplModel, instantiateAmpl, solveAmpl } = await import("./index.js");
      const problem = instantiateAmpl(parseAmplModel(text));
      return solveAmpl(problem, params?.options as Parameters<typeof solveAmpl>[1]);
    }),
    ampl_to_dae: textAction(null, async (text) => {
      const { parseAmplModel, instantiateAmpl, lowerAmplToDae } = await import("./index.js");
      const problem = instantiateAmpl(parseAmplModel(text));
      const dae = lowerAmplToDae(problem);
      return {
        modelName: problem.name,
        variableCount: dae.variables().length,
        equationCount: dae.equations().length,
      };
    }),
    ampl_to_nl: textAction("", async (text) => {
      const { parseAmplModel, instantiateAmpl, writeNlProblem } = await import("./index.js");
      const problem = instantiateAmpl(parseAmplModel(text));
      return writeNlProblem(problem);
    }),
    ampl_to_modelica: textAction("", async (text) => {
      const { parseAmplModel, instantiateAmpl, amplToModelica } = await import("./index.js");
      const problem = instantiateAmpl(parseAmplModel(text));
      return amplToModelica(problem);
    }),
    ampl_inspect_geometry: textAction(null, async (text, params) => {
      const { inspectAmplGeometry } = await import("./index.js");
      return inspectAmplGeometry(text, params?.dataText);
    }),
    ampl_sweep: textAction(null, async (text, params) => {
      const { sweepAmplParameter } = await import("./index.js");
      return sweepAmplParameter(text, params as unknown as Parameters<typeof sweepAmplParameter>[1]);
    }),
    ampl_pareto: textAction(null, async (text, params) => {
      const { computeAmplPareto } = await import("./index.js");
      return computeAmplPareto(text, params as unknown as Parameters<typeof computeAmplPareto>[1]);
    }),
  };
