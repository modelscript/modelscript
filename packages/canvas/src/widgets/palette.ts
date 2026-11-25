// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared colour palette consumed by the Canvas2D widget painters (`paintCanvasPlot`,
 * `paintCanvasTable`) so that board themes (dark 2D canvas, light studio desk,
 * blueprint VR desk) can restyle widgets without forking their drawing code.
 */
export interface CanvasWidgetPalette {
  /** Widget frame fill. */
  background: string;
  /** Widget frame hairline. */
  border: string;
  /** Plot grid lines. */
  grid: string;
  /** Primary text (titles, cell text). */
  text: string;
  /** Secondary text (axis ticks, column headers). */
  mutedText: string;
  /** Table title bar fill. */
  headerBackground: string;
  /** Alternating table row stripe fill. */
  stripe: string;
  /** Brushed / highlighted row text colour. */
  highlightText: string;
}

export const DARK_WIDGET_PALETTE: Readonly<CanvasWidgetPalette> = {
  background: "#0b1220",
  border: "#334155",
  grid: "rgba(148,163,184,0.16)",
  text: "#e2e8f0",
  mutedText: "#94a3b8",
  headerBackground: "#1e293b",
  stripe: "rgba(255,255,255,0.03)",
  highlightText: "#fef3c7",
};

export const LIGHT_WIDGET_PALETTE: Readonly<CanvasWidgetPalette> = {
  background: "#ffffff",
  border: "#cbd5e1",
  grid: "rgba(15,23,42,0.1)",
  text: "#0f172a",
  mutedText: "#475569",
  headerBackground: "#f1f5f9",
  stripe: "rgba(15,23,42,0.03)",
  highlightText: "#92400e",
};

/** Resolves the effective widget palette from the legacy `dark` flag plus optional overrides. */
export function resolveCanvasWidgetPalette(
  dark: boolean,
  overrides?: Partial<CanvasWidgetPalette> | undefined,
): CanvasWidgetPalette {
  const base = dark ? DARK_WIDGET_PALETTE : LIGHT_WIDGET_PALETTE;
  return overrides ? { ...base, ...overrides } : { ...base };
}
