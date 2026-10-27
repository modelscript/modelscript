// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CadBindingPickerModal — Interactive modal in the VS Code 3D CAD Viewer webview
 * allowing users to bind 3D CAD mesh geometry (position, rotation, scale, deformation)
 * to simulation variables with live 3D preview and atomic Modelica annotation writeback.
 */

import type { DynamicBindingConfig } from "@modelscript/cad";
import { useEffect, useState } from "react";
import type { AnimationController } from "./animation-controller";
import type { CadComponent } from "./cad-viewer";

export interface CadBindingPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  component: CadComponent | null;
  availableVariables?: string[];
  animationController?: AnimationController | null;
  onSave: (componentName: string, bindings: DynamicBindingConfig[]) => void;
  dark?: boolean;
}

const PROPERTY_OPTIONS = [
  { key: "position:0", label: "Position X (Translation)", property: "position", index: 0, defaultUnit: "m" },
  { key: "position:1", label: "Position Y (Translation)", property: "position", index: 1, defaultUnit: "m" },
  { key: "position:2", label: "Position Z (Translation)", property: "position", index: 2, defaultUnit: "m" },
  {
    key: "rotation:0",
    label: "Rotation X (Euler Angle)",
    property: "rotation",
    index: 0,
    defaultUnit: "rad",
    format: "euler",
  },
  {
    key: "rotation:1",
    label: "Rotation Y (Euler Angle)",
    property: "rotation",
    index: 1,
    defaultUnit: "rad",
    format: "euler",
  },
  {
    key: "rotation:2",
    label: "Rotation Z (Euler Angle)",
    property: "rotation",
    index: 2,
    defaultUnit: "rad",
    format: "euler",
  },
  {
    key: "rotation:matrix3x3",
    label: "Rotation 3×3 Matrix (Modelica R.T)",
    property: "rotation",
    format: "matrix3x3",
  },
  { key: "scale:0", label: "Scale X (Expansion)", property: "scale", index: 0, defaultUnit: "1" },
  { key: "scale:1", label: "Scale Y (Expansion)", property: "scale", index: 1, defaultUnit: "1" },
  { key: "scale:2", label: "Scale Z (Expansion)", property: "scale", index: 2, defaultUnit: "1" },
  { key: "deformation:0", label: "Volumetric Deformation (V/V0)", property: "deformation", defaultUnit: "m3" },
] as const;

const COMMON_UNITS = ["m", "mm", "cm", "rad", "deg", "rpm", "1", "m3", "L"];

function bindingToOptionKey(b: DynamicBindingConfig): string {
  if (b.property === "rotation" && b.format === "matrix3x3") return "rotation:matrix3x3";
  if (b.property === "deformation") return "deformation:0";
  return `${b.property}:${b.index ?? 0}`;
}

export function CadBindingPickerModal({
  isOpen,
  onClose,
  component,
  availableVariables = [],
  animationController,
  onSave,
  dark = true,
}: CadBindingPickerModalProps) {
  const [bindings, setBindings] = useState<DynamicBindingConfig[]>([]);

  useEffect(() => {
    if (!component) {
      setBindings([]);
      return;
    }

    if (component.dynamicBindings && component.dynamicBindings.length > 0) {
      setBindings(
        component.dynamicBindings.map((b) => {
          const ext = b as DynamicBindingConfig;
          return {
            property: b.property as DynamicBindingConfig["property"],
            index: b.index,
            variable: b.variable,
            unit: ext.unit,
            scale: ext.scale,
            offset: ext.offset,
            format: ext.format,
          };
        }),
      );
    } else {
      const initial: DynamicBindingConfig[] = [
        {
          property: "position",
          index: 0,
          variable: `${component.name}.r_0[1]`,
          unit: "m",
        },
      ];
      setBindings(initial);
    }
  }, [component]);

  if (!isOpen || !component) return null;

  const handleAddBinding = () => {
    const defaultVar = availableVariables[0] || `${component.name}.phi`;
    setBindings((prev) => [
      ...prev,
      {
        property: "rotation",
        index: 2,
        variable: defaultVar,
        unit: "rad",
        format: "euler",
      },
    ]);
  };

  const handleRemoveBinding = (idx: number) => {
    setBindings((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleUpdateBinding = (idx: number, patch: Partial<DynamicBindingConfig>) => {
    setBindings((prev) => prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  };

  const handlePreviewMotion = () => {
    if (!component || !animationController) return;
    animationController.setBindings([
      {
        componentName: component.name,
        bindings: bindings.map((b) => ({
          property: b.property as "position" | "rotation" | "scale",
          index: b.index ?? 0,
          variable: b.variable,
          unit: b.unit,
          scale: b.scale,
          offset: b.offset,
          format: b.format,
        })),
      },
    ]);
    if (animationController.hasData) {
      animationController.play();
    }
  };

  const handleSave = () => {
    onSave(component.name, bindings);
    onClose();
  };

  const bgModal = dark ? "#161b22" : "#ffffff";
  const borderCol = dark ? "#30363d" : "#d0d7de";
  const textPrimary = dark ? "#f0f6fc" : "#1f2328";
  const textMuted = dark ? "#8b949e" : "#656d76";
  const inputBg = dark ? "#0d1117" : "#f6f8fa";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0, 0, 0, 0.55)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "min(92vw, 760px)",
          maxHeight: "86vh",
          background: bgModal,
          color: textPrimary,
          border: `1px solid ${borderCol}`,
          borderRadius: "12px",
          boxShadow: "0 16px 36px rgba(0, 0, 0, 0.5)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 18px",
            borderBottom: `1px solid ${borderCol}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: "15px" }}>Link 3D CAD Geometry to Simulation Variables</div>
            <div style={{ fontSize: "12px", color: textMuted, marginTop: 2 }}>
              Component: <code style={{ color: "#58a6ff", fontWeight: 600 }}>{component.name}</code>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: textMuted,
              fontSize: "18px",
              cursor: "pointer",
              padding: "4px 8px",
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            padding: "16px 18px",
            overflowY: "auto",
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "13px", fontWeight: 600 }}>Dynamic Kinematics Bindings ({bindings.length})</span>
            <button
              type="button"
              onClick={handleAddBinding}
              style={{
                padding: "5px 10px",
                background: "#238636",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              + Add Binding
            </button>
          </div>

          {bindings.map((b, idx) => (
            <div
              key={idx}
              style={{
                display: "grid",
                gridTemplateColumns: "1.4fr 1.6fr 0.7fr 0.7fr auto",
                gap: "8px",
                alignItems: "center",
                padding: "10px",
                background: inputBg,
                border: `1px solid ${borderCol}`,
                borderRadius: "8px",
              }}
            >
              <select
                value={bindingToOptionKey(b)}
                onChange={(e) => {
                  const opt = PROPERTY_OPTIONS.find((o) => o.key === e.target.value);
                  if (!opt) return;
                  handleUpdateBinding(idx, {
                    property: opt.property as DynamicBindingConfig["property"],
                    index: "index" in opt ? opt.index : undefined,
                    unit: "defaultUnit" in opt ? opt.defaultUnit : undefined,
                    format: "format" in opt ? (opt.format as DynamicBindingConfig["format"]) : undefined,
                  });
                }}
                style={{
                  padding: "6px 8px",
                  background: bgModal,
                  color: textPrimary,
                  border: `1px solid ${borderCol}`,
                  borderRadius: "6px",
                  fontSize: "12px",
                }}
              >
                {PROPERTY_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <input
                type="text"
                list="cad-sim-vars"
                value={b.variable}
                placeholder="Simulation variable (e.g. body.r_0[1])"
                onChange={(e) => handleUpdateBinding(idx, { variable: e.target.value })}
                style={{
                  padding: "6px 8px",
                  background: bgModal,
                  color: textPrimary,
                  border: `1px solid ${borderCol}`,
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontFamily: "monospace",
                }}
              />

              <select
                value={b.unit ?? "1"}
                onChange={(e) => handleUpdateBinding(idx, { unit: e.target.value })}
                style={{
                  padding: "6px 8px",
                  background: bgModal,
                  color: textPrimary,
                  border: `1px solid ${borderCol}`,
                  borderRadius: "6px",
                  fontSize: "12px",
                }}
              >
                {COMMON_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>

              <input
                type="number"
                step="any"
                value={b.scale ?? 1}
                title="Scale multiplier"
                placeholder="Scale"
                onChange={(e) => handleUpdateBinding(idx, { scale: parseFloat(e.target.value) || 1 })}
                style={{
                  padding: "6px 8px",
                  background: bgModal,
                  color: textPrimary,
                  border: `1px solid ${borderCol}`,
                  borderRadius: "6px",
                  fontSize: "12px",
                  width: "100%",
                }}
              />

              <button
                type="button"
                onClick={() => handleRemoveBinding(idx)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#f85149",
                  cursor: "pointer",
                  fontSize: "14px",
                  padding: "4px 6px",
                }}
                title="Remove binding"
              >
                🗑
              </button>
            </div>
          ))}

          {availableVariables.length > 0 && (
            <datalist id="cad-sim-vars">
              {availableVariables.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 18px",
            borderTop: `1px solid ${borderCol}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <button
            type="button"
            onClick={handlePreviewMotion}
            style={{
              padding: "6px 12px",
              background: "transparent",
              color: "#58a6ff",
              border: "1px solid rgba(88, 166, 255, 0.4)",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            ▶ Preview Motion
          </button>

          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "6px 12px",
                background: "transparent",
                color: textMuted,
                border: `1px solid ${borderCol}`,
                borderRadius: "6px",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              style={{
                padding: "6px 14px",
                background: "#0969da",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Save & Write to Annotation
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
