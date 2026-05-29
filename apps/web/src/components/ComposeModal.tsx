/* eslint-disable @typescript-eslint/no-explicit-any */
import { ArrowLeftIcon, TrashIcon, XIcon } from "@primer/octicons-react";
import { Heading, IconButton } from "@primer/react";
import React, { useState } from "react";
import styled from "styled-components";
import type { SpatialPin } from "./artifacts/spatial-pin";
import Box from "./Box";
import ComposeBox from "./ComposeBox";

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
  background: var(--color-bg-primary);
  width: 100%;
  max-width: 600px;
  border-radius: 16px;
  border: 1px solid var(--color-border-subtle);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  overflow: visible;
  max-height: 80vh;
  min-height: 250px;
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
  gap: 12px;
  overflow: visible;
  flex: 1;
`;

interface ComposeModalProps {
  onClose: () => void;
  onPostCreated?: (post: any) => void;
  quotePost?: any;
  replyToPost?: any;
  pendingPin?: SpatialPin;
}

interface DraftPost {
  id: string;
  content: string;
  artifactId: number | null;
  quotePost?: any;
  replyToPost?: any;
  pendingPin?: SpatialPin;
  timestamp: number;
}

const getDrafts = (): DraftPost[] => {
  try {
    return JSON.parse(localStorage.getItem("post_drafts") || "[]");
  } catch {
    return [];
  }
};

const saveDraft = (draft: DraftPost) => {
  const drafts = getDrafts();
  drafts.unshift(draft);
  localStorage.setItem("post_drafts", JSON.stringify(drafts));
};

const deleteDraft = (id: string) => {
  const drafts = getDrafts();
  localStorage.setItem("post_drafts", JSON.stringify(drafts.filter((d) => d.id !== id)));
};

const ComposeModal: React.FC<ComposeModalProps> = ({
  onClose,
  onPostCreated,
  quotePost: initialQuotePost,
  replyToPost: initialReplyToPost,
  pendingPin: initialPendingPin,
}) => {
  const [view, setView] = useState<"compose" | "drafts" | "confirm_save">("compose");
  const [pendingAction, setPendingAction] = useState<"close" | "view_drafts" | null>(null);

  const [content, setContent] = useState("");
  const [artifactId, setArtifactId] = useState<number | null>(null);

  const [currentQuotePost, setCurrentQuotePost] = useState(initialQuotePost);
  const [currentReplyToPost, setCurrentReplyToPost] = useState(initialReplyToPost);
  const [currentPendingPin, setCurrentPendingPin] = useState(initialPendingPin);

  const [draftsList, setDraftsList] = useState<DraftPost[]>([]);

  const isDirty = content.trim() !== "" || artifactId !== null;

  const handleCloseClick = () => {
    if (isDirty) {
      setPendingAction("close");
      setView("confirm_save");
    } else {
      onClose();
    }
  };

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
      saveDraft({
        id: Date.now().toString(),
        content,
        artifactId,
        quotePost: currentQuotePost,
        replyToPost: currentReplyToPost,
        pendingPin: currentPendingPin,
        timestamp: Date.now(),
      });
    }
    setContent("");
    setArtifactId(null);
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
    setContent("");
    setArtifactId(null);
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
    setContent(draft.content);
    setArtifactId(draft.artifactId);
    setCurrentQuotePost(draft.quotePost);
    setCurrentReplyToPost(draft.replyToPost);
    setCurrentPendingPin(draft.pendingPin);
    deleteDraft(draft.id);
    setView("compose");
  };

  return (
    <>
      <Overlay onClick={view === "compose" ? handleCloseClick : undefined}>
        <ModalPanel
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: "600px", margin: "0 auto", display: view === "drafts" ? "none" : "flex" }}
        >
          <Header>
            <IconButton
              icon={XIcon}
              variant="invisible"
              onClick={handleCloseClick}
              aria-label="Close"
              sx={{
                color: "var(--color-fg-default)",
                borderRadius: "50%",
                width: "36px",
                height: "36px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                "&:hover": { backgroundColor: "var(--color-canvas-subtle)" },
              }}
            />
            <Box flex={1} />
            <button
              onClick={handleDraftsClick}
              style={{
                background: "none",
                border: "none",
                color: "#1d9bf0",
                fontWeight: "bold",
                fontSize: "15px",
                cursor: "pointer",
                paddingRight: "8px",
              }}
            >
              Drafts
            </button>
          </Header>
          <Body>
            <ComposeBox
              content={content}
              setContent={setContent}
              artifactId={artifactId}
              setArtifactId={setArtifactId}
              onPostCreated={(post) => {
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
          </Body>
        </ModalPanel>

        {view === "drafts" && (
          <Box display="flex" flexDirection="column" height="100%">
            <Header style={{ paddingBottom: "12px", borderBottom: "1px solid var(--color-border-subtle)" }}>
              <IconButton
                icon={ArrowLeftIcon}
                variant="invisible"
                onClick={() => setView("compose")}
                aria-label="Back"
              />
              <Heading as="h3" style={{ margin: "0 0 0 16px", fontSize: "20px" }}>
                Drafts
              </Heading>
            </Header>
            <Box flex={1} overflowY="auto">
              {draftsList.length === 0 ? (
                <Box p={5} textAlign="center" color="var(--color-fg-muted)">
                  No drafts yet.
                </Box>
              ) : (
                draftsList.map((draft) => (
                  <Box
                    key={draft.id}
                    p={3}
                    borderBottom="1px solid var(--color-border-subtle)"
                    style={{ cursor: "pointer", transition: "background-color 0.2s" }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    onClick={() => loadDraft(draft)}
                  >
                    <Box display="flex" justifyContent="space-between" alignItems="center">
                      <span style={{ color: "var(--color-fg-muted)", fontSize: "13px" }}>
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
                        sx={{ color: "var(--color-danger-fg)" }}
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
                        color: "var(--color-fg-default)",
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
        <Overlay style={{ zIndex: 1100, background: "rgba(0,0,0,0.4)" }} onClick={() => setView("compose")}>
          <ModalPanel
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "320px", minHeight: "auto", margin: "auto" }}
          >
            <Box p={4} pb={5} display="flex" flexDirection="column" alignItems="flex-start" gap={2}>
              <Heading as="h3" style={{ margin: "4px 0 0 0", fontSize: "20px", fontWeight: "bold" }}>
                Save post?
              </Heading>
              <span
                style={{ color: "var(--color-fg-muted)", fontSize: "15px", lineHeight: "1.4", marginBottom: "8px" }}
              >
                You can save this to send later from your drafts.
              </span>
              <Box display="flex" flexDirection="column" gap={3} width="100%" mt={2}>
                <button
                  style={{
                    background: "var(--color-fg-default)",
                    color: "var(--color-canvas-default)",
                    border: "none",
                    borderRadius: "9999px",
                    padding: "14px",
                    fontWeight: "bold",
                    fontSize: "15px",
                    cursor: "pointer",
                  }}
                  onClick={commitDraftAndNavigate}
                >
                  Save
                </button>
                <button
                  style={{
                    background: "transparent",
                    color: "var(--color-fg-default)",
                    border: "1px solid var(--color-border-default)",
                    borderRadius: "9999px",
                    padding: "14px",
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
