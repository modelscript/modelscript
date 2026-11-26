// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  ArrowRightIcon,
  BeakerIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CodeIcon,
  CopyIcon,
  DatabaseIcon,
  DownloadIcon,
  FilterIcon,
  GitCompareIcon,
  SearchIcon,
  ShieldCheckIcon,
  SyncIcon,
} from "@primer/octicons-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import { DataLineageGraphCard } from "../components/DataLineageGraphCard";
import { usePageTitle } from "../util/title";

type DatasetKindFilter = "all" | "dataset-pretrain" | "dataset-posttrain" | "training-recipe";

interface DatasetShardRecord {
  shardId: string;
  recipeName: string;
  recipeVersion: string;
  datasetKind: "dataset-pretrain" | "dataset-posttrain" | "training-recipe" | "memory-shard" | string;
  dialect: string;
  mMin: number;
  mMax: number;
  exampleCount: number;
  byteSize: number;
  provenance: Record<string, unknown>;
  downloadUrl: string;
  createdAt: string;
  originNode?: string | undefined;
}

interface ContaminationMatch {
  trainUri: string;
  trainExampleId: string;
  evalUri: string;
  evalExampleId: string;
  matchKind: "exact-hash" | "near-duplicate";
  similarity: number;
}

interface DecontaminationReport {
  trainCount: number;
  evalCount: number;
  contaminatedCount: number;
  contaminationRate: number;
  matches: ContaminationMatch[];
  recommendedQuarantineIds: string[];
}

interface DatasetVersionDiff {
  beforeCount: number;
  afterCount: number;
  addedUris: string[];
  removedUris: string[];
  modifiedUris: string[];
  dialectDelta: Record<string, number>;
  mInitMedianBefore: number;
  mInitMedianAfter: number;
  mInitMeanBefore: number;
  mInitMeanAfter: number;
  estimatedMemoryMultiplier: number;
  rewardHackingDelta: number;
}

const DATASET_KIND_OPTIONS: { id: DatasetKindFilter; label: string }[] = [
  { id: "all", label: "All Kinds" },
  { id: "dataset-pretrain", label: "Pretrain Shards" },
  { id: "dataset-posttrain", label: "Posttrain RLHF" },
  { id: "training-recipe", label: "Training Recipes" },
];

const DEFAULT_DECONTAM_TRAIN = JSON.stringify(
  [
    {
      uri: "models/ThermalMotor.mo",
      dialect: "modelica",
      source:
        "model ThermalMotor\n  parameter Real R = 2.5;\n  Real T(start = 293.15);\nequation\n  der(T) = -0.1 * (T - 293.15) + R;\nend ThermalMotor;",
    },
    {
      uri: "models/RcFilter.mo",
      dialect: "modelica",
      source:
        "model RcFilter\n  parameter Real R = 100.0;\n  parameter Real C = 1e-3;\n  Real v(start = 0.0);\nequation\n  R * C * der(v) + v = 5.0;\nend RcFilter;",
    },
  ],
  null,
  2,
);

const DEFAULT_DECONTAM_EVAL = JSON.stringify(
  [
    {
      uri: "eval/ThermalMotorHoldout.mo",
      dialect: "modelica",
      source:
        "model ThermalMotor\n  parameter Real R = 2.5;\n  Real T(start = 293.15);\nequation\n  der(T) = -0.1 * (T - 293.15) + R;\nend ThermalMotor;",
    },
  ],
  null,
  2,
);

const DEFAULT_DIFF_BEFORE = JSON.stringify(
  [
    {
      uri: "models/RcFilter.mo",
      dialect: "modelica",
      source:
        "model RcFilter\n  parameter Real R = 100.0;\n  Real v(start = 0.0);\nequation\n  der(v) = (5.0 - v) / R;\nend RcFilter;",
    },
  ],
  null,
  2,
);

const DEFAULT_DIFF_AFTER = JSON.stringify(
  [
    {
      uri: "models/RcFilter.mo",
      dialect: "modelica",
      source:
        "model RcFilter\n  parameter Real R = 100.0;\n  parameter Real C = 1e-3;\n  Real v(start = 0.0);\nequation\n  R * C * der(v) + v = 5.0;\nend RcFilter;",
    },
    {
      uri: "models/InverterStage.cir",
      dialect: "spice",
      source: "* CMOS Inverter Stage\nVdd vdd 0 DC 3.3\nR1 vdd out 1k\nC1 out 0 10p\n.tran 1n 50n\n.end",
    },
  ],
  null,
  2,
);

const PageRoot = styled.div`
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: 20px 18px 48px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  color: var(--color-text-primary, #e6edf3);
  box-sizing: border-box;
`;

const HeroBanner = styled.header`
  border: 1px solid var(--color-border-default, rgba(148, 163, 184, 0.24));
  border-radius: 16px;
  padding: 20px 22px;
  background:
    radial-gradient(circle at 85% 15%, rgba(14, 165, 233, 0.14), transparent 45%),
    radial-gradient(circle at 12% 85%, rgba(99, 102, 241, 0.1), transparent 45%), var(--color-bg-elevated, #111827);
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
`;

const HeroTitle = styled.h1`
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.02em;
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--color-text-heading, var(--color-text-primary, #f8fafc));
`;

const HeroSubtitle = styled.p`
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.5;
  max-width: 720px;
  color: var(--color-text-secondary, #94a3b8);
`;

const NutritionGrid = styled.section`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 12px;
`;

const NutritionCard = styled.div`
  border: 1px solid var(--color-border-default, rgba(148, 163, 184, 0.22));
  border-radius: 12px;
  padding: 14px 16px;
  background: var(--color-bg-elevated, #111827);
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const NutritionLabel = styled.span`
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-secondary, #94a3b8);
`;

const NutritionValue = styled.div<{ $accent?: string }>`
  font-size: 24px;
  font-weight: 800;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  color: ${({ $accent }) => $accent || "var(--color-text-heading, var(--color-text-primary, #f8fafc))"};
`;

const NutritionSub = styled.span`
  font-size: 11.5px;
  color: var(--color-text-tertiary, #64748b);
`;

const FilterPanel = styled.section`
  border: 1px solid var(--color-border-default, rgba(148, 163, 184, 0.22));
  border-radius: 14px;
  padding: 14px 16px;
  background: var(--color-bg-elevated, #111827);
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const FilterRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
`;

const KindPill = styled.button<{ $active: boolean }>`
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid ${({ $active }) => ($active ? "#38bdf8" : "var(--color-border-default, rgba(148, 163, 184, 0.3))")};
  background: ${({ $active }) => ($active ? "rgba(56, 189, 248, 0.16)" : "var(--color-bg-secondary, transparent)")};
  color: ${({ $active }) => ($active ? "#38bdf8" : "var(--color-text-secondary, #94a3b8)")};
  transition: all 0.15s ease;
  &:hover {
    border-color: #38bdf8;
    color: var(--color-text-primary, #f8fafc);
  }
`;

const Input = styled.input`
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--color-border-default, rgba(148, 163, 184, 0.3));
  background: var(--color-search-bg, rgba(15, 23, 42, 0.4));
  color: var(--color-text-primary, #e6edf3);
  font-size: 12.5px;
  outline: none;
  &:focus {
    border-color: var(--color-primary, #38bdf8);
  }
`;

const Select = styled.select`
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--color-border-default, rgba(148, 163, 184, 0.3));
  background: var(--color-search-bg, rgba(15, 23, 42, 0.7));
  color: var(--color-text-primary, #e6edf3);
  font-size: 12.5px;
  outline: none;
  &:focus {
    border-color: var(--color-primary, #38bdf8);
  }
`;

const DrawerCard = styled.section`
  border: 1px solid var(--color-border-default, rgba(148, 163, 184, 0.24));
  border-radius: 14px;
  background: var(--color-bg-elevated, #111827);
  overflow: hidden;
`;

const DrawerToggle = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 18px;
  border: none;
  background: var(--color-bg-secondary, rgba(15, 23, 42, 0.55));
  color: var(--color-text-heading, var(--color-text-primary, #f8fafc));
  font-size: 13.5px;
  font-weight: 700;
  cursor: pointer;
  text-align: left;
  &:hover {
    background: var(--color-btn-secondary-bg, rgba(30, 41, 59, 0.65));
  }
`;

const DrawerBody = styled.div`
  padding: 16px 18px;
  border-top: 1px solid var(--color-border, rgba(148, 163, 184, 0.16));
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const TextArea = styled.textarea`
  width: 100%;
  min-height: 132px;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid var(--color-border-default, rgba(148, 163, 184, 0.28));
  background: var(--color-bg-primary, #0b1120);
  color: var(--color-text-primary, #e6edf3);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11.5px;
  line-height: 1.45;
  resize: vertical;
  box-sizing: border-box;
`;

const ShardsGrid = styled.section`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 14px;
`;

const ShardCard = styled.article`
  border: 1px solid var(--color-border-default, rgba(148, 163, 184, 0.22));
  border-radius: 14px;
  padding: 16px;
  background: var(--color-bg-elevated, #111827);
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition:
    border-color 0.15s ease,
    transform 0.15s ease;
  &:hover {
    border-color: rgba(56, 189, 248, 0.45);
  }
`;

const Tag = styled.span<{ $tone?: "cyan" | "emerald" | "amber" | "violet" | "rose" | "muted" }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid
    ${({ $tone }) =>
      $tone === "emerald"
        ? "rgba(16, 185, 129, 0.42)"
        : $tone === "amber"
          ? "rgba(245, 158, 11, 0.42)"
          : $tone === "violet"
            ? "rgba(139, 92, 246, 0.42)"
            : $tone === "rose"
              ? "rgba(244, 63, 94, 0.42)"
              : $tone === "muted"
                ? "rgba(148, 163, 184, 0.28)"
                : "rgba(56, 189, 248, 0.42)"};
  background: ${({ $tone }) =>
    $tone === "emerald"
      ? "rgba(16, 185, 129, 0.12)"
      : $tone === "amber"
        ? "rgba(245, 158, 11, 0.12)"
        : $tone === "violet"
          ? "rgba(139, 92, 246, 0.12)"
          : $tone === "rose"
            ? "rgba(244, 63, 94, 0.12)"
            : $tone === "muted"
              ? "rgba(148, 163, 184, 0.1)"
              : "rgba(56, 189, 248, 0.12)"};
  color: ${({ $tone }) =>
    $tone === "emerald"
      ? "#34d399"
      : $tone === "amber"
        ? "#fbbf24"
        : $tone === "violet"
          ? "#c4b5fd"
          : $tone === "rose"
            ? "#fb7185"
            : $tone === "muted"
              ? "var(--color-text-secondary, #94a3b8)"
              : "#38bdf8"};
`;

const MBarTrack = styled.div`
  position: relative;
  height: 8px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.18);
  overflow: hidden;
`;

const MBarFill = styled.div<{ $leftPct: number; $widthPct: number }>`
  position: absolute;
  top: 0;
  bottom: 0;
  left: ${({ $leftPct }) => $leftPct}%;
  width: ${({ $widthPct }) => Math.max(6, $widthPct)}%;
  border-radius: 999px;
  background: linear-gradient(90deg, #38bdf8, #818cf8, #c084fc);
`;

const DigestRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 9px;
  border-radius: 8px;
  background: var(--color-code-bg, rgba(15, 23, 42, 0.55));
  border: 1px solid var(--color-border, rgba(148, 163, 184, 0.16));
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
  color: var(--color-text-secondary, #94a3b8);
`;

const PrimaryButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 13px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid rgba(56, 189, 248, 0.55);
  background: linear-gradient(135deg, #0284c7, #4f46e5);
  color: #ffffff;
  &:hover:not(:disabled) {
    opacity: 0.92;
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const SecondaryButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 11px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--color-border-default, rgba(148, 163, 184, 0.28));
  background: var(--color-btn-secondary-bg, rgba(30, 41, 59, 0.6));
  color: var(--color-text-primary, #e6edf3);
  &:hover:not(:disabled) {
    border-color: #38bdf8;
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const CardActionLink = styled(Link)<{ $primary?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 11px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  border: 1px solid
    ${({ $primary }) => ($primary ? "rgba(56, 189, 248, 0.55)" : "var(--color-border-default, rgba(148, 163, 184, 0.28))")};
  background: ${({ $primary }) =>
    $primary ? "linear-gradient(135deg, #0284c7, #4f46e5)" : "var(--color-btn-secondary-bg, rgba(30, 41, 59, 0.6))"};
  color: ${({ $primary }) => ($primary ? "#ffffff" : "var(--color-text-primary, #e6edf3)")};
  &:hover {
    opacity: 0.92;
    border-color: #38bdf8;
  }
`;

const DownloadAnchor = styled.a`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 11px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  border: 1px solid var(--color-border-default, rgba(148, 163, 184, 0.28));
  background: var(--color-btn-secondary-bg, rgba(30, 41, 59, 0.6));
  color: var(--color-text-primary, #e6edf3);
  &:hover {
    border-color: #34d399;
    color: #34d399;
  }
`;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exp = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, exp);
  return `${value >= 100 || exp === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exp]}`;
}

function kindTone(kind: string): "cyan" | "emerald" | "amber" | "violet" | "muted" {
  switch (kind) {
    case "dataset-pretrain":
      return "cyan";
    case "dataset-posttrain":
      return "emerald";
    case "training-recipe":
      return "violet";
    case "memory-shard":
      return "amber";
    default:
      return "muted";
  }
}

export const DatasetsHubPage: React.FC = () => {
  const { token } = useAuth();
  usePageTitle("Datasets & Training Recipes Hub");

  const [shards, setShards] = useState<DatasetShardRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Faceted filters
  const [datasetKind, setDatasetKind] = useState<DatasetKindFilter>("all");
  const [dialectFilter, setDialectFilter] = useState<string>("all");
  const [mInitCap, setMInitCap] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Collapsible Decontamination & Version Diff drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<"decontaminate" | "diff">("decontaminate");

  // Decontamination state
  const [trainJson, setTrainJson] = useState(DEFAULT_DECONTAM_TRAIN);
  const [evalJson, setEvalJson] = useState(DEFAULT_DECONTAM_EVAL);
  const [nearDupThreshold, setNearDupThreshold] = useState(0.72);
  const [decontamLoading, setDecontamLoading] = useState(false);
  const [decontamError, setDecontamError] = useState<string | null>(null);
  const [decontamReport, setDecontamReport] = useState<DecontaminationReport | null>(null);

  // Diff state
  const [beforeJson, setBeforeJson] = useState(DEFAULT_DIFF_BEFORE);
  const [afterJson, setAfterJson] = useState(DEFAULT_DIFF_AFTER);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffResult, setDiffResult] = useState<DatasetVersionDiff | null>(null);

  // Quick Blast-Radius lineage preview
  const [lineageLookupId, setLineageLookupId] = useState<string | null>(null);

  const authHeaders = useCallback((): Record<string, string> => {
    const h: Record<string, string> = {};
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  }, [token]);

  const loadShards = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/memory/datasets/shards", {
        credentials: "include",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Failed to load dataset shards (${res.status})`);
      }
      setShards(Array.isArray(data.shards) ? (data.shards as DatasetShardRecord[]) : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    void loadShards();
  }, [loadShards]);

  const availableDialects = useMemo(() => {
    const set = new Set<string>();
    for (const s of shards) {
      if (s.dialect) set.add(s.dialect.toLowerCase());
    }
    return Array.from(set).sort();
  }, [shards]);

  const globalMaxMInit = useMemo(() => {
    let max = 0;
    for (const s of shards) {
      if (Number.isFinite(s.mMax) && s.mMax > max) max = s.mMax;
    }
    return Math.max(max, 1);
  }, [shards]);

  const filteredShards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const parsedCap = mInitCap.trim() === "" ? null : Number(mInitCap);
    const activeCap = parsedCap !== null && Number.isFinite(parsedCap) && parsedCap >= 0 ? parsedCap : null;

    return shards.filter((s) => {
      if (datasetKind !== "all" && s.datasetKind !== datasetKind) return false;
      if (dialectFilter !== "all" && s.dialect.toLowerCase() !== dialectFilter) return false;
      if (activeCap !== null && s.mMax > activeCap) return false;
      if (q) {
        const hay = [
          s.shardId,
          s.recipeName,
          s.recipeVersion,
          s.datasetKind,
          s.dialect,
          JSON.stringify(s.provenance ?? {}),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [shards, datasetKind, dialectFilter, mInitCap, searchQuery]);

  const nutrition = useMemo(() => {
    let totalExamples = 0;
    let totalBytes = 0;
    let mMin = Number.POSITIVE_INFINITY;
    let mMax = 0;
    let weightedMidSum = 0;
    let weightTotal = 0;

    for (const s of filteredShards) {
      totalExamples += s.exampleCount || 0;
      totalBytes += s.byteSize || 0;
      if (Number.isFinite(s.mMin) && s.mMin < mMin) mMin = s.mMin;
      if (Number.isFinite(s.mMax) && s.mMax > mMax) mMax = s.mMax;
      const w = Math.max(1, s.exampleCount || 1);
      weightedMidSum += ((s.mMin + s.mMax) / 2) * w;
      weightTotal += w;
    }

    return {
      shardCount: filteredShards.length,
      totalExamples,
      totalBytes,
      mMin: Number.isFinite(mMin) ? mMin : 0,
      mMax,
      weightedMid: weightTotal > 0 ? weightedMidSum / weightTotal : 0,
    };
  }, [filteredShards]);

  const handleCopyDigest = async (shardId: string) => {
    try {
      await navigator.clipboard.writeText(shardId);
      setCopiedId(shardId);
      setTimeout(() => setCopiedId((prev) => (prev === shardId ? null : prev)), 1800);
    } catch {
      // Ignore clipboard errors in restricted environments
    }
  };

  const handleLoadShardIntoEditor = async (shardId: string, target: "train" | "eval" | "before" | "after") => {
    if (!shardId) return;
    try {
      const res = await fetch("/api/v1/recipes/browse-shard", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ shardId, page: 1, pageSize: 50 }),
      });
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.rows)) return;
      const mapped = (data.rows as { exampleId: string; uri: string; dialect: string; source?: string }[]).map((r) => ({
        exampleId: r.exampleId,
        uri: r.uri,
        dialect: r.dialect,
        source: r.source ?? `// ${r.uri} (${r.exampleId})`,
      }));
      const formatted = JSON.stringify(mapped, null, 2);
      if (target === "train") setTrainJson(formatted);
      else if (target === "eval") setEvalJson(formatted);
      else if (target === "before") setBeforeJson(formatted);
      else setAfterJson(formatted);
    } catch {
      // Keep existing input untouched on transient error
    }
  };

  const handleRunDecontaminate = async () => {
    setDecontamLoading(true);
    setDecontamError(null);
    try {
      const train = JSON.parse(trainJson);
      const evalArr = JSON.parse(evalJson);
      const res = await fetch("/api/v1/recipes/decontaminate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          train,
          eval: evalArr,
          nearDuplicateThreshold: nearDupThreshold,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Decontamination audit failed (${res.status})`);
      }
      setDecontamReport(data as DecontaminationReport);
    } catch (err) {
      setDecontamError(err instanceof Error ? err.message : String(err));
      setDecontamReport(null);
    } finally {
      setDecontamLoading(false);
    }
  };

  const handleRunDiff = async () => {
    setDiffLoading(true);
    setDiffError(null);
    try {
      const before = JSON.parse(beforeJson);
      const after = JSON.parse(afterJson);
      const res = await fetch("/api/v1/recipes/diff", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ before, after }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Version diff failed (${res.status})`);
      }
      setDiffResult(data as DatasetVersionDiff);
    } catch (err) {
      setDiffError(err instanceof Error ? err.message : String(err));
      setDiffResult(null);
    } finally {
      setDiffLoading(false);
    }
  };

  return (
    <PageRoot>
      <HeroBanner>
        <div>
          <HeroTitle>
            <DatabaseIcon size={22} />
            Datasets &amp; Recipes Hub
          </HeroTitle>
          <HeroSubtitle>
            Explore content-addressed <code>m_init</code>-bucketed training shards, inspect Data Nutrition metrics,
            audit train/eval contamination, diff semantic dataset versions, and drill into columnar slices.
          </HeroSubtitle>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <SecondaryButton type="button" onClick={() => setLineageLookupId((prev) => (prev === null ? "" : null))}>
            <BeakerIcon size={14} />
            {lineageLookupId === null ? "Blast-Radius Lookup" : "Hide Blast-Radius"}
          </SecondaryButton>
          <CardActionLink to="/editor" $primary>
            <CodeIcon size={14} />
            Open in Ansatz Studio
          </CardActionLink>
          <SecondaryButton type="button" onClick={() => void loadShards()} disabled={loading}>
            <SyncIcon size={14} />
            Refresh
          </SecondaryButton>
        </div>
      </HeroBanner>

      {/* Optional inline Blast-Radius Lookup Card */}
      {lineageLookupId !== null && (
        <DataLineageGraphCard exampleId={lineageLookupId} onClose={() => setLineageLookupId(null)} />
      )}

      {/* Aggregate Data Nutrition Summary Cards */}
      <NutritionGrid aria-label="Aggregate Data Nutrition Summary">
        <NutritionCard>
          <NutritionLabel>Compiled Shards</NutritionLabel>
          <NutritionValue $accent="#38bdf8">{nutrition.shardCount.toLocaleString()}</NutritionValue>
          <NutritionSub>
            {shards.length !== nutrition.shardCount
              ? `Filtered from ${shards.length.toLocaleString()} total shards`
              : "All public content-addressed shards"}
          </NutritionSub>
        </NutritionCard>

        <NutritionCard>
          <NutritionLabel>Compiled Examples</NutritionLabel>
          <NutritionValue $accent="#34d399">{nutrition.totalExamples.toLocaleString()}</NutritionValue>
          <NutritionSub>4-column relational hypergraph records</NutritionSub>
        </NutritionCard>

        <NutritionCard>
          <NutritionLabel>Total Dataset Volume</NutritionLabel>
          <NutritionValue $accent="#c4b5fd">{formatBytes(nutrition.totalBytes)}</NutritionValue>
          <NutritionSub>HTTP Range (206) streamable JSONL</NutritionSub>
        </NutritionCard>

        <NutritionCard>
          <NutritionLabel>m_init Spread</NutritionLabel>
          <NutritionValue $accent="#fbbf24">
            {nutrition.shardCount > 0 ? `${nutrition.mMin} – ${nutrition.mMax}` : "—"}
          </NutritionValue>
          <NutritionSub>
            {nutrition.shardCount > 0
              ? `Weighted midpoint: ${nutrition.weightedMid.toFixed(1)} generators`
              : "No active shards in current slice"}
          </NutritionSub>
        </NutritionCard>
      </NutritionGrid>

      {/* Faceted Filters */}
      <FilterPanel>
        <FilterRow>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 700,
              color: "var(--color-text-secondary, #94a3b8)",
              marginRight: 4,
            }}
          >
            <FilterIcon size={13} />
            Kind:
          </span>
          {DATASET_KIND_OPTIONS.map((opt) => (
            <KindPill
              key={opt.id}
              type="button"
              $active={datasetKind === opt.id}
              onClick={() => setDatasetKind(opt.id)}
            >
              {opt.label}
            </KindPill>
          ))}
        </FilterRow>

        <FilterRow>
          <div style={{ position: "relative", flex: "1 1 240px", minWidth: 200 }}>
            <span
              style={{
                position: "absolute",
                left: 10,
                top: "50%",
                transform: "translateY(-50%)",
                display: "inline-flex",
                color: "var(--color-text-tertiary, #64748b)",
                pointerEvents: "none",
              }}
            >
              <SearchIcon size={14} aria-hidden="true" />
            </span>
            <Input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search recipe name, SHA-256 shard digest, version, dialect…"
              aria-label="Search shards"
              style={{ width: "100%", paddingLeft: 30, boxSizing: "border-box" }}
            />
          </div>

          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <span style={{ color: "var(--color-text-secondary, #94a3b8)" }}>Dialect</span>
            <Select
              value={dialectFilter}
              onChange={(e) => setDialectFilter(e.target.value)}
              aria-label="Filter by dialect"
            >
              <option value="all">All Dialects</option>
              {availableDialects.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </label>

          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <span style={{ color: "var(--color-text-secondary, #94a3b8)" }}>m_init max cap</span>
            <Input
              type="number"
              min={0}
              max={Math.max(256, globalMaxMInit)}
              value={mInitCap}
              onChange={(e) => setMInitCap(e.target.value)}
              placeholder={`≤ ${globalMaxMInit}`}
              aria-label="Maximum m_init cap"
              style={{ width: 84, fontFamily: "var(--font-mono, monospace)" }}
            />
          </label>

          {(datasetKind !== "all" || dialectFilter !== "all" || mInitCap !== "" || searchQuery !== "") && (
            <SecondaryButton
              type="button"
              onClick={() => {
                setDatasetKind("all");
                setDialectFilter("all");
                setMInitCap("");
                setSearchQuery("");
              }}
            >
              Reset Filters
            </SecondaryButton>
          )}
        </FilterRow>
      </FilterPanel>

      {/* Collapsible Train/Eval Decontamination & Version Diff Quick Drawer */}
      <DrawerCard>
        <DrawerToggle type="button" onClick={() => setDrawerOpen((o) => !o)} aria-expanded={drawerOpen}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {drawerOpen ? <ChevronDownIcon size={15} /> : <ChevronRightIcon size={15} />}
            <GitCompareIcon size={15} />
            Train/Eval Decontamination &amp; Version Diff
            <Tag $tone="violet">POST /api/v1/recipes/decontaminate &amp; /diff</Tag>
          </span>
          <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary, #94a3b8)" }}>
            {drawerOpen ? "Collapse Drawer" : "Expand Quick Audit Drawer"}
          </span>
        </DrawerToggle>

        {drawerOpen && (
          <DrawerBody>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <KindPill
                type="button"
                $active={drawerTab === "decontaminate"}
                onClick={() => setDrawerTab("decontaminate")}
              >
                <ShieldCheckIcon size={13} /> Train/Eval Decontamination
              </KindPill>
              <KindPill type="button" $active={drawerTab === "diff"} onClick={() => setDrawerTab("diff")}>
                <GitCompareIcon size={13} /> Semantic Version Diff (v1..v2)
              </KindPill>
            </div>

            {drawerTab === "decontaminate" ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", gap: 12 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <label style={{ fontSize: 12, fontWeight: 600 }}>Train Examples JSON</label>
                      {shards.length > 0 && (
                        <Select
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) void handleLoadShardIntoEditor(e.target.value, "train");
                          }}
                          style={{ fontSize: 11, padding: "4px 6px", maxWidth: 190 }}
                          aria-label="Load train JSON from compiled shard"
                        >
                          <option value="">Load from shard…</option>
                          {shards.map((s) => (
                            <option key={s.shardId} value={s.shardId}>
                              {s.recipeName} ({s.shardId.slice(0, 8)})
                            </option>
                          ))}
                        </Select>
                      )}
                    </div>
                    <TextArea value={trainJson} onChange={(e) => setTrainJson(e.target.value)} />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <label style={{ fontSize: 12, fontWeight: 600 }}>Held-Out Eval Examples JSON</label>
                      {shards.length > 0 && (
                        <Select
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) void handleLoadShardIntoEditor(e.target.value, "eval");
                          }}
                          style={{ fontSize: 11, padding: "4px 6px", maxWidth: 190 }}
                          aria-label="Load eval JSON from compiled shard"
                        >
                          <option value="">Load from shard…</option>
                          {shards.map((s) => (
                            <option key={s.shardId} value={s.shardId}>
                              {s.recipeName} ({s.shardId.slice(0, 8)})
                            </option>
                          ))}
                        </Select>
                      )}
                    </div>
                    <TextArea value={evalJson} onChange={(e) => setEvalJson(e.target.value)} />
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    <span>4-gram Jaccard Threshold:</span>
                    <input
                      type="range"
                      min={0.3}
                      max={1}
                      step={0.02}
                      value={nearDupThreshold}
                      onChange={(e) => setNearDupThreshold(Number(e.target.value))}
                    />
                    <code style={{ fontWeight: 700 }}>{nearDupThreshold.toFixed(2)}</code>
                  </label>
                  <PrimaryButton type="button" onClick={() => void handleRunDecontaminate()} disabled={decontamLoading}>
                    <ShieldCheckIcon size={13} />
                    {decontamLoading ? "Scanning…" : "Run Decontamination Audit"}
                  </PrimaryButton>
                </div>

                {decontamError && (
                  <div style={{ color: "#fb7185", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                    <AlertIcon size={14} /> {decontamError}
                  </div>
                )}

                {decontamReport && (
                  <div
                    style={{
                      border: "1px solid var(--color-border, rgba(148, 163, 184, 0.2))",
                      borderRadius: 10,
                      padding: 12,
                      background: "var(--color-bg-secondary, rgba(15, 23, 42, 0.45))",
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                      <Tag $tone={decontamReport.contaminatedCount > 0 ? "rose" : "emerald"}>
                        Contaminated: {decontamReport.contaminatedCount} / {decontamReport.trainCount} (
                        {(decontamReport.contaminationRate * 100).toFixed(1)}%)
                      </Tag>
                      <Tag $tone="cyan">Eval Set: {decontamReport.evalCount}</Tag>
                      <Tag $tone="amber">Matches: {decontamReport.matches.length}</Tag>
                    </div>

                    {decontamReport.matches.length > 0 ? (
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <thead>
                            <tr
                              style={{
                                textAlign: "left",
                                borderBottom: "1px solid var(--color-border, rgba(148,163,184,0.2))",
                              }}
                            >
                              <th style={{ padding: "6px 8px" }}>Train URI</th>
                              <th style={{ padding: "6px 8px" }}>Eval URI</th>
                              <th style={{ padding: "6px 8px" }}>Match Kind</th>
                              <th style={{ padding: "6px 8px" }}>Similarity</th>
                              <th style={{ padding: "6px 8px" }}>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {decontamReport.matches.map((m, idx) => (
                              <tr
                                key={`${m.trainExampleId}-${m.evalExampleId}-${idx}`}
                                style={{ borderBottom: "1px solid var(--color-border, rgba(148,163,184,0.12))" }}
                              >
                                <td style={{ padding: "6px 8px", fontFamily: "monospace" }}>{m.trainUri}</td>
                                <td style={{ padding: "6px 8px", fontFamily: "monospace" }}>{m.evalUri}</td>
                                <td style={{ padding: "6px 8px" }}>
                                  <Tag $tone={m.matchKind === "exact-hash" ? "rose" : "amber"}>{m.matchKind}</Tag>
                                </td>
                                <td style={{ padding: "6px 8px", fontFamily: "monospace" }}>
                                  {(m.similarity * 100).toFixed(1)}%
                                </td>
                                <td style={{ padding: "6px 8px" }}>
                                  <SecondaryButton
                                    type="button"
                                    style={{ padding: "3px 8px", fontSize: 11 }}
                                    onClick={() => setLineageLookupId(m.trainExampleId)}
                                  >
                                    Trace &amp; Quarantine
                                  </SecondaryButton>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: "#34d399" }}>
                        Zero exact-hash or 4-gram Jaccard near-duplicates detected across train/eval splits.
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", gap: 12 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <label style={{ fontSize: 12, fontWeight: 600 }}>Before (v1) Examples JSON</label>
                      {shards.length > 0 && (
                        <Select
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) void handleLoadShardIntoEditor(e.target.value, "before");
                          }}
                          style={{ fontSize: 11, padding: "4px 6px", maxWidth: 190 }}
                          aria-label="Load v1 JSON from compiled shard"
                        >
                          <option value="">Load from shard…</option>
                          {shards.map((s) => (
                            <option key={s.shardId} value={s.shardId}>
                              {s.recipeName} ({s.shardId.slice(0, 8)})
                            </option>
                          ))}
                        </Select>
                      )}
                    </div>
                    <TextArea value={beforeJson} onChange={(e) => setBeforeJson(e.target.value)} />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <label style={{ fontSize: 12, fontWeight: 600 }}>After (v2) Examples JSON</label>
                      {shards.length > 0 && (
                        <Select
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) void handleLoadShardIntoEditor(e.target.value, "after");
                          }}
                          style={{ fontSize: 11, padding: "4px 6px", maxWidth: 190 }}
                          aria-label="Load v2 JSON from compiled shard"
                        >
                          <option value="">Load from shard…</option>
                          {shards.map((s) => (
                            <option key={s.shardId} value={s.shardId}>
                              {s.recipeName} ({s.shardId.slice(0, 8)})
                            </option>
                          ))}
                        </Select>
                      )}
                    </div>
                    <TextArea value={afterJson} onChange={(e) => setAfterJson(e.target.value)} />
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <PrimaryButton type="button" onClick={() => void handleRunDiff()} disabled={diffLoading}>
                    <GitCompareIcon size={13} />
                    {diffLoading ? "Computing Semantic Diff…" : "Compute Semantic Version Diff"}
                  </PrimaryButton>
                </div>

                {diffError && (
                  <div style={{ color: "#fb7185", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                    <AlertIcon size={14} /> {diffError}
                  </div>
                )}

                {diffResult && (
                  <div
                    style={{
                      border: "1px solid var(--color-border, rgba(148, 163, 184, 0.2))",
                      borderRadius: 10,
                      padding: 12,
                      background: "var(--color-bg-secondary, rgba(15, 23, 42, 0.45))",
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <Tag $tone="cyan">
                        Count: {diffResult.beforeCount} → {diffResult.afterCount}
                      </Tag>
                      <Tag $tone="emerald">+{diffResult.addedUris.length} added</Tag>
                      <Tag $tone="amber">~{diffResult.modifiedUris.length} modified</Tag>
                      <Tag $tone="rose">-{diffResult.removedUris.length} removed</Tag>
                      <Tag $tone="violet">
                        m_init median: {diffResult.mInitMedianBefore} → {diffResult.mInitMedianAfter} (mean{" "}
                        {diffResult.mInitMeanBefore.toFixed(1)} → {diffResult.mInitMeanAfter.toFixed(1)})
                      </Tag>
                      <Tag $tone={diffResult.estimatedMemoryMultiplier > 1.25 ? "amber" : "emerald"}>
                        GPU VRAM Multiplier: {diffResult.estimatedMemoryMultiplier}x
                      </Tag>
                      <Tag $tone={diffResult.rewardHackingDelta > 0 ? "rose" : "emerald"}>
                        Reward-Hacking Δ:{" "}
                        {diffResult.rewardHackingDelta >= 0
                          ? `+${diffResult.rewardHackingDelta}`
                          : diffResult.rewardHackingDelta}
                      </Tag>
                    </div>

                    {Object.keys(diffResult.dialectDelta).length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, fontSize: 11.5 }}>
                        <span style={{ color: "var(--color-text-secondary, #94a3b8)" }}>Dialect Δ:</span>
                        {Object.entries(diffResult.dialectDelta).map(([d, delta]) => (
                          <Tag key={d} $tone={delta > 0 ? "emerald" : "rose"}>
                            {d}: {delta > 0 ? `+${delta}` : delta}
                          </Tag>
                        ))}
                      </div>
                    )}

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                        gap: 10,
                        fontSize: 11.5,
                      }}
                    >
                      <div>
                        <strong style={{ color: "#34d399" }}>Added URIs ({diffResult.addedUris.length})</strong>
                        <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontFamily: "monospace" }}>
                          {diffResult.addedUris.length === 0 ? (
                            <li>None</li>
                          ) : (
                            diffResult.addedUris.map((u) => <li key={u}>{u}</li>)
                          )}
                        </ul>
                      </div>
                      <div>
                        <strong style={{ color: "#fbbf24" }}>Modified URIs ({diffResult.modifiedUris.length})</strong>
                        <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontFamily: "monospace" }}>
                          {diffResult.modifiedUris.length === 0 ? (
                            <li>None</li>
                          ) : (
                            diffResult.modifiedUris.map((u) => <li key={u}>{u}</li>)
                          )}
                        </ul>
                      </div>
                      <div>
                        <strong style={{ color: "#fb7185" }}>Removed URIs ({diffResult.removedUris.length})</strong>
                        <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontFamily: "monospace" }}>
                          {diffResult.removedUris.length === 0 ? (
                            <li>None</li>
                          ) : (
                            diffResult.removedUris.map((u) => <li key={u}>{u}</li>)
                          )}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </DrawerBody>
        )}
      </DrawerCard>

      {/* Error or Empty States */}
      {error && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: 10,
            border: "1px solid rgba(244, 63, 94, 0.45)",
            background: "rgba(244, 63, 94, 0.12)",
            color: "#fda4af",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
          }}
        >
          <AlertIcon size={16} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div
          style={{
            padding: "48px 18px",
            textAlign: "center",
            color: "var(--color-text-secondary, #94a3b8)",
            fontSize: 14,
          }}
        >
          Loading compiled dataset shards and training recipes…
        </div>
      ) : filteredShards.length === 0 ? (
        <div
          style={{
            border: "1px dashed var(--color-border-default, rgba(148, 163, 184, 0.3))",
            borderRadius: 14,
            padding: "42px 24px",
            textAlign: "center",
            color: "var(--color-text-secondary, #94a3b8)",
          }}
        >
          <p style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 600, color: "var(--color-text-primary, #e6edf3)" }}>
            No dataset shards match your current filters
          </p>
          <p style={{ margin: 0, fontSize: 12.5 }}>
            Try widening your <code>m_init</code> cap, clearing search text, or compiling a new training shard from
            Ansatz Studio.
          </p>
        </div>
      ) : (
        <ShardsGrid>
          {filteredShards.map((shard) => {
            const leftPct = Math.min(94, Math.max(0, (shard.mMin / globalMaxMInit) * 100));
            const rightPct = Math.min(100, Math.max(leftPct + 6, (shard.mMax / globalMaxMInit) * 100));
            const widthPct = Math.max(6, rightPct - leftPct);
            const downloadHref =
              shard.downloadUrl || `/api/v1/memory/datasets/shards/${encodeURIComponent(shard.shardId)}`;

            return (
              <ShardCard key={shard.shardId}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 700,
                        color: "var(--color-text-heading, var(--color-text-primary, #f8fafc))",
                        wordBreak: "break-word",
                      }}
                    >
                      {shard.recipeName}
                      <span
                        style={{
                          marginLeft: 6,
                          fontSize: 12,
                          fontWeight: 500,
                          fontFamily: "monospace",
                          color: "var(--color-text-secondary, #94a3b8)",
                        }}
                      >
                        v{shard.recipeVersion}
                      </span>
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--color-text-tertiary, #64748b)", marginTop: 2 }}>
                      Compiled {new Date(shard.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "flex-end" }}>
                    <Tag $tone={kindTone(shard.datasetKind)}>{shard.datasetKind}</Tag>
                    <Tag $tone="muted">{shard.dialect}</Tag>
                  </div>
                </div>

                {/* Proportional m_init Bar */}
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 11.5,
                      fontFamily: "var(--font-mono, monospace)",
                    }}
                  >
                    <span style={{ color: "var(--color-text-secondary, #94a3b8)" }}>
                      m_init bucket:{" "}
                      <strong style={{ color: "#38bdf8" }}>
                        [{shard.mMin} .. {shard.mMax}]
                      </strong>
                    </span>
                    <span style={{ color: "var(--color-text-secondary, #94a3b8)" }}>
                      {shard.exampleCount.toLocaleString()} ex · {formatBytes(shard.byteSize)}
                    </span>
                  </div>
                  <MBarTrack title={`m_init range [${shard.mMin}, ${shard.mMax}] out of global max ${globalMaxMInit}`}>
                    <MBarFill $leftPct={leftPct} $widthPct={widthPct} />
                  </MBarTrack>
                </div>

                {/* SHA-256 Digest */}
                <DigestRow>
                  <span
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={`SHA-256: ${shard.shardId}`}
                  >
                    sha256:{shard.shardId}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCopyDigest(shard.shardId)}
                    title="Copy SHA-256 shard digest"
                    style={{
                      border: "none",
                      background: "transparent",
                      color: copiedId === shard.shardId ? "#34d399" : "inherit",
                      cursor: "pointer",
                      padding: 2,
                      display: "inline-flex",
                      alignItems: "center",
                    }}
                  >
                    {copiedId === shard.shardId ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                  </button>
                </DigestRow>

                {/* Per-Shard Action Buttons */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: "auto", paddingTop: 4 }}>
                  <CardActionLink
                    to={`/datasets/${encodeURIComponent(shard.shardId)}/browse`}
                    $primary
                    style={{ flex: "1 1 160px" }}
                  >
                    Browse Columnar Slices
                    <ArrowRightIcon size={13} />
                  </CardActionLink>
                  <CardActionLink to="/editor">
                    <CodeIcon size={13} />
                    Open in Ansatz Studio
                  </CardActionLink>
                  <DownloadAnchor
                    href={downloadHref}
                    download={`${shard.recipeName}-${shard.shardId.slice(0, 12)}.jsonl`}
                  >
                    <DownloadIcon size={13} />
                    Download JSONL
                  </DownloadAnchor>
                </div>
              </ShardCard>
            );
          })}
        </ShardsGrid>
      )}
    </PageRoot>
  );
};

export default DatasetsHubPage;
