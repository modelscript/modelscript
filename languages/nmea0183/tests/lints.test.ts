// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Nmea0183ErrorCode, appendNmeaChecksum, lintNmea0183 } from "../src/index.js";

describe("@modelscript/nmea0183 Linter Suite (NMEA1001–NMEA5006)", () => {
  it("produces zero diagnostics for a valid telemetry log", () => {
    const valid = [
      appendNmeaChecksum("$GPGGA,120000,3723.2475,N,12158.3416,W,1,09,1.1,15.0,M,-30.0,M,,"),
      appendNmeaChecksum("$GPRMC,120000,A,3723.2475,N,12158.3416,W,10.5,090.0,221126,013.5,E"),
      appendNmeaChecksum("$GPGGA,120005,3723.2475,N,12158.3200,W,1,09,1.2,15.2,M,-30.0,M,,"),
      appendNmeaChecksum("$GPGSV,1,1,02,05,45,120,42,13,60,240,39"),
    ].join("\n");

    const diags = lintNmea0183(valid);
    assert.strictEqual(diags.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(diags)}`);
  });

  it("detects syntax errors (NMEA1001), missing checksum (NMEA1002), and checksum mismatch (NMEA2001)", () => {
    const bad = [
      "NOT_A_VALID_SENTENCE",
      "$GPGGA,120000,3723.2475,N,12158.3416,W,1,08,1.0,10.0,M,0.0,M,,",
      "$GPGGA,120001,3723.2475,N,12158.3416,W,1,08,1.0,10.0,M,0.0,M,,*00",
    ].join("\n");

    const diags = lintNmea0183(bad);
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has(Nmea0183ErrorCode.SYNTAX_ERROR.code));
    assert.ok(codes.has(Nmea0183ErrorCode.MISSING_CHECKSUM.code));
    assert.ok(codes.has(Nmea0183ErrorCode.CHECKSUM_MISMATCH.code));
  });

  it("detects >82-char sentences (NMEA2002), invalid lat/lon (NMEA3001/3002), and unknown talker/formatter (NMEA4001/4002)", () => {
    const longSentence = appendNmeaChecksum(
      "$ZZXYZ,1111111111,2222222222,3333333333,4444444444,5555555555,6666666666,7777777777,8888888888",
    );
    const badCoords = appendNmeaChecksum("$GPGGA,120000,9500.0000,N,18500.0000,E,1,08,1.0,10.0,M,0.0,M,,");

    const diags = lintNmea0183(`${longSentence}\n${badCoords}`);
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has(Nmea0183ErrorCode.SENTENCE_TOO_LONG.code));
    assert.ok(codes.has(Nmea0183ErrorCode.UNKNOWN_TALKER.code));
    assert.ok(codes.has(Nmea0183ErrorCode.UNKNOWN_FORMATTER.code));
    assert.ok(codes.has(Nmea0183ErrorCode.INVALID_LATITUDE.code));
    assert.ok(codes.has(Nmea0183ErrorCode.INVALID_LONGITUDE.code));
  });

  it("detects void GPS fix (NMEA5001), high HDOP (NMEA5002), non-monotonic UTC (NMEA5003), bad GSV geometry (NMEA5005), and unrealistic speed (NMEA5006)", () => {
    const stream = [
      appendNmeaChecksum("$GPGGA,120010,3723.2475,N,12158.3416,W,0,03,6.8,10.0,M,0.0,M,,"),
      appendNmeaChecksum("$GPRMC,120005,V,3723.2475,N,12158.3416,W,620.0,090.0,221126,013.5,E"),
      appendNmeaChecksum("$GPGSV,1,1,01,10,95,400,35"),
    ].join("\n");

    const diags = lintNmea0183(stream);
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has(Nmea0183ErrorCode.VOID_GPS_FIX.code));
    assert.ok(codes.has(Nmea0183ErrorCode.HIGH_HDOP.code));
    assert.ok(codes.has(Nmea0183ErrorCode.NON_MONOTONIC_TIMESTAMP.code));
    assert.ok(codes.has(Nmea0183ErrorCode.INVALID_SATELLITE_GEOMETRY.code));
    assert.ok(codes.has(Nmea0183ErrorCode.UNREALISTIC_SPEED.code));
  });
});
