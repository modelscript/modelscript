// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/qif — Unified QIF 3.0 XML, Declarative QIF DSL, and JSON Parser.
 *
 * Parses ISO 23952 / ANSI DMSC QIF 3.0 XML documents (`<QIFDocument>`) as well as
 * concise declarative QIF DSL and JSON representations with exact line/column source ranges.
 */

import { parseXml, type XmlAttribute, type XmlElement } from "@modelscript/dsl/xml";
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

function getDescendant(el: XmlElement | null | undefined, name: string): XmlElement | undefined {
  if (!el) return undefined;
  for (const c of el.children) {
    if (matchTag(c, name)) return c;
    const found = getDescendant(c, name);
    if (found) return found;
  }
  return undefined;
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

function getDescendantText(el: XmlElement | null | undefined, name: string): string | undefined {
  const descendant = getDescendant(el, name);
  return descendant ? descendant.text.trim() : undefined;
}

function isFeatureElement(el: XmlElement): boolean {
  const tag = localName(el.name);
  if (/Actual$/i.test(tag)) return false;
  if (/^Rule|Rules|Item$/i.test(tag) || /Rule$/i.test(tag)) return false;
  if (/^(?:FeatureNominalIds|FeatureId|FeatureNominals|Features|FeatureItems)$/i.test(tag)) return false;
  return (
    /^(?:Cylinder|Plane|Sphere|Cone|Circle|Slot|OppositeParallelPlanes|Point)?Feature(?:Nominal|Definition|Item)?$/i.test(
      tag,
    ) || tag.toLowerCase() === "feature"
  );
}

function isCharacteristicElement(el: XmlElement): boolean {
  const tag = localName(el.name);
  if (/Actual$/i.test(tag)) return false;
  if (/^(?:Characteristics|CharacteristicNominals|CharacteristicDefinitions|CharacteristicItems)$/i.test(tag)) {
    return false;
  }
  return (
    /^(?:Flatness|Straightness|Circularity|Cylindricity|ProfileOfSurface|ProfileOfLine|Perpendicularity|Parallelism|Angularity|Position|CircularRunout|TotalRunout|DimensionalSize|DimensionalDistance|Diameter|DistanceBetween|Geometric)?Characteristic(?:Nominal|Definition|Item)?$/i.test(
      tag,
    ) || tag.toLowerCase() === "characteristic"
  );
}

function isDeviceElement(el: XmlElement): boolean {
  const tag = localName(el.name).toLowerCase();
  return (
    tag === "measurementdevice" ||
    tag === "cmm" ||
    tag === "laserscanner" ||
    tag === "opticalgauge" ||
    tag === "caliper" ||
    tag === "device"
  );
}

function isActualElement(el: XmlElement): boolean {
  const tag = localName(el.name);
  if (/^(?:Results|Actuals)$/i.test(tag)) return false;
  return (
    /^(?:Geometric|Position|Flatness|Perpendicularity|Dimensional|Diameter)?CharacteristicActual$/i.test(tag) ||
    tag.toLowerCase() === "actual"
  );
}

function parseCstDatumRefs(el: XmlElement, attrDatums?: string): QifDatumRef[] {
  const refs: QifDatumRef[] = [];
  const candidateDatumTags = findDescendants(el, (c) => {
    const t = localName(c.name).toLowerCase();
    if (t === "datumreference" || t === "datum") {
      let p: XmlElement | null = c.parent;
      while (p && p !== el) {
        const pt = localName(p.name).toLowerCase();
        if (pt === "compositelowertier" || pt === "lowersegment") return false;
        p = p.parent;
      }
      return true;
    }
    return false;
  });

  let idx = 1;
  for (const c of candidateDatumTags) {
    const label =
      getAttr(c, "datumLabel") ??
      getAttr(c, "label") ??
      getChildText(c, "DatumLabel") ??
      getChildText(c, "SimpleDatum") ??
      c.text.trim();
    if (!label) continue;
    const matStr =
      getAttr(c, "materialCondition") ??
      getAttr(c, "materialModifier") ??
      getChildText(c, "MaterialModifier") ??
      getChildText(c, "MaterialCondition");
    const precStr = getAttr(c, "precedence") ?? getChildText(c, "Precedence");

    const ref: QifDatumRef = {
      datumLabel: label.trim(),
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

function parseCstCompositeLowerTier(el: XmlElement): QifCompositeLowerTier | undefined {
  const lowerEl = findDescendants(el, (c) => {
    const t = localName(c.name).toLowerCase();
    return t === "compositelowertier" || t === "lowersegment";
  })[0];

  if (lowerEl) {
    const tolStr =
      getAttr(lowerEl, "toleranceZone") ??
      getAttr(lowerEl, "toleranceValue") ??
      getChildText(lowerEl, "ToleranceValue") ??
      getChildText(lowerEl, "ToleranceZone") ??
      "0";
    const matStr =
      getAttr(lowerEl, "materialCondition") ??
      getAttr(lowerEl, "materialModifier") ??
      getChildText(lowerEl, "MaterialCondition") ??
      getChildText(lowerEl, "MaterialModifier");

    const datumTags = findDescendants(lowerEl, (c) => {
      const t = localName(c.name).toLowerCase();
      return t === "datumreference" || t === "datum";
    });
    const datumRefs: string[] = [];
    for (const d of datumTags) {
      const l =
        getAttr(d, "datumLabel") ??
        getAttr(d, "label") ??
        getChildText(d, "DatumLabel") ??
        getChildText(d, "SimpleDatum") ??
        d.text.trim();
      if (l) datumRefs.push(l.trim());
    }
    if (datumRefs.length === 0) {
      const attrDatums = getAttr(lowerEl, "datumReferences") ?? getAttr(lowerEl, "datums");
      if (attrDatums) {
        datumRefs.push(...parseListString(attrDatums));
      }
    }

    const tier: QifCompositeLowerTier = {
      toleranceZone: Number(tolStr) || 0,
      datumReferences: datumRefs,
    };
    if (matStr) {
      tier.materialCondition = normalizeMaterialCondition(matStr);
    }
    return tier;
  }

  const compTolZone = getAttr(el, "compositeToleranceZone");
  if (compTolZone !== undefined) {
    const tier: QifCompositeLowerTier = {
      toleranceZone: Number(compTolZone) || 0,
      datumReferences: parseListString(getAttr(el, "compositeDatumReferences") ?? ""),
    };
    const compMat = getAttr(el, "compositeMaterialCondition");
    if (compMat) {
      tier.materialCondition = normalizeMaterialCondition(compMat);
    }
    return tier;
  }

  return undefined;
}

function parseCstFeatureIds(el: XmlElement, attrFeatures?: string): string[] {
  const ids: string[] = [];
  const fnBlock = getChild(el, "FeatureNominalIds") ?? el;
  const idTags = findDescendants(fnBlock, (c) => {
    const t = localName(c.name).toLowerCase();
    return t === "id" || t === "featureid" || t === "featurenominalid";
  });
  for (const it of idTags) {
    const v = it.text.trim();
    if (v) ids.push(v);
  }
  if (ids.length === 0 && attrFeatures) {
    return parseListString(attrFeatures);
  }
  return ids;
}

function parseQifXml(text: string, lineOffsets: number[], fullRange: QifSourceRange, uri?: string): QifDocument {
  if (
    !text.includes(">") ||
    (text.includes("<QIFDocument") && !text.includes("</QIFDocument>") && !/<QIFDocument\b[^<>]*\/>/i.test(text))
  ) {
    throw new Error("Malformed QIF XML document: unclosed <QIFDocument> element.");
  }

  const parsed = parseXml(text);
  if (!parsed.root) {
    throw new Error("Malformed QIF XML document: unclosed <QIFDocument> element.");
  }

  const rootElement = matchTag(parsed.root, "QIFDocument")
    ? parsed.root
    : (findDescendants(parsed.root, (e) => matchTag(e, "QIFDocument"))[0] ?? parsed.root);

  const doc = createEmptyDocument(fullRange, uri);

  // Extract root QIFDocument attributes & QPId
  const verQif = getAttr(rootElement, "versionQIF") ?? getAttr(rootElement, "version");
  if (verQif) doc.version = verQif;
  const qp = getAttr(rootElement, "qpId") ?? getAttr(rootElement, "id");
  if (qp) doc.qpId = qp;

  const rootQpId = getChildText(rootElement, "QPId");
  if (rootQpId) {
    doc.qpId = rootQpId;
  }

  // Parse <Header>
  const headerEl = findDescendants(rootElement, (e) => matchTag(e, "Header"))[0];
  if (headerEl) {
    const authorEl = getChild(headerEl, "Author");
    const authorName = authorEl
      ? (getChildText(authorEl, "Name") ?? authorEl.text.trim())
      : getAttr(headerEl, "author");
    const appEl = getChild(headerEl, "Application");
    const appName = appEl ? (getChildText(appEl, "Name") ?? appEl.text.trim()) : getAttr(headerEl, "application");
    const unitName =
      getDescendantText(headerEl, "UnitName") ??
      getDescendantText(headerEl, "SIUnitName") ??
      getDescendantText(headerEl, "LinearUnit") ??
      getChildText(headerEl, "FileUnits") ??
      getAttr(headerEl, "fileUnits") ??
      getDescendantText(rootElement, "UnitName") ??
      "mm";
    const partName = getDescendantText(headerEl, "PartName") ?? getAttr(headerEl, "partName");
    const partNumber = getDescendantText(headerEl, "PartNumber") ?? getAttr(headerEl, "partNumber");

    const header: QifHeader = {
      fileUnits: unitName.trim(),
    };
    if (authorName) header.author = authorName.trim();
    if (appName) header.application = appName.trim();
    if (partName) header.partName = partName.trim();
    if (partNumber) header.partNumber = partNumber.trim();
    doc.header = header;
  }

  // Parse <DatumDefinitions> / <DatumDefinition>
  const datumElements = findDescendants(rootElement, (e) => matchTag(e, "DatumDefinition"));
  for (const el of datumElements) {
    const id = getAttr(el, "id") ?? getChildText(el, "Id") ?? `D_${doc.datumDefinitions.length + 1}`;
    const qpId = getAttr(el, "qpId") ?? getChildText(el, "QPId");
    const label =
      getAttr(el, "label") ??
      getAttr(el, "datumLabel") ??
      getChildText(el, "DatumLabel") ??
      getChildText(el, "Label") ??
      id;
    const fnBlock = getChild(el, "FeatureNominalIds");
    const featureId =
      getAttr(el, "featureId") ??
      getAttr(el, "featureNominalId") ??
      (fnBlock ? getChildText(fnBlock, "Id") : undefined) ??
      getChildText(el, "FeatureNominalId") ??
      getChildText(el, "FeatureId");

    const datumDef: QifDatumDefinition = {
      id: id.trim(),
      label: label.trim(),
      range: makeRange(el.start, el.end, lineOffsets),
    };
    if (qpId) datumDef.qpId = qpId.trim();
    if (featureId) datumDef.featureId = featureId.trim();
    const datumRefs = parseCstDatumRefs(el, getAttr(el, "datumReferences") ?? getAttr(el, "datums"));
    if (datumRefs.length > 0) {
      datumDef.datumReferences = datumRefs.map((r) => r.datumLabel);
    }
    doc.datumDefinitions.push(datumDef);
  }

  // Parse Features (<*FeatureNominal>, <*FeatureDefinition>, <Feature>)
  const featureElements = findDescendants(rootElement, isFeatureElement);
  for (const el of featureElements) {
    const tagName = localName(el.name);
    const ft = resolveFeatureType(
      tagName,
      getAttr(el, "featureType") ?? getAttr(el, "type") ?? getChildText(el, "FeatureType"),
    );
    const id = (getAttr(el, "id") ?? getChildText(el, "Id") ?? `F_${doc.features.length + 1}`).trim();
    const qpId = (getAttr(el, "qpId") ?? getChildText(el, "QPId") ?? `qpid-${id}`).trim();
    const name = (getAttr(el, "name") ?? getChildText(el, "Name") ?? id).trim();

    const explicitFos = getAttr(el, "isFeatureOfSize") ?? getChildText(el, "IsFeatureOfSize");
    const isFeatureOfSize =
      explicitFos !== undefined ? explicitFos.trim().toLowerCase() === "true" : isDefaultFeatureOfSize(ft);

    const internalRaw =
      getAttr(el, "isInternal") ??
      getAttr(el, "internal") ??
      getChildText(el, "InternalExternal") ??
      getChildText(el, "IsInternal");
    let isInternal: boolean | undefined;
    if (internalRaw !== undefined) {
      const upper = internalRaw.trim().toUpperCase();
      if (upper === "TRUE" || upper === "INTERNAL" || upper === "BORE" || upper === "HOLE") isInternal = true;
      else if (upper === "FALSE" || upper === "EXTERNAL" || upper === "SHAFT" || upper === "BOSS") isInternal = false;
    }

    const nominalStr =
      getAttr(el, "nominalSize") ??
      getAttr(el, "diameter") ??
      getAttr(el, "size") ??
      getChildText(el, "Diameter") ??
      getChildText(el, "NominalSize") ??
      getChildText(el, "Width") ??
      getChildText(el, "Size");
    const radiusStr = getAttr(el, "radius") ?? getChildText(el, "Radius");
    let nominalSize: number | undefined;
    if (nominalStr !== undefined && nominalStr.trim() !== "") {
      nominalSize = Number(nominalStr.trim());
    } else if (radiusStr !== undefined && radiusStr.trim() !== "") {
      nominalSize = Number(radiusStr.trim()) * 2;
    }

    const upperSizeTolStr =
      getAttr(el, "upperSizeTolerance") ??
      getAttr(el, "upperTolerance") ??
      getChildText(el, "UpperTolerance") ??
      getChildText(el, "UpperSizeTolerance");
    const lowerSizeTolStr =
      getAttr(el, "lowerSizeTolerance") ??
      getAttr(el, "lowerTolerance") ??
      getChildText(el, "LowerTolerance") ??
      getChildText(el, "LowerSizeTolerance");

    const locStr =
      getAttr(el, "location") ??
      getChildText(el, "Location") ??
      getChildText(el, "CenterPoint") ??
      getChildText(el, "Point");
    const normStr =
      getAttr(el, "normal") ??
      getChildText(el, "Normal") ??
      getChildText(el, "AxisVector") ??
      getChildText(el, "Direction");

    const stepId =
      getAttr(el, "stepEntityId") ??
      getAttr(el, "cadEntityId") ??
      getChildText(el, "StepEntityId") ??
      getChildText(el, "CADEntityId") ??
      getChildText(el, "EntityId");

    const pointsStr =
      getAttr(el, "probingPoints") ??
      getAttr(el, "points") ??
      getChildText(el, "ProbingPoints") ??
      getChildText(el, "MinPoints") ??
      getChildText(el, "PointCount");

    const feature: QifFeature = {
      id,
      qpId,
      name,
      featureType: ft,
      isFeatureOfSize,
      range: makeRange(el.start, el.end, lineOffsets),
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
  const charElements = findDescendants(rootElement, isCharacteristicElement);
  for (const el of charElements) {
    const tagName = localName(el.name);
    const gdtType = resolveGdtType(
      tagName,
      getAttr(el, "gdtType") ??
        getAttr(el, "type") ??
        getChildText(el, "GdtType") ??
        getChildText(el, "CharacteristicType"),
    );
    const id = (getAttr(el, "id") ?? getChildText(el, "Id") ?? `C_${doc.characteristics.length + 1}`).trim();
    const qpId = (getAttr(el, "qpId") ?? getChildText(el, "QPId") ?? `qpid-${id}`).trim();
    const name = (getAttr(el, "name") ?? getChildText(el, "Name") ?? id).trim();

    const balloonStr = getAttr(el, "balloonNumber") ?? getAttr(el, "balloon") ?? getChildText(el, "BalloonNumber");
    const nominalStr =
      getAttr(el, "nominalValue") ??
      getAttr(el, "nominal") ??
      getAttr(el, "targetValue") ??
      getChildText(el, "NominalValue") ??
      getChildText(el, "TargetValue");
    const tolStr =
      getAttr(el, "toleranceZone") ??
      getAttr(el, "toleranceValue") ??
      getAttr(el, "tolerance") ??
      getChildText(el, "ToleranceValue") ??
      getChildText(el, "ToleranceZone") ??
      getChildText(el, "Tolerance") ??
      "0";
    const upperTolStr = getAttr(el, "upperTolerance") ?? getAttr(el, "upper") ?? getChildText(el, "UpperTolerance");
    const lowerTolStr = getAttr(el, "lowerTolerance") ?? getAttr(el, "lower") ?? getChildText(el, "LowerTolerance");

    const diamStr =
      getAttr(el, "isDiametrical") ??
      getAttr(el, "diametrical") ??
      getChildText(el, "DiametricalZone") ??
      getChildText(el, "IsDiametrical") ??
      getChildText(el, "ZoneType");
    const isDiametrical =
      diamStr !== undefined
        ? diamStr.trim().toLowerCase() === "true" || diamStr.trim().toUpperCase() === "DIAMETRICAL"
        : gdtType === "Position" || gdtType === "DimensionalSize";

    const matRaw =
      getAttr(el, "materialCondition") ??
      getAttr(el, "materialModifier") ??
      getAttr(el, "material") ??
      getChildText(el, "MaterialCondition") ??
      getChildText(el, "MaterialModifier") ??
      "RFS";
    const materialCondition = normalizeMaterialCondition(matRaw);

    const datumRefs = parseCstDatumRefs(el, getAttr(el, "datumReferences") ?? getAttr(el, "datums"));
    const lowerTier = parseCstCompositeLowerTier(el);
    const featureIds = parseCstFeatureIds(el, getAttr(el, "featureIds") ?? getAttr(el, "featureId"));

    const deviceId =
      getAttr(el, "deviceId") ??
      getAttr(el, "measurementDeviceId") ??
      getChildText(el, "MeasurementDeviceId") ??
      getChildText(el, "DeviceId");

    const subgroupStr =
      getAttr(el, "spcSubgroupSize") ??
      getAttr(el, "subgroupSize") ??
      getChildText(el, "SPCSubgroupSize") ??
      getChildText(el, "SubgroupSize");

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
      range: makeRange(el.start, el.end, lineOffsets),
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
    if (subgroupStr !== undefined && subgroupStr.trim() !== "" && !Number.isNaN(Number(subgroupStr))) {
      characteristic.spcSubgroupSize = Number(subgroupStr);
    }

    doc.characteristics.push(characteristic);
  }

  // Parse Measurement Devices
  const devElements = findDescendants(rootElement, isDeviceElement);
  for (const el of devElements) {
    const tagName = localName(el.name);
    const id = (getAttr(el, "id") ?? getChildText(el, "Id") ?? `DEV_${doc.devices.length + 1}`).trim();
    const qpId = getAttr(el, "qpId") ?? getChildText(el, "QPId");
    const name = (getAttr(el, "name") ?? getChildText(el, "Name") ?? id).trim();
    const devType = resolveDeviceType(
      tagName,
      getAttr(el, "deviceType") ?? getAttr(el, "type") ?? getChildText(el, "DeviceType"),
    );
    const uncStr =
      getAttr(el, "calibrationUncertainty") ??
      getAttr(el, "uncertainty") ??
      getChildText(el, "CalibrationUncertainty") ??
      getChildText(el, "ExpandedUncertainty") ??
      getChildText(el, "Uncertainty") ??
      "0.001";

    const device: QifMeasurementDevice = {
      id,
      name,
      deviceType: devType,
      calibrationUncertainty: Number(uncStr) || 0,
      range: makeRange(el.start, el.end, lineOffsets),
    };
    if (qpId) device.qpId = qpId.trim();
    doc.devices.push(device);
  }

  // Parse Rules (<Rules> or <QIFRules>)
  const rulesEl = findDescendants(rootElement, (c) => {
    const t = localName(c.name).toLowerCase();
    return t === "rules" || t === "qifrules";
  })[0];
  if (rulesEl) {
    doc.rules.range = makeRange(rulesEl.start, rulesEl.end, lineOffsets);
    const minTurStr =
      getAttr(rulesEl, "minTurRatio") ??
      getAttr(rulesEl, "minTur") ??
      getChildText(rulesEl, "MinTurRatio") ??
      getChildText(rulesEl, "MinTUR");
    if (minTurStr !== undefined && !Number.isNaN(Number(minTurStr))) {
      doc.rules.minTurRatio = Number(minTurStr);
    }
    for (const ftKey of ["Point", "Plane", "Circle", "Slot", "Sphere", "Cylinder", "Cone"]) {
      const attrVal = getAttr(rulesEl, ftKey) ?? getAttr(rulesEl, ftKey.toLowerCase());
      if (attrVal !== undefined && !Number.isNaN(Number(attrVal))) {
        doc.rules.minPointsPerFeature[ftKey] = Number(attrVal);
      }
    }
    const ruleItems = findDescendants(rulesEl, (c) => {
      const t = localName(c.name).toLowerCase();
      return t === "featurerule" || t === "minpointsrule" || t === "minpoints";
    });
    for (const rm of ruleItems) {
      const ft = getAttr(rm, "featureType") ?? getAttr(rm, "type") ?? getChildText(rm, "FeatureType");
      const pts = getAttr(rm, "minPoints") ?? getAttr(rm, "points") ?? getChildText(rm, "MinPoints") ?? rm.text.trim();
      if (ft && pts && !Number.isNaN(Number(pts))) {
        doc.rules.minPointsPerFeature[ft.trim()] = Number(pts);
      }
    }
  }

  // Parse PlanSteps (<PlanStep>, <MeasureFeatureStep>)
  const stepElements = findDescendants(rootElement, (c) => {
    const t = localName(c.name).toLowerCase();
    return t === "planstep" || t === "measurefeaturestep";
  });
  for (const el of stepElements) {
    const id = (getAttr(el, "id") ?? getChildText(el, "Id") ?? `S_${doc.planSteps.length + 1}`).trim();
    const stepNumStr =
      getAttr(el, "stepNumber") ??
      getAttr(el, "step") ??
      getChildText(el, "StepNumber") ??
      String(doc.planSteps.length + 1);
    const featureId = (
      getAttr(el, "featureId") ??
      getChildText(el, "FeatureId") ??
      getChildText(el, "FeatureNominalId") ??
      ""
    ).trim();
    const charId =
      getAttr(el, "characteristicId") ??
      getChildText(el, "CharacteristicId") ??
      getChildText(el, "CharacteristicNominalId");
    const deviceId = (
      getAttr(el, "deviceId") ??
      getChildText(el, "DeviceId") ??
      getChildText(el, "MeasurementDeviceId") ??
      ""
    ).trim();
    const ptsStr =
      getAttr(el, "probingPointCount") ??
      getAttr(el, "points") ??
      getChildText(el, "ProbingPointCount") ??
      getChildText(el, "NumberOfPoints") ??
      "0";

    const step: QifPlanStep = {
      id,
      stepNumber: Number(stepNumStr) || doc.planSteps.length + 1,
      featureId,
      deviceId,
      probingPointCount: Number(ptsStr) || 0,
      range: makeRange(el.start, el.end, lineOffsets),
    };
    if (charId) step.characteristicId = charId.trim();
    doc.planSteps.push(step);
  }

  // Parse Actuals
  const actualElements = findDescendants(rootElement, isActualElement);
  for (const el of actualElements) {
    const id = (getAttr(el, "id") ?? getChildText(el, "Id") ?? `A_${doc.actuals.length + 1}`).trim();
    const characteristicId = (
      getAttr(el, "characteristicId") ??
      getAttr(el, "characteristicNominalId") ??
      getChildText(el, "CharacteristicNominalId") ??
      getChildText(el, "CharacteristicId") ??
      ""
    ).trim();
    const partSerialNumber = (
      getAttr(el, "partSerialNumber") ??
      getAttr(el, "serialNumber") ??
      getAttr(el, "serial") ??
      getChildText(el, "PartSerialNumber") ??
      getChildText(el, "SerialNumber") ??
      "SN-001"
    ).trim();
    const valStr =
      getAttr(el, "measuredValue") ??
      getAttr(el, "value") ??
      getChildText(el, "MeasuredValue") ??
      getChildText(el, "Value") ??
      "0";
    const actualSizeStr =
      getAttr(el, "actualFeatureSize") ??
      getAttr(el, "actualSize") ??
      getChildText(el, "ActualFeatureSize") ??
      getChildText(el, "ActualSize");
    const devVecStr = getAttr(el, "deviationVector") ?? getAttr(el, "deviation") ?? getChildText(el, "DeviationVector");
    const statusRaw = getAttr(el, "status") ?? getChildText(el, "Status") ?? "PASS";

    const actual: QifCharacteristicActual = {
      id,
      characteristicId,
      partSerialNumber,
      measuredValue: Number(valStr) || 0,
      status: normalizeStatus(statusRaw),
      range: makeRange(el.start, el.end, lineOffsets),
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
      const datumRefsStr = kv.get("datumReferences") ?? kv.get("datums");
      if (datumRefsStr) {
        datum.datumReferences = parseListString(datumRefsStr);
      }
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
      const subgroupStr = kv.get("spcSubgroupSize") ?? kv.get("subgroupSize") ?? kv.get("subgroup");
      if (subgroupStr !== undefined && !Number.isNaN(Number(subgroupStr))) {
        characteristic.spcSubgroupSize = Number(subgroupStr);
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
  const regex = /"[^"]*"|'[^']*'|\([^()]*\)|\[[^[\]]*\]|\S+/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(line)) !== null) {
    tokens.push(m[0]);
  }
  return tokens;
}

function parseKeyValuePairs(line: string): Map<string, string> {
  const kv = new Map<string, string>();
  const regex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*("[^"]*"|'[^']*'|\([^()]*\)|\[[^[\]]*\]|\S+)/g;
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
