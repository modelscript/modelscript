// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import {
  CheckIcon,
  CodeIcon,
  DownloadIcon,
  GitCompareIcon,
  InfoIcon,
  LinkIcon,
  ScreenFullIcon,
  XIcon,
} from "@primer/octicons-react";
import { Spinner, Text, useTheme } from "@primer/react";
import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getArtifactView } from "../../api";
import { safeJsonParse } from "../../util/json";
import Box from "../Box";
import ArtifactPlaceholder from "./ArtifactPlaceholder";
import LazyHeavyViewer from "./LazyHeavyViewer";
import ViewerErrorBoundary from "./ViewerErrorBoundary";

// Lazy-loaded heavy viewers
const AasPackageViewer = React.lazy(() => import("./AasPackageViewer"));
const AudioViewer = React.lazy(() => import("./AudioViewer"));
const CadStepViewer = React.lazy(() => import("./CadStepViewer"));
const CfdAnimationViewer = React.lazy(() => import("./CfdAnimationViewer"));
const CsvViewer = React.lazy(() => import("./CsvViewer"));
const DigitalThreadExplorerViewer = React.lazy(() => import("./DigitalThreadExplorerViewer"));
const DigitalTwinDashboardViewer = React.lazy(() => import("./DigitalTwinDashboardViewer"));
const GCodeViewer = React.lazy(() => import("./GCodeViewer"));
const LinkPreviewViewer = React.lazy(() => import("./LinkPreviewViewer"));
const MermaidViewer = React.lazy(() => import("./MermaidViewer"));
const ModelicaCodeViewer = React.lazy(() => import("./ModelicaCodeViewer"));
const ModelicaDiagramViewer = React.lazy(() => import("./ModelicaDiagramViewer"));
const PdfViewer = React.lazy(() => import("./PdfViewer"));
const PictureViewer = React.lazy(() => import("./PictureViewer"));
const SimulationPlotViewer = React.lazy(() => import("./SimulationPlotViewer"));
const SimulationResultViewer = React.lazy(() => import("./SimulationResultViewer"));
const TeiViewer = React.lazy(() => import("./TeiViewer"));
const UsdViewer = React.lazy(() => import("./UsdViewer"));
const VegaViewer = React.lazy(() => import("./VegaViewer"));
const PackageViewCard = React.lazy(() => import("./PackageViewCard"));
const RepositoryViewCard = React.lazy(() => import("./RepositoryViewCard"));
const VideoViewer = React.lazy(() => import("./VideoViewer"));
const YoutubeVideoViewer = React.lazy(() => import("./YoutubeVideoViewer"));
const FmuViewer = React.lazy(() => import("./FmuViewer"));
const SysmlViewer = React.lazy(() => import("./SysmlViewer"));
const ZeroCopyWebGPUViewer = React.lazy(() => import("./ZeroCopyWebGPUViewer"));

import { cacheArtifact, getCachedArtifact } from "../../util/offline-storage";
import ArtifactDiffModal from "./ArtifactDiffModal";
import type { AnySpatialPin } from "./spatial-pin";

interface ArtifactViewCardProps {
  artifactId: number;
  onPinCreated?: (pin: AnySpatialPin) => void;
  onThreadNodeSelected?: (threadId: string | number) => void;
}

const ArtifactViewCard: React.FC<ArtifactViewCardProps> = ({ artifactId, onPinCreated, onThreadNodeSelected }) => {
  const [artifact, setArtifact] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isLoaded, setIsLoaded] = useState(true);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isStudioSidebarOpen, setIsStudioSidebarOpen] = useState(true);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isDiffOpen, setIsDiffOpen] = useState(false);
  const { resolvedColorMode } = useTheme();
  const navigate = useNavigate();

  const handleCopyLink = useCallback(() => {
    const permalink = `${window.location.origin}/render-artifact/${artifactId}`;
    navigator.clipboard.writeText(permalink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }, [artifactId]);

  useEffect(() => {
    if (!isFullScreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;

      if (e.key === "Escape") {
        setIsFullScreen(false);
      } else if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        setIsStudioSidebarOpen((prev) => !prev);
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        navigate(`/ide#memfs:artifact-${artifactId}`);
      } else if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        handleCopyLink();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullScreen, artifactId, navigate, handleCopyLink]);

  useEffect(() => {
    async function fetchArtifact() {
      if (!artifactId) return;
      try {
        const data = await getArtifactView(artifactId);
        if (data?.artifactView) {
          setArtifact(data.artifactView);
          cacheArtifact(data.artifactView);
        }
      } catch (err) {
        console.warn("[ArtifactViewCard] Network fetch failed, reading from offline cache:", err);
        const cached = await getCachedArtifact(artifactId);
        if (cached) {
          setArtifact(cached);
        }
      } finally {
        setLoading(false);
      }
    }
    fetchArtifact();
  }, [artifactId]);

  const viewConfig: any = useMemo(
    () => ({ ...safeJsonParse(artifact?.view_config, {}), artifactId }),
    [artifact?.view_config, artifactId],
  );

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
      case "package":
      case "library":
        return <PackageViewCard viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      case "repository":
      case "repo":
        return <RepositoryViewCard viewConfig={viewConfig} isFullScreen={isFullScreen} />;
      default:
        return (
          <Box p={3} backgroundColor="var(--color-canvas-subtle)" borderRadius="6px">
            <Text>Unsupported artifact type: {artifact.view_type}</Text>
          </Box>
        );
    }
  };

  const viewerContent = (
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

  if (isFullScreen) {
    return (
      <>
        <Box
          mt={2}
          borderRadius="12px"
          border="1px solid var(--color-border)"
          overflow="hidden"
          style={{ width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box" }}
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

            const resolvePlaceholder = (vt?: string): string => {
              if (!vt) return "generic";
              const v = vt.toLowerCase();
              if (v === "cfd" || v === "cfd-result" || v === "cfd-animation") return "cfd";
              if (v === "fea" || v === "fea-result") return "fea";
              if (
                v === "cad" ||
                v === "cad-step" ||
                v === "cad_step" ||
                v === "cad-3d-viewer" ||
                v === "step" ||
                v === "stp" ||
                v === "3d-model"
              )
                return "cad";
              if (v === "gcode" || v === "cam-result" || v === "cam") return "gcode";
              if (v === "fmu" || v === "fmi" || v === "fmu-package" || v === "fmu-simulator") return "fmu";
              if (v === "sysml" || v === "sysml2" || v === "sysml-architecture-viewer" || v === "kerml") return "sysml";
              if (v === "dataset" || v === "dataset-table" || v === "csv" || v === "tsv" || v === "json-table")
                return "dataset";
              if (v === "simulation-plot" || v === "vega" || v === "vega-plot") return "plot";
              if (v === "pdf" || v === "tei-document") return "pdf";
              return "generic";
            };

            return (
              <ArtifactPlaceholder
                type={resolvePlaceholder(artifact.view_type)}
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
            backgroundColor: "#090d16",
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Studio Header */}
          <Box
            p={3}
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            bg="rgba(15, 23, 42, 0.95)"
            borderBottom="1px solid var(--color-border-glass, rgba(255, 255, 255, 0.1))"
            style={{ backdropFilter: "blur(12px)" }}
          >
            <Box display="flex" alignItems="center" gap={3}>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsFullScreen(false);
                }}
                style={{
                  background: "rgba(255, 255, 255, 0.08)",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  color: "#e2e8f0",
                  cursor: "pointer",
                  padding: "6px 12px",
                  borderRadius: "8px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "12px",
                  fontWeight: 600,
                  fontFamily: "var(--font-mono, monospace)",
                }}
                title="Exit studio mode (Esc)"
              >
                <XIcon size={14} /> Exit Studio
              </button>
              <Text color="white" fontWeight="bold" fontSize="15px">
                {artifact.title || artifact.name || artifact.view_type}
              </Text>
              <span
                style={{
                  fontSize: "10px",
                  background: "rgba(6, 182, 212, 0.15)",
                  color: "#06b6d4",
                  border: "1px solid rgba(6, 182, 212, 0.3)",
                  padding: "2px 8px",
                  borderRadius: "6px",
                  fontWeight: 700,
                  fontFamily: "var(--font-mono, monospace)",
                }}
              >
                {artifact.view_type?.toUpperCase()}
              </span>
              {(viewConfig.provenance || viewConfig.solverInfo || viewConfig.profile) && (
                <span
                  style={{
                    fontSize: "10px",
                    background: "rgba(139, 92, 246, 0.15)",
                    color: "#a78bfa",
                    border: "1px solid rgba(139, 92, 246, 0.3)",
                    padding: "2px 8px",
                    borderRadius: "6px",
                    fontWeight: 600,
                    fontFamily: "var(--font-mono, monospace)",
                  }}
                >
                  ⚡ {viewConfig.provenance?.solver?.toUpperCase() || viewConfig.solverInfo?.name} ·{" "}
                  {viewConfig.provenance?.profile || viewConfig.profile || "HPC Standard"}
                </span>
              )}
              {viewConfig.forkedFromArtifactId && (
                <>
                  <span
                    style={{
                      fontSize: "10px",
                      background: "rgba(245, 158, 11, 0.15)",
                      color: "#f59e0b",
                      border: "1px solid rgba(245, 158, 11, 0.3)",
                      padding: "2px 8px",
                      borderRadius: "6px",
                      fontWeight: 600,
                      fontFamily: "var(--font-mono, monospace)",
                      cursor: "pointer",
                    }}
                    title={`Forked from Artifact #${viewConfig.forkedFromArtifactId}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/feed?artifact=${viewConfig.forkedFromArtifactId}`);
                    }}
                  >
                    ⚡ Fork of #{viewConfig.forkedFromArtifactId}
                  </span>
                  <button
                    type="button"
                    style={{
                      fontSize: "10px",
                      background: "rgba(6, 182, 212, 0.15)",
                      color: "#06b6d4",
                      border: "1px solid rgba(6, 182, 212, 0.3)",
                      padding: "2px 8px",
                      borderRadius: "6px",
                      fontWeight: 600,
                      fontFamily: "var(--font-mono, monospace)",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                    title="Compare model changes against upstream parent"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsDiffOpen(true);
                    }}
                  >
                    <GitCompareIcon size={12} /> View Changes
                  </button>
                </>
              )}
            </Box>

            <Box display="flex" alignItems="center" gap={2}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopyLink();
                }}
                style={{
                  background: copiedLink ? "rgba(16, 185, 129, 0.2)" : "rgba(255, 255, 255, 0.08)",
                  border: copiedLink ? "1px solid rgba(16, 185, 129, 0.4)" : "1px solid rgba(255, 255, 255, 0.15)",
                  color: copiedLink ? "#34d399" : "#e2e8f0",
                  borderRadius: "6px",
                  padding: "5px 10px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
                title="Copy direct artifact permalink (C)"
              >
                {copiedLink ? <CheckIcon size={14} /> : <LinkIcon size={14} />}
                {copiedLink ? "Copied" : "Share"}
              </button>

              {(viewConfig.url || viewConfig.downloadUrl) && (
                <a
                  href={viewConfig.url || viewConfig.downloadUrl}
                  download
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    background: "rgba(255, 255, 255, 0.08)",
                    border: "1px solid rgba(255, 255, 255, 0.15)",
                    color: "#e2e8f0",
                    borderRadius: "6px",
                    padding: "5px 10px",
                    fontSize: "12px",
                    fontWeight: 600,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    textDecoration: "none",
                  }}
                  title="Download raw source artifact file"
                >
                  <DownloadIcon size={14} /> Download Asset
                </a>
              )}
              {viewConfig.provenance && viewConfig.jobId && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(`/api/v1/cae/jobs/${viewConfig.jobId}/reproduce-spec`, "_blank");
                  }}
                  style={{
                    background: "linear-gradient(135deg, rgba(139, 92, 246, 0.25), rgba(6, 182, 212, 0.25))",
                    color: "#ffffff",
                    border: "1px solid var(--color-border-glass, rgba(255, 255, 255, 0.1))",
                    borderRadius: "6px",
                    padding: "5px 10px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
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
                  background: "linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(139, 92, 246, 0.2))",
                  color: "#38bdf8",
                  border: "1px solid rgba(6, 182, 212, 0.4)",
                  borderRadius: "6px",
                  padding: "5px 10px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
                title="Open and run in ModelScript IDE workbench"
              >
                <CodeIcon size={14} /> Run in IDE
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsStudioSidebarOpen(!isStudioSidebarOpen);
                }}
                style={{
                  background: isStudioSidebarOpen ? "rgba(6, 182, 212, 0.2)" : "rgba(255, 255, 255, 0.08)",
                  border: isStudioSidebarOpen
                    ? "1px solid rgba(6, 182, 212, 0.4)"
                    : "1px solid rgba(255, 255, 255, 0.15)",
                  color: isStudioSidebarOpen ? "#06b6d4" : "#e2e8f0",
                  borderRadius: "6px",
                  padding: "5px 10px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
                title="Toggle Telemetry Sidebar"
              >
                <InfoIcon size={14} /> Inspector
              </button>
            </Box>
          </Box>

          {/* Studio Workspace Area */}
          <Box flex={1} display="flex" overflow="hidden" position="relative">
            {/* Main Interactive Viewer Viewport */}
            <Box flex={1} height="100%" bg="black" overflow="auto" position="relative">
              {viewerContent}
            </Box>

            {/* Collapsible Inspector Sidebar */}
            {isStudioSidebarOpen && (
              <Box
                width="320px"
                bg="rgba(15, 23, 42, 0.95)"
                borderLeft="1px solid var(--color-border-glass, rgba(255, 255, 255, 0.1))"
                display="flex"
                flexDirection="column"
                p={3}
                overflowY="auto"
                style={{ color: "#e2e8f0" }}
              >
                <Text fontSize="13px" fontWeight="bold" mb={3} color="white">
                  Engineering Telemetry &amp; Specs
                </Text>

                <Box display="flex" flexDirection="column" gap={2} mb={4} fontSize="12px">
                  <Box
                    display="flex"
                    justifyContent="space-between"
                    py={1}
                    borderBottom="1px solid rgba(255,255,255,0.06)"
                  >
                    <span style={{ color: "var(--color-fg-muted)" }}>Artifact ID</span>
                    <span style={{ fontFamily: "var(--font-mono, monospace)" }}>#{artifactId}</span>
                  </Box>
                  <Box
                    display="flex"
                    justifyContent="space-between"
                    py={1}
                    borderBottom="1px solid rgba(255,255,255,0.06)"
                  >
                    <span style={{ color: "var(--color-fg-muted)" }}>Format</span>
                    <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{artifact.view_type}</span>
                  </Box>

                  {/* Domain-specific Engineering Telemetry */}
                  {["fmu", "fmu-package", "fmu-simulator", "fmi"].includes(artifact.view_type?.toLowerCase()) && (
                    <>
                      <Box
                        display="flex"
                        justifyContent="space-between"
                        py={1}
                        borderBottom="1px solid rgba(255,255,255,0.06)"
                      >
                        <span style={{ color: "var(--color-fg-muted)" }}>Model Identifier</span>
                        <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
                          {viewConfig.modelName || "FMU Model"}
                        </span>
                      </Box>
                      <Box
                        display="flex"
                        justifyContent="space-between"
                        py={1}
                        borderBottom="1px solid rgba(255,255,255,0.06)"
                      >
                        <span style={{ color: "var(--color-fg-muted)" }}>FMI Standard</span>
                        <span style={{ fontFamily: "var(--font-mono, monospace)", color: "#a78bfa" }}>
                          FMI {viewConfig.fmiVersion || "2.0"}
                        </span>
                      </Box>
                      <Box
                        display="flex"
                        justifyContent="space-between"
                        py={1}
                        borderBottom="1px solid rgba(255,255,255,0.06)"
                      >
                        <span style={{ color: "var(--color-fg-muted)" }}>Execution Engine</span>
                        <span style={{ color: viewConfig.hasWasm ? "#22d3ee" : "#8b949e" }}>
                          {viewConfig.hasWasm ? "WASM in-browser" : "Native Binaries"}
                        </span>
                      </Box>
                      <Box
                        display="flex"
                        justifyContent="space-between"
                        py={1}
                        borderBottom="1px solid rgba(255,255,255,0.06)"
                      >
                        <span style={{ color: "var(--color-fg-muted)" }}>Variables</span>
                        <span>
                          {viewConfig.variables?.length ??
                            (viewConfig.inputs?.length || 0) +
                              (viewConfig.outputs?.length || 0) +
                              (viewConfig.parameters?.length || 0)}
                        </span>
                      </Box>
                    </>
                  )}

                  {["sysml", "sysml2", "sysml-architecture-viewer", "kerml"].includes(
                    artifact.view_type?.toLowerCase(),
                  ) && (
                    <>
                      <Box
                        display="flex"
                        justifyContent="space-between"
                        py={1}
                        borderBottom="1px solid rgba(255,255,255,0.06)"
                      >
                        <span style={{ color: "var(--color-fg-muted)" }}>System Model</span>
                        <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
                          {viewConfig.systemName || viewConfig.title || "SysML Architecture"}
                        </span>
                      </Box>
                      <Box
                        display="flex"
                        justifyContent="space-between"
                        py={1}
                        borderBottom="1px solid rgba(255,255,255,0.06)"
                      >
                        <span style={{ color: "var(--color-fg-muted)" }}>Standard / Dialect</span>
                        <span style={{ color: "#60a5fa" }}>{viewConfig.format || "SysML2"}</span>
                      </Box>
                      <Box
                        display="flex"
                        justifyContent="space-between"
                        py={1}
                        borderBottom="1px solid rgba(255,255,255,0.06)"
                      >
                        <span style={{ color: "var(--color-fg-muted)" }}>Part Definitions</span>
                        <span>{viewConfig.parts?.length || 4} parts</span>
                      </Box>
                      <Box
                        display="flex"
                        justifyContent="space-between"
                        py={1}
                        borderBottom="1px solid rgba(255,255,255,0.06)"
                      >
                        <span style={{ color: "var(--color-fg-muted)" }}>Requirements</span>
                        <span style={{ color: "#34d399" }}>{viewConfig.requirements?.length || 4} tracked</span>
                      </Box>
                    </>
                  )}

                  {["dataset", "dataset-table", "csv", "tsv", "json-table"].includes(
                    artifact.view_type?.toLowerCase(),
                  ) && (
                    <>
                      <Box
                        display="flex"
                        justifyContent="space-between"
                        py={1}
                        borderBottom="1px solid rgba(255,255,255,0.06)"
                      >
                        <span style={{ color: "var(--color-fg-muted)" }}>Dimensions</span>
                        <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
                          {viewConfig.rowCount || viewConfig.rows?.length || 0} rows &bull;{" "}
                          {viewConfig.columns?.length || 0} cols
                        </span>
                      </Box>
                      <Box
                        display="flex"
                        justifyContent="space-between"
                        py={1}
                        borderBottom="1px solid rgba(255,255,255,0.06)"
                      >
                        <span style={{ color: "var(--color-fg-muted)" }}>File Format</span>
                        <span style={{ textTransform: "uppercase" }}>{viewConfig.format || "CSV"}</span>
                      </Box>
                    </>
                  )}

                  {viewConfig.url && (
                    <Box
                      display="flex"
                      flexDirection="column"
                      gap={1}
                      py={1}
                      borderBottom="1px solid rgba(255,255,255,0.06)"
                    >
                      <span style={{ color: "var(--color-fg-muted)" }}>Asset Resource</span>
                      <span
                        style={{
                          fontFamily: "var(--font-mono, monospace)",
                          fontSize: "10px",
                          wordBreak: "break-all",
                          color: "#38bdf8",
                        }}
                      >
                        {viewConfig.url}
                      </span>
                    </Box>
                  )}
                  {(viewConfig.usage || viewConfig.hpc) && (
                    <>
                      <Box
                        display="flex"
                        justifyContent="space-between"
                        py={1}
                        borderBottom="1px solid rgba(255,255,255,0.06)"
                      >
                        <span style={{ color: "var(--color-fg-muted)" }}>Compute Runtime</span>
                        <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
                          {viewConfig.usage?.cpuSeconds ?? viewConfig.hpc?.cpuCoreSeconds ?? 0}s
                        </span>
                      </Box>
                      <Box
                        display="flex"
                        justifyContent="space-between"
                        py={1}
                        borderBottom="1px solid rgba(255,255,255,0.06)"
                      >
                        <span style={{ color: "var(--color-fg-muted)" }}>Execution Cost</span>
                        <span style={{ fontFamily: "var(--font-mono, monospace)", color: "#34d399" }}>
                          {(viewConfig.usage?.costCredits ?? viewConfig.hpc?.costCredits ?? 0).toFixed(2)} credits
                        </span>
                      </Box>
                    </>
                  )}
                </Box>

                <Text fontSize="13px" fontWeight="bold" mb={2} color="white">
                  Interaction Guide
                </Text>
                <Box
                  p={2}
                  bg="rgba(0,0,0,0.3)"
                  borderRadius="8px"
                  border="1px solid rgba(255,255,255,0.08)"
                  fontSize="11px"
                  display="flex"
                  flexDirection="column"
                  gap={1}
                  color="var(--color-fg-muted)"
                >
                  {[
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
                  ].includes(artifact.view_type?.toLowerCase()) ? (
                    <>
                      <div>
                        🖱️ <b>Rotate:</b> Left-click + drag
                      </div>
                      <div>
                        ✋ <b>Pan:</b> Right-click + drag / Two-finger swipe
                      </div>
                      <div>
                        🔍 <b>Zoom:</b> Scroll wheel / Pinch
                      </div>
                      <div>
                        📍 <b>Spatial Pin:</b> Click in PIN mode to attach comments
                      </div>
                    </>
                  ) : ["fmu", "fmu-package", "fmu-simulator", "fmi"].includes(artifact.view_type?.toLowerCase()) ? (
                    <>
                      <div>
                        ⚙️ <b>Tune Parameters:</b> Modify inputs in the variable table
                      </div>
                      <div>
                        ▶️ <b>Live Co-Simulation:</b> Execute numerical integration
                      </div>
                      <div>
                        📈 <b>Plot Trajectory:</b> View response curves in real-time
                      </div>
                    </>
                  ) : ["sysml", "sysml2", "sysml-architecture-viewer", "kerml"].includes(
                      artifact.view_type?.toLowerCase(),
                    ) ? (
                    <>
                      <div>
                        🌳 <b>Architecture:</b> Browse part definitions and ports
                      </div>
                      <div>
                        🛡️ <b>Verification:</b> Inspect requirements satisfaction
                      </div>
                      <div>
                        📄 <b>Source:</b> Copy KerML / SysML v2 source code
                      </div>
                    </>
                  ) : ["dataset", "dataset-table", "csv", "tsv", "json-table"].includes(
                      artifact.view_type?.toLowerCase(),
                    ) ? (
                    <>
                      <div>
                        ↕️ <b>Sort:</b> Click column headers to sort rows
                      </div>
                      <div>
                        🔍 <b>Search:</b> Real-time row filtering across all columns
                      </div>
                      <div>
                        📊 <b>Profiling:</b> Toggle &ldquo;Stats&rdquo; for min, max, mean, unique
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        📄 <b>Source View:</b> Syntax highlighted inspection
                      </div>
                      <div>
                        📋 <b>Copy:</b> Export code to system clipboard
                      </div>
                    </>
                  )}
                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", marginTop: "4px", paddingTop: "4px" }}>
                    ⌨️ <b>Hotkeys:</b> [Esc] Exit &bull; [I] Inspector &bull; [R] IDE &bull; [C] Copy Link
                  </div>
                </Box>
              </Box>
            )}
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
      style={{ width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box" }}
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
      {isDiffOpen && (
        <ArtifactDiffModal
          isOpen={isDiffOpen}
          onClose={() => setIsDiffOpen(false)}
          currentArtifact={artifact}
          forkedFromArtifactId={viewConfig.forkedFromArtifactId}
        />
      )}
    </Box>
  );
};

export default ArtifactViewCard;
