// SPDX-License-Identifier: AGPL-3.0-or-later

import { GraphIcon, PencilIcon, XIcon } from "@primer/octicons-react";
import { IconButton } from "@primer/react";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getArtifactView } from "../../api";
import { buildEditorUrlForArtifact, isMultiFileArtifact } from "../../util/editor-routing";
import { isTabularDataArtifact } from "../../util/tabular-data-parser";
import ArtifactViewCard from "../artifacts/ArtifactViewCard";
import { VegaWizardModal } from "./VegaWizardModal";

export interface ComposeAttachedArtifactProps {
  artifactId: number | null;
  editPostId?: string | number | null | undefined;
  onRemove: () => void;
  onDraftWithAi?: ((artifactView?: Record<string, unknown> | null) => void) | undefined;
  aiDrafting?: boolean | undefined;
  onArtifactViewLoaded?: ((view: Record<string, unknown> | null) => void) | undefined;
  onReplaceArtifact?:
    | ((newArtifactId: number, title?: string, createdView?: Record<string, unknown>) => void)
    | undefined;
}

export const ComposeAttachedArtifact: React.FC<ComposeAttachedArtifactProps> = ({
  artifactId,
  editPostId,
  onRemove,
  onDraftWithAi,
  aiDrafting,
  onArtifactViewLoaded,
  onReplaceArtifact,
}) => {
  const navigate = useNavigate();
  const [artifactView, setArtifactView] = useState<Record<string, unknown> | null>(null);
  const [isMultiFile, setIsMultiFile] = useState(false);
  const [showVegaWizard, setShowVegaWizard] = useState(false);
  const [dismissedVizPromptId, setDismissedVizPromptId] = useState<number | null>(null);

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
        const viewType = String(view?.view_type || view?.artifact_type || "");
        setArtifactView(view);
        onArtifactViewLoaded?.(view);
        setIsMultiFile(
          isMultiFileArtifact({
            ...view,
            view_type: viewType,
          }),
        );
      })
      .catch(() => {
        setArtifactView(null);
        onArtifactViewLoaded?.(null);
        setIsMultiFile(false);
      });
  }, [artifactId, onArtifactViewLoaded]);

  if (artifactId === null) return null;

  const viewType = String(artifactView?.view_type || artifactView?.artifact_type || "").toLowerCase();
  const isVegaPlot = viewType === "vega" || viewType === "vega-plot";
  const canVisualizeTabular = isTabularDataArtifact(artifactView);
  const showQuickVizBanner = canVisualizeTabular && !isVegaPlot && dismissedVizPromptId !== artifactId;

  const numericEditPostId =
    editPostId !== null && editPostId !== undefined && !Number.isNaN(Number(editPostId))
      ? Number(editPostId)
      : undefined;

  const targetUrl = buildEditorUrlForArtifact({
    artifactId,
    viewType: String(artifactView?.view_type || artifactView?.artifact_type || ""),
    viewConfig: artifactView?.view_config,
    title: typeof artifactView?.title === "string" ? artifactView.title : undefined,
    mode: numericEditPostId !== undefined ? "edit" : "open",
    editPostId: numericEditPostId,
  });

  return (
    <div
      style={{
        position: "relative",
        marginTop: "8px",
        marginBottom: "8px",
      }}
    >
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
              onClick={() => setShowVegaWizard(true)}
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
                border: "1px solid rgba(255, 255, 255, 0.14)",
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
        <ArtifactViewCard artifactId={artifactId} />
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
                setShowVegaWizard(true);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                backgroundColor: "rgba(0, 0, 0, 0.82)",
                color: "#c084fc",
                border: "1px solid rgba(168, 85, 247, 0.55)",
                borderRadius: "999px",
                padding: "5px 11px",
                fontSize: "11.5px",
                fontFamily: "var(--font-mono, monospace)",
                fontWeight: 600,
                cursor: "pointer",
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
                backgroundColor: "rgba(0, 0, 0, 0.82)",
                color: "var(--color-accent-cyan, #06b6d4)",
                border: "1px solid rgba(6, 182, 212, 0.45)",
                borderRadius: "999px",
                padding: "5px 11px",
                fontSize: "11.5px",
                fontFamily: "var(--font-mono, monospace)",
                fontWeight: 600,
                cursor: aiDrafting ? "wait" : "pointer",
                opacity: aiDrafting ? 0.7 : 1,
              }}
              title="Generate or regenerate post draft from this engineering artifact using AI"
            >
              <span>✨</span>
              <span>{aiDrafting ? "Drafting..." : "Draft Post"}</span>
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              navigate(targetUrl);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              backgroundColor: "rgba(0, 0, 0, 0.78)",
              color: "var(--color-accent-cyan, #06b6d4)",
              border: "1px solid rgba(6, 182, 212, 0.4)",
              borderRadius: "999px",
              padding: "5px 11px",
              fontSize: "11.5px",
              fontFamily: "var(--font-mono, monospace)",
              fontWeight: 600,
              cursor: "pointer",
            }}
            title={isMultiFile ? "Edit in Web IDE" : "Edit in Playground"}
          >
            <PencilIcon size={12} />
            <span>{isMultiFile ? "Edit in IDE" : "Edit in Playground"}</span>
          </button>
          <IconButton
            icon={XIcon}
            variant="invisible"
            onClick={onRemove}
            aria-label="Remove artifact"
            style={{
              backgroundColor: "rgba(0, 0, 0, 0.75)",
              color: "white",
              border: "none",
              boxShadow: "none",
              borderRadius: "50%",
              width: "32px",
              height: "32px",
            }}
          />
        </div>
      </div>

      {showVegaWizard && (
        <VegaWizardModal
          isOpen={showVegaWizard}
          onClose={() => setShowVegaWizard(false)}
          artifactId={artifactId}
          artifactView={artifactView}
          onApplyVisualization={(newArtifactId, title, createdView) => {
            if (createdView) {
              setArtifactView(createdView);
              onArtifactViewLoaded?.(createdView);
            }
            onReplaceArtifact?.(newArtifactId, title, createdView);
          }}
        />
      )}
    </div>
  );
};
