// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckIcon,
  DownloadIcon,
  GitCompareIcon,
  InfoIcon,
  LinkIcon,
  PlayIcon,
  ScreenFullIcon,
  XIcon,
} from "@primer/octicons-react";
import { Text } from "@primer/react";
import React from "react";
import { useNavigate } from "react-router-dom";
import {
  buildEditorUrlForArtifact,
  isMultiFileArtifact,
  openArtifactInVsCodeWindow,
} from "../../../util/editor-routing";
import { sanitizeHttpUrl } from "../../../util/url";
import Box from "../../Box";
import { VsCodeIcon } from "../../icons/VsCodeIcon";

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
}) => {
  const navigate = useNavigate();

  const isMultiFile = isMultiFileArtifact({
    view_type: artifact?.view_type,
    view_config: viewConfig,
  });

  const handleOpenVsCode = (e: React.MouseEvent) => {
    e.stopPropagation();
    openArtifactInVsCodeWindow({
      artifactId,
      viewType: artifact?.view_type,
      viewConfig,
      title: artifact?.title || artifact?.name || viewConfig?.title,
    });
  };

  const handleOpenEditor = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isMultiFile) {
      handleOpenVsCode(e);
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

  return (
    <Box
      p={3}
      display="flex"
      justifyContent="space-between"
      alignItems="center"
      bg="rgba(15, 23, 42, 0.95)"
      borderBottom="1px solid var(--color-border-glass, rgba(255, 255, 255, 0.1))"
      style={{ backdropFilter: "blur(12px)" }}
    >
      <Box display="flex" alignItems="center" gap={3}>
        {isFullScreen && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onExitFullScreen();
            }}
            style={{
              background: "rgba(255, 255, 255, 0.08)",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              color: "#e2e8f0",
              cursor: "pointer",
              padding: "6px 12px",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "12px",
              fontWeight: 600,
              fontFamily: "var(--font-mono, monospace)",
            }}
            title="Exit studio mode (Esc)"
          >
            <XIcon size={14} /> Exit Studio
          </button>
        )}
        <Text style={{ color: "white", fontWeight: "bold", fontSize: "15px" }}>
          {artifact.title || artifact.name || artifact.view_type}
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
          }}
        >
          {artifact.view_type?.toUpperCase()}
        </span>
        {(viewConfig.provenance || viewConfig.solverInfo || viewConfig.profile) && (
          <span
            style={{
              fontSize: "10px",
              background: "rgba(139, 92, 246, 0.15)",
              color: "#a78bfa",
              border: "1px solid rgba(139, 92, 246, 0.3)",
              padding: "2px 8px",
              borderRadius: "6px",
              fontWeight: 600,
              fontFamily: "var(--font-mono, monospace)",
            }}
          >
            ⚡ {viewConfig.provenance?.solver?.toUpperCase() || viewConfig.solverInfo?.name} ·{" "}
            {viewConfig.provenance?.profile || viewConfig.profile || "HPC Standard"}
          </span>
        )}
        {resolvedForkedFromId && (
          <>
            <span
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

      <Box display="flex" alignItems="center" gap={2}>
        {isFullScreen && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCopyLink();
              }}
              style={{
                background: copiedLink ? "rgba(16, 185, 129, 0.2)" : "rgba(255, 255, 255, 0.08)",
                border: copiedLink ? "1px solid rgba(16, 185, 129, 0.4)" : "1px solid rgba(255, 255, 255, 0.15)",
                color: copiedLink ? "#34d399" : "#e2e8f0",
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

            {sanitizeHttpUrl(viewConfig.url || viewConfig.downloadUrl, { allowRelative: true }) && (
              <a
                href={sanitizeHttpUrl(viewConfig.url || viewConfig.downloadUrl, { allowRelative: true })}
                download
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: "rgba(255, 255, 255, 0.08)",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  color: "#e2e8f0",
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
                  color: "#ffffff",
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
            {!isMultiFile && (
              <button
                onClick={handleOpenEditor}
                style={{
                  background: "linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(139, 92, 246, 0.2))",
                  color: "#38bdf8",
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
                title="Open model in interactive Playground"
              >
                <PlayIcon size={14} /> Open in Playground
              </button>
            )}
            <button
              onClick={handleOpenVsCode}
              style={{
                background: "linear-gradient(135deg, rgba(14, 165, 233, 0.2), rgba(59, 130, 246, 0.18))",
                color: "#38bdf8",
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
          </>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleSidebar();
          }}
          style={{
            background: isStudioSidebarOpen ? "rgba(6, 182, 212, 0.2)" : "rgba(255, 255, 255, 0.08)",
            border: isStudioSidebarOpen ? "1px solid rgba(6, 182, 212, 0.4)" : "1px solid rgba(255, 255, 255, 0.15)",
            color: isStudioSidebarOpen ? "var(--ms-accent-cyan)" : "#e2e8f0",
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
          <InfoIcon size={14} /> Inspector
        </button>
        {!isFullScreen && onEnterFullScreen && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEnterFullScreen();
            }}
            style={{
              background: "rgba(255, 255, 255, 0.08)",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              color: "#e2e8f0",
              borderRadius: "6px",
              padding: "5px 10px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
            title="Full screen Studio"
          >
            <ScreenFullIcon size={14} /> Studio
          </button>
        )}
      </Box>
    </Box>
  );
};
