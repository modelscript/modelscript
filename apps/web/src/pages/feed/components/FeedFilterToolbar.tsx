// SPDX-License-Identifier: AGPL-3.0-or-later

import { FilterIcon, TagIcon, XIcon } from "@primer/octicons-react";
import React from "react";
import { useNavigate } from "react-router-dom";
import { FILTER_CHIPS } from "../constants";
import { ActiveFilterBanner, FilterChipButton, FilterChipsScroll, FilterSection, HashtagPill } from "../styles";
import type { TopicItem } from "../types";

export interface FeedFilterToolbarProps {
  activeFilter: string;
  setActiveFilter: (filter: string) => void;
  activeTag: string | null;
  setActiveTag: (tag: string | null) => void;
  trendingTopics: TopicItem[];
  postsCount: number;
}

export const FeedFilterToolbar: React.FC<FeedFilterToolbarProps> = ({
  activeFilter,
  setActiveFilter,
  activeTag,
  setActiveTag,
  trendingTopics,
  postsCount,
}) => {
  const navigate = useNavigate();
  const isFiltering = activeFilter !== "all" || activeTag !== null;

  return (
    <>
      <FilterSection>
        <FilterChipsScroll role="toolbar" aria-label="Engineering Artifact Filters & Topics">
          {FILTER_CHIPS.map((chip) => {
            const isActive = activeFilter === chip.id;
            const IconComponent = chip.icon;
            return (
              <FilterChipButton
                key={chip.id}
                $active={isActive}
                onClick={() => {
                  if (isActive && chip.id !== "all") {
                    setActiveFilter("all");
                  } else {
                    setActiveFilter(chip.id);
                  }
                }}
                title={chip.description}
                aria-pressed={isActive}
              >
                <span className="chip-icon">
                  <IconComponent size={13} />
                </span>
                <span>{chip.label}</span>
              </FilterChipButton>
            );
          })}

          <div
            style={{
              height: "18px",
              width: "1px",
              background: "var(--color-border-default)",
              margin: "0 4px",
              flexShrink: 0,
            }}
          />

          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "11px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--color-text-muted)",
              whiteSpace: "nowrap",
              flexShrink: 0,
              paddingRight: "2px",
            }}
          >
            <TagIcon size={12} /> Topics:
          </span>

          {trendingTopics.map((item) => {
            const isSelected = activeTag === item.concept || activeTag === item.displayName;
            return (
              <HashtagPill
                key={item.concept}
                $active={isSelected}
                onClick={() => {
                  if (isSelected) {
                    setActiveTag(null);
                  } else {
                    setActiveTag(item.concept);
                  }
                }}
                title={`Filter by #${item.displayName}`}
                aria-pressed={isSelected}
              >
                <span>#{item.displayName}</span>
                {typeof item.postCount === "number" && item.postCount > 0 && (
                  <span className="post-count">{item.postCount}</span>
                )}
              </HashtagPill>
            );
          })}
        </FilterChipsScroll>
      </FilterSection>

      {isFiltering && (
        <ActiveFilterBanner>
          <div className="filter-summary">
            <FilterIcon size={13} />
            <span>Filtering feed:</span>
            {activeFilter !== "all" &&
              (() => {
                const matched = FILTER_CHIPS.find((c) => c.id === activeFilter);
                const MatchedIcon = matched?.icon;
                return (
                  <span className="filter-pill">
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                      {MatchedIcon && <MatchedIcon size={12} />}
                      {matched?.label}
                    </span>
                    <button type="button" onClick={() => setActiveFilter("all")} aria-label="Remove artifact filter">
                      <XIcon size={12} />
                    </button>
                  </span>
                );
              })()}
            {activeTag && (
              <span className="filter-pill">
                <span>#{trendingTopics.find((t) => t.concept === activeTag)?.displayName || activeTag}</span>
                <button type="button" onClick={() => setActiveTag(null)} aria-label="Remove hashtag filter">
                  <XIcon size={12} />
                </button>
              </span>
            )}
            <span className="result-count">
              ({postsCount} {postsCount === 1 ? "result" : "results"})
            </span>
          </div>
          <div className="filter-actions">
            {activeTag && (
              <button
                type="button"
                className="topic-hub-link"
                onClick={() => navigate(`/explore?topic=${encodeURIComponent(activeTag)}`)}
              >
                Topic Hub ↗
              </button>
            )}
            <button
              type="button"
              className="clear-all-btn"
              onClick={() => {
                setActiveFilter("all");
                setActiveTag(null);
              }}
            >
              Reset filters
            </button>
          </div>
        </ActiveFilterBanner>
      )}
    </>
  );
};

export default FeedFilterToolbar;
