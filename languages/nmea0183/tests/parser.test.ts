// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendNmeaChecksum,
  computeNmeaChecksum,
  ddmmToDecimalDegrees,
  decimalDegreesToDdmm,
  parseNmea0183,
  parseUtcTime,
  verifyNmeaChecksum,
} from "../src/index.js";

describe("@modelscript/nmea0183 Parser Suite", () => {
  it("computes and verifies NMEA 0183 XOR checksums accurately", () => {
    const body = "GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,";
    assert.strictEqual(computeNmeaChecksum(body), "47");

    const full = `$${body}*47`;
    const check = verifyNmeaChecksum(full);
    assert.strictEqual(check.hasChecksum, true);
    assert.strictEqual(check.valid, true);
    assert.strictEqual(check.expected, "47");
    assert.strictEqual(check.actual, "47");

    const appended = appendNmeaChecksum(`$${body}`);
    assert.strictEqual(appended, full);
  });

  it("converts ddmm.mmmm and dddmm.mmmm coordinates to/from decimal degrees", () => {
    const lat = ddmmToDecimalDegrees("4807.038", "N", false);
    assert.ok(lat !== undefined);
    assert.ok(Math.abs(lat - (48 + 7.038 / 60)) < 1e-9);

    const lonW = ddmmToDecimalDegrees("12225.1640", "W", true);
    assert.ok(lonW !== undefined);
    assert.ok(Math.abs(lonW - -(122 + 25.164 / 60)) < 1e-9);

    const roundTrip = decimalDegreesToDdmm(lonW, true, 4);
    assert.strictEqual(roundTrip.hemisphere, "W");
    assert.strictEqual(roundTrip.value, "12225.1640");

    // Out-of-range coordinates rejected
    assert.strictEqual(ddmmToDecimalDegrees("9100.000", "N", false), undefined);
    assert.strictEqual(ddmmToDecimalDegrees("4860.000", "N", false), undefined);
    assert.strictEqual(ddmmToDecimalDegrees("18100.000", "E", true), undefined);
  });

  it("parses UTC timestamps with optional fractional seconds", () => {
    assert.strictEqual(parseUtcTime("123519"), 12 * 3600 + 35 * 60 + 19);
    assert.ok(Math.abs((parseUtcTime("000001.250") ?? 0) - 1.25) < 1e-9);
    assert.strictEqual(parseUtcTime("250000"), undefined);
  });

  it("decodes all 8 standard NMEA 0183 sentence formatters and AIS ! delimiter", () => {
    const sample = [
      "# Sample NMEA 0183 marine telemetry stream",
      appendNmeaChecksum("$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,"),
      appendNmeaChecksum("$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W"),
      appendNmeaChecksum("$GPGSA,A,3,04,05,,09,12,,,24,,,,,2.5,1.3,2.1"),
      appendNmeaChecksum("$GPGSV,2,1,08,01,40,083,46,02,17,308,41,12,07,344,39,14,22,228,45"),
      appendNmeaChecksum("$GPVTG,054.7,T,034.4,M,005.5,N,010.2,K"),
      appendNmeaChecksum("$HCHDG,101.1,7.1,E,12.6,W"),
      appendNmeaChecksum("$SDDBT,36.4,f,11.1,M,6.0,F"),
      appendNmeaChecksum("$IIMWV,045.0,R,12.5,N,A"),
      appendNmeaChecksum("!AIVDM,1,1,,B,177KQJ5000G?tO`K>RA1wUbN0TKH,0"),
    ].join("\n");

    const doc = parseNmea0183(sample);
    assert.strictEqual(doc.parseErrors.length, 0);
    assert.strictEqual(doc.sentences.length, 9);
    assert.strictEqual(doc.satellites.length, 4);

    assert.strictEqual(doc.sentences[0]!.payload.kind, "GGA");
    if (doc.sentences[0]!.payload.kind === "GGA") {
      assert.strictEqual(doc.sentences[0]!.payload.fixQuality, 1);
      assert.strictEqual(doc.sentences[0]!.payload.satellitesUsed, 8);
      assert.strictEqual(doc.sentences[0]!.payload.hdop, 0.9);
      assert.strictEqual(doc.sentences[0]!.payload.altitudeM, 545.4);
    }

    assert.strictEqual(doc.sentences[1]!.payload.kind, "RMC");
    if (doc.sentences[1]!.payload.kind === "RMC") {
      assert.strictEqual(doc.sentences[1]!.payload.status, "A");
      assert.strictEqual(doc.sentences[1]!.payload.speedKnots, 22.4);
      assert.strictEqual(doc.sentences[1]!.payload.courseDeg, 84.4);
    }

    assert.strictEqual(doc.sentences[2]!.payload.kind, "GSA");
    if (doc.sentences[2]!.payload.kind === "GSA") {
      assert.deepStrictEqual(doc.sentences[2]!.payload.satellitePrns, [4, 5, 9, 12, 24]);
      assert.strictEqual(doc.sentences[2]!.payload.pdop, 2.5);
    }

    assert.strictEqual(doc.sentences[5]!.payload.kind, "HDG");
    assert.strictEqual(doc.sentences[6]!.payload.kind, "DBT");
    assert.strictEqual(doc.sentences[7]!.payload.kind, "MWV");
    assert.strictEqual(doc.sentences[8]!.delimiter, "!");
    assert.strictEqual(doc.sentences[8]!.talker, "AI");
    assert.strictEqual(doc.sentences[8]!.formatter, "VDM");
  });
});
