// SPDX-License-Identifier: AGPL-3.0-or-later

import { RssIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React from "react";
import { useNavigate } from "react-router-dom";
import ArtifactViewCard from "../artifacts/ArtifactViewCard";
import Box from "../Box";
import FederatedDomainPill from "../FederatedDomainPill";
import { PostMarkdownContent } from "./PostMarkdownContent";
import { Avatar, QuoteWrapper } from "./styles";

export interface PostQuotedPostProps {
  quotePost: any;
  parsedQuoteAuthor?: { localUsername: string; isFederated: boolean; remoteDomain?: string } | null;
}

export const PostQuotedPost: React.FC<PostQuotedPostProps> = ({ quotePost, parsedQuoteAuthor }) => {
  const navigate = useNavigate();

  if (!quotePost) return null;

  return (
    <QuoteWrapper
      onClick={(e) => {
        e.stopPropagation();
        navigate(`/${quotePost.username}/status/${quotePost.id}`);
      }}
    >
      <Box display="flex" alignItems="center" gap={1.5} mb={1} style={{ lineHeight: "20px" }}>
        <Avatar $url={quotePost.avatar_url} style={{ width: "20px", height: "20px", fontSize: "10px" }}>
          {!quotePost.avatar_url && quotePost.username.charAt(0).toUpperCase()}
        </Avatar>
        <Text
          style={{
            fontWeight: 700,
            fontSize: "15px",
            lineHeight: "20px",
            display: "flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          {quotePost.display_name || quotePost.username}
          {quotePost.account_type === "rss" && <RssIcon size={14} color="var(--color-fg-muted)" />}
        </Text>
        <Text className="handle-text" style={{ fontSize: "15px", lineHeight: "20px" }}>
          @{parsedQuoteAuthor?.localUsername || quotePost.username}
        </Text>
        {parsedQuoteAuthor?.isFederated && parsedQuoteAuthor.remoteDomain && (
          <FederatedDomainPill domain={parsedQuoteAuthor.remoteDomain} />
        )}
      </Box>
      <Box style={{ fontSize: "15px", lineHeight: "20px", wordBreak: "break-word" }}>
        <PostMarkdownContent text={quotePost.content} />
      </Box>
      {quotePost.artifact_view_id && (
        <Box style={{ width: "100%", maxWidth: "100%", minWidth: 0 }}>
          <ArtifactViewCard artifactId={quotePost.artifact_view_id} />
        </Box>
      )}
    </QuoteWrapper>
  );
};
