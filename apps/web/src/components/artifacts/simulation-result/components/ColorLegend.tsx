// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import { type ColormapPreset, sampleColormapCss } from "../../../../util/colormap";

export interface ColorLegendProps {
  preset: ColormapPreset;
  min: number;
  max: number;
  fieldName: string;
  unit?: string | undefined;
}

export const ColorLegend: React.FC<ColorLegendProps> = ({ preset, min, max, fieldName, unit }) => {
  const steps = 8;
  const formatValue = (v: number) => {
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + "M";
    if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + "K";
    if (Math.abs(v) < 0.01 && v !== 0) return v.toExponential(1);
    return v.toFixed(2);
  };

  return (
    <div
      style={{
        position: "absolute",
        right: 16,
        top: 16,
        bottom: 16,
        width: 48,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        pointerEvents: "none",
        zIndex: 5,
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontWeight: 600,
          color: "var(--color-fg-default)",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          marginBottom: 4,
          textAlign: "center",
          lineHeight: 1.2,
        }}
      >
        {fieldName}
        {unit && <span style={{ display: "block", fontWeight: 400, fontSize: 8 }}>({unit})</span>}
      </div>
      <div
        style={{
          flex: 1,
          width: 16,
          borderRadius: 4,
          border: "1px solid var(--color-border)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {Array.from({ length: steps }).map((_, i) => {
          const t = 1 - i / (steps - 1); // Top = max
          return (
            <div
              key={i}
              style={{
                flex: 1,
                background: sampleColormapCss(preset, t),
              }}
            />
          );
        })}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          height: "100%",
          position: "absolute",
          right: 52,
          top: 20,
          bottom: 8,
        }}
      >
        <span style={{ fontSize: 9, color: "var(--color-fg-muted)", whiteSpace: "nowrap" }}>{formatValue(max)}</span>
        <span style={{ fontSize: 9, color: "var(--color-fg-muted)", whiteSpace: "nowrap" }}>
          {formatValue((max + min) / 2)}
        </span>
        <span style={{ fontSize: 9, color: "var(--color-fg-muted)", whiteSpace: "nowrap" }}>{formatValue(min)}</span>
      </div>
    </div>
  );
};
