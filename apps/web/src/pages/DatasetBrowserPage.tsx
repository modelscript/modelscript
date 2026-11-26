// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BeakerIcon,
  CheckCircleIcon,
  CodeIcon,
  DatabaseIcon,
  DownloadIcon,
  FlameIcon,
  LinkExternalIcon,
  RocketIcon,
  SearchIcon,
  ShieldIcon,
  SyncIcon,
  XIcon,
} from "@primer/octicons-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import { DataLineageGraphCard } from "../components/DataLineageGraphCard";
import { usePageTitle } from "../util/title";

interface ActiveOverlayPatch {
  id: number;
  recipeName: string;
  exampleId: string;
  action: "quarantine" | "patch_source" | "hypergraph_override";
  reason: string;
  createdAt: string;
}

interface FormalCertInfo {
  gate1GlrSyntax: boolean;
  gate2QudvUnits: boolean;
  gate3SmtFeasibility: boolean;
  gate4DaeBalance: boolean;
  cadClearance?: boolean | undefined;
  diagnostics?: string[] | undefined;
}

interface ShardBrowserRow {
  exampleId: string;
  uri: string;
  dialect: string;
  mInit: number;
  tokenCount: number;
  groupCount: number;
  formalCert: FormalCertInfo | null;
  gatePassed: boolean;
  quarantined: boolean;
  hasSourcePatch: boolean;
  hasHypergraphOverride: boolean;
  activePatches: ActiveOverlayPatch[];
  source?: string | undefined;
}

interface BrowseShardResponse {
  shardId?: string;
  recipeName?: string;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sort: string;
  rows: ShardBrowserRow[];
}

interface XRayTokenHeat {
  tokenIndex: number;
  text: string;
  spreadDeltaT: number;
  normalizedHeat: number;
}

interface XRayLayerEntry {
  layerIndex: number;
  layerName: string;
  mIn: number;
  mOut: number;
  maxGeneratorNorm: number;
  meanBoxHalfWidth: number;
  events: { kind: string; detail: string }[];
}

interface XRayWorstCaseEntry {
  groupId: number;
  label: string;
  symbolName?: string;
  xiSign: 1 | -1;
  contributionMagnitude: number;
}

interface XRayResponse {
  exampleId: string;
  dialect: string;
  mInit: number;
  meanWorstCaseLoss: number;
  maxSpreadDeltaT: number;
  peakTokenIndex: number;
  peakTokenText: string;
  retrievalTau: number;
  tokenHeat: XRayTokenHeat[];
  layerWaterfall: XRayLayerEntry[];
  worstCaseCorner: XRayWorstCaseEntry[];
}

interface SpawnedCampaignBanner {
  campaignId: number;
  title: string;
  slug: string;
  spawnedCount: number;
  skippedPassingCount: number;
}

interface MInitBandCoverageItem {
  band: string;
  minM: number;
  maxM: number | null;
  count: number;
  share: number;
  sparse: boolean;
  exampleIds: string[];
}

interface ManifoldHoleItem {
  kind: "empty-m-band" | "sparse-m-band" | "narrow-parameter-range";
  target: string;
  severity: "high" | "medium";
  observedCount: number;
  detail: string;
  suggestedAction: string;
}

interface SynthesizedVariantItem {
  index: number;
  uri: string;
  exampleId: string;
  dialect: string;
  source: string;
  parameters: Record<string, number>;
  xi: number[];
  mInit: number;
  tokenCount: number;
  formalCert: FormalCertInfo;
  gatePassed: boolean;
}

interface CoverageAndFillResponse {
  coverage: {
    totalExamples: number;
    coverageScore: number;
    mInitBands: MInitBandCoverageItem[];
    manifoldHoles: ManifoldHoleItem[];
  };
  coverageScore: number;
  mInitBands: MInitBandCoverageItem[];
  manifoldHoles: ManifoldHoleItem[];
  synthesis: {
    feasible: boolean;
    dialect: string;
    seedUri: string | null;
    deltaFraction: number;
    parameterNames: string[];
    nominalParameters: Record<string, number>;
    zonotope: {
      dim: number;
      numGenerators: number;
      center: number[];
    };
    variantCount: number;
    certifiedPassCount: number;
    variants: SynthesizedVariantItem[];
  } | null;
  variants: SynthesizedVariantItem[];
}

type SortOption = "m_init_desc" | "m_init_asc" | "tokens_desc" | "tokens_asc" | "uri_asc";
type TriFilter = "all" | "true" | "false";

const PageRoot = styled.div`
  width: 100%;
  max-width: 1280px;
  margin: 0 auto;
  padding: 20px 18px 56px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: var(--color-text-primary, #e6edf3);
  box-sizing: border-box;
`;

const HeaderCard = styled.header`
  border: 1px solid var(--color-border-default, rgba(148, 163, 184, 0.24));
  border-radius: 14px;
  padding: 16px 20px;
  background: var(--color-bg-elevated, #111827);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
`;

const FilterBar = styled.section`
  border: 1px solid var(--color-border-default, rgba(148, 163, 184, 0.22));
  border-radius: 14px;
  padding: 14px 16px;
  background: var(--color-bg-elevated, #111827);
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
`;

const FieldGroup = styled.label`
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary, #94a3b8);
`;

const Input = styled.input`
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--color-border-default, rgba(148, 163, 184, 0.3));
  background: var(--color-search-bg, rgba(15, 23, 42, 0.45));
  color: var(--color-text-primary, #e6edf3);
  font-size: 12px;
  outline: none;
  &:focus {
    border-color: #38bdf8;
  }
`;

const Select = styled.select`
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--color-border-default, rgba(148, 163, 184, 0.3));
  background: var(--color-search-bg, rgba(15, 23, 42, 0.7));
  color: var(--color-text-primary, #e6edf3);
  font-size: 12px;
  outline: none;
  &:focus {
    border-color: #38bdf8;
  }
`;

const BulkBar = styled.div`
  position: sticky;
  top: 10px;
  z-index: 20;
  border: 1px solid rgba(56, 189, 248, 0.45);
  border-radius: 12px;
  padding: 12px 16px;
  background:
    linear-gradient(135deg, rgba(14, 165, 233, 0.16), rgba(99, 102, 241, 0.16)), var(--color-bg-elevated, #0f172a);
  backdrop-filter: blur(10px);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28);
`;

const TableShell = styled.div`
  border: 1px solid var(--color-border-default, rgba(148, 163, 184, 0.22));
  border-radius: 14px;
  background: var(--color-bg-elevated, #111827);
  overflow: hidden;
`;

const TableScroll = styled.div`
  width: 100%;
  overflow-x: auto;
`;

const DataTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;

  thead tr {
    background: var(--color-table-header-bg, rgba(15, 23, 42, 0.72));
    border-bottom: 1px solid var(--color-border-default, rgba(148, 163, 184, 0.22));
  }

  th {
    padding: 10px 12px;
    text-align: left;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-secondary, #94a3b8);
    white-space: nowrap;
  }

  tbody tr {
    border-bottom: 1px solid var(--color-border, rgba(148, 163, 184, 0.12));
    transition: background 0.12s ease;
    &:hover {
      background: rgba(56, 189, 248, 0.05);
    }
  }

  td {
    padding: 10px 12px;
    vertical-align: middle;
  }
`;

const GatePill = styled.span<{ $pass: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  font-family: var(--font-mono, monospace);
  padding: 2px 5px;
  border-radius: 5px;
  border: 1px solid ${({ $pass }) => ($pass ? "rgba(16, 185, 129, 0.45)" : "rgba(244, 63, 94, 0.45)")};
  background: ${({ $pass }) => ($pass ? "rgba(16, 185, 129, 0.14)" : "rgba(244, 63, 94, 0.14)")};
  color: ${({ $pass }) => ($pass ? "#34d399" : "#fb7185")};
`;

const StatusPill = styled.span<{ $tone: "emerald" | "rose" | "amber" | "violet" | "cyan" | "muted" }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-weight: 600;
  font-family: var(--font-mono, monospace);
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid
    ${({ $tone }) =>
      $tone === "rose"
        ? "rgba(244, 63, 94, 0.45)"
        : $tone === "emerald"
          ? "rgba(16, 185, 129, 0.45)"
          : $tone === "amber"
            ? "rgba(245, 158, 11, 0.45)"
            : $tone === "violet"
              ? "rgba(139, 92, 246, 0.45)"
              : $tone === "cyan"
                ? "rgba(56, 189, 248, 0.45)"
                : "rgba(148, 163, 184, 0.3)"};
  background: ${({ $tone }) =>
    $tone === "rose"
      ? "rgba(244, 63, 94, 0.14)"
      : $tone === "emerald"
        ? "rgba(16, 185, 129, 0.14)"
        : $tone === "amber"
          ? "rgba(245, 158, 11, 0.14)"
          : $tone === "violet"
            ? "rgba(139, 92, 246, 0.14)"
            : $tone === "cyan"
              ? "rgba(56, 189, 248, 0.14)"
              : "rgba(148, 163, 184, 0.1)"};
  color: ${({ $tone }) =>
    $tone === "rose"
      ? "#fb7185"
      : $tone === "emerald"
        ? "#34d399"
        : $tone === "amber"
          ? "#fbbf24"
          : $tone === "violet"
            ? "#c4b5fd"
            : $tone === "cyan"
              ? "#38bdf8"
              : "var(--color-text-secondary, #94a3b8)"};
`;

const Btn = styled.button<{ $variant?: "primary" | "danger" | "secondary" | "subtle" }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: ${({ $variant }) => ($variant === "subtle" ? "4px 8px" : "7px 12px")};
  border-radius: 8px;
  font-size: ${({ $variant }) => ($variant === "subtle" ? "11.5px" : "12px")};
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  border: 1px solid
    ${({ $variant }) =>
      $variant === "danger"
        ? "rgba(244, 63, 94, 0.55)"
        : $variant === "primary"
          ? "rgba(56, 189, 248, 0.55)"
          : "var(--color-border-default, rgba(148, 163, 184, 0.28))"};
  background: ${({ $variant }) =>
    $variant === "danger"
      ? "linear-gradient(135deg, #e11d48, #be123c)"
      : $variant === "primary"
        ? "linear-gradient(135deg, #0284c7, #4f46e5)"
        : "var(--color-btn-secondary-bg, rgba(30, 41, 59, 0.65))"};
  color: ${({ $variant }) =>
    $variant === "danger" || $variant === "primary" ? "#ffffff" : "var(--color-text-primary, #e6edf3)"};
  &:hover:not(:disabled) {
    opacity: 0.92;
    border-color: ${({ $variant }) => ($variant === "danger" ? "#fb7185" : "#38bdf8")};
  }
  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

const PaginationBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--color-border, rgba(148, 163, 184, 0.16));
  background: var(--color-bg-secondary, rgba(15, 23, 42, 0.45));
  font-size: 12px;
`;

const DrawerBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgba(2, 6, 23, 0.68);
  backdrop-filter: blur(4px);
  display: flex;
  justify-content: flex-end;
`;

const DrawerSheet = styled.aside`
  width: min(1040px, 96vw);
  height: 100%;
  overflow-y: auto;
  background: var(--color-bg-primary, #0b1120);
  border-left: 1px solid var(--color-border-default, rgba(148, 163, 184, 0.28));
  padding: 18px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const Banner = styled.div<{ $tone: "success" | "error" | "info" }>`
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 12.5px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid
    ${({ $tone }) =>
      $tone === "error"
        ? "rgba(244, 63, 94, 0.45)"
        : $tone === "success"
          ? "rgba(16, 185, 129, 0.45)"
          : "rgba(56, 189, 248, 0.45)"};
  background: ${({ $tone }) =>
    $tone === "error"
      ? "rgba(244, 63, 94, 0.12)"
      : $tone === "success"
        ? "rgba(16, 185, 129, 0.12)"
        : "rgba(56, 189, 248, 0.12)"};
  color: ${({ $tone }) => ($tone === "error" ? "#fda4af" : $tone === "success" ? "#6ee7b7" : "#7dd3fc")};
`;

function truncateMiddle(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  const half = Math.floor((maxLen - 1) / 2);
  return `${value.slice(0, half)}…${value.slice(value.length - half)}`;
}

export const DatasetBrowserPage: React.FC = () => {
  const { shardId } = useParams<{ shardId: string }>();
  const navigate = useNavigate();
  const { token } = useAuth();

  usePageTitle(shardId ? `Shard ${shardId.slice(0, 12)}… | Dataset Browser` : "Dataset Slice Browser");

  // Query filter state
  const [dialect, setDialect] = useState("all");
  const [mMin, setMMin] = useState("");
  const [mMax, setMMax] = useState("");
  const [gatePassed, setGatePassed] = useState<TriFilter>("all");
  const [quarantined, setQuarantined] = useState<TriFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState<SortOption>("m_init_desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Server data
  const [data, setData] = useState<BrowseShardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Multi-row selection (keyed by exampleId so selections survive page turns)
  const [selectedRows, setSelectedRows] = useState<Map<string, ShardBrowserRow>>(() => new Map());
  const [bulkReason, setBulkReason] = useState("");
  const [bulkBusy, setBulkBusy] = useState<"quarantine" | "spawn_campaign" | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [spawnedCampaign, setSpawnedCampaign] = useState<SpawnedCampaignBanner | null>(null);

  // Per-row Blast-Radius Drawer
  const [blastRow, setBlastRow] = useState<ShardBrowserRow | null>(null);

  // Per-row Ansatz X-Ray Drawer
  const [xrayRow, setXrayRow] = useState<ShardBrowserRow | null>(null);
  const [xrayLoading, setXrayLoading] = useState(false);
  const [xrayError, setXrayError] = useState<string | null>(null);
  const [xrayResult, setXrayResult] = useState<XRayResponse | null>(null);

  // Geometric Coverage & Fill Manifold Hole Drawer
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [coverageResult, setCoverageResult] = useState<CoverageAndFillResponse | null>(null);
  const [fillCount, setFillCount] = useState(4);
  const [fillDeltaFraction, setFillDeltaFraction] = useState(0.12);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 240);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const authHeaders = useCallback((): Record<string, string> => {
    const h: Record<string, string> = {};
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  }, [token]);

  const fetchRows = useCallback(async () => {
    if (!shardId) return;
    setLoading(true);
    setError(null);
    try {
      const parsedMMin = mMin.trim() !== "" ? Number(mMin) : undefined;
      const parsedMMax = mMax.trim() !== "" ? Number(mMax) : undefined;

      const payload: Record<string, unknown> = {
        shardId,
        sort,
        page,
        pageSize,
        filters: {
          ...(dialect !== "all" && dialect.trim() ? { dialect: dialect.trim() } : {}),
          ...(parsedMMin !== undefined && Number.isFinite(parsedMMin) ? { mMin: parsedMMin } : {}),
          ...(parsedMMax !== undefined && Number.isFinite(parsedMMax) ? { mMax: parsedMMax } : {}),
          ...(gatePassed !== "all" ? { gatePassed: gatePassed === "true" } : {}),
          ...(quarantined !== "all" ? { quarantined: quarantined === "true" } : {}),
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
        },
      };

      const res = await fetch("/api/v1/recipes/browse-shard", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `Failed to browse shard (${res.status})`);
      }
      setData(json as BrowseShardResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [shardId, dialect, mMin, mMax, gatePassed, quarantined, debouncedSearch, sort, page, pageSize, authHeaders]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const maxVisibleMInit = useMemo(
    () => Math.max(1, ...rows.map((r) => (Number.isFinite(r.mInit) ? r.mInit : 0))),
    [rows],
  );

  const allPageSelected = rows.length > 0 && rows.every((r) => selectedRows.has(r.exampleId));

  const toggleRowSelection = (row: ShardBrowserRow) => {
    setSelectedRows((prev) => {
      const next = new Map(prev);
      if (next.has(row.exampleId)) next.delete(row.exampleId);
      else next.set(row.exampleId, row);
      return next;
    });
  };

  const toggleSelectAllPage = () => {
    setSelectedRows((prev) => {
      const next = new Map(prev);
      if (allPageSelected) {
        for (const r of rows) next.delete(r.exampleId);
      } else {
        for (const r of rows) next.set(r.exampleId, r);
      }
      return next;
    });
  };

  const handleBulkQuarantine = async () => {
    if (selectedRows.size === 0 || !shardId) return;
    setBulkBusy("quarantine");
    setStatusMessage(null);
    try {
      const res = await fetch("/api/v1/recipes/bulk-action", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          action: "quarantine",
          shardId,
          recipeName: data?.recipeName,
          exampleIds: Array.from(selectedRows.keys()),
          reason: bulkReason.trim() || `Bulk quarantined from shard ${shardId.slice(0, 12)}`,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json.error ||
            (res.status === 401
              ? "Sign in required to execute bulk quarantine."
              : `Bulk quarantine failed (${res.status})`),
        );
      }
      setStatusMessage({
        tone: "success",
        text: `Recorded ${json.quarantinedCount ?? selectedRows.size} immutable quarantine patch(es) in '${json.recipeName ?? data?.recipeName ?? shardId}'.`,
      });
      setSelectedRows(new Map());
      setBulkReason("");
      await fetchRows();
    } catch (err) {
      setStatusMessage({ tone: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBulkBusy(null);
    }
  };

  const handleSpawnSprint = async () => {
    if (selectedRows.size === 0 || !shardId) return;
    setBulkBusy("spawn_campaign");
    setStatusMessage(null);
    setSpawnedCampaign(null);
    try {
      const examplesPayload = Array.from(selectedRows.values()).map((r) => ({
        exampleId: r.exampleId,
        uri: r.uri,
        dialect: r.dialect,
        source:
          typeof r.source === "string" && r.source.trim().length > 0
            ? r.source
            : `// Example ${r.exampleId} (${r.uri}) from shard ${shardId}\n// Dialect: ${r.dialect}, m_init=${r.mInit}\n`,
      }));

      const res = await fetch("/api/v1/recipes/bulk-action", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          action: "spawn_campaign",
          shardId,
          recipeName: data?.recipeName,
          examples: examplesPayload,
          includePassing: true,
          reason: bulkReason.trim() || `Triage sprint spawned from shard ${shardId.slice(0, 12)}`,
          campaign: {
            title:
              bulkReason.trim() ||
              `Slice Triage: ${data?.recipeName ?? shardId.slice(0, 12)} (${examplesPayload.length})`,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json.error ||
            (res.status === 401
              ? "Sign in required to spawn an RLHF annotation sprint."
              : `Spawn campaign failed (${res.status})`),
        );
      }
      setSpawnedCampaign({
        campaignId: Number(json.campaign?.id ?? 0),
        title: String(json.campaign?.title ?? "RLHF Annotation Sprint"),
        slug: String(json.campaign?.slug ?? ""),
        spawnedCount: Number(json.spawnedCount ?? examplesPayload.length),
        skippedPassingCount: Number(json.skippedPassingCount ?? 0),
      });
      setSelectedRows(new Map());
      setBulkReason("");
    } catch (err) {
      setStatusMessage({ tone: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBulkBusy(null);
    }
  };

  const handleOpenXRay = async (row: ShardBrowserRow) => {
    setXrayRow(row);
    setXrayResult(null);
    setXrayError(null);
    if (!row.source || !row.source.trim()) {
      setXrayError(
        "This compiled shard row stores tokenized hypergraph tensors without raw source text. Open in Ansatz Studio to inspect or paste source.",
      );
      return;
    }
    setXrayLoading(true);
    try {
      const res = await fetch("/api/v1/recipes/xray", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          source: row.source,
          dialect: row.dialect,
          uri: row.uri,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `X-Ray forward pass failed (${res.status})`);
      }
      setXrayResult(json as XRayResponse);
    } catch (err) {
      setXrayError(err instanceof Error ? err.message : String(err));
    } finally {
      setXrayLoading(false);
    }
  };

  const handleOpenInAnsatzStudio = (row: ShardBrowserRow) => {
    const params = new URLSearchParams();
    if (row.dialect) params.set("dialect", row.dialect);
    if (row.uri) params.set("title", row.uri);
    navigate(`/editor?${params.toString()}`, {
      state: {
        ...(row.source ? { code: row.source } : {}),
        dialect: row.dialect,
        language: row.dialect,
        title: row.uri,
      },
    });
  };

  const handleOpenVariantInAnsatz = (variant: SynthesizedVariantItem) => {
    const params = new URLSearchParams();
    if (variant.dialect) params.set("dialect", variant.dialect);
    if (variant.uri) params.set("title", variant.uri);
    navigate(`/editor?${params.toString()}`, {
      state: {
        code: variant.source,
        dialect: variant.dialect,
        language: variant.dialect,
        title: variant.uri,
      },
    });
  };

  const handleRunCoverageAndFill = async (overrideCount?: number, overrideDelta?: number) => {
    setCoverageOpen(true);
    setCoverageError(null);
    if (rows.length === 0) {
      setCoverageResult(null);
      setCoverageError("No loaded shard rows are available to analyze geometric coverage.");
      return;
    }

    const effectiveCount = overrideCount ?? fillCount;
    const effectiveDelta = overrideDelta ?? fillDeltaFraction;
    setCoverageLoading(true);
    try {
      const examplesPayload = rows.map((row) => ({
        exampleId: row.exampleId,
        uri: row.uri,
        dialect: row.dialect,
        source: typeof row.source === "string" ? row.source : "",
      }));
      const seedRow = rows.find((r) => typeof r.source === "string" && r.source.trim().length > 0);

      const res = await fetch("/api/v1/recipes/coverage-and-fill", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          examples: examplesPayload,
          ...(seedRow?.source ? { seedSource: seedRow.source, dialect: seedRow.dialect } : {}),
          count: effectiveCount,
          deltaFraction: effectiveDelta,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `Geometric coverage analysis failed (${res.status})`);
      }
      setCoverageResult(json as CoverageAndFillResponse);
    } catch (err) {
      setCoverageError(err instanceof Error ? err.message : String(err));
    } finally {
      setCoverageLoading(false);
    }
  };

  return (
    <PageRoot>
      {/* Header */}
      <HeaderCard>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Link
              to="/datasets"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 12,
                fontWeight: 600,
                color: "#38bdf8",
                textDecoration: "none",
              }}
            >
              <ArrowLeftIcon size={13} />
              Back to Datasets Hub
            </Link>
            {data?.recipeName && <StatusPill $tone="cyan">{data.recipeName}</StatusPill>}
            {data && <StatusPill $tone="muted">{data.total.toLocaleString()} matching rows</StatusPill>}
          </div>

          <h1
            style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "var(--color-text-heading, var(--color-text-primary, #f8fafc))",
            }}
          >
            <DatabaseIcon size={20} />
            Columnar Dataset Slice Explorer
          </h1>
          <div
            style={{
              fontSize: 12,
              fontFamily: "var(--font-mono, monospace)",
              color: "var(--color-text-secondary, #94a3b8)",
              wordBreak: "break-all",
            }}
          >
            shard_id: {shardId ?? "—"}
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <Btn
            type="button"
            $variant="primary"
            onClick={() => void handleRunCoverageAndFill()}
            disabled={loading || rows.length === 0}
            title="Analyze m_init geometric coverage holes and synthesize ConstrainedZonotope fill variants"
            data-testid="coverage-and-fill-btn"
          >
            <BeakerIcon size={13} />
            Geometric Coverage &amp; Fill Hole
          </Btn>
          {shardId && (
            <a
              href={`/api/v1/memory/datasets/shards/${encodeURIComponent(shardId)}`}
              download={`${data?.recipeName ?? "shard"}-${shardId.slice(0, 12)}.jsonl`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 12px",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                textDecoration: "none",
                border: "1px solid var(--color-border-default, rgba(148, 163, 184, 0.28))",
                background: "var(--color-btn-secondary-bg, rgba(30, 41, 59, 0.65))",
                color: "var(--color-text-primary, #e6edf3)",
              }}
            >
              <DownloadIcon size={13} />
              Download JSONL
            </a>
          )}
          <Btn type="button" onClick={() => void fetchRows()} disabled={loading}>
            <SyncIcon size={13} />
            Refresh
          </Btn>
        </div>
      </HeaderCard>

      {/* Interactive Server-Side Filter Bar */}
      <FilterBar>
        <FieldGroup style={{ flex: "1 1 220px", minWidth: 180 }}>
          <span>Search (example_id, URI, source, reason)</span>
          <div style={{ position: "relative" }}>
            <span
              style={{
                position: "absolute",
                left: 9,
                top: "50%",
                transform: "translateY(-50%)",
                display: "inline-flex",
                color: "var(--color-text-tertiary, #64748b)",
                pointerEvents: "none",
              }}
            >
              <SearchIcon size={13} />
            </span>
            <Input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Filter rows…"
              style={{ width: "100%", paddingLeft: 28, boxSizing: "border-box" }}
            />
          </div>
        </FieldGroup>

        <FieldGroup>
          <span>Dialect</span>
          <Input
            type="text"
            value={dialect === "all" ? "" : dialect}
            onChange={(e) => {
              setDialect(e.target.value.trim() || "all");
              setPage(1);
            }}
            placeholder="all (e.g. modelica)"
            style={{ width: 130 }}
          />
        </FieldGroup>

        <FieldGroup>
          <span>m_init min</span>
          <Input
            type="number"
            min={0}
            value={mMin}
            onChange={(e) => {
              setMMin(e.target.value);
              setPage(1);
            }}
            placeholder="0"
            style={{ width: 76, fontFamily: "monospace" }}
          />
        </FieldGroup>

        <FieldGroup>
          <span>m_init max</span>
          <Input
            type="number"
            min={0}
            value={mMax}
            onChange={(e) => {
              setMMax(e.target.value);
              setPage(1);
            }}
            placeholder="∞"
            style={{ width: 76, fontFamily: "monospace" }}
          />
        </FieldGroup>

        <FieldGroup>
          <span>Formal Gates (G1-G4)</span>
          <Select
            value={gatePassed}
            onChange={(e) => {
              setGatePassed(e.target.value as TriFilter);
              setPage(1);
            }}
          >
            <option value="all">All Gates</option>
            <option value="true">All 4 Passed</option>
            <option value="false">Any Failed</option>
          </Select>
        </FieldGroup>

        <FieldGroup>
          <span>Quarantine Status</span>
          <Select
            value={quarantined}
            onChange={(e) => {
              setQuarantined(e.target.value as TriFilter);
              setPage(1);
            }}
          >
            <option value="all">All Statuses</option>
            <option value="false">Active Only</option>
            <option value="true">Quarantined Only</option>
          </Select>
        </FieldGroup>

        <FieldGroup>
          <span>Sort By</span>
          <Select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as SortOption);
              setPage(1);
            }}
          >
            <option value="m_init_desc">m_init (High → Low)</option>
            <option value="m_init_asc">m_init (Low → High)</option>
            <option value="tokens_desc">Tokens (High → Low)</option>
            <option value="tokens_asc">Tokens (Low → High)</option>
            <option value="uri_asc">URI (A → Z)</option>
          </Select>
        </FieldGroup>
      </FilterBar>

      {/* Feedback & Spawned Campaign Banners */}
      {statusMessage && (
        <Banner $tone={statusMessage.tone}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {statusMessage.tone === "success" ? <CheckCircleIcon size={15} /> : <AlertIcon size={15} />}
            {statusMessage.text}
          </span>
          <Btn type="button" $variant="subtle" onClick={() => setStatusMessage(null)}>
            Dismiss
          </Btn>
        </Banner>
      )}

      {spawnedCampaign && (
        <Banner $tone="success">
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <RocketIcon size={15} />
            <strong>RLHF Annotation Sprint Created:</strong>
            <span>
              &ldquo;{spawnedCampaign.title}&rdquo; ({spawnedCampaign.spawnedCount} challenge
              {spawnedCampaign.spawnedCount === 1 ? "" : "s"} queued
              {spawnedCampaign.skippedPassingCount > 0
                ? `, ${spawnedCampaign.skippedPassingCount} passing skipped`
                : ""}
              )
            </span>
          </div>
          <Link
            to={`/annotate/queue?campaignId=${encodeURIComponent(String(spawnedCampaign.campaignId))}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              textDecoration: "none",
              background: "linear-gradient(135deg, #059669, #0284c7)",
              color: "#ffffff",
            }}
          >
            Open RLHF Annotation Queue
            <ArrowRightIcon size={13} />
          </Link>
        </Banner>
      )}

      {/* Multi-Row Selection Bulk Actions Bar */}
      {selectedRows.size > 0 && (
        <BulkBar role="region" aria-label="Bulk actions for selected rows">
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", flex: 1 }}>
            <StatusPill $tone="cyan">{selectedRows.size} selected</StatusPill>
            <Input
              type="text"
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)}
              placeholder="Optional quarantine reason or RLHF sprint title…"
              style={{ flex: "1 1 220px", minWidth: 180 }}
            />
            <Btn type="button" $variant="subtle" onClick={() => setSelectedRows(new Map())}>
              Clear Selection
            </Btn>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Btn
              type="button"
              $variant="danger"
              disabled={bulkBusy !== null}
              onClick={() => void handleBulkQuarantine()}
            >
              <ShieldIcon size={13} />
              {bulkBusy === "quarantine" ? "Quarantining…" : `Bulk Quarantine Selected (${selectedRows.size})`}
            </Btn>

            <Btn type="button" $variant="primary" disabled={bulkBusy !== null} onClick={() => void handleSpawnSprint()}>
              <RocketIcon size={13} />
              {bulkBusy === "spawn_campaign"
                ? "Spawning Sprint…"
                : `Spawn RLHF Annotation Sprint for Slice (${selectedRows.size})`}
            </Btn>
          </div>
        </BulkBar>
      )}

      {/* Error State */}
      {error && (
        <Banner $tone="error">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <AlertIcon size={15} />
            {error}
          </span>
        </Banner>
      )}

      {/* Columnar Data Table */}
      <TableShell>
        <TableScroll>
          <DataTable>
            <thead>
              <tr>
                <th style={{ width: 38 }}>
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={toggleSelectAllPage}
                    aria-label="Select all rows on page"
                  />
                </th>
                <th>example_id</th>
                <th>uri</th>
                <th>dialect</th>
                <th>m_init</th>
                <th>tokens</th>
                <th>G1-G4</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    style={{ textAlign: "center", padding: "36px 16px", color: "var(--color-text-secondary, #94a3b8)" }}
                  >
                    Loading columnar slice rows…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    style={{ textAlign: "center", padding: "36px 16px", color: "var(--color-text-secondary, #94a3b8)" }}
                  >
                    No rows match your active slice filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const isSelected = selectedRows.has(row.exampleId);
                  const mPct = Math.min(100, Math.max(4, (row.mInit / maxVisibleMInit) * 100));
                  return (
                    <tr
                      key={row.exampleId}
                      style={{
                        background: isSelected ? "rgba(56, 189, 248, 0.08)" : undefined,
                        opacity: row.quarantined ? 0.78 : 1,
                      }}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRowSelection(row)}
                          aria-label={`Select ${row.exampleId}`}
                        />
                      </td>
                      <td style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11.5 }} title={row.exampleId}>
                        {truncateMiddle(row.exampleId, 18)}
                      </td>
                      <td style={{ maxWidth: 260 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={row.uri}
                        >
                          {row.uri}
                        </div>
                        <div style={{ fontSize: 10.5, color: "var(--color-text-tertiary, #64748b)" }}>
                          {row.groupCount} hypergraph group{row.groupCount === 1 ? "" : "s"}
                        </div>
                      </td>
                      <td>
                        <StatusPill $tone="cyan">{row.dialect}</StatusPill>
                      </td>
                      <td style={{ minWidth: 94 }}>
                        <div style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 700, fontSize: 12 }}>
                          {row.mInit}
                        </div>
                        <div
                          style={{
                            height: 4,
                            borderRadius: 999,
                            background: "rgba(148, 163, 184, 0.2)",
                            marginTop: 4,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${mPct}%`,
                              height: "100%",
                              background: "linear-gradient(90deg, #38bdf8, #a855f7)",
                            }}
                          />
                        </div>
                      </td>
                      <td style={{ fontFamily: "var(--font-mono, monospace)" }}>{row.tokenCount.toLocaleString()}</td>
                      <td>
                        {row.formalCert ? (
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            <GatePill $pass={row.formalCert.gate1GlrSyntax} title="Gate 1: GLR Syntax">
                              G1
                            </GatePill>
                            <GatePill $pass={row.formalCert.gate2QudvUnits} title="Gate 2: SI / QUDV Units">
                              G2
                            </GatePill>
                            <GatePill $pass={row.formalCert.gate3SmtFeasibility} title="Gate 3: SMT Feasibility">
                              G3
                            </GatePill>
                            <GatePill $pass={row.formalCert.gate4DaeBalance} title="Gate 4: DAE Balance">
                              G4
                            </GatePill>
                          </div>
                        ) : (
                          <StatusPill $tone="muted">No Cert</StatusPill>
                        )}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {row.quarantined ? (
                            <StatusPill $tone="rose">Quarantined</StatusPill>
                          ) : (
                            <StatusPill $tone="emerald">Active</StatusPill>
                          )}
                          {row.hasSourcePatch && <StatusPill $tone="amber">Patched</StatusPill>}
                          {row.hasHypergraphOverride && <StatusPill $tone="violet">Override</StatusPill>}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6, flexWrap: "nowrap" }}>
                          <Btn
                            type="button"
                            $variant="subtle"
                            onClick={() => setBlastRow(row)}
                            title="Open Blast-Radius & Lineage DAG"
                          >
                            <FlameIcon size={12} />
                            Blast Radius
                          </Btn>
                          <Btn
                            type="button"
                            $variant="subtle"
                            onClick={() => void handleOpenXRay(row)}
                            title="Run Dynamic-m Ansatz X-Ray or open in Studio"
                          >
                            <BeakerIcon size={12} />
                            Inspect in Ansatz X-Ray
                          </Btn>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </DataTable>
        </TableScroll>

        {/* Pagination Controls */}
        <PaginationBar>
          <div style={{ color: "var(--color-text-secondary, #94a3b8)" }}>
            Page <strong>{data?.page ?? page}</strong> of <strong>{data?.totalPages ?? 1}</strong> ·{" "}
            {(data?.total ?? 0).toLocaleString()} total row{(data?.total ?? 0) === 1 ? "" : "s"}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              aria-label="Rows per page"
            >
              <option value={15}>15 / page</option>
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
            </Select>
            <Btn
              type="button"
              $variant="subtle"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ArrowLeftIcon size={12} />
              Prev
            </Btn>
            <Btn
              type="button"
              $variant="subtle"
              disabled={page >= (data?.totalPages ?? 1) || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ArrowRightIcon size={12} />
            </Btn>
          </div>
        </PaginationBar>
      </TableShell>

      {/* Per-Row Blast-Radius Slide-Over Drawer */}
      {blastRow && (
        <DrawerBackdrop onClick={() => setBlastRow(null)}>
          <DrawerSheet onClick={(e) => e.stopPropagation()} aria-label="Blast Radius Lineage Drawer">
            <DataLineageGraphCard
              exampleId={blastRow.exampleId}
              recipeName={data?.recipeName}
              onClose={() => setBlastRow(null)}
              onQuarantined={() => {
                void fetchRows();
              }}
            />
          </DrawerSheet>
        </DrawerBackdrop>
      )}

      {/* Per-Row Ansatz X-Ray Slide-Over Drawer */}
      {xrayRow && (
        <DrawerBackdrop onClick={() => setXrayRow(null)}>
          <DrawerSheet onClick={(e) => e.stopPropagation()} aria-label="Ansatz X-Ray Diagnostics Drawer">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                paddingBottom: 12,
                borderBottom: "1px solid var(--color-border, rgba(148, 163, 184, 0.2))",
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                  <BeakerIcon size={16} />
                  Ansatz X-Ray Inspector: <code>{xrayRow.uri}</code>
                </h2>
                <div style={{ fontSize: 12, color: "var(--color-text-secondary, #94a3b8)", marginTop: 3 }}>
                  example_id: <code>{xrayRow.exampleId}</code> · dialect: <code>{xrayRow.dialect}</code> · m_init:{" "}
                  <code>{xrayRow.mInit}</code>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Btn type="button" $variant="primary" onClick={() => handleOpenInAnsatzStudio(xrayRow)}>
                  <CodeIcon size={13} />
                  Open in Ansatz Studio
                  <LinkExternalIcon size={12} />
                </Btn>
                <Btn
                  type="button"
                  $variant="secondary"
                  onClick={() => setXrayRow(null)}
                  aria-label="Close X-Ray drawer"
                >
                  <XIcon size={14} />
                </Btn>
              </div>
            </div>

            {xrayLoading && (
              <div style={{ padding: "32px 12px", textAlign: "center", color: "var(--color-text-secondary, #94a3b8)" }}>
                Running 1-step Dynamic-m X-Ray forward pass…
              </div>
            )}

            {xrayError && (
              <Banner $tone="info">
                <span>{xrayError}</span>
              </Banner>
            )}

            {xrayResult && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                  <div
                    style={{
                      padding: 10,
                      borderRadius: 10,
                      border: "1px solid var(--color-border, rgba(148, 163, 184, 0.2))",
                      background: "var(--color-bg-elevated, #111827)",
                    }}
                  >
                    <div style={{ fontSize: 11, color: "var(--color-text-secondary, #94a3b8)" }}>Peak Spread Δ_t</div>
                    <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "monospace", color: "#fbbf24" }}>
                      {xrayResult.maxSpreadDeltaT.toFixed(4)}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: 10,
                      borderRadius: 10,
                      border: "1px solid var(--color-border, rgba(148, 163, 184, 0.2))",
                      background: "var(--color-bg-elevated, #111827)",
                    }}
                  >
                    <div style={{ fontSize: 11, color: "var(--color-text-secondary, #94a3b8)" }}>
                      Retrieval Threshold τ
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "monospace", color: "#38bdf8" }}>
                      {xrayResult.retrievalTau.toFixed(4)}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: 10,
                      borderRadius: 10,
                      border: "1px solid var(--color-border, rgba(148, 163, 184, 0.2))",
                      background: "var(--color-bg-elevated, #111827)",
                    }}
                  >
                    <div style={{ fontSize: 11, color: "var(--color-text-secondary, #94a3b8)" }}>
                      Mean Worst-Case Loss
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "monospace", color: "#fb7185" }}>
                      {xrayResult.meanWorstCaseLoss.toFixed(4)}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: 10,
                      borderRadius: 10,
                      border: "1px solid var(--color-border, rgba(148, 163, 184, 0.2))",
                      background: "var(--color-bg-elevated, #111827)",
                    }}
                  >
                    <div style={{ fontSize: 11, color: "var(--color-text-secondary, #94a3b8)" }}>Peak Token</div>
                    <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "monospace", color: "#34d399" }}>
                      {xrayResult.peakTokenText || `#${xrayResult.peakTokenIndex}`}
                    </div>
                  </div>
                </div>

                {/* Token Heatmap */}
                <div>
                  <h3 style={{ margin: "6px 0 8px", fontSize: 13, fontWeight: 700 }}>Dynamic-m Token Heatmap</h3>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 4,
                      padding: 10,
                      borderRadius: 10,
                      border: "1px solid var(--color-border, rgba(148, 163, 184, 0.2))",
                      background: "var(--color-bg-elevated, #111827)",
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: 11.5,
                    }}
                  >
                    {xrayResult.tokenHeat.slice(0, 140).map((tok) => {
                      const alpha = Math.min(0.65, Math.max(0.06, tok.normalizedHeat * 0.65));
                      return (
                        <span
                          key={tok.tokenIndex}
                          title={`Token #${tok.tokenIndex}: Δ_t = ${tok.spreadDeltaT.toFixed(4)}`}
                          style={{
                            padding: "2px 5px",
                            borderRadius: 4,
                            background: `rgba(244, 63, 94, ${alpha.toFixed(2)})`,
                            border:
                              tok.tokenIndex === xrayResult.peakTokenIndex
                                ? "1px solid #fbbf24"
                                : "1px solid rgba(148, 163, 184, 0.14)",
                          }}
                        >
                          {tok.text}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Layer Waterfall */}
                {xrayResult.layerWaterfall.length > 0 && (
                  <div>
                    <h3 style={{ margin: "6px 0 8px", fontSize: 13, fontWeight: 700 }}>
                      Generator Lifecycle Waterfall
                    </h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {xrayResult.layerWaterfall.map((layer) => (
                        <div
                          key={layer.layerIndex}
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 8,
                            padding: "8px 12px",
                            borderRadius: 8,
                            border: "1px solid var(--color-border, rgba(148, 163, 184, 0.18))",
                            background: "var(--color-bg-elevated, #111827)",
                            fontSize: 12,
                          }}
                        >
                          <span style={{ fontWeight: 600, fontFamily: "monospace" }}>
                            L{layer.layerIndex} · {layer.layerName}
                          </span>
                          <span style={{ fontFamily: "monospace", color: "#38bdf8" }}>
                            m: {layer.mIn} → {layer.mOut} · ‖g‖max={layer.maxGeneratorNorm.toFixed(3)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Worst-Case Corner ξ* */}
                {xrayResult.worstCaseCorner.length > 0 && (
                  <div>
                    <h3 style={{ margin: "6px 0 8px", fontSize: 13, fontWeight: 700 }}>
                      Worst-Case Zonotope Corner (ξ*)
                    </h3>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {xrayResult.worstCaseCorner.map((c) => (
                        <StatusPill key={c.groupId} $tone={c.xiSign > 0 ? "amber" : "violet"}>
                          g{c.groupId} ({c.symbolName || c.label}): {c.xiSign > 0 ? "+1" : "-1"} ·{" "}
                          {c.contributionMagnitude.toFixed(3)}
                        </StatusPill>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {xrayRow.source && (
              <div>
                <h3 style={{ margin: "6px 0 8px", fontSize: 13, fontWeight: 700 }}>Embedded Source Preview</h3>
                <pre
                  style={{
                    margin: 0,
                    padding: 12,
                    borderRadius: 10,
                    border: "1px solid var(--color-border, rgba(148, 163, 184, 0.2))",
                    background: "var(--color-bg-elevated, #111827)",
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: 11.5,
                    overflowX: "auto",
                    maxHeight: 260,
                  }}
                >
                  {xrayRow.source}
                </pre>
              </div>
            )}
          </DrawerSheet>
        </DrawerBackdrop>
      )}

      {/* Geometric Coverage & Fill Manifold Hole Slide-Over Drawer */}
      {coverageOpen && (
        <DrawerBackdrop onClick={() => setCoverageOpen(false)}>
          <DrawerSheet
            onClick={(e) => e.stopPropagation()}
            aria-label="Geometric Coverage and Fill Manifold Hole Drawer"
            data-testid="coverage-and-fill-drawer"
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                paddingBottom: 12,
                borderBottom: "1px solid var(--color-border, rgba(148, 163, 184, 0.2))",
                flexWrap: "wrap",
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                  <BeakerIcon size={16} />
                  Geometric Coverage &amp; Fill Manifold Hole
                </h2>
                <div style={{ fontSize: 12, color: "var(--color-text-secondary, #94a3b8)", marginTop: 3 }}>
                  Auditing {rows.length.toLocaleString()} loaded shard row{rows.length === 1 ? "" : "s"} for{" "}
                  <code>m_init</code> band sparsity &amp; ConstrainedZonotope synthesis
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 11.5,
                    color: "var(--color-text-secondary, #94a3b8)",
                  }}
                >
                  Variants
                  <Input
                    type="number"
                    min={1}
                    max={16}
                    value={fillCount}
                    onChange={(e) => {
                      const next = Math.max(1, Math.min(16, Number(e.target.value) || 4));
                      setFillCount(next);
                    }}
                    style={{ width: 56, fontFamily: "monospace" }}
                  />
                </label>
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 11.5,
                    color: "var(--color-text-secondary, #94a3b8)",
                  }}
                >
                  δ fraction
                  <Input
                    type="number"
                    min={0.01}
                    max={0.95}
                    step={0.02}
                    value={fillDeltaFraction}
                    onChange={(e) => {
                      const next = Math.max(0.01, Math.min(0.95, Number(e.target.value) || 0.12));
                      setFillDeltaFraction(next);
                    }}
                    style={{ width: 68, fontFamily: "monospace" }}
                  />
                </label>
                <Btn
                  type="button"
                  $variant="primary"
                  disabled={coverageLoading}
                  onClick={() => void handleRunCoverageAndFill(fillCount, fillDeltaFraction)}
                >
                  <SyncIcon size={12} />
                  {coverageLoading ? "Synthesizing…" : "Re-Analyze & Fill"}
                </Btn>
                <Btn
                  type="button"
                  $variant="secondary"
                  onClick={() => setCoverageOpen(false)}
                  aria-label="Close geometric coverage drawer"
                >
                  <XIcon size={14} />
                </Btn>
              </div>
            </div>

            {coverageLoading && (
              <div style={{ padding: "32px 12px", textAlign: "center", color: "var(--color-text-secondary, #94a3b8)" }}>
                Profiling <code>m_init</code> complexity bands and sampling feasible ConstrainedZonotope variants…
              </div>
            )}

            {coverageError && (
              <Banner $tone="error">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <AlertIcon size={14} />
                  {coverageError}
                </span>
              </Banner>
            )}

            {coverageResult && (
              <>
                {/* Top Summary KPI Cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      border: "1px solid var(--color-border, rgba(148, 163, 184, 0.2))",
                      background: "var(--color-bg-elevated, #111827)",
                    }}
                  >
                    <div style={{ fontSize: 11, color: "var(--color-text-secondary, #94a3b8)" }}>Coverage Score</div>
                    <div
                      style={{
                        fontSize: 22,
                        fontWeight: 800,
                        fontFamily: "monospace",
                        color:
                          coverageResult.coverageScore >= 0.7
                            ? "#34d399"
                            : coverageResult.coverageScore >= 0.4
                              ? "#fbbf24"
                              : "#fb7185",
                      }}
                    >
                      {(coverageResult.coverageScore * 100).toFixed(1)}%
                    </div>
                    <div
                      style={{ fontSize: 10.5, fontFamily: "monospace", color: "var(--color-text-tertiary, #64748b)" }}
                    >
                      score = {coverageResult.coverageScore.toFixed(4)}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      border: "1px solid var(--color-border, rgba(148, 163, 184, 0.2))",
                      background: "var(--color-bg-elevated, #111827)",
                    }}
                  >
                    <div style={{ fontSize: 11, color: "var(--color-text-secondary, #94a3b8)" }}>
                      Detected Manifold Holes
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "monospace", color: "#fbbf24" }}>
                      {coverageResult.manifoldHoles.length}
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--color-text-tertiary, #64748b)" }}>
                      {coverageResult.manifoldHoles.filter((h) => h.severity === "high").length} high severity
                    </div>
                  </div>

                  <div
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      border: "1px solid var(--color-border, rgba(148, 163, 184, 0.2))",
                      background: "var(--color-bg-elevated, #111827)",
                    }}
                  >
                    <div style={{ fontSize: 11, color: "var(--color-text-secondary, #94a3b8)" }}>
                      Zonotope Fill Candidates
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "monospace", color: "#38bdf8" }}>
                      {coverageResult.variants.length}
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--color-text-tertiary, #64748b)" }}>
                      {coverageResult.variants.filter((v) => v.gatePassed).length} / {coverageResult.variants.length}{" "}
                      passed all 4 gates
                    </div>
                  </div>

                  <div
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      border: "1px solid var(--color-border, rgba(148, 163, 184, 0.2))",
                      background: "var(--color-bg-elevated, #111827)",
                    }}
                  >
                    <div style={{ fontSize: 11, color: "var(--color-text-secondary, #94a3b8)" }}>
                      Constrained Zonotope
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "monospace", color: "#c4b5fd" }}>
                      {coverageResult.synthesis
                        ? `dim=${coverageResult.synthesis.zonotope.dim} · g=${coverageResult.synthesis.zonotope.numGenerators}`
                        : "No seed source"}
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--color-text-tertiary, #64748b)" }}>
                      {coverageResult.synthesis
                        ? `±${Math.round(coverageResult.synthesis.deltaFraction * 100)}% perturbation`
                        : "Shard rows lack raw source"}
                    </div>
                  </div>
                </div>

                {/* m_init Complexity Band Distribution */}
                <div>
                  <h3 style={{ margin: "6px 0 8px", fontSize: 13, fontWeight: 700 }}>
                    <code>m_init</code> Complexity Band Coverage
                  </h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
                    {coverageResult.mInitBands.map((band) => {
                      const pct = Math.round(band.share * 100);
                      return (
                        <div
                          key={band.band}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 8,
                            border: `1px solid ${band.sparse ? "rgba(244, 63, 94, 0.38)" : "rgba(56, 189, 248, 0.3)"}`,
                            background: "var(--color-bg-elevated, #111827)",
                          }}
                        >
                          <div
                            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}
                          >
                            <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 12 }}>{band.band}</span>
                            <StatusPill $tone={band.count === 0 ? "rose" : band.sparse ? "amber" : "emerald"}>
                              {band.count === 0 ? "Empty" : band.sparse ? "Sparse" : `${band.count} (${pct}%)`}
                            </StatusPill>
                          </div>
                          <div
                            style={{
                              height: 5,
                              borderRadius: 999,
                              background: "rgba(148, 163, 184, 0.16)",
                              marginTop: 7,
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                width: `${Math.min(100, Math.max(band.count > 0 ? 6 : 0, pct))}%`,
                                height: "100%",
                                background: band.sparse
                                  ? "linear-gradient(90deg, #f59e0b, #f43f5e)"
                                  : "linear-gradient(90deg, #38bdf8, #34d399)",
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Detected Manifold Holes */}
                <div>
                  <h3 style={{ margin: "6px 0 8px", fontSize: 13, fontWeight: 700 }}>
                    Detected <code>m_init</code> &amp; Parameter Manifold Holes ({coverageResult.manifoldHoles.length})
                  </h3>
                  {coverageResult.manifoldHoles.length === 0 ? (
                    <Banner $tone="success">
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <CheckCircleIcon size={14} />
                        No manifold holes detected across the loaded slice.
                      </span>
                    </Banner>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {coverageResult.manifoldHoles.map((hole, idx) => (
                        <div
                          key={`${hole.kind}-${hole.target}-${idx}`}
                          style={{
                            padding: "10px 12px",
                            borderRadius: 10,
                            border: `1px solid ${hole.severity === "high" ? "rgba(244, 63, 94, 0.35)" : "rgba(245, 158, 11, 0.35)"}`,
                            background: "var(--color-bg-elevated, #111827)",
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <StatusPill $tone={hole.severity === "high" ? "rose" : "amber"}>
                              {hole.severity.toUpperCase()}
                            </StatusPill>
                            <StatusPill $tone="violet">{hole.kind}</StatusPill>
                            <code style={{ fontSize: 12, fontWeight: 700 }}>{hole.target}</code>
                            <span
                              style={{ fontSize: 11, color: "var(--color-text-tertiary, #64748b)", marginLeft: "auto" }}
                            >
                              observed: {hole.observedCount}
                            </span>
                          </div>
                          <div style={{ fontSize: 12, color: "var(--color-text-primary, #e6edf3)" }}>{hole.detail}</div>
                          <div style={{ fontSize: 11.5, color: "#7dd3fc" }}>{hole.suggestedAction}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Synthesized ConstrainedZonotope Fill Candidates */}
                <div>
                  <h3 style={{ margin: "6px 0 8px", fontSize: 13, fontWeight: 700 }}>
                    Synthesized ConstrainedZonotope Fill Candidates ({coverageResult.variants.length})
                  </h3>
                  {coverageResult.variants.length === 0 ? (
                    <Banner $tone="info">
                      <span>
                        No ConstrainedZonotope variants could be synthesized from this slice (shard rows may lack
                        embedded source text or numeric parameters).
                      </span>
                    </Banner>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {coverageResult.variants.map((variant) => (
                        <div
                          key={`${variant.exampleId}-${variant.index}`}
                          style={{
                            padding: 12,
                            borderRadius: 10,
                            border: `1px solid ${variant.gatePassed ? "rgba(16, 185, 129, 0.35)" : "rgba(244, 63, 94, 0.35)"}`,
                            background: "var(--color-bg-elevated, #111827)",
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 8,
                              flexWrap: "wrap",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              <strong style={{ fontSize: 12.5, fontFamily: "monospace" }}>
                                Variant #{variant.index + 1}
                              </strong>
                              <StatusPill $tone="cyan">{variant.dialect}</StatusPill>
                              <StatusPill $tone="muted">m_init={variant.mInit}</StatusPill>
                              <div style={{ display: "inline-flex", gap: 4 }}>
                                <GatePill $pass={variant.formalCert.gate1GlrSyntax} title="Gate 1: GLR Syntax">
                                  G1
                                </GatePill>
                                <GatePill $pass={variant.formalCert.gate2QudvUnits} title="Gate 2: SI / QUDV Units">
                                  G2
                                </GatePill>
                                <GatePill
                                  $pass={variant.formalCert.gate3SmtFeasibility}
                                  title="Gate 3: SMT Feasibility"
                                >
                                  G3
                                </GatePill>
                                <GatePill $pass={variant.formalCert.gate4DaeBalance} title="Gate 4: DAE Balance">
                                  G4
                                </GatePill>
                              </div>
                              <StatusPill $tone={variant.gatePassed ? "emerald" : "rose"}>
                                {variant.gatePassed ? "4/4 Certified" : "Gate Check Warning"}
                              </StatusPill>
                            </div>

                            <Btn
                              type="button"
                              $variant="primary"
                              onClick={() => handleOpenVariantInAnsatz(variant)}
                              data-testid={`open-variant-ansatz-${variant.index}`}
                            >
                              <CodeIcon size={12} />
                              Open in Ansatz
                              <LinkExternalIcon size={11} />
                            </Btn>
                          </div>

                          {/* Perturbed parameter values */}
                          {Object.keys(variant.parameters).length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                              {Object.entries(variant.parameters).map(([name, val]) => (
                                <StatusPill key={name} $tone="violet">
                                  {name} = {val}
                                </StatusPill>
                              ))}
                              {variant.xi.length > 0 && (
                                <StatusPill $tone="muted">
                                  ξ = [{variant.xi.map((x) => x.toFixed(2)).join(", ")}]
                                </StatusPill>
                              )}
                            </div>
                          )}

                          <pre
                            style={{
                              margin: 0,
                              padding: 10,
                              borderRadius: 8,
                              border: "1px solid var(--color-border, rgba(148, 163, 184, 0.16))",
                              background: "rgba(2, 6, 23, 0.5)",
                              fontFamily: "var(--font-mono, monospace)",
                              fontSize: 11.5,
                              overflowX: "auto",
                              maxHeight: 160,
                            }}
                          >
                            {variant.source}
                          </pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </DrawerSheet>
        </DrawerBackdrop>
      )}
    </PageRoot>
  );
};

export default DatasetBrowserPage;
