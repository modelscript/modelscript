// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appendNmeaChecksum, nmea0183ToCsv, nmea0183ToGpx, nmea0183ToOpenDrive } from "../src/index.js";

const SAMPLE_STREAM = [
  appendNmeaChecksum("$GPGGA,120000,3723.2475,N,12158.3416,W,1,09,1.0,12.0,M,-30.0,M,,"),
  appendNmeaChecksum("$GPRMC,120000,A,3723.2475,N,12158.3416,W,10.0,090.0,221126,013.5,E"),
  appendNmeaChecksum("$GPGGA,120010,3723.2475,N,12158.3000,W,1,09,1.1,13.5,M,-30.0,M,,"),
  appendNmeaChecksum("$GPRMC,120010,A,3723.2475,N,12158.3000,W,10.5,090.0,221126,013.5,E"),
  appendNmeaChecksum("$GPGGA,120020,3723.2600,N,12158.2600,W,1,09,1.2,15.0,M,-30.0,M,,"),
].join("\n");

describe("@modelscript/nmea0183 Projections Suite (CSV, GPX, OpenDRIVE)", () => {
  it("projects decoded track to RFC 4180 CSV with WGS-84, ECEF, and ENU columns", () => {
    const csv = nmea0183ToCsv(SAMPLE_STREAM);
    const lines = csv.trim().split("\n");
    assert.strictEqual(lines.length, 4, "Expected header + 3 merged epochs");
    assert.ok(lines[0]!.includes("lat_deg,lon_deg,alt_m,ecef_x_m"));
    assert.ok(lines[1]!.includes("37.3874583"));
  });

  it("projects decoded track to valid GPX 1.1 XML", () => {
    const gpx = nmea0183ToGpx(SAMPLE_STREAM, "Harbor & Sea Trial");
    assert.ok(gpx.includes('version="1.1"'));
    assert.ok(gpx.includes("<name>Harbor &amp; Sea Trial</name>"));
    assert.ok(gpx.includes("<trkpt lat="));
    assert.ok(gpx.includes("<ele>12.000</ele>"));
    assert.ok(gpx.includes("<time>2026-11-22T12:00:00Z</time>"));
    assert.ok(gpx.includes("<hdop>1.00</hdop>"));
  });

  it("projects decoded ENU trajectory to ASAM OpenDRIVE 1.6 XML", () => {
    const xodr = nmea0183ToOpenDrive(SAMPLE_STREAM, "BayTrack");
    assert.ok(xodr.includes("<OpenDRIVE>"));
    assert.ok(xodr.includes('revMajor="1" revMinor="6"'));
    assert.ok(xodr.includes("<planView>"));
    assert.ok(xodr.includes("<line/>"));
    assert.ok(xodr.includes("<elevationProfile>"));
    assert.ok(xodr.includes("+proj=tmerc"));
  });
});
