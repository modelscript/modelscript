// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nifti — Volumetric Medical Imaging & NIfTI/NRRD Semantic Linter.
 *
 * Implements diagnostic rules M9501–M9510:
 * - M9501 (nifti-invalid-dimensions): Volume dimension dim[0] is outside [1, 7] or spatial dimensions nx, ny, nz <= 0.
 * - M9502 (nifti-non-positive-voxel-spacing): Voxel spacing pixdim[1..3] (or NRRD space directions norm) is <= 0 mm.
 * - M9503 (nifti-singular-affine-transform): 4x4 sform affine transformation matrix is singular or degenerate (|det(A)| < 1e-9).
 * - M9504 (nifti-invalid-quaternion-norm): Quaternion parameters quatern_b, quatern_c, quatern_d satisfy b^2 + c^2 + d^2 > 1.0 + 1e-6.
 * - M9505 (nifti-qform-sform-handedness-mismatch): Both qform and sform are active (qform_code > 0 and sform_code > 0) but have opposite coordinate handedness (sign(pixdim[0]) != sign(det(A_sform))).
 * - M9506 (nifti-zero-intensity-scale-slope): scl_slope is explicitly set to 0 while data scaling is active, zeroing all voxel intensities.
 * - M9507 (nifti-unsupported-datatype): Unrecognized or invalid NIfTI/NRRD voxel datatype code.
 * - M9508 (nifti-voxel-data-size-mismatch): Declared voxel payload count does not match nx * ny * nz * nt.
 * - M9509 (nifti-empty-segmentation-mask): Segmentation labelmap contains zero foreground voxels across all anatomical labels.
 * - M9510 (nifti-anisotropic-slice-gap-warning): Slice thickness dz exceeds in-plane resolution min(dx, dy) by more than 5x.
 */

import type { NiftiDiagnostic, NiftiDocument, NiftiHeader } from "../types.js";

export const VALID_NIFTI_DATATYPE_CODES = new Set<number>([
  2, // DT_UINT8
  4, // DT_INT16
  8, // DT_INT32
  16, // DT_FLOAT32
  32, // DT_COMPLEX64
  64, // DT_FLOAT64
  128, // DT_RGB24
  256, // DT_INT8
  512, // DT_UINT16
  768, // DT_UINT32
  1024, // DT_INT64
  1280, // DT_UINT64
]);

export const NiftiErrorCode = {
  INVALID_DIMENSIONS: {
    code: "M9501",
    rule: "nifti-invalid-dimensions",
    severity: "error" as const,
    message: (ndim: number, nx: number, ny: number, nz: number) =>
      `Invalid NIfTI/NRRD volume dimensions: dim[0]='${ndim}', spatial size=(${nx}, ${ny}, ${nz}).`,
  },
  NON_POSITIVE_VOXEL_SPACING: {
    code: "M9502",
    rule: "nifti-non-positive-voxel-spacing",
    severity: "error" as const,
    message: (dx: number, dy: number, dz: number) =>
      `Non-positive voxel spacing pixdim=(${dx}, ${dy}, ${dz}) mm (all spatial spacings must be > 0).`,
  },
  SINGULAR_AFFINE_TRANSFORM: {
    code: "M9503",
    rule: "nifti-singular-affine-transform",
    severity: "error" as const,
    message: (detA: string) =>
      `4x4 sform affine transformation matrix is singular or degenerate with det(A) = '${detA}'.`,
  },
  INVALID_QUATERNION_NORM: {
    code: "M9504",
    rule: "nifti-invalid-quaternion-norm",
    severity: "error" as const,
    message: (b: number, c: number, d: number, normSq: string) =>
      `Invalid qform quaternion parameters (${b}, ${c}, ${d}): b^2 + c^2 + d^2 = '${normSq}' exceeds 1.0.`,
  },
  QFORM_SFORM_HANDEDNESS_MISMATCH: {
    code: "M9505",
    rule: "nifti-qform-sform-handedness-mismatch",
    severity: "error" as const,
    message: (qfacSign: number, sformDetSign: number) =>
      `Coordinate handedness mismatch between active qform (qfac sign '${qfacSign}') and sform (det sign '${sformDetSign}').`,
  },
  ZERO_INTENSITY_SCALE_SLOPE: {
    code: "M9506",
    rule: "nifti-zero-intensity-scale-slope",
    severity: "error" as const,
    message: (sclSlope: number, sclInter: number) =>
      `Intensity scaling has scl_slope='${sclSlope}' with active scaling (scl_inter='${sclInter}'), zeroing all voxel intensities.`,
  },
  UNSUPPORTED_DATATYPE: {
    code: "M9507",
    rule: "nifti-unsupported-datatype",
    severity: "error" as const,
    message: (datatypeCode: number, datatypeName: string) =>
      `Unsupported or invalid NIfTI/NRRD voxel datatype '${datatypeName}' (code='${datatypeCode}').`,
  },
  VOXEL_DATA_SIZE_MISMATCH: {
    code: "M9508",
    rule: "nifti-voxel-data-size-mismatch",
    severity: "error" as const,
    message: (actualCount: number, expectedCount: number, dimsDesc: string) =>
      `Voxel payload count '${actualCount}' does not match expected '${expectedCount}' for dimensions ${dimsDesc}.`,
  },
  EMPTY_SEGMENTATION_MASK: {
    code: "M9509",
    rule: "nifti-empty-segmentation-mask",
    severity: "warning" as const,
    message: (title: string) =>
      `Segmentation labelmap '${title}' contains zero foreground voxels across all anatomical labels.`,
  },
  ANISOTROPIC_SLICE_GAP_WARNING: {
    code: "M9510",
    rule: "nifti-anisotropic-slice-gap-warning",
    severity: "warning" as const,
    message: (dz: number, minInPlane: number, ratio: string) =>
      `Slice thickness dz='${dz}' mm exceeds in-plane resolution '${minInPlane}' mm by '${ratio}x' (> 5x threshold), risking severe 3D stair-step artifacts.`,
  },
};

/**
 * Computes the determinant of the 3x3 linear part of a 4x4 sform affine matrix.
 */
export function computeSformAffineDeterminant(header: NiftiHeader): number {
  const [a00, a01, a02] = header.srowX;
  const [a10, a11, a12] = header.srowY;
  const [a20, a21, a22] = header.srowZ;

  return a00 * (a11 * a22 - a12 * a21) - a01 * (a10 * a22 - a12 * a20) + a02 * (a10 * a21 - a11 * a20);
}

export function lintNiftiDocument(doc: NiftiDocument): NiftiDiagnostic[] {
  const diagnostics: NiftiDiagnostic[] = [];
  const h = doc.header;

  const ndim = h.dim[0];
  const nx = h.dim[1];
  const ny = h.dim[2];
  const nz = h.dim[3];
  const nt = Math.max(1, h.dim[4] || 1);

  // ───────────────────────────────────────────────────────────────────────────
  // 1. M9501: Volume dimension check
  // ───────────────────────────────────────────────────────────────────────────
  if (ndim < 1 || ndim > 7 || nx <= 0 || ny <= 0 || nz <= 0) {
    diagnostics.push({
      code: NiftiErrorCode.INVALID_DIMENSIONS.code,
      rule: NiftiErrorCode.INVALID_DIMENSIONS.rule,
      severity: NiftiErrorCode.INVALID_DIMENSIONS.severity,
      message: NiftiErrorCode.INVALID_DIMENSIONS.message(ndim, nx, ny, nz),
      range: doc.range,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2. M9502 & M9510: Voxel spacing and anisotropic slice-gap ratio
  // ───────────────────────────────────────────────────────────────────────────
  const dx = h.pixdim[1];
  const dy = h.pixdim[2];
  const dz = h.pixdim[3];

  if (dx <= 0 || dy <= 0 || dz <= 0) {
    diagnostics.push({
      code: NiftiErrorCode.NON_POSITIVE_VOXEL_SPACING.code,
      rule: NiftiErrorCode.NON_POSITIVE_VOXEL_SPACING.rule,
      severity: NiftiErrorCode.NON_POSITIVE_VOXEL_SPACING.severity,
      message: NiftiErrorCode.NON_POSITIVE_VOXEL_SPACING.message(dx, dy, dz),
      range: doc.range,
    });
  } else {
    const minInPlane = Math.min(dx, dy);
    if (minInPlane > 0 && dz > 5.0 * minInPlane + 1e-9) {
      const ratio = (dz / minInPlane).toFixed(2);
      diagnostics.push({
        code: NiftiErrorCode.ANISOTROPIC_SLICE_GAP_WARNING.code,
        rule: NiftiErrorCode.ANISOTROPIC_SLICE_GAP_WARNING.rule,
        severity: NiftiErrorCode.ANISOTROPIC_SLICE_GAP_WARNING.severity,
        message: NiftiErrorCode.ANISOTROPIC_SLICE_GAP_WARNING.message(dz, minInPlane, ratio),
        range: doc.range,
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 3. M9503: Singular 4x4 sform affine transform check
  // ───────────────────────────────────────────────────────────────────────────
  const detSform = computeSformAffineDeterminant(h);
  if (h.sformCode > 0 && Math.abs(detSform) < 1e-9) {
    diagnostics.push({
      code: NiftiErrorCode.SINGULAR_AFFINE_TRANSFORM.code,
      rule: NiftiErrorCode.SINGULAR_AFFINE_TRANSFORM.rule,
      severity: NiftiErrorCode.SINGULAR_AFFINE_TRANSFORM.severity,
      message: NiftiErrorCode.SINGULAR_AFFINE_TRANSFORM.message(detSform.toExponential(3)),
      range: doc.range,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 4. M9504: Quaternion norm check (b^2 + c^2 + d^2 <= 1.0)
  // ───────────────────────────────────────────────────────────────────────────
  const qNormSq = h.quaternB * h.quaternB + h.quaternC * h.quaternC + h.quaternD * h.quaternD;
  if (qNormSq > 1.0 + 1e-6) {
    diagnostics.push({
      code: NiftiErrorCode.INVALID_QUATERNION_NORM.code,
      rule: NiftiErrorCode.INVALID_QUATERNION_NORM.rule,
      severity: NiftiErrorCode.INVALID_QUATERNION_NORM.severity,
      message: NiftiErrorCode.INVALID_QUATERNION_NORM.message(h.quaternB, h.quaternC, h.quaternD, qNormSq.toFixed(6)),
      range: doc.range,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 5. M9505: qform vs sform coordinate handedness mismatch
  // ───────────────────────────────────────────────────────────────────────────
  if (h.qformCode > 0 && h.sformCode > 0 && Math.abs(detSform) >= 1e-9) {
    const qfac = h.pixdim[0] === -1 ? -1 : 1;
    const sformSign = detSform < 0 ? -1 : 1;
    if (qfac !== sformSign) {
      diagnostics.push({
        code: NiftiErrorCode.QFORM_SFORM_HANDEDNESS_MISMATCH.code,
        rule: NiftiErrorCode.QFORM_SFORM_HANDEDNESS_MISMATCH.rule,
        severity: NiftiErrorCode.QFORM_SFORM_HANDEDNESS_MISMATCH.severity,
        message: NiftiErrorCode.QFORM_SFORM_HANDEDNESS_MISMATCH.message(qfac, sformSign),
        range: doc.range,
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 6. M9506: Zero intensity scale slope (scl_slope === 0 when scaling active)
  // ───────────────────────────────────────────────────────────────────────────
  if (h.sclSlope === 0 && (h.scalingExplicitlyActive === true || h.sclInter !== 0)) {
    diagnostics.push({
      code: NiftiErrorCode.ZERO_INTENSITY_SCALE_SLOPE.code,
      rule: NiftiErrorCode.ZERO_INTENSITY_SCALE_SLOPE.rule,
      severity: NiftiErrorCode.ZERO_INTENSITY_SCALE_SLOPE.severity,
      message: NiftiErrorCode.ZERO_INTENSITY_SCALE_SLOPE.message(h.sclSlope, h.sclInter),
      range: doc.range,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 7. M9507: Unsupported voxel datatype code
  // ───────────────────────────────────────────────────────────────────────────
  if (!VALID_NIFTI_DATATYPE_CODES.has(h.datatypeCode)) {
    diagnostics.push({
      code: NiftiErrorCode.UNSUPPORTED_DATATYPE.code,
      rule: NiftiErrorCode.UNSUPPORTED_DATATYPE.rule,
      severity: NiftiErrorCode.UNSUPPORTED_DATATYPE.severity,
      message: NiftiErrorCode.UNSUPPORTED_DATATYPE.message(h.datatypeCode, h.datatypeName),
      range: doc.range,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 8. M9508: Voxel payload size mismatch
  // ───────────────────────────────────────────────────────────────────────────
  if (doc.hasExplicitVoxelPayload && nx > 0 && ny > 0 && nz > 0) {
    const expectedCount = nx * ny * nz * nt;
    if (doc.voxels.length !== expectedCount) {
      diagnostics.push({
        code: NiftiErrorCode.VOXEL_DATA_SIZE_MISMATCH.code,
        rule: NiftiErrorCode.VOXEL_DATA_SIZE_MISMATCH.rule,
        severity: NiftiErrorCode.VOXEL_DATA_SIZE_MISMATCH.severity,
        message: NiftiErrorCode.VOXEL_DATA_SIZE_MISMATCH.message(
          doc.voxels.length,
          expectedCount,
          `(${nx}x${ny}x${nz}${nt > 1 ? `x${nt}` : ""})`,
        ),
        range: doc.range,
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 9. M9509: Empty segmentation mask
  // ───────────────────────────────────────────────────────────────────────────
  const isSeg = Boolean(h.isSegmentation) || h.intentCode === 1002 || doc.labels.length > 0;
  if (isSeg && doc.hasExplicitVoxelPayload && doc.voxels.length > 0) {
    const hasForeground = doc.voxels.some((v) => v > 0);
    if (!hasForeground) {
      diagnostics.push({
        code: NiftiErrorCode.EMPTY_SEGMENTATION_MASK.code,
        rule: NiftiErrorCode.EMPTY_SEGMENTATION_MASK.rule,
        severity: NiftiErrorCode.EMPTY_SEGMENTATION_MASK.severity,
        message: NiftiErrorCode.EMPTY_SEGMENTATION_MASK.message(doc.title || "SegmentationVolume"),
        range: doc.range,
      });
    }
  }

  return diagnostics;
}
