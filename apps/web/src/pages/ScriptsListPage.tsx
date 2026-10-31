// SPDX-License-Identifier: AGPL-3.0-or-later

import { BeakerIcon, CpuIcon, ServerIcon } from "@primer/octicons-react";
import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  getClusterStatus,
  getDbJobs,
  getJobTemplates,
  getUnifiedUserJobs,
  runStudyJob,
  saveJobAsStudyTemplate,
  type ClusterStatus,
} from "../api";
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
  usePageTitle("Studies & HPC Workbench");
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
  const [standardFilter, setStandardFilter] = useState<string>("ALL");
  const [wizardTemplateSlug, setWizardTemplateSlug] = useState<string | undefined>(undefined);
  const [isWizardOpen, setIsWizardOpen] = useState(false);

  const navigate = useNavigate();

  // Load all jobs, study templates & cluster data
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

      // Merge and deduplicate jobs using canonical DB IDs and cloud job IDs
      const mergedMap = new Map<string, UnifiedJobItem>();
      const cloudIdToKey = new Map<string, string>();

      // 1. Database API jobs (canonical source of truth)
      if (dbJobsRes.status === "fulfilled" && Array.isArray(dbJobsRes.value?.jobs)) {
        for (const dj of dbJobsRes.value.jobs) {
          const idKey = String(dj.id);
          const norm = normalizeStatus(dj.status);
          const meta = safeJsonParse<{
            jobId?: string | undefined;
            templateSlug?: string | undefined;
            studyKind?: string | undefined;
            standardFormat?: "sedml" | "ssp-ssv" | "dakota" | string | undefined;
            modelName?: string | undefined;
            modelDomain?: string | undefined;
            packageName?: string | undefined;
            packageVersion?: string | undefined;
            targetArtifact?: string | undefined;
            executionTarget?: string | undefined;
            sampleCount?: number | undefined;
            solver?: string | undefined;
            profile?: string | undefined;
            computeProfile?: string | undefined;
            studyInstanceArtifact?:
              | {
                  format: "sedml" | "ssp-ssv" | "dakota" | string;
                  fileName: string;
                  mimeType: string;
                  content: string;
                  sha256: string;
                }
              | undefined;
            kpis?:
              | {
                  id: string;
                  label: string;
                  value: number | string;
                  unit?: string | undefined;
                  status?: string | undefined;
                }[]
              | undefined;
          }>(dj.metadata, {});

          if (meta.jobId) {
            cloudIdToKey.set(meta.jobId, idKey);
            cloudIdToKey.set(`cloud-${meta.jobId}`, idKey);
          }

          mergedMap.set(idKey, {
            id: dj.id,
            name: dj.name || `Study Run #${dj.id}`,
            status: norm,
            domain:
              meta.modelDomain ||
              (meta.solver?.includes("cfd") || meta.solver?.includes("su2") || meta.solver?.includes("openfoam")
                ? "cfd"
                : meta.solver?.includes("fea") || meta.solver?.includes("calculix")
                  ? "fea"
                  : "modelica"),
            solver: meta.solver || dj.type || "DAE / Study Engine",
            profile: meta.computeProfile || meta.profile || dj.compute_profile || "standard",
            progress: norm === "SUCCESS" ? 100 : norm === "RUNNING" ? 50 : 0,
            costCredits: dj.cost_credits ?? undefined,
            started_at: dj.started_at,
            completed_at: dj.completed_at,
            metadata: dj.metadata,
            studyKind: meta.studyKind,
            standardFormat: meta.standardFormat || meta.studyInstanceArtifact?.format,
            templateSlug: meta.templateSlug,
            modelName: meta.modelName,
            packageName: meta.packageName,
            packageVersion: meta.packageVersion,
            targetArtifact: meta.targetArtifact || meta.modelName,
            executionTarget: meta.executionTarget || dj.trigger_source || undefined,
            sampleCount: meta.sampleCount,
            studyInstanceArtifact: meta.studyInstanceArtifact,
            kpis: meta.kpis,
          });
        }
      }

      // 2. Active Cloud / CAE Jobs (merged by canonical dbJobId or cloudIdToKey)
      if (unifiedJobsRes.status === "fulfilled" && Array.isArray(unifiedJobsRes.value)) {
        for (const uj of unifiedJobsRes.value) {
          const canonicalKey =
            (uj.dbJobId ? String(uj.dbJobId) : undefined) || cloudIdToKey.get(String(uj.id)) || String(uj.id);
          if (mergedMap.has(canonicalKey)) {
            const existing = mergedMap.get(canonicalKey)!;
            if (existing.costCredits === undefined && uj.costCredits !== undefined) {
              existing.costCredits = uj.costCredits;
            }
            continue;
          }

          const norm = normalizeStatus(uj.status);
          const isDone = norm === "SUCCESS";
          const prog = isDone ? 100 : (uj.progress ?? 0);

          mergedMap.set(canonicalKey, {
            id: uj.dbJobId ?? uj.id,
            name: uj.name || `Study #${String(uj.id).slice(0, 6)}`,
            status: norm,
            domain: uj.domain || "modelica",
            solver: uj.domain === "cfd" ? "SU2 CFD" : uj.domain === "fea" ? "CalculiX FEA" : "SUNDIALS CVODE",
            profile: uj.profile || "standard",
            progress: prog,
            costCredits: uj.costCredits,
            started_at: typeof uj.startedAt === "string" ? uj.startedAt : new Date().toISOString(),
          });
        }
      }

      const mergedList = Array.from(mergedMap.values()).sort((a, b) => {
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
        j.domain.toLowerCase().includes(q) ||
        (j.modelName || "").toLowerCase().includes(q) ||
        (j.targetArtifact || "").toLowerCase().includes(q) ||
        (j.packageName || "").toLowerCase().includes(q);

      const matchesStatus = statusFilter === "ALL" || j.status === statusFilter;
      const matchesDomain =
        domainFilter === "ALL" ||
        j.domain.toLowerCase() === domainFilter.toLowerCase() ||
        (domainFilter === "MODELICA" &&
          (j.domain.toLowerCase() === "simulation" || j.domain.toLowerCase() === "modelica"));
      const matchesStandard =
        standardFilter === "ALL" || (j.standardFormat || j.studyInstanceArtifact?.format || "sedml") === standardFilter;

      return matchesSearch && matchesStatus && matchesDomain && matchesStandard;
    });
  }, [jobs, searchQuery, statusFilter, domainFilter, standardFilter]);

  const handleRerunJob = useCallback(
    async (job: UnifiedJobItem) => {
      try {
        const res = await runStudyJob({
          templateSlug: job.templateSlug || "modelica-transient-dae",
          name: `${job.name} (Re-run)`,
          modelName: job.modelName || "Model",
          modelDomain: job.domain || "modelica",
          packageName: job.packageName ?? undefined,
          packageVersion: job.packageVersion ?? undefined,
          targetArtifact: job.targetArtifact || job.modelName,
          executionTarget: (job.executionTarget as "local-wasm" | "local-native" | "hpc-cluster") || "local-wasm",
          computeProfile: job.profile || "standard",
          standardFormat: (job.standardFormat as "sedml" | "ssp-ssv" | "dakota") || "sedml",
          linkToPackage: Boolean(job.packageName),
        });
        if (res?.job?.id) {
          navigate(`/jobs/${res.job.id}`);
        } else {
          void fetchData(false);
        }
      } catch (err) {
        console.error("Failed to re-run study job:", err);
      }
    },
    [navigate, fetchData],
  );

  const handleSaveJobAsTemplate = useCallback(
    async (job: UnifiedJobItem) => {
      try {
        const res = await saveJobAsStudyTemplate(job.id, {
          name: `${job.name} Template`,
        });
        if (res?.template?.slug) {
          navigate(`/jobs/templates/${res.template.slug}`);
        } else {
          void fetchData(false);
        }
      } catch (err) {
        console.error("Failed to save job as study template:", err);
      }
    },
    [navigate, fetchData],
  );

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
          setSearchParams({ tab: "templates" });
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
          <span>Study Runs &amp; HPC Queue</span>
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
          <span>Study Template Gallery (Official &amp; Packages)</span>
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
          <span>Cluster Topology &amp; Partitions</span>
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
            standardFilter={standardFilter}
            setStandardFilter={setStandardFilter}
            filteredJobs={filteredJobs}
            onInspectJob={(id) => navigate(`/jobs/${id}`)}
            onBrowseTemplates={() => setSearchParams({ tab: "templates" })}
            onRerunJob={(job) => void handleRerunJob(job)}
            onSaveJobAsTemplate={(job) => void handleSaveJobAsTemplate(job)}
          />
        )}

        {activeTab === "templates" && (
          <TemplatesTab
            groupedTemplates={groupedTemplates}
            onSelectTemplate={(idOrSlug) => navigate(`/jobs/templates/${idOrSlug}`)}
            onLaunchWizard={(slug) => {
              setWizardTemplateSlug(slug);
              setIsWizardOpen(true);
            }}
            onTemplateCreated={() => void fetchData(false)}
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
