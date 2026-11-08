// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckIcon,
  DownloadIcon,
  GitCompareIcon,
  InfoIcon,
  KebabHorizontalIcon,
  LinkIcon,
  RepoForkedIcon,
  ScreenFullIcon,
  ServerIcon,
  XIcon,
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
import { DraftingTriangleIcon } from "../../icons";
import { VsCodeIcon } from "../../icons/VsCodeIcon";

const StudioHeaderBar = styled(Box)`
  .studio-mobile-menu {
    display: none;
  }

  @media (max-width: 767px) {
    padding: 8px 12px !important;
    gap: 8px;

    .studio-hide-mobile {
      display: none !important;
    }

    .studio-mobile-menu {
      display: inline-flex;
    }
  }
`;

export interface StudioHeaderProps {
  artifact: any;
  artifactId: number;
  viewConfig: any;
  resolvedForkedFromId: number | string | null;
  paramDeltaCount: number | null;
  copiedLink: boolean;
  isStudioSidebarOpen: boolean;
  isFullScreen?: boolean | undefined;
  onEnterFullScreen?: (() => void) | undefined;
  onExitFullScreen: () => void;
  onCopyLink: () => void;
  onOpenDiff: () => void;
  onToggleSidebar: () => void;
  onRunOnHpc?: () => void;
  onSaveArtifact?: (() => void) | undefined;
  isSavingArtifact?: boolean | undefined;
  hasUnsavedChanges?: boolean | undefined;
}

export const StudioHeader: React.FC<StudioHeaderProps> = ({
  artifact,
  artifactId,
  viewConfig,
  resolvedForkedFromId,
  paramDeltaCount,
  copiedLink,
  isStudioSidebarOpen,
  isFullScreen = true,
  onEnterFullScreen,
  onExitFullScreen,
  onCopyLink,
  onOpenDiff,
  onToggleSidebar,
  onRunOnHpc,
  onSaveArtifact,
  isSavingArtifact,
  hasUnsavedChanges,
}) => {
  const navigate = useNavigate();
  const hasCloudSolverFlag = useFeatureFlag("cae_cloud_solver");

  const artifactDescriptor = {
    view_type: artifact?.view_type,
    view_config: viewConfig,
  };
  const isMultiFile = isMultiFileArtifact(artifactDescriptor);
  const isEditable = isEditableCodeOrModelArtifact(artifactDescriptor);

  const handleOpenVsCode = (e?: React.MouseEvent | React.KeyboardEvent) => {
    e?.stopPropagation?.();
    openArtifactInVsCodeWindow({
      artifactId,
      viewType: artifact?.view_type,
      viewConfig,
      title: artifact?.title || artifact?.name || viewConfig?.title,
    });
  };

  const handleOpenEditor = (e?: React.MouseEvent | React.KeyboardEvent) => {
    e?.stopPropagation?.();
    if (isMultiFile) {
      handleOpenVsCode(e);
      return;
    }
    const url = buildEditorUrlForArtifact({
      artifactId,
      viewType: artifact?.view_type,
      viewConfig,
      title: artifact?.title || artifact?.name || viewConfig?.title,
    });
    if (isFullScreen && typeof window !== "undefined") {
      window.open(url, "_blank");
    } else {
      navigate(url);
    }
  };

  const downloadAssetUrl = sanitizeHttpUrl(viewConfig.url || viewConfig.downloadUrl, { allowRelative: true });

  return (
    <StudioHeaderBar
      p={3}
      display="flex"
      justifyContent="space-between"
      alignItems="center"
      bg="var(--color-canvas-subtle, rgba(15, 23, 42, 0.95))"
      borderBottom="1px solid var(--color-border-default, rgba(255, 255, 255, 0.1))"
      style={{ backdropFilter: "blur(12px)", minWidth: 0 }}
    >
      <Box display="flex" alignItems="center" gap={2} style={{ minWidth: 0, flex: 1 }}>
        {isFullScreen && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onExitFullScreen();
            }}
            style={{
              background: "var(--color-canvas-default, rgba(255, 255, 255, 0.08))",
              border: "1px solid var(--color-border-default, rgba(255, 255, 255, 0.15))",
              color: "var(--color-fg-default, #e2e8f0)",
              cursor: "pointer",
              padding: "6px 10px",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "12px",
              fontWeight: 600,
              fontFamily: "var(--font-mono, monospace)",
              flexShrink: 0,
            }}
            title="Exit full screen (Esc)"
          >
            <XIcon size={14} /> <span className="studio-hide-mobile">Exit Full Screen</span>
          </button>
        )}
        <Text
          style={{
            color: "var(--color-fg-default, white)",
            fontWeight: "bold",
            fontSize: "15px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {artifact?.title || artifact?.name || artifact?.view_type}
        </Text>
        <span
          style={{
            fontSize: "10px",
            background: "rgba(6, 182, 212, 0.15)",
            color: "var(--ms-accent-cyan)",
            border: "1px solid rgba(6, 182, 212, 0.3)",
            padding: "2px 8px",
            borderRadius: "6px",
            fontWeight: 700,
            fontFamily: "var(--font-mono, monospace)",
            flexShrink: 0,
          }}
        >
          {artifact?.view_type?.toUpperCase()}
        </span>
        {(viewConfig.provenance || viewConfig.solverInfo || viewConfig.profile) && (
          <span
            className="studio-hide-mobile"
            style={{
              fontSize: "10px",
              background: "rgba(139, 92, 246, 0.15)",
              color: "#a78bfa",
              border: "1px solid rgba(139, 92, 246, 0.3)",
              padding: "2px 8px",
              borderRadius: "6px",
              fontWeight: 600,
              fontFamily: "var(--font-mono, monospace)",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            ⚡ {viewConfig.provenance?.solver?.toUpperCase() || viewConfig.solverInfo?.name} ·{" "}
            {viewConfig.provenance?.profile || viewConfig.profile || "HPC Standard"}
          </span>
        )}
        {resolvedForkedFromId && (
          <>
            <span
              className="studio-hide-mobile"
              style={{
                fontSize: "10px",
                background: "rgba(245, 158, 11, 0.15)",
                color: "#f59e0b",
                border: "1px solid rgba(245, 158, 11, 0.3)",
                padding: "2px 8px",
                borderRadius: "6px",
                fontWeight: 600,
                fontFamily: "var(--font-mono, monospace)",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
              title={`Forked from Artifact #${resolvedForkedFromId}${paramDeltaCount !== null ? ` (${paramDeltaCount} parameter${paramDeltaCount === 1 ? "" : "s"} changed)` : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/render-artifact/${resolvedForkedFromId}`);
              }}
            >
              ⚡ Fork of #{resolvedForkedFromId}
              {paramDeltaCount !== null && paramDeltaCount > 0 ? (
                <span
                  style={{
                    background: "rgba(245, 158, 11, 0.25)",
                    padding: "1px 5px",
                    borderRadius: "4px",
                    fontSize: "9px",
                    marginLeft: "2px",
                  }}
                >
                  {paramDeltaCount} param{paramDeltaCount === 1 ? "" : "s"} changed
                </span>
              ) : null}
            </span>
            <button
              type="button"
              className="studio-hide-mobile"
              style={{
                fontSize: "10px",
                background: "rgba(6, 182, 212, 0.15)",
                color: "var(--ms-accent-cyan)",
                border: "1px solid rgba(6, 182, 212, 0.3)",
                padding: "2px 8px",
                borderRadius: "6px",
                fontWeight: 600,
                fontFamily: "var(--font-mono, monospace)",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
              title="Compare model changes against upstream parent"
              onClick={(e) => {
                e.stopPropagation();
                onOpenDiff();
              }}
            >
              <GitCompareIcon size={12} /> View Changes
            </button>
          </>
        )}
      </Box>

      <Box display="flex" alignItems="center" gap={2} style={{ flexShrink: 0 }}>
        {isFullScreen && (
          <>
            <button
              className="studio-hide-mobile"
              onClick={(e) => {
                e.stopPropagation();
                onCopyLink();
              }}
              style={{
                background: copiedLink
                  ? "rgba(16, 185, 129, 0.2)"
                  : "var(--color-canvas-default, rgba(255, 255, 255, 0.08))",
                border: copiedLink
                  ? "1px solid rgba(16, 185, 129, 0.4)"
                  : "1px solid var(--color-border-default, rgba(255, 255, 255, 0.15))",
                color: copiedLink ? "#10b981" : "var(--color-fg-default, #e2e8f0)",
                borderRadius: "6px",
                padding: "5px 10px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
              title="Copy direct artifact permalink (C)"
            >
              {copiedLink ? <CheckIcon size={14} /> : <LinkIcon size={14} />}
              {copiedLink ? "Copied" : "Share"}
            </button>
            <CiteButton
              target={buildCitationFromArtifact({
                id: Number(artifactId || artifact?.id || 0),
                title: artifact?.title || artifact?.name || viewConfig?.title,
                viewType: artifact?.view_type,
                authorUsername: artifact?.username,
                authorDisplayName: artifact?.display_name,
                createdAt: artifact?.created_at,
                description: viewConfig?.description || viewConfig?.caption,
                localPdfUrl: String(artifact?.view_type || "").toLowerCase() === "pdf" ? downloadAssetUrl : null,
              })}
              label="Cite"
              variant="button"
              testId={`studio-header-cite-btn-${artifactId}`}
            />

            {downloadAssetUrl && (
              <a
                className="studio-hide-mobile"
                href={downloadAssetUrl}
                download
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: "var(--color-canvas-default, rgba(255, 255, 255, 0.08))",
                  border: "1px solid var(--color-border-default, rgba(255, 255, 255, 0.15))",
                  color: "var(--color-fg-default, #e2e8f0)",
                  borderRadius: "6px",
                  padding: "5px 10px",
                  fontSize: "12px",
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  textDecoration: "none",
                }}
                title="Download raw source artifact file"
              >
                <DownloadIcon size={14} /> Download Asset
              </a>
            )}
            {viewConfig.provenance && viewConfig.jobId && (
              <button
                className="studio-hide-mobile"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(
                    `/api/v1/cae/jobs/${encodeURIComponent(String(viewConfig.jobId))}/reproduce-spec`,
                    "_blank",
                    "noopener,noreferrer",
                  );
                }}
                style={{
                  background: "linear-gradient(135deg, rgba(139, 92, 246, 0.25), rgba(6, 182, 212, 0.25))",
                  color: "var(--color-fg-default, #ffffff)",
                  border: "1px solid var(--color-border-glass, rgba(255, 255, 255, 0.1))",
                  borderRadius: "6px",
                  padding: "5px 10px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
                title="Inspect execution recipe and reproduction parameters"
              >
                ⚡ Fork &amp; Reproduce
              </button>
            )}
            {hasCloudSolverFlag && onRunOnHpc && (
              <button
                type="button"
                className="studio-hide-mobile"
                onClick={(e) => {
                  e.stopPropagation();
                  onRunOnHpc();
                }}
                style={{
                  background: "linear-gradient(135deg, rgba(16, 185, 129, 0.22), rgba(6, 182, 212, 0.22))",
                  color: "#10b981",
                  border: "1px solid rgba(16, 185, 129, 0.45)",
                  borderRadius: "6px",
                  padding: "5px 10px",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
                title="Dispatch simulation job against this model artifact on Cloud HPC"
              >
                ☁️ Run on HPC
              </button>
            )}
            {onSaveArtifact && hasUnsavedChanges && (
              <button
                type="button"
                className="studio-hide-mobile"
                onClick={(e) => {
                  e.stopPropagation();
                  onSaveArtifact();
                }}
                disabled={isSavingArtifact}
                style={{
                  background: "var(--ms-brand, #0e7490)",
                  color: "#ffffff",
                  border: "1px solid var(--ms-brand, #0e7490)",
                  borderRadius: "6px",
                  padding: "5px 12px",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: isSavingArtifact ? "not-allowed" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.2)",
                }}
                title="Save changes to this artifact"
              >
                💾 {isSavingArtifact ? "Saving…" : "Save Artifact"}
              </button>
            )}
            {isEditable && !isMultiFile && (
              <button
                className="studio-hide-mobile"
                onClick={handleOpenEditor}
                style={{
                  background: "linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(139, 92, 246, 0.2))",
                  color: "var(--ms-accent-cyan, #0891b2)",
                  border: "1px solid rgba(6, 182, 212, 0.4)",
                  borderRadius: "6px",
                  padding: "5px 10px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
                title="Open model in interactive Morsel"
              >
                <DraftingTriangleIcon size={14} /> Open in Morsel
              </button>
            )}
            {isEditable && (
              <button
                className="studio-hide-mobile"
                onClick={handleOpenVsCode}
                style={{
                  background: "linear-gradient(135deg, rgba(14, 165, 233, 0.2), rgba(59, 130, 246, 0.18))",
                  color: "var(--ms-accent-cyan, #0284c7)",
                  border: "1px solid rgba(56, 189, 248, 0.4)",
                  borderRadius: "6px",
                  padding: "5px 10px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
                title="Open in VS Code (New Window)"
              >
                <VsCodeIcon size={14} color="#38bdf8" /> VS Code ↗
              </button>
            )}
          </>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleSidebar();
          }}
          style={{
            background: isStudioSidebarOpen
              ? "rgba(6, 182, 212, 0.2)"
              : "var(--color-canvas-default, rgba(255, 255, 255, 0.08))",
            border: isStudioSidebarOpen
              ? "1px solid rgba(6, 182, 212, 0.4)"
              : "1px solid var(--color-border-default, rgba(255, 255, 255, 0.15))",
            color: isStudioSidebarOpen ? "var(--ms-accent-cyan)" : "var(--color-fg-default, #e2e8f0)",
            borderRadius: "6px",
            padding: "5px 10px",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
          }}
          title="Toggle Telemetry Sidebar"
        >
          <InfoIcon size={14} /> <span className="studio-hide-mobile">Inspector</span>
        </button>

        {isFullScreen && (
          <div className="studio-mobile-menu" onClick={(e) => e.stopPropagation()}>
            <ActionMenu>
              <ActionMenu.Anchor>
                <IconButton
                  icon={KebabHorizontalIcon}
                  size="small"
                  variant="invisible"
                  aria-label="More studio actions"
                  title="More studio actions"
                />
              </ActionMenu.Anchor>
              <ActionMenu.Overlay width="medium" align="end">
                <ActionList>
                  <ActionList.Item
                    onSelect={() => {
                      if (navigator.share) {
                        navigator
                          .share({
                            title: artifact?.title || artifact?.name || "Ansatz Morsel",
                            url: `${window.location.origin}/render-artifact/${artifactId}`,
                          })
                          .catch(() => onCopyLink());
                      } else {
                        onCopyLink();
                      }
                    }}
                  >
                    <ActionList.LeadingVisual>
                      <LinkIcon />
                    </ActionList.LeadingVisual>
                    {copiedLink ? "Copied Link" : "Share / Copy Link"}
                  </ActionList.Item>
                  {onSaveArtifact && hasUnsavedChanges && (
                    <ActionList.Item onSelect={() => onSaveArtifact()} disabled={Boolean(isSavingArtifact)}>
                      💾 {isSavingArtifact ? "Saving…" : "Save Artifact"}
                    </ActionList.Item>
                  )}
                  {isEditable && !isMultiFile && (
                    <ActionList.Item onSelect={(e) => handleOpenEditor(e)}>
                      <ActionList.LeadingVisual>
                        <DraftingTriangleIcon />
                      </ActionList.LeadingVisual>
                      Open in Morsel
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
                    <ActionList.Item
                      onSelect={() => {
                        window.open(
                          `/api/v1/cae/jobs/${encodeURIComponent(String(viewConfig.jobId))}/reproduce-spec`,
                          "_blank",
                          "noopener,noreferrer",
                        );
                      }}
                    >
                      <ActionList.LeadingVisual>
                        <RepoForkedIcon />
                      </ActionList.LeadingVisual>
                      Fork &amp; Reproduce
                    </ActionList.Item>
                  )}
                  {resolvedForkedFromId && (
                    <ActionList.Item onSelect={() => onOpenDiff()}>
                      <ActionList.LeadingVisual>
                        <GitCompareIcon />
                      </ActionList.LeadingVisual>
                      View Changes vs. #{resolvedForkedFromId}
                    </ActionList.Item>
                  )}
                  {downloadAssetUrl && (
                    <ActionList.LinkItem href={downloadAssetUrl} download target="_blank" rel="noopener noreferrer">
                      <ActionList.LeadingVisual>
                        <DownloadIcon />
                      </ActionList.LeadingVisual>
                      Download Asset
                    </ActionList.LinkItem>
                  )}
                  {isEditable && (
                    <ActionList.Item onSelect={(e) => handleOpenVsCode(e)}>
                      <ActionList.LeadingVisual>
                        <VsCodeIcon size={14} color="#38bdf8" />
                      </ActionList.LeadingVisual>
                      Open in VS Code
                    </ActionList.Item>
                  )}
                </ActionList>
              </ActionMenu.Overlay>
            </ActionMenu>
          </div>
        )}

        {!isFullScreen && onEnterFullScreen && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEnterFullScreen();
            }}
            style={{
              background: "var(--color-canvas-default, rgba(255, 255, 255, 0.08))",
              border: "1px solid var(--color-border-default, rgba(255, 255, 255, 0.15))",
              color: "var(--color-fg-default, #e2e8f0)",
              borderRadius: "6px",
              padding: "5px 10px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
            title="Full screen"
          >
            <ScreenFullIcon size={14} /> Full Screen
          </button>
        )}
      </Box>
    </StudioHeaderBar>
  );
};
