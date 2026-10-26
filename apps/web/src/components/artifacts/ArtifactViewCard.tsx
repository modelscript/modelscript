// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Spinner, useTheme } from "@primer/react";
import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getArtifactView } from "../../api";
import { safeJsonParse } from "../../util/json";
import { parseModelicaParameters } from "../../util/modelica-params";
import { cacheArtifact, getCachedArtifact } from "../../util/offline-storage";
import Box from "../Box";
import ArtifactPlaceholder from "./ArtifactPlaceholder";
import {
  type ArtifactViewCardProps,
  CardFooter,
  resolvePlaceholder,
  resolveThumbnailUrls,
  StudioHeader,
  StudioInspectorSidebar,
  ViewerDispatcher,
} from "./card";

const ArtifactDiffModal = React.lazy(() => import("./ArtifactDiffModal"));

export const ArtifactViewCard: React.FC<ArtifactViewCardProps> = ({
  artifactId,
  initialArtifactView,
  forkedFromId,
  onPinCreated,
  onThreadNodeSelected,
}) => {
  const [artifact, setArtifact] = useState<any>(initialArtifactView || null);
  const [loading, setLoading] = useState(!initialArtifactView);
  const [isLoaded] = useState(true);
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
    if (initialArtifactView && initialArtifactView.id === artifactId) {
      setArtifact(initialArtifactView);
      setLoading(false);
      cacheArtifact(initialArtifactView);
      return;
    }
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
  }, [artifactId, initialArtifactView]);

  const viewConfig: any = useMemo(
    () => ({ ...safeJsonParse(artifact?.view_config, {}), artifactId }),
    [artifact?.view_config, artifactId],
  );

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

  if (isFullScreen) {
    const currentThumbnailUrl =
      resolvedColorMode === "dark"
        ? resolvedThumbnailUrlDark || resolvedThumbnailUrl
        : resolvedThumbnailUrlLight || resolvedThumbnailUrl;

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
          {currentThumbnailUrl ? (
            <img
              src={currentThumbnailUrl}
              style={{ width: "100%", display: "block", objectFit: "cover" }}
              alt="thumbnail"
            />
          ) : (
            <ArtifactPlaceholder
              type={resolvePlaceholder(artifact.view_type)}
              title={artifact.name || artifact.view_type}
              aspectRatio="16 / 9"
            />
          )}
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
          />

          <Box flex={1} display="flex" overflow="hidden" position="relative">
            <Box flex={1} height="100%" bg="black" overflow="auto" position="relative">
              {viewerContent}
            </Box>

            <StudioInspectorSidebar
              isOpen={isStudioSidebarOpen}
              artifact={artifact}
              artifactId={artifactId}
              viewConfig={viewConfig}
            />
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
      <CardFooter
        artifact={artifact}
        artifactId={artifactId}
        viewConfig={viewConfig}
        isLoaded={isLoaded}
        onOpenFullScreen={() => setIsFullScreen(true)}
      />
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
  );
};

export default ArtifactViewCard;
