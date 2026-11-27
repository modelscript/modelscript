// SPDX-License-Identifier: AGPL-3.0-or-later

import { XIcon } from "@primer/octicons-react";
import React from "react";
import * as THREE from "three";
import { inferSubsystemsFromPartNames, type AssemblyVisibilityState } from "./assembly-visibility";
import { AssemblyInspectorPanel } from "./AssemblyInspectorPanel";
import type { CadComponent } from "./CadViewer";
import { formatCadPartDisplayName } from "./scad-feature-tree";

export type CadDrawerTab = "parts" | "subsystems" | "cae" | "physics" | "advanced";

export interface PartAppearanceOverride {
  visible?: boolean;
  ghost?: boolean;
  color?: string;
  material?: string;
}

export type CadPartOverride = PartAppearanceOverride;

export interface CadInspectorDrawerProps {
  dark: boolean;
  activeTab: CadDrawerTab;
  onSelectTab: (tab: CadDrawerTab) => void;
  onClose: () => void;
  components: CadComponent[];
  selectedName?: string | null | undefined;
  onSelectPart?: ((name: string) => void) | undefined;
  partOverrides: Record<string, PartAppearanceOverride>;
  onChangePartOverride: (name: string, patch: Partial<PartAppearanceOverride>) => void;
  onResetPartOverrides: () => void;
  assemblyVisibility: AssemblyVisibilityState;
  onChangeAssemblyVisibility: (next: AssemblyVisibilityState) => void;
  hasCaeContext: boolean;
  caeTreeSlot?: React.ReactNode | undefined;
  physicsSlot?: React.ReactNode | undefined;
  advancedSlot?: React.ReactNode | undefined;
  onLaunchStudyWizard?: (() => void) | undefined;
}

/**
 * Single unified top-left collapsible drawer inside the 3D viewport safe zone.
 * Houses Parts (Instances & Appearances), Subsystems isolation, CAE Sim Tree,
 * Physics 2030, and Adjoint & V&V without ever stacking or colliding with other HUD cards.
 */
export const CadInspectorDrawer: React.FC<CadInspectorDrawerProps> = ({
  dark,
  activeTab,
  onSelectTab,
  onClose,
  components,
  selectedName,
  onSelectPart,
  partOverrides,
  onChangePartOverride,
  onResetPartOverrides,
  assemblyVisibility,
  onChangeAssemblyVisibility,
  hasCaeContext,
  caeTreeSlot,
  physicsSlot,
  advancedSlot,
  onLaunchStudyWizard,
}) => {
  const showSubsystemsTab = components.length > 1;
  const availableTabs: Array<{ id: CadDrawerTab; label: string }> = [
    ...(components.length > 0 ? [{ id: "parts" as const, label: `Parts (${components.length})` }] : []),
    ...(showSubsystemsTab ? [{ id: "subsystems" as const, label: "Subsystems" }] : []),
    ...(hasCaeContext ? [{ id: "cae" as const, label: "CAE Tree" }] : []),
    ...(hasCaeContext && physicsSlot ? [{ id: "physics" as const, label: "Physics" }] : []),
    ...(hasCaeContext && advancedSlot ? [{ id: "advanced" as const, label: "Adjoint & V&V" }] : []),
  ];

  const effectiveTab = availableTabs.some((t) => t.id === activeTab) ? activeTab : (availableTabs[0]?.id ?? "parts");

  const surfaceBg = "var(--ms-surface-glass, var(--ms-bg))";
  const borderCol = "var(--ms-border, var(--color-border-default))";
  const textFg = "var(--ms-text-1, var(--color-fg-default))";
  const mutedFg = "var(--ms-text-2, var(--color-fg-muted))";
  const activeBg = "var(--ms-brand-soft, rgba(8, 145, 178, 0.12))";
  const activeFg = "var(--ms-brand, #0e7490)";

  // If CAE, Physics 2030, or Adjoint & V&V tab is active, wrap cleanly with a compact tab header
  const activeCustomSlot =
    effectiveTab === "cae"
      ? caeTreeSlot
      : effectiveTab === "physics"
        ? physicsSlot
        : effectiveTab === "advanced"
          ? advancedSlot
          : null;

  if (activeCustomSlot) {
    return (
      <div
        data-testid="cad-inspector-drawer"
        style={{
          pointerEvents: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          maxHeight: "100%",
          minHeight: 0,
        }}
      >
        {availableTabs.length > 1 && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 4,
              padding: "4px 6px",
              borderRadius: 10,
              background: surfaceBg,
              backdropFilter: "blur(14px)",
              WebkitBackdropFilter: "blur(14px)",
              border: `1px solid ${borderCol}`,
              boxShadow: dark ? "0 8px 24px rgba(0,0,0,0.4)" : "0 8px 24px rgba(15,23,42,0.12)",
              alignSelf: "flex-start",
            }}
          >
            {availableTabs.map((t) => {
              const sel = t.id === effectiveTab;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelectTab(t.id)}
                  style={{
                    height: 24,
                    padding: "0 8px",
                    borderRadius: 6,
                    border: "none",
                    background: sel ? activeBg : "transparent",
                    color: sel ? activeFg : mutedFg,
                    fontSize: 11,
                    fontWeight: sel ? 700 : 500,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close drawer"
              style={{
                width: 22,
                height: 22,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                border: "none",
                background: "transparent",
                color: mutedFg,
                cursor: "pointer",
                padding: 0,
              }}
            >
              <XIcon size={12} />
            </button>
          </div>
        )}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            minHeight: 0,
            overflow: "auto",
          }}
        >
          {activeCustomSlot}
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="cad-inspector-drawer"
      style={{
        pointerEvents: "auto",
        width: 272,
        maxWidth: "100%",
        maxHeight: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderRadius: 12,
        background: surfaceBg,
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: `1px solid ${borderCol}`,
        boxShadow: dark ? "0 10px 28px rgba(0, 0, 0, 0.42)" : "0 10px 28px rgba(15, 23, 42, 0.14)",
        color: textFg,
        fontSize: 12,
      }}
    >
      {/* Header with tabs & close */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
          padding: "8px 10px",
          borderBottom: `1px solid ${borderCol}`,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 3, minWidth: 0 }}>
          {availableTabs.map((t) => {
            const sel = t.id === effectiveTab;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelectTab(t.id)}
                style={{
                  height: 24,
                  padding: "0 8px",
                  borderRadius: 6,
                  border: "none",
                  background: sel ? activeBg : "transparent",
                  color: sel ? activeFg : mutedFg,
                  fontSize: 11,
                  fontWeight: sel ? 700 : 500,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {effectiveTab === "parts" && Object.keys(partOverrides).length > 0 && (
            <button
              type="button"
              onClick={onResetPartOverrides}
              style={{
                background: "transparent",
                border: "none",
                color: activeFg,
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                padding: 0,
              }}
            >
              Reset
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close parts drawer"
            style={{
              width: 22,
              height: 22,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 6,
              border: "none",
              background: "transparent",
              color: mutedFg,
              cursor: "pointer",
              padding: 0,
            }}
          >
            <XIcon size={13} />
          </button>
        </div>
      </div>

      {/* Scrollable Body */}
      <div style={{ overflowY: "auto", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
        {effectiveTab === "parts" && onLaunchStudyWizard && components.length > 0 && (
          <button
            type="button"
            data-testid="cad-launch-study-wizard-btn"
            onClick={onLaunchStudyWizard}
            style={{
              width: "100%",
              padding: "7px 10px",
              borderRadius: 8,
              border: "1px solid rgba(34, 211, 238, 0.45)",
              background: "linear-gradient(135deg, rgba(8, 145, 178, 0.22) 0%, rgba(99, 102, 241, 0.24) 100%)",
              color: dark ? "#e0f2fe" : "#0c4a6e",
              fontSize: 11.5,
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              marginBottom: 2,
            }}
          >
            <span>+ New CFD / FEA Study</span>
          </button>
        )}
        {effectiveTab === "parts" &&
          components.map((comp, idx) => {
            const ov = partOverrides[comp.name] ?? {};
            const isHidden = ov.visible === false;
            const isGhost = Boolean(ov.ghost);
            const isSel = selectedName === comp.name;
            const rgba = comp.proceduralMesh?.color;
            const defaultHex =
              rgba && rgba.length >= 3 ? `#${new THREE.Color(rgba[0], rgba[1], rgba[2]).getHexString()}` : "#4782b5";
            return (
              <div
                key={`${comp.name}::${idx}`}
                style={{
                  padding: "6px 8px",
                  borderRadius: 8,
                  background: isSel
                    ? dark
                      ? "rgba(8, 145, 178, 0.18)"
                      : "rgba(8, 145, 178, 0.1)"
                    : dark
                      ? "rgba(255, 255, 255, 0.04)"
                      : "rgba(15, 23, 42, 0.03)",
                  border: `1px solid ${isSel ? "rgba(8, 145, 178, 0.45)" : "transparent"}`,
                  opacity: isHidden ? 0.5 : 1,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    type="button"
                    data-testid="cad-part-select-btn"
                    onClick={() => onSelectPart?.(comp.name)}
                    style={{
                      flex: 1,
                      textAlign: "left",
                      background: "transparent",
                      border: "none",
                      color: "inherit",
                      fontWeight: isSel ? 700 : 500,
                      fontSize: 11.5,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      cursor: "pointer",
                      padding: 0,
                    }}
                    title={comp.name}
                  >
                    {formatCadPartDisplayName(comp.name)}
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangePartOverride(comp.name, { visible: isHidden })}
                    title={isHidden ? "Show part" : "Hide part"}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: isHidden ? mutedFg : "inherit",
                      cursor: "pointer",
                      fontSize: 12,
                      padding: "0 2px",
                    }}
                  >
                    {isHidden ? "🚫" : "👁"}
                  </button>
                  {comp.proceduralMesh && (
                    <>
                      <button
                        type="button"
                        onClick={() => onChangePartOverride(comp.name, { ghost: !isGhost })}
                        title="Toggle translucent housing (ghost)"
                        style={{
                          background: isGhost ? activeBg : "transparent",
                          border: "none",
                          borderRadius: 4,
                          color: isGhost ? activeFg : "inherit",
                          cursor: "pointer",
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "1px 4px",
                        }}
                      >
                        α
                      </button>
                      <input
                        type="color"
                        value={ov.color ?? defaultHex}
                        onChange={(e) => onChangePartOverride(comp.name, { color: e.target.value })}
                        aria-label={`Color for ${comp.name}`}
                        style={{
                          width: 18,
                          height: 18,
                          border: "none",
                          padding: 0,
                          background: "transparent",
                          cursor: "pointer",
                        }}
                      />
                    </>
                  )}
                </div>
                {comp.proceduralMesh && (
                  <select
                    value={ov.material ?? ""}
                    onChange={(e) => onChangePartOverride(comp.name, { material: e.target.value || undefined })}
                    aria-label={`Material for ${comp.name}`}
                    style={{
                      marginTop: 5,
                      width: "100%",
                      fontSize: 10.5,
                      padding: "2px 5px",
                      borderRadius: 5,
                      background: dark ? "#0f172a" : "#ffffff",
                      color: "inherit",
                      border: `1px solid ${borderCol}`,
                    }}
                  >
                    <option value="">Auto Material</option>
                    <option value="ABS Plastic">Molded ABS Plastic</option>
                    <option value="Matte Polymer">Matte Polymer</option>
                    <option value="Rubber">Elastomer Rubber</option>
                    <option value="Gloss Paint">Gloss Paint</option>
                    <option value="Clear Polycarbonate">Clear Polycarbonate</option>
                    <option value="Anodized Aluminum">Anodized Aluminum</option>
                    <option value="Cast Aluminum">Cast Aluminum</option>
                    <option value="Stainless Steel">Stainless Steel</option>
                  </select>
                )}
              </div>
            );
          })}

        {effectiveTab === "subsystems" && showSubsystemsTab && (
          <AssemblyInspectorPanel
            subsystems={inferSubsystemsFromPartNames(components.map((c) => ({ name: c.name })))}
            visibility={assemblyVisibility}
            dark={dark}
            onChangeVisibility={onChangeAssemblyVisibility}
          />
        )}
      </div>
    </div>
  );
};
