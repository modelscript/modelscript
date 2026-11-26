// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DslArtifactPanelWrapper,
  hasArtifactLanguagePanel,
} from "@modelscript/editor/workbench/util/LanguagePanelHost";
import React, { Suspense } from "react";
import styledImport from "styled-components";
import Box from "../../Box";
import Spinner from "../../Spinner";
import LazyHeavyViewer from "../LazyHeavyViewer";
import type { AnySpatialPin } from "../spatial-pin";
import ViewerErrorBoundary from "../ViewerErrorBoundary";

const styled: typeof styledImport =
  (styledImport as unknown as { default?: typeof styledImport }).default ?? styledImport;

const EmbeddedViewerSlot = styled.div<{ $isFullScreen: boolean }>`
  width: 100%;
  height: ${(p) => (p.$isFullScreen ? "100%" : "auto")};
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  & > * {
    border: none !important;
    border-radius: 0 !important;
    margin: 0 !important;
    flex: 1 1 auto;
    min-height: 0;
  }
`;

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
const PsoutViewer = React.lazy(() => import("../PsoutViewer"));
const SspViewer = React.lazy(() => import("../SspViewer"));
const FeaDeckViewer = React.lazy(() => import("../FeaDeckViewer"));
const CfdConfigViewer = React.lazy(() => import("../CfdConfigViewer"));
const GensysViewer = React.lazy(() => import("../GensysViewer"));
const SimpackViewer = React.lazy(() => import("../SimpackViewer"));
const SolutionViewCard = React.lazy(() => import("../SolutionViewCard"));
const WamRobotArtifactViewer = React.lazy(() => import("../WamRobotArtifactViewer"));
const PolyglotArtifactViewer = React.lazy(() => import("../PolyglotArtifactViewer"));
const OtdrTraceViewer = React.lazy(() => import("../OtdrTraceViewer"));
const FiberSpliceMatrixViewer = React.lazy(() => import("../FiberSpliceMatrixViewer"));
const MicrowaveProfileViewer = React.lazy(() => import("../MicrowaveProfileViewer"));
const MpeExclusionViewer = React.lazy(() => import("../MpeExclusionViewer"));
const SpatialCanvasArtifactViewer = React.lazy(() => import("../SpatialCanvasArtifactViewer"));
const TrainingRecipeArtifactCard = React.lazy(() => import("../TrainingRecipeArtifactCard"));

export function getViewerExpectedHeight(
  viewType: string | undefined,
  viewConfig?: import("./types").ArtifactViewConfig | Record<string, unknown> | null,
  isFullScreen?: boolean,
): string {
  if (isFullScreen) return "100%";
  const vt = String(viewType || "").toLowerCase();
  switch (vt) {
    case "cad":
    case "cad-step":
    case "cad_step":
    case "cad-3d-viewer":
    case "step":
    case "stp":
    case "3d-model":
    case "webgpu":
    case "webgpu-simulation":
    case "gpu-simulation":
    case "simulation":
    case "simulation-result":
    case "fea-result":
    case "cfd-result":
    case "cfd-animation":
    case "gcode":
    case "cam-result":
    case "owl":
    case "owl2":
      return "450px";
    case "pdf":
      return "420px";
    case "mscanvas":
    case "spatial-canvas":
    case "canvas-board":
    case "ssp":
    case "ssd":
    case "urdf":
    case "sdf":
    case "xacro":
      return "520px";
    case "sysml":
    case "sysml2":
    case "sysml-architecture-viewer":
    case "kerml":
      return "460px";
    case "modelica-diagram":
    case "modelica":
    case "ansatz":
    case "polyglot-ansatz":
    case "modelscript":
    case "msx":
      return "380px";
    case "simulation-plot":
      return viewConfig?.spec ? "440px" : "380px";
    case "modelica-code":
      return "360px";
    case "audio":
      return "260px";
    case "tei-document":
      return "400px";
    case "reqif":
    case "reqifz":
      return "430px";
    case "qif":
    case "otdr":
    case "sor":
    case "optical-trace":
      return "480px";
    case "fiber-splice":
    case "splice-matrix":
    case "tia-598":
    case "microwave-profile":
    case "fresnel-profile":
    case "ran-microwave":
    case "mpe":
    case "mpe-exclusion":
    case "rf-safety":
      return "520px";
    case "package":
    case "library":
    case "repository":
    case "repo":
      return "140px";
    case "training-recipe":
    case "memory-shard":
    case "dataset-pretrain":
    case "dataset-posttrain":
      return "340px";
    case "solution":
    case "engineering-app":
    case "app":
      return "168px";
    case "link-preview":
      return "230px";
    default:
      return "440px";
  }
}

export interface ViewerDispatcherProps {
  artifact: import("./types").ArtifactCardRecord;
  artifactId: number;
  viewConfig: import("./types").ArtifactViewConfig;
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
  viewConfig: rawViewConfig,
  isFullScreen,
  resolvedThumbnailUrl,
  resolvedThumbnailUrlLight,
  resolvedThumbnailUrlDark,
  onPinCreated,
  onThreadNodeSelected,
}) => {
  const asConfig = <T,>(cfg: Record<string, unknown>): T => cfg as unknown as T;
  const viewConfig = React.useMemo(
    () => (rawViewConfig ? { ...rawViewConfig, standalone: false } : { standalone: false }),
    [rawViewConfig],
  );
  const expectedHeight = getViewerExpectedHeight(artifact?.view_type, viewConfig, isFullScreen);
  const renderViewer = () => {
    const normalizedViewType = String(artifact?.view_type || "").toLowerCase();
    if (hasArtifactLanguagePanel(normalizedViewType)) {
      return (
        <DslArtifactPanelWrapper viewType={normalizedViewType} viewConfig={viewConfig} isFullScreen={isFullScreen} />
      );
    }
    switch (normalizedViewType) {
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
            height={expectedHeight}
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
        return (
          <FmuViewer
            viewConfig={asConfig<React.ComponentProps<typeof FmuViewer>["viewConfig"]>(viewConfig)}
            isFullScreen={isFullScreen}
          />
        );
      case "sysml":
      case "sysml2":
      case "sysml-architecture-viewer":
      case "kerml":
        return (
          <SysmlViewer
            viewConfig={asConfig<React.ComponentProps<typeof SysmlViewer>["viewConfig"]>(viewConfig)}
            isFullScreen={isFullScreen}
          />
        );
      case "modelica-code":
        return <ModelicaCodeViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "modelica-diagram":
      case "modelica":
      case "ansatz":
      case "polyglot-ansatz":
        return <ModelicaDiagramViewer artifactId={artifactId} viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "modelscript":
      case "msx":
        return (
          <ModelicaDiagramViewer
            artifactId={artifactId}
            viewConfig={{ ...viewConfig, dialect: viewConfig?.dialect || "msx" }}
            isFullScreen={isFullScreen}
          />
        );
      case "simulation-plot":
        return (
          <SimulationPlotViewer
            viewConfig={asConfig<React.ComponentProps<typeof SimulationPlotViewer>["viewConfig"]>(viewConfig)}
            isFullScreen={isFullScreen}
          />
        );
      case "las":
      case "well-log":
        return (
          <SimulationPlotViewer
            viewConfig={asConfig<React.ComponentProps<typeof SimulationPlotViewer>["viewConfig"]>({
              ...viewConfig,
              format: "las",
            })}
            isFullScreen={isFullScreen}
          />
        );
      case "vega":
      case "vega-plot":
        return (
          <VegaViewer
            viewConfig={asConfig<React.ComponentProps<typeof VegaViewer>["viewConfig"]>(viewConfig)}
            isFullScreen={isFullScreen}
          />
        );
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
            height={expectedHeight}
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
        return (
          <CsvViewer
            viewConfig={asConfig<React.ComponentProps<typeof CsvViewer>["viewConfig"]>(viewConfig)}
            isFullScreen={isFullScreen}
            thumbnailUrl={resolvedThumbnailUrl}
          />
        );
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
            height={expectedHeight}
            isFullScreen={isFullScreen}
          >
            <ZeroCopyWebGPUViewer
              uri={viewConfig?.uri as string}
              className={viewConfig?.className as string}
              height={isFullScreen ? "100%" : "450px"}
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
            placeholderType={normalizedViewType === "cfd-result" ? "cfd" : "fea"}
            height={expectedHeight}
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
            height={expectedHeight}
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
            height={expectedHeight}
            isFullScreen={isFullScreen}
          >
            <GCodeViewer artifactId={artifactId} viewConfig={viewConfig} isFullScreen={isFullScreen} />
          </LazyHeavyViewer>
        );
      case "aas-package":
      case "cyber-physical-system":
      case "hardware-project":
        return (
          <AasPackageViewer
            viewConfig={asConfig<React.ComponentProps<typeof AasPackageViewer>["viewConfig"]>(viewConfig)}
            isFullScreen={isFullScreen}
          />
        );
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
        return (
          <LazyHeavyViewer
            artifactId={artifactId}
            thumbnailUrl={resolvedThumbnailUrl}
            thumbnailUrlLight={resolvedThumbnailUrlLight}
            thumbnailUrlDark={resolvedThumbnailUrlDark}
            title="Digital Twin Telemetry Dashboard"
            placeholderType="plot"
            height={expectedHeight}
            isFullScreen={isFullScreen}
          >
            <DigitalTwinDashboardViewer
              viewConfig={asConfig<React.ComponentProps<typeof DigitalTwinDashboardViewer>["viewConfig"]>(viewConfig)}
              isFullScreen={isFullScreen}
            />
          </LazyHeavyViewer>
        );
      case "psout":
      case "waveform":
      case "comtrade":
      case "oscillography":
        return <PsoutViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "otdr":
      case "sor":
      case "optical-trace":
      case "optical":
        return (
          <OtdrTraceViewer
            viewConfig={asConfig<React.ComponentProps<typeof OtdrTraceViewer>["viewConfig"]>(viewConfig)}
            isFullScreen={isFullScreen}
          />
        );
      case "fiber-splice":
      case "splice-matrix":
      case "tia-598":
      case "fiber":
        return (
          <FiberSpliceMatrixViewer
            viewConfig={asConfig<React.ComponentProps<typeof FiberSpliceMatrixViewer>["viewConfig"]>(viewConfig)}
            isFullScreen={isFullScreen}
          />
        );
      case "microwave-profile":
      case "fresnel-profile":
      case "ran-microwave":
      case "microwave":
      case "ran":
        return (
          <MicrowaveProfileViewer
            viewConfig={asConfig<React.ComponentProps<typeof MicrowaveProfileViewer>["viewConfig"]>(viewConfig)}
            isFullScreen={isFullScreen}
          />
        );
      case "mpe":
      case "mpe-exclusion":
      case "rf-safety":
        return (
          <MpeExclusionViewer
            viewConfig={asConfig<React.ComponentProps<typeof MpeExclusionViewer>["viewConfig"]>(viewConfig)}
            isFullScreen={isFullScreen}
          />
        );
      case "ssp":
      case "ssd":
        return (
          <LazyHeavyViewer
            artifactId={artifactId}
            thumbnailUrl={resolvedThumbnailUrl}
            thumbnailUrlLight={resolvedThumbnailUrlLight}
            thumbnailUrlDark={resolvedThumbnailUrlDark}
            title="SSP Architecture"
            placeholderType="fmu"
            height={expectedHeight}
            isFullScreen={isFullScreen}
          >
            <SspViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />
          </LazyHeavyViewer>
        );
      case "fea-deck":
      case "fea-inp":
        return (
          <LazyHeavyViewer
            artifactId={artifactId}
            thumbnailUrl={resolvedThumbnailUrl}
            thumbnailUrlLight={resolvedThumbnailUrlLight}
            thumbnailUrlDark={resolvedThumbnailUrlDark}
            title="FEA Mesh & Deck Viewer"
            placeholderType="fea"
            height={expectedHeight}
            isFullScreen={isFullScreen}
          >
            <FeaDeckViewer artifactId={artifactId} viewConfig={viewConfig} isFullScreen={isFullScreen} />
          </LazyHeavyViewer>
        );
      case "cfd-config":
      case "cfd-su2": {
        const cfdFallbackThumb =
          resolvedThumbnailUrl ||
          (typeof viewConfig?.filename === "string" && viewConfig.filename.trim()
            ? `/api/v1/storage/uploads/${viewConfig.filename.trim()}.thumb.svg`
            : undefined);
        return (
          <LazyHeavyViewer
            artifactId={artifactId}
            thumbnailUrl={cfdFallbackThumb}
            thumbnailUrlLight={resolvedThumbnailUrlLight || cfdFallbackThumb}
            thumbnailUrlDark={resolvedThumbnailUrlDark || cfdFallbackThumb}
            title="CFD Boundary & Mesh Viewer"
            placeholderType="cfd"
            height={expectedHeight}
            isFullScreen={isFullScreen}
          >
            <CfdConfigViewer artifactId={artifactId} viewConfig={viewConfig} isFullScreen={isFullScreen} />
          </LazyHeavyViewer>
        );
      }
      case "gensys":
      case "calc":
      case "run":
      case "sub":
        return (
          <LazyHeavyViewer
            artifactId={artifactId}
            thumbnailUrl={resolvedThumbnailUrl}
            thumbnailUrlLight={resolvedThumbnailUrlLight}
            thumbnailUrlDark={resolvedThumbnailUrlDark}
            title="GENSYS Rail Dynamics"
            placeholderType="cad"
            height={expectedHeight}
            isFullScreen={isFullScreen}
          >
            <GensysViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />
          </LazyHeavyViewer>
        );
      case "simpack":
      case "spck":
      case "sim":
      case "mbs":
        return (
          <LazyHeavyViewer
            artifactId={artifactId}
            thumbnailUrl={resolvedThumbnailUrl}
            thumbnailUrlLight={resolvedThumbnailUrlLight}
            thumbnailUrlDark={resolvedThumbnailUrlDark}
            title="SIMPACK Multibody Dynamics"
            placeholderType="cad"
            height={expectedHeight}
            isFullScreen={isFullScreen}
          >
            <SimpackViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />
          </LazyHeavyViewer>
        );
      case "wam_robot_lab":
      case "wam_robot":
        return (
          <LazyHeavyViewer
            artifactId={artifactId}
            thumbnailUrl={resolvedThumbnailUrl}
            thumbnailUrlLight={resolvedThumbnailUrlLight}
            thumbnailUrlDark={resolvedThumbnailUrlDark}
            title="Modelica + WAM Robot Lab"
            placeholderType="cad"
            height={expectedHeight}
            isFullScreen={isFullScreen}
          >
            <WamRobotArtifactViewer artifactId={artifactId} viewConfig={viewConfig} isFullScreen={isFullScreen} />
          </LazyHeavyViewer>
        );
      case "mscanvas":
      case "spatial-canvas":
      case "canvas-board":
        return (
          <SpatialCanvasArtifactViewer artifactId={artifactId} viewConfig={viewConfig} isFullScreen={isFullScreen} />
        );
      case "package":
      case "library":
        return <PackageViewCard viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "repository":
      case "repo":
        return <RepositoryViewCard viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "training-recipe":
      case "memory-shard":
      case "dataset-pretrain":
      case "dataset-posttrain":
        return (
          <TrainingRecipeArtifactCard
            artifactId={artifactId}
            viewType={artifact.view_type}
            title={artifact.title || artifact.name}
            viewConfig={viewConfig}
            isFullScreen={isFullScreen}
          />
        );
      case "solution":
      case "engineering-app":
      case "app":
        return <SolutionViewCard viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      default:
        return (
          <PolyglotArtifactViewer
            viewConfig={viewConfig}
            viewType={artifact.view_type}
            artifactId={artifactId}
            isFullScreen={isFullScreen}
          />
        );
    }
  };

  return (
    <ViewerErrorBoundary viewerTitle={artifact?.title || artifact?.view_type}>
      <Suspense
        fallback={
          <Box
            p={3}
            display="flex"
            justifyContent="center"
            alignItems="center"
            height={expectedHeight}
            minHeight={expectedHeight}
          >
            <Spinner size="small" />
          </Box>
        }
      >
        <EmbeddedViewerSlot $isFullScreen={isFullScreen}>{renderViewer()}</EmbeddedViewerSlot>
      </Suspense>
    </ViewerErrorBoundary>
  );
};
