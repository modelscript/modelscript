/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { ScreenFullIcon } from "@primer/octicons-react";
import { Spinner, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { API_BASE_URL } from "../../config";
import Box from "../Box";
import AudioViewer from "./AudioViewer";
import CadStepViewer from "./CadStepViewer";
import CsvViewer from "./CsvViewer";
import LazyHeavyViewer from "./LazyHeavyViewer";
import LinkPreviewViewer from "./LinkPreviewViewer";
import MermaidViewer from "./MermaidViewer";
import ModelicaCodeViewer from "./ModelicaCodeViewer";
import ModelicaDiagramViewer from "./ModelicaDiagramViewer";
import PdfViewer from "./PdfViewer";
import PictureViewer from "./PictureViewer";
import SimulationPlotViewer from "./SimulationPlotViewer";
import SimulationResultViewer from "./SimulationResultViewer";
import UsdViewer from "./UsdViewer";
import VegaViewer from "./VegaViewer";
import VideoViewer from "./VideoViewer";
import YoutubeVideoViewer from "./YoutubeVideoViewer";

import type { SpatialPin } from "./spatial-pin";

interface ArtifactViewCardProps {
  artifactId: number;
  onPinCreated?: (pin: SpatialPin) => void;
}

const ArtifactViewCard: React.FC<ArtifactViewCardProps> = ({ artifactId, onPinCreated }) => {
  const [artifact, setArtifact] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isLoaded, setIsLoaded] = useState(true);
  const [isFullScreen, setIsFullScreen] = useState(false);

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

  const renderViewer = () => {
    switch (artifact.view_type) {
      case "cad-step":
      case "cad_step":
        return (
          <LazyHeavyViewer artifactId={artifactId} thumbnailUrl={viewConfig.thumbnailUrl} title="CAD STEP Viewer">
            <CadStepViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />
          </LazyHeavyViewer>
        );
      case "modelica-code":
        return <ModelicaCodeViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "modelica-diagram":
        return <ModelicaDiagramViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "simulation-plot":
        return <SimulationPlotViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "vega-plot":
        return <VegaViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "mermaid-diagram":
        return <MermaidViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "3d-model":
        return (
          <LazyHeavyViewer artifactId={artifactId} thumbnailUrl={viewConfig.thumbnailUrl} title="USD 3D Viewer">
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
      case "link-preview":
        return <LinkPreviewViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "simulation-result":
      case "fea-result":
      case "cfd-result":
        return (
          <LazyHeavyViewer
            artifactId={artifactId}
            thumbnailUrl={viewConfig.thumbnailUrl}
            title="Simulation Result Viewer"
          >
            <SimulationResultViewer viewConfig={viewConfig} isFullScreen={isFullScreen} onPinCreated={onPinCreated} />
          </LazyHeavyViewer>
        );
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
          {viewConfig.thumbnail_url ? (
            <img
              src={viewConfig.thumbnail_url}
              style={{ width: "100%", display: "block", objectFit: "cover" }}
              alt="thumbnail"
            />
          ) : (
            <Box p={3}>
              <Text>Viewing in full screen...</Text>
            </Box>
          )}
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
        <Text fontSize="12px" fontWeight="bold">
          {artifact.title || ""}
        </Text>
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
  );
};

export default ArtifactViewCard;
