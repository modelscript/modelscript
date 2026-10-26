// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import { COLORMAP_NAMES, type ColormapPreset } from "../../../../util/colormap";
import type { VtuField } from "../../../../util/vtu-parser";
import type { FieldMeta } from "../types";

export interface ViewerControlsBarProps {
  scalarFields: FieldMeta[];
  activeField: string;
  setActiveField: (field: string) => void;
  velocityField?: VtuField | undefined;
  animateFlow: boolean;
  setAnimateFlow: (val: boolean) => void;
  colormapPreset: ColormapPreset;
  setColormapPreset: (preset: ColormapPreset) => void;
  displacementField?: VtuField | undefined;
  loadFactor: number;
  setLoadFactor: (val: number) => void;
}

const controlStyle: React.CSSProperties = {
  position: "absolute",
  left: 12,
  bottom: 12,
  display: "flex",
  gap: 8,
  alignItems: "center",
  background: "var(--color-canvas-default)",
  border: "1px solid var(--color-border-default)",
  borderRadius: 8,
  padding: "6px 12px",
  zIndex: 5,
};

const selectStyle: React.CSSProperties = {
  background: "var(--color-canvas-overlay)",
  color: "var(--color-fg-default)",
  border: "1px solid var(--color-border-default)",
  borderRadius: 4,
  padding: "3px 6px",
  fontSize: 11,
  cursor: "pointer",
  outline: "none",
};

const sliderLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--color-fg-default)",
  whiteSpace: "nowrap",
};

export const ViewerControlsBar: React.FC<ViewerControlsBarProps> = ({
  scalarFields,
  activeField,
  setActiveField,
  velocityField,
  animateFlow,
  setAnimateFlow,
  colormapPreset,
  setColormapPreset,
  displacementField,
  loadFactor,
  setLoadFactor,
}) => {
  return (
    <div style={controlStyle}>
      {/* Field selector */}
      {scalarFields.length > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={sliderLabelStyle}>Field</span>
          <select value={activeField} onChange={(e) => setActiveField(e.target.value)} style={selectStyle}>
            {scalarFields.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Animated Flow toggle */}
      {velocityField && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
          <input
            id="animate-flow-cb"
            type="checkbox"
            checked={animateFlow}
            onChange={(e) => setAnimateFlow(e.target.checked)}
            style={{ accentColor: "#8b5cf6", cursor: "pointer", width: 14, height: 14 }}
          />
          <label htmlFor="animate-flow-cb" style={{ ...sliderLabelStyle, cursor: "pointer", margin: 0 }}>
            Animate Flow
          </label>
        </div>
      )}

      {/* Colormap selector */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={sliderLabelStyle}>Color</span>
        <select
          value={colormapPreset}
          onChange={(e) => setColormapPreset(e.target.value as ColormapPreset)}
          style={selectStyle}
        >
          {COLORMAP_NAMES.map((name) => (
            <option key={name} value={name}>
              {name.charAt(0).toUpperCase() + name.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {/* Load factor slider */}
      {displacementField && (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={sliderLabelStyle}>Load %</span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={loadFactor}
            onChange={(e) => setLoadFactor(parseFloat(e.target.value))}
            style={{ width: 60, accentColor: "#8b5cf6" }}
          />
          <span style={{ ...sliderLabelStyle, width: 28, textAlign: "right" }}>{loadFactor}%</span>
        </div>
      )}
    </div>
  );
};
