// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  LanguagePanelHost,
  LanguagePanelMode,
  LanguagePanelProps,
  LanguageSimulationCardProps,
} from "@modelscript/react";
import React, { Suspense, useEffect, useMemo, useState } from "react";
import { getEditorLanguageUi, useEditorHost } from "../../host";
import { normalizeInspectorDialect } from "../panels/inspector-capabilities";
import { InspectorErrorBoundary, InspectorLoadingSkeleton } from "../panels/InspectorErrorBoundary";
import { compressAnsatzPayload } from "./permalink";

export type LanguagePanelLoader = () => Promise<{ default: React.ComponentType<LanguagePanelProps> }>;
export interface LanguageSimulationCardEntry {
  id: string;
  title: string;
  standards?: string[];
  loader: () => Promise<{ default: React.ComponentType<LanguageSimulationCardProps> }>;
}
export interface LanguageStencilEntry {
  label: string;
  className: string;
  snippet: string;
  category?: string;
}

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

export function hasAnsatzLanguagePanel(dialect: string): boolean {
  const panels = getEditorLanguageUi().ansatzPanels;
  return Boolean(panels[dialect] ?? panels[normalizeInspectorDialect(dialect)]);
}

export function hasArtifactLanguagePanel(viewTypeOrDialect: string): boolean {
  const panels = getEditorLanguageUi().artifactPanels;
  return Boolean(panels[viewTypeOrDialect] ?? panels[normalizeInspectorDialect(viewTypeOrDialect)]);
}

export function getDslStencilsForDialect(dialect: string): LanguageStencilEntry[] | undefined {
  const stencils = getEditorLanguageUi().stencils;
  return stencils[dialect] ?? stencils[normalizeInspectorDialect(dialect)];
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
  registry: "ansatz" | "artifact";
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
  fallback,
}) => {
  const resolvedKey = useMemo(() => {
    const ui = getEditorLanguageUi();
    const map = registry === "ansatz" ? ui.ansatzPanels : ui.artifactPanels;
    if (map[lookupKey]) return lookupKey;
    const canonical = normalizeInspectorDialect(lookupKey);
    return map[canonical] ? canonical : lookupKey;
  }, [registry, lookupKey]);

  const LazyPanel = useMemo(() => {
    const ui = getEditorLanguageUi();
    const map = registry === "ansatz" ? ui.ansatzPanels : ui.artifactPanels;
    const loader = map[resolvedKey];
    if (!loader) return null;
    return getOrCreateLazyPanel(`${registry}:${resolvedKey}`, loader as unknown as LanguagePanelLoader);
  }, [registry, resolvedKey]);

  if (!LazyPanel) return null;

  const instanceKey = `${registry}:${resolvedKey}:${documentUri ?? ""}`;

  return (
    <InspectorErrorBoundary panelName={`${resolvedKey.toUpperCase()} Inspector`} resetKey={instanceKey}>
      <Suspense fallback={fallback ?? <InspectorLoadingSkeleton label={`Loading ${resolvedKey} inspector…`} />}>
        <div
          data-theme={colorMode}
          style={{
            flex: 1,
            minHeight: 0,
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {React.createElement(LazyPanel, {
            key: instanceKey,
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
        </div>
      </Suspense>
    </InspectorErrorBoundary>
  );
};

export interface DslArtifactPanelWrapperProps {
  viewType: string;
  viewConfig: Record<string, unknown>;
  isFullScreen?: boolean | undefined;
}

/**
 * Ansatz Artifact Card adapter for any DSL-declared language panel.
 * Handles remote artifact text fetching, theme detection, and Open-in-Ansatz navigation.
 */
export const DslArtifactPanelWrapper: React.FC<DslArtifactPanelWrapperProps> = ({
  viewType,
  viewConfig,
  isFullScreen = false,
}) => {
  const editorHost = useEditorHost();
  const inlineCode = typeof viewConfig.code === "string" ? viewConfig.code : "";
  const sourceUrl = typeof viewConfig.url === "string" ? viewConfig.url : undefined;
  const [fetchedCode, setFetchedCode] = useState<string>("");

  useEffect(() => {
    setFetchedCode("");
    if (inlineCode || !sourceUrl) return;
    let cancelled = false;
    fetch(sourceUrl)
      .then((res) => (res.ok ? res.text() : ""))
      .then((text) => {
        if (!cancelled) setFetchedCode(text || "");
      })
      .catch(() => {
        if (!cancelled) setFetchedCode("");
      });
    return () => {
      cancelled = true;
    };
  }, [inlineCode, sourceUrl]);

  const host = useMemo<LanguagePanelHost>(
    () => ({
      exportFile: triggerBrowserFileDownload,
      openInAnsatzEditor: (codeToOpen: string, dialect: string, title?: string) => {
        const compressed = compressAnsatzPayload({ code: codeToOpen, dialect, title });
        if (editorHost.navigate) {
          editorHost.navigate(`/editor#ansatz=${compressed}`);
        } else if (typeof window !== "undefined") {
          window.location.href = `/editor#ansatz=${compressed}`;
        }
      },
      openExternal: (url: string) => {
        window.open(url, "_blank", "noopener,noreferrer");
      },
    }),
    [editorHost],
  );

  return (
    <DslLanguagePanelMount
      registry="artifact"
      lookupKey={viewType}
      code={inlineCode || fetchedCode}
      dialect={viewType}
      colorMode={editorHost.theme === "dark" ? "dark" : "light"}
      mode="artifact"
      documentUri={sourceUrl}
      viewConfig={viewConfig}
      isFullScreen={isFullScreen}
      host={host}
    />
  );
};

const lazySimCardCache = new Map<string, React.LazyExoticComponent<React.ComponentType<LanguageSimulationCardProps>>>();

function getOrCreateLazySimCard(entry: {
  id: string;
  languageId: string;
  load: () => Promise<{ default: React.ComponentType<LanguageSimulationCardProps> }>;
}): React.LazyExoticComponent<React.ComponentType<LanguageSimulationCardProps>> {
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
    if (!dialect) return [];
    const cards = getEditorLanguageUi().simulationCards;
    return cards.filter((c) => c.languageId === dialect);
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
        const LazyCard = getOrCreateLazySimCard(
          entry as unknown as {
            id: string;
            languageId: string;
            load: () => Promise<{ default: React.ComponentType<LanguageSimulationCardProps> }>;
          },
        );
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
