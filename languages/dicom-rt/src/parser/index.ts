// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/dicom-rt — Unified DICOM-RT XML, DICOM PS3.18 JSON, and DSL Parser.
 *
 * Parses DICOM-RT treatment plans (`<DicomRtPlan>`), structure sets (`<StructureSet>`,
 * `<ROI>`, `<Contour>`), beam sequences (`<BeamSequence>`, `<Beam>`, `<ControlPoint>`,
 * `<MLCLeafPair>`), dose distributions (`<DoseDistribution>`, `<DVH>`), and DICOM PS3.18
 * JSON representations with exact line/column/offset source tracking.
 */

import { parseXml, type XmlAttribute, type XmlElement } from "@modelscript/dsl/xml";
import type {
  ContourGeometricType,
  DicomRtDocument,
  DicomRtSourceRange,
  MlcLeafPair,
  RoiInterpretedType,
  RtBeam,
  RtBeamModality,
  RtContourSlice,
  RtControlPoint,
  RtDoseBin,
  RtRoiStructure,
  RtTreatmentDeliveryType,
} from "../types.js";

export function computeLineOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

export function offsetToLineCol(offset: number, lineOffsets: number[]): { line: number; column: number } {
  const clamped = Math.max(0, offset);
  let low = 0;
  let high = lineOffsets.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const midVal = lineOffsets[mid] ?? 0;
    if (midVal <= clamped) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const lineIndex = Math.max(0, low - 1);
  const lineStart = lineOffsets[lineIndex] ?? 0;
  return {
    line: lineIndex + 1,
    column: clamped - lineStart + 1,
  };
}

export function makeRange(startOffset: number, endOffset: number, lineOffsets: number[]): DicomRtSourceRange {
  const start = offsetToLineCol(startOffset, lineOffsets);
  const end = offsetToLineCol(Math.max(startOffset, endOffset), lineOffsets);
  return {
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
    startOffset,
    endOffset: Math.max(startOffset, endOffset),
  };
}

export function parseDicomRt(text: string, uri?: string): DicomRtDocument {
  const trimmed = text.trim();
  const lineOffsets = computeLineOffsets(text);
  const fullRange = makeRange(0, text.length, lineOffsets);

  if (trimmed.length === 0) {
    return createEmptyDocument(fullRange, uri);
  }

  if (trimmed.startsWith("{")) {
    return parseDicomRtJson(text, lineOffsets, fullRange, uri);
  }

  if (trimmed.startsWith("<")) {
    return parseDicomRtXml(text, lineOffsets, fullRange, uri);
  }

  return parseDicomRtDsl(text, lineOffsets, fullRange, uri);
}

function createEmptyDocument(range: DicomRtSourceRange, uri?: string): DicomRtDocument {
  const doc: DicomRtDocument = {
    planId: "RTPLAN-001",
    planLabel: "DefaultPlan",
    patientId: "PATIENT-001",
    frameOfReferenceUid: "1.2.840.10008.5.1.4.1.1.481.3.1",
    prescribedDoseGy: 60.0,
    fractions: 30,
    structures: [],
    beams: [],
    dvhs: [],
    range,
  };
  if (uri !== undefined) {
    doc.uri = uri;
  }
  return doc;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. DICOM-RT XML Parser
// ─────────────────────────────────────────────────────────────────────────────

function localName(tag: string): string {
  const idx = tag.indexOf(":");
  return idx >= 0 ? tag.slice(idx + 1) : tag;
}

function matchTag(el: XmlElement, name: string): boolean {
  return localName(el.name).toLowerCase() === name.toLowerCase();
}

function getAttr(el: XmlElement, name: string): string | undefined {
  const target = name.toLowerCase();
  const attr = el.attributes.find(
    (a: XmlAttribute) => localName(a.name).toLowerCase() === target || a.name.toLowerCase() === target,
  );
  return attr?.value;
}

function getChild(el: XmlElement | null | undefined, name: string): XmlElement | undefined {
  if (!el) return undefined;
  return el.children.find((c: XmlElement) => matchTag(c, name));
}

function findDescendants(el: XmlElement | null | undefined, predicate: (e: XmlElement) => boolean): XmlElement[] {
  const res: XmlElement[] = [];
  if (!el) return res;
  for (const c of el.children) {
    if (predicate(c)) res.push(c);
    res.push(...findDescendants(c, predicate));
  }
  return res;
}

function getChildText(el: XmlElement | null | undefined, name: string): string | undefined {
  const child = getChild(el, name);
  return child ? child.text.trim() : undefined;
}

function parseDicomRtXml(
  text: string,
  lineOffsets: number[],
  fullRange: DicomRtSourceRange,
  uri?: string,
): DicomRtDocument {
  if (
    !text.includes(">") ||
    (text.includes("<DicomRtPlan") && !text.includes("</DicomRtPlan>") && !/<DicomRtPlan\b[^<>]*\/>/i.test(text))
  ) {
    throw new Error("Malformed DICOM-RT XML document: unclosed <DicomRtPlan> element.");
  }

  const parsed = parseXml(text);
  if (!parsed.root) {
    throw new Error("Malformed DICOM-RT XML document: unclosed <DicomRtPlan> element.");
  }

  const rootElement =
    matchTag(parsed.root, "DicomRtPlan") || matchTag(parsed.root, "RTPlan")
      ? parsed.root
      : (findDescendants(parsed.root, (e) => matchTag(e, "DicomRtPlan") || matchTag(e, "RTPlan"))[0] ?? parsed.root);

  const doc = createEmptyDocument(fullRange, uri);

  // Extract root <DicomRtPlan> or <RTPlan> attributes / child tags
  const planId =
    getAttr(rootElement, "planId") ??
    getAttr(rootElement, "id") ??
    getAttr(rootElement, "sopInstanceUid") ??
    getChildText(rootElement, "PlanId") ??
    getChildText(rootElement, "RTPlanName");
  if (planId) doc.planId = planId;

  const planLabel =
    getAttr(rootElement, "planLabel") ??
    getAttr(rootElement, "label") ??
    getAttr(rootElement, "name") ??
    getChildText(rootElement, "PlanLabel") ??
    getChildText(rootElement, "RTPlanLabel");
  if (planLabel) doc.planLabel = planLabel;

  const patientId =
    getAttr(rootElement, "patientId") ??
    getAttr(rootElement, "patient") ??
    getChildText(rootElement, "PatientId") ??
    getChildText(rootElement, "PatientID");
  if (patientId) doc.patientId = patientId;

  const forUid =
    getAttr(rootElement, "frameOfReferenceUid") ??
    getAttr(rootElement, "forUid") ??
    getChildText(rootElement, "FrameOfReferenceUID") ??
    getChildText(rootElement, "FrameOfReferenceUid");
  if (forUid) doc.frameOfReferenceUid = forUid;

  const structForUid = getAttr(rootElement, "structFrameOfReferenceUid");
  if (structForUid) doc.structFrameOfReferenceUid = structForUid;

  const doseForUid = getAttr(rootElement, "doseFrameOfReferenceUid");
  if (doseForUid) doc.doseFrameOfReferenceUid = doseForUid;

  const rxDose =
    getAttr(rootElement, "prescribedDoseGy") ??
    getAttr(rootElement, "prescribedDose") ??
    getAttr(rootElement, "targetDoseGy") ??
    getChildText(rootElement, "PrescribedDoseGy") ??
    getChildText(rootElement, "TargetPrescriptionDose");
  if (rxDose !== undefined && !Number.isNaN(Number(rxDose))) {
    doc.prescribedDoseGy = Number(rxDose);
  }

  const fractions =
    getAttr(rootElement, "fractions") ??
    getAttr(rootElement, "numberOfFractions") ??
    getAttr(rootElement, "numberOfFractionsPlanned") ??
    getChildText(rootElement, "Fractions") ??
    getChildText(rootElement, "NumberOfFractionsPlanned");
  if (fractions !== undefined && !Number.isNaN(Number(fractions))) {
    doc.fractions = Number(fractions);
  }

  // Check <StructureSet> frameOfReferenceUid
  const structSetEl = findDescendants(rootElement, (e) => matchTag(e, "StructureSet"))[0];
  if (structSetEl) {
    const sForUid =
      getAttr(structSetEl, "frameOfReferenceUid") ??
      getAttr(structSetEl, "structFrameOfReferenceUid") ??
      getAttr(structSetEl, "forUid");
    if (sForUid) {
      doc.structFrameOfReferenceUid = sForUid;
    }
  }

  // Parse <ROI> elements
  const roiElements = findDescendants(rootElement, (e) => matchTag(e, "ROI"));
  for (const roiEl of roiElements) {
    const range = makeRange(roiEl.start, roiEl.end, lineOffsets);

    const roiNumberStr =
      getAttr(roiEl, "roiNumber") ??
      getAttr(roiEl, "number") ??
      getAttr(roiEl, "id") ??
      getChildText(roiEl, "ROINumber") ??
      String(doc.structures.length + 1);
    const roiNumber = Number(roiNumberStr.replace(/\D+/g, "")) || doc.structures.length + 1;
    const name = (
      getAttr(roiEl, "name") ??
      getAttr(roiEl, "roiName") ??
      getChildText(roiEl, "ROIName") ??
      getChildText(roiEl, "Name") ??
      `ROI_${roiNumber}`
    ).trim();

    const typeRaw =
      getAttr(roiEl, "interpretedType") ??
      getAttr(roiEl, "type") ??
      getAttr(roiEl, "rtRoiInterpretedType") ??
      getChildText(roiEl, "RTROIInterpretedType") ??
      getChildText(roiEl, "InterpretedType") ??
      inferRoiTypeFromName(name);
    const interpretedType = normalizeRoiType(typeRaw);

    const volStr =
      getAttr(roiEl, "volumeCc") ??
      getAttr(roiEl, "volume") ??
      getChildText(roiEl, "VolumeCc") ??
      getChildText(roiEl, "ROIVolume") ??
      "0";
    const volumeCc = Number(volStr) || 0;

    const colorRaw =
      getAttr(roiEl, "color") ?? getAttr(roiEl, "displayColor") ?? getChildText(roiEl, "ROIDisplayColor");
    const color = parseColorRgb(colorRaw);

    const maxLimitStr =
      getAttr(roiEl, "maxDoseLimitGy") ??
      getAttr(roiEl, "maxDoseLimit") ??
      getAttr(roiEl, "maxDoseGy") ??
      getChildText(roiEl, "MaxDoseLimitGy");
    const meanLimitStr =
      getAttr(roiEl, "meanDoseLimitGy") ??
      getAttr(roiEl, "meanDoseLimit") ??
      getAttr(roiEl, "meanDoseGy") ??
      getChildText(roiEl, "MeanDoseLimitGy");

    const contours = parseXmlContoursFromEl(roiEl, lineOffsets);

    const roi: RtRoiStructure = {
      roiNumber,
      name,
      interpretedType,
      volumeCc,
      contours,
      range,
    };
    if (color) roi.color = color;
    if (maxLimitStr !== undefined && maxLimitStr.trim() !== "" && !Number.isNaN(Number(maxLimitStr))) {
      roi.maxDoseLimitGy = Number(maxLimitStr);
    }
    if (meanLimitStr !== undefined && meanLimitStr.trim() !== "" && !Number.isNaN(Number(meanLimitStr))) {
      roi.meanDoseLimitGy = Number(meanLimitStr);
    }

    doc.structures.push(roi);
  }

  // Parse <Beam> elements
  const beamElements = findDescendants(rootElement, (e) => matchTag(e, "Beam"));
  for (const beamEl of beamElements) {
    const range = makeRange(beamEl.start, beamEl.end, lineOffsets);

    const beamNumStr =
      getAttr(beamEl, "beamNumber") ??
      getAttr(beamEl, "number") ??
      getAttr(beamEl, "id") ??
      getChildText(beamEl, "BeamNumber") ??
      String(doc.beams.length + 1);
    const beamNumber = Number(beamNumStr.replace(/\D+/g, "")) || doc.beams.length + 1;
    const name = (
      getAttr(beamEl, "name") ??
      getAttr(beamEl, "beamName") ??
      getChildText(beamEl, "BeamName") ??
      getChildText(beamEl, "Name") ??
      `Beam_${beamNumber}`
    ).trim();

    const modRaw =
      getAttr(beamEl, "modality") ??
      getAttr(beamEl, "radiationType") ??
      getChildText(beamEl, "RadiationType") ??
      getChildText(beamEl, "Modality") ??
      "PHOTON";
    const modality = normalizeModality(modRaw);

    const delivRaw =
      getAttr(beamEl, "treatmentDeliveryType") ??
      getAttr(beamEl, "deliveryType") ??
      getChildText(beamEl, "TreatmentDeliveryType") ??
      "TREATMENT";
    const treatmentDeliveryType = normalizeDeliveryType(delivRaw);

    const energyStr =
      getAttr(beamEl, "energyMeV") ??
      getAttr(beamEl, "energy") ??
      getAttr(beamEl, "nominalBeamEnergy") ??
      getChildText(beamEl, "NominalBeamEnergy") ??
      getChildText(beamEl, "EnergyMeV") ??
      "6.0";
    const energyMeV = Number(energyStr);

    const muStr =
      getAttr(beamEl, "metersetMu") ??
      getAttr(beamEl, "beamMeterset") ??
      getAttr(beamEl, "mu") ??
      getAttr(beamEl, "meterset") ??
      getChildText(beamEl, "BeamMeterset") ??
      getChildText(beamEl, "MetersetMu") ??
      "100.0";
    const metersetMu = Number(muStr);

    const doseRateStr =
      getAttr(beamEl, "doseRateMuPerMin") ??
      getAttr(beamEl, "doseRate") ??
      getAttr(beamEl, "nominalDoseRate") ??
      getChildText(beamEl, "DoseRateSet") ??
      getChildText(beamEl, "DoseRateMuPerMin") ??
      "600.0";
    const doseRateMuPerMin = Number(doseRateStr) || 600.0;

    const controlPoints = parseXmlControlPointsFromEl(beamEl, lineOffsets);

    const beam: RtBeam = {
      beamNumber,
      name,
      modality,
      treatmentDeliveryType,
      energyMeV: Number.isNaN(energyMeV) ? 0 : energyMeV,
      metersetMu: Number.isNaN(metersetMu) ? 0 : metersetMu,
      doseRateMuPerMin,
      controlPoints,
      range,
    };

    doc.beams.push(beam);
  }

  // Check <DoseDistribution> frameOfReferenceUid
  const doseDistEl = findDescendants(rootElement, (e) => matchTag(e, "DoseDistribution"))[0];
  if (doseDistEl) {
    const dForUid =
      getAttr(doseDistEl, "frameOfReferenceUid") ??
      getAttr(doseDistEl, "doseFrameOfReferenceUid") ??
      getAttr(doseDistEl, "forUid");
    if (dForUid) {
      doc.doseFrameOfReferenceUid = dForUid;
    }
  }

  // Parse <DVH> elements
  const dvhElements = findDescendants(rootElement, (e) => matchTag(e, "DVH"));
  for (const dvhEl of dvhElements) {
    const range = makeRange(dvhEl.start, dvhEl.end, lineOffsets);

    const roiNumStr =
      getAttr(dvhEl, "roiNumber") ??
      getAttr(dvhEl, "referencedRoiNumber") ??
      getAttr(dvhEl, "roi") ??
      getChildText(dvhEl, "ReferencedROINumber") ??
      String(doc.dvhs.length + 1);
    const roiNumber = Number(roiNumStr.replace(/\D+/g, "")) || doc.dvhs.length + 1;
    const matchedStruct = doc.structures.find((s) => s.roiNumber === roiNumber);
    const roiName = (
      getAttr(dvhEl, "roiName") ??
      getAttr(dvhEl, "name") ??
      getChildText(dvhEl, "ROIName") ??
      matchedStruct?.name ??
      `ROI_${roiNumber}`
    ).trim();

    const bins = parseXmlDvhBinsFromEl(dvhEl);
    const interpolated = computeMetricsFromBins(bins);

    const d98Gy =
      parseOptionalNum(getAttr(dvhEl, "d98Gy") ?? getAttr(dvhEl, "d98") ?? getChildText(dvhEl, "D98Gy")) ??
      interpolated.d98Gy;
    const d95Gy =
      parseOptionalNum(getAttr(dvhEl, "d95Gy") ?? getAttr(dvhEl, "d95") ?? getChildText(dvhEl, "D95Gy")) ??
      interpolated.d95Gy;
    const d50Gy =
      parseOptionalNum(getAttr(dvhEl, "d50Gy") ?? getAttr(dvhEl, "d50") ?? getChildText(dvhEl, "D50Gy")) ??
      interpolated.d50Gy;
    const d2Gy =
      parseOptionalNum(getAttr(dvhEl, "d2Gy") ?? getAttr(dvhEl, "d2") ?? getChildText(dvhEl, "D2Gy")) ??
      interpolated.d2Gy;
    const meanDoseGy =
      parseOptionalNum(
        getAttr(dvhEl, "meanDoseGy") ??
          getAttr(dvhEl, "meanDose") ??
          getAttr(dvhEl, "mean") ??
          getChildText(dvhEl, "DVHMeanDose"),
      ) ?? interpolated.meanDoseGy;
    const maxDoseGy =
      parseOptionalNum(
        getAttr(dvhEl, "maxDoseGy") ??
          getAttr(dvhEl, "maxDose") ??
          getAttr(dvhEl, "max") ??
          getChildText(dvhEl, "DVHMaximumDose"),
      ) ?? interpolated.maxDoseGy;
    const minDoseGy =
      parseOptionalNum(
        getAttr(dvhEl, "minDoseGy") ??
          getAttr(dvhEl, "minDose") ??
          getAttr(dvhEl, "min") ??
          getChildText(dvhEl, "DVHMinimumDose"),
      ) ?? interpolated.minDoseGy;
    const v20GyPercent =
      parseOptionalNum(
        getAttr(dvhEl, "v20GyPercent") ??
          getAttr(dvhEl, "v20Gy") ??
          getAttr(dvhEl, "v20") ??
          getChildText(dvhEl, "V20GyPercent"),
      ) ?? interpolated.v20GyPercent;

    const finalBins =
      bins.length > 0 ? bins : synthesizeBinsFromSummary({ minDoseGy, d98Gy, d95Gy, d50Gy, d2Gy, maxDoseGy });

    doc.dvhs.push({
      roiNumber,
      roiName,
      d98Gy,
      d95Gy,
      d50Gy,
      d2Gy,
      meanDoseGy,
      maxDoseGy,
      minDoseGy,
      v20GyPercent,
      bins: finalBins,
      range,
    });
  }

  return doc;
}

function parseXmlContoursFromEl(roiEl: XmlElement, lineOffsets: number[]): RtContourSlice[] {
  const slices: RtContourSlice[] = [];
  const contourElements = findDescendants(roiEl, (e) => matchTag(e, "Contour"));
  for (const cEl of contourElements) {
    const range = makeRange(cEl.start, cEl.end, lineOffsets);
    const zAttr = getAttr(cEl, "z") ?? getAttr(cEl, "sliceZ") ?? getChildText(cEl, "Z");
    const geomRaw =
      getAttr(cEl, "geometricType") ??
      getAttr(cEl, "type") ??
      getChildText(cEl, "ContourGeometricType") ??
      "CLOSED_PLANAR";
    const geometricType = normalizeGeometricType(geomRaw);

    const defaultZ = zAttr !== undefined && !Number.isNaN(Number(zAttr)) ? Number(zAttr) : 0;
    const pointsAttr = getAttr(cEl, "points") ?? getAttr(cEl, "contourData") ?? getChildText(cEl, "ContourData");
    const points = parseContourPointsFromEl(cEl, pointsAttr, defaultZ);
    const z = zAttr !== undefined && !Number.isNaN(Number(zAttr)) ? Number(zAttr) : (points[0]?.[2] ?? 0);

    slices.push({
      z,
      geometricType,
      points,
      range,
    });
  }
  return slices;
}

function parseContourPointsFromEl(
  cEl: XmlElement,
  pointsAttr: string | undefined,
  defaultZ: number,
): [number, number, number][] {
  const points: [number, number, number][] = [];

  const pointEls = findDescendants(cEl, (e) => matchTag(e, "Point"));
  if (pointEls.length > 0) {
    for (const p of pointEls) {
      const x = Number(getAttr(p, "x") ?? "0");
      const y = Number(getAttr(p, "y") ?? "0");
      const z = getAttr(p, "z") !== undefined ? Number(getAttr(p, "z")) : defaultZ;
      if (!Number.isNaN(x) && !Number.isNaN(y) && !Number.isNaN(z)) {
        points.push([x, y, z]);
      }
    }
    if (points.length > 0) return points;
  }

  const raw = pointsAttr ?? cEl.text;
  return parseContourPoints(raw, defaultZ);
}

function parseContourPoints(raw: string, defaultZ: number): [number, number, number][] {
  const points: [number, number, number][] = [];
  const cleaned = stripTags(raw).trim();
  if (!cleaned) return points;

  if (cleaned.includes(";")) {
    const segments = cleaned
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const seg of segments) {
      const nums = seg
        .split(/[\s,\\]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number)
        .filter((n) => !Number.isNaN(n));
      if (nums.length >= 3) {
        points.push([nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? defaultZ]);
      } else if (nums.length === 2) {
        points.push([nums[0] ?? 0, nums[1] ?? 0, defaultZ]);
      }
    }
    return points;
  }

  const nums = cleaned
    .split(/[\s,\\]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !Number.isNaN(n));

  for (let i = 0; i + 2 < nums.length; i += 3) {
    points.push([nums[i] ?? 0, nums[i + 1] ?? 0, nums[i + 2] ?? defaultZ]);
  }

  return points;
}

function parseXmlControlPointsFromEl(beamEl: XmlElement, lineOffsets: number[]): RtControlPoint[] {
  const cps: RtControlPoint[] = [];
  const cpElements = findDescendants(beamEl, (e) => matchTag(e, "ControlPoint"));
  for (const cpEl of cpElements) {
    const range = makeRange(cpEl.start, cpEl.end, lineOffsets);

    const idxStr =
      getAttr(cpEl, "index") ??
      getAttr(cpEl, "controlPointIndex") ??
      getChildText(cpEl, "ControlPointIndex") ??
      String(cps.length);
    const index = Number(idxStr);

    const weightStr =
      getAttr(cpEl, "cumulativeMetersetWeight") ??
      getAttr(cpEl, "cumMetersetWeight") ??
      getAttr(cpEl, "weight") ??
      getChildText(cpEl, "CumulativeMetersetWeight") ??
      "0.0";
    const cumulativeMetersetWeight = Number(weightStr);

    const gantryStr =
      getAttr(cpEl, "gantryAngleDeg") ??
      getAttr(cpEl, "gantryAngle") ??
      getAttr(cpEl, "gantry") ??
      getChildText(cpEl, "GantryAngle") ??
      "0.0";
    const gantryAngleDeg = Number(gantryStr) || 0;

    const collStr =
      getAttr(cpEl, "collimatorAngleDeg") ??
      getAttr(cpEl, "collimatorAngle") ??
      getAttr(cpEl, "beamLimitingDeviceAngle") ??
      getAttr(cpEl, "collimator") ??
      getChildText(cpEl, "BeamLimitingDeviceAngle") ??
      "0.0";
    const collimatorAngleDeg = Number(collStr) || 0;

    const couchStr =
      getAttr(cpEl, "couchAngleDeg") ??
      getAttr(cpEl, "couchAngle") ??
      getAttr(cpEl, "patientSupportAngle") ??
      getAttr(cpEl, "couch") ??
      getChildText(cpEl, "PatientSupportAngle") ??
      "0.0";
    const couchAngleDeg = Number(couchStr) || 0;

    const jawX = parsePairMm(
      getAttr(cpEl, "jawX_mm") ?? getAttr(cpEl, "jawX") ?? getChildText(cpEl, "JawX"),
      getAttr(cpEl, "jawX1"),
      getAttr(cpEl, "jawX2"),
      [-50, 50],
    );
    const jawY = parsePairMm(
      getAttr(cpEl, "jawY_mm") ?? getAttr(cpEl, "jawY") ?? getChildText(cpEl, "JawY"),
      getAttr(cpEl, "jawY1"),
      getAttr(cpEl, "jawY2"),
      [-50, 50],
    );

    const mlcLeaves = parseXmlMlcLeavesFromEl(cpEl, lineOffsets);

    cps.push({
      index: Number.isNaN(index) ? cps.length : index,
      cumulativeMetersetWeight: Number.isNaN(cumulativeMetersetWeight) ? 0 : cumulativeMetersetWeight,
      gantryAngleDeg,
      collimatorAngleDeg,
      couchAngleDeg,
      jawX_mm: jawX,
      jawY_mm: jawY,
      mlcLeaves,
      range,
    });
  }
  return cps;
}

function parseXmlMlcLeavesFromEl(cpEl: XmlElement, lineOffsets: number[]): MlcLeafPair[] {
  const leaves: MlcLeafPair[] = [];
  const leafElements = findDescendants(cpEl, (e) => {
    const t = localName(e.name).toLowerCase();
    return t === "mlcleafpair" || t === "leafpair";
  });
  for (const leafEl of leafElements) {
    const range = makeRange(leafEl.start, leafEl.end, lineOffsets);
    const pairIdxStr =
      getAttr(leafEl, "pairIndex") ?? getAttr(leafEl, "index") ?? getAttr(leafEl, "pair") ?? String(leaves.length + 1);
    const bankAStr = getAttr(leafEl, "bankA_mm") ?? getAttr(leafEl, "bankA") ?? getAttr(leafEl, "a") ?? "-20.0";
    const bankBStr = getAttr(leafEl, "bankB_mm") ?? getAttr(leafEl, "bankB") ?? getAttr(leafEl, "b") ?? "20.0";

    leaves.push({
      pairIndex: Number(pairIdxStr) || leaves.length + 1,
      bankA_mm: Number(bankAStr) || 0,
      bankB_mm: Number(bankBStr) || 0,
      range,
    });
  }
  return leaves;
}

function parseXmlDvhBinsFromEl(dvhEl: XmlElement): RtDoseBin[] {
  const bins: RtDoseBin[] = [];
  const binElements = findDescendants(dvhEl, (e) => {
    const t = localName(e.name).toLowerCase();
    return t === "dosebin" || t === "bin" || t === "dvhbin";
  });
  for (const b of binElements) {
    const doseGy = Number(getAttr(b, "doseGy") ?? getAttr(b, "dose") ?? "0");
    const volumePercent = Number(getAttr(b, "volumePercent") ?? getAttr(b, "volume") ?? getAttr(b, "pct") ?? "0");
    if (!Number.isNaN(doseGy) && !Number.isNaN(volumePercent)) {
      bins.push({ doseGy, volumePercent });
    }
  }
  if (bins.length > 0) return bins;

  const rawText =
    getAttr(dvhEl, "bins") ??
    getAttr(dvhEl, "dvhData") ??
    getChildText(dvhEl, "DVHData") ??
    stripTags(dvhEl.text).trim();
  if (!rawText) return bins;

  if (rawText.includes(";")) {
    for (const seg of rawText.split(";")) {
      const parts = seg
        .trim()
        .split(/[\s,:]+/)
        .filter(Boolean)
        .map(Number);
      if (parts.length >= 2 && !Number.isNaN(parts[0]!) && !Number.isNaN(parts[1]!)) {
        bins.push({ doseGy: parts[0]!, volumePercent: parts[1]! });
      }
    }
    return bins;
  }

  const nums = rawText
    .split(/[\s,\\]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
  let cumDose = 0;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const dStepOrDose = nums[i]!;
    const vol = nums[i + 1]!;
    cumDose = i === 0 ? dStepOrDose : cumDose + dStepOrDose;
    bins.push({ doseGy: dStepOrDose >= cumDose ? dStepOrDose : cumDose, volumePercent: vol });
  }
  return bins;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. DICOM PS3.18 JSON & Direct JSON Parser
// ─────────────────────────────────────────────────────────────────────────────

function parseDicomRtJson(
  text: string,
  lineOffsets: number[],
  fullRange: DicomRtSourceRange,
  uri?: string,
): DicomRtDocument {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch (err: unknown) {
    throw new Error(`Malformed DICOM-RT JSON: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    });
  }

  const doc = createEmptyDocument(fullRange, uri);

  // Detect DICOM PS3.18 Tag JSON format (e.g. "300A0002", "00100020", "00200052", "30060020", "300A00B0")
  const isPs318 =
    "300A0002" in raw ||
    "300A00B0" in raw ||
    "30060020" in raw ||
    "00100020" in raw ||
    "00200052" in raw ||
    "30040050" in raw;

  if (isPs318) {
    return parsePs318DicomJson(raw, text, lineOffsets, fullRange, uri);
  }

  if (typeof raw["planId"] === "string") doc.planId = raw["planId"];
  if (typeof raw["planLabel"] === "string") doc.planLabel = raw["planLabel"];
  if (typeof raw["patientId"] === "string") doc.patientId = raw["patientId"];
  if (typeof raw["frameOfReferenceUid"] === "string") doc.frameOfReferenceUid = raw["frameOfReferenceUid"];
  if (typeof raw["structFrameOfReferenceUid"] === "string") {
    doc.structFrameOfReferenceUid = raw["structFrameOfReferenceUid"];
  }
  if (typeof raw["doseFrameOfReferenceUid"] === "string") {
    doc.doseFrameOfReferenceUid = raw["doseFrameOfReferenceUid"];
  }
  if (typeof raw["prescribedDoseGy"] === "number") doc.prescribedDoseGy = raw["prescribedDoseGy"];
  if (typeof raw["fractions"] === "number") doc.fractions = raw["fractions"];

  if (Array.isArray(raw["structures"])) {
    for (const s of raw["structures"]) {
      if (typeof s !== "object" || s === null) continue;
      const obj = s as Record<string, unknown>;
      const roiNumber = typeof obj["roiNumber"] === "number" ? obj["roiNumber"] : doc.structures.length + 1;
      const name = typeof obj["name"] === "string" ? obj["name"] : `ROI_${roiNumber}`;
      const interpretedType = normalizeRoiType(
        typeof obj["interpretedType"] === "string" ? obj["interpretedType"] : inferRoiTypeFromName(name),
      );
      const volumeCc = typeof obj["volumeCc"] === "number" ? obj["volumeCc"] : 0;
      const sRange = findJsonKeyRange(text, name, lineOffsets) ?? fullRange;

      const contours: RtContourSlice[] = [];
      if (Array.isArray(obj["contours"])) {
        for (const c of obj["contours"]) {
          if (typeof c !== "object" || c === null) continue;
          const cObj = c as Record<string, unknown>;
          const z = typeof cObj["z"] === "number" ? cObj["z"] : 0;
          const geometricType = normalizeGeometricType(
            typeof cObj["geometricType"] === "string" ? cObj["geometricType"] : "CLOSED_PLANAR",
          );
          const pts: [number, number, number][] = [];
          if (Array.isArray(cObj["points"])) {
            for (const pt of cObj["points"]) {
              if (Array.isArray(pt) && pt.length >= 2) {
                pts.push([Number(pt[0]) || 0, Number(pt[1]) || 0, pt.length >= 3 ? Number(pt[2]) || 0 : z]);
              }
            }
          }
          contours.push({ z, geometricType, points: pts, range: sRange });
        }
      }

      const struct: RtRoiStructure = {
        roiNumber,
        name,
        interpretedType,
        volumeCc,
        contours,
        range: sRange,
      };
      if (Array.isArray(obj["color"]) && obj["color"].length === 3) {
        struct.color = [Number(obj["color"][0]) || 0, Number(obj["color"][1]) || 0, Number(obj["color"][2]) || 0];
      }
      if (typeof obj["maxDoseLimitGy"] === "number") struct.maxDoseLimitGy = obj["maxDoseLimitGy"];
      if (typeof obj["meanDoseLimitGy"] === "number") struct.meanDoseLimitGy = obj["meanDoseLimitGy"];
      doc.structures.push(struct);
    }
  }

  if (Array.isArray(raw["beams"])) {
    for (const b of raw["beams"]) {
      if (typeof b !== "object" || b === null) continue;
      const obj = b as Record<string, unknown>;
      const beamNumber = typeof obj["beamNumber"] === "number" ? obj["beamNumber"] : doc.beams.length + 1;
      const name = typeof obj["name"] === "string" ? obj["name"] : `Beam_${beamNumber}`;
      const bRange = findJsonKeyRange(text, name, lineOffsets) ?? fullRange;
      const modality = normalizeModality(typeof obj["modality"] === "string" ? obj["modality"] : "PHOTON");
      const treatmentDeliveryType = normalizeDeliveryType(
        typeof obj["treatmentDeliveryType"] === "string" ? obj["treatmentDeliveryType"] : "TREATMENT",
      );
      const energyMeV = typeof obj["energyMeV"] === "number" ? obj["energyMeV"] : 6.0;
      const metersetMu = typeof obj["metersetMu"] === "number" ? obj["metersetMu"] : 100.0;
      const doseRateMuPerMin = typeof obj["doseRateMuPerMin"] === "number" ? obj["doseRateMuPerMin"] : 600.0;

      const controlPoints: RtControlPoint[] = [];
      if (Array.isArray(obj["controlPoints"])) {
        for (const cp of obj["controlPoints"]) {
          if (typeof cp !== "object" || cp === null) continue;
          const cpObj = cp as Record<string, unknown>;
          const index = typeof cpObj["index"] === "number" ? cpObj["index"] : controlPoints.length;
          const cumulativeMetersetWeight =
            typeof cpObj["cumulativeMetersetWeight"] === "number" ? cpObj["cumulativeMetersetWeight"] : 0;
          const gantryAngleDeg = typeof cpObj["gantryAngleDeg"] === "number" ? cpObj["gantryAngleDeg"] : 0;
          const collimatorAngleDeg = typeof cpObj["collimatorAngleDeg"] === "number" ? cpObj["collimatorAngleDeg"] : 0;
          const couchAngleDeg = typeof cpObj["couchAngleDeg"] === "number" ? cpObj["couchAngleDeg"] : 0;
          const jawX_mm: [number, number] =
            Array.isArray(cpObj["jawX_mm"]) && cpObj["jawX_mm"].length >= 2
              ? [Number(cpObj["jawX_mm"][0]) || 0, Number(cpObj["jawX_mm"][1]) || 0]
              : [-50, 50];
          const jawY_mm: [number, number] =
            Array.isArray(cpObj["jawY_mm"]) && cpObj["jawY_mm"].length >= 2
              ? [Number(cpObj["jawY_mm"][0]) || 0, Number(cpObj["jawY_mm"][1]) || 0]
              : [-50, 50];

          const mlcLeaves: MlcLeafPair[] = [];
          if (Array.isArray(cpObj["mlcLeaves"])) {
            for (const leaf of cpObj["mlcLeaves"]) {
              if (typeof leaf !== "object" || leaf === null) continue;
              const lObj = leaf as Record<string, unknown>;
              mlcLeaves.push({
                pairIndex: typeof lObj["pairIndex"] === "number" ? lObj["pairIndex"] : mlcLeaves.length + 1,
                bankA_mm: typeof lObj["bankA_mm"] === "number" ? lObj["bankA_mm"] : -20,
                bankB_mm: typeof lObj["bankB_mm"] === "number" ? lObj["bankB_mm"] : 20,
                range: bRange,
              });
            }
          }

          controlPoints.push({
            index,
            cumulativeMetersetWeight,
            gantryAngleDeg,
            collimatorAngleDeg,
            couchAngleDeg,
            jawX_mm,
            jawY_mm,
            mlcLeaves,
            range: bRange,
          });
        }
      }

      doc.beams.push({
        beamNumber,
        name,
        modality,
        treatmentDeliveryType,
        energyMeV,
        metersetMu,
        doseRateMuPerMin,
        controlPoints,
        range: bRange,
      });
    }
  }

  if (Array.isArray(raw["dvhs"])) {
    for (const d of raw["dvhs"]) {
      if (typeof d !== "object" || d === null) continue;
      const obj = d as Record<string, unknown>;
      const roiNumber = typeof obj["roiNumber"] === "number" ? obj["roiNumber"] : doc.dvhs.length + 1;
      const roiName =
        typeof obj["roiName"] === "string"
          ? obj["roiName"]
          : (doc.structures.find((s) => s.roiNumber === roiNumber)?.name ?? `ROI_${roiNumber}`);
      const dRange = findJsonKeyRange(text, roiName, lineOffsets) ?? fullRange;

      const bins: RtDoseBin[] = [];
      if (Array.isArray(obj["bins"])) {
        for (const b of obj["bins"]) {
          if (typeof b !== "object" || b === null) continue;
          const bObj = b as Record<string, unknown>;
          bins.push({
            doseGy: Number(bObj["doseGy"]) || 0,
            volumePercent: Number(bObj["volumePercent"]) || 0,
          });
        }
      }

      const interp = computeMetricsFromBins(bins);
      const d98Gy = typeof obj["d98Gy"] === "number" ? obj["d98Gy"] : interp.d98Gy;
      const d95Gy = typeof obj["d95Gy"] === "number" ? obj["d95Gy"] : interp.d95Gy;
      const d50Gy = typeof obj["d50Gy"] === "number" ? obj["d50Gy"] : interp.d50Gy;
      const d2Gy = typeof obj["d2Gy"] === "number" ? obj["d2Gy"] : interp.d2Gy;
      const meanDoseGy = typeof obj["meanDoseGy"] === "number" ? obj["meanDoseGy"] : interp.meanDoseGy;
      const maxDoseGy = typeof obj["maxDoseGy"] === "number" ? obj["maxDoseGy"] : interp.maxDoseGy;
      const minDoseGy = typeof obj["minDoseGy"] === "number" ? obj["minDoseGy"] : interp.minDoseGy;
      const v20GyPercent = typeof obj["v20GyPercent"] === "number" ? obj["v20GyPercent"] : interp.v20GyPercent;

      const finalBins =
        bins.length > 0 ? bins : synthesizeBinsFromSummary({ minDoseGy, d98Gy, d95Gy, d50Gy, d2Gy, maxDoseGy });

      doc.dvhs.push({
        roiNumber,
        roiName,
        d98Gy,
        d95Gy,
        d50Gy,
        d2Gy,
        meanDoseGy,
        maxDoseGy,
        minDoseGy,
        v20GyPercent,
        bins: finalBins,
        range: dRange,
      });
    }
  }

  return doc;
}

function getPs318Value<T = unknown>(obj: Record<string, unknown>, tag: string): T | undefined {
  const entry = obj[tag] ?? obj[tag.toLowerCase()];
  if (typeof entry === "object" && entry !== null && "Value" in entry) {
    const valArr = (entry as { Value?: unknown[] }).Value;
    if (Array.isArray(valArr) && valArr.length > 0) {
      const first = valArr[0];
      if (typeof first === "object" && first !== null && "Alphabetic" in first) {
        return (first as { Alphabetic: T }).Alphabetic;
      }
      return first as T;
    }
  }
  return undefined;
}

function getPs318Array<T = unknown>(obj: Record<string, unknown>, tag: string): T[] {
  const entry = obj[tag] ?? obj[tag.toLowerCase()];
  if (typeof entry === "object" && entry !== null && "Value" in entry) {
    const valArr = (entry as { Value?: unknown[] }).Value;
    if (Array.isArray(valArr)) {
      return valArr as T[];
    }
  }
  return [];
}

function parsePs318DicomJson(
  raw: Record<string, unknown>,
  text: string,
  lineOffsets: number[],
  fullRange: DicomRtSourceRange,
  uri?: string,
): DicomRtDocument {
  const doc = createEmptyDocument(fullRange, uri);

  const sopUid = getPs318Value<string>(raw, "00080018");
  const planLabel = getPs318Value<string>(raw, "300A0002");
  const planName = getPs318Value<string>(raw, "300A0003");
  const patientId = getPs318Value<string>(raw, "00100020");
  const forUid = getPs318Value<string>(raw, "00200052");

  if (planLabel) doc.planLabel = String(planLabel);
  if (planName) doc.planId = String(planName);
  else if (sopUid) doc.planId = String(sopUid);
  else if (planLabel) doc.planId = String(planLabel);
  if (patientId) doc.patientId = String(patientId);
  if (forUid) doc.frameOfReferenceUid = String(forUid);

  // DoseReferenceSequence (300A,0010) -> TargetPrescriptionDose (300A,0026)
  const doseRefSeq = getPs318Array<Record<string, unknown>>(raw, "300A0010");
  for (const dRef of doseRefSeq) {
    const rx = getPs318Value<number>(dRef, "300A0026");
    if (rx !== undefined && !Number.isNaN(Number(rx))) {
      doc.prescribedDoseGy = Number(rx);
    }
  }

  // FractionGroupSequence (300A,0070) -> NumberOfFractionsPlanned (300A,0078) & ReferencedBeamSequence (300C,0004)
  const beamMetersetByNumber = new Map<number, number>();
  const fracSeq = getPs318Array<Record<string, unknown>>(raw, "300A0070");
  for (const fg of fracSeq) {
    const nFrac = getPs318Value<number>(fg, "300A0078");
    if (nFrac !== undefined && !Number.isNaN(Number(nFrac))) {
      doc.fractions = Number(nFrac);
    }
    const refBeams = getPs318Array<Record<string, unknown>>(fg, "300C0004");
    for (const rb of refBeams) {
      const bNum = Number(getPs318Value(rb, "300C0006"));
      const bMu = Number(getPs318Value(rb, "300A0086"));
      if (!Number.isNaN(bNum) && !Number.isNaN(bMu)) {
        beamMetersetByNumber.set(bNum, bMu);
      }
    }
  }

  // StructureSetROISequence (3006,0020), ROIContourSequence (3006,0039), RTROIObservationsSequence (3006,0080)
  const roiSeq = getPs318Array<Record<string, unknown>>(raw, "30060020");
  const contourSeq = getPs318Array<Record<string, unknown>>(raw, "30060039");
  const obsSeq = getPs318Array<Record<string, unknown>>(raw, "30060080");

  const obsTypeByRoi = new Map<number, RoiInterpretedType>();
  for (const obs of obsSeq) {
    const rNum = Number(getPs318Value(obs, "30060084"));
    const rType = getPs318Value<string>(obs, "300600A4");
    if (!Number.isNaN(rNum) && rType) {
      obsTypeByRoi.set(rNum, normalizeRoiType(String(rType)));
    }
  }

  const contoursByRoi = new Map<number, { color?: [number, number, number]; slices: RtContourSlice[] }>();
  for (const rc of contourSeq) {
    const rNum = Number(getPs318Value(rc, "30060084"));
    const colorArr = getPs318Array<number>(rc, "3006002A");
    const cSeq = getPs318Array<Record<string, unknown>>(rc, "30060040");
    const slices: RtContourSlice[] = [];
    for (const cItem of cSeq) {
      const gType = normalizeGeometricType(String(getPs318Value(cItem, "30060042") ?? "CLOSED_PLANAR"));
      const dataArr = getPs318Array<number>(cItem, "30060050").map(Number);
      const pts: [number, number, number][] = [];
      for (let i = 0; i + 2 < dataArr.length; i += 3) {
        pts.push([dataArr[i] ?? 0, dataArr[i + 1] ?? 0, dataArr[i + 2] ?? 0]);
      }
      slices.push({
        z: pts[0]?.[2] ?? 0,
        geometricType: gType,
        points: pts,
        range: fullRange,
      });
    }
    const entry: { color?: [number, number, number]; slices: RtContourSlice[] } = { slices };
    if (colorArr.length >= 3) {
      entry.color = [Number(colorArr[0]) || 0, Number(colorArr[1]) || 0, Number(colorArr[2]) || 0];
    }
    if (!Number.isNaN(rNum)) {
      contoursByRoi.set(rNum, entry);
    }
  }

  for (const roiItem of roiSeq) {
    const rNum = Number(getPs318Value(roiItem, "30060022")) || doc.structures.length + 1;
    const rName = String(getPs318Value(roiItem, "30060026") ?? `ROI_${rNum}`);
    const rVol = Number(getPs318Value(roiItem, "3006002C") ?? 0) || 0;
    const rForUid = getPs318Value<string>(roiItem, "30060024");
    if (rForUid && !doc.structFrameOfReferenceUid) {
      doc.structFrameOfReferenceUid = String(rForUid);
    }
    const interpretedType = obsTypeByRoi.get(rNum) ?? inferRoiTypeFromName(rName);
    const contourInfo = contoursByRoi.get(rNum);
    const sRange = findJsonKeyRange(text, rName, lineOffsets) ?? fullRange;

    const struct: RtRoiStructure = {
      roiNumber: rNum,
      name: rName,
      interpretedType,
      volumeCc: rVol,
      contours: contourInfo?.slices ?? [],
      range: sRange,
    };
    if (contourInfo?.color) {
      struct.color = contourInfo.color;
    }
    doc.structures.push(struct);
  }

  // BeamSequence (300A,00B0)
  const beamSeq = getPs318Array<Record<string, unknown>>(raw, "300A00B0");
  for (const bItem of beamSeq) {
    const bNum = Number(getPs318Value(bItem, "300A00C0")) || doc.beams.length + 1;
    const bName = String(getPs318Value(bItem, "300A00C2") ?? `Beam_${bNum}`);
    const bRange = findJsonKeyRange(text, bName, lineOffsets) ?? fullRange;
    const radType = normalizeModality(String(getPs318Value(bItem, "300A00C6") ?? "PHOTON"));
    const delivType = normalizeDeliveryType(String(getPs318Value(bItem, "300A00CE") ?? "TREATMENT"));
    const finalMetersetWeight = Number(getPs318Value(bItem, "300A010E") ?? 1.0) || 1.0;
    const metersetMu = beamMetersetByNumber.get(bNum) ?? Number(getPs318Value(bItem, "300A0086") ?? 100.0);

    const cpSeq = getPs318Array<Record<string, unknown>>(bItem, "300A0111");
    let energyMeV = 6.0;
    let doseRateMuPerMin = 600.0;
    const controlPoints: RtControlPoint[] = [];

    for (const cpItem of cpSeq) {
      const cpIdx = Number(getPs318Value(cpItem, "300A0112") ?? controlPoints.length);
      const rawWeight = Number(getPs318Value(cpItem, "300A0134") ?? 0);
      const cumulativeMetersetWeight = finalMetersetWeight > 0 ? rawWeight / finalMetersetWeight : rawWeight;
      const cpEnergy = getPs318Value<number>(cpItem, "300A0114");
      if (cpEnergy !== undefined && !Number.isNaN(Number(cpEnergy))) {
        energyMeV = Number(cpEnergy);
      }
      const cpDoseRate = getPs318Value<number>(cpItem, "300A0115");
      if (cpDoseRate !== undefined && !Number.isNaN(Number(cpDoseRate))) {
        doseRateMuPerMin = Number(cpDoseRate);
      }

      const gantryAngleDeg = Number(getPs318Value(cpItem, "300A011E") ?? 0) || 0;
      const collimatorAngleDeg = Number(getPs318Value(cpItem, "300A0120") ?? 0) || 0;
      const couchAngleDeg = Number(getPs318Value(cpItem, "300A0122") ?? 0) || 0;

      let jawX_mm: [number, number] = [-50, 50];
      let jawY_mm: [number, number] = [-50, 50];
      const mlcLeaves: MlcLeafPair[] = [];

      const bldPosSeq = getPs318Array<Record<string, unknown>>(cpItem, "300A011A");
      for (const bld of bldPosSeq) {
        const devType = String(getPs318Value(bld, "300A00B8") ?? "").toUpperCase();
        const posArr = getPs318Array<number>(bld, "300A011C").map(Number);
        if ((devType === "X" || devType === "ASYMX") && posArr.length >= 2) {
          jawX_mm = [posArr[0] ?? -50, posArr[1] ?? 50];
        } else if ((devType === "Y" || devType === "ASYMY") && posArr.length >= 2) {
          jawY_mm = [posArr[0] ?? -50, posArr[1] ?? 50];
        } else if (devType.startsWith("MLC") && posArr.length >= 2 && posArr.length % 2 === 0) {
          const nPairs = posArr.length / 2;
          for (let p = 0; p < nPairs; p++) {
            mlcLeaves.push({
              pairIndex: p + 1,
              bankA_mm: posArr[p] ?? -20,
              bankB_mm: posArr[p + nPairs] ?? 20,
              range: bRange,
            });
          }
        }
      }

      controlPoints.push({
        index: cpIdx,
        cumulativeMetersetWeight,
        gantryAngleDeg,
        collimatorAngleDeg,
        couchAngleDeg,
        jawX_mm,
        jawY_mm,
        mlcLeaves,
        range: bRange,
      });
    }

    doc.beams.push({
      beamNumber: bNum,
      name: bName,
      modality: radType,
      treatmentDeliveryType: delivType,
      energyMeV,
      metersetMu,
      doseRateMuPerMin,
      controlPoints,
      range: bRange,
    });
  }

  // DVHSequence (3004,0050)
  const dvhSeq = getPs318Array<Record<string, unknown>>(raw, "30040050");
  for (const dvhItem of dvhSeq) {
    const refRoiSeq = getPs318Array<Record<string, unknown>>(dvhItem, "30040060");
    const rNum =
      Number(refRoiSeq[0] ? getPs318Value(refRoiSeq[0], "30060084") : getPs318Value(dvhItem, "30060084")) ||
      doc.dvhs.length + 1;
    const matchedStruct = doc.structures.find((s) => s.roiNumber === rNum);
    const roiName = matchedStruct?.name ?? `ROI_${rNum}`;
    const dataArr = getPs318Array<number>(dvhItem, "30040058").map(Number);
    const bins: RtDoseBin[] = [];
    let cumDose = 0;
    for (let i = 0; i + 1 < dataArr.length; i += 2) {
      const step = dataArr[i] ?? 0;
      const vol = dataArr[i + 1] ?? 0;
      cumDose = i === 0 ? step : cumDose + step;
      bins.push({ doseGy: cumDose, volumePercent: vol });
    }
    const interp = computeMetricsFromBins(bins);
    const meanDoseGy = Number(getPs318Value(dvhItem, "30040074") ?? interp.meanDoseGy);
    const maxDoseGy = Number(getPs318Value(dvhItem, "30040072") ?? interp.maxDoseGy);
    const minDoseGy = Number(getPs318Value(dvhItem, "30040070") ?? interp.minDoseGy);

    doc.dvhs.push({
      roiNumber: rNum,
      roiName,
      d98Gy: interp.d98Gy,
      d95Gy: interp.d95Gy,
      d50Gy: interp.d50Gy,
      d2Gy: interp.d2Gy,
      meanDoseGy,
      maxDoseGy,
      minDoseGy,
      v20GyPercent: interp.v20GyPercent,
      bins:
        bins.length > 0
          ? bins
          : synthesizeBinsFromSummary({
              minDoseGy,
              d98Gy: interp.d98Gy,
              d95Gy: interp.d95Gy,
              d50Gy: interp.d50Gy,
              d2Gy: interp.d2Gy,
              maxDoseGy,
            }),
      range: fullRange,
    });
  }

  return doc;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Declarative DSL Parser
// ─────────────────────────────────────────────────────────────────────────────

function parseDicomRtDsl(
  text: string,
  lineOffsets: number[],
  fullRange: DicomRtSourceRange,
  uri?: string,
): DicomRtDocument {
  const doc = createEmptyDocument(fullRange, uri);
  const lines = text.split(/\r?\n/);

  let currentRoi: RtRoiStructure | undefined;
  let currentBeam: RtBeam | undefined;
  let currentCp: RtControlPoint | undefined;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx] ?? "";
    const commentIdx = rawLine.indexOf("//");
    const cleanLine = commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine;
    const trimmed = cleanLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const lineStart = lineOffsets[lineIdx] ?? 0;
    const firstNonSpace = rawLine.search(/\S/);
    const startOffset = lineStart + (firstNonSpace >= 0 ? firstNonSpace : 0);
    const endOffset = lineStart + cleanLine.trimEnd().length;
    const range = makeRange(startOffset, endOffset, lineOffsets);

    const kv = parseKeyValuePairs(trimmed);
    const firstToken = (trimmed.split(/\s+/)[0] ?? "").toUpperCase();

    if (firstToken === "PLAN" || firstToken === "RTPLAN") {
      if (kv.has("planId")) doc.planId = kv.get("planId")!;
      if (kv.has("planLabel")) doc.planLabel = kv.get("planLabel")!;
      if (kv.has("patientId")) doc.patientId = kv.get("patientId")!;
      if (kv.has("frameOfReferenceUid")) doc.frameOfReferenceUid = kv.get("frameOfReferenceUid")!;
      if (kv.has("structFrameOfReferenceUid")) doc.structFrameOfReferenceUid = kv.get("structFrameOfReferenceUid")!;
      if (kv.has("doseFrameOfReferenceUid")) doc.doseFrameOfReferenceUid = kv.get("doseFrameOfReferenceUid")!;
      if (kv.has("prescribedDoseGy")) doc.prescribedDoseGy = Number(kv.get("prescribedDoseGy")) || 60.0;
      if (kv.has("fractions")) doc.fractions = Number(kv.get("fractions")) || 30;
    } else if (firstToken === "ROI") {
      const roiNumber = Number(kv.get("roiNumber") ?? kv.get("number") ?? doc.structures.length + 1);
      const name = kv.get("name") ?? `ROI_${roiNumber}`;
      const interpretedType = normalizeRoiType(
        kv.get("type") ?? kv.get("interpretedType") ?? inferRoiTypeFromName(name),
      );
      const volumeCc = Number(kv.get("volumeCc") ?? kv.get("volume") ?? "0") || 0;
      currentRoi = {
        roiNumber,
        name,
        interpretedType,
        volumeCc,
        contours: [],
        range,
      };
      if (kv.has("maxDoseLimitGy")) currentRoi.maxDoseLimitGy = Number(kv.get("maxDoseLimitGy"));
      if (kv.has("meanDoseLimitGy")) currentRoi.meanDoseLimitGy = Number(kv.get("meanDoseLimitGy"));
      doc.structures.push(currentRoi);
    } else if (firstToken === "CONTOUR" && currentRoi) {
      const z = Number(kv.get("z") ?? "0") || 0;
      const geometricType = normalizeGeometricType(kv.get("geometricType") ?? kv.get("type") ?? "CLOSED_PLANAR");
      const points = parseContourPoints(kv.get("points") ?? "", z);
      currentRoi.contours.push({ z, geometricType, points, range });
    } else if (firstToken === "BEAM") {
      const beamNumber = Number(kv.get("beamNumber") ?? kv.get("number") ?? doc.beams.length + 1);
      const name = kv.get("name") ?? `Beam_${beamNumber}`;
      currentBeam = {
        beamNumber,
        name,
        modality: normalizeModality(kv.get("modality") ?? "PHOTON"),
        treatmentDeliveryType: normalizeDeliveryType(kv.get("treatmentDeliveryType") ?? "TREATMENT"),
        energyMeV: Number(kv.get("energyMeV") ?? "6.0"),
        metersetMu: Number(kv.get("metersetMu") ?? "100.0"),
        doseRateMuPerMin: Number(kv.get("doseRateMuPerMin") ?? "600.0"),
        controlPoints: [],
        range,
      };
      doc.beams.push(currentBeam);
    } else if ((firstToken === "CONTROL_POINT" || firstToken === "CP") && currentBeam) {
      currentCp = {
        index: Number(kv.get("index") ?? currentBeam.controlPoints.length),
        cumulativeMetersetWeight: Number(kv.get("weight") ?? kv.get("cumulativeMetersetWeight") ?? "0"),
        gantryAngleDeg: Number(kv.get("gantry") ?? kv.get("gantryAngleDeg") ?? "0"),
        collimatorAngleDeg: Number(kv.get("collimator") ?? kv.get("collimatorAngleDeg") ?? "0"),
        couchAngleDeg: Number(kv.get("couch") ?? kv.get("couchAngleDeg") ?? "0"),
        jawX_mm: parsePairMm(kv.get("jawX"), undefined, undefined, [-50, 50]),
        jawY_mm: parsePairMm(kv.get("jawY"), undefined, undefined, [-50, 50]),
        mlcLeaves: [],
        range,
      };
      currentBeam.controlPoints.push(currentCp);
    } else if (firstToken === "MLC" && currentCp) {
      currentCp.mlcLeaves.push({
        pairIndex: Number(kv.get("pairIndex") ?? currentCp.mlcLeaves.length + 1),
        bankA_mm: Number(kv.get("bankA") ?? kv.get("bankA_mm") ?? "-20"),
        bankB_mm: Number(kv.get("bankB") ?? kv.get("bankB_mm") ?? "20"),
        range,
      });
    } else if (firstToken === "DVH") {
      const roiNumber = Number(kv.get("roiNumber") ?? doc.dvhs.length + 1);
      const roiName =
        kv.get("roiName") ?? doc.structures.find((s) => s.roiNumber === roiNumber)?.name ?? `ROI_${roiNumber}`;
      const d98Gy = Number(kv.get("d98Gy") ?? "0");
      const d95Gy = Number(kv.get("d95Gy") ?? "0");
      const d50Gy = Number(kv.get("d50Gy") ?? "0");
      const d2Gy = Number(kv.get("d2Gy") ?? "0");
      const meanDoseGy = Number(kv.get("meanDoseGy") ?? d50Gy);
      const maxDoseGy = Number(kv.get("maxDoseGy") ?? d2Gy);
      const minDoseGy = Number(kv.get("minDoseGy") ?? d98Gy);
      const v20GyPercent = Number(kv.get("v20GyPercent") ?? "0");
      doc.dvhs.push({
        roiNumber,
        roiName,
        d98Gy,
        d95Gy,
        d50Gy,
        d2Gy,
        meanDoseGy,
        maxDoseGy,
        minDoseGy,
        v20GyPercent,
        bins: synthesizeBinsFromSummary({ minDoseGy, d98Gy, d95Gy, d50Gy, d2Gy, maxDoseGy }),
        range,
      });
    }
  }

  return doc;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function stripTags(xml: string): string {
  let prev: string;
  let curr = xml;
  do {
    prev = curr;
    curr = curr.replace(/<[^>]+>/g, "");
  } while (curr !== prev);
  return curr;
}

function parseOptionalNum(val: string | undefined): number | undefined {
  if (val === undefined) return undefined;
  const trimmed = stripTags(val).trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isNaN(n) ? undefined : n;
}

function inferRoiTypeFromName(name: string): RoiInterpretedType {
  const upper = name.toUpperCase();
  if (upper.includes("PTV")) return "PTV";
  if (upper.includes("CTV")) return "CTV";
  if (upper.includes("GTV")) return "GTV";
  if (upper.includes("BODY") || upper.includes("EXTERNAL") || upper.includes("SKIN")) return "EXTERNAL";
  if (upper.includes("BOLUS")) return "BOLUS";
  if (upper.includes("AVOID")) return "AVOIDANCE";
  if (upper.includes("MARKER") || upper.includes("FIDUCIAL")) return "MARKER";
  return "ORGAN";
}

function normalizeRoiType(raw: string): RoiInterpretedType {
  const upper = stripTags(raw).trim().toUpperCase();
  switch (upper) {
    case "PTV":
      return "PTV";
    case "CTV":
      return "CTV";
    case "GTV":
      return "GTV";
    case "ORGAN":
    case "OAR":
      return "ORGAN";
    case "EXTERNAL":
    case "BODY":
      return "EXTERNAL";
    case "AVOIDANCE":
      return "AVOIDANCE";
    case "BOLUS":
      return "BOLUS";
    case "MARKER":
      return "MARKER";
    default:
      return inferRoiTypeFromName(upper);
  }
}

function normalizeGeometricType(raw: string): ContourGeometricType {
  const upper = stripTags(raw).trim().toUpperCase();
  if (upper === "POINT") return "POINT";
  if (upper === "OPEN_PLANAR" || upper === "OPEN") return "OPEN_PLANAR";
  return "CLOSED_PLANAR";
}

function normalizeModality(raw: string): RtBeamModality {
  const upper = stripTags(raw).trim().toUpperCase();
  if (upper.includes("PROTON")) return "PROTON";
  if (upper.includes("ELECTRON")) return "ELECTRON";
  if (upper.includes("CARBON") || upper.includes("ION")) return "CARBON_ION";
  return "PHOTON";
}

function normalizeDeliveryType(raw: string): RtTreatmentDeliveryType {
  const upper = stripTags(raw).trim().toUpperCase();
  if (upper === "SETUP" || upper === "VERIFICATION") return "SETUP";
  return "TREATMENT";
}

function parseColorRgb(raw: string | undefined): [number, number, number] | undefined {
  if (!raw) return undefined;
  const nums = stripTags(raw)
    .split(/[\s,\\]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
  if (nums.length >= 3) {
    return [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0];
  }
  return undefined;
}

function parsePairMm(
  pairStr: string | undefined,
  firstStr: string | undefined,
  secondStr: string | undefined,
  fallback: [number, number],
): [number, number] {
  if (firstStr !== undefined && secondStr !== undefined) {
    const a = Number(firstStr);
    const b = Number(secondStr);
    if (!Number.isNaN(a) && !Number.isNaN(b)) return [a, b];
  }
  if (pairStr !== undefined) {
    const nums = stripTags(pairStr)
      .replace(/[[\]()]/g, "")
      .split(/[\s,\\]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => !Number.isNaN(n));
    if (nums.length >= 2) {
      return [nums[0]!, nums[1]!];
    }
  }
  return fallback;
}

export function computeMetricsFromBins(bins: RtDoseBin[]): {
  d98Gy: number;
  d95Gy: number;
  d50Gy: number;
  d2Gy: number;
  meanDoseGy: number;
  maxDoseGy: number;
  minDoseGy: number;
  v20GyPercent: number;
} {
  if (bins.length === 0) {
    return {
      d98Gy: 0,
      d95Gy: 0,
      d50Gy: 0,
      d2Gy: 0,
      meanDoseGy: 0,
      maxDoseGy: 0,
      minDoseGy: 0,
      v20GyPercent: 0,
    };
  }

  const sorted = [...bins].sort((a, b) => a.doseGy - b.doseGy);
  const d98Gy = interpolateDoseAtVolume(sorted, 98.0);
  const d95Gy = interpolateDoseAtVolume(sorted, 95.0);
  const d50Gy = interpolateDoseAtVolume(sorted, 50.0);
  const d2Gy = interpolateDoseAtVolume(sorted, 2.0);
  const v20GyPercent = interpolateVolumeAtDose(sorted, 20.0);

  let minDoseGy = sorted[0]?.doseGy ?? 0;
  let maxDoseGy = sorted[sorted.length - 1]?.doseGy ?? 0;
  for (const b of sorted) {
    if (b.volumePercent >= 99.9) {
      minDoseGy = b.doseGy;
    }
    if (b.volumePercent > 0) {
      maxDoseGy = b.doseGy;
    }
  }

  // Compute mean dose from differential slices of cumulative DVH: integral V(D) dD / 100
  let area = 0;
  if (sorted.length > 1) {
    const first = sorted[0]!;
    if (first.doseGy > 0) {
      area += first.doseGy * ((100.0 + first.volumePercent) / 2);
    }
    for (let i = 0; i < sorted.length - 1; i++) {
      const curr = sorted[i]!;
      const next = sorted[i + 1]!;
      const dDose = Math.max(0, next.doseGy - curr.doseGy);
      const avgVol = (curr.volumePercent + next.volumePercent) / 2;
      area += dDose * avgVol;
    }
    area /= 100.0;
  } else {
    area = d50Gy;
  }

  return {
    d98Gy: round4(d98Gy),
    d95Gy: round4(d95Gy),
    d50Gy: round4(d50Gy),
    d2Gy: round4(d2Gy),
    meanDoseGy: round4(area > 0 ? area : d50Gy),
    maxDoseGy: round4(maxDoseGy),
    minDoseGy: round4(minDoseGy),
    v20GyPercent: round4(v20GyPercent),
  };
}

export function interpolateDoseAtVolume(sortedBins: RtDoseBin[], targetVolumePct: number): number {
  if (sortedBins.length === 0) return 0;
  const first = sortedBins[0]!;
  if (targetVolumePct >= first.volumePercent) {
    return first.doseGy;
  }
  for (let i = 0; i < sortedBins.length - 1; i++) {
    const b1 = sortedBins[i]!;
    const b2 = sortedBins[i + 1]!;
    if (b1.volumePercent >= targetVolumePct && b2.volumePercent <= targetVolumePct) {
      const dv = b1.volumePercent - b2.volumePercent;
      if (Math.abs(dv) < 1e-12) return b1.doseGy;
      const frac = (b1.volumePercent - targetVolumePct) / dv;
      return b1.doseGy + frac * (b2.doseGy - b1.doseGy);
    }
  }
  return sortedBins[sortedBins.length - 1]!.doseGy;
}

export function interpolateVolumeAtDose(sortedBins: RtDoseBin[], targetDoseGy: number): number {
  if (sortedBins.length === 0) return 0;
  const first = sortedBins[0]!;
  if (targetDoseGy <= first.doseGy) return first.volumePercent;
  const last = sortedBins[sortedBins.length - 1]!;
  if (targetDoseGy >= last.doseGy) return last.volumePercent;

  for (let i = 0; i < sortedBins.length - 1; i++) {
    const b1 = sortedBins[i]!;
    const b2 = sortedBins[i + 1]!;
    if (b1.doseGy <= targetDoseGy && b2.doseGy >= targetDoseGy) {
      const dd = b2.doseGy - b1.doseGy;
      if (Math.abs(dd) < 1e-12) return b1.volumePercent;
      const frac = (targetDoseGy - b1.doseGy) / dd;
      return b1.volumePercent + frac * (b2.volumePercent - b1.volumePercent);
    }
  }
  return 0;
}

function synthesizeBinsFromSummary(s: {
  minDoseGy: number;
  d98Gy: number;
  d95Gy: number;
  d50Gy: number;
  d2Gy: number;
  maxDoseGy: number;
}): RtDoseBin[] {
  return [
    { doseGy: 0, volumePercent: 100 },
    { doseGy: s.minDoseGy, volumePercent: 100 },
    { doseGy: s.d98Gy, volumePercent: 98 },
    { doseGy: s.d95Gy, volumePercent: 95 },
    { doseGy: s.d50Gy, volumePercent: 50 },
    { doseGy: s.d2Gy, volumePercent: 2 },
    { doseGy: s.maxDoseGy, volumePercent: 0 },
  ];
}

function findJsonKeyRange(text: string, needle: string, lineOffsets: number[]): DicomRtSourceRange | undefined {
  if (!needle) return undefined;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`"${escaped}"`).exec(text);
  if (!m) return undefined;
  return makeRange(m.index, m.index + m[0].length, lineOffsets);
}

function parseKeyValuePairs(line: string): Map<string, string> {
  const map = new Map<string, string>();
  const regex = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\([^)]*\))|(\[[^\]]*\])|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(line)) !== null) {
    const k = m[1];
    const v = m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6] ?? "";
    if (k) map.set(k, v);
  }
  return map;
}

function round4(val: number): number {
  return Math.round(val * 10000) / 10000;
}
