// SPDX-License-Identifier: AGPL-3.0-or-later

import { BookIcon } from "@primer/octicons-react";
import React from "react";
import type { TutorialDifficulty } from "../../util/notebook";
import Box from "../Box";
import { CellActionBtn, NotebookTitleInput } from "./styles";

export interface ComposeTutorialMetaEditorProps {
  notebookTitle: string;
  setNotebookTitle: (val: string) => void;
  notebookSummary: string;
  setNotebookSummary: (val: string) => void;
  notebookDifficulty: TutorialDifficulty | undefined;
  setNotebookDifficulty: (val: TutorialDifficulty) => void;
  notebookSeries: string;
  setNotebookSeries: (val: string) => void;
  notebookDialect: string;
  setNotebookDialect: (val: string) => void;
  notebookCompanionRepo: string;
  setNotebookCompanionRepo: (val: string) => void;
  showTutorialMetaEditor: boolean;
  setShowTutorialMetaEditor: (val: boolean) => void;
  handleLoadBaeldungTemplate: () => void;
  handleToggleNotebookMode: () => void;
  onTitleChange: (nextTitle: string) => void;
}

export const ComposeTutorialMetaEditor: React.FC<ComposeTutorialMetaEditorProps> = ({
  notebookTitle,
  setNotebookTitle,
  notebookSummary,
  setNotebookSummary,
  notebookDifficulty,
  setNotebookDifficulty,
  notebookSeries,
  setNotebookSeries,
  notebookDialect,
  setNotebookDialect,
  notebookCompanionRepo,
  setNotebookCompanionRepo,
  showTutorialMetaEditor,
  setShowTutorialMetaEditor,
  handleLoadBaeldungTemplate,
  handleToggleNotebookMode,
  onTitleChange,
}) => {
  return (
    <>
      <Box
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        flexWrap="wrap"
        gap={1}
        px={2}
        py={1}
        borderRadius="8px"
        style={{
          background: "linear-gradient(135deg, rgba(139, 92, 246, 0.12), rgba(6, 182, 212, 0.08))",
          border: "1px solid rgba(139, 92, 246, 0.25)",
        }}
      >
        <span
          style={{
            fontSize: "12px",
            fontWeight: 700,
            fontFamily: "var(--font-mono, monospace)",
            color: "var(--color-accent-cyan)",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <BookIcon size={13} />
          <span>Baeldung-Style Tutorial & Engineering Notebook</span>
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
          <CellActionBtn
            type="button"
            onClick={handleLoadBaeldungTemplate}
            title="Populate a structured 5-section Baeldung tutorial scaffold"
            style={{
              color: "var(--color-accent-cyan)",
              background: "rgba(6, 182, 212, 0.12)",
              borderColor: "rgba(6, 182, 212, 0.3)",
              fontWeight: 600,
            }}
          >
            ⚡ Load Baeldung Template
          </CellActionBtn>
          <CellActionBtn
            type="button"
            onClick={() => setShowTutorialMetaEditor(!showTutorialMetaEditor)}
            title="Toggle tutorial metadata fields (Series, Difficulty, Dialect, Summary)"
          >
            ⚙️ Metadata {showTutorialMetaEditor ? "▲" : "▼"}
          </CellActionBtn>
          <CellActionBtn type="button" onClick={handleToggleNotebookMode} title="Switch to raw Markdown view">
            Raw Markdown (`::artifact`)
          </CellActionBtn>
        </div>
      </Box>

      <NotebookTitleInput
        type="text"
        placeholder="Tutorial / Article Title (e.g., Guide to Damped Oscillators in ModelScript)..."
        value={notebookTitle}
        onChange={(e) => {
          const nextTitle = e.target.value;
          setNotebookTitle(nextTitle);
          onTitleChange(nextTitle);
        }}
      />

      {showTutorialMetaEditor && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            padding: "10px 12px",
            borderRadius: "10px",
            background: "rgba(255, 255, 255, 0.025)",
            border: "1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.1))",
          }}
        >
          <input
            type="text"
            placeholder="Tutorial Subtitle / TL;DR Summary (shown in tutorial hero header)..."
            value={notebookSummary}
            onChange={(e) => setNotebookSummary(e.target.value)}
            style={{
              width: "100%",
              padding: "7px 10px",
              fontSize: "13px",
              borderRadius: "8px",
              border: "1px solid var(--color-border-default)",
              background: "rgba(0, 0, 0, 0.25)",
              color: "var(--color-fg-default)",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: "8px",
            }}
          >
            <select
              value={notebookDifficulty || "Intermediate"}
              onChange={(e) => setNotebookDifficulty(e.target.value as TutorialDifficulty)}
              style={{
                padding: "6px 10px",
                fontSize: "12px",
                fontFamily: "var(--font-mono, monospace)",
                borderRadius: "8px",
                border: "1px solid var(--color-border-default)",
                background: "var(--color-bg-primary, #0b1120)",
                color: "var(--color-fg-default)",
                outline: "none",
              }}
            >
              <option value="Beginner">● Beginner</option>
              <option value="Intermediate">● Intermediate</option>
              <option value="Advanced">● Advanced</option>
            </select>
            <input
              type="text"
              placeholder="Series (e.g., ModelScript Core)"
              value={notebookSeries}
              onChange={(e) => setNotebookSeries(e.target.value)}
              style={{
                padding: "6px 10px",
                fontSize: "12px",
                fontFamily: "var(--font-mono, monospace)",
                borderRadius: "8px",
                border: "1px solid var(--color-border-default)",
                background: "rgba(0, 0, 0, 0.25)",
                color: "var(--color-fg-default)",
                outline: "none",
              }}
            />
            <input
              type="text"
              placeholder="Dialect (e.g., Modelica 3.4)"
              value={notebookDialect}
              onChange={(e) => setNotebookDialect(e.target.value)}
              style={{
                padding: "6px 10px",
                fontSize: "12px",
                fontFamily: "var(--font-mono, monospace)",
                borderRadius: "8px",
                border: "1px solid var(--color-border-default)",
                background: "rgba(0, 0, 0, 0.25)",
                color: "var(--color-fg-default)",
                outline: "none",
              }}
            />
            <input
              type="text"
              placeholder="Companion Repo (e.g., modelscript/tutorials)"
              value={notebookCompanionRepo}
              onChange={(e) => setNotebookCompanionRepo(e.target.value)}
              style={{
                padding: "6px 10px",
                fontSize: "12px",
                fontFamily: "var(--font-mono, monospace)",
                borderRadius: "8px",
                border: "1px solid var(--color-border-default)",
                background: "rgba(0, 0, 0, 0.25)",
                color: "var(--color-fg-default)",
                outline: "none",
              }}
            />
          </div>
        </div>
      )}
    </>
  );
};
