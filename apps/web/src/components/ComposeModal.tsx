// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import { ArrowLeftIcon, TrashIcon, XIcon } from "@primer/octicons-react";
import { Heading, IconButton } from "@primer/react";
import React, { useCallback, useEffect, useState } from "react";
import styled from "styled-components";
import { createArtifactView } from "../api";
import { createCellId, estimateReadingTimeMinutes, type NotebookCell, type TutorialDifficulty } from "../util/notebook";
import ArtifactViewCard from "./artifacts/ArtifactViewCard";
import type { SpatialPin } from "./artifacts/spatial-pin";
import Box from "./Box";
import ComposeBox from "./ComposeBox";
import type { ComposeInitialState } from "./ComposeContext";
import { RenderContent } from "./Post";

const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 10vh;
`;

const ModalPanel = styled.div`
  background: var(--surface-overlay, rgba(14, 20, 36, 0.95));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  width: 100%;
  max-width: 600px;
  border-radius: 16px;
  border: 1px solid var(--color-border-glass);
  box-shadow: var(--glow-card);
  display: flex;
  flex-direction: column;
  overflow: visible;
  max-height: 84vh;
  min-height: 250px;
  transition: max-width 0.2s ease;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  padding: 12px 16px 4px;
  flex-shrink: 0;
`;

const Body = styled.div`
  padding: 4px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  flex: 1;
`;

interface ComposeModalProps {
  onClose: () => void;
  onPostCreated?: ((post: any) => void) | undefined;
  quotePost?: any;
  replyToPost?: any;
  pendingPin?: SpatialPin | undefined;
  initialState?: ComposeInitialState | undefined;
}

interface DraftPost {
  id: string;
  content: string;
  artifactId: number | null;
  notebookMode?: boolean | undefined;
  notebookTitle?: string | undefined;
  notebookSummary?: string | undefined;
  notebookDifficulty?: TutorialDifficulty | undefined;
  notebookSeries?: string | undefined;
  notebookDialect?: string | undefined;
  notebookCompanionRepo?: string | undefined;
  notebookCells?: NotebookCell[] | undefined;
  quotePost?: any;
  replyToPost?: any;
  pendingPin?: SpatialPin | undefined;
  timestamp: number;
}

const getDrafts = (): DraftPost[] => {
  try {
    return JSON.parse(localStorage.getItem("post_drafts") || "[]");
  } catch {
    return [];
  }
};

const upsertDraft = (draft: DraftPost) => {
  try {
    const drafts = getDrafts();
    const existingIdx = drafts.findIndex((d) => d.id === draft.id);
    if (existingIdx >= 0) {
      drafts[existingIdx] = draft;
    } else {
      drafts.unshift(draft);
    }
    localStorage.setItem("post_drafts", JSON.stringify(drafts));
  } catch {
    // Ignore storage quota or security errors
  }
};

const deleteDraft = (id: string) => {
  try {
    const drafts = getDrafts();
    localStorage.setItem("post_drafts", JSON.stringify(drafts.filter((d) => d.id !== id)));
  } catch {
    // Ignore storage quota or security errors
  }
};

const ComposeModal: React.FC<ComposeModalProps> = ({
  onClose,
  onPostCreated,
  quotePost: initialQuotePost,
  replyToPost: initialReplyToPost,
  pendingPin: initialPendingPin,
  initialState,
}) => {
  const [view, setView] = useState<"compose" | "drafts" | "confirm_save">("compose");
  const [pendingAction, setPendingAction] = useState<"close" | "view_drafts" | null>(null);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [editorLayout, setEditorLayout] = useState<"write" | "split" | "preview">("write");
  const [isExpandedWidth, setIsExpandedWidth] = useState<boolean>(false);

  const [content, setContent] = useState(initialState?.content || initialState?.defaultText || "");
  const [artifactId, setArtifactId] = useState<number | null>(
    initialState?.artifactId ?? initialState?.artifactViewId ?? null,
  );
  const [notebookMode, setNotebookMode] = useState<boolean>(
    Boolean(initialState?.notebookMode || initialState?.isNotebookMode),
  );
  const [notebookTitle, setNotebookTitle] = useState<string>(initialState?.notebookTitle || "");
  const [notebookSummary, setNotebookSummary] = useState<string>(initialState?.notebookSummary || "");
  const [notebookDifficulty, setNotebookDifficulty] = useState<TutorialDifficulty | undefined>(
    initialState?.notebookDifficulty || "Intermediate",
  );
  const [notebookSeries, setNotebookSeries] = useState<string>(initialState?.notebookSeries || "");
  const [notebookDialect, setNotebookDialect] = useState<string>(initialState?.notebookDialect || "Modelica 3.4");
  const [notebookCompanionRepo, setNotebookCompanionRepo] = useState<string>(initialState?.notebookCompanionRepo || "");
  const [notebookCells, setNotebookCells] = useState<NotebookCell[]>(
    initialState?.notebookCells || [{ id: createCellId("md"), type: "markdown", content: "" }],
  );

  const [currentQuotePost, setCurrentQuotePost] = useState(initialState?.quotePost || initialQuotePost);
  const [currentReplyToPost, setCurrentReplyToPost] = useState(initialState?.replyToPost || initialReplyToPost);
  const [currentPendingPin, setCurrentPendingPin] = useState(initialState?.pendingPin || initialPendingPin);

  useEffect(() => {
    if (!initialState) return;
    if (initialState.content || initialState.defaultText) {
      setContent(initialState.content || initialState.defaultText || "");
    }
    if (initialState.notebookMode !== undefined || initialState.isNotebookMode !== undefined) {
      setNotebookMode(Boolean(initialState.notebookMode || initialState.isNotebookMode));
    }
    if (initialState.notebookTitle) {
      setNotebookTitle(initialState.notebookTitle);
    }
    if (initialState.notebookSummary !== undefined) {
      setNotebookSummary(initialState.notebookSummary);
    }
    if (initialState.notebookDifficulty) {
      setNotebookDifficulty(initialState.notebookDifficulty);
    }
    if (initialState.notebookSeries !== undefined) {
      setNotebookSeries(initialState.notebookSeries);
    }
    if (initialState.notebookDialect !== undefined) {
      setNotebookDialect(initialState.notebookDialect);
    }
    if (initialState.notebookCompanionRepo !== undefined) {
      setNotebookCompanionRepo(initialState.notebookCompanionRepo);
    }
    if (initialState.notebookCells && initialState.notebookCells.length > 0) {
      setNotebookCells(initialState.notebookCells);
    }
    if (initialState.morselPayload && artifactId === null) {
      const { code, title, dialect } = initialState.morselPayload;
      const viewConfigObj: Record<string, any> = {
        code,
        dialect: dialect || "modelica",
        title: title || "Model",
      };
      if (initialState.forkedFromArtifactId) {
        viewConfigObj.forkedFromArtifactId = initialState.forkedFromArtifactId;
      }
      createArtifactView({
        artifact_type: "morsel",
        view_config: JSON.stringify(viewConfigObj),
        title: `⚡ ${title || "Interactive Morsel Model"}`,
      })
        .then((data) => {
          setArtifactId(data.id);
        })
        .catch(console.error);
    } else if (initialState.packagePayload && artifactId === null) {
      const pkg = initialState.packagePayload;
      createArtifactView({
        artifact_type: "package",
        source_type: "registry",
        title: `${pkg.name}@${pkg.version || "1.0.0"}`,
        view_config: JSON.stringify(pkg),
      })
        .then((data) => {
          setArtifactId(data.id);
        })
        .catch(console.error);
    } else if (initialState.repoPayload && artifactId === null) {
      const repo = initialState.repoPayload;
      createArtifactView({
        artifact_type: "repository",
        source_type: "git",
        title: `${repo.namespace}/${repo.project}`,
        view_config: JSON.stringify(repo),
      })
        .then((data) => {
          setArtifactId(data.id);
        })
        .catch(console.error);
    }
  }, [initialState, artifactId]);

  const [draftsList, setDraftsList] = useState<DraftPost[]>([]);

  const isDirty =
    content.trim() !== "" ||
    artifactId !== null ||
    (notebookMode &&
      (notebookTitle.trim() !== "" ||
        notebookCells.some((c) => (c.type === "markdown" ? c.content.trim() !== "" : Boolean(c.artifactId)))));

  const handleCloseClick = useCallback(() => {
    if (isDirty && !initialState?.editPostId) {
      setPendingAction("close");
      setView("confirm_save");
    } else {
      onClose();
    }
  }, [isDirty, initialState?.editPostId, onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (view === "drafts") {
          setView("compose");
        } else if (view === "confirm_save") {
          setView("compose");
        } else {
          handleCloseClick();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [view, handleCloseClick]);

  const handleDraftsClick = () => {
    if (isDirty) {
      setPendingAction("view_drafts");
      setView("confirm_save");
    } else {
      setDraftsList(getDrafts());
      setView("drafts");
    }
  };

  const commitDraftAndNavigate = () => {
    if (isDirty) {
      const draftId = activeDraftId || Date.now().toString();
      upsertDraft({
        id: draftId,
        content,
        artifactId,
        notebookMode,
        notebookTitle,
        notebookSummary,
        notebookDifficulty,
        notebookSeries,
        notebookDialect,
        notebookCompanionRepo,
        notebookCells,
        quotePost: currentQuotePost,
        replyToPost: currentReplyToPost,
        pendingPin: currentPendingPin,
        timestamp: Date.now(),
      });
    }
    setActiveDraftId(null);
    setContent("");
    setArtifactId(null);
    setNotebookMode(false);
    setNotebookTitle("");
    setNotebookSummary("");
    setNotebookSeries("");
    setNotebookCompanionRepo("");
    setNotebookCells([{ id: createCellId("md"), type: "markdown", content: "" }]);
    setCurrentQuotePost(initialQuotePost);
    setCurrentReplyToPost(initialReplyToPost);
    setCurrentPendingPin(initialPendingPin);

    if (pendingAction === "close") {
      onClose();
    } else {
      setDraftsList(getDrafts());
      setView("drafts");
    }
  };

  const discardAndNavigate = () => {
    setActiveDraftId(null);
    setContent("");
    setArtifactId(null);
    setNotebookMode(false);
    setNotebookTitle("");
    setNotebookSummary("");
    setNotebookSeries("");
    setNotebookCompanionRepo("");
    setNotebookCells([{ id: createCellId("md"), type: "markdown", content: "" }]);
    setCurrentQuotePost(initialQuotePost);
    setCurrentReplyToPost(initialReplyToPost);
    setCurrentPendingPin(initialPendingPin);

    if (pendingAction === "close") {
      onClose();
    } else {
      setDraftsList(getDrafts());
      setView("drafts");
    }
  };

  const loadDraft = (draft: DraftPost) => {
    setActiveDraftId(draft.id);
    setContent(draft.content);
    setArtifactId(draft.artifactId);
    setNotebookMode(Boolean(draft.notebookMode));
    setNotebookTitle(draft.notebookTitle || "");
    setNotebookSummary(draft.notebookSummary || "");
    setNotebookDifficulty(draft.notebookDifficulty || "Intermediate");
    setNotebookSeries(draft.notebookSeries || "");
    setNotebookDialect(draft.notebookDialect || "Modelica 3.4");
    setNotebookCompanionRepo(draft.notebookCompanionRepo || "");
    setNotebookCells(draft.notebookCells || [{ id: createCellId("md"), type: "markdown", content: draft.content }]);
    setCurrentQuotePost(draft.quotePost);
    setCurrentReplyToPost(draft.replyToPost);
    setCurrentPendingPin(draft.pendingPin);
    setView("compose");
  };

  const computedMaxWidth = editorLayout === "split" || isExpandedWidth ? "1180px" : notebookMode ? "840px" : "600px";

  const renderLiveTutorialPreview = () => {
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
          <span
            style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "11px", color: "var(--color-text-muted)" }}
          >
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

  return (
    <>
      <Overlay
        onClick={view === "compose" ? handleCloseClick : undefined}
        style={{ paddingTop: editorLayout === "split" || isExpandedWidth ? "3vh" : "7vh" }}
      >
        <ModalPanel
          onClick={(e) => e.stopPropagation()}
          style={{
            maxWidth: computedMaxWidth,
            maxHeight: editorLayout === "split" || isExpandedWidth ? "92vh" : "86vh",
            margin: "0 auto",
            display: view === "drafts" ? "none" : "flex",
          }}
        >
          <Header
            style={{
              gap: "8px",
              borderBottom: "1px solid var(--color-border-subtle, rgba(255,255,255,0.06))",
              paddingBottom: "8px",
            }}
          >
            <IconButton
              icon={XIcon}
              variant="invisible"
              onClick={handleCloseClick}
              aria-label="Close"
              sx={{
                color: "var(--color-text-primary)",
                borderRadius: "50%",
                width: "36px",
                height: "36px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                "&:hover": { backgroundColor: "rgba(255, 255, 255, 0.06)" },
              }}
            />
            {initialState?.editPostId && (
              <span
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: "12px",
                  fontWeight: 700,
                  color: "var(--color-accent-cyan)",
                }}
              >
                ✏️ Editing {notebookMode ? "Tutorial" : "Post"} #{initialState.editPostId}
              </span>
            )}
            <Box flex={1} />
            <div
              style={{
                display: "inline-flex",
                gap: "4px",
                padding: "3px",
                borderRadius: "8px",
                background: "rgba(255, 255, 255, 0.04)",
                border: "1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.1))",
              }}
            >
              {(
                [
                  { id: "write", label: "✏️ Write" },
                  { id: "split", label: "◫ Split Preview" },
                  { id: "preview", label: "👁️ Preview" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setEditorLayout(tab.id)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: "6px",
                    border: "none",
                    background: editorLayout === tab.id ? "rgba(6, 182, 212, 0.18)" : "transparent",
                    color: editorLayout === tab.id ? "var(--color-accent-cyan)" : "var(--color-text-muted)",
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: "11.5px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setIsExpandedWidth(!isExpandedWidth)}
              title="Toggle full-width tutorial studio"
              style={{
                background: "rgba(255, 255, 255, 0.04)",
                border: "1px solid var(--color-border-subtle)",
                borderRadius: "8px",
                color: "var(--color-text-secondary)",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "11.5px",
                padding: "5px 10px",
                cursor: "pointer",
              }}
            >
              {isExpandedWidth ? "🗗 Compact" : "⛶ Expand"}
            </button>
            <button
              onClick={handleDraftsClick}
              style={{
                background: "none",
                border: "none",
                color: "var(--color-accent-cyan)",
                fontWeight: "bold",
                fontSize: "14px",
                cursor: "pointer",
                paddingRight: "8px",
              }}
            >
              Drafts
            </button>
          </Header>
          <Body>
            {initialState?.forkedFromArtifactId && (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "12px",
                  padding: "4px 10px",
                  borderRadius: "6px",
                  background: "rgba(245, 158, 11, 0.12)",
                  color: "#f59e0b",
                  border: "1px solid rgba(245, 158, 11, 0.25)",
                  marginBottom: "12px",
                  fontWeight: 600,
                  fontFamily: "var(--font-mono, monospace)",
                }}
              >
                <span>⚡ Forking Artifact #{initialState.forkedFromArtifactId}</span>
              </div>
            )}
            <div
              style={{
                display: editorLayout === "split" ? "grid" : "flex",
                gridTemplateColumns: editorLayout === "split" ? "minmax(0, 1fr) minmax(0, 1fr)" : undefined,
                flexDirection: editorLayout === "split" ? undefined : "column",
                gap: "16px",
                alignItems: "start",
              }}
            >
              {editorLayout !== "preview" && (
                <div style={{ minWidth: 0, width: "100%" }}>
                  <ComposeBox
                    editPostId={initialState?.editPostId}
                    content={content}
                    setContent={setContent}
                    artifactId={artifactId}
                    setArtifactId={setArtifactId}
                    notebookMode={notebookMode}
                    setNotebookMode={setNotebookMode}
                    notebookTitle={notebookTitle}
                    setNotebookTitle={setNotebookTitle}
                    notebookSummary={notebookSummary}
                    setNotebookSummary={setNotebookSummary}
                    notebookDifficulty={notebookDifficulty}
                    setNotebookDifficulty={setNotebookDifficulty}
                    notebookSeries={notebookSeries}
                    setNotebookSeries={setNotebookSeries}
                    notebookDialect={notebookDialect}
                    setNotebookDialect={setNotebookDialect}
                    notebookCompanionRepo={notebookCompanionRepo}
                    setNotebookCompanionRepo={setNotebookCompanionRepo}
                    notebookCells={notebookCells}
                    setNotebookCells={setNotebookCells}
                    onPostCreated={(post) => {
                      if (activeDraftId) {
                        deleteDraft(activeDraftId);
                        setActiveDraftId(null);
                      }
                      onPostCreated?.(post);
                      onClose();
                    }}
                    quotePost={currentQuotePost}
                    replyToPost={currentReplyToPost}
                    pendingPin={currentPendingPin}
                    minRows={1}
                    autoFocus={true}
                    isModal={true}
                  />
                </div>
              )}
              {(editorLayout === "split" || editorLayout === "preview") && (
                <div style={{ minWidth: 0, width: "100%" }}>{renderLiveTutorialPreview()}</div>
              )}
            </div>
          </Body>
        </ModalPanel>

        {view === "drafts" && (
          <Box display="flex" flexDirection="column" height="100%">
            <Header style={{ paddingBottom: "12px", borderBottom: "1px solid var(--color-border)" }}>
              <IconButton
                icon={ArrowLeftIcon}
                variant="invisible"
                onClick={() => setView("compose")}
                aria-label="Back"
              />
              <Heading as="h3" style={{ margin: "0 0 0 16px", fontSize: "20px", color: "var(--color-text-heading)" }}>
                Drafts
              </Heading>
            </Header>
            <Box flex={1} overflowY="auto">
              {draftsList.length === 0 ? (
                <Box p={5} textAlign="center" color="var(--color-text-muted)">
                  No drafts yet.
                </Box>
              ) : (
                draftsList.map((draft) => (
                  <Box
                    key={draft.id}
                    p={3}
                    borderBottom="1px solid var(--color-border)"
                    style={{ cursor: "pointer", transition: "background-color 0.2s" }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.04)")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    onClick={() => loadDraft(draft)}
                  >
                    <Box display="flex" justifyContent="space-between" alignItems="center">
                      <span style={{ color: "var(--color-text-muted)", fontSize: "13px" }}>
                        {new Date(draft.timestamp).toLocaleString()}
                      </span>
                      <IconButton
                        icon={TrashIcon}
                        variant="invisible"
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteDraft(draft.id);
                          setDraftsList(getDrafts());
                        }}
                        sx={{ color: "var(--color-error)" }}
                      />
                    </Box>
                    <Box
                      mt={2}
                      style={{
                        fontSize: "15px",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        maxHeight: "100px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        color: "var(--color-text-primary)",
                      }}
                    >
                      {draft.content ||
                        (draft.artifactId ? "[Artifact Attached]" : "") ||
                        (draft.quotePost ? "[Quoted Post]" : "") ||
                        (draft.replyToPost ? "[Reply]" : "")}
                    </Box>
                  </Box>
                ))
              )}
            </Box>
          </Box>
        )}
      </Overlay>

      {view === "confirm_save" && (
        <Overlay style={{ zIndex: 1100, background: "rgba(0,0,0,0.6)" }} onClick={() => setView("compose")}>
          <ModalPanel
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "320px", minHeight: "auto", margin: "auto" }}
          >
            <Box p={4} pb={5} display="flex" flexDirection="column" alignItems="flex-start" gap={2}>
              <Heading
                as="h3"
                style={{
                  margin: "4px 0 0 0",
                  fontSize: "20px",
                  fontWeight: "bold",
                  color: "var(--color-text-heading)",
                }}
              >
                Save post?
              </Heading>
              <span
                style={{ color: "var(--color-text-muted)", fontSize: "15px", lineHeight: "1.4", marginBottom: "8px" }}
              >
                You can save this to send later from your drafts.
              </span>
              <Box display="flex" flexDirection="column" gap={3} width="100%" mt={2}>
                <button
                  style={{
                    background: "var(--gradient-cta)",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "9999px",
                    padding: "12px",
                    fontWeight: "bold",
                    fontSize: "15px",
                    cursor: "pointer",
                    boxShadow: "var(--glow-ai-sm)",
                  }}
                  onClick={commitDraftAndNavigate}
                >
                  Save
                </button>
                <button
                  style={{
                    background: "transparent",
                    color: "var(--color-text-primary)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "9999px",
                    padding: "12px",
                    fontWeight: "bold",
                    fontSize: "15px",
                    cursor: "pointer",
                  }}
                  onClick={discardAndNavigate}
                >
                  Discard
                </button>
              </Box>
            </Box>
          </ModalPanel>
        </Overlay>
      )}
    </>
  );
};

export default ComposeModal;
