// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SimaModel } from "../types.js";
import { SimaErrorCode, type SimaDiagnostic } from "./error-codes.js";

export { SimaErrorCode, type SimaDiagnostic };

/**
 * Pre-flight static marine linter for SIMO/RIFLEX and SIMA models.
 * Evaluates hydrostatic stability, mooring geometry, numerical stability,
 * and physical stiffness bounds before simulation.
 */
export function lintSimaProject(model: SimaModel): SimaDiagnostic[] {
  const diagnostics: SimaDiagnostic[] = [];
  const lineIds = new Set<string>();

  // Check seabed friction
  if (model.environment.seabedFriction < 0 || model.environment.seabedFriction > 2.0) {
    diagnostics.push({
      code: SimaErrorCode.UNPHYSICAL_SEABED_FRICTION.code,
      id: SimaErrorCode.UNPHYSICAL_SEABED_FRICTION.id,
      rule: SimaErrorCode.UNPHYSICAL_SEABED_FRICTION.rule,
      severity: SimaErrorCode.UNPHYSICAL_SEABED_FRICTION.severity,
      message: SimaErrorCode.UNPHYSICAL_SEABED_FRICTION.message(model.environment.seabedFriction),
    });
  }

  // Vessel checks
  for (const vessel of model.vessels) {
    // M7001: Negative metacentric height
    if (vessel.gmTransverse < 0) {
      diagnostics.push({
        code: SimaErrorCode.NEGATIVE_METACENTRIC_HEIGHT.code,
        id: SimaErrorCode.NEGATIVE_METACENTRIC_HEIGHT.id,
        rule: SimaErrorCode.NEGATIVE_METACENTRIC_HEIGHT.rule,
        severity: SimaErrorCode.NEGATIVE_METACENTRIC_HEIGHT.severity,
        message: SimaErrorCode.NEGATIVE_METACENTRIC_HEIGHT.message(vessel.name, "transverse", vessel.gmTransverse),
        target: vessel.id,
      });
    }
    if (vessel.gmLongitudinal < 0) {
      diagnostics.push({
        code: SimaErrorCode.NEGATIVE_METACENTRIC_HEIGHT.code,
        id: SimaErrorCode.NEGATIVE_METACENTRIC_HEIGHT.id,
        rule: SimaErrorCode.NEGATIVE_METACENTRIC_HEIGHT.rule,
        severity: SimaErrorCode.NEGATIVE_METACENTRIC_HEIGHT.severity,
        message: SimaErrorCode.NEGATIVE_METACENTRIC_HEIGHT.message(vessel.name, "longitudinal", vessel.gmLongitudinal),
        target: vessel.id,
      });
    }

    // M7008: Missing hydrostatic restoring matrix
    const cMat = vessel.hydrostaticMatrix;
    const hasHeaveRestoring = cMat && cMat[2] && cMat[2][2] !== undefined && cMat[2][2] > 0;
    const hasRollRestoring = cMat && cMat[3] && cMat[3][3] !== undefined && cMat[3][3] > 0;
    const hasPitchRestoring = cMat && cMat[4] && cMat[4][4] !== undefined && cMat[4][4] > 0;
    if (!hasHeaveRestoring && !hasRollRestoring && !hasPitchRestoring) {
      diagnostics.push({
        code: SimaErrorCode.MISSING_HYDROSTATIC_MATRIX.code,
        id: SimaErrorCode.MISSING_HYDROSTATIC_MATRIX.id,
        rule: SimaErrorCode.MISSING_HYDROSTATIC_MATRIX.rule,
        severity: SimaErrorCode.MISSING_HYDROSTATIC_MATRIX.severity,
        message: SimaErrorCode.MISSING_HYDROSTATIC_MATRIX.message(vessel.name),
        target: vessel.id,
      });
    }

    // M7013: Mass matrix asymmetry
    if (vessel.massMatrix && vessel.massMatrix.length === 6) {
      for (let r = 0; r < 6; r++) {
        for (let c = r + 1; c < 6; c++) {
          const val1 = vessel.massMatrix[r]?.[c] ?? 0;
          const val2 = vessel.massMatrix[c]?.[r] ?? 0;
          const diff = Math.abs(val1 - val2);
          const maxVal = Math.max(Math.abs(val1), Math.abs(val2), 1.0);
          if (diff / maxVal > 1e-3) {
            diagnostics.push({
              code: SimaErrorCode.MASS_MATRIX_ASYMMETRIC.code,
              id: SimaErrorCode.MASS_MATRIX_ASYMMETRIC.id,
              rule: SimaErrorCode.MASS_MATRIX_ASYMMETRIC.rule,
              severity: SimaErrorCode.MASS_MATRIX_ASYMMETRIC.severity,
              message: SimaErrorCode.MASS_MATRIX_ASYMMETRIC.message(vessel.name, r + 1, c + 1),
              target: vessel.id,
            });
            break;
          }
        }
      }
    }

    // M7005: Wave peak period outside RAO table
    if (vessel.hydrodynamics && vessel.hydrodynamics.frequencies.length > 0) {
      const tp = model.environment.wave.tp;
      const omega = (2 * Math.PI) / tp;
      const freqs = vessel.hydrodynamics.frequencies;
      const minOmega = Math.min(...freqs);
      const maxOmega = Math.max(...freqs);
      if (omega < minOmega * 0.9 || omega > maxOmega * 1.1) {
        diagnostics.push({
          code: SimaErrorCode.RAO_FREQUENCY_EXTRAPOLATION.code,
          id: SimaErrorCode.RAO_FREQUENCY_EXTRAPOLATION.id,
          rule: SimaErrorCode.RAO_FREQUENCY_EXTRAPOLATION.rule,
          severity: SimaErrorCode.RAO_FREQUENCY_EXTRAPOLATION.severity,
          message: SimaErrorCode.RAO_FREQUENCY_EXTRAPOLATION.message(omega, minOmega, maxOmega),
          target: vessel.id,
        });
      }
    }
  }

  // Collect all valid fairlead IDs across vessels
  const validFairleads = new Set<string>();
  for (const v of model.vessels) {
    for (const fl of v.fairleads) {
      validFairleads.add(fl.id);
    }
  }

  // Line and segment checks
  for (const line of model.lines) {
    // M7009: Duplicate line identifier
    if (lineIds.has(line.id)) {
      diagnostics.push({
        code: SimaErrorCode.DUPLICATE_LINE_IDENTIFIER.code,
        id: SimaErrorCode.DUPLICATE_LINE_IDENTIFIER.id,
        rule: SimaErrorCode.DUPLICATE_LINE_IDENTIFIER.rule,
        severity: SimaErrorCode.DUPLICATE_LINE_IDENTIFIER.severity,
        message: SimaErrorCode.DUPLICATE_LINE_IDENTIFIER.message(line.id),
        target: line.id,
      });
    }
    lineIds.add(line.id);

    // M7004: Unconnected attachment node
    if (validFairleads.size > 0 && !validFairleads.has(line.fairleadId)) {
      diagnostics.push({
        code: SimaErrorCode.UNCONNECTED_ATTACHMENT_NODE.code,
        id: SimaErrorCode.UNCONNECTED_ATTACHMENT_NODE.id,
        rule: SimaErrorCode.UNCONNECTED_ATTACHMENT_NODE.rule,
        severity: SimaErrorCode.UNCONNECTED_ATTACHMENT_NODE.severity,
        message: SimaErrorCode.UNCONNECTED_ATTACHMENT_NODE.message(line.id, line.fairleadId),
        target: line.id,
      });
    }

    // M7002: Line length underflow
    if (line.totalLength > 0 && line.totalLength < model.environment.waterDepth) {
      diagnostics.push({
        code: SimaErrorCode.LINE_LENGTH_UNDERFLOW.code,
        id: SimaErrorCode.LINE_LENGTH_UNDERFLOW.id,
        rule: SimaErrorCode.LINE_LENGTH_UNDERFLOW.rule,
        severity: SimaErrorCode.LINE_LENGTH_UNDERFLOW.severity,
        message: SimaErrorCode.LINE_LENGTH_UNDERFLOW.message(line.id, line.totalLength, model.environment.waterDepth),
        target: line.id,
      });
    }

    // Segment checks
    for (const seg of line.segments) {
      // M7006: Non-physical stiffness
      if (seg.axialStiffnessEA <= 0) {
        diagnostics.push({
          code: SimaErrorCode.INVALID_STIFFNESS_HIERARCHY.code,
          id: SimaErrorCode.INVALID_STIFFNESS_HIERARCHY.id,
          rule: SimaErrorCode.INVALID_STIFFNESS_HIERARCHY.rule,
          severity: SimaErrorCode.INVALID_STIFFNESS_HIERARCHY.severity,
          message: SimaErrorCode.INVALID_STIFFNESS_HIERARCHY.message(seg.name, "EA", seg.axialStiffnessEA),
          target: seg.id,
        });
      }
      if (seg.bendingStiffnessEI < 0) {
        diagnostics.push({
          code: SimaErrorCode.INVALID_STIFFNESS_HIERARCHY.code,
          id: SimaErrorCode.INVALID_STIFFNESS_HIERARCHY.id,
          rule: SimaErrorCode.INVALID_STIFFNESS_HIERARCHY.rule,
          severity: SimaErrorCode.INVALID_STIFFNESS_HIERARCHY.severity,
          message: SimaErrorCode.INVALID_STIFFNESS_HIERARCHY.message(seg.name, "EI", seg.bendingStiffnessEI),
          target: seg.id,
        });
      }

      // M7011: Morison drag unspecified in wave zone
      if (seg.cd <= 0) {
        diagnostics.push({
          code: SimaErrorCode.MORISON_DRAG_UNSPECIFIED.code,
          id: SimaErrorCode.MORISON_DRAG_UNSPECIFIED.id,
          rule: SimaErrorCode.MORISON_DRAG_UNSPECIFIED.rule,
          severity: SimaErrorCode.MORISON_DRAG_UNSPECIFIED.severity,
          message: SimaErrorCode.MORISON_DRAG_UNSPECIFIED.message(seg.name),
          target: seg.id,
        });
      }

      // M7003: Courant acoustic condition
      if (seg.dryMassPerMeter > 0 && seg.axialStiffnessEA > 0 && seg.length > 0) {
        const soundSpeed = Math.sqrt(seg.axialStiffnessEA / seg.dryMassPerMeter);
        const criticalDt = seg.length / soundSpeed;
        if (model.simulation.timeStep > criticalDt && model.simulation.solver === "newmark") {
          diagnostics.push({
            code: SimaErrorCode.ACOUSTIC_COURANT_VIOLATION.code,
            id: SimaErrorCode.ACOUSTIC_COURANT_VIOLATION.id,
            rule: SimaErrorCode.ACOUSTIC_COURANT_VIOLATION.rule,
            severity: SimaErrorCode.ACOUSTIC_COURANT_VIOLATION.severity,
            message: SimaErrorCode.ACOUSTIC_COURANT_VIOLATION.message(seg.name, model.simulation.timeStep, criticalDt),
            target: seg.id,
          });
        }
      }
    }
  }

  return diagnostics;
}
