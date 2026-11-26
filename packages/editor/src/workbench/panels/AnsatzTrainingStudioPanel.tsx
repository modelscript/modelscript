// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Ansatz Relational Zonotope & RLVR Training Studio Panel.
 *
 * Provides interactive workbench controls for:
 *   1. Formal RLVR Multi-Gate Reward Weighting & Dynamic-m Curriculum Schedule
 *   2. Live 4-Column Hypergraph `m_init` & Generator Lifecycle / Pruning Interpretability
 *   3. Test-Time Compute Dial (`m = 0` Fast Point <-> `m = 32` Certified) + DiskANN Δ_t > τ Debugger
 *      with 1-click active-learning escalation to the Social RLHF Arena
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MarkdownViewer } from "../markdown/MarkdownViewer";
import type { AnsatzXRayTokenHeat } from "../util/hypergraph-overlay";
import { getRelationalHypergraphInAnsatz, type AnsatzRelationalHypergraphRecord } from "../util/lsp-bridge";
import {
  BrowserOpfsDatasetLoader,
  type CompiledHypergraphShardRow,
  type RemoteDatasetShardInfo,
} from "../util/opfs-dataset-loader";
import {
  applyWorstCaseCornerToSource,
  computeClientEvalRegressionDiff,
  parseClientEvalReportJson,
  SAMPLE_EVAL_REPORT_AFTER,
  SAMPLE_EVAL_REPORT_BEFORE,
  type AppliedCornerMutation,
  type ClientEvalCaseResult,
} from "../util/worst-case-replay";
import {
  createInitialZonotopeWorkbenchState,
  type ModalityPerturbationBudgets,
  type ZonotopePendingOverride,
  type ZonotopeWorkbenchState,
} from "../util/zonotope-workbench-state";
import { RecipeComposerDagView } from "./RecipeComposerDagView";

export type ComputeDialPreset = "fast-m0" | "auto-escalate" | "certified-m32";

export interface AnsatzTrainingStudioPanelProps {
  documentUri: string;
  dialect: string;
  sourceCode: string;
  colorMode: "light" | "dark";
  showHypergraphOverlay?: boolean | undefined;
  onToggleHypergraphOverlay?: ((enabled: boolean) => void) | undefined;
  computeDial?: ComputeDialPreset | undefined;
  onChangeComputeDial?: ((preset: ComputeDialPreset) => void) | undefined;
  onLoadExampleSource?: ((source: string, dialect: string, uri?: string) => void) | undefined;
  onXRayTokenHeatChange?: ((heat: AnsatzXRayTokenHeat[] | null) => void) | undefined;
  apiBaseUrl?: string | undefined;
  zonotopeState?: ZonotopeWorkbenchState | undefined;
  hypergraphRecord?: AnsatzRelationalHypergraphRecord | null | undefined;
  onUpdateZonotopeBudgets?: ((patch: Partial<ModalityPerturbationBudgets>) => void) | undefined;
  onAddZonotopeOverride?: ((override: ZonotopePendingOverride) => void) | undefined;
  onSelectZonotopeGroup?: ((groupId: number | null) => void) | undefined;
  onClearPendingOverrides?: (() => void) | undefined;
  onWorstCaseXiChange?: ((xiMap: Record<number, number>) => void) | undefined;
}

type StudioTab = "rlvr" | "dag" | "prose" | "generators" | "diskann" | "debugger";
type ScrubberSortMode = "m_init_desc" | "dialect_asc";

interface DiskAnnChunkPreview {
  chunkId: string;
  sourceKind: string;
  sourceUri: string;
  packageName?: string | undefined;
  packageVersion?: string | undefined;
  score: number;
  content: string;
  formalVerified: boolean;
}

interface XRayLifecycleEvent {
  layerIndex: number;
  kind: "expanded-nonlinear" | "pruned-vanishing" | "merged-collinear" | "girard-capped" | string;
  mBefore: number;
  mAfter: number;
  groupIds: number[];
  metric: number;
  detail: string;
}

interface XRayLayerWaterfallEntry {
  layerIndex: number;
  layerName: string;
  mIn: number;
  mOut: number;
  maxGeneratorNorm: number;
  meanBoxHalfWidth: number;
  events: XRayLifecycleEvent[];
}

interface XRayWorstCaseCornerEntry {
  groupId: number;
  label: string;
  symbolName?: string | undefined;
  xiSign: 1 | -1;
  contributionMagnitude: number;
}

interface XRayDiagnosticsPayload {
  exampleId: string;
  dialect: string;
  mInit: number;
  meanWorstCaseLoss: number;
  maxSpreadDeltaT: number;
  peakTokenIndex: number;
  peakTokenText: string;
  retrievalTau: number;
  tokenHeat: AnsatzXRayTokenHeat[];
  layerWaterfall: XRayLayerWaterfallEntry[];
  worstCaseCorner: XRayWorstCaseCornerEntry[];
  rewardHackingAudit?:
    | {
        isRewardHacking: boolean;
        reasons: string[];
        requiredSymbolCoverage: number;
      }
    | undefined;
}

interface PreFlightReportPayload {
  totalExamples: number;
  totalTokens: number;
  dialectCounts: Record<string, number>;
  mInitStats: {
    min: number;
    median: number;
    p95: number;
    max: number;
    mean: number;
    histogram?: { m: number; count: number }[] | undefined;
  };
  lockedTokenRatio: number;
  rewardHackingCount: number;
  rewardHackingRate: number;
  suspectedRewardHackingIds: string[];
  bucketingEfficiency: {
    batchSize: number;
    mCap: number;
    bucketCount: number;
    naivePaddedGeneratorOps: number;
    bucketedGeneratorOps: number;
    estimatedVramSavingsPct: number;
    outlierExampleIds: string[];
  };
  diskAnnCoverage: {
    uniqueExampleSymbols: number;
    coveredSymbols: number;
    coverageRatio: number;
    missingSymbols: string[];
  };
}

const DEFAULT_REWARD_WEIGHTS = {
  gate1Syntax: 1.0,
  gate2Units: 1.0,
  gate3Smt: 1.2,
  gate4Dae: 1.5,
  physicsSim: 1.0,
  cadClearance: 1.2,
  zonotopeContraction: 0.6,
};

function parseShardJsonlRows(rawText: string): CompiledHypergraphShardRow[] {
  const rows: CompiledHypergraphShardRow[] = [];
  for (const line of rawText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as CompiledHypergraphShardRow;
      if (parsed && typeof parsed.example_id === "string") {
        rows.push(parsed);
      }
    } catch {
      // skip malformed line
    }
  }
  return rows;
}

function buildFallbackRowSource(row: CompiledHypergraphShardRow): string {
  if (typeof row.source === "string" && row.source.trim().length > 0) {
    return row.source;
  }
  const certSummary = row.formal_cert
    ? `gates=[G1:${row.formal_cert.gate1_glr ? "ok" : "fail"}, G2:${row.formal_cert.gate2_units ? "ok" : "fail"}, G3:${row.formal_cert.gate3_smt ? "ok" : "fail"}, G4:${row.formal_cert.gate4_dae ? "ok" : "fail"}]`
    : "gates=unverified";
  return [
    `// OPFS Shard Example: ${row.example_id}`,
    `// URI: ${row.uri} | Dialect: ${row.dialect} | m_init: ${row.m_init} | Tokens: ${row.token_ids.length}`,
    `// Formal Cert: ${certSummary}`,
    `// (Compact shard row does not embed inline source text; attach source in recipe export to hydrate full code.)`,
  ].join("\n");
}

function buildDefaultEngineeringSpec(
  sourceCode: string,
  dialect: string,
  documentUri: string,
  record: AnsatzRelationalHypergraphRecord | null,
): string {
  const lowerDialect = dialect.toLowerCase();
  if ((lowerDialect === "markdown" || lowerDialect === "reqif") && sourceCode.trim().length > 0) {
    return sourceCode;
  }

  const symbols: string[] = [];
  const seen = new Set<string>();
  const addSym = (raw: string | undefined) => {
    const clean = raw?.trim();
    if (!clean || clean.length < 1 || seen.has(clean)) return;
    if (/^[0-9.+-]+$/.test(clean)) return;
    seen.add(clean);
    symbols.push(clean);
  };

  if (record) {
    for (const grp of record.groups) {
      if (grp.groupId > 0) addSym(grp.label);
      if (symbols.length >= 6) break;
    }
    if (symbols.length < 4) {
      for (const span of record.spans) {
        if (span.groupId > 0) addSym(span.symbolName ?? span.text);
        if (symbols.length >= 6) break;
      }
    }
  }

  if (symbols.length < 4) {
    const paramRegex =
      /\b(?:parameter|constant|Real|Integer|var|param)\s+(?:Real|Integer|Boolean)?\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/g;
    let match: RegExpExecArray | null;
    while ((match = paramRegex.exec(sourceCode)) !== null && symbols.length < 6) {
      addSym(match[1]);
    }
  }

  const s1 = symbols[0] ?? "R";
  const s2 = symbols[1] ?? "C";
  const s3 = symbols[2] ?? "V_max";
  const s4 = symbols[3] ?? "T_limit";
  const docName = documentUri.split("/").pop() || `model.${dialect}`;

  return [
    `# Safety & Tolerance Specification — ${docName}`,
    ``,
    `## REQ-001: Nominal Parameter Perturbation Envelope`,
    `The active ${dialect} model defines coupled physical parameters \`${s1}\` and \`${s2}\`.`,
    `Under worst-case manufacturing and environmental variation (±5% tolerance), \`${s1}\` and \`${s2}\` MUST remain within the certified zonotope envelope while preserving stability margins.`,
    ``,
    `## REQ-002: Hard Safety Invariant`,
    `Peak operating response linked to \`${s3}\` MUST NEVER exceed the rated safety ceiling, and thermal/structural limit \`${s4}\` MUST NOT be violated under any admissible corner ξ ∈ [-1, 1]^m.`,
    ``,
    `## REQ-003: Cross-Modal Traceability`,
    `Click tokens below with the **🔒 Lock(0)** Safety Lock Brush to freeze critical safety terms, or use **+1 Sync / -1 Inv** to couple \`${s1}\` and \`${s2}\` directly with code, 2D schematic, and 3D CAD generators.`,
  ].join("\n");
}

export const AnsatzTrainingStudioPanel: React.FC<AnsatzTrainingStudioPanelProps> = ({
  documentUri,
  dialect,
  sourceCode,
  colorMode,
  showHypergraphOverlay = false,
  onToggleHypergraphOverlay,
  computeDial = "auto-escalate",
  onChangeComputeDial,
  onLoadExampleSource,
  onXRayTokenHeatChange,
  apiBaseUrl = "",
  zonotopeState,
  hypergraphRecord,
  onUpdateZonotopeBudgets,
  onAddZonotopeOverride,
  onSelectZonotopeGroup,
  onClearPendingOverrides,
  onWorstCaseXiChange,
}) => {
  const isDark = colorMode === "dark";
  const [activeTab, setActiveTab] = useState<StudioTab>("rlvr");

  // Reward & Dynamic-m curriculum state
  const [rewards, setRewards] = useState(DEFAULT_REWARD_WEIGHTS);
  const [mStart, setMStart] = useState(1);
  const [mMax, setMMax] = useState(24);
  const [mCap, setMCap] = useState(32);
  const [retrievalTau, setRetrievalTau] = useState(0.35);

  // Hypergraph & OPFS shard state
  const [hypergraph, setHypergraph] = useState<AnsatzRelationalHypergraphRecord | null>(null);
  const fallbackZonotopeState = useMemo(() => createInitialZonotopeWorkbenchState(), []);
  const effectiveZonotopeState = zonotopeState ?? fallbackZonotopeState;
  const effectiveHypergraph = hypergraphRecord ?? hypergraph;
  const [customProseDraft, setCustomProseDraft] = useState<string | null>(null);
  const [isEditingProse, setIsEditingProse] = useState(false);
  const [shards, setShards] = useState<RemoteDatasetShardInfo[]>([]);
  const [shardRows, setShardRows] = useState<CompiledHypergraphShardRow[]>([]);
  const [opfsStatus, setOpfsStatus] = useState<string>("Idle — ready to stream m_init shards into OPFS");

  // DiskANN Δ_t > τ debugger state
  const [localDial, setLocalDial] = useState<ComputeDialPreset>(computeDial);
  const [queryText, setQueryText] = useState("");
  const [packagePinInput, setPackagePinInput] = useState("");
  const [includeSocial, setIncludeSocial] = useState(true);
  const [diskAnnResults, setDiskAnnResults] = useState<DiskAnnChunkPreview[]>([]);
  const [diskAnnLatencyMs, setDiskAnnLatencyMs] = useState<number | null>(null);
  const [escalateStatus, setEscalateStatus] = useState<string | null>(null);

  // Visual Recipe Debugger, OPFS Scrubber & X-Ray state
  const [scrubberSort, setScrubberSort] = useState<ScrubberSortMode>("m_init_desc");
  const [scrubberIndex, setScrubberIndex] = useState(0);
  const [quarantinedIds, setQuarantinedIds] = useState<Set<string>>(() => new Set());
  const [scrubberStatus, setScrubberStatus] = useState<string | null>(null);

  const [xrayResult, setXRayResult] = useState<XRayDiagnosticsPayload | null>(null);
  const [isRunningXRay, setIsRunningXRay] = useState(false);
  const [xrayError, setXRayError] = useState<string | null>(null);
  const [hasActiveHeatmap, setHasActiveHeatmap] = useState(false);

  const [preFlightReport, setPreFlightReport] = useState<PreFlightReportPayload | null>(null);
  const [isRunningPreFlight, setIsRunningPreFlight] = useState(false);
  const [preFlightError, setPreFlightError] = useState<string | null>(null);

  // Live ξ* Worst-Case Corner Replay state
  const [nominalSnapshot, setNominalSnapshot] = useState<{
    source: string;
    dialect: string;
    uri: string;
  } | null>(null);
  const [appliedCornerMutations, setAppliedCornerMutations] = useState<AppliedCornerMutation[]>([]);
  const [cornerReplayNotice, setCornerReplayNotice] = useState<string | null>(null);

  // Side-by-Side Checkpoint / Eval Regression Diff state
  const [evalDiffOpen, setEvalDiffOpen] = useState(false);
  const [evalBeforeText, setEvalBeforeText] = useState("");
  const [evalAfterText, setEvalAfterText] = useState("");
  const [selectedFlippedCaseId, setSelectedFlippedCaseId] = useState<string | null>(null);

  const defaultProseSpec = useMemo(
    () => buildDefaultEngineeringSpec(sourceCode, dialect, documentUri, effectiveHypergraph),
    [sourceCode, dialect, documentUri, effectiveHypergraph],
  );
  const proseDraft = customProseDraft ?? defaultProseSpec;

  useEffect(() => {
    setNominalSnapshot(null);
    setAppliedCornerMutations([]);
    setCornerReplayNotice(null);
    setCustomProseDraft(null);
  }, [documentUri]);

  useEffect(() => {
    setLocalDial(computeDial);
  }, [computeDial]);

  // Refresh live 4-column hypergraph when source/dialect changes
  useEffect(() => {
    let cancelled = false;
    getRelationalHypergraphInAnsatz(documentUri, { source: sourceCode, dialect })
      .then((res) => {
        if (!cancelled && res.success && res.record) {
          setHypergraph(res.record);
        }
      })
      .catch(() => {
        // Non-fatal while LSP worker boots
      });
    return () => {
      cancelled = true;
    };
  }, [documentUri, sourceCode, dialect]);

  const sortedShardRows = useMemo(() => {
    const copy = [...shardRows];
    if (scrubberSort === "m_init_desc") {
      copy.sort((a, b) => b.m_init - a.m_init || a.example_id.localeCompare(b.example_id));
    } else {
      copy.sort(
        (a, b) => a.dialect.localeCompare(b.dialect) || b.m_init - a.m_init || a.example_id.localeCompare(b.example_id),
      );
    }
    return copy;
  }, [shardRows, scrubberSort]);

  const clampedScrubberIndex =
    sortedShardRows.length === 0 ? 0 : Math.min(Math.max(0, scrubberIndex), sortedShardRows.length - 1);
  const activeScrubberRow = sortedShardRows[clampedScrubberIndex] ?? null;

  const handleLoadOpfsShards = useCallback(async () => {
    setOpfsStatus("Fetching compiled m_init shard catalog…");
    try {
      const loader = new BrowserOpfsDatasetLoader(apiBaseUrl);
      const list = await loader.listShards({ dialect });
      setShards(list);
      if (list.length === 0) {
        setShardRows([]);
        setOpfsStatus(`No compiled shards found for '${dialect}' yet.`);
        return;
      }
      const first = list[0]!;
      const rawText = await loader.ensureShardCached(first, (p) => {
        setOpfsStatus(
          `Streaming ${p.shardId.slice(0, 10)}… (${p.bytesDownloaded}/${p.totalBytes} B · ${
            p.cachedInOpfs ? "OPFS" : "RAM"
          })`,
        );
      });
      const parsedRows = parseShardJsonlRows(rawText);
      setShardRows(parsedRows);
      setScrubberIndex(0);
      setOpfsStatus(
        `Cached ${parsedRows.length || first.exampleCount} examples (m_init ∈ [${first.mMin}, ${first.mMax}]) in browser OPFS.`,
      );
    } catch (e) {
      setOpfsStatus(e instanceof Error ? e.message : String(e));
    }
  }, [apiBaseUrl, dialect]);

  const handleQuarantineRow = useCallback(
    async (row: CompiledHypergraphShardRow) => {
      setScrubberStatus(`Submitting quarantine patch for ${row.example_id}…`);
      try {
        const primaryShard = shards[0];
        const res = await fetch(`${apiBaseUrl}/api/v1/recipes/patches`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            exampleId: row.example_id,
            action: "quarantine",
            reason: `Quarantined from Ansatz Visual Recipe Debugger (${row.uri}, m_init=${row.m_init})`,
            uri: row.uri,
            dialect: row.dialect,
            ...(primaryShard ? { recipeName: primaryShard.recipeName, recipeVersion: primaryShard.recipeVersion } : {}),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string; id?: string; patchId?: string };
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setQuarantinedIds((prev) => {
          const next = new Set(prev);
          next.add(row.example_id);
          return next;
        });
        const refId = data.patchId ?? data.id;
        setScrubberStatus(
          `Quarantined '${row.example_id}'${refId ? ` (patch ${refId})` : ""} — excluded from next training pass.`,
        );
      } catch (e) {
        setScrubberStatus(`Quarantine failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [apiBaseUrl, shards],
  );

  const dialMValue = localDial === "fast-m0" ? 0 : localDial === "auto-escalate" ? Math.min(16, mCap) : mCap;

  const handleRunXRayPass = useCallback(async () => {
    setIsRunningXRay(true);
    setXRayError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/v1/recipes/xray`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          source: sourceCode,
          dialect,
          uri: documentUri,
          computeDialM: dialMValue,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        throw new Error(typeof data["error"] === "string" ? data["error"] : `HTTP ${res.status}`);
      }
      const diag = (data["diagnostics"] ?? data["xray"] ?? data["result"] ?? data) as XRayDiagnosticsPayload;
      setXRayResult(diag);
      if (Array.isArray(diag.worstCaseCorner)) {
        const xiMap: Record<number, number> = {};
        for (const entry of diag.worstCaseCorner) {
          xiMap[entry.groupId] = entry.xiSign;
        }
        onWorstCaseXiChange?.(xiMap);
      }
      const heat = Array.isArray(diag.tokenHeat) ? diag.tokenHeat : [];
      onXRayTokenHeatChange?.(heat.length > 0 ? heat : null);
      setHasActiveHeatmap(heat.length > 0);
    } catch (e) {
      setXRayError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsRunningXRay(false);
    }
  }, [apiBaseUrl, sourceCode, dialect, documentUri, dialMValue, onXRayTokenHeatChange, onWorstCaseXiChange]);

  const handleClearXRayHeatmap = useCallback(() => {
    onXRayTokenHeatChange?.(null);
    setHasActiveHeatmap(false);
  }, [onXRayTokenHeatChange]);

  const handleRunPreFlightAudit = useCallback(async () => {
    setIsRunningPreFlight(true);
    setPreFlightError(null);
    try {
      const shardExamplesWithSource = sortedShardRows
        .filter((r) => typeof r.source === "string" && r.source.trim().length > 0)
        .slice(0, 200)
        .map((r) => ({
          exampleId: r.example_id,
          uri: r.uri,
          dialect: r.dialect,
          source: r.source!,
        }));
      const examples =
        shardExamplesWithSource.length > 0
          ? shardExamplesWithSource
          : [{ uri: documentUri, dialect, source: sourceCode }];

      const res = await fetch(`${apiBaseUrl}/api/v1/recipes/preflight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          examples,
          batchSize: 8,
          mCap,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        throw new Error(typeof data["error"] === "string" ? data["error"] : `HTTP ${res.status}`);
      }
      const report = (data["report"] ?? data["preflight"] ?? data["result"] ?? data) as PreFlightReportPayload;
      setPreFlightReport(report);
    } catch (e) {
      setPreFlightError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsRunningPreFlight(false);
    }
  }, [apiBaseUrl, sortedShardRows, documentUri, dialect, sourceCode, mCap]);

  const handleQueryDiskAnn = useCallback(async () => {
    const q =
      queryText.trim() ||
      `${dialect} ${
        hypergraph?.groups
          .map((g) => g.label)
          .slice(0, 4)
          .join(" ") ?? ""
      }`.trim();
    if (!q) return;
    let packagePins: Record<string, string> | undefined;
    if (packagePinInput.trim()) {
      packagePins = {};
      for (const pair of packagePinInput.split(",")) {
        const idx = pair.lastIndexOf("@");
        if (idx > 0) {
          packagePins[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
        }
      }
    }
    try {
      const res = await fetch(`${apiBaseUrl}/api/v1/memory/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          mode: "hybrid",
          textQuery: q,
          packagePins,
          dialects: [dialect, "markdown", "owl2"],
          includeSocialPosts: includeSocial,
          topK: 5,
        }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.chunks)) {
        setDiskAnnResults(data.chunks as DiskAnnChunkPreview[]);
        setDiskAnnLatencyMs(typeof data.latencyMs === "number" ? data.latencyMs : null);
      }
    } catch {
      // ignore offline error
    }
  }, [apiBaseUrl, queryText, packagePinInput, includeSocial, dialect, hypergraph]);

  const handleEscalateToSocialArena = useCallback(async () => {
    setEscalateStatus("Publishing uncollapsed Δ_t > τ challenge to Social RLHF Arena…");
    try {
      const res = await fetch(`${apiBaseUrl}/api/v1/rlhf/challenges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          challengeType: "tolerance_labeling",
          dialect,
          title: `Active Learning Escalation: ${documentUri.split("/").pop() || dialect}`,
          prompt: `Output zonotope spread exceeded τ=${retrievalTau} even after DiskANN lookup. Please lock invariant syntax/safety tokens (group_id=0) or verify tolerances.`,
          sourceCode,
          deltaTTrigger: Number((retrievalTau + 0.14).toFixed(2)),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setEscalateStatus(`Escalated to Social RLHF Arena → /annotate/${data.id}`);
    } catch (e) {
      setEscalateStatus(e instanceof Error ? e.message : String(e));
    }
  }, [apiBaseUrl, dialect, documentUri, retrievalTau, sourceCode]);

  const handleReplayWorstCaseCorner = useCallback(
    (entries: readonly XRayWorstCaseCornerEntry[]) => {
      if (entries.length === 0) return;
      const baseSource = nominalSnapshot?.source ?? sourceCode;
      const baseDialect = nominalSnapshot?.dialect ?? dialect;
      const baseUri = nominalSnapshot?.uri ?? documentUri;
      const res = applyWorstCaseCornerToSource(baseSource, entries, 0.05);
      if (res.appliedMutations.length === 0) {
        setAppliedCornerMutations([]);
        setCornerReplayNotice(
          "No matching numeric parameter assignments found in the active source for the selected ξ* symbol(s).",
        );
        return;
      }
      if (!nominalSnapshot) {
        setNominalSnapshot({ source: sourceCode, dialect, uri: documentUri });
      }
      setAppliedCornerMutations(res.appliedMutations);
      setCornerReplayNotice(null);
      onLoadExampleSource?.(res.perturbedSource, baseDialect, baseUri);
    },
    [nominalSnapshot, sourceCode, dialect, documentUri, onLoadExampleSource],
  );

  const handleRestoreNominal = useCallback(() => {
    if (!nominalSnapshot) return;
    onLoadExampleSource?.(nominalSnapshot.source, nominalSnapshot.dialect, nominalSnapshot.uri);
    setNominalSnapshot(null);
    setAppliedCornerMutations([]);
    setCornerReplayNotice(null);
  }, [nominalSnapshot, onLoadExampleSource]);

  const handleLoadSampleEvalDiff = useCallback(() => {
    setEvalBeforeText(JSON.stringify(SAMPLE_EVAL_REPORT_BEFORE, null, 2));
    setEvalAfterText(JSON.stringify(SAMPLE_EVAL_REPORT_AFTER, null, 2));
    setEvalDiffOpen(true);
    setSelectedFlippedCaseId("modelica/thermal_pid_loop");
  }, []);

  const evalDiffAnalysis = useMemo(() => {
    const beforeTrim = evalBeforeText.trim();
    const afterTrim = evalAfterText.trim();
    const beforeParsed = beforeTrim ? parseClientEvalReportJson(beforeTrim) : { report: null, error: null };
    const afterParsed = afterTrim ? parseClientEvalReportJson(afterTrim) : { report: null, error: null };
    const diff =
      beforeParsed.report && afterParsed.report
        ? computeClientEvalRegressionDiff(beforeParsed.report, afterParsed.report)
        : null;

    let selectedBeforeCase: ClientEvalCaseResult | null = null;
    let selectedAfterCase: ClientEvalCaseResult | null = null;
    if (selectedFlippedCaseId && beforeParsed.report && afterParsed.report) {
      selectedBeforeCase = beforeParsed.report.perCase.find((c) => c.caseId === selectedFlippedCaseId) ?? null;
      selectedAfterCase = afterParsed.report.perCase.find((c) => c.caseId === selectedFlippedCaseId) ?? null;
    }

    return {
      beforeReport: beforeParsed.report,
      beforeError: beforeParsed.error,
      afterReport: afterParsed.report,
      afterError: afterParsed.error,
      diff,
      selectedBeforeCase,
      selectedAfterCase,
    };
  }, [evalBeforeText, evalAfterText, selectedFlippedCaseId]);

  const border = isDark ? "#30363d" : "#d0d7de";
  const bg = isDark ? "#0d1117" : "#ffffff";
  const bgSubtle = isDark ? "#161b22" : "#f6f8fa";
  const fg = isDark ? "#e6edf3" : "#1f2328";
  const fgMuted = isDark ? "#8b949e" : "#656d76";
  const accent = isDark ? "#38bdf8" : "#0969da";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: bg,
        color: fg,
        fontSize: 12,
        overflow: "hidden",
      }}
    >
      {/* Header & Tabs */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "8px 12px",
          borderBottom: `1px solid ${border}`,
          background: bgSubtle,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(
            [
              ["rlvr", "RLVR & Dynamic-m"],
              ["dag", "Recipe DAG"],
              ["prose", "Prose & Spec"],
              ["generators", `Generators (m=${effectiveHypergraph?.mInit ?? 0})`],
              ["diskann", `DiskANN & Dial (m=${dialMValue})`],
              ["debugger", "Debugger & X-Ray"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                border: `1px solid ${activeTab === id ? accent : border}`,
                background: activeTab === id ? "rgba(56,189,248,0.14)" : "transparent",
                color: activeTab === id ? accent : fg,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {onToggleHypergraphOverlay && (
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 11 }}>
            <input
              type="checkbox"
              checked={showHypergraphOverlay}
              onChange={(e) => onToggleHypergraphOverlay(e.target.checked)}
            />
            Monaco <code>group_id</code> Overlay
          </label>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        {activeTab === "dag" && (
          <RecipeComposerDagView
            colorMode={colorMode}
            dialect={dialect}
            apiBaseUrl={apiBaseUrl}
            currentSource={sourceCode}
            currentDialect={dialect}
            currentDocumentUri={documentUri}
            zonotopeState={zonotopeState}
            onUpdateZonotopeBudgets={onUpdateZonotopeBudgets}
            onClearPendingOverrides={onClearPendingOverrides}
            mStart={mStart}
            mMax={mMax}
            mCap={mCap}
            retrievalTau={retrievalTau}
            rewardWeights={rewards}
            onUpdateDynamicM={(next) => {
              setMStart(next.mStart);
              setMMax(next.mMax);
              setMCap(next.mCap);
            }}
          />
        )}

        {activeTab === "prose" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                flexWrap: "wrap",
                padding: "6px 10px",
                borderRadius: 8,
                border: `1px solid ${border}`,
                background: bgSubtle,
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 12 }}>Prose &amp; Requirements Spec (Zonotope Annotator)</div>
                <div style={{ fontSize: 11, color: fgMuted }}>
                  Use the docked ribbon brushes (🔒 Lock(0), +1 Sync, -1 Inv) directly on requirement tokens, coref
                  chips, and paraphrase neighborhoods.
                </div>
              </div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <button
                  type="button"
                  onClick={() => setIsEditingProse((v) => !v)}
                  style={{
                    padding: "4px 9px",
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    border: `1px solid ${isEditingProse ? accent : border}`,
                    background: isEditingProse ? "rgba(56,189,248,0.14)" : "transparent",
                    color: isEditingProse ? accent : fg,
                  }}
                >
                  {isEditingProse ? "Hide Markdown Editor" : "Edit Spec Markdown"}
                </button>
                {customProseDraft !== null && (
                  <button
                    type="button"
                    onClick={() => setCustomProseDraft(null)}
                    style={{
                      padding: "4px 9px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 500,
                      cursor: "pointer",
                      border: `1px solid ${border}`,
                      background: "transparent",
                      color: fgMuted,
                    }}
                  >
                    Reset Spec
                  </button>
                )}
              </div>
            </div>

            {isEditingProse && (
              <textarea
                aria-label="Engineering specification markdown"
                value={proseDraft}
                onChange={(e) => setCustomProseDraft(e.target.value)}
                rows={8}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: 10,
                  borderRadius: 8,
                  border: `1px solid ${border}`,
                  background: isDark ? "#0b1120" : "#ffffff",
                  color: fg,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 11.5,
                  lineHeight: 1.45,
                  resize: "vertical",
                }}
              />
            )}

            <div
              style={{
                border: `1px solid ${border}`,
                borderRadius: 8,
                padding: 12,
                background: isDark ? "rgba(15, 23, 42, 0.55)" : "#ffffff",
              }}
            >
              <MarkdownViewer
                content={proseDraft}
                showZonotopeOverlay={true}
                zonotopeWorkbenchState={effectiveZonotopeState}
                hypergraphRecord={effectiveHypergraph}
                colorMode={colorMode}
                onAddZonotopeOverride={onAddZonotopeOverride}
                onSelectZonotopeGroup={onSelectZonotopeGroup}
              />
            </div>
          </div>
        )}

        {activeTab === "rlvr" && (
          <>
            <div style={{ border: `1px solid ${border}`, borderRadius: 8, padding: 10 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>
                4-Gate Formal RLVR Reward Composer (0.5B–1.5B LoRA)
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {(Object.keys(rewards) as (keyof typeof DEFAULT_REWARD_WEIGHTS)[]).map((k) => (
                  <label key={k} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: fgMuted }}>
                      <span>{k}</span>
                      <code>{rewards[k].toFixed(2)}</code>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={3}
                      step={0.1}
                      value={rewards[k]}
                      onChange={(e) => setRewards((prev) => ({ ...prev, [k]: Number(e.target.value) }))}
                    />
                  </label>
                ))}
              </div>
            </div>

            <div style={{ border: `1px solid ${border}`, borderRadius: 8, padding: 10 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Dynamic-m Curriculum & Safety Cap</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                <label style={{ fontSize: 11 }}>
                  m_start: <code>{mStart}</code>
                  <input
                    type="range"
                    min={1}
                    max={8}
                    value={mStart}
                    onChange={(e) => setMStart(Number(e.target.value))}
                    style={{ width: "100%" }}
                  />
                </label>
                <label style={{ fontSize: 11 }}>
                  m_max: <code>{mMax}</code>
                  <input
                    type="range"
                    min={4}
                    max={32}
                    value={mMax}
                    onChange={(e) => setMMax(Number(e.target.value))}
                    style={{ width: "100%" }}
                  />
                </label>
                <label style={{ fontSize: 11 }}>
                  m_cap: <code>{mCap}</code>
                  <input
                    type="range"
                    min={8}
                    max={64}
                    value={mCap}
                    onChange={(e) => setMCap(Number(e.target.value))}
                    style={{ width: "100%" }}
                  />
                </label>
                <label style={{ fontSize: 11 }}>
                  τ (Δ_t): <code>{retrievalTau.toFixed(2)}</code>
                  <input
                    type="range"
                    min={0.05}
                    max={1.0}
                    step={0.05}
                    value={retrievalTau}
                    onChange={(e) => setRetrievalTau(Number(e.target.value))}
                    style={{ width: "100%" }}
                  />
                </label>
              </div>
            </div>

            <div style={{ border: `1px solid ${border}`, borderRadius: 8, padding: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <strong>Browser OPFS Shard DataLoader (HTTP 206 Range)</strong>
                <button
                  type="button"
                  onClick={handleLoadOpfsShards}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 6,
                    border: `1px solid ${accent}`,
                    background: "rgba(56,189,248,0.14)",
                    color: accent,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Stream &amp; Cache Shards
                </button>
              </div>
              <div style={{ fontSize: 11, color: fgMuted, fontFamily: "monospace" }}>{opfsStatus}</div>
              {shards.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 11, color: fgMuted }}>
                  {shards.length} bucketed shard(s) indexed for <code>{dialect}</code>.
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === "generators" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 11, color: fgMuted }}>
              Input-Adaptive Allocation (Layer 0): <code>m_init = {hypergraph?.mInit ?? 0}</code> active generators ·{" "}
              <code>{hypergraph?.tokenIds.length ?? 0}</code> aligned tokens
            </div>
            {(hypergraph?.groups ?? []).map((g) => (
              <div
                key={g.groupId}
                style={{
                  border: `1px solid ${border}`,
                  borderRadius: 8,
                  padding: "6px 10px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span style={{ fontFamily: "monospace", fontWeight: 600 }}>
                  ε_{g.groupId}: {g.label}
                </span>
                <span style={{ fontSize: 11, color: fgMuted }}>
                  {g.tokenCount} tokens · rel={g.primaryRelType}
                </span>
              </div>
            ))}
          </div>
        )}

        {activeTab === "diskann" && (
          <>
            <div style={{ border: `1px solid ${border}`, borderRadius: 8, padding: 10 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Test-Time Compute Dial (m = 0 ↔ {mCap})</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {(
                  [
                    ["fast-m0", "m = 0 (Fast Point)"],
                    ["auto-escalate", "Auto-Escalate (Δ_t > τ)"],
                    ["certified-m32", `Certified (m = ${mCap})`],
                  ] as const
                ).map(([preset, label]) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setLocalDial(preset);
                      onChangeComputeDial?.(preset);
                    }}
                    style={{
                      padding: "5px 10px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer",
                      border: `1px solid ${localDial === preset ? accent : border}`,
                      background: localDial === preset ? "rgba(56,189,248,0.16)" : "transparent",
                      color: localDial === preset ? accent : fg,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div
              style={{
                border: `1px solid ${border}`,
                borderRadius: 8,
                padding: 10,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ fontWeight: 600 }}>DiskANN NVMe Memory &amp; Δ_t &gt; τ Retrieval Debugger</div>
              <input
                type="text"
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                placeholder="Query symbols, OWL2 classes, or verified social fixes…"
                style={{
                  background: bgSubtle,
                  color: fg,
                  border: `1px solid ${border}`,
                  borderRadius: 6,
                  padding: "6px 8px",
                  fontSize: 12,
                }}
              />
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  type="text"
                  value={packagePinInput}
                  onChange={(e) => setPackagePinInput(e.target.value)}
                  placeholder="Optional semver pins: @ms/thermal-pack@1.0.0"
                  style={{
                    flex: 1,
                    background: bgSubtle,
                    color: fg,
                    border: `1px solid ${border}`,
                    borderRadius: 6,
                    padding: "5px 8px",
                    fontSize: 11,
                  }}
                />
                <label style={{ fontSize: 11, display: "inline-flex", gap: 4, alignItems: "center" }}>
                  <input type="checkbox" checked={includeSocial} onChange={(e) => setIncludeSocial(e.target.checked)} />
                  Social Fixes
                </label>
                <button
                  type="button"
                  onClick={handleQueryDiskAnn}
                  style={{
                    padding: "5px 12px",
                    borderRadius: 6,
                    border: `1px solid ${accent}`,
                    background: "rgba(56,189,248,0.15)",
                    color: accent,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Query DiskANN
                </button>
              </div>
              {diskAnnLatencyMs !== null && (
                <div style={{ fontSize: 11, color: "#34d399", fontFamily: "monospace" }}>
                  DiskANN INT8 beam + NVMe FP32 rerank: {diskAnnLatencyMs.toFixed(2)} ms · {diskAnnResults.length}{" "}
                  chunks
                </div>
              )}
              {diskAnnResults.map((ch) => (
                <div
                  key={ch.chunkId}
                  style={{ border: `1px solid ${border}`, borderRadius: 6, padding: 8, background: bgSubtle }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                    <code>{ch.sourceUri}</code>
                    <span style={{ color: ch.formalVerified ? "#34d399" : fgMuted }}>
                      score={ch.score} {ch.formalVerified ? "· ✓ Verified" : ""}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: fgMuted }}>{ch.content.slice(0, 220)}</div>
                </div>
              ))}
            </div>

            <div style={{ border: `1px solid ${border}`, borderRadius: 8, padding: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: fgMuted }}>
                  Uncollapsed spread (Δ_t &gt; τ) after retrieval? Escalate for crowd verification.
                </span>
                <button
                  type="button"
                  onClick={handleEscalateToSocialArena}
                  style={{
                    padding: "5px 10px",
                    borderRadius: 6,
                    border: "1px solid rgba(251,191,36,0.5)",
                    background: "rgba(251,191,36,0.14)",
                    color: "#fbbf24",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Escalate to Social Arena
                </button>
              </div>
              {escalateStatus && (
                <div style={{ marginTop: 6, fontSize: 11, fontFamily: "monospace", color: accent }}>
                  {escalateStatus}
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === "debugger" && (
          <>
            {/* 1. OPFS Dataset Scrubber */}
            <div
              style={{
                border: `1px solid ${border}`,
                borderRadius: 8,
                padding: 10,
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
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <strong>OPFS Dataset Scrubber</strong>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <label style={{ fontSize: 11, color: fgMuted, display: "inline-flex", alignItems: "center", gap: 4 }}>
                    Sort:
                    <select
                      value={scrubberSort}
                      onChange={(e) => {
                        setScrubberSort(e.target.value as ScrubberSortMode);
                        setScrubberIndex(0);
                      }}
                      style={{
                        background: bgSubtle,
                        color: fg,
                        border: `1px solid ${border}`,
                        borderRadius: 5,
                        padding: "2px 6px",
                        fontSize: 11,
                      }}
                    >
                      <option value="m_init_desc">Highest m_init</option>
                      <option value="dialect_asc">Dialect</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={handleLoadOpfsShards}
                    style={{
                      padding: "4px 8px",
                      borderRadius: 6,
                      border: `1px solid ${border}`,
                      background: bgSubtle,
                      color: fg,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {sortedShardRows.length > 0 ? "Refresh OPFS Shards" : "Load OPFS Shards"}
                  </button>
                </div>
              </div>

              {sortedShardRows.length === 0 ? (
                <div style={{ fontSize: 11, color: fgMuted }}>
                  No OPFS shard rows loaded yet ({opfsStatus}). Click <strong>Load OPFS Shards</strong> to stream cached{" "}
                  <code>m_init</code>-bucketed examples.
                </div>
              ) : (
                <>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button
                        type="button"
                        disabled={clampedScrubberIndex <= 0}
                        onClick={() => setScrubberIndex((i) => Math.max(0, i - 1))}
                        style={{
                          padding: "3px 8px",
                          borderRadius: 5,
                          border: `1px solid ${border}`,
                          background: bgSubtle,
                          color: clampedScrubberIndex <= 0 ? fgMuted : fg,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: clampedScrubberIndex <= 0 ? "not-allowed" : "pointer",
                        }}
                      >
                        Prev
                      </button>
                      <span style={{ fontSize: 11, fontFamily: "monospace", color: fgMuted }}>
                        Example {clampedScrubberIndex + 1} of {sortedShardRows.length}
                      </span>
                      <button
                        type="button"
                        disabled={clampedScrubberIndex >= sortedShardRows.length - 1}
                        onClick={() => setScrubberIndex((i) => Math.min(sortedShardRows.length - 1, i + 1))}
                        style={{
                          padding: "3px 8px",
                          borderRadius: 5,
                          border: `1px solid ${border}`,
                          background: bgSubtle,
                          color: clampedScrubberIndex >= sortedShardRows.length - 1 ? fgMuted : fg,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: clampedScrubberIndex >= sortedShardRows.length - 1 ? "not-allowed" : "pointer",
                        }}
                      >
                        Next
                      </button>
                    </div>

                    {activeScrubberRow && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() =>
                            onLoadExampleSource?.(
                              buildFallbackRowSource(activeScrubberRow),
                              activeScrubberRow.dialect,
                              activeScrubberRow.uri,
                            )
                          }
                          disabled={!onLoadExampleSource}
                          style={{
                            padding: "4px 10px",
                            borderRadius: 6,
                            border: `1px solid ${accent}`,
                            background: "rgba(56,189,248,0.15)",
                            color: accent,
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: onLoadExampleSource ? "pointer" : "not-allowed",
                          }}
                        >
                          Load in Viewport
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleQuarantineRow(activeScrubberRow)}
                          style={{
                            padding: "4px 10px",
                            borderRadius: 6,
                            border: "1px solid rgba(244,63,94,0.55)",
                            background: "rgba(244,63,94,0.14)",
                            color: "#fb7185",
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          {quarantinedIds.has(activeScrubberRow.example_id) ? "Quarantined ✓" : "Quarantine Patch"}
                        </button>
                      </div>
                    )}
                  </div>

                  {activeScrubberRow && (
                    <div
                      style={{
                        border: `1px solid ${border}`,
                        borderRadius: 6,
                        padding: 8,
                        background: bgSubtle,
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        <code style={{ fontWeight: 600 }}>{activeScrubberRow.uri}</code>
                        <div style={{ display: "flex", gap: 6, fontSize: 11, fontFamily: "monospace" }}>
                          <span style={{ color: accent }}>m_init={activeScrubberRow.m_init}</span>
                          <span style={{ color: fgMuted }}>dialect={activeScrubberRow.dialect}</span>
                          <span style={{ color: fgMuted }}>{activeScrubberRow.token_ids.length} tok</span>
                        </div>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          fontSize: 11,
                          color: fgMuted,
                        }}
                      >
                        <span>
                          id: <code>{activeScrubberRow.example_id}</code>
                        </span>
                        {activeScrubberRow.formal_cert && (
                          <span style={{ fontFamily: "monospace" }}>
                            G1:{activeScrubberRow.formal_cert.gate1_glr ? "✓" : "✗"} · G2:
                            {activeScrubberRow.formal_cert.gate2_units ? "✓" : "✗"} · G3:
                            {activeScrubberRow.formal_cert.gate3_smt ? "✓" : "✗"} · G4:
                            {activeScrubberRow.formal_cert.gate4_dae ? "✓" : "✗"}
                          </span>
                        )}
                      </div>
                      {activeScrubberRow.source && (
                        <pre
                          style={{
                            margin: "4px 0 0",
                            padding: 6,
                            borderRadius: 4,
                            background: bg,
                            border: `1px solid ${border}`,
                            fontSize: 10,
                            maxHeight: 84,
                            overflow: "auto",
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {activeScrubberRow.source.slice(0, 420)}
                        </pre>
                      )}
                    </div>
                  )}
                </>
              )}

              {scrubberStatus && (
                <div style={{ fontSize: 11, fontFamily: "monospace", color: accent }}>{scrubberStatus}</div>
              )}
            </div>

            {/* 2. Single-Example X-Ray Runner */}
            <div
              style={{
                border: `1px solid ${border}`,
                borderRadius: 8,
                padding: 10,
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
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <strong>Single-Example X-Ray Runner (Δ_t &amp; Loss Heatmap)</strong>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    disabled={isRunningXRay}
                    onClick={() => void handleRunXRayPass()}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 6,
                      border: `1px solid ${accent}`,
                      background: "rgba(56,189,248,0.16)",
                      color: accent,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: isRunningXRay ? "wait" : "pointer",
                    }}
                  >
                    {isRunningXRay ? "Running X-Ray…" : "Run X-Ray Pass"}
                  </button>
                  <button
                    type="button"
                    disabled={!hasActiveHeatmap}
                    onClick={handleClearXRayHeatmap}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 6,
                      border: `1px solid ${border}`,
                      background: bgSubtle,
                      color: hasActiveHeatmap ? fg : fgMuted,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: hasActiveHeatmap ? "pointer" : "not-allowed",
                    }}
                  >
                    Clear Heatmap
                  </button>
                </div>
              </div>

              {xrayError && (
                <div style={{ fontSize: 11, color: "#fb7185", fontFamily: "monospace" }}>X-Ray error: {xrayError}</div>
              )}

              {xrayResult && (
                <>
                  {/* Summary metrics */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
                    <div style={{ border: `1px solid ${border}`, borderRadius: 6, padding: 6, background: bgSubtle }}>
                      <div style={{ fontSize: 10, color: fgMuted }}>meanWorstCaseLoss</div>
                      <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13 }}>
                        {xrayResult.meanWorstCaseLoss.toFixed(4)}
                      </div>
                    </div>
                    <div style={{ border: `1px solid ${border}`, borderRadius: 6, padding: 6, background: bgSubtle }}>
                      <div style={{ fontSize: 10, color: fgMuted }}>maxSpreadDeltaT</div>
                      <div
                        style={{
                          fontFamily: "monospace",
                          fontWeight: 700,
                          fontSize: 13,
                          color: xrayResult.maxSpreadDeltaT > xrayResult.retrievalTau ? "#fb7185" : "#34d399",
                        }}
                      >
                        {xrayResult.maxSpreadDeltaT.toFixed(5)}
                      </div>
                    </div>
                    <div style={{ border: `1px solid ${border}`, borderRadius: 6, padding: 6, background: bgSubtle }}>
                      <div style={{ fontSize: 10, color: fgMuted }}>peakTokenText</div>
                      <div
                        style={{
                          fontFamily: "monospace",
                          fontWeight: 700,
                          fontSize: 12,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={xrayResult.peakTokenText}
                      >
                        {xrayResult.peakTokenText || "—"}
                      </div>
                    </div>
                    <div style={{ border: `1px solid ${border}`, borderRadius: 6, padding: 6, background: bgSubtle }}>
                      <div style={{ fontSize: 10, color: fgMuted }}>Reward-Hacking Gate</div>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: 11,
                          marginTop: 2,
                          color: xrayResult.rewardHackingAudit?.isRewardHacking ? "#fb7185" : "#34d399",
                        }}
                      >
                        {xrayResult.rewardHackingAudit?.isRewardHacking ? "⚠ Flagged" : "✓ Clean"}
                      </div>
                    </div>
                  </div>

                  {xrayResult.rewardHackingAudit?.isRewardHacking &&
                    xrayResult.rewardHackingAudit.reasons.length > 0 && (
                      <div
                        style={{
                          border: "1px solid rgba(244,63,94,0.45)",
                          background: "rgba(244,63,94,0.1)",
                          borderRadius: 6,
                          padding: "6px 8px",
                          fontSize: 11,
                          color: "#fb7185",
                        }}
                      >
                        {xrayResult.rewardHackingAudit.reasons.join(" · ")}
                      </div>
                    )}

                  {/* Generator Lifecycle Waterfall */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ fontSize: 11, fontWeight: 600 }}>Generator Lifecycle Waterfall</div>
                    {(xrayResult.layerWaterfall ?? []).length === 0 ? (
                      <div style={{ fontSize: 11, color: fgMuted }}>No layer telemetry reported.</div>
                    ) : (
                      (xrayResult.layerWaterfall ?? []).map((layer) => (
                        <div
                          key={`${layer.layerIndex}-${layer.layerName}`}
                          style={{
                            border: `1px solid ${border}`,
                            borderRadius: 6,
                            padding: "6px 8px",
                            background: bgSubtle,
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              fontSize: 11,
                            }}
                          >
                            <span style={{ fontFamily: "monospace", fontWeight: 600 }}>
                              L{layer.layerIndex} · {layer.layerName}
                            </span>
                            <span style={{ fontFamily: "monospace", color: fgMuted }}>
                              m: <strong style={{ color: fg }}>{layer.mIn}</strong> →{" "}
                              <strong style={{ color: layer.mOut > layer.mIn ? "#fbbf24" : "#34d399" }}>
                                {layer.mOut}
                              </strong>{" "}
                              · ‖G‖max={layer.maxGeneratorNorm.toFixed(4)}
                            </span>
                          </div>
                          {layer.events && layer.events.length > 0 && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              {layer.events.map((ev, idx) => (
                                <div key={idx} style={{ fontSize: 10, fontFamily: "monospace", color: fgMuted }}>
                                  <span
                                    style={{
                                      color:
                                        ev.kind === "expanded-nonlinear"
                                          ? "#fbbf24"
                                          : ev.kind === "girard-capped"
                                            ? "#fb7185"
                                            : "#34d399",
                                      fontWeight: 600,
                                    }}
                                  >
                                    [{ev.kind}]
                                  </span>{" "}
                                  {ev.mBefore}→{ev.mAfter} · {ev.detail}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>

                  {/* Worst-Case Perturbation Corner (ξ*) Table */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 6,
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 600 }}>Worst-Case Perturbation Corner (ξ*)</div>
                      {(xrayResult.worstCaseCorner ?? []).length > 0 && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            disabled={!onLoadExampleSource}
                            onClick={() => handleReplayWorstCaseCorner(xrayResult.worstCaseCorner ?? [])}
                            style={{
                              padding: "3px 8px",
                              borderRadius: 5,
                              border: `1px solid ${accent}`,
                              background: "rgba(56,189,248,0.15)",
                              color: accent,
                              fontSize: 10,
                              fontWeight: 600,
                              cursor: onLoadExampleSource ? "pointer" : "not-allowed",
                            }}
                          >
                            Replay ξ* Corner in Viewport
                          </button>
                          <button
                            type="button"
                            disabled={!nominalSnapshot || !onLoadExampleSource}
                            onClick={handleRestoreNominal}
                            style={{
                              padding: "3px 8px",
                              borderRadius: 5,
                              border: `1px solid ${nominalSnapshot ? "rgba(52,211,153,0.55)" : border}`,
                              background: nominalSnapshot ? "rgba(52,211,153,0.14)" : bgSubtle,
                              color: nominalSnapshot ? "#34d399" : fgMuted,
                              fontSize: 10,
                              fontWeight: 600,
                              cursor: nominalSnapshot && onLoadExampleSource ? "pointer" : "not-allowed",
                            }}
                          >
                            Restore Nominal
                          </button>
                        </div>
                      )}
                    </div>

                    {appliedCornerMutations.length > 0 && (
                      <div
                        style={{
                          border: "1px solid rgba(56,189,248,0.4)",
                          background: "rgba(56,189,248,0.08)",
                          borderRadius: 6,
                          padding: "6px 8px",
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                        }}
                      >
                        <div style={{ fontSize: 10, fontWeight: 600, color: accent }}>
                          Active ξ* Viewport Replay ({appliedCornerMutations.length} parameter mutation
                          {appliedCornerMutations.length === 1 ? "" : "s"} applied):
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {appliedCornerMutations.map((m) => (
                            <code
                              key={`${m.symbolName}-${m.xiSign}`}
                              style={{
                                padding: "2px 6px",
                                borderRadius: 4,
                                border: `1px solid ${m.xiSign > 0 ? "rgba(56,189,248,0.45)" : "rgba(251,113,133,0.45)"}`,
                                background: m.xiSign > 0 ? "rgba(56,189,248,0.12)" : "rgba(251,113,133,0.12)",
                                color: m.xiSign > 0 ? "#38bdf8" : "#fb7185",
                                fontSize: 10,
                              }}
                            >
                              {m.symbolName}: {m.before} -&gt; {m.after}
                            </code>
                          ))}
                        </div>
                      </div>
                    )}

                    {cornerReplayNotice && (
                      <div style={{ fontSize: 10, color: "#fbbf24", fontFamily: "monospace" }}>
                        {cornerReplayNotice}
                      </div>
                    )}

                    {(xrayResult.worstCaseCorner ?? []).length === 0 ? (
                      <div style={{ fontSize: 11, color: fgMuted }}>No active generators at peak token.</div>
                    ) : (
                      <div style={{ border: `1px solid ${border}`, borderRadius: 6, overflow: "hidden" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                          <thead>
                            <tr
                              style={{ background: bgSubtle, borderBottom: `1px solid ${border}`, textAlign: "left" }}
                            >
                              <th style={{ padding: "5px 8px", fontWeight: 600 }}>Symbol (click row to replay)</th>
                              <th style={{ padding: "5px 8px", fontWeight: 600 }}>ξ*</th>
                              <th style={{ padding: "5px 8px", fontWeight: 600, textAlign: "right" }}>Contribution</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(xrayResult.worstCaseCorner ?? []).slice(0, 12).map((row, idx) => (
                              <tr
                                key={`${row.groupId}-${idx}`}
                                onClick={() => handleReplayWorstCaseCorner([row])}
                                title="Click to replay this single ξ* generator perturbation in the viewport"
                                style={{
                                  borderTop: idx > 0 ? `1px solid ${border}` : undefined,
                                  cursor: onLoadExampleSource ? "pointer" : "default",
                                }}
                              >
                                <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>
                                  {row.symbolName ?? row.label}{" "}
                                  <span style={{ color: fgMuted, fontSize: 10 }}>(ε_{row.groupId})</span>
                                </td>
                                <td style={{ padding: "4px 8px", fontFamily: "monospace", fontWeight: 700 }}>
                                  <span style={{ color: row.xiSign > 0 ? "#38bdf8" : "#fb7185" }}>
                                    {row.xiSign > 0 ? "+1" : "-1"}
                                  </span>
                                </td>
                                <td style={{ padding: "4px 8px", fontFamily: "monospace", textAlign: "right" }}>
                                  {row.contributionMagnitude.toFixed(5)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* 3. Recipe Pre-Flight Nutrition Label */}
            <div
              style={{
                border: `1px solid ${border}`,
                borderRadius: 8,
                padding: 10,
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
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <strong>Recipe Pre-Flight Nutrition Label</strong>
                <button
                  type="button"
                  disabled={isRunningPreFlight}
                  onClick={() => void handleRunPreFlightAudit()}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 6,
                    border: `1px solid ${accent}`,
                    background: "rgba(56,189,248,0.16)",
                    color: accent,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: isRunningPreFlight ? "wait" : "pointer",
                  }}
                >
                  {isRunningPreFlight ? "Auditing…" : "Run Pre-Flight Audit"}
                </button>
              </div>

              {preFlightError && (
                <div style={{ fontSize: 11, color: "#fb7185", fontFamily: "monospace" }}>
                  Pre-Flight error: {preFlightError}
                </div>
              )}

              {preFlightReport && (
                <>
                  <div style={{ fontSize: 11, color: fgMuted }}>
                    Audited <strong>{preFlightReport.totalExamples}</strong> example(s) ·{" "}
                    <strong>{preFlightReport.totalTokens}</strong> tokens · locked ratio{" "}
                    <code>{(preFlightReport.lockedTokenRatio * 100).toFixed(1)}%</code>
                  </div>

                  {/* m_init stats (min / median / p95 / max) */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
                    {(
                      [
                        ["m_init min", preFlightReport.mInitStats.min],
                        ["m_init median", preFlightReport.mInitStats.median],
                        ["m_init p95", preFlightReport.mInitStats.p95],
                        ["m_init max", preFlightReport.mInitStats.max],
                      ] as const
                    ).map(([label, value]) => (
                      <div
                        key={label}
                        style={{ border: `1px solid ${border}`, borderRadius: 6, padding: 6, background: bgSubtle }}
                      >
                        <div style={{ fontSize: 10, color: fgMuted }}>{label}</div>
                        <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13 }}>{value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Dynamic-m VRAM savings % & Reward-hacking count */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    <div style={{ border: `1px solid ${border}`, borderRadius: 6, padding: 8, background: bgSubtle }}>
                      <div style={{ fontSize: 10, color: fgMuted }}>Dynamic-m VRAM Savings</div>
                      <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 14, color: "#34d399" }}>
                        {preFlightReport.bucketingEfficiency.estimatedVramSavingsPct.toFixed(2)}%
                      </div>
                      <div style={{ fontSize: 10, color: fgMuted }}>
                        {preFlightReport.bucketingEfficiency.bucketCount} bucket(s) · cap m=
                        {preFlightReport.bucketingEfficiency.mCap}
                      </div>
                    </div>
                    <div style={{ border: `1px solid ${border}`, borderRadius: 6, padding: 8, background: bgSubtle }}>
                      <div style={{ fontSize: 10, color: fgMuted }}>Reward-Hacking Count</div>
                      <div
                        style={{
                          fontFamily: "monospace",
                          fontWeight: 700,
                          fontSize: 14,
                          color: preFlightReport.rewardHackingCount > 0 ? "#fb7185" : "#34d399",
                        }}
                      >
                        {preFlightReport.rewardHackingCount}
                      </div>
                      <div style={{ fontSize: 10, color: fgMuted }}>
                        rate: {(preFlightReport.rewardHackingRate * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>

                  {/* DiskANN Missing Symbols */}
                  <div style={{ border: `1px solid ${border}`, borderRadius: 6, padding: 8, background: bgSubtle }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        fontSize: 11,
                        marginBottom: 4,
                      }}
                    >
                      <strong>DiskANN Missing Symbols</strong>
                      <span style={{ fontFamily: "monospace", color: fgMuted }}>
                        coverage: {(preFlightReport.diskAnnCoverage.coverageRatio * 100).toFixed(1)}% (
                        {preFlightReport.diskAnnCoverage.coveredSymbols}/
                        {preFlightReport.diskAnnCoverage.uniqueExampleSymbols})
                      </span>
                    </div>
                    {preFlightReport.diskAnnCoverage.missingSymbols.length === 0 ? (
                      <div style={{ fontSize: 11, color: "#34d399" }}>All example symbols are covered in DiskANN.</div>
                    ) : (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {preFlightReport.diskAnnCoverage.missingSymbols.map((sym) => (
                          <code
                            key={sym}
                            style={{
                              padding: "2px 6px",
                              borderRadius: 4,
                              border: "1px solid rgba(251,191,36,0.45)",
                              background: "rgba(251,191,36,0.12)",
                              color: "#fbbf24",
                              fontSize: 10,
                            }}
                          >
                            {sym}
                          </code>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* 4. Collapsible Checkpoint Eval Regression Diff */}
            <div
              style={{
                border: `1px solid ${border}`,
                borderRadius: 8,
                padding: 10,
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
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  onClick={() => setEvalDiffOpen((open) => !open)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    color: fg,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  <span style={{ fontFamily: "monospace", color: fgMuted }}>{evalDiffOpen ? "▾" : "▸"}</span>
                  <span>Checkpoint Eval Regression Diff</span>
                  {evalDiffAnalysis.diff && (
                    <span
                      style={{
                        fontSize: 10,
                        fontFamily: "monospace",
                        padding: "1px 6px",
                        borderRadius: 4,
                        border: `1px solid ${
                          evalDiffAnalysis.diff.promotionChange === "promoted"
                            ? "#34d399"
                            : evalDiffAnalysis.diff.promotionChange === "regressed"
                              ? "#fb7185"
                              : accent
                        }`,
                        color:
                          evalDiffAnalysis.diff.promotionChange === "promoted"
                            ? "#34d399"
                            : evalDiffAnalysis.diff.promotionChange === "regressed"
                              ? "#fb7185"
                              : accent,
                      }}
                    >
                      {evalDiffAnalysis.diff.promotionChange}
                    </span>
                  )}
                </button>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={handleLoadSampleEvalDiff}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 6,
                      border: `1px solid ${accent}`,
                      background: "rgba(56,189,248,0.16)",
                      color: accent,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Load Sample Diff
                  </button>
                  {evalDiffOpen && (evalBeforeText || evalAfterText) && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setEvalBeforeText(evalAfterText);
                          setEvalAfterText(evalBeforeText);
                        }}
                        style={{
                          padding: "4px 8px",
                          borderRadius: 6,
                          border: `1px solid ${border}`,
                          background: bgSubtle,
                          color: fg,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Swap
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEvalBeforeText("");
                          setEvalAfterText("");
                          setSelectedFlippedCaseId(null);
                        }}
                        style={{
                          padding: "4px 8px",
                          borderRadius: 6,
                          border: `1px solid ${border}`,
                          background: bgSubtle,
                          color: fgMuted,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Clear
                      </button>
                    </>
                  )}
                </div>
              </div>

              {evalDiffOpen && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: fgMuted }}>
                        Baseline Checkpoint (Before <code>FormalModelEvalReport</code> JSON)
                      </span>
                      <textarea
                        value={evalBeforeText}
                        onChange={(e) => setEvalBeforeText(e.target.value)}
                        rows={6}
                        placeholder='Paste baseline FormalModelEvalReport JSON or click "Load Sample Diff"...'
                        style={{
                          background: bgSubtle,
                          color: fg,
                          border: `1px solid ${evalDiffAnalysis.beforeError ? "#fb7185" : border}`,
                          borderRadius: 6,
                          padding: 6,
                          fontSize: 10,
                          fontFamily: "monospace",
                          resize: "vertical",
                        }}
                      />
                      {evalDiffAnalysis.beforeError && (
                        <span style={{ fontSize: 10, color: "#fb7185", fontFamily: "monospace" }}>
                          Before JSON: {evalDiffAnalysis.beforeError}
                        </span>
                      )}
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: fgMuted }}>
                        Candidate Checkpoint (After <code>FormalModelEvalReport</code> JSON)
                      </span>
                      <textarea
                        value={evalAfterText}
                        onChange={(e) => setEvalAfterText(e.target.value)}
                        rows={6}
                        placeholder='Paste candidate FormalModelEvalReport JSON or click "Load Sample Diff"...'
                        style={{
                          background: bgSubtle,
                          color: fg,
                          border: `1px solid ${evalDiffAnalysis.afterError ? "#fb7185" : border}`,
                          borderRadius: 6,
                          padding: 6,
                          fontSize: 10,
                          fontFamily: "monospace",
                          resize: "vertical",
                        }}
                      />
                      {evalDiffAnalysis.afterError && (
                        <span style={{ fontSize: 10, color: "#fb7185", fontFamily: "monospace" }}>
                          After JSON: {evalDiffAnalysis.afterError}
                        </span>
                      )}
                    </label>
                  </div>

                  {evalDiffAnalysis.diff && (
                    <>
                      {/* Summary Metric Deltas */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
                        <div
                          style={{ border: `1px solid ${border}`, borderRadius: 6, padding: 6, background: bgSubtle }}
                        >
                          <div style={{ fontSize: 10, color: fgMuted }}>promotionChange</div>
                          <div
                            style={{
                              fontFamily: "monospace",
                              fontWeight: 700,
                              fontSize: 12,
                              color:
                                evalDiffAnalysis.diff.promotionChange === "promoted"
                                  ? "#34d399"
                                  : evalDiffAnalysis.diff.promotionChange === "regressed"
                                    ? "#fb7185"
                                    : accent,
                            }}
                          >
                            {evalDiffAnalysis.diff.promotionChange}
                          </div>
                        </div>
                        <div
                          style={{ border: `1px solid ${border}`, borderRadius: 6, padding: 6, background: bgSubtle }}
                        >
                          <div style={{ fontSize: 10, color: fgMuted }}>formalPassRateDelta</div>
                          <div
                            style={{
                              fontFamily: "monospace",
                              fontWeight: 700,
                              fontSize: 12,
                              color:
                                evalDiffAnalysis.diff.formalPassRateDelta > 0
                                  ? "#34d399"
                                  : evalDiffAnalysis.diff.formalPassRateDelta < 0
                                    ? "#fb7185"
                                    : fg,
                            }}
                          >
                            {evalDiffAnalysis.diff.formalPassRateDelta >= 0 ? "+" : ""}
                            {(evalDiffAnalysis.diff.formalPassRateDelta * 100).toFixed(2)}%
                          </div>
                        </div>
                        <div
                          style={{ border: `1px solid ${border}`, borderRadius: 6, padding: 6, background: bgSubtle }}
                        >
                          <div style={{ fontSize: 10, color: fgMuted }}>eceDelta (lower is better)</div>
                          <div
                            style={{
                              fontFamily: "monospace",
                              fontWeight: 700,
                              fontSize: 12,
                              color:
                                evalDiffAnalysis.diff.eceDelta < 0
                                  ? "#34d399"
                                  : evalDiffAnalysis.diff.eceDelta > 0
                                    ? "#fb7185"
                                    : fg,
                            }}
                          >
                            {evalDiffAnalysis.diff.eceDelta >= 0 ? "+" : ""}
                            {evalDiffAnalysis.diff.eceDelta.toFixed(4)}
                          </div>
                        </div>
                        <div
                          style={{ border: `1px solid ${border}`, borderRadius: 6, padding: 6, background: bgSubtle }}
                        >
                          <div style={{ fontSize: 10, color: fgMuted }}>rewardHackingDelta</div>
                          <div
                            style={{
                              fontFamily: "monospace",
                              fontWeight: 700,
                              fontSize: 12,
                              color:
                                evalDiffAnalysis.diff.rewardHackingRateDelta < 0
                                  ? "#34d399"
                                  : evalDiffAnalysis.diff.rewardHackingRateDelta > 0
                                    ? "#fb7185"
                                    : fg,
                            }}
                          >
                            {evalDiffAnalysis.diff.rewardHackingRateDelta >= 0 ? "+" : ""}
                            {(evalDiffAnalysis.diff.rewardHackingRateDelta * 100).toFixed(2)}%
                          </div>
                        </div>
                      </div>

                      {/* Clickable Flipped Case Badges */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <div
                          style={{ border: `1px solid ${border}`, borderRadius: 6, padding: 8, background: bgSubtle }}
                        >
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#fb7185", marginBottom: 4 }}>
                            PASS -&gt; FAIL ({evalDiffAnalysis.diff.flippedPassToFail.length})
                          </div>
                          {evalDiffAnalysis.diff.flippedPassToFail.length === 0 ? (
                            <div style={{ fontSize: 10, color: fgMuted }}>No regressions.</div>
                          ) : (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                              {evalDiffAnalysis.diff.flippedPassToFail.map((caseId) => {
                                const isSel = selectedFlippedCaseId === caseId;
                                return (
                                  <button
                                    key={caseId}
                                    type="button"
                                    onClick={() => setSelectedFlippedCaseId(isSel ? null : caseId)}
                                    style={{
                                      padding: "2px 7px",
                                      borderRadius: 4,
                                      border: `1px solid ${isSel ? "#fb7185" : "rgba(251,113,133,0.45)"}`,
                                      background: isSel ? "rgba(251,113,133,0.24)" : "rgba(251,113,133,0.12)",
                                      color: "#fb7185",
                                      fontSize: 10,
                                      fontFamily: "monospace",
                                      cursor: "pointer",
                                    }}
                                  >
                                    PASS → FAIL · {caseId}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        <div
                          style={{ border: `1px solid ${border}`, borderRadius: 6, padding: 8, background: bgSubtle }}
                        >
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#34d399", marginBottom: 4 }}>
                            FAIL -&gt; PASS ({evalDiffAnalysis.diff.flippedFailToPass.length})
                          </div>
                          {evalDiffAnalysis.diff.flippedFailToPass.length === 0 ? (
                            <div style={{ fontSize: 10, color: fgMuted }}>No newly fixed cases.</div>
                          ) : (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                              {evalDiffAnalysis.diff.flippedFailToPass.map((caseId) => {
                                const isSel = selectedFlippedCaseId === caseId;
                                return (
                                  <button
                                    key={caseId}
                                    type="button"
                                    onClick={() => setSelectedFlippedCaseId(isSel ? null : caseId)}
                                    style={{
                                      padding: "2px 7px",
                                      borderRadius: 4,
                                      border: `1px solid ${isSel ? "#34d399" : "rgba(52,211,153,0.45)"}`,
                                      background: isSel ? "rgba(52,211,153,0.24)" : "rgba(52,211,153,0.12)",
                                      color: "#34d399",
                                      fontSize: 10,
                                      fontFamily: "monospace",
                                      cursor: "pointer",
                                    }}
                                  >
                                    FAIL → PASS · {caseId}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Selected Case Side-by-Side Breakdown */}
                      {selectedFlippedCaseId &&
                        evalDiffAnalysis.selectedBeforeCase &&
                        evalDiffAnalysis.selectedAfterCase && (
                          <div
                            style={{
                              border: `1px solid ${accent}`,
                              borderRadius: 6,
                              padding: 8,
                              background: bgSubtle,
                              display: "flex",
                              flexDirection: "column",
                              gap: 4,
                            }}
                          >
                            <div style={{ fontSize: 11, fontWeight: 600, fontFamily: "monospace" }}>
                              Case Inspector: {selectedFlippedCaseId}
                            </div>
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "1fr 1fr",
                                gap: 8,
                                fontSize: 10,
                                fontFamily: "monospace",
                              }}
                            >
                              <div>
                                <div style={{ color: fgMuted, marginBottom: 2 }}>Before</div>
                                <div>
                                  formal={String(evalDiffAnalysis.selectedBeforeCase.formalPassed)} · behavioral=
                                  {String(evalDiffAnalysis.selectedBeforeCase.behavioralPassed)} · hack=
                                  {String(evalDiffAnalysis.selectedBeforeCase.rewardHacking)}
                                </div>
                                <div>Δ_t={evalDiffAnalysis.selectedBeforeCase.outputSpreadDeltaT.toFixed(3)}</div>
                                {(evalDiffAnalysis.selectedBeforeCase.rewardHackingReasons ?? []).length > 0 && (
                                  <div style={{ color: "#fb7185" }}>
                                    {(evalDiffAnalysis.selectedBeforeCase.rewardHackingReasons ?? []).join(" · ")}
                                  </div>
                                )}
                              </div>
                              <div>
                                <div style={{ color: fgMuted, marginBottom: 2 }}>After</div>
                                <div>
                                  formal={String(evalDiffAnalysis.selectedAfterCase.formalPassed)} · behavioral=
                                  {String(evalDiffAnalysis.selectedAfterCase.behavioralPassed)} · hack=
                                  {String(evalDiffAnalysis.selectedAfterCase.rewardHacking)}
                                </div>
                                <div>Δ_t={evalDiffAnalysis.selectedAfterCase.outputSpreadDeltaT.toFixed(3)}</div>
                                {(evalDiffAnalysis.selectedAfterCase.rewardHackingReasons ?? []).length > 0 && (
                                  <div style={{ color: "#fb7185" }}>
                                    {(evalDiffAnalysis.selectedAfterCase.rewardHackingReasons ?? []).join(" · ")}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                    </>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AnsatzTrainingStudioPanel;
