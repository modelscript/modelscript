// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ColumnsIcon,
  DownloadIcon,
  FileIcon,
  FlowchartIcon,
  GlobeIcon,
  MoonIcon,
  PlayIcon,
  RowsIcon,
  ServerIcon,
  ShareAndroidIcon,
  SidebarCollapseIcon,
  SidebarExpandIcon,
  StackIcon,
  SunIcon,
  UnwrapIcon,
  UploadIcon,
  WorkflowIcon,
} from "@primer/octicons-react";
import { ActionList, ActionMenu, IconButton } from "@primer/react";
import React from "react";
import { MORSEL_LANGUAGES, getLanguageInfo } from "../constants";
import { MorselView } from "./types";
export { MorselView };

const LANGUAGE_NAMES: Record<string, string> = {
  ar: "العربية (Arabic)",
  de: "Deutsch (German)",
  en: "English",
  fr: "Français (French)",
  it: "Italiano (Italian)",
  ja: "日本語 (Japanese)",
  ko: "한국어 (Korean)",
  pt: "Português (Portuguese)",
  ru: "Русский (Russian)",
  tr: "Türkçe (Turkish)",
  zh: "中文 (Chinese)",
};

export interface MorselFloatingDockProps {
  colorMode: "dark" | "light";
  dialect?: string | undefined;
  onSelectDialect?: ((dialect: string) => void) | undefined;
  treeVisible: boolean;
  setTreeVisible: React.Dispatch<React.SetStateAction<boolean>>;
  translations: any;
  onNewModel: (e: React.MouseEvent) => void;
  openFileButtonRef: React.RefObject<HTMLButtonElement | null>;
  onOpenFile: () => void;
  onSaveModel: () => void;
  onAutoLayout: () => void;
  view: MorselView;
  setView: (v: MorselView) => void;
  isNarrow: boolean;
  onSimulate: () => void;
  onOpenCloudModal: () => void;
  onFlatten: () => void;
  shareButtonRef: React.RefObject<HTMLButtonElement | null>;
  isShareDialogOpen: boolean;
  setShareDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  availableLanguages: string[];
  language: string | null;
  setLanguage: (lang: string | null) => void;
  setContextVersion: React.Dispatch<React.SetStateAction<number>>;
  isDark: boolean;
  toggleTheme: () => void;
}

export const MorselFloatingDock: React.FC<MorselFloatingDockProps> = ({
  colorMode,
  dialect = "modelica",
  onSelectDialect,
  treeVisible,
  setTreeVisible,
  translations,
  onNewModel,
  openFileButtonRef,
  onOpenFile,
  onSaveModel,
  onAutoLayout,
  view,
  setView,
  isNarrow,
  onSimulate,
  onOpenCloudModal,
  onFlatten,
  shareButtonRef,
  isShareDialogOpen,
  setShareDialogOpen,
  availableLanguages,
  language,
  setLanguage,
  setContextVersion,
  isDark,
  toggleTheme,
}) => {
  const activeLangInfo = getLanguageInfo(dialect);
  const isPlaygroundRoute = typeof window !== "undefined" && window.location.pathname.startsWith("/playground");
  if (isNarrow) return null;
  if (isPlaygroundRoute && view !== MorselView.CODE) return null;
  return (
    <div
      style={{
        position: "fixed",
        ...(isPlaygroundRoute ? { top: 56 } : { bottom: 16 }),
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 16px",
        borderRadius: 12,
        backgroundColor: colorMode === "dark" ? "rgba(22, 27, 34, 0.9)" : "rgba(255, 255, 255, 0.9)",
        backdropFilter: "blur(12px)",
        boxShadow:
          colorMode === "dark"
            ? "0 4px 24px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.08)"
            : "0 4px 24px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.06)",
        zIndex: 1000,
      }}
    >
      {!isPlaygroundRoute && (
        <>
          <a
            href="https://github.com/modelscript/modelscript"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center" }}
          >
            <img src={colorMode === "dark" ? "/brand-dark.png" : "/brand.png"} alt="Morsel" style={{ height: 20 }} />
          </a>
          <div style={{ width: 1, height: 20, backgroundColor: colorMode === "dark" ? "#30363d" : "#d0d7de" }} />
          <ActionMenu>
            <ActionMenu.Button
              size="small"
              variant="invisible"
              aria-label="Select Language Dialect"
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "2px 8px",
                color: colorMode === "dark" ? "#e6edf3" : "#1f2328",
              }}
            >
              {activeLangInfo.name}{" "}
              <span style={{ opacity: 0.6, fontWeight: 400, marginLeft: 2 }}>.{activeLangInfo.ext}</span>
            </ActionMenu.Button>
            <ActionMenu.Overlay width="medium" style={{ maxHeight: 340, overflowY: "auto" }}>
              <ActionList selectionVariant="single">
                {MORSEL_LANGUAGES.map((lang) => (
                  <ActionList.Item
                    key={lang.id}
                    selected={activeLangInfo.id === lang.id}
                    onSelect={() => onSelectDialect?.(lang.id)}
                  >
                    {lang.name}
                    <ActionList.TrailingVisual>.{lang.ext}</ActionList.TrailingVisual>
                  </ActionList.Item>
                ))}
              </ActionList>
            </ActionMenu.Overlay>
          </ActionMenu>
          <div style={{ width: 1, height: 20, backgroundColor: colorMode === "dark" ? "#30363d" : "#d0d7de" }} />
        </>
      )}
      <IconButton
        icon={treeVisible ? SidebarExpandIcon : SidebarCollapseIcon}
        size="small"
        variant="invisible"
        aria-label={translations.toggleTree}
        title={translations.toggleTree}
        onClick={() => setTreeVisible((prev) => !prev)}
        style={
          treeVisible
            ? {
                backgroundColor: colorMode === "dark" ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.8)",
                borderRadius: 6,
              }
            : {}
        }
      />
      <div style={{ width: 1, height: 20, backgroundColor: colorMode === "dark" ? "#30363d" : "#d0d7de" }} />
      <IconButton
        icon={FileIcon}
        size="small"
        variant="invisible"
        aria-label={translations.newModel}
        title={translations.newModel}
        type="button"
        onClick={onNewModel}
      />
      <IconButton
        icon={UploadIcon}
        size="small"
        variant="invisible"
        aria-label={translations.openModel}
        title={translations.openModel}
        ref={openFileButtonRef}
        onClick={onOpenFile}
      />
      {!isPlaygroundRoute && (
        <IconButton
          icon={DownloadIcon}
          size="small"
          variant="invisible"
          aria-label={translations.saveModel}
          title={translations.saveModel}
          onClick={onSaveModel}
        />
      )}
      {activeLangInfo.supportsDiagram && (
        <>
          <div style={{ width: 1, height: 20, backgroundColor: colorMode === "dark" ? "#30363d" : "#d0d7de" }} />
          <IconButton
            icon={FlowchartIcon}
            size="small"
            variant="invisible"
            aria-label={translations.autoLayout}
            title={translations.autoLayout}
            onClick={onAutoLayout}
          />
        </>
      )}
      <div style={{ width: 1, height: 20, backgroundColor: colorMode === "dark" ? "#30363d" : "#d0d7de" }} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: 2,
          borderRadius: 8,
          backgroundColor: colorMode === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
        }}
      >
        <IconButton
          icon={WorkflowIcon}
          size="small"
          variant="invisible"
          aria-label={translations.diagramView}
          title={translations.diagramView}
          onClick={() => setView(MorselView.DIAGRAM)}
          style={
            view === MorselView.DIAGRAM
              ? {
                  backgroundColor: colorMode === "dark" ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.8)",
                  borderRadius: 6,
                }
              : {}
          }
        />
        {!isNarrow && (
          <>
            <IconButton
              icon={ColumnsIcon}
              size="small"
              variant="invisible"
              aria-label={translations.splitViewColumns}
              title={translations.splitViewColumns}
              onClick={() => setView(MorselView.SPLIT_COLUMNS)}
              style={
                view === MorselView.SPLIT_COLUMNS
                  ? {
                      backgroundColor: colorMode === "dark" ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.8)",
                      borderRadius: 6,
                    }
                  : {}
              }
            />
            <IconButton
              icon={RowsIcon}
              size="small"
              variant="invisible"
              aria-label={translations.splitViewRows}
              title={translations.splitViewRows}
              onClick={() => setView(MorselView.SPLIT_ROWS)}
              style={
                view === MorselView.SPLIT_ROWS
                  ? {
                      backgroundColor: colorMode === "dark" ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.8)",
                      borderRadius: 6,
                    }
                  : {}
              }
            />
          </>
        )}
        <IconButton
          icon={UnwrapIcon}
          size="small"
          variant="invisible"
          aria-label={translations.codeView}
          title={translations.codeView}
          onClick={() => setView(MorselView.CODE)}
          style={
            view === MorselView.CODE
              ? {
                  backgroundColor: colorMode === "dark" ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.8)",
                  borderRadius: 6,
                }
              : {}
          }
        />
      </div>
      {activeLangInfo.supportsSimulation && (
        <>
          <div style={{ width: 1, height: 20, backgroundColor: colorMode === "dark" ? "#30363d" : "#d0d7de" }} />
          <IconButton
            icon={PlayIcon}
            size="small"
            variant="invisible"
            aria-label={translations.simulateModel}
            title={translations.simulateModel}
            onClick={onSimulate}
          />
          <IconButton
            icon={ServerIcon}
            size="small"
            variant="invisible"
            aria-label="Run on ModelScript Cloud HPC"
            title="Run on ModelScript Cloud HPC"
            onClick={onOpenCloudModal}
          />
          <IconButton
            icon={StackIcon}
            size="small"
            variant="invisible"
            aria-label={translations.flattenModel}
            title={translations.flattenModel}
            onClick={onFlatten}
          />
        </>
      )}
      {!isPlaygroundRoute && (
        <>
          <div style={{ width: 1, height: 20, backgroundColor: colorMode === "dark" ? "#30363d" : "#d0d7de" }} />
          <IconButton
            icon={ShareAndroidIcon}
            size="small"
            variant="invisible"
            aria-label={translations.shareModel}
            ref={shareButtonRef}
            onClick={() => setShareDialogOpen(!isShareDialogOpen)}
          />
        </>
      )}
      <div style={{ width: 1, height: 20, backgroundColor: colorMode === "dark" ? "#30363d" : "#d0d7de" }} />
      {availableLanguages.length > 0 && (
        <>
          <ActionMenu>
            <ActionMenu.Anchor>
              <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                <IconButton
                  icon={GlobeIcon}
                  size="small"
                  variant="invisible"
                  aria-label={translations.language}
                  title={
                    language
                      ? `${translations.language}: ${LANGUAGE_NAMES[language] || language}`
                      : `${translations.language}: ${translations.default}`
                  }
                />
                {language && (
                  <span style={{ fontSize: 10, color: "#8b949e", fontWeight: 600, letterSpacing: 0.5 }}>
                    {language.toUpperCase()}
                  </span>
                )}
              </div>
            </ActionMenu.Anchor>
            <ActionMenu.Overlay>
              <ActionList selectionVariant="single">
                <ActionList.Item
                  selected={language === null}
                  onSelect={() => {
                    setLanguage(null);
                    setContextVersion((v) => v + 1);
                  }}
                >
                  {translations.default}
                </ActionList.Item>
                {availableLanguages.map((lang) => (
                  <ActionList.Item
                    key={lang}
                    selected={language === lang}
                    onSelect={() => {
                      setLanguage(lang);
                      setContextVersion((v) => v + 1);
                    }}
                  >
                    {LANGUAGE_NAMES[lang] || lang}
                  </ActionList.Item>
                ))}
              </ActionList>
            </ActionMenu.Overlay>
          </ActionMenu>
          <div style={{ width: 1, height: 20, backgroundColor: colorMode === "dark" ? "#30363d" : "#d0d7de" }} />
        </>
      )}
      <IconButton
        icon={isDark ? SunIcon : MoonIcon}
        size="small"
        variant="invisible"
        aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
        onClick={toggleTheme}
      />
    </div>
  );
};
