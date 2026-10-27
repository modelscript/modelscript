// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import { PeopleIcon } from "@primer/octicons-react";
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
      <Box display="flex" alignItems="center" gap={2} mb={3}>
        <span style={{ color: "var(--color-accent-purple)", display: "inline-flex" }}>
          <PeopleIcon size={14} />
        </span>
        <Text
          style={{
            fontSize: "12px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--color-text-muted)",
          }}
        >
          Who to follow
        </Text>
      </Box>
      <Box display="flex" flexDirection="column" gap={3}>
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
              style={{ margin: "0 12px" }}
              display="flex"
              flexDirection="column"
              alignItems="flex-start"
            >
              <div style={{ maxWidth: "100%", display: "flex", minWidth: 0 }}>
                <ProfileHoverCard username={u.username}>
                  <ProfileNameLink to={`/${u.username}`} style={{ maxWidth: "100%" }}>
                    <Text
                      style={{
                        fontWeight: "600",
                        fontSize: "14px",
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
                  marginTop: "1px",
                  display: "block",
                  maxWidth: "100%",
                  fontSize: "12.5px",
                  color: "var(--color-text-muted)",
                  lineHeight: 1.2,
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
          <Text style={{ color: "var(--color-fg-muted)", fontSize: "14px" }}>No suggestions at this time.</Text>
        )}
      </Box>
      <ShowMoreLink to="/explore" style={{ marginTop: "12px" }}>
        Explore all creators →
      </ShowMoreLink>
    </Card>
  );
};
