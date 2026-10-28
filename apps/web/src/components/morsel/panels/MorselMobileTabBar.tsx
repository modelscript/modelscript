// SPDX-License-Identifier: AGPL-3.0-or-later

import { LinkIcon, PlayIcon } from "@primer/octicons-react";
import React from "react";
import { MorselView } from "./types";

export type MobileTab = "code" | "params" | "results" | "diagram" | "cad";

export interface MorselMobileTabBarProps {
  isNarrow: boolean;
  mobileTab: MobileTab;
  setMobileTab: (tab: MobileTab) => void;
  setTreeVisible: (visible: boolean) => void;
  setView: (view: MorselView) => void;
  setShowResultsView: (show: boolean) => void;
  setShowCadView: (show: boolean) => void;
  onSimulate: () => void;
  simulationStatus: any;
}

const TAB_LABELS: Record<MobileTab, string> = {
  code: "Code",
  params: "Params",
  results: "Results",
  diagram: "Diagram",
  cad: "3D",
};

export const MorselMobileTabBar: React.FC<MorselMobileTabBarProps> = ({
  isNarrow,
  mobileTab,
  setMobileTab,
  setTreeVisible,
  setView,
  setShowResultsView,
  setShowCadView,
  onSimulate,
  simulationStatus,
}) => {
  if (!isNarrow) return null;

  const isSimulating = simulationStatus?.status === "pending" || simulationStatus?.status === "processing";

  const selectTab = (tab: MobileTab) => {
    setMobileTab(tab);
    switch (tab) {
      case "code":
        setTreeVisible(false);
        setView(MorselView.CODE);
        break;
      case "params":
        setTreeVisible(true);
        break;
      case "results":
        setTreeVisible(false);
        setView(MorselView.DIAGRAM);
        setShowResultsView(true);
        setShowCadView(false);
        break;
      case "diagram":
        setTreeVisible(false);
        setView(MorselView.DIAGRAM);
        setShowResultsView(false);
        setShowCadView(false);
        break;
      case "cad":
        setTreeVisible(false);
        setView(MorselView.DIAGRAM);
        setShowResultsView(false);
        setShowCadView(true);
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
          gap: "4px",
          background: "var(--color-canvas-subtle)",
          borderBottom: "1px solid var(--color-border-default)",
          padding: "6px 8px",
          overflowX: "auto",
          flexShrink: 0,
          zIndex: 10,
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

      {/* Floating mobile action pill: the single Run/Share entry point on phones. */}
      <div
        style={{
          position: "fixed",
          bottom: "84px",
          right: "16px",
          zIndex: 9999,
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
                  title: "ModelScript Simulation",
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
