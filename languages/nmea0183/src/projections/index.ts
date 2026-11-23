// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Polyglot Projections for @modelscript/nmea0183:
 * - RFC 4180 CSV track telemetry table (`nmea0183ToCsv`)
 * - GPX 1.1 XML track exchange (`nmea0183ToGpx`)
 * - ASAM OpenDRIVE 1.6 `.xodr` road trajectory geometry (`nmea0183ToOpenDrive`)
 */

import { solveNmeaTrack } from "../solver/index.js";
import type { Nmea0183Document, NmeaTrackEpoch } from "../types.js";

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatIsoUtc(utcRaw?: string, dateRaw?: string): string | undefined {
  if (!utcRaw || utcRaw.length < 6) return undefined;
  const hh = utcRaw.slice(0, 2);
  const mm = utcRaw.slice(2, 4);
  const ss = utcRaw.slice(4);
  let datePart = "1970-01-01";
  if (dateRaw && /^\d{6}$/.test(dateRaw)) {
    const dd = dateRaw.slice(0, 2);
    const mo = dateRaw.slice(2, 4);
    const yy = Number.parseInt(dateRaw.slice(4, 6), 10);
    const yyyy = yy >= 80 ? 1900 + yy : 2000 + yy;
    datePart = `${yyyy}-${mo}-${dd}`;
  }
  return `${datePart}T${hh}:${mm}:${ss}Z`;
}

/**
 * Projects decoded NMEA 0183 track epochs to RFC 4180 CSV with WGS-84, ECEF, ENU, and kinematics columns.
 */
export function nmea0183ToCsv(docOrSource: Nmea0183Document | string): string {
  const track = solveNmeaTrack(docOrSource);
  const header = [
    "epoch",
    "line",
    "utc_raw",
    "utc_sec",
    "lat_deg",
    "lon_deg",
    "alt_m",
    "ecef_x_m",
    "ecef_y_m",
    "ecef_z_m",
    "enu_e_m",
    "enu_n_m",
    "enu_u_m",
    "sog_knots",
    "cog_deg",
    "hdop",
    "fix_quality",
    "cum_dist_m",
  ].join(",");

  const rows = track.epochs.map((ep: NmeaTrackEpoch) =>
    [
      ep.index,
      ep.line,
      ep.utcRaw ?? "",
      ep.utcSeconds !== undefined ? ep.utcSeconds.toFixed(3) : "",
      ep.latDeg.toFixed(7),
      ep.lonDeg.toFixed(7),
      ep.altM.toFixed(3),
      ep.ecef.x.toFixed(3),
      ep.ecef.y.toFixed(3),
      ep.ecef.z.toFixed(3),
      ep.enu.e.toFixed(3),
      ep.enu.n.toFixed(3),
      ep.enu.u.toFixed(3),
      ep.sogKnots !== undefined ? ep.sogKnots.toFixed(3) : "",
      ep.cogDeg !== undefined
        ? ep.cogDeg.toFixed(2)
        : ep.computedBearingDeg !== undefined
          ? ep.computedBearingDeg.toFixed(2)
          : "",
      ep.hdop !== undefined ? ep.hdop.toFixed(2) : "",
      ep.fixQuality !== undefined ? ep.fixQuality : "",
      ep.cumulativeDistanceM.toFixed(3),
    ].join(","),
  );

  return [header, ...rows].join("\n") + "\n";
}

/**
 * Projects decoded NMEA 0183 track epochs to GPX 1.1 XML.
 */
export function nmea0183ToGpx(docOrSource: Nmea0183Document | string, trackName: string = "NMEA 0183 Track"): string {
  const track = solveNmeaTrack(docOrSource);
  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<gpx version="1.1" creator="ModelScript @modelscript/nmea0183" xmlns="http://www.topografix.com/GPX/1/1">`,
    `  <metadata>`,
    `    <name>${escapeXml(trackName)}</name>`,
    `  </metadata>`,
    `  <trk>`,
    `    <name>${escapeXml(trackName)}</name>`,
    `    <trkseg>`,
  ];

  for (const ep of track.epochs) {
    lines.push(`      <trkpt lat="${ep.latDeg.toFixed(7)}" lon="${ep.lonDeg.toFixed(7)}">`);
    lines.push(`        <ele>${ep.altM.toFixed(3)}</ele>`);
    const iso = formatIsoUtc(ep.utcRaw, ep.dateRaw);
    if (iso) {
      lines.push(`        <time>${iso}</time>`);
    }
    if (ep.hdop !== undefined) {
      lines.push(`        <hdop>${ep.hdop.toFixed(2)}</hdop>`);
    }
    if (ep.satellitesUsed !== undefined) {
      lines.push(`        <sat>${ep.satellitesUsed}</sat>`);
    }
    lines.push(`      </trkpt>`);
  }

  lines.push(`    </trkseg>`);
  lines.push(`  </trk>`);
  lines.push(`</gpx>`);
  return lines.join("\n") + "\n";
}

/**
 * Projects decoded NMEA 0183 ENU trajectory segments to an ASAM OpenDRIVE 1.6 `.xodr` road geometry.
 */
export function nmea0183ToOpenDrive(
  docOrSource: Nmea0183Document | string,
  roadName: string = "NMEA0183_Trajectory",
): string {
  const track = solveNmeaTrack(docOrSource);
  const geometries: string[] = [];
  const elevations: string[] = [];

  let sCursor = 0;
  for (let i = 0; i < track.epochs.length - 1; i++) {
    const a = track.epochs[i]!;
    const b = track.epochs[i + 1]!;
    const dx = b.enu.e - a.enu.e;
    const dy = b.enu.n - a.enu.n;
    const dz = b.enu.u - a.enu.u;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    // OpenDRIVE heading: counter-clockwise radians from +X (East)
    const hdg = Math.atan2(dy, dx);
    geometries.push(
      `      <geometry s="${sCursor.toFixed(4)}" x="${a.enu.e.toFixed(4)}" y="${a.enu.n.toFixed(4)}" hdg="${hdg.toFixed(6)}" length="${len.toFixed(4)}">`,
      `        <line/>`,
      `      </geometry>`,
    );
    const slope = dz / len;
    elevations.push(
      `      <elevation s="${sCursor.toFixed(4)}" a="${a.enu.u.toFixed(4)}" b="${slope.toFixed(6)}" c="0.0" d="0.0"/>`,
    );
    sCursor += len;
  }

  const totalLength = Math.max(sCursor, 0.001);
  const geoRef = track.origin
    ? `+proj=tmerc +lat_0=${track.origin.latDeg.toFixed(7)} +lon_0=${track.origin.lonDeg.toFixed(7)} +datum=WGS84 +units=m +no_defs`
    : "+proj=tmerc +lat_0=0 +lon_0=0 +datum=WGS84 +units=m +no_defs";

  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<OpenDRIVE>`,
    `  <header revMajor="1" revMinor="6" name="${escapeXml(roadName)}" version="1.00" north="${(track.bounds?.maxN ?? 0).toFixed(3)}" south="${(track.bounds?.minN ?? 0).toFixed(3)}" east="${(track.bounds?.maxE ?? 0).toFixed(3)}" west="${(track.bounds?.minE ?? 0).toFixed(3)}">`,
    `    <geoReference><![CDATA[${geoRef}]]></geoReference>`,
    `  </header>`,
    `  <road name="${escapeXml(roadName)}" length="${totalLength.toFixed(4)}" id="1" junction="-1">`,
    `    <planView>`,
    ...(geometries.length > 0
      ? geometries
      : [
          `      <geometry s="0.0000" x="0.0000" y="0.0000" hdg="0.000000" length="0.0010">`,
          `        <line/>`,
          `      </geometry>`,
        ]),
    `    </planView>`,
    `    <elevationProfile>`,
    ...(elevations.length > 0 ? elevations : [`      <elevation s="0.0000" a="0.0000" b="0.000000" c="0.0" d="0.0"/>`]),
    `    </elevationProfile>`,
    `    <lanes>`,
    `      <laneSection s="0.0">`,
    `        <center>`,
    `          <lane id="0" type="none" level="false"/>`,
    `        </center>`,
    `        <right>`,
    `          <lane id="-1" type="driving" level="false">`,
    `            <width sOffset="0.0" a="3.5" b="0.0" c="0.0" d="0.0"/>`,
    `          </lane>`,
    `        </right>`,
    `      </laneSection>`,
    `    </lanes>`,
    `  </road>`,
    `</OpenDRIVE>`,
  ];

  return lines.join("\n") + "\n";
}
