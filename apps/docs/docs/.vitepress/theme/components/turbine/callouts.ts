// SPDX-License-Identifier: AGPL-3.0-or-later

export interface CalloutSpec {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  readonly anchor: readonly [number, number, number];
  readonly x: number;
  readonly side: 1 | -1;
}

/** True structural facts only — these strings are rendered as callouts. */
export const CALLOUTS: readonly CalloutSpec[] = [
  { key: "fan", title: "Fan", detail: "22 blades", anchor: [-1.92, 0.95, 0.35], x: -1.92, side: -1 },
  { key: "hpc", title: "HP compressor", detail: "7 stages", anchor: [-0.3, 0.52, 0.0], x: -0.3, side: 1 },
  { key: "combustor", title: "Combustor", detail: "annular", anchor: [0.75, 0.575, 0.0], x: 0.75, side: -1 },
  { key: "turbine", title: "Turbine", detail: "2 HP + 4 LP stages", anchor: [1.95, 0.64, 0.0], x: 1.62, side: 1 },
] as const;
