// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/dicom-rt — Core AST & Clinical Radiotherapy Types.
 *
 * Models DICOM-RT entities across RTSTRUCT (anatomical ROI contours),
 * RTPLAN (treatment beams, control points, jaws, MLC leaf banks),
 * and RTDOSE (cumulative Dose-Volume Histograms and QUANTEC limits).
 */

export interface DicomRtSourceRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export type RoiInterpretedType = "PTV" | "CTV" | "GTV" | "ORGAN" | "EXTERNAL" | "AVOIDANCE" | "BOLUS" | "MARKER";

export type ContourGeometricType = "CLOSED_PLANAR" | "POINT" | "OPEN_PLANAR";

export interface RtContourSlice {
  z: number;
  geometricType: ContourGeometricType;
  points: [number, number, number][];
  range?: DicomRtSourceRange | undefined;
}

export interface RtRoiStructure {
  roiNumber: number;
  name: string;
  interpretedType: RoiInterpretedType;
  color?: [number, number, number] | undefined;
  volumeCc: number;
  contours: RtContourSlice[];
  maxDoseLimitGy?: number | undefined;
  meanDoseLimitGy?: number | undefined;
  range: DicomRtSourceRange;
}

export interface MlcLeafPair {
  pairIndex: number;
  bankA_mm: number;
  bankB_mm: number;
  range?: DicomRtSourceRange | undefined;
}

export interface RtControlPoint {
  index: number;
  cumulativeMetersetWeight: number;
  gantryAngleDeg: number;
  collimatorAngleDeg: number;
  couchAngleDeg: number;
  jawX_mm: [number, number];
  jawY_mm: [number, number];
  mlcLeaves: MlcLeafPair[];
  range: DicomRtSourceRange;
}

export type RtBeamModality = "PHOTON" | "PROTON" | "ELECTRON" | "CARBON_ION";

export type RtTreatmentDeliveryType = "TREATMENT" | "SETUP";

export interface RtBeam {
  beamNumber: number;
  name: string;
  modality: RtBeamModality;
  treatmentDeliveryType: RtTreatmentDeliveryType;
  energyMeV: number;
  metersetMu: number;
  doseRateMuPerMin: number;
  controlPoints: RtControlPoint[];
  range: DicomRtSourceRange;
}

export interface RtDoseBin {
  doseGy: number;
  volumePercent: number;
}

export interface RtRoiDvh {
  roiNumber: number;
  roiName: string;
  d98Gy: number;
  d95Gy: number;
  d50Gy: number;
  d2Gy: number;
  meanDoseGy: number;
  maxDoseGy: number;
  minDoseGy: number;
  v20GyPercent: number;
  bins: RtDoseBin[];
  range?: DicomRtSourceRange | undefined;
}

export interface DicomRtDocument {
  planId: string;
  planLabel: string;
  patientId: string;
  frameOfReferenceUid: string;
  structFrameOfReferenceUid?: string | undefined;
  doseFrameOfReferenceUid?: string | undefined;
  prescribedDoseGy: number;
  fractions: number;
  structures: RtRoiStructure[];
  beams: RtBeam[];
  dvhs: RtRoiDvh[];
  uri?: string | undefined;
  range?: DicomRtSourceRange | undefined;
}

export interface DicomRtDiagnostic {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  range: DicomRtSourceRange;
}
