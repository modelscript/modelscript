// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Evaluates PSCAD parameter expressions: numeric literals with optional unit suffix
 * (`0.05 [s]`), references to enclosing-definition parameters, and basic arithmetic.
 */
export type ParamScope = Map<string, number>;

const UNIT = /\s*\[([^\]]*)\]\s*$/;
const PREFIX: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, m: 1e-3, k: 1e3, M: 1e6, G: 1e9 };
const BASE_UNITS = /^(ohm|Ω|H|F|s|Hz|V|A|W|VAR|VA)$/;

/** SI scale of a PSCAD unit suffix such as `uF`, `kV`, `MVAR`; 1 for unknown or unscaled units. */
export function unitScale(unit: string): number {
  const u = unit.trim();
  if (u === "" || BASE_UNITS.test(u)) return 1;
  const prefix = PREFIX[u[0]!];
  if (prefix !== undefined && BASE_UNITS.test(u.slice(1))) return prefix;
  return 1;
}

/** Returns `undefined` when the expression cannot be fully evaluated. */
export function evalParamExpr(raw: string | number | undefined, scope: ParamScope): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  const unitMatch = UNIT.exec(raw);
  const scale = unitMatch ? unitScale(unitMatch[1]!) : 1;
  const src = raw.replace(UNIT, "").trim();
  if (src === "") return undefined;
  const lit = Number(src);
  if (Number.isFinite(lit)) return lit * scale;
  if (/^(true|\.true\.)$/i.test(src)) return 1;
  if (/^(false|\.false\.)$/i.test(src)) return 0;
  let i = 0;
  let failed = false;
  const peek = (): string => src[i] ?? "";
  const ws = (): void => {
    while (peek() === " ") i++;
  };
  const primary = (): number => {
    ws();
    const c = peek();
    if (c === "(") {
      i++;
      const v = additive();
      ws();
      if (peek() === ")") i++;
      else failed = true;
      return v;
    }
    if (c === "-") {
      i++;
      return -primary();
    }
    if (c === "+") {
      i++;
      return primary();
    }
    const num = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) {
      i += num[0].length;
      return Number(num[0]);
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) {
      i += id[0].length;
      const v = scope.get(id[0]);
      if (v === undefined) failed = true;
      return v ?? 0;
    }
    failed = true;
    return 0;
  };
  const multiplicative = (): number => {
    let v = primary();
    for (;;) {
      ws();
      const c = peek();
      if (c === "*") {
        i++;
        v *= primary();
      } else if (c === "/") {
        i++;
        v /= primary();
      } else return v;
    }
  };
  const additive = (): number => {
    let v = multiplicative();
    for (;;) {
      ws();
      const c = peek();
      if (c === "+") {
        i++;
        v += multiplicative();
      } else if (c === "-") {
        i++;
        v -= multiplicative();
      } else return v;
    }
  };
  const result = additive();
  ws();
  if (failed || i < src.length || !Number.isFinite(result)) return undefined;
  return result * scale;
}

/** Resolves a parameter bag into numbers where possible, leaving unresolved entries untouched. */
export function resolveParamBag(
  params: Record<string, string | number>,
  scope: ParamScope,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string" || typeof v === "number") {
      const n = evalParamExpr(v, scope);
      out[k] = n === undefined ? v : n;
    } else if (v !== undefined) out[k] = v as string | number;
  }
  return out;
}
