// SPDX-License-Identifier: AGPL-3.0-or-later

import type React from "react";
import type { SpaceDetailResponse, SpaceEcoProposalRecord, SpaceRole } from "../../../api";
import type { User } from "../../../AuthContext";

export interface SpaceChangeControlTabProps {
  detail: SpaceDetailResponse;
  viewerState: {
    canWrite: boolean;
    canAdmin: boolean;
    role: SpaceRole | null;
  };
  user: User | null;
  onEcoCreated?: ((eco: SpaceEcoProposalRecord, ecos: SpaceEcoProposalRecord[]) => void) | undefined;
  onEcoReviewed?: ((eco: SpaceEcoProposalRecord, ecos: SpaceEcoProposalRecord[]) => void) | undefined;
}

export type ChangeControlViewMode = "list" | "detail";

export type EcoStatusFilter = "all" | "open" | "in_review" | "approved";

export type EcoSeverity = "minor" | "standard" | "major" | "safety_critical";

export type SigningDecision = "approved" | "changes_requested" | "rejected";

export type DiffStudioMode = "studio" | "monaco";

export interface TimelineComment {
  id: string;
  username: string;
  role: string;
  text: string;
  createdAt: string;
}

export interface EcoMetricsSummary {
  totalEcos: number;
  openEcos: number;
  approvedEcos: number;
  passedGates: number;
  gatePassRate: number;
  totalApprovals: number;
}

export interface SeverityBadgeMeta {
  label: string;
  sublabel: string;
  fg: string;
  bg: string;
  border: string;
  icon: string;
}

export interface SimulationGateBadgeMeta {
  label: string;
  fullLabel: string;
  fg: string;
  bg: string;
  border: string;
  icon: React.ReactNode;
}

export interface EcoStatusBadgeMeta {
  label: string;
  fg: string;
  bg: string;
  border: string;
  icon: React.ReactNode;
}
