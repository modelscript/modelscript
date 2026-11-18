// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowDownIcon, ArrowUpIcon, TrashIcon } from "@primer/octicons-react";
import { IconButton } from "@primer/react";
import React from "react";

export interface IconPrimitiveInspectorProps {
  primitiveIndex: number;
  totalPrimitives: number;
  primitive: Record<string, unknown>;
  onUpdate: (index: number, patch: Record<string, unknown>) => void;
  onDelete: (index: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

function rgbToHex(rgb?: unknown): string {
  if (!Array.isArray(rgb) || rgb.length < 3) return "#0891b2";
  const toHex = (n: unknown) =>
    Math.max(0, Math.min(255, Math.round(Number(n) || 0)))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, "");
  const full = clean.length === 3 ? clean.replace(/(.)/g, "$1$1") : clean;
  const num = Number.parseInt(full, 16);
  if (!Number.isFinite(num)) return [0, 0, 0];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

const FILL_PATTERNS = [
  "FillPattern.None",
  "FillPattern.Solid",
  "FillPattern.Horizontal",
  "FillPattern.Vertical",
  "FillPattern.Cross",
  "FillPattern.Forward",
  "FillPattern.Backward",
  "FillPattern.HorizontalCylinder",
  "FillPattern.VerticalCylinder",
  "FillPattern.Sphere",
];

const LINE_PATTERNS = [
  "LinePattern.Solid",
  "LinePattern.Dash",
  "LinePattern.Dot",
  "LinePattern.DashDot",
  "LinePattern.None",
];

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: "var(--ms-text-2, var(--color-fg-muted))",
  marginBottom: 8,
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--ms-text-2, var(--color-fg-muted))",
  marginBottom: 3,
  display: "block",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 28,
  padding: "0 8px",
  borderRadius: 6,
  border: "1px solid var(--ms-border, rgba(15, 23, 42, 0.14))",
  backgroundColor: "var(--ms-bg, var(--color-canvas-default))",
  color: "var(--ms-text-1, var(--color-fg-default))",
  fontSize: 12,
  fontFamily: "var(--ms-font-mono, monospace)",
  boxSizing: "border-box",
};

export const IconPrimitiveInspector: React.FC<IconPrimitiveInspectorProps> = ({
  primitiveIndex,
  totalPrimitives,
  primitive,
  onUpdate,
  onDelete,
  onReorder,
}) => {
  const type = String(primitive["@type"] ?? "Rectangle");
  const extent = Array.isArray(primitive["extent"])
    ? (primitive["extent"] as [[number, number], [number, number]])
    : ([
        [-40, -40],
        [40, 40],
      ] as [[number, number], [number, number]]);
  const lineColor = (primitive["lineColor"] ?? primitive["color"]) as [number, number, number] | undefined;
  const fillColor = primitive["fillColor"] as [number, number, number] | undefined;
  const textColor = (primitive["textColor"] ?? lineColor) as [number, number, number] | undefined;
  const fillPattern = String(primitive["fillPattern"] ?? "FillPattern.Solid");
  const linePattern = String(primitive["pattern"] ?? "LinePattern.Solid");
  const lineThickness = Number(primitive["lineThickness"] ?? primitive["thickness"] ?? 0.25);
  const rotation = Number(primitive["rotation"] ?? 0);
  const radius = Number(primitive["radius"] ?? 0);
  const textString = String(primitive["textString"] ?? "");
  const fontSize = Number(primitive["fontSize"] ?? 0);
  const horizontalAlignment = String(primitive["horizontalAlignment"] ?? "TextAlignment.Center");

  const updateExtent = (pairIdx: 0 | 1, coordIdx: 0 | 1, val: number) => {
    if (!Number.isFinite(val)) return;
    const next: [[number, number], [number, number]] = [
      [extent[0][0], extent[0][1]],
      [extent[1][0], extent[1][1]],
    ];
    next[pairIdx][coordIdx] = val;
    onUpdate(primitiveIndex, { extent: next });
  };

  return (
    <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingBottom: 10,
          borderBottom: "1px solid var(--ms-divider, rgba(15, 23, 42, 0.08))",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              backgroundColor: "var(--ms-brand-soft, rgba(8, 145, 178, 0.14))",
              color: "var(--ms-brand, #0891b2)",
            }}
          >
            {type}
          </span>
          <span style={{ fontSize: 12, color: "var(--ms-text-2, var(--color-fg-muted))" }}>
            #{primitiveIndex + 1} of {totalPrimitives}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <IconButton
            icon={ArrowUpIcon}
            size="small"
            variant="invisible"
            aria-label="Bring forward"
            title="Bring forward"
            disabled={primitiveIndex >= totalPrimitives - 1}
            onClick={() => onReorder(primitiveIndex, primitiveIndex + 1)}
          />
          <IconButton
            icon={ArrowDownIcon}
            size="small"
            variant="invisible"
            aria-label="Send backward"
            title="Send backward"
            disabled={primitiveIndex <= 0}
            onClick={() => onReorder(primitiveIndex, primitiveIndex - 1)}
          />
          <IconButton
            icon={TrashIcon}
            size="small"
            variant="invisible"
            aria-label="Delete graphic"
            title="Delete graphic"
            onClick={() => onDelete(primitiveIndex)}
          />
        </div>
      </div>

      {/* Geometry */}
      {type !== "Line" && type !== "Polygon" && (
        <div>
          <div style={sectionLabelStyle}>Geometry</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <label style={fieldLabelStyle}>X1</label>
              <input
                type="number"
                style={inputStyle}
                value={extent[0][0]}
                onChange={(e) => updateExtent(0, 0, Number(e.target.value))}
              />
            </div>
            <div>
              <label style={fieldLabelStyle}>Y1</label>
              <input
                type="number"
                style={inputStyle}
                value={extent[0][1]}
                onChange={(e) => updateExtent(0, 1, Number(e.target.value))}
              />
            </div>
            <div>
              <label style={fieldLabelStyle}>X2</label>
              <input
                type="number"
                style={inputStyle}
                value={extent[1][0]}
                onChange={(e) => updateExtent(1, 0, Number(e.target.value))}
              />
            </div>
            <div>
              <label style={fieldLabelStyle}>Y2</label>
              <input
                type="number"
                style={inputStyle}
                value={extent[1][1]}
                onChange={(e) => updateExtent(1, 1, Number(e.target.value))}
              />
            </div>
            <div>
              <label style={fieldLabelStyle}>Rotation (°)</label>
              <input
                type="number"
                style={inputStyle}
                value={rotation}
                onChange={(e) => onUpdate(primitiveIndex, { rotation: Number(e.target.value) || 0 })}
              />
            </div>
            {type === "Rectangle" && (
              <div>
                <label style={fieldLabelStyle}>Corner Radius</label>
                <input
                  type="number"
                  min={0}
                  style={inputStyle}
                  value={radius}
                  onChange={(e) => onUpdate(primitiveIndex, { radius: Math.max(0, Number(e.target.value) || 0) })}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Fill */}
      {type !== "Line" && type !== "Text" && (
        <div>
          <div style={sectionLabelStyle}>Fill</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="color"
                aria-label="Fill color"
                value={rgbToHex(fillColor)}
                onChange={(e) => onUpdate(primitiveIndex, { fillColor: hexToRgb(e.target.value) })}
                style={{
                  width: 32,
                  height: 28,
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                }}
              />
              <span style={{ fontSize: 12, fontFamily: "var(--ms-font-mono, monospace)" }}>
                {fillColor ? `{${fillColor.join(", ")}}` : "Default"}
              </span>
            </div>
            <div>
              <label style={fieldLabelStyle}>Fill Pattern</label>
              <select
                style={inputStyle}
                value={fillPattern.startsWith("FillPattern.") ? fillPattern : `FillPattern.${fillPattern}`}
                onChange={(e) => onUpdate(primitiveIndex, { fillPattern: e.target.value })}
              >
                {FILL_PATTERNS.map((fp) => (
                  <option key={fp} value={fp}>
                    {fp.replace("FillPattern.", "")}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Stroke */}
      {type !== "Text" && (
        <div>
          <div style={sectionLabelStyle}>Stroke</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="color"
                aria-label="Line color"
                value={rgbToHex(lineColor)}
                onChange={(e) =>
                  onUpdate(
                    primitiveIndex,
                    type === "Line" ? { color: hexToRgb(e.target.value) } : { lineColor: hexToRgb(e.target.value) },
                  )
                }
                style={{
                  width: 32,
                  height: 28,
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                }}
              />
              <span style={{ fontSize: 12, fontFamily: "var(--ms-font-mono, monospace)" }}>
                {lineColor ? `{${lineColor.join(", ")}}` : "{0, 0, 0}"}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label style={fieldLabelStyle}>Thickness</label>
                <input
                  type="number"
                  step={0.25}
                  min={0}
                  style={inputStyle}
                  value={lineThickness}
                  onChange={(e) =>
                    onUpdate(
                      primitiveIndex,
                      type === "Line"
                        ? { thickness: Math.max(0, Number(e.target.value) || 0) }
                        : { lineThickness: Math.max(0, Number(e.target.value) || 0) },
                    )
                  }
                />
              </div>
              <div>
                <label style={fieldLabelStyle}>Pattern</label>
                <select
                  style={inputStyle}
                  value={linePattern.startsWith("LinePattern.") ? linePattern : `LinePattern.${linePattern}`}
                  onChange={(e) => onUpdate(primitiveIndex, { pattern: e.target.value })}
                >
                  {LINE_PATTERNS.map((lp) => (
                    <option key={lp} value={lp}>
                      {lp.replace("LinePattern.", "")}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Typography */}
      {type === "Text" && (
        <div>
          <div style={sectionLabelStyle}>Text</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                <label style={{ ...fieldLabelStyle, marginBottom: 0 }}>Text String</label>
                <button
                  type="button"
                  onClick={() => onUpdate(primitiveIndex, { textString: "%name" })}
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: "1px 6px",
                    borderRadius: 4,
                    border: "1px solid var(--ms-border, rgba(15,23,42,0.14))",
                    background: "var(--ms-brand-soft, rgba(8, 145, 178, 0.12))",
                    color: "var(--ms-brand, #0891b2)",
                    cursor: "pointer",
                  }}
                >
                  Insert %name
                </button>
              </div>
              <input
                type="text"
                style={inputStyle}
                value={textString}
                onChange={(e) => onUpdate(primitiveIndex, { textString: e.target.value })}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label style={fieldLabelStyle}>Font Size</label>
                <input
                  type="number"
                  min={0}
                  style={inputStyle}
                  value={fontSize}
                  onChange={(e) => onUpdate(primitiveIndex, { fontSize: Math.max(0, Number(e.target.value) || 0) })}
                />
              </div>
              <div>
                <label style={fieldLabelStyle}>Align</label>
                <select
                  style={inputStyle}
                  value={
                    horizontalAlignment.startsWith("TextAlignment.")
                      ? horizontalAlignment
                      : `TextAlignment.${horizontalAlignment}`
                  }
                  onChange={(e) => onUpdate(primitiveIndex, { horizontalAlignment: e.target.value })}
                >
                  <option value="TextAlignment.Left">Left</option>
                  <option value="TextAlignment.Center">Center</option>
                  <option value="TextAlignment.Right">Right</option>
                </select>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="color"
                aria-label="Text color"
                value={rgbToHex(textColor)}
                onChange={(e) => onUpdate(primitiveIndex, { textColor: hexToRgb(e.target.value) })}
                style={{
                  width: 32,
                  height: 28,
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                }}
              />
              <span style={{ fontSize: 12, fontFamily: "var(--ms-font-mono, monospace)" }}>
                {textColor ? `{${textColor.join(", ")}}` : "{0, 0, 0}"}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
