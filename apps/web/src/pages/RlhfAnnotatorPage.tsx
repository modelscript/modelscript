// SPDX-License-Identifier: AGPL-3.0-or-later

import AnsatzEditor from "@modelscript/editor/workbench/AnsatzEditor";
import CodeEditor from "@modelscript/editor/workbench/Code";
import type {
  AnsatzHypergraphTokenOverride,
  AnsatzRelationalHypergraphRecord,
  AnsatzRelationalTokenSpan,
} from "@modelscript/editor/workbench/util/lsp-bridge";
import type {
  ApiHypergraphOverride,
  LinearConstraintSpec,
} from "@modelscript/editor/workbench/util/zonotope-workbench-state";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
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

interface CandidateDetail {
  id: number;
  label: string;
  code: string;
  dialect: string;
  mInit: number;
  tokenCount: number;
  weightedVotes: number;
  formalCert: FormalCert | null;
  hypergraph?: AnsatzRelationalHypergraphRecord | undefined;
}

interface ChallengeDetail {
  id: number;
  challengeType: "pairwise_arena" | "fix_it_bounty" | "tolerance_labeling";
  dialect: string;
  title: string;
  prompt: string;
  sourceCode: string | null;
  sourceHypergraph: AnsatzRelationalHypergraphRecord | null;
  deltaTTrigger: number | null;
  candidates: CandidateDetail[];
  stats: { totalAnnotations: number; tieWeight: number; bothBadWeight: number };
}

const PageRoot = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  background: var(--ms-bg-canvas, #0d1117);
  color: var(--ms-text-1, #e6edf3);
  overflow: hidden;
`;

const TopBar = styled.header`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 18px;
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

const Pane = styled.section`
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--ms-bg-canvas, #0d1117);
`;

const PaneHeader = styled.div`
  display: flex;
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
  gap: 12px;
  padding: 10px 18px;
  border-top: 1px solid var(--ms-border-default, #30363d);
  background: var(--ms-surface-panel, #161b22);
`;

const ActionButton = styled.button<{ $primary?: boolean; $active?: boolean }>`
  padding: 7px 14px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid ${(p) => (p.$active || p.$primary ? "#38bdf8" : "#30363d")};
  background: ${(p) =>
    p.$primary ? "linear-gradient(135deg, #0284c7, #6366f1)" : p.$active ? "rgba(56, 189, 248, 0.18)" : "#21262d"};
  color: #f8fafc;
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const RATIONALE_TAGS = [
  "better-manufacturability",
  "tighter-tolerance",
  "cleaner-dae",
  "si-unit-rigor",
  "safer-bounds",
  "idiomatic-structure",
];

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

export const RlhfAnnotatorPage: React.FC = () => {
  const { challengeId } = useParams<{ challengeId: string }>();
  const [challenge, setChallenge] = useState<ChallengeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Pairwise state
  const [selectedCandidateId, setSelectedCandidateId] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<"candidate" | "tie" | "both_bad">("candidate");
  const [rationaleTags, setRationaleTags] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [syncCameras, setSyncCameras] = useState<boolean>(true);

  // Fix-It bounty state
  const [fixCode, setFixCode] = useState("");

  // Tolerance / group_id labeling state
  const [overrides, setOverrides] = useState<AnsatzHypergraphTokenOverride[]>([]);
  const [visualConstraints, setVisualConstraints] = useState<LinearConstraintSpec[]>([]);
  const [liveHypergraph, setLiveHypergraph] = useState<AnsatzRelationalHypergraphRecord | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null);
  const [clickedToken, setClickedToken] = useState<{
    span: AnsatzRelationalTokenSpan;
    baseGroupId: number;
  } | null>(null);

  usePageTitle(challenge ? `Annotate: ${challenge.title}` : "Ansatz RLHF Annotator");

  useEffect(() => {
    if (!challengeId) return;
    setLoading(true);
    setClickedToken(null);
    setActiveGroupId(null);
    setOverrides([]);
    setVisualConstraints([]);
    fetch(`/api/v1/rlhf/challenges/${challengeId}`, { credentials: "include" })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Failed to load challenge");
        const ch = data.challenge as ChallengeDetail;
        setChallenge(ch);
        if (ch.sourceCode) setFixCode(ch.sourceCode);
        if (ch.sourceHypergraph) setLiveHypergraph(ch.sourceHypergraph);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [challengeId]);

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

  const handleSubmit = useCallback(async () => {
    if (!challenge) return;
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
      const data = await res.json();
      if (!res.ok) {
        const diagList = Array.isArray(data.formalCert?.diagnostics)
          ? ` (${data.formalCert.diagnostics.join(" ")})`
          : "";
        throw new Error((data.error || "Submission failed") + diagList);
      }
      setStatusMessage(
        `Saved verified annotation (weight=${data.appliedWeight}${
          data.updatedMInit !== undefined ? `, updated m_init=${data.updatedMInit}` : ""
        }).`,
      );
    } catch (e) {
      setStatusMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }, [challenge, outcome, selectedCandidateId, rationaleTags, notes, fixCode, overrides, visualConstraints]);

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

  if (loading) return <PageRoot style={{ padding: 24 }}>Loading Ansatz RLHF Annotator…</PageRoot>;
  if (error || !challenge) return <PageRoot style={{ padding: 24 }}>Error: {error ?? "Challenge not found"}</PageRoot>;

  const defaultShowHypergraphOverlay = challenge.challengeType === "tolerance_labeling";

  return (
    <PageRoot>
      <TopBar>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{challenge.title}</div>
          <div style={{ fontSize: 12, color: "#8b949e" }}>{challenge.prompt}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontFamily: "monospace" }}>
          {challenge.challengeType === "pairwise_arena" && (
            <ActionButton
              type="button"
              $active={syncCameras}
              onClick={() => setSyncCameras((prev) => !prev)}
              title="Synchronize 3D CAD OrbitControls cameras across side-by-side panes"
            >
              {syncCameras ? "Sync 3D Cameras: ON" : "Sync 3D Cameras: OFF"}
            </ActionButton>
          )}
          <span>{challenge.dialect.toUpperCase()}</span>
          <span>·</span>
          <span>{challenge.challengeType}</span>
          {challenge.deltaTTrigger !== null && <span>· Δ_t={challenge.deltaTTrigger.toFixed(2)}</span>}
        </div>
      </TopBar>

      {challenge.challengeType === "pairwise_arena" && (
        <SplitGrid $columns={Math.max(2, Math.min(3, challenge.candidates.length))}>
          {challenge.candidates.map((cand) => (
            <Pane key={cand.id}>
              <PaneHeader>
                <strong>
                  Candidate {cand.label} (m_init={cand.mInit}, votes={cand.weightedVotes})
                </strong>
                {renderGateBadges(cand.formalCert)}
                <ActionButton
                  type="button"
                  $active={outcome === "candidate" && selectedCandidateId === cand.id}
                  onClick={() => {
                    setOutcome("candidate");
                    setSelectedCandidateId(cand.id);
                  }}
                >
                  {outcome === "candidate" && selectedCandidateId === cand.id ? "✓ Selected" : `Choose ${cand.label}`}
                </ActionButton>
              </PaneHeader>
              <div style={{ flex: 1, minHeight: 0 }}>
                <AnsatzEditor
                  dataUrl={null}
                  embed
                  initialCode={cand.code}
                  initialDialect={cand.dialect}
                  cameraSyncGroup={syncCameras ? `rlhf-${challenge.id}` : undefined}
                  defaultShowHypergraphOverlay={defaultShowHypergraphOverlay}
                  onZonotopeOverridesChange={handleZonotopeOverridesChange}
                />
              </div>
            </Pane>
          ))}
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
                uri={`rlhf://challenge/${challenge.id}/source.${challenge.dialect}`}
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
              Lock safety/syntax invariants to <code>group_id = 0</code> or invert coupled parameter signs for Dynamic-m
              training.
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
              <ActionButton type="button" $active={outcome === "tie"} onClick={() => setOutcome("tie")}>
                Tie
              </ActionButton>
              <ActionButton type="button" $active={outcome === "both_bad"} onClick={() => setOutcome("both_bad")}>
                Both Invalid
              </ActionButton>
            </>
          )}
          {RATIONALE_TAGS.map((tag) => (
            <ActionButton key={tag} type="button" $active={rationaleTags.includes(tag)} onClick={() => toggleTag(tag)}>
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
              minWidth: 200,
            }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {(overrides.length > 0 || visualConstraints.length > 0) && (
            <span
              style={{
                fontSize: 11,
                fontFamily: "monospace",
                fontWeight: 600,
                padding: "3px 8px",
                borderRadius: 999,
                border: "1px solid rgba(56, 189, 248, 0.45)",
                background: "rgba(56, 189, 248, 0.14)",
                color: "#7dd3fc",
              }}
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
            </span>
          )}
          {statusMessage && <span style={{ fontSize: 12, color: "#38bdf8" }}>{statusMessage}</span>}
          <ActionButton
            type="button"
            $primary
            disabled={
              submitting ||
              (challenge.challengeType === "pairwise_arena" && outcome === "candidate" && !selectedCandidateId)
            }
            onClick={handleSubmit}
          >
            {submitting ? "Verifying & Saving…" : "Submit Verified Annotation"}
          </ActionButton>
        </div>
      </FooterBar>
    </PageRoot>
  );
};

export default RlhfAnnotatorPage;
