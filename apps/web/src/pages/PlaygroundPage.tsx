// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useContext, useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ComposeContext } from "../components/ComposeContext";
import MorselEditor from "../components/morsel/Morsel";
import { compressMorselPayload, decompressMorselPayload } from "../components/morsel/util/permalink";
import { useToast } from "../components/ToastContext";
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

  const [currentCode, setCurrentCode] = useState<string>(HERO_EXAMPLES[0]!.code);
  const [currentTitle, setCurrentTitle] = useState<string>(HERO_EXAMPLES[0]!.name);
  usePageTitle(currentTitle ? `${currentTitle} — Playground` : "Playground");
  const [isShareModalOpen, setShareModalOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const [payload, setPayload] = useState<MorselDecodedPayload | null>(null);

  // Initialize from URL hash or query params on load
  useEffect(() => {
    if (location.hash && location.hash.length > 1) {
      const p = decompressMorselPayload(location.hash) as MorselDecodedPayload | null;
      if (p && p.code) {
        setPayload(p);
        setCurrentCode(p.code);
        if (p.title) setCurrentTitle(p.title);
      }
    } else if (sourceParam) {
      const decodedSource = decodeURIComponent(sourceParam);
      const title = searchParams.get("title") ? decodeURIComponent(searchParams.get("title")!) : "Custom Model";
      setCurrentCode(decodedSource);
      setCurrentTitle(title);
      const hash = compressMorselPayload({
        v: 1,
        lang: "modelica",
        code: decodedSource,
        title,
      });
      window.history.replaceState(null, "", `#m=${hash}`);
    } else if (modelParam) {
      const match = HERO_EXAMPLES.find(
        (ex) =>
          ex.id.toLowerCase() === modelParam.toLowerCase() || ex.name.toLowerCase().includes(modelParam.toLowerCase()),
      );
      if (match) {
        setCurrentCode(match.code);
        setCurrentTitle(match.name);
        const hash = compressMorselPayload({
          v: 1,
          lang: match.lang,
          code: match.code,
          title: match.name,
        });
        window.history.replaceState(null, "", `#m=${hash}`);
      } else {
        const sanitized = modelParam.split(".").pop() || modelParam;
        const code = `// Parameterized model handoff: ${modelParam}\nmodel ${sanitized} "${modelParam} simulation"\n  Real x(start = 1.0) "State variable";\n  Real y(start = 0.0) "Coupled variable";\nequation\n  der(x) = -y;\n  der(y) = x;\nend ${sanitized};\n`;
        setCurrentCode(code);
        setCurrentTitle(sanitized);
        const hash = compressMorselPayload({
          v: 1,
          lang: "modelica",
          code,
          title: sanitized,
        });
        window.history.replaceState(null, "", `#m=${hash}`);
      }
    }
  }, [location.hash, modelParam, sourceParam, searchParams]);

  useEffect(() => {
    const handleOpenShare = () => setShareModalOpen(true);
    window.addEventListener("modelscript:open-share-modal", handleOpenShare);
    return () => window.removeEventListener("modelscript:open-share-modal", handleOpenShare);
  }, []);

  const handleSelectExample = (ex: HeroExample) => {
    setCurrentCode(ex.code);
    setCurrentTitle(ex.name);
    const hash = compressMorselPayload({
      v: 1,
      lang: ex.lang,
      code: ex.code,
      title: ex.name,
    });
    window.history.replaceState(null, "", `#m=${hash}`);
  };

  const getShareUrl = () => {
    const hash = compressMorselPayload({
      v: 1,
      lang: payload?.lang || "modelica",
      code: currentCode,
      title: currentTitle,
      view: payload?.view,
      anchor: payload?.anchor,
    });
    return `${window.location.origin}/playground#m=${hash}`;
  };

  const getEmbedCode = (format: "iframe" | "custom-tag" = "iframe") => {
    const hash = compressMorselPayload({
      v: 1,
      lang: payload?.lang || "modelica",
      code: currentCode,
      title: currentTitle,
      view: payload?.view,
      anchor: payload?.anchor,
    });
    if (format === "custom-tag") {
      const anchorAttr = payload?.anchor?.elementId ? ` anchor="${payload.anchor.elementId}"` : "";
      return `<script type="module" src="${window.location.origin}/static/embed.js"></script>\n<modelscript-viewer dialect="${payload?.lang || "modelica"}" view="${payload?.view || "diagram"}"${anchorAttr}>\n${currentCode}\n</modelscript-viewer>`;
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
    const fromArtifactId = fromArtifactParam ? Number(fromArtifactParam) : null;
    if (openCompose) {
      openCompose({
        content: `Check out my simulation model: **${currentTitle}**! 🚀`,
        morselPayload: {
          code: currentCode,
          title: currentTitle,
          dialect: "modelica",
        },
        forkedFromArtifactId: fromArtifactId,
      });
    } else {
      navigate("/home");
    }
  };

  const handleDownloadModel = () => {
    const blob = new Blob([currentCode], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentTitle.replace(/[^a-zA-Z0-9_-]/g, "_") || "model"}.mo`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PlaygroundContainer>
      <PlaygroundNavbar
        fromArtifactParam={fromArtifactParam}
        currentTitle={currentTitle}
        onSelectExample={handleSelectExample}
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
          initialDialect={payload?.lang}
          initialView={payload?.view}
          initialAnchor={payload?.anchor}
          onCodeChange={(code: string) => {
            setCurrentCode(code);
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
