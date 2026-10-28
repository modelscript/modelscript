// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../AuthContext";
import { useFeatureFlag } from "../FeatureFlagContext";
import { getAvatarUrl } from "../util/avatar";
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
  NotebookContainer,
  OverlayWrapper,
  useComposeAutocomplete,
  useComposeNotebookState,
  useComposeSubmit,
} from "./compose";
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
  } = props;

  const { user, token } = useAuth();

  const [internalContent, setInternalContent] = useState("");
  const content = controlledContent !== undefined ? controlledContent : internalContent;
  const setContent = setControlledContent || setInternalContent;

  const [internalArtifactId, setInternalArtifactId] = useState<number | null>(null);
  const artifactId = controlledArtifactId !== undefined ? controlledArtifactId : internalArtifactId;
  const setArtifactId = setControlledArtifactId || setInternalArtifactId;

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

  const [replyVisibility, setReplyVisibility] = useState<"everyone" | "following" | "mentioned">("everyone");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showContentWarning, setShowContentWarning] = useState(false);
  const [contentWarning, setContentWarning] = useState("");
  const [showHpcPicker, setShowHpcPicker] = useState(false);
  const [showMorselModal, setShowMorselModal] = useState(false);
  const [showPackageRepoPicker, setShowPackageRepoPicker] = useState(false);
  const hasHpc = useFeatureFlag("cae_cloud_solver");

  const [showVisibilityMenu, setShowVisibilityMenu] = useState(false);
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
    replyVisibility,
    quotePost,
    replyToPost,
    editPostId,
    forkedFromArtifactId,
    pendingPin,
    excludedUsers,
    onPostCreated,
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

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [content]);

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    autocomplete.updateTokenState(e.target.value, e.target.selectionStart);
  };

  const handleInteraction = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    autocomplete.updateTokenState(e.currentTarget.value, e.currentTarget.selectionStart || 0);
  };

  const includedUsers = useMemo(() => {
    return autocomplete.allMentionedUsers.filter((u: string) => !excludedUsers.has(u));
  }, [autocomplete.allMentionedUsers, excludedUsers]);

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
      <Box
        width="100%"
        display={isModal ? "flex" : "block"}
        flexDirection={isModal ? "column" : undefined}
        height={isModal ? "100%" : undefined}
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
                borderRadius: "50%",
                flexShrink: 0,
                objectFit: "cover",
                backgroundColor: "rgba(255, 255, 255, 0.05)",
              }}
            />
          )}
          <Box flex={1} display="flex" flexDirection="column" style={{ minWidth: 0, position: "relative" }}>
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
                {notebook.isNotebookMode ? (
                  <NotebookContainer>
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
                      handleLoadBaeldungTemplate={notebook.handleLoadBaeldungTemplate}
                      handleToggleNotebookMode={notebook.handleToggleNotebookMode}
                      onTitleChange={(nextTitle) =>
                        notebook.syncNotebookToContentAndArtifact(notebook.notebookCells, nextTitle)
                      }
                    />

                    <ComposeNotebookCellsEditor
                      notebookCells={notebook.notebookCells}
                      activeCellId={notebook.activeCellId}
                      setActiveCellId={notebook.setActiveCellId}
                      insertMarkdownSnippet={notebook.insertMarkdownSnippet}
                      moveCell={notebook.moveCell}
                      addMarkdownCellAfter={notebook.addMarkdownCellAfter}
                      removeCell={notebook.removeCell}
                      updateMarkdownCell={notebook.updateMarkdownCell}
                      updateArtifactCellCaption={notebook.updateArtifactCellCaption}
                      updateTokenState={autocomplete.updateTokenState}
                      handleInteraction={handleInteraction}
                      handleSubmit={submitHandler.handleSubmit}
                      setMentionQuery={autocomplete.setMentionQuery}
                      setHashtagQuery={autocomplete.setHashtagQuery}
                      setPendingInsertAfterCellId={notebook.setPendingInsertAfterCellId}
                      setShowCodeSnippetModal={setShowCodeSnippetModal}
                      setShowMorselModal={setShowMorselModal}
                      fileInputRef={fileInputRef}
                    />
                  </NotebookContainer>
                ) : (
                  <OverlayWrapper>
                    <Backdrop ref={backdropRef}>
                      {content.split(/(@[a-zA-Z0-9_.-]+(?:@[a-zA-Z0-9_.-]+)?|#[a-zA-Z0-9_-]+)/g).map((part, i) =>
                        part.startsWith("@") ? (
                          <span key={i} style={{ color: "var(--color-accent-cyan)" }}>
                            {part}
                          </span>
                        ) : part.startsWith("#") ? (
                          <span key={i} style={{ color: "var(--color-accent-purple, #a855f7)", fontWeight: 600 }}>
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
                      onKeyUp={handleInteraction}
                      onClick={handleInteraction}
                      onScroll={(e) => {
                        if (backdropRef.current) {
                          backdropRef.current.scrollTop = e.currentTarget.scrollTop;
                          backdropRef.current.scrollLeft = e.currentTarget.scrollLeft;
                        }
                      }}
                      placeholder={placeholder || (replyToPost ? "Post your reply" : "What is happening?!")}
                      rows={minRows}
                      autoFocus={autoFocus}
                      style={{ marginBottom: replyToPost ? "0px" : "12px" }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                          submitHandler.handleSubmit();
                        }
                      }}
                      onBlur={() => {
                        setTimeout(() => {
                          autocomplete.setMentionQuery(null);
                          autocomplete.setHashtagQuery(null);
                        }, 150);
                      }}
                    />
                  </OverlayWrapper>
                )}

                <ComposeMentionHashtagPopups
                  mentionQuery={autocomplete.mentionQuery}
                  mentionSuggestions={autocomplete.mentionSuggestions}
                  onSelectMention={autocomplete.insertMention}
                  hashtagQuery={autocomplete.hashtagQuery}
                  hashtagSuggestions={autocomplete.hashtagSuggestions}
                  onSelectHashtag={autocomplete.insertHashtag}
                />
              </div>

              {!notebook.isNotebookMode && (
                <ComposeAttachedArtifact
                  artifactId={artifactId}
                  editPostId={editPostId}
                  onRemove={() => setArtifactId(null)}
                />
              )}

              <ComposeQuoteAndPin pendingPin={pendingPin} quotePost={quotePost} />

              {!replyToPost && (
                <ComposeVisibilityMenu
                  replyVisibility={replyVisibility}
                  setReplyVisibility={setReplyVisibility}
                  showVisibilityMenu={showVisibilityMenu}
                  setShowVisibilityMenu={setShowVisibilityMenu}
                />
              )}
            </div>

            <ComposeToolbar
              isModal={isModal}
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
            />
          </Box>
        </Box>
      </Box>

      <ComposeCodeSnippetModal
        isOpen={showCodeSnippetModal}
        onClose={() => setShowCodeSnippetModal(false)}
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
