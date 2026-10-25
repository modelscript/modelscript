// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TrackGeometry, TrackIrregularityPoint } from "../types.js";

/**
 * Parses track geometry and irregularity files (.geom, .trax).
 * Format: distance, alignment_left, alignment_right, vertical_left, vertical_right, cant, curvature
 */
export function parseTrackGeometry(source: string, name: string = "Track"): TrackGeometry {
  const points: TrackIrregularityPoint[] = [];
  const lines = source.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("%")) continue;

    const parts = line.split(/\s+/).map((v) => parseFloat(v));
    const [p0, p1, p2, p3, p4, p5, p6] = parts;
    if (
      p0 !== undefined &&
      p1 !== undefined &&
      p2 !== undefined &&
      p3 !== undefined &&
      p4 !== undefined &&
      p5 !== undefined &&
      p6 !== undefined &&
      !parts.some((n) => isNaN(n))
    ) {
      points.push({
        distance: p0,
        alignmentLeft: p1,
        alignmentRight: p2,
        verticalLeft: p3,
        verticalRight: p4,
        cant: p5,
        curvature: p6,
      });
    }
  }

  return {
    name,
    nominalGauge: 1.435,
    points,
  };
}
