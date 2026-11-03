// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArrowLeftIcon,
  BookIcon,
  ColumnsIcon,
  EyeIcon,
  HistoryIcon,
  PencilIcon,
  SparklesFillIcon,
} from "@primer/octicons-react";
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { UNSAFE_LocationContext, UNSAFE_NavigationContext } from "react-router-dom";
import type { AiPolishMode } from "../api";
import { useAuth } from "../AuthContext";
import { useFeatureFlag } from "../FeatureFlagContext";
import { getAvatarUrl } from "../util/avatar";
import {
  type ComposerAiEngineMode,
  getPreferredAiEngine,
  runComposerAiDraft,
  runComposerAiPolish,
  setPreferredAiEngine,
} from "../util/composer-ai";
import { createCellId, estimateReadingTimeMinutes, type NotebookCell } from "../util/notebook";
import Box from "./Box";
import {
  Backdrop,
  ComposeAttachedArtifact,
  ComposeCodeSnippetModal,
  ComposeInput,
  ComposeMentionHashtagPopups,
  ComposeNotebookCellsEditor,
  ComposeQuoteAndPin,
  ComposeRecipientsModal,
  ComposeToolbar,
  ComposeTutorialMetaEditor,
  ComposeVisibilityMenu,
  NotebookCanvasScroll,
  NotebookDocumentColumn,
  NotebookPageOverlay,
  NotebookTopBar,
  NotionGhostButton,
  OverlayWrapper,
  TweetButton,
  useComposeAutocomplete,
  useComposeNotebookState,
  useComposeSubmit,
} from "./compose";
import { ConfirmSaveModal } from "./compose-modal/ConfirmSaveModal";
import { deleteDraft, getDrafts, upsertDraft } from "./compose-modal/drafts";
import { DraftsView } from "./compose-modal/DraftsView";
import { ModalPanel, Overlay } from "./compose-modal/styles";
import { TutorialPreview } from "./compose-modal/TutorialPreview";
import type { DraftPost } from "./compose-modal/types";
import type { ComposeBoxProps } from "./compose/types";

const HpcArtifactPickerModal = React.lazy(() => import("./HpcArtifactPickerModal"));
const MorselComposeModal = React.lazy(() => import("./MorselComposeModal"));
const PackageRepoPickerModal = React.lazy(() => import("./PackageRepoPickerModal"));

export type { ComposeBoxProps } from "./compose/types";

export default function ComposeBox(props: ComposeBoxProps) {
  const {
    onPostCreated,
    editPostId,
    forkedFromArtifactId,
    quotePost,
    replyToPost,
    placeholder,
    minRows = 1,
    autoFocus,
    pendingPin,
    content: controlledContent,
    setContent: setControlledContent,
    artifactId: controlledArtifactId,
    setArtifactId: setControlledArtifactId,
    isModal,
    hideInput,
    onCloseModal,
    onOpenDrafts,
    editorLayout: controlledEditorLayout,
    setEditorLayout: setControlledEditorLayout,
  } = props;

  const { user, token } = useAuth();

  const [internalContent, setInternalContent] = useState("");
  const content = controlledContent !== undefined ? controlledContent : internalContent;
  const setContent = setControlledContent || setInternalContent;

  const [internalArtifactId, setInternalArtifactId] = useState<number | null>(null);
  const artifactId = controlledArtifactId !== undefined ? controlledArtifactId : internalArtifactId;
  const setArtifactId = setControlledArtifactId || setInternalArtifactId;

  const [internalEditorLayout, setInternalEditorLayout] = useState<"write" | "split" | "preview">("write");
  const activeEditorLayout = controlledEditorLayout !== undefined ? controlledEditorLayout : internalEditorLayout;
  const setActiveEditorLayout = setControlledEditorLayout || setInternalEditorLayout;

  // Notebook state management
  const notebook = useComposeNotebookState({
    content,
    setContent,
    artifactId,
    setArtifactId,
    props,
  });

  const [showCodeSnippetModal, setShowCodeSnippetModal] = useState(false);
  const [snippetFilename, setSnippetFilename] = useState("");
  const [snippetLang, setSnippetLang] = useState("modelica");
  const [snippetCode, setSnippetCode] = useState("");
  const [editingCodeCellId, setEditingCodeCellId] = useState<string | null>(null);

  const handleOpenCodeCellInModal = useCallback((cellId: string, lang: string, filename: string, code: string) => {
    setEditingCodeCellId(cellId);
    setSnippetLang(lang || "modelica");
    setSnippetFilename(filename || "");
    setSnippetCode(code || "");
    setShowCodeSnippetModal(true);
  }, []);

  const [postVisibility, setPostVisibility] = useState<"public" | "unlisted" | "followers" | "direct">(() => {
    const dv = user?.default_post_visibility;
    if (dv === "public" || dv === "unlisted" || dv === "followers" || dv === "direct") {
      return dv;
    }
    return "public";
  });
  const [replyVisibility, setReplyVisibility] = useState<"everyone" | "following" | "mentioned">(() => {
    const dv = user?.default_post_visibility;
    if (dv === "followers") return "following";
    if (dv === "direct") return "mentioned";
    return "everyone";
  });

  useEffect(() => {
    const dv = user?.default_post_visibility;
    if (dv === "public" || dv === "unlisted" || dv === "followers" || dv === "direct") {
      setPostVisibility(dv);
      if (dv === "followers") setReplyVisibility("following");
      else if (dv === "direct") setReplyVisibility("mentioned");
    }
  }, [user?.default_post_visibility]);

  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showContentWarning, setShowContentWarning] = useState(false);
  const [contentWarning, setContentWarning] = useState("");
  const [showHpcPicker, setShowHpcPicker] = useState(false);
  const [showMorselModal, setShowMorselModal] = useState(false);
  const [showPackageRepoPicker, setShowPackageRepoPicker] = useState(false);
  const hasHpc = useFeatureFlag("cae_cloud_solver");
  const hasComposerAiPolish = useFeatureFlag("composer_ai_polish");
  const hasAiPolishAlias = useFeatureFlag("ai_polish");
  const hasAiPolish = hasComposerAiPolish || hasAiPolishAlias;

  const [showVisibilityMenu, setShowVisibilityMenu] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(Boolean(autoFocus));
  const [showRecipientsModal, setShowRecipientsModal] = useState(false);
  const [excludedUsers, setExcludedUsers] = useState<Set<string>>(new Set());

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Autocomplete for mentions & hashtags
  const autocomplete = useComposeAutocomplete({
    user,
    token,
    content,
    setContent,
    replyToPost,
    isNotebookMode: notebook.isNotebookMode,
    activeCellId: notebook.activeCellId,
    notebookCells: notebook.notebookCells,
    updateMarkdownCell: notebook.updateMarkdownCell,
    textareaRef,
  });

  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [showConfirmSave, setShowConfirmSave] = useState(false);
  const [showDraftsModal, setShowDraftsModal] = useState(false);
  const [draftsList, setDraftsList] = useState<DraftPost[]>([]);
  const [pendingAction, setPendingAction] = useState<"navigate" | "view_drafts" | null>(null);
  const pendingNavigationRef = useRef<(() => void) | null>(null);
  const bypassNavigationBlockRef = useRef(false);

  const hasUnsavedChanges = useCallback(() => {
    if (isModal) return false;
    if (notebook.isNotebookMode) {
      return Boolean(
        notebook.notebookTitle.trim() ||
        notebook.notebookSummary.trim() ||
        notebook.notebookCells.some((c) => (c.type === "markdown" && c.content.trim()) || c.type === "artifact"),
      );
    }
    return Boolean(
      content.trim().length > 0 || artifactId !== null || contentWarning.trim().length > 0 || quotePost || pendingPin,
    );
  }, [
    isModal,
    notebook.isNotebookMode,
    notebook.notebookTitle,
    notebook.notebookSummary,
    notebook.notebookCells,
    content,
    artifactId,
    contentWarning,
    quotePost,
    pendingPin,
  ]);

  const hasUnsavedChangesRef = useRef(hasUnsavedChanges);
  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  const navCtx = React.useContext(UNSAFE_NavigationContext);
  const locCtx = React.useContext(UNSAFE_LocationContext);
  const navigator = navCtx?.navigator;
  const currentPathname = locCtx?.location?.pathname;
  const currentPathnameRef = useRef(currentPathname);
  useEffect(() => {
    currentPathnameRef.current = currentPathname;
  }, [currentPathname]);

  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    if (isModal || !navigator) return;

    const origPush = navigator.push;
    const origReplace = navigator.replace;
    const origGo = navigator.go;

    const resolveTargetPathname = (to: unknown): string | undefined => {
      if (typeof to === "string") {
        return to.split("?")[0]?.split("#")[0] || "/";
      }
      if (to && typeof to === "object" && "pathname" in to) {
        const p = (to as { pathname?: unknown }).pathname;
        if (typeof p === "string") return p;
      }
      return undefined;
    };

    navigator.push = (to: any, state?: any, opts?: any) => {
      const targetPathname = resolveTargetPathname(to);
      const curPath = currentPathnameRef.current;
      if (
        !bypassNavigationBlockRef.current &&
        hasUnsavedChangesRef.current() &&
        (!curPath || targetPathname !== curPath)
      ) {
        pendingNavigationRef.current = () => origPush.call(navigator, to, state, opts);
        setPendingAction("navigate");
        setShowConfirmSave(true);
        return;
      }
      origPush.call(navigator, to, state, opts);
    };

    navigator.replace = (to: any, state?: any, opts?: any) => {
      const targetPathname = resolveTargetPathname(to);
      const curPath = currentPathnameRef.current;
      if (
        !bypassNavigationBlockRef.current &&
        hasUnsavedChangesRef.current() &&
        (!curPath || targetPathname !== curPath)
      ) {
        pendingNavigationRef.current = () => origReplace.call(navigator, to, state, opts);
        setPendingAction("navigate");
        setShowConfirmSave(true);
        return;
      }
      origReplace.call(navigator, to, state, opts);
    };

    navigator.go = (delta: number) => {
      if (!bypassNavigationBlockRef.current && delta !== 0 && hasUnsavedChangesRef.current()) {
        pendingNavigationRef.current = () => origGo.call(navigator, delta);
        setPendingAction("navigate");
        setShowConfirmSave(true);
        return;
      }
      origGo.call(navigator, delta);
    };

    return () => {
      navigator.push = origPush;
      navigator.replace = origReplace;
      navigator.go = origGo;
    };
  }, [isModal, navigator]);
  /* eslint-enable react-hooks/immutability */

  useEffect(() => {
    if (isModal || typeof window === "undefined") return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!bypassNavigationBlockRef.current && hasUnsavedChangesRef.current()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };

    const handleDocumentClick = (e: MouseEvent) => {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey ||
        bypassNavigationBlockRef.current ||
        !hasUnsavedChangesRef.current()
      ) {
        return;
      }
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const rawHref = anchor.getAttribute("href");
      if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("javascript:") || rawHref.startsWith("mailto:")) {
        return;
      }
      try {
        const url = new URL(anchor.href, window.location.origin);
        if (url.origin === window.location.origin && url.pathname === window.location.pathname) {
          return;
        }
        e.preventDefault();
        pendingNavigationRef.current = () => {
          window.location.assign(anchor.href);
        };
        setPendingAction("navigate");
        setShowConfirmSave(true);
      } catch {
        // Ignore malformed URLs
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleDocumentClick);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleDocumentClick);
    };
  }, [isModal]);

  useEffect(() => {
    if (!showDraftsModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setShowDraftsModal(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showDraftsModal]);

  const resetComposerState = useCallback(() => {
    setActiveDraftId(null);
    setContent("");
    setArtifactId(null);
    setContentWarning("");
    setShowContentWarning(false);
    notebook.setIsNotebookMode(false);
    notebook.setNotebookTitle("");
    notebook.setNotebookSummary("");
    notebook.setNotebookSeries("");
    notebook.setNotebookCompanionRepo("");
    notebook.setNotebookCells([{ id: createCellId("md"), type: "markdown", content: "" }]);
  }, [setContent, setArtifactId, notebook]);

  const handleDraftsClick = useCallback(() => {
    if (onOpenDrafts) {
      onOpenDrafts();
      return;
    }
    if (hasUnsavedChanges()) {
      setPendingAction("view_drafts");
      setShowConfirmSave(true);
    } else {
      setDraftsList(getDrafts());
      setShowDraftsModal(true);
    }
  }, [onOpenDrafts, hasUnsavedChanges]);

  const effectiveOnOpenDrafts = onOpenDrafts || (!isModal ? handleDraftsClick : undefined);

  const commitDraftAndNavigate = useCallback(() => {
    if (hasUnsavedChanges() && !editPostId) {
      upsertDraft({
        id: activeDraftId || Date.now().toString(),
        content,
        artifactId,
        notebookMode: notebook.isNotebookMode,
        notebookTitle: notebook.notebookTitle,
        notebookSummary: notebook.notebookSummary,
        notebookDifficulty: notebook.notebookDifficulty,
        notebookSeries: notebook.notebookSeries,
        notebookDialect: notebook.notebookDialect,
        notebookCompanionRepo: notebook.notebookCompanionRepo,
        notebookCells: notebook.notebookCells,
        quotePost,
        replyToPost,
        pendingPin,
        timestamp: Date.now(),
      });
    }
    resetComposerState();
    setShowConfirmSave(false);
    const action = pendingAction;
    setPendingAction(null);

    if (action === "view_drafts") {
      setDraftsList(getDrafts());
      setShowDraftsModal(true);
      return;
    }

    const navFn = pendingNavigationRef.current;
    pendingNavigationRef.current = null;
    if (navFn) {
      bypassNavigationBlockRef.current = true;
      try {
        navFn();
      } finally {
        bypassNavigationBlockRef.current = false;
      }
    }
  }, [
    hasUnsavedChanges,
    editPostId,
    activeDraftId,
    content,
    artifactId,
    notebook,
    quotePost,
    replyToPost,
    pendingPin,
    resetComposerState,
    pendingAction,
  ]);

  const discardAndNavigate = useCallback(() => {
    resetComposerState();
    setShowConfirmSave(false);
    const action = pendingAction;
    setPendingAction(null);

    if (action === "view_drafts") {
      setDraftsList(getDrafts());
      setShowDraftsModal(true);
      return;
    }

    const navFn = pendingNavigationRef.current;
    pendingNavigationRef.current = null;
    if (navFn) {
      bypassNavigationBlockRef.current = true;
      try {
        navFn();
      } finally {
        bypassNavigationBlockRef.current = false;
      }
    }
  }, [resetComposerState, pendingAction]);

  const cancelConfirmSave = useCallback(() => {
    pendingNavigationRef.current = null;
    setPendingAction(null);
    setShowConfirmSave(false);
  }, []);

  const loadDraft = useCallback(
    (draft: DraftPost) => {
      setActiveDraftId(draft.id);
      setContent(draft.content);
      setArtifactId(draft.artifactId);
      notebook.setIsNotebookMode(Boolean(draft.notebookMode));
      notebook.setNotebookTitle(draft.notebookTitle || "");
      notebook.setNotebookSummary(draft.notebookSummary || "");
      notebook.setNotebookDifficulty(draft.notebookDifficulty || "Intermediate");
      notebook.setNotebookSeries(draft.notebookSeries || "");
      notebook.setNotebookDialect(draft.notebookDialect || "Modelica 3.4");
      notebook.setNotebookCompanionRepo(draft.notebookCompanionRepo || "");
      notebook.setNotebookCells(
        draft.notebookCells || [{ id: createCellId("md"), type: "markdown", content: draft.content }],
      );
      setShowDraftsModal(false);
    },
    [setContent, setArtifactId, notebook],
  );

  // Submission & uploads
  const submitHandler = useComposeSubmit({
    token,
    content,
    setContent,
    artifactId,
    setArtifactId,
    isNotebookMode: notebook.isNotebookMode,
    setIsNotebookMode: notebook.setIsNotebookMode,
    notebookTitle: notebook.notebookTitle,
    setNotebookTitle: notebook.setNotebookTitle,
    notebookSummary: notebook.notebookSummary,
    setNotebookSummary: notebook.setNotebookSummary,
    notebookDifficulty: notebook.notebookDifficulty,
    notebookSeries: notebook.notebookSeries,
    setNotebookSeries: notebook.setNotebookSeries,
    notebookDialect: notebook.notebookDialect,
    notebookCompanionRepo: notebook.notebookCompanionRepo,
    setNotebookCompanionRepo: notebook.setNotebookCompanionRepo,
    notebookCells: notebook.notebookCells,
    setNotebookCells: notebook.setNotebookCells,
    attachArtifactToComposer: notebook.attachArtifactToComposer,
    contentWarning,
    setContentWarning,
    setShowContentWarning,
    visibility: postVisibility,
    replyVisibility,
    quotePost,
    replyToPost,
    editPostId,
    forkedFromArtifactId,
    pendingPin,
    excludedUsers,
    onPostCreated: (post) => {
      if (activeDraftId) {
        deleteDraft(activeDraftId);
        setActiveDraftId(null);
      }
      onPostCreated?.(post);
    },
    fileInputRef,
  });

  const handleInsertEmoji = (emoji: string) => {
    if (notebook.isNotebookMode) {
      const targetCell =
        notebook.notebookCells.find((c) => c.id === notebook.activeCellId && c.type === "markdown") ||
        [...notebook.notebookCells].reverse().find((c) => c.type === "markdown");
      if (targetCell && targetCell.type === "markdown") {
        notebook.updateMarkdownCell(targetCell.id, targetCell.content + emoji);
      }
      return;
    }
    const el = textareaRef.current;
    if (el) {
      const start = el.selectionStart ?? content.length;
      const end = el.selectionEnd ?? start;
      const next = content.slice(0, start) + emoji + content.slice(end);
      setContent(next);
      requestAnimationFrame(() => {
        el.focus();
        const cursor = start + emoji.length;
        el.setSelectionRange(cursor, cursor);
      });
    } else {
      setContent(content + emoji);
    }
  };

  // Composer AI (Local Browser AI + Remote AI) state & handlers
  const [aiBusy, setAiBusy] = useState<"drafting" | "polishing" | null>(null);
  const [aiEngine, setAiEngine] = useState<ComposerAiEngineMode>(() => getPreferredAiEngine());
  const [previousAiState, setPreviousAiState] = useState<{
    content: string;
    isNotebookMode: boolean;
    notebookCellsJson?: string | undefined;
  } | null>(null);
  const [attachedArtifactView, setAttachedArtifactView] = useState<Record<string, unknown> | null>(null);
  const [aiLastSourceLabel, setAiLastSourceLabel] = useState<string | null>(null);
  const lastAutoDraftedArtifactIdRef = useRef<number | null>(editPostId && artifactId ? artifactId : null);

  const formatAiSourceLabel = (provider: string): string => {
    if (provider === "local-window-ai") return "Local Browser LLM";
    if (provider.startsWith("local")) return "Local AI";
    return "Remote AI";
  };

  const handleChangeAiEngine = useCallback((mode: ComposerAiEngineMode) => {
    setAiEngine(mode);
    setPreferredAiEngine(mode);
  }, []);

  const saveUndoSnapshot = useCallback(() => {
    setPreviousAiState({
      content,
      isNotebookMode: notebook.isNotebookMode,
      notebookCellsJson: notebook.isNotebookMode ? JSON.stringify(notebook.notebookCells) : undefined,
    });
  }, [content, notebook.isNotebookMode, notebook.notebookCells]);

  const handleUndoAi = useCallback(() => {
    if (!previousAiState) return;
    if (previousAiState.isNotebookMode && previousAiState.notebookCellsJson) {
      try {
        const restored = JSON.parse(previousAiState.notebookCellsJson) as NotebookCell[];
        notebook.setNotebookCells(restored);
        notebook.syncNotebookToContentAndArtifact(restored, notebook.notebookTitle);
      } catch {
        setContent(previousAiState.content);
      }
    } else {
      setContent(previousAiState.content);
    }
    setPreviousAiState(null);
    setAiLastSourceLabel(null);
  }, [previousAiState, notebook, setContent]);

  const handleAiDraft = useCallback(
    async (
      overrideArtifactId?: number | null,
      overrideView?: Record<string, unknown> | null,
      targetArtifactCellId?: string,
    ) => {
      const targetArtifactId = overrideArtifactId !== undefined ? overrideArtifactId : artifactId;
      if (targetArtifactId === null) return;
      saveUndoSnapshot();
      setAiBusy("drafting");
      try {
        const viewForDraft =
          overrideView !== undefined ? overrideView : targetArtifactId === artifactId ? attachedArtifactView : null;
        const result = await runComposerAiDraft({
          artifactId: targetArtifactId,
          artifactView: viewForDraft,
          existingText: content,
          isNotebook: notebook.isNotebookMode,
          engine: aiEngine,
        });
        setAiLastSourceLabel(formatAiSourceLabel(result.provider));

        if (notebook.isNotebookMode) {
          if (!notebook.notebookTitle.trim() && result.notebookTitle) {
            notebook.setNotebookTitle(result.notebookTitle);
          }
          if (!notebook.notebookSummary.trim() && result.notebookSummary) {
            notebook.setNotebookSummary(result.notebookSummary);
          }

          if (targetArtifactCellId) {
            const cellIdx = notebook.notebookCells.findIndex((c) => c.id === targetArtifactCellId);
            const nextCell = cellIdx >= 0 ? notebook.notebookCells[cellIdx + 1] : undefined;
            if (nextCell && nextCell.type === "markdown" && !nextCell.content.trim()) {
              notebook.updateMarkdownCell(nextCell.id, result.draft);
            } else {
              const newCells = [...notebook.notebookCells];
              const insertAt = cellIdx >= 0 ? cellIdx + 1 : newCells.length;
              newCells.splice(insertAt, 0, {
                id: `cell-ai-${Date.now()}`,
                type: "markdown",
                content: result.draft,
              });
              notebook.setNotebookCells(newCells);
              notebook.syncNotebookToContentAndArtifact(newCells, notebook.notebookTitle || result.notebookTitle);
            }
          } else {
            const emptyMdCell =
              notebook.notebookCells.find(
                (c) => c.id === notebook.activeCellId && c.type === "markdown" && !c.content.trim(),
              ) ||
              notebook.notebookCells.find((c) => c.type === "markdown" && !c.content.trim()) ||
              notebook.notebookCells.find((c) => c.id === notebook.activeCellId && c.type === "markdown") ||
              notebook.notebookCells.find((c) => c.type === "markdown");
            if (emptyMdCell && emptyMdCell.type === "markdown") {
              notebook.updateMarkdownCell(emptyMdCell.id, result.draft);
            } else {
              setContent(result.draft);
            }
          }
        } else {
          setContent(result.draft);
        }
      } catch {
        // Fallback already handled inside runComposerAiDraft
      } finally {
        setAiBusy(null);
      }
    },
    [artifactId, attachedArtifactView, content, aiEngine, notebook, saveUndoSnapshot, setContent],
  );

  const handleAiPolish = useCallback(
    async (mode: AiPolishMode = "polish", targetCellId?: string) => {
      if (notebook.isNotebookMode) {
        const mdCell = targetCellId
          ? notebook.notebookCells.find((c) => c.id === targetCellId && c.type === "markdown")
          : notebook.notebookCells.find(
              (c) => c.id === notebook.activeCellId && c.type === "markdown" && c.content.trim(),
            ) || notebook.notebookCells.find((c) => c.type === "markdown" && c.content.trim());
        if (!mdCell || mdCell.type !== "markdown" || !mdCell.content.trim()) return;
        saveUndoSnapshot();
        setAiBusy("polishing");
        try {
          const res = await runComposerAiPolish({
            content: mdCell.content,
            mode,
            artifactId,
            artifactView: attachedArtifactView,
            engine: aiEngine,
          });
          notebook.updateMarkdownCell(mdCell.id, res.polished);
          setAiLastSourceLabel(formatAiSourceLabel(res.provider));
        } finally {
          setAiBusy(null);
        }
        return;
      }

      if (!content.trim()) return;
      saveUndoSnapshot();
      setAiBusy("polishing");
      try {
        const res = await runComposerAiPolish({
          content,
          mode,
          artifactId,
          artifactView: attachedArtifactView,
          engine: aiEngine,
        });
        setContent(res.polished);
        setAiLastSourceLabel(formatAiSourceLabel(res.provider));
      } finally {
        setAiBusy(null);
      }
    },
    [notebook, artifactId, attachedArtifactView, aiEngine, content, saveUndoSnapshot, setContent],
  );

  // Automatically draft a post when a user attaches an artifact and the composer text is empty
  useEffect(() => {
    if (artifactId === null) {
      lastAutoDraftedArtifactIdRef.current = null;
      setAttachedArtifactView(null);
      return;
    }
    if (editPostId) {
      lastAutoDraftedArtifactIdRef.current = artifactId;
      return;
    }
    if (lastAutoDraftedArtifactIdRef.current === artifactId) {
      return;
    }
    lastAutoDraftedArtifactIdRef.current = artifactId;

    const isTextEmpty = notebook.isNotebookMode
      ? !notebook.notebookCells.some((c) => c.type === "markdown" && c.content.trim().length > 0)
      : !content.trim();

    if (isTextEmpty) {
      void handleAiDraft(artifactId, null);
    }
  }, [artifactId, editPostId, notebook.isNotebookMode, notebook.notebookCells, content, handleAiDraft]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const minHeightPx = minRows > 1 ? minRows * 24 + 10 : 0;
      textareaRef.current.style.height = `${Math.max(textareaRef.current.scrollHeight, minHeightPx)}px`;
    }
  }, [content, minRows]);

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    autocomplete.updateTokenState(e.target.value, e.target.selectionStart);
  };

  const handleInteraction = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    if ("key" in e) {
      const key = (e as React.KeyboardEvent<HTMLTextAreaElement>).key;
      if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === "Tab" || key === "Escape") {
        return;
      }
    }
    autocomplete.updateTokenState(e.currentTarget.value, e.currentTarget.selectionStart || 0);
  };

  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  useEffect(() => {
    setActiveSuggestionIndex(0);
  }, [
    autocomplete.mentionQuery?.query,
    autocomplete.hashtagQuery?.query,
    autocomplete.mentionSuggestions.length,
    autocomplete.hashtagSuggestions.length,
  ]);

  const forwardFilesToUpload = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      if (fileArray.length === 0) return;
      for (const file of fileArray) {
        void submitHandler.handleFileUpload({
          target: { files: [file] as unknown as FileList },
        } as React.ChangeEvent<HTMLInputElement>);
      }
    },
    [submitHandler],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const clipboardFiles = e.clipboardData?.files;
      if (clipboardFiles && clipboardFiles.length > 0) {
        e.preventDefault();
        forwardFilesToUpload(clipboardFiles);
        return;
      }
      const items = e.clipboardData?.items;
      if (items && items.length > 0) {
        const extractedFiles: File[] = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item && item.kind === "file") {
            const file = item.getAsFile();
            if (file) extractedFiles.push(file);
          }
        }
        if (extractedFiles.length > 0) {
          e.preventDefault();
          forwardFilesToUpload(extractedFiles);
        }
      }
    },
    [forwardFilesToUpload],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
    setIsDraggingOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDraggingOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingOver(false);
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        forwardFilesToUpload(e.dataTransfer.files);
      }
    },
    [forwardFilesToUpload],
  );

  const includedUsers = useMemo(() => {
    return autocomplete.allMentionedUsers.filter((u: string) => !excludedUsers.has(u));
  }, [autocomplete.allMentionedUsers, excludedUsers]);

  const isEmptyNotebookDocument = useMemo(() => {
    return (
      !notebook.notebookTitle.trim() &&
      notebook.notebookCells.length === 1 &&
      notebook.notebookCells[0]?.type === "markdown" &&
      !notebook.notebookCells[0].content.trim()
    );
  }, [notebook.notebookTitle, notebook.notebookCells]);

  const readMins = useMemo(() => estimateReadingTimeMinutes(notebook.notebookCells), [notebook.notebookCells]);
  const hasNotebookTextToPolish = useMemo(
    () => notebook.notebookCells.some((c) => c.type === "markdown" && c.content.trim().length > 0),
    [notebook.notebookCells],
  );

  // Full-height Notion-style dedicated page editor view
  const fullPageNotebookEditor = notebook.isNotebookMode ? (
    <NotebookPageOverlay $inline={Boolean(isModal)}>
      <NotebookTopBar>
        {/* Left: Back/Exit + Document Breadcrumb */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
          <NotionGhostButton
            type="button"
            onClick={() => {
              if (onCloseModal) {
                onCloseModal();
              } else {
                notebook.handleToggleNotebookMode();
              }
            }}
            title={isModal ? "Close editor" : "Return to feed"}
          >
            <ArrowLeftIcon size={14} />
            <span>{isModal ? "Close" : "Back"}</span>
          </NotionGhostButton>
          <span style={{ color: "var(--ms-divider)", userSelect: "none" }}>/</span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "13px",
              fontWeight: 600,
              color: "var(--ms-text-1)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "260px",
            }}
          >
            <BookIcon size={13} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {notebook.notebookTitle.trim() || "Untitled"}
            </span>
          </span>
          <span
            style={{
              fontSize: "11.5px",
              color: "var(--ms-text-3)",
              whiteSpace: "nowrap",
              paddingLeft: "4px",
            }}
          >
            · {readMins} min read
          </span>
          {submitHandler.uploadingFile && (
            <span style={{ fontSize: "12px", color: "var(--ms-brand)", fontWeight: 500 }}>Uploading...</span>
          )}
        </div>

        {/* Center: Write / Split / Preview Mode Switcher */}
        <div
          style={{
            display: "inline-flex",
            gap: "2px",
            padding: "3px",
            borderRadius: "8px",
            background: "var(--ms-surface-hover, rgba(15, 23, 42, 0.04))",
            border: "1px solid var(--ms-divider)",
          }}
        >
          {(
            [
              { id: "write", label: "Write", icon: PencilIcon },
              { id: "split", label: "Split", icon: ColumnsIcon },
              { id: "preview", label: "Preview", icon: EyeIcon },
            ] as const
          ).map((tab) => {
            const TabIcon = tab.icon;
            const active = activeEditorLayout === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveEditorLayout(tab.id)}
                style={{
                  padding: "4px 10px",
                  borderRadius: "6px",
                  border: "none",
                  background: active ? "var(--color-canvas-inset, #ffffff)" : "transparent",
                  boxShadow: active ? "0 1px 2px rgba(15, 23, 42, 0.08)" : "none",
                  color: active ? "var(--ms-text-1)" : "var(--ms-text-3)",
                  fontFamily: "inherit",
                  fontSize: "12px",
                  fontWeight: active ? 600 : 500,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                }}
              >
                <TabIcon size={12} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Right: Actions & Publish */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <NotionGhostButton
            type="button"
            onClick={notebook.handleToggleNotebookMode}
            title="Switch to standard short post composer"
          >
            Short post
          </NotionGhostButton>

          {effectiveOnOpenDrafts && (
            <NotionGhostButton type="button" onClick={effectiveOnOpenDrafts}>
              Drafts
            </NotionGhostButton>
          )}

          {hasAiPolish && (
            <NotionGhostButton
              type="button"
              disabled={Boolean(aiBusy) || !hasNotebookTextToPolish}
              onClick={() => void handleAiPolish("polish")}
              title="Polish active section with AI"
            >
              <SparklesFillIcon size={12} />
              <span>{aiBusy === "polishing" ? "Polishing..." : "Polish"}</span>
            </NotionGhostButton>
          )}

          {previousAiState !== null && (
            <NotionGhostButton type="button" onClick={handleUndoAi} title="Undo last AI change">
              <HistoryIcon size={12} />
              <span>Undo</span>
            </NotionGhostButton>
          )}

          <TweetButton
            type="button"
            onClick={submitHandler.handleSubmit}
            disabled={(!content.trim() && !artifactId && !submitHandler.hasNotebookContent) || submitHandler.submitting}
            style={{ height: "32px", padding: "0 16px", fontSize: "13.5px" }}
          >
            {editPostId ? "Save changes" : "Publish"}
          </TweetButton>
        </div>
      </NotebookTopBar>

      <NotebookCanvasScroll>
        <NotebookDocumentColumn $wide={activeEditorLayout === "split"}>
          {activeEditorLayout === "preview" ? (
            <TutorialPreview
              notebookMode={true}
              notebookTitle={notebook.notebookTitle}
              notebookSummary={notebook.notebookSummary}
              notebookDifficulty={notebook.notebookDifficulty}
              notebookSeries={notebook.notebookSeries}
              notebookDialect={notebook.notebookDialect}
              notebookCells={notebook.notebookCells}
              content={content}
            />
          ) : activeEditorLayout === "split" ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                gap: "40px",
                alignItems: "start",
                flex: 1,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0, position: "relative" }}>
                <ComposeTutorialMetaEditor
                  notebookTitle={notebook.notebookTitle}
                  setNotebookTitle={notebook.setNotebookTitle}
                  notebookSummary={notebook.notebookSummary}
                  setNotebookSummary={notebook.setNotebookSummary}
                  notebookDifficulty={notebook.notebookDifficulty}
                  setNotebookDifficulty={notebook.setNotebookDifficulty}
                  notebookSeries={notebook.notebookSeries}
                  setNotebookSeries={notebook.setNotebookSeries}
                  notebookDialect={notebook.notebookDialect}
                  setNotebookDialect={notebook.setNotebookDialect}
                  notebookCompanionRepo={notebook.notebookCompanionRepo}
                  setNotebookCompanionRepo={notebook.setNotebookCompanionRepo}
                  showTutorialMetaEditor={notebook.showTutorialMetaEditor}
                  setShowTutorialMetaEditor={notebook.setShowTutorialMetaEditor}
                  handleLoadStarterTemplate={notebook.handleLoadStarterTemplate}
                  handleToggleNotebookMode={notebook.handleToggleNotebookMode}
                  onTitleChange={(nextTitle) =>
                    notebook.syncNotebookToContentAndArtifact(notebook.notebookCells, nextTitle)
                  }
                  onFocusFirstBlock={() => {
                    const firstId = notebook.notebookCells[0]?.id;
                    if (firstId) notebook.setActiveCellId(firstId);
                  }}
                  isEmptyDocument={isEmptyNotebookDocument}
                />
                <ComposeNotebookCellsEditor
                  notebookCells={notebook.notebookCells}
                  activeCellId={notebook.activeCellId}
                  setActiveCellId={notebook.setActiveCellId}
                  insertMarkdownSnippet={notebook.insertMarkdownSnippet}
                  moveCell={notebook.moveCell}
                  addMarkdownCellAfter={notebook.addMarkdownCellAfter}
                  duplicateCell={notebook.duplicateCell}
                  removeCell={notebook.removeCell}
                  updateMarkdownCell={notebook.updateMarkdownCell}
                  updateArtifactCellCaption={notebook.updateArtifactCellCaption}
                  onReplaceArtifactCell={notebook.replaceArtifactCell}
                  updateTokenState={autocomplete.updateTokenState}
                  handleInteraction={handleInteraction}
                  handleSubmit={submitHandler.handleSubmit}
                  setMentionQuery={autocomplete.setMentionQuery}
                  setHashtagQuery={autocomplete.setHashtagQuery}
                  setPendingInsertAfterCellId={notebook.setPendingInsertAfterCellId}
                  setShowCodeSnippetModal={setShowCodeSnippetModal}
                  setShowMorselModal={setShowMorselModal}
                  setShowPackageRepoPicker={setShowPackageRepoPicker}
                  fileInputRef={fileInputRef}
                  onPolishCell={hasAiPolish ? (cellId) => void handleAiPolish("polish", cellId) : undefined}
                  onDraftFromArtifactCell={(artId, cellId) => void handleAiDraft(artId, null, cellId)}
                  onEditCodeCellInModal={handleOpenCodeCellInModal}
                  aiBusy={aiBusy}
                />
                <ComposeMentionHashtagPopups
                  mentionQuery={autocomplete.mentionQuery}
                  mentionSuggestions={autocomplete.mentionSuggestions}
                  onSelectMention={autocomplete.insertMention}
                  hashtagQuery={autocomplete.hashtagQuery}
                  hashtagSuggestions={autocomplete.hashtagSuggestions}
                  onSelectHashtag={autocomplete.insertHashtag}
                  activeIndex={activeSuggestionIndex}
                  onHoverIndex={setActiveSuggestionIndex}
                />
              </div>
              <div style={{ minWidth: 0, position: "sticky", top: "24px" }}>
                <TutorialPreview
                  notebookMode={true}
                  notebookTitle={notebook.notebookTitle}
                  notebookSummary={notebook.notebookSummary}
                  notebookDifficulty={notebook.notebookDifficulty}
                  notebookSeries={notebook.notebookSeries}
                  notebookDialect={notebook.notebookDialect}
                  notebookCells={notebook.notebookCells}
                  content={content}
                />
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", flex: 1, position: "relative" }}>
              <ComposeTutorialMetaEditor
                notebookTitle={notebook.notebookTitle}
                setNotebookTitle={notebook.setNotebookTitle}
                notebookSummary={notebook.notebookSummary}
                setNotebookSummary={notebook.setNotebookSummary}
                notebookDifficulty={notebook.notebookDifficulty}
                setNotebookDifficulty={notebook.setNotebookDifficulty}
                notebookSeries={notebook.notebookSeries}
                setNotebookSeries={notebook.setNotebookSeries}
                notebookDialect={notebook.notebookDialect}
                setNotebookDialect={notebook.setNotebookDialect}
                notebookCompanionRepo={notebook.notebookCompanionRepo}
                setNotebookCompanionRepo={notebook.setNotebookCompanionRepo}
                showTutorialMetaEditor={notebook.showTutorialMetaEditor}
                setShowTutorialMetaEditor={notebook.setShowTutorialMetaEditor}
                handleLoadStarterTemplate={notebook.handleLoadStarterTemplate}
                handleToggleNotebookMode={notebook.handleToggleNotebookMode}
                onTitleChange={(nextTitle) =>
                  notebook.syncNotebookToContentAndArtifact(notebook.notebookCells, nextTitle)
                }
                onFocusFirstBlock={() => {
                  const firstId = notebook.notebookCells[0]?.id;
                  if (firstId) notebook.setActiveCellId(firstId);
                }}
                isEmptyDocument={isEmptyNotebookDocument}
              />

              <ComposeNotebookCellsEditor
                notebookCells={notebook.notebookCells}
                activeCellId={notebook.activeCellId}
                setActiveCellId={notebook.setActiveCellId}
                insertMarkdownSnippet={notebook.insertMarkdownSnippet}
                moveCell={notebook.moveCell}
                addMarkdownCellAfter={notebook.addMarkdownCellAfter}
                duplicateCell={notebook.duplicateCell}
                removeCell={notebook.removeCell}
                updateMarkdownCell={notebook.updateMarkdownCell}
                updateArtifactCellCaption={notebook.updateArtifactCellCaption}
                onReplaceArtifactCell={notebook.replaceArtifactCell}
                updateTokenState={autocomplete.updateTokenState}
                handleInteraction={handleInteraction}
                handleSubmit={submitHandler.handleSubmit}
                setMentionQuery={autocomplete.setMentionQuery}
                setHashtagQuery={autocomplete.setHashtagQuery}
                setPendingInsertAfterCellId={notebook.setPendingInsertAfterCellId}
                setShowCodeSnippetModal={setShowCodeSnippetModal}
                setShowMorselModal={setShowMorselModal}
                setShowPackageRepoPicker={setShowPackageRepoPicker}
                fileInputRef={fileInputRef}
                onPolishCell={hasAiPolish ? (cellId) => void handleAiPolish("polish", cellId) : undefined}
                onDraftFromArtifactCell={(artId, cellId) => void handleAiDraft(artId, null, cellId)}
                onEditCodeCellInModal={handleOpenCodeCellInModal}
                aiBusy={aiBusy}
              />

              <ComposeMentionHashtagPopups
                mentionQuery={autocomplete.mentionQuery}
                mentionSuggestions={autocomplete.mentionSuggestions}
                onSelectMention={autocomplete.insertMention}
                hashtagQuery={autocomplete.hashtagQuery}
                hashtagSuggestions={autocomplete.hashtagSuggestions}
                onSelectHashtag={autocomplete.insertHashtag}
                activeIndex={activeSuggestionIndex}
                onHoverIndex={setActiveSuggestionIndex}
              />
            </div>
          )}
        </NotebookDocumentColumn>
      </NotebookCanvasScroll>
    </NotebookPageOverlay>
  ) : null;

  return (
    <>
      {showRecipientsModal && replyToPost && (
        <ComposeRecipientsModal
          replyToPost={replyToPost}
          allMentionedUsers={autocomplete.allMentionedUsers}
          excludedUsers={excludedUsers}
          setExcludedUsers={setExcludedUsers}
          onClose={() => setShowRecipientsModal(false)}
        />
      )}

      {/* When inside ComposeModal and in Notebook Mode, render the full-height Notion page directly */}
      {notebook.isNotebookMode && isModal ? (
        <>
          {fullPageNotebookEditor}
          <input
            type="file"
            style={{ display: "none" }}
            ref={fileInputRef}
            accept=".usdz,.usd,.usda,.glb,.gltf,image/*,video/*,audio/*,.pdf,.step,.stp,.csv,.tsv,.json,.yaml,.yml,.h5,.hdf5,.mo,.mos,.sysml,.sysml2,.kerml,.pscx,.pslx,.psout,.raw,.con,.inl,.opi,.key,.tpl,.olga,.ez5,.ezm,.roc,.deck,.lps,.tgx,.sima,.sys,.gtm,.gtd,.inp,.inpt,.bdf,.cfg,.cfgt,.su2,.fmu,.ssp,.ssd,.owl,.ttl,.ofn,.tei,.xml"
            onChange={submitHandler.handleFileUpload}
            disabled={submitHandler.uploadingFile}
          />
        </>
      ) : (
        <>
          {/* When triggered from inline feed ComposeBox, portal the full-viewport Notion page editor */}
          {notebook.isNotebookMode &&
            !isModal &&
            (typeof document !== "undefined"
              ? createPortal(fullPageNotebookEditor, document.body)
              : fullPageNotebookEditor)}

          <Box
            width="100%"
            display={isModal ? "flex" : "block"}
            flexDirection={isModal ? "column" : undefined}
            height={isModal ? "100%" : undefined}
            data-dragging={isDraggingOver ? "true" : undefined}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{
              border: isDraggingOver ? "2px dashed var(--color-accent-cyan, #06b6d4)" : "2px dashed transparent",
              borderRadius: "12px",
              backgroundColor: isDraggingOver ? "rgba(6, 182, 212, 0.06)" : undefined,
              transition: "border-color 0.15s ease, background-color 0.15s ease",
              boxSizing: "border-box",
            }}
          >
            {replyToPost && !hideInput && (
              <Box
                mb={2}
                ml={13}
                display="flex"
                gap={1}
                fontSize="14px"
                color="var(--color-text-muted)"
                onClick={() => setShowRecipientsModal(true)}
                style={{ cursor: "pointer" }}
              >
                <span className="handle-text">Replying to</span>
                <span style={{ color: "var(--color-accent-cyan)", fontWeight: "500" }}>
                  {includedUsers.map((u) => `@${u}`).join(", ")}
                </span>
              </Box>
            )}
            <Box display="flex" gap={3} width="100%" flex={isModal ? 1 : undefined}>
              {!hideInput && (
                <img
                  src={getAvatarUrl(user?.username || "?", user?.avatar_url)}
                  alt="avatar"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius:
                      user?.avatar_url === "/ms-logo.png" || user?.avatar_url === "/ms-logo-light.png" ? "10px" : "50%",
                    flexShrink: 0,
                    objectFit: "cover",
                    backgroundColor: "var(--ms-surface-hover, rgba(255, 255, 255, 0.05))",
                    boxShadow: "inset 0 0 0 1px var(--ms-divider)",
                  }}
                />
              )}
              <Box
                flex={1}
                display="flex"
                flexDirection="column"
                style={{ minWidth: 0, position: "relative" }}
                onFocusCapture={() => setIsInputFocused(true)}
                onBlurCapture={(e: React.FocusEvent<HTMLDivElement>) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setIsInputFocused(false);
                  }
                }}
              >
                <div style={{ display: hideInput ? "none" : "contents" }}>
                  {showContentWarning && (
                    <Box mb={2}>
                      <input
                        type="text"
                        placeholder="Content warning / sensitive summary..."
                        value={contentWarning}
                        onChange={(e) => setContentWarning(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "8px 12px",
                          background: "rgba(210, 153, 34, 0.08)",
                          border: "1px solid rgba(210, 153, 34, 0.3)",
                          borderRadius: "8px",
                          color: "var(--color-fg-default)",
                          fontSize: "14px",
                          outline: "none",
                          boxSizing: "border-box",
                        }}
                      />
                    </Box>
                  )}
                  <div style={{ position: "relative", width: "100%" }}>
                    <OverlayWrapper>
                      <Backdrop ref={backdropRef}>
                        {content.split(/(@[a-zA-Z0-9_.-]+(?:@[a-zA-Z0-9_.-]+)?|#[a-zA-Z0-9_-]+)/g).map((part, i) =>
                          part.startsWith("@") ? (
                            <span key={i} style={{ color: "var(--color-accent-cyan)" }}>
                              {part}
                            </span>
                          ) : part.startsWith("#") ? (
                            <span key={i} style={{ color: "var(--color-accent-cyan)" }}>
                              {part}
                            </span>
                          ) : (
                            part
                          ),
                        )}
                        {content.endsWith("\n") && <br />}
                      </Backdrop>
                      <ComposeInput
                        ref={textareaRef}
                        value={content}
                        onChange={handleContentChange}
                        onInput={handleContentChange}
                        onKeyUp={handleInteraction}
                        onClick={handleInteraction}
                        onPaste={handlePaste}
                        onScroll={(e) => {
                          if (backdropRef.current) {
                            backdropRef.current.scrollTop = e.currentTarget.scrollTop;
                            backdropRef.current.scrollLeft = e.currentTarget.scrollLeft;
                          }
                        }}
                        placeholder={placeholder || (replyToPost ? "Post your reply" : "What is happening?!")}
                        rows={minRows}
                        autoFocus={autoFocus}
                        style={{
                          marginBottom: replyToPost ? "0px" : "8px",
                          minHeight: minRows > 1 ? `${minRows * 24 + 10}px` : undefined,
                        }}
                        onKeyDown={(e) => {
                          const hasMentions = Boolean(
                            autocomplete.mentionQuery && autocomplete.mentionSuggestions.length > 0,
                          );
                          const hasHashtags = Boolean(
                            !hasMentions && autocomplete.hashtagQuery && autocomplete.hashtagSuggestions.length > 0,
                          );
                          if (hasMentions || hasHashtags) {
                            const list = hasMentions
                              ? autocomplete.mentionSuggestions
                              : autocomplete.hashtagSuggestions;
                            if (e.key === "ArrowDown") {
                              e.preventDefault();
                              setActiveSuggestionIndex((prev) => (prev + 1) % list.length);
                              return;
                            }
                            if (e.key === "ArrowUp") {
                              e.preventDefault();
                              setActiveSuggestionIndex((prev) => (prev - 1 + list.length) % list.length);
                              return;
                            }
                            if ((e.key === "Enter" || e.key === "Tab") && !e.ctrlKey && !e.metaKey) {
                              e.preventDefault();
                              const chosen = list[activeSuggestionIndex] ?? list[0];
                              if (chosen) {
                                if (hasMentions) {
                                  autocomplete.insertMention(chosen.username);
                                } else {
                                  const tag = chosen.display_name || chosen.displayName || chosen.concept;
                                  autocomplete.insertHashtag(tag);
                                }
                              }
                              setActiveSuggestionIndex(0);
                              return;
                            }
                            if (e.key === "Escape") {
                              e.preventDefault();
                              autocomplete.setMentionQuery(null);
                              autocomplete.setHashtagQuery(null);
                              setActiveSuggestionIndex(0);
                              return;
                            }
                          }
                          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                            submitHandler.handleSubmit();
                          }
                        }}
                        onFocus={() => {
                          setIsInputFocused(true);
                        }}
                        onBlur={() => {
                          setTimeout(() => {
                            autocomplete.setMentionQuery(null);
                            autocomplete.setHashtagQuery(null);
                          }, 150);
                        }}
                      />
                    </OverlayWrapper>

                    {!notebook.isNotebookMode && (
                      <ComposeMentionHashtagPopups
                        mentionQuery={autocomplete.mentionQuery}
                        mentionSuggestions={autocomplete.mentionSuggestions}
                        onSelectMention={autocomplete.insertMention}
                        hashtagQuery={autocomplete.hashtagQuery}
                        hashtagSuggestions={autocomplete.hashtagSuggestions}
                        onSelectHashtag={autocomplete.insertHashtag}
                        activeIndex={activeSuggestionIndex}
                        onHoverIndex={setActiveSuggestionIndex}
                      />
                    )}
                  </div>

                  {!notebook.isNotebookMode && (
                    <ComposeAttachedArtifact
                      artifactId={artifactId}
                      editPostId={editPostId}
                      onRemove={() => setArtifactId(null)}
                      onDraftWithAi={(view) => void handleAiDraft(artifactId, view)}
                      aiDrafting={aiBusy === "drafting"}
                      onArtifactViewLoaded={setAttachedArtifactView}
                      onReplaceArtifact={(newId, _title, createdView) => {
                        setArtifactId(newId);
                        if (createdView) setAttachedArtifactView(createdView);
                      }}
                    />
                  )}

                  <ComposeQuoteAndPin pendingPin={pendingPin} quotePost={quotePost} />

                  {!replyToPost && (
                    <ComposeVisibilityMenu
                      replyVisibility={replyVisibility}
                      setReplyVisibility={setReplyVisibility}
                      postVisibility={postVisibility}
                      setPostVisibility={setPostVisibility}
                      showVisibilityMenu={showVisibilityMenu}
                      setShowVisibilityMenu={setShowVisibilityMenu}
                      visible={
                        isInputFocused ||
                        showVisibilityMenu ||
                        Boolean(content.trim() || artifactId !== null || submitHandler.hasNotebookContent)
                      }
                      isNotebookMode={notebook.isNotebookMode}
                      handleToggleNotebookMode={notebook.handleToggleNotebookMode}
                      onOpenDrafts={!isModal ? effectiveOnOpenDrafts : undefined}
                    />
                  )}
                </div>

                <ComposeToolbar
                  isModal={isModal}
                  isInputFocused={isInputFocused}
                  isNotebookMode={notebook.isNotebookMode}
                  content={content}
                  setContent={setContent}
                  handleToggleNotebookMode={notebook.handleToggleNotebookMode}
                  setShowMorselModal={setShowMorselModal}
                  setShowPackageRepoPicker={setShowPackageRepoPicker}
                  setShowCodeSnippetModal={setShowCodeSnippetModal}
                  setShowHpcPicker={setShowHpcPicker}
                  hasHpc={hasHpc}
                  fileInputRef={fileInputRef}
                  handleFileUpload={submitHandler.handleFileUpload}
                  uploadingFile={submitHandler.uploadingFile}
                  showContentWarning={showContentWarning}
                  setShowContentWarning={setShowContentWarning}
                  showEmojiPicker={showEmojiPicker}
                  setShowEmojiPicker={setShowEmojiPicker}
                  handleSubmit={submitHandler.handleSubmit}
                  submitting={submitHandler.submitting}
                  artifactId={artifactId}
                  hasNotebookContent={submitHandler.hasNotebookContent}
                  editPostId={editPostId}
                  replyToPost={replyToPost}
                  textareaRef={textareaRef}
                  onInsertEmoji={handleInsertEmoji}
                  onAiDraft={() => void handleAiDraft(artifactId, attachedArtifactView)}
                  onAiPolish={hasAiPolish ? (mode) => void handleAiPolish(mode) : undefined}
                  onUndoAi={handleUndoAi}
                  canUndoAi={previousAiState !== null}
                  aiBusy={aiBusy}
                  aiEngine={aiEngine}
                  onChangeAiEngine={handleChangeAiEngine}
                  aiLastSourceLabel={aiLastSourceLabel}
                />
              </Box>
            </Box>
          </Box>
        </>
      )}

      {!isModal &&
        showDraftsModal &&
        (typeof document !== "undefined" ? (
          createPortal(
            <Overlay onClick={() => setShowDraftsModal(false)} style={{ paddingTop: "7vh" }}>
              <ModalPanel
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: "100%",
                  maxWidth: "600px",
                  maxHeight: "86vh",
                  borderRadius: "16px",
                  margin: "0 auto",
                  display: "flex",
                }}
              >
                <DraftsView
                  draftsList={draftsList}
                  onBack={() => setShowDraftsModal(false)}
                  onSelectDraft={loadDraft}
                  onDeleteDraft={(id) => {
                    deleteDraft(id);
                    setDraftsList(getDrafts());
                  }}
                />
              </ModalPanel>
            </Overlay>,
            document.body,
          )
        ) : (
          <Overlay onClick={() => setShowDraftsModal(false)} style={{ paddingTop: "7vh" }}>
            <ModalPanel
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "100%",
                maxWidth: "600px",
                maxHeight: "86vh",
                borderRadius: "16px",
                margin: "0 auto",
                display: "flex",
              }}
            >
              <DraftsView
                draftsList={draftsList}
                onBack={() => setShowDraftsModal(false)}
                onSelectDraft={loadDraft}
                onDeleteDraft={(id) => {
                  deleteDraft(id);
                  setDraftsList(getDrafts());
                }}
              />
            </ModalPanel>
          </Overlay>
        ))}

      {!isModal &&
        showConfirmSave &&
        (typeof document !== "undefined" ? (
          createPortal(
            <ConfirmSaveModal
              isEditing={Boolean(editPostId)}
              onCancel={cancelConfirmSave}
              onSave={commitDraftAndNavigate}
              onDiscard={discardAndNavigate}
            />,
            document.body,
          )
        ) : (
          <ConfirmSaveModal
            isEditing={Boolean(editPostId)}
            onCancel={cancelConfirmSave}
            onSave={commitDraftAndNavigate}
            onDiscard={discardAndNavigate}
          />
        ))}

      <ComposeCodeSnippetModal
        isOpen={showCodeSnippetModal}
        onClose={() => {
          setShowCodeSnippetModal(false);
          setEditingCodeCellId(null);
        }}
        snippetFilename={snippetFilename}
        setSnippetFilename={setSnippetFilename}
        snippetLang={snippetLang}
        setSnippetLang={setSnippetLang}
        snippetCode={snippetCode}
        setSnippetCode={setSnippetCode}
        token={token}
        isNotebookMode={notebook.isNotebookMode}
        activeCellId={notebook.activeCellId}
        notebookCells={notebook.notebookCells}
        insertMarkdownSnippet={notebook.insertMarkdownSnippet}
        content={content}
        setContent={setContent}
        attachArtifactToComposer={notebook.attachArtifactToComposer}
        isEditingExistingBlock={editingCodeCellId !== null}
        onReplaceFencedBlock={
          editingCodeCellId
            ? (fenced) => {
                notebook.updateMarkdownCell(editingCodeCellId, fenced);
                setEditingCodeCellId(null);
              }
            : undefined
        }
      />

      <Suspense fallback={null}>
        {showHpcPicker && (
          <HpcArtifactPickerModal
            isOpen={showHpcPicker}
            onClose={() => setShowHpcPicker(false)}
            onSelect={(art: any) => {
              notebook.attachArtifactToComposer(art.id, art.title);
              setShowHpcPicker(false);
            }}
          />
        )}

        {showMorselModal && (
          <MorselComposeModal
            isOpen={showMorselModal}
            onClose={() => setShowMorselModal(false)}
            onAttach={(art: any) => {
              if (art.id) {
                notebook.attachArtifactToComposer(art.id, art.title);
              }
              setShowMorselModal(false);
            }}
          />
        )}

        {showPackageRepoPicker && (
          <PackageRepoPickerModal
            isOpen={showPackageRepoPicker}
            onClose={() => setShowPackageRepoPicker(false)}
            onSelect={(art: any) => {
              notebook.attachArtifactToComposer(art.id, art.title);
              setShowPackageRepoPicker(false);
            }}
          />
        )}
      </Suspense>
    </>
  );
}
