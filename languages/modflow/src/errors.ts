// SPDX-License-Identifier: AGPL-3.0-or-later

export const ModflowErrorCode = {
  PARSE_ERROR: {
    code: 1001,
    rule: "modflow-parse-error",
    severity: "error" as const,
    message: (err: string) => `Syntax or structure error in MODFLOW deck: ${err}.`,
  },
  CELL_OUT_OF_BOUNDS: {
    code: 2001,
    rule: "modflow-cell-out-of-bounds",
    severity: "error" as const,
    message: (layer: number, row: number, col: number, maxL: number, maxR: number, maxC: number) =>
      `Grid cell (${layer}, ${row}, ${col}) is out of bounds for grid dimensions (${maxL}, ${maxR}, ${maxC}).`,
  },
  INVALID_CONDUCTIVITY: {
    code: 3001,
    rule: "modflow-invalid-conductivity",
    severity: "error" as const,
    message: (k: number) =>
      `Hydraulic conductivity K = ${k} is invalid. K must be strictly positive (K > 0).`,
  },
  INVALID_STORAGE: {
    code: 3002,
    rule: "modflow-invalid-storage",
    severity: "error" as const,
    message: (param: string, val: number) =>
      `Aquifer storage parameter ${param} = ${val} is invalid. Value must be non-negative.`,
  },
  RIVER_STAGE_BELOW_BOTM: {
    code: 4001,
    rule: "modflow-river-stage-below-bottom",
    severity: "error" as const,
    message: (stage: number, rbot: number) =>
      `River stage ${stage} m is lower than river bed bottom elevation ${rbot} m.`,
  },
  LAYER_ELEVATION_INVERSION: {
    code: 4002,
    rule: "modflow-layer-elevation-inversion",
    severity: "error" as const,
    message: (layer: number, top: number, botm: number) =>
      `Layer ${layer} has bottom elevation (${botm}) higher than or equal to its top elevation (${top}).`,
  },
};
