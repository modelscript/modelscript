// SPDX-License-Identifier: AGPL-3.0-or-later

export const extractPsseTheoryConstraints = async (text: string) => {
  const { parseRaw } = await import("./index.js");
  const c = parseRaw(text);
  const ns = `PSSE::${c.header?.sbase ?? 100}MVA`;
  const parameters: Array<{
    name: string;
    fqn: string;
    value: number;
    rawValueText: string;
    unit: string;
    line: number;
    startCol: number;
    endCol: number;
  }> = [];
  const ports: Array<{ name: string; kind: string; line: number }> = [];
  if (Number.isFinite(c.header?.sbase)) {
    parameters.push({
      name: "SBASE",
      fqn: `${ns}::SBASE`,
      value: c.header.sbase,
      rawValueText: String(c.header.sbase),
      unit: "MVA",
      line: 1,
      startCol: 1,
      endCol: 6,
    });
  }
  for (const bus of c.buses.values()) {
    const bName = `bus_${bus.i}`;
    if (Number.isFinite(bus.baseKv)) {
      parameters.push({
        name: `${bName}_baseKv`,
        fqn: `${ns}::${bName}.baseKv`,
        value: bus.baseKv,
        rawValueText: String(bus.baseKv),
        unit: "kV",
        line: 1,
        startCol: 1,
        endCol: 1 + bName.length,
      });
    }
    ports.push({ name: bName, kind: "PowerBus", line: 1 });
  }
  for (const gen of c.generators) {
    const gName = `gen_${gen.i}_${gen.id}`;
    if (Number.isFinite(gen.pg)) {
      parameters.push({
        name: `${gName}_pg`,
        fqn: `${ns}::${gName}.pg`,
        value: gen.pg,
        rawValueText: String(gen.pg),
        unit: "MW",
        line: 1,
        startCol: 1,
        endCol: 1 + gName.length,
      });
    }
  }
  return { namespaceFqn: ns, parameters, ports };
};

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

export function createPsseActionHandlers(
  getUnifiedWorkspace: () => Parameters<typeof import("./index.js").getMergedPsseCase>[0],
): Record<string, (ctx: LspActionContext, params?: LspActionParams) => Promise<unknown>> {
  const getParsed = async (ctx: LspActionContext, text: string) => {
    const { getMergedPsseCase } = await import("./index.js");
    const uri = typeof ctx["uri"] === "string" ? ctx["uri"] : "";
    return getMergedPsseCase(getUnifiedWorkspace(), uri, text);
  };
  return {
    simulate_psse_transient: textAction(null, async (text, params, ctx) => {
      const { simulatePsseTransient } = await import("./index.js");
      return simulatePsseTransient(await getParsed(ctx, text), params);
    }),
    analyze_n1_contingencies: textAction(null, async (text, _params, ctx) => {
      const { analyzeN1Contingencies } = await import("./index.js");
      const parsed = await getParsed(ctx, text);
      return analyzeN1Contingencies(parsed, parsed.title1 || `PSS/E Grid (Rev ${parsed.header.rev})`);
    }),
    solve_short_circuit: textAction(null, async (text, _params, ctx) => {
      const { calculateShortCircuit } = await import("./index.js");
      const parsed = await getParsed(ctx, text);
      return calculateShortCircuit(parsed, parsed.title1 || `PSS/E Grid (Rev ${parsed.header.rev})`);
    }),
    lint_psse_case: textAction([], async (text, _params, ctx) => {
      const { lintPsse } = await import("./index.js");
      return lintPsse(await getParsed(ctx, text));
    }),
    extract_powerflow_netlist: textAction(null, async (text, _params, ctx) => {
      const { extractPowerFlowNetlist, serializePowerFlowNetlist } = await import("./index.js");
      const parsed = await getParsed(ctx, text);
      const netlist = extractPowerFlowNetlist(parsed);
      return serializePowerFlowNetlist(netlist, parsed.title1 || `PSS/E Grid (Rev ${parsed.header.rev})`);
    }),
    export_psse_modelica: textAction("", async (text, _params, ctx) => {
      const { psseToModelica } = await import("./index.js");
      return psseToModelica(await getParsed(ctx, text));
    }),
    export_psse_pscad: textAction(null, async (text, _params, ctx) => {
      const { psseToEmtNetlist } = await import("./index.js");
      return psseToEmtNetlist(await getParsed(ctx, text));
    }),
    export_psse_dae: textAction(null, async (text, _params, ctx) => {
      const { lowerPsseToDae } = await import("./index.js");
      const dae = lowerPsseToDae(await getParsed(ctx, text));
      return { varCount: dae.varCount, eqCount: dae.eqCount };
    }),
    solve_powerflow: textAction(null, async (text, params, ctx) => {
      const { solvePowerFlow, formatPowerFlowReport } = await import("./index.js");
      const parsed = await getParsed(ctx, text);
      const sol = solvePowerFlow(parsed, params as Parameters<typeof solvePowerFlow>[1]);
      const caseTitle = parsed.title1 || `PSS/E Grid (Rev ${parsed.header.rev})`;
      return { ...sol, reportText: formatPowerFlowReport(sol, caseTitle) };
    }),
  };
}

export async function buildPsseDiagramInput(
  text: string,
  uri: string,
): Promise<{ model: unknown; powerFlow?: unknown }> {
  const { parseRaw, solvePowerFlow, isLikelyDyrContent, parseDyr } = await import("./index.js");
  if (uri.endsWith(".dyr") || isLikelyDyrContent(text)) {
    const dyr = parseDyr(text);
    if (dyr.records.length > 0) {
      const buses = new Map<number, { i: number; name: string; baseKv: number; ide: number; vm: number }>();
      const generators: Array<{ i: number; id: string; pg: number; qg: number; stat: number }> = [];
      for (const rec of dyr.records) {
        if (!buses.has(rec.ibus)) {
          buses.set(rec.ibus, { i: rec.ibus, name: `BUS ${rec.ibus}`, baseKv: 138, ide: 2, vm: 1.0 });
        }
        generators.push({
          i: rec.ibus,
          id: `${rec.model}_${rec.id}`,
          pg: rec.con[0] ?? 0,
          qg: 0,
          stat: 1,
        });
      }
      return {
        model: {
          title1: "PSS/E Dynamic Equipment Models (.dyr)",
          buses,
          branches: [],
          generators,
        },
      };
    }
  }
  const parsed = parseRaw(text);
  const pf = parsed.buses.size > 0 ? solvePowerFlow(parsed) : undefined;
  return { model: parsed, powerFlow: pf };
}
