// SPDX-License-Identifier: AGPL-3.0-or-later

import { Plot3dErrorCode } from "../errors.js";
import { conservativeToPrimitive } from "../solver/flow.js";
import { computeBlockMetrics } from "../solver/metrics.js";
import type {
  Plot3dDataset,
  Plot3dDiagnostic,
  Plot3dFunctionFile,
  Plot3dGrid,
  Plot3dNamMetadata,
  Plot3dSolution,
} from "../types.js";

function checkFiniteArray(arr: Float64Array, blockIndex: number, field: string, diags: Plot3dDiagnostic[]): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i]!)) {
      diags.push({
        id: Plot3dErrorCode.NAN_OR_INF_VALUE.stdCode,
        code: Plot3dErrorCode.NAN_OR_INF_VALUE.code,
        rule: Plot3dErrorCode.NAN_OR_INF_VALUE.rule,
        severity: Plot3dErrorCode.NAN_OR_INF_VALUE.severity,
        message: Plot3dErrorCode.NAN_OR_INF_VALUE.message(blockIndex, field, i),
        blockIndex,
      });
      return false;
    }
  }
  return true;
}

/**
 * Lints a PLOT3D structured grid (`.xyz`/`.g`) for empty blocks, non-positive dimensions,
 * coordinate count mismatches, non-finite coordinates, and negative Jacobian / inverted cell volumes.
 */
export function lintPlot3dGrid(grid: Plot3dGrid): Plot3dDiagnostic[] {
  const diags: Plot3dDiagnostic[] = [];

  if (grid.blocks.length === 0) {
    diags.push({
      id: Plot3dErrorCode.EMPTY_GRID.stdCode,
      code: Plot3dErrorCode.EMPTY_GRID.code,
      rule: Plot3dErrorCode.EMPTY_GRID.rule,
      severity: Plot3dErrorCode.EMPTY_GRID.severity,
      message: Plot3dErrorCode.EMPTY_GRID.message(),
    });
    return diags;
  }

  for (const b of grid.blocks) {
    if (b.ni <= 0 || b.nj <= 0 || b.nk <= 0) {
      diags.push({
        id: Plot3dErrorCode.NON_POSITIVE_BLOCK_DIMENSION.stdCode,
        code: Plot3dErrorCode.NON_POSITIVE_BLOCK_DIMENSION.code,
        rule: Plot3dErrorCode.NON_POSITIVE_BLOCK_DIMENSION.rule,
        severity: Plot3dErrorCode.NON_POSITIVE_BLOCK_DIMENSION.severity,
        message: Plot3dErrorCode.NON_POSITIVE_BLOCK_DIMENSION.message(b.index, b.ni, b.nj, b.nk),
        blockIndex: b.index,
      });
      continue;
    }

    const expected = b.ni * b.nj * b.nk;
    let countValid = true;
    const coordFields: Array<[string, Float64Array]> =
      grid.dimension === "3d"
        ? [
            ["x", b.x],
            ["y", b.y],
            ["z", b.z],
          ]
        : [
            ["x", b.x],
            ["y", b.y],
          ];

    for (const [name, arr] of coordFields) {
      if (arr.length !== expected) {
        countValid = false;
        diags.push({
          id: Plot3dErrorCode.COORDINATE_COUNT_MISMATCH.stdCode,
          code: Plot3dErrorCode.COORDINATE_COUNT_MISMATCH.code,
          rule: Plot3dErrorCode.COORDINATE_COUNT_MISMATCH.rule,
          severity: Plot3dErrorCode.COORDINATE_COUNT_MISMATCH.severity,
          message: Plot3dErrorCode.COORDINATE_COUNT_MISMATCH.message(b.index, name, arr.length, expected),
          blockIndex: b.index,
        });
      } else {
        checkFiniteArray(arr, b.index, name, diags);
      }
    }

    if (grid.hasIblank && b.iblank && b.iblank.length !== expected) {
      countValid = false;
      diags.push({
        id: Plot3dErrorCode.COORDINATE_COUNT_MISMATCH.stdCode,
        code: Plot3dErrorCode.COORDINATE_COUNT_MISMATCH.code,
        rule: Plot3dErrorCode.COORDINATE_COUNT_MISMATCH.rule,
        severity: Plot3dErrorCode.COORDINATE_COUNT_MISMATCH.severity,
        message: Plot3dErrorCode.COORDINATE_COUNT_MISMATCH.message(b.index, "iblank", b.iblank.length, expected),
        blockIndex: b.index,
      });
    }

    // Check cell volumes and Jacobians if coordinates are well-formed and cells exist
    if (countValid && b.ni >= 2 && b.nj >= 2 && (grid.dimension === "2d" || b.nk >= 2)) {
      const metrics = computeBlockMetrics(b);
      for (const inv of metrics.invertedCells.slice(0, 10)) {
        diags.push({
          id: Plot3dErrorCode.NEGATIVE_JACOBIAN.stdCode,
          code: Plot3dErrorCode.NEGATIVE_JACOBIAN.code,
          rule: Plot3dErrorCode.NEGATIVE_JACOBIAN.rule,
          severity: Plot3dErrorCode.NEGATIVE_JACOBIAN.severity,
          message: Plot3dErrorCode.NEGATIVE_JACOBIAN.message(b.index, inv.i, inv.j, inv.k, inv.volume),
          blockIndex: b.index,
          cellIndex: [inv.i, inv.j, inv.k],
        });
      }
    }
  }

  return diags;
}

/**
 * Lints a PLOT3D conservative solution (`.q`), optionally cross-checking block structure
 * against a paired grid (`.xyz`).
 */
export function lintPlot3dSolution(
  solution: Plot3dSolution,
  grid?: Plot3dGrid,
  gamma: number = 1.4,
): Plot3dDiagnostic[] {
  const diags: Plot3dDiagnostic[] = [];

  if (grid && grid.blocks.length !== solution.blocks.length) {
    diags.push({
      id: Plot3dErrorCode.BLOCK_COUNT_MISMATCH.stdCode,
      code: Plot3dErrorCode.BLOCK_COUNT_MISMATCH.code,
      rule: Plot3dErrorCode.BLOCK_COUNT_MISMATCH.rule,
      severity: Plot3dErrorCode.BLOCK_COUNT_MISMATCH.severity,
      message: Plot3dErrorCode.BLOCK_COUNT_MISMATCH.message(
        `grid has ${grid.blocks.length} block(s), solution has ${solution.blocks.length} block(s)`,
      ),
    });
  }

  for (let bIdx = 0; bIdx < solution.blocks.length; bIdx++) {
    const b = solution.blocks[bIdx]!;

    if (b.ni <= 0 || b.nj <= 0 || b.nk <= 0) {
      diags.push({
        id: Plot3dErrorCode.NON_POSITIVE_BLOCK_DIMENSION.stdCode,
        code: Plot3dErrorCode.NON_POSITIVE_BLOCK_DIMENSION.code,
        rule: Plot3dErrorCode.NON_POSITIVE_BLOCK_DIMENSION.rule,
        severity: Plot3dErrorCode.NON_POSITIVE_BLOCK_DIMENSION.severity,
        message: Plot3dErrorCode.NON_POSITIVE_BLOCK_DIMENSION.message(b.index, b.ni, b.nj, b.nk),
        blockIndex: b.index,
      });
      continue;
    }

    if (grid && bIdx < grid.blocks.length) {
      const gb = grid.blocks[bIdx]!;
      if (gb.ni !== b.ni || gb.nj !== b.nj || gb.nk !== b.nk) {
        diags.push({
          id: Plot3dErrorCode.BLOCK_COUNT_MISMATCH.stdCode,
          code: Plot3dErrorCode.BLOCK_COUNT_MISMATCH.code,
          rule: Plot3dErrorCode.BLOCK_COUNT_MISMATCH.rule,
          severity: Plot3dErrorCode.BLOCK_COUNT_MISMATCH.severity,
          message: Plot3dErrorCode.BLOCK_COUNT_MISMATCH.message(
            `block ${b.index} grid dims (${gb.ni},${gb.nj},${gb.nk}) != solution dims (${b.ni},${b.nj},${b.nk})`,
          ),
          blockIndex: b.index,
        });
      }
    }

    const { fsmach, alpha, re } = b.conditions;
    if (!Number.isFinite(fsmach) || fsmach < 0 || fsmach > 30) {
      diags.push({
        id: Plot3dErrorCode.INVALID_MACH_NUMBER.stdCode,
        code: Plot3dErrorCode.INVALID_MACH_NUMBER.code,
        rule: Plot3dErrorCode.INVALID_MACH_NUMBER.rule,
        severity: Plot3dErrorCode.INVALID_MACH_NUMBER.severity,
        message: Plot3dErrorCode.INVALID_MACH_NUMBER.message(b.index, fsmach),
        blockIndex: b.index,
      });
    }
    if (!Number.isFinite(re) || re < 0) {
      diags.push({
        id: Plot3dErrorCode.INVALID_REYNOLDS_NUMBER.stdCode,
        code: Plot3dErrorCode.INVALID_REYNOLDS_NUMBER.code,
        rule: Plot3dErrorCode.INVALID_REYNOLDS_NUMBER.rule,
        severity: Plot3dErrorCode.INVALID_REYNOLDS_NUMBER.severity,
        message: Plot3dErrorCode.INVALID_REYNOLDS_NUMBER.message(b.index, re),
        blockIndex: b.index,
      });
    }
    if (!Number.isFinite(alpha) || alpha < -180 || alpha > 180) {
      diags.push({
        id: Plot3dErrorCode.INVALID_ALPHA_ANGLE.stdCode,
        code: Plot3dErrorCode.INVALID_ALPHA_ANGLE.code,
        rule: Plot3dErrorCode.INVALID_ALPHA_ANGLE.rule,
        severity: Plot3dErrorCode.INVALID_ALPHA_ANGLE.severity,
        message: Plot3dErrorCode.INVALID_ALPHA_ANGLE.message(b.index, alpha),
        blockIndex: b.index,
      });
    }

    const expected = b.ni * b.nj * b.nk;
    const fields: Array<[string, Float64Array]> = [
      ["rho", b.rho],
      ["rhou", b.rhou],
      ["rhov", b.rhov],
      ["rhow", b.rhow],
      ["energy", b.energy],
    ];

    let allSizesMatch = true;
    for (const [name, arr] of fields) {
      if (arr.length !== expected) {
        allSizesMatch = false;
        diags.push({
          id: Plot3dErrorCode.COORDINATE_COUNT_MISMATCH.stdCode,
          code: Plot3dErrorCode.COORDINATE_COUNT_MISMATCH.code,
          rule: Plot3dErrorCode.COORDINATE_COUNT_MISMATCH.rule,
          severity: Plot3dErrorCode.COORDINATE_COUNT_MISMATCH.severity,
          message: Plot3dErrorCode.COORDINATE_COUNT_MISMATCH.message(b.index, name, arr.length, expected),
          blockIndex: b.index,
        });
      } else {
        checkFiniteArray(arr, b.index, name, diags);
      }
    }

    if (allSizesMatch) {
      let reportedRho = 0;
      let reportedP = 0;
      for (let i = 0; i < expected; i++) {
        const rho = b.rho[i]!;
        if (rho <= 0) {
          if (reportedRho < 5) {
            diags.push({
              id: Plot3dErrorCode.NON_POSITIVE_DENSITY.stdCode,
              code: Plot3dErrorCode.NON_POSITIVE_DENSITY.code,
              rule: Plot3dErrorCode.NON_POSITIVE_DENSITY.rule,
              severity: Plot3dErrorCode.NON_POSITIVE_DENSITY.severity,
              message: Plot3dErrorCode.NON_POSITIVE_DENSITY.message(b.index, i, rho),
              blockIndex: b.index,
            });
            reportedRho++;
          }
          continue;
        }
        const prim = conservativeToPrimitive(
          {
            rho,
            rhou: b.rhou[i]!,
            rhov: b.rhov[i]!,
            rhow: b.rhow[i]!,
            energy: b.energy[i]!,
          },
          { gamma },
        );
        if (prim.pressure <= 0) {
          if (reportedP < 5) {
            diags.push({
              id: Plot3dErrorCode.NON_POSITIVE_PRESSURE.stdCode,
              code: Plot3dErrorCode.NON_POSITIVE_PRESSURE.code,
              rule: Plot3dErrorCode.NON_POSITIVE_PRESSURE.rule,
              severity: Plot3dErrorCode.NON_POSITIVE_PRESSURE.severity,
              message: Plot3dErrorCode.NON_POSITIVE_PRESSURE.message(b.index, i, prim.pressure),
              blockIndex: b.index,
            });
            reportedP++;
          }
        }
      }
    }
  }

  return diags;
}

/**
 * Lints a PLOT3D function file (`.f`), optionally cross-checking variable count against `.nam`.
 */
export function lintPlot3dFunction(func: Plot3dFunctionFile, nam?: Plot3dNamMetadata): Plot3dDiagnostic[] {
  const diags: Plot3dDiagnostic[] = [];
  for (const b of func.blocks) {
    if (b.ni <= 0 || b.nj <= 0 || b.nk <= 0) {
      diags.push({
        id: Plot3dErrorCode.NON_POSITIVE_BLOCK_DIMENSION.stdCode,
        code: Plot3dErrorCode.NON_POSITIVE_BLOCK_DIMENSION.code,
        rule: Plot3dErrorCode.NON_POSITIVE_BLOCK_DIMENSION.rule,
        severity: Plot3dErrorCode.NON_POSITIVE_BLOCK_DIMENSION.severity,
        message: Plot3dErrorCode.NON_POSITIVE_BLOCK_DIMENSION.message(b.index, b.ni, b.nj, b.nk),
        blockIndex: b.index,
      });
      continue;
    }
    const expected = b.ni * b.nj * b.nk;
    for (let v = 0; v < b.fields.length; v++) {
      const arr = b.fields[v]!;
      if (arr.length !== expected) {
        diags.push({
          id: Plot3dErrorCode.COORDINATE_COUNT_MISMATCH.stdCode,
          code: Plot3dErrorCode.COORDINATE_COUNT_MISMATCH.code,
          rule: Plot3dErrorCode.COORDINATE_COUNT_MISMATCH.rule,
          severity: Plot3dErrorCode.COORDINATE_COUNT_MISMATCH.severity,
          message: Plot3dErrorCode.COORDINATE_COUNT_MISMATCH.message(b.index, `f[${v}]`, arr.length, expected),
          blockIndex: b.index,
        });
      }
    }
    if (nam && nam.variableNames.length !== b.nVars) {
      diags.push({
        id: Plot3dErrorCode.SOLUTION_FUNCTION_MISMATCH.stdCode,
        code: Plot3dErrorCode.SOLUTION_FUNCTION_MISMATCH.code,
        rule: Plot3dErrorCode.SOLUTION_FUNCTION_MISMATCH.rule,
        severity: Plot3dErrorCode.SOLUTION_FUNCTION_MISMATCH.severity,
        message: Plot3dErrorCode.SOLUTION_FUNCTION_MISMATCH.message(b.index, b.nVars, nam.variableNames.length),
        blockIndex: b.index,
      });
    }
  }
  return diags;
}

/**
 * Lints a combined PLOT3D dataset (grid, solution, function, and/or nam metadata).
 */
export function lintPlot3dDataset(dataset: Plot3dDataset, gamma: number = 1.4): Plot3dDiagnostic[] {
  const diags: Plot3dDiagnostic[] = [];
  if (dataset.grid) {
    diags.push(...lintPlot3dGrid(dataset.grid));
  }
  if (dataset.solution) {
    diags.push(...lintPlot3dSolution(dataset.solution, dataset.grid, gamma));
  }
  if (dataset.func) {
    diags.push(...lintPlot3dFunction(dataset.func, dataset.nam));
  }
  return diags;
}

export { Plot3dErrorCode };
