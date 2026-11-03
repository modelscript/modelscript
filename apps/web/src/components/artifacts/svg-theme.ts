// SPDX-License-Identifier: AGPL-3.0-or-later

const DARK_SURFACE_FILL_MAP: Record<string, string> = {
  "#020617": "#f8fafc",
  "#030712": "#f8fafc",
  "#050912": "#f8fafc",
  "#070b12": "#f8fafc",
  "#070b14": "#f8fafc",
  "#090d16": "#f8fafc",
  "#090f1d": "#f8fafc",
  "#0a0e17": "#f8fafc",
  "#0b0f19": "#f8fafc",
  "#0b111e": "#f8fafc",
  "#0d1117": "#f8fafc",
  "#0b1324": "#ffffff",
  "#0d1526": "#ffffff",
  "#0f172a": "#ffffff",
  "#0f1b29": "#ffffff",
  "#111827": "#ffffff",
  "#111927": "#ffffff",
  "#111a2e": "#ffffff",
  "#111c33": "#ffffff",
  "#111e36": "#ffffff",
  "#131b2e": "#ffffff",
  "#131c2e": "#ffffff",
  "#161b22": "#ffffff",
  "#161f33": "#ffffff",
  "#1a1a1a": "#ffffff",
  "#1e1b38": "#ffffff",
  "#1e1b4b": "#f5f3ff",
  "#1e1e1e": "#ffffff",
  "#1f2937": "#ffffff",
  "#1e293b": "#f1f5f9",
  "#212121": "#f1f5f9",
  "#21262d": "#f1f5f9",
  "#252526": "#f1f5f9",
  "#263238": "#f1f5f9",
  "#2d2d30": "#f1f5f9",
  "#2f2f2f": "#f1f5f9",
  "#334155": "#e2e8f0",
  "#042f2e": "#ecfdf5",
  "#062b16": "#ecfdf5",
  "#062c22": "#ecfdf5",
  "#064e3b": "#ecfdf5",
  "#14532d": "#ecfdf5",
  "#08283c": "#f0f9ff",
  "#082f49": "#f0f9ff",
  "#172554": "#f0f9ff",
  "#1e3a5f": "#f0f9ff",
  "#1e3a8a": "#f0f9ff",
  "#231238": "#f5f3ff",
  "#2e1065": "#f5f3ff",
  "#311042": "#f5f3ff",
  "#312e81": "#f5f3ff",
  "#3b0764": "#f5f3ff",
  "#3b1e54": "#f5f3ff",
  "#2e1f08": "#fffbeb",
  "#2e2111": "#fffbeb",
  "#381f08": "#fffbeb",
  "#380b0b": "#fef2f2",
  "#3b1219": "#fef2f2",
  "#7f1d1d": "#fef2f2",
};

const DARK_STROKE_MAP: Record<string, string> = {
  "#070b14": "#ffffff",
  "#090d16": "#ffffff",
  "#0b0f19": "#ffffff",
  "#0b111e": "#ffffff",
  "#0d1117": "#ffffff",
  "#0f172a": "#ffffff",
  "#111827": "#ffffff",
  "#161b22": "#ffffff",
  "#1e293b": "#cbd5e1",
  "#21262d": "#cbd5e1",
  "#30363d": "#cbd5e1",
  "#334155": "#cbd5e1",
  "#374151": "#cbd5e1",
  "#37474f": "#cbd5e1",
};

const LIGHT_TEXT_FILL_MAP: Record<string, string> = {
  "#f8fafc": "#0f172a",
  "#f9fafb": "#0f172a",
  "#f0f6fc": "#0f172a",
  "#f1f5f9": "#0f172a",
  "#e2e8f0": "#1e293b",
  "#e6edf3": "#1e293b",
  "#e0e0e0": "#1e293b",
  "#e0e7ff": "#1e293b",
  "#cbd5e1": "#334155",
  "#c9d1d9": "#334155",
  "#94a3b8": "#475569",
  "#8b949e": "#475569",
  "#9ca3af": "#475569",
  "#484f58": "#64748b",
  "#fde68a": "#b45309",
  "#fef08a": "#b45309",
  "#fde047": "#b45309",
  "#fcd34d": "#b45309",
  "#fbbf24": "#b45309",
  "#f59e0b": "#b45309",
  "#bae6fd": "#0369a1",
  "#7dd3fc": "#0369a1",
  "#38bdf8": "#0284c7",
  "#a5d6ff": "#0369a1",
  "#79c0ff": "#0369a1",
  "#22d3ee": "#0891b2",
  "#67e8f9": "#0e7490",
  "#a7f3d0": "#047857",
  "#6ee7b7": "#047857",
  "#34d399": "#047857",
  "#10b981": "#047857",
  "#86efac": "#047857",
  "#f3e8ff": "#6d28d9",
  "#e9d5ff": "#6d28d9",
  "#d8b4fe": "#6d28d9",
  "#d2a8ff": "#6d28d9",
  "#c084fc": "#6d28d9",
  "#a855f7": "#6d28d9",
  "#fca5a5": "#b91c1c",
  "#fecaca": "#b91c1c",
  "#ff7b72": "#b91c1c",
  "#f9a8d4": "#be185d",
  "#93c5fd": "#1d4ed8",
  "#60a5fa": "#1d4ed8",
  "#bfdbfe": "#1d4ed8",
  "#c7d2fe": "#1d4ed8",
};

export function resolveCurrentThemeIsDark(explicitIsDark?: boolean): boolean {
  if (typeof explicitIsDark === "boolean") return explicitIsDark;
  if (typeof document !== "undefined") {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "light") return false;
    if (attr === "dark") return true;
  }
  return true;
}

/**
 * Adapts a dark-themed engineering SVG schematic into light mode when `isDark === false`.
 * Preserves semantic accent colors while converting dark canvas/card fills, dark grid lines,
 * and light foreground text into high-contrast light-mode equivalents.
 */
export function adaptSvgMarkupForTheme(svg: string, isDark: boolean): string {
  if (!svg || isDark) return svg;

  let out = svg;

  // 1. Adapt <style>...</style> blocks (text fills and grid strokes)
  out = out.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (block) => {
    let adapted = block.replace(/\b(fill|color)\s*:\s*(#[0-9a-fA-F]{6})\b/gi, (m, prop: string, hex: string) => {
      const mapped = LIGHT_TEXT_FILL_MAP[hex.toLowerCase()];
      return mapped ? `${prop}: ${mapped}` : m;
    });
    adapted = adapted.replace(/\bstroke\s*:\s*(#[0-9a-fA-F]{6})\b/gi, (m, hex: string) => {
      const mapped = DARK_STROKE_MAP[hex.toLowerCase()];
      return mapped ? `stroke: ${mapped}` : m;
    });
    adapted = adapted.replace(/\bbackground(?:-color)?\s*:\s*(#[0-9a-fA-F]{6})\b/gi, (m, hex: string) => {
      const mapped = DARK_SURFACE_FILL_MAP[hex.toLowerCase()];
      return mapped ? m.replace(hex, mapped) : m;
    });
    return adapted;
  });

  // 2. Soften heavy dark-mode drop shadows
  out = out.replace(/(<feDropShadow\b[^>]*?\bflood-opacity=["'])(?:0\.[345]\d*)(["'])/gi, "$10.1$2");

  // 3. Adapt individual SVG element opening tags
  out = out.replace(/<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (fullTag, rawTagName: string, attrs: string) => {
    const tag = rawTagName.toLowerCase();
    if (tag === "style") return fullTag;

    let nextAttrs = attrs;

    if (tag === "text" || tag === "tspan") {
      nextAttrs = nextAttrs.replace(/\bfill=(["'])(#[0-9a-fA-F]{6})\1/gi, (m, q: string, hex: string) => {
        const mapped = LIGHT_TEXT_FILL_MAP[hex.toLowerCase()];
        return mapped ? `fill=${q}${mapped}${q}` : m;
      });
      nextAttrs = nextAttrs.replace(/\b(fill|color)\s*:\s*(#[0-9a-fA-F]{6})\b/gi, (m, prop: string, hex: string) => {
        const mapped = LIGHT_TEXT_FILL_MAP[hex.toLowerCase()];
        return mapped ? `${prop}:${mapped}` : m;
      });
      return `<${rawTagName}${nextAttrs}>`;
    }

    // Non-text elements (<svg>, <rect>, <circle>, <polygon>, <path>, <line>, <polyline>, <stop>, etc.)
    nextAttrs = nextAttrs.replace(
      /\b(fill|stop-color)=(["'])(#[0-9a-fA-F]{6})\2/gi,
      (m, attr: string, q: string, hex: string) => {
        const lower = hex.toLowerCase();
        const mapped = DARK_SURFACE_FILL_MAP[lower];
        if (mapped) return `${attr}=${q}${mapped}${q}`;
        // White unstroked solder/junction dots on dark canvas -> dark slate in light mode
        if (tag === "circle" && (lower === "#f8fafc" || lower === "#e2e8f0") && !/\bstroke=/i.test(attrs)) {
          return `${attr}=${q}#0f172a${q}`;
        }
        return m;
      },
    );

    nextAttrs = nextAttrs.replace(
      /\bfill=(["'])rgba\(\s*(?:9|13|15|17|30)\s*,\s*(?:13|17|23|24|41)\s*,\s*(?:22|23|39|42|59)\s*,\s*[\d.]+\s*\)\1/gi,
      'fill="rgba(241, 245, 249, 0.92)"',
    );

    nextAttrs = nextAttrs.replace(/\bstroke=(["'])(#[0-9a-fA-F]{6})\1/gi, (m, q: string, hex: string) => {
      const lower = hex.toLowerCase();
      const mapped = DARK_STROKE_MAP[lower];
      if (mapped) return `stroke=${q}${mapped}${q}`;
      if ((tag === "path" || tag === "line" || tag === "polyline") && lower === "#f8fafc") {
        return `stroke=${q}#334155${q}`;
      }
      return m;
    });

    nextAttrs = nextAttrs.replace(/\bstyle=(["'])([^"']*)\1/gi, (_m, q: string, styleStr: string) => {
      let nextStyle = styleStr.replace(
        /\b(background(?:-color)?|fill|stop-color)\s*:\s*(#[0-9a-fA-F]{6})\b/gi,
        (sm, prop: string, hex: string) => {
          const mapped = DARK_SURFACE_FILL_MAP[hex.toLowerCase()];
          return mapped ? `${prop}: ${mapped}` : sm;
        },
      );
      nextStyle = nextStyle.replace(/\bstroke\s*:\s*(#[0-9a-fA-F]{6})\b/gi, (sm, hex: string) => {
        const mapped = DARK_STROKE_MAP[hex.toLowerCase()];
        return mapped ? `stroke: ${mapped}` : sm;
      });
      return `style=${q}${nextStyle}${q}`;
    });

    return `<${rawTagName}${nextAttrs}>`;
  });

  return out;
}
