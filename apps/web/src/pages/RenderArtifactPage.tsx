// SPDX-License-Identifier: AGPL-3.0-or-later

import { BaseStyles, ThemeProvider } from "@primer/react";
import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { getArtifactView } from "../api";
import {
  StudioHeader,
  StudioInspectorSidebar,
  ViewerDispatcher,
  resolveThumbnailUrls,
} from "../components/artifacts/card";
import Box from "../components/Box";
import Spinner from "../components/Spinner";
import { useFeatureFlag } from "../FeatureFlagContext";
import type { ArtifactViewDTO } from "../types/api";
import { buildEditorUrlForArtifact } from "../util/editor-routing";
import { safeJsonParse } from "../util/json";
import { parseModelicaParameters } from "../util/modelica-params";
import { getCachedArtifact } from "../util/offline-storage";
import { usePageTitle } from "../util/title";

const ArtifactDiffModal = React.lazy(() => import("../components/artifacts/ArtifactDiffModal"));
const CloudSimulationModal = React.lazy(() => import("../components/cloud-sim/CloudSimulationModal"));

export default function RenderArtifactPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [artifact, setArtifact] = useState<ArtifactViewDTO | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isStudioSidebarOpen, setIsStudioSidebarOpen] = useState<boolean>(
    () => searchParams.get("inspector") === "1" || searchParams.get("sidebar") === "1",
  );
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [isDiffOpen, setIsDiffOpen] = useState<boolean>(false);
  const [isHpcModalOpen, setIsHpcModalOpen] = useState<boolean>(false);
  const hasCloudSolverFlag = useFeatureFlag("cae_cloud_solver");

  // Preserve clean chromeless viewport for headless Puppeteer thumbnail capture or explicit ?chromeless=1
  const isChromeless = useMemo(() => {
    const thumb = searchParams.get("thumbnail");
    const headless = searchParams.get("headless");
    const chromeless = searchParams.get("chromeless");
    return (
      thumb === "true" ||
      thumb === "1" ||
      headless === "true" ||
      headless === "1" ||
      chromeless === "true" ||
      chromeless === "1"
    );
  }, [searchParams]);

  usePageTitle(artifact ? `Artifact: ${artifact.title || artifact.view_type}` : "Render Artifact");

  const parsedArtifactId = Number(artifact?.id || id || 0);
  const viewConfig = useMemo(
    () => ({
      ...(artifact?.thumbnail_url ? { thumbnail_url: artifact.thumbnail_url } : {}),
      ...safeJsonParse<Record<string, any>>(artifact?.view_config, {}),
      artifactId: parsedArtifactId,
    }),
    [artifact, parsedArtifactId],
  );

  const handleCopyLink = useCallback(() => {
    const permalink = `${window.location.origin}/render-artifact/${parsedArtifactId || id}`;
    navigator.clipboard.writeText(permalink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }, [parsedArtifactId, id]);

  useEffect(() => {
    let cancelled = false;
    async function fetchArtifact() {
      if (!id) {
        setLoading(false);
        setError("Missing artifact ID.");
        (window as unknown as { __ARTIFACT_READY: boolean }).__ARTIFACT_READY = true;
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await getArtifactView(id);
        if (cancelled) return;
        const resolved = data?.artifactView || data?.artifact_view || data;
        if (!resolved || (!resolved.view_type && !resolved.view_config)) {
          setError(`Artifact #${id} could not be found.`);
          (window as unknown as { __ARTIFACT_READY: boolean }).__ARTIFACT_READY = true;
        } else {
          setArtifact(resolved);
        }
      } catch (err) {
        console.error("Failed to fetch artifact", err);
        if (!cancelled) {
          setError(`Failed to load artifact #${id}.`);
        }
        (window as unknown as { __ARTIFACT_READY: boolean }).__ARTIFACT_READY = true;
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    fetchArtifact();
    return () => {
      cancelled = true;
    };
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

  const resolvedForkedFromId = useMemo<number | string | null>(() => {
    if (viewConfig.forkedFromArtifactId) return viewConfig.forkedFromArtifactId;
    if (viewConfig.forked_from_artifact_id) return viewConfig.forked_from_artifact_id;
    if (viewConfig.upstreamArtifactId) return viewConfig.upstreamArtifactId;
    const anyArt = artifact as any;
    const meta = anyArt?.metadata ? safeJsonParse(anyArt.metadata, anyArt.metadata) : {};
    if (meta?.forkedFromArtifactId) return meta.forkedFromArtifactId;
    if (meta?.forked_from_artifact_id) return meta.forked_from_artifact_id;
    if (meta?.forked_from_post_id) return meta.forked_from_post_id;
    if (anyArt?.forked_from_id) return anyArt.forked_from_id;
    if (anyArt?.post?.forked_from_post_id) return anyArt.post.forked_from_post_id;
    return null;
  }, [viewConfig, artifact]);

  const [paramDeltaCount, setParamDeltaCount] = useState<number | null>(null);

  useEffect(() => {
    if (typeof viewConfig.modifiedParametersCount === "number") {
      setParamDeltaCount(viewConfig.modifiedParametersCount);
      return;
    }
    if (Array.isArray(viewConfig.parameterDeltas)) {
      setParamDeltaCount(viewConfig.parameterDeltas.length);
      return;
    }
    if (!resolvedForkedFromId) return;
    let active = true;
    async function loadDiffCount() {
      try {
        let parentArt: any = await getCachedArtifact(resolvedForkedFromId!);
        if (!parentArt) {
          const res = await getArtifactView(resolvedForkedFromId!);
          parentArt = res?.artifactView || res;
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
            if (parentParams[k] !== currentParams[k]) diffCount++;
          }
          if (active) setParamDeltaCount(diffCount);
        }
      } catch {
        // Ignore upstream diff fetch errors
      }
    }
    loadDiffCount();
    return () => {
      active = false;
    };
  }, [viewConfig.modifiedParametersCount, viewConfig.parameterDeltas, viewConfig.code, resolvedForkedFromId]);

  const handleExitFullScreen = useCallback(() => {
    const anyArt = artifact as Record<string, unknown> | null | undefined;
    const postId =
      anyArt?.["post_id"] || (anyArt?.["post"] as Record<string, unknown> | undefined)?.["id"] || viewConfig.postId;
    if (postId) {
      navigate(`/status/${String(postId)}`);
    } else if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/explore");
    }
  }, [artifact, viewConfig.postId, navigate]);

  useEffect(() => {
    if (isChromeless || !artifact) return;
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
          handleExitFullScreen();
        }
        return;
      }

      if (isEditable || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        setIsStudioSidebarOpen((prev) => !prev);
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        navigate(
          buildEditorUrlForArtifact({
            artifactId: parsedArtifactId,
            viewType: artifact.view_type,
            viewConfig,
            title: artifact.title || (artifact as any).name,
          }),
        );
      } else if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        handleCopyLink();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isChromeless, artifact, parsedArtifactId, viewConfig, navigate, handleCopyLink, handleExitFullScreen]);

  if (loading) {
    return (
      <ThemeProvider colorMode="auto">
        <BaseStyles style={{ width: "100vw", height: "100vh", overflow: "hidden", margin: 0, padding: 0 }}>
          <Box
            display="flex"
            alignItems="center"
            justifyContent="center"
            width="100%"
            height="100%"
            bg="var(--color-canvas-default)"
          >
            <Spinner size="large" />
          </Box>
        </BaseStyles>
      </ThemeProvider>
    );
  }

  if (error || !artifact) {
    return (
      <ThemeProvider colorMode="auto">
        <BaseStyles style={{ width: "100vw", height: "100vh", overflow: "hidden", margin: 0, padding: 0 }}>
          <Box
            display="flex"
            flexDirection="column"
            alignItems="center"
            justifyContent="center"
            width="100%"
            height="100%"
            bg="var(--color-canvas-default)"
            style={{ gap: "12px", padding: "24px", textAlign: "center" }}
          >
            <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--color-fg-default)" }}>
              {error || "Artifact not found"}
            </div>
            <Link
              to="/morsel"
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--color-accent-fg, #0969da)",
                textDecoration: "none",
              }}
            >
              ← Back to Morsel
            </Link>
          </Box>
        </BaseStyles>
      </ThemeProvider>
    );
  }

  const { resolvedThumbnailUrl, resolvedThumbnailUrlLight, resolvedThumbnailUrlDark } =
    resolveThumbnailUrls(viewConfig);

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

  const dispatcherElement = (
    <Suspense
      fallback={
        <Box display="flex" alignItems="center" justifyContent="center" width="100%" height="100%">
          <Spinner size="large" />
        </Box>
      }
    >
      <ViewerDispatcher
        artifact={artifact}
        artifactId={parsedArtifactId}
        viewConfig={viewConfig}
        isFullScreen={true}
        resolvedThumbnailUrl={resolvedThumbnailUrl}
        resolvedThumbnailUrlLight={resolvedThumbnailUrlLight}
        resolvedThumbnailUrlDark={resolvedThumbnailUrlDark}
      />
    </Suspense>
  );

  if (isChromeless) {
    return (
      <ThemeProvider colorMode="auto">
        <BaseStyles style={{ width: "100vw", height: "100vh", overflow: "hidden", margin: 0, padding: 0 }}>
          <Box width="100%" height="100%" bg="var(--color-canvas-default)">
            {dispatcherElement}
          </Box>
        </BaseStyles>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider colorMode="auto">
      <BaseStyles style={{ width: "100vw", height: "100vh", overflow: "hidden", margin: 0, padding: 0 }}>
        <div
          style={{
            width: "100vw",
            height: "100vh",
            backgroundColor: "#090d16",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <StudioHeader
            artifact={artifact}
            artifactId={parsedArtifactId}
            viewConfig={viewConfig}
            resolvedForkedFromId={resolvedForkedFromId}
            paramDeltaCount={paramDeltaCount}
            copiedLink={copiedLink}
            isStudioSidebarOpen={isStudioSidebarOpen}
            onExitFullScreen={handleExitFullScreen}
            onCopyLink={handleCopyLink}
            onOpenDiff={() => setIsDiffOpen(true)}
            onToggleSidebar={() => setIsStudioSidebarOpen((prev) => !prev)}
            {...(isSimulatableArtifact ? { onRunOnHpc: () => setIsHpcModalOpen(true) } : {})}
          />

          <Box flex={1} display="flex" overflow="hidden" position="relative">
            <Box flex={1} height="100%" bg="black" overflow="auto" position="relative">
              {dispatcherElement}
            </Box>

            <StudioInspectorSidebar
              isOpen={isStudioSidebarOpen}
              artifact={artifact}
              artifactId={parsedArtifactId}
              viewConfig={viewConfig}
            />
          </Box>

          {isHpcModalOpen && (
            <Suspense fallback={null}>
              <CloudSimulationModal
                isOpen={isHpcModalOpen}
                onClose={() => setIsHpcModalOpen(false)}
                artifactId={parsedArtifactId}
                artifactTitle={
                  artifact?.title || (artifact as any)?.name || viewConfig?.title || `Artifact #${parsedArtifactId}`
                }
                fileContent={viewConfig?.code || ""}
                dialect={viewConfig?.dialect || artifact?.view_type || "modelica"}
              />
            </Suspense>
          )}

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
        </div>
      </BaseStyles>
    </ThemeProvider>
  );
}
