// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * OGC WaterML 2.0 / TimeseriesML Parser.
 *
 * Ingests XML and JSON streamflow, stage, and groundwater hydrologic observation datasets
 * (compliant with OGC 12-031r4, WMO 1083, USGS NWIS, and Copernicus EFAS/GloFAS).
 */

import type {
  WaterInterpolationType,
  WaterMlDocument,
  WaterObservation,
  WaterQualityCode,
  WaterTimeSeries,
} from "../types.js";

/** Helper to parse attributes on an XML tag */
function parseXmlAttrs(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z0-9_:-]+)\s*=\s*["']([^"']*)["']/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(attrString)) !== null) {
    const key = match[1]!;
    attrs[key] = match[2]!;
  }
  return attrs;
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
  const colMatch = /<[a-zA-Z0-9_:-]*Collection\b([^>]*)>/i.exec(xmlText);
  if (colMatch && colMatch[1]) {
    const attrs = parseXmlAttrs(colMatch[1]);
    docId = attrs["gml:id"] || attrs["id"] || docId;
  }

  const timeSeriesList: WaterTimeSeries[] = [];

  // Find all OM_Observation blocks
  const obsRegex = /<[a-zA-Z0-9_:-]*OM_Observation\b([^>]*)>([\s\S]*?)<\/[a-zA-Z0-9_:-]*OM_Observation>/gi;
  let obsMatch: RegExpExecArray | null;

  while ((obsMatch = obsRegex.exec(xmlText)) !== null) {
    const obsAttrs = parseXmlAttrs(obsMatch[1] || "");
    const obsContent = obsMatch[2] || "";
    const seriesId = obsAttrs["gml:id"] || `TS_${timeSeriesList.length + 1}`;

    // Observed property
    let observedProperty = "Discharge";
    const propMatch = /<[a-zA-Z0-9_:-]*observedProperty\b([^>]*)\/?>/i.exec(obsContent);
    if (propMatch && propMatch[1]) {
      const pAttrs = parseXmlAttrs(propMatch[1]);
      observedProperty = pAttrs["xlink:title"] || pAttrs["title"] || "Discharge";
    }

    // Monitoring Point
    let stationId = "GAGE_01";
    let stationName = "Streamflow Station";
    let latitude: number | undefined;
    let longitude: number | undefined;
    let elevationM: number | undefined;

    const mpMatch = /<[a-zA-Z0-9_:-]*MonitoringPoint\b([^>]*)>([\s\S]*?)<\/[a-zA-Z0-9_:-]*MonitoringPoint>/i.exec(
      obsContent,
    );
    if (mpMatch) {
      const mpAttrs = parseXmlAttrs(mpMatch[1] || "");
      const mpContent = mpMatch[2] || "";
      stationId = mpAttrs["gml:id"] || stationId;

      const idMatch = /<[a-zA-Z0-9_:-]*identifier\b[^>]*>([^<]*)<\/[a-zA-Z0-9_:-]*identifier>/i.exec(mpContent);
      if (idMatch && idMatch[1]) stationId = idMatch[1].trim();

      const nameMatch = /<[a-zA-Z0-9_:-]*name\b[^>]*>([^<]*)<\/[a-zA-Z0-9_:-]*name>/i.exec(mpContent);
      if (nameMatch && nameMatch[1]) stationName = nameMatch[1].trim();

      const posMatch = /<[a-zA-Z0-9_:-]*pos\b[^>]*>([^<]*)<\/[a-zA-Z0-9_:-]*pos>/i.exec(mpContent);
      if (posMatch && posMatch[1]) {
        const parts = posMatch[1].trim().split(/\s+/);
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

    const uomMatch = /<[a-zA-Z0-9_:-]*uom\b([^>]*)\/?>/i.exec(obsContent);
    if (uomMatch && uomMatch[1]) {
      const uAttrs = parseXmlAttrs(uomMatch[1]);
      unit = uAttrs["code"] || uAttrs["uom"] || unit;
    }

    const interMatch = /<[a-zA-Z0-9_:-]*interpolationType\b([^>]*)\/?>/i.exec(obsContent);
    if (interMatch && interMatch[1]) {
      const iAttrs = parseXmlAttrs(interMatch[1]);
      const rawType = iAttrs["xlink:title"] || iAttrs["title"] || "Instantaneous";
      if (rawType.includes("Continuous")) interpolationType = "Continuous";
      else if (rawType.includes("Total")) interpolationType = "Total";
      else if (rawType.includes("Average")) interpolationType = "Average";
    }

    // Points: MeasurementTVP
    const points: WaterObservation[] = [];
    const tvpRegex = /<[a-zA-Z0-9_:-]*MeasurementTVP\b[^>]*>([\s\S]*?)<\/[a-zA-Z0-9_:-]*MeasurementTVP>/gi;
    let tvpMatch: RegExpExecArray | null;

    while ((tvpMatch = tvpRegex.exec(obsContent)) !== null) {
      const tvpContent = tvpMatch[1] || "";

      const timeMatch = /<[a-zA-Z0-9_:-]*time\b[^>]*>([^<]*)<\/[a-zA-Z0-9_:-]*time>/i.exec(tvpContent);
      const valMatch = /<[a-zA-Z0-9_:-]*value\b[^>]*>([^<]*)<\/[a-zA-Z0-9_:-]*value>/i.exec(tvpContent);

      if (timeMatch && timeMatch[1] && valMatch && valMatch[1]) {
        const time = new Date(timeMatch[1].trim());
        const value = parseFloat(valMatch[1].trim());

        let quality: WaterQualityCode = "good";
        const qualMatch = /<[a-zA-Z0-9_:-]*qualifier\b([^>]*)\/?>/i.exec(tvpContent);
        if (qualMatch && qualMatch[1]) {
          const qAttrs = parseXmlAttrs(qualMatch[1]);
          const qVal = (qAttrs["xlink:title"] || qAttrs["title"] || "").toLowerCase();
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
