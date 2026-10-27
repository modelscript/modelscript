// SPDX-License-Identifier: AGPL-3.0-or-later

import { LinkExternalIcon } from "@primer/octicons-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import styled from "styled-components";
import { getArtifactView } from "../api";
import { getLanguageInfo } from "../components/morsel/constants";
import MorselEditor from "../components/morsel/Morsel";
import { decompressMorselPayload } from "../components/morsel/util/permalink";
import {
  buildEditorUrlForArtifact,
  inferDialectFromArtifact,
  inferDialectFromFilename,
  isMultiFileArtifact,
} from "../util/editor-routing";
import { safeJsonParse } from "../util/json";
import { useOembedDiscovery, usePageTitle } from "../util/title";

const EmbedContainer = styled.div`
  width: 100vw;
  height: 100vh;
  position: relative;
  overflow: hidden;
  background-color: var(--color-canvas-default, #0d1117);
`;

const WatermarkPill = styled.a`
  position: fixed;
  bottom: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(13, 17, 23, 0.85);
  border: 1px solid var(--color-border-default, #30363d);
  padding: 4px 10px;
  border-radius: 999px;
  color: var(--color-fg-muted, #8b949e);
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  text-decoration: none;
  backdrop-filter: blur(8px);
  z-index: 100;
  transition: all 0.2s ease;

  &:hover {
    color: var(--color-accent-cyan, #06b6d4);
    border-color: rgba(6, 182, 212, 0.4);
    text-decoration: none;
  }
`;

const ScrollHintBadge = styled.div<{ $visible: boolean }>`
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(13, 17, 23, 0.92);
  color: #f0f6fc;
  border: 1px solid rgba(6, 182, 212, 0.4);
  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.5),
    0 0 16px rgba(6, 182, 212, 0.2);
  padding: 8px 18px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  font-family: var(--font-mono, monospace);
  pointer-events: none;
  backdrop-filter: blur(8px);
  z-index: 200;
  opacity: ${(props) => (props.$visible ? 1 : 0)};
  transition: opacity 0.2s ease;
`;

export const EmbedPlaygroundPage: React.FC = () => {
  const location = useLocation();
  const initialSearchParams = new URLSearchParams(location.search);
  const initialLangParam =
    initialSearchParams.get("lang") || initialSearchParams.get("dialect") || initialSearchParams.get("language");
  const [currentCode, setCurrentCode] = useState<string>(
    initialLangParam ? getLanguageInfo(initialLangParam).defaultCode : "model Example\n\nend Example;",
  );
  const [targetInfo, setTargetInfo] = useState<{ target: "playground" | "ide"; url: string }>({
    target: "playground",
    url: `/playground${location.search}${location.hash}`,
  });

  const [payload, setPayload] = useState<any>(null);
  const embedTitle =
    payload?.title ||
    initialSearchParams.get("title") ||
    (payload?.lang ? `${payload.lang.toUpperCase()} Simulation` : "Interactive Engineering Model");
  usePageTitle(embedTitle);
  useOembedDiscovery(typeof window !== "undefined" ? window.location.href : undefined, embedTitle);

  const [showScrollHint, setShowScrollHint] = useState<boolean>(false);
  const scrollHintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) {
      setShowScrollHint(true);
      if (scrollHintTimeoutRef.current) {
        clearTimeout(scrollHintTimeoutRef.current);
      }
      scrollHintTimeoutRef.current = setTimeout(() => {
        setShowScrollHint(false);
      }, 1500);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (scrollHintTimeoutRef.current) {
        clearTimeout(scrollHintTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(location.search);
    const fromArtifact = params.get("fromArtifact");
    const sourceParam = params.get("source");
    const langParam = params.get("lang") || params.get("dialect") || params.get("language");
    const titleParam = params.get("title");

    // 1. Check URL hash (#m=...)
    if (location.hash && location.hash.length > 1) {
      const p = decompressMorselPayload(location.hash);
      if (p && p.code) {
        const detectedLang = p.lang || langParam || inferDialectFromFilename(p.title || titleParam) || "modelica";
        const resolvedTitle = p.title || titleParam;
        setPayload({
          ...p,
          lang: detectedLang,
          ...(resolvedTitle ? { title: resolvedTitle } : {}),
        });
        setCurrentCode(p.code);
        if (p.isMultiFile && (p.artifactId || fromArtifact)) {
          const artId = p.artifactId || fromArtifact;
          const anchorQuery = p.anchor?.elementId ? `&anchor=${encodeURIComponent(p.anchor.elementId)}` : "";
          const ideUrl = `/ide?fromArtifact=${encodeURIComponent(String(artId))}${anchorQuery}#memfs:artifact-${artId}`;
          setTargetInfo({ target: "ide", url: ideUrl });
        } else {
          setTargetInfo({ target: "playground", url: `/playground${location.search}${location.hash}` });
        }
        return;
      }
    }

    // 2. Check ?source=... query parameter
    if (sourceParam) {
      const resolvedTitle = titleParam || "Custom Model";
      const detectedLang = langParam || inferDialectFromFilename(resolvedTitle) || "modelica";
      setCurrentCode(sourceParam);
      setPayload({
        v: 1,
        lang: detectedLang,
        code: sourceParam,
        title: resolvedTitle,
      });
      const editorUrl = buildEditorUrlForArtifact({
        artifactId: fromArtifact || undefined,
        code: sourceParam,
        title: resolvedTitle,
        dialect: detectedLang,
      });
      setTargetInfo({
        target: "playground",
        url: editorUrl,
      });
      return;
    }

    // 3. Check ?fromArtifact=<id>
    if (fromArtifact) {
      (async () => {
        try {
          const res = await getArtifactView(fromArtifact);
          if (cancelled) return;
          const art = res?.artifactView || res?.artifact_view || res;
          if (!art) return;
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
            titleParam || art.title || cfg.title || cfg.modelName || cfg.projectTitle || `Artifact #${fromArtifact}`;
          const dialect = langParam || inferDialectFromArtifact(art, resolvedTitle);
          if (code) {
            setCurrentCode(code);
          }
          setPayload({
            title: resolvedTitle,
            lang: dialect,
          });
          const editorUrl = buildEditorUrlForArtifact({
            artifactId: fromArtifact,
            viewType: art.view_type,
            viewConfig: cfg,
            code,
            title: resolvedTitle,
            dialect,
          });
          setTargetInfo({
            target: isMultiFileArtifact(art) ? "ide" : "playground",
            url: editorUrl,
          });
        } catch {
          // Ignore error in embed fallback
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    // 4. If only ?lang= or ?title= was passed
    if (langParam || titleParam) {
      const detectedLang = langParam || inferDialectFromFilename(titleParam) || "modelica";
      const langInfo = getLanguageInfo(detectedLang);
      if (langParam && langInfo.defaultCode) {
        setCurrentCode(langInfo.defaultCode);
      }
      setPayload((prev: any) => ({
        ...(prev || { v: 1 }),
        lang: detectedLang,
        ...(titleParam ? { title: titleParam } : {}),
      }));
      setTargetInfo({
        target: "playground",
        url: `/playground${location.search}${location.hash}`,
      });
    }

    return () => {
      cancelled = true;
    };
  }, [location.hash, location.search]);

  const isMac = typeof navigator !== "undefined" && navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const searchParams = new URLSearchParams(location.search);
  const showRibbon = searchParams.get("controls") !== "none";
  const resolvedDialect =
    payload?.lang ||
    searchParams.get("lang") ||
    searchParams.get("dialect") ||
    searchParams.get("language") ||
    undefined;

  return (
    <EmbedContainer onWheel={handleWheel}>
      <MorselEditor
        dataUrl={null}
        initialCode={currentCode}
        embed={true}
        showParameterRibbon={showRibbon}
        initialDialect={resolvedDialect as any}
        initialView={payload?.view || (searchParams.get("view") as any)}
        initialAnchor={payload?.anchor}
      />
      <ScrollHintBadge $visible={showScrollHint}>{isMac ? "Hold ⌘ to zoom" : "Hold Ctrl to zoom"}</ScrollHintBadge>
      <WatermarkPill
        href={targetInfo.url}
        target="_blank"
        rel="noopener noreferrer"
        title={
          targetInfo.target === "ide"
            ? "Open full project in ModelScript IDE"
            : "Open interactive model in ModelScript Playground"
        }
      >
        <span>{targetInfo.target === "ide" ? "ModelScript IDE 🛠️" : "ModelScript Playground ⚡"}</span>
        <LinkExternalIcon size={12} />
      </WatermarkPill>
    </EmbedContainer>
  );
};

export default EmbedPlaygroundPage;
