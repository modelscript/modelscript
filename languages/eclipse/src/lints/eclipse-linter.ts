// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/eclipse — Pre-flight Reservoir Diagnostics Linter.
 *
 * Implements OpenModelica-style diagnostic codes (M8701 - M8710) for ECLIPSE simulation decks.
 */

import { type DiagnosticItem, EclipseErrorCode } from "../errors.js";
import type { EclipseDeck } from "../types.js";

export function lintEclipse(deck: EclipseDeck): DiagnosticItem[] {
  const diagnostics: DiagnosticItem[] = [];

  // M8701: Missing reservoir phases
  if (!deck.phases.oil && !deck.phases.water && !deck.phases.gas) {
    diagnostics.push({
      code: EclipseErrorCode.MISSING_RESERVOIR_PHASES.code,
      rule: EclipseErrorCode.MISSING_RESERVOIR_PHASES.rule,
      severity: EclipseErrorCode.MISSING_RESERVOIR_PHASES.severity,
      message: EclipseErrorCode.MISSING_RESERVOIR_PHASES.message(),
    });
  }

  // M8702: Invalid grid dimensions
  const dims = deck.dimensions;
  if (dims.nx <= 0 || dims.ny <= 0 || dims.nz <= 0) {
    diagnostics.push({
      code: EclipseErrorCode.INVALID_GRID_DIMENSIONS.code,
      rule: EclipseErrorCode.INVALID_GRID_DIMENSIONS.rule,
      severity: EclipseErrorCode.INVALID_GRID_DIMENSIONS.severity,
      message: EclipseErrorCode.INVALID_GRID_DIMENSIONS.message(dims.nx, dims.ny, dims.nz),
    });
  }

  // M8703: Porosity validation
  const grid = deck.grid;
  if (grid.poro <= 0 || grid.poro >= 1.0) {
    diagnostics.push({
      code: EclipseErrorCode.POROSITY_OUT_OF_RANGE.code,
      rule: EclipseErrorCode.POROSITY_OUT_OF_RANGE.rule,
      severity: EclipseErrorCode.POROSITY_OUT_OF_RANGE.severity,
      message: EclipseErrorCode.POROSITY_OUT_OF_RANGE.message(grid.poro),
      range: grid.range,
    });
  }

  // M8704: Permeability validation
  if (grid.permX <= 0) {
    diagnostics.push({
      code: EclipseErrorCode.NEGATIVE_PERMEABILITY.code,
      rule: EclipseErrorCode.NEGATIVE_PERMEABILITY.rule,
      severity: EclipseErrorCode.NEGATIVE_PERMEABILITY.severity,
      message: EclipseErrorCode.NEGATIVE_PERMEABILITY.message("permX", grid.permX),
      range: grid.range,
    });
  }
  if (grid.permY <= 0) {
    diagnostics.push({
      code: EclipseErrorCode.NEGATIVE_PERMEABILITY.code,
      rule: EclipseErrorCode.NEGATIVE_PERMEABILITY.rule,
      severity: EclipseErrorCode.NEGATIVE_PERMEABILITY.severity,
      message: EclipseErrorCode.NEGATIVE_PERMEABILITY.message("permY", grid.permY),
      range: grid.range,
    });
  }
  if (grid.permZ <= 0) {
    diagnostics.push({
      code: EclipseErrorCode.NEGATIVE_PERMEABILITY.code,
      rule: EclipseErrorCode.NEGATIVE_PERMEABILITY.rule,
      severity: EclipseErrorCode.NEGATIVE_PERMEABILITY.severity,
      message: EclipseErrorCode.NEGATIVE_PERMEABILITY.message("permZ", grid.permZ),
      range: grid.range,
    });
  }

  // M8705: Non-monotonic PVT tables
  if (deck.props.pvdo.length > 1) {
    for (let i = 1; i < deck.props.pvdo.length; i++) {
      const prevRow = deck.props.pvdo[i - 1];
      const curRow = deck.props.pvdo[i];
      if (!prevRow || !curRow) continue;
      const prevP = prevRow.pressure;
      const curP = curRow.pressure;
      if (curP <= prevP) {
        diagnostics.push({
          code: EclipseErrorCode.NON_MONOTONIC_PVT_TABLE.code,
          rule: EclipseErrorCode.NON_MONOTONIC_PVT_TABLE.rule,
          severity: EclipseErrorCode.NON_MONOTONIC_PVT_TABLE.severity,
          message: EclipseErrorCode.NON_MONOTONIC_PVT_TABLE.message("PVDO", prevP, curP),
          range: deck.props.range,
        });
      }
    }
  }

  if (deck.props.pvdg.length > 1) {
    for (let i = 1; i < deck.props.pvdg.length; i++) {
      const prevRow = deck.props.pvdg[i - 1];
      const curRow = deck.props.pvdg[i];
      if (!prevRow || !curRow) continue;
      const prevP = prevRow.pressure;
      const curP = curRow.pressure;
      if (curP <= prevP) {
        diagnostics.push({
          code: EclipseErrorCode.NON_MONOTONIC_PVT_TABLE.code,
          rule: EclipseErrorCode.NON_MONOTONIC_PVT_TABLE.rule,
          severity: EclipseErrorCode.NON_MONOTONIC_PVT_TABLE.severity,
          message: EclipseErrorCode.NON_MONOTONIC_PVT_TABLE.message("PVDG", prevP, curP),
          range: deck.props.range,
        });
      }
    }
  }

  // M8706: Dangling well completion (out of bounds)
  for (const well of deck.wells.values()) {
    for (const c of well.completions) {
      if (
        c.i < 1 ||
        c.i > dims.nx ||
        c.j < 1 ||
        c.j > dims.ny ||
        c.k1 < 1 ||
        c.k1 > dims.nz ||
        c.k2 < 1 ||
        c.k2 > dims.nz
      ) {
        diagnostics.push({
          code: EclipseErrorCode.DANGLING_WELL_COMPLETION.code,
          rule: EclipseErrorCode.DANGLING_WELL_COMPLETION.rule,
          severity: EclipseErrorCode.DANGLING_WELL_COMPLETION.severity,
          message: EclipseErrorCode.DANGLING_WELL_COMPLETION.message(
            well.name,
            c.i,
            c.j,
            c.k1,
            dims.nx,
            dims.ny,
            dims.nz,
          ),
          range: c.range,
        });
      }
    }
  }

  // M8707: Non-monotonic saturation tables
  if (deck.props.swof.length > 1) {
    for (let i = 1; i < deck.props.swof.length; i++) {
      const prevRow = deck.props.swof[i - 1];
      const curRow = deck.props.swof[i];
      if (!prevRow || !curRow) continue;
      const prev = prevRow.saturation;
      const cur = curRow.saturation;
      if (cur <= prev) {
        diagnostics.push({
          code: EclipseErrorCode.NON_MONOTONIC_SATURATION_TABLE.code,
          rule: EclipseErrorCode.NON_MONOTONIC_SATURATION_TABLE.rule,
          severity: EclipseErrorCode.NON_MONOTONIC_SATURATION_TABLE.severity,
          message: EclipseErrorCode.NON_MONOTONIC_SATURATION_TABLE.message("SWOF", prev, cur),
          range: deck.props.range,
        });
      }
    }
  }

  // M8709: Invalid well control target
  for (const well of deck.wells.values()) {
    if (well.productionControl && well.productionControl.oilRate < 0) {
      diagnostics.push({
        code: EclipseErrorCode.INVALID_WELL_CONTROL_TARGET.code,
        rule: EclipseErrorCode.INVALID_WELL_CONTROL_TARGET.rule,
        severity: EclipseErrorCode.INVALID_WELL_CONTROL_TARGET.severity,
        message: EclipseErrorCode.INVALID_WELL_CONTROL_TARGET.message(
          well.name,
          well.productionControl.controlMode,
          well.productionControl.oilRate,
        ),
      });
    }
  }

  // M8710: Formation volume factors
  if (deck.props.pvtw && deck.props.pvtw.bw <= 0) {
    diagnostics.push({
      code: EclipseErrorCode.NEGATIVE_FORMATION_VOLUME_FACTOR.code,
      rule: EclipseErrorCode.NEGATIVE_FORMATION_VOLUME_FACTOR.rule,
      severity: EclipseErrorCode.NEGATIVE_FORMATION_VOLUME_FACTOR.severity,
      message: EclipseErrorCode.NEGATIVE_FORMATION_VOLUME_FACTOR.message("water", deck.props.pvtw.bw),
      range: deck.props.range,
    });
  }

  return diagnostics;
}
