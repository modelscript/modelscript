// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nifti — Domain types for NIfTI-1/2 (.nii) and NRRD (.nrrd, .nhdr).
 *
 * Covers 348-byte NIfTI-1 headers, NRRD volumetric descriptors, qform quaternions,
 * sform 4x4 RAS affine matrices, anatomical segmentation labels, ROIs, and voxel grids.
 */

export interface NiftiSourceRange {
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export type NiftiDiagnosticSeverity = "error" | "warning" | "info";

export interface NiftiDiagnostic {
  code: string;
  rule: string;
  severity: NiftiDiagnosticSeverity;
  message: string;
  range: NiftiSourceRange;
}

export type NiftiFormat = "nifti1" | "nifti2" | "nrrd" | "nhdr" | "xml" | "json" | "dsl";

export type Matrix4x4 = [
  [number, number, number, number],
  [number, number, number, number],
  [number, number, number, number],
  [number, number, number, number],
];

export interface NiftiHeader {
  sizeofHdr: number;
  magic: string;
  datatypeCode: number;
  datatypeName: string;
  bitpix: number;
  dim: [number, number, number, number, number, number, number, number];
  pixdim: [number, number, number, number, number, number, number, number];
  voxOffset: number;
  sclSlope: number;
  sclInter: number;
  scalingExplicitlyActive?: boolean | undefined;
  xyztUnits?: string | undefined;
  qformCode: number;
  sformCode: number;
  quaternB: number;
  quaternC: number;
  quaternD: number;
  qoffsetX: number;
  qoffsetY: number;
  qoffsetZ: number;
  srowX: [number, number, number, number];
  srowY: [number, number, number, number];
  srowZ: [number, number, number, number];
  description: string;
  intentCode?: number | undefined;
  intentName?: string | undefined;
  isSegmentation?: boolean | undefined;
}

export interface NiftiAnatomyLabel {
  id: number;
  name: string;
  color?: [number, number, number] | undefined;
  voxelCount?: number | undefined;
  range: NiftiSourceRange;
}

export interface NiftiRegionOfInterest {
  id: string;
  name: string;
  labelId: number;
  diffusionCoeffD?: number | undefined;
  clearanceRateK?: number | undefined;
  initialConcentration?: number | undefined;
  range: NiftiSourceRange;
}

export interface NiftiDocument {
  format: NiftiFormat;
  title: string;
  header: NiftiHeader;
  voxels: number[];
  hasExplicitVoxelPayload: boolean;
  labels: NiftiAnatomyLabel[];
  rois: NiftiRegionOfInterest[];
  spaceOrigin?: [number, number, number] | undefined;
  spaceDirections?: [[number, number, number], [number, number, number], [number, number, number]] | undefined;
  sourceUri?: string | undefined;
  range: NiftiSourceRange;
}
