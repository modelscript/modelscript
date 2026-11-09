// SPDX-License-Identifier: AGPL-3.0-or-later

import { RssIcon, ShieldCheckIcon } from "@primer/octicons-react";
import { Text, Tooltip } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { getPost } from "../../api";
import { safeJsonParse } from "../../util/json";
import { getPostUrl } from "../../util/url";
import ArtifactViewCard from "../artifacts/ArtifactViewCard";
import Box from "../Box";
import FederatedDomainPill from "../FederatedDomainPill";
import ProfileHoverCard from "../ProfileHoverCard";
import { PostMarkdownContent } from "./PostMarkdownContent";
import { PostSignatureModal } from "./PostSignatureModal";
import {
  Avatar,
  NestedQuoteWrapper,
  ProfileNameLink,
  QuoteWrapper,
  SignatureBadge,
  TimestampButton,
  formatFullTimestamp,
  formatRelativeTime,
} from "./styles";

export interface PostQuotedPostProps {
  quotePost: any;
  parsedQuoteAuthor?: { localUsername: string; isFederated: boolean; remoteDomain?: string } | null;
}

export interface NestedQuotedPostItem {
  id?: string | number | undefined;
  id_str?: string | undefined;
  post_id?: string | number | undefined;
  username?: string | undefined;
  display_name?: string | undefined;
  avatar_url?: string | undefined;
  account_type?: string | undefined;
  content?: string | undefined;
  created_at?: string | undefined;
  author?: { username?: string | undefined } | undefined;
  artifact_view_id?: string | number | undefined;
  artifact_view?: unknown;
  [key: string]: unknown;
}

export const PostQuotedPost: React.FC<PostQuotedPostProps> = ({ quotePost, parsedQuoteAuthor }) => {
  const navigate = useNavigate();
  const [nestedQuote, setNestedQuote] = useState<NestedQuotedPostItem | null>(
    quotePost?.quote_post || quotePost?.quotePost || null,
  );
  const [showQuoteSigModal, setShowQuoteSigModal] = useState(false);

  const quoteMeta = useMemo(() => {
    if (!quotePost.metadata) return null;
    if (typeof quotePost.metadata === "object") return quotePost.metadata;
    return safeJsonParse(quotePost.metadata, null);
  }, [quotePost.metadata]);

  const quoteSigDigest =
    (quotePost as any)?.signature ||
    quotePost?.client_signature ||
    quoteMeta?.client_signature ||
    quoteMeta?.clientSignature ||
    quoteMeta?.proof?.proofValue ||
    quoteMeta?.proof?.signature ||
    quoteMeta?.signature ||
    quotePost?.metadata?.client_signature ||
    quotePost?.metadata?.clientSignature ||
    "";
  const quoteHasSignature = Boolean(quoteSigDigest);

  useEffect(() => {
    if (!quotePost) {
      setNestedQuote(null);
      return;
    }
    const immediate = quotePost.quote_post || quotePost.quotePost;
    if (immediate) {
      setNestedQuote(immediate);
      return;
    }
    const qid = quotePost.quote_post_id || quotePost.quotePostId;
    if (qid) {
      let isMounted = true;
      getPost(qid)
        .then((res) => {
          if (isMounted && res?.post) {
            setNestedQuote(res.post);
          }
        })
        .catch(() => {});
      return () => {
        isMounted = false;
      };
    }
    setNestedQuote(null);
  }, [quotePost, quotePost?.quote_post, quotePost?.quotePost, quotePost?.quote_post_id, quotePost?.quotePostId]);

  if (!quotePost) return null;

  const postId = quotePost.id ?? quotePost.id_str ?? quotePost.post_id;
  const rawUsername = quotePost.username || quotePost.author?.username || parsedQuoteAuthor?.localUsername || "";
  const cleanUsername = rawUsername.replace(/^@+/, "");
  const targetUrl =
    getPostUrl({ ...quotePost, id: postId, username: cleanUsername }) || (postId ? `/posts/${postId}` : null);

  const displayName = quotePost.display_name || cleanUsername || "User";
  const authorInitial = (quotePost.display_name || cleanUsername || "?").charAt(0).toUpperCase();

  const rawNestedUser = nestedQuote?.username || nestedQuote?.author?.username || "";
  const cleanNestedUser = rawNestedUser.replace(/^@+/, "");
  const nestedDisplayName = nestedQuote?.display_name || cleanNestedUser || "User";
  const nestedAuthorInitial = (nestedQuote?.display_name || cleanNestedUser || "?").charAt(0).toUpperCase();

  const handleClick = (e: React.MouseEvent) => {
    // If the click is on an interactive link, button, or input within the content, do not navigate away
    if ((e.target as HTMLElement).closest("a, button, [role='button'], input, textarea")) {
      return;
    }
    // If user is selecting text to copy, do not navigate
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (targetUrl) {
      navigate(targetUrl);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      if ((e.target as HTMLElement).closest("a, button, [role='button'], input, textarea")) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (targetUrl) {
        navigate(targetUrl);
      }
    }
  };

  return (
    <QuoteWrapper
      role="link"
      tabIndex={0}
      data-quoted-post="true"
      aria-label={`Quoted post by ${displayName}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <Box display="flex" alignItems="center" gap={1.5} mb={1} style={{ lineHeight: "20px" }}>
        {cleanUsername ? (
          <ProfileHoverCard username={cleanUsername}>
            <ProfileNameLink
              to={`/@${cleanUsername}`}
              onClick={(e) => e.stopPropagation()}
              style={{ display: "inline-flex", alignItems: "center" }}
            >
              <Avatar $url={quotePost.avatar_url} style={{ width: "20px", height: "20px", fontSize: "10px" }}>
                {!quotePost.avatar_url && authorInitial}
              </Avatar>
            </ProfileNameLink>
          </ProfileHoverCard>
        ) : (
          <Avatar $url={quotePost.avatar_url} style={{ width: "20px", height: "20px", fontSize: "10px" }}>
            {!quotePost.avatar_url && authorInitial}
          </Avatar>
        )}
        {cleanUsername ? (
          <ProfileHoverCard username={cleanUsername}>
            <ProfileNameLink
              to={`/@${cleanUsername}`}
              onClick={(e) => e.stopPropagation()}
              style={{ display: "inline-flex", alignItems: "center", minWidth: 0 }}
            >
              <Text
                style={{
                  fontWeight: 700,
                  fontSize: "15px",
                  lineHeight: "21px",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <span className="profile-name-text">{displayName}</span>
                {quotePost.account_type === "rss" && <RssIcon size={14} color="var(--color-fg-muted)" />}
              </Text>
            </ProfileNameLink>
          </ProfileHoverCard>
        ) : (
          <Text
            style={{
              fontWeight: 700,
              fontSize: "15px",
              lineHeight: "21px",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <span>{displayName}</span>
            {quotePost.account_type === "rss" && <RssIcon size={14} color="var(--color-fg-muted)" />}
          </Text>
        )}
        {cleanUsername && (
          <ProfileHoverCard username={cleanUsername}>
            <Link
              to={`/@${cleanUsername}`}
              onClick={(e) => e.stopPropagation()}
              className="handle-text"
              style={{ fontSize: "13.5px", lineHeight: "20px", textDecoration: "none" }}
            >
              @{parsedQuoteAuthor?.localUsername || cleanUsername}
            </Link>
          </ProfileHoverCard>
        )}
        {quotePost.created_at && (
          <>
            <span style={{ color: "var(--color-fg-muted)", fontSize: "13.5px", margin: "0 2px" }}>·</span>
            <Tooltip text={formatFullTimestamp(quotePost.created_at)} direction="s">
              <TimestampButton
                data-timestamp="true"
                onClick={(e) => {
                  e.stopPropagation();
                  if (targetUrl) {
                    navigate(targetUrl);
                  }
                }}
              >
                <Text
                  className="handle-text"
                  style={{ fontSize: "13.5px", lineHeight: "20px", flexShrink: 0, whiteSpace: "nowrap" }}
                >
                  {formatRelativeTime(quotePost.created_at)}
                </Text>
              </TimestampButton>
            </Tooltip>
          </>
        )}
        {quoteHasSignature && (
          <Tooltip text="Cryptographically signed by author (Click to view signature proof)" direction="s">
            <SignatureBadge
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setShowQuoteSigModal(true);
              }}
              aria-label="View cryptographic post signature"
            >
              <ShieldCheckIcon size={12} />
              <span>Signed</span>
            </SignatureBadge>
          </Tooltip>
        )}
        {parsedQuoteAuthor?.isFederated && parsedQuoteAuthor.remoteDomain && (
          <FederatedDomainPill domain={parsedQuoteAuthor.remoteDomain} />
        )}
      </Box>
      <Box style={{ fontSize: "15px", lineHeight: "22px", wordBreak: "break-word" }}>
        <PostMarkdownContent text={quotePost.content} />
      </Box>
      {quotePost.artifact_view_id &&
        String(quotePost.artifact_view_id).trim() !== "" &&
        String(quotePost.artifact_view_id) !== "0" && (
          <Box mt={2} style={{ width: "100%", maxWidth: "100%", minWidth: 0 }}>
            <ArtifactViewCard artifactId={quotePost.artifact_view_id} initialArtifactView={quotePost.artifact_view} />
          </Box>
        )}

      {/* Second level quote post with thick grey left vertical line indentation like X */}
      {nestedQuote && (
        <NestedQuoteWrapper>
          <Box display="flex" alignItems="center" gap={1.5} style={{ lineHeight: "18px" }}>
            {cleanNestedUser ? (
              <ProfileHoverCard username={cleanNestedUser}>
                <ProfileNameLink
                  to={`/@${cleanNestedUser}`}
                  onClick={(e) => e.stopPropagation()}
                  style={{ display: "inline-flex", alignItems: "center" }}
                >
                  <Avatar $url={nestedQuote.avatar_url} style={{ width: "18px", height: "18px", fontSize: "9px" }}>
                    {!nestedQuote.avatar_url && nestedAuthorInitial}
                  </Avatar>
                </ProfileNameLink>
              </ProfileHoverCard>
            ) : (
              <Avatar $url={nestedQuote.avatar_url} style={{ width: "18px", height: "18px", fontSize: "9px" }}>
                {!nestedQuote.avatar_url && nestedAuthorInitial}
              </Avatar>
            )}
            {cleanNestedUser ? (
              <ProfileHoverCard username={cleanNestedUser}>
                <ProfileNameLink
                  to={`/@${cleanNestedUser}`}
                  onClick={(e) => e.stopPropagation()}
                  style={{ display: "inline-flex", alignItems: "center" }}
                >
                  <Text
                    style={{
                      fontWeight: 700,
                      fontSize: "13.5px",
                      lineHeight: "18px",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    <span className="profile-name-text">{nestedDisplayName}</span>
                    {nestedQuote.account_type === "rss" && <RssIcon size={12} color="var(--color-fg-muted)" />}
                  </Text>
                </ProfileNameLink>
              </ProfileHoverCard>
            ) : (
              <Text
                style={{
                  fontWeight: 700,
                  fontSize: "13.5px",
                  lineHeight: "18px",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <span>{nestedDisplayName}</span>
                {nestedQuote.account_type === "rss" && <RssIcon size={12} color="var(--color-fg-muted)" />}
              </Text>
            )}
            {cleanNestedUser && (
              <ProfileHoverCard username={cleanNestedUser}>
                <Link
                  to={`/@${cleanNestedUser}`}
                  onClick={(e) => e.stopPropagation()}
                  className="handle-text"
                  style={{ fontSize: "13.5px", lineHeight: "18px", textDecoration: "none" }}
                >
                  @{cleanNestedUser}
                </Link>
              </ProfileHoverCard>
            )}
            {nestedQuote.created_at && (
              <>
                <Text style={{ color: "var(--color-fg-muted)", fontSize: "13.5px", margin: "0 2px" }}>·</Text>
                <Tooltip text={formatFullTimestamp(nestedQuote.created_at)} direction="s">
                  <TimestampButton
                    data-timestamp="true"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (targetUrl) {
                        navigate(targetUrl);
                      }
                    }}
                  >
                    <Text
                      className="handle-text"
                      style={{ fontSize: "13.5px", lineHeight: "18px", flexShrink: 0, whiteSpace: "nowrap" }}
                    >
                      {formatRelativeTime(nestedQuote.created_at)}
                    </Text>
                  </TimestampButton>
                </Tooltip>
              </>
            )}
          </Box>
          <Box style={{ fontSize: "13.5px", lineHeight: "18px", wordBreak: "break-word" }}>
            <PostMarkdownContent text={nestedQuote.content} />
          </Box>
          {nestedQuote.artifact_view_id &&
            String(nestedQuote.artifact_view_id).trim() !== "" &&
            String(nestedQuote.artifact_view_id) !== "0" && (
              <Box mt={1.5} style={{ width: "100%", maxWidth: "100%", minWidth: 0 }}>
                <ArtifactViewCard
                  artifactId={nestedQuote.artifact_view_id}
                  initialArtifactView={nestedQuote.artifact_view}
                />
              </Box>
            )}
        </NestedQuoteWrapper>
      )}
      {showQuoteSigModal &&
        typeof document !== "undefined" &&
        createPortal(
          <PostSignatureModal
            displayPost={{
              ...quotePost,
              username: cleanUsername || quotePost.username || "unknown",
              display_name: displayName,
            }}
            signatureScheme={
              quoteMeta?.proof?.cryptosuite
                ? `Data Integrity (${quoteMeta.proof.cryptosuite})`
                : quotePost.client_signature || quoteMeta?.client_signature || quoteMeta?.clientSignature
                  ? "WebCrypto RSASSA-PKCS1-v1_5 / SHA-256"
                  : "ActivityPub RFC 9421 / Cavage HTTP Signatures"
            }
            keyIdentifier={
              quotePost.key_id_string ||
              quoteMeta?.key_id_string ||
              quoteMeta?.keyIdString ||
              quoteMeta?.proof?.verificationMethod ||
              (cleanUsername ? `@${cleanUsername} device-key` : "device-key")
            }
            signatureDigest={quoteSigDigest}
            onClose={() => setShowQuoteSigModal(false)}
          />,
          document.body,
        )}
    </QuoteWrapper>
  );
};
