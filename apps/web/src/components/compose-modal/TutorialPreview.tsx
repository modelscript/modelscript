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
        padding: "24px 28px",
        borderRadius: "12px",
        border: "1px solid var(--ms-divider)",
        background: "var(--color-canvas-inset, #ffffff)",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--ms-divider)",
          paddingBottom: "10px",
        }}
      >
        <span
          style={{
            fontSize: "11.5px",
            fontWeight: 600,
            color: "var(--ms-text-3)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          Live Article Preview
        </span>
        <span style={{ fontSize: "12px", color: "var(--ms-text-3)" }}>{readMins} min read</span>
      </div>

      {notebookMode ? (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", paddingBottom: "8px" }}>
            {(notebookSeries || notebookDifficulty || notebookDialect) && (
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                {notebookSeries && (
                  <span
                    style={{
                      fontSize: "11.5px",
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: "6px",
                      background: "var(--ms-surface-hover)",
                      color: "var(--ms-text-2)",
                    }}
                  >
                    {notebookSeries}
                  </span>
                )}
                {notebookDifficulty && (
                  <span
                    style={{
                      fontSize: "11.5px",
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: "6px",
                      background: "var(--ms-surface-hover)",
                      color: "var(--ms-text-2)",
                    }}
                  >
                    {notebookDifficulty}
                  </span>
                )}
                {notebookDialect && (
                  <span
                    style={{
                      fontSize: "11.5px",
                      padding: "2px 8px",
                      borderRadius: "6px",
                      background: "var(--ms-surface-hover)",
                      color: "var(--ms-text-3)",
                    }}
                  >
                    {notebookDialect}
                  </span>
                )}
              </div>
            )}
            <h1
              style={{
                margin: 0,
                fontSize: "32px",
                lineHeight: 1.2,
                fontWeight: 800,
                letterSpacing: "-0.025em",
                color: "var(--ms-text-heading, var(--ms-text-1))",
              }}
            >
              {notebookTitle || "Untitled"}
            </h1>
            {notebookSummary && (
              <p style={{ margin: 0, fontSize: "17px", lineHeight: 1.5, color: "var(--ms-text-2)" }}>
                {notebookSummary}
              </p>
            )}
          </div>

          {notebookCells.map((cell, idx) =>
            cell.type === "markdown" ? (
              <div key={cell.id} style={{ fontSize: "16px", lineHeight: 1.72, color: "var(--ms-text-1)" }}>
                <RenderContent text={cell.content || "*Empty block*"} isLongForm={true} />
              </div>
            ) : (
              <div
                key={cell.id}
                style={{
                  borderRadius: "10px",
                  border: "1px solid var(--ms-divider)",
                  overflow: "hidden",
                }}
              >
                <ArtifactViewCard artifactId={cell.artifactId} />
                {(cell.caption || cell.title) && (
                  <div
                    style={{
                      padding: "8px 12px",
                      fontSize: "12.5px",
                      color: "var(--ms-text-2)",
                      borderTop: "1px solid var(--ms-divider)",
                      background: "var(--ms-surface-hover)",
                    }}
                  >
                    <strong>Fig. {idx + 1}:</strong> {cell.caption || cell.title}
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
