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

export const opendriveActionHandlers: Record<
  string,
  (ctx: LspActionContext, params?: LspActionParams) => Promise<unknown>
> = {
  lint_opendrive: textAction([], async (text) => {
    const { lintOpenDrive, parseOpenDrive } = await import("./index.js");
    return lintOpenDrive(parseOpenDrive(text));
  }),
  export_opendrive_gensys: textAction("", async (text, params) => {
    const { opendriveToGensys, parseOpenDrive } = await import("./index.js");
    return opendriveToGensys(parseOpenDrive(text), params?.step ?? 1.0);
  }),
  export_opendrive_dae: textAction(null, async (text) => {
    const { lowerOpenDriveToDae, parseOpenDrive } = await import("./index.js");
    const arena = lowerOpenDriveToDae(parseOpenDrive(text));
    return { variableCount: arena.getVarCount(), equationCount: arena.getEqCount() };
  }),
  sample_opendrive_track: textAction([], async (text, params) => {
    const { parseOpenDrive, sampleRoadTrack } = await import("./index.js");
    const doc = parseOpenDrive(text);
    const step = params?.step ?? 1.0;
    return doc.roads.map((r) => ({ roadId: r.id, name: r.name, points: sampleRoadTrack(r, step) }));
  }),
  render_opendrive_svg: textAction("", async (text, params) => {
    const { parseOpenDrive, renderOpenDriveSvg } = await import("./index.js");
    return renderOpenDriveSvg(parseOpenDrive(text), {
      sampleStep: params?.step ?? 1.0,
      theme: params?.theme ?? "dark",
    });
  }),
};
