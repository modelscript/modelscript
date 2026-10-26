// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
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

  return (
    <>
      <div
        role="tablist"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "var(--color-canvas-subtle)",
          borderBottom: "1px solid var(--color-border-default)",
          padding: "4px 8px",
          overflowX: "auto",
          flexShrink: 0,
          gap: "4px",
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === "code"}
            onClick={() => {
              setMobileTab("code");
              setTreeVisible(false);
              setView(MorselView.CODE);
            }}
            style={{
              padding: "6px 10px",
              fontSize: "12px",
              fontWeight: mobileTab === "code" ? 600 : 400,
              borderRadius: "6px",
              border: "none",
              background: mobileTab === "code" ? "var(--color-accent-emphasis, #0969da)" : "transparent",
              color: mobileTab === "code" ? "white" : "inherit",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              whiteSpace: "nowrap",
            }}
          >
            💻 Code
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === "params"}
            onClick={() => {
              setMobileTab("params");
              setTreeVisible(true);
            }}
            style={{
              padding: "6px 10px",
              fontSize: "12px",
              fontWeight: mobileTab === "params" ? 600 : 400,
              borderRadius: "6px",
              border: "none",
              background: mobileTab === "params" ? "var(--color-accent-emphasis, #0969da)" : "transparent",
              color: mobileTab === "params" ? "white" : "inherit",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              whiteSpace: "nowrap",
            }}
          >
            ⚙️ Params
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === "results"}
            onClick={() => {
              setMobileTab("results");
              setTreeVisible(false);
              setView(MorselView.DIAGRAM);
              setShowResultsView(true);
              setShowCadView(false);
            }}
            style={{
              padding: "6px 10px",
              fontSize: "12px",
              fontWeight: mobileTab === "results" ? 600 : 400,
              borderRadius: "6px",
              border: "none",
              background: mobileTab === "results" ? "var(--color-accent-emphasis, #0969da)" : "transparent",
              color: mobileTab === "results" ? "white" : "inherit",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              whiteSpace: "nowrap",
            }}
          >
            📊 Results
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === "diagram"}
            onClick={() => {
              setMobileTab("diagram");
              setTreeVisible(false);
              setView(MorselView.DIAGRAM);
              setShowResultsView(false);
              setShowCadView(false);
            }}
            style={{
              padding: "6px 10px",
              fontSize: "12px",
              fontWeight: mobileTab === "diagram" ? 600 : 400,
              borderRadius: "6px",
              border: "none",
              background: mobileTab === "diagram" ? "var(--color-accent-emphasis, #0969da)" : "transparent",
              color: mobileTab === "diagram" ? "white" : "inherit",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              whiteSpace: "nowrap",
            }}
          >
            📐 Diagram
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === "cad"}
            onClick={() => {
              setMobileTab("cad");
              setTreeVisible(false);
              setView(MorselView.DIAGRAM);
              setShowResultsView(false);
              setShowCadView(true);
            }}
            style={{
              padding: "6px 10px",
              fontSize: "12px",
              fontWeight: mobileTab === "cad" ? 600 : 400,
              borderRadius: "6px",
              border: "none",
              background: mobileTab === "cad" ? "var(--color-accent-emphasis, #0969da)" : "transparent",
              color: mobileTab === "cad" ? "white" : "inherit",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              whiteSpace: "nowrap",
            }}
          >
            🧊 3D
          </button>
        </div>

        {/* Quick mobile Simulate button */}
        <button
          type="button"
          onClick={onSimulate}
          disabled={simulationStatus?.status === "pending" || simulationStatus?.status === "processing"}
          style={{
            padding: "5px 12px",
            fontSize: "12px",
            fontWeight: 600,
            borderRadius: "6px",
            border: "none",
            background: "var(--gradient-cta, linear-gradient(135deg, #10b981 0%, #059669 100%))",
            color: "white",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {simulationStatus?.status === "pending" || simulationStatus?.status === "processing" ? (
            <>⏳ Simulating…</>
          ) : (
            <>▶ Run</>
          )}
        </button>
      </div>

      {/* Floating Mobile Action Pill (< 768px viewports) */}
      <div
        style={{
          position: "fixed",
          bottom: "16px",
          right: "16px",
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          gap: "8px",
          background: "var(--surface-overlay, rgba(22, 27, 34, 0.92))",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          padding: "6px 8px",
          borderRadius: "9999px",
          border: "1px solid var(--color-border-glass, rgba(255, 255, 255, 0.15))",
          boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5), 0 0 20px rgba(16, 185, 129, 0.2)",
        }}
      >
        <button
          type="button"
          onClick={onSimulate}
          disabled={simulationStatus?.status === "pending" || simulationStatus?.status === "processing"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "8px 16px",
            borderRadius: "9999px",
            border: "none",
            background: "var(--gradient-cta, linear-gradient(135deg, #10b981 0%, #059669 100%))",
            color: "#ffffff",
            fontWeight: 600,
            fontSize: "13px",
            cursor: "pointer",
            boxShadow: "0 2px 10px rgba(16, 185, 129, 0.4)",
            transition: "all 0.2s ease",
          }}
        >
          {simulationStatus?.status === "pending" || simulationStatus?.status === "processing" ? (
            <>
              <span
                style={{
                  display: "inline-block",
                  width: "12px",
                  height: "12px",
                  border: "2px solid white",
                  borderTopColor: "transparent",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                }}
              />
              <span>Simulating…</span>
            </>
          ) : (
            <>
              <span>▶</span>
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
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "34px",
            height: "34px",
            borderRadius: "50%",
            border: "1px solid var(--color-border-default, rgba(255, 255, 255, 0.15))",
            background: "var(--color-canvas-subtle, rgba(255, 255, 255, 0.08))",
            color: "var(--color-text-primary, #ffffff)",
            cursor: "pointer",
            fontSize: "14px",
            transition: "all 0.2s ease",
          }}
          title="Share interactive model"
        >
          🔗
        </button>
      </div>
    </>
  );
};
