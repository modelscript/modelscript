// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BlockedIcon,
  CodeIcon,
  GraphIcon,
  LinkExternalIcon,
  MuteIcon,
  PencilIcon,
  PersonAddIcon,
  ReportIcon,
  TrashIcon,
} from "@primer/octicons-react";
import React from "react";
import { useNavigate } from "react-router-dom";
import * as apiModule from "../../api";
import { useAuth } from "../../AuthContext";
import { buildEditorUrlForArtifact } from "../../util/editor-routing";
import Box from "../Box";
import { useToast } from "../ToastContext";
import { MenuButton } from "./styles";

const { blockUser, followUser, muteUser, reportUser } = apiModule;
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
}) => {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  const [confirmingBlock, setConfirmingBlock] = React.useState(false);

  React.useEffect(() => {
    if (!isOpen) {
      setConfirmingDelete(false);
      setConfirmingBlock(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isOwnPost = Boolean(user?.username && user.username === displayPost?.username);
  const canDeletePost = isOwnPost || user?.role === "admin";

  return (
    <>
      <div
        style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setConfirmingDelete(false);
          setConfirmingBlock(false);
          onClose();
        }}
      />
      <Box
        position="absolute"
        top="0"
        right="0"
        bg="var(--surface-overlay)"
        border="1px solid var(--color-border-subtle)"
        borderRadius="12px"
        boxShadow="0 4px 12px rgba(0,0,0,0.15)"
        p={1}
        zIndex={100}
        minWidth="250px"
        display="flex"
        flexDirection="column"
        style={{ backdropFilter: "blur(12px)" }}
      >
        {canEditPost && (
          <MenuButton
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onClose();
              onOpenEditModal();
            }}
          >
            <PencilIcon size={16} /> {isNotebook ? "Edit tutorial / notebook" : "Edit post"}
          </MenuButton>
        )}
        {isOwnPost && Boolean(displayPost?.artifact_view_id) && (
          <MenuButton
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onClose();
              navigate(
                buildEditorUrlForArtifact({
                  artifactId: displayPost.artifact_view_id,
                  viewType: (displayPost as any).artifact_type || (displayPost as any).artifact_view?.view_type,
                  viewConfig: (displayPost as any).artifact_config || (displayPost as any).artifact_view?.view_config,
                  title: (displayPost as any).artifact_title || (displayPost as any).artifact_view?.title,
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
            onClick={async (e) => {
              e.stopPropagation();
              e.preventDefault();
              onClose();
              if (!token) {
                onOpenLoginModal();
                return;
              }
              try {
                await reportUser(displayPost.username, `Reported post #${displayPost.id}`);
                toast.info("Post reported to moderators.");
              } catch (err) {
                console.error(err);
              }
            }}
          >
            <ReportIcon size={16} /> Report post
          </MenuButton>
        )}
      </Box>
    </>
  );
};
