// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { CodeIcon, ScreenFullIcon } from "@primer/octicons-react";
import { Spinner, Text, useTheme } from "@primer/react";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE_URL } from "../../config";
import Box from "../Box";
import AasPackageViewer from "./AasPackageViewer";
import ArtifactPlaceholder from "./ArtifactPlaceholder";
import AudioViewer from "./AudioViewer";
import CadStepViewer from "./CadStepViewer";
import CfdAnimationViewer from "./CfdAnimationViewer";
import CsvViewer from "./CsvViewer";
import DigitalThreadExplorerViewer from "./DigitalThreadExplorerViewer";
import DigitalTwinDashboardViewer from "./DigitalTwinDashboardViewer";
import GCodeViewer from "./GCodeViewer";
import LazyHeavyViewer from "./LazyHeavyViewer";
import LinkPreviewViewer from "./LinkPreviewViewer";
import MermaidViewer from "./MermaidViewer";
import ModelicaCodeViewer from "./ModelicaCodeViewer";
import ModelicaDiagramViewer from "./ModelicaDiagramViewer";
import PdfViewer from "./PdfViewer";
import PictureViewer from "./PictureViewer";
import SimulationPlotViewer from "./SimulationPlotViewer";
import SimulationResultViewer from "./SimulationResultViewer";
import TeiViewer from "./TeiViewer";
import UsdViewer from "./UsdViewer";
import VegaViewer from "./VegaViewer";
import VideoViewer from "./VideoViewer";
import YoutubeVideoViewer from "./YoutubeVideoViewer";

import type { SpatialPin } from "./spatial-pin";

interface ArtifactViewCardProps {
  artifactId: number;
  onPinCreated?: (pin: SpatialPin) => void;
  onThreadNodeSelected?: (threadId: string | number) => void;
}

const ArtifactViewCard: React.FC<ArtifactViewCardProps> = ({ artifactId, onPinCreated, onThreadNodeSelected }) => {
  const [artifact, setArtifact] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isLoaded, setIsLoaded] = useState(true);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const { resolvedColorMode } = useTheme();
  const navigate = useNavigate();

  useEffect(() => {
    async function fetchArtifact() {
      try {
        const res = await fetch(`${API_BASE_URL}/social/artifact-views/${artifactId}`);
        if (res.ok) {
          const data = await res.json();
          setArtifact(data.artifactView);
        }
      } catch (err) {
        console.error("Failed to fetch artifact", err);
      } finally {
        setLoading(false);
      }
    }
    fetchArtifact();
  }, [artifactId]);

  if (loading) {
    return (
      <Box p={3} display="flex" justifyContent="center" borderRadius="12px" border="1px solid var(--color-border)">
        <Spinner size="small" />
      </Box>
    );
  }

  if (!artifact) {
    return (
      <Box p={3} borderRadius="12px" border="1px dashed var(--color-border)" color="var(--color-fg-muted)">
        Artifact not available
      </Box>
    );
  }

  const viewConfig = JSON.parse(artifact.view_config || "{}");

  let resolvedThumbnailUrl = viewConfig.thumbnailUrl || viewConfig.thumbnail_url;
  if (resolvedThumbnailUrl && resolvedThumbnailUrl.startsWith("/thumbnails/")) {
    resolvedThumbnailUrl = `/api${resolvedThumbnailUrl}`;
  }

  let resolvedThumbnailUrlLight = viewConfig.thumbnailUrlLight;
  if (resolvedThumbnailUrlLight && resolvedThumbnailUrlLight.startsWith("/thumbnails/")) {
    resolvedThumbnailUrlLight = `/api${resolvedThumbnailUrlLight}`;
  }

  let resolvedThumbnailUrlDark = viewConfig.thumbnailUrlDark;
  if (resolvedThumbnailUrlDark && resolvedThumbnailUrlDark.startsWith("/thumbnails/")) {
    resolvedThumbnailUrlDark = `/api${resolvedThumbnailUrlDark}`;
  }

  const renderViewer = () => {
    switch (artifact.view_type) {
      case "cad-step":
      case "cad_step":
        return (
          <LazyHeavyViewer
            artifactId={artifactId}
            thumbnailUrl={resolvedThumbnailUrl}
            thumbnailUrlLight={resolvedThumbnailUrlLight}
            thumbnailUrlDark={resolvedThumbnailUrlDark}
            title="CAD 3D Viewer"
            placeholderType="cad"
          >
            <CadStepViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />
          </LazyHeavyViewer>
        );
      case "modelica-code":
        return <ModelicaCodeViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "modelica-diagram":
      case "morsel":
      case "polyglot-morsel":
        return <ModelicaDiagramViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "simulation-plot":
        return <SimulationPlotViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "vega-plot":
        return <VegaViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "mermaid-diagram":
        return <MermaidViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "3d-model":
        return (
          <LazyHeavyViewer
            artifactId={artifactId}
            thumbnailUrl={resolvedThumbnailUrl}
            thumbnailUrlLight={resolvedThumbnailUrlLight}
            thumbnailUrlDark={resolvedThumbnailUrlDark}
            title="USD 3D Viewer"
            placeholderType="cad"
          >
            <UsdViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />
          </LazyHeavyViewer>
        );
      case "video":
        return <VideoViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "youtube_video":
        return <YoutubeVideoViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "picture":
        return <PictureViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "audio":
        return <AudioViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "pdf":
        return <PdfViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "csv":
        return <CsvViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "tei-document":
        return <TeiViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "link-preview":
        return <LinkPreviewViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "simulation-result":
      case "fea-result":
      case "cfd-result":
        return (
          <LazyHeavyViewer
            artifactId={artifactId}
            thumbnailUrl={resolvedThumbnailUrl}
            thumbnailUrlLight={resolvedThumbnailUrlLight}
            thumbnailUrlDark={resolvedThumbnailUrlDark}
            title="Simulation Result Viewer"
            placeholderType={artifact.view_type === "cfd-result" ? "cfd" : "fea"}
          >
            <SimulationResultViewer
              viewConfig={viewConfig}
              isFullScreen={isFullScreen}
              onPinCreated={onPinCreated}
              onThreadNodeSelected={onThreadNodeSelected}
            />
          </LazyHeavyViewer>
        );
      case "cfd-animation":
        return (
          <LazyHeavyViewer
            artifactId={artifactId}
            thumbnailUrl={resolvedThumbnailUrl}
            thumbnailUrlLight={resolvedThumbnailUrlLight}
            thumbnailUrlDark={resolvedThumbnailUrlDark}
            title="CFD Animation"
            placeholderType="cfd"
          >
            <CfdAnimationViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />
          </LazyHeavyViewer>
        );
      case "gcode":
      case "cam-result":
        return (
          <LazyHeavyViewer
            artifactId={artifactId}
            thumbnailUrl={resolvedThumbnailUrl}
            thumbnailUrlLight={resolvedThumbnailUrlLight}
            thumbnailUrlDark={resolvedThumbnailUrlDark}
            title="GCode Viewer"
            placeholderType="cad"
          >
            <GCodeViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />
          </LazyHeavyViewer>
        );
      case "aas-package":
      case "cyber-physical-system":
      case "hardware-project":
        return <AasPackageViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "digital-thread":
      case "digital_thread":
      case "thread-explorer":
        return (
          <DigitalThreadExplorerViewer
            viewConfig={viewConfig}
            isFullScreen={isFullScreen}
            onNodeSelected={(node) => onThreadNodeSelected?.(node.nodeId)}
          />
        );
      case "digital-twin-dashboard":
      case "digital_twin_dashboard":
      case "digital-twin":
        return <DigitalTwinDashboardViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      default:
        return (
          <Box p={3} backgroundColor="var(--color-canvas-subtle)" borderRadius="6px">
            <Text>Unsupported artifact type: {artifact.view_type}</Text>
          </Box>
        );
    }
  };

  const viewerContent = renderViewer();

  if (isFullScreen) {
    return (
      <>
        <Box
          mt={2}
          borderRadius="12px"
          border="1px solid var(--color-border)"
          overflow="hidden"
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          {(() => {
            const currentThumbnailUrl =
              resolvedColorMode === "dark"
                ? resolvedThumbnailUrlDark || resolvedThumbnailUrl
                : resolvedThumbnailUrlLight || resolvedThumbnailUrl;

            if (currentThumbnailUrl) {
              return (
                <img
                  src={currentThumbnailUrl}
                  style={{ width: "100%", display: "block", objectFit: "cover" }}
                  alt="thumbnail"
                />
              );
            }

            const placeholderType = ["cfd-result", "fea-result", "cfd-animation"].includes(artifact.view_type)
              ? ["cfd-result", "cfd-animation"].includes(artifact.view_type)
                ? "cfd"
                : "fea"
              : ["cad-step", "3d-model"].includes(artifact.view_type)
                ? "cad"
                : artifact.view_type === "pdf" || artifact.view_type === "tei-document"
                  ? "pdf"
                  : "generic";
            return (
              <ArtifactPlaceholder
                type={placeholderType}
                title={artifact.name || artifact.view_type}
                aspectRatio="16 / 9"
              />
            );
          })()}
        </Box>

        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.9)",
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <Box p={3} display="flex" justifyContent="space-between" alignItems="center" borderBottom="1px solid #333">
            <Text color="white" fontWeight="bold">
              {artifact.title || artifact.view_type}
            </Text>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsFullScreen(false);
              }}
              style={{ background: "none", border: "none", color: "white", cursor: "pointer", padding: "8px" }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </button>
          </Box>
          <Box
            flex={1}
            overflow="hidden"
            position="relative"
            display="flex"
            alignItems="center"
            justifyContent="center"
          >
            <Box width="100%" height="100%" bg="black" overflow="auto">
              {viewerContent}
            </Box>
          </Box>
        </div>
      </>
    );
  }

  return (
    <Box
      mt={2}
      borderRadius="12px"
      border="1px solid var(--color-border)"
      overflow="hidden"
      position="relative"
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      {viewerContent}
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
                window.open(`/api/v1/cae/jobs/${viewConfig.jobId}/reproduce-spec`, "_blank");
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
                setIsFullScreen(true);
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
    </Box>
  );
};

export default ArtifactViewCard;
