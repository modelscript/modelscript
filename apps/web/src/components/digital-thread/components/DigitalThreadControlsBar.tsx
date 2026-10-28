// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  FileCodeIcon,
  PackageIcon,
  PlusIcon,
  SearchIcon,
  ShieldCheckIcon,
  WorkflowIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { Button, Label, TextInput } from "@primer/react";
import React from "react";
import Box from "../../Box";
import { ControlsBar, FilterPill, FilterPillGroup } from "../styles";

export interface DigitalThreadControlsBarProps {
  domainFilter: string;
  onDomainFilterChange: (domain: string) => void;
  twinsCount: number;
  liveStreamConnected: boolean;
  onOpenCreateModal: () => void;
  onOpenGovernance: () => void;
  openProposalsCount: number;
  parityFilter: "all" | "compatible" | "incompatible";
  onParityFilterChange: (parity: "all" | "compatible" | "incompatible") => void;
  compatibleCount: number;
  incompatibleCount: number;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
}

export const DigitalThreadControlsBar: React.FC<DigitalThreadControlsBarProps> = ({
  domainFilter,
  onDomainFilterChange,
  twinsCount,
  liveStreamConnected,
  onOpenCreateModal,
  onOpenGovernance,
  openProposalsCount,
  parityFilter,
  onParityFilterChange,
  compatibleCount,
  incompatibleCount,
  searchQuery,
  onSearchQueryChange,
}) => {
  return (
    <ControlsBar>
      <FilterPillGroup>
        <FilterPill $active={domainFilter === "all"} onClick={() => onDomainFilterChange("all")}>
          All Domains ({twinsCount})
        </FilterPill>
        <FilterPill
          $active={domainFilter === "modelica-sysml"}
          $color="#a855f7"
          onClick={() => onDomainFilterChange("modelica-sysml")}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <FileCodeIcon size={12} /> Modelica ⟷ <WorkflowIcon size={12} /> SysML v2
          </span>
        </FilterPill>
        <FilterPill
          $active={domainFilter === "modelica-cad"}
          $color="#fbbf24"
          onClick={() => onDomainFilterChange("modelica-cad")}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <FileCodeIcon size={12} /> Modelica ⟷ <PackageIcon size={12} /> STEP CAD
          </span>
        </FilterPill>
        <FilterPill
          $active={domainFilter === "sysml-cad"}
          $color="#38bdf8"
          onClick={() => onDomainFilterChange("sysml-cad")}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <WorkflowIcon size={12} /> SysML v2 ⟷ <PackageIcon size={12} /> STEP CAD
          </span>
        </FilterPill>
      </FilterPillGroup>

      <Box display="flex" gap={2} alignItems="center" flexWrap="wrap">
        {liveStreamConnected && (
          <Label
            variant="accent"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              fontSize: 12,
              fontWeight: 600,
              background: "rgba(31, 111, 235, 0.12)",
              border: "1px solid var(--color-accent-emphasis, #0969da)",
            }}
          >
            <ZapIcon size={13} fill="var(--ms-success)" />
            Live Collaborative Thread Active
          </Label>
        )}

        <Button size="small" variant="primary" leadingVisual={PlusIcon} onClick={onOpenCreateModal}>
          Create Semantic Link
        </Button>

        <Button size="small" variant="default" leadingVisual={ShieldCheckIcon} onClick={onOpenGovernance}>
          Governance & Audit Trail
          {openProposalsCount > 0 && (
            <Label variant="attention" sx={{ ml: 1, fontSize: 10 }}>
              {openProposalsCount} open
            </Label>
          )}
        </Button>

        <FilterPillGroup>
          <FilterPill $active={parityFilter === "all"} onClick={() => onParityFilterChange("all")}>
            All Parity
          </FilterPill>
          <FilterPill
            $active={parityFilter === "compatible"}
            $color="var(--ms-success)"
            onClick={() => onParityFilterChange("compatible")}
          >
            ✔ Verified ({compatibleCount})
          </FilterPill>
          {incompatibleCount > 0 && (
            <FilterPill
              $active={parityFilter === "incompatible"}
              $color="var(--ms-danger)"
              onClick={() => onParityFilterChange("incompatible")}
            >
              ✖ Issues ({incompatibleCount})
            </FilterPill>
          )}
        </FilterPillGroup>

        <TextInput
          leadingVisual={SearchIcon}
          placeholder="Search twins or units..."
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          size="small"
          style={{ minWidth: 220 }}
        />
      </Box>
    </ControlsBar>
  );
};
