// SPDX-License-Identifier: AGPL-3.0-or-later

import { EyeIcon, ScreenFullIcon, SlidersIcon, StackIcon } from "@primer/octicons-react";
import React, { useEffect, useRef, useState } from "react";

export type CadGizmoMode = "select" | "translate" | "rotate" | "scale" | "tag_face" | "mate";

export interface CadCommandIslandProps {
  dark: boolean;
  compact: boolean;
  /** Transform modes */
  gizmoMode: CadGizmoMode;
  onChangeGizmoMode: (mode: CadGizmoMode) => void;
  canTransform: boolean;
  canTagFace: boolean;
  canMate: boolean;
  /** Section cutting plane */
  clipAxis: "none" | "x" | "y" | "z";
  onChangeClipAxis: (axis: "none" | "x" | "y" | "z") => void;
  clipOffset: number;
  onChangeClipOffset: (offset: number) => void;
  sectionSplit: boolean;
  onToggleSectionSplit: () => void;
  autoSweep: boolean;
  onToggleAutoSweep: () => void;
  /** Display & visual style */
  showEdges: boolean;
  onToggleEdges: () => void;
  enableSsao: boolean;
  onToggleSsao: () => void;
  autoTurntable: boolean;
  onToggleTurntable: () => void;
  hasGdt: boolean;
  showGdt: boolean;
  onToggleGdt: () => void;
  partCount: number;
  explosionFactor: number;
  onChangeExplosionFactor: (factor: number) => void;
  /** Inspector drawer toggle (Parts / Subsystems / CAE Sim Tree) */
  isDrawerOpen: boolean;
  onToggleDrawer: () => void;
  hasCaeContext: boolean;
  /** Reset / re-frame 3D camera to fit unobstructed viewport */
  onResetCamera?: (() => void) | undefined;
  /** Optional standalone VR / WebXR trigger (only when NOT hosted under workbench topbar) */
  onOpenVrRotunda?: (() => void) | undefined;
  canEnterWebXr?: boolean | undefined;
  onEnterWebXr?: (() => void) | undefined;
}

type PopoverKind = "section" | "display" | null;

const IconCursor = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 2l10 5.5-4.5 1.5L7 13.5 3 2z" />
  </svg>
);

const IconMove = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M8 2v12M2 8h12M6 4l2-2 2 2M6 12l2 2 2-2M4 6L2 8l2 2M12 6l2 2-2 2" />
  </svg>
);

const IconRotate = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M13 8a5 5 0 1 1-1.5-3.6L13 6" />
    <path d="M13 2.5V6H9.5" />
  </svg>
);

const IconScale = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2.5" y="7.5" width="6" height="6" rx="1" />
    <path d="M9.5 6.5l4-4M10 2.5h3.5V6" />
  </svg>
);

const IconTag = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2.5 8.2V3.5a1 1 0 0 1 1-1h4.7l5.3 5.3a1 1 0 0 1 0 1.4l-4.3 4.3a1 1 0 0 1-1.4 0L2.5 8.2z" />
    <circle cx="5.7" cy="5.7" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);

const IconMate = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="5.5" cy="8" r="3" />
    <circle cx="10.5" cy="8" r="3" />
  </svg>
);

const IconSection = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2 13L13 2" />
    <path d="M5 13h8V5" strokeDasharray="2 2" />
    <rect x="2.5" y="2.5" width="5.5" height="5.5" rx="1" />
  </svg>
);

/**
 * Calm, bottom-center 3D command island mirroring 2D Diagram's `AnsatzCommandIsland`.
 * Consolidates 14+ legacy inline toolbar pills into crisp transform buttons +
 * upward-opening Section & Display popovers so it never overflows or collides.
 */
export const CadCommandIsland: React.FC<CadCommandIslandProps> = ({
  dark,
  compact,
  gizmoMode,
  onChangeGizmoMode,
  canTransform,
  canTagFace,
  canMate,
  clipAxis,
  onChangeClipAxis,
  clipOffset,
  onChangeClipOffset,
  sectionSplit,
  onToggleSectionSplit,
  autoSweep,
  onToggleAutoSweep,
  showEdges,
  onToggleEdges,
  enableSsao,
  onToggleSsao,
  autoTurntable,
  onToggleTurntable,
  hasGdt,
  showGdt,
  onToggleGdt,
  partCount,
  explosionFactor,
  onChangeExplosionFactor,
  isDrawerOpen,
  onToggleDrawer,
  hasCaeContext,
  onResetCamera,
  onOpenVrRotunda,
  canEnterWebXr,
  onEnterWebXr,
}) => {
  const [openPopover, setOpenPopover] = useState<PopoverKind>(null);
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

  const surfaceBg = dark ? "rgba(15, 23, 42, 0.88)" : "rgba(255, 255, 255, 0.94)";
  const popoverBg = dark ? "rgba(15, 23, 42, 0.96)" : "rgba(255, 255, 255, 0.98)";
  const borderCol = dark ? "rgba(255, 255, 255, 0.14)" : "rgba(15, 23, 42, 0.12)";
  const dividerCol = dark ? "rgba(255, 255, 255, 0.12)" : "rgba(15, 23, 42, 0.1)";
  const textFg = dark ? "#e2e8f0" : "#0f172a";
  const mutedFg = dark ? "#94a3b8" : "#64748b";
  const activeBg = "rgba(8, 145, 178, 0.18)";
  const activeBorder = "rgba(8, 145, 178, 0.45)";
  const activeFg = dark ? "#22d3ee" : "#0e7490";

  const showTransformCluster = canTransform || canMate || canTagFace;
  const transformModes: Array<{ mode: CadGizmoMode; label: string; title: string; icon: React.ReactNode }> = [
    { mode: "select", label: "Select", title: "Select mode (Esc)", icon: <IconCursor /> },
    ...(canTransform
      ? [
          { mode: "translate" as const, label: "Move", title: "Translate gizmo (W)", icon: <IconMove /> },
          { mode: "rotate" as const, label: "Rotate", title: "Rotate gizmo (E)", icon: <IconRotate /> },
          { mode: "scale" as const, label: "Scale", title: "Scale gizmo (R)", icon: <IconScale /> },
        ]
      : []),
    ...(canTagFace
      ? [{ mode: "tag_face" as const, label: "Tag", title: "Tag a 3D face as a port/boundary (T)", icon: <IconTag /> }]
      : []),
    ...(canTransform || canMate
      ? [
          {
            mode: "mate" as const,
            label: "Mate",
            title: "Mate two 3D parts with an assembly joint (M)",
            icon: <IconMate />,
          },
        ]
      : []),
  ];

  const isSectionActive = clipAxis !== "none";
  const activeDisplayCount =
    (showEdges ? 1 : 0) + (enableSsao ? 1 : 0) + (autoTurntable ? 1 : 0) + (explosionFactor > 0 ? 1 : 0);

  const btnBase = (active: boolean): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    height: 28,
    padding: compact ? "0 7px" : "0 9px",
    borderRadius: 8,
    border: active ? `1px solid ${activeBorder}` : "1px solid transparent",
    background: active ? activeBg : "transparent",
    color: active ? activeFg : textFg,
    fontSize: 11.5,
    fontWeight: active ? 600 : 500,
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "background-color 0.14s ease, color 0.14s ease, border-color 0.14s ease",
  });

  return (
    <div
      ref={rootRef}
      style={{
        position: "relative",
        pointerEvents: "auto",
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        maxWidth: "100%",
      }}
    >
      {/* Upward-opening Section Cut Popover */}
      {openPopover === "section" && (
        <div
          data-testid="cad-section-popover"
          role="dialog"
          aria-label="Section cutting plane controls"
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: "50%",
            transform: "translateX(-50%)",
            width: 248,
            padding: "10px 12px",
            borderRadius: 12,
            background: popoverBg,
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            border: `1px solid ${borderCol}`,
            boxShadow: dark ? "0 12px 32px rgba(0, 0, 0, 0.5)" : "0 12px 32px rgba(15, 23, 42, 0.16)",
            color: textFg,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            zIndex: 30,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.02em", color: mutedFg }}>
              SECTION PLANE
            </span>
            {isSectionActive && (
              <button
                type="button"
                onClick={() => onChangeClipAxis("none")}
                style={{
                  border: "none",
                  background: "transparent",
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
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
            {(["none", "x", "y", "z"] as const).map((axis) => {
              const active = clipAxis === axis;
              return (
                <button
                  key={axis}
                  type="button"
                  onClick={() => onChangeClipAxis(axis)}
                  style={{
                    height: 26,
                    borderRadius: 7,
                    border: active ? `1px solid ${activeBorder}` : `1px solid ${borderCol}`,
                    background: active ? activeBg : "transparent",
                    color: active ? activeFg : textFg,
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {axis === "none" ? "Off" : `Cut ${axis.toUpperCase()}`}
                </button>
              );
            })}
          </div>
          {isSectionActive && (
            <>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11 }}>
                <div style={{ display: "flex", justifyContent: "space-between", color: mutedFg }}>
                  <span>Plane Offset</span>
                  <span style={{ fontFamily: "var(--ms-font-mono, monospace)", color: textFg }}>
                    {clipOffset.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.02"
                  value={clipOffset}
                  onChange={(e) => onChangeClipOffset(parseFloat(e.target.value))}
                  aria-label="Section cutting plane offset"
                  style={{ width: "100%", accentColor: "#0891b2", cursor: "pointer" }}
                />
              </label>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  onClick={onToggleSectionSplit}
                  style={{
                    flex: 1,
                    height: 26,
                    borderRadius: 7,
                    border: sectionSplit ? `1px solid ${activeBorder}` : `1px solid ${borderCol}`,
                    background: sectionSplit ? activeBg : "transparent",
                    color: sectionSplit ? activeFg : textFg,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Split Cap
                </button>
                <button
                  type="button"
                  onClick={onToggleAutoSweep}
                  style={{
                    flex: 1,
                    height: 26,
                    borderRadius: 7,
                    border: autoSweep ? `1px solid ${activeBorder}` : `1px solid ${borderCol}`,
                    background: autoSweep ? activeBg : "transparent",
                    color: autoSweep ? activeFg : textFg,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Auto Sweep
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Upward-opening Display & Visual Settings Popover */}
      {openPopover === "display" && (
        <div
          data-testid="cad-display-popover"
          role="dialog"
          aria-label="3D display settings"
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: "50%",
            transform: "translateX(-50%)",
            width: 248,
            padding: "10px 12px",
            borderRadius: 12,
            background: popoverBg,
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            border: `1px solid ${borderCol}`,
            boxShadow: dark ? "0 12px 32px rgba(0, 0, 0, 0.5)" : "0 12px 32px rgba(15, 23, 42, 0.16)",
            color: textFg,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            zIndex: 30,
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.02em", color: mutedFg }}>
            DISPLAY &amp; SHADING
          </span>
          {(
            [
              { label: "Crease Edges", active: showEdges, onClick: onToggleEdges },
              { label: "Ambient Occlusion (SSAO)", active: enableSsao, onClick: onToggleSsao },
              { label: "Turntable Auto-Rotate", active: autoTurntable, onClick: onToggleTurntable },
              ...(hasGdt ? [{ label: "ASME Y14.5 GD&T Callouts", active: showGdt, onClick: onToggleGdt }] : []),
            ] as Array<{ label: string; active: boolean; onClick: () => void }>
          ).map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={item.onClick}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "5px 8px",
                borderRadius: 7,
                border: item.active ? `1px solid ${activeBorder}` : `1px solid transparent`,
                background: item.active ? activeBg : dark ? "rgba(255,255,255,0.03)" : "rgba(15,23,42,0.03)",
                color: item.active ? activeFg : textFg,
                fontSize: 11.5,
                fontWeight: item.active ? 600 : 500,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span>{item.label}</span>
              <span style={{ fontSize: 10, fontWeight: 700, opacity: item.active ? 1 : 0.55 }}>
                {item.active ? "ON" : "OFF"}
              </span>
            </button>
          ))}
          {partCount > 1 && (
            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                paddingTop: 6,
                borderTop: `1px solid ${dividerCol}`,
                fontSize: 11,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", color: mutedFg }}>
                <span>Assembly Explode</span>
                <span style={{ fontFamily: "var(--ms-font-mono, monospace)", color: textFg }}>
                  {Math.round(explosionFactor * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="2"
                step="0.05"
                value={explosionFactor}
                onChange={(e) => onChangeExplosionFactor(parseFloat(e.target.value))}
                aria-label="Assembly explode factor"
                style={{ width: "100%", accentColor: "#0891b2", cursor: "pointer" }}
              />
            </label>
          )}
        </div>
      )}

      {/* Main bottom glass island */}
      <div
        data-testid="cad-command-island"
        role="toolbar"
        aria-label="3D viewport tools"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 2,
          height: 38,
          padding: "0 6px",
          maxWidth: "100%",
          borderRadius: "var(--ms-radius-lg, 12px)",
          background: surfaceBg,
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          border: `1px solid ${borderCol}`,
          boxShadow: dark ? "0 8px 28px -4px rgba(0, 0, 0, 0.45)" : "0 8px 28px -4px rgba(15, 23, 42, 0.14)",
          userSelect: "none",
        }}
      >
        {/* Transform cluster */}
        {showTransformCluster && (
          <>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
              {transformModes.map((btn) => {
                const active = gizmoMode === btn.mode;
                return (
                  <button
                    key={btn.mode}
                    type="button"
                    aria-pressed={active}
                    aria-label={btn.label}
                    title={btn.title}
                    onClick={() => onChangeGizmoMode(btn.mode)}
                    style={{
                      ...btnBase(active),
                      padding: compact ? "0 6px" : "0 8px",
                    }}
                  >
                    {btn.icon}
                    {!compact && active && <span>{btn.label}</span>}
                  </button>
                );
              })}
            </div>
            <span style={{ width: 1, height: 16, background: dividerCol, margin: "0 3px", flexShrink: 0 }} />
          </>
        )}

        {/* Section popover trigger */}
        <button
          type="button"
          data-testid="cad-toggle-section-popover"
          aria-expanded={openPopover === "section"}
          title="Section cutting plane (X / Y / Z)"
          onClick={() => setOpenPopover((p) => (p === "section" ? null : "section"))}
          style={btnBase(isSectionActive || openPopover === "section")}
        >
          <IconSection />
          {!compact && <span>{isSectionActive ? `Cut ${clipAxis.toUpperCase()}` : "Section"}</span>}
        </button>

        {/* Display popover trigger */}
        <button
          type="button"
          data-testid="cad-toggle-display-popover"
          aria-expanded={openPopover === "display"}
          title="Display, shading, turntable & explode settings"
          onClick={() => setOpenPopover((p) => (p === "display" ? null : "display"))}
          style={btnBase(openPopover === "display" || autoTurntable || explosionFactor > 0)}
        >
          <EyeIcon size={13} />
          {!compact && <span>Display</span>}
          {!compact && activeDisplayCount > 1 && (
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                padding: "0 4px",
                borderRadius: 999,
                background: activeBg,
                color: activeFg,
              }}
            >
              {activeDisplayCount}
            </span>
          )}
        </button>

        {/* Unified Parts / Subsystems / CAE Drawer toggle */}
        {(partCount > 0 || hasCaeContext) && (
          <button
            type="button"
            data-testid="cad-toggle-inspector-drawer"
            aria-pressed={isDrawerOpen}
            title={hasCaeContext ? "Toggle Parts & CAE Simulation Drawer" : "Toggle Assembly Parts & Appearances"}
            onClick={onToggleDrawer}
            style={btnBase(isDrawerOpen)}
          >
            {hasCaeContext ? <SlidersIcon size={13} /> : <StackIcon size={13} />}
            <span>{compact ? `${partCount}` : hasCaeContext ? `Parts & CAE` : `Parts (${partCount})`}</span>
          </button>
        )}

        {/* Fit / Reset 3D Camera */}
        {onResetCamera && (
          <>
            <span style={{ width: 1, height: 16, background: dividerCol, margin: "0 3px", flexShrink: 0 }} />
            <button
              type="button"
              data-testid="cad-fit-camera"
              aria-label="Fit 3D model to view"
              title="Reset & Fit 3D camera (Shift+1)"
              onClick={onResetCamera}
              style={{
                ...btnBase(false),
                width: 28,
                padding: 0,
              }}
            >
              <ScreenFullIcon size={13} />
            </button>
          </>
        )}

        {/* Standalone fallback VR trigger (never shown when workbench topbar owns VR) */}
        {(onOpenVrRotunda || (canEnterWebXr && onEnterWebXr)) && (
          <>
            <span style={{ width: 1, height: 16, background: dividerCol, margin: "0 3px", flexShrink: 0 }} />
            <button
              type="button"
              data-testid={onOpenVrRotunda ? "cad-viewer-open-vr-rotunda" : "cad-viewer-enter-vr"}
              onClick={onOpenVrRotunda ?? onEnterWebXr}
              title={onOpenVrRotunda ? "Open VR Spatial Mode" : "Enter WebXR VR headset session"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                height: 26,
                padding: "0 9px",
                borderRadius: 8,
                border: "none",
                background: "linear-gradient(135deg, #6366f1 0%, #0891b2 100%)",
                color: "#ffffff",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <span>VR</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
};
