// SPDX-License-Identifier: AGPL-3.0-or-later

import { ChevronDownIcon, GlobeIcon, PlusIcon, SearchIcon, SortAscIcon, XCircleFillIcon } from "@primer/octicons-react";
import { Button, Label } from "@primer/react";
import React, { useEffect, useRef } from "react";
import { scrollToTop } from "../../../components/ScrollToTop";
import type { SortOption } from "../../../util/package-helpers";
import { DOMAIN_OPTIONS } from "../constants";
import {
  HeaderActionsGroup,
  HeaderControlsRow,
  HeaderTitle,
  HeaderTitleGroup,
  HeaderTopRow,
  PackagesHeader,
  ResultCount,
  ScopeSegmentButton,
  ScopeSegmentedControl,
  SearchClearButton,
  SearchFieldWrapper,
  SearchKbdHint,
  ToolbarSelectWrapper,
} from "../styles";

export interface LibraryFilterBarProps {
  displayedCount: number;
  loading: boolean;
  onOpenPublishModal: () => void;
  searchInput: string;
  setSearchInput: (value: string) => void;
  onClearSearch: () => void;
  sortBy: SortOption;
  onSortChange: (sort: SortOption) => void;
  domainFilter: string;
  onDomainFilterChange: (domain: string) => void;
  activeTab?: "all" | "my" | undefined;
  onTabChange?: ((tab: "all" | "my") => void) | undefined;
  showScopeTabs?: boolean | undefined;
  pendingTransfersCount?: number | undefined;
}

export const LibraryFilterBar: React.FC<LibraryFilterBarProps> = ({
  displayedCount,
  loading,
  onOpenPublishModal,
  searchInput,
  setSearchInput,
  onClearSearch,
  sortBy,
  onSortChange,
  domainFilter,
  onDomainFilterChange,
  activeTab = "all",
  onTabChange,
  showScopeTabs = false,
  pendingTransfersCount = 0,
}) => {
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const active = document.activeElement;
        const tag = active?.tagName.toLowerCase();
        if (
          tag === "input" ||
          tag === "textarea" ||
          tag === "select" ||
          (active as HTMLElement | null)?.isContentEditable
        ) {
          return;
        }
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const activeDomainObj = DOMAIN_OPTIONS.find((d) => d.id === domainFilter) ?? DOMAIN_OPTIONS[0];
  const ActiveDomainIcon = activeDomainObj?.icon ?? GlobeIcon;

  return (
    <PackagesHeader>
      <HeaderTopRow>
        <HeaderTitleGroup>
          <HeaderTitle>Packages</HeaderTitle>
          {!loading && (
            <ResultCount title={`${displayedCount} package${displayedCount !== 1 ? "s" : ""}`}>
              {displayedCount}
            </ResultCount>
          )}
        </HeaderTitleGroup>

        <HeaderActionsGroup>
          {showScopeTabs && onTabChange && (
            <ScopeSegmentedControl role="tablist" aria-label="Package scope">
              <ScopeSegmentButton
                type="button"
                role="tab"
                aria-selected={activeTab === "all"}
                $active={activeTab === "all"}
                onClick={() => {
                  if (activeTab === "all") {
                    scrollToTop({ smooth: true });
                  } else {
                    onTabChange("all");
                    scrollToTop({ smooth: false });
                  }
                }}
              >
                All
              </ScopeSegmentButton>
              <ScopeSegmentButton
                type="button"
                role="tab"
                aria-selected={activeTab === "my"}
                $active={activeTab === "my"}
                onClick={() => {
                  if (activeTab === "my") {
                    scrollToTop({ smooth: true });
                  } else {
                    onTabChange("my");
                    scrollToTop({ smooth: false });
                  }
                }}
              >
                My Packages
                {pendingTransfersCount > 0 && (
                  <Label variant="attention" style={{ fontSize: 10, padding: "0 5px", lineHeight: "16px" }}>
                    {pendingTransfersCount}
                  </Label>
                )}
              </ScopeSegmentButton>
            </ScopeSegmentedControl>
          )}

          <Button
            size="small"
            variant="primary"
            leadingVisual={PlusIcon}
            onClick={onOpenPublishModal}
            style={{ height: 32, borderRadius: 8, padding: "0 12px", fontWeight: 600 }}
          >
            Publish Package
          </Button>
        </HeaderActionsGroup>
      </HeaderTopRow>

      <HeaderControlsRow>
        <SearchFieldWrapper>
          <SearchIcon size={15} />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search packages by name, scope, or keyword..."
            aria-label="Search packages"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (searchInput) {
                  onClearSearch();
                } else {
                  searchInputRef.current?.blur();
                }
              }
            }}
          />
          {searchInput ? (
            <SearchClearButton type="button" aria-label="Clear search" onClick={onClearSearch}>
              <XCircleFillIcon size={14} />
            </SearchClearButton>
          ) : (
            <SearchKbdHint className="search-kbd-hint" aria-hidden="true">
              /
            </SearchKbdHint>
          )}
        </SearchFieldWrapper>

        <ToolbarSelectWrapper $active={domainFilter !== "all"}>
          <span className="select-leading" aria-hidden="true">
            <ActiveDomainIcon size={14} />
          </span>
          <select
            value={domainFilter}
            onChange={(e) => onDomainFilterChange(e.target.value)}
            aria-label="Filter packages by domain"
          >
            {DOMAIN_OPTIONS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
          <span className="select-trailing" aria-hidden="true">
            <ChevronDownIcon size={13} />
          </span>
        </ToolbarSelectWrapper>

        <ToolbarSelectWrapper $active={sortBy !== "recommended"}>
          <span className="select-leading" aria-hidden="true">
            <SortAscIcon size={14} />
          </span>
          <select
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value as SortOption)}
            aria-label="Sort packages"
          >
            <option value="recommended">Recommended</option>
            <option value="downloads">Most Downloaded</option>
            <option value="dependents">Most Dependents</option>
            <option value="recent">Recently Updated</option>
            <option value="name">Alphabetical (A–Z)</option>
          </select>
          <span className="select-trailing" aria-hidden="true">
            <ChevronDownIcon size={13} />
          </span>
        </ToolbarSelectWrapper>
      </HeaderControlsRow>
    </PackagesHeader>
  );
};
