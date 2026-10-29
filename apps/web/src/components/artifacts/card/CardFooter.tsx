// SPDX-License-Identifier: AGPL-3.0-or-later

import { PlayIcon, ScreenFullIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React from "react";
import { useNavigate } from "react-router-dom";
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
}

export const CardFooter: React.FC<CardFooterProps> = ({
  artifact,
  artifactId,
  viewConfig,
  isLoaded,
  onOpenFullScreen,
}) => {
  const navigate = useNavigate();

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

  return (
    <Box
      px={3}
      py={2}
      borderTop="1px solid var(--color-border)"
      backgroundColor="var(--color-canvas-subtle)"
      display="flex"
      justifyContent="space-between"
      alignItems="center"
      style={{ gap: "12px", minHeight: "42px" }}
    >
      <Box display="flex" alignItems="center" gap={2} style={{ minWidth: 0, flex: 1 }}>
        <Text
          style={{
            fontSize: "13px",
            lineHeight: "18px",
            fontWeight: 600,
            color: "var(--color-fg-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={artifact.title || viewConfig.title || ""}
        >
          {artifact.title || viewConfig.title || ""}
        </Text>
        {viewConfig.provenance && (
          <span
            style={{
              fontSize: "11px",
              lineHeight: "14px",
              background: "rgba(6, 182, 212, 0.15)",
              color: "var(--color-accent-cyan)",
              border: "1px solid rgba(6, 182, 212, 0.3)",
              padding: "2px 6px",
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
              background: "linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(6, 182, 212, 0.2))",
              color: "var(--color-text-primary)",
              border: "1px solid var(--color-border-glass)",
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
        {!isMultiFile && (
          <button
            type="button"
            onClick={handleOpenEditor}
            style={{
              background: "linear-gradient(135deg, rgba(6, 182, 212, 0.16), rgba(139, 92, 246, 0.16))",
              color: "var(--color-accent-cyan)",
              border: "1px solid rgba(6, 182, 212, 0.35)",
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
            title="Open model in interactive Playground"
          >
            <PlayIcon size={12} /> Open in Playground
          </button>
        )}
        <button
          type="button"
          onClick={handleOpenVsCode}
          style={{
            background: "rgba(56, 189, 248, 0.1)",
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
          <VsCodeIcon size={12} color="#38bdf8" /> VS Code ↗
        </button>
        {isLoaded && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenFullScreen();
            }}
            style={{
              background: "rgba(255, 255, 255, 0.04)",
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
