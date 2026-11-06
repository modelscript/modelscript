// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { getArtifactView } from "../../api";
import { useFeatureFlag } from "../../FeatureFlagContext";
import { useTheme } from "../../theme";
import { buildEditorUrlForArtifact, isEditableCodeOrModelArtifact } from "../../util/editor-routing";
import { safeJsonParse } from "../../util/json";
import { parseModelicaParameters } from "../../util/modelica-params";
import { cacheArtifact, getCachedArtifact } from "../../util/offline-storage";
import Box from "../Box";
import Spinner from "../Spinner";
import ArtifactPlaceholder from "./ArtifactPlaceholder";
import {
  type ArtifactViewCardProps,
  CardFooter,
  getViewerExpectedHeight,
  resolvePlaceholder,
  resolveThumbnailUrls,
  StudioHeader,
  StudioInspectorSidebar,
  ViewerDispatcher,
} from "./card";
import { CardFooterSlotDisabled, CardFooterSlotProvider } from "./card/CardFooterSlot";

const ArtifactDiffModal = React.lazy(() => import("./ArtifactDiffModal"));
const CloudSimulationModal = React.lazy(() => import("../cloud-sim/CloudSimulationModal"));

const FullScreenBackdrop = styled.div`
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 40px;
  box-sizing: border-box;

  @media (max-width: 768px) {
    padding: 16px 12px;
  }
`;

const FullScreenContainer = styled.div`
  width: 100%;
  max-width: 1400px;
  height: 100%;
  max-height: calc(100vh - 48px);
  background-color: var(--color-canvas-default, #090d16);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 14px;
  box-shadow:
    0 24px 64px rgba(0, 0, 0, 0.65),
    0 0 0 1px rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;

  @media (max-width: 768px) {
    max-height: calc(100vh - 32px);
    border-radius: 10px;
  }
`;

export const ArtifactViewCard: React.FC<ArtifactViewCardProps> = ({
  artifactId,
  initialArtifactView,
  forkedFromId,
  figureNumber,
  caption,
  onPinCreated,
  onThreadNodeSelected,
  isFullScreen: propIsFullScreen,
  onFullScreenChange: propOnFullScreenChange,
}) => {
  const validArtifactId =
    artifactId !== null && artifactId !== undefined && String(artifactId).trim() !== "" && String(artifactId) !== "0"
      ? String(artifactId)
      : null;
  const [artifact, setArtifact] = useState<any>(initialArtifactView || null);
  const [loading, setLoading] = useState(Boolean(!initialArtifactView && validArtifactId));
  const [isLoaded] = useState(true);
  const [internalFullScreen, setInternalFullScreen] = useState(false);
  const isFullScreen = propIsFullScreen !== undefined ? propIsFullScreen : internalFullScreen;
  const setIsFullScreen = useCallback(
    (action: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof action === "function" ? action(isFullScreen) : action;
      setInternalFullScreen(next);
      propOnFullScreenChange?.(next);
    },
    [isFullScreen, propOnFullScreenChange],
  );
  const [isStudioSidebarOpen, setIsStudioSidebarOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isDiffOpen, setIsDiffOpen] = useState(false);
  const [isHpcModalOpen, setIsHpcModalOpen] = useState(false);
  const hasCloudSolverFlag = useFeatureFlag("cae_cloud_solver");
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const navigate = useNavigate();

  const viewConfig: any = useMemo(
    () => ({
      ...(artifact?.title ? { title: artifact.title } : {}),
      ...(artifact?.thumbnail_url ? { thumbnail_url: artifact.thumbnail_url } : {}),
      ...safeJsonParse(artifact?.view_config, {}),
      artifactId,
    }),
    [artifact, artifactId],
  );

  const handleCopyLink = useCallback(() => {
    const permalink = `${window.location.origin}/render-artifact/${artifactId}`;
    navigator.clipboard.writeText(permalink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }, [artifactId]);

  useEffect(() => {
    if (!isFullScreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isEditable =
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        target?.isContentEditable ||
        Boolean(target?.closest(".monaco-editor, [contenteditable='true'], input, textarea, select"));

      if (e.key === "Escape") {
        if (!isEditable) {
          setIsFullScreen(false);
        }
        return;
      }

      if (isEditable || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        setIsStudioSidebarOpen((prev) => !prev);
      } else if ((e.key === "r" || e.key === "R") && isEditableCodeOrModelArtifact(artifact)) {
        e.preventDefault();
        navigate(
          buildEditorUrlForArtifact({
            artifactId,
            viewType: artifact?.view_type,
            viewConfig,
            title: artifact?.title || artifact?.name,
          }),
        );
      } else if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        handleCopyLink();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isFullScreen,
    artifactId,
    artifact?.view_type,
    artifact?.title,
    artifact?.name,
    viewConfig,
    navigate,
    handleCopyLink,
  ]);

  useEffect(() => {
    if (!isFullScreen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isFullScreen]);

  useEffect(() => {
    if (initialArtifactView) {
      setArtifact(initialArtifactView);
      cacheArtifact(initialArtifactView);
      setLoading(false);
    }
  }, [initialArtifactView]);

  useEffect(() => {
    if (!validArtifactId) {
      if (initialArtifactView) {
        setArtifact(initialArtifactView);
        cacheArtifact(initialArtifactView);
      }
      setLoading(false);
      return;
    }
    if (initialArtifactView) {
      const initialIdStr = String(initialArtifactView.id || "").trim();
      const validIdStr = String(validArtifactId).trim();
      const isMatch =
        !validArtifactId ||
        initialIdStr === validIdStr ||
        (/^\d{16,}$/.test(initialIdStr) &&
          /^\d{16,}$/.test(validIdStr) &&
          Math.abs(Number(initialIdStr) - Number(validIdStr)) <= 128);

      if (isMatch) {
        setArtifact(initialArtifactView);
        setLoading(false);
        cacheArtifact(initialArtifactView);
        return;
      }
    }
    async function fetchArtifact() {
      if (!validArtifactId) {
        setLoading(false);
        return;
      }
      try {
        const data = await getArtifactView(validArtifactId);
        const resolved = data?.artifactView ?? data?.artifact_view ?? data;
        if (resolved && (resolved.view_type || resolved.view_config || resolved.title)) {
          setArtifact(resolved);
          cacheArtifact(resolved);
        }
      } catch (err) {
        console.warn("[ArtifactViewCard] Network fetch failed, reading from offline cache:", err);
        const cached = await getCachedArtifact(validArtifactId);
        if (cached) {
          setArtifact(cached);
        }
      } finally {
        setLoading(false);
      }
    }
    fetchArtifact();
  }, [validArtifactId, initialArtifactView]);

  const resolvedForkedFromId = useMemo<number | string | null>(() => {
    if (forkedFromId) return forkedFromId;
    if (viewConfig.forkedFromArtifactId) return viewConfig.forkedFromArtifactId;
    if (viewConfig.forked_from_artifact_id) return viewConfig.forked_from_artifact_id;
    if (viewConfig.upstreamArtifactId) return viewConfig.upstreamArtifactId;
    const meta = artifact?.metadata ? safeJsonParse(artifact.metadata, artifact.metadata) : {};
    if (meta?.forkedFromArtifactId) return meta.forkedFromArtifactId;
    if (meta?.forked_from_artifact_id) return meta.forked_from_artifact_id;
    if (meta?.forked_from_post_id) return meta.forked_from_post_id;
    if (artifact?.forked_from_id) return artifact.forked_from_id;
    if (artifact?.post?.forked_from_post_id) return artifact.post.forked_from_post_id;
    return null;
  }, [forkedFromId, viewConfig, artifact]);

  const [paramDeltaCount, setParamDeltaCount] = useState<number | null>(() => {
    if (typeof viewConfig.modifiedParametersCount === "number") return viewConfig.modifiedParametersCount;
    if (Array.isArray(viewConfig.parameterDeltas)) return viewConfig.parameterDeltas.length;
    return null;
  });

  useEffect(() => {
    if (typeof viewConfig.modifiedParametersCount === "number") {
      setParamDeltaCount(viewConfig.modifiedParametersCount);
    } else if (Array.isArray(viewConfig.parameterDeltas)) {
      setParamDeltaCount(viewConfig.parameterDeltas.length);
    }
  }, [viewConfig.modifiedParametersCount, viewConfig.parameterDeltas]);

  useEffect(() => {
    if (paramDeltaCount !== null || !resolvedForkedFromId) return;
    let active = true;

    async function loadDiffCount() {
      try {
        let parentArt: any = await getCachedArtifact(resolvedForkedFromId!);
        if (!parentArt) {
          const res = await getArtifactView(resolvedForkedFromId!);
          parentArt = res?.artifactView;
        }
        if (!active || !parentArt) return;

        const parentCfg =
          typeof parentArt.view_config === "string"
            ? safeJsonParse(parentArt.view_config, {})
            : parentArt.view_config || {};
        const parentCode = parentCfg.code || "";
        const currentCode = viewConfig.code || "";

        if (parentCode && currentCode) {
          const parentParams = parseModelicaParameters(parentCode);
          const currentParams = parseModelicaParameters(currentCode);
          const allKeys = new Set([...Object.keys(parentParams), ...Object.keys(currentParams)]);
          let diffCount = 0;
          for (const k of allKeys) {
            if (parentParams[k] !== currentParams[k]) {
              diffCount++;
            }
          }
          if (active) {
            setParamDeltaCount(diffCount);
          }
        }
      } catch {
        // Silently ignore if upstream artifact cannot be loaded
      }
    }

    loadDiffCount();
    return () => {
      active = false;
    };
  }, [paramDeltaCount, resolvedForkedFromId, viewConfig.code]);

  if (loading) {
    const expectedViewerHeight = getViewerExpectedHeight(artifact?.view_type, viewConfig, false);
    const loadingCaption = caption && caption.trim() !== "" ? caption.trim() : undefined;
    return (
      <Box
        borderRadius="12px"
        border="1px solid var(--color-accent-blue-border, var(--color-border-default))"
        background="var(--ms-brand-soft)"
        overflow="hidden"
        position="relative"
        style={{
          width: "100%",
          maxWidth: "100%",
          minWidth: 0,
          boxSizing: "border-box",
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Box
          p={3}
          display="flex"
          justifyContent="center"
          alignItems="center"
          height={expectedViewerHeight}
          minHeight={expectedViewerHeight}
          flex={1}
        >
          <Spinner size="small" />
        </Box>
        <Box
          height="40px"
          minHeight="40px"
          borderTop="1px solid var(--color-accent-blue-border, var(--color-border-default))"
          backgroundColor="var(--ms-brand-soft, var(--color-canvas-subtle))"
          style={{ flexShrink: 0, marginTop: "auto" }}
        />
        {loadingCaption && (
          <div
            style={{
              padding: "6px 12px",
              fontSize: "12px",
              color: "var(--color-fg-muted)",
              borderTop: "1px solid var(--color-accent-blue-border, var(--color-border-default))",
              background: "var(--ms-brand-soft)",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            {figureNumber !== undefined && (
              <span
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontWeight: 700,
                  color: "var(--ms-brand, #0e7490)",
                  fontSize: "11px",
                }}
              >
                Fig. {figureNumber}:
              </span>
            )}
            <span>{loadingCaption}</span>
          </div>
        )}
      </Box>
    );
  }

  if (!validArtifactId && !artifact) {
    return null;
  }

  if (!artifact) {
    return (
      <Box p={3} borderRadius="12px" border="1px dashed var(--color-border)" color="var(--color-fg-muted)">
        Artifact not available
      </Box>
    );
  }

  const { resolvedThumbnailUrl, resolvedThumbnailUrlLight, resolvedThumbnailUrlDark } =
    resolveThumbnailUrls(viewConfig);

  const viewerContent = (
    <ViewerDispatcher
      artifact={artifact}
      artifactId={artifactId}
      viewConfig={viewConfig}
      isFullScreen={isFullScreen}
      resolvedThumbnailUrl={resolvedThumbnailUrl}
      resolvedThumbnailUrlLight={resolvedThumbnailUrlLight}
      resolvedThumbnailUrlDark={resolvedThumbnailUrlDark}
      onPinCreated={onPinCreated}
      onThreadNodeSelected={onThreadNodeSelected}
    />
  );

  const normalizedViewType = String(artifact?.view_type || "").toLowerCase();
  const isNonSimulatableViewType = [
    "csv",
    "tsv",
    "dataset",
    "dataset-table",
    "json-table",
    "pdf",
    "picture",
    "video",
    "youtube_video",
    "audio",
    "tei-document",
    "link-preview",
    "mermaid",
    "mermaid-diagram",
    "vega",
    "vega-plot",
    "owl",
    "owl2",
  ].includes(normalizedViewType);

  const isSimulatableArtifact =
    hasCloudSolverFlag &&
    !isNonSimulatableViewType &&
    (Boolean(viewConfig?.code) ||
      [
        "modelica",
        "modelica-code",
        "modelica-diagram",
        "morsel",
        "polyglot-morsel",
        "modelscript",
        "msx",
        "simulation",
        "cad",
        "fea",
        "fea-deck",
        "fea-inp",
        "cfd",
        "cfd-config",
        "cfd-su2",
        "spice",
        "pscad",
        "pscx",
        "pslx",
        "simpack",
        "spck",
        "sim",
        "mbs",
        "gensys",
        "calc",
        "run",
        "sub",
        "fmu",
        "fmu-package",
        "fmu-simulator",
        "fmi",
        "ssp",
        "ssd",
        "diagram",
      ].includes(normalizedViewType));

  const hpcModalElement = isHpcModalOpen ? (
    <Suspense fallback={null}>
      <CloudSimulationModal
        isOpen={isHpcModalOpen}
        onClose={() => setIsHpcModalOpen(false)}
        artifactId={artifactId}
        artifactTitle={artifact?.title || artifact?.name || viewConfig?.title || `Artifact #${artifactId}`}
        fileContent={viewConfig?.code || ""}
        dialect={viewConfig?.dialect || artifact?.view_type || "modelica"}
      />
    </Suspense>
  ) : null;

  if (isFullScreen) {
    const currentThumbnailUrl = isDark
      ? resolvedThumbnailUrlDark || resolvedThumbnailUrl
      : resolvedThumbnailUrlLight || resolvedThumbnailUrl;

    const fullScreenOverlay = (
      <FullScreenBackdrop
        data-testid="artifact-fullscreen-backdrop"
        onClick={(e) => {
          e.stopPropagation();
          setIsFullScreen(false);
        }}
      >
        <FullScreenContainer data-testid="artifact-fullscreen-container" onClick={(e) => e.stopPropagation()}>
          <StudioHeader
            artifact={artifact}
            artifactId={artifactId}
            viewConfig={viewConfig}
            resolvedForkedFromId={resolvedForkedFromId}
            paramDeltaCount={paramDeltaCount}
            copiedLink={copiedLink}
            isStudioSidebarOpen={isStudioSidebarOpen}
            onExitFullScreen={() => setIsFullScreen(false)}
            onCopyLink={handleCopyLink}
            onOpenDiff={() => setIsDiffOpen(true)}
            onToggleSidebar={() => setIsStudioSidebarOpen((prev) => !prev)}
            {...(isSimulatableArtifact ? { onRunOnHpc: () => setIsHpcModalOpen(true) } : {})}
          />

          <Box flex={1} display="flex" overflow="hidden" position="relative">
            <Box flex={1} height="100%" bg="var(--color-canvas-default)" overflow="auto" position="relative">
              <CardFooterSlotDisabled>{viewerContent}</CardFooterSlotDisabled>
            </Box>

            <StudioInspectorSidebar
              isOpen={isStudioSidebarOpen}
              artifact={artifact}
              artifactId={artifactId}
              viewConfig={viewConfig}
              onClose={() => setIsStudioSidebarOpen(false)}
            />
          </Box>
        </FullScreenContainer>
      </FullScreenBackdrop>
    );

    const resolvedTitle = String(artifact?.title || artifact?.name || viewConfig?.title || "").trim();
    const distinctCaption =
      caption && caption.trim() !== "" && caption.trim() !== resolvedTitle ? caption.trim() : undefined;

    return (
      <>
        <Box
          borderRadius="12px"
          border="1px solid var(--color-accent-blue-border, var(--color-border-default))"
          background="var(--ms-brand-soft)"
          overflow="hidden"
          style={{ width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box" }}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          {currentThumbnailUrl ? (
            <img
              src={currentThumbnailUrl}
              style={{
                width: "100%",
                display: "block",
                objectFit: "contain",
                background: isDark
                  ? "radial-gradient(circle at center, #2b2e36 0%, #1f2229 55%, #14161b 100%)"
                  : "radial-gradient(circle at center, #cdced0 0%, #d6d7d9 50%, #e2e3e4 100%)",
              }}
              alt="thumbnail"
            />
          ) : (
            <ArtifactPlaceholder
              type={resolvePlaceholder(artifact.view_type)}
              title={artifact.name || artifact.view_type}
              aspectRatio="16 / 9"
            />
          )}
          <CardFooter
            artifact={artifact}
            artifactId={artifactId}
            viewConfig={viewConfig}
            isLoaded={isLoaded}
            onOpenFullScreen={() => setIsFullScreen(true)}
            {...(isSimulatableArtifact ? { onRunOnHpc: () => setIsHpcModalOpen(true) } : {})}
          />
          {distinctCaption && (
            <div
              style={{
                padding: "6px 12px",
                fontSize: "12px",
                color: "var(--color-fg-muted)",
                borderTop: "1px solid var(--color-accent-blue-border, var(--color-border-default))",
                background: "var(--ms-brand-soft)",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              {figureNumber !== undefined && (
                <span
                  style={{
                    fontFamily: "var(--font-mono, monospace)",
                    fontWeight: 700,
                    color: "var(--ms-brand, #0e7490)",
                    fontSize: "11px",
                  }}
                >
                  Fig. {figureNumber}:
                </span>
              )}
              <span>{distinctCaption}</span>
            </div>
          )}
        </Box>

        {typeof document !== "undefined" ? createPortal(fullScreenOverlay, document.body) : fullScreenOverlay}
        {hpcModalElement}
        {isDiffOpen && resolvedForkedFromId && (
          <Suspense fallback={null}>
            <ArtifactDiffModal
              isOpen={isDiffOpen}
              onClose={() => setIsDiffOpen(false)}
              currentArtifact={artifact}
              forkedFromArtifactId={resolvedForkedFromId}
            />
          </Suspense>
        )}
      </>
    );
  }

  const resolvedTitle = String(artifact?.title || artifact?.name || viewConfig?.title || "").trim();
  const distinctCaption =
    caption && caption.trim() !== "" && caption.trim() !== resolvedTitle ? caption.trim() : undefined;

  return (
    <CardFooterSlotProvider>
      <Box
        borderRadius="12px"
        border="1px solid var(--color-accent-blue-border, var(--color-border-default))"
        background="var(--ms-brand-soft)"
        overflow="hidden"
        position="relative"
        style={{
          width: "100%",
          maxWidth: "100%",
          minWidth: 0,
          boxSizing: "border-box",
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        {viewerContent}
        <CardFooter
          artifact={artifact}
          artifactId={artifactId}
          viewConfig={viewConfig}
          isLoaded={isLoaded}
          onOpenFullScreen={() => setIsFullScreen(true)}
          {...(isSimulatableArtifact ? { onRunOnHpc: () => setIsHpcModalOpen(true) } : {})}
        />
        {distinctCaption && (
          <div
            style={{
              padding: "6px 12px",
              fontSize: "12px",
              color: "var(--color-fg-muted)",
              borderTop: "1px solid var(--color-accent-blue-border, var(--color-border-default))",
              background: "var(--ms-brand-soft)",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              flexShrink: 0,
            }}
          >
            {figureNumber !== undefined && (
              <span
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontWeight: 700,
                  color: "var(--ms-brand, #0e7490)",
                  fontSize: "11px",
                }}
              >
                Fig. {figureNumber}:
              </span>
            )}
            <span>{distinctCaption}</span>
          </div>
        )}
        {hpcModalElement}
        {isDiffOpen && resolvedForkedFromId && (
          <Suspense fallback={null}>
            <ArtifactDiffModal
              isOpen={isDiffOpen}
              onClose={() => setIsDiffOpen(false)}
              currentArtifact={artifact}
              forkedFromArtifactId={resolvedForkedFromId}
            />
          </Suspense>
        )}
      </Box>
    </CardFooterSlotProvider>
  );
};

const MemoizedArtifactViewCard = React.memo(ArtifactViewCard);
export default MemoizedArtifactViewCard;
