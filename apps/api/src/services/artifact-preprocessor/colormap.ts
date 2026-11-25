// SPDX-License-Identifier: AGPL-3.0-or-later

export function sampleScientificColormap(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  // 5-stop scientific rainbow/turbo ramp: deep blue -> cyan -> green -> amber -> crimson
  const stops: [number, [number, number, number]][] = [
    [0.0, [30, 64, 175]],
    [0.25, [14, 165, 233]],
    [0.5, [16, 185, 129]],
    [0.75, [245, 158, 11]],
    [1.0, [239, 68, 68]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i]!;
    const [t1, c1] = stops[i + 1]!;
    if (clamped >= t0 && clamped <= t1) {
      const u = (clamped - t0) / Math.max(1e-6, t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * u),
        Math.round(c0[1] + (c1[1] - c0[1]) * u),
        Math.round(c0[2] + (c1[2] - c0[2]) * u),
      ];
    }
  }
  return [239, 68, 68];
}
