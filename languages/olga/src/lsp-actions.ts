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

export const olgaActionHandlers: Record<string, (ctx: LspActionContext, params?: LspActionParams) => Promise<unknown>> =
  {
    lint_olga_case: textAction([], async (text) => {
      const { parseOlga, lintOlgaModel } = await import("./index.js");
      return lintOlgaModel(parseOlga(text));
    }),
    simulate_drift_flux: textAction(null, async (text, params) => {
      const { parseOlga, simulateDriftFlux } = await import("./index.js");
      return simulateDriftFlux(parseOlga(text), { durationSeconds: params?.durationSeconds });
    }),
    project_to_sysml2: textAction("", async (text) => {
      const { parseOlga, olgaToSysml2 } = await import("./index.js");
      return olgaToSysml2(parseOlga(text));
    }),
    export_olga_dae: textAction(null, async (text) => {
      const { parseOlga, lowerOlgaToDae } = await import("./index.js");
      const dae = lowerOlgaToDae(parseOlga(text));
      return { varCount: dae.varCount, eqCount: dae.eqCount };
    }),
    verify_flow_assurance: textAction(null, async (text) => {
      const { parseOlga, simulateDriftFlux, verifyFlowAssuranceTrajectory } = await import("./index.js");
      const trajectory = simulateDriftFlux(parseOlga(text));
      return verifyFlowAssuranceTrajectory(trajectory);
    }),
    inspect_olga_elevation_profile: textAction(null, async (text) => {
      const { parseOlga, simulateDriftFlux } = await import("./index.js");
      const { renderOlgaElevationProfileSvg, renderOlgaSchematicSvg } = await import("@modelscript/diagram");
      const model = parseOlga(text);
      const trajectory = simulateDriftFlux(model, { durationSeconds: 60 });
      return {
        schematicSvg: renderOlgaSchematicSvg(model),
        elevationProfileSvg: renderOlgaElevationProfileSvg(model, trajectory),
      };
    }),
  };
