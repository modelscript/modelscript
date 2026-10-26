// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Spinner, Text } from "@primer/react";
import React, { Suspense } from "react";
import Box from "../../Box";
import LazyHeavyViewer from "../LazyHeavyViewer";
import type { AnySpatialPin } from "../spatial-pin";
import ViewerErrorBoundary from "../ViewerErrorBoundary";

// Lazy-loaded heavy viewers
const AasPackageViewer = React.lazy(() => import("../AasPackageViewer"));
const AudioViewer = React.lazy(() => import("../AudioViewer"));
const CadStepViewer = React.lazy(() => import("../CadStepViewer"));
const CfdAnimationViewer = React.lazy(() => import("../CfdAnimationViewer"));
const CsvViewer = React.lazy(() => import("../CsvViewer"));
const DigitalThreadExplorerViewer = React.lazy(() => import("../DigitalThreadExplorerViewer"));
const DigitalTwinDashboardViewer = React.lazy(() => import("../DigitalTwinDashboardViewer"));
const GCodeViewer = React.lazy(() => import("../GCodeViewer"));
const LinkPreviewViewer = React.lazy(() => import("../LinkPreviewViewer"));
const MermaidViewer = React.lazy(() => import("../MermaidViewer"));
const ModelicaCodeViewer = React.lazy(() => import("../ModelicaCodeViewer"));
const ModelicaDiagramViewer = React.lazy(() => import("../ModelicaDiagramViewer"));
const PdfViewer = React.lazy(() => import("../PdfViewer"));
const PictureViewer = React.lazy(() => import("../PictureViewer"));
const SimulationPlotViewer = React.lazy(() => import("../SimulationPlotViewer"));
const SimulationResultViewer = React.lazy(() => import("../SimulationResultViewer"));
const TeiViewer = React.lazy(() => import("../TeiViewer"));
const UsdViewer = React.lazy(() => import("../UsdViewer"));
const VegaViewer = React.lazy(() => import("../VegaViewer"));
const PackageViewCard = React.lazy(() => import("../PackageViewCard"));
const RepositoryViewCard = React.lazy(() => import("../RepositoryViewCard"));
const VideoViewer = React.lazy(() => import("../VideoViewer"));
const YoutubeVideoViewer = React.lazy(() => import("../YoutubeVideoViewer"));
const FmuViewer = React.lazy(() => import("../FmuViewer"));
const SysmlViewer = React.lazy(() => import("../SysmlViewer"));
const ZeroCopyWebGPUViewer = React.lazy(() => import("../ZeroCopyWebGPUViewer"));
const PscadViewer = React.lazy(() => import("../PscadViewer"));
const PsoutViewer = React.lazy(() => import("../PsoutViewer"));
const PsseSldViewer = React.lazy(() => import("../PsseSldViewer"));
const OlgaFlowViewer = React.lazy(() => import("../OlgaFlowViewer"));
const Easy5Viewer = React.lazy(() => import("../Easy5Viewer"));
const RocetsViewer = React.lazy(() => import("../RocetsViewer"));
const PipelineLpsViewer = React.lazy(() => import("../PipelineLpsViewer"));
const SimaViewer = React.lazy(() => import("../SimaViewer"));
const GtSuiteViewer = React.lazy(() => import("../GtSuiteViewer"));
const SspViewer = React.lazy(() => import("../SspViewer"));
const FeaDeckViewer = React.lazy(() => import("../FeaDeckViewer"));
const CfdConfigViewer = React.lazy(() => import("../CfdConfigViewer"));
const Owl2Viewer = React.lazy(() => import("../Owl2Viewer"));
const GensysViewer = React.lazy(() => import("../GensysViewer"));
const SimpackViewer = React.lazy(() => import("../SimpackViewer"));
const SolutionViewCard = React.lazy(() => import("../SolutionViewCard"));

export interface ViewerDispatcherProps {
  artifact: any;
  artifactId: number;
  viewConfig: any;
  isFullScreen: boolean;
  resolvedThumbnailUrl?: string | undefined;
  resolvedThumbnailUrlLight?: string | undefined;
  resolvedThumbnailUrlDark?: string | undefined;
  onPinCreated?: ((pin: AnySpatialPin) => void) | undefined;
  onThreadNodeSelected?: ((threadId: string | number) => void) | undefined;
}

export const ViewerDispatcher: React.FC<ViewerDispatcherProps> = ({
  artifact,
  artifactId,
  viewConfig,
  isFullScreen,
  resolvedThumbnailUrl,
  resolvedThumbnailUrlLight,
  resolvedThumbnailUrlDark,
  onPinCreated,
  onThreadNodeSelected,
}) => {
  const renderViewer = () => {
    switch (artifact.view_type) {
      case "cad":
      case "cad-step":
      case "cad_step":
      case "cad-3d-viewer":
      case "step":
      case "stp":
        return (
          <LazyHeavyViewer
            artifactId={artifactId}
            thumbnailUrl={resolvedThumbnailUrl}
            thumbnailUrlLight={resolvedThumbnailUrlLight}
            thumbnailUrlDark={resolvedThumbnailUrlDark}
            title="CAD 3D Viewer"
            placeholderType="cad"
            isFullScreen={isFullScreen}
          >
            <CadStepViewer
              artifactId={artifactId}
              viewConfig={viewConfig}
              isFullScreen={isFullScreen}
              onPinCreated={onPinCreated}
            />
          </LazyHeavyViewer>
        );
      case "fmu":
      case "fmu-package":
      case "fmu-simulator":
      case "fmi":
        return <FmuViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "sysml":
      case "sysml2":
      case "sysml-architecture-viewer":
      case "kerml":
        return <SysmlViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "modelica-code":
        return <ModelicaCodeViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "modelica-diagram":
      case "morsel":
      case "polyglot-morsel":
        return <ModelicaDiagramViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "simulation-plot":
        return <SimulationPlotViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "vega":
      case "vega-plot":
        return <VegaViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "mermaid":
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
            isFullScreen={isFullScreen}
          >
            <UsdViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />
          </LazyHeavyViewer>
        );
      case "video":
        return <VideoViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "youtube_video":
        return <YoutubeVideoViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "picture":
        return <PictureViewer viewConfig={viewConfig} isFullScreen={isFullScreen} onPinCreated={onPinCreated} />;
      case "audio":
        return <AudioViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "pdf":
        return <PdfViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "csv":
      case "tsv":
      case "dataset":
      case "dataset-table":
      case "json-table":
        return <CsvViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "webgpu":
      case "webgpu-simulation":
      case "gpu-simulation":
        return (
          <LazyHeavyViewer
            artifactId={artifactId}
            thumbnailUrl={resolvedThumbnailUrl}
            thumbnailUrlLight={resolvedThumbnailUrlLight}
            thumbnailUrlDark={resolvedThumbnailUrlDark}
            title="WebGPU Simulation"
            placeholderType="plot"
            isFullScreen={isFullScreen}
          >
            <ZeroCopyWebGPUViewer
              uri={viewConfig?.uri as string}
              className={viewConfig?.className as string}
              height={isFullScreen ? "100%" : "440px"}
            />
          </LazyHeavyViewer>
        );
      case "tei-document":
        return <TeiViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "link-preview":
        return <LinkPreviewViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "simulation":
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
            isFullScreen={isFullScreen}
          >
            <SimulationResultViewer
              artifactId={artifactId}
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
            isFullScreen={isFullScreen}
          >
            <CfdAnimationViewer artifactId={artifactId} viewConfig={viewConfig} isFullScreen={isFullScreen} />
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
            placeholderType="gcode"
            isFullScreen={isFullScreen}
          >
            <GCodeViewer artifactId={artifactId} viewConfig={viewConfig} isFullScreen={isFullScreen} />
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
      case "pscad":
      case "pscx":
      case "pslx":
        return <PscadViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "psout":
        return <PsoutViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "psse":
      case "raw":
        return <PsseSldViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "olga":
      case "opi":
        return <OlgaFlowViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "easy5":
      case "ez5":
        return <Easy5Viewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "rocets":
      case "roc":
        return <RocetsViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "lps":
      case "pipelinestudio":
        return <PipelineLpsViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "sima":
        return <SimaViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "gtsuite":
      case "gtm":
        return <GtSuiteViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "ssp":
      case "ssd":
        return <SspViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "fea-deck":
      case "fea-inp":
        return <FeaDeckViewer artifactId={artifactId} viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "cfd-config":
      case "cfd-su2":
        return <CfdConfigViewer artifactId={artifactId} viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "gensys":
      case "calc":
      case "run":
      case "sub":
        return <GensysViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "simpack":
      case "spck":
      case "sim":
      case "mbs":
        return <SimpackViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "owl":
      case "owl2":
        return <Owl2Viewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "package":
      case "library":
        return <PackageViewCard viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "repository":
      case "repo":
        return <RepositoryViewCard viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "solution":
      case "engineering-app":
      case "app":
        return <SolutionViewCard viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      default:
        return (
          <Box p={3} backgroundColor="var(--color-canvas-subtle)" borderRadius="6px">
            <Text>Unsupported artifact type: {artifact.view_type}</Text>
          </Box>
        );
    }
  };

  return (
    <ViewerErrorBoundary viewerTitle={artifact?.title || artifact?.view_type}>
      <Suspense
        fallback={
          <Box p={3} display="flex" justifyContent="center" alignItems="center" minHeight="120px">
            <Spinner size="small" />
          </Box>
        }
      >
        {renderViewer()}
      </Suspense>
    </ViewerErrorBoundary>
  );
};
