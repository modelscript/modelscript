// SPDX-License-Identifier: AGPL-3.0-or-later

import { BookIcon, GearIcon, PlusIcon, RepoIcon, SlidersIcon, SparklesFillIcon } from "@primer/octicons-react";
import React, { useEffect, useRef, useState } from "react";
import type { TutorialDifficulty } from "../../util/notebook";
import {
  NotebookSubtitleInput,
  NotebookTitleInput,
  NotionGhostButton,
  NotionPropertyLabel,
  NotionPropertyRow,
  NotionPropertyTable,
  NotionPropertyValueInput,
} from "./styles";

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
  handleLoadStarterTemplate: () => void;
  handleToggleNotebookMode: () => void;
  onTitleChange: (nextTitle: string) => void;
  onFocusFirstBlock?: (() => void) | undefined;
  isEmptyDocument?: boolean | undefined;
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
  handleLoadStarterTemplate,
  onTitleChange,
  onFocusFirstBlock,
  isEmptyDocument,
}) => {
  const [showSubtitle, setShowSubtitle] = useState(() => Boolean(notebookSummary.trim()));
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const subtitleRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (notebookSummary.trim() && !showSubtitle) {
      setShowSubtitle(true);
    }
  }, [notebookSummary, showSubtitle]);

  useEffect(() => {
    if (titleRef.current) {
      titleRef.current.style.height = "auto";
      titleRef.current.style.height = `${titleRef.current.scrollHeight}px`;
    }
  }, [notebookTitle]);

  useEffect(() => {
    if (subtitleRef.current) {
      subtitleRef.current.style.height = "auto";
      subtitleRef.current.style.height = `${subtitleRef.current.scrollHeight}px`;
    }
  }, [notebookSummary, showSubtitle]);

  const activePropertyCount = [notebookSeries.trim(), notebookDialect.trim(), notebookCompanionRepo.trim()].filter(
    Boolean,
  ).length;

  return (
    <div style={{ marginBottom: "20px" }}>
      {/* Subtle Notion-style page controls above title */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "4px",
          marginBottom: "8px",
          flexWrap: "wrap",
        }}
      >
        {!showSubtitle && (
          <NotionGhostButton
            type="button"
            onClick={() => {
              setShowSubtitle(true);
              requestAnimationFrame(() => subtitleRef.current?.focus());
            }}
          >
            <PlusIcon size={12} />
            <span>Add subtitle</span>
          </NotionGhostButton>
        )}
        <NotionGhostButton
          type="button"
          $active={showTutorialMetaEditor}
          onClick={() => setShowTutorialMetaEditor(!showTutorialMetaEditor)}
        >
          <SlidersIcon size={12} />
          <span>Properties{activePropertyCount > 0 ? ` (${activePropertyCount})` : ""}</span>
        </NotionGhostButton>
        {isEmptyDocument && (
          <NotionGhostButton
            type="button"
            onClick={handleLoadStarterTemplate}
            title="Populate a structured multi-section article template"
          >
            <SparklesFillIcon size={12} />
            <span>Use starter template</span>
          </NotionGhostButton>
        )}
      </div>

      {/* Notion-style Large Borderless Title */}
      <NotebookTitleInput
        ref={titleRef}
        rows={1}
        placeholder="Untitled"
        value={notebookTitle}
        onChange={(e) => {
          const nextTitle = e.target.value.replace(/\n/g, " ");
          setNotebookTitle(nextTitle);
          onTitleChange(nextTitle);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "ArrowDown") {
            e.preventDefault();
            if (showSubtitle && subtitleRef.current) {
              subtitleRef.current.focus();
            } else {
              onFocusFirstBlock?.();
            }
          }
        }}
      />

      {/* Optional Subtitle */}
      {showSubtitle && (
        <NotebookSubtitleInput
          ref={subtitleRef}
          rows={1}
          placeholder="Add a subtitle or brief summary..."
          value={notebookSummary}
          onChange={(e) => setNotebookSummary(e.target.value.replace(/\n/g, " "))}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "ArrowDown") {
              e.preventDefault();
              onFocusFirstBlock?.();
            } else if (e.key === "Backspace" && !notebookSummary) {
              e.preventDefault();
              setShowSubtitle(false);
              titleRef.current?.focus();
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              titleRef.current?.focus();
            }
          }}
        />
      )}

      {/* Notion-style Collapsible Properties Table */}
      {showTutorialMetaEditor && (
        <NotionPropertyTable>
          <NotionPropertyRow>
            <NotionPropertyLabel>
              <SlidersIcon size={13} />
              <span>Difficulty</span>
            </NotionPropertyLabel>
            <div style={{ display: "flex", gap: "4px", paddingLeft: "4px" }}>
              {(["Beginner", "Intermediate", "Advanced"] as const).map((level) => {
                const isSelected = (notebookDifficulty || "Intermediate") === level;
                return (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setNotebookDifficulty(level)}
                    style={{
                      padding: "3px 10px",
                      fontSize: "12px",
                      fontWeight: isSelected ? 600 : 500,
                      borderRadius: "6px",
                      border: isSelected ? "1px solid var(--ms-border-strong)" : "1px solid transparent",
                      background: isSelected ? "var(--ms-surface-selected)" : "transparent",
                      color: isSelected ? "var(--ms-text-1)" : "var(--ms-text-3)",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {level}
                  </button>
                );
              })}
            </div>
          </NotionPropertyRow>

          <NotionPropertyRow>
            <NotionPropertyLabel>
              <BookIcon size={13} />
              <span>Series</span>
            </NotionPropertyLabel>
            <NotionPropertyValueInput
              type="text"
              placeholder="Empty"
              value={notebookSeries}
              onChange={(e) => setNotebookSeries(e.target.value)}
            />
          </NotionPropertyRow>

          <NotionPropertyRow>
            <NotionPropertyLabel>
              <GearIcon size={13} />
              <span>Dialect</span>
            </NotionPropertyLabel>
            <NotionPropertyValueInput
              type="text"
              placeholder="Empty (e.g., Modelica 4.1)"
              value={notebookDialect}
              onChange={(e) => setNotebookDialect(e.target.value)}
            />
          </NotionPropertyRow>

          <NotionPropertyRow>
            <NotionPropertyLabel>
              <RepoIcon size={13} />
              <span>Repository</span>
            </NotionPropertyLabel>
            <NotionPropertyValueInput
              type="text"
              placeholder="Empty (e.g., modelscript/tutorials)"
              value={notebookCompanionRepo}
              onChange={(e) => setNotebookCompanionRepo(e.target.value)}
            />
          </NotionPropertyRow>
        </NotionPropertyTable>
      )}
    </div>
  );
};
