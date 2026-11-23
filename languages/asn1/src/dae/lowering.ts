// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for ASN.1 Wire-Bandwidth & Message-Size Budgets.
 *
 * Lowers ASN.1 schema message-size bounds, TLV framing overhead, peak bit-rate
 * equations (`bw_bps = rate_hz * max_bytes * 8`), and cumulative transmitted byte
 * dynamics (`der(tx_bytes) = rate_hz * avg_bytes`) directly into `@modelscript/runtime`'s
 * `IDaeBuilder` linear memory.
 */

import { BinOp, Causality, EqKind, VarType, Variability, type IDaeBuilder } from "@modelscript/runtime";
import { ensureBuiltInAsn1LibraryRegistered } from "../catalog/library-package-adapter.js";
import { computeWireSizeBounds, type WireSizeBounds } from "../solver/wire-analyzer.js";
import type { Asn1Module } from "../types.js";

export interface Asn1DaeLoweringOptions {
  /** Default message transmission rate in Hz for each top-level ASN.1 message type. */
  defaultMessageRateHz?: number;
  /** Default ceiling in bytes for unconstrained variable-length fields. */
  defaultUnboundedMaxBytes?: number;
}

export interface Asn1DaeLoweringResult {
  variableMap: Map<string, number>;
  bounds: Map<string, WireSizeBounds>;
  equationCount: number;
  stateVarIndices: number[];
}

function sanitizeId(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_");
}

/**
 * Lowers an `Asn1Module` wire-size and bandwidth budget model directly into an `IDaeBuilder`.
 */
export function lowerAsn1ToDae(
  builder: IDaeBuilder,
  module: Asn1Module,
  options?: Asn1DaeLoweringOptions,
): Asn1DaeLoweringResult {
  ensureBuiltInAsn1LibraryRegistered();
  const rateHz = options?.defaultMessageRateHz ?? 10.0;
  const unboundedMax = options?.defaultUnboundedMaxBytes ?? 64;
  const bounds = computeWireSizeBounds(module, unboundedMax);

  const variableMap = new Map<string, number>();
  const stateVarIndices: number[] = [];
  let equationCount = 0;

  function addVar(
    name: string,
    varType: VarType,
    variability: Variability,
    causality: Causality = Causality.Local,
    startVal = 0.0,
  ): number {
    const existing = variableMap.get(name);
    if (existing !== undefined) return existing;
    const lookup = builder.lookupVariable(name);
    if (lookup !== -1) {
      variableMap.set(name, lookup);
      return lookup;
    }
    const idx = builder.addVariable(name, varType, variability, causality, startVal);
    variableMap.set(name, idx);
    return idx;
  }

  let totalPeakBwExpr = builder.addRealLiteral(0.0);
  let totalAvgRateExpr = builder.addRealLiteral(0.0);

  for (const [typeName, b] of bounds.entries()) {
    const id = sanitizeId(typeName);
    const avgBytes = 0.5 * (b.minBytes + b.maxBytes);
    const avgOverhead = 0.5 * (b.minTlvOverhead + b.maxTlvOverhead);

    const minV = addVar(`${id}_min_bytes`, VarType.Real, Variability.Parameter, Causality.Local, b.minBytes);
    const maxV = addVar(`${id}_max_bytes`, VarType.Real, Variability.Parameter, Causality.Local, b.maxBytes);
    const rateV = addVar(`${id}_rate_hz`, VarType.Real, Variability.Parameter, Causality.Input, rateHz);
    const ovV = addVar(`${id}_tlv_overhead_bytes`, VarType.Real, Variability.Parameter, Causality.Local, avgOverhead);

    const avgV = addVar(`${id}_avg_bytes`, VarType.Real, Variability.Continuous, Causality.Output, avgBytes);
    const peakBwV = addVar(
      `${id}_peak_bw_bps`,
      VarType.Real,
      Variability.Continuous,
      Causality.Output,
      rateHz * b.maxBytes * 8.0,
    );
    const ovRatioV = addVar(
      `${id}_overhead_ratio`,
      VarType.Real,
      Variability.Continuous,
      Causality.Output,
      avgBytes > 0 ? avgOverhead / avgBytes : 0.0,
    );
    const txBytesV = addVar(`${id}_tx_bytes`, VarType.Real, Variability.Continuous, Causality.Output, 0.0);
    stateVarIndices.push(txBytesV);

    // avg_bytes = 0.5 * (min_bytes + max_bytes)
    const sumMinMax = builder.addBinaryExpr(BinOp.Add, builder.addName(minV), builder.addName(maxV));
    const avgRhs = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(0.5), sumMinMax);
    builder.addEquation(EqKind.Simple, builder.addName(avgV), avgRhs);
    equationCount++;

    // peak_bw_bps = rate_hz * max_bytes * 8.0
    const rateTimesMax = builder.addBinaryExpr(BinOp.Mul, builder.addName(rateV), builder.addName(maxV));
    const peakBwRhs = builder.addBinaryExpr(BinOp.Mul, rateTimesMax, builder.addRealLiteral(8.0));
    builder.addEquation(EqKind.Simple, builder.addName(peakBwV), peakBwRhs);
    equationCount++;

    // overhead_ratio = tlv_overhead_bytes / avg_bytes
    const ovRatioRhs = builder.addBinaryExpr(BinOp.Div, builder.addName(ovV), builder.addName(avgV));
    builder.addEquation(EqKind.Simple, builder.addName(ovRatioV), ovRatioRhs);
    equationCount++;

    // der(tx_bytes) = rate_hz * avg_bytes
    const dTxRhs = builder.addBinaryExpr(BinOp.Mul, builder.addName(rateV), builder.addName(avgV));
    builder.addEquation(EqKind.Simple, builder.addDer(txBytesV), dTxRhs);
    equationCount++;

    totalPeakBwExpr = builder.addBinaryExpr(BinOp.Add, totalPeakBwExpr, builder.addName(peakBwV));
    totalAvgRateExpr = builder.addBinaryExpr(BinOp.Add, totalAvgRateExpr, dTxRhs);
  }

  // Module-level aggregate bandwidth & cumulative traffic state
  const modId = sanitizeId(module.name);
  const totalPeakBwV = addVar(
    `${modId}_total_peak_bw_bps`,
    VarType.Real,
    Variability.Continuous,
    Causality.Output,
    0.0,
  );
  const totalTxV = addVar(`${modId}_total_tx_bytes`, VarType.Real, Variability.Continuous, Causality.Output, 0.0);
  stateVarIndices.push(totalTxV);

  builder.addEquation(EqKind.Simple, builder.addName(totalPeakBwV), totalPeakBwExpr);
  equationCount++;
  builder.addEquation(EqKind.Simple, builder.addDer(totalTxV), totalAvgRateExpr);
  equationCount++;

  return {
    variableMap,
    bounds,
    equationCount,
    stateVarIndices,
  };
}
