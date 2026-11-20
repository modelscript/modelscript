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

export const lpsActionHandlers: Record<string, (ctx: LspActionContext, params?: LspActionParams) => Promise<unknown>> =
  {
    lint_lps_network: textAction([], async (text) => {
      const { parseLps, lintLpsModel } = await import("./index.js");
      return lintLpsModel(parseLps(text));
    }),
    solve_lps_steady: async (ctx: LspActionContext) => {
      const text = ctx.documentText;
      if (!text) return null;
      const { parseLps, SteadyNetworkSolver, LinePackEngine, PipelineVerifier } = await import("./index.js");
      const model = parseLps(text);
      const steady = SteadyNetworkSolver.solve(model);
      const analysis = LinePackEngine.analyze(model, steady);
      const verification = PipelineVerifier.verifySteady(model, steady);
      return { steady, analysis, verification };
    },
    simulate_lps_transient: textAction(null, async (text, params) => {
      const { parseLps, GasEulerDaeSolver } = await import("./index.js");
      return GasEulerDaeSolver.simulate(parseLps(text), { durationSeconds: params?.durationSeconds });
    }),
    project_lps_sysml2: async (ctx: LspActionContext) => {
      const text = ctx.documentText;
      if (!text) return "";
      const { parseLps, lpsToSysml2 } = await import("./index.js");
      return lpsToSysml2(parseLps(text));
    },
    export_lps_modelica: async (ctx: LspActionContext) => {
      const text = ctx.documentText;
      if (!text) return "";
      const { parseLps, lpsToModelica } = await import("./index.js");
      return lpsToModelica(parseLps(text));
    },
    export_lps_dae: async (ctx: LspActionContext) => {
      const text = ctx.documentText;
      if (!text) return null;
      const { parseLps, lowerLpsToDae } = await import("./index.js");
      const dae = lowerLpsToDae(parseLps(text));
      return { varCount: dae.varCount, eqCount: dae.eqCount };
    },
  };
