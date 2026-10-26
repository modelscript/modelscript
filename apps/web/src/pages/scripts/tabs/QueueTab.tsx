// SPDX-License-Identifier: AGPL-3.0-or-later

import { FilterIcon, SearchIcon, ServerIcon, XIcon } from "@primer/octicons-react";
import { Heading, Text } from "@primer/react";
import React from "react";
import Box from "../../../components/Box";
import { UnifiedJobCard } from "../components/UnifiedJobCard";
import { FilterChip, SpinningIcon } from "../styles";
import type { UnifiedJobItem } from "../types";

export interface QueueTabProps {
  isLoading: boolean;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  statusFilter: string;
  setStatusFilter: (status: string) => void;
  filteredJobs: UnifiedJobItem[];
  onInspectJob: (id: string | number) => void;
  onBrowseTemplates: () => void;
}

export const QueueTab: React.FC<QueueTabProps> = ({
  isLoading,
  searchQuery,
  setSearchQuery,
  statusFilter,
  setStatusFilter,
  filteredJobs,
  onInspectJob,
  onBrowseTemplates,
}) => {
  return (
    <Box display="flex" flexDirection="column" gap={3}>
      {/* Filter & Search Bar */}
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        flexWrap="wrap"
        gap={3}
        p={3}
        borderRadius="10px"
        style={{
          background: "var(--color-bg-card, rgba(255, 255, 255, 0.03))",
          border: "1px solid var(--color-border-glass, rgba(255, 255, 255, 0.08))",
        }}
      >
        {/* Search */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: "rgba(255, 255, 255, 0.04)",
            border: "1px solid var(--color-border-glass, rgba(255, 255, 255, 0.1))",
            borderRadius: "8px",
            padding: "6px 12px",
            minWidth: "260px",
          }}
        >
          <SearchIcon size={14} style={{ color: "var(--color-text-muted)" }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter jobs by name, ID, or solver..."
            style={{
              background: "transparent",
              border: "none",
              outline: "none",
              color: "inherit",
              fontSize: "13px",
              width: "100%",
            }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              style={{ background: "none", border: "none", color: "var(--color-text-muted)", cursor: "pointer" }}
            >
              <XIcon size={12} />
            </button>
          )}
        </div>

        {/* Status Filters */}
        <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)", marginRight: "4px" }}>
            <FilterIcon size={12} /> Status:
          </span>
          {(["ALL", "RUNNING", "QUEUED", "SUCCESS", "FAILED"] as const).map((st) => (
            <FilterChip
              key={st}
              $isSelected={statusFilter === st}
              $activeColor={
                st === "RUNNING"
                  ? "var(--color-accent-cyan, #06b6d4)"
                  : st === "QUEUED"
                    ? "#f59e0b"
                    : st === "SUCCESS"
                      ? "#10b981"
                      : st === "FAILED"
                        ? "#ef4444"
                        : "var(--color-accent-purple, #6f42c1)"
              }
              onClick={() => setStatusFilter(st)}
            >
              <span>{st === "ALL" ? "All Status" : st}</span>
            </FilterChip>
          ))}
        </Box>
      </Box>

      {/* Jobs List / Table */}
      {isLoading ? (
        <Box py={6} textAlign="center" color="var(--color-text-muted)">
          <SpinningIcon size={24} $isSpinning={true} />
          <Text display="block" mt={2} fontSize="13px">
            Loading HPC jobs queue...
          </Text>
        </Box>
      ) : filteredJobs.length === 0 ? (
        <Box
          py={6}
          textAlign="center"
          color="var(--color-text-muted)"
          borderRadius="12px"
          style={{
            background: "var(--color-bg-card, rgba(255, 255, 255, 0.02))",
            border: "1px dashed var(--color-border-glass, rgba(255, 255, 255, 0.1))",
          }}
        >
          <ServerIcon size={36} style={{ color: "var(--color-text-muted)", opacity: 0.6 }} />
          <Heading as="h3" style={{ fontSize: "16px", marginTop: "12px", color: "var(--color-text-primary)" }}>
            No simulation jobs found
          </Heading>
          <Text
            fontSize="13px"
            style={{ maxWidth: 360, margin: "6px auto 16px", display: "block", color: "var(--color-text-muted)" }}
          >
            {searchQuery || statusFilter !== "ALL"
              ? "Try adjusting your search query or status filter."
              : "You haven't launched any simulations yet. Pick a ready-to-run template or submit a custom job."}
          </Text>
          <button
            type="button"
            onClick={onBrowseTemplates}
            style={{
              background: "var(--color-accent-cyan, #06b6d4)",
              border: "none",
              color: "#ffffff",
              borderRadius: "8px",
              padding: "8px 18px",
              fontSize: "13px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Browse Simulation Templates
          </button>
        </Box>
      ) : (
        <Box display="flex" flexDirection="column" gap={2}>
          {filteredJobs.map((job) => (
            <UnifiedJobCard key={job.id} job={job} onInspect={onInspectJob} />
          ))}
        </Box>
      )}
    </Box>
  );
};
