// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";

export interface AnsatzMarkProps {
  size?: number;
  logoUrl?: string | undefined;
  alt?: string | undefined;
  accentColor?: string | undefined;
}

/**
 * Renders the Kuwayama K3-D (Sharp Mitre Fold, 3-Facet Depth) Ansatz mark inside
 * a counter-themed squircle (obsidian in light mode, cool platinum in dark mode — see
 * the `--ansatz-*` tokens in index.css), or a custom white-label image if `logoUrl` is configured.
 */
export const AnsatzMark: React.FC<AnsatzMarkProps> = ({
  size = 36,
  logoUrl,
  alt = "Ansatz",
  accentColor = "#38bdf8",
}) => {
  const trimmedUrl = (logoUrl || "").trim();
  const safeLogoUrl = React.useMemo(() => {
    if (!trimmedUrl) return null;
    // Allow safe http/https, relative paths, or safe data image URIs
    if (/^(?:https?:\/\/|\/(?!\/)|\.\/|data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,)/i.test(trimmedUrl)) {
      try {
        return encodeURI(decodeURI(trimmedUrl));
      } catch {
        return encodeURI(trimmedUrl);
      }
    }
    return null;
  }, [trimmedUrl]);

  const isCustomLogo =
    Boolean(safeLogoUrl) &&
    safeLogoUrl !== "/ms-logo.png" &&
    safeLogoUrl !== "/ms-logo-light.png" &&
    safeLogoUrl !== "/ansatz-logo.svg";

  // Keep glyph and tile the same parity so the inset is a whole number of
  // pixels on each side — a half-pixel offset makes the mark shimmer/shift
  // whenever it's re-rasterized (hover, theme change, zoom).
  let svgSize = Math.round(size * 0.68);
  if ((size - svgSize) % 2 !== 0) svgSize += 1;
  // Only override the themed accent when a white-label colour is configured.
  const trimmedAccent = (accentColor || "").trim();
  const resolvedAccent =
    trimmedAccent && !["#06b6d4", "#38bdf8"].includes(trimmedAccent.toLowerCase())
      ? trimmedAccent
      : "var(--ansatz-facet-accent)";

  return (
    <div
      className={isCustomLogo ? "ansatz-mark ansatz-mark--custom" : "ansatz-mark"}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        minWidth: `${size}px`,
        minHeight: `${size}px`,
        borderRadius: `${Math.round(size * 0.27)}px`,
      }}
    >
      {isCustomLogo && safeLogoUrl ? (
        <img
          src={safeLogoUrl}
          alt={alt}
          style={{ width: `${size}px`, height: `${size}px`, objectFit: "cover", display: "block" }}
        />
      ) : (
        <svg width={svgSize} height={svgSize} viewBox="0 0 36 36" fill="none" role="img" aria-label={alt}>
          {/* Facet 1: Left ascending wing (Primary — white on light-mode obsidian, ink on dark-mode platinum) */}
          <polygon points="18,5.5 21.8,12 11.8,29 6.5,29" style={{ fill: "var(--ansatz-facet-primary)" }} />
          {/* Facet 2: Right descending wing (3-Facet Depth Sky/Accent) */}
          <polygon
            className="ansatz-facet-accent"
            points="23,14.1 29.5,25.2 27.2,29 19.2,15.2"
            style={{ fill: resolvedAccent }}
          />
          {/* Facet 3: Inner floating delta bridge (Cool Slate) */}
          <polygon points="14.4,29 25,29 22.7,24.6 16.9,24.6" style={{ fill: "var(--ansatz-facet-bridge)" }} />
        </svg>
      )}
    </div>
  );
};

export default AnsatzMark;
