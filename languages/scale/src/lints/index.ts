// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/scale — Static Linter & Pre-flight Nuclear Criticality / Depletion Validator.
 *
 * Implements diagnostic rules SCL1001–SCL5006.
 */

import { ScaleErrorCode, type ScaleDiagnostic } from "../errors.js";
import { KNOWN_SCALE_SEQUENCES, type ScaleDeck } from "../types.js";

/**
 * Runs all static semantic & physics checks on a parsed `ScaleDeck`.
 */
export function lintScale(deck: ScaleDeck): ScaleDiagnostic[] {
  const diagnostics: ScaleDiagnostic[] = [];

  // SCL1001: Syntax errors
  for (const err of deck.syntaxErrors) {
    diagnostics.push({
      code: ScaleErrorCode.SYNTAX_ERROR.code,
      rule: ScaleErrorCode.SYNTAX_ERROR.rule,
      severity: ScaleErrorCode.SYNTAX_ERROR.severity,
      message: ScaleErrorCode.SYNTAX_ERROR.message(err.message),
      range: err.range,
    });
  }

  // SCL1002: Unclosed read ... end blocks
  for (const blk of deck.readBlocks) {
    if (!blk.closed) {
      diagnostics.push({
        code: ScaleErrorCode.UNCLOSED_READ_BLOCK.code,
        rule: ScaleErrorCode.UNCLOSED_READ_BLOCK.rule,
        severity: ScaleErrorCode.UNCLOSED_READ_BLOCK.severity,
        message: ScaleErrorCode.UNCLOSED_READ_BLOCK.message(blk.kind),
        range: blk.range,
      });
    }
  }

  // SCL2001: Unknown SCALE sequence
  if (deck.sequence && !KNOWN_SCALE_SEQUENCES.has(deck.sequence.toLowerCase())) {
    diagnostics.push({
      code: ScaleErrorCode.UNKNOWN_SEQUENCE.code,
      rule: ScaleErrorCode.UNKNOWN_SEQUENCE.rule,
      severity: ScaleErrorCode.UNKNOWN_SEQUENCE.severity,
      message: ScaleErrorCode.UNKNOWN_SEQUENCE.message(deck.sequence),
      range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: deck.sequence.length + 1 },
    });
  }

  // Compositions: SCL2002 (duplicate mixture), SCL4001 (density), SCL4002 (temp), SCL4003 (enrichment)
  const definedMixtures = new Set<number>();
  for (const comp of deck.compositions) {
    if (definedMixtures.has(comp.mixtureId)) {
      diagnostics.push({
        code: ScaleErrorCode.DUPLICATE_MIXTURE_ID.code,
        rule: ScaleErrorCode.DUPLICATE_MIXTURE_ID.rule,
        severity: ScaleErrorCode.DUPLICATE_MIXTURE_ID.severity,
        message: ScaleErrorCode.DUPLICATE_MIXTURE_ID.message(comp.mixtureId),
        range: comp.range,
      });
    } else {
      definedMixtures.add(comp.mixtureId);
    }

    if (comp.density !== undefined && comp.density <= 0) {
      diagnostics.push({
        code: ScaleErrorCode.NEGATIVE_DENSITY.code,
        rule: ScaleErrorCode.NEGATIVE_DENSITY.rule,
        severity: ScaleErrorCode.NEGATIVE_DENSITY.severity,
        message: ScaleErrorCode.NEGATIVE_DENSITY.message(comp.materialName, comp.mixtureId, comp.density),
        range: comp.range,
      });
    }

    if (comp.temperature !== undefined && comp.temperature <= 0) {
      diagnostics.push({
        code: ScaleErrorCode.NEGATIVE_TEMPERATURE.code,
        rule: ScaleErrorCode.NEGATIVE_TEMPERATURE.rule,
        severity: ScaleErrorCode.NEGATIVE_TEMPERATURE.severity,
        message: ScaleErrorCode.NEGATIVE_TEMPERATURE.message(comp.materialName, comp.mixtureId, comp.temperature),
        range: comp.range,
      });
    }

    if (comp.enrichment !== undefined && (comp.enrichment < 0 || comp.enrichment > 100)) {
      diagnostics.push({
        code: ScaleErrorCode.INVALID_ENRICHMENT.code,
        rule: ScaleErrorCode.INVALID_ENRICHMENT.rule,
        severity: ScaleErrorCode.INVALID_ENRICHMENT.severity,
        message: ScaleErrorCode.INVALID_ENRICHMENT.message(comp.materialName, comp.mixtureId, comp.enrichment),
        range: comp.range,
      });
    }
  }

  // SCL2003: Duplicate KENO unit IDs
  for (const dup of deck.duplicateUnitIds) {
    diagnostics.push({
      code: ScaleErrorCode.DUPLICATE_UNIT_ID.code,
      rule: ScaleErrorCode.DUPLICATE_UNIT_ID.rule,
      severity: ScaleErrorCode.DUPLICATE_UNIT_ID.severity,
      message: ScaleErrorCode.DUPLICATE_UNIT_ID.message(dup.id),
      range: dup.range,
    });
  }

  // SCL2004: Duplicate KENO array IDs
  for (const dup of deck.duplicateArrayIds) {
    diagnostics.push({
      code: ScaleErrorCode.DUPLICATE_ARRAY_ID.code,
      rule: ScaleErrorCode.DUPLICATE_ARRAY_ID.rule,
      severity: ScaleErrorCode.DUPLICATE_ARRAY_ID.severity,
      message: ScaleErrorCode.DUPLICATE_ARRAY_ID.message(dup.id),
      range: dup.range,
    });
  }

  // KENO geometry checks
  if (deck.units.size > 0) {
    let hasGlobal = false;
    for (const unit of deck.units.values()) {
      if (unit.isGlobal) hasGlobal = true;

      // SCL5004: Geometry body dimensions
      for (const body of unit.bodies) {
        if (
          (body.kind === "cylinder" || body.kind === "sphere" || body.kind === "hexprism") &&
          body.radius !== undefined
        ) {
          if (body.radius <= 0) {
            diagnostics.push({
              code: ScaleErrorCode.INVALID_GEOMETRY_DIMENSION.code,
              rule: ScaleErrorCode.INVALID_GEOMETRY_DIMENSION.rule,
              severity: ScaleErrorCode.INVALID_GEOMETRY_DIMENSION.severity,
              message: ScaleErrorCode.INVALID_GEOMETRY_DIMENSION.message(
                unit.id,
                body.kind,
                body.id,
                `radius (${body.radius}) must be strictly positive`,
              ),
              range: body.range,
            });
          }
        }
        if (
          (body.kind === "cylinder" || body.kind === "hexprism" || body.kind === "cuboid") &&
          body.zPlus !== undefined &&
          body.zMinus !== undefined &&
          body.zPlus <= body.zMinus
        ) {
          diagnostics.push({
            code: ScaleErrorCode.INVALID_GEOMETRY_DIMENSION.code,
            rule: ScaleErrorCode.INVALID_GEOMETRY_DIMENSION.rule,
            severity: ScaleErrorCode.INVALID_GEOMETRY_DIMENSION.severity,
            message: ScaleErrorCode.INVALID_GEOMETRY_DIMENSION.message(
              unit.id,
              body.kind,
              body.id,
              `z+ (${body.zPlus}) must exceed z- (${body.zMinus})`,
            ),
            range: body.range,
          });
        }
        if (body.kind === "cuboid") {
          if (body.xPlus !== undefined && body.xMinus !== undefined && body.xPlus <= body.xMinus) {
            diagnostics.push({
              code: ScaleErrorCode.INVALID_GEOMETRY_DIMENSION.code,
              rule: ScaleErrorCode.INVALID_GEOMETRY_DIMENSION.rule,
              severity: ScaleErrorCode.INVALID_GEOMETRY_DIMENSION.severity,
              message: ScaleErrorCode.INVALID_GEOMETRY_DIMENSION.message(
                unit.id,
                body.kind,
                body.id,
                `x+ (${body.xPlus}) must exceed x- (${body.xMinus})`,
              ),
              range: body.range,
            });
          }
          if (body.yPlus !== undefined && body.yMinus !== undefined && body.yPlus <= body.yMinus) {
            diagnostics.push({
              code: ScaleErrorCode.INVALID_GEOMETRY_DIMENSION.code,
              rule: ScaleErrorCode.INVALID_GEOMETRY_DIMENSION.rule,
              severity: ScaleErrorCode.INVALID_GEOMETRY_DIMENSION.severity,
              message: ScaleErrorCode.INVALID_GEOMETRY_DIMENSION.message(
                unit.id,
                body.kind,
                body.id,
                `y+ (${body.yPlus}) must exceed y- (${body.yMinus})`,
              ),
              range: body.range,
            });
          }
        }
      }

      // SCL3001: Undefined mixture in media (mixture 0 is KENO void)
      for (const med of unit.media) {
        if (med.mixtureId !== 0 && !definedMixtures.has(med.mixtureId)) {
          diagnostics.push({
            code: ScaleErrorCode.UNDEFINED_MIXTURE.code,
            rule: ScaleErrorCode.UNDEFINED_MIXTURE.rule,
            severity: ScaleErrorCode.UNDEFINED_MIXTURE.severity,
            message: ScaleErrorCode.UNDEFINED_MIXTURE.message(med.mixtureId, unit.id),
            range: med.range,
          });
        }
      }

      // SCL3002: Undefined unit in hole
      for (const hole of unit.holes) {
        if (!deck.units.has(hole.unitId)) {
          diagnostics.push({
            code: ScaleErrorCode.UNDEFINED_UNIT.code,
            rule: ScaleErrorCode.UNDEFINED_UNIT.rule,
            severity: ScaleErrorCode.UNDEFINED_UNIT.severity,
            message: ScaleErrorCode.UNDEFINED_UNIT.message(hole.unitId, `hole in unit '${unit.id}'`),
            range: hole.range,
          });
        }
      }
    }

    // SCL3003: Missing global unit
    if (!hasGlobal) {
      const firstUnit = deck.units.values().next().value;
      diagnostics.push({
        code: ScaleErrorCode.MISSING_GLOBAL_UNIT.code,
        rule: ScaleErrorCode.MISSING_GLOBAL_UNIT.rule,
        severity: ScaleErrorCode.MISSING_GLOBAL_UNIT.severity,
        message: ScaleErrorCode.MISSING_GLOBAL_UNIT.message(),
        range: firstUnit?.range,
      });
    }
  }

  // KENO array checks: SCL3002 (undefined unit in fill), SCL5005 (fill count mismatch)
  for (const arr of deck.arrays.values()) {
    const expected = arr.nux * arr.nuy * arr.nuz;
    if (arr.fill.length > 0 && arr.fill.length !== expected) {
      diagnostics.push({
        code: ScaleErrorCode.ARRAY_FILL_MISMATCH.code,
        rule: ScaleErrorCode.ARRAY_FILL_MISMATCH.rule,
        severity: ScaleErrorCode.ARRAY_FILL_MISMATCH.severity,
        message: ScaleErrorCode.ARRAY_FILL_MISMATCH.message(arr.id, expected, arr.fill.length),
        range: arr.range,
      });
    }
    const checkedUnits = new Set<number>();
    for (const uId of arr.fill) {
      if (!checkedUnits.has(uId) && !deck.units.has(uId)) {
        checkedUnits.add(uId);
        diagnostics.push({
          code: ScaleErrorCode.UNDEFINED_UNIT.code,
          rule: ScaleErrorCode.UNDEFINED_UNIT.rule,
          severity: ScaleErrorCode.UNDEFINED_UNIT.severity,
          message: ScaleErrorCode.UNDEFINED_UNIT.message(uId, `array '${arr.id}'`),
          range: arr.range,
        });
      }
    }
  }

  // ORIGEN case checks: SCL5001, SCL5002, SCL5003, SCL5006
  for (const oc of deck.origenCases) {
    if ((!oc.time || oc.time.values.length === 0) && oc.nuclides.length === 0) {
      diagnostics.push({
        code: ScaleErrorCode.EMPTY_ORIGEN_CASE.code,
        rule: ScaleErrorCode.EMPTY_ORIGEN_CASE.rule,
        severity: ScaleErrorCode.EMPTY_ORIGEN_CASE.severity,
        message: ScaleErrorCode.EMPTY_ORIGEN_CASE.message(oc.id),
        range: oc.range,
      });
    }

    if (oc.time) {
      let prev = -Infinity;
      for (const t of oc.time.values) {
        if (t <= 0) {
          diagnostics.push({
            code: ScaleErrorCode.INVALID_ORIGEN_TIME.code,
            rule: ScaleErrorCode.INVALID_ORIGEN_TIME.rule,
            severity: ScaleErrorCode.INVALID_ORIGEN_TIME.severity,
            message: ScaleErrorCode.INVALID_ORIGEN_TIME.message(oc.id, `time step ${t} must be strictly positive`),
            range: oc.time.range,
          });
        } else if (t <= prev) {
          diagnostics.push({
            code: ScaleErrorCode.INVALID_ORIGEN_TIME.code,
            rule: ScaleErrorCode.INVALID_ORIGEN_TIME.rule,
            severity: ScaleErrorCode.INVALID_ORIGEN_TIME.severity,
            message: ScaleErrorCode.INVALID_ORIGEN_TIME.message(
              oc.id,
              `time steps must be strictly increasing (${t} <= ${prev})`,
            ),
            range: oc.time.range,
          });
        }
        prev = t;
      }
    }

    for (const p of oc.power) {
      if (p < 0) {
        diagnostics.push({
          code: ScaleErrorCode.INVALID_ORIGEN_POWER.code,
          rule: ScaleErrorCode.INVALID_ORIGEN_POWER.rule,
          severity: ScaleErrorCode.INVALID_ORIGEN_POWER.severity,
          message: ScaleErrorCode.INVALID_ORIGEN_POWER.message(oc.id, "power", p),
          range: oc.range,
        });
      }
    }

    for (const fl of oc.flux) {
      if (fl < 0) {
        diagnostics.push({
          code: ScaleErrorCode.INVALID_ORIGEN_POWER.code,
          rule: ScaleErrorCode.INVALID_ORIGEN_POWER.rule,
          severity: ScaleErrorCode.INVALID_ORIGEN_POWER.severity,
          message: ScaleErrorCode.INVALID_ORIGEN_POWER.message(oc.id, "flux", fl),
          range: oc.range,
        });
      }
    }

    for (const nuc of oc.nuclides) {
      if (nuc.amount < 0) {
        diagnostics.push({
          code: ScaleErrorCode.NEGATIVE_ORIGEN_NUCLIDE.code,
          rule: ScaleErrorCode.NEGATIVE_ORIGEN_NUCLIDE.rule,
          severity: ScaleErrorCode.NEGATIVE_ORIGEN_NUCLIDE.severity,
          message: ScaleErrorCode.NEGATIVE_ORIGEN_NUCLIDE.message(oc.id, nuc.nuclide, nuc.amount),
          range: nuc.range,
        });
      }
    }
  }

  return diagnostics;
}
