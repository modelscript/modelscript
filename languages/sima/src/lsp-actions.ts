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
  consequenceClass?: 1 | 2 | undefined;
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

export const simaActionHandlers: Record<string, (ctx: LspActionContext, params?: LspActionParams) => Promise<unknown>> =
  {
    lint_sima_model: textAction([], async (text, params) => {
      const { parseSimaFile, lintSimaProject } = await import("./index.js");
      return lintSimaProject(parseSimaFile(text, params?.uri));
    }),
    verify_dnv_compliance: textAction(null, async (text, params) => {
      const { parseSimaFile, verifyDnvMooringCompliance } = await import("./index.js");
      return verifyDnvMooringCompliance(parseSimaFile(text, params?.uri), params?.consequenceClass ?? 2);
    }),
    evaluate_offset_limits: textAction(null, async (text, params) => {
      const { parseSimaFile, evaluateOffsetLimits } = await import("./index.js");
      return evaluateOffsetLimits(
        parseSimaFile(text, params?.uri),
        params?.options as Parameters<typeof evaluateOffsetLimits>[1],
      );
    }),
    project_sima_modelica: textAction("", async (text, params) => {
      const { parseSimaFile, simaToModelica } = await import("./index.js");
      return simaToModelica(parseSimaFile(text, params?.uri));
    }),
    project_sima_ssp: textAction("", async (text, params) => {
      const { parseSimaFile, simaToSsp } = await import("./index.js");
      return simaToSsp(parseSimaFile(text, params?.uri));
    }),
    project_sima_sysml2: textAction("", async (text, params) => {
      const { parseSimaFile, simaToSysml2 } = await import("./index.js");
      return simaToSysml2(parseSimaFile(text, params?.uri));
    }),
    export_sima_dae: textAction(null, async (text, params) => {
      const { parseSimaFile, lowerSimaToDae } = await import("./index.js");
      const dae = lowerSimaToDae(parseSimaFile(text, params?.uri));
      return { varCount: dae.varCount, eqCount: dae.eqCount };
    }),
  };
