// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useContext, useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { getArtifactView } from "../api";
import { ComposeContext } from "../components/ComposeContext";
import MorselEditor from "../components/morsel/Morsel";
import { compressMorselPayload, decompressMorselPayload } from "../components/morsel/util/permalink";
import { useToast } from "../components/ToastContext";
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
  PlaygroundContainer,
  PlaygroundNavbar,
  PlaygroundShareModal,
} from "./playground";

export const PlaygroundPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { openCompose } = useContext(ComposeContext);
  const toast = useToast();

  const modelParam = searchParams.get("model");
  const sourceParam = searchParams.get("source");
  const fromArtifactParam = searchParams.get("fromArtifact");
  const langParam = searchParams.get("lang") || searchParams.get("dialect") || searchParams.get("language");
  const titleParam = searchParams.get("title");
  const editPostIdParam = searchParams.get("editPostId");
  const replyToPostIdParam = searchParams.get("replyToPostId");

  const editPostId = editPostIdParam ? Number(editPostIdParam) : undefined;
  const replyToPostId = replyToPostIdParam ? Number(replyToPostIdParam) : undefined;

  const [currentCode, setCurrentCode] = useState<string>(HERO_EXAMPLES[0]!.code);
  const [currentTitle, setCurrentTitle] = useState<string>(HERO_EXAMPLES[0]!.title);
  const [currentLang, setCurrentLang] = useState<string>(langParam || HERO_EXAMPLES[0]!.lang);
  const [resolvedFromArtifact, setResolvedFromArtifact] = useState<string | null>(fromArtifactParam);

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

    // 1. Check URL hash (#m=...)
    if (location.hash && location.hash.length > 1) {
      const p = decompressMorselPayload(location.hash) as
        | (MorselDecodedPayload & {
            isMultiFile?: boolean;
            artifactId?: string | number;
          })
        | null;

      if (p) {
        if (p.isMultiFile && (p.artifactId || fromArtifactParam)) {
          navigate(buildIdeRedirectUrl((p.artifactId || fromArtifactParam)!), { replace: true });
          return;
        }
        if (p.artifactId && !fromArtifactParam) {
          setResolvedFromArtifact(String(p.artifactId));
        }
        if (p.code) {
          const detectedLang = p.lang || langParam || inferDialectFromFilename(p.title || titleParam) || "modelica";
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

    // 4. Check ?fromArtifact=<id> (fetch artifact from API when code wasn't embedded in #m= or ?source=)
    if (fromArtifactParam) {
      (async () => {
        try {
          const res = await getArtifactView(fromArtifactParam);
          if (cancelled) return;
          const art = res?.artifactView || res;
          if (!art) return;

          if (isMultiFileArtifact(art)) {
            navigate(buildIdeRedirectUrl(fromArtifactParam), { replace: true });
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
            `Artifact #${fromArtifactParam}`;
          const detectedLang = langParam || inferDialectFromArtifact(art, resolvedTitle);

          setCurrentTitle(resolvedTitle);
          setCurrentLang(detectedLang);
          if (code) {
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
              artifactId: String(fromArtifactParam),
            });
            window.history.replaceState(window.history.state, "", `${location.pathname}${location.search}#m=${hash}`);
          } else {
            setPayload((prev) => ({
              ...(prev || { v: 1 }),
              lang: detectedLang,
              title: resolvedTitle,
            }));
          }
        } catch (err) {
          console.warn("[PlaygroundPage] Failed to load artifact from ?fromArtifact=", fromArtifactParam, err);
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    // 5. Check ?model=<name>
    if (modelParam) {
      const match = HERO_EXAMPLES.find(
        (ex) =>
          ex.id.toLowerCase() === modelParam.toLowerCase() || ex.title.toLowerCase().includes(modelParam.toLowerCase()),
      );
      if (match) {
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
      } else {
        const rawIdent = modelParam.split(".").pop() || modelParam;
        const safeIdent = rawIdent.replace(/[^A-Za-z0-9_]/g, "_") || "UntitledModel";
        const detectedLang = langParam || "modelica";
        const code = `model ${safeIdent}\n  // ${modelParam}\nend ${safeIdent};\n`;
        setCurrentCode(code);
        setCurrentTitle(safeIdent);
        setCurrentLang(detectedLang);
        setPayload({
          v: 1,
          lang: detectedLang,
          code,
          title: safeIdent,
        });
        const hash = compressMorselPayload({
          v: 1,
          lang: detectedLang,
          code,
          title: safeIdent,
        });
        window.history.replaceState(window.history.state, "", `${location.pathname}${location.search}#m=${hash}`);
      }
      return;
    }

    // 6. If only ?lang= or ?title= was passed
    if (langParam) {
      setCurrentLang(langParam);
      const matchingExample = HERO_EXAMPLES.find((ex) => ex.lang === langParam);
      if (matchingExample) {
        setCurrentCode(matchingExample.code);
        setCurrentTitle(titleParam || matchingExample.title);
        setPayload({
          v: 1,
          lang: langParam,
          code: matchingExample.code,
          title: titleParam || matchingExample.title,
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
    sourceParam,
    fromArtifactParam,
    langParam,
    titleParam,
    editPostId,
    replyToPostId,
    navigate,
  ]);

  useEffect(() => {
    const handleOpenShare = () => setShareModalOpen(true);
    window.addEventListener("modelscript:open-share-modal", handleOpenShare);
    return () => window.removeEventListener("modelscript:open-share-modal", handleOpenShare);
  }, []);

  const handleSelectExample = (ex: HeroExample) => {
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

  const handleSelectLang = (nextLang: string) => {
    setCurrentLang(nextLang);
    // If current code matches one of the unmodified starter examples, load the starter example for nextLang if available
    const isCurrentStarter = HERO_EXAMPLES.some((ex) => ex.code.trim() === currentCode.trim());
    const nextStarter = HERO_EXAMPLES.find((ex) => ex.lang === nextLang);
    const nextCode = isCurrentStarter && nextStarter ? nextStarter.code : currentCode;
    const nextTitle = isCurrentStarter && nextStarter ? nextStarter.title : currentTitle;

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
    return `[![Open in ModelScript Playground](https://img.shields.io/badge/ModelScript-Playground-06b6d4?style=flat&logo=atom)](${url})`;
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
        publishLabel={publishLabel}
        onSelectExample={handleSelectExample}
        onSelectLang={handleSelectLang}
        onOpenInVsCode={handleOpenInVsCode}
        onDownloadModel={handleDownloadModel}
        onCopyEmbed={() => handleCopy(getEmbedCode(), "Embed Code")}
        onOpenShare={() => setShareModalOpen(true)}
        onPublishToFeed={handlePublishToFeed}
      />

      <EditorArea>
        <MorselEditor
          dataUrl={null}
          initialCode={currentCode}
          embed={false}
          initialDialect={currentLang}
          initialView={payload?.view}
          initialAnchor={payload?.anchor}
          onCodeChange={(code: string) => {
            setCurrentCode(code);
          }}
          onDialectChange={(dialect: string) => {
            setCurrentLang(dialect);
          }}
        />
      </EditorArea>

      <PlaygroundShareModal
        isOpen={isShareModalOpen}
        onClose={() => setShareModalOpen(false)}
        copyStatus={copyStatus}
        shareUrl={getShareUrl()}
        embedCode={getEmbedCode()}
        markdownBadge={getMarkdownBadge()}
        onCopy={handleCopy}
      />
    </PlaygroundContainer>
  );
};

export default PlaygroundPage;
