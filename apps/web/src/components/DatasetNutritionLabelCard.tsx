// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  BeakerIcon,
  CheckCircleIcon,
  CpuIcon,
  DatabaseIcon,
  DownloadIcon,
  GlobeIcon,
  LawIcon,
  LockIcon,
  ShieldCheckIcon,
  VerifiedIcon,
  XCircleIcon,
  ZapIcon,
} from "@primer/octicons-react";
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import styledImport, { keyframes } from "styled-components";

const styled: typeof styledImport =
  (styledImport as unknown as { default?: typeof styledImport }).default ?? styledImport;

/* ─── constants & types ─── */

// eslint-disable-next-line react-refresh/only-export-components
export const ML_PACKAGE_CATEGORIES = new Set<string>([
  "dataset-pretrain",
  "dataset-posttrain",
  "training-recipe",
  "memory-shard",
  "model-core",
  "lora-adapter",
  "projection-head",
]);

const CATEGORY_META: Record<string, { label: string; tone: PillTone }> = {
  "dataset-pretrain": { label: "Pre-train Dataset", tone: "cyan" },
  "dataset-posttrain": { label: "Post-train Dataset", tone: "violet" },
  "training-recipe": { label: "Training Recipe", tone: "indigo" },
  "memory-shard": { label: "DiskANN Memory Shard", tone: "cyan" },
  "model-core": { label: "Model Core", tone: "amber" },
  "lora-adapter": { label: "LoRA Adapter", tone: "violet" },
  "projection-head": { label: "Projection Head", tone: "emerald" },
};

export interface CompiledDatasetShardItem {
  shardId: string;
  recipeName: string;
  recipeVersion: string;
  datasetKind: string;
  dialect: string;
  mMin: number;
  mMax: number;
  exampleCount: number;
  byteSize: number;
  originNode?: string | undefined;
  signerPubkey?: string | undefined;
  memoryContract?:
    | {
        embedderId?: string | undefined;
        embedderHash?: string | undefined;
        dimension?: number | undefined;
        quantization?: string | undefined;
      }
    | null
    | undefined;
  provenance?: Record<string, unknown> | undefined;
  downloadUrl: string;
  createdAt?: string | undefined;
}

interface ParsedAiGovernance {
  allowRag: boolean;
  allowPretrain: boolean;
  allowPosttrain: boolean;
  tenantScope: string;
  license?: string | undefined;
  reciprocalTrainingLicense?: string | undefined;
  explicit: boolean;
}

interface ParsedDynamicM {
  mStart?: number | undefined;
  mMax?: number | undefined;
  mCap?: number | undefined;
  retrievalTau?: number | undefined;
  expansionTau?: number | undefined;
  girardReduceEvery?: number | undefined;
}

interface ParsedMemoryConfig {
  backend?: string | undefined;
  ramQuantization?: string | undefined;
  nvmeFlashEnabled?: boolean | undefined;
  semverPinned?: boolean | undefined;
  includeVerifiedSocialPosts?: boolean | undefined;
  latencySlaMs?: number | undefined;
}

interface ParsedMemoryContract {
  embedderId?: string | undefined;
  embedderHash?: string | undefined;
  dimension?: number | undefined;
  quantization?: string | undefined;
}

interface ParsedTargetModel {
  baseModel?: string | undefined;
  parameterScale?: string | undefined;
  mode?: string | undefined;
  loraRank?: number | undefined;
  loraAlpha?: number | undefined;
}

interface MInitBucketRow {
  key: string;
  label: string;
  dialect: string;
  mMin: number;
  mMax: number;
  exampleCount: number;
  byteSize: number;
  shardCount: number;
  primaryDownloadUrl?: string | undefined;
  isMemoryShard: boolean;
}

export interface DatasetNutritionLabelCardProps {
  packageName: string;
  version: string;
  manifest?: Record<string, unknown> | null | undefined;
  license?: string | null | undefined;
  packageSignature?: string | null | undefined;
  contentHash?: string | null | undefined;
  oidcRepository?: string | null | undefined;
}

/* ─── helpers ─── */

function asRecord(val: unknown): Record<string, unknown> | undefined {
  return val && typeof val === "object" && !Array.isArray(val) ? (val as Record<string, unknown>) : undefined;
}

function asString(val: unknown): string | undefined {
  return typeof val === "string" && val.trim().length > 0 ? val.trim() : undefined;
}

function asFiniteNumber(val: unknown): number | undefined {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string" && val.trim().length > 0) {
    const parsed = Number(val);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asBoolean(val: unknown): boolean | undefined {
  if (typeof val === "boolean") return val;
  return undefined;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIdx = 0;
  while (value >= 1024 && unitIdx < units.length - 1) {
    value /= 1024;
    unitIdx += 1;
  }
  return `${unitIdx === 0 ? Math.round(value) : value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIdx]}`;
}

function formatMemoryConfigHeadline(cfg: ParsedMemoryConfig): string {
  const backendLabel = !cfg.backend || cfg.backend.toLowerCase() === "diskann" ? "DiskANN" : cfg.backend.toUpperCase();
  const quantLabel = cfg.ramQuantization ? cfg.ramQuantization.toUpperCase() : "INT8";
  const nvmeSuffix = cfg.nvmeFlashEnabled === false ? "" : " + NVMe";
  return `${backendLabel} ${quantLabel}${nvmeSuffix}`;
}

/* ─── styled components ─── */

type PillTone = "cyan" | "emerald" | "amber" | "violet" | "indigo" | "rose" | "neutral";

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const CardRoot = styled.section`
  position: relative;
  border-radius: 14px;
  border: 1px solid var(--color-border-glass, rgba(56, 189, 248, 0.28));
  background: var(--color-bg-card, rgba(15, 23, 42, 0.72));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  padding: 18px 20px;
  margin-bottom: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow: hidden;
  animation: ${fadeIn} 0.25s ease;

  &::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: linear-gradient(90deg, #06b6d4 0%, #6366f1 55%, #a855f7 100%);
  }
`;

const TopHeaderRow = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`;

const TitleBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
`;

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const CardTitle = styled.h2`
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--color-text-heading, var(--ms-text-1, #f8fafc));
  display: inline-flex;
  align-items: center;
  gap: 7px;
`;

const PackageRefMono = styled.span`
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11.5px;
  color: var(--color-text-muted, var(--ms-text-3, #94a3b8));
`;

const BadgeCluster = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
`;

const Pill = styled.span<{ $tone?: PillTone | undefined; $mono?: boolean | undefined }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.3;
  font-family: ${(p) => (p.$mono ? "var(--font-mono, ui-monospace, monospace)" : "inherit")};
  white-space: nowrap;
  border: 1px solid
    ${({ $tone }) =>
      $tone === "emerald"
        ? "rgba(52, 211, 153, 0.42)"
        : $tone === "amber"
          ? "rgba(251, 191, 36, 0.42)"
          : $tone === "violet"
            ? "rgba(167, 139, 250, 0.42)"
            : $tone === "indigo"
              ? "rgba(129, 140, 248, 0.42)"
              : $tone === "rose"
                ? "rgba(248, 113, 113, 0.42)"
                : $tone === "neutral"
                  ? "var(--color-border-subtle, rgba(148, 163, 184, 0.3))"
                  : "rgba(56, 189, 248, 0.42)"};
  background: ${({ $tone }) =>
    $tone === "emerald"
      ? "rgba(16, 185, 129, 0.12)"
      : $tone === "amber"
        ? "rgba(245, 158, 11, 0.12)"
        : $tone === "violet"
          ? "rgba(139, 92, 246, 0.12)"
          : $tone === "indigo"
            ? "rgba(99, 102, 241, 0.12)"
            : $tone === "rose"
              ? "rgba(244, 63, 94, 0.12)"
              : $tone === "neutral"
                ? "var(--ms-surface-hover, rgba(148, 163, 184, 0.1))"
                : "rgba(6, 182, 212, 0.12)"};
  color: ${({ $tone }) =>
    $tone === "emerald"
      ? "var(--color-success-fg, #10b981)"
      : $tone === "amber"
        ? "var(--color-attention-fg, #f59e0b)"
        : $tone === "violet"
          ? "#a78bfa"
          : $tone === "indigo"
            ? "#818cf8"
            : $tone === "rose"
              ? "var(--color-danger-fg, #f43f5e)"
              : $tone === "neutral"
                ? "var(--color-text-muted, var(--ms-text-2, #94a3b8))"
                : "var(--ms-brand, #06b6d4)"};
`;

const GovernanceStrip = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--ms-surface-hover, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08));
`;

const StripLabel = styled.span`
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted, var(--ms-text-3, #94a3b8));
  margin-right: 4px;
`;

const MetricsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(145px, 1fr));
  gap: 10px;
`;

const MetricTile = styled.div`
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08));
  background: var(--ms-surface-hover, rgba(255, 255, 255, 0.025));
  display: flex;
  flex-direction: column;
  gap: 3px;
`;

const MetricLabel = styled.span`
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted, var(--ms-text-3, #94a3b8));
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const MetricValue = styled.span`
  font-size: 16px;
  font-weight: 700;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-heading, var(--ms-text-1, #f8fafc));
`;

const BucketSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08));
  background: var(--ms-surface-hover, rgba(255, 255, 255, 0.02));
`;

const BucketHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
`;

const BucketRow = styled.div`
  display: grid;
  grid-template-columns: minmax(130px, 175px) 1fr auto;
  align-items: center;
  gap: 10px;

  @media (max-width: 640px) {
    grid-template-columns: 1fr;
    gap: 4px;
  }
`;

const BucketLabelGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11.5px;
  color: var(--color-text-primary, var(--ms-text-1, #e2e8f0));
`;

const DialectTag = styled.span`
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(6, 182, 212, 0.14);
  color: var(--ms-brand, #06b6d4);
`;

const BarTrack = styled.div`
  height: 10px;
  border-radius: 999px;
  background: var(--color-border-subtle, rgba(148, 163, 184, 0.16));
  overflow: hidden;
  position: relative;
`;

const BarFill = styled.div<{ $widthPct: number; $isMemory?: boolean | undefined }>`
  height: 100%;
  width: ${(p) => `${Math.max(4, Math.min(100, p.$widthPct))}%`};
  border-radius: 999px;
  background: ${(p) =>
    p.$isMemory
      ? "linear-gradient(90deg, #10b981 0%, #06b6d4 100%)"
      : "linear-gradient(90deg, #06b6d4 0%, #6366f1 100%)"};
  transition: width 0.35s cubic-bezier(0.16, 1, 0.3, 1);
`;

const BucketStats = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  color: var(--color-text-muted, var(--ms-text-2, #94a3b8));
  white-space: nowrap;
`;

const ShardDownloadIconLink = styled.a`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  color: var(--color-text-muted, #94a3b8);
  border: 1px solid transparent;
  text-decoration: none;
  transition: all 0.15s ease;

  &:hover {
    color: var(--ms-brand, #06b6d4);
    border-color: rgba(6, 182, 212, 0.35);
    background: rgba(6, 182, 212, 0.1);
  }
`;

const ConfigGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
`;

const ConfigCard = styled.div`
  padding: 11px 13px;
  border-radius: 10px;
  border: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08));
  background: var(--ms-surface-hover, rgba(255, 255, 255, 0.025));
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const ConfigCardTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted, var(--ms-text-3, #94a3b8));
`;

const ConfigPrimaryValue = styled.div`
  font-size: 13.5px;
  font-weight: 700;
  font-family: var(--font-mono, ui-monospace, monospace);
  color: var(--color-text-heading, var(--ms-text-1, #f8fafc));
`;

const ConfigMetaRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 11.5px;
  color: var(--color-text-muted, var(--ms-text-2, #94a3b8));
`;

const FooterRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 10px;
  border-top: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08));
`;

const FooterMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 11.5px;
  color: var(--color-text-muted, var(--ms-text-3, #94a3b8));
  font-family: var(--font-mono, ui-monospace, monospace);
`;

const ActionGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const StudioCtaLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 13px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  text-decoration: none;
  background: linear-gradient(135deg, #0284c7, #6366f1);
  color: #ffffff !important;
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.28);
  transition: all 0.15s ease;
  white-space: nowrap;

  &:hover {
    opacity: 0.94;
    transform: translateY(-1px);
    text-decoration: none;
  }
`;

const ExportLink = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  border: 1px solid var(--color-border-default, rgba(148, 163, 184, 0.3));
  background: var(--ms-surface-hover, rgba(255, 255, 255, 0.04));
  color: var(--color-text-primary, var(--ms-text-1, #e2e8f0));
  transition: all 0.15s ease;
  white-space: nowrap;

  &:hover {
    border-color: var(--ms-brand, #06b6d4);
    color: var(--ms-brand, #06b6d4);
    text-decoration: none;
  }
`;

const EmptyShardsNote = styled.div`
  font-size: 12px;
  color: var(--color-text-muted, var(--ms-text-3, #94a3b8));
  font-style: italic;
  padding: 4px 2px;
`;

/* ─── component ─── */

export const DatasetNutritionLabelCard: React.FC<DatasetNutritionLabelCardProps> = ({
  packageName,
  version,
  manifest,
  license,
  packageSignature,
  contentHash,
  oidcRepository,
}) => {
  const [shards, setShards] = useState<CompiledDatasetShardItem[]>([]);
  const [shardsLoaded, setShardsLoaded] = useState(false);

  // Extract manifest metadata cleanly from `package.json#modelscript` and `modelscript.ml`
  const extracted = useMemo(() => {
    const root = asRecord(manifest) ?? {};
    const msMeta = asRecord(root["modelscript"]) ?? {};
    const mlMeta = asRecord(msMeta["ml"]) ?? asRecord(root["ml"]) ?? {};

    const rawCategory = (
      asString(msMeta["category"]) ||
      asString(mlMeta["kind"]) ||
      asString(msMeta["kind"]) ||
      asString(root["category"])
    )?.toLowerCase();

    const isMlCategory = Boolean(rawCategory && ML_PACKAGE_CATEGORIES.has(rawCategory));

    const rawGov =
      asRecord(mlMeta["aiGovernance"]) ?? asRecord(msMeta["aiGovernance"]) ?? asRecord(root["aiGovernance"]);

    const rawDynamicM = asRecord(mlMeta["dynamicM"]) ?? asRecord(msMeta["dynamicM"]) ?? asRecord(root["dynamicM"]);
    const dynamicM: ParsedDynamicM | null = rawDynamicM
      ? {
          mStart: asFiniteNumber(rawDynamicM["mStart"]),
          mMax: asFiniteNumber(rawDynamicM["mMax"]),
          mCap: asFiniteNumber(rawDynamicM["mCap"]),
          retrievalTau: asFiniteNumber(rawDynamicM["retrievalTau"]),
          expansionTau: asFiniteNumber(rawDynamicM["expansionTau"]),
          girardReduceEvery: asFiniteNumber(rawDynamicM["girardReduceEvery"]),
        }
      : null;
    const hasDynamicM = Boolean(
      dynamicM &&
      (dynamicM.mStart !== undefined ||
        dynamicM.mMax !== undefined ||
        dynamicM.mCap !== undefined ||
        dynamicM.retrievalTau !== undefined),
    );

    const rawMemCfg =
      asRecord(mlMeta["memoryConfig"]) ?? asRecord(msMeta["memoryConfig"]) ?? asRecord(root["memoryConfig"]);
    const memoryConfig: ParsedMemoryConfig | null = rawMemCfg
      ? {
          backend: asString(rawMemCfg["backend"]),
          ramQuantization: asString(rawMemCfg["ramQuantization"]),
          nvmeFlashEnabled: asBoolean(rawMemCfg["nvmeFlashEnabled"]),
          semverPinned: asBoolean(rawMemCfg["semverPinned"]),
          includeVerifiedSocialPosts: asBoolean(rawMemCfg["includeVerifiedSocialPosts"]),
          latencySlaMs: asFiniteNumber(rawMemCfg["latencySlaMs"]),
        }
      : null;

    const rawMemContract =
      asRecord(mlMeta["memoryContract"]) ?? asRecord(msMeta["memoryContract"]) ?? asRecord(root["memoryContract"]);
    const memoryContract: ParsedMemoryContract | null = rawMemContract
      ? {
          embedderId: asString(rawMemContract["embedderId"]),
          embedderHash: asString(rawMemContract["embedderHash"]),
          dimension: asFiniteNumber(rawMemContract["dimension"]),
          quantization: asString(rawMemContract["quantization"]),
        }
      : null;

    const rawTarget =
      asRecord(mlMeta["targetModel"]) ?? asRecord(msMeta["targetModel"]) ?? asRecord(root["targetModel"]);
    const targetModel: ParsedTargetModel | null = rawTarget
      ? {
          baseModel: asString(rawTarget["baseModel"]),
          parameterScale: asString(rawTarget["parameterScale"]),
          mode: asString(rawTarget["mode"]),
          loraRank: asFiniteNumber(rawTarget["loraRank"]),
          loraAlpha: asFiniteNumber(rawTarget["loraAlpha"]),
        }
      : null;

    const manifestSignerPubkey =
      asString(msMeta["signerPubkey"]) || asString(mlMeta["signerPubkey"]) || asString(root["signerPubkey"]);
    const manifestLicense = asString(root["license"]);
    const manifestLanguages = Array.isArray(msMeta["languages"])
      ? msMeta["languages"].filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : asString(msMeta["language"])
        ? [asString(msMeta["language"])!]
        : [];

    return {
      rawCategory,
      isMlCategory,
      rawGov,
      dynamicM: hasDynamicM ? dynamicM : null,
      memoryConfig,
      memoryContract,
      targetModel,
      manifestSignerPubkey,
      manifestLicense,
      manifestLanguages,
    };
  }, [manifest]);

  // Fetch compiled shards for this package name
  useEffect(() => {
    if (!packageName) return;
    const controller = new AbortController();
    setShardsLoaded(false);

    const fetchShards = async () => {
      try {
        const res = await fetch(`/api/v1/memory/datasets/shards?recipeName=${encodeURIComponent(packageName)}`, {
          method: "GET",
          credentials: "include",
          signal: controller.signal,
        });
        if (!res.ok) {
          if (!controller.signal.aborted) {
            setShards([]);
            setShardsLoaded(true);
          }
          return;
        }
        const data = (await res.json()) as { shards?: CompiledDatasetShardItem[] };
        if (!controller.signal.aborted) {
          setShards(Array.isArray(data.shards) ? data.shards : []);
          setShardsLoaded(true);
        }
      } catch {
        if (!controller.signal.aborted) {
          setShards([]);
          setShardsLoaded(true);
        }
      }
    };

    void fetchShards();
    return () => {
      controller.abort();
    };
  }, [packageName]);

  // Aggregate shard telemetry & m_init bucket bars
  const shardStats = useMemo(() => {
    let totalExamples = 0;
    let totalBytes = 0;
    let minM: number | null = null;
    let maxM: number | null = null;
    const bucketMap = new Map<string, MInitBucketRow>();
    const dialectSet = new Set<string>();
    let shardSignerPubkey: string | undefined;
    let shardGovernance: Record<string, unknown> | undefined;
    let shardMemoryContract: ParsedMemoryContract | null = null;

    for (const s of shards) {
      const ex = Number.isFinite(s.exampleCount) ? s.exampleCount : 0;
      const bytes = Number.isFinite(s.byteSize) ? s.byteSize : 0;
      const mMin = Number.isFinite(s.mMin) ? s.mMin : 0;
      const mMax = Number.isFinite(s.mMax) ? s.mMax : 0;
      const isMemory = s.datasetKind === "memory-shard" && mMin === 0 && mMax === 0;

      totalExamples += ex;
      totalBytes += bytes;
      if (s.dialect) dialectSet.add(s.dialect);

      if (!isMemory) {
        minM = minM === null ? mMin : Math.min(minM, mMin);
        maxM = maxM === null ? mMax : Math.max(maxM, mMax);
      }

      if (!shardSignerPubkey) {
        const prov = asRecord(s.provenance);
        shardSignerPubkey = asString(s.signerPubkey) || asString(prov?.["signerPubkey"]);
      }
      if (!shardGovernance) {
        const prov = asRecord(s.provenance);
        shardGovernance = asRecord(prov?.["aiGovernance"]);
      }
      if (!shardMemoryContract && s.memoryContract) {
        shardMemoryContract = {
          embedderId: asString(s.memoryContract.embedderId),
          embedderHash: asString(s.memoryContract.embedderHash),
          dimension: asFiniteNumber(s.memoryContract.dimension),
          quantization: asString(s.memoryContract.quantization),
        };
      }

      const bucketKey = isMemory ? `memory:${s.dialect}` : `${mMin}-${mMax}:${s.dialect}`;
      const existing = bucketMap.get(bucketKey);
      if (existing) {
        existing.exampleCount += ex;
        existing.byteSize += bytes;
        existing.shardCount += 1;
      } else {
        const label = isMemory ? "memory-shard" : mMin === mMax ? `m_init = ${mMin}` : `m_init ${mMin}..${mMax}`;
        bucketMap.set(bucketKey, {
          key: bucketKey,
          label,
          dialect: s.dialect || "polyglot",
          mMin,
          mMax,
          exampleCount: ex,
          byteSize: bytes,
          shardCount: 1,
          primaryDownloadUrl: s.downloadUrl,
          isMemoryShard: isMemory,
        });
      }
    }

    const buckets = Array.from(bucketMap.values()).sort((a, b) => {
      if (a.isMemoryShard !== b.isMemoryShard) return a.isMemoryShard ? 1 : -1;
      if (a.mMin !== b.mMin) return a.mMin - b.mMin;
      if (a.mMax !== b.mMax) return a.mMax - b.mMax;
      return b.exampleCount - a.exampleCount;
    });
    const maxBucketExamples = buckets.reduce((acc, b) => Math.max(acc, b.exampleCount), 0);

    return {
      count: shards.length,
      totalExamples,
      totalBytes,
      minM,
      maxM,
      buckets,
      maxBucketExamples,
      dialects: Array.from(dialectSet),
      shardSignerPubkey,
      shardGovernance,
      shardMemoryContract,
    };
  }, [shards]);

  // Cleanly hide for ordinary libraries that have zero compiled shards
  const shouldRender = extracted.isMlCategory || shards.length > 0;
  if (!shouldRender) {
    return null;
  }

  const effectiveCategory =
    extracted.rawCategory && ML_PACKAGE_CATEGORIES.has(extracted.rawCategory)
      ? extracted.rawCategory
      : shards[0]?.datasetKind && ML_PACKAGE_CATEGORIES.has(shards[0].datasetKind.toLowerCase())
        ? shards[0].datasetKind.toLowerCase()
        : "dataset-pretrain";

  const categoryInfo = CATEGORY_META[effectiveCategory] ?? {
    label: effectiveCategory,
    tone: "cyan" as PillTone,
  };

  // Resolve effective aiGovernance policy
  const govSource = extracted.rawGov ?? shardStats.shardGovernance;
  const governance: ParsedAiGovernance = {
    allowRag: asBoolean(govSource?.["allowRag"]) ?? true,
    allowPretrain: asBoolean(govSource?.["allowPretrain"]) ?? effectiveCategory === "dataset-pretrain",
    allowPosttrain:
      asBoolean(govSource?.["allowPosttrain"]) ??
      (effectiveCategory === "dataset-posttrain" || effectiveCategory === "training-recipe"),
    tenantScope: asString(govSource?.["tenantScope"]) ?? "public",
    license: asString(govSource?.["license"]) ?? license ?? extracted.manifestLicense,
    reciprocalTrainingLicense: asString(govSource?.["reciprocalTrainingLicense"]),
    explicit: Boolean(govSource),
  };

  // Ed25519 provenance / signing resolution
  const signerProof = packageSignature || extracted.manifestSignerPubkey || shardStats.shardSignerPubkey || null;
  const isEd25519Signed = Boolean(signerProof);
  const effectiveMemoryContract = extracted.memoryContract ?? shardStats.shardMemoryContract;

  // Build 1-click studio & post-train export URLs
  const studioUrl = `/editor?package=${encodeURIComponent(packageName)}&version=${encodeURIComponent(version)}`;

  const hasPosttrainShard = shards.some((s) => s.datasetKind === "dataset-posttrain");
  const showExportPosttrain =
    effectiveCategory === "dataset-posttrain" || governance.allowPosttrain || hasPosttrainShard;

  const singleDialect =
    shardStats.dialects.length === 1 && shardStats.dialects[0] !== "polyglot"
      ? shardStats.dialects[0]
      : extracted.manifestLanguages.length === 1
        ? extracted.manifestLanguages[0]!.toLowerCase()
        : undefined;

  const exportPosttrainUrl = `/api/v1/rlhf/export/dataset-posttrain?format=jsonl${
    singleDialect ? `&dialect=${encodeURIComponent(singleDialect)}` : ""
  }`;
  const safeDownloadFilename = `${packageName.replace(/[^a-zA-Z0-9._-]+/g, "-")}-${version}-posttrain.jsonl`;

  const mInitRangeText =
    shardStats.minM !== null && shardStats.maxM !== null
      ? `${shardStats.minM}..${shardStats.maxM}`
      : shardStats.count > 0
        ? "0..0"
        : "—";

  const hasConfigRow = Boolean(
    extracted.dynamicM || extracted.memoryConfig || effectiveMemoryContract || extracted.targetModel,
  );

  return (
    <CardRoot data-testid="dataset-nutrition-label-card" aria-label="AI Data and Training Nutrition Label">
      {/* ── Header: Title, Category Pill & Ed25519 Provenance Badge ── */}
      <TopHeaderRow>
        <TitleBlock>
          <TitleRow>
            <CardTitle>
              <DatabaseIcon size={16} fill="var(--ms-brand, #06b6d4)" />
              AI Data &amp; Training Nutrition Label
            </CardTitle>
            <Pill $tone={categoryInfo.tone} $mono>
              {effectiveCategory === "training-recipe" ? <BeakerIcon size={11} /> : <CpuIcon size={11} />}
              {categoryInfo.label} ({effectiveCategory})
            </Pill>
          </TitleRow>
          <PackageRefMono>
            {packageName}@{version}
            {shardStats.dialects.length > 0 ? ` · ${shardStats.dialects.join(", ")}` : ""}
          </PackageRefMono>
        </TitleBlock>

        <BadgeCluster>
          <Pill
            $tone={isEd25519Signed ? "emerald" : "amber"}
            title={
              isEd25519Signed
                ? `Ed25519 cryptographic provenance verified (${signerProof!.slice(0, 18)}…)`
                : "Release does not include an Ed25519 publisher signature."
            }
          >
            {isEd25519Signed ? <VerifiedIcon size={12} /> : <AlertIcon size={12} />}
            {isEd25519Signed ? "Ed25519 Signed" : "Unsigned"}
          </Pill>
          {oidcRepository && (
            <Pill $tone="cyan" title={`Published via trusted OIDC provenance from ${oidcRepository}`}>
              <ShieldCheckIcon size={12} />
              OIDC Provenance
            </Pill>
          )}
        </BadgeCluster>
      </TopHeaderRow>

      {/* ── AI Governance Consent Badges ── */}
      <GovernanceStrip aria-label="AI Governance Consent Policy">
        <StripLabel>AI Governance</StripLabel>
        <Pill
          $tone={governance.allowRag ? "emerald" : "rose"}
          title={governance.allowRag ? "Indexed for DiskANN RAG retrieval" : "Excluded from RAG indexing"}
        >
          {governance.allowRag ? <CheckCircleIcon size={11} /> : <XCircleIcon size={11} />}
          RAG: {governance.allowRag ? "Allowed" : "Blocked"}
        </Pill>
        <Pill
          $tone={governance.allowPretrain ? "emerald" : "rose"}
          title={
            governance.allowPretrain
              ? "Authorized for foundation model pre-training"
              : "Not authorized for pre-training"
          }
        >
          {governance.allowPretrain ? <CheckCircleIcon size={11} /> : <XCircleIcon size={11} />}
          Pre-train: {governance.allowPretrain ? "Allowed" : "Blocked"}
        </Pill>
        <Pill
          $tone={governance.allowPosttrain ? "emerald" : "rose"}
          title={
            governance.allowPosttrain
              ? "Authorized for RLVR / DPO / SFT post-training"
              : "Not authorized for post-training"
          }
        >
          {governance.allowPosttrain ? <CheckCircleIcon size={11} /> : <XCircleIcon size={11} />}
          Post-train: {governance.allowPosttrain ? "Allowed" : "Blocked"}
        </Pill>
        <Pill
          $tone={governance.tenantScope === "public" ? "cyan" : "amber"}
          $mono
          title={`Tenant visibility & governance scope: ${governance.tenantScope}`}
        >
          {governance.tenantScope === "public" ? <GlobeIcon size={11} /> : <LockIcon size={11} />}
          scope:{governance.tenantScope}
        </Pill>
        {governance.license && (
          <Pill $tone="neutral" $mono title="Dataset / package license">
            <LawIcon size={11} />
            {governance.license}
          </Pill>
        )}
        {governance.reciprocalTrainingLicense && governance.reciprocalTrainingLicense !== governance.license && (
          <Pill $tone="violet" $mono title="Reciprocal training license obligation">
            Reciprocal: {governance.reciprocalTrainingLicense}
          </Pill>
        )}
      </GovernanceStrip>

      {/* ── Compiled Shards Summary KPIs ── */}
      <MetricsGrid>
        <MetricTile>
          <MetricLabel>Compiled Shards</MetricLabel>
          <MetricValue>{shardsLoaded ? shardStats.count.toLocaleString() : "…"}</MetricValue>
        </MetricTile>
        <MetricTile>
          <MetricLabel>Compiled Examples</MetricLabel>
          <MetricValue>{shardsLoaded ? shardStats.totalExamples.toLocaleString() : "…"}</MetricValue>
        </MetricTile>
        <MetricTile>
          <MetricLabel>Total Shard Bytes</MetricLabel>
          <MetricValue>{shardsLoaded ? formatBytes(shardStats.totalBytes) : "…"}</MetricValue>
        </MetricTile>
        <MetricTile>
          <MetricLabel>m_init Range</MetricLabel>
          <MetricValue>{shardsLoaded ? mInitRangeText : "…"}</MetricValue>
        </MetricTile>
      </MetricsGrid>

      {/* ── Visual m_init Bucket Distribution Bars ── */}
      {shardStats.buckets.length > 0 ? (
        <BucketSection aria-label="m_init Bucket Distribution Across Shards">
          <BucketHeader>
            <StripLabel>m_init Curriculum Bucket Distribution</StripLabel>
            <PackageRefMono>
              {shardStats.buckets.length} {shardStats.buckets.length === 1 ? "bucket" : "buckets"} · HTTP Range OPFS
              streaming ready
            </PackageRefMono>
          </BucketHeader>
          {shardStats.buckets.map((bucket) => {
            const relWidth =
              shardStats.maxBucketExamples > 0 ? (bucket.exampleCount / shardStats.maxBucketExamples) * 100 : 100;
            const sharePct =
              shardStats.totalExamples > 0 ? Math.round((bucket.exampleCount / shardStats.totalExamples) * 100) : 0;
            return (
              <BucketRow key={bucket.key}>
                <BucketLabelGroup>
                  <span>{bucket.label}</span>
                  <DialectTag>{bucket.dialect}</DialectTag>
                </BucketLabelGroup>
                <BarTrack
                  role="progressbar"
                  aria-label={`${bucket.label} (${bucket.dialect})`}
                  aria-valuenow={sharePct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  title={`${bucket.label}: ${bucket.exampleCount.toLocaleString()} examples (${sharePct}%), ${formatBytes(bucket.byteSize)}`}
                >
                  <BarFill $widthPct={relWidth} $isMemory={bucket.isMemoryShard} />
                </BarTrack>
                <BucketStats>
                  <span>
                    {bucket.exampleCount.toLocaleString()} ex ({sharePct}%) · {formatBytes(bucket.byteSize)}
                  </span>
                  {bucket.primaryDownloadUrl && !bucket.isMemoryShard && (
                    <ShardDownloadIconLink
                      href={bucket.primaryDownloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`Download ${bucket.label} shard JSONL`}
                      aria-label={`Download ${bucket.label} shard JSONL`}
                    >
                      <DownloadIcon size={12} />
                    </ShardDownloadIconLink>
                  )}
                </BucketStats>
              </BucketRow>
            );
          })}
        </BucketSection>
      ) : (
        <EmptyShardsNote>
          {shardsLoaded
            ? "No compiled m_init shards indexed yet for this package."
            : "Querying compiled m_init dataset shards…"}
        </EmptyShardsNote>
      )}

      {/* ── Dynamic-m Curriculum, DiskANN MemoryConfig & Target Model Metadata ── */}
      {hasConfigRow && (
        <ConfigGrid>
          {extracted.dynamicM && (
            <ConfigCard>
              <ConfigCardTitle>
                <ZapIcon size={12} fill="#06b6d4" />
                Dynamic-m Curriculum
              </ConfigCardTitle>
              <ConfigPrimaryValue>
                {extracted.dynamicM.mStart ?? 1} &rarr; {extracted.dynamicM.mMax ?? "—"} /{" "}
                {extracted.dynamicM.mCap ?? "—"}
              </ConfigPrimaryValue>
              <ConfigMetaRow>
                {extracted.dynamicM.retrievalTau !== undefined && (
                  <span>
                    retrievalTau (τ) = <strong>{extracted.dynamicM.retrievalTau}</strong>
                  </span>
                )}
                {extracted.dynamicM.expansionTau !== undefined && (
                  <span>· expTau = {extracted.dynamicM.expansionTau}</span>
                )}
                {extracted.dynamicM.girardReduceEvery !== undefined && (
                  <span>· Girard every {extracted.dynamicM.girardReduceEvery}L</span>
                )}
              </ConfigMetaRow>
            </ConfigCard>
          )}

          {(extracted.memoryConfig || effectiveMemoryContract) && (
            <ConfigCard>
              <ConfigCardTitle>
                <DatabaseIcon size={12} fill="#a78bfa" />
                External Memory Config
              </ConfigCardTitle>
              <ConfigPrimaryValue>
                {extracted.memoryConfig
                  ? formatMemoryConfigHeadline(extracted.memoryConfig)
                  : effectiveMemoryContract?.quantization
                    ? effectiveMemoryContract.quantization.toUpperCase()
                    : "DiskANN INT8 + NVMe"}
              </ConfigPrimaryValue>
              <ConfigMetaRow>
                {extracted.memoryConfig?.semverPinned && <span>Semver-Pinned</span>}
                {extracted.memoryConfig?.latencySlaMs !== undefined && (
                  <span>· SLA ≤ {extracted.memoryConfig.latencySlaMs} ms</span>
                )}
                {effectiveMemoryContract?.embedderId && (
                  <span>
                    {extracted.memoryConfig ? "· " : ""}
                    {effectiveMemoryContract.embedderId}
                    {effectiveMemoryContract.dimension ? ` (${effectiveMemoryContract.dimension}d)` : ""}
                  </span>
                )}
              </ConfigMetaRow>
            </ConfigCard>
          )}

          {extracted.targetModel && (
            <ConfigCard>
              <ConfigCardTitle>
                <CpuIcon size={12} fill="#f59e0b" />
                Target Reasoning Core
              </ConfigCardTitle>
              <ConfigPrimaryValue>
                {extracted.targetModel.baseModel ?? "Small Reasoning Core"}
                {extracted.targetModel.parameterScale ? ` · ${extracted.targetModel.parameterScale}` : ""}
              </ConfigPrimaryValue>
              <ConfigMetaRow>
                {extracted.targetModel.mode && <span>mode: {extracted.targetModel.mode}</span>}
                {extracted.targetModel.loraRank !== undefined && (
                  <span>
                    · LoRA r={extracted.targetModel.loraRank}
                    {extracted.targetModel.loraAlpha !== undefined ? ` / α=${extracted.targetModel.loraAlpha}` : ""}
                  </span>
                )}
              </ConfigMetaRow>
            </ConfigCard>
          )}
        </ConfigGrid>
      )}

      {/* ── Footer Actions: 1-Click RLVR Studio & Export Post-Train JSONL ── */}
      <FooterRow>
        <FooterMeta>
          {contentHash && (
            <span title={`Content digest: ${contentHash}`}>
              digest: {contentHash.length > 20 ? `${contentHash.slice(0, 18)}…` : contentHash}
            </span>
          )}
          {!governance.explicit && <span>governance: manifest default</span>}
        </FooterMeta>

        <ActionGroup>
          {showExportPosttrain && (
            <ExportLink
              href={exportPosttrainUrl}
              download={safeDownloadFilename}
              target="_blank"
              rel="noopener noreferrer"
              title="Export verified post-training examples in JSONL format"
            >
              <DownloadIcon size={13} />
              Export Post-Train JSONL
            </ExportLink>
          )}
          <StudioCtaLink to={studioUrl}>
            <BeakerIcon size={13} />
            Open in Ansatz RLVR Studio
          </StudioCtaLink>
        </ActionGroup>
      </FooterRow>
    </CardRoot>
  );
};

export default DatasetNutritionLabelCard;
