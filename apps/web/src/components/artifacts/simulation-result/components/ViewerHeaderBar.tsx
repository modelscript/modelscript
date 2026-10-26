// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import type { VtuParseResult } from "../../../../util/vtu-parser";

export interface ViewerHeaderBarProps {
  vtuData: VtuParseResult;
  viewConfig: any;
  onThreadNodeSelected?: ((threadId: string | number) => void) | undefined;
}

export const ViewerHeaderBar: React.FC<ViewerHeaderBarProps> = ({ vtuData, viewConfig, onThreadNodeSelected }) => {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        padding: "8px 16px",
        zIndex: 5,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <span
        style={{
          fontSize: 11,
          color: "var(--color-fg-muted)",
          fontFamily: "monospace",
        }}
      >
        {vtuData.numPoints.toLocaleString()} nodes · {vtuData.numCells.toLocaleString()} cells
      </span>
      {viewConfig.solverInfo && (
        <span
          style={{
            fontSize: 10,
            color: "var(--color-accent-fg)",
            background: "var(--color-accent-subtle)",
            padding: "1px 8px",
            borderRadius: 10,
            border: "1px solid var(--color-accent-emphasis)",
            fontWeight: 600,
          }}
        >
          {viewConfig.solverInfo.name}
        </span>
      )}
      {(viewConfig.profile || viewConfig.hpc?.profile) && (
        <span
          style={{
            fontSize: 10,
            color: "var(--color-success-fg, #3fb950)",
            background: "var(--color-success-subtle, rgba(46,160,67,0.15))",
            padding: "1px 8px",
            borderRadius: 10,
            border: "1px solid var(--color-success-emphasis, #2ea043)",
            fontWeight: 600,
          }}
          title={
            viewConfig.usage?.costCredits !== undefined || viewConfig.hpc?.costCredits !== undefined
              ? `Cost: ${viewConfig.usage?.costCredits ?? viewConfig.hpc?.costCredits} credits | CPU: ${
                  viewConfig.usage?.cpuSeconds ?? viewConfig.hpc?.cpuCoreSeconds ?? 0
                }s`
              : undefined
          }
        >
          ⚡ {viewConfig.profile || viewConfig.hpc?.profile}{" "}
          {viewConfig.usage?.costCredits !== undefined || viewConfig.hpc?.costCredits !== undefined
            ? `· ${(viewConfig.usage?.costCredits ?? viewConfig.hpc?.costCredits ?? 0).toFixed(2)} cr`
            : ""}
        </span>
      )}
      {(viewConfig.threadNodeId !== undefined || viewConfig.threadId !== undefined || onThreadNodeSelected) && (
        <button
          type="button"
          onClick={() => {
            const targetId = viewConfig.threadNodeId ?? viewConfig.threadId ?? 1;
            onThreadNodeSelected?.(targetId);
            window.dispatchEvent(
              new CustomEvent("open-digital-thread", {
                detail: { threadId: targetId, artifactId: viewConfig.artifactId },
              }),
            );
          }}
          title="Inspect linked cross-domain Digital Thread (FEA/CFD ↔ Modelica ↔ SysML v2)"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            background: "rgba(139, 92, 246, 0.15)",
            color: "#a78bfa",
            border: "1px solid rgba(139, 92, 246, 0.4)",
            borderRadius: 12,
            padding: "2px 9px",
            fontSize: 10,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          <span>🧵 Digital Thread</span>
          {(viewConfig.threadNodeId !== undefined || viewConfig.threadId !== undefined) && (
            <span
              style={{
                background: "rgba(139, 92, 246, 0.3)",
                padding: "0 5px",
                borderRadius: 8,
                fontSize: 9,
              }}
            >
              #{viewConfig.threadNodeId ?? viewConfig.threadId}
            </span>
          )}
        </button>
      )}
    </div>
  );
};
