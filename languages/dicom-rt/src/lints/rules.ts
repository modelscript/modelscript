// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/dicom-rt — Clinical Radiotherapy Physics & QUANTEC Safety Linter.
 *
 * Implements diagnostic rules M9201–M9210:
 * - M9201 (dicom-rt-missing-target-volume): Plan contains no target ROI (PTV, CTV, or GTV).
 * - M9202 (dicom-rt-mlc-leaf-overlap): MLC leaf pair violates minimum physical gap (< 0.5 mm or bankA > bankB).
 * - M9203 (dicom-rt-mlc-speed-exceeded): MLC leaf travel speed between consecutive control points exceeds 25.0 mm/s.
 * - M9204 (dicom-rt-gantry-couch-collision): Non-coplanar couch angle (> 15 deg) with lateral/posterior gantry angle.
 * - M9205 (dicom-rt-oar-dose-constraint-violated): Organ-at-Risk (ORGAN) DVH exceeds maxDoseLimitGy or meanDoseLimitGy.
 * - M9206 (dicom-rt-non-monotonic-cum-meterset): Control point cumulativeMetersetWeight not monotonic or not [0.0, 1.0].
 * - M9207 (dicom-rt-unclosed-roi-contour): CLOSED_PLANAR contour slice has fewer than 3 vertices.
 * - M9208 (dicom-rt-unresolved-frame-of-reference): structFrameOfReferenceUid or doseFrameOfReferenceUid mismatches plan.
 * - M9209 (dicom-rt-invalid-beam-meterset): TREATMENT beam has metersetMu <= 0 or energyMeV <= 0.
 * - M9210 (dicom-rt-ptv-underdosage): Target PTV DVH D95% is less than 95% of prescribedDoseGy.
 */

import type { DicomRtDiagnostic, DicomRtDocument, DicomRtSourceRange, RtRoiStructure } from "../types.js";

export const MIN_MLC_LEAF_GAP_MM = 0.5;
export const MAX_MLC_LEAF_SPEED_MM_PER_SEC = 25.0;

const DEFAULT_RANGE: DicomRtSourceRange = {
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 1,
  startOffset: 0,
  endOffset: 0,
};

export const DicomRtErrorCode = {
  MISSING_TARGET_VOLUME: {
    code: "M9201",
    rule: "dicom-rt-missing-target-volume",
    severity: "error" as const,
    message: (planLabel: string) =>
      `Treatment plan '${planLabel}' contains no clinical target volume ROI ('PTV', 'CTV', or 'GTV').`,
  },
  MLC_LEAF_OVERLAP: {
    code: "M9202",
    rule: "dicom-rt-mlc-leaf-overlap",
    severity: "error" as const,
    message: (beamName: string, cpIndex: number, pairIndex: number, bankA: number, bankB: number, gap: number) =>
      `MLC leaf pair '${pairIndex}' on beam '${beamName}' control point '${cpIndex}' has bankA='${bankA} mm', bankB='${bankB} mm' (gap '${gap.toFixed(2)} mm' < minimum '${MIN_MLC_LEAF_GAP_MM} mm').`,
  },
  MLC_SPEED_EXCEEDED: {
    code: "M9203",
    rule: "dicom-rt-mlc-speed-exceeded",
    severity: "error" as const,
    message: (beamName: string, cpFrom: number, cpTo: number, pairIndex: number, speedMmPerSec: number) =>
      `MLC leaf pair '${pairIndex}' on beam '${beamName}' between control points '${cpFrom}' and '${cpTo}' travels at '${speedMmPerSec.toFixed(2)} mm/s', exceeding physical motor limit '${MAX_MLC_LEAF_SPEED_MM_PER_SEC.toFixed(1)} mm/s'.`,
  },
  GANTRY_COUCH_COLLISION: {
    code: "M9204",
    rule: "dicom-rt-gantry-couch-collision",
    severity: "error" as const,
    message: (beamName: string, cpIndex: number, gantryDeg: number, couchDeg: number) =>
      `Gantry angle '${gantryDeg} deg' and non-coplanar couch angle '${couchDeg} deg' on beam '${beamName}' control point '${cpIndex}' enter the gantry-couch collision hazard zone.`,
  },
  OAR_DOSE_CONSTRAINT_VIOLATED: {
    code: "M9205",
    rule: "dicom-rt-oar-dose-constraint-violated",
    severity: "error" as const,
    message: (roiName: string, metricKind: "max" | "mean", actualGy: number, limitGy: number) =>
      `Organ-at-Risk '${roiName}' ${metricKind} dose '${actualGy.toFixed(2)} Gy' exceeds QUANTEC clinical constraint '${limitGy.toFixed(2)} Gy'.`,
  },
  NON_MONOTONIC_CUM_METERSET: {
    code: "M9206",
    rule: "dicom-rt-non-monotonic-cum-meterset",
    severity: "error" as const,
    message: (beamName: string, detail: string) =>
      `Control point cumulativeMetersetWeight sequence on beam '${beamName}' is invalid: ${detail}.`,
  },
  UNCLOSED_ROI_CONTOUR: {
    code: "M9207",
    rule: "dicom-rt-unclosed-roi-contour",
    severity: "error" as const,
    message: (roiName: string, zSlice: number, vertexCount: number) =>
      `CLOSED_PLANAR contour slice at z='${zSlice} mm' in ROI '${roiName}' has '${vertexCount}' vertices (minimum 3 required).`,
  },
  UNRESOLVED_FRAME_OF_REFERENCE: {
    code: "M9208",
    rule: "dicom-rt-unresolved-frame-of-reference",
    severity: "error" as const,
    message: (modalitySource: string, sourceUid: string, planUid: string) =>
      `${modalitySource} FrameOfReferenceUID '${sourceUid}' does not match plan FrameOfReferenceUID '${planUid}'.`,
  },
  INVALID_BEAM_METERSET: {
    code: "M9209",
    rule: "dicom-rt-invalid-beam-meterset",
    severity: "error" as const,
    message: (beamName: string, metersetMu: number, energyMeV: number) =>
      `TREATMENT beam '${beamName}' has invalid delivery parameters (metersetMu='${metersetMu}', energyMeV='${energyMeV}'); both must be > 0.`,
  },
  PTV_UNDERDOSAGE: {
    code: "M9210",
    rule: "dicom-rt-ptv-underdosage",
    severity: "warning" as const,
    message: (roiName: string, d95Gy: number, requiredGy: number, prescribedGy: number) =>
      `Target volume '${roiName}' D95% '${d95Gy.toFixed(2)} Gy' is below 95% of prescribed dose '${prescribedGy.toFixed(2)} Gy' (minimum '${requiredGy.toFixed(2)} Gy').`,
  },
};

export function lintDicomRtDocument(doc: DicomRtDocument): DicomRtDiagnostic[] {
  const diagnostics: DicomRtDiagnostic[] = [];
  const docRange = doc.range ?? DEFAULT_RANGE;

  // ───────────────────────────────────────────────────────────────────────────
  // M9201: Plan contains no target ROI (PTV, CTV, or GTV)
  // ───────────────────────────────────────────────────────────────────────────
  const hasTargetRoi = doc.structures.some(
    (s) => s.interpretedType === "PTV" || s.interpretedType === "CTV" || s.interpretedType === "GTV",
  );
  if (!hasTargetRoi) {
    diagnostics.push({
      code: DicomRtErrorCode.MISSING_TARGET_VOLUME.code,
      rule: DicomRtErrorCode.MISSING_TARGET_VOLUME.rule,
      severity: DicomRtErrorCode.MISSING_TARGET_VOLUME.severity,
      message: DicomRtErrorCode.MISSING_TARGET_VOLUME.message(doc.planLabel || doc.planId),
      range: docRange,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // M9208: Frame of Reference UID mismatch across RTPLAN / RTSTRUCT / RTDOSE
  // ───────────────────────────────────────────────────────────────────────────
  if (doc.structFrameOfReferenceUid !== undefined && doc.structFrameOfReferenceUid !== doc.frameOfReferenceUid) {
    diagnostics.push({
      code: DicomRtErrorCode.UNRESOLVED_FRAME_OF_REFERENCE.code,
      rule: DicomRtErrorCode.UNRESOLVED_FRAME_OF_REFERENCE.rule,
      severity: DicomRtErrorCode.UNRESOLVED_FRAME_OF_REFERENCE.severity,
      message: DicomRtErrorCode.UNRESOLVED_FRAME_OF_REFERENCE.message(
        "RTSTRUCT",
        doc.structFrameOfReferenceUid,
        doc.frameOfReferenceUid,
      ),
      range: doc.structures[0]?.range ?? docRange,
    });
  }

  if (doc.doseFrameOfReferenceUid !== undefined && doc.doseFrameOfReferenceUid !== doc.frameOfReferenceUid) {
    diagnostics.push({
      code: DicomRtErrorCode.UNRESOLVED_FRAME_OF_REFERENCE.code,
      rule: DicomRtErrorCode.UNRESOLVED_FRAME_OF_REFERENCE.rule,
      severity: DicomRtErrorCode.UNRESOLVED_FRAME_OF_REFERENCE.severity,
      message: DicomRtErrorCode.UNRESOLVED_FRAME_OF_REFERENCE.message(
        "RTDOSE",
        doc.doseFrameOfReferenceUid,
        doc.frameOfReferenceUid,
      ),
      range: doc.dvhs[0]?.range ?? docRange,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // M9207: CLOSED_PLANAR contour slice has fewer than 3 vertices
  // ───────────────────────────────────────────────────────────────────────────
  for (const roi of doc.structures) {
    for (const contour of roi.contours) {
      if (contour.geometricType === "CLOSED_PLANAR" && contour.points.length < 3) {
        diagnostics.push({
          code: DicomRtErrorCode.UNCLOSED_ROI_CONTOUR.code,
          rule: DicomRtErrorCode.UNCLOSED_ROI_CONTOUR.rule,
          severity: DicomRtErrorCode.UNCLOSED_ROI_CONTOUR.severity,
          message: DicomRtErrorCode.UNCLOSED_ROI_CONTOUR.message(roi.name, contour.z, contour.points.length),
          range: contour.range ?? roi.range,
        });
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Beam & Control Point Checks: M9202, M9203, M9204, M9206, M9209
  // ───────────────────────────────────────────────────────────────────────────
  for (const beam of doc.beams) {
    // M9209: TREATMENT beam has metersetMu <= 0 or energyMeV <= 0
    if (beam.treatmentDeliveryType === "TREATMENT" && (beam.metersetMu <= 0 || beam.energyMeV <= 0)) {
      diagnostics.push({
        code: DicomRtErrorCode.INVALID_BEAM_METERSET.code,
        rule: DicomRtErrorCode.INVALID_BEAM_METERSET.rule,
        severity: DicomRtErrorCode.INVALID_BEAM_METERSET.severity,
        message: DicomRtErrorCode.INVALID_BEAM_METERSET.message(beam.name, beam.metersetMu, beam.energyMeV),
        range: beam.range,
      });
    }

    const cps = beam.controlPoints;
    if (cps.length > 0) {
      // M9206: cumulativeMetersetWeight monotonicity and [0.0, 1.0] endpoints
      const firstCp = cps[0]!;
      const lastCp = cps[cps.length - 1]!;
      let monotonicViolated = false;

      if (Math.abs(firstCp.cumulativeMetersetWeight - 0.0) > 1e-6) {
        monotonicViolated = true;
        diagnostics.push({
          code: DicomRtErrorCode.NON_MONOTONIC_CUM_METERSET.code,
          rule: DicomRtErrorCode.NON_MONOTONIC_CUM_METERSET.rule,
          severity: DicomRtErrorCode.NON_MONOTONIC_CUM_METERSET.severity,
          message: DicomRtErrorCode.NON_MONOTONIC_CUM_METERSET.message(
            beam.name,
            `initial control point '${firstCp.index}' has weight '${firstCp.cumulativeMetersetWeight}' instead of '0.0'`,
          ),
          range: firstCp.range,
        });
      }

      for (let i = 0; i < cps.length - 1; i++) {
        const curr = cps[i]!;
        const next = cps[i + 1]!;
        if (next.cumulativeMetersetWeight < curr.cumulativeMetersetWeight - 1e-9) {
          monotonicViolated = true;
          diagnostics.push({
            code: DicomRtErrorCode.NON_MONOTONIC_CUM_METERSET.code,
            rule: DicomRtErrorCode.NON_MONOTONIC_CUM_METERSET.rule,
            severity: DicomRtErrorCode.NON_MONOTONIC_CUM_METERSET.severity,
            message: DicomRtErrorCode.NON_MONOTONIC_CUM_METERSET.message(
              beam.name,
              `control point '${next.index}' weight '${next.cumulativeMetersetWeight}' decreases from '${curr.cumulativeMetersetWeight}'`,
            ),
            range: next.range,
          });
        }
      }

      if (!monotonicViolated && Math.abs(lastCp.cumulativeMetersetWeight - 1.0) > 1e-6) {
        diagnostics.push({
          code: DicomRtErrorCode.NON_MONOTONIC_CUM_METERSET.code,
          rule: DicomRtErrorCode.NON_MONOTONIC_CUM_METERSET.rule,
          severity: DicomRtErrorCode.NON_MONOTONIC_CUM_METERSET.severity,
          message: DicomRtErrorCode.NON_MONOTONIC_CUM_METERSET.message(
            beam.name,
            `final control point '${lastCp.index}' has weight '${lastCp.cumulativeMetersetWeight}' instead of '1.0'`,
          ),
          range: lastCp.range,
        });
      }
    }

    for (let i = 0; i < cps.length; i++) {
      const cp = cps[i]!;

      // M9202: MLC leaf overlap / minimum gap violation
      for (const leaf of cp.mlcLeaves) {
        const gap = leaf.bankB_mm - leaf.bankA_mm;
        if (leaf.bankA_mm > leaf.bankB_mm || gap < MIN_MLC_LEAF_GAP_MM - 1e-9) {
          diagnostics.push({
            code: DicomRtErrorCode.MLC_LEAF_OVERLAP.code,
            rule: DicomRtErrorCode.MLC_LEAF_OVERLAP.rule,
            severity: DicomRtErrorCode.MLC_LEAF_OVERLAP.severity,
            message: DicomRtErrorCode.MLC_LEAF_OVERLAP.message(
              beam.name,
              cp.index,
              leaf.pairIndex,
              leaf.bankA_mm,
              leaf.bankB_mm,
              gap,
            ),
            range: leaf.range ?? cp.range,
          });
        }
      }

      // M9204: Gantry-couch collision hazard zone
      const signedCouch = normalizeSignedAngleDeg(cp.couchAngleDeg);
      const isNonCoplanarCouch = Math.abs(signedCouch) > 15.0 || Math.abs(cp.couchAngleDeg) > 15.0;
      const normGantry = ((cp.gantryAngleDeg % 360) + 360) % 360;
      const isLateralOrPosteriorGantry =
        (normGantry >= 60.0 && normGantry <= 120.0) || (normGantry >= 240.0 && normGantry <= 300.0);

      if (isNonCoplanarCouch && isLateralOrPosteriorGantry) {
        diagnostics.push({
          code: DicomRtErrorCode.GANTRY_COUCH_COLLISION.code,
          rule: DicomRtErrorCode.GANTRY_COUCH_COLLISION.rule,
          severity: DicomRtErrorCode.GANTRY_COUCH_COLLISION.severity,
          message: DicomRtErrorCode.GANTRY_COUCH_COLLISION.message(
            beam.name,
            cp.index,
            cp.gantryAngleDeg,
            cp.couchAngleDeg,
          ),
          range: cp.range,
        });
      }

      // M9203: MLC leaf speed between consecutive control points
      if (i < cps.length - 1) {
        const nextCp = cps[i + 1]!;
        const dWeight = nextCp.cumulativeMetersetWeight - cp.cumulativeMetersetWeight;
        const doseRatePerSec = beam.doseRateMuPerMin > 0 ? beam.doseRateMuPerMin / 60.0 : 10.0;
        const beamMu = beam.metersetMu > 0 ? beam.metersetMu : 100.0;
        const dtSec = dWeight > 0 ? (dWeight * beamMu) / doseRatePerSec : 0;

        if (dtSec > 0) {
          const prevLeavesByPair = new Map<number, (typeof cp.mlcLeaves)[number]>();
          for (const l of cp.mlcLeaves) {
            prevLeavesByPair.set(l.pairIndex, l);
          }

          for (const nextLeaf of nextCp.mlcLeaves) {
            const prevLeaf = prevLeavesByPair.get(nextLeaf.pairIndex);
            if (!prevLeaf) continue;
            const speedA = Math.abs(nextLeaf.bankA_mm - prevLeaf.bankA_mm) / dtSec;
            const speedB = Math.abs(nextLeaf.bankB_mm - prevLeaf.bankB_mm) / dtSec;
            const maxSpeed = Math.max(speedA, speedB);
            if (maxSpeed > MAX_MLC_LEAF_SPEED_MM_PER_SEC + 1e-9) {
              diagnostics.push({
                code: DicomRtErrorCode.MLC_SPEED_EXCEEDED.code,
                rule: DicomRtErrorCode.MLC_SPEED_EXCEEDED.rule,
                severity: DicomRtErrorCode.MLC_SPEED_EXCEEDED.severity,
                message: DicomRtErrorCode.MLC_SPEED_EXCEEDED.message(
                  beam.name,
                  cp.index,
                  nextCp.index,
                  nextLeaf.pairIndex,
                  maxSpeed,
                ),
                range: nextLeaf.range ?? nextCp.range,
              });
            }
          }
        }
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // DVH Clinical Constraints: M9205 (OAR QUANTEC limits) & M9210 (PTV D95%)
  // ───────────────────────────────────────────────────────────────────────────
  const structByNumber = new Map<number, RtRoiStructure>();
  const structByName = new Map<string, RtRoiStructure>();
  for (const s of doc.structures) {
    structByNumber.set(s.roiNumber, s);
    structByName.set(s.name.toLowerCase(), s);
  }

  for (const dvh of doc.dvhs) {
    const struct = structByNumber.get(dvh.roiNumber) ?? structByName.get(dvh.roiName.toLowerCase());
    const diagRange = dvh.range ?? struct?.range ?? docRange;

    // M9205: OAR maxDoseLimitGy / meanDoseLimitGy violated
    if (struct && struct.interpretedType === "ORGAN") {
      if (struct.maxDoseLimitGy !== undefined && dvh.maxDoseGy > struct.maxDoseLimitGy + 1e-6) {
        diagnostics.push({
          code: DicomRtErrorCode.OAR_DOSE_CONSTRAINT_VIOLATED.code,
          rule: DicomRtErrorCode.OAR_DOSE_CONSTRAINT_VIOLATED.rule,
          severity: DicomRtErrorCode.OAR_DOSE_CONSTRAINT_VIOLATED.severity,
          message: DicomRtErrorCode.OAR_DOSE_CONSTRAINT_VIOLATED.message(
            struct.name,
            "max",
            dvh.maxDoseGy,
            struct.maxDoseLimitGy,
          ),
          range: diagRange,
        });
      }
      if (struct.meanDoseLimitGy !== undefined && dvh.meanDoseGy > struct.meanDoseLimitGy + 1e-6) {
        diagnostics.push({
          code: DicomRtErrorCode.OAR_DOSE_CONSTRAINT_VIOLATED.code,
          rule: DicomRtErrorCode.OAR_DOSE_CONSTRAINT_VIOLATED.rule,
          severity: DicomRtErrorCode.OAR_DOSE_CONSTRAINT_VIOLATED.severity,
          message: DicomRtErrorCode.OAR_DOSE_CONSTRAINT_VIOLATED.message(
            struct.name,
            "mean",
            dvh.meanDoseGy,
            struct.meanDoseLimitGy,
          ),
          range: diagRange,
        });
      }
    }

    // M9210: Target PTV D95% < 95% of prescribedDoseGy
    const isPtv = struct ? struct.interpretedType === "PTV" : dvh.roiName.toUpperCase().includes("PTV");
    if (isPtv && doc.prescribedDoseGy > 0) {
      const requiredD95 = 0.95 * doc.prescribedDoseGy;
      if (dvh.d95Gy < requiredD95 - 1e-6) {
        diagnostics.push({
          code: DicomRtErrorCode.PTV_UNDERDOSAGE.code,
          rule: DicomRtErrorCode.PTV_UNDERDOSAGE.rule,
          severity: DicomRtErrorCode.PTV_UNDERDOSAGE.severity,
          message: DicomRtErrorCode.PTV_UNDERDOSAGE.message(
            struct?.name ?? dvh.roiName,
            dvh.d95Gy,
            requiredD95,
            doc.prescribedDoseGy,
          ),
          range: diagRange,
        });
      }
    }
  }

  return diagnostics;
}

function normalizeSignedAngleDeg(angleDeg: number): number {
  const mod = ((angleDeg % 360) + 360) % 360;
  return mod > 180 ? mod - 360 : mod;
}
