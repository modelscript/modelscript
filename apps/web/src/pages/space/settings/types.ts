// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  Organization,
  SpaceDetailResponse,
  SpaceMemberRecord,
  SpaceRecord,
  SpaceRole,
  SpaceVisibility,
  updateSpace,
} from "../../../api";

export interface SpaceSettingsTabProps {
  detail: SpaceDetailResponse;
  viewerState: {
    canWrite: boolean;
    canAdmin: boolean;
    role: SpaceRole | null;
  };
  myOrgs: Organization[];
  onSpaceUpdated?: ((updated: SpaceRecord) => void) | undefined;
  onMembersUpdated?: ((members: SpaceMemberRecord[]) => void) | undefined;
  onRefresh?: (() => Promise<void>) | undefined;
}

export type SettingsSection = "general" | "access" | "git" | "plm" | "features" | "integrations" | "danger";

export type SpacePatch = Parameters<typeof updateSpace>[2];

export type MinApproversOption = "1" | "2" | "consensus";

export const ROLE_COLORS: Record<SpaceRole, { bg: string; fg: string }> = {
  owner: { bg: "rgba(139, 92, 246, 0.16)", fg: "#a78bfa" },
  lead_engineer: { bg: "rgba(6, 182, 212, 0.16)", fg: "#22d3ee" },
  approver: { bg: "rgba(245, 158, 11, 0.16)", fg: "#fbbf24" },
  contributor: { bg: "rgba(16, 185, 129, 0.16)", fg: "#34d399" },
  reviewer: { bg: "rgba(59, 130, 246, 0.16)", fg: "#60a5fa" },
  viewer: { bg: "rgba(148, 163, 184, 0.16)", fg: "#94a3b8" },
};

export const ROLE_TITLES: Record<SpaceRole, string> = {
  owner: "Owner",
  lead_engineer: "Lead Engineer",
  approver: "PLM Approver",
  contributor: "Contributor",
  reviewer: "Reviewer",
  viewer: "Viewer",
};

export interface VisibilityOption {
  readonly id: SpaceVisibility;
  readonly label: string;
  readonly desc: string;
}

export const VISIBILITY_OPTIONS: readonly VisibilityOption[] = [
  {
    id: "public",
    label: "Public",
    desc: "Anyone on the internet can view models, docs, and channels.",
  },
  {
    id: "unlisted",
    label: "Unlisted",
    desc: "Accessible only via direct URL. Hidden from public explore feeds.",
  },
  {
    id: "internal",
    label: "Internal",
    desc: "Any authenticated member of the organization can view.",
  },
  {
    id: "private",
    label: "Private",
    desc: "Restricted strictly to explicitly added Space members.",
  },
];
