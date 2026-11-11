// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertIcon } from "@primer/octicons-react";
import { Button } from "@primer/react";
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { createArtifactView, getArtifactView, getPost } from "../api";
import { useAuth } from "../AuthContext";
import { analyzeSnippetDiagnostics } from "../components/compose/snippet-diagnostics";
import { ComposeContext } from "../components/ComposeContext";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { getLanguageInfo } from "../components/morsel/constants";
import MorselEditor from "../components/morsel/Morsel";
import { extractPrimaryModelicaClassName, installDependency } from "../components/morsel/util/lsp-bridge";
import {
  compressMorselPayload,
  decompressMorselPayload,
  resolveMorselShortlink,
} from "../components/morsel/util/permalink";
import Spinner from "../components/Spinner";
import { useToast } from "../components/ToastContext";
import { useFeatureFlag } from "../FeatureFlagContext";
import {
  getExtensionForDialect,
  inferDialectFromArtifact,
  inferDialectFromFilename,
  isMultiFileArtifact,
} from "../util/editor-routing";
import { safeJsonParse } from "../util/json";
import { usePageTitle } from "../util/title";
import {
  CreatePlaygroundRepoModal,
  DEFAULT_EMPTY_MODELICA_CODE,
  EditorArea,
  HERO_EXAMPLES,
  type HeroExample,
  type MorselDecodedPayload,
  PLAYGROUND_LANGUAGES,
  PlaygroundContainer,
  PlaygroundNavbar,
  PlaygroundShareModal,
  TemplateGalleryModal,
} from "./playground";

function mountArtifactDependencies(deps?: unknown): void {
  if (!Array.isArray(deps) || deps.length === 0) return;
  for (const dep of deps) {
    if (dep && typeof dep.name === "string" && typeof dep.version === "string") {
      installDependency(dep.name, dep.version).catch((err) => {
        console.warn(`[PlaygroundPage] Failed to auto-mount dependency ${dep.name}@${dep.version}:`, err);
      });
    }
  }
}

const TEMPLATE_ALIASES: Record<string, string> = {
  rlc: "rlc-circuit",
  rlccircuit: "rlc-circuit",
  "rlc-circuit": "rlc-circuit",
  "rlc-filter": "rlc-circuit",
  bouncingball: "bouncing-ball",
  "bouncing-ball": "bouncing-ball",
  chuacircuit: "lorenz-attractor",
  "chua-circuit": "lorenz-attractor",
  "lorenz-attractor": "lorenz-attractor",
  sysml2: "sysml-satellite",
  satellitepower: "sysml-satellite",
  "sysml-satellite": "sysml-satellite",
  "sysml2-powertrain": "sysml-satellite",
  roboticjoint: "scad-flanged-hub",
  "drone-chassis": "scad-flanged-hub",
  cad: "scad-flanged-hub",
  scad: "scad-flanged-hub",
  "scad-flanged-hub": "scad-flanged-hub",
  step: "step-aerospace-bracket",
  simpack: "simpack-pendulum",
  gensys: "gensys-bogie",
  pscad: "pscad-ieee2800-inverter",
  fea: "fea-bracket-deck",
  cfd: "cfd-rae2822-su2",
};

export const PlaygroundPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { openCompose } = useContext(ComposeContext);
  const toast = useToast();
  const { user } = useAuth();
  const hasIde = useFeatureFlag("heavy_vscode_ide");

  const modelParam = searchParams.get("model");
  const templateParam = searchParams.get("template");
  const sourceParam = searchParams.get("source");
  const fromArtifactParam = searchParams.get("fromArtifact");
  const morselParam = searchParams.get("morsel");
  const viewParam = searchParams.get("view");
  const subviewParam = searchParams.get("subview");
  const autoSimulateParam = searchParams.get("autoSimulate");
  const simVarsParam = searchParams.get("simVars") || searchParams.get("variables");
  const startTimeParam = searchParams.get("startTime");
  const stopTimeParam = searchParams.get("stopTime");
  const langParam = searchParams.get("lang") || searchParams.get("dialect") || searchParams.get("language");
  const titleParam = searchParams.get("title");
  const editPostIdParam = searchParams.get("editPostId");
  const replyToPostIdParam = searchParams.get("replyToPostId");
  const diagramTypeParam = searchParams.get("diagramType");

  const editPostId = editPostIdParam || undefined;
  const replyToPostId = replyToPostIdParam || undefined;

  const [editPostContent, setEditPostContent] = useState<string | null>(null);

  useEffect(() => {
    if (!editPostId) return;
    let mounted = true;
    getPost(editPostId)
      .then((res) => {
        if (mounted && res?.post?.content) {
          setEditPostContent(res.post.content);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [editPostId]);

  const hasInitialArtifactTarget = Boolean(
    fromArtifactParam ||
    morselParam ||
    (location.hash &&
      (location.hash.startsWith("#memfs:artifact-") ||
        location.hash.startsWith("#m=artifact-") ||
        /^#memfs:\d+$/.test(location.hash) ||
        /^#m=\d+$/.test(location.hash))),
  );

  const hasInitialTarget = Boolean(
    hasInitialArtifactTarget ||
    templateParam ||
    modelParam ||
    sourceParam ||
    location.state ||
    (location.hash && location.hash.length > 1),
  );

  const defaultInitialCode = hasInitialTarget ? "" : DEFAULT_EMPTY_MODELICA_CODE;
  const defaultInitialTitle =
    titleParam || (hasInitialArtifactTarget ? "Loading Artifact…" : hasInitialTarget ? "" : "Untitled Model");
  const defaultInitialLang = langParam || "modelica";

  const [isLoadingArtifact, setIsLoadingArtifact] = useState<boolean>(hasInitialArtifactTarget);
  const [currentCode, setCurrentCode] = useState<string>(defaultInitialCode);
  const [projectFiles, setProjectFiles] = useState<Record<string, string> | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [currentTitle, setCurrentTitle] = useState<string>(defaultInitialTitle);
  const [currentLang, setCurrentLang] = useState<string>(defaultInitialLang);
  const [resolvedFromArtifact, setResolvedFromArtifact] = useState<string | null>(fromArtifactParam);
  const [initialSimVars, setInitialSimVars] = useState<string[] | undefined>(() =>
    simVarsParam
      ? simVarsParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
  );
  const [initialStartTime, setInitialStartTime] = useState<number | undefined>(() =>
    startTimeParam ? Number(startTimeParam) : undefined,
  );
  const [initialStopTime, setInitialStopTime] = useState<number | undefined>(() =>
    stopTimeParam ? Number(stopTimeParam) : undefined,
  );
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [pendingExample, setPendingExample] = useState<HeroExample | null>(null);
  const baselineCodeRef = useRef<string>(defaultInitialCode);

  usePageTitle(currentTitle ? `${currentTitle} — Ansatz Morsel` : "Ansatz Morsel");
  const [isShareModalOpen, setShareModalOpen] = useState(false);
  const [isTemplatesModalOpen, setIsTemplatesModalOpen] = useState(false);
  const [isCreateRepoModalOpen, setIsCreateRepoModalOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const [payload, setPayload] = useState<MorselDecodedPayload | null>(null);

  useEffect(() => {
    if (fromArtifactParam) {
      setResolvedFromArtifact(fromArtifactParam);
    }
  }, [fromArtifactParam]);

  // Protect against accidental tab close or navigation when model has unsaved modifications
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  // Debounced auto-save draft to local storage so crashes or reloads can be recovered
  useEffect(() => {
    if (!isDirty || !currentCode) return;
    const timer = setTimeout(() => {
      try {
        const draftData = JSON.stringify({
          code: currentCode,
          title: currentTitle,
          lang: currentLang,
          timestamp: Date.now(),
        });
        localStorage.setItem("ansatz_morsel_draft", draftData);
        localStorage.setItem("ansatz_sketch_draft", draftData);
      } catch {}
    }, 1000);
    return () => clearTimeout(timer);
  }, [currentCode, currentTitle, currentLang, isDirty]);

  // Recover draft if opened cleanly without query parameters or initial target
  useEffect(() => {
    if (hasInitialTarget) return;
    try {
      const saved = localStorage.getItem("ansatz_morsel_draft") || localStorage.getItem("ansatz_sketch_draft");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.code && typeof parsed.code === "string" && Date.now() - (parsed.timestamp || 0) < 86_400_000) {
          setCurrentCode(parsed.code);
          baselineCodeRef.current = parsed.code;
          if (parsed.title) setCurrentTitle(parsed.title);
          if (parsed.lang) setCurrentLang(parsed.lang);
        }
      }
    } catch {}
  }, [hasInitialTarget]);

  // Initialize from URL hash, query params, location.state, ?morsel=<id>, or ?fromArtifact=<id>
  useEffect(() => {
    let cancelled = false;

    const buildIdeRedirectUrl = (artifactId: string | number) => {
      const params = new URLSearchParams();
      params.set("fromArtifact", String(artifactId));
      if (langParam) params.set("lang", langParam);
      if (titleParam) params.set("title", titleParam);
      if (editPostId) params.set("editPostId", String(editPostId));
      if (replyToPostId) {
        params.set("replyToPostId", String(replyToPostId));
      }
      const qs = params.toString();
      return `/ide${qs ? `?${qs}` : ""}#memfs:${artifactId}`;
    };

    // 0a. Check ?morsel=<id> server-side short-link
    if (morselParam) {
      setIsLoadingArtifact(true);
      (async () => {
        try {
          const resolved = await resolveMorselShortlink(morselParam, {
            fallbackDialect: langParam,
            fallbackTitle: titleParam,
            fallbackView: viewParam,
          });
          if (cancelled || !resolved) {
            if (!cancelled) {
              setIsLoadingArtifact(false);
            }
            return;
          }
          const detectedLang = resolved.lang || langParam || "modelica";
          const resolvedTitle = resolved.title || titleParam || "Shared Engineering Model";
          baselineCodeRef.current = resolved.code;
          setIsDirty(false);
          setIsLoadingArtifact(false);
          setCurrentCode(resolved.code);
          setCurrentTitle(resolvedTitle);
          setCurrentLang(detectedLang);
          if (resolved.files && Object.keys(resolved.files).length > 1) {
            setProjectFiles(resolved.files);
            setActiveFile(resolved.activeFile || Object.keys(resolved.files)[0]!);
          } else {
            setProjectFiles(null);
            setActiveFile(null);
          }
          setPayload({
            ...resolved,
            lang: detectedLang,
            title: resolvedTitle,
          });
        } catch {
          if (!cancelled) setIsLoadingArtifact(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    // 0b. Check #memfs:... hash when redirected from /ide
    let memfsArtifactId: string | null = null;
    let memfsTemplateId: string | null = null;
    let hashArtifactId: string | null = null;
    if (location.hash && location.hash.startsWith("#m=artifact-")) {
      hashArtifactId = decodeURIComponent(location.hash.slice("#m=artifact-".length));
    } else if (location.hash && /^#m=\d+$/.test(location.hash)) {
      hashArtifactId = decodeURIComponent(location.hash.slice("#m=".length));
    } else if (location.hash && location.hash.startsWith("#memfs:")) {
      const memfsTarget = decodeURIComponent(location.hash.slice("#memfs:".length));
      if (memfsTarget.startsWith("package-")) {
        const pkgName = memfsTarget.slice("package-".length);
        try {
          const rawPkg = localStorage.getItem(`modelscript.pkg.${pkgName}`);
          if (rawPkg) {
            const parsed = JSON.parse(rawPkg) as {
              name?: string;
              version?: string;
              files?: Record<string, string>;
            };
            const files = parsed?.files || {};
            const entries = Object.entries(files);
            if (entries.length > 0) {
              const preferred =
                entries.find(
                  ([k]) => /\.(mo|msx|sysml|scad|spck|gen|pscx|fea|cfd)$/i.test(k) && !/package\.mo$/i.test(k),
                ) ||
                entries.find(([k]) => /\.(mo|msx|sysml|scad|spck|gen|pscx|fea|cfd)$/i.test(k)) ||
                entries[0]!;
              const [fileName, fileCode] = preferred;
              const detectedLang = langParam || inferDialectFromFilename(fileName) || "modelica";
              const resolvedTitle = titleParam || `${parsed.name || pkgName} (${fileName})`;
              baselineCodeRef.current = fileCode;
              setIsDirty(false);
              setIsLoadingArtifact(false);
              setCurrentCode(fileCode);
              setCurrentTitle(resolvedTitle);
              setCurrentLang(detectedLang);
              if (entries.length > 1) {
                setProjectFiles(files);
                setActiveFile(fileName);
              } else {
                setProjectFiles(null);
                setActiveFile(null);
              }
              setPayload({
                v: 1,
                lang: detectedLang,
                code: fileCode,
                ...(entries.length > 1 ? { files, activeFile: fileName, isMultiFile: true } : {}),
                title: resolvedTitle,
              });
              return;
            }
          }
        } catch {
          // Ignore malformed localStorage package payload
        }
      } else if (memfsTarget.startsWith("artifact-") || /^\d+$/.test(memfsTarget)) {
        memfsArtifactId = memfsTarget.startsWith("artifact-") ? memfsTarget.slice("artifact-".length) : memfsTarget;
        try {
          const scratchRaw = sessionStorage.getItem("modelscript.artifact_scratch");
          if (scratchRaw) {
            const scratch = JSON.parse(scratchRaw) as {
              id?: string | number;
              title?: string;
              language?: string;
              code?: string;
              files?: Record<string, string>;
            };
            const scratchFiles =
              scratch.files && typeof scratch.files === "object" && !Array.isArray(scratch.files)
                ? scratch.files
                : undefined;
            const firstFileName = scratchFiles ? Object.keys(scratchFiles)[0] : undefined;
            const firstFile = scratch.code || (firstFileName && scratchFiles ? scratchFiles[firstFileName] : undefined);
            if (firstFile && (!scratch.id || String(scratch.id) === memfsArtifactId)) {
              const resolvedTitle = titleParam || scratch.title || `Workspace #${memfsArtifactId}`;
              const detectedLang =
                langParam || scratch.language || inferDialectFromFilename(firstFileName || resolvedTitle) || "modelica";
              setResolvedFromArtifact(memfsArtifactId);
              baselineCodeRef.current = firstFile;
              setIsDirty(false);
              setIsLoadingArtifact(false);
              setCurrentCode(firstFile);
              setCurrentTitle(resolvedTitle);
              setCurrentLang(detectedLang);
              if (scratchFiles && Object.keys(scratchFiles).length > 1) {
                setProjectFiles(scratchFiles);
                setActiveFile(firstFileName!);
              } else {
                setProjectFiles(null);
                setActiveFile(null);
              }
              setPayload({
                v: 1,
                lang: detectedLang,
                code: firstFile,
                ...(scratchFiles && Object.keys(scratchFiles).length > 1
                  ? { files: scratchFiles, activeFile: firstFileName, isMultiFile: true }
                  : {}),
                title: resolvedTitle,
              });
              return;
            }
          }
        } catch {
          // Fall through to API artifact load
        }
      } else if (memfsTarget) {
        memfsTemplateId = memfsTarget;
      }
    }

    // 1. Check URL hash (#m=...)
    if (
      location.hash &&
      location.hash.length > 1 &&
      !location.hash.startsWith("#memfs:") &&
      !location.hash.startsWith("#m=artifact-") &&
      !/^#m=\d+$/.test(location.hash)
    ) {
      const p = decompressMorselPayload(location.hash) as
        | (MorselDecodedPayload & {
            files?: Record<string, string>;
            activeFile?: string;
            isMultiFile?: boolean;
            artifactId?: string | number;
          })
        | null;

      if (p) {
        if (hasIde && p.isMultiFile && (p.artifactId || fromArtifactParam)) {
          navigate(buildIdeRedirectUrl((p.artifactId || fromArtifactParam)!), { replace: true });
          return;
        }
        if (p.artifactId && !fromArtifactParam) {
          setResolvedFromArtifact(String(p.artifactId));
        }
        if (p.code) {
          const detectedLang =
            p.lang || langParam || inferDialectFromFilename(p.activeFile || p.title || titleParam) || "modelica";
          baselineCodeRef.current = p.code;
          setIsDirty(false);
          setIsLoadingArtifact(false);
          if (p.files && typeof p.files === "object" && Object.keys(p.files).length > 1) {
            setProjectFiles(p.files);
            setActiveFile(p.activeFile || Object.keys(p.files)[0]!);
          } else {
            setProjectFiles(null);
            setActiveFile(null);
          }
          setPayload({ ...p, lang: detectedLang, ...(viewParam && !p.view ? { view: viewParam } : {}) });
          setCurrentCode(p.code);
          setCurrentLang(detectedLang);
          if (p.title || titleParam) {
            setCurrentTitle((p.title || titleParam)!);
          }
          if (p.sim?.variables && p.sim.variables.length > 0) {
            setInitialSimVars(p.sim.variables);
          }
          if (typeof p.sim?.startTime === "number") {
            setInitialStartTime(p.sim.startTime);
          }
          if (typeof p.sim?.stopTime === "number") {
            setInitialStopTime(p.sim.stopTime);
          }
          if (p.dependencies) {
            mountArtifactDependencies(p.dependencies);
          }
          return;
        }
      }
    }

    // 2. Check ?source=... query parameter
    if (sourceParam) {
      const title = titleParam || "Custom Model";
      const detectedLang = langParam || inferDialectFromFilename(title) || "modelica";
      baselineCodeRef.current = sourceParam;
      setIsDirty(false);
      setIsLoadingArtifact(false);
      setCurrentCode(sourceParam);
      setCurrentTitle(title);
      setCurrentLang(detectedLang);
      setPayload({
        v: 1,
        lang: detectedLang,
        code: sourceParam,
        title,
      });
      const hash = compressMorselPayload({
        v: 1,
        lang: detectedLang,
        code: sourceParam,
        title,
        ...(fromArtifactParam ? { artifactId: fromArtifactParam } : {}),
      });
      window.history.replaceState(window.history.state, "", `${location.pathname}${location.search}#m=${hash}`);
      return;
    }

    // 3. Check location.state ({ code, language, dialect, title }) from viewer "Simulate" buttons (e.g. SimpackViewer, GensysViewer)
    const navState = location.state as {
      code?: string;
      language?: string;
      dialect?: string;
      title?: string;
      artifactId?: string | number;
    } | null;
    if (navState && typeof navState.code === "string" && navState.code.trim().length > 0) {
      const detectedLang =
        navState.language || navState.dialect || langParam || inferDialectFromFilename(navState.title) || "modelica";
      const title = navState.title || titleParam || `${detectedLang.toUpperCase()} Simulation`;
      if (navState.artifactId && !fromArtifactParam) {
        setResolvedFromArtifact(String(navState.artifactId));
      }
      baselineCodeRef.current = navState.code;
      setIsDirty(false);
      setIsLoadingArtifact(false);
      setCurrentCode(navState.code);
      setCurrentTitle(title);
      setCurrentLang(detectedLang);
      setPayload({
        v: 1,
        lang: detectedLang,
        code: navState.code,
        title,
      });
      const hash = compressMorselPayload({
        v: 1,
        lang: detectedLang,
        code: navState.code,
        title,
      });
      window.history.replaceState(window.history.state, "", `${location.pathname}${location.search}#m=${hash}`);
      return;
    }

    // 4. Check ?fromArtifact=<id> (or #memfs:artifact-<id> or #m=artifact-<id>)
    const effectiveArtifactId = fromArtifactParam || memfsArtifactId || hashArtifactId;
    if (effectiveArtifactId) {
      setResolvedFromArtifact(effectiveArtifactId);
      setIsLoadingArtifact(true);
      (async () => {
        try {
          const res = await getArtifactView(effectiveArtifactId);
          if (cancelled) return;
          const art = res?.artifactView || res;
          if (!art) {
            toast.error("Failed to load model into Morsel");
            setCurrentCode((prev) => prev || HERO_EXAMPLES[0]!.code);
            setCurrentTitle((prev) => (prev === "Loading Artifact…" ? HERO_EXAMPLES[0]!.title : prev));
            return;
          }

          if (hasIde && isMultiFileArtifact(art)) {
            navigate(buildIdeRedirectUrl(effectiveArtifactId), { replace: true });
            return;
          }

          const cfg = typeof art.view_config === "string" ? safeJsonParse(art.view_config, {}) : art.view_config || {};

          let code: string = cfg.code || cfg.modelicaCode || cfg.source || cfg.content || "";
          const filesMap =
            cfg.files && typeof cfg.files === "object" && !Array.isArray(cfg.files)
              ? (cfg.files as Record<string, string>)
              : null;
          let resolvedActiveFile: string | null = null;

          if (filesMap && Object.keys(filesMap).length > 0) {
            const entries = Object.entries(filesMap);
            const preferred =
              entries.find(
                ([k]) =>
                  /\.(mo|msx|sysml|scad|spck|gen|pscx|fea|cfd|step|stp|inp|cfg)$/i.test(k) && !/package\.mo$/i.test(k),
              ) || entries[0]!;
            resolvedActiveFile = preferred[0];
            if (!code && typeof preferred[1] === "string") {
              code = preferred[1];
            }
          }

          if (!code && typeof cfg.url === "string" && cfg.url.trim()) {
            try {
              const fileRes = await fetch(cfg.url);
              if (fileRes.ok) {
                code = await fileRes.text();
              }
            } catch {
              // Ignore fetch failure for external URL
            }
          }

          if (cancelled) return;

          const resolvedTitle =
            titleParam ||
            art.title ||
            cfg.title ||
            cfg.modelName ||
            cfg.projectTitle ||
            `Artifact #${effectiveArtifactId}`;
          const detectedLang =
            langParam ||
            (resolvedActiveFile ? inferDialectFromFilename(resolvedActiveFile) : null) ||
            inferDialectFromArtifact(art, resolvedTitle);

          setCurrentTitle(resolvedTitle);
          setCurrentLang(detectedLang);
          if (filesMap && Object.keys(filesMap).length > 1) {
            setProjectFiles(filesMap);
            setActiveFile(resolvedActiveFile || Object.keys(filesMap)[0]!);
          } else {
            setProjectFiles(null);
            setActiveFile(null);
          }
          if (code) {
            baselineCodeRef.current = code;
            setIsDirty(false);
            setCurrentCode(code);
            const isMulti = Boolean(filesMap && Object.keys(filesMap).length > 1);
            const rawDeps = cfg.dependencies || art.dependencies;
            const dependencies = Array.isArray(rawDeps) && rawDeps.length > 0 ? rawDeps : undefined;
            if (dependencies) {
              mountArtifactDependencies(dependencies);
            }
            const simPreview = cfg.simulationPreview;
            const previewVars =
              (Array.isArray(simPreview?.states) && simPreview.states.length > 0
                ? simPreview.states
                : Array.isArray(cfg.simulationVariables) && cfg.simulationVariables.length > 0
                  ? cfg.simulationVariables
                  : Array.isArray(cfg.states) && cfg.states.length > 0
                    ? cfg.states
                    : undefined) ||
              (simVarsParam
                ? simVarsParam
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                : undefined);
            if (previewVars && previewVars.length > 0) {
              setInitialSimVars(previewVars);
            }
            if (typeof simPreview?.startTime === "number") {
              setInitialStartTime(simPreview.startTime);
            }
            const artifactDiagramType =
              diagramTypeParam ||
              (payload as any)?.diagramType ||
              cfg.diagramType ||
              (cfg.diagramMode === "ibd" ? "IBD" : cfg.diagramMode === "bdd" ? "BDD" : undefined) ||
              (detectedLang === "sysml2" &&
              (cfg.rootPartDef || (Array.isArray(cfg.parts) && cfg.parts.length > 0) || !cfg.diagramType)
                ? "IBD"
                : undefined);

            setPayload({
              v: 1,
              lang: detectedLang,
              code,
              ...(isMulti && filesMap
                ? { files: filesMap, activeFile: resolvedActiveFile || undefined, isMultiFile: true }
                : {}),
              ...(viewParam ? { view: viewParam } : {}),
              title: resolvedTitle,
              ...(dependencies ? { dependencies } : {}),
              ...(artifactDiagramType ? { diagramType: artifactDiagramType } : {}),
            });
            const hash = compressMorselPayload({
              v: 1,
              lang: detectedLang,
              code,
              ...(isMulti && filesMap
                ? { files: filesMap, activeFile: resolvedActiveFile || undefined, isMultiFile: true }
                : {}),
              ...(viewParam ? { view: viewParam } : {}),
              title: resolvedTitle,
              artifactId: String(effectiveArtifactId),
              ...(dependencies ? { dependencies } : {}),
              ...(artifactDiagramType ? { diagramType: artifactDiagramType } : {}),
            });
            window.history.replaceState(window.history.state, "", `${location.pathname}${location.search}#m=${hash}`);
          } else {
            const fallbackCode = getLanguageInfo(detectedLang)?.defaultCode || HERO_EXAMPLES[0]!.code;
            baselineCodeRef.current = fallbackCode;
            setIsDirty(false);
            setCurrentCode(fallbackCode);
            setPayload((prev) => ({
              ...(prev || { v: 1 }),
              lang: detectedLang,
              title: resolvedTitle,
            }));
          }
        } catch (err) {
          console.warn("[PlaygroundPage] Failed to load artifact from ?fromArtifact=", effectiveArtifactId, err);
          if (!cancelled) {
            toast.error("Failed to load model into Morsel");
            setCurrentCode((prev) => prev || HERO_EXAMPLES[0]!.code);
            setCurrentTitle((prev) => (prev === "Loading Artifact…" ? HERO_EXAMPLES[0]!.title : prev));
          }
        } finally {
          if (!cancelled) {
            setIsLoadingArtifact(false);
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    setIsLoadingArtifact(false);

    // 5. Check ?template=<id> or ?model=<name> or #memfs:<templateId>
    const effectiveModelOrTemplate = templateParam || memfsTemplateId || modelParam;
    if (effectiveModelOrTemplate) {
      const normalizedKey = TEMPLATE_ALIASES[effectiveModelOrTemplate.toLowerCase()] || effectiveModelOrTemplate;
      const match =
        HERO_EXAMPLES.find(
          (ex) =>
            ex.id.toLowerCase() === normalizedKey.toLowerCase() ||
            ex.id.toLowerCase() === effectiveModelOrTemplate.toLowerCase() ||
            ex.title.toLowerCase().includes(effectiveModelOrTemplate.toLowerCase()),
        ) ?? HERO_EXAMPLES[0];
      if (match) {
        baselineCodeRef.current = match.code;
        setIsDirty(false);
        setProjectFiles(null);
        setActiveFile(null);
        setCurrentCode(match.code);
        setCurrentTitle(match.title);
        setCurrentLang(match.lang);
        setPayload({
          v: 1,
          lang: match.lang,
          code: match.code,
          title: match.title,
        });
        const hash = compressMorselPayload({
          v: 1,
          lang: match.lang,
          code: match.code,
          title: match.title,
        });
        window.history.replaceState(window.history.state, "", `${location.pathname}${location.search}#m=${hash}`);
      }
      return;
    }

    // 6. If only ?lang= or ?title= was passed
    if (langParam) {
      setCurrentLang(langParam);
      const matchingExample = HERO_EXAMPLES.find((ex) => ex.lang === langParam);
      const langInfo = getLanguageInfo(langParam);
      const langOpt = PLAYGROUND_LANGUAGES.find((l) => l.id === langParam);
      const nextCode = matchingExample?.code || langInfo?.defaultCode;
      const nextTitle = titleParam || matchingExample?.title || langOpt?.label || langInfo?.name;
      if (nextCode) {
        baselineCodeRef.current = nextCode;
        setIsDirty(false);
        setProjectFiles(null);
        setActiveFile(null);
        setCurrentCode(nextCode);
        if (nextTitle) setCurrentTitle(nextTitle);
        setPayload({
          v: 1,
          lang: langParam,
          code: nextCode,
          title: nextTitle,
        });
      } else if (titleParam) {
        setCurrentTitle(titleParam);
      }
    } else if (titleParam) {
      setCurrentTitle(titleParam);
    } else if (!hasInitialTarget) {
      baselineCodeRef.current = DEFAULT_EMPTY_MODELICA_CODE;
      setIsDirty(false);
      setProjectFiles(null);
      setActiveFile(null);
      setCurrentCode(DEFAULT_EMPTY_MODELICA_CODE);
      setCurrentTitle("Untitled Model");
      setCurrentLang("modelica");
      setPayload({
        v: 1,
        lang: "modelica",
        code: DEFAULT_EMPTY_MODELICA_CODE,
        title: "Untitled Model",
      });
    }

    return () => {
      cancelled = true;
    };
  }, [
    location.hash,
    location.pathname,
    location.search,
    location.state,
    modelParam,
    templateParam,
    sourceParam,
    fromArtifactParam,
    morselParam,
    viewParam,
    langParam,
    titleParam,
    editPostId,
    replyToPostId,
    hasIde,
    navigate,
    toast,
  ]);

  useEffect(() => {
    const handleOpenShare = () => setShareModalOpen(true);
    window.addEventListener("modelscript:open-share-modal", handleOpenShare);
    return () => window.removeEventListener("modelscript:open-share-modal", handleOpenShare);
  }, []);

  const applySelectedExample = (ex: HeroExample) => {
    baselineCodeRef.current = ex.code;
    setIsDirty(false);
    setProjectFiles(null);
    setActiveFile(null);
    setCurrentCode(ex.code);
    setCurrentTitle(ex.title);
    setCurrentLang(ex.lang);
    setPayload({
      v: 1,
      lang: ex.lang,
      code: ex.code,
      title: ex.title,
    });
    const hash = compressMorselPayload({
      v: 1,
      lang: ex.lang,
      code: ex.code,
      title: ex.title,
    });
    window.history.replaceState(window.history.state, "", `${location.pathname}${location.search}#m=${hash}`);
  };

  const handleSelectExample = (ex: HeroExample) => {
    if (isDirty && ex.code !== currentCode) {
      setPendingExample(ex);
      return;
    }
    applySelectedExample(ex);
  };

  const handleSelectLang = (nextLang: string) => {
    if (nextLang === currentLang) return;
    if (
      isDirty &&
      typeof window !== "undefined" &&
      !window.confirm("You have unsaved changes. Switch language and discard changes?")
    ) {
      return;
    }
    setCurrentLang(nextLang);
    setProjectFiles(null);
    setActiveFile(null);
    const nextStarter = HERO_EXAMPLES.find((ex) => ex.lang === nextLang);
    const langInfo = getLanguageInfo(nextLang);
    const langOpt = PLAYGROUND_LANGUAGES.find((l) => l.id === nextLang);
    const nextCode = nextStarter?.code || langInfo?.defaultCode || currentCode;
    const nextTitle = nextStarter?.title || langOpt?.label || langInfo?.label || langInfo?.name || currentTitle;

    baselineCodeRef.current = nextCode;
    setIsDirty(false);
    if (nextCode !== currentCode) setCurrentCode(nextCode);
    if (nextTitle !== currentTitle) setCurrentTitle(nextTitle);

    setPayload((prev) => ({
      ...(prev || { v: 1 }),
      lang: nextLang,
      code: nextCode,
      title: nextTitle,
    }));

    const hash = compressMorselPayload({
      v: 1,
      lang: nextLang,
      code: nextCode,
      title: nextTitle,
      ...(resolvedFromArtifact ? { artifactId: resolvedFromArtifact } : {}),
    });
    window.history.replaceState(window.history.state, "", `${location.pathname}${location.search}#m=${hash}`);
  };

  const handleOpenInVsCode = () => {
    const params = new URLSearchParams();
    params.set("source", currentCode);
    params.set("title", currentTitle);
    params.set("lang", currentLang);
    if (resolvedFromArtifact) {
      params.set("fromArtifact", resolvedFromArtifact);
    }
    if (editPostId) {
      params.set("editPostId", String(editPostId));
    }
    if (replyToPostId) {
      params.set("replyToPostId", String(replyToPostId));
    }
    navigate(`/ide?${params.toString()}`);
  };

  const getShareUrl = () => {
    const isMulti = Boolean(projectFiles && Object.keys(projectFiles).length > 1);
    const hasParams = Boolean(payload?.params && Object.keys(payload.params).length > 0);
    const hash = compressMorselPayload({
      v: 1,
      lang: currentLang,
      code: currentCode,
      ...(isMulti && projectFiles
        ? { files: projectFiles, activeFile: activeFile || undefined, isMultiFile: true }
        : {}),
      ...(hasParams && payload?.params ? { params: payload.params } : {}),
      title: currentTitle,
      view: payload?.view,
      anchor: payload?.anchor,
      ...(resolvedFromArtifact ? { artifactId: resolvedFromArtifact } : {}),
    });
    const basePath = location.pathname.startsWith("/playground")
      ? "/playground"
      : location.pathname.startsWith("/sketch")
        ? "/sketch"
        : "/morsel";
    return `${window.location.origin}${basePath}#m=${hash}`;
  };

  const getEmbedCode = (format: "iframe" | "custom-tag" | "morsel-tag" = "iframe") => {
    const isMulti = Boolean(projectFiles && Object.keys(projectFiles).length > 1);
    const hasParams = Boolean(payload?.params && Object.keys(payload.params).length > 0);
    const hash = compressMorselPayload({
      v: 1,
      lang: currentLang,
      code: currentCode,
      ...(isMulti && projectFiles
        ? { files: projectFiles, activeFile: activeFile || undefined, isMultiFile: true }
        : {}),
      ...(hasParams && payload?.params ? { params: payload.params } : {}),
      title: currentTitle,
      view: payload?.view,
      anchor: payload?.anchor,
      ...(resolvedFromArtifact ? { artifactId: resolvedFromArtifact } : {}),
    });
    const embedBase = location.pathname.startsWith("/playground")
      ? "/embed/playground"
      : location.pathname.startsWith("/sketch")
        ? "/embed/sketch"
        : "/embed/morsel";
    const embedSrc = `${window.location.origin}${embedBase}#m=${hash}`;
    if (format === "morsel-tag") {
      return `<script type="module" src="https://cdn.modelscript.org/embed/v1/modelscript-embed.js"></script>\n<modelscript-morsel src="${embedSrc}" height="500px" theme="dark"></modelscript-morsel>`;
    }
    if (format === "custom-tag") {
      const anchorAttr = payload?.anchor?.elementId ? ` anchor="${payload.anchor.elementId}"` : "";
      return `<script type="module" src="${window.location.origin}/static/embed.js"></script>\n<modelscript-viewer dialect="${currentLang}" view="${payload?.view || "diagram"}"${anchorAttr}>\n${currentCode}\n</modelscript-viewer>`;
    }
    return `<iframe src="${embedSrc}" width="100%" height="600" frameborder="0" allow="clipboard-write"></iframe>`;
  };

  const getMarkdownBadge = () => {
    const url = getShareUrl();
    return `[![Open in Ansatz Morsel](https://img.shields.io/badge/Ansatz-Morsel-0284c7?style=flat&logo=codefactor)](${url})`;
  };

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(label);
      toast.success(`${label} copied to clipboard!`);
      setTimeout(() => setCopyStatus(null), 2000);
    } catch {
      toast.error(`Failed to copy ${label}`);
    }
  };

  const handlePublishToFeed = () => {
    const effectiveArtifactId = resolvedFromArtifact || null;

    const defaultContent = editPostId
      ? (editPostContent ?? undefined)
      : replyToPostId
        ? `Here is my updated **${currentTitle}** (${currentLang.toUpperCase()}) model:`
        : effectiveArtifactId
          ? `Forked and modified **${currentTitle}** (from Workspace #${effectiveArtifactId})! 🚀`
          : `Check out my simulation model: **${currentTitle}**! 🚀`;

    const isMulti = Boolean(projectFiles && Object.keys(projectFiles).length > 1);
    const composePayload: any = {
      ...(defaultContent !== undefined ? { content: defaultContent } : {}),
      morselPayload: {
        code: currentCode,
        title: currentTitle,
        dialect: currentLang,
        isMultiFile: isMulti,
        ...(isMulti && projectFiles ? { files: projectFiles } : {}),
        ...(effectiveArtifactId ? { forkedFromArtifactId: effectiveArtifactId } : {}),
      },
      forkedFromArtifactId: effectiveArtifactId,
      ...(editPostId ? { editPostId } : {}),
      ...(replyToPostId ? { replyToPostId, replyToPost: { id: replyToPostId } } : {}),
    };

    if (openCompose) {
      openCompose(composePayload);
    } else {
      window.dispatchEvent(new CustomEvent("modelscript:open-compose", { detail: composePayload }));
    }
  };

  const handleDownloadModel = () => {
    const ext = getExtensionForDialect(currentLang);
    const blob = new Blob([currentCode], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const baseName = currentTitle.replace(/[^a-zA-Z0-9_-]/g, "_") || "model";
    a.download = baseName.endsWith(ext) ? baseName : `${baseName}${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveToArtifact = async () => {
    if (!user) {
      toast.toast({
        type: "warning",
        title: "Sign in required",
        message: "Please sign in to save models to your Ansatz artifacts library.",
        action: {
          label: "Sign In",
          onClick: () => navigate("/login"),
        },
      });
      return;
    }
    try {
      const isMulti = Boolean(projectFiles && Object.keys(projectFiles).length > 1);
      const created = await createArtifactView({
        artifact_type: currentLang === "modelica" ? "modelica-diagram" : currentLang,
        dialect: currentLang,
        title: currentTitle || "Untitled Model",
        view_config: JSON.stringify({
          code: currentCode,
          title: currentTitle,
          dialect: currentLang,
          view: currentView,
          ...(isMulti && projectFiles ? { files: projectFiles } : {}),
        }),
      });
      if (created?.id) {
        setResolvedFromArtifact(String(created.id));
        setIsDirty(false);
        toast.toast({
          type: "success",
          title: "Saved to Ansatz",
          message: `Saved "${currentTitle}" as Ansatz Artifact #${created.id}.`,
          action: {
            label: "Open Artifact",
            onClick: () => navigate(`/morsel?fromArtifact=${created.id}`),
          },
        });
      }
    } catch (err: any) {
      console.error("Failed to save artifact:", err);
      toast.error(err?.response?.data?.error || err?.message || "Failed to save artifact.");
    }
  };

  const handleOpenCreateRepo = () => {
    if (!user) {
      toast.toast({
        type: "warning",
        title: "Sign in required",
        message: "Please sign in to create version-controlled repositories.",
        action: {
          label: "Sign In",
          onClick: () => navigate("/login"),
        },
      });
      return;
    }
    setIsCreateRepoModalOpen(true);
  };

  const handleRepoCreated = (repoFullName: string) => {
    toast.toast({
      type: "success",
      title: "Repository Created",
      message: `Repository "${repoFullName}" is ready on Ansatz.`,
      action: {
        label: "Go to Repository",
        onClick: () => navigate(`/repos/${repoFullName}`),
      },
    });
  };

  const handleTitleChange = (nextTitle: string) => {
    setCurrentTitle(nextTitle);
    const isMulti = Boolean(projectFiles && Object.keys(projectFiles).length > 1);
    setPayload((prev) => ({
      ...(prev || { v: 1 }),
      lang: currentLang,
      code: currentCode,
      ...(isMulti && projectFiles
        ? { files: projectFiles, activeFile: activeFile || undefined, isMultiFile: true }
        : {}),
      title: nextTitle,
    }));
    const hash = compressMorselPayload({
      v: 1,
      lang: currentLang,
      code: currentCode,
      ...(isMulti && projectFiles
        ? { files: projectFiles, activeFile: activeFile || undefined, isMultiFile: true }
        : {}),
      title: nextTitle,
      view: payload?.view,
      anchor: payload?.anchor,
      ...(resolvedFromArtifact ? { artifactId: resolvedFromArtifact } : {}),
    });
    window.history.replaceState(window.history.state, "", `${location.pathname}${location.search}#m=${hash}`);
  };

  const handleClassLoaded = (loadedCode: string, loadedClassName: string, loadedDialect: string) => {
    const nextTitle = loadedClassName.split(".").pop() || loadedClassName || currentTitle;
    const nextLang = loadedDialect || currentLang;
    baselineCodeRef.current = loadedCode;
    setIsDirty(false);
    setProjectFiles(null);
    setActiveFile(null);
    if (nextLang !== currentLang) {
      setCurrentLang(nextLang);
    }
    setCurrentCode(loadedCode);
    setCurrentTitle(nextTitle);
    setPayload((prev) => ({
      ...(prev || { v: 1 }),
      lang: nextLang,
      code: loadedCode,
      title: nextTitle,
    }));
    const hash = compressMorselPayload({
      v: 1,
      lang: nextLang,
      code: loadedCode,
      title: nextTitle,
      view: payload?.view,
      ...(resolvedFromArtifact ? { artifactId: resolvedFromArtifact } : {}),
    });
    window.history.replaceState(window.history.state, "", `${location.pathname}${location.search}#m=${hash}`);
  };

  const handleCodeChange = (nextCode: string) => {
    if (nextCode !== currentCode && nextCode !== baselineCodeRef.current) {
      setIsDirty(true);
    } else if (nextCode === baselineCodeRef.current) {
      setIsDirty(false);
    }
    setCurrentCode(nextCode);
    if (projectFiles && activeFile) {
      setProjectFiles((prev) => (prev ? { ...prev, [activeFile]: nextCode } : prev));
    }
  };

  const handleSwitchProjectFile = (fileName: string) => {
    if (!projectFiles || fileName === activeFile || !(fileName in projectFiles)) return;
    const updatedFiles = activeFile ? { ...projectFiles, [activeFile]: currentCode } : projectFiles;
    const nextCode = updatedFiles[fileName] || "";
    const nextDialect = inferDialectFromFilename(fileName) || currentLang;
    setProjectFiles(updatedFiles);
    setActiveFile(fileName);
    setCurrentCode(nextCode);
    setCurrentLang(nextDialect);
  };

  type PlaygroundView = "diagram" | "code" | "split" | "simulation" | "3d" | "inspector";
  const [currentView, setCurrentView] = useState<PlaygroundView>(
    viewParam === "code" ||
      viewParam === "simulation" ||
      viewParam === "split" ||
      viewParam === "3d" ||
      viewParam === "inspector"
      ? (viewParam as PlaygroundView)
      : "diagram",
  );
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  useEffect(() => {
    const handleSidebarChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ open?: boolean }>;
      if (typeof customEvent.detail?.open === "boolean") {
        setIsSidebarOpen(customEvent.detail.open);
      }
    };
    window.addEventListener("morsel:sidebar-changed", handleSidebarChange);
    return () => window.removeEventListener("morsel:sidebar-changed", handleSidebarChange);
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setIsSidebarOpen((v) => !v);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("morsel:toggle-sidebar"));
    }
  }, []);
  const [simulateTriggerCount, setSimulateTriggerCount] = useState<number>(() => (autoSimulateParam === "1" ? 1 : 0));
  const [isSimulating, setIsSimulating] = useState(false);

  // If autoSimulate=1 is requested and artifact loads, ensure simulateTriggerCount is at least 1
  useEffect(() => {
    if (autoSimulateParam === "1" && currentCode) {
      setSimulateTriggerCount((c) => Math.max(1, c));
    }
  }, [autoSimulateParam, currentCode]);

  const compilerDiagnostics = useMemo(() => {
    return analyzeSnippetDiagnostics(currentCode, currentLang);
  }, [currentCode, currentLang]);

  const compilerErrorCount = useMemo(() => {
    return compilerDiagnostics.filter((d) => d.severity === "error").length;
  }, [compilerDiagnostics]);

  const handleActiveViewChange = useCallback(
    (nextView: "diagram" | "simulation" | "3d" | "inspector" | "code" | "split") => {
      setCurrentView((prev) => (prev === nextView ? prev : (nextView as any)));
      setPayload((prev) => {
        if (prev?.view === nextView) return prev;
        return {
          ...(prev || { v: 1 }),
          lang: currentLang,
          code: currentCode,
          title: currentTitle,
          view: nextView,
        };
      });
    },
    [setCurrentView, currentLang, currentCode, currentTitle],
  );

  const handleViewChange = useCallback(
    (nextView: "diagram" | "code" | "split" | "simulation" | "3d" | "inspector") => {
      handleActiveViewChange(nextView);
    },
    [handleActiveViewChange],
  );

  const handleRunSimulation = useCallback(() => {
    if (currentView !== "simulation" && currentView !== "split") {
      setCurrentView("simulation");
      handleActiveViewChange("simulation");
    }
    setSimulateTriggerCount((c) => c + 1);
  }, [currentView, handleActiveViewChange, setCurrentView]);

  // Desktop-grade global keyboard shortcuts for workbench view navigation and actions
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInputFocused =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          target.classList.contains("inputarea") ||
          Boolean(target.closest(".monaco-editor")));

      // F5 or Shift+Enter to run simulation
      if (e.key === "F5" || (e.shiftKey && e.key === "Enter" && !isInputFocused)) {
        e.preventDefault();
        handleRunSimulation();
        return;
      }

      // Ctrl+B / Cmd+B to toggle libraries sidebar
      if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        handleToggleSidebar();
        return;
      }

      // Ctrl+O / Cmd+O to open template gallery
      if ((e.ctrlKey || e.metaKey) && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        setIsTemplatesModalOpen(true);
        return;
      }

      // Alt+1..6 / Option+1..6 for workbench views
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        if (e.key === "1") {
          e.preventDefault();
          handleViewChange("diagram");
        } else if (e.key === "2") {
          e.preventDefault();
          handleViewChange("3d");
        } else if (e.key === "3") {
          e.preventDefault();
          handleViewChange("simulation");
        } else if (e.key === "4") {
          e.preventDefault();
          handleViewChange("inspector");
        } else if (e.key === "5") {
          e.preventDefault();
          handleViewChange("code");
        } else if (e.key === "6") {
          e.preventDefault();
          handleViewChange("split");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleRunSimulation, handleToggleSidebar, handleViewChange]);

  const handleParametersChange = (nextParams: Record<string, number>) => {
    setPayload((prev) => {
      const normalized = Object.keys(nextParams).length > 0 ? nextParams : undefined;
      if (JSON.stringify(prev?.params) === JSON.stringify(normalized)) return prev;
      return {
        ...(prev || { v: 1 }),
        lang: currentLang,
        code: currentCode,
        title: currentTitle,
        ...(normalized ? { params: normalized } : { params: undefined }),
      };
    });
  };

  const publishLabel = editPostId
    ? "Save Post Edit"
    : replyToPostId
      ? "Reply to Post"
      : resolvedFromArtifact
        ? "Post your fork"
        : "Post";

  return (
    <PlaygroundContainer>
      <PlaygroundNavbar
        fromArtifactParam={resolvedFromArtifact}
        currentTitle={currentTitle}
        currentLang={currentLang}
        currentView={currentView}
        isDirty={isDirty}
        isSimulating={isSimulating}
        runStatus={{
          state: compilerErrorCount > 0 ? "error" : isSimulating ? "compiling" : "ok",
          errors: compilerErrorCount,
        }}
        onOpenProblems={() => {
          handleViewChange("code");
        }}
        publishLabel={publishLabel}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={handleToggleSidebar}
        onTitleChange={handleTitleChange}
        onSelectExample={handleSelectExample}
        onSelectLang={handleSelectLang}
        onViewChange={handleViewChange}
        onSimulate={handleRunSimulation}
        onOpenInVsCode={handleOpenInVsCode}
        onOpenTemplates={() => setIsTemplatesModalOpen(true)}
        onSaveToArtifact={handleSaveToArtifact}
        onCreateRepo={handleOpenCreateRepo}
        onDownloadModel={handleDownloadModel}
        onCopyEmbed={() => handleCopy(getEmbedCode(), "Embed Code")}
        onOpenShare={() => setShareModalOpen(true)}
        onPublishToFeed={handlePublishToFeed}
      />

      {projectFiles && Object.keys(projectFiles).length > 1 && (
        <div
          role="tablist"
          aria-label="Project files"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 12px",
            backgroundColor: "var(--color-canvas-subtle, #161b22)",
            borderBottom: "1px solid var(--color-border-default, #30363d)",
            overflowX: "auto",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--color-fg-muted)",
              marginRight: 6,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            Files ({Object.keys(projectFiles).length})
          </span>
          {Object.keys(projectFiles).map((fileName) => {
            const isSelected = fileName === activeFile;
            return (
              <button
                key={fileName}
                role="tab"
                type="button"
                aria-selected={isSelected}
                onClick={() => handleSwitchProjectFile(fileName)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: isSelected ? "1px solid rgba(6, 182, 212, 0.45)" : "1px solid transparent",
                  backgroundColor: isSelected ? "rgba(6, 182, 212, 0.14)" : "transparent",
                  color: isSelected ? "var(--ms-accent-cyan, #06b6d4)" : "var(--color-fg-muted)",
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 12,
                  fontWeight: isSelected ? 600 : 500,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.15s ease",
                }}
              >
                {fileName}
              </button>
            );
          })}
        </div>
      )}

      <EditorArea>
        {isLoadingArtifact ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              backgroundColor: "var(--color-canvas-default)",
              color: "var(--color-fg-muted)",
              zIndex: 50,
            }}
          >
            <Spinner size="large" />
            <div style={{ fontSize: 13, fontWeight: 500 }}>Loading model into Morsel…</div>
          </div>
        ) : (
          <ErrorBoundary
            name="Ansatz Morsel Editor"
            fallback={
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  padding: 32,
                  textAlign: "center",
                  backgroundColor: "var(--color-canvas-default)",
                  color: "var(--color-fg-default)",
                  gap: 16,
                }}
              >
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: "50%",
                    backgroundColor: "var(--ms-status-fail-bg, rgba(248, 81, 73, 0.12))",
                    border: "1px solid var(--ms-status-fail-border, var(--ms-danger, #f85149))",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--ms-danger, #f85149)",
                  }}
                >
                  <AlertIcon size={28} />
                </div>
                <h2 style={{ fontSize: 20, margin: 0, fontWeight: 600 }}>Morsel Editor Encountered an Issue</h2>
                <p style={{ color: "var(--color-fg-muted)", fontSize: 14, maxWidth: 480, margin: 0, lineHeight: 1.5 }}>
                  The editor component crashed during rendering. Your draft is preserved in local storage and can be
                  recovered safely.
                </p>
                <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap", justifyContent: "center" }}>
                  <Button
                    variant="primary"
                    onClick={() => {
                      try {
                        const saved =
                          localStorage.getItem("ansatz_morsel_draft") || localStorage.getItem("ansatz_sketch_draft");
                        if (saved) {
                          const parsed = JSON.parse(saved);
                          if (parsed?.code) setCurrentCode(parsed.code);
                        }
                      } catch {}
                      window.location.reload();
                    }}
                  >
                    Recover Draft & Reload
                  </Button>
                  <Button
                    variant="default"
                    onClick={() => {
                      applySelectedExample(HERO_EXAMPLES[0]!);
                      window.location.reload();
                    }}
                  >
                    Reset to Blank Model
                  </Button>
                </div>
              </div>
            }
          >
            <MorselEditor
              dataUrl={null}
              initialCode={currentCode}
              embed={false}
              hideFloatingDock={true}
              hideCenterFloatingToolbar={true}
              initialDialect={currentLang}
              initialView={currentView}
              initialVisualizerSubview={
                subviewParam === "simulation" ||
                subviewParam === "3d" ||
                subviewParam === "inspector" ||
                subviewParam === "diagram"
                  ? subviewParam
                  : undefined
              }
              initialSimulationVariables={initialSimVars}
              initialStartTime={initialStartTime}
              initialStopTime={initialStopTime}
              initialDiagramType={diagramTypeParam || (payload as any)?.diagramType || undefined}
              initialClassName={extractPrimaryModelicaClassName(currentCode) || undefined}
              initialAnchor={payload?.anchor}
              externalParams={payload?.params}
              simulateTriggerCount={simulateTriggerCount}
              onCodeChange={handleCodeChange}
              onClassLoaded={handleClassLoaded}
              onActiveViewChange={handleActiveViewChange}
              onParametersChange={handleParametersChange}
              onSimulationStatus={(status: { status?: string } | string | null | undefined) => {
                const s = typeof status === "string" ? status : status?.status;
                setIsSimulating(s === "pending" || s === "processing");
              }}
              onDialectChange={(dialect: string) => {
                setCurrentLang(dialect);
              }}
            />
          </ErrorBoundary>
        )}
      </EditorArea>

      {pendingExample && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="playground-dirty-modal-title"
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.55)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000,
          }}
          onClick={() => setPendingExample(null)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 420,
              margin: "0 16px",
              padding: 20,
              borderRadius: 12,
              backgroundColor: "var(--color-canvas-overlay, var(--color-canvas-default))",
              border: "1px solid var(--color-border-default)",
              boxShadow: "0 16px 48px rgba(0, 0, 0, 0.4)",
              color: "var(--color-fg-default)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="playground-dirty-modal-title" style={{ margin: "0 0 8px 0", fontSize: 16, fontWeight: 600 }}>
              Unsaved Changes
            </h3>
            <p style={{ margin: "0 0 20px 0", fontSize: 13, color: "var(--color-fg-muted)", lineHeight: 1.5 }}>
              {`Discard unsaved changes and load '${pendingExample.title}'?`}
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button size="small" variant="default" onClick={() => setPendingExample(null)}>
                Cancel
              </Button>
              <Button
                size="small"
                variant="danger"
                onClick={() => {
                  const nextEx = pendingExample;
                  setPendingExample(null);
                  applySelectedExample(nextEx);
                }}
              >
                Discard & Load
              </Button>
            </div>
          </div>
        </div>
      )}

      <PlaygroundShareModal
        isOpen={isShareModalOpen}
        onClose={() => setShareModalOpen(false)}
        copyStatus={copyStatus}
        shareUrl={getShareUrl()}
        embedCode={getEmbedCode()}
        getEmbedCode={getEmbedCode}
        markdownBadge={getMarkdownBadge()}
        onCopy={handleCopy}
      />

      <TemplateGalleryModal
        isOpen={isTemplatesModalOpen}
        onClose={() => setIsTemplatesModalOpen(false)}
        onSelectTemplate={handleSelectExample}
      />

      <CreatePlaygroundRepoModal
        isOpen={isCreateRepoModalOpen}
        onClose={() => setIsCreateRepoModalOpen(false)}
        currentTitle={currentTitle}
        currentCode={currentCode}
        currentLangExt={getExtensionForDialect(currentLang)}
        onSuccess={handleRepoCreated}
      />
    </PlaygroundContainer>
  );
};

export default PlaygroundPage;
