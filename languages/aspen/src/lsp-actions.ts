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

export const aspenActionHandlers: Record<
  string,
  (ctx: LspActionContext, params?: LspActionParams) => Promise<unknown>
> = {
  lint_aspen_flowsheet: textAction([], async (text) => {
    const { parseAspen, lintAspen } = await import("./index.js");
    return lintAspen(parseAspen(text));
  }),
  aspen_to_dae: textAction(null, async (text) => {
    const { parseAspen, lowerAspenToDae } = await import("./index.js");
    const dae = lowerAspenToDae(parseAspen(text));
    return {
      modelName: "AspenFlowsheet",
      variableCount: dae.variables().length,
      equationCount: dae.equations().length,
    };
  }),
  aspen_to_modelica: textAction("", async (text) => {
    const { parseAspen, aspenToModelica } = await import("./index.js");
    return aspenToModelica(parseAspen(text));
  }),
  aspen_solve_flash: textAction(null, async (text, params) => {
    const { parseAspen, solveFlashRachfordRice } = await import("./index.js");
    const deck = parseAspen(text);
    const streamId = params?.streamId ?? deck.streams.keys().next().value ?? "FEED";
    const s = deck.streams.get(streamId);
    const comps = Array.from(s?.moleFractions.keys() ?? deck.components.keys());
    const fracs = comps.map((c) => s?.moleFractions.get(c) ?? 1.0 / comps.length);
    return solveFlashRachfordRice({
      temperature: s?.temperature ?? 75.0,
      pressure: s?.pressure ?? 1.2,
      components: comps,
      moleFractions: fracs,
      totalFlow: s?.moleFlow ?? 100.0,
    });
  }),
};
