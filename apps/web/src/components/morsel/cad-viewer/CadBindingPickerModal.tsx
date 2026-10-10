// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CadBindingPickerModal
 *
 * Interactive visual modal allowing users to bind 3D CAD mesh geometry
 * (position, rotation, scale, volumetric deformation) to cyber-physical simulation variables.
 * Provides live 3D preview and atomic Modelica annotation writeback.
 */

import type { DynamicBindingConfig } from "@modelscript/cad";
import { CheckIcon, PlayIcon, PlusIcon, SyncIcon, TrashIcon, XIcon } from "@primer/octicons-react";
import { Button, Dialog, IconButton, Select, TextInput } from "@primer/react";
import { useEffect, useState } from "react";
import type { CadComponent } from "./CadViewer";
import type { AnimationController } from "./animation-controller";

interface CadBindingPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  component: CadComponent | null;
  availableVariables: string[];
  animationController?: AnimationController | null;
  onSave: (componentName: string, bindings: DynamicBindingConfig[]) => void;
  dark?: boolean;
}

const PROPERTY_OPTIONS = [
  { label: "Position X (Translation)", property: "position", index: 0, defaultUnit: "m" },
  { label: "Position Y (Translation)", property: "position", index: 1, defaultUnit: "m" },
  { label: "Position Z (Translation)", property: "position", index: 2, defaultUnit: "m" },
  { label: "Rotation X (Euler Angle)", property: "rotation", index: 0, defaultUnit: "rad", format: "euler" },
  { label: "Rotation Y (Euler Angle)", property: "rotation", index: 1, defaultUnit: "rad", format: "euler" },
  { label: "Rotation Z (Euler Angle)", property: "rotation", index: 2, defaultUnit: "rad", format: "euler" },
  { label: "Rotation 3×3 Matrix (Modelica R.T)", property: "rotation", format: "matrix3x3" },
  { label: "Scale X (Expansion)", property: "scale", index: 0, defaultUnit: "1" },
  { label: "Scale Y (Expansion)", property: "scale", index: 1, defaultUnit: "1" },
  { label: "Scale Z (Expansion)", property: "scale", index: 2, defaultUnit: "1" },
  { label: "Volumetric Deformation (V/V0)", property: "deformation", defaultUnit: "m3" },
] as const;

const COMMON_UNITS = ["m", "mm", "cm", "rad", "deg", "rpm", "1", "m3", "L"];

export function CadBindingPickerModal({
  isOpen,
  onClose,
  component,
  availableVariables,
  animationController,
  onSave,
  dark = true,
}: CadBindingPickerModalProps) {
  const [bindings, setBindings] = useState<DynamicBindingConfig[]>([]);
  const [filterQuery, setFilterQuery] = useState("");

  // Initialize bindings from selected component
  useEffect(() => {
    if (!component) {
      setBindings([]);
      return;
    }

    if (component.dynamicBindings && component.dynamicBindings.length > 0) {
      setBindings(
        component.dynamicBindings.map((b) => ({
          property: b.property as DynamicBindingConfig["property"],
          index: b.index,
          variable: b.variable,
          unit: (b as any).unit,
          scale: (b as any).scale,
          offset: (b as any).offset,
          format: (b as any).format,
        })),
      );
    } else {
      // Default initial binding recommendation for multi-body components
      const hasRt = availableVariables.some((v) => v.includes("R.T") || v.endsWith(".R"));
      const r0Vars = availableVariables.filter((v) => v.includes("r_0") || v.includes("r["));

      const initial: DynamicBindingConfig[] = [];
      if (r0Vars.length >= 3) {
        initial.push({ property: "position", index: 0, variable: r0Vars[0], unit: "m" });
        initial.push({ property: "position", index: 1, variable: r0Vars[1], unit: "m" });
        initial.push({ property: "position", index: 2, variable: r0Vars[2], unit: "m" });
      }
      if (hasRt) {
        const rtVar = availableVariables.find((v) => v.includes("R.T")) || "R.T";
        initial.push({ property: "rotation", variable: rtVar, format: "matrix3x3" });
      } else {
        const phiVar = availableVariables.find((v) => v.includes(".phi") || v === "phi");
        if (phiVar) {
          initial.push({ property: "rotation", index: 2, variable: phiVar, unit: "rad" });
        }
      }
      setBindings(initial);
    }
  }, [component, availableVariables]);

  const handleAddBinding = () => {
    const defaultVar = availableVariables[0] || "phi";
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
    setIsPreviewing(true);

    // Apply live in-memory bindings to controller
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
    if (!component) return;
    onSave(component.name, bindings);
    onClose();
  };

  if (!isOpen || !component) return null;

  const filteredVars = filterQuery
    ? availableVariables.filter((v) => v.toLowerCase().includes(filterQuery.toLowerCase()))
    : availableVariables;

  return (
    <Dialog
      isOpen={isOpen}
      onDismiss={onClose}
      aria-labelledby="cad-binding-title"
      sx={{
        width: ["95vw", "800px"],
        maxWidth: "850px",
        maxHeight: "90vh",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--color-canvas-default)",
        color: "var(--color-fg-default)",
        border: "1px solid var(--color-border-default)",
        borderRadius: "12px",
        boxShadow: dark ? "0 16px 32px rgba(0,0,0,0.6)" : "0 16px 32px rgba(0,0,0,0.15)",
        overflow: "hidden",
      }}
    >
      <Dialog.Header
        id="cad-binding-title"
        sx={{
          backgroundColor: "var(--color-canvas-subtle)",
          borderBottom: "1px solid var(--color-border-default)",
          padding: "16px 20px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "20px" }}>🧵</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: "16px", color: "var(--color-fg-default)" }}>
                Link 3D CAD Geometry to Simulation Variables
              </div>
              <div style={{ fontSize: "12px", color: "var(--color-fg-muted)" }}>
                Component: <code style={{ color: "#58a6ff", fontWeight: 600 }}>{component.name}</code>
                {component.cad.uri && ` • Asset: ${component.cad.uri.split("/").pop()}`}
              </div>
            </div>
          </div>
          <IconButton
            icon={XIcon}
            aria-label="Close"
            variant="invisible"
            size="small"
            onClick={onClose}
            sx={{ color: dark ? "#8b949e" : "#57606a" }}
          />
        </div>
      </Dialog.Header>

      <div
        style={{
          padding: "20px",
          overflowY: "auto",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        {/* Variable search / filter toolbar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: dark ? "rgba(255, 255, 255, 0.03)" : "rgba(0, 0, 0, 0.02)",
            padding: "10px 14px",
            borderRadius: "8px",
            border: `1px solid ${dark ? "#30363d" : "#e1e4e8"}`,
          }}
        >
          <div style={{ fontSize: "13px", fontWeight: 600 }}>
            Dynamic Kinematics & Morphing Bindings ({bindings.length})
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <TextInput
              placeholder="Filter simulation variables…"
              size="small"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              sx={{ width: "220px", fontSize: "12px" }}
            />
            <Button
              size="small"
              variant="default"
              leadingVisual={PlusIcon}
              onClick={handleAddBinding}
              sx={{ fontWeight: 600 }}
            >
              Add Binding
            </Button>
          </div>
        </div>

        {/* Bindings list */}
        {bindings.length === 0 ? (
          <div
            style={{
              padding: "40px 20px",
              textAlign: "center",
              color: dark ? "#8b949e" : "#656d76",
              border: `1px dashed ${dark ? "#30363d" : "#d0d7de"}`,
              borderRadius: "8px",
            }}
          >
            <div style={{ fontSize: "24px", marginBottom: "8px" }}>🧊 ↔️ 📈</div>
            <div style={{ fontWeight: 600, fontSize: "14px", color: dark ? "#f0f6fc" : "#1f2328" }}>
              No Dynamic Bindings Configured
            </div>
            <div style={{ fontSize: "12px", marginTop: "4px", maxWidth: "420px", margin: "4px auto 16px auto" }}>
              Bind translation vectors, orientation matrices, or volumetric scales to simulation states to animate this
              3D component.
            </div>
            <Button size="small" variant="primary" leadingVisual={PlusIcon} onClick={handleAddBinding}>
              Add First Binding
            </Button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {bindings.map((b, idx) => {
              return (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    background: "var(--color-canvas-subtle)",
                    border: "1px solid var(--color-border-default)",
                    fontSize: "13px",
                  }}
                >
                  {/* Property Selector */}
                  <div style={{ width: "200px" }}>
                    <Select
                      size="small"
                      aria-label="Target 3D Property"
                      value={
                        b.property === "rotation" && b.format === "matrix3x3"
                          ? "rotation:matrix3x3"
                          : `${b.property}:${b.index ?? 0}`
                      }
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === "rotation:matrix3x3") {
                          handleUpdateBinding(idx, { property: "rotation", format: "matrix3x3", index: undefined });
                        } else {
                          const [prop, indexStr] = val.split(":");
                          const indexNum = parseInt(indexStr, 10);
                          const opt = PROPERTY_OPTIONS.find((p) => p.property === prop && p.index === indexNum);
                          handleUpdateBinding(idx, {
                            property: prop as DynamicBindingConfig["property"],
                            index: indexNum,
                            format: opt?.format as any,
                            unit: opt?.defaultUnit,
                          });
                        }
                      }}
                      sx={{ width: "100%", fontSize: "12px" }}
                    >
                      {PROPERTY_OPTIONS.map((opt, oIdx) => (
                        <Select.Option
                          key={oIdx}
                          value={
                            opt.property === "rotation" && opt.format === "matrix3x3"
                              ? "rotation:matrix3x3"
                              : `${opt.property}:${opt.index ?? 0}`
                          }
                        >
                          {opt.label}
                        </Select.Option>
                      ))}
                    </Select>
                  </div>

                  <span style={{ color: dark ? "#8b949e" : "#57606a", fontSize: "14px" }}>←</span>

                  {/* Variable Selector */}
                  <div style={{ flex: 1 }}>
                    <Select
                      size="small"
                      aria-label="Simulation State Variable"
                      value={b.variable}
                      onChange={(e) => handleUpdateBinding(idx, { variable: e.target.value })}
                      sx={{ width: "100%", fontSize: "12px", fontFamily: "monospace" }}
                    >
                      {filteredVars.map((v) => (
                        <Select.Option key={v} value={v}>
                          {v}
                        </Select.Option>
                      ))}
                      {!availableVariables.includes(b.variable) && (
                        <Select.Option value={b.variable}>{b.variable} (Custom)</Select.Option>
                      )}
                    </Select>
                  </div>

                  {/* Unit Selector */}
                  <div style={{ width: "85px" }}>
                    <Select
                      size="small"
                      aria-label="Unit"
                      value={b.unit || (b.property === "rotation" ? "rad" : b.property === "position" ? "m" : "1")}
                      onChange={(e) => handleUpdateBinding(idx, { unit: e.target.value })}
                      sx={{ width: "100%", fontSize: "12px" }}
                    >
                      {COMMON_UNITS.map((u) => (
                        <Select.Option key={u} value={u}>
                          {u}
                        </Select.Option>
                      ))}
                    </Select>
                  </div>

                  {/* Multiplier Scale */}
                  <div style={{ width: "70px" }}>
                    <TextInput
                      size="small"
                      aria-label="Scale Multiplier"
                      placeholder="1.0"
                      value={b.scale !== undefined ? String(b.scale) : ""}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        handleUpdateBinding(idx, { scale: isNaN(val) ? undefined : val });
                      }}
                      sx={{ width: "100%", fontSize: "11px", textAlign: "right" }}
                    />
                  </div>

                  {/* Delete button */}
                  <IconButton
                    icon={TrashIcon}
                    aria-label="Delete binding"
                    variant="invisible"
                    size="small"
                    onClick={() => handleRemoveBinding(idx)}
                    sx={{ color: dark ? "#f85149" : "#cf222e" }}
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* Live Preview & Kinematics note */}
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            background: dark ? "rgba(56, 139, 253, 0.08)" : "rgba(9, 105, 218, 0.04)",
            border: `1px solid ${dark ? "rgba(56, 139, 253, 0.3)" : "rgba(9, 105, 218, 0.2)"}`,
            borderRadius: "8px",
            fontSize: "12px",
            color: dark ? "#79c0ff" : "#0969da",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <SyncIcon />
            <span>
              <strong>Unit & Transpose Parity Active:</strong> Modelica <code>R.T</code> direction cosine matrices and
              angular/length units auto-scale.
            </span>
          </div>
          {animationController && (
            <Button
              size="small"
              variant="default"
              leadingVisual={PlayIcon}
              onClick={handlePreviewMotion}
              sx={{ fontWeight: 600 }}
            >
              Test Motion
            </Button>
          )}
        </div>
      </div>

      <Dialog.Footer
        sx={{
          backgroundColor: "var(--color-canvas-subtle)",
          borderTop: "1px solid var(--color-border-default)",
          padding: "12px 20px",
          display: "flex",
          justifyContent: "flex-end",
          gap: "10px",
        }}
      >
        <Button variant="default" size="small" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" size="small" leadingVisual={CheckIcon} onClick={handleSave}>
          Apply & Save to Modelica
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
