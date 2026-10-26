// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import { CodeIcon, ScreenFullIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React from "react";
import { useNavigate } from "react-router-dom";
import Box from "../../Box";

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

  return (
    <Box
      p={2}
      borderTop="1px solid var(--color-border)"
      backgroundColor="var(--color-canvas-subtle)"
      display="flex"
      justifyContent="space-between"
      alignItems="center"
    >
      <Box display="flex" alignItems="center" gap={2}>
        <Text fontSize="12px" fontWeight="bold">
          {artifact.title || ""}
        </Text>
        {viewConfig.provenance && (
          <span
            style={{
              fontSize: "11px",
              background: "rgba(6, 182, 212, 0.15)",
              color: "var(--color-accent-cyan)",
              border: "1px solid rgba(6, 182, 212, 0.3)",
              padding: "2px 6px",
              borderRadius: "6px",
              fontWeight: 600,
              fontFamily: "var(--font-mono)",
            }}
          >
            ⚡ {viewConfig.provenance.solver?.toUpperCase()} • {viewConfig.provenance.profile}
          </span>
        )}
      </Box>
      <Box display="flex" alignItems="center" gap={2}>
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
              background: "linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(6, 182, 212, 0.2))",
              color: "var(--color-text-primary)",
              border: "1px solid var(--color-border-glass)",
              borderRadius: "6px",
              padding: "3px 8px",
              fontSize: "11px",
              fontWeight: "600",
              fontFamily: "var(--font-mono)",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              boxShadow: "0 0 8px rgba(139, 92, 246, 0.25)",
            }}
            title="Inspect execution recipe and reproduction parameters"
          >
            ⚡ Fork &amp; Reproduce
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/ide#memfs:artifact-${artifactId}`);
          }}
          style={{
            background: "linear-gradient(135deg, rgba(6, 182, 212, 0.15), rgba(139, 92, 246, 0.15))",
            color: "var(--color-accent-cyan)",
            border: "1px solid rgba(6, 182, 212, 0.3)",
            borderRadius: "6px",
            padding: "3px 8px",
            fontSize: "11px",
            fontWeight: "600",
            fontFamily: "var(--font-mono)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
          }}
          title="Open and run in ModelScript IDE workbench"
        >
          <CodeIcon size={12} /> Run in IDE
        </button>
        {isLoaded && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenFullScreen();
            }}
            style={{
              background: "transparent",
              color: "var(--color-fg-default)",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
            }}
            title="Full screen"
          >
            <ScreenFullIcon size={16} />
          </button>
        )}
      </Box>
    </Box>
  );
};
