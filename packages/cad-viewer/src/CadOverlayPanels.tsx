// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Overlay UI sub-components for CadViewer: empty state, CAE quick-action bar,
 * floating face-tagging popover, and assembly-joint (mate) workflow popovers.
 */

import type React from "react";
import type {
  CommitAssemblyJointPayload,
  CommitFaceTagPayload,
  FaceTagDraft,
  GizmoMode,
  MateDraft,
} from "./cad-viewer-helpers";
import type { VtkSlicePlane } from "./VtkRenderer";

// ── Empty State ──────────────────────────────────────────────────────────────

export function CadEmptyState({
  dark,
  fitInsets,
}: {
  dark?: boolean | undefined;
  fitInsets?: { top: number; right: number; bottom: number; left: number } | undefined;
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        paddingTop: fitInsets?.top ?? 0,
        paddingRight: fitInsets?.right ?? 0,
        paddingBottom: fitInsets?.bottom ?? 0,
        paddingLeft: fitInsets?.left ?? 0,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        color: dark ? "#888" : "#aaa",
        fontFamily: "system-ui, sans-serif",
        fontSize: 14,
        flexDirection: "column",
        gap: 8,
      }}
    >
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
      <span>No shape classes found</span>
      <span style={{ fontSize: 12, opacity: 0.7 }}>
        Add <code>shape</code> components to your model
      </span>
    </div>
  );
}

// ── Compact CAE 2030 Quick-Action Bar ────────────────────────────────────────

export interface CaeQuickActionBarProps {
  dark: boolean;
  hasPrimarySurfaceMesh: boolean;
  hasComponentsAndVtk: boolean;
  enableExperimentalCaePanels: boolean;
  isPickBoundaryMode: boolean;
  isTelemetryOpen: boolean;
  isCaeSolving: boolean;
  isoSurfaceEnabled: boolean;
  isoThreshold: number;
  slicePlane: VtkSlicePlane | null;
  isFeaWarpContext: boolean;
  isCfdFlowContext: boolean;
  animateDeformation: boolean;
  deformationScale: number;
  animateFlow: boolean;
  showCaeStreamlines: boolean;
  showCaeVectors: boolean;
  ghostCadUnderlay: boolean;
  timestepFrameCount: number;
  activeVtkFrame: number;
  isPlayingTimesteps: boolean;
  onOpenStudyWizard: () => void;
  onOpenSweepDrawer: () => void;
  onTogglePickBoundaryMode: () => void;
  onOpenSurrogateTrain: () => void;
  onToggleTelemetry: () => void;
  onToggleIsoSurface: () => void;
  onChangeIsoThreshold: (val: number) => void;
  onCycleSlicePlane: () => void;
  onChangeSlicePosition: (val: number) => void;
  onToggleAnimateDeformation: () => void;
  onChangeDeformationScale: (val: number) => void;
  onToggleAnimateFlow: () => void;
  onToggleCaeStreamlines: () => void;
  onToggleCaeVectors: () => void;
  onToggleGhostCadUnderlay: () => void;
  onTogglePlayTimesteps: () => void;
  onChangeActiveVtkFrame: (frame: number) => void;
  onTriggerHpcRun?: (() => void) | undefined;
}

const compactActionBtnStyle: React.CSSProperties = {
  padding: "4px 8px",
  borderRadius: "var(--ms-radius-sm, 6px)",
  border: "1px solid var(--ms-border, var(--color-border-default))",
  background: "var(--ms-bg-alt, var(--color-canvas-subtle))",
  color: "var(--ms-text-1, var(--color-fg-default))",
  fontSize: "var(--text-2xs, 11px)",
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export function CaeQuickActionBar({
  dark,
  hasPrimarySurfaceMesh,
  hasComponentsAndVtk,
  enableExperimentalCaePanels,
  isPickBoundaryMode,
  isTelemetryOpen,
  isCaeSolving,
  isoSurfaceEnabled,
  isoThreshold,
  slicePlane,
  isFeaWarpContext,
  isCfdFlowContext,
  animateDeformation,
  deformationScale,
  animateFlow,
  showCaeStreamlines,
  showCaeVectors,
  ghostCadUnderlay,
  timestepFrameCount,
  activeVtkFrame,
  isPlayingTimesteps,
  onOpenStudyWizard,
  onOpenSweepDrawer,
  onTogglePickBoundaryMode,
  onOpenSurrogateTrain,
  onToggleTelemetry,
  onToggleIsoSurface,
  onChangeIsoThreshold,
  onCycleSlicePlane,
  onChangeSlicePosition,
  onToggleAnimateDeformation,
  onChangeDeformationScale,
  onToggleAnimateFlow,
  onToggleCaeStreamlines,
  onToggleCaeVectors,
  onToggleGhostCadUnderlay,
  onTogglePlayTimesteps,
  onChangeActiveVtkFrame,
  onTriggerHpcRun,
}: CaeQuickActionBarProps) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 4,
        padding: "6px 8px",
        borderRadius: 10,
        background: dark ? "rgba(15, 23, 42, 0.92)" : "rgba(255, 255, 255, 0.96)",
        border: `1px solid ${dark ? "rgba(255,255,255,0.14)" : "rgba(15,23,42,0.12)"}`,
        maxWidth: 272,
      }}
    >
      <button type="button" onClick={onOpenStudyWizard} style={compactActionBtnStyle}>
        + Study
      </button>
      <button type="button" onClick={onOpenSweepDrawer} style={compactActionBtnStyle}>
        DoE Sweep
      </button>
      {hasPrimarySurfaceMesh && (
        <button
          type="button"
          onClick={onTogglePickBoundaryMode}
          style={{
            ...compactActionBtnStyle,
            color: isPickBoundaryMode ? "var(--ms-brand, #0e7490)" : compactActionBtnStyle.color,
            borderColor: isPickBoundaryMode ? "var(--ms-brand, #0e7490)" : undefined,
          }}
          title="Click 3D model faces to assign FEA supports/loads or CFD boundary markers"
        >
          {isPickBoundaryMode ? "Picking BC" : "Pick Face BC"}
        </button>
      )}
      {enableExperimentalCaePanels && (
        <button type="button" onClick={onOpenSurrogateTrain} style={compactActionBtnStyle}>
          POD ROM
        </button>
      )}
      <button
        type="button"
        onClick={onToggleTelemetry}
        style={{
          ...compactActionBtnStyle,
          color: isTelemetryOpen || isCaeSolving ? "#22d3ee" : compactActionBtnStyle.color,
        }}
      >
        Telemetry
      </button>
      <button
        type="button"
        onClick={onToggleIsoSurface}
        style={{
          ...compactActionBtnStyle,
          color: isoSurfaceEnabled ? "#22d3ee" : compactActionBtnStyle.color,
        }}
      >
        Iso {isoSurfaceEnabled ? "ON" : "OFF"}
      </button>
      <button
        type="button"
        onClick={onCycleSlicePlane}
        style={{
          ...compactActionBtnStyle,
          color: slicePlane ? "#22d3ee" : compactActionBtnStyle.color,
        }}
      >
        Slice {slicePlane ? slicePlane.axis.toUpperCase() : "OFF"}
      </button>
      {isFeaWarpContext && (
        <button
          type="button"
          onClick={onToggleAnimateDeformation}
          style={{
            ...compactActionBtnStyle,
            color: animateDeformation ? "var(--ms-brand, #0e7490)" : compactActionBtnStyle.color,
          }}
          title="Play/Pause oscillating FEA structural deformation"
        >
          {animateDeformation ? "Pause Warp" : "Animate Warp"}
        </button>
      )}
      {isCfdFlowContext && (
        <>
          <button
            type="button"
            onClick={onToggleAnimateFlow}
            style={{
              ...compactActionBtnStyle,
              color: animateFlow ? "var(--ms-brand, #0e7490)" : compactActionBtnStyle.color,
            }}
            title="Play/Pause animated CFD flow streaks"
          >
            {animateFlow ? "Pause Flow" : "Animate Flow"}
          </button>
          <button
            type="button"
            onClick={onToggleCaeStreamlines}
            style={{
              ...compactActionBtnStyle,
              color: showCaeStreamlines ? "var(--ms-brand, #0e7490)" : compactActionBtnStyle.color,
            }}
          >
            Streamlines
          </button>
          <button
            type="button"
            onClick={onToggleCaeVectors}
            style={{
              ...compactActionBtnStyle,
              color: showCaeVectors ? "var(--ms-brand, #0e7490)" : compactActionBtnStyle.color,
            }}
          >
            Vectors
          </button>
        </>
      )}
      {hasComponentsAndVtk && (
        <button
          type="button"
          onClick={onToggleGhostCadUnderlay}
          style={{
            ...compactActionBtnStyle,
            color: ghostCadUnderlay ? "var(--ms-brand, #0e7490)" : compactActionBtnStyle.color,
          }}
          title="Render companion CAD geometry as translucent ghost underlay"
        >
          Ghost CAD
        </button>
      )}
      {onTriggerHpcRun && (
        <button
          type="button"
          onClick={onTriggerHpcRun}
          style={{
            ...compactActionBtnStyle,
            color: "var(--ms-brand, #0e7490)",
          }}
          title="Dispatch CAE study to Cloud / HPC cluster"
        >
          Run on HPC
        </button>
      )}
      {isFeaWarpContext && (
        <label
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 10,
            color: dark ? "#cbd5e1" : "#334155",
            marginTop: 2,
          }}
        >
          <span>Warp</span>
          <input
            type="range"
            min={0}
            max={50}
            step={1}
            value={deformationScale}
            onChange={(e) => onChangeDeformationScale(parseFloat(e.target.value))}
            style={{ flex: 1 }}
          />
          <span>{deformationScale}x</span>
        </label>
      )}
      {timestepFrameCount > 1 && (
        <div
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 10,
            color: dark ? "#cbd5e1" : "#334155",
            marginTop: 2,
          }}
        >
          <button
            type="button"
            onClick={onTogglePlayTimesteps}
            style={{
              ...compactActionBtnStyle,
              color: isPlayingTimesteps ? "#22d3ee" : compactActionBtnStyle.color,
            }}
            title="Play/Pause transient VTK timestep frames"
          >
            {isPlayingTimesteps ? "⏸" : "▶"}
          </button>
          <input
            type="range"
            min={0}
            max={timestepFrameCount - 1}
            step={1}
            value={Math.min(activeVtkFrame, timestepFrameCount - 1)}
            onChange={(e) => onChangeActiveVtkFrame(parseInt(e.target.value, 10))}
            style={{ flex: 1 }}
          />
          <span>
            {Math.min(activeVtkFrame, timestepFrameCount - 1) + 1}/{timestepFrameCount}
          </span>
        </div>
      )}
      {isoSurfaceEnabled && (
        <label
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 10,
            color: dark ? "#cbd5e1" : "#334155",
            marginTop: 2,
          }}
        >
          <span>Iso τ</span>
          <input
            type="range"
            min={0.05}
            max={0.95}
            step={0.05}
            value={isoThreshold}
            onChange={(e) => onChangeIsoThreshold(parseFloat(e.target.value))}
            style={{ flex: 1 }}
          />
          <span>{isoThreshold.toFixed(2)}</span>
        </label>
      )}
      {slicePlane && (
        <label
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 10,
            color: dark ? "#cbd5e1" : "#334155",
            marginTop: 2,
          }}
        >
          <span>{slicePlane.axis.toUpperCase()} pos</span>
          <input
            type="range"
            min={0.05}
            max={0.95}
            step={0.05}
            value={slicePlane.position}
            onChange={(e) => onChangeSlicePosition(parseFloat(e.target.value))}
            style={{ flex: 1 }}
          />
          <span>{slicePlane.position.toFixed(2)}</span>
        </label>
      )}
    </div>
  );
}

// ── Floating Face Tagging Popover ────────────────────────────────────────────

export function FaceTagPopover({
  dark,
  draft,
  onChangeDraft,
  onClose,
  onCommit,
}: {
  dark: boolean;
  draft: FaceTagDraft;
  onChangeDraft: React.Dispatch<React.SetStateAction<FaceTagDraft | null>>;
  onClose: () => void;
  onCommit: (payload: CommitFaceTagPayload) => void;
}) {
  return (
    <div
      style={{
        pointerEvents: "auto",
        width: 248,
        padding: "10px 12px",
        background: dark ? "rgba(15, 23, 42, 0.94)" : "rgba(255, 255, 255, 0.96)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderRadius: 10,
        border: `1px solid ${dark ? "rgba(6, 182, 212, 0.45)" : "rgba(6, 182, 212, 0.35)"}`,
        boxShadow: "0 10px 28px rgba(0, 0, 0, 0.32)",
        color: dark ? "#f0f6fc" : "#1f2328",
        fontSize: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ fontSize: 12, color: "#06b6d4" }}>Tag Face · {draft.hit.componentName}</strong>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close face tag popover"
          style={{
            background: "transparent",
            border: "none",
            color: dark ? "#94a3b8" : "#64748b",
            cursor: "pointer",
            fontSize: 13,
            padding: 0,
          }}
        >
          ✕
        </button>
      </div>
      {draft.hit.normal && (
        <div style={{ fontSize: 10, fontFamily: "var(--font-mono, monospace)", opacity: 0.75 }}>
          n = [{draft.hit.normal.map((v) => v.toFixed(2)).join(", ")}]
        </div>
      )}
      <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11 }}>
        <span style={{ opacity: 0.8 }}>Port Name</span>
        <input
          type="text"
          value={draft.portName}
          onChange={(e) => onChangeDraft((prev) => (prev ? { ...prev, portName: e.target.value } : null))}
          style={{
            padding: "4px 7px",
            borderRadius: 6,
            border: `1px solid ${dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.16)"}`,
            background: dark ? "#0f172a" : "#ffffff",
            color: "inherit",
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 11,
          }}
        />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11 }}>
        <span style={{ opacity: 0.8 }}>Port / Boundary Type</span>
        <select
          value={draft.portType}
          onChange={(e) => onChangeDraft((prev) => (prev ? { ...prev, portType: e.target.value } : null))}
          style={{
            padding: "4px 7px",
            borderRadius: 6,
            border: `1px solid ${dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.16)"}`,
            background: dark ? "#0f172a" : "#ffffff",
            color: "inherit",
            fontSize: 11,
          }}
        >
          <option value="fixed_support">fixed_support</option>
          <option value="force_load">force_load</option>
          <option value="thermal_boundary">thermal_boundary</option>
          <option value="fluid_inlet">fluid_inlet</option>
          <option value="mechanical_frame">mechanical_frame</option>
        </select>
      </label>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 2 }}>
        <button
          type="button"
          onClick={onClose}
          style={{
            padding: "4px 8px",
            borderRadius: 6,
            border: `1px solid ${dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.14)"}`,
            background: "transparent",
            color: "inherit",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            const portName = draft.portName.trim() || "port_1";
            onCommit({
              componentName: draft.hit.componentName,
              portName,
              portType: draft.portType,
              normal: draft.hit.normal,
              worldPos: draft.hit.worldPos,
              sourceMetadata: draft.hit.sourceMetadata,
            });
            onClose();
          }}
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            border: "none",
            background: "#06b6d4",
            color: "#0f172a",
            fontSize: 11,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Tag Face
        </button>
      </div>
    </div>
  );
}

// ── Mate / Assembly Joint Popovers ───────────────────────────────────────────

export function MateWorkflowPopovers({
  dark,
  gizmoMode,
  matePartA,
  mateDraft,
  onClearMatePartA,
  onChangeMateDraft,
  onCancelMate,
  onCommitAssemblyJoint,
  onClearSelection,
}: {
  dark: boolean;
  gizmoMode: GizmoMode;
  matePartA: string | null;
  mateDraft: MateDraft | null;
  onClearMatePartA: () => void;
  onChangeMateDraft: React.Dispatch<React.SetStateAction<MateDraft | null>>;
  onCancelMate: () => void;
  onCommitAssemblyJoint?: ((payload: CommitAssemblyJointPayload) => void) | undefined;
  onClearSelection: () => void;
}) {
  return (
    <>
      {/* Mate Mode Status Hint (waiting for Part B) */}
      {gizmoMode === "mate" && matePartA && !mateDraft && (
        <div
          style={{
            pointerEvents: "auto",
            padding: "6px 10px",
            background: dark ? "rgba(15, 23, 42, 0.92)" : "rgba(255, 255, 255, 0.95)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            borderRadius: 10,
            border: `1px solid ${dark ? "rgba(6, 182, 212, 0.45)" : "rgba(6, 182, 212, 0.35)"}`,
            boxShadow: "0 6px 20px rgba(0, 0, 0, 0.25)",
            color: dark ? "#f0f6fc" : "#1f2328",
            fontSize: 11,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span>
            <strong style={{ color: "#06b6d4" }}>Mate:</strong> {matePartA} → click second part
          </span>
          <button
            type="button"
            onClick={onClearMatePartA}
            aria-label="Clear first mate part"
            style={{
              background: "transparent",
              border: "none",
              color: dark ? "#94a3b8" : "#64748b",
              cursor: "pointer",
              fontSize: 12,
              padding: 0,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Assembly Joint (Mate) Popover */}
      {mateDraft && (
        <div
          style={{
            pointerEvents: "auto",
            width: 256,
            padding: "10px 12px",
            background: dark ? "rgba(15, 23, 42, 0.94)" : "rgba(255, 255, 255, 0.96)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            borderRadius: 10,
            border: `1px solid ${dark ? "rgba(6, 182, 212, 0.45)" : "rgba(6, 182, 212, 0.35)"}`,
            boxShadow: "0 10px 28px rgba(0, 0, 0, 0.32)",
            color: dark ? "#f0f6fc" : "#1f2328",
            fontSize: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong style={{ fontSize: 12, color: "#06b6d4" }}>
              Mate · {mateDraft.partA} ↔ {mateDraft.partB}
            </strong>
            <button
              type="button"
              onClick={onCancelMate}
              aria-label="Close assembly joint popover"
              style={{
                background: "transparent",
                border: "none",
                color: dark ? "#94a3b8" : "#64748b",
                cursor: "pointer",
                fontSize: 13,
                padding: 0,
              }}
            >
              ✕
            </button>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11 }}>
            <span style={{ opacity: 0.8 }}>Joint Name</span>
            <input
              type="text"
              value={mateDraft.jointName}
              onChange={(e) => onChangeMateDraft((prev) => (prev ? { ...prev, jointName: e.target.value } : null))}
              style={{
                padding: "4px 7px",
                borderRadius: 6,
                border: `1px solid ${dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.16)"}`,
                background: dark ? "#0f172a" : "#ffffff",
                color: "inherit",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 11,
              }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11 }}>
            <span style={{ opacity: 0.8 }}>Joint Type</span>
            <select
              value={mateDraft.jointType}
              onChange={(e) =>
                onChangeMateDraft((prev) =>
                  prev ? { ...prev, jointType: e.target.value as CommitAssemblyJointPayload["jointType"] } : null,
                )
              }
              style={{
                padding: "4px 7px",
                borderRadius: 6,
                border: `1px solid ${dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.16)"}`,
                background: dark ? "#0f172a" : "#ffffff",
                color: "inherit",
                fontSize: 11,
              }}
            >
              <option value="Revolute">Revolute</option>
              <option value="Prismatic">Prismatic</option>
              <option value="Cylindrical">Cylindrical</option>
              <option value="Spherical">Spherical</option>
              <option value="Fixed">Fixed</option>
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11 }}>
            <span style={{ opacity: 0.8 }}>Axis</span>
            <select
              value={mateDraft.axisKey}
              onChange={(e) =>
                onChangeMateDraft((prev) => (prev ? { ...prev, axisKey: e.target.value as "z" | "y" | "x" } : null))
              }
              style={{
                padding: "4px 7px",
                borderRadius: 6,
                border: `1px solid ${dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.16)"}`,
                background: dark ? "#0f172a" : "#ffffff",
                color: "inherit",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 11,
              }}
            >
              <option value="z">Z [0, 0, 1]</option>
              <option value="y">Y [0, 1, 0]</option>
              <option value="x">X [1, 0, 0]</option>
            </select>
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 2 }}>
            <button
              type="button"
              onClick={onCancelMate}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                border: `1px solid ${dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.14)"}`,
                background: "transparent",
                color: "inherit",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                const axisMap: Record<"z" | "y" | "x", [number, number, number]> = {
                  z: [0, 0, 1],
                  y: [0, 1, 0],
                  x: [1, 0, 0],
                };
                const jointName = mateDraft.jointName.trim() || `joint_${mateDraft.partA}_${mateDraft.partB}`;
                onCommitAssemblyJoint?.({
                  jointName,
                  jointType: mateDraft.jointType,
                  partA: mateDraft.partA,
                  partB: mateDraft.partB,
                  axis: axisMap[mateDraft.axisKey],
                });
                onCancelMate();
                onClearSelection();
              }}
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                border: "none",
                background: "#06b6d4",
                color: "#0f172a",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Create Joint
            </button>
          </div>
        </div>
      )}
    </>
  );
}
