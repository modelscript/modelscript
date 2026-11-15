// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * OGC WaterML 2.0 / TimeseriesML Parser.
 *
 * Ingests XML and JSON streamflow, stage, and groundwater hydrologic observation datasets
 * (compliant with OGC 12-031r4, WMO 1083, USGS NWIS, and Copernicus EFAS/GloFAS).
 */

import { parseXml, type XmlElement } from "@modelscript/dsl/xml";
import type {
  WaterInterpolationType,
  WaterMlDocument,
  WaterObservation,
  WaterQualityCode,
  WaterTimeSeries,
} from "../types.js";

function localName(name: string): string {
  const idx = name.indexOf(":");
  return idx >= 0 ? name.slice(idx + 1) : name;
}

function matchTag(el: XmlElement, target: string): boolean {
  const local = localName(el.name);
  return local === target || local.toLowerCase() === target.toLowerCase();
}

function getAttr(el: XmlElement, name: string): string | undefined {
  const exact = el.attributes.find((a) => a.name === name);
  if (exact) return exact.value;
  const targetLocal = localName(name);
  return el.attributes.find((a) => localName(a.name) === targetLocal)?.value;
}

function getExactAttr(el: XmlElement, name: string): string | undefined {
  return el.attributes.find((a) => a.name === name)?.value;
}

function findFirst(root: XmlElement, tagName: string): XmlElement | undefined {
  if (matchTag(root, tagName)) return root;
  for (const child of root.children) {
    const found = findFirst(child, tagName);
    if (found) return found;
  }
  return undefined;
}

function findDescendants(root: XmlElement, tagName: string): XmlElement[] {
  const out: XmlElement[] = [];
  if (matchTag(root, tagName)) {
    out.push(root);
    return out;
  }
  for (const child of root.children) {
    out.push(...findDescendants(child, tagName));
  }
  return out;
}

/**
 * Parses WaterML 2.0 content (XML or JSON) into a WaterMlDocument.
 */
export function parseWaterMl(content: string): WaterMlDocument {
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) {
    return parseWaterMlJson(trimmed);
  }
  return parseWaterMlXml(trimmed);
}

/**
 * Parses WaterML 2.0 XML.
 */
export function parseWaterMlXml(xmlText: string): WaterMlDocument {
  let docId = "WaterML2_Collection";
  const timeSeriesList: WaterTimeSeries[] = [];

  const xmlDoc = parseXml(xmlText);
  const root = xmlDoc.root;
  if (!root) {
    return {
      id: docId,
      generationDate: new Date(),
      timeSeriesList,
    };
  }

  const colEl = findFirst(root, "Collection");
  if (colEl) {
    docId = getExactAttr(colEl, "gml:id") || getAttr(colEl, "id") || docId;
  }

  // Find all OM_Observation blocks
  for (const obsEl of findDescendants(root, "OM_Observation")) {
    const seriesId = getExactAttr(obsEl, "gml:id") || `TS_${timeSeriesList.length + 1}`;

    // Observed property
    let observedProperty = "Discharge";
    const propEl = findFirst(obsEl, "observedProperty");
    if (propEl) {
      observedProperty = getExactAttr(propEl, "xlink:title") || getAttr(propEl, "title") || "Discharge";
    }

    // Monitoring Point
    let stationId = "GAGE_01";
    let stationName = "Streamflow Station";
    let latitude: number | undefined;
    let longitude: number | undefined;
    let elevationM: number | undefined;

    const mpEl = findFirst(obsEl, "MonitoringPoint");
    if (mpEl) {
      stationId = getExactAttr(mpEl, "gml:id") || stationId;

      const idEl = findFirst(mpEl, "identifier");
      const idText = idEl?.text.trim();
      if (idText) stationId = idText;

      const nameEl = findFirst(mpEl, "name");
      const nameText = nameEl?.text.trim();
      if (nameText) stationName = nameText;

      const posEl = findFirst(mpEl, "pos");
      const posText = posEl?.text.trim();
      if (posText) {
        const parts = posText.split(/\s+/);
        if (parts.length >= 2) {
          latitude = parseFloat(parts[0]!);
          longitude = parseFloat(parts[1]!);
          if (parts[2]) elevationM = parseFloat(parts[2]);
        }
      }
    }

    // MeasurementTimeseries
    let unit = "m3/s";
    let interpolationType: WaterInterpolationType = "Instantaneous";

    const uomEl = findFirst(obsEl, "uom");
    if (uomEl) {
      unit = getAttr(uomEl, "code") || getAttr(uomEl, "uom") || unit;
    }

    const interEl = findFirst(obsEl, "interpolationType");
    if (interEl) {
      const rawType = getExactAttr(interEl, "xlink:title") || getAttr(interEl, "title") || "Instantaneous";
      if (rawType.includes("Continuous")) interpolationType = "Continuous";
      else if (rawType.includes("Total")) interpolationType = "Total";
      else if (rawType.includes("Average")) interpolationType = "Average";
    }

    // Points: MeasurementTVP
    const points: WaterObservation[] = [];
    for (const tvpEl of findDescendants(obsEl, "MeasurementTVP")) {
      const timeText = findFirst(tvpEl, "time")?.text.trim();
      const valText = findFirst(tvpEl, "value")?.text.trim();

      if (timeText && valText) {
        const time = new Date(timeText);
        const value = parseFloat(valText);

        let quality: WaterQualityCode = "good";
        const qualEl = findFirst(tvpEl, "qualifier");
        if (qualEl) {
          const qVal = (getExactAttr(qualEl, "xlink:title") || getAttr(qualEl, "title") || "").toLowerCase();
          if (qVal.includes("suspect")) quality = "suspect";
          else if (qVal.includes("estimate")) quality = "estimate";
          else if (qVal.includes("missing")) quality = "missing";
        }

        points.push({ time, value, quality });
      }
    }

    timeSeriesList.push({
      seriesId,
      seriesName: `${stationName} - ${observedProperty}`,
      observedProperty,
      unit,
      interpolationType,
      monitoringPoint: {
        stationId,
        stationName,
        latitude,
        longitude,
        elevationM,
      },
      points,
    });
  }

  return {
    id: docId,
    generationDate: new Date(),
    timeSeriesList,
  };
}

/**
 * Parses WaterML 2.0 JSON or USGS NWIS JSON.
 */
export function parseWaterMlJson(jsonText: string): WaterMlDocument {
  const data = JSON.parse(jsonText);
  const timeSeriesList: WaterTimeSeries[] = [];

  // USGS NWIS JSON format: data.value.timeSeries
  const seriesArray = data?.value?.timeSeries ?? (Array.isArray(data?.timeSeries) ? data.timeSeries : []);

  for (const s of seriesArray) {
    const sourceInfo = s.sourceInfo;
    const variable = s.variable;
    const values = s.values?.[0]?.value ?? [];

    const stationId = sourceInfo?.siteCode?.[0]?.value ?? "GAGE_01";
    const stationName = sourceInfo?.siteName ?? "USGS Station";
    const lat = sourceInfo?.geoLocation?.geogLocation?.latitude;
    const lon = sourceInfo?.geoLocation?.geogLocation?.longitude;
    const propName = variable?.variableName ?? "Discharge";
    const unit = variable?.unit?.unitCode ?? "cfs";

    const points: WaterObservation[] = [];
    for (const v of values) {
      points.push({
        time: new Date(v.dateTime),
        value: parseFloat(v.value),
        quality: v.qualifiers?.[0]?.includes("P") ? "estimate" : "good",
      });
    }

    timeSeriesList.push({
      seriesId: `TS_${stationId}`,
      seriesName: `${stationName} - ${propName}`,
      observedProperty: propName,
      unit,
      interpolationType: "Instantaneous",
      monitoringPoint: {
        stationId,
        stationName,
        latitude: lat ? parseFloat(lat) : undefined,
        longitude: lon ? parseFloat(lon) : undefined,
      },
      points,
    });
  }

  return {
    id: data?.id ?? "WaterML_JSON",
    generationDate: new Date(),
    timeSeriesList,
  };
}
