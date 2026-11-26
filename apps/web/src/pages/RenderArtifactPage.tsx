// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  extractModelsFromCanvasDocument,
  type RotundaModelEntry,
} from "@modelscript/editor/workbench/vr-rotunda/types.js";
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
import {
  buildArtifactRotundaDocument,
  parseRotundaEnvironmentId,
  parseSurfacePresentationMode,
  resolveDefaultArtifactEnvironment,
} from "../components/artifacts/rotunda-board-adapter";
import {
  buildLiveArtifactRotundaRenderer,
  useArtifactRotundaGeometry,
} from "../components/artifacts/RotundaGeometryBridge";
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
const EngineeringRotundaLazy = React.lazy(
  () => import("@modelscript/editor/workbench/vr-rotunda/EngineeringRotunda.js"),
);

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
  const [isVrRotundaMode, setIsVrRotundaMode] = useState<boolean>(() => {
    const vr = (searchParams.get("vr") || "").toLowerCase();
    const mode = (searchParams.get("mode") || "").toLowerCase();
    return vr === "1" || vr === "true" || mode === "webxr-vr" || mode === "spatial-3d";
  });
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [isDiffOpen, setIsDiffOpen] = useState<boolean>(false);
  const [isHpcModalOpen, setIsHpcModalOpen] = useState<boolean>(false);
  const hasCloudSolverFlag = useFeatureFlag("cae_cloud_solver");

  // Preserve clean chromeless viewport for headless Puppeteer thumbnail capture, ?embed=1 blog/external embeds, or explicit ?chromeless=1
  const isChromeless = useMemo(() => {
    const thumb = searchParams.get("thumbnail");
    const headless = searchParams.get("headless");
    const chromeless = searchParams.get("chromeless");
    const embed = searchParams.get("embed");
    return (
      thumb === "true" ||
      thumb === "1" ||
      headless === "true" ||
      headless === "1" ||
      chromeless === "true" ||
      chromeless === "1" ||
      embed === "true" ||
      embed === "1"
    );
  }, [searchParams]);

  const [embedColorMode, setEmbedColorMode] = useState<"auto" | "day" | "night">(() => {
    const t = (searchParams.get("theme") || "").toLowerCase();
    if (t === "dark") return "night";
    if (t === "light") return "day";
    return "auto";
  });

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; theme?: string } | null;
      if (!data || data.type !== "SET_THEME") return;
      if (data.theme === "dark") setEmbedColorMode("night");
      else if (data.theme === "light") setEmbedColorMode("day");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  usePageTitle(artifact ? `Artifact: ${artifact.title || artifact.view_type}` : "Render Artifact");

  const parsedArtifactId = Number(artifact?.id || id || 0);
  const viewConfig = useMemo<Record<string, unknown>>(
    () => ({
      ...((artifact as unknown as { thumbnail_url?: string } | null)?.thumbnail_url
        ? { thumbnail_url: (artifact as unknown as { thumbnail_url?: string }).thumbnail_url }
        : {}),
      ...safeJsonParse<Record<string, unknown>>(artifact?.view_config, {}),
      artifactId: parsedArtifactId,
    }),
    [artifact, parsedArtifactId],
  );

  const urlWantsVrRotunda = useMemo(() => {
    const vr = (searchParams.get("vr") || "").toLowerCase();
    const mode = (searchParams.get("mode") || "").toLowerCase();
    return vr === "1" || vr === "true" || mode === "webxr-vr" || mode === "spatial-3d";
  }, [searchParams]);

  useEffect(() => {
    if (urlWantsVrRotunda) {
      setIsVrRotundaMode(true);
    }
  }, [urlWantsVrRotunda]);

  const rotundaSurfaceMode = useMemo(() => {
    const rawMode = (searchParams.get("mode") || "").toLowerCase();
    if (rawMode === "webxr-vr") return "webxr-vr" as const;
    if (rawMode === "spatial-3d") return "spatial-3d" as const;
    const vr = (searchParams.get("vr") || "").toLowerCase();
    if (vr === "1" || vr === "true") return "webxr-vr" as const;
    const parsed = parseSurfacePresentationMode(viewConfig["surfaceMode"], "spatial-3d");
    return parsed === "desktop-2d" ? "spatial-3d" : parsed;
  }, [searchParams, viewConfig]);

  const rotundaEnvironment = useMemo(
    () =>
      parseRotundaEnvironmentId(
        searchParams.get("env") ?? viewConfig["environment"] ?? viewConfig["env"],
        resolveDefaultArtifactEnvironment(artifact?.view_type, viewConfig),
      ),
    [searchParams, viewConfig, artifact?.view_type],
  );

  const rotundaDocument = useMemo(() => {
    if (!isVrRotundaMode || !artifact) return null;
    const configTitle = typeof viewConfig["title"] === "string" ? viewConfig["title"] : undefined;
    return buildArtifactRotundaDocument({
      title: artifact.title || (artifact as unknown as { name?: string }).name || configTitle,
      viewType: artifact.view_type,
      viewConfig,
      artifactId: parsedArtifactId,
    });
  }, [isVrRotundaMode, artifact, viewConfig, parsedArtifactId]);

  const geometryBridgeKey = useMemo<string | number | null>(() => {
    if (parsedArtifactId > 0) return parsedArtifactId;
    if (id && id.trim() !== "" && id.trim() !== "0") return id.trim();
    if (typeof viewConfig["url"] === "string" && viewConfig["url"].trim()) return viewConfig["url"].trim();
    return null;
  }, [parsedArtifactId, id, viewConfig]);

  const liveRotundaGeometry = useArtifactRotundaGeometry(isVrRotundaMode ? geometryBridgeKey : null);

  const rotundaModels = useMemo<readonly RotundaModelEntry[] | undefined>(() => {
    if (!rotundaDocument) return undefined;
    const baseModels = extractModelsFromCanvasDocument(rotundaDocument);
    if (!liveRotundaGeometry || baseModels.length === 0) return baseModels;
    const primary = baseModels[0]!;
    return [
      {
        ...primary,
        renderCustomContent: buildLiveArtifactRotundaRenderer(liveRotundaGeometry),
      },
      ...baseModels.slice(1),
    ];
  }, [rotundaDocument, liveRotundaGeometry]);

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
        window.__ARTIFACT_READY = true;
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
          window.__ARTIFACT_READY = true;
        } else {
          setArtifact(resolved);
        }
      } catch (err) {
        console.error("Failed to fetch artifact", err);
        if (!cancelled) {
          setError(`Failed to load artifact #${id}.`);
        }
        window.__ARTIFACT_READY = true;
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
      if (isVrRotundaMode || !heavyAsyncTypes.includes(artifact.view_type)) {
        window.__ARTIFACT_READY = true;
      }
    }
  }, [artifact, isVrRotundaMode]);

  const resolvedForkedFromId = useMemo<number | string | null>(() => {
    const asId = (val: unknown): number | string | null =>
      typeof val === "number" || (typeof val === "string" && val.length > 0) ? val : null;
    const fromCfg =
      asId(viewConfig.forkedFromArtifactId) ??
      asId(viewConfig.forked_from_artifact_id) ??
      asId(viewConfig.upstreamArtifactId);
    if (fromCfg !== null) return fromCfg;
    const artExt = artifact as
      | (ArtifactViewDTO & {
          name?: string | undefined;
          metadata?: Record<string, unknown> | string | undefined;
          forked_from_id?: number | string | undefined;
          post?: { forked_from_post_id?: number | string | undefined } | undefined;
        })
      | null;
    const rawMeta = artExt?.metadata;
    const meta: Record<string, unknown> =
      typeof rawMeta === "string"
        ? safeJsonParse<Record<string, unknown>>(rawMeta, {})
        : rawMeta && typeof rawMeta === "object"
          ? rawMeta
          : {};
    return (
      asId(meta.forkedFromArtifactId) ??
      asId(meta.forked_from_artifact_id) ??
      asId(meta.forked_from_post_id) ??
      asId(artExt?.forked_from_id) ??
      asId(artExt?.post?.forked_from_post_id) ??
      null
    );
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
        let parentArt: { view_config?: Record<string, unknown> | string | undefined } | null | undefined =
          await getCachedArtifact<{ view_config?: Record<string, unknown> | string | undefined }>(
            resolvedForkedFromId!,
          );
        if (!parentArt) {
          const res = await getArtifactView(resolvedForkedFromId!);
          parentArt = (res?.artifactView || res) as
            { view_config?: Record<string, unknown> | string | undefined } | undefined;
        }
        if (!active || !parentArt) return;
        const parentCfg: Record<string, unknown> =
          typeof parentArt.view_config === "string"
            ? safeJsonParse<Record<string, unknown>>(parentArt.view_config, {})
            : parentArt.view_config || {};
        const parentCode = typeof parentCfg.code === "string" ? parentCfg.code : "";
        const currentCode = typeof viewConfig.code === "string" ? viewConfig.code : "";
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
      } else if (!isVrRotundaMode && (e.key === "r" || e.key === "R")) {
        e.preventDefault();
        navigate(
          buildEditorUrlForArtifact({
            artifactId: parsedArtifactId,
            viewType: artifact.view_type,
            viewConfig,
            title: artifact.title || (artifact as ArtifactViewDTO & { name?: string | undefined }).name,
          }),
        );
      } else if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        handleCopyLink();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isChromeless,
    isVrRotundaMode,
    artifact,
    parsedArtifactId,
    viewConfig,
    navigate,
    handleCopyLink,
    handleExitFullScreen,
  ]);

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
              to="/editor"
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--ms-accent, var(--color-accent-fg))",
                textDecoration: "none",
              }}
            >
              ← Back to Ansatz
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
        "ansatz",
        "polyglot-ansatz",
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

  const rotundaElement =
    isVrRotundaMode && rotundaDocument ? (
      <Suspense
        fallback={
          <Box display="flex" alignItems="center" justifyContent="center" width="100%" height="100%" bg="#060b16">
            <Spinner size="large" />
          </Box>
        }
      >
        <EngineeringRotundaLazy
          document={rotundaDocument}
          models={rotundaModels}
          mode={rotundaSurfaceMode}
          initialEnvironment={rotundaEnvironment}
          onExitTo2D={() => setIsVrRotundaMode(false)}
          exitTo2DLabel="Return to Artifact"
          title={String(
            artifact.title ||
              (artifact as unknown as { name?: string }).name ||
              viewConfig["title"] ||
              `Artifact #${parsedArtifactId}`,
          )}
        />
      </Suspense>
    ) : null;

  const activeViewportElement = rotundaElement ?? dispatcherElement;

  if (isChromeless) {
    return (
      <ThemeProvider colorMode={embedColorMode}>
        <BaseStyles style={{ width: "100vw", height: "100vh", overflow: "hidden", margin: 0, padding: 0 }}>
          <Box width="100%" height="100%" bg="var(--color-canvas-default)">
            {activeViewportElement}
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
            isVrRotundaMode={isVrRotundaMode}
            onToggleVrRotunda={() => setIsVrRotundaMode((prev) => !prev)}
            onExitFullScreen={handleExitFullScreen}
            onCopyLink={handleCopyLink}
            onOpenDiff={() => setIsDiffOpen(true)}
            onToggleSidebar={() => setIsStudioSidebarOpen((prev) => !prev)}
            {...(isSimulatableArtifact ? { onRunOnHpc: () => setIsHpcModalOpen(true) } : {})}
          />

          <Box flex={1} display="flex" overflow="hidden" position="relative">
            <Box flex={1} height="100%" bg="black" overflow="auto" position="relative">
              {activeViewportElement}
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
                  artifact?.title ||
                  (artifact as (ArtifactViewDTO & { name?: string | undefined }) | null)?.name ||
                  (typeof viewConfig?.title === "string" ? viewConfig.title : undefined) ||
                  `Artifact #${parsedArtifactId}`
                }
                fileContent={typeof viewConfig?.code === "string" ? viewConfig.code : ""}
                dialect={
                  (typeof viewConfig?.dialect === "string" ? viewConfig.dialect : undefined) ||
                  artifact?.view_type ||
                  "modelica"
                }
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
