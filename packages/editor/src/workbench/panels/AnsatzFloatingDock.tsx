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
  ShieldCheckIcon,
  SidebarCollapseIcon,
  SidebarExpandIcon,
  SparklesFillIcon,
  StackIcon,
  SunIcon,
  UnwrapIcon,
  UploadIcon,
  WorkflowIcon,
} from "@primer/octicons-react";
import { ActionList, ActionMenu, IconButton } from "@primer/react";
import React from "react";
import { useEditorCapabilities as useCapabilities, useEditorFeatureFlag as useFeatureFlag } from "../../host";
import { getLanguageInfo, useVisibleAnsatzLanguages } from "../constants";
import type { Translations } from "../util/i18n";
import { AnsatzView } from "./types";
export { AnsatzView };

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

export interface AnsatzFloatingDockProps {
  colorMode: "dark" | "light";
  dialect?: string | undefined;
  onSelectDialect?: ((dialect: string) => void) | undefined;
  treeVisible: boolean;
  setTreeVisible: React.Dispatch<React.SetStateAction<boolean>>;
  translations: Translations | Record<string, string>;
  onNewModel: (e: React.MouseEvent) => void;
  openFileButtonRef: React.RefObject<HTMLButtonElement | null>;
  onOpenFile: () => void;
  onSaveModel: () => void;
  onAutoLayout: () => void;
  view: AnsatzView;
  setView: (v: AnsatzView) => void;
  isNarrow: boolean;
  onSimulate: () => void;
  onOpenCloudModal: () => void;
  onFlatten: () => void;
  onRunOnDemandLints?: ((mode: "all" | "formal" | "compiler") => void) | undefined;
  isRunningOnDemandLints?: boolean | undefined;
  shareButtonRef: React.RefObject<HTMLButtonElement | null>;
  isShareDialogOpen: boolean;
  setShareDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  availableLanguages: string[];
  language: string | null;
  setLanguage: (lang: string | null) => void;
  setContextVersion: React.Dispatch<React.SetStateAction<number>>;
  isDark: boolean;
  toggleTheme: () => void;
  isAiOpen?: boolean | undefined;
  onToggleAi?: (() => void) | undefined;
}

export const AnsatzFloatingDock: React.FC<AnsatzFloatingDockProps> = ({
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
  onRunOnDemandLints,
  isRunningOnDemandLints = false,
  shareButtonRef,
  isShareDialogOpen,
  setShareDialogOpen,
  availableLanguages,
  language,
  setLanguage,
  setContextVersion,
  isDark,
  toggleTheme,
  isAiOpen = false,
  onToggleAi,
}) => {
  const { hasCapability } = useCapabilities();
  const hasCloudSolverFlag = useFeatureFlag("cae_cloud_solver");
  const hasAnsatzAiFlag = useFeatureFlag("ansatz_ai");
  const isCaeComputeEnabled = hasCloudSolverFlag && hasCapability("caeCompute");
  const visibleAnsatzLanguages = useVisibleAnsatzLanguages();
  const activeLangInfo = getLanguageInfo(dialect);
  const isAnsatzEditorRoute = typeof window !== "undefined" && window.location.pathname.startsWith("/editor");
  if (isNarrow) return null;
  if (isAnsatzEditorRoute && view !== AnsatzView.CODE) return null;
  return (
    <div
      style={{
        position: "fixed",
        ...(isAnsatzEditorRoute ? { top: 56 } : { bottom: 16 }),
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 16px",
        borderRadius: "var(--ms-radius-lg, 12px)",
        backgroundColor: "var(--ms-surface-glass)",
        backdropFilter: "blur(12px)",
        border: "1px solid var(--borderColor-default, var(--ms-border))",
        boxShadow: "var(--ms-shadow-pop, 0 4px 24px rgba(0, 0, 0, 0.25))",
        zIndex: 1000,
      }}
    >
      {!isAnsatzEditorRoute && (
        <>
          <a
            href="https://github.com/modelscript/modelscript"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center" }}
          >
            <img src="/ansatz-logo.svg" alt="Ansatz" style={{ height: 20 }} />
          </a>
          <div
            style={{ width: 1, height: 20, backgroundColor: "var(--color-border-default, var(--ms-divider, #30363d))" }}
          />
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
                {visibleAnsatzLanguages.map((lang) => (
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
          <div
            style={{ width: 1, height: 20, backgroundColor: "var(--color-border-default, var(--ms-divider, #30363d))" }}
          />
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
      <div
        style={{ width: 1, height: 20, backgroundColor: "var(--color-border-default, var(--ms-divider, #30363d))" }}
      />
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
      {!isAnsatzEditorRoute && (
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
          <div
            style={{ width: 1, height: 20, backgroundColor: "var(--color-border-default, var(--ms-divider, #30363d))" }}
          />
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
      <div
        style={{ width: 1, height: 20, backgroundColor: "var(--color-border-default, var(--ms-divider, #30363d))" }}
      />
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
          onClick={() => setView(AnsatzView.DIAGRAM)}
          style={
            view === AnsatzView.DIAGRAM
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
              onClick={() => setView(AnsatzView.SPLIT_COLUMNS)}
              style={
                view === AnsatzView.SPLIT_COLUMNS
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
              onClick={() => setView(AnsatzView.SPLIT_ROWS)}
              style={
                view === AnsatzView.SPLIT_ROWS
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
          onClick={() => setView(AnsatzView.CODE)}
          style={
            view === AnsatzView.CODE
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
          <div style={{ width: 1, height: 20, backgroundColor: "var(--ms-divider, rgba(255, 255, 255, 0.08))" }} />
          <IconButton
            icon={PlayIcon}
            size="small"
            variant="invisible"
            aria-label={translations.simulateModel}
            title={translations.simulateModel}
            onClick={onSimulate}
          />
          {isCaeComputeEnabled && (
            <IconButton
              icon={ServerIcon}
              size="small"
              variant="invisible"
              aria-label="Run on Ansatz Cloud HPC"
              title="Run on Ansatz Cloud HPC"
              onClick={onOpenCloudModal}
            />
          )}
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
      {onRunOnDemandLints && (
        <>
          <div style={{ width: 1, height: 20, backgroundColor: "var(--ms-divider, rgba(255, 255, 255, 0.08))" }} />
          <ActionMenu>
            <ActionMenu.Anchor>
              <IconButton
                icon={ShieldCheckIcon}
                size="small"
                variant="invisible"
                disabled={isRunningOnDemandLints}
                aria-label="Run Formal & Compiler Lints"
                title="Run Formal Verification & WASM Compiler Lints"
              />
            </ActionMenu.Anchor>
            <ActionMenu.Overlay width="medium">
              <ActionList>
                <ActionList.Item onSelect={() => onRunOnDemandLints("all")}>
                  Run All On-Demand Checks (Formal + Compiler)
                </ActionList.Item>
                <ActionList.Item onSelect={() => onRunOnDemandLints("formal")}>
                  Run Formal Verification Only (S7xxx / M7xxx)
                </ActionList.Item>
                <ActionList.Item onSelect={() => onRunOnDemandLints("compiler")}>
                  Run WASM Compiler Lints Only (Tier-1 CST)
                </ActionList.Item>
              </ActionList>
            </ActionMenu.Overlay>
          </ActionMenu>
        </>
      )}
      {!isAnsatzEditorRoute && (
        <>
          <div style={{ width: 1, height: 20, backgroundColor: "var(--ms-divider, rgba(255, 255, 255, 0.08))" }} />
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
      <div style={{ width: 1, height: 20, backgroundColor: "var(--ms-divider, rgba(255, 255, 255, 0.08))" }} />
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
                  <span
                    style={{ fontSize: 10, color: "var(--ms-text-2, #a1a1aa)", fontWeight: 600, letterSpacing: 0.5 }}
                  >
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
          <div style={{ width: 1, height: 20, backgroundColor: "var(--ms-divider, rgba(255, 255, 255, 0.08))" }} />
        </>
      )}
      {hasAnsatzAiFlag && onToggleAi && (
        <IconButton
          icon={SparklesFillIcon}
          size="small"
          variant={isAiOpen ? "primary" : "invisible"}
          aria-label="Toggle Ansatz AI Assistant"
          title="Ansatz AI Assistant"
          onClick={onToggleAi}
        />
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
