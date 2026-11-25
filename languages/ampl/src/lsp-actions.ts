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

function collectAmplWorkspaceFiles(ctx: LspActionContext, params: LspActionParams): Record<string, string> {
  const out: Record<string, string> = {};
  const ctxDocs = ctx["documents"] as { all?: () => Array<{ uri: string; getText: () => string }> } | undefined;
  if (typeof ctxDocs?.all === "function") {
    const activeUri = typeof ctx["uri"] === "string" ? ctx["uri"] : "";
    const prefix = activeUri ? activeUri.slice(0, activeUri.lastIndexOf("/") + 1) : "";
    for (const d of ctxDocs.all()) {
      if (!prefix || d.uri.startsWith(prefix)) {
        const rel = prefix ? d.uri.slice(prefix.length) : d.uri.replace(/^[a-z0-9+-]+:\/\/\/?/i, "");
        if (rel) out[rel] = d.getText();
      }
    }
  }
  const ctxFiles = ctx["projectFiles"] as Record<string, string> | undefined;
  if (ctxFiles && typeof ctxFiles === "object") {
    for (const [k, v] of Object.entries(ctxFiles)) {
      if (typeof v === "string") out[k] = v;
    }
  }
  const paramFiles =
    (params as Record<string, unknown>)["projectFiles"] ?? (params as Record<string, unknown>)["virtualFiles"];
  if (paramFiles && typeof paramFiles === "object") {
    for (const [k, v] of Object.entries(paramFiles as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
  }
  return out;
}

function resolveAmplModelAndData(
  text: string,
  params: LspActionParams,
  ctx: LspActionContext,
): { modelText: string; dataText?: string | undefined; virtualFiles: Record<string, string> } {
  const virtualFiles = collectAmplWorkspaceFiles(ctx, params);
  const uri = (params.uri ?? (typeof ctx["uri"] === "string" ? ctx["uri"] : "")).toLowerCase();
  const isActiveDataFile =
    uri.endsWith(".dat") ||
    (/^\s*(?:set|param)\s+[A-Za-z_]\w*\s*:=/m.test(text) &&
      !/\b(?:var|minimize|maximize|subject\s+to|s\.t\.)\b/i.test(text));

  let modelText = text;
  let dataText = params.dataText;

  const entries = Object.entries(virtualFiles);
  if (isActiveDataFile) {
    if (!dataText) dataText = text;
    const modEntry = entries.find(([k]) => k.toLowerCase().endsWith(".mod") || k.toLowerCase().endsWith(".ampl"));
    if (modEntry) modelText = modEntry[1];
  } else if (!dataText) {
    const datChunks = entries
      .filter(([k]) => k.toLowerCase().endsWith(".dat"))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v.trim())
      .filter(Boolean);
    if (datChunks.length > 0) {
      dataText = datChunks.join("\n\n");
    }
  }

  return { modelText, dataText, virtualFiles };
}

export const amplActionHandlers: Record<string, (ctx: LspActionContext, params?: LspActionParams) => Promise<unknown>> =
  {
    ampl_lint: textAction([], async (text, params, ctx) => {
      const { parseAmplModel, parseAmplData, lintAmpl } = await import("./index.js");
      const { modelText, dataText } = resolveAmplModelAndData(text, params, ctx);
      const data = dataText ? parseAmplData(dataText) : undefined;
      return lintAmpl(parseAmplModel(modelText), data);
    }),
    ampl_solve: textAction(null, async (text, params, ctx) => {
      const { parseAmplModel, parseAmplData, instantiateAmpl, solveAmpl, runAmplScript } = await import("./index.js");
      const uri = (params.uri ?? (typeof ctx["uri"] === "string" ? ctx["uri"] : "")).toLowerCase();
      const { modelText, dataText, virtualFiles } = resolveAmplModelAndData(text, params, ctx);
      if (uri.endsWith(".run") || /^\s*(?:model|data|solve)\s*;/m.test(text)) {
        const scriptRes = await runAmplScript(text, {
          virtualFiles,
          solverOptions: params?.options as Parameters<typeof solveAmpl>[1],
        });
        const lastSolve =
          (scriptRes as { lastSolveResult?: unknown; solveResults?: unknown[] })?.lastSolveResult ??
          (scriptRes as { solveResults?: unknown[] })?.solveResults?.slice(-1)[0];
        return lastSolve ?? scriptRes;
      }
      const data = dataText ? parseAmplData(dataText) : undefined;
      const problem = instantiateAmpl(parseAmplModel(modelText), data);
      return solveAmpl(problem, params?.options as Parameters<typeof solveAmpl>[1]);
    }),
    ampl_run: textAction(null, async (text, params, ctx) => {
      const { runAmplScript } = await import("./index.js");
      const { virtualFiles } = resolveAmplModelAndData(text, params, ctx);
      return runAmplScript(text, {
        virtualFiles,
        solverOptions: params?.options as Parameters<typeof runAmplScript>[1] extends { solverOptions?: infer O }
          ? O
          : never,
      });
    }),
    ampl_to_dae: textAction(null, async (text, params, ctx) => {
      const { parseAmplModel, parseAmplData, instantiateAmpl, lowerAmplToDae } = await import("./index.js");
      const { modelText, dataText } = resolveAmplModelAndData(text, params, ctx);
      const data = dataText ? parseAmplData(dataText) : undefined;
      const problem = instantiateAmpl(parseAmplModel(modelText), data);
      const dae = lowerAmplToDae(problem);
      return {
        modelName: problem.name,
        variableCount: dae.variables().length,
        equationCount: dae.equations().length,
      };
    }),
    ampl_to_nl: textAction("", async (text, params, ctx) => {
      const { parseAmplModel, parseAmplData, instantiateAmpl, writeNlProblem } = await import("./index.js");
      const { modelText, dataText } = resolveAmplModelAndData(text, params, ctx);
      const data = dataText ? parseAmplData(dataText) : undefined;
      const problem = instantiateAmpl(parseAmplModel(modelText), data);
      return writeNlProblem(problem);
    }),
    ampl_to_modelica: textAction("", async (text, params, ctx) => {
      const { parseAmplModel, parseAmplData, instantiateAmpl, amplToModelica } = await import("./index.js");
      const { modelText, dataText } = resolveAmplModelAndData(text, params, ctx);
      const data = dataText ? parseAmplData(dataText) : undefined;
      const problem = instantiateAmpl(parseAmplModel(modelText), data);
      return amplToModelica(problem);
    }),
    ampl_inspect_geometry: textAction(null, async (text, params, ctx) => {
      const { inspectAmplGeometry } = await import("./index.js");
      const { modelText, dataText } = resolveAmplModelAndData(text, params, ctx);
      return inspectAmplGeometry(modelText, dataText);
    }),
    ampl_sweep: textAction(null, async (text, params, ctx) => {
      const { sweepAmplParameter } = await import("./index.js");
      const { modelText, dataText } = resolveAmplModelAndData(text, params, ctx);
      return sweepAmplParameter(modelText, {
        ...(params as unknown as Parameters<typeof sweepAmplParameter>[1]),
        ...(dataText ? { dataText } : {}),
      });
    }),
    ampl_pareto: textAction(null, async (text, params, ctx) => {
      const { computeAmplPareto } = await import("./index.js");
      const { modelText, dataText } = resolveAmplModelAndData(text, params, ctx);
      return computeAmplPareto(modelText, {
        ...(params as unknown as Parameters<typeof computeAmplPareto>[1]),
        ...(dataText ? { dataText } : {}),
      });
    }),
  };
