// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getDomainClusterForLanguage,
  getResolvedTheme,
  type DomainClusterId,
  type ResolvedDomainTokens,
  type ResolvedStatusTokens,
  type ResolvedThemeTokens,
  type ThemeMode,
} from "@modelscript/design-tokens/runtime";
import { useMemo } from "react";
import { useTheme } from "./theme";

export {
  getDomainClusterForLanguage,
  getResolvedTheme,
  type DomainClusterId,
  type ResolvedDomainTokens,
  type ResolvedStatusTokens,
  type ResolvedThemeTokens,
  type ThemeMode,
};

/**
 * Hook providing resolved runtime theme tokens for the currently active theme mode.
 * Useful for non-DOM contexts like Three.js WebGL scenes, 2D canvases, Vega-Lite specs,
 * and SVG builders.
 */
export function useThemeTokens(): ResolvedThemeTokens {
  const { theme } = useTheme();
  return useMemo(() => getResolvedTheme(theme), [theme]);
}

/**
 * Resolves CSS variables (such as `var(--domain-core)` or `var(--ms-brand)`)
 * to concrete hex/rgb color strings using runtime theme tokens for WebGL/Canvas renderers.
 */
export function resolveCssColor(
  rawColor: string | undefined,
  tokens: ResolvedThemeTokens,
  fallback = "#38bdf8",
): string {
  if (!rawColor) return fallback;
  if (!rawColor.startsWith("var(")) return rawColor;
  const match = rawColor.match(/var\(--([a-zA-Z0-9_-]+)/);
  if (!match) return fallback;
  const varName = match[1];
  if (varName.startsWith("domain-")) {
    const cluster = varName.replace("domain-", "") as DomainClusterId;
    if (tokens.domains[cluster]) {
      return tokens.domains[cluster].color;
    }
  }
  if (varName.startsWith("ms-status-pass")) return tokens.status.pass.fg;
  if (varName.startsWith("ms-status-warn")) return tokens.status.warn.fg;
  if (varName.startsWith("ms-status-fail")) return tokens.status.fail.fg;
  if (varName.startsWith("ms-status-info")) return tokens.status.info.fg;
  if (varName.startsWith("ms-brand")) return tokens.brand;
  return fallback;
}
