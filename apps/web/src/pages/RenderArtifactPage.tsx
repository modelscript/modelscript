import { BaseStyles, ThemeProvider } from "@primer/react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import AudioViewer from "../components/artifacts/AudioViewer";
import CadStepViewer from "../components/artifacts/CadStepViewer";
import CsvViewer from "../components/artifacts/CsvViewer";
import LinkPreviewViewer from "../components/artifacts/LinkPreviewViewer";
import MermaidViewer from "../components/artifacts/MermaidViewer";
import ModelicaCodeViewer from "../components/artifacts/ModelicaCodeViewer";
import ModelicaDiagramViewer from "../components/artifacts/ModelicaDiagramViewer";
import PdfViewer from "../components/artifacts/PdfViewer";
import PictureViewer from "../components/artifacts/PictureViewer";
import SimulationPlotViewer from "../components/artifacts/SimulationPlotViewer";
import SimulationResultViewer from "../components/artifacts/SimulationResultViewer";
import UsdViewer from "../components/artifacts/UsdViewer";
import VegaViewer from "../components/artifacts/VegaViewer";
import VideoViewer from "../components/artifacts/VideoViewer";
import YoutubeVideoViewer from "../components/artifacts/YoutubeVideoViewer";
import Box from "../components/Box";
import { API_BASE_URL } from "../config";

export default function RenderArtifactPage() {
  const { id } = useParams<{ id: string }>();
  const [artifact, setArtifact] = useState<unknown>(null);

  useEffect(() => {
    async function fetchArtifact() {
      try {
        const res = await fetch(`${API_BASE_URL}/social/artifact-views/${id}`);
        if (res.ok) {
          const data = await res.json();
          setArtifact(data.artifactView);
        } else {
          // If artifact failed to load, signal ready to unblock Puppeteer
          (window as unknown as { __ARTIFACT_READY: boolean }).__ARTIFACT_READY = true;
        }
      } catch (err) {
        console.error("Failed to fetch artifact", err);
        (window as unknown as { __ARTIFACT_READY: boolean }).__ARTIFACT_READY = true;
      }
    }
    fetchArtifact();
  }, [id]);

  useEffect(() => {
    // When the artifact is successfully loaded and it is NOT a simulation or cad step,
    // we still need to unblock puppeteer.
    if (artifact) {
      if (!["simulation-result", "fea-result", "cfd-result", "cad-step", "cad_step"].includes(artifact.view_type)) {
        (window as unknown as { __ARTIFACT_READY: boolean }).__ARTIFACT_READY = true;
      }
    }
  }, [artifact]);

  if (!artifact) return null;

  const viewConfig = JSON.parse(artifact.view_config || "{}");

  const renderViewer = () => {
    switch (artifact.view_type) {
      case "cad-step":
      case "cad_step":
        return <CadStepViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "modelica-code":
        return <ModelicaCodeViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "modelica-diagram":
        return <ModelicaDiagramViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "simulation-plot":
        return <SimulationPlotViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "vega-plot":
        return <VegaViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "mermaid-diagram":
        return <MermaidViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "3d-model":
        return <UsdViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "video":
        return <VideoViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "youtube_video":
        return <YoutubeVideoViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "picture":
        return <PictureViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "audio":
        return <AudioViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "pdf":
        return <PdfViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "csv":
        return <CsvViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "link-preview":
        return <LinkPreviewViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "simulation-result":
      case "fea-result":
      case "cfd-result":
        return <SimulationResultViewer viewConfig={viewConfig} isFullScreen={true} />;
      default:
        return (
          <Box
            p={3}
            backgroundColor="var(--color-canvas-subtle)"
            borderRadius="6px"
            width="100%"
            height="100%"
            display="flex"
            alignItems="center"
            justifyContent="center"
          >
            Unsupported artifact type: {artifact.view_type}
          </Box>
        );
    }
  };

  return (
    <ThemeProvider colorMode="auto">
      <BaseStyles style={{ width: "100vw", height: "100vh", overflow: "hidden", margin: 0, padding: 0 }}>
        <Box width="100%" height="100%" bg="var(--color-canvas-default)">
          {renderViewer()}
        </Box>
      </BaseStyles>
    </ThemeProvider>
  );
}
