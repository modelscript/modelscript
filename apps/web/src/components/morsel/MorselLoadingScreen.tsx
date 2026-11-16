// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";

export interface MorselLoadingScreenProps {
  colorMode: "dark" | "light";
  loadingProgress?: number;
  loadingMessage?: string;
}

/**
 * Full-viewport Morsel loading screen displayed while the Morsel route bundle
 * or modeling engine is initializing.
 */
export const MorselLoadingScreen: React.FC<MorselLoadingScreenProps> = ({
  colorMode,
  loadingProgress = 0,
  loadingMessage = "Loading…",
}) => (
  <div
    id="morsel-app-loader"
    style={{
      position: "fixed",
      inset: 0,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor:
        colorMode === "dark" ? "var(--overlay-bgColor, var(--ms-surface-glass))" : "rgba(255, 255, 255, 0.98)",
      zIndex: 9999,
      gap: 16,
      backdropFilter: "blur(12px)",
    }}
  >
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 4 }}>
      <img
        src={colorMode === "dark" ? "/brand-dark.png" : "/brand.png"}
        alt="Morsel"
        height={36}
        style={{ height: "36px", width: "auto", display: "block" }}
        data-testid="morsel-brand-icon"
      />
    </div>
    <div
      style={{
        width: 300,
        height: 6,
        borderRadius: 3,
        backgroundColor: "var(--borderColor-muted, var(--ms-divider))",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${loadingProgress}%`,
          height: "100%",
          borderRadius: 3,
          backgroundColor: "var(--ms-brand)",
          transition: "width 0.3s ease",
        }}
      />
    </div>
    <span style={{ fontSize: 13, color: "var(--fgColor-muted, var(--ms-text-2))" }}>{loadingMessage}</span>
  </div>
);
