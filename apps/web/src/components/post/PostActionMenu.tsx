// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import { BlockedIcon, GraphIcon, LinkExternalIcon, MuteIcon, PersonAddIcon, ReportIcon } from "@primer/octicons-react";
import React from "react";
import { useNavigate } from "react-router-dom";
import { blockUser, followUser, muteUser, reportUser } from "../../api";
import Box from "../Box";
import { useToast } from "../ToastContext";
import { MenuButton } from "./styles";

export interface PostActionMenuProps {
  isOpen: boolean;
  onClose: () => void;
  canEditPost: boolean;
  isNotebook: boolean;
  onOpenEditModal: () => void;
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
  displayPost,
  token,
  onOpenLoginModal,
  remoteOriginUrl,
}) => {
  const navigate = useNavigate();
  const toast = useToast();

  if (!isOpen) return null;

  return (
    <>
      <div
        style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onClose();
        }}
      />
      <Box
        position="absolute"
        top="0"
        right="0"
        bg="var(--color-bg-primary)"
        border="1px solid var(--color-border-subtle)"
        borderRadius="12px"
        boxShadow="0 4px 12px rgba(0,0,0,0.15)"
        p={1}
        zIndex={100}
        minWidth="250px"
        display="flex"
        flexDirection="column"
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
            <span>✏️</span> {isNotebook ? "Edit tutorial / notebook" : "Edit post"}
          </MenuButton>
        )}
        <MenuButton
          onClick={async (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (token) {
              try {
                await followUser(displayPost.username);
              } catch (err) {
                console.error(err);
              }
            }
            onClose();
          }}
        >
          <PersonAddIcon size={16} /> Follow @{displayPost.username}
        </MenuButton>
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
          <MuteIcon size={16} /> Mute
        </MenuButton>
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
              toast.info(`Muted conversation from @${displayPost.username}`);
            } catch (err) {
              console.error(err);
            }
          }}
        >
          <MuteIcon size={16} /> Mute this conversation
        </MenuButton>
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
              await blockUser(displayPost.username);
              toast.info(`Blocked @${displayPost.username}`);
            } catch (err) {
              console.error(err);
            }
          }}
        >
          <BlockedIcon size={16} /> Block @{displayPost.username}
        </MenuButton>
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
      </Box>
    </>
  );
};
