// SPDX-License-Identifier: AGPL-3.0-or-later

import { FilterIcon, PlusIcon, RocketIcon, SearchIcon, XIcon } from "@primer/octicons-react";
import React from "react";
import { useNavigate } from "react-router-dom";
import { FILTER_CHIPS } from "../constants";
import {
  EmptyStateActions,
  EmptyStateContainer,
  EmptyStateIconOrb,
  EmptyStateSubtitle,
  EmptyStateTitle,
  PrimaryActionButton,
  SecondaryActionButton,
} from "../styles";
import FeedQuickstartStudio from "./FeedQuickstartStudio";

export interface FeedEmptyStateProps {
  isFiltering: boolean;
  activeFilter: string;
  activeTag: string | null;
  onClearFilters: () => void;
  openCompose?: ((opts?: any) => void) | undefined;
  followedHandles: Record<string, boolean>;
  onToggleFollow: (handle: string) => void;
}

export const FeedEmptyState: React.FC<FeedEmptyStateProps> = ({
  isFiltering,
  activeFilter,
  activeTag,
  onClearFilters,
  openCompose,
  followedHandles,
  onToggleFollow,
}) => {
  const navigate = useNavigate();

  return (
    <EmptyStateContainer>
      <EmptyStateIconOrb>{isFiltering ? <FilterIcon size={28} /> : <RocketIcon size={28} />}</EmptyStateIconOrb>
      <EmptyStateTitle>{isFiltering ? "No Matching Engineering Posts" : "Engineering Timeline Ready"}</EmptyStateTitle>
      <EmptyStateSubtitle>
        {isFiltering ? (
          <>
            No posts found matching{" "}
            {activeFilter !== "all" && <strong>{FILTER_CHIPS.find((c) => c.id === activeFilter)?.label}</strong>}
            {activeFilter !== "all" && activeTag && " and "}
            {activeTag && <strong>#{activeTag}</strong>}. Try adjusting your filters or share the first artifact!
          </>
        ) : (
          "Follow physical modeling engineers, explore Modelica & SysML packages, or publish your first simulation artifact."
        )}
      </EmptyStateSubtitle>
      {!isFiltering && <FeedQuickstartStudio followedHandles={followedHandles} onToggleFollow={onToggleFollow} />}
      <EmptyStateActions>
        {isFiltering ? (
          <>
            <PrimaryActionButton onClick={onClearFilters}>
              <XIcon size={16} />
              <span>Clear All Filters</span>
            </PrimaryActionButton>
            {openCompose && (
              <SecondaryActionButton
                onClick={() =>
                  openCompose({
                    content: activeTag ? `#${activeTag} ` : "",
                    defaultText: activeTag ? `#${activeTag} ` : "",
                  })
                }
              >
                <PlusIcon size={16} />
                <span>Post with #{activeTag || "Modelica"}</span>
              </SecondaryActionButton>
            )}
          </>
        ) : (
          <>
            <PrimaryActionButton onClick={() => navigate("/explore")}>
              <SearchIcon size={16} />
              <span>Explore Models</span>
            </PrimaryActionButton>
            {openCompose && (
              <SecondaryActionButton onClick={() => openCompose()}>
                <PlusIcon size={16} />
                <span>Create First Post</span>
              </SecondaryActionButton>
            )}
          </>
        )}
      </EmptyStateActions>
    </EmptyStateContainer>
  );
};

export default FeedEmptyState;
