// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  CheckCircleIcon,
  DatabaseIcon,
  LinkExternalIcon,
  SearchIcon,
  ShieldIcon,
  SyncIcon,
  XIcon,
} from "@primer/octicons-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";

export interface LineageOverlayPatch {
  id: number;
  recipeName: string;
  exampleId: string;
  action: "quarantine" | "patch_source" | "hypergraph_override";
  reason: string;
  patchedSource: string | null;
  hypergraphOverrides: unknown[] | null;
  createdBy: number | null;
  createdAt: string;
}

export interface LineageCompiledShard {
  shardId: string;
  recipeName: string;
  recipeVersion: string;
  datasetKind: "dataset-pretrain" | "dataset-posttrain" | "training-recipe" | string;
  dialect: string;
  mMin: number;
  mMax: number;
  exampleCount: number;
  byteSize: number;
  matchReasons: string[];
  provenance: Record<string, unknown>;
  createdAt: string;
}

export interface LineageMemoryChunk {
  chunkId: string;
  sourceKind: string;
  sourceUri: string;
  packageName: string | null;
  packageVersion: string | null;
  gitSha: string | null;
  dialect: string;
  tenantScope: string;
  formalVerified: boolean;
  symbolTags: string[];
  updatedAt: string;
}

export interface LineageResponse {
  exampleId: string;
  blastRadius: {
    totalImpactedArtifacts: number;
    overlayPatchCount: number;
    impactedShardCount: number;
    impactedRecipeCount: number;
    impactedMemoryChunkCount: number;
    quarantined: boolean;
    affectedRecipes: string[];
  };
  overlayPatches: LineageOverlayPatch[];
  compiledShards: LineageCompiledShard[];
  memoryChunks: LineageMemoryChunk[];
}

export interface DataLineageGraphCardProps {
  /** Initial or controlled exampleId / URI substring to trace. */
  exampleId?: string;
  /** Optional recipe name context used when posting a 1-click quarantine patch. */
  recipeName?: string;
  /** Callback fired after a quarantine patch is successfully persisted. */
  onQuarantined?: (exampleId: string) => void;
  /** Optional close handler when rendered inside a slide-over drawer. */
  onClose?: () => void;
  /** Hide the interactive search bar when embedded in a tightly scoped context. */
  hideSearchInput?: boolean;
}

type NodeColumn = "example" | "patch" | "shard" | "recipe" | "chunk";

interface DagNode {
  id: string;
  column: NodeColumn;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  subtitle: string;
  badge?: string;
  tone: "cyan" | "rose" | "amber" | "violet" | "blue" | "emerald" | "muted";
  isEmpty?: boolean;
  isOverflow?: boolean;
  payload?:
    LineageOverlayPatch | LineageCompiledShard | LineageMemoryChunk | { recipeName: string } | { exampleId: string };
}

interface DagEdge {
  id: string;
  from: string;
  to: string;
  dashed?: boolean;
  tone: "cyan" | "rose" | "amber" | "blue" | "emerald" | "muted";
}

const CardRoot = styled.section`
  border: 1px solid var(--color-border-default, rgba(148, 163, 184, 0.25));
  border-radius: 14px;
  background: var(--color-bg-elevated, var(--ms-bg-elv, #111827));
  color: var(--color-text-primary, #e6edf3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--ms-shadow-card, 0 8px 28px rgba(0, 0, 0, 0.2));
`;

const CardHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--color-border, rgba(148, 163, 184, 0.18));
  background: var(--color-bg-secondary, rgba(15, 23, 42, 0.55));
`;

const TitleBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
`;

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const Heading = styled.h3`
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text-heading, var(--color-text-primary, #f8fafc));
`;

const Subtitle = styled.p`
  margin: 0;
  font-size: 12px;
  color: var(--color-text-secondary, #94a3b8);
  word-break: break-all;
`;

const Badge = styled.span<{ $tone?: "cyan" | "emerald" | "amber" | "rose" | "violet" | "muted" }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  padding: 2px 8px;
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
              : $tone === "muted"
                ? "rgba(148, 163, 184, 0.3)"
                : "rgba(14, 165, 233, 0.45)"};
  background: ${({ $tone }) =>
    $tone === "rose"
      ? "rgba(244, 63, 94, 0.14)"
      : $tone === "emerald"
        ? "rgba(16, 185, 129, 0.14)"
        : $tone === "amber"
          ? "rgba(245, 158, 11, 0.14)"
          : $tone === "violet"
            ? "rgba(139, 92, 246, 0.14)"
            : $tone === "muted"
              ? "rgba(148, 163, 184, 0.1)"
              : "rgba(14, 165, 233, 0.14)"};
  color: ${({ $tone }) =>
    $tone === "rose"
      ? "#fb7185"
      : $tone === "emerald"
        ? "#34d399"
        : $tone === "amber"
          ? "#fbbf24"
          : $tone === "violet"
            ? "#c4b5fd"
            : $tone === "muted"
              ? "var(--color-text-secondary, #94a3b8)"
              : "#38bdf8"};
`;

const ControlsBar = styled.form`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--color-border, rgba(148, 163, 184, 0.14));
  background: var(--color-bg-primary, transparent);
`;

const TextInput = styled.input`
  flex: 1;
  min-width: 180px;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--color-border-default, rgba(148, 163, 184, 0.3));
  background: var(--color-search-bg, rgba(15, 23, 42, 0.4));
  color: var(--color-text-primary, #e6edf3);
  font-size: 12px;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  outline: none;
  &:focus {
    border-color: var(--color-primary, #38bdf8);
  }
`;

const ActionBtn = styled.button<{ $variant?: "primary" | "danger" | "secondary" }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  border: 1px solid
    ${({ $variant }) =>
      $variant === "danger"
        ? "rgba(244, 63, 94, 0.55)"
        : $variant === "primary"
          ? "rgba(14, 165, 233, 0.6)"
          : "var(--color-border-default, rgba(148, 163, 184, 0.3))"};
  background: ${({ $variant }) =>
    $variant === "danger"
      ? "linear-gradient(135deg, #e11d48, #be123c)"
      : $variant === "primary"
        ? "linear-gradient(135deg, #0284c7, #4f46e5)"
        : "var(--color-btn-secondary-bg, rgba(30, 41, 59, 0.7))"};
  color: ${({ $variant }) => ($variant === "secondary" ? "var(--color-text-primary, #e6edf3)" : "#ffffff")};
  transition:
    opacity 0.15s ease,
    transform 0.1s ease;
  &:hover:not(:disabled) {
    opacity: 0.92;
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const MetricsStrip = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--color-border, rgba(148, 163, 184, 0.14));
`;

const MetricTile = styled.div`
  border: 1px solid var(--color-border, rgba(148, 163, 184, 0.16));
  border-radius: 10px;
  padding: 8px 10px;
  background: var(--color-bg-secondary, rgba(15, 23, 42, 0.35));
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const MetricLabel = styled.span`
  font-size: 11px;
  color: var(--color-text-secondary, #94a3b8);
`;

const MetricValue = styled.span<{ $accent?: string }>`
  font-size: 18px;
  font-weight: 700;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  color: ${({ $accent }) => $accent || "var(--color-text-heading, var(--color-text-primary, #f8fafc))"};
`;

const SvgViewport = styled.div`
  width: 100%;
  overflow-x: auto;
  padding: 14px 16px;
  background:
    radial-gradient(circle at 20% 20%, rgba(14, 165, 233, 0.06), transparent 45%),
    radial-gradient(circle at 80% 80%, rgba(99, 102, 241, 0.06), transparent 45%), var(--color-bg-primary, #0b1120);
`;

const InspectorPanel = styled.div`
  padding: 12px 18px;
  border-top: 1px solid var(--color-border, rgba(148, 163, 184, 0.16));
  background: var(--color-bg-secondary, rgba(15, 23, 42, 0.5));
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
`;

const QuarantineFooter = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 18px;
  border-top: 1px solid var(--color-border, rgba(148, 163, 184, 0.18));
  background: var(--color-bg-elevated, rgba(15, 23, 42, 0.72));
`;

const StatusBanner = styled.div<{ $kind: "error" | "success" | "info" }>`
  margin: 10px 18px 0;
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid
    ${({ $kind }) =>
      $kind === "error"
        ? "rgba(244, 63, 94, 0.45)"
        : $kind === "success"
          ? "rgba(16, 185, 129, 0.45)"
          : "rgba(14, 165, 233, 0.4)"};
  background: ${({ $kind }) =>
    $kind === "error"
      ? "rgba(244, 63, 94, 0.12)"
      : $kind === "success"
        ? "rgba(16, 185, 129, 0.12)"
        : "rgba(14, 165, 233, 0.1)"};
  color: ${({ $kind }) => ($kind === "error" ? "#fda4af" : $kind === "success" ? "#6ee7b7" : "#7dd3fc")};
`;

const NODE_COLORS: Record<
  DagNode["tone"],
  { fill: string; stroke: string; text: string; sub: string; badgeBg: string; badgeText: string }
> = {
  cyan: {
    fill: "rgba(14, 165, 233, 0.16)",
    stroke: "#38bdf8",
    text: "#e0f2fe",
    sub: "#7dd3fc",
    badgeBg: "rgba(56, 189, 248, 0.22)",
    badgeText: "#38bdf8",
  },
  rose: {
    fill: "rgba(244, 63, 94, 0.16)",
    stroke: "#fb7185",
    text: "#ffe4e6",
    sub: "#fda4af",
    badgeBg: "rgba(244, 63, 94, 0.25)",
    badgeText: "#fb7185",
  },
  amber: {
    fill: "rgba(245, 158, 11, 0.16)",
    stroke: "#fbbf24",
    text: "#fef3c7",
    sub: "#fcd34d",
    badgeBg: "rgba(245, 158, 11, 0.25)",
    badgeText: "#fbbf24",
  },
  violet: {
    fill: "rgba(139, 92, 246, 0.16)",
    stroke: "#a78bfa",
    text: "#ede9fe",
    sub: "#c4b5fd",
    badgeBg: "rgba(139, 92, 246, 0.25)",
    badgeText: "#c4b5fd",
  },
  blue: {
    fill: "rgba(59, 130, 246, 0.16)",
    stroke: "#60a5fa",
    text: "#dbeafe",
    sub: "#93c5fd",
    badgeBg: "rgba(59, 130, 246, 0.25)",
    badgeText: "#60a5fa",
  },
  emerald: {
    fill: "rgba(16, 185, 129, 0.16)",
    stroke: "#34d399",
    text: "#d1fae5",
    sub: "#6ee7b7",
    badgeBg: "rgba(16, 185, 129, 0.25)",
    badgeText: "#34d399",
  },
  muted: {
    fill: "rgba(148, 163, 184, 0.08)",
    stroke: "rgba(148, 163, 184, 0.35)",
    text: "#94a3b8",
    sub: "#64748b",
    badgeBg: "rgba(148, 163, 184, 0.16)",
    badgeText: "#94a3b8",
  },
};

const EDGE_STROKES: Record<DagEdge["tone"], string> = {
  cyan: "#38bdf8",
  rose: "#fb7185",
  amber: "#fbbf24",
  blue: "#60a5fa",
  emerald: "#34d399",
  muted: "rgba(148, 163, 184, 0.4)",
};

const COLUMN_META: { key: NodeColumn; label: string; x: number }[] = [
  { key: "example", label: "1. Example Node", x: 16 },
  { key: "patch", label: "2. Overlay Patches", x: 210 },
  { key: "shard", label: "3. Compiled m_init Shards", x: 404 },
  { key: "recipe", label: "4. Training Recipes", x: 598 },
  { key: "chunk", label: "5. DiskANN Memory Chunks", x: 792 },
];

const NODE_W = 172;
const NODE_H = 54;
const ROW_GAP = 14;
const TOP_PAD = 48;
const MAX_PER_COLUMN = 5;

function truncateMiddle(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const half = Math.floor((maxLen - 1) / 2);
  return `${text.slice(0, half)}…${text.slice(text.length - half)}`;
}

function truncateEnd(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

function buildLineageDag(lineage: LineageResponse): {
  nodes: DagNode[];
  edges: DagEdge[];
  svgHeight: number;
} {
  const nodes: DagNode[] = [];
  const edges: DagEdge[] = [];

  const patches = lineage.overlayPatches;
  const shards = lineage.compiledShards;
  const recipes = lineage.blastRadius.affectedRecipes;
  const chunks = lineage.memoryChunks;

  const displayedPatches = patches.slice(0, MAX_PER_COLUMN);
  const displayedShards = shards.slice(0, MAX_PER_COLUMN);
  const displayedRecipes = recipes.slice(0, MAX_PER_COLUMN);
  const displayedChunks = chunks.slice(0, MAX_PER_COLUMN);

  const patchSlotCount = Math.max(1, displayedPatches.length + (patches.length > MAX_PER_COLUMN ? 1 : 0));
  const shardSlotCount = Math.max(1, displayedShards.length + (shards.length > MAX_PER_COLUMN ? 1 : 0));
  const recipeSlotCount = Math.max(1, displayedRecipes.length + (recipes.length > MAX_PER_COLUMN ? 1 : 0));
  const chunkSlotCount = Math.max(1, displayedChunks.length + (chunks.length > MAX_PER_COLUMN ? 1 : 0));

  const maxSlots = Math.max(1, patchSlotCount, shardSlotCount, recipeSlotCount, chunkSlotCount);
  const contentHeight = maxSlots * NODE_H + Math.max(0, maxSlots - 1) * ROW_GAP;
  const svgHeight = TOP_PAD + contentHeight + 28;

  const centerOffset = (count: number): number => {
    const colHeight = count * NODE_H + Math.max(0, count - 1) * ROW_GAP;
    return TOP_PAD + Math.max(0, (contentHeight - colHeight) / 2);
  };

  // Column 1: Example Node
  const exampleNodeId = "example:root";
  nodes.push({
    id: exampleNodeId,
    column: "example",
    x: COLUMN_META[0]!.x,
    y: centerOffset(1),
    width: NODE_W,
    height: NODE_H,
    title: truncateMiddle(lineage.exampleId, 20),
    subtitle: lineage.blastRadius.quarantined ? "QUARANTINED" : "Active Source Example",
    badge: `${lineage.blastRadius.totalImpactedArtifacts} hit${lineage.blastRadius.totalImpactedArtifacts === 1 ? "" : "s"}`,
    tone: lineage.blastRadius.quarantined ? "rose" : "cyan",
    payload: { exampleId: lineage.exampleId },
  });

  // Column 2: Immutable Overlay Patches
  const patchNodeIds: { id: string; recipeName: string; tone: DagEdge["tone"] }[] = [];
  const patchStartY = centerOffset(patchSlotCount);
  if (displayedPatches.length === 0) {
    const emptyId = "patch:empty";
    nodes.push({
      id: emptyId,
      column: "patch",
      x: COLUMN_META[1]!.x,
      y: patchStartY,
      width: NODE_W,
      height: NODE_H,
      title: "No Overlay Patches",
      subtitle: "Clean immutable baseline",
      tone: "muted",
      isEmpty: true,
    });
    edges.push({ id: `e:${exampleNodeId}->${emptyId}`, from: exampleNodeId, to: emptyId, dashed: true, tone: "muted" });
  } else {
    displayedPatches.forEach((patch, idx) => {
      const nid = `patch:${patch.id}`;
      const tone: DagNode["tone"] =
        patch.action === "quarantine" ? "rose" : patch.action === "patch_source" ? "amber" : "violet";
      nodes.push({
        id: nid,
        column: "patch",
        x: COLUMN_META[1]!.x,
        y: patchStartY + idx * (NODE_H + ROW_GAP),
        width: NODE_W,
        height: NODE_H,
        title: `#${patch.id} ${patch.action}`,
        subtitle: truncateEnd(patch.reason || patch.recipeName, 22),
        badge: truncateEnd(patch.recipeName, 12),
        tone,
        payload: patch,
      });
      const edgeTone: DagEdge["tone"] = patch.action === "quarantine" ? "rose" : "amber";
      patchNodeIds.push({ id: nid, recipeName: patch.recipeName, tone: edgeTone });
      edges.push({ id: `e:${exampleNodeId}->${nid}`, from: exampleNodeId, to: nid, tone: edgeTone });
    });
    if (patches.length > MAX_PER_COLUMN) {
      const moreId = "patch:more";
      nodes.push({
        id: moreId,
        column: "patch",
        x: COLUMN_META[1]!.x,
        y: patchStartY + displayedPatches.length * (NODE_H + ROW_GAP),
        width: NODE_W,
        height: NODE_H,
        title: `+${patches.length - MAX_PER_COLUMN} more patches`,
        subtitle: "Truncated for readability",
        tone: "muted",
        isOverflow: true,
      });
      edges.push({ id: `e:${exampleNodeId}->${moreId}`, from: exampleNodeId, to: moreId, dashed: true, tone: "muted" });
    }
  }

  // Column 3: Compiled m_init Shards
  const shardNodeIds: { id: string; recipeName: string }[] = [];
  const shardStartY = centerOffset(shardSlotCount);
  if (displayedShards.length === 0) {
    const emptyId = "shard:empty";
    nodes.push({
      id: emptyId,
      column: "shard",
      x: COLUMN_META[2]!.x,
      y: shardStartY,
      width: NODE_W,
      height: NODE_H,
      title: "No Compiled Shards",
      subtitle: "Not yet materialized",
      tone: "muted",
      isEmpty: true,
    });
    const srcId = patchNodeIds[0]?.id ?? "patch:empty";
    edges.push({ id: `e:${srcId}->${emptyId}`, from: srcId, to: emptyId, dashed: true, tone: "muted" });
  } else {
    displayedShards.forEach((shard, idx) => {
      const nid = `shard:${shard.shardId}`;
      nodes.push({
        id: nid,
        column: "shard",
        x: COLUMN_META[2]!.x,
        y: shardStartY + idx * (NODE_H + ROW_GAP),
        width: NODE_W,
        height: NODE_H,
        title: `${shard.shardId.slice(0, 12)}…`,
        subtitle: `${shard.dialect} · m:[${shard.mMin}..${shard.mMax}] · ${shard.exampleCount}ex`,
        badge: shard.datasetKind.replace("dataset-", ""),
        tone: "blue",
        payload: shard,
      });
      shardNodeIds.push({ id: nid, recipeName: shard.recipeName });

      const matchingPatches = patchNodeIds.filter((p) => p.recipeName === shard.recipeName);
      if (matchingPatches.length > 0) {
        for (const mp of matchingPatches) {
          edges.push({ id: `e:${mp.id}->${nid}`, from: mp.id, to: nid, tone: mp.tone });
        }
      } else {
        const fallbackFrom = patchNodeIds.length > 0 ? patchNodeIds[0]!.id : "patch:empty";
        edges.push({
          id: `e:${fallbackFrom}->${nid}`,
          from: fallbackFrom,
          to: nid,
          dashed: patchNodeIds.length === 0,
          tone: "blue",
        });
      }
    });
    if (shards.length > MAX_PER_COLUMN) {
      const moreId = "shard:more";
      nodes.push({
        id: moreId,
        column: "shard",
        x: COLUMN_META[2]!.x,
        y: shardStartY + displayedShards.length * (NODE_H + ROW_GAP),
        width: NODE_W,
        height: NODE_H,
        title: `+${shards.length - MAX_PER_COLUMN} more shards`,
        subtitle: "Additional compiled buckets",
        tone: "muted",
        isOverflow: true,
      });
      const srcId = patchNodeIds[0]?.id ?? "patch:empty";
      edges.push({ id: `e:${srcId}->${moreId}`, from: srcId, to: moreId, dashed: true, tone: "muted" });
    }
  }

  // Column 4: Training Recipes
  const recipeNodeIds: { id: string; recipeName: string }[] = [];
  const recipeStartY = centerOffset(recipeSlotCount);
  if (displayedRecipes.length === 0) {
    const emptyId = "recipe:empty";
    nodes.push({
      id: emptyId,
      column: "recipe",
      x: COLUMN_META[3]!.x,
      y: recipeStartY,
      width: NODE_W,
      height: NODE_H,
      title: "No Impacted Recipes",
      subtitle: "Zero downstream recipes",
      tone: "muted",
      isEmpty: true,
    });
    const srcId = shardNodeIds[0]?.id ?? "shard:empty";
    edges.push({ id: `e:${srcId}->${emptyId}`, from: srcId, to: emptyId, dashed: true, tone: "muted" });
  } else {
    displayedRecipes.forEach((recipeName, idx) => {
      const nid = `recipe:${recipeName}`;
      const shardCountForRecipe = shards.filter((s) => s.recipeName === recipeName).length;
      const patchCountForRecipe = patches.filter((p) => p.recipeName === recipeName).length;
      nodes.push({
        id: nid,
        column: "recipe",
        x: COLUMN_META[3]!.x,
        y: recipeStartY + idx * (NODE_H + ROW_GAP),
        width: NODE_W,
        height: NODE_H,
        title: truncateEnd(recipeName, 20),
        subtitle: `${shardCountForRecipe} shard${shardCountForRecipe === 1 ? "" : "s"} · ${patchCountForRecipe} patch${patchCountForRecipe === 1 ? "" : "es"}`,
        badge: "recipe",
        tone: "emerald",
        payload: { recipeName },
      });
      recipeNodeIds.push({ id: nid, recipeName });

      const linkedShards = shardNodeIds.filter((s) => s.recipeName === recipeName);
      if (linkedShards.length > 0) {
        for (const ls of linkedShards) {
          edges.push({ id: `e:${ls.id}->${nid}`, from: ls.id, to: nid, tone: "emerald" });
        }
      } else {
        const fallbackFrom = shardNodeIds[0]?.id ?? "shard:empty";
        edges.push({ id: `e:${fallbackFrom}->${nid}`, from: fallbackFrom, to: nid, dashed: true, tone: "emerald" });
      }
    });
    if (recipes.length > MAX_PER_COLUMN) {
      const moreId = "recipe:more";
      nodes.push({
        id: moreId,
        column: "recipe",
        x: COLUMN_META[3]!.x,
        y: recipeStartY + displayedRecipes.length * (NODE_H + ROW_GAP),
        width: NODE_W,
        height: NODE_H,
        title: `+${recipes.length - MAX_PER_COLUMN} more recipes`,
        subtitle: "Additional recipes impacted",
        tone: "muted",
        isOverflow: true,
      });
      const srcId = shardNodeIds[0]?.id ?? "shard:empty";
      edges.push({ id: `e:${srcId}->${moreId}`, from: srcId, to: moreId, dashed: true, tone: "muted" });
    }
  }

  // Column 5: DiskANN Memory Chunks
  const chunkStartY = centerOffset(chunkSlotCount);
  if (displayedChunks.length === 0) {
    const emptyId = "chunk:empty";
    nodes.push({
      id: emptyId,
      column: "chunk",
      x: COLUMN_META[4]!.x,
      y: chunkStartY,
      width: NODE_W,
      height: NODE_H,
      title: "No DiskANN Chunks",
      subtitle: "Not indexed in vector store",
      tone: "muted",
      isEmpty: true,
    });
    const srcId = recipeNodeIds[0]?.id ?? "recipe:empty";
    edges.push({ id: `e:${srcId}->${emptyId}`, from: srcId, to: emptyId, dashed: true, tone: "muted" });
  } else {
    displayedChunks.forEach((chunk, idx) => {
      const nid = `chunk:${chunk.chunkId}`;
      nodes.push({
        id: nid,
        column: "chunk",
        x: COLUMN_META[4]!.x,
        y: chunkStartY + idx * (NODE_H + ROW_GAP),
        width: NODE_W,
        height: NODE_H,
        title: truncateMiddle(chunk.chunkId, 18),
        subtitle: truncateEnd(`${chunk.dialect} · ${chunk.sourceUri}`, 22),
        badge: chunk.formalVerified ? "verified" : chunk.sourceKind,
        tone: chunk.formalVerified ? "cyan" : "violet",
        payload: chunk,
      });
      const sourceRecipes = recipeNodeIds.length > 0 ? recipeNodeIds : [{ id: "recipe:empty", recipeName: "" }];
      for (const r of sourceRecipes) {
        edges.push({
          id: `e:${r.id}->${nid}`,
          from: r.id,
          to: nid,
          dashed: recipeNodeIds.length === 0,
          tone: "cyan",
        });
      }
    });
    if (chunks.length > MAX_PER_COLUMN) {
      const moreId = "chunk:more";
      nodes.push({
        id: moreId,
        column: "chunk",
        x: COLUMN_META[4]!.x,
        y: chunkStartY + displayedChunks.length * (NODE_H + ROW_GAP),
        width: NODE_W,
        height: NODE_H,
        title: `+${chunks.length - MAX_PER_COLUMN} more chunks`,
        subtitle: "Additional DiskANN vectors",
        tone: "muted",
        isOverflow: true,
      });
      const srcId = recipeNodeIds[0]?.id ?? "recipe:empty";
      edges.push({ id: `e:${srcId}->${moreId}`, from: srcId, to: moreId, dashed: true, tone: "muted" });
    }
  }

  return { nodes, edges, svgHeight };
}

export const DataLineageGraphCard: React.FC<DataLineageGraphCardProps> = ({
  exampleId: initialExampleId = "",
  recipeName: recipeNameProp,
  onQuarantined,
  onClose,
  hideSearchInput = false,
}) => {
  const { token } = useAuth();
  const [inputId, setInputId] = useState(initialExampleId);
  const [activeExampleId, setActiveExampleId] = useState(initialExampleId);
  const [lineage, setLineage] = useState<LineageResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>("example:root");
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // Quarantine form state
  const [quarantineRecipe, setQuarantineRecipe] = useState(recipeNameProp ?? "");
  const [quarantineReason, setQuarantineReason] = useState("Quarantined via Blast-Radius Lineage Inspector");
  const [quarantining, setQuarantining] = useState(false);
  const [actionBanner, setActionBanner] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    setInputId(initialExampleId);
    setActiveExampleId(initialExampleId);
    setSelectedNodeId("example:root");
    setActionBanner(null);
  }, [initialExampleId]);

  useEffect(() => {
    if (recipeNameProp) {
      setQuarantineRecipe(recipeNameProp);
    }
  }, [recipeNameProp]);

  const fetchLineage = useCallback(
    async (targetId: string) => {
      const trimmed = targetId.trim();
      if (!trimmed) {
        setLineage(null);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(`/api/v1/recipes/lineage/${encodeURIComponent(trimmed)}`, {
          credentials: "include",
          headers,
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || `Failed to fetch lineage (${res.status})`);
        }
        const typed = data as LineageResponse;
        setLineage(typed);
        setSelectedNodeId("example:root");
        setQuarantineRecipe((prev) => {
          if (prev.trim()) return prev;
          return (
            recipeNameProp ||
            typed.blastRadius.affectedRecipes[0] ||
            typed.compiledShards[0]?.recipeName ||
            "global-triage"
          );
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setLineage(null);
      } finally {
        setLoading(false);
      }
    },
    [token, recipeNameProp],
  );

  useEffect(() => {
    if (activeExampleId.trim()) {
      void fetchLineage(activeExampleId);
    }
  }, [activeExampleId, fetchLineage]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputId.trim();
    if (!trimmed) return;
    setActionBanner(null);
    if (trimmed === activeExampleId) {
      void fetchLineage(trimmed);
    } else {
      setActiveExampleId(trimmed);
    }
  };

  const handleQuarantine = async () => {
    const targetId = (lineage?.exampleId ?? activeExampleId).trim();
    if (!targetId) return;
    const effectiveRecipe =
      quarantineRecipe.trim() ||
      recipeNameProp ||
      lineage?.blastRadius.affectedRecipes[0] ||
      lineage?.compiledShards[0]?.recipeName ||
      "global-triage";

    setQuarantining(true);
    setActionBanner(null);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/v1/recipes/patches", {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({
          recipeName: effectiveRecipe,
          exampleId: targetId,
          action: "quarantine",
          reason: quarantineReason.trim() || "Quarantined via Blast-Radius Lineage Inspector",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.error ||
            (res.status === 401 ? "Sign in required to persist quarantine patches." : "Failed to quarantine example."),
        );
      }
      setActionBanner({
        kind: "success",
        message: `Immutable quarantine patch #${data.patch?.id ?? ""} recorded for '${targetId}' in recipe '${effectiveRecipe}'.`,
      });
      await fetchLineage(targetId);
      onQuarantined?.(targetId);
    } catch (err) {
      setActionBanner({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setQuarantining(false);
    }
  };

  const dag = useMemo(() => (lineage ? buildLineageDag(lineage) : null), [lineage]);

  const nodeMap = useMemo(() => {
    const map = new Map<string, DagNode>();
    if (dag) {
      for (const n of dag.nodes) map.set(n.id, n);
    }
    return map;
  }, [dag]);

  const activeFocusId = hoveredNodeId ?? selectedNodeId;
  const connectedNodeIds = useMemo(() => {
    const set = new Set<string>();
    if (!dag || !activeFocusId) return set;
    set.add(activeFocusId);
    for (const edge of dag.edges) {
      if (edge.from === activeFocusId) set.add(edge.to);
      if (edge.to === activeFocusId) set.add(edge.from);
    }
    return set;
  }, [dag, activeFocusId]);

  const selectedNode = selectedNodeId ? (nodeMap.get(selectedNodeId) ?? null) : null;

  return (
    <CardRoot>
      <CardHeader>
        <TitleBlock>
          <TitleRow>
            <DatabaseIcon size={16} />
            <Heading>Blast-Radius &amp; Lineage DAG</Heading>
            {lineage && (
              <>
                <Badge $tone={lineage.blastRadius.totalImpactedArtifacts > 0 ? "amber" : "emerald"}>
                  Blast Radius: {lineage.blastRadius.totalImpactedArtifacts}
                </Badge>
                {lineage.blastRadius.quarantined ? (
                  <Badge $tone="rose">Quarantined</Badge>
                ) : (
                  <Badge $tone="emerald">Active</Badge>
                )}
              </>
            )}
          </TitleRow>
          <Subtitle>
            {activeExampleId
              ? `Tracing downstream impact for '${activeExampleId}' across overlay patches, compiled m_init shards, recipes, and DiskANN chunks.`
              : "Enter an exampleId, URI substring, or shard/recipe identifier to inspect its downstream blast radius."}
          </Subtitle>
        </TitleBlock>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {activeExampleId && (
            <ActionBtn
              type="button"
              $variant="secondary"
              disabled={loading}
              onClick={() => void fetchLineage(activeExampleId)}
              title="Refresh blast radius"
            >
              <SyncIcon size={13} />
              Refresh
            </ActionBtn>
          )}
          {onClose && (
            <ActionBtn type="button" $variant="secondary" onClick={onClose} aria-label="Close blast radius drawer">
              <XIcon size={14} />
            </ActionBtn>
          )}
        </div>
      </CardHeader>

      {!hideSearchInput && (
        <ControlsBar onSubmit={handleSearchSubmit}>
          <TextInput
            type="text"
            value={inputId}
            onChange={(e) => setInputId(e.target.value)}
            placeholder="example_id or URI substring (e.g. rhg_9a2f... or ThermalMotor.mo)"
            aria-label="Example ID or URI to trace"
          />
          <ActionBtn type="submit" $variant="primary" disabled={loading || !inputId.trim()}>
            <SearchIcon size={13} />
            {loading ? "Tracing…" : "Trace Lineage"}
          </ActionBtn>
        </ControlsBar>
      )}

      {error && (
        <StatusBanner $kind="error">
          <AlertIcon size={14} />
          <span>{error}</span>
        </StatusBanner>
      )}

      {actionBanner && (
        <StatusBanner $kind={actionBanner.kind}>
          {actionBanner.kind === "success" ? <CheckCircleIcon size={14} /> : <AlertIcon size={14} />}
          <span>{actionBanner.message}</span>
        </StatusBanner>
      )}

      {lineage && (
        <MetricsStrip>
          <MetricTile>
            <MetricLabel>Total Blast Radius</MetricLabel>
            <MetricValue $accent={lineage.blastRadius.totalImpactedArtifacts > 0 ? "#fbbf24" : "#34d399"}>
              {lineage.blastRadius.totalImpactedArtifacts}
            </MetricValue>
          </MetricTile>
          <MetricTile>
            <MetricLabel>Overlay Patches</MetricLabel>
            <MetricValue $accent="#fb7185">{lineage.blastRadius.overlayPatchCount}</MetricValue>
          </MetricTile>
          <MetricTile>
            <MetricLabel>Compiled Shards</MetricLabel>
            <MetricValue $accent="#60a5fa">{lineage.blastRadius.impactedShardCount}</MetricValue>
          </MetricTile>
          <MetricTile>
            <MetricLabel>Training Recipes</MetricLabel>
            <MetricValue $accent="#34d399">{lineage.blastRadius.impactedRecipeCount}</MetricValue>
          </MetricTile>
          <MetricTile>
            <MetricLabel>DiskANN Chunks</MetricLabel>
            <MetricValue $accent="#38bdf8">{lineage.blastRadius.impactedMemoryChunkCount}</MetricValue>
          </MetricTile>
        </MetricsStrip>
      )}

      {loading && !lineage ? (
        <div
          style={{
            padding: "36px 18px",
            textAlign: "center",
            fontSize: 13,
            color: "var(--color-text-secondary, #94a3b8)",
          }}
        >
          Computing downstream blast radius across overlay patches, compiled shards, and DiskANN memory…
        </div>
      ) : dag && lineage ? (
        <>
          <SvgViewport>
            <svg
              viewBox={`0 0 980 ${dag.svgHeight}`}
              width="100%"
              height={dag.svgHeight}
              style={{ minWidth: 820, display: "block" }}
              role="img"
              aria-label={`Blast radius and lineage DAG for ${lineage.exampleId}`}
            >
              <defs>
                {(["cyan", "rose", "amber", "blue", "emerald", "muted"] as const).map((tone) => (
                  <marker
                    key={tone}
                    id={`lineage-arrow-${tone}`}
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1 L 10 5 L 0 9 z" fill={EDGE_STROKES[tone]} />
                  </marker>
                ))}
              </defs>

              {/* Column Headers & Subtle Guides */}
              {COLUMN_META.map((col) => (
                <g key={col.key}>
                  <rect
                    x={col.x}
                    y={10}
                    width={NODE_W}
                    height={24}
                    rx={6}
                    fill="rgba(148, 163, 184, 0.08)"
                    stroke="rgba(148, 163, 184, 0.2)"
                    strokeWidth={1}
                  />
                  <text
                    x={col.x + NODE_W / 2}
                    y={26}
                    textAnchor="middle"
                    fontSize={10.5}
                    fontWeight={700}
                    fill="#94a3b8"
                    style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
                  >
                    {col.label}
                  </text>
                </g>
              ))}

              {/* Cubic Bezier Flow Edges */}
              {dag.edges.map((edge) => {
                const src = nodeMap.get(edge.from);
                const dst = nodeMap.get(edge.to);
                if (!src || !dst) return null;
                const x1 = src.x + src.width;
                const y1 = src.y + src.height / 2;
                const x2 = dst.x;
                const y2 = dst.y + dst.height / 2;
                const dx = Math.max(24, (x2 - x1) * 0.52);
                const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2 - 4} ${y2}`;
                const isHighlighted = !activeFocusId || edge.from === activeFocusId || edge.to === activeFocusId;
                return (
                  <path
                    key={edge.id}
                    d={d}
                    fill="none"
                    stroke={EDGE_STROKES[edge.tone]}
                    strokeWidth={isHighlighted ? 2 : 1.25}
                    strokeDasharray={edge.dashed ? "4 4" : undefined}
                    strokeOpacity={isHighlighted ? 0.9 : 0.22}
                    markerEnd={`url(#lineage-arrow-${edge.tone})`}
                    style={{ transition: "stroke-opacity 0.15s ease, stroke-width 0.15s ease" }}
                  />
                );
              })}

              {/* Interactive DAG Nodes */}
              {dag.nodes.map((node) => {
                const palette = NODE_COLORS[node.tone];
                const isSelected = selectedNodeId === node.id;
                const isConnected = !activeFocusId || connectedNodeIds.has(node.id);
                return (
                  <g
                    key={node.id}
                    transform={`translate(${node.x}, ${node.y})`}
                    onClick={() => setSelectedNodeId(node.id)}
                    onMouseEnter={() => setHoveredNodeId(node.id)}
                    onMouseLeave={() => setHoveredNodeId(null)}
                    style={{
                      cursor: "pointer",
                      opacity: isConnected ? 1 : 0.42,
                      transition: "opacity 0.15s ease",
                    }}
                  >
                    <rect
                      width={node.width}
                      height={node.height}
                      rx={10}
                      fill={palette.fill}
                      stroke={palette.stroke}
                      strokeWidth={isSelected ? 2.4 : 1.3}
                      strokeDasharray={node.isEmpty ? "4 3" : undefined}
                    />
                    <text
                      x={10}
                      y={21}
                      fontSize={11.5}
                      fontWeight={700}
                      fill={palette.text}
                      style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
                    >
                      {node.title}
                    </text>
                    <text
                      x={10}
                      y={39}
                      fontSize={10}
                      fill={palette.sub}
                      style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
                    >
                      {node.subtitle}
                    </text>
                    {node.badge && (
                      <g transform={`translate(${node.width - 58}, 6)`}>
                        <rect width={52} height={15} rx={7} fill={palette.badgeBg} />
                        <text
                          x={26}
                          y={10.5}
                          textAnchor="middle"
                          fontSize={8.5}
                          fontWeight={700}
                          fill={palette.badgeText}
                          style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
                        >
                          {truncateEnd(node.badge, 9)}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
          </SvgViewport>

          {/* Selected Node Detail Strip */}
          {selectedNode && !selectedNode.isEmpty && !selectedNode.isOverflow && (
            <InspectorPanel>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
                {selectedNode.column === "example" && (
                  <>
                    <div style={{ fontWeight: 700 }}>
                      Example Node: <code>{lineage.exampleId}</code>
                    </div>
                    <div style={{ color: "var(--color-text-secondary, #94a3b8)" }}>
                      Affected recipes:{" "}
                      {lineage.blastRadius.affectedRecipes.length > 0
                        ? lineage.blastRadius.affectedRecipes.join(", ")
                        : "none"}
                    </div>
                  </>
                )}

                {selectedNode.column === "patch" && selectedNode.payload && "action" in selectedNode.payload && (
                  <>
                    <div style={{ fontWeight: 700 }}>
                      Overlay Patch #{selectedNode.payload.id} · <code>{selectedNode.payload.action}</code> (
                      {selectedNode.payload.recipeName})
                    </div>
                    <div style={{ color: "var(--color-text-secondary, #94a3b8)" }}>
                      Reason: {selectedNode.payload.reason || "—"} · Recorded{" "}
                      {new Date(selectedNode.payload.createdAt).toLocaleString()}
                    </div>
                  </>
                )}

                {selectedNode.column === "shard" && selectedNode.payload && "shardId" in selectedNode.payload && (
                  <>
                    <div style={{ fontWeight: 700 }}>
                      Compiled Shard <code>{selectedNode.payload.shardId}</code> ({selectedNode.payload.recipeName}@
                      {selectedNode.payload.recipeVersion})
                    </div>
                    <div style={{ color: "var(--color-text-secondary, #94a3b8)" }}>
                      Dialect: {selectedNode.payload.dialect} · m_init: [{selectedNode.payload.mMin},{" "}
                      {selectedNode.payload.mMax}] · {selectedNode.payload.exampleCount} examples · matched via:{" "}
                      {selectedNode.payload.matchReasons.join(", ")}
                    </div>
                  </>
                )}

                {selectedNode.column === "recipe" &&
                  selectedNode.payload &&
                  "recipeName" in selectedNode.payload &&
                  !("shardId" in selectedNode.payload) &&
                  !("action" in selectedNode.payload) && (
                    <>
                      <div style={{ fontWeight: 700 }}>
                        Training Recipe: <code>{selectedNode.payload.recipeName}</code>
                      </div>
                      <div style={{ color: "var(--color-text-secondary, #94a3b8)" }}>
                        Downstream recipe linked via compiled shards or immutable overlay patches for this example.
                      </div>
                    </>
                  )}

                {selectedNode.column === "chunk" && selectedNode.payload && "chunkId" in selectedNode.payload && (
                  <>
                    <div style={{ fontWeight: 700 }}>
                      DiskANN Memory Chunk <code>{selectedNode.payload.chunkId}</code> (
                      {selectedNode.payload.sourceKind})
                    </div>
                    <div style={{ color: "var(--color-text-secondary, #94a3b8)" }}>
                      URI: <code>{selectedNode.payload.sourceUri}</code> ·{" "}
                      {selectedNode.payload.formalVerified ? "Formally Verified" : "Unverified"} ·{" "}
                      {selectedNode.payload.symbolTags.length > 0
                        ? `Symbols: ${selectedNode.payload.symbolTags.slice(0, 6).join(", ")}`
                        : "No symbol tags"}
                    </div>
                  </>
                )}
              </div>

              {selectedNode.column === "shard" && selectedNode.payload && "shardId" in selectedNode.payload && (
                <Link
                  to={`/datasets/${encodeURIComponent(selectedNode.payload.shardId)}/browse`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    textDecoration: "none",
                    background: "rgba(56, 189, 248, 0.16)",
                    border: "1px solid rgba(56, 189, 248, 0.45)",
                    color: "#38bdf8",
                  }}
                >
                  Browse Shard
                  <LinkExternalIcon size={12} />
                </Link>
              )}
            </InspectorPanel>
          )}
        </>
      ) : (
        <div
          style={{
            padding: "30px 18px",
            textAlign: "center",
            fontSize: 13,
            color: "var(--color-text-secondary, #94a3b8)",
          }}
        >
          No lineage loaded yet. Enter an <code>example_id</code> above to visualize its full blast radius.
        </div>
      )}

      {/* 1-Click Quarantine Footer */}
      {activeExampleId.trim() && (
        <QuarantineFooter>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, flex: 1, minWidth: 240 }}>
            <TextInput
              type="text"
              value={quarantineRecipe}
              onChange={(e) => setQuarantineRecipe(e.target.value)}
              placeholder="Recipe name (e.g. modelica-core-v1)"
              aria-label="Target recipe name for quarantine patch"
              style={{ maxWidth: 210, minWidth: 140 }}
            />
            <TextInput
              type="text"
              value={quarantineReason}
              onChange={(e) => setQuarantineReason(e.target.value)}
              placeholder="Quarantine reason…"
              aria-label="Quarantine reason"
              style={{ minWidth: 200 }}
            />
          </div>
          <ActionBtn
            type="button"
            $variant="danger"
            disabled={quarantining || loading}
            onClick={() => void handleQuarantine()}
          >
            <ShieldIcon size={13} />
            {quarantining
              ? "Quarantining…"
              : lineage?.blastRadius.quarantined
                ? "Record Additional Quarantine Patch"
                : "Quarantine Example"}
          </ActionBtn>
        </QuarantineFooter>
      )}
    </CardRoot>
  );
};

export default DataLineageGraphCard;
