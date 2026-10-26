// SPDX-License-Identifier: AGPL-3.0-or-later

import { PlusIcon, SearchIcon, XCircleFillIcon } from "@primer/octicons-react";
import { Button, Heading, Select, Text, TextInput } from "@primer/react";
import React from "react";
import Box from "../../../components/Box";
import type { SortOption } from "../../../util/package-helpers";
import { DOMAIN_OPTIONS } from "../constants";
import { FilterPill, FilterPillBar, ResultCount } from "../styles";

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
}) => {
  return (
    <Box display="flex" flexDirection="column" gap={3} mb={4}>
      <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2}>
        <Box display="flex" alignItems="baseline" gap="8px">
          <Heading as="h1" style={{ color: "var(--color-text-heading)", fontWeight: 800, fontSize: 24, margin: 0 }}>
            Packages
          </Heading>
          {!loading && (
            <ResultCount>
              {displayedCount} package{displayedCount !== 1 ? "s" : ""}
            </ResultCount>
          )}
        </Box>

        <Button variant="primary" leadingVisual={PlusIcon} onClick={onOpenPublishModal}>
          Publish Package
        </Button>
      </Box>

      <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={3}>
        <Box
          display="flex"
          alignItems="center"
          style={{
            maxWidth: "460px",
            width: "100%",
            flex: "1 1 280px",
          }}
        >
          <TextInput
            leadingVisual={SearchIcon}
            placeholder="Search packages by name, scope, or keyword..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            trailingAction={
              searchInput ? (
                <TextInput.Action icon={XCircleFillIcon} aria-label="Clear search" onClick={onClearSearch} />
              ) : undefined
            }
            sx={{ width: "100%" }}
          />
        </Box>

        <Box display="flex" alignItems="center" gap={2}>
          <Text style={{ fontSize: 12, color: "var(--color-text-muted)", fontWeight: 600 }}>Sort by:</Text>
          <Select
            size="small"
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value as SortOption)}
            aria-label="Sort packages"
          >
            <Select.Option value="downloads">Most Downloaded</Select.Option>
            <Select.Option value="recent">Recently Updated</Select.Option>
            <Select.Option value="name">Alphabetical (A–Z)</Select.Option>
          </Select>
        </Box>
      </Box>

      {/* Polyglot Domain Filter Pills */}
      <FilterPillBar>
        {DOMAIN_OPTIONS.map((d) => {
          const IconComp = d.icon;
          return (
            <FilterPill
              key={d.id}
              $active={domainFilter === d.id}
              $color={d.color}
              onClick={() => onDomainFilterChange(d.id)}
            >
              <IconComp size={13} />
              <span>{d.label}</span>
            </FilterPill>
          );
        })}
      </FilterPillBar>
    </Box>
  );
};
