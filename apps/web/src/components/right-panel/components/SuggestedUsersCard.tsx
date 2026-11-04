// SPDX-License-Identifier: AGPL-3.0-or-later

import { Text } from "@primer/react";
import React from "react";
import { useNavigate } from "react-router-dom";
import Box from "../../Box";
import FollowButton from "../../FollowButton";
import ProfileHoverCard from "../../ProfileHoverCard";
import { Avatar, Card, CardHeader, CardTitle, PanelList, ProfileNameLink, TrendingItem } from "../styles";

export interface SuggestedUsersCardProps {
  suggestions: any[];
  currentUsername?: string | undefined;
}

export const SuggestedUsersCard: React.FC<SuggestedUsersCardProps> = ({ suggestions, currentUsername }) => {
  const navigate = useNavigate();
  const filteredSuggestions = suggestions.filter((u) => !currentUsername || u.username !== currentUsername);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Who to follow</CardTitle>
      </CardHeader>
      <PanelList>
        {filteredSuggestions.map((u) => (
          <TrendingItem key={u.id} onClick={() => navigate(`/@${u.username}`)}>
            <ProfileHoverCard username={u.username}>
              <ProfileNameLink to={`/@${u.username}`} style={{ flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                <Avatar $url={u.avatar_url} $letter={u.username.charAt(0).toUpperCase()} />
              </ProfileNameLink>
            </ProfileHoverCard>
            <Box flex={1} minWidth={0} display="flex" flexDirection="column" alignItems="flex-start">
              <div style={{ maxWidth: "100%", width: "100%", display: "flex", minWidth: 0, overflow: "hidden" }}>
                <ProfileHoverCard username={u.username}>
                  <ProfileNameLink
                    to={`/@${u.username}`}
                    onClick={(e) => e.stopPropagation()}
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
            <div style={{ flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
              <FollowButton username={u.username} initialIsFollowing={false} size="small" />
            </div>
          </TrendingItem>
        ))}
        {filteredSuggestions.length === 0 && (
          <Box py={2} px={1}>
            <Text style={{ color: "var(--color-text-muted)", fontSize: "12.5px", lineHeight: "16px" }}>
              No suggestions at this time.
            </Text>
          </Box>
        )}
      </PanelList>
    </Card>
  );
};
