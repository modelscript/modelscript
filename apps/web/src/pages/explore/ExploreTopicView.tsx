// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, InfoIcon, PlusIcon, ShareIcon, TagIcon } from "@primer/octicons-react";
import { Heading, Text } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getRelatedTopics } from "../../api";
import Box from "../../components/Box";
import { scrollToTop } from "../../components/ScrollToTop";
import Spinner from "../../components/Spinner";
import VirtualPostList from "../../components/VirtualPostList";
import type { PostData, TopicData } from "./constants";
import { TOPIC_TABS } from "./constants";
import { ExploreSearchHeader } from "./ExploreSearchHeader";
import { TabButton, TabContainer } from "./styles";

interface RelatedTagItem {
  tag: string;
  coOccurrenceCount?: number;
}

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
  trending?: TopicData[] | undefined;
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
  trending = [],
  copiedTopicLink,
  handleCopyTopic,
  openCompose,
}) => {
  const [coOccurringTags, setCoOccurringTags] = useState<RelatedTagItem[]>([]);

  useEffect(() => {
    if (!topic) {
      setCoOccurringTags([]);
      return;
    }
    let active = true;
    getRelatedTopics(topic, 8)
      .then((res) => {
        if (!active || !Array.isArray(res?.topics)) return;
        const items: RelatedTagItem[] = res.topics
          .map((t: any) => ({
            tag: String(t.display_name || t.concept || "").replace(/^#/, ""),
            coOccurrenceCount: Number(t.co_occurrence_count ?? t.coOccurrenceCount ?? 0),
          }))
          .filter((item) => Boolean(item.tag) && item.tag.toLowerCase() !== topic.toLowerCase());
        setCoOccurringTags(items);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [topic]);

  const fallbackRelatedTags: RelatedTagItem[] = trending
    .filter(
      (t) => Number(t.postsCount ?? (t.post_count as number | undefined) ?? (t.count as number | undefined) ?? 0) > 0,
    )
    .map((t) => ({
      tag: String(t.display_name || t.tag || t.concept || t.name || "").replace(/^#/, ""),
    }))
    .filter((item) => Boolean(item.tag) && item.tag.toLowerCase() !== topic.toLowerCase());

  const isCoOccurring = coOccurringTags.length > 0;
  const relatedTags = isCoOccurring ? coOccurringTags : fallbackRelatedTags;

  const uniqueContributors = useMemo(() => {
    const authors = new Set<string>();
    for (const p of topicPosts) {
      const anyPost = p as Record<string, unknown>;
      const authorId = anyPost["username"] || anyPost["author_id"] || anyPost["authorId"] || anyPost["user_id"];
      if (authorId) {
        authors.add(String(authorId));
      }
    }
    return authors.size;
  }, [topicPosts]);

  return (
    <Box>
      <ExploreSearchHeader
        onBack={handleBack}
        value={localQuery}
        onChange={setLocalQuery}
        onSubmit={handleSearchSubmit}
        placeholder="Search or enter #hashtag"
      />

      {/* Topic Hero Banner */}
      <Box
        p={4}
        borderBottom="1px solid var(--color-border)"
        style={{
          background: "linear-gradient(180deg, rgba(139, 92, 246, 0.12) 0%, rgba(6, 182, 212, 0.04) 100%)",
        }}
      >
        <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={3} flexWrap="wrap">
          <Box>
            <Box display="flex" alignItems="center" gap={2} mb={2} flexWrap="wrap">
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  fontSize: "11px",
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
                <TagIcon size={12} />
                Topic
              </span>
              <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                {topicPosts.length} {topicPosts.length === 1 ? "post" : "posts"}
                {uniqueContributors > 0 && (
                  <>
                    {" · "}
                    {uniqueContributors} {uniqueContributors === 1 ? "contributor" : "contributors"}
                  </>
                )}
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
                maxWidth: "560px",
                lineHeight: 1.5,
              }}
            >
              Models, discussions, and shared artifacts tagged with #{topic}.
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

        {/* Co-occurring or Trending Hashtags */}
        {relatedTags.length > 0 && (
          <Box mt={3} pt={3} borderTop="1px solid rgba(255, 255, 255, 0.06)">
            <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
              <span
                title={
                  isCoOccurring
                    ? `Tags that frequently appear on the same posts as #${topic}`
                    : "Popular topics across the community"
                }
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "var(--color-text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  cursor: "help",
                }}
              >
                {isCoOccurring ? "Frequently Co-Tagged" : "Trending in Community"}
                <InfoIcon size={12} />:
              </span>
              {relatedTags.slice(0, 6).map((rel) => (
                <Link
                  key={rel.tag}
                  to={`/explore?topic=${encodeURIComponent(rel.tag)}`}
                  title={
                    rel.coOccurrenceCount && rel.coOccurrenceCount > 0
                      ? `Co-tagged in ${rel.coOccurrenceCount} ${rel.coOccurrenceCount === 1 ? "post" : "posts"} with #${topic}`
                      : `#${rel.tag}`
                  }
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
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
                  <span>#{rel.tag}</span>
                  {rel.coOccurrenceCount !== undefined && rel.coOccurrenceCount > 0 && (
                    <span
                      style={{
                        fontSize: "10px",
                        padding: "1px 5px",
                        borderRadius: "4px",
                        background: "rgba(139, 92, 246, 0.18)",
                        color: "var(--color-accent-purple)",
                        fontWeight: 700,
                      }}
                    >
                      {rel.coOccurrenceCount}
                    </span>
                  )}
                </Link>
              ))}
            </Box>
          </Box>
        )}
      </Box>

      {/* Topic View Tabs (Top / Latest) */}
      <TabContainer
        role="tablist"
        aria-label="Topic feed tabs"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        {TOPIC_TABS.map((tab) => {
          const isActive = (topicFilter || "top").toLowerCase() === tab.toLowerCase();
          return (
            <TabButton
              key={tab}
              role="tab"
              aria-selected={isActive}
              $active={isActive}
              onClick={() => {
                if (isActive) {
                  scrollToTop({ smooth: true });
                } else {
                  setTopicFilter(tab.toLowerCase());
                }
              }}
            >
              {tab}
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
          <VirtualPostList posts={topicPosts} />
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
                Be the first to publish a model, artifact, or discussion tagged #{topic}!
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
