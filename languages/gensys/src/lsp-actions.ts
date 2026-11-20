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

export interface GensysActionDeps {
  exportFmu?: (model: unknown, options?: unknown) => Promise<unknown>;
  simulateDae?: (dae: unknown, opts: { startTime: number; stopTime: number; step: number }) => Promise<unknown>;
}

export function createGensysActionHandlers(
  deps: GensysActionDeps = {},
): Record<string, (ctx: LspActionContext, params?: LspActionParams) => Promise<unknown>> {
  return {
    lint_gensys_deck: textAction([], async (text) => {
      const { parseGensysDeck, lintGensysModel } = await import("./index.js");
      return lintGensysModel(parseGensysDeck(text));
    }),
    export_gensys_modelica: textAction("", async (text) => {
      const { parseGensysDeck, gensysToModelica } = await import("./index.js");
      return gensysToModelica(parseGensysDeck(text));
    }),
    evaluate_en14363: async (_ctx: LspActionContext, params?: LspActionParams) => {
      const { evaluateEn14363 } = await import("./index.js");
      return evaluateEn14363((params ?? {}) as unknown as Parameters<typeof evaluateEn14363>[0]);
    },
    export_gensys_fmu: textAction(null, async (text, params) => {
      const { parseGensysDeck } = await import("./index.js");
      return deps.exportFmu ? deps.exportFmu(parseGensysDeck(text), params?.options) : null;
    }),
    simulate_gensys: textAction(null, async (text, params) => {
      const { parseGensysDeck, lowerGensysToDae } = await import("./index.js");
      const dae = lowerGensysToDae(parseGensysDeck(text));
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

export async function generateGensysMultibodyReport(params: {
  modelName?: string;
  format?: "html" | "sarif" | "junit" | "ctrf";
  maxNadalYOverQ?: number;
  maxLateralForceYKn?: number;
  nominalAxleLoadQ0Kn?: number;
  sperlingVerticalWz?: number;
  sperlingHorizontalWz?: number;
  crossWindUnloadingRatio?: number;
  equivalentConicity?: number;
}) {
  const {
    createHomologationReport,
    exportHomologationHtml,
    exportHomologationSarif,
    exportHomologationJunit,
    exportHomologationCtrf,
  } = await import("./index.js");

  const report = createHomologationReport({
    modelName: params.modelName || "MultibodyModel",
    maxNadalYOverQ: params.maxNadalYOverQ ?? 0.65,
    maxLateralForceYKn: params.maxLateralForceYKn ?? 35.0,
    nominalAxleLoadQ0Kn: params.nominalAxleLoadQ0Kn ?? 160.0,
    sperlingVerticalWz: params.sperlingVerticalWz ?? 2.2,
    sperlingHorizontalWz: params.sperlingHorizontalWz ?? 2.3,
    crossWindUnloadingRatio: params.crossWindUnloadingRatio ?? 0.68,
    equivalentConicity: params.equivalentConicity ?? 0.18,
  });

  const fmt = params.format ?? "html";
  const content =
    fmt === "sarif"
      ? exportHomologationSarif(report)
      : fmt === "junit"
        ? exportHomologationJunit(report)
        : fmt === "ctrf"
          ? exportHomologationCtrf(report)
          : exportHomologationHtml(report);

  return { format: fmt, report, content };
}
