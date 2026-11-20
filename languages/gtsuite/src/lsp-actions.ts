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

export const gtsuiteActionHandlers: Record<
  string,
  (ctx: LspActionContext, params?: LspActionParams) => Promise<unknown>
> = {
  lint_gtsuite_model: textAction([], async (text, params) => {
    const { parseGtmModel, lintGtModel } = await import("./index.js");
    return lintGtModel(parseGtmModel(text, params?.uri));
  }),
  simulate_gtsuite_transient: textAction(null, async (text, params) => {
    const { parseGtmModel, runGtSuiteSimulation } = await import("./index.js");
    return runGtSuiteSimulation(
      parseGtmModel(text, params?.uri),
      params?.options as Parameters<typeof runGtSuiteSimulation>[1],
    );
  }),
  verify_gtsuite_gates: textAction(null, async (text, params) => {
    const { parseGtmModel, runGtSuiteSimulation, verifyEngineGates } = await import("./index.js");
    const simResult = await runGtSuiteSimulation(
      parseGtmModel(text, params?.uri),
      params?.options as Parameters<typeof runGtSuiteSimulation>[1],
    );
    return verifyEngineGates(simResult, params?.gateOptions as Parameters<typeof verifyEngineGates>[1]);
  }),
  project_gtsuite_modelica: textAction("", async (text, params) => {
    const { parseGtmModel, gtsuiteToModelica } = await import("./index.js");
    return gtsuiteToModelica(parseGtmModel(text, params?.uri));
  }),
  project_gtsuite_sysml2: textAction("", async (text, params) => {
    const { parseGtmModel, gtsuiteToSysml2 } = await import("./index.js");
    return gtsuiteToSysml2(parseGtmModel(text, params?.uri));
  }),
  project_gtsuite_ssp: textAction("", async (text, params) => {
    const { parseGtmModel, gtsuiteToSsp } = await import("./index.js");
    return gtsuiteToSsp(parseGtmModel(text, params?.uri));
  }),
  export_gtsuite_dae: textAction(null, async (text, params) => {
    const { parseGtmModel, gtsuiteToDae } = await import("./index.js");
    const dae = gtsuiteToDae(parseGtmModel(text, params?.uri));
    return { varCount: dae.varCount, eqCount: dae.eqCount };
  }),
  render_gtsuite_schematic: textAction("", async (text, params) => {
    const { parseGtmModel, renderGtSuiteSchematicSvg } = await import("./index.js");
    return renderGtSuiteSchematicSvg(parseGtmModel(text, params?.uri));
  }),
};
