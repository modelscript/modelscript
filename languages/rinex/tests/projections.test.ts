// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRinexTimestamp, parseRinex } from "../src/parser/index.js";
import { computeNmeaChecksum, rinexToCcsdsOem, rinexToCsv, rinexToNmea } from "../src/projections/index.js";
import { computeSatelliteEcef, geodeticToEcef, solveReceiverPosition } from "../src/solver/index.js";
import type { RinexNavEphemeris, SatellitePseudorange } from "../src/types.js";

function makeEphem(prn: number, omega0: number, m0: number): RinexNavEphemeris {
  const toc = buildRinexTimestamp(24, 5, 1, 12, 30, 0);
  return {
    prn: `G${String(prn).padStart(2, "0")}`,
    prnNumber: prn,
    toc,
    af0: 0,
    af1: 0,
    af2: 0,
    iode: 1,
    crs: 0,
    deltaN: 0,
    m0,
    cuc: 0,
    e: 0.005,
    cus: 0,
    sqrtA: 5153.65,
    toe: toc.gpsTow,
    cic: 0,
    omega0,
    cis: 0,
    i0: (55 * Math.PI) / 180,
    crc: 0,
    omega: 0.5,
    omegaDot: 0,
    idot: 0,
    codesL2: 1,
    gpsWeek: toc.gpsWeek,
    l2pFlag: 0,
    svAccuracy: 2,
    svHealth: 0,
    tgd: 0,
    iodc: 1,
    transmissionTime: toc.gpsTow,
    fitInterval: 4,
    line: 1,
  };
}

describe("RINEX v2 Polyglot Projections (NMEA 0183, CCSDS OEM, CSV)", () => {
  it("projects position solutions to NMEA 0183 ($GPGGA & $GPGSA) with valid XOR checksums", () => {
    const trueEcef = geodeticToEcef({ latDeg: 37.7749, lonDeg: -122.4194, altM: 52.0 });
    const ephems = [makeEphem(1, 0.3, 0.5), makeEphem(5, 1.5, 1.0), makeEphem(12, 2.8, 0.8), makeEphem(24, 4.2, 1.3)];
    const obs: SatellitePseudorange[] = ephems.map((ep) => {
      const sv = computeSatelliteEcef(ep, ep.toe);
      const rho = Math.hypot(sv.position.x - trueEcef.x, sv.position.y - trueEcef.y, sv.position.z - trueEcef.z);
      return { prn: sv.prn, satPos: sv.position, pseudorangeM: rho };
    });
    const sol = { ...solveReceiverPosition(obs, trueEcef), timestamp: ephems[0]!.toc };

    const nmea = rinexToNmea(sol);
    const lines = nmea.trim().split("\n");
    assert.strictEqual(lines.length, 2);
    assert.ok(lines[0]!.startsWith("$GPGGA,123000.00,"));
    assert.ok(lines[1]!.startsWith("$GPGSA,A,3,"));

    for (const line of lines) {
      const starIdx = line.indexOf("*");
      assert.ok(starIdx > 1);
      const body = line.slice(1, starIdx);
      const expected = computeNmeaChecksum(body);
      assert.strictEqual(line.slice(starIdx + 1), expected);
    }
  });

  it("projects GPS broadcast ephemerides to CCSDS OEM v2.0", () => {
    const ephems = [makeEphem(1, 0.3, 0.5)];
    const oem = rinexToCcsdsOem(ephems, { samples: 3, stepSec: 600 });
    assert.ok(oem.includes("CCSDS_OEM_VERS = 2.0"));
    assert.ok(oem.includes("META_START"));
    assert.ok(oem.includes("OBJECT_NAME          = GPS-G01"));
    assert.ok(oem.includes("REF_FRAME            = ITRF2000"));
    assert.ok(oem.includes("META_STOP"));
    assert.ok(oem.includes("2024-05-01T12:30:00.000"));
    assert.ok(oem.includes("2024-05-01T12:40:00.000"));
  });

  it("projects RINEX OBS documents and position solutions to CSV", () => {
    const obsText = [
      "     2.11           OBSERVATION DATA    G (GPS)".padEnd(60, " ") + "RINEX VERSION / TYPE",
      "     2    C1    L1".padEnd(60, " ") + "# / TYPES OF OBSERV",
      "".padEnd(60, " ") + "END OF HEADER",
      " 24  5  1  0  0  0.0000000  0  2G01G05",
      "  21456789.123 7 112756123.45607",
      "  22891234.567 8 120293456.78908",
    ].join("\n");

    const doc = parseRinex(obsText);
    const csv = rinexToCsv(doc);
    assert.ok(csv.startsWith("epoch,prn,C1,L1\n"));
    assert.ok(csv.includes("G01,21456789.123,112756123.456"));
    assert.ok(csv.includes("G05,22891234.567,120293456.789"));
  });
});
