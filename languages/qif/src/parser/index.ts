// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/qif — Unified QIF 3.0 XML, Declarative QIF DSL, and JSON Parser.
 *
 * Parses ISO 23952 / ANSI DMSC QIF 3.0 XML documents (`<QIFDocument>`) as well as
 * concise declarative QIF DSL and JSON representations with exact line/column source ranges.
 */

import type {
  QifActualStatus,
  QifCharacteristic,
  QifCharacteristicActual,
  QifCompositeLowerTier,
  QifDatumDefinition,
  QifDatumRef,
  QifDeviceType,
  QifDocument,
  QifFeature,
  QifFeatureType,
  QifGdtType,
  QifHeader,
  QifMaterialCondition,
  QifMeasurementDevice,
  QifPlanStep,
  QifSourceRange,
} from "../types.js";

const DEFAULT_MIN_POINTS: Record<string, number> = {
  Point: 1,
  Plane: 3,
  Circle: 3,
  Slot: 4,
  Sphere: 4,
  Cylinder: 5,
  Cone: 6,
};

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

export function makeRange(startOffset: number, endOffset: number, lineOffsets: number[]): QifSourceRange {
  const start = offsetToLineCol(startOffset, lineOffsets);
  const end = offsetToLineCol(Math.max(startOffset, endOffset), lineOffsets);
  return {
    startOffset,
    endOffset: Math.max(startOffset, endOffset),
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
  };
}

const FEATURE_OF_SIZE_DEFAULTS = new Set<QifFeatureType>(["Cylinder", "Sphere", "Circle", "Slot"]);

export function isDefaultFeatureOfSize(ft: QifFeatureType): boolean {
  return FEATURE_OF_SIZE_DEFAULTS.has(ft);
}

export function parseQif(text: string, uri?: string): QifDocument {
  const trimmed = text.trim();
  const lineOffsets = computeLineOffsets(text);
  const fullRange = makeRange(0, text.length, lineOffsets);

  if (trimmed.length === 0) {
    return createEmptyDocument(fullRange, uri);
  }

  if (trimmed.startsWith("{")) {
    return parseQifJson(text, lineOffsets, fullRange, uri);
  }

  if (trimmed.startsWith("<")) {
    return parseQifXml(text, lineOffsets, fullRange, uri);
  }

  return parseQifDsl(text, lineOffsets, fullRange, uri);
}

function createEmptyDocument(range: QifSourceRange, uri?: string): QifDocument {
  return {
    qpId: "00000000-0000-4000-8000-000000000000",
    version: "3.0.0",
    header: {
      fileUnits: "mm",
    },
    datumDefinitions: [],
    features: [],
    characteristics: [],
    devices: [],
    rules: {
      minPointsPerFeature: { ...DEFAULT_MIN_POINTS },
      minTurRatio: 4.0,
    },
    planSteps: [],
    actuals: [],
    sourceUri: uri,
    range,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. XML QIF 3.0 Parser
// ─────────────────────────────────────────────────────────────────────────────

function parseQifXml(text: string, lineOffsets: number[], fullRange: QifSourceRange, uri?: string): QifDocument {
  if (
    !text.includes(">") ||
    (text.includes("<QIFDocument") && !text.includes("</QIFDocument>") && !/QIFDocument[^>]*\/>/.test(text))
  ) {
    throw new Error("Malformed QIF XML document: unclosed <QIFDocument> element.");
  }

  const doc = createEmptyDocument(fullRange, uri);

  // Extract root QIFDocument attributes & QPId
  const rootMatch = /<QIFDocument\b([^>]*)>/i.exec(text);
  if (rootMatch) {
    const attrs = parseXmlAttributes(rootMatch[1] ?? "");
    const verQif = attrs.get("versionQIF") ?? attrs.get("version");
    if (verQif) doc.version = verQif;
    const qp = attrs.get("qpId") ?? attrs.get("id");
    if (qp) doc.qpId = qp;
  }

  const firstSectionIdx = findFirstSectionIndex(text);
  const rootHeadSlice = text.slice(0, firstSectionIdx);
  const rootQpId = extractTagText(rootHeadSlice, "QPId");
  if (rootQpId) {
    doc.qpId = rootQpId;
  }

  // Parse <Header>
  const headerMatch = /<Header\b[^>]*>([\s\S]*?)<\/Header>/i.exec(text);
  if (headerMatch) {
    const hBody = headerMatch[1] ?? "";
    const hAttrs = parseXmlAttributes(headerMatch[0] ?? "");
    const authorBlock = extractTagText(hBody, "Author");
    const authorName = authorBlock ? (extractTagText(authorBlock, "Name") ?? authorBlock.trim()) : hAttrs.get("author");
    const appBlock = extractTagText(hBody, "Application");
    const appName = appBlock ? (extractTagText(appBlock, "Name") ?? appBlock.trim()) : hAttrs.get("application");
    const unitName =
      extractTagText(hBody, "UnitName") ??
      extractTagText(hBody, "SIUnitName") ??
      extractTagText(hBody, "LinearUnit") ??
      extractTagText(hBody, "FileUnits") ??
      hAttrs.get("fileUnits") ??
      "mm";
    const partName = extractTagText(hBody, "PartName") ?? hAttrs.get("partName");
    const partNumber = extractTagText(hBody, "PartNumber") ?? hAttrs.get("partNumber");

    const header: QifHeader = {
      fileUnits: unitName.trim(),
    };
    if (authorName) header.author = stripTags(authorName).trim();
    if (appName) header.application = stripTags(appName).trim();
    if (partName) header.partName = stripTags(partName).trim();
    if (partNumber) header.partNumber = stripTags(partNumber).trim();
    doc.header = header;
  }

  // Parse <DatumDefinitions> / <DatumDefinition>
  const datumRegex = /<DatumDefinition\b([^>]*)(?:\/>|>([\s\S]*?)<\/DatumDefinition>)/gi;
  let match: RegExpExecArray | null;
  while ((match = datumRegex.exec(text)) !== null) {
    const attrs = parseXmlAttributes(match[1] ?? "");
    const body = match[2] ?? "";
    const startOffset = match.index;
    const endOffset = match.index + match[0].length;
    const range = makeRange(startOffset, endOffset, lineOffsets);

    const id = attrs.get("id") ?? extractTagText(body, "Id") ?? `D_${doc.datumDefinitions.length + 1}`;
    const qpId = attrs.get("qpId") ?? extractTagText(body, "QPId");
    const label =
      attrs.get("label") ??
      attrs.get("datumLabel") ??
      extractTagText(body, "DatumLabel") ??
      extractTagText(body, "Label") ??
      id;
    const featureNominalBlock = extractTagText(body, "FeatureNominalIds") ?? body;
    const featureId =
      attrs.get("featureId") ??
      attrs.get("featureNominalId") ??
      extractTagText(featureNominalBlock, "Id") ??
      extractTagText(body, "FeatureNominalId") ??
      extractTagText(body, "FeatureId");

    const datumDef: QifDatumDefinition = {
      id: id.trim(),
      label: label.trim(),
      range,
    };
    if (qpId) datumDef.qpId = qpId.trim();
    if (featureId) datumDef.featureId = featureId.trim();
    doc.datumDefinitions.push(datumDef);
  }

  // Parse Features (<*FeatureNominal>, <*FeatureDefinition>, <Feature>)
  const featureRegex =
    /<((?:Cylinder|Plane|Sphere|Cone|Circle|Slot|OppositeParallelPlanes|Point)?Feature(?:Nominal|Definition|Item)?)\b([^>]*)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
  while ((match = featureRegex.exec(text)) !== null) {
    const tagName = match[1] ?? "Feature";
    const attrs = parseXmlAttributes(match[2] ?? "");
    const body = match[3] ?? "";
    const startOffset = match.index;
    const endOffset = match.index + match[0].length;
    const range = makeRange(startOffset, endOffset, lineOffsets);

    const ft = resolveFeatureType(
      tagName,
      attrs.get("featureType") ?? attrs.get("type") ?? extractTagText(body, "FeatureType"),
    );
    const id = attrs.get("id") ?? extractTagText(body, "Id") ?? `F_${doc.features.length + 1}`;
    const qpId = (attrs.get("qpId") ?? extractTagText(body, "QPId") ?? `qpid-${id}`).trim();
    const name = (attrs.get("name") ?? extractTagText(body, "Name") ?? id).trim();

    const explicitFos = attrs.get("isFeatureOfSize") ?? extractTagText(body, "IsFeatureOfSize");
    const isFeatureOfSize =
      explicitFos !== undefined ? explicitFos.trim().toLowerCase() === "true" : isDefaultFeatureOfSize(ft);

    const internalRaw =
      attrs.get("isInternal") ??
      attrs.get("internal") ??
      extractTagText(body, "InternalExternal") ??
      extractTagText(body, "IsInternal");
    let isInternal: boolean | undefined;
    if (internalRaw !== undefined) {
      const upper = internalRaw.trim().toUpperCase();
      if (upper === "TRUE" || upper === "INTERNAL" || upper === "BORE" || upper === "HOLE") isInternal = true;
      else if (upper === "FALSE" || upper === "EXTERNAL" || upper === "SHAFT" || upper === "BOSS") isInternal = false;
    }

    const nominalStr =
      attrs.get("nominalSize") ??
      attrs.get("diameter") ??
      attrs.get("size") ??
      extractTagText(body, "Diameter") ??
      extractTagText(body, "NominalSize") ??
      extractTagText(body, "Width") ??
      extractTagText(body, "Size");
    const radiusStr = attrs.get("radius") ?? extractTagText(body, "Radius");
    let nominalSize: number | undefined;
    if (nominalStr !== undefined && nominalStr.trim() !== "") {
      nominalSize = Number(nominalStr.trim());
    } else if (radiusStr !== undefined && radiusStr.trim() !== "") {
      nominalSize = Number(radiusStr.trim()) * 2;
    }

    const upperSizeTolStr =
      attrs.get("upperSizeTolerance") ??
      attrs.get("upperTolerance") ??
      extractTagText(body, "UpperTolerance") ??
      extractTagText(body, "UpperSizeTolerance");
    const lowerSizeTolStr =
      attrs.get("lowerSizeTolerance") ??
      attrs.get("lowerTolerance") ??
      extractTagText(body, "LowerTolerance") ??
      extractTagText(body, "LowerSizeTolerance");

    const locStr =
      attrs.get("location") ??
      extractTagText(body, "Location") ??
      extractTagText(body, "CenterPoint") ??
      extractTagText(body, "Point");
    const normStr =
      attrs.get("normal") ??
      extractTagText(body, "Normal") ??
      extractTagText(body, "AxisVector") ??
      extractTagText(body, "Direction");

    const stepId =
      attrs.get("stepEntityId") ??
      attrs.get("cadEntityId") ??
      extractTagText(body, "StepEntityId") ??
      extractTagText(body, "CADEntityId") ??
      extractTagText(body, "EntityId");

    const pointsStr =
      attrs.get("probingPoints") ??
      attrs.get("points") ??
      extractTagText(body, "ProbingPoints") ??
      extractTagText(body, "MinPoints") ??
      extractTagText(body, "PointCount");

    const feature: QifFeature = {
      id: id.trim(),
      qpId,
      name,
      featureType: ft,
      isFeatureOfSize,
      range,
    };
    if (isInternal !== undefined) feature.isInternal = isInternal;
    if (nominalSize !== undefined && !Number.isNaN(nominalSize)) feature.nominalSize = nominalSize;
    if (upperSizeTolStr !== undefined && !Number.isNaN(Number(upperSizeTolStr))) {
      feature.upperSizeTolerance = Number(upperSizeTolStr);
    }
    if (lowerSizeTolStr !== undefined && !Number.isNaN(Number(lowerSizeTolStr))) {
      feature.lowerSizeTolerance = Number(lowerSizeTolStr);
    }
    const locVec = parseVector3(locStr);
    if (locVec) feature.location = locVec;
    const normVec = parseVector3(normStr);
    if (normVec) feature.normal = normVec;
    if (stepId) feature.stepEntityId = stepId.trim();
    if (pointsStr !== undefined && !Number.isNaN(Number(pointsStr))) {
      feature.probingPoints = Number(pointsStr);
    }

    doc.features.push(feature);
  }

  // Parse Characteristics (<*CharacteristicNominal>, <*CharacteristicDefinition>, <Characteristic>)
  const charRegex =
    /<((?:Flatness|Straightness|Circularity|Cylindricity|ProfileOfSurface|ProfileOfLine|Perpendicularity|Parallelism|Angularity|Position|CircularRunout|TotalRunout|DimensionalSize|DimensionalDistance|Diameter|DistanceBetween|Geometric)?Characteristic(?:Nominal|Definition|Item)?)\b([^>]*)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
  while ((match = charRegex.exec(text)) !== null) {
    const tagName = match[1] ?? "Characteristic";
    if (/Actual$/i.test(tagName)) continue;
    const attrs = parseXmlAttributes(match[2] ?? "");
    const body = match[3] ?? "";
    const startOffset = match.index;
    const endOffset = match.index + match[0].length;
    const range = makeRange(startOffset, endOffset, lineOffsets);

    const gdtType = resolveGdtType(
      tagName,
      attrs.get("gdtType") ??
        attrs.get("type") ??
        extractTagText(body, "GdtType") ??
        extractTagText(body, "CharacteristicType"),
    );
    const id = (attrs.get("id") ?? extractTagText(body, "Id") ?? `C_${doc.characteristics.length + 1}`).trim();
    const qpId = (attrs.get("qpId") ?? extractTagText(body, "QPId") ?? `qpid-${id}`).trim();
    const name = (attrs.get("name") ?? extractTagText(body, "Name") ?? id).trim();

    const balloonStr = attrs.get("balloonNumber") ?? attrs.get("balloon") ?? extractTagText(body, "BalloonNumber");
    const nominalStr =
      attrs.get("nominalValue") ??
      attrs.get("nominal") ??
      attrs.get("targetValue") ??
      extractTagText(body, "NominalValue") ??
      extractTagText(body, "TargetValue");
    const tolStr =
      attrs.get("toleranceZone") ??
      attrs.get("toleranceValue") ??
      attrs.get("tolerance") ??
      extractTagText(body, "ToleranceValue") ??
      extractTagText(body, "ToleranceZone") ??
      extractTagText(body, "Tolerance") ??
      "0";
    const upperTolStr = attrs.get("upperTolerance") ?? attrs.get("upper") ?? extractTagText(body, "UpperTolerance");
    const lowerTolStr = attrs.get("lowerTolerance") ?? attrs.get("lower") ?? extractTagText(body, "LowerTolerance");

    const diamStr =
      attrs.get("isDiametrical") ??
      attrs.get("diametrical") ??
      extractTagText(body, "DiametricalZone") ??
      extractTagText(body, "IsDiametrical") ??
      extractTagText(body, "ZoneType");
    const isDiametrical =
      diamStr !== undefined
        ? diamStr.trim().toLowerCase() === "true" || diamStr.trim().toUpperCase() === "DIAMETRICAL"
        : gdtType === "Position" || gdtType === "DimensionalSize";

    const matRaw =
      attrs.get("materialCondition") ??
      attrs.get("materialModifier") ??
      attrs.get("material") ??
      extractTagText(body, "MaterialCondition") ??
      extractTagText(body, "MaterialModifier") ??
      "RFS";
    const materialCondition = normalizeMaterialCondition(matRaw);

    const bodyWithoutLower = body.replace(
      /<(?:CompositeLowerTier|LowerSegment)\b[\s\S]*?<\/(?:CompositeLowerTier|LowerSegment)>/gi,
      "",
    );
    const datumRefs = parseXmlDatumRefs(bodyWithoutLower, attrs.get("datumReferences") ?? attrs.get("datums"));
    const lowerTier = parseXmlCompositeLowerTier(body, attrs);
    const featureIds = parseXmlFeatureIds(body, attrs.get("featureIds") ?? attrs.get("featureId"));

    const deviceId =
      attrs.get("deviceId") ??
      attrs.get("measurementDeviceId") ??
      extractTagText(body, "MeasurementDeviceId") ??
      extractTagText(body, "DeviceId");

    const characteristic: QifCharacteristic = {
      id,
      qpId,
      name,
      gdtType,
      toleranceZone: Number(tolStr) || 0,
      isDiametrical,
      materialCondition,
      datumReferences: datumRefs,
      featureIds,
      range,
    };
    if (balloonStr !== undefined && !Number.isNaN(Number(balloonStr))) {
      characteristic.balloonNumber = Number(balloonStr);
    }
    if (nominalStr !== undefined && nominalStr.trim() !== "" && !Number.isNaN(Number(nominalStr))) {
      characteristic.nominalValue = Number(nominalStr);
    }
    if (upperTolStr !== undefined && upperTolStr.trim() !== "" && !Number.isNaN(Number(upperTolStr))) {
      characteristic.upperTolerance = Number(upperTolStr);
    }
    if (lowerTolStr !== undefined && lowerTolStr.trim() !== "" && !Number.isNaN(Number(lowerTolStr))) {
      characteristic.lowerTolerance = Number(lowerTolStr);
    }
    if (lowerTier) {
      characteristic.compositeLowerTier = lowerTier;
    }
    if (deviceId) {
      characteristic.deviceId = deviceId.trim();
    }

    doc.characteristics.push(characteristic);
  }

  // Parse Measurement Devices
  const deviceRegex =
    /<(MeasurementDevice|CMM|LaserScanner|OpticalGauge|Caliper|Device)\b([^>]*)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
  while ((match = deviceRegex.exec(text)) !== null) {
    const tagName = match[1] ?? "MeasurementDevice";
    const attrs = parseXmlAttributes(match[2] ?? "");
    const body = match[3] ?? "";
    const startOffset = match.index;
    const endOffset = match.index + match[0].length;
    const range = makeRange(startOffset, endOffset, lineOffsets);

    const id = (attrs.get("id") ?? extractTagText(body, "Id") ?? `DEV_${doc.devices.length + 1}`).trim();
    const qpId = attrs.get("qpId") ?? extractTagText(body, "QPId");
    const name = (attrs.get("name") ?? extractTagText(body, "Name") ?? id).trim();
    const devType = resolveDeviceType(
      tagName,
      attrs.get("deviceType") ?? attrs.get("type") ?? extractTagText(body, "DeviceType"),
    );
    const uncStr =
      attrs.get("calibrationUncertainty") ??
      attrs.get("uncertainty") ??
      extractTagText(body, "CalibrationUncertainty") ??
      extractTagText(body, "ExpandedUncertainty") ??
      extractTagText(body, "Uncertainty") ??
      "0.001";

    const device: QifMeasurementDevice = {
      id,
      name,
      deviceType: devType,
      calibrationUncertainty: Number(uncStr) || 0,
      range,
    };
    if (qpId) device.qpId = qpId.trim();
    doc.devices.push(device);
  }

  // Parse Rules (<Rules> or <QIFRules>)
  const rulesMatch = /<(?:QIF)?Rules\b([^>]*)(?:\/>|>([\s\S]*?)<\/(?:QIF)?Rules>)/i.exec(text);
  if (rulesMatch) {
    const rAttrs = parseXmlAttributes(rulesMatch[1] ?? "");
    const rBody = rulesMatch[2] ?? "";
    const rRange = makeRange(rulesMatch.index, rulesMatch.index + rulesMatch[0].length, lineOffsets);
    const minTurStr =
      rAttrs.get("minTurRatio") ??
      rAttrs.get("minTur") ??
      extractTagText(rBody, "MinTurRatio") ??
      extractTagText(rBody, "MinTUR");
    if (minTurStr !== undefined && !Number.isNaN(Number(minTurStr))) {
      doc.rules.minTurRatio = Number(minTurStr);
    }
    doc.rules.range = rRange;

    for (const ftKey of ["Point", "Plane", "Circle", "Slot", "Sphere", "Cylinder", "Cone"]) {
      const attrVal = rAttrs.get(ftKey) ?? rAttrs.get(ftKey.toLowerCase());
      if (attrVal !== undefined && !Number.isNaN(Number(attrVal))) {
        doc.rules.minPointsPerFeature[ftKey] = Number(attrVal);
      }
    }

    const ruleItemRegex =
      /<(?:FeatureRule|MinPointsRule|MinPoints)\b([^>]*)(?:\/>|>([\s\S]*?)<\/(?:FeatureRule|MinPointsRule|MinPoints)>)/gi;
    let rm: RegExpExecArray | null;
    while ((rm = ruleItemRegex.exec(rBody)) !== null) {
      const itemAttrs = parseXmlAttributes(rm[1] ?? "");
      const itemBody = rm[2] ?? "";
      const ft = itemAttrs.get("featureType") ?? itemAttrs.get("type") ?? extractTagText(itemBody, "FeatureType");
      const pts =
        itemAttrs.get("minPoints") ??
        itemAttrs.get("points") ??
        extractTagText(itemBody, "MinPoints") ??
        itemBody.trim();
      if (ft && pts && !Number.isNaN(Number(pts))) {
        doc.rules.minPointsPerFeature[ft.trim()] = Number(pts);
      }
    }
  }

  // Parse PlanSteps (<PlanStep>, <MeasureFeatureStep>)
  const stepRegex = /<(?:PlanStep|MeasureFeatureStep)\b([^>]*)(?:\/>|>([\s\S]*?)<\/(?:PlanStep|MeasureFeatureStep)>)/gi;
  while ((match = stepRegex.exec(text)) !== null) {
    const attrs = parseXmlAttributes(match[1] ?? "");
    const body = match[2] ?? "";
    const startOffset = match.index;
    const endOffset = match.index + match[0].length;
    const range = makeRange(startOffset, endOffset, lineOffsets);

    const id = (attrs.get("id") ?? extractTagText(body, "Id") ?? `S_${doc.planSteps.length + 1}`).trim();
    const stepNumStr =
      attrs.get("stepNumber") ??
      attrs.get("step") ??
      extractTagText(body, "StepNumber") ??
      String(doc.planSteps.length + 1);
    const featureId = (
      attrs.get("featureId") ??
      extractTagText(body, "FeatureId") ??
      extractTagText(body, "FeatureNominalId") ??
      ""
    ).trim();
    const charId =
      attrs.get("characteristicId") ??
      extractTagText(body, "CharacteristicId") ??
      extractTagText(body, "CharacteristicNominalId");
    const deviceId = (
      attrs.get("deviceId") ??
      extractTagText(body, "DeviceId") ??
      extractTagText(body, "MeasurementDeviceId") ??
      ""
    ).trim();
    const ptsStr =
      attrs.get("probingPointCount") ??
      attrs.get("points") ??
      extractTagText(body, "ProbingPointCount") ??
      extractTagText(body, "NumberOfPoints") ??
      "0";

    const step: QifPlanStep = {
      id,
      stepNumber: Number(stepNumStr) || doc.planSteps.length + 1,
      featureId,
      deviceId,
      probingPointCount: Number(ptsStr) || 0,
      range,
    };
    if (charId) step.characteristicId = charId.trim();
    doc.planSteps.push(step);
  }

  // Parse Actuals
  const actualRegex =
    /<((?:Geometric|Position|Flatness|Perpendicularity|Dimensional|Diameter)?CharacteristicActual|Actual)\b([^>]*)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
  while ((match = actualRegex.exec(text)) !== null) {
    const attrs = parseXmlAttributes(match[2] ?? "");
    const body = match[3] ?? "";
    const startOffset = match.index;
    const endOffset = match.index + match[0].length;
    const range = makeRange(startOffset, endOffset, lineOffsets);

    const id = (attrs.get("id") ?? extractTagText(body, "Id") ?? `A_${doc.actuals.length + 1}`).trim();
    const characteristicId = (
      attrs.get("characteristicId") ??
      attrs.get("characteristicNominalId") ??
      extractTagText(body, "CharacteristicNominalId") ??
      extractTagText(body, "CharacteristicId") ??
      ""
    ).trim();
    const partSerialNumber = (
      attrs.get("partSerialNumber") ??
      attrs.get("serialNumber") ??
      attrs.get("serial") ??
      extractTagText(body, "PartSerialNumber") ??
      extractTagText(body, "SerialNumber") ??
      "SN-001"
    ).trim();
    const valStr =
      attrs.get("measuredValue") ??
      attrs.get("value") ??
      extractTagText(body, "MeasuredValue") ??
      extractTagText(body, "Value") ??
      "0";
    const actualSizeStr =
      attrs.get("actualFeatureSize") ??
      attrs.get("actualSize") ??
      extractTagText(body, "ActualFeatureSize") ??
      extractTagText(body, "ActualSize");
    const devVecStr = attrs.get("deviationVector") ?? attrs.get("deviation") ?? extractTagText(body, "DeviationVector");
    const statusRaw = attrs.get("status") ?? extractTagText(body, "Status") ?? "PASS";

    const actual: QifCharacteristicActual = {
      id,
      characteristicId,
      partSerialNumber,
      measuredValue: Number(valStr) || 0,
      status: normalizeStatus(statusRaw),
      range,
    };
    if (actualSizeStr !== undefined && actualSizeStr.trim() !== "" && !Number.isNaN(Number(actualSizeStr))) {
      actual.actualFeatureSize = Number(actualSizeStr);
    }
    const devVec = parseVector3(devVecStr);
    if (devVec) {
      actual.deviationVector = devVec;
    }
    doc.actuals.push(actual);
  }

  return doc;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Declarative QIF DSL Parser
// ─────────────────────────────────────────────────────────────────────────────

function parseQifDsl(text: string, lineOffsets: number[], fullRange: QifSourceRange, uri?: string): QifDocument {
  const doc = createEmptyDocument(fullRange, uri);
  const lines = text.split(/\r?\n/);

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx] ?? "";
    const commentIdx = rawLine.indexOf("//");
    const hashIdx = rawLine.trimStart().startsWith("#") ? rawLine.indexOf("#") : -1;
    let cleanLine = rawLine;
    if (commentIdx >= 0) cleanLine = rawLine.slice(0, commentIdx);
    else if (hashIdx >= 0) cleanLine = "";

    const trimmed = cleanLine.trim();
    if (!trimmed) continue;

    const lineStartOffset = lineOffsets[lineIdx] ?? 0;
    const firstNonSpace = rawLine.search(/\S/);
    const startOffset = lineStartOffset + (firstNonSpace >= 0 ? firstNonSpace : 0);
    const endOffset = lineStartOffset + cleanLine.trimEnd().length;
    const range = makeRange(startOffset, endOffset, lineOffsets);

    const tokens = tokenizeDslLine(trimmed);
    const keyword = (tokens[0] ?? "").toUpperCase();
    const kv = parseKeyValuePairs(trimmed);

    if (keyword === "QIF" || keyword === "DOCUMENT") {
      const verToken = tokens[1] && !tokens[1].includes("=") ? stripQuotes(tokens[1]) : kv.get("version");
      if (verToken) doc.version = verToken;
      const qp = kv.get("qpId") ?? kv.get("id");
      if (qp) doc.qpId = qp;
    } else if (keyword === "HEADER") {
      const author = kv.get("author");
      if (author) doc.header.author = author;
      const app = kv.get("application");
      if (app) doc.header.application = app;
      const units = kv.get("units") ?? kv.get("fileUnits");
      if (units) doc.header.fileUnits = units;
      const partName = kv.get("partName");
      if (partName) doc.header.partName = partName;
      const partNumber = kv.get("partNumber");
      if (partNumber) doc.header.partNumber = partNumber;
    } else if (keyword === "DATUM") {
      const positionalLabel = tokens[1] && !tokens[1].includes("=") ? stripQuotes(tokens[1]) : undefined;
      const label = kv.get("label") ?? positionalLabel ?? "A";
      const id = kv.get("id") ?? `D_${label}`;
      const datum: QifDatumDefinition = {
        id,
        label,
        range,
      };
      const qpId = kv.get("qpId");
      if (qpId) datum.qpId = qpId;
      const featRef = kv.get("featureId") ?? kv.get("feature");
      if (featRef) datum.featureId = featRef;
      doc.datumDefinitions.push(datum);
    } else if (keyword === "FEATURE") {
      const posId = tokens[1] && !tokens[1].includes("=") ? stripQuotes(tokens[1]) : undefined;
      const posType = tokens[2] && !tokens[2].includes("=") ? stripQuotes(tokens[2]) : undefined;
      const posName = tokens[3] && !tokens[3].includes("=") ? stripQuotes(tokens[3]) : undefined;

      const id = kv.get("id") ?? posId ?? `F_${doc.features.length + 1}`;
      const ft = resolveFeatureType("Feature", kv.get("featureType") ?? kv.get("type") ?? posType);
      const name = kv.get("name") ?? posName ?? id;
      const qpId = kv.get("qpId") ?? `qpid-${id}`;
      const explicitFos = kv.get("isFeatureOfSize");
      const isFeatureOfSize =
        explicitFos !== undefined ? explicitFos.toLowerCase() === "true" : isDefaultFeatureOfSize(ft);

      const feature: QifFeature = {
        id,
        qpId,
        name,
        featureType: ft,
        isFeatureOfSize,
        range,
      };

      const rawInternal = kv.get("internal") ?? kv.get("isInternal");
      if (rawInternal !== undefined) {
        const lowerInt = rawInternal.toLowerCase();
        feature.isInternal = lowerInt === "true" || lowerInt === "internal";
      }
      const sizeStr = kv.get("nominalSize") ?? kv.get("size") ?? kv.get("diameter");
      if (sizeStr !== undefined && !Number.isNaN(Number(sizeStr))) {
        feature.nominalSize = Number(sizeStr);
      }
      const upTolStr = kv.get("upperSizeTolerance") ?? kv.get("upperSizeTol") ?? kv.get("upperTol");
      if (upTolStr !== undefined && !Number.isNaN(Number(upTolStr))) {
        feature.upperSizeTolerance = Number(upTolStr);
      }
      const lowTolStr = kv.get("lowerSizeTolerance") ?? kv.get("lowerSizeTol") ?? kv.get("lowerTol");
      if (lowTolStr !== undefined && !Number.isNaN(Number(lowTolStr))) {
        feature.lowerSizeTolerance = Number(lowTolStr);
      }
      const locVec = parseVector3(kv.get("location"));
      if (locVec) feature.location = locVec;
      const normVec = parseVector3(kv.get("normal"));
      if (normVec) feature.normal = normVec;
      const stepEntity = kv.get("stepEntityId") ?? kv.get("step");
      if (stepEntity) feature.stepEntityId = stepEntity;
      const ptsStr = kv.get("probingPoints") ?? kv.get("points");
      if (ptsStr !== undefined && !Number.isNaN(Number(ptsStr))) {
        feature.probingPoints = Number(ptsStr);
      }
      doc.features.push(feature);
    } else if (keyword === "CHARACTERISTIC" || keyword === "CHAR") {
      const posId = tokens[1] && !tokens[1].includes("=") ? stripQuotes(tokens[1]) : undefined;
      const posGdt = tokens[2] && !tokens[2].includes("=") ? stripQuotes(tokens[2]) : undefined;
      const posName = tokens[3] && !tokens[3].includes("=") ? stripQuotes(tokens[3]) : undefined;

      const id = kv.get("id") ?? posId ?? `C_${doc.characteristics.length + 1}`;
      const gdtType = resolveGdtType("Characteristic", kv.get("gdtType") ?? kv.get("type") ?? posGdt);
      const name = kv.get("name") ?? posName ?? id;
      const qpId = kv.get("qpId") ?? `qpid-${id}`;
      const tolZone = Number(kv.get("toleranceZone") ?? kv.get("zone") ?? kv.get("tolerance") ?? "0") || 0;
      const materialCondition = normalizeMaterialCondition(kv.get("materialCondition") ?? kv.get("material") ?? "RFS");
      const rawDiam = kv.get("isDiametrical") ?? kv.get("diametrical");
      const isDiametrical =
        rawDiam !== undefined
          ? rawDiam.toLowerCase() === "true"
          : gdtType === "Position" || gdtType === "DimensionalSize";

      const datumRefs = parseDatumRefListString(kv.get("datumReferences") ?? kv.get("datums") ?? "");
      const featureIds = parseListString(kv.get("featureIds") ?? kv.get("features") ?? kv.get("feature") ?? "");

      const characteristic: QifCharacteristic = {
        id,
        qpId,
        name,
        gdtType,
        toleranceZone: tolZone,
        isDiametrical,
        materialCondition,
        datumReferences: datumRefs,
        featureIds,
        range,
      };

      const balloonStr = kv.get("balloonNumber") ?? kv.get("balloon");
      if (balloonStr !== undefined && !Number.isNaN(Number(balloonStr))) {
        characteristic.balloonNumber = Number(balloonStr);
      }
      const nomStr = kv.get("nominalValue") ?? kv.get("nominal");
      if (nomStr !== undefined && !Number.isNaN(Number(nomStr))) {
        characteristic.nominalValue = Number(nomStr);
      }
      const upStr = kv.get("upperTolerance") ?? kv.get("upper");
      if (upStr !== undefined && !Number.isNaN(Number(upStr))) {
        characteristic.upperTolerance = Number(upStr);
      }
      const lowStr = kv.get("lowerTolerance") ?? kv.get("lower");
      if (lowStr !== undefined && !Number.isNaN(Number(lowStr))) {
        characteristic.lowerTolerance = Number(lowStr);
      }
      const devId = kv.get("deviceId") ?? kv.get("device");
      if (devId) {
        characteristic.deviceId = devId;
      }

      const compZoneRaw = kv.get("compositeZone") ?? kv.get("lowerZone");
      const compBlockRaw = kv.get("composite");
      if (compZoneRaw !== undefined || compBlockRaw !== undefined) {
        const compTol = Number(compZoneRaw ?? "0") || 0;
        const compDatums = parseListString(kv.get("compositeDatums") ?? kv.get("lowerDatums") ?? "");
        const compMatStr = kv.get("compositeMaterial");
        const compMat = compMatStr ? normalizeMaterialCondition(compMatStr) : undefined;
        if (compBlockRaw) {
          const innerKv = parseKeyValuePairs(compBlockRaw.replace(/^\(|\)$/g, "").replace(/,/g, " "));
          const cZone = Number(innerKv.get("zone") ?? innerKv.get("toleranceZone") ?? compTol) || 0;
          const cDatums = parseListString(innerKv.get("datums") ?? innerKv.get("datumReferences") ?? "");
          const lowerTier: QifCompositeLowerTier = {
            toleranceZone: cZone,
            datumReferences: cDatums,
          };
          const innerMat = innerKv.get("material") ?? innerKv.get("materialCondition");
          if (innerMat) {
            lowerTier.materialCondition = normalizeMaterialCondition(innerMat);
          }
          characteristic.compositeLowerTier = lowerTier;
        } else {
          const lowerTier: QifCompositeLowerTier = {
            toleranceZone: compTol,
            datumReferences: compDatums,
          };
          if (compMat) lowerTier.materialCondition = compMat;
          characteristic.compositeLowerTier = lowerTier;
        }
      }

      doc.characteristics.push(characteristic);
    } else if (keyword === "DEVICE") {
      const posId = tokens[1] && !tokens[1].includes("=") ? stripQuotes(tokens[1]) : undefined;
      const posType = tokens[2] && !tokens[2].includes("=") ? stripQuotes(tokens[2]) : undefined;
      const posName = tokens[3] && !tokens[3].includes("=") ? stripQuotes(tokens[3]) : undefined;

      const id = kv.get("id") ?? posId ?? `DEV_${doc.devices.length + 1}`;
      const deviceType = resolveDeviceType("Device", kv.get("deviceType") ?? kv.get("type") ?? posType);
      const name = kv.get("name") ?? posName ?? id;
      const uncertainty = Number(kv.get("calibrationUncertainty") ?? kv.get("uncertainty") ?? "0.001") || 0;

      const dev: QifMeasurementDevice = {
        id,
        name,
        deviceType,
        calibrationUncertainty: uncertainty,
        range,
      };
      const qpId = kv.get("qpId");
      if (qpId) dev.qpId = qpId;
      doc.devices.push(dev);
    } else if (keyword === "RULE" || keyword === "RULES") {
      doc.rules.range = range;
      const minTur = kv.get("minTurRatio") ?? kv.get("minTur");
      if (minTur !== undefined && !Number.isNaN(Number(minTur))) {
        doc.rules.minTurRatio = Number(minTur);
      }
      for (const ftKey of ["Point", "Plane", "Circle", "Slot", "Sphere", "Cylinder", "Cone"]) {
        const v = kv.get(ftKey) ?? kv.get(ftKey.toLowerCase());
        if (v !== undefined && !Number.isNaN(Number(v))) {
          doc.rules.minPointsPerFeature[ftKey] = Number(v);
        }
      }
    } else if (keyword === "STEP" || keyword === "PLANSTEP") {
      const posId = tokens[1] && !tokens[1].includes("=") ? stripQuotes(tokens[1]) : undefined;
      const id = kv.get("id") ?? posId ?? `S_${doc.planSteps.length + 1}`;
      const stepNumber =
        Number(kv.get("stepNumber") ?? kv.get("step") ?? String(doc.planSteps.length + 1)) || doc.planSteps.length + 1;
      const featureId = kv.get("featureId") ?? kv.get("feature") ?? "";
      const characteristicId = kv.get("characteristicId") ?? kv.get("characteristic");
      const deviceId = kv.get("deviceId") ?? kv.get("device") ?? "";
      const probingPointCount = Number(kv.get("probingPointCount") ?? kv.get("points") ?? "0") || 0;

      const step: QifPlanStep = {
        id,
        stepNumber,
        featureId,
        deviceId,
        probingPointCount,
        range,
      };
      if (characteristicId) step.characteristicId = characteristicId;
      doc.planSteps.push(step);
    } else if (keyword === "ACTUAL") {
      const posId = tokens[1] && !tokens[1].includes("=") ? stripQuotes(tokens[1]) : undefined;
      const id = kv.get("id") ?? posId ?? `A_${doc.actuals.length + 1}`;
      const characteristicId = kv.get("characteristicId") ?? kv.get("characteristic") ?? "";
      const partSerialNumber = kv.get("partSerialNumber") ?? kv.get("serialNumber") ?? kv.get("serial") ?? "SN-001";
      const measuredValue = Number(kv.get("measuredValue") ?? kv.get("value") ?? "0") || 0;
      const status = normalizeStatus(kv.get("status") ?? "PASS");

      const actual: QifCharacteristicActual = {
        id,
        characteristicId,
        partSerialNumber,
        measuredValue,
        status,
        range,
      };
      const actSize = kv.get("actualFeatureSize") ?? kv.get("actualSize");
      if (actSize !== undefined && !Number.isNaN(Number(actSize))) {
        actual.actualFeatureSize = Number(actSize);
      }
      const devVec = parseVector3(kv.get("deviationVector") ?? kv.get("deviation"));
      if (devVec) actual.deviationVector = devVec;
      doc.actuals.push(actual);
    } else {
      throw new Error(`Unrecognized QIF DSL directive '${tokens[0] ?? trimmed}' at line ${lineIdx + 1}.`);
    }
  }

  return doc;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. JSON QIF Parser
// ─────────────────────────────────────────────────────────────────────────────

function parseQifJson(text: string, lineOffsets: number[], fullRange: QifSourceRange, uri?: string): QifDocument {
  const raw = JSON.parse(text) as Partial<QifDocument>;
  const doc = createEmptyDocument(fullRange, uri);

  if (typeof raw.qpId === "string") doc.qpId = raw.qpId;
  if (typeof raw.version === "string") doc.version = raw.version;
  if (raw.header) {
    doc.header = { ...doc.header, ...raw.header };
  }
  if (Array.isArray(raw.datumDefinitions)) {
    doc.datumDefinitions = raw.datumDefinitions.map((d, idx) => ({
      id: d.id ?? `D_${idx + 1}`,
      qpId: d.qpId,
      label: d.label ?? "A",
      featureId: d.featureId,
      range: d.range ?? findIdRangeInText(text, d.id ?? d.label, lineOffsets, fullRange),
    }));
  }
  if (Array.isArray(raw.features)) {
    doc.features = raw.features.map((f, idx) => {
      const ft = f.featureType ?? "Cylinder";
      const feat: QifFeature = {
        id: f.id ?? `F_${idx + 1}`,
        qpId: f.qpId ?? `qpid-F_${idx + 1}`,
        name: f.name ?? f.id ?? `F_${idx + 1}`,
        featureType: ft,
        isFeatureOfSize: f.isFeatureOfSize ?? isDefaultFeatureOfSize(ft),
        range: f.range ?? findIdRangeInText(text, f.id ?? f.name, lineOffsets, fullRange),
      };
      if (f.isInternal !== undefined) feat.isInternal = f.isInternal;
      if (f.nominalSize !== undefined) feat.nominalSize = f.nominalSize;
      if (f.upperSizeTolerance !== undefined) feat.upperSizeTolerance = f.upperSizeTolerance;
      if (f.lowerSizeTolerance !== undefined) feat.lowerSizeTolerance = f.lowerSizeTolerance;
      if (f.location !== undefined) feat.location = f.location;
      if (f.normal !== undefined) feat.normal = f.normal;
      if (f.stepEntityId !== undefined) feat.stepEntityId = f.stepEntityId;
      if (f.probingPoints !== undefined) feat.probingPoints = f.probingPoints;
      return feat;
    });
  }
  if (Array.isArray(raw.characteristics)) {
    doc.characteristics = raw.characteristics.map((c, idx) => {
      const ch: QifCharacteristic = {
        id: c.id ?? `C_${idx + 1}`,
        qpId: c.qpId ?? `qpid-C_${idx + 1}`,
        name: c.name ?? c.id ?? `C_${idx + 1}`,
        gdtType: c.gdtType ?? "Position",
        toleranceZone: c.toleranceZone ?? 0,
        materialCondition: c.materialCondition ?? "RFS",
        datumReferences: c.datumReferences ?? [],
        featureIds: c.featureIds ?? [],
        range: c.range ?? findIdRangeInText(text, c.id ?? c.name, lineOffsets, fullRange),
      };
      if (c.balloonNumber !== undefined) ch.balloonNumber = c.balloonNumber;
      if (c.nominalValue !== undefined) ch.nominalValue = c.nominalValue;
      if (c.upperTolerance !== undefined) ch.upperTolerance = c.upperTolerance;
      if (c.lowerTolerance !== undefined) ch.lowerTolerance = c.lowerTolerance;
      if (c.isDiametrical !== undefined) ch.isDiametrical = c.isDiametrical;
      if (c.compositeLowerTier !== undefined) ch.compositeLowerTier = c.compositeLowerTier;
      if (c.deviceId !== undefined) ch.deviceId = c.deviceId;
      return ch;
    });
  }
  if (Array.isArray(raw.devices)) {
    doc.devices = raw.devices.map((d, idx) => {
      const dev: QifMeasurementDevice = {
        id: d.id ?? `DEV_${idx + 1}`,
        name: d.name ?? d.id ?? `DEV_${idx + 1}`,
        deviceType: d.deviceType ?? "CMM",
        calibrationUncertainty: d.calibrationUncertainty ?? 0.001,
        range: d.range ?? findIdRangeInText(text, d.id ?? d.name, lineOffsets, fullRange),
      };
      if (d.qpId !== undefined) dev.qpId = d.qpId;
      return dev;
    });
  }
  if (raw.rules) {
    doc.rules = {
      minPointsPerFeature: { ...DEFAULT_MIN_POINTS, ...(raw.rules.minPointsPerFeature ?? {}) },
      minTurRatio: raw.rules.minTurRatio ?? 4.0,
      range: raw.rules.range ?? fullRange,
    };
  }
  if (Array.isArray(raw.planSteps)) {
    doc.planSteps = raw.planSteps.map((s, idx) => {
      const step: QifPlanStep = {
        id: s.id ?? `S_${idx + 1}`,
        stepNumber: s.stepNumber ?? idx + 1,
        featureId: s.featureId ?? "",
        deviceId: s.deviceId ?? "",
        probingPointCount: s.probingPointCount ?? 0,
        range: s.range ?? findIdRangeInText(text, s.id, lineOffsets, fullRange),
      };
      if (s.characteristicId !== undefined) step.characteristicId = s.characteristicId;
      return step;
    });
  }
  if (Array.isArray(raw.actuals)) {
    doc.actuals = raw.actuals.map((a, idx) => {
      const act: QifCharacteristicActual = {
        id: a.id ?? `A_${idx + 1}`,
        characteristicId: a.characteristicId ?? "",
        partSerialNumber: a.partSerialNumber ?? `SN-${idx + 1}`,
        measuredValue: a.measuredValue ?? 0,
        status: a.status ?? "PASS",
        range: a.range ?? findIdRangeInText(text, a.id, lineOffsets, fullRange),
      };
      if (a.actualFeatureSize !== undefined) act.actualFeatureSize = a.actualFeatureSize;
      if (a.deviationVector !== undefined) act.deviationVector = a.deviationVector;
      return act;
    });
  }

  return doc;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

function findFirstSectionIndex(text: string): number {
  const m =
    /<(?:Header|DatumDefinitions|Features|FeatureNominals|Characteristics|CharacteristicNominals|MeasurementResources|MeasurementDevices|Rules|Plan|Results)\b/i.exec(
      text,
    );
  return m ? m.index : text.length;
}

function parseXmlAttributes(attrString: string): Map<string, string> {
  const result = new Map<string, string>();
  const regex = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(attrString)) !== null) {
    const key = m[1];
    const val = m[2] ?? m[3] ?? "";
    if (key) {
      result.set(key, val);
    }
  }
  return result;
}

function extractTagText(xml: string, tagName: string): string | undefined {
  const regex = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const m = regex.exec(xml);
  return m?.[1]?.trim();
}

function stripTags(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveFeatureType(tagName: string, explicitType?: string): QifFeatureType {
  const combined = `${explicitType ?? ""} ${tagName}`.toLowerCase();
  if (combined.includes("cylinder") || combined.includes("cylindrical")) return "Cylinder";
  if (combined.includes("plane") && !combined.includes("oppositeparallel")) return "Plane";
  if (combined.includes("sphere") || combined.includes("spherical")) return "Sphere";
  if (combined.includes("cone") || combined.includes("conical")) return "Cone";
  if (combined.includes("circle") || combined.includes("circular")) return "Circle";
  if (combined.includes("slot") || combined.includes("oppositeparallel")) return "Slot";
  if (combined.includes("point")) return "Point";
  return "Cylinder";
}

function resolveGdtType(tagName: string, explicitType?: string): QifGdtType {
  const combined = `${explicitType ?? ""} ${tagName}`.toLowerCase();
  if (combined.includes("flatness")) return "Flatness";
  if (combined.includes("straightness")) return "Straightness";
  if (combined.includes("circularity") || combined.includes("roundness")) return "Circularity";
  if (combined.includes("cylindricity")) return "Cylindricity";
  if (combined.includes("profileofsurface") || combined.includes("surfaceprofile")) return "ProfileOfSurface";
  if (combined.includes("profileofline") || combined.includes("lineprofile")) return "ProfileOfLine";
  if (combined.includes("perpendicularity")) return "Perpendicularity";
  if (combined.includes("parallelism")) return "Parallelism";
  if (combined.includes("angularity")) return "Angularity";
  if (combined.includes("position")) return "Position";
  if (combined.includes("circularrunout")) return "CircularRunout";
  if (combined.includes("totalrunout")) return "TotalRunout";
  if (combined.includes("dimensionalsize") || combined.includes("diameter")) return "DimensionalSize";
  if (
    combined.includes("dimensionaldistance") ||
    combined.includes("distancebetween") ||
    combined.includes("distance")
  ) {
    return "DimensionalDistance";
  }
  return "Position";
}

function resolveDeviceType(tagName: string, explicitType?: string): QifDeviceType {
  const combined = `${explicitType ?? ""} ${tagName}`.toLowerCase();
  if (combined.includes("laser") || combined.includes("scanner")) return "LaserScanner";
  if (combined.includes("optical") || combined.includes("vision")) return "OpticalGauge";
  if (combined.includes("caliper") || combined.includes("micrometer")) return "Caliper";
  return "CMM";
}

function normalizeMaterialCondition(raw: string): QifMaterialCondition {
  const u = raw.trim().toUpperCase();
  if (u === "MMC" || u === "M" || u === "MAXIMUM" || u === "MAX") return "MMC";
  if (u === "LMC" || u === "L" || u === "LEAST" || u === "MIN") return "LMC";
  return "RFS";
}

function normalizeStatus(raw: string): QifActualStatus {
  const u = raw.trim().toUpperCase();
  if (u === "FAIL" || u === "FAILED" || u === "REJECT") return "FAIL";
  if (u === "REWORK" || u === "MRB") return "REWORK";
  return "PASS";
}

function parseVector3(raw?: string): [number, number, number] | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[()[\]]/g, " ").trim();
  const parts = cleaned.split(/[\s,]+/).filter(Boolean);
  if (parts.length < 3) return undefined;
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  const z = Number(parts[2]);
  if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) return undefined;
  return [x, y, z];
}

function parseXmlDatumRefs(body: string, attrDatums?: string): QifDatumRef[] {
  const refs: QifDatumRef[] = [];
  const datumTagRegex = /<(?:DatumReference|Datum)\b([^>]*)(?:\/>|>([\s\S]*?)<\/(?:DatumReference|Datum)>)/gi;
  let m: RegExpExecArray | null;
  let idx = 1;
  while ((m = datumTagRegex.exec(body)) !== null) {
    const attrs = parseXmlAttributes(m[1] ?? "");
    const inner = m[2] ?? "";
    const label =
      attrs.get("datumLabel") ??
      attrs.get("label") ??
      extractTagText(inner, "DatumLabel") ??
      extractTagText(inner, "SimpleDatum") ??
      inner.trim();
    if (!label) continue;
    const matStr =
      attrs.get("materialCondition") ??
      attrs.get("materialModifier") ??
      extractTagText(inner, "MaterialModifier") ??
      extractTagText(inner, "MaterialCondition");
    const precStr = attrs.get("precedence") ?? extractTagText(inner, "Precedence");

    const ref: QifDatumRef = {
      datumLabel: stripTags(label).trim(),
      precedence: precStr !== undefined && !Number.isNaN(Number(precStr)) ? Number(precStr) : idx,
    };
    if (matStr) {
      ref.materialCondition = normalizeMaterialCondition(matStr);
    }
    refs.push(ref);
    idx++;
  }

  if (refs.length === 0 && attrDatums) {
    return parseDatumRefListString(attrDatums);
  }
  return refs;
}

function parseDatumRefListString(raw: string): QifDatumRef[] {
  const cleaned = raw.replace(/^\[|\]$/g, "").trim();
  if (!cleaned) return [];
  const parts = cleaned.split(/[\s,|]+/).filter(Boolean);
  return parts.map((part, i) => {
    const m = /^([A-Za-z0-9_-]+)(?:\(([A-Za-z]+)\))?$/.exec(part.trim());
    const label = m?.[1] ?? part.trim();
    const matRaw = m?.[2];
    const ref: QifDatumRef = {
      datumLabel: label,
      precedence: i + 1,
    };
    if (matRaw) {
      ref.materialCondition = normalizeMaterialCondition(matRaw);
    }
    return ref;
  });
}

function parseXmlCompositeLowerTier(body: string, charAttrs: Map<string, string>): QifCompositeLowerTier | undefined {
  const m =
    /<(?:CompositeLowerTier|LowerSegment)\b([^>]*)(?:\/>|>([\s\S]*?)<\/(?:CompositeLowerTier|LowerSegment)>)/i.exec(
      body,
    );
  if (m) {
    const attrs = parseXmlAttributes(m[1] ?? "");
    const inner = m[2] ?? "";
    const tolStr =
      attrs.get("toleranceZone") ??
      attrs.get("toleranceValue") ??
      extractTagText(inner, "ToleranceValue") ??
      extractTagText(inner, "ToleranceZone") ??
      "0";
    const matStr =
      attrs.get("materialCondition") ??
      attrs.get("materialModifier") ??
      extractTagText(inner, "MaterialCondition") ??
      extractTagText(inner, "MaterialModifier");
    const datumRefs = parseXmlDatumRefs(inner, attrs.get("datumReferences") ?? attrs.get("datums"));
    const tier: QifCompositeLowerTier = {
      toleranceZone: Number(tolStr) || 0,
      datumReferences: datumRefs.map((d) => d.datumLabel),
    };
    if (matStr) {
      tier.materialCondition = normalizeMaterialCondition(matStr);
    }
    return tier;
  }

  const compTolZone = charAttrs.get("compositeToleranceZone");
  if (compTolZone !== undefined) {
    const tier: QifCompositeLowerTier = {
      toleranceZone: Number(compTolZone) || 0,
      datumReferences: parseListString(charAttrs.get("compositeDatumReferences") ?? ""),
    };
    const compMat = charAttrs.get("compositeMaterialCondition");
    if (compMat) {
      tier.materialCondition = normalizeMaterialCondition(compMat);
    }
    return tier;
  }

  return undefined;
}

function parseXmlFeatureIds(body: string, attrFeatures?: string): string[] {
  const ids: string[] = [];
  const fnBlock = extractTagText(body, "FeatureNominalIds") ?? body;
  const idRegex = /<(?:Id|FeatureId|FeatureNominalId)\b[^>]*>([^<]+)<\/(?:Id|FeatureId|FeatureNominalId)>/gi;
  let m: RegExpExecArray | null;
  while ((m = idRegex.exec(fnBlock)) !== null) {
    const val = m[1]?.trim();
    if (val) ids.push(val);
  }
  if (ids.length === 0 && attrFeatures) {
    return parseListString(attrFeatures);
  }
  return ids;
}

function parseListString(raw: string): string[] {
  const cleaned = raw.replace(/^\[|\]$/g, "").trim();
  if (!cleaned) return [];
  return cleaned
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function tokenizeDslLine(line: string): string[] {
  const tokens: string[] = [];
  const regex = /"[^"]*"|'[^']*'|\([^)]*\)|\[[^\]]*\]|\S+/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(line)) !== null) {
    tokens.push(m[0]);
  }
  return tokens;
}

function parseKeyValuePairs(line: string): Map<string, string> {
  const kv = new Map<string, string>();
  const regex = /([a-zA-Z0-9_]+)\s*=\s*("[^"]*"|'[^']*'|\([^)]*\)|\[[^\]]*\]|\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(line)) !== null) {
    const k = m[1];
    const v = m[2];
    if (k && v !== undefined) {
      kv.set(k, stripQuotes(v));
    }
  }
  return kv;
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function findIdRangeInText(
  text: string,
  identifier: string | undefined,
  lineOffsets: number[],
  fallback: QifSourceRange,
): QifSourceRange {
  if (!identifier) return fallback;
  const idx = text.indexOf(`"${identifier}"`);
  if (idx >= 0) {
    return makeRange(idx, idx + identifier.length + 2, lineOffsets);
  }
  return fallback;
}
