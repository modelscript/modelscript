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
 * an obsidian squircle, or a custom white-label image if `logoUrl` is configured.
 */
export const AnsatzMark: React.FC<AnsatzMarkProps> = ({
  size = 36,
  logoUrl,
  alt = "Ansatz",
  accentColor = "#38bdf8",
}) => {
  const trimmedUrl = (logoUrl || "").trim();
  const isCustomLogo =
    Boolean(trimmedUrl) &&
    trimmedUrl !== "/ms-logo.png" &&
    trimmedUrl !== "/ms-logo-light.png" &&
    trimmedUrl !== "/ansatz-logo.svg";

  const svgSize = Math.round(size * 0.68);
  const resolvedAccent =
    accentColor && accentColor.trim() && accentColor.trim().toLowerCase() !== "#06b6d4"
      ? accentColor.trim()
      : "#38bdf8";

  return (
    <div
      style={{
        width: `${size}px`,
        height: `${size}px`,
        minWidth: `${size}px`,
        minHeight: `${size}px`,
        borderRadius: `${Math.round(size * 0.27)}px`,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "radial-gradient(circle at 78% 20%, rgba(34, 211, 238, 0.18), transparent 60%), linear-gradient(155deg, #111622 0%, #070a10 100%)",
        boxShadow:
          "inset 0 1px 0 rgba(255, 255, 255, 0.16), inset 0 0 0 1px rgba(255, 255, 255, 0.09), 0 3px 10px -2px rgba(0, 0, 0, 0.35)",
        flexShrink: 0,
      }}
    >
      {isCustomLogo ? (
        <img
          src={trimmedUrl}
          alt={alt}
          style={{ width: `${size}px`, height: `${size}px`, objectFit: "cover", display: "block" }}
        />
      ) : (
        <svg width={svgSize} height={svgSize} viewBox="0 0 36 36" fill="none" role="img" aria-label={alt}>
          {/* Facet 1: Left ascending wing (Pure White) */}
          <polygon points="18,5.5 21.8,12 11.8,29 6.5,29" fill="#ffffff" />
          {/* Facet 2: Right descending wing (3-Facet Depth Sky/Accent) */}
          <polygon points="23,14.1 29.5,25.2 27.2,29 19.2,15.2" fill={resolvedAccent} />
          {/* Facet 3: Inner floating delta bridge (Cool Slate) */}
          <polygon points="14.4,29 25,29 22.7,24.6 16.9,24.6" fill="#94a3b8" />
        </svg>
      )}
    </div>
  );
};

export default AnsatzMark;
