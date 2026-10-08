// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArrowRightIcon,
  BeakerIcon,
  CheckCircleFillIcon,
  ClockIcon,
  CpuIcon,
  DatabaseIcon,
  FilterIcon,
  FlameIcon,
  GraphIcon,
  LinkIcon,
  PlayIcon,
  PulseIcon,
  RocketIcon,
  SearchIcon,
  ServerIcon,
  ShieldCheckIcon,
  SyncIcon,
  TerminalIcon,
  XCircleFillIcon,
  XIcon,
} from "@primer/octicons-react";
import { Heading, Text } from "@primer/react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import styled, { keyframes } from "styled-components";
import { getClusterStatus, getDbJobs, getJobTemplates, getUnifiedUserJobs, type ClusterStatus } from "../api";
import Box from "../components/Box";
import { safeJsonParse } from "../util/json";
import { usePageTitle } from "../util/title";

// ── Animations ────────────────────────────────────────────────────────

const pulseAnimation = keyframes`
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(1.15); }
`;

const shimmer = keyframes`
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
`;

const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

const SpinningIcon = styled(SyncIcon)<{ $isSpinning: boolean }>`
  animation: ${(props) => (props.$isSpinning ? spin : "none")} 0.8s linear infinite;
`;

const MetricCard = styled.div`
  background: var(--color-bg-card, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--color-border-glass, rgba(255, 255, 255, 0.08));
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
  overflow: hidden;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);

  &:hover {
    transform: translateY(-2px);
    border-color: var(--color-border-hover, rgba(255, 255, 255, 0.16));
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  }
`;

const TabButton = styled.button<{ $isActive: boolean; $activeColor?: string }>`
  padding: 12px 18px;
  background: none;
  border: none;
  border-bottom: 2px solid
    ${(props) => (props.$isActive ? props.$activeColor || "var(--color-accent-cyan)" : "transparent")};
  color: ${(props) => (props.$isActive ? "var(--color-text-primary, #ffffff)" : "var(--color-text-muted, #8b949e)")};
  font-weight: ${(props) => (props.$isActive ? 700 : 500)};
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: -1px;
  transition: all 0.15s ease;

  &:hover {
    color: var(--color-text-primary, #ffffff);
    background: rgba(255, 255, 255, 0.02);
  }
`;

const FilterChip = styled.button<{ $isSelected: boolean; $activeColor?: string }>`
  background: ${(props) =>
    props.$isSelected
      ? props.$activeColor || "var(--color-accent-cyan, #06b6d4)"
      : "var(--color-bg-card, rgba(255, 255, 255, 0.04))"};
  border: 1px solid
    ${(props) =>
      props.$isSelected
        ? props.$activeColor || "var(--color-accent-cyan, #06b6d4)"
        : "var(--color-border-glass, rgba(255, 255, 255, 0.08))"};
  color: ${(props) => (props.$isSelected ? "#ffffff" : "var(--color-text-muted, #8b949e)")};
  border-radius: 9999px;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s ease;

  &:hover {
    color: #ffffff;
    border-color: rgba(255, 255, 255, 0.2);
  }
`;

// ── Types ──────────────────────────────────────────────────────────

interface ScriptTemplate {
  id: number;
  name: string;
  slug: string;
  description: string;
  category: string;
  icon: string;
  config: string;
}

interface ScriptTemplateConfig {
  solver?: string;
  estimatedDuration?: string;
  steps?: unknown[];
  computeProfile?: string;
  partitions?: string[];
}

interface UnifiedJobItem {
  id: string | number;
  name: string;
  status: "RUNNING" | "QUEUED" | "SUCCESS" | "FAILED" | "CANCELLED" | string;
  domain: string;
  solver: string;
  profile: string;
  progress: number;
  costCredits?: number;
  started_at: string;
  completed_at?: string | null;
  metadata?: string | null;
}

// ── Helper functions ───────────────────────────────────────────────

const normalizeStatus = (rawStatus: string): "RUNNING" | "QUEUED" | "SUCCESS" | "FAILED" | "CANCELLED" => {
  const s = String(rawStatus).toUpperCase();
  if (s === "RUNNING" || s === "PROCESSING") return "RUNNING";
  if (s === "QUEUED" || s === "PENDING" || s === "PROVISIONING") return "QUEUED";
  if (s === "SUCCESS" || s === "COMPLETED") return "SUCCESS";
  if (s === "FAILED" || s === "ERROR") return "FAILED";
  if (s === "CANCELLED" || s === "ABORTED") return "CANCELLED";
  return "QUEUED";
};

const relativeTime = (dateStr: string | number): string => {
  if (!dateStr) return "recently";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

const categoryIcon = (icon: string) => {
  switch (icon) {
    case "wind":
      return <RocketIcon size={20} />;
    case "clock":
      return <ClockIcon size={20} />;
    case "flame":
      return <FlameIcon size={20} />;
    case "shield":
      return <ShieldCheckIcon size={20} />;
    case "pulse":
      return <PulseIcon size={20} />;
    case "thermometer":
      return <BeakerIcon size={20} />;
    case "link":
      return <LinkIcon size={20} />;
    case "graph":
      return <GraphIcon size={20} />;
    case "database":
      return <DatabaseIcon size={20} />;
    default:
      return <TerminalIcon size={20} />;
  }
};

// ── Main Component ──────────────────────────────────────────────────

const ScriptsListPage: React.FC = () => {
  usePageTitle("Jobs & HPC");
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "queue";
  const [templates, setTemplates] = useState<ScriptTemplate[]>([]);
  const [jobs, setJobs] = useState<UnifiedJobItem[]>([]);
  const [clusterInfo, setClusterInfo] = useState<ClusterStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [domainFilter] = useState<string>("ALL");

  const navigate = useNavigate();

  // Load all jobs & cluster data
  const fetchData = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsRefreshing(true);
    try {
      const [cluster, unifiedJobsRes, dbJobsRes, templatesRes] = await Promise.allSettled([
        getClusterStatus(),
        getUnifiedUserJobs(),
        getDbJobs(),
        getJobTemplates(),
      ]);

      if (cluster.status === "fulfilled") {
        setClusterInfo(cluster.value);
      }

      if (templatesRes.status === "fulfilled" && templatesRes.value?.templates) {
        setTemplates(templatesRes.value.templates);
      }

      // Merge and deduplicate jobs
      const mergedMap = new Map<string, UnifiedJobItem>();

      // 1. Unified Cloud / CAE Jobs
      if (unifiedJobsRes.status === "fulfilled" && Array.isArray(unifiedJobsRes.value)) {
        for (const uj of unifiedJobsRes.value) {
          const norm = normalizeStatus(uj.status);
          const isDone = norm === "SUCCESS";
          const isRunning = norm === "RUNNING";
          const prog = uj.progress != null ? uj.progress : isDone ? 100 : isRunning ? 60 : 0;

          mergedMap.set(String(uj.id), {
            id: uj.id,
            name: uj.name || `Simulation #${String(uj.id).slice(0, 6)}`,
            status: norm,
            domain: uj.domain || "modelica",
            solver: uj.domain === "cfd" ? "SU2 CFD" : uj.domain === "fea" ? "CalculiX FEA" : "SUNDIALS CVODE",
            profile: uj.profile || "standard-compute",
            progress: prog,
            costCredits: uj.costCredits,
            started_at: typeof uj.startedAt === "string" ? uj.startedAt : new Date().toISOString(),
          });
        }
      }

      // 2. Database API jobs
      if (dbJobsRes.status === "fulfilled" && Array.isArray(dbJobsRes.value?.jobs)) {
        for (const dj of dbJobsRes.value.jobs) {
          const idKey = String(dj.id);
          const norm = normalizeStatus(dj.status);
          const meta = safeJsonParse<{ templateSlug?: string; solver?: string; profile?: string }>(dj.metadata, {});
          const existing = mergedMap.get(idKey);

          mergedMap.set(idKey, {
            id: dj.id,
            name: dj.name || existing?.name || `Job #${dj.id}`,
            status: norm,
            domain:
              existing?.domain ||
              (meta.solver?.includes("cfd") ? "cfd" : meta.solver?.includes("fea") ? "fea" : "simulation"),
            solver: meta.solver || existing?.solver || dj.type || "Parametric Pipeline",
            profile: meta.profile || existing?.profile || "hpc-partition",
            progress: norm === "SUCCESS" ? 100 : norm === "RUNNING" ? 65 : 0,
            costCredits: existing?.costCredits,
            started_at: dj.started_at,
            completed_at: dj.completed_at,
            metadata: dj.metadata,
          });
        }
      }

      const mergedList = Array.from(mergedMap.values()).sort((a, b) => {
        // Running jobs first, then newest
        if (a.status === "RUNNING" && b.status !== "RUNNING") return -1;
        if (b.status === "RUNNING" && a.status !== "RUNNING") return 1;
        return new Date(b.started_at).getTime() - new Date(a.started_at).getTime();
      });

      setJobs(mergedList);
    } catch (err) {
      console.error("Failed to load jobs/cluster dashboard data:", err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchData(false);
  }, [fetchData]);

  // Auto-refresh interval (every 6 seconds if active)
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchData(true);
      }
    }, 6000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchData]);

  // Derived Counts
  const runningJobsCount = useMemo(() => jobs.filter((j) => j.status === "RUNNING").length, [jobs]);
  const queuedJobsCount = useMemo(() => jobs.filter((j) => j.status === "QUEUED").length, [jobs]);
  const completedJobsCount = useMemo(() => jobs.filter((j) => j.status === "SUCCESS").length, [jobs]);

  // Filtered Jobs
  const filteredJobs = useMemo(() => {
    return jobs.filter((j) => {
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        String(j.id).toLowerCase().includes(q) ||
        j.name.toLowerCase().includes(q) ||
        j.solver.toLowerCase().includes(q) ||
        j.domain.toLowerCase().includes(q);

      const matchesStatus = statusFilter === "ALL" || j.status === statusFilter;
      const matchesDomain = domainFilter === "ALL" || j.domain.toLowerCase() === domainFilter.toLowerCase();

      return matchesSearch && matchesStatus && matchesDomain;
    });
  }, [jobs, searchQuery, statusFilter, domainFilter]);

  // Grouped Templates
  const groupedTemplates = useMemo(() => {
    return templates.reduce<Record<string, ScriptTemplate[]>>((acc, t) => {
      (acc[t.category || "General"] ??= []).push(t);
      return acc;
    }, {});
  }, [templates]);

  return (
    <Box display="flex" flexDirection="column" style={{ minHeight: "100%", width: "100%" }}>
      {/* ── Top Header & HUD ────────────────────────────────────────── */}
      <Box
        p={4}
        borderBottom="1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08))"
        style={{
          background: "linear-gradient(180deg, rgba(6, 182, 212, 0.04) 0%, transparent 100%)",
        }}
      >
        <Box display="flex" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={3}>
          <div>
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "1px",
                textTransform: "uppercase",
                color: "var(--color-accent-cyan, #06b6d4)",
                fontFamily: "var(--font-mono, monospace)",
                marginBottom: "4px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <ServerIcon size={12} />
              <span>Cloud Compute &amp; HPC Orchestration</span>
            </div>
            <Heading
              as="h1"
              style={{ fontSize: "24px", fontWeight: 800, margin: 0, color: "var(--color-text-primary, #ffffff)" }}
            >
              Cloud Jobs &amp; HPC Queue
            </Heading>
            <Text
              style={{
                fontSize: "13px",
                color: "var(--color-text-muted, #8b949e)",
                marginTop: "4px",
                display: "block",
                maxWidth: "680px",
                lineHeight: 1.5,
              }}
            >
              Monitor real-time SUNDIALS CVODE trajectories, distributed SU2 CFD meshes, CalculiX structural FEA, and
              SLURM cluster pipelines.
            </Text>
          </div>

          {/* Action Toolbar */}
          <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
            {/* Auto-Refresh Toggle */}
            <button
              type="button"
              onClick={() => setAutoRefresh((prev) => !prev)}
              style={{
                background: autoRefresh ? "rgba(16, 185, 129, 0.12)" : "rgba(255, 255, 255, 0.04)",
                border: `1px solid ${autoRefresh ? "rgba(16, 185, 129, 0.3)" : "var(--color-border-glass, rgba(255, 255, 255, 0.1))"}`,
                color: autoRefresh ? "#34d399" : "var(--color-text-muted, #8b949e)",
                borderRadius: "8px",
                padding: "6px 12px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                fontFamily: "var(--font-mono, monospace)",
                transition: "all 0.15s ease",
              }}
              title={autoRefresh ? "Auto-refresh active (every 6s)" : "Auto-refresh paused"}
            >
              <div
                style={{
                  width: "7px",
                  height: "7px",
                  borderRadius: "50%",
                  backgroundColor: autoRefresh ? "#10b981" : "#6b7280",
                  boxShadow: autoRefresh ? "0 0 8px #10b981" : "none",
                }}
              />
              <span>{autoRefresh ? "Live 6s" : "Paused"}</span>
            </button>

            {/* Manual Refresh */}
            <button
              type="button"
              onClick={() => void fetchData(false)}
              disabled={isRefreshing}
              style={{
                background: "var(--color-bg-card, rgba(255, 255, 255, 0.05))",
                border: "1px solid var(--color-border-glass, rgba(255, 255, 255, 0.12))",
                color: "var(--color-text-primary, #ffffff)",
                borderRadius: "8px",
                padding: "6px 12px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                transition: "all 0.15s ease",
              }}
              title="Refresh queue status"
            >
              <SpinningIcon size={13} $isSpinning={isRefreshing} />
              <span>Refresh</span>
            </button>

            {/* Launch Job CTA */}
            <button
              type="button"
              onClick={() => setSearchParams({ tab: "templates" })}
              style={{
                background:
                  "linear-gradient(135deg, var(--color-accent-cyan, #06b6d4) 0%, var(--color-accent-purple, #6f42c1) 100%)",
                border: "none",
                color: "#ffffff",
                borderRadius: "8px",
                padding: "7px 16px",
                fontSize: "13px",
                fontWeight: 700,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                boxShadow: "0 2px 10px rgba(6, 182, 212, 0.3)",
                transition: "all 0.15s ease",
              }}
            >
              <PlayIcon size={14} />
              <span>Launch Simulation</span>
            </button>
          </Box>
        </Box>

        {/* ── Top Metric HUD Cards ──────────────────────────────────── */}
        <Box
          mt={4}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: "12px",
          }}
        >
          {/* Active Running */}
          <MetricCard>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  color: "var(--color-text-muted)",
                  letterSpacing: "0.5px",
                }}
              >
                Active Simulations
              </span>
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: runningJobsCount > 0 ? "var(--color-accent-cyan)" : "var(--color-text-muted)",
                  boxShadow: runningJobsCount > 0 ? "0 0 10px var(--color-accent-cyan)" : "none",
                  animation: runningJobsCount > 0 ? `${pulseAnimation} 1.5s infinite` : "none",
                }}
              />
            </div>
            <div
              style={{
                fontSize: "28px",
                fontWeight: 800,
                color: runningJobsCount > 0 ? "var(--color-accent-cyan)" : "var(--color-text-primary)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {runningJobsCount}
            </div>
            <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
              {runningJobsCount === 1 ? "1 job computing on cluster" : `${runningJobsCount} jobs computing on cluster`}
            </div>
          </MetricCard>

          {/* Queued / Pending */}
          <MetricCard>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  color: "var(--color-text-muted)",
                  letterSpacing: "0.5px",
                }}
              >
                Pending / Queued
              </span>
              <ClockIcon size={14} style={{ color: "#f59e0b" }} />
            </div>
            <div
              style={{
                fontSize: "28px",
                fontWeight: 800,
                color: queuedJobsCount > 0 ? "#f59e0b" : "var(--color-text-primary)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {queuedJobsCount}
            </div>
            <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Awaiting node partition allocation</div>
          </MetricCard>

          {/* Completed */}
          <MetricCard>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  color: "var(--color-text-muted)",
                  letterSpacing: "0.5px",
                }}
              >
                Completed Runs
              </span>
              <CheckCircleFillIcon size={14} style={{ color: "var(--color-status-verified, #10b981)" }} />
            </div>
            <div
              style={{
                fontSize: "28px",
                fontWeight: 800,
                color: "var(--color-status-verified, #10b981)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {completedJobsCount}
            </div>
            <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Total successful verification runs</div>
          </MetricCard>

          {/* Cluster Status */}
          <MetricCard>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  color: "var(--color-text-muted)",
                  letterSpacing: "0.5px",
                }}
              >
                Cluster Health
              </span>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  padding: "1px 6px",
                  borderRadius: "4px",
                  background: clusterInfo?.connected ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                  color: clusterInfo?.connected ? "#34d399" : "#f87171",
                  border: `1px solid ${clusterInfo?.connected ? "rgba(16, 185, 129, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
                }}
              >
                {clusterInfo?.connected ? "ONLINE" : "OFFLINE"}
              </span>
            </div>
            <div
              style={{
                fontSize: "16px",
                fontWeight: 700,
                color: "var(--color-text-primary)",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                marginTop: "4px",
              }}
            >
              <CpuIcon size={16} style={{ color: "var(--color-accent-purple, #a855f7)" }} />
              <span>
                {clusterInfo?.backend === "slurm-rest" || clusterInfo?.backend === "slurm"
                  ? `${clusterInfo.nodesCount || 1} Slurm Nodes`
                  : "Local WASM Solver"}
              </span>
            </div>
            <div style={{ fontSize: "11px", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
              Backend: {clusterInfo?.backend || "local-process"} · {clusterInfo?.latencyMs || 8}ms ping
            </div>
          </MetricCard>
        </Box>
      </Box>

      {/* ── Main Navigation Tabs ────────────────────────────────────── */}
      <Box
        px={4}
        borderBottom="1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08))"
        style={{
          display: "flex",
          gap: "8px",
          background: "rgba(0, 0, 0, 0.15)",
          overflowX: "auto",
        }}
      >
        <TabButton
          $isActive={activeTab === "queue"}
          $activeColor="var(--color-accent-cyan, #06b6d4)"
          onClick={() => setSearchParams({ tab: "queue" })}
        >
          <ServerIcon size={15} />
          <span>Active Queue &amp; History</span>
          <span
            style={{
              fontSize: "11px",
              padding: "1px 7px",
              borderRadius: "9999px",
              background: activeTab === "queue" ? "rgba(6, 182, 212, 0.2)" : "rgba(255, 255, 255, 0.06)",
              color: activeTab === "queue" ? "var(--color-accent-cyan, #06b6d4)" : "var(--color-text-muted)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {jobs.length}
          </span>
        </TabButton>

        <TabButton
          $isActive={activeTab === "templates"}
          $activeColor="var(--color-accent-purple, #a855f7)"
          onClick={() => setSearchParams({ tab: "templates" })}
        >
          <BeakerIcon size={15} />
          <span>Simulation Templates &amp; Pipelines</span>
          <span
            style={{
              fontSize: "11px",
              padding: "1px 7px",
              borderRadius: "9999px",
              background: activeTab === "templates" ? "rgba(168, 85, 247, 0.2)" : "rgba(255, 255, 255, 0.06)",
              color: activeTab === "templates" ? "var(--color-accent-purple, #a855f7)" : "var(--color-text-muted)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {templates.length}
          </span>
        </TabButton>

        <TabButton
          $isActive={activeTab === "cluster"}
          $activeColor="#10b981"
          onClick={() => setSearchParams({ tab: "cluster" })}
        >
          <CpuIcon size={15} />
          <span>Cluster Topology &amp; Slurm Partitions</span>
        </TabButton>
      </Box>

      {/* ── Content View ────────────────────────────────────────────── */}
      <Box p={4} flex={1} style={{ overflowY: "auto" }}>
        {activeTab === "queue" && (
          /* ── TAB 1: JOB QUEUE & RUNS ──────────────────────────────── */
          <Box display="flex" flexDirection="column" gap={3}>
            {/* Filter & Search Bar */}
            <Box
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              flexWrap="wrap"
              gap={3}
              p={3}
              borderRadius="10px"
              style={{
                background: "var(--color-bg-card, rgba(255, 255, 255, 0.03))",
                border: "1px solid var(--color-border-glass, rgba(255, 255, 255, 0.08))",
              }}
            >
              {/* Search */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  background: "rgba(255, 255, 255, 0.04)",
                  border: "1px solid var(--color-border-glass, rgba(255, 255, 255, 0.1))",
                  borderRadius: "8px",
                  padding: "6px 12px",
                  minWidth: "260px",
                }}
              >
                <SearchIcon size={14} style={{ color: "var(--color-text-muted)" }} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter jobs by name, ID, or solver..."
                  style={{
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    color: "inherit",
                    fontSize: "13px",
                    width: "100%",
                  }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    style={{ background: "none", border: "none", color: "var(--color-text-muted)", cursor: "pointer" }}
                  >
                    <XIcon size={12} />
                  </button>
                )}
              </div>

              {/* Status Filters */}
              <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
                <span style={{ fontSize: "12px", color: "var(--color-text-muted)", marginRight: "4px" }}>
                  <FilterIcon size={12} /> Status:
                </span>
                {(["ALL", "RUNNING", "QUEUED", "SUCCESS", "FAILED"] as const).map((st) => (
                  <FilterChip
                    key={st}
                    $isSelected={statusFilter === st}
                    $activeColor={
                      st === "RUNNING"
                        ? "var(--color-accent-cyan, #06b6d4)"
                        : st === "QUEUED"
                          ? "#f59e0b"
                          : st === "SUCCESS"
                            ? "#10b981"
                            : st === "FAILED"
                              ? "#ef4444"
                              : "var(--color-accent-purple, #6f42c1)"
                    }
                    onClick={() => setStatusFilter(st)}
                  >
                    <span>{st === "ALL" ? "All Status" : st}</span>
                  </FilterChip>
                ))}
              </Box>
            </Box>

            {/* Jobs List / Table */}
            {isLoading ? (
              <Box py={6} textAlign="center" color="var(--color-text-muted)">
                <SpinningIcon size={24} $isSpinning={true} />
                <Text display="block" mt={2} fontSize="13px">
                  Loading HPC jobs queue...
                </Text>
              </Box>
            ) : filteredJobs.length === 0 ? (
              <Box
                py={6}
                textAlign="center"
                color="var(--color-text-muted)"
                borderRadius="12px"
                style={{
                  background: "var(--color-bg-card, rgba(255, 255, 255, 0.02))",
                  border: "1px dashed var(--color-border-glass, rgba(255, 255, 255, 0.1))",
                }}
              >
                <ServerIcon size={36} style={{ color: "var(--color-text-muted)", opacity: 0.6 }} />
                <Heading as="h3" style={{ fontSize: "16px", marginTop: "12px", color: "var(--color-text-primary)" }}>
                  No simulation jobs found
                </Heading>
                <Text
                  fontSize="13px"
                  style={{ maxWidth: 360, margin: "6px auto 16px", display: "block", color: "var(--color-text-muted)" }}
                >
                  {searchQuery || statusFilter !== "ALL"
                    ? "Try adjusting your search query or status filter."
                    : "You haven't launched any simulations yet. Pick a ready-to-run template or submit a custom job."}
                </Text>
                <button
                  type="button"
                  onClick={() => setSearchParams({ tab: "templates" })}
                  style={{
                    background: "var(--color-accent-cyan, #06b6d4)",
                    border: "none",
                    color: "#ffffff",
                    borderRadius: "8px",
                    padding: "8px 18px",
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Browse Simulation Templates
                </button>
              </Box>
            ) : (
              <Box display="flex" flexDirection="column" gap={2}>
                {filteredJobs.map((job) => {
                  const isRunning = job.status === "RUNNING";
                  const isDone = job.status === "SUCCESS";
                  const isFailed = job.status === "FAILED";

                  return (
                    <div
                      key={job.id}
                      onClick={() => navigate(`/jobs/${job.id}`)}
                      style={{
                        padding: "16px 20px",
                        borderRadius: "12px",
                        backgroundColor: isRunning
                          ? "rgba(6, 182, 212, 0.05)"
                          : "var(--color-bg-card, rgba(255, 255, 255, 0.025))",
                        border: `1px solid ${
                          isRunning
                            ? "rgba(6, 182, 212, 0.35)"
                            : isFailed
                              ? "rgba(239, 68, 68, 0.25)"
                              : "var(--color-border-glass, rgba(255, 255, 255, 0.08))"
                        }`,
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        gap: "10px",
                        transition: "all 0.15s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = isRunning
                          ? "var(--color-accent-cyan)"
                          : "rgba(255, 255, 255, 0.25)";
                        e.currentTarget.style.transform = "translateY(-1px)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = isRunning
                          ? "rgba(6, 182, 212, 0.35)"
                          : isFailed
                            ? "rgba(239, 68, 68, 0.25)"
                            : "var(--color-border-glass, rgba(255, 255, 255, 0.08))";
                        e.currentTarget.style.transform = "none";
                      }}
                    >
                      {/* Top Row: Title, ID, Status, Actions */}
                      <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
                        <Box display="flex" alignItems="center" gap={2} style={{ minWidth: 0, flex: 1 }}>
                          {isRunning ? (
                            <PulseIcon
                              size={18}
                              style={{
                                color: "var(--color-accent-cyan)",
                                animation: `${pulseAnimation} 1.5s infinite`,
                              }}
                            />
                          ) : isDone ? (
                            <CheckCircleFillIcon size={18} fill="var(--color-status-verified, #10b981)" />
                          ) : isFailed ? (
                            <XCircleFillIcon size={18} fill="#ef4444" />
                          ) : (
                            <ClockIcon size={18} style={{ color: "#f59e0b" }} />
                          )}

                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                              <span
                                style={{
                                  fontWeight: 700,
                                  fontSize: "15px",
                                  color: "var(--color-text-primary, #ffffff)",
                                }}
                              >
                                {job.name}
                              </span>
                              <code
                                style={{
                                  fontSize: "11px",
                                  fontFamily: "var(--font-mono, monospace)",
                                  backgroundColor: "rgba(255, 255, 255, 0.08)",
                                  color: "var(--color-text-muted, #8b949e)",
                                  padding: "1px 6px",
                                  borderRadius: "4px",
                                }}
                              >
                                #{String(job.id).slice(0, 8)}
                              </code>
                            </div>
                          </div>
                        </Box>

                        <Box display="flex" alignItems="center" gap={3}>
                          {/* Status Badge */}
                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: 700,
                              fontFamily: "var(--font-mono, monospace)",
                              padding: "3px 8px",
                              borderRadius: "6px",
                              background: isRunning
                                ? "rgba(6, 182, 212, 0.15)"
                                : isDone
                                  ? "rgba(16, 185, 129, 0.15)"
                                  : isFailed
                                    ? "rgba(239, 68, 68, 0.15)"
                                    : "rgba(245, 158, 11, 0.15)",
                              color: isRunning
                                ? "var(--color-accent-cyan, #06b6d4)"
                                : isDone
                                  ? "var(--color-status-verified, #10b981)"
                                  : isFailed
                                    ? "#f87171"
                                    : "#fbbf24",
                              border: `1px solid ${
                                isRunning
                                  ? "rgba(6, 182, 212, 0.4)"
                                  : isDone
                                    ? "rgba(16, 185, 129, 0.4)"
                                    : isFailed
                                      ? "rgba(239, 68, 68, 0.4)"
                                      : "rgba(245, 158, 11, 0.4)"
                              }`,
                              letterSpacing: "0.5px",
                            }}
                          >
                            {job.status}
                          </span>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/jobs/${job.id}`);
                            }}
                            style={{
                              background: "rgba(255, 255, 255, 0.06)",
                              border: "1px solid var(--color-border-glass, rgba(255, 255, 255, 0.12))",
                              color: "var(--color-text-primary, #ffffff)",
                              borderRadius: "6px",
                              padding: "4px 10px",
                              fontSize: "12px",
                              fontWeight: 600,
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                          >
                            <span>Inspect</span>
                            <ArrowRightIcon size={12} />
                          </button>
                        </Box>
                      </Box>

                      {/* Progress Bar (if running or completed) */}
                      {(isRunning || job.progress > 0) && (
                        <div
                          style={{
                            height: "5px",
                            background: "rgba(255, 255, 255, 0.08)",
                            borderRadius: "9999px",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              height: "100%",
                              width: `${job.progress}%`,
                              background: isFailed
                                ? "#ef4444"
                                : isDone
                                  ? "var(--color-status-verified, #10b981)"
                                  : "linear-gradient(90deg, #06b6d4, #8b5cf6, #06b6d4)",
                              backgroundSize: "200% 100%",
                              animation: isRunning ? `${shimmer} 2s linear infinite` : "none",
                              borderRadius: "9999px",
                              transition: "width 0.4s ease",
                            }}
                          />
                        </div>
                      )}

                      {/* Bottom Metadata Row */}
                      <Box
                        display="flex"
                        justifyContent="space-between"
                        alignItems="center"
                        flexWrap="wrap"
                        gap={2}
                        fontSize="12px"
                        color="var(--color-text-muted)"
                      >
                        <Box display="flex" alignItems="center" gap={3} flexWrap="wrap">
                          <span>
                            Solver: <strong style={{ color: "var(--color-text-primary)" }}>{job.solver}</strong>
                          </span>
                          <span>·</span>
                          <span>
                            Domain:{" "}
                            <strong style={{ color: "var(--color-accent-cyan)" }}>{job.domain.toUpperCase()}</strong>
                          </span>
                          <span>·</span>
                          <span>
                            Compute Profile: <code style={{ fontSize: "11px" }}>{job.profile}</code>
                          </span>
                        </Box>

                        <Box display="flex" alignItems="center" gap={3}>
                          {job.costCredits != null && (
                            <span style={{ color: "var(--color-accent-purple, #a855f7)", fontWeight: 600 }}>
                              {job.costCredits.toFixed(2)} credits
                            </span>
                          )}
                          <span>
                            Started {relativeTime(job.started_at)}
                            {job.completed_at && ` · Finished ${relativeTime(job.completed_at)}`}
                          </span>
                        </Box>
                      </Box>
                    </div>
                  );
                })}
              </Box>
            )}
          </Box>
        )}

        {activeTab === "templates" && (
          /* ── TAB 2: SIMULATION TEMPLATES & PIPELINES ──────────────── */
          <Box display="flex" flexDirection="column" gap={4}>
            {Object.keys(groupedTemplates).length === 0 ? (
              <Box py={6} textAlign="center" color="var(--color-text-muted)">
                <TerminalIcon size={32} />
                <Text display="block" mt={2}>
                  No simulation templates available
                </Text>
              </Box>
            ) : (
              Object.entries(groupedTemplates).map(([category, items]) => (
                <Box key={category}>
                  <Box display="flex" alignItems="center" gap={2} mb={3}>
                    <div
                      style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "2px",
                        backgroundColor: "var(--color-accent-purple, #a855f7)",
                      }}
                    />
                    <Text fontSize="16px" fontWeight="700" color="var(--color-text-primary, #ffffff)">
                      {category}
                    </Text>
                    <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                      ({items.length} {items.length === 1 ? "pipeline" : "pipelines"})
                    </span>
                  </Box>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                      gap: "14px",
                    }}
                  >
                    {items.map((t) => {
                      const cfg = safeJsonParse<ScriptTemplateConfig>(t.config, {});

                      return (
                        <div
                          key={t.id}
                          onClick={() => navigate(`/jobs/templates/${t.id}`)}
                          style={{
                            background: "var(--color-bg-card, rgba(255, 255, 255, 0.03))",
                            border: "1px solid var(--color-border-glass, rgba(255, 255, 255, 0.08))",
                            borderRadius: "12px",
                            padding: "18px",
                            cursor: "pointer",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "space-between",
                            gap: "12px",
                            transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = "var(--color-accent-purple, #a855f7)";
                            e.currentTarget.style.transform = "translateY(-2px)";
                            e.currentTarget.style.boxShadow = "0 8px 24px rgba(111, 66, 193, 0.2)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = "var(--color-border-glass, rgba(255, 255, 255, 0.08))";
                            e.currentTarget.style.transform = "none";
                            e.currentTarget.style.boxShadow = "none";
                          }}
                        >
                          <div>
                            <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={2} mb={2}>
                              <div
                                style={{
                                  width: "36px",
                                  height: "36px",
                                  borderRadius: "8px",
                                  backgroundColor: "rgba(168, 85, 247, 0.12)",
                                  border: "1px solid rgba(168, 85, 247, 0.3)",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  color: "var(--color-accent-purple, #a855f7)",
                                  flexShrink: 0,
                                }}
                              >
                                {categoryIcon(t.icon)}
                              </div>
                              <span
                                style={{
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  padding: "2px 8px",
                                  borderRadius: "9999px",
                                  background: "rgba(255, 255, 255, 0.06)",
                                  color: "var(--color-text-muted)",
                                }}
                              >
                                {t.category}
                              </span>
                            </Box>

                            <Text
                              fontSize="15px"
                              fontWeight="700"
                              color="var(--color-text-primary, #ffffff)"
                              display="block"
                            >
                              {t.name}
                            </Text>

                            <Text
                              fontSize="13px"
                              color="var(--color-text-muted)"
                              display="block"
                              style={{ marginTop: "6px", lineHeight: 1.45 }}
                            >
                              {t.description.length > 150 ? t.description.slice(0, 150) + "…" : t.description}
                            </Text>
                          </div>

                          <Box
                            pt={2}
                            borderTop="1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.06))"
                            display="flex"
                            justifyContent="space-between"
                            alignItems="center"
                            fontSize="12px"
                          >
                            <Box display="flex" alignItems="center" gap={3} color="var(--color-text-muted)">
                              {cfg.solver && <span style={{ color: "var(--color-accent-cyan)" }}>{cfg.solver}</span>}
                              {cfg.estimatedDuration && (
                                <Box display="flex" alignItems="center" gap={1}>
                                  <ClockIcon size={12} />
                                  <span>{cfg.estimatedDuration}</span>
                                </Box>
                              )}
                            </Box>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/jobs/templates/${t.id}`);
                              }}
                              style={{
                                background: "rgba(168, 85, 247, 0.15)",
                                border: "1px solid rgba(168, 85, 247, 0.35)",
                                color: "#d8b4fe",
                                borderRadius: "6px",
                                padding: "4px 10px",
                                fontSize: "12px",
                                fontWeight: 600,
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                              }}
                            >
                              <span>Configure &amp; Run</span>
                              <ArrowRightIcon size={12} />
                            </button>
                          </Box>
                        </div>
                      );
                    })}
                  </div>
                </Box>
              ))
            )}
          </Box>
        )}

        {activeTab === "cluster" && (
          /* ── TAB 3: CLUSTER TOPOLOGY & PARTITIONS ─────────────────── */
          <Box display="flex" flexDirection="column" gap={4}>
            {/* Cluster Architecture Card */}
            <Box
              p={4}
              borderRadius="12px"
              style={{
                background: "var(--color-bg-card, rgba(255, 255, 255, 0.03))",
                border: "1px solid var(--color-border-glass, rgba(255, 255, 255, 0.08))",
              }}
            >
              <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={3} mb={3}>
                <Box display="flex" alignItems="center" gap={3}>
                  <div
                    style={{
                      width: "42px",
                      height: "42px",
                      borderRadius: "10px",
                      backgroundColor: "rgba(6, 182, 212, 0.12)",
                      border: "1px solid rgba(6, 182, 212, 0.3)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--color-accent-cyan)",
                    }}
                  >
                    <ServerIcon size={22} />
                  </div>
                  <div>
                    <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                      HPC Simulation Cluster Orchestrator
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
                      Backend: {clusterInfo?.backend || "slurm"} · Version: {clusterInfo?.version || "23.02-slurmrestd"}
                    </div>
                  </div>
                </Box>

                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "4px 12px",
                    borderRadius: "9999px",
                    background: clusterInfo?.connected ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                    color: clusterInfo?.connected ? "#34d399" : "#f87171",
                    border: `1px solid ${clusterInfo?.connected ? "rgba(16, 185, 129, 0.4)" : "rgba(239, 68, 68, 0.4)"}`,
                    fontFamily: "var(--font-mono)",
                    fontSize: "12px",
                    fontWeight: 700,
                  }}
                >
                  <div
                    style={{
                      width: "7px",
                      height: "7px",
                      borderRadius: "50%",
                      backgroundColor: clusterInfo?.connected ? "#10b981" : "#ef4444",
                    }}
                  />
                  <span>{clusterInfo?.connected ? "Cluster Connected & Serving" : "Cluster Offline"}</span>
                </div>
              </Box>

              <Text fontSize="13px" color="var(--color-text-muted)" style={{ lineHeight: 1.6 }}>
                ModelScript polyglot models can run directly in the browser via WebAssembly (DAE arena, SUNDIALS CVODE),
                or scale outward to high-performance compute clusters managed by Slurm. Multi-fidelity continuum
                simulations (Tet10 FEA, D3Q19 LBM, and compressible SU2) are automatically routed to allocated
                partitions based on memory and GPU availability.
              </Text>
            </Box>

            {/* Partitions & Topology Grid */}
            <div>
              <Heading
                as="h3"
                style={{ fontSize: "16px", fontWeight: 700, marginBottom: "12px", color: "var(--color-text-primary)" }}
              >
                Compute Partitions
              </Heading>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                  gap: "14px",
                }}
              >
                {/* Partition 1: compute-standard */}
                <Box
                  p={3}
                  borderRadius="10px"
                  style={{
                    background: "var(--color-bg-card, rgba(255, 255, 255, 0.03))",
                    border: "1px solid var(--color-border-glass, rgba(255, 255, 255, 0.08))",
                  }}
                >
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                    <span style={{ fontWeight: 700, fontSize: "14px", color: "var(--color-text-primary)" }}>
                      compute-standard
                    </span>
                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: 700,
                        color: "#10b981",
                        background: "rgba(16, 185, 129, 0.15)",
                        padding: "1px 6px",
                        borderRadius: "4px",
                      }}
                    >
                      UP
                    </span>
                  </Box>
                  <div style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
                    General multi-core CPU solver pool for SUNDIALS, RK4, and Modelica DAE simulations.
                  </div>
                  <div
                    style={{
                      marginTop: "12px",
                      display: "flex",
                      gap: "16px",
                      fontSize: "11px",
                      fontFamily: "var(--font-mono)",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    <span>
                      Nodes: <strong>{clusterInfo?.nodesCount || 4}</strong>
                    </span>
                    <span>
                      Max Time: <strong>04:00:00</strong>
                    </span>
                    <span>
                      State: <strong style={{ color: "#34d399" }}>Idle / Ready</strong>
                    </span>
                  </div>
                </Box>

                {/* Partition 2: gpu-accelerated */}
                <Box
                  p={3}
                  borderRadius="10px"
                  style={{
                    background: "var(--color-bg-card, rgba(255, 255, 255, 0.03))",
                    border: "1px solid var(--color-border-glass, rgba(255, 255, 255, 0.08))",
                  }}
                >
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                    <span style={{ fontWeight: 700, fontSize: "14px", color: "var(--color-text-primary)" }}>
                      gpu-accelerated (A100)
                    </span>
                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: 700,
                        color: "#10b981",
                        background: "rgba(16, 185, 129, 0.15)",
                        padding: "1px 6px",
                        borderRadius: "4px",
                      }}
                    >
                      UP
                    </span>
                  </Box>
                  <div style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
                    Dedicated NVIDIA A100 / WebGPU batched nodes for SU2 CFD and large-scale Tet10 FEA inversions.
                  </div>
                  <div
                    style={{
                      marginTop: "12px",
                      display: "flex",
                      gap: "16px",
                      fontSize: "11px",
                      fontFamily: "var(--font-mono)",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    <span>
                      GPUs: <strong>16x A100</strong>
                    </span>
                    <span>
                      VRAM: <strong>80 GB / node</strong>
                    </span>
                    <span>
                      State: <strong style={{ color: "#34d399" }}>Ready</strong>
                    </span>
                  </div>
                </Box>

                {/* Partition 3: wasm-edge */}
                <Box
                  p={3}
                  borderRadius="10px"
                  style={{
                    background: "var(--color-bg-card, rgba(255, 255, 255, 0.03))",
                    border: "1px solid var(--color-border-glass, rgba(255, 255, 255, 0.08))",
                  }}
                >
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                    <span style={{ fontWeight: 700, fontSize: "14px", color: "var(--color-text-primary)" }}>
                      wasm-edge (Zero-Latency)
                    </span>
                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: 700,
                        color: "var(--color-accent-cyan)",
                        background: "rgba(6, 182, 212, 0.15)",
                        padding: "1px 6px",
                        borderRadius: "4px",
                      }}
                    >
                      ACTIVE
                    </span>
                  </Box>
                  <div style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
                    In-browser client-side WebAssembly kernel execution with direct linear CST lowering. Zero network
                    latency.
                  </div>
                  <div
                    style={{
                      marginTop: "12px",
                      display: "flex",
                      gap: "16px",
                      fontSize: "11px",
                      fontFamily: "var(--font-mono)",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    <span>
                      Threads: <strong>WebWorkers</strong>
                    </span>
                    <span>
                      Latency: <strong>&lt;1 ms</strong>
                    </span>
                    <span>
                      Tier: <strong style={{ color: "var(--color-accent-cyan)" }}>Free / Infinite</strong>
                    </span>
                  </div>
                </Box>
              </div>
            </div>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default ScriptsListPage;
