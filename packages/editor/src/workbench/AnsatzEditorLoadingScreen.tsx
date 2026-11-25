// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";

export interface AnsatzEditorLoadingScreenProps {
  colorMode: "dark" | "light";
  loadingProgress?: number;
  loadingMessage?: string;
}

/**
 * Full-viewport Ansatz loading screen displayed while the Ansatz route bundle
 * or modeling engine is initializing.
 */
export const AnsatzEditorLoadingScreen: React.FC<AnsatzEditorLoadingScreenProps> = ({
  colorMode,
  loadingProgress = 0,
  loadingMessage = "Loading…",
}) => (
  <div
    id="ansatz-app-loader"
    style={{
      position: "fixed",
      inset: 0,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colorMode === "dark" ? "var(--color-bg-primary, #0b0f17)" : "var(--color-bg-primary, #ffffff)",
      backgroundImage: [
        "radial-gradient(ellipse 60% 40% at 50% 0%, var(--ms-glow-cyan, rgba(8, 145, 178, 0.14)) 0%, transparent 70%)",
        "radial-gradient(ellipse 40% 30% at 100% 100%, var(--ms-glow-cyan, rgba(8, 145, 178, 0.14)) 0%, transparent 70%)",
        "linear-gradient(to bottom, transparent 0%, color-mix(in srgb, var(--color-bg-primary, #ffffff) 55%, transparent) 260px, var(--color-bg-primary, #ffffff) 560px)",
        `linear-gradient(var(--ms-grid-line, ${colorMode === "dark" ? "rgba(255, 255, 255, 0.06)" : "rgba(15, 23, 42, 0.06)"}) 1px, transparent 1px)`,
        `linear-gradient(90deg, var(--ms-grid-line, ${colorMode === "dark" ? "rgba(255, 255, 255, 0.06)" : "rgba(15, 23, 42, 0.06)"}) 1px, transparent 1px)`,
      ].join(", "),
      backgroundSize: "100% 100%, 100% 100%, 100% 100%, 48px 48px, 48px 48px",
      backgroundRepeat: "no-repeat, no-repeat, no-repeat, repeat, repeat",
      zIndex: 9999,
      gap: 16,
    }}
  >
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 4 }}>
      <img
        src="/ansatz-logo.svg"
        alt="Ansatz"
        height={36}
        style={{ height: "36px", width: "auto", display: "block" }}
        data-testid="ansatz-brand-icon"
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
