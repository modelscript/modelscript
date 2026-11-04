// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DownloadIcon,
  KebabHorizontalIcon,
  LinkExternalIcon,
  PlayIcon,
  RepoForkedIcon,
  ScreenFullIcon,
  ServerIcon,
} from "@primer/octicons-react";
import { ActionList, ActionMenu, IconButton, Text } from "@primer/react";
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
import { VsCodeIcon } from "../../icons/VsCodeIcon";

const CardFooterBar = styled(Box)`
  .card-footer-mobile-menu {
    display: none;
  }

  @media (max-width: 767px) {
    padding-left: 10px !important;
    padding-right: 10px !important;

    .card-footer-hide-mobile {
      display: none !important;
    }

    .card-footer-mobile-menu {
      display: inline-flex;
    }

    .card-footer-playground-label-full {
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

  return (
    <CardFooterBar
      px={3}
      py={1}
      borderTop="1px solid var(--color-accent-blue-border, var(--color-border-default))"
      backgroundColor="var(--ms-brand-soft, var(--color-canvas-subtle))"
      display="flex"
      justifyContent="space-between"
      alignItems="center"
      style={{ gap: "8px", minHeight: "40px", flexShrink: 0, marginTop: "auto" }}
    >
      <Box display="flex" alignItems="center" gap={2} style={{ minWidth: 0, flex: 1 }}>
        {isPdf && (
          <span
            style={{
              fontSize: "10px",
              lineHeight: "14px",
              background: "var(--color-canvas-default)",
              color: "var(--ms-brand, #0e7490)",
              border: "1px solid var(--color-border-default)",
              padding: "1px 6px",
              borderRadius: "9999px",
              fontWeight: 700,
              fontFamily: "var(--font-mono, monospace)",
              whiteSpace: "nowrap",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              flexShrink: 0,
            }}
          >
            PDF
          </span>
        )}
        {isUntitledMediaOr3dViewer ? (
          <Text
            style={{
              fontSize: "12.5px",
              lineHeight: "18px",
              fontWeight: 600,
              color: "var(--color-fg-default)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={artifact.title || viewConfig.title || ""}
          >
            {artifact.title || viewConfig.title || ""}
          </Text>
        ) : (
          <span
            style={{
              fontSize: "10.5px",
              lineHeight: "14px",
              background: "var(--color-canvas-default)",
              color: "var(--color-fg-default)",
              border: "1px solid var(--color-border-default)",
              padding: "2px 8px",
              borderRadius: "9999px",
              fontWeight: 700,
              fontFamily: "var(--font-mono, monospace)",
              whiteSpace: "nowrap",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {rawViewType || "ARTIFACT"}
          </span>
        )}
        {viewConfig.provenance && (
          <span
            className="card-footer-hide-mobile"
            style={{
              fontSize: "11px",
              lineHeight: "14px",
              background: "var(--ms-brand-soft)",
              color: "var(--ms-brand)",
              border: "1px solid var(--color-border-default)",
              padding: "2px 7px",
              borderRadius: "6px",
              fontWeight: 600,
              fontFamily: "var(--font-mono)",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            ⚡ {viewConfig.provenance.solver?.toUpperCase()} • {viewConfig.provenance.profile}
          </span>
        )}
      </Box>
      <Box display="flex" alignItems="center" gap="6px" style={{ flexShrink: 0 }}>
        {viewConfig.provenance && viewConfig.jobId && (
          <button
            type="button"
            className="card-footer-hide-mobile"
            onClick={handleReproduce}
            style={{
              background: "var(--color-canvas-default)",
              color: "var(--color-fg-default)",
              border: "1px solid var(--color-border-default)",
              borderRadius: "6px",
              height: "28px",
              padding: "0 10px",
              fontSize: "12px",
              lineHeight: "16px",
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              whiteSpace: "nowrap",
            }}
            title="Inspect execution recipe and reproduction parameters"
          >
            ⚡ Fork &amp; Reproduce
          </button>
        )}
        {hasCloudSolverFlag && onRunOnHpc && (
          <button
            type="button"
            className="card-footer-hide-mobile"
            onClick={(e) => {
              e.stopPropagation();
              onRunOnHpc();
            }}
            style={{
              background: "var(--color-canvas-default)",
              color: "var(--color-success-fg, #059669)",
              border: "1px solid var(--color-border-default)",
              borderRadius: "6px",
              height: "28px",
              padding: "0 10px",
              fontSize: "12px",
              lineHeight: "16px",
              fontWeight: 700,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              whiteSpace: "nowrap",
            }}
            title="Dispatch simulation job against this model artifact on Cloud HPC"
          >
            Run on HPC
          </button>
        )}
        {isPdf && pdfUrl && (
          <>
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "var(--color-canvas-default)",
                color: "var(--color-fg-default)",
                border: "1px solid var(--color-border-default)",
                borderRadius: "6px",
                height: "28px",
                padding: "0 10px",
                fontSize: "12px",
                lineHeight: "16px",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                whiteSpace: "nowrap",
                textDecoration: "none",
              }}
              title="Open PDF in a new browser tab"
            >
              <LinkExternalIcon size={12} /> Open in Tab
            </a>
            <a
              href={pdfUrl}
              download
              className="card-footer-hide-mobile"
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "var(--color-canvas-default)",
                color: "var(--color-fg-default)",
                border: "1px solid var(--color-border-default)",
                borderRadius: "6px",
                height: "28px",
                padding: "0 10px",
                fontSize: "12px",
                lineHeight: "16px",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                whiteSpace: "nowrap",
                textDecoration: "none",
              }}
              title="Download PDF document"
            >
              <DownloadIcon size={12} /> Download
            </a>
          </>
        )}
        {isEditable && !isMultiFile && (
          <button
            type="button"
            onClick={handleOpenEditor}
            style={{
              background: "var(--ms-brand, #0e7490)",
              color: "#ffffff",
              border: "1px solid var(--ms-brand, #0e7490)",
              borderRadius: "6px",
              height: "28px",
              padding: "0 11px",
              fontSize: "12px",
              lineHeight: "16px",
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              whiteSpace: "nowrap",
              boxShadow: "0 1px 2px rgba(0, 0, 0, 0.08)",
            }}
            title="Open model in interactive Playground"
          >
            <PlayIcon size={12} /> <span className="card-footer-playground-label-full">Open in </span>Playground
          </button>
        )}
        {isEditable && (
          <button
            type="button"
            className="card-footer-hide-mobile"
            onClick={handleOpenVsCode}
            style={{
              background: "var(--color-canvas-default)",
              color: "var(--color-fg-default)",
              border: "1px solid var(--color-border-default)",
              borderRadius: "6px",
              height: "28px",
              padding: "0 10px",
              fontSize: "12px",
              lineHeight: "16px",
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              whiteSpace: "nowrap",
            }}
            title="Open in VS Code (New Window)"
          >
            <VsCodeIcon size={12} color="#0284c7" /> VS Code ↗
          </button>
        )}
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
          variant="button"
          testId={`artifact-card-cite-btn-${artifactId}`}
        />
        {isLoaded && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenFullScreen();
            }}
            style={{
              background: "var(--color-canvas-default)",
              color: "var(--color-fg-default)",
              border: "1px solid var(--color-border-default)",
              borderRadius: "6px",
              width: "28px",
              height: "28px",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              flexShrink: 0,
            }}
            title="Full screen Studio"
            aria-label="Full screen Studio"
          >
            <ScreenFullIcon size={14} />
          </button>
        )}

        <div className="card-footer-mobile-menu" onClick={(e) => e.stopPropagation()}>
          <ActionMenu>
            <ActionMenu.Anchor>
              <IconButton
                icon={KebabHorizontalIcon}
                size="small"
                variant="invisible"
                aria-label="More artifact actions"
                title="More artifact actions"
                style={{ width: 28, height: 28 }}
              />
            </ActionMenu.Anchor>
            <ActionMenu.Overlay width="medium" align="end">
              <ActionList>
                {isLoaded && (
                  <ActionList.Item onSelect={() => onOpenFullScreen()}>
                    <ActionList.LeadingVisual>
                      <ScreenFullIcon />
                    </ActionList.LeadingVisual>
                    Full Screen Studio
                  </ActionList.Item>
                )}
                {isPdf && pdfUrl && (
                  <>
                    <ActionList.LinkItem href={pdfUrl} target="_blank" rel="noopener noreferrer">
                      <ActionList.LeadingVisual>
                        <LinkExternalIcon />
                      </ActionList.LeadingVisual>
                      Open PDF in Tab
                    </ActionList.LinkItem>
                    <ActionList.LinkItem href={pdfUrl} download>
                      <ActionList.LeadingVisual>
                        <DownloadIcon />
                      </ActionList.LeadingVisual>
                      Download PDF
                    </ActionList.LinkItem>
                  </>
                )}
                {isEditable && !isMultiFile && (
                  <ActionList.Item onSelect={(e) => handleOpenEditor(e)}>
                    <ActionList.LeadingVisual>
                      <PlayIcon />
                    </ActionList.LeadingVisual>
                    Open in Playground
                  </ActionList.Item>
                )}
                {hasCloudSolverFlag && onRunOnHpc && (
                  <ActionList.Item onSelect={() => onRunOnHpc()}>
                    <ActionList.LeadingVisual>
                      <ServerIcon />
                    </ActionList.LeadingVisual>
                    Run on Cloud HPC
                  </ActionList.Item>
                )}
                {viewConfig.provenance && viewConfig.jobId && (
                  <ActionList.Item onSelect={(e) => handleReproduce(e)}>
                    <ActionList.LeadingVisual>
                      <RepoForkedIcon />
                    </ActionList.LeadingVisual>
                    Fork &amp; Reproduce
                  </ActionList.Item>
                )}
                {isEditable && (
                  <ActionList.Item onSelect={(e) => handleOpenVsCode(e)}>
                    <ActionList.LeadingVisual>
                      <VsCodeIcon size={14} color="#0284c7" />
                    </ActionList.LeadingVisual>
                    Open in VS Code
                  </ActionList.Item>
                )}
              </ActionList>
            </ActionMenu.Overlay>
          </ActionMenu>
        </div>
      </Box>
    </CardFooterBar>
  );
};
