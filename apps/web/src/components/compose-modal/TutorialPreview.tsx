// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import { estimateReadingTimeMinutes, type NotebookCell, type TutorialDifficulty } from "../../util/notebook";
import ArtifactViewCard from "../artifacts/ArtifactViewCard";
import { RenderContent } from "../Post";

interface TutorialPreviewProps {
  notebookMode: boolean;
  notebookTitle: string;
  notebookSummary: string;
  notebookDifficulty: TutorialDifficulty | undefined;
  notebookSeries: string;
  notebookDialect: string;
  notebookCells: NotebookCell[];
  content: string;
}

export const TutorialPreview: React.FC<TutorialPreviewProps> = ({
  notebookMode,
  notebookTitle,
  notebookSummary,
  notebookDifficulty,
  notebookSeries,
  notebookDialect,
  notebookCells,
  content,
}) => {
  const readMins = estimateReadingTimeMinutes(notebookCells);

  return (
    <div
      style={{
        padding: "16px",
        borderRadius: "12px",
        border: "1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.1))",
        background: "rgba(3, 7, 18, 0.55)",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08))",
          paddingBottom: "8px",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono, monospace)",
            fontSize: "11px",
            fontWeight: 700,
            color: "var(--color-accent-cyan)",
            textTransform: "uppercase",
          }}
        >
          👁️ Live Baeldung Tutorial Preview
        </span>
        <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "11px", color: "var(--color-text-muted)" }}>
          ⏱ {readMins} min read
        </span>
      </div>

      {notebookMode ? (
        <>
          <div
            style={{
              padding: "12px 14px",
              borderRadius: "10px",
              background: "linear-gradient(135deg, rgba(6, 182, 212, 0.08), rgba(139, 92, 246, 0.06))",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
            }}
          >
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
              {notebookSeries && (
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    fontFamily: "var(--font-mono, monospace)",
                    padding: "2px 8px",
                    borderRadius: "9999px",
                    background: "rgba(6, 182, 212, 0.15)",
                    color: "var(--color-accent-cyan)",
                  }}
                >
                  📚 {notebookSeries}
                </span>
              )}
              {notebookDifficulty && (
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    fontFamily: "var(--font-mono, monospace)",
                    padding: "2px 8px",
                    borderRadius: "9999px",
                    background: "rgba(16, 185, 129, 0.14)",
                    color: "var(--color-status-verified, #34d399)",
                  }}
                >
                  ● {notebookDifficulty}
                </span>
              )}
              {notebookDialect && (
                <span
                  style={{
                    fontSize: "10px",
                    fontFamily: "var(--font-mono, monospace)",
                    padding: "2px 8px",
                    borderRadius: "9999px",
                    background: "rgba(255, 255, 255, 0.06)",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  ⚙️ {notebookDialect}
                </span>
              )}
            </div>
            <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--color-text-heading)" }}>
              {notebookTitle || "Untitled Tutorial"}
            </div>
            {notebookSummary && (
              <div style={{ fontSize: "13.5px", color: "var(--color-text-secondary)" }}>{notebookSummary}</div>
            )}
          </div>

          {notebookCells.map((cell, idx) =>
            cell.type === "markdown" ? (
              <div key={cell.id} style={{ fontSize: "15.5px", lineHeight: 1.65 }}>
                <RenderContent text={cell.content || "*Empty section*"} isLongForm={true} />
              </div>
            ) : (
              <div
                key={cell.id}
                style={{
                  borderRadius: "10px",
                  border: "1px solid rgba(139, 92, 246, 0.25)",
                  overflow: "hidden",
                }}
              >
                <ArtifactViewCard artifactId={cell.artifactId} />
                {(cell.caption || cell.title) && (
                  <div
                    style={{
                      padding: "6px 10px",
                      fontSize: "11.5px",
                      color: "var(--color-text-muted)",
                      background: "rgba(0,0,0,0.2)",
                    }}
                  >
                    <strong style={{ color: "var(--color-accent-cyan)" }}>Fig. {idx + 1}:</strong>{" "}
                    {cell.caption || cell.title}
                  </div>
                )}
              </div>
            ),
          )}
        </>
      ) : (
        <RenderContent text={content || "*Nothing to preview yet*"} isLongForm={true} />
      )}
    </div>
  );
};
