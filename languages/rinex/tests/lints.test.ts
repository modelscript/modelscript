// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RinexErrorCode, lintRinex } from "../src/lints/index.js";
import { parseRinex } from "../src/parser/index.js";

function headerLine(data: string, label: string): string {
  return data.padEnd(60, " ") + label;
}

describe("RINEX v2 Semantic & Physical Bounds Linter (RNX1001-RNX5006)", () => {
  it("reports zero errors on a valid RINEX v2 OBS file", () => {
    const obs = [
      headerLine("     2.11           OBSERVATION DATA    G (GPS)", "RINEX VERSION / TYPE"),
      headerLine("WTZR", "MARKER NAME"),
      headerLine("  4075580.4890   931853.8610  4801568.1760", "APPROX POSITION XYZ"),
      headerLine("     1    C1", "# / TYPES OF OBSERV"),
      headerLine("", "END OF HEADER"),
      " 24  5  1  0  0  0.0000000  0  4G01G05G12G24",
      "  21456789.123 7",
      "  22891234.567 8",
      "  23123456.789 6",
      "  20567890.321 9",
    ].join("\n");

    const diags = lintRinex(parseRinex(obs));
    assert.strictEqual(diags.length, 0);
  });

  it("flags missing RINEX VERSION / TYPE (RNX2001) and END OF HEADER (RNX2002)", () => {
    const bad = headerLine("WTZR", "MARKER NAME");
    const diags = lintRinex(parseRinex(bad));
    assert.ok(diags.some((d) => d.code === RinexErrorCode.MISSING_VERSION_HEADER.code));
    assert.ok(diags.some((d) => d.code === RinexErrorCode.MISSING_END_OF_HEADER.code));
  });

  it("flags unsupported RINEX version (RNX2003)", () => {
    const v3 = [
      headerLine("     3.04           OBSERVATION DATA    M (MIXED)", "RINEX VERSION / TYPE"),
      headerLine("", "END OF HEADER"),
    ].join("\n");
    const diags = lintRinex(parseRinex(v3));
    assert.ok(diags.some((d) => d.code === RinexErrorCode.UNSUPPORTED_VERSION.code));
  });

  it("flags <4 satellites (RNX3001), invalid PRN (RNX3002), non-monotonic epochs (RNX4001), and out-of-range pseudorange (RNX5001)", () => {
    const obs = [
      headerLine("     2.11           OBSERVATION DATA    G (GPS)", "RINEX VERSION / TYPE"),
      headerLine("  4075580.4890   931853.8610  4801568.1760", "APPROX POSITION XYZ"),
      headerLine("     1    C1", "# / TYPES OF OBSERV"),
      headerLine("", "END OF HEADER"),
      " 24  5  1  0  0 30.0000000  0  2G01G99",
      "  12000000.000 7",
      "  42000000.000 7",
      " 24  5  1  0  0 15.0000000  0  4G01G02G03G04",
      "  21000000.000 7",
      "  22000000.000 7",
      "  23000000.000 7",
      "  24000000.000 7",
    ].join("\n");

    const diags = lintRinex(parseRinex(obs));
    assert.ok(diags.some((d) => d.code === RinexErrorCode.FEWER_THAN_FOUR_SATELLITES.code));
    assert.ok(diags.some((d) => d.code === RinexErrorCode.INVALID_SATELLITE_PRN.code));
    assert.ok(diags.some((d) => d.code === RinexErrorCode.NON_MONOTONIC_EPOCH.code));
    const prErrs = diags.filter((d) => d.code === RinexErrorCode.OUT_OF_RANGE_PSEUDORANGE.code);
    assert.strictEqual(prErrs.length, 2);
  });

  it("flags invalid eccentricity e >= 1 (RNX5002) and unhealthy satellite (RNX5004) in NAV", () => {
    const nav = [
      headerLine("     2.11           N: GPS NAV DATA", "RINEX VERSION / TYPE"),
      headerLine("", "END OF HEADER"),
      " 3 24  5  1  0  0  0.0 0.000000000000D+00 0.000000000000D+00 0.000000000000D+00",
      "    1.000000000000D+01 0.000000000000D+00 0.000000000000D+00 0.000000000000D+00",
      "    0.000000000000D+00 1.050000000000D+00 0.000000000000D+00 5.153650000000D+03",
      "    2.592000000000D+05 0.000000000000D+00 0.000000000000D+00 0.000000000000D+00",
      "    9.599310885969D-01 0.000000000000D+00 0.000000000000D+00 0.000000000000D+00",
      "    0.000000000000D+00 1.000000000000D+00 2.312000000000D+03 0.000000000000D+00",
      "    2.000000000000D+00 1.000000000000D+00 0.000000000000D+00 1.000000000000D+01",
      "    2.520000000000D+05 4.000000000000D+00",
    ].join("\n");

    const diags = lintRinex(parseRinex(nav));
    assert.ok(diags.some((d) => d.code === RinexErrorCode.INVALID_ECCENTRICITY.code));
    assert.ok(diags.some((d) => d.code === RinexErrorCode.UNHEALTHY_SATELLITE.code));
  });
});
