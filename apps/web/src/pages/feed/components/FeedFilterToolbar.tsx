// SPDX-License-Identifier: AGPL-3.0-or-later

import { FilterIcon, XIcon } from "@primer/octicons-react";
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
        <FilterChipsScroll role="toolbar" aria-label="Engineering Artifact Filters">
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
          {trendingTopics.slice(0, 5).map((topic) => {
            const tagClean = (topic.displayName || topic.concept || "").replace(/^#/, "");
            const isTagActive = activeTag?.toLowerCase() === tagClean.toLowerCase();
            return (
              <HashtagPill
                key={topic.concept || topic.displayName}
                $active={isTagActive}
                onClick={() => setActiveTag(isTagActive ? null : tagClean)}
                title={`${topic.postCount ?? 0} posts`}
                aria-pressed={isTagActive}
              >
                <span className="hash">#</span>
                <span>{tagClean}</span>
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
