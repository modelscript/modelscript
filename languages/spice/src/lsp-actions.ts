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

export const extractSpiceTheoryConstraints = async (text: string) => {
  const { parseSpice, parseSpiceNumber } = await import("./index.js");
  const circuit = parseSpice(text);
  const sanitizeNs = (raw: string) => {
    let out = "";
    let prevWs = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw.charCodeAt(i);
      if (ch === 32 || ch === 9 || ch === 10 || ch === 13) {
        if (!prevWs) {
          out += "_";
          prevWs = true;
        }
      } else {
        out += raw[i] ?? "";
        prevWs = false;
      }
    }
    return out;
  };
  const ns = circuit.title ? `SPICE::${sanitizeNs(circuit.title)}` : "SPICE::Circuit";
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
  const seenNodes = new Set<string>();
  const ports: Array<{ name: string; kind: string; line: number }> = [];
  const unitForType = (t: string): string => {
    const up = t.toUpperCase();
    if (up === "R") return "Ohm";
    if (up === "C") return "F";
    if (up === "L") return "H";
    if (up === "V" || up === "E") return "V";
    if (up === "I" || up === "G") return "A";
    return "";
  };
  for (const comp of circuit.components ?? []) {
    const val =
      typeof comp.value === "number"
        ? comp.value
        : comp.rawValueExpr
          ? parseSpiceNumber(comp.rawValueExpr)
          : Number.NaN;
    const compLine = (comp as { line?: number }).line ?? 1;
    if (Number.isFinite(val)) {
      parameters.push({
        name: comp.name,
        fqn: `${ns}::${comp.name}`,
        value: val,
        rawValueText: String(comp.rawValueExpr ?? val),
        unit: unitForType(String(comp.kind ?? "")),
        line: compLine,
        startCol: 1,
        endCol: 1 + comp.name.length,
      });
    }
    for (const n of comp.nodes ?? []) {
      if (n && !seenNodes.has(n)) {
        seenNodes.add(n);
        ports.push({ name: n, kind: "ElectricalNode", line: compLine });
      }
    }
  }
  return { namespaceFqn: ns, parameters, ports };
};

export const spiceActionHandlers: Record<
  string,
  (ctx: LspActionContext, params?: LspActionParams) => Promise<unknown>
> = {
  spice_run_op: textAction(null, async (text) => {
    const { parseSpice, solveOp } = await import("./index.js");
    return solveOp(parseSpice(text));
  }),
  spice_run_tran: textAction(null, async (text, params) => {
    const { parseSpice, solveTran } = await import("./index.js");
    return solveTran(parseSpice(text), params as Parameters<typeof solveTran>[1]);
  }),
  spice_run_ac: textAction(null, async (text, params) => {
    const { parseSpice, solveAc } = await import("./index.js");
    return solveAc(parseSpice(text), params as Parameters<typeof solveAc>[1]);
  }),
  export_spice_modelica: textAction("", async (text) => {
    const { parseSpice, spiceToModelica } = await import("./index.js");
    return spiceToModelica(parseSpice(text));
  }),
  export_spice_ecad: textAction(null, async (text) => {
    const { parseSpice, spiceToNetlistGraph } = await import("./index.js");
    return spiceToNetlistGraph(parseSpice(text));
  }),
};
