// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct Linear-Memory DAE Arena Lowering for `@modelscript/ihex`.
 *
 * Lowers ROM memory-footprint, segment address span, gap balance, flash utilization,
 * and checksum integrity equations directly into `@modelscript/runtime`'s `IDaeBuilder`
 * without intermediate AST wrapper allocations.
 */

import { BinOp, Causality, DAEBuilder, EqKind, VarType, Variability, type IDaeBuilder } from "@modelscript/runtime";
import { solveIhexImage, type IhexSolveOptions } from "../solver/index.js";
import type { IhexModel } from "../types.js";

export interface IhexDaeLoweringResult {
  variableCount: number;
  equationCount: number;
  segmentCount: number;
  variableMap: Map<string, number>;
}

export interface IhexToDaeOptions extends IhexSolveOptions {
  modelName?: string | undefined;
}

/**
 * Lowers an `IhexModel`'s memory-footprint and checksum balance equations into `builder`.
 */
export function lowerIhexToDae(
  builder: IDaeBuilder,
  model: IhexModel,
  options: IhexSolveOptions = {},
): IhexDaeLoweringResult {
  const solved = solveIhexImage(model, options);
  const map = solved.memoryMap;
  const variableMap = new Map<string, number>();
  let equationCount = 0;

  function addParam(name: string, val: number): number {
    const idx = builder.addVariable(name, VarType.Real, Variability.Parameter, Causality.Local, val);
    variableMap.set(name, idx);
    return idx;
  }

  function addVar(name: string, val: number): number {
    const idx = builder.addVariable(name, VarType.Real, Variability.Continuous, Causality.Local, val);
    variableMap.set(name, idx);
    return idx;
  }

  // Global ROM footprint & integrity variables
  const vTotalBytes = addVar("total_data_bytes", map.totalDataBytes);
  const vGapBytes = addVar("total_gap_bytes", map.totalGapBytes);
  const vSpanBytes = addVar("total_span_bytes", map.totalSpanBytes);
  const pFlashSize = addParam("flash_size_bytes", solved.flashSizeBytes);
  const vFlashUtil = addVar("flash_utilization", solved.flashUtilization);

  const pRecordCount = addParam("record_count", solved.recordCount);
  const pValidChecksums = addParam("valid_checksum_count", solved.validChecksumCount);
  const vChecksumRatio = addVar(
    "checksum_valid_ratio",
    solved.recordCount > 0 ? solved.validChecksumCount / solved.recordCount : 1.0,
  );
  const vChecksumRmse = addVar("checksum_rmse", solved.checksumRmse);
  const vImageCrc32 = addVar("image_crc32", solved.imageCrc32);
  const vImageFletcher16 = addVar("image_fletcher16", solved.imageFletcher16);

  // Equation 1: total_span_bytes = total_data_bytes + total_gap_bytes
  builder.addEquation(
    EqKind.Simple,
    builder.addName(vSpanBytes),
    builder.addBinaryExpr(BinOp.Add, builder.addName(vTotalBytes), builder.addName(vGapBytes)),
  );
  equationCount += 1;

  // Equation 2: flash_utilization * flash_size_bytes = total_data_bytes
  builder.addEquation(
    EqKind.Simple,
    builder.addBinaryExpr(BinOp.Mul, builder.addName(vFlashUtil), builder.addName(pFlashSize)),
    builder.addName(vTotalBytes),
  );
  equationCount += 1;

  // Equation 3: checksum_valid_ratio * record_count = valid_checksum_count (when recordCount > 0)
  if (solved.recordCount > 0) {
    builder.addEquation(
      EqKind.Simple,
      builder.addBinaryExpr(BinOp.Mul, builder.addName(vChecksumRatio), builder.addName(pRecordCount)),
      builder.addName(pValidChecksums),
    );
    equationCount += 1;
  } else {
    builder.addEquation(EqKind.Simple, builder.addName(vChecksumRatio), builder.addRealLiteral(1.0));
    equationCount += 1;
  }

  // Equation 4–6: Integrity metrics bindings
  builder.addEquation(EqKind.Simple, builder.addName(vChecksumRmse), builder.addRealLiteral(solved.checksumRmse));
  builder.addEquation(EqKind.Simple, builder.addName(vImageCrc32), builder.addRealLiteral(solved.imageCrc32));
  builder.addEquation(EqKind.Simple, builder.addName(vImageFletcher16), builder.addRealLiteral(solved.imageFletcher16));
  equationCount += 3;

  // Per-segment footprint & address span equations
  const segLenExprs: number[] = [];
  for (const seg of map.segments) {
    const prefix = `seg_${seg.index}`;
    const pStart = addParam(`${prefix}_start_addr`, seg.startAddress);
    const pLen = addParam(`${prefix}_length`, seg.length);
    const vEnd = addVar(`${prefix}_end_addr`, seg.endAddress);
    const vCrc = addVar(`${prefix}_crc32`, seg.crc32);

    // seg_i_end_addr = seg_i_start_addr + seg_i_length
    builder.addEquation(
      EqKind.Simple,
      builder.addName(vEnd),
      builder.addBinaryExpr(BinOp.Add, builder.addName(pStart), builder.addName(pLen)),
    );
    builder.addEquation(EqKind.Simple, builder.addName(vCrc), builder.addRealLiteral(seg.crc32));
    equationCount += 2;

    segLenExprs.push(builder.addName(pLen));
  }

  // Total data bytes balance: total_data_bytes = sum(seg_i_length)
  if (segLenExprs.length === 0) {
    builder.addEquation(EqKind.Simple, builder.addName(vTotalBytes), builder.addRealLiteral(0.0));
    equationCount += 1;
  } else {
    let sumExpr = segLenExprs[0]!;
    for (let i = 1; i < segLenExprs.length; i++) {
      sumExpr = builder.addBinaryExpr(BinOp.Add, sumExpr, segLenExprs[i]!);
    }
    builder.addEquation(EqKind.Simple, builder.addName(vTotalBytes), sumExpr);
    equationCount += 1;
  }

  // Gap balance equation: total_gap_bytes = map.totalGapBytes
  builder.addEquation(EqKind.Simple, builder.addName(vGapBytes), builder.addRealLiteral(map.totalGapBytes));
  equationCount += 1;

  return {
    variableCount: variableMap.size,
    equationCount,
    segmentCount: map.segments.length,
    variableMap,
  };
}

/**
 * High-level wrapper that lowers an `IhexModel` into a fresh `DAEBuilder` arena.
 */
export function ihexToDae(model: IhexModel, options?: IhexToDaeOptions): DAEBuilder {
  const modelName = (options?.modelName || model.name || "IhexFirmwareImage").replace(/[^A-Za-z0-9_]/g, "_");
  const builder = new DAEBuilder(undefined, modelName);
  lowerIhexToDae(builder, model, options);
  return builder;
}
