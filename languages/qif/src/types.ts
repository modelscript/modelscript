// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/qif — Domain types for ISO 23952 / ANSI DMSC Quality Information Framework (QIF 3.0).
 *
 * Implements the data model for Model-Based Definition (MBD), ASME Y14.5 GD&T,
 * Measurement Plans, Measurement Resources, QIF Rules, and Metrology Actuals.
 */

export interface QifSourceRange {
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export type QifDiagnosticSeverity = "error" | "warning" | "info";

export interface QifDiagnostic {
  code: string;
  rule?: string | undefined;
  severity: QifDiagnosticSeverity;
  message: string;
  range: QifSourceRange;
}

export interface QifHeader {
  author?: string | undefined;
  application?: string | undefined;
  fileUnits?: string | undefined;
  partName?: string | undefined;
  partNumber?: string | undefined;
}

export type QifFeatureType = "Plane" | "Cylinder" | "Sphere" | "Cone" | "Circle" | "Slot" | "Point";

export type QifMaterialCondition = "RFS" | "MMC" | "LMC";

export type QifGdtType =
  | "Flatness"
  | "Straightness"
  | "Circularity"
  | "Cylindricity"
  | "ProfileOfSurface"
  | "ProfileOfLine"
  | "Perpendicularity"
  | "Parallelism"
  | "Angularity"
  | "Position"
  | "CircularRunout"
  | "TotalRunout"
  | "DimensionalSize"
  | "DimensionalDistance";

export interface QifDatumDefinition {
  id: string;
  qpId?: string | undefined;
  label: string;
  featureId?: string | undefined;
  featureIdRange?: QifSourceRange | undefined;
  datumReferences?: string[] | undefined;
  range: QifSourceRange;
}

export interface QifFeature {
  id: string;
  qpId: string;
  name: string;
  featureType: QifFeatureType;
  isFeatureOfSize: boolean;
  isInternal?: boolean | undefined;
  nominalSize?: number | undefined;
  upperSizeTolerance?: number | undefined;
  lowerSizeTolerance?: number | undefined;
  location?: [number, number, number] | undefined;
  normal?: [number, number, number] | undefined;
  stepEntityId?: string | undefined;
  stepEntityIdRange?: QifSourceRange | undefined;
  probingPoints?: number | undefined;
  probingPointsRange?: QifSourceRange | undefined;
  range: QifSourceRange;
}

export interface QifDatumRef {
  datumLabel: string;
  materialCondition?: QifMaterialCondition | undefined;
  precedence?: number | undefined;
  range?: QifSourceRange | undefined;
}

export interface QifCompositeLowerTier {
  toleranceZone: number;
  materialCondition?: QifMaterialCondition | undefined;
  datumReferences: string[];
}

export interface QifCharacteristic {
  id: string;
  qpId: string;
  name: string;
  balloonNumber?: number | undefined;
  gdtType: QifGdtType;
  nominalValue?: number | undefined;
  toleranceZone: number;
  toleranceRange?: QifSourceRange | undefined;
  upperTolerance?: number | undefined;
  lowerTolerance?: number | undefined;
  isDiametrical?: boolean | undefined;
  materialCondition: QifMaterialCondition;
  datumReferences: QifDatumRef[];
  compositeLowerTier?: QifCompositeLowerTier | undefined;
  featureIds: string[];
  featureIdRanges?: QifSourceRange[] | undefined;
  deviceId?: string | undefined;
  deviceIdRange?: QifSourceRange | undefined;
  spcSubgroupSize?: number | undefined;
  spcSubgroupSizeRange?: QifSourceRange | undefined;
  range: QifSourceRange;
}

export type QifDeviceType = "CMM" | "LaserScanner" | "OpticalGauge" | "Caliper";

export interface QifMeasurementDevice {
  id: string;
  qpId?: string | undefined;
  name: string;
  deviceType: QifDeviceType;
  calibrationUncertainty: number;
  range: QifSourceRange;
}

export interface QifRules {
  minPointsPerFeature: Record<string, number>;
  minTurRatio: number;
  range?: QifSourceRange | undefined;
}

export interface QifPlanStep {
  id: string;
  stepNumber: number;
  featureId: string;
  featureIdRange?: QifSourceRange | undefined;
  characteristicId?: string | undefined;
  characteristicIdRange?: QifSourceRange | undefined;
  deviceId: string;
  deviceIdRange?: QifSourceRange | undefined;
  probingPointCount: number;
  probingPointCountRange?: QifSourceRange | undefined;
  range: QifSourceRange;
}

export type QifActualStatus = "PASS" | "FAIL" | "REWORK";

export interface QifCharacteristicActual {
  id: string;
  characteristicId: string;
  characteristicIdRange?: QifSourceRange | undefined;
  partSerialNumber: string;
  measuredValue: number;
  measuredValueRange?: QifSourceRange | undefined;
  actualFeatureSize?: number | undefined;
  deviationVector?: [number, number, number] | undefined;
  status: QifActualStatus;
  range: QifSourceRange;
}

export interface QifDocument {
  qpId: string;
  version: string;
  header: QifHeader;
  datumDefinitions: QifDatumDefinition[];
  features: QifFeature[];
  characteristics: QifCharacteristic[];
  devices: QifMeasurementDevice[];
  rules: QifRules;
  planSteps: QifPlanStep[];
  actuals: QifCharacteristicActual[];
  sourceUri?: string | undefined;
  range: QifSourceRange;
}
