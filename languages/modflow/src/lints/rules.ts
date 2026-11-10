// SPDX-License-Identifier: AGPL-3.0-or-later

import { ModflowErrorCode } from "../errors.js";
import type { ModflowModel } from "../types.js";

export interface ModflowDiagnostic {
  code: number;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
}

export function lintModflow(model: ModflowModel): ModflowDiagnostic[] {
  const diags: ModflowDiagnostic[] = [];
  const { dis, npf, wells, rivers, chds } = model;
  const { nlay, nrow, ncol, top, botm } = dis;

  // 1. Hydraulic conductivity bounds
  if (npf.k <= 0.0) {
    diags.push({
      code: ModflowErrorCode.INVALID_CONDUCTIVITY.code,
      rule: ModflowErrorCode.INVALID_CONDUCTIVITY.rule,
      severity: ModflowErrorCode.INVALID_CONDUCTIVITY.severity,
      message: ModflowErrorCode.INVALID_CONDUCTIVITY.message(npf.k),
      line: 1,
    });
  }
  if (npf.k33 <= 0.0) {
    diags.push({
      code: ModflowErrorCode.INVALID_CONDUCTIVITY.code,
      rule: ModflowErrorCode.INVALID_CONDUCTIVITY.rule,
      severity: ModflowErrorCode.INVALID_CONDUCTIVITY.severity,
      message: ModflowErrorCode.INVALID_CONDUCTIVITY.message(npf.k33),
      line: 1,
    });
  }

  // 2. Storage parameters
  if (npf.ss < 0.0) {
    diags.push({
      code: ModflowErrorCode.INVALID_STORAGE.code,
      rule: ModflowErrorCode.INVALID_STORAGE.rule,
      severity: ModflowErrorCode.INVALID_STORAGE.severity,
      message: ModflowErrorCode.INVALID_STORAGE.message("SS", npf.ss),
      line: 1,
    });
  }
  if (npf.sy < 0.0 || npf.sy > 1.0) {
    diags.push({
      code: ModflowErrorCode.INVALID_STORAGE.code,
      rule: ModflowErrorCode.INVALID_STORAGE.rule,
      severity: ModflowErrorCode.INVALID_STORAGE.severity,
      message: ModflowErrorCode.INVALID_STORAGE.message("SY", npf.sy),
      line: 1,
    });
  }

  // 3. Layer elevation inversions
  for (let l = 1; l <= nlay; l++) {
    const zTop = l === 1 ? top : (botm[l - 2] ?? top);
    const zBot = botm[l - 1] ?? zTop;
    if (zBot >= zTop) {
      diags.push({
        code: ModflowErrorCode.LAYER_ELEVATION_INVERSION.code,
        rule: ModflowErrorCode.LAYER_ELEVATION_INVERSION.rule,
        severity: ModflowErrorCode.LAYER_ELEVATION_INVERSION.severity,
        message: ModflowErrorCode.LAYER_ELEVATION_INVERSION.message(l, zTop, zBot),
        line: 1,
      });
    }
  }

  // 4. Well cell bounds
  for (const w of wells) {
    const { layer, row, col } = w.cell;
    if (layer < 1 || layer > nlay || row < 1 || row > nrow || col < 1 || col > ncol) {
      diags.push({
        code: ModflowErrorCode.CELL_OUT_OF_BOUNDS.code,
        rule: ModflowErrorCode.CELL_OUT_OF_BOUNDS.rule,
        severity: ModflowErrorCode.CELL_OUT_OF_BOUNDS.severity,
        message: ModflowErrorCode.CELL_OUT_OF_BOUNDS.message(layer, row, col, nlay, nrow, ncol),
        line: w.line ?? 1,
      });
    }
  }

  // 5. River stage vs botm and cell bounds
  for (const r of rivers) {
    const { layer, row, col } = r.cell;
    if (layer < 1 || layer > nlay || row < 1 || row > nrow || col < 1 || col > ncol) {
      diags.push({
        code: ModflowErrorCode.CELL_OUT_OF_BOUNDS.code,
        rule: ModflowErrorCode.CELL_OUT_OF_BOUNDS.rule,
        severity: ModflowErrorCode.CELL_OUT_OF_BOUNDS.severity,
        message: ModflowErrorCode.CELL_OUT_OF_BOUNDS.message(layer, row, col, nlay, nrow, ncol),
        line: r.line ?? 1,
      });
    }
    if (r.stage < r.rbot) {
      diags.push({
        code: ModflowErrorCode.RIVER_STAGE_BELOW_BOTM.code,
        rule: ModflowErrorCode.RIVER_STAGE_BELOW_BOTM.rule,
        severity: ModflowErrorCode.RIVER_STAGE_BELOW_BOTM.severity,
        message: ModflowErrorCode.RIVER_STAGE_BELOW_BOTM.message(r.stage, r.rbot),
        line: r.line ?? 1,
      });
    }
  }

  // 6. CHD cell bounds
  for (const chd of chds) {
    const { layer, row, col } = chd.cell;
    if (layer < 1 || layer > nlay || row < 1 || row > nrow || col < 1 || col > ncol) {
      diags.push({
        code: ModflowErrorCode.CELL_OUT_OF_BOUNDS.code,
        rule: ModflowErrorCode.CELL_OUT_OF_BOUNDS.rule,
        severity: ModflowErrorCode.CELL_OUT_OF_BOUNDS.severity,
        message: ModflowErrorCode.CELL_OUT_OF_BOUNDS.message(layer, row, col, nlay, nrow, ncol),
        line: chd.line ?? 1,
      });
    }
  }

  return diags;
}
