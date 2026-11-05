// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ChevronDownIcon,
  ChevronUpIcon,
  HubotIcon,
  KebabHorizontalIcon,
  ListUnorderedIcon,
  PencilIcon,
  RssIcon,
  ShieldCheckIcon,
} from "@primer/octicons-react";
import { Tooltip } from "@primer/react";
import React, { useState } from "react";
import { Link } from "react-router-dom";
import { safeJsonParse } from "../../util/json";
import FederatedDomainPill from "../FederatedDomainPill";
import ProfileHoverCard from "../ProfileHoverCard";
import { PostActionMenu } from "./PostActionMenu";
import type { PostAuthorHeaderProps } from "./PostAuthorHeader";
import {
  ActionButton,
  AiBadge,
  HoverAvatar,
  ProfileNameLink,
  SignatureBadge,
  formatEditorialDate,
  formatRelativeTime,
  formatTooltipDate,
} from "./styles";

export interface PostNotebookHeaderProps {
  notebookData: {
    series?: string | undefined;
    seriesPart?: number | undefined;
    difficulty?: string | undefined;
    dialect?: string | undefined;
    title?: string | undefined;
    summary?: string | undefined;
    topics?: string[] | undefined;
  };
  readTimeMinutes: number;
  wasUpdated: boolean;
  updatedAt: string;
  canEditPost: boolean;
  onOpenEditModal: () => void;
  isDetailView: boolean;
  notebookHeadings: { slug: string; level: number; text: string }[];
  onHeadingClick: (slug: string) => void;
  authorHeaderProps?: PostAuthorHeaderProps | undefined;
}

export const PostNotebookHeader: React.FC<PostNotebookHeaderProps> = ({
  notebookData,
  readTimeMinutes,
  wasUpdated,
  updatedAt,
  canEditPost,
  onOpenEditModal,
  isDetailView,
  notebookHeadings,
  onHeadingClick,
  authorHeaderProps,
}) => {
  const [showInlineToc, setShowInlineToc] = useState(false);

  const diffColor = (() => {
    switch (notebookData.difficulty?.toLowerCase()) {
      case "beginner":
        return "var(--color-status-verified, #10b981)";
      case "intermediate":
        return "var(--color-accent-amber, #f59e0b)";
      case "advanced":
        return "var(--color-error, #ef4444)";
      default:
        return undefined;
    }
  })();

  const hasSeries = Boolean(notebookData.series?.trim());
  const hasDifficulty = Boolean(notebookData.difficulty?.trim() && diffColor);
  const hasDialect = Boolean(notebookData.dialect?.trim());
  const topics = Array.isArray(notebookData.topics)
    ? notebookData.topics.filter((t): t is string => typeof t === "string" && Boolean(t.trim()))
    : [];
  const hasTopics = topics.length > 0;
  const hasEyebrowBadges = hasSeries || hasDifficulty || hasDialect || hasTopics;

  const displayPost = authorHeaderProps?.displayPost;
  const postMeta =
    typeof displayPost?.metadata === "string"
      ? safeJsonParse<Record<string, any>>(displayPost.metadata, {})
      : displayPost?.metadata || {};

  const editArticleButton = canEditPost ? (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onOpenEditModal();
      }}
      style={{
        background: "var(--color-canvas-subtle)",
        border: "1px solid var(--color-border-default)",
        borderRadius: "999px",
        padding: isDetailView ? "5px 12px" : "3px 9px",
        fontSize: "12px",
        fontWeight: 600,
        color: "var(--color-text-secondary)",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
        transition: "background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease",
      }}
    >
      <PencilIcon size={12} />
      <span>Edit article</span>
    </button>
  ) : null;

  return (
    <header
      style={{
        marginTop: isDetailView ? "4px" : "4px",
        paddingBottom: isDetailView ? "18px" : "4px",
        marginBottom: isDetailView ? "6px" : "0",
        borderBottom: isDetailView ? "1px solid var(--color-border-subtle)" : "none",
        display: "flex",
        flexDirection: "column",
        gap: isDetailView ? "12px" : "6px",
      }}
    >
      {/* Eyebrow Row: On Detail View, only render when taxonomy badges exist; on Feed View, include read time & Edit action */}
      {(!isDetailView || hasEyebrowBadges || (!authorHeaderProps && canEditPost)) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "8px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "6px",
              fontSize: "12px",
              color: "var(--color-text-muted)",
            }}
          >
            {hasSeries && (
              <span
                style={{
                  fontSize: "11.5px",
                  fontWeight: 600,
                  padding: isDetailView ? "3px 10px" : "2px 8px",
                  borderRadius: isDetailView ? "999px" : "6px",
                  background: "var(--ms-brand-soft)",
                  color: "var(--ms-brand)",
                }}
              >
                {notebookData.series}
                {notebookData.seriesPart ? ` · Part ${notebookData.seriesPart}` : ""}
              </span>
            )}

            {hasDifficulty && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "11.5px",
                  fontWeight: 600,
                  padding: isDetailView ? "3px 10px" : "2px 8px",
                  borderRadius: isDetailView ? "999px" : "6px",
                  background: "var(--color-canvas-subtle)",
                  border: isDetailView ? "1px solid var(--color-border-subtle)" : "none",
                  color: "var(--color-text-secondary)",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: diffColor,
                    flexShrink: 0,
                  }}
                />
                <span>{notebookData.difficulty}</span>
              </span>
            )}

            {hasDialect && (
              <span
                style={{
                  fontSize: "11.5px",
                  fontWeight: 500,
                  fontFamily: "var(--font-mono, monospace)",
                  padding: isDetailView ? "3px 10px" : "2px 8px",
                  borderRadius: isDetailView ? "999px" : "6px",
                  background: "var(--color-canvas-subtle)",
                  border: isDetailView ? "1px solid var(--color-border-subtle)" : "none",
                  color: "var(--color-text-secondary)",
                }}
              >
                {notebookData.dialect}
              </span>
            )}

            {hasTopics &&
              topics.map((topic) => {
                const authorUsername = authorHeaderProps?.parsedAuthor?.localUsername;
                const targetUrl = authorUsername
                  ? `/@${encodeURIComponent(authorUsername)}?tab=articles&topic=${encodeURIComponent(topic)}`
                  : `/explore?q=%23${encodeURIComponent(topic)}`;
                return (
                  <Link
                    key={topic}
                    to={targetUrl}
                    style={{
                      fontSize: "11px",
                      fontWeight: 500,
                      padding: isDetailView ? "3px 10px" : "2px 8px",
                      borderRadius: isDetailView ? "999px" : "6px",
                      background: "var(--color-neutral-muted, rgba(128,128,128,0.15))",
                      color: "var(--color-fg-muted)",
                      textDecoration: "none",
                      display: "inline-flex",
                      alignItems: "center",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    #{topic}
                  </Link>
                );
              })}

            {(!isDetailView || !authorHeaderProps) && (
              <>
                <span
                  style={{
                    fontSize: "12px",
                    color: "var(--color-text-muted)",
                    fontWeight: 500,
                  }}
                >
                  {readTimeMinutes} min read
                </span>

                {wasUpdated && (
                  <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                    · Updated {formatRelativeTime(updatedAt)}
                  </span>
                )}
              </>
            )}
          </div>

          {(!isDetailView || !authorHeaderProps) && editArticleButton}
        </div>
      )}

      {/* Editorial Title */}
      {notebookData.title && (
        <h1
          style={{
            margin: 0,
            fontSize: isDetailView ? "clamp(28px, 3.6vw, 36px)" : "20px",
            fontWeight: 800,
            color: "var(--color-text-heading, var(--color-fg-default))",
            lineHeight: isDetailView ? 1.16 : 1.22,
            letterSpacing: isDetailView ? "-0.028em" : "-0.022em",
            textWrap: "balance",
          }}
        >
          {notebookData.title}
        </h1>
      )}

      {/* Optional Subtitle / Standfirst Summary */}
      {notebookData.summary && (
        <p
          style={{
            margin: 0,
            fontSize: isDetailView ? "18px" : "14.5px",
            color: "var(--color-text-secondary)",
            lineHeight: isDetailView ? 1.55 : 1.5,
            textWrap: "pretty",
          }}
        >
          {notebookData.summary}
        </p>
      )}

      {/* Editorial Author & Publication Byline (Detail View) */}
      {isDetailView && authorHeaderProps && displayPost && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            marginTop: "6px",
            paddingTop: "4px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0, flex: 1 }}>
            <ProfileHoverCard username={displayPost.username}>
              <ProfileNameLink to={`/@${displayPost.username}`} onClick={(e) => e.stopPropagation()}>
                <HoverAvatar $url={displayPost.avatar_url} style={{ width: "40px", height: "40px", fontSize: "16px" }}>
                  {!displayPost.avatar_url && displayPost.username.charAt(0).toUpperCase()}
                </HoverAvatar>
              </ProfileNameLink>
            </ProfileHoverCard>

            <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: 1 }}>
              {/* Line 1: Author Display Name, Handle & Verification Badges */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  flexWrap: "wrap",
                  minWidth: 0,
                  lineHeight: "20px",
                }}
              >
                <ProfileHoverCard username={displayPost.username}>
                  <ProfileNameLink
                    to={`/@${displayPost.username}`}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      fontWeight: 700,
                      fontSize: "15px",
                      color: "var(--color-text-heading, var(--color-fg-default))",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      minWidth: 0,
                      maxWidth: "100%",
                    }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
                  </ProfileNameLink>
                </ProfileHoverCard>

                <Link
                  to={`/@${displayPost.username}`}
                  className="handle-text"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    fontSize: "13.5px",
                    color: "var(--color-text-muted)",
                    textDecoration: "none",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  @{authorHeaderProps.parsedAuthor.localUsername}
                </Link>

                {authorHeaderProps.parsedAuthor.isFederated && authorHeaderProps.parsedAuthor.remoteDomain && (
                  <FederatedDomainPill domain={authorHeaderProps.parsedAuthor.remoteDomain} />
                )}

                {authorHeaderProps.hasSignature && (
                  <Tooltip text="Cryptographically signed by author device key (Click to verify proof)" direction="s">
                    <SignatureBadge
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        authorHeaderProps.onOpenSignatureModal();
                      }}
                    >
                      <ShieldCheckIcon size={12} />
                      <span>Signed</span>
                    </SignatureBadge>
                  </Tooltip>
                )}

                {postMeta?.["aiVerified"] === true && <AiBadge $variant="verified">✨ AI Verified</AiBadge>}
                {displayPost.account_type === "bot" && <AiBadge $variant="generated">🤖 AI Agent</AiBadge>}
              </div>

              {/* Line 2: Publication Date · Read Time · Updated */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "6px",
                  fontSize: "13px",
                  lineHeight: "18px",
                  color: "var(--color-text-muted)",
                }}
              >
                {displayPost.created_at && (
                  <>
                    <Tooltip text={formatTooltipDate(displayPost.created_at)} direction="s">
                      <button
                        type="button"
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          font: "inherit",
                          color: "inherit",
                          cursor: "default",
                          display: "inline-flex",
                          alignItems: "center",
                        }}
                      >
                        <time dateTime={displayPost.created_at} style={{ whiteSpace: "nowrap" }}>
                          {formatEditorialDate(displayPost.created_at)}
                        </time>
                      </button>
                    </Tooltip>
                    <span aria-hidden="true">·</span>
                  </>
                )}

                <span style={{ fontWeight: 500, whiteSpace: "nowrap" }}>{readTimeMinutes} min read</span>

                {wasUpdated && (
                  <>
                    <span aria-hidden="true">·</span>
                    <Tooltip text={`Last updated ${formatTooltipDate(updatedAt)}`} direction="s">
                      <button
                        type="button"
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          font: "inherit",
                          color: "inherit",
                          cursor: "default",
                          display: "inline-flex",
                          alignItems: "center",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Updated {formatRelativeTime(updatedAt)}
                      </button>
                    </Tooltip>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Right-aligned Article Controls: Edit Article + More Menu */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
            {editArticleButton}
            <div
              style={{
                position: "relative",
                zIndex: authorHeaderProps.showPostMenu ? 200 : undefined,
              }}
            >
              <Tooltip text="More" direction="s">
                <ActionButton
                  aria-label="More"
                  $noHoverColor
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    authorHeaderProps.setShowPostMenu(!authorHeaderProps.showPostMenu);
                  }}
                  style={{ marginLeft: 0 }}
                >
                  <div className="icon-wrapper">
                    <KebabHorizontalIcon size={16} />
                  </div>
                </ActionButton>
              </Tooltip>
              <PostActionMenu
                isOpen={authorHeaderProps.showPostMenu}
                onClose={() => authorHeaderProps.setShowPostMenu(false)}
                canEditPost={authorHeaderProps.canEditPost}
                isNotebook={authorHeaderProps.isNotebook}
                onOpenEditModal={authorHeaderProps.onOpenEditModal}
                onPostDeleted={authorHeaderProps.onPostDeleted}
                displayPost={displayPost}
                token={authorHeaderProps.token}
                onOpenLoginModal={authorHeaderProps.onOpenLoginModal}
                remoteOriginUrl={authorHeaderProps.remoteOriginUrl}
                isPinned={authorHeaderProps.isPinned}
              />
            </div>
          </div>
        </div>
      )}

      {/* Collapsible In-Article Table of Contents (Feed View only; Detail View uses RightPanel outline) */}
      {!isDetailView && notebookHeadings.length > 0 && (
        <div style={{ marginTop: "2px" }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setShowInlineToc(!showInlineToc);
            }}
            style={{
              background: "var(--color-canvas-subtle)",
              border: "1px solid var(--color-border-subtle)",
              borderRadius: "8px",
              padding: "4px 10px",
              fontSize: "12px",
              fontWeight: 600,
              color: "var(--color-text-secondary)",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontFamily: "inherit",
            }}
          >
            <ListUnorderedIcon size={12} />
            <span>On this page ({notebookHeadings.length})</span>
            {showInlineToc ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />}
          </button>
          {showInlineToc && (
            <div
              style={{
                marginTop: "6px",
                padding: "8px 12px",
                borderRadius: "8px",
                background: "var(--color-canvas-subtle)",
                border: "1px solid var(--color-border-subtle)",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              {notebookHeadings.map((h, i) => (
                <a
                  key={`${h.slug}-${i}`}
                  href={`#${h.slug}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onHeadingClick(h.slug);
                  }}
                  style={{
                    paddingLeft: h.level === 3 ? "14px" : "0px",
                    fontSize: h.level === 3 ? "12.5px" : "13px",
                    fontWeight: h.level === 3 ? 450 : 600,
                    color: h.level === 3 ? "var(--color-text-muted)" : "var(--color-text-primary)",
                    textDecoration: "none",
                  }}
                >
                  {h.text}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </header>
  );
};
