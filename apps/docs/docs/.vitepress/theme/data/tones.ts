// SPDX-License-Identifier: AGPL-3.0-or-later
/** Illustration hues defined as `--hue-*` tokens in theme/style.css (light/dark aware). */
export type Hue = "indigo" | "cyan" | "teal" | "emerald" | "amber" | "rose" | "violet";

/** A two-tone pairing: primary carries the subject, accent marks the key insight. */
export type Tone = readonly [primary: Hue, accent: Hue];

/** Inline style that scopes `--tone-p` / `--tone-a` to a card. */
export function toneStyle([primary, accent]: Tone): Record<string, string> {
  return {
    "--tone-p": `var(--hue-${primary})`,
    "--tone-a": `var(--hue-${accent})`,
  };
}
