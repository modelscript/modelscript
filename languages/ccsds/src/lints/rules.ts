// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ccsds — Pre-Flight Diagnostic Linters (M8201–M8208).
 *
 * Implements strict aerospace astrodynamics and telemetry dictionary validation
 * following OpenModelica diagnostic formatting conventions.
 */

import type { CcsdsDocument, CcsdsRange } from "../types.js";

export interface CcsdsDiagnostic {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  range: CcsdsRange;
}

const EARTH_RADIUS_KM = 6378.137;
const VALID_REF_FRAMES = new Set(["EME2000", "GCRF", "ITRF", "TEME", "TOD", "J2000", "ICRF", "TDR"]);

export function lintCcsds(doc: CcsdsDocument): CcsdsDiagnostic[] {
  const diags: CcsdsDiagnostic[] = [];

  if (doc.format === "XTCE") {
    // 1. Check duplicate parameter names (M8207)
    const seenParams = new Map<string, CcsdsRange>();
    for (const p of doc.parameters) {
      const lower = p.name.toLowerCase();
      if (seenParams.has(lower)) {
        diags.push({
          code: "M8207",
          rule: "duplicate-parameter-name",
          severity: "error",
          message: `Duplicate telemetry parameter declaration for '${p.name}'.`,
          range: p.range,
        });
      } else {
        seenParams.set(lower, p.range);
      }
    }

    // 2. Check telemetry bit-packing overlap (M8202)
    for (const c of doc.containers) {
      for (let i = 0; i < c.entries.length - 1; i++) {
        const e1 = c.entries[i]!;
        const e2 = c.entries[i + 1]!;
        const end1 = e1.bitOffset + e1.bitLength;
        if (e2.bitOffset < end1) {
          diags.push({
            code: "M8202",
            rule: "telemetry-bit-packing-overlap",
            severity: "error",
            message: `Telemetry bit packing overlap in container '${c.name}': entry '${e2.parameterRef}' starts at bit ${e2.bitOffset} before previous entry '${e1.parameterRef}' ends at bit ${end1}.`,
            range: c.range,
          });
        }
      }
    }

    return diags;
  }

  // CCSDS KVN (OEM, OPM, OMM)
  // Check reference frame (M8204)
  const refFrame = doc.metadata.refFrame.toUpperCase();
  if (!VALID_REF_FRAMES.has(refFrame)) {
    diags.push({
      code: "M8204",
      rule: "unrecognized-reference-frame",
      severity: "error",
      message: `Unrecognized or non-inertial reference frame '${doc.metadata.refFrame}'.`,
      range: doc.range,
    });
  }

  // Check spacecraft mass (M8208)
  if (doc.format === "OPM" || doc.format === "OMM") {
    if (doc.spacecraft?.massKg !== undefined && doc.spacecraft.massKg <= 0) {
      diags.push({
        code: "M8208",
        rule: "negative-spacecraft-mass",
        severity: "error",
        message: `Spacecraft mass ${doc.spacecraft.massKg} kg must be strictly positive.`,
        range: doc.range,
      });
    }
  }

  // Check Keplerian elements (M8201, M8203)
  const keplerian = doc.format === "OPM" ? doc.keplerian : doc.format === "OMM" ? doc.meanElements : undefined;

  if (keplerian) {
    const a = keplerian.semiMajorAxisKm;
    const e = keplerian.eccentricity;

    if (e >= 1.0) {
      diags.push({
        code: "M8203",
        rule: "hyperbolic-unbounded-orbit",
        severity: "warning",
        message: `Orbit eccentricity ${e.toFixed(4)} indicates a hyperbolic or parabolic trajectory.`,
        range: doc.range,
      });
    } else if (a > 0) {
      const rp = a * (1.0 - e);
      if (rp < EARTH_RADIUS_KM) {
        diags.push({
          code: "M8201",
          rule: "sub-orbital-impact-trajectory",
          severity: "error",
          message: `Sub-orbital pericenter radius ${rp.toFixed(1)} km is below Earth radius ${EARTH_RADIUS_KM} km, resulting in atmospheric re-entry or impact.`,
          range: doc.range,
        });
      }
    }
  }

  // Check OEM Ephemeris Monotonicity (M8206) and missing epochs (M8205)
  if (doc.format === "OEM") {
    for (let i = 0; i < doc.points.length; i++) {
      const pt = doc.points[i]!;
      if (!pt.epoch || Number.isNaN(pt.epochSeconds) || pt.epochSeconds === 0) {
        diags.push({
          code: "M8205",
          rule: "missing-epoch-timestamp",
          severity: "error",
          message: `Ephemeris point missing valid timestamp at index ${i}.`,
          range: pt.range,
        });
      }

      if (i > 0) {
        const prev = doc.points[i - 1]!;
        if (pt.epochSeconds <= prev.epochSeconds) {
          diags.push({
            code: "M8206",
            rule: "non-monotonic-ephemeris-epochs",
            severity: "error",
            message: `Ephemeris timestamp '${pt.epoch}' is not strictly greater than previous timestamp '${prev.epoch}'.`,
            range: pt.range,
          });
        }
      }
    }
  }

  return diags;
}
