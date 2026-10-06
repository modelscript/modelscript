// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Downsamples a 2D series using the Largest-Triangle-Three-Buckets (LTTB) algorithm.
 * Preserves visual peaks, troughs, and general waveform shape while dramatically
 * reducing Canvas2D rendering latency for high-sample datasets (>2000 points).
 */
export function lttbDecimate(data: { x: number; y: number }[], threshold: number): { x: number; y: number }[] {
  if (threshold >= data.length || threshold <= 2) {
    return data;
  }

  const sampled: { x: number; y: number }[] = [];
  const bucketSize = (data.length - 2) / (threshold - 2);

  // Always keep first point
  let aIdx = 0;
  sampled.push(data[aIdx]);

  for (let i = 0; i < threshold - 2; i++) {
    // Calculate point average for next bucket (bucket C)
    const cStart = Math.floor((i + 1) * bucketSize) + 1;
    const cEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, data.length);
    let avgX = 0;
    let avgY = 0;
    const cLen = cEnd - cStart;
    if (cLen > 0) {
      for (let c = cStart; c < cEnd; c++) {
        avgX += data[c].x;
        avgY += data[c].y;
      }
      avgX /= cLen;
      avgY /= cLen;
    } else {
      avgX = data[Math.min(cStart, data.length - 1)].x;
      avgY = data[Math.min(cStart, data.length - 1)].y;
    }

    // Find point in current bucket (bucket B) with maximum triangle area
    const bStart = Math.floor(i * bucketSize) + 1;
    const bEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, data.length);

    const aPt = data[aIdx];
    let maxArea = -1;
    let maxAreaIdx = bStart;

    for (let b = bStart; b < bEnd; b++) {
      const bPt = data[b];
      // Area of triangle formed by A, B, and avg(C)
      const area = Math.abs((aPt.x - avgX) * (bPt.y - aPt.y) - (aPt.x - bPt.x) * (avgY - aPt.y)) * 0.5;

      if (area > maxArea) {
        maxArea = area;
        maxAreaIdx = b;
      }
    }

    sampled.push(data[maxAreaIdx]);
    aIdx = maxAreaIdx;
  }

  // Always keep last point
  sampled.push(data[data.length - 1]);
  return sampled;
}
