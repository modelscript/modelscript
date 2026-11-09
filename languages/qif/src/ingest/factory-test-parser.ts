// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/qif — Closed-Loop Factory Metrology & SPC Ingestion.
 *
 * Ingests factory testing logs from SMT / electronics manufacturing lines:
 *   1. In-Circuit Test (ICT) / Flying Probe electrical test records (R, L, C, V)
 *   2. Solder Paste Inspection (SPI) / Automated Optical Inspection (AOI)
 *   3. Automated X-ray Inspection (AXI) BGA voiding % records
 *
 * Normalizes raw machine logs into QIF 3.0 Document ASTs and correlates
 * factory empirical distributions (mean, stdDev, Cp, Cpk) directly with
 * ModelScript simulation parameters for closed-loop digital twin verification.
 */

import type { QifSpcSummary } from "../spc/index.js";
import type {
  QifActualStatus,
  QifCharacteristic,
  QifCharacteristicActual,
  QifDocument,
  QifFeature,
  QifMeasurementDevice,
  QifSourceRange,
} from "../types.js";

const DEFAULT_RANGE: QifSourceRange = {
  startOffset: 0,
  endOffset: 0,
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 1,
};

export interface IctRecord {
  serialNumber: string;
  testId: string; // e.g. "R12", "C45", "TP1_TP2"
  componentRef?: string | undefined;
  testType: "RESISTANCE" | "CAPACITANCE" | "INDUCTANCE" | "VOLTAGE" | "DIODE" | "OTHER";
  nominal: number;
  lowerLimit: number;
  upperLimit: number;
  measured: number;
  unit: string; // "Ohm", "uF", "pF", "mH", "V"
  status: "PASS" | "FAIL";
  timestamp?: string | undefined;
}

export interface SpiAoiRecord {
  serialNumber: string;
  componentRef: string;
  padId: string;
  pasteVolumePercent: number; // Nominal = 100%
  minVolumePercent: number;
  maxVolumePercent: number;
  offsetX_mm: number;
  offsetY_mm: number;
  rotationOffset_deg: number;
  status: "PASS" | "FAIL";
}

export interface AxiVoidingRecord {
  serialNumber: string;
  componentRef: string;
  ballPin: string;
  voidPercent: number;
  maxAllowedVoidPercent: number;
  status: "PASS" | "FAIL";
}

export interface SimulationParameterVariance {
  component: string;
  parameter: string; // e.g. "R", "C", "L"
  unit: string;
  nominal: number;
  factoryMean: number;
  factoryStdDev: number;
  cp: number;
  cpk: number;
  passRate: number;
  sampleCount: number;
  distribution: "normal" | "truncatedNormal";
}

/**
 * Parses In-Circuit Test (ICT) / Flying Probe CSV data into a normalized QIF Document.
 * Expected CSV columns (with or without headers):
 * SerialNumber, TestId, Type, Nominal, LowLimit, HighLimit, Measured, Unit, Status
 */
export function parseIctCsv(csvContent: string, partNumber = "PCBA-ASSY-001"): QifDocument {
  const lines = csvContent.trim().split(/\r?\n/);
  if (lines.length === 0) {
    throw new Error("Empty ICT CSV content.");
  }

  const records: IctRecord[] = [];
  const firstLine = lines[0] ?? "";
  const hasHeader = firstLine.toLowerCase().includes("serial") || firstLine.toLowerCase().includes("test");
  const dataLines = hasHeader ? lines.slice(1) : lines;

  for (const line of dataLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(",").map((s) => s.trim());
    if (parts.length < 7) continue;

    const sn = parts[0] ?? "";
    const testId = parts[1] ?? "";
    const rawType = parts[2] ?? "";
    const nomStr = parts[3] ?? "0";
    const lowStr = parts[4] ?? "0";
    const highStr = parts[5] ?? "0";
    const measStr = parts[6] ?? "0";
    const unit = parts[7] ?? "Ohm";
    const rawStatus = parts[8];

    if (!sn || !testId) continue;

    const typeUpper = rawType.toUpperCase();
    const testType: IctRecord["testType"] = typeUpper.includes("RES")
      ? "RESISTANCE"
      : typeUpper.includes("CAP")
        ? "CAPACITANCE"
        : typeUpper.includes("IND")
          ? "INDUCTANCE"
          : typeUpper.includes("VOLT")
            ? "VOLTAGE"
            : typeUpper.includes("DIODE")
              ? "DIODE"
              : "OTHER";

    const measuredVal = parseFloat(measStr);
    const lowVal = parseFloat(lowStr);
    const highVal = parseFloat(highStr);
    const isPass =
      rawStatus !== undefined ? rawStatus.toUpperCase() === "PASS" : measuredVal >= lowVal && measuredVal <= highVal;

    records.push({
      serialNumber: sn,
      testId,
      componentRef: testId.split("_")[0],
      testType,
      nominal: parseFloat(nomStr),
      lowerLimit: lowVal,
      upperLimit: highVal,
      measured: measuredVal,
      unit,
      status: isPass ? "PASS" : "FAIL",
    });
  }

  return convertIctRecordsToQif(records, partNumber);
}

/**
 * Converts parsed ICT records into standard QIF 3.0 AST structures.
 */
export function convertIctRecordsToQif(records: IctRecord[], partNumber: string): QifDocument {
  const device: QifMeasurementDevice = {
    id: "dev_ict_01",
    name: "Factory Flying Probe Tester",
    deviceType: "OpticalGauge",
    calibrationUncertainty: 0.001,
    range: DEFAULT_RANGE,
  };

  const featureMap = new Map<string, QifFeature>();
  const charMap = new Map<string, QifCharacteristic>();
  const actuals: QifCharacteristicActual[] = [];

  for (const rec of records) {
    const featId = `feat_${rec.testId}`;
    if (!featureMap.has(featId)) {
      featureMap.set(featId, {
        id: featId,
        qpId: featId,
        name: `Component ${rec.testId}`,
        featureType: "Point",
        isFeatureOfSize: false,
        range: DEFAULT_RANGE,
      });
    }

    const charId = `char_${rec.testId}`;
    if (!charMap.has(charId)) {
      const tolZone = rec.upperLimit - rec.lowerLimit;
      charMap.set(charId, {
        id: charId,
        qpId: charId,
        name: `${rec.testId} ${rec.testType} (${rec.unit})`,
        gdtType: "DimensionalSize",
        nominalValue: rec.nominal,
        toleranceZone: tolZone,
        upperTolerance: rec.upperLimit - rec.nominal,
        lowerTolerance: rec.lowerLimit - rec.nominal,
        materialCondition: "RFS",
        datumReferences: [],
        featureIds: [featId],
        deviceId: device.id,
        range: DEFAULT_RANGE,
      });
    }

    const qifStatus: QifActualStatus = rec.status === "PASS" ? "PASS" : "FAIL";

    actuals.push({
      id: `act_${actuals.length + 1}`,
      characteristicId: charId,
      partSerialNumber: rec.serialNumber,
      measuredValue: rec.measured,
      status: qifStatus,
      range: DEFAULT_RANGE,
    });
  }

  return {
    qpId: `qif_ict_${Date.now()}`,
    version: "3.0.0",
    header: {
      application: "ModelScript Fabless Metrology Ingest",
      author: "Factory ATE Line",
      fileUnits: "mm",
      partName: "PCBA Electrical Assembly",
      partNumber,
    },
    datumDefinitions: [],
    features: Array.from(featureMap.values()),
    characteristics: Array.from(charMap.values()),
    devices: [device],
    rules: { minPointsPerFeature: {}, minTurRatio: 4 },
    planSteps: [],
    actuals,
    range: DEFAULT_RANGE,
  };
}

/**
 * Parses Solder Paste Inspection (SPI) / Automated Optical Inspection (AOI) logs into QIF AST.
 * Columns: SerialNumber, ComponentRef, PadId, VolumePercent, MinVol, MaxVol, OffsetX, OffsetY, Status
 */
export function parseSpiAoiCsv(csvContent: string, partNumber = "PCBA-ASSY-001"): QifDocument {
  const lines = csvContent.trim().split(/\r?\n/);
  const records: SpiAoiRecord[] = [];
  const firstLine = lines[0] ?? "";
  const hasHeader = firstLine.toLowerCase().includes("serial") || firstLine.toLowerCase().includes("pad");
  const dataLines = hasHeader ? lines.slice(1) : lines;

  for (const line of dataLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(",").map((s) => s.trim());
    if (parts.length < 6) continue;

    const sn = parts[0] ?? "";
    const ref = parts[1] ?? "";
    const padId = parts[2] ?? "";
    const volStr = parts[3] ?? "100";
    const minVStr = parts[4] ?? "75";
    const maxVStr = parts[5] ?? "125";
    const offXStr = parts[6] ?? "0";
    const offYStr = parts[7] ?? "0";
    const rawStatus = parts[8];

    if (!sn || !ref || !padId) continue;

    const volNum = parseFloat(volStr);
    const minVol = parseFloat(minVStr);
    const maxVol = parseFloat(maxVStr);
    const isPass = rawStatus !== undefined ? rawStatus.toUpperCase() === "PASS" : volNum >= minVol && volNum <= maxVol;

    records.push({
      serialNumber: sn,
      componentRef: ref,
      padId,
      pasteVolumePercent: volNum,
      minVolumePercent: minVol,
      maxVolumePercent: maxVol,
      offsetX_mm: parseFloat(offXStr),
      offsetY_mm: parseFloat(offYStr),
      rotationOffset_deg: 0,
      status: isPass ? "PASS" : "FAIL",
    });
  }

  const device: QifMeasurementDevice = {
    id: "dev_spi_01",
    name: "3D Solder Paste Inspection System",
    deviceType: "OpticalGauge",
    calibrationUncertainty: 0.005,
    range: DEFAULT_RANGE,
  };

  const featureMap = new Map<string, QifFeature>();
  const charMap = new Map<string, QifCharacteristic>();
  const actuals: QifCharacteristicActual[] = [];

  for (const r of records) {
    const featId = `feat_${r.componentRef}_${r.padId}`;
    if (!featureMap.has(featId)) {
      featureMap.set(featId, {
        id: featId,
        qpId: featId,
        name: `Pad ${r.componentRef}.${r.padId}`,
        featureType: "Plane",
        isFeatureOfSize: false,
        range: DEFAULT_RANGE,
      });
    }

    const charId = `char_spi_${r.componentRef}_${r.padId}`;
    if (!charMap.has(charId)) {
      charMap.set(charId, {
        id: charId,
        qpId: charId,
        name: `${r.componentRef}.${r.padId} Paste Volume (%)`,
        gdtType: "DimensionalSize",
        nominalValue: 100, // 100% nominal paste volume
        toleranceZone: r.maxVolumePercent - r.minVolumePercent,
        upperTolerance: r.maxVolumePercent - 100,
        lowerTolerance: r.minVolumePercent - 100,
        materialCondition: "RFS",
        datumReferences: [],
        featureIds: [featId],
        deviceId: device.id,
        range: DEFAULT_RANGE,
      });
    }

    actuals.push({
      id: `act_spi_${actuals.length + 1}`,
      characteristicId: charId,
      partSerialNumber: r.serialNumber,
      measuredValue: r.pasteVolumePercent,
      status: r.status === "PASS" ? "PASS" : "FAIL",
      range: DEFAULT_RANGE,
    });
  }

  return {
    qpId: `qif_spi_${Date.now()}`,
    version: "3.0.0",
    header: {
      application: "ModelScript SPI/AOI Ingest",
      author: "Koh Young 3D SPI",
      fileUnits: "mm",
      partName: "PCBA SMT Line",
      partNumber,
    },
    datumDefinitions: [],
    features: Array.from(featureMap.values()),
    characteristics: Array.from(charMap.values()),
    devices: [device],
    rules: { minPointsPerFeature: {}, minTurRatio: 4 },
    planSteps: [],
    actuals,
    range: DEFAULT_RANGE,
  };
}

/**
 * Correlates factory SPC statistical results back into ModelScript / Modelica simulation parameters.
 * Maps empirical line variation (μ, σ, Cpk) to circuit component parameters.
 */
export function correlateSpcToSimulationParameters(spcSummary: QifSpcSummary): SimulationParameterVariance[] {
  const variances: SimulationParameterVariance[] = [];

  for (const report of spcSummary.characteristics) {
    if (report.sampleCount < 2) continue;

    // Determine component and electrical parameter from characteristic name
    // e.g. "R12 RESISTANCE (Ohm)" -> component: "R12", parameter: "R"
    // e.g. "C45 CAPACITANCE (uF)" -> component: "C45", parameter: "C"
    // e.g. "L3 INDUCTANCE (mH)"   -> component: "L3", parameter: "L"
    const nameParts = report.characteristicName.split(" ");
    const compName = nameParts[0] || report.characteristicId.replace("char_", "");
    let param = "R";
    let unit = "Ohm";

    if (report.characteristicName.includes("CAPACITANCE")) {
      param = "C";
      unit = "F";
    } else if (report.characteristicName.includes("INDUCTANCE")) {
      param = "L";
      unit = "H";
    } else if (report.characteristicName.includes("VOLTAGE")) {
      param = "V";
      unit = "V";
    }

    variances.push({
      component: compName,
      parameter: param,
      unit,
      nominal: (report.lsl + report.usl) / 2,
      factoryMean: report.mean,
      factoryStdDev: report.stdDev,
      cp: report.cp,
      cpk: report.cpk,
      passRate: report.passRate,
      sampleCount: report.sampleCount,
      distribution: report.cpk > 1.33 ? "normal" : "truncatedNormal",
    });
  }

  return variances;
}
