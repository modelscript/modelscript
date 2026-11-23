// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRinexTimestamp,
  detectRinexFileType,
  expandRinexYear,
  parseFortranFloat,
  parseRinex,
  parseRinexNav,
  parseRinexObs,
} from "../src/parser/index.js";

function headerLine(data: string, label: string): string {
  return data.padEnd(60, " ") + label;
}

const SAMPLE_OBS = [
  headerLine("     2.11           OBSERVATION DATA    G (GPS)", "RINEX VERSION / TYPE"),
  headerLine("MS-RINEX            MODELSCRIPT         20240501 000000 UTC", "PGM / RUN BY / DATE"),
  headerLine("WTZR", "MARKER NAME"),
  headerLine("  4075580.4890   931853.8610  4801568.1760", "APPROX POSITION XYZ"),
  headerLine("        0.0710        0.0000        0.0000", "ANTENNA: DELTA H/E/N"),
  headerLine("     4    C1    P1    L1    S1", "# / TYPES OF OBSERV"),
  headerLine("  2024     5     1     0     0    0.0000000     GPS", "TIME OF FIRST OBS"),
  headerLine("", "END OF HEADER"),
  " 24  5  1  0  0  0.0000000  0  4G01G05G12G24",
  "  21456789.123 7  21456789.456 7 112756123.45607        45.250",
  "  22891234.567 8  22891234.890 8 120293456.78908        47.500",
  "  23123456.789 6  23123456.901 6 121512345.67806        42.100",
  "  20567890.321 9  20567890.654 9 108084321.12309        49.800",
  " 24  5  1  0  0 30.0000000  0  4G01G05G12G24",
  "  21448123.456 7  21448123.789 7 112710567.89007        45.500",
  "  22885678.901 8  22885679.123 8 120264123.45608        47.600",
  "  23131234.567 6  23131234.890 6 121553210.98706        42.000",
  "  20572345.678 9  20572345.901 9 108107654.32109        49.900",
].join("\n");

const SAMPLE_NAV = [
  headerLine("     2.11           N: GPS NAV DATA", "RINEX VERSION / TYPE"),
  headerLine("MS-RINEX            MODELSCRIPT         20240501 000000 UTC", "PGM / RUN BY / DATE"),
  headerLine("    1.1176D-08  1.4901D-08 -5.9605D-08 -1.1921D-07", "ION ALPHA"),
  headerLine("    9.0112D+04  1.6384D+04 -1.9661D+05 -1.3107D+05", "ION BETA"),
  headerLine("", "END OF HEADER"),
  " 1 24  5  1  0  0  0.0 1.234567890123D-04-2.345678901234D-12 0.000000000000D+00",
  "    4.200000000000D+01 1.562500000000D+01 4.512345678901D-09 1.047197551197D+00",
  "    8.123456789012D-07 4.250000000000D-03 6.543210987654D-06 5.153650000000D+03",
  "    2.592000000000D+05 1.234567890123D-08 5.235987755983D-01-2.345678901234D-08",
  "    9.599310885969D-01 2.456250000000D+02 7.853981633974D-01-8.123456789012D-09",
  "    1.234567890123D-10 1.000000000000D+00 2.312000000000D+03 0.000000000000D+00",
  "    2.000000000000D+00 0.000000000000D+00-5.587935447693D-09 4.200000000000D+01",
  "    2.520000000000D+05 4.000000000000D+00",
].join("\n");

describe("RINEX v2 Fixed-Column Parser", () => {
  it("expands 2-digit RINEX years and parses Fortran D exponents", () => {
    assert.strictEqual(expandRinexYear(89), 1989);
    assert.strictEqual(expandRinexYear(99), 1999);
    assert.strictEqual(expandRinexYear(0), 2000);
    assert.strictEqual(expandRinexYear(24), 2024);
    assert.strictEqual(expandRinexYear(2024), 2024);
    assert.ok(Math.abs(parseFortranFloat("1.2345D-04") - 1.2345e-4) < 1e-16);
    assert.ok(Math.abs(parseFortranFloat("-5.15365d+03") + 5153.65) < 1e-12);
  });

  it("detects OBS vs NAV file types from RINEX VERSION / TYPE header", () => {
    assert.strictEqual(detectRinexFileType(SAMPLE_OBS), "O");
    assert.strictEqual(detectRinexFileType(SAMPLE_NAV), "N");
  });

  it("parses RINEX v2 OBS header, epochs, PRNs, pseudoranges, and LLI/SSI", () => {
    const doc = parseRinexObs(SAMPLE_OBS);
    assert.strictEqual(doc.fileType, "O");
    assert.strictEqual(doc.header.version, 2.11);
    assert.strictEqual(doc.header.markerName, "WTZR");
    assert.deepStrictEqual(doc.header.observationTypes, ["C1", "P1", "L1", "S1"]);
    assert.ok(doc.header.approxPositionXyz);
    assert.ok(Math.abs(doc.header.approxPositionXyz.x - 4075580.489) < 1e-6);
    assert.ok(doc.header.antennaDeltaHen);
    assert.ok(Math.abs(doc.header.antennaDeltaHen.h - 0.071) < 1e-6);
    assert.strictEqual(doc.epochs.length, 2);
    assert.strictEqual(doc.epochs[0]!.satellites.length, 4);
    assert.strictEqual(doc.epochs[0]!.satellites[0]!.prn, "G01");
    assert.ok(Math.abs(doc.epochs[0]!.satellites[0]!.observations["C1"]!.value - 21456789.123) < 1e-6);
    assert.strictEqual(doc.epochs[0]!.satellites[0]!.observations["C1"]!.ssi, 7);
    assert.strictEqual(doc.parseIssues.length, 0);
  });

  it("parses RINEX v2 NAV 8-line GPS broadcast Keplerian ephemeris records", () => {
    const doc = parseRinexNav(SAMPLE_NAV);
    assert.strictEqual(doc.fileType, "N");
    assert.strictEqual(doc.header.version, 2.11);
    assert.ok(doc.header.ionAlpha);
    assert.ok(doc.header.ionBeta);
    assert.strictEqual(doc.ephemerides.length, 1);
    const ep = doc.ephemerides[0]!;
    assert.strictEqual(ep.prn, "G01");
    assert.strictEqual(ep.prnNumber, 1);
    assert.ok(Math.abs(ep.sqrtA - 5153.65) < 1e-9);
    assert.ok(Math.abs(ep.e - 0.00425) < 1e-12);
    assert.strictEqual(ep.toe, 259200);
    assert.strictEqual(ep.gpsWeek, 2312);
    assert.strictEqual(ep.svHealth, 0);
    assert.strictEqual(doc.parseIssues.length, 0);
  });

  it("computes consistent GPS week and time-of-week timestamps", () => {
    const ts = buildRinexTimestamp(24, 5, 1, 0, 0, 0);
    assert.strictEqual(ts.year, 2024);
    assert.strictEqual(ts.gpsWeek, 2312);
    assert.strictEqual(ts.gpsTow, 259200);
    const autoDoc = parseRinex(SAMPLE_OBS);
    assert.strictEqual(autoDoc.epochs[0]!.timestamp.gpsTow, 259200);
  });
});
