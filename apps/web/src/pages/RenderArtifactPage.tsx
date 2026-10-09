// SPDX-License-Identifier: AGPL-3.0-or-later

import { BaseStyles, ThemeProvider } from "@primer/react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getArtifactView } from "../api";
import AasPackageViewer from "../components/artifacts/AasPackageViewer";
import AudioViewer from "../components/artifacts/AudioViewer";
import CadStepViewer from "../components/artifacts/CadStepViewer";
import CfdAnimationViewer from "../components/artifacts/CfdAnimationViewer";
import CsvViewer from "../components/artifacts/CsvViewer";
import DigitalThreadExplorerViewer from "../components/artifacts/DigitalThreadExplorerViewer";
import DigitalTwinDashboardViewer from "../components/artifacts/DigitalTwinDashboardViewer";
import FmuViewer from "../components/artifacts/FmuViewer";
import GCodeViewer from "../components/artifacts/GCodeViewer";
import LinkPreviewViewer from "../components/artifacts/LinkPreviewViewer";
import MermaidViewer from "../components/artifacts/MermaidViewer";
import ModelicaCodeViewer from "../components/artifacts/ModelicaCodeViewer";
import ModelicaDiagramViewer from "../components/artifacts/ModelicaDiagramViewer";
import PackageViewCard from "../components/artifacts/PackageViewCard";
import PdfViewer from "../components/artifacts/PdfViewer";
import PictureViewer from "../components/artifacts/PictureViewer";
import RepositoryViewCard from "../components/artifacts/RepositoryViewCard";
import SimulationPlotViewer from "../components/artifacts/SimulationPlotViewer";
import SimulationResultViewer from "../components/artifacts/SimulationResultViewer";
import SysmlViewer from "../components/artifacts/SysmlViewer";
import TeiViewer from "../components/artifacts/TeiViewer";
import UsdViewer from "../components/artifacts/UsdViewer";
import VegaViewer from "../components/artifacts/VegaViewer";
import VideoViewer from "../components/artifacts/VideoViewer";
import YoutubeVideoViewer from "../components/artifacts/YoutubeVideoViewer";
import ZeroCopyWebGPUViewer from "../components/artifacts/ZeroCopyWebGPUViewer";
import Box from "../components/Box";
import type { ArtifactViewDTO } from "../types/api";
import { safeJsonParse } from "../util/json";
import { usePageTitle } from "../util/title";

export default function RenderArtifactPage() {
  const { id } = useParams<{ id: string }>();
  const [artifact, setArtifact] = useState<ArtifactViewDTO | null>(null);
  usePageTitle(artifact ? `Artifact: ${artifact.title || artifact.view_type}` : "Render Artifact");

  useEffect(() => {
    async function fetchArtifact() {
      if (!id) return;
      try {
        const data = await getArtifactView(id);
        setArtifact(data.artifactView);
      } catch (err) {
        console.error("Failed to fetch artifact", err);
        (window as unknown as { __ARTIFACT_READY: boolean }).__ARTIFACT_READY = true;
      }
    }
    fetchArtifact();
  }, [id]);

  useEffect(() => {
    // When the artifact is successfully loaded and it is NOT an asynchronous heavy WebGL/Three.js
    // renderer that sets __ARTIFACT_READY on its own post-render event, we unblock puppeteer.
    if (artifact) {
      const heavyAsyncTypes = [
        "simulation",
        "simulation-result",
        "fea-result",
        "cfd-result",
        "cad",
        "cad-step",
        "cad_step",
        "cad-3d-viewer",
        "step",
        "stp",
        "gcode",
        "cam-result",
        "cfd-animation",
        "3d-model",
      ];
      if (!heavyAsyncTypes.includes(artifact.view_type)) {
        (window as unknown as { __ARTIFACT_READY: boolean }).__ARTIFACT_READY = true;
      }
    }
  }, [artifact]);

  if (!artifact) return null;

  const viewConfig = safeJsonParse<Record<string, unknown>>(artifact.view_config, {});

  const renderViewer = () => {
    switch (artifact.view_type) {
      case "cad":
      case "cad-step":
      case "cad_step":
      case "cad-3d-viewer":
      case "step":
      case "stp":
        return <CadStepViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "fmu":
      case "fmu-package":
      case "fmu-simulator":
      case "fmi":
        return <FmuViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "sysml":
      case "sysml2":
      case "sysml-architecture-viewer":
      case "kerml":
        return <SysmlViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "modelica-code":
        return <ModelicaCodeViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "modelica-diagram":
      case "morsel":
      case "polyglot-morsel":
        return <ModelicaDiagramViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "simulation-plot":
        return <SimulationPlotViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "vega":
      case "vega-plot":
        return <VegaViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "mermaid":
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
      case "tsv":
      case "dataset":
      case "dataset-table":
      case "json-table":
        return <CsvViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "webgpu":
      case "webgpu-simulation":
      case "gpu-simulation":
        return (
          <ZeroCopyWebGPUViewer
            uri={viewConfig?.uri as string}
            className={viewConfig?.className as string}
            height="100%"
          />
        );
      case "tei-document":
        return <TeiViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "link-preview":
        return <LinkPreviewViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "simulation":
      case "simulation-result":
      case "fea-result":
      case "cfd-result":
        return <SimulationResultViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "cfd-animation":
        return <CfdAnimationViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "gcode":
      case "cam-result":
        return <GCodeViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "aas-package":
      case "cyber-physical-system":
      case "hardware-project":
        return <AasPackageViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "digital-thread":
      case "digital_thread":
      case "thread-explorer":
        return <DigitalThreadExplorerViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "digital-twin-dashboard":
      case "digital_twin_dashboard":
      case "digital-twin":
        return <DigitalTwinDashboardViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "package":
      case "library":
        return <PackageViewCard viewConfig={viewConfig} isFullScreen={true} />;
      case "repository":
      case "repo":
        return <RepositoryViewCard viewConfig={viewConfig} isFullScreen={true} />;
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
