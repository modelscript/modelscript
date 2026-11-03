// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CodeIcon,
  DownloadIcon,
  FileIcon,
  FlowchartIcon,
  KebabHorizontalIcon,
  LinkIcon,
  PlayIcon,
  ServerIcon,
  UnwrapIcon,
  UploadIcon,
} from "@primer/octicons-react";
import { ActionList, ActionMenu, IconButton } from "@primer/react";
import React from "react";
import { useCapabilities } from "../../../CapabilitiesContext";
import { useFeatureFlag } from "../../../FeatureFlagContext";
import { getLanguageInfo, useVisibleMorselLanguages } from "../constants";
import { MorselView } from "./types";

export type MobileTab = "code" | "params" | "results" | "diagram" | "cad" | "inspector";

export interface MorselMobileTabBarProps {
  isNarrow: boolean;
  mobileTab: MobileTab;
  setMobileTab: (tab: MobileTab) => void;
  setTreeVisible: (visible: boolean) => void;
  setView: (view: MorselView) => void;
  setShowResultsView: (show: boolean) => void;
  setShowCadView: (show: boolean) => void;
  setShowAnalysisView?: ((show: boolean) => void) | undefined;
  onSimulate: () => void;
  simulationStatus: any;
  dialect?: string | undefined;
  onSelectDialect?: ((dialect: string) => void) | undefined;
  onNewModel?: ((e: React.MouseEvent) => void) | undefined;
  onOpenFile?: (() => void) | undefined;
  onSaveModel?: (() => void) | undefined;
  onAutoLayout?: (() => void) | undefined;
  onFlatten?: (() => void) | undefined;
  onOpenCloudModal?: (() => void) | undefined;
  hasParameterRibbon?: boolean | undefined;
}

const TAB_LABELS: Record<MobileTab, string> = {
  code: "Code",
  params: "Tune",
  results: "Results",
  diagram: "Diagram",
  cad: "3D",
  inspector: "Inspect",
};

export const MorselMobileTabBar: React.FC<MorselMobileTabBarProps> = ({
  isNarrow,
  mobileTab,
  setMobileTab,
  setTreeVisible,
  setView,
  setShowResultsView,
  setShowCadView,
  setShowAnalysisView,
  onSimulate,
  simulationStatus,
  dialect = "modelica",
  onSelectDialect,
  onNewModel,
  onOpenFile,
  onSaveModel,
  onAutoLayout,
  onFlatten,
  onOpenCloudModal,
  hasParameterRibbon = false,
}) => {
  const { hasCapability } = useCapabilities();
  const hasCloudSolverFlag = useFeatureFlag("cae_cloud_solver");
  const isCaeComputeEnabled = hasCloudSolverFlag && hasCapability("caeCompute");
  const visibleMorselLanguages = useVisibleMorselLanguages();
  const activeLangInfo = getLanguageInfo(dialect);
  const isPlaygroundRoute = typeof window !== "undefined" && window.location.pathname.startsWith("/playground");

  if (!isNarrow) return null;

  const isSimulating = simulationStatus?.status === "pending" || simulationStatus?.status === "processing";
  const hasToolsMenu = Boolean(
    onNewModel || onOpenFile || onSaveModel || onAutoLayout || onFlatten || onOpenCloudModal || onSelectDialect,
  );

  const selectTab = (tab: MobileTab) => {
    setMobileTab(tab);
    switch (tab) {
      case "code":
        setTreeVisible(false);
        setView(MorselView.CODE);
        setShowAnalysisView?.(false);
        break;
      case "params":
        setTreeVisible(true);
        break;
      case "results":
        setTreeVisible(false);
        setView(MorselView.DIAGRAM);
        setShowResultsView(true);
        setShowCadView(false);
        setShowAnalysisView?.(false);
        break;
      case "diagram":
        setTreeVisible(false);
        setView(MorselView.DIAGRAM);
        setShowResultsView(false);
        setShowCadView(false);
        setShowAnalysisView?.(false);
        break;
      case "cad":
        setTreeVisible(false);
        setView(MorselView.DIAGRAM);
        setShowResultsView(false);
        setShowCadView(true);
        setShowAnalysisView?.(false);
        break;
      case "inspector":
        setTreeVisible(false);
        setView(MorselView.DIAGRAM);
        setShowResultsView(false);
        setShowCadView(false);
        setShowAnalysisView?.(true);
        break;
    }
  };

  return (
    <>
      <div
        role="tablist"
        aria-label="Playground view"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "4px",
          background: "var(--color-canvas-subtle)",
          borderBottom: "1px solid var(--color-border-default)",
          padding: "6px 8px",
          flexShrink: 0,
          zIndex: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            overflowX: "auto",
            flex: 1,
            minWidth: 0,
          }}
        >
          {(Object.keys(TAB_LABELS) as MobileTab[]).map((tab) => {
            const active = mobileTab === tab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => selectTab(tab)}
                style={{
                  height: "30px",
                  padding: "0 12px",
                  fontSize: "13px",
                  fontFamily: "inherit",
                  fontWeight: active ? 600 : 500,
                  borderRadius: "999px",
                  border: "1px solid",
                  borderColor: active ? "color-mix(in srgb, var(--ms-brand, #0891b2) 45%, transparent)" : "transparent",
                  background: active ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.14))" : "transparent",
                  color: active ? "var(--ms-link, #0891b2)" : "var(--ms-text-2, inherit)",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {TAB_LABELS[tab]}
              </button>
            );
          })}
        </div>

        {hasToolsMenu && (
          <ActionMenu>
            <ActionMenu.Anchor>
              <IconButton
                icon={KebabHorizontalIcon}
                size="small"
                variant="invisible"
                aria-label="Model tools and actions"
                title="Model tools and actions"
                style={{ flexShrink: 0 }}
              />
            </ActionMenu.Anchor>
            <ActionMenu.Overlay width="medium" align="end">
              <ActionList>
                {onNewModel && (
                  <ActionList.Item onSelect={(e) => onNewModel(e as unknown as React.MouseEvent)}>
                    <ActionList.LeadingVisual>
                      <FileIcon />
                    </ActionList.LeadingVisual>
                    New Model
                  </ActionList.Item>
                )}
                {onOpenFile && (
                  <ActionList.Item onSelect={onOpenFile}>
                    <ActionList.LeadingVisual>
                      <UploadIcon />
                    </ActionList.LeadingVisual>
                    Open File…
                  </ActionList.Item>
                )}
                {onSaveModel && !isPlaygroundRoute && (
                  <ActionList.Item onSelect={onSaveModel}>
                    <ActionList.LeadingVisual>
                      <DownloadIcon />
                    </ActionList.LeadingVisual>
                    Download Model (.{activeLangInfo.ext})
                  </ActionList.Item>
                )}
                {activeLangInfo.supportsDiagram && onAutoLayout && (
                  <ActionList.Item
                    onSelect={() => {
                      if (mobileTab !== "diagram") selectTab("diagram");
                      onAutoLayout();
                    }}
                  >
                    <ActionList.LeadingVisual>
                      <FlowchartIcon />
                    </ActionList.LeadingVisual>
                    Auto-Layout Diagram
                  </ActionList.Item>
                )}
                {activeLangInfo.supportsFlattening && onFlatten && (
                  <ActionList.Item onSelect={onFlatten}>
                    <ActionList.LeadingVisual>
                      <UnwrapIcon />
                    </ActionList.LeadingVisual>
                    Flatten DAE
                  </ActionList.Item>
                )}
                {isCaeComputeEnabled && activeLangInfo.supportsSimulation && onOpenCloudModal && (
                  <ActionList.Item onSelect={onOpenCloudModal}>
                    <ActionList.LeadingVisual>
                      <ServerIcon />
                    </ActionList.LeadingVisual>
                    Cloud HPC Solver…
                  </ActionList.Item>
                )}
                {!isPlaygroundRoute && onSelectDialect && (
                  <>
                    <ActionList.Divider />
                    <ActionList.Group title="Engineering Dialect">
                      {visibleMorselLanguages.map((lang) => (
                        <ActionList.Item
                          key={lang.id}
                          selected={activeLangInfo.id === lang.id}
                          onSelect={() => onSelectDialect(lang.id)}
                        >
                          <ActionList.LeadingVisual>
                            <CodeIcon />
                          </ActionList.LeadingVisual>
                          {lang.name}
                          <ActionList.TrailingVisual>.{lang.ext}</ActionList.TrailingVisual>
                        </ActionList.Item>
                      ))}
                    </ActionList.Group>
                  </>
                )}
              </ActionList>
            </ActionMenu.Overlay>
          </ActionMenu>
        )}
      </div>

      {/* Scoped floating mobile action pill: stays inside the Morsel container and respects safe-area insets. */}
      <div
        style={{
          position: "absolute",
          bottom: hasParameterRibbon
            ? "calc(64px + env(safe-area-inset-bottom, 0px))"
            : "calc(16px + env(safe-area-inset-bottom, 0px))",
          right: "16px",
          zIndex: 95,
          display: "flex",
          alignItems: "center",
          gap: "8px",
          background: "var(--surface-overlay, rgba(15, 22, 38, 0.92))",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          padding: "6px",
          borderRadius: "9999px",
          border: "1px solid var(--ms-border, rgba(148, 163, 184, 0.2))",
          boxShadow: "var(--ms-shadow-pop, 0 10px 30px rgba(0, 0, 0, 0.5))",
          transition: "bottom 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <button
          type="button"
          onClick={onSimulate}
          disabled={isSimulating}
          className="ms-btn ms-btn-primary"
          aria-label={isSimulating ? "Simulating" : "Simulate"}
        >
          {isSimulating ? (
            <>
              <span
                style={{
                  display: "inline-block",
                  width: "12px",
                  height: "12px",
                  border: "2px solid currentColor",
                  borderTopColor: "transparent",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                }}
              />
              <span>Simulating…</span>
            </>
          ) : (
            <>
              <PlayIcon size={14} />
              <span>Simulate</span>
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            if (navigator.share) {
              navigator
                .share({
                  title: "Ansatz Simulation (powered by ModelScript)",
                  url: window.location.href,
                })
                .catch(() => {});
            } else {
              window.dispatchEvent(new CustomEvent("modelscript:open-share-modal"));
              navigator.clipboard?.writeText(window.location.href);
            }
          }}
          className="ms-btn ms-btn-secondary"
          style={{ width: "36px", padding: 0 }}
          title="Share interactive model"
          aria-label="Share interactive model"
        >
          <LinkIcon size={14} />
        </button>
      </div>
    </>
  );
};
