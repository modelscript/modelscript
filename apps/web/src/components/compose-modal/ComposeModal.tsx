// SPDX-License-Identifier: AGPL-3.0-or-later

import { ColumnsIcon, EyeIcon, PencilIcon, ScreenFullIcon, XIcon } from "@primer/octicons-react";
import { IconButton } from "@primer/react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createArtifactView, getPost } from "../../api";
import { createCellId, type NotebookCell, type TutorialDifficulty } from "../../util/notebook";
import Box from "../Box";
import ComposeBox from "../ComposeBox";
import { useToast } from "../ToastContext";
import { ConfirmSaveModal } from "./ConfirmSaveModal";
import { deleteDraft, getDrafts, upsertDraft } from "./drafts";
import { DraftsView } from "./DraftsView";
import { Body, Header, ModalPanel, Overlay } from "./styles";
import { TutorialPreview } from "./TutorialPreview";
import type { ComposeModalProps, DraftPost } from "./types";

export const ComposeModal: React.FC<ComposeModalProps> = ({
  onClose,
  onPostCreated,
  quotePost: initialQuotePost,
  replyToPost: initialReplyToPost,
  pendingPin: initialPendingPin,
  initialState,
}) => {
  const toast = useToast();
  const [view, setView] = useState<"compose" | "drafts" | "confirm_save">("compose");
  const [pendingAction, setPendingAction] = useState<"close" | "view_drafts" | null>(null);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [editorLayout, setEditorLayout] = useState<"write" | "split" | "preview">("write");
  const [isExpandedWidth, setIsExpandedWidth] = useState<boolean>(false);

  const [content, setContent] = useState(initialState?.content || initialState?.defaultText || "");
  const [contentWarning, setContentWarning] = useState(initialState?.contentWarning || "");
  const [artifactId, setArtifactId] = useState<number | null>(
    initialState?.artifactId ?? initialState?.artifactViewId ?? null,
  );
  const [notebookMode, setNotebookMode] = useState<boolean>(
    Boolean(initialState?.notebookMode || initialState?.isNotebookMode),
  );
  const [notebookTitle, setNotebookTitle] = useState<string>(
    initialState?.notebookTitle || initialState?.initialTitle || "",
  );
  const [notebookSummary, setNotebookSummary] = useState<string>(initialState?.notebookSummary || "");
  const [notebookDifficulty, setNotebookDifficulty] = useState<TutorialDifficulty | undefined>(
    initialState?.notebookDifficulty,
  );
  const [notebookSeries, setNotebookSeries] = useState<string>(initialState?.notebookSeries || "");
  const [notebookDialect, setNotebookDialect] = useState<string>(
    initialState?.notebookDialect || initialState?.initialDialect || "",
  );
  const [notebookCompanionRepo, setNotebookCompanionRepo] = useState<string>(
    initialState?.notebookCompanionRepo || initialState?.companionRepo || "",
  );
  const [notebookTopics, setNotebookTopics] = useState<string[]>(initialState?.notebookTopics || []);
  const [notebookCells, setNotebookCells] = useState<NotebookCell[]>(
    initialState?.notebookCells || [{ id: createCellId("md"), type: "markdown", content: "" }],
  );

  const [currentQuotePost, setCurrentQuotePost] = useState(initialState?.quotePost || initialQuotePost);
  const [currentReplyToPost, setCurrentReplyToPost] = useState(initialState?.replyToPost || initialReplyToPost);
  const [currentPendingPin, setCurrentPendingPin] = useState(initialState?.pendingPin || initialPendingPin);

  const initializedPayloadRef = useRef<unknown>(null);

  useEffect(() => {
    if (!initialState) return;
    if (initialState.content || initialState.defaultText) {
      setContent(initialState.content || initialState.defaultText || "");
    }
    if (initialState.notebookMode !== undefined || initialState.isNotebookMode !== undefined) {
      setNotebookMode(Boolean(initialState.notebookMode || initialState.isNotebookMode));
    }
    if (initialState.notebookTitle || initialState.initialTitle) {
      setNotebookTitle(initialState.notebookTitle || initialState.initialTitle || "");
    }
    if (initialState.notebookSummary !== undefined) {
      setNotebookSummary(initialState.notebookSummary);
    }
    if (initialState.notebookDifficulty !== undefined) {
      setNotebookDifficulty(initialState.notebookDifficulty);
    }
    if (initialState.notebookSeries !== undefined) {
      setNotebookSeries(initialState.notebookSeries);
    }
    if (initialState.notebookDialect !== undefined || initialState.initialDialect !== undefined) {
      setNotebookDialect(initialState.notebookDialect || initialState.initialDialect || "");
    }
    if (initialState.notebookCompanionRepo !== undefined || initialState.companionRepo !== undefined) {
      setNotebookCompanionRepo(initialState.notebookCompanionRepo || initialState.companionRepo || "");
    }
    if (initialState.notebookTopics !== undefined) {
      setNotebookTopics(initialState.notebookTopics);
    }
    if (initialState.contentWarning !== undefined) {
      setContentWarning(initialState.contentWarning || "");
    }
    if (initialState.editPostId && !initialState.content && !initialState.defaultText) {
      getPost(initialState.editPostId)
        .then((data) => {
          if (data?.post) {
            if (data.post.content) {
              setContent((prev) => (prev ? prev : data.post.content));
            }
            if (data.post.content_warning || (data.post.metadata as any)?.contentWarning) {
              const cw = data.post.content_warning || (data.post.metadata as any)?.contentWarning;
              setContentWarning((prev) => (prev ? prev : cw));
            }
          }
        })
        .catch(() => {});
    }
    if (initialState.notebookCells && initialState.notebookCells.length > 0) {
      setNotebookCells(initialState.notebookCells);
    }

    if (initializedPayloadRef.current === initialState) return;
    initializedPayloadRef.current = initialState;

    if (initialState.morselPayload && artifactId === null) {
      const { code, title, dialect, isMultiFile, files, primaryFile, forkedFromArtifactId } =
        initialState.morselPayload;
      const viewConfigObj: Record<string, any> = {
        code,
        dialect: dialect || "modelica",
        title: title || "Model",
        ...(isMultiFile !== undefined ? { isMultiFile } : {}),
        ...(files !== undefined ? { files } : {}),
        ...(primaryFile !== undefined ? { primaryFile } : {}),
      };
      const effectiveForkId = initialState.forkedFromArtifactId ?? forkedFromArtifactId;
      if (effectiveForkId) {
        viewConfigObj["forkedFromArtifactId"] = effectiveForkId;
      }
      const resolvedDialect = dialect || "modelica";
      const finalTitle = title || "Model";
      createArtifactView({
        artifact_type: resolvedDialect === "modelica" ? "modelica-diagram" : resolvedDialect,
        dialect: resolvedDialect,
        title: finalTitle,
        view_config: JSON.stringify(viewConfigObj),
      })
        .then((data) => {
          setArtifactId(data.id);
        })
        .catch((err) => {
          console.error("Failed to attach model artifact:", err);
          toast.error("Could not attach the model to your post. Please try again.");
        });
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
        .catch((err) => {
          console.error("Failed to attach model artifact:", err);
          toast.error("Could not attach the model to your post. Please try again.");
        });
    } else if (initialState.repoPayload && artifactId === null) {
      const repo = initialState.repoPayload;
      createArtifactView({
        artifact_type: "repository",
        source_type: "git",
        title: `${repo.namespace}/${repo.project}`,
        view_config: JSON.stringify({
          namespace: repo.namespace,
          project: repo.project,
          provider: repo.provider || "github",
          description: repo.description,
          defaultBranch: repo.defaultBranch || "main",
        }),
      })
        .then((data) => {
          setArtifactId(data.id);
        })
        .catch((err) => {
          console.error("Failed to attach model artifact:", err);
          toast.error("Could not attach the model to your post. Please try again.");
        });
    }
  }, [initialState]); // eslint-disable-line react-hooks/exhaustive-deps

  const [draftsList, setDraftsList] = useState<DraftPost[]>(() => getDrafts());
  const modalPanelRef = useRef<HTMLDivElement>(null);

  const hasUnsavedChanges = useCallback(() => {
    if (initialState?.editPostId) {
      const baselineContent = (
        initialState.initialContent ??
        initialState.content ??
        initialState.defaultText ??
        ""
      ).trim();
      const baselineArtifactId = initialState.artifactId ?? initialState.artifactViewId ?? null;
      const baselineCW = (initialState.contentWarning ?? "").trim();
      if (notebookMode) {
        const baselineTitle = (initialState.notebookTitle ?? initialState.initialTitle ?? "").trim();
        const baselineSummary = (initialState.notebookSummary ?? "").trim();
        return (
          content.trim() !== baselineContent ||
          contentWarning.trim() !== baselineCW ||
          notebookTitle.trim() !== baselineTitle ||
          notebookSummary.trim() !== baselineSummary ||
          artifactId !== baselineArtifactId
        );
      }
      return (
        content.trim() !== baselineContent || contentWarning.trim() !== baselineCW || artifactId !== baselineArtifactId
      );
    }
    if (notebookMode) {
      return Boolean(
        notebookTitle.trim() ||
        notebookSummary.trim() ||
        notebookCells.some((c) => (c.type === "markdown" && c.content.trim()) || c.type === "artifact"),
      );
    }
    return Boolean(
      content.trim().length > 0 ||
      contentWarning.trim().length > 0 ||
      artifactId !== null ||
      currentQuotePost ||
      currentReplyToPost ||
      currentPendingPin,
    );
  }, [
    initialState,
    notebookMode,
    notebookTitle,
    notebookSummary,
    notebookCells,
    content,
    contentWarning,
    artifactId,
    currentQuotePost,
    currentReplyToPost,
    currentPendingPin,
  ]);

  const handleCloseClick = useCallback(() => {
    if (hasUnsavedChanges()) {
      setPendingAction("close");
      setView("confirm_save");
    } else {
      onClose();
    }
  }, [hasUnsavedChanges, onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (view === "compose") {
          e.preventDefault();
          handleCloseClick();
        } else if (view === "drafts") {
          e.preventDefault();
          setView("compose");
        }
        return;
      }

      if (e.key === "Tab" && view !== "confirm_save" && modalPanelRef.current) {
        const focusable = Array.from(
          modalPanelRef.current.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first || !modalPanelRef.current.contains(document.activeElement)) {
            e.preventDefault();
            last?.focus();
          }
        } else if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [view, handleCloseClick]);

  const handleDraftsClick = () => {
    if (hasUnsavedChanges()) {
      setPendingAction("view_drafts");
      setView("confirm_save");
    } else {
      setDraftsList(getDrafts());
      setView("drafts");
    }
  };

  const commitDraftAndNavigate = () => {
    if (hasUnsavedChanges() && !initialState?.editPostId) {
      upsertDraft({
        id: activeDraftId || Date.now().toString(),
        content,
        artifactId,
        notebookMode,
        notebookTitle,
        notebookSummary,
        notebookDifficulty,
        notebookSeries,
        notebookDialect,
        notebookCompanionRepo,
        notebookTopics,
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
    setNotebookTopics([]);
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
    setNotebookTopics([]);
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
    setNotebookTopics(draft.notebookTopics || []);
    setNotebookCells(draft.notebookCells || [{ id: createCellId("md"), type: "markdown", content: draft.content }]);
    setCurrentQuotePost(draft.quotePost);
    setCurrentReplyToPost(draft.replyToPost);
    setCurrentPendingPin(draft.pendingPin);
    setView("compose");
  };

  const isFullPageNotebook = notebookMode && view === "compose";
  const isExpandedLayout = editorLayout === "split" || isExpandedWidth;

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const syncViewportHeight = () => {
      if (modalPanelRef.current) {
        modalPanelRef.current.style.setProperty("--compose-vvh", `${Math.round(vv.height)}px`);
      }
    };
    syncViewportHeight();
    vv.addEventListener("resize", syncViewportHeight);
    vv.addEventListener("scroll", syncViewportHeight);
    return () => {
      vv.removeEventListener("resize", syncViewportHeight);
      vv.removeEventListener("scroll", syncViewportHeight);
    };
  }, []);

  const modal = (
    <>
      <Overlay
        $isFullPageNotebook={isFullPageNotebook}
        $isExpanded={isExpandedLayout}
        onClick={view === "drafts" ? onClose : view === "compose" ? handleCloseClick : undefined}
      >
        <ModalPanel
          ref={modalPanelRef}
          role="dialog"
          aria-modal="true"
          aria-label={view === "drafts" ? "Saved drafts" : initialState?.editPostId ? "Edit post" : "Create post"}
          onClick={(e) => e.stopPropagation()}
          $isFullPageNotebook={isFullPageNotebook}
          $isExpanded={isExpandedLayout}
          $isDrafts={view === "drafts"}
        >
          {view === "drafts" ? (
            <DraftsView
              draftsList={draftsList}
              onBack={() => setView("compose")}
              onSelectDraft={loadDraft}
              onDeleteDraft={(id) => {
                deleteDraft(id);
                setDraftsList(getDrafts());
              }}
            />
          ) : isFullPageNotebook ? (
            <ComposeBox
              editPostId={initialState?.editPostId}
              forkedFromArtifactId={initialState?.forkedFromArtifactId}
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
              notebookTopics={notebookTopics}
              setNotebookTopics={setNotebookTopics}
              notebookCells={notebookCells}
              setNotebookCells={setNotebookCells}
              onCloseModal={handleCloseClick}
              onOpenDrafts={handleDraftsClick}
              editorLayout={editorLayout}
              setEditorLayout={setEditorLayout}
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
          ) : (
            <>
              <Header
                style={{
                  gap: "8px",
                  borderBottom: "1px solid var(--ms-divider, var(--color-border-subtle))",
                }}
              >
                <IconButton
                  icon={XIcon}
                  variant="invisible"
                  onClick={handleCloseClick}
                  aria-label="Close"
                  style={{
                    color: "var(--color-text-primary)",
                    borderRadius: "50%",
                    width: "34px",
                    height: "34px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginLeft: "-6px",
                  }}
                />
                {initialState?.editPostId && (
                  <span
                    style={{
                      fontSize: "12.5px",
                      fontWeight: 600,
                      color: "var(--ms-brand, var(--color-accent-cyan))",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "5px",
                    }}
                  >
                    <PencilIcon size={12} /> Editing Post #{initialState.editPostId}
                  </span>
                )}
                <Box flex={1} />
                <div
                  role="tablist"
                  aria-label="Editor layout mode"
                  style={{
                    display: "inline-flex",
                    gap: "2px",
                    padding: "3px",
                    borderRadius: "8px",
                    background: "var(--ms-surface-hover, rgba(15, 23, 42, 0.045))",
                    border: "1px solid var(--ms-divider, var(--color-border-subtle))",
                  }}
                >
                  {(
                    [
                      { id: "write", label: "Write", icon: PencilIcon },
                      { id: "split", label: "Split Preview", icon: ColumnsIcon },
                      { id: "preview", label: "Preview", icon: EyeIcon },
                    ] as const
                  ).map((tab) => {
                    const TabIcon = tab.icon;
                    const isActive = editorLayout === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        className={tab.id === "split" ? "desktop-only-action" : undefined}
                        onClick={() => {
                          setEditorLayout(tab.id);
                          if (tab.id === "split" && !isExpandedWidth) {
                            setIsExpandedWidth(true);
                          }
                        }}
                        style={{
                          padding: "4px 10px",
                          borderRadius: "6px",
                          border: "none",
                          background: isActive ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.12))" : "transparent",
                          color: isActive ? "var(--ms-brand, var(--color-accent-cyan))" : "var(--ms-text-2)",
                          fontFamily: "inherit",
                          fontSize: "12px",
                          fontWeight: isActive ? 600 : 500,
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                          transition: "background-color 0.15s ease, color 0.15s ease",
                        }}
                      >
                        <TabIcon size={12} /> {tab.label}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="desktop-only-action"
                  onClick={() => {
                    const nextExpanded = !isExpandedWidth;
                    setIsExpandedWidth(nextExpanded);
                    if (!nextExpanded && editorLayout === "split") {
                      setEditorLayout("write");
                    }
                  }}
                  title={isExpandedWidth ? "Restore compact modal width" : "Expand modal width"}
                  aria-pressed={isExpandedWidth}
                  style={{
                    background: isExpandedWidth ? "var(--ms-brand-soft)" : "transparent",
                    border: "1px solid var(--ms-border, var(--color-border-subtle))",
                    borderRadius: "8px",
                    color: isExpandedWidth ? "var(--ms-brand)" : "var(--ms-text-2)",
                    fontFamily: "inherit",
                    fontSize: "12px",
                    fontWeight: 500,
                    height: "30px",
                    padding: "0 10px",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    transition: "border-color 0.15s ease, color 0.15s ease, background-color 0.15s ease",
                  }}
                >
                  {isExpandedWidth ? (
                    <>
                      <ColumnsIcon size={12} /> Compact
                    </>
                  ) : (
                    <>
                      <ScreenFullIcon size={12} /> Expand
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleDraftsClick}
                  style={{
                    background: "transparent",
                    border: "none",
                    borderRadius: "999px",
                    color: "var(--ms-brand, var(--color-accent-cyan))",
                    fontWeight: 600,
                    fontSize: "13.5px",
                    cursor: "pointer",
                    padding: "5px 10px",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    transition: "background-color 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "var(--ms-surface-hover)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "transparent";
                  }}
                >
                  <span>Drafts</span>
                  {draftsList.length > 0 && (
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        padding: "1px 6px",
                        borderRadius: "999px",
                        background: "var(--ms-brand-soft)",
                        color: "var(--ms-brand)",
                      }}
                    >
                      {draftsList.length}
                    </span>
                  )}
                </button>
              </Header>
              <Body style={currentQuotePost ? { padding: "12px 18px 12px", gap: "8px" } : undefined}>
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
                      marginBottom: "4px",
                      fontWeight: 600,
                      fontFamily: "var(--font-mono, monospace)",
                      width: "fit-content",
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
                    gap: currentQuotePost ? "8px" : "16px",
                    alignItems: editorLayout === "split" ? "start" : "stretch",
                    flex: 1,
                  }}
                >
                  {editorLayout === "preview" && (
                    <div style={{ minWidth: 0, width: "100%" }}>
                      <TutorialPreview
                        notebookMode={notebookMode}
                        notebookTitle={notebookTitle}
                        notebookSummary={notebookSummary}
                        notebookDifficulty={notebookDifficulty}
                        notebookSeries={notebookSeries}
                        notebookDialect={notebookDialect}
                        notebookTopics={notebookTopics}
                        notebookCells={notebookCells}
                        content={content}
                      />
                    </div>
                  )}
                  <div style={{ minWidth: 0, width: "100%", flex: 1, display: "flex", flexDirection: "column" }}>
                    <ComposeBox
                      editPostId={initialState?.editPostId}
                      forkedFromArtifactId={initialState?.forkedFromArtifactId}
                      content={content}
                      setContent={setContent}
                      contentWarning={contentWarning}
                      setContentWarning={setContentWarning}
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
                      notebookTopics={notebookTopics}
                      setNotebookTopics={setNotebookTopics}
                      notebookCells={notebookCells}
                      setNotebookCells={setNotebookCells}
                      onCloseModal={handleCloseClick}
                      onOpenDrafts={handleDraftsClick}
                      editorLayout={editorLayout}
                      setEditorLayout={setEditorLayout}
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
                      minRows={currentQuotePost ? 1 : 3}
                      autoFocus={true}
                      isModal={true}
                      hideInput={editorLayout === "preview"}
                    />
                  </div>
                  {editorLayout === "split" && (
                    <div style={{ minWidth: 0, width: "100%" }}>
                      <TutorialPreview
                        notebookMode={notebookMode}
                        notebookTitle={notebookTitle}
                        notebookSummary={notebookSummary}
                        notebookDifficulty={notebookDifficulty}
                        notebookSeries={notebookSeries}
                        notebookDialect={notebookDialect}
                        notebookTopics={notebookTopics}
                        notebookCells={notebookCells}
                        content={content}
                      />
                    </div>
                  )}
                </div>
              </Body>
            </>
          )}
        </ModalPanel>
      </Overlay>

      {view === "confirm_save" && (
        <ConfirmSaveModal
          isEditing={Boolean(initialState?.editPostId)}
          onCancel={() => setView("compose")}
          onSave={commitDraftAndNavigate}
          onDiscard={discardAndNavigate}
        />
      )}
    </>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : modal;
};

export default ComposeModal;
