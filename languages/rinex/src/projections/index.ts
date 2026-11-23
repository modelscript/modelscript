// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Polyglot projections for `@modelscript/rinex`:
 * - `rinexToNmea`: NMEA 0183 `$GPGGA` & `$GPGSA` sentences with XOR `*XX` checksums
 * - `rinexToCcsdsOem`: CCSDS Orbit Ephemeris Message (`CCSDS_OEM_VERS = 2.0`)
 * - `rinexToCsv`: Tabular CSV export of RINEX observations or position fix solutions
 */

import { formatRinexTimestamp } from "../parser/index.js";
import { computeSatelliteEcef } from "../solver/index.js";
import type { RinexDocument, RinexNavEphemeris, RinexPositionSolution } from "../types.js";

/**
 * Computes the NMEA 0183 two-hex-digit XOR checksum for a sentence body (without leading `$` or trailing `*`).
 */
export function computeNmeaChecksum(body: string): string {
  let xor = 0;
  for (let i = 0; i < body.length; i++) {
    xor ^= body.charCodeAt(i);
  }
  return xor.toString(16).toUpperCase().padStart(2, "0");
}

function formatNmeaCoord(degAbs: number, degDigits: number): string {
  const degrees = Math.floor(degAbs);
  const minutes = (degAbs - degrees) * 60.0;
  const degStr = String(degrees).padStart(degDigits, "0");
  const minWhole = Math.floor(minutes);
  const minFrac = minutes - minWhole;
  const minStr = `${String(minWhole).padStart(2, "0")}.${minFrac.toFixed(4).slice(2)}`;
  return `${degStr}${minStr}`;
}

function formatNmeaTime(solution: RinexPositionSolution): string {
  const ts = solution.timestamp;
  if (!ts) return "000000.00";
  const hh = String(ts.hour).padStart(2, "0");
  const mm = String(ts.minute).padStart(2, "0");
  const ss = ts.second.toFixed(2).padStart(5, "0");
  return `${hh}${mm}${ss}`;
}

/**
 * Projects one or more `RinexPositionSolution` fixes to NMEA 0183 (`$GPGGA` + `$GPGSA`).
 */
export function rinexToNmea(solutions: RinexPositionSolution | RinexPositionSolution[]): string {
  const list = Array.isArray(solutions) ? solutions : [solutions];
  const lines: string[] = [];

  for (const sol of list) {
    const timeStr = formatNmeaTime(sol);
    const latNs = sol.geodetic.latDeg >= 0 ? "N" : "S";
    const lonEw = sol.geodetic.lonDeg >= 0 ? "E" : "W";
    const latStr = formatNmeaCoord(Math.abs(sol.geodetic.latDeg), 2);
    const lonStr = formatNmeaCoord(Math.abs(sol.geodetic.lonDeg), 3);
    const fixQuality = sol.converged ? "1" : "0";
    const numSats = String(Math.min(12, sol.satellites.length)).padStart(2, "0");
    const hdop = Number.isFinite(sol.dop.hdop) ? sol.dop.hdop.toFixed(2) : "99.99";
    const alt = sol.geodetic.altM.toFixed(2);

    const ggaBody = `GPGGA,${timeStr},${latStr},${latNs},${lonStr},${lonEw},${fixQuality},${numSats},${hdop},${alt},M,0.0,M,,`;
    lines.push(`$${ggaBody}*${computeNmeaChecksum(ggaBody)}`);

    const prnSlots: string[] = [];
    for (let i = 0; i < 12; i++) {
      const sat = sol.satellites[i];
      prnSlots.push(sat ? sat.prn.replace(/^[A-Z]/, "") : "");
    }
    const pdop = Number.isFinite(sol.dop.pdop) ? sol.dop.pdop.toFixed(2) : "99.99";
    const vdop = Number.isFinite(sol.dop.vdop) ? sol.dop.vdop.toFixed(2) : "99.99";
    const fixMode = sol.converged && sol.satellites.length >= 4 ? "3" : "1";
    const gsaBody = `GPGSA,A,${fixMode},${prnSlots.join(",")},${pdop},${hdop},${vdop}`;
    lines.push(`$${gsaBody}*${computeNmeaChecksum(gsaBody)}`);
  }

  return lines.join("\n") + "\n";
}

export interface RinexToCcsdsOemOptions {
  originator?: string | undefined;
  /** Number of propagated samples per ephemeris (default 5). */
  samples?: number | undefined;
  /** Time step between samples in seconds (default 900 s = 15 min). */
  stepSec?: number | undefined;
}

function formatCcsdsEpoch(baseEpochSec: number, offsetSec: number): string {
  const d = new Date((baseEpochSec + offsetSec) * 1000);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const ms = String(d.getUTCMilliseconds()).padStart(3, "0");
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}.${ms}`;
}

/**
 * Projects GPS broadcast ephemerides to CCSDS Orbit Ephemeris Message (`CCSDS_OEM_VERS = 2.0`).
 * State vectors are emitted in ITRF/ECEF kilometers and km/s.
 */
export function rinexToCcsdsOem(ephemerides: RinexNavEphemeris[], options: RinexToCcsdsOemOptions = {}): string {
  const originator = options.originator ?? "MODELSCRIPT-RINEX";
  const samples = Math.max(1, options.samples ?? 5);
  const stepSec = options.stepSec ?? 900;
  const creationDate = "2024-01-01T00:00:00.000";

  const lines: string[] = [
    "CCSDS_OEM_VERS = 2.0",
    `CREATION_DATE  = ${creationDate}`,
    `ORIGINATOR     = ${originator}`,
    "",
  ];

  for (const ephem of ephemerides) {
    const startTime = formatCcsdsEpoch(ephem.toc.epochSec, 0);
    const stopTime = formatCcsdsEpoch(ephem.toc.epochSec, (samples - 1) * stepSec);

    lines.push("META_START");
    lines.push(`OBJECT_NAME          = GPS-${ephem.prn}`);
    lines.push(`OBJECT_ID            = ${ephem.prn}`);
    lines.push("CENTER_NAME          = EARTH");
    lines.push("REF_FRAME            = ITRF2000");
    lines.push("TIME_SYSTEM          = GPS");
    lines.push(`START_TIME           = ${startTime}`);
    lines.push(`STOP_TIME            = ${stopTime}`);
    lines.push("INTERPOLATION        = HERMITE");
    lines.push("INTERPOLATION_DEGREE = 5");
    lines.push("META_STOP");
    lines.push("");

    for (let k = 0; k < samples; k++) {
      const dt = k * stepSec;
      const sv = computeSatelliteEcef(ephem, ephem.toe + dt);
      const epochStr = formatCcsdsEpoch(ephem.toc.epochSec, dt);
      const xKm = (sv.position.x / 1000).toFixed(6);
      const yKm = (sv.position.y / 1000).toFixed(6);
      const zKm = (sv.position.z / 1000).toFixed(6);
      const vxKm = (sv.velocity.x / 1000).toFixed(6);
      const vyKm = (sv.velocity.y / 1000).toFixed(6);
      const vzKm = (sv.velocity.z / 1000).toFixed(6);
      lines.push(`${epochStr} ${xKm} ${yKm} ${zKm} ${vxKm} ${vyKm} ${vzKm}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Projects a RINEX document (OBS or NAV) or a solved `RinexPositionSolution` to CSV.
 */
export function rinexToCsv(doc: RinexDocument, solution?: RinexPositionSolution): string {
  if (solution) {
    const rows = ["prn,azimuth_deg,elevation_deg,pseudorange_m,computed_range_m,residual_m,sat_x_m,sat_y_m,sat_z_m"];
    for (const sat of solution.satellites) {
      rows.push(
        [
          sat.prn,
          sat.azimuthDeg.toFixed(3),
          sat.elevationDeg.toFixed(3),
          sat.pseudorangeM.toFixed(4),
          sat.computedRangeM.toFixed(4),
          sat.residualM.toFixed(6),
          sat.satPos.x.toFixed(3),
          sat.satPos.y.toFixed(3),
          sat.satPos.z.toFixed(3),
        ].join(","),
      );
    }
    return rows.join("\n") + "\n";
  }

  if (doc.fileType === "N") {
    const rows = ["prn,toc,gps_week,toe_s,sqrtA,e,i0_rad,omega0_rad,omega_rad,m0_rad,af0_s,sv_health"];
    for (const ep of doc.ephemerides) {
      rows.push(
        [
          ep.prn,
          formatRinexTimestamp(ep.toc),
          ep.gpsWeek,
          ep.toe.toFixed(3),
          ep.sqrtA.toFixed(6),
          ep.e.toExponential(8),
          ep.i0.toFixed(8),
          ep.omega0.toFixed(8),
          ep.omega.toFixed(8),
          ep.m0.toFixed(8),
          ep.af0.toExponential(6),
          ep.svHealth,
        ].join(","),
      );
    }
    return rows.join("\n") + "\n";
  }

  const obsTypes = doc.header.observationTypes;
  const rows = [`epoch,prn,${obsTypes.join(",")}`];
  for (const ep of doc.epochs) {
    const ts = formatRinexTimestamp(ep.timestamp);
    for (const sat of ep.satellites) {
      const vals = obsTypes.map((t) => {
        const v = sat.observations[t];
        return v !== undefined ? v.value.toFixed(3) : "";
      });
      rows.push(`${ts},${sat.prn},${vals.join(",")}`);
    }
  }
  return rows.join("\n") + "\n";
}
