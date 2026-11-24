// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Non-VR Assembly & Subsystem Inspector Panel.
 *
 * Provides Pelagos-style quick-isolation pills (`HERO` + top subsystems),
 * display controls (`LABELS`, `TURNTABLE`, `GHOST SHELL`, `EXPLODE`), and
 * a numbered `SUBSYSTEMS` list with live part counts and solo/ghost/hide controls.
 */

import React from "react";
import type { AssemblyVisibilityState, SubsystemSummary } from "./assembly-visibility";

export interface AssemblyInspectorPanelProps {
  readonly subsystems: readonly SubsystemSummary[];
  readonly visibility: AssemblyVisibilityState;
  readonly onChangeVisibility: (next: AssemblyVisibilityState) => void;
  readonly dark?: boolean | undefined;
  readonly style?: React.CSSProperties | undefined;
}

export const AssemblyInspectorPanel: React.FC<AssemblyInspectorPanelProps> = ({
  subsystems,
  visibility,
  onChangeVisibility,
  dark = true,
  style,
}) => {
  const border = dark ? "rgba(148, 163, 184, 0.24)" : "rgba(15, 23, 42, 0.14)";
  const bg = dark ? "rgba(13, 17, 23, 0.84)" : "rgba(248, 250, 252, 0.9)";
  const fg = dark ? "#f8fafc" : "#0f172a";
  const muted = dark ? "#94a3b8" : "#64748b";
  const chipBg = dark ? "rgba(30, 41, 59, 0.72)" : "rgba(226, 232, 240, 0.75)";

  const setIsolated = (id: string | null) => {
    onChangeVisibility({
      ...visibility,
      isolatedSubsystemId: visibility.isolatedSubsystemId === id ? null : id,
    });
  };

  const toggleHidden = (id: string) => {
    const exists = visibility.hiddenSubsystems.includes(id);
    onChangeVisibility({
      ...visibility,
      hiddenSubsystems: exists
        ? visibility.hiddenSubsystems.filter((x) => x !== id)
        : [...visibility.hiddenSubsystems, id],
    });
  };

  const toggleGhosted = (id: string) => {
    const exists = visibility.ghostedSubsystems.includes(id);
    onChangeVisibility({
      ...visibility,
      ghostedSubsystems: exists
        ? visibility.ghostedSubsystems.filter((x) => x !== id)
        : [...visibility.ghostedSubsystems, id],
    });
  };

  return (
    <aside
      data-testid="assembly-inspector-panel"
      aria-label="Assembly Subsystem Inspector"
      style={{
        width: 224,
        borderRadius: 10,
        border: `1px solid ${border}`,
        background: bg,
        color: fg,
        padding: "10px 11px",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 10.5,
        backdropFilter: "blur(10px)",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        pointerEvents: "auto",
        ...style,
      }}
    >
      {/* ASSEMBLIES quick-isolate bar */}
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: muted,
            marginBottom: 6,
          }}
        >
          <span>ASSEMBLIES</span>
          <span style={{ color: "#f97316" }}>
            {visibility.isolatedSubsystemId
              ? `ISOLATE · ${subsystems.find((s) => s.id === visibility.isolatedSubsystemId)?.label ?? visibility.isolatedSubsystemId.toUpperCase()}`
              : "ISOLATE · HERO"}
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          <button
            type="button"
            onClick={() => onChangeVisibility({ ...visibility, isolatedSubsystemId: null })}
            style={{
              padding: "3px 7px",
              borderRadius: 4,
              border: `1px solid ${visibility.isolatedSubsystemId === null ? "#f97316" : border}`,
              background: visibility.isolatedSubsystemId === null ? "#f97316" : chipBg,
              color: visibility.isolatedSubsystemId === null ? "#ffffff" : fg,
              fontSize: 9.5,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            HERO
          </button>
          {subsystems.slice(0, 5).map((sub) => {
            const active = visibility.isolatedSubsystemId === sub.id;
            const accent = sub.accentColor ?? "#f97316";
            return (
              <button
                key={sub.id}
                type="button"
                onClick={() => setIsolated(sub.id)}
                style={{
                  padding: "3px 7px",
                  borderRadius: 4,
                  border: `1px solid ${active ? accent : border}`,
                  background: active ? accent : chipBg,
                  color: active ? "#ffffff" : fg,
                  fontSize: 9.5,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {sub.label.split(" ")[0]}
              </button>
            );
          })}
        </div>
      </div>

      {/* DISPLAY toggles */}
      <div style={{ borderTop: `1px solid ${border}`, paddingTop: 8 }}>
        <div
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: muted,
            marginBottom: 6,
          }}
        >
          DISPLAY
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
          {(
            [
              {
                label: "LABELS",
                active: visibility.showLabels,
                onClick: () => onChangeVisibility({ ...visibility, showLabels: !visibility.showLabels }),
              },
              {
                label: "TURNTABLE",
                active: visibility.autoTurntable,
                onClick: () => onChangeVisibility({ ...visibility, autoTurntable: !visibility.autoTurntable }),
              },
              {
                label: "GHOST SHELL",
                active: visibility.ghostShellEnabled,
                onClick: () => onChangeVisibility({ ...visibility, ghostShellEnabled: !visibility.ghostShellEnabled }),
              },
              {
                label: visibility.explodeMode === "hierarchical" ? "HIER EXPLODE" : "RAD EXPLODE",
                active: visibility.explodeFactor > 0.01,
                onClick: () =>
                  onChangeVisibility({
                    ...visibility,
                    explodeMode: visibility.explodeMode === "hierarchical" ? "radial" : "hierarchical",
                  }),
              },
            ] as const
          ).map((btn) => (
            <button
              key={btn.label}
              type="button"
              onClick={btn.onClick}
              style={{
                padding: "4px 6px",
                borderRadius: 5,
                border: `1px solid ${btn.active ? "#38bdf8" : border}`,
                background: btn.active ? "rgba(56, 189, 248, 0.2)" : chipBg,
                color: btn.active ? "#38bdf8" : fg,
                fontSize: 9,
                fontWeight: 700,
                cursor: "pointer",
                textAlign: "center",
              }}
            >
              {btn.label}
            </button>
          ))}
        </div>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 7,
            fontSize: 9,
            color: muted,
          }}
        >
          <span>EXPLODE</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={visibility.explodeFactor}
            aria-label="Subsystem explode factor"
            onChange={(e) => onChangeVisibility({ ...visibility, explodeFactor: Number(e.target.value) })}
            style={{ flex: 1, accentColor: "#f97316", cursor: "pointer" }}
          />
          <span style={{ minWidth: 26, textAlign: "right", color: fg }}>
            {Math.round(visibility.explodeFactor * 100)}%
          </span>
        </label>
      </div>

      {/* SUBSYSTEMS inventory */}
      <div style={{ borderTop: `1px solid ${border}`, paddingTop: 8 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: muted,
            marginBottom: 6,
          }}
        >
          <span>SUBSYSTEMS</span>
          <span>{subsystems.reduce((sum, s) => sum + s.partCount, 0)} PARTS</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 205, overflowY: "auto" }}>
          {subsystems.map((sub) => {
            const isolated = visibility.isolatedSubsystemId === sub.id;
            const hidden = visibility.hiddenSubsystems.includes(sub.id);
            const ghosted =
              visibility.ghostedSubsystems.includes(sub.id) ||
              (visibility.ghostShellEnabled && Boolean(sub.defaultGhostable));
            const accent = sub.accentColor ?? "#f97316";

            return (
              <div
                key={sub.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 6,
                  padding: "4px 6px",
                  borderRadius: 5,
                  border: `1px solid ${isolated ? accent : "transparent"}`,
                  background: isolated ? `${accent}22` : chipBg,
                  opacity: hidden ? 0.45 : 1,
                }}
              >
                <button
                  type="button"
                  onClick={() => setIsolated(sub.id)}
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    color: fg,
                    textAlign: "left",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 1,
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: 9.5 }}>
                    <span style={{ color: accent, marginRight: 5 }}>{sub.code}</span>
                    {sub.label}
                  </span>
                  <span style={{ fontSize: 8.5, color: muted }}>
                    {sub.subtitle ?? `${sub.partCount} ${sub.partCount === 1 ? "PART" : "PARTS"}`}
                  </span>
                </button>
                <div style={{ display: "flex", gap: 3 }}>
                  <button
                    type="button"
                    title={ghosted ? "Solid surface" : "Ghost translucent"}
                    onClick={() => toggleGhosted(sub.id)}
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      border: `1px solid ${ghosted ? "#38bdf8" : border}`,
                      background: ghosted ? "rgba(56,189,248,0.22)" : "transparent",
                      color: ghosted ? "#38bdf8" : muted,
                      fontSize: 9,
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    G
                  </button>
                  <button
                    type="button"
                    title={hidden ? "Show subsystem" : "Hide subsystem"}
                    onClick={() => toggleHidden(sub.id)}
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      border: `1px solid ${hidden ? "#ef4444" : border}`,
                      background: hidden ? "rgba(239,68,68,0.22)" : "transparent",
                      color: hidden ? "#ef4444" : muted,
                      fontSize: 9,
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    {hidden ? "×" : "●"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
};
