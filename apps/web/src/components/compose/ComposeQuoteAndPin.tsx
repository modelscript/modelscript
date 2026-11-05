// SPDX-License-Identifier: AGPL-3.0-or-later

import { PinIcon } from "@primer/octicons-react";
import { Tooltip } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getPost } from "../../api";
import type { SpatialPin } from "../artifacts/spatial-pin";
import Box from "../Box";
import ProfileHoverCard from "../ProfileHoverCard";
import { NestedQuoteWrapper, QuoteWrapper, TimestampButton, formatFullTimestamp, formatRelativeTime } from "./styles";

export interface ComposeQuoteAndPinProps {
  pendingPin?: SpatialPin | undefined;
  quotePost?: any;
}

export interface NestedQuoteData {
  username?: string | undefined;
  display_name?: string | undefined;
  avatar_url?: string | undefined;
  content?: string | undefined;
  created_at?: string | undefined;
  author?: { username?: string | undefined } | undefined;
  [key: string]: unknown;
}

export const ComposeQuoteAndPin: React.FC<ComposeQuoteAndPinProps> = ({ pendingPin, quotePost }) => {
  const [nestedQuote, setNestedQuote] = useState<NestedQuoteData | null>(
    quotePost?.quote_post || quotePost?.quotePost || null,
  );

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

  const rawUsername = quotePost?.username || quotePost?.author?.username || "";
  const cleanUsername = rawUsername.replace(/^@+/, "");

  const rawNestedUser = nestedQuote?.username || nestedQuote?.author?.username || "";
  const cleanNestedUser = rawNestedUser.replace(/^@+/, "");

  return (
    <>
      {pendingPin && (
        <Box
          mb={2}
          p={2}
          border="1px solid var(--color-border)"
          borderRadius="8px"
          backgroundColor="rgba(255, 255, 255, 0.03)"
        >
          <span
            style={{
              fontSize: "12px",
              color: "var(--color-text-muted)",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <span style={{ color: "var(--color-accent-cyan)", display: "inline-flex" }}>
              <PinIcon size={12} />
            </span>
            <span>
              Pinned to <b>{pendingPin.fieldName}</b> = {pendingPin.scalarValue.toFixed(2)}
            </span>
          </span>
        </Box>
      )}

      {quotePost && (
        <QuoteWrapper>
          <Box display="flex" alignItems="center" gap={1} mb={0.5}>
            {cleanUsername && quotePost.avatar_url ? (
              <ProfileHoverCard username={cleanUsername}>
                <Link
                  to={`/@${cleanUsername}`}
                  onClick={(e) => e.stopPropagation()}
                  style={{ textDecoration: "none", color: "inherit", display: "inline-flex", alignItems: "center" }}
                >
                  <img
                    src={quotePost.avatar_url}
                    alt=""
                    style={{ width: 18, height: 18, borderRadius: "50%", objectFit: "cover" }}
                  />
                </Link>
              </ProfileHoverCard>
            ) : quotePost.avatar_url ? (
              <img
                src={quotePost.avatar_url}
                alt=""
                style={{ width: 18, height: 18, borderRadius: "50%", objectFit: "cover" }}
              />
            ) : null}
            {cleanUsername ? (
              <ProfileHoverCard username={cleanUsername}>
                <Link
                  to={`/@${cleanUsername}`}
                  onClick={(e) => e.stopPropagation()}
                  style={{ textDecoration: "none", color: "inherit", display: "inline-flex", alignItems: "center" }}
                >
                  <span style={{ fontWeight: "bold", fontSize: "14px" }}>
                    {quotePost.display_name || quotePost.username}
                  </span>
                </Link>
              </ProfileHoverCard>
            ) : (
              <span style={{ fontWeight: "bold", fontSize: "14px" }}>
                {quotePost.display_name || quotePost.username}
              </span>
            )}
            {cleanUsername ? (
              <ProfileHoverCard username={cleanUsername}>
                <Link
                  to={`/@${cleanUsername}`}
                  onClick={(e) => e.stopPropagation()}
                  style={{ textDecoration: "none", color: "var(--color-fg-muted)", fontSize: "14px" }}
                >
                  @{cleanUsername}
                </Link>
              </ProfileHoverCard>
            ) : (
              <span style={{ color: "var(--color-fg-muted)", fontSize: "14px" }}>@{quotePost.username}</span>
            )}
            {quotePost.created_at && (
              <>
                <span style={{ color: "var(--color-fg-muted)", fontSize: "14px", margin: "0 2px" }}>·</span>
                <Tooltip text={formatFullTimestamp(quotePost.created_at)} direction="s">
                  <TimestampButton onClick={(e) => e.stopPropagation()} style={{ cursor: "default" }}>
                    <span style={{ color: "var(--color-fg-muted)", fontSize: "14px", lineHeight: "20px" }}>
                      {formatRelativeTime(quotePost.created_at)}
                    </span>
                  </TimestampButton>
                </Tooltip>
              </>
            )}
          </Box>
          <div style={{ fontSize: "14px", lineHeight: "20px", wordBreak: "break-word" }}>{quotePost.content}</div>

          {/* Second level of quote post, indented using a thick grey left vertical line just like X */}
          {nestedQuote && (
            <NestedQuoteWrapper>
              <Box display="flex" alignItems="center" gap={1}>
                {cleanNestedUser && nestedQuote.avatar_url ? (
                  <ProfileHoverCard username={cleanNestedUser}>
                    <Link
                      to={`/@${cleanNestedUser}`}
                      onClick={(e) => e.stopPropagation()}
                      style={{ textDecoration: "none", color: "inherit", display: "inline-flex", alignItems: "center" }}
                    >
                      <img
                        src={nestedQuote.avatar_url}
                        alt=""
                        style={{ width: 16, height: 16, borderRadius: "50%", objectFit: "cover" }}
                      />
                    </Link>
                  </ProfileHoverCard>
                ) : nestedQuote.avatar_url ? (
                  <img
                    src={nestedQuote.avatar_url}
                    alt=""
                    style={{ width: 16, height: 16, borderRadius: "50%", objectFit: "cover" }}
                  />
                ) : null}
                {cleanNestedUser ? (
                  <ProfileHoverCard username={cleanNestedUser}>
                    <Link
                      to={`/@${cleanNestedUser}`}
                      onClick={(e) => e.stopPropagation()}
                      style={{ textDecoration: "none", color: "inherit", display: "inline-flex", alignItems: "center" }}
                    >
                      <span style={{ fontWeight: "bold", fontSize: "13px" }}>
                        {nestedQuote.display_name || nestedQuote.username}
                      </span>
                    </Link>
                  </ProfileHoverCard>
                ) : (
                  <span style={{ fontWeight: "bold", fontSize: "13px" }}>
                    {nestedQuote.display_name || nestedQuote.username}
                  </span>
                )}
                {cleanNestedUser ? (
                  <ProfileHoverCard username={cleanNestedUser}>
                    <Link
                      to={`/@${cleanNestedUser}`}
                      onClick={(e) => e.stopPropagation()}
                      style={{ textDecoration: "none", color: "var(--color-fg-muted)", fontSize: "13px" }}
                    >
                      @{cleanNestedUser}
                    </Link>
                  </ProfileHoverCard>
                ) : (
                  <span style={{ color: "var(--color-fg-muted)", fontSize: "13px" }}>@{nestedQuote.username}</span>
                )}
                {nestedQuote.created_at && (
                  <>
                    <span style={{ color: "var(--color-fg-muted)", fontSize: "13px", margin: "0 2px" }}>·</span>
                    <Tooltip text={formatFullTimestamp(nestedQuote.created_at)} direction="s">
                      <TimestampButton onClick={(e) => e.stopPropagation()} style={{ cursor: "default" }}>
                        <span style={{ color: "var(--color-fg-muted)", fontSize: "13px", lineHeight: "18px" }}>
                          {formatRelativeTime(nestedQuote.created_at)}
                        </span>
                      </TimestampButton>
                    </Tooltip>
                  </>
                )}
              </Box>
              <div
                style={{
                  fontSize: "13px",
                  lineHeight: "18px",
                  color: "var(--color-fg-default)",
                  wordBreak: "break-word",
                }}
              >
                {nestedQuote.content}
              </div>
            </NestedQuoteWrapper>
          )}
        </QuoteWrapper>
      )}
    </>
  );
};
