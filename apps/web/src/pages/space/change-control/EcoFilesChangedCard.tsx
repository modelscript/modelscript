// SPDX-License-Identifier: AGPL-3.0-or-later

import { FileCodeIcon } from "@primer/octicons-react";
import type React from "react";
import type { SpaceEcoDiffResult, SpaceEcoProposalRecord } from "../../../api";
import Spinner from "../../../components/Spinner";
import { PrSectionCard, PrSectionHeader } from "./styles";
import type { DiffStudioMode } from "./types";

export interface EcoFilesChangedCardProps {
  eco: SpaceEcoProposalRecord;
  diffResult: SpaceEcoDiffResult | null;
  loading: boolean;
  selectedDiffFileIndex: number;
  onSelectDiffFileIndex: (index: number) => void;
  diffStudioMode: DiffStudioMode;
  onDiffStudioModeChange: (mode: DiffStudioMode) => void;
  diffSideBySide: boolean;
  onDiffSideBySideChange: (sideBySide: boolean) => void;
  children: React.ReactNode;
}

export const EcoFilesChangedCard: React.FC<EcoFilesChangedCardProps> = ({
  eco,
  diffResult,
  loading,
  selectedDiffFileIndex,
  onSelectDiffFileIndex,
  diffStudioMode,
  onDiffStudioModeChange,
  diffSideBySide,
  onDiffSideBySideChange,
  children,
}) => {
  const activeDiffFile = diffResult?.files[selectedDiffFileIndex] || null;

  return (
    <PrSectionCard id="section-files">
      <PrSectionHeader>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <FileCodeIcon size={16} />
          <strong style={{ fontSize: "14px", color: "var(--color-fg-default)" }}>
            Files Changed ({diffResult?.files.length || eco.impacted_models.length || 1})
          </strong>

          {diffResult?.files && diffResult.files.length > 0 && (
            <select
              value={selectedDiffFileIndex}
              onChange={(e) => onSelectDiffFileIndex(Number(e.target.value))}
              style={{
                padding: "5px 10px",
                borderRadius: "6px",
                border: "1px solid var(--color-border-default)",
                background: "var(--color-canvas-default)",
                color: "var(--color-fg-default)",
                fontSize: "12.5px",
                fontFamily: "var(--font-mono, monospace)",
                cursor: "pointer",
              }}
            >
              {diffResult.files.map((file, idx) => (
                <option key={file.filename} value={idx}>
                  {file.filename} (+{file.additions} -{file.deletions})
                </option>
              ))}
            </select>
          )}

          {activeDiffFile && (
            <span style={{ fontSize: "12.5px", color: "var(--color-fg-muted)" }}>
              <span style={{ color: "var(--color-success-fg, #1a7f37)", fontWeight: 700 }}>
                +{activeDiffFile.additions}
              </span>{" "}
              <span style={{ color: "var(--color-danger-fg, #cf222e)", fontWeight: 700 }}>
                -{activeDiffFile.deletions}
              </span>
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => onDiffStudioModeChange("studio")}
            style={{
              padding: "5px 12px",
              borderRadius: "6px",
              border: "1px solid var(--color-border-default)",
              background:
                diffStudioMode === "studio"
                  ? "var(--color-accent-subtle, rgba(9, 105, 218, 0.15))"
                  : "var(--color-canvas-default)",
              color: diffStudioMode === "studio" ? "var(--ms-brand)" : "var(--color-fg-muted)",
              fontSize: "12px",
              fontWeight: diffStudioMode === "studio" ? 700 : 500,
              cursor: "pointer",
            }}
          >
            ⚡ Semantic Studio
          </button>
          <button
            type="button"
            onClick={() => {
              onDiffStudioModeChange("monaco");
              onDiffSideBySideChange(true);
            }}
            style={{
              padding: "5px 12px",
              borderRadius: "6px",
              border: "1px solid var(--color-border-default)",
              background:
                diffStudioMode === "monaco" && diffSideBySide
                  ? "var(--color-accent-subtle, rgba(9, 105, 218, 0.15))"
                  : "var(--color-canvas-default)",
              color: diffStudioMode === "monaco" && diffSideBySide ? "var(--ms-brand)" : "var(--color-fg-muted)",
              fontSize: "12px",
              fontWeight: diffStudioMode === "monaco" && diffSideBySide ? 700 : 500,
              cursor: "pointer",
            }}
          >
            Side-by-Side
          </button>
          <button
            type="button"
            onClick={() => {
              onDiffStudioModeChange("monaco");
              onDiffSideBySideChange(false);
            }}
            style={{
              padding: "5px 12px",
              borderRadius: "6px",
              border: "1px solid var(--color-border-default)",
              background:
                diffStudioMode === "monaco" && !diffSideBySide
                  ? "var(--color-accent-subtle, rgba(9, 105, 218, 0.15))"
                  : "var(--color-canvas-default)",
              color: diffStudioMode === "monaco" && !diffSideBySide ? "var(--ms-brand)" : "var(--color-fg-muted)",
              fontSize: "12px",
              fontWeight: diffStudioMode === "monaco" && !diffSideBySide ? 700 : 500,
              cursor: "pointer",
            }}
          >
            Inline
          </button>
        </div>
      </PrSectionHeader>

      <div style={{ padding: "20px 24px" }}>
        {loading ? (
          <div style={{ padding: "48px", display: "flex", justifyContent: "center" }}>
            <Spinner />
          </div>
        ) : activeDiffFile ? (
          children
        ) : (
          <div style={{ padding: "36px", textAlign: "center", color: "var(--color-fg-muted)" }}>
            No diff content available for this change request.
          </div>
        )}
      </div>
    </PrSectionCard>
  );
};
