// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import { usePageTitle } from "../util/title";

type ArenaTab = "campaigns" | "adjudication" | "leaderboard";

interface FormalCert {
  gate1GlrSyntax: boolean;
  gate2QudvUnits: boolean;
  gate3SmtFeasibility: boolean;
  gate4DaeBalance: boolean;
  cadClearance?: boolean | undefined;
  diagnostics: string[];
}

interface CampaignSummary {
  id: number;
  slug: string;
  title: string;
  description: string;
  dialect: string;
  challengeType: string;
  targetAnnotations: number;
  completedAnnotations: number;
  consensusMinVotes: number;
  consensusAgreementThreshold: number;
  bountyPoints: number;
  status: string;
  createdBy: number;
  challengeCount: number;
  resolvedChallengeCount: number;
  needsAdjudicationCount: number;
  progressPct: number;
  createdAt: string;
  updatedAt: string;
}

interface SetDominanceInfo {
  hasFormalDominance: boolean;
  dominantCandidateId: number | null;
  alignedWithVotes: boolean;
  formalConflict: boolean;
}

interface AdjudicationCandidate {
  id: number;
  label: string;
  code: string;
  dialect: string;
  artifactId: number | null;
  mInit: number;
  tokenCount: number;
  formalCert: FormalCert | null;
  weightedVotes: number;
  voteCount: number;
}

interface AdjudicationItem {
  id: number;
  campaignId: number | null;
  challengeType: "pairwise_arena" | "fix_it_bounty" | "tolerance_labeling";
  dialect: string;
  title: string;
  prompt: string;
  deltaTTrigger: number | null;
  priorityScore: number;
  status: string;
  consensusStatus: string;
  skipCount: number;
  flagCount: number;
  candidates: AdjudicationCandidate[];
  voteSummary: {
    totalAnnotations: number;
    tieWeight: number;
    bothBadWeight: number;
    agreementRatio: number;
    setDominance: SetDominanceInfo;
  };
  createdAt: string;
  updatedAt: string;
}

interface LeaderboardEntry {
  rank: number;
  userId: number;
  username: string;
  displayName: string;
  domain: string;
  trustScore: number;
  verifiedFixes: number;
  totalAnnotations: number;
  honeypotHits: number;
  honeypotMisses: number;
  honeypotAccuracy: number | null;
  score: number;
}

interface ReleasePosttrainShard {
  shardId: string;
  dialect: string;
  mMin: number;
  mMax: number;
  exampleCount: number;
  byteSize: number;
}

interface ReleasePosttrainResult {
  success: boolean;
  recipeName: string;
  recipeVersion: string;
  datasetKind: string;
  includedChallengeCount: number;
  excludedHoneypotCount: number;
  excludedNonPublicCount: number;
  verifiedExamples: number;
  rejectedExamples: number;
  shards: ReleasePosttrainShard[];
  proof?: {
    type?: string;
    payloadSha256?: string;
    publicKeyMultibase?: string;
    verificationMethod?: string;
    created?: string;
    proofValue?: string;
  };
}

interface AdjudicationDraft {
  resolution: "winner" | "both_bad" | "archive";
  winningCandidateId: number | null;
  notes: string;
}

const DIALECT_FILTERS = [
  { value: "", label: "All Dialects" },
  { value: "modelica", label: "Modelica" },
  { value: "sysml2", label: "SysML v2" },
  { value: "scad", label: "OpenSCAD" },
  { value: "spice", label: "SPICE" },
  { value: "urdf", label: "URDF" },
  { value: "owl2", label: "OWL 2" },
  { value: "polyglot", label: "Polyglot" },
];

const PageShell = styled.div`
  background: transparent;
  color: var(--color-text-primary);
  padding: 20px 20px 56px;
`;

const Container = styled.div`
  max-width: 1120px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
`;

const HeroHeader = styled.header`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  border-radius: 12px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-card);
  box-shadow: var(--ms-shadow-card);
`;

const TabRow = styled.nav`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 12px;
`;

const TabButtons = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

const TabButton = styled.button<{ $active: boolean }>`
  padding: 7px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid ${(p) => (p.$active ? "var(--ms-brand)" : "var(--color-border-default)")};
  background: ${(p) => (p.$active ? "var(--ms-brand-soft)" : "var(--color-bg-surface)")};
  color: ${(p) => (p.$active ? "var(--ms-brand)" : "var(--color-text-secondary)")};
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;

  &:hover {
    color: ${(p) => (p.$active ? "var(--ms-brand)" : "var(--color-text-heading)")};
    border-color: ${(p) => (p.$active ? "var(--ms-brand)" : "var(--color-border-strong)")};
  }
`;

const Card = styled.section`
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-bg-card);
  box-shadow: var(--ms-shadow-card);
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const CampaignsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 16px;
`;

const ProgressTrack = styled.div`
  width: 100%;
  height: 8px;
  border-radius: 999px;
  background: var(--color-neutral-muted);
  overflow: hidden;
`;

const ProgressFill = styled.div<{ $pct: number }>`
  height: 100%;
  width: ${(p) => Math.max(0, Math.min(100, p.$pct))}%;
  border-radius: 999px;
  background: var(--ms-brand);
  transition: width 220ms ease;
`;

const Pill = styled.span<{ $tone?: "sky" | "emerald" | "amber" | "red" | "neutral" }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--font-mono);
  border: 1px solid
    ${(p) =>
      p.$tone === "emerald"
        ? "var(--status-verified-border)"
        : p.$tone === "amber"
          ? "var(--status-warning-border)"
          : p.$tone === "red"
            ? "var(--status-danger-border)"
            : p.$tone === "sky"
              ? "var(--color-accent-blue-border)"
              : "var(--color-border)"};
  background: ${(p) =>
    p.$tone === "emerald"
      ? "var(--status-verified-bg)"
      : p.$tone === "amber"
        ? "var(--status-warning-bg)"
        : p.$tone === "red"
          ? "var(--status-danger-bg)"
          : p.$tone === "sky"
            ? "var(--ms-brand-soft)"
            : "var(--color-badge-bg)"};
  color: ${(p) =>
    p.$tone === "emerald"
      ? "var(--status-verified-fg)"
      : p.$tone === "amber"
        ? "var(--status-warning-fg)"
        : p.$tone === "red"
          ? "var(--status-danger-fg)"
          : p.$tone === "sky"
            ? "var(--ms-brand)"
            : "var(--color-text-secondary)"};
`;

const ActionButton = styled.button<{ $primary?: boolean; $emerald?: boolean; $danger?: boolean; $active?: boolean }>`
  padding: 7px 13px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid
    ${(p) =>
      p.$danger
        ? "var(--status-danger-border)"
        : p.$emerald
          ? "var(--status-verified-border)"
          : p.$primary || p.$active
            ? "var(--ms-brand)"
            : "var(--color-border-default)"};
  background: ${(p) =>
    p.$primary
      ? "var(--ms-brand)"
      : p.$emerald
        ? "var(--status-verified-bg)"
        : p.$danger
          ? "var(--status-danger-bg)"
          : p.$active
            ? "var(--ms-brand-soft)"
            : "var(--color-bg-surface)"};
  color: ${(p) =>
    p.$primary
      ? "var(--ms-brand-contrast, #ffffff)"
      : p.$emerald
        ? "var(--status-verified-fg)"
        : p.$danger
          ? "var(--status-danger-fg)"
          : p.$active
            ? "var(--ms-brand)"
            : "var(--color-text-primary)"};
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    opacity 0.15s ease;
  &:hover:not(:disabled) {
    opacity: ${(p) => (p.$primary ? 0.92 : 1)};
    background: ${(p) =>
      p.$primary
        ? "var(--ms-brand)"
        : p.$emerald
          ? "var(--status-verified-bg)"
          : p.$danger
            ? "var(--status-danger-bg)"
            : "var(--surface-row-hover)"};
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const LinkButton = styled(Link)<{ $primary?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 13px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  text-decoration: none;
  border: 1px solid ${(p) => (p.$primary ? "var(--ms-brand)" : "var(--color-border-default)")};
  background: ${(p) => (p.$primary ? "var(--ms-brand)" : "var(--color-bg-surface)")};
  color: ${(p) => (p.$primary ? "var(--ms-brand-contrast, #ffffff)" : "var(--color-text-primary)")};
  &:hover {
    text-decoration: none;
    opacity: ${(p) => (p.$primary ? 0.92 : 1)};
    background: ${(p) => (p.$primary ? "var(--ms-brand)" : "var(--surface-row-hover)")};
  }
`;

const InputControl = styled.input`
  background: var(--color-canvas-inset);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 12.5px;
  &:focus {
    outline: none;
    border-color: var(--ms-brand);
  }
`;

const SelectControl = styled.select`
  background: var(--color-canvas-inset);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 12.5px;
  &:focus {
    outline: none;
    border-color: var(--ms-brand);
  }
`;

const CodePreview = styled.pre`
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-pre-bg);
  color: var(--color-text-primary);
  font-size: 11.5px;
  font-family: var(--font-mono);
  max-height: 180px;
  overflow: auto;
  white-space: pre;
`;

const LeaderboardTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  th,
  td {
    padding: 10px 12px;
    text-align: left;
    border-bottom: 1px solid var(--color-border);
    color: var(--color-text-primary);
  }
  th {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--color-text-muted);
    background: var(--color-table-header-bg);
  }
`;

function renderGateBadges(cert: FormalCert | null) {
  if (!cert) return <Pill $tone="neutral">No Cert</Pill>;
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      <Pill $tone={cert.gate1GlrSyntax ? "emerald" : "red"}>G1:GLR</Pill>
      <Pill $tone={cert.gate2QudvUnits ? "emerald" : "red"}>G2:SI</Pill>
      <Pill $tone={cert.gate3SmtFeasibility ? "emerald" : "red"}>G3:SMT</Pill>
      <Pill $tone={cert.gate4DaeBalance ? "emerald" : "red"}>G4:DAE</Pill>
      {cert.cadClearance !== undefined && <Pill $tone={cert.cadClearance ? "emerald" : "red"}>CAD</Pill>}
    </div>
  );
}

function renderSetDominanceBadge(dom: SetDominanceInfo, candidates: AdjudicationCandidate[]) {
  const domCand = dom.dominantCandidateId ? candidates.find((c) => c.id === dom.dominantCandidateId) : undefined;
  if (dom.formalConflict) {
    return (
      <Pill $tone="red">
        ⚠ Formal Set-Dominance Conflict (4-Gate Dominant: Candidate {domCand?.label ?? `#${dom.dominantCandidateId}`})
      </Pill>
    );
  }
  if (dom.hasFormalDominance && dom.alignedWithVotes) {
    return (
      <Pill $tone="emerald">
        ✓ Formal Set-Dominance Aligned (Candidate {domCand?.label ?? `#${dom.dominantCandidateId}`})
      </Pill>
    );
  }
  if (dom.hasFormalDominance) {
    return (
      <Pill $tone="sky">◆ Unique 4-Gate Dominant: Candidate {domCand?.label ?? `#${dom.dominantCandidateId}`}</Pill>
    );
  }
  return <Pill $tone="amber">Split / Tied — No Unique Formal Dominant</Pill>;
}

export const RlhfArenaHubPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get("tab");
  const activeTab: ArenaTab = initialTab === "adjudication" || initialTab === "leaderboard" ? initialTab : "campaigns";

  const [dialectFilter, setDialectFilter] = useState<string>(searchParams.get("dialect") ?? "");

  // Campaigns tab state
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState<boolean>(true);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);
  const [showNewCampaignForm, setShowNewCampaignForm] = useState<boolean>(false);
  const [newTitle, setNewTitle] = useState<string>("");
  const [newDescription, setNewDescription] = useState<string>("");
  const [newDialect, setNewDialect] = useState<string>("modelica");
  const [newChallengeType, setNewChallengeType] = useState<string>("pairwise_arena");
  const [newTargetAnnotations, setNewTargetAnnotations] = useState<number>(50);
  const [newBountyPoints, setNewBountyPoints] = useState<number>(25);
  const [newMinVotes, setNewMinVotes] = useState<number>(3);
  const [newAgreementThreshold, setNewAgreementThreshold] = useState<number>(0.75);
  const [creatingCampaign, setCreatingCampaign] = useState<boolean>(false);
  const [campaignBanner, setCampaignBanner] = useState<string | null>(null);

  // Release Signed Post-Train Snapshot state
  const [releasingCampaignId, setReleasingCampaignId] = useState<number | "global" | null>(null);
  const [releaseResult, setReleaseResult] = useState<ReleasePosttrainResult | null>(null);
  const [releaseError, setReleaseError] = useState<string | null>(null);

  // Adjudication tab state
  const [adjudicationItems, setAdjudicationItems] = useState<AdjudicationItem[]>([]);
  const [adjudicationLoading, setAdjudicationLoading] = useState<boolean>(false);
  const [adjudicationError, setAdjudicationError] = useState<string | null>(null);
  const [adjudicationDrafts, setAdjudicationDrafts] = useState<Record<number, AdjudicationDraft>>({});
  const [adjudicatingId, setAdjudicatingId] = useState<number | null>(null);
  const [adjudicationBanner, setAdjudicationBanner] = useState<string | null>(null);

  // Leaderboard tab state
  const [leaderboardDialect, setLeaderboardDialect] = useState<string>("all");
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState<boolean>(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);

  usePageTitle("RLHF Arena Hub");

  const setActiveTab = useCallback(
    (tab: ArenaTab) => {
      const next = new URLSearchParams(searchParams);
      next.set("tab", tab);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const loadCampaigns = useCallback(async () => {
    setCampaignsLoading(true);
    setCampaignsError(null);
    try {
      const qs = new URLSearchParams();
      if (dialectFilter) qs.set("dialect", dialectFilter);
      const res = await fetch(`/api/v1/rlhf/campaigns${qs.toString() ? `?${qs.toString()}` : ""}`, {
        credentials: "include",
      });
      const data = (await res.json().catch(() => ({}))) as { campaigns?: CampaignSummary[]; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setCampaigns(Array.isArray(data.campaigns) ? data.campaigns : []);
    } catch (e) {
      setCampaignsError(e instanceof Error ? e.message : String(e));
    } finally {
      setCampaignsLoading(false);
    }
  }, [dialectFilter]);

  const loadAdjudication = useCallback(async () => {
    setAdjudicationLoading(true);
    setAdjudicationError(null);
    try {
      const qs = new URLSearchParams();
      if (dialectFilter) qs.set("dialect", dialectFilter);
      const res = await fetch(`/api/v1/rlhf/adjudication${qs.toString() ? `?${qs.toString()}` : ""}`, {
        credentials: "include",
      });
      const data = (await res.json().catch(() => ({}))) as { challenges?: AdjudicationItem[]; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const items = Array.isArray(data.challenges) ? data.challenges : [];
      setAdjudicationItems(items);
      setAdjudicationDrafts((prev) => {
        const next = { ...prev };
        for (const item of items) {
          if (!next[item.id]) {
            const preferredWinner = item.voteSummary.setDominance.dominantCandidateId ?? item.candidates[0]?.id ?? null;
            next[item.id] = {
              resolution: "winner",
              winningCandidateId: preferredWinner,
              notes: "",
            };
          }
        }
        return next;
      });
    } catch (e) {
      setAdjudicationError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdjudicationLoading(false);
    }
  }, [dialectFilter]);

  const loadLeaderboard = useCallback(async () => {
    setLeaderboardLoading(true);
    setLeaderboardError(null);
    try {
      const qs = new URLSearchParams();
      if (leaderboardDialect && leaderboardDialect !== "all") {
        qs.set("dialect", leaderboardDialect);
      }
      const res = await fetch(`/api/v1/rlhf/leaderboard${qs.toString() ? `?${qs.toString()}` : ""}`, {
        credentials: "include",
      });
      const data = (await res.json().catch(() => ({}))) as { leaderboard?: LeaderboardEntry[]; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setLeaderboard(Array.isArray(data.leaderboard) ? data.leaderboard : []);
    } catch (e) {
      setLeaderboardError(e instanceof Error ? e.message : String(e));
    } finally {
      setLeaderboardLoading(false);
    }
  }, [leaderboardDialect]);

  useEffect(() => {
    void loadCampaigns();
    void loadAdjudication();
  }, [loadCampaigns, loadAdjudication]);

  useEffect(() => {
    if (activeTab === "leaderboard") {
      void loadLeaderboard();
    }
  }, [activeTab, loadLeaderboard]);

  const handleCreateCampaign = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newTitle.trim()) return;
      setCreatingCampaign(true);
      setCampaignBanner(null);
      try {
        const res = await fetch("/api/v1/rlhf/campaigns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            title: newTitle.trim(),
            description: newDescription.trim(),
            dialect: newDialect,
            challengeType: newChallengeType,
            targetAnnotations: Number(newTargetAnnotations) || 50,
            bountyPoints: Number(newBountyPoints) || 10,
            consensusMinVotes: Number(newMinVotes) || 3,
            consensusAgreementThreshold: Number(newAgreementThreshold) || 0.75,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { id?: number; error?: string };
        if (!res.ok) throw new Error(data.error || `Failed to create campaign (HTTP ${res.status})`);
        setCampaignBanner(`Created campaign #${data.id} ("${newTitle.trim()}").`);
        setNewTitle("");
        setNewDescription("");
        setShowNewCampaignForm(false);
        await loadCampaigns();
      } catch (err) {
        setCampaignBanner(err instanceof Error ? err.message : String(err));
      } finally {
        setCreatingCampaign(false);
      }
    },
    [
      newTitle,
      newDescription,
      newDialect,
      newChallengeType,
      newTargetAnnotations,
      newBountyPoints,
      newMinVotes,
      newAgreementThreshold,
      loadCampaigns,
    ],
  );

  const handleReleasePosttrain = useCallback(
    async (campaign?: CampaignSummary) => {
      setReleasingCampaignId(campaign ? campaign.id : "global");
      setReleaseError(null);
      setReleaseResult(null);
      try {
        const res = await fetch("/api/v1/recipes/release-posttrain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            recipeName: campaign ? `@ms/rlhf-${campaign.slug}` : "@ms/rlhf-posttrain",
            recipeVersion: "1.0.0",
            ...(campaign ? { campaignId: campaign.id } : {}),
            ...(campaign && campaign.dialect !== "polyglot"
              ? { dialect: campaign.dialect }
              : dialectFilter
                ? { dialect: dialectFilter }
                : {}),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as ReleasePosttrainResult & { error?: string };
        if (!res.ok) {
          throw new Error(data.error || `Post-train release failed (HTTP ${res.status})`);
        }
        setReleaseResult(data);
      } catch (err) {
        setReleaseError(err instanceof Error ? err.message : String(err));
      } finally {
        setReleasingCampaignId(null);
      }
    },
    [dialectFilter],
  );

  const updateAdjudicationDraft = useCallback((challengeId: number, patch: Partial<AdjudicationDraft>) => {
    setAdjudicationDrafts((prev) => {
      const cur = prev[challengeId] ?? { resolution: "winner", winningCandidateId: null, notes: "" };
      return { ...prev, [challengeId]: { ...cur, ...patch } };
    });
  }, []);

  const handleSubmitAdjudication = useCallback(
    async (item: AdjudicationItem) => {
      const draft = adjudicationDrafts[item.id] ?? {
        resolution: "winner" as const,
        winningCandidateId: item.candidates[0]?.id ?? null,
        notes: "",
      };
      setAdjudicatingId(item.id);
      setAdjudicationBanner(null);
      try {
        const res = await fetch(`/api/v1/rlhf/challenges/${item.id}/adjudicate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            resolution: draft.resolution,
            winningCandidateId: draft.resolution === "winner" ? draft.winningCandidateId : null,
            adjudicationNotes: draft.notes,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string; consensusStatus?: string };
        if (!res.ok) throw new Error(data.error || `Adjudication failed (HTTP ${res.status})`);
        setAdjudicationBanner(
          `Adjudicated challenge #${item.id} (${draft.resolution}${
            draft.resolution === "winner" && draft.winningCandidateId ? ` → candidate #${draft.winningCandidateId}` : ""
          }).`,
        );
        setAdjudicationItems((prev) => prev.filter((ch) => ch.id !== item.id));
        void loadCampaigns();
      } catch (err) {
        setAdjudicationBanner(err instanceof Error ? err.message : String(err));
      } finally {
        setAdjudicatingId(null);
      }
    },
    [adjudicationDrafts, loadCampaigns],
  );

  return (
    <PageShell>
      <Container>
        <HeroHeader>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--color-text-heading)" }}>
              RLHF Arena Hub
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--color-text-muted)" }}>
              Zonotope-prioritized human preference sprints, formal Set-Dominance adjudication, and signed{" "}
              <code>dataset-posttrain</code> releases.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <LinkButton
              to={`/annotate/queue${dialectFilter ? `?dialect=${encodeURIComponent(dialectFilter)}` : ""}`}
              $primary
            >
              Start Annotating Queue →
            </LinkButton>
            <ActionButton
              type="button"
              $emerald
              disabled={releasingCampaignId !== null}
              onClick={() => void handleReleasePosttrain()}
            >
              {releasingCampaignId === "global" ? "Signing Snapshot…" : "Release Signed Post-Train Snapshot"}
            </ActionButton>
          </div>
        </HeroHeader>

        {/* Signed Post-Train Release Feedback Banner */}
        {(releaseError || releaseResult) && (
          <Card
            style={{
              borderColor: releaseError ? "var(--status-danger-border)" : "var(--status-verified-border)",
              background: releaseError ? "var(--status-danger-bg)" : "var(--status-verified-bg)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <strong
                style={{
                  fontSize: 13,
                  color: releaseError ? "var(--status-danger-fg)" : "var(--status-verified-fg)",
                }}
              >
                {releaseError
                  ? "Post-Train Snapshot Release Error"
                  : `Signed Post-Train Release Created: ${releaseResult?.recipeName}@${releaseResult?.recipeVersion}`}
              </strong>
              <ActionButton
                type="button"
                onClick={() => {
                  setReleaseError(null);
                  setReleaseResult(null);
                }}
              >
                Dismiss
              </ActionButton>
            </div>
            {releaseError && <div style={{ fontSize: 12, color: "var(--status-danger-fg)" }}>{releaseError}</div>}
            {releaseResult && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  fontSize: 12,
                  fontFamily: "var(--font-mono)",
                }}
              >
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <Pill $tone="emerald">Ed25519 Signed ✓</Pill>
                  <Pill $tone="sky">Challenges: {releaseResult.includedChallengeCount}</Pill>
                  <Pill $tone="emerald">Verified: {releaseResult.verifiedExamples}</Pill>
                  <Pill $tone="neutral">Honeypots Excluded: {releaseResult.excludedHoneypotCount}</Pill>
                </div>
                {releaseResult.proof && (
                  <div style={{ color: "var(--color-text-secondary)", wordBreak: "break-all" }}>
                    <div>payloadSha256: {releaseResult.proof.payloadSha256 ?? "—"}</div>
                    <div>signerPubkey: {releaseResult.proof.publicKeyMultibase ?? "—"}</div>
                    {releaseResult.proof.verificationMethod && (
                      <div>verificationMethod: {releaseResult.proof.verificationMethod}</div>
                    )}
                  </div>
                )}
                {releaseResult.shards.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {releaseResult.shards.map((s) => (
                      <div key={s.shardId} style={{ color: "var(--ms-brand)" }}>
                        shard {s.shardId.slice(0, 16)}… · {s.dialect} · m_init∈[{s.mMin}, {s.mMax}] · {s.exampleCount}{" "}
                        examples ({s.byteSize} B)
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>
        )}

        {/* Navigation Tabs & Global Dialect Filter */}
        <TabRow>
          <TabButtons>
            <TabButton type="button" $active={activeTab === "campaigns"} onClick={() => setActiveTab("campaigns")}>
              Active Campaigns &amp; Sprints
              <Pill $tone={activeTab === "campaigns" ? "sky" : "neutral"}>{campaigns.length}</Pill>
            </TabButton>
            <TabButton
              type="button"
              $active={activeTab === "adjudication"}
              onClick={() => setActiveTab("adjudication")}
            >
              Adjudication Queue
              <Pill $tone={adjudicationItems.length > 0 ? "amber" : "neutral"}>{adjudicationItems.length}</Pill>
            </TabButton>
            <TabButton type="button" $active={activeTab === "leaderboard"} onClick={() => setActiveTab("leaderboard")}>
              Annotator Leaderboard
            </TabButton>
          </TabButtons>

          {activeTab !== "leaderboard" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "var(--ms-text-3, #8b949e)" }}>Dialect:</span>
              <SelectControl
                aria-label="Filter arena by dialect"
                value={dialectFilter}
                onChange={(e) => setDialectFilter(e.target.value)}
              >
                {DIALECT_FILTERS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </SelectControl>
            </div>
          )}
        </TabRow>

        {/* TAB 1: ACTIVE CAMPAIGNS & SPRINTS */}
        {activeTab === "campaigns" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontSize: 13, color: "var(--ms-text-3, #8b949e)" }}>
                Structured RLHF sprints track consensus progress and feed directly into signed{" "}
                <code>dataset-posttrain</code> snapshots.
              </div>
              <ActionButton
                type="button"
                $active={showNewCampaignForm}
                onClick={() => setShowNewCampaignForm((v) => !v)}
              >
                {showNewCampaignForm ? "Close Creator" : "+ New Campaign"}
              </ActionButton>
            </div>

            {campaignBanner && (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid rgba(56, 189, 248, 0.45)",
                  background: "rgba(56, 189, 248, 0.1)",
                  fontSize: 12,
                  color: "#7dd3fc",
                }}
              >
                {campaignBanner}
              </div>
            )}

            {showNewCampaignForm && (
              <Card as="form" onSubmit={(e) => void handleCreateCampaign(e)}>
                <strong style={{ fontSize: 14 }}>Create New Annotation Campaign Sprint</strong>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                    Title *
                    <InputControl
                      type="text"
                      required
                      placeholder="e.g., Modelica HVAC DAE Stability Sprint"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                    Dialect
                    <SelectControl value={newDialect} onChange={(e) => setNewDialect(e.target.value)}>
                      <option value="modelica">modelica</option>
                      <option value="sysml2">sysml2</option>
                      <option value="scad">scad</option>
                      <option value="spice">spice</option>
                      <option value="urdf">urdf</option>
                      <option value="owl2">owl2</option>
                      <option value="polyglot">polyglot</option>
                    </SelectControl>
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                    Challenge Type
                    <SelectControl value={newChallengeType} onChange={(e) => setNewChallengeType(e.target.value)}>
                      <option value="pairwise_arena">pairwise_arena</option>
                      <option value="fix_it_bounty">fix_it_bounty</option>
                      <option value="tolerance_labeling">tolerance_labeling</option>
                      <option value="mixed">mixed</option>
                    </SelectControl>
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                    Target Annotations
                    <InputControl
                      type="number"
                      min={1}
                      max={10000}
                      value={newTargetAnnotations}
                      onChange={(e) => setNewTargetAnnotations(Number(e.target.value))}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                    Bounty Points
                    <InputControl
                      type="number"
                      min={0}
                      max={10000}
                      value={newBountyPoints}
                      onChange={(e) => setNewBountyPoints(Number(e.target.value))}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                    Min Votes for Consensus
                    <InputControl
                      type="number"
                      min={1}
                      max={25}
                      value={newMinVotes}
                      onChange={(e) => setNewMinVotes(Number(e.target.value))}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                    Agreement Threshold (0.1–1.0)
                    <InputControl
                      type="number"
                      step={0.05}
                      min={0.1}
                      max={1}
                      value={newAgreementThreshold}
                      onChange={(e) => setNewAgreementThreshold(Number(e.target.value))}
                    />
                  </label>
                </div>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                  Description
                  <InputControl
                    type="text"
                    placeholder="Scope, formal verification expectations, and priority Δ_t guidance…"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                  />
                </label>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <ActionButton type="button" onClick={() => setShowNewCampaignForm(false)}>
                    Cancel
                  </ActionButton>
                  <ActionButton type="submit" $primary disabled={creatingCampaign || !newTitle.trim()}>
                    {creatingCampaign ? "Creating…" : "Create Campaign Sprint"}
                  </ActionButton>
                </div>
              </Card>
            )}

            {campaignsLoading ? (
              <Card>Loading RLHF campaigns…</Card>
            ) : campaignsError ? (
              <Card style={{ color: "#f87171" }}>Failed to load campaigns: {campaignsError}</Card>
            ) : campaigns.length === 0 ? (
              <Card>
                <strong style={{ fontSize: 14 }}>No active campaigns yet</strong>
                <span style={{ fontSize: 12, color: "var(--ms-text-3, #8b949e)" }}>
                  Create a campaign sprint above or jump directly into the global continuous queue.
                </span>
              </Card>
            ) : (
              <CampaignsGrid>
                {campaigns.map((camp) => (
                  <Card key={camp.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 700 }}>{camp.title}</div>
                        <div style={{ fontSize: 11, color: "var(--ms-text-3, #8b949e)", fontFamily: "monospace" }}>
                          /{camp.slug} · #{camp.id}
                        </div>
                      </div>
                      <Pill $tone="amber">+{camp.bountyPoints} pts</Pill>
                    </div>

                    {camp.description && (
                      <p style={{ margin: 0, fontSize: 12, color: "var(--ms-text-2, #c9d1d9)", lineHeight: 1.45 }}>
                        {camp.description}
                      </p>
                    )}

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      <Pill $tone="sky">{camp.dialect.toUpperCase()}</Pill>
                      <Pill $tone="neutral">{camp.challengeType}</Pill>
                      <Pill $tone={camp.status === "active" ? "emerald" : "neutral"}>{camp.status}</Pill>
                      {camp.needsAdjudicationCount > 0 && (
                        <Pill $tone="amber">{camp.needsAdjudicationCount} split</Pill>
                      )}
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 11,
                          fontFamily: "monospace",
                          color: "var(--ms-text-3, #8b949e)",
                        }}
                      >
                        <span>
                          Progress: {camp.completedAnnotations} / {camp.targetAnnotations} annotations
                        </span>
                        <span>{camp.progressPct.toFixed(1)}%</span>
                      </div>
                      <ProgressTrack>
                        <ProgressFill $pct={camp.progressPct} />
                      </ProgressTrack>
                      <div style={{ fontSize: 11, color: "var(--ms-text-3, #8b949e)" }}>
                        {camp.resolvedChallengeCount}/{camp.challengeCount} challenges resolved · min{" "}
                        {camp.consensusMinVotes} votes @ {Math.round(camp.consensusAgreementThreshold * 100)}%
                      </div>
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: "auto", paddingTop: 6 }}>
                      <LinkButton to={`/annotate/queue?campaignId=${camp.id}`} $primary>
                        Start Annotating Queue →
                      </LinkButton>
                      <ActionButton
                        type="button"
                        $emerald
                        disabled={releasingCampaignId !== null}
                        onClick={() => void handleReleasePosttrain(camp)}
                      >
                        {releasingCampaignId === camp.id ? "Signing…" : "Release Signed Post-Train Snapshot"}
                      </ActionButton>
                    </div>
                  </Card>
                ))}
              </CampaignsGrid>
            )}
          </div>
        )}

        {/* TAB 2: ADJUDICATION QUEUE */}
        {activeTab === "adjudication" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: 13, color: "var(--ms-text-3, #8b949e)" }}>
                Challenges flagged with split votes, ties, or Formal Set-Dominance conflicts awaiting binding reviewer
                resolution.
              </span>
              <ActionButton type="button" onClick={() => void loadAdjudication()}>
                Refresh Queue
              </ActionButton>
            </div>

            {adjudicationBanner && (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid rgba(52, 211, 153, 0.45)",
                  background: "rgba(52, 211, 153, 0.1)",
                  fontSize: 12,
                  color: "#6ee7b7",
                }}
              >
                {adjudicationBanner}
              </div>
            )}

            {adjudicationLoading ? (
              <Card>Loading adjudication queue…</Card>
            ) : adjudicationError ? (
              <Card style={{ color: "#f87171" }}>Failed to load adjudication queue: {adjudicationError}</Card>
            ) : adjudicationItems.length === 0 ? (
              <Card>
                <strong style={{ fontSize: 14 }}>Adjudication Queue Empty ✓</strong>
                <span style={{ fontSize: 12, color: "var(--ms-text-3, #8b949e)" }}>
                  No split or formal-conflict challenges currently require manual adjudication.
                </span>
              </Card>
            ) : (
              adjudicationItems.map((item) => {
                const draft = adjudicationDrafts[item.id] ?? {
                  resolution: "winner" as const,
                  winningCandidateId:
                    item.voteSummary.setDominance.dominantCandidateId ?? item.candidates[0]?.id ?? null,
                  notes: "",
                };

                return (
                  <Card key={item.id}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: 12,
                        flexWrap: "wrap",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: 15,
                            fontWeight: 700,
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            flexWrap: "wrap",
                          }}
                        >
                          <span>#{item.id}</span>
                          <span>{item.title}</span>
                          <Pill $tone="sky">{item.dialect.toUpperCase()}</Pill>
                          <Pill $tone="neutral">{item.challengeType}</Pill>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--ms-text-3, #8b949e)", marginTop: 4 }}>
                          {item.prompt}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                        {renderSetDominanceBadge(item.voteSummary.setDominance, item.candidates)}
                        <div style={{ fontSize: 11, fontFamily: "monospace", color: "var(--ms-text-3, #8b949e)" }}>
                          votes={item.voteSummary.totalAnnotations} · agreement=
                          {(item.voteSummary.agreementRatio * 100).toFixed(1)}% · tieW={item.voteSummary.tieWeight} ·
                          badW={item.voteSummary.bothBadWeight}
                          {item.deltaTTrigger !== null ? ` · Δ_t=${item.deltaTTrigger.toFixed(2)}` : ""}
                        </div>
                      </div>
                    </div>

                    {item.candidates.length > 0 && (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                          gap: 12,
                        }}
                      >
                        {item.candidates.map((cand) => {
                          const isFormalDom = item.voteSummary.setDominance.dominantCandidateId === cand.id;
                          const isChosenWinner = draft.resolution === "winner" && draft.winningCandidateId === cand.id;
                          return (
                            <div
                              key={cand.id}
                              style={{
                                border: `1px solid ${
                                  isChosenWinner
                                    ? "#38bdf8"
                                    : isFormalDom
                                      ? "rgba(52, 211, 153, 0.5)"
                                      : "var(--ms-border, #30363d)"
                                }`,
                                borderRadius: 10,
                                padding: 10,
                                background: "rgba(255, 255, 255, 0.02)",
                                display: "flex",
                                flexDirection: "column",
                                gap: 8,
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  gap: 6,
                                  flexWrap: "wrap",
                                }}
                              >
                                <strong style={{ fontSize: 12 }}>
                                  Candidate {cand.label} (m_init={cand.mInit})
                                </strong>
                                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                                  {isFormalDom && <Pill $tone="emerald">4-Gate Dominant</Pill>}
                                  <Pill $tone="sky">
                                    {cand.weightedVotes}w ({cand.voteCount} votes)
                                  </Pill>
                                </div>
                              </div>
                              {renderGateBadges(cand.formalCert)}
                              <CodePreview>{cand.code}</CodePreview>
                              <ActionButton
                                type="button"
                                $active={isChosenWinner}
                                onClick={() =>
                                  updateAdjudicationDraft(item.id, {
                                    resolution: "winner",
                                    winningCandidateId: cand.id,
                                  })
                                }
                              >
                                {isChosenWinner
                                  ? `✓ Selected Candidate ${cand.label}`
                                  : `Select Candidate ${cand.label}`}
                              </ActionButton>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Inline Binding Resolution Bar */}
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        paddingTop: 8,
                        borderTop: "1px solid var(--ms-bg-elevated, #21262d)",
                      }}
                    >
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, flex: 1 }}>
                        <ActionButton
                          type="button"
                          $danger={draft.resolution === "both_bad"}
                          onClick={() =>
                            updateAdjudicationDraft(item.id, {
                              resolution: "both_bad",
                              winningCandidateId: null,
                            })
                          }
                        >
                          Mark Both Invalid
                        </ActionButton>
                        <ActionButton
                          type="button"
                          $active={draft.resolution === "archive"}
                          onClick={() =>
                            updateAdjudicationDraft(item.id, {
                              resolution: "archive",
                              winningCandidateId: null,
                            })
                          }
                        >
                          Archive
                        </ActionButton>
                        <InputControl
                          type="text"
                          style={{ flex: 1, minWidth: 220 }}
                          placeholder="Binding adjudication rationale (recorded in audit trail)…"
                          value={draft.notes}
                          onChange={(e) => updateAdjudicationDraft(item.id, { notes: e.target.value })}
                        />
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <LinkButton to={`/annotate/${item.id}`}>Open Full Inspector</LinkButton>
                        <ActionButton
                          type="button"
                          $primary
                          disabled={
                            adjudicatingId === item.id ||
                            (item.challengeType === "pairwise_arena" &&
                              draft.resolution === "winner" &&
                              !draft.winningCandidateId)
                          }
                          onClick={() => void handleSubmitAdjudication(item)}
                        >
                          {adjudicatingId === item.id ? "Resolving…" : "Submit Binding Adjudication"}
                        </ActionButton>
                      </div>
                    </div>
                  </Card>
                );
              })
            )}
          </div>
        )}

        {/* TAB 3: ANNOTATOR LEADERBOARD */}
        {activeTab === "leaderboard" && (
          <Card>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <div>
                <strong style={{ fontSize: 15 }}>Domain Annotator Leaderboard</strong>
                <div style={{ fontSize: 12, color: "var(--ms-text-3, #8b949e)" }}>
                  Ranked by domain trust score, verified 4-gate Fix-It repairs, honeypot calibration accuracy, and total
                  annotations.
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "var(--ms-text-3, #8b949e)" }}>Dialect:</span>
                <SelectControl
                  aria-label="Filter leaderboard by dialect"
                  value={leaderboardDialect}
                  onChange={(e) => setLeaderboardDialect(e.target.value)}
                >
                  <option value="all">All Dialects</option>
                  <option value="modelica">Modelica</option>
                  <option value="sysml2">SysML v2</option>
                  <option value="scad">OpenSCAD</option>
                  <option value="spice">SPICE</option>
                  <option value="urdf">URDF</option>
                  <option value="owl2">OWL 2</option>
                </SelectControl>
              </div>
            </div>

            {leaderboardLoading ? (
              <div style={{ fontSize: 13, color: "var(--ms-text-3, #8b949e)", padding: 12 }}>Loading leaderboard…</div>
            ) : leaderboardError ? (
              <div style={{ fontSize: 13, color: "#f87171", padding: 12 }}>
                Failed to load leaderboard: {leaderboardError}
              </div>
            ) : leaderboard.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--ms-text-3, #8b949e)", padding: 12 }}>
                No annotator reputation records yet for this dialect. Complete tasks in the{" "}
                <Link to="/annotate/queue" style={{ color: "var(--ms-brand)", fontWeight: 600 }}>
                  Continuous Annotation Queue
                </Link>{" "}
                to appear here.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <LeaderboardTable>
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Annotator</th>
                      <th>Domain</th>
                      <th>Domain Trust Score</th>
                      <th>Verified Fixes</th>
                      <th>Honeypot Accuracy</th>
                      <th>Total Annotations</th>
                      <th>Composite Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((row) => (
                      <tr key={`${row.userId}-${row.domain}`}>
                        <td style={{ fontFamily: "monospace", fontWeight: 700 }}>
                          {row.rank <= 3 ? (
                            <Pill $tone={row.rank === 1 ? "amber" : row.rank === 2 ? "sky" : "emerald"}>
                              #{row.rank}
                            </Pill>
                          ) : (
                            `#${row.rank}`
                          )}
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{row.displayName}</div>
                          <div style={{ fontSize: 11, color: "var(--ms-text-3, #8b949e)", fontFamily: "monospace" }}>
                            @{row.username}
                          </div>
                        </td>
                        <td>
                          <Pill $tone="neutral">{row.domain}</Pill>
                        </td>
                        <td style={{ fontFamily: "monospace", fontWeight: 600, color: "#38bdf8" }}>
                          {row.trustScore.toFixed(3)}
                        </td>
                        <td style={{ fontFamily: "monospace", color: "#34d399", fontWeight: 600 }}>
                          {row.verifiedFixes}
                        </td>
                        <td style={{ fontFamily: "monospace" }}>
                          {row.honeypotAccuracy !== null ? (
                            <Pill $tone={row.honeypotAccuracy >= 0.8 ? "emerald" : "amber"}>
                              {(row.honeypotAccuracy * 100).toFixed(1)}% ({row.honeypotHits}/
                              {row.honeypotHits + row.honeypotMisses})
                            </Pill>
                          ) : (
                            <span style={{ color: "var(--ms-text-3, #8b949e)" }}>—</span>
                          )}
                        </td>
                        <td style={{ fontFamily: "monospace" }}>{row.totalAnnotations}</td>
                        <td style={{ fontFamily: "monospace", fontWeight: 700 }}>{row.score.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </LeaderboardTable>
              </div>
            )}
          </Card>
        )}
      </Container>
    </PageShell>
  );
};

export default RlhfArenaHubPage;
