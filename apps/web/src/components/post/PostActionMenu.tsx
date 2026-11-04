// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BlockedIcon,
  CodeIcon,
  GraphIcon,
  LinkExternalIcon,
  MuteIcon,
  PencilIcon,
  PersonAddIcon,
  PinIcon,
  ReportIcon,
  TrashIcon,
} from "@primer/octicons-react";
import React from "react";
import { useNavigate } from "react-router-dom";
import * as apiModule from "../../api";
import { useAuth } from "../../AuthContext";
import { useClickOutside } from "../../hooks/useClickOutside";
import { buildEditorUrlForArtifact, isEditableCodeOrModelArtifact } from "../../util/editor-routing";
import Box from "../Box";
import { useToast } from "../ToastContext";
import { MenuButton } from "./styles";

const { blockUser, followUser, muteUser, reportPost, reportUser } = apiModule;
const deletePost =
  (apiModule as any).deletePost ||
  (async (id: string | number) => (await apiModule.api.delete(`/social/posts/${id}`)).data);

export interface PostActionMenuProps {
  isOpen: boolean;
  onClose: () => void;
  canEditPost: boolean;
  isNotebook: boolean;
  onOpenEditModal: () => void;
  onPostDeleted?: (() => void) | undefined;
  displayPost: any;
  token: string | null;
  onOpenLoginModal: () => void;
  remoteOriginUrl: string | null;
  isPinned?: boolean | undefined;
}

export const PostActionMenu: React.FC<PostActionMenuProps> = ({
  isOpen,
  onClose,
  canEditPost,
  isNotebook,
  onOpenEditModal,
  onPostDeleted,
  displayPost,
  token,
  onOpenLoginModal,
  remoteOriginUrl,
  isPinned,
}) => {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  const [confirmingBlock, setConfirmingBlock] = React.useState(false);
  const [reportingPost, setReportingPost] = React.useState(false);
  const [reportReason, setReportReason] = React.useState("Spam or automated bot");
  const [reportDetails, setReportDetails] = React.useState("");
  const [alsoBlockAuthor, setAlsoBlockAuthor] = React.useState(false);

  const isPostPinned =
    isPinned ??
    Boolean(
      displayPost?.is_pinned ||
      displayPost?.pinned ||
      displayPost?.metadata?.is_pinned ||
      displayPost?.metadata?.pinned,
    );

  React.useEffect(() => {
    if (!isOpen) {
      setConfirmingDelete(false);
      setConfirmingBlock(false);
      setReportingPost(false);
      setReportDetails("");
      setAlsoBlockAuthor(false);
    }
  }, [isOpen]);

  const menuRef = React.useRef<HTMLDivElement>(null);

  useClickOutside(
    menuRef,
    () => {
      setConfirmingDelete(false);
      setConfirmingBlock(false);
      setReportingPost(false);
      onClose();
    },
    isOpen,
    { ignoreSelector: '[aria-label="More"]' },
  );

  if (!isOpen) return null;

  const isOwnPost = Boolean(user?.username && user.username === displayPost?.username);
  const canDeletePost = isOwnPost || user?.role === "admin";

  return (
    <Box
      ref={menuRef}
      data-post-menu-open="true"
      position="absolute"
      top="0"
      right="0"
      bg="var(--surface-overlay)"
      border="1px solid var(--color-border-subtle)"
      borderRadius="12px"
      boxShadow="0 4px 12px rgba(0,0,0,0.15)"
      p={1}
      zIndex={1000}
      minWidth={reportingPost ? "300px" : "250px"}
      display="flex"
      flexDirection="column"
      style={{ backdropFilter: "blur(12px)" }}
      onClick={(e) => e.stopPropagation()}
    >
      {reportingPost ? (
        <Box p={2} display="flex" flexDirection="column" gap={2}>
          <div style={{ fontWeight: 700, fontSize: "13px", color: "var(--color-text-primary)" }}>
            Report Post #{displayPost?.id}
          </div>
          <select
            aria-label="Report reason"
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            style={{
              padding: "6px 8px",
              borderRadius: "6px",
              border: "1px solid var(--color-border-default)",
              background: "var(--color-bg-primary)",
              color: "var(--color-text-primary)",
              fontSize: "12px",
            }}
          >
            <option value="Spam or automated bot">Spam or automated bot</option>
            <option value="Harassment or abuse">Harassment or abuse</option>
            <option value="Malicious code or binary artifact">Malicious code or binary artifact</option>
            <option value="Copyright or license violation">Copyright or license violation</option>
            <option value="Misleading simulation or fabricated data">Misleading simulation or fabricated data</option>
            <option value="Export control / sensitive IP leak">Export control / sensitive IP leak</option>
            <option value="Other">Other</option>
          </select>
          <textarea
            aria-label="Additional report details"
            placeholder="Optional context for moderators..."
            value={reportDetails}
            onChange={(e) => setReportDetails(e.target.value)}
            rows={3}
            style={{
              padding: "6px 8px",
              borderRadius: "6px",
              border: "1px solid var(--color-border-default)",
              background: "var(--color-bg-primary)",
              color: "var(--color-text-primary)",
              fontSize: "12px",
              resize: "vertical",
            }}
          />
          {displayPost?.username && (
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "12px",
                color: "var(--color-text-muted)",
                cursor: "pointer",
              }}
            >
              <input type="checkbox" checked={alsoBlockAuthor} onChange={(e) => setAlsoBlockAuthor(e.target.checked)} />
              Also block @{displayPost.username}
            </label>
          )}
          <Box display="flex" justifyContent="flex-end" gap={2} mt={1}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setReportingPost(false);
              }}
              style={{
                padding: "4px 10px",
                borderRadius: "6px",
                border: "1px solid var(--color-border-default)",
                background: "transparent",
                color: "var(--color-text-muted)",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              Back
            </button>
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation();
                e.preventDefault();
                onClose();
                try {
                  if (displayPost?.id != null && typeof reportPost === "function") {
                    await reportPost(displayPost.id, reportReason, reportDetails.trim() || undefined);
                  } else {
                    await reportUser(
                      displayPost.username,
                      reportReason,
                      reportDetails.trim() || `Reported post #${displayPost?.id}`,
                    );
                  }
                  if (alsoBlockAuthor && displayPost?.username) {
                    await blockUser(displayPost.username).catch(() => {});
                  }
                  toast.info("Post reported to moderators.");
                } catch (err) {
                  console.error(err);
                  toast.error("Failed to submit report.");
                }
              }}
              style={{
                padding: "4px 10px",
                borderRadius: "6px",
                border: "1px solid rgba(218, 54, 51, 0.5)",
                background: "var(--color-danger-emphasis, #da3633)",
                color: "#ffffff",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Submit Report
            </button>
          </Box>
        </Box>
      ) : (
        <>
          {isOwnPost && (
            <MenuButton
              onClick={async (e) => {
                e.stopPropagation();
                e.preventDefault();
                onClose();
                const nextPinned = !isPostPinned;
                if (typeof window !== "undefined") {
                  window.dispatchEvent(
                    new CustomEvent("modelscript:toggle-pin-post", {
                      detail: {
                        username: displayPost.username,
                        postId: Number(displayPost.id),
                        pinned: nextPinned,
                      },
                    }),
                  );
                  window.dispatchEvent(
                    new CustomEvent("modelscript:post-pin-toggled", {
                      detail: {
                        username: displayPost.username,
                        postId: Number(displayPost.id),
                        pinned: nextPinned,
                      },
                    }),
                  );
                }
                if (token && displayPost?.id != null && typeof (apiModule as any).updatePost === "function") {
                  try {
                    await (apiModule as any).updatePost(Number(displayPost.id), {
                      content: displayPost.content,
                      is_pinned: nextPinned,
                      metadata: { ...(displayPost.metadata || {}), is_pinned: nextPinned },
                    });
                  } catch {
                    // ignore
                  }
                }
                toast.success(nextPinned ? "Pinned to your profile" : "Unpinned from profile");
              }}
            >
              <PinIcon size={16} /> {isPostPinned ? "Unpin from profile" : "Pin to your profile"}
            </MenuButton>
          )}
          {canEditPost && (
            <MenuButton
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onClose();
                onOpenEditModal();
              }}
            >
              <PencilIcon size={16} /> {isNotebook ? "Edit article" : "Edit post"}
            </MenuButton>
          )}
          {isOwnPost &&
            Boolean(displayPost?.artifact_view_id) &&
            isEditableCodeOrModelArtifact({
              view_type:
                (displayPost as { artifact_type?: string })?.artifact_type ||
                (displayPost as { artifact_view?: { view_type?: string } })?.artifact_view?.view_type,
              view_config:
                (displayPost as { artifact_config?: unknown })?.artifact_config ||
                (displayPost as { artifact_view?: { view_config?: unknown } })?.artifact_view?.view_config,
            }) && (
              <MenuButton
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onClose();
                  navigate(
                    buildEditorUrlForArtifact({
                      artifactId: displayPost.artifact_view_id,
                      viewType:
                        (displayPost as { artifact_type?: string })?.artifact_type ||
                        (displayPost as { artifact_view?: { view_type?: string } })?.artifact_view?.view_type,
                      viewConfig:
                        (displayPost as { artifact_config?: unknown })?.artifact_config ||
                        (displayPost as { artifact_view?: { view_config?: unknown } })?.artifact_view?.view_config,
                      title:
                        (displayPost as { artifact_title?: string })?.artifact_title ||
                        (displayPost as { artifact_view?: { title?: string } })?.artifact_view?.title,
                      mode: "edit",
                      editPostId: Number(displayPost.id),
                    }),
                  );
                }}
              >
                <CodeIcon size={16} /> Edit Artifact in Playground / VS Code
              </MenuButton>
            )}
          {canDeletePost && (
            <MenuButton
              style={
                confirmingDelete
                  ? {
                      color: "#ffffff",
                      backgroundColor: "var(--color-danger-emphasis, #da3633)",
                      fontWeight: 700,
                    }
                  : { color: "var(--color-danger-fg, #f85149)" }
              }
              onClick={async (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (!token) {
                  onClose();
                  onOpenLoginModal();
                  return;
                }
                if (!confirmingDelete) {
                  setConfirmingDelete(true);
                  return;
                }
                setConfirmingDelete(false);
                onClose();
                try {
                  await deletePost(displayPost.id);
                  toast.success("Post deleted.");
                  onPostDeleted?.();
                } catch (err) {
                  console.error(err);
                  toast.error("Failed to delete post.");
                }
              }}
            >
              <TrashIcon size={16} /> {confirmingDelete ? "Confirm delete?" : "Delete post"}
            </MenuButton>
          )}
          {!isOwnPost && (
            <MenuButton
              onClick={async (e) => {
                e.stopPropagation();
                e.preventDefault();
                onClose();
                if (!token) {
                  onOpenLoginModal();
                  return;
                }
                try {
                  await followUser(displayPost.username);
                  toast.success(`Followed @${displayPost.username}`);
                } catch (err) {
                  console.error(err);
                  toast.error(`Failed to follow @${displayPost.username}`);
                }
              }}
            >
              <PersonAddIcon size={16} /> Follow @{displayPost.username}
            </MenuButton>
          )}
          {!isOwnPost && (
            <MenuButton
              onClick={async (e) => {
                e.stopPropagation();
                e.preventDefault();
                onClose();
                if (!token) {
                  onOpenLoginModal();
                  return;
                }
                try {
                  await muteUser(displayPost.username);
                  toast.info(`Muted @${displayPost.username}`);
                } catch (err) {
                  console.error(err);
                }
              }}
            >
              <MuteIcon size={16} /> Mute @{displayPost.username}
            </MenuButton>
          )}
          {!isOwnPost && (
            <MenuButton
              style={
                confirmingBlock
                  ? {
                      color: "#ffffff",
                      backgroundColor: "var(--color-danger-emphasis, #da3633)",
                      fontWeight: 700,
                    }
                  : { color: "var(--color-danger-fg, #f85149)" }
              }
              onClick={async (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (!token) {
                  onClose();
                  onOpenLoginModal();
                  return;
                }
                if (!confirmingBlock) {
                  setConfirmingBlock(true);
                  return;
                }
                setConfirmingBlock(false);
                onClose();
                try {
                  await blockUser(displayPost.username);
                  toast.info(`Blocked @${displayPost.username}`);
                } catch (err) {
                  console.error(err);
                }
              }}
            >
              <BlockedIcon size={16} />{" "}
              {confirmingBlock ? `Confirm block @${displayPost.username}?` : `Block @${displayPost.username}`}
            </MenuButton>
          )}
          <MenuButton
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onClose();
              navigate(`/${displayPost.username}/status/${displayPost.id}/activity`);
            }}
          >
            <GraphIcon size={16} /> View post activity
          </MenuButton>
          {remoteOriginUrl && (
            <MenuButton
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onClose();
                window.open(remoteOriginUrl, "_blank", "noopener,noreferrer");
              }}
            >
              <LinkExternalIcon size={16} /> Open original on remote node
            </MenuButton>
          )}
          {!isOwnPost && (
            <MenuButton
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                if (!token) {
                  onClose();
                  onOpenLoginModal();
                  return;
                }
                setReportingPost(true);
              }}
            >
              <ReportIcon size={16} /> Report post
            </MenuButton>
          )}
        </>
      )}
    </Box>
  );
};
