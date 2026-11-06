// SPDX-License-Identifier: AGPL-3.0-or-later

import { BeakerIcon, GearIcon, GraphIcon, ScreenFullIcon, XIcon } from "@primer/octicons-react";
import { IconButton } from "@primer/react";
import React, { useEffect, useRef, useState } from "react";
import { getArtifactView } from "../../api";
import { useTheme } from "../../theme";
import { isTabularDataArtifact } from "../../util/tabular-data-parser";
import ArtifactViewCard from "../artifacts/ArtifactViewCard";
import {
  type AttachArtifactSummary,
  type AttachEditableView,
  findEditProfile,
  getAttachProfile,
  toEditableView,
} from "./attach";

export interface ComposeAttachedArtifactProps {
  artifactId: number | string | null;
  editPostId?: string | number | null | undefined;
  onRemove: () => void;
  onDraftWithAi?: ((artifactView?: Record<string, unknown> | null) => void) | undefined;
  aiDrafting?: boolean | undefined;
  onArtifactViewLoaded?: ((view: Record<string, unknown> | null) => void) | undefined;
  onReplaceArtifact?:
    | ((newArtifactId: number | string, title?: string, createdView?: Record<string, unknown>) => void)
    | undefined;
  /**
   * Open the chart wizard for this (tabular) artifact. `onDone` receives the new chart artifact. Returns false when
   * the attach flow is busy. Provide it to enable the "Visualize Data" actions.
   */
  onVisualize?:
    | ((
        onDone: (newArtifactId: number | string, title: string, createdView: Record<string, unknown>) => void,
      ) => boolean)
    | undefined;
  /** Reopen the attach wizard on this artifact. Offered only when its language has customization options. */
  onCustomize?: ((view: AttachEditableView) => void) | undefined;
  /** Attach a QIF inspection report that references this (STEP) artifact as its 3D model. */
  onAddInspection?: ((file: File, linked: AttachArtifactSummary) => void) | undefined;
}

const STEP_MODEL_TYPES = new Set(["cad-step", "cad_step", "step", "stp"]);

export const ComposeAttachedArtifact: React.FC<ComposeAttachedArtifactProps> = ({
  artifactId,
  editPostId: _editPostId,
  onRemove,
  onDraftWithAi,
  aiDrafting,
  onArtifactViewLoaded,
  onReplaceArtifact,
  onVisualize,
  onCustomize,
  onAddInspection,
}) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [artifactView, setArtifactView] = useState<Record<string, unknown> | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [dismissedVizPromptId, setDismissedVizPromptId] = useState<number | string | null>(null);
  const [dismissedInspectionPromptId, setDismissedInspectionPromptId] = useState<number | string | null>(null);
  const inspectionInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (artifactId === null) {
      setArtifactView(null);
      onArtifactViewLoaded?.(null);
      return;
    }
    getArtifactView(artifactId)
      .then((res: unknown) => {
        const record = res && typeof res === "object" ? (res as Record<string, unknown>) : {};
        const view =
          (record.artifactView as Record<string, unknown> | undefined) ||
          (record.artifact_view as Record<string, unknown> | undefined) ||
          record;
        setArtifactView(view);
        onArtifactViewLoaded?.(view);
      })
      .catch(() => {
        setArtifactView(null);
        onArtifactViewLoaded?.(null);
      });
  }, [artifactId, onArtifactViewLoaded]);

  if (artifactId === null) return null;

  const viewType = String(artifactView?.view_type || artifactView?.artifact_type || "").toLowerCase();
  const isVegaPlot = viewType === "vega" || viewType === "vega-plot";
  const canVisualizeTabular = isTabularDataArtifact(artifactView) && Boolean(onVisualize);
  const openVisualizer = () =>
    onVisualize?.((newArtifactId, title, createdView) => {
      setArtifactView(createdView);
      onArtifactViewLoaded?.(createdView);
      onReplaceArtifact?.(newArtifactId, title, createdView);
    });
  const showQuickVizBanner = canVisualizeTabular && !isVegaPlot && dismissedVizPromptId !== artifactId;

  const isStepModel = STEP_MODEL_TYPES.has(viewType);
  const showInspectionBanner =
    Boolean(onAddInspection) &&
    isStepModel &&
    Boolean(getAttachProfile("qif")?.withLinkedArtifact) &&
    dismissedInspectionPromptId !== artifactId;

  const editableView = onCustomize && artifactView ? toEditableView(artifactView) : undefined;
  const canCustomize = Boolean(editableView && findEditProfile(editableView));

  return (
    <div
      style={{
        position: "relative",
        marginTop: "8px",
        marginBottom: "8px",
      }}
    >
      {showInspectionBanner && (
        <div
          data-testid="step-add-inspection-prompt"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
            flexWrap: "wrap",
            padding: "9px 12px",
            marginBottom: "8px",
            borderRadius: "10px",
            background: "linear-gradient(90deg, rgba(6, 182, 212, 0.14) 0%, rgba(34, 197, 94, 0.08) 100%)",
            border: "1px solid rgba(6, 182, 212, 0.38)",
            fontSize: "12.5px",
            color: "var(--color-fg-default, #e6edf3)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "24px",
                height: "24px",
                borderRadius: "6px",
                background: "rgba(6, 182, 212, 0.22)",
                color: "#22d3ee",
              }}
            >
              <BeakerIcon size={13} />
            </span>
            <span>
              <strong>3D model attached</strong> — Add inspection results (QIF) measured on this part?
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <button
              type="button"
              data-testid="step-add-inspection-btn"
              onClick={() => inspectionInputRef.current?.click()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                padding: "5px 11px",
                borderRadius: "999px",
                border: "1px solid rgba(6, 182, 212, 0.55)",
                background: "rgba(6, 182, 212, 0.25)",
                color: "#cffafe",
                fontSize: "11.5px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <BeakerIcon size={12} />
              <span>Choose QIF file</span>
            </button>
            <button
              type="button"
              data-testid="step-dismiss-inspection-btn"
              onClick={() => setDismissedInspectionPromptId(artifactId)}
              style={{
                padding: "4px 9px",
                borderRadius: "999px",
                border: isDark ? "1px solid rgba(255, 255, 255, 0.14)" : "1px solid rgba(0, 0, 0, 0.14)",
                background: "transparent",
                color: "var(--color-fg-muted, #8b949e)",
                fontSize: "11px",
                cursor: "pointer",
              }}
            >
              Not now
            </button>
            <input
              ref={inspectionInputRef}
              type="file"
              accept=".qif,.qifz,.zip,.xml"
              aria-label="Choose QIF inspection report"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file || artifactId === null) return;
                setDismissedInspectionPromptId(artifactId);
                onAddInspection?.(file, {
                  id: artifactId,
                  title:
                    typeof artifactView?.title === "string" && artifactView.title
                      ? artifactView.title
                      : `Artifact ${artifactId}`,
                  viewType,
                });
              }}
            />
          </div>
        </div>
      )}

      {showQuickVizBanner && (
        <div
          data-testid="vega-quick-viz-prompt"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
            flexWrap: "wrap",
            padding: "9px 12px",
            marginBottom: "8px",
            borderRadius: "10px",
            background: "linear-gradient(90deg, rgba(168, 85, 247, 0.14) 0%, rgba(6, 182, 212, 0.1) 100%)",
            border: "1px solid rgba(168, 85, 247, 0.38)",
            fontSize: "12.5px",
            color: "var(--color-fg-default, #e6edf3)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "24px",
                height: "24px",
                borderRadius: "6px",
                background: "rgba(168, 85, 247, 0.22)",
                color: "#c084fc",
              }}
            >
              <GraphIcon size={13} />
            </span>
            <span>
              <strong>Tabular data attached</strong> — Create a quick interactive Vega-Lite visualization?
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <button
              type="button"
              data-testid="open-vega-wizard-banner-btn"
              onClick={openVisualizer}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                padding: "5px 11px",
                borderRadius: "999px",
                border: "1px solid rgba(168, 85, 247, 0.55)",
                background: "rgba(168, 85, 247, 0.25)",
                color: "#f3e8ff",
                fontSize: "11.5px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <GraphIcon size={12} />
              <span>Choose Vega-Lite Template</span>
            </button>
            <button
              type="button"
              data-testid="dismiss-vega-wizard-banner-btn"
              onClick={() => setDismissedVizPromptId(artifactId)}
              style={{
                padding: "4px 9px",
                borderRadius: "999px",
                border: isDark ? "1px solid rgba(255, 255, 255, 0.14)" : "1px solid rgba(0, 0, 0, 0.14)",
                background: "transparent",
                color: "var(--color-fg-muted, #8b949e)",
                fontSize: "11px",
                cursor: "pointer",
              }}
            >
              Keep as Table
            </button>
          </div>
        </div>
      )}

      <div style={{ position: "relative" }}>
        <ArtifactViewCard
          artifactId={artifactId}
          initialArtifactView={artifactView || undefined}
          isFullScreen={isFullScreen}
          onFullScreenChange={setIsFullScreen}
        />
        <div
          style={{
            position: "absolute",
            top: "8px",
            right: "8px",
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          {canVisualizeTabular && (
            <button
              type="button"
              data-testid="open-vega-wizard-pill-btn"
              onClick={(e) => {
                e.stopPropagation();
                openVisualizer();
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                backgroundColor: isDark ? "rgba(13, 17, 23, 0.85)" : "rgba(255, 255, 255, 0.92)",
                color: isDark ? "#c084fc" : "#7e22ce",
                border: isDark ? "1px solid rgba(168, 85, 247, 0.55)" : "1px solid rgba(147, 51, 234, 0.35)",
                borderRadius: "999px",
                padding: "5px 11px",
                fontSize: "11.5px",
                fontFamily: "var(--font-mono, monospace)",
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: isDark ? "0 2px 6px rgba(0,0,0,0.4)" : "0 1px 3px rgba(0,0,0,0.12)",
                backdropFilter: "blur(8px)",
              }}
              title="Open Vega-Lite Visualization Wizard to choose a chart template and customize axes"
            >
              <GraphIcon size={12} />
              <span>{isVegaPlot ? "Customize Chart" : "Visualize Data"}</span>
            </button>
          )}
          {onDraftWithAi && (
            <button
              type="button"
              disabled={Boolean(aiDrafting)}
              onClick={(e) => {
                e.stopPropagation();
                onDraftWithAi(artifactView);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                backgroundColor: isDark ? "rgba(13, 17, 23, 0.85)" : "rgba(255, 255, 255, 0.92)",
                color: isDark ? "var(--color-accent-cyan, #22d3ee)" : "var(--color-accent-cyan, #0891b2)",
                border: isDark ? "1px solid rgba(6, 182, 212, 0.45)" : "1px solid rgba(8, 145, 178, 0.35)",
                borderRadius: "999px",
                padding: "5px 11px",
                fontSize: "11.5px",
                fontFamily: "var(--font-mono, monospace)",
                fontWeight: 600,
                cursor: aiDrafting ? "wait" : "pointer",
                opacity: aiDrafting ? 0.7 : 1,
                boxShadow: isDark ? "0 2px 6px rgba(0,0,0,0.4)" : "0 1px 3px rgba(0,0,0,0.12)",
                backdropFilter: "blur(8px)",
              }}
              title="Generate or regenerate post draft from this engineering artifact using AI"
            >
              <span>✨</span>
              <span>{aiDrafting ? "Drafting..." : "Draft Post"}</span>
            </button>
          )}
          {canCustomize && editableView && (
            <button
              type="button"
              data-testid="customize-attachment-btn"
              onClick={(e) => {
                e.stopPropagation();
                onCustomize?.(editableView);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                backgroundColor: isDark ? "rgba(13, 17, 23, 0.85)" : "rgba(255, 255, 255, 0.92)",
                color: isDark ? "var(--color-accent-cyan, #22d3ee)" : "var(--color-accent-cyan, #0891b2)",
                border: isDark ? "1px solid rgba(6, 182, 212, 0.4)" : "1px solid rgba(8, 145, 178, 0.35)",
                borderRadius: "999px",
                padding: "5px 11px",
                fontSize: "11.5px",
                fontFamily: "var(--font-mono, monospace)",
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: isDark ? "0 2px 6px rgba(0,0,0,0.4)" : "0 1px 3px rgba(0,0,0,0.12)",
                backdropFilter: "blur(8px)",
              }}
              title="Change how this attachment is shown (for example its 3D model)"
            >
              <GearIcon size={12} />
              <span>Customize</span>
            </button>
          )}
          <button
            type="button"
            data-testid="artifact-fullscreen-btn"
            onClick={(e) => {
              e.stopPropagation();
              setIsFullScreen(true);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              backgroundColor: isDark ? "rgba(13, 17, 23, 0.85)" : "rgba(255, 255, 255, 0.92)",
              color: isDark ? "var(--color-accent-cyan, #22d3ee)" : "var(--color-accent-cyan, #0891b2)",
              border: isDark ? "1px solid rgba(6, 182, 212, 0.4)" : "1px solid rgba(8, 145, 178, 0.35)",
              borderRadius: "999px",
              padding: "5px 11px",
              fontSize: "11.5px",
              fontFamily: "var(--font-mono, monospace)",
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: isDark ? "0 2px 6px rgba(0,0,0,0.4)" : "0 1px 3px rgba(0,0,0,0.12)",
              backdropFilter: "blur(8px)",
            }}
            title="Open in Full Screen modal to view and inspect data/model"
          >
            <ScreenFullIcon size={12} />
            <span>Full Screen</span>
          </button>
          <IconButton
            icon={XIcon}
            variant="invisible"
            onClick={onRemove}
            aria-label="Remove artifact"
            style={{
              backgroundColor: isDark ? "rgba(13, 17, 23, 0.85)" : "rgba(255, 255, 255, 0.92)",
              color: isDark ? "var(--color-fg-muted, #8b949e)" : "var(--color-fg-muted, #656d76)",
              border: isDark ? "1px solid rgba(255, 255, 255, 0.15)" : "1px solid rgba(0, 0, 0, 0.15)",
              boxShadow: isDark ? "0 2px 6px rgba(0,0,0,0.4)" : "0 1px 3px rgba(0,0,0,0.12)",
              borderRadius: "50%",
              width: "28px",
              height: "28px",
            }}
          />
        </div>
      </div>
    </div>
  );
};
