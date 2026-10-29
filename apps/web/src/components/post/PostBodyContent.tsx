// SPDX-License-Identifier: AGPL-3.0-or-later

import { BookIcon, CodeIcon, NoteIcon, PackageIcon, PinIcon } from "@primer/octicons-react";
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { buildEditorUrlForArtifact, isMultiFileArtifact } from "../../util/editor-routing";
import { safeJsonParse } from "../../util/json";
import ArtifactViewCard from "../artifacts/ArtifactViewCard";
import Box from "../Box";
import { PostMarkdownContent } from "./PostMarkdownContent";
import { PostNotebookHeader } from "./PostNotebookHeader";
import { ContentWarningBox } from "./styles";

export interface PostBodyContentProps {
  displayPost: any;
  isDetailView: boolean;
  isNotebook: boolean;
  notebookData?: any;
  notebookHeadings: { id?: string; slug?: string; level: number; text: string }[];
  readTimeMinutes: number;
  canEditPost: boolean;
  onOpenEditModal: () => void;
  onPinCreated: (pin: any) => void;
  showAiDetails?: boolean | undefined;
  setShowAiDetails?: ((show: boolean) => void) | undefined;
}

export const PostBodyContent: React.FC<PostBodyContentProps> = ({
  displayPost,
  isDetailView,
  isNotebook,
  notebookData,
  notebookHeadings,
  readTimeMinutes,
  canEditPost,
  onOpenEditModal,
  onPinCreated,
}) => {
  const navigate = useNavigate();
  const [isNotebookExpanded, setIsNotebookExpanded] = useState(false);

  const parsedMeta =
    typeof displayPost?.metadata === "string"
      ? safeJsonParse<Record<string, any>>(displayPost.metadata, {})
      : displayPost?.metadata || {};
  const contentWarning =
    (typeof displayPost?.content_warning === "string" && displayPost.content_warning.trim()) ||
    (typeof parsedMeta?.contentWarning === "string" && parsedMeta.contentWarning.trim()) ||
    (displayPost?.is_sensitive ? "Sensitive content" : "");
  const [cwRevealed, setCwRevealed] = useState(false);

  const wasUpdated =
    displayPost.updated_at &&
    displayPost.created_at &&
    new Date(displayPost.updated_at).getTime() - new Date(displayPost.created_at).getTime() > 5000;

  const cwBanner = contentWarning ? (
    <ContentWarningBox>
      <span style={{ fontSize: "13px", fontWeight: 600, color: "#d29922" }}>⚠️ Content warning: {contentWarning}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setCwRevealed((prev) => !prev);
        }}
        style={{
          padding: "4px 10px",
          borderRadius: "6px",
          border: "1px solid rgba(210, 153, 34, 0.4)",
          background: "rgba(210, 153, 34, 0.14)",
          color: "var(--color-text-primary)",
          fontSize: "12px",
          fontWeight: 600,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {cwRevealed ? "Hide post" : "Show post"}
      </button>
    </ContentWarningBox>
  ) : null;

  if (contentWarning && !cwRevealed) {
    return cwBanner;
  }

  if (isNotebook && notebookData && notebookData.cells.length > 0) {
    let previewEndIdx = notebookData.cells.length;
    if (!isDetailView && !isNotebookExpanded) {
      const firstArtIdx = notebookData.cells.findIndex((c: any) => c.type === "artifact");
      if (firstArtIdx !== -1 && firstArtIdx + 1 < notebookData.cells.length) {
        previewEndIdx = firstArtIdx + 1;
      } else if (notebookData.cells.length > 2) {
        previewEndIdx = 2;
      }
    }

    const visibleCells = notebookData.cells.slice(0, previewEndIdx);
    const hiddenCount = notebookData.cells.length - visibleCells.length;
    const cellsWithFig = visibleCells.map((cell: any, index: number) => {
      if (cell.type !== "markdown") {
        const figureNum = visibleCells.slice(0, index + 1).filter((c: any) => c.type !== "markdown").length;
        return { cell, figureNum };
      }
      return { cell, figureNum: 0 };
    });

    const primaryArtifactId = displayPost.artifact_view_id ?? notebookData.artifactIds?.[0];
    const primaryArtifactView =
      (primaryArtifactId ? displayPost.artifact_views?.[primaryArtifactId] : undefined) || displayPost.artifact_view;
    const isMultiFileTutorial = Boolean(
      primaryArtifactView &&
      isMultiFileArtifact({
        ...primaryArtifactView,
        view_type:
          primaryArtifactView.view_type || primaryArtifactView.artifact_type || (displayPost as any).artifact_type,
      }),
    );

    return (
      <Box display="flex" flexDirection="column" gap={2} style={{ width: "100%", maxWidth: "100%", minWidth: 0 }}>
        {cwBanner}
        {/* Baeldung-style Tutorial Hero Banner */}
        <PostNotebookHeader
          notebookData={notebookData}
          readTimeMinutes={readTimeMinutes}
          wasUpdated={Boolean(wasUpdated)}
          updatedAt={displayPost.updated_at}
          canEditPost={canEditPost}
          onOpenEditModal={onOpenEditModal}
          isDetailView={isDetailView}
          notebookHeadings={notebookHeadings.map((h) => ({ slug: h.slug || h.id || "", level: h.level, text: h.text }))}
          onHeadingClick={(slug) => {
            if (!isDetailView) {
              setIsNotebookExpanded(true);
              setTimeout(() => {
                document.getElementById(slug)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }, 60);
            } else {
              document.getElementById(slug)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }
          }}
        />

        {cellsWithFig.map(({ cell, figureNum }: { cell: any; figureNum: number }) => {
          if (cell.type === "markdown") {
            const shouldTruncateMd =
              !isDetailView && !isNotebookExpanded && cell.content.length > 520 && notebookData.cells.length === 1;
            const mdText = shouldTruncateMd ? `${cell.content.slice(0, 520)}…` : cell.content;
            return (
              <Box
                key={cell.id}
                style={{
                  fontSize: isDetailView ? "17px" : "15px",
                  lineHeight: isDetailView ? "24px" : "20px",
                  wordBreak: "break-word",
                }}
              >
                <PostMarkdownContent text={mdText} isLongForm={true} />
              </Box>
            );
          }

          const currentFigNum = figureNum;
          const initialView =
            displayPost.artifact_views?.[cell.artifactId] ||
            (cell.artifactId === displayPost.artifact_view_id ? displayPost.artifact_view : undefined);

          return (
            <Box
              key={cell.id}
              id={`fig-${currentFigNum}`}
              my={1}
              style={{
                width: "100%",
                maxWidth: "100%",
                minWidth: 0,
                borderRadius: "12px",
                border: "1px solid rgba(139, 92, 246, 0.22)",
                background: "rgba(139, 92, 246, 0.03)",
                overflow: "hidden",
              }}
            >
              <ArtifactViewCard
                artifactId={cell.artifactId}
                initialArtifactView={initialView}
                forkedFromId={
                  (displayPost as any)?.forked_from_post_id ||
                  (displayPost as any)?.forked_from_artifact_id ||
                  safeJsonParse<Record<string, any>>((displayPost as any)?.metadata, {})?.["forkedFromArtifactId"]
                }
                onPinCreated={onPinCreated}
              />
              {(cell.caption || cell.title) && (
                <div
                  style={{
                    padding: "6px 12px",
                    fontSize: "12px",
                    color: "var(--color-text-muted)",
                    borderTop: "1px solid rgba(139, 92, 246, 0.15)",
                    background: "rgba(0, 0, 0, 0.18)",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-mono, monospace)",
                      fontWeight: 700,
                      color: "var(--color-accent-cyan)",
                      fontSize: "11px",
                    }}
                  >
                    Fig. {currentFigNum}:
                  </span>
                  <span>{cell.caption || cell.title}</span>
                </div>
              )}
            </Box>
          );
        })}

        {!isDetailView && hiddenCount > 0 && !isNotebookExpanded && (
          <Box display="flex" gap={2} flexWrap="wrap" mt={1}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setIsNotebookExpanded(true);
              }}
              style={{
                flex: 1,
                minWidth: "220px",
                padding: "9px 14px",
                borderRadius: "10px",
                border: "1px solid rgba(6, 182, 212, 0.32)",
                background: "linear-gradient(135deg, rgba(6, 182, 212, 0.1), rgba(139, 92, 216, 0.1))",
                color: "var(--color-accent-cyan)",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <NoteIcon size={13} /> Expand inline ({notebookData.cells.length} sections
                {notebookData.artifactIds.length > 0
                  ? ` · ${notebookData.artifactIds.length} ${notebookData.artifactIds.length === 1 ? "artifact" : "artifacts"}`
                  : ""}
                )
              </span>
              <span>+{hiddenCount} more ▼</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                navigate(`/${displayPost.username}/status/${displayPost.id}`);
              }}
              style={{
                padding: "9px 14px",
                borderRadius: "10px",
                border: "1px solid rgba(139, 92, 246, 0.38)",
                background: "rgba(139, 92, 246, 0.14)",
                color: "var(--color-text-heading)",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <BookIcon size={13} /> Read Tutorial View →
            </button>
          </Box>
        )}

        {!isDetailView && isNotebookExpanded && notebookData.cells.length > 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setIsNotebookExpanded(false);
            }}
            style={{
              alignSelf: "flex-start",
              padding: "5px 12px",
              borderRadius: "8px",
              border: "1px solid var(--color-border)",
              background: "rgba(255, 255, 255, 0.04)",
              color: "var(--color-text-muted)",
              fontFamily: "var(--font-mono, monospace)",
              fontSize: "11.5px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            ▲ Collapse notebook
          </button>
        )}

        {/* Baeldung-style Companion Code & Web IDE Footer on Detail View */}
        {isDetailView && (
          <div
            style={{
              marginTop: "8px",
              padding: "14px 16px",
              borderRadius: "12px",
              background: "rgba(6, 182, 212, 0.06)",
              border: "1px solid rgba(6, 182, 212, 0.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "10px",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <span
                style={{
                  fontSize: "13px",
                  fontWeight: 700,
                  color: "var(--color-text-heading)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <CodeIcon size={14} /> Companion Code & Interactive Sandbox
              </span>
              <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                {notebookData.companionRepo
                  ? `Full source available in ${notebookData.companionRepo} — or launch directly in the WebAssembly Playground / IDE.`
                  : "All code snippets and equations in this tutorial can be compiled and simulated directly in the ModelScript Playground."}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {notebookData.companionRepo && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const repo = notebookData.companionRepo!;
                    if (repo.startsWith("http://") || repo.startsWith("https://")) {
                      window.open(repo, "_blank", "noopener,noreferrer");
                    } else {
                      navigate(`/explore?q=${encodeURIComponent(repo)}`);
                    }
                  }}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--color-border-default)",
                    background: "rgba(255, 255, 255, 0.06)",
                    color: "var(--color-text-primary)",
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: "11.5px",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <PackageIcon size={13} /> {notebookData.companionRepo}
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  const matches = Array.from(
                    String(displayPost.content || "").matchAll(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g),
                  );
                  const firstFenceLang = matches[0]?.[1]?.trim();
                  const codeBlocks = matches.map((m) => m[2]?.trim()).filter(Boolean);
                  const combinedSource = codeBlocks.join("\n\n");
                  const targetUrl = buildEditorUrlForArtifact({
                    artifactId: primaryArtifactId,
                    viewType:
                      primaryArtifactView?.view_type ||
                      primaryArtifactView?.artifact_type ||
                      (displayPost as any).artifact_type,
                    viewConfig: primaryArtifactView?.view_config || (displayPost as any).artifact_config,
                    code: combinedSource || (!primaryArtifactId ? displayPost.content || "" : undefined),
                    title: notebookData.title || `Tutorial-${displayPost.id}`,
                    dialect: notebookData.dialect || firstFenceLang || undefined,
                  });
                  navigate(targetUrl);
                }}
                style={{
                  padding: "6px 12px",
                  borderRadius: "8px",
                  border: "1px solid rgba(139, 92, 246, 0.45)",
                  background: "rgba(139, 92, 246, 0.18)",
                  color: "var(--color-text-heading)",
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: "11.5px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {isMultiFileTutorial ? "▶ Open Tutorial in Web IDE" : "▶ Open Tutorial in Playground"}
              </button>
            </div>
          </div>
        )}
      </Box>
    );
  }

  // Standard Post Body
  return (
    <>
      {cwBanner}
      <Box
        mt={0}
        style={{
          wordBreak: "break-word",
          lineHeight: isDetailView ? "24px" : "20px",
          fontSize: isDetailView ? "17px" : "15px",
        }}
      >
        <PostMarkdownContent text={displayPost.content} />
      </Box>

      {displayPost.metadata?.spatialPin && (
        <Box
          mt={2}
          p={2}
          border="1px solid var(--color-border)"
          borderRadius="8px"
          backgroundColor="rgba(255, 255, 255, 0.03)"
          style={{ cursor: "pointer", display: "inline-block" }}
          onClick={(e) => {
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent("focus-spatial-pin", { detail: displayPost.metadata.spatialPin }));
          }}
        >
          <span
            style={{
              fontSize: "13px",
              color: "var(--color-fg-muted)",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <span style={{ color: "var(--color-accent-cyan)", display: "inline-flex" }}>
              <PinIcon size={12} />
            </span>
            <span>
              View Pin on <b>{displayPost.metadata.spatialPin.fieldName}</b> (Value:{" "}
              {displayPost.metadata.spatialPin.scalarValue.toFixed(2)})
            </span>
          </span>
        </Box>
      )}

      {displayPost.artifact_view_id && (
        <Box style={{ width: "100%", maxWidth: "100%", minWidth: 0 }}>
          <ArtifactViewCard
            artifactId={displayPost.artifact_view_id}
            initialArtifactView={displayPost.artifact_view}
            forkedFromId={
              (displayPost as any)?.forked_from_post_id ||
              (displayPost as any)?.forked_from_artifact_id ||
              safeJsonParse<Record<string, any>>((displayPost as any)?.metadata, {})?.["forkedFromArtifactId"]
            }
            onPinCreated={onPinCreated}
          />
        </Box>
      )}
    </>
  );
};
