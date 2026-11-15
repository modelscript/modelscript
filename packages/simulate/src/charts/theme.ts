// SPDX-License-Identifier: AGPL-3.0-or-later

export interface ChartTheme {
  background: string;
  panelBg: string;
  grid: string;
  axis: string;
  text: string;
  textMuted: string;
  crosshair: string;
  cursor1: string;
  cursor2: string;
  selectionFill: string;
  regressionLine: string;
  histogramBar: string;
  histogramBorder: string;
  palette: string[];
}

export const DARK_CHART_THEME: ChartTheme = {
  background: "#0d1117",
  panelBg: "#161b22",
  grid: "rgba(255, 255, 255, 0.08)",
  axis: "rgba(255, 255, 255, 0.28)",
  text: "#e6edf3",
  textMuted: "#8b949e",
  crosshair: "rgba(255, 255, 255, 0.35)",
  cursor1: "#06b6d4",
  cursor2: "#f59e0b",
  selectionFill: "rgba(6, 182, 212, 0.18)",
  regressionLine: "#f43f5e",
  histogramBar: "rgba(6, 182, 212, 0.65)",
  histogramBorder: "#06b6d4",
  palette: ["#06b6d4", "#a855f7", "#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#ec4899", "#8b5cf6"],
};

export const LIGHT_CHART_THEME: ChartTheme = {
  background: "#ffffff",
  panelBg: "#f6f8fa",
  grid: "rgba(15, 23, 42, 0.09)",
  axis: "rgba(15, 23, 42, 0.3)",
  text: "#0f172a",
  textMuted: "#57606a",
  crosshair: "rgba(15, 23, 42, 0.35)",
  cursor1: "#0891b2",
  cursor2: "#d97706",
  selectionFill: "rgba(8, 145, 178, 0.14)",
  regressionLine: "#e11d48",
  histogramBar: "rgba(8, 145, 178, 0.55)",
  histogramBorder: "#0891b2",
  palette: ["#0969da", "#2da44e", "#bf3989", "#db6d28", "#8250df", "#0891b2", "#cf222e", "#1a7f37"],
};

export function resolveChartTheme(isDark = true, overrides?: Partial<ChartTheme>): ChartTheme {
  const base = isDark ? DARK_CHART_THEME : LIGHT_CHART_THEME;
  return overrides ? { ...base, ...overrides } : base;
}
