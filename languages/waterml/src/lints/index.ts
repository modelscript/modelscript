// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic Linter for OGC WaterML 2.0 / TimeseriesML Documents.
 */

import type { RatingCurve, WaterMlDocument, WaterTimeSeries } from "../types.js";

export interface WaterMlDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  seriesId?: string | undefined;
  sampleIndex?: number | undefined;
}

export const WaterMlErrorCode = {
  EMPTY_COLLECTION: "WML1001",
  MISSING_SERIES_ID: "WML1002",
  NON_MONOTONIC_TIME: "WML2001",
  NEGATIVE_OBSERVATION: "WML3001",
  INVALID_RATING_CURVE: "WML4001",
} as const;

export const WATERML_ERROR_CODES = WaterMlErrorCode;

/**
 * Lints a WaterTimeSeries for monotonicity, non-negativity, and metadata completeness.
 */
export function lintWaterTimeSeries(series: WaterTimeSeries): WaterMlDiagnostic[] {
  const diagnostics: WaterMlDiagnostic[] = [];

  if (!series.seriesId || series.seriesId.trim().length === 0) {
    diagnostics.push({
      code: WaterMlErrorCode.MISSING_SERIES_ID,
      severity: "error",
      message: "Timeseries is missing a valid identifier (seriesId).",
    });
  }

  const isDischarge =
    series.observedProperty.toLowerCase().includes("discharge") ||
    series.observedProperty.toLowerCase().includes("flow");

  for (let i = 0; i < series.points.length; i++) {
    const pt = series.points[i]!;

    // Monotonicity check
    if (i > 0) {
      const prev = series.points[i - 1]!;
      if (pt.time.getTime() <= prev.time.getTime()) {
        diagnostics.push({
          code: WaterMlErrorCode.NON_MONOTONIC_TIME,
          severity: "error",
          message: `Non-monotonic timestamp detected at index ${i}: ${pt.time.toISOString()} <= ${prev.time.toISOString()}.`,
          seriesId: series.seriesId,
          sampleIndex: i,
        });
      }
    }

    // Negative discharge check (physical impossibility in non-tidal open channels)
    if (isDischarge && pt.value < 0) {
      diagnostics.push({
        code: WaterMlErrorCode.NEGATIVE_OBSERVATION,
        severity: "warning",
        message: `Negative streamflow discharge (${pt.value} ${series.unit}) observed at index ${i}.`,
        seriesId: series.seriesId,
        sampleIndex: i,
      });
    }
  }

  return diagnostics;
}

/**
 * Lints an entire WaterMlDocument.
 */
export function lintWaterMlDocument(doc: WaterMlDocument): WaterMlDiagnostic[] {
  const diagnostics: WaterMlDiagnostic[] = [];

  if (!doc.id || doc.id.trim().length === 0) {
    diagnostics.push({
      code: WaterMlErrorCode.EMPTY_COLLECTION,
      severity: "warning",
      message: "WaterML document has an empty or unspecified collection ID.",
    });
  }

  if (doc.timeSeriesList.length === 0) {
    diagnostics.push({
      code: WaterMlErrorCode.EMPTY_COLLECTION,
      severity: "error",
      message: "WaterML collection contains no observation time series.",
    });
    return diagnostics;
  }

  for (const series of doc.timeSeriesList) {
    diagnostics.push(...lintWaterTimeSeries(series));
  }

  return diagnostics;
}

/**
 * Lints a RatingCurve definition.
 */
export function lintRatingCurve(curve: RatingCurve): WaterMlDiagnostic[] {
  const diagnostics: WaterMlDiagnostic[] = [];

  if (curve.equation) {
    if (curve.equation.a <= 0) {
      diagnostics.push({
        code: WaterMlErrorCode.INVALID_RATING_CURVE,
        severity: "error",
        message: `Rating curve coefficient 'a' must be positive (got ${curve.equation.a}).`,
      });
    }
    if (curve.equation.b <= 0) {
      diagnostics.push({
        code: WaterMlErrorCode.INVALID_RATING_CURVE,
        severity: "error",
        message: `Rating curve exponent 'b' must be positive (got ${curve.equation.b}).`,
      });
    }
  }

  return diagnostics;
}
