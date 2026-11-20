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

export interface PscadActionDeps {
  buildDiagram?: (project: any, definitionName?: string) => Promise<unknown> | any;
  getEmtSolverRunner?: () => Promise<((circuit: any, options: any) => any) | undefined>;
}

export function createPscadActionHandlers(
  deps: PscadActionDeps = {},
): Record<string, (ctx: LspActionContext, params?: LspActionParams) => Promise<unknown>> {
  return {
    lint_pscad_project: textAction([], async (text) => {
      const { parsePscx, lintPscx } = await import("./index.js");
      return lintPscx(parsePscx(text));
    }),
    analyze_pscad_signal_ranges: textAction([], async (text) => {
      const { parsePscx, analyzePscadSignalRanges } = await import("./index.js");
      return analyzePscadSignalRanges(parsePscx(text));
    }),
    inspect_pscad_schematic: textAction(null, async (text, params) => {
      const { parsePscx, extractEmtNetlist } = await import("./index.js");
      const project = parsePscx(text);
      const diagram = deps.buildDiagram ? await deps.buildDiagram(project, params?.definitionName) : null;
      return { netlist: extractEmtNetlist(project), diagram };
    }),
    simulate_hybrid_emt: textAction(null, async (text, params) => {
      const { runPscadSimulationPipeline } = await import("./index.js");
      const solverRunner = deps.getEmtSolverRunner ? await deps.getEmtSolverRunner() : undefined;
      const strictNetlist = params?.allowSyntheticFallback ? false : (params?.strictNetlist ?? true);
      return runPscadSimulationPipeline({
        documentText: text,
        runSimulation: true,
        strictNetlist,
        strict: params?.strict,
        durationSec: params?.durationSec,
        timeStepSec: params?.timeStepSec,
        verifyIeee2800: Boolean(params?.verifyIeee2800),
        exportComtrade: params?.exportComtrade ?? true,
        exportOut: params?.exportOut ?? true,
        solverRunner,
      });
    }),
    run_mrun_sweep: textAction(null, async (text, params) => {
      const { parsePscx, extractEmtNetlist, runMultipleRunSweep } = await import("./index.js");
      const project = parsePscx(text);
      return runMultipleRunSweep(extractEmtNetlist(project), params);
    }),
  };
}
