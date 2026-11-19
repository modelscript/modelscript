// SPDX-License-Identifier: AGPL-3.0-or-later

import "@modelscript/design-tokens/tokens-web.css";
import type {
  LanguagePanelHost,
  LanguagePanelMode,
  LanguagePanelProps,
  LanguageSimulationCardProps,
} from "@modelscript/react";
import React, { Suspense, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ARTIFACT_PANEL_LOADERS,
  LANGUAGE_SIMULATION_CARDS,
  LANGUAGE_STENCILS,
  MORSEL_PANEL_LOADERS,
  type LanguagePanelLoader,
  type LanguageSimulationCardEntry,
  type LanguageStencilEntry,
} from "virtual:modelscript-language-ui";
import { useTheme } from "../../../theme";
import { compressMorselPayload } from "./permalink";

const lazyComponentCache = new Map<string, React.LazyExoticComponent<React.ComponentType<LanguagePanelProps>>>();

function getOrCreateLazyPanel(
  cacheKey: string,
  loader: LanguagePanelLoader,
): React.LazyExoticComponent<React.ComponentType<LanguagePanelProps>> {
  let cached = lazyComponentCache.get(cacheKey);
  if (!cached) {
    cached = React.lazy(loader);
    lazyComponentCache.set(cacheKey, cached);
  }
  return cached;
}

export function hasMorselLanguagePanel(dialect: string): boolean {
  return Boolean(MORSEL_PANEL_LOADERS[dialect]);
}

export function hasArtifactLanguagePanel(viewTypeOrDialect: string): boolean {
  return Boolean(ARTIFACT_PANEL_LOADERS[viewTypeOrDialect]);
}

export function getDslStencilsForDialect(dialect: string): LanguageStencilEntry[] | undefined {
  return LANGUAGE_STENCILS[dialect];
}

export function triggerBrowserFileDownload(filename: string, content: string | Uint8Array, mimeType?: string): void {
  const blobPart: BlobPart = typeof content === "string" ? content : new Uint8Array(content);
  const blob = new Blob([blobPart], { type: mimeType ?? "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface DslLanguagePanelMountProps {
  registry: "morsel" | "artifact";
  lookupKey: string;
  code: string;
  dialect: string;
  colorMode: "dark" | "light";
  mode: LanguagePanelMode;
  documentUri?: string | undefined;
  projectFiles?: Record<string, string> | undefined;
  viewConfig?: Record<string, unknown> | undefined;
  isFullScreen?: boolean | undefined;
  host: LanguagePanelHost;
  fallback?: React.ReactNode;
}

export const DslLanguagePanelMount: React.FC<DslLanguagePanelMountProps> = ({
  registry,
  lookupKey,
  code,
  dialect,
  colorMode,
  mode,
  documentUri,
  projectFiles,
  viewConfig,
  isFullScreen,
  host,
  fallback = null,
}) => {
  const LazyPanel = useMemo(() => {
    const map = registry === "morsel" ? MORSEL_PANEL_LOADERS : ARTIFACT_PANEL_LOADERS;
    const loader = map[lookupKey];
    if (!loader) return null;
    return getOrCreateLazyPanel(`${registry}:${lookupKey}`, loader);
  }, [registry, lookupKey]);

  if (!LazyPanel) return null;

  return (
    <Suspense fallback={fallback}>
      {React.createElement(LazyPanel, {
        code,
        dialect,
        colorMode,
        mode,
        documentUri,
        projectFiles,
        viewConfig,
        isFullScreen,
        host,
      })}
    </Suspense>
  );
};

export interface DslArtifactPanelWrapperProps {
  viewType: string;
  viewConfig: Record<string, unknown>;
  isFullScreen?: boolean | undefined;
}

/**
 * Ansatz Artifact Card adapter for any DSL-declared language panel.
 * Handles remote artifact text fetching, theme detection, and Open-in-Morsel navigation.
 */
export const DslArtifactPanelWrapper: React.FC<DslArtifactPanelWrapperProps> = ({
  viewType,
  viewConfig,
  isFullScreen = false,
}) => {
  const { colorMode } = useTheme();
  const navigate = useNavigate();
  const inlineCode = typeof viewConfig.code === "string" ? viewConfig.code : "";
  const sourceUrl = typeof viewConfig.url === "string" ? viewConfig.url : undefined;
  const [fetchedCode, setFetchedCode] = useState<string>("");

  useEffect(() => {
    if (inlineCode || !sourceUrl) return;
    let cancelled = false;
    fetch(sourceUrl)
      .then((res) => (res.ok ? res.text() : ""))
      .then((text) => {
        if (!cancelled && text) setFetchedCode(text);
      })
      .catch(() => {
        // Fallback to inline viewConfig metadata
      });
    return () => {
      cancelled = true;
    };
  }, [inlineCode, sourceUrl]);

  const host = useMemo<LanguagePanelHost>(
    () => ({
      exportFile: triggerBrowserFileDownload,
      openInMorsel: (codeToOpen: string, dialect: string, title?: string) => {
        const compressed = compressMorselPayload({ code: codeToOpen, dialect, title });
        navigate(`/playground#morsel=${compressed}`);
      },
      openExternal: (url: string) => {
        window.open(url, "_blank", "noopener,noreferrer");
      },
    }),
    [navigate],
  );

  return (
    <DslLanguagePanelMount
      registry="artifact"
      lookupKey={viewType}
      code={inlineCode || fetchedCode}
      dialect={viewType}
      colorMode={colorMode === "night" || colorMode === "dark" ? "dark" : "light"}
      mode="artifact"
      documentUri={sourceUrl}
      viewConfig={viewConfig}
      isFullScreen={isFullScreen}
      host={host}
    />
  );
};

const lazySimCardCache = new Map<string, React.LazyExoticComponent<React.ComponentType<LanguageSimulationCardProps>>>();

function getOrCreateLazySimCard(
  entry: LanguageSimulationCardEntry,
): React.LazyExoticComponent<React.ComponentType<LanguageSimulationCardProps>> {
  const key = `${entry.languageId}:${entry.id}`;
  let cached = lazySimCardCache.get(key);
  if (!cached) {
    cached = React.lazy(entry.load);
    lazySimCardCache.set(key, cached);
  }
  return cached;
}

export interface DslSimulationCardsStripProps {
  dialect?: string | undefined;
  colorMode: "dark" | "light";
  result: Record<string, unknown>;
  code?: string | undefined;
}

export const DslSimulationCardsStrip: React.FC<DslSimulationCardsStripProps> = ({
  dialect,
  colorMode,
  result,
  code,
}) => {
  const matchingCards = useMemo(() => {
    if (!dialect) return LANGUAGE_SIMULATION_CARDS;
    return LANGUAGE_SIMULATION_CARDS.filter((c) => c.languageId === dialect);
  }, [dialect]);

  const host = useMemo<LanguagePanelHost>(
    () => ({
      exportFile: triggerBrowserFileDownload,
    }),
    [],
  );

  if (matchingCards.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {matchingCards.map((entry) => {
        const LazyCard = getOrCreateLazySimCard(entry);
        return (
          <Suspense key={`${entry.languageId}:${entry.id}`} fallback={null}>
            <LazyCard
              dialect={dialect ?? entry.languageId}
              colorMode={colorMode}
              result={result}
              code={code}
              host={host}
            />
          </Suspense>
        );
      })}
    </div>
  );
};
