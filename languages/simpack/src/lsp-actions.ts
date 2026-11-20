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

export interface SimpackActionDeps {
  exportFmu?: (model: unknown, options?: unknown) => Promise<unknown>;
  simulateDae?: (dae: unknown, opts: { startTime: number; stopTime: number; step: number }) => Promise<unknown>;
}

export function createSimpackActionHandlers(
  deps: SimpackActionDeps = {},
): Record<string, (ctx: LspActionContext, params?: LspActionParams) => Promise<unknown>> {
  const parse = async (text: string) => {
    const { parseSpckXml, parseSimDeck } = await import("./index.js");
    return text.trimStart().startsWith("<") ? parseSpckXml(text) : parseSimDeck(text);
  };
  return {
    lint_simpack_model: textAction([], async (text) => {
      const { lintSimpackModel } = await import("./index.js");
      return lintSimpackModel(await parse(text));
    }),
    analyze_mobility: textAction(null, async (text) => {
      const { analyzeMobility } = await import("./index.js");
      return analyzeMobility(await parse(text));
    }),
    export_simpack_modelica: textAction("", async (text) => {
      const { simpackToModelica } = await import("./index.js");
      return simpackToModelica(await parse(text));
    }),
    export_simpack_fmu: textAction(null, async (text, params) => {
      return deps.exportFmu ? deps.exportFmu(await parse(text), params?.options) : null;
    }),
    simulate_simpack: textAction(null, async (text, params) => {
      const { lowerSimpackToDae } = await import("./index.js");
      const dae = lowerSimpackToDae(await parse(text));
      return deps.simulateDae
        ? deps.simulateDae(dae, {
            startTime: params?.startTime ?? 0,
            stopTime: params?.stopTime ?? 5.0,
            step: params?.step ?? 0.005,
          })
        : null;
    }),
  };
}
