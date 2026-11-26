// SPDX-License-Identifier: AGPL-3.0-or-later

import AnsatzEditor from "@modelscript/editor/workbench/AnsatzEditor";
import CodeEditor from "@modelscript/editor/workbench/Code";
import type {
  AnsatzHypergraphTokenOverride,
  AnsatzRelationalHypergraphRecord,
  AnsatzRelationalTokenSpan,
} from "@modelscript/editor/workbench/util/lsp-bridge";
import {
  applyWorstCaseCornerToSource,
  type AppliedCornerMutation,
  type WorstCaseCornerInput,
} from "@modelscript/editor/workbench/util/worst-case-replay";
import type {
  ApiHypergraphOverride,
  LinearConstraintSpec,
} from "@modelscript/editor/workbench/util/zonotope-workbench-state";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import { usePageTitle } from "../util/title";

interface FormalCert {
  gate1GlrSyntax: boolean;
  gate2QudvUnits: boolean;
  gate3SmtFeasibility: boolean;
  gate4DaeBalance: boolean;
  cadClearance?: boolean | undefined;
  diagnostics: string[];
}

interface BlindCandidateDetail {
  id: number;
  slotIndex: number;
  blindLabel: string;
  label: string;
  code: string;
  dialect: string;
  artifactId: number | null;
  mInit: number;
  tokenCount: number;
  formalCert: FormalCert | null;
  hypergraph?: AnsatzRelationalHypergraphRecord | undefined;
}

interface QueueChallengeDetail {
  id: number;
  postId: number | null;
  campaignId: number | null;
  createdBy: number;
  challengeType: "pairwise_arena" | "fix_it_bounty" | "tolerance_labeling";
  dialect: string;
  title: string;
  prompt: string;
  sourceCode: string | null;
  sourceHypergraph: AnsatzRelationalHypergraphRecord | null;
  deltaTTrigger: number | null;
  priorityScore: number;
  consensusStatus: string | null;
  status: string;
  skipCount: number;
  flagCount: number;
  blindMode: boolean;
  presentationOrder: number[];
  candidates: BlindCandidateDetail[];
  createdAt: string;
}

interface QueueNextResponse {
  challenge: QueueChallengeDetail | null;
  presentationOrder: number[];
  remainingCount: number;
  error?: string;
}

const DIALECT_OPTIONS = [
  { value: "", label: "All Dialects" },
  { value: "modelica", label: "Modelica" },
  { value: "sysml2", label: "SysML v2" },
  { value: "scad", label: "OpenSCAD" },
  { value: "spice", label: "SPICE" },
  { value: "urdf", label: "URDF" },
  { value: "owl2", label: "OWL 2" },
];

const CHALLENGE_TYPE_OPTIONS = [
  { value: "", label: "All Types" },
  { value: "pairwise_arena", label: "Pairwise Arena" },
  { value: "fix_it_bounty", label: "Fix-It Bounty" },
  { value: "tolerance_labeling", label: "Tolerance Labeling" },
];

const RATIONALE_TAGS = [
  "better-manufacturability",
  "tighter-tolerance",
  "cleaner-dae",
  "si-unit-rigor",
  "safer-bounds",
  "idiomatic-structure",
];

const PageRoot = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  background: var(--ms-bg-canvas, #0d1117);
  color: var(--ms-text-1, #e6edf3);
  overflow: hidden;
`;

const HudBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--ms-border-default, #30363d);
  background: linear-gradient(90deg, rgba(14, 165, 233, 0.12), rgba(99, 102, 241, 0.1));
  font-size: 12px;
`;

const HudMetrics = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-family: monospace;
`;

const HudPill = styled.span<{ $tone?: "sky" | "emerald" | "amber" | "neutral" }>`
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  border: 1px solid
    ${(p) =>
      p.$tone === "emerald"
        ? "rgba(52, 211, 153, 0.45)"
        : p.$tone === "amber"
          ? "rgba(251, 191, 36, 0.45)"
          : p.$tone === "sky"
            ? "rgba(56, 189, 248, 0.5)"
            : "rgba(139, 148, 158, 0.35)"};
  background: ${(p) =>
    p.$tone === "emerald"
      ? "rgba(52, 211, 153, 0.14)"
      : p.$tone === "amber"
        ? "rgba(251, 191, 36, 0.14)"
        : p.$tone === "sky"
          ? "rgba(56, 189, 248, 0.14)"
          : "rgba(139, 148, 158, 0.12)"};
  color: ${(p) =>
    p.$tone === "emerald" ? "#34d399" : p.$tone === "amber" ? "#fbbf24" : p.$tone === "sky" ? "#38bdf8" : "#c9d1d9"};
`;

const TopBar = styled.header`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--ms-border-default, #30363d);
  background: var(--ms-surface-panel, #161b22);
`;

const SplitGrid = styled.div<{ $columns: number }>`
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(${(p) => p.$columns}, minmax(0, 1fr));
  gap: 1px;
  background: var(--ms-border-default, #30363d);
`;

const Pane = styled.section<{ $selected?: boolean }>`
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--ms-bg-canvas, #0d1117);
  outline: ${(p) => (p.$selected ? "2px solid #38bdf8" : "none")};
  outline-offset: -2px;
`;

const PaneHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--ms-border-default, #30363d);
  background: rgba(255, 255, 255, 0.02);
  font-size: 12px;
`;

const QuickTokenPillBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid rgba(56, 189, 248, 0.4);
  background: rgba(56, 189, 248, 0.1);
  color: #e0f2fe;
  font-size: 12px;
`;

const MutationStrip = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-bottom: 1px solid rgba(251, 191, 36, 0.35);
  background: rgba(251, 191, 36, 0.09);
  color: #fde68a;
  font-size: 11px;
  font-family: monospace;
`;

const GateBadge = styled.span<{ $pass: boolean }>`
  font-size: 11px;
  font-family: monospace;
  padding: 2px 6px;
  border-radius: 6px;
  background: ${(p) => (p.$pass ? "rgba(52, 211, 153, 0.14)" : "rgba(248, 113, 113, 0.16)")};
  color: ${(p) => (p.$pass ? "#34d399" : "#f87171")};
  border: 1px solid ${(p) => (p.$pass ? "rgba(52, 211, 153, 0.4)" : "rgba(248, 113, 113, 0.45)")};
`;

const FooterBar = styled.footer`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 16px;
  border-top: 1px solid var(--ms-border-default, #30363d);
  background: var(--ms-surface-panel, #161b22);
`;

const ActionButton = styled.button<{ $primary?: boolean; $active?: boolean; $danger?: boolean; $amber?: boolean }>`
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid
    ${(p) =>
      p.$danger
        ? "rgba(248, 113, 113, 0.55)"
        : p.$amber
          ? "rgba(251, 191, 36, 0.65)"
          : p.$active || p.$primary
            ? "#38bdf8"
            : "#30363d"};
  background: ${(p) =>
    p.$primary
      ? "linear-gradient(135deg, #0284c7, #6366f1)"
      : p.$danger
        ? "rgba(248, 113, 113, 0.16)"
        : p.$amber
          ? "rgba(251, 191, 36, 0.18)"
          : p.$active
            ? "rgba(56, 189, 248, 0.18)"
            : "#21262d"};
  color: ${(p) => (p.$danger ? "#fca5a5" : p.$amber ? "#fde68a" : "#f8fafc")};
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const SelectControl = styled.select`
  background: #0d1117;
  color: #e6edf3;
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 11px;
`;

const KbdHint = styled.kbd`
  display: inline-block;
  padding: 1px 5px;
  margin-left: 4px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: rgba(0, 0, 0, 0.28);
  font-family: monospace;
  font-size: 10px;
  font-weight: 600;
`;

const EmptyCard = styled.div`
  margin: auto;
  max-width: 520px;
  padding: 28px;
  border-radius: 12px;
  border: 1px solid #30363d;
  background: #161b22;
  display: flex;
  flex-direction: column;
  gap: 12px;
  text-align: center;
`;

function isPunctuationOnlyToken(span: AnsatzRelationalTokenSpan): boolean {
  const trimmed = span.text.trim();
  if (!trimmed) return true;
  if (span.symbolName) return false;
  return /^[^\p{L}\p{N}_]+$/u.test(trimmed);
}

function normalizeRelSign(sign: number): -1 | 0 | 1 {
  if (sign < 0) return -1;
  if (sign > 0) return 1;
  return 0;
}

function mergeVisualOverrides(
  prev: AnsatzHypergraphTokenOverride[],
  incoming: ApiHypergraphOverride[],
): AnsatzHypergraphTokenOverride[] {
  if (incoming.length === 0) return prev;
  const next = [...prev];
  let changed = false;

  for (const item of incoming) {
    const normalized: AnsatzHypergraphTokenOverride = {
      groupId: item.groupId,
      relTypeId: item.relTypeId,
      relSign: normalizeRelSign(item.relSign),
      ...(item.tokenIndex !== undefined ? { tokenIndex: item.tokenIndex } : {}),
      ...(item.symbolName !== undefined && item.symbolName.length > 0 ? { symbolName: item.symbolName } : {}),
    };

    const matchIdx = next.findIndex((existing) => {
      if (normalized.tokenIndex !== undefined && existing.tokenIndex !== undefined) {
        return existing.tokenIndex === normalized.tokenIndex;
      }
      if (
        normalized.tokenIndex === undefined &&
        existing.tokenIndex === undefined &&
        normalized.symbolName !== undefined &&
        existing.symbolName !== undefined
      ) {
        return existing.symbolName === normalized.symbolName;
      }
      return false;
    });

    if (matchIdx === -1) {
      next.push(normalized);
      changed = true;
    } else {
      const existing = next[matchIdx]!;
      const merged: AnsatzHypergraphTokenOverride = { ...existing, ...normalized };
      if (
        existing.groupId !== merged.groupId ||
        existing.relTypeId !== merged.relTypeId ||
        existing.relSign !== merged.relSign ||
        existing.symbolName !== merged.symbolName ||
        existing.tokenIndex !== merged.tokenIndex
      ) {
        next[matchIdx] = merged;
        changed = true;
      }
    }
  }

  return changed ? next : prev;
}

function renderGateBadges(cert: FormalCert | null) {
  if (!cert) return null;
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      <GateBadge $pass={cert.gate1GlrSyntax}>G1:GLR</GateBadge>
      <GateBadge $pass={cert.gate2QudvUnits}>G2:SI</GateBadge>
      <GateBadge $pass={cert.gate3SmtFeasibility}>G3:SMT</GateBadge>
      <GateBadge $pass={cert.gate4DaeBalance}>G4:DAE</GateBadge>
      {cert.cadClearance !== undefined && <GateBadge $pass={cert.cadClearance}>CAD</GateBadge>}
    </div>
  );
}

/**
 * Extracts a deterministic adversarial worst-case zonotope corner (ξ* in {-1, +1}^m)
 * from a candidate's compiled 4-column relational hypergraph (with a regex fallback
 * for standalone parameter assignments when hypergraph metadata is sparse).
 */
function buildWorstCaseCornerForCandidate(cand: BlindCandidateDetail): WorstCaseCornerInput[] {
  const entries: WorstCaseCornerInput[] = [];
  const seen = new Set<string>();

  if (cand.hypergraph) {
    const signByGroup = new Map<number, 1 | -1>();
    for (const span of cand.hypergraph.spans) {
      if (span.groupId > 0 && !signByGroup.has(span.groupId)) {
        signByGroup.set(span.groupId, span.relSign < 0 ? -1 : 1);
      }
    }

    for (const g of cand.hypergraph.groups) {
      if (g.groupId <= 0) continue;
      const sym = (g.symbolName ?? g.label).trim();
      if (!sym || seen.has(sym)) continue;
      seen.add(sym);
      const inferredSign: 1 | -1 = signByGroup.get(g.groupId) ?? (g.groupId % 2 === 0 ? -1 : 1);
      entries.push({
        symbolName: sym,
        label: g.label,
        xiSign: inferredSign,
      });
    }
  }

  // Fallback scan for numeric assignments so toggling ξ* visibly perturbs parameters even if groups lack symbols
  const assignRe =
    /\b([A-Za-z_][A-Za-z0-9_]*)\s*(?:\([^)]*\)\s*)?(?::[^=;\n]+)?(?::=|=)\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)/g;
  let m: RegExpExecArray | null;
  let fallbackIdx = 0;
  while ((m = assignRe.exec(cand.code)) !== null && entries.length < 16) {
    const sym = m[1];
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    entries.push({
      symbolName: sym,
      label: sym,
      xiSign: fallbackIdx % 2 === 0 ? 1 : -1,
    });
    fallbackIdx++;
  }

  return entries;
}

export const RlhfQueuePage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const dialectFilter = searchParams.get("dialect") ?? "";
  const campaignIdFilter = searchParams.get("campaignId") ?? "";
  const challengeTypeFilter = searchParams.get("challengeType") ?? "";

  const [challenge, setChallenge] = useState<QueueChallengeDetail | null>(null);
  const [remainingCount, setRemainingCount] = useState<number>(0);
  const [reviewedCount, setReviewedCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [authRequired, setAuthRequired] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // ξ* Worst-Case Corner perturbation toggle
  const [worstCaseActive, setWorstCaseActive] = useState<boolean>(false);
  const [deltaFraction, setDeltaFraction] = useState<number>(0.05);
  const [syncCameras, setSyncCameras] = useState<boolean>(true);

  // Pairwise selection state
  const [selectedCandidateId, setSelectedCandidateId] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<"candidate" | "tie" | "both_bad">("candidate");
  const [rationaleTags, setRationaleTags] = useState<string[]>([]);
  const [notes, setNotes] = useState<string>("");

  // Fix-It bounty state
  const [fixCode, setFixCode] = useState<string>("");

  // Tolerance labeling state
  const [overrides, setOverrides] = useState<AnsatzHypergraphTokenOverride[]>([]);
  const [visualConstraints, setVisualConstraints] = useState<LinearConstraintSpec[]>([]);
  const [liveHypergraph, setLiveHypergraph] = useState<AnsatzRelationalHypergraphRecord | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null);
  const [clickedToken, setClickedToken] = useState<{
    span: AnsatzRelationalTokenSpan;
    baseGroupId: number;
  } | null>(null);

  const requestSeqRef = useRef(0);

  usePageTitle(challenge ? `Queue (${remainingCount} left): ${challenge.title}` : "RLHF Continuous Annotation Queue");

  const resetAnnotationDraft = useCallback((nextChallenge: QueueChallengeDetail | null) => {
    setSelectedCandidateId(null);
    setOutcome("candidate");
    setRationaleTags([]);
    setNotes("");
    setOverrides([]);
    setVisualConstraints([]);
    setActiveGroupId(null);
    setClickedToken(null);
    setFixCode(nextChallenge?.sourceCode ?? "");
    setLiveHypergraph(nextChallenge?.sourceHypergraph ?? null);
  }, []);

  const fetchNextChallenge = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    setAuthRequired(false);

    const qs = new URLSearchParams();
    if (dialectFilter.trim()) qs.set("dialect", dialectFilter.trim());
    if (campaignIdFilter.trim()) qs.set("campaignId", campaignIdFilter.trim());
    if (challengeTypeFilter.trim()) qs.set("challengeType", challengeTypeFilter.trim());

    try {
      const url = `/api/v1/rlhf/queue/next${qs.toString() ? `?${qs.toString()}` : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (seq !== requestSeqRef.current) return;

      if (res.status === 401) {
        setAuthRequired(true);
        setChallenge(null);
        setRemainingCount(0);
        return;
      }

      const data = (await res.json().catch(() => ({}))) as QueueNextResponse;
      if (!res.ok) {
        throw new Error(data.error || `Failed to load queue (HTTP ${res.status})`);
      }

      const nextChallenge = data.challenge ?? null;
      setChallenge(nextChallenge);
      setRemainingCount(typeof data.remainingCount === "number" ? data.remainingCount : nextChallenge ? 1 : 0);
      resetAnnotationDraft(nextChallenge);
    } catch (e) {
      if (seq !== requestSeqRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }, [dialectFilter, campaignIdFilter, challengeTypeFilter, resetAnnotationDraft]);

  useEffect(() => {
    void fetchNextChallenge();
  }, [fetchNextChallenge]);

  const updateFilter = useCallback(
    (key: "dialect" | "campaignId" | "challengeType", value: string) => {
      const next = new URLSearchParams(searchParams);
      if (value.trim()) {
        next.set(key, value.trim());
      } else {
        next.delete(key);
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const toggleTag = useCallback((tag: string) => {
    setRationaleTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }, []);

  const upsertOverride = useCallback((symbolName: string, patch: Partial<AnsatzHypergraphTokenOverride>) => {
    setOverrides((prev) => {
      const idx = prev.findIndex((o) => o.symbolName === symbolName);
      if (idx === -1) return [...prev, { symbolName, ...patch }];
      const next = [...prev];
      next[idx] = { ...next[idx]!, ...patch };
      return next;
    });
  }, []);

  const handleZonotopeOverridesChange = useCallback(
    (visualOverrides: ApiHypergraphOverride[], nextConstraints: LinearConstraintSpec[]) => {
      if (visualOverrides.length > 0) {
        setOverrides((prev) => mergeVisualOverrides(prev, visualOverrides));
      }
      setVisualConstraints(nextConstraints);
    },
    [],
  );

  // Precompute ξ* worst-case corner replayed sources for all blind candidates
  const candidateReplayMap = useMemo(() => {
    const map = new Map<number, { source: string; mutations: AppliedCornerMutation[] }>();
    if (!challenge) return map;
    for (const cand of challenge.candidates) {
      if (!worstCaseActive) {
        map.set(cand.id, { source: cand.code, mutations: [] });
      } else {
        const corner = buildWorstCaseCornerForCandidate(cand);
        const replayed = applyWorstCaseCornerToSource(cand.code, corner, deltaFraction);
        map.set(cand.id, {
          source: replayed.perturbedSource,
          mutations: replayed.appliedMutations,
        });
      }
    }
    return map;
  }, [challenge, worstCaseActive, deltaFraction]);

  const canSubmit = useMemo(() => {
    if (!challenge || submitting || loading) return false;
    if (challenge.challengeType === "pairwise_arena") {
      if (outcome === "candidate") return selectedCandidateId !== null;
      return true;
    }
    if (challenge.challengeType === "fix_it_bounty") {
      return fixCode.trim().length > 0;
    }
    return true;
  }, [challenge, submitting, loading, outcome, selectedCandidateId, fixCode]);

  const handleSubmitAndAdvance = useCallback(async () => {
    if (!challenge || !canSubmit) return;
    setSubmitting(true);
    setStatusMessage(null);
    try {
      const constraintNote =
        visualConstraints.length > 0
          ? `[Zonotope constraints: ${visualConstraints.map((c) => c.expression).join("; ")}]`
          : "";
      const effectiveNotes = [notes.trim(), constraintNote].filter(Boolean).join(" ").trim();
      const payload =
        challenge.challengeType === "pairwise_arena"
          ? {
              preferredCandidateId: outcome === "candidate" ? selectedCandidateId : null,
              preferenceOutcome: outcome,
              rationaleTags,
              notes: effectiveNotes,
              ...(overrides.length > 0 ? { hypergraphOverrides: overrides } : {}),
            }
          : challenge.challengeType === "fix_it_bounty"
            ? {
                fixedCode: fixCode,
                rationaleTags,
                notes: effectiveNotes,
                ...(overrides.length > 0 ? { hypergraphOverrides: overrides } : {}),
              }
            : { hypergraphOverrides: overrides, rationaleTags, notes: effectiveNotes };

      const res = await fetch(`/api/v1/rlhf/challenges/${challenge.id}/annotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        appliedWeight?: number;
        updatedMInit?: number;
        formalCert?: { diagnostics?: string[] };
      };
      if (!res.ok) {
        const diagList = Array.isArray(data.formalCert?.diagnostics)
          ? ` (${data.formalCert.diagnostics.join(" ")})`
          : "";
        throw new Error((data.error || `Submission failed (HTTP ${res.status})`) + diagList);
      }

      setReviewedCount((prev) => prev + 1);
      setStatusMessage(
        `Submitted #${challenge.id} (weight=${data.appliedWeight ?? "1.0"}${
          data.updatedMInit !== undefined ? `, m_init=${data.updatedMInit}` : ""
        }) — advancing queue…`,
      );
      await fetchNextChallenge();
    } catch (e) {
      setStatusMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }, [
    challenge,
    canSubmit,
    outcome,
    selectedCandidateId,
    rationaleTags,
    notes,
    fixCode,
    overrides,
    visualConstraints,
    fetchNextChallenge,
  ]);

  const handleSkipOrFlag = useCallback(
    async (isFlag: boolean, reason = "") => {
      if (!challenge || submitting || loading) return;
      setSubmitting(true);
      setStatusMessage(null);
      try {
        const res = await fetch(`/api/v1/rlhf/challenges/${challenge.id}/skip-or-flag`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            isFlag,
            reason: reason || (isFlag ? "flagged_in_queue" : "skipped_in_queue"),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          throw new Error(data.error || `Skip/flag failed (HTTP ${res.status})`);
        }
        setStatusMessage(
          isFlag
            ? `Flagged challenge #${challenge.id} — loading next…`
            : `Skipped challenge #${challenge.id} — loading next…`,
        );
        await fetchNextChallenge();
      } catch (e) {
        setStatusMessage(e instanceof Error ? e.message : String(e));
      } finally {
        setSubmitting(false);
      }
    },
    [challenge, submitting, loading, fetchNextChallenge],
  );

  // Global keyboard shortcuts (disabled when typing in an input/textarea/select/contentEditable)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const activeEl = document.activeElement as HTMLElement | null;
      if (
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.tagName === "SELECT" ||
          activeEl.isContentEditable)
      ) {
        return;
      }
      if (!challenge || submitting || loading) return;

      const key = e.key.toLowerCase();
      if (challenge.challengeType === "pairwise_arena") {
        if (key === "1" && challenge.candidates[0]) {
          e.preventDefault();
          setOutcome("candidate");
          setSelectedCandidateId(challenge.candidates[0].id);
          return;
        }
        if (key === "2" && challenge.candidates[1]) {
          e.preventDefault();
          setOutcome("candidate");
          setSelectedCandidateId(challenge.candidates[1].id);
          return;
        }
        if (key === "t") {
          e.preventDefault();
          setOutcome("tie");
          setSelectedCandidateId(null);
          return;
        }
        if (key === "b") {
          e.preventDefault();
          setOutcome("both_bad");
          setSelectedCandidateId(null);
          return;
        }
      }

      if (key === "s") {
        e.preventDefault();
        void handleSkipOrFlag(false, "keyboard_skip");
        return;
      }

      if (e.key === "Enter" && canSubmit) {
        e.preventDefault();
        void handleSubmitAndAdvance();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [challenge, submitting, loading, canSubmit, handleSkipOrFlag, handleSubmitAndAdvance]);

  const handleHypergraphTokenClick = useCallback((span: AnsatzRelationalTokenSpan) => {
    if (isPunctuationOnlyToken(span)) return;
    setActiveGroupId(span.groupId);
    setClickedToken((prev) => {
      const sameSpan =
        prev &&
        prev.span.startLine === span.startLine &&
        prev.span.startColumn === span.startColumn &&
        prev.span.endLine === span.endLine &&
        prev.span.endColumn === span.endColumn;
      return {
        span,
        baseGroupId: sameSpan && prev.baseGroupId > 0 ? prev.baseGroupId : span.groupId,
      };
    });
  }, []);

  const displayedGroups = useMemo(
    () => liveHypergraph?.groups ?? challenge?.sourceHypergraph?.groups ?? [],
    [liveHypergraph, challenge],
  );

  const clickedTokenContext = useMemo(() => {
    if (!clickedToken) return null;
    const liveSpan =
      liveHypergraph?.spans.find(
        (s) =>
          s.startLine === clickedToken.span.startLine &&
          s.startColumn === clickedToken.span.startColumn &&
          s.endLine === clickedToken.span.endLine &&
          s.endColumn === clickedToken.span.endColumn,
      ) ?? clickedToken.span;
    const matchedGroup = displayedGroups.find(
      (g) => g.groupId === liveSpan.groupId || g.groupId === clickedToken.baseGroupId,
    );
    const symbolKey = liveSpan.symbolName ?? matchedGroup?.symbolName ?? matchedGroup?.label ?? liveSpan.text;
    const override = overrides.find((o) => o.symbolName === symbolKey);
    const effectiveGroupId = override?.groupId ?? liveSpan.groupId;
    const effectiveSign = override?.relSign ?? (liveSpan.relSign < 0 ? -1 : 1);
    return {
      span: liveSpan,
      baseGroupId: clickedToken.baseGroupId,
      symbolKey,
      override,
      effectiveGroupId,
      effectiveSign,
    };
  }, [clickedToken, liveHypergraph, displayedGroups, overrides]);

  const priorityDeltaLabel = useMemo(() => {
    if (!challenge) return "Priority Δ_t: —";
    const dt = challenge.deltaTTrigger !== null ? challenge.deltaTTrigger.toFixed(2) : "n/a";
    const ps = Number.isFinite(challenge.priorityScore) ? challenge.priorityScore.toFixed(2) : "0.00";
    return `Priority Δ_t=${dt} (score ${ps})`;
  }, [challenge]);

  const defaultShowHypergraphOverlay = challenge?.challengeType === "tolerance_labeling";

  return (
    <PageRoot>
      {/* Live Session HUD Bar */}
      <HudBar>
        <HudMetrics>
          <Link
            to="/arena"
            style={{
              color: "#38bdf8",
              textDecoration: "none",
              fontWeight: 700,
              marginRight: 4,
            }}
          >
            ← Arena Hub
          </Link>
          <HudPill $tone="emerald">Reviewed: {reviewedCount}</HudPill>
          <span>·</span>
          <HudPill $tone="sky">Remaining: {remainingCount}</HudPill>
          <span>·</span>
          <HudPill $tone="neutral">Blind A/B Active</HudPill>
          <span>·</span>
          <HudPill $tone="amber">{priorityDeltaLabel}</HudPill>
          {campaignIdFilter && (
            <HudPill $tone="sky">
              Campaign #{campaignIdFilter}{" "}
              <button
                type="button"
                onClick={() => updateFilter("campaignId", "")}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "inherit",
                  cursor: "pointer",
                  padding: "0 2px",
                  fontWeight: 700,
                }}
                title="Clear campaign filter"
              >
                ×
              </button>
            </HudPill>
          )}
        </HudMetrics>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <SelectControl
            aria-label="Filter queue by dialect"
            value={dialectFilter}
            onChange={(e) => updateFilter("dialect", e.target.value)}
          >
            {DIALECT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </SelectControl>
          <SelectControl
            aria-label="Filter queue by challenge type"
            value={challengeTypeFilter}
            onChange={(e) => updateFilter("challengeType", e.target.value)}
          >
            {CHALLENGE_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </SelectControl>
          {challenge?.challengeType === "pairwise_arena" && (
            <>
              <ActionButton
                type="button"
                $active={syncCameras}
                onClick={() => setSyncCameras((prev) => !prev)}
                title="Synchronize 3D CAD OrbitControls cameras across side-by-side panes"
              >
                {syncCameras ? "Sync 3D Cameras: ON" : "Sync 3D Cameras: OFF"}
              </ActionButton>
              <ActionButton
                type="button"
                $amber={worstCaseActive}
                onClick={() => setWorstCaseActive((prev) => !prev)}
                title="Apply adversarial ξ* worst-case zonotope perturbation corner to both candidates"
              >
                {worstCaseActive
                  ? `ξ* Worst-Case Corner ON (±${Math.round(deltaFraction * 100)}%)`
                  : "Toggle ξ* Worst-Case Corner"}
              </ActionButton>
              {worstCaseActive && (
                <SelectControl
                  aria-label="Worst-case perturbation delta"
                  value={String(deltaFraction)}
                  onChange={(e) => setDeltaFraction(Number(e.target.value))}
                >
                  <option value="0.02">±2%</option>
                  <option value="0.05">±5%</option>
                  <option value="0.1">±10%</option>
                  <option value="0.2">±20%</option>
                </SelectControl>
              )}
            </>
          )}
        </div>
      </HudBar>

      {/* Main Content */}
      {authRequired ? (
        <EmptyCard>
          <h2 style={{ margin: 0, fontSize: 18 }}>Sign in to Annotate the Queue</h2>
          <p style={{ margin: 0, fontSize: 13, color: "#8b949e" }}>
            Continuous Zonotope-Prioritized RLHF annotation tracks per-user blind A/B randomization and domain trust
            reputation.
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
            <Link to="/login" style={{ color: "#38bdf8", fontWeight: 600 }}>
              Sign In →
            </Link>
            <Link to="/arena" style={{ color: "#8b949e" }}>
              Back to Arena Hub
            </Link>
          </div>
        </EmptyCard>
      ) : loading ? (
        <EmptyCard>
          <strong style={{ fontSize: 15 }}>Fetching highest-priority zonotope challenge…</strong>
          <span style={{ fontSize: 12, color: "#8b949e" }}>
            Ordering by priority_score DESC, Δ_t trigger DESC with deterministic blind A/B shuffling.
          </span>
        </EmptyCard>
      ) : error ? (
        <EmptyCard>
          <strong style={{ fontSize: 15, color: "#f87171" }}>Queue Error</strong>
          <div style={{ fontSize: 13, color: "#c9d1d9" }}>{error}</div>
          <div>
            <ActionButton type="button" $primary onClick={() => void fetchNextChallenge()}>
              Retry Queue
            </ActionButton>
          </div>
        </EmptyCard>
      ) : !challenge ? (
        <EmptyCard>
          <h2 style={{ margin: 0, fontSize: 18 }}>Queue Cleared ✓</h2>
          <p style={{ margin: 0, fontSize: 13, color: "#8b949e" }}>
            No remaining open challenges match your current filters. You reviewed <strong>{reviewedCount}</strong>{" "}
            {reviewedCount === 1 ? "challenge" : "challenges"} in this session.
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
            {(dialectFilter || campaignIdFilter || challengeTypeFilter) && (
              <ActionButton type="button" onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}>
                Clear All Filters
              </ActionButton>
            )}
            <ActionButton type="button" onClick={() => void fetchNextChallenge()}>
              Refresh Queue
            </ActionButton>
            <Link
              to="/arena"
              style={{
                padding: "7px 14px",
                borderRadius: 8,
                background: "linear-gradient(135deg, #0284c7, #6366f1)",
                color: "#fff",
                textDecoration: "none",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Return to Arena Hub →
            </Link>
          </div>
        </EmptyCard>
      ) : (
        <>
          <TopBar>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <span>#{challenge.id}</span>
                <span>{challenge.title}</span>
                <HudPill $tone="sky">{challenge.dialect.toUpperCase()}</HudPill>
                <HudPill $tone="neutral">{challenge.challengeType}</HudPill>
              </div>
              <div style={{ fontSize: 12, color: "#8b949e", marginTop: 2 }}>{challenge.prompt}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <ActionButton
                type="button"
                onClick={() => void handleSkipOrFlag(false, "manual_skip")}
                disabled={submitting}
                title="Skip this challenge (Shortcut: S)"
              >
                Skip <KbdHint>S</KbdHint>
              </ActionButton>
              <ActionButton
                type="button"
                $danger
                onClick={() => void handleSkipOrFlag(true, notes.trim() || "flagged_broken_challenge")}
                disabled={submitting}
                title="Flag this challenge for reviewer inspection"
              >
                Flag Issue
              </ActionButton>
            </div>
          </TopBar>

          {challenge.challengeType === "pairwise_arena" && (
            <SplitGrid $columns={Math.max(2, Math.min(3, challenge.candidates.length))}>
              {challenge.candidates.slice(0, 2).map((cand, idx) => {
                const replay = candidateReplayMap.get(cand.id);
                const displayedCode = replay?.source ?? cand.code;
                const mutations = replay?.mutations ?? [];
                const isSelected = outcome === "candidate" && selectedCandidateId === cand.id;
                const optionLabel = cand.blindLabel || `Option ${idx + 1}`;

                return (
                  <Pane key={cand.id} $selected={isSelected}>
                    <PaneHeader>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <strong>
                          {optionLabel} (m_init={cand.mInit})
                        </strong>
                        {renderGateBadges(cand.formalCert)}
                      </div>
                      <ActionButton
                        type="button"
                        $active={isSelected}
                        onClick={() => {
                          setOutcome("candidate");
                          setSelectedCandidateId(cand.id);
                        }}
                      >
                        {isSelected ? `✓ Picked ${optionLabel}` : `Pick ${optionLabel}`}
                        <KbdHint>{idx + 1}</KbdHint>
                      </ActionButton>
                    </PaneHeader>
                    {worstCaseActive && (
                      <MutationStrip>
                        <strong>ξ* Boundary:</strong>
                        {mutations.length > 0 ? (
                          mutations.slice(0, 6).map((mut) => (
                            <span key={mut.symbolName}>
                              {mut.symbolName}: {mut.before}→{mut.after} ({mut.xiSign > 0 ? "+ξ" : "-ξ"})
                            </span>
                          ))
                        ) : (
                          <span>No numeric parameter literals matched for perturbation</span>
                        )}
                      </MutationStrip>
                    )}
                    <div style={{ flex: 1, minHeight: 0 }}>
                      <AnsatzEditor
                        key={`${challenge.id}-${cand.id}-${worstCaseActive ? `xi-${deltaFraction}` : "nominal"}`}
                        dataUrl={null}
                        embed
                        initialCode={displayedCode}
                        initialDialect={cand.dialect}
                        cameraSyncGroup={syncCameras ? `rlhf-${challenge.id}` : undefined}
                        defaultShowHypergraphOverlay={defaultShowHypergraphOverlay}
                        onZonotopeOverridesChange={handleZonotopeOverridesChange}
                      />
                    </div>
                  </Pane>
                );
              })}
            </SplitGrid>
          )}

          {challenge.challengeType === "fix_it_bounty" && (
            <SplitGrid $columns={1}>
              <Pane>
                <PaneHeader>
                  <strong>Repair the model until all 4 formal gates pass</strong>
                </PaneHeader>
                <div style={{ flex: 1, minHeight: 0 }}>
                  <AnsatzEditor
                    key={`fix-${challenge.id}`}
                    dataUrl={null}
                    embed
                    initialCode={fixCode}
                    initialDialect={challenge.dialect}
                    onCodeChange={setFixCode}
                    defaultShowHypergraphOverlay={defaultShowHypergraphOverlay}
                    onZonotopeOverridesChange={handleZonotopeOverridesChange}
                  />
                </div>
              </Pane>
            </SplitGrid>
          )}

          {challenge.challengeType === "tolerance_labeling" && (
            <SplitGrid $columns={2}>
              <Pane>
                <PaneHeader>
                  <strong>
                    4-Column Relational Zonotope Overlay (m_init={liveHypergraph?.mInit ?? displayedGroups.length})
                  </strong>
                  <span style={{ fontSize: 11, color: "#8b949e" }}>
                    Click any token to label group_id &amp; sign · hover to inspect
                  </span>
                </PaneHeader>
                {clickedTokenContext && (
                  <QuickTokenPillBar role="region" aria-label="Quick token generator labeler">
                    <span style={{ fontFamily: "monospace" }}>
                      Clicked token &quot;{clickedTokenContext.span.text}&quot; (
                      {clickedTokenContext.effectiveGroupId === 0
                        ? "ε_0 / Locked"
                        : `ε_${clickedTokenContext.effectiveGroupId}`}
                      )
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <ActionButton
                        type="button"
                        $active={clickedTokenContext.effectiveGroupId === 0}
                        onClick={() => {
                          const nextGroupId =
                            clickedTokenContext.effectiveGroupId === 0
                              ? clickedTokenContext.baseGroupId > 0
                                ? clickedTokenContext.baseGroupId
                                : undefined
                              : 0;
                          upsertOverride(clickedTokenContext.symbolKey, { groupId: nextGroupId });
                          setActiveGroupId(nextGroupId ?? 0);
                        }}
                      >
                        {clickedTokenContext.effectiveGroupId === 0 ? "Locked (0)" : "Lock (0)"}
                      </ActionButton>
                      <ActionButton
                        type="button"
                        $active={clickedTokenContext.effectiveSign === -1}
                        onClick={() =>
                          upsertOverride(clickedTokenContext.symbolKey, {
                            relSign: clickedTokenContext.effectiveSign === -1 ? 1 : -1,
                          })
                        }
                      >
                        Flip Sign ({clickedTokenContext.effectiveSign === -1 ? "-1 → +1" : "+1 → -1"})
                      </ActionButton>
                      <ActionButton
                        type="button"
                        onClick={() => {
                          setClickedToken(null);
                          setActiveGroupId(null);
                        }}
                        title="Clear selected token"
                        style={{ padding: "4px 8px" }}
                      >
                        ×
                      </ActionButton>
                    </div>
                  </QuickTokenPillBar>
                )}
                <div style={{ flex: 1, minHeight: 0 }}>
                  <CodeEditor
                    content={challenge.sourceCode ?? ""}
                    uri={`rlhf://queue/challenge/${challenge.id}/source.${challenge.dialect}`}
                    languageId={challenge.dialect}
                    setEditor={() => {}}
                    theme="vs-dark"
                    embed={false}
                    readOnly
                    showHypergraphOverlay
                    hypergraphOverrides={overrides}
                    activeHypergraphGroupId={activeGroupId}
                    onHypergraphComputed={setLiveHypergraph}
                    onHypergraphTokenClick={handleHypergraphTokenClick}
                  />
                </div>
              </Pane>

              <Pane style={{ padding: 14, overflowY: "auto", gap: 10 }}>
                <strong style={{ fontSize: 13 }}>Perturbation Generators (ε_1 … ε_m)</strong>
                <div style={{ fontSize: 12, color: "#8b949e" }}>
                  Lock safety/syntax invariants to <code>group_id = 0</code> or invert coupled parameter signs for
                  Dynamic-m training.
                </div>
                {displayedGroups.map((g) => {
                  const sym = g.symbolName ?? g.label;
                  const ov = overrides.find((o) => o.symbolName === sym);
                  const isHighlighted = activeGroupId === g.groupId;
                  return (
                    <div
                      key={g.groupId}
                      onMouseEnter={() => setActiveGroupId(g.groupId)}
                      onMouseLeave={() =>
                        setActiveGroupId(clickedTokenContext ? clickedTokenContext.effectiveGroupId : null)
                      }
                      style={{
                        border: `1px solid ${isHighlighted ? "#38bdf8" : "#30363d"}`,
                        background: isHighlighted ? "rgba(56, 189, 248, 0.08)" : "transparent",
                        borderRadius: 8,
                        padding: "8px 10px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, fontFamily: "monospace" }}>
                          ε_{g.groupId}: {g.label}
                        </div>
                        <div style={{ fontSize: 11, color: "#8b949e" }}>{g.tokenCount} occurrences</div>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <ActionButton
                          type="button"
                          $active={ov?.groupId === 0}
                          onClick={() => upsertOverride(sym, { groupId: ov?.groupId === 0 ? g.groupId : 0 })}
                        >
                          {ov?.groupId === 0 ? "Locked (0)" : "Lock (0)"}
                        </ActionButton>
                        <ActionButton
                          type="button"
                          $active={ov?.relSign === -1}
                          onClick={() => upsertOverride(sym, { relSign: ov?.relSign === -1 ? 1 : -1 })}
                        >
                          {ov?.relSign === -1 ? "Sign -1" : "Sign +1"}
                        </ActionButton>
                      </div>
                    </div>
                  );
                })}
              </Pane>
            </SplitGrid>
          )}

          <FooterBar>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              {challenge.challengeType === "pairwise_arena" && (
                <>
                  <ActionButton
                    type="button"
                    $active={outcome === "tie"}
                    onClick={() => {
                      setOutcome("tie");
                      setSelectedCandidateId(null);
                    }}
                  >
                    Tie <KbdHint>T</KbdHint>
                  </ActionButton>
                  <ActionButton
                    type="button"
                    $active={outcome === "both_bad"}
                    onClick={() => {
                      setOutcome("both_bad");
                      setSelectedCandidateId(null);
                    }}
                  >
                    Both Invalid <KbdHint>B</KbdHint>
                  </ActionButton>
                </>
              )}
              {RATIONALE_TAGS.map((tag) => (
                <ActionButton
                  key={tag}
                  type="button"
                  $active={rationaleTags.includes(tag)}
                  onClick={() => toggleTag(tag)}
                >
                  #{tag}
                </ActionButton>
              ))}
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional engineering note…"
                style={{
                  background: "#0d1117",
                  color: "#e6edf3",
                  border: "1px solid #30363d",
                  borderRadius: 6,
                  padding: "6px 10px",
                  fontSize: 12,
                  minWidth: 190,
                }}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {(overrides.length > 0 || visualConstraints.length > 0) && (
                <HudPill
                  $tone="sky"
                  title={
                    visualConstraints.length > 0
                      ? `Constraints: ${visualConstraints.map((c) => c.expression).join("; ")}`
                      : "Synced hypergraph token overrides"
                  }
                >
                  {overrides.length} {overrides.length === 1 ? "override" : "overrides"}
                  {visualConstraints.length > 0
                    ? ` · ${visualConstraints.length} ${visualConstraints.length === 1 ? "constraint" : "constraints"}`
                    : ""}
                </HudPill>
              )}
              {statusMessage && <span style={{ fontSize: 12, color: "#38bdf8" }}>{statusMessage}</span>}
              <ActionButton type="button" $primary disabled={!canSubmit} onClick={() => void handleSubmitAndAdvance()}>
                {submitting ? "Verifying & Advancing…" : "Submit & Next"}
                {!submitting && <KbdHint>Enter</KbdHint>}
              </ActionButton>
            </div>
          </FooterBar>
        </>
      )}
    </PageRoot>
  );
};

export default RlhfQueuePage;
