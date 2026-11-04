// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button } from "@primer/react";
import React, { useContext, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { createArtifactView, getArtifactView } from "../api";
import { useAuth } from "../AuthContext";
import { ComposeContext } from "../components/ComposeContext";
import { getLanguageInfo } from "../components/morsel/constants";
import MorselEditor from "../components/morsel/Morsel";
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
  const langParam = searchParams.get("lang") || searchParams.get("dialect") || searchParams.get("language");
  const titleParam = searchParams.get("title");
  const editPostIdParam = searchParams.get("editPostId");
  const replyToPostIdParam = searchParams.get("replyToPostId");

  const editPostId = editPostIdParam || undefined;
  const replyToPostId = replyToPostIdParam || undefined;

  const hasInitialArtifactTarget = Boolean(
    fromArtifactParam ||
    morselParam ||
    (location.hash &&
      (location.hash.startsWith("#memfs:artifact-") ||
        location.hash.startsWith("#m=artifact-") ||
        /^#memfs:\d+/.test(location.hash) ||
        /^#m=\d+/.test(location.hash))),
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
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [pendingExample, setPendingExample] = useState<HeroExample | null>(null);
  const baselineCodeRef = useRef<string>(defaultInitialCode);

  usePageTitle(currentTitle ? `${currentTitle} — ModelScript Playground` : "ModelScript Playground");
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
    } else if (location.hash && /^#m=\d+/.test(location.hash)) {
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
      !/^#m=\d+/.test(location.hash)
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
            toast.error("Failed to load artifact into Playground");
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
            setPayload({
              v: 1,
              lang: detectedLang,
              code,
              ...(isMulti && filesMap
                ? { files: filesMap, activeFile: resolvedActiveFile || undefined, isMultiFile: true }
                : {}),
              ...(viewParam ? { view: viewParam } : {}),
              title: resolvedTitle,
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
            toast.error("Failed to load artifact into Playground");
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
    return `${window.location.origin}/playground#m=${hash}`;
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
    const embedSrc = `${window.location.origin}/embed/playground#m=${hash}`;
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
    return `[![Open in ModelScript Playground](https://img.shields.io/badge/ModelScript-Playground-0284c7?style=flat&logo=codefactor)](${url})`;
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
      ? undefined
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
            onClick: () => navigate(`/playground?fromArtifact=${created.id}`),
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

  const [currentView, setCurrentView] = useState<"diagram" | "code" | "split" | "simulation">(
    viewParam === "code" || viewParam === "simulation" || viewParam === "split" ? viewParam : "diagram",
  );
  const [simulateTriggerCount, setSimulateTriggerCount] = useState(0);

  const handleViewChange = (nextView: "diagram" | "code" | "split" | "simulation") => {
    setCurrentView(nextView);
    handleActiveViewChange(nextView as any);
  };

  const handleRunSimulation = () => {
    if (currentView !== "simulation" && currentView !== "split") {
      setCurrentView("simulation");
      handleActiveViewChange("simulation");
    }
    setSimulateTriggerCount((c) => c + 1);
  };

  const handleActiveViewChange = (nextView: "diagram" | "simulation" | "3d" | "inspector" | "code") => {
    if (nextView === "diagram" || nextView === "simulation" || nextView === "code") {
      setCurrentView(nextView);
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
  };

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
        ? "Fork to Feed"
        : "Post to Feed";

  return (
    <PlaygroundContainer>
      <PlaygroundNavbar
        fromArtifactParam={resolvedFromArtifact}
        currentTitle={currentTitle}
        currentLang={currentLang}
        currentView={currentView}
        isDirty={isDirty}
        publishLabel={publishLabel}
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
            <div style={{ fontSize: 13, fontWeight: 500 }}>Loading artifact into Playground…</div>
          </div>
        ) : (
          <MorselEditor
            dataUrl={null}
            initialCode={currentCode}
            embed={false}
            initialDialect={currentLang}
            initialView={currentView}
            initialAnchor={payload?.anchor}
            externalParams={payload?.params}
            simulateTriggerCount={simulateTriggerCount}
            onCodeChange={handleCodeChange}
            onActiveViewChange={handleActiveViewChange}
            onParametersChange={handleParametersChange}
            onDialectChange={(dialect: string) => {
              setCurrentLang(dialect);
            }}
          />
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
