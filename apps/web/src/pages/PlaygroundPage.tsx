// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Spinner } from "@primer/react";
import React, { useContext, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { getArtifactView } from "../api";
import { ComposeContext } from "../components/ComposeContext";
import { getLanguageInfo } from "../components/morsel/constants";
import MorselEditor from "../components/morsel/Morsel";
import { compressMorselPayload, decompressMorselPayload } from "../components/morsel/util/permalink";
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
  EditorArea,
  HERO_EXAMPLES,
  type HeroExample,
  type MorselDecodedPayload,
  PLAYGROUND_LANGUAGES,
  PlaygroundContainer,
  PlaygroundNavbar,
  PlaygroundShareModal,
} from "./playground";

const TEMPLATE_ALIASES: Record<string, string> = {
  rlc: "rlc-circuit",
  "rlc-circuit": "rlc-circuit",
  "rlc-filter": "rlc-circuit",
  "bouncing-ball": "bouncing-ball",
  "chua-circuit": "lorenz-attractor",
  "lorenz-attractor": "lorenz-attractor",
  sysml2: "sysml-satellite",
  "sysml2-powertrain": "sysml-satellite",
  "drone-chassis": "scad-flanged-hub",
  cad: "scad-flanged-hub",
  scad: "scad-flanged-hub",
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
  const hasIde = useFeatureFlag("heavy_vscode_ide");

  const modelParam = searchParams.get("model");
  const templateParam = searchParams.get("template");
  const sourceParam = searchParams.get("source");
  const fromArtifactParam = searchParams.get("fromArtifact");
  const langParam = searchParams.get("lang") || searchParams.get("dialect") || searchParams.get("language");
  const titleParam = searchParams.get("title");
  const editPostIdParam = searchParams.get("editPostId");
  const replyToPostIdParam = searchParams.get("replyToPostId");

  const editPostId = editPostIdParam ? Number(editPostIdParam) : undefined;
  const replyToPostId = replyToPostIdParam ? Number(replyToPostIdParam) : undefined;

  const hasInitialArtifactTarget = Boolean(
    fromArtifactParam ||
    (location.hash && (location.hash.startsWith("#memfs:artifact-") || location.hash.startsWith("#m=artifact-"))),
  );

  const [isLoadingArtifact, setIsLoadingArtifact] = useState<boolean>(hasInitialArtifactTarget);
  const [currentCode, setCurrentCode] = useState<string>(hasInitialArtifactTarget ? "" : HERO_EXAMPLES[0]!.code);
  const [currentTitle, setCurrentTitle] = useState<string>(
    titleParam || (hasInitialArtifactTarget ? "Loading Artifact…" : HERO_EXAMPLES[0]!.title),
  );
  const [currentLang, setCurrentLang] = useState<string>(langParam || HERO_EXAMPLES[0]!.lang);
  const [resolvedFromArtifact, setResolvedFromArtifact] = useState<string | null>(fromArtifactParam);
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [pendingExample, setPendingExample] = useState<HeroExample | null>(null);
  const baselineCodeRef = useRef<string>(hasInitialArtifactTarget ? "" : HERO_EXAMPLES[0]!.code);

  usePageTitle(currentTitle ? `${currentTitle} — Playground` : "Playground");
  const [isShareModalOpen, setShareModalOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const [payload, setPayload] = useState<MorselDecodedPayload | null>(null);

  useEffect(() => {
    if (fromArtifactParam) {
      setResolvedFromArtifact(fromArtifactParam);
    }
  }, [fromArtifactParam]);

  // Initialize from URL hash, query params, location.state, or ?fromArtifact=<id>
  useEffect(() => {
    let cancelled = false;

    const buildIdeRedirectUrl = (artifactId: string | number) => {
      const params = new URLSearchParams();
      params.set("fromArtifact", String(artifactId));
      if (langParam) params.set("lang", langParam);
      if (titleParam) params.set("title", titleParam);
      if (editPostId !== undefined && !Number.isNaN(editPostId)) params.set("editPostId", String(editPostId));
      if (replyToPostId !== undefined && !Number.isNaN(replyToPostId)) {
        params.set("replyToPostId", String(replyToPostId));
      }
      const qs = params.toString();
      return `/ide${qs ? `?${qs}` : ""}#memfs:artifact-${artifactId}`;
    };

    // 0. Check #memfs:... hash when redirected from /ide
    let memfsArtifactId: string | null = null;
    let memfsTemplateId: string | null = null;
    let hashArtifactId: string | null = null;
    if (location.hash && location.hash.startsWith("#m=artifact-")) {
      hashArtifactId = decodeURIComponent(location.hash.slice("#m=artifact-".length));
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
              setPayload({
                v: 1,
                lang: detectedLang,
                code: fileCode,
                title: resolvedTitle,
              });
              return;
            }
          }
        } catch {
          // Ignore malformed localStorage package payload
        }
      } else if (memfsTarget.startsWith("artifact-")) {
        memfsArtifactId = memfsTarget.slice("artifact-".length);
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
            const firstFile =
              scratch.code ||
              (scratch.files && typeof scratch.files === "object" ? Object.values(scratch.files)[0] : undefined);
            if (firstFile && (!scratch.id || String(scratch.id) === memfsArtifactId)) {
              const resolvedTitle = titleParam || scratch.title || `Artifact #${memfsArtifactId}`;
              const detectedLang =
                langParam || scratch.language || inferDialectFromFilename(resolvedTitle) || "modelica";
              setResolvedFromArtifact(memfsArtifactId);
              baselineCodeRef.current = firstFile;
              setIsDirty(false);
              setIsLoadingArtifact(false);
              setCurrentCode(firstFile);
              setCurrentTitle(resolvedTitle);
              setCurrentLang(detectedLang);
              setPayload({
                v: 1,
                lang: detectedLang,
                code: firstFile,
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
      !location.hash.startsWith("#m=artifact-")
    ) {
      const p = decompressMorselPayload(location.hash) as
        | (MorselDecodedPayload & {
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
          const detectedLang = p.lang || langParam || inferDialectFromFilename(p.title || titleParam) || "modelica";
          baselineCodeRef.current = p.code;
          setIsDirty(false);
          setIsLoadingArtifact(false);
          setPayload({ ...p, lang: detectedLang });
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

          if (!code && cfg.files && typeof cfg.files === "object" && !Array.isArray(cfg.files)) {
            const firstContent = Object.values(cfg.files)[0];
            if (typeof firstContent === "string") {
              code = firstContent;
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
          const detectedLang = langParam || inferDialectFromArtifact(art, resolvedTitle);

          setCurrentTitle(resolvedTitle);
          setCurrentLang(detectedLang);
          if (code) {
            baselineCodeRef.current = code;
            setIsDirty(false);
            setCurrentCode(code);
            setPayload({
              v: 1,
              lang: detectedLang,
              code,
              title: resolvedTitle,
            });
            const hash = compressMorselPayload({
              v: 1,
              lang: detectedLang,
              code,
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
    setCurrentLang(nextLang);
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
    if (editPostId !== undefined && !Number.isNaN(editPostId)) {
      params.set("editPostId", String(editPostId));
    }
    if (replyToPostId !== undefined && !Number.isNaN(replyToPostId)) {
      params.set("replyToPostId", String(replyToPostId));
    }
    navigate(`/ide?${params.toString()}`);
  };

  const getShareUrl = () => {
    const hash = compressMorselPayload({
      v: 1,
      lang: currentLang,
      code: currentCode,
      title: currentTitle,
      view: payload?.view,
      anchor: payload?.anchor,
      ...(resolvedFromArtifact ? { artifactId: resolvedFromArtifact } : {}),
    });
    return `${window.location.origin}/playground#m=${hash}`;
  };

  const getEmbedCode = (format: "iframe" | "custom-tag" = "iframe") => {
    const hash = compressMorselPayload({
      v: 1,
      lang: currentLang,
      code: currentCode,
      title: currentTitle,
      view: payload?.view,
      anchor: payload?.anchor,
      ...(resolvedFromArtifact ? { artifactId: resolvedFromArtifact } : {}),
    });
    if (format === "custom-tag") {
      const anchorAttr = payload?.anchor?.elementId ? ` anchor="${payload.anchor.elementId}"` : "";
      return `<script type="module" src="${window.location.origin}/static/embed.js"></script>\n<modelscript-viewer dialect="${currentLang}" view="${payload?.view || "diagram"}"${anchorAttr}>\n${currentCode}\n</modelscript-viewer>`;
    }
    return `<iframe src="${window.location.origin}/embed/playground#m=${hash}" width="100%" height="600" frameborder="0" allow="clipboard-write"></iframe>`;
  };

  const getMarkdownBadge = () => {
    const url = getShareUrl();
    return `[![Open in Ansatz Playground](https://img.shields.io/badge/Ansatz-Playground-06b6d4?style=flat&logo=atom)](${url})`;
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
    const numericArtifactId =
      resolvedFromArtifact && !Number.isNaN(Number(resolvedFromArtifact)) ? Number(resolvedFromArtifact) : null;

    const defaultContent = editPostId
      ? undefined
      : replyToPostId
        ? `Here is my updated **${currentTitle}** (${currentLang.toUpperCase()}) model:`
        : numericArtifactId
          ? `Forked and modified **${currentTitle}** (from Artifact #${numericArtifactId})! 🚀`
          : `Check out my simulation model: **${currentTitle}**! 🚀`;

    const composePayload: any = {
      ...(defaultContent !== undefined ? { content: defaultContent } : {}),
      morselPayload: {
        code: currentCode,
        title: currentTitle,
        dialect: currentLang,
        isMultiFile: false,
        ...(numericArtifactId ? { forkedFromArtifactId: numericArtifactId } : {}),
      },
      forkedFromArtifactId: numericArtifactId,
      ...(editPostId !== undefined && !Number.isNaN(editPostId) ? { editPostId } : {}),
      ...(replyToPostId !== undefined && !Number.isNaN(replyToPostId)
        ? { replyToPostId, replyToPost: { id: replyToPostId } }
        : {}),
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

  const handleTitleChange = (nextTitle: string) => {
    setCurrentTitle(nextTitle);
    setPayload((prev) => ({
      ...(prev || { v: 1 }),
      lang: currentLang,
      code: currentCode,
      title: nextTitle,
    }));
    const hash = compressMorselPayload({
      v: 1,
      lang: currentLang,
      code: currentCode,
      title: nextTitle,
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
        isDirty={isDirty}
        publishLabel={publishLabel}
        onTitleChange={handleTitleChange}
        onSelectExample={handleSelectExample}
        onSelectLang={handleSelectLang}
        onOpenInVsCode={handleOpenInVsCode}
        onDownloadModel={handleDownloadModel}
        onCopyEmbed={() => handleCopy(getEmbedCode(), "Embed Code")}
        onOpenShare={() => setShareModalOpen(true)}
        onPublishToFeed={handlePublishToFeed}
      />

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
            initialView={payload?.view}
            initialAnchor={payload?.anchor}
            onCodeChange={handleCodeChange}
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
    </PlaygroundContainer>
  );
};

export default PlaygroundPage;
