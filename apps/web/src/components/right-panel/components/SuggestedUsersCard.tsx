// SPDX-License-Identifier: AGPL-3.0-or-later

import { Text } from "@primer/react";
import React from "react";
import Box from "../../Box";
import FollowButton from "../../FollowButton";
import ProfileHoverCard from "../../ProfileHoverCard";
import { Avatar, Card, ProfileNameLink, ShowMoreLink } from "../styles";

export interface SuggestedUsersCardProps {
  suggestions: any[];
  currentUsername?: string | undefined;
}

export const SuggestedUsersCard: React.FC<SuggestedUsersCardProps> = ({ suggestions, currentUsername }) => {
  const filteredSuggestions = suggestions.filter((u) => !currentUsername || u.username !== currentUsername);

  return (
    <Card>
      <Box display="flex" alignItems="center" gap={2} mb={2}>
        <Text
          as="h2"
          style={{
            fontSize: "15px",
            lineHeight: "20px",
            fontWeight: 700,
            margin: 0,
            color: "var(--color-text-heading)",
          }}
        >
          Who to follow
        </Text>
      </Box>
      <Box display="flex" flexDirection="column" gap={2}>
        {filteredSuggestions.map((u) => (
          <Box key={u.id} display="flex" alignItems="center" justifyContent="space-between">
            <ProfileHoverCard username={u.username}>
              <ProfileNameLink to={`/${u.username}`} style={{ flexShrink: 0 }}>
                <Avatar $url={u.avatar_url} $letter={u.username.charAt(0).toUpperCase()} />
              </ProfileNameLink>
            </ProfileHoverCard>
            <Box
              flex={1}
              minWidth={0}
              style={{ margin: "0 10px" }}
              display="flex"
              flexDirection="column"
              alignItems="flex-start"
            >
              <div style={{ maxWidth: "100%", width: "100%", display: "flex", minWidth: 0, overflow: "hidden" }}>
                <ProfileHoverCard username={u.username}>
                  <ProfileNameLink
                    to={`/${u.username}`}
                    style={{
                      maxWidth: "100%",
                      display: "block",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <Text
                      style={{
                        fontWeight: 600,
                        fontSize: "13px",
                        lineHeight: "18px",
                        color: "var(--color-text-heading)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        display: "block",
                      }}
                      title={u.display_name || u.username}
                    >
                      {u.display_name || u.username}
                    </Text>
                  </ProfileNameLink>
                </ProfileHoverCard>
              </div>
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  display: "block",
                  maxWidth: "100%",
                  fontSize: "12px",
                  lineHeight: "16px",
                  color: "var(--color-text-muted)",
                }}
                title={`@${u.username}`}
              >
                @{u.username}
              </span>
            </Box>
            <div style={{ flexShrink: 0 }}>
              <FollowButton username={u.username} initialIsFollowing={false} size="small" />
            </div>
          </Box>
        ))}
        {filteredSuggestions.length === 0 && (
          <Text style={{ color: "var(--color-fg-muted)", fontSize: "13px", lineHeight: "18px" }}>
            No suggestions at this time.
          </Text>
        )}
      </Box>
      <ShowMoreLink to="/explore" style={{ marginTop: "10px" }}>
        Explore all creators →
      </ShowMoreLink>
    </Card>
  );
};
