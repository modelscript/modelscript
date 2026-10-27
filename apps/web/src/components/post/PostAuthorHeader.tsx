// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import { HubotIcon, KebabHorizontalIcon, RssIcon, ShieldCheckIcon } from "@primer/octicons-react";
import { Text, Tooltip } from "@primer/react";
import React from "react";
import { Link } from "react-router-dom";
import { safeJsonParse } from "../../util/json";
import Box from "../Box";
import FederatedDomainPill from "../FederatedDomainPill";
import ProfileHoverCard from "../ProfileHoverCard";
import { PostActionMenu } from "./PostActionMenu";
import { ActionButton, AiBadge, HoverAvatar, ProfileNameLink, SignatureBadge, formatRelativeTime } from "./styles";

export interface PostAuthorHeaderProps {
  displayPost: any;
  isDetail: boolean;
  parsedAuthor: { localUsername: string; isFederated: boolean; remoteDomain?: string | null | undefined };
  hasSignature: boolean;
  isNotebook: boolean;
  notebookData?: any;
  showPostMenu: boolean;
  setShowPostMenu: (show: boolean) => void;
  canEditPost: boolean;
  onOpenEditModal: () => void;
  onOpenSignatureModal: () => void;
  onOpenLoginModal: () => void;
  onPostDeleted?: (() => void) | undefined;
  showAiDetails?: boolean | undefined;
  setShowAiDetails?: ((show: boolean) => void) | undefined;
  token: string | null;
  remoteOriginUrl: string | null;
}

export const PostAuthorHeader: React.FC<PostAuthorHeaderProps> = ({
  displayPost,
  isDetail,
  parsedAuthor,
  hasSignature,
  isNotebook,
  showPostMenu,
  setShowPostMenu,
  canEditPost,
  onOpenEditModal,
  onOpenSignatureModal,
  onOpenLoginModal,
  onPostDeleted,
  token,
  remoteOriginUrl,
}) => {
  const postMeta =
    typeof displayPost?.metadata === "string"
      ? safeJsonParse<Record<string, any>>(displayPost.metadata, {})
      : displayPost?.metadata || {};

  if (isDetail) {
    return (
      <Box display="flex" alignItems="center" gap={3}>
        <ProfileHoverCard username={displayPost.username}>
          <ProfileNameLink to={`/${displayPost.username}`} onClick={(e) => e.stopPropagation()}>
            <HoverAvatar
              $url={displayPost.avatar_url}
              style={{ width: "48px", height: "48px", fontSize: "20px", marginLeft: "-4px" }}
            >
              {!displayPost.avatar_url && displayPost.username.charAt(0).toUpperCase()}
            </HoverAvatar>
          </ProfileNameLink>
        </ProfileHoverCard>
        <Box display="flex" flexDirection="column" flex={1} style={{ minWidth: 0 }}>
          <div style={{ width: "fit-content", maxWidth: "100%", display: "flex" }}>
            <ProfileHoverCard username={displayPost.username}>
              <ProfileNameLink
                to={`/${displayPost.username}`}
                onClick={(e) => e.stopPropagation()}
                style={{ minWidth: 0, overflow: "hidden", display: "flex", maxWidth: "100%" }}
              >
                <Text
                  style={{
                    fontWeight: "bold",
                    fontSize: "15px",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                    {displayPost.display_name || displayPost.username}
                  </span>
                  {displayPost.account_type === "rss" && (
                    <span style={{ flexShrink: 0, display: "inline-flex", color: "var(--color-fg-muted)" }}>
                      <RssIcon size={14} />
                    </span>
                  )}
                  {displayPost.account_type === "bot" && (
                    <span style={{ flexShrink: 0, display: "inline-flex", color: "var(--color-fg-muted)" }}>
                      <HubotIcon size={14} />
                    </span>
                  )}
                </Text>
              </ProfileNameLink>
            </ProfileHoverCard>
          </div>
          <Box display="flex" alignItems="center" gap={1.5} flexWrap="wrap" mt={0.5}>
            <Text
              className="handle-text"
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              @{parsedAuthor.localUsername}
            </Text>
            {parsedAuthor.isFederated && parsedAuthor.remoteDomain && (
              <FederatedDomainPill domain={parsedAuthor.remoteDomain} />
            )}
            {hasSignature && (
              <Tooltip text="Cryptographically signed by author device key (Click to verify proof)" direction="s">
                <SignatureBadge
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onOpenSignatureModal();
                  }}
                >
                  <ShieldCheckIcon size={12} />
                  <span>Signed</span>
                </SignatureBadge>
              </Tooltip>
            )}
            {postMeta?.["aiVerified"] === true && <AiBadge $variant="verified">✨ AI Verified</AiBadge>}
            {displayPost.account_type === "bot" && <AiBadge $variant="generated">🤖 AI Agent</AiBadge>}
          </Box>
        </Box>
        <Box position="relative" mr={1}>
          <ActionButton
            $noHoverColor
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setShowPostMenu(!showPostMenu);
            }}
          >
            <div className="icon-wrapper">
              <KebabHorizontalIcon size={16} />
            </div>
          </ActionButton>
          <PostActionMenu
            isOpen={showPostMenu}
            onClose={() => setShowPostMenu(false)}
            canEditPost={canEditPost}
            isNotebook={isNotebook}
            onOpenEditModal={onOpenEditModal}
            onPostDeleted={onPostDeleted}
            displayPost={displayPost}
            token={token}
            onOpenLoginModal={onOpenLoginModal}
            remoteOriginUrl={remoteOriginUrl}
          />
        </Box>
      </Box>
    );
  }

  // Standard Feed View Header
  return (
    <Box display="flex" alignItems="center" gap={1.5} flexWrap="wrap" style={{ minWidth: 0 }}>
      <ProfileHoverCard username={displayPost.username}>
        <ProfileNameLink to={`/${displayPost.username}`} onClick={(e) => e.stopPropagation()}>
          <Text
            style={{
              fontWeight: "bold",
              fontSize: "15px",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              flexShrink: 0,
            }}
          >
            {displayPost.display_name || displayPost.username}
            {displayPost.account_type === "rss" && (
              <span style={{ display: "inline-flex", color: "var(--color-fg-muted)" }}>
                <RssIcon size={14} />
              </span>
            )}
            {displayPost.account_type === "bot" && (
              <span style={{ display: "inline-flex", color: "var(--color-fg-muted)" }}>
                <HubotIcon size={14} />
              </span>
            )}
          </Text>
        </ProfileNameLink>
      </ProfileHoverCard>
      {postMeta?.["aiVerified"] === true && <AiBadge $variant="verified">✨ AI Verified</AiBadge>}
      <Link
        to={`/${displayPost.username}`}
        className="handle-text"
        style={{
          textDecoration: "none",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flexShrink: 1,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        @{parsedAuthor.localUsername}
      </Link>
      {parsedAuthor.isFederated && parsedAuthor.remoteDomain && (
        <FederatedDomainPill domain={parsedAuthor.remoteDomain} />
      )}
      {hasSignature && (
        <Tooltip text="Cryptographically signed by author device key (Click to verify proof)" direction="s">
          <SignatureBadge
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onOpenSignatureModal();
            }}
          >
            <ShieldCheckIcon size={12} />
            <span>Signed</span>
          </SignatureBadge>
        </Tooltip>
      )}
      <Text className="handle-text" style={{ flexShrink: 0 }}>
        ·
      </Text>
      <Tooltip
        text={`${new Date(displayPost.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${new Date(displayPost.created_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`}
        direction="s"
      >
        <button
          type="button"
          style={{
            background: "none",
            border: "none",
            padding: 0,
            color: "inherit",
            cursor: "pointer",
          }}
        >
          <Text className="handle-text" style={{ flexShrink: 0, whiteSpace: "nowrap" }}>
            {formatRelativeTime(displayPost.created_at)}
          </Text>
        </button>
      </Tooltip>
      <Box flex={1} />
      <Box position="relative" mr={1}>
        <ActionButton
          $noHoverColor
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setShowPostMenu(!showPostMenu);
          }}
        >
          <div className="icon-wrapper">
            <KebabHorizontalIcon size={16} />
          </div>
        </ActionButton>
        <PostActionMenu
          isOpen={showPostMenu}
          onClose={() => setShowPostMenu(false)}
          canEditPost={canEditPost}
          isNotebook={isNotebook}
          onOpenEditModal={onOpenEditModal}
          onPostDeleted={onPostDeleted}
          displayPost={displayPost}
          token={token}
          onOpenLoginModal={onOpenLoginModal}
          remoteOriginUrl={remoteOriginUrl}
        />
      </Box>
    </Box>
  );
};
