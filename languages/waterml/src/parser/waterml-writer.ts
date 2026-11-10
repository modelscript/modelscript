// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * OGC WaterML 2.0 XML Serializer.
 */

import type { WaterMlDocument } from "../types.js";

/**
 * Serializes a WaterMlDocument into standard OGC WaterML 2.0 XML.
 */
export function writeWaterMlXml(doc: WaterMlDocument): string {
  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(
    `<wml2:Collection xmlns:wml2="http://www.opengis.net/waterml/2.0" xmlns:gml="http://www.opengis.net/gml/3.2" xmlns:om="http://www.opengis.net/om/2.0" xmlns:xlink="http://www.w3.org/1999/xlink" gml:id="${doc.id}">`,
  );

  if (doc.title) {
    lines.push(`  <gml:description>${doc.title}</gml:description>`);
  }

  for (let idx = 0; idx < doc.timeSeriesList.length; idx++) {
    const ts = doc.timeSeriesList[idx]!;
    const mp = ts.monitoringPoint;
    const obsId = `OBS_${idx + 1}`;
    const tsId = ts.seriesId;

    lines.push(`  <wml2:observationMember>`);
    lines.push(`    <om:OM_Observation gml:id="${obsId}">`);
    lines.push(`      <om:observedProperty xlink:title="${ts.observedProperty}"/>`);
    lines.push(`      <om:featureOfInterest>`);
    lines.push(`        <wml2:MonitoringPoint gml:id="MP_${mp.stationId}">`);
    lines.push(`          <gml:identifier>${mp.stationId}</gml:identifier>`);
    lines.push(`          <gml:name>${mp.stationName}</gml:name>`);
    if (mp.latitude !== undefined && mp.longitude !== undefined) {
      lines.push(`          <wml2:shape>`);
      lines.push(`            <gml:Point gml:id="P_${mp.stationId}">`);
      lines.push(
        `              <gml:pos>${mp.latitude} ${mp.longitude}${mp.elevationM ? ` ${mp.elevationM}` : ""}</gml:pos>`,
      );
      lines.push(`            </gml:Point>`);
      lines.push(`          </wml2:shape>`);
    }
    lines.push(`        </wml2:MonitoringPoint>`);
    lines.push(`      </om:featureOfInterest>`);
    lines.push(`      <om:result>`);
    lines.push(`        <wml2:MeasurementTimeseries gml:id="${tsId}">`);
    lines.push(`          <wml2:defaultPointMetadata>`);
    lines.push(`            <wml2:DefaultTVPMeasurementMetadata>`);
    lines.push(`              <wml2:uom code="${ts.unit}"/>`);
    lines.push(`              <wml2:interpolationType xlink:title="${ts.interpolationType}"/>`);
    lines.push(`            </wml2:DefaultTVPMeasurementMetadata>`);
    lines.push(`          </wml2:defaultPointMetadata>`);

    for (const pt of ts.points) {
      lines.push(`          <wml2:point>`);
      lines.push(`            <wml2:MeasurementTVP>`);
      lines.push(`              <wml2:time>${pt.time.toISOString()}</wml2:time>`);
      lines.push(`              <wml2:value>${pt.value}</wml2:value>`);
      lines.push(`              <wml2:metadata>`);
      lines.push(`                <wml2:TVPMeasurementMetadata>`);
      lines.push(`                  <wml2:qualifier xlink:title="${pt.quality}"/>`);
      lines.push(`                </wml2:TVPMeasurementMetadata>`);
      lines.push(`              </wml2:metadata>`);
      lines.push(`            </wml2:MeasurementTVP>`);
      lines.push(`          </wml2:point>`);
    }

    lines.push(`        </wml2:MeasurementTimeseries>`);
    lines.push(`      </om:result>`);
    lines.push(`    </om:OM_Observation>`);
    lines.push(`  </wml2:observationMember>`);
  }

  lines.push(`</wml2:Collection>`);
  return lines.join("\n") + "\n";
}
