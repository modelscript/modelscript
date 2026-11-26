// SPDX-License-Identifier: AGPL-3.0-or-later

import { CANVAS_BOARD_THEMES } from "@modelscript/canvas";
import React, { useEffect, useRef, useState } from "react";
import type { DiagramLanguageTheme } from "./diagram-language-theme.js";
import {
  deskScaleLabel,
  ROTUNDA_ENVIRONMENTS,
  rotundaScaleModeLabel,
  type RotundaAction,
  type RotundaActiveView,
  type RotundaCaeOverlay,
  type RotundaEnvironmentId,
  type RotundaState,
} from "./types.js";
import type { RotundaCueKind } from "./xr-session.js";

const CAE_OPTIONS: readonly { id: RotundaCaeOverlay; label: string }[] = [
  { id: "none", label: "CAD" },
  { id: "fea-stress", label: "FEA" },
  { id: "cfd-flow", label: "CFD" },
  { id: "thermal", label: "Thermal" },
];

export interface DiagramHudApi {
  undo: () => void;
  redo: () => void;
  autoLayerByDomain: () => void;
  flattenTo2D: () => void;
  canUndo: boolean;
  canRedo: boolean;
  nodeCount: number;
  edgeCount: number;
}

export interface RotundaContextDockProps {
  hostedInWorkbench: boolean;
  activeView: RotundaActiveView;
  splitCodeOpen: boolean;
  state: RotundaState;
  langTheme: DiagramLanguageTheme;
  workspaceFileCount: number;
  ambientMuted: boolean;
  diagramHudApi: DiagramHudApi | null;
  xrSupported: { vr: boolean; ar: boolean };
  onSelectEnvironment: (env: RotundaEnvironmentId) => void;
  onSelectView: (view: RotundaActiveView) => void;
  onToggleSplitCode: () => void;
  onToggleAmbientMuted: () => void;
  onEnterVr: () => void;
  onEnterAr: () => void;
  onScrollCode?: ((target: "top" | "bottom") => void) | undefined;
  vrQuickEditOpen?: boolean | undefined;
  onToggleVrQuickEdit?: (() => void) | undefined;
  dispatch: React.Dispatch<RotundaAction>;
  onCue: (kind: RotundaCueKind) => void;
}

type DockPopover = "env" | "scene" | "cae" | null;

/**
 * Calm, context-aware bottom dock for `EngineeringRotunda`.
 *
 * - In `hostedInWorkbench` mode (`/editor`): strips duplicate view-switching chrome
 *   (owned by `AnsatzEditorNavbar`), shows ONLY the active view's spatial tools, and
 *   groups environment & 3D scene toggles into upward-opening popovers so nothing
 *   ever wraps into multi-row collisions.
 * - In standalone mode (Canvas / VS Code / standalone embeds): preserves direct
 *   controls and `data-testid` selectors for backward compatibility while fixing
 *   vertical stacking via a clean bottom flex column.
 */
export const RotundaContextDock: React.FC<RotundaContextDockProps> = ({
  hostedInWorkbench,
  activeView,
  splitCodeOpen,
  state,
  langTheme,
  workspaceFileCount,
  ambientMuted,
  diagramHudApi,
  xrSupported,
  onSelectEnvironment,
  onSelectView,
  onToggleSplitCode,
  onToggleAmbientMuted,
  onEnterVr,
  onEnterAr,
  onScrollCode,
  vrQuickEditOpen = false,
  onToggleVrQuickEdit,
  dispatch,
  onCue,
}) => {
  const [openPopover, setOpenPopover] = useState<DockPopover>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openPopover) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpenPopover(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenPopover(null);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openPopover]);

  const activeEnvMeta = ROTUNDA_ENVIRONMENTS.find((e) => e.id === state.environment) ?? ROTUNDA_ENVIRONMENTS[0]!;

  const pillBtn = (active: boolean, accent = "#38bdf8"): React.CSSProperties => ({
    padding: "4px 9px",
    borderRadius: 7,
    border: active ? `1px solid ${accent}` : "1px solid rgba(148, 163, 184, 0.24)",
    background: active ? "rgba(56, 189, 248, 0.18)" : "rgba(15, 23, 42, 0.55)",
    color: active ? "#f8fafc" : "#cbd5e1",
    fontSize: 11,
    fontWeight: active ? 700 : 500,
    cursor: "pointer",
    whiteSpace: "nowrap",
  });

  const divider = <span style={{ width: 1, height: 16, background: "rgba(148, 163, 184, 0.22)", flexShrink: 0 }} />;

  // Diagram-specific contextual controls (used inline in hosted mode, or stacked cleanly above dock in standalone mode)
  const renderDiagramControls = (inline: boolean) => (
    <div
      data-testid="rotunda-diagram-studio-bar"
      style={
        inline
          ? { display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }
          : {
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: 6,
              padding: "5px 10px",
              borderRadius: 10,
              border: "1px solid rgba(34, 211, 238, 0.45)",
              background: "rgba(9, 15, 29, 0.9)",
              backdropFilter: "blur(10px)",
              color: "#e2e8f0",
              fontSize: 11,
            }
      }
    >
      <button
        type="button"
        data-testid="rotunda-toggle-wrist-library"
        onClick={() => {
          dispatch({ type: "toggleWristPalette" });
          onCue(state.wristPaletteOpen ? "click" : "stockroom-open");
        }}
        style={{
          padding: "4px 10px",
          borderRadius: 7,
          border: state.wristPaletteOpen ? "1px solid #22d3ee" : "1px solid #0284c7",
          background: state.wristPaletteOpen ? "#0284c7" : "rgba(2, 132, 199, 0.24)",
          color: "#ffffff",
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {state.wristPaletteOpen ? "✕ Stockroom" : "＋ Stockroom (L)"}
      </button>
      <button
        type="button"
        data-testid="rotunda-cycle-snap-mode"
        onClick={() => {
          dispatch({ type: "cycleDiagramSnapMode" });
          onCue("tick");
        }}
        style={pillBtn(false)}
      >
        Snap:{" "}
        {state.diagramSnapMode === "free-3d"
          ? "Free 3D"
          : state.diagramSnapMode === "domain-layers"
            ? "Domain Layers"
            : state.diagramSnapMode === "grid-5cm"
              ? "5cm Grid"
              : "Flat 2D"}
      </button>
      <button
        type="button"
        data-testid="rotunda-toggle-wafer-style"
        onClick={() => {
          dispatch({ type: "toggleDiagramWaferStyle" });
          onCue("click");
        }}
        style={pillBtn(false)}
      >
        {state.diagramWaferStyle === "tactile-tile" ? "Wafer Tile" : "Pure 3D SVG"}
      </button>
      {diagramHudApi && (
        <>
          <button
            type="button"
            data-testid="rotunda-diagram-autolayer"
            onClick={() => diagramHudApi.autoLayerByDomain()}
            style={pillBtn(false)}
          >
            Layers
          </button>
          <button
            type="button"
            data-testid="rotunda-diagram-flatten"
            onClick={() => diagramHudApi.flattenTo2D()}
            style={pillBtn(false)}
          >
            Flat 2D
          </button>
          <button
            type="button"
            data-testid="rotunda-diagram-undo"
            disabled={!diagramHudApi.canUndo}
            onClick={() => {
              diagramHudApi.undo();
              onCue("snap");
            }}
            style={{
              ...pillBtn(false),
              opacity: diagramHudApi.canUndo ? 1 : 0.45,
              cursor: diagramHudApi.canUndo ? "pointer" : "not-allowed",
            }}
            title="Undo"
          >
            ↶
          </button>
          <button
            type="button"
            data-testid="rotunda-diagram-redo"
            disabled={!diagramHudApi.canRedo}
            onClick={() => {
              diagramHudApi.redo();
              onCue("snap");
            }}
            style={{
              ...pillBtn(false),
              opacity: diagramHudApi.canRedo ? 1 : 0.45,
              cursor: diagramHudApi.canRedo ? "pointer" : "not-allowed",
            }}
            title="Redo"
          >
            ↷
          </button>
          <span style={{ color: "#94a3b8", fontFamily: "monospace", fontSize: 10, whiteSpace: "nowrap" }}>
            {diagramHudApi.nodeCount} parts · {diagramHudApi.edgeCount} wires
          </span>
        </>
      )}
    </div>
  );

  // ── WORKBENCH-HOSTED MODE: Ultra-clean single contextual dock ──────────────
  if (hostedInWorkbench) {
    return (
      <div
        ref={rootRef}
        style={{
          position: "absolute",
          bottom: 14,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 22,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          maxWidth: "calc(100% - 24px)",
        }}
      >
        {/* Upward-opening Environment Popover */}
        {openPopover === "env" && (
          <div
            role="dialog"
            aria-label="VR Environment Presets"
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(148, 163, 184, 0.28)",
              background: "rgba(9, 15, 29, 0.95)",
              backdropFilter: "blur(16px)",
              boxShadow: "0 12px 32px rgba(0, 0, 0, 0.5)",
              color: "#e2e8f0",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              minWidth: 260,
            }}
          >
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", color: "#94a3b8" }}>
              SPATIAL ENVIRONMENT
            </span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
              {ROTUNDA_ENVIRONMENTS.map((env) => {
                const active = state.environment === env.id;
                return (
                  <button
                    key={env.id}
                    type="button"
                    data-testid={`rotunda-env-${env.id}`}
                    onClick={() => {
                      onSelectEnvironment(env.id);
                      setOpenPopover(null);
                    }}
                    title={env.description}
                    style={{
                      padding: "6px 8px",
                      borderRadius: 8,
                      border: active ? `1px solid ${env.accentColor}` : "1px solid rgba(148,163,184,0.22)",
                      background: active ? "rgba(56, 189, 248, 0.2)" : "rgba(15, 23, 42, 0.65)",
                      color: active ? "#ffffff" : "#cbd5e1",
                      fontSize: 11,
                      fontWeight: active ? 700 : 500,
                      cursor: "pointer",
                    }}
                  >
                    {env.shortLabel}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Upward-opening CAE Overlay Popover (3D Stage) */}
        {openPopover === "cae" && activeView === "3d" && (
          <div
            role="dialog"
            aria-label="CAE Field Overlays"
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(148, 163, 184, 0.28)",
              background: "rgba(9, 15, 29, 0.95)",
              backdropFilter: "blur(16px)",
              boxShadow: "0 12px 32px rgba(0, 0, 0, 0.5)",
              color: "#e2e8f0",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              minWidth: 230,
            }}
          >
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", color: "#94a3b8" }}>
              FIELD OVERLAY
            </span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
              {CAE_OPTIONS.map((opt) => {
                const active = state.caeOverlay === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    data-testid={`rotunda-cae-${opt.id}`}
                    onClick={() => {
                      dispatch({ type: "setCaeOverlay", overlay: opt.id });
                      onCue("click");
                    }}
                    style={pillBtn(active)}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Upward-opening 3D Scene & Desk Options Popover */}
        {openPopover === "scene" && activeView === "3d" && (
          <div
            role="dialog"
            aria-label="3D Studio Display & Desk Controls"
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(148, 163, 184, 0.28)",
              background: "rgba(9, 15, 29, 0.95)",
              backdropFilter: "blur(16px)",
              boxShadow: "0 12px 32px rgba(0, 0, 0, 0.5)",
              color: "#e2e8f0",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              width: 268,
            }}
          >
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", color: "#94a3b8" }}>
              3D STUDIO &amp; DESK
            </span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
              <button
                type="button"
                onClick={() => {
                  dispatch({ type: "togglePodiumVisible" });
                  onCue("click");
                }}
                style={pillBtn(state.podiumVisible)}
              >
                Drafting Desk
              </button>
              <button
                type="button"
                onClick={() => {
                  dispatch({ type: "toggleWingsVisible" });
                  onCue("click");
                }}
                style={pillBtn(state.wingsVisible, "#8b5cf6")}
              >
                3D Wings
              </button>
              {state.podiumVisible && (
                <>
                  <button
                    type="button"
                    data-testid="rotunda-cycle-desk-scale"
                    onClick={() => {
                      dispatch({ type: "cycleDeskScale" });
                      onCue("click");
                    }}
                    style={pillBtn(false)}
                  >
                    Desk {deskScaleLabel(state.deskScale)}
                  </button>
                  <button
                    type="button"
                    data-testid="rotunda-toggle-desk-tilt"
                    onClick={() => {
                      dispatch({ type: "togglePodiumTilt" });
                      onCue("click");
                    }}
                    style={pillBtn(false)}
                  >
                    Tilt {Math.round(90 - state.podiumTiltDeg)}°
                  </button>
                  <button
                    type="button"
                    data-testid="rotunda-cycle-desk-theme"
                    onClick={() => {
                      dispatch({ type: "cycleDeskTheme" });
                      onCue("click");
                    }}
                    style={pillBtn(false)}
                  >
                    {CANVAS_BOARD_THEMES[state.deskTheme].label}
                  </button>
                </>
              )}
              <button
                type="button"
                data-testid="rotunda-toggle-ghost"
                onClick={() => {
                  dispatch({ type: "toggleGhostShell" });
                  onCue("click");
                }}
                style={pillBtn(state.ghostShellEnabled, "#06b6d4")}
              >
                Ghost Shell
              </button>
              <button
                type="button"
                data-testid="rotunda-toggle-labels"
                onClick={() => {
                  dispatch({ type: "toggleShowLabels" });
                  onCue("click");
                }}
                style={pillBtn(state.showLabels, "#f97316")}
              >
                Labels
              </button>
              <button
                type="button"
                data-testid="rotunda-toggle-turntable"
                onClick={() => {
                  dispatch({ type: "toggleAutoTurntable" });
                  onCue("click");
                }}
                style={pillBtn(state.autoTurntable, "#22c55e")}
              >
                Turntable
              </button>
              <button
                type="button"
                data-testid="rotunda-toggle-ao"
                disabled={state.environment === "passthrough"}
                onClick={() => {
                  dispatch({ type: "toggleStudioSsao" });
                  onCue("click");
                }}
                style={{
                  ...pillBtn(state.studioSsaoEnabled && state.environment !== "passthrough"),
                  opacity: state.environment === "passthrough" ? 0.45 : 1,
                }}
              >
                Studio AO
              </button>
            </div>
          </div>
        )}

        {/* Single Sleek Contextual Dock Bar */}
        <div
          data-testid="rotunda-control-dock"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 10px",
            borderRadius: 12,
            border: "1px solid rgba(148, 163, 184, 0.25)",
            background: "rgba(9, 15, 29, 0.88)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            boxShadow: "0 10px 28px rgba(0, 0, 0, 0.42)",
            color: "#e2e8f0",
            fontSize: 11,
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          {/* Active-View Contextual Tools */}
          {activeView === "diagram" && renderDiagramControls(true)}

          {activeView === "3d" && (
            <>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "#cbd5e1" }}>
                <span>Explode</span>
                <input
                  type="range"
                  aria-label="CAD Explode Factor"
                  min={0}
                  max={100}
                  value={Math.round(state.explodeFactor * 100)}
                  onChange={(e) => dispatch({ type: "setExplode", factor: Number(e.target.value) / 100 })}
                  style={{ width: 64, accentColor: "#38bdf8", cursor: "pointer" }}
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  dispatch({ type: "toggleSectionCut" });
                  onCue("click");
                }}
                style={pillBtn(state.sectionCutEnabled, "#06b6d4")}
              >
                Cut
              </button>
              <button
                type="button"
                data-testid="rotunda-toggle-scale-mode"
                title="Model scale: Hero → Tabletop → 1:1 (M)"
                onClick={() => {
                  dispatch({ type: "toggleScaleMode" });
                  onCue("snap");
                }}
                style={pillBtn(state.scaleMode !== "hero", "#f59e0b")}
              >
                {rotundaScaleModeLabel(state.scaleMode)}
              </button>
              <button
                type="button"
                onClick={() => setOpenPopover((p) => (p === "cae" ? null : "cae"))}
                style={pillBtn(state.caeOverlay !== "none" || openPopover === "cae")}
              >
                {state.caeOverlay === "none" ? "CAE" : state.caeOverlay.toUpperCase()}
              </button>
              <button
                type="button"
                onClick={() => setOpenPopover((p) => (p === "scene" ? null : "scene"))}
                style={pillBtn(openPopover === "scene" || state.podiumVisible)}
              >
                Scene
              </button>
            </>
          )}

          {activeView === "simulation" && (
            <button
              type="button"
              onClick={() => {
                dispatch({ type: "togglePlaying" });
                onCue("click");
              }}
              style={pillBtn(state.isPlaying, "#10b981")}
            >
              {state.isPlaying ? "⏸ Pause Playback" : "▶ Play Playback"}
            </button>
          )}

          {(activeView === "inspector" || activeView === "code") && (
            <span
              data-testid="rotunda-language-badge"
              style={{
                padding: "3px 8px",
                borderRadius: 6,
                background: langTheme.accentColor,
                color: "#ffffff",
                fontSize: 10.5,
                fontWeight: 700,
              }}
            >
              {langTheme.badgeLabel} · {activeView === "code" ? "Code Workstation" : "Inspector Console"}
            </span>
          )}

          {(activeView === "code" || splitCodeOpen) && (
            <>
              {activeView === "code" && onScrollCode && (
                <>
                  <button
                    type="button"
                    data-testid="rotunda-code-scroll-top"
                    onClick={() => {
                      onScrollCode("top");
                      onCue("tick");
                    }}
                    style={pillBtn(false)}
                    title="Scroll 3D code panel to top"
                  >
                    ⤒ Top
                  </button>
                  <button
                    type="button"
                    data-testid="rotunda-code-scroll-bottom"
                    onClick={() => {
                      onScrollCode("bottom");
                      onCue("tick");
                    }}
                    style={pillBtn(false)}
                    title="Scroll 3D code panel to bottom"
                  >
                    ⤓ Bottom
                  </button>
                </>
              )}
              {onToggleVrQuickEdit && (
                <button
                  type="button"
                  data-testid="rotunda-quick-edit-code"
                  aria-pressed={vrQuickEditOpen}
                  onClick={() => {
                    onToggleVrQuickEdit();
                    onCue("click");
                  }}
                  style={pillBtn(vrQuickEditOpen, "#6366f1")}
                  title="Toggle translucent Monaco quick-edit overlay (Esc to close)"
                >
                  {vrQuickEditOpen ? "✕ Done" : "✎ Edit"}
                </button>
              )}
            </>
          )}

          {divider}

          {/* Always-Available Spatial Environment & XR Controls */}
          <button
            type="button"
            data-testid="rotunda-env-trigger"
            onClick={() => setOpenPopover((p) => (p === "env" ? null : "env"))}
            style={pillBtn(openPopover === "env", activeEnvMeta.accentColor)}
            title="Switch VR room environment"
          >
            Env: {activeEnvMeta.shortLabel}
          </button>

          {workspaceFileCount > 1 && (
            <button
              type="button"
              data-testid="rotunda-toggle-file-carousel"
              onClick={() => {
                dispatch({ type: "toggleFileCarousel" });
                onCue("page");
              }}
              style={pillBtn(state.fileCarouselOpen, langTheme.accentColor)}
            >
              Files ({workspaceFileCount})
            </button>
          )}

          <button
            type="button"
            data-testid="rotunda-toggle-ambient-audio"
            onClick={onToggleAmbientMuted}
            title={ambientMuted ? "Unmute spatial audio" : "Mute spatial audio"}
            style={pillBtn(!ambientMuted, "#22c55e")}
          >
            {ambientMuted ? "🔇" : "🔊"}
          </button>

          {xrSupported.vr && (
            <button
              type="button"
              data-testid="rotunda-enter-vr-btn"
              onClick={onEnterVr}
              style={{
                padding: "4px 11px",
                borderRadius: 7,
                border: "none",
                background: "linear-gradient(135deg, #6366f1, #0891b2)",
                color: "#ffffff",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Enter VR Headset
            </button>
          )}
          {xrSupported.ar && (
            <button
              type="button"
              data-testid="rotunda-enter-ar-btn"
              onClick={onEnterAr}
              style={pillBtn(state.environment === "passthrough", "#a855f7")}
            >
              MR Passthrough
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── STANDALONE MODE: Stacked cleanly with full backward-compatible testids ──
  return (
    <div
      ref={rootRef}
      style={{
        position: "absolute",
        bottom: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        maxWidth: "calc(100% - 24px)",
      }}
    >
      {/* Diagram Studio Bar stacked cleanly above the main dock (zero hardcoded bottom: 112 overlap) */}
      {activeView === "diagram" && renderDiagramControls(false)}

      <div
        data-testid="rotunda-control-dock"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          padding: "6px 12px",
          borderRadius: 12,
          border: "1px solid rgba(148, 163, 184, 0.25)",
          background: "rgba(9, 15, 29, 0.88)",
          backdropFilter: "blur(12px)",
          color: "#e2e8f0",
          fontSize: 11,
        }}
      >
        {/* 6 Environment Presets */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {ROTUNDA_ENVIRONMENTS.map((env) => {
            const active = state.environment === env.id;
            return (
              <button
                key={env.id}
                type="button"
                data-testid={`rotunda-env-${env.id}`}
                onClick={() => onSelectEnvironment(env.id)}
                title={env.description}
                style={{
                  padding: "3px 8px",
                  borderRadius: 999,
                  border: active ? `1px solid ${env.accentColor}` : "1px solid #334155",
                  background: active ? "rgba(56, 189, 248, 0.18)" : "rgba(15, 23, 42, 0.7)",
                  color: active ? "#f8fafc" : "#94a3b8",
                  fontSize: 11,
                  fontWeight: active ? 700 : 500,
                  cursor: "pointer",
                }}
              >
                {env.shortLabel}
              </button>
            );
          })}
        </div>

        {divider}

        {/* Explode Slider */}
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#cbd5e1" }}>
          <span>Explode</span>
          <input
            type="range"
            aria-label="CAD Explode Factor"
            min={0}
            max={100}
            value={Math.round(state.explodeFactor * 100)}
            onChange={(e) => dispatch({ type: "setExplode", factor: Number(e.target.value) / 100 })}
            style={{ width: 64, accentColor: "#38bdf8", cursor: "pointer" }}
          />
        </label>

        {/* CAE Overlays */}
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          {CAE_OPTIONS.map((opt) => {
            const active = state.caeOverlay === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                data-testid={`rotunda-cae-${opt.id}`}
                onClick={() => {
                  dispatch({ type: "setCaeOverlay", overlay: opt.id });
                  onCue("click");
                }}
                style={{
                  padding: "3px 7px",
                  borderRadius: 6,
                  border: active ? "1px solid #38bdf8" : "1px solid #334155",
                  background: active ? "rgba(56, 189, 248, 0.2)" : "transparent",
                  color: active ? "#f8fafc" : "#94a3b8",
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {divider}

        <button
          type="button"
          onClick={() => {
            dispatch({ type: "toggleSectionCut" });
            onCue("click");
          }}
          style={pillBtn(state.sectionCutEnabled, "#06b6d4")}
        >
          Cut
        </button>
        <button
          type="button"
          data-testid="rotunda-toggle-scale-mode"
          title="Model scale: Hero → Tabletop → 1:1 (M)"
          onClick={() => {
            dispatch({ type: "toggleScaleMode" });
            onCue("snap");
          }}
          style={pillBtn(state.scaleMode !== "tabletop", "#f59e0b")}
        >
          {rotundaScaleModeLabel(state.scaleMode)}
        </button>
        <button
          type="button"
          onClick={() => {
            dispatch({ type: "togglePodiumVisible" });
            onCue("click");
          }}
          style={pillBtn(state.podiumVisible)}
        >
          Desk
        </button>
        <button
          type="button"
          data-testid="rotunda-cycle-desk-scale"
          onClick={() => {
            dispatch({ type: "cycleDeskScale" });
            onCue("click");
          }}
          style={pillBtn(false)}
        >
          Desk {deskScaleLabel(state.deskScale)}
        </button>
        <button
          type="button"
          data-testid="rotunda-toggle-desk-tilt"
          onClick={() => {
            dispatch({ type: "togglePodiumTilt" });
            onCue("click");
          }}
          style={pillBtn(false)}
        >
          Tilt {Math.round(90 - state.podiumTiltDeg)}°
        </button>
        <button
          type="button"
          data-testid="rotunda-cycle-desk-theme"
          onClick={() => {
            dispatch({ type: "cycleDeskTheme" });
            onCue("click");
          }}
          style={pillBtn(state.deskTheme === "blueprint")}
        >
          {CANVAS_BOARD_THEMES[state.deskTheme].label}
        </button>
        {state.deskHeightY !== null && (
          <button
            type="button"
            data-testid="rotunda-reset-desk-height"
            onClick={() => {
              dispatch({ type: "resetDeskHeight" });
              onCue("click");
            }}
            style={pillBtn(true)}
          >
            Height {state.deskHeightY.toFixed(2)} m ✕
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            dispatch({ type: "toggleWingsVisible" });
            onCue("click");
          }}
          style={pillBtn(state.wingsVisible, "#8b5cf6")}
        >
          3D Menus
        </button>
        <button
          type="button"
          data-testid="rotunda-toggle-ghost"
          onClick={() => {
            dispatch({ type: "toggleGhostShell" });
            onCue("click");
          }}
          style={pillBtn(state.ghostShellEnabled, "#06b6d4")}
        >
          Ghost Shell
        </button>
        <button
          type="button"
          data-testid="rotunda-toggle-labels"
          onClick={() => {
            dispatch({ type: "toggleShowLabels" });
            onCue("click");
          }}
          style={pillBtn(state.showLabels, "#f97316")}
        >
          Labels
        </button>
        <button
          type="button"
          data-testid="rotunda-toggle-turntable"
          onClick={() => {
            dispatch({ type: "toggleAutoTurntable" });
            onCue("click");
          }}
          style={pillBtn(state.autoTurntable, "#22c55e")}
        >
          Turntable
        </button>
        <button
          type="button"
          data-testid="rotunda-toggle-telemetry"
          onClick={() => {
            dispatch({ type: "toggleTelemetryWing" });
            onCue("click");
          }}
          style={pillBtn(state.telemetryWingEnabled, "#f97316")}
        >
          Field HUD
        </button>
        <button
          type="button"
          data-testid="rotunda-toggle-diagram-3d"
          onClick={() => {
            onSelectView(activeView === "diagram" ? "3d" : "diagram");
            onCue("arena-rotate");
          }}
          style={pillBtn(activeView === "diagram", "#22d3ee")}
        >
          {activeView === "diagram" ? "✦ Diagram Mode" : "◈ 3D Model"}
        </button>
        <button
          type="button"
          data-testid="rotunda-toggle-code-overlay"
          onClick={() => {
            onToggleSplitCode();
            onCue("click");
          }}
          style={pillBtn(splitCodeOpen || activeView === "code", langTheme.secondaryColor)}
        >
          Code
        </button>
        <button
          type="button"
          data-testid="rotunda-toggle-inspector-overlay"
          onClick={() => {
            onSelectView(activeView === "inspector" ? "3d" : "inspector");
            onCue("click");
          }}
          style={pillBtn(activeView === "inspector", "#a855f7")}
        >
          Inspector
        </button>
        <button
          type="button"
          data-testid="rotunda-toggle-simulation-panel"
          onClick={() => {
            onSelectView(activeView === "simulation" ? "3d" : "simulation");
            onCue("click");
          }}
          style={pillBtn(activeView === "simulation", "#10b981")}
        >
          Sim Plots
        </button>
        {workspaceFileCount > 0 && (
          <button
            type="button"
            data-testid="rotunda-toggle-file-carousel"
            onClick={() => {
              dispatch({ type: "toggleFileCarousel" });
              onCue("page");
            }}
            style={pillBtn(state.fileCarouselOpen, langTheme.accentColor)}
          >
            Files ({workspaceFileCount})
          </button>
        )}
        <span
          data-testid="rotunda-language-badge"
          title={langTheme.diagramKindLabel}
          style={{
            padding: "2px 7px",
            borderRadius: 5,
            background: langTheme.accentColor,
            color: "#ffffff",
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: "0.04em",
          }}
        >
          {langTheme.badgeLabel}
        </span>
        <button
          type="button"
          data-testid="rotunda-toggle-ao"
          disabled={state.environment === "passthrough"}
          onClick={() => {
            dispatch({ type: "toggleStudioSsao" });
            onCue("click");
          }}
          style={{
            ...pillBtn(state.studioSsaoEnabled && state.environment !== "passthrough"),
            opacity: state.environment === "passthrough" ? 0.45 : 1,
          }}
        >
          AO
        </button>
        <button
          type="button"
          data-testid="rotunda-toggle-ambient-audio"
          onClick={onToggleAmbientMuted}
          style={pillBtn(!ambientMuted, "#22c55e")}
        >
          {ambientMuted ? "🔇 Muted" : "🔊 Sound"}
        </button>
      </div>
    </div>
  );
};
