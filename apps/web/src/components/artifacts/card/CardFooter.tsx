// SPDX-License-Identifier: AGPL-3.0-or-later

import { DownloadIcon, LinkExternalIcon, RepoForkedIcon, ScreenFullIcon, ServerIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useFeatureFlag } from "../../../FeatureFlagContext";
import { buildCitationFromArtifact } from "../../../util/citations";
import {
  buildEditorUrlForArtifact,
  isEditableCodeOrModelArtifact,
  isMultiFileArtifact,
  openArtifactInVsCodeWindow,
} from "../../../util/editor-routing";
import { sanitizeHttpUrl } from "../../../util/url";
import Box from "../../Box";
import { CiteButton } from "../../citations/CiteButton";
import { DraftingTriangleIcon } from "../../icons";
import { VsCodeIcon } from "../../icons/VsCodeIcon";
import { useCardFooterSlotRegister } from "./CardFooterSlot";
import { formatViewType } from "./utils";

const CardFooterBar = styled(Box)`
  container-type: inline-size;
  container-name: card-footer;

  .card-footer-ghost {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    flex-shrink: 0;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: var(--color-fg-muted);
    cursor: pointer;
    transition:
      background 0.12s ease,
      color 0.12s ease;
  }
  .card-footer-ghost:hover {
    background: var(--color-neutral-muted, rgba(128, 128, 128, 0.15));
    color: var(--color-fg-default);
  }
  .card-footer-ghost:focus-visible {
    outline: 2px solid var(--ms-brand, #0e7490);
    outline-offset: 1px;
  }

  .card-footer-ghost.is-primary {
    color: var(--ms-brand, #0e7490);
  }
  .card-footer-ghost.is-primary:hover {
    background: var(--ms-brand-soft, rgba(14, 116, 144, 0.12));
    color: var(--ms-brand, #0e7490);
  }

  /* Tabbed viewers portal their tab strip here; when present it sits alongside or replaces the title. */
  .card-footer-slot {
    display: inline-flex;
    align-items: center;
    min-width: 0;
    flex: 0 1 auto;
  }
  .card-footer-slot:empty {
    display: none;
  }
  @container card-footer (max-width: 480px) {
    .card-footer-slot:not(:empty) ~ .card-footer-title-group {
      display: none;
    }
  }
  .card-footer-title-group {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }

  .card-footer-divider {
    width: 1px;
    height: 16px;
    margin: 0 4px;
    background: var(--color-border-default);
    flex-shrink: 0;
  }

  /* Lightweight tooltip: label + one-line description */
  [data-tip] {
    position: relative;
  }
  [data-tip]::after {
    content: attr(data-tip);
    position: absolute;
    right: -4px;
    bottom: calc(100% + 8px);
    width: max-content;
    max-width: 220px;
    padding: 5px 8px;
    border-radius: 6px;
    background: var(--color-neutral-emphasis-plus, #24292f);
    color: #ffffff;
    font-size: 11px;
    line-height: 15px;
    font-weight: 500;
    text-align: left;
    white-space: pre-line;
    pointer-events: none;
    opacity: 0;
    transform: translateY(2px);
    transition:
      opacity 0.12s ease,
      transform 0.12s ease;
    z-index: 20;
  }
  [data-tip]:hover::after,
  [data-tip]:focus-visible::after {
    opacity: 1;
    transform: none;
    transition-delay: 0.25s;
  }

  @container card-footer (max-width: 360px) {
    .card-footer-provenance {
      display: none;
    }
  }
`;

export interface CardFooterProps {
  artifact: any;
  artifactId: number;
  viewConfig: any;
  isLoaded: boolean;
  onOpenFullScreen: () => void;
  onRunOnHpc?: () => void;
}

export const CardFooter: React.FC<CardFooterProps> = ({
  artifact,
  artifactId,
  viewConfig,
  isLoaded,
  onOpenFullScreen,
  onRunOnHpc,
}) => {
  const navigate = useNavigate();
  const registerSlot = useCardFooterSlotRegister();
  const hasCloudSolverFlag = useFeatureFlag("cae_cloud_solver");

  const artifactDescriptor = {
    view_type: artifact?.view_type,
    view_config: viewConfig,
  };
  const isMultiFile = isMultiFileArtifact(artifactDescriptor);
  const isEditable = isEditableCodeOrModelArtifact(artifactDescriptor);

  const handleOpenEditor = (e?: React.MouseEvent | React.KeyboardEvent) => {
    e?.stopPropagation?.();
    if (isMultiFile) {
      openArtifactInVsCodeWindow({
        artifactId,
        viewType: artifact?.view_type,
        viewConfig,
        title: artifact?.title || artifact?.name || viewConfig?.title,
      });
      return;
    }
    navigate(
      buildEditorUrlForArtifact({
        artifactId,
        viewType: artifact?.view_type,
        viewConfig,
        title: artifact?.title || artifact?.name || viewConfig?.title,
      }),
    );
  };

  const handleOpenVsCode = (e?: React.MouseEvent | React.KeyboardEvent) => {
    e?.stopPropagation?.();
    openArtifactInVsCodeWindow({
      artifactId,
      viewType: artifact?.view_type,
      viewConfig,
      title: artifact?.title || artifact?.name || viewConfig?.title,
    });
  };

  const handleReproduce = (e?: React.MouseEvent | React.KeyboardEvent) => {
    e?.stopPropagation?.();
    window.open(
      `/api/v1/cae/jobs/${encodeURIComponent(String(viewConfig.jobId))}/reproduce-spec`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const rawViewType = String(artifact?.view_type || "").toLowerCase();
  const isPdf = rawViewType === "pdf";
  const pdfUrl = isPdf ? sanitizeHttpUrl(viewConfig?.url, { allowRelative: true }) : null;
  const isUntitledMediaOr3dViewer = [
    "picture",
    "video",
    "youtube_video",
    "audio",
    "pdf",
    "cad",
    "cad-step",
    "cad_step",
    "cad-3d-viewer",
    "step",
    "stp",
    "3d-model",
    "simulation",
    "simulation-result",
    "fea-result",
    "cfd-result",
    "cfd-animation",
    "gcode",
    "cam-result",
    "webgpu",
    "webgpu-simulation",
    "gpu-simulation",
    "link-preview",
  ].includes(rawViewType);
  void isUntitledMediaOr3dViewer;
  const formatLabel = formatViewType(artifact?.view_type, viewConfig);

  return (
    <CardFooterBar
      px={2}
      borderTop="1px solid var(--color-border-default)"
      backgroundColor="var(--color-canvas-subtle)"
      display="flex"
      justifyContent="space-between"
      alignItems="center"
      style={{ gap: "8px", minHeight: "36px", flexShrink: 0, marginTop: "auto" }}
    >
      <Box display="flex" alignItems="center" gap={2} style={{ minWidth: 0, flex: 1 }}>
        <span
          className="card-footer-format-badge"
          style={{
            fontSize: "10.5px",
            lineHeight: "14px",
            color: "var(--color-fg-muted)",
            fontWeight: 700,
            fontFamily: "var(--font-mono, monospace)",
            whiteSpace: "nowrap",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            paddingLeft: 4,
            flexShrink: 0,
          }}
        >
          {formatLabel}
        </span>
        <div ref={registerSlot} className="card-footer-slot" />
        <div className="card-footer-title-group">
          <Text
            style={{
              fontSize: "12px",
              lineHeight: "18px",
              fontWeight: 600,
              color: "var(--color-fg-default)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
            title={artifact.title || viewConfig.title || ""}
          >
            {artifact.title || viewConfig.title || ""}
          </Text>
          {viewConfig.provenance && (
            <span
              className="card-footer-provenance"
              style={{
                fontSize: "11px",
                lineHeight: "14px",
                color: "var(--ms-brand)",
                fontFamily: "var(--font-mono)",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              ⚡ {viewConfig.provenance.solver?.toUpperCase()} • {viewConfig.provenance.profile}
            </span>
          )}
        </div>
      </Box>
      <Box display="flex" alignItems="center" gap="2px" style={{ flexShrink: 0 }}>
        {/* Info / reference actions */}
        <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex" }}>
          <CiteButton
            target={buildCitationFromArtifact({
              id: Number(artifactId || artifact?.id || 0),
              title: artifact?.title || viewConfig?.title,
              viewType: artifact?.view_type,
              authorUsername: artifact?.username,
              authorDisplayName: artifact?.display_name,
              createdAt: artifact?.created_at,
              description: viewConfig?.description || viewConfig?.caption,
              localPdfUrl: pdfUrl,
            })}
            label="Cite"
            variant="icon-only"
            testId={`artifact-card-cite-btn-${artifactId}`}
          />
        </span>
        {isPdf && pdfUrl && (
          <>
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="card-footer-ghost"
              data-tip="Open PDF in a new tab"
              aria-label="Open PDF in a new tab"
              onClick={(e) => e.stopPropagation()}
            >
              <LinkExternalIcon size={14} />
            </a>
            <a
              href={pdfUrl}
              download
              className="card-footer-ghost"
              data-tip="Download PDF"
              aria-label="Download PDF"
              onClick={(e) => e.stopPropagation()}
            >
              <DownloadIcon size={14} />
            </a>
          </>
        )}
        {viewConfig.provenance && viewConfig.jobId && (
          <button
            type="button"
            className="card-footer-ghost"
            onClick={handleReproduce}
            data-tip={"Fork & Reproduce\nInspect the run recipe"}
            aria-label="Fork and reproduce"
          >
            <RepoForkedIcon size={14} />
          </button>
        )}
        {hasCloudSolverFlag && onRunOnHpc && (
          <button
            type="button"
            className="card-footer-ghost"
            onClick={(e) => {
              e.stopPropagation();
              onRunOnHpc();
            }}
            data-tip={"Run on Cloud HPC\nDispatch a simulation job"}
            aria-label="Run on Cloud HPC"
          >
            <ServerIcon size={14} />
          </button>
        )}
        {isLoaded && (
          <button
            type="button"
            className="card-footer-ghost"
            onClick={(e) => {
              e.stopPropagation();
              onOpenFullScreen();
            }}
            title="Full screen"
            aria-label="Full Screen"
            data-tip={"Full Screen\nView larger here (read-only)"}
          >
            <ScreenFullIcon size={14} />
          </button>
        )}
        {/* "Open in…" actions: leave the page to edit and run */}
        {isEditable && <span className="card-footer-divider" aria-hidden="true" />}
        {isEditable && !isMultiFile && (
          <button
            type="button"
            className="card-footer-ghost is-primary"
            onClick={handleOpenEditor}
            data-tip={"Morsel\nEdit and run in the browser"}
            aria-label="Open in Morsel"
          >
            <DraftingTriangleIcon size={14} />
          </button>
        )}
        {isEditable && (
          <button
            type="button"
            className="card-footer-ghost"
            onClick={handleOpenVsCode}
            data-tip={"VS Code\nFull IDE in a new window"}
            aria-label="Open in VS Code"
          >
            <VsCodeIcon size={14} color="#0284c7" />
          </button>
        )}
      </Box>
    </CardFooterBar>
  );
};
