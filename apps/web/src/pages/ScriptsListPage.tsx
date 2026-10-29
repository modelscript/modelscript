// SPDX-License-Identifier: AGPL-3.0-or-later

import { BeakerIcon, CpuIcon, ServerIcon } from "@primer/octicons-react";
import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getClusterStatus, getDbJobs, getJobTemplates, getUnifiedUserJobs, type ClusterStatus } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import { BUILTIN_HPC_TEMPLATES } from "../components/cloud-sim/hpcTemplates";
import { safeJsonParse } from "../util/json";
import { usePageTitle } from "../util/title";
import {
  ClusterTopologyTab,
  normalizeStatus,
  QueueTab,
  ScriptsHeaderHud,
  TabButton,
  TemplatesTab,
  type ScriptTemplate,
  type UnifiedJobItem,
} from "./scripts";

const CloudSimulationModal = React.lazy(() => import("../components/cloud-sim/CloudSimulationModal"));

const ScriptsListPage: React.FC = () => {
  usePageTitle("Jobs & HPC");
  const { creditBalance } = useAuth();
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
  const [domainFilter, setDomainFilter] = useState<string>("ALL");
  const [wizardTemplateSlug, setWizardTemplateSlug] = useState<string | undefined>(undefined);
  const [isWizardOpen, setIsWizardOpen] = useState(false);

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
          const prog = isDone ? 100 : (uj.progress ?? 0);

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
          const meta = safeJsonParse<{
            templateSlug?: string | undefined;
            solver?: string | undefined;
            profile?: string | undefined;
          }>(dj.metadata, {});
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
            progress: norm === "SUCCESS" ? 100 : (existing?.progress ?? 0),
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
      const matchesDomain =
        domainFilter === "ALL" ||
        j.domain.toLowerCase() === domainFilter.toLowerCase() ||
        (domainFilter === "MODELICA" && j.domain.toLowerCase() === "simulation");

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
      <ScriptsHeaderHud
        autoRefresh={autoRefresh}
        setAutoRefresh={setAutoRefresh}
        isRefreshing={isRefreshing}
        onRefresh={() => void fetchData(false)}
        onLaunchClick={() => {
          setWizardTemplateSlug(undefined);
          setIsWizardOpen(true);
        }}
        onTopUpClick={() => navigate("/settings?tab=billing")}
        runningJobsCount={runningJobsCount}
        queuedJobsCount={queuedJobsCount}
        completedJobsCount={completedJobsCount}
        clusterInfo={clusterInfo}
        creditBalance={creditBalance}
      />

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
            {Math.max(templates.length, BUILTIN_HPC_TEMPLATES.length)}
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
          <QueueTab
            isLoading={isLoading}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            domainFilter={domainFilter}
            setDomainFilter={setDomainFilter}
            filteredJobs={filteredJobs}
            onInspectJob={(id) => navigate(`/jobs/${id}`)}
            onBrowseTemplates={() => setSearchParams({ tab: "templates" })}
          />
        )}

        {activeTab === "templates" && (
          <TemplatesTab
            groupedTemplates={groupedTemplates}
            onSelectTemplate={(id) => navigate(`/jobs/templates/${id}`)}
            onLaunchWizard={(slug) => {
              setWizardTemplateSlug(slug);
              setIsWizardOpen(true);
            }}
          />
        )}

        {activeTab === "cluster" && <ClusterTopologyTab clusterInfo={clusterInfo} />}
      </Box>

      {isWizardOpen && (
        <Suspense fallback={null}>
          <CloudSimulationModal
            isOpen={isWizardOpen}
            onClose={() => {
              setIsWizardOpen(false);
              void fetchData(true);
            }}
            {...(wizardTemplateSlug ? { initialTemplateSlug: wizardTemplateSlug, initialStep: "artifact" } : {})}
          />
        </Suspense>
      )}
    </Box>
  );
};

export default ScriptsListPage;
