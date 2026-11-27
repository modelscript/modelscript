// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import styled from "styled-components";
import { usePageTitle } from "../util/title";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type ModelRegistryKind = "model-core" | "lora-adapter" | "projection-head";
type ModelPromotionStage = "draft" | "staging" | "production" | "deprecated";

interface FormalModelEvalReport {
  promoted: boolean;
  totalCases: number;
  formalGatePassRate: number;
  nonTrivialPassRate: number;
  rewardHackingRate: number;
  diskAnnRecallAtK: number;
  calibration?: {
    ece: number;
    meanSpreadOnErrors: number;
    meanSpreadOnValid: number;
    separationGap: number;
    sampleCount: number;
  } | null;
}

interface StoredPromotionProof {
  attestation: Record<string, unknown>;
  proof: {
    cryptosuite: string;
    created: string;
    verificationMethod: string;
    proofValue: string;
  };
}

interface ModelRegistryEntry {
  id: number;
  name: string;
  version: string;
  kind: ModelRegistryKind;
  baseModelRef: string | null;
  recipeName: string | null;
  recipeVersion: string | null;
  promotionStage: ModelPromotionStage;
  parameterScale: string | null;
  memoryContract: Record<string, unknown> | null;
  evalReport: FormalModelEvalReport | null;
  zonotopeCert: Record<string, unknown> | null;
  ed25519Proof: StoredPromotionProof | null;
  updatedAt: string;
}

interface MemoryLeaderboardEntry {
  rank: number;
  recipeName: string;
  recipeVersion: string;
  releaseId: string;
  domain: string;
  dialects: string[];
  parameterScale: string;
  passAt1: number;
  gate1To4PassRate: number;
  score: number;
  efficiencyAdjustedScore: number;
  independentReproductions: number;
  shardCount: number;
  totalExamples: number;
  createdAt: string;
}

type DomainFilter = "All" | "Modelica" | "OpenSCAD/STEP" | "SysML2" | "SPICE" | "Power Grids";
type SortMetric = "certifiedPassAt1" | "efficiency" | "ece" | "recall";

// ─────────────────────────────────────────────────────────────────────────────
// Domain Matching & Parameter Scale Parsing
// ─────────────────────────────────────────────────────────────────────────────

const DOMAIN_FILTERS: DomainFilter[] = ["All", "Modelica", "OpenSCAD/STEP", "SysML2", "SPICE", "Power Grids"];

const DOMAIN_KEYWORDS: Record<Exclude<DomainFilter, "All">, RegExp> = {
  Modelica: /modelica|\bmsl\b|\bdae\b|thermal|hydraulic|multibody/i,
  "OpenSCAD/STEP": /openscad|\bscad\b|\bstep\b|\bcad\b|csg|geometry|mesh/i,
  SysML2: /sysml|mbse|reqif|ssp|magicdraw/i,
  SPICE: /spice|kicad|verilog|analog|circuit|atopile|rf\b/i,
  "Power Grids": /power|grid|pscad|psse|cgmes|opendss|powerfactory|emt|ieee-cdf|matpower/i,
};

function parseParamsBillions(scale: string | null | undefined): number | null {
  if (!scale) return null;
  const m = scale.trim().match(/([\d.]+)\s*([bmkt])?/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = (m[2] ?? "b").toLowerCase();
  if (unit === "m") return n / 1000;
  if (unit === "k") return n / 1_000_000;
  if (unit === "t") return n * 1000;
  return n;
}

function matchesDomainText(domain: DomainFilter, haystack: string): boolean {
  if (domain === "All") return true;
  return DOMAIN_KEYWORDS[domain].test(haystack);
}

function modelSearchHaystack(m: ModelRegistryEntry, recipeMap: Map<string, MemoryLeaderboardEntry>): string {
  const parts: string[] = [m.name, m.recipeName ?? "", m.baseModelRef ?? ""];
  if (m.memoryContract) parts.push(JSON.stringify(m.memoryContract));
  if (m.zonotopeCert) parts.push(JSON.stringify(m.zonotopeCert));
  if (m.recipeName) {
    const rec = recipeMap.get(`${m.recipeName}@${m.recipeVersion ?? ""}`) ?? recipeMap.get(m.recipeName);
    if (rec) {
      parts.push(rec.domain, ...rec.dialects);
    }
  }
  return parts.join(" ");
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function fmtNum(v: number | null | undefined, digits = 3): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

// ─────────────────────────────────────────────────────────────────────────────
// Styled Components
// ─────────────────────────────────────────────────────────────────────────────

const PageContainer = styled.div`
  max-width: 1260px;
  margin: 0 auto;
  padding: 24px 20px 64px;
  color: var(--ms-text-1, #e6edf3);
`;

const HeaderRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 18px;
`;

const PageTitle = styled.h1`
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--ms-text-heading, var(--ms-text-1, #f0f6fc));
`;

const Subtitle = styled.p`
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--ms-text-2, #8b949e);
`;

const NavLinkButton = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  color: var(--ms-text-1, #e6edf3);
  border: 1px solid var(--ms-border, #30363d);
  background: var(--ms-bg-elv, #161b22);
  &:hover {
    border-color: var(--ms-brand, #38bdf8);
  }
`;

const FilterBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid var(--ms-border, #30363d);
  background: var(--ms-bg-elv, #161b22);
  margin-bottom: 18px;
`;

const PillGroup = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`;

const Pill = styled.button<{ $active?: boolean }>`
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid ${(p) => (p.$active ? "var(--ms-brand, #38bdf8)" : "var(--ms-border, #30363d)")};
  background: ${(p) => (p.$active ? "rgba(56, 189, 248, 0.16)" : "transparent")};
  color: ${(p) => (p.$active ? "var(--ms-brand, #38bdf8)" : "var(--ms-text-2, #8b949e)")};
  &:hover {
    color: var(--ms-text-1, #e6edf3);
    border-color: var(--ms-brand, #38bdf8);
  }
`;

const SectionCard = styled.section`
  border-radius: 12px;
  border: 1px solid var(--ms-border, #30363d);
  background: var(--ms-bg-elv, #161b22);
  margin-bottom: 20px;
  overflow: hidden;
`;

const SectionHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--ms-divider, #21262d);
`;

const SectionTitle = styled.h2`
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--ms-text-heading, var(--ms-text-1, #f0f6fc));
`;

const InfoBanner = styled.div`
  padding: 10px 14px;
  margin-bottom: 16px;
  border-radius: 10px;
  font-size: 12px;
  border: 1px solid rgba(56, 189, 248, 0.35);
  background: rgba(56, 189, 248, 0.08);
  color: var(--ms-text-1, #e6edf3);
`;

const BoardTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  th,
  td {
    text-align: left;
    padding: 11px 14px;
    border-bottom: 1px solid var(--ms-divider, #21262d);
    vertical-align: middle;
  }
  th {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ms-text-2, #8b949e);
    background: rgba(255, 255, 255, 0.02);
    white-space: nowrap;
  }
  tbody tr:hover {
    background: var(--ms-surface-hover, rgba(255, 255, 255, 0.03));
  }
`;

const RankChip = styled.span<{ $rank: number }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 24px;
  padding: 0 7px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 800;
  font-family: var(--ms-font-mono, monospace);
  background: ${(p) =>
    p.$rank === 1
      ? "rgba(250, 204, 21, 0.2)"
      : p.$rank === 2
        ? "rgba(203, 213, 225, 0.18)"
        : p.$rank === 3
          ? "rgba(217, 119, 6, 0.2)"
          : "var(--ms-bg, #0d1117)"};
  color: ${(p) => (p.$rank === 1 ? "#facc15" : p.$rank === 2 ? "#cbd5e1" : p.$rank === 3 ? "#f59e0b" : "var(--ms-text-3, #8b949e)")};
  border: 1px solid
    ${(p) =>
      p.$rank === 1
        ? "rgba(250, 204, 21, 0.5)"
        : p.$rank === 2
          ? "rgba(203, 213, 225, 0.4)"
          : p.$rank === 3
            ? "rgba(217, 119, 6, 0.45)"
            : "var(--ms-divider, #21262d)"};
`;

const KindPill = styled.span<{ $kind: ModelRegistryKind }>`
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  font-family: var(--ms-font-mono, monospace);
  padding: 2px 6px;
  border-radius: 5px;
  background: ${(p) =>
    p.$kind === "model-core"
      ? "rgba(99, 102, 241, 0.16)"
      : p.$kind === "lora-adapter"
        ? "rgba(245, 158, 11, 0.16)"
        : "rgba(236, 72, 153, 0.16)"};
  color: ${(p) => (p.$kind === "model-core" ? "#818cf8" : p.$kind === "lora-adapter" ? "#fbbf24" : "#f472b6")};
`;

const VerifiedBadge = styled.span<{ $verified: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 700;
  font-family: var(--ms-font-mono, monospace);
  padding: 3px 9px;
  border-radius: 999px;
  white-space: nowrap;
  background: ${(p) => (p.$verified ? "rgba(16, 185, 129, 0.16)" : "rgba(148, 163, 184, 0.12)")};
  color: ${(p) => (p.$verified ? "#34d399" : "#94a3b8")};
  border: 1px solid ${(p) => (p.$verified ? "rgba(16, 185, 129, 0.45)" : "rgba(148, 163, 184, 0.3)")};
`;

const ScoreBarTrack = styled.div`
  width: 96px;
  height: 5px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.18);
  overflow: hidden;
  margin-top: 4px;
`;

const ScoreBarFill = styled.div<{ $pct: number }>`
  width: ${(p) => `${Math.max(0, Math.min(100, p.$pct)).toFixed(1)}%`};
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #0ea5e9, #34d399);
`;

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

interface RankedModelRow {
  model: ModelRegistryEntry;
  paramsB: number | null;
  certifiedPassAt1: number | null;
  efficiencyPerB: number | null;
  ece: number | null;
  diskAnnRecallAtK: number | null;
  verified: boolean;
}

export const LeaderboardsPage: React.FC = () => {
  usePageTitle("Certified Engineering LLM Leaderboard");

  const [models, setModels] = useState<ModelRegistryEntry[]>([]);
  const [usedFallbackAll, setUsedFallbackAll] = useState(false);
  const [includeAllStages, setIncludeAllStages] = useState(false);
  const [recipes, setRecipes] = useState<MemoryLeaderboardEntry[]>([]);
  const [domain, setDomain] = useState<DomainFilter>("All");
  const [sortBy, setSortBy] = useState<SortMetric>("certifiedPassAt1");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLeaderboards = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [prodRes, memRes] = await Promise.all([
        fetch(includeAllStages ? "/api/v1/models" : "/api/v1/models?promotionStage=production", {
          credentials: "include",
        }),
        fetch("/api/v1/memory/leaderboards", { credentials: "include" }),
      ]);

      const prodData = (await prodRes.json().catch(() => ({}))) as {
        models?: ModelRegistryEntry[];
        error?: string;
      };
      let loadedModels = prodRes.ok && Array.isArray(prodData.models) ? prodData.models : [];
      let fellBack = false;

      if (!includeAllStages && loadedModels.length === 0) {
        const allRes = await fetch("/api/v1/models", { credentials: "include" });
        const allData = (await allRes.json().catch(() => ({}))) as { models?: ModelRegistryEntry[] };
        if (allRes.ok && Array.isArray(allData.models) && allData.models.length > 0) {
          loadedModels = allData.models;
          fellBack = true;
        }
      }

      const memData = (await memRes.json().catch(() => ({}))) as { entries?: MemoryLeaderboardEntry[] };
      const loadedRecipes = memRes.ok && Array.isArray(memData.entries) ? memData.entries : [];

      setModels(loadedModels);
      setUsedFallbackAll(fellBack);
      setRecipes(loadedRecipes);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [includeAllStages]);

  useEffect(() => {
    void loadLeaderboards();
  }, [loadLeaderboards]);

  const recipeLookup = useMemo(() => {
    const map = new Map<string, MemoryLeaderboardEntry>();
    for (const r of recipes) {
      map.set(`${r.recipeName}@${r.recipeVersion}`, r);
      if (!map.has(r.recipeName)) map.set(r.recipeName, r);
    }
    return map;
  }, [recipes]);

  const rankedModels = useMemo<RankedModelRow[]>(() => {
    const rows: RankedModelRow[] = models
      .filter((m) => matchesDomainText(domain, modelSearchHaystack(m, recipeLookup)))
      .map((m) => {
        const er = m.evalReport;
        const certifiedPassAt1 =
          er && typeof er.formalGatePassRate === "number" && typeof er.nonTrivialPassRate === "number"
            ? er.formalGatePassRate * er.nonTrivialPassRate
            : null;
        const paramsB = parseParamsBillions(m.parameterScale);
        const efficiencyPerB =
          certifiedPassAt1 !== null && paramsB !== null && paramsB > 0 ? certifiedPassAt1 / paramsB : null;
        const ece = typeof er?.calibration?.ece === "number" ? er.calibration.ece : null;
        const diskAnnRecallAtK = typeof er?.diskAnnRecallAtK === "number" ? er.diskAnnRecallAtK : null;
        const verified = Boolean(m.ed25519Proof?.proof?.proofValue);
        return {
          model: m,
          paramsB,
          certifiedPassAt1,
          efficiencyPerB,
          ece,
          diskAnnRecallAtK,
          verified,
        };
      });

    rows.sort((a, b) => {
      if (sortBy === "efficiency") {
        const av = a.efficiencyPerB ?? -1;
        const bv = b.efficiencyPerB ?? -1;
        if (bv !== av) return bv - av;
      } else if (sortBy === "ece") {
        const av = a.ece ?? Number.POSITIVE_INFINITY;
        const bv = b.ece ?? Number.POSITIVE_INFINITY;
        if (av !== bv) return av - bv;
      } else if (sortBy === "recall") {
        const av = a.diskAnnRecallAtK ?? -1;
        const bv = b.diskAnnRecallAtK ?? -1;
        if (bv !== av) return bv - av;
      }
      const ac = a.certifiedPassAt1 ?? -1;
      const bc = b.certifiedPassAt1 ?? -1;
      if (bc !== ac) return bc - ac;
      if (Number(b.verified) !== Number(a.verified)) return Number(b.verified) - Number(a.verified);
      return a.model.name.localeCompare(b.model.name);
    });

    return rows;
  }, [models, domain, recipeLookup, sortBy]);

  const filteredRecipes = useMemo(() => {
    return recipes.filter((r) => matchesDomainText(domain, [r.recipeName, r.domain, ...r.dialects].join(" ")));
  }, [recipes, domain]);

  return (
    <PageContainer>
      <HeaderRow>
        <div>
          <PageTitle>Certified Engineering LLM Leaderboard</PageTitle>
          <Subtitle>
            Formal-proof-gated engineering models ranked by Gate 1–4 × Non-Trivial Pass@1, parameter efficiency, Δ_t ECE
            calibration, and DiskANN Recall@k.
          </Subtitle>
        </div>
        <PillGroup>
          <NavLinkButton to="/models">Models Hub</NavLinkButton>
          <NavLinkButton to="/runs">Training Runs</NavLinkButton>
        </PillGroup>
      </HeaderRow>

      <FilterBar>
        <PillGroup>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--ms-text-2, #8b949e)",
              marginRight: 4,
            }}
          >
            Domain
          </span>
          {DOMAIN_FILTERS.map((d) => (
            <Pill key={d} type="button" $active={domain === d} onClick={() => setDomain(d)}>
              {d}
            </Pill>
          ))}
        </PillGroup>

        <PillGroup>
          <Pill type="button" $active={!includeAllStages} onClick={() => setIncludeAllStages(false)}>
            Production (Auto-Fallback)
          </Pill>
          <Pill type="button" $active={includeAllStages} onClick={() => setIncludeAllStages(true)}>
            All Stages
          </Pill>
        </PillGroup>
      </FilterBar>

      {usedFallbackAll && !includeAllStages && (
        <InfoBanner>
          No models are promoted to <strong>Production</strong> yet — showing all registered models (Staging / Draft) as
          a live preview fallback.
        </InfoBanner>
      )}

      {error && (
        <InfoBanner style={{ borderColor: "rgba(248,113,113,0.5)", background: "rgba(239,68,68,0.1)" }}>
          {error}
        </InfoBanner>
      )}

      {/* Primary Certified Models Table */}
      <SectionCard>
        <SectionHeader>
          <SectionTitle>Certified Models &amp; Adapters ({rankedModels.length})</SectionTitle>
          <PillGroup>
            <span style={{ fontSize: 11, color: "var(--ms-text-2, #8b949e)" }}>Sort by:</span>
            <Pill type="button" $active={sortBy === "certifiedPassAt1"} onClick={() => setSortBy("certifiedPassAt1")}>
              Certified Pass@1
            </Pill>
            <Pill type="button" $active={sortBy === "efficiency"} onClick={() => setSortBy("efficiency")}>
              Efficiency / B
            </Pill>
            <Pill type="button" $active={sortBy === "ece"} onClick={() => setSortBy("ece")}>
              Lowest ECE
            </Pill>
            <Pill type="button" $active={sortBy === "recall"} onClick={() => setSortBy("recall")}>
              DiskANN Recall@k
            </Pill>
          </PillGroup>
        </SectionHeader>

        {loading ? (
          <div style={{ padding: 24, color: "var(--ms-text-2, #8b949e)" }}>Loading certified leaderboards…</div>
        ) : rankedModels.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--ms-text-2, #8b949e)", fontSize: 13 }}>
            No registered models matched domain <strong>{domain}</strong>.{" "}
            <Link to="/models" style={{ color: "var(--ms-brand, #38bdf8)" }}>
              Register &amp; certify a model in Models Hub →
            </Link>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <BoardTable>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Model &amp; Kind</th>
                  <th>Parameter Scale</th>
                  <th>Certified Pass@1 (Gate 1–4 × Non-Trivial)</th>
                  <th>Efficiency (Pass@1 / Params B)</th>
                  <th>Δ_t Calibration (ECE)</th>
                  <th>DiskANN Recall@k</th>
                  <th>Ed25519 Verified</th>
                </tr>
              </thead>
              <tbody>
                {rankedModels.map((row, idx) => {
                  const rank = idx + 1;
                  const m = row.model;
                  const er = m.evalReport;
                  return (
                    <tr key={`${m.name}@${m.version}`}>
                      <td>
                        <RankChip $rank={rank}>#{rank}</RankChip>
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          <Link
                            to={`/models/${encodeURIComponent(m.name)}/${encodeURIComponent(m.version)}`}
                            style={{
                              fontWeight: 700,
                              color: "var(--ms-brand, #38bdf8)",
                              textDecoration: "none",
                            }}
                          >
                            {m.name}@{m.version}
                          </Link>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <KindPill $kind={m.kind}>{m.kind}</KindPill>
                            <span style={{ fontSize: 11, color: "var(--ms-text-2, #8b949e)" }}>
                              {m.promotionStage}
                              {m.recipeName ? ` · ${m.recipeName}` : ""}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td style={{ fontFamily: "var(--ms-font-mono, monospace)", fontWeight: 600 }}>
                        {m.parameterScale ?? "—"}
                      </td>
                      <td style={{ fontFamily: "var(--ms-font-mono, monospace)" }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{fmtPct(row.certifiedPassAt1)}</div>
                        {er && (
                          <>
                            <ScoreBarTrack>
                              <ScoreBarFill $pct={(row.certifiedPassAt1 ?? 0) * 100} />
                            </ScoreBarTrack>
                            <div style={{ fontSize: 10, color: "var(--ms-text-2, #8b949e)", marginTop: 2 }}>
                              G1–4 {fmtPct(er.formalGatePassRate, 0)} × NT {fmtPct(er.nonTrivialPassRate, 0)}
                            </div>
                          </>
                        )}
                      </td>
                      <td style={{ fontFamily: "var(--ms-font-mono, monospace)", fontWeight: 600 }}>
                        {row.efficiencyPerB !== null ? `${(row.efficiencyPerB * 100).toFixed(1)} pts/B` : "—"}
                      </td>
                      <td
                        style={{
                          fontFamily: "var(--ms-font-mono, monospace)",
                          fontWeight: 600,
                          color:
                            row.ece === null
                              ? "var(--ms-text-2, #8b949e)"
                              : row.ece <= 0.1
                                ? "#34d399"
                                : row.ece <= 0.2
                                  ? "#fbbf24"
                                  : "#f87171",
                        }}
                      >
                        {fmtNum(row.ece, 4)}
                      </td>
                      <td style={{ fontFamily: "var(--ms-font-mono, monospace)", fontWeight: 600 }}>
                        {fmtPct(row.diskAnnRecallAtK)}
                      </td>
                      <td>
                        <VerifiedBadge
                          $verified={row.verified}
                          title={
                            row.verified
                              ? `Cryptosuite: ${m.ed25519Proof?.proof.cryptosuite} · ${m.ed25519Proof?.proof.verificationMethod}`
                              : "No Ed25519 promotion attestation recorded yet"
                          }
                        >
                          {row.verified ? "✓ Ed25519 Verified" : "Unverified"}
                        </VerifiedBadge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </BoardTable>
          </div>
        )}
      </SectionCard>

      {/* Companion Verified Training Recipes Leaderboard (/api/v1/memory/leaderboards) */}
      <SectionCard>
        <SectionHeader>
          <SectionTitle>Verified Training Recipe Shards ({filteredRecipes.length})</SectionTitle>
          <span style={{ fontSize: 11, color: "var(--ms-text-2, #8b949e)", fontFamily: "monospace" }}>
            Ranking formula: Pass@1 × Gate1To4PassRate
          </span>
        </SectionHeader>

        {filteredRecipes.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--ms-text-2, #8b949e)", fontSize: 13 }}>
            No public verified training-recipe shards indexed for domain <strong>{domain}</strong> yet.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <BoardTable>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Recipe &amp; Dialects</th>
                  <th>Scale Tier</th>
                  <th>Pass@1 × Gate 1–4</th>
                  <th>Efficiency / B</th>
                  <th>Shards / Examples</th>
                  <th>Independent Attestations</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecipes.map((entry, idx) => {
                  const paramsB = parseParamsBillions(entry.parameterScale);
                  const eff = paramsB ? (entry.score * 100) / paramsB : null;
                  return (
                    <tr key={entry.releaseId}>
                      <td>
                        <RankChip $rank={idx + 1}>#{idx + 1}</RankChip>
                      </td>
                      <td>
                        <div style={{ fontWeight: 700, fontFamily: "var(--ms-font-mono, monospace)" }}>
                          {entry.recipeName}@{entry.recipeVersion}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--ms-text-2, #8b949e)" }}>
                          {entry.domain} · {entry.dialects.join(", ")}
                        </div>
                      </td>
                      <td style={{ fontFamily: "var(--ms-font-mono, monospace)" }}>{entry.parameterScale}</td>
                      <td style={{ fontFamily: "var(--ms-font-mono, monospace)", fontWeight: 700 }}>
                        {fmtPct(entry.score)}
                        <div style={{ fontSize: 10, fontWeight: 400, color: "var(--ms-text-2, #8b949e)" }}>
                          Pass@1 {fmtPct(entry.passAt1, 0)} × G1–4 {fmtPct(entry.gate1To4PassRate, 0)}
                        </div>
                      </td>
                      <td style={{ fontFamily: "var(--ms-font-mono, monospace)" }}>
                        {eff !== null ? `${eff.toFixed(1)} pts/B` : "—"}
                      </td>
                      <td style={{ fontFamily: "var(--ms-font-mono, monospace)", fontSize: 12 }}>
                        {entry.shardCount} shards · {entry.totalExamples.toLocaleString()} ex
                      </td>
                      <td>
                        <VerifiedBadge $verified={entry.independentReproductions > 0}>
                          {entry.independentReproductions > 0
                            ? `✓ ${entry.independentReproductions} Ed25519 Repro`
                            : "0 Repro"}
                        </VerifiedBadge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </BoardTable>
          </div>
        )}
      </SectionCard>
    </PageContainer>
  );
};

export default LeaderboardsPage;
