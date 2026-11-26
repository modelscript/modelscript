// SPDX-License-Identifier: AGPL-3.0-or-later

import AnsatzEditor from "@modelscript/editor/workbench/AnsatzEditor";
import { AnsatzEditorLoadingScreen } from "@modelscript/editor/workbench/AnsatzEditorLoadingScreen";
import { ANSATZ_LANGUAGE_MAP, getDefaultLanguageView, getLanguageInfo } from "@modelscript/editor/workbench/constants";
import { getLatestSeasonalVerificationMatrix } from "@modelscript/editor/workbench/panels/inspectors/RequirementsOntologyInspector";
import {
  extractPrimaryModelicaClassName,
  installDependency,
  unloadAllMountedLibraries,
} from "@modelscript/editor/workbench/util/lsp-bridge";
import {
  buildAnsatzEmbedHtmlPage,
  compressAnsatzPayload,
  decompressAnsatzPayload,
  resolveAnsatzShortlink,
} from "@modelscript/editor/workbench/util/permalink";
import { AlertIcon } from "@primer/octicons-react";
import { Button } from "@primer/react";
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { createArtifactView, getArtifactView, getPost } from "../api";
import { useAuth } from "../AuthContext";
import { parseTrainingStudioUrlParams } from "../components/artifacts/training-recipe-composer-helpers";
import { TrainingRecipeComposerForm } from "../components/artifacts/TrainingRecipeComposerForm";
import { analyzeSnippetDiagnostics } from "../components/compose/snippet-diagnostics";
import { ComposeContext, type ComposeInitialState } from "../components/ComposeContext";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { useToast } from "../components/ToastContext";
import { useFeatureFlag } from "../FeatureFlagContext";
import { useTheme } from "../theme";
import {
  getExtensionForDialect,
  inferDialectFromArtifact,
  inferDialectFromFilename,
  isMultiFileArtifact,
} from "../util/editor-routing";
import { safeJsonParse } from "../util/json";
import { usePageTitle } from "../util/title";
import {
  ANSATZ_EDITOR_LANGUAGES,
  AnsatzEditorContainer,
  AnsatzEditorNavbar,
  AnsatzEditorShareModal,
  CreateAnsatzRepoModal,
  EditorArea,
  FileConflictModal,
  HERO_EXAMPLES,
  TemplateGalleryModal,
  type AnsatzDecodedPayload,
  type HeroExample,
} from "./ansatz-editor";
import { EXAMPLE_INDEX, EXAMPLE_INDEX_BY_ID, loadExampleById } from "./ansatz-editor/generated/example-loader";

function sanitizeModelFileName(title: string): string {
  const leaf = title.includes(".") ? title.slice(title.lastIndexOf(".") + 1) : title;
  const cleaned = leaf
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "model";
}

function resolveTemplateFiles(ex: HeroExample): { files: Record<string, string>; activeFile: string } {
  if (ex.files && Object.keys(ex.files).length > 0) {
    const active = ex.activeFile && ex.activeFile in ex.files ? ex.activeFile : Object.keys(ex.files)[0]!;
    return { files: { ...ex.files }, activeFile: active };
  }
  const ext = getLanguageInfo(ex.lang).ext || "mo";
  const base = sanitizeModelFileName(ex.title);
  const fileName = base.endsWith(`.${ext}`) ? base : `${base}.${ext}`;
  return { files: { [fileName]: ex.code }, activeFile: fileName };
}

function mountArtifactDependencies(deps?: unknown): void {
  if (!Array.isArray(deps) || deps.length === 0) return;
  for (const dep of deps) {
    if (dep && typeof dep.name === "string" && typeof dep.version === "string") {
      installDependency(dep.name, dep.version).catch((err) => {
        console.warn(`[AnsatzEditorPage] Failed to auto-mount dependency ${dep.name}@${dep.version}:`, err);
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
  drone: "urdf-hexacopter-drone",
  hexacopter: "urdf-hexacopter-drone",
  "urdf-hexacopter-drone": "urdf-hexacopter-drone",
  "wind-turbine": "modelica-wind-turbine",
  turbine: "modelica-wind-turbine",
  "modelica-wind-turbine": "modelica-wind-turbine",
  "ev-battery": "modelica-ev-battery-cooling",
  battery: "modelica-ev-battery-cooling",
  "modelica-ev-battery-cooling": "modelica-ev-battery-cooling",
  satellite: "modelica-orbital-satellite",
  cubesat: "modelica-orbital-satellite",
  "modelica-orbital-satellite": "modelica-orbital-satellite",
};

function clearAnsatzEditorUrl(pathname: string): void {
  if (typeof window === "undefined") return;
  if (!window.location.search && !window.location.hash) return;
  window.history.replaceState(window.history.state, "", pathname);
}

export const AnsatzEditorPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { openCompose } = useContext(ComposeContext);
  const toast = useToast();
  const { user } = useAuth();
  const { theme } = useTheme();
  const hasIde = useFeatureFlag("heavy_vscode_ide");

  const modelParam = searchParams.get("model");
  const templateParam = searchParams.get("template");
  const sourceParam = searchParams.get("source");
  const fromArtifactParam = searchParams.get("fromArtifact");
  const ansatzParam = searchParams.get("ansatz");
  const viewParam = searchParams.get("view");
  const subviewParam = searchParams.get("subview");
  const autoSimulateParam = searchParams.get("autoSimulate");
  const simVarsParam = searchParams.get("simVars") || searchParams.get("variables");
  const startTimeParam = searchParams.get("startTime");
  const stopTimeParam = searchParams.get("stopTime");
  const langParam = searchParams.get("lang") || searchParams.get("dialect") || searchParams.get("language");
  const singleLangLocked = Boolean(
    langParam &&
    (searchParams.get("single") === "1" ||
      searchParams.get("single") === "true" ||
      searchParams.get("lockLang") === "1"),
  );
  const titleParam = searchParams.get("title");
  const editPostIdParam = searchParams.get("editPostId");
  const replyToPostIdParam = searchParams.get("replyToPostId");
  const diagramTypeParam = searchParams.get("diagramType");
  const trainingStudioParams = useMemo(() => parseTrainingStudioUrlParams(location.search), [location.search]);
  const [trainingBannerDismissed, setTrainingBannerDismissed] = useState(false);
  const [trainingComposerOpen, setTrainingComposerOpen] = useState(false);

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
    ansatzParam ||
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

  const initialHashPayload = useMemo(() => {
    if (
      !location.hash ||
      location.hash.length <= 1 ||
      location.hash.startsWith("#memfs:") ||
      location.hash.startsWith("#m=artifact-") ||
      /^#m=\d+$/.test(location.hash)
    ) {
      return null;
    }
    return decompressAnsatzPayload(location.hash) as
      | (AnsatzDecodedPayload & {
          files?: Record<string, string>;
          activeFile?: string;
          isMultiFile?: boolean;
          artifactId?: string | number;
        })
      | null;
  }, [location.hash]);

  const initialFilesFromHash =
    initialHashPayload?.files &&
    typeof initialHashPayload.files === "object" &&
    Object.keys(initialHashPayload.files).length > 1
      ? initialHashPayload.files
      : null;
  const initialActiveFromHash = initialFilesFromHash
    ? initialHashPayload?.activeFile || Object.keys(initialFilesFromHash)[0] || null
    : null;
  const initialLangFromHash = initialHashPayload?.code
    ? initialHashPayload.lang ||
      langParam ||
      inferDialectFromFilename(initialHashPayload.activeFile || initialHashPayload.title || titleParam) ||
      "modelica"
    : null;

  const isInitialLaunchWithoutTarget = !hasInitialTarget && !langParam && !titleParam;
  const defaultInitialCode = initialHashPayload?.code ?? (hasInitialTarget ? "" : "");
  const defaultInitialTitle =
    initialHashPayload?.title ||
    titleParam ||
    (hasInitialArtifactTarget ? "Loading Artifact…" : hasInitialTarget ? "" : "Untitled Workspace");
  const initialTemplateKey = templateParam || modelParam;
  const initialTemplateLang = initialTemplateKey
    ? (() => {
        const normalizedKey = TEMPLATE_ALIASES[initialTemplateKey.toLowerCase()] || initialTemplateKey;
        const match = HERO_EXAMPLES.find(
          (ex) =>
            ex.id.toLowerCase() === normalizedKey.toLowerCase() ||
            ex.id.toLowerCase() === initialTemplateKey.toLowerCase() ||
            ex.title.toLowerCase().includes(initialTemplateKey.toLowerCase()),
        );
        return match?.lang ?? null;
      })()
    : null;
  const defaultInitialLang = initialLangFromHash || langParam || initialTemplateLang || "modelica";

  const [isLoadingArtifact, setIsLoadingArtifact] = useState<boolean>(hasInitialArtifactTarget);
  const [currentCode, setCurrentCode] = useState<string>(defaultInitialCode);
  const [projectFiles, setProjectFiles] = useState<Record<string, string> | null>(
    initialFilesFromHash ?? (isInitialLaunchWithoutTarget ? {} : null),
  );
  const [activeFile, setActiveFile] = useState<string | null>(initialActiveFromHash);
  const [currentTitle, setCurrentTitle] = useState<string>(defaultInitialTitle);
  const [currentLang, setCurrentLang] = useState<string>(defaultInitialLang);
  const [initialSubview] = useState<string | null>(subviewParam);
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
  const [dirtyFiles, setDirtyFiles] = useState<string[]>([]);
  useEffect(() => {
    if (!isDirty) setDirtyFiles([]);
  }, [isDirty]);
  const [pendingExample, setPendingExample] = useState<HeroExample | null>(null);
  const [pendingClearWorkspace, setPendingClearWorkspace] = useState<boolean>(false);
  const [openNewModelAfterClear, setOpenNewModelAfterClear] = useState<boolean>(false);
  const [pendingFileConflict, setPendingFileConflict] = useState<{
    templateTitle: string;
    templateLang: string;
    baseFiles: Record<string, string>;
    incomingFiles: Record<string, string>;
    incomingActiveFile: string;
  } | null>(null);
  const baselineCodeRef = useRef<string>(defaultInitialCode);

  usePageTitle(currentTitle ? `${currentTitle} — Ansatz` : "Ansatz", { includeBrand: false });
  const [isShareModalOpen, setShareModalOpen] = useState(false);
  const [isTemplatesModalOpen, setIsTemplatesModalOpen] = useState(isInitialLaunchWithoutTarget);
  const [isTemplateChoiceRequired, setIsTemplateChoiceRequired] = useState(isInitialLaunchWithoutTarget);
  const [loadingTemplateTitle, setLoadingTemplateTitle] = useState<string | null>(null);
  const [isCreateRepoModalOpen, setIsCreateRepoModalOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const [payload, setPayload] = useState<AnsatzDecodedPayload | null>(null);

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
          projectFiles: projectFiles && Object.keys(projectFiles).length > 0 ? projectFiles : undefined,
          activeFile: activeFile ?? undefined,
          timestamp: Date.now(),
        });
        localStorage.setItem("ansatz_ansatz_draft", draftData);
        localStorage.setItem("ansatz_sketch_draft", draftData);
      } catch {}
    }, 1000);
    return () => clearTimeout(timer);
  }, [currentCode, currentTitle, currentLang, projectFiles, activeFile, isDirty]);

  // Recover draft if opened cleanly without query parameters or initial target
  useEffect(() => {
    if (hasInitialTarget) return;
    try {
      const saved = localStorage.getItem("ansatz_ansatz_draft") || localStorage.getItem("ansatz_sketch_draft");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.code && typeof parsed.code === "string" && Date.now() - (parsed.timestamp || 0) < 86_400_000) {
          setCurrentCode(parsed.code);
          baselineCodeRef.current = parsed.code;
          if (parsed.title) setCurrentTitle(parsed.title);
          if (parsed.lang) setCurrentLang(parsed.lang);
          if (parsed.projectFiles && typeof parsed.projectFiles === "object") {
            setProjectFiles(parsed.projectFiles as Record<string, string>);
          }
          if (typeof parsed.activeFile === "string") {
            setActiveFile(parsed.activeFile);
          }
          setIsTemplatesModalOpen(false);
          setIsTemplateChoiceRequired(false);
        }
      }
    } catch {}
  }, [hasInitialTarget]);

  const hasHydratedFromUrlRef = useRef<boolean>(false);
  const currentLangRef = useRef(currentLang);
  const payloadDiagramTypeRef = useRef(payload?.diagramType);
  useEffect(() => {
    currentLangRef.current = currentLang;
  }, [currentLang]);
  useEffect(() => {
    payloadDiagramTypeRef.current = payload?.diagramType;
  }, [payload?.diagramType]);

  // Initialize from URL hash, query params, location.state, ?ansatz=<id>, or ?fromArtifact=<id>
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

    // 0a. Check ?ansatz=<id> server-side short-link
    if (ansatzParam) {
      setIsLoadingArtifact(true);
      (async () => {
        try {
          const resolved = await resolveAnsatzShortlink(ansatzParam, {
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
          clearAnsatzEditorUrl(location.pathname);
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
              clearAnsatzEditorUrl(location.pathname);
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
              clearAnsatzEditorUrl(location.pathname);
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
      const p = decompressAnsatzPayload(location.hash) as
        | (AnsatzDecodedPayload & {
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
          hasHydratedFromUrlRef.current = true;
          clearAnsatzEditorUrl(location.pathname);
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
      clearAnsatzEditorUrl(location.pathname);
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
      clearAnsatzEditorUrl(location.pathname);
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
            toast.error("Failed to load model into Ansatz");
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
              (typeof payloadDiagramTypeRef.current === "string" ? payloadDiagramTypeRef.current : undefined) ||
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
            clearAnsatzEditorUrl(location.pathname);
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
            clearAnsatzEditorUrl(location.pathname);
          }
        } catch (err) {
          console.warn("[AnsatzEditorPage] Failed to load artifact from ?fromArtifact=", effectiveArtifactId, err);
          if (!cancelled) {
            toast.error("Failed to load model into Ansatz");
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
      const lowerNorm = normalizedKey.toLowerCase();
      const lowerRaw = effectiveModelOrTemplate.toLowerCase();
      const heroMatch = HERO_EXAMPLES.find(
        (ex) =>
          ex.id.toLowerCase() === lowerNorm ||
          ex.id.toLowerCase() === lowerRaw ||
          ex.title.toLowerCase().includes(lowerRaw),
      );
      const indexMatch = !heroMatch
        ? EXAMPLE_INDEX.find(
            (ex) =>
              ex.id.toLowerCase() === lowerNorm ||
              ex.id.toLowerCase() === lowerRaw ||
              ex.title.toLowerCase().includes(lowerRaw),
          )
        : undefined;

      const applyMatched = (match: HeroExample) => {
        const nextFiles = match.files ? { ...match.files } : null;
        const nextActive = nextFiles ? (match.activeFile ?? Object.keys(nextFiles)[0] ?? null) : null;
        const initialCode = nextFiles && nextActive ? (nextFiles[nextActive] ?? match.code) : match.code;
        baselineCodeRef.current = initialCode;
        setIsDirty(false);
        setProjectFiles(nextFiles);
        setActiveFile(nextActive);
        setCurrentCode(initialCode);
        setCurrentTitle(match.title);
        setCurrentLang(match.lang);
        setPayload({
          v: 1,
          lang: match.lang,
          code: initialCode,
          title: match.title,
          ...(nextFiles ? { files: nextFiles, activeFile: nextActive ?? undefined, isMultiFile: true } : {}),
        });
        clearAnsatzEditorUrl(location.pathname);
      };

      if (heroMatch) {
        applyMatched(heroMatch);
      } else if (indexMatch) {
        setLoadingTemplateTitle(indexMatch.title);
        void loadExampleById(indexMatch.id)
          .then((loaded) => {
            if (cancelled) return;
            if (loaded) {
              applyMatched(loaded);
            } else if (HERO_EXAMPLES[0]) {
              applyMatched(HERO_EXAMPLES[0]);
            }
          })
          .finally(() => {
            if (!cancelled) setLoadingTemplateTitle(null);
          });
      } else if (HERO_EXAMPLES[0]) {
        applyMatched(HERO_EXAMPLES[0]);
      }
      return () => {
        cancelled = true;
      };
    }

    // 6. If only ?lang= or ?title= was passed
    if (langParam) {
      setCurrentLang(langParam);
      const matchingExample = HERO_EXAMPLES.find((ex) => ex.lang === langParam);
      const langInfo = getLanguageInfo(langParam);
      const langOpt = ANSATZ_EDITOR_LANGUAGES.find((l) => l.id === langParam);
      const hasDefaultFiles = !matchingExample && Boolean(langInfo?.defaultFiles);
      const initialFiles = hasDefaultFiles ? { ...langInfo!.defaultFiles! } : null;
      const initialActive =
        hasDefaultFiles && initialFiles ? (langInfo?.defaultActiveFile ?? Object.keys(initialFiles)[0] ?? null) : null;
      const nextCode =
        matchingExample?.code ||
        (initialFiles && initialActive ? initialFiles[initialActive] : undefined) ||
        langInfo?.defaultCode;
      const nextTitle = titleParam || matchingExample?.title || langOpt?.label || langInfo?.name;
      if (nextCode) {
        baselineCodeRef.current = nextCode;
        setIsDirty(false);
        setProjectFiles(initialFiles);
        setActiveFile(initialActive);
        setCurrentCode(nextCode);
        if (nextTitle) setCurrentTitle(nextTitle);
        setPayload({
          v: 1,
          lang: langParam,
          code: nextCode,
          title: nextTitle,
          ...(initialFiles ? { files: initialFiles, activeFile: initialActive ?? undefined, isMultiFile: true } : {}),
        });
      } else if (titleParam) {
        setCurrentTitle(titleParam);
      }
    } else if (titleParam) {
      setCurrentTitle(titleParam);
    } else if (!hasInitialTarget && !hasHydratedFromUrlRef.current) {
      hasHydratedFromUrlRef.current = true;
      baselineCodeRef.current = "";
      setIsDirty(false);
      setProjectFiles({});
      setActiveFile(null);
      setCurrentCode("");
      setCurrentTitle("Untitled Workspace");
      setPayload({
        v: 1,
        lang: currentLangRef.current,
        code: "",
        title: "Untitled Workspace",
      });
    }

    clearAnsatzEditorUrl(location.pathname);

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
    ansatzParam,
    viewParam,
    langParam,
    titleParam,
    diagramTypeParam,
    simVarsParam,
    hasInitialTarget,
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
    const nextFiles = ex.files ? { ...ex.files } : null;
    const nextActiveFile = nextFiles ? (ex.activeFile ?? Object.keys(nextFiles)[0] ?? null) : null;
    const initialCode = nextFiles && nextActiveFile ? (nextFiles[nextActiveFile] ?? ex.code) : ex.code;

    baselineCodeRef.current = initialCode;
    setIsDirty(false);
    setSimulationResetKey((k) => k + 1);
    setProjectFiles(nextFiles);
    setActiveFile(nextActiveFile);
    setCurrentCode(initialCode);
    setCurrentTitle(ex.title);
    if (ex.lang !== currentLang) {
      const nextDefault = getDefaultLanguageView(getLanguageInfo(ex.lang));
      setCurrentView(nextDefault.view);
      setIsSplit(nextDefault.isSplit);
    }
    setCurrentLang(ex.lang);
    setPayload({
      v: 1,
      lang: ex.lang,
      code: initialCode,
      title: ex.title,
    });
    clearAnsatzEditorUrl(location.pathname);
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
    if (singleLangLocked) return;
    const nextStarter = HERO_EXAMPLES.find((ex) => ex.lang === nextLang);
    const langInfo = ANSATZ_LANGUAGE_MAP.get(nextLang.toLowerCase());
    const langOpt = ANSATZ_EDITOR_LANGUAGES.find((l) => l.id === nextLang);
    const nextFiles = nextStarter?.files
      ? { ...nextStarter.files }
      : langInfo?.defaultFiles
        ? { ...langInfo.defaultFiles }
        : undefined;
    const nextActiveFile =
      nextStarter?.activeFile ?? langInfo?.defaultActiveFile ?? (nextFiles ? Object.keys(nextFiles)[0] : undefined);
    const nextCode =
      (nextFiles && nextActiveFile ? nextFiles[nextActiveFile] : undefined) ||
      nextStarter?.code ||
      langInfo?.defaultCode ||
      "";
    const nextTitle = nextStarter?.title || langOpt?.label || langInfo?.label || langInfo?.name || nextLang;
    const nextExample: HeroExample = {
      id: nextStarter?.id || `lang-${nextLang}`,
      title: nextTitle,
      category: nextStarter?.category || "Starter",
      lang: nextLang,
      code: nextCode,
      ...(nextFiles ? { files: nextFiles } : {}),
      ...(nextActiveFile ? { activeFile: nextActiveFile } : {}),
    };
    if (isDirty) {
      setPendingExample(nextExample);
      return;
    }
    applySelectedExample(nextExample);
  };

  const handleOpenInVsCode = () => {
    const params = new URLSearchParams();
    const effectiveFiles =
      projectFiles && Object.keys(projectFiles).length > 1
        ? { ...projectFiles, ...(activeFile ? { [activeFile]: currentCode } : {}) }
        : null;
    if (effectiveFiles) {
      try {
        sessionStorage.setItem(
          "modelscript.ansatz_handoff_files",
          JSON.stringify({
            files: effectiveFiles,
            primaryFile: activeFile || Object.keys(effectiveFiles)[0],
            lang: currentLang,
            title: currentTitle,
          }),
        );
        params.set("handoff", "1");
      } catch {
        // fallback to single-file query param below
      }
    }
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
    const hash = compressAnsatzPayload({
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
    const basePath = location.pathname.startsWith("/editor")
      ? "/editor"
      : location.pathname.startsWith("/sketch")
        ? "/sketch"
        : location.pathname.startsWith("/ansatz")
          ? "/ansatz"
          : "/editor";
    return `${window.location.origin}${basePath}#m=${hash}`;
  };

  const getEmbedCode = (format: "iframe" | "html-page" | "custom-tag" | "ansatz-tag" = "iframe") => {
    const isMulti = Boolean(projectFiles && Object.keys(projectFiles).length > 0);
    const hasParams = Boolean(payload?.params && Object.keys(payload.params).length > 0);
    const hash = compressAnsatzPayload({
      v: 1,
      lang: currentLang,
      code: currentCode,
      ...(isMulti && projectFiles
        ? {
            files: projectFiles,
            activeFile: activeFile || undefined,
            isMultiFile: Object.keys(projectFiles).length > 1,
          }
        : {}),
      ...(hasParams && payload?.params ? { params: payload.params } : {}),
      title: currentTitle,
      view: payload?.view,
      anchor: payload?.anchor,
      ...(resolvedFromArtifact ? { artifactId: resolvedFromArtifact } : {}),
    });
    const embedBase = location.pathname.startsWith("/editor")
      ? "/embed/editor"
      : location.pathname.startsWith("/sketch")
        ? "/embed/sketch"
        : location.pathname.startsWith("/ansatz")
          ? "/embed/ansatz"
          : "/embed/editor";
    const embedSrc = `${window.location.origin}${embedBase}#m=${hash}`;
    if (format === "html-page") {
      return buildAnsatzEmbedHtmlPage({ embedSrc, title: currentTitle });
    }
    if (format === "ansatz-tag") {
      return `<script type="module" src="https://cdn.modelscript.org/embed/v1/modelscript-embed.js"></script>\n<ansatz-editor src="${embedSrc}" height="500px" theme="dark"></ansatz-editor>`;
    }
    if (format === "custom-tag") {
      const anchorAttr = payload?.anchor?.elementId ? ` anchor="${payload.anchor.elementId}"` : "";
      return `<script type="module" src="${window.location.origin}/static/embed.js"></script>\n<modelscript-viewer dialect="${currentLang}" view="${payload?.view || "diagram"}"${anchorAttr}>\n${currentCode}\n</modelscript-viewer>`;
    }
    return `<iframe src="${embedSrc}" width="100%" height="600" frameborder="0" allow="clipboard-write"></iframe>`;
  };

  const getMarkdownBadge = () => {
    const url = getShareUrl();
    return `[![Open in Ansatz](https://img.shields.io/badge/Ansatz-0284c7?style=flat&logo=codefactor)](${url})`;
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

    const numericForkedId =
      effectiveArtifactId !== null && !Number.isNaN(Number(effectiveArtifactId))
        ? Number(effectiveArtifactId)
        : undefined;
    const isMulti = Boolean(projectFiles && Object.keys(projectFiles).length > 1);
    const composePayload: ComposeInitialState = {
      ...(defaultContent !== undefined ? { content: defaultContent } : {}),
      ansatzPayload: {
        code: currentCode,
        title: currentTitle,
        dialect: currentLang,
        isMultiFile: isMulti,
        ...(isMulti && projectFiles ? { files: projectFiles } : {}),
        ...(numericForkedId !== undefined ? { forkedFromArtifactId: numericForkedId } : {}),
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
      const seasonalVerification = getLatestSeasonalVerificationMatrix();
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
          ...(seasonalVerification ? { seasonalVerification } : {}),
        }),
      });
      if (created?.id) {
        setResolvedFromArtifact(String(created.id));
        setIsDirty(false);
        toast.toast({
          type: "success",
          title: "Saved to Ansatz",
          message: `Saved "${currentTitle}" as Model #${created.id}.`,
          action: {
            label: "Open Model",
            onClick: () => navigate(`/editor?fromArtifact=${created.id}`),
          },
        });
      }
    } catch (err: unknown) {
      console.error("Failed to save artifact:", err);
      const apiErr = err as { response?: { data?: { error?: string } }; message?: string };
      toast.error(apiErr?.response?.data?.error || apiErr?.message || "Failed to save artifact.");
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
    clearAnsatzEditorUrl(location.pathname);
  };

  const handleClassLoaded = (
    loadedCode: string,
    loadedClassName: string,
    loadedDialect: string,
    loadedFiles?: Record<string, string>,
    loadedActiveFile?: string,
  ) => {
    const nextTitle = loadedClassName.split(".").pop() || loadedClassName || currentTitle;
    const nextLang = loadedDialect || currentLang;
    const nextFiles = loadedFiles && Object.keys(loadedFiles).length > 0 ? { ...loadedFiles } : null;
    const nextActive = nextFiles ? (loadedActiveFile ?? Object.keys(nextFiles)[0] ?? null) : null;
    const resolvedCode = nextFiles && nextActive ? (nextFiles[nextActive] ?? loadedCode) : loadedCode;
    baselineCodeRef.current = resolvedCode;
    setIsDirty(false);
    setProjectFiles(nextFiles);
    setActiveFile(nextActive);
    if (nextLang !== currentLang) {
      setCurrentLang(nextLang);
    }
    setCurrentCode(resolvedCode);
    setCurrentTitle(nextTitle);
    setPayload((prev) => ({
      ...(prev || { v: 1 }),
      lang: nextLang,
      code: resolvedCode,
      title: nextTitle,
      ...(nextFiles && Object.keys(nextFiles).length > 1
        ? { files: nextFiles, activeFile: nextActive || undefined, isMultiFile: true }
        : {}),
    }));
    clearAnsatzEditorUrl(location.pathname);
  };

  const handleCodeChange = (nextCode: string) => {
    const targetFile = activeFile ?? defaultSingleFileName;
    if (nextCode !== currentCode && nextCode !== baselineCodeRef.current) {
      setIsDirty(true);
      setDirtyFiles((prev) => (prev.includes(targetFile) ? prev : [...prev, targetFile]));
    } else if (nextCode === baselineCodeRef.current) {
      setDirtyFiles((prev) => {
        const next = prev.filter((f) => f !== targetFile);
        if (next.length === 0) setIsDirty(false);
        return next;
      });
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

  const handleAddProjectFile = (rawName: string) => {
    const trimmed = rawName.trim().replace(/^\/+/, "");
    if (!trimmed) return;
    const baseFiles: Record<string, string> = projectFiles
      ? { ...projectFiles, ...(activeFile ? { [activeFile]: currentCode } : {}) }
      : { [`model.${getLanguageInfo(currentLang).ext}`]: currentCode };
    if (trimmed in baseFiles) {
      handleSwitchProjectFile(trimmed);
      return;
    }
    const nextFiles = { ...baseFiles, [trimmed]: "" };
    const nextDialect = inferDialectFromFilename(trimmed) || currentLang;
    setProjectFiles(nextFiles);
    setActiveFile(trimmed);
    setCurrentCode("");
    setCurrentLang(nextDialect);
    setIsDirty(true);
    setDirtyFiles((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
  };

  const defaultSingleFileName = `model.${getLanguageInfo(currentLang).ext || "mo"}`;
  const resolvedProjectFiles = useMemo(
    () => projectFiles ?? { [defaultSingleFileName]: currentCode },
    [projectFiles, defaultSingleFileName, currentCode],
  );

  const handleRemoveProjectFile = (fileName: string) => {
    const baseFiles = projectFiles ?? { [defaultSingleFileName]: currentCode };
    const currentActive = activeFile ?? defaultSingleFileName;
    if (!(fileName in baseFiles)) return;
    const { [fileName]: _removed, ...updatedFiles } = baseFiles;
    if (currentActive && currentActive !== fileName) {
      updatedFiles[currentActive] = currentCode;
    }
    const remainingKeys = Object.keys(updatedFiles);
    const nextActive = fileName === currentActive ? (remainingKeys[0] ?? null) : currentActive;
    setProjectFiles(updatedFiles);
    setActiveFile(nextActive);
    if (fileName === currentActive) {
      if (nextActive) {
        setCurrentCode(updatedFiles[nextActive] ?? "");
        setCurrentLang(inferDialectFromFilename(nextActive) || currentLang);
      } else {
        setCurrentCode("");
      }
    }
    setIsDirty(true);
    setDirtyFiles((prev) => prev.filter((f) => f !== fileName));
  };

  const handleRenameProjectFile = (oldName: string, newName: string) => {
    const trimmed = newName.trim().replace(/^\/+/, "");
    const baseFiles = projectFiles ?? { [defaultSingleFileName]: currentCode };
    const currentActive = activeFile ?? defaultSingleFileName;
    if (!trimmed || trimmed === oldName || !(oldName in baseFiles)) return;
    if (trimmed in baseFiles) return;
    const nextFiles: Record<string, string> = {};
    for (const [k, v] of Object.entries(baseFiles)) {
      const content = k === currentActive ? currentCode : v;
      if (k === oldName) {
        nextFiles[trimmed] = content;
      } else {
        nextFiles[k] = content;
      }
    }
    setProjectFiles(nextFiles);
    if (currentActive === oldName) {
      setActiveFile(trimmed);
      setCurrentLang(inferDialectFromFilename(trimmed) || currentLang);
    }
    setIsDirty(true);
    setDirtyFiles((prev) => {
      const withoutOld = prev.filter((f) => f !== oldName);
      return withoutOld.includes(trimmed) ? withoutOld : [...withoutOld, trimmed];
    });
  };

  const handleMoveProjectFile = (fileName: string, targetDir: string) => {
    const baseFiles = projectFiles ?? { [defaultSingleFileName]: currentCode };
    if (!(fileName in baseFiles)) return;
    const cleanDir = targetDir.trim().replace(/^\/+|\/+$/g, "");
    const baseName = fileName.includes("/") ? fileName.slice(fileName.lastIndexOf("/") + 1) : fileName;
    const nextPath = cleanDir ? `${cleanDir}/${baseName}` : baseName;
    handleRenameProjectFile(fileName, nextPath);
  };

  const applyClearWorkspace = () => {
    baselineCodeRef.current = "";
    setIsDirty(false);
    setProjectFiles({});
    setActiveFile(null);
    setCurrentCode("");
    setCurrentTitle("Untitled Workspace");
    setPayload({
      v: 1,
      lang: currentLang,
      code: "",
      title: "Untitled Workspace",
    });
    clearAnsatzEditorUrl(location.pathname);
    void unloadAllMountedLibraries();
  };

  const isWorkspaceNonBlank = () => {
    if (currentCode.trim().length > 0) return true;
    if (projectFiles) {
      return Object.values(projectFiles).some((content) => content.trim().length > 0);
    }
    return false;
  };

  const handleBrandClick = () => {
    if (isWorkspaceNonBlank()) {
      setOpenNewModelAfterClear(true);
      setPendingClearWorkspace(true);
      return;
    }
    applyClearWorkspace();
    setIsTemplateChoiceRequired(true);
    setIsTemplatesModalOpen(true);
  };

  const applyAddFilesToWorkspace = (
    baseFiles: Record<string, string>,
    addedFiles: Record<string, string>,
    nextActiveFile: string,
    templateLang: string,
    templateTitle: string,
  ) => {
    const mergedFiles = { ...baseFiles, ...addedFiles };
    const nextCode = mergedFiles[nextActiveFile] ?? "";
    const resolvedLang = inferDialectFromFilename(nextActiveFile) || templateLang || currentLang;
    setProjectFiles(mergedFiles);
    setActiveFile(nextActiveFile);
    setCurrentCode(nextCode);
    setSimulationResetKey((k) => k + 1);
    if (Object.keys(baseFiles).length === 0) {
      setCurrentTitle(templateTitle);
    }
    if (resolvedLang !== currentLang) {
      const nextDefault = getDefaultLanguageView(getLanguageInfo(resolvedLang));
      setCurrentView(nextDefault.view);
      setIsSplit(nextDefault.isSplit);
    }
    setCurrentLang(resolvedLang);
    setIsDirty(true);
  };

  const handleAddModelFromTemplate = (ex: HeroExample) => {
    if (EXAMPLE_INDEX_BY_ID.has(ex.id) && (ex.fileCount ?? 1) > 1 && !ex.files) {
      setLoadingTemplateTitle(ex.title);
      void loadExampleById(ex.id)
        .then((loaded) => {
          if (loaded) {
            handleAddModelFromTemplate(loaded);
          }
        })
        .finally(() => {
          setLoadingTemplateTitle(null);
        });
      return;
    }
    const { files: incomingFiles, activeFile: incomingActiveFile } = resolveTemplateFiles(ex);
    const baseFiles: Record<string, string> =
      projectFiles !== null
        ? { ...projectFiles, ...(activeFile ? { [activeFile]: currentCode } : {}) }
        : currentCode.trim()
          ? {
              [activeFile ||
              `${sanitizeModelFileName(currentTitle || "model")}.${getLanguageInfo(currentLang).ext || "mo"}`]:
                currentCode,
            }
          : {};

    const hasConflict = Object.keys(incomingFiles).some((name) => name in baseFiles);
    if (hasConflict) {
      setPendingFileConflict({
        templateTitle: ex.title,
        templateLang: ex.lang,
        baseFiles,
        incomingFiles,
        incomingActiveFile,
      });
      return;
    }

    applyAddFilesToWorkspace(baseFiles, incomingFiles, incomingActiveFile, ex.lang, ex.title);
  };

  type AnsatzEditorView = "diagram" | "code" | "split" | "simulation" | "3d" | "inspector";
  const splitParam = searchParams.get("split");
  const initialDefaultLangView = getDefaultLanguageView(getLanguageInfo(defaultInitialLang));
  const [isSplit, setIsSplit] = useState<boolean>(() => {
    if (viewParam === "split" || splitParam === "1") return true;
    if (splitParam === "0" || viewParam === "code") return false;
    if (viewParam === "diagram" || viewParam === "3d" || viewParam === "simulation" || viewParam === "inspector") {
      return false;
    }
    return initialDefaultLangView.isSplit;
  });
  const [currentView, setCurrentView] = useState<AnsatzEditorView>(() => {
    if (viewParam === "code") return "code";
    if (viewParam === "simulation" || subviewParam === "simulation") return "simulation";
    if (viewParam === "3d" || subviewParam === "3d") return "3d";
    if (viewParam === "inspector" || subviewParam === "inspector") return "inspector";
    if (viewParam === "diagram" || subviewParam === "diagram") return "diagram";
    return initialDefaultLangView.view;
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  useEffect(() => {
    const handleSidebarChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ open?: boolean }>;
      if (typeof customEvent.detail?.open === "boolean") {
        setIsSidebarOpen(customEvent.detail.open);
      }
    };
    window.addEventListener("ansatz:sidebar-changed", handleSidebarChange);
    return () => window.removeEventListener("ansatz:sidebar-changed", handleSidebarChange);
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setIsSidebarOpen((v) => !v);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("ansatz:toggle-sidebar"));
    }
  }, []);

  const [windowDimensions, setWindowDimensions] = useState(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 1200,
    height: typeof window !== "undefined" ? window.innerHeight : 800,
  }));

  useEffect(() => {
    const handleResize = () => {
      setWindowDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const isNarrowForHorizontal = windowDimensions.width < 960;
  const hasEnoughVerticalSpace = windowDimensions.height >= 560;
  const canSplit = windowDimensions.width >= 640 && (!isNarrowForHorizontal || hasEnoughVerticalSpace);
  const splitOrientation: "horizontal" | "vertical" =
    isNarrowForHorizontal && hasEnoughVerticalSpace ? "vertical" : "horizontal";

  const [isVrMode, setIsVrMode] = useState<boolean>(() => {
    const vrParam = searchParams.get("vr");
    return vrParam === "1" || vrParam === "true";
  });

  const handleToggleSplit = useCallback(() => {
    if (currentView === "code" || !canSplit) return;
    setIsSplit((prev) => !prev);
  }, [currentView, canSplit]);

  const handleToggleVrMode = useCallback(() => {
    setIsVrMode((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        try {
          const url = new URL(window.location.href);
          if (next) {
            url.searchParams.set("vr", "1");
          } else {
            url.searchParams.delete("vr");
          }
          window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
        } catch {
          // Ignore restricted history contexts (e.g. sandboxed iframes)
        }
      }
      return next;
    });
  }, [setIsVrMode]);
  const [simulateTriggerCount, setSimulateTriggerCount] = useState<number>(() => (autoSimulateParam === "1" ? 1 : 0));
  const [simulationResetKey, setSimulationResetKey] = useState<number>(0);
  const [isSimulating, setIsSimulating] = useState(false);
  const [diagramType, setDiagramType] = useState<string>(
    () => diagramTypeParam || (typeof payload?.diagramType === "string" ? payload.diagramType : undefined) || "diagram",
  );

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
      if (nextView === "split") {
        setIsSplit(true);
        setCurrentView((prev) => (prev === "code" || prev === "split" ? "diagram" : prev));
      } else {
        setCurrentView((prev) => (prev === nextView ? prev : nextView));
      }
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
    [setIsSplit, setCurrentView, currentLang, currentCode, currentTitle],
  );

  const handleViewChange = useCallback(
    (nextView: "diagram" | "code" | "split" | "simulation" | "3d" | "inspector") => {
      if (nextView === "split") {
        handleToggleSplit();
        return;
      }
      const langInfo = getLanguageInfo(currentLang);
      if (nextView === "diagram" && !langInfo.supportsDiagram) return;
      if (nextView === "3d" && !langInfo.supports3d) return;
      if (nextView === "simulation" && !langInfo.supportsSimulation) return;
      handleActiveViewChange(nextView);
    },
    [currentLang, handleActiveViewChange, handleToggleSplit],
  );

  useEffect(() => {
    const langInfo = getLanguageInfo(currentLang);
    const isUnsupported =
      (currentView === "diagram" && !langInfo.supportsDiagram) ||
      (currentView === "3d" && !langInfo.supports3d) ||
      (currentView === "simulation" && !langInfo.supportsSimulation);
    if (!isUnsupported) return;
    const fallback = getDefaultLanguageView(langInfo).view;
    handleActiveViewChange(fallback);
  }, [currentLang, currentView, handleActiveViewChange]);

  const handleRunSimulation = useCallback(() => {
    if (!getLanguageInfo(currentLang).supportsSimulation) return;
    if (currentView !== "simulation") {
      setCurrentView("simulation");
      handleActiveViewChange("simulation");
    }
    setSimulateTriggerCount((c) => c + 1);
  }, [currentLang, currentView, handleActiveViewChange, setCurrentView, setSimulateTriggerCount]);

  // Desktop-grade global keyboard shortcuts for workbench view navigation and actions
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const isInputFocused =
        target !== null &&
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
        } else if (e.code === "KeyV" || e.key.toLowerCase() === "v") {
          e.preventDefault();
          handleToggleVrMode();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleRunSimulation, handleToggleSidebar, handleToggleVrMode, handleViewChange]);

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
    <AnsatzEditorContainer>
      <AnsatzEditorNavbar
        fromArtifactParam={resolvedFromArtifact}
        currentTitle={currentTitle}
        currentLang={currentLang}
        lockedLanguage={singleLangLocked ? currentLang : undefined}
        currentView={currentView}
        diagramType={diagramType}
        onSelectDiagramType={(nextType) => {
          setDiagramType(nextType);
          handleViewChange("diagram");
        }}
        isSplit={isSplit && canSplit}
        canSplit={canSplit}
        splitOrientation={splitOrientation}
        onToggleSplit={handleToggleSplit}
        isVrMode={isVrMode}
        onToggleVrMode={handleToggleVrMode}
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
        onBrandClick={handleBrandClick}
        onSaveToArtifact={handleSaveToArtifact}
        onCreateRepo={handleOpenCreateRepo}
        onDownloadModel={handleDownloadModel}
        onCopyEmbed={() => handleCopy(getEmbedCode(), "Embed Code")}
        onOpenShare={() => setShareModalOpen(true)}
        onPublishToFeed={handlePublishToFeed}
      />

      {trainingStudioParams.isTrainingStudio && !trainingBannerDismissed && (
        <div
          data-testid="training-studio-deeplink-banner"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            padding: "8px 14px",
            borderBottom: "1px solid var(--color-border-default)",
            background: "var(--color-canvas-subtle)",
            fontSize: "12px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: "999px",
                  fontWeight: 700,
                  fontSize: "11px",
                  background: "rgba(124, 58, 237, 0.14)",
                  color: "#7c3aed",
                }}
              >
                Training Studio
              </span>
              {trainingStudioParams.forkRecipe && (
                <span>
                  Forking <code>{trainingStudioParams.forkRecipe}</code>
                </span>
              )}
              {!trainingStudioParams.forkRecipe && trainingStudioParams.recipe && (
                <span>
                  Active recipe <code>{trainingStudioParams.recipe}</code>
                </span>
              )}
              {trainingStudioParams.runBackend && (
                <span
                  style={{
                    padding: "2px 7px",
                    borderRadius: "6px",
                    fontWeight: 600,
                    fontSize: "11px",
                    background: "rgba(5, 150, 105, 0.14)",
                    color: "#047857",
                  }}
                >
                  Backend: {trainingStudioParams.runBackend.toUpperCase()}
                </span>
              )}
              {trainingStudioParams.artifactId && (
                <span style={{ color: "var(--color-fg-muted)" }}>Artifact #{trainingStudioParams.artifactId}</span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <Button size="small" variant="primary" onClick={() => setTrainingComposerOpen((open) => !open)}>
                {trainingComposerOpen ? "Hide Recipe Composer" : "Draft Lab Report"}
              </Button>
              <Button
                size="small"
                variant="invisible"
                aria-label="Dismiss Training Studio banner"
                onClick={() => setTrainingBannerDismissed(true)}
              >
                ×
              </Button>
            </div>
          </div>
          {trainingComposerOpen && (
            <div style={{ maxHeight: "48vh", overflowY: "auto" }}>
              <TrainingRecipeComposerForm
                forkedFromPackage={trainingStudioParams.forkRecipe ?? trainingStudioParams.recipe}
                onDraftGenerated={({ markdown, artifactPayload }) => {
                  setTrainingComposerOpen(false);
                  openCompose({
                    initialContent: markdown,
                    initialTitle: artifactPayload.title,
                    artifactId: trainingStudioParams.artifactId ?? undefined,
                  });
                }}
              />
            </div>
          )}
        </div>
      )}

      <EditorArea>
        {isLoadingArtifact ? (
          <AnsatzEditorLoadingScreen
            colorMode={theme === "dark" ? "dark" : "light"}
            loadingProgress={5}
            loadingMessage="Loading model into Ansatz…"
          />
        ) : (
          <ErrorBoundary
            name="Ansatz"
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
                <h2 style={{ fontSize: 20, margin: 0, fontWeight: 600 }}>Ansatz Encountered an Issue</h2>
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
                          localStorage.getItem("ansatz_ansatz_draft") || localStorage.getItem("ansatz_sketch_draft");
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
                      try {
                        localStorage.removeItem("ansatz_ansatz_draft");
                        localStorage.removeItem("ansatz_sketch_draft");
                      } catch {}
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
            <AnsatzEditor
              dataUrl={null}
              initialCode={currentCode}
              isLoadingModel={Boolean(loadingTemplateTitle)}
              projectFiles={resolvedProjectFiles}
              activeFileName={activeFile ?? defaultSingleFileName}
              dirtyFiles={dirtyFiles}
              onSelectProjectFile={handleSwitchProjectFile}
              onAddProjectFile={handleAddProjectFile}
              onOpenNewModelModal={() => {
                setIsTemplateChoiceRequired(false);
                setIsTemplatesModalOpen(true);
              }}
              onRemoveProjectFile={handleRemoveProjectFile}
              onRenameProjectFile={handleRenameProjectFile}
              onMoveProjectFile={handleMoveProjectFile}
              onUpdateProjectFile={(fileName, nextContent) => {
                setProjectFiles((prev) => {
                  if (!prev || prev[fileName] === nextContent) return prev;
                  return { ...prev, [fileName]: nextContent };
                });
                setIsDirty(true);
                setDirtyFiles((prev) => (prev.includes(fileName) ? prev : [...prev, fileName]));
              }}
              embed={false}
              hideFloatingDock={true}
              hideCenterFloatingToolbar={true}
              initialDialect={currentLang}
              initialView={currentView}
              isSplit={isSplit && canSplit && currentView !== "code"}
              canSplit={canSplit}
              onViewChange={handleViewChange}
              onToggleSplit={handleToggleSplit}
              colorMode={theme === "dark" ? "dark" : "light"}
              isVrMode={isVrMode}
              onVrModeChange={setIsVrMode}
              splitOrientation={splitOrientation === "vertical" ? "rows" : "columns"}
              initialVisualizerSubview={
                currentView === "simulation" ||
                currentView === "3d" ||
                currentView === "inspector" ||
                currentView === "diagram"
                  ? currentView
                  : (subviewParam ?? initialSubview) === "simulation" ||
                      (subviewParam ?? initialSubview) === "3d" ||
                      (subviewParam ?? initialSubview) === "inspector" ||
                      (subviewParam ?? initialSubview) === "diagram"
                    ? ((subviewParam ?? initialSubview) as "simulation" | "3d" | "inspector" | "diagram")
                    : undefined
              }
              initialSimulationVariables={initialSimVars}
              initialStartTime={initialStartTime}
              initialStopTime={initialStopTime}
              initialDiagramType={
                diagramTypeParam || (typeof payload?.diagramType === "string" ? payload.diagramType : undefined)
              }
              diagramType={diagramType}
              onDiagramTypeChange={setDiagramType}
              initialClassName={extractPrimaryModelicaClassName(currentCode) || undefined}
              initialAnchor={payload?.anchor}
              externalParams={payload?.params}
              simulateTriggerCount={simulateTriggerCount}
              simulationResetKey={simulationResetKey}
              onCodeChange={handleCodeChange}
              onClassLoaded={handleClassLoaded}
              onActiveViewChange={handleActiveViewChange}
              onParametersChange={handleParametersChange}
              onSimulationStatus={(status: { status?: string } | string | null | undefined) => {
                const s = typeof status === "string" ? status : status?.status;
                setIsSimulating(s === "pending" || s === "processing");
              }}
              onDialectChange={(dialect: string) => {
                if (dialect === currentLang) return;
                // Replace the old language's content with the new language's starter
                // (prompts to discard if there are unsaved changes).
                handleSelectLang(dialect);
              }}
            />
          </ErrorBoundary>
        )}
      </EditorArea>

      {pendingExample && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ansatz-dirty-modal-title"
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
            <h3 id="ansatz-dirty-modal-title" style={{ margin: "0 0 8px 0", fontSize: 16, fontWeight: 600 }}>
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

      {pendingClearWorkspace && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ansatz-clear-modal-title"
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
          onClick={() => {
            setPendingClearWorkspace(false);
            setOpenNewModelAfterClear(false);
          }}
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
            <h3 id="ansatz-clear-modal-title" style={{ margin: "0 0 8px 0", fontSize: 16, fontWeight: 600 }}>
              Clear Workspace
            </h3>
            <p style={{ margin: "0 0 20px 0", fontSize: 13, color: "var(--color-fg-muted)", lineHeight: 1.5 }}>
              Discard unsaved changes and remove all files from the workspace?
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button
                size="small"
                variant="default"
                onClick={() => {
                  setPendingClearWorkspace(false);
                  setOpenNewModelAfterClear(false);
                }}
              >
                Cancel
              </Button>
              <Button
                size="small"
                variant="danger"
                onClick={() => {
                  const shouldOpenNewModel = openNewModelAfterClear;
                  setPendingClearWorkspace(false);
                  setOpenNewModelAfterClear(false);
                  applyClearWorkspace();
                  if (shouldOpenNewModel) {
                    setIsTemplateChoiceRequired(true);
                    setIsTemplatesModalOpen(true);
                  }
                }}
              >
                Discard & Clear
              </Button>
            </div>
          </div>
        </div>
      )}

      <FileConflictModal
        isOpen={Boolean(pendingFileConflict)}
        templateTitle={pendingFileConflict?.templateTitle ?? ""}
        existingFiles={pendingFileConflict?.baseFiles ?? {}}
        incomingFiles={pendingFileConflict?.incomingFiles ?? {}}
        incomingActiveFile={pendingFileConflict?.incomingActiveFile ?? ""}
        onCancel={() => setPendingFileConflict(null)}
        onConfirm={(renamedFiles, resolvedActiveFile) => {
          if (!pendingFileConflict) return;
          const { baseFiles, templateLang, templateTitle } = pendingFileConflict;
          setPendingFileConflict(null);
          applyAddFilesToWorkspace(baseFiles, renamedFiles, resolvedActiveFile, templateLang, templateTitle);
        }}
      />

      <AnsatzEditorShareModal
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
        onClose={() => {
          setIsTemplatesModalOpen(false);
          setIsTemplateChoiceRequired(false);
        }}
        onSelectTemplate={handleAddModelFromTemplate}
        onSelectPendingTemplate={async (title, loadTemplate) => {
          setLoadingTemplateTitle(title);
          try {
            const loaded = await loadTemplate();
            if (loaded) {
              handleAddModelFromTemplate(loaded);
            }
          } catch (err) {
            console.error("[AnsatzEditorPage] Failed to load model:", err);
          } finally {
            setLoadingTemplateTitle(null);
          }
        }}
        currentLang={currentLang}
        lockedLanguage={singleLangLocked ? currentLang : undefined}
        requireChoice={isTemplateChoiceRequired}
      />

      <CreateAnsatzRepoModal
        isOpen={isCreateRepoModalOpen}
        onClose={() => setIsCreateRepoModalOpen(false)}
        currentTitle={currentTitle}
        currentCode={currentCode}
        currentLangExt={getExtensionForDialect(currentLang)}
        onSuccess={handleRepoCreated}
      />
    </AnsatzEditorContainer>
  );
};

export default AnsatzEditorPage;
