// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, PlusIcon, ShareIcon, TagIcon } from "@primer/octicons-react";
import { Heading, Spinner, Text } from "@primer/react";
import React from "react";
import { Link } from "react-router-dom";
import Box from "../../components/Box";
import Post from "../../components/Post";
import type { PostData } from "./constants";
import { BASE_RELATED_TAGS, TOPIC_ARTIFACT_TABS } from "./constants";
import { ExploreSearchHeader } from "./ExploreSearchHeader";
import { TabButton, TabContainer } from "./styles";

export interface ExploreTopicViewProps {
  topic: string;
  localQuery: string;
  setLocalQuery: (value: string) => void;
  handleSearchSubmit: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  handleBack: () => void;
  topicFilter: string;
  setTopicFilter: (filter: string) => void;
  loading: boolean;
  topicPosts: PostData[];
  copiedTopicLink: boolean;
  handleCopyTopic: () => void;
  openCompose?: ((opts?: { content?: string; defaultText?: string }) => void) | undefined;
}

export const ExploreTopicView: React.FC<ExploreTopicViewProps> = ({
  topic,
  localQuery,
  setLocalQuery,
  handleSearchSubmit,
  handleBack,
  topicFilter,
  setTopicFilter,
  loading,
  topicPosts,
  copiedTopicLink,
  handleCopyTopic,
  openCompose,
}) => {
  const relatedTags = BASE_RELATED_TAGS.filter((t) => t.toLowerCase() !== topic.toLowerCase());

  return (
    <Box>
      <ExploreSearchHeader
        onBack={handleBack}
        value={localQuery}
        onChange={setLocalQuery}
        onSubmit={handleSearchSubmit}
        placeholder="Search or enter #hashtag"
      />

      {/* Engineering Topic Hero Banner */}
      <Box
        p={4}
        borderBottom="1px solid var(--color-border)"
        style={{
          background: "linear-gradient(180deg, rgba(139, 92, 246, 0.12) 0%, rgba(6, 182, 212, 0.04) 100%)",
        }}
      >
        <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={3} flexWrap="wrap">
          <Box>
            <Box display="flex" alignItems="center" gap={2} mb={2}>
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  padding: "3px 8px",
                  borderRadius: "9999px",
                  background: "rgba(139, 92, 246, 0.2)",
                  color: "var(--color-accent-purple)",
                  border: "1px solid rgba(139, 92, 246, 0.4)",
                }}
              >
                Engineering Topic
              </span>
              <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                {topicPosts.length} {topicPosts.length === 1 ? "post" : "posts"} indexed
              </span>
            </Box>
            <Heading
              as="h1"
              style={{
                fontSize: "26px",
                fontWeight: 800,
                margin: "0 0 6px 0",
                color: "var(--color-text-heading)",
                letterSpacing: "-0.5px",
              }}
            >
              #{topic}
            </Heading>
            <Text
              as="p"
              style={{
                fontSize: "14px",
                color: "var(--color-text-muted)",
                margin: 0,
                maxWidth: "540px",
                lineHeight: 1.5,
              }}
            >
              Explore engineering models, dynamic simulations, CAD geometry, and discussions tagged with #{topic}.
            </Text>
          </Box>

          <Box display="flex" alignItems="center" gap={2}>
            <button
              type="button"
              onClick={handleCopyTopic}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 14px",
                borderRadius: "8px",
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid var(--color-border-glass)",
                color: "var(--color-text-primary)",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {copiedTopicLink ? <CheckIcon size={14} fill="var(--color-accent-cyan)" /> : <ShareIcon size={14} />}
              <span>{copiedTopicLink ? "Link Copied" : "Share"}</span>
            </button>
            {openCompose && (
              <button
                type="button"
                onClick={() => openCompose({ content: `#${topic} `, defaultText: `#${topic} ` })}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 16px",
                  borderRadius: "8px",
                  background: "var(--gradient-cta)",
                  color: "white",
                  border: "none",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow: "0 0 12px rgba(139, 92, 246, 0.35)",
                }}
              >
                <PlusIcon size={14} />
                <span>Post with #{topic}</span>
              </button>
            )}
          </Box>
        </Box>

        {/* Related Engineering Hashtags */}
        <Box mt={3} pt={3} borderTop="1px solid rgba(255, 255, 255, 0.06)">
          <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "var(--color-text-muted)",
                textTransform: "uppercase",
              }}
            >
              Related Tags:
            </span>
            {relatedTags.slice(0, 6).map((rel) => (
              <Link
                key={rel}
                to={`/explore?topic=${encodeURIComponent(rel)}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  fontSize: "11px",
                  fontFamily: "var(--font-mono)",
                  padding: "2px 8px",
                  borderRadius: "6px",
                  background: "rgba(255, 255, 255, 0.04)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  color: "var(--color-text-secondary)",
                  textDecoration: "none",
                }}
              >
                #{rel}
              </Link>
            ))}
          </Box>
        </Box>
      </Box>

      {/* Topic Sub-filter Tabs */}
      <TabContainer style={{ borderBottom: "1px solid var(--color-border)" }}>
        {TOPIC_ARTIFACT_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <TabButton key={tab.id} $active={topicFilter === tab.id} onClick={() => setTopicFilter(tab.id)}>
              {Icon && <Icon size={13} style={{ marginRight: "5px", verticalAlign: "middle" }} />}
              {tab.label}
            </TabButton>
          );
        })}
      </TabContainer>

      {loading ? (
        <Box p={6} display="flex" justifyContent="center">
          <Spinner size="large" />
        </Box>
      ) : (
        <Box>
          {topicPosts.map((post) => (
            <Post key={post.id} post={post} />
          ))}
          {topicPosts.length === 0 && (
            <Box p={6} textAlign="center">
              <TagIcon size={36} style={{ color: "var(--color-text-muted)", marginBottom: "12px" }} />
              <Heading
                as="h3"
                style={{
                  fontSize: "18px",
                  fontWeight: 700,
                  marginBottom: "8px",
                  color: "var(--color-text-heading)",
                }}
              >
                No Posts Found for #{topic}
              </Heading>
              <Text
                as="p"
                style={{
                  fontSize: "14px",
                  color: "var(--color-text-muted)",
                  maxWidth: "420px",
                  margin: "0 auto 20px auto",
                }}
              >
                {topicFilter !== "all"
                  ? `No posts tagged #${topic} with ${TOPIC_ARTIFACT_TABS.find((t) => t.id === topicFilter)?.label} artifacts yet.`
                  : `Be the first engineer to publish a simulation model, CAD geometry, or question tagged #${topic}!`}
              </Text>
              {openCompose && (
                <button
                  type="button"
                  onClick={() => openCompose({ content: `#${topic} `, defaultText: `#${topic} ` })}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 16px",
                    borderRadius: "8px",
                    background: "var(--gradient-cta)",
                    color: "white",
                    border: "none",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <PlusIcon size={14} />
                  <span>Create First #{topic} Post</span>
                </button>
              )}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};
