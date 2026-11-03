// SPDX-License-Identifier: AGPL-3.0-or-later

import { PlayIcon, ScreenFullIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React from "react";
import { useNavigate } from "react-router-dom";
import { useFeatureFlag } from "../../../FeatureFlagContext";
import {
  buildEditorUrlForArtifact,
  isMultiFileArtifact,
  openArtifactInVsCodeWindow,
} from "../../../util/editor-routing";
import Box from "../../Box";
import { VsCodeIcon } from "../../icons/VsCodeIcon";

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

  const isMultiFile = isMultiFileArtifact({
    view_type: artifact?.view_type,
    view_config: viewConfig,
  });

  const handleOpenEditor = (e: React.MouseEvent) => {
    e.stopPropagation();
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

  const handleOpenVsCode = (e: React.MouseEvent) => {
    e.stopPropagation();
    openArtifactInVsCodeWindow({
      artifactId,
      viewType: artifact?.view_type,
      viewConfig,
      title: artifact?.title || artifact?.name || viewConfig?.title,
    });
  };

  const rawViewType = String(artifact?.view_type || "").toLowerCase();
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
    <Box
      px={3}
      py={1}
      borderTop="1px solid var(--color-accent-blue-border, var(--color-border-default))"
      backgroundColor="var(--ms-brand-soft, var(--color-canvas-subtle))"
      display="flex"
      justifyContent="space-between"
      alignItems="center"
      style={{ gap: "10px", minHeight: "40px" }}
    >
      <Box display="flex" alignItems="center" gap={2} style={{ minWidth: 0, flex: 1 }}>
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
            onClick={(e) => {
              e.stopPropagation();
              window.open(
                `/api/v1/cae/jobs/${encodeURIComponent(String(viewConfig.jobId))}/reproduce-spec`,
                "_blank",
                "noopener,noreferrer",
              );
            }}
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
        {!isMultiFile && (
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
            <PlayIcon size={12} /> Open in Playground
          </button>
        )}
        <button
          type="button"
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
      </Box>
    </Box>
  );
};
