// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct linear-memory DAE Arena lowering for Motorola S-Record firmware images.
 *
 * Lowers firmware footprint, address span, utilization, record count, and per-region
 * memory layout equations directly into `@modelscript/runtime`'s `IDaeBuilder`.
 */

import { BinOp, Causality, DAEBuilder, EqKind, type IDaeBuilder, VarType, Variability } from "@modelscript/runtime";
import { solveSrecMemory } from "../solver/index.js";
import type { SrecFile, SrecSolveResult } from "../types.js";

export interface SrecDaeLoweringResult {
  equationCount: number;
  variableMap: Map<string, number>;
  solved: SrecSolveResult;
}

export interface SrecToDaeOptions {
  modelName?: string | undefined;
}

/**
 * Lowers a parsed `SrecFile` directly into an `IDaeBuilder` linear-memory arena.
 */
export function lowerSrecToDae(builder: IDaeBuilder, file: SrecFile): SrecDaeLoweringResult {
  const solved = solveSrecMemory(file);
  const variableMap = new Map<string, number>();
  let equationCount = 0;

  function addVar(
    name: string,
    type: VarType,
    variability: Variability,
    causality: Causality,
    startVal: number,
  ): number {
    const existing = builder.lookupVariable(name);
    if (existing !== -1) {
      variableMap.set(name, existing);
      return existing;
    }
    const idx = builder.addVariable(name, type, variability, causality, startVal);
    variableMap.set(name, idx);
    return idx;
  }

  // Top-level firmware parameters
  const minAddrVar = addVar("min_address", VarType.Real, Variability.Parameter, Causality.Local, solved.minAddress);
  const maxAddrVar = addVar("max_address", VarType.Real, Variability.Parameter, Causality.Local, solved.maxAddress);
  const recordCountVar = addVar(
    "record_count",
    VarType.Real,
    Variability.Parameter,
    Causality.Local,
    file.records.length,
  );
  const dataRecordCountVar = addVar(
    "data_record_count",
    VarType.Real,
    Variability.Parameter,
    Causality.Local,
    file.dataRecordCount,
  );
  const regionCountVar = addVar(
    "region_count",
    VarType.Real,
    Variability.Parameter,
    Causality.Local,
    solved.regions.length,
  );
  addVar("entry_point", VarType.Real, Variability.Parameter, Causality.Local, solved.startAddress ?? 0);
  addVar("crc32", VarType.Real, Variability.Parameter, Causality.Local, solved.overallCrc32);

  // Derived continuous outputs
  const addressSpanVar = addVar(
    "address_span",
    VarType.Real,
    Variability.Continuous,
    Causality.Output,
    solved.addressSpan,
  );
  const totalBytesVar = addVar(
    "total_data_bytes",
    VarType.Real,
    Variability.Continuous,
    Causality.Output,
    solved.totalDataBytes,
  );
  const utilizationVar = addVar(
    "memory_utilization",
    VarType.Real,
    Variability.Continuous,
    Causality.Output,
    solved.utilization,
  );
  const gapBytesVar = addVar(
    "gap_bytes",
    VarType.Real,
    Variability.Continuous,
    Causality.Output,
    Math.max(0, solved.addressSpan - solved.totalDataBytes),
  );
  const avgRecBytesVar = addVar(
    "avg_bytes_per_record",
    VarType.Real,
    Variability.Continuous,
    Causality.Output,
    file.dataRecordCount > 0 ? solved.totalDataBytes / file.dataRecordCount : 0,
  );

  // Equation 1: address_span = max_address - min_address
  const spanRhs = builder.addBinaryExpr(BinOp.Sub, builder.addName(maxAddrVar), builder.addName(minAddrVar));
  builder.addEquation(EqKind.Simple, builder.addName(addressSpanVar), spanRhs);
  equationCount++;

  // Per-region variables & size equations: region_i_size = region_i_end - region_i_start
  const regionSizeExprs: number[] = [];
  for (const reg of solved.regions) {
    const rStart = addVar(
      `region_${reg.index}_start`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      reg.startAddress,
    );
    const rEnd = addVar(
      `region_${reg.index}_end`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      reg.endAddress,
    );
    const rSize = addVar(`region_${reg.index}_size`, VarType.Real, Variability.Continuous, Causality.Output, reg.size);
    addVar(`region_${reg.index}_crc32`, VarType.Real, Variability.Parameter, Causality.Local, reg.crc32);

    const regSizeExpr = builder.addBinaryExpr(BinOp.Sub, builder.addName(rEnd), builder.addName(rStart));
    builder.addEquation(EqKind.Simple, builder.addName(rSize), regSizeExpr);
    equationCount++;
    regionSizeExprs.push(builder.addName(rSize));
  }

  // Equation 2: total_data_bytes = sum(region_i_size)
  let sumExpr: number;
  if (regionSizeExprs.length === 0) {
    sumExpr = builder.addRealLiteral(0.0);
  } else {
    sumExpr = regionSizeExprs[0]!;
    for (let i = 1; i < regionSizeExprs.length; i++) {
      sumExpr = builder.addBinaryExpr(BinOp.Add, sumExpr, regionSizeExprs[i]!);
    }
  }
  builder.addEquation(EqKind.Simple, builder.addName(totalBytesVar), sumExpr);
  equationCount++;

  // Equation 3: gap_bytes = address_span - total_data_bytes
  const gapExpr = builder.addBinaryExpr(BinOp.Sub, builder.addName(addressSpanVar), builder.addName(totalBytesVar));
  builder.addEquation(EqKind.Simple, builder.addName(gapBytesVar), gapExpr);
  equationCount++;

  // Equation 4: memory_utilization = total_data_bytes / max(address_span, 1)
  if (solved.addressSpan > 0) {
    const utilExpr = builder.addBinaryExpr(BinOp.Div, builder.addName(totalBytesVar), builder.addName(addressSpanVar));
    builder.addEquation(EqKind.Simple, builder.addName(utilizationVar), utilExpr);
  } else {
    builder.addEquation(EqKind.Simple, builder.addName(utilizationVar), builder.addRealLiteral(0.0));
  }
  equationCount++;

  // Equation 5: avg_bytes_per_record = total_data_bytes / data_record_count (if > 0)
  if (file.dataRecordCount > 0) {
    const avgExpr = builder.addBinaryExpr(
      BinOp.Div,
      builder.addName(totalBytesVar),
      builder.addName(dataRecordCountVar),
    );
    builder.addEquation(EqKind.Simple, builder.addName(avgRecBytesVar), avgExpr);
  } else {
    builder.addEquation(EqKind.Simple, builder.addName(avgRecBytesVar), builder.addRealLiteral(0.0));
  }
  equationCount++;

  // Suppress unused variable warnings by referencing recordCountVar & regionCountVar in metadata
  void recordCountVar;
  void regionCountVar;

  return {
    equationCount,
    variableMap,
    solved,
  };
}

/**
 * High-level wrapper that creates a `DAEBuilder` and lowers an `SrecFile` into it.
 */
export function srecToDae(file: SrecFile, options?: SrecToDaeOptions): DAEBuilder {
  const modelName = (options?.modelName || file.name || "SrecFirmwareImage").replace(/[^A-Za-z0-9_]/g, "_");
  const builder = new DAEBuilder(undefined, modelName);
  lowerSrecToDae(builder, file);
  return builder;
}
