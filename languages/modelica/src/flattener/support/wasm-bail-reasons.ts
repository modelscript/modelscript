// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Host-side mirror of the `WasmBailReason` enum in `assembly/flattener.ts`.
 *
 * The WASM flattening kernel calls `setErrorAt(reason, loc)` when it encounters a
 * construct it cannot lower. The numeric codes cross the WASM boundary via
 * `flattener_getErrorCode` and must stay in sync with the AssemblyScript enum.
 */
export const WasmBailReason = {
  /** Host-only: the kernel trapped/threw instead of reporting a reason. */
  KernelTrap: -1,
  /** Host-only: hybrid mode routes models with algorithm sections to TS until parity is proven. */
  HybridAlgorithmGate: -2,
  None: 0,
  WhenOrIfEquation: 3290,
  ForEquationNoIndex: 3291,
  ForEquationRange: 3292,
  ForEquationNoBody: 3293,
  SimpleEquationOperands: 3323,
  SimpleEquationExpr: 3330,
  ArrayEquationSize: 3348,
  ArrayEquationNonCtor: 3363,
  EquationLhsUnresolved: 3370,
  EquationRhsUnresolved: 3377,
  ConnectRefExpr: 3425,
  ClauseDimensions: 3570,
  DeclarationDimensions: 3609,
  BindingExpr: 3625,
  ArrayBindingShape: 3626,
  IntegerRealBinding: 3629,
  IntegerRealModifier: 3645,
  IfExprArraySize: 3760,
  IfExprArrayNesting: 3770,
  IfExprArrayScalarMix: 3775,
  AlgorithmStatementUnsupported: 3800,
  AlgorithmReinit: 3801,
  ForStatementImplicitRange: 3802,
} as const;

export type WasmBailReasonName = keyof typeof WasmBailReason;

const DESCRIPTIONS: Record<number, string> = {
  [WasmBailReason.KernelTrap]: "kernel trapped or threw",
  [WasmBailReason.HybridAlgorithmGate]: "algorithm section (hybrid routes to TS)",
  [WasmBailReason.WhenOrIfEquation]: "when/if equation",
  [WasmBailReason.ForEquationNoIndex]: "for-equation without index",
  [WasmBailReason.ForEquationRange]: "for-equation range not evaluable",
  [WasmBailReason.ForEquationNoBody]: "for-equation without loop body",
  [WasmBailReason.SimpleEquationOperands]: "equation operands missing",
  [WasmBailReason.SimpleEquationExpr]: "equation expression not lowerable",
  [WasmBailReason.ArrayEquationSize]: "array equation size mismatch",
  [WasmBailReason.ArrayEquationNonCtor]: "array equation with non-constructor operand",
  [WasmBailReason.EquationLhsUnresolved]: "unresolved name on equation left-hand side",
  [WasmBailReason.EquationRhsUnresolved]: "unresolved name on equation right-hand side",
  [WasmBailReason.ConnectRefExpr]: "connect reference not lowerable",
  [WasmBailReason.ClauseDimensions]: "component clause dimensions not evaluable",
  [WasmBailReason.DeclarationDimensions]: "declaration dimensions not evaluable",
  [WasmBailReason.BindingExpr]: "binding expression not lowerable",
  [WasmBailReason.ArrayBindingShape]: "array binding shape/type mismatch",
  [WasmBailReason.IntegerRealBinding]: "Integer variable with Real binding",
  [WasmBailReason.IntegerRealModifier]: "Integer variable with Real modifier",
  [WasmBailReason.IfExprArraySize]: "if-expression array size mismatch",
  [WasmBailReason.IfExprArrayNesting]: "if-expression array nesting mismatch",
  [WasmBailReason.IfExprArrayScalarMix]: "if-expression mixing array and scalar",
  [WasmBailReason.AlgorithmStatementUnsupported]: "algorithm statement not lowerable",
  [WasmBailReason.AlgorithmReinit]: "reinit in algorithm section",
  [WasmBailReason.ForStatementImplicitRange]: "for-statement with implicit range",
};

const NAMES: Record<number, WasmBailReasonName> = Object.fromEntries(
  Object.entries(WasmBailReason).map(([name, code]) => [code, name as WasmBailReasonName]),
);

/** Structured record of a WASM kernel bail-out, attached to the resulting DAE. */
export interface WasmBailInfo {
  /** Numeric `WasmBailReason` code (0 when the kernel completed). */
  code: number;
  /** Symbolic reason name, e.g. `AlgorithmStatementUnsupported`. */
  reason: WasmBailReasonName | "Unknown";
  /** Human-readable description of the unsupported construct. */
  description: string;
  /** Source range of the offending CST node (string offsets, like CST `startByte`), when known. */
  range: { startByte: number; endByte: number } | null;
  /** What the host did after the bail-out. */
  action: "strict-partial" | "ts-fallback";
}

const UNKNOWN_BYTE = 0xffffffff;

export function describeWasmBail(
  code: number,
  startByte: number | undefined,
  endByte: number | undefined,
  action: WasmBailInfo["action"],
  /** Bytes per code unit of the parser input buffer (2 for UTF-16, 4 for UTF-32). */
  unitSize = 1,
): WasmBailInfo {
  // Raw WASM exports surface u32 values as signed i32 in JS (0xffffffff → -1).
  const start = typeof startByte === "number" ? startByte >>> 0 : UNKNOWN_BYTE;
  const end = typeof endByte === "number" ? endByte >>> 0 : UNKNOWN_BYTE;
  const hasRange = start !== UNKNOWN_BYTE && end !== UNKNOWN_BYTE && end >= start;
  const div = unitSize > 0 ? unitSize : 1;
  return {
    code,
    reason: NAMES[code] ?? "Unknown",
    description: DESCRIPTIONS[code] ?? `kernel error ${code}`,
    range: hasRange ? { startByte: Math.floor(start / div), endByte: Math.floor(end / div) } : null,
    action,
  };
}

/** Maps the parser's `lsp_getInputEncoding()` value to bytes per code unit. */
export function inputEncodingUnitSize(encoding: number | undefined): number {
  // InputEncoding: 0 = UTF-8, 1 = UTF-16LE, 2 = UTF-16BE, 3 = UTF-32LE, 4 = UTF-32BE
  if (encoding === 1 || encoding === 2) return 2;
  if (encoding === 3 || encoding === 4) return 4;
  return 1;
}

/** One-line summary, e.g. `AlgorithmReinit (reinit in algorithm section)`. */
export function formatWasmBail(info: WasmBailInfo): string {
  return `${info.reason} (${info.description})`;
}
