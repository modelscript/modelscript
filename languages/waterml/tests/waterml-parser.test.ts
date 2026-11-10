// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseWaterMl, parseWaterMlJson, parseWaterMlXml } from "../src/parser/waterml-parser.js";

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<wml2:Collection xmlns:wml2="http://www.opengis.net/waterml/2.0"
                 xmlns:gml="http://www.opengis.net/gml/3.2"
                 xmlns:om="http://www.opengis.net/om/2.0"
                 xmlns:xlink="http://www.w3.org/1999/xlink"
                 gml:id="COLLECTION_USGS_01646500">
  <gml:description>USGS Streamflow Gaging Station Telemetry</gml:description>
  <wml2:observationMember>
    <om:OM_Observation gml:id="OBS_DISCHARGE_01">
      <om:observedProperty xlink:title="Discharge"/>
      <om:featureOfInterest>
        <wml2:MonitoringPoint gml:id="MP_01646500">
          <gml:identifier>01646500</gml:identifier>
          <gml:name>POTOMAC RIVER NEAR WASH, DC LITTLE FALLS PUMP STA</gml:name>
          <wml2:shape>
            <gml:Point gml:id="P_01646500">
              <gml:pos>38.94977 -77.12763 11.5</gml:pos>
            </gml:Point>
          </wml2:shape>
        </wml2:MonitoringPoint>
      </om:featureOfInterest>
      <om:result>
        <wml2:MeasurementTimeseries gml:id="TS_POTOMAC_DISCHARGE">
          <wml2:defaultPointMetadata>
            <wml2:DefaultTVPMeasurementMetadata>
              <wml2:uom code="m3/s"/>
              <wml2:interpolationType xlink:title="Instantaneous"/>
            </wml2:DefaultTVPMeasurementMetadata>
          </wml2:defaultPointMetadata>
          <wml2:point>
            <wml2:MeasurementTVP>
              <wml2:time>2026-05-01T00:00:00Z</wml2:time>
              <wml2:value>142.5</wml2:value>
              <wml2:metadata>
                <wml2:TVPMeasurementMetadata>
                  <wml2:qualifier xlink:title="good"/>
                </wml2:TVPMeasurementMetadata>
              </wml2:metadata>
            </wml2:MeasurementTVP>
          </wml2:point>
          <wml2:point>
            <wml2:MeasurementTVP>
              <wml2:time>2026-05-01T01:00:00Z</wml2:time>
              <wml2:value>148.2</wml2:value>
              <wml2:metadata>
                <wml2:TVPMeasurementMetadata>
                  <wml2:qualifier xlink:title="good"/>
                </wml2:TVPMeasurementMetadata>
              </wml2:metadata>
            </wml2:MeasurementTVP>
          </wml2:point>
          <wml2:point>
            <wml2:MeasurementTVP>
              <wml2:time>2026-05-01T02:00:00Z</wml2:time>
              <wml2:value>155.0</wml2:value>
              <wml2:metadata>
                <wml2:TVPMeasurementMetadata>
                  <wml2:qualifier xlink:title="estimate"/>
                </wml2:TVPMeasurementMetadata>
              </wml2:metadata>
            </wml2:MeasurementTVP>
          </wml2:point>
        </wml2:MeasurementTimeseries>
      </om:result>
    </om:OM_Observation>
  </wml2:observationMember>
</wml2:Collection>`;

const SAMPLE_JSON = JSON.stringify({
  id: "COLLECTION_JSON_GAGE",
  value: {
    timeSeries: [
      {
        sourceInfo: {
          siteName: "DELAWARE RIVER AT TRENTON NJ",
          siteCode: [{ value: "01463500" }],
          geoLocation: {
            geogLocation: {
              latitude: "40.2217",
              longitude: "-74.7778",
            },
          },
        },
        variable: {
          variableName: "Streamflow, ft3/s",
          unit: { unitCode: "cfs" },
        },
        values: [
          {
            value: [
              { value: "5400", dateTime: "2026-06-01T12:00:00Z", qualifiers: ["A"] },
              { value: "5480", dateTime: "2026-06-01T13:00:00Z", qualifiers: ["A"] },
              { value: "5610", dateTime: "2026-06-01T14:00:00Z", qualifiers: ["P"] },
            ],
          },
        ],
      },
    ],
  },
});

describe("WaterML 2.0 Parser", () => {
  it("parses OGC WaterML 2.0 XML document", () => {
    const doc = parseWaterMlXml(SAMPLE_XML);
    assert.equal(doc.id, "COLLECTION_USGS_01646500");
    assert.equal(doc.timeSeriesList.length, 1);

    const ts = doc.timeSeriesList[0]!;
    assert.equal(ts.seriesId, "OBS_DISCHARGE_01");
    assert.equal(ts.observedProperty, "Discharge");
    assert.equal(ts.unit, "m3/s");
    assert.equal(ts.monitoringPoint.stationId, "01646500");
    assert.ok(ts.monitoringPoint.stationName.includes("POTOMAC RIVER"));
    assert.ok(Math.abs((ts.monitoringPoint.latitude ?? 0) - 38.94977) < 1e-4);
    assert.ok(Math.abs((ts.monitoringPoint.longitude ?? 0) - -77.12763) < 1e-4);
    assert.equal(ts.monitoringPoint.elevationM, 11.5);

    assert.equal(ts.points.length, 3);
    assert.equal(ts.points[0]!.value, 142.5);
    assert.equal(ts.points[0]!.quality, "good");
    assert.equal(ts.points[2]!.value, 155.0);
    assert.equal(ts.points[2]!.quality, "estimate");
  });

  it("parses USGS NWIS / WaterML JSON format", () => {
    const doc = parseWaterMlJson(SAMPLE_JSON);
    assert.equal(doc.timeSeriesList.length, 1);

    const ts = doc.timeSeriesList[0]!;
    assert.equal(ts.monitoringPoint.stationId, "01463500");
    assert.ok(ts.monitoringPoint.stationName.includes("DELAWARE RIVER"));
    assert.equal(ts.unit, "cfs");
    assert.equal(ts.points.length, 3);
    assert.equal(ts.points[0]!.value, 5400);
    assert.equal(ts.points[2]!.quality, "estimate");
  });

  it("auto-detects XML vs JSON in unified parseWaterMl function", () => {
    const docXml = parseWaterMl(SAMPLE_XML);
    const docJson = parseWaterMl(SAMPLE_JSON);

    assert.equal(docXml.timeSeriesList.length, 1);
    assert.equal(docJson.timeSeriesList.length, 1);
  });
});
