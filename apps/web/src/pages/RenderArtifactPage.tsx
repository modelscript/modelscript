// SPDX-License-Identifier: AGPL-3.0-or-later

import { BaseStyles, Spinner, ThemeProvider } from "@primer/react";
import React, { Suspense, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getArtifactView } from "../api";
import Box from "../components/Box";
import type { ArtifactViewDTO } from "../types/api";
import { safeJsonParse } from "../util/json";
import { usePageTitle } from "../util/title";

// Lazy-loaded artifact viewers
const AasPackageViewer = React.lazy(() => import("../components/artifacts/AasPackageViewer"));
const AudioViewer = React.lazy(() => import("../components/artifacts/AudioViewer"));
const CadStepViewer = React.lazy(() => import("../components/artifacts/CadStepViewer"));
const CfdAnimationViewer = React.lazy(() => import("../components/artifacts/CfdAnimationViewer"));
const CfdConfigViewer = React.lazy(() => import("../components/artifacts/CfdConfigViewer"));
const CsvViewer = React.lazy(() => import("../components/artifacts/CsvViewer"));
const DigitalThreadExplorerViewer = React.lazy(() => import("../components/artifacts/DigitalThreadExplorerViewer"));
const DigitalTwinDashboardViewer = React.lazy(() => import("../components/artifacts/DigitalTwinDashboardViewer"));
const Easy5Viewer = React.lazy(() => import("../components/artifacts/Easy5Viewer"));
const FeaDeckViewer = React.lazy(() => import("../components/artifacts/FeaDeckViewer"));
const FmuViewer = React.lazy(() => import("../components/artifacts/FmuViewer"));
const GCodeViewer = React.lazy(() => import("../components/artifacts/GCodeViewer"));
const GtSuiteViewer = React.lazy(() => import("../components/artifacts/GtSuiteViewer"));
const LinkPreviewViewer = React.lazy(() => import("../components/artifacts/LinkPreviewViewer"));
const MermaidViewer = React.lazy(() => import("../components/artifacts/MermaidViewer"));
const ModelicaCodeViewer = React.lazy(() => import("../components/artifacts/ModelicaCodeViewer"));
const ModelicaDiagramViewer = React.lazy(() => import("../components/artifacts/ModelicaDiagramViewer"));
const OlgaFlowViewer = React.lazy(() => import("../components/artifacts/OlgaFlowViewer"));
const Owl2Viewer = React.lazy(() => import("../components/artifacts/Owl2Viewer"));
const PackageViewCard = React.lazy(() => import("../components/artifacts/PackageViewCard"));
const PdfViewer = React.lazy(() => import("../components/artifacts/PdfViewer"));
const PictureViewer = React.lazy(() => import("../components/artifacts/PictureViewer"));
const PipelineLpsViewer = React.lazy(() => import("../components/artifacts/PipelineLpsViewer"));
const PscadViewer = React.lazy(() => import("../components/artifacts/PscadViewer"));
const PsoutViewer = React.lazy(() => import("../components/artifacts/PsoutViewer"));
const PsseSldViewer = React.lazy(() => import("../components/artifacts/PsseSldViewer"));
const RepositoryViewCard = React.lazy(() => import("../components/artifacts/RepositoryViewCard"));
const RocetsViewer = React.lazy(() => import("../components/artifacts/RocetsViewer"));
const SimaViewer = React.lazy(() => import("../components/artifacts/SimaViewer"));
const SimulationPlotViewer = React.lazy(() => import("../components/artifacts/SimulationPlotViewer"));
const SimulationResultViewer = React.lazy(() => import("../components/artifacts/SimulationResultViewer"));
const SspViewer = React.lazy(() => import("../components/artifacts/SspViewer"));
const SysmlViewer = React.lazy(() => import("../components/artifacts/SysmlViewer"));
const TeiViewer = React.lazy(() => import("../components/artifacts/TeiViewer"));
const UsdViewer = React.lazy(() => import("../components/artifacts/UsdViewer"));
const VegaViewer = React.lazy(() => import("../components/artifacts/VegaViewer"));
const VideoViewer = React.lazy(() => import("../components/artifacts/VideoViewer"));
const YoutubeVideoViewer = React.lazy(() => import("../components/artifacts/YoutubeVideoViewer"));
const ZeroCopyWebGPUViewer = React.lazy(() => import("../components/artifacts/ZeroCopyWebGPUViewer"));

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return <AasPackageViewer viewConfig={viewConfig as any} isFullScreen={true} />;
      case "digital-thread":
      case "digital_thread":
      case "thread-explorer":
        return <DigitalThreadExplorerViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "digital-twin-dashboard":
      case "digital_twin_dashboard":
      case "digital-twin":
        return <DigitalTwinDashboardViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "pscad":
      case "pscx":
      case "pslx":
        return <PscadViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "psout":
        return <PsoutViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "psse":
      case "raw":
        return <PsseSldViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "olga":
      case "opi":
        return <OlgaFlowViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "easy5":
      case "ez5":
        return <Easy5Viewer viewConfig={viewConfig} isFullScreen={true} />;
      case "rocets":
      case "roc":
        return <RocetsViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "lps":
      case "pipelinestudio":
        return <PipelineLpsViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "sima":
        return <SimaViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "gtsuite":
      case "gtm":
        return <GtSuiteViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "ssp":
      case "ssd":
        return <SspViewer viewConfig={viewConfig} isFullScreen={true} />;
      case "fea-deck":
      case "fea-inp":
        return <FeaDeckViewer artifactId={artifact?.id} viewConfig={viewConfig} isFullScreen={true} />;
      case "cfd-config":
      case "cfd-su2":
        return <CfdConfigViewer artifactId={artifact?.id} viewConfig={viewConfig} isFullScreen={true} />;
      case "owl":
      case "owl2":
        return <Owl2Viewer viewConfig={viewConfig} isFullScreen={true} />;
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
          <Suspense
            fallback={
              <Box display="flex" alignItems="center" justifyContent="center" width="100%" height="100%">
                <Spinner size="large" />
              </Box>
            }
          >
            {renderViewer()}
          </Suspense>
        </Box>
      </BaseStyles>
    </ThemeProvider>
  );
}
