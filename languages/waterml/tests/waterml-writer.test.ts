// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseWaterMl } from "../src/parser/waterml-parser.js";
import { writeWaterMlXml } from "../src/parser/waterml-writer.js";
import type { WaterMlDocument } from "../src/types.js";

describe("WaterML 2.0 Serializer", () => {
  it("serializes WaterMlDocument into valid WaterML 2.0 XML", () => {
    const doc: WaterMlDocument = {
      id: "COLLECTION_ROUNDTRIP",
      title: "Roundtrip Test Collection",
      generationDate: new Date("2026-05-01T00:00:00Z"),
      timeSeriesList: [
        {
          seriesId: "TS_01",
          observedProperty: "Discharge",
          unit: "m3/s",
          interpolationType: "Continuous",
          monitoringPoint: {
            stationId: "STATION_ALPHA",
            stationName: "Alpha Hydrologic Station",
            latitude: 45.123,
            longitude: -93.456,
            elevationM: 250.0,
          },
          points: [
            { time: new Date("2026-05-01T00:00:00Z"), value: 25.4, quality: "good" },
            { time: new Date("2026-05-01T01:00:00Z"), value: 28.1, quality: "good" },
            { time: new Date("2026-05-01T02:00:00Z"), value: 31.9, quality: "estimate" },
          ],
        },
      ],
    };

    const xml = writeWaterMlXml(doc);
    assert.ok(xml.includes("wml2:Collection"));
    assert.ok(xml.includes('gml:id="COLLECTION_ROUNDTRIP"'));
    assert.ok(xml.includes("STATION_ALPHA"));
    assert.ok(xml.includes("45.123 -93.456 250"));
    assert.ok(xml.includes("25.4"));
    assert.ok(xml.includes("28.1"));
    assert.ok(xml.includes("31.9"));

    // Roundtrip verification
    const parsed = parseWaterMl(xml);
    assert.equal(parsed.id, "COLLECTION_ROUNDTRIP");
    assert.equal(parsed.timeSeriesList.length, 1);
    const ts = parsed.timeSeriesList[0]!;
    assert.equal(ts.monitoringPoint.stationId, "STATION_ALPHA");
    assert.equal(ts.points.length, 3);
    assert.equal(ts.points[0]!.value, 25.4);
    assert.equal(ts.points[1]!.value, 28.1);
    assert.equal(ts.points[2]!.value, 31.9);
  });
});
