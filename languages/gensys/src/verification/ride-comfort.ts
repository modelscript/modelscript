// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Calculates Sperling's ride comfort index Wz for railway vehicles:
 *   Wz = (a^3 * B(f)^3)^{1/10} = (a * B(f))^0.3
 * where:
 *   a = acceleration amplitude [cm/s^2]
 *   f = frequency [Hz]
 *   B(f) = frequency weighting factor for human sensitivity
 */
export function calculateSperlingRideIndex(
  accelerationMPerS2: number,
  frequencyHz: number,
  direction: "vertical" | "horizontal" = "vertical",
): number {
  if (accelerationMPerS2 <= 0 || frequencyHz <= 0) return 1.0;

  // Convert m/s^2 to cm/s^2
  const a = accelerationMPerS2 * 100;
  const f = frequencyHz;

  // Frequency weighting factor B(f) per Sperling
  let B: number;
  if (direction === "vertical") {
    if (f < 0.5) B = 0;
    else if (f <= 5.9) B = 0.588 * Math.sqrt(1.911 * f * f + 0.25 * (f * f - 1) * (f * f - 1));
    else if (f <= 20) B = (1 / f) * 1.911 * Math.sqrt(2 * f);
    else B = 125 / (f * f);
  } else {
    // Horizontal weighting
    if (f < 0.5) B = 0;
    else if (f <= 5.4) B = 0.743 * Math.sqrt(1.911 * f * f + 0.25 * (f * f - 1) * (f * f - 1));
    else if (f <= 26) B = (1 / f) * 2.5 * Math.sqrt(2 * f);
    else B = 100 / (f * f);
  }

  // Wz = 0.896 * (a^3 * B^3)^(1/10) (standard formula scaling)
  const wz = 0.896 * Math.pow(Math.max(1e-9, a * B), 0.3);
  return Math.max(1.0, wz);
}
