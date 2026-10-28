// SPDX-License-Identifier: AGPL-3.0-or-later

import { ColumnsIcon, EyeIcon, PencilIcon, ScreenFullIcon, XIcon } from "@primer/octicons-react";
import { IconButton } from "@primer/react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createArtifactView } from "../../api";
import { createCellId, type NotebookCell, type TutorialDifficulty } from "../../util/notebook";
import Box from "../Box";
import ComposeBox from "../ComposeBox";
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
  const [notebookTitle, setNotebookTitle] = useState<string>(
    initialState?.notebookTitle || initialState?.initialTitle || "",
  );
  const [notebookSummary, setNotebookSummary] = useState<string>(initialState?.notebookSummary || "");
  const [notebookDifficulty, setNotebookDifficulty] = useState<TutorialDifficulty | undefined>(
    initialState?.notebookDifficulty || "Intermediate",
  );
  const [notebookSeries, setNotebookSeries] = useState<string>(initialState?.notebookSeries || "");
  const [notebookDialect, setNotebookDialect] = useState<string>(
    initialState?.notebookDialect || initialState?.initialDialect || "Modelica 3.4",
  );
  const [notebookCompanionRepo, setNotebookCompanionRepo] = useState<string>(
    initialState?.notebookCompanionRepo || initialState?.companionRepo || "",
  );
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
    if (initialState.notebookDifficulty) {
      setNotebookDifficulty(initialState.notebookDifficulty);
    }
    if (initialState.notebookSeries !== undefined) {
      setNotebookSeries(initialState.notebookSeries);
    }
    if (initialState.notebookDialect !== undefined || initialState.initialDialect !== undefined) {
      setNotebookDialect(initialState.notebookDialect || initialState.initialDialect || "Modelica 3.4");
    }
    if (initialState.notebookCompanionRepo !== undefined || initialState.companionRepo !== undefined) {
      setNotebookCompanionRepo(initialState.notebookCompanionRepo || initialState.companionRepo || "");
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
        .catch(console.error);
    }
  }, [initialState]); // eslint-disable-line react-hooks/exhaustive-deps

  const [draftsList, setDraftsList] = useState<DraftPost[]>([]);

  const hasUnsavedChanges = useCallback(() => {
    if (initialState?.editPostId) {
      const baselineContent = (
        initialState.initialContent ??
        initialState.content ??
        initialState.defaultText ??
        ""
      ).trim();
      const baselineArtifactId = initialState.artifactId ?? initialState.artifactViewId ?? null;
      if (notebookMode) {
        const baselineTitle = (initialState.notebookTitle ?? initialState.initialTitle ?? "").trim();
        const baselineSummary = (initialState.notebookSummary ?? "").trim();
        return (
          content.trim() !== baselineContent ||
          notebookTitle.trim() !== baselineTitle ||
          notebookSummary.trim() !== baselineSummary ||
          artifactId !== baselineArtifactId
        );
      }
      return content.trim() !== baselineContent || artifactId !== baselineArtifactId;
    }
    if (notebookMode) {
      return Boolean(
        notebookTitle.trim() ||
        notebookSummary.trim() ||
        notebookCells.some((c) => (c.type === "markdown" && c.content.trim()) || c.type === "artifact"),
      );
    }
    return Boolean(
      content.trim().length > 0 || artifactId !== null || currentQuotePost || currentReplyToPost || currentPendingPin,
    );
  }, [
    initialState,
    notebookMode,
    notebookTitle,
    notebookSummary,
    notebookCells,
    content,
    artifactId,
    currentQuotePost,
    currentReplyToPost,
    currentPendingPin,
  ]);

  const handleCloseClick = () => {
    if (hasUnsavedChanges()) {
      setPendingAction("close");
      setView("confirm_save");
    } else {
      onClose();
    }
  };

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

  return (
    <>
      <Overlay
        onClick={view === "drafts" ? onClose : view === "compose" ? handleCloseClick : undefined}
        style={{ paddingTop: editorLayout === "split" || isExpandedWidth ? "3vh" : "7vh" }}
      >
        <ModalPanel
          onClick={(e) => e.stopPropagation()}
          style={{
            maxWidth: view === "drafts" ? "600px" : computedMaxWidth,
            maxHeight: editorLayout === "split" || isExpandedWidth ? "92vh" : "86vh",
            margin: "0 auto",
            display: "flex",
          }}
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
          ) : (
            <>
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
                  style={{
                    color: "var(--color-text-primary)",
                    borderRadius: "50%",
                    width: "36px",
                    height: "36px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                />
                {initialState?.editPostId && (
                  <span
                    style={{
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "var(--color-accent-cyan)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "5px",
                    }}
                  >
                    <PencilIcon size={12} /> Editing {notebookMode ? "Tutorial" : "Post"} #{initialState.editPostId}
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
                      { id: "write", label: "Write", icon: PencilIcon },
                      { id: "split", label: "Split Preview", icon: ColumnsIcon },
                      { id: "preview", label: "Preview", icon: EyeIcon },
                    ] as const
                  ).map((tab) => {
                    const TabIcon = tab.icon;
                    return (
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
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                        }}
                      >
                        <TabIcon size={12} /> {tab.label}
                      </button>
                    );
                  })}
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
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
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
                  {editorLayout === "preview" && (
                    <div style={{ minWidth: 0, width: "100%" }}>
                      <TutorialPreview
                        notebookMode={notebookMode}
                        notebookTitle={notebookTitle}
                        notebookSummary={notebookSummary}
                        notebookDifficulty={notebookDifficulty}
                        notebookSeries={notebookSeries}
                        notebookDialect={notebookDialect}
                        notebookCells={notebookCells}
                        content={content}
                      />
                    </div>
                  )}
                  <div style={{ minWidth: 0, width: "100%" }}>
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
};

export default ComposeModal;
